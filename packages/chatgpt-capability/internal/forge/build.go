package forge

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

const nativeBuildContract = "go-native/linux-amd64-static;CGO_ENABLED=0;trimpath;buildvcs=false;ldflags=-s -w -buildid="

type cacheMeta struct {
	Schema        string `json:"schema"`
	SourceDigest  string `json:"sourceDigest"`
	PayloadSHA256 string `json:"payloadSha256"`
	PayloadBytes  int64  `json:"payloadBytes"`
	GoVersion     string `json:"goVersion"`
}

func readFixture(path string) (*Fixture, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var fixture Fixture
	if err := json.Unmarshal(data, &fixture); err != nil {
		return nil, err
	}
	if fixture.Schema != FixtureSchema {
		return nil, fmt.Errorf("unsupported fixture schema: %q", fixture.Schema)
	}
	if fixture.TimeoutMS <= 0 {
		fixture.TimeoutMS = 2000
	}
	return &fixture, nil
}

func runFixture(payload string, fixture *Fixture) *FixtureResult {
	timeout := time.Duration(fixture.TimeoutMS) * time.Millisecond
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, payload, fixture.Args...)
	cmd.Stdin = strings.NewReader(fixture.Stdin)
	cmd.Env = []string{"PATH=", "LANG=C", "LC_ALL=C", "TZ=UTC", "HOME=/nonexistent"}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	exitCode := 0
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			exitCode = exitErr.ExitCode()
		} else if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return &FixtureResult{Status: "FAIL", Stdout: stdout.String(), Stderr: stderr.String(), ExitCode: -1, Error: "timeout"}
		} else {
			return &FixtureResult{Status: "FAIL", Stdout: stdout.String(), Stderr: stderr.String(), ExitCode: -1, Error: err.Error()}
		}
	}
	result := &FixtureResult{Status: "PASS", Stdout: stdout.String(), Stderr: stderr.String(), ExitCode: exitCode}
	if result.Stdout != fixture.Stdout || result.Stderr != fixture.Stderr || result.ExitCode != fixture.ExitCode {
		result.Status = "FAIL"
		result.Error = "fixture mismatch"
	}
	return result
}

func buildCapability(root, id, at, capDir string) (ImplementationClaim, bool) {
	at = filepath.ToSlash(filepath.Clean(at))
	impl := ImplementationClaim{
		Schema: ImplementationSchema, ID: id, At: at, Language: "Go", Kind: "native", Target: "linux-amd64-static", BuildStatus: "FAIL",
	}
	fixture, err := readFixture(filepath.Join(capDir, "fixture.json"))
	if err != nil {
		impl.Error = "fixture: " + err.Error()
		return impl, false
	}
	impl.Fixture = fixture
	projectionSpec, err := readProjectionSpec(filepath.Join(capDir, "projection.json"))
	if err != nil {
		impl.Error = "projection spec: " + err.Error()
		return impl, false
	}
	_, exclusions, err := projectionInputs(root, capDir, projectionSpec)
	if err != nil {
		impl.Error = "projection input: " + err.Error()
		return impl, false
	}
	buildContract := nativeBuildContract + ";" + runtime.Version()
	digest, err := sourceDigest(root, capDir, buildContract, exclusions)
	if err != nil {
		impl.Error = "source digest: " + err.Error()
		return impl, false
	}
	impl.SourceDigest = digest
	cacheDir := filepath.Join(root, ".capforge", "cache", "native-linux-amd64", digest)
	payload := filepath.Join(cacheDir, "payload")
	metaPath := filepath.Join(cacheDir, "meta.json")
	cacheState := "built"
	reused := false
	if metaData, err := os.ReadFile(metaPath); err == nil {
		var meta cacheMeta
		if json.Unmarshal(metaData, &meta) == nil && meta.SourceDigest == digest {
			if sha, size, err := fileSHA(payload); err == nil && sha == meta.PayloadSHA256 && size == meta.PayloadBytes {
				reused = true
				cacheState = "reused"
			}
		}
	}
	if !reused {
		if err := os.MkdirAll(cacheDir, 0o755); err != nil {
			impl.Error = err.Error()
			return impl, false
		}
		tmp := payload + ".tmp"
		_ = os.Remove(tmp)
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		cmd := exec.CommandContext(ctx, "go", "build", "-trimpath", "-buildvcs=false", "-ldflags=-s -w -buildid=", "-o", tmp, "./"+filepath.ToSlash(at))
		cmd.Dir = root
		cmd.Env = append(os.Environ(), "CGO_ENABLED=0", "GOOS=linux", "GOARCH=amd64", "SOURCE_DATE_EPOCH=0")
		output, err := cmd.CombinedOutput()
		cancel()
		if err != nil {
			impl.Error = fmt.Sprintf("go build: %v: %s", err, strings.TrimSpace(string(output)))
			return impl, false
		}
		if err := os.Chmod(tmp, 0o755); err != nil {
			impl.Error = err.Error()
			return impl, false
		}
		if err := os.Rename(tmp, payload); err != nil {
			impl.Error = err.Error()
			return impl, false
		}
		sha, size, err := fileSHA(payload)
		if err != nil {
			impl.Error = err.Error()
			return impl, false
		}
		meta := cacheMeta{Schema: "capforge-cache/1", SourceDigest: digest, PayloadSHA256: sha, PayloadBytes: size, GoVersion: runtime.Version()}
		if err := writeJSON(metaPath, meta); err != nil {
			impl.Error = err.Error()
			return impl, false
		}
	}
	sha, size, err := fileSHA(payload)
	if err != nil {
		impl.Error = err.Error()
		return impl, reused
	}
	impl.PayloadSHA256 = sha
	impl.PayloadBytes = size
	impl.Cache = cacheState
	impl.BuildStatus = "PASS"
	impl.FixtureResult = runFixture(payload, fixture)
	if impl.FixtureResult.Status != "PASS" {
		impl.BuildStatus = "FAIL"
		impl.Error = impl.FixtureResult.Error
	}
	return impl, reused
}

func systemImplementation(id string, payload []byte, kind, target, rawPath string, fixture *Fixture, fixtureResult *FixtureResult) ImplementationClaim {
	return ImplementationClaim{
		Schema: ImplementationSchema, ID: id, At: "system://" + id, Language: "Go", Kind: kind, Target: target,
		SourceDigest: shaHex(payload), PayloadSHA256: shaHex(payload), PayloadBytes: int64(len(payload)), RawPath: rawPath,
		BuildStatus: "PASS", Fixture: fixture, FixtureResult: fixtureResult, Cache: "embedded",
	}
}

func writeCarrier(dist string, impl *ImplementationClaim, payload []byte) error {
	if impl.PayloadSHA256 == "" {
		return errors.New("missing payload SHA-256")
	}
	rel := filepath.ToSlash(filepath.Join("cap", ProtocolVersion, impl.Kind, impl.Target, impl.PayloadSHA256+".b64.txt"))
	carrier := base64.StdEncoding.EncodeToString(payload)
	if err := writeFile(filepath.Join(dist, filepath.FromSlash(rel)), []byte(carrier), 0o644); err != nil {
		return err
	}
	impl.CarrierPath = "./" + rel
	return nil
}

func sortedImplementationValues(values map[string]ImplementationClaim) []ImplementationClaim {
	ids := make([]string, 0, len(values))
	for id := range values {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]ImplementationClaim, 0, len(ids))
	for _, id := range ids {
		out = append(out, values[id])
	}
	return out
}

func cachedPayloadPath(root, sourceDigest string) string {
	return filepath.Join(root, ".capforge", "cache", "native-linux-amd64", sourceDigest, "payload")
}

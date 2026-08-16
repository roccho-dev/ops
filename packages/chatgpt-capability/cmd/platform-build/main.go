package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

type receipt struct {
	Schema         string `json:"schema"`
	Status         string `json:"status"`
	GoVersion      string `json:"goVersion"`
	SearchBytes    int    `json:"searchBytes"`
	SearchSHA256   string `json:"searchSha256"`
	CapforgeBytes  int    `json:"capforgeBytes"`
	CapforgeSHA256 string `json:"capforgeSha256"`
	Reproducible   bool   `json:"reproducible"`
}

func main() {
	root, err := os.Getwd()
	must(err)
	build := filepath.Join(root, "build", "platform")
	must(os.RemoveAll(build))
	must(os.MkdirAll(build, 0o755))

	searchA := filepath.Join(build, "search-a.wasm")
	searchB := filepath.Join(build, "search-b.wasm")
	buildGo(root, searchA, []string{"build", "-trimpath", "-buildvcs=false", "-ldflags=-s -w -buildid=", "-o", searchA, "./cmd/registry-search"}, map[string]string{"GOOS": "js", "GOARCH": "wasm", "SOURCE_DATE_EPOCH": "0"})
	buildGo(root, searchB, []string{"build", "-trimpath", "-buildvcs=false", "-ldflags=-s -w -buildid=", "-o", searchB, "./cmd/registry-search"}, map[string]string{"GOOS": "js", "GOARCH": "wasm", "SOURCE_DATE_EPOCH": "0"})
	searchBytesA := read(searchA)
	searchBytesB := read(searchB)
	if !bytes.Equal(searchBytesA, searchBytesB) {
		panic("registry-search.wasm is not reproducible")
	}
	assetSearch := filepath.Join(root, "internal", "forge", "assets", "runtime", "registry-search.wasm")
	must(os.WriteFile(assetSearch, searchBytesA, 0o644))
	goroot := runText(root, nil, "go", "env", "GOROOT")
	wasmExec := filepath.Join(goroot, "misc", "wasm", "wasm_exec.js")
	must(copyFile(wasmExec, filepath.Join(root, "internal", "forge", "assets", "runtime", "wasm_exec.js")))

	capA := filepath.Join(build, "capforge-a")
	capB := filepath.Join(build, "capforge-b")
	buildGo(root, capA, []string{"build", "-trimpath", "-buildvcs=false", "-ldflags=-s -w -buildid=", "-o", capA, "./cmd/capforge"}, map[string]string{"CGO_ENABLED": "0", "GOOS": "linux", "GOARCH": "amd64", "SOURCE_DATE_EPOCH": "0"})
	buildGo(root, capB, []string{"build", "-trimpath", "-buildvcs=false", "-ldflags=-s -w -buildid=", "-o", capB, "./cmd/capforge"}, map[string]string{"CGO_ENABLED": "0", "GOOS": "linux", "GOARCH": "amd64", "SOURCE_DATE_EPOCH": "0"})
	capBytesA := read(capA)
	capBytesB := read(capB)
	if !bytes.Equal(capBytesA, capBytesB) {
		panic("capforge is not reproducible")
	}
	finalCap := filepath.Join(root, "build", "capforge-linux-amd64")
	must(os.WriteFile(finalCap, capBytesA, 0o755))

	r := receipt{
		Schema: "capforge-platform-build/1", Status: "PASS", GoVersion: runtime.Version(),
		SearchBytes: len(searchBytesA), SearchSHA256: sha(searchBytesA), CapforgeBytes: len(capBytesA), CapforgeSHA256: sha(capBytesA), Reproducible: true,
	}
	data, _ := json.MarshalIndent(r, "", "  ")
	data = append(data, '\n')
	must(os.WriteFile(filepath.Join(root, "build", "platform-build.json"), data, 0o644))
	fmt.Print(string(data))
}

func buildGo(root, output string, args []string, env map[string]string) {
	cmd := exec.Command("go", args...)
	cmd.Dir = root
	cmd.Env = os.Environ()
	for key, value := range env {
		cmd.Env = append(cmd.Env, key+"="+value)
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		panic(fmt.Sprintf("go %v failed: %v\n%s", args, err, out))
	}
	must(os.Chmod(output, 0o755))
}

func runText(root string, env []string, name string, args ...string) string {
	cmd := exec.Command(name, args...)
	cmd.Dir = root
	cmd.Env = append(os.Environ(), env...)
	out, err := cmd.Output()
	must(err)
	return string(bytes.TrimSpace(out))
}

func read(path string) []byte {
	data, err := os.ReadFile(path)
	must(err)
	return data
}

func copyFile(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, data, 0o644)
}

func sha(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}

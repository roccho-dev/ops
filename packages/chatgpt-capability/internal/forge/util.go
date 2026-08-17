package forge

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

var idPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`)

func validID(id string) bool { return idPattern.MatchString(id) }

func shaHex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func fileSHA(path string) (string, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(h, f)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}

func writeFile(path string, data []byte, mode fs.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, data, mode)
}

func writeJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return writeFile(path, data, 0o644)
}

func writeJSONL(path string, values []any) error {
	var out bytes.Buffer
	enc := json.NewEncoder(&out)
	enc.SetEscapeHTML(false)
	for _, value := range values {
		if err := enc.Encode(value); err != nil {
			return err
		}
	}
	return writeFile(path, out.Bytes(), 0o644)
}

func strictBase64Decode(text string) ([]byte, error) {
	if strings.TrimSpace(text) != text || strings.ContainsAny(text, "\r\n\t ") {
		return nil, errors.New("carrier contains forbidden whitespace")
	}
	decoded, err := base64.StdEncoding.Strict().DecodeString(text)
	if err != nil {
		return nil, fmt.Errorf("decode carrier: %w", err)
	}
	if base64.StdEncoding.EncodeToString(decoded) != text {
		return nil, errors.New("carrier is not canonical standard Base64")
	}
	return decoded, nil
}

func pathWithin(root, target string) bool {
	r, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	t, err := filepath.Abs(target)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(r, t)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func sortedFiles(root string, include func(path string, d fs.DirEntry) bool) ([]string, error) {
	var paths []string
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == root {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		if d.IsDir() {
			if rel == "dist" || rel == ".git" || strings.HasPrefix(rel, "dist"+string(filepath.Separator)) || strings.HasPrefix(rel, ".git"+string(filepath.Separator)) {
				return filepath.SkipDir
			}
			return nil
		}
		if include == nil || include(path, d) {
			paths = append(paths, path)
		}
		return nil
	})
	sort.Strings(paths)
	return paths, err
}

func sourceDigest(root, capabilityDir string, buildContract string, exclusions map[string]struct{}) (string, error) {
	h := sha256.New()
	_, _ = io.WriteString(h, "capforge-source-v1\n")
	_, _ = io.WriteString(h, buildContract)
	_, _ = io.WriteString(h, "\n")
	for _, base := range []string{"go.mod", "go.sum"} {
		path := filepath.Join(root, base)
		if data, err := os.ReadFile(path); err == nil {
			_, _ = io.WriteString(h, base+"\x00")
			_, _ = h.Write(data)
			_, _ = io.WriteString(h, "\x00")
		}
	}
	paths, err := sortedFiles(capabilityDir, func(path string, d fs.DirEntry) bool {
		name := d.Name()
		if strings.HasPrefix(name, ".") {
			return false
		}
		rel, err := filepath.Rel(capabilityDir, path)
		if err != nil {
			return false
		}
		_, excluded := exclusions[filepath.ToSlash(rel)]
		return !excluded
	})
	if err != nil {
		return "", err
	}
	for _, path := range paths {
		rel, err := filepath.Rel(capabilityDir, path)
		if err != nil {
			return "", err
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return "", err
		}
		_, _ = io.WriteString(h, filepath.ToSlash(rel)+"\x00")
		_, _ = h.Write(data)
		_, _ = io.WriteString(h, "\x00")
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func readJSONLFile[T any](path string) ([]T, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	var values []T
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	line := 0
	for scanner.Scan() {
		line++
		text := strings.TrimSpace(scanner.Text())
		if text == "" {
			continue
		}
		var value T
		if err := json.Unmarshal([]byte(text), &value); err != nil {
			return nil, fmt.Errorf("%s:%d: %w", path, line, err)
		}
		values = append(values, value)
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return values, nil
}

func copyFile(src, dst string, mode fs.FileMode) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return writeFile(dst, data, mode)
}

func normalizeAt(id, at string) string {
	if at == "" {
		return filepath.ToSlash(filepath.Join("capabilities", id))
	}
	if strings.Contains(at, "://") {
		return at
	}
	return filepath.ToSlash(filepath.Clean(at))
}

func nowFixed() time.Time { return time.Unix(0, 0).UTC() }

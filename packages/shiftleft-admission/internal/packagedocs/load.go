package packagedocs

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func readCatalog(path string) (map[string]CatalogEntry, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	s := bufio.NewScanner(bytes.NewReader(data))
	s.Buffer(make([]byte, 1024), 4*1024*1024)
	out := map[string]CatalogEntry{}
	for line := 1; s.Scan(); line++ {
		raw := bytes.TrimSpace(s.Bytes())
		if len(raw) == 0 {
			continue
		}
		var v CatalogEntry
		if err := json.Unmarshal(raw, &v); err != nil {
			return nil, fmt.Errorf("catalog line %d: %w", line, err)
		}
		if v.Name == "" {
			return nil, fmt.Errorf("catalog line %d: name required", line)
		}
		if _, ok := out[v.Name]; ok {
			return nil, fmt.Errorf("duplicate catalog package: %s", v.Name)
		}
		out[v.Name] = v
	}
	if err := s.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func readContract(path string) (PackageContract, []byte, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return PackageContract{}, nil, err
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var c PackageContract
	if err := dec.Decode(&c); err != nil {
		return PackageContract{}, data, err
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		if err == nil {
			return PackageContract{}, data, fmt.Errorf("trailing JSON")
		}
		return PackageContract{}, data, err
	}
	return c, data, nil
}

func findContracts(repo string) ([]string, error) {
	paths := []string{}
	root := filepath.Join(repo, "packages")
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		p := filepath.Join(root, e.Name(), "package.contract.json")
		if st, err := os.Stat(p); err == nil && st.Mode().IsRegular() {
			paths = append(paths, p)
		}
	}
	sort.Strings(paths)
	return paths, nil
}

func setSurfaceRoot(m SurfaceRoots, v string) error {
	name, path, ok := strings.Cut(v, "=")
	if !ok || strings.TrimSpace(name) == "" || strings.TrimSpace(path) == "" {
		return fmt.Errorf("surface must be name=path")
	}
	if _, exists := m[name]; exists {
		return fmt.Errorf("duplicate surface: %s", name)
	}
	m[name] = path
	return nil
}

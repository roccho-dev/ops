package artifacts

import (
	"bytes"
	"os"
	"path/filepath"
	"sort"
)

func ArtifactHashes(outdir string) map[string]string {
	hashes := map[string]string{}
	filepath.WalkDir(outdir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || d.Name() == "manifest.json" {
			return nil
		}
		rel, _ := filepath.Rel(outdir, path)
		rel = filepath.ToSlash(rel)
		if h, err := HashFile(path); err == nil {
			hashes[rel] = h
		}
		return nil
	})
	return hashes
}

func CompareDirs(a, b string) []string {
	aset := fileSet(a)
	bset := fileSet(b)
	m := map[string]bool{}
	for k := range aset {
		m[k] = true
	}
	for k := range bset {
		m[k] = true
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	diffs := []string{}
	for _, rel := range keys {
		_, aok := aset[rel]
		_, bok := bset[rel]
		switch {
		case !aok:
			diffs = append(diffs, "missing in current: "+rel)
		case !bok:
			diffs = append(diffs, "extra in current: "+rel)
		default:
			ab, _ := os.ReadFile(filepath.Join(a, filepath.FromSlash(rel)))
			bb, _ := os.ReadFile(filepath.Join(b, filepath.FromSlash(rel)))
			if !bytes.Equal(ab, bb) {
				diffs = append(diffs, "changed: "+rel)
			}
		}
	}
	return diffs
}

func fileSet(root string) map[string]bool {
	out := map[string]bool{}
	filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			rel, _ := filepath.Rel(root, path)
			out[filepath.ToSlash(rel)] = true
		}
		return nil
	})
	return out
}

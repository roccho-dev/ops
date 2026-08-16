package forge

import (
	"archive/zip"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func sourceArchiveFiles(root string) ([]string, error) {
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
		rel = filepath.ToSlash(rel)
		if d.IsDir() {
			if rel == ".git" || rel == "dist" || rel == "build" || rel == ".capforge/tmp" || strings.HasPrefix(rel, ".git/") || strings.HasPrefix(rel, "dist/") || strings.HasPrefix(rel, "build/") || strings.HasPrefix(rel, ".capforge/tmp/") {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasSuffix(rel, ".zip") && strings.Contains(rel, "source-kit") {
			return nil
		}
		paths = append(paths, path)
		return nil
	})
	sort.Strings(paths)
	return paths, err
}

func writeSourceZip(root, destination string) error {
	paths, err := sourceArchiveFiles(root)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return err
	}
	file, err := os.Create(destination)
	if err != nil {
		return err
	}
	archive := zip.NewWriter(file)
	fixed := time.Date(1980, 1, 1, 0, 0, 0, 0, time.UTC)
	for _, path := range paths {
		info, err := os.Stat(path)
		if err != nil {
			archive.Close()
			file.Close()
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			archive.Close()
			file.Close()
			return err
		}
		header, err := zip.FileInfoHeader(info)
		if err != nil {
			archive.Close()
			file.Close()
			return err
		}
		header.Name = filepath.ToSlash(rel)
		header.Method = zip.Deflate
		header.Modified = fixed
		header.SetMode(info.Mode())
		writer, err := archive.CreateHeader(header)
		if err != nil {
			archive.Close()
			file.Close()
			return err
		}
		data, err := os.ReadFile(path)
		if err != nil {
			archive.Close()
			file.Close()
			return err
		}
		if _, err := writer.Write(data); err != nil {
			archive.Close()
			file.Close()
			return err
		}
	}
	if err := archive.Close(); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if info, err := os.Stat(destination); err != nil || info.Size() == 0 {
		return fmt.Errorf("empty source archive")
	}
	return nil
}

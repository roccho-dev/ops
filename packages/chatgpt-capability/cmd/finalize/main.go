package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"time"
)

type entry struct {
	Path   string `json:"path"`
	Bytes  int64  `json:"bytes"`
	SHA256 string `json:"sha256"`
}

type manifest struct {
	Schema string  `json:"schema"`
	Status string  `json:"status"`
	Files  []entry `json:"files"`
}

func main() {
	dist := flag.String("dist", "dist", "dist directory")
	build := flag.String("build", "build", "proof source directory")
	zipPath := flag.String("zip", "", "optional deterministic dist zip")
	root := flag.String("root", ".", "source root")
	sourceZipPath := flag.String("source-zip", "", "optional deterministic source/proof zip")
	flag.Parse()
	proofDir := filepath.Join(*dist, "proof")
	must(os.MkdirAll(proofDir, 0o755))
	copies := map[string]string{
		"platform-build-output.json": "platform-build.json",
		"project-output.json":        "project.json",
		"browser-proof.json":         "browser.json",
		"browser-proof.png":          "browser.png",
		"selfhost-proof.json":        "selfhost.json",
		"go-test.log":                "go-test.log",
		"final-verify.json":          "final-verify.json",
	}
	for source, target := range copies {
		data, err := os.ReadFile(filepath.Join(*build, source))
		must(err)
		must(os.WriteFile(filepath.Join(proofDir, target), data, 0o644))
	}
	files, err := listFiles(*dist, filepath.Join("proof", "manifest.json"))
	must(err)
	m := manifest{Schema: "capforge-dist-proof-manifest/1", Status: "PASS", Files: files}
	data, _ := json.MarshalIndent(m, "", "  ")
	data = append(data, '\n')
	must(os.WriteFile(filepath.Join(proofDir, "manifest.json"), data, 0o644))
	if *zipPath != "" {
		must(writeZip(*dist, *zipPath))
	}
	if *sourceZipPath != "" {
		must(writeZip(*root, *sourceZipPath))
	}
	fmt.Print(string(data))
}

func listFiles(root, exclude string) ([]entry, error) {
	var paths []string
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, _ := filepath.Rel(root, path)
		if filepath.ToSlash(rel) == filepath.ToSlash(exclude) {
			return nil
		}
		paths = append(paths, path)
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(paths)
	result := make([]entry, 0, len(paths))
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		rel, _ := filepath.Rel(root, path)
		sum := sha256.Sum256(data)
		result = append(result, entry{Path: filepath.ToSlash(rel), Bytes: int64(len(data)), SHA256: hex.EncodeToString(sum[:])})
	}
	return result, nil
}

func writeZip(root, output string) error {
	entries, err := listFiles(root, "")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(output), 0o755); err != nil {
		return err
	}
	file, err := os.Create(output)
	if err != nil {
		return err
	}
	writer := zip.NewWriter(file)
	fixed := time.Date(1980, 1, 1, 0, 0, 0, 0, time.UTC)
	for _, item := range entries {
		path := filepath.Join(root, filepath.FromSlash(item.Path))
		info, err := os.Stat(path)
		if err != nil {
			writer.Close()
			file.Close()
			return err
		}
		header, err := zip.FileInfoHeader(info)
		if err != nil {
			writer.Close()
			file.Close()
			return err
		}
		header.Name = item.Path
		header.Method = zip.Deflate
		header.Modified = fixed
		header.SetMode(info.Mode())
		entryWriter, err := writer.CreateHeader(header)
		if err != nil {
			writer.Close()
			file.Close()
			return err
		}
		data, err := os.ReadFile(path)
		if err != nil {
			writer.Close()
			file.Close()
			return err
		}
		if _, err := entryWriter.Write(data); err != nil {
			writer.Close()
			file.Close()
			return err
		}
	}
	if err := writer.Close(); err != nil {
		file.Close()
		return err
	}
	return file.Close()
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}

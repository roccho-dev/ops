package partition

import (
	"bufio"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	validate "cueappendcontract/internal/core/validate"
)

func Partition(ledger, out string, chunk int) (map[string]any, error) {
	if chunk <= 0 {
		chunk = 50000
	}
	if err := os.RemoveAll(out); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(out, 0755); err != nil {
		return nil, err
	}
	ledgerHash, _ := validate.HashFile(ledger)
	manifest := map[string]any{"ledger": ledger, "ledger_sha256": ledgerHash, "chunk_lines": chunk, "partitions": []map[string]any{}}
	r, err := validate.OpenText(ledger)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 1024*1024), 64*1024*1024)
	partNo := 0
	buf := []string{}
	total := 0
	flush := func() error {
		if len(buf) == 0 {
			return nil
		}
		name := fmt.Sprintf("part_%05d.jsonl.gz", partNo)
		p := filepath.Join(out, name)
		f, err := os.Create(p)
		if err != nil {
			return err
		}
		gz := gzip.NewWriter(f)
		gz.ModTime = time.Unix(0, 0)
		for _, l := range buf {
			_, _ = gz.Write([]byte(l))
		}
		if err := gz.Close(); err != nil {
			_ = f.Close()
			return err
		}
		if err := f.Close(); err != nil {
			return err
		}
		h, _ := validate.HashFile(p)
		manifest["partitions"] = append(manifest["partitions"].([]map[string]any), map[string]any{"path": name, "lines": len(buf), "sha256": h})
		partNo++
		buf = []string{}
		return nil
	}
	for scanner.Scan() {
		total++
		buf = append(buf, scanner.Text()+"\n")
		if len(buf) >= chunk {
			if err := flush(); err != nil {
				return nil, err
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if err := flush(); err != nil {
		return nil, err
	}
	manifest["total_lines"] = total
	if err := validate.WriteJSON(filepath.Join(out, "partition_manifest.json"), manifest); err != nil {
		return nil, err
	}
	return map[string]any{"status": "pass", "check": "partition", "partitions": len(manifest["partitions"].([]map[string]any)), "total_lines": total}, nil
}

func VerifyPartition(out string) (map[string]any, error) {
	b, err := os.ReadFile(filepath.Join(out, "partition_manifest.json"))
	if err != nil {
		return nil, err
	}
	var m struct {
		TotalLines int `json:"total_lines"`
		Partitions []struct {
			Path   string `json:"path"`
			Lines  int    `json:"lines"`
			SHA256 string `json:"sha256"`
		} `json:"partitions"`
	}
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	total := 0
	errors := []string{}
	for _, p := range m.Partitions {
		path := filepath.Join(out, p.Path)
		if _, err := os.Stat(path); err != nil {
			errors = append(errors, "missing partition "+path)
			continue
		}
		if h, _ := validate.HashFile(path); h != p.SHA256 {
			errors = append(errors, "hash mismatch "+p.Path)
		}
		total += p.Lines
	}
	if total != m.TotalLines {
		errors = append(errors, "line total mismatch")
	}
	if len(errors) > 0 {
		return nil, fmt.Errorf("partition verify failed: %s", strings.Join(errors, "; "))
	}
	return map[string]any{"status": "pass", "check": "partition-verify", "total_lines": total, "partitions": len(m.Partitions)}, nil
}

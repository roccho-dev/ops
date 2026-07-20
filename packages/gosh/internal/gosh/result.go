package gosh

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash"
	"os"
	"path/filepath"
	"sort"
	"sync"
)

type evidenceWriter struct {
	mu    sync.Mutex
	limit int
	buf   []byte
	hash  hash.Hash
	bytes int64
}

func newEvidenceWriter(limit int) *evidenceWriter {
	return &evidenceWriter{limit: limit, hash: sha256.New()}
}

func (w *evidenceWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	_, _ = w.hash.Write(p)
	w.bytes += int64(len(p))
	if len(w.buf) < w.limit {
		take := w.limit - len(w.buf)
		if take > len(p) {
			take = len(p)
		}
		w.buf = append(w.buf, p[:take]...)
	}
	return len(p), nil
}

func (w *evidenceWriter) Evidence() StreamEvidence {
	w.mu.Lock()
	defer w.mu.Unlock()
	return StreamEvidence{
		Bytes:     w.bytes,
		SHA256:    hex.EncodeToString(w.hash.Sum(nil)),
		Captured:  string(w.buf),
		Truncated: w.bytes > int64(len(w.buf)),
	}
}

func AppendResult(path string, result RunResult) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return fmt.Errorf("result dir: %w", err)
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return fmt.Errorf("open result: %w", err)
	}
	defer file.Close()
	row, err := json.Marshal(result)
	if err != nil {
		return err
	}
	if _, err = file.Write(append(row, '\n')); err != nil {
		return fmt.Errorf("append result: %w", err)
	}
	if err = file.Sync(); err != nil {
		return fmt.Errorf("sync result: %w", err)
	}
	return nil
}

func ReadResults(path string) ([]RunResult, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 4096), 4<<20)
	var results []RunResult
	for scanner.Scan() {
		var result RunResult
		if err := json.Unmarshal(scanner.Bytes(), &result); err != nil {
			return nil, err
		}
		results = append(results, result)
	}
	return results, scanner.Err()
}

func SafeEnvKeys(env map[string]string) []string {
	keys := make([]string, 0, len(env))
	for key := range env {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

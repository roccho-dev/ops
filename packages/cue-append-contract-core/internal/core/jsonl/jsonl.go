package jsonl

import (
	"bufio"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"cueappendcontract/internal/core/contract"
)

// Open opens plain JSONL or .gz JSONL as a text stream.
func Open(path string) (io.ReadCloser, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	if strings.HasSuffix(path, ".gz") {
		gz, err := gzip.NewReader(f)
		if err != nil {
			_ = f.Close()
			return nil, err
		}
		return &compoundReadCloser{Reader: gz, closers: []io.Closer{gz, f}}, nil
	}
	return f, nil
}

// ReadAll reads a JSONL ledger into contract events and annotates each row with
// __line__ for diagnostics.  Streaming validators can build on Open directly.
func ReadAll(path string) ([]contract.Event, error) {
	r, err := Open(path)
	if err != nil {
		return nil, err
	}
	defer r.Close()

	s := bufio.NewScanner(r)
	s.Buffer(make([]byte, 0, 1024*1024), 64*1024*1024)
	var rows []contract.Event
	line := 0
	for s.Scan() {
		line++
		txt := strings.TrimSpace(s.Text())
		if txt == "" {
			continue
		}
		var ev contract.Event
		if err := json.Unmarshal([]byte(txt), &ev); err != nil {
			return nil, fmt.Errorf("%s:%d: invalid JSON: %w", path, line, err)
		}
		ev["__line__"] = line
		rows = append(rows, ev)
	}
	if err := s.Err(); err != nil {
		return nil, err
	}
	return rows, nil
}

type compoundReadCloser struct {
	io.Reader
	closers []io.Closer
}

func (c *compoundReadCloser) Close() error {
	var first error
	for _, closer := range c.closers {
		if err := closer.Close(); err != nil && first == nil {
			first = err
		}
	}
	return first
}

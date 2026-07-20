package gosh

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type Layout struct{ Root, Dir, Events, Results, ToolsCache, Snippets, Bin string }

func Paths(root string) Layout {
	d := filepath.Join(root, ".gosh")
	return Layout{Root: root, Dir: d, Events: filepath.Join(d, "events.jsonl"), Results: filepath.Join(d, "result.jsonl"), ToolsCache: filepath.Join(d, "cache", "tools.json"), Snippets: filepath.Join(d, "cache", "snippets"), Bin: filepath.Join(d, "bin")}
}
func Init(root string) error {
	p := Paths(root)
	for _, d := range []string{p.Dir, filepath.Dir(p.ToolsCache), p.Snippets} {
		if err := os.MkdirAll(d, 0700); err != nil {
			return err
		}
	}
	for _, f := range []string{p.Events, p.Results} {
		h, err := os.OpenFile(f, os.O_CREATE|os.O_WRONLY, 0600)
		if err != nil {
			return err
		}
		if err = h.Close(); err != nil {
			return err
		}
	}
	return nil
}
func AppendEvent(path string, ev Event) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	b, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	if _, err = f.Write(append(b, '\n')); err != nil {
		return err
	}
	return f.Sync()
}
func LoadRoot(root string) (State, error) {
	p := Paths(root)
	f, err := os.Open(p.Events)
	if err != nil {
		return State{}, fmt.Errorf("open events: %w", err)
	}
	defer f.Close()
	return LoadState(f)
}

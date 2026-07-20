package gosh

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

type fakeNix struct {
	outs []string
	err  error
}

func (f fakeNix) Resolve(context.Context, string) ([]string, error) { return f.outs, f.err }
func TestResolverBackends(t *testing.T) {
	dir := t.TempDir()
	bin := filepath.Join(dir, "bin")
	if runtime.GOOS == "windows" {
		bin += ".exe"
	}
	if err := os.WriteFile(bin, []byte("x"), 0700); err != nil {
		t.Fatal(err)
	}
	r := Resolver{Nix: fakeNix{outs: []string{dir}}}
	got, err := r.Resolve(context.Background(), Tool{ID: "x", Resolver: "nix", Installable: "nixpkgs#x", ProgramRel: filepath.Base(bin)})
	if err != nil {
		t.Fatal(err)
	}
	if got.ProgramAbs != bin {
		t.Fatalf("%q", got.ProgramAbs)
	}
	if _, err = r.Resolve(context.Background(), Tool{ID: "x", Resolver: "nix", Installable: "x", ProgramRel: "../escape"}); err == nil {
		t.Fatal("path escape accepted")
	}
	r.Nix = fakeNix{outs: []string{dir, dir}}
	if _, err = r.Resolve(context.Background(), Tool{ID: "x", Resolver: "nix", Installable: "x", ProgramRel: filepath.Base(bin)}); err == nil {
		t.Fatal("ambiguous outputs accepted")
	}
}

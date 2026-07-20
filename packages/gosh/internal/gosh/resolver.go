package gosh

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

type NixOutputResolver interface {
	Resolve(context.Context, string) ([]string, error)
}

type Resolver struct{ Nix NixOutputResolver }

func (r Resolver) Resolve(ctx context.Context, tool Tool) (ResolvedTool, error) {
	switch tool.Resolver {
	case "absolute":
		p, err := validateExecutable(tool.ProgramAbs)
		if err != nil {
			return ResolvedTool{}, fmt.Errorf("tool %s: %w", tool.ID, err)
		}
		return resolved(tool.ID, "absolute", "", p), nil
	case "nix":
		if r.Nix == nil {
			return ResolvedTool{}, fmt.Errorf("tool %s: nix resolver unavailable", tool.ID)
		}
		outs, err := r.Nix.Resolve(ctx, tool.Installable)
		if err != nil {
			return ResolvedTool{}, fmt.Errorf("tool %s nix resolve: %w", tool.ID, err)
		}
		if len(outs) != 1 {
			return ResolvedTool{}, fmt.Errorf("tool %s: expected exactly one nix output, got %d", tool.ID, len(outs))
		}
		out, err := filepath.Abs(filepath.Clean(outs[0]))
		if err != nil {
			return ResolvedTool{}, err
		}
		rel := filepath.Clean(tool.ProgramRel)
		if filepath.IsAbs(rel) || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return ResolvedTool{}, fmt.Errorf("tool %s: programRel escapes output", tool.ID)
		}
		p := filepath.Join(out, rel)
		relCheck, err := filepath.Rel(out, p)
		if err != nil || relCheck == ".." || strings.HasPrefix(relCheck, ".."+string(filepath.Separator)) {
			return ResolvedTool{}, fmt.Errorf("tool %s: resolved path escapes output", tool.ID)
		}
		p, err = validateExecutable(p)
		if err != nil {
			return ResolvedTool{}, fmt.Errorf("tool %s: %w", tool.ID, err)
		}
		return resolved(tool.ID, "nix", out, p), nil
	default:
		return ResolvedTool{}, fmt.Errorf("tool %s: unsupported resolver %q", tool.ID, tool.Resolver)
	}
}

func validateExecutable(p string) (string, error) {
	if !filepath.IsAbs(p) {
		return "", fmt.Errorf("program path is not absolute")
	}
	clean, err := filepath.Abs(filepath.Clean(p))
	if err != nil {
		return "", err
	}
	st, err := os.Stat(clean)
	if err != nil {
		return "", fmt.Errorf("program unavailable: %w", err)
	}
	if st.IsDir() {
		return "", fmt.Errorf("program is a directory")
	}
	if runtime.GOOS != "windows" && st.Mode().Perm()&0111 == 0 {
		return "", fmt.Errorf("program is not executable")
	}
	return clean, nil
}
func resolved(id, backend, out, p string) ResolvedTool {
	h := sha256.Sum256([]byte(backend + "\x00" + out + "\x00" + p))
	result := ResolvedTool{ID: id, Backend: backend, OutPath: out, ProgramAbs: p, Fingerprint: hex.EncodeToString(h[:])}
	if file, err := os.Open(p); err == nil {
		defer file.Close()
		contentHash := sha256.New()
		if _, err := io.Copy(contentHash, file); err == nil {
			result.ExecutableSHA256 = hex.EncodeToString(contentHash.Sum(nil))
		}
	}
	return result
}

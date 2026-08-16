package forge

import (
	"embed"
	"fmt"
	"io/fs"
	"path"
)

// platformAssets are compiled once into capforge. Unchanged Capability projection
// therefore does not rebuild or redownload the human UI or search runtime.
//
//go:embed assets/web/* assets/runtime/*
var platformAssets embed.FS

func asset(name string) ([]byte, error) {
	clean := path.Clean(name)
	if clean == "." || clean == ".." || clean[0] == '/' {
		return nil, fmt.Errorf("invalid asset path: %s", name)
	}
	return fs.ReadFile(platformAssets, path.Join("assets", clean))
}

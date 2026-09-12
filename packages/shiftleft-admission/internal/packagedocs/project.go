package packagedocs

import (
	"fmt"
	"os"
	"path/filepath"
)

func Project(repo, ownerRoot string) error {
	contractPath := filepath.Join(repo, ownerRoot, "package.contract.json")
	c, _, err := readContract(contractPath)
	if err != nil {
		return err
	}
	if c.OwnerRoot != ownerRoot {
		return fmt.Errorf("ownerRoot mismatch: %s != %s", c.OwnerRoot, ownerRoot)
	}
	for _, d := range c.Documents {
		if d.Kind != "contract-projection" {
			continue
		}
		out := filepath.Join(repo, c.OwnerRoot, d.Path)
		if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(out, RenderContractMarkdown(c, d), 0o644); err != nil {
			return err
		}
	}
	return nil
}

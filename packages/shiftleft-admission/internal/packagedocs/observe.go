package packagedocs

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const version = "1"

func baseObservation(rule, profile, pkg, config string) Observation {
	toolDigest := shaDigest([]byte("package-docs-provider/1"))
	return Observation{Schema: ObservationSchema, RuleID: rule, ProfileID: profile, PackageID: pkg, Language: "language-neutral", Required: true, ConfigSHA256: config, Tool: ToolIdentity{Name: "package-docs", Version: version, AdapterSHA256: "builtin", Digest: toolDigest}, Evidence: []Evidence{}}
}

func finish(o Observation, status, code string, ev ...Evidence) Observation {
	o.Status = status
	o.FindingCode = code
	o.Evidence = append(o.Evidence, ev...)
	v, err := finalizeObservation(o)
	if err != nil {
		panic(err)
	}
	return v
}

func validateContract(c PackageContract, catalog CatalogEntry, contractPath string) []string {
	errs := []string{}
	if c.Schema != ContractSchema {
		errs = append(errs, "schema")
	}
	if strings.TrimSpace(c.PackageID) == "" || strings.TrimSpace(c.OwnerRoot) == "" || strings.TrimSpace(c.Kind) == "" || strings.TrimSpace(c.Responsibility) == "" {
		errs = append(errs, "identity")
	}
	if catalog.Name != c.PackageID {
		errs = append(errs, "catalog-name")
	}
	if filepath.ToSlash(filepath.Dir(contractPath)) != filepath.ToSlash(c.OwnerRoot) {
		errs = append(errs, "owner-root")
	}
	if !strings.HasPrefix(filepath.ToSlash(catalog.Entry), filepath.ToSlash(c.OwnerRoot)+"/") && filepath.ToSlash(catalog.Entry) != filepath.ToSlash(c.OwnerRoot) {
		errs = append(errs, "catalog-entry-owner")
	}
	if len(c.CurrentConsumers) == 0 {
		errs = append(errs, "current-consumers")
	}
	ids := map[string]bool{}
	for _, d := range c.Documents {
		if d.ID == "" || d.Path == "" || d.Title == "" || (d.Kind != "contract-projection" && d.Kind != "authored") {
			errs = append(errs, "document")
		}
		if ids[d.ID] {
			errs = append(errs, "duplicate-document")
		}
		ids[d.ID] = true
		clean := filepath.Clean(d.Path)
		if filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(filepath.ToSlash(clean), "../") {
			errs = append(errs, "document-path")
		}
	}
	return errs
}

func documentMap(c PackageContract) map[string]Document {
	m := map[string]Document{}
	for _, d := range c.Documents {
		m[d.ID] = d
	}
	return m
}

func runRoute(repo string, c PackageContract, r CommandRoute) ([]byte, error) {
	if len(r.Argv) == 0 {
		return nil, fmt.Errorf("empty argv")
	}
	cwd := filepath.Join(repo, c.OwnerRoot)
	if r.WorkDir != "" {
		cwd = filepath.Join(cwd, r.WorkDir)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, r.Argv[0], r.Argv[1:]...)
	cmd.Dir = cwd
	cmd.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + os.TempDir(), "LC_ALL=C", "NO_COLOR=1"}
	var out, errb bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errb
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("%v: %s", err, strings.TrimSpace(errb.String()))
	}
	return out.Bytes(), nil
}

func Observe(repo, catalogPath, baselineCatalogPath string, surfaces SurfaceRoots) ([]Observation, error) {
	catalog, err := readCatalog(catalogPath)
	if err != nil {
		return nil, err
	}
	paths, err := findContracts(repo)
	if err != nil {
		return nil, err
	}
	obs := []Observation{}
	manifestNames := map[string]bool{}
	for _, abs := range paths {
		if c, _, err := readContract(abs); err == nil && c.PackageID != "" {
			manifestNames[c.PackageID] = true
		}
	}
	if baselineCatalogPath != "" {
		baseline, err := readCatalog(baselineCatalogPath)
		if err != nil {
			return nil, err
		}
		names := make([]string, 0, len(catalog))
		for name := range catalog {
			names = append(names, name)
		}
		sort.Strings(names)
		for _, name := range names {
			if _, old := baseline[name]; old || manifestNames[name] {
				continue
			}
			raw, _ := json.Marshal(catalog[name])
			o := baseObservation(RuleIdentity, "package.docs.identity", name, shaDigest(raw))
			obs = append(obs, finish(o, "unmet", "new-package-contract-missing", Evidence{Kind: "catalog", Path: catalogPath, Detail: "new package requires packages/" + name + "/package.contract.json"}))
		}
	}
	for _, abs := range paths {
		rel, _ := filepath.Rel(repo, abs)
		owner := filepath.ToSlash(filepath.Dir(rel))
		c, raw, readErr := readContract(abs)
		pkg := filepath.Base(owner)
		if c.PackageID != "" {
			pkg = c.PackageID
		}
		config := shaDigest(raw)
		idO := baseObservation(RuleIdentity, "package.docs.identity", pkg, config)
		if readErr != nil {
			obs = append(obs, finish(idO, "unobserved", "package-contract-unreadable", Evidence{Kind: "contract", Path: filepath.ToSlash(rel), Detail: readErr.Error()}))
			continue
		}
		cat, ok := catalog[c.PackageID]
		if !ok {
			cat = CatalogEntry{}
		}
		errs := validateContract(c, cat, filepath.ToSlash(rel))
		if !ok {
			errs = append(errs, "catalog-missing")
		}
		if len(errs) > 0 {
			obs = append(obs, finish(idO, "unmet", "package-identity-invalid", Evidence{Kind: "contract", Path: filepath.ToSlash(rel), Detail: strings.Join(errs, ",")}))
		} else {
			obs = append(obs, finish(idO, "met", "package-identity-bound", Evidence{Kind: "catalog", Path: catalogPath, Detail: cat.Runtime + ":" + cat.Entry}, Evidence{Kind: "contract", Path: filepath.ToSlash(rel), Detail: c.OwnerRoot}))
		}

		docs := documentMap(c)
		projO := baseObservation(RuleProjection, "package.docs.projection", pkg, config)
		projectionErrors := []Evidence{}
		for _, d := range c.Documents {
			p := filepath.Join(repo, c.OwnerRoot, d.Path)
			actual, e := os.ReadFile(p)
			if e != nil {
				if d.Required {
					projectionErrors = append(projectionErrors, Evidence{Kind: "document", Path: filepath.ToSlash(filepath.Join(c.OwnerRoot, d.Path)), Detail: "missing"})
				}
				continue
			}
			if d.Kind == "contract-projection" {
				expected := RenderContractMarkdown(c, d)
				if !bytes.Equal(actual, expected) {
					projectionErrors = append(projectionErrors, Evidence{Kind: "document", Path: filepath.ToSlash(filepath.Join(c.OwnerRoot, d.Path)), Detail: "generated projection drift"})
				}
			}
		}
		if len(projectionErrors) > 0 {
			obs = append(obs, finish(projO, "unmet", "document-projection-drift", projectionErrors...))
		} else {
			obs = append(obs, finish(projO, "met", "document-projections-current", Evidence{Kind: "documents", Detail: fmt.Sprintf("%d declared documents", len(c.Documents))}))
		}

		discO := baseObservation(RuleDiscovery, "package.docs.discovery", pkg, config)
		discErr := []Evidence{}
		discUnobs := []Evidence{}
		for _, r := range append(append([]CommandRoute{}, c.DiscoverRoutes...), c.ContentRoutes...) {
			out, e := runRoute(repo, c, r)
			if e != nil {
				if r.Required {
					discUnobs = append(discUnobs, Evidence{Kind: "command", Detail: r.ID + ": " + e.Error()})
				}
				continue
			}
			for _, needle := range r.Contains {
				if !bytes.Contains(out, []byte(needle)) {
					discErr = append(discErr, Evidence{Kind: "command", Detail: r.ID + ": missing " + needle})
				}
			}
			if r.Document != "" {
				d, ok := docs[r.Document]
				if !ok {
					discErr = append(discErr, Evidence{Kind: "command", Detail: r.ID + ": unknown document"})
				} else {
					want, e := os.ReadFile(filepath.Join(repo, c.OwnerRoot, d.Path))
					if e != nil || !bytes.Equal(out, want) {
						discErr = append(discErr, Evidence{Kind: "command", Detail: r.ID + ": document byte mismatch"})
					}
				}
			}
		}
		if len(discUnobs) > 0 {
			obs = append(obs, finish(discO, "unobserved", "required-discovery-unobserved", discUnobs...))
		} else if len(discErr) > 0 {
			obs = append(obs, finish(discO, "unmet", "documentation-route-mismatch", discErr...))
		} else {
			obs = append(obs, finish(discO, "met", "documentation-routes-current", Evidence{Kind: "routes", Detail: fmt.Sprintf("%d routes", len(c.DiscoverRoutes)+len(c.ContentRoutes))}))
		}

		distO := baseObservation(RuleDistribution, "package.docs.distribution", pkg, config)
		distErr := []Evidence{}
		distUnobs := []Evidence{}
		for _, p := range c.Projections {
			root, ok := surfaces[p.Surface]
			if !ok {
				if p.Required {
					distUnobs = append(distUnobs, Evidence{Kind: "surface", Detail: p.ID + ": root not supplied"})
				}
				continue
			}
			d, ok := docs[p.Document]
			if !ok {
				distErr = append(distErr, Evidence{Kind: "surface", Detail: p.ID + ": unknown document"})
				continue
			}
			want, e := os.ReadFile(filepath.Join(repo, c.OwnerRoot, d.Path))
			if e != nil {
				distErr = append(distErr, Evidence{Kind: "surface", Detail: p.ID + ": source missing"})
				continue
			}
			got, e := os.ReadFile(filepath.Join(root, p.Path))
			if e != nil {
				distErr = append(distErr, Evidence{Kind: "surface", Path: p.Path, Detail: p.ID + ": projection missing"})
				continue
			}
			if !bytes.Equal(want, got) {
				distErr = append(distErr, Evidence{Kind: "surface", Path: p.Path, Detail: p.ID + ": projection drift"})
			}
		}
		if len(distUnobs) > 0 {
			obs = append(obs, finish(distO, "unobserved", "required-distribution-unobserved", distUnobs...))
		} else if len(distErr) > 0 {
			obs = append(obs, finish(distO, "unmet", "distributed-document-drift", distErr...))
		} else {
			obs = append(obs, finish(distO, "met", "distributed-documents-current", Evidence{Kind: "surfaces", Detail: fmt.Sprintf("%d projections", len(c.Projections))}))
		}
	}
	sort.Slice(obs, func(i, j int) bool {
		if obs[i].RuleID != obs[j].RuleID {
			return obs[i].RuleID < obs[j].RuleID
		}
		return obs[i].PackageID < obs[j].PackageID
	})
	return obs, nil
}

func WriteObservations(path string, obs []Observation) error {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	for _, o := range obs {
		if err := enc.Encode(o); err != nil {
			return err
		}
	}
	return os.WriteFile(path, b.Bytes(), 0o644)
}

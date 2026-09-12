package main

import (
	"flag"
	"fmt"
	"os"

	"capforge.local/ops/shiftleft-admission/internal/packagedocs"
)

func usage() {
	fmt.Fprintln(os.Stderr, `usage: package-docs <command> [options]

commands:
  project  render contract-projection Markdown in one package
  observe  emit language-neutral package documentation observations

observe phases:
  full       observe source, routes, and declared package-output surfaces
  preflight  observe source and routes; package-output surfaces are deferred`)
}

func fail(err error) { fmt.Fprintln(os.Stderr, err); os.Exit(1) }

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	switch os.Args[1] {
	case "project":
		fs := flag.NewFlagSet("project", flag.ExitOnError)
		repo := fs.String("repo", ".", "repository root")
		pkg := fs.String("package", "", "package owner root")
		_ = fs.Parse(os.Args[2:])
		if *pkg == "" {
			fail(fmt.Errorf("ARG_REQUIRED: --package"))
		}
		if err := packagedocs.Project(*repo, *pkg); err != nil {
			fail(err)
		}
	case "observe":
		fs := flag.NewFlagSet("observe", flag.ExitOnError)
		repo := fs.String("repo", ".", "repository root")
		catalog := fs.String("catalog", "build/packages.jsonl", "package catalog")
		baseline := fs.String("baseline-catalog", "", "optional base catalog; new packages must have a contract")
		phase := fs.String("phase", packagedocs.PhaseFull, "observation phase: full or preflight")
		out := fs.String("out", "", "observations JSONL")
		surfaces := packagedocs.SurfaceRoots{}
		fs.Var(&surfaces, "surface", "named projection root name=path; repeatable")
		_ = fs.Parse(os.Args[2:])
		if *out == "" {
			fail(fmt.Errorf("ARG_REQUIRED: --out"))
		}
		obs, err := packagedocs.Observe(*repo, *catalog, *baseline, surfaces)
		if err != nil {
			fail(err)
		}
		obs, err = packagedocs.ApplyPhase(obs, *phase)
		if err != nil {
			fail(err)
		}
		if err := packagedocs.WriteObservations(*out, obs); err != nil {
			fail(err)
		}
		fmt.Printf("phase=%s observations=%d\n", *phase, len(obs))
	case "-h", "--help", "help":
		usage()
	default:
		usage()
		os.Exit(2)
	}
}

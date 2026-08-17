package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"capforge.local/platform/internal/forge"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "version":
		fmt.Println(forge.Version())
		return
	case "init":
		set := flag.NewFlagSet("init", flag.ContinueOnError)
		root := set.String("root", ".", "workspace directory")
		err = parse(set, os.Args[2:], func() error { return forge.InitWorkspace(forge.InitOptions{Root: *root}) })
	case "add":
		set := flag.NewFlagSet("add", flag.ContinueOnError)
		root := set.String("root", ".", "workspace root")
		id := set.String("id", "", "stable capability id")
		title := set.String("title", "", "human title")
		purpose := set.String("purpose", "", "one-line purpose")
		message := set.String("message", "", "starter stdout message")
		err = parse(set, os.Args[2:], func() error {
			return forge.AddCapability(forge.AddOptions{Root: *root, ID: *id, Title: *title, Purpose: *purpose, Message: *message})
		})
	case "project":
		set := flag.NewFlagSet("project", flag.ContinueOnError)
		root := set.String("root", ".", "workspace root")
		dist := set.String("dist", "", "generated dist directory")
		err = parse(set, os.Args[2:], func() error {
			project, verify, _, runErr := projectAndVerify(*root, *dist)
			if runErr != nil {
				return runErr
			}
			printJSON(map[string]any{"project": project, "verify": verify})
			return nil
		})
	case "publish":
		set := flag.NewFlagSet("publish", flag.ContinueOnError)
		root := set.String("root", ".", "workspace root")
		dist := set.String("dist", "", "generated dist directory")
		out := set.String("out", "", "artifact output directory; default is root")
		id := set.String("id", forge.DefaultReleaseID, "release id")
		timestamp := set.String("timestamp", "", "JST timestamp in yymmddhhmmss; default is now")
		err = parse(set, os.Args[2:], func() error {
			project, verify, actualDist, runErr := projectAndVerify(*root, *dist)
			if runErr != nil {
				return runErr
			}
			if err := forge.WriteDistProofManifest(actualDist); err != nil {
				return err
			}
			release, releaseErr := forge.CreateRelease(forge.ReleaseOptions{
				Root: *root, Dist: actualDist, OutDir: *out, ID: *id, Timestamp: *timestamp,
			})
			if releaseErr != nil {
				return releaseErr
			}
			printJSON(map[string]any{"project": project, "verify": verify, "release": release})
			return nil
		})
	case "verify":
		set := flag.NewFlagSet("verify", flag.ContinueOnError)
		dist := set.String("dist", "dist", "dist directory")
		err = parse(set, os.Args[2:], func() error {
			receipt, verifyErr := forge.VerifyDist(*dist)
			if verifyErr != nil {
				return verifyErr
			}
			printJSON(receipt)
			if receipt.Status != "PASS" {
				return fmt.Errorf("verification failed")
			}
			return nil
		})
	case "materialize":
		set := flag.NewFlagSet("materialize", flag.ContinueOnError)
		carrier := set.String("carrier", "", "carrier text path")
		sha := set.String("sha256", "", "expected decoded payload SHA-256")
		out := set.String("out", "", "output path")
		executable := set.Bool("executable", false, "write executable mode")
		err = parse(set, os.Args[2:], func() error {
			if *carrier == "" || *sha == "" || *out == "" {
				return fmt.Errorf("carrier, sha256 and out are required")
			}
			return forge.Materialize(*carrier, *sha, *out, *executable)
		})
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "capforge:", err)
		os.Exit(1)
	}
}

func projectAndVerify(root, dist string) (forge.BuildReceipt, forge.VerifyReceipt, string, error) {
	project, err := forge.Project(forge.ProjectOptions{Root: root, Dist: dist})
	if err != nil {
		return project, forge.VerifyReceipt{}, "", err
	}
	actualDist := dist
	if actualDist == "" {
		actualDist = filepath.Join(root, "dist")
	}
	verify, err := forge.VerifyDist(actualDist)
	if err != nil {
		return project, verify, actualDist, err
	}
	if err := writeJSON(filepath.Join(actualDist, ".well-known", "verify.json"), verify); err != nil {
		return project, verify, actualDist, err
	}
	if project.Status != "PASS" || verify.Status != "PASS" {
		return project, verify, actualDist, fmt.Errorf("projection did not pass")
	}
	return project, verify, actualDist, nil
}

func parse(set *flag.FlagSet, args []string, run func() error) error {
	if err := set.Parse(args); err != nil {
		return err
	}
	if set.NArg() != 0 {
		return fmt.Errorf("unexpected arguments: %v", set.Args())
	}
	return run()
}

func printJSON(value any) {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(value)
}

func writeJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: capforge <version|init|add|project|publish|verify|materialize> [options]")
}

package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"capforge.local/platform/internal/forge"
)

func main() {
	if len(os.Args) == 2 && os.Args[1] == "selftest" {
		fmt.Println("bootstrap-intake selftest PASS")
		return
	}
	set := flag.NewFlagSet("bootstrap-intake", flag.ContinueOnError)
	bootstrap := set.String("bootstrap", "", "bootstrap.json path")
	registry := set.String("registry", "", "registry.jsonl path")
	releaseTag := set.String("release-tag", "", "exact GitHub Release tag; emits materializer requests")
	id := set.String("id", "", "optional active capability id to select")
	if err := set.Parse(os.Args[1:]); err != nil {
		os.Exit(2)
	}
	if set.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "bootstrap-intake: unexpected arguments")
		os.Exit(2)
	}
	inspection, err := forge.InspectBootstrap(forge.BootstrapInspectOptions{
		BootstrapPath: *bootstrap,
		RegistryPath:  *registry,
		ReleaseTag:    *releaseTag,
		CapabilityID:  *id,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "bootstrap-intake:", err)
		os.Exit(1)
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(inspection); err != nil {
		fmt.Fprintln(os.Stderr, "bootstrap-intake:", err)
		os.Exit(1)
	}
}

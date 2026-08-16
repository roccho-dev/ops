package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
)

//go:embed contracts/meta.cue fixtures/*.jsonl
var embedded embed.FS

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "version":
		fmt.Println(validatorVersion)
		return
	case "selftest":
		err = runSelftest()
	case "validate":
		set := flag.NewFlagSet("validate", flag.ContinueOnError)
		ledger := set.String("ledger", "", "candidate JSONL ledger")
		previous := set.String("previous", "", "optional previous ledger that candidate must extend exactly")
		report := set.String("report", "", "optional report JSON path")
		err = parseFlags(set, os.Args[2:], func() error {
			if *ledger == "" {
				return fmt.Errorf("ledger is required")
			}
			candidate, err := os.ReadFile(*ledger)
			if err != nil {
				return err
			}
			var previousBytes []byte
			if *previous != "" {
				previousBytes, err = os.ReadFile(*previous)
				if err != nil {
					return err
				}
			}
			state, err := validateLedger(candidate, previousBytes)
			if err != nil {
				return err
			}
			output, err := marshalJSON(makeReport(state))
			if err != nil {
				return err
			}
			if *report != "" {
				return writeFile(*report, output)
			}
			_, err = os.Stdout.Write(output)
			return err
		})
	case "project":
		set := flag.NewFlagSet("project", flag.ContinueOnError)
		ledger := set.String("ledger", "", "validated JSONL ledger")
		out := set.String("out", "", "projection output directory")
		err = parseFlags(set, os.Args[2:], func() error {
			if *ledger == "" || *out == "" {
				return fmt.Errorf("ledger and out are required")
			}
			ledgerBytes, err := os.ReadFile(*ledger)
			if err != nil {
				return err
			}
			state, err := validateLedger(ledgerBytes, nil)
			if err != nil {
				return err
			}
			meta, err := embedded.ReadFile("contracts/meta.cue")
			if err != nil {
				return err
			}
			return writeProjection(filepath.Clean(*out), ledgerBytes, meta, state)
		})
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "contract-schema-validator:", err)
		os.Exit(1)
	}
}

func parseFlags(set *flag.FlagSet, args []string, run func() error) error {
	if err := set.Parse(args); err != nil {
		return err
	}
	if set.NArg() != 0 {
		return fmt.Errorf("unexpected arguments: %v", set.Args())
	}
	return run()
}

func marshalJSON(value any) ([]byte, error) {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(data, '\n'), nil
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: contract-schema-validator <version|selftest|validate|project> [options]")
}

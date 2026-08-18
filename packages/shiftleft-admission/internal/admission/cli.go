package admission

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
)

type ExitError struct {
	Code int
	Msg  string
}

func (e *ExitError) Error() string                   { return e.Msg }
func AsExitError(err error, target **ExitError) bool { return errors.As(err, target) }

func newFlagSet(name string, stderr io.Writer) *flag.FlagSet {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.SetOutput(stderr)
	return fs
}
func required(name, value string) error {
	if value == "" {
		return fmt.Errorf("ARG_REQUIRED: --%s", name)
	}
	return nil
}

func RunCLI(args []string, stdout, stderr io.Writer) error {
	if len(args) == 0 {
		return &ExitError{Code: 2, Msg: "usage: policyctl <hash|observe|admit|verify|proof>"}
	}
	switch args[0] {
	case "hash":
		fs := newFlagSet("hash", stderr)
		bundle := fs.String("bundle", "", "policy bundle directory")
		if err := fs.Parse(args[1:]); err != nil {
			return &ExitError{2, err.Error()}
		}
		if err := required("bundle", *bundle); err != nil {
			return &ExitError{2, err.Error()}
		}
		b, err := LoadBundle(*bundle)
		if err != nil {
			return err
		}
		fmt.Fprintln(stdout, b.Hash)
		return nil
	case "observe":
		fs := newFlagSet("observe", stderr)
		bundle := fs.String("bundle", "", "")
		fixtures := fs.String("fixtures", "", "")
		out := fs.String("out", "", "")
		if err := fs.Parse(args[1:]); err != nil {
			return &ExitError{2, err.Error()}
		}
		for n, v := range map[string]string{"bundle": *bundle, "fixtures": *fixtures, "out": *out} {
			if err := required(n, v); err != nil {
				return &ExitError{2, err.Error()}
			}
		}
		b, err := LoadBundle(*bundle)
		if err != nil {
			return err
		}
		obs, err := ObserveFixtures(b, *fixtures)
		if err != nil {
			return err
		}
		if err := writeJSONL(*out, obs); err != nil {
			return err
		}
		fmt.Fprintf(stdout, "observations=%d\n", len(obs))
		return nil
	case "admit":
		fs := newFlagSet("admit", stderr)
		bundle := fs.String("bundle", "", "")
		ref := fs.String("policy-ref", "", "")
		hash := fs.String("policy-sha256", "", "")
		base := fs.String("base-tree", "", "")
		candidate := fs.String("candidate-tree", "", "")
		observations := fs.String("observations", "", "")
		out := fs.String("out", "", "")
		if err := fs.Parse(args[1:]); err != nil {
			return &ExitError{2, err.Error()}
		}
		for n, v := range map[string]string{"bundle": *bundle, "policy-ref": *ref, "policy-sha256": *hash, "base-tree": *base, "candidate-tree": *candidate, "observations": *observations, "out": *out} {
			if err := required(n, v); err != nil {
				return &ExitError{2, err.Error()}
			}
		}
		b, err := VerifyBundle(*bundle, *ref, *hash)
		if err != nil {
			return err
		}
		obs, err := readObservations(*observations)
		if err != nil {
			return err
		}
		internal, err := ContractObservations(b)
		if err != nil {
			return err
		}
		obs = append(obs, internal...)
		r, err := Admit(b, *ref, *hash, *base, *candidate, obs)
		if err != nil {
			return err
		}
		if err := writeJSON(*out, r); err != nil {
			return err
		}
		data, _ := json.Marshal(r)
		fmt.Fprintln(stdout, string(data))
		if r.Verdict != "PASS" {
			return &ExitError{Code: 3, Msg: r.TerminalState}
		}
		return nil
	case "verify":
		fs := newFlagSet("verify", stderr)
		receiptPath := fs.String("receipt", "", "")
		hash := fs.String("policy-sha256", "", "")
		base := fs.String("base-tree", "", "")
		candidate := fs.String("candidate-tree", "", "")
		if err := fs.Parse(args[1:]); err != nil {
			return &ExitError{2, err.Error()}
		}
		for n, v := range map[string]string{"receipt": *receiptPath, "policy-sha256": *hash, "base-tree": *base, "candidate-tree": *candidate} {
			if err := required(n, v); err != nil {
				return &ExitError{2, err.Error()}
			}
		}
		data, err := os.ReadFile(*receiptPath)
		if err != nil {
			return err
		}
		var r Receipt
		if err := json.Unmarshal(data, &r); err != nil {
			return err
		}
		if err := VerifyReceiptBinding(r, *hash, *base, *candidate); err != nil {
			return err
		}
		fmt.Fprintln(stdout, "PASS")
		return nil
	case "proof":
		fs := newFlagSet("proof", stderr)
		bundle := fs.String("bundle", "", "")
		fixtures := fs.String("fixtures", "", "")
		ref := fs.String("policy-ref", "", "")
		base := fs.String("base-tree", "", "")
		candidate := fs.String("candidate-tree", "", "")
		out := fs.String("out-dir", "", "")
		if err := fs.Parse(args[1:]); err != nil {
			return &ExitError{2, err.Error()}
		}
		for n, v := range map[string]string{"bundle": *bundle, "fixtures": *fixtures, "policy-ref": *ref, "base-tree": *base, "candidate-tree": *candidate, "out-dir": *out} {
			if err := required(n, v); err != nil {
				return &ExitError{2, err.Error()}
			}
		}
		summary, err := RunProof(*bundle, *fixtures, *ref, *base, *candidate, *out)
		if err != nil {
			return err
		}
		data, _ := json.Marshal(summary)
		fmt.Fprintln(stdout, string(data))
		return nil
	default:
		return &ExitError{Code: 2, Msg: "unknown command: " + args[0]}
	}
}

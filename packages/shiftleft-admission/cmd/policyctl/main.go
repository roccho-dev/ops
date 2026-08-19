package main

import (
	"fmt"
	"os"

	"capforge.local/ops/shiftleft-admission/internal/admission"
)

func main() {
	var err error
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "verify-worktree":
			err = admission.RunVerifyWorktreeCLI(os.Args[2:], os.Stdout, os.Stderr)
		case "intake":
			err = admission.RunLocalIntakeCLI(os.Args[2:], os.Stdout, os.Stderr)
		case "run":
			err = admission.RunLocalRunCLI(os.Args[2:], os.Stdout, os.Stderr)
		default:
			err = admission.RunCLI(os.Args[1:], os.Stdout, os.Stderr)
		}
	} else {
		err = admission.RunCLI(os.Args[1:], os.Stdout, os.Stderr)
	}
	if err == nil {
		return
	}
	var exitErr *admission.ExitError
	if admission.AsExitError(err, &exitErr) {
		fmt.Fprintln(os.Stderr, exitErr.Error())
		os.Exit(exitErr.Code)
	}
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}

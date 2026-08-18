package main

import (
	"fmt"
	"os"

	"capforge.local/ops/shiftleft-admission/internal/admission"
)

func main() {
	var err error
	if len(os.Args) > 1 && os.Args[1] == "verify-worktree" {
		err = admission.RunVerifyWorktreeCLI(os.Args[2:], os.Stdout, os.Stderr)
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

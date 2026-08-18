package main

import (
	"fmt"
	"os"

	"capforge.local/ops/shiftleft-admission/internal/admission"
)

func main() {
	if err := admission.RunCLI(os.Args[1:], os.Stdout, os.Stderr); err != nil {
		var exitErr *admission.ExitError
		if admission.AsExitError(err, &exitErr) {
			fmt.Fprintln(os.Stderr, exitErr.Error())
			os.Exit(exitErr.Code)
		}
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

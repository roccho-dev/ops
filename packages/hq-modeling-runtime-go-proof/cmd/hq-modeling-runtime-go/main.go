package main

import (
	"os"

	"github.com/roccho-dev/ops/packages/hq-modeling-runtime-go-proof/internal/hq"
)

func main() {
	os.Exit(hq.RunCLI(os.Args[1:], os.Stdout, os.Stderr))
}

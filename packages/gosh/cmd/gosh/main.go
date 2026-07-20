package main

import (
	"github.com/roccho-dev/ops/packages/gosh/internal/gosh"
	"os"
)

func main() { os.Exit(gosh.RunMain(os.Args[1:])) }

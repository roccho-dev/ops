package main

import (
	"fmt"
	"os"
	"strconv"
)

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: go-sum <a> <b>")
		os.Exit(2)
	}
	a, err := strconv.Atoi(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, "invalid a")
		os.Exit(2)
	}
	b, err := strconv.Atoi(os.Args[2])
	if err != nil {
		fmt.Fprintln(os.Stderr, "invalid b")
		os.Exit(2)
	}
	fmt.Println(a + b)
}

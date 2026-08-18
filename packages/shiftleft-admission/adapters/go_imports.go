package main

import (
	"encoding/json"
	"go/parser"
	"go/token"
	"os"
	"sort"
	"strconv"
)

type finding struct {
	Module string `json:"module"`
	Line   int    `json:"line"`
}
type report struct {
	Schema  string    `json:"schema"`
	Imports []finding `json:"imports"`
}

func main() {
	fset := token.NewFileSet()
	sourcePath := os.Args[len(os.Args)-1]
	f, err := parser.ParseFile(fset, sourcePath, nil, parser.ImportsOnly)
	if err != nil {
		panic(err)
	}
	rows := []finding{}
	for _, imp := range f.Imports {
		m, _ := strconv.Unquote(imp.Path.Value)
		rows = append(rows, finding{m, fset.Position(imp.Pos()).Line})
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Module != rows[j].Module {
			return rows[i].Module < rows[j].Module
		}
		return rows[i].Line < rows[j].Line
	})
	_ = json.NewEncoder(os.Stdout).Encode(report{"shiftleft-import-report/1", rows})
}

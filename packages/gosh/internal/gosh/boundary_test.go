package gosh

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestCoreHasNoShellOrAmbientLookupCalls(t *testing.T) {
	root := "."
	forbiddenPrograms := map[string]bool{"sh": true, "bash": true, "pwsh": true, "powershell": true, "cmd": true}
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		file, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
		if err != nil {
			return err
		}
		ast.Inspect(file, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			selector, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			if selector.Sel.Name == "LookPath" {
				t.Errorf("ambient PATH lookup in %s", path)
			}
			if selector.Sel.Name != "Command" && selector.Sel.Name != "CommandContext" || len(call.Args) == 0 {
				return true
			}
			literal, ok := call.Args[0].(*ast.BasicLit)
			if !ok || literal.Kind != token.STRING {
				return true
			}
			value, _ := strconv.Unquote(literal.Value)
			if forbiddenPrograms[strings.ToLower(filepath.Base(value))] {
				t.Errorf("shell runtime %q in %s", value, path)
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

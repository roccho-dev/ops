package hq

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

type LineVisitor func(line int, trimmed []byte)

// VisitJSONLLines uses an unbounded Reader rather than bufio.Scanner's default
// token ceiling. The proof therefore does not introduce a 64 KiB line limit.
func VisitJSONLLines(reader io.Reader, visit LineVisitor) error {
	buffered := bufio.NewReader(reader)
	lineNumber := 1
	for {
		line, err := buffered.ReadBytes('\n')
		if len(line) > 0 {
			line = bytes.TrimSuffix(line, []byte{'\n'})
			line = bytes.TrimSuffix(line, []byte{'\r'})
			trimmed := bytes.TrimSpace(line)
			if len(trimmed) > 0 {
				visit(lineNumber, trimmed)
			}
		}
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
		lineNumber++
	}
}

func ParseJSONLine(data []byte, line int) (any, Object) {
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, Error("invalid-json", err.Error(), Object{"line": line})
	}
	return value, nil
}

func ValidateJSONL(reader io.Reader) Object {
	errors := []any{}
	seen := map[string]int{}
	records := 0
	_ = VisitJSONLLines(reader, func(line int, trimmed []byte) {
		value, parseError := ParseJSONLine(trimmed, line)
		if parseError != nil {
			errors = append(errors, parseError)
			return
		}
		records++
		record, validationErrors := ValidateRecord(value, line)
		for _, validationError := range validationErrors {
			errors = append(errors, validationError)
		}
		if record != nil {
			if id, ok := NonEmptyString(record["id"]); ok {
				if first, exists := seen[id]; exists {
					errors = append(errors, Error("duplicate-id", "duplicate id: "+id, Object{"id": id, "line": line, "firstLine": first}))
				} else {
					seen[id] = line
				}
			}
		}
	})
	return Object{"ok": len(errors) == 0, "records": records, "errors": errors}
}

func RowsToJSONL(rows []any) ([]byte, error) {
	var builder strings.Builder
	for _, row := range rows {
		encoded, err := EncodeJSON(row, false)
		if err != nil {
			return nil, err
		}
		builder.Write(bytes.TrimSuffix(encoded, []byte{'\n'}))
		builder.WriteByte('\n')
	}
	if len(rows) == 0 {
		builder.WriteByte('\n')
	}
	return []byte(builder.String()), nil
}

func errorCodes(errors []Object) []any {
	result := make([]any, 0, len(errors))
	for _, err := range errors {
		result = append(result, err["code"])
	}
	return result
}

func objectSliceToAny(values []Object) []any {
	result := make([]any, len(values))
	for index, value := range values {
		result[index] = value
	}
	return result
}

func ensureObject(value any) Object {
	if object, ok := AsObject(value); ok {
		return object
	}
	panic(fmt.Sprintf("expected object, got %T", value))
}

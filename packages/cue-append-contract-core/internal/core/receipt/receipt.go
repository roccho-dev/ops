package receipt

import (
	"fmt"
	"strings"

	validate "cueappendcontract/internal/core/validate"
)

func ReceiptCheck(path string) (map[string]any, error) {
	rows, err := validate.ReadJSONL(path)
	if err != nil {
		return nil, err
	}
	errors := []string{}
	for _, row := range rows {
		if validate.Str(row["kind"]) != "receipt.v1" {
			errors = append(errors, fmt.Sprintf("line %v: unknown receipt kind", row["__line__"]))
			continue
		}
		for _, k := range []string{"receipt_id", "receipt_type", "status", "target_id", "input_hash", "created_at"} {
			if validate.Str(row[k]) == "" {
				errors = append(errors, fmt.Sprintf("line %v: missing %s", row["__line__"], k))
			}
		}
		if validate.Str(row["status"]) == "pass" && validate.Str(row["output_hash"]) == "" {
			errors = append(errors, fmt.Sprintf("line %v: pass receipt missing output_hash", row["__line__"]))
		}
		for _, k := range []string{"input_hash", "output_hash"} {
			if validate.Str(row[k]) != "" && !validate.IsHash(validate.Str(row[k])) {
				errors = append(errors, fmt.Sprintf("line %v: bad %s", row["__line__"], k))
			}
		}
	}
	if len(errors) > 0 {
		return nil, fmt.Errorf("receipt check failed: %s", strings.Join(errors, "; "))
	}
	return map[string]any{"status": "pass", "check": "receipt", "receipts": len(rows)}, nil
}

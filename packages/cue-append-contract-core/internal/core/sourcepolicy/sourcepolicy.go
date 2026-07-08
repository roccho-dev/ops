package sourcepolicy

import (
	"fmt"
	"strings"

	validate "cueappendcontract/internal/core/validate"
)

func SourcePolicyCheck(path string) (map[string]any, error) {
	rows, err := validate.ReadJSONL(path)
	if err != nil {
		return nil, err
	}
	sources := map[string]bool{}
	raws := map[string]bool{}
	errors := []string{}
	for _, row := range rows {
		line := row["__line__"]
		switch validate.Str(row["kind"]) {
		case "source.registry.v1":
			for _, k := range []string{"source_id", "source_kind", "trust_class", "retention_class"} {
				if validate.Str(row[k]) == "" {
					errors = append(errors, fmt.Sprintf("line %v: missing %s", line, k))
				}
			}
			sources[validate.Str(row["source_id"])] = true
		case "raw.evidence.v1":
			for _, k := range []string{"raw_id", "source_id", "raw_ref", "content_hash", "retention_class"} {
				if validate.Str(row[k]) == "" {
					errors = append(errors, fmt.Sprintf("line %v: missing %s", line, k))
				}
			}
			if !sources[validate.Str(row["source_id"])] {
				errors = append(errors, fmt.Sprintf("line %v: raw references missing source", line))
			}
			if validate.Str(row["content_hash"]) != "" && !validate.IsHash(validate.Str(row["content_hash"])) {
				errors = append(errors, fmt.Sprintf("line %v: bad content_hash", line))
			}
			raws[validate.Str(row["raw_id"])] = true
		case "extraction.v1":
			for _, k := range []string{"extraction_id", "raw_id", "extractor_version", "output_schema", "output_hash"} {
				if validate.Str(row[k]) == "" {
					errors = append(errors, fmt.Sprintf("line %v: missing %s", line, k))
				}
			}
			if !raws[validate.Str(row["raw_id"])] {
				errors = append(errors, fmt.Sprintf("line %v: extraction references missing raw", line))
			}
			if validate.Str(row["output_hash"]) != "" && !validate.IsHash(validate.Str(row["output_hash"])) {
				errors = append(errors, fmt.Sprintf("line %v: bad output_hash", line))
			}
		default:
			errors = append(errors, fmt.Sprintf("line %v: unknown source-policy kind %s", line, validate.Str(row["kind"])))
		}
	}
	if len(errors) > 0 {
		return nil, fmt.Errorf("source policy failed: %s", strings.Join(errors, "; "))
	}
	return map[string]any{"status": "pass", "check": "source-policy", "sources": len(sources), "raws": len(raws)}, nil
}

package artifacts

import (
	"encoding/json"
	"regexp"
	"sort"
	"strings"
)

func copyMap(in map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range in {
		out[k] = v
	}
	return out
}
func limitStrings(in []string, n int) []string {
	if len(in) <= n {
		return in
	}
	return in[:n]
}
func sortedBoolKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
func sortedKeys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
func sortedFieldKeys(m map[string]Field) []string { return sortedKeys(m) }
func sortedQueryKeys(m map[string]Query) []string { return sortedKeys(m) }
func fieldCount(idx Index) int {
	n := 0
	for _, fs := range idx.Fields {
		n += len(fs)
	}
	return n
}
func schemaName(s string) string { return strings.NewReplacer(".", "_", "-", "_").Replace(s) }
func interfaceName(s string) string {
	parts := regexp.MustCompile(`[._-]`).Split(s, -1)
	for i, p := range parts {
		if p != "" {
			parts[i] = strings.ToUpper(p[:1]) + p[1:]
		}
	}
	return strings.Join(parts, "")
}
func tsType(f Field) string {
	switch f.FieldType {
	case "string", "timestamp", "hash", "id", "ref":
		return "string"
	case "number", "integer":
		return "number"
	case "boolean":
		return "boolean"
	case "array<string>", "array<ref>":
		return "string[]"
	case "enum":
		if len(f.EnumValues) > 0 {
			qs := make([]string, len(f.EnumValues))
			for i, v := range f.EnumValues {
				b, _ := json.Marshal(v)
				qs[i] = string(b)
			}
			return strings.Join(qs, " | ")
		}
		return "string"
	default:
		return "unknown"
	}
}
func jsonType(f Field) map[string]any {
	switch f.FieldType {
	case "string", "id", "ref":
		return map[string]any{"type": "string"}
	case "timestamp":
		return map[string]any{"type": "string", "pattern": `^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$`}
	case "hash":
		return map[string]any{"type": "string", "pattern": `^sha256:[0-9a-f]{64}$`}
	case "number":
		return map[string]any{"type": "number"}
	case "integer":
		return map[string]any{"type": "integer"}
	case "boolean":
		return map[string]any{"type": "boolean"}
	case "array<string>", "array<ref>":
		return map[string]any{"type": "array", "items": map[string]any{"type": "string"}}
	case "enum":
		if len(f.EnumValues) > 0 {
			return map[string]any{"type": "string", "enum": f.EnumValues}
		}
		return map[string]any{"type": "string"}
	default:
		return map[string]any{}
	}
}

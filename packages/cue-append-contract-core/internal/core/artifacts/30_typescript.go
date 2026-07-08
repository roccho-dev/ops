package artifacts

import (
	"fmt"
	"strings"
)

func GenerateTS(idx Index) string {
	var b strings.Builder
	b.WriteString("// Generated from contract JSONL. Do not edit by hand.\n/* eslint-disable */\n\n")
	for _, sid := range sortedBoolKeys(idx.Schemas) {
		iface := interfaceName(sid)
		b.WriteString(fmt.Sprintf("export interface %s {\n", iface))
		for _, fid := range sortedFieldKeys(idx.Fields[sid]) {
			f := idx.Fields[sid][fid]
			opt := "?"
			if f.Required {
				opt = ""
			}
			b.WriteString(fmt.Sprintf("  %q%s: %s;\n", fid, opt, tsType(f)))
		}
		b.WriteString("}\n\n")
	}
	b.WriteString("export const accessors = {\n")
	for _, sid := range sortedBoolKeys(idx.Schemas) {
		b.WriteString(fmt.Sprintf("  %s: {\n", schemaName(sid)))
		iface := interfaceName(sid)
		for _, fid := range sortedFieldKeys(idx.Fields[sid]) {
			b.WriteString(fmt.Sprintf("    %s: (row: %s) => row[%q],\n", strings.ReplaceAll(fid, ".", "_"), iface, fid))
		}
		b.WriteString("  },\n")
	}
	b.WriteString("} as const;\n\nexport const fieldRefs = {\n")
	for _, sid := range sortedBoolKeys(idx.Schemas) {
		b.WriteString(fmt.Sprintf("  %s: {\n", schemaName(sid)))
		for _, fid := range sortedFieldKeys(idx.Fields[sid]) {
			b.WriteString(fmt.Sprintf("    %s: %q,\n", strings.ReplaceAll(fid, ".", "_"), sid+"#"+fid))
		}
		b.WriteString("  },\n")
	}
	b.WriteString("} as const;\n")
	return b.String()
}

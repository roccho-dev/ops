package lineage

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	validate "cueappendcontract/internal/core/validate"
)

func Lineage(ledger, out string) (map[string]any, error) {
	if err := os.MkdirAll(out, 0755); err != nil {
		return nil, err
	}
	events, err := validate.ReadJSONL(ledger)
	if err != nil {
		return nil, err
	}
	idx, errs := validate.BuildIndex(events)
	if len(errs) > 0 {
		return nil, fmt.Errorf(strings.Join(errs, "; "))
	}
	adj := map[string][]string{}
	for _, e := range idx.Edges {
		adj[e.From] = append(adj[e.From], e.To)
	}
	closure := []validate.Event{}
	for _, start := range validate.SortedBoolKeys(idx.Schemas) {
		seen := map[string]int{start: 0}
		q := []string{start}
		for len(q) > 0 {
			n := q[0]
			q = q[1:]
			for _, m := range adj[n] {
				if _, ok := seen[m]; !ok {
					seen[m] = seen[n] + 1
					q = append(q, m)
				}
			}
		}
		for desc, depth := range seen {
			if desc != start {
				closure = append(closure, validate.Event{"kind": "closure.v1", "ancestor_schema": start, "descendant_schema": desc, "depth": depth, "path_hash": validate.HashBytes([]byte(fmt.Sprintf("%s->%s:%d", start, desc, depth)))})
			}
		}
	}
	sort.Slice(closure, func(i, j int) bool {
		return validate.Str(closure[i]["ancestor_schema"])+validate.Str(closure[i]["descendant_schema"]) < validate.Str(closure[j]["ancestor_schema"])+validate.Str(closure[j]["descendant_schema"])
	})
	if err := validate.WriteJSONL(filepath.Join(out, "closure.jsonl"), closure); err != nil {
		return nil, err
	}
	affected := map[string][]string{}
	for _, q := range idx.Queries {
		for _, ref := range q.Inputs {
			if _, ok := idx.Deprecated[ref]; ok {
				affected[ref] = append(affected[ref], q.ID)
			}
		}
	}
	for k, v := range affected {
		affected[k] = validate.Dedupe(v)
	}
	if err := validate.WriteJSON(filepath.Join(out, "impact_report.json"), map[string]any{"deprecated_fields": validate.SortedKeys(idx.Deprecated), "affected_queries": affected}); err != nil {
		return nil, err
	}
	if err := validate.WriteJSON(filepath.Join(out, "stale_report.json"), map[string]any{"stale_projection_families": []string{}}); err != nil {
		return nil, err
	}
	return map[string]any{"status": "pass", "check": "lineage", "closure_rows": len(closure), "deprecated_fields": len(idx.Deprecated)}, nil
}

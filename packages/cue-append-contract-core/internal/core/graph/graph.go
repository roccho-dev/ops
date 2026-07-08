package graph

import (
	"fmt"
	"strings"

	validate "cueappendcontract/internal/core/validate"
)

func GraphCheck(path string) (map[string]any, error) {
	events, err := validate.ReadJSONL(path)
	if err != nil {
		return nil, err
	}
	idx, errs := validate.BuildIndex(events)
	errors := append([]string{}, errs...)
	adj := map[string][]string{}
	forbidden := map[string]bool{"raw.v1->decision.v1": true, "projection.v1->raw.v1": true, "projection.v1->decision.v1": true}
	for _, e := range idx.Edges {
		if forbidden[e.From+"->"+e.To] {
			errors = append(errors, fmt.Sprintf("forbidden flow %s->%s", e.From, e.To))
		}
		if e.AcyclicRequired {
			adj[e.From] = append(adj[e.From], e.To)
		}
	}
	color := map[string]int{}
	var dfs func(string, []string)
	dfs = func(n string, stack []string) {
		color[n] = 1
		for _, m := range adj[n] {
			if color[m] == 1 {
				errors = append(errors, "cycle: "+strings.Join(append(stack, m), "->"))
			} else if color[m] == 0 {
				dfs(m, append(stack, m))
			}
		}
		color[n] = 2
	}
	for sid := range idx.Schemas {
		if color[sid] == 0 {
			dfs(sid, []string{sid})
		}
	}
	if len(errors) > 0 {
		return nil, fmt.Errorf("graph check failed: %s", strings.Join(validate.Dedupe(errors), "; "))
	}
	return map[string]any{"status": "pass", "check": "graph", "edges": len(idx.Edges)}, nil
}

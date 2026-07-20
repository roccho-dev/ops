package gosh

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
)

func BuildPlan(s State, requested string) (Plan, error) {
	steps := []PlanStep{}
	seen := map[string]bool{}
	visiting := map[string]bool{}
	stack := []string{}
	producers, err := outputProducers(s)
	if err != nil {
		return Plan{}, err
	}
	var addTarget func(string) error
	addTarget = func(id string) error {
		t, ok := s.Targets[id]
		if !ok || t.Deleted {
			return fmt.Errorf("unknown target %q", id)
		}
		if seen["target:"+id] {
			return nil
		}
		if visiting[id] {
			path := append(append([]string{}, stack...), id)
			return fmt.Errorf("target cycle: %v", path)
		}
		visiting[id] = true
		stack = append(stack, id)
		deps := []string{}
		inputIDs := make([]string, 0, len(t.Inputs))
		for mid, m := range t.Inputs {
			if !m.Deleted {
				inputIDs = append(inputIDs, mid)
			}
		}
		sort.Strings(inputIDs)
		for _, mid := range inputIDs {
			m := t.Inputs[mid]
			if producer := producers[m.Value]; producer != "" && producer != id {
				if err := addTarget(producer); err != nil {
					return err
				}
				deps = append(deps, "target:"+producer)
			}
		}
		tools := targetTools(t)
		for _, toolID := range tools {
			tool, ok := s.Tools[toolID]
			if !ok || tool.Deleted {
				return fmt.Errorf("target %q references missing tool %q", id, toolID)
			}
			key := "tool:" + toolID
			if !seen[key] {
				steps = append(steps, PlanStep{ID: key, Kind: "resolve.tool", Tool: toolID, SourceLines: []int{tool.SourceLine}})
				seen[key] = true
			}
			deps = append(deps, key)
		}
		sort.Strings(deps)
		deps = uniqueStrings(deps)
		steps = append(steps, PlanStep{ID: "target:" + id, Kind: "run.target", Target: id, Deps: deps, SourceLines: targetSourceLines(t)})
		seen["target:"+id] = true
		stack = stack[:len(stack)-1]
		visiting[id] = false
		return nil
	}

	if c, ok := s.Checks[requested]; ok && !c.Deleted {
		if err := addTarget(c.Target); err != nil {
			return Plan{}, err
		}
		tool, ok := s.Tools[c.Tool]
		if !ok || tool.Deleted {
			return Plan{}, fmt.Errorf("check %q references missing tool %q", c.ID, c.Tool)
		}
		if !seen["tool:"+c.Tool] {
			steps = append(steps, PlanStep{ID: "tool:" + c.Tool, Kind: "resolve.tool", Tool: c.Tool, SourceLines: []int{tool.SourceLine}})
			seen["tool:"+c.Tool] = true
		}
		steps = append(steps, PlanStep{ID: "check:" + c.ID, Kind: "run.check", Target: c.Target, Tool: c.Tool, Deps: []string{"target:" + c.Target, "tool:" + c.Tool}, SourceLines: []int{c.SourceLine}})
	} else if err := addTarget(requested); err != nil {
		return Plan{}, err
	}
	p := Plan{Version: "v1", Requested: requested, InputSHA: s.InputSHA, Steps: steps}
	b, err := canonicalJSON(struct {
		Version, Requested, InputSHA string
		Steps                        []PlanStep
	}{p.Version, p.Requested, p.InputSHA, p.Steps})
	if err != nil {
		return Plan{}, err
	}
	h := sha256.Sum256(b)
	p.PlanSHA = hex.EncodeToString(h[:])
	return p, nil
}

func outputProducers(s State) (map[string]string, error) {
	m := map[string]string{}
	ids := SortedTargetIDs(s)
	for _, id := range ids {
		t := s.Targets[id]
		for _, out := range t.Outputs {
			if !out.Deleted {
				if prior := m[out.Value]; prior != "" && prior != id {
					return nil, fmt.Errorf("output path %q has multiple producers %q and %q", out.Value, prior, id)
				}
				m[out.Value] = id
			}
		}
	}
	return m, nil
}

func targetTools(t Target) []string {
	set := map[string]bool{}
	if t.Tool != "" {
		set[t.Tool] = true
	}
	for _, st := range t.Stages {
		if st.Tool != "" {
			set[st.Tool] = true
		}
	}
	ids := []string{}
	for id := range set {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}
func targetSourceLines(t Target) []int {
	lines := []int{t.SourceLine}
	for _, m := range t.Inputs {
		if !m.Deleted {
			lines = append(lines, m.SourceLine)
		}
	}
	for _, m := range t.Outputs {
		if !m.Deleted {
			lines = append(lines, m.SourceLine)
		}
	}
	sort.Ints(lines)
	return uniqueInts(lines)
}
func uniqueStrings(v []string) []string {
	out := v[:0]
	for _, s := range v {
		if len(out) == 0 || out[len(out)-1] != s {
			out = append(out, s)
		}
	}
	return out
}
func uniqueInts(v []int) []int {
	out := v[:0]
	for _, n := range v {
		if len(out) == 0 || out[len(out)-1] != n {
			out = append(out, n)
		}
	}
	return out
}
func canonicalJSON(v any) ([]byte, error) { return json.Marshal(v) }

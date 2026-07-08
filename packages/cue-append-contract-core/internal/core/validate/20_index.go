package validate

import (
	"fmt"
	"sort"
	"strings"
)

func IndexEvent(idx *Index, ev Event, line int, res *Result) {
	kind := Str(ev["kind"])
	idx.Counts[kind]++
	eid := Str(ev["event_id"])
	if eid != "" {
		if prev, ok := idx.Events[eid]; ok {
			res.SemanticErrors = append(res.SemanticErrors, fmt.Sprintf("line %d: duplicate event_id %s first seen at line %d", line, eid, prev))
		}
		idx.Events[eid] = line
	}
	switch kind {
	case "contract.schema.v1":
		sid := Str(ev["schema_id"])
		idx.Schemas[sid] = true
	case "contract.field.v1":
		sid, fid := Str(ev["schema_id"]), Str(ev["field_id"])
		if idx.Fields[sid] == nil {
			idx.Fields[sid] = map[string]Field{}
		}
		if _, exists := idx.Fields[sid][fid]; exists {
			res.SemanticErrors = append(res.SemanticErrors, fmt.Sprintf("line %d: duplicate field %s#%s", line, sid, fid))
		}
		idx.Fields[sid][fid] = Field{SchemaID: sid, FieldID: fid, FieldType: Str(ev["field_type"]), Required: Bool(ev["required"]), PII: Bool(ev["pii"]), Description: Str(ev["description"]), EnumValues: ToStrings(ev["enum_values"])}
	case "contract.field.deprecated.v1":
		idx.Deprecated[FieldRef(Str(ev["schema_id"]), Str(ev["field_id"]))] = Str(ev["reason"])
	case "contract.edge.v1":
		idx.Edges = append(idx.Edges, Edge{Kind: Str(ev["edge_kind"]), From: Str(ev["from_schema"]), To: Str(ev["to_schema"]), AcyclicRequired: Bool(ev["acyclic_required"])})
	case "contract.query.v1":
		q := Query{ID: Str(ev["query_id"]), Family: Str(ev["query_family"]), Output: Str(ev["output_schema"]), Line: line}
		q.Inputs = ToStrings(ev["input_fields"])
		q.Fixtures = ToStrings(ev["fixture_ids"])
		if idx.Queries[q.ID].ID != "" {
			res.SemanticErrors = append(res.SemanticErrors, fmt.Sprintf("line %d: duplicate query_id %s", line, q.ID))
		}
		idx.Queries[q.ID] = q
		idx.ActiveByFamily[q.Family] = q
	case "contract.fixture.v1":
		fx := Fixture{ID: Str(ev["fixture_id"]), QueryID: Str(ev["target_query_id"]), Line: line}
		if idx.Fixtures[fx.ID].ID != "" {
			res.SemanticErrors = append(res.SemanticErrors, fmt.Sprintf("line %d: duplicate fixture_id %s", line, fx.ID))
		}
		idx.Fixtures[fx.ID] = fx
	case "contract.authority_rule.v1":
		idx.AuthorityRules = append(idx.AuthorityRules, ev)
	}
}

func BuildIndex(events []Event) (Index, []string) {
	idx := NewIndex()
	res := &Result{AffectedQueries: map[string][]string{}, AffectedFixtures: map[string][]string{}, UnresolvedAffected: map[string][]string{}}
	for i, ev := range events {
		line := i + 1
		if v, ok := ev["__line__"].(int); ok {
			line = v
		}
		IndexEvent(&idx, ev, line, res)
	}
	SemanticCheck(&idx, res)
	return idx, res.SemanticErrors
}

func SemanticCheck(idx *Index, res *Result) {
	for sid := range idx.Fields {
		if !idx.Schemas[sid] {
			res.SemanticErrors = append(res.SemanticErrors, fmt.Sprintf("field references missing schema: %s", sid))
		}
	}
	for _, e := range idx.Edges {
		if !idx.Schemas[e.From] {
			res.SemanticErrors = append(res.SemanticErrors, fmt.Sprintf("edge %s references missing from_schema %s", e.Kind, e.From))
		}
		if !idx.Schemas[e.To] {
			res.SemanticErrors = append(res.SemanticErrors, fmt.Sprintf("edge %s references missing to_schema %s", e.Kind, e.To))
		}
		if e.From == e.To && strings.Contains(e.Kind, "derived") {
			res.SemanticErrors = append(res.SemanticErrors, fmt.Sprintf("edge %s must not self-loop on %s", e.Kind, e.From))
		}
	}
	queryByInput := map[string][]string{}
	fixtureByQuery := map[string][]string{}
	for _, fx := range idx.Fixtures {
		fixtureByQuery[fx.QueryID] = append(fixtureByQuery[fx.QueryID], fx.ID)
	}
	for _, q := range idx.Queries {
		if !idx.Schemas[q.Output] {
			res.SemanticErrors = append(res.SemanticErrors, fmt.Sprintf("query %s references missing output_schema %s", q.ID, q.Output))
		}
		for _, ref := range q.Inputs {
			sid, fid, ok := SplitFieldRef(ref)
			if !ok {
				res.SemanticErrors = append(res.SemanticErrors, fmt.Sprintf("query %s has invalid input ref %s", q.ID, ref))
				continue
			}
			if !idx.Schemas[sid] {
				res.SemanticErrors = append(res.SemanticErrors, fmt.Sprintf("query %s references missing schema %s", q.ID, sid))
			}
			if _, ok := idx.Fields[sid][fid]; !ok {
				res.SemanticErrors = append(res.SemanticErrors, fmt.Sprintf("query %s references missing field %s#%s", q.ID, sid, fid))
			}
			queryByInput[ref] = append(queryByInput[ref], q.ID)
		}
		for _, fxID := range q.Fixtures {
			fx, ok := idx.Fixtures[fxID]
			if !ok {
				res.SemanticErrors = append(res.SemanticErrors, fmt.Sprintf("query %s references missing fixture %s", q.ID, fxID))
				continue
			}
			if fx.QueryID != q.ID {
				res.SemanticErrors = append(res.SemanticErrors, fmt.Sprintf("query %s fixture %s targets %s", q.ID, fxID, fx.QueryID))
			}
		}
	}
	for ref := range idx.Deprecated {
		qs := Dedupe(queryByInput[ref])
		if len(qs) == 0 {
			continue
		}
		res.AffectedQueries[ref] = qs
		fxs := []string{}
		unresolvedFamilies := map[string]bool{}
		for _, qid := range qs {
			for _, fx := range fixtureByQuery[qid] {
				fxs = append(fxs, fx)
			}
			q := idx.Queries[qid]
			active := idx.ActiveByFamily[q.Family]
			if Contains(active.Inputs, ref) {
				unresolvedFamilies[q.Family] = true
			}
		}
		res.AffectedFixtures[ref] = Dedupe(fxs)
		fams := make([]string, 0, len(unresolvedFamilies))
		for f := range unresolvedFamilies {
			fams = append(fams, f)
		}
		sort.Strings(fams)
		if len(fams) > 0 {
			res.UnresolvedAffected[ref] = fams
		}
	}
}

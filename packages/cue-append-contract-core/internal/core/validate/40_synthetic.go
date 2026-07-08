package validate

import (
	"bufio"
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
)

func GenerateSyntheticLedger(opts GenerateOptions) error {
	if opts.OutPath == "" {
		opts.OutPath = "ledgers/large.contract.jsonl"
	}
	if opts.Schemas == 0 {
		opts.Schemas = 1000
	}
	if opts.Fields == 0 {
		opts.Fields = 10
	}
	if opts.Queries == 0 {
		opts.Queries = 5000
	}
	if opts.Edges == 0 {
		opts.Edges = 2000
	}
	if err := os.MkdirAll(filepath.Dir(opts.OutPath), 0755); err != nil {
		return err
	}
	f, err := os.Create(opts.OutPath)
	if err != nil {
		return err
	}
	defer f.Close()
	w := bufio.NewWriterSize(f, 1<<20)
	defer w.Flush()
	rnd := rand.New(rand.NewSource(42))
	line := 0
	emit := func(ev Event) error {
		line++
		if ev["event_id"] == nil {
			ev["event_id"] = fmt.Sprintf("evt_%012d", line)
		}
		ev["schema_version"] = "contract.meta.v1"
		ev["created_at"] = "2026-07-05T00:00:00Z"
		ev["purpose_level"] = "meta^5"
		if ev["authority"] == nil {
			ev["authority"] = "contract_owner"
		}
		b, _ := json.Marshal(ev)
		_, err := w.Write(append(b, '\n'))
		return err
	}
	for i := 0; i < opts.Schemas; i++ {
		sid := fmt.Sprintf("model_%05d.v1", i)
		if err := emit(Event{"kind": "contract.schema.v1", "schema_id": sid, "title": fmt.Sprintf("Model %05d", i), "lifecycle": "active"}); err != nil {
			return err
		}
		for j := 0; j < opts.Fields; j++ {
			t := "string"
			if j%7 == 0 {
				t = "number"
			} else if j%5 == 0 {
				t = "boolean"
			} else if j%3 == 0 {
				t = "id"
			}
			if err := emit(Event{"kind": "contract.field.v1", "schema_id": sid, "field_id": fmt.Sprintf("field_%02d", j), "field_type": t, "required": j%2 == 0, "pii": false, "description": "synthetic field"}); err != nil {
				return err
			}
		}
	}
	for i := 0; i < opts.Edges; i++ {
		from := fmt.Sprintf("model_%05d.v1", rnd.Intn(opts.Schemas))
		to := fmt.Sprintf("model_%05d.v1", rnd.Intn(opts.Schemas))
		if from == to {
			to = fmt.Sprintf("model_%05d.v1", (rnd.Intn(opts.Schemas)+1)%opts.Schemas)
		}
		if err := emit(Event{"kind": "contract.edge.v1", "edge_kind": fmt.Sprintf("rel_%03d", i%100), "from_schema": from, "to_schema": to, "cardinality": "many_to_many", "acyclic_required": true}); err != nil {
			return err
		}
	}
	changedRefs := []string{}
	for i := 0; i < Min(25, opts.Schemas); i++ {
		ref := FieldRef(fmt.Sprintf("model_%05d.v1", i), "field_00")
		changedRefs = append(changedRefs, ref)
		if err := emit(Event{"kind": "contract.field.deprecated.v1", "schema_id": fmt.Sprintf("model_%05d.v1", i), "field_id": "field_00", "reason": "synthetic change for impact proof"}); err != nil {
			return err
		}
	}
	for i := 0; i < opts.Queries; i++ {
		sid := fmt.Sprintf("model_%05d.v1", rnd.Intn(opts.Schemas))
		inputs := []string{FieldRef(sid, fmt.Sprintf("field_%02d", rnd.Intn(opts.Fields))), FieldRef(sid, fmt.Sprintf("field_%02d", rnd.Intn(opts.Fields)))}
		if i < len(changedRefs)*3 {
			inputs = append(inputs, changedRefs[i%len(changedRefs)])
		}
		qid := fmt.Sprintf("q_projection_%05d.v1", i)
		fxid := fmt.Sprintf("fx_projection_%05d", i)
		if err := emit(Event{"kind": "contract.query.v1", "query_id": qid, "query_family": fmt.Sprintf("projection_%05d", i), "input_fields": inputs, "output_schema": sid, "runner_kind": "generated", "projection_only": true, "side_effects": false, "fixture_ids": []string{fxid}, "expected_output_hash": FakeHash("q", i)}); err != nil {
			return err
		}
		if opts.Fixtures {
			if err := emit(Event{"kind": "contract.fixture.v1", "fixture_id": fxid, "target_query_id": qid, "polarity": "positive", "payload_hash": FakeHash("fx", i)}); err != nil {
				return err
			}
		}
	}
	return nil
}

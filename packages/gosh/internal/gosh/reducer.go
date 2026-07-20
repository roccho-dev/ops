package gosh

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"sort"
	"strings"
)

var allowedFieldsByKind = map[string][]string{
	"gosh.tool.require.v1":         {"id", "resolver", "installable", "programRel", "programAbs"},
	"gosh.tool.remove.v1":          {"id"},
	"gosh.target.upsert.v1":        {"id", "targetKind", "tool", "main", "path", "value", "args", "stages", "mode"},
	"gosh.target.delete.v1":        {"id"},
	"gosh.target.input.add.v1":     {"target", "id", "path"},
	"gosh.target.input.remove.v1":  {"target", "id"},
	"gosh.target.output.set.v1":    {"target", "id", "path"},
	"gosh.target.output.remove.v1": {"target", "id"},
	"gosh.target.env.set.v1":       {"target", "key", "value"},
	"gosh.target.env.remove.v1":    {"target", "key"},
	"gosh.check.upsert.v1":         {"id", "target", "tool", "args"},
	"gosh.check.delete.v1":         {"id"},
}

var allowedKinds = map[string]bool{
	"gosh.tool.require.v1": true, "gosh.tool.remove.v1": true,
	"gosh.target.upsert.v1": true, "gosh.target.delete.v1": true,
	"gosh.target.input.add.v1": true, "gosh.target.input.remove.v1": true,
	"gosh.target.output.set.v1": true, "gosh.target.output.remove.v1": true,
	"gosh.target.env.set.v1": true, "gosh.target.env.remove.v1": true,
	"gosh.check.upsert.v1": true, "gosh.check.delete.v1": true,
}

func ParseEvents(r io.Reader) ([]Event, string, int, error) {
	all, err := io.ReadAll(r)
	if err != nil {
		return nil, "", 0, fmt.Errorf("read events: %w", err)
	}
	digest := sha256.Sum256(all)
	scanner := bufio.NewScanner(bytes.NewReader(all))
	scanner.Buffer(make([]byte, 4096), 4<<20)
	var events []Event
	lineNo := 0
	var lastRev *int64
	for scanner.Scan() {
		lineNo++
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		dec := json.NewDecoder(bytes.NewReader(line))
		dec.DisallowUnknownFields()
		var ev Event
		if err := dec.Decode(&ev); err != nil {
			return nil, "", lineNo, fmt.Errorf("line %d invalid JSON/event: %w", lineNo, err)
		}
		var trailing any
		if err := dec.Decode(&trailing); err != io.EOF {
			return nil, "", lineNo, fmt.Errorf("line %d contains trailing JSON", lineNo)
		}
		if !allowedKinds[ev.Kind] {
			return nil, "", lineNo, fmt.Errorf("line %d unknown kind/version %q", lineNo, ev.Kind)
		}
		if ev.Rev != nil {
			if lastRev != nil && *ev.Rev <= *lastRev {
				return nil, "", lineNo, fmt.Errorf("line %d rev must increase", lineNo)
			}
			v := *ev.Rev
			lastRev = &v
		}
		if err := validateEvent(ev); err != nil {
			return nil, "", lineNo, fmt.Errorf("line %d: %w", lineNo, err)
		}
		ev.SourceLine = lineNo
		events = append(events, ev)
	}
	if err := scanner.Err(); err != nil {
		return nil, "", lineNo, err
	}
	return events, hex.EncodeToString(digest[:]), lineNo, nil
}

func validateID(name, v string) error {
	if strings.TrimSpace(v) == "" {
		return fmt.Errorf("%s is required", name)
	}
	if strings.ContainsAny(v, "\r\n\x00") {
		return fmt.Errorf("%s contains control characters", name)
	}
	return nil
}

func validateEvent(ev Event) error {
	if err := rejectUnexpectedEventFields(ev); err != nil {
		return err
	}
	switch ev.Kind {
	case "gosh.tool.require.v1":
		if err := validateID("id", ev.ID); err != nil {
			return err
		}
		switch ev.Resolver {
		case "nix":
			if ev.Installable == "" || ev.ProgramRel == "" {
				return errors.New("nix tool requires installable and programRel")
			}
			if filepath.IsAbs(ev.ProgramRel) || strings.HasPrefix(filepath.Clean(ev.ProgramRel), "..") {
				return errors.New("programRel must be relative and contained")
			}
		case "absolute":
			if !filepath.IsAbs(ev.ProgramAbs) {
				return errors.New("absolute tool requires absolute programAbs")
			}
		default:
			return fmt.Errorf("unsupported resolver %q", ev.Resolver)
		}
	case "gosh.tool.remove.v1", "gosh.target.delete.v1", "gosh.check.delete.v1":
		return validateID("id", ev.ID)
	case "gosh.target.upsert.v1":
		if err := validateID("id", ev.ID); err != nil {
			return err
		}
		switch ev.TargetKind {
		case "stdio.pipeline":
			if len(ev.Stages) == 0 {
				return errors.New("stdio.pipeline requires stages")
			}
			if ev.Tool != "" || ev.Main != "" || ev.Path != "" || ev.Value != "" {
				return errors.New("stdio.pipeline accepts stages, not scalar execution fields")
			}
			for i, stage := range ev.Stages {
				if err := validateID(fmt.Sprintf("stages[%d].tool", i), stage.Tool); err != nil {
					return err
				}
				if strings.ContainsAny(stage.Cwd+stage.Stdin+stage.Stdout, "\x00") {
					return fmt.Errorf("stages[%d] contains NUL path", i)
				}
				if stage.TimeoutMS < 0 {
					return fmt.Errorf("stages[%d].timeoutMs must not be negative", i)
				}
			}
		case "exec":
			if err := validateID("tool", ev.Tool); err != nil {
				return err
			}
			if len(ev.Stages) != 0 || ev.Path != "" || ev.Value != "" || ev.Main != "" {
				return errors.New("exec accepts tool and args only")
			}
		case "go.binary":
			if err := validateID("tool", ev.Tool); err != nil {
				return err
			}
			if err := validateID("main", ev.Main); err != nil {
				return err
			}
			if len(ev.Stages) != 0 || ev.Path != "" || ev.Value != "" {
				return errors.New("go.binary accepts tool, main, and args only")
			}
		case "native.ensure-dir", "native.hash-file":
			if strings.TrimSpace(ev.Path) == "" {
				return errors.New("native target path is required")
			}
			if ev.Tool != "" || ev.Main != "" || len(ev.Args) != 0 || len(ev.Stages) != 0 || ev.Value != "" {
				return errors.New("native target contains unsupported execution fields")
			}
		case "native.write-file":
			if strings.TrimSpace(ev.Path) == "" {
				return errors.New("native target path is required")
			}
			if ev.Tool != "" || ev.Main != "" || len(ev.Args) != 0 || len(ev.Stages) != 0 {
				return errors.New("native.write-file contains unsupported execution fields")
			}
		default:
			return fmt.Errorf("unsupported targetKind %q", ev.TargetKind)
		}
	case "gosh.target.input.add.v1", "gosh.target.output.set.v1":
		if err := validateID("target", ev.Target); err != nil {
			return err
		}
		if err := validateID("id", ev.ID); err != nil {
			return err
		}
		if ev.Path == "" {
			return errors.New("path is required")
		}
	case "gosh.target.input.remove.v1", "gosh.target.output.remove.v1":
		if err := validateID("target", ev.Target); err != nil {
			return err
		}
		return validateID("id", ev.ID)
	case "gosh.target.env.set.v1":
		if err := validateID("target", ev.Target); err != nil {
			return err
		}
		return validateID("key", ev.Key)
	case "gosh.target.env.remove.v1":
		if err := validateID("target", ev.Target); err != nil {
			return err
		}
		return validateID("key", ev.Key)
	case "gosh.check.upsert.v1":
		if err := validateID("id", ev.ID); err != nil {
			return err
		}
		if err := validateID("target", ev.Target); err != nil {
			return err
		}
		return validateID("tool", ev.Tool)
	}
	return nil
}

func rejectUnexpectedEventFields(ev Event) error {
	allowed, ok := allowedFieldsByKind[ev.Kind]
	if !ok {
		return nil
	}
	encoded, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	fields := map[string]any{}
	if err := json.Unmarshal(encoded, &fields); err != nil {
		return err
	}
	delete(fields, "kind")
	delete(fields, "rev")
	for _, field := range allowed {
		delete(fields, field)
	}
	if len(fields) == 0 {
		return nil
	}
	names := make([]string, 0, len(fields))
	for field := range fields {
		names = append(names, field)
	}
	sort.Strings(names)
	return fmt.Errorf("unexpected fields for %s: %s", ev.Kind, strings.Join(names, ", "))
}

func Reduce(events []Event, inputSHA string, lineCount int) (State, error) {
	s := State{Tools: map[string]Tool{}, Targets: map[string]Target{}, Checks: map[string]Check{}, InputSHA: inputSHA, LineCount: lineCount}
	for i, ev := range events {
		line := ev.SourceLine
		if line == 0 {
			line = i + 1
		}
		switch ev.Kind {
		case "gosh.tool.require.v1":
			s.Tools[ev.ID] = Tool{ID: ev.ID, Resolver: ev.Resolver, Installable: ev.Installable, ProgramRel: ev.ProgramRel, ProgramAbs: ev.ProgramAbs, SourceLine: line}
		case "gosh.tool.remove.v1":
			t := s.Tools[ev.ID]
			t.ID = ev.ID
			t.Deleted = true
			t.SourceLine = line
			s.Tools[ev.ID] = t
		case "gosh.target.upsert.v1":
			old := s.Targets[ev.ID]
			if old.Deleted {
				old.Inputs = map[string]Member{}
				old.Outputs = map[string]Member{}
				old.Env = map[string]Member{}
			}
			if old.Inputs == nil {
				old.Inputs = map[string]Member{}
			}
			if old.Outputs == nil {
				old.Outputs = map[string]Member{}
			}
			if old.Env == nil {
				old.Env = map[string]Member{}
			}
			old.ID, old.Kind, old.Tool, old.Main, old.Path, old.Value = ev.ID, ev.TargetKind, ev.Tool, ev.Main, ev.Path, ev.Value
			old.Args, old.Stages, old.Mode, old.Deleted, old.SourceLine = append([]string(nil), ev.Args...), append([]StageSpec(nil), ev.Stages...), ev.Mode, false, line
			s.Targets[ev.ID] = old
		case "gosh.target.delete.v1":
			t := s.Targets[ev.ID]
			t.ID = ev.ID
			t.Deleted = true
			t.SourceLine = line
			s.Targets[ev.ID] = t
		case "gosh.target.input.add.v1":
			t, err := targetForMember(s, ev.Target)
			if err != nil {
				return State{}, fmt.Errorf("line %d: %w", line, err)
			}
			t.Inputs[ev.ID] = Member{ID: ev.ID, Value: ev.Path, SourceLine: line}
			s.Targets[ev.Target] = t
		case "gosh.target.input.remove.v1":
			t, err := targetForMember(s, ev.Target)
			if err != nil {
				return State{}, fmt.Errorf("line %d: %w", line, err)
			}
			m := t.Inputs[ev.ID]
			m.ID = ev.ID
			m.Deleted = true
			m.SourceLine = line
			t.Inputs[ev.ID] = m
			s.Targets[ev.Target] = t
		case "gosh.target.output.set.v1":
			t, err := targetForMember(s, ev.Target)
			if err != nil {
				return State{}, fmt.Errorf("line %d: %w", line, err)
			}
			t.Outputs[ev.ID] = Member{ID: ev.ID, Value: ev.Path, SourceLine: line}
			s.Targets[ev.Target] = t
		case "gosh.target.output.remove.v1":
			t, err := targetForMember(s, ev.Target)
			if err != nil {
				return State{}, fmt.Errorf("line %d: %w", line, err)
			}
			m := t.Outputs[ev.ID]
			m.ID = ev.ID
			m.Deleted = true
			m.SourceLine = line
			t.Outputs[ev.ID] = m
			s.Targets[ev.Target] = t
		case "gosh.target.env.set.v1":
			t, err := targetForMember(s, ev.Target)
			if err != nil {
				return State{}, fmt.Errorf("line %d: %w", line, err)
			}
			t.Env[ev.Key] = Member{ID: ev.Key, Value: ev.Value, SourceLine: line}
			s.Targets[ev.Target] = t
		case "gosh.target.env.remove.v1":
			t, err := targetForMember(s, ev.Target)
			if err != nil {
				return State{}, fmt.Errorf("line %d: %w", line, err)
			}
			m := t.Env[ev.Key]
			m.ID = ev.Key
			m.Deleted = true
			m.SourceLine = line
			t.Env[ev.Key] = m
			s.Targets[ev.Target] = t
		case "gosh.check.upsert.v1":
			s.Checks[ev.ID] = Check{ID: ev.ID, Target: ev.Target, Tool: ev.Tool, Args: append([]string(nil), ev.Args...), SourceLine: line}
		case "gosh.check.delete.v1":
			c := s.Checks[ev.ID]
			c.ID = ev.ID
			c.Deleted = true
			c.SourceLine = line
			s.Checks[ev.ID] = c
		}
	}
	return s, nil
}

func targetForMember(s State, id string) (Target, error) {
	t, ok := s.Targets[id]
	if !ok || t.Deleted {
		return Target{}, fmt.Errorf("target %q must exist before member update", id)
	}
	if t.Inputs == nil {
		t.Inputs = map[string]Member{}
	}
	if t.Outputs == nil {
		t.Outputs = map[string]Member{}
	}
	if t.Env == nil {
		t.Env = map[string]Member{}
	}
	return t, nil
}

func LoadState(r io.Reader) (State, error) {
	events, sha, lines, err := ParseEvents(r)
	if err != nil {
		return State{}, err
	}
	return Reduce(events, sha, lines)
}

func SortedToolIDs(s State) []string {
	ids := []string{}
	for id, v := range s.Tools {
		if !v.Deleted {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids
}
func SortedTargetIDs(s State) []string {
	ids := []string{}
	for id, v := range s.Targets {
		if !v.Deleted {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids
}
func SortedCheckIDs(s State) []string {
	ids := []string{}
	for id, v := range s.Checks {
		if !v.Deleted {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids
}

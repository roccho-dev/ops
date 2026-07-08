package validate

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"cuelang.org/go/cue"
	"cuelang.org/go/cue/cuecontext"
)

func ValidateLedger(opts ValidateOptions) (*Result, error) {
	if opts.MetaPath == "" {
		opts.MetaPath = "contracts/meta.cue"
	}
	if opts.LedgerPath == "" {
		return nil, errors.New("ledger path required")
	}
	if opts.RowValidator == "" {
		opts.RowValidator = "cue"
	}
	if opts.RowValidator != "cue" && opts.RowValidator != "fast" && opts.RowValidator != "both" {
		return nil, fmt.Errorf("invalid row validator %q", opts.RowValidator)
	}

	start := time.Now()
	metaBytes, err := os.ReadFile(opts.MetaPath)
	if err != nil {
		return nil, err
	}
	ctx := cuecontext.New()
	val := ctx.CompileBytes(metaBytes)
	if err := val.Err(); err != nil {
		return nil, fmt.Errorf("compile CUE: %w", err)
	}
	schema := val.LookupPath(cue.ParsePath("#ContractEvent"))
	if !schema.Exists() {
		return nil, errors.New("#ContractEvent not found in meta CUE")
	}

	r, err := OpenText(opts.LedgerPath)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	h := sha256.New()
	tr := io.TeeReader(r, h)
	scanner := bufio.NewScanner(tr)
	scanner.Buffer(make([]byte, 0, 1024*1024), 64*1024*1024)

	idx := NewIndex()
	res := &Result{
		Ledger: opts.LedgerPath, Meta: opts.MetaPath, StartedAt: start.UTC().Format(time.RFC3339), CountsByKind: map[string]int{}, RowValidator: opts.RowValidator,
		AffectedQueries: map[string][]string{}, AffectedFixtures: map[string][]string{}, UnresolvedAffected: map[string][]string{},
		Notes: []string{"CUE validates row shape and local policy; Go core indexes cross-row semantics and impact.", "The ledger is append-only: changes are new events, not in-place schema rewrites."},
	}
	var peak uint64
	lineNo := 0
	for scanner.Scan() {
		lineNo++
		b := scanner.Bytes()
		s := strings.TrimSpace(string(b))
		if s == "" {
			continue
		}
		var ev Event
		if err := json.Unmarshal([]byte(s), &ev); err != nil {
			res.CueErrors = append(res.CueErrors, fmt.Sprintf("line %d: invalid JSON: %v", lineNo, err))
			continue
		}
		if opts.RowValidator == "fast" || opts.RowValidator == "both" {
			if errs := FastValidate(ev); len(errs) > 0 {
				for _, e := range errs {
					res.CueErrors = append(res.CueErrors, fmt.Sprintf("line %d: fast: %s", lineNo, e))
				}
				continue
			}
			res.FastChecked++
		}
		if opts.RowValidator == "cue" || opts.RowValidator == "both" || (opts.CueSample > 0 && res.CueSampled < opts.CueSample) {
			v := schema.Unify(ctx.Encode(ev))
			if err := v.Validate(cue.Concrete(true)); err != nil {
				res.CueErrors = append(res.CueErrors, fmt.Sprintf("line %d: CUE: %v", lineNo, err))
				continue
			}
			res.CueChecked++
			if opts.RowValidator == "fast" || opts.RowValidator == "both" {
				res.CueSampled++
			}
		}
		IndexEvent(&idx, ev, lineNo, res)
		if lineNo%1000 == 0 {
			var m runtime.MemStats
			runtime.ReadMemStats(&m)
			if m.Alloc > peak {
				peak = m.Alloc
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if peak == 0 {
		var m runtime.MemStats
		runtime.ReadMemStats(&m)
		peak = m.Alloc
	}
	res.Lines = lineNo
	res.InputSHA256 = "sha256:" + hex.EncodeToString(h.Sum(nil))

	SemanticCheck(&idx, res)

	res.DurationMS = time.Since(start).Milliseconds()
	res.PeakAllocMB = float64(peak) / 1024.0 / 1024.0
	res.CountsByKind = idx.Counts
	res.Schemas = len(idx.Schemas)
	fields := 0
	for _, fs := range idx.Fields {
		fields += len(fs)
	}
	res.Fields = fields
	res.Edges = len(idx.Edges)
	res.Queries = len(idx.Queries)
	res.Fixtures = len(idx.Fixtures)
	res.DeprecatedFields = len(idx.Deprecated)
	CanonicalizeResult(res)

	out, err := json.MarshalIndent(res, "", "  ")
	if err != nil {
		return nil, err
	}
	rh := sha256.Sum256(out)
	res.ReportSHA256 = "sha256:" + hex.EncodeToString(rh[:])
	out, _ = json.MarshalIndent(res, "", "  ")

	if opts.ReportPath != "" {
		if err := os.MkdirAll(filepath.Dir(opts.ReportPath), 0755); err != nil {
			return nil, err
		}
		if err := os.WriteFile(opts.ReportPath, out, 0644); err != nil {
			return nil, err
		}
	}
	if len(res.CueErrors) > 0 || len(res.SemanticErrors) > 0 {
		return res, fmt.Errorf("validation failed: cue_errors=%d semantic_errors=%d", len(res.CueErrors), len(res.SemanticErrors))
	}
	return res, nil
}

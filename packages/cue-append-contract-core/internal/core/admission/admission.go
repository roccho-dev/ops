package admission

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	validate "cueappendcontract/internal/core/validate"
)

type AdmissionOptions struct{ Draft, Canonical, Receipt, Generated string }

func Admit(opts AdmissionOptions) (map[string]any, error) {
	if opts.Draft == "" || opts.Canonical == "" || opts.Receipt == "" {
		return nil, fmt.Errorf("draft, canonical, and receipt are required")
	}
	status := "accepted"
	errText := ""
	if err := ValidateLedgerShapeAndSemantics(opts.Draft); err != nil {
		status = "rejected"
		errText = err.Error()
	}
	rec := validate.Event{"kind": "admission.receipt.v1", "status": status, "draft": opts.Draft, "canonical": opts.Canonical, "draft_hash": mustHash(opts.Draft), "created_at": "2026-07-05T00:00:00Z"}
	if errText != "" {
		rec["error"] = errText
	}
	if err := appendJSONL(opts.Receipt, rec); err != nil {
		return nil, err
	}
	if status != "accepted" {
		return map[string]any{"status": status, "error": errText}, fmt.Errorf("admission rejected: %s", errText)
	}
	b, err := os.ReadFile(opts.Draft)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(opts.Canonical), 0755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(opts.Canonical, b, 0644); err != nil {
		return nil, err
	}
	return map[string]any{"status": "accepted", "draft": opts.Draft, "canonical": opts.Canonical, "draft_hash": rec["draft_hash"]}, nil
}

func ValidateLedgerShapeAndSemantics(path string) error {
	events, err := validate.ReadJSONL(path)
	if err != nil {
		return err
	}
	for _, ev := range events {
		if errs := validate.FastValidate(ev); len(errs) > 0 {
			return fmt.Errorf("line %v: %s", ev["__line__"], strings.Join(errs, "; "))
		}
	}
	_, errs := validate.BuildIndex(events)
	if len(errs) > 0 {
		return fmt.Errorf(strings.Join(validate.LimitStrings(errs, 10), "; "))
	}
	return nil
}

func VerifyCanonical(canonical, receipt string) (map[string]any, error) {
	ch, err := validate.HashFile(canonical)
	if err != nil {
		return nil, err
	}
	rows, err := validate.ReadJSONL(receipt)
	if err != nil {
		return nil, err
	}
	ok := false
	for _, r := range rows {
		if validate.Str(r["kind"]) == "admission.receipt.v1" && validate.Str(r["status"]) == "accepted" && validate.Str(r["canonical"]) == canonical && validate.Str(r["draft_hash"]) == ch {
			ok = true
		}
	}
	if !ok {
		return nil, fmt.Errorf("canonical ledger has no matching admission receipt")
	}
	return map[string]any{"status": "pass", "check": "canonical-admission", "canonical_hash": ch}, nil
}

func appendJSONL(path string, row validate.Event) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()
	b, _ := json.Marshal(row)
	_, err = f.Write(append(b, '\n'))
	return err
}
func mustHash(path string) string {
	h, err := validate.HashFile(path)
	if err != nil {
		return ""
	}
	return h
}

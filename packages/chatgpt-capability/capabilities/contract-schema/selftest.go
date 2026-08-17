package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
)

func runSelftest() error {
	valid, err := embedded.ReadFile("fixtures/valid.contract.jsonl")
	if err != nil {
		return err
	}
	state, err := validateLedger(valid, nil)
	if err != nil {
		return fmt.Errorf("valid ledger rejected: %w", err)
	}
	base, err := embedded.ReadFile("fixtures/rewrite-base.contract.jsonl")
	if err != nil {
		return err
	}
	rewrite, err := embedded.ReadFile("fixtures/rewrite-mutated.contract.jsonl")
	if err != nil {
		return err
	}
	if _, err := validateLedger(rewrite, base); err == nil {
		return fmt.Errorf("rewritten ledger was accepted")
	}
	invalidRef, err := embedded.ReadFile("fixtures/invalid-reference.contract.jsonl")
	if err != nil {
		return err
	}
	if _, err := validateLedger(invalidRef, nil); err == nil {
		return fmt.Errorf("missing semantic reference was accepted")
	}
	invalidShape, err := embedded.ReadFile("fixtures/invalid-shape.contract.jsonl")
	if err != nil {
		return err
	}
	if _, err := validateLedger(invalidShape, nil); err == nil {
		return fmt.Errorf("invalid shape was accepted")
	}
	meta, err := embedded.ReadFile("contracts/meta.cue")
	if err != nil {
		return err
	}
	parent, err := os.MkdirTemp("", "contract-schema-selftest-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(parent)
	first := filepath.Join(parent, "a")
	second := filepath.Join(parent, "b")
	if err := writeProjection(first, valid, meta, state); err != nil {
		return err
	}
	if err := writeProjection(second, valid, meta, state); err != nil {
		return err
	}
	if err := verifyProjectionManifest(first); err != nil {
		return err
	}
	if err := verifyProjectionManifest(second); err != nil {
		return err
	}
	firstDigest, err := normalizedProjectionDigest(first)
	if err != nil {
		return err
	}
	secondDigest, err := normalizedProjectionDigest(second)
	if err != nil {
		return err
	}
	if !bytes.Equal([]byte(firstDigest), []byte(secondDigest)) {
		return fmt.Errorf("projection is not deterministic")
	}
	fmt.Println("contract-schema-validator selftest PASS")
	return nil
}

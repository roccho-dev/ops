package appendonly

import (
	"bufio"
	"fmt"

	validate "cueappendcontract/internal/core/validate"
)

type Result struct {
	Status       string `json:"status"`
	Check        string `json:"check"`
	Base         string `json:"base"`
	Candidate    string `json:"candidate"`
	PreviousHash string `json:"previous_hash"`
	LedgerHash   string `json:"ledger_hash"`
	BaseLines    int    `json:"base_lines"`
	LedgerLines  int    `json:"ledger_lines"`
	PrefixLines  int    `json:"prefix_lines"`
}

// Check enforces physical append-only evolution: the candidate ledger must keep the
// exact logical JSONL line prefix of the previous ledger and may only append lines.
func Check(base, candidate string) (*Result, error) {
	baseLines, err := readLines(base)
	if err != nil {
		return nil, err
	}
	candidateLines, err := readLines(candidate)
	if err != nil {
		return nil, err
	}
	previousHash, err := validate.HashFile(base)
	if err != nil {
		return nil, err
	}
	ledgerHash, err := validate.HashFile(candidate)
	if err != nil {
		return nil, err
	}
	res := &Result{
		Status:       "pass",
		Check:        "append-only",
		Base:         base,
		Candidate:    candidate,
		PreviousHash: previousHash,
		LedgerHash:   ledgerHash,
		BaseLines:    len(baseLines),
		LedgerLines:  len(candidateLines),
	}
	if len(candidateLines) < len(baseLines) {
		res.Status = "fail"
		return res, fmt.Errorf("candidate has fewer lines than base: base=%d candidate=%d", len(baseLines), len(candidateLines))
	}
	for i, line := range baseLines {
		if candidateLines[i] != line {
			res.Status = "fail"
			res.PrefixLines = i
			return res, fmt.Errorf("append-only prefix mismatch at line %d", i+1)
		}
		res.PrefixLines = i + 1
	}
	return res, nil
}

func readLines(path string) ([]string, error) {
	r, err := validate.OpenText(path)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 1024*1024), 64*1024*1024)
	var lines []string
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	return lines, scanner.Err()
}

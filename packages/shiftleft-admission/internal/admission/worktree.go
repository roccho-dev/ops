package admission

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type WorktreeVerification struct {
	Schema        string `json:"schema"`
	Status        string `json:"status"`
	PolicyHash    string `json:"policyHash"`
	BaseTree      string `json:"baseTree"`
	CandidateTree string `json:"candidateTree"`
	ReceiptDigest string `json:"receiptDigest"`
}

func gitText(repo string, env []string, args ...string) (string, error) {
	cmd := exec.Command("git", append([]string{"-C", repo}, args...)...)
	if env != nil {
		cmd.Env = env
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("GIT_WORKTREE_INSPECTION_FAILED: git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return strings.TrimSpace(string(out)), nil
}

func WorktreeTreeRefs(repo string) (string, string, error) {
	abs, err := filepath.Abs(repo)
	if err != nil {
		return "", "", err
	}
	inside, err := gitText(abs, nil, "rev-parse", "--is-inside-work-tree")
	if err != nil || inside != "true" {
		return "", "", fmt.Errorf("INVALID_WORKTREE: %s", abs)
	}
	base, err := gitText(abs, nil, "rev-parse", "HEAD^{tree}")
	if err != nil {
		return "", "", err
	}
	baseRef := "git-tree-sha1:" + base
	if err := ValidateTreeRef(baseRef); err != nil {
		return "", "", err
	}

	tmp, err := os.MkdirTemp("", "shiftleft-worktree-")
	if err != nil {
		return "", "", err
	}
	defer os.RemoveAll(tmp)
	index := filepath.Join(tmp, "index")
	env := append(os.Environ(), "GIT_INDEX_FILE="+index)
	if _, err := gitText(abs, env, "read-tree", "HEAD"); err != nil {
		return "", "", err
	}
	if _, err := gitText(abs, env, "add", "-A", "--", "."); err != nil {
		return "", "", err
	}
	candidate, err := gitText(abs, env, "write-tree")
	if err != nil {
		return "", "", err
	}
	candidateRef := "git-tree-sha1:" + candidate
	if err := ValidateTreeRef(candidateRef); err != nil {
		return "", "", err
	}
	return baseRef, candidateRef, nil
}

func RunVerifyWorktreeCLI(args []string, stdout, stderr io.Writer) error {
	fs := newFlagSet("verify-worktree", stderr)
	receiptPath := fs.String("receipt", "", "Shift Left receipt")
	hash := fs.String("policy-sha256", "", "expected policy SHA-256")
	repo := fs.String("repo", "", "candidate Git worktree")
	if err := fs.Parse(args); err != nil {
		return &ExitError{Code: 2, Msg: err.Error()}
	}
	for n, v := range map[string]string{"receipt": *receiptPath, "policy-sha256": *hash, "repo": *repo} {
		if err := required(n, v); err != nil {
			return &ExitError{Code: 2, Msg: err.Error()}
		}
	}
	data, err := os.ReadFile(*receiptPath)
	if err != nil {
		return fmt.Errorf("RECEIPT_READ_FAILED: %w", err)
	}
	var r Receipt
	if err := json.Unmarshal(data, &r); err != nil {
		return fmt.Errorf("RECEIPT_PARSE_FAILED: %w", err)
	}
	if err := ValidateExactPolicyRef(r.PolicyRef); err != nil {
		return fmt.Errorf("FORMAL_POLICY_REQUIRED: %w", err)
	}
	base, candidate, err := WorktreeTreeRefs(*repo)
	if err != nil {
		return err
	}
	if err := VerifyReceiptBinding(r, *hash, base, candidate); err != nil {
		return err
	}
	if r.Verdict != "PASS" || r.TerminalState != "PASS" || r.Counts.Unmet != 0 || r.Counts.RequiredUnobserved != 0 || r.Counts.BlockerCount != 0 || r.Counts.ReviewCount != 0 || r.Counts.UnsupportedRequired != 0 {
		return fmt.Errorf("RECEIPT_NOT_PASS: verdict=%s terminal=%s", r.Verdict, r.TerminalState)
	}
	result := WorktreeVerification{
		Schema:        "shiftleft-worktree-verification/1",
		Status:        "PASS",
		PolicyHash:    r.PolicyHash,
		BaseTree:      base,
		CandidateTree: candidate,
		ReceiptDigest: r.ReceiptDigest,
	}
	return json.NewEncoder(stdout).Encode(result)
}

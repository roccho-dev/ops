package semanticlog

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

const ResultSchema = "semantic-intent.result.v1"

type LocalState string
type GitHubState string

const (
	LocalAccepted LocalState = "accepted"
	LocalNoChange LocalState = "no_change"
	LocalRejected LocalState = "rejected"
	LocalFailed   LocalState = "failed"
	LocalUnknown  LocalState = "unknown"

	GitHubNotStarted      GitHubState = "not_started"
	GitHubPending         GitHubState = "pending"
	GitHubApplied         GitHubState = "applied"
	GitHubUnknown         GitHubState = "unknown"
	GitHubPermanentFailure GitHubState = "permanent_failure"
)

var ErrInvalidResult = errors.New("invalid semantic intent result")

type Result struct {
	Schema      string      `json:"schema"`
	IntentID    string      `json:"intent_id"`
	LocalState  LocalState  `json:"local_state"`
	GitHubState GitHubState `json:"github_state"`
	IssueNumber *int64      `json:"issue_number,omitempty"`
	CommentID   *int64      `json:"comment_id,omitempty"`
	ReceiptID   *string     `json:"receipt_id,omitempty"`
}

func (result Result) Validate() error {
	if result.Schema != ResultSchema {
		return fmt.Errorf("%w: schema must be %q", ErrInvalidResult, ResultSchema)
	}
	if err := validateToken("intent_id", result.IntentID, MaxIdentifierBytes); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidResult, err)
	}
	if !validLocalState(result.LocalState) {
		return fmt.Errorf("%w: unsupported local_state %q", ErrInvalidResult, result.LocalState)
	}
	if !validGitHubState(result.GitHubState) {
		return fmt.Errorf("%w: unsupported github_state %q", ErrInvalidResult, result.GitHubState)
	}
	if result.IssueNumber != nil && *result.IssueNumber <= 0 {
		return fmt.Errorf("%w: issue_number must be positive", ErrInvalidResult)
	}
	if result.CommentID != nil && *result.CommentID <= 0 {
		return fmt.Errorf("%w: comment_id must be positive", ErrInvalidResult)
	}
	if result.CommentID != nil && result.IssueNumber == nil {
		return fmt.Errorf("%w: comment_id requires issue_number", ErrInvalidResult)
	}
	if result.GitHubState == GitHubApplied && result.IssueNumber == nil {
		return fmt.Errorf("%w: github_state=applied requires issue_number", ErrInvalidResult)
	}
	if result.ReceiptID != nil {
		if err := validateToken("receipt_id", *result.ReceiptID, MaxIdentifierBytes); err != nil {
			return fmt.Errorf("%w: %v", ErrInvalidResult, err)
		}
	}
	return nil
}

func (result Result) CanonicalBytes() ([]byte, error) {
	if err := result.Validate(); err != nil {
		return nil, err
	}
	var b bytes.Buffer
	b.WriteByte('{')
	appendField(&b, "schema", result.Schema, false)
	appendField(&b, "intent_id", result.IntentID, true)
	appendField(&b, "local_state", string(result.LocalState), true)
	appendField(&b, "github_state", string(result.GitHubState), true)
	if result.IssueNumber != nil {
		fmt.Fprintf(&b, ",\"issue_number\":%d", *result.IssueNumber)
	}
	if result.CommentID != nil {
		fmt.Fprintf(&b, ",\"comment_id\":%d", *result.CommentID)
	}
	if result.ReceiptID != nil {
		appendField(&b, "receipt_id", *result.ReceiptID, true)
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}

func DecodeResult(data []byte) (Result, error) {
	if !bytes.Equal(data, bytes.TrimSpace(data)) {
		return Result{}, fmt.Errorf("%w: result has leading or trailing whitespace", ErrInvalidResult)
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var result Result
	if err := decoder.Decode(&result); err != nil {
		return Result{}, fmt.Errorf("%w: %v", ErrInvalidResult, err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return Result{}, fmt.Errorf("%w: trailing JSON value", ErrInvalidResult)
	}
	if err := result.Validate(); err != nil {
		return Result{}, err
	}
	canonical, err := result.CanonicalBytes()
	if err != nil {
		return Result{}, err
	}
	if !bytes.Equal(data, canonical) {
		return Result{}, fmt.Errorf("%w: result is not canonical bytes", ErrInvalidResult)
	}
	return result, nil
}

func validLocalState(value LocalState) bool {
	switch value {
	case LocalAccepted, LocalNoChange, LocalRejected, LocalFailed, LocalUnknown:
		return true
	default:
		return false
	}
}

func validGitHubState(value GitHubState) bool {
	switch value {
	case GitHubNotStarted, GitHubPending, GitHubApplied, GitHubUnknown, GitHubPermanentFailure:
		return true
	default:
		return false
	}
}

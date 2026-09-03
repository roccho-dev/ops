package semanticlog

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"
)

const (
	IntentSchema   = "semantic-intent.v1"
	IntentKind     = "record"
	MaxIDBytes     = 128
	MaxRefKindBytes = 64
	MaxTitleChars  = 256
	MaxBodyChars   = 16 * 1024
)

var ErrInvalidIntent = errors.New("invalid semantic intent")

type TargetRef struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

// Intent is the exact browser-owned V1 contract shared with ui#198/ui#199.
// IntentID is the sole logical/idempotency identity.
type Intent struct {
	Schema     string     `json:"schema"`
	IntentID   string     `json:"intent_id"`
	TopicID    string     `json:"topic_id"`
	Kind       string     `json:"kind"`
	Body       string     `json:"body"`
	TopicTitle *string    `json:"topic_title,omitempty"`
	TargetRef  *TargetRef `json:"target_ref,omitempty"`
}

func DecodeIntent(data []byte) (Intent, error) {
	if !utf8.Valid(data) {
		return Intent{}, fmt.Errorf("%w: input is not valid UTF-8", ErrInvalidIntent)
	}
	fields, err := inspectTopLevelObject(data)
	if err != nil {
		return Intent{}, err
	}
	for _, optional := range []string{"topic_title", "target_ref"} {
		if raw, present := fields[optional]; present && bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			return Intent{}, fmt.Errorf("%w: %s must not be null", ErrInvalidIntent, optional)
		}
	}

	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var intent Intent
	if err := decoder.Decode(&intent); err != nil {
		return Intent{}, fmt.Errorf("%w: %v", ErrInvalidIntent, err)
	}
	if err := requireEOF(decoder); err != nil {
		return Intent{}, err
	}
	if err := intent.Validate(); err != nil {
		return Intent{}, err
	}
	return intent, nil
}

func (intent Intent) Validate() error {
	if intent.Schema != IntentSchema {
		return fmt.Errorf("%w: schema must be %q", ErrInvalidIntent, IntentSchema)
	}
	if err := validateToken("intent_id", intent.IntentID, MaxIDBytes); err != nil {
		return err
	}
	if err := validateToken("topic_id", intent.TopicID, MaxIDBytes); err != nil {
		return err
	}
	if intent.Kind != IntentKind {
		return fmt.Errorf("%w: kind must be %q", ErrInvalidIntent, IntentKind)
	}
	if !utf8.ValidString(intent.Body) || !containsSemanticCharacter(intent.Body) {
		return fmt.Errorf("%w: body must be valid UTF-8 with a non-whitespace character", ErrInvalidIntent)
	}
	if utf8.RuneCountInString(intent.Body) > MaxBodyChars {
		return fmt.Errorf("%w: body exceeds %d characters", ErrInvalidIntent, MaxBodyChars)
	}
	if intent.TopicTitle != nil {
		if !utf8.ValidString(*intent.TopicTitle) || !containsSemanticCharacter(*intent.TopicTitle) {
			return fmt.Errorf("%w: topic_title must contain a non-whitespace character", ErrInvalidIntent)
		}
		if utf8.RuneCountInString(*intent.TopicTitle) > MaxTitleChars {
			return fmt.Errorf("%w: topic_title exceeds %d characters", ErrInvalidIntent, MaxTitleChars)
		}
	}
	if intent.TargetRef != nil {
		if err := validateToken("target_ref.kind", intent.TargetRef.Kind, MaxRefKindBytes); err != nil {
			return err
		}
		if err := validateToken("target_ref.id", intent.TargetRef.ID, MaxIDBytes); err != nil {
			return err
		}
	}
	return nil
}

// CanonicalBytes is the shared serialized byte contract: compact JSON in this
// fixed field order, with optional fields omitted when absent and no newline.
func (intent Intent) CanonicalBytes() ([]byte, error) {
	if err := intent.Validate(); err != nil {
		return nil, err
	}
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(intent); err != nil {
		return nil, fmt.Errorf("encode canonical intent: %w", err)
	}
	return bytes.TrimSuffix(buffer.Bytes(), []byte("\n")), nil
}

func (intent Intent) Digest() (string, error) {
	canonical, err := intent.CanonicalBytes()
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(canonical)
	return hex.EncodeToString(sum[:]), nil
}

func containsSemanticCharacter(value string) bool {
	for _, r := range value {
		if r != ' ' && r != '\t' && r != '\r' && r != '\n' {
			return true
		}
	}
	return false
}

func validateToken(name, value string, maxBytes int) error {
	if value == "" {
		return fmt.Errorf("%w: %s is required", ErrInvalidIntent, name)
	}
	if value != strings.TrimSpace(value) {
		return fmt.Errorf("%w: %s must not contain outer whitespace", ErrInvalidIntent, name)
	}
	if len(value) > maxBytes {
		return fmt.Errorf("%w: %s exceeds %d bytes", ErrInvalidIntent, name, maxBytes)
	}
	for index, r := range value {
		allowed := r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9'
		if index > 0 && (r == '.' || r == '_' || r == ':' || r == '/' || r == '-') {
			allowed = true
		}
		if !allowed {
			return fmt.Errorf("%w: %s contains an unsupported character", ErrInvalidIntent, name)
		}
	}
	return nil
}

func inspectTopLevelObject(data []byte) (map[string]json.RawMessage, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	opening, err := decoder.Token()
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidIntent, err)
	}
	delimiter, ok := opening.(json.Delim)
	if !ok || delimiter != '{' {
		return nil, fmt.Errorf("%w: input must be one JSON object", ErrInvalidIntent)
	}
	seen := make(map[string]struct{})
	fields := make(map[string]json.RawMessage)
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrInvalidIntent, err)
		}
		key, ok := token.(string)
		if !ok {
			return nil, fmt.Errorf("%w: object key must be a string", ErrInvalidIntent)
		}
		if _, duplicate := seen[key]; duplicate {
			return nil, fmt.Errorf("%w: duplicate field %q", ErrInvalidIntent, key)
		}
		seen[key] = struct{}{}
		var raw json.RawMessage
		if err := decoder.Decode(&raw); err != nil {
			return nil, fmt.Errorf("%w: %v", ErrInvalidIntent, err)
		}
		fields[key] = append(json.RawMessage(nil), raw...)
	}
	if _, err := decoder.Token(); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidIntent, err)
	}
	if err := requireEOF(decoder); err != nil {
		return nil, err
	}
	return fields, nil
}

func requireEOF(decoder *json.Decoder) error {
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return fmt.Errorf("%w: trailing JSON value", ErrInvalidIntent)
		}
		return fmt.Errorf("%w: %v", ErrInvalidIntent, err)
	}
	return nil
}

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
	IntentSchema       = "semantic-intent.v1"
	IntentKind         = "record"
	MaxIdentifierBytes = 128
	MaxTargetKindBytes = 64
	MaxTopicTitleBytes = 256
	MaxBodyBytes       = 16 * 1024
	MaxRequestBytes    = 32 * 1024
)

var ErrInvalidIntent = errors.New("invalid semantic intent")

type TargetRef struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

type Intent struct {
	Schema     string     `json:"schema"`
	IntentID   string     `json:"intent_id"`
	TopicID    string     `json:"topic_id"`
	Kind       string     `json:"kind"`
	Body       string     `json:"body"`
	TopicTitle *string    `json:"topic_title,omitempty"`
	TargetRef  *TargetRef `json:"target_ref,omitempty"`
}

// DecodeIntent accepts only the exact canonical prepared wire bytes shared with
// the browser client. Equivalent JSON with different spacing/order is rejected
// so the idempotency digest is unambiguous across UI and OPS.
func DecodeIntent(data []byte) (Intent, error) {
	if len(data) > MaxRequestBytes {
		return Intent{}, fmt.Errorf("%w: request exceeds %d UTF-8 bytes", ErrInvalidIntent, MaxRequestBytes)
	}
	if !utf8.Valid(data) {
		return Intent{}, fmt.Errorf("%w: input is not valid UTF-8", ErrInvalidIntent)
	}
	fields, err := inspectTopLevelObject(data)
	if err != nil {
		return Intent{}, err
	}
	for _, optional := range []string{"topic_title", "target_ref"} {
		if raw, present := fields[optional]; present && bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			return Intent{}, fmt.Errorf("%w: %s must be omitted rather than null", ErrInvalidIntent, optional)
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
	canonical, err := intent.CanonicalBytes()
	if err != nil {
		return Intent{}, err
	}
	if !bytes.Equal(data, canonical) {
		return Intent{}, fmt.Errorf("%w: request is not canonical prepared bytes", ErrInvalidIntent)
	}
	return intent, nil
}

func (intent Intent) Validate() error {
	if intent.Schema != IntentSchema {
		return fmt.Errorf("%w: schema must be %q", ErrInvalidIntent, IntentSchema)
	}
	if err := validateToken("intent_id", intent.IntentID, MaxIdentifierBytes); err != nil {
		return err
	}
	if err := validateToken("topic_id", intent.TopicID, MaxIdentifierBytes); err != nil {
		return err
	}
	if intent.Kind != IntentKind {
		return fmt.Errorf("%w: kind must be %q", ErrInvalidIntent, IntentKind)
	}
	if err := validateText("body", intent.Body, MaxBodyBytes); err != nil {
		return err
	}
	if intent.TopicTitle != nil {
		if err := validateText("topic_title", *intent.TopicTitle, MaxTopicTitleBytes); err != nil {
			return err
		}
	}
	if intent.TargetRef != nil {
		if err := validateToken("target_ref.kind", intent.TargetRef.Kind, MaxTargetKindBytes); err != nil {
			return err
		}
		if err := validateToken("target_ref.id", intent.TargetRef.ID, MaxIdentifierBytes); err != nil {
			return err
		}
	}
	canonical, err := intent.canonicalBytesUnchecked()
	if err != nil {
		return err
	}
	if len(canonical) > MaxRequestBytes {
		return fmt.Errorf("%w: request exceeds %d UTF-8 bytes", ErrInvalidIntent, MaxRequestBytes)
	}
	return nil
}

func (intent Intent) CanonicalBytes() ([]byte, error) {
	if err := intent.Validate(); err != nil {
		return nil, err
	}
	return intent.canonicalBytesUnchecked()
}

func (intent Intent) canonicalBytesUnchecked() ([]byte, error) {
	if !utf8.ValidString(intent.Body) {
		return nil, fmt.Errorf("%w: body is not valid UTF-8", ErrInvalidIntent)
	}
	var b bytes.Buffer
	b.WriteByte('{')
	appendField(&b, "schema", intent.Schema, false)
	appendField(&b, "intent_id", intent.IntentID, true)
	appendField(&b, "topic_id", intent.TopicID, true)
	appendField(&b, "kind", intent.Kind, true)
	appendField(&b, "body", intent.Body, true)
	if intent.TopicTitle != nil {
		appendField(&b, "topic_title", *intent.TopicTitle, true)
	}
	if intent.TargetRef != nil {
		b.WriteString(",\"target_ref\":{")
		appendField(&b, "kind", intent.TargetRef.Kind, false)
		appendField(&b, "id", intent.TargetRef.ID, true)
		b.WriteByte('}')
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}

func (intent Intent) Digest() (string, error) {
	canonical, err := intent.CanonicalBytes()
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(canonical)
	return hex.EncodeToString(sum[:]), nil
}

func appendField(b *bytes.Buffer, key, value string, comma bool) {
	if comma {
		b.WriteByte(',')
	}
	appendJSONString(b, key)
	b.WriteByte(':')
	appendJSONString(b, value)
}

// appendJSONString follows JSON.stringify string escaping for valid Unicode:
// quotes, backslashes and C0 controls are escaped; other runes are UTF-8 bytes.
func appendJSONString(b *bytes.Buffer, value string) {
	b.WriteByte('"')
	for _, r := range value {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			if r < 0x20 {
				fmt.Fprintf(b, `\u%04x`, r)
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
}

func validateText(name, value string, maxBytes int) error {
	if !utf8.ValidString(value) {
		return fmt.Errorf("%w: %s is not valid UTF-8", ErrInvalidIntent, name)
	}
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%w: %s must not be blank", ErrInvalidIntent, name)
	}
	for _, r := range value {
		if (r >= 0 && r <= 0x08) || r == 0x0b || r == 0x0c || (r >= 0x0e && r <= 0x1f) || r == 0x7f {
			return fmt.Errorf("%w: %s contains a forbidden control character", ErrInvalidIntent, name)
		}
	}
	if len([]byte(value)) > maxBytes {
		return fmt.Errorf("%w: %s exceeds %d UTF-8 bytes", ErrInvalidIntent, name, maxBytes)
	}
	return nil
}

func validateToken(name, value string, maxBytes int) error {
	if value == "" {
		return fmt.Errorf("%w: %s is required", ErrInvalidIntent, name)
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

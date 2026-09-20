package semanticlog

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"strings"
	"testing"
)

func TestExactUIRequestFixture(t *testing.T) {
	data, err := os.ReadFile("fixtures/semantic-intent-v1/request.json")
	if err != nil {
		t.Fatal(err)
	}
	if len(data) != 230 {
		t.Fatalf("fixture bytes = %d, want 230", len(data))
	}
	sum := sha256.Sum256(data)
	if got := hex.EncodeToString(sum[:]); got != "8a094d3755e5f196b29d10ade7a259bba5f0f67ab243950180457969e015bb29" {
		t.Fatalf("fixture sha256 = %s", got)
	}
	intent, err := DecodeIntent(data)
	if err != nil {
		t.Fatalf("DecodeIntent() error = %v", err)
	}
	if intent.IntentID != "intent-001" || intent.TopicID != "ui-198" || intent.TargetRef == nil {
		t.Fatalf("unexpected intent: %#v", intent)
	}
	canonical, err := intent.CanonicalBytes()
	if err != nil {
		t.Fatal(err)
	}
	if string(canonical) != string(data) {
		t.Fatal("canonical bytes differ from exact UI fixture")
	}
	digest, err := intent.Digest()
	if err != nil {
		t.Fatal(err)
	}
	if digest != "8a094d3755e5f196b29d10ade7a259bba5f0f67ab243950180457969e015bb29" {
		t.Fatalf("digest = %s", digest)
	}
}

func TestDecodeIntentRejectsNonCanonicalOrUnsafeInputs(t *testing.T) {
	valid := `{"schema":"semantic-intent.v1","intent_id":"e1","topic_id":"t1","kind":"record","body":"x"}`
	tests := map[string][]byte{
		"old schema":       []byte(`{"schema":"semantic.intent.v1","intent_id":"e1","topic_id":"t1","kind":"record","body":"x"}`),
		"old event id":     []byte(`{"schema":"semantic-intent.v1","event_id":"e1","topic_id":"t1","kind":"record","body":"x"}`),
		"wrong kind":       []byte(`{"schema":"semantic-intent.v1","intent_id":"e1","topic_id":"t1","kind":"note","body":"x"}`),
		"unknown field":    []byte(`{"schema":"semantic-intent.v1","intent_id":"e1","topic_id":"t1","kind":"record","body":"x","extra":true}`),
		"duplicate field":  []byte(`{"schema":"semantic-intent.v1","intent_id":"e1","intent_id":"e2","topic_id":"t1","kind":"record","body":"x"}`),
		"missing body":     []byte(`{"schema":"semantic-intent.v1","intent_id":"e1","topic_id":"t1","kind":"record"}`),
		"null title":       []byte(`{"schema":"semantic-intent.v1","intent_id":"e1","topic_id":"t1","kind":"record","body":"x","topic_title":null}`),
		"null target":      []byte(`{"schema":"semantic-intent.v1","intent_id":"e1","topic_id":"t1","kind":"record","body":"x","target_ref":null}`),
		"target path":      []byte(`{"schema":"semantic-intent.v1","intent_id":"e1","topic_id":"t1","kind":"record","body":"x","target_ref":{"kind":"component","id":"x","path":"/tmp"}}`),
		"property order":   []byte(`{"intent_id":"e1","schema":"semantic-intent.v1","topic_id":"t1","kind":"record","body":"x"}`),
		"leading space":    []byte(" " + valid),
		"trailing newline": []byte(valid + "\n"),
		"escaped rune":     []byte(`{"schema":"semantic-intent.v1","intent_id":"e1","topic_id":"t1","kind":"record","body":"\u0078"}`),
		"blank body":       []byte(`{"schema":"semantic-intent.v1","intent_id":"e1","topic_id":"t1","kind":"record","body":" \t\n"}`),
		"forbidden control": []byte(`{"schema":"semantic-intent.v1","intent_id":"e1","topic_id":"t1","kind":"record","body":"x\u0001"}`),
		"invalid id":       []byte(`{"schema":"semantic-intent.v1","intent_id":"bad id","topic_id":"t1","kind":"record","body":"x"}`),
		"invalid utf8":     append([]byte(`{"schema":"semantic-intent.v1","intent_id":"e1","topic_id":"t1","kind":"record","body":"`), 0xff),
	}
	for name, data := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := DecodeIntent(data); !errors.Is(err, ErrInvalidIntent) {
				t.Fatalf("DecodeIntent() error = %v", err)
			}
		})
	}
}

func TestUTF8ByteLimitsMatchParentContract(t *testing.T) {
	body := strings.Repeat("界", MaxBodyBytes/3)
	intent := Intent{Schema: IntentSchema, IntentID: "e1", TopicID: "t1", Kind: IntentKind, Body: body}
	if err := intent.Validate(); err != nil {
		t.Fatalf("Validate() rejected %d bytes: %v", len([]byte(body)), err)
	}
	intent.Body += "界"
	if !errors.Is(intent.Validate(), ErrInvalidIntent) {
		t.Fatalf("Validate() accepted %d body bytes", len([]byte(intent.Body)))
	}
}

func TestCanonicalJSONStringMatchesBrowserEscaping(t *testing.T) {
	intent := Intent{Schema: IntentSchema, IntentID: "e1", TopicID: "t1", Kind: IntentKind, Body: "<>&\u2028line\n\t\"\\"}
	data, err := intent.CanonicalBytes()
	if err != nil {
		t.Fatal(err)
	}
	want := "{\"schema\":\"semantic-intent.v1\",\"intent_id\":\"e1\",\"topic_id\":\"t1\",\"kind\":\"record\",\"body\":\"<>&\u2028line\\n\\t\\\"\\\\\"}"
	if string(data) != want {
		t.Fatalf("canonical = %q\nwant      = %q", data, want)
	}
}

func TestWholeRequestLimit(t *testing.T) {
	data := []byte(strings.Repeat("x", MaxRequestBytes+1))
	if _, err := DecodeIntent(data); !errors.Is(err, ErrInvalidIntent) {
		t.Fatalf("oversized request error = %v", err)
	}
}

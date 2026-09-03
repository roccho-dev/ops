package semanticlog

import (
	"errors"
	"strings"
	"testing"
)

func TestDecodeIntentAcceptsClosedContract(t *testing.T) {
	input := []byte(`{"body":"keep this decision","kind":"note","topic_id":"ops/374","event_id":"01J.TEST-1","schema":"semantic.intent.v1","title":"Minimum runtime"}`)
	intent, err := DecodeIntent(input)
	if err != nil {
		t.Fatalf("DecodeIntent() error = %v", err)
	}
	if intent.EventID != "01J.TEST-1" || intent.TopicID != "ops/374" {
		t.Fatalf("unexpected intent: %#v", intent)
	}
}

func TestDecodeIntentRejectsNonClosedInputs(t *testing.T) {
	tests := map[string][]byte{
		"unknown field":    []byte(`{"schema":"semantic.intent.v1","event_id":"e1","topic_id":"t1","kind":"note","body":"x","extra":true}`),
		"duplicate field":  []byte(`{"schema":"semantic.intent.v1","event_id":"e1","event_id":"e2","topic_id":"t1","kind":"note","body":"x"}`),
		"missing body":     []byte(`{"schema":"semantic.intent.v1","event_id":"e1","topic_id":"t1","kind":"note"}`),
		"trailing value":   []byte(`{"schema":"semantic.intent.v1","event_id":"e1","topic_id":"t1","kind":"note","body":"x"} {}`),
		"invalid event id": []byte(`{"schema":"semantic.intent.v1","event_id":"bad id","topic_id":"t1","kind":"note","body":"x"}`),
		"null title":       []byte(`{"schema":"semantic.intent.v1","event_id":"e1","topic_id":"t1","kind":"note","body":"x","title":null}`),
		"blank body":       []byte(`{"schema":"semantic.intent.v1","event_id":"e1","topic_id":"t1","kind":"note","body":" \t\n"}`),
		"invalid utf8":     append([]byte(`{"schema":"semantic.intent.v1","event_id":"e1","topic_id":"t1","kind":"note","body":"`), 0xff),
	}
	for name, input := range tests {
		t.Run(name, func(t *testing.T) {
			_, err := DecodeIntent(input)
			if !errors.Is(err, ErrInvalidIntent) {
				t.Fatalf("DecodeIntent() error = %v, want ErrInvalidIntent", err)
			}
		})
	}
}

func TestDigestIsDeterministicAcrossInputPropertyOrder(t *testing.T) {
	first, err := DecodeIntent([]byte(`{"schema":"semantic.intent.v1","event_id":"e1","topic_id":"t1","kind":"note","body":"<same>"}`))
	if err != nil {
		t.Fatal(err)
	}
	second, err := DecodeIntent([]byte(`{"body":"<same>","kind":"note","topic_id":"t1","event_id":"e1","schema":"semantic.intent.v1"}`))
	if err != nil {
		t.Fatal(err)
	}
	firstDigest, err := first.Digest()
	if err != nil {
		t.Fatal(err)
	}
	secondDigest, err := second.Digest()
	if err != nil {
		t.Fatal(err)
	}
	if firstDigest != secondDigest {
		t.Fatalf("digests differ: %s != %s", firstDigest, secondDigest)
	}
	canonical, err := first.CanonicalBytes()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(canonical), `\u003c`) {
		t.Fatalf("canonical JSON unexpectedly HTML-escaped: %s", canonical)
	}
}

func TestIntentLengthUsesUnicodeCharactersLikePublishedSchema(t *testing.T) {
	body := strings.Repeat("界", MaxBodyChars)
	intent := Intent{Schema: IntentSchema, EventID: "e1", TopicID: "t1", Kind: "note", Body: body}
	if err := intent.Validate(); err != nil {
		t.Fatalf("Validate() rejected %d Unicode characters: %v", MaxBodyChars, err)
	}
	intent.Body += "界"
	if !errors.Is(intent.Validate(), ErrInvalidIntent) {
		t.Fatalf("Validate() accepted more than %d Unicode characters", MaxBodyChars)
	}
}

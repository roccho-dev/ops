package semanticlog

import (
	"errors"
	"strings"
	"testing"
)

func TestDecodeIntentAcceptsSharedUIContract(t *testing.T) {
	input := []byte(`{"schema":"semantic-intent.v1","intent_id":"01J.TEST-1","topic_id":"ops/374","kind":"record","body":"keep this decision","topic_title":"Minimum runtime","target_ref":{"kind":"issue","id":"ops-374"}}`)
	intent, err := DecodeIntent(input)
	if err != nil {
		t.Fatalf("DecodeIntent() error = %v", err)
	}
	if intent.IntentID != "01J.TEST-1" || intent.TopicID != "ops/374" || intent.TargetRef == nil {
		t.Fatalf("unexpected intent: %#v", intent)
	}
}

func TestDecodeIntentRejectsNonClosedInputs(t *testing.T) {
	tests := map[string][]byte{
		"old schema":       []byte(`{"schema":"semantic.intent.v1","intent_id":"e1","topic_id":"t1","kind":"record","body":"x"}`),
		"old event id":     []byte(`{"schema":"semantic-intent.v1","event_id":"e1","topic_id":"t1","kind":"record","body":"x"}`),
		"unknown field":    []byte(`{"schema":"semantic-intent.v1","intent_id":"e1","topic_id":"t1","kind":"record","body":"x","extra":true}`),
		"duplicate field":  []byte(`{"schema":"semantic-intent.v1","intent_id":"e1","intent_id":"e2","topic_id":"t1","kind":"record","body":"x"}`),
		"missing body":     []byte(`{"schema":"semantic-intent.v1","intent_id":"e1","topic_id":"t1","kind":"record"}`),
		"wrong kind":       []byte(`{"schema":"semantic-intent.v1","intent_id":"e1","topic_id":"t1","kind":"note","body":"x"}`),
		"null title":       []byte(`{"schema":"semantic-intent.v1","intent_id":"e1","topic_id":"t1","kind":"record","body":"x","topic_title":null}`),
		"bad target field": []byte(`{"schema":"semantic-intent.v1","intent_id":"e1","topic_id":"t1","kind":"record","body":"x","target_ref":{"kind":"issue","id":"1","path":"/tmp"}}`),
		"trailing value":   []byte(`{"schema":"semantic-intent.v1","intent_id":"e1","topic_id":"t1","kind":"record","body":"x"} {}`),
		"invalid intent id": []byte(`{"schema":"semantic-intent.v1","intent_id":"bad id","topic_id":"t1","kind":"record","body":"x"}`),
		"blank body":       []byte(`{"schema":"semantic-intent.v1","intent_id":"e1","topic_id":"t1","kind":"record","body":" \t\n"}`),
		"invalid utf8":     append([]byte(`{"schema":"semantic-intent.v1","intent_id":"e1","topic_id":"t1","kind":"record","body":"`), 0xff),
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

func TestCanonicalBytesMatchSharedFixture(t *testing.T) {
	intent := Intent{Schema: IntentSchema, IntentID: "intent-1", TopicID: "topic-1", Kind: IntentKind, Body: "same"}
	canonical, err := intent.CanonicalBytes()
	if err != nil {
		t.Fatal(err)
	}
	want := `{"schema":"semantic-intent.v1","intent_id":"intent-1","topic_id":"topic-1","kind":"record","body":"same"}`
	if string(canonical) != want {
		t.Fatalf("canonical bytes = %s, want %s", canonical, want)
	}
	digest, err := intent.Digest()
	if err != nil || len(digest) != 64 {
		t.Fatalf("Digest() = %q, %v", digest, err)
	}
	if strings.Contains(string(canonical), `\u003c`) {
		t.Fatalf("canonical JSON unexpectedly HTML-escaped: %s", canonical)
	}
}

func TestIntentLengthUsesUnicodeCharactersLikePublishedSchema(t *testing.T) {
	intent := Intent{Schema: IntentSchema, IntentID: "e1", TopicID: "t1", Kind: IntentKind, Body: strings.Repeat("界", MaxBodyChars)}
	if err := intent.Validate(); err != nil {
		t.Fatalf("Validate() rejected %d Unicode characters: %v", MaxBodyChars, err)
	}
	intent.Body += "界"
	if !errors.Is(intent.Validate(), ErrInvalidIntent) {
		t.Fatalf("Validate() accepted more than %d Unicode characters", MaxBodyChars)
	}
}

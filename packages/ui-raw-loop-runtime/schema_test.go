package semanticlog

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

type publishedProperty struct {
	Const     string `json:"const"`
	Type      string `json:"type"`
	MinLength int    `json:"minLength"`
	MaxLength int    `json:"maxLength"`
	Pattern   string `json:"pattern"`
}

type publishedIntentSchema struct {
	AdditionalProperties bool                         `json:"additionalProperties"`
	Required             []string                     `json:"required"`
	Properties           map[string]publishedProperty `json:"properties"`
}

func TestPublishedSchemaMatchesRuntimeContract(t *testing.T) {
	data, err := os.ReadFile("schemas/semantic-intent-v1.schema.json")
	if err != nil {
		t.Fatal(err)
	}
	var schema publishedIntentSchema
	if err := json.Unmarshal(data, &schema); err != nil {
		t.Fatal(err)
	}
	if schema.AdditionalProperties {
		t.Fatal("published schema must be closed")
	}
	wantRequired := []string{"schema", "event_id", "topic_id", "kind", "body"}
	if !reflect.DeepEqual(schema.Required, wantRequired) {
		t.Fatalf("required = %#v, want %#v", schema.Required, wantRequired)
	}
	if got := schema.Properties["schema"].Const; got != IntentSchema {
		t.Fatalf("schema const = %q, want %q", got, IntentSchema)
	}
	assertPublishedProperty(t, schema, "event_id", MaxIDBytes, `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`)
	assertPublishedProperty(t, schema, "topic_id", MaxIDBytes, `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`)
	assertPublishedProperty(t, schema, "kind", MaxKindBytes, `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$`)
	assertPublishedProperty(t, schema, "body", MaxBodyChars, `[^ \t\r\n]`)
	assertPublishedProperty(t, schema, "title", MaxTitleChars, `[^ \t\r\n]`)
}

func assertPublishedProperty(t *testing.T, schema publishedIntentSchema, name string, maxLength int, pattern string) {
	t.Helper()
	property, ok := schema.Properties[name]
	if !ok {
		t.Fatalf("published schema is missing %q", name)
	}
	if property.Type != "string" || property.MinLength != 1 || property.MaxLength != maxLength || property.Pattern != pattern {
		t.Fatalf("published %s = %#v", name, property)
	}
}

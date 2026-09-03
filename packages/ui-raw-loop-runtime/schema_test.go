package semanticlog

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

type publishedProperty struct {
	Const string `json:"const"`
	Type string `json:"type"`
	MinLength int `json:"minLength"`
	MaxLength int `json:"maxLength"`
	Pattern string `json:"pattern"`
	AdditionalProperties bool `json:"additionalProperties"`
	Required []string `json:"required"`
	Properties map[string]publishedProperty `json:"properties"`
}
type publishedIntentSchema struct { AdditionalProperties bool `json:"additionalProperties"`; Required []string `json:"required"`; Properties map[string]publishedProperty `json:"properties"` }

func TestPublishedSchemaMatchesRuntimeContract(t *testing.T) {
	data, err := os.ReadFile("schemas/semantic-intent-v1.schema.json"); if err != nil { t.Fatal(err) }
	var schema publishedIntentSchema; if err := json.Unmarshal(data, &schema); err != nil { t.Fatal(err) }
	if schema.AdditionalProperties { t.Fatal("published schema must be closed") }
	wantRequired := []string{"schema", "intent_id", "topic_id", "kind", "body"}
	if !reflect.DeepEqual(schema.Required, wantRequired) { t.Fatalf("required = %#v", schema.Required) }
	if schema.Properties["schema"].Const != IntentSchema || schema.Properties["kind"].Const != IntentKind { t.Fatal("schema/kind constants drifted") }
	assertPublishedProperty(t, schema.Properties["intent_id"], MaxIDBytes, `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`)
	assertPublishedProperty(t, schema.Properties["topic_id"], MaxIDBytes, `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`)
	assertPublishedProperty(t, schema.Properties["body"], MaxBodyChars, `[^ \t\r\n]`)
	assertPublishedProperty(t, schema.Properties["topic_title"], MaxTitleChars, `[^ \t\r\n]`)
	target := schema.Properties["target_ref"]
	if target.Type != "object" || target.AdditionalProperties || !reflect.DeepEqual(target.Required, []string{"kind", "id"}) { t.Fatalf("target_ref drifted: %#v", target) }
	assertPublishedProperty(t, target.Properties["kind"], MaxRefKindBytes, `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$`)
	assertPublishedProperty(t, target.Properties["id"], MaxIDBytes, `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`)
}

func assertPublishedProperty(t *testing.T, property publishedProperty, maxLength int, pattern string) {
	t.Helper(); if property.Type != "string" || property.MinLength != 1 || property.MaxLength != maxLength || property.Pattern != pattern { t.Fatalf("published property = %#v", property) }
}

package semanticlog

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

type schemaProperty struct {
	Const                string                    `json:"const"`
	Type                 string                    `json:"type"`
	MinLength            int                       `json:"minLength"`
	MaxLength            int                       `json:"maxLength"`
	Pattern              string                    `json:"pattern"`
	UTF8MaxBytes         int                       `json:"x-utf8MaxBytes"`
	AdditionalProperties bool                      `json:"additionalProperties"`
	Required             []string                  `json:"required"`
	Properties           map[string]schemaProperty `json:"properties"`
	Enum                 []string                  `json:"enum"`
}

type schemaDocument struct {
	AdditionalProperties bool                      `json:"additionalProperties"`
	Required             []string                  `json:"required"`
	Properties           map[string]schemaProperty `json:"properties"`
	UTF8MaxBytes         int                       `json:"x-utf8MaxBytes"`
}

func TestPublishedRequestSchemaMatchesRuntime(t *testing.T) {
	var schema schemaDocument
	readSchema(t, "schemas/semantic-intent-v1.schema.json", &schema)
	if schema.AdditionalProperties {
		t.Fatal("request schema must be closed")
	}
	if !reflect.DeepEqual(schema.Required, []string{"schema", "intent_id", "topic_id", "kind", "body"}) {
		t.Fatalf("required = %#v", schema.Required)
	}
	if schema.Properties["schema"].Const != IntentSchema || schema.Properties["kind"].Const != IntentKind {
		t.Fatal("request constants drifted")
	}
	if schema.UTF8MaxBytes != MaxRequestBytes || schema.Properties["body"].UTF8MaxBytes != MaxBodyBytes || schema.Properties["topic_title"].UTF8MaxBytes != MaxTopicTitleBytes {
		t.Fatal("UTF-8 byte limits drifted")
	}
	target := schema.Properties["target_ref"]
	if target.Type != "object" || target.AdditionalProperties || !reflect.DeepEqual(target.Required, []string{"kind", "id"}) {
		t.Fatalf("target_ref = %#v", target)
	}
}

func TestPublishedResultSchemaMatchesRuntime(t *testing.T) {
	var schema schemaDocument
	readSchema(t, "schemas/semantic-intent-result-v1.schema.json", &schema)
	if schema.AdditionalProperties {
		t.Fatal("result schema must be closed")
	}
	if !reflect.DeepEqual(schema.Required, []string{"schema", "intent_id", "local_state", "github_state"}) {
		t.Fatalf("required = %#v", schema.Required)
	}
	if schema.Properties["schema"].Const != ResultSchema {
		t.Fatal("result schema token drifted")
	}
	if !reflect.DeepEqual(schema.Properties["local_state"].Enum, []string{"accepted", "no_change", "rejected", "failed", "unknown"}) {
		t.Fatal("local states drifted")
	}
	if !reflect.DeepEqual(schema.Properties["github_state"].Enum, []string{"not_started", "pending", "applied", "unknown", "permanent_failure"}) {
		t.Fatal("github states drifted")
	}
}

func readSchema(t *testing.T, path string, target any) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, target); err != nil {
		t.Fatal(err)
	}
}

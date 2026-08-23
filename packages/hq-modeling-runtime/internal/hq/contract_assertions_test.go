package hq

import (
	"strings"
	"testing"
)

func requireFields(t *testing.T, got Object, want Object) {
	t.Helper()
	for key, value := range want {
		if got[key] != value {
			t.Fatalf("%s=%#v, want %#v: %s", key, got[key], value, describeForTest(got))
		}
	}
}

func requireAbsent(t *testing.T, got Object, keys ...string) {
	t.Helper()
	for _, key := range keys {
		if _, ok := got[key]; ok {
			t.Fatalf("unexpected %s: %s", key, describeForTest(got))
		}
	}
}

func requireSHA(t *testing.T, value any) {
	t.Helper()
	text, ok := value.(string)
	if !ok || !strings.HasPrefix(text, "sha256:") {
		t.Fatalf("not sha256: %#v", value)
	}
}

func requireResult(t *testing.T, got Object, want Object, codes ...string) {
	t.Helper()
	requireFields(t, got, want)
	for _, code := range codes {
		requireCodeForTest(t, got, code)
	}
}

package forge

import (
	"encoding/base64"
	"testing"
)

func TestStrictBase64Decode(t *testing.T) {
	payload := []byte("capability")
	text := base64.StdEncoding.EncodeToString(payload)
	decoded, err := strictBase64Decode(text)
	if err != nil || string(decoded) != string(payload) {
		t.Fatalf("decode failed: %v", err)
	}
	for _, invalid := range []string{text + "\n", " " + text, text[:len(text)-1]} {
		if _, err := strictBase64Decode(invalid); err == nil {
			t.Fatalf("accepted invalid carrier %q", invalid)
		}
	}
}

func TestNormalizeAtPreservesURI(t *testing.T) {
	if got := normalizeAt("capforge", "system://capforge"); got != "system://capforge" {
		t.Fatalf("got %q", got)
	}
	if got := normalizeAt("demo", ""); got != "capabilities/demo" {
		t.Fatalf("got %q", got)
	}
}

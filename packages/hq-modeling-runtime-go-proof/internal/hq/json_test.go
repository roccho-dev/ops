package hq

import (
	"strings"
	"testing"
)

func TestStableStringifyMatchesNodeFixture(t *testing.T) {
	value, err := DecodeJSON([]byte("{\"z\":\"<>&\u2028\u2029\",\"a\":[null,true,-0,1e-7,1e21,1.5],\"m\":{\"β\":\"value\",\"A\":\"first\"}}"))
	if err != nil {
		t.Fatal(err)
	}
	got, err := StableStringify(value)
	if err != nil {
		t.Fatal(err)
	}
	want := "{\"a\":[null,true,0,1e-7,1e+21,1.5],\"m\":{\"A\":\"first\",\"β\":\"value\"},\"z\":\"<>&\u2028\u2029\"}"
	if got != want {
		t.Fatalf("stable JSON mismatch\nwant: %s\n got: %s", want, got)
	}
	if digest := SHA256Digest(value); digest != "sha256:7928ad9b99268631771dd96e8d44657afa852cc0584ec96aa558ae6f9b1ae53e" {
		t.Fatalf("digest mismatch: %s", digest)
	}
}

func TestVisitJSONLLinesHasNoScannerTokenCeiling(t *testing.T) {
	large := strings.Repeat("x", 128*1024)
	input := "{\"id\":\"" + large + "\"}\n"
	visited := 0
	if err := VisitJSONLLines(strings.NewReader(input), func(line int, trimmed []byte) {
		visited++
		if line != 1 {
			t.Fatalf("line = %d, want 1", line)
		}
		if len(trimmed) <= 64*1024 {
			t.Fatalf("line unexpectedly small: %d", len(trimmed))
		}
	}); err != nil {
		t.Fatal(err)
	}
	if visited != 1 {
		t.Fatalf("visited = %d, want 1", visited)
	}
}

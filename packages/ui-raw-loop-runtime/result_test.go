package semanticlog

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"testing"
)

func TestExactUIResultFixtures(t *testing.T) {
	fixtures := map[string]string{
		"result-pending.json":           "ae56fc72d4597d3c6585afe6be699ac8a6bfe4fe989239cdb503c1401223fe5b",
		"result-applied.json":           "bd763236d279efe326a9372bb471d512bb4aa53207ac596fcceba9ec5d2db71c",
		"result-rejected.json":          "d0bcb7dcd05d05cd1578d8316872354bdd0f82f9f529c2ad1700ee69c70a59a6",
		"result-permanent-failure.json": "980077450366e5ab4acdde8403950e3361713fd53a91b9a8bee0e7e9a7e70fe1",
	}
	for name, expectedHash := range fixtures {
		t.Run(name, func(t *testing.T) {
			data, err := os.ReadFile("fixtures/semantic-intent-v1/" + name)
			if err != nil {
				t.Fatal(err)
			}
			sum := sha256.Sum256(data)
			if got := hex.EncodeToString(sum[:]); got != expectedHash {
				t.Fatalf("sha256 = %s", got)
			}
			result, err := DecodeResult(data)
			if err != nil {
				t.Fatalf("DecodeResult() error = %v", err)
			}
			canonical, err := result.CanonicalBytes()
			if err != nil {
				t.Fatal(err)
			}
			if string(canonical) != string(data) {
				t.Fatal("canonical result differs from UI fixture")
			}
		})
	}
}

func TestResultRejectsInvalidCombinations(t *testing.T) {
	tests := [][]byte{
		[]byte(`{"schema":"semantic-intent.result.v1","intent_id":"i1","local_state":"accepted","github_state":"applied"}`),
		[]byte(`{"schema":"semantic-intent.result.v1","intent_id":"i1","local_state":"accepted","github_state":"pending","comment_id":1}`),
		[]byte(`{"schema":"semantic-intent.result.v1","intent_id":"i1","local_state":"maybe","github_state":"pending"}`),
		[]byte(`{"schema":"semantic-intent.result.v1","intent_id":"i1","local_state":"accepted","github_state":"pending","extra":true}`),
		[]byte(` {"schema":"semantic-intent.result.v1","intent_id":"i1","local_state":"accepted","github_state":"pending"}`),
	}
	for _, data := range tests {
		if _, err := DecodeResult(data); !errors.Is(err, ErrInvalidResult) {
			t.Fatalf("DecodeResult(%s) error = %v", data, err)
		}
	}
}

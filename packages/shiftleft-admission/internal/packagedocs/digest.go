package packagedocs

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
)

func shaHex(data []byte) string {
	s := sha256.Sum256(data)
	return hex.EncodeToString(s[:])
}

func shaDigest(data []byte) string { return "sha256:" + shaHex(data) }

func finalizeObservation(o Observation) (Observation, error) {
	o.ObservationDigest = ""
	sort.Slice(o.Evidence, func(i, j int) bool {
		a, b := o.Evidence[i], o.Evidence[j]
		if a.Kind != b.Kind {
			return a.Kind < b.Kind
		}
		if a.Path != b.Path {
			return a.Path < b.Path
		}
		if a.Line != b.Line {
			return a.Line < b.Line
		}
		return a.Detail < b.Detail
	})
	b, err := json.Marshal(o)
	if err != nil {
		return Observation{}, err
	}
	o.ObservationDigest = shaDigest(append([]byte(ObservationSchema+"\n"), b...))
	return o, nil
}

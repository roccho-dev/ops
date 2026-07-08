package validate

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
)

func Str(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
func Bool(v any) bool { b, _ := v.(bool); return b }
func ToStrings(v any) []string {
	a, ok := v.([]any)
	if !ok {
		if s, ok := v.([]string); ok {
			return s
		}
		return nil
	}
	r := make([]string, 0, len(a))
	for _, x := range a {
		r = append(r, Str(x))
	}
	return r
}
func FieldRef(sid, fid string) string { return sid + "#" + fid }
func SplitFieldRef(ref string) (string, string, bool) {
	p := strings.Split(ref, "#")
	if len(p) != 2 {
		return "", "", false
	}
	return p[0], p[1], true
}
func FakeHash(prefix string, i int) string {
	h := sha256.Sum256([]byte(fmt.Sprintf("%s-%d", prefix, i)))
	return "sha256:" + hex.EncodeToString(h[:])
}
func Contains(a []string, x string) bool {
	for _, y := range a {
		if y == x {
			return true
		}
	}
	return false
}
func Dedupe(a []string) []string {
	m := map[string]bool{}
	for _, x := range a {
		if x != "" {
			m[x] = true
		}
	}
	r := make([]string, 0, len(m))
	for x := range m {
		r = append(r, x)
	}
	sort.Strings(r)
	return r
}
func CanonicalizeResult(res *Result) {
	sort.Strings(res.CueErrors)
	sort.Strings(res.SemanticErrors)
	for k, v := range res.AffectedQueries {
		res.AffectedQueries[k] = Dedupe(v)
	}
	for k, v := range res.AffectedFixtures {
		res.AffectedFixtures[k] = Dedupe(v)
	}
	for k, v := range res.UnresolvedAffected {
		res.UnresolvedAffected[k] = Dedupe(v)
	}
}
func IsHash(s string) bool { return reHash.MatchString(s) }

func LimitStrings(in []string, n int) []string {
	if len(in) <= n {
		return in
	}
	out := append([]string{}, in[:n]...)
	out = append(out, fmt.Sprintf("... %d more", len(in)-n))
	return out
}

func SortedBoolKeys(m map[string]bool) []string {
	r := make([]string, 0, len(m))
	for k := range m {
		r = append(r, k)
	}
	sort.Strings(r)
	return r
}

func SortedKeys[V any](m map[string]V) []string {
	r := make([]string, 0, len(m))
	for k := range m {
		r = append(r, k)
	}
	sort.Strings(r)
	return r
}

func In(s string, a []string) bool {
	for _, x := range a {
		if s == x {
			return true
		}
	}
	return false
}
func Min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

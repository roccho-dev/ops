package hq

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
	"unicode"
)

var queueKinds = map[string]bool{
	"hq.modelCommitQueued.v1": true,
	"hq.agentTaskQueued.v1":   true,
	"hq.receipt.v1":           true,
}

var schemaByKind = map[string]struct {
	Required    []string
	StatusOrder []string
	Statuses    map[string]bool
}{
	"hq.modelCommitQueued.v1": {
		Required:    []string{"kind", "id", "status", "targetRef", "op", "payload", "confirmedBy", "origin"},
		StatusOrder: []string{"queued"},
		Statuses:    map[string]bool{"queued": true},
	},
	"hq.agentTaskQueued.v1": {
		Required:    []string{"kind", "id", "status", "targetRef", "goal", "confirmedBy"},
		StatusOrder: []string{"queued"},
		Statuses:    map[string]bool{"queued": true},
	},
	"hq.receipt.v1": {
		Required:    []string{"kind", "id", "status", "queueId"},
		StatusOrder: []string{"processed", "pending", "failed"},
		Statuses:    map[string]bool{"processed": true, "pending": true, "failed": true},
	},
}

var forbiddenAuthorityFields = []string{
	"accepted", "acceptedLedger", "admitted", "admissionApproved", "approved", "approval",
	"authority", "authorityState", "ledgerAuthority", "ledgerWrite", "sourceModelAuthority", "writesAcceptedLedger",
}

var forbiddenAcceptedLedgerShapeFields = []string{
	"acceptedDigest", "admissionScope", "localDevOnly", "sourceQueueId",
}

var forbiddenConceptWords = map[string]bool{
	"accepted": true, "admitted": true, "admission": true, "admit": true,
	"approved": true, "approval": true, "approve": true, "authority": true,
	"authorization": true, "authorisation": true, "authorized": true,
	"authorised": true, "authoritative": true,
}

var exactForbiddenTokens = func() map[string]bool {
	result := map[string]bool{}
	for _, value := range append(append([]string{}, forbiddenAuthorityFields...), forbiddenAcceptedLedgerShapeFields...) {
		result[NormalizeBoundaryToken(value)] = true
	}
	for _, value := range []string{"acceptedRow", "admission", "modelQueueRow"} {
		result[NormalizeBoundaryToken(value)] = true
	}
	return result
}()

var shadowAliasTokens = map[string]bool{
	NormalizeBoundaryToken("nonAuthority"):            true,
	NormalizeBoundaryToken("authoritativeSourceName"): true,
}

var camelA = regexp.MustCompile(`([A-Z]+)([A-Z][a-z])`)
var camelB = regexp.MustCompile(`([a-z0-9])([A-Z])`)
var nonWord = regexp.MustCompile(`[^A-Za-z0-9]+`)
var canonicalDigest = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)

func NormalizeBoundaryToken(value string) string {
	var builder strings.Builder
	for _, r := range strings.ToLower(value) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			if r <= unicode.MaxASCII {
				builder.WriteRune(r)
			}
		}
	}
	return builder.String()
}

func boundaryWords(value string) []string {
	value = camelA.ReplaceAllString(value, `$1 $2`)
	value = camelB.ReplaceAllString(value, `$1 $2`)
	parts := nonWord.Split(value, -1)
	words := make([]string, 0, len(parts))
	for _, part := range parts {
		if part != "" {
			words = append(words, strings.ToLower(part))
		}
	}
	return words
}

func authorityConcept(value string) string {
	for _, word := range boundaryWords(value) {
		if forbiddenConceptWords[word] {
			return word
		}
	}
	return ""
}

func allowedAuthorityField(field string, value any) bool {
	switch field {
	case "nonAuthority":
		boolean, ok := value.(bool)
		return ok && boolean
	case "authoritativeSourceName":
		_, ok := NonEmptyString(value)
		return ok
	default:
		return false
	}
}

func forbiddenFieldConcept(field string, value any) string {
	token := NormalizeBoundaryToken(field)
	if allowedAuthorityField(field, value) {
		return ""
	}
	if shadowAliasTokens[token] || exactForbiddenTokens[token] {
		return token
	}
	return authorityConcept(field)
}

func Error(code, message string, extra ...Object) Object {
	result := Object{"code": code, "message": message}
	for _, fields := range extra {
		for key, value := range fields {
			result[key] = value
		}
	}
	return result
}

func sortedKeys(object Object) []string {
	keys := make([]string, 0, len(object))
	for key := range object {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func findAuthorityBearingShapes(value any) []Object {
	findings := []Object{}
	// Reuse a single DFS path. Materialize path segments only for actual
	// findings so a deeply nested but valid JSON document remains O(N).
	path := make([]string, 0, 32)
	segmentsForFinding := func() []any {
		return stringsToAny(append([]string(nil), path...))
	}
	var visit func(any)
	visit = func(node any) {
		switch typed := node.(type) {
		case Object:
			visit(map[string]any(typed))
		case map[string]any:
			for _, key := range sortedKeys(Object(typed)) {
				nested := typed[key]
				path = append(path, key)
				token := NormalizeBoundaryToken(key)
				if concept := forbiddenFieldConcept(key, nested); concept != "" {
					findings = append(findings, Object{
						"segments":        segmentsForFinding(),
						"reason":          "forbidden-field",
						"field":           key,
						"normalizedField": token,
						"concept":         concept,
					})
				}
				if token == "kind" || token == "status" {
					if text, ok := nested.(string); ok {
						if concept := authorityConcept(text); concept != "" {
							reason := "forbidden-status"
							if token == "kind" {
								reason = "forbidden-kind"
							}
							findings = append(findings, Object{
								"segments":        segmentsForFinding(),
								"reason":          reason,
								"value":           text,
								"normalizedValue": NormalizeBoundaryToken(text),
								"concept":         concept,
							})
						}
					}
				}
				visit(nested)
				path = path[:len(path)-1]
			}
		case []any:
			for index, nested := range typed {
				path = append(path, fmt.Sprint(index))
				visit(nested)
				path = path[:len(path)-1]
			}
		}
	}
	visit(value)
	return findings
}

func stringsToAny(values []string) []any {
	result := make([]any, len(values))
	for index, value := range values {
		result[index] = value
	}
	return result
}

func pathText(segments []any) string {
	if len(segments) == 0 {
		return "$"
	}
	parts := make([]string, len(segments))
	for index, segment := range segments {
		parts[index] = fmt.Sprint(segment)
	}
	return strings.Join(parts, ".")
}

func pointerFromAny(segments []any) string {
	if len(segments) == 0 {
		return "/"
	}
	parts := make([]string, len(segments))
	for index, segment := range segments {
		text := strings.ReplaceAll(fmt.Sprint(segment), "~", "~0")
		parts[index] = strings.ReplaceAll(text, "/", "~1")
	}
	return "/" + strings.Join(parts, "/")
}

func valueOrUndefined(object Object, key string) any {
	if value, exists := object[key]; exists {
		return value
	}
	return Undefined
}

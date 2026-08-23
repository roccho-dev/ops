package hq

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
)

// Object is the JSON-object boundary used by the proof runtime. The Go proof
// intentionally accepts decoded JSON bytes, not arbitrary in-process objects.
type Object map[string]any

type undefinedValue struct{}

// Undefined models own JavaScript object properties whose value is undefined.
// stableStringify includes those keys as the token "undefined", while
// JSON.stringify omits them from object output.
var Undefined = undefinedValue{}

func DecodeJSON(data []byte) (any, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return nil, fmt.Errorf("input must contain one JSON value")
		}
		return nil, err
	}
	return value, nil
}

func AsObject(value any) (Object, bool) {
	switch object := value.(type) {
	case Object:
		return object, true
	case map[string]any:
		return Object(object), true
	default:
		return nil, false
	}
}

func AsArray(value any) ([]any, bool) {
	array, ok := value.([]any)
	return array, ok
}

func NonEmptyString(value any) (string, bool) {
	text, ok := value.(string)
	return text, ok && strings.TrimSpace(text) != ""
}

func jsNumberString(value float64) (string, error) {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return "", fmt.Errorf("non-finite number")
	}
	if value == 0 {
		return "0", nil
	}
	absolute := math.Abs(value)
	if absolute >= 1e21 || absolute < 1e-6 {
		text := strconv.FormatFloat(value, 'e', -1, 64)
		parts := strings.SplitN(text, "e", 2)
		mantissa := parts[0]
		exponent, err := strconv.Atoi(parts[1])
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("%se%+d", mantissa, exponent), nil
	}
	return strconv.FormatFloat(value, 'f', -1, 64), nil
}

func JSTypeof(value any) string {
	switch value.(type) {
	case undefinedValue:
		return "undefined"
	case nil, Object, map[string]any, []any:
		return "object"
	case bool:
		return "boolean"
	case string:
		return "string"
	case float32, float64, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return "number"
	default:
		return "object"
	}
}

func JSTruthy(value any) bool {
	switch typed := value.(type) {
	case undefinedValue, nil:
		return false
	case bool:
		return typed
	case string:
		return typed != ""
	case float64:
		return typed != 0 && !math.IsNaN(typed)
	case float32:
		return typed != 0 && !math.IsNaN(float64(typed))
	case int:
		return typed != 0
	case int8:
		return typed != 0
	case int16:
		return typed != 0
	case int32:
		return typed != 0
	case int64:
		return typed != 0
	case uint:
		return typed != 0
	case uint8:
		return typed != 0
	case uint16:
		return typed != 0
	case uint32:
		return typed != 0
	case uint64:
		return typed != 0
	default:
		return true
	}
}

func JSString(value any) string {
	switch typed := value.(type) {
	case undefinedValue:
		return "undefined"
	case nil:
		return "null"
	case string:
		return typed
	case bool:
		if typed {
			return "true"
		}
		return "false"
	case float64:
		text, err := jsNumberString(typed)
		if err == nil {
			return text
		}
	case float32:
		text, err := jsNumberString(float64(typed))
		if err == nil {
			return text
		}
	case int:
		return strconv.Itoa(typed)
	case int8:
		return strconv.FormatInt(int64(typed), 10)
	case int16:
		return strconv.FormatInt(int64(typed), 10)
	case int32:
		return strconv.FormatInt(int64(typed), 10)
	case int64:
		return strconv.FormatInt(typed, 10)
	case uint:
		return strconv.FormatUint(uint64(typed), 10)
	case uint8:
		return strconv.FormatUint(uint64(typed), 10)
	case uint16:
		return strconv.FormatUint(uint64(typed), 10)
	case uint32:
		return strconv.FormatUint(uint64(typed), 10)
	case uint64:
		return strconv.FormatUint(typed, 10)
	case []any:
		parts := make([]string, len(typed))
		for index, entry := range typed {
			if entry == nil {
				parts[index] = ""
				continue
			}
			if _, undefined := entry.(undefinedValue); undefined {
				parts[index] = ""
				continue
			}
			parts[index] = JSString(entry)
		}
		return strings.Join(parts, ",")
	case Object, map[string]any:
		return "[object Object]"
	}
	return fmt.Sprint(value)
}

func quoteJSONString(value string) string {
	var builder strings.Builder
	builder.WriteByte('"')
	for _, r := range value {
		switch r {
		case '"':
			builder.WriteString(`\"`)
		case '\\':
			builder.WriteString(`\\`)
		case '\b':
			builder.WriteString(`\b`)
		case '\f':
			builder.WriteString(`\f`)
		case '\n':
			builder.WriteString(`\n`)
		case '\r':
			builder.WriteString(`\r`)
		case '\t':
			builder.WriteString(`\t`)
		default:
			if r < 0x20 {
				fmt.Fprintf(&builder, `\u%04x`, r)
			} else {
				builder.WriteRune(r)
			}
		}
	}
	builder.WriteByte('"')
	return builder.String()
}

// StableStringify mirrors packages/hq-modeling-runtime/lib/digest.mjs for
// ordinary JSON data. Object keys are sorted; arrays retain order.
func StableStringify(value any) (string, error) {
	switch typed := value.(type) {
	case undefinedValue:
		return "undefined", nil
	case nil:
		return "null", nil
	case bool:
		if typed {
			return "true", nil
		}
		return "false", nil
	case string:
		return quoteJSONString(typed), nil
	case float64:
		return jsNumberString(typed)
	case float32:
		return jsNumberString(float64(typed))
	case int:
		return strconv.Itoa(typed), nil
	case int8:
		return strconv.FormatInt(int64(typed), 10), nil
	case int16:
		return strconv.FormatInt(int64(typed), 10), nil
	case int32:
		return strconv.FormatInt(int64(typed), 10), nil
	case int64:
		return strconv.FormatInt(typed, 10), nil
	case uint:
		return strconv.FormatUint(uint64(typed), 10), nil
	case uint8:
		return strconv.FormatUint(uint64(typed), 10), nil
	case uint16:
		return strconv.FormatUint(uint64(typed), 10), nil
	case uint32:
		return strconv.FormatUint(uint64(typed), 10), nil
	case uint64:
		return strconv.FormatUint(typed, 10), nil
	case []any:
		parts := make([]string, 0, len(typed))
		for _, entry := range typed {
			encoded, err := StableStringify(entry)
			if err != nil {
				return "", err
			}
			parts = append(parts, encoded)
		}
		return "[" + strings.Join(parts, ",") + "]", nil
	case Object:
		return StableStringify(map[string]any(typed))
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, key := range keys {
			encodedKey := quoteJSONString(key)
			encodedValue, err := StableStringify(typed[key])
			if err != nil {
				return "", err
			}
			parts = append(parts, encodedKey+":"+encodedValue)
		}
		return "{" + strings.Join(parts, ",") + "}", nil
	default:
		// Internal values are deliberately converted through JSON so structs used
		// by tests cannot silently acquire non-JSON digest semantics.
		encoded, err := json.Marshal(typed)
		if err != nil {
			return "", fmt.Errorf("unsupported JSON value %T: %w", value, err)
		}
		decoded, err := DecodeJSON(encoded)
		if err != nil {
			return "", err
		}
		return StableStringify(decoded)
	}
}

func SHA256Digest(value any) string {
	stable, err := StableStringify(value)
	if err != nil {
		panic(err)
	}
	digest := sha256.Sum256([]byte(stable))
	return "sha256:" + hex.EncodeToString(digest[:])
}

func jsonOutputValue(value any) any {
	switch typed := value.(type) {
	case undefinedValue:
		return nil
	case Object:
		return jsonOutputValue(map[string]any(typed))
	case map[string]any:
		result := map[string]any{}
		for key, nested := range typed {
			if _, omit := nested.(undefinedValue); omit {
				continue
			}
			result[key] = jsonOutputValue(nested)
		}
		return result
	case []any:
		result := make([]any, len(typed))
		for index, nested := range typed {
			result[index] = jsonOutputValue(nested)
		}
		return result
	default:
		return value
	}
}

func EncodeJSON(value any, pretty bool) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if pretty {
		encoder.SetIndent("", "  ")
	}
	if err := encoder.Encode(jsonOutputValue(value)); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func CloneJSON(value any) any {
	encoded, err := EncodeJSON(value, false)
	if err != nil {
		panic(err)
	}
	decoded, err := DecodeJSON(encoded)
	if err != nil {
		panic(err)
	}
	return decoded
}

package hq

import (
	"fmt"
	"io"
	"os"
	"strings"
)

var implementedCapabilities = []any{
	"queue-schema-validator",
	"local-worker",
	"receipt-writer",
	"repo-map-projection-builder",
	"local-dev-admission-gate",
	"human-confirmed-modeling-proposal-promotion",
	"CLI validation/work/receipt/projection/admission/promotion adapter",
}

func BoundarySummary() Object {
	return Object{
		"kind":           "hq.modelingRuntime.boundary.v1",
		"packageName":    "hq-modeling-runtime",
		"ownerRepo":      "ops",
		"implementation": "go",
		"canonical":      true,
		"nonAuthority":   true,
		"inputBoundary":  "serialized JSON and JSONL bytes",
		"capabilities":   implementedCapabilities,
		"retired": []any{
			"arbitrary in-process JavaScript object semantics",
			"unused CUE, local serve, CI, GitHub readback, and staged canonical-promotion adapters",
		},
	}
}

func printHelp(writer io.Writer) {
	fmt.Fprintln(writer, "usage: hq-modeling-runtime [--json]")
	fmt.Fprintln(writer, "       hq-modeling-runtime validate --input <queue.jsonl> [--json]")
	fmt.Fprintln(writer, "       hq-modeling-runtime work --input <queue.jsonl> [--json]")
	fmt.Fprintln(writer, "       hq-modeling-runtime receipts --input <queue.jsonl> [--jsonl|--json]")
	fmt.Fprintln(writer, "       hq-modeling-runtime projection --input <queue.jsonl> [--json]")
	fmt.Fprintln(writer, "       hq-modeling-runtime admit --input <queue.jsonl> [--accepted-jsonl|--receipt-jsonl|--json]")
	fmt.Fprintln(writer, "       hq-modeling-runtime promote --input <proposal.json> --confirmation <confirmation.json> [--queue-jsonl|--receipt-jsonl|--json]")
	fmt.Fprintln(writer)
	fmt.Fprintln(writer, "Without a subcommand, prints the hq-modeling-runtime boundary summary.")
}

type parsedOptions struct {
	values map[string]any
	error  error
}

func parseOptions(args []string, stringOptions, boolOptions map[string]bool) parsedOptions {
	values := map[string]any{}
	for option := range boolOptions {
		values[option] = false
	}
	for index := 0; index < len(args); index++ {
		arg := args[index]
		if !strings.HasPrefix(arg, "--") || strings.Contains(arg, "=") {
			return parsedOptions{values: values, error: fmt.Errorf("Unknown option '%s'", arg)}
		}
		name := strings.TrimPrefix(arg, "--")
		if boolOptions[name] {
			values[name] = true
			continue
		}
		if stringOptions[name] {
			if index+1 >= len(args) || strings.HasPrefix(args[index+1], "--") {
				return parsedOptions{values: values, error: fmt.Errorf("Option '--%s <value>' argument missing", name)}
			}
			index++
			values[name] = args[index]
			continue
		}
		return parsedOptions{values: values, error: fmt.Errorf("Unknown option '--%s'", name)}
	}
	return parsedOptions{values: values}
}

func boolValue(values map[string]any, name string) bool {
	value, _ := values[name].(bool)
	return value
}

func stringValue(values map[string]any, name string) string {
	value, _ := values[name].(string)
	return value
}

func writeJSON(writer io.Writer, value any, pretty bool) error {
	encoded, err := EncodeJSON(value, pretty)
	if err != nil {
		return err
	}
	_, err = writer.Write(encoded)
	return err
}

func openInput(path string, stderr io.Writer) (*os.File, bool) {
	file, err := os.Open(path)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return nil, false
	}
	return file, true
}

func parseInputCommand(args []string, usage string, extraBool ...string) (map[string]any, int, string) {
	bools := map[string]bool{"json": true}
	for _, option := range extraBool {
		bools[option] = true
	}
	parsed := parseOptions(args, map[string]bool{"input": true}, bools)
	if parsed.error != nil {
		return parsed.values, 2, usage
	}
	if stringValue(parsed.values, "input") == "" {
		return parsed.values, 2, usage
	}
	return parsed.values, 0, ""
}

func promotionFailure(code, message string, extra Object) Object {
	errorRow := Error(code, message, extra)
	return Object{"ok": false, "errors": []any{errorRow}, "queueRow": nil}
}

func promotionOutputHints(args []string) map[string]any {
	values := map[string]any{"queue-jsonl": false, "receipt-jsonl": false, "json": false}
	for _, option := range []string{"queue-jsonl", "receipt-jsonl", "json"} {
		exact := "--" + option
		prefix := exact + "="
		for _, arg := range args {
			if arg == exact || strings.HasPrefix(arg, prefix) {
				values[option] = true
			}
		}
	}
	return values
}

func printPromotionFailure(stdout, stderr io.Writer, result Object, values map[string]any) {
	errors, _ := result["errors"].([]any)
	codes := []string{}
	for _, value := range errors {
		codes = append(codes, fmt.Sprint(ensureObject(value)["code"]))
	}
	if boolValue(values, "queue-jsonl") || boolValue(values, "receipt-jsonl") {
		fmt.Fprintf(stderr, "hq proposal promotion: FAIL errors=%d codes=%s\n", len(errors), strings.Join(codes, ","))
	} else if boolValue(values, "json") {
		_ = writeJSON(stdout, result, true)
	} else {
		fmt.Fprintf(stdout, "hq proposal promotion: FAIL errors=%d codes=%s\n", len(errors), strings.Join(codes, ","))
	}
}

func readPromotionJSON(path, label string) Object {
	data, err := os.ReadFile(path)
	if err != nil {
		return promotionFailure(label+"-read-failed", label+" JSON could not be read", Object{"path": path, "reason": "read-error"})
	}
	value, err := DecodeJSON(data)
	if err != nil {
		return promotionFailure(label+"-invalid-json", label+" input must contain one JSON value", Object{"path": path, "reason": err.Error()})
	}
	return Object{"ok": true, "value": value}
}

func RunCLI(args []string, stdout, stderr io.Writer) int {
	for _, arg := range args {
		if arg == "--help" {
			printHelp(stdout)
			return 0
		}
	}
	if len(args) == 0 || (len(args) == 1 && args[0] == "--json") {
		if err := writeJSON(stdout, BoundarySummary(), true); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		return 0
	}

	switch args[0] {
	case "validate":
		usage := "usage: hq-modeling-runtime validate --input <queue.jsonl> [--json]"
		values, code, message := parseInputCommand(args[1:], usage)
		if code != 0 {
			fmt.Fprintln(stderr, message)
			return code
		}
		file, ok := openInput(stringValue(values, "input"), stderr)
		if !ok {
			return 1
		}
		defer file.Close()
		result := ValidateJSONL(file)
		if boolValue(values, "json") {
			_ = writeJSON(stdout, result, true)
		} else {
			verdict := "FAIL"
			if result["ok"] == true {
				verdict = "PASS"
			}
			fmt.Fprintf(stdout, "hq queue validation: %s records=%v errors=%d\n", verdict, result["records"], len(result["errors"].([]any)))
		}
		if result["ok"] == true {
			return 0
		}
		return 1
	case "work":
		usage := "usage: hq-modeling-runtime work --input <queue.jsonl> [--json]"
		values, code, message := parseInputCommand(args[1:], usage)
		if code != 0 {
			fmt.Fprintln(stderr, message)
			return code
		}
		file, ok := openInput(stringValue(values, "input"), stderr)
		if !ok {
			return 1
		}
		defer file.Close()
		result := RunLocalWorkerJSONL(file)
		if boolValue(values, "json") {
			_ = writeJSON(stdout, result, true)
		} else {
			verdict := "FAIL"
			if result["ok"] == true {
				verdict = "PASS"
			}
			fmt.Fprintf(stdout, "hq local worker: %s processed=%v pending=%v ignored=%v failed=%v\n", verdict, result["processed"], result["pending"], result["ignored"], result["failed"])
		}
		if result["ok"] == true {
			return 0
		}
		return 1
	case "receipts":
		usage := "usage: hq-modeling-runtime receipts --input <queue.jsonl> [--jsonl|--json]"
		values, code, message := parseInputCommand(args[1:], usage, "jsonl")
		if code != 0 {
			fmt.Fprintln(stderr, message)
			return code
		}
		file, ok := openInput(stringValue(values, "input"), stderr)
		if !ok {
			return 1
		}
		defer file.Close()
		result := RunLocalWorkerWithReceiptsJSONL(file)
		if boolValue(values, "jsonl") {
			rows, _ := result["receiptRows"].([]any)
			encoded, _ := RowsToJSONL(rows)
			_, _ = stdout.Write(encoded)
		} else if boolValue(values, "json") {
			_ = writeJSON(stdout, result, true)
		} else {
			verdict := "FAIL"
			if result["ok"] == true {
				verdict = "PASS"
			}
			fmt.Fprintf(stdout, "hq receipt writer: %s receipts=%v digest=%v\n", verdict, result["receipts"], result["receiptDigest"])
		}
		if result["ok"] == true {
			return 0
		}
		return 1
	case "projection":
		usage := "usage: hq-modeling-runtime projection --input <queue.jsonl> [--json]"
		values, code, message := parseInputCommand(args[1:], usage)
		if code != 0 {
			fmt.Fprintln(stderr, message)
			return code
		}
		file, ok := openInput(stringValue(values, "input"), stderr)
		if !ok {
			return 1
		}
		defer file.Close()
		worker := RunLocalWorkerWithReceiptsJSONL(file)
		result := BuildRepoMapProjection(worker)
		if boolValue(values, "json") {
			_ = writeJSON(stdout, result, true)
		} else {
			projection := ensureObject(result["projection"])
			verdict := "FAIL"
			if result["ok"] == true {
				verdict = "PASS"
			}
			fmt.Fprintf(stdout, "hq repo-map projection: %s nodes=%d edges=%d digest=%v\n", verdict, len(projection["nodes"].([]any)), len(projection["edges"].([]any)), projection["projectionDigest"])
		}
		if result["ok"] == true {
			return 0
		}
		return 1
	case "admit":
		usage := "usage: hq-modeling-runtime admit --input <queue.jsonl> [--accepted-jsonl|--receipt-jsonl|--json]"
		values, code, message := parseInputCommand(args[1:], usage, "accepted-jsonl", "receipt-jsonl")
		if code != 0 {
			fmt.Fprintln(stderr, message)
			return code
		}
		file, ok := openInput(stringValue(values, "input"), stderr)
		if !ok {
			return 1
		}
		defer file.Close()
		result := RunAdmissionGateJSONL(file)
		if boolValue(values, "accepted-jsonl") {
			rows, _ := result["acceptedRows"].([]any)
			encoded, _ := RowsToJSONL(rows)
			_, _ = stdout.Write(encoded)
		} else if boolValue(values, "receipt-jsonl") {
			rows, _ := result["admissionReceipts"].([]any)
			encoded, _ := RowsToJSONL(rows)
			_, _ = stdout.Write(encoded)
		} else if boolValue(values, "json") {
			_ = writeJSON(stdout, result, true)
		} else {
			verdict := "FAIL"
			if result["ok"] == true {
				verdict = "PASS"
			}
			fmt.Fprintf(stdout, "hq admission gate: %s admitted=%v rejected=%v ledgerDigest=%v\n", verdict, result["admitted"], result["rejected"], result["ledgerDigest"])
		}
		if result["ok"] == true {
			return 0
		}
		return 1
	case "promote":
		usage := "usage: hq-modeling-runtime promote --input <proposal.json> --confirmation <confirmation.json> [--queue-jsonl|--receipt-jsonl|--json]"
		hints := promotionOutputHints(args[1:])
		parsed := parseOptions(args[1:], map[string]bool{"input": true, "confirmation": true}, map[string]bool{"queue-jsonl": true, "receipt-jsonl": true, "json": true})
		values := parsed.values
		for key, value := range hints {
			values[key] = value
		}
		if parsed.error != nil {
			result := promotionFailure("promotion-usage-error", parsed.error.Error(), Object{"usage": usage})
			printPromotionFailure(stdout, stderr, result, values)
			return 2
		}
		if stringValue(values, "input") == "" {
			result := promotionFailure("promotion-input-required", "--input is required", Object{"usage": usage})
			printPromotionFailure(stdout, stderr, result, values)
			return 2
		}
		if stringValue(values, "confirmation") == "" {
			result := promotionFailure("promotion-confirmation-required", "--confirmation is required", Object{"usage": usage})
			printPromotionFailure(stdout, stderr, result, values)
			return 2
		}
		modes := 0
		for _, option := range []string{"queue-jsonl", "receipt-jsonl", "json"} {
			if boolValue(values, option) {
				modes++
			}
		}
		if modes > 1 {
			result := promotionFailure("promotion-output-mode-conflict", "choose at most one promotion output mode", Object{"usage": usage})
			printPromotionFailure(stdout, stderr, result, values)
			return 2
		}
		proposalInput := readPromotionJSON(stringValue(values, "input"), "proposal")
		if proposalInput["ok"] != true {
			printPromotionFailure(stdout, stderr, proposalInput, values)
			return 1
		}
		confirmationInput := readPromotionJSON(stringValue(values, "confirmation"), "confirmation")
		if confirmationInput["ok"] != true {
			printPromotionFailure(stdout, stderr, confirmationInput, values)
			return 1
		}
		result := PromoteProposalToModelQueue(proposalInput["value"], confirmationInput["value"])
		if result["ok"] != true {
			printPromotionFailure(stdout, stderr, result, values)
			return 1
		}
		if boolValue(values, "queue-jsonl") {
			encoded, _ := RowsToJSONL([]any{result["queueRow"]})
			_, _ = stdout.Write(encoded)
		} else if boolValue(values, "receipt-jsonl") {
			encoded, _ := RowsToJSONL([]any{result["promotionReceipt"]})
			_, _ = stdout.Write(encoded)
		} else if boolValue(values, "json") {
			_ = writeJSON(stdout, result, true)
		} else {
			receipt := ensureObject(result["promotionReceipt"])
			row := ensureObject(result["queueRow"])
			fmt.Fprintf(stdout, "hq proposal promotion: PASS proposal=%v queue=%v digest=%v\n", receipt["proposalId"], row["id"], row["proposalDigest"])
		}
		return 0
	default:
		fmt.Fprintf(stderr, "unknown argument: %s\n", strings.Join(args, " "))
		return 2
	}
}

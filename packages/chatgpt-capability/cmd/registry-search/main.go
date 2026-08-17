//go:build js && wasm

package main

import (
	"strings"
	"syscall/js"
)

var scoreFunc js.Func

func normalized(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func score(_ js.Value, args []js.Value) any {
	if len(args) < 6 {
		return 0
	}
	query := normalized(args[0].String())
	if query == "" {
		return 1
	}
	id := normalized(args[1].String())
	title := normalized(args[2].String())
	purpose := normalized(args[3].String())
	tags := normalized(args[4].String())
	status := normalized(args[5].String())

	score := 0
	switch {
	case id == query:
		score += 120
	case strings.HasPrefix(id, query):
		score += 100
	case strings.Contains(id, query):
		score += 80
	}
	switch {
	case title == query:
		score += 90
	case strings.HasPrefix(title, query):
		score += 70
	case strings.Contains(title, query):
		score += 55
	}
	if strings.Fields(tags) != nil {
		for _, tag := range strings.Fields(tags) {
			if tag == query {
				score += 65
			} else if strings.Contains(tag, query) {
				score += 35
			}
		}
	}
	if strings.Contains(purpose, query) {
		score += 40
	}
	if status == query {
		score += 30
	}
	return score
}

func main() {
	scoreFunc = js.FuncOf(score)
	js.Global().Set("capSearchScore", scoreFunc)
	select {}
}

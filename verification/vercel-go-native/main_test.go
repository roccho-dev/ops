package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHealth(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "\"runtime\":\"go\"") || !strings.Contains(body, "\"status\":\"ok\"") {
		t.Fatalf("unexpected body: %s", body)
	}
}

func TestRoot(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK || rec.Body.String() != "vercel-go-native-proof\n" {
		t.Fatalf("unexpected response: %d %q", rec.Code, rec.Body.String())
	}
}

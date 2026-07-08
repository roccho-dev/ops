package duckdb

import "testing"

func TestDuckDBAdapterIsNeverCoreAuthority(t *testing.T) {
	adapter := NewProjectionAdapter()
	if adapter.RunnerKind != "duckdb" {
		t.Fatalf("unexpected runner kind %q", adapter.RunnerKind)
	}
	if adapter.IsCoreAuthority() {
		t.Fatalf("DuckDB adapter must remain projection/read-only, not core authority")
	}
}

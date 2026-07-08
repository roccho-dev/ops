package duckdb

// ProjectionAdapter is a dependency-light boundary marker. The Go core does not import DuckDB.
type ProjectionAdapter struct{ RunnerKind string }

func NewProjectionAdapter() ProjectionAdapter     { return ProjectionAdapter{RunnerKind: "duckdb"} }
func (a ProjectionAdapter) IsCoreAuthority() bool { return false }

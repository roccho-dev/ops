package docs

import _ "embed"

//go:embed nway-runbook.md
var nwayRunbook string

// NWayRunbook returns the package-owned N-way runbook exactly as carried.
func NWayRunbook() string {
	return nwayRunbook
}

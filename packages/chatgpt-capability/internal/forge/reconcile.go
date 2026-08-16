package forge

import (
	"sort"
	"strings"
)

func reconcile(decisions map[string]DecisionClaim, implementations map[string]ImplementationClaim, implementationDirs map[string]string) []RegistryRecord {
	idSet := map[string]struct{}{}
	for id := range decisions {
		idSet[id] = struct{}{}
	}
	for id := range implementations {
		idSet[id] = struct{}{}
	}
	for id := range implementationDirs {
		idSet[id] = struct{}{}
	}
	ids := make([]string, 0, len(idSet))
	for id := range idSet {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	records := make([]RegistryRecord, 0, len(ids))
	for _, id := range ids {
		decision, hasDecision := decisions[id]
		impl, hasImpl := implementations[id]
		_, hasDir := implementationDirs[id]
		record := RegistryRecord{Schema: RegistrySchema, ID: id}
		if hasDecision {
			decisionCopy := decision
			record.Decision = &decisionCopy
			record.Title = decision.Title
			record.Purpose = decision.Purpose
			record.Tags = append([]string(nil), decision.Tags...)
		}
		if hasImpl {
			implCopy := impl
			record.Implementation = &implCopy
		}

		switch {
		case hasDecision && decision.Action == "retire":
			if hasImpl || hasDir {
				record.Status = "drift"
				record.Issues = append(record.Issues, "retired decision still has implementation")
			} else {
				record.Status = "retired"
			}
		case hasDecision && decision.Action == "adopt" && !hasImpl:
			record.Status = "planned"
		case !hasDecision && (hasImpl || hasDir):
			record.Status = "unadopted"
		case hasDecision && hasImpl:
			expectedAt := normalizeAt(id, decision.At)
			if expectedAt != impl.At {
				record.Status = "drift"
				record.Issues = append(record.Issues, "placement mismatch")
			} else if impl.BuildStatus != "PASS" || (impl.FixtureResult != nil && impl.FixtureResult.Status != "PASS") {
				record.Status = "unobserved"
				if impl.Error != "" {
					record.Issues = append(record.Issues, impl.Error)
				} else {
					record.Issues = append(record.Issues, "implementation verification did not pass")
				}
			} else {
				record.Status = "active"
			}
		default:
			record.Status = "unobserved"
			record.Issues = append(record.Issues, "incomplete reconciliation state")
		}

		searchParts := []string{id, record.Title, record.Purpose, record.Status}
		searchParts = append(searchParts, record.Tags...)
		if hasImpl {
			searchParts = append(searchParts, impl.Kind, impl.Target, impl.Language, impl.At)
		}
		record.SearchText = strings.Join(searchParts, " ")
		records = append(records, record)
	}
	return records
}

package authority

import (
	"fmt"
	"strings"

	validate "cueappendcontract/internal/core/validate"
)

func AuthorityCheck(path string) (map[string]any, error) {
	rows, err := validate.ReadJSONL(path)
	if err != nil {
		return nil, err
	}
	errors := []string{}
	accepted := 0
	for _, row := range rows {
		actorKind := validate.Str(row["actor_kind"])
		status := validate.Str(row["decision_status"])
		if status == "accepted" {
			accepted++
		}
		if actorKind == "projection" && status == "accepted" {
			errors = append(errors, fmt.Sprintf("line %v: projection cannot create accepted decision", row["__line__"]))
		}
		if status == "accepted" && validate.Str(row["receipt_ref"]) == "" {
			errors = append(errors, fmt.Sprintf("line %v: accepted decision requires receipt_ref", row["__line__"]))
		}
		if status == "accepted" && !validate.In(actorKind, []string{"governance", "owner"}) {
			errors = append(errors, fmt.Sprintf("line %v: actor_kind %s cannot accept decision", row["__line__"], actorKind))
		}
	}
	if len(errors) > 0 {
		return nil, fmt.Errorf("authority check failed: %s", strings.Join(errors, "; "))
	}
	return map[string]any{"status": "pass", "check": "authority", "accepted": accepted}, nil
}

package admission

import (
	"fmt"
	"regexp"
)

var localPolicyRefRE = regexp.MustCompile(`^local-policy-sha256:[0-9a-f]{64}$`)

func ValidatePolicyRef(ref string) error {
	if exactCommitRE.MatchString(ref) || localPolicyRefRE.MatchString(ref) {
		return nil
	}
	return fmt.Errorf("MUTABLE_POLICY_REF: exact 40-hex commit or local-policy-sha256 identity required, got %q", ref)
}

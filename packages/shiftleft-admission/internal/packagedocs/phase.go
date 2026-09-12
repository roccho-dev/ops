package packagedocs

import "fmt"

const (
	PhaseFull      = "full"
	PhasePreflight = "preflight"
)

// ApplyPhase keeps one observation schema while allowing repository preflight
// to defer package-output checks to the package build that owns those surfaces.
func ApplyPhase(observations []Observation, phase string) ([]Observation, error) {
	switch phase {
	case PhaseFull:
		return append([]Observation(nil), observations...), nil
	case PhasePreflight:
		out := append([]Observation(nil), observations...)
		for i := range out {
			if out[i].RuleID != RuleDistribution {
				continue
			}
			out[i].Status = "not-applicable"
			out[i].FindingCode = "distribution-deferred-to-package-build"
			out[i].Evidence = []Evidence{{Kind: "phase", Detail: PhasePreflight}}
			finalized, err := finalizeObservation(out[i])
			if err != nil {
				return nil, err
			}
			out[i] = finalized
		}
		return out, nil
	default:
		return nil, fmt.Errorf("PHASE_INVALID: %s", phase)
	}
}

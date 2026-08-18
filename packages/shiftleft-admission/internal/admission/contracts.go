package admission

import (
	"fmt"
	"strings"
)

func internalObservation(ruleID, packageID, status, code string, required bool, evidence []Evidence) (Observation, error) {
	o := Observation{
		Schema: "shiftleft-observation/1", RuleID: ruleID, ProfileID: "internal.contract",
		PackageID: packageID, Language: "language-neutral", Required: required,
		Status: status, FindingCode: code, ConfigSHA256: "sha256:" + shaHex([]byte(ruleID+"\n"+packageID+"\n"+code+"\n")),
		Tool:     ToolIdentity{Name: "policyctl", Version: "1", AdapterSHA256: "builtin", Digest: "sha256:" + shaHex([]byte("policyctl-contract-provider/2"))},
		Evidence: evidence,
	}
	return finalizeObservation(o)
}

func nonblank(v string) bool { return strings.TrimSpace(v) != "" }

func routeComplete(r Route, requireEffectCount bool) bool {
	if !nonblank(r.ID) || !nonblank(r.Fixture) || !nonblank(r.Expected) {
		return false
	}
	return !requireEffectCount || r.EffectCount != nil
}

func contractRuleObservations(b *Bundle) ([]Observation, error) {
	out := []Observation{}
	for _, c := range b.Contracts {
		parseOK := nonblank(c.ParseBoundary.RawInput) && nonblank(c.ParseBoundary.ParsedInput) && nonblank(c.ParseBoundary.Parser) && !c.ParseBoundary.EffectBeforeParseAllowed && !c.ParseBoundary.RawReuseAllowed
		for _, pc := range c.PublicContracts {
			zeroEffectNegative := false
			for _, r := range pc.NegativeRoutes {
				if routeComplete(r, true) && r.EffectCount != nil && *r.EffectCount == 0 {
					zeroEffectNegative = true
				}
			}
			parseOK = parseOK && zeroEffectNegative
		}
		parseEvidence := []Evidence{{Kind: "contract", Detail: "raw -> parser -> domain; every public contract has a zero-effect malformed route"}}
		status, code := StatusMet, "parse-boundary-complete"
		if !parseOK {
			status, code = StatusUnmet, "parse-boundary-incomplete"
			parseEvidence = []Evidence{{Kind: "contract", Detail: "parse boundary incomplete, raw reuse/effect enabled, or a public contract lacks a zero-effect malformed route"}}
		}
		o, err := internalObservation("SL-PARSE-001", c.PackageID, status, code, true, parseEvidence)
		if err != nil {
			return nil, err
		}
		out = append(out, o)

		contractOK := len(c.PublicContracts) > 0
		goldenOK := len(c.PublicContracts) > 0
		yagniOK := len(c.PublicContracts) > 0
		contractEvidence, goldenEvidence, yagniEvidence := []Evidence{}, []Evidence{}, []Evidence{}
		for _, pc := range c.PublicContracts {
			missing := []string{}
			for name, value := range map[string]string{
				"id": pc.ID, "entrypoint": pc.EntryPoint, "input": pc.Input, "output": pc.Output,
				"error": pc.Error, "effect": pc.Effect, "determinism": pc.Determinism,
			} {
				if !nonblank(value) {
					missing = append(missing, name)
				}
			}
			if len(missing) > 0 {
				contractOK = false
				contractEvidence = append(contractEvidence, Evidence{Kind: "public-contract", Detail: pc.ID + " missing " + strings.Join(missing, ",")})
			}

			routesOK := len(pc.GoldenRoutes) == 1 && len(pc.NegativeRoutes) > 0
			for _, r := range pc.GoldenRoutes {
				routesOK = routesOK && routeComplete(r, false)
			}
			for _, r := range pc.NegativeRoutes {
				routesOK = routesOK && routeComplete(r, true)
			}
			if !routesOK {
				goldenOK = false
				goldenEvidence = append(goldenEvidence, Evidence{Kind: "route", Detail: pc.ID + " requires one complete canonical golden route and at least one complete negative route"})
			}

			consumerOK := len(pc.CurrentConsumers) > 0
			for _, consumer := range pc.CurrentConsumers {
				consumerOK = consumerOK && nonblank(consumer)
			}
			if !consumerOK || !routesOK {
				yagniOK = false
				yagniEvidence = append(yagniEvidence, Evidence{Kind: "consumer", Detail: pc.ID + " lacks a nonblank current consumer or executable golden route"})
			}
		}
		if contractOK {
			contractEvidence = []Evidence{{Kind: "public-contract", Detail: fmt.Sprintf("%d public contracts declare in/out/error/effect/determinism", len(c.PublicContracts))}}
		}
		if goldenOK {
			goldenEvidence = []Evidence{{Kind: "route", Detail: "all public contracts have one complete canonical golden route and complete negative routes"}}
		}
		if yagniOK {
			yagniEvidence = []Evidence{{Kind: "consumer", Detail: "all public contracts have nonblank current consumers and executable golden routes"}}
		}
		for _, spec := range []struct {
			rule       string
			ok         bool
			pass, fail string
			ev         []Evidence
		}{
			{"SL-CONTRACT-001", contractOK, "public-contract-complete", "public-contract-incomplete", contractEvidence},
			{"SL-GOLDEN-001", goldenOK, "golden-negative-routes-complete", "golden-route-missing", goldenEvidence},
			{"SL-YAGNI-001", yagniOK, "current-consumer-present", "current-consumer-missing", yagniEvidence},
		} {
			s, finding := StatusMet, spec.pass
			if !spec.ok {
				s, finding = StatusUnmet, spec.fail
			}
			o, err := internalObservation(spec.rule, c.PackageID, s, finding, true, spec.ev)
			if err != nil {
				return nil, err
			}
			out = append(out, o)
		}
	}
	return out, nil
}

func ContractObservations(b *Bundle) ([]Observation, error) {
	return contractRuleObservations(b)
}

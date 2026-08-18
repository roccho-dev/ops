package admission

import (
	"fmt"
	"sort"
	"strings"
)

func internalObservation(ruleID, packageID, status, code string, required bool, evidence []Evidence) (Observation, error) {
	o := Observation{
		Schema: "shiftleft-observation/1", RuleID: ruleID, ProfileID: "internal.contract",
		PackageID: packageID, Language: "language-neutral", Required: required,
		Status: status, FindingCode: code, ConfigSHA256: "sha256:" + shaHex([]byte(ruleID+"\n"+packageID+"\n"+code+"\n")),
		Tool:     ToolIdentity{Name: "policyctl", Version: "1", AdapterSHA256: "builtin", Digest: "sha256:" + shaHex([]byte("policyctl-contract-provider/1"))},
		Evidence: evidence,
	}
	return finalizeObservation(o)
}

func ContractObservations(b *Bundle) ([]Observation, error) {
	out := []Observation{}
	for _, c := range b.Contracts {
		parseEvidence := []Evidence{}
		parseOK := c.ParseBoundary.RawInput != "" && c.ParseBoundary.ParsedInput != "" && c.ParseBoundary.Parser != "" && !c.ParseBoundary.EffectBeforeParseAllowed && !c.ParseBoundary.RawReuseAllowed
		negativeZero := false
		for _, pc := range c.PublicContracts {
			for _, r := range pc.NegativeRoutes {
				if r.EffectCount != nil && *r.EffectCount == 0 {
					negativeZero = true
				}
			}
		}
		parseOK = parseOK && negativeZero
		if parseOK {
			parseEvidence = append(parseEvidence, Evidence{Kind: "contract", Detail: "raw -> parser -> domain; malformed route has zero effects"})
		} else {
			parseEvidence = append(parseEvidence, Evidence{Kind: "contract", Detail: "parse boundary incomplete or malformed route lacks effectCount=0"})
		}
		status, code := StatusMet, "parse-boundary-complete"
		if !parseOK {
			status, code = StatusUnmet, "parse-boundary-incomplete"
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
			if pc.ID == "" {
				missing = append(missing, "id")
			}
			if pc.EntryPoint == "" {
				missing = append(missing, "entrypoint")
			}
			if pc.Input == "" {
				missing = append(missing, "input")
			}
			if pc.Output == "" {
				missing = append(missing, "output")
			}
			if pc.Error == "" {
				missing = append(missing, "error")
			}
			if pc.Effect == "" {
				missing = append(missing, "effect")
			}
			if len(missing) > 0 {
				contractOK = false
				contractEvidence = append(contractEvidence, Evidence{Kind: "public-contract", Detail: pc.ID + " missing " + strings.Join(missing, ",")})
			}
			if len(pc.GoldenRoutes) == 0 || len(pc.NegativeRoutes) == 0 {
				goldenOK = false
				goldenEvidence = append(goldenEvidence, Evidence{Kind: "route", Detail: pc.ID + " requires golden and negative route"})
			}
			if len(pc.CurrentConsumers) == 0 || len(pc.GoldenRoutes) == 0 {
				yagniOK = false
				yagniEvidence = append(yagniEvidence, Evidence{Kind: "consumer", Detail: pc.ID + " lacks current consumer or golden route"})
			}
		}
		if contractOK {
			contractEvidence = []Evidence{{Kind: "public-contract", Detail: fmt.Sprintf("%d public contracts complete", len(c.PublicContracts))}}
		}
		if goldenOK {
			goldenEvidence = []Evidence{{Kind: "route", Detail: "all public contracts have golden and negative routes"}}
		}
		if yagniOK {
			yagniEvidence = []Evidence{{Kind: "consumer", Detail: "all public contracts have current consumers"}}
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
			s, code := StatusMet, spec.pass
			if !spec.ok {
				s, code = StatusUnmet, spec.fail
			}
			o, err := internalObservation(spec.rule, c.PackageID, s, code, true, spec.ev)
			if err != nil {
				return nil, err
			}
			out = append(out, o)
		}
	}
	requiredKinds := map[string]bool{"good": true, "bad": true, "false-positive": true, "false-negative": true}
	for _, r := range b.Rules {
		if r.Strength != "block" {
			continue
		}
		got := map[string]bool{}
		for _, k := range r.FixtureKinds {
			got[k] = true
		}
		missing := []string{}
		for k := range requiredKinds {
			if !got[k] {
				missing = append(missing, k)
			}
		}
		sort.Strings(missing)
		status, code := StatusMet, "fixture-matrix-complete"
		ev := []Evidence{{Kind: "fixture-matrix", Detail: "good,bad,false-positive,false-negative declared"}}
		if len(missing) > 0 {
			status, code = StatusUnmet, "fixture-matrix-incomplete"
			ev = []Evidence{{Kind: "fixture-matrix", Detail: "missing " + strings.Join(missing, ",")}}
		}
		o, err := internalObservation("SL-TEST-001", "policy:"+r.ID, status, code, true, ev)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, nil
}

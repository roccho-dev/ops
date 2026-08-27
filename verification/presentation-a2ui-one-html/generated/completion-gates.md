# Presentation A2UI one-HTML — completion gates

> Generated from canonical JSONL and non-authority receipts. Do not hand-edit.

- Repository gates: **46 / 46 PASS**
- External gates: **5 OPEN**
- Product completion: **NOT CLAIMED**
- UI revision: `9bdec04db79ca50aee8c387232aeb98fb3a13f6d`
- Artifact SHA-256: `1e5f20becf55242a076342928d1b6df74276b78f6fd927a4094c24be88befc44`
- Artifact: **184601 bytes**, **4 pages**, **5472 default URL characters**
- Publication: **RS256 signed**, **7 no-redeploy customer URLs**, exact audience supported
- Enterprise-value publication: **runtime PASS**, EBITDA **4080000 JPY**, risk-adjusted contribution **19584000 JPY**
- Browser: **57 assertions**, **0 errors**, **12 routed requests**, **0 forbidden requests**
- OPS output tree SHA-256: `730f942e569b5746b91672447806d15940af9fc1a6fb59bb21edea1649a16c6a`

## Repository gates

| ID | Group | Owner | Status | Requirement | Evidence | Note |
|---|---|---|---|---|---|---|
| A2U-001 | a2ui | ui | PASS | presentation carries a valid three-message A2UI batch | UI build receipt | PASS: 3 messages |
| A2U-002 | a2ui | ui | PASS | component pages select trusted A2UI roots without a Slide component | UI purity gate | PASS: 3 component-root pages; no Slide catalog entry |
| ACT-001 | interaction | ui | PASS | A2UI Button client action changes the active target through the generic shell | UI browser receipt | PASS: generic presentation action opened the module target |
| AGC-001 | agc | ui | PASS | an already deployed static shell can publish supported presentation data on an onboarded customer hostname without rebuilding the app | UI build receipt and presentation URL tests | PASS: owner and customer host URLs carry an identical presentation fragment; appRedeployRequired=false |
| AGC-002 | agc | ui | PASS | customer enterprise-value content is projected to typed presentation data, signed for the exact artifact and customer origin, and accepted by the deployed one-HTML runtime | enterprise-value example receipt and UI browser receipt | PASS: EBITDA=4080000 JPY; risk-adjusted contribution=19584000 JPY; signed URL accepted by the actual one-HTML runtime |
| ARC-001 | architecture | ui | PASS | presentation core delegates URL module display and contains no iframe sandbox or src behavior | UI purity gate | PASS: presentation core has no iframe,sandbox,allow-scripts,or src behavior |
| AUT-001 | authority | both | PASS | artifact and receipts remain non-authoritative | UI and OPS receipts | PASS: UI browser/build and OPS assembly receipts authority=false |
| AUT-002 | authorization | ui | PASS | artifact-module rendering cannot be constructed without trusted target authorization | UI artifact-module renderer tests | PASS: renderer construction without authorizeTarget is rejected |
| BND-001 | boundary | both | PASS | no-redeploy AGC does not claim that DNS TLS custom-host routing or customer framing policy are supplied by the static artifact | UI build receipt and package README | PASS: receipt explicitly keeps DNS TLS custom-hostname onboarding outside the static artifact |
| DEP-001 | publication | ui | PASS | new artifact-bound customer URLs are signed and generated from policy template and artifact data without rebuilding the static app | UI build and browser receipts | PASS: 7 artifact-bound customer URLs; browser noRedeploy=true |
| DET-001 | reproducibility | ui | PASS | two builds produce the same artifact SHA-256 | UI static check | PASS: sha256=77cfb07e8bdca3c6d3fd49cdb1af163fc2b40a947a9a56fd735b95a4d4a880ad |
| DET-002 | reproducibility | ui | PASS | a clean checkout rejects stale checked-in presentation output or browser receipt before build tests can overwrite it | UI source-to-output check mode | PASS: --check detects stale generated HTML, build receipt, publication fixtures, or browser receipt before overwrite |
| DIG-001 | provenance | both | PASS | OPS lock pins the exact UI revision and artifact SHA-256 | OPS lock versus UI proof receipt | PASS: UI 9c19be103c and artifact digest locked |
| ERR-001 | browser | ui | PASS | browser console and page error lists remain empty | UI browser receipt | PASS: errors=[] |
| HTML-001 | artifact | ui | PASS | artifact output contains exactly one HTML file | UI build receipt | PASS: index.html only; 134793 bytes |
| HTML-002 | artifact | ui | PASS | one HTML carries runtime styles deck registry keys policy and URL module without external script or stylesheet files | UI static check | PASS: 29 local ESM modules, signed policy keys, lifecycle contract, and 1 versioned module manifest embedded |
| LIF-001 | module-contract | ui | PASS | URL module lifecycle protocol is versioned and fixed by the trusted manifest | UI build and browser receipts | PASS: manifest v2 fixes artifact-module-lifecycle/1 and 3000ms timeout |
| LIF-002 | module-conformance | ui | PASS | a load event alone cannot pass; child identity and renderer version must match exactly | UI browser receipt | PASS: exact MessageChannel ready receipt observed before PASS in Chromium |
| LIF-003 | module-conformance | ui | PASS | timeout mismatched ready receipt and disallowed source kind cannot produce a false green | UI browser-adapter unit tests | PASS: timeout false identity and disallowed source tests fail closed with fallback |
| LIF-004 | module-conformance | ui | PASS | a document manifest that omits the script capability required by the readiness lifecycle is rejected before mounting | UI iframe adapter tests | PASS: readiness lifecycle requires exactly the script capability before mount |
| MOB-001 | browser | ui | PASS | mobile viewport renders and operates both target modes | UI browser receipt | PASS: chromium 144.0.7559.96 at customer B mobile viewport |
| MOD-000 | module-contract | ui | PASS | URL module page carries appId contractVersion and href but no renderer choice | UI static check | PASS: page target contains appId,contractVersion,href; rendererKind absent |
| MOD-001 | module-routing | ui | PASS | artifact module registry selects the renderer adapter for the URL module target | UI static and browser receipts | PASS: manifest resolved conforming-document/1 through trusted iframe-document@2 |
| MOD-002 | module-adapter | ui | PASS | selected document adapter runs with allow-scripts and without allow-same-origin | UI browser receipt | PASS: sandbox=allow-scripts; allowSameOrigin=false |
| MOD-003 | module-adapter | ui | PASS | URL module JavaScript executes independently | UI browser receipt | PASS: inline and external module code executed independently |
| MOD-004 | module-adapter | ui | PASS | leaving the URL module page disposes the selected adapter output | UI browser receipt | PASS: selected adapter output is disposed when target changes |
| MOD-005 | module-routing | ui | PASS | module manifest renderer version must exactly match the trusted adapter version | UI package and browser receipts | PASS: manifest-versioned-iframe-adapter verified as iframe-document@2 |
| MOD-006 | module-adapter | ui | PASS | external document readiness is a typed channel-bound message with deterministic timeout | UI package and browser receipts | PASS: artifact-module-lifecycle/1 init/ready identity and deterministic timeout verified |
| MOD-007 | module-policy | ui | PASS | a disallowed module origin is rejected before any module request | UI browser receipt | PASS: disallowed-module-origin-blocked-before-network |
| NET-001 | browser | ui | PASS | all observed requests match the proof routes and forbidden request list remains empty | UI browser receipt | PASS: requestCount=12; forbiddenNetworkRequests=[] |
| OPS-001 | assembly | ops | PASS | generic artifact-assembly reproduces the locked one-file output | assembly receipt | PASS: generic file assembly receipt generated |
| PAG-001 | page-contract | ui | PASS | page target kinds are limited to component and url-module | UI package tests | PASS: component,url-module |
| PUB-001 | publication-policy | ui | PASS | publication policy is signed with RS256 and verified before artifact resolution | UI package and browser receipts | PASS: RS256 signed portable and exact-audience artifact-bound policies verified |
| PUB-002 | publication-policy | ui | PASS | exact origin audience and tenant binding are enforced | UI browser receipt | PASS: signed-exact-domain-audience and tenant-binding browser assertions |
| PUB-003 | publication-policy | ui | PASS | module and artifact origins are exact allowlists and source kind is derived rather than trusted from input | UI publication package tests | PASS: exact origin policy and derived source kind package tests |
| PUB-004 | publication-policy | ui | PASS | signed publication binds exact canonical inline artifact digest or referenced-byte digest and transport | UI package, build, and browser receipts | PASS: artifact-publication-policy/2 binds transport and SHA-256; signed-artifact-digest-binding verified |
| PUB-005 | publication-policy | ui | PASS | changing inline content or reference digest without a new signature is rejected before artifact network or presentation runtime | UI browser receipt | PASS: mutated-reference-binding-blocked-before-network and tampered-inline-binding-blocked-before-runtime |
| PUB-006 | publication-policy | ui | PASS | publication output contains both exact signed policy and presentation fields and is consumable by the actual deployed one-HTML shell | enterprise-value example receipt, signed URL, and UI browser receipt | PASS: signed enterprise-value URL contains policy and presentation and passes deployed-shell Chromium replay |
| REF-001 | artifact-reference | ui | PASS | referenced presentation bytes media type size and SHA-256 are verified before JSON use | UI package and browser receipts | PASS: reference-plus-sha256 browser assertion |
| REF-002 | artifact-reference | ui | PASS | a bad referenced artifact digest blocks before module execution | UI browser receipt | PASS: bad-digest-blocked-before-module |
| SEC-001 | input-security | ui | PASS | scheme-relative backslash duplicate and unknown-field inputs fail closed | UI package tests | PASS: strict publication/reference/fragment validators reject ambiguous inputs |
| SRC-001 | module-contract | ui | PASS | registered source policy accepts only source forms the browser adapter actually implements | UI package tests and build receipt | PASS: sourcePolicyKinds=https,inline-html,relative; http,blob,urn,hash and mismatches rejected |
| SRC-002 | module-policy | ui | PASS | the iframe and fallback navigation consume the canonical URL returned by authorization rather than the untrusted raw source URL | UI iframe adapter tests | PASS: normalized authorization.href is the sole iframe src and external-link fallback target |
| TEN-001 | tenant-routing | ui | PASS | the exact same one-HTML artifact runs on owner customer A and customer B origins | UI browser receipt | PASS: one locked HTML served at owner, customer A, and customer B origins |
| TEN-002 | tenant-routing | ui | PASS | a wrong audience is rejected before artifact or module network access | UI browser receipt | PASS: wrong-audience-blocked-before-artifact-or-module-network |
| URL-001 | transport | ui | PASS | URL fragment fields round-trip as canonical gzip plus base64url and reject duplicates | UI package and deterministic build tests | PASS: default fragment 5472 chars; canonical multi-field fragment and duplicate rejection retained |

## External gates kept open

| ID | Owner | Status | Requirement | Evidence needed | Note |
|---|---|---|---|---|---|
| DOM-EXT-001 | ops+customer | OPEN | A real customer-controlled hostname routes to the owner runtime over valid HTTPS | real customer DNS ownership, custom hostname registration, and managed TLS receipt | Browser origin proof does not provision DNS or certificates. |
| DOM-EXT-002 | ops | OPEN | The delivery edge binds allowed hostnames to tenants and can revoke them without app redeploy | edge Host-to-tenant allowlist, revocation, and unauthorized-host rejection receipt | Client-side audience verification is fail-closed runtime policy, not copy protection or edge authorization. |
| MOD-EXT-001 | ui+module-owner | OPEN | A production external URL module satisfies the published embedding and lifecycle contract | real hosted module conformance covering CSP frame-ancestors or X-Frame-Options, redirects, failure fallback, and optional CORS | Playwright route fulfillment proves browser boundaries without claiming every live external URL is embeddable. |
| KEY-EXT-001 | ops | OPEN | Publication signatures use production key custody and a tested rotation and revocation path | production KMS or HSM key custody, rotation, public-key cutover, and policy revocation receipts | Repository fixtures use an explicitly non-production test private key. |
| BROWSER-EXT-001 | ui | OPEN | Supported non-Chromium browsers and presentation accessibility behavior pass acceptance | Firefox and Safari compatibility plus accessibility, focus, and print acceptance receipts | Current proof is Chromium 144 only. |

# M0 — one native Cloudflare Email Routing alias

Ref: [approved process](https://github.com/roccho-org/ops/pull/509) · [implementation GO](https://github.com/roccho-org/ops/pull/509#issuecomment-6057484444) · [envs boundary](https://github.com/roccho-org/envs/pull/58).

The goal is **one specified literal alias** on an already owned Cloudflare zone forwarded to an **Owner-verified personal Gmail**. Cloudflare Email Routing (not a Worker) handles ordinary mail. The initial M0 does **not** use Gmail API/OAuth, R2 Hot, draft UI or a sending service. This root is not live configuration until Owner-specific authority and evidence have been confirmed. Source/CI Green is not mail arrival.

## Native toolchain (source-only, no credential or provider effect)

Use the published ops flake package: \`nix build --no-link --print-out-paths .#packages.x86_64-linux.mail-routing-tofu\`. Use its \`bin/tofu\`, not an ambient Terraform or downloaded binary. \`nix build --no-link .#checks.x86_64-linux.mail-routing-native\` tests \`fmt\`, \`init -backend=false -lockfile=readonly\`, \`validate\`, and a native \`tofu test\` with a mocked Cloudflare provider. The pinned v5.21.1 provider comes from the exact existing envs Nixpkgs revision, with real provider checksum evidence. None of these commands touches a real domain.

## Inputs: type, custody, and purpose

| Name | Type / role | Custody |
|---|---|---|
| \`account_id\` | real Cloudflare account ID (destination is account-shared) | Owner/private \`TF_VAR_account_id\` |
| \`zone_id\`, \`zone_name\` | exact existing zone and name | Owner/private \`TF_VAR_*\` |
| \`alias_address\` | single literal recipient in that zone | private; no catch-all |
| \`destination_address\` | Owner's personal Gmail | private; sensitive value also appears in plan/state |
| \`verified_destination_id\` | actual **already verified** account address ID from Addresses GET; required for rule stage | Owner/private, never fabricated |
| \`rule_priority\` | integer after reading ALL rules/priority/source/catch-all | Owner-selected, no guessed default |
| \`manage_dns\`, \`manage_destination\`, \`manage_rule\` | opt-in booleans, all default false | based on observed delta and separate approval |
| \`preflight_approved\` | boolean, defaults false | plan guard only; **not** User effect GO |
| \`CLOUDFLARE_API_TOKEN\` | Cloudflare API bearer credential | envs/Owner native effect boundary; required operation×account/zone, never public/app/CI |
| \`AWS_ACCESS_KEY_ID\`, \`AWS_SECRET_ACCESS_KEY\` | R2/S3 state backend credential (not mail Hot) | private state Owner/environment |
| \`AWS_ENDPOINT_URL_S3\` | account-specific R2 endpoint | private backend operation environment |
| \`TF_ENCRYPTION\` | native state/plan encryption configuration | Owner private key custody; never logs/PR |
| backend \`bucket\`, \`key\`, \`endpoints\` | one identity-controlled state and lockfile | private S3 backend config, one state Owner |

The existing envs \`CLOUDFLARE_API_TOKEN\` **declaration** or rent/Jev handoff is not proof of mail Account Addresses/Zone Settings/Rules authorization. Do not create a new per-consumer secret. Required permission is the **observed missing operation** (Addresses Write on account; Settings/Rules Write on zone) only. A successful GET does not prove Write; 403 may have multiple causes. Existing IAM/owner and one exact state owner must be proven before plan.

## Required read-only preflight / branch selection

1. Owner privately supplies account/zone/domain/alias and destination. Inspect Cloudflare authoritative NS and **all** MX/SPF/DKIM/DMARC and existing mail providers; conflict means STOP, no automatic enable.
2. List account destination IDs, \`verified\`, cross-zone consumers; reuse an existing verified Gmail read-only. Inspect **all rules** including order, matcher, action, \`source=wrangler\`, catch-all. Do not import or overwrite a shared/Worker-managed rule.
3. Find the **sole existing state owner**: A existing OpenTofu root, B explicit new isolated ops root only if no owner, C Owner Dashboard-first under explicit authorization followed by **separately authorized** API read/import into A/B. GUI success does not establish state/source convergence.
4. Fix protected private plan/state backend, lock, source/head/provider identity and \`TF_ENCRYPTION\`; fixed R must have an independently usable **private read-only path to Cloudflare/Gmail/state evidence before effects**. Missing target, scope, state owner, R access or GO means STOP/UNKNOWN.
5. Derive \`Q_effect(C,O)\` from known differences only. Existing complete configuration requires zero Write, destination verified requires zero Addresses Write, and a missing rule alone may require only zone Rules Write. **Never take unknown as an empty delta**.

## Owner-only native invocation after separate GO

The exact source root must be copied to an approved **private directory** (\`$PRIVATE_MAIL_ROOT\`, not a Git working tree); provide inputs through controlled private \`TF_VAR_*\`/var-file values and state information through a private backend config. No actual mailbox/token/backend secret in tracked source, PR, command-line arguments, publicly uploaded plan, output, or CI.

    TOOL="$(nix build --no-link --print-out-paths .#packages.x86_64-linux.mail-routing-tofu)/bin/tofu"
    "$TOOL" -chdir="$PRIVATE_MAIL_ROOT" fmt -check
    "$TOOL" -chdir="$PRIVATE_MAIL_ROOT" init -input=false -lockfile=readonly -backend-config="$PRIVATE_BACKEND_FILE"
    "$TOOL" -chdir="$PRIVATE_MAIL_ROOT" validate
    "$TOOL" -chdir="$PRIVATE_MAIL_ROOT" plan -input=false -lock=true -out="$PRIVATE_ENCRYPTED_PLAN"

These are **operator examples, not commands to execute without authorization**. Even \`tofu plan\` can access/lock private state and contact Cloudflare; separate state owner and provider access approval must precede it. Do not print a private plan/state. A change in source/target/GO after preflight requires readback and re-approval of the affected scope. Reconciliation of UNKNOWN/partial effect is **read-only first**, never blind replay.

If adopting an **existing API-owned object** into the single approved state, first independently identify the exact resource and get an explicit Owner import/lock GO. The count resources have index \`[0]\`:

    tofu import 'cloudflare_email_routing_dns.zone[0]' '<zone_id>'
    tofu import 'cloudflare_email_routing_address.gmail[0]' '<account_id>/<address_id>'
    tofu import 'cloudflare_email_routing_rule.literal[0]' '<zone_id>/<rule_id>'

Each import uses the same authenticated native executable, private backend/encryption and reviewed source. Shared account Gmail address is normally **referenced** via \`data.cloudflare_email_routing_address.checked\`, not imported/owned or deleted.

## Mandatory stages (3 flags cannot bypass verification)

| Stage | Managed flags / state | Next-stage requirement |
|---|---|---|
| 0 read-only | all false for a new state; existing owned flags remain true | review DNS/zone MX, rules, account destinations, state identity, auth/Owner GO |
| 1 destination | set \`manage_destination=true\` **only for an approved NEW account address** | Cloudflare creates it → Gmail Owner explicitly clicks verification email → fresh GET yields exact ID/email and non-null \`verified\` |
| 2 DNS | \`manage_dns=true\` only for an approved missing zone-routing DNS | MX/SPF/DKIM/DMARC safe and Owner Settings Write GO → fresh GET shows Email Routing \`enabled=true,status=ready\` |
| 3 rule | \`manage_rule=true\` only after stages 1/2 are satisfied; set real \`verified_destination_id\` | rule's **native data sources** read verified account destination and ready zone; source preconditions fail closed otherwise |
| 4 proof | preserve all managed flags | re-plan expected no-op, zone/rule readback, one distinct sender mail + Cloudflare routing Activity Log + Gmail headers, fixed R independent private readback |

**Crucial \`count\` invariant:** once a new destination or zone DNS resource is owned by this state (\`manage_destination=true\`, \`manage_dns=true\`), **retain its flag=true** in later stages. Setting a previously managed count to zero plans destruction; \`prevent_destroy\` blocks it. Existing shared destinations remain unowned (\`manage_destination=false\`) throughout. A simultaneous three-flag initial apply with an unverified destination/disabled zone is **not valid**: the independent live datasource preconditions on the rule refuse creation. \`depends_on\` alone cannot replace asynchronous Gmail human verification.

The rule guard only proves selected destination/zone readiness. It does not prove external routing precedence, existing MX safety, GO, mail delivery or the absence of a different Owner; all those are checked independently. NEVER retry a timed-out DNS/Rule API call without a fresh same-resource readback. Unknown/failed/invalid cases remain STOP/UNKNOWN, with residual and stage-specific resume recorded in existing evidence references—no new ledger.

## Verification boundary

**Source** (credential-independent): native \`fmt\`, \`init -backend=false -lockfile=readonly\`, \`validate\`, mocked \`tofu test\`; no fake PASS without actual CI. Negative cases: default manages none; unverified Gmail; all three flags true at initial unverified/unready state; DNS unready; mismatched Gmail; preflight false. Positive: verified existing Gmail and ready DNS permit exactly one rule without recreating shared address or zone DNS.

**Live**: M0 stays **NOT_RUN/NOT_PROVEN** until the real zone-specific origin mail is sent from a different account exactly once, Cloudflare \`Forwarded\` Activity Log is joined with the matching Gmail headers/recipient and state/zone safe no-op readback, and fixed R can read independently obtained private originals. No Gmail API, R2 mail Hot, custom Worker or second test service.

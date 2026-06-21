def fail($id; $message):
  {id: $id, status: "FAIL", message: $message};

def pass($id; $message):
  {id: $id, status: "PASS", message: $message};

def bool_false($v): ($v == false or $v == null);
def contains_all($arr; $required):
  all($required[]; . as $x | ($arr // []) | index($x));

def validate_record($r):
  [
    if ($r.schema == "gen1.operationSurface.input.v1")
    then pass("schema"; "expected schema")
    else fail("schema"; "schema must be gen1.operationSurface.input.v1")
    end,

    if ($r.source.repo == "adrs.git" and $r.source.head == "b1394e4fd6af9c2305fc27deabc554d6c391b8e2")
    then pass("law-seed-head"; "ADRS law seed head is pinned")
    else fail("law-seed-head"; "ADRS law seed head must be b1394e4fd6af9c2305fc27deabc554d6c391b8e2")
    end,

    if ($r.operation.orchestratedBy == "gen1-codex")
    then pass("orchestrated-by-gen1-codex"; "operation is orchestrated by Gen1 Codex")
    else fail("orchestrated-by-gen1-codex"; "operation must be orchestrated by Gen1 Codex")
    end,

    if (($r.operation.gen2Actor // null) == null and (($r.operation.assignedActor // "") | test("(?i)^(chatgpt|codex|call-js|browser)$") | not))
    then pass("no-surface-as-actor"; "operation surface is not assigned as Gen2 actor")
    else fail("no-surface-as-actor"; "ChatGPT/Codex/call-js/browser must not be assigned as Gen2 actor")
    end,

    if (($r.operation.surface // "") | test("^(chatgpt|codex|browser|repo-validation)$"))
    then pass("surface-known"; "operation surface is known")
    else fail("surface-known"; "operation surface must be chatgpt, codex, browser, or repo-validation")
    end,

    if ($r.operation.surface == "chatgpt" and $r.operation.kind == "github-operation")
    then
      if ($r.operation.mode == "extra_high")
      then pass("chatgpt-github-mode"; "ChatGPT GitHub operation uses extra_high")
      else fail("chatgpt-github-mode"; "ChatGPT GitHub operation must use extra_high")
      end
    else pass("chatgpt-github-mode"; "not a ChatGPT GitHub operation")
    end,

    if ($r.operation.surface == "chatgpt" and $r.operation.kind == "non-github-review")
    then
      if ($r.operation.mode == "pro_extended")
      then pass("chatgpt-non-github-mode"; "ChatGPT non-GitHub review uses pro_extended")
      else fail("chatgpt-non-github-mode"; "ChatGPT non-GitHub review must use pro_extended")
      end
    else pass("chatgpt-non-github-mode"; "not a ChatGPT non-GitHub review")
    end,

    if (($r.transport.callJs.role // "transport") == "transport" and bool_false($r.transport.callJs.authority))
    then pass("call-js-transport-only"; "call-js is transport only")
    else fail("call-js-transport-only"; "call-js must be transport only and non-authority")
    end,

    if (($r.transport.githubRefsMirror.role // "transport-mirror") == "transport-mirror")
    then pass("github-mirror-transport"; "GitHub refs mirror is transport only")
    else fail("github-mirror-transport"; "GitHub refs mirror must not be SSOT")
    end,

    if contains_all($r.authority.ssot; ["adrs.git", "ops.git"]) and (($r.authority.ssot // []) | all(. == "adrs.git" or . == "ops.git"))
    then pass("ssot-whitelist"; "SSOT is limited to adrs.git and ops.git")
    else fail("ssot-whitelist"; "SSOT must be limited to adrs.git and ops.git")
    end,

    if bool_false($r.authority.policyGitHardcodedLaw)
    then pass("no-policy-git-hardcoded-law"; "no policy.git law authority write detected")
    else fail("no-policy-git-hardcoded-law"; "policy.git hardcoded law write is forbidden")
    end,

    if bool_false($r.authority.validationImpliesApproval)
    then pass("validation-not-approval"; "validation PASS is not approval")
    else fail("validation-not-approval"; "validation PASS must not imply approval")
    end,

    if ([
      $r.approvalState.policyDeletionApproved,
      $r.approvalState.policyRetirementApproved,
      $r.approvalState.cutoverReady,
      $r.approvalState.canonicalWriteApproved,
      $r.approvalState.ssotAdoptionApproved
    ] | all(bool_false(.)))
    then pass("no-approval-granted"; "no deletion/cutover/canonical approval granted")
    else fail("no-approval-granted"; "approval flags must remain false")
    end
  ];

def summarize($checks):
  {
    pass: ($checks | map(select(.status == "PASS")) | length),
    fail: ($checks | map(select(.status == "FAIL")) | length)
  };

(. // []) as $records
| ($records | map(validate_record(.)) | add) as $checks
| (summarize($checks)) as $summary
| {
    schema: "gen1.operationSurface.report.v1",
    ok: ($summary.fail == 0),
    sourceHead: "b1394e4fd6af9c2305fc27deabc554d6c391b8e2",
    summary: $summary,
    checks: $checks,
    completion: {
      gen1ScopeComplete: ($summary.fail == 0),
      approvalGranted: false,
      deletionApproved: false,
      canonicalMergeApproved: false
    }
  }

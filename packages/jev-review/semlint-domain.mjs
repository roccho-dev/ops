// Opt-in caller composition for the adopted P29 complementary target-domain criteria (input/result v5).
// Pure: no I/O, fetch, key, provider call or entry. Core evaluates the constructed criteria unchanged;
// this module never rewrites natural language beyond the fixed adopted child predicates below.
import { createHash } from 'node:crypto';
import { JEV_MODEL } from './core.mjs';
import { semlint } from './semlint.mjs';
import { digest, snapshotJson } from './semlint-entry.mjs';

const hash = (x) => createHash('sha256').update(x, 'utf8').digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = () => { throw new Error('INVALID_DOMAIN_INPUT'); };
const exact = (x, keys) => x !== null && typeof x === 'object' && !Array.isArray(x)
  && Object.keys(x).length === keys.length && keys.every((k) => Object.hasOwn(x, k));
const freeze = (x) => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
export const DOMAIN_THRESHOLDS = Object.freeze([0.5, 0.65, 0.8]);
const CEILING = 'BOUNDED_EVIDENCE_NOT_SEMANTIC_TRUTH_OR_AUTHORITY';

// E = qualifying targets declaring expected behavior (implicit/proposed included); A_MINUS_E = the other
// qualifying assertions, not "executed-only". Appended unchanged to every child question.
const COMMON = "For this child criterion, E means an original qualifying semantic assertion or rule that declares expected behavior, including implicit or proposed normative, completion, or success rules. E is restricted to the original criterion's expected-rule membership; a prediction, tense, or governing-context statement alone does not create a new evaluation target or establish a violation. Membership applies to that qualifying assertion or rule, not to a containing paragraph or another claim. A\\E means an original qualifying assertion that is not itself E. It is not limited to executed operations or past-tense reports: an unperformed proposal is excluded from A\\E only if its own qualifying assertion is E. In this child, every reference to a scoped claim, such assertion or expected rule, that same claim, or such contradiction refers only to an eligible target in this child domain. All conditions must concern that same eligible target. Apply the original scope, applicable context, grants, exceptions, authorized updates, corrections and current-versus-historical standing without change.";

// The nine adopted original criteria. Six stay literal identities; three split into A_MINUS_E then E,
// changing only the question target phrase and the native targetAssertion; every other field is original.
export const DOMAIN_CRITERIA = freeze([
  {
    "axis": "Aligned",
    "concern": "The scoped declaration assigns accepted meaning or effect authority beyond its supplied declared contract. Separately granted external effects and legitimate local-only completion are preserved.",
    "requiredRoles": [
      "authorityContract"
    ],
    "crossLinks": [],
    "predicate": {
      "question": "Does `subject.content` assign accepted-meaning or effect authority beyond the grants in the supplied `context`?",
      "true": "The scoped declaration assigns authority beyond the supplied declared grants.",
      "false": "The scoped declaration does not exceed those grants; separately granted external effects and legitimate local-only completion remain legitimate."
    }
  },
  {
    "axis": "Measurable",
    "concern": "The scoped verification or completion claim credits success despite absent required observation or observed failure. Exact identifiers alone do not replace the declared required verification.",
    "requiredRoles": [
      "accountingContract",
      "registeredCases"
    ],
    "crossLinks": [],
    "predicate": {
      "question": "Does any verification or completion assertion or expected rule within the declared scope in `subject.content` contradict a prerequisite in the applicable supplied `context` by making success valid when a required observation is absent or failed?",
      "true": {
        "targetAssertion": "A verification or completion assertion or expected rule within the declared subject scope.",
        "applicableRequirement": "An observation required for that same success claim by the applicable supplied context. Exact identifiers alone do not replace required verification.",
        "outcomeCondition": "At least one such assertion or expected rule makes success valid despite that required observation being absent or failed. Unrelated compliant assertions do not cancel this contradiction.",
        "legitimateExceptions": "Applicable grants, exceptions and authorized updates remain legitimate; quoted, superseded or historical statements outside the declared evaluation target are not current claims."
      },
      "false": {
        "targetAssertion": "A verification or completion assertion or expected rule within the declared subject scope.",
        "applicableRequirement": "An observation required for that same success claim by the applicable supplied context. Exact identifiers alone do not replace required verification.",
        "outcomeCondition": "No such scoped contradiction is asserted: required observations support valid success credit or unsupported success is withheld.",
        "legitimateExceptions": "Applicable grants, exceptions and authorized updates remain legitimate; quoted, superseded or historical statements outside the declared evaluation target are not current claims."
      }
    },
    "split": {
      "A_MINUS_E": {
        "question": "Does any verification or completion assertion within the declared scope in `subject.content` that is not itself an expected-rule target, belonging to A\\E as defined below, contradict a prerequisite in the applicable supplied `context` by making success valid when a required observation is absent or failed?",
        "targetAssertion": "A verification or completion assertion within the declared subject scope that is not itself an expected-rule target, belonging to A\\E as defined in this criterion."
      },
      "E": {
        "question": "Does any verification or completion expected-rule target within the declared scope in `subject.content`, belonging to E as defined below, contradict a prerequisite in the applicable supplied `context` by making success valid when a required observation is absent or failed?",
        "targetAssertion": "A verification or completion expected-rule target within the declared subject scope, belonging to E as defined in this criterion."
      }
    }
  },
  {
    "axis": "Measurable",
    "concern": "The expected receipt-completion value credits unavailable or blocked required observations as complete. Reporting those observations as blocked and the receipt incomplete is legitimate.",
    "requiredRoles": [
      "accountingContract",
      "registeredCases"
    ],
    "crossLinks": [],
    "predicate": {
      "question": "Does `subject.content` declare or expect receipt completion for a situation where a required observation is unavailable or blocked under the supplied `context`?",
      "true": "The declared expected receipt-completion value is complete despite an unavailable or blocked observation required by the supplied context. Judge the declared expectation, not whether runtime execution emitted it.",
      "false": "The declared expectation does not credit unavailable or blocked required observations as complete; reporting blocked observations and an incomplete receipt remains legitimate."
    }
  },
  {
    "axis": "Unique",
    "concern": "The new Semantic Graph description assigns it the accepted semantic-delta source responsibility assigned to events.jsonl, instead of the derived current-meaning role. Different names for that same derived view do not alone make a second source.",
    "requiredRoles": [
      "responsibilityContract"
    ],
    "crossLinks": [],
    "predicate": {
      "question": "Does `subject.content` assign to the Semantic Graph the accepted semantic-delta source responsibility reserved for events.jsonl in the supplied `context`?",
      "true": "The Graph is assigned that accepted semantic-delta source responsibility instead of its derived current-meaning role.",
      "false": "That reserved source responsibility is not assigned to the Graph; its derived current-meaning role is preserved, including different names for the same derived view."
    }
  },
  {
    "axis": "Measurable",
    "concern": "The semantic-quality status credits mechanical or synthetic test observations as semantic success while the declared required real evaluation remains unperformed. Mechanical success reported only as mechanical evidence is legitimate.",
    "requiredRoles": [
      "accountingContract",
      "registeredCases"
    ],
    "crossLinks": [],
    "predicate": {
      "question": "Does any semantic-success assertion or expected rule within the declared scope in `subject.content` treat mechanical or synthetic observations as sufficient despite a real evaluation required for that claim remaining unperformed under the applicable supplied `context`?",
      "true": {
        "targetAssertion": "A semantic-success assertion or expected rule within the declared subject scope.",
        "applicableRequirement": "For a scoped claim relying on mechanical or synthetic observations, a real evaluation required for that same claim by the applicable supplied context remains required.",
        "outcomeCondition": "At least one such assertion or expected rule gives semantic-success credit to mechanical or synthetic observations while that required real evaluation remains unperformed. This is the declared evidence-class upgrade, not a requirement to prove hidden author intent or an executed bad operation; unrelated compliant assertions do not cancel it.",
        "legitimateExceptions": "Applicable grants, exceptions and authorized updates remain legitimate; quoted, superseded or historical statements outside the declared evaluation target are not current claims."
      },
      "false": {
        "targetAssertion": "A semantic-success assertion or expected rule within the declared subject scope.",
        "applicableRequirement": "For a scoped claim relying on mechanical or synthetic observations, a real evaluation required for that same claim by the applicable supplied context remains required.",
        "outcomeCondition": "No such evidence-class upgrade is asserted: required real evidence supports semantic-success credit, or mechanical and synthetic observations remain mechanical evidence with unsupported semantic success withheld.",
        "legitimateExceptions": "Applicable grants, exceptions and authorized updates remain legitimate; quoted, superseded or historical statements outside the declared evaluation target are not current claims."
      }
    },
    "split": {
      "A_MINUS_E": {
        "question": "Does any semantic-success assertion within the declared scope in `subject.content` that is not itself an expected-rule target, belonging to A\\E as defined below, treat mechanical or synthetic observations as sufficient despite a real evaluation required for that claim remaining unperformed under the applicable supplied `context`?",
        "targetAssertion": "A semantic-success assertion within the declared subject scope that is not itself an expected-rule target, belonging to A\\E as defined in this criterion."
      },
      "E": {
        "question": "Does any semantic-success expected-rule target within the declared scope in `subject.content`, belonging to E as defined below, treat mechanical or synthetic observations as sufficient despite a real evaluation required for that claim remaining unperformed under the applicable supplied `context`?",
        "targetAssertion": "A semantic-success expected-rule target within the declared subject scope, belonging to E as defined in this criterion."
      }
    }
  },
  {
    "axis": "Closed",
    "concern": "The proposed completion clause treats a delivery receipt as sufficient proof of recipient turn, self-read, work and next-observation completion. Separate required observations and honest delivery-only grade remain legitimate.",
    "requiredRoles": [
      "completionContract"
    ],
    "crossLinks": [
      "Measurable"
    ],
    "predicate": {
      "question": "Does any completion assertion or expected rule within the declared scope in `subject.content` contradict the applicable supplied `context` by making delivery alone sufficient for required recipient turn, self-read, work and next-observation completion?",
      "true": {
        "targetAssertion": "A completion assertion or expected rule within the declared subject scope.",
        "applicableRequirement": "The recipient turn, self-read, work and next-observation completion required by the applicable supplied context.",
        "outcomeCondition": "At least one such assertion or expected rule makes a delivery receipt alone sufficient for that required completion. Assess proposed contract consistency or reported completion credit without requiring an executed bad operation; unrelated compliant assertions do not cancel the contradiction.",
        "legitimateExceptions": "Applicable grants, exceptions and authorized updates remain legitimate; quoted, superseded or historical statements outside the declared evaluation target are not current claims. Absence of an autonomous-wake claim alone does not establish recipient completion."
      },
      "false": {
        "targetAssertion": "A completion assertion or expected rule within the declared subject scope.",
        "applicableRequirement": "The recipient turn, self-read, work and next-observation completion required by the applicable supplied context.",
        "outcomeCondition": "No such receipt-only completion sufficiency is asserted: the supplied required recipient observations remain required or completion credit honestly remains delivery-only.",
        "legitimateExceptions": "Applicable grants, exceptions and authorized updates remain legitimate; quoted, superseded or historical statements outside the declared evaluation target are not current claims. Absence of an autonomous-wake claim alone does not establish recipient completion."
      }
    },
    "split": {
      "A_MINUS_E": {
        "question": "Does any completion assertion within the declared scope in `subject.content` that is not itself an expected-rule target, belonging to A\\E as defined below, contradict the applicable supplied `context` by making delivery alone sufficient for required recipient turn, self-read, work and next-observation completion?",
        "targetAssertion": "A completion assertion within the declared subject scope that is not itself an expected-rule target, belonging to A\\E as defined in this criterion."
      },
      "E": {
        "question": "Does any completion expected-rule target within the declared scope in `subject.content`, belonging to E as defined below, contradict the applicable supplied `context` by making delivery alone sufficient for required recipient turn, self-read, work and next-observation completion?",
        "targetAssertion": "A completion expected-rule target within the declared subject scope, belonging to E as defined in this criterion."
      }
    }
  },
  {
    "axis": "Unique",
    "concern": "The scoped declaration introduces incompatible ownership between the source-evidence lane and model-intent lane. A derived display alias preserving the original lane and authority boundary is legitimate.",
    "requiredRoles": [
      "responsibilityContract"
    ],
    "crossLinks": [],
    "predicate": {
      "question": "Does `subject.content` introduce ownership incompatible with the declared source-evidence and model-intent lane boundaries in the supplied `context`?",
      "true": "The declared ownership assignment conflicts with the supplied lane boundaries, including treating source-evidence rows as model-change intent contrary to those boundaries.",
      "false": "The ownership assignment preserves the supplied lane boundaries; a derived display alias with the same original lane and authority is legitimate. Judge declared assignment, not whether a physical queue operation occurred."
    }
  },
  {
    "axis": "Unique",
    "concern": "The scoped declaration promotes a disposable derived read model to an independent accepted-meaning authority alongside the original canonical source. A derived alias or view preserving the original sole authority is legitimate.",
    "requiredRoles": [
      "responsibilityContract"
    ],
    "crossLinks": [],
    "predicate": {
      "question": "Does `subject.content` make a disposable derived read model an independent accepted-meaning authority alongside the original canonical source under the supplied `context`?",
      "true": "The scoped declaration promotes the disposable derived model to that second independent accepted-meaning authority.",
      "false": "The original sole accepted-meaning authority is preserved; a derived alias or view without independent authority is legitimate."
    }
  },
  {
    "axis": "Closed",
    "concern": "The scoped declaration credits actor work or terminal handoff completion without the required worker observations and completion approval. A generated input or transport-valid delivery alone is not actor-work completion.",
    "requiredRoles": [
      "completionContract"
    ],
    "crossLinks": [],
    "predicate": {
      "question": "Does `subject.content` credit actor work or terminal handoff completion when any required worker observation or required completion approval is absent under the supplied `context`?",
      "true": "Completion is credited while at least one required worker observation or required approval is absent.",
      "false": "The scoped declaration gives no such unsupported completion credit; required observations and approval support credited completion or completion is honestly withheld. Generated input or transport-valid delivery alone is not actor-work completion."
    }
  }
]);

const parentKey = (m) => JSON.stringify([m.axis, m.concern, m.requiredRoles, m.crossLinks, m.predicate]);
const BY_PARENT = new Map(DOMAIN_CRITERIA.map((m) => [parentKey(m), m]));
const childPredicate = (original, child) => ({ question: child.question + '\n\n' + COMMON,
  true: { ...original.true, targetAssertion: child.targetAssertion },
  false: { ...original.false, targetAssertion: child.targetAssertion } });

const assemblies = new WeakSet();
const syntheticAnswers = async (_, questions) => ({ model: JEV_MODEL,
  answers: Object.fromEntries(Object.keys(questions).map((key) => [key, { type: 'noul', noul: 0.5 }])) });

// Builds the exact v5 input to send and its native binding from Core itself (synthetic answers, no provider).
export async function constructDomainInput(value) {
  let original;
  try { original = snapshotJson(value); } catch { fail(); }
  if (!exact(original, ['schema', 'subject', 'context', 'checks']) || original.schema !== 'ops.semlint.input.v5'
    || !Array.isArray(original.checks) || !original.checks.length) fail();
  const groups = [], checks = [];
  for (const parent of original.checks) {
    if (!exact(parent, ['id', 'axis', 'concern', 'requiredRoles', 'crossLinks', 'predicate'])) fail();
    const meaning = BY_PARENT.get(parentKey(parent));
    if (!meaning) fail(); // unknown criteria are refused, never passed through
    const children = meaning.split
      ? Object.entries(meaning.split).map(([domain, child]) => ({ domain, check: { ...parent,
        id: 'p29-' + hash(parent.id) + '-' + domain, predicate: childPredicate(meaning.predicate, child) } }))
      : [{ domain: 'IDENTITY', check: parent }];
    groups.push({ parentId: parent.id, axis: parent.axis, domains: children.map((c) => c.domain), childRules: children.map((c) => c.check.id) });
    checks.push(...children.map((c) => c.check));
  }
  if (new Set(checks.map((c) => c.id)).size !== checks.length) fail();
  const input = { schema: original.schema, subject: original.subject, context: original.context, checks };
  let preview;
  try { preview = await semlint(input, syntheticAnswers); } catch { fail(); }
  const n = checks.length;
  if (!same(preview.counts, { selected: n, sendable: n, evaluated: n, missing: 0 })) fail();
  const binding = { schema: preview.schema, inputDigest: preview.inputDigest, questionDigest: preview.questionDigest,
    projection: preview.projection, counts: preview.counts, records: preview.records.map(({ noul, ...record }) => record) };
  const assembly = freeze({ input, groups, binding });
  assemblies.add(assembly);
  return assembly;
}

const validUsage = (u) => exact(u, Object.keys(u ?? {})) && Object.keys(u).every((k) => ['input_tokens', 'output_tokens', 'total_tokens'].includes(k))
  && ['input_tokens', 'output_tokens'].every((k) => Number.isSafeInteger(u[k]) && u[k] >= 0)
  && (!Object.hasOwn(u, 'total_tokens') || u.total_tokens === u.input_tokens + u.output_tokens);

// Parent decision = all required native children valid, then OR of child scores >= tau (not probability OR).
// Any missing/unknown/extra/invalid child makes the case INVALID with no parent verdict (never FALSE/TN).
export function foldDomainParents(assembly, value, tau) {
  const invalid = (cause) => ({ status: 'INVALID', cause, threshold: tau, parents: null });
  if (!assemblies.has(assembly) || !DOMAIN_THRESHOLDS.includes(tau)) return invalid('UNTRUSTED_ASSEMBLY_OR_THRESHOLD');
  let r;
  try { r = snapshotJson(value); } catch { return invalid('INVALID_RESULT_SHAPE'); }
  const b = assembly.binding;
  if (!exact(r, ['schema', 'inputDigest', 'questionDigest', 'projection', 'records', 'counts', 'accounting', 'claimCeiling'])
    || r.schema !== b.schema || r.inputDigest !== b.inputDigest || r.questionDigest !== b.questionDigest
    || !same(r.projection, b.projection) || !same(r.counts, b.counts) || r.claimCeiling !== CEILING
    || !Array.isArray(r.records) || r.records.length !== b.records.length) return invalid('RESULT_IDENTITY_OR_MEMBERSHIP');
  const a = r.accounting;
  if (!exact(a, ['callbackAttempts', 'validatedCalls', 'usage', 'elapsedMs', 'providerHttpCalls', 'cost'])
    || a.callbackAttempts !== 1 || a.validatedCalls !== 1 || a.providerHttpCalls !== null || a.cost !== null
    || !Number.isFinite(a.elapsedMs) || a.elapsedMs < 0 || !validUsage(a.usage)) return invalid('INVALID_ACCOUNTING');
  for (let i = 0; i < r.records.length; i++) {
    const { noul, ...metadata } = r.records[i] ?? {};
    if (!exact(r.records[i], [...Object.keys(b.records[i]), 'noul']) || !same(metadata, b.records[i])) return invalid('RECORD_IDENTITY_OR_ORDER');
    if (metadata.status !== 'OBSERVED' || metadata.cause !== null || !Number.isFinite(noul) || noul < 0 || noul > 1) return invalid('INVALID_REQUIRED_CHILD');
  }
  const score = new Map(r.records.map((x) => [x.rule, x.noul]));
  return { status: 'VALID', threshold: tau, parents: assembly.groups.map((g) => ({ ...g,
    childScores: g.childRules.map((id) => score.get(id)), decision: g.childRules.some((id) => score.get(id) >= tau) })) };
}

// The exact public plan for the existing owner entry.
export function domainPlan(cases) {
  if (!Array.isArray(cases) || !cases.length || cases.some((c) => !exact(c, ['id', 'assembly']) || !assemblies.has(c.assembly))) fail();
  return { schema: 'ops.semlint.real-input.v1', cases: cases.map((c) => ({ id: c.id, input: c.assembly.input })) };
}

const PROVIDER_KEYS = ['attemptedHttpCalls', 'completedHttpCalls', 'validatedResponses', 'statusClass',
  'validatedModel', 'usage', 'elapsedMs', 'responseDigest'];
// Quality grading requires the v3 receipt: registered case-outer clock plus one validated native call per case.
export function foldDomainOutput(cases, value, tau) {
  const plan = domainPlan(cases);
  let out;
  try { out = snapshotJson(value); } catch { return { status: 'INVALID', cause: 'INVALID_OUTPUT_SHAPE', cases: null }; }
  if (!exact(out, ['schema', 'model', 'planDigest', 'cases', 'accounting', 'claimCeiling'])
    || out.schema !== 'ops.semlint.real-result.v3' || out.model !== JEV_MODEL || out.planDigest !== digest(plan)
    || out.claimCeiling !== CEILING || !Array.isArray(out.cases) || out.cases.length !== cases.length) {
    return { status: 'INVALID', cause: out?.schema === 'ops.semlint.real-result.v2' ? 'CASE_OUTER_REQUIRED' : 'OUTPUT_IDENTITY', cases: null };
  }
  const graded = out.cases.map((row, i) => {
    const p = row?.provider, bad = (cause) => ({ id: cases[i].id, status: 'INVALID', cause, parents: null });
    if (!exact(row, ['id', 'result', 'provider', 'elapsedMs']) || row.id !== cases[i].id
      || !Number.isFinite(row.elapsedMs) || row.elapsedMs < 0) return bad('CASE_OUTER_OR_IDENTITY');
    if (!exact(p, PROVIDER_KEYS) || p.attemptedHttpCalls !== 1 || p.completedHttpCalls !== 1 || p.validatedResponses !== 1
      || p.statusClass !== 'VALIDATED_RESPONSE' || p.validatedModel !== JEV_MODEL || !Number.isFinite(p.elapsedMs)) return bad('NATIVE_RECEIPT');
    const folded = foldDomainParents(cases[i].assembly, row.result, tau);
    if (folded.status !== 'VALID') return { id: row.id, ...folded };
    return { id: row.id, ...folded, caseOuterMs: row.elapsedMs, coreInnerMs: row.result.accounting.elapsedMs,
      providerElapsedMs: p.elapsedMs, usage: row.result.accounting.usage };
  });
  return { status: graded.every((x) => x.status === 'VALID') ? 'VALID' : 'INVALID', threshold: tau, cases: graded };
}

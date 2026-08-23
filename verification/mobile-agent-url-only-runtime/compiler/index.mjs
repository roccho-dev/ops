import {
  assertBusinessModelProjectionCoverage,
  compileBusinessModelPresentationPlan,
  createBusinessModelProjectionCoverage,
  parseBusinessModelSemanticJsonl,
  projectProfiledBusinessModelA2uiSequence,
  projectProfiledBusinessModelMapState,
  projectProfiledBusinessModelSeqState,
  validateProfiledBusinessModelSequence,
} from "./packages/business-model-compiler/src/index.mjs";
import { derivePublicBusinessModelProjectionProfile } from "./packages/business-model-compiler/src/public-profile.mjs";
import {
  canonicalJson,
  createUrlModuleUrl,
  decodeUrlModule,
  readUrlModuleToken,
  sha256Hex,
} from "./packages/url-module/src/index.mjs";

export const DEFAULT_BUSINESS_MODEL_BASE = "https://stg-mobile-agent.pages.dev/business-model/";
export const BUSINESS_MODEL_URL_LIMIT = 8192;

export const compilePublicBusinessModelUrl = async (
  semanticText,
  { base = DEFAULT_BUSINESS_MODEL_BASE, limitChars = BUSINESS_MODEL_URL_LIMIT } = {},
) => {
  if (typeof semanticText !== "string" || semanticText.trim() === "") {
    throw new Error("business-model/1: semantic JSONL must be non-empty text");
  }
  const model = parseBusinessModelSemanticJsonl(semanticText);
  if (model.actors.length < 2 || model.actors.length > 4) {
    throw new Error(`business-model/1: actor count must be 2..4, got ${model.actors.length}`);
  }
  const profile = derivePublicBusinessModelProjectionProfile(model);
  const plan = compileBusinessModelPresentationPlan(model, profile);
  const sequence = validateProfiledBusinessModelSequence(projectProfiledBusinessModelA2uiSequence(model, plan));
  const seqState = projectProfiledBusinessModelSeqState(model, plan);
  const mapState = projectProfiledBusinessModelMapState(model, plan);
  const coverage = assertBusinessModelProjectionCoverage(
    createBusinessModelProjectionCoverage({ model, plan, sequence, seqState, mapState }),
  );
  const payload = Object.freeze({
    schema: "business-model-presentation-minimal-payload/1",
    id: model.id,
    label: model.title,
    sequence,
    seqState,
    stageFocus: Object.fromEntries(model.stages.map(stage => [stage.id, stage.focusRef])),
    stageLabels: Object.fromEntries(model.stages.map(stage => [stage.id, stage.name])),
    coverage: Object.freeze({ pass: true, status: coverage.status }),
  });
  const url = await createUrlModuleUrl({ base, fragment: "presentation", value: payload });
  const token = readUrlModuleToken({ fragment: "presentation", input: url });
  const decoded = await decodeUrlModule(token);
  if (canonicalJson(decoded) !== canonicalJson(payload)) {
    throw new Error("business-model/1: generated URL did not round-trip exactly");
  }
  if (url.length > limitChars) {
    throw new Error(`business-model/1: URL exceeds ${limitChars} chars: ${url.length}`);
  }
  return Object.freeze({
    schema: "mobile-agent.business-model-hosted-compile/2",
    status: "PASS",
    pass: true,
    authority: false,
    pattern: "business-model/1",
    actorCount: model.actors.length,
    actorOrder: plan.actors.map(actor => actor.id),
    sourceSha256: await sha256Hex(semanticText),
    payloadSha256: await sha256Hex(canonicalJson(payload)),
    tokenChars: token.length,
    urlChars: url.length,
    limitChars,
    url,
    roundTripExact: true,
    sourceCloneUsed: false,
    sourceBuildUsed: false,
    providerWriteUsed: false,
  });
};

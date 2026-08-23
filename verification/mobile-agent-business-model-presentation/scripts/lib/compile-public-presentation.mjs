import {
  assertBusinessModelProjectionCoverage,
  compileBusinessModelPresentationPlan,
  createBusinessModelProjectionCoverage,
  parseBusinessModelSemanticJsonl,
  projectProfiledBusinessModelA2uiSequence,
  projectProfiledBusinessModelMapState,
  projectProfiledBusinessModelSeqState,
  validateProfiledBusinessModelSequence,
} from "../../packages/business-model-compiler/src/index.mjs";
import { derivePublicBusinessModelProjectionProfile } from "../../packages/business-model-compiler/src/public-profile.mjs";
import { canonicalJson, sha256Hex } from "../../packages/url-module/src/index.mjs";

export const compilePublicBusinessModelPresentation = async (semanticText, { compact = false } = {}) => {
  const model = parseBusinessModelSemanticJsonl(semanticText);
  const profile = derivePublicBusinessModelProjectionProfile(model);
  const plan = compileBusinessModelPresentationPlan(model, profile);
  const sequence = validateProfiledBusinessModelSequence(projectProfiledBusinessModelA2uiSequence(model, plan));
  const seqState = projectProfiledBusinessModelSeqState(model, plan);
  const mapState = projectProfiledBusinessModelMapState(model, plan);
  const coverage = assertBusinessModelProjectionCoverage(
    createBusinessModelProjectionCoverage({ model, plan, sequence, seqState, mapState }),
  );
  const stageFocus = Object.fromEntries(model.stages.map(stage => [stage.id, stage.focusRef]));
  const stageLabels = Object.fromEntries(model.stages.map(stage => [stage.id, stage.name]));
  const sourceSha256 = await sha256Hex(Buffer.from(semanticText, "utf8"));
  const profileSha256 = await sha256Hex(canonicalJson(profile));
  const sequenceSha256 = await sha256Hex(canonicalJson(sequence));
  const seqSha256 = await sha256Hex(canonicalJson(seqState));
  const payload = Object.freeze({
    schema: "business-model-presentation-minimal-payload/1",
    id: model.id,
    label: model.title,
    ...(compact ? {} : { sourceSha256, profileSha256 }),
    sequence,
    seqState,
    stageFocus,
    stageLabels,
    coverage: compact ? Object.freeze({ pass: true, status: coverage.status }) : coverage,
  });
  return Object.freeze({
    model,
    profile,
    plan,
    sequence,
    seqState,
    mapState,
    coverage,
    payload,
    sourceSha256,
    profileSha256,
    sequenceSha256,
    seqSha256,
  });
};

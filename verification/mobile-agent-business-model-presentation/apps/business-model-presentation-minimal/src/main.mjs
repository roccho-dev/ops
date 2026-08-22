import { createIncrementalSurfaceRuntime } from "../../../packages/a2ui-browser/src/incremental-surface.mjs";
import {
  PROFILED_BUSINESS_MODEL_SURFACE_ID,
  createProfiledBusinessModelCatalog,
  validateProfiledBusinessModelSequence,
} from "../../../packages/business-model-compiler/src/index.mjs";
import { decodeUrlModule, readUrlModule } from "../../../packages/url-module/src/index.mjs";

const DEFAULT_PRESENTATION_TOKEN = "__DEFAULT_PRESENTATION_TOKEN__";
const SVG_NS = "http://www.w3.org/2000/svg";

const surface = document.getElementById("surface");
const seqShell = document.getElementById("seq-shell");
const seqBackdrop = document.getElementById("seq-backdrop");
const seqMount = document.getElementById("seq-mount");
const seqOpen = document.getElementById("seq-open");
const seqClose = document.getElementById("seq-close");
const seqCurrent = document.getElementById("seq-current");
const fatal = document.getElementById("fatal");

const invariant = (condition, message) => {
  if (!condition) throw new Error(`business-model-presentation-minimal: ${message}`);
};
const fail = error => {
  fatal.hidden = false;
  fatal.textContent = `BLOCKED · ${error.message}`;
  document.documentElement.dataset.status = "fail";
};
const svgNode = (tag, attributes = {}) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
};
const center = region => ({
  x: region.bounds[0] + region.bounds[2] / 2,
  y: region.bounds[1] + region.bounds[3] / 2,
});
const labelLines = (label, max = 15) => {
  if (label.length <= max) return [label];
  return [label.slice(0, max), label.slice(max, max * 2)];
};

try {
  const url = new URL(location.href);
  const token = url.hash.match(/^#presentation=(.+)$/u)?.[1] ?? null;
  let payload;
  if (token && token !== "embedded") payload = await readUrlModule({ fragment: "presentation", input: location.href });
  else {
    payload = await decodeUrlModule(DEFAULT_PRESENTATION_TOKEN);
    if (!token) {
      try { history.replaceState(null, "", `${url.pathname}${url.search}#presentation=embedded`); } catch (_) {}
    }
  }

  invariant(payload?.schema === "business-model-presentation-minimal-payload/1", "payload schema is invalid");
  invariant(payload.coverage?.pass === true, "projection coverage did not pass");
  const sequence = validateProfiledBusinessModelSequence(payload.sequence);
  invariant(Array.isArray(payload.seqState) && payload.seqState.length > 0, "seq state is missing");
  invariant(payload.stageFocus && typeof payload.stageFocus === "object", "stage focus is missing");
  invariant(payload.stageLabels && typeof payload.stageLabels === "object", "stage labels are missing");

  const catalog = createProfiledBusinessModelCatalog();
  let runtime = null;
  let currentStageIndex = -1;
  let expanded = false;
  let preview = false;

  const stageByFocus = new Map(Object.entries(payload.stageFocus).map(([stageId, focusRef]) => [focusRef, stageId]));
  const stageIndexById = new Map(sequence.stages.map((stage, index) => [stage.id, index]));

  const setShellState = () => {
    seqShell.dataset.preview = String(preview && !expanded);
    seqShell.dataset.expanded = String(expanded);
    seqBackdrop.dataset.open = String(expanded);
    seqBackdrop.setAttribute("aria-hidden", String(!expanded));
    seqOpen.setAttribute("aria-expanded", String(expanded));
    seqClose.hidden = !expanded;
    document.body.classList.toggle("seq-expanded", expanded);
  };

  const closeSeq = ({ focus = false } = {}) => {
    expanded = false;
    preview = false;
    setShellState();
    if (focus) seqOpen.focus();
  };
  const openSeq = () => {
    expanded = true;
    preview = false;
    setShellState();
    queueMicrotask(() => seqClose.focus());
  };

  const appendLabel = (svg, x, y, value, className = "") => {
    const text = svgNode("text", { x, y, "text-anchor": "middle", class: className });
    labelLines(value).forEach((line, index) => {
      const span = svgNode("tspan", { x, dy: index === 0 ? 0 : 14 });
      span.textContent = line;
      text.append(span);
    });
    svg.append(text);
  };

  const renderSeq = () => {
    const records = payload.seqState;
    const regions = records.filter(record => record.type === "region");
    const relations = records.filter(record => record.type === "relation" && record.kind === "next");
    const root = regions.find(region => region.parent === null);
    invariant(root, "seq root region is missing");
    const regionById = new Map(regions.map(region => [region.id, region]));
    const stage = sequence.stages[currentStageIndex];
    const focusRef = payload.stageFocus[stage.id];

    const svg = svgNode("svg", {
      class: "seq-svg",
      viewBox: `0 0 ${root.bounds[2]} ${root.bounds[3]}`,
      preserveAspectRatio: "xMidYMid meet",
      role: "img",
      "aria-label": `${payload.label}の主体別Seq`,
    });
    const defs = svgNode("defs");
    const arrow = svgNode("marker", { id: "seq-arrow", markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: "auto", markerUnits: "strokeWidth" });
    arrow.append(svgNode("path", { d: "M0,0 L8,4 L0,8 z", fill: "#71808b" }));
    const arrowDone = svgNode("marker", { id: "seq-arrow-done", markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: "auto", markerUnits: "strokeWidth" });
    arrowDone.append(svgNode("path", { d: "M0,0 L8,4 L0,8 z", fill: "#2f6848" }));
    defs.append(arrow, arrowDone);
    svg.append(defs);

    for (const actor of regions.filter(region => region.kind === "actor")) {
      const [, y, , height] = actor.bounds;
      svg.append(svgNode("rect", {
        x: 220,
        y,
        width: root.bounds[2] - 240,
        height,
        rx: 8,
        class: "seq-lane-bg",
      }));
    }

    for (const relation of relations) {
      const from = regionById.get(relation.from);
      const to = regionById.get(relation.to);
      if (!from || !to) continue;
      const a = center(from);
      const b = center(to);
      const active = from.id === focusRef || to.id === focusRef;
      const line = svgNode("line", {
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        class: `seq-edge${active ? " active" : ""}`,
      });
      line.dataset.recordId = relation.id;
      svg.append(line);
      appendLabel(svg, (a.x + b.x) / 2, (a.y + b.y) / 2 - 7, relation.label, "seq-edge-label");
    }

    for (const region of regions.filter(item => item.parent !== null)) {
      const [x, y, width, height] = region.bounds;
      const isFocus = region.id === focusRef;
      const isStageNode = stageByFocus.has(region.id);
      const group = svgNode("g", {
        class: `seq-region seq-${region.kind}${isFocus ? " current" : ""}${isStageNode ? " navigable" : ""}`,
        tabindex: isStageNode ? 0 : -1,
        role: isStageNode ? "button" : "group",
        "aria-label": region.label,
      });
      group.dataset.recordId = region.id;
      const rect = svgNode("rect", { x, y, width, height, rx: region.kind === "actor" ? 8 : 4 });
      group.append(rect);
      const text = svgNode("text", { x: x + width / 2, y: y + Math.min(27, height / 2), "text-anchor": "middle" });
      labelLines(region.label, 14).forEach((line, index) => {
        const span = svgNode("tspan", { x: x + width / 2, dy: index === 0 ? 0 : 14 });
        span.textContent = line;
        text.append(span);
      });
      group.append(text);
      if (isFocus) group.append(svgNode("rect", { x: x + 7, y: y + 7, width: 11, height: 11, class: "seq-current-marker" }));
      if (isStageNode) group.dataset.stageId = stageByFocus.get(region.id);
      svg.append(group);
    }

    seqMount.replaceChildren(svg);
    seqCurrent.textContent = payload.stageLabels[stage.id] ?? stage.id;
  };

  const createRuntime = () => {
    surface.replaceChildren();
    runtime = createIncrementalSurfaceRuntime({
      catalog,
      catalogId: sequence.catalogId,
      document,
      eventTarget: window,
      mount: surface,
      requiredRootIds: ["root"],
      rootId: "root",
      surfaceId: PROFILED_BUSINESS_MODEL_SURFACE_ID,
    });
    currentStageIndex = -1;
  };

  const applyStage = (index, { focus = false } = {}) => {
    const stage = sequence.stages[index];
    invariant(stage, `stage is missing: ${index}`);
    if (!runtime || index < currentStageIndex) createRuntime();
    if (index > currentStageIndex) {
      for (let cursor = currentStageIndex + 1; cursor <= index; cursor += 1) {
        runtime.apply(sequence.stages[cursor].messages);
      }
    }
    currentStageIndex = index;
    document.documentElement.dataset.stage = stage.id;
    renderSeq();
    if (focus) queueMicrotask(() => surface.querySelectorAll(".profiled-timeline button")[index]?.focus());
    return runtime.read();
  };

  window.addEventListener("a2ui-client-action", event => {
    if (event.detail?.action !== "business-model-profiled.select-stage") return;
    const index = event.detail.context?.index;
    if (Number.isSafeInteger(index)) applyStage(index, { focus: event.detail.context?.focus === true });
  });

  const canHover = matchMedia("(hover:hover) and (pointer:fine)");
  seqShell.addEventListener("mouseenter", () => {
    if (!canHover.matches || expanded) return;
    preview = true;
    setShellState();
  });
  seqShell.addEventListener("mouseleave", () => {
    if (expanded) return;
    preview = false;
    setShellState();
  });
  const activateSeqTarget = target => {
    const group = target?.closest?.(".seq-region[data-stage-id]");
    if (!group) return false;
    const index = stageIndexById.get(group.dataset.stageId);
    if (!Number.isSafeInteger(index)) return false;
    applyStage(index);
    closeSeq();
    return true;
  };
  seqMount.addEventListener("click", event => { activateSeqTarget(event.target); });
  seqMount.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (!activateSeqTarget(event.target)) return;
    event.preventDefault();
  });

  seqOpen.addEventListener("click", openSeq);
  seqClose.addEventListener("click", () => closeSeq({ focus: true }));
  seqBackdrop.addEventListener("click", () => closeSeq({ focus: true }));
  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && expanded) closeSeq({ focus: true });
  });

  applyStage(0);
  setShellState();
  document.documentElement.dataset.status = "pass";

  globalThis.businessModelPresentation = Object.freeze({
    applyStage,
    openSeq,
    closeSeq,
    read: () => Object.freeze({
      currentStageIndex,
      expanded,
      preview,
      runtime: runtime.read(),
    }),
  });
} catch (error) {
  fail(error);
}

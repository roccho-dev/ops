import { assertExactKeys, assertStringArray, createTrustedCatalog, isPlainObject } from "../../a2ui-browser/src/index.mjs";

export const PROFILED_BUSINESS_MODEL_CATALOG_ID = "urn:roccho:a2ui:catalog:business-model-profiled:1";
export const PROFILED_BUSINESS_MODEL_SURFACE_ID = "business-model-profiled";

const fail = message => { throw new Error(`business-model-profiled-catalog: ${message}`); };
const invariant = (condition, message) => { if (!condition) fail(message); };
const string = (value, name) => { invariant(typeof value === "string" && value.length > 0, `${name} must be a non-empty string`); return value; };
const integer = (value, name) => { invariant(Number.isSafeInteger(value) && value >= 0, `${name} must be a non-negative integer`); return value; };
const state = (value, name) => { invariant(["new", "done", "plain"].includes(value), `${name} is invalid`); return value; };
const classForState = value => value === "new" ? " is-new" : value === "done" ? " is-done" : "";
const element = (document, tag, className, text) => {
  const value = document.createElement(tag);
  if (className) value.className = className;
  if (text !== undefined) value.textContent = text;
  return value;
};
const arrayOfObjects = (value, name, validate) => {
  invariant(Array.isArray(value), `${name} must be an array`);
  return value.map((item, index) => {
    invariant(isPlainObject(item), `${name}[${index}] must be an object`);
    validate(item, `${name}[${index}]`);
    return item;
  });
};
const modelData = dataModel => {
  invariant(isPlainObject(dataModel), "data model must be an object");
  invariant(isPlainObject(dataModel.stage), "dataModel.stage is required");
  invariant(Array.isArray(dataModel.stages), "dataModel.stages is required");
  invariant(Number.isSafeInteger(dataModel.currentIndex), "dataModel.currentIndex is required");
  invariant(isPlainObject(dataModel.actors), "dataModel.actors is required");
  invariant(isPlainObject(dataModel.nodes), "dataModel.nodes is required");
  invariant(isPlainObject(dataModel.exchanges), "dataModel.exchanges is required");
  invariant(isPlainObject(dataModel.activities), "dataModel.activities is required");
  invariant(isPlainObject(dataModel.profile), "dataModel.profile is required");
  return dataModel;
};
const semantic = (node, type, id) => {
  node.dataset.semanticType = type;
  node.dataset.semanticId = id;
  return node;
};

const definitions = [
  {
    name: "ProfiledBusinessModelRoot",
    validate: component => {
      assertExactKeys(component, ["children", "component", "id"], [], "ProfiledBusinessModelRoot");
      assertStringArray(component.children, "ProfiledBusinessModelRoot.children");
      return component;
    },
    render: ({ component, document, renderChild }) => {
      const root = element(document, "main", "profiled-app");
      for (const child of component.children) root.append(renderChild(child));
      return root;
    },
  },
  {
    name: "ProfiledBusinessModelHeader",
    validate: component => {
      assertExactKeys(component, ["component", "id", "kicker", "title"], [], "ProfiledBusinessModelHeader");
      string(component.kicker, "ProfiledBusinessModelHeader.kicker");
      string(component.title, "ProfiledBusinessModelHeader.title");
      return component;
    },
    render: ({ component, dataModel, document }) => {
      const model = modelData(dataModel);
      const header = element(document, "header", "profiled-head");
      const copy = element(document, "div");
      copy.append(element(document, "p", "profiled-kicker", component.kicker));
      copy.append(element(document, "h1", "profiled-title", component.title));
      copy.append(element(document, "p", "profiled-profile", model.profile.label));
      const stage = element(document, "div", "profiled-stage");
      stage.append(element(document, "b", "", model.stage.name));
      stage.append(element(document, "span", "", model.stage.goal));
      header.append(copy, stage);
      return header;
    },
  },
  {
    name: "ProfiledBusinessModelTimeline",
    validate: component => {
      assertExactKeys(component, ["action", "component", "id"], [], "ProfiledBusinessModelTimeline");
      string(component.action, "ProfiledBusinessModelTimeline.action");
      return component;
    },
    render: ({ component, dataModel, document, emitAction }) => {
      const model = modelData(dataModel);
      const nav = element(document, "nav", "profiled-timeline");
      nav.setAttribute("aria-label", "事業モデルの時系列");
      model.stages.forEach((stage, stageIndex) => {
        const button = element(document, "button");
        button.type = "button";
        button.classList.toggle("current", stageIndex === model.currentIndex);
        button.classList.toggle("past", stageIndex < model.currentIndex);
        button.setAttribute("aria-pressed", String(stageIndex === model.currentIndex));
        button.dataset.stageId = stage.id;
        button.append(element(document, "strong", "", stage.short));
        button.append(element(document, "span", "", stage.caption));
        button.addEventListener("click", () => emitAction({ action: component.action, context: { index: stageIndex, stageId: stage.id } }));
        nav.append(button);
      });
      return nav;
    },
  },
  {
    name: "ProfiledBusinessModelScene",
    validate: component => {
      assertExactKeys(component, ["children", "component", "id", "layout"], [], "ProfiledBusinessModelScene");
      assertStringArray(component.children, "ProfiledBusinessModelScene.children");
      invariant(Array.isArray(component.layout) && component.layout.length === component.children.length, "ProfiledBusinessModelScene.layout must align with children");
      for (const [index, kind] of component.layout.entries()) invariant(["actor", "exchange"].includes(kind), `ProfiledBusinessModelScene.layout[${index}] is invalid`);
      return component;
    },
    render: ({ component, document, renderChild }) => {
      const scroll = element(document, "div", "profiled-model-scroll");
      const scene = element(document, "section", "profiled-scene");
      scene.style.gridTemplateColumns = component.layout.map(kind => kind === "actor" ? "minmax(280px,1fr)" : "minmax(150px,.52fr)").join(" ");
      scene.dataset.columnCount = String(component.layout.length);
      for (const child of component.children) scene.append(renderChild(child));
      scroll.append(scene);
      return scroll;
    },
  },
  {
    name: "ProfiledActor",
    validate: component => {
      assertExactKeys(component, ["actorRef", "component", "id", "nodeStates", "state"], [], "ProfiledActor");
      string(component.actorRef, "ProfiledActor.actorRef");
      state(component.state, "ProfiledActor.state");
      arrayOfObjects(component.nodeStates, "ProfiledActor.nodeStates", (item, name) => {
        assertExactKeys(item, ["ref", "state"], [], name);
        string(item.ref, `${name}.ref`);
        state(item.state, `${name}.state`);
      });
      return component;
    },
    render: ({ component, dataModel, document }) => {
      const model = modelData(dataModel);
      const actor = model.actors[component.actorRef];
      invariant(isPlainObject(actor), `actor is missing: ${component.actorRef}`);
      const card = semantic(element(document, "article", `profiled-actor stage-item${classForState(component.state)}`), "actor", component.actorRef);
      card.append(element(document, "div", "profiled-actor-role", actor.role));
      card.append(element(document, "h2", "", actor.label));
      card.append(element(document, "p", "profiled-actor-detail", actor.detail));
      const nodes = element(document, "div", "profiled-owned-nodes");
      for (const item of component.nodeStates) {
        const node = model.nodes[item.ref];
        invariant(isPlainObject(node), `node is missing: ${item.ref}`);
        const panel = semantic(element(document, "section", `profiled-owned-node stage-item kind-${node.kind}${classForState(item.state)}`), "node", item.ref);
        panel.style.setProperty("--node-depth", String(integer(node.depth, `nodes.${item.ref}.depth`)));
        if (node.role) panel.append(element(document, "small", "", node.role));
        panel.append(element(document, "strong", "", node.label));
        if (node.detail) panel.append(element(document, "span", "", node.detail));
        if (Array.isArray(node.items) && node.items.length > 0) {
          const items = element(document, "div", "profiled-node-items");
          for (const label of node.items) items.append(element(document, "i", "", label));
          panel.append(items);
        }
        nodes.append(panel);
      }
      if (component.nodeStates.length > 0) card.append(nodes);
      return card;
    },
  },
  {
    name: "ProfiledExchangeGroup",
    validate: component => {
      assertExactKeys(component, ["component", "exchangeStates", "id", "leftActorRef", "rightActorRef"], [], "ProfiledExchangeGroup");
      string(component.leftActorRef, "ProfiledExchangeGroup.leftActorRef");
      string(component.rightActorRef, "ProfiledExchangeGroup.rightActorRef");
      arrayOfObjects(component.exchangeStates, "ProfiledExchangeGroup.exchangeStates", (item, name) => {
        assertExactKeys(item, ["ref", "state"], [], name);
        string(item.ref, `${name}.ref`);
        state(item.state, `${name}.state`);
      });
      return component;
    },
    render: ({ component, dataModel, document }) => {
      const model = modelData(dataModel);
      const group = element(document, "section", "profiled-exchange-group");
      group.dataset.leftActor = component.leftActorRef;
      group.dataset.rightActor = component.rightActorRef;
      for (const item of component.exchangeStates) {
        const exchange = model.exchanges[item.ref];
        invariant(isPlainObject(exchange), `exchange is missing: ${item.ref}`);
        const direction = exchange.from === component.leftActorRef ? "to-right" : "to-left";
        const lane = semantic(element(document, "article", `profiled-exchange ${direction} stage-item${classForState(item.state)}`), "exchange", item.ref);
        lane.append(element(document, "small", "", exchange.kind));
        lane.append(element(document, "strong", "", exchange.label));
        if (exchange.detail) lane.append(element(document, "span", "", exchange.detail));
        group.append(lane);
      }
      if (component.exchangeStates.length === 0) group.append(element(document, "p", "profiled-exchange-empty", "未成立"));
      return group;
    },
  },
  {
    name: "ProfiledBusinessModelStatus",
    validate: component => {
      assertExactKeys(component, ["activityRefs", "component", "id"], [], "ProfiledBusinessModelStatus");
      assertStringArray(component.activityRefs, "ProfiledBusinessModelStatus.activityRefs");
      return component;
    },
    render: ({ component, dataModel, document }) => {
      const model = modelData(dataModel);
      const status = element(document, "section", "profiled-status");
      const change = element(document, "div", "profiled-status-unit");
      change.append(element(document, "small", "", "今回追加"));
      change.append(element(document, "strong", "", model.stage.change));
      const evidence = element(document, "div", "profiled-status-unit");
      evidence.append(element(document, "small", "", "観測"));
      evidence.append(element(document, "strong", "", model.stage.evidence));
      const activities = element(document, "div", "profiled-activities");
      for (const ref of component.activityRefs) {
        const activity = model.activities[ref];
        invariant(isPlainObject(activity), `activity is missing: ${ref}`);
        const badge = semantic(element(document, "span", "", activity.label), "activity", ref);
        activities.append(badge);
      }
      status.append(change, evidence, activities, element(document, "div", "profiled-gate", model.stage.gate));
      return status;
    },
  },
  {
    name: "ProfiledBusinessModelLegend",
    validate: component => { assertExactKeys(component, ["component", "id"], [], "ProfiledBusinessModelLegend"); return component; },
    render: ({ document }) => {
      const legend = element(document, "div", "profiled-legend");
      legend.append(element(document, "span", "new", "今回出現"));
      legend.append(element(document, "span", "done", "前段まで成立"));
      return legend;
    },
  },
];

const catalog = createTrustedCatalog({ definitions, id: PROFILED_BUSINESS_MODEL_CATALOG_ID });
export const createProfiledBusinessModelCatalog = () => catalog;

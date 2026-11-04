#!/usr/bin/env node
// Every duration and keyframe in the client's stylesheets belongs to a shared
// motion family or a recorded distinct effect (ADR 0028 § Shared contracts, #284).
//
// The check reads the stylesheets and the inventory and compares them in both
// directions: a duration or keyframe the inventory does not know fails, and a
// recorded entry that has stopped appearing fails, so the inventory describes
// the stylesheets rather than an idea of them.
//
// It also rejects feature-owned timing declarations, interactive transforms,
// smooth-scroll calls and raw motion utility classes in client source. Visual
// correctness still needs a browser check.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { glob } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const clientRoot = path.join(repoRoot, "packages/webui/src/client");
const inventoryPath = path.join(repoRoot, "packages/webui/docs/design/motion-inventory.json");
const BUSINESS_MOTION_STYLESHEET_EXCEPTIONS = new Set([
  "features/account/ui/account.css",
  "features/transcript/ui/transcript.css",
]);
const BUSINESS_ANIMATION_EXCEPTIONS = {
  "features/account/ui/account.css": new Set(["signin-day-claimed"]),
  "features/transcript/ui/transcript.css": new Set(["message-appear", "webui-turn-jump-flash"]),
};
const SHARED_ANIMATION_ENGINE_IMPORTS = new Map([["lottie-web", "ui/feedback.tsx"]]);
const MOTION_DECLARATION = /(?:^|[;{]\s*)(?:transition(?:-[a-z-]+)?|animation(?:-[a-z-]+)?)\s*:/u;
const MOTION_UTILITY = /^(?:transition(?:-|$)|duration-|ease-|animate-|rotate-)/u;
const COMPONENT_OWNED_MOTION_CLASSES = new Set([
  "webui-motion",
  "webui-motion-disclosure",
  "webui-motion-disclosure-transform",
  "webui-motion-feedback",
  "webui-motion-feedback-clip",
  "webui-motion-feedback-opacity",
  "webui-motion-loading",
  "webui-motion-panel-layout",
  "webui-motion-progress",
  "webui-motion-surface-enter",
  "webui-motion-surface-exit",
]);
const SHARED_COMPONENT_CLASSES = new Map([
  ["webui-flyout-surface", { component: "WebuiFlyoutSurface", owner: "ui/Dropdown.tsx" }],
  ["webui-dropdown-surface", { component: "WebuiFlyoutSurface", owner: "ui/Dropdown.tsx" }],
  ["webui-feedback-spinner", { component: "WebuiSpinner", owner: "ui/feedback.tsx" }],
]);
const MOTION_COMPONENT_IMPLEMENTATION_FILES = new Set([
  "ui/Dropdown.tsx",
  "ui/ToggleSwitch.tsx",
  "ui/button.tsx",
  "ui/feedback.tsx",
  "ui/field.tsx",
  "ui/menu-item.tsx",
  "ui/page.tsx",
  // The toast card draws the shared surface motion itself: it applies the
  // family's attributes by hand, because `WebuiMotion` would project a
  // skeleton over a notice while the page is loading.
  "ui/toast.tsx",
]);
/**
 * The files that may write the shared motion's attributes by hand.
 *
 * `ui/page.tsx` owns `WebuiMotion`, so it writes them. `ui/toast.tsx` is the
 * one other caller, and it says why in its own source: `WebuiMotion` projects
 * its children into a skeleton while the page is loading, and a notice that
 * turns into a placeholder is a notice the user cannot read.
 */
const MOTION_ATTRIBUTE_OWNERS = new Set([
  "ui/page.tsx",
  "ui/toast.tsx",
]);
const SHARED_FEEDBACK_CONTROLS = new Set([
  "ui/ToggleSwitch.tsx",
  "ui/button.tsx",
  "ui/field.tsx",
  "ui/menu-item.tsx",
]);
const INTERACTIVE_TRANSFORM_UTILITY = /^(?:-?(?:scale|translate)-|transform(?:-|$))/u;
const ARBITRARY_MOTION_PROPERTY = /(?:^|[\[:])(?:animation|transition)\s*:/u;
const INTERACTIVE_TRANSFORM_PROPERTY = /(?:^|[\[:])(?:rotate|scale|transform|translate)\s*:/u;
const INTERACTIVE_VARIANT = /(?:^|:)(?:hover|active|focus(?:-visible|-within)?|group-(?:hover|focus(?:-visible|-within)?)|peer-(?:hover|focus(?:-visible|-within)?)|aria-[^:]+|data-\[[^:]+\])(?:\/[\w-]+)?(?=:|$)/u;
const INLINE_MOTION_PROPERTIES = new Set([
  "animation",
  "animationDelay",
  "animationDuration",
  "animationFillMode",
  "animationIterationCount",
  "animationName",
  "animationTimingFunction",
  "transition",
  "transitionDelay",
  "transitionDuration",
  "transitionProperty",
  "transitionTimingFunction",
]);

const DURATION = /(?<![\w-])(\d*\.?\d+)(ms|s)\b/u;
const TIMING_RULE = /(?:transition|animation)(?:-duration)?\s*:[^;]+;/gu;
const KEYFRAMES = /@keyframes\s+([A-Za-z0-9_-]+)/gu;

/** Every duration a stylesheet uses in a transition or an animation. */
export function scanStylesheet(text) {
  const durations = new Set();
  for (const rule of text.match(TIMING_RULE) ?? []) {
    for (const match of rule.matchAll(new RegExp(DURATION, "gu"))) {
      durations.add(`${match[1]}${match[2]}`);
    }
  }
  return { durations: [...durations].sort(), keyframes: [...new Set([...text.matchAll(KEYFRAMES)].map((m) => m[1]))].sort() };
}

/**
 * The differences between the stylesheets and the inventory, in both directions.
 *
 * `adopted` must equal the token value it names: an entry that says "feedback"
 * while carrying 200ms is a distinct effect wearing a family's name, and that is
 * exactly the drift this check exists to catch.
 */
export function compareMotion(scannedByFile, inventory) {
  const tokens = inventory.tokens ?? {};
  const problems = [];
  const files = new Set([...Object.keys(scannedByFile), ...Object.keys(inventory.files ?? {})]);

  for (const file of [...files].sort()) {
    const scanned = scannedByFile[file] ?? { durations: [], keyframes: [] };
    const recorded = inventory.files?.[file] ?? { durations: [], keyframes: [] };

    const knownDurations = new Map((recorded.durations ?? []).map((entry) => [entry.value, entry]));
    for (const value of scanned.durations) {
      const entry = knownDurations.get(value);
      if (!entry) problems.push(`${file}: ${value} is not in the motion inventory`);
      else if (entry.family !== "distinct" && tokens[entry.family] !== value) {
        problems.push(`${file}: ${value} claims ${entry.family} but that token is ${tokens[entry.family] ?? "(missing)"}`);
      }
    }
    for (const [value, entry] of knownDurations) {
      if (!scanned.durations.includes(value)) problems.push(`${file}: recorded ${value} no longer appears`);
      if (entry.family === "distinct" && !entry.reason) problems.push(`${file}: ${value} is recorded as distinct with no reason`);
    }

    const knownKeyframes = new Map((recorded.keyframes ?? []).map((entry) => [entry.name, entry]));
    for (const name of scanned.keyframes) {
      const entry = knownKeyframes.get(name);
      if (!entry) problems.push(`${file}: @keyframes ${name} is not in the motion inventory`);
      else if (entry.family === "distinct" && !entry.reason) problems.push(`${file}: @keyframes ${name} is distinct with no reason`);
    }
    for (const name of knownKeyframes.keys()) {
      if (!scanned.keyframes.includes(name)) problems.push(`${file}: recorded @keyframes ${name} no longer appears`);
    }
  }

  return problems;
}

export function sourceMotionOwnershipProblems(file, text) {
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const problems = [];

  if (file.startsWith("features/") || file.startsWith("shell/")) {
    function inspectSkeletonProps(node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tagName = node.tagName.getText(sourceFile);
        const forbidden = tagName === "WebuiSkeleton"
          ? new Set(["variant", "width", "height", "className", "style", "animated", "animation"])
          : tagName === "WebuiSkeletonGroup"
            ? new Set(["variant", "width", "height", "className", "style", "animated", "animation"])
            : tagName === "FeedbackSkeleton"
              ? new Set(["variant", "width", "height", "widths", "maxWidth", "rowHeight", "rowRadius", "className", "style", "animated", "animation"])
              : undefined;
        for (const attribute of node.attributes.properties) {
          if (!ts.isJsxAttribute(attribute)) continue;
          const name = attribute.name.getText(sourceFile);
          if (forbidden?.has(name)) {
            problems.push(`${file}: ${tagName}.${name} is a shared skeleton visual; business code may supply layout only`);
          }
        }
      }
      ts.forEachChild(node, inspectSkeletonProps);
    }
    inspectSkeletonProps(sourceFile);
  }

  function collectStringLiterals(node, target) {
    if (ts.isStringLiteralLike(node)) {
      target.push(node.text);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      target.push(node.head.text);
      for (const span of node.templateSpans) {
        collectStringLiterals(span.expression, target);
        target.push(span.literal.text);
      }
      return;
    }
    ts.forEachChild(node, (child) => collectStringLiterals(child, target));
  }

  function checkMotionClasses(values) {
    for (const value of values) {
      for (const token of value.split(/\s+/u).filter(Boolean)) {
        const utility = token.slice(token.lastIndexOf(":") + 1);
        const interactiveVariant = INTERACTIVE_VARIANT.test(token);
        const sharedComponent = SHARED_COMPONENT_CLASSES.get(utility);
        if (sharedComponent && file !== sharedComponent.owner) {
          problems.push(
            `${file}: source names ${JSON.stringify(utility)} directly; use ${sharedComponent.component}`,
          );
        }
        if (!MOTION_COMPONENT_IMPLEMENTATION_FILES.has(file) && COMPONENT_OWNED_MOTION_CLASSES.has(utility)) {
          const owner = utility === "webui-motion"
            ? "WebuiMotion or WebuiPage"
            : utility === "webui-motion-disclosure"
              ? "WebuiMotionSlot or WebuiDisclosure"
              : "WebuiMotionSlot";
          problems.push(
            `${file}: source names ${JSON.stringify(utility)} directly; use ${owner}`,
          );
        }
        if (
          MOTION_UTILITY.test(utility) ||
          ARBITRARY_MOTION_PROPERTY.test(token) ||
          (interactiveVariant && (
            INTERACTIVE_TRANSFORM_UTILITY.test(utility) ||
            INTERACTIVE_TRANSFORM_PROPERTY.test(token)
          ))
        ) {
          problems.push(
            `${file}: source uses raw motion utility ${JSON.stringify(token)}; use a shared motion component or an approved exception`,
          );
        }
      }
    }
  }

  function inspect(node) {
    if (
      file !== "ui/button.tsx" &&
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.attributes.properties.some((attribute) =>
        ts.isJsxAttribute(attribute) &&
        attribute.name.getText(sourceFile) === "role" &&
        attribute.initializer &&
        ts.isStringLiteral(attribute.initializer) &&
        attribute.initializer.text === "button",
      )
    ) {
      problems.push(`${file}: custom role=button bypasses shared button semantics and feedback motion; use WebuiButton`);
    }
    if (
      file !== "ui/page.tsx" &&
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(sourceFile) === "WebuiDialog" &&
      !node.attributes.properties.some((attribute) =>
        ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === "open",
      )
    ) {
      problems.push(`${file}: WebuiDialog must receive an explicit open state so its shared exit motion can finish`);
    }
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(sourceFile) === "details") {
      problems.push(`${file}: native <details> bypasses the shared disclosure layout and motion contract`);
    }
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ["animate", "animateMotion", "animateTransform"].includes(node.tagName.getText(sourceFile))
    ) {
      problems.push(`${file}: inline SVG animation bypasses the shared motion component`);
    }
    if (
      !MOTION_ATTRIBUTE_OWNERS.has(file) &&
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.attributes.properties.some((attribute) =>
        ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === "data-webui-motion",
      )
    ) {
      problems.push(`${file}: data-webui-motion is owned by WebuiMotion or WebuiPage; use the shared component`);
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const moduleName = node.moduleSpecifier.text;
      const sharedOwner = SHARED_ANIMATION_ENGINE_IMPORTS.get(moduleName);
      if (sharedOwner && file !== sharedOwner) {
        problems.push(`${file}: ${moduleName} playback belongs in the shared ${sharedOwner} component`);
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "animate" &&
      file !== "ui/feedback.tsx"
    ) {
      problems.push(`${file}: Web Animations API call bypasses the shared motion component`);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ["scrollIntoView", "scrollTo"].includes(node.expression.name.text) &&
      file !== "bindings/browser-effects.ts"
    ) {
      const options = node.arguments.find(ts.isObjectLiteralExpression);
      const requestsSmoothScroll = options?.properties.some((property) =>
        ts.isPropertyAssignment(property) &&
        property.name.getText(sourceFile).replaceAll(/["']/gu, "") === "behavior" &&
        ts.isStringLiteralLike(property.initializer) && property.initializer.text === "smooth",
      );
      if (requestsSmoothScroll) {
        problems.push(`${file}: smooth scrolling belongs in the shared browser-effects helper`);
      }
    }
    if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
      const values = [];
      collectStringLiterals(node, values);
      checkMotionClasses(values);
    }
    if (ts.isJsxAttribute(node) && node.initializer) {
      const attributeName = node.name.getText(sourceFile);
      if (attributeName === "style") {
        function inspectStyleProperty(child) {
          if (ts.isPropertyAssignment(child)) {
            const propertyName = child.name.getText(sourceFile).replaceAll(/["']/gu, "");
            if (INLINE_MOTION_PROPERTIES.has(propertyName)) {
              problems.push(
                `${file}: inline style defines ${propertyName}; use a shared motion component or an approved exception`,
              );
            }
          }
          ts.forEachChild(child, inspectStyleProperty);
        }
        inspectStyleProperty(node.initializer);
      }
    }
    ts.forEachChild(node, inspect);
  }

  inspect(sourceFile);
  return problems;
}

export function sharedFeedbackControlProblems(file, text) {
  if (!SHARED_FEEDBACK_CONTROLS.has(file) || text.includes("webui-motion-feedback")) return [];
  return [`${file}: shared controls must opt into the common feedback motion family`];
}

export function featureRotationOwnershipProblems(file, text) {
  if (!file.startsWith("features/")) return [];
  const staticFeatureRotations = [
    ".webui-workspace-launcher-wordmark",
    ".webui-context-usage-trigger",
  ];
  const problems = [];
  for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/gs)) {
    const [, selector, declarations] = match;
    if (!/\btransform\s*:[^;}]*\brotate\(/u.test(declarations)) continue;
    if (staticFeatureRotations.some((allowed) => selector.includes(allowed))) continue;
    problems.push(`${file}: business-owned rotation belongs in shared motion styles`);
  }
  return problems;
}

export function featureSmoothScrollOwnershipProblems(file, text) {
  if (!file.startsWith("features/")) return [];
  return /\bscroll-behavior\s*:\s*smooth\b/u.test(text)
    ? [`${file}: smooth scrolling belongs in the shared browser-effects helper`]
    : [];
}

export function featureInteractionTransformOwnershipProblems(file, text) {
  if (!file.startsWith("features/")) return [];
  const interactionState = /([^{}]*(?::hover|:active|:focus-visible|:focus-within|\[aria-expanded="true"\]|\[data-[^\]]+="true"\])[^{}]*)\{([^{}]*)\}/gs;
  const problems = [];
  for (const [, selector, declarations] of text.matchAll(interactionState)) {
    if (/\b(?:transform|translate|scale|rotate)\s*:/u.test(declarations)) {
      problems.push(`${file}: interaction transforms belong to a shared motion family`);
    }
  }
  return problems;
}

export function disabledTransitionOwnershipProblems(file, text) {
  const problems = [];
  for (const [, selector, declarations] of text.matchAll(/([^{}]+)\{([^{}]*)\}/gs)) {
    if (!/\btransition(?:-property)?\s*:\s*none\s*;/u.test(declarations)) continue;
    const isEmptyRange =
      file === "styles/motion.css" &&
      selector.includes('.webui-motion[data-webui-motion="range"][data-empty="true"]');
    if (!isEmptyRange) problems.push(`${file}: disabling a shared transition requires a motion-family exception`);
  }
  return problems;
}

function animationAssetImports(file, text) {
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const assets = [];
  function inspect(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.endsWith(".json")) {
      const resolved = path.resolve(clientRoot, path.dirname(file), node.moduleSpecifier.text);
      const relative = path.relative(clientRoot, resolved).split(path.sep).join("/");
      if (relative.includes("assets/lottie/")) assets.push(relative);
    }
    ts.forEachChild(node, inspect);
  }
  inspect(sourceFile);
  return assets;
}

async function checkMotionOwnership(inventory) {
  const problems = [];
  let approvedStylesheets = 0;
  let rawUtilityClasses = 0;
  const importedAnimationAssets = new Map();
  for await (const file of glob("**/*.css", { cwd: clientRoot })) {
    const text = readFileSync(path.join(clientRoot, file), "utf8");
    const stylesheet = text.replace(/\/\*[\s\S]*?\*\//gu, "");
    if (file !== "styles/motion.css" && /[^{}]*\.webui-skeleton(?:[\s.#:[>+~]|$)[^{}]*\{/u.test(stylesheet)) {
      problems.push(`${file}: skeleton appearance belongs to shared styles/motion.css; business styles may define layout around it only`);
    }
    problems.push(...featureRotationOwnershipProblems(file, stylesheet));
    problems.push(...featureSmoothScrollOwnershipProblems(file, stylesheet));
    problems.push(...featureInteractionTransformOwnershipProblems(file, stylesheet));
    problems.push(...disabledTransitionOwnershipProblems(file, stylesheet));
    if (!MOTION_DECLARATION.test(stylesheet)) continue;
    if (file.startsWith("features/") && !BUSINESS_MOTION_STYLESHEET_EXCEPTIONS.has(file)) {
      problems.push(
        `${file}: motion declarations belong in shared client styles; feature-owned motion needs an ADR-approved exception`,
      );
    } else if (BUSINESS_MOTION_STYLESHEET_EXCEPTIONS.has(file)) {
      approvedStylesheets += 1;
      const declarations = stylesheet.matchAll(/\b(transition(?:-[a-z-]+)?|animation(?:-[a-z-]+)?)\s*:\s*([^;]+);/gu);
      const allowedAnimations = BUSINESS_ANIMATION_EXCEPTIONS[file];
      for (const [, property, value] of declarations) {
        if (property.startsWith("transition")) {
          problems.push(`${file}: business-owned ${property} is not an approved distinct effect; use a shared motion class`);
          continue;
        }
        if (value.trim() === "none") continue;
        const animationName = value.trim().match(/^(?:[-\w]+\s+)*([a-zA-Z_][\w-]*)/u)?.[1];
        if (!animationName || !allowedAnimations.has(animationName)) {
          problems.push(`${file}: business-owned animation ${JSON.stringify(value.trim())} is not an ADR-approved distinct effect`);
        }
      }
    }
  }

  for await (const file of glob("**/*.{ts,tsx}", { cwd: clientRoot })) {
    const text = readFileSync(path.join(clientRoot, file), "utf8");
    const fileProblems = sourceMotionOwnershipProblems(file, text);
    rawUtilityClasses += fileProblems.filter((problem) => problem.includes("raw source motion utility")).length;
    problems.push(...fileProblems);
    problems.push(...sharedFeedbackControlProblems(file, text));
    for (const asset of animationAssetImports(file, text)) {
      const owners = importedAnimationAssets.get(asset) ?? [];
      owners.push(file);
      importedAnimationAssets.set(asset, owners);
    }
  }
  const approvedAssets = inventory.animationAssets ?? {};
  for (const [asset, owners] of importedAnimationAssets) {
    const entry = approvedAssets[asset];
    if (!entry?.reason) {
      problems.push(`${asset}: Lottie animation asset is not recorded with an owner, shared renderer and reason`);
      continue;
    }
    if (owners.length !== 1 || owners[0] !== entry.owner) {
      problems.push(`${asset}: expected sole import from ${entry.owner}, found ${owners.join(", ")}`);
    }
    if (!entry.renderer) problems.push(`${asset}: recorded animation asset has no shared renderer`);
  }
  for (const asset of Object.keys(approvedAssets)) {
    if (!importedAnimationAssets.has(asset)) problems.push(`${asset}: recorded Lottie animation asset is no longer imported`);
  }
  return { problems, approvedStylesheets, rawUtilityClasses };
}

/** Every stylesheet in the client, keyed by its path under `src/client`. */
export async function scanClient(root = clientRoot) {
  const scanned = {};
  for await (const entry of glob("**/*.css", { cwd: root })) {
    const text = readFileSync(path.join(root, entry), "utf8");
    const result = scanStylesheet(text);
    if (result.durations.length === 0 && result.keyframes.length === 0) continue;
    scanned[entry.split(path.sep).join("/")] = result;
  }
  return scanned;
}

async function main() {
  const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
  const scanned = await scanClient();
  const ownership = await checkMotionOwnership(inventory);
  const problems = [...compareMotion(scanned, inventory), ...ownership.problems];
  const durations = Object.values(scanned).reduce((sum, entry) => sum + entry.durations.length, 0);
  const keyframes = Object.values(scanned).reduce((sum, entry) => sum + entry.keyframes.length, 0);

  console.log(`scanned ${Object.keys(scanned).length} stylesheets: ${durations} durations, ${keyframes} keyframes`);
  console.log(`families: ${Object.keys(inventory.families ?? {}).join(", ")}`);
  const distinct = Object.values(inventory.files ?? {}).reduce(
    (sum, entry) => sum + (entry.durations ?? []).filter((each) => each.family === "distinct").length,
    0,
  );
  console.log(`distinct effects with a recorded reason: ${distinct}`);
  console.log(`approved feature motion stylesheets: ${ownership.approvedStylesheets}`);
  console.log(`raw source motion utility classes: ${ownership.rawUtilityClasses}`);

  if (problems.length > 0) {
    console.error(`\nmotion inventory is out of date (${problems.length}):`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log("every duration and keyframe has a named family or a recorded reason");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

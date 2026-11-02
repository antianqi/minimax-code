// Motion foundations (ADR 0028 § Shared contracts, #284).
//
// The inventory gate's own rules, and the one place where CSS and JavaScript
// read the same timing value. None of this needs a browser: the stylesheets and
// the constants are read from disk, which is what makes the check cheap enough
// to run on every change.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compareMotion, disabledTransitionOwnershipProblems, featureInteractionTransformOwnershipProblems, featureRotationOwnershipProblems, featureSmoothScrollOwnershipProblems, scanStylesheet, sharedFeedbackControlProblems, sourceMotionOwnershipProblems } from "../../../../scripts/check-webui-motion.mjs";

const clientRoot = new URL("../../src/client/", import.meta.url);
const motionCss = readFileSync(new URL("styles/motion.css", clientRoot), "utf8");
const dropdownCss = readFileSync(new URL("styles/dropdown.css", clientRoot), "utf8");
const dropdownTsx = readFileSync(new URL("ui/Dropdown.tsx", clientRoot), "utf8");

const inventory = {
  tokens: { feedback: "120ms", surface: "180ms", disclosure: "160ms", loading: "1.2s", popupExit: "120ms" },
  files: {
    "a.css": {
      durations: [{ value: "120ms", family: "feedback" }],
      keyframes: [{ name: "fade-in", family: "surface" }],
    },
  },
};

describe("the motion inventory", () => {
  it("names the four families and the popup exit in tokens", () => {
    for (const family of ["feedback", "surface", "disclosure", "loading"]) {
      expect(motionCss).toMatch(new RegExp(`--webui-motion-duration-${family}:\\s*\\d`, "u"));
      expect(motionCss).toMatch(new RegExp(`\\.webui-motion-${family}\\b`, "u"));
    }
    expect(motionCss).toMatch(/--webui-motion-duration-popup-exit:\s*\d+ms/u);
  });

  it("collapses every duration under the reduced-motion policy", () => {
    const block = motionCss.slice(motionCss.indexOf("prefers-reduced-motion"));
    for (const token of ["feedback", "surface", "disclosure", "loading", "popup-exit"]) {
      expect(block).toContain(`--webui-motion-duration-${token}: 0.01ms`);
    }
  });

  it("fails on a duration the inventory does not know", () => {
    const scanned = { "a.css": scanStylesheet("a{transition:color 175ms linear;}") };
    expect(compareMotion(scanned, inventory)).toContain("a.css: 175ms is not in the motion inventory");
  });

  it("fails on a family entry whose value is not that family's token", () => {
    const scanned = { "a.css": scanStylesheet("a{transition:color 200ms linear;}") };
    expect(compareMotion(scanned, { ...inventory, files: { "a.css": { durations: [{ value: "200ms", family: "feedback" }], keyframes: [] } } })).toEqual([
      "a.css: 200ms claims feedback but that token is 120ms",
    ]);
  });

  it("fails on a distinct effect with no reason, and on an entry that has gone", () => {
    const scanned = { "a.css": scanStylesheet("a{animation:fade-out 400ms linear;}") };
    const problems = compareMotion(scanned, {
      ...inventory,
      files: {
        "a.css": {
          durations: [{ value: "400ms", family: "distinct" }, { value: "120ms", family: "feedback" }],
          keyframes: [{ name: "fade-in", family: "surface" }],
        },
      },
    });
    expect(problems).toContain("a.css: 400ms is recorded as distinct with no reason");
    expect(problems).toContain("a.css: recorded 120ms no longer appears");
    expect(problems).toContain("a.css: recorded @keyframes fade-in no longer appears");
  });

  it("keeps shared buttons, menu items, switches and fields on the feedback motion family", () => {
    for (const file of ["ui/ToggleSwitch.tsx", "ui/button.tsx", "ui/field.tsx", "ui/menu-item.tsx"]) {
      expect(sharedFeedbackControlProblems(file, `export function Control() {}`)).toEqual([
        `${file}: shared controls must opt into the common feedback motion family`,
      ]);
      expect(sharedFeedbackControlProblems(file, `className="webui-motion-feedback"`)).toEqual([]);
    }
    expect(sharedFeedbackControlProblems("features/example/ui/Control.tsx", "export function Control() {}"))
      .toEqual([]);
  });

  it("rejects shared styles that silently disable interaction transitions", () => {
    expect(disabledTransitionOwnershipProblems("styles/shell.css", ".option { transition: none; }"))
      .toEqual(["styles/shell.css: disabling a shared transition requires a motion-family exception"]);
    expect(disabledTransitionOwnershipProblems("styles/motion.css", '.webui-motion[data-webui-motion="range"][data-empty="true"] { transition: none; }'))
      .toEqual([]);
  });

  it("keeps animation engines, Web Animations API and SVG animation behind shared motion components", () => {
    expect(sourceMotionOwnershipProblems("features/example/ui/Widget.tsx", `import lottie from "lottie-web";`))
      .toContain("features/example/ui/Widget.tsx: lottie-web playback belongs in the shared ui/feedback.tsx component");
    expect(sourceMotionOwnershipProblems("features/example/ui/Widget.tsx", `node.animate([{ opacity: 0 }, { opacity: 1 }]);`))
      .toContain("features/example/ui/Widget.tsx: Web Animations API call bypasses the shared motion component");
    expect(sourceMotionOwnershipProblems("features/example/ui/Widget.tsx", `target.scrollIntoView({ block: "center", behavior: "smooth" });`))
      .toContain("features/example/ui/Widget.tsx: smooth scrolling belongs in the shared browser-effects helper");
    expect(sourceMotionOwnershipProblems("features/example/ui/Widget.tsx", `<svg><animate attributeName="opacity" /></svg>`))
      .toContain("features/example/ui/Widget.tsx: inline SVG animation bypasses the shared motion component");
    expect(sourceMotionOwnershipProblems("features/example/ui/Widget.tsx", `<Chevron className="webui-motion-disclosure-transform rotate-90" />`))
      .toContain('features/example/ui/Widget.tsx: source uses raw motion utility "rotate-90"; use a shared motion component or an approved exception');
    expect(sourceMotionOwnershipProblems("features/example/ui/Widget.tsx", `<Chevron className="webui-motion-disclosure-transform" />`))
      .toContain('features/example/ui/Widget.tsx: source names "webui-motion-disclosure-transform" directly; use WebuiMotionSlot');
    expect(sourceMotionOwnershipProblems("features/example/ui/Widget.tsx", `<div className="webui-motion-feedback" />`))
      .toContain('features/example/ui/Widget.tsx: source names "webui-motion-feedback" directly; use WebuiMotionSlot');
    expect(sourceMotionOwnershipProblems("features/example/ui/Widget.tsx", `<div className="webui-motion" data-webui-motion="panel" data-webui-motion-state="exit" />`))
      .toContain('features/example/ui/Widget.tsx: source names "webui-motion" directly; use WebuiMotion or WebuiPage');
    expect(sourceMotionOwnershipProblems("shell/ConversationSurface.tsx", `<div className="webui-motion-panel-layout" />`))
      .toContain('shell/ConversationSurface.tsx: source names "webui-motion-panel-layout" directly; use WebuiMotionSlot');
    expect(sourceMotionOwnershipProblems("shell/WebuiClientFoundationApp.tsx", `<div className="webui-motion-feedback-opacity" />`))
      .toContain('shell/WebuiClientFoundationApp.tsx: source names "webui-motion-feedback-opacity" directly; use WebuiMotionSlot');
    expect(sourceMotionOwnershipProblems("features/account/ui/Widget.tsx", `<span className="webui-feedback-spinner" />`))
      .toContain('features/account/ui/Widget.tsx: source names "webui-feedback-spinner" directly; use WebuiSpinner');
    expect(sourceMotionOwnershipProblems("ui/feedback.tsx", `<span className="webui-feedback-spinner" />`))
      .toEqual([]);
    expect(sourceMotionOwnershipProblems("features/example/ui/Widget.tsx", `<div data-webui-motion="panel" />`))
      .toContain("features/example/ui/Widget.tsx: data-webui-motion is owned by WebuiMotion or WebuiPage; use the shared component");
    expect(sourceMotionOwnershipProblems("features/example/ui/Widget.tsx", `<div className="webui-flyout-surface" />`))
      .toContain('features/example/ui/Widget.tsx: source names "webui-flyout-surface" directly; use WebuiFlyoutSurface');
    expect(sourceMotionOwnershipProblems("ui/ContextMenu.tsx", `<div className="webui-dropdown-surface" />`))
      .toContain('ui/ContextMenu.tsx: source names "webui-dropdown-surface" directly; use WebuiFlyoutSurface');
    expect(sourceMotionOwnershipProblems("ui/Dropdown.tsx", `<div className="webui-flyout-surface" />`))
      .toEqual([]);
    expect(sourceMotionOwnershipProblems("features/example/ui/Widget.tsx", `<div className="hover:scale-105" />`))
      .toContain('features/example/ui/Widget.tsx: source uses raw motion utility "hover:scale-105"; use a shared motion component or an approved exception');
    expect(sourceMotionOwnershipProblems("features/example/ui/Widget.tsx", `<div className="hover:-translate-x-1" />`))
      .toContain('features/example/ui/Widget.tsx: source uses raw motion utility "hover:-translate-x-1"; use a shared motion component or an approved exception');
    expect(sourceMotionOwnershipProblems("features/example/ui/Widget.tsx", `<div className="hover:[transform:scale(1.05)]" />`))
      .toContain('features/example/ui/Widget.tsx: source uses raw motion utility "hover:[transform:scale(1.05)]"; use a shared motion component or an approved exception');
    expect(sourceMotionOwnershipProblems("features/example/ui/Widget.tsx", `<div className="-translate-x-1/2 scale-y-50" />`))
      .toEqual([]);
    expect(featureRotationOwnershipProblems("features/example/ui/widget.css", `.widget-chevron.is-open { transform: rotate(90deg); }`))
      .toContain("features/example/ui/widget.css: business-owned rotation belongs in shared motion styles");
    expect(featureRotationOwnershipProblems("features/example/ui/widget.css", `.widget[data-expanded="true"] svg { transform: rotate(90deg); }`))
      .toContain("features/example/ui/widget.css: business-owned rotation belongs in shared motion styles");
    expect(featureSmoothScrollOwnershipProblems("features/example/ui/widget.css", `.widget { scroll-behavior: smooth; }`))
      .toContain("features/example/ui/widget.css: smooth scrolling belongs in the shared browser-effects helper");
    expect(featureInteractionTransformOwnershipProblems("features/example/ui/widget.css", `.widget:hover .thumb { scale: 1.08; }`))
      .toContain("features/example/ui/widget.css: interaction transforms belong to a shared motion family");
    expect(sourceMotionOwnershipProblems("ui/feedback.tsx", `import lottie from "lottie-web";`)).toEqual([]);
    expect(sourceMotionOwnershipProblems("features/example/ui/Widget.tsx", `<div role="button" tabIndex={0} onClick={activate} />`))
      .toContain("features/example/ui/Widget.tsx: custom role=button bypasses shared button semantics and feedback motion; use WebuiButton");
  });

  it("requires business dialogs to expose their shared open/exit state", () => {
    expect(sourceMotionOwnershipProblems("features/example/ui/Widget.tsx", `<WebuiDialog title="Confirm" onClose={close}><p>Body</p></WebuiDialog>`))
      .toContain("features/example/ui/Widget.tsx: WebuiDialog must receive an explicit open state so its shared exit motion can finish");
    expect(sourceMotionOwnershipProblems("features/example/ui/Widget.tsx", `<WebuiDialog open={open} title="Confirm" onClose={close}><p>Body</p></WebuiDialog>`))
      .toEqual([]);
  });
});

describe("the shared popup's timing", () => {
  it("reads one value from JavaScript and CSS", () => {
    const constant = /export const WEBUI_DROPDOWN_EXIT_MS = (\d+);/u.exec(dropdownTsx)?.[1];
    const token = /--webui-motion-duration-popup-exit:\s*(\d+)ms/u.exec(motionCss)?.[1];
    expect(constant, "WEBUI_DROPDOWN_EXIT_MS").toBeTruthy();
    expect(token, "--webui-motion-duration-popup-exit").toBeTruthy();
    expect(constant).toBe(token);
    // the skeleton writes that number into the property the exit animation reads
    expect(dropdownTsx).toContain("--webui-dropdown-exit-duration");
    expect(dropdownCss).toContain("var(--webui-dropdown-exit-duration, var(--webui-motion-duration-popup-exit))");
  });

  it("leaves no raw duration in the shared dropdown stylesheet", () => {
    const { durations } = scanStylesheet(dropdownCss);
    expect(durations, "dropdown.css timed by its own numbers").toEqual([]);
  });

  it("adopts the surface-enter family for its entry", () => {
    expect(dropdownCss).toContain("webui-dropdown-in var(--webui-motion-duration-surface) var(--webui-motion-ease-enter)");
  });
});

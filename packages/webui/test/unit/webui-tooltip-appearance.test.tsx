// The tooltip's appearance contract (ADR 0028 § Shared contracts).
//
// The shared tooltip owns the visibility, the accessibility and the motion.
// The appearance is the caller's, and it is named rather than spelled: the
// bubble is the one dark shape with an arrow, the card is a plain surface for
// a tip that carries more than a line.
//
// The component used to add the bubble's shape to every caller, so a card had
// to correct it in its own stylesheet — the account page's calendar tip was
// a bubble with an arrow it never wanted, wearing a rule that undid the
// bubble's radius, its ink and its padding. The two shapes are declared in
// the shared stylesheet now, and the caller names the one it draws.

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WebuiTooltip } from "../../src/client/ui/page.js";

const tooltipCss = readFileSync(
  new URL("../../src/client/styles/tooltip.css", import.meta.url),
  "utf8",
);

const render = (props: Record<string, unknown> = {}): string =>
  renderToStaticMarkup(
    createElement(WebuiTooltip, { visible: true, ...props }),
  );

describe("the shared tooltip", () => {
  it("draws the bubble by default, with the shared visibility and motion", () => {
    const markup = render();
    expect(markup).toContain("webui-tooltip-bubble");
    expect(markup).toContain('data-webui-tooltip-visible="true"');
    expect(markup).toContain('data-webui-motion="tooltip"');
  });

  it("draws the card when the caller asks for a card, and not the bubble with it", () => {
    const markup = render({ appearance: "card" });
    expect(markup).toContain("webui-tooltip-card");
    // The card is a shape of its own. A caller that still had to undo the
    // bubble's shape would find the bubble here.
    expect(markup).not.toContain("webui-tooltip-bubble");
  });

  it("leaves the shape to the caller when there is none", () => {
    const markup = render({ appearance: "none" });
    expect(markup).not.toContain("webui-tooltip-bubble");
    expect(markup).not.toContain("webui-tooltip-card");
  });

  it("keeps the bubble's arrow and gives the card none", () => {
    expect(tooltipCss).toContain(".webui-tooltip-bubble::after");
    expect(tooltipCss).toContain(".webui-tooltip-card {");
    const card = tooltipCss.slice(tooltipCss.indexOf(".webui-tooltip-card {"));
    expect(card).not.toContain("::after");
  });

  it("gives the card the shape the account page's tip had, and no more", () => {
    // The tip is a two-line card: the radius, the ink and the padding it has
    // always had, declared once in the shared layer instead of restated by
    // the caller.
    const card = tooltipCss.slice(tooltipCss.indexOf(".webui-tooltip-card {"));
    expect(card).toContain("border-radius: var(--radius_4)");
    expect(card).toContain("background: rgb(0 0 0 / 85%)");
    expect(card).toContain("padding: 8px 10px");
    expect(card).toContain("pointer-events: none");
  });
});

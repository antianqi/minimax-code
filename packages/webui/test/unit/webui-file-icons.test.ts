// One file-type glyph per extension, and where each one comes from.
//
// The mapping is the single place a file's icon is decided: the workspace tree,
// the diff cards, the reply's file links and the delivered-asset rows all read
// it, so a wrong entry here shows up in four surfaces at once.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WebuiIconFileForName } from "../../src/client/shell/icons.js";

/** The Tabler class the chosen glyph draws, without the shared `tabler-icon`. */
function iconClass(fileName?: string): string {
  const html = renderToStaticMarkup(createElement(WebuiIconFileForName, { fileName }));
  const classes = /class="([^"]+)"/u.exec(html)?.[1].split(/\s+/u) ?? [];
  return classes.find((name) => name !== "tabler-icon") ?? "";
}

describe("file-type icons", () => {
  it.each([
    ["src/index.ts", "tabler-icon-file-type-ts"],
    ["App.tsx", "tabler-icon-file-type-tsx"],
    ["index.mjs", "tabler-icon-file-type-js"],
    ["Widget.jsx", "tabler-icon-file-type-jsx"],
    ["App.vue", "tabler-icon-file-type-vue"],
    ["index.html", "tabler-icon-file-type-html"],
    ["app.scss", "tabler-icon-file-type-css"],
    ["package.json", "tabler-icon-json"],
    ["README.md", "tabler-icon-markdown"],
    ["main.py", "tabler-icon-brand-python"],
    ["main.go", "tabler-icon-brand-golang"],
    ["lib.rs", "tabler-icon-file-type-rs"],
    ["schema.sql", "tabler-icon-file-type-sql"],
    ["notes.txt", "tabler-icon-file-type-txt"],
    ["report.pdf", "tabler-icon-file-type-pdf"],
    ["archive.tar", "tabler-icon-file-type-zip"],
    ["photo.PNG", "tabler-icon-file-type-png"],
    ["deploy.sh", "tabler-icon-terminal-2"],
  ])("draws %s as %s", (fileName, expected) => {
    expect(iconClass(fileName)).toBe(expected);
  });

  it("draws Java as the coffee cup, because Tabler has no Java mark", () => {
    expect(iconClass("src/Main.java")).toBe("tabler-icon-coffee");
  });

  it("falls back to the generic file glyph", () => {
    // No extension, an unknown one, and no name at all.
    expect(iconClass("LICENSE")).toBe("tabler-icon-file");
    expect(iconClass("data.unknownext")).toBe("tabler-icon-file");
    expect(iconClass("")).toBe("tabler-icon-file");
    expect(iconClass(undefined)).toBe("tabler-icon-file");
  });

  it("reads the basename, so a dotted directory or a path separator cannot fool it", () => {
    expect(iconClass("src/components/Button.tsx")).toBe("tabler-icon-file-type-tsx");
    expect(iconClass("C:\\work\\main.ts")).toBe("tabler-icon-file-type-ts");
    expect(iconClass("v1.2/README")).toBe("tabler-icon-file");
  });
});

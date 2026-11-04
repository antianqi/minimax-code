// Unit tests for the workspace file tree's rows.
//
// A row reads the file's name and nothing else: `WebuiWorkspaceFile.size` and
// `.modifiedAt` are still optional on the contract, so the load-bearing case
// here is a runtime that sends them — the row must stay name-only and never
// print a byte count, a timestamp, `undefined`, `NaN` or `Invalid Date`.

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FileTree } from "../../src/client/features/workspace/ui/WorkspaceFileTree.js";
import type { WebuiWorkspaceFile } from "../../src/shared/contracts/workspace.js";

const MODIFIED_AT = Date.UTC(2026, 9, 4, 8, 51);

function renderTree(
  files: readonly WebuiWorkspaceFile[],
  overrides: {
    readonly expandedPaths?: ReadonlySet<string>;
    readonly loadingPaths?: ReadonlySet<string>;
    readonly directoryErrors?: Readonly<Record<string, string>>;
    readonly selectedPath?: string;
  } = {},
): string {
  return renderToStaticMarkup(createElement(FileTree, {
    files,
    onOpen: () => undefined,
    expandedPaths: overrides.expandedPaths ?? new Set<string>(),
    loadingPaths: overrides.loadingPaths ?? new Set<string>(),
    directoryErrors: overrides.directoryErrors ?? {},
    onToggle: () => undefined,
    selectedPath: overrides.selectedPath,
  }));
}

describe("workspace file tree rows", () => {
  it("renders the name alone for a file the runtime stat-ed", () => {
    const markup = renderTree([
      { path: "src/index.ts", name: "index.ts", type: "file", size: 1258291, modifiedAt: MODIFIED_AT },
    ]);

    expect(markup).toContain('class="min-w-0 flex-1 truncate">index.ts</span>');
    expect(markup).not.toContain("1.2 MB");
    expect(markup).not.toContain("2026-10-04 08:51");
    expect(markup).not.toContain("undefined");
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("Invalid Date");
  });

  it("names each file with the glyph its extension earns", () => {
    const markup = renderTree([
      { path: "src/index.ts", name: "index.ts", type: "file", size: 10, modifiedAt: MODIFIED_AT },
      { path: "src/main.java", name: "main.java", type: "file", size: 10, modifiedAt: MODIFIED_AT },
      { path: "NOTICE", name: "NOTICE", type: "file", size: 10, modifiedAt: MODIFIED_AT },
    ]);

    // The tree used to draw one generic file for every row; a ts file, a Java
    // file and an extension-less one are now told apart by their glyph.
    expect(markup).toContain("tabler-icon-file-type-ts");
    // Java has no Tabler brand mark, so it borrows the coffee cup.
    expect(markup).toContain("tabler-icon-coffee");
    expect(markup).toContain("tabler-icon-file");
  });

  it("keeps the row contract and renders expanded directories through the shared disclosure", () => {
    const markup = renderTree(
      [
        {
          path: "src",
          name: "src",
          type: "directory",
          children: [{ path: "src/a.ts", name: "a.ts", type: "file", size: 10, modifiedAt: MODIFIED_AT }],
        },
      ],
      { expandedPaths: new Set(["src"]), selectedPath: "src" },
    );

    expect(markup).toMatch(/<button[^>]*class="[^"]*webui-file-tree-row[^"]*"[^>]*aria-current="true"/u);
    expect(markup).toContain('aria-current="true"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('data-webui-motion="disclosure"');
    expect(markup).toContain('data-webui-motion-state="expand"');
    expect(markup).toContain('data-webui-disclosure-axis="vertical"');
    expect(markup).toContain('class="webui-motion webui-file-tree-disclosure"');
    expect(markup).toContain('class="webui-disclosure-content"');
    expect(markup).toMatch(/class="webui-motion webui-file-tree-disclosure">/u);
    // The child is a row of its own, so it reads by name like its parent.
    expect(markup).toContain('class="min-w-0 flex-1 truncate">a.ts</span>');
    expect(markup).not.toContain("10 B");
  });

  it("mounts a directory's content on first open and hides it while collapsed", () => {
    const markup = renderTree([
      {
        path: "src",
        name: "src",
        type: "directory",
        children: [{ path: "src/a.ts", name: "a.ts", type: "file" }],
      },
    ]);

    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('data-webui-motion="disclosure"');
    expect(markup).toContain('data-webui-motion-state="collapse"');
    expect(markup).toMatch(/aria-hidden="true"[^>]*class="webui-motion webui-file-tree-disclosure"/u);
    expect(markup).toContain('class="webui-disclosure-content"');
    // The shared disclosure mounts its content on first open and retains it
    // afterwards, so a folder nobody has opened renders no children at all —
    // the shell, its motion state and its hidden content box are what exist.
    expect(markup).not.toContain("a.ts");
  });

  it("drops unusable numbers instead of printing NaN or Invalid Date", () => {
    const markup = renderTree([
      { path: "broken.bin", name: "broken.bin", type: "file", size: Number.NaN, modifiedAt: Number.POSITIVE_INFINITY },
      { path: "unreachable.bin", name: "unreachable.bin", type: "file", modifiedAt: 8.64e15 + 1 },
    ]);

    expect(markup).toContain("broken.bin");
    expect(markup).toContain("unreachable.bin");
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("Invalid Date");
  });

  it("shows neither size nor time for a directory, even if a runtime sends them", () => {
    const markup = renderTree([
      { path: "src", name: "src", type: "directory", size: 4096, modifiedAt: MODIFIED_AT },
    ]);

    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("src");
    expect(markup).not.toContain("4 KB");
    expect(markup).not.toContain("2026-10-04");
  });
});

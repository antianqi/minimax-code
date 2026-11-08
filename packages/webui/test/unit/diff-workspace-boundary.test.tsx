// The workspace boundary for a diff entry.
//
// A turn's diff can name a file outside the workspace: the runtime's capture
// layer records an out-of-workspace write as an absolute path, and the entry
// reaches the client with that file's content attached. The upstream fix that
// stopped the collection was reverted (PR #240) because it changed a package
// this fork may not change, so the boundary is drawn on the client side.
//
// This file pins down the two halves of that boundary:
//
//   * the projection, which removes the body before a surface can render it —
//     the body is blocked in the data, not merely left out of the markup;
//   * the surfaces, which say what is withheld instead of showing the content.
//
// The two are tested separately on purpose. A test that only reads the markup
// passes just as well when the component forgets to ask and the projection
// forgets to answer; a test that only reads the projection passes just as well
// when the component renders the body anyway. Together they say that neither
// one is carrying the other.
//
// Known boundary, and it is a boundary rather than a bug: a symlink inside the
// workspace that points outside it resolves outside, and the browser cannot see
// that. The entry's path is a relative one, so it stays contained here. The
// test below says so out loud rather than leaving it to be discovered.

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  isWebuiDiffPathWithinWorkspace,
  projectWebuiDiffFile,
  projectWebuiDiffFiles,
  WEBUI_DIFF_OUTSIDE_WORKSPACE_NOTICE,
} from "../../src/client/projection/common/diff-workspace-boundary.js";
import { isWebuiPathWithinSessionArtifacts } from "../../src/client/projection/common/session-artifacts-boundary.js";
import { WebuiDiffCard } from "../../src/client/features/transcript/ui/DiffCard.js";
import { WebuiBrowserCapabilitiesProvider } from "../../src/client/bindings/browser-capabilities.js";
import { EMPTY_WEBUI_BROWSER_DOM } from "../../src/client/platform/browser-dom.js";
import { createWebuiBrowserStorage } from "../../src/client/platform/storage.js";
import { WebuiDiffFileSection } from "../../src/client/features/workspace/ui/WorkspaceDiffFileSection.js";
import type { WebuiFileDiffInfoView } from "../../src/shared/contracts/session.js";

const WORKSPACE = "/work/project";

/** A body that must never reach a screen for a file outside the workspace.
 *  The marker is deliberately unlike anything in the file name, so a test that
 *  greps the markup cannot pass on the name alone. */
const BODY_MARKER = "TOKEN_VALUE_9f3a";
const BODY = `@@ -1,1 +1,1 @@\n-const token = "${BODY_MARKER}";\n+const token = "other";`;

const insideFile: WebuiFileDiffInfoView = {
  file: "src/app.ts",
  additions: 1,
  deletions: 1,
  status: "modified",
  diff: BODY,
};

const outsideFile: WebuiFileDiffInfoView = {
  file: "/etc/outside.conf",
  additions: 1,
  deletions: 1,
  status: "modified",
  diff: BODY,
};

/* The runtime writes a session's products -- the plan document above all --
 * into the session's own history directory, which is outside the workspace:
 *
 *   <dataDir>/v2/sessions/<YYYY>/<MM>/<DD>/<HH-mm-ss-SSS>-session_<base64url(sessionId)>/artifacts/plan.md
 *
 * The session id below is a real one, and the directory name is the real name
 * of its directory: the encoded segment is base64url of the id, the way the
 * runtime writes it. A path carrying that segment belongs to that session,
 * whatever its date segments say. */
const SESSION_ID = "mvs_6cbe13589997426bb304e4fc258bffbd";
const DATA_DIR = "/home/user/.minimax";
const SESSION_DIR =
  "2026/11/04/07-51-45-349-session_bXZzXzZjYmUxMzU4OTk5NzQyNmJiMzA0ZTRmYzI1OGJmZmJk";
const artifactsDir = `${DATA_DIR}/v2/sessions/${SESSION_DIR}/artifacts`;
const planFile = `${artifactsDir}/plan.md`;
const sessionRoots = { dataDir: DATA_DIR, sessionId: SESSION_ID };

describe("the projection removes the body of a file outside the workspace", () => {
  it("keeps the body of a file whose path is relative to the workspace", () => {
    const entry = projectWebuiDiffFile(insideFile, WORKSPACE);

    expect(entry.withinWorkspace).toBe(true);
    expect(entry.diff).toBe(BODY);
  });

  it("removes the body of an absolute path outside the workspace", () => {
    const entry = projectWebuiDiffFile(outsideFile, WORKSPACE);

    expect(entry.withinWorkspace).toBe(false);
    expect(entry.diff).toBeUndefined();
    expect(entry.patch).toBeUndefined();
  });

  it("removes the patch object as well as the diff text", () => {
    const entry = projectWebuiDiffFile(
      { file: "/etc/secret.conf", additions: 0, deletions: 0, patch: { hunks: ["secret"] } },
      WORKSPACE,
    );

    expect(entry.withinWorkspace).toBe(false);
    expect(entry.patch).toBeUndefined();
  });

  it("removes the body of a path that walks out of the workspace with `..`", () => {
    for (const file of ["../outside.txt", "src/../../outside.txt", ".."]) {
      const entry = projectWebuiDiffFile({ file, additions: 1, deletions: 0, diff: BODY }, WORKSPACE);

      expect(entry.withinWorkspace).toBe(false);
      expect(entry.diff).toBeUndefined();
    }
  });

  it("keeps the entry, its name and its counts when the body is removed", () => {
    const entry = projectWebuiDiffFile(outsideFile, WORKSPACE);

    // The file name and the counts are the part a person can still act on:
    // "which file was touched" survives even when its content does not.
    expect(entry.file).toBe("/etc/outside.conf");
    expect(entry.additions).toBe(1);
    expect(entry.deletions).toBe(1);
    expect(entry.status).toBe("modified");
  });

  it("keeps the body when the workspace root is unknown", () => {
    // Without a root there is no boundary to judge against. A check that hid
    // everything it could not place would hide ordinary content too.
    const entry = projectWebuiDiffFile(outsideFile, undefined);

    expect(entry.withinWorkspace).toBe(true);
    expect(entry.diff).toBe(BODY);
  });

  it("calls a sibling directory that shares the root's name outside", () => {
    // A string prefix would have called "/work/project-backup" inside
    // "/work/project"; the comparison is on segments.
    expect(isWebuiDiffPathWithinWorkspace(WORKSPACE, "/work/project-backup/x.ts")).toBe(false);
    expect(isWebuiDiffPathWithinWorkspace(WORKSPACE, "/work/project/x.ts")).toBe(true);
  });

  it("does not detect a symlink inside the workspace that points outside it", () => {
    // The known boundary: the path looks contained and the browser has no way
    // to know what it resolves to. Telling the two apart needs `realpath` on
    // the runtime side.
    expect(isWebuiDiffPathWithinWorkspace(WORKSPACE, "link/out.txt")).toBe(true);
  });

  it("keeps every entry of the list, in order", () => {
    const entries = projectWebuiDiffFiles([insideFile, outsideFile], WORKSPACE);

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.file)).toEqual(["src/app.ts", "/etc/outside.conf"]);
    expect(entries.map((entry) => entry.withinWorkspace)).toEqual([true, false]);
  });
});

describe("the session's own artifacts directory is a second trusted root", () => {
  const roots = sessionRoots;
  /** The layout below the data directory, as the runtime writes it. */
  const LAYOUT = `v2/sessions/${SESSION_DIR}/artifacts/plan.md`;

  it("keeps the body of a file in the session's own artifacts directory", () => {
    const entry = projectWebuiDiffFile(
      { file: planFile, additions: 85, deletions: 0, status: "added", diff: BODY },
      WORKSPACE,
      roots,
    );

    expect(entry.withinWorkspace).toBe(true);
    expect(entry.diff).toBe(BODY);
  });

  it("keeps the body of a file below the artifacts directory", () => {
    expect(isWebuiPathWithinSessionArtifacts(`${artifactsDir}/notes/summary.md`, roots)).toBe(true);
  });

  it("does not trust another session's artifacts directory", () => {
    const otherSession = `${DATA_DIR}/v2/sessions/2026/11/04/09-00-00-000-session_bXZzXzJjYjhlMTM4OTk5NzQyNmJiMzA0ZTRmYzI1OGJmZmJk/artifacts/plan.md`;

    expect(isWebuiPathWithinSessionArtifacts(otherSession, roots)).toBe(false);
    const entry = projectWebuiDiffFile(
      { file: otherSession, additions: 1, deletions: 0, diff: BODY },
      WORKSPACE,
      roots,
    );
    expect(entry.withinWorkspace).toBe(false);
    expect(entry.diff).toBeUndefined();
  });

  it("does not trust a directory that only looks like the artifacts directory", () => {
    // The same shape, outside the runtime's data directory: nothing places it
    // as this session's own output.
    const forged = `/tmp/v2/sessions/${SESSION_DIR}/artifacts/plan.md`;

    expect(isWebuiPathWithinSessionArtifacts(forged, roots)).toBe(false);
    const entry = projectWebuiDiffFile(
      { file: forged, additions: 1, deletions: 0, diff: BODY },
      WORKSPACE,
      roots,
    );
    expect(entry.withinWorkspace).toBe(false);
    expect(entry.diff).toBeUndefined();
  });

  it("does not trust a same-depth directory whose prefix is not the data directory", () => {
    // The forged path below has exactly the artifacts layout under a root of the
    // same depth, which a length-only comparison accepts: only comparing the
    // root's own segments says the directory is not the runtime's.
    const sameDepth = `/home/user/data/${LAYOUT}`;
    const sibling = `/home/user/.minimax-backup/${LAYOUT}`;

    expect(isWebuiPathWithinSessionArtifacts(sameDepth, roots)).toBe(false);
    expect(isWebuiPathWithinSessionArtifacts(sibling, roots)).toBe(false);
    // The real one, spelled through the root it names, is still trusted.
    expect(isWebuiPathWithinSessionArtifacts(planFile, roots)).toBe(true);
  });

  it("does not trust a path reached through another root kind", () => {
    // The same segments reached as a share, a drive and a posix directory are
    // three different roots. A comparison that only looked at segments would let
    // one spelling vouch for another.
    const layout = LAYOUT;
    expect(isWebuiPathWithinSessionArtifacts(`//home/user/.minimax/${layout}`, roots)).toBe(false);

    const windowsRoots = { dataDir: "C:\\Users\\u\\AppData\\mcode", sessionId: SESSION_ID };
    expect(
      isWebuiPathWithinSessionArtifacts(`D:\\Users\\u\\AppData\\mcode\\${layout}`, windowsRoots),
    ).toBe(false);
    // The same drive in another case is one drive, and the layout still holds.
    expect(
      isWebuiPathWithinSessionArtifacts(`c:/Users/u/AppData/mcode/${layout}`, windowsRoots),
    ).toBe(true);
  });

  it("does not trust the artifacts directory itself", () => {
    // The boundary is about a file *in* the directory: the directory names no
    // file, and a diff entry cannot name one either.
    expect(isWebuiPathWithinSessionArtifacts(artifactsDir, roots)).toBe(false);
    expect(isWebuiPathWithinSessionArtifacts(`${artifactsDir}/`, roots)).toBe(false);
  });

  it("compares UNC host and share and requires an absolute data root", () => {
    const unc = { dataDir: "//server/share/data", sessionId: SESSION_ID };
    expect(isWebuiPathWithinSessionArtifacts(`//server/share/data/${LAYOUT}`, unc)).toBe(true);
    expect(isWebuiPathWithinSessionArtifacts(`//other/share/data/${LAYOUT}`, unc)).toBe(false);
    expect(isWebuiPathWithinSessionArtifacts(`//server/other/data/${LAYOUT}`, unc)).toBe(false);
    expect(isWebuiPathWithinSessionArtifacts(`relative/data/${LAYOUT}`, { dataDir: "relative/data", sessionId: SESSION_ID })).toBe(false);
  });

  it("does not trust a file that walks out of the artifacts directory", () => {
    expect(isWebuiPathWithinSessionArtifacts(`${artifactsDir}/../../../../etc/hostname`, roots)).toBe(false);
  });

  it("does not trust a file that is the artifacts directory's neighbour", () => {
    const neighbour = `${DATA_DIR}/v2/sessions/${SESSION_DIR}/messages.jsonl`;

    expect(isWebuiPathWithinSessionArtifacts(neighbour, roots)).toBe(false);
  });

  it("trusts nothing without a data directory or a session id", () => {
    expect(isWebuiPathWithinSessionArtifacts(planFile, { sessionId: SESSION_ID })).toBe(false);
    expect(isWebuiPathWithinSessionArtifacts(planFile, { dataDir: DATA_DIR })).toBe(false);
  });

  it("keeps the body of an ordinary outside file when the roots are absent", () => {
    // Without the trusted roots the boundary is the one it was: the workspace
    // and nothing else.
    const entry = projectWebuiDiffFile(outsideFile, WORKSPACE);

    expect(entry.withinWorkspace).toBe(false);
    expect(entry.diff).toBeUndefined();
  });
});

describe("the diff card shows what is withheld instead of the content", () => {
  const renderCard = (file: WebuiFileDiffInfoView, workspaceDir?: string): string =>
    renderToStaticMarkup(
      createElement(WebuiDiffCard, {
        workspaceDir,
        initialView: {
          status: "active",
          changeSetId: "changes-1",
          fileChanges: [file],
        },
        // The card's own review panel is the surface that renders the body.
        initialState: { unsupported: false, busy: false, expanded: false, reviewing: true },
      }),
    );

  it("shows the body of a file inside the workspace", () => {
    const markup = renderCard(insideFile, WORKSPACE);

    expect(markup).toContain(BODY_MARKER);
    expect(markup).not.toContain(WEBUI_DIFF_OUTSIDE_WORKSPACE_NOTICE);
  });

  it("does not render the body of a file outside the workspace", () => {
    const markup = renderCard(outsideFile, WORKSPACE);

    expect(markup).not.toContain(BODY_MARKER);
    expect(markup).not.toContain("@@ -1,1 +1,1 @@");
    expect(markup).toContain(WEBUI_DIFF_OUTSIDE_WORKSPACE_NOTICE);
  });

  it("keeps the file in the list with its counts", () => {
    const markup = renderCard(outsideFile, WORKSPACE);

    expect(markup).toContain('data-file-path="/etc/outside.conf"');
    expect(markup).toContain("+1");
    expect(markup).toContain("-1");
  });

  it("shows the body when the workspace root is unknown", () => {
    const markup = renderCard(outsideFile);

    expect(markup).toContain(BODY_MARKER);
    expect(markup).not.toContain(WEBUI_DIFF_OUTSIDE_WORKSPACE_NOTICE);
  });

  it("shows the body of a file in the session's own artifacts directory", () => {
    // The card reads the runtime's data directory from the capabilities the
    // host hands it, so the test serves the page one.
    const markup = renderToStaticMarkup(
      createElement(WebuiBrowserCapabilitiesProvider, {
        value: {
          dom: EMPTY_WEBUI_BROWSER_DOM,
          storage: createWebuiBrowserStorage(undefined),
          dataDir: DATA_DIR,
        },
        children: createElement(WebuiDiffCard, {
          sessionId: SESSION_ID,
          workspaceDir: WORKSPACE,
          initialView: {
            status: "active",
            changeSetId: "changes-1",
            fileChanges: [
              { file: planFile, additions: 85, deletions: 0, status: "added", diff: BODY },
            ],
          },
          initialState: { unsupported: false, busy: false, expanded: false, reviewing: true },
        }),
      }),
    );

    expect(markup).toContain(BODY_MARKER);
    expect(markup).not.toContain(WEBUI_DIFF_OUTSIDE_WORKSPACE_NOTICE);
  });
});

describe("the workspace review panel shows what is withheld instead of the content", () => {
  const renderSection = (file: WebuiFileDiffInfoView, workspaceDir?: string): string =>
    renderToStaticMarkup(
      createElement(WebuiDiffFileSection, {
        file: projectWebuiDiffFile(file, workspaceDir),
        selected: true,
      }),
    );

  it("shows the body of a file inside the workspace", () => {
    const markup = renderSection(insideFile, WORKSPACE);

    expect(markup).toContain(BODY_MARKER);
    expect(markup).toContain("webui-turn-review-line--addition");
  });

  it("does not render the body of a file outside the workspace", () => {
    const markup = renderSection(outsideFile, WORKSPACE);

    expect(markup).not.toContain(BODY_MARKER);
    expect(markup).not.toContain("webui-turn-review-line--addition");
    expect(markup).toContain(WEBUI_DIFF_OUTSIDE_WORKSPACE_NOTICE);
  });

  it("keeps the file's name and its counts in the section heading", () => {
    const markup = renderSection(outsideFile, WORKSPACE);

    expect(markup).toContain("/etc/outside.conf");
    expect(markup).toContain("+1");
    expect(markup).toContain("-1");
  });

  it("shows the body of a file in the session's own artifacts directory", () => {
    const markup = renderToStaticMarkup(
      createElement(WebuiDiffFileSection, {
        file: projectWebuiDiffFile(
          { file: planFile, additions: 85, deletions: 0, status: "added", diff: BODY },
          WORKSPACE,
          sessionRoots,
        ),
        selected: true,
      }),
    );

    // The body is syntax-highlighted here, so the marker is split
    // across spans: the added line is what says the body was rendered.
    expect(markup).toContain("webui-turn-review-line--addition");
    expect(markup).not.toContain(WEBUI_DIFF_OUTSIDE_WORKSPACE_NOTICE);
  });

  it("offers an explicit file-viewer link for an outside absolute file", () => {
    const markup = renderToStaticMarkup(
      createElement(WebuiDiffFileSection, {
        file: projectWebuiDiffFile(outsideFile, WORKSPACE),
        selected: true,
        onOpenOutsideFile: () => undefined,
      }),
    );

    expect(markup).toContain('data-testid="turn-review-open-outside-file"');
    expect(markup).toContain("在文件查看器中打开");
    expect(markup).not.toContain(BODY_MARKER);
  });
});

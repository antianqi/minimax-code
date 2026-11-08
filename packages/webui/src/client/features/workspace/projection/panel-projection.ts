// What a workspace panel renders: a diff, a todo list, or a preview.
//
// Carved out of `components/workspace/WorkspacePanels.tsx` by Phase 4b: the derivation moves to the
// layer that already owns the concept instead of riding along in the
// component that renders it. What moves is
// **11 declarations**, 6 functions, 5 types and constants they close over.
//
// The text below is the declaration as it stood in the source module — no
// behaviour change.

import {
  projectWebuiWorkspaceHistory,
  type WebuiWorkspaceSubagent,
  type WebuiWorkspaceTodo,
} from "./workspace-progress.js";

export type WebuiTodo = WebuiWorkspaceTodo;

export type WebuiUnifiedDiffLine = {
  readonly kind: "addition" | "context" | "deletion" | "hunk" | "noNewline";
  readonly content: string;
  readonly oldLine?: number;
  readonly newLine?: number;
};

export function projectWebuiUnifiedDiffLines(diff: string): WebuiUnifiedDiffLine[] {
  let oldLine: number | undefined;
  let newLine: number | undefined;
  const lines: WebuiUnifiedDiffLine[] = [];
  for (const raw of diff.split(/\r?\n/u)) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(raw);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      lines.push({ kind: "hunk", content: raw });
      continue;
    }
    if (!raw || raw.startsWith("diff --git ") || raw.startsWith("index ") || raw.startsWith("--- ") || raw.startsWith("+++ ")) continue;
    if (raw.startsWith("\\")) {
      // "\ No newline at end of file" records a fact about the line before it
      // and takes no number of its own. The diff renderer keeps it as its own
      // row with no gutter numbers and neutral text, so it is carried through
      // as a marker instead of dropped.
      lines.push({ kind: "noNewline", content: raw });
      continue;
    }
    if (raw.startsWith("+")) {
      lines.push({ kind: "addition", ...(newLine === undefined ? {} : { newLine: newLine++ }), content: raw.slice(1) });
    } else if (raw.startsWith("-")) {
      lines.push({ kind: "deletion", ...(oldLine === undefined ? {} : { oldLine: oldLine++ }), content: raw.slice(1) });
    } else {
      const content = raw.startsWith(" ") ? raw.slice(1) : raw;
      lines.push({ kind: "context", ...(oldLine === undefined ? {} : { oldLine: oldLine++ }), ...(newLine === undefined ? {} : { newLine: newLine++ }), content });
    }
  }
  return lines;
}

export type WebuiSplitDiffRow =
  | { readonly kind: "hunk"; readonly content: string }
  | { readonly kind: "noNewline"; readonly content: string }
  | { readonly kind: "context"; readonly oldLine: WebuiUnifiedDiffLine; readonly newLine: WebuiUnifiedDiffLine }
  | { readonly kind: "change"; readonly oldLine?: WebuiUnifiedDiffLine; readonly newLine?: WebuiUnifiedDiffLine };

/** Pair each contiguous change block into old and new columns for split review. */
export function projectWebuiSplitDiffRows(lines: readonly WebuiUnifiedDiffLine[]): WebuiSplitDiffRow[] {
  const rows: WebuiSplitDiffRow[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index]!;
    if (line.kind === "hunk" || line.kind === "noNewline") {
      rows.push({ kind: line.kind, content: line.content });
      index += 1;
      continue;
    }
    if (line.kind === "context") {
      rows.push({ kind: "context", oldLine: line, newLine: line });
      index += 1;
      continue;
    }

    const deletions: WebuiUnifiedDiffLine[] = [];
    const additions: WebuiUnifiedDiffLine[] = [];
    while (index < lines.length && (lines[index]?.kind === "deletion" || lines[index]?.kind === "addition")) {
      const changed = lines[index]!;
      if (changed.kind === "deletion") deletions.push(changed);
      else additions.push(changed);
      index += 1;
    }
    for (let changeIndex = 0; changeIndex < Math.max(deletions.length, additions.length); changeIndex += 1) {
      rows.push({
        kind: "change",
        ...(deletions[changeIndex] ? { oldLine: deletions[changeIndex] } : {}),
        ...(additions[changeIndex] ? { newLine: additions[changeIndex] } : {}),
      });
    }
  }
  return rows;
}

export function projectWebuiTodos(messages: readonly Record<string, unknown>[]): WebuiTodo[] {
  return projectWebuiWorkspaceHistory(
    messages as never,
  ).todos as WebuiTodo[];
}

const WORKSPACE_ARCHIVE_EXTENSIONS = [".zip", ".tar", ".tgz", ".gz", ".bz2", ".xz", ".7z", ".rar"] as const;

const WORKSPACE_HTML_EXTENSIONS = [".html", ".htm"] as const;

function hasExtension(path: string, extensions: readonly string[]): boolean {
  const lower = path.toLowerCase();
  return extensions.some((extension) => lower.endsWith(extension));
}

export function isWorkspaceArchivePath(path: string): boolean {
  return hasExtension(path, WORKSPACE_ARCHIVE_EXTENSIONS);
}

export function isWorkspaceHtmlPath(path: string): boolean {
  return hasExtension(path, WORKSPACE_HTML_EXTENSIONS);
}

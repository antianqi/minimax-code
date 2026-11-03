import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { WebuiWorktreePanel } from "../../src/client/features/settings/ui/SettingsModal.js";
import {
  groupWebuiWorktreeWorkspaces,
  selectWebuiWorktreeWorkspaces,
  type WebuiWorktreeSourceSession,
} from "../../src/client/features/sessions/projection/worktree-state.public.js";

/* `renderToStaticMarkup` runs the first render and never runs effects, so the
 * fetching half of this page cannot be asserted here. What this file proves is
 * that the panel renders the grouping it is handed faithfully — in particular
 * that a page with no worktrees says so instead of showing an empty shell, and
 * that a branch's sessions are reachable by the same `#session=` link the rail
 * uses, so there is one navigation path rather than two. */

const main = "C:\\repos\\my-app";
const branchA = "C:\\repos\\my-app\\.worktrees\\feature-a";
const branchB = "C:\\repos\\my-app\\.worktrees\\feature-b";

const session = (
  sessionId: string,
  updatedAt: number,
  extra: Partial<WebuiWorktreeSourceSession> = {},
): WebuiWorktreeSourceSession => ({ sessionId, updatedAt, ...extra });

const panel = (sessions: readonly WebuiWorktreeSourceSession[], props: Record<string, unknown> = {}): string => {
  const workspaces = groupWebuiWorktreeWorkspaces(sessions);
  return renderToStaticMarkup(
    createElement(WebuiWorktreePanel, {
      workspaces,
      worktrees: selectWebuiWorktreeWorkspaces(workspaces),
      ...props,
    } as never),
  );
};

describe("worktree page", () => {
  it("says so plainly when there is no worktree yet", () => {
    const markup = panel([session("s1", 100, { workspaceDir: main, isDefaultWorkspace: true })]);
    expect(markup).toContain('data-webui-worktree-state="empty"');
    expect(markup).toContain('data-testid="worktree-empty"');
    expect(markup).toContain("复制到新工作树");
  });

  /* The point of the row: a project with parallel experiment branches should
   * be able to see them. A page that renders only the primary checkout would
   * be indistinguishable from the empty state. */
  it("lists every worktree alongside the primary checkout", () => {
    const markup = panel([
      session("s1", 100, { workspaceDir: main, isDefaultWorkspace: true, title: "主线" }),
      session("s2", 300, { workspaceDir: branchA, title: "实验 A", parentSessionId: "s1" }),
      session("s4", 250, { workspaceDir: branchA, title: "实验 A 续", parentSessionId: "s1" }),
      session("s3", 200, { workspaceDir: branchB, title: "实验 B", parentSessionId: "s1" }),
    ]);
    expect(markup).toContain('data-webui-worktree-state="ready"');
    expect(markup).toContain('data-testid="worktree-primary"');
    expect(markup).toContain("主线");
    expect(markup).toContain("实验 A");
    expect(markup).toContain("实验 A 续");
    expect(markup).toContain("实验 B");
    expect(markup).toContain("主检出");
    // feature-a holds two sessions and feature-b one, so the per-branch count
    // has to differ between them rather than repeat a single number.
    expect(markup).toContain("2 个会话");
    expect(markup).toContain("1 个会话");
  });

  it("links a branch session through the same hash route the rail uses", () => {
    const markup = panel([
      session("s1", 100, { workspaceDir: main, isDefaultWorkspace: true }),
      session("s2", 300, { workspaceDir: branchA, title: "实验 A" }),
    ]);
    expect(markup).toContain('href="#session=s2"');
    expect(markup).toContain('data-webui-worktree-session="s2"');
  });

  it("marks a session forked from another as derived", () => {
    const markup = panel([
      session("s1", 100, { workspaceDir: main, isDefaultWorkspace: true }),
      session("s2", 300, { workspaceDir: branchA, parentSessionId: "s1" }),
    ]);
    expect(markup).toContain("派生");
    expect(markup).toContain("派生自 s1");
  });

  it("marks a failed load as the error state and leaves the reason to the toast", () => {
    const markup = panel([], { error: "会话列表读取失败" });
    // The state marker is the page's own: it still says which state it is in.
    expect(markup).toContain('data-webui-worktree-state="error"');
    // The reason is an event, not a state: it is said once, through the shared
    // toast, which is drawn over the page (ADR 0030). A server render never sees
    // it, so the page's own layout keeps no trace of it.
    expect(markup).not.toContain("会话列表读取失败");
    expect(markup).not.toContain('data-testid="worktree-error"');
    expect(markup).not.toContain('role="alert"');
    // The page still renders what it can: the frame and the empty state.
    expect(markup).toContain('data-testid="settings-worktree-page"');
    expect(markup).toContain('data-testid="worktree-empty"');
  });

  it("shows the full checkout path so two branches of the same name are distinguishable", () => {
    const markup = panel([
      session("s1", 100, { workspaceDir: main, isDefaultWorkspace: true }),
      session("s2", 300, { workspaceDir: branchA }),
    ]);
    expect(markup).toContain(branchA);
  });
});

/* The load failure is said through the shared toast (ADR 0030). The toast is raised
 * in an effect and drawn over the page, so a server render never sees it: the
 * panel's own source is what pins that the failure is reported at all, and not
 * merely hidden. */
describe("the worktree page reports its load failure through the toast", () => {
  const source = readFileSync(
    new URL("../../src/client/features/settings/ui/SettingsModal.tsx", import.meta.url),
    "utf8",
  );

  it("raises the load failure through the toast, and draws it nowhere in the page", () => {
    expect(source).toContain("useWebuiToastError(");
    expect(source).toContain('testId="worktree-error"');
    // The page itself draws no failure of its own any more.
    expect(source).not.toContain("FeedbackError");
  });
});

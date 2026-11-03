// The shared toast (ADR 0030).
//
// What these cases cover: the queue's decisions — which notice is said once,
// how long a notice lives, when the stack stops growing — and the card's
// contract: the role a notice is announced with, the tone it carries, the
// action it offers, and the one property the whole migration rests on: a
// notice is drawn against the viewport, so it takes no room from the page it
// is about.
//
// The queue's decisions are pure, so they are asserted directly. The card is
// rendered without a DOM runtime (`renderToStaticMarkup`), which is enough for
// the markup; the countdown and the dismissal need a real document and belong
// to the browser suite.

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  createWebuiToastEntry,
  reduceWebuiToasts,
  webuiToastDurationMs,
  webuiToastIdentity,
  WEBUI_TOAST_MAX_VISIBLE,
  type WebuiToastState,
} from "../../src/client/ui/toast-store.js";
import { WebuiToast, WEBUI_TOAST_EXIT_MS } from "../../src/client/ui/toast.js";

const clientRoot = new URL("../../src/client/", import.meta.url);
const toastCss = readFileSync(new URL("styles/toast.css", clientRoot), "utf8");

const render = (element: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(element);

const emptyState: WebuiToastState = { entries: [] };

const entry = (request: Parameters<typeof createWebuiToastEntry>[0], id: string) =>
  createWebuiToastEntry(request, id);

describe("what makes two notices the same notice", () => {
  it("a notice in plain text has an identity", () => {
    const first = webuiToastIdentity("error", "保存失败");
    expect(first).toBeTruthy();
    expect(webuiToastIdentity("error", "保存失败")).toBe(first);
  });

  it("the tone is part of the identity", () => {
    expect(webuiToastIdentity("error", "已保存")).not.toBe(webuiToastIdentity("success", "已保存"));
  });

  it("a notice that is not text has no identity", () => {
    // Two different elements must never collapse into one notice, so a
    // message the client cannot read as text is never treated as a repeat.
    expect(webuiToastIdentity("error", createElement("span", null, "失败"))).toBeUndefined();
  });
});

describe("how long a notice lives", () => {
  it("a notice with an action waits to be answered", () => {
    expect(webuiToastDurationMs("error", true)).toBe(0);
  });

  it("a notice without one is given the time its tone is worth", () => {
    expect(webuiToastDurationMs("success", false)).toBe(3000);
    expect(webuiToastDurationMs("error", false)).toBe(6000);
  });

  it("the caller may say otherwise", () => {
    expect(webuiToastDurationMs("info", false, 1200)).toBe(1200);
    expect(webuiToastDurationMs("info", false, 0)).toBe(0);
  });
});

describe("the queue", () => {
  it("says a repeated notice once, and keeps the card it already had", () => {
    const first = entry({ tone: "success", message: "已保存" }, "webui-toast-1");
    const withFirst = reduceWebuiToasts(emptyState, { type: "show", entry: first });
    const repeated = reduceWebuiToasts(withFirst, {
      type: "show",
      entry: entry({ tone: "success", message: "已保存" }, "webui-toast-2"),
    });
    expect(repeated.entries).toHaveLength(1);
    expect(repeated.entries[0]?.id).toBe("webui-toast-1");
  });

  it("keeps two different notices", () => {
    const first = reduceWebuiToasts(emptyState, {
      type: "show",
      entry: entry({ tone: "success", message: "已保存" }, "webui-toast-1"),
    });
    const second = reduceWebuiToasts(first, {
      type: "show",
      entry: entry({ tone: "error", message: "保存失败" }, "webui-toast-2"),
    });
    expect(second.entries).toHaveLength(2);
  });

  it("does not let the stack grow without a bound", () => {
    let state = emptyState;
    for (let index = 0; index <= WEBUI_TOAST_MAX_VISIBLE; index += 1) {
      state = reduceWebuiToasts(state, {
        type: "show",
        entry: entry({ tone: "info", message: `第 ${index} 条` }, `webui-toast-${index}`),
      });
    }
    const visible = state.entries.filter((each) => each.phase === "visible");
    expect(visible).toHaveLength(WEBUI_TOAST_MAX_VISIBLE);
    // The oldest is the one that leaves: the newest is the one that matters.
    expect(state.entries[0]?.phase).toBe("leaving");
  });

  it("a dismissed notice leaves, and is removed when its animation has finished", () => {
    const shown = reduceWebuiToasts(emptyState, {
      type: "show",
      entry: entry({ tone: "error", message: "保存失败" }, "webui-toast-1"),
    });
    const leaving = reduceWebuiToasts(shown, { type: "leave", id: "webui-toast-1" });
    expect(leaving.entries[0]?.phase).toBe("leaving");
    const removed = reduceWebuiToasts(leaving, { type: "remove", id: "webui-toast-1" });
    expect(removed.entries).toHaveLength(0);
  });
});

describe("the card", () => {
  const card = (request: Parameters<typeof createWebuiToastEntry>[0]) =>
    render(
      createElement(WebuiToast, {
        entry: entry(request, "webui-toast-1"),
        onDismiss: () => undefined,
        onPause: () => undefined,
        onResume: () => undefined,
      }),
    );

  it("an error interrupts, the rest wait their turn", () => {
    expect(card({ tone: "error", message: "保存失败" })).toContain('role="alert"');
    expect(card({ tone: "success", message: "已保存" })).toContain('role="status"');
  });

  it("carries the tone's own class, so the card says which notice it is", () => {
    expect(card({ tone: "error", message: "保存失败" })).toContain("webui-toast--error");
    expect(card({ tone: "success", message: "已保存" })).toContain("webui-toast--success");
  });

  it("says the notice it was given", () => {
    const markup = card({ tone: "error", message: "保存失败", description: "网络不可用" });
    expect(markup).toContain("保存失败");
    expect(markup).toContain("网络不可用");
  });

  it("offers its action, and a way to be dismissed", () => {
    const markup = card({
      tone: "error",
      message: "保存失败",
      action: { label: "重试", onClick: () => undefined },
    });
    expect(markup).toContain("重试");
    expect(markup).toContain('aria-label="关闭"');
  });

  it("arrives and leaves with the shared surface motion", () => {
    const markup = card({ tone: "info", message: "已连接" });
    expect(markup).toContain('data-webui-motion="surface"');
    expect(markup).toContain('data-webui-motion-state="enter"');
  });
});

describe("a notice takes no room from the page", () => {
  it("the stack is drawn against the viewport", () => {
    const host = toastCss.slice(toastCss.indexOf(".webui-toast-host"), toastCss.indexOf(".webui-toast {"));
    expect(host).toContain("position: fixed");
    // The column is not a click target: only the cards are, so the stack never
    // swallows a press that was meant for the page underneath it.
    expect(host).toContain("pointer-events: none");
  });

  it("the exit animation and the unmount read the same number", () => {
    // The card is unmounted when the animation that fades it out has finished,
    // so the two numbers have to be the same one.
    expect(WEBUI_TOAST_EXIT_MS).toBe(120);
  });
});
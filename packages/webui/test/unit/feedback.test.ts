// The feedback family's contract (#292, ADR 0028 § Shared contracts).
//
// Each state's claim is an ARIA claim, which a rendered string can show: a
// progressbar carries a value and a range, a busy indicator carries none, an error
// is announced once and is addressable afterwards, an announcement has no visual
// form at all, and an empty state is a state rather than a live message.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  FeedbackAnnouncement,
  FeedbackBusy,
  FeedbackEmpty,
  FeedbackError,
  FeedbackProgress,
  FeedbackSkeleton,
  WebuiSpinner,
} from "../../src/client/ui/feedback.js";

const render = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

describe("determinate and indeterminate are different things", () => {
  it("a progress bar reports its value and its range", () => {
    const html = render(createElement(FeedbackProgress, { label: "上传", value: 30, max: 120 }));
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="30"');
    expect(html).toContain('aria-valuemax="120"');
    expect(html).toContain('aria-valuetext="25%"');
    expect(html).toContain('aria-label="上传"');
    expect(html).toContain("webui-motion-progress");
  });

  it("keeps surface track and fill styling while the shared component owns motion", () => {
    const html = render(createElement(FeedbackProgress, {
      label: "5 小时限额",
      value: 42,
      className: "w-full",
      trackClassName: "bg-bg_interaction_tertiary_press",
      fillClassName: "bg-text_default_primary",
    }));
    expect(html).toContain("webui-feedback-progress-track bg-bg_interaction_tertiary_press");
    expect(html).toContain("webui-feedback-progress-fill webui-motion-progress bg-text_default_primary");
    expect(html).toContain('aria-valuenow="42"');
  });

  it("a busy indicator reports no value at all", () => {
    const html = render(createElement(FeedbackBusy, { label: "正在保存" }));
    expect(html).toContain('role="status"');
    expect(html).toContain("正在保存");
    expect(html).not.toContain("progressbar");
    expect(html).not.toContain("aria-valuenow");
    expect(html).toContain('class="webui-feedback-spinner"');
  });

  it("the shared spinner owns its motion and supports the rail scale", () => {
    const regular = render(createElement(WebuiSpinner, {}));
    const compact = render(createElement(WebuiSpinner, { size: "compact", className: "webui-rail-spinner" }));
    expect(regular).toBe('<span aria-hidden="true" class="webui-feedback-spinner"></span>');
    expect(compact).toBe('<span aria-hidden="true" class="webui-feedback-spinner webui-feedback-spinner--compact webui-rail-spinner"></span>');
  });

  it("clamps a value the caller got wrong instead of announcing nonsense", () => {
    const over = render(createElement(FeedbackProgress, { label: "x", value: 240, max: 100 }));
    expect(over).toContain('aria-valuenow="100"');
    const under = render(createElement(FeedbackProgress, { label: "x", value: -5 }));
    expect(under).toContain('aria-valuenow="0"');
  });
});

describe("an announcement is not a visual state", () => {
  it("an empty state is not announced", () => {
    const html = render(createElement(FeedbackEmpty, { title: "暂无内容" }));
    expect(html).toContain("暂无内容");
    expect(html).not.toContain("aria-live");
    expect(html).not.toContain('role="status"');
  });

  it("an announcement has no visual class and lives in a live region", () => {
    const html = render(createElement(FeedbackAnnouncement, { message: "已复制" }));
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain("webui-feedback-sr");
    expect(html).not.toContain("webui-feedback-title");
  });

  it("an error is announced once and stays addressable afterwards", () => {
    const html = render(createElement(FeedbackError, { message: "保存失败", id: "save-error" }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('id="save-error"');
    // One announcement: an alert is already a live region, so a second one here
    // would announce the same message twice.
    expect((html.match(/aria-live/gu) ?? []).length).toBe(0);
  });
});

describe("loading says so without reading out the decoration", () => {
  it("a skeleton hides its shape and announces its label once", () => {
    const html = render(createElement(FeedbackSkeleton, { label: "正在加载", rows: 2 }));
    expect(html).toContain('role="status"');
    expect(html).toContain("正在加载");
    expect(html).toContain('aria-hidden="true"');
    // Two rows drawn, and the drawn part is outside the announced region.
    const announced = /role="status"[^>]*>([\s\S]*?)<\/p>/u.exec(html)?.[1] ?? "";
    expect(announced).not.toContain("skeleton-row");
  });
});

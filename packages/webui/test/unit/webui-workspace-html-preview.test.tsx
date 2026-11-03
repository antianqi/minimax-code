// Unit tests for the workspace HTML preview.
//
// Rendering goes through `renderToStaticMarkup` (the project's SSR test
// convention, see `test/unit/workspace-panel-state.test.ts`). It does not run
// effects, so these assert on emitted markup and attributes: the iframe's
// `src`/`title`, the states that must render *instead of* a frame, and — the
// assertions that actually protect the feature — the absence of a second
// sandbox layer and of any inlined document.
//
// A refusal is said through the toast, which an effect draws into
// `document.body`, so it is never in the markup: the refusal is pinned by
// what the layout does not carry, and by the component's own source.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceHtmlPreview } from "../../src/client/features/workspace/ui/WorkspaceHtmlPreview.js";
import { hasRelativeDocumentReference } from "../../src/client/features/workspace/projection/html-preview.js";

const FILE_URL = "http://127.0.0.1:8787/workspace-file?dir=%2Frepo&path=index.html&token=t0ken";

/**
 * The preview's own source.
 *
 * A refusal is said through the toast, which is raised in an effect and drawn
 * into `document.body`, so a server render never carries it. Reading the
 * source is how the refusal is pinned as *reported* rather than merely hidden.
 */
const htmlPreviewSource = readFileSync(
  new URL("../../src/client/features/workspace/ui/WorkspaceHtmlPreview.tsx", import.meta.url),
  "utf8",
);

function render(props: { fileUrl?: string; content?: { readonly type: "text" | "binary"; readonly content: string; readonly mimeType?: string } }): string {
  return renderToStaticMarkup(<WorkspaceHtmlPreview path="site/index.html" fileUrl={props.fileUrl ?? FILE_URL} content={props.content} />);
}

describe("workspace HTML preview", () => {
  it("frames the file at its own URL and titles the frame for assistive tech", () => {
    const markup = render({ content: { type: "text", content: "<h1>hi</h1>", mimeType: "text/html" } });

    expect(markup).toContain("<iframe");
    // The `&` in the query is escaped by React, so this also pins the exact
    // URL the frame is pointed at.
    expect(markup).toContain('src="http://127.0.0.1:8787/workspace-file?dir=%2Frepo&amp;path=index.html&amp;token=t0ken"');
    expect(markup).toContain('title="HTML 预览：index.html"');
  });

  it("leaves the isolation to the server header instead of adding a second layer", () => {
    const markup = render({ content: { type: "text", content: "<script>window.top.location</script>", mimeType: "text/html" } });

    // A second sandbox on the iframe cannot be relaxed later without an edit
    // here, and hides which layer is actually holding.
    expect(markup).not.toContain("sandbox");
    // `srcdoc` would inherit the WebUI's own policy, discarding the server's.
    expect(markup).not.toContain("srcdoc");
    expect(markup).not.toContain("data:text/html");
  });

  it("never inlines the document it frames", () => {
    const markup = render({ content: { type: "text", content: "<h1>secret heading</h1><script>steal()</script>", mimeType: "text/html" } });

    expect(markup).not.toContain("secret heading");
    expect(markup).not.toContain("steal()");
    expect(markup).toContain("<iframe");
  });

  it("refuses a .html file whose bytes the runtime does not report as text/html, through the toast", () => {
    const markup = render({ content: { type: "text", content: "key = 1", mimeType: "text/plain" } });

    // The refusal is said once, as a toast: the layout carries no notice, and
    // the preview area itself now renders nothing.
    expect(markup).not.toContain("<iframe");
    expect(markup).not.toContain('role="alert"');
    expect(markup).not.toContain("text/plain");
    expect(markup).toBe("");
    // And the refusal is reported, not merely hidden: the heading became the
    // toast's message and the body its description.
    expect(htmlPreviewSource).toContain("useWebuiToastError(");
    expect(htmlPreviewSource).toContain("不作为 HTML 预览打开");
    expect(htmlPreviewSource).toContain("运行时报告的类型是 ${mimeType}");
  });

  it("accepts a text/html mime that carries a charset parameter", () => {
    expect(render({ content: { type: "text", content: "<p>ok</p>", mimeType: "TEXT/HTML; charset=utf-8" } })).toContain("<iframe");
  });

  it("states the missing URL instead of rendering an empty frame", () => {
    const markup = render({ fileUrl: "" });

    expect(markup).not.toContain("<iframe");
    expect(markup).toContain('data-testid="workspace-html-preview-unavailable"');
    expect(markup).toContain("无法预览 HTML");
  });

  it("shows something while the frame loads and never an unexplained empty frame", () => {
    const markup = render({ content: { type: "text", content: "<p>ok</p>", mimeType: "text/html" } });

    expect(markup).toContain('data-testid="workspace-html-preview-status"');
    expect(markup).toContain("正在加载 HTML 预览");
  });

  it("warns about relative references the opaque origin cannot resolve", () => {
    const relative = render({ content: { type: "text", content: '<link href="style.css"><img src="logo.png">', mimeType: "text/html" } });
    const absolute = render({ content: { type: "text", content: '<img src="https://cdn.example.com/logo.png"><a href="#top">top</a>', mimeType: "text/html" } });

    expect(relative).toContain("检测到文档引用了相对路径资源");
    expect(relative).toContain('data-testid="workspace-html-preview-isolation-note"');
    // Undetectable is not the same as absent, so the limitation stays stated.
    expect(absolute).not.toContain("检测到文档引用了相对路径资源");
    expect(absolute).toContain("相对路径资源会解析到文件接口");
    // Nothing about the document is re-written to work around it.
    expect(relative).not.toContain("<link");
  });

  it("detects relative references, including root-relative ones the route also misses", () => {
    expect(hasRelativeDocumentReference('<img src="logo.png">')).toBe(true);
    expect(hasRelativeDocumentReference('<link href="style.css" rel="stylesheet">')).toBe(true);
    expect(hasRelativeDocumentReference("<video poster='poster.png'></video>")).toBe(true);
    expect(hasRelativeDocumentReference('<img srcset="logo.png 1x, logo@2x.png 2x">')).toBe(true);
    expect(hasRelativeDocumentReference("<div style=\"background: url(bg.png)\"></div>")).toBe(true);
    // Root-relative resolves against the route, not the file's directory.
    expect(hasRelativeDocumentReference('<img src="/logo.png">')).toBe(true);

    expect(hasRelativeDocumentReference('<img src="https://cdn.example.com/logo.png">')).toBe(false);
    expect(hasRelativeDocumentReference('<img src="data:image/png;base64,AAA">')).toBe(false);
    expect(hasRelativeDocumentReference('<a href="#section">jump</a>')).toBe(false);
    expect(hasRelativeDocumentReference('<a href="//cdn.example.com/x">jump</a>')).toBe(false);
    expect(hasRelativeDocumentReference("<h1>plain text</h1>")).toBe(false);
  });

  it("offers the same URL as a plain navigation, without an opener handle", () => {
    const markup = render({ content: { type: "text", content: "<p>ok</p>", mimeType: "text/html" } });

    expect(markup).toContain('href="http://127.0.0.1:8787/workspace-file?dir=%2Frepo&amp;path=index.html&amp;token=t0ken"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noreferrer noopener"');
    expect(markup).not.toContain("window.open");
  });
});

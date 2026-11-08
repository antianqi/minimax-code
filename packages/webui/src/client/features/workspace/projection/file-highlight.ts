// Which languages this client can highlight, and the one place a line becomes
// highlighted markup.
//
// The extension → language table and the grammar registry used to sit in two
// different modules: the table in `panel-projection.ts`, the registration at
// module scope in `WorkspacePanels.tsx`. `webuiFileLanguage` consults
// `hljs.getLanguage(name)` to reject a language it cannot render, so the table
// was answering "typescript" only while some *other* module happened to have
// been imported first. Importing the projection alone answered `undefined` for
// every path. The two halves are one decision and live together here.
//
// The diff section and the file preview ask this module; neither carries a
// grammar list or a `try`/`catch` around highlighting of its own.

import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import typescript from "highlight.js/lib/languages/typescript";
import toml from "highlight.js/lib/languages/ini";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const FILE_CODE_LANGUAGES = {
  bash,
  c,
  cpp,
  css,
  go,
  java,
  javascript,
  json,
  markdown,
  python,
  rust,
  typescript,
  toml,
  xml,
  yaml,
} as const;

for (const [name, language] of Object.entries(FILE_CODE_LANGUAGES)) {
  if (!hljs.getLanguage(name)) hljs.registerLanguage(name, language);
}

const FILE_LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  c: "c", cjs: "javascript", cpp: "cpp", css: "css", go: "go", h: "c", htm: "xml", html: "xml", java: "java",
  js: "javascript", json: "json", jsx: "javascript", md: "markdown", mjs: "javascript", mts: "typescript",
  py: "python", rs: "rust", sh: "bash", svg: "xml", toml: "toml", ts: "typescript", tsx: "typescript", xml: "xml", yaml: "yaml", yml: "yaml",
};

/** The grammar this client can highlight `path` with, or `undefined` for a file
 *  it has no grammar for — the callers then render plain text. */
export function webuiFileLanguage(path: string): string | undefined {
  const extension = path.split(".").at(-1)?.toLowerCase();
  const language = extension ? FILE_LANGUAGE_BY_EXTENSION[extension] : undefined;
  return language && hljs.getLanguage(language) ? language : undefined;
}

/**
 * One line of source as highlighted markup, or `undefined` when the line is not
 * to be highlighted — no language, no grammar, or a grammar that threw on this
 * input. The callers treat `undefined` as "render the text as it is", so a
 * highlighting failure degrades to plain source rather than to a blank line.
 */
export function highlightFileLine(line: string, language: string | undefined): string | undefined {
  if (!language || !hljs.getLanguage(language)) return undefined;
  try {
    return hljs.highlight(line, { language, ignoreIllegals: true }).value;
  } catch {
    return undefined;
  }
}

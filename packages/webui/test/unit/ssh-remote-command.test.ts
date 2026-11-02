/**
 * The commands the remote side is asked to run.
 *
 * These are shell scripts, and a script the shell refuses to parse is a feature that never
 * works: the far side answers with a syntax error, and the browser shows that error as the
 * reason the listing failed. The check is the shell's own parser — `sh -n` reads a script and
 * refuses it when it does not parse, and runs none of it.
 *
 * The directory listing is checked against a real directory as well, so the shape of its
 * answer is pinned and not only its syntax.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildRemoteDirectoryListCommand,
  buildRemoteProbeCommand,
  buildRemoteTerminalCommand,
  SSH_DIRECTORY_MARKER,
} from "../../src/runtime/ssh/command.js";

const directories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "webui-ssh-command-"));
  directories.push(directory);
  return directory;
}

/** Whether the shell can parse the script. Nothing in it runs. */
function parses(script: string): { readonly ok: boolean; readonly message: string } {
  const result = spawnSync("sh", ["-n"], { input: script, encoding: "utf8" });
  return { ok: result.status === 0, message: (result.stderr ?? "").trim() };
}

afterEach(() => {
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe("the remote commands", () => {
  it.skipIf(process.platform === "win32")("are scripts the shell can parse", () => {
    const scripts = [
      buildRemoteDirectoryListCommand("/root/project"),
      buildRemoteProbeCommand(),
      buildRemoteTerminalCommand("/root/project"),
    ];
    for (const script of scripts) {
      const parsed = parses(script);
      expect(parsed.message).toBe("");
      expect(parsed.ok).toBe(true);
    }
  });

  it.skipIf(process.platform === "win32")("joins the directory listing with newlines, not semicolons", () => {
    // A shell block needs its own line. `do;` is a syntax error, and it is the one error a
    // remote listing cannot recover from.
    const script = buildRemoteDirectoryListCommand("/root");
    expect(script).not.toContain("do;");
    expect(script).not.toContain("then;");
    expect(script).toContain("\ndo\n");
  });

  it.skipIf(process.platform === "win32")("names the root's entries with one slash", () => {
    // The root is "/". A glob of "//*" would name every entry "//name" — a path that is not
    // the one it names, and one the browser then walks into.
    const script = buildRemoteDirectoryListCommand("/");
    const result = spawnSync("sh", ["-c", script], { encoding: "utf8" });
    expect(result.status).toBe(0);
    const markerIndex = result.stdout.indexOf(SSH_DIRECTORY_MARKER);
    expect(markerIndex).toBeGreaterThanOrEqual(0);
    const fields = result.stdout
      .slice(markerIndex + SSH_DIRECTORY_MARKER.length)
      .split(String.fromCharCode(0))
      .filter((field) => field.length > 0);
    expect(fields[0]).toBe("status=ready");
    expect(fields[1]).toBe("path=/");
    const entries = fields.slice(2);
    for (let index = 1; index < entries.length; index += 2) {
      expect(entries[index]).not.toMatch(/^\/\//u);
    }
  });

  it.skipIf(process.platform === "win32")("lists a directory in the shape the reader expects", () => {
    const root = temporaryDirectory();
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "readme.md"), "hello");
    const script = buildRemoteDirectoryListCommand(root);
    const result = spawnSync("sh", ["-c", script], { encoding: "utf8" });
    expect(result.status).toBe(0);

    const markerIndex = result.stdout.indexOf(SSH_DIRECTORY_MARKER);
    expect(markerIndex).toBeGreaterThanOrEqual(0);
    const fields = result.stdout
      .slice(markerIndex + SSH_DIRECTORY_MARKER.length)
      .split(String.fromCharCode(0))
      .filter((field) => field.length > 0);
    expect(fields[0]).toBe("status=ready");
    expect(fields[1]).toBe(`path=${root}`);
    // The entries follow as a kind and a path, one pair each — the reader walks them two at
    // a time.
    const entries = fields.slice(2);
    expect(entries.length).toBeGreaterThanOrEqual(4);
    const pairs: string[] = [];
    for (let index = 0; index + 1 < entries.length; index += 2) {
      pairs.push(`${entries[index]} ${entries[index + 1]}`);
    }
    expect(pairs).toContain(`directory ${path.join(root, "src")}`);
    expect(pairs).toContain(`file ${path.join(root, "readme.md")}`);
  });
});

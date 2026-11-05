// The extension package the person downloads.
//
// The browser will not install an extension for the person: a store install
// needs their own click, and an unpacked install needs developer mode and a
// folder they pick. What the host can do is make sure the package they get is
// the one this build produces — a stale extension is the failure that reads
// like a network timeout and costs an afternoon.
//
// The package is a zip of the unpacked extension, because that is what the
// person hands the browser, and because a store build is a zip too.

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export interface WebuiBrowserExtensionPackageOptions {
  /**
   * The extension package directory, when this host carries the sources.
   *
   * The sources are what make the package the latest one: the build is redone
   * when a source is newer than what was built.
   */
  readonly packageDir?: string;
  /**
   * A directory that already holds a built extension.
   *
   * A host that ships the build rather than the sources points here.
   */
  readonly builtDir?: string;
  /**
   * Where a temporary archive may be written.
   *
   * The archive is temporary: it is read into memory and removed, so nothing
   * is left behind for the next download to trip over.
   */
  readonly scratchDir?: string;
}

export interface WebuiBrowserExtensionArchive {
  /** The name the download carries, version included. */
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

/** The extension build this host can offer, as a downloadable archive. */
export class WebuiBrowserExtensionPackage {
  constructor(private readonly options: WebuiBrowserExtensionPackageOptions) {}

  /**
   * The archive, or `undefined` when this host carries no extension.
   *
   * `undefined` is the honest answer for a host with nothing to offer: an
   * empty archive would be a package the person cannot install.
   */
  async archive(): Promise<WebuiBrowserExtensionArchive | undefined> {
    const built = await this.#builtDirectory();
    if (!built) return undefined;
    const version = await readExtensionVersion(built);
    const fileName = `minimax-code-browser-extension-${version}.zip`;
    const bytes = await zipDirectory(built, fileName, this.options.scratchDir);
    return bytes ? { fileName, bytes } : undefined;
  }

  /** The directory holding the built extension, after making sure it is current. */
  async #builtDirectory(): Promise<string | undefined> {
    const { packageDir, builtDir } = this.options;
    if (packageDir) {
      await ensureCurrentBuild(packageDir);
      const built = path.join(packageDir, "dist");
      return (await exists(path.join(built, "manifest.json"))) ? built : undefined;
    }
    if (builtDir) {
      return (await exists(path.join(builtDir, "manifest.json"))) ? builtDir : undefined;
    }
    return undefined;
  }
}

/**
 * Rebuild the extension when a source is newer than the build.
 *
 * The build is what the person downloads, so a build older than the sources
 * is exactly the stale extension this whole thing exists to prevent.
 */
async function ensureCurrentBuild(packageDir: string): Promise<void> {
  const builtManifest = path.join(packageDir, "dist", "manifest.json");
  const builtAt = await mtimeOf(builtManifest);
  const sourceAt = await newestMtime([
    path.join(packageDir, "src"),
    path.join(packageDir, "scripts"),
    path.join(packageDir, "manifest.json"),
  ]);
  if (builtAt !== undefined && (sourceAt === undefined || builtAt >= sourceAt)) return;
  await runBuild(packageDir);
}

/** Run the extension's own build script, in its own package directory. */
async function runBuild(packageDir: string): Promise<void> {
  const script = path.join(packageDir, "scripts", "build.mjs");
  if (!(await exists(script))) {
    throw new Error("The browser extension has no build script to run.");
  }
  const code = await run(process.execPath, [script], packageDir);
  if (code !== 0) {
    throw new Error(`The browser extension build failed (exit ${code}).`);
  }
}

/**
 * Zip a directory with the `zip` tool.
 *
 * The tool is the mature implementation of the format, and the extension's
 * own build already packs a store zip with it: a second zip writer here would
 * be a second answer to the same question.
 */
async function zipDirectory(
  directory: string,
  fileName: string,
  scratchDir: string | undefined,
): Promise<Uint8Array | undefined> {
  // The scratch directory is the host's, and a host may hand us one it has not
  // created yet: a packaged host derives it from its data directory, which on a
  // fresh machine does not exist until something writes there. Creating it here
  // is what makes the first download work rather than the second.
  const scratchParent = scratchDir ?? tmpdir();
  await mkdir(scratchParent, { recursive: true });
  const scratch = await mkdtemp(path.join(scratchParent, "webui-extension-"));
  const archivePath = path.join(scratch, fileName);
  try {
    const code = await run("zip", ["-r", "-q", archivePath, "."], directory);
    if (code !== 0) return undefined;
    return await readFile(archivePath);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** The version the built extension declares, or a placeholder it lacks. */
async function readExtensionVersion(builtDir: string): Promise<string> {
  try {
    const manifest = JSON.parse(
      await readFile(path.join(builtDir, "manifest.json"), "utf8"),
    ) as { version?: unknown };
    return typeof manifest.version === "string" && manifest.version.trim()
      ? manifest.version.trim()
      : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** The newest modification time under the given paths. */
async function newestMtime(paths: readonly string[]): Promise<number | undefined> {
  let newest: number | undefined;
  for (const target of paths) {
    const at = await mtimeOf(target);
    if (at === undefined) continue;
    if (newest === undefined || at > newest) newest = at;
  }
  return newest;
}

/** The modification time of a file, or of the newest file under a directory. */
async function mtimeOf(target: string): Promise<number | undefined> {
  try {
    const stats = await stat(target);
    if (stats.isFile()) return stats.mtimeMs;
    if (!stats.isDirectory()) return undefined;
    let newest: number | undefined;
    for (const entry of await readdir(target, { withFileTypes: true })) {
      const at = await mtimeOf(path.join(target, entry.name));
      if (at === undefined) continue;
      if (newest === undefined || at > newest) newest = at;
    }
    return newest;
  } catch {
    return undefined;
  }
}

/** Whether a path exists. */
async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/** Run a command and answer with its exit code. */
function run(command: string, args: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { cwd, stdio: "ignore" });
    child.on("error", () => resolve(-1));
    child.on("close", (code) => resolve(code ?? -1));
  });
}

import { chmodSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

/** node-pty 1.1.0 ships its macOS prebuilt spawn-helper without execute bits. */
export function prepareWebuiPtyHelper(
  moduleRoot: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): void {
  if (platform !== "darwin") return;
  const helpers = [
    path.join(moduleRoot, "build/Release/spawn-helper"),
    path.join(moduleRoot, `prebuilds/darwin-${arch}/spawn-helper`),
  ].filter((filename) => existsSync(filename));
  if (helpers.length === 0) throw new Error(`node-pty spawn-helper is missing: ${moduleRoot}`);
  for (const filename of helpers) {
    const mode = statSync(filename).mode;
    if ((mode & 0o111) !== 0o111) chmodSync(filename, mode | 0o111);
  }
}

export function loadWebuiPty(): typeof import("node-pty") {
  prepareWebuiPtyHelper(path.dirname(require.resolve("node-pty/package.json")));
  return require("node-pty") as typeof import("node-pty");
}

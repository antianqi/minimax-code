import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { WebuiBrowserExtensionPackage } from "../../src/server/browser-bridge/extension-package.js";
import { WebuiService } from "../../src/server/service.js";
import { createOperationRegistry } from "../../src/server/operation/operations.js";
import type { WebuiHarnessPort } from "../../src/runtime/port.js";

/** A scratch directory this test may write into. */
function scratch(): string {
  return mkdtempSync(path.join(tmpdir(), "webui-extension-package-"));
}

/** A built extension, as the extension's own build leaves it. */
function builtExtension(root: string): string {
  const built = path.join(root, "dist");
  mkdirSync(path.join(built, "background"), { recursive: true });
  writeFileSync(
    path.join(built, "manifest.json"),
    JSON.stringify({ name: "MiniMax Code Browser Bridge", version: "0.1.0" }),
  );
  writeFileSync(path.join(built, "background", "service-worker.js"), "// worker\n");
  return built;
}

/** A build script that stands in for the extension's own. */
function standInBuildScript(packageDir: string): void {
  mkdirSync(path.join(packageDir, "scripts"), { recursive: true });
  writeFileSync(
    path.join(packageDir, "scripts", "build.mjs"),
    [
      "import { mkdirSync, writeFileSync } from 'node:fs';",
      "const root = new URL('../', import.meta.url);",
      "mkdirSync(new URL('dist/background', root), { recursive: true });",
      "writeFileSync(new URL('dist/manifest.json', root), JSON.stringify({ name: 'MiniMax Code Browser Bridge', version: '0.1.0' }));",
      "writeFileSync(new URL('dist/background/service-worker.js', root), '// worker\\n');",
      "writeFileSync(new URL('build-count.txt', root), 'built\\n');",
    ].join("\n"),
  );
}

/** Sets a path's modification time, so "newer" is a fact and not a race. */
function setMtime(target: string, secondsAgo: number): void {
  const when = new Date(Date.now() - secondsAgo * 1000);
  utimesSync(target, when, when);
}

const token = "test-token";

const services: WebuiService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
});

/** A service that answers the extension download route. */
async function serve(
  browserExtensionPackage?: WebuiBrowserExtensionPackage,
  dev = true,
): Promise<string> {
  const port = {
    version: () => ({ dataDir: "C:/data" }),
    close: async () => {},
  } as unknown as WebuiHarnessPort;
  const service = new WebuiService({
    port,
    operations: createOperationRegistry(port),
    credential: { token },
    dev,
    ...(browserExtensionPackage ? { browserExtensionPackage } : {}),
  });
  services.push(service);
  const info = await service.start();
  return `http://${info.host}:${info.tcpPort}`;
}

describe("the browser extension package", () => {
  it("offers the built extension as a zip", async () => {
    const root = scratch();
    const built = builtExtension(root);

    const archive = await new WebuiBrowserExtensionPackage({
      builtDir: built,
      scratchDir: root,
    }).archive();

    expect(archive).toBeDefined();
    // The name carries the version, because two packages that differ only in
    // their version are two packages a person has to tell apart.
    expect(archive?.fileName).toBe("minimax-code-browser-extension-0.1.0.zip");
    // A zip: the local file header signature, and the entry names in the clear.
    expect([...(archive?.bytes ?? [])].slice(0, 4)).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const text = Buffer.from(archive?.bytes ?? []).toString("latin1");
    expect(text).toContain("manifest.json");
    expect(text).toContain("background/service-worker.js");
  });

  it("has nothing to offer when this host carries no extension", async () => {
    const archive = await new WebuiBrowserExtensionPackage({ scratchDir: scratch() }).archive();

    // A host with no extension says so rather than serving an empty package.
    expect(archive).toBeUndefined();
  });

  it("builds the extension again when the sources are newer than the build", async () => {
    const root = scratch();
    const packageDir = path.join(root, "browser-extension");
    mkdirSync(path.join(packageDir, "src"), { recursive: true });
    // The build comes first, so the source below is the newer of the two.
    builtExtension(packageDir);
    standInBuildScript(packageDir);
    writeFileSync(path.join(packageDir, "src", "service-worker.ts"), "// source\n");
    setMtime(path.join(packageDir, "src", "service-worker.ts"), 0);
    setMtime(path.join(packageDir, "scripts", "build.mjs"), 0);
    setMtime(path.join(packageDir, "dist", "manifest.json"), 60);

    const archive = await new WebuiBrowserExtensionPackage({
      packageDir,
      scratchDir: root,
    }).archive();

    expect(archive).toBeDefined();
    // The rebuild is what makes the package the latest one: the build script
    // leaves its own mark, and the mark is only there if it ran.
    expect(existsSync(path.join(packageDir, "build-count.txt"))).toBe(true);
    const manifest = JSON.parse(
      readFileSync(path.join(packageDir, "dist", "manifest.json"), "utf8"),
    ) as { name?: string };
    expect(manifest.name).toBe("MiniMax Code Browser Bridge");
  });

  it("keeps the build it already has when the sources have not moved", async () => {
    const root = scratch();
    const packageDir = path.join(root, "browser-extension");
    mkdirSync(path.join(packageDir, "src"), { recursive: true });
    standInBuildScript(packageDir);
    // The source is written before the build, so the build is the newer one.
    writeFileSync(path.join(packageDir, "src", "service-worker.ts"), "// source\n");
    builtExtension(packageDir);
    setMtime(path.join(packageDir, "src", "service-worker.ts"), 60);
    setMtime(path.join(packageDir, "scripts", "build.mjs"), 60);
    setMtime(path.join(packageDir, "dist", "manifest.json"), 0);

    const archive = await new WebuiBrowserExtensionPackage({
      packageDir,
      scratchDir: root,
    }).archive();

    expect(archive).toBeDefined();
    // No rebuild: a build that is already current is not redone.
    expect(existsSync(path.join(packageDir, "build-count.txt"))).toBe(false);
  });
});

describe("the browser extension download route", () => {
  it("serves the package as a download", async () => {
    const root = scratch();
    const url = await serve(
      new WebuiBrowserExtensionPackage({ builtDir: builtExtension(root), scratchDir: root }),
    );

    const response = await fetch(`${url}/browser-extension`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/zip");
    // The name carries the version, because the person has to tell two
    // packages apart when one of them is the stale one.
    expect(response.headers.get("content-disposition")).toContain(
      "minimax-code-browser-extension-0.1.0.zip",
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("says so when this host carries no extension", async () => {
    const url = await serve();

    const response = await fetch(`${url}/browser-extension`);

    // A refusal, not an empty package: an empty zip is a package nobody can
    // install, and it reads like a download that worked.
    expect(response.status).toBe(404);
  });

  it("keeps the package behind the credential", async () => {
    const root = scratch();
    const url = await serve(
      new WebuiBrowserExtensionPackage({ builtDir: builtExtension(root), scratchDir: root }),
      false,
    );

    const refused = await fetch(`${url}/browser-extension`);
    expect(refused.status).toBe(401);

    // The credential is what the person holds, and the same request with it
    // answers.
    const admitted = await fetch(`${url}/browser-extension?token=${token}`);
    expect(admitted.status).toBe(200);
  });
});

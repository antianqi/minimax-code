/**
 * The SSH stores: one committed answer, and a refused one.
 *
 * Two claims, both about a store file that more than one writer can reach:
 *
 *   * **A save is a transaction, not a blind write.** Two saves that start from the same snapshot
 *     are serialized: the second one sees the first one's commit instead of replacing it. The
 *     file's atomic rename said nothing about this — it only promised that a reader never sees a
 *     half-written file, not that the second writer read what the first one wrote.
 *   * **A document that cannot be read is refused, not replaced.** Invalid JSON, a version this
 *     build does not know, and a record missing a field are all reported as `storage_unavailable`
 *     with the bytes on disk left exactly as they were. The old behaviour turned each of them into
 *     an empty list that the next save overwrote.
 *
 * The cross-process claim is measured against a real second process: a child holds the sibling
 * lock file, and the parent's commit cannot land until that process releases it.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { rename } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

import {
  createSshConnectionRepository,
  sshConnectionStorePath,
} from "../../src/runtime/ssh/connection-repository.js";
import {
  createSshProjectRepository,
  sshProjectStorePath,
} from "../../src/runtime/ssh/project-repository.js";
import { SshRuntimeError } from "../../src/runtime/ssh/errors.js";

const directories: string[] = [];

function temporaryDataDir(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "webui-ssh-store-"));
  directories.push(directory);
  return directory;
}

function write(pathname: string, content: unknown): void {
  mkdirSync(path.dirname(pathname), { recursive: true });
  writeFileSync(pathname, typeof content === "string" ? content : `${JSON.stringify(content)}\n`);
}

function host(alias: string) {
  return {
    alias,
    displayName: alias.toUpperCase(),
    endpoint: { kind: "manual" as const, host: `${alias}.example.com` },
    enabled: true,
    status: "idle" as const,
  };
}

afterEach(() => {
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe("the SSH connection store", () => {
  it("excludes a stale final rename when a legacy lease is lost during commit", async () => {
    const file = sshConnectionStorePath(temporaryDataDir());
    write(file, { version: 1, revision: 0, connections: [] });
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let resume!: () => void;
    let paused!: () => void;
    const entered = new Promise<void>((resolve) => { paused = resolve; });
    const release = new Promise<void>((resolve) => { resume = resolve; });
    vi.mocked(rename).mockImplementationOnce(async (...args) => {
      paused();
      await release;
      return actual.rename(...args);
    });
    const first = createSshConnectionRepository(file).save(host("first")).then(
      () => undefined, (error: unknown) => error,
    );
    await entered;
    // 旧租约被抢走时，最终 rename 仍然挂起；新锁必须覆盖这个窗口。
    rmSync(`${file}.lock`, { recursive: true, force: true });
    const loader = createRequire(import.meta.url).resolve("tsx");
    const child = spawn(process.execPath, ["--import", loader, "--input-type=module", "-e", `
      const { createRequire } = await import('node:module');
      const require = createRequire(process.cwd() + '/package.json');
      const Database = require('better-sqlite3');
      const db = new Database(process.argv[1] + '.transaction.sqlite', { timeout: 0 });
      let blocked = false;
      try { db.exec('BEGIN IMMEDIATE'); db.exec('ROLLBACK'); }
      catch (error) { if (error.code !== 'SQLITE_BUSY') throw error; blocked = true; }
      db.close();
      process.send({ blocked });
      const { createSshConnectionRepository } = await import(${JSON.stringify(new URL("../../src/runtime/ssh/connection-repository.ts", import.meta.url).href)});
      await createSshConnectionRepository(process.argv[1]).save({ alias: 'second', displayName: 'Second', endpoint: { kind: 'manual', host: 'second.example' }, enabled: true, status: 'idle' });
      process.disconnect();
    `, file], { stdio: ["ignore", "ignore", "pipe", "ipc"], env: { ...process.env, TSX_TSCONFIG_PATH: path.resolve("tsconfig.standalone.json") } });
    let stderr = "";
    child.stderr!.on("data", (value) => { stderr += String(value); });
    const probe = new Promise<boolean>((resolve, reject) => {
      child.once("message", (value) => resolve((value as { blocked: boolean }).blocked));
      child.once("error", reject);
    });
    const done = new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr)));
    });
    try {
      const blocked = await probe;
      // 旧实现允许第二个 writer 先提交，随后第一份旧快照覆盖它。
      if (!blocked) await done;
      resume();
      const firstError = await first;
      await done;
      expect((await createSshConnectionRepository(file).list()).map((record) => record.alias).sort()).toEqual(["first", "second"]);
      expect(firstError).toBeUndefined();
      expect(blocked).toBe(true);
    } finally {
      resume();
      if (child.exitCode === null) child.kill();
    }
  }, 15_000);

  it.each([undefined, "old-writer"])("accepts legacy v1 revision %s in both stores", async (revision) => {
    const dir = temporaryDataDir();
    const hostFile = sshConnectionStorePath(dir);
    const projectFile = sshProjectStorePath(dir);
    write(hostFile, { version: 1, ...(revision === undefined ? {} : { revision }), connections: [host("legacy")] });
    write(projectFile, { version: 1, ...(revision === undefined ? {} : { revision }), projects: [{ id: "old", alias: "legacy", path: "/old", displayName: "Old" }] });
    const hosts = createSshConnectionRepository(hostFile);
    const projects = createSshProjectRepository(projectFile);
    expect((await hosts.list())[0]?.alias).toBe("legacy");
    expect((await projects.list())[0]?.id).toBe("old");
    await hosts.save(host("new"));
    await projects.save({ id: "new", alias: "legacy", path: "/new", displayName: "New" });
    expect((await hosts.list()).map((record) => record.alias).sort()).toEqual(["legacy", "new"]);
    expect((await projects.list()).map((record) => record.id).sort()).toEqual(["new", "old"]);
    expect(JSON.parse(readFileSync(hostFile, "utf8")).revision).toBe(1);
    expect(JSON.parse(readFileSync(projectFile, "utf8")).revision).toBe(1);
  });

  it("preserves unknown document, host, project and nested endpoint fields across mutations", async () => {
    const dir = temporaryDataDir();
    const hostFile = sshConnectionStorePath(dir);
    const projectFile = sshProjectStorePath(dir);
    const extra = { future: ["value", { nested: true }] };
    write(hostFile, { version: 1, revision: 0, extension: extra, connections: [{ ...host("kept"), extension: extra, endpoint: { ...host("kept").endpoint, extension: extra } }] });
    write(projectFile, { version: 1, revision: 0, extension: extra, projects: [{ id: "kept", alias: "kept", path: "/kept", displayName: "Kept", extension: extra }] });
    const hosts = createSshConnectionRepository(hostFile);
    const projects = createSshProjectRepository(projectFile);
    const verify = () => {
      const rawHost = JSON.parse(readFileSync(hostFile, "utf8"));
      const rawProject = JSON.parse(readFileSync(projectFile, "utf8"));
      expect(rawHost.extension).toEqual(extra);
      expect(rawHost.connections.find((record: { alias: string }) => record.alias === "kept")).toMatchObject({ extension: extra, endpoint: { extension: extra } });
      expect(rawProject.extension).toEqual(extra);
      expect(rawProject.projects.find((record: { id: string }) => record.id === "kept").extension).toEqual(extra);
    };
    await hosts.save(host("other"));
    await projects.save({ id: "other", alias: "other", path: "/other", displayName: "Other" });
    verify();
    await hosts.setEnabled("kept", true, "idle");
    verify();
    const target = (await hosts.getProbeTarget("kept"))!;
    await hosts.commitProbe({ alias: "kept", probedEndpoint: target.record.endpoint, identityRevision: target.identityRevision, status: "connected" });
    verify();
    await hosts.save({ ...host("kept"), displayName: "Renamed" });
    await projects.save({ id: "kept", alias: "kept", path: "/renamed", displayName: "Renamed" });
    verify();
    await hosts.remove("other");
    await projects.removeByHost("other");
    verify();
    expect(await hosts.get("kept")).not.toHaveProperty("extension");
    expect((await hosts.get("kept"))?.endpoint).not.toHaveProperty("extension");
    expect(await projects.get("kept")).not.toHaveProperty("extension");
  });
  it("serializes complete host and project mutations from independent processes", async () => {
    const dataDir = temporaryDataDir();
    const hostPath = sshConnectionStorePath(dataDir);
    const projectPath = sshProjectStorePath(dataDir);
    const hosts = createSshConnectionRepository(hostPath);
    const projects = createSshProjectRepository(projectPath);
    await hosts.save(host("switch"));
    await hosts.save(host("doomed"));
    await projects.save({ id: "old", alias: "doomed", path: "/old", displayName: "Old" });
    const loader = createRequire(import.meta.url).resolve("tsx");
    const script = `
      const { createSshConnectionRepository } = await import(${JSON.stringify(new URL("../../src/runtime/ssh/connection-repository.ts", import.meta.url).href)});
      const { createSshProjectRepository } = await import(${JSON.stringify(new URL("../../src/runtime/ssh/project-repository.ts", import.meta.url).href)});
      const hosts = createSshConnectionRepository(process.argv[1]);
      const projects = createSshProjectRepository(process.argv[2]);
      const alias = process.argv[3];
      const start = new Promise(resolve => process.once('message', resolve));
      process.send('ready');
      await start;
      await hosts.save({ alias, displayName: alias, endpoint: { kind: 'manual', host: alias + '.example' }, enabled: true, status: 'idle' });
      await hosts.setEnabled('switch', false, 'disabled');
      await hosts.remove('doomed');
      await projects.save({ id: alias, alias, path: '/' + alias, displayName: alias });
      await projects.removeByHost('doomed');
      process.disconnect();
    `;
    const children = Array.from({ length: 4 }, (_, index) => {
      const child = spawn(process.execPath, ["--import", loader, "--input-type=module", "-e", script, hostPath, projectPath, `child-${index}`], { stdio: ["ignore", "pipe", "pipe", "ipc"], env: { ...process.env, TSX_TSCONFIG_PATH: path.resolve("tsconfig.standalone.json") } });
      let stderr = "";
      child.stderr!.on("data", (data) => { stderr += String(data); });
      const ready = new Promise<void>((resolve, reject) => {
        child.once("message", () => resolve()); child.once("error", reject);
        child.once("exit", (code) => { if (code) reject(new Error(stderr)); });
      });
      const exited = new Promise<void>((resolve, reject) => {
        child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr)));
      });
      return { child, ready, exited };
    });
    try {
      await Promise.all(children.map(({ ready }) => ready));
      for (const { child } of children) child.send("start");
      await Promise.all(children.map(({ exited }) => exited));
    } finally {
      for (const { child } of children) if (child.exitCode === null) child.kill();
    }
    const reopened = await createSshConnectionRepository(hostPath).list();
    expect(reopened.map((record) => record.alias).sort()).toEqual(["child-0", "child-1", "child-2", "child-3", "switch"]);
    expect(reopened.find((record) => record.alias === "switch")).toMatchObject({ enabled: false, status: "disabled" });
    expect((await createSshProjectRepository(projectPath).list()).map((record) => record.id).sort()).toEqual(["child-0", "child-1", "child-2", "child-3"]);
  }, 15_000);

  it.each([
    ["corrupt", "{bad"],
    ["future", { version: 99, revision: 1, projects: [] }],
    ["malformed", { version: 1, revision: 1, projects: [{ id: "bad", alias: "build", path: 42, displayName: "Bad" }] }],
  ])("preserves %s project bytes on every mutation", async (_name, document) => {
    const storePath = sshProjectStorePath(temporaryDataDir());
    write(storePath, document);
    const bytes = readFileSync(storePath, "utf8");
    const repository = createSshProjectRepository(storePath);
    await expect(repository.list()).rejects.toMatchObject({ code: "storage_unavailable" });
    for (const mutate of [() => repository.save({ alias: "build", path: "/new", displayName: "New" }), () => repository.remove("bad"), () => repository.removeByHost("build")]) {
      await expect(mutate()).rejects.toMatchObject({ code: "storage_unavailable" });
      expect(readFileSync(storePath, "utf8")).toBe(bytes);
    }
  });

  it.each([
    { kind: "manual" }, { kind: "manual", host: "-bad" }, { kind: "manual", host: "ok", port: 70000 },
    { kind: "ssh_config", alias: "-bad" }, { kind: "unknown", host: "ok" },
  ])("refuses malformed endpoint %j without replacing it", async (endpoint) => {
    const storePath = sshConnectionStorePath(temporaryDataDir());
    write(storePath, { version: 1, revision: 1, connections: [{ ...host("bad"), endpoint }] });
    const bytes = readFileSync(storePath, "utf8");
    const repository = createSshConnectionRepository(storePath);
    await expect(repository.list()).rejects.toMatchObject({ code: "storage_unavailable" });
    await expect(repository.save(host("new"))).rejects.toMatchObject({ code: "storage_unavailable" });
    await expect(repository.setEnabled("bad", false, "disabled")).rejects.toMatchObject({ code: "storage_unavailable" });
    expect(readFileSync(storePath, "utf8")).toBe(bytes);
  });
  it("keeps every one of a burst of saves that started from the same empty store", async () => {
    const dataDir = temporaryDataDir();
    const repository = createSshConnectionRepository(sshConnectionStorePath(dataDir));

    // Every save reads the store before it writes. Without a transaction they all read the same
    // empty store and the last rename wins; with one, each save sees the previous commit.
    const aliases = Array.from({ length: 12 }, (_, index) => `host-${index}`);
    await Promise.all(aliases.map((alias) => repository.save(host(alias))));

    const reopened = createSshConnectionRepository(sshConnectionStorePath(dataDir));
    const stored = await reopened.list();
    expect(stored.map((record) => record.alias).sort()).toEqual([...aliases].sort());
    // One revision per commit, so the count says the writes were applied one after another.
    const raw = JSON.parse(readFileSync(sshConnectionStorePath(dataDir), "utf8")) as {
      revision: number;
    };
    expect(raw.revision).toBe(aliases.length);
  });

  it("keeps a removal and a save of another host that ran at the same time", async () => {
    const dataDir = temporaryDataDir();
    const repository = createSshConnectionRepository(sshConnectionStorePath(dataDir));
    await repository.save(host("doomed"));
    await repository.save(host("kept"));

    const [removed, saved] = await Promise.all([
      repository.remove("doomed"),
      repository.save(host("added")),
    ]);

    expect(removed).toBe(true);
    expect(saved.alias).toBe("added");
    const stored = await createSshConnectionRepository(sshConnectionStorePath(dataDir)).list();
    expect(stored.map((record) => record.alias).sort()).toEqual(["added", "kept"]);
  });

  it("keeps a project save and a host-wide project removal that ran at the same time", async () => {
    const dataDir = temporaryDataDir();
    const repository = createSshProjectRepository(sshProjectStorePath(dataDir));
    await repository.save({ alias: "old", path: "/srv/old", displayName: "old" });

    await Promise.all([
      repository.removeByHost("old"),
      repository.save({ alias: "new", path: "/srv/new", displayName: "new" }),
    ]);

    const stored = await createSshProjectRepository(sshProjectStorePath(dataDir)).list();
    expect(stored.map((project) => project.alias)).toEqual(["new"]);
  });

  it("waits for another process's lock before it commits", async () => {
    const dataDir = temporaryDataDir();
    const storePath = sshConnectionStorePath(dataDir);
    mkdirSync(path.dirname(storePath), { recursive: true });
    const lockPath = `${storePath}.transaction.sqlite`;

    // A real second process takes the same lock this store writes, and holds it.
    const holder = spawn(
      process.execPath,
      [
        "-e",
        [
          "const Database = require('better-sqlite3');",
          "(async () => {",
          "  const database = new Database(process.argv[1]); database.exec('BEGIN IMMEDIATE');",
          "  process.stdout.write('held\\n');",
          "  await new Promise((resolve) => setTimeout(resolve, 400));",
          "  database.exec('ROLLBACK'); database.close();",
          "})();",
        ].join("\n"),
        lockPath,
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    const exited = new Promise<void>((resolve, reject) => {
      holder.once("error", reject);
      holder.once("exit", () => resolve());
    });
    await new Promise<void>((resolve, reject) => {
      holder.once("error", reject);
      holder.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString("utf8").includes("held")) resolve();
      });
    });

    const repository = createSshConnectionRepository(storePath);
    const started = Date.now();
    await repository.save(host("contended"));
    const elapsed = Date.now() - started;

    // The commit could not land while the other process held the lock. A process-local queue
    // would have finished immediately: the lock is the only thing that can know about it.
    expect(elapsed).toBeGreaterThanOrEqual(300);
    await exited;
    expect((await repository.list()).map((record) => record.alias)).toEqual(["contended"]);
    // SQLite 锁文件保留稳定 inode；释放的是 OS 写锁。
    const Database = createRequire(import.meta.url)("better-sqlite3");
    const probe = new Database(lockPath, { timeout: 0 });
    try { expect(() => probe.exec("BEGIN IMMEDIATE")).not.toThrow(); }
    finally { probe.close(); }
  }, 15_000);

  it("reports a corrupt document instead of returning an empty list", async () => {
    const dataDir = temporaryDataDir();
    const storePath = sshConnectionStorePath(dataDir);
    write(storePath, "{ this is not json");
    const bytes = readFileSync(storePath, "utf8");

    const repository = createSshConnectionRepository(storePath);
    await expect(repository.list()).rejects.toBeInstanceOf(SshRuntimeError);
    await expect(repository.save(host("new"))).rejects.toMatchObject({
      code: "storage_unavailable",
      message: expect.stringContaining("connections.json"),
    });
    // The unreadable bytes are still the file: a refusal that overwrites them is not a refusal.
    expect(readFileSync(storePath, "utf8")).toBe(bytes);
  });

  it("reports a version it does not know and leaves the document alone", async () => {
    const dataDir = temporaryDataDir();
    const storePath = sshConnectionStorePath(dataDir);
    write(storePath, {
      version: 99,
      revision: 4,
      connections: [
        {
          alias: "future",
          displayName: "Future",
          endpoint: { kind: "manual", host: "future.example.com" },
          enabled: true,
          status: "idle",
        },
      ],
    });
    const bytes = readFileSync(storePath, "utf8");

    const repository = createSshConnectionRepository(storePath);
    await expect(repository.get("future")).rejects.toMatchObject({
      code: "storage_unavailable",
      message: expect.stringContaining("版本"),
    });
    await expect(repository.remove("future")).rejects.toMatchObject({
      code: "storage_unavailable",
    });
    expect(readFileSync(storePath, "utf8")).toBe(bytes);
  });

  it("refuses a record that is missing a field instead of handing it on as typed", async () => {
    const dataDir = temporaryDataDir();
    const storePath = sshConnectionStorePath(dataDir);
    // `endpoint` has a kind but no host, and `enabled` is not a boolean: the old guard accepted
    // an alias plus a non-null endpoint object and returned this as a complete host.
    write(storePath, {
      version: 1,
      revision: 2,
      connections: [
        {
          alias: "half",
          displayName: "Half",
          endpoint: { kind: "manual" },
          enabled: "yes",
          status: "idle",
        },
      ],
    });
    const bytes = readFileSync(storePath, "utf8");

    const repository = createSshConnectionRepository(storePath);
    await expect(repository.list()).rejects.toMatchObject({
      code: "storage_unavailable",
      message: expect.stringContaining("enabled"),
    });
    expect(readFileSync(storePath, "utf8")).toBe(bytes);
  });

  it("treats a file that is not there as nothing saved yet", async () => {
    const dataDir = temporaryDataDir();
    const repository = createSshConnectionRepository(sshConnectionStorePath(dataDir));

    expect(await repository.list()).toEqual([]);
    expect(await repository.get("nothing")).toBeUndefined();
    const saved = await repository.save(host("first"));
    expect(saved.alias).toBe("first");
    expect(await repository.list()).toHaveLength(1);
  });

  it("refuses an incomplete project document", async () => {
    const dataDir = temporaryDataDir();
    const storePath = sshProjectStorePath(dataDir);
    write(storePath, {
      version: 1,
      revision: 1,
      projects: [{ id: "p-1", alias: "build" }],
    });
    const bytes = readFileSync(storePath, "utf8");

    const repository = createSshProjectRepository(storePath);
    await expect(repository.list()).rejects.toMatchObject({
      code: "storage_unavailable",
      message: expect.stringContaining("path"),
    });
    expect(readFileSync(storePath, "utf8")).toBe(bytes);
  });
});

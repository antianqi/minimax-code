import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as pty from "node-pty";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

import { WebuiService } from "../../src/server/service.js";
import { createOperationRegistry } from "../../src/server/operation/operations.js";
import { createHarnessPortFromHost } from "../../src/runtime/harness/adapter.js";
import { createSshAdapter } from "../../src/runtime/harness/ssh.js";
import type { WebuiRuntimeHostHandle } from "../../src/runtime/harness/host-contract.js";
import { createSshRuntime } from "../../src/runtime/ssh/index.js";
import { SSH_PROBE_MARKER } from "../../src/runtime/ssh/command.js";
import type { SshTransport, SshTerminalProcess } from "../../src/runtime/ssh/transport.js";
import { createWebuiRemoteControl } from "../../src/runtime/remote-control/owner.js";
import { DeviceIdentityStore } from "../../src/runtime/remote-control/bridge/device-identity.js";
import { createWebuiRuntimeLifecycle } from "../../src/runtime/lifecycle.js";
import { createWebuiRuntimeHost } from "../../src/runtime/assembly.js";
import { resetDefaultLocalRuntimeConfig } from "@mavis/local-runtime-v2";
import { RemoteControlProxy } from "../../src/runtime/remote-control/bridge/index.js";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function dataDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "rc-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
function host(dir: string, onSubscribe = () => {}, onRelease = () => {}): WebuiRuntimeHostHandle {
  return {
    dataDir: dir, apiHost: { close: async () => {} },
    getAuthCredential: async () => ({ accessToken: "synthetic", realUserID: "42" }),
    cliService: {
      async *watchEvents(signal: AbortSignal) {
        onSubscribe();
        try {
          await new Promise<void>((resolve) => {
            if (signal.aborted) resolve();
            else signal.addEventListener("abort", () => resolve(), { once: true });
          });
        } finally { onRelease(); }
      },
    },
  } as unknown as WebuiRuntimeHostHandle;
}

describe("remote resource lifetime through the production seams", () => {
  it.each(["assembly", "standalone"] as const)("shares deferred disposal success and failure through %s", async (route) => {
    for (const fail of [false, true]) {
      const dir = dataDir();
      vi.stubEnv("MINIMAX_DATA_DIR", dir);
      vi.stubEnv("DISABLE_GIT_AUTO_CONFIG", "1");
      resetDefaultLocalRuntimeConfig();
      const gate = deferred<void>();
      const calls: string[] = [];
      const disposeError = new Error("remote disposal failed");
      const hostError = new Error("host close failed");
      const disconnect = vi.spyOn(RemoteControlProxy.prototype, "disconnect").mockImplementationOnce(async () => {
        calls.push("remote");
        await gate.promise;
      });
      const closeHost = async () => { calls.push("host"); if (fail) throw hostError; };
      const assembled = route === "assembly" ? await createWebuiRuntimeHost({
        dataDir: dir,
        mcodeTools: { prepare: async () => ({ requested: false, ready: false, category: "disabled" as const, ensureCommandPath: () => undefined, dispose: async () => { calls.push("broker"); } }) },
        factory: async () => ({ apiHost: { close: closeHost }, dataDir: dir, cliService: host(dir).cliService }),
      }) : undefined;
      const port = assembled?.harnessPort ?? createHarnessPortFromHost({ ...host(dir), apiHost: { close: closeHost } });
      await port.getRemoteControlStatus();
      const first = port.close();
      const second = port.close();
      const outcomes = Promise.allSettled([first, second]);
      await vi.waitFor(() => expect(calls).toEqual(["remote"]));
      let settled = false;
      void outcomes.then(() => { settled = true; });
      await Promise.resolve();
      expect(settled).toBe(false);
      if (fail) gate.reject(disposeError); else gate.resolve();
      const result = await outcomes;
      expect(result.map((value) => value.status)).toEqual(fail ? ["rejected", "rejected"] : ["fulfilled", "fulfilled"]);
      if (fail) {
        const errors = result.map((value) => (value as PromiseRejectedResult).reason);
        expect(errors[0]).toBe(errors[1]);
        expect(errors[0]).toBeInstanceOf(AggregateError);
        expect(errors[0].errors).toEqual([disposeError, hostError]);
        await expect(port.close()).rejects.toBe(errors[0]);
      } else await port.close();
      expect(calls).toEqual(route === "assembly" ? ["remote", "host", "broker"] : ["remote", "host"]);
      expect(disconnect).toHaveBeenCalledTimes(1);
      disconnect.mockRestore();
      resetDefaultLocalRuntimeConfig();
      vi.unstubAllEnvs();
    }
  });
  it.each(["idle", "unbound"] as const)("cannot start fallback pairing after deferred connect returns %s beyond dispose", async (phase) => {
    vi.useFakeTimers();
    const entered = deferred<void>();
    const reply = deferred<{ phase: typeof phase }>();
    vi.spyOn(RemoteControlProxy.prototype, "connect").mockImplementationOnce(() => { entered.resolve(); return reply.promise; });
    const pairing = vi.spyOn(RemoteControlProxy.prototype, "requestPairingCode");
    const fetcher = vi.fn(async () => json({ pairing_code: "1234", expires_in_s: 300 }));
    const owner = createWebuiRemoteControl({ host: host(dataDir()), logger, fetchImpl: fetcher });
    cleanup.push(() => owner.dispose());
    const pending = owner.connect({});
    await entered.promise;
    await owner.dispose();
    reply.resolve({ phase });
    expect((await pending).phase).toBe("error");
    expect(pairing).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("captures replay and live SSH output once, in order, before the next pull", async () => {
    let emit!: (value: string) => void;
    const process: SshTerminalProcess = {
      onData(listener) { emit = listener; }, onExit() {}, write() {}, resize() {}, kill() {},
    };
    const runtime = await createSshRuntime({ dataDir: dataDir(), transport: {
      run: async () => ({ stdout: SSH_PROBE_MARKER, stderr: "", code: 0, timedOut: false }),
      spawnTerminal: () => process,
    } });
    cleanup.push(() => runtime.dispose());
    await runtime.connections.save({ alias: "build", endpoint: { kind: "manual", host: "synthetic.invalid" } });
    const { session } = await runtime.terminals.open({ alias: "build" });
    emit("one"); emit("two");
    const stop = new AbortController();
    const iterator = runtime.terminals.watch(session.terminalId, stop.signal)[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual({ data: "one" });
    emit("live");
    expect((await iterator.next()).value).toEqual({ data: "two" });
    expect((await iterator.next()).value).toEqual({ data: "live" });
    const parked = iterator.next();
    stop.abort();
    expect(await parked).toEqual({ done: true, value: undefined });
    expect(runtime.terminals.write(session.terminalId, "still alive")).toBe(true);
  });

  it.each(["ssh", "remote"] as const)("wakes a quiet %s stream on a real socket detach", async (kind) => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ binding: { state: "none" } })));
    const subscribed = deferred<void>();
    const released = deferred<void>();
    const handle = host(dataDir(), () => subscribed.resolve(), () => released.resolve());
    const port = createHarnessPortFromHost(handle);
    let terminalId = "";
    let terminalAlive = false;
    if (kind === "ssh") {
      // Real local PTY, controlled instead of making an external SSH connection.
      const transport: SshTransport = {
        run: async () => ({ stdout: SSH_PROBE_MARKER, stderr: "", code: 0, timedOut: false }),
        spawnTerminal: (_args, dimensions) => {
          const child = pty.spawn("/bin/sh", ["-c", "printf READY; cat"], { ...dimensions, name: "xterm", env: process.env });
          terminalAlive = true;
          child.onExit(() => { terminalAlive = false; });
          return { write: (value) => child.write(value), resize: (cols, rows) => child.resize(cols, rows), kill: () => child.kill(), onData: (listener) => { child.onData(listener); }, onExit: (listener) => { child.onExit(({ exitCode }) => listener({ code: exitCode })); } };
        },
      };
      const runtime = await createSshRuntime({ dataDir: dataDir(), transport });
      cleanup.push(() => runtime.dispose());
      await runtime.connections.save({ alias: "local", endpoint: { kind: "manual", host: "synthetic.invalid" } });
      terminalId = (await runtime.terminals.open({ alias: "local" })).session.terminalId;
      const watch = runtime.terminals.watch.bind(runtime.terminals);
      runtime.terminals.watch = async function* (id, signal) {
        subscribed.resolve();
        try { yield* watch(id, signal); } finally { released.resolve(); }
      };
      Object.assign(port, createSshAdapter(handle, { runtime }));
    }
    const service = new WebuiService({ port, operations: createOperationRegistry(port), credential: { token: "synthetic-lifetime" } });
    cleanup.push(() => service.close());
    const info = await service.start();
    const socket = new WebSocket(`ws://127.0.0.1:${info.tcpPort}/?token=${info.credential.token}`);
    cleanup.push(() => { socket.terminate(); });
    await once(socket, "open");
    const initial = new Promise<void>((resolve) => socket.on("message", (raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.kind === "event" && frame.requestId === "quiet") resolve();
    }));
    socket.send(JSON.stringify({ kind: "request", protocolVersion: info.protocolVersion, requestId: "quiet", operation: kind === "ssh" ? "watchSshTerminal" : "watchRemoteControlStatus", body: kind === "ssh" ? { terminalId } : {} }));
    await subscribed.promise;
    await initial;
    socket.close();
    await once(socket, "close");
    await released.promise;
    if (kind === "ssh") expect(terminalAlive).toBe(true);
  }, 5000);

  it.each(["confirmed", "rejected"] as const)("does not settle B using A's %s response", async (outcome) => {
    const dir = dataDir();
    const store = new DeviceIdentityStore(path.join(dir, "remote-control/state.json"));
    store.setBinding(17, "42");
    store.beginPendingUnbind({ requestId: "A", userId: "42", bindingId: 17 });
    store.clearPendingUnbind();
    store.beginPendingUnbind({ requestId: "B", userId: "42", bindingId: 17 });
    const owner = createWebuiRemoteControl({ host: host(dir), logger,
      fetchImpl: async () => json({ pairing_code: "1234", expires_in_s: 300 }),
    });
    cleanup.push(() => owner.dispose());
    await owner.connect({ requestCode: true });
    const result = await owner.resolveUnbind({ requestId: "A", confirmed: outcome === "confirmed" });
    expect(result).toEqual({ success: false, error: "The unbind request is no longer pending" });
    expect(await owner.getPendingUnbind()).toMatchObject({ requestId: "B" });
    expect(new DeviceIdentityStore(path.join(dir, "remote-control/state.json")).ensure().binding_id).toBe(17);
    expect(await owner.resolveUnbind({ requestId: "B", confirmed: outcome === "confirmed" })).toEqual({ success: true });
    expect(await owner.getPendingUnbind()).toBeNull();
    expect(new DeviceIdentityStore(path.join(dir, "remote-control/state.json")).ensure().binding_id).toBe(outcome === "confirmed" ? undefined : 17);
  });

  it("aborts pending binding HTTP and refuses a late reconnect on host shutdown", async () => {
    vi.useFakeTimers();
    const response = deferred<Response>();
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn((_input: unknown, init?: RequestInit) => { requestSignal = init?.signal ?? undefined; return response.promise; });
    vi.stubGlobal("fetch", fetcher);
    const lifecycle = createWebuiRuntimeLifecycle({ disposeAuth() {}, disposeMcodeTools: async () => {} });
    const handle = host(dataDir());
    lifecycle.registerHostClose(handle.apiHost.close);
    const port = createHarnessPortFromHost({ ...handle, registerShutdownResource: lifecycle.registerShutdownResource });
    await port.getRemoteControlStatus();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(requestSignal?.aborted).toBe(false);
    await lifecycle.close();
    expect(requestSignal?.aborted).toBe(true);
    response.resolve(json({ binding: { state: "bound", binding_id: 88, ticket: "late", endpoint: "wss://synthetic.invalid" } }));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await expect(port.getRemoteControlStatus()).rejects.toThrow();
    await port.close();
  });

  it("closes a pending proxy socket and its subscriptions when disposed", async () => {
    vi.useFakeTimers();
    const opened = deferred<void>();
    const close = vi.fn();
    const sockets = vi.fn(() => {
      opened.resolve();
      return { readyState: 0, on() {}, send() {}, close };
    });
    const handle = host(dataDir());
    const owner = createWebuiRemoteControl({ host: handle, logger, wsFactory: sockets,
      fetchImpl: async () => json({ binding: { state: "none" } }),
    });
    const pending = owner.applyCredentials({ bindingId: 17, ticket: "synthetic", endpoint: "wss://synthetic.invalid" });
    await opened.promise;
    await owner.dispose();
    await owner.dispose();
    await pending;
    expect(close).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cannot start pairing after a credential refresh completes beyond disposal", async () => {
    const auth = deferred<{ accessToken: string; realUserID: string }>();
    const entered = deferred<void>();
    const fetcher = vi.fn(async () => json({ pairing_code: "1234", expires_in_s: 300 }));
    const owner = createWebuiRemoteControl({
      host: { ...host(dataDir()), getAuthCredential: () => { entered.resolve(); return auth.promise; } },
      logger, fetchImpl: fetcher,
    });
    const pending = owner.connect({ requestCode: true });
    await entered.promise;
    await owner.dispose();
    auth.resolve({ accessToken: "synthetic", realUserID: "42" });
    expect((await pending).phase).toBe("error");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("attempts all registered releases and the host close after a release failure", async () => {
    const calls: string[] = [];
    const lifecycle = createWebuiRuntimeLifecycle({ disposeAuth() { calls.push("auth"); }, disposeMcodeTools: async () => { calls.push("broker"); } });
    lifecycle.registerHostClose(async () => { calls.push("host"); });
    lifecycle.registerShutdownResource(async () => { calls.push("first"); throw new Error("synthetic release failure"); });
    lifecycle.registerShutdownResource(async () => { calls.push("second"); });
    await expect(lifecycle.close()).rejects.toThrow("synthetic release failure");
    expect(calls).toEqual(["first", "second", "auth", "host", "broker"]);
    await expect(lifecycle.close()).rejects.toThrow("synthetic release failure");
    expect(calls).toHaveLength(5);
  });
});

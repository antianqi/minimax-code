import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebuiMiniAppWorkflows } from "../../src/client/features/miniapp/application/miniapp-workflows.js";
import { createWebuiChannelOwner } from "../../src/client/features/channel/application/channel-owner.js";
import { createWebuiMiniAppPresenterCoordinator } from "../../src/client/application/miniapp-presenter.js";
import type { WebuiMiniAppCatalogue, WebuiMiniAppPresentationIntent } from "../../src/shared/contracts/miniapp.js";
import type { WebuiChannelConnection } from "../../src/shared/contracts/channel.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const catalogue = (detached = false, stopped = false): WebuiMiniAppCatalogue => ({ miniApps: [{
  pluginId: "app", displayName: "App", detached, presentationRevision: 0,
  runtime: { kind: "process", status: stopped ? "stopped" : "running" },
}] });

function miniapp() {
  let listing = catalogue();
  const list = vi.fn(async () => listing);
  const open = vi.fn(async () => ({ pluginId: "app", viewUrl: "/app", connection: 1 }));
  const owner = createWebuiMiniAppWorkflows({ port: {
    listMiniApps: list, openMiniApp: open, stopMiniApp: async () => ({ success: true }),
  } });
  return { owner, list, open, listing: (next: WebuiMiniAppCatalogue) => { listing = next; } };
}

afterEach(() => { vi.useRealTimers(); });

describe("Mini App reader interests (scripted capability, real owner)", () => {
  it("reads one catalogue per observation while multiple inline views wait for leases", async () => {
    vi.useFakeTimers();
    const { owner, list, listing, open } = miniapp();
    listing({ miniApps: [...catalogue(true).miniApps, { ...catalogue(true).miniApps[0]!, pluginId: "other" }] });
    owner.acquirePresentation("app", false);
    owner.acquirePresentation("other", false);
    owner.acquireListing("launcher");
    await vi.advanceTimersByTimeAsync(0);
    expect(list).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(list).toHaveBeenCalledTimes(3);
    expect(open).not.toHaveBeenCalled();
    owner.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cannot create a reconnect grace timer when the first confirmation returns after disposal", async () => {
    vi.useFakeTimers();
    const { owner, list, listing, open } = miniapp();
    await owner.open("app");
    const newer = { miniApps: catalogue().miniApps.map((row) => ({ ...row, presentationRevision: 1 })) };
    listing(newer);
    await owner.loadListing();
    const pending = deferred<WebuiMiniAppCatalogue>();
    list.mockImplementationOnce(() => pending.promise);
    const refreshing = owner.refreshInline("app");
    owner.dispose();
    expect(vi.getTimerCount()).toBe(0);
    pending.resolve(newer);
    // Flush the delayed read without advancing timers: creating a grace timer is itself the defect.
    await Promise.resolve();
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
    await refreshing;
    expect(list).toHaveBeenCalledTimes(3);
    expect(open).toHaveBeenCalledTimes(1);
  });
  it("shares launcher refreshes, preserves catalogue-only freshness, suspends and disposes", async () => {
    vi.useFakeTimers();
    const { owner, list } = miniapp();
    const catalogueReader = owner.acquireListing("catalogue");
    const launcher = owner.acquireListing("launcher");
    const otherLauncher = owner.acquireListing("launcher");
    await vi.advanceTimersByTimeAsync(0);
    expect(list).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(list).toHaveBeenCalledTimes(2);
    launcher(); launcher();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(list).toHaveBeenCalledTimes(3);
    otherLauncher();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(list).toHaveBeenCalledTimes(3);
    owner.refreshInterested();
    await vi.advanceTimersByTimeAsync(0);
    expect(list).toHaveBeenCalledTimes(4);
    owner.setSuspended(true);
    owner.refreshInterested();
    expect(list).toHaveBeenCalledTimes(4);
    owner.setSuspended(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(list).toHaveBeenCalledTimes(5);
    catalogueReader();
    owner.dispose();
    owner.refreshInterested();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never overlaps a slow listing and cannot publish after disposal", async () => {
    vi.useFakeTimers();
    const pending = deferred<WebuiMiniAppCatalogue>();
    const { owner, list } = miniapp();
    list.mockImplementationOnce(() => pending.promise);
    owner.acquireListing("launcher");
    owner.acquireListing("catalogue");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(list).toHaveBeenCalledTimes(1);
    owner.dispose();
    const snapshot = owner.getSnapshot();
    pending.resolve(catalogue());
    await vi.advanceTimersByTimeAsync(0);
    expect(owner.getSnapshot()).toBe(snapshot);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("coalesces a lease read with catalogue consumers", async () => {
    const { owner, list, open } = miniapp();
    const pending = deferred<WebuiMiniAppCatalogue>();
    list.mockImplementationOnce(() => pending.promise);
    const lease = owner.presentInline("app");
    const listing = owner.loadListing();
    expect(list).toHaveBeenCalledTimes(1);
    pending.resolve(catalogue(true));
    expect(await lease).toBe("waiting");
    await listing;
    expect(open).not.toHaveBeenCalled();
    owner.dispose();
  });

  it("waits for the standalone lease, stops on a terminal runtime and only reopens on command", async () => {
    vi.useFakeTimers();
    const { owner, listing, open } = miniapp();
    listing(catalogue(true));
    const first = owner.acquirePresentation("app", false);
    const second = owner.acquirePresentation("app", false);
    await vi.advanceTimersByTimeAsync(0);
    expect(open).not.toHaveBeenCalled();
    first();
    listing(catalogue(false, true));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(owner.getSnapshot().presentations.app?.kind).toBe("stopped");
    listing(catalogue());
    await vi.advanceTimersByTimeAsync(4_000);
    expect(open).not.toHaveBeenCalled();
    await owner.open("app");
    expect(open).toHaveBeenCalledTimes(1);
    expect(owner.getSnapshot().presentations.app?.kind).toBe("open");
    second();
    expect(vi.getTimerCount()).toBe(0);
    owner.dispose();
  });

  it("drops released lease reads, and late opens cannot overwrite a stop", async () => {
    vi.useFakeTimers();
    const { owner, list, open } = miniapp();
    const read = deferred<WebuiMiniAppCatalogue>();
    list.mockImplementationOnce(() => read.promise);
    const release = owner.acquirePresentation("app", false);
    release();
    read.resolve(catalogue());
    await vi.advanceTimersByTimeAsync(0);
    expect(open).not.toHaveBeenCalled();
    const start = deferred<{ pluginId: string; viewUrl: string; connection: number }>();
    open.mockImplementationOnce(() => start.promise);
    const opening = owner.open("app");
    await owner.stop("app");
    start.resolve({ pluginId: "app", viewUrl: "/obsolete", connection: 1 });
    expect(await opening).toBe(false);
    expect(owner.getSnapshot().presentations.app?.kind).toBe("stopped");
    expect(owner.getSnapshot().opening).toBeUndefined();
    owner.dispose();
  });

  it("does not automatically retry refused standalone starts", async () => {
    vi.useFakeTimers();
    const { owner, open } = miniapp();
    open.mockRejectedValue(new Error("refused"));
    owner.acquirePresentation("app", true);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(open).toHaveBeenCalledTimes(1);
    expect(owner.getSnapshot().refusals.app?.message).toBe("refused");
    owner.dispose();
  });

  it("keeps an explicit open alive when its reader navigates away", async () => {
    vi.useFakeTimers();
    const { owner, open } = miniapp();
    const release = owner.acquirePresentation("app", false);
    await vi.advanceTimersByTimeAsync(0);
    const pending = deferred<{ pluginId: string; viewUrl: string; connection: number }>();
    open.mockImplementationOnce(() => pending.promise);
    const command = owner.open("app");
    release();
    pending.resolve({ pluginId: "app", viewUrl: "/explicit", connection: 2 });
    expect(await command).toBe(true);
    expect(owner.getSnapshot().presentations.app).toMatchObject({ kind: "open", connection: 2 });
    expect(vi.getTimerCount()).toBe(0);
    owner.dispose();
  });

  it("discards an automatic presentation completion after its last reader leaves", async () => {
    vi.useFakeTimers();
    const { owner, open } = miniapp();
    const pending = deferred<{ pluginId: string; viewUrl: string; connection: number }>();
    open.mockImplementationOnce(() => pending.promise);
    const release = owner.acquirePresentation("app", true);
    await vi.advanceTimersByTimeAsync(0);
    expect(open).toHaveBeenCalledTimes(1);
    release();
    pending.resolve({ pluginId: "app", viewUrl: "/abandoned", connection: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(owner.getSnapshot().presentations.app).toBeUndefined();
    expect(owner.getSnapshot().opening).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    owner.dispose();
  });

  it("keeps a running view on read failure and cancels pending selection waits on disposal", async () => {
    vi.useFakeTimers();
    const { owner, list } = miniapp();
    await owner.open("app");
    const shown = owner.getSnapshot().presentations.app;
    owner.acquirePresentation("app", false);
    list.mockRejectedValue(new Error("offline"));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(owner.getSnapshot().presentations.app).toBe(shown);
    owner.dispose();
    const waitOwner = createWebuiMiniAppWorkflows({ port: {}, selection: {
      current: () => "elsewhere", subscribe: () => () => undefined,
    } });
    const waiting = waitOwner.awaitSelection("target");
    expect(vi.getTimerCount()).toBe(1);
    waitOwner.dispose();
    expect(await waiting).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

const bot = (connectionId: string): WebuiChannelConnection => ({
  connectionId, channel: "wechat", agentName: "mavis", projectKey: null, state: "configured",
});

describe("IM authorization observation (scripted capability, real owner)", () => {
  it("retains a bound bot's configuration and filter across remount and a delayed same-selection refresh", async () => {
    vi.useFakeTimers();
    const configured = { configured: true };
    const filter = { mode: "full" as const, includeToolSummary: true };
    const configRead = vi.fn(async () => configured);
    const filterRead = vi.fn(async () => filter);
    const owner = createWebuiChannelOwner({ port: {
      listChannelConnections: async () => ({ connections: [{ ...bot("a"), state: "bound", binding: { bindingId: "binding", externalId: "wechat:a" } }] }),
      checkChannelConfig: configRead, getChannelMessageFilter: filterRead,
    } });
    await owner.load();
    await owner.select("a");
    const first = owner.startRefreshing();
    await vi.advanceTimersByTimeAsync(0);
    first();
    const stable = owner.getSnapshot();
    const delayed = deferred<{ configured: boolean }>();
    configRead.mockImplementationOnce(() => delayed.promise);
    const returned = owner.startRefreshing();
    expect(owner.getSnapshot()).toBe(stable);
    await vi.advanceTimersByTimeAsync(0);
    expect(configRead).toHaveBeenCalledTimes(1);
    expect(filterRead).toHaveBeenCalledTimes(1);
    const refreshing = owner.select("a");
    expect(owner.getSnapshot().config).toBe(stable.config);
    expect(owner.getSnapshot().filter).toBe(stable.filter);
    delayed.resolve(configured);
    await refreshing;
    returned();
    owner.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start selection-based authorization after the last reader left during configuration loading", async () => {
    vi.useFakeTimers();
    const config = deferred<{ configured: boolean }>();
    const start = vi.fn(async () => ({ ok: true, sessionId: "qr" }));
    const owner = createWebuiChannelOwner({ port: {
      listChannelConnections: async () => ({ connections: [bot("a")] }),
      checkChannelConfig: () => config.promise, startChannelWechatBind: start,
    } });
    await owner.load();
    const release = owner.startRefreshing();
    const selecting = owner.select("a");
    release();
    config.resolve({ configured: true });
    await selecting;
    expect(start).not.toHaveBeenCalled();
    expect(owner.getSnapshot().authorization).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    const returned = owner.startRefreshing();
    await vi.advanceTimersByTimeAsync(0);
    expect(start).toHaveBeenCalledTimes(1);
    expect(owner.getSnapshot().authorization?.sessionId).toBe("qr");
    returned();
    owner.dispose();
  });

  it("settles an explicitly requested authorization refresh after its last observer leaves", async () => {
    vi.useFakeTimers();
    const { owner, start } = channel();
    await owner.load();
    const release = owner.startRefreshing();
    await owner.select("a");
    const pending = deferred<{ ok: boolean; sessionId: string }>();
    start.mockImplementationOnce(() => pending.promise);
    const requested = owner.refreshAuthorization("a");
    release();
    pending.resolve({ ok: true, sessionId: "explicit" });
    expect(await requested).toEqual({ ok: true });
    expect(owner.getSnapshot().authorization?.sessionId).toBe("explicit");
    expect(vi.getTimerCount()).toBe(0);
    owner.dispose();
  });
  function channel() {
    const status = vi.fn(async () => ({ status: "pending" as "pending" | "confirmed" | "expired" | "error" }));
    const start = vi.fn(async () => ({ ok: true, sessionId: "qr" }));
    const owner = createWebuiChannelOwner({ port: {
      listChannelConnections: async () => ({ connections: [bot("a"), bot("b")] }),
      startChannelWechatBind: start, getChannelWechatBindStatus: status,
    } });
    return { owner, status, start };
  }

  it("shares clocks, polls only pending authorization and releases the last reader", async () => {
    vi.useFakeTimers();
    const { owner, status } = channel();
    await owner.load();
    const first = owner.startRefreshing();
    const second = owner.startRefreshing();
    await owner.select("a");
    expect(vi.getTimerCount()).toBe(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(status).toHaveBeenCalledTimes(1);
    first(); first();
    status.mockResolvedValue({ status: "expired" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(status).toHaveBeenCalledTimes(2);
    expect(owner.getSnapshot().authorization?.status).toBe("expired");
    expect(vi.getTimerCount()).toBe(1);
    second();
    expect(vi.getTimerCount()).toBe(0);
    owner.dispose();
  });

  it("deduplicates slow polls and fences selection, refresh, release and disposal", async () => {
    vi.useFakeTimers();
    const { owner, status } = channel();
    await owner.load();
    const release = owner.startRefreshing();
    await owner.select("a");
    const pending = deferred<{ status: "confirmed" }>();
    status.mockImplementationOnce(() => pending.promise);
    const old = owner.readAuthorization();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(status).toHaveBeenCalledTimes(1);
    await owner.select("b");
    pending.resolve({ status: "confirmed" });
    await old;
    expect(owner.getSnapshot().authorization?.connectionId).toBe("b");
    const refresh = deferred<{ status: "confirmed" }>();
    status.mockImplementationOnce(() => refresh.promise);
    const oldQr = owner.readAuthorization();
    await owner.refreshAuthorization("b");
    refresh.resolve({ status: "confirmed" });
    await oldQr;
    expect(owner.getSnapshot().authorization?.status).toBe("pending");
    const late = deferred<{ status: "confirmed" }>();
    status.mockImplementationOnce(() => late.promise);
    const last = owner.readAuthorization();
    release();
    owner.dispose();
    const snapshot = owner.getSnapshot();
    late.resolve({ status: "confirmed" });
    await last;
    expect(owner.getSnapshot()).toBe(snapshot);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not let a late QR start select a bot after navigation", async () => {
    vi.useFakeTimers();
    const { owner, start } = channel();
    await owner.load();
    owner.startRefreshing();
    const pending = deferred<{ ok: boolean; sessionId: string }>();
    start.mockImplementationOnce(() => pending.promise);
    const old = owner.select("a");
    await Promise.resolve();
    await owner.select("b");
    pending.resolve({ ok: true, sessionId: "old-qr" });
    await old;
    expect(owner.getSnapshot().selectedId).toBe("b");
    expect(owner.getSnapshot().authorization?.connectionId).toBe("b");
    owner.dispose();
  });

  it("releases a starting QR and reacquires it on return; confirmation stops authorization polling", async () => {
    vi.useFakeTimers();
    const { owner, start, status } = channel();
    await owner.load();
    const release = owner.startRefreshing();
    const pending = deferred<{ ok: boolean; sessionId: string }>();
    start.mockImplementationOnce(() => pending.promise);
    const selecting = owner.select("a");
    await Promise.resolve();
    release();
    pending.resolve({ ok: true, sessionId: "abandoned" });
    await selecting;
    expect(owner.getSnapshot().authorization).toBeUndefined();
    const returned = owner.startRefreshing();
    await vi.advanceTimersByTimeAsync(0);
    expect(owner.getSnapshot().authorization?.sessionId).toBe("qr");
    status.mockResolvedValue({ status: "confirmed" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(owner.getSnapshot().authorization).toBeUndefined();
    expect(vi.getTimerCount()).toBe(1);
    returned();
    owner.dispose();
  });
});

describe("application Mini App presenter coordination", () => {
  it("fences duplicate/replaced epochs, close-before-selection, navigation and unbinding", async () => {
    let listener!: (intent: WebuiMiniAppPresentationIntent) => void;
    let selected: string | undefined;
    let selection = deferred<boolean>();
    const opening = deferred<boolean>();
    const open = vi.fn(() => opening.promise);
    const show = vi.fn();
    const close = vi.fn();
    const coordinator = createWebuiMiniAppPresenterCoordinator({
      watch: (next) => { listener = next; return () => undefined; },
      awaitSelection: () => selection.promise,
      selected: () => selected, open,
    });
    const release = coordinator.bind({
      select: (id) => { selected = id; }, isOpen: () => false, show, close,
    });
    const intent = { epoch: "first", revision: 1, action: "open", sessionId: "s", pluginId: "app" } as const;
    listener(intent);
    listener({ ...intent, revision: 2, action: "close" });
    selection.resolve(true);
    await Promise.resolve();
    expect(open).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith("s", "app");
    selection = deferred<boolean>();
    listener({ ...intent, epoch: "replacement" });
    listener({ ...intent, epoch: "replacement" });
    selection.resolve(true);
    await Promise.resolve();
    expect(open).toHaveBeenCalledTimes(1);
    selected = "elsewhere";
    opening.resolve(true);
    await Promise.resolve();
    expect(show).not.toHaveBeenCalled();
    release();
    coordinator.dispose();
    listener({ ...intent, revision: 3 });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("selects, opens and presents once, reuses existing tabs and ignores stale release", async () => {
    let listener!: (intent: WebuiMiniAppPresentationIntent) => void;
    const open = vi.fn(async () => true);
    const show = vi.fn();
    const coordinator = createWebuiMiniAppPresenterCoordinator({
      watch: (next) => { listener = next; return () => undefined; },
      awaitSelection: async () => true, selected: () => "s", open,
    });
    const binding = { select: vi.fn(), isOpen: () => false, show, close: vi.fn() };
    const stale = coordinator.bind(binding);
    coordinator.bind(binding);
    stale();
    const intent = { epoch: "e", revision: 1, action: "open", sessionId: "s", pluginId: "app", path: "/page" } as const;
    listener(intent);
    await vi.waitFor(() => expect(show).toHaveBeenCalledWith("s", "app"));
    expect(open).toHaveBeenCalledWith("app", "/page");
    coordinator.bind({ ...binding, isOpen: () => true });
    listener({ ...intent, revision: 2 });
    await vi.waitFor(() => expect(show).toHaveBeenCalledTimes(2));
    expect(open).toHaveBeenCalledTimes(1);
    coordinator.dispose();
  });
});

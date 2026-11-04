#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  WebuiService,
  createOperationRegistry,
  BrowserBridgeServer,
  createMiniAppProxyRegistry,
  createMiniAppPresenter,
} from "../server/server.js";
import {
  WebuiTerminalManager,
  createBrowserAdapter,
  createHarnessPortFromHost,
  createWebuiRuntimeHost,
} from "../server/runtime.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(await readFile(path.join(packageRoot, "server/package-info.json"), "utf8"));
const portValue = process.env.WEBUI_SERVER_PORT?.trim() || "2233";
const tcpPort = Number(portValue);
if (!Number.isInteger(tcpPort) || tcpPort < 1 || tcpPort > 65535) {
  throw new Error("WEBUI_SERVER_PORT must be an integer between 1 and 65535");
}

const dataDir = process.env.MINIMAX_DATA_DIR?.trim() || path.join(os.homedir(), ".minimax");
process.env.MAVIS_BUILTIN_AGENTS_V2_DIR ??= path.join(packageRoot, "assets/agents");
process.env.MAVIS_BUILTIN_AGENTS_DIR ??= path.join(packageRoot, "assets/agents");

/**
 * The published extension identities this package was built for.
 *
 * A store build's identity is derived from the store's public key, so it is
 * known at package time and written into `bin/store-extension-ids.json`. It
 * is a property of the package rather than of the machine it is installed on,
 * which is why it is read from the package and not from the environment.
 *
 * A package built without a store public key carries no identity, and the
 * bridge then admits nobody. The refusal is visible — every extension is
 * turned away at the upgrade — rather than silent.
 */
async function readStoreExtensionIds() {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path.join(packageRoot, "bin", "store-extension-ids.json"), "utf8"));
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  const ids = {};
  for (const [surface, value] of Object.entries(parsed)) {
    if (surface !== "edge" && surface !== "chrome") continue;
    // A Chrome extension id is 32 letters from `a` to `p`. Anything else is
    // not an identity the bridge could ever compare against, so it is dropped
    // rather than carried into the allowlist.
    if (typeof value !== "string" || !/^[a-p]{32}$/.test(value)) continue;
    ids[surface] = [value];
  }
  return ids;
}
// The extension bridge is assembled here, beside the browser adapter, because
// the layer matrix forbids `src/runtime/**` from importing `src/server/**`. This
// file is the composition root: it is the one place that can hand the bridge's
// provider factory to the adapter AND the same instance to the service's
// `/browser-bridge` upgrade branch, so the extension and the browser service
// address one session rather than two. `dev: true` is passed through
// unchanged; the bridge's admission ignores it by design.
//
// `packaged: true` is what makes this the **packaged** entry. A packaged host
// reads the store allowlist (`MAVIS_BROWSER_STORE_EDGE_EXTENSION_IDS`,
// `MAVIS_BROWSER_STORE_CHROME_EXTENSION_IDS`) and never the development one
// (`MAVIS_BROWSER_EDGE_EXTENSION_IDS`, `MAVIS_BROWSER_CHROME_EXTENSION_IDS`).
// The difference matters: an unpacked build's id is derived from the directory
// it was loaded from, so it is not an identity anyone can rely on, and a
// packaged host that accepted those ids would admit whatever unpacked
// extension happened to be present. The development entry
// (`scripts/run-webui-server.mjs`) is the one that reads the development
// allowlist.
//
// The identity of the **published** extension is not read from the
// environment at all: it is a constant of this release, derived from the
// store's public key, and it is written into the package at package time (see
// `scripts/package-webui-npm.mjs`). So the person who installs this package
// configures nothing: the bridge admits the published extension, and the
// environment variables above remain available for a self-hosted store build.
//
// The published identities are read here rather than in the server bundle,
// because they are a property of the **package** — of which store's build it
// ships — and not of the code.
const browserBridge = new BrowserBridgeServer({
  host: "127.0.0.1",
  dev: true,
  packaged: true,
  storeExtensionIds: await readStoreExtensionIds(),
});
await browserBridge.start();
// The browser adapter is built before the runtime host, because the host is
// what takes the browser provider: the adapter reads its authorization
// switches through the host, so the host is attached to it immediately after.
//
// The same binding carries both faces of the one browser session — the port the
// browser operations bind to, and the Agent's browser tools. Building the tool
// adapter anywhere else would put the Agent on a second browser, and the panel
// would show the first.
const browser = createBrowserAdapter({ dataDir, bridge: browserBridge });
const miniAppPresenter = createMiniAppPresenter({});
const miniappProxies = createMiniAppProxyRegistry();
const assembled = await createWebuiRuntimeHost({
  dataDir,
  appVersion: version,
  browserProvider: {
    adapter: browser.toolAdapter,
    close: () => browser.close(),
  },
  // One compact Browser tool over the restricted command set. The detailed
  // per-action tools would re-offer the same actions under their own names.
  browserToolExposure: "compact",
  // The runtime's Mini App presenter, implemented by this client. Supplied here
  // because the runtime may not import the server that holds it.
  miniAppSurface: miniAppPresenter.presenter,
});
browser.attachHost(assembled.host);
// A session's pages are released when the session ends -- deleted, archived
// or transferred away. The runtime has no per-session lifecycle signal, and
// this is the only place that holds both the harness port and the browser
// service, so the release is wired here rather than on one operation.
const port = createHarnessPortFromHost(assembled.host, {
  onSessionEnded: (sessionId) => browser.releaseSession(sessionId),
  browserPort: browser.port,
});
const terminal = new WebuiTerminalManager();
// The browser port is absent when the host cannot answer the browser
// authorization at all, and the browser operations then stay unregistered.
//
// The bridge's pairings follow the switches, so the persisted authorization has
// to reach them before the service starts serving.
await browser.initialize();
const service = new WebuiService({
  port,
  operations: createOperationRegistry(port, terminal, browser.port, browserBridge, miniappProxies, miniAppPresenter),
  terminal,
  host: "127.0.0.1",
  tcpPort,
  dev: true,
  clientDir: path.join(packageRoot, "client"),
  browserBridge,
  // Closed on shutdown: a leaked Mini App listener holds a plugin's derived port.
  miniappProxies,
});

let closing;
const close = () => {
  closing ??= (async () => {
    await service.close();
    await browser.close();
    await assembled.host.apiHost.close();
  })();
  return closing;
};

try {
  const info = await service.start();
  // dev mode keeps the per-start credential off, so the shell page and its
  // assets load without a query token. info.boundUrl is the bare ws://
  // endpoint; browsers need the http:// origin.
  const browserUrl = `http://${info.host}:${info.tcpPort}/`;
  console.log(`[mcode-webui] WebUI running at ${browserUrl}`);
  console.log("Press Ctrl+C to stop the server.");
  process.once("SIGINT", () => void close().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void close().finally(() => process.exit(0)));
} catch (error) {
  await close();
  throw error;
}

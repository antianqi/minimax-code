# @mavis/browser-extension

The Edge/Chrome extension that bridges a person's own browser to a local WebUI
host, so the person and the Agent operate **one** browser session rather than two.
It is the extension half of ADR 0019.

## What it does

- Pairs with the local WebUI over a loopback WebSocket at `/browser-bridge`,
  using challenge-response rather than a bearer token.
- Reports the tabs it can reach, each with a generation that rises whenever the
  page behind the tab is replaced.
- Streams live images of the visible tab for the panel.
- Delivers pointer, keyboard and text input into the tab the Agent addressed.

## Layout

| File | Purpose |
| --- | --- |
| `manifest.json` | The MV3 manifest: permissions, loopback host permissions, no remote code. |
| `scripts/build.mjs` | The build. The source directory is TypeScript and a browser runs JavaScript only, so this produces the loadable `dist/`. |
| `src/chrome.d.ts` | The subset of the Chrome API this extension uses; `@types/chrome` is unavailable to an extension. |
| `src/protocol.ts` | The extension's copy of the bridge wire protocol, pinned to the host's signature test vector. |
| `src/pairing.ts` | The pairing credential in `chrome.storage.local` and the challenge answer. |
| `src/bridge-client.ts` | The loopback WebSocket client, the reconnect schedule and the operation deadline. |
| `src/targets.ts` | Tab discovery and the generation registry. |
| `src/images.ts` | The visible-tab image stream. |
| `src/input.ts` | Pointer / keyboard / text delivery, bound to target and generation. |
| `src/background/service-worker.ts` | The MV3 entry point that wires the above together. |

## Running it

**Build first: the source directory is not loadable.** A browser extension
runtime executes JavaScript only, and this package's sources are TypeScript —
the source manifest points the service worker at
`src/background/service-worker.ts`. Loading the source directory therefore
installs an extension whose worker never runs: it appears in the browser's
extension list and then does nothing, which reads as a broken install.

```bash
pnpm --filter @mavis/browser-extension build
```

The build writes `packages/browser-extension/dist/`, with the manifest's two
source paths rewritten to the compiled ones. Load **that** directory as an
unpacked extension:

- Edge: `edge://extensions` → Developer mode → Load unpacked →
  `packages/browser-extension/dist`
- Chrome: `chrome://extensions` → Developer mode → Load unpacked →
  `packages/browser-extension/dist`

The host needs an OS secure credential store before it can mint an
installation key. On Linux that is the freedesktop Secret Service, reached
through the `secret-tool` client, and the service has to answer; without a
reachable store the host cannot hold a credential, and the Settings page
reports the surface as "not enabled" even though its switch is on:

```bash
sudo apt-get install -y libsecret-tools
```

Then start the WebUI so it admits this extension. An unpacked build's identity
is derived from the directory it was loaded from, so the host has to be told
which identity it accepts — development mode does not bypass that check, and an
identity the host does not know is refused:

```bash
MAVIS_BROWSER_EDGE_EXTENSION_IDS=<extension-id> pnpm --filter @mavis/webui dev:server
```

The id is on the extension's own card in `edge://extensions`. The packaged
WebUI entry reads the **store** allowlist instead
(`MAVIS_BROWSER_STORE_EDGE_EXTENSION_IDS`), and a locally loaded build is not
on it.

Then point the extension at the WebUI host. The extension cannot learn the
host's address by itself, so an absent origin is reported rather than replaced
with a guessed default port:

```json
{ "webui.browserBridge.origin": "http://127.0.0.1:<webui-port>" }
```

The origin is the WebUI **server's** address — the one that serves
`/browser-bridge`, not the Vite client's — and it carries no path, because the
extension appends the bridge path itself. Only a loopback `http:` origin is
accepted.

The extension's **options page** is where both of these are entered.
Open it from the browser's extension manager — `edge://extensions` (or
`chrome://extensions`) → the "MiniMax Code Browser Bridge" card → *Extension
options*:

- the **WebUI address**, which the options page checks against the same rule
  the client dials with (a loopback `http:` address, with no path);
- the **installation key** from the WebUI's Settings page, which is
  write-only: the page shows a fingerprint afterwards and never the key.

Saving either one wakes the worker, which re-reads the configuration and
pairs with the host.

The bridge path, the frame shapes and the signature construction are duplicated
from `packages/webui/src/shared/contracts/browser-bridge.ts`: an extension has no
node_modules and no bundler, so it cannot import a workspace package. Both sides
are pinned to the same test vector
(`secret = "webui-browser-bridge-test-secret"`, `nonce = "nonce-abc"`,
`keyId = "key-1"` → `xb7/GT5s+ScVsaiLkh+eRRndKi5oPQwqQMqU3aX8Znc=`), so a change
to either side breaks one suite rather than silently failing to pair.

## Two limitations that shape the product

- **Only the visible tab can be captured.** `chrome.debugger` does not expose
  `Page.captureScreenshot`, so `chrome.tabs.captureVisibleTab` is the only image
  path, and it returns nothing for a background tab. The extension reports "no
  frame" rather than substituting another tab's page.
- **No remote code and no `<all_urls>`.** The content security policy allows only
  `'self'` scripts, and host permissions cover the two loopback origins the
  bridge needs. Page access comes from `tabs`/`debugger`/`activeTab`, not from a
  blanket host grant.

## Verification

```
pnpm --filter @mavis/browser-extension typecheck
pnpm --filter @mavis/browser-extension test
pnpm --filter @mavis/browser-extension build
```

The built extension is exercised against a real Edge and a real Chromium by
`packages/webui/test/browser/browser-bridge-real-browser.spec.ts`, which
builds it, loads it, provisions it and completes the handshake. That suite is
the gate that a browser can actually run what this package builds.

## Store distribution

Chrome Web Store and Edge Add-ons artifacts are a separate release action. Both
builds come from this one source package, and they are the same build:
`scripts/build.mjs --store edge` (or `--store chrome`) compiles the same
sources and adds the store's public key, which fixes the extension's identity
so it is the identity the store issued rather than one derived from the
directory it was loaded from.
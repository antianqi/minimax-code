# The dedicated extension admission path

**Status:** This document mixes three kinds of statement, labelled inline:

| Label | Means | Backed by |
| --- | --- | --- |
| `implemented` | The source enforces this today; the row names the file and line. | The cited file in this repository |
| `required` | A rule the contracts pin with no enforcing code at that point. | `packages/webui/src/shared/contracts/browser-bridge.ts` |
| `not yet measured` | An open question. Not a denial and not a promise. | Nothing |

**The admission function is wired and exercised.** `admitBrowserBridgeUpgrade` is implemented in
`packages/webui/src/server/browser-bridge/admission.ts` and the server's upgrade dispatcher
(`packages/webui/src/server/websocket-server.ts`) branches on `/browser-bridge` **before** the generic
`admitWebSocketUpgrade`, so a bridge request never reaches the generic path and the generic path is
unchanged. A real Chrome and a real Edge have connected and been refused through it — see
[`07-review-findings.md`](07-review-findings.md).

## Why a dedicated path

The WebUI already admits WebSocket upgrades, in `admitWebSocketUpgrade`
(`packages/webui/src/server/access-policy.ts:51`). That function cannot admit an extension:

- **The origin check rejects it.** `isAllowedOrigin` (`access-policy.ts:119`) parses the origin and
  returns `false` unless the protocol is `http:` or `https:` and the hostname is `127.0.0.1` or
  `localhost`. A `chrome-extension://` origin fails the protocol test at `access-policy.ts:127`.
- **The credential it expects is the wrong one.** `admitWebSocketUpgrade` reads a `token` query
  parameter and checks it against the per-start WebUI credential. That credential is a fresh
  `randomUUID()` for every service start (`createWebuiCredential`,
  `packages/webui/src/server/credentials.ts:19`). An extension installed once cannot learn a value
  that changes on every restart, and ADR 0019 forbids replacing the pairing credential with it.

So the extension cannot be admitted by the existing path, and the existing path must not be widened to
admit it. The bridge gets its own admission.

## The generic path, quoted exactly

For reference, this is the rule the dedicated path must not inherit. From `admitWebSocketUpgrade`
(`packages/webui/src/server/access-policy.ts:51`):

| Step | Check | Refusal |
| --- | --- | --- |
| 1 | `Host` header is present and names an address the service could have been reached at: loopback, the bound address, or any host name when the bind is a wildcard | `403 Forbidden Host` |
| 2 | The URL hostname is loopback or the host name the request carried | `403 Forbidden Host` |
| 3 | If an `Origin` is present, it is the same origin as the request | `403 Forbidden Origin` |
| 4 | The `token` query parameter matches the per-start credential — **unless `dev` is true and the request arrived over loopback** | `401 Unauthorized` |

ADR 0031 moved the bind address out of the construction-time refusal and into configuration, so
step 1 and step 4 now read the bound address and the interface the request arrived on.

Refusals are written by `rejectUpgrade` (`access-policy.ts:98`) as a bare HTTP status line followed by
`Connection: close`.

## The `dev: true` bypass, and why it must not apply here

Step 4 is skipped only when `context.dev` is true **and** the request arrived over the
loopback interface. The condition at `packages/webui/src/server/access-policy.ts:88` reads:

```ts
const presented = url.searchParams.get("token");
if (
  credentialRequired(requestHostname, context.dev) &&
  !credentialMatches(context.credential, presented)
) {
  rejectUpgrade(socket, 401, "Unauthorized");
  return false;
}
```

**`dev: true` disables the credential check, not just the token requirement.** That is a real bypass,
and it is the current state of both composition roots:

| Entry point | Line | `dev` | Bridge allowlist |
| --- | --- | --- | --- |
| `scripts/run-webui-server.mjs` | 74 | `dev: true` | development — the identities it has learned, plus `MAVIS_BROWSER_EDGE_EXTENSION_IDS`, `MAVIS_BROWSER_CHROME_EXTENSION_IDS` |
| `release/webui-npm/bin/mcode-webui.mjs` | 93 | `dev: true` | **store** — the published identity the package was built for, plus `MAVIS_BROWSER_STORE_EDGE_EXTENSION_IDS`, `MAVIS_BROWSER_STORE_CHROME_EXTENSION_IDS` |

So on a packaged WebUI today, the generic path already accepts any upgrade that passes the
Host, URL-host and origin checks **without presenting the token at all** — as long as the request
arrived over loopback. ADR 0031 is what draws that line: a request that arrived on another
interface presents the per-start credential in every mode. ADR 0019 already records that both entries
run with `dev: true`.

**The two entries differ in one more way, and it is the one that matters here.** The packaged entry
passes `packaged: true` to the bridge, so it reads the **store** allowlist and never the development
one. An unpacked build's id is derived from the directory it was loaded from, so it is not an
identity anyone can rely on; a packaged host that accepted those ids would admit whatever unpacked
extension happened to be present. The development entry is the one that reads the development
allowlist, because that is where the ids of unpacked builds belong. The distinction is measured
against a real browser in [`09-acceptance-record.md`](09-acceptance-record.md): the id a store build
gets is the one its public key determines, a packaged host admits that id, and the same packaged host
refuses it when the id is named only in the development allowlist.

**The published identity is not configuration, and it is not asked of the person who installs the
package.** A published extension's id is derived from the store's public key — the first 16 bytes of
the key's SHA-256, rendered as hex and mapped onto `a`–`p` — and that derivation was measured
against a real browser rather than assumed (`scripts/lib/extension-identity.mjs`, pinned by
`test/source-sync.test.mjs` against an id a real Chromium assigned). The id is therefore a constant of
the release, known at package time, and `scripts/package-webui-npm.mjs` writes it into the package as
`bin/store-extension-ids.json`. The packaged entry reads that file and hands the identities to the
bridge, which admits them alongside whatever the environment names.

The consequence is the one that matters for a released product: **installing the published package
requires no extension id, no environment variable and no restart with a hand-written setting.** The
store allowlist variables remain for a self-hosted store build, and they add to the published
identity rather than replacing it.

## The self-hosted build pins its own identity

**`implemented`.** This distribution has no store. The person downloads the extension from Settings
and loads it unpacked, so the packaged host has to admit a build that no store issued.

An unpacked build with no key in its manifest gets an id derived from the **directory** it was loaded
from — a different identity on every machine, and the reason the packaged host could not admit one.
A manifest that carries `key` does not work that way: the browser derives the id from the key, which
is what that field is for ("maintains the unique ID of an extension … when it is loaded during
development", Chrome's manifest reference). One key, one id, from any directory on any machine.

So the build that ships in the package carries a key, and the package decides its identity from that
same key at package time:

| Step | Where |
| --- | --- |
| The extension's source manifest carries a fixed `key` | `packages/browser-extension/manifest.json` |
| Packaging builds the extension and copies the build into the artifact | `scripts/package-webui-npm.mjs`, `extension/` |
| The derived id is written into the package | `bin/store-extension-ids.json`, by `extensionIdFromPublicKey` |
| The packaged host serves that build from its own download button | `release/webui-npm/bin/mcode-webui.mjs`, `browserExtensionPackage` |

Measured end to end, not reasoned about: the archive downloaded from a packaged host was unpacked and
loaded into a real Chromium, which assigned `clhddcofpopmlmnjfmbjonhmcpnehpdi` — the id the same
package wrote into `bin/store-extension-ids.json`. A WebSocket upgrade to that host's
`/browser-bridge` from that origin was accepted; the same upgrade from an id the package does not name
was refused with `403 Forbidden Origin`.

Two consequences worth stating. The key is public — it is in the manifest of every downloaded copy —
so the identity is not a secret; what admits a client is the id **plus** the pairing proof
([`04-pairing-credentials.md`](04-pairing-credentials.md)), and the id only narrows who may attempt it.
And the pin is permanent: changing the key later changes the id, so every installed copy would have to
be reloaded from a new download.

## The development host learns the identity it is given

The same reasoning applies to a development host, and for a stronger reason. An unpacked build's id
is derived from the directory it was loaded from, so it is **different on every machine and every
path**: there is no constant to bake in, and a name the person has to go and look up is a name they
will get wrong. So the development host does not ask for one either.

It learns the identity from the extension, and only from a proof:

- The upgrade gate admits an identity the host does not know. This widens **who may try**, not
  **who may act**: the peer still has to answer the surface's challenge with the installation key,
  and a peer that cannot is refused and receives no credential.
- When the peer proves the installation key — or a credential this host already issued — the host
  records the identity under `<dataDir>/browser-bridge/trusted-extensions.json` and admits it from
  then on. The file is written atomically and owner-only, and a file that cannot be read reads as
  "nothing is trusted yet", which costs the extension one more proof and no secret.
- The identities are per surface, and the peer's own `hello` still says which browser it is on. The
  name selects **which secret to check against**, never the identity to believe (ADR 0019, A5).

A **packaged** host does not learn anything: its published identity is exact, and a packaged host
that admitted unknown origins would stop being the published extension. The development
allowlist variables still work on a development host, and they add to what it has learned rather
than replacing it.

The cost of the wider upgrade gate is a peer that connects and then goes quiet: it would hold a
challenge unanswered. Each pairing therefore caps how many challenges it will have outstanding at
once (`MAX_OUTSTANDING_CHALLENGES`), and the hello deadline closes the sockets that never introduce
themselves.

**`implemented`: the bridge admission path never reads `dev`.** The pairing proof is verified
unconditionally, and the browser switch is checked unconditionally. `admission.ts:135` holds an
explicit no-op `if (context.dev)` branch whose only purpose is to make the absence of a bypass
reviewable: adding `return undefined` inside it would short-circuit every check below it, and the
branch's comment says so. That is a contract marker, not an enforcement mechanism — the enforcement is
that no such early return exists.

The three requirements stand as written:

- Extension admission does not consume `context.dev` as authority to skip a check. There is no `dev`
  parameter on it and no branch inside it that grants anything.
- Pairing proof is verified unconditionally. There is no mode in which the bridge accepts a socket
  without a valid proof.
- Browser authorization is checked unconditionally. A `dev: true` WebUI does not admit an extension
  for a browser whose switch is off.

Turning a development bypass into a way to control somebody's logged-in browser would defeat the
purpose of the whole pairing design. The exemption is scoped to the generic WebUI path and stays there.

## Admission checks and refusal statuses — what the function does

The order matters: cheap structural checks first, then identity, then the credential, then
authorization. This table is `implemented` and transcribed from `admission.ts:81` and `pairing.ts`:

| # | Check | Source | Refusal returned |
| --- | --- | --- | --- |
| 0 | The upgrade URL parses | `admission.ts:89` | `400 Bad Request` |
| 1 | Request path is exactly `/browser-bridge` (`WEBUI_BROWSER_BRIDGE_PATH`) | `admission.ts:95` | `400 Bad Request` |
| 2 | `Host` header host part is loopback (`isLoopbackHost`) | `admission.ts:102` | `403 Forbidden Host` |
| 3 | URL hostname is `127.0.0.1` or `localhost` | `admission.ts:107` | `403 Forbidden Host` |
| 4 | `Origin` is a `chrome-extension://<id>/` URL **and** some pairing's allowlist admits that id | `admission.ts:114`, `admission.ts:128` | `403 Forbidden Origin` |
| 5 | A challenge has been issued and the presented `proof` verifies: `keyId` matches, `nonce` matches, the algorithm is the issued one, and the signature compares equal | `pairing.ts`, via `verifyWebuiBrowserBridgeProof` (`contracts/browser-bridge.ts:323`) | closed with `reason` |
| 6 | The switch for the browser named in `hello` is on, and a current credential exists for it | `pairing.ts:175` | closed with `reason` |

**Check 4 is a pre-filter, not the authentication decision.** The `Origin` header is
writable by any local process, so it says which extension *claims* to be connecting — it does
not say who is connecting. What authenticates the peer is the **proof**, and a peer that
proves the surface's **installation key** is the only one the host will release the pairing
credential to (`pairing.ts:270`, `verifyProof`; `session.ts:652`). A peer that proves only a
pairing credential the host already issued is admitted without a further credential; a peer
that proves neither is refused and receives no credential at all.

Two corrections to the shape this document originally specified, both now taken from the source:

- A **path** mismatch is refused with `400`, not `404`. `admission.ts:92` comments that a wrong path is
  a misroute from the generic upgrade dispatcher rather than a missing resource.
- The extension-identity check and the origin check are **one** check with one refusal.
  `admission.ts:118` returns `403 Forbidden Origin` both when the origin is not a `chrome-extension://`
  URL and when no pairing's allowlist admits that id. The implementation merges them deliberately.

Checks 5 and 6 are independent of 1–4, and of each other: a correctly signed proof from a browser
whose switch is off is still refused, and a revoked credential fails even from an allowlisted
extension.

**Wire-level codes.** The HTTP statuses above are on the upgrade. The post-upgrade refusals reported to
the client are the stable error codes in `packages/webui/src/shared/contracts/browser.ts` —
`browser_pairing_rejected` and `browser_surface_not_authorized` are both in that set, along with
`browser_credential_store_unavailable`. The extension-identity refusal has **no** stable code: an
extension refused for its identity is given `403 Forbidden Origin`, which is indistinguishable from a
malformed origin by design. This remains an open decision — either it reuses
`browser_pairing_rejected`, which is defensible since an unallowlisted extension must not learn that it
is unallowlisted rather than unpaired, or a code is added to the pinned list. This document does not
decide it; it records that the decision is outstanding.

## The extension-identity allowlist

Each store build's **exact** extension identity is validated at the bridge. The allowlist is by
identity, not by shape:

| Rule | Detail |
| --- | --- |
| Packaged builds accept only their own store identities | A Chrome Web Store build and an Edge Add-ons build are distinct identities and neither is accepted for the other. |
| Development identities are explicit development configuration | An unpacked extension's identity is accepted only when the host is configured to accept it. |
| **A packaged build never accepts a development identity** | Development identities are not accepted by packaged builds. This is the rule that keeps an unpacked, locally-loaded build from being a way into a released client. |
| An identity outside the list is refused | It is not merely deprioritized or asked to confirm. |

The allowlist is configuration, not code-level inference: the host must be told which identities it
accepts. Because the two stores are separate submissions generated from one source package, the two
identities differ and both must be registered.

## The origin check is not broadened

**Required, and stated separately because it is the tempting shortcut.** `isAllowedOrigin`
(`access-policy.ts:177`) is not broadened to admit extension origins. Its rule is the same origin as
the request — ADR 0031 widened the host the origin may name, not the set of protocols it may use.
`chrome-extension://` is not added to it. A `chrome-extension://` origin continues to be rejected by
the generic path, and that rejection is what forces the dedicated path to exist rather than being an
inconvenience to work around.

Broadening the generic check would admit *every* extension origin against *every* WebSocket endpoint on
the loopback interface, which is a much larger grant than admitting one known extension to one known
path.

## Summary of what is required versus what exists

| Element | State |
| --- | --- |
| Loopback Host, URL-host and origin checks | `implemented` — `admitWebSocketUpgrade`, `access-policy.ts:51` |
| Per-start token check with a `dev: true` bypass | `implemented` — `access-policy.ts:76` |
| Rejection of `chrome-extension://` by the generic origin check | `implemented` — `access-policy.ts:127` |
| Per-start credential that changes on every start | `implemented` — `createWebuiCredential`, `credentials.ts:19` |
| Dedicated `/browser-bridge` path check | `implemented` — `admission.ts:95` |
| Extension-identity allowlist | `implemented` — `BrowserBridgePairing.admitsExtensionId`, `pairing.ts:142`; configured per pairing |
| Pairing-proof admission | `implemented` — `verifyWebuiBrowserBridgeProof`, `contracts/browser-bridge.ts:218` |
| Browser-switch authorization at admission | `implemented` — `pairing.ts:152` refuses when the switch is off |
| `dev` does not bypass the bridge | `implemented` — `admission.ts:135` carries an explicit no-op `if (context.dev)` branch documenting the bypass as absent |
| **The bridge reaching the upgrade path** | `implemented` — `websocket-server.ts` branches on `/browser-bridge` **before** the generic `admitWebSocketUpgrade` and returns; the generic path is unchanged |
| **A listener owning a bridge session** | `implemented` — `server/browser-bridge/server.ts` owns the bridge's own WebSocket server and registers a session on `ready`, not on socket open |
| **The switch driving the pairing** | `implemented` — the bridge does not switch a surface on by itself; the browser service reads the persisted authorization and calls `enableSurface` / `disableSurface` / `restoreSurface` |
| **A credential that survives a host restart** | `implemented` — `BrowserBridgePairing.restore` re-adopts the stored credential at startup instead of rotating it, so the extension's copy still matches |
| **An extension-identity refusal with a stable wire code** | **open decision** — see the wire-level codes note above |
| The extension connecting end to end | **implemented, and `not yet measured`** — the host and the extension share a credential through the encrypted exchange; it has not been performed against a real Edge or Chrome. See `07-review-findings.md` |
| **The peer is authenticated against a local process** | `implemented` — the `Origin` header still selects the allowlisted extension id, and it is no longer the thing that decides. A peer must additionally prove possession of the **installation key** before the host hands over a pairing credential, and a peer that proves only a credential this host already issued receives no credential at all. A local process can spoof the origin and supply its own ECDH key, but it holds neither secret, so no `pair` frame is sent to it. See [`04-pairing-credentials.md`](04-pairing-credentials.md) |
| **The specific refusal says what is missing** | `implemented` — `BrowserBridgeProofRefusal` distinguishes `switched_off`, `unknown_nonce`, `unknown_key_id`, `installation_key_mismatch`, `pairing_credential_mismatch` and `no_peer_public_key`, and each maps to its own stable `closed`-frame reason text in `describeRefusal` (`session.ts`). A generic "pairing proof failed" would leave the person unable to tell "paste your installation key" from "your host rotated". |

## Updating the extension, and what loading a new build costs

**`implemented`.** The browser does not install an extension for the person: a store install needs
their own click in the store, and an unpacked install needs developer mode and a folder they pick.
What the host can do is make sure the package they get is the one this build speaks to, because a
stale extension is the failure that reads like a network timeout and costs an afternoon.

| Element | State |
| --- | --- |
| The host builds the extension when its sources are newer than its build | `implemented` — `ensureCurrentBuild`, `packages/webui/src/server/browser-bridge/extension-package.ts` |
| The package is served as a download, behind the per-start credential | `implemented` — `GET /browser-extension`, `packages/webui/src/server/http/browser-extension.ts`; the name carries the version, so two packages are told apart |
| The person is offered it in one place | `implemented` — 浏览器 → 下载最新扩展包, `packages/webui/src/client/features/browser/ui/BrowserSettingsPage.public.tsx` |
| A host with no extension says so | `implemented` — the route answers `404`, never an empty archive, because an empty package reads like a download that worked |

Loading the package costs one thing: the pairing proof. The shipped build carries a fixed key, so a
new folder is **not** a new identity — the host that ships it admits the build wherever it was
unpacked. What the person does once is pair the extension with the installation key from the Settings
page; a development host learns an identity it does not know from that proof rather than from a
configuration the person cannot know, and the packaged host does not need to learn anything.

## Related

| Concern | Document |
| --- | --- |
| The wire shape admitted here | [`02-bridge-protocol.md`](02-bridge-protocol.md) |
| The credential presented at check 4 | [`04-pairing-credentials.md`](04-pairing-credentials.md) |
| Where each switch is enforced | [`06-runtime-authorization-trace.md`](06-runtime-authorization-trace.md) |
// The extension's options page: where the person configures the bridge.
//
// Two settings live here, and they are separate because they are different
// kinds of thing:
//
//   * The **WebUI address** — where this browser finds the host. It is not a
//     secret, so it is shown and editable, and it is checked against the same
//     rule the client dials with: a loopback `http:` address with no path.
//   * The **installation key** — the one secret in this protocol that a local
//     process cannot reach, because it only ever exists in this browser's
//     `chrome.storage.local` and in the host's OS secure store. The person
//     moves it across by hand, once per browser.
//
// Two rules this page holds to:
//
//   * The key is **write-only** after the first save. The page reads the
//     stored key through `webuiBrowserBridgeInstallationKeyStatus`, whose
//     return type carries a fingerprint and no key, so there is no code path
//     here that could render it — the field is cleared on save as well, so it
//     is not sitting in the DOM either.
//   * Nothing is written until the paste validates as exactly 32 bytes. A
//     truncated paste would otherwise be stored and then fail at handshake
//     time as an opaque "installation key does not match".

import {
  WEBUI_BROWSER_BRIDGE_RECONNECT_MESSAGE,
} from "./protocol.js";
import {
  clearWebuiBrowserBridgeInstallationKey,
  saveWebuiBrowserBridgeInstallationKey,
  webuiBrowserBridgeInstallationKeyStore,
  webuiBrowserBridgeInstallationKeyStatus,
} from "./pairing.js";
import {
  readWebuiBrowserBridgeOrigin,
  writeWebuiBrowserBridgeOrigin,
  WEBUI_BROWSER_BRIDGE_LAST_ERROR_STORAGE_KEY,
  WEBUI_BROWSER_BRIDGE_STATUS_STORAGE_KEY,
} from "./settings.js";
import {
  webuiBrowserBridgeBrowserName,
  webuiBrowserBridgeBuildKind,
  webuiBrowserBridgeDevelopmentAllowlistLine,
} from "./extension-identity.js";

/**
 * How long the page waits for the worker to report an outcome.
 *
 * The worker answers in well under a second when the answer is a failure,
 * because a socket that cannot be opened says so at once. The window is
 * generous because a *successful* handshake takes as long as the host's own
 * credential store takes.
 */
const OUTCOME_WAIT_MS = 8_000;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`options page is missing #${id}`);
  return found as T;
}

const originInput = element<HTMLInputElement>("bridge-origin");
const saveOrigin = element<HTMLButtonElement>("save-origin");
const originStored = element<HTMLParagraphElement>("origin-stored");
const input = element<HTMLInputElement>("installation-key");
const save = element<HTMLButtonElement>("save");
const clear = element<HTMLButtonElement>("clear");
const status = element<HTMLParagraphElement>("status");
const stored = element<HTMLParagraphElement>("stored");
const extensionIdInput = element<HTMLInputElement>("extension-id");
const copyExtensionId = element<HTMLButtonElement>("copy-extension-id");
const buildKind = element<HTMLParagraphElement>("build-kind");
const hostAllowlistInput = element<HTMLInputElement>("host-allowlist");
const copyHostAllowlist = element<HTMLButtonElement>("copy-host-allowlist");
const identityNote = element<HTMLParagraphElement>("identity-note");

function say(message: string): void {
  status.textContent = message;
}

/** Render the configured address — it is not a secret, so it is shown. */
async function renderOrigin(): Promise<void> {
  const origin = await readWebuiBrowserBridgeOrigin(chrome.storage.local);
  originInput.value = origin ?? "";
  originStored.textContent = origin
    ? `This browser connects to ${origin}.`
    : "No WebUI address is configured yet.";
}

/** Render what is stored — a fingerprint, never the key. */
async function renderStored(): Promise<void> {
  const state = await webuiBrowserBridgeInstallationKeyStatus(
    webuiBrowserBridgeInstallationKeyStore(chrome.storage.local),
  );
  clear.disabled = !state.stored;
  stored.textContent = state.stored
    ? `An installation key is stored (fingerprint ${state.fingerprint}).`
    : "No installation key is stored in this browser yet.";
}

/**
 * Render what this extension is, and what the host has to be told about it.
 *
 * The id is the one thing the person cannot work out on their own: it is
 * shown in the browser's extension manager, but a person who is setting the
 * bridge up has no reason to go and read it out of there, and a development
 * host needs it before it will admit this extension at all.
 *
 * A published build carries the store's public key, so its id is fixed and
 * the released WebUI package already knows it: there is nothing to configure
 * on the host side. A local build's id comes from the folder it was loaded
 * from, so it differs per machine and the host has to be told.
 */
async function renderIdentity(): Promise<void> {
  const extensionId = chrome.runtime.id;
  const kind = webuiBrowserBridgeBuildKind(chrome.runtime.getManifest());
  const browser = webuiBrowserBridgeBrowserName(navigator.userAgent);
  extensionIdInput.value = extensionId;
  hostAllowlistInput.value = webuiBrowserBridgeDevelopmentAllowlistLine(
    browser,
    extensionId,
  );
  buildKind.textContent =
    kind === "published"
      ? "This is the published build. Its identity is fixed by the store's key, so it is the same on every machine."
      : "This is a local build. Its identity comes from the folder it was loaded from, so it differs on every machine.";
  identityNote.textContent =
    kind === "published"
      ? "Nothing to set on the host side. A released WebUI package admits the published extension, and a development WebUI learns this extension the first time it proves the installation key."
      : "Nothing to set on the host side. A development WebUI learns this extension the first time it proves the installation key.";
}

/** Put a value on the clipboard, or say that the clipboard was not there. */
async function copyValue(value: string): Promise<void> {
  try {
    if (!navigator.clipboard) throw new Error("no clipboard");
    await navigator.clipboard.writeText(value);
    say("Copied to the clipboard.");
  } catch {
    say("The clipboard is not available here — select the text and copy it.");
  }
}

/**
 * Wakes the worker and then says what happened.
 *
 * A Manifest V3 service worker is lazy: it starts on an event and is torn
 * down when it goes idle. Saving does not wake it, so without this the
 * extension would sit there configured but unconnected — and the person
 * would have to reload the extension by hand to find out.
 */
async function wake(): Promise<void> {
  // The previous outcome is cleared first, so what the page reports is this
  // attempt's and not an earlier one. A timestamp would not do it: the
  // worker parks its failure the moment it starts, which can be within a
  // second of the paste, and a failure that old would still look fresh.
  await chrome.storage.session
    .remove([
      WEBUI_BROWSER_BRIDGE_STATUS_STORAGE_KEY,
      WEBUI_BROWSER_BRIDGE_LAST_ERROR_STORAGE_KEY,
    ])
    .catch(() => undefined);
  try {
    const reply = await chrome.runtime.sendMessage({
      type: WEBUI_BROWSER_BRIDGE_RECONNECT_MESSAGE,
    });
    if (!(reply && typeof reply === "object" && (reply as { ok?: unknown }).ok === true)) {
      say(
        "Saved. The extension could not be woken to connect — reload the extension and try again.",
      );
      return;
    }
  } catch {
    say("Saved. The extension could not be woken to connect — reload the extension and try again.");
    return;
  }
  await reportOutcome();
}

/**
 * Reports what the worker made of the configuration.
 *
 * The worker parks the connection status and its last failure in session
 * storage, so the page can answer the only question the person asked: did it
 * connect? A failure older than this attempt is somebody else's — it is
 * ignored, because an error from before the paste says nothing about the
 * paste.
 */
async function reportOutcome(): Promise<void> {
  const deadline = Date.now() + OUTCOME_WAIT_MS;
  while (Date.now() < deadline) {
    const [status, failure] = await Promise.all([
      chrome.storage.session.get(WEBUI_BROWSER_BRIDGE_STATUS_STORAGE_KEY),
      chrome.storage.session.get(WEBUI_BROWSER_BRIDGE_LAST_ERROR_STORAGE_KEY),
    ]);
    if (status[WEBUI_BROWSER_BRIDGE_STATUS_STORAGE_KEY] === "connected") {
      say("Connected to the WebUI.");
      return;
    }
    const parked = failure[WEBUI_BROWSER_BRIDGE_LAST_ERROR_STORAGE_KEY];
    if (parked !== undefined) {
      say(failureMessage(parked));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  say("Still connecting to the WebUI…");
}

/** The message of a parked failure, or a generic one. */
function failureMessage(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    return "the extension could not connect to the WebUI";
  }
  const message = (value as { message?: unknown }).message;
  return typeof message === "string"
    ? message
    : "the extension could not connect to the WebUI";
}

async function onSaveOrigin(): Promise<void> {
  try {
    await writeWebuiBrowserBridgeOrigin(chrome.storage.local, originInput.value);
  } catch (error) {
    say(error instanceof Error ? error.message : "the WebUI address was not saved");
    return;
  }
  await renderOrigin();
  // The page knows what is still missing, so it says it rather than waking
  // the worker into a failure the person has to interpret. The order of the
  // two settings is the order of the two steps.
  const stored = await webuiBrowserBridgeInstallationKeyStatus(
    webuiBrowserBridgeInstallationKeyStore(chrome.storage.local),
  );
  if (!stored.stored) {
    say("Address saved. Now paste the installation key from the WebUI's Settings page and save it.");
    return;
  }
  say("Address saved. Connecting to the WebUI…");
  await wake();
}

async function onSave(): Promise<void> {
  try {
    await saveWebuiBrowserBridgeInstallationKey(
      webuiBrowserBridgeInstallationKeyStore(chrome.storage.local),
      input.value,
    );
  } catch (error) {
    say(error instanceof Error ? error.message : "the installation key was not saved");
    return;
  }
  // Clear the field immediately: the key is in storage, and leaving it in
  // the DOM is the one place this page could leak it.
  input.value = "";
  await renderStored();
  // Same rule the other way round: without an address the extension has
  // nothing to dial, and the worker would answer that with a failure about
  // an origin instead of a sentence about what to do next.
  const origin = await readWebuiBrowserBridgeOrigin(chrome.storage.local);
  if (!origin) {
    say("Key saved. Now set the WebUI address above and save it — the extension cannot connect without one.");
    return;
  }
  say("Saved. Connecting to the WebUI…");
  await wake();
}

async function onClear(): Promise<void> {
  await clearWebuiBrowserBridgeInstallationKey(
    webuiBrowserBridgeInstallationKeyStore(chrome.storage.local),
  );
  input.value = "";
  say("Cleared. Paste the key again to pair this browser.");
  await renderStored();
}

saveOrigin.addEventListener("click", () => {
  void onSaveOrigin();
});
save.addEventListener("click", () => {
  void onSave();
});
clear.addEventListener("click", () => {
  void onClear();
});
copyExtensionId.addEventListener("click", () => {
  void copyValue(extensionIdInput.value);
});
copyHostAllowlist.addEventListener("click", () => {
  void copyValue(hostAllowlistInput.value);
});
void renderIdentity();
void renderOrigin();
void renderStored();

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
void renderOrigin();
void renderStored();

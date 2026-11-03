// The page half of the Mini App bridge, served by the proxy.
//
// A Mini App page reaches its host through `window.mcode.miniapp.*`. On the
// electron app that namespace comes from an Electron preload; a browser tab
// cannot install one, so the proxy injects a script and this module is it. The
// namespace's composer method is `message.append(text)`: it resolves on a
// confirmed append and rejects with the failure code — the same codes, because a
// page written against the electron app must not see a different vocabulary here.
//
// The page half knows no identity. It cannot name a session or a plugin: the
// host supplies both from the view it framed, so the most a page can ask for is
// "append this to whoever is hosting me".
//
// `postMessage` needs a target origin, and the page does not know the client's
// origin — so it posts to `*` and the *host* is what refuses a foreign sender.
// That direction is deliberate: the check belongs where the trusted side is, and
// the payload the page can reach is a bounded string that a person confirms.

import {
  WEBUI_MINIAPP_BRIDGE_APPEND_REPLY,
  WEBUI_MINIAPP_BRIDGE_APPEND_REQUEST,
  WEBUI_MINIAPP_BRIDGE_PATH,
  WEBUI_MINIAPP_COMPOSER_MAX_TEXT_LENGTH,
} from "../../shared/contracts/miniapp.js";
import {
  WEBUI_MINIAPP_BRIDGE_AGENT_EVENT,
  WEBUI_MINIAPP_BRIDGE_AGENT_OBSERVE,
  WEBUI_MINIAPP_BRIDGE_AGENT_OBSERVE_END,
  WEBUI_MINIAPP_BRIDGE_AGENT_OBSERVE_EVENT,
  WEBUI_MINIAPP_BRIDGE_AGENT_REQUEST,
  WEBUI_MINIAPP_BRIDGE_AGENT_RESULT,
} from "../../shared/contracts/miniapp-agent.js";
import {
  WEBUI_MINIAPP_BRIDGE_TOOL_REQUEST,
  WEBUI_MINIAPP_BRIDGE_TOOL_RESULT,
  WEBUI_MINIAPP_TOOL_MAX_NAMES,
} from "../../shared/contracts/miniapp-tools.js";
import {
  WEBUI_MINIAPP_BRIDGE_WINDOW_REQUEST,
  WEBUI_MINIAPP_BRIDGE_WINDOW_STATE,
} from "../../shared/contracts/miniapp-window.js";
import type { MiniAppPageBridge } from "./proxy.js";

/**
 * The script the proxy serves at `WEBUI_MINIAPP_BRIDGE_PATH`.
 *
 * A string rather than a file: the proxy injects it into a document, and a
 * bundler that resolved it as a module would give it a module's scope instead of
 * the page's. Written out once, so the path the tag names and the body it serves
 * cannot disagree.
 */
const SCRIPT = `(function () {
  "use strict";
  var REQUEST = ${JSON.stringify(WEBUI_MINIAPP_BRIDGE_APPEND_REQUEST)};
  var REPLY = ${JSON.stringify(WEBUI_MINIAPP_BRIDGE_APPEND_REPLY)};
  var MAX_TEXT = ${WEBUI_MINIAPP_COMPOSER_MAX_TEXT_LENGTH};
  var sequence = 0;
  var pending = new Map();
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || typeof data !== "object" || data.type !== REPLY) return;
    if (typeof data.requestId !== "string") return;
    var settle = pending.get(data.requestId);
    if (!settle) return;
    pending.delete(data.requestId);
    settle(data.result);
  });
  function append(text) {
    return new Promise(function (resolve, reject) {
      if (typeof text !== "string") {
        reject(new Error("invalid_request"));
        return;
      }
      if (text.length > MAX_TEXT) {
        reject(new Error("text_too_large"));
        return;
      }
      sequence += 1;
      var requestId = "miniapp-" + Date.now().toString(36) + "-" + sequence;
      pending.set(requestId, function (result) {
        if (result && result.success === true) {
          resolve();
          return;
        }
        reject(new Error(result && result.code ? result.code : "result_unknown"));
      });
      window.parent.postMessage({ type: REQUEST, requestId: requestId, text: text }, "*");
    });
  }
  var mcode = (window.mcode = window.mcode || {});
  mcode.miniapp = mcode.miniapp || {};
  var capabilities = [
    "message.append",
    "tools.list",
    "tools.request",
    "tools.call",
    "agent.run",
    "agent.open",
    "agent.models",
    "agent.agents",
    "agent.create",
    "agent.sessions",
    "agent.session",
    "agent.observe",
    "window"
  ];
  mcode.miniapp.capabilities = mcode.miniapp.capabilities || {};
  mcode.miniapp.capabilities.has = function (name) {
    return typeof name === "string" && capabilities.indexOf(name) !== -1;
  };
  mcode.miniapp.message = mcode.miniapp.message || {};
  mcode.miniapp.message.append = append;
  // ---------------------------------------------------------------------
  // The agent block: window.mcode.miniapp.agent.
  //
  // The same namespace as the electron app's preload, so a page written against
  // it finds every method here. What changes is the transport: a browser page
  // cannot call a preload, so each call is one postMessage and the client that
  // framed the page answers it. Identity never travels from here — the page
  // names content and a correlation id, nothing else.
  //
  // cancel names a live request instead of dropping a promise: an abort signal
  // cannot cross postMessage, so the page asks the host to stop that request and
  // the answer is the request's own settlement.
  // ---------------------------------------------------------------------
  var AGENT_REQUEST = ${JSON.stringify(WEBUI_MINIAPP_BRIDGE_AGENT_REQUEST)};
  var AGENT_RESULT = ${JSON.stringify(WEBUI_MINIAPP_BRIDGE_AGENT_RESULT)};
  var AGENT_EVENT = ${JSON.stringify(WEBUI_MINIAPP_BRIDGE_AGENT_EVENT)};
  var agentPrefix = Math.random().toString(36).slice(2, 10);
  var agentSequence = 0;
  var agentPending = new Map();
  function agentSettle(requestId, result) {
    var entry = agentPending.get(requestId);
    if (!entry) return;
    agentPending.delete(requestId);
    if (result && result.ok === true) {
      entry.resolve(result.value);
      return;
    }
    var code = result && typeof result.code === "string" ? result.code : "result_unknown";
    var error = new Error(code);
    if (result && typeof result.reason === "string") error.reason = result.reason;
    entry.reject(error);
  }
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === AGENT_RESULT) {
      if (typeof data.requestId === "string") agentSettle(data.requestId, data.result);
      return;
    }
    if (data.type === AGENT_EVENT) {
      if (typeof data.requestId !== "string") return;
      var entry = agentPending.get(data.requestId);
      if (!entry || typeof entry.onEvent !== "function") return;
      try {
        entry.onEvent(data.event);
      } catch (ignored) {
        // A page callback that throws must not end the turn or the stream.
      }
    }
  });
  function agentRequest(method, payload, options) {
    return new Promise(function (resolve, reject) {
      var onEvent = options && typeof options.onEvent === "function" ? options.onEvent : undefined;
      var requestId =
        payload && typeof payload.requestId === "string" && payload.requestId
          ? payload.requestId
          : agentPrefix + "-" + (++agentSequence);
      if (agentPending.has(requestId)) {
        reject(new Error("busy"));
        return;
      }
      agentPending.set(requestId, { resolve: resolve, reject: reject, onEvent: onEvent });
      // Every field travels: a reply's own requestId is the permission ask it
      // answers, and stripping it would leave the host with nothing to decide.
      var body = {};
      if (payload && typeof payload === "object") {
        for (var key in payload) {
          if (Object.prototype.hasOwnProperty.call(payload, key)) body[key] = payload[key];
        }
      }
      try {
        window.parent.postMessage(
          {
            type: AGENT_REQUEST,
            requestId: requestId,
            method: method,
            payload: body,
            observe: onEvent !== undefined
          },
          "*"
        );
      } catch (error) {
        agentPending.delete(requestId);
        reject(new Error("result_unknown"));
      }
    });
  }
  // ---------------------------------------------------------------------
  // Watches: a page asks to be told about turns as they settle.
  //
  // A watch has no result, so it is not an agentRequest: OBSERVE opens it,
  // OBSERVE_EVENT carries each settled turn, OBSERVE_END closes it. The page's
  // promise settles at the end — with nothing on success, because there is nothing to
  // return, and with the runtime's code when the watch could not open.
  // ---------------------------------------------------------------------
  var AGENT_OBSERVE = ${JSON.stringify(WEBUI_MINIAPP_BRIDGE_AGENT_OBSERVE)};
  var AGENT_OBSERVE_EVENT = ${JSON.stringify(WEBUI_MINIAPP_BRIDGE_AGENT_OBSERVE_EVENT)};
  var AGENT_OBSERVE_END = ${JSON.stringify(WEBUI_MINIAPP_BRIDGE_AGENT_OBSERVE_END)};
  var agentWatches = new Map();
  var agentWatchSequence = 0;
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === AGENT_OBSERVE_EVENT) {
      var watch = agentWatches.get(data.requestId);
      if (!watch) return;
      try {
        watch.onEvent(data.event);
      } catch (error) {
        // A page's own handler failing is the page's problem.
      }
      return;
    }
    if (data.type === AGENT_OBSERVE_END) {
      var ended = agentWatches.get(data.requestId);
      if (!ended) return;
      agentWatches.delete(data.requestId);
      if (data.ok === true) ended.resolve();
      else ended.reject(new Error(typeof data.code === "string" ? data.code : "result_unknown"));
    }
  });
  mcode.miniapp.agent = {
    run: function (input, options) {
      return agentRequest("run", input, options);
    },
    answer: function (input, options) {
      return agentRequest("answer", input, options);
    },
    reply: function (input) {
      return agentRequest("reply", input);
    },
    open: function (sessionId) {
      return agentRequest("open", { sessionId: sessionId });
    },
    models: function () {
      return agentRequest("models", {});
    },
    agents: function () {
      return agentRequest("agents", {});
    },
    sessions: function () {
      return agentRequest("sessions", {});
    },
    session: function (sessionId) {
      return agentRequest("session", sessionId === undefined ? {} : { sessionId: sessionId });
    },
    create: function (input) {
      return agentRequest("create", input);
    },
    observe: function (input, options) {
      var request = input && typeof input === "object" ? input : {};
      var listener = options && typeof options.onEvent === "function" ? options.onEvent : null;
      if (!listener) return Promise.reject(new Error("invalid_request"));
      var all = request.all === true;
      if (!all && (typeof request.sessionId !== "string" || request.sessionId.length === 0)) {
        return Promise.reject(new Error("invalid_request"));
      }
      agentWatchSequence += 1;
      var requestId = "watch-" + Date.now().toString(36) + "-" + agentWatchSequence;
      return new Promise(function (resolve, reject) {
        agentWatches.set(requestId, { onEvent: listener, resolve: resolve, reject: reject });
        var message = { type: AGENT_OBSERVE, requestId: requestId };
        if (all) message.all = true;
        else message.sessionId = request.sessionId;
        try {
          window.parent.postMessage(message, "*");
        } catch (error) {
          agentWatches.delete(requestId);
          reject(error);
        }
      });
    },
    cancel: function (requestId) {
      if (typeof requestId !== "string") return;
      var watch = agentWatches.get(requestId);
      if (watch) {
        // Closing a watch is the page's own decision: its promise settles here, and the
        // host is told so it closes the stream behind it.
        agentWatches.delete(requestId);
        watch.resolve();
        try {
          window.parent.postMessage(
            { type: AGENT_OBSERVE_END, requestId: requestId, cancel: true },
            "*"
          );
        } catch (ignored) {
          // The document is going away; the stream dies with it.
        }
        return;
      }
      if (!agentPending.has(requestId)) return;
      try {
        window.parent.postMessage(
          { type: AGENT_REQUEST, requestId: requestId, method: "cancel", payload: {}, observe: false },
          "*"
        );
      } catch (ignored) {
        // The document is going away; there is nothing left to cancel.
      }
    }
  };
  // ---------------------------------------------------------------------
  // The tool block: window.mcode.miniapp.tools.
  //
  // A page asks which tools the Host may let it use, asks for approval of the rest,
  // and calls one. Identity never travels from here: the host knows which Mini App it
  // framed, and a page that could name another would be calling with someone else's
  // permissions. A request that cannot be one this host answers is refused before it
  // is sent, so a malformed call never reaches the client.
  // ---------------------------------------------------------------------
  var TOOL_REQUEST = ${JSON.stringify(WEBUI_MINIAPP_BRIDGE_TOOL_REQUEST)};
  var TOOL_RESULT = ${JSON.stringify(WEBUI_MINIAPP_BRIDGE_TOOL_RESULT)};
  var TOOL_MAX_NAMES = ${WEBUI_MINIAPP_TOOL_MAX_NAMES};
  var toolSequence = 0;
  var toolPending = new Map();
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || typeof data !== "object" || data.type !== TOOL_RESULT) return;
    if (typeof data.requestId !== "string") return;
    var settle = toolPending.get(data.requestId);
    if (!settle) return;
    toolPending.delete(data.requestId);
    settle(data.result);
  });
  function toolRequest(method, body) {
    return new Promise(function (resolve, reject) {
      toolSequence += 1;
      var requestId = "tool-" + Date.now().toString(36) + "-" + toolSequence;
      toolPending.set(requestId, function (result) {
        if (result && result.ok === true) {
          resolve(result.value);
          return;
        }
        reject(new Error(result && typeof result.code === "string" ? result.code : "result_unknown"));
      });
      var message = { type: TOOL_REQUEST, requestId: requestId, method: method };
      if (body && typeof body === "object") {
        for (var key in body) {
          if (Object.prototype.hasOwnProperty.call(body, key)) message[key] = body[key];
        }
      }
      window.parent.postMessage(message, "*");
    });
  }
  function rejectInvalid() {
    return Promise.reject(new Error("invalid_request"));
  }
  mcode.miniapp.tools = {
    list: function () {
      return toolRequest("list");
    },
    request: function (names) {
      if (!Array.isArray(names) || names.length === 0 || names.length > TOOL_MAX_NAMES) {
        return rejectInvalid();
      }
      for (var index = 0; index < names.length; index += 1) {
        if (typeof names[index] !== "string" || names[index].length === 0) return rejectInvalid();
      }
      return toolRequest("request", { names: names });
    },
    call: function (name, input) {
      if (typeof name !== "string" || name.length === 0) return rejectInvalid();
      return toolRequest("call", { name: name, arguments: input });
    }
  };
  // ---------------------------------------------------------------------
  // The box this page is shown in.
  //
  // A page that asks for a window wants to move and resize itself. This client
  // has no window to give it, so the host draws a floating box inside the page
  // the person is already looking at — the same view, the same document, a
  // different layout. The patch is forwarded unexamined: the host owns the
  // bounds and is the only side that can say what it honours.
  // ---------------------------------------------------------------------
  var WINDOW_REQUEST = ${JSON.stringify(WEBUI_MINIAPP_BRIDGE_WINDOW_REQUEST)};
  var WINDOW_STATE = ${JSON.stringify(WEBUI_MINIAPP_BRIDGE_WINDOW_STATE)};
  var windowSequence = 0;
  var windowPending = new Map();
  var windowListeners = [];
  var originalWindowBackgrounds = new WeakMap();
  function setWindowSurfaceTransparent(transparent) {
    var elements = [document.documentElement, document.body];
    for (var surfaceIndex = 0; surfaceIndex < elements.length; surfaceIndex += 1) {
      var element = elements[surfaceIndex];
      if (!element) continue;
      if (!originalWindowBackgrounds.has(element)) {
        originalWindowBackgrounds.set(element, {
          value: element.style.getPropertyValue("background-color"),
          priority: element.style.getPropertyPriority("background-color")
        });
      }
      if (transparent) {
        element.style.setProperty("background-color", "transparent", "important");
      } else {
        var original = originalWindowBackgrounds.get(element);
        if (original.value) element.style.setProperty("background-color", original.value, original.priority);
        else element.style.removeProperty("background-color");
      }
    }
  }
  var windowSurfaceObserver = new MutationObserver(function () {
    if (document.body && windowSurfaceObserver) {
      var lastWindowState = window.__mcodeMiniAppWindowState;
      if (lastWindowState) setWindowSurfaceTransparent(lastWindowState.mode === "window" && lastWindowState.window && lastWindowState.window.transparent === true);
      if (document.body) windowSurfaceObserver.disconnect();
    }
  });
  windowSurfaceObserver.observe(document.documentElement, { childList: true });
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || typeof data !== "object" || data.type !== WINDOW_STATE) return;
    window.__mcodeMiniAppWindowState = data.state;
    setWindowSurfaceTransparent(data.state && data.state.mode === "window" && data.state.window && data.state.window.transparent === true);
    if (typeof data.requestId === "string") {
      var settle = windowPending.get(data.requestId);
      if (settle) {
        windowPending.delete(data.requestId);
        settle(data.state);
      }
    }
    for (var index = 0; index < windowListeners.length; index += 1) {
      try {
        windowListeners[index](data.state);
      } catch (error) {
        // One listener throwing is that listener's problem, not the page's.
      }
    }
  });
  /**
   * How long a page waits for the box it asked about.
   *
   * A page that asks and never hears back does not degrade: it keeps the promise in its
   * initialisation path, so nothing after it runs and the page renders half of itself.
   * The page this channel serves treats a rejected getState as "no window here" and
   * falls back to the panel, so answering nothing is the one outcome it cannot handle.
   */
  var WINDOW_TIMEOUT_MS = 800;
  function windowRequest(method, patch) {
    return new Promise(function (resolve, reject) {
      windowSequence += 1;
      var requestId = "window-" + Date.now().toString(36) + "-" + windowSequence;
      var timer = setTimeout(function () {
        if (!windowPending.has(requestId)) return;
        windowPending.delete(requestId);
        reject(new Error("result_unknown"));
      }, WINDOW_TIMEOUT_MS);
      windowPending.set(requestId, function (state) {
        clearTimeout(timer);
        resolve(state);
      });
      var message = { type: WINDOW_REQUEST, requestId: requestId, method: method };
      if (patch && typeof patch === "object") message.patch = patch;
      window.parent.postMessage(message, "*");
    });
  }
  mcode.miniapp.window = {
    getState: function () {
      return windowRequest("get");
    },
    update: function (patch) {
      if (!patch || typeof patch !== "object") return Promise.reject(new Error("invalid_request"));
      return windowRequest("update", patch);
    },
    focus: function () {
      return windowRequest("focus");
    },
    onDidChangeState: function (listener) {
      if (typeof listener !== "function") return { dispose: function () {} };
      windowListeners.push(listener);
      return {
        dispose: function () {
          var at = windowListeners.indexOf(listener);
          if (at !== -1) windowListeners.splice(at, 1);
        }
      };
    }
  };
})();
`;

/** The bridge the proxy injects into every document it serves. */
export function miniAppPageBridge(): MiniAppPageBridge {
  return { path: WEBUI_MINIAPP_BRIDGE_PATH, script: SCRIPT };
}

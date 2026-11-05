// The page half of the shared-port routing contract.
//
// Every Mini App is published on one port, so the proxy can no longer tell
// whose request it is by the port it arrived on. A Mini App's own page asks
// its server for root-absolute paths — `/api/…`, `/styles.css` — because
// that is how it was written against its own origin, and those paths reach the
// shared port without saying whose they are.
//
// So the page says so itself. This shim is injected into every document the
// proxy serves, before the page's own scripts run:
//
//   * it stamps the Mini App's name on the requests the page makes, so the
//     proxy can route a request that names no path prefix;
//   * it names the Mini App in a socket URL, where a header cannot travel;
//   * it namespaces the page's own storage, because Mini Apps that used to have
//     an origin each now share one.
//
// The shim never fails the page: a browser that refuses one of these
// replacements keeps the behaviour it had.

/**
 * The header a page's own requests carry, naming the Mini App they belong to.
 *
 * A header rather than a path, because a Mini App's paths are its own: the
 * page asks for `/api/bootstrap`, and the proxy has to answer with that
 * Mini App's server.
 */
export const MINIAPP_ROUTE_HEADER = "x-mcode-miniapp-route";

/**
 * The query parameter a socket URL carries, naming the Mini App it belongs to.
 *
 * A WebSocket handshake carries no header this shim could set, so the name
 * travels in the URL instead. The proxy consumes it and never forwards it.
 */
export const MINIAPP_ROUTE_PARAM = "mcode_route";

/**
 * The path segment a Mini App is served under.
 *
 * The same segment the proxy routes on and the bridge script is served under,
 * so the two cannot disagree.
 */
export function miniAppRouteSegment(pluginId: string): string {
  return encodeURIComponent(pluginId);
}

/**
 * The shim a Mini App's document runs before its own scripts.
 *
 * A string rather than a file: the proxy injects it into a document, and a
 * bundler that resolved it as a module would give it a module's scope instead
 * of the page's.
 */
export function miniAppRouteShim(pluginId: string): string {
  return `(function () {
  "use strict";
  var PLUGIN = ${JSON.stringify(pluginId)};
  var ROUTE_HEADER = ${JSON.stringify(MINIAPP_ROUTE_HEADER)};
  var ROUTE_PARAM = ${JSON.stringify(MINIAPP_ROUTE_PARAM)};
  var STORAGE_PREFIX = "mcode.miniapp." + PLUGIN + ".";
  window.__mcodeMiniAppPlugin = PLUGIN;
  function href() {
    if (typeof window === "undefined" || !window.location) return undefined;
    return window.location.href;
  }
  function sameHost(url) {
    var base = href();
    if (!base) return false;
    try {
      return new URL(String(url), base).host === window.location.host;
    } catch (error) {
      return false;
    }
  }
  function withRouteParam(url) {
    var base = href();
    if (!base) return url;
    try {
      var parsed = new URL(String(url), base);
      if (parsed.host !== window.location.host) return url;
      parsed.searchParams.set(ROUTE_PARAM, PLUGIN);
      return parsed.toString();
    } catch (error) {
      return url;
    }
  }
  try {
    if (typeof window.fetch === "function" && typeof Headers === "function") {
      var realFetch = window.fetch;
      window.fetch = function (input, init) {
        try {
          var url =
            typeof input === "string"
              ? input
              : input && typeof input.url === "string"
                ? input.url
                : "";
          if (url && sameHost(url)) {
            var headers = new Headers((init && init.headers) || undefined);
            if (!headers.has(ROUTE_HEADER)) headers.set(ROUTE_HEADER, PLUGIN);
            if (init) {
              var next = {};
              for (var key in init) {
                if (Object.prototype.hasOwnProperty.call(init, key)) next[key] = init[key];
              }
              next.headers = headers;
              init = next;
            } else {
              init = { headers: headers };
            }
          }
        } catch (error) {
          // An input this shim cannot read goes out unchanged.
        }
        return realFetch.call(window, input, init);
      };
    }
  } catch (error) {
    // A browser that refuses the replacement keeps the one it had.
  }
  try {
    if (typeof window.XMLHttpRequest === "function") {
      var prototype = window.XMLHttpRequest.prototype;
      var realOpen = prototype.open;
      prototype.open = function () {
        var result = realOpen.apply(this, arguments);
        try {
          if (sameHost(arguments[1])) this.setRequestHeader(ROUTE_HEADER, PLUGIN);
        } catch (error) {
          // The request is already open, or the page is not asking this origin.
        }
        return result;
      };
    }
  } catch (error) {
    // A browser that refuses the replacement keeps the one it had.
  }
  try {
    if (typeof window.WebSocket === "function") {
      var RealWebSocket = window.WebSocket;
      var WrappedWebSocket = function (url, protocols) {
        var target = withRouteParam(url);
        if (protocols === undefined) return new RealWebSocket(target);
        return new RealWebSocket(target, protocols);
      };
      WrappedWebSocket.prototype = RealWebSocket.prototype;
      WrappedWebSocket.CONNECTING = RealWebSocket.CONNECTING;
      WrappedWebSocket.OPEN = RealWebSocket.OPEN;
      WrappedWebSocket.CLOSING = RealWebSocket.CLOSING;
      WrappedWebSocket.CLOSED = RealWebSocket.CLOSED;
      Object.defineProperty(window, "WebSocket", {
        value: WrappedWebSocket,
        configurable: true,
        writable: true,
      });
    }
  } catch (error) {
    // A browser that refuses the replacement keeps the one it had.
  }
  try {
    if (typeof window.EventSource === "function") {
      var RealEventSource = window.EventSource;
      var WrappedEventSource = function (url, config) {
        var target = withRouteParam(url);
        if (config === undefined) return new RealEventSource(target);
        return new RealEventSource(target, config);
      };
      WrappedEventSource.prototype = RealEventSource.prototype;
      Object.defineProperty(window, "EventSource", {
        value: WrappedEventSource,
        configurable: true,
        writable: true,
      });
    }
  } catch (error) {
    // A browser that refuses the replacement keeps the one it had.
  }
  try {
    if (window.navigator && typeof window.navigator.sendBeacon === "function") {
      var realBeacon = window.navigator.sendBeacon;
      window.navigator.sendBeacon = function (url, data) {
        return realBeacon.call(window.navigator, withRouteParam(url), data);
      };
    }
  } catch (error) {
    // A browser that refuses the replacement keeps the one it had.
  }
  function scopedStorage(real) {
    function names() {
      var out = [];
      for (var index = 0; index < real.length; index += 1) {
        var name = real.key(index);
        if (typeof name === "string" && name.indexOf(STORAGE_PREFIX) === 0) {
          out.push(name.slice(STORAGE_PREFIX.length));
        }
      }
      return out;
    }
    function scopedKey(key) {
      return STORAGE_PREFIX + String(key);
    }
    var target = {
      get length() {
        return names().length;
      },
      key: function (index) {
        var list = names();
        return index >= 0 && index < list.length ? list[index] : null;
      },
      getItem: function (key) {
        var value = real.getItem(scopedKey(key));
        return value === null ? null : value;
      },
      setItem: function (key, value) {
        real.setItem(scopedKey(key), String(value));
      },
      removeItem: function (key) {
        real.removeItem(scopedKey(key));
      },
      clear: function () {
        var list = names();
        for (var index = 0; index < list.length; index += 1) real.removeItem(scopedKey(list[index]));
      }
    };
    // A page that reads a key as a property, or lists the keys it holds, sees
    // what a native Storage would show it: its own keys, and no other Mini
    // App's.
    return new Proxy(target, {
      get: function (object, property) {
        if (property in object) return object[property];
        if (typeof property !== "string") return undefined;
        var value = real.getItem(scopedKey(property));
        return value === null ? undefined : value;
      },
      set: function (object, property, value) {
        if (property in object) {
          object[property] = value;
          return true;
        }
        real.setItem(scopedKey(property), String(value));
        return true;
      },
      has: function (object, property) {
        if (property in object) return true;
        if (typeof property !== "string") return false;
        return real.getItem(scopedKey(property)) !== null;
      },
      deleteProperty: function (object, property) {
        if (typeof property === "string") real.removeItem(scopedKey(property));
        return true;
      },
      ownKeys: function () {
        return names();
      },
      getOwnPropertyDescriptor: function (object, property) {
        if (typeof property !== "string") return undefined;
        if (names().indexOf(property) === -1) return undefined;
        return {
          value: real.getItem(scopedKey(property)),
          enumerable: true,
          configurable: true,
          writable: true,
        };
      }
    });
  }
  try {
    var realStorage = window.localStorage;
    if (realStorage) {
      Object.defineProperty(window, "localStorage", {
        value: scopedStorage(realStorage),
        configurable: true,
        writable: true,
      });
    }
  } catch (error) {
    // A browser that refuses the replacement keeps the shared storage.
  }
  try {
    var realIdb = window.indexedDB;
    if (realIdb && typeof realIdb.open === "function") {
      var scopedIdb = {
        open: function (name, version) {
          if (version === undefined) return realIdb.open(STORAGE_PREFIX + String(name));
          return realIdb.open(STORAGE_PREFIX + String(name), version);
        },
        deleteDatabase: function (name) {
          return realIdb.deleteDatabase(STORAGE_PREFIX + String(name));
        },
        cmp: function (first, second) {
          return realIdb.cmp(first, second);
        }
      };
      if (typeof realIdb.databases === "function") {
        scopedIdb.databases = function () {
          return realIdb.databases().then(function (list) {
            return (list || []).map(function (entry) {
              var copy = {};
              for (var key in entry) {
                if (Object.prototype.hasOwnProperty.call(entry, key)) copy[key] = entry[key];
              }
              if (typeof copy.name === "string" && copy.name.indexOf(STORAGE_PREFIX) === 0) {
                copy.name = copy.name.slice(STORAGE_PREFIX.length);
              }
              return copy;
            });
          });
        };
      }
      Object.defineProperty(window, "indexedDB", {
        value: scopedIdb,
        configurable: true,
        writable: true,
      });
    }
  } catch (error) {
    // A browser that refuses the replacement keeps the shared storage.
  }
})();
`;
}

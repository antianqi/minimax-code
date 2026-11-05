import http from 'node:http';
import net from 'node:net';
import { type Readable } from 'node:stream';

import { isWebuiMiniAppOpenPath } from "../../shared/contracts/miniapp.js";
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

import { isLoopbackHost } from "../access-policy.js";
import {
  credentialCookie,
  credentialFromCookie,
  credentialMatches,
  type WebuiCredential,
} from "../credentials.js";
import {
  MINIAPP_ROUTE_HEADER as ROUTE_HEADER,
  MINIAPP_ROUTE_PARAM as ROUTE_PARAM,
  miniAppRouteSegment,
} from "./route-shim.js";

/**
 * The Mini App's real origin and the credential its own guard demands.
 *
 * Server-only by construction: it arrives from the runtime port capability and never travels further
 * than this module. The client is given `viewUrl`, which points at this proxy instead.
 */
export interface MiniAppProxyTarget {
  readonly pluginId: string;
  readonly upstreamOrigin: string;
  /** The runtime-selected page the client should frame, including its query. */
  readonly surfacePath: string;
  /**
   * The origin-relative page the Agent named, when it named one.
   *
   * It replaces the declared surface for this presentation, exactly as it does
   * in the shipped runtime: the path is resolved against the Mini App's own
   * origin, and this proxy forwards paths unchanged, so the page the client
   * frames here is the page the Mini App serves there.
   */
  readonly path?: string;
  readonly credential: string;
  /** Request header the upstream guard reads the credential from. */
  readonly credentialHeader: string;
}

export interface MiniAppProxy {
  /** What the client frames. Never the Mini App's own origin. */
  readonly viewUrl: string;
  readonly port: number;
  close(): Promise<void>;
}

/**
 * The page bridge the proxy injects into the Mini App's document.
 *
 * The proxy owns the seam — which document, where the tag goes, what headers survive — while the script
 * itself belongs to the bridge, which knows what `window.mcode.miniapp` exposes.
 */
export interface MiniAppPageBridge {
  /** Absolute path on the proxy origin that serves the script, e.g. `/__miniapp/<plugin>/bridge.js`. */
  readonly path: string;
  readonly script: string;
}

/**
 * One Mini App's registration on the shared listener.
 *
 * The target is what the runtime issued for this launch; the bridge is the
 * script the proxy injects into the document it serves for this plugin.
 */
export interface MiniAppProxyRegistration {
  readonly target: MiniAppProxyTarget;
  readonly bridge?: MiniAppPageBridge;
}

/**
 * The port every Mini App is published on.
 *
 * One port for all of them, so a Mini App that arrives in the store does not
 * ask the deployment for another firewall rule and another port forward. The
 * Mini Apps are told apart by the path they are served under, not by the port
 * they answer on.
 */
export const DEFAULT_MINIAPP_PROXY_PORT = 49_152;

/**
 * The query parameter and cookie name the proxy's gate reads.
 *
 * The name is namespaced so it cannot collide with a parameter the Mini App
 * itself serves, and the proxy strips it from the path it forwards.
 */
const PROXY_CREDENTIAL_PARAM = "webui_credential";

// How a request that names no Mini App says which one it belongs to.
//
// A Mini App's own page asks its server for `/api/…` and `/styles.css` —
// root-absolute paths, because that is how it was written against its own
// origin. Under one shared port those paths reach the proxy without saying
// whose they are, so the page says so itself: the bridge stamps a header on
// the requests it makes, and the browser's own `Referer` names the document a
// subresource came from. The names live with the page half of that contract.

/** The path segment the proxy serves a plugin's bridge script under. */
const BRIDGE_SEGMENT = "__miniapp";

const FRAME_BLOCKING_HEADERS = ['x-frame-options'] as const;
const CSP_HEADER = 'content-security-policy';

/** One Mini App's route on the shared listener. */
interface MiniAppRoute {
  readonly pluginId: string;
  /** The path segment this Mini App is served under. */
  readonly segment: string;
  readonly upstream: URL;
  readonly credential: string;
  readonly credentialHeader: string;
  readonly bridge?: MiniAppPageBridge;
}

/**
 * The shared Mini App listener.
 *
 * One port, every Mini App on it. A registration is a route on that listener,
 * and the routes are told apart by the path segment the Mini App is served
 * under (`/<pluginId>/…`).
 *
 * The trade-off is explicit: Mini Apps that used to have an origin each now
 * share one, so their `localStorage` and `IndexedDB` are the same store. The
 * bridge namespaces that storage per plugin, and the proxy namespaces the
 * cookies a Mini App sets, so two Mini Apps do not read each other's state.
 */
export interface MiniAppProxyHost {
  /** The port the listener answers on. */
  readonly port: number;
  /**
   * Registers a Mini App, replacing the route it already had.
   *
   * The handle it returns closes that registration only: the listener stays
   * up, because the next Mini App is served on the same port.
   */
  register: (registration: MiniAppProxyRegistration) => Promise<MiniAppProxy>;
  /** Closes the listener and every route on it. */
  close: () => Promise<void>;
}

/**
 * How a Mini App is registered on the shared listener.
 *
 * The handler registers through it, and a test substitutes it to observe which
 * target a launch produced without owning the published port.
 */
export type MiniAppProxyStarter = (
  registration: MiniAppProxyRegistration,
) => Promise<MiniAppProxy>;

export interface MiniAppProxyHostOptions {
  /**
   * The address the listener binds. Defaults to the loopback interface.
   *
   * A listener bound beyond loopback is published, and then it carries the
   * same gate the WebUI service has: the credential arrives in the framed
   * URL's query or in the cookie the frame response sets.
   */
  readonly host?: string;
  /** The port to bind. Defaults to {@link DEFAULT_MINIAPP_PROXY_PORT}. */
  readonly port?: number;
  /**
   * The WebUI's per-start credential, for a listener bound beyond loopback.
   *
   * The proxy injects the Mini App's own credential upstream, so a published
   * listener without this gate would hand that credential to anyone who can
   * route to the port.
   */
  readonly credential?: WebuiCredential;
}

/**
 * Starts the shared Mini App listener.
 *
 * The listener is the deployment's one published Mini App port: everything a
 * Mini App needs to be reachable from a browser is one firewall rule and one
 * port forward, whatever the store adds later.
 */
export async function startMiniAppProxyHost(
  options: MiniAppProxyHostOptions = {},
): Promise<MiniAppProxyHost> {
  const bindHost = options.host ?? '127.0.0.1';
  // A listener on the loopback interface is reachable only from this
  // machine. One bound beyond it is published, so it asks for the credential
  // the WebUI service asks for: the framed URL carries it once, and the
  // cookie the frame response sets carries it from then on.
  const published = !isLoopbackHost(bindHost);
  const credential = options.credential;
  /** The routes, by the path segment each Mini App is served under. */
  const bySegment = new Map<string, MiniAppRoute>();
  /** The routes, by plugin id: the bridge stamps the raw id on its requests. */
  const byPlugin = new Map<string, MiniAppRoute>();
  // Anything this listener owns that can be torn down: inbound sockets, forwarded requests, upgrade pairs.
  const sockets = new Set<{ destroy(): void }>();

  const server = http.createServer((request, response) => {
    if (published && credential) {
      const gate = presentedProxyCredential(request, credential);
      if (!gate.presented) {
        // A published listener that refuses a request is invisible from the
        // browser: the frame is blank and the console says nothing about why.
        // The request's own shape is what separates a frame that never had the
        // credential from one whose page had it and lost it.
        console.warn('[webui] miniapp proxy refused a request', {
          path: request.url,
          host: request.headers.host,
          origin: request.headers.origin,
        });
        response.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Unauthorized');
        return;
      }
      if (gate.inQuery) {
        // The credential is in the URL, so the framed document could read it
        // off its own address. The page is redirected to the same path
        // without it, and the cookie takes over from there.
        response.writeHead(302, {
          location: withoutProxyCredential(request.url),
          'set-cookie': credentialCookie(credential.token),
          'cache-control': 'no-store',
        });
        response.end();
        return;
      }
    }
    const url = new URL(request.url ?? '/', 'http://miniapp.invalid');
    const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
    const bridge = bridgeRequest(segments, bySegment);
    if (bridge) {
      response
        .writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
        .end(bridge.script);
      return;
    }
    const resolved = resolveRoute(request, url, segments, bySegment, byPlugin);
    if (!resolved.route) {
      // A request that names no Mini App and reaches no route is a page asking
      // for something the shared port cannot answer. Saying so is better than
      // forwarding it to a Mini App that did not ask for it.
      console.warn('[webui] miniapp proxy could not route a request', {
        path: request.url,
        host: request.headers.host,
        referer: request.headers.referer,
      });
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('No Mini App owns this request');
      return;
    }
    const route = resolved.route;
    const forwarded = http.request(
      {
        host: route.upstream.hostname,
        port: route.upstream.port,
        method: request.method,
        // The gate's parameter is consumed here and never reaches the Mini
        // App: a plugin that read it off its own address would learn a
        // credential that authorises the proxy.
        path: forwardedPath(url, resolved, published),
        headers: forwardedHeaders(request, route, published),
        agent: false,
      },
      (upstreamResponse) => {
        const headers = frameableHeaders(upstreamResponse.headers);
        // A Mini App's own cookies belong to that Mini App: they are renamed on
        // the way out and renamed back on the way in, so two Mini Apps sharing
        // this origin do not share a session.
        const scoped = scopedCookies(upstreamResponse.headers['set-cookie'], route);
        if (scoped) headers['set-cookie'] = scoped;
        else delete headers['set-cookie'];
        const location = headers.location;
        if (typeof location === 'string') headers.location = scopedLocation(location, route);
        if (!isHtml(upstreamResponse.headers) || !route.bridge) {
          response.writeHead(upstreamResponse.statusCode ?? 502, headers);
          upstreamResponse.pipe(response);
          return;
        }
        // The document is the one response this proxy rewrites: the page bridge has to be in it before
        // the page's own scripts run, and a page cannot be allowed to decide it will not be framed.
        let html: Readable;
        try {
          html = decodeHtmlResponse(upstreamResponse);
        } catch {
          response.writeHead(502, { 'content-type': 'text/plain' });
          response.end('Mini App HTML used an unsupported content encoding');
          upstreamResponse.destroy();
          return;
        }
        const chunks: Buffer[] = [];
        html.on('data', (chunk: Buffer | string) =>
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
        );
        html.on('end', () => {
          const body = Buffer.from(
            injectBridge(
              prefixDocumentUrls(Buffer.concat(chunks).toString('utf8'), route.segment),
              route.bridge as MiniAppPageBridge,
            ),
            'utf8',
          );
          // Rewriting invalidates compression, validators and upstream framing.
          delete headers['transfer-encoding'];
          delete headers['content-encoding'];
          headers['content-length'] = String(body.byteLength);
          delete headers.etag;
          delete headers['content-md5'];
          response.writeHead(upstreamResponse.statusCode ?? 502, headers);
          response.end(body);
        });
        html.on('error', () => response.destroy());
        upstreamResponse.on('error', () => response.destroy());
      },
    );
    forwarded.on('error', () => {
      if (!response.headersSent) {
        response.writeHead(502, { 'content-type': 'text/plain' });
      }
      response.end();
    });
    request.pipe(forwarded);
    sockets.add(forwarded);
    forwarded.once('close', () => sockets.delete(forwarded));
  });

  // Every socket this listener owns, so closing it cannot wait on a client that never said goodbye.
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  server.on('upgrade', (request, clientSocket, head) => {
    const url = new URL(request.url ?? '/', 'http://miniapp.invalid');
    const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
    const resolved = resolveRoute(request, url, segments, bySegment, byPlugin);
    if (!resolved.route) {
      clientSocket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    const route = resolved.route;
    const upstreamSocket = net.connect(
      { host: route.upstream.hostname, port: Number(route.upstream.port || 80) },
      () => {
        const headers = Object.entries(request.headers)
          .filter(([name, value]) => value !== undefined && name.toLowerCase() !== 'host')
          .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value}`);
        headers.push(`host: ${route.upstream.host}`);
        headers.push(`${route.credentialHeader}: ${route.credential}`);
        upstreamSocket.write(
          `${request.method} ${forwardedPath(url, resolved, published)} HTTP/1.1\r\n${headers.join('\r\n')}\r\n\r\n`,
        );
        if (head.length > 0) upstreamSocket.write(head);
        upstreamSocket.pipe(clientSocket);
        clientSocket.pipe(upstreamSocket);
      },
    );
    sockets.add(clientSocket);
    sockets.add(upstreamSocket);
    // A half-closed pair would leak the other end and keep the upstream server open forever.
    const teardown = () => {
      clientSocket.destroy();
      upstreamSocket.destroy();
      sockets.delete(clientSocket);
      sockets.delete(upstreamSocket);
    };
    clientSocket.once('close', teardown);
    upstreamSocket.once('close', teardown);
    upstreamSocket.once('error', teardown);
    clientSocket.once('error', teardown);
  });

  const port = options.port ?? DEFAULT_MINIAPP_PROXY_PORT;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, bindHost, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;

  return {
    port: boundPort,
    async register(registration: MiniAppProxyRegistration): Promise<MiniAppProxy> {
      const target = registration.target;
      const upstream = new URL(target.upstreamOrigin);
      if (upstream.protocol !== 'http:') {
        throw new TypeError('A Mini App proxy forwards to an http origin on loopback');
      }
      const surface = new URL(target.surfacePath, 'http://miniapp.invalid');
      if (!target.surfacePath.startsWith('/') || surface.origin !== 'http://miniapp.invalid') {
        throw new TypeError('A Mini App surface path must be an absolute path on its own origin');
      }
      const framed = new URL(target.path ?? target.surfacePath, 'http://miniapp.invalid');
      if (
        target.path !== undefined &&
        (!isWebuiMiniAppOpenPath(target.path) || framed.origin !== 'http://miniapp.invalid')
      ) {
        throw new TypeError('A Mini App open path must be an origin-relative path');
      }
      const segment = miniAppRouteSegment(target.pluginId);
      const route: MiniAppRoute = {
        pluginId: target.pluginId,
        segment,
        upstream,
        credential: target.credential,
        credentialHeader: target.credentialHeader,
        ...(registration.bridge ? { bridge: registration.bridge } : {}),
      };
      bySegment.set(segment, route);
      byPlugin.set(target.pluginId, route);
      // The client is handed the address the listener answers at. A wildcard
      // bind has no address of its own, so the client replaces the host with the
      // one the page itself was reached at; the port stays the proxy's, which is
      // what keeps the Mini App on an origin of its own (ADR 0020).
      const viewUrl = new URL(`http://${urlHost(bindHost)}:${boundPort}/${segment}${framed.pathname}`);
      if (framed.search) viewUrl.search = framed.search;
      if (published && credential) viewUrl.searchParams.set(PROXY_CREDENTIAL_PARAM, credential.token);
      if (framed.hash) viewUrl.hash = framed.hash;
      return {
        port: boundPort,
        viewUrl: viewUrl.toString(),
        async close() {
          // Only this registration is dropped. A later registration for the
          // same plugin has already replaced the route, and closing the old
          // handle must not take the live one with it.
          if (byPlugin.get(target.pluginId) === route) {
            byPlugin.delete(target.pluginId);
            bySegment.delete(segment);
          }
        },
      };
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      bySegment.clear();
      byPlugin.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * The bridge script a request asked for, when it asked for one.
 *
 * The script is served per Mini App, because it carries that Mini App's name:
 * the routes and the storage it namespaces are its own.
 */
function bridgeRequest(
  segments: readonly string[],
  bySegment: ReadonlyMap<string, MiniAppRoute>,
): MiniAppPageBridge | undefined {
  if (segments.length !== 3) return undefined;
  if (segments[0] !== BRIDGE_SEGMENT || segments[2] !== 'bridge.js') return undefined;
  const named = bySegment.get(segments[1])?.bridge;
  if (named) return named;
  // A bridge declares the path it is served under, and that path is the one
  // the route owns. A bridge whose path names another Mini App is still that
  // Mini App's own bridge, so the route that declares it serves it.
  for (const route of bySegment.values()) {
    if (route.bridge?.path === `/${BRIDGE_SEGMENT}/${segments[1]}/bridge.js`) return route.bridge;
  }
  return undefined;
}

/**
 * The Mini App a request belongs to, and the path it is forwarded under.
 *
 * The path says it: a Mini App is served under `/<pluginId>/…`, so the first
 * segment of the path names it. A request whose path does not — the
 * root-absolute paths a Mini App's own page asks for — says so another way:
 * the bridge stamps a header on what the page fetches, a socket URL carries a
 * parameter, and the browser's `Referer` names the document a subresource came
 * from. With one Mini App running there is nothing to choose between.
 */
function resolveRoute(
  request: http.IncomingMessage,
  url: URL,
  segments: readonly string[],
  bySegment: ReadonlyMap<string, MiniAppRoute>,
  byPlugin: ReadonlyMap<string, MiniAppRoute>,
): { readonly route?: MiniAppRoute; readonly prefixed: boolean } {
  const first = segments[0];
  if (first !== undefined) {
    const route = bySegment.get(first);
    if (route) return { route, prefixed: true };
  }
  const stamped = request.headers[ROUTE_HEADER];
  if (typeof stamped === 'string' && stamped.length > 0) {
    const route = byPlugin.get(stamped) ?? bySegment.get(stamped);
    if (route) return { route, prefixed: false };
  }
  const parameter = url.searchParams.get(ROUTE_PARAM);
  if (parameter !== null && parameter.length > 0) {
    const route = byPlugin.get(parameter) ?? bySegment.get(parameter);
    if (route) return { route, prefixed: false };
  }
  const referer = request.headers.referer;
  if (typeof referer === 'string' && referer.length > 0) {
    const refererPath = (() => {
      try {
        return new URL(referer, 'http://miniapp.invalid').pathname;
      } catch {
        return '';
      }
    })();
    const refererSegment = refererPath.split('/').filter((segment) => segment.length > 0)[0];
    if (refererSegment !== undefined) {
      const route = bySegment.get(refererSegment);
      if (route) return { route, prefixed: false };
    }
  }
  if (bySegment.size === 1) {
    const [route] = bySegment.values();
    return { route, prefixed: false };
  }
  return { prefixed: false };
}

/**
 * The path the proxy forwards upstream.
 *
 * A prefixed path loses its prefix: the Mini App serves the paths it wrote,
 * and the prefix is the proxy's own address book. Everything else is forwarded
 * unchanged, and the proxy's own parameters are consumed here — the Mini App
 * never sees the credential that authorises the proxy, nor the hint that named
 * the route.
 */
function forwardedPath(
  url: URL,
  resolved: { readonly prefixed: boolean },
  published: boolean,
): string {
  const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
  const rest = resolved.prefixed ? segments.slice(1) : segments;
  const path = `/${rest.join('/')}`;
  const query = new URLSearchParams(url.search);
  if (published) query.delete(PROXY_CREDENTIAL_PARAM);
  query.delete(ROUTE_PARAM);
  const search = query.toString();
  return search.length > 0 ? `${path}?${search}` : path;
}

/**
 * The headers the Mini App receives.
 *
 * The upstream sees its own host and its own origin — a page that compares
 * `origin` against `host` on writes refuses every write otherwise — and the
 * credential it issued. The proxy's own parameters do not travel: the route
 * hint is the proxy's own address book, and the WebUI credential authorises
 * this proxy rather than the Mini App.
 */
function forwardedHeaders(
  request: http.IncomingMessage,
  route: MiniAppRoute,
  published: boolean,
): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = { ...request.headers };
  delete headers[ROUTE_HEADER];
  headers.host = route.upstream.host;
  // Pages that serve their own API also compare `origin` against `host` on
  // writes (their reads usually skip the check), so a rewritten host with the
  // proxy's origin left in place reads fine and refuses every write — the
  // "read works, save does not" shape. Rewritten with the host, and left
  // absent when the browser sent none: a synthesized origin would be this
  // proxy claiming a request it did not make.
  if (request.headers.origin !== undefined) headers.origin = `http://${route.upstream.host}`;
  headers[route.credentialHeader] = route.credential;
  const cookie = forwardedCookie(request.headers.cookie, route, published);
  if (cookie === undefined) delete headers.cookie;
  else headers.cookie = cookie;
  return headers;
}

/**
 * The cookies a Mini App receives: its own, and nothing else.
 *
 * A Mini App's cookies are renamed on the shared origin, so a request carries
 * the cookies of the Mini App it belongs to and no others. The WebUI's own
 * credential does not travel upstream: it authorises this proxy.
 */
function forwardedCookie(
  header: string | undefined,
  route: MiniAppRoute,
  published: boolean,
): string | undefined {
  if (!header) return undefined;
  const prefix = cookiePrefix(route);
  const parts: string[] = [];
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name === PROXY_CREDENTIAL_PARAM) continue;
    if (!name.startsWith(prefix)) continue;
    parts.push(`${name.slice(prefix.length)}=${value}`);
  }
  return parts.length > 0 ? parts.join('; ') : undefined;
}

/**
 * The name a Mini App's cookies carry on the shared origin.
 *
 * The prefix is the Mini App's own, so the cookie jar of the shared origin
 * holds one session per Mini App and none of them collide.
 */
function cookiePrefix(route: MiniAppRoute): string {
  return `mcode.${route.segment}.`;
}

/**
 * The cookies a Mini App set, renamed for the shared origin.
 *
 * The attributes are the upstream's: its `Path`, its `HttpOnly`, its
 * `SameSite`. Only the name changes, and only for a cookie the Mini App
 * named itself.
 */
function scopedCookies(
  header: string | string[] | undefined,
  route: MiniAppRoute,
): string[] | undefined {
  if (header === undefined) return undefined;
  const values = Array.isArray(header) ? header : [header];
  const prefix = cookiePrefix(route);
  const scoped = values.map((value) => {
    const separator = value.indexOf('=');
    if (separator < 0) return value;
    const name = value.slice(0, separator).trim();
    if (name.startsWith(prefix)) return value;
    // A browser refuses a `__Host-` or `__Secure-` cookie whose name is not
    // the one the Mini App chose, so those keep their name and are shared.
    if (name.startsWith('__Host-') || name.startsWith('__Secure-')) return value;
    return `${prefix}${name}${value.slice(separator)}`;
  });
  return scoped.length > 0 ? scoped : undefined;
}

/**
 * The address a Mini App redirects to, back on this proxy's origin.
 *
 * A Mini App that redirects to its own root would otherwise leave the prefix
 * behind and land on a path no route owns.
 */
function scopedLocation(location: string, route: MiniAppRoute): string {
  if (location.startsWith('/')) return `/${route.segment}${location}`;
  return location;
}

/**
 * The credential a request presented, and where it presented it.
 *
 * The query parameter is the framed navigation's own credential: the client
 * puts it in the URL it frames. The cookie is what every request after that
 * carries, including the Mini App's own asset and API requests.
 */
function presentedProxyCredential(
  request: http.IncomingMessage,
  credential: WebuiCredential,
): { readonly presented: boolean; readonly inQuery: boolean } {
  const query = new URL(request.url ?? "/", "http://miniapp.invalid").searchParams.get(
    PROXY_CREDENTIAL_PARAM,
  );
  if (query !== null && credentialMatches(credential, query)) {
    return { presented: true, inQuery: true };
  }
  const cookie = credentialFromCookie(request.headers.cookie);
  if (credentialMatches(credential, cookie)) {
    return { presented: true, inQuery: false };
  }
  return { presented: false, inQuery: false };
}

/**
 * The same path without the gate's parameter, so the framed document's own
 * address carries no credential.
 */
function withoutProxyCredential(requestUrl: string | undefined): string {
  const url = new URL(requestUrl ?? "/", "http://miniapp.invalid");
  url.searchParams.delete(PROXY_CREDENTIAL_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * The host as it appears in a URL: an IPv6 literal carries its brackets.
 */
function urlHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

function decodeHtmlResponse(response: http.IncomingMessage): Readable {
  const encoding = response.headers['content-encoding']?.trim().toLowerCase();
  if (!encoding || encoding === 'identity') return response;
  const decoder =
    encoding === 'gzip' || encoding === 'x-gzip'
      ? createGunzip()
      : encoding === 'deflate'
        ? createInflate()
        : encoding === 'br'
          ? createBrotliDecompress()
          : undefined;
  if (!decoder) throw new TypeError(`Unsupported Mini App HTML content encoding: ${encoding}`);
  response.pipe(decoder);
  return decoder;
}

function isHtml(headers: http.IncomingHttpHeaders): boolean {
  const contentType = headers['content-type'];
  return typeof contentType === 'string' && contentType.toLowerCase().includes('text/html');
}

/**
 * The page is framed by the WebUI client, on a different origin, so a page that asks not to be framed
 * must not be able to refuse: `X-Frame-Options` is dropped and a `frame-ancestors` directive is removed
 * from the page's own CSP. Everything else the page declares is left alone — the Mini App's origin is a
 * separate origin from the client's, so its CSP governs a document that cannot reach the client anyway.
 */
function frameableHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const result: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (FRAME_BLOCKING_HEADERS.includes(name.toLowerCase() as 'x-frame-options')) continue;
    if (name.toLowerCase() === CSP_HEADER && typeof value === 'string') {
      const directives = value
        .split(';')
        .map((directive) => directive.trim())
        .filter((directive) => directive.length > 0 && !directive.toLowerCase().startsWith('frame-ancestors'));
      result[name] = directives.join('; ');
      continue;
    }
    result[name] = value;
  }
  return result;
}

/**
 * The document's root-absolute URLs become the Mini App's own paths.
 *
 * A page's own module graph is the reason: a document at `/<pluginId>/…`
 * that loads `/app.js` has its script outside the prefix, and every module
 * that script imports is then asked for at the root as well — where the
 * shared port cannot say which Mini App they belong to. Putting the document's
 * own URLs under the prefix keeps the graph inside the address space the
 * proxy routes on.
 *
 * Only the document's attributes are rewritten. What the page's script asks
 * for at runtime is left alone, and reaches its Mini App because the bridge
 * says which Mini App the page belongs to.
 */
function prefixDocumentUrls(document: string, segment: string): string {
  return document.replace(
    /\b(src|href|poster)\s*=\s*(["'])\/(?!\/)([^"']*)\2/giu,
    (_match, attribute: string, quote: string, rest: string) =>
      `${attribute}=${quote}/${segment}/${rest}${quote}`,
  );
}

/**
 * The bridge goes in before the document's own scripts run.
 *
 * A Mini App asks for `window.mcode.miniapp` while it boots, and the route
 * and storage shims have to be in place before the page's first request. The
 * tag therefore goes at the head's start, not at its end.
 */
function injectBridge(document: string, bridge: MiniAppPageBridge): string {
  const tag = `<script src="${bridge.path}"></script>`;
  const headStart = document.search(/<head\b[^>]*>/iu);
  if (headStart >= 0) {
    const insertAt = headStart + document.slice(headStart).indexOf('>') + 1;
    return `${document.slice(0, insertAt)}${tag}${document.slice(insertAt)}`;
  }
  const bodyStart = document.search(/<body[^>]*>/iu);
  if (bodyStart >= 0) {
    const insertAt = document.indexOf('>', bodyStart) + 1;
    return `${document.slice(0, insertAt)}${tag}${document.slice(insertAt)}`;
  }
  return `${tag}${document}`;
}

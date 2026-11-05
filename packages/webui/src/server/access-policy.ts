// Admission policy for the WebUI service: which host, URL host, origin and
// credential the HTTP and WebSocket surfaces accept.
//
// The service may bind beyond loopback (ADR 0031), so admission no longer
// answers "is this address local?". It answers three narrower questions:
//
//   * Is this `Host` header an address the service could have been reached
//     at? The rule is a DNS-rebinding guard, so it runs before the credential
//     and before any byte is served.
//   * Is this `Origin` the same origin as the request? A page on another
//     site must not be able to drive the session.
//   * Does this request carry the per-start credential? Development mode
//     drops that requirement for the loopback interface only: exposing the
//     port must not silently publish the terminal and the file tools.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

import {
  credentialPresented,
  type WebuiCredential,
} from "./credentials.js";
import { rejectHttp } from "./http/responses.js";

export interface WebuiAdmissionContext {
  readonly host: string;
  /** The TCP port the service bound, once `start()` has resolved. */
  readonly tcpPort: () => number | undefined;
  readonly credential: WebuiCredential;
  readonly dev: boolean;
}

/**
 * Host and origin admission for one HTTP request. Rejects in place
 * and returns `false` when the request is refused; returns `true` when the
 * caller may route it. The credential check stays with the router because it
 * needs the parsed request URL.
 */
export function admitHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: WebuiAdmissionContext,
): boolean {
  const requestHost = (request.headers.host ?? "").toLowerCase();
  const requestHostname = hostnameFromHostHeader(requestHost);
  if (!requestHostname || !isAdmittedHost(requestHostname, context.host)) {
    rejectHttp(response, 403, "Forbidden Host");
    return false;
  }
  const requestOrigin = (request.headers.origin ?? "").toLowerCase();
  if (
    requestOrigin &&
    !isAllowedOrigin(requestOrigin, requestHostname, context.tcpPort())
  ) {
    rejectHttp(response, 403, "Forbidden Origin");
    return false;
  }
  return true;
}

/**
 * Host, URL host, origin and credential admission for one WebSocket
 * upgrade. Rejects on the socket and returns `false` when refused.
 */
export function admitWebSocketUpgrade(
  request: IncomingMessage,
  url: URL,
  socket: Duplex,
  context: WebuiAdmissionContext,
): boolean {
  const urlHost = normalizeHostname(url.hostname);
  const requestHost = (request.headers.host ?? "").toLowerCase();
  const requestHostname = hostnameFromHostHeader(requestHost);
  const requestOrigin = (request.headers.origin ?? "").toLowerCase();
  if (!requestHostname || !isAdmittedHost(requestHostname, context.host)) {
    rejectUpgrade(socket, 403, "Forbidden Host");
    return false;
  }
  if (!isAdmittedUrlHost(urlHost, requestHostname)) {
    rejectUpgrade(socket, 403, "Forbidden Host");
    return false;
  }
  if (
    requestOrigin &&
    !isAllowedOrigin(requestOrigin, requestHostname, context.tcpPort())
  ) {
    rejectUpgrade(socket, 403, "Forbidden Origin");
    return false;
  }
  const presented = url.searchParams.get("token");
  if (
    credentialRequired(requestHostname, context.dev) &&
    !credentialPresented(context.credential, presented, request.headers.cookie)
  ) {
    rejectUpgrade(socket, 401, "Unauthorized");
    return false;
  }
  return true;
}

export function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  const reasonLine = reason.replace(/[\r\n]/gu, " ");
  socket.write(`HTTP/1.1 ${status} ${reasonLine}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function parseWebSocketUrl(rawUrl: string | undefined): URL | undefined {
  if (!rawUrl) return undefined;
  try {
    const base = "ws://127.0.0.1";
    return new URL(rawUrl, base);
  } catch {
    return undefined;
  }
}

export function isLoopbackHost(host: string): boolean {
  const normalized = normalizeHostname(host);
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1"
  );
}

/**
 * A bind address that answers on every interface: `0.0.0.0`, `::`, or an
 * empty address. The service reads it as "this host is reachable from
 * anywhere the packet filter allows", which is what makes the credential
 * requirement for non-loopback requests load-bearing rather than optional.
 */
export function isWildcardBindAddress(host: string): boolean {
  const normalized = normalizeHostname(host);
  return normalized === "" || normalized === "0.0.0.0" || normalized === "::";
}

/**
 * Whether a request that arrived under this host name may be served.
 *
 * Loopback is always admitted. A service bound to one address admits that
 * address, so a `Host` header naming anything else is refused — that is the
 * DNS-rebinding guard. A wildcard bind has no address to compare against, so
 * it admits every host name and leans on the credential rule instead.
 */
export function isAdmittedHost(hostname: string, boundHost: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (isLoopbackHost(normalized)) return true;
  const bound = normalizeHostname(boundHost);
  if (isWildcardBindAddress(bound)) return true;
  return normalized === bound;
}

/**
 * The URL host of a WebSocket upgrade must be the address the page itself
 * was served from: loopback, or the host name the request carried.
 */
export function isAdmittedUrlHost(urlHost: string, requestHostname: string): boolean {
  const normalized = normalizeHostname(urlHost);
  if (isLoopbackHost(normalized)) return true;
  return normalized === normalizeHostname(requestHostname);
}

/**
 * Whether a request has to present the per-start credential.
 *
 * Development mode drops the credential for the loopback interface only, so
 * a developer opens the page without scraping a token out of the log. Every
 * other interface keeps the requirement in every mode: the service reads
 * files and runs a terminal, and a wildcard bind publishes both.
 */
export function credentialRequired(hostname: string, dev: boolean): boolean {
  return !dev || !isLoopbackHost(hostname);
}

/**
 * Same-origin admission for the `Origin` header. The origin must name the
 * host the request was addressed to, and the port must be the one the
 * service bound.
 */
export function isAllowedOrigin(
  origin: string,
  requestHostname: string,
  port?: number,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") return false;
  const hostname = normalizeHostname(parsed.hostname);
  if (hostname !== normalizeHostname(requestHostname)) return false;
  if (port === undefined) return true;
  const portNumber = parsed.port
    ? Number(parsed.port)
    : defaultPortForProtocol(protocol);
  return portNumber === port;
}

/**
 * The host part of a `Host` header, without the port and without the
 * brackets an IPv6 literal carries. A header that names no host yields an
 * empty string, which every admission rule refuses.
 */
export function hostnameFromHostHeader(hostHeader: string): string {
  const trimmed = hostHeader.trim().toLowerCase();
  if (!trimmed) return "";
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    if (end < 0) return "";
    return trimmed.slice(1, end);
  }
  const colon = trimmed.indexOf(":");
  return colon < 0 ? trimmed : trimmed.slice(0, colon);
}

/**
 * The port part of a `Host` header, or `undefined` when it names none.
 */
export function portFromHostHeader(hostHeader: string): number | undefined {
  const trimmed = hostHeader.trim();
  if (!trimmed) return undefined;
  const tail = trimmed.startsWith("[")
    ? trimmed.slice(trimmed.indexOf("]") + 1)
    : trimmed.slice(trimmed.lastIndexOf(":") + 1);
  if (!tail.startsWith(":")) return undefined;
  const value = Number(tail.slice(1));
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * Lower-case a host name and drop the brackets an IPv6 literal carries, so
 * `[::1]` and `::1` are one host name everywhere in this module.
 */
export function normalizeHostname(hostname: string): string {
  const trimmed = hostname.trim().toLowerCase();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function defaultPortForProtocol(protocol: string): number {
  return protocol === "https:" ? 443 : 80;
}

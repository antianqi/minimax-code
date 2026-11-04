// The browser extension download route.
//
// The person installs the extension into their own browser, and the browser
// will not do it for them: a store install needs their own click, and an
// unpacked install needs developer mode and a folder they pick. What this
// route does is hand them the package this host produces, so the extension
// they load is the one this build speaks to — the mismatch between the two is
// the failure that reads like a network timeout.
//
// Dispatch happens after the loopback, origin and credential checks, so this
// inherits them instead of re-implementing them: the package goes to whoever
// holds the per-start token and to nobody else.

import type { IncomingMessage, ServerResponse } from "node:http";

import { rejectHttp } from "./responses.js";
import type { WebuiBrowserExtensionPackage } from "../browser-bridge/extension-package.js";

export async function serveBrowserExtensionPackage(
  request: IncomingMessage,
  response: ServerResponse,
  extensionPackage: WebuiBrowserExtensionPackage | undefined,
): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    rejectHttp(response, 405, "Method Not Allowed");
    return;
  }
  if (!extensionPackage) {
    rejectHttp(response, 404, "This build carries no browser extension.");
    return;
  }
  let archive;
  try {
    archive = await extensionPackage.archive();
  } catch (error) {
    // The reason is the build's, and it is the only thing the person can act
    // on: a failed build is not a missing package.
    rejectHttp(
      response,
      500,
      error instanceof Error ? error.message : "The browser extension could not be built.",
    );
    return;
  }
  if (!archive) {
    rejectHttp(response, 404, "This build carries no browser extension.");
    return;
  }
  response.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Length": archive.bytes.byteLength,
    "Content-Disposition": `attachment; filename="${archive.fileName}"`,
    // The package is the build this host speaks to, and the build moves: a
    // cached download is the stale extension this route exists to prevent.
    "Cache-Control": "no-store",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  response.end(Buffer.from(archive.bytes));
}

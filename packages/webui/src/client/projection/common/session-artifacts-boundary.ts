// The session's own artifacts directory, as a second trusted root.
//
// A turn's diff names the files the turn wrote. Some of them are not in the
// workspace at all: the runtime writes the session's own products -- the plan
// document above all -- into the session's history directory:
//
//   <dataDir>/v2/sessions/<YYYY>/<MM>/<DD>/<HH-mm-ss-SSS>-session_<base64url(sessionId)>/artifacts/plan.md
//
// That directory is outside the workspace, but it is this session's own
// output: the runtime put it there, on this session's behalf. Desktop treats
// it the same way -- it opens a plan file with the file's own directory as the
// read root -- so a WebUI that withholds the body of such a file shows less
// than the Desktop client shows for the same session.
//
// The client names this directory from what it already has. The runtime never
// hands the history directory to the client, but the directory name carries
// the session's identity: the `session_<base64url(sessionId)>` segment is a
// deterministic encoding of the session id, so a path carrying this session's
// segment belongs to this session. The date segments do not have to be
// known: they are the session's creation time, and a path that carries the
// right session segment is the right session's directory whatever its date.
//
// The trust is bounded on purpose. The directory has to be inside the
// runtime's own data directory, the layout has to be the one the runtime
// writes, and the session segment has to be *this* session's. A path
// anywhere else, another session's artifacts directory included, is outside
// the boundary as before.

import { resolveAbsolutePath, segmentsWithinRoot } from "./paths.js";

/**
 * What the client needs to name a session's artifacts directory.
 *
 * The data directory is the runtime's, and the session id is the session's.
 * Without either there is no directory to place, so nothing is trusted.
 */
export interface WebuiSessionArtifactsRoots {
  /** The runtime's data directory. */
  readonly dataDir?: string;
  /** The session the directory must belong to. */
  readonly sessionId?: string;
}

/**
 * The session id encoded the way the runtime encodes it into a directory
 * name.
 *
 * The runtime writes `session_${Buffer.from(sessionId || "unknown-session",
 * "utf8").toString("base64url").slice(0, 180)}`; the browser has no
 * `Buffer`, so the same bytes go through `btoa`. The empty-id fallback and
 * the 180-character cut are the runtime's, and they are kept so the two sides
 * agree on the name of the same session.
 */
function encodedSessionId(sessionId: string): string {
  const source = sessionId || "unknown-session";
  const bytes = new TextEncoder().encode(source);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "")
    .slice(0, 180);
}

/**
 * Whether a path is a file in the session's own artifacts directory.
 *
 * Containment first, layout second, and both against the runtime's data
 * directory: a path that does not start with the data directory's own segments
 * is not this session's directory, whatever its tail looks like. Two
 * directories of the same depth — `/data/one` and `/data/two` — differ in the
 * segment that has to match, and a path reached through a different root kind
 * (`/srv/data` against the UNC share `//srv/data`, or another drive) is not
 * placed by a segment comparison at all.
 *
 * The layout is then compared segment by segment: `v2/sessions`, the three date
 * segments, the session directory, `artifacts`, and then the file itself. A path
 * that climbs out of the artifacts directory with `..` does not resolve to a
 * file under it and is refused, and so is the artifacts directory itself, which
 * is a directory rather than a file in it.
 */
export function isWebuiPathWithinSessionArtifacts(
  filePath: string,
  roots: WebuiSessionArtifactsRoots,
): boolean {
  const dataDir = roots.dataDir?.trim();
  const sessionId = roots.sessionId?.trim();
  if (!dataDir || !sessionId) return false;
  const root = resolveAbsolutePath(dataDir);
  const file = resolveAbsolutePath(filePath);
  if (!root || !file) return false;
  if (root.kind !== file.kind) return false;
  if (!segmentsWithinRoot(file.segments, root.segments)) return false;
  const layout = file.segments.slice(root.segments.length);
  // The file has to be below the artifacts directory, so it needs at least the
  // seven segments the layout itself takes plus one more for the file.
  if (layout.length < 8) return false;
  if (layout[0] !== "v2") return false;
  if (layout[1] !== "sessions") return false;
  if (!/^\d{4}$/u.test(layout[2] ?? "")) return false;
  if (!/^\d{2}$/u.test(layout[3] ?? "")) return false;
  if (!/^\d{2}$/u.test(layout[4] ?? "")) return false;
  const sessionDirectory = layout[5] ?? "";
  if (!sessionDirectory.endsWith(`-session_${encodedSessionId(sessionId)}`)) return false;
  return layout[6] === "artifacts";
}

# The client draws the workspace boundary for a diff body

**Status:** Accepted and implemented.
**Date:** 2026-10-23.

A turn's diff lists the files a turn touched, and one of those files can be **outside the
workspace**. The runtime's capture layer records an out-of-workspace write as an absolute path, so
the entry reaches the client with that file's content attached, and the client used to render it:
the diff card's own review panel and the workspace review panel both put the patch text on screen.

The **WebUI client** now draws that boundary. A diff entry whose path resolves outside the
trusted roots keeps its name, its status and its added/deleted line counts, and loses its body —
the diff text, the patch hunks, the file's content. The entry itself stays in the list, and the
surface says what is withheld instead of showing it.

There are **two trusted roots**: the session's workspace, and the session's own artifacts
directory — the place the runtime writes this session's own products, the plan document above
all. The second root is not a relaxation of the first. It is the same rule asked in the terms
the Desktop client asks it in: a file is shown when the client can place it, and the artifacts
directory belongs to the session that wrote it.

## Why the boundary is drawn here

The fix that stopped the collection at the source was made upstream in
`packages/local-runtime/src/turns/file-changes.ts`, and it was **reverted in PR #240** because it
changed a package this fork may not change: the sixteen upstream packages are outside the boundary
of this branch, and a fix that reaches into one of them cannot be merged here. The upstream fix was
therefore not wrong — it was in the wrong layer for this repository.

So the boundary is drawn on the client side, which is where the content becomes visible. The client
is the last point before the content reaches a screen, and it is the only layer this branch may
change.

This is a **mitigation with a stated scope**, not a replacement for the upstream fix. The upstream
fix also stopped the content from being *collected*; the client-side boundary stops it from being
*shown*. The content still travels between the runtime and the browser for an out-of-workspace
file. Closing that gap properly needs the upstream change.

## Two trusted roots

The workspace is not the only root the client trusts. The runtime writes a session's own
products into the session's own history directory:

    <dataDir>/v2/sessions/<YYYY>/<MM>/<DD>/<HH-mm-ss-SSS>-session_<base64url(sessionId)>/artifacts/plan.md

That directory is outside the workspace, but it is this session's own output, and the Desktop
client opens such a file with the file's own directory as its read root. A WebUI that withheld
its body would show less than the Desktop client shows for the same session, so a file in that
directory keeps its body too.

The client names the directory from what it already has. The runtime does not hand the history
directory to the client, but the directory name carries the session's identity: the
`session_<base64url(sessionId)>` segment is a deterministic encoding of the session id, so a
path carrying **this** session's segment belongs to this session. The date segments are the
session's creation time and do not have to be known — a path carrying the right session segment
is the right session's directory whatever its date says.

The trust is bounded on purpose. The directory has to be inside the runtime's own data
directory, the layout has to be the one the runtime writes, and the session segment has to be
*this* session's. Another session's artifacts directory is outside the boundary, and so is a
directory that merely looks like one.

The data directory reaches the client as a **capability the host hands over**: the composition
root reads it from the injected runtime config and passes it with the browser capabilities, so a
presentation never reads a global to learn where the runtime keeps its data.

## The rule is lexical

The browser has no `path` module and no filesystem, so the comparison is made on posix-style
strings, the same normalization the message file-reference reader uses
(`client/features/transcript/projection/message-file-reference.ts`), extended to resolve `..` and
to compare absolute paths segment by segment.

- A **relative** path is under the workspace root by construction, and is refused when it climbs
  out of it (`../outside.txt`, `src/../../outside.txt`).
- An **absolute** path is compared with the root segment by segment, so a sibling directory whose
  name starts with the root's name (`/work/project-backup` against the root `/work/project`) is
  outside. A string prefix would have called it inside.
- The comparison is **case-sensitive except for a Windows drive letter**, and it accepts both
  separator spellings, because the runtime writes the path in the host's spelling.

## An unknown root is not a boundary

A diff entry is only withheld when the client **knows** the workspace root. When the root is
missing — a session with no workspace, a surface that has none to give — the entries are shown as
they are.

This is deliberate. A check that hid everything it could not place would hide ordinary content as
well, and the failure mode of "the diff shows nothing" is worse than the one it prevents: it is
silent, it looks like a bug, and it applies to the files a person actually worked on. The check is
therefore allowed to say "inside" only when it can compare, and the surfaces that have no root keep
the previous behaviour.

The same rule is why the boundary is applied by a **projection** and not by the components: the
projection is handed the root, decides once, and hands the entries on. A component that renders
the entries it is given cannot leak a body it was never given.

## What this decision does not settle

- **A symlink inside the workspace that points outside it.** The entry's path is a relative one, so
  it stays contained here, and the browser cannot see what it resolves to. Telling the two apart
  needs `realpath` on every target, with careful handling of files that do not exist yet, on the
  runtime side — the same limit the upstream fix states. The test suite says this out loud rather
  than leaving it to be discovered.
- **The content still travels.** Nothing here stops the runtime from sending an out-of-workspace
  file's patch to the browser; it stops the browser from showing it. Only the upstream fix stops
  the collection.
- **The session-diff operation.** The client can ask the runtime for a whole session's diff
  (`getSessionDiff`), and no surface consumes that answer today. When one does, it goes through the
  same projection.

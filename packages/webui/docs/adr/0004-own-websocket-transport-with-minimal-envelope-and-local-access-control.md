# The WebUI owns its transport: WebSocket, minimal envelope, loopback access control

Business payloads reuse the existing `@mavis/protocol/local` data structures, but
the WebUI adds its own thin envelope on top: request correlation, operation name,
protocol version, a response/error/event distinction, subscription identity, and
reconnect cursors. The process-local contract cannot be exposed as-is — it carries
`AsyncIterable` sources and `AbortSignal` contexts, and it contains no RPC envelope,
authentication headers or network identity of any kind.

The service validates Host and Origin, requires a per-start credential, exposes an
operation allowlist with runtime validation of every request body, and bounds
message size and backpressure. It reads files and runs tools, so "a single local
user" is not the same thing as "no access control". It binds loopback by default;
[0031](0031-the-webui-may-bind-beyond-loopback-and-a-non-loopback-request-presents-the-credential)
lets the bind address be configured and keeps the credential requirement for
every request that did not arrive over loopback.

## Considered Options

- **Passing data structures through with no envelope** — rejected: no way to
  correlate responses, terminate a subscription, or resume after a disconnect.
- **Restoring an HTTP front door inside the runtime** — not available: both
  `packages/local-runtime/src/http/` and `packages/local-runtime-v2/src/http/` are
  retired source paths that the public source check forbids.

## Consequences

The browser never receives provider credentials; the server resolves them. Remote
access was a separate decision rather than a bind-address change: it would add
authentication, TLS or a trusted reverse proxy, CSRF and Origin policy, deployment
and upgrade handling, and a user-isolation model. ADR 0031 takes the bind address
and the credential gate out of that list and leaves the rest open — there is still
no TLS and no user-isolation model.

This decision is now realised as an explicit two-way contract split rather than a
single file on one side of the wire: wire DTOs live in `src/shared/`, while the
in-process capabilities carrying `AsyncIterable` sources and `AbortSignal`
contexts stay server-side. See
[0014](0014-webui-splits-its-internal-capability-and-orchestration-layers.md).

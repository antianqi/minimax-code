# The WebUI may bind beyond loopback, and a non-loopback request presents the credential

The WebUI service used to refuse to construct with any bind address but a loopback one, and its
admission refused every `Host` header that did not name the loopback interface. The service was
unreachable from another machine by construction: a phone or a second computer could not open the
page at all.

The bind address is now configuration (`WEBUI_HOST`, loopback by default), and the access control
that the loopback bind was standing in for is stated directly:

- The `Host` header must name an address the service could have been reached at — loopback, the
  bound address, or any host name when the bind is a wildcard (`0.0.0.0`, `::`).
- The `Origin`, when present, must be the same origin as the request.
- A request that did not arrive over the loopback interface presents the per-start credential in
  every mode. Development mode drops the credential for the loopback interface only.
- The credential travels in the query and in a cookie. The query carries it on the page URL; the
  cookie carries it on the page's own relative requests, because a browser that opened
  `/?token=…` asks for `./client.js` and `./styles.css` without the query. Without the cookie a
  page served on a non-loopback interface loads with no script and no styles.
- The page is told to connect back over the address it was reached on, so a wildcard bind hands the
  browser the person's LAN address rather than `0.0.0.0`.
- A Mini App's proxy follows the bind address too, and asks for the same credential. It keeps its own
  origin — a separate port — so the framed document is still not same-origin with the WebUI, and the
  credential never reaches the Mini App: the frame response turns it into a cookie and redirects the
  document to a URL without it, and the proxy strips it from the path it forwards.
- A refusal is legible. An upgrade the admission refuses is answered with a status line the browser can
  read — `401` for a credential that does not match, `403` for a `Host` or an `Origin` that does not —
  and the socket is ended rather than destroyed: a destroyed socket can drop the response, and the browser
  then reports "WebSocket is closed before the connection is established" for every cause alike. The
  service logs the status, the reason, the `Host` and the `Origin` of every refusal, and the Mini App
  proxy logs the requests it turns away. The page asks the service once over HTTP when its own socket
  fails, so it can say whether the service is gone, whether the credential in the address has expired —
  the usual cause, since the credential is per start — or whether the handshake was refused for another
  reason.

## Considered Options

- **Keeping the loopback-only bind** — rejected: it answers a deployment question with a refusal,
  and a person who needs the page on another machine has no way to get it.
- **Dropping the credential rule with the bind restriction** — rejected: the service reads files and
  runs a terminal. A wildcard bind publishes both to every machine that can route to the port, and
  development mode exists to spare a developer a token, not to publish a shell.
- **An address allowlist per bind** — not implemented: when the bind names one address, the `Host`
  rule already refuses every name the service could not have been reached at. A wildcard bind has no
  address to compare against, so the credential carries the identity check there.

## Consequences

ADR 0004's "binds to loopback only" is no longer in force. Its envelope, operation allowlist,
per-start credential and message bounds stay; what changes is that the credential now has a second
job. It is what makes a non-loopback bind safe to configure, so the token is printed at startup and
the printed URL carries it.

The browser extension bridge is a separate listener with its own admission, and it stays loopback
only: it is reached by the person's own browser, not by the page.

Reaching the service from another machine also means the packet filter, the network and the
credential are the whole access-control story. There is still no TLS, no user-isolation model and
no deployment story; ADR 0004's remote-access requirements are narrowed, not met.

import http from 'node:http';
import net from 'node:net';
import { gzipSync } from 'node:zlib';
import type { Duplex } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DEFAULT_MINIAPP_PROXY_PORT,
  startMiniAppProxyHost,
  type MiniAppProxyHost,
} from '../../src/server/miniapp/proxy.js';

const CREDENTIAL = 'upstream-credential-0123456789';
const SECOND_CREDENTIAL = 'upstream-credential-9876543210';
const CREDENTIAL_HEADER = 'x-mavis-miniapp-token';

interface Seen {
  readonly method?: string;
  readonly url?: string;
  readonly headers: http.IncomingHttpHeaders;
}

const seen: Seen[] = [];
const upgraded = new Set<Duplex>();
let upstream: http.Server;
let secondUpstream: http.Server;
let upstreamPort = 0;
let secondUpstreamPort = 0;
let host: MiniAppProxyHost;

beforeAll(async () => {
  upstream = http.createServer((request, response) => {
    seen.push({ method: request.method, url: request.url, headers: { ...request.headers } });
    if (request.url?.startsWith('/page')) {
      response
        .writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'x-frame-options': 'DENY',
          'content-security-policy': "default-src 'self'; frame-ancestors 'none'; script-src 'self'",
        })
        .end('<!doctype html><html><head><title>app</title></head><body>page</body></html>');
      return;
    }
    if (request.url === '/compressed') {
      const body = gzipSync('<!doctype html><html><head></head><body>compressed</body></html>');
      response
        .writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-encoding': 'gzip',
          'content-length': body.byteLength,
        })
        .end(body);
      return;
    }
    if (request.url === '/bare') {
      response.writeHead(200, { 'content-type': 'text/html' }).end('<p>no head here</p>');
      return;
    }
    if (request.url === '/assets') {
      response
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end(
          '<!doctype html><html><head><link rel="stylesheet" href="/styles.css" /><script type="module" src="/app.js"></script></head><body>assets</body></html>',
        );
      return;
    }
    if (request.url === '/echo') {
      response.writeHead(200, { 'content-type': 'text/plain' }).end('from-upstream');
      return;
    }
    if (request.url === '/session') {
      response
        .writeHead(200, { 'content-type': 'text/plain', 'set-cookie': 'sid=abc; Path=/' })
        .end('session');
      return;
    }
    if (request.url === '/redirect') {
      response.writeHead(302, { location: '/page' }).end();
      return;
    }
    response.writeHead(404).end();
  });
  upstream.on('upgrade', (request, socket) => {
    upgraded.add(socket);
    socket.once('close', () => upgraded.delete(socket));
    seen.push({ method: request.method, url: request.url, headers: { ...request.headers } });
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address();
  upstreamPort = typeof address === 'object' && address ? address.port : 0;

  // A second Mini App, on its own upstream, so a routed request says which
  // Mini App it reached.
  secondUpstream = http.createServer((request, response) => {
    seen.push({ method: request.method, url: request.url, headers: { ...request.headers } });
    if (request.url?.startsWith('/page')) {
      response
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end('<!doctype html><html><head><title>second</title></head><body>second</body></html>');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/plain' }).end('from-second-upstream');
  });
  await new Promise<void>((resolve) => secondUpstream.listen(0, '127.0.0.1', resolve));
  const secondAddress = secondUpstream.address();
  secondUpstreamPort = typeof secondAddress === 'object' && secondAddress ? secondAddress.port : 0;

  host = await startMiniAppProxyHost({ port: 0 });
});

afterAll(async () => {
  await host?.close();
  // An upgraded socket leaves the server's own tracking, so the fixture ends it explicitly.
  for (const socket of upgraded) socket.destroy();
  upgraded.clear();
  upstream?.closeAllConnections();
  await new Promise<void>((resolve) => upstream?.close(() => resolve()));
  secondUpstream?.closeAllConnections();
  await new Promise<void>((resolve) => secondUpstream?.close(() => resolve()));
});

interface Result {
  readonly status: number;
  readonly body: string;
  readonly headers: http.IncomingHttpHeaders;
}

function get(port: number, path: string, headers: Record<string, string> = {}): Promise<Result> {
  return send(port, 'GET', path, headers);
}

function send(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string>,
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, method, path, headers, agent: false },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, body, headers: response.headers }),
        );
      },
    );
    request.on('error', reject);
    request.end();
  });
}

async function registerFirst(): Promise<{ readonly viewUrl: string; readonly port: number }> {
  return host.register({
    target: {
      pluginId: 'fixture.miniapp',
      upstreamOrigin: `http://127.0.0.1:${upstreamPort}`,
      surfacePath: '/page?mode=dashboard',
      credential: CREDENTIAL,
      credentialHeader: CREDENTIAL_HEADER,
    },
    bridge: { path: '/__miniapp/fixture.miniapp/bridge.js', script: 'globalThis.__bridge = true;' },
  });
}

describe('the shared Mini App port', () => {
  it('publishes every Mini App on one port', () => {
    expect(DEFAULT_MINIAPP_PROXY_PORT).toBe(49_152);
  });

  it('serves a Mini App under its own path segment, on the one port', async () => {
    const proxy = await registerFirst();

    expect(proxy.viewUrl).toBe(`http://127.0.0.1:${proxy.port}/fixture.miniapp/page?mode=dashboard`);
    expect(proxy.port).toBe(host.port);
  });

  it('forwards a prefixed path to that Mini App without the prefix', async () => {
    const proxy = await registerFirst();

    const result = await get(proxy.port, '/fixture.miniapp/page?mode=dashboard');

    expect(result.status).toBe(200);
    expect(seen.at(-1)?.url).toBe('/page?mode=dashboard');
  });

  it('routes a request that names no Mini App by the header the page stamped', async () => {
    const proxy = await registerFirst();

    const result = await get(proxy.port, '/echo', {
      'x-mcode-miniapp-route': 'fixture.miniapp',
    });

    expect(result.status).toBe(200);
    expect(result.body).toBe('from-upstream');
    expect(seen.at(-1)?.url).toBe('/echo');
  });

  it('routes a request that names no Mini App by the document it came from', async () => {
    const proxy = await registerFirst();

    const result = await get(proxy.port, '/echo', {
      referer: `http://127.0.0.1:${proxy.port}/fixture.miniapp/page`,
    });

    expect(result.status).toBe(200);
    expect(result.body).toBe('from-upstream');
    expect(seen.at(-1)?.url).toBe('/echo');
  });

  it('keeps two Mini Apps apart on the one port', async () => {
    const first = await host.register({
      target: {
        pluginId: 'fixture.miniapp',
        upstreamOrigin: `http://127.0.0.1:${upstreamPort}`,
        surfacePath: '/page?mode=dashboard',
        credential: CREDENTIAL,
        credentialHeader: CREDENTIAL_HEADER,
      },
    });
    const second = await host.register({
      target: {
        pluginId: 'second.miniapp',
        upstreamOrigin: `http://127.0.0.1:${secondUpstreamPort}`,
        surfacePath: '/page',
        credential: SECOND_CREDENTIAL,
        credentialHeader: CREDENTIAL_HEADER,
      },
    });

    expect(first.port).toBe(second.port);
    expect(second.viewUrl).toContain('/second.miniapp/page');

    const routed = await get(first.port, '/second.miniapp/page');
    expect(routed.body).toContain('second');
    expect(seen.at(-1)?.headers[CREDENTIAL_HEADER]).toBe(SECOND_CREDENTIAL);

    // A request that names neither Mini App is not forwarded to either of
    // them: the shared port answers rather than guesses.
    const ambiguous = await get(first.port, '/api/bootstrap');
    expect(ambiguous.status).toBe(404);
    expect(ambiguous.body).toContain('No Mini App owns this request');
  });

  it('serves the one Mini App that is running when the request names none', async () => {
    // A listener of its own: the case is "one Mini App is running", so nothing
    // else may be registered on it.
    const solo = await startMiniAppProxyHost({ port: 0 });
    try {
      const proxy = await solo.register({
        target: {
          pluginId: 'solo.miniapp',
          upstreamOrigin: `http://127.0.0.1:${upstreamPort}`,
          surfacePath: '/page',
          credential: CREDENTIAL,
          credentialHeader: CREDENTIAL_HEADER,
        },
      });

      const result = await get(proxy.port, '/echo');

      expect(result.status).toBe(200);
      expect(result.body).toBe('from-upstream');
      expect(seen.at(-1)?.url).toBe('/echo');
    } finally {
      await solo.close();
    }
  });
});

describe('Mini App proxy forwarding', () => {
  it('injects the credential outbound and never returns it to the caller', async () => {
    const proxy = await registerFirst();

    const result = await get(proxy.port, '/fixture.miniapp/echo');

    expect(seen.at(-1)?.headers[CREDENTIAL_HEADER]).toBe(CREDENTIAL);
    expect(seen.at(-1)?.headers.host).toBe(`127.0.0.1:${upstreamPort}`);
    expect(result.headers).not.toHaveProperty(CREDENTIAL_HEADER);
  });

  it('rewrites origin with host, so a same-origin check upstream can pass', async () => {
    const proxy = await registerFirst();

    const result = await send(proxy.port, 'PATCH', '/fixture.miniapp/echo', {
      origin: `http://127.0.0.1:${proxy.port}`,
    });

    expect(result.status).toBe(200);
    const forwarded = seen.at(-1);
    expect(forwarded?.headers.host).toBe(`127.0.0.1:${upstreamPort}`);
    expect(forwarded?.headers.origin).toBe(`http://127.0.0.1:${upstreamPort}`);
  });

  it('never forwards the route hint upstream', async () => {
    const proxy = await registerFirst();

    await get(proxy.port, '/api/bootstrap?mcode_route=fixture.miniapp', {
      'x-mcode-miniapp-route': 'fixture.miniapp',
    });

    expect(seen.at(-1)?.url).toBe('/api/bootstrap');
    expect(seen.at(-1)?.headers['x-mcode-miniapp-route']).toBeUndefined();
  });

  it('gives each Mini App its own cookies on the shared origin', async () => {
    const proxy = await registerFirst();

    const set = await get(proxy.port, '/fixture.miniapp/session');
    const cookies = set.headers['set-cookie'];
    expect(Array.isArray(cookies) ? cookies[0] : cookies).toContain('mcode.fixture.miniapp.sid=abc');

    // The Mini App receives its own cookie under its own name, and no other
    // Mini App's cookie.
    const echoed = await get(proxy.port, '/fixture.miniapp/echo', {
      cookie: 'mcode.fixture.miniapp.sid=abc; mcode.second.miniapp.sid=zzz',
    });
    expect(echoed.status).toBe(200);
    expect(seen.at(-1)?.headers.cookie).toBe('sid=abc');
  });

  it('brings a redirect back onto the Mini App own path', async () => {
    const proxy = await registerFirst();

    const result = await get(proxy.port, '/fixture.miniapp/redirect');

    expect(result.status).toBe(302);
    expect(result.headers.location).toBe('/fixture.miniapp/page');
  });
});

describe('Mini App proxy document rewrite', () => {
  it('injects the bridge before the document own scripts run', async () => {
    const proxy = await registerFirst();

    const result = await get(proxy.port, '/fixture.miniapp/page');

    expect(result.status).toBe(200);
    expect(result.body).toContain('<script src="/__miniapp/fixture.miniapp/bridge.js"></script>');
    expect(result.body.indexOf('<script src="/__miniapp/fixture.miniapp/bridge.js"></script>')).toBeLessThan(
      result.body.indexOf('<title>app</title>'),
    );
  });

  it('makes the document framable: drops X-Frame-Options and the frame-ancestors directive', async () => {
    const proxy = await registerFirst();

    const result = await get(proxy.port, '/fixture.miniapp/page');

    expect(result.headers).not.toHaveProperty('x-frame-options');
    expect(result.headers['content-security-policy']).toBe("default-src 'self'; script-src 'self'");
  });

  it('rewrites a compressed HTML document after decoding it', async () => {
    const proxy = await registerFirst();

    const result = await get(proxy.port, '/fixture.miniapp/compressed');

    expect(result.status).toBe(200);
    expect(result.headers).not.toHaveProperty('content-encoding');
    expect(result.body).toContain('<script src="/__miniapp/fixture.miniapp/bridge.js"></script>');
    expect(result.body).toContain('compressed');
  });

  it('injects before the body when the document has no head', async () => {
    const proxy = await registerFirst();

    const result = await get(proxy.port, '/fixture.miniapp/bare');

    expect(result.body).toContain('<script src="/__miniapp/fixture.miniapp/bridge.js"></script>');
    expect(result.body).toContain('<p>no head here</p>');
  });

  it('serves the document own assets under the Mini App path, so its module graph stays routable', async () => {
    const proxy = await registerFirst();

    const result = await get(proxy.port, '/fixture.miniapp/assets');

    expect(result.status).toBe(200);
    expect(result.body).toContain('href="/fixture.miniapp/styles.css"');
    expect(result.body).toContain('src="/fixture.miniapp/app.js"');
    // The bridge keeps the path it is served under: it is not one of the
    // Mini App's own assets.
    expect(result.body).toContain('src="/__miniapp/fixture.miniapp/bridge.js"');
  });

  it('serves the bridge itself and never forwards that path upstream', async () => {
    const proxy = await registerFirst();
    const before = seen.length;

    const result = await get(proxy.port, '/__miniapp/fixture.miniapp/bridge.js');

    expect(result.status).toBe(200);
    expect(result.body).toBe('globalThis.__bridge = true;');
    expect(result.headers['content-type']).toContain('text/javascript');
    expect(seen.length).toBe(before);
  });
});

describe('Mini App proxy with an Agent-named path', () => {
  it('frames the path the Agent named instead of the declared surface', async () => {
    const named = await host.register({
      target: {
        pluginId: 'fixture.path.miniapp',
        upstreamOrigin: `http://127.0.0.1:${upstreamPort}`,
        surfacePath: '/page?mode=dashboard',
        path: '/items/42?tab=details',
        credential: CREDENTIAL,
        credentialHeader: CREDENTIAL_HEADER,
      },
    });

    try {
      expect(named.viewUrl).toContain('/fixture.path.miniapp/items/42?tab=details');
      expect(named.viewUrl).not.toContain('/page');
    } finally {
      await named.close();
    }
  });

  it('frames the declared surface when the Agent named no path', async () => {
    const plain = await host.register({
      target: {
        pluginId: 'fixture.surface.miniapp',
        upstreamOrigin: `http://127.0.0.1:${upstreamPort}`,
        surfacePath: '/page?mode=dashboard',
        credential: CREDENTIAL,
        credentialHeader: CREDENTIAL_HEADER,
      },
    });

    try {
      expect(plain.viewUrl).toContain('/fixture.surface.miniapp/page?mode=dashboard');
    } finally {
      await plain.close();
    }
  });

  it('refuses a path that could leave the Mini App origin', async () => {
    await expect(
      host.register({
        target: {
          pluginId: 'fixture.bad.miniapp',
          upstreamOrigin: `http://127.0.0.1:${upstreamPort}`,
          surfacePath: '/page',
          path: '//elsewhere.example/steal',
          credential: CREDENTIAL,
          credentialHeader: CREDENTIAL_HEADER,
        },
      }),
    ).rejects.toThrow(/origin-relative path/);
  });
});

describe('a published Mini App proxy', () => {
  const WEBUI_CREDENTIAL = 'webui-credential-0123456789';

  async function startPublished(): Promise<MiniAppProxyHost> {
    return startMiniAppProxyHost({
      port: 0,
      host: '0.0.0.0',
      credential: { token: WEBUI_CREDENTIAL },
    });
  }

  it('refuses a request that presents no credential', async () => {
    const published = await startPublished();
    try {
      const proxy = await published.register({
        target: {
          pluginId: 'published.miniapp',
          upstreamOrigin: `http://127.0.0.1:${upstreamPort}`,
          surfacePath: '/page?mode=dashboard',
          credential: CREDENTIAL,
          credentialHeader: CREDENTIAL_HEADER,
        },
      });
      const refused = await send(proxy.port, 'GET', '/published.miniapp/page?mode=dashboard', {});
      expect(refused.status).toBe(401);
    } finally {
      await published.close();
    }
  });

  it('redirects the framed document to a URL without the credential and sets the cookie', async () => {
    const published = await startPublished();
    try {
      const proxy = await published.register({
        target: {
          pluginId: 'published.miniapp',
          upstreamOrigin: `http://127.0.0.1:${upstreamPort}`,
          surfacePath: '/page?mode=dashboard',
          credential: CREDENTIAL,
          credentialHeader: CREDENTIAL_HEADER,
        },
      });
      const framed = await send(
        proxy.port,
        'GET',
        `/published.miniapp/page?mode=dashboard&webui_credential=${WEBUI_CREDENTIAL}`,
        {},
      );
      expect(framed.status).toBe(302);
      expect(String(framed.headers.location)).toBe('/published.miniapp/page?mode=dashboard');
      expect(String(framed.headers['set-cookie'])).toContain('webui_credential=');
    } finally {
      await published.close();
    }
  });

  it('serves the document to a request that carries the cookie', async () => {
    const published = await startPublished();
    try {
      const proxy = await published.register({
        target: {
          pluginId: 'published.miniapp',
          upstreamOrigin: `http://127.0.0.1:${upstreamPort}`,
          surfacePath: '/page?mode=dashboard',
          credential: CREDENTIAL,
          credentialHeader: CREDENTIAL_HEADER,
        },
      });
      const served = await send(proxy.port, 'GET', '/published.miniapp/page?mode=dashboard', {
        cookie: `webui_credential=${WEBUI_CREDENTIAL}`,
      });
      expect(served.status).toBe(200);
      expect(served.body).toContain('page');
    } finally {
      await published.close();
    }
  });

  it('never forwards the credential upstream', async () => {
    const published = await startPublished();
    try {
      const proxy = await published.register({
        target: {
          pluginId: 'published.miniapp',
          upstreamOrigin: `http://127.0.0.1:${upstreamPort}`,
          surfacePath: '/page?mode=dashboard',
          credential: CREDENTIAL,
          credentialHeader: CREDENTIAL_HEADER,
        },
      });
      await send(
        proxy.port,
        'GET',
        `/published.miniapp/page?mode=dashboard&webui_credential=${WEBUI_CREDENTIAL}`,
        {},
      );
      const last = seen[seen.length - 1];
      expect(last?.url).toBe('/page?mode=dashboard');
      expect(last?.headers[CREDENTIAL_HEADER]).toBe(CREDENTIAL);
    } finally {
      await published.close();
    }
  });

  it('hands the client a framed URL that carries the credential', async () => {
    const published = await startPublished();
    try {
      const proxy = await published.register({
        target: {
          pluginId: 'published.miniapp',
          upstreamOrigin: `http://127.0.0.1:${upstreamPort}`,
          surfacePath: '/page?mode=dashboard',
          credential: CREDENTIAL,
          credentialHeader: CREDENTIAL_HEADER,
        },
      });
      expect(proxy.viewUrl.startsWith(`http://0.0.0.0:${proxy.port}/`)).toBe(true);
      expect(proxy.viewUrl).toContain(`webui_credential=${WEBUI_CREDENTIAL}`);
    } finally {
      await published.close();
    }
  });
});

describe('the Mini App proxy websocket', () => {
  it('forwards an upgrade with the credential, under the path the Mini App serves', async () => {
    const proxy = await registerFirst();

    const response = await new Promise<string>((resolve, reject) => {
      const socket = net.connect({ host: '127.0.0.1', port: proxy.port });
      let received = '';
      socket.once('connect', () => {
        socket.write(
          `GET /fixture.miniapp/socket HTTP/1.1\r\nHost: 127.0.0.1:${proxy.port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
        );
      });
      socket.on('data', (chunk) => {
        received += chunk.toString('utf8');
        socket.destroy();
        resolve(received);
      });
      socket.once('error', reject);
      socket.setTimeout(2_000, () => {
        socket.destroy();
        reject(new Error('upgrade timed out'));
      });
    });

    expect(response).toContain('101');
    expect(seen.at(-1)?.url).toBe('/socket');
    expect(seen.at(-1)?.headers[CREDENTIAL_HEADER]).toBe(CREDENTIAL);
    expect(seen.at(-1)?.headers.host).toBe(`127.0.0.1:${upstreamPort}`);
  });
});

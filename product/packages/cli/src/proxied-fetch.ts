/**
 * A REQUEST THAT GOES THROUGH THE PROXY THE
 * ENVIRONMENT NAMES. Node's `fetch` reads no proxy variable, so until 2026-11-10 a `--policy` URL (reconcile.ts) and the CI
 * check run (ci-check.ts) went straight out on a network that allows traffic only through `HTTPS_PROXY`, while the README
 * said they go through it. Every request of those two callers comes here: where `proxyFor` (proxy-env.ts, the one reading
 * of the variables the archive lookup shares) names no proxy, the platform's `fetch` sends it as before; where it names one,
 * an `https:` request goes through a tunnel the proxy opens (CONNECT host:port, then TLS to the host itself, so the proxy
 * sees the host and nothing else) and an `http:` request is handed to the proxy whole; where the variable is not an
 * `http://` address, nothing is sent and the caller gets the one sentence of why. A proxy that refuses is reported as
 * refusing, and nothing is tried around it. Redirects are followed, each hop read again against `NO_PROXY`; a 303, and a
 * 301 or 302 answering a POST, turn the request into a GET without its body and the body's headers, as `fetch` does. ON A HOP TO ANOTHER ORIGIN THE CREDENTIALS ARE
 * DROPPED (`authorization`, `cookie`, `proxy-authorization`; the proxy's own login from the variable is added again for
 * the proxy alone) and stay dropped for every later hop, as `fetch` drops `authorization` (the CI check run sends the
 * job's `GITHUB_TOKEN` here). Until 2026-11-12 they were re-sent to whatever host a redirect named. Connects only to the
 * host its caller names, a host a redirect names, or the proxy.
 */
import { request as httpRequest, type ClientRequest, type IncomingMessage, type OutgoingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { connect as tlsConnect } from "node:tls";
import type { Duplex } from "node:stream";
import { proxyFor, type ProxyAddress } from "./proxy-env.js";

export interface ProxiedInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

const REDIRECTS_MAX = 20;
const NULL_BODY = new Set([101, 103, 204, 205, 304]);
/** What a hop to another origin never carries. */
const CREDENTIAL_HEADERS = new Set(["authorization", "cookie", "proxy-authorization"]);
/** What a request turned into a GET no longer carries with its body (the fetch standard's request-body header names). */
const BODY_HEADERS = new Set(["content-encoding", "content-language", "content-location", "content-type", "content-length"]);
const without = (headers: Record<string, string>, names: ReadonlySet<string>): Record<string, string> =>
  Object.fromEntries(Object.entries(headers).filter(([k]) => !names.has(k.toLowerCase())));

/** The sentences a request through the proxy can end in (R10-SCAN, 2026-11-10). */
export const PROXY_WORDS = {
  notHttp: (variable: string) => `the proxy ${variable} names is not an http:// address, the only kind this program uses; nothing was sent`,
  refused: (variable: string, host: string, status: number) => `the proxy ${variable} names refused to open a connection to ${host} (HTTP ${status}); nothing was sent around it`,
  unreached: (variable: string, code: string) => `the proxy ${variable} names could not be reached (${code}); nothing was sent around it`,
};

const variableOf = (u: URL): string => (u.protocol === "https:" ? "HTTPS_PROXY" : "HTTP_PROXY");
const codeOf = (e: unknown): string => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "string" && /^[A-Z0-9_]{2,40}$/.test(c) ? c : ((e as Error | null)?.message ?? String(e)).slice(0, 80);
};

/** `fetch(url, init)`, through the proxy the environment names for the URL's host where it names one. */
export async function fetchHonouringProxy(url: string, init: ProxiedInit = {}, env: NodeJS.ProcessEnv = process.env): Promise<Response> {
  let at = new URL(url);
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body;
  let sent: Record<string, string> = { ...(init.headers ?? {}) };
  for (let hop = 0; ; hop++) {
    const proxy = proxyFor(env, at);
    if (proxy === null) {
      return fetch(at.href, { method, headers: sent, body, redirect: hop < REDIRECTS_MAX ? "follow" : "error", signal: init.signal });
    }
    if ("refused" in proxy) throw new Error(PROXY_WORDS.notHttp(variableOf(at)));
    const res = await requestVia(proxy, at, method, sent, body, init.signal);
    const status = res.statusCode ?? 0;
    const location = res.headers.location;
    if ([301, 302, 303, 307, 308].includes(status) && typeof location === "string" && location !== "") {
      res.resume();
      if (hop >= REDIRECTS_MAX) throw new Error(`more than ${REDIRECTS_MAX} redirects`);
      const next = new URL(location, at);
      if (next.origin !== at.origin) sent = without(sent, CREDENTIAL_HEADERS);
      at = next;
      if (status === 303 || ((status === 301 || status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
        sent = without(sent, BODY_HEADERS);
      }
      continue;
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
    const stream = NULL_BODY.has(status) ? null : (Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>);
    if (stream === null) res.resume();
    return new Response(stream, { status, statusText: res.statusMessage ?? "", headers });
  }
}

/** One request to `at` through `proxy`: a tunnel for https, the whole request handed over for http. */
function requestVia(proxy: ProxyAddress, at: URL, method: string, headers: Record<string, string>, body: string | undefined, signal: AbortSignal | undefined): Promise<IncomingMessage> {
  const variable = variableOf(at);
  return new Promise((done, fail) => {
    let settled = false;
    const live: { req: ClientRequest | null } = { req: null };
    const finish = (f: () => void): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      f();
    };
    const onAbort = (): void => {
      live.req?.destroy();
      finish(() => fail(signal?.reason ?? new Error("aborted")));
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const send = (open: (opts: object) => ClientRequest, opts: object): void => {
      const req = open(opts);
      live.req = req;
      req.on("response", (res: IncomingMessage) => finish(() => done(res)));
      req.on("error", (e) => finish(() => fail(e)));
      req.end(body);
    };
    const own: OutgoingHttpHeaders = { ...headers, host: at.host };
    if (body !== undefined) own["content-length"] = Buffer.byteLength(body);
    if (at.protocol !== "https:") {
      if (proxy.auth !== null) own["proxy-authorization"] = proxy.auth;
      send(httpRequest, { host: proxy.host, port: proxy.port, method, path: at.href, headers: own, setHost: false });
      return;
    }
    const port = at.port === "" ? 443 : Number(at.port);
    const target = `${at.hostname.replace(/^\[|\]$/g, "")}:${port}`;
    const connectHeaders: OutgoingHttpHeaders = { host: target };
    if (proxy.auth !== null) connectHeaders["proxy-authorization"] = proxy.auth;
    const tunnel = httpRequest({ host: proxy.host, port: proxy.port, method: "CONNECT", path: target, headers: connectHeaders, setHost: false });
    live.req = tunnel;
    tunnel.on("connect", (res: IncomingMessage, socket: Duplex) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        finish(() => fail(new Error(PROXY_WORDS.refused(variable, at.hostname, res.statusCode ?? 0))));
        return;
      }
      const tls = tlsConnect({ socket, servername: at.hostname.replace(/^\[|\]$/g, ""), ALPNProtocols: ["http/1.1"] });
      // No `agent` option: with `agent: false` Node
      // builds a fresh Agent, which opens its own connection to the host and never calls `createConnection`, so every
      // https request went around the tunnel. With none, the request is written on the tunnel's TLS socket; and, with no
      // agent to take the socket back, `connection: close` ends the tunnel with the answer (one tunnel per request), where
      // a kept-alive socket would hold the command open after its last request.
      send(httpsRequest, { host: at.hostname, port, method, path: `${at.pathname}${at.search}`, headers: { ...own, connection: "close" }, setHost: false, createConnection: () => tls });
    });
    tunnel.on("response", (res: IncomingMessage) => {
      res.resume();
      finish(() => fail(new Error(PROXY_WORDS.refused(variable, at.hostname, res.statusCode ?? 0))));
      tunnel.destroy();
    });
    tunnel.on("error", (e) => finish(() => fail(new Error(PROXY_WORDS.unreached(variable, codeOf(e))))));
    tunnel.end();
  });
}

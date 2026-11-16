/**
 * THE ARCHIVE REQUESTS OF A DEEPER CHECK.
 *
 * A deeper check of one finding can look up the person's live site in the Internet Archive's web archive, to see
 * whether a copy of a page loads what the finding is about. This module is the only one of the build that opens a
 * connection for it, and it opens connections to one host only: `ARCHIVE_HOST`, a constant. A gate holds that no other
 * module but the two reviewed before it, `reconcile.js` for a `--policy` URL the person names and `ci-check.js` for the
 * check run in CI, reaches `node:http`, `node:https`, `node:http2`, `node:net`, `node:tls`, `node:dgram`, `node:dns`,
 * `undici` or the global `fetch`.
 *
 * WHAT IS SENT, AND NOTHING ELSE. The address is the site the person named (`deepen --site`), with the path the
 * deeper check's seat proposed, held to a host name and a path under three limits (`checkArchiveAddress`): at most 200
 * characters, no query string (nor a fragment), and no match of the CLI's own credential patterns (`baseline-002`'s
 * printed clauses, from the CLI's own copy of the rule). Anything else is refused with its reason before anything is
 * asked or sent. The requests are GET requests only: one for the archive's listing of the address, and one for each of
 * at most 3 of its most recent copies, each built from the address the person was shown and a 14-digit timestamp from
 * the listing (never from an address the listing names). Each carries the same fixed headers (`REQUEST_HEADERS`): no
 * cookie is sent and none received is kept, no name of the project, no file and no code. The program never connects
 * to the site itself, and runs nothing of a copy: a copy is kept as text.
 *
 * ASKED EACH TIME, NEVER REMEMBERED. Nothing is sent before the person answers "Look it up" to the program's own
 * question (`archiveQuestion`, mock M18), which names every address, the host and that they are all that is sent. In a
 * Claude Code session the question is the relay's fourth kind, the program's confirmation (hook-question.ts
 * `writeConfirmationQuestion`, `takeConfirmation`): the answer is taken only from the hook's record of the program's
 * own question, bound to this address, these copies and this check (`about`), only where it is one of the options'
 * labels (text typed in place of a choice is refused), and used once; it is marked used before the first request, so
 * that no later command can send again on it. In a terminal the person picks a number; in CI, or with no terminal,
 * nothing is asked and nothing is sent.
 *
 * WHAT CAN ANSWER IN THE PERSON'S PLACE (design rf13 3.9 step 4 and section 11's limits, 1934-1945). No permission
 * mode answers the program's question; but a PreToolUse hook on AskUserQuestion can (a hook in the person's settings,
 * another plugin, or a trusted repository's `.claude/settings.json`, and any `-p` or SDK session), and the relay
 * records that answer as the person's. Mitigation: none, by the design. What is then sent without the person is the
 * address and the copies' requests above, to web.archive.org only, under the limits above; the Internet Archive
 * learns that someone at this computer's network address looked up those pages (CVSS 3.1 3.7, low). The record of
 * each lookup says so beside the answer (`ANSWER_LIMIT`).
 *
 * THE NETWORK IT GOES THROUGH. Node's own clients do not read the proxy variables, and Claude Code's sandbox lets a
 * command reach the network only through its proxy (named in `HTTPS_PROXY`). So this module reads `HTTPS_PROXY` (or
 * `https_proxy`) itself: an `http://` proxy is asked to open a tunnel (CONNECT) to web.archive.org:443, and TLS is
 * spoken through it to web.archive.org, so the proxy sees the host and nothing of the paths; `NO_PROXY` naming the
 * archive's host, a domain above it or `*` connects directly. A proxy that refuses the tunnel is reported as the
 * sandbox not allowing web.archive.org, and nothing is tried outside the proxy. Whether Claude Code's sandbox proxy
 * accepts this tunnel was not tried (design section 13): every way the lookup can fail ends in one sentence the
 * person reads (`NOT_DONE`), never in silence.
 *
 * REDIRECTS. A redirect to another place on https://web.archive.org is followed (at most 5 in a row: the archive
 * sends one from a timestamp to the nearest copy); a redirect anywhere else is not followed, and the record says
 * "not followed" with where it pointed.
 *
 * THE TRANSPORT IS A FUNCTION ARGUMENT. The tests reach a local stand-in server by passing their own `ArchiveTransport`
 * (`lookUpArchive`'s `transport`): it changes where the bytes go, never what is sent. Nothing in the environment, a
 * flag or a file chooses it; the CLI's commands always pass none.
 */
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { request as httpRequest, type ClientRequest, type IncomingMessage, type OutgoingHttpHeaders } from "node:http";
import { connect as netConnect } from "node:net";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { askInputLines } from "./launch-plan.js";
import type { Duplex } from "node:stream";
import { connect as tlsConnect } from "node:tls";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import { redactPrintedText } from "./credential-redaction.js";
import { TerminalAsker } from "./declaration.js";
import { productPrintedRedaction } from "./engine.js";
import { ACTIVE_RUN_MARKER } from "./hook.js";
import { abortCommand, latestRunEndAt } from "./hook-launch.js";
import { PASS_EXACTLY, markConfirmationUsed, scanWindowOpen, takeConfirmation, writeConfirmationQuestion, type AskQuestion } from "./hook-question.js";
import { LEGAL_DIR_NAME } from "./legal-dir.js";
import { relativePath } from "./project-path.js";
import { appendFileAt, createNewFile, makeFolder } from "./project-write.js";

/** The one host this module connects to (or asks a proxy to tunnel to). */
export const ARCHIVE_HOST = "web.archive.org";
const ARCHIVE_PORT = 443;
/** The three limits of an address (design 3.9 step 3): its length; no query string; no credential pattern. */
export const ADDRESS_MAX_CHARS = 200;
/** At most this many copies are read in one lookup (design 3.9 step 5). */
export const ARCHIVE_COPIES_MAX = 3;
/** The purpose the program's confirmation carries for this question (hook-question.ts PURPOSE). */
export const ARCHIVE_PURPOSE = "deep-archive";
const USER_AGENT = "wolfboy-deeper-check";
/** Every header of every request, and nothing else (node:http adds none to a GET with no body). */
export const REQUEST_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  Host: ARCHIVE_HOST,
  "User-Agent": USER_AGENT,
  Accept: "*/*",
  "Accept-Encoding": "identity",
  Connection: "close",
});
/** The listing is one line per day with a copy; a day since 1996 is about 30 bytes, so this is never reached in practice. */
const LISTING_BYTES_MAX = 1024 * 1024;
const COPY_BYTES_MAX = 2 * 1024 * 1024;
const REDIRECTS_MAX = 5;
const LISTING_TIMEOUT_MS = 60_000;
const COPY_TIMEOUT_MS = 30_000;
const TIMESTAMP = /^\d{14}$/;
const HOST_NAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
/** A path of a URL: RFC 3986 `pchar`s and slashes, a percent sign only before two hex digits. */
const URL_PATH = /^\/(?:[A-Za-z0-9\-._~!$&'()*+,;=:@/]|%[0-9A-Fa-f]{2})*$/;
/** What the seat may say the copies are read for: plain printable ASCII, short enough for one line of the question. */
const LOOK_FOR = /^[\x20-\x7e]{1,40}$/;

/* ------------------------------------------------------------------------------------------------ words */

/** Every sentence of this module the person reads. */
export const ARCHIVE_WORDS = {
  questionHead: "Look up the live site in the web archive?          (asked by WolfBoy)",
  questionSends: "This sends these addresses from this computer to web.archive.org",
  questionAll: "(the Internet Archive). They are all that is sent: no code, no file.",
  toList: "to list its copies",
  copiesLine: (n: number): string => (n === 1 ? "its most recent copy" : `its ${n} most recent copies`),
  toRead: (lookFor: string | null): string => (lookFor === null ? "to read them" : `to look for ${lookFor}`),
  header: "Web archive",
  lookUp: { label: "Look it up", description: "Send only the addresses above to web.archive.org, this once" },
  dont: { label: "Don't", description: "Send nothing; the check notes this step as not done" },
  refused: (shown: string, why: string): string => `The address ${shown} is refused: ${why}. Nothing was asked or sent.`,
  tooLong: (n: number): string => `it has ${n} characters, and WolfBoy sends at most ${ADDRESS_MAX_CHARS}`,
  query: 'it has a query string (the part from "?"), which WolfBoy never sends',
  fragment: 'it has a fragment (the part from "#"), which WolfBoy never sends',
  keyLike: "it holds text that looks like a key, which WolfBoy never sends",
  notHost: (why: string): string => `WolfBoy needs a host name such as harbor.example, with an optional path; ${why}`,
  notPath: "a path starts with / and holds only the characters a web address allows (others written as %XX)",
  copiesRange: `the number of copies is 1, 2 or ${ARCHIVE_COPIES_MAX}`,
  noOne: (where: string): string => `Not done: the archive lookup asks the person first, and there is no one to ask ${where}; nothing was sent.`,
  underWay: (abort: string): string =>
    `A scan is under way here; look the site up when it has ended, or, if it stopped part way, end it first with ${abort} and ask again. Nothing was asked or sent.`,
  underWayUnread: (why: string): string => `Whether a scan is under way here could not be read (${why}), so nothing was asked or sent.`,
  chose: "Not done: you chose not to look it up; nothing was sent.",
  noAnswer: "Not done: no answer was given; nothing was sent.",
  nothingSent: `Nothing was sent to ${ARCHIVE_HOST}.`,
  /** The one sentence of each way the lookup can fail (design 3.9 step 5; section 13: the sandbox's proxy is untried). */
  NOT_DONE: {
    proxyRefused: (status: number): string =>
      `Not done: the proxy this command was given (HTTPS_PROXY) refused web.archive.org (HTTP ${status}); in Claude Code's sandbox that means the sandbox does not allow web.archive.org, and WolfBoy never retries outside it.`,
    proxyKind: "Not done: the proxy this command was given (HTTPS_PROXY) is not an http:// address, the only kind WolfBoy uses; nothing was sent.",
    proxyUnreached: (code: string): string => `Not done: the proxy this command was given (HTTPS_PROXY) could not be reached (${code}); nothing was sent to web.archive.org.`,
    unreached: (code: string): string => `Not done: web.archive.org could not be reached from this computer (${code}); nothing was received, and WolfBoy did not try again.`,
    unverified: (code: string): string => `Not done: the connection to web.archive.org could not be verified (${code}), so nothing was sent on it.`,
    timeout: (seconds: number): string => `Not done: web.archive.org did not answer within ${seconds} seconds; WolfBoy did not try again.`,
    status: (what: string, status: number): string => `Not done: web.archive.org answered the ${what} with HTTP ${status}; WolfBoy did not try again.`,
    offHost: (what: string, where: string): string => `Not done: web.archive.org sent the ${what} on to ${where}, which WolfBoy does not follow.`,
    tooManyRedirects: (what: string): string => `Not done: web.archive.org redirected the ${what} more than ${REDIRECTS_MAX} times; WolfBoy stopped there.`,
    unreadable: (what: string, why: string): string => `Not done: the ${what} could not be read (${why}).`,
  },
  /** Beside every answer the record keeps (design 3.9 step 4; section 11, 1934-1945). */
  ANSWER_LIMIT:
    "A hook installed in this session (in your settings, another plugin's, or a trusted repository's) can answer WolfBoy's question in your place, and the answer would read the same here.",
} as const;

/* ------------------------------------------------------------------------------------------------ the address */

export interface ArchiveAddress {
  scheme: "https" | "http";
  host: string;
  path: string;
  /** The address as the question shows it and the copies' requests carry it: scheme, host and path. */
  shown: string;
}

/** Credential text in `text`, by the CLI's own printed clauses of `baseline-002`. */
function looksLikeKey(text: string): boolean {
  return redactPrintedText(productPrintedRedaction(), text) !== text;
}

/** `text` as the refusals quote it: credential text replaced, at most 80 characters. */
function quoted(text: string): string {
  const safe = redactPrintedText(productPrintedRedaction(), text);
  return JSON.stringify(safe.length > 80 ? `${safe.slice(0, 77)}...` : safe);
}

/** `text` with its percent escapes decoded, where they decode; the text itself where they do not. */
function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Why one part the program would send breaks the three limits, or null. Each limit is tested on the text as written and
 * as the archive reads it once its percent escapes are decoded, so `%3F` is a query and `token%3D...` a key.
 */
function limitsProblem(text: string): string | null {
  const plain = decoded(text);
  if (looksLikeKey(text) || looksLikeKey(plain)) return ARCHIVE_WORDS.keyLike;
  if (text.length > ADDRESS_MAX_CHARS) return ARCHIVE_WORDS.tooLong(text.length);
  if (plain.includes("?")) return ARCHIVE_WORDS.query;
  if (plain.includes("#")) return ARCHIVE_WORDS.fragment;
  return null;
}

/**
 * The site the person named (`deepen --site`) and the path the seat proposed on it, held to a host name with an
 * optional path under the three limits. `path`, where given,
 * replaces the site's own path. Refused with the reason, quoting the input with credential text replaced.
 */
export function checkArchiveAddress(site: string, path: string | null = null): { address: ArchiveAddress } | { refused: string } {
  const refuse = (what: string, why: string): { refused: string } => ({ refused: ARCHIVE_WORDS.refused(quoted(what), why) });
  for (const part of path === null ? [site] : [site, path]) {
    const why = limitsProblem(part);
    if (why !== null) return refuse(part, why);
  }
  let rest = site;
  let scheme: "https" | "http" = "https";
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(rest);
  if (m !== null) {
    const s = (m[1] as string).toLowerCase();
    if (s !== "https" && s !== "http") return refuse(site, ARCHIVE_WORDS.notHost(`${JSON.stringify(m[1])} is not http or https`));
    scheme = s;
    rest = rest.slice(m[0].length);
  }
  const slash = rest.indexOf("/");
  const hostPart = slash === -1 ? rest : rest.slice(0, slash);
  const sitePath = slash === -1 ? "" : rest.slice(slash);
  if (hostPart.includes("@")) return refuse(site, ARCHIVE_WORDS.notHost("it names a user before @"));
  if (hostPart.includes(":") || hostPart.startsWith("[")) return refuse(site, ARCHIVE_WORDS.notHost("it names a port or an IP address"));
  // A trailing dot is the same name.
  const host = hostPart.toLowerCase().replace(/\.$/, "");
  if (/[^\x21-\x7e]/.test(host)) return refuse(site, ARCHIVE_WORDS.notHost("write a name with other letters in its xn-- form, with no space"));
  if (IPV4.test(host)) return refuse(site, ARCHIVE_WORDS.notHost("it is an IP address"));
  if (!HOST_NAME.test(host)) return refuse(site, ARCHIVE_WORDS.notHost(`${JSON.stringify(host)} is not one`));
  const full = path ?? (sitePath === "" ? "/" : sitePath);
  if (!URL_PATH.test(full)) return refuse(path ?? site, ARCHIVE_WORDS.notPath);
  const shown = `${scheme}://${host}${full}`;
  const why = limitsProblem(shown);
  if (why !== null) return refuse(shown, why);
  return { address: { scheme, host, path: full, shown } };
}

/* ------------------------------------------------------------------------------------------------ the question */

/** The archive question (mock M18): every address, the host it goes to, and that they are all that is sent. */
export function archiveQuestion(
  address: ArchiveAddress,
  copies: number,
  lookFor: string | null,
  checkKey: string,
): { question: AskQuestion; valueByLabel: Record<string, string>; about: string } {
  const look = lookFor !== null && LOOK_FOR.test(lookFor) && !looksLikeKey(lookFor) ? lookFor : null;
  const second = ARCHIVE_WORDS.copiesLine(copies);
  const width = Math.max(address.shown.length, second.length);
  const row = (left: string, right: string): string[] =>
    width <= 44 ? [`  ${left.padEnd(width)}   ${right}`] : [`  ${left}`, `      ${right}`];
  const lines = [
    ARCHIVE_WORDS.questionHead,
    ARCHIVE_WORDS.questionSends,
    ARCHIVE_WORDS.questionAll,
    ...row(address.shown, ARCHIVE_WORDS.toList),
    ...row(second, ARCHIVE_WORDS.toRead(look)),
  ];
  const about = createHash("sha256")
    .update(JSON.stringify({ v: 1, host: ARCHIVE_HOST, address: address.shown, copies, look_for: look, check: checkKey }))
    .digest("hex");
  return {
    question: {
      question: lines.join("\n"),
      header: ARCHIVE_WORDS.header,
      multiSelect: false,
      options: [
        { label: ARCHIVE_WORDS.lookUp.label, description: ARCHIVE_WORDS.lookUp.description },
        { label: ARCHIVE_WORDS.dont.label, description: ARCHIVE_WORDS.dont.description },
      ],
    },
    valueByLabel: { [ARCHIVE_WORDS.lookUp.label]: "look-up", [ARCHIVE_WORDS.dont.label]: "none" },
    about,
  };
}

/* ------------------------------------------------------------------------------------------------ the requests */

/** Where the bytes go: the program's own connections, or a test's stand-in (a function argument only). */
export interface ArchiveTransport {
  /** A TCP connection to `host:port` (web.archive.org:443, or the proxy's). */
  connectTcp(host: string, port: number): Duplex;
  /** TLS to web.archive.org over `socket`; the program's own (Node's checks of the name and the chain) where not given. */
  startTls?(socket: Duplex): Duplex;
}

const startArchiveTls = (socket: Duplex): Duplex => tlsConnect({ socket, servername: ARCHIVE_HOST, host: ARCHIVE_HOST, ALPNProtocols: ["http/1.1"] });
const NETWORK: ArchiveTransport = {
  connectTcp: (host, port) => netConnect({ host, port }),
  startTls: startArchiveTls,
};
const tlsOf = (transport: ArchiveTransport): ((socket: Duplex) => Duplex) => transport.startTls ?? startArchiveTls;

/** One request as the record lists it. */
export interface SentRequest {
  path: string;
  /** Whether the request left this computer: "no" where the connection failed before it, "unknown" where it failed after. */
  reached: "yes" | "no" | "unknown";
  status: number | null;
  bytes: number;
  cut: boolean;
  /** Where a redirect pointed, and whether it was followed. */
  redirect: { to: string; followed: boolean } | null;
  error: string | null;
}

interface Proxy {
  host: string;
  port: number;
  auth: string | null;
}

/** The host's proxy variables (Claude Code's sandbox sets them for a command; host-env.ts lists them for the gates). */
import { HTTPS_PROXY_ENV, HTTPS_PROXY_LOWER_ENV, NO_PROXY_ENV, NO_PROXY_LOWER_ENV, proxyFor } from "./proxy-env.js";
export { HTTPS_PROXY_ENV, HTTPS_PROXY_LOWER_ENV, NO_PROXY_ENV, NO_PROXY_LOWER_ENV };

/** The proxy the environment names for HTTPS, null for none or where NO_PROXY covers the archive, or a refusal: the one
 * reading every request of this program shares (proxy-env.ts `proxyFor`). */
export function archiveProxy(env: NodeJS.ProcessEnv): Proxy | null | { refused: string } {
  const p = proxyFor(env, { protocol: "https:", hostname: ARCHIVE_HOST });
  return p !== null && "refused" in p ? { refused: ARCHIVE_WORDS.NOT_DONE.proxyKind } : p;
}

const codeOf = (e: unknown): string => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "string" && /^[A-Z0-9_]{2,40}$/.test(c) ? c : ((e as Error | null)?.message ?? String(e)).slice(0, 80);
};
const TLS_CODE = /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO|HOSTNAME|ALTNAME/;

/** A socket to web.archive.org, through the proxy where there is one; or the one sentence of why not. */
function openArchive(proxy: Proxy | null, transport: ArchiveTransport, timeoutMs: number): Promise<{ socket: Duplex } | { notDone: string }> {
  if (proxy === null) return Promise.resolve({ socket: tlsOf(transport)(transport.connectTcp(ARCHIVE_HOST, ARCHIVE_PORT)) });
  return new Promise((done) => {
    let settled = false;
    const finish = (v: { socket: Duplex } | { notDone: string }): void => {
      if (settled) return;
      settled = true;
      done(v);
    };
    const tcp = transport.connectTcp(proxy.host, proxy.port);
    const headers: OutgoingHttpHeaders = { Host: `${ARCHIVE_HOST}:${ARCHIVE_PORT}` };
    if (proxy.auth !== null) headers["Proxy-Authorization"] = proxy.auth;
    const req = httpRequest({ method: "CONNECT", path: `${ARCHIVE_HOST}:${ARCHIVE_PORT}`, headers, setHost: false, createConnection: () => tcp as never });
    const answered = (res: IncomingMessage, socket: Duplex): void => {
      if (res.statusCode === 200) finish({ socket: tlsOf(transport)(socket) });
      else {
        socket.destroy();
        finish({ notDone: ARCHIVE_WORDS.NOT_DONE.proxyRefused(res.statusCode ?? 0) });
      }
    };
    req.on("connect", answered);
    req.on("response", (res: IncomingMessage) => {
      res.resume();
      finish({ notDone: ARCHIVE_WORDS.NOT_DONE.proxyRefused(res.statusCode ?? 0) });
      req.destroy();
    });
    req.setTimeout(timeoutMs, () => {
      finish({ notDone: ARCHIVE_WORDS.NOT_DONE.timeout(Math.round(timeoutMs / 1000)) });
      req.destroy();
    });
    req.on("error", (e) => finish({ notDone: ARCHIVE_WORDS.NOT_DONE.proxyUnreached(codeOf(e)) }));
    req.end();
  });
}

interface Got {
  status: number;
  location: string | null;
  body: Buffer;
  cut: boolean;
}

/** Codes of a failure before the request could leave this computer. */
const BEFORE_SENDING = /^(?:ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EAI_FAIL|ENETUNREACH|EHOSTUNREACH|EACCES|EPERM|EADDRNOTAVAIL)$/;
type Failed = { notDone: string; reached: "no" | "unknown" };

/** One GET of `path` on web.archive.org, on a connection of its own. */
async function getOnce(path: string, proxy: Proxy | null, transport: ArchiveTransport, limit: number, timeoutMs: number): Promise<Got | Failed> {
  const opened = await openArchive(proxy, transport, timeoutMs);
  if ("notDone" in opened) return { notDone: opened.notDone, reached: "no" };
  const socket = opened.socket;
  return new Promise((done) => {
    let settled = false;
    const finish = (v: Got | Failed): void => {
      if (settled) return;
      settled = true;
      done(v);
    };
    let req: ClientRequest;
    try {
      req = httpRequest({ method: "GET", path, headers: { ...REQUEST_HEADERS }, setHost: false, createConnection: () => socket as never });
    } catch (e) {
      socket.destroy();
      finish({ notDone: ARCHIVE_WORDS.NOT_DONE.unreached(codeOf(e)), reached: "no" });
      return;
    }
    req.on("response", (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let cut = false;
      const location = typeof res.headers.location === "string" ? res.headers.location : null;
      const encoding = String(res.headers["content-encoding"] ?? "identity").toLowerCase();
      const end = (): void => {
        let body = Buffer.concat(chunks);
        if (!cut && encoding !== "identity" && body.length > 0) {
          try {
            const opts = { maxOutputLength: limit };
            body = encoding === "gzip" || encoding === "x-gzip" ? gunzipSync(body, opts) : encoding === "deflate" ? inflateSync(body, opts) : encoding === "br" ? brotliDecompressSync(body, opts) : body;
          } catch (e) {
            finish({ notDone: ARCHIVE_WORDS.NOT_DONE.unreadable("answer", `${encoding}: ${codeOf(e)}`), reached: "unknown" });
            return;
          }
        }
        finish({ status: res.statusCode ?? 0, location, body, cut });
      };
      res.on("data", (c: Buffer) => {
        if (cut) return;
        const room = limit - size;
        if (c.length > room) {
          chunks.push(c.subarray(0, room));
          size = limit;
          cut = true;
          end();
          req.destroy();
          return;
        }
        chunks.push(c);
        size += c.length;
      });
      res.on("end", end);
      res.on("error", (e) => finish({ notDone: ARCHIVE_WORDS.NOT_DONE.unreached(codeOf(e)), reached: "unknown" }));
    });
    req.setTimeout(timeoutMs, () => {
      finish({ notDone: ARCHIVE_WORDS.NOT_DONE.timeout(Math.round(timeoutMs / 1000)), reached: "unknown" });
      req.destroy();
    });
    req.on("error", (e) => {
      const code = codeOf(e);
      if (TLS_CODE.test(code)) finish({ notDone: ARCHIVE_WORDS.NOT_DONE.unverified(code), reached: "no" });
      else finish({ notDone: ARCHIVE_WORDS.NOT_DONE.unreached(code), reached: BEFORE_SENDING.test(code) ? "no" : "unknown" });
    });
    req.end();
  });
}

/**
 * GET `path`, following a redirect only to another path on https://web.archive.org (at most `REDIRECTS_MAX`), and
 * listing every request in `sent`. A redirect elsewhere is listed as not followed and ends the request.
 */
async function getFollowing(
  what: string,
  path: string,
  proxy: Proxy | null,
  transport: ArchiveTransport,
  limit: number,
  timeoutMs: number,
  sent: SentRequest[],
): Promise<Got | { notDone: string }> {
  let at = path;
  for (let hop = 0; ; hop++) {
    const got = await getOnce(at, proxy, transport, limit, timeoutMs);
    if ("notDone" in got) {
      sent.push({ path: at, reached: got.reached, status: null, bytes: 0, cut: false, redirect: null, error: got.notDone });
      return got;
    }
    const isRedirect = [301, 302, 303, 307, 308].includes(got.status) && got.location !== null;
    if (!isRedirect) {
      sent.push({ path: at, reached: "yes", status: got.status, bytes: got.body.length, cut: got.cut, redirect: null, error: null });
      return got;
    }
    let next: URL | null = null;
    try {
      next = new URL(got.location as string, `https://${ARCHIVE_HOST}${at}`);
    } catch {
      next = null;
    }
    const onHost = next !== null && next.protocol === "https:" && next.hostname === ARCHIVE_HOST && (next.port === "" || next.port === "443") && next.username === "" && next.password === "";
    const shownTo = next === null ? quoted(got.location as string) : onHost ? `${next.pathname}${next.search}` : quoted(`${next.protocol}//${next.host}${next.pathname}`);
    const followed = onHost && hop < REDIRECTS_MAX;
    sent.push({ path: at, reached: "yes", status: got.status, bytes: got.body.length, cut: got.cut, redirect: { to: shownTo, followed }, error: null });
    if (!onHost) return { notDone: ARCHIVE_WORDS.NOT_DONE.offHost(what, shownTo) };
    if (!followed) return { notDone: ARCHIVE_WORDS.NOT_DONE.tooManyRedirects(what) };
    at = `${(next as URL).pathname}${(next as URL).search}`;
  }
}

/** One copy the lookup read. */
export interface ArchiveCopy {
  timestamp: string;
  body: Buffer;
  cut: boolean;
}

/** What one lookup found, sent and could not do. */
export interface ArchiveOutcome {
  /** Days the archive lists a copy of the page on (one line per day, status 200), and the first and last, as 14-digit timestamps. */
  listed: { days: number; first: string | null; last: string | null; cut: boolean } | null;
  copies: ArchiveCopy[];
  sent: SentRequest[];
  /** One sentence for each step not done, in order. Empty where everything asked for was done. */
  notDone: string[];
}

/** The archive's listing request for an address: one line per day with a copy, oldest first. */
export function listingPath(address: ArchiveAddress): string {
  return `/cdx/search/cdx?url=${encodeURIComponent(`${address.host}${address.path}`)}&fl=timestamp,statuscode,mimetype&collapse=timestamp:8`;
}

/** The request for one copy: the timestamp from the listing and the address the person was shown, never the listing's. */
export function copyPath(address: ArchiveAddress, timestamp: string): string {
  if (!TIMESTAMP.test(timestamp)) throw new Error(`a copy's timestamp is 14 digits, not ${JSON.stringify(timestamp)}`);
  return `/web/${timestamp}id_/${address.shown}`;
}

/**
 * The requests themselves, for an address `checkArchiveAddress` returned and the person allowed: the listing, then at
 * most `copies` of the most recent copies the listing marks 200. Never throws; every failure is a sentence in `notDone`.
 */
export async function lookUpArchive(
  address: ArchiveAddress,
  copies: number,
  opts: { env?: NodeJS.ProcessEnv; transport?: ArchiveTransport; listingTimeoutMs?: number; copyTimeoutMs?: number } = {},
): Promise<ArchiveOutcome> {
  const out: ArchiveOutcome = { listed: null, copies: [], sent: [], notDone: [] };
  const proxy = archiveProxy(opts.env ?? process.env);
  if (proxy !== null && "refused" in proxy) {
    out.notDone.push(proxy.refused);
    return out;
  }
  const transport = opts.transport ?? NETWORK;
  const want = Math.max(1, Math.min(ARCHIVE_COPIES_MAX, Math.floor(copies)));
  const listing = await getFollowing("listing", listingPath(address), proxy, transport, LISTING_BYTES_MAX, opts.listingTimeoutMs ?? LISTING_TIMEOUT_MS, out.sent);
  if ("notDone" in listing) {
    out.notDone.push(listing.notDone);
    return out;
  }
  if (listing.status !== 200) {
    out.notDone.push(ARCHIVE_WORDS.NOT_DONE.status("listing", listing.status));
    return out;
  }
  const text = listing.body.toString("utf8");
  const rows = (listing.cut ? text.slice(0, text.lastIndexOf("\n") + 1) : text)
    .split("\n")
    .map((l) => /^(\d{14}) (\S+) (\S+)$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => m !== null);
  // A day whose first capture is not a page (a redirect, an error) holds no copy of it.
  const pages = rows.filter((r) => r[2] === "200");
  out.listed = { days: pages.length, first: pages[0]?.[1] ?? null, last: pages.at(-1)?.[1] ?? null, cut: listing.cut };
  const recent = pages.slice(-want).reverse();
  for (const [i, r] of recent.entries()) {
    const what = `copy ${i + 1} of ${recent.length}`;
    const got = await getFollowing(what, copyPath(address, r[1] as string), proxy, transport, COPY_BYTES_MAX, opts.copyTimeoutMs ?? COPY_TIMEOUT_MS, out.sent);
    if ("notDone" in got) out.notDone.push(got.notDone);
    else if (got.status !== 200) out.notDone.push(ARCHIVE_WORDS.NOT_DONE.status(what, got.status));
    else out.copies.push({ timestamp: r[1] as string, body: got.body, cut: got.cut });
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ the command */

/** What the command needs from the deeper check that runs it (D2's `deepen <id> --fetch-archive`). */
export interface ArchiveLookupInput {
  /** The scanned folder. */
  target: string;
  /** The check's own folder, `.legal/deep/<id>/<time>/` under the target; the record and the copies go here. */
  checkDir: string;
  /** The site the person named (`deepen --site`), as the check recorded it. */
  site: string;
  /** The path the seat proposed on that site, or null for the site's own. */
  path: string | null;
  /** What the copies are read for, in the seat's words (shown only where it is short plain text). */
  lookFor: string | null;
  /** How many of the most recent copies to read: 1 to 3. */
  copies: number;
  /** Take the person's answer to the question the first run wrote (a Claude Code session). */
  fromAnswer: boolean;
}

export interface ArchiveLookupDeps {
  /** Where the person is: the answer path `declarationPathOf` gives (index.ts). */
  pathOf: () => "session" | "terminal" | "ci" | "no-terminal";
  sessionId: () => string | null;
  env?: NodeJS.ProcessEnv;
  transport?: ArchiveTransport;
  now?: () => Date;
  /** The terminal's question, for the tests; the person's own terminal otherwise. Returns the label chosen, or null. */
  askInTerminal?: (question: AskQuestion) => Promise<string | null>;
  listingTimeoutMs?: number;
  copyTimeoutMs?: number;
}

export interface ArchiveLookupResult {
  code: number;
  lines: string[];
  /** Null where nothing was asked of the person yet, or the question was refused. */
  outcome: ArchiveOutcome | null;
  /** Whether the person's answer allowed the lookup; null where no answer was taken. */
  allowed: boolean | null;
}

const stamp = (d: Date): string => d.toISOString().slice(0, 19).replace(/:/g, "-");
const dayOf = (ts: string): string => {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(ts.slice(6, 8))} ${months[Number(ts.slice(4, 6)) - 1] ?? "?"} ${ts.slice(0, 4)}`;
};

/** The check's folder, held to `.legal/deep/` under the target; null where it is not there. */
function checkFolder(target: string, checkDir: string): { abs: string; key: string } | null {
  let t: string;
  let c: string;
  try {
    t = realpathSync(resolve(target));
    c = realpathSync(resolve(checkDir));
  } catch {
    return null;
  }
  const rel = relativePath(join(t, LEGAL_DIR_NAME, "deep"), c);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel) || !existsSync(c)) return null;
  return { abs: c, key: rel };
}

/** The section the record (`archive.txt`, "sent, received") gains for one lookup. */
function recordSection(at: Date, address: ArchiveAddress, answer: string, outcome: ArchiveOutcome | null, kept: string[], folder: string | null, notes: readonly string[]): string {
  const out = [`## Lookup at ${at.toISOString()}`, "", `Address: ${address.shown}`, `Your answer: ${answer}`, ""];
  if (outcome !== null) {
    out.push(`Sent to ${ARCHIVE_HOST}, and nothing else; every request carried only these headers: ${Object.entries(REQUEST_HEADERS).map(([k, v]) => `${k}: ${v}`).join("; ")}.`);
    for (const [i, s] of outcome.sent.entries()) {
      const went = s.reached === "no" ? "not sent" : s.reached === "unknown" ? "sent or not" : "sent";
      const got = s.error !== null ? s.error : `HTTP ${s.status}, ${s.bytes} bytes${s.cut ? " (cut there)" : ""}`;
      const redirect = s.redirect === null ? "" : s.redirect.followed ? `; redirected to ${s.redirect.to}, followed` : `; redirected to ${s.redirect.to}, not followed`;
      out.push(`${i + 1}. GET ${s.path} (${went}) -> ${got}${redirect}`);
    }
    if (outcome.sent.length === 0) out.push(ARCHIVE_WORDS.nothingSent);
    if (outcome.listed !== null) {
      const l = outcome.listed;
      out.push(
        "",
        l.days === 0
          ? `The archive lists no copy of ${address.shown}.`
          : `The archive lists copies of ${address.shown} on ${l.days} day${l.days === 1 ? "" : "s"}, from ${dayOf(l.first as string)} to ${dayOf(l.last as string)}${l.cut ? " (the listing was cut at its size limit; there may be more)" : ""}.`,
      );
    }
    if (kept.length > 0) out.push(`Kept, as text, in ${folder}: ${kept.join(", ")}.`);
    out.push(...outcome.notDone);
  }
  out.push(...notes, "");
  return `${out.join("\n")}\n`;
}

/**
 * `deepen <id> --fetch-archive`, after the deeper check has found its folder, site and path: refuse an address over
 * the limits; ask the program's question (a session: write it, then `--from-answer`; a terminal: ask there; CI or
 * no terminal: refuse); on "Look it up", send the requests and keep the record, the listing and the copies in the
 * check's folder. Every way it ends prints what happened in words.
 */
export async function runArchiveLookup(input: ArchiveLookupInput, deps: ArchiveLookupDeps): Promise<ArchiveLookupResult> {
  const now = deps.now ?? (() => new Date());
  const checked = checkArchiveAddress(input.site, input.path);
  if ("refused" in checked) return { code: 2, lines: [checked.refused], outcome: null, allowed: null };
  const address = checked.address;
  if (!Number.isInteger(input.copies) || input.copies < 1 || input.copies > ARCHIVE_COPIES_MAX) {
    return { code: 2, lines: [ARCHIVE_WORDS.refused(quoted(address.shown), ARCHIVE_WORDS.copiesRange)], outcome: null, allowed: null };
  }
  const folder = checkFolder(input.target, input.checkDir);
  if (folder === null) {
    return { code: 2, lines: [`The archive lookup needs the deeper check's own folder under ${join(LEGAL_DIR_NAME, "deep")} in the scanned folder, and ${input.checkDir} is not one; nothing was asked or sent.`], outcome: null, allowed: null };
  }
  const launchDir = join(realpathSync(resolve(input.target)), LEGAL_DIR_NAME, "launch");
  // As decide (decisions.ts): the program's confirmation file is the scan's too while one is under way here, so the
  // question waits for the scan's end. Nothing is written or removed.
  let underWay: boolean;
  try {
    underWay = existsSync(join(launchDir, ACTIVE_RUN_MARKER)) || scanWindowOpen(launchDir, latestRunEndAt(launchDir));
  } catch (e) {
    return { code: 1, lines: [ARCHIVE_WORDS.underWayUnread((e as Error).message)], outcome: null, allowed: null };
  }
  if (underWay) return { code: 1, lines: [ARCHIVE_WORDS.underWay(abortCommand(launchDir))], outcome: null, allowed: null };
  const { question, valueByLabel, about } = archiveQuestion(address, input.copies, input.lookFor, folder.key);
  const where = deps.pathOf();
  let label: string | null;
  let how: string;
  let taken: Exclude<ReturnType<typeof takeConfirmation>, { refused: string }> | null = null;
  if (where === "session") {
    if (!input.fromAnswer) {
      let written: { path: string; input: Record<string, unknown> };
      try {
        written = writeConfirmationQuestion(launchDir, { purpose: ARCHIVE_PURPOSE, about, question, valueByLabel }, now(), deps.sessionId());
      } catch (e) {
        return { code: 1, lines: [`The archive question could not be written (${(e as Error).message}); nothing was sent.`], outcome: null, allowed: null };
      }
      return {
        code: 0,
        lines: [
          `To ask the person, ${PASS_EXACTLY}, alone in its call and with every character as it is - copy the line below whole; do not re-word, shorten or re-type any of it. The scanner's hook compares it with ${written.path} character by character and records the answer:`,
          ...askInputLines(written.input, dirname(launchDir)),
          "Then run this command again exactly as it was run, with --from-answer added: the program takes the answer only from the hook's record, and sends nothing unless the person chose to look it up. Never answer the question for the person.",
        ],
        outcome: null,
        allowed: null,
      };
    }
    const t = takeConfirmation(launchDir, { purpose: ARCHIVE_PURPOSE, about });
    if ("refused" in t) return { code: 1, lines: [`The archive lookup: ${t.refused}. Nothing was sent.`], outcome: null, allowed: null };
    taken = t;
    label = t.label;
    how = `"${t.label}", your answer to WolfBoy's question in this Claude Code session (recorded by the scanner's hook, confirmation ${t.id}). ${ARCHIVE_WORDS.ANSWER_LIMIT}`;
  } else if (where === "terminal") {
    const ask =
      deps.askInTerminal ??
      (async (q: AskQuestion): Promise<string | null> => {
        const asker = new TerminalAsker();
        try {
          return await asker.one(1, 1, q.header, q.question, null, q.options);
        } finally {
          asker.close();
        }
      });
    label = await ask(question);
    how = label === null ? "none (no answer in this terminal)" : `"${label}", chosen in this terminal`;
  } else {
    return { code: 1, lines: [ARCHIVE_WORDS.noOne(where === "ci" ? "in CI" : "without a terminal")], outcome: null, allowed: null };
  }
  const allowed = label !== null && valueByLabel[label] === "look-up";
  const at = now();
  if (taken !== null) {
    // Used before the first request: an answer allows one lookup, and a later command finds it used.
    try {
      markConfirmationUsed(launchDir, taken, at, allowed ? "the archive lookup, which sent the addresses asked about" : "the archive lookup, which sent nothing");
    } catch (e) {
      return { code: 1, lines: [`The archive lookup could not record that the answer was used (${(e as Error).message}); nothing was sent.`], outcome: null, allowed };
    }
  }
  const recordPath = join(folder.abs, "archive.txt");
  if (!allowed) {
    const why = label === null ? ARCHIVE_WORDS.noAnswer : ARCHIVE_WORDS.chose;
    try {
      appendFileAt(recordPath, recordSection(at, address, how, null, [], null, [why]), { within: folder.abs });
    } catch (e) {
      return { code: 1, lines: [why, `The record ${recordPath} could not be written (${(e as Error).message}).`], outcome: null, allowed };
    }
    return { code: 0, lines: [why], outcome: null, allowed };
  }
  const outcome = await lookUpArchive(address, input.copies, { env: deps.env, transport: deps.transport, listingTimeoutMs: deps.listingTimeoutMs, copyTimeoutMs: deps.copyTimeoutMs });
  const kept: string[] = [];
  let keptIn: string | null = null;
  let writeProblem: string | null = null;
  try {
    if (outcome.copies.length > 0) {
      // A folder of its own per lookup, never one an earlier lookup made.
      const base = join(folder.abs, `archive-${stamp(at)}`);
      keptIn = base;
      for (let n = 2; existsSync(keptIn); n++) keptIn = `${base}-${n}`;
      makeFolder(keptIn, { within: folder.abs });
      for (const [i, c] of outcome.copies.entries()) {
        const name = `copy-${i + 1}-${c.timestamp}.txt`;
        createNewFile(join(keptIn, name), c.body, { within: folder.abs });
        kept.push(name);
      }
    }
  } catch (e) {
    writeProblem = `A copy could not be kept in ${keptIn ?? folder.abs} (${(e as Error).message}).`;
  }
  try {
    appendFileAt(recordPath, recordSection(at, address, how, outcome, kept, keptIn === null ? null : relativePath(folder.abs, keptIn), writeProblem === null ? [] : [writeProblem]), { within: folder.abs });
  } catch (e) {
    writeProblem = `${writeProblem === null ? "" : `${writeProblem} `}The record ${recordPath} could not be written (${(e as Error).message}).`;
  }
  const reached = outcome.sent.filter((s) => s.reached !== "no").length;
  const lines = [
    reached === 0
      ? `${ARCHIVE_WORDS.nothingSent} What was tried: ${recordPath}`
      : `${reached} request${reached === 1 ? "" : "s"} sent to ${ARCHIVE_HOST}; ${outcome.copies.length} cop${outcome.copies.length === 1 ? "y" : "ies"} kept. What was sent and received: ${recordPath}`,
  ];
  if (outcome.listed !== null && outcome.listed.days === 0) lines.push(`The archive lists no copy of ${address.shown}.`);
  lines.push(...outcome.notDone);
  if (writeProblem !== null) lines.push(writeProblem);
  return { code: outcome.listed === null || writeProblem !== null ? 1 : 0, lines, outcome, allowed };
}

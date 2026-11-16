/**
 * RUBY'S EMBEDDED DOCUMENTS (`=begin … =end`), AS RUBY'S OWN PARSER READS THEM.
 *
 * WHY A PARSER AND NOT A TRACKER. Whether a column-0 `=begin` line opens a comment depends on
 * whether Ruby's lexer is at the top level of the program there, or inside a heredoc body, a string
 * running across lines, a `%` literal, a regexp — and which of those it is in turns on decisions
 * only the parser takes (is `x` a local variable, so that `x /y` divides; does `#$"` interpolate a
 * global and so swallow the quote). Two rounds of a hand-written tracker each missed forms Ruby
 * reads differently, and each miss blanked real code.
 * So the question is now asked of Prism, the parser
 * Ruby 3.4 made its default, compiled to WebAssembly: package `@ruby/prism`, pinned exactly in this
 * package's `package.json` (MIT). A column-0 `=begin` is blanked only where Prism reports an
 * embedded document, and exactly Prism's span; Prism is asked only about a file holding a line that
 * starts with `=begin` (the test below, wider than Ruby's own).
 *
 * EVERY FAILURE BLANKS NOTHING FOR THAT FILE: the package cannot be loaded (missing, its WebAssembly
 * or `node:wasi` refused), the worker cannot start, Prism reports any error for the file (a file Ruby
 * refuses has no reading to agree with), a parse passes its time-out, the reply fails its check, or
 * any step on this side throws. The file is then read exactly as `hash` reads it — main's reading
 * before 2026-09-24 — so a failure can only leave block prose readable as code, never hide code.
 * Nothing is printed: a failure is counted once, under its kind, in `rubyPrismRecord()` (per
 * thread), which the unit test reads; it is not written into the findings document.
 *
 * THE ONE FAILURE BOUNDARY is the `try` in `prismEmbdocSpans`. Everything this module does on the
 * calling thread for one file runs inside it: the `=begin` test, building the bridge (the shared
 * buffer, the channel, the worker, the wait for the load handshake), posting the file, the wait for
 * the reply, reading it, and checking and mapping it. `rubyBlockCommentSpans` (`strip-comments.ts`)
 * only calls it. A throw while the bridge is being built counts as `unavailable` and is remembered for
 * the thread, as a failed load is; a throw after that counts as `failed`. Either way the bridge is
 * dropped, so a late reply to this file can never be read as the next file's. There is no other
 * `try` on this side: the worker thread's own `try`s turn its throws into replies, which this side
 * checks; the `error` listener and the `catch` on `terminate()` only keep a dead or terminated worker
 * from taking the process down.
 *
 * WHAT A REPLY IS CHECKED FOR. Prism reports no error for the file; every offset falls on a character
 * boundary of the text, within it and in order; and every document starts at the start of a line
 * beginning `=begin` and ends right after a later line beginning `=end` — after that line's newline,
 * or at the end of the file when it is the last line. A reply that fails any of these is a failure
 * for the whole file, never a partial blank. Which `=begin` opens a document and which `=end` closes
 * it are Prism's reading and are not re-derived here: that is what Prism is asked for.
 *
 * HOW IT RUNS. Prism's loader is asynchronous and every consumer of the comment view is synchronous
 * (`contentForGuards`, and through it the engine, `runScan` as the mutation harness calls it, and
 * the tools that import the stripper directly). So Prism runs in a worker thread started from THIS
 * module on first need, and the calling thread waits for each reply with `Atomics.wait`, which also
 * gives the parse a real time-out: a worker that does not answer in time is terminated and the next
 * file gets a fresh one. The worker thread silences its own warnings, which is what keeps the
 * `node:wasi` ExperimentalWarning off the user's terminal (the thread runs Prism and nothing else).
 * A failed load is remembered for the
 * thread, not retried per file. The worker is unreferenced, so it never holds a process open.
 */

import "./install-guard-on.js"; // FIRST: no package from outside the shipped install
import { isMainThread, MessageChannel, receiveMessageOnPort, Worker, workerData, type MessagePort } from "node:worker_threads";

/** The package, resolved from this module's location. Pinned exactly in `package.json`. */
const PRISM_MODULE = "@ruby/prism";
const ROLE = "wolfboy:ruby-prism";
/** Thread start, module load, WebAssembly compile: measured at 71 ms on an idle machine. */
const LOAD_TIMEOUT_MS = 30_000;
/** One file's parse. The walker admits files under 1,000,000 bytes; the record gives the measured headroom. */
const PARSE_TIMEOUT_MS = 10_000;

type Reply = { ok: true; errors: number; docs: number[] } | { ok: false; error: string };
interface Bridge { worker: Worker; port: MessagePort; signal: Int32Array }

/** What happened to every file sent to Prism in this thread. */
export interface RubyPrismRecord {
  /** Files Prism read without error. */
  parsed: number;
  /** Embedded documents it reported in them (each one blanked). */
  documents: number;
  /** Files Prism reported an error for: nothing blanked. */
  refused: number;
  /** Parses that passed the time-out: nothing blanked, the worker replaced. */
  timedOut: number;
  /** Files that needed Prism when it could not be loaded or started in this thread: nothing blanked. */
  unavailable: number;
  /** Any other failure (Prism threw, the reply failed its check, a step on this side threw): nothing blanked. */
  failed: number;
  /** Why Prism could not be loaded or started in this thread, as first seen; null otherwise. */
  loadError: string | null;
  /** The most recent failure of any kind, for a reader of the record. */
  lastFailure: string | null;
}

const emptyRecord = (): RubyPrismRecord => ({
  parsed: 0, documents: 0, refused: 0, timedOut: 0, unavailable: 0, failed: 0, loadError: null, lastFailure: null,
});
let record = emptyRecord();
let bridge: Bridge | null = null;
let settings = { module: PRISM_MODULE, loadTimeoutMs: LOAD_TIMEOUT_MS, parseTimeoutMs: PARSE_TIMEOUT_MS };
let memo: { text: string; spans: [number, number][] } | null = null;

const firstLine = (e: unknown): string => String((e as Error)?.message ?? e).split("\n")[0];

export function rubyPrismRecord(): Readonly<RubyPrismRecord> {
  return { ...record };
}

/**
 * Test-only: replace the package specifier or the time-outs (null restores the defaults). Either way
 * the running worker is terminated, a remembered load failure is forgotten and the record is zeroed.
 */
export function setRubyPrismForTest(o: { module?: string; loadTimeoutMs?: number; parseTimeoutMs?: number } | null): void {
  settings = {
    module: o?.module ?? PRISM_MODULE,
    loadTimeoutMs: o?.loadTimeoutMs ?? LOAD_TIMEOUT_MS,
    parseTimeoutMs: o?.parseTimeoutMs ?? PARSE_TIMEOUT_MS,
  };
  drop();
  record = emptyRecord();
  memo = null;
}

function drop(): void {
  if (bridge !== null) void bridge.worker.terminate().catch(() => undefined);
  bridge = null;
}

/** `source` null is the load handshake: the signal is still the fresh 0, and the worker may already have set it. */
function exchange(b: Bridge, source: string | null, ms: number): Reply | "timeout" {
  if (source !== null) {
    Atomics.store(b.signal, 0, 0);
    b.port.postMessage(source);
  }
  const waited = Atomics.wait(b.signal, 0, 0, ms);
  const got = receiveMessageOnPort(b.port);
  if (got === undefined) return waited === "timed-out" ? "timeout" : { ok: false, error: "the worker signalled with no reply" };
  return got.message as Reply;
}

/**
 * Builds the bridge (the shared buffer, the channel, the worker) and waits for the load handshake;
 * returns why Prism could not be loaded when the worker says so or does not answer. It has no `try`
 * of its own: it runs only inside the one failure boundary. The bridge is installed as soon as the
 * worker exists, so that a throw after that point leaves `drop()` a worker to terminate.
 */
function open(): Bridge | string {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { role: ROLE, signal, port: port2, module: settings.module },
    transferList: [port2],
  });
  const b: Bridge = { worker, port: port1, signal };
  bridge = b;
  worker.on("error", () => undefined);
  worker.unref();
  port1.unref();
  const r = exchange(b, null, settings.loadTimeoutMs);
  if (r !== "timeout" && r.ok) return b;
  drop();
  return r === "timeout" ? `Prism did not load within ${settings.loadTimeoutMs} ms` : r.error;
}

/**
 * UTF-8 byte offsets to UTF-16 offsets into `text`, as `TextEncoder` encodes it; null unless every
 * offset falls on a character boundary within the text, each at or after the one before it.
 */
function toUtf16(text: string, bytes: number[]): number[] | null {
  const out: number[] = [];
  let b = 0;
  let i = 0;
  for (const want of bytes) {
    while (b < want && i < text.length) {
      const c = text.charCodeAt(i);
      if (c < 0x80) { b += 1; i += 1; }
      else if (c < 0x800) { b += 2; i += 1; }
      else if (c >= 0xd800 && c <= 0xdbff && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { b += 4; i += 2; }
      else { b += 3; i += 1; } // the rest of the BMP, and a lone surrogate (encoded as U+FFFD)
    }
    if (b !== want) return null;
    out.push(i);
  }
  return out;
}

function fail(kind: "unavailable" | "refused" | "timedOut" | "failed", why: string): [number, number][] {
  record[kind] += 1;
  record.lastFailure = why;
  return [];
}

/** Prism cannot be used in this thread: remembered, so later files are not retried (the test setting forgets it). */
function unavailable(why: string): [number, number][] {
  record.loadError = why;
  return fail("unavailable", why);
}

/** Where the line holding offset `at` starts. */
function lineStart(text: string, at: number): number {
  return at <= 0 ? 0 : text.lastIndexOf("\n", at - 1) + 1;
}

/**
 * The check on one document of the reply (the header): `[from, to)` starts at the start of a line
 * beginning `=begin`, and ends right after a later line beginning `=end` — after that line's newline,
 * or at the end of the file when it is the last line.
 */
function spansMarkerLines(text: string, from: number, to: number): boolean {
  if (!(to > from && (from === 0 || text[from - 1] === "\n") && text.startsWith("=begin", from))) return false;
  if (!(to === text.length || text[to - 1] === "\n")) return false;
  const last = lineStart(text, to - 1);
  return last > from && text.startsWith("=end", last);
}

/** Which files Prism is asked about: a line starting with `=begin` (wider than Ruby's own test). */
const EMBDOC_GATE = /(?:^\uFEFF?|\n)=begin/;

/**
 * The embedded documents Prism reports in `text`, as UTF-16 `[from, to)` spans (to the end of the
 * `=end` line, its newline included when there is one), or none on any failure (the header). Its
 * `try` is THE ONE FAILURE BOUNDARY of this module's calling side (the header).
 */
export function prismEmbdocSpans(text: string): [number, number][] {
  let building = false;
  try {
    if (!EMBDOC_GATE.test(text)) return [];
    if (memo !== null && memo.text === text) return memo.spans.map(([a, z]) => [a, z]);
    if (record.loadError !== null) return fail("unavailable", record.loadError);
    let b = bridge;
    if (b === null) {
      building = true;
      const opened = open();
      if (typeof opened === "string") return unavailable(opened);
      b = opened;
      building = false;
    }
    const r = exchange(b, text, settings.parseTimeoutMs);
    if (r === "timeout") {
      drop();
      return fail("timedOut", `Prism did not answer within ${settings.parseTimeoutMs} ms`);
    }
    if (!r.ok) {
      // Prism threw mid-parse (a WebAssembly trap leaves its heap in an unknown state): the next file gets a fresh worker.
      drop();
      return fail("failed", r.error);
    }
    if (r.errors > 0) return fail("refused", `Prism reported ${r.errors} error(s)`);
    const at = toUtf16(text, r.docs);
    if (at === null) return fail("failed", "an embedded document's offsets do not fall on character boundaries of the text, in order");
    const spans: [number, number][] = [];
    for (let k = 0; k < at.length; k += 2) {
      const [from, to] = [at[k], at[k + 1]];
      if (!spansMarkerLines(text, from, to)) {
        return fail("failed", `an embedded document does not run from a column-0 =begin line to the end of a later column-0 =end line (offsets ${from}-${to})`);
      }
      spans.push([from, to]);
    }
    record.parsed += 1;
    record.documents += spans.length;
    memo = { text, spans: spans.map(([a, z]) => [a, z]) };
    return spans;
  } catch (e) {
    drop();
    if (building) return unavailable(`the Prism worker could not be started: ${firstLine(e)}`);
    return fail("failed", `the exchange with Prism threw: ${firstLine(e)}`);
  }
}

// ---- the worker ---------------------------------------------------------------------------------

interface PrismResult { comments: { type: number; location: { startOffset: number; length: number } }[]; errors: unknown[] }

async function serve(d: { signal: Int32Array; port: MessagePort; module: string }): Promise<void> {
  const reply = (m: Reply): void => {
    d.port.postMessage(m);
    Atomics.store(d.signal, 0, 1);
    Atomics.notify(d.signal, 0);
  };
  // This thread runs Prism and nothing else; the one warning it raises is node:wasi's ExperimentalWarning.
  process.emitWarning = (() => undefined) as typeof process.emitWarning;
  let parse: (source: string) => PrismResult;
  try {
    const mod = await import(d.module);
    parse = await mod.loadPrism();
  } catch (e) {
    reply({ ok: false, error: `${d.module} could not be loaded: ${firstLine(e)}` });
    return;
  }
  d.port.on("message", (source: string) => {
    try {
      const res = parse(source);
      const docs: number[] = [];
      // Prism's comment types: 0 is `#`, 1 is the embedded document.
      for (const c of res.comments) if (c.type === 1) docs.push(c.location.startOffset, c.location.startOffset + c.location.length);
      reply({ ok: true, errors: res.errors.length, docs });
    } catch (e) {
      reply({ ok: false, error: `Prism threw: ${firstLine(e)}` });
    }
  });
  reply({ ok: true, errors: 0, docs: [] });
}

if (!isMainThread && (workerData as { role?: unknown } | null)?.role === ROLE) void serve(workerData);

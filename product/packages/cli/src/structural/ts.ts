/**
 * The thin layer between a tree-sitter parse tree and the adapters.
 *
 * Two things live here and nothing else: the accessors the adapters use, and the tree lifecycle.
 *
 * THE TREE LIFECYCLE IS THE REASON THIS FILE EXISTS. Every tree a parse creates is registered with
 * the session that asked for it, and the engine releases the session at the end of each file, before
 * the next one is read. Measured: releasing after every
 * file takes the parse loop over a large TypeScript data platform from 0.41 GB of peak resident memory to 0.12 GB, at no
 * cost in time. A language read through an injection — ERB, Blade — builds TWO trees for one file,
 * which is why the session holds a list rather than a single handle.
 */

import { performance } from "node:perf_hooks";
import type { Node as TsNode, Tree } from "web-tree-sitter";
import { discardParser, parserFor } from "./grammars.js";
import type { GrammarName } from "./languages.js";

export type { TsNode };

/** A grammar that could not be loaded. Distinguished from a parse that threw: different outcomes. */
export class GrammarUnavailableError extends Error {
  constructor(
    readonly grammar: GrammarName,
    message: string,
  ) {
    super(message);
    this.name = "GrammarUnavailableError";
  }
}

/**
 * THE STRUCTURAL READING OF ONE FILE HAS A TIME ALLOWANCE, and this is what it stops on.
 *
 * WHY. One 1 MB HTML file of `<script` repeated ran fifteen minutes inside ONE `parser.parse` under
 * `--file-budget 5`: the per-file clock is read between rules and between lines, and a parse is
 * neither. Measured alone, the
 * cost is not in how many operations the parse takes - those stay at about 0.3 per byte, as on any
 * HTML file - but in what each one costs: the vendored HTML grammar's scanner rebuilds its whole stack
 * of open tags (up to 65,535 of them) on every token it is asked about, so a file that only opens
 * tags makes every operation slower than the last. A count of operations therefore bounds nothing
 * here, and neither does a size or nesting test written for one grammar's scanner: TEN grammars are
 * vendored and each keeps state of its own.
 *
 * SO THE BOUND IS A CLOCK, read where web-tree-sitter 0.25.10 lets one be read inside a parse: the
 * `progressCallback` of `Parser.parse`, which the runtime calls after every 100 parser operations
 * (`OP_COUNT_PER_PARSER_TIMEOUT_CHECK`, `lib/parser.c` of the installed package) and which cancels the
 * parse when it returns true - `parse` then returns null. The same clock is read every
 * `WALK_STRIDE` steps of an adapter's walk over the tree (`kids` below), because the walk is the
 * other half of the structural reading and a 1 MB tree has close to a million nodes.
 *
 * ONE ALLOWANCE PER FILE, NOT PER CALL. Every parse a file's reading makes - the second tree of ERB
 * and Blade, the HAML fragments, the Pug recoveries, the HEEx sigils of an Elixir file - and every
 * walk over them draw on the same allowance, counted from the start of the reading. A per-call
 * allowance would let a file that parses a thousand fragments spend a thousand of them.
 *
 * WHAT A SPENT ALLOWANCE DOES: `ParseBoundError` is thrown, `parseForStructure` answers
 * `parse-bounded`, and the file is read by the line patterns alone, exactly as a file whose parse
 * threw is - nothing is dropped, every rule still reads every line - and the engine names it in
 * `files_partially_read` with the allowance and the time it had taken.
 */
export class ParseBoundError extends Error {
  constructor(
    readonly elapsedMs: number,
    readonly allowanceMs: number,
  ) {
    super(`the structural reading passed its ${allowanceMs} ms allowance (${Math.round(elapsedMs)} ms)`);
    this.name = "ParseBoundError";
  }
}

/** Every tree built while reading one file, so that all of them can be released together. */
export interface ParseSession {
  trees: Tree[];
  /** `performance.now()` when this file's structural reading began; the allowance counts from here. */
  startedAt: number;
  /** Milliseconds every parse and walk of this file may take together. `Infinity`: no allowance. */
  allowanceMs: number;
}

export function newSession(allowanceMs: number = Infinity): ParseSession {
  return { trees: [], startedAt: performance.now(), allowanceMs };
}

/** Milliseconds elapsed once the allowance is spent, or -1 while it lasts. */
function overAllowance(session: ParseSession): number {
  if (session.allowanceMs === Infinity) return -1;
  const elapsed = performance.now() - session.startedAt;
  return elapsed > session.allowanceMs ? elapsed : -1;
}

/** Throws `ParseBoundError` once the session's allowance is spent. */
export function checkAllowance(session: ParseSession): void {
  const elapsed = overAllowance(session);
  if (elapsed >= 0) throw new ParseBoundError(elapsed, session.allowanceMs);
}

/**
 * The session whose adapter is walking, so that `kids` - the one accessor every adapter's walk goes
 * through - can read its clock without a session being threaded through every call site. Set and
 * cleared by `parseForStructure` around the adapter; a parse is synchronous and one file is read at
 * a time per thread, so there is never more than one.
 */
let walking: ParseSession | null = null;
let walkSteps = 0;
/** Steps of a walk between two clock reads. */
const WALK_STRIDE = 1024;

export function setWalkingSession(session: ParseSession | null): void {
  walking = session;
  walkSteps = 0;
}

export function releaseSession(session: ParseSession): void {
  for (const t of session.trees) {
    try {
      t.delete();
    } catch {
      // A tree that refuses to be released is not a reason to abandon the ones that would.
    }
  }
  session.trees.length = 0;
}

/**
 * Parse one string with one grammar, registering the tree for release. The session's allowance is
 * read before the parse starts and inside it (see `ParseBoundError`); a parse it cancels throws.
 */
export function parseWith(grammar: GrammarName, source: string, session: ParseSession): TsNode {
  const { parser, error } = parserFor(grammar);
  if (parser === null) throw new GrammarUnavailableError(grammar, error);
  checkAllowance(session);
  let cancelledAt = -1;
  let tree: Tree | null;
  try {
    tree =
      session.allowanceMs === Infinity
        ? parser.parse(source)
        : parser.parse(source, null, {
            // Returning true cancels. The declared type says `void`; the runtime reads the value
            // (`_tree_sitter_progress_callback` in the installed `tree-sitter.js`, and `parser.c`).
            progressCallback: () => {
              cancelledAt = overAllowance(session);
              return cancelledAt >= 0;
            },
          });
  } catch (e) {
    // A parse that throws has been stopped by the runtime, not by the allowance (a cancel returns
    // null): measured, `x<y,` repeated grows the TypeScript parse's heap to the runtime's 2 GB
    // ceiling and the allocator aborts it (`RuntimeError: Aborted()`). The parser is left holding
    // the half-built parse, and every later file of its grammar then failed to parse - 220 of 507
    // ordinary files after one such file in one process.
    // So that parser is discarded and the next file of the grammar gets a new one; with that, 30
    // aborts in a row left 447 ordinary files parsing exactly as before them. This file still
    // answers `parse-failed`, as it did.
    discardParser(grammar);
    throw e;
  }
  if (tree === null) {
    // A cancelled parse is RESUMED by the next `parse` call on the same parser unless it is reset
    // (`Parser.reset` in the installed version's declarations), and parsers are kept per grammar for
    // the whole process: without this the next file of this language would continue this one.
    parser.reset();
    if (cancelledAt >= 0) throw new ParseBoundError(cancelledAt, session.allowanceMs);
    throw new Error(`the ${grammar} grammar returned no tree`);
  }
  session.trees.push(tree);
  return tree.rootNode;
}

/**
 * `children` is `(Node | null)[]` in web-tree-sitter; every adapter wants it without the nulls. Every
 * `WALK_STRIDE`th call reads the walking session's allowance (see `setWalkingSession`).
 */
export function kids(n: TsNode): TsNode[] {
  if (walking !== null && ++walkSteps % WALK_STRIDE === 0) checkAllowance(walking);
  return n.children.filter((c): c is TsNode => c !== null);
}

export function named(n: TsNode): TsNode[] {
  return kids(n).filter((c) => c.isNamed);
}

export function child(n: TsNode, type: string): TsNode | null {
  return kids(n).find((c) => c.type === type) ?? null;
}

/** 1-based line a node starts on. */
export const line1 = (n: TsNode): number => n.startPosition.row + 1;

/** 1-based line a node ends on. */
export const endLine1 = (n: TsNode): number => n.endPosition.row + 1;

/** Errors the parse itself reported. Not used to reject a file — a recovered tree still carries
 *  most of the document — but counted where a measurement needs to say how well a grammar coped. */
export function errorCount(root: TsNode): number {
  let n = 0;
  const visit = (x: TsNode): void => {
    if (x.type === "ERROR" || x.isMissing) n++;
    for (const c of kids(x)) visit(c);
  };
  visit(root);
  return n;
}

/**
 * Loading tree-sitter grammars, and the honest record of which ones could not be loaded.
 *
 * PACKAGING:
 * `web-tree-sitter` with the grammars vendored as `.wasm`. It is the only option that covers all
 * seven template languages on a machine with no C++ toolchain, it does the same parsing in a third
 * of the added wall clock of the native bindings (+18.4 s against +56.2 s on a large TypeScript data platform), and — the
 * part this file is written around — **the wasm tree has a `delete()` and the native tree has none**,
 * which is worth 0.41 GB -> 0.12 GB of peak resident memory.
 *
 * WHY LOADING IS PREPARED UP FRONT RATHER THAN LAZILY ON FIRST ENCOUNTER, which is a departure from
 * the integration design's decision 9 and is recorded here rather than left to be rediscovered:
 * `Language.load()` returns a promise, so a grammar cannot be loaded from inside a synchronous
 * function. Making the parse call async makes `runBuiltin` async, and `runScan` with it — and
 * `runScan` is consumed SYNCHRONOUSLY by a check (gate G3) and
 * a tool, neither of which the task that wrote this file was allowed to modify.
 * Both would then be handed a promise where they expect a findings object, and BOTH CRASH ON IT
 * IMMEDIATELY — `findings.candidates.flatMap(…)` throws `TypeError: Cannot read properties of
 * undefined (reading 'flatMap')` and `for (const c of m.findings.candidates)` throws `TypeError:
 * findings.candidates is not iterable`. Run, not reasoned about: independent verification ran both
 * expressions on 2026-08-11 and this file's earlier claim that they "would then silently read a
 * promise as a findings object and report every mutant undetected" was FALSE and is withdrawn. The
 * constraint is real and the divergence stands on it; the failure mode offered for it did not
 * exist, and a loud crash is the opposite of a silent one.
 *
 * So the async work is hoisted to the one place that can await it: `prepareStructural()`, called
 * from the CLI entry point BEFORE the scan, and only when the loaded bundle contains a rule that
 * declares `detector.structural_checks`. A bundle where no rule declares one loads nothing and pays
 * nothing.
 *
 * What is given up by that is decision 9's per-language residency — a repository that is entirely
 * PHP and Blade now also holds the JSX, HAML, Slim and Pug grammars. What is kept is everything
 * decision 9 was protecting: no pre-pass over the file list exists, `languageFor` is still a pure
 * function of one path, EVERY file is still parsed, and no code anywhere decides which files are
 * worth reading.
 *
 * A FAILED LOAD IS REMEMBERED, not retried per file (decision 9c): one attempt per grammar per
 * process, its error kept with it, so `structural_grammars_unavailable` can name each language once
 * with one message while `structural_grammar_unavailable` counts every file that hit it. The reader
 * then sees both what failed and how big the hole is.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Language, Parser as ParserType } from "web-tree-sitter";
import { GRAMMAR_NAMES, type GrammarName } from "./languages.js";
import { testSeamArmed } from "../test-seams.js";

/**
 * Where the vendored `.wasm` grammars live: `<wolfboy>/grammars/`. `import.meta.url` is
 * `<pkg>/dist/structural/grammars.js` in a build and `<pkg>/src/structural/grammars.ts` in the
 * sources; both are one directory below the package root.
 */
export const GRAMMAR_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "grammars");

/**
 * `grammars/third-party.json` is THE SINGLE AUTHORITY for what is vendored: which artefact each
 * language key is read from, where it came from, how it was built and under what licence. The
 * scanner is one of its four consumers and keeps no list of filenames of its own — the licence
 * gate, the preflight gate, the rebuild tool and this loader all resolve the same way, so an
 * artefact that is renamed, added or withdrawn moves in one place.
 */
const INVENTORY = join(GRAMMAR_DIR, "third-party.json");

interface InventoryEntry {
  language: string;
  artifact: string;
}

let artefacts: Map<string, string> | null = null;
let inventoryError: string | null = null;

function artefactFor(name: GrammarName): string | null {
  if (artefacts === null) {
    try {
      const doc = JSON.parse(readFileSync(INVENTORY, "utf8")) as { vendored?: InventoryEntry[] };
      artefacts = new Map((doc.vendored ?? []).map((v) => [v.language, v.artifact]));
    } catch (e) {
      artefacts = new Map();
      inventoryError = `${INVENTORY}: ${firstLine(e)}`;
    }
  }
  return artefacts.get(name) ?? null;
}

/** The file a grammar is loaded from, or null when the inventory does not name one. */
export function grammarFile(name: GrammarName): string | null {
  const artefact = artefactFor(name);
  return artefact === null ? null : join(GRAMMAR_DIR, artefact);
}

/** One attempt per grammar per process: the Language, or the reason there is none. */
type GrammarSlot = { language: Language; error: null } | { language: null; error: string };

const grammars = new Map<GrammarName, GrammarSlot>();
const parsers = new Map<GrammarName, ParserType>();
let ParserClass: typeof ParserType | null = null;
let runtimeError: string | null =
  "the structural runtime was not initialised — the caller must `await prepareStructural()` before runScan()";
let preparing: Promise<void> | null = null;

const firstLine = (e: unknown): string => String((e as Error)?.message ?? e).split("\n")[0];

/**
 * Initialise the parser runtime and load every vendored grammar. Idempotent, and safe to call when
 * nothing is vendored: a grammar with no file is recorded as unavailable with that as its reason and
 * every file of that language falls back to the line-based reading, counted.
 *
 * This is the ONE place eager loading is correct. It must not be called per file, and nothing below
 * `parseForStructure` may call it: see the header for why the alternative breaks two gates.
 */
export function prepareStructural(): Promise<void> {
  if (preparing) return preparing;
  preparing = (async () => {
    // THE TEST-ONLY SEAM `no-grammars`, and why the engine has one at all.
    //
    // A test asserts that a scan's document does not depend on `--jobs`,
    // and one of the things it must assert that over is the state this file reports when a grammar
    // cannot be loaded: `mergeShards` merges `grammarsUnavailable` by smallest file index with the
    // file counts summed, and that merge crosses the worker boundary as a tuple array. Every
    // grammar is vendored, so through the built CLI that state was UNREACHABLE and the gate's tree
    // S compared two documents in which it never fired. It is reachable now.
    //
    // It produces exactly the state a machine with no vendored grammars is already in — every
    // language unavailable, every file that would have been parsed counted and named in
    // `structural_grammars_unavailable` with the reason below — and nothing else: no rule, no
    // pattern and no threshold is touched, and the reason string says what it was. Armed only by
    // name in `PRODUCT_CLI_TEST_SEAM` (test-seams.ts), and read here rather than in the CLI so that
    // a worker thread is in the same state as the thread that started it.
    if (testSeamArmed("no-grammars")) {
      runtimeError = "the structural runtime was disabled by the test-only seam PRODUCT_CLI_TEST_SEAM=no-grammars";
      return;
    }
    let mod: typeof import("web-tree-sitter");
    try {
      mod = await import("web-tree-sitter");
      await mod.Parser.init();
    } catch (e) {
      // The runtime itself is missing or refused to start. Every language is then unavailable, and
      // every file that would have been parsed is counted as such rather than silently skipped.
      runtimeError = `web-tree-sitter could not be initialised: ${firstLine(e)}`;
      return;
    }
    ParserClass = mod.Parser;
    runtimeError = null;
    for (const name of GRAMMAR_NAMES) {
      const path = grammarFile(name);
      if (path === null) {
        grammars.set(name, {
          language: null,
          error: inventoryError ?? `no entry for "${name}" in ${INVENTORY}`,
        });
        continue;
      }
      if (!existsSync(path)) {
        grammars.set(name, { language: null, error: `no grammar file at ${path}` });
        continue;
      }
      try {
        const language = await mod.Language.load(new Uint8Array(readFileSync(path)));
        grammars.set(name, { language, error: null });
      } catch (e) {
        grammars.set(name, { language: null, error: firstLine(e) });
      }
    }
  })();
  return preparing;
}

/**
 * A parser bound to one grammar, or the reason there is none. Synchronous by construction: every
 * await this needs has already happened in `prepareStructural`.
 */
export function parserFor(name: GrammarName): { parser: ParserType; error: null } | { parser: null; error: string } {
  if (runtimeError !== null) return { parser: null, error: runtimeError };
  const cached = parsers.get(name);
  if (cached) return { parser: cached, error: null };
  const slot = grammars.get(name) ?? { language: null, error: `grammar ${name} was not loaded` };
  if (slot.language === null) return { parser: null, error: slot.error };
  try {
    const p = new ParserClass!();
    p.setLanguage(slot.language);
    parsers.set(name, p);
    return { parser: p, error: null };
  } catch (e) {
    // A grammar that loads but cannot be bound (an ABI the runtime no longer supports) is the same
    // hole as one that never loaded, and is remembered the same way.
    grammars.set(name, { language: null, error: firstLine(e) });
    return { parser: null, error: firstLine(e) };
  }
}

/**
 * Forget one grammar's parser after a parse threw out of the runtime (`parseWith` in ts.ts),
 * so that the next file of that grammar is parsed by a new parser and not by the one holding
 * the aborted parse. The runtime itself is kept: re-creating it is asynchronous, which the scan is
 * not (see the header), and measured it was not needed - a new parser on the same runtime parsed
 * every ordinary file exactly as before the abort. Freeing the old parser may fail on a runtime in
 * that state; it is dropped either way.
 */
export function discardParser(name: GrammarName): void {
  const p = parsers.get(name);
  parsers.delete(name);
  if (p === undefined) return;
  try {
    p.delete();
  } catch {
    // The parser is unreachable from here on whether or not its memory came back.
  }
}

/**
 * What every grammar did, for the preflight gate and for `doctor`. Eager by nature and correct here,
 * for the same reason it is wrong inside a scan: a grammar list that outgrows its fixtures is the
 * ordinary way this rots, and the preflight is the gate that turns that red.
 */
export function grammarReport(): { name: GrammarName; file: string | null; ok: boolean; error: string | null }[] {
  return GRAMMAR_NAMES.map((name) => {
    const r = parserFor(name);
    return { name, file: grammarFile(name), ok: r.parser !== null, error: r.error };
  });
}

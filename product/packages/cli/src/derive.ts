/**
 * Derived views of a file, for rules that opt into them.
 *
 * WHY THIS EXISTS, AND WHAT IT IS NOT ALLOWED TO DO.
 *
 * Two mutation escapes recorded on 2026-08-11 are not spelling problems. Both are cases where the
 * fact a rule needs is in the file, is not on the line the rule must report, and is reachable only
 * by an operation a forward-scanning regular expression does not perform:
 *
 *   1. `eu-retention-001`, a mutant of one of its YAML fixtures (retention settings). A YAML merge key
 *      (`defaults: &common` … `<<: *common`) puts the declared bound the gate is looking for in a
 *      different block of the same document. Resolving it is YAML semantics.
 *   2. `eu-consent-018`, `bad-campaign-send.mut-4.py`. `import mailchimp_marketing as Audience` on
 *      one line, `mailchimp = Audience.Client()` five lines later. Binding the alias to the module
 *      is data flow, and the line that shows where the sending happens carries only the alias.
 *
 * THE ONE HARD CONSTRAINT: REPORTED LINE NUMBERS MUST NOT MOVE. 54 rules run through this engine.
 * A derived view is therefore never substituted for the file. It is a SEPARATE STRING that is
 * tested in ADDITION to the original, so that:
 *
 *   - the original text remains the sole authority for which line a candidate is on and for the
 *     `lineText` a finding quotes;
 *   - a rule that does not opt in cannot observe any difference at all — the view is never built
 *     for it, and the expressions it is tested against are unchanged;
 *   - a rule that does opt in can only gain matches, never lose one, because the original test is
 *     still evaluated first and the derived test is OR-ed after it.
 *
 * The YAML view is document-shaped and its line structure has nothing to do with the file's, which
 * is exactly why it may only ever reach a FILE-LEVEL gate (`also_in_file`). The alias view is
 * line-for-line aligned with the original by construction — one substitution inside one line, no
 * line added, removed or reordered — which is why it may reach the per-line `match` step without
 * being able to move a line number.
 *
 * The joined-construct view at the foot of this file is the alias view's kind and not the YAML
 * view's, and for the same reason: it is one string per original line, at that line's own index, so
 * `i` still names the same line of the file. What it puts at that index is the whole of the
 * bracketed construct the line OPENS — a struct literal, an options object, a call's arguments —
 * which no clause could see while the engine tested one physical line at a time. See
 * `joinedConstructView` for the escapes that motivated it, all three of them recorded in shipped
 * rules' own prose before it existed.
 *
 * LINE STRUCTURE IS NOT THE ONLY THING THAT DECIDES WHICH STEP A VIEW MAY REACH, and the
 * comment-visible view is the case that shows it. That view IS the file, line for line — its line
 * structure is not merely aligned with the original's, it is the original's — so the paragraph
 * above would let it reach the per-line `match` step, and it still may not. Two other rules stop
 * it. First, `guard_missing` is closed to EVERY view, present and future, because a guard DELETES
 * candidates and a comment that satisfies one is a miss: that is the polarity argument, it is
 * absolute, and it is the reason nothing analogous to the comment-visible view may ever be offered
 * for that field. Second, the match side already has its own field for the same question —
 * `detector.match_in_comments`, declared per rule — so a view reaching the match step would be a
 * second, undeclared answer to a question a rule has already answered. See `commentsVisibleView`.
 */

import type { JoinedFrom } from "wolfboy-schemas";
import { parseAllDocuments, stringify, visit } from "yaml";
import { hasDuplicateKey } from "./yaml-unique-keys.js";
import { MAX_YAML_EXPANDED_NODES, prepareAliases } from "./yaml-alias-work.js";

/** Derived views a rule may name in `detector.gate_view`. */
export type GateViewName = "yaml-anchors" | "comments-visible";

export type ViewOutcome =
  | "built"
  | "not-applicable" // wrong extension, or nothing in the file for this view to resolve
  | "too-large" // refused on size, so the gate sees the unexpanded text
  | "failed" // malformed input; the gate sees the unexpanded text
  | "partial-source"; // the file had a line blanked by the ceiling; see PARTIAL_SOURCE below

export interface DerivedView {
  text: string | null;
  outcome: ViewOutcome;
}

const NOT_APPLICABLE: DerivedView = { text: null, outcome: "not-applicable" };

/**
 * The answer for a view whose reading is NOT LINE-LOCAL, over a file the minification ceiling
 * reduced (`walk.ts blankLongLines`, from 2026-09-07).
 *
 * **Why a whole view is refused rather than built from the reduced text.** `yamlAnchorView` parses
 * the document. A line replaced by the empty string is not a line the parser can ignore: it ends a
 * block scalar, breaks an indented mapping and can turn a valid document into one that either fails
 * to parse or, worse, parses into a DIFFERENT document — and the expansion of that document would
 * then be offered to a gate as if it were the file. Blanking is safe for every reading that decides
 * one line at a time (`match`, `guard_missing`, `also_in_file`, `comments-visible`, the joined
 * fold), because on a blanked line each of those decides exactly as it decides on an empty line;
 * it is not safe for a reading whose answer for line 1467 depends on line 1304.
 *
 * **Applicability is asked BEFORE this is returned** (`yamlViewApplies`), so a file this view was
 * never going to have an answer for stays `not-applicable` and is not counted as a failure — see
 * that function for the measurement that forced the order.
 *
 * **Refusing costs nothing that was previously had.** Such a file was read to no rule at all before
 * 2026-09-07, so no gate anywhere ever saw its expansion. The refusal is counted rather than
 * silent — `derived_views_failed`, whose meaning is already "the declared view could not be
 * produced and the gate fell back to the file's own text" — and WHICH files are in this population
 * is recoverable from `files_partially_read`, so the cause is not lost by sharing the counter.
 */
export const PARTIAL_SOURCE: DerivedView = { text: null, outcome: "partial-source" };

/**
 * Ceiling on the YAML a single file may expand. A scan must never be at the mercy of one
 * pathological document: past this size the view is refused, the outcome is counted, and the gate
 * falls back to the unexpanded text — which is the behaviour every rule had before this file
 * existed, so refusing can never lose a candidate that was previously found.
 */
const MAX_YAML_INPUT_BYTES = 1_000_000;
const MAX_YAML_OUTPUT_BYTES = 4_000_000;
// The third ceiling, on the expansion itself, is `MAX_YAML_EXPANDED_NODES` (yaml-alias-work.ts).

/**
 * Cheap pre-test: does this text contain anything an expansion could resolve? An alias node
 * (`*name`) or a merge key (`<<:`). An anchor with no alias pointing at it changes nothing about
 * the resolved document, so it is deliberately not a trigger.
 *
 * This runs on every YAML file a rule that opts in touches, and the parse runs only on the few
 * that pass it.
 */
const YAML_ALIAS_HINT = /(?:^|[\s,[{])\*[A-Za-z0-9_]|<<[ \t]*:/;

function extensionOf(fileName: string): string {
  const slash = Math.max(fileName.lastIndexOf("/"), fileName.lastIndexOf("\\"));
  const base = fileName.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/**
 * Whether this view has anything to say about a file AT ALL, judged on the name alone.
 *
 * **Exported so that a caller which means to REFUSE the view can ask first**, which is the order the
 * structural side already uses: `parse.ts refuseForPartialSource` answers `no-adapter` before it
 * counts a refusal, *"because 'this language has no structural reading' is true of the file whether
 * or not a line was blanked"*. The identical sentence is true here, and until 2026-09-07 it was not
 * applied: `engine.ts` returned `PARTIAL_SOURCE` for every file the minification ceiling had reduced,
 * so a `.php`, `.svg` or `.js` file — which this view has never had an answer for — was counted in
 * `derived_views_failed` as a view that "could not be produced". Measured over fifteen corpus trees:
 * the counter read 731 where 730 of the files were not YAML and exactly 1 was (independent
 * verification, 2026-09-07, M1). No candidate could move — a refused view and an inapplicable view
 * both carry `text: null` and both leave the gate on the file's own text — but the published
 * statistic was wrong, and a degrade counter that counts non-degrades is the same defect as one that
 * counts nothing.
 *
 * The test is the EXTENSION only, deliberately, and not `YAML_ALIAS_HINT`. The extension is a
 * property of the file's name and cannot be changed by blanking a line; the alias hint is a property
 * of the CONTENT, and on a reduced file the alias may be the very thing that was blanked — asking it
 * there would answer "nothing to resolve" about a document that has something to resolve, and would
 * turn a refusal that should be counted into a silence.
 */
export function yamlViewApplies(fileName: string): boolean {
  const ext = extensionOf(fileName);
  return ext === "yml" || ext === "yaml";
}

/**
 * The document a YAML file describes, with anchors, aliases and merge keys resolved, rendered back
 * as YAML text.
 *
 * `content` is expected to be the comment-blanked text (`contentForGuards`), for the reason that
 * governs every file-level gate in this engine: a maintainer writing down that a duty is unmet must
 * not be read as evidence that it is met (see strip-comments.ts). The parser drops comments in any
 * case; passing the blanked text keeps the two paths from ever disagreeing about what a gate can
 * see.
 *
 * Rendering choices, each of which is load-bearing:
 *   - `merge: true` — `<<` is a YAML 1.1 feature and is off by default for 1.2 documents. Without
 *     it the merge key stays an ordinary key called `<<` and the escape is not closed.
 *   - `aliasDuplicateObjects: false` — the serialiser re-creates anchors for objects it sees twice,
 *     which would put `*a1` back into the output and undo the expansion for plain aliases. A merge
 *     copies, so merge keys survive the default; a plain `a: *d` does not.
 *   - `maxAliasCount: 100` — the library's own billion-laughs protection, kept at its default.
 *     Exceeding it throws and is counted as a fallback rather than being allowed to expand. It
 *     does not see aliases of empty collections or merge keys at all; the expansion ceiling of
 *     yaml-alias-work.ts does, before `toJS` is called.
 *
 * Every failure path returns `text: null`, which puts the gate back on the unexpanded text.
 */
export function yamlAnchorView(fileName: string, content: string): DerivedView {
  if (!yamlViewApplies(fileName)) return NOT_APPLICABLE;
  if (!YAML_ALIAS_HINT.test(content)) return NOT_APPLICABLE;
  if (content.length > MAX_YAML_INPUT_BYTES) return { text: null, outcome: "too-large" };

  let docs;
  try {
    // The package's own duplicate-key test is quadratic in a mapping's size; it is asked in linear
    // time below instead, with the same answer (yaml-unique-keys.ts).
    docs = parseAllDocuments(content, { merge: true, uniqueKeys: false });
  } catch {
    return { text: null, outcome: "failed" };
  }

  const parts: string[] = [];
  let sawAlias = false;
  let sawFailure = false;
  let expanded = 0;
  for (const doc of docs) {
    if (doc.errors.length > 0 || hasDuplicateKey(doc)) {
      sawFailure = true;
      continue;
    }
    let hasAlias = false;
    try {
      visit(doc, {
        Alias() {
          hasAlias = true;
          return visit.BREAK;
        },
      });
    } catch {
      sawFailure = true;
      continue;
    }
    if (!hasAlias) continue;
    // The package's alias work is bounded before it is asked for (yaml-alias-work.ts):
    // every alias resolved once, a recursive anchor (`a: &x { b: *x }`) answered as before without
    // the stack overflow that answered it, and the expansion counted against its ceiling.
    let work;
    try {
      work = prepareAliases(doc.contents, MAX_YAML_EXPANDED_NODES - expanded);
    } catch {
      sawFailure = true;
      continue;
    }
    if (work.recursive) {
      sawFailure = true;
      continue;
    }
    expanded += work.expanded;
    if (expanded > MAX_YAML_EXPANDED_NODES) return { text: null, outcome: "too-large" };
    try {
      const js = doc.toJS({ maxAliasCount: 100 });
      parts.push(stringify(js, { lineWidth: 0, aliasDuplicateObjects: false }));
      sawAlias = true;
    } catch {
      sawFailure = true;
    }
  }

  if (parts.length === 0) return sawFailure ? { text: null, outcome: "failed" } : NOT_APPLICABLE;
  const text = parts.join("\n---\n");
  if (text.length > MAX_YAML_OUTPUT_BYTES) return { text: null, outcome: "too-large" };
  return { text, outcome: sawAlias ? "built" : "not-applicable" };
}

// ---------------------------------------------------------------------------------------------
// Comments visible — the file's own text, with nothing blanked
// ---------------------------------------------------------------------------------------------

/**
 * The file's own text with NOTHING blanked: the reading every gate had before 2026-07-27, offered
 * back to one rule at a time.
 *
 * ## Why a view that does no work at all exists
 *
 * Every file-level gate in this engine reads `contentForGuards` output, because a maintainer
 * writing down that a duty is UNMET must not be read as evidence that it is met — demonstrated on
 * four rules in one day (see strip-comments.ts). The cost of that decision on the POSITIVE field is
 * measured. Of one Laravel tree's `config/auth.php`, `config/session.php` and `config/sanctum.php`,
 * ZERO time-unit words survive comment-blanking in any of the three (2026-09-02), so no
 * `also_in_file` clause of any rule, new or shipped, can see what those files say their own
 * sentinels MEAN; `eu-retention-001` records the same for three other trees, quotes
 * the three comments in its own prose, and holds one as a fixture annotated as a MISS rather than a
 * boundary.
 *
 * ## THE POLARITY ARGUMENT, WHICH IS WHY THIS IS ADMISSIBLE AND WHY NOTHING LIKE IT EVER REACHES
 * `guard_missing`
 *
 * The 2026-07-27 change bundled two fields whose signs are opposite, and strip-comments.ts records
 * both in one paragraph. `guard_missing` is NEGATIVE: a comment that satisfies it DELETES every
 * candidate of its rule in scope, which is the invisible, uncountable direction,
 * and the header of this file already forbids any view from reaching it. `also_in_file` is
 * POSITIVE: a comment that satisfies it ADDS a candidate the adjudicator then reads, which is the
 * visible, countable, fixable direction. Under a later decision —
 * the second is a COST and not a defect.
 *
 * **THE 2026-07-27 DEFAULT IS NOT CHANGED AND MUST NOT BE.** Every gate of every rule still reads
 * the blanked text, first and by default. This is one rule at a time asking for the unblanked text
 * as a SECOND string, after its own gate has already shut on the first.
 *
 * ## The honest limit, stated here rather than left to be found
 *
 * This cannot distinguish a comment that states a setting's MEANING from one that states its
 * ABSENCE, and it does not try — judging prose is layer 2's work. A rule opting in is accepting
 * that `# retention: we do not delete anything` can open a gate whose clause is a bare unit word.
 * That is a candidate layer 2 reads and not a miss, but it is why a declaring rule's clauses must
 * be specific enough that a maintainer's note about the OPPOSITE state cannot satisfy them, and why
 * its `evidence_template` must say the corroboration may be prose. Both requirements are written
 * into rule.schema.json, and a test holds the weakness as a DISCLOSED-COST
 * fixture asserted to fire, so that it is counted rather than merely known.
 *
 * ## No failure mode, and no ceiling
 *
 * There is nothing to parse and nothing to bound, so no path returns `failed` or `too-large` and
 * `stats.derived_views_failed` can never be incremented by this view; `stats.derived_views_built`
 * counts it exactly as it counts `yaml-anchors`. Where the raw text and the blanked text are
 * IDENTICAL there is no second string to offer — the file carries no comment this repository's
 * stripper recognises — and the view is `not-applicable`, so a text the gate has already read in
 * full is not counted a second time.
 *
 * ## Why the blanked text is a parameter rather than a second call to the stripper
 *
 * `guardContent` is the caller's own `contentForGuards(file, content)`. strip-comments.ts is the
 * single authority on what a comment is in this engine, and a second call site here would be free
 * to disagree with the very text the gate was tested against — a forbidden second copy.
 * It is also why this function takes no file name: the language question has already been answered
 * by the text it is handed, and an extension table in this file beside the one in strip-comments.ts
 * is exactly the defect that file's own header records finding three times in one day.
 */
export function commentsVisibleView(content: string, guardContent: string): DerivedView {
  if (content === guardContent) return NOT_APPLICABLE;
  return { text: content, outcome: "built" };
}

// ---------------------------------------------------------------------------------------------
// Import aliases
// ---------------------------------------------------------------------------------------------

/**
 * What names this file binds to a module, and which lines did the binding.
 *
 * ONLY TRUE ALIASES ARE BOUND, and the restriction is deliberate rather than an unfinished edge:
 *
 *   - `import mod as alias`, `from mod import name as alias`, `import X from "mod"`,
 *     `import * as X from "mod"`, `import { A as B } from "mod"`, `const X = require("mod")`,
 *     `const { a: b } = require("mod")` — in every one of these the local name is a name the
 *     module does NOT have, so a rule looking for the module cannot see it at the use site. That
 *     is the gap.
 *   - `import { Client } from "mod"` / `from mod import Client` bind a name the module itself
 *     uses. The spelling a rule would look for is already written at the use site, so there is
 *     nothing hidden and nothing to resolve. Binding them anyway would rewrite every imported
 *     identifier in every file, which is a far larger change with no escape behind it.
 */
export interface AliasTable {
  /** local name -> the module path, or `module.member` for a renamed member import. */
  bindings: Map<string, string>;
  /** 0-based indices of lines that are part of an import statement. */
  importLines: Set<number>;
  /** Alternation over the bound names, or null when there is nothing to substitute. */
  probe: RegExp | null;
}

const EMPTY_TABLE: AliasTable = { bindings: new Map(), importLines: new Set(), probe: null };

const JS_EXTS = new Set([
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts", "vue", "svelte", "astro",
]);
const PY_EXTS = new Set(["py", "pyi"]);

/** A ceiling on how many names one file may rebind, so the substitution regex stays small. */
const MAX_BINDINGS = 200;

function escapeForClass(name: string): string {
  return name.replace(/[$]/g, "\\$");
}

/**
 * Build the alias table for one file.
 *
 * `content` is expected to be the comment-blanked text: a commented-out import must not create a
 * binding, for the same reason a comment must not open a gate.
 */
export function importAliasTable(fileName: string, content: string): AliasTable {
  const ext = extensionOf(fileName);
  const js = JS_EXTS.has(ext);
  const py = PY_EXTS.has(ext);
  if (!js && !py) return EMPTY_TABLE;
  if (!/\b(?:import|require|from)\b/.test(content)) return EMPTY_TABLE;

  const bindings = new Map<string, string>();
  const importLines = new Set<number>();
  // Line index of a character offset, computed once by prefix counting rather than per match.
  const lineStarts: number[] = [0];
  for (let i = 0; i < content.length; i++) if (content[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (offset: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const markSpan = (from: number, to: number): void => {
    for (let l = lineOf(from); l <= lineOf(to); l++) importLines.add(l);
  };
  // First binding wins: a name rebound later in the file is a shadowing question this table does
  // not attempt to answer, and taking the first keeps the result independent of match order.
  const bind = (name: string, target: string): void => {
    if (!name || !target) return;
    if (bindings.size >= MAX_BINDINGS) return;
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) return;
    if (name === target) return;
    if (!bindings.has(name)) bindings.set(name, target);
  };

  if (js) {
    const RENAMED = /([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)/g;
    const bindRenamed = (inside: string, mod: string): void => {
      RENAMED.lastIndex = 0;
      for (let r = RENAMED.exec(inside); r; r = RENAMED.exec(inside)) bind(r[2], `${mod}.${r[1]}`);
    };
    // One statement on one line: import X from "m" / import X, { A as B } from "m" /
    // import * as N from "m" / import X, * as N from "m".
    const IMPORT = /\bimport\s+(?!type\s)([^;\n]*?)\s+from\s*["']([^"'\n]+)["']/g;
    for (let m = IMPORT.exec(content); m; m = IMPORT.exec(content)) {
      markSpan(m.index, m.index + m[0].length);
      const clause = m[1];
      const mod = m[2];
      const dflt = /^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(clause);
      if (dflt) bind(dflt[1], mod);
      const ns = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
      if (ns) bind(ns[1], mod);
      const braces = /\{([\s\S]*?)\}/.exec(clause);
      if (braces) bindRenamed(braces[1], mod);
    }
    // The same statement after a formatter has split the named-import list over several lines,
    // which is what Prettier produces past the print width and is therefore the commoner spelling
    // in real trees. The list body is `[^}]`, so the span cannot run past the closing brace into a
    // later statement; the optional leading name is the default import written beside the list.
    const IMPORT_BRACED =
      /\bimport\s+(?!type\s)(?:([A-Za-z_$][\w$]*)\s*,\s*)?\{([^}]{0,2000})\}\s*from\s*["']([^"'\n]+)["']/g;
    for (let m = IMPORT_BRACED.exec(content); m; m = IMPORT_BRACED.exec(content)) {
      markSpan(m.index, m.index + m[0].length);
      if (m[1]) bind(m[1], m[3]);
      bindRenamed(m[2], m[3]);
    }
    // const X = require("m") / const X = await import("m")
    const REQ = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:require|import)\s*\(\s*["']([^"'\n]+)["']/g;
    for (let m = REQ.exec(content); m; m = REQ.exec(content)) {
      markSpan(m.index, m.index + m[0].length);
      bind(m[1], m[2]);
    }
    // const { a: b } = require("m")
    const REQ_DESTRUCTURE = /\b(?:const|let|var)\s*\{([^}]{0,2000})\}\s*=\s*(?:await\s+)?(?:require|import)\s*\(\s*["']([^"'\n]+)["']/g;
    for (let m = REQ_DESTRUCTURE.exec(content); m; m = REQ_DESTRUCTURE.exec(content)) {
      markSpan(m.index, m.index + m[0].length);
      const RENAMED = /([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)/g;
      for (let r = RENAMED.exec(m[1]); r; r = RENAMED.exec(m[1])) bind(r[2], `${m[2]}.${r[1]}`);
    }
  }

  if (py) {
    // import a.b.c as alias  (comma-separated forms handled one clause at a time)
    const PY_IMPORT = /^[ \t]*import[ \t]+([^\n#]+)/gm;
    for (let m = PY_IMPORT.exec(content); m; m = PY_IMPORT.exec(content)) {
      markSpan(m.index, m.index + m[0].length);
      for (const clause of m[1].split(",")) {
        const a = /^\s*([\w.]+)\s+as\s+([A-Za-z_]\w*)\s*$/.exec(clause);
        if (a) bind(a[2], a[1]);
      }
    }
    // from mod import name as alias[, name2 as alias2]  — parenthesised and backslash forms too.
    // The parenthesised body is `[^)]` and bounded rather than an unbounded lazy span: a list that
    // is never closed would otherwise be scanned to end of file once per occurrence. Measured over
    // all 5,586 Python files in the pinned corpus that contain `from`, the bounded and unbounded
    // forms produce **identical bindings in every file**, so this costs no reach.
    const PY_FROM = /^[ \t]*from[ \t]+([\w.]+)[ \t]+import[ \t]+(\([^)]{0,2000}\)|[^\n#]+(?:\\\n[^\n#]*)*)/gm;
    for (let m = PY_FROM.exec(content); m; m = PY_FROM.exec(content)) {
      markSpan(m.index, m.index + m[0].length);
      const RENAMED = /([\w]+)\s+as\s+([A-Za-z_]\w*)/g;
      for (let r = RENAMED.exec(m[2]); r; r = RENAMED.exec(m[2])) bind(r[2], `${m[1]}.${r[1]}`);
    }
  }

  if (bindings.size === 0) return { bindings, importLines, probe: null };
  const names = [...bindings.keys()].sort((a, b) => b.length - a.length).map(escapeForClass);
  // A bound name is only a use of the alias when it stands alone: not inside a longer identifier,
  // and not after a dot, where it is a property of something else.
  const probe = new RegExp(`(?<![\\w$.])(?:${names.join("|")})(?![\\w$])`, "g");
  return { bindings, importLines, probe };
}

/**
 * One line with its alias uses replaced by what they were imported as.
 *
 * Returns the line unchanged when nothing applies, so the caller can compare by identity and skip
 * the extra match pass entirely. Line length may change; the line's INDEX cannot, because this
 * function is called once per line and returns exactly one line.
 */
export function resolveAliasesInLine(line: string, table: AliasTable): string {
  if (!table.probe) return line;
  table.probe.lastIndex = 0;
  return line.replace(table.probe, (name) => table.bindings.get(name) ?? name);
}

// ---------------------------------------------------------------------------------------------
// Local values — one hop, same file
// ---------------------------------------------------------------------------------------------

/**
 * What names this file binds to a STRING LITERAL, and which lines did the binding.
 *
 * This is the second binding form in this file and it is deliberately a sibling of `AliasTable`
 * rather than an extension of it: `resolve_import_aliases` is declared by 10 rules today, and
 * widening what those ten see without their authors declaring it is the one thing a per-rule opt-in
 * exists to prevent. A rule reaches this table only through `detector.resolve_local_values`.
 *
 * THE HOP IS ONE HOP, AND THE BOUND IS STRUCTURAL RATHER THAN A COUNTER. A name is bound only when
 * its definition's right-hand side is a complete string literal. A definition whose right-hand side
 * is another NAME binds nothing at all, so there is no second edge to follow and no chain to walk:
 *
 *     const HOST = "example.com";   // HOST -> example.com          (bound)
 *     const ALIAS = HOST;           // ALIAS -> (nothing)           (not bound)
 *     fetch(ALIAS)                  // no substitution, no candidate
 *
 * A test asserts that chain stays dark. Depth is what is bounded; the number
 * of DISTINCT names resolved inside one line is not, because two names each resolved from their own
 * definition are two independent one-hop reads and neither is reached through the other.
 *
 * WHAT IS OUT OF SCOPE, AND SAID SO RATHER THAN LEFT TO BE DISCOVERED:
 *
 *   - **Across files.** `content` is one file's text and nothing here is carried to the next file.
 *     A value defined in `config.ts` and read in `mailer.ts` is invisible, by construction.
 *   - **Across processes.** `process.env.X`, `$_SERVER['HTTP_HOST']`, `System.getenv`, a request
 *     header — the value does not exist in the repository at all, so no reading of the repository
 *     can produce it. A made-up `.secure(config.https)` is this case and stays open.
 *   - **Anything needing a parse tree.** Scope, shadowing inside a block, a value returned by a
 *     helper function, a builder receiving `.Append` over four statements. The unit here is the
 *     file's text and one line at a time, exactly as the alias table's is.
 */
export interface ValueTable {
  /** bound name (no sigil) -> the literal's CONTENT, without its quotes. */
  values: Map<string, string>;
  /** bound name -> 0-based index of the line that bound it. */
  definedAt: Map<string, number>;
  /** bound name -> the sigil the definition wrote, one of "", "$", "@". */
  sigils: Map<string, string>;
  /** 0-based indices of lines that BOUND something, so a definition cannot resolve into itself. */
  definitionLines: Set<number>;
  /** Alternation over the bound names in every read shape, or null when there is nothing to do. */
  probe: RegExp | null;
  /**
   * The quote state open at the START of each line of the file this table was built from — the one
   * fact about quoting that a single line cannot supply for itself (`lineQuoteStarts`).
   *
   * IT TRAVELS WITH THE TABLE RATHER THAN WITH THE CALL, so that it cannot be computed from a
   * different text than the one that bound the names. The caller supplies a line INDEX and never a
   * state, which is what makes that impossible rather than merely discouraged.
   */
  openQuotes: string[];
}

/** One name resolved inside one line, with the line that defined it. */
export interface ValueHop {
  /** The name as the definition wrote it, sigil included, so a reader can search for it. */
  name: string;
  /** 1-based line of the definition. */
  definitionLine: number;
  /** The definition line's own text, trimmed and cut the way a candidate's `lineText` is. */
  definitionText: string;
}

const EMPTY_VALUE_TABLE: ValueTable = {
  values: new Map(),
  definedAt: new Map(),
  sigils: new Map(),
  definitionLines: new Set(),
  probe: null,
  openQuotes: [],
};

/**
 * Extensions read as configuration rather than as code.
 *
 * The split decides which binder runs, and nothing else: a key/value document has no `const` and a
 * source file's `key: value` is an object property whose name is almost never read back through an
 * interpolation in the same file. Kept small and explicit rather than "everything that is not code".
 */
const CONFIG_EXTS = new Set([
  "yml", "yaml", "toml", "ini", "cfg", "conf", "properties", "env", "editorconfig", "dist",
]);

/** Elixir and its templates, the one family that writes a module attribute as its constant. */
const EX_EXTS = new Set(["ex", "exs", "eex", "heex", "leex", "sface"]);

/**
 * Extensions where a leading `$` is PART OF THE NAME rather than a character IN it.
 *
 * THIS SET EXISTS BECAUSE A SIGIL IS NOT DECORATION. In PHP and in every Bourne-family shell,
 * `$host` and `host` are two spellings of one name — the binder strips the sigil and stores `host`,
 * and reading `$host` back is reading the same variable. In JS and TypeScript `$` is an identifier
 * character, so `$host` and `host` are two DIFFERENT identifiers, and substituting one for the
 * other reports a value the line does not have and points `resolved_from` at an unrelated
 * definition — a candidate the reader cannot check, which §3.4 of
 * an internal record argues is worse than one never raised.
 *
 * Independent verification found this on 2026-08-27/28 with
 * `const host = "h.example"; const $host = document.querySelector("#h"); fetch($host.value)`
 * resolving to `fetch("h.example".value)`. It is latent on the eight pinned trees — none of the 13
 * locations the capability adds comes through this shape — and it is fixed here because
 * target-correctness on the reading is in scope at any time.
 *
 * The repair is the ADDITIVE one: the loose branch is not deleted, it is given
 * the condition that makes it right, so `$ARGS` in a database shell script and
 * `$host` in a PHP file read exactly as they did. Configuration and `.env` documents are in the set
 * because `$FOO` in a compose file, a CI `run:` block or a `.env` is shell expansion of the same
 * name; a file with NO extension is in it because a shell script, a `Dockerfile` and a `Makefile`
 * commonly have none, and no JS, TS, Ruby or C# file is extensionless.
 *
 * The `${…}` and `#{…}` WRAPPERS are not scoped and must not be: `${host}` inside a JS template
 * literal is the identifier `host`, and `#{host}` in Ruby is the local `host`. It is the BARE sigil
 * that names something else.
 */
const DOLLAR_NAME_EXTS = new Set([
  "php", "phtml", "php3", "php4", "php5", "php7", "php8", "inc",
  "sh", "bash", "zsh", "ksh", "bats", "fish",
  "pl", "pm",
]);

/** A ceiling on how many names one file may bind, so the substitution regex stays small. */
const MAX_VALUES = 200;

/**
 * A ceiling on the length of a bound literal.
 *
 * A candidate quotes the ORIGINAL line, so a long value costs nothing in the output; what it costs
 * is regex work on a line that grew. 256 is above every host, key name, path and URL in the corpus
 * this was read against and far below a base64 blob or an embedded certificate.
 */
const MAX_VALUE_LENGTH = 256;

/** A ceiling on how many names may be resolved inside ONE line, for the same reason. */
const MAX_SUBSTITUTIONS_PER_LINE = 20;

/** A ceiling on how many literal concatenations may be folded in one line. */
const MAX_FOLDS_PER_LINE = 32;

/**
 * The quote state of `line` scanned left to right up to `end`, reporting each character on the way.
 *
 * ONE STATE MACHINE FOR THE TWO QUESTIONS THIS FILE ASKS ABOUT QUOTING — whether an offset sits
 * inside a string literal (`insideString`, below) and how a line's brackets balance outside one
 * (`bracketDelta`, at the foot of this file). It is written once and called twice rather than
 * spelled out twice, because two copies would be free to disagree about what a quote is and a rule
 * author reading either would have no way to tell which answer the engine gave.
 *
 * `at` is invoked BEFORE the state is updated for that character, so its `open` argument is exactly
 * what `insideString(line, i)` returns: `false` at an opening quote's own offset, `true` at the
 * closing quote's. A backslash consumes the character after it whether or not a string is open,
 * which is the whole of this scanner's treatment of escapes.
 *
 * A RUN OF THREE IDENTICAL `"` OR `'` CHARACTERS IS ONE DELIMITER, AND WHAT IT OPENS RUNS ACROSS
 * LINES. `open` is the state the line STARTS in and the return is the state it ENDS in, so a caller
 * that walks a file in order can hand each line the state the line before it left open. Read
 * language-free, for the reason `bracketDelta` is: `"""` is a Java 15+ text block, a Python
 * docstring, a Kotlin or C# 11 raw string, a Groovy or Scala literal, `'''` is the Python, Groovy
 * and Scala spelling of the same thing, and neither is a legal construct outside a string in
 * JS/TS/Go/PHP, so reading them everywhere costs those languages nothing.
 *
 * THREE BACKTICKS ARE NOT SUCH A DELIMITER. ``` is a Markdown code fence, not a string opener in
 * any language, and a JS template literal spans lines behind ONE backtick — which this scanner does
 * not carry across lines either. That is today's behaviour for the backtick and it is unchanged
 * here; carrying it is a different change over a different population.
 *
 * The second and third characters of a triple-quote RUN are consumed as part of the one delimiter
 * and are not reported to `at`. No caller can observe that: a quote character is never a bracket,
 * and `insideString` reads the return rather than the observer.
 */
function scanQuotes(
  line: string,
  end: number,
  at?: (ch: string, index: number, open: boolean) => void,
  open = "",
): string {
  let quote = open;
  for (let i = 0; i < end && i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (at) at(ch, i, quote !== "");
    if (quote.length === 3) {
      // Inside a triple-quoted string only the SAME three characters close it. Everything else,
      // brackets included, is string content — which is the whole of what this branch is for.
      if (ch === quote[0] && line[i + 1] === ch && line[i + 2] === ch) {
        quote = "";
        i += 2;
      }
    } else if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'" || ch === "`") {
      // The lookahead deliberately reads past `end`: whether the character at `end - 1` opened a
      // one-character or a three-character delimiter is decided by the two characters after it, and
      // a scan that refused to look would answer the caller's question wrongly at that offset.
      if (ch !== "`" && line[i + 1] === ch && line[i + 2] === ch) {
        quote = ch + ch + ch;
        i += 2;
      } else {
        quote = ch;
      }
    }
  }
  return quote;
}

/**
 * The quote state one line hands to the NEXT line, which is a triple-quoted string and nothing else.
 *
 * A single `"`, `'` or `` ` `` left open at the end of a line is not carried, and that is not an
 * omission. An unterminated one-character quote is a MIS-READ far more often than it is a real
 * multi-line literal — a Rust lifetime `'a`, a C++ digit separator `1'000`, an apostrophe in JSX
 * text — and `strip-comments.ts` spent a whole incident
 * establishing that. Carrying one would put the rest of the file inside a string on the strength of
 * a stray character. A triple quote has no such second reading: what it opens really does run on.
 */
function carriedQuote(state: string): string {
  return state.length === 3 ? state : "";
}

/**
 * The quote state open at the START of each line, for a whole file, computed in one pass.
 *
 * WHY IT IS PER FILE AND COMPUTED ONCE. A text block's body cannot be read on its own: nothing in
 * `        insert into admin_job_queue(job_name, ...` says that it is string content rather than
 * code, and the only thing that does is the `"""` three lines above it. Entry `i` is the state line
 * `i` starts in and is `""` for every line of a file that has no multi-line literal in it, which is
 * almost every file.
 *
 * AN UNTERMINATED BLOCK IS NOT A REFUSAL. Its state simply stays open to the end of the file: every
 * later line is read as string content, `insideString` answers `true` there and the fold counts no
 * brackets, so such a file folds nothing after the opener. That costs a match pass, never a
 * candidate — the original line is still tested exactly as it is today — and the state resets at
 * EOF because it is not carried between files.
 */
export function lineQuoteStarts(lines: string[]): string[] {
  const starts: string[] = new Array(lines.length);
  let state = "";
  for (let i = 0; i < lines.length; i++) {
    starts[i] = state;
    state = carriedQuote(scanQuotes(lines[i], lines[i].length, undefined, state));
  }
  return starts;
}

/**
 * True when `index` sits inside a quoted string on this line.
 *
 * Line-local and language-free on purpose: it decides ONE thing, which is whether substituting the
 * literal WITH its quotes would put a quote character inside a string that is already open. Inside
 * a string the value is written bare (`"http://$host/x"` -> `"http://example.com/x"`); outside it
 * is written as a literal (`'http://' . $host` -> `'http://' . 'example.com'`), which is what lets
 * the fold below join it to the scheme. A file whose quoting this misreads gets a substitution that
 * simply fails to match anything — it cannot remove a candidate, because the original line was
 * tested first and is tested again.
 *
 * The loop it used to hold verbatim is now `scanQuotes` above, with no other caller passing an
 * observer: this call is the identical walk over the identical characters and decides the identical
 * question. A test and the twelve-tree byte-identity comparison are what hold
 * that, because three shipped rules read this path today.
 *
 * IT IS LINE-LOCAL IN ITS SCAN AND NO LONGER LINE-LOCAL IN ITS ANSWER. `open` is the state the line
 * starts in, and it is the one thing about this question a single line cannot decide for itself: a
 * body line of a Java text block or a Python docstring is string content and says so nowhere. The
 * state is computed once per file by `lineQuoteStarts` and reaches here through the value table,
 * which is built from the same text — see `ValueTable.openQuotes`.
 */
function insideString(line: string, index: number, open: string): boolean {
  return scanQuotes(line, index, undefined, open) !== "";
}

/**
 * Adjacent string literals joined by a concatenation operator, folded into one literal.
 *
 * `'http://' . 'example.com'` is the shape two real sweeps named as a plaintext
 * endpoint that no URL-literal pattern can see, and it is only ever produced HERE, after a
 * substitution: a line with no hop in it is never folded, so this is not a second widening applied
 * to every line in the tree. `+` is JS/TS, C#, Java and Python; `.` is PHP; `<>` is Elixir. A `.`
 * between two string literals cannot be a member access, because a member name is not quoted.
 *
 * The fold is refused where it could change what the text says: a backslash in either side (the
 * escape would have to be re-interpreted in the joining quote), or the left quote character
 * appearing inside the right side (the joined literal would close early).
 */
function foldLiteralConcatenations(line: string): string {
  const JOIN = /(["'`])([^"'`\\\n]*)\1\s*(?:\+|\.|<>)\s*(["'`])([^"'`\\\n]*)\3/;
  let out = line;
  for (let n = 0; n < MAX_FOLDS_PER_LINE; n++) {
    const m = JOIN.exec(out);
    if (!m) break;
    if (m[4].includes(m[1])) break;
    out = out.slice(0, m.index) + m[1] + m[2] + m[4] + m[1] + out.slice(m.index + m[0].length);
  }
  return out;
}

/** The literal at the head of `rest`, or null. Escapes are refused rather than interpreted. */
function literalAt(rest: string): { value: string; length: number } | null {
  const m = /^(["'`])([^"'`\\\n]{1,256})\1/.exec(rest);
  if (!m) return null;
  return { value: m[2], length: m[0].length };
}

/**
 * Build the local-value table for one file.
 *
 * `content` is expected to be the comment-blanked text, for the same reason the alias table is: a
 * value written in a commented-out line must not bind, or a maintainer's note about what a setting
 * used to be becomes the setting.
 */
export function localValueTable(fileName: string, content: string): ValueTable {
  const ext = extensionOf(fileName);
  const config = CONFIG_EXTS.has(ext) || /^\.env(\.|$)/.test(fileName.split(/[\\/]/).pop() ?? "");
  const values = new Map<string, string>();
  const definedAt = new Map<string, number>();
  const sigils = new Map<string, string>();
  const definitionLines = new Set<number>();
  /** Names seen with a SECOND, different literal. They are unbound again — see `bind`. */
  const conflicted = new Set<string>();

  const lineStarts: number[] = [0];
  for (let i = 0; i < content.length; i++) if (content[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (offset: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  /**
   * A NAME REDEFINED WITH A DIFFERENT VALUE IS UNBOUND, and this is the one place this table
   * deliberately disagrees with `importAliasTable`, which takes the first binding and moves on.
   *
   * The two are not the same question. An import alias rebound later in a file is a SHADOWING
   * question about a module path, and the first binding is the file's own top-level import, so
   * taking it is both determinate and usually right. A variable assigned twice has two live values
   * and "the value is named a few lines away" is simply false of it — there is no single value to
   * name. Picking one would put a definition site in the record that the use site may never see.
   *
   * Refusing costs nothing that exists today: with no binding the line is tested exactly as it is
   * now. Two definitions carrying the IDENTICAL literal are not a conflict — there is still one
   * value — so the name stays bound and the first definition is the one the record names.
   */
  const bind = (name: string, sigil: string, value: string, line: number): void => {
    if (!name || !value) return;
    if (value.length > MAX_VALUE_LENGTH) return;
    if (!/^[A-Za-z_][\w]*$/.test(name)) return;
    // A DEFINITION THAT READS THE NAME IT DEFINES IS AN APPEND, NOT A DEFINITION, and binds nothing.
    // `url = \`http://${url}\`` does not say what `url` is; it says what is put in front of whatever
    // `url` already was. The value is a builder step, which is the SPAN class in
    // an internal record and not this one.
    //
    // The consistency argument is what settles it. `url = "http://" + url` is refused already, and
    // for a reason that has nothing to do with self-reference: its right-hand side is not a
    // complete literal. The interpolated spelling of the SAME statement is a complete literal and
    // was being bound — so the binder accepted one and refused the other of two ways of writing one
    // construct. Measured on eight real runs: several locations in one tree's
    // `src/interface/desktop/main.js`, all resolved through `url = \`http://${url}\`` on line 351,
    // attached to lines including the function signature four lines above it.
    if (new RegExp(`(?:\\$\\{|#\\{|\\{\\{|%\\()[ \\t]*@?${name}(?![\\w$])|\\$${name}(?![\\w$])`).test(value)) return;
    if (conflicted.has(name)) return;
    const seen = values.get(name);
    if (seen !== undefined) {
      if (seen === value) return;
      // Two live values. Unbind, and remember the name so a third definition cannot rebind it.
      conflicted.add(name);
      values.delete(name);
      definedAt.delete(name);
      sigils.delete(name);
      return;
    }
    if (values.size >= MAX_VALUES) return;
    values.set(name, value);
    definedAt.set(name, line);
    sigils.set(name, sigil);
    definitionLines.add(line);
  };

  if (config) {
    // A key/value document: `key: value` and `key = value`, quoted or bare. The value must be the
    // whole of the rest of the line, so a list item, a nested block opener and a key whose value is
    // an inline map all bind nothing.
    const KV = /^[ \t]*(?:-[ \t]+)?([A-Za-z_][\w.-]*)[ \t]*[:=][ \t]*(.+?)[ \t\r]*$/gm;
    for (let m = KV.exec(content); m; m = KV.exec(content)) {
      const raw = m[2];
      const lit = literalAt(raw);
      const value = lit && lit.length === raw.length ? lit.value : raw;
      // A bare scalar that opens a structure, carries a comment marker or is a YAML alias is not a
      // value this can read back; a quoted one has already been taken whole by `literalAt`.
      if (!lit && /["'`{}[\]&*#]/.test(value)) continue;
      bind(m[1], "", value, lineOf(m.index));
    }
  } else {
    // ASSIGNMENT TO A STRING LITERAL, in the spellings that share one shape across the languages
    // this scanner reads: `const X = "s"`, `let`/`var`, `X := "s"` (Go), `$x = "s"` (PHP),
    // `private const string ApiKey = "s"` (C#), `X = "s"` (Python, Ruby, C#, Java, anything).
    //
    // The name must not be preceded by a word character, `.`, `?` or `>` — `a.b = "s"` is a
    // property write, not a name this file can read back, and `x => "s"` is a lambda. The operator
    // must be a plain `=` or `:=` and not the tail of `==`, `!=`, `<=`, `>=`, `+=`, `=>`. The
    // literal must be the WHOLE right-hand side, ending at a terminator or the end of the line, so
    // `url = "http://" + host` binds nothing: its value is not a literal.
    const ASSIGN =
      /(?<![\w$.?>])(\$?)([A-Za-z_][\w]*)[ \t]*(?::=|(?<![=!<>+\-*/%&|^])=(?!=))[ \t]*(["'`][^"'`\\\n]{1,256}["'`])[ \t]*(?=[;,)\]}\r]|$)/gm;
    for (let m = ASSIGN.exec(content); m; m = ASSIGN.exec(content)) {
      const lit = literalAt(m[3]);
      if (!lit || lit.length !== m[3].length) continue;
      // THE DEFINITION MUST BE THE HEAD OF ITS LINE, and this clause is what makes the binder a
      // reader of DEFINITIONS rather than of every `name = "string"` shape in the file. Everything
      // between the start of the line and the name must be whitespace and declaration or type
      // words: `const`, `let`, `var`, `export const`, `private static readonly string`, or nothing
      // at all for `$host = 'x'`, `url = 'x'` and a shell `ARGS="…"`.
      //
      // WHAT IT REFUSES, measured on the eight pass-1 runs before it was written: an XML namespace
      // declaration. `xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"` bound the name
      // `inkscape` to a namespace URI, and every `inkscape:label=` attribute below it then read as
      // a plaintext endpoint — several locations across two SVG files in one tree, on a construct that is
      // not a value definition at all and cannot be read back as one. A markup attribute, a keyword
      // argument (`f(name="x")`), a comparison inside a call and the second clause of
      // `let a = 1, b = "x"` are all outside a definition's shape and all refused here.
      //
      // This is target-correctness on the BINDER — is it looking for a definition at all — and not
      // a narrowing of a rule: nothing that matched before this repair matches less because of it,
      // because before this repair nothing was bound anywhere.
      const lineStart = content.lastIndexOf("\n", m.index - 1) + 1;
      if (!/^[ \t]*(?:[A-Za-z_][\w]*[ \t]+){0,6}$/.test(content.slice(lineStart, m.index))) continue;
      bind(m[2], m[1], lit.value, lineOf(m.index));
    }
    // PHP's other constant: `define('NAME', 'value')`.
    const DEFINE = /\bdefine\s*\(\s*(["'])([A-Za-z_][\w]*)\1\s*,\s*(["'][^"'\\\n]{1,256}["'])\s*\)/g;
    for (let m = DEFINE.exec(content); m; m = DEFINE.exec(content)) {
      const lit = literalAt(m[3]);
      if (!lit || lit.length !== m[3].length) continue;
      bind(m[2], "", lit.value, lineOf(m.index));
    }
    if (EX_EXTS.has(ext)) {
      // Elixir's module attribute, which is how that language spells a file-level constant.
      const ATTR = /^[ \t]*@([a-z_]\w*)[ \t]+(["'][^"'\\\n]{1,256}["'])[ \t\r]*$/gm;
      for (let m = ATTR.exec(content); m; m = ATTR.exec(content)) {
        const lit = literalAt(m[2]);
        if (!lit || lit.length !== m[2].length) continue;
        bind(m[1], "@", lit.value, lineOf(m.index));
      }
    }
  }

  if (values.size === 0) return EMPTY_VALUE_TABLE;
  const names = [...values.keys()].sort((a, b) => b.length - a.length).map(escapeForClass);
  const alt = names.join("|");
  // EACH SIGIL IS READ ONLY WHERE IT DENOTES THE SAME NAME. `$name` where `$` is part of the name
  // (PHP, shell, configuration, and files with no extension) and `@name` where `@` opens a module
  // attribute (Elixir), which is also the only place the binder writes an `@` sigil. Elsewhere the
  // two sigils spell a DIFFERENT name from the bare one — `$host` is its own identifier in JS/TS,
  // `@foo` is an instance variable in Ruby where `foo` is a local — and reading one as the other
  // hands the reader a `resolved_from` pointing at an unrelated definition. See DOLLAR_NAME_EXTS.
  const dollarSigil = config || DOLLAR_NAME_EXTS.has(ext) || ext === "";
  const atSigil = EX_EXTS.has(ext);
  // Every shape a bound name is READ in. The bare branch is the alias table's own discipline — not
  // inside a longer identifier, not after a dot, where it is somebody else's property. The rest are
  // interpolations, which is how a configuration key and a template host reach their use site. The
  // `@` INSIDE an interpolation is the same read as the bare `@` and is scoped with it: `#{@site}`
  // is a module attribute in Elixir and an instance variable in Ruby, and the bare `#{site}` form
  // stays language-free because it names the same thing in both.
  const at = atSigil ? "@?" : "";
  const probe = new RegExp(
    `(?<![\\w$.@])(?:${alt})(?![\\w$])` +
      `|\\$\\{[ \\t]*${at}(?:${alt})[ \\t]*\\}` +
      `|#\\{[ \\t]*${at}(?:${alt})[ \\t]*\\}` +
      `|\\{\\{[ \\t]*(?:${alt})[ \\t]*\\}\\}` +
      `|%\\([ \\t]*(?:${alt})[ \\t]*\\)s` +
      (dollarSigil ? `|\\$(?:${alt})(?![\\w$])` : "") +
      (atSigil ? `|@(?:${alt})(?![\\w$])` : ""),
    "g",
  );
  // Computed here and not at the call site, and only once the table is known to be non-empty: a
  // file that binds nothing is never resolved, so its states would never be read.
  const openQuotes = lineQuoteStarts(content.split("\n"));
  return { values, definedAt, sigils, definitionLines, probe, openQuotes };
}

/**
 * The bare name inside one probe match.
 *
 * The probe matches up to seven read shapes — five in every file, plus the bare `$name` and `@name`
 * sigils in the languages where those name the same variable — and the table is keyed on the name
 * alone, so every wrapper (`${…}`, `#{…}`, `{{…}}`, `%(…)s`) and every sigil (`$`, `@`) is stripped
 * here rather than in seven capture groups, which would have to be renumbered every time a shape is
 * added.
 */
function bareName(match: string): string {
  const inner = /^(?:\$\{|#\{|\{\{|%\()[ \t]*(.*?)[ \t]*(?:\}\}|\}|\)s)$/.exec(match);
  const core = inner ? inner[1] : match;
  return core.replace(/^[@$]/, "");
}

/** The result of resolving one line: the rewritten text, and every definition it reached. */
export interface ResolvedLine {
  text: string;
  hops: ValueHop[];
}

/**
 * One line with its local values resolved to the literals they were assigned, and adjacent literals
 * folded.
 *
 * Returns the line unchanged with no hops when nothing applies, so the caller can compare by
 * identity and skip the extra match pass entirely. Line length may change; the line's INDEX cannot,
 * because this function is called once per line and returns exactly one line.
 *
 * An interpolation (`${X}`, `#{X}`, `{{X}}`, `%(X)s`) and a read that sits inside an open string are
 * both replaced by the value BARE — putting a quote character inside a string that is already open
 * would make the resolved text say something the source does not. Everywhere else the value is
 * written as a quoted literal, which is what lets `'http://' . $host` become `'http://example.com'`
 * rather than `'http://' . example.com`, and what makes `get(TOKEN_KEY)` read as `get("api_key")`.
 *
 * `lineIndex` is the line's 0-based index in the file the TABLE was built from, and it is required
 * rather than optional: "inside an open string" is not a line-local question once a triple quote can
 * open a string that spans lines, and a parameter with a default would let a caller take the
 * line-local answer by saying nothing. Out of range it degrades to `""`, which is the engine's own
 * `codeLines[i] ?? text` convention and is exactly today's reading.
 */
export function resolveLocalValuesInLine(
  line: string,
  table: ValueTable,
  lines: string[],
  lineIndex: number,
): ResolvedLine {
  if (!table.probe) return { text: line, hops: [] };
  table.probe.lastIndex = 0;
  const hops: ValueHop[] = [];
  const seen = new Set<string>();
  let count = 0;
  const text = line.replace(table.probe, (match, offset: number) => {
    if (count >= MAX_SUBSTITUTIONS_PER_LINE) return match;
    const wrapped = /[{(]/.test(match);
    const name = bareName(match);
    const value = table.values.get(name);
    if (value === undefined) return match;
    count++;
    if (!seen.has(name)) {
      seen.add(name);
      const at = table.definedAt.get(name) ?? 0;
      hops.push({
        name: (table.sigils.get(name) ?? "") + name,
        definitionLine: at + 1,
        definitionText: (lines[at] ?? "").trim().slice(0, 300),
      });
    }
    if (wrapped || insideString(line, offset, table.openQuotes[lineIndex] ?? "")) return value;
    return `"${value.includes('"') ? value.replace(/"/g, "'") : value}"`;
  });
  if (text === line) return { text: line, hops: [] };
  return { text: foldLiteralConcatenations(text), hops };
}

// ---------------------------------------------------------------------------------------------
// Joined constructs — a construct written over several lines, folded onto the line that opens it
// ---------------------------------------------------------------------------------------------

/** The joined-construct view of one file: two line-aligned arrays, and what building them cost. */
export interface JoinedView {
  /** Exactly `lines.length` entries. `raw[i]` is the fold at `i`, or `lines[i]` unchanged. */
  raw: string[];
  /** The same folds over the comment-blanked text, so the match step has its raw/blanked pair. */
  code: string[];
  /** The span `raw[i]` covers, at the same index; `undefined` wherever nothing was folded. */
  spans: (JoinedFrom | undefined)[];
  /** Whether any line was folded at all. `false` means this file gave the view nothing to do. */
  built: boolean;
  /** Constructs a ceiling refused, each of which left its opening line exactly as it is. */
  refused: number;
}

/**
 * Ceilings on ONE fold, both of which fall back to the original line.
 *
 * MEASURED, NOT INHERITED. The engine proposal drafted 20 lines and 2,000 characters and required
 * the implementation unit to set them from data instead. They are set from the length of every
 * bracket-balanced construct on the two largest pinned trees, over the surface of the widest rule
 * that would declare this view: `baseline-005` declares neither `file_globs` nor `path_without`, so
 * its surface is every production file the walker offers — 53,596 files and 702,289 constructs on
 * one tree, about 17,000 files and 185,000 constructs on another. The distribution, the coverage each
 * candidate ceiling buys and the command that produced them are in
 * an internal record.
 *
 * Refusing can never lose a candidate that was previously found — the opening line is still tested
 * exactly as it is today — which is the argument `MAX_YAML_INPUT_BYTES` above is set under.
 *
 * Exported as one frozen object so that a test asserts the ceilings ON THEIR
 * OWN BOUNDARY (a construct of exactly this many lines beside one of one more) instead of at some
 * number written twice and free to drift.
 */
export const JOINED_VIEW_LIMITS = Object.freeze({ maxLines: 40, maxChars: 4_000 });

/**
 * How this line's brackets balance, counting only the ones OUTSIDE a string literal.
 *
 * `(`, `[` and `{` open; `)`, `]` and `}` close. THE KINDS ARE NOT MATCHED AGAINST EACH OTHER — a
 * `(` closed by a `}` counts as closed — because a text scanner that tried to would have to be
 * right about far more of the language than this one is, and the failure it would buy is the same
 * meaningless string a mismatched fold produces. `<` and `>` are not counted at all: a generic's
 * angle brackets and a comparison are the same character, and no line-local scan can tell them
 * apart.
 *
 * The quoting comes from `scanQuotes`, which is also what `insideString` is, for the reason given
 * there.
 *
 * `open` is the quote state the line starts in and the returned `open` is the one it ends in, both
 * of them a triple-quoted string or nothing (`carriedQuote`). A LINE WHOLLY INSIDE A TEXT BLOCK
 * THEREFORE HAS A DELTA OF ZERO, which is the whole of what this item corrects: before it, the body
 * of `@Query("""` … `""")` was scanned as code, its brackets counted, and the construct the `@Query(`
 * opened appeared never to close.
 */
function bracketDelta(line: string, open: string): { delta: number; open: string } {
  let delta = 0;
  const end = scanQuotes(
    line,
    line.length,
    (ch, _index, isOpen) => {
      if (isOpen) return;
      if (ch === "(" || ch === "[" || ch === "{") delta++;
      else if (ch === ")" || ch === "]" || ch === "}") delta--;
    },
    open,
  );
  return { delta, open: carriedQuote(end) };
}

/**
 * For every line, the line at which the bracketed construct that OPENS on it closes.
 *
 * Entry `i` is `-1` where line `i` opens nothing (its brackets balance, or close more than they
 * open), `lines.length` where it opens a construct that never closes in this file, and otherwise
 * the 0-based index of the line the construct closes on, which is always greater than `i`.
 *
 * WHY IT IS COMPUTED FOR THE WHOLE FILE AT ONCE rather than scanned forward from each opening line.
 * Let `depth[m]` be the bracket balance of lines `0..m-1`. The construct opening on line `i` closes
 * on the last line before the first `m > i` at which `depth[m] <= depth[i]`, so every answer is "the
 * first later entry of `depth` at or below this one" — which one pass with a stack gives for all of
 * them at once. A forward scan gives the identical answers and costs the line ceiling times the
 * file; this costs the file. It also means the ceiling is applied to a span that is already known
 * exactly, so a refusal is a refusal and never a search that gave up.
 *
 * Exported because two other readers need the same answer and this project keeps no second copy of it:
 * the ceilings above were measured through this function, and a test asserts
 * the spans directly rather than inferring them from the folded strings.
 */
export function bracketedConstructEnds(lines: string[]): Int32Array {
  const n = lines.length;
  const ends = new Int32Array(n).fill(-1);
  if (n === 0) return ends;
  const depth = new Int32Array(n + 1);
  // The depth fold CARRIES THE QUOTE STATE with it, which is why it is written as a loop and not as
  // a map: a line inside a text block contributes no brackets, and whether it is inside one is
  // decided by the lines before it and by nothing on the line itself.
  let carried = "";
  for (let i = 0; i < n; i++) {
    const d = bracketDelta(lines[i], carried);
    depth[i + 1] = depth[i] + d.delta;
    carried = d.open;
  }
  // `open` holds the indices whose answer is still outstanding. Their depths increase strictly from
  // the bottom, because an index is pushed only after every entry at or above its own depth has been
  // popped — so the entries a new `m` resolves are exactly the ones on top of it, and each index is
  // pushed once and popped once.
  const open: number[] = [];
  for (let m = 0; m <= n; m++) {
    while (open.length > 0 && depth[m] <= depth[open[open.length - 1]]) {
      const i = open.pop() as number;
      // These are indices into `depth`, which has one entry more than there are lines, and only a
      // LINE whose own delta is positive opens anything. `m` cannot be `i + 1` here, because
      // `depth[i + 1] > depth[i]` is exactly what makes line `i` an opening line — so `end > i`.
      if (i < n && depth[i + 1] > depth[i]) ends[i] = m - 1;
    }
    open.push(m);
  }
  // What is left never met a later entry at or below its own depth: these lines open a construct
  // that is closed nowhere in this file — an unbalanced brace, or a bracket this scanner read in a
  // place the language does not.
  for (const i of open) if (i < n && depth[i + 1] > depth[i]) ends[i] = n;
  return ends;
}

/** Lines `from..to` of `src` as one string: joined by a space, with whitespace runs collapsed. */
function foldSpan(src: string[], from: number, to: number): string {
  let out = src[from] ?? "";
  for (let k = from + 1; k <= to; k++) out += ` ${src[k] ?? ""}`;
  return out.replace(/\s+/g, " ").trim();
}

/**
 * The file with each multi-line bracketed construct folded onto the line that opens it.
 *
 * ## What is out of reach without it, in the shipped rules' own words
 *
 * `engine.ts` splits a file into physical lines and tests one at a time, so a construct written
 * across several of them cannot be matched as a whole by any clause, however written.
 * `baseline-005` clause (11) records the consequence as a KNOWN LIMIT — *"an options object opened
 * on one line and closed on another is out of reach here"* — and its known-gaps section closes with
 * *"Permanent fix: give the engine a block scope that joins the arguments of a call"*. Clause (7) of
 * the same rule reads Go's `http.Cookie` struct literal *"when it fits on one line"*.
 * `eu-retention-003` records that a `DELETE … WHERE` split over two physical lines is one *"no
 * clause here or anywhere can see"*.
 *
 * ## The shape, which is the alias view's and not the YAML view's
 *
 * This file's one hard constraint is that reported line numbers must not move, and the header above
 * draws from it the rule that decides which step a view may reach: a view whose line structure is
 * its own may only reach a FILE-LEVEL gate. So this one has no line structure of its own. It is an
 * array of EXACTLY `lines.length` strings; `raw[i]` is the whole of the bracketed construct that
 * OPENS on line `i` folded onto one string, and every other entry is the original line unchanged.
 * No line is added, removed, split or reordered, `i` still names the same line of the file, and a
 * candidate raised from `raw[i]` reports line `i + 1` and quotes `lines[i]` — the line the construct
 * OPENS on.
 *
 * That reported line's own text does not show what the rule matched: the attribute a cookie literal
 * lacks is absent four lines below the line the finding names. So a candidate raised here carries
 * the span it was folded from (`spans[i]`, published as `locations[].joined_from`), for the reason
 * `resolve_local_values` carries its definition site — a reader who cannot check the reading is
 * handed a candidate worse than one that was never raised.
 *
 * ## The fold rule, and the two continuation forms it deliberately leaves out
 *
 * A line whose bracket balance is positive OPENS a construct; it closes on the last line before the
 * balance returns to where it was; the span is joined by one space with whitespace runs collapsed.
 *
 * **A trailing operator with no bracket** (`… +` at the end of a line) and **a backslash
 * continuation** are NOT folded, and are named here so that a later reader does not take them for an
 * oversight. Every construct the batch that asked for this view has evidence of is bracket-balanced;
 * the house convention is that the first instance needing another form is the reason to add it, as
 * `eu-retention-002`/`-003` record for their own absent `gate_view`. No rule may be written as
 * though either form folded.
 *
 * ## Two arrays, one set of spans
 *
 * The match step takes the raw/blanked pair `matchFires` reads, so the fold is applied to both texts.
 * THE SPANS ARE COMPUTED ONCE, FROM THE COMMENT-BLANKED TEXT, and both arrays are folded over them:
 * a bracket a maintainer wrote inside a comment must not open a construct, for the reason every gate
 * in this engine reads the blanked text, and two arrays that disagreed about where a construct ends
 * would hand the match step a pair describing two different things. `contentForGuards` replaces
 * characters in place and never adds or removes a newline, which is what makes the two folds
 * line-for-line parallel. Where they are NOT the same length — the state the engine's own
 * `codeLines[i] ?? text` convention exists for — the raw text is used for both, so the pair degrades
 * to `code === text` and the match step decides the line exactly as it does today.
 *
 * ## Being wrong about a construct costs a match pass, and never a candidate
 *
 * The scanner is language-free. A string literal that opens on one line and closes on another, a
 * generic's angle brackets, a brace inside a here-document: each can make the fold cover the wrong
 * span and produce a long meaningless string. That string is TESTED IN ADDITION to the original
 * line, which was tested first and whose result stands, so every such error costs one match pass —
 * never a removed candidate, and never a moved line number.
 */
export function joinedConstructView(
  lines: string[],
  codeLines: string[],
  limits: { maxLines?: number; maxChars?: number } = {},
): JoinedView {
  const maxLines = limits.maxLines ?? JOINED_VIEW_LIMITS.maxLines;
  const maxChars = limits.maxChars ?? JOINED_VIEW_LIMITS.maxChars;
  const n = lines.length;
  const parallel = codeLines.length === n;
  const raw = lines.slice();
  const code = parallel ? codeLines.slice() : lines.slice();
  const spans: (JoinedFrom | undefined)[] = new Array(n);
  const ends = bracketedConstructEnds(parallel ? codeLines : lines);
  let refused = 0;
  let built = false;
  for (let i = 0; i < n; i++) {
    const end = ends[i];
    if (end < 0) continue;
    if (end >= n || end - i + 1 > maxLines) {
      refused++;
      continue;
    }
    const folded = foldSpan(lines, i, end);
    if (folded.length > maxChars) {
      refused++;
      continue;
    }
    // DEFENSIVE, AND NO INPUT IS KNOWN TO REACH IT. A fold that gave the original line back would not
    // be a second text at all, and the engine skips a line whose fold equals it in any case; leaving
    // the entry alone would keep `built` and `spans` saying only what is true of this file. It cannot
    // fire on the fold rule as written — the closing line carries a bracket, so it is never blank and
    // is always joined — and it is kept because that argument is about the fold rule and would have
    // to be re-made by anyone who changes it.
    if (folded === lines[i]) continue;
    raw[i] = folded;
    code[i] = parallel ? foldSpan(codeLines, i, end) : folded;
    spans[i] = { start_line: i + 1, end_line: end + 1 };
    built = true;
  }
  return { raw, code, spans, built, refused };
}

/**
 * Required-literal prefilter — speed-up lane step 2.
 *
 * Full design: an internal record (private workspace, not shipped
 * with this file). Section letters/numbers in comments below (B.0, A.2, E.3, ...) are that
 * document's, so a reader who has it open can jump straight to the justification for a rule instead
 * of re-deriving it from the code.
 *
 * WHAT THIS FILE IS. A clause's `match` / `also_in_file` pattern requires some literal text to be
 * present in whatever it matches — `req(fetch\(["']stripe["']\))` requires `stripe` — and it is
 * cheaper to search a whole file once for a small set of literals (Aho-Corasick) than to run every
 * clause's real regular expression against every line. This module derives, for each clause, a set
 * of literals such that the clause CANNOT match a text unless that text contains at least one member
 * — the derivation is a set of sound syntactic rules over the clause's own pattern (section B) — then
 * builds one automaton over every clause's literals and answers, for a file's text, which literals
 * are present and on which lines.
 *
 * THE ONE PROPERTY EVERYTHING HERE RESTS ON (proposal §A.2):
 *
 *   (P) For a clause C with derived literal set L and any string s:
 *       C.test(s) === true  =>  fold(s) contains at least one member of L as a contiguous substring.
 *
 * so it is sound to skip testing `C` against `s` when none of `L` occurs in `fold(s)`. Every rule
 * below is proved against (P), not merely believed. Over-admission (computing a set that is too
 * generous, or refusing to compute one at all) is always safe: it costs a wasted `RegExp.test()` and
 * changes no output. Under-admission is a miss, which is why every degenerate case below resolves
 * to "refuse" (⊤, represented as `null`) rather than to a guessed or partial set.
 *
 * WHAT THIS FILE IS NOT. It does not read a file, does not know what a rule is, does not walk a
 * target tree, and never calls out to `fs`. `engine.ts` is the only caller and owns every decision
 * about which texts get indexed and which call sites are gated (proposal §A.1-§A.3). Keeping this
 * module pure is also what lets a test build the exact same index the shipped
 * binary builds and compare it against itself (proposal §E.2 assertion 4).
 *
 * THE ONE IMPORT is `vocabulary.ts`'s separator facts, which this file may not restate — see
 * `SEPARATORS` below for why. `vocabulary.ts` imports nothing at all, so this module stays `fs`-free.
 */

import { INNER_SEPARATOR_RUN as VOCABULARY_INNER_SEPARATOR_RUN, SEPARATORS as VOCABULARY_SEPARATORS } from "./vocabulary.js";

/* ========================================================================================== *
 * B.0 — limits and the fold convention
 * ========================================================================================== */

/** Tunable ceilings the derivation degrades to `⊤` (refuse) past. Proposal §B.0, §H3. */
export interface PrefilterLimits {
  /** Shortest literal worth indexing. A disjunction is only as strong as its weakest member. */
  minLiteralLength: number;
  /** Largest required set carried for one clause. */
  setCap: number;
  /** Largest character class enumerated into a set of one-character literals (B.2). */
  classCap: number;
  /** Largest per-item variant count for a separator-tolerant vocabulary item (B.11). */
  varCap: number;
  /** Largest bounded repetition unrolled into a cross product (B.8, B.9). */
  repCap: number;
  /** Ceiling on the sub-range search inside one concatenation (B.10). */
  runWork: number;
}

/**
 * `MINLIT=3`, no frequency table: a dozen clauses end up admitted on
 * almost every line because their shortest required literal ("str", "int") is common prose, and that
 * is accepted as equivalent to running those clauses unfiltered rather than chased with a corpus-
 * derived table, which would make the filter depend on a private artefact nothing in the bundle
 * states. `SETCAP`/`CLASSCAP`/`VARCAP`/`REPCAP`/`RUNWORK` are the values proposal §0/§B measured
 * coverage against; changing them changes coverage and must be re-measured, not assumed.
 */
export const DEFAULT_LIMITS: Readonly<PrefilterLimits> = Object.freeze({
  minLiteralLength: 3,
  setCap: 512,
  classCap: 4,
  varCap: 4,
  repCap: 3,
  runWork: 20000,
});

/**
 * ASCII-only fold, applied to EVERY literal — including literals drawn from a case-*sensitive*
 * vocabulary list or pattern context — and to the subject text at admission time (`admissions`
 * below). This is the exact defect the proposal's §0 records: folding a literal only when its list
 * declared `case_insensitive`, while the subject was folded unconditionally, produced literals that
 * could never be found for every case-sensitive list, and the prefilter silently skipped every line
 * those clauses actually match. Folding a case-sensitive literal can only WIDEN what is admitted —
 * `subscriberUrl` folds to `subscriberurl`, which is also a substring of folded `SubscriberURL`, a
 * string the clause itself would reject — so it can never hide a line the real regex matches.
 *
 * Mirrors `foldedChar` in vocabulary.ts, which folds only ASCII letters for the same reason stated
 * there: `toUpperCase`/`toLowerCase` on a non-ASCII letter is not a one-character operation (`ß`
 * upper-cases to two characters, `İ` lower-cases to two code points), so folding it here could turn
 * one required character into a two-character requirement the subject need not contain contiguously
 * at all — unsound. Non-ASCII code units are therefore left exactly as they are, on both sides.
 */
export function fold(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : s[i];
  }
  return out;
}

/* ========================================================================================== *
 * B.14 — the parser
 * ========================================================================================== *
 *
 * A small hand-written recursive-descent parser over exactly the regular-expression subset the
 * bundle uses (no `regexp-tree` / `regexpp` dependency — this parser
 * is total over that subset, must handle `(?&name)` which is not JavaScript syntax and which no
 * off-the-shelf parser accepts, and every rule of section B would have to be re-written against a
 * third-party AST regardless). Anything outside the subset is a `ParseRefusal`, caught by the caller
 * and turned into a per-clause refusal — never a wrong answer, and never a crash that would take the
 * scan down over one pattern the parser has not been taught.
 */

/** One node of a clause's syntax tree, over the subset this parser accepts. */
export type PatternNode =
  | { t: "chr"; c: string }
  | { t: "zero" } // ^ $ \b \B — zero-width, matches "" (B.4)
  | { t: "any"; raw?: string } // . \d \D \w \W \s \S \p{...}, an unenumerable or negated class, a back-reference
  | { t: "cls"; chars: string[] } // an enumerable, non-negated character class
  | { t: "grp"; x: PatternNode } // (?:X) (X) (?<name>X)
  | { t: "look-"; x: PatternNode } // (?!X) (?<!X) — X is NOT analysed further, see B.6
  | { t: "look+"; x: PatternNode } // (?=X) (?<=X)
  | { t: "splice"; name: string } // (?&name)
  | { t: "alt"; xs: PatternNode[] }
  | { t: "seq"; xs: PatternNode[] }
  | { t: "rep"; min: number; max: number; x: PatternNode };

/** A construct this parser's subset does not cover. Caught and turned into a per-clause refusal. */
export class ParseRefusal extends Error {}

const SPLICE_AT = /\(\?&([A-Za-z_][A-Za-z0-9_]*)\)/y;

/**
 * Parse `src` (an UNEXPANDED clause pattern — a `(?&name)` splice is a leaf, not inlined) into a
 * `PatternNode`. Throws `ParseRefusal` for anything outside the subset documented in proposal
 * §B.14: a modifier group (`(?i:`), an unbalanced group, unconsumed input, or an escape before a
 * letter this parser has not named. There is deliberately no default case that guesses.
 */
export function parsePattern(src: string): PatternNode {
  let i = 0;

  function alt(): PatternNode {
    const branches = [seq()];
    while (src[i] === "|") {
      i++;
      branches.push(seq());
    }
    return branches.length === 1 ? branches[0] : { t: "alt", xs: branches };
  }

  function seq(): PatternNode {
    const xs: PatternNode[] = [];
    while (i < src.length && src[i] !== "|" && src[i] !== ")") xs.push(term());
    return xs.length === 1 ? xs[0] : { t: "seq", xs };
  }

  function term(): PatternNode {
    const a = atom();
    const c = src[i];
    let min: number | null = null;
    let max = 0;
    if (c === "*") {
      i++;
      min = 0;
      max = Infinity;
    } else if (c === "+") {
      i++;
      min = 1;
      max = Infinity;
    } else if (c === "?") {
      i++;
      min = 0;
      max = 1;
    } else if (c === "{") {
      const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(src.slice(i));
      if (m) {
        i += m[0].length;
        min = Number(m[1]);
        max = m[2] === undefined ? min : m[3] === "" ? Infinity : Number(m[3]);
      }
    }
    if (min === null) return a;
    // Lazy (`??`, `*?`, ...) or possessive (`?+`, ...) suffix: neither changes what the construct
    // can match, only how backtracking prefers to match it, so it is consumed and has no effect on
    // the derivation, which asks only "can this match at all", never "does it prefer to".
    if (src[i] === "?" || src[i] === "+") i++;
    return { t: "rep", min, max, x: a };
  }

  function atom(): PatternNode {
    const c = src[i];
    if (c === "(") {
      SPLICE_AT.lastIndex = i;
      const sp = SPLICE_AT.exec(src);
      if (sp) {
        i = SPLICE_AT.lastIndex;
        return { t: "splice", name: sp[1] };
      }
      i++;
      let kind: "grp" | "look+" | "look-" = "grp";
      if (src[i] === "?") {
        if (src.startsWith("?:", i)) i += 2;
        else if (src.startsWith("?=", i)) {
          i += 2;
          kind = "look+";
        } else if (src.startsWith("?!", i)) {
          i += 2;
          kind = "look-";
        } else if (src.startsWith("?<=", i)) {
          i += 3;
          kind = "look+";
        } else if (src.startsWith("?<!", i)) {
          i += 3;
          kind = "look-";
        } else if (/^\?<[A-Za-z_$]/.test(src.slice(i))) {
          const j = src.indexOf(">", i);
          if (j < 0) throw new ParseRefusal("unterminated named group");
          i = j + 1;
        } else {
          throw new ParseRefusal(`unknown group at ${i}: ${src.slice(i, i + 6)}`);
        }
      }
      const inner = alt();
      if (src[i] !== ")") throw new ParseRefusal("unbalanced group");
      i++;
      return { t: kind, x: inner };
    }
    if (c === "[") return charClass();
    if (c === "\\") return escape();
    if (c === ".") {
      i++;
      // JS `.` matches anything but a line terminator (LF, CR, U+2028, U+2029). The `raw` field is
      // read only by a test generator sampling what a node CAN produce; the derivation below never
      // reads it, because `any` is always `req=⊤` regardless of what it stands for.
      return { t: "any", raw: "[^\\n\\r\\u2028\\u2029]" };
    }
    if (c === "^" || c === "$") {
      i++;
      return { t: "zero" };
    }
    if (c === ")" || c === undefined) throw new ParseRefusal("unexpected end");
    if (c === "*" || c === "+" || c === "?" || c === "{") throw new ParseRefusal(`dangling ${c}`);
    if (c === "}" || c === "]") {
      // Literal in JS outside a class/quantifier context.
      i++;
      return { t: "chr", c };
    }
    i++;
    return { t: "chr", c };
  }

  function escape(): PatternNode {
    i++; // the backslash
    const n = src[i];
    if (n === undefined) throw new ParseRefusal("trailing backslash");
    if (n === "b" || n === "B") {
      i++;
      return { t: "zero" };
    }
    if ("dDwWsS".includes(n)) {
      i++;
      return { t: "any", raw: "\\" + n };
    }
    if (n === "p" || n === "P") {
      const m = /^[pP]\{[^}]*\}/.exec(src.slice(i));
      if (!m) throw new ParseRefusal("malformed \\p");
      i += m[0].length;
      return { t: "any", raw: "\\" + m[0] };
    }
    if (n === "k") {
      const m = /^k<[^>]*>/.exec(src.slice(i));
      if (!m) throw new ParseRefusal("malformed \\k");
      i += m[0].length;
      return { t: "any" }; // a back-reference: unknown text, not in the bundle today
    }
    if (/[1-9]/.test(n)) {
      const m = /^[0-9]+/.exec(src.slice(i));
      i += (m as RegExpExecArray)[0].length;
      return { t: "any" }; // a numbered back-reference: unknown text
    }
    const lit = simpleEscape(false);
    if (lit === null) throw new ParseRefusal(`unknown escape \\${n}`);
    return { t: "chr", c: lit };
  }

  /**
   * The escapes denoting exactly one character, READ AS THE ENGINE READS THEM. Shared with the
   * character-class parser below.
   *
   * `engine.ts` compiles every clause with `new RegExp(pattern)` and **no flags**, so this function
   * must mirror NON-UNICODE (Annex B) semantics, never `u`-mode semantics. The two differ, and the
   * difference is a silent miss rather than a crash; a check
   * demonstrated one:
   *
   *     new RegExp("abc\\u{1F600}def").test("abcu{1F600}def") === true    // no `u` flag
   *     new RegExp("abc\\u{1F600}def").test("abc\u{1F600}def")  === false
   *
   * so reading `\u{1F600}` as an astral code point derives a required literal that the clause's own
   * matches never contain, and the prefilter then skips every line the clause actually fires on.
   * Every form below is therefore either mirrored exactly against the real engine — each has a probe
   * in a test's escape suite with `new RegExp(p)` (no flags) as the oracle — or
   * REFUSED. A refusal costs coverage on one clause; a wrong answer costs findings.
   *
   * `inClass` because the dialect differs inside `[...]`: `\cX` takes digits and `_` there and only
   * letters outside it.
   */
  function simpleEscape(inClass: boolean): string | null {
    const n = src[i];
    if (n === "x") {
      // `\xHH` — one code unit, identical with and without the flag. `\xZZ` is the identity escape
      // `x` followed by `ZZ`; refused rather than modelled, since nothing in the bundle writes it.
      const m = /^x([0-9a-fA-F]{2})/.exec(src.slice(i));
      if (!m) return null;
      i += m[0].length;
      return String.fromCharCode(parseInt(m[1], 16));
    }
    if (n === "u") {
      // `\u{...}` is a code point ONLY with the `u` flag. Without it, it is the identity escape `u`
      // followed by the literal text `{...}` — and that text is not even inert, since `\u{2}`
      // matches `uu` (the braces quantify the `u`). Refused rather than modelled: no clause in the
      // bundle writes it, and every reading of it that is not the engine's is a miss.
      if (src.startsWith("u{", i)) {
        throw new ParseRefusal("\\u{...} is not a code point without the u flag, and the engine compiles with no flags");
      }
      // `\uHHHH` is one CODE UNIT, not one code point. A surrogate pair written as two escapes is
      // therefore two of these, and their concatenation reproduces the astral character exactly as
      // the subject text holds it — both sides are UTF-16 code units, here, in `fold` and in
      // `admissions`. `String.fromCodePoint` would agree for every value `\uHHHH` can carry, but it
      // says "code point" where the engine says "code unit", and that is the confusion this code avoids.
      const m = /^u([0-9a-fA-F]{4})/.exec(src.slice(i));
      if (!m) return null;
      i += m[0].length;
      return String.fromCharCode(parseInt(m[1], 16));
    }
    if (n === "c") {
      // `\cX` — the control character `X & 31`. OUTSIDE a class only a letter makes it one: `\c1` is
      // the three characters `\`, `c`, `1`, which this parser refuses rather than models. INSIDE a
      // class Annex B's ClassControlLetter also admits digits and `_` (`[\c1]` is U+0011).
      const m = (inClass ? /^c([A-Za-z0-9_])/ : /^c([A-Za-z])/).exec(src.slice(i));
      if (!m) return null;
      i += m[0].length;
      return String.fromCharCode(m[1].charCodeAt(0) & 31);
    }
    if (n === "0") {
      // `\0` on its own is NUL in both dialects. `\0` FOLLOWED BY A DIGIT is a legacy octal escape —
      // `\012` is a newline, not NUL then `1` then `2` — and reading it digit by digit would derive
      // three required characters for one the subject actually carries.
      if (/^0[0-9]/.test(src.slice(i))) throw new ParseRefusal("legacy octal escape (\\0 followed by a digit)");
      i++;
      return "\0";
    }
    const named: Record<string, string> = { n: "\n", r: "\r", t: "\t", f: "\f", v: "\v" };
    if (named[n] !== undefined) {
      i++;
      return named[n];
    }
    // Annex B identity escape: a backslash before any non-alphanumeric is that character. A
    // backslash before a letter or digit this function has not already named is refused rather
    // than guessed at — see the header comment on why this parser never has a default case.
    if (!/[A-Za-z0-9]/.test(n)) {
      i++;
      return n;
    }
    return null;
  }

  function charClass(): PatternNode {
    const clsStart = i;
    i++; // '['
    const negated = src[i] === "^";
    if (negated) i++;
    const chars = new Set<string>();
    let enumerable = true;
    let first = true;
    for (;;) {
      if (i >= src.length) throw new ParseRefusal("unterminated class");
      if (src[i] === "]" && !first) {
        i++;
        break;
      }
      first = false;
      let lo: string | null = null;
      if (src[i] === "\\") {
        i++;
        const n = src[i];
        if ("dDwWsSpPbk".includes(n)) {
          enumerable = false;
          if (n === "p" || n === "P") {
            const m = /^[pP]\{[^}]*\}/.exec(src.slice(i));
            i += m ? m[0].length : 1;
          } else i++;
          continue;
        }
        lo = simpleEscape(true);
        if (lo === null) throw new ParseRefusal(`unknown class escape \\${n}`);
      } else {
        lo = src[i];
        i++;
      }
      if (src[i] === "-" && src[i + 1] !== undefined && src[i + 1] !== "]") {
        i++; // '-'
        let hi: string | null;
        if (src[i] === "\\") {
          i++;
          hi = simpleEscape(true);
          if (hi === null) throw new ParseRefusal("unknown class range escape");
        } else {
          hi = src[i];
          i++;
        }
        const a = lo.codePointAt(0) as number;
        const b = hi.codePointAt(0) as number;
        if (b - a > 64) enumerable = false;
        else for (let cp = a; cp <= b; cp++) chars.add(String.fromCodePoint(cp));
        continue;
      }
      chars.add(lo);
    }
    if (negated || !enumerable) return { t: "any", raw: src.slice(clsStart, i) };
    if (chars.size === 0) return { t: "any", raw: src.slice(clsStart, i) }; // `[]`: matches nothing; conservative
    return { t: "cls", chars: [...chars] };
  }

  const tree = alt();
  if (i !== src.length) throw new ParseRefusal(`unconsumed input at ${i}`);
  return tree;
}

/* ========================================================================================== *
 * B.11 — vocabulary splice: one list, one item, as folded literal variants
 * ========================================================================================== */

/** A list's own per-item matching, exactly `ListMatching` in vocabulary.ts (not imported, to keep
 *  this module free of a dependency on that module's internals beyond the shape itself). */
export interface ItemMatching {
  case_insensitive?: boolean;
  separator_insensitive?: boolean;
}
export type Vocabulary = Record<string, string[]>;
export type VocabularyMatching = Record<string, ItemMatching>;

/**
 * THE SEPARATOR FACTS ARE `vocabulary.ts`'s, IMPORTED RATHER THAN RESTATED (the project's rule:
 * *"Never keep a second copy of anything two places must agree on — export
 * it and import it"*). `itemSource` there compiles an inner separator run of length n into
 * `[-_.]{0,n}`, and `itemLiterals` below must enumerate exactly the strings that accepts: a fourth
 * separator added there and not here would make every affected clause's literals miss the spellings
 * the real pattern started accepting — a silent miss, and one a gate holding its own third copy
 * could not see either. A test imports the same two names for the same reason.
 *
 * The MATCHER is a private instance built from the imported source, not the imported object itself:
 * `INNER_SEPARATOR_RUN` is a `/g` regex and so carries `lastIndex` between calls, and one such
 * object shared between two modules' loops is a re-entrancy hazard no comment can remove. Same
 * source, same behaviour, separate cursor.
 */
const SEPARATORS: readonly string[] = [...VOCABULARY_SEPARATORS];
const INNER_SEPARATOR_RUN = new RegExp(VOCABULARY_INNER_SEPARATOR_RUN.source, VOCABULARY_INNER_SEPARATOR_RUN.flags);

/**
 * Every string `[-_.]{0,n}` can match, shortest first — the same set B.8 unrolls a `{0,n}` node into.
 * Memoised because `itemLiterals` asks for the same handful of tiny `n` once per item of every list
 * of every clause, and the answer depends on nothing but `n` and `SEPARATORS`.
 */
const separatorRunsCache = new Map<number, readonly string[]>();
function separatorRuns(n: number): readonly string[] {
  const hit = separatorRunsCache.get(n);
  if (hit !== undefined) return hit;
  let level = [""];
  const out = [""];
  for (let k = 0; k < n; k++) {
    const next: string[] = [];
    for (const p of level) for (const s of SEPARATORS) next.push(p + s);
    out.push(...next);
    level = next;
  }
  const frozen = Object.freeze(out);
  separatorRunsCache.set(n, frozen);
  return frozen;
}

type ItemLiterals = { variants: string[] } | { segment: string };

/**
 * One vocabulary item under its list's matching flags (B.11). `case_insensitive` needs no variants
 * at all — folding the subject already covers both cases, so the item's own fold is the whole
 * answer. `separator_insensitive` unrolls every inner separator run into every spelling it can take
 * (B.8's rule, applied to the item) when the product of the runs stays within `VARCAP`; past that it
 * falls back to the item's longest separator-free segment, which every spelling contains
 * contiguously whatever the runs expand to (the brief's original rule, kept as the fallback).
 */
export function itemLiterals(item: string, matching: ItemMatching | undefined, limits: PrefilterLimits): ItemLiterals {
  const folded = fold(item);
  if (!matching?.separator_insensitive) return { variants: [folded] };
  const runs: number[] = [];
  const parts: string[] = [];
  let last = 0;
  INNER_SEPARATOR_RUN.lastIndex = 0;
  for (let m = INNER_SEPARATOR_RUN.exec(item); m !== null; m = INNER_SEPARATOR_RUN.exec(item)) {
    parts.push(folded.slice(last, m.index));
    runs.push(m[0].length);
    last = m.index + m[0].length;
  }
  parts.push(folded.slice(last));
  if (runs.length === 0) return { variants: [folded] };
  let count = 1;
  for (const n of runs) count *= separatorRuns(n).length;
  if (count <= limits.varCap) {
    let acc = [parts[0]];
    for (let k = 0; k < runs.length; k++) {
      const next: string[] = [];
      for (const a of acc) for (const s of separatorRuns(runs[k])) next.push(a + s + parts[k + 1]);
      acc = next;
    }
    return { variants: acc };
  }
  let best = "";
  for (const p of parts) if (p.length > best.length) best = p;
  return { segment: best };
}

/* ========================================================================================== *
 * B.1 - B.13 — the derivation itself
 * ========================================================================================== *
 *
 * `analyse(node)` returns a pair:
 *   exact : string[] | null    a FINITE set with {fold(w) : w in L(node)} subset-of exact, or null
 *                               when no such finite set is known ("⊥" in the proposal's notation).
 *   req   : Set<string> | null a set at least one member of which occurs in fold(subject) whenever
 *                               `node` takes part in a match, or null when nothing is provable ("⊤").
 *
 * Every case below is commented with which proposal rule it is and, where the reasoning is not
 * immediate from the rule's own statement, why it is sound. `⊤` (`null`) is returned rather than an
 * empty set for "nothing provable" in every case — an EMPTY required set would mean "no subject can
 * ever satisfy this", which is false for a node that can match something, and would make the filter
 * skip a clause everywhere (proposal §G.3 point 2).
 */

interface Exactable {
  exact: string[] | null;
  req: Set<string> | null;
}

/** Context threaded through one clause's derivation. Not exported: `deriveClauseLiterals` owns it. */
interface DeriveCtx {
  limits: PrefilterLimits;
  allowLookahead: boolean;
  usedLookahead: boolean;
  vocabulary: Vocabulary | undefined;
  matching: VocabularyMatching | undefined;
}

/** The required set implied by a node's own analysis, before the usability filter is applied. */
function reqOf(a: Exactable): Set<string> | null {
  if (a.req !== null) return a.req;
  if (a.exact !== null && a.exact.length > 0 && a.exact.every((s) => s.length > 0)) return new Set(a.exact);
  return null;
}

/** A set is usable as a clause's final required set only past MINLIT and within SETCAP (B.0). */
function usable(set: Set<string> | null, limits: PrefilterLimits): string[] | null {
  if (set === null) return null;
  const arr = [...set];
  if (arr.length === 0 || arr.length > limits.setCap) return null;
  for (const s of arr) if (s.length < limits.minLiteralLength) return null;
  return arr;
}

/** Prefer a set whose weakest member is long, then prefer the smaller set (B.10: policy, not proof). */
function score(arr: string[]): number {
  let min = Infinity;
  for (const s of arr) min = Math.min(min, s.length);
  return min * 100000 - arr.length;
}

function crossProduct(sets: string[][], cap: number): string[] | null {
  let acc = [""];
  for (const s of sets) {
    if (acc.length * s.length > cap) return null;
    const next: string[] = [];
    for (const a of acc) for (const b of s) next.push(a + b);
    acc = next;
  }
  return acc;
}

function analyse(node: PatternNode, ctx: DeriveCtx): Exactable {
  switch (node.t) {
    case "chr":
      // B.1: matches exactly this one character, a literal `\n` included. What that costs is worth
      // stating exactly, because an earlier version of this comment stated the opposite: a clause
      // requiring a `\n` can never match a single LINE (the engine splits on `\n`, so no line
      // contains one), and it can match the whole-file text, where `admissions` does report such a
      // literal — but only because the newline branch of `admissions` marks before it counts the
      // line. The two are one property: see the note there.
      return { exact: [fold(node.c)], req: null };
    case "zero":
      // B.4: matches "". `exact = {""}` rather than `⊥` is deliberate — it lets a concatenation run
      // continue THROUGH an anchor or word boundary instead of being cut in two there.
      return { exact: [""], req: null };
    case "any":
      // B.3: `.`, `\d`, an unenumerable/negated class, a back-reference. Nothing is provable.
      return { exact: null, req: null };
    case "cls": {
      // B.2: enumerate the folded class; past CLASSCAP members it degrades to `any`'s answer.
      const set = new Set(node.chars.map((c) => fold(c)));
      if (set.size > ctx.limits.classCap) return { exact: null, req: null };
      return { exact: [...set], req: null };
    }
    case "grp":
      // B.5: same language as its contents.
      return analyse(node.x, ctx);
    case "look-":
      // B.6: matches "". NEVER RECURSE — a requirement proved inside a negated context is a
      // requirement the subject must NOT satisfy, and a nested negation (`(?!(?=foo))`) makes the
      // sign impossible to track locally. Not entering is the whole of the polarity discipline.
      return { exact: [""], req: null };
    case "look+": {
      // B.7 (kept on): matches "" in the matched text, but if `(?=X)` succeeds at
      // position p of s, some substring of s starting at p is in L(X), so fold(s) DOES contain a
      // member of req(X) — this is the one rule that reasons about the SUBJECT rather than the
      // matched text. Safe only because B.6 never recurses, so X can carry no negated context that
      // would invert the claim.
      const inner = analyse(node.x, ctx);
      // Recorded only when the rule actually CONTRIBUTED, so `usedLookahead` answers the question it
      // is named for even with `allowLookahead: false` (it used to be set either way).
      const r = ctx.allowLookahead ? reqOf(inner) : null;
      if (r !== null) ctx.usedLookahead = true;
      return { exact: [""], req: r };
    }
    case "splice": {
      // B.11: read the UNEXPANDED splice against the rule's own vocabulary/matching, never against
      // the generated alternation `alternation()` would produce — see the header comment on
      // `deriveClauseLiterals` for why deriving from the expansion would be both harder and wrong.
      const items = ctx.vocabulary && Object.prototype.hasOwnProperty.call(ctx.vocabulary, node.name)
        ? ctx.vocabulary[node.name]
        : undefined;
      // A splice naming a list the rule does not declare is a hard error at compile time
      // (vocabulary.ts `assertSharedVocabularyResolved` / expandPattern) — this derivation must not
      // be the thing that notices, so it declines (⊤) rather than throwing (B.11).
      if (!items || items.length === 0) return { exact: null, req: null };
      const matching = ctx.matching && Object.prototype.hasOwnProperty.call(ctx.matching, node.name)
        ? ctx.matching[node.name]
        : undefined;
      // Each item is read ONCE (the two passes below used to call `itemLiterals` twice per
      // item, for the same answer both times).
      const per = items.map((item) => itemLiterals(item, matching, ctx.limits));
      const variants: string[] = [];
      let allVariants = true;
      for (const l of per) {
        if ("variants" in l) variants.push(...l.variants);
        else allVariants = false;
      }
      if (allVariants && variants.length <= ctx.limits.setCap) return { exact: variants, req: null };
      // Mixed or oversized: every item still contributes at least one required substring.
      const req = new Set<string>();
      for (const l of per) {
        if ("variants" in l) for (const v of l.variants) req.add(v);
        else req.add(l.segment);
      }
      return { exact: null, req };
    }
    case "alt": {
      // B.12: a match goes through exactly one branch, so the requirement is the UNION of the
      // branches' own requirements ("at least one of"), and `⊤` if any branch is `⊤`.
      const parts = node.xs.map((x) => analyse(x, ctx));
      let exact: string[] | null = null;
      if (parts.every((p) => p.exact !== null)) {
        const all: string[] = [];
        for (const p of parts) all.push(...(p.exact as string[]));
        if (all.length <= ctx.limits.setCap) exact = [...new Set(all)];
      }
      let req: Set<string> | null = null;
      const rs = parts.map(reqOf);
      if (!rs.some((r) => r === null)) {
        const u = new Set<string>();
        for (const r of rs) for (const s of r as Set<string>) u.add(s);
        if (u.size <= ctx.limits.setCap) req = u;
      }
      return { exact, req };
    }
    case "rep": {
      const inner = analyse(node.x, ctx);
      if (node.min === 0) {
        // B.8: may be absent entirely, so it requires nothing on its own. `exact` can still be
        // finite: L(X{0,n}) = union over k<=n of L(X)^k, and folding distributes over concatenation.
        let exact: string[] | null = null;
        if (inner.exact !== null && Number.isFinite(node.max) && node.max <= ctx.limits.repCap) {
          const all = new Set<string>([""]);
          let level = [""];
          let ok = true;
          for (let k = 0; k < node.max; k++) {
            const next: string[] = [];
            for (const a of level) for (const b of inner.exact) next.push(a + b);
            if (next.length + all.size > ctx.limits.setCap) {
              ok = false;
              break;
            }
            for (const s of next) all.add(s);
            level = next;
          }
          if (ok) exact = [...all];
        }
        return { exact, req: null };
      }
      // B.9: min>=1 — at least `min` consecutive copies of X occur inside the match, contiguously,
      // so their folded concatenation is a substring of the folded match.
      let exact: string[] | null = null;
      if (inner.exact !== null && Number.isFinite(node.max) && node.max <= ctx.limits.repCap) {
        const all = new Set<string>();
        let level = [""];
        let ok = true;
        for (let k = 1; k <= node.max; k++) {
          const next: string[] = [];
          for (const a of level) for (const b of inner.exact) next.push(a + b);
          if (next.length + all.size > ctx.limits.setCap) {
            ok = false;
            break;
          }
          if (k >= node.min) for (const s of next) all.add(s);
          level = next;
        }
        if (ok && all.size > 0) exact = [...all];
      }
      let req = reqOf(inner);
      if (inner.exact !== null) {
        const p = crossProduct(
          Array.from({ length: node.min }, () => inner.exact as string[]),
          ctx.limits.setCap,
        );
        if (p !== null && p.length > 0) req = new Set(p);
      }
      return { exact, req };
    }
    case "seq": {
      // B.10: two sound sources, best-scoring wins (policy, proven safe by construction — see
      // `score` above): (a) any contiguous run of factors with a finite `exact`, cross-multiplied;
      // (b) any single factor's own `req`. The implementation searches every contiguous sub-range,
      // bounded by RUNWORK, because a long run can exceed SETCAP while a sub-range of it does not.
      const parts = node.xs.map((x) => analyse(x, ctx));
      let exact: string[] | null = null;
      if (parts.every((p) => p.exact !== null)) {
        exact = crossProduct(
          parts.map((p) => p.exact as string[]),
          ctx.limits.setCap,
        );
      }
      let best: string[] | null = null;
      let bestScore = -Infinity;
      const consider = (set: Set<string> | null) => {
        const arr = usable(set, ctx.limits);
        if (arr === null) return;
        const sc = score(arr);
        if (sc > bestScore) {
          bestScore = sc;
          best = arr;
        }
      };
      if (exact !== null) consider(new Set(exact));
      let work = 0;
      outer: for (let a = 0; a < parts.length; a++) {
        if (parts[a].exact === null) continue;
        const sets: string[][] = [];
        for (let b = a; b < parts.length && parts[b].exact !== null; b++) {
          sets.push(parts[b].exact as string[]);
          if (++work > ctx.limits.runWork) break outer;
          const p = crossProduct(sets, ctx.limits.setCap);
          if (p === null) break; // a longer range from `a` only grows further
          consider(new Set(p));
        }
      }
      for (const p of parts) consider(p.req);
      return { exact, req: best === null ? null : new Set(best) };
    }
  }
}

/** What `deriveClauseLiterals` returns for one clause. */
export interface DerivedLiterals {
  /** The required literal set (already folded), or `null` — the clause must run unfiltered (⊤). */
  literals: string[] | null;
  /** A named reason for a `null` result, never a silent one (B.13, proposal §G.3 point 2). */
  refusal: string | null;
  /** Whether the positive-lookaround rule (B.7) contributed to this set — reporting only. */
  usedLookahead: boolean;
}

export interface DeriveOptions extends Partial<PrefilterLimits> {
  /** Owner decision H2 (2026-09-15): kept on. Exposed so §C.2's sensitivity table stays reproducible. */
  allowLookahead?: boolean;
}

/**
 * Derive the required-literal set of ONE clause, from its UNEXPANDED pattern source.
 *
 * `vocabulary` / `matching` are the declaring rule's own `detector.vocabulary` /
 * `detector.vocabulary_matching` — exactly what `expandPatterns` (vocabulary.ts) is handed to
 * compile the same clause into a real `RegExp`. Deriving from the UNEXPANDED pattern (splice treated
 * as an atom, resolved against the list here rather than inlining `alternation()`'s generated
 * source) is deliberate (B.11): the expanded trie's terminal nodes are `(?:…)?`, exactly the
 * nullable shape B.8 has to work hardest on, so re-parsing it would re-derive a weaker answer at
 * more cost, and it would make a clause's literals depend on how `alternation()` happens to spell
 * them rather than on the authored word list.
 */
export function deriveClauseLiterals(
  pattern: string,
  vocabulary: Vocabulary | undefined,
  matching: VocabularyMatching | undefined,
  options: DeriveOptions = {},
): DerivedLiterals {
  const limits: PrefilterLimits = { ...DEFAULT_LIMITS, ...options };
  const ctx: DeriveCtx = {
    limits,
    allowLookahead: options.allowLookahead !== false,
    usedLookahead: false,
    vocabulary,
    matching,
  };
  let tree: PatternNode;
  try {
    tree = parsePattern(pattern);
  } catch (e) {
    return { literals: null, refusal: e instanceof ParseRefusal ? e.message : String(e), usedLookahead: false };
  }
  // `analyse` is total over every `PatternNode` the parser can produce (the switch in `analyse` is
  // exhaustive over the discriminated union, so TypeScript itself already proves there is no
  // fall-through case) and never does I/O, so nothing here is EXPECTED to throw. The `catch` is a
  // second line of defence rather than a case this code path is designed around: a clause whose
  // derivation crashes must degrade to "run this clause unfiltered", never to a scan that dies over
  // one pattern (B.13's discipline applied to the analyser itself, not only to the parser).
  let a: Exactable;
  try {
    a = analyse(tree, ctx);
  } catch (e) {
    return { literals: null, refusal: `analyse: ${String(e)}`, usedLookahead: ctx.usedLookahead };
  }
  const arr = usable(reqOf(a), limits);
  return {
    literals: arr,
    refusal: arr === null ? "no literal of the minimum length is required" : null,
    usedLookahead: ctx.usedLookahead,
  };
}

/* ========================================================================================== *
 * D.1 — Aho-Corasick automaton over every clause's literals, one automaton, typed arrays
 * ========================================================================================== *
 *
 * A goto trie flattened into typed arrays, so the hot loop (`admissions` below) touches no `Map`,
 * no per-node object and no megamorphic property lookup. Case is handled by folding the SUBJECT as
 * it is read (ASCII only, same convention as `fold`), so there is one automaton and one pass — a
 * second, case-preserving copy would buy precision this design does not need, since folding only
 * ever widens what is admitted (never causes a miss).
 */
export interface Automaton {
  n: number;
  e: number;
  edgeStart: Int32Array; // n+1
  edgeChar: Uint16Array; // e, sorted ascending within each node's range
  edgeNext: Int32Array; // e
  fail: Int32Array; // n
  dictLink: Int32Array; // n; -1 = none
  term: Int32Array; // n; literalId+1, or 0
  root: Int32Array; // 128; dense ASCII row for state 0, the hot path
}

/**
 * Build one automaton over `literals[i]` = the literal string for id `i`. Literals are assumed
 * already folded and deduplicated by the caller (`buildClauseLiteralIndex` below); this function
 * does not care where the ids come from.
 */
export function buildAutomaton(literals: readonly string[]): Automaton {
  const childMaps: Map<number, number>[] = [new Map()];
  const term: number[] = [0];
  for (let id = 0; id < literals.length; id++) {
    const lit = literals[id];
    let node = 0;
    for (let i = 0; i < lit.length; i++) {
      const ch = lit.charCodeAt(i);
      let next = childMaps[node].get(ch);
      if (next === undefined) {
        next = childMaps.length;
        childMaps.push(new Map());
        term.push(0);
        childMaps[node].set(ch, next);
      }
      node = next;
    }
    term[node] = id + 1;
  }
  const n = childMaps.length;
  const fail = new Int32Array(n);
  const dictLink = new Int32Array(n).fill(-1);
  const queue: number[] = [];
  for (const [, next] of childMaps[0]) {
    fail[next] = 0;
    queue.push(next);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const u = queue[qi];
    dictLink[u] = term[fail[u]] ? fail[u] : dictLink[fail[u]];
    for (const [ch, v] of childMaps[u]) {
      let f = fail[u];
      for (;;) {
        const t = childMaps[f].get(ch);
        if (t !== undefined) {
          fail[v] = t;
          break;
        }
        if (f === 0) {
          fail[v] = 0;
          break;
        }
        f = fail[f];
      }
      queue.push(v);
    }
  }
  const edgeStart = new Int32Array(n + 1);
  let e = 0;
  for (let node = 0; node < n; node++) {
    edgeStart[node] = e;
    e += childMaps[node].size;
  }
  edgeStart[n] = e;
  const edgeChar = new Uint16Array(e);
  const edgeNext = new Int32Array(e);
  for (let node = 0; node < n; node++) {
    const sorted = [...childMaps[node]].sort((a, b) => a[0] - b[0]);
    let p = edgeStart[node];
    for (const [ch, v] of sorted) {
      edgeChar[p] = ch;
      edgeNext[p] = v;
      p++;
    }
  }
  const root = new Int32Array(128);
  for (const [ch, v] of childMaps[0]) if (ch < 128) root[ch] = v;
  return { n, e, edgeStart, edgeChar, edgeNext, fail, dictLink, term: Int32Array.from(term), root };
}

function findEdge(ac: Automaton, node: number, ch: number): number {
  let lo = ac.edgeStart[node];
  let hi = ac.edgeStart[node + 1] - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = ac.edgeChar[mid];
    if (c === ch) return ac.edgeNext[mid];
    if (c < ch) lo = mid + 1;
    else hi = mid - 1;
  }
  return 0;
}

function step(ac: Automaton, node: number, ch: number): number {
  for (;;) {
    if (node === 0) return ch < 128 ? ac.root[ch] : findEdge(ac, 0, ch);
    const t = findEdge(ac, node, ch);
    if (t !== 0) return t;
    node = ac.fail[node];
    if (node === 0) return ch < 128 ? ac.root[ch] : findEdge(ac, 0, ch);
  }
}

/** `ceil(nLiterals / 8)` bytes — the size of a bitset with one bit per literal id. */
export function literalBitsetBytes(nLiterals: number): number {
  return (nLiterals + 7) >> 3;
}

function setBit(bitset: Uint8Array, id: number): void {
  bitset[id >> 3] |= 1 << (id & 7);
}

/** Whether any of `ids` has its bit set in `bitset`. Used to gate `also_in_file` clauses (A.3). */
export function bitsetHasAny(bitset: Uint8Array, ids: Int32Array): boolean {
  for (let i = 0; i < ids.length; i++) if (bitset[ids[i] >> 3] & (1 << (ids[i] & 7))) return true;
  return false;
}

/**
 * One pass over `text`: every literal id present anywhere (a bitset, `file`), and, per 0-based line,
 * the literal ids whose match's LAST character falls on that line (`lineLiterals` — sparse: a line
 * with no hit has no entry). Proposal §A.2(2): attributing a match to the line its last character
 * falls on marks a line that may not contain the whole literal (it can straddle a `\n`) — over-
 * admission, always free — and never fails to mark a line that does contain it.
 *
 * A sparse `Map<line, literalId[]>` rather than a dense per-line bitmask: §C.3 measures that the
 * median clause's commonest literal occurs in 2 of 957 sampled files, so the overwhelming majority
 * of lines admit nothing at all, and a bitmask sized to `nLiterals` (tens of thousands of bits) on
 * every line of a large file would cost far more to allocate and clear than the hits it would ever
 * record.
 */
export function admissions(automaton: Automaton, nLiterals: number, text: string): { file: Uint8Array; lineLiterals: Map<number, number[]> } {
  const file = new Uint8Array(literalBitsetBytes(nLiterals));
  const lineLiterals = new Map<number, number[]>();
  let node = 0;
  let line = 0;
  const mark = (litId: number): void => {
    setBit(file, litId);
    let arr = lineLiterals.get(line);
    if (arr === undefined) {
      arr = [];
      lineLiterals.set(line, arr);
    }
    arr.push(litId);
  };
  for (let i = 0; i < text.length; i++) {
    let ch = text.charCodeAt(i);
    // A `\n` is stepped, marked and only THEN counted, so a literal whose last character is the
    // newline is reported like any other and is attributed to the line that newline terminates (an earlier version `continue`d past the marking, so such
    // a literal set no bit at all — harmless for `match`, which is tested line by line, but it
    // would have shut an `also_in_file` corroboration gate on the whole-file text, which is a
    // silent miss). No literal in the shipped bundle contains a `\n`, so this changes nothing about
    // any scan today; a test's automaton suite is what holds the property.
    const newline = ch === 10;
    if (ch >= 65 && ch <= 90) ch += 32;
    node = step(automaton, node, ch);
    if (automaton.term[node]) mark(automaton.term[node] - 1);
    for (let d = automaton.dictLink[node]; d !== -1; d = automaton.dictLink[d]) mark(automaton.term[d] - 1);
    if (newline) line++;
  }
  return { file, lineLiterals };
}

/* ========================================================================================== *
 * The clause-literal index: one automaton + posting lists over every gated clause in the bundle
 * ========================================================================================== */

/**
 * The whole prefilter index for a compiled bundle: one automaton over every distinct literal any
 * gated clause requires, each clause's own literal ids (or `null` — refused, always admitted), and
 * the reverse mapping (postings) used to expand "this literal occurred" into "these clauses are
 * admitted" without ever iterating clauses that were not hit.
 *
 * A PURE FUNCTION OF `clauseLiteralSets`, and nothing else — no corpus sample, no frequency table,
 * no reading of any target tree. A test assertion 4 builds this twice from the
 * same bundle and asserts the two are identical for exactly this reason (proposal §E.2).
 */
export interface ClauseLiteralIndex {
  automaton: Automaton;
  nLiterals: number;
  /** literal id -> its folded string, for reporting (the self-check message, coverage counts). */
  literals: string[];
  /** clause id -> its required literal ids, or `null` if the clause's derivation refused (⊤). */
  clauseLiteralIds: (Int32Array | null)[];
  /** literal id -> clause ids that require it. Only ids of non-refused clauses ever appear. */
  postings: Int32Array[];
}

export function buildClauseLiteralIndex(clauseLiteralSets: readonly (readonly string[] | null)[]): ClauseLiteralIndex {
  const literalId = new Map<string, number>();
  const literals: string[] = [];
  const clauseLiteralIds: (Int32Array | null)[] = new Array(clauseLiteralSets.length);
  const postingsBuilder: number[][] = [];
  for (let c = 0; c < clauseLiteralSets.length; c++) {
    const set = clauseLiteralSets[c];
    if (set === null) {
      clauseLiteralIds[c] = null;
      continue;
    }
    const ids = new Int32Array(set.length);
    for (let k = 0; k < set.length; k++) {
      const lit = set[k];
      let id = literalId.get(lit);
      if (id === undefined) {
        id = literals.length;
        literalId.set(lit, id);
        literals.push(lit);
        postingsBuilder.push([]);
      }
      ids[k] = id;
      postingsBuilder[id].push(c);
    }
    clauseLiteralIds[c] = ids;
  }
  const automaton = buildAutomaton(literals);
  const postings = postingsBuilder.map((p) => Int32Array.from(p));
  return { automaton, nLiterals: literals.length, literals, clauseLiteralIds, postings };
}

/**
 * The per-file admission computation the engine calls once per file (proposal §A.3): one
 * `admissions()` pass over each of the given texts (`content`, `guardContent`), unioned into a
 * single file-level literal bitset and a single per-line admitted-CLAUSE-id map (expanded through
 * the posting lists, so the cost is proportional to actual hits, never to the clause count).
 *
 * The UNION is what makes one mask correct for both call sites it gates: `matchFires` reads the
 * union at the line level (a clause admitted by either the raw or the comment-blanked text may fire
 * on either), and `also_in_file`'s first disjunct — tested only against `guardContent` — reads the
 * SAME union at the file level. Using the broader union rather than computing a `guardContent`-only
 * file set for `also_in_file` can only over-admit, which is always sound (§A.2).
 */
export interface FileAdmissions {
  /** literal ids seen anywhere in ANY of the given texts. */
  fileLiterals: Uint8Array;
  /** 0-based line -> admitted CLAUSE ids (union across the given texts' hits on that line). Sparse. */
  admittedClausesByLine: Map<number, Set<number>>;
}

export function computeFileAdmissions(index: ClauseLiteralIndex, texts: readonly string[]): FileAdmissions {
  const fileLiterals = new Uint8Array(literalBitsetBytes(index.nLiterals));
  const perTextLineLiterals: Map<number, number[]>[] = [];
  for (const text of texts) {
    const a = admissions(index.automaton, index.nLiterals, text);
    for (let i = 0; i < fileLiterals.length; i++) fileLiterals[i] |= a.file[i];
    perTextLineLiterals.push(a.lineLiterals);
  }
  const lineKeys = new Set<number>();
  for (const m of perTextLineLiterals) for (const k of m.keys()) lineKeys.add(k);
  const admittedClausesByLine = new Map<number, Set<number>>();
  for (const lineIdx of lineKeys) {
    const admitted = new Set<number>();
    for (const m of perTextLineLiterals) {
      const lits = m.get(lineIdx);
      if (lits === undefined) continue;
      for (const litId of lits) {
        const clauses = index.postings[litId];
        for (let k = 0; k < clauses.length; k++) admitted.add(clauses[k]);
      }
    }
    admittedClausesByLine.set(lineIdx, admitted);
  }
  return { fileLiterals, admittedClausesByLine };
}

/* ========================================================================================== *
 * E.3/E.4 — the runtime self-check and the switch's data shapes
 * ========================================================================================== */

/** `--no-prefilter` / `PRODUCT_CLI_PREFILTER=0`, and the self-check sample rate, resolved once per scan. */
export interface PrefilterRuntimeOptions {
  enabled: boolean;
  /** 1 = check every skipped pair ("=all"). 100 = the default: about 1 in 100. */
  selfCheckRate: number;
}

export const DEFAULT_SELF_CHECK_RATE = 100;

/**
 * A deterministic sample of skipped (clause, line) pairs, in traversal order (proposal §E.3).
 * `shouldTest()` is one multiply and one compare — no hashing of strings — and the multiplicative
 * scramble (Knuth's 32-bit constant) is what stops the sample aliasing with any period in a rule's
 * clause list: a plain `counter % rate` would sample the same clause index forever in a rule whose
 * clause count divides `rate`. Deterministic for a given (bundle, tree, flags), which is what makes
 * a self-check report reproducible.
 */
export class SelfCheckSampler {
  private counter = 0;
  constructor(private readonly rate: number) {}
  /**
   * RESTART THE SEQUENCE FOR ONE FILE, at a phase that is a function of that file's position in the
   * walk and of nothing else — stage 3c's answer to the question stages 3a/3b handed forward
   * ("decide how the sample stays deterministic across shards"; `PrefilterScan` in engine.ts,
   * `integration-2026-09-15.md` §8 item 1).
   *
   * THE PROBLEM. The counter used to be per TRAVERSAL: it started at 0 when the scan started and
   * advanced once per skipped (rule, line, clause) pair for the whole walk, so which pairs were
   * re-tested was a function of how many pairs had been seen before them. With one thread that is
   * the sequential order and is reproducible from the tree. With several workers it is not: one
   * shared counter cannot exist across threads, and one counter per worker makes the sample depend
   * on how the files happened to be divided and on which chunk a worker happened to take. Neither
   * can change a finding — a self-check either finds nothing, which is silent, or throws and stops
   * the scan — but a spot check that cannot be reproduced from its inputs is not evidence, which is
   * why a default was refused and a decision asked for.
   *
   * THE ANSWER. A file is always scanned WHOLE by one thread, and inside `scanFile` these calls run
   * in a fixed order: rules in bundle order, lines in order, clauses in order. So a counter restarted
   * from the file's own walk index at the top of every file runs through the identical sequence for
   * that file whatever else the process scanned — at any `--jobs`, in any dispatch order, in any
   * chunking, and again on a re-run. The sampled set becomes a pure function of (tree, bundle, rate).
   *
   * WHY A PHASE AND NOT A MIXED SEED, WHICH IS WHAT THIS WAS FIRST WRITTEN AS. The obvious form —
   * hash the (file index, clause id, line) triple, or seed the counter with a well-mixed hash of the
   * file index — is deterministic in exactly the same sense and COSTS 30-45 % OF THE WALL CLOCK OF A
   * WHOLE SCAN. Measured on one tree at `--jobs 1`, three interleaved runs each: the
   * running counter 3.02 s, a hash of the triple 4.15 s, a mixed per-file seed 4.76 s, this phase
   * 3.38 s against the running counter's 3.38 s in the same batch. The cost is not in the re-tests
   * and not in how many there are: all four draw the same 56.8k re-tests out of 5.68M skipped pairs
   * and reach the same ~1,550 of the bundle's 1,635 clauses, and the time inside the re-tests moves
   * by 0.23 s of the 1.5 s. It is in the rest of the scan, and it has the same sign in the engine as
   * it stands: turning the self-check OFF ALTOGETHER also makes that engine slower (3.02 s -> 3.95 s
   * at `PRODUCT_CLI_PREFILTER_SELFCHECK=1000000000`), which is what says the mechanism is a warm-up
   * of the skipped clauses' own regular expressions rather than the price of testing them. The phase
   * keeps the sequence the shipped engine draws and moves only where each file starts in it.
   *
   * 97 is a prime below the mean spacing of the hits (one in `rate`, 100 by default), so consecutive
   * files start at different points of the same sequence and the phase cycles over the walk — the
   * variation between files the running counter got from its drift, without its dependence on what
   * had been scanned before. `PRODUCT_CLI_PREFILTER_SELFCHECK=all` is untouched: `shouldTest` below
   * returns true for every skipped pair whatever the phase.
   */
  startFile(fileIndex: number): void {
    this.counter = fileIndex % 97;
  }
  shouldTest(): boolean {
    const c = this.counter;
    this.counter = c + 1;
    if (this.rate <= 1) return true; // "=all"
    return (Math.imul(c, 2654435761) >>> 0) < 2 ** 32 / this.rate;
  }
}

/** Thrown when the self-check catches a skip that was unsound. `index.ts` turns this into the exit. */
export class PrefilterSelfCheckFailure extends Error {}

/** The exact message of proposal §E.3, one call site per gated field ("match" / "also_in_file"). */
export function formatSelfCheckFailure(args: {
  ruleId: string;
  clauseNumber: number; // 1-based
  field: "match" | "also_in_file";
  file: string;
  line: number; // 1-based
  lineText: string;
  literals: string[];
}): string {
  return [
    `prefilter self-check FAILED — a line was skipped that rule ${args.ruleId} clause ${args.clauseNumber} (${args.field}) matches.`,
    `  file : ${args.file}:${args.line}`,
    // The line is NOT printed (2026-10-12): it can carry a credential, and this message asks to be
    // reported, so it would be forwarded. The file and line
    // above find it; `lineText` stays in the signature for the caller's record.
    `  line : not printed here, because a line can carry a credential; open ${args.file} at line ${args.line}`,
    `  literals: ${JSON.stringify(args.literals.slice(0, 8))} (size ${args.literals.length})`,
    `  This is a defect in the prefilter, not in the rule. The scan has been stopped because its`,
    `  result would have been missing findings. Re-run with --no-prefilter to get a correct scan,`,
    `  and report the four lines above.`,
  ].join("\n");
}

/**
 * A switch this module was given a value it cannot act on. A DISTINCT class from
 * `PrefilterSelfCheckFailure` because the two are opposite kinds of news — this one says the run was
 * never started, that one says a started run was stopped — and because `index.ts` turns each into
 * its own message rather than letting either reach the user as a Node stack trace.
 */
export class PrefilterOptionError extends Error {}

/** Resolve the self-check rate from an env value (`undefined` no-op, `"all"` -> 1, else a positive number). */
export function parseSelfCheckRateEnv(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (raw === "all") return 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new PrefilterOptionError(
      `PRODUCT_CLI_PREFILTER_SELFCHECK must be a positive number or "all", got ${JSON.stringify(raw)}`,
    );
  }
  return n;
}

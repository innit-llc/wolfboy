/**
 * C2-4: WHERE THE HOST'S SEARCH AND THE REPLAY READ ONE PATTERN
 * DIFFERENTLY.
 *
 * A seat's Grep is ripgrep: Rust's regular expressions, Unicode by default, each line searched with the carriage return
 * it keeps where the file ends its lines with CR LF. The replay (`rests-on.ts` `replaySearch`) is JavaScript's RegExp
 * without the `u` flag, over the lines the tree reader cut at CR LF or LF. At capture a place's search is compared with
 * what the host returned (`place-premises.ts` `hostDifference`), but only on the tree as it was then: a later run has no
 * host, so a difference that shows only on a line added later was not seen (C2-4). Most of a pattern means the same in
 * both. What does not falls in two kinds:
 *
 * - **A construct that means something else on any text**: `\p{L}`, `[[:alpha:]]`, `\x{41}`, `\A`, `\<`, a nested class,
 *   a set operation inside a class, `{,3}`, a group other than `(?:` and `(?<name>`, a letter escape the two do not share,
 *   a character outside the Basic Multilingual Plane, and, in a caseless search, a character whose Unicode case folding
 *   reaches ASCII (FOLDS_TO_ASCII, F4). Such a search is unreplayable, at capture and in every later run.
 * - **A construct that means the same on some text and not on other**: `\w`, `\d`, `\s`, `\b` and their negations, and
 *   case-insensitive matching, which ripgrep reads over Unicode and the replay over ASCII (they differ only on a line that
 *   holds a character outside ASCII, once a pattern holding one of FOLDS_TO_ASCII is refused as the first kind); `.`, `$`, a negated class, `\r` and a class that can hold it, which differ at a
 *   carriage return the replay does not see, at U+2028 or U+2029, at a byte-order mark, at an undecodable byte or at a
 *   character outside the Basic Multilingual Plane; `^`, which differs at a byte-order mark that opens a line; and any
 *   search across lines. Such a search is replayed, and the replay also digests every line of its scope that holds such
 *   a character (in a search across lines, every such file whole): `dialect`. On every other line the two read the
 *   pattern alike, so where those lines are the ones the search was recorded over and its hits replay the same, the
 *   host's search returns the same lines too. A later edit that adds or changes such a line moves the digest, and what
 *   rests on the search is read again, never carried.
 *
 * Pure: the pattern and two flags in, a verdict out.
 */

/** What the replay can say about one pattern: unreplayable, or the lines on which it may be read differently. */
export interface PatternDialect {
  /** Set where the pattern holds a construct the two read differently on any text: the search cannot be replayed. */
  unreplayable?: string;
  /** Whether a line (as the file holds it, its carriage return kept) is one the two may read differently; absent where none is. */
  sensitive?: (rawLine: string) => boolean;
  /** The constructs that make lines sensitive, sorted, for a reader. */
  constructs: string[];
}

/**
 * F4: the characters outside ASCII whose Unicode simple
 * case folding reaches an ASCII letter - U+017F (long s) folds to `s`, U+212A (Kelvin sign) to `k`. Read off the Unicode
 * case-folding table (CaseFolding.txt, statuses C and S: the simple folding ripgrep's case-insensitive matching uses, and
 * JavaScript's with the `i` and `u` flags): every code point above U+007F that `/^[a-z]$/iu` matches. `test:carry-forward`
 * recomputes it on its own runtime and fails if this list differs. In a caseless search ripgrep matches such a character
 * against an ASCII letter on a line of ASCII only, and the replay (no `u` flag) never does, so the line that differs need
 * not hold any character outside ASCII: a caseless pattern holding one is unreplayable, not a pattern whose lines are
 * recorded.
 */
export const FOLDS_TO_ASCII: readonly number[] = [0x017f, 0x212a];

/** The first of FOLDS_TO_ASCII from `lo` to `hi` (one character where they are equal), if any. */
function reachesFoldToAscii(lo: number, hi: number): number | undefined {
  return FOLDS_TO_ASCII.find((f) => lo <= f && f <= hi);
}

const isHex = (s: string): boolean => /^[0-9A-Fa-f]+$/.test(s);
const isSurrogate = (c: number): boolean => c >= 0xd800 && c <= 0xdfff;

/** A character outside ASCII: where a Unicode class, a word boundary or case-insensitive matching may differ. */
function hasNonAscii(line: string): boolean {
  for (let k = 0; k < line.length; k++) if (line.charCodeAt(k) > 0x7f) return true;
  return false;
}

/** A carriage return, U+2028, U+2029, a byte-order mark, a replacement character or half of a surrogate pair. */
function hasLineEndOrWide(line: string): boolean {
  for (let k = 0; k < line.length; k++) {
    const c = line.charCodeAt(k);
    if (c === 0x0d || c === 0x2028 || c === 0x2029 || c === 0xfeff || c === 0xfffd || isSurrogate(c)) return true;
  }
  return false;
}

/** One `\` escape: its length, and the one character it is in both readings, the class it names, or why it is neither. */
function escapeAt(pattern: string, at: number, inClass: boolean): { len: number; value?: number; cls?: string; bad?: string } {
  const e = pattern[at + 1];
  if (e === undefined) return { len: 1 };
  if ("wWdDsS".includes(e)) return { len: 2, cls: e };
  if (e === "b" || e === "B") return inClass ? { len: 2, bad: `\`\\${e}\` inside a class` } : { len: 2, cls: e };
  const simple: Record<string, number> = { n: 0x0a, t: 0x09, f: 0x0c, v: 0x0b, r: 0x0d };
  if (simple[e] !== undefined) return { len: 2, value: simple[e] };
  if (e === "x") {
    const h = pattern.slice(at + 2, at + 4);
    return h.length === 2 && isHex(h) ? { len: 4, value: parseInt(h, 16) } : { len: 2, bad: "`\\x` not followed by exactly two hex digits" };
  }
  if (e === "u") {
    const h = pattern.slice(at + 2, at + 6);
    if (h.length !== 4 || !isHex(h)) return { len: 2, bad: "`\\u` not followed by exactly four hex digits" };
    const v = parseInt(h, 16);
    return isSurrogate(v) ? { len: 6, bad: "an escaped surrogate" } : { len: 6, value: v };
  }
  const code = e.charCodeAt(0);
  if (/[A-Za-z0-9<>]/.test(e) || code > 0x7f) return { len: 2, bad: `the escape \`\\${e}\`` };
  // Escaped punctuation: the character itself, in both.
  return { len: 2, value: code };
}

/**
 * The dialect of one pattern as the replay compiles it (`rests-on.ts` `hostRegex` has already taken a leading `(?i)`,
 * `(?m)` or `(?s)` into the flags). `caseless`: the search ignores case; `acrossLines`: a multiline search.
 */
export function dialectOf(pattern: string, opts: { caseless: boolean; acrossLines: boolean }): PatternDialect {
  let unicode = false;
  let ends = false;
  let starts = false;
  /** The first of FOLDS_TO_ASCII the pattern holds, as a literal, an escape, a class member or inside a class range (F4). */
  let foldsToAscii: number | undefined;
  const holds = (lo: number, hi: number): void => {
    if (foldsToAscii === undefined) foldsToAscii = reachesFoldToAscii(lo, hi);
  };
  const constructs = new Set<string>();
  const no = (what: string): PatternDialect => ({
    unreplayable: `the pattern holds ${what}, which the host's search (ripgrep) and this replay read differently on any text, so the replay cannot stand for it.`,
    constructs: [],
  });
  const classEscape = (cls: string, inClass: boolean): void => {
    unicode = true;
    constructs.add(inClass ? `[\\${cls}]` : `\\${cls}`);
    if ("sSWD".includes(cls)) ends = true;
  };
  const n = pattern.length;
  let i = 0;
  while (i < n) {
    const c = pattern[i]!;
    const code = pattern.charCodeAt(i);
    if (isSurrogate(code)) return no("a character outside the Basic Multilingual Plane (ripgrep reads it as one character, this replay as two)");
    holds(code, code);
    if (c === "\\") {
      const e = escapeAt(pattern, i, false);
      if (e.bad) return no(e.bad);
      if (e.cls) classEscape(e.cls, false);
      if (e.value !== undefined) holds(e.value, e.value);
      if (e.value === 0x0d) {
        ends = true;
        constructs.add("\\r");
      }
      i += e.len;
      continue;
    }
    if (c === "[") {
      let j = i + 1;
      const negated = pattern[j] === "^";
      if (negated) j += 1;
      if (pattern[j] === "]") return no("a class that opens with `]` (ripgrep reads a literal `]`, this replay an empty class)");
      let prev: number | undefined;
      let range = false;
      while (j < n && pattern[j] !== "]") {
        const ch = pattern[j]!;
        const cc = pattern.charCodeAt(j);
        if (isSurrogate(cc)) return no("a character outside the Basic Multilingual Plane inside a class");
        if (ch === "[") return no("`[` inside a class (ripgrep reads a nested class or a class such as `[[:alpha:]]`, this replay the character itself)");
        if ((ch === "&" || ch === "-" || ch === "~") && pattern[j + 1] === ch) return no(`\`${ch}${ch}\` inside a class (ripgrep reads a set operation, this replay two characters)`);
        let value: number | undefined;
        if (ch === "\\") {
          const e = escapeAt(pattern, j, true);
          if (e.bad) return no(`${e.bad} inside a class`);
          if (e.cls) classEscape(e.cls, true);
          value = e.value;
          j += e.len;
        } else if (ch === "-" && prev !== undefined && j + 1 < n && pattern[j + 1] !== "]") {
          range = true;
          j += 1;
          continue;
        } else {
          value = cc;
          j += 1;
        }
        if (value === undefined) {
          prev = undefined;
          range = false;
          continue;
        }
        if (range && prev !== undefined) {
          holds(prev, value);
          if ((prev <= 0x0d && value >= 0x0d) || value >= 0xd800) {
            ends = true;
            constructs.add("a class range holding a carriage return or reaching past U+D7FF");
          }
          range = false;
          prev = undefined;
        } else {
          holds(value, value);
          if (value === 0x0d) {
            ends = true;
            constructs.add("\\r");
          }
          prev = value;
        }
      }
      if (negated) {
        ends = true;
        constructs.add("a negated class");
      }
      i = j + 1;
      continue;
    }
    if (c === ".") {
      ends = true;
      constructs.add(".");
    } else if (c === "$") {
      ends = true;
      constructs.add("$");
    } else if (c === "^") {
      starts = true;
      constructs.add("^");
    } else if (c === "(") {
      if (pattern[i + 1] === "?") {
        if (pattern[i + 2] === ":") {
          i += 3;
          continue;
        }
        const named = /^\(\?<[A-Za-z_][A-Za-z0-9_]*>/.exec(pattern.slice(i));
        if (named) {
          i += named[0].length;
          continue;
        }
        return no(`the group \`${pattern.slice(i, i + 4)}\` (a lookaround, an inline flag inside the pattern, or a named group of another form)`);
      }
    } else if (c === "{") {
      const q = /^\{\d+(,\d*)?\}/.exec(pattern.slice(i));
      if (!q) return no("a `{` that is not a repetition `{n}`, `{n,}` or `{n,m}`");
      i += q[0].length;
      continue;
    } else if (code === 0x0d) {
      ends = true;
      constructs.add("\\r");
    }
    i += 1;
  }
  if (opts.caseless && foldsToAscii !== undefined) {
    const name = `U+${foldsToAscii.toString(16).toUpperCase().padStart(4, "0")}`;
    return no(`${name} under case-insensitive matching, a character whose Unicode case folding reaches ASCII (ripgrep matches it against an ASCII letter on a line of ASCII only, this replay never does)`);
  }
  if (opts.caseless) {
    unicode = true;
    constructs.add("case-insensitive matching");
  }
  if (opts.acrossLines) {
    ends = true;
    constructs.add("a search across lines");
  }
  if (!unicode && !ends && !starts) return { constructs: [] };
  return {
    sensitive: (line: string) => (unicode && hasNonAscii(line)) || (ends && hasLineEndOrWide(line)) || (starts && line.charCodeAt(0) === 0xfeff),
    constructs: [...constructs].sort(),
  };
}

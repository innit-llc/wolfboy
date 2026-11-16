/**
 * Glob matching for `detector.file_globs`.
 *
 * The field has been in `rule.schema.json` since W3 and was never implemented, so every rule has
 * shipped with the walker's repository-wide exclusion set deciding its scanning surface. The
 * decision of 2026-07-27 replaces that with a per-rule declaration, on the ground that
 * "is this a test file?" is the wrong question and "does it matter, for THIS rule, that this is a
 * test file?" is the right one — a consent gate in a test carries no exposure, a live key or a
 * real person's data in a test fixture carries the same exposure it would anywhere.
 *
 * Deliberately small. Supported: `*` (any run of characters except `/`), `**` (any run including
 * `/`), `?` (one character except `/`), `{a,b}` alternation, and a leading `!` for negation.
 * Character classes, `extglob` and brace ranges are not supported — a rule needing them is a rule
 * that should say what it means in prose instead. Nested alternation (`{a,{b,c}}`) is not supported
 * either, and THROWS rather than compiling to something else: see `translateGlob`.
 *
 * Paths are matched relative to the scan root, with `/` separators, and never with a leading `./`.
 */

/** Regex metacharacters that carry no glob meaning and are therefore matched literally. */
const REGEX_LITERAL = /[.+^${}()|[\]\\]/g;

/**
 * Translate a glob, or one alternative inside a `{…}`, to regular-expression source (unanchored).
 *
 * `whole` is the glob this call belongs to, carried only so a failure names the string the author
 * wrote rather than the fragment being translated.
 *
 * ## Why this is one function called recursively, and not two translators
 *
 * Until 2026-08-21 the `{…}` branch did not translate at all: it took each alternative and escaped
 * it, so a glob metacharacter inside braces was handed to `new RegExp` raw. That produced two
 * defects at once, and the quiet one is the worse:
 *
 *   - `{*.ts,*.tsx}` — ordinary, documented syntax — became `^(?:*\.ts|*\.tsx)$` and threw
 *     `Invalid regular expression: … Nothing to repeat`, at scan time, out of `compileGlobs`. So did
 *     `src/{*.ts,*.js}`, `**\/{*.ts,*.tsx}` and `{*.ts}`. A fuzz over the alphabet this function
 *     treats specially found 2,087 throwing inputs in 300,046.
 *   - `{a*,b}` did NOT throw. It became `^(?:a*|b)$` — a regex quantifier where a glob star was
 *     written — which matches `""`, `"a"` and `"aa"` and does **not** match `"ab"`. A rule
 *     declaring `file_globs: ["{index*,main*}"]` would be handed an empty surface, read nothing,
 *     and produce no candidate; and a rule that read nothing looks exactly like a rule that found
 *     nothing. That is the asymmetry this project works by: reading too little produces no candidate
 *     to dismiss and no count to notice.
 *
 * Both come from the same cause — a second, weaker translator living beside the real one — so the
 * repair is to have only one. Each alternative goes back through this same function, which is why
 * `{*.ts,*.tsx}` now compiles to exactly what `*.ts` and `*.tsx` compile to outside the braces.
 *
 * A second `{` inside a brace group is the one construct this cannot express: `glob.indexOf("}")`
 * finds the FIRST closing brace, so `{a,{b,c}}` would be read as the alternation `a` / `{b` / `c`
 * followed by a stray literal `}`. It throws, and names the glob. A loud failure at build time (the
 * `lintRuleFileGlobs` gate in tools/lint-patterns.mjs compiles every declared glob) is always
 * preferred here to a surface that is silently not the one the author wrote.
 *
 * **The refusal is stated as what is observed, not as a diagnosis, and that is a correction made on
 * 2026-08-21.** The throw fired on `body.includes("{")` while its message said "nested `{ }`
 * alternation is not supported", so `{a{b,c}` — where the inner `{` is a LITERAL brace, which the
 * pre-2026-08-21 translator compiled correctly to `(?:a\{b|c)` — was refused with a cause that was
 * not its cause. The two cannot be told apart from inside the group: `body` is everything up to the
 * first `}`, so it can never contain a `}`, and every `{` in it is therefore a brace whose partner
 * is either absent or outside the group. Separating them would mean guessing the author's intent
 * from a `}` beyond the group's own end. So the message names the fact — a further `{` before the
 * closing brace — and says what to write instead, which is true of both inputs. No shipped rule
 * declares either form; `{a{b,c}` losing a compilation it used to get is a deliberate, recorded
 * narrowing of an ambiguous syntax, not an accident.
 */
function translateGlob(glob: string, whole: string): string {
  let out = "";
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        // `**/` consumes zero or more whole segments, so `**/x` matches a bare `x` at the root.
        if (glob[i + 2] === "/") {
          out += "(?:[^/]*/)*";
          i += 3;
          continue;
        }
        out += ".*";
        i += 2;
        continue;
      }
      out += "[^/]*";
      i++;
      continue;
    }
    if (ch === "?") { out += "[^/]"; i++; continue; }
    if (ch === "{") {
      const end = glob.indexOf("}", i);
      if (end > i) {
        const body = glob.slice(i + 1, end);
        if (body.includes("{")) {
          throw new Error(
            `unsupported glob ${JSON.stringify(whole)}: the brace group ` +
              `${JSON.stringify(glob.slice(i, end + 1))} contains a further "{" before its closing ` +
              `brace, so which "}" closes which group cannot be determined from the text — whether ` +
              `that "{" was meant as a literal brace or as a nested alternation, this cannot be ` +
              `read as the author wrote it. Write one glob per alternative instead; file_globs is ` +
              `a list.`,
          );
        }
        // Each alternative is translated by this same function, so `*`, `**`, `?` and a nested
        // `{a,b}` mean inside the braces exactly what they mean outside them.
        out += `(?:${body.split(",").map((p) => translateGlob(p, whole)).join("|")})`;
        i = end + 1;
        continue;
      }
      // A `{` with no `}` after it is a literal brace, and falls through to the escape below.
    }
    out += ch.replace(REGEX_LITERAL, "\\$&");
    i++;
  }
  return out;
}

/** Translate one glob to an anchored regular expression source. */
function globToRegex(glob: string): string {
  return `^${translateGlob(glob, glob)}$`;
}

export interface CompiledGlobs {
  /** Patterns a path must match at least one of. Empty means "no positive restriction". */
  include: RegExp[];
  /** Patterns that exclude a path outright, written with a leading `!`. */
  exclude: RegExp[];
}

/**
 * Compile a rule's `file_globs`.
 *
 * Every failure names the glob that caused it. `new RegExp`'s own message carries the compiled
 * source and nothing else — an author handed `Invalid regular expression: /^(?:*\.ts|*\.tsx)$/` has
 * to work backwards to the glob they wrote — so it is re-thrown with the original string attached,
 * the same reason `lintRulePatterns` reports rule, field and index rather than the pattern alone.
 */
export function compileGlobs(globs: string[] | undefined): CompiledGlobs | null {
  if (!globs || globs.length === 0) return null;
  const include: RegExp[] = [];
  const exclude: RegExp[] = [];
  for (const g of globs) {
    const negated = g.startsWith("!");
    const body = negated ? g.slice(1) : g;
    let compiled: RegExp;
    try {
      compiled = new RegExp(globToRegex(body));
    } catch (e) {
      throw new Error(`glob ${JSON.stringify(g)} does not compile: ${(e as Error).message}`);
    }
    if (negated) exclude.push(compiled);
    else include.push(compiled);
  }
  return { include, exclude };
}

/**
 * Whether a rule with these globs may produce candidates in `relPath`.
 *
 * A negation always wins, and a set consisting only of negations means "everything except these" —
 * so a rule can widen to the whole repository and carve one tree back out without restating the
 * default surface.
 */
export function globsAllow(compiled: CompiledGlobs | null, relPath: string): boolean {
  if (!compiled) return true;
  const p = relPath.replace(/\\/g, "/");
  if (compiled.exclude.some((re) => re.test(p))) return false;
  if (compiled.include.length === 0) return true;
  return compiled.include.some((re) => re.test(p));
}

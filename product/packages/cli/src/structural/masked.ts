/**
 * Host-HTML languages: a template syntax wrapped around angle-bracket markup.
 *
 * The template regions are blanked and the remainder is parsed as HTML. Blanking preserves byte
 * offsets and newlines, so every reported line number is the line the element is actually written
 * on. Two fills are used and the difference matters for the icon-only-control check: a region that
 * RENDERS TEXT is filled with a non-space marker, because a control named by `{{ label }}` is named;
 * a region that renders nothing is filled with spaces.
 *
 * Where the region boundaries come from a grammar (ERB, Blade) the masking is structural — see
 * `langs/embedded.ts`. Where they come from reading the text (Mustache, Handlebars, Liquid, Twig,
 * Markdown fences) it is lexical, and this file is the whole of that lexical scanner. Whether those
 * languages should be read at all by a design that otherwise avoids lexical scanning is an open
 * question the integration design leaves to the owner (§13.6); until it is answered, the scanner has
 * to be right, which is what the rewrite below is.
 *
 * BLADE IS PARTLY IN BOTH CAMPS, AND `rawPhpRegions` BELOW IS WHY. Blade is read structurally, but a
 * raw `<?php … ?>` or `<?= … ?>` block inside a `.blade.php` file has NO NODE in the Blade grammar —
 * the whole file comes back as one `text` node — so there is no parse to take those boundaries from
 * and that one construct has to be scanned for. It is written here rather than inside `parseBlade`
 * so that this file remains the honest inventory of every place the reading is lexical.
 *
 * WHY IT IS A SCANNER AND NOT A SET OF REGULAR EXPRESSIONS. The prototype applied five independent
 * non-greedy expressions to the whole file and unioned their matches. On the rule's own fixture
 * `ok-example-context.mustache` that reads the file wrongly: the file is one `{{! … }}` block comment
 * whose body contains the characters `{{! }}` while explaining what a block comment is, so
 * `\{\{![\s\S]*?\}\}` closed on line 12 and the JSON example context below it — which holds markup
 * inside string values — was parsed as markup. A left-to-right scanner cannot make that mistake:
 * regions are disjoint by construction, and a `{{` inside a comment body opens a nested tag that has
 * to close before the comment can.
 *
 * The failure direction is chosen deliberately. An UNTERMINATED construct masks nothing and the scan
 * continues past it: under-masking produces candidates a reader can dismiss, over-masking produces
 * silence nobody can see.
 */

const MARK = String.fromCharCode(1);

export interface MaskRegion {
  start: number;
  end: number;
  fill: string;
}

/**
 * Replace each region with its fill, code unit for code unit, leaving newlines in place.
 *
 * THE BUFFER IS INDEXED IN UTF-16 CODE UNITS BECAUSE EVERY REGION OFFSET IS ONE. The lexical scanner
 * below gets its offsets from `String.prototype.indexOf` and `.length`; `langs/embedded.ts` gets them
 * from tree-sitter's `startIndex`/`endIndex`, which web-tree-sitter reports in UTF-16 code units for
 * a string it was handed as a string. `Array.from` splits by CODE POINT instead, and the two agree
 * only in a file with no astral character in it. They disagreed in 2,281 of the 60,320
 * masked-language files of the corpus (3.8%, counted over every file matching this module's
 * extensions), where one emoji before a region shifted the mask one position per astral character
 * and the overrun blanked real markup on a LATER line — the `<` of an `<img>`, so the file produced
 * no structural finding and still reported `outcome=parsed`. That is the over-masking this file's
 * header calls "silence nobody can see", and nothing counted it.
 * Found by independent verification, 2026-08-11;
 * a check is the gate that now fails on it.
 *
 * A fill replaces each code unit of an astral character separately, so the two halves of a surrogate
 * pair inside a region become two fill characters and the length is preserved exactly — which is what
 * the offsets that follow depend on.
 */
export function blank(source: string, regions: MaskRegion[]): string {
  const buf = source.split("");
  for (const { start, end, fill } of regions) {
    for (let i = start; i < end && i < buf.length; i++) {
      if (buf[i] !== "\n" && buf[i] !== "\r") buf[i] = fill;
    }
  }
  return buf.join("");
}

/** Index just past the next occurrence of `needle`, or -1. */
function endOf(source: string, needle: string, from: number): number {
  const at = source.indexOf(needle, from);
  return at < 0 ? -1 : at + needle.length;
}

/**
 * Where a `{{! … }}` comment closes.
 *
 * The body may contain further `{{ … }}` tags — a template that documents its own syntax does
 * exactly that — and such a tag is skipped whole, so the comment closes on the first `}}` that is
 * not part of one. A comment that never closes returns -1 and is left unmasked.
 */
function commentEnd(source: string, open: number): number {
  let j = open + 3;
  const n = source.length;
  while (j < n) {
    if (source.startsWith("}}", j)) return j + 2;
    if (source.startsWith("{{", j)) {
      const nested = endOf(source, "}}", j + 2);
      if (nested < 0) return -1;
      j = nested;
      continue;
    }
    j++;
  }
  return -1;
}

/**
 * Mustache, Handlebars, Liquid, Twig. Comments, block openers, block closers and partials render
 * nothing; interpolations render text.
 *
 * The classification of each tag kind is the prototype's, unchanged, so that a difference in what
 * this reads is a difference in where regions START AND END and not in what they are taken to mean.
 */
export function maskTemplateTags(source: string): string {
  const regions: MaskRegion[] = [];
  const n = source.length;
  let i = 0;
  while (i < n) {
    if (source[i] !== "{") {
      i++;
      continue;
    }
    let end = -1;
    let fill = " ";
    if (source.startsWith("{{!--", i)) {
      end = endOf(source, "--}}", i + 5);
    } else if (source.startsWith("{{!", i)) {
      end = commentEnd(source, i);
    } else if (source.startsWith("{{{", i)) {
      end = endOf(source, "}}}", i + 3);
      fill = MARK;
    } else if (source.startsWith("{{", i)) {
      const kind = source[i + 2];
      fill = kind === "#" || kind === "/" || kind === ">" ? " " : MARK;
      end = endOf(source, "}}", i + 2);
    } else if (source.startsWith("{%", i)) {
      end = endOf(source, "%}", i + 2);
    } else if (source.startsWith("{#", i)) {
      end = endOf(source, "#}", i + 2);
    } else {
      i++;
      continue;
    }
    if (end < 0) {
      // Unterminated. Mask nothing and keep going: the remainder of the file is read as markup,
      // which over-reports rather than falling silent.
      i += 2;
      continue;
    }
    regions.push({ start: i, end, fill });
    i = end;
  }
  return blank(source, regions);
}

/**
 * Raw PHP blocks in a Blade template: `<?php … ?>` and `<?= … ?>`.
 *
 * WHY THIS IS LEXICAL, WHICH THE REST OF THE BLADE READING IS NOT. `tree-sitter-blade@0.11.0` models
 * Blade's own constructs and nothing else, and a raw PHP block is not one of them. Five shapes were
 * parsed and their trees dumped — a multi-line `<?php … ?>` block, `<?= $title ?>`, an inline
 * `<?php echo $title; ?>`, an unterminated `<?php`, and a block with `?>` inside a PHP string — and
 * every one came back as a SINGLE `text` node covering the whole file. There is no node to take a
 * boundary from, so the delimiters are scanned for. That is the whole reason this function is
 * lexical, and it is stated rather than left to be inferred from the code.
 *
 * WHAT IT COST TO NOT HAVE IT. One tree's Blade search view opens with a raw
 * `<?php … ?>` block. The HTML grammar read the surviving `<?php` as a bogus comment and error-
 * recovered over everything after it, so the file returned an EMPTY DOCUMENT while reporting
 * `outcome=parsed` — the same silence as the directive-parameter leak, in the same pass, on the same
 * corpus. With this mask the file reads as 17 elements, and no `.blade.php` file in the corpus loses
 * a document it has any more: of the 52 that still read as zero elements, every one contains no `<`
 * followed by a letter anywhere.
 *
 * THE CALLER MUST HAND THIS THE STRUCTURALLY MASKED BUFFER, not the original source, and
 * `parseBlade` does. A `<?php` written inside a Blade directive's argument or inside `{{ … }}` has
 * already been replaced by then, so it cannot open a region here and the scan cannot run out of a
 * Blade construct into real markup. Offsets are unaffected: `blank` preserves length exactly.
 *
 * THE FILLS FOLLOW `parseErb` AND `php_statement`, AND THE CORPUS DID NOT DECIDE THEM. `<?= … ?>`
 * echoes and takes MARK, which is what Blade's own `{{ … }}` already takes and what ERB's `<%= … %>`
 * takes; `<?php … ?>` takes a space, as ERB's `<% … %>` does, and the delimiter is the only evidence
 * available — an echo inside a `<?php` block is invisible to it, exactly as it is in ERB. All three
 * candidate fills (space everywhere, MARK everywhere, this split) were measured over the corpus's
 * 1,030 `.blade.php` files and produced the IDENTICAL 259 findings, losing and gaining nothing, so
 * the choice rests on consistency with what already ships rather than on evidence.
 *
 * TWO KNOWN LIMITS, both chosen to under-mask rather than over-mask. An UNTERMINATED `<?php` masks
 * NOTHING and the scan continues past the opener, per this file's header. A region closes on the
 * FIRST `?>`, so a `?>` inside a PHP string ends it early: in
 * a made-up line `<?= 'a ?> b' . $c ?>` the region closes at the `?>` inside the string and leaves
 * `' . $c ?>` in the document as text. Both leave text a reader can dismiss instead of blanking markup nobody
 * would ever see.
 */
export function rawPhpRegions(masked: string): MaskRegion[] {
  const regions: MaskRegion[] = [];
  // `<?php` must not be followed by an identifier character; `<?=` is the short echo tag. The bare
  // `<?` short open tag is deliberately NOT matched: it is off by default in PHP and it would also
  // swallow an XML declaration. No `.blade.php` file in the corpus uses one.
  const open = /<\?(php(?![A-Za-z0-9_])|=)/gi;
  for (let m = open.exec(masked); m; m = open.exec(masked)) {
    const start = m.index;
    const close = masked.indexOf("?>", start + m[0].length);
    if (close < 0) {
      open.lastIndex = start + 2;
      continue;
    }
    const end = close + 2;
    regions.push({ start, end, fill: m[1] === "=" ? MARK : " " });
    open.lastIndex = end;
  }
  return regions;
}

/**
 * Markdown: fenced and indented code blocks are examples, not markup.
 *
 * Block state is what a parse is, and it is what the line-based reading does not have: the rule's
 * own target-correctness record declined this case for exactly that reason.
 */
export function maskMarkdown(source: string): string {
  const lines = source.split("\n");
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const open = /^\s{0,3}(```+|~~~+)/.exec(line);
    if (fence) {
      out.push(" ".repeat(line.length));
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length) fence = null;
      continue;
    }
    if (open) {
      fence = open[1];
      out.push(" ".repeat(line.length));
      continue;
    }
    out.push(line);
  }
  // Inline code spans, on the lines that survived.
  const joined = out.join("\n");
  const regions: MaskRegion[] = [];
  const inline = /`[^`\n]*`/g;
  for (let m = inline.exec(joined); m; m = inline.exec(joined)) {
    regions.push({ start: m.index, end: m.index + m[0].length, fill: " " });
  }
  return blank(joined, regions);
}

/**
 * Everything OUTSIDE the given ranges, blanked. The ranges must be disjoint and in order, which is
 * what both callers produce.
 *
 * Written once and called twice on purpose: `langs/heex.ts` takes its sigil ranges from a parse of
 * the Elixir grammar and `maskOutsideHeexSigils` below takes the same kind of ranges from reading
 * the text, and the two must agree about what "outside" means down to the character. Two copies of
 * this loop would be two chances to disagree.
 */
export function maskOutside(source: string, keep: { start: number; end: number }[]): string {
  const regions: MaskRegion[] = [];
  let at = 0;
  for (const b of keep) {
    if (b.start > at) regions.push({ start: at, end: b.start, fill: " " });
    at = Math.max(at, b.end);
  }
  if (at < source.length) regions.push({ start: at, end: source.length, fill: " " });
  return blank(source, regions);
}

/**
 * The HEEx template regions of an Elixir source file, as a buffer in which everything that is NOT
 * one of them has been blanked. `null` when the file carries no `~H` sigil at all, which is the
 * ordinary case for a `.ex` file and lets the caller skip the parse rather than parse whitespace.
 *
 * **THIS IS NO LONGER THE PATH A SCAN TAKES, AND IT IS KEPT DELIBERATELY.** Until 2026-08-28 it was:
 * `tree-sitter-elixir` is Apache-2.0, a check allowed MIT only, and that gate
 * states in its own words that vendoring a licence off the list is a decision for a person, not a tool,
 * so the boundaries could not come from a parse and the delimiters were scanned for instead. THE
 * OWNER PERMITTED Apache-2.0 FOR VENDORED GRAMMARS ON 2026-08-28, the grammar is vendored, and
 * `langs/heex.ts`'s `parseElixir` now takes the ranges from `sigil` nodes. What this function is now
 * is the documented fallback: the reading that remains possible with no Elixir grammar at all, kept
 * whole, kept exported and kept under a check PART 7, so that withdrawing
 * the grammar — a decision reversed, an upstream that disappears, a licence that changes —
 * restores a working reading by changing one call rather than by rewriting a scanner from memory.
 *
 * **IT IS NOT WIRED IN AS A SILENT SUBSTITUTE FOR A MISSING GRAMMAR, AND THAT IS THE POINT.**
 * `parse.ts`'s third rule is that a missing grammar falls back to the line reading AND IS COUNTED,
 * "because a degrade nobody can count is a degrade nobody audits". Quietly scanning for the
 * delimiters when the Elixir grammar fails to load would leave `structural_grammar_unavailable` at
 * zero while the reading changed underneath it, which is exactly the silence this module is written
 * against. So `parseElixir` lets the error through, the file is counted, and the summary line names
 * the language.
 *
 * WHY IT WAS LEXICAL, WHICH IS STILL WHY IT READS AS IT DOES. There was no node to take a boundary
 * from — the same situation as `rawPhpRegions` above, and the same answer.
 *
 * WHAT A SIGIL LOOKS LIKE. `~H` followed by one of Elixir's sigil delimiters: the heredoc fences
 * `"""` and `'''`, the paired `(`/`[`/`{`/`<`, or the self-closing `"`/`'`/`|`/`/`. `~H` is an
 * UPPERCASE sigil, and Elixir performs no escaping inside one, so a backslash is an ordinary
 * character here and is deliberately not treated as an escape: doing so would run past the real
 * terminator and blank markup that follows it.
 *
 * THE FAILURE DIRECTION IS THIS FILE'S, unchanged. An unterminated sigil contributes NO region and
 * the rest of the file stays blanked, which is the one place this scanner errs towards silence — but
 * the silence is bounded by the sigil, not by the file, because the scan resumes after the opener
 * and later sigils are still found. A `~H` written inside a string or a `#` comment opens a region
 * that is not markup; what that produces is Elixir code read as text, which a reader can dismiss.
 * Both are the asymmetry the project's rules state: candidates a reader can dismiss over silence nobody sees.
 *
 * POSITIONS SURVIVE EXACTLY, because nothing is moved: `blank` replaces code units in place and
 * leaves every newline, so a line reported by the parser is the line the element is written on.
 */
export function maskOutsideHeexSigils(source: string): string | null {
  const bodies = heexSigilBodies(source);
  if (bodies.length === 0) return null;
  return maskOutside(source, bodies);
}

/** The delimiter that closes each sigil opener. A self-closing delimiter closes with itself. */
const SIGIL_CLOSE: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "<": ">",
  '"': '"',
  "'": "'",
  "|": "|",
  "/": "/",
};

/** The body ranges of every `~H` sigil in an Elixir source file, in order and disjoint. */
function heexSigilBodies(source: string): { start: number; end: number }[] {
  const bodies: { start: number; end: number }[] = [];
  let i = 0;
  for (;;) {
    const at = source.indexOf("~H", i);
    if (at < 0) return bodies;
    const after = at + 2;
    const fence = source.startsWith('"""', after) ? '"""' : source.startsWith("'''", after) ? "'''" : null;
    if (fence !== null) {
      // A heredoc body starts on the line AFTER the opening fence and ends at the start of the line
      // carrying the closing one, so neither delimiter line is inside the region.
      const nl = source.indexOf("\n", after + 3);
      const close = nl < 0 ? -1 : closingFence(source, nl + 1, fence);
      if (close < 0) {
        i = after;
        continue;
      }
      bodies.push({ start: nl + 1, end: close });
      i = close + fence.length;
      continue;
    }
    const open = source[after];
    const shut = open === undefined ? undefined : SIGIL_CLOSE[open];
    if (shut === undefined) {
      // Not a sigil: `~H` followed by anything else is not this construct.
      i = after;
      continue;
    }
    const end = closingDelimiter(source, after + 1, open, shut);
    if (end < 0) {
      i = after;
      continue;
    }
    bodies.push({ start: after + 1, end });
    i = end + 1;
  }
}

/** Index of the start of the line whose only content before `fence` is whitespace, or -1. */
function closingFence(source: string, from: number, fence: string): number {
  let lineStart = from;
  const n = source.length;
  while (lineStart < n) {
    let j = lineStart;
    while (j < n && (source[j] === " " || source[j] === "\t")) j++;
    if (source.startsWith(fence, j)) return lineStart;
    const nl = source.indexOf("\n", lineStart);
    if (nl < 0) return -1;
    lineStart = nl + 1;
  }
  return -1;
}

/**
 * Index of the delimiter that closes a single-line sigil, or -1. A paired delimiter nests, which is
 * what Elixir does; a self-closing one cannot, so the first occurrence closes it.
 */
function closingDelimiter(source: string, from: number, open: string, shut: string): number {
  if (open === shut) {
    const at = source.indexOf(shut, from);
    return at;
  }
  let depth = 1;
  for (let i = from; i < source.length; i++) {
    const ch = source[i];
    if (ch === open) depth++;
    else if (ch === shut && --depth === 0) return i;
  }
  return -1;
}

/**
 * `<!DOCTYPE …>` declarations, blanked.
 *
 * WHY THIS EXISTS AND WHY IT IS HERE. `tree-sitter-heex@0.9.0` spells the doctype as
 * `seq("<!", "DOCTYPE", "html", ">")` — the HTML5 form and nothing else. An XHTML declaration such as
 * `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "…dtd">` therefore does not parse, and
 * the failure is not local: in one tree's sign-in `.html.heex` template
 * the ROOT NODE ITSELF came back as `ERROR` and the file — a complete document with an `<html>`, a
 * `<form>`, three components and a `<button>` — read as ZERO elements while reporting
 * `outcome=parsed`. That is the D1/D10/Blade class exactly: less of the file than the file holds,
 * with no counter moving.
 *
 * A DOCTYPE IS NOT MARKUP AND NOTHING READS IT. `langs/heex.ts` and `langs/html.ts` both drop the
 * `doctype` node, so blanking every declaration — the HTML5 one included — produces the identical IR
 * for the files that already parsed and recovers the ones that did not. Blanking rather than deleting,
 * so offsets and newlines survive and a reported line is still a line of the file.
 *
 * The declaration closes on the first `>` that is not inside a quoted string, which is what makes the
 * two-line XHTML form work: its system identifier is quoted and contains no `>`. An internal subset
 * (`<!DOCTYPE x [ … ]>`) can hold one and would close the region early; that leaves text behind for a
 * reader to dismiss, which is this file's declared failure direction, and no HEEx template in the
 * corpus has one.
 */
export function maskDoctypeDeclarations(source: string): string {
  const regions: MaskRegion[] = [];
  const open = /<!\s*doctype/gi;
  for (let m = open.exec(source); m; m = open.exec(source)) {
    let quote: string | null = null;
    let end = -1;
    for (let j = m.index + 2; j < source.length; j++) {
      const ch = source[j];
      if (quote !== null) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === ">") {
        end = j;
        break;
      }
    }
    if (end < 0) continue;
    regions.push({ start: m.index, end: end + 1, fill: " " });
    open.lastIndex = end;
  }
  return regions.length === 0 ? source : blank(source, regions);
}

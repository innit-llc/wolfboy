/**
 * Document text extraction — turning a declaration file into quotable lines.
 *
 * Every finding this pillar produces quotes the user's own document and cites a line number, so
 * the extractor has one hard requirement above all others: **a line number in the output must be
 * the line number in the file.** The technique is the one `strip-comments.ts` already uses for
 * guard evaluation, with the polarity reversed — every dropped character becomes a space and every
 * newline survives, so nothing shifts.
 *
 * Why this module exists at all: the eight legal documents of the owner's application are React
 * components. The text is JSX children and string literals inside `.tsx` files, not markdown, not
 * HTML. An extractor keyed on `*.md` would have found nothing at all, and this is likely the normal
 * case for anything built on Next.js. The trial did this by hand with a throwaway script; that is
 * not shippable, because the throwaway script had no line mapping, no entity handling, and would
 * happily have quoted a `className` back at the user as if it were their privacy policy.
 *
 * Four traps, all of them met in the real documents:
 *
 * - **`className` and every other attribute must not become text.** `class="text-sm text-gray-600"`
 *   is not something anyone published.
 * - **`{" "}`** — the JSX whitespace joiner — is a real space between two words and must survive,
 *   which is why expression containers keep their string literals rather than being blanked whole.
 * - **Character entities.** `&quot;`, `&apos;`, `&amp;` and friends appear in the source and must
 *   be decoded, or a search for the quoted phrase fails on the user's own document.
 * - **U+00A0.** The no-break space is indistinguishable from a space on screen and is not one to a
 *   regular expression. It is normalised here for the same reason the OJ text is normalised before
 *   searching: otherwise a quotation that looks right cannot be found.
 *
 * This is a state machine, not a parser. Dynamic JSX (`items.map(…)`) is handled structurally —
 * nested elements inside an expression are followed — but a generated document is outside what
 * this can promise, and the containment for that is the milestone-1 run against the eight real
 * documents rather than a claim made here.
 *
 * ## THE LIMITATION THE INVARIANT BUYS, MEASURED ON A REAL PAGE, AND WHY IT STANDS
 *
 * The invariant above has a price and it is paid by HTML. A server-rendered marketing page has no
 * reason to put a newline between its block elements, so once every tag is blanked to spaces the
 * whole rendered body arrives on ONE physical source line. Measured on `https://bitwarden.com/privacy/`
 * (pillar-2 run 4, 2026-09-03): 498,868 bytes, 93 newlines in the whole file, and the entire policy
 * body — 114 `<p>` tags — extracted as a single line of 33,881 characters. The extraction was
 * CONTENT-CORRECT (it is the policy, not the page furniture: the 282 KB Inertia `data-page`
 * hydration attribute is correctly dropped by `attributeIsContent`'s `data-` rule) and
 * CITATION-USELESS: every quotation of it cites line 87, and a line number that names the whole
 * document names nothing.
 *
 * **The obvious repair — split an over-length line at rendered block boundaries (`</p><h2>` and
 * friends) — was assessed here and is not taken.** It is not cheap and it is not additive:
 * - Inserting a newline shifts every following line number, so it cannot be done at all.
 * - Spending one of a blanked tag's own spaces as the newline keeps the byte count and therefore
 *   keeps `buildDocumentCorpus`'s `line <= bytes` bound — but it silently REDEFINES what every line
 *   number this extractor has ever emitted means. Four frozen run records, every reconciliation
 *   fixture golden, and every citation in them are addressed in the old numbering; the same document
 *   would answer to two different line numbers depending on which build read it, with nothing in the
 *   output saying which. That is a replacement of the invariant, not an addition beside it, and it is
 *   a granularity decision rather than an implementation detail.
 * - It would also be format-asymmetric: markdown and JSX documents already carry their own newlines,
 *   so only HTML would move, and "the line number is the file's line number" would become a sentence
 *   that is true of three extractors and false of one.
 *
 * **What is done instead**, so the limitation costs a reader as little as possible:
 * - the runtime names the shape — `reconcile`'s one-enormous-line warning, at
 *   `LINE_LOCATES_NOTHING_CHARS` below, which is exported from here rather than written twice;
 * - the skill tells the agent to anchor such a citation on a short, distinctive, contiguous WORD RUN
 *   and to say in its reasoning that the line number does not pinpoint the passage
 *   (`declaration-reconcile/SKILL.md` step 3a-ter), which run 4 practised in all five batches that
 *   quoted the page;
 * - `reconcile-verify` REFUSES to write a tool-extracted quotation out of a line this long, because
 *   a location-only citation there would put the whole document into an evidence field.
 * A real line-remapping table, with the old numbering carried beside the new one, is the shape a
 * future proposal would take. It is not taken here.
 */

import { createHash } from "node:crypto";
import type { ExtractedDoc, ExtractedLine, ExtractorKind } from "wolfboy-schemas";

export type { ExtractedDoc, ExtractedLine, ExtractorKind };

/**
 * The length at which a line stops locating anything inside itself.
 *
 * **One number, one place, two readers — and the two readers apply it to different spans, which is
 * said here rather than glossed** (never keep a second copy of anything two places must
 * agree on — export it and import it). `reconcile.ts` prints the one-enormous-line warning when a
 * document's LONGEST SINGLE LINE reaches this, which is a statement to a person about citation
 * precision. `reconcile-verify.ts` refuses to WRITE a tool-extracted quotation whose WHOLE SLICE
 * reaches it, which is a bound on how much text the tool may put into one evidence entry. The mark is
 * one number because the underlying quantity is one — how much text a single line reference can
 * honestly stand for — but the predicates are not identical, and the refusal used to tell a reader
 * that the warning had printed when for a multi-line range it had not (independent verification,
 * 2026-09-03, L1). It lives here because it is a fact about what this extractor produces, and the
 * paragraph above is where that fact is recorded.
 *
 * Measured rather than chosen: the two real pages that produced the shape carried single lines of
 * 249,424 and 33,881 characters, and the longest single line in any document of the reconciliation
 * fixture corpus is three orders of magnitude below this.
 */
export const LINE_LOCATES_NOTHING_CHARS = 5000;

/** Replace a span with spaces, keeping newlines so line numbers do not shift. */
function blank(text: string, from: number, to: number): string {
  let out = "";
  for (let i = from; i < to; i++) out += text[i] === "\n" ? "\n" : " ";
  return out;
}

/**
 * Attributes whose value is never text a reader sees: styling, wiring, identifiers, handlers.
 *
 * Everything not on this list is kept, and that direction is deliberate. A component-driven
 * document puts its content in props — `<Section title="Article 6">`, `<Table rows={[…]} />` — so a
 * pass that drops every attribute in order to protect against `className` drops the document with
 * it. Measured on one real notice during the A1 measurement: four whole tables of recipients,
 * countries, transferred data and safeguards vanished, and three checklist verdicts were recorded
 * against the resulting hole rather than against the page. Keeping an occasional technical string
 * costs the reader one line; dropping a table of recipients costs them the finding.
 */
const PRESENTATIONAL_ATTRS = new Set([
  "class", "classname", "style", "id", "key", "ref", "href", "src", "srcset", "type", "role",
  "target", "rel", "method", "action", "width", "height", "size", "color", "bgcolor", "align",
  "tabindex", "htmlfor", "for", "loading", "decoding", "referrerpolicy", "crossorigin",
  "colspan", "rowspan", "scope", "dir", "lang", "charset", "property", "rev", "as", "xmlns",
]);

function attributeIsContent(name: string): boolean {
  const n = name.toLowerCase();
  if (n === "") return false;
  if (PRESENTATIONAL_ATTRS.has(n)) return false;
  if (n.startsWith("aria-") || n.startsWith("data-") || n.startsWith("on")) return false;
  return true;
}

/**
 * An address written as a link is the document's content, not its markup.
 *
 * `href` is presentational — a URL is not prose — and that is right for a link to another page. It
 * is wrong for `mailto:` and `tel:`, where the href *is* the thing the page is telling the reader.
 * Found 2026-07-28 by adversarial verification of the DSA contact-point checklist, which asks six
 * times whether a contact address is published: written the way real pages write it,
 * `<a href="mailto:dsa@x.example">our DSA contact point</a>` extracted as "our DSA contact point"
 * and every one of those items would have been answered "the document is silent".
 */
function valueIsContact(value: string): boolean {
  return /^\s*(mailto:|tel:|sms:)/i.test(value);
}

/**
 * Does an attribute value read like prose — like something a person published, rather than
 * configuration that happens to sit in a content-named attribute?
 *
 * Added 2026-07-28 after the second verification round measured what keeping every content-named
 * attribute actually did on 315 real documents: 803 new extracted lines, and the ones that were
 * not prose were `name="viewport"`, `value="<csrf token>"`, `viewBox="0 0 24 24"`, SVG path data,
 * and the styling shorthands (`bg`, `p`, `gap`, `colorScheme`, `animation*`) that no denylist can
 * enumerate. Quoting a CSRF token back at the user as a line of their published privacy policy is
 * the exact failure the attribute handling exists to prevent.
 *
 * The test is for the *shape of prose*, not a list of attribute names, because the names are the
 * losing game in both directions: two or more consecutive words of letters, and no `=` (an equals
 * sign inside a value marks configuration — `width=device-width, initial-scale=1`). The measured
 * cost is single-word values: `title="Imprint"` and `tone="plain"` are dropped again. A heading
 * that matters is repeated in the document's own text; a token like "plain" never was text.
 */
function valueIsProse(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  // An equals sign inside a value marks configuration: `width=device-width, initial-scale=1`.
  if (v.includes("=")) return false;
  const letters = (v.match(/\p{L}/gu) ?? []).length;
  if (letters === 0) return false; // "0 0 24 24"
  // Path data and identifiers: more punctuation and digits than letters.
  if (letters * 2 < v.length) return false; // "M12 2L2 7l10 5 10-5-10-5z"
  // A long unbroken alphanumeric run is a token, not a word: a CSRF value, a hash, a build id.
  if (!/\s/.test(v) && v.length >= 16 && /\d/.test(v)) return false;
  // camelCase is an identifier convention, never prose: `csrfToken`, `defaultValue`, `colorScheme`.
  if (!/\s/.test(v) && /\p{Ll}\p{Lu}/u.test(v)) return false;
  return true;
}

/**
 * Consume one JSX tag starting at `text[i] === "<"`.
 *
 * Attribute values may be quoted or `{expressions}`, and an expression may contain strings that
 * contain `>` — so the scan tracks quotes and brace depth rather than looking for the next `>`.
 * Returns the text carried by content-bearing attributes; everything else in the tag is dropped.
 */
function consumeTag(
  text: string,
  i: number,
): { end: number; closing: boolean; selfClosing: boolean; attributes: { text: string; lineOffset: number }[] } {
  let j = i + 1;
  const closing = text[j] === "/";
  if (closing) j++;

  let quote: string | null = null;
  // Each kept attribute remembers which line of the tag it started on. A component call spans
  // several lines and its props are the document's sentences; emitting them all on the tag's
  // opening line would make every quotation from such a page cite the wrong line. Measured on a
  // seed whose notice is built entirely from props: the claim sat on line 106 and was reported at
  // 103, the line the `<LegalSection` opens on.
  const kept: { text: string; lineOffset: number }[] = [];
  let attrName = "";
  let pendingName = "";
  let quoteStart = 0;
  let braces = 0;
  const lineOffsetAt = (pos: number) => (text.slice(i, pos).match(/\n/g) ?? []).length;
  while (j < text.length) {
    const ch = text[j];
    if (quote) {
      if (ch === "\\") { j += 2; continue; }
      if (ch === quote) {
        const raw = text.slice(quoteStart, j);
        // The prose filter is NOT applied here, in the JSX path — only in the markup path
        // (blankTagKeepingContent). The measured noise (viewport, CSRF tokens, SVG paths) was all
        // in html/md/mdx documents; a JSX component document legitimately carries single-word
        // props, and filtering them here re-lost the recipients table's country column
        // (`country="Sweden"`) that the attribute handling exists to keep. Since the third
        // verification round the markup-path filter keeps single prose words too, so the two paths
        // now differ only on values the filter calls configuration.
        if (attributeIsContent(attrName) || valueIsContact(raw)) {
          const body = raw.replace(/\s+/g, " ").trim();
          if (body) kept.push({ text: body, lineOffset: lineOffsetAt(quoteStart) });
        }
        quote = null;
      }
      j++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; quoteStart = j + 1; j++; continue; }
    if (ch === "{") { braces++; j++; continue; }
    if (ch === "}") { braces = Math.max(0, braces - 1); j++; continue; }
    if (ch === ">" && braces === 0) {
      const selfClosing = text[j - 1] === "/";
      return { end: j + 1, closing, selfClosing, attributes: kept };
    }
    // Track the attribute name, so the next quoted run can be attributed to it.
    if (/[A-Za-z0-9_:.-]/.test(ch)) { pendingName += ch; j++; continue; }
    if (ch === "=") { attrName = pendingName; pendingName = ""; j++; continue; }
    if (/\s/.test(ch)) { pendingName = ""; j++; continue; }
    j++;
  }
  return { end: text.length, closing, selfClosing: false, attributes: kept };
}

/**
 * Consume a JSX expression container starting at `text[i] === "{"`, returning its inner source.
 *
 * Nesting, strings and template literals are tracked so that a `}` inside any of them does not
 * close the container.
 */
function consumeExpression(text: string, i: number): { end: number; inner: string } {
  let depth = 0;
  let quote: string | null = null;
  let j = i;
  while (j < text.length) {
    const ch = text[j];
    if (quote) {
      if (ch === "\\") { j += 2; continue; }
      if (ch === quote) quote = null;
      j++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; j++; continue; }
    if (ch === "{") { depth++; j++; continue; }
    if (ch === "}") {
      depth--;
      if (depth === 0) return { end: j + 1, inner: text.slice(i + 1, j) };
      j++;
      continue;
    }
    j++;
  }
  return { end: text.length, inner: text.slice(i + 1) };
}

/**
 * The marker written where a value renders that this pass cannot resolve.
 *
 * `<td>{SITE.company.legalName}</td>` is the controller's name on the published page and nothing at
 * all in the source. Blanking it produced a document whose contact block was a list of empty
 * labels, and a scorer reading that document recorded the controller's identity as only partly
 * given — a verdict about the extractor, not about the notice.
 *
 * **Silently producing nothing is the failure this whole product is organised against**, so the
 * expression is surfaced instead of dropped. It is deliberately not written as plain text: an agent
 * must not be able to quote `SITE.company.legalName` back to a user as if it were their published
 * words. What the marker says is "a value renders here and I could not follow it", which is true
 * and is something the reader can act on.
 *
 * Written without brackets of any kind, and that is not cosmetic. The first form was
 * `[unresolved value renders here: X]`, and a verifier reading the document through a tool that
 * renders markdown reported six such lines as **missing from the file** — a line consisting only of
 * a bracketed phrase can be swallowed on the way to the reader. A marker that disappears is worse
 * than no marker, because it restores the silent absence it was added to remove, and hides that it
 * has done so. Uppercase English inside a Japanese document is conspicuous and survives any
 * renderer.
 */
const UNRESOLVED_OPEN = "UNRESOLVED VALUE RENDERS HERE: ";
const UNRESOLVED_CLOSE = "";

/** Whether `text[i] === "<"` opens JSX rather than being a less-than.
 *
 * Decided by what precedes it: JSX only ever appears where an expression may start. `a < b` is
 * preceded by an identifier and is arithmetic; `return <div>` and `{cond ? <a/> : <b/>}` are
 * preceded by a keyword or an operator and are elements.
 */
function isJsxStart(text: string, i: number): boolean {
  if (text[i] !== "<") return false;
  const next = text[i + 1];
  if (!next || !/[A-Za-z_>]/.test(next)) return false;

  let j = i - 1;
  while (j >= 0 && /\s/.test(text[j])) j--;
  if (j < 0) return true;
  if ("(,={:?;&|}>[".includes(text[j])) return true;

  // `return <div>` — the only keyword form that matters in a component file.
  let k = j;
  while (k >= 0 && /[A-Za-z]/.test(text[k])) k--;
  return text.slice(k + 1, j + 1) === "return";
}

/**
 * Mask a `.tsx`/`.jsx` file down to the text a reader sees.
 *
 * Contexts are stacked rather than flagged, so an element nested inside an expression container
 * inside an element (the `{items.map(x => <li>{x}</li>)}` shape) unwinds correctly.
 */
function maskJsx(text: string): string {
  const stack: ("code" | "children" | "expr")[] = ["code"];
  let out = "";
  let i = 0;

  const push = (c: "children" | "expr") => stack.push(c);
  const pop = () => { if (stack.length > 1) stack.pop(); };

  while (i < text.length) {
    const ctx = stack[stack.length - 1];
    const ch = text[i];

    if (ctx === "children") {
      if (ch === "<") {
        const tag = consumeTag(text, i);
        // Each content-bearing attribute is emitted on the line it actually starts on, so a
        // quotation taken from a component-built document cites a line a reader can open.
        if (tag.attributes.length > 0) {
          const span = text.slice(i, tag.end);
          const spanLines = (span.match(/\n/g) ?? []).length;
          const buckets: string[] = Array.from({ length: spanLines + 1 }, () => "");
          for (const attr of tag.attributes) {
            const at = Math.min(attr.lineOffset, spanLines);
            buckets[at] = buckets[at] ? `${buckets[at]} ${attr.text}` : attr.text;
          }
          // A trailing space per bucket: the tag's own text and the text that follows it are
          // different sentences, and without a separator `href="mailto:a@b"` fused onto the link's
          // label as one unreadable token ("mailto:a@bour DSA contact point").
          out += buckets.map((b) => (b ? `${b} ` : b)).join("\n");
        } else {
          out += blank(text, i, tag.end);
        }
        i = tag.end;
        if (tag.closing) pop();
        else if (!tag.selfClosing) push("children");
        continue;
      }
      if (ch === "{") {
        const { end, inner } = consumeExpression(text, i);
        const newlines = "\n".repeat((text.slice(i, end).match(/\n/g) ?? []).length);
        const trimmed = inner.trim();
        const hasJsx = /<[A-Za-z_>/]/.test(inner);
        const hasString = /['"`]/.test(inner);
        const isComment = trimmed.startsWith("/*") || trimmed.startsWith("//");

        // An expression holding JSX or a string is processed character by character, as before:
        // its text is real text and its nested elements have to unwind properly.
        if (hasJsx || hasString) {
          out += " ";
          i++;
          push("expr");
          continue;
        }
        // Everything else renders a value this pass cannot follow. Say so rather than drop it.
        if (trimmed !== "" && !isComment) {
          out += UNRESOLVED_OPEN + trimmed.replace(/\s+/g, " ") + UNRESOLVED_CLOSE + newlines;
        } else {
          out += " " + newlines;
        }
        i = end;
        continue;
      }
      out += ch;
      i++;
      continue;
    }

    // "code" and "expr" differ only in how they end; both drop everything but string contents,
    // and both may open an element.
    if (ch === "/" && text[i + 1] === "/" && text[i - 1] !== ":") {
      let j = i;
      while (j < text.length && text[j] !== "\n") j++;
      out += blank(text, i, j);
      i = j;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const j = end === -1 ? text.length : end + 2;
      out += blank(text, i, j);
      i = j;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      // Inside an expression container the string is text the reader sees (`{" "}`, `{"—"}`),
      // so its contents are kept. In code it is a variable, a class name or an import path.
      const keep = ctx === "expr";
      const quote = ch;
      let j = i + 1;
      let body = "";
      while (j < text.length) {
        if (text[j] === "\\") { body += text[j + 1] === "\n" ? "\n" : "  "; j += 2; continue; }
        if (text[j] === quote) break;
        body += text[j] === "\n" ? "\n" : keep ? text[j] : " ";
        j++;
      }
      out += " " + body + (j < text.length ? " " : "");
      i = j + 1;
      continue;
    }
    if (isJsxStart(text, i)) {
      const tag = consumeTag(text, i);
      out += blank(text, i, tag.end);
      i = tag.end;
      if (!tag.selfClosing && !tag.closing) push("children");
      continue;
    }
    if (ctx === "expr") {
      if (ch === "{") { out += " "; i++; push("expr"); continue; }
      if (ch === "}") { out += " "; i++; pop(); continue; }
    }
    out += ch === "\n" ? "\n" : " ";
    i++;
  }

  return out;
}

/**
 * Blank one tag, but leave in place the characters that are the document's content.
 *
 * `maskMarkup` used to blank every tag whole, and the two document shapes that cost the most were
 * both found on 2026-07-28: a `mailto:` address written as a link, and an MDX page built out of
 * components — `<Callout title="Contact point for authorities" body="Write to dsa@…" />` — whose
 * entire prose lives in props and extracted as nothing at all. The JSX path already keeps
 * content-bearing props (that fix cost four tables of recipients when it was missing); markdown,
 * MDX and HTML went through this function instead and kept none.
 *
 * Offsets are preserved because the kept characters are restored *in their own positions* inside
 * the blanked span, so every line number downstream still points where it pointed.
 */
function blankTagKeepingContent(text: string, start: number, end: number): string {
  const tag = text.slice(start, end);
  const blanked = blank(text, start, end).split("");
  const attr = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*["'`]([^"'`]*)["'`]\s*\})/g;
  let m: RegExpExecArray | null;
  while ((m = attr.exec(tag)) !== null) {
    const value = m[2] ?? m[3] ?? m[4] ?? "";
    if (!value) continue;
    if (!(attributeIsContent(m[1]) && valueIsProse(value)) && !valueIsContact(value)) continue;
    const at = tag.indexOf(value, m.index + m[1].length);
    if (at < 0) continue;
    for (let k = at; k < at + value.length; k++) blanked[k] = tag[k];
  }
  return blanked.join("");
}

/**
 * Find the `>` that closes the tag opening at `text[from] === "<"`, ignoring `>` inside quoted
 * attribute values. `indexOf(">")` truncated the tag at `title="we answer >90% ..."` and emitted
 * the rest of the tag as document text, markup and all (second verification round, 2026-07-28).
 */
function endOfTag(text: string, from: number): number {
  let quote: string | null = null;
  for (let j = from + 1; j < text.length; j++) {
    const ch = text[j];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === ">") return j;
  }
  return -1;
}

/** Blank `<script>` and `<style>` bodies, comments, and every tag, keeping the text between them. */
function maskMarkup(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      const j = end === -1 ? text.length : end + 3;
      out += blank(text, i, j);
      i = j;
      continue;
    }
    // `<script`/`<style` is detected by prefix alone, and the end of the opening tag is found with
    // the quote-aware scan. The old form matched the whole opening tag with a regex over a 300-char
    // window, so a tag longer than the window — a JSON-LD `<script type="application/ld+json" …>`
    // with long attributes — was not recognised, and its body leaked out as document text.
    // Window long enough for the longest keyword plus its boundary character. Shortening it to 5
    // for `pre` broke `script` and `style`, whose bodies then leaked as document text.
    const scriptish = /^<(script|style|pre)\b/i.exec(text.slice(i, i + 8));
    if (scriptish) {
      const openEnd = endOfTag(text, i);
      const bodyStart = openEnd === -1 ? text.length : openEnd + 1;
      // `</script >` — whitespace before the `>` — is valid HTML, and an exact-string search for
      // `</script>` never finds it, so the masker ran to the end of the file and blanked the whole
      // document. Silent absence, the failure direction this project treats as its worst.
      const closeRe = new RegExp(`</\\s*${scriptish[1]}\\s*>`, "i");
      const hit = closeRe.exec(text.slice(bodyStart));
      const bodyEnd = hit ? bodyStart + hit.index : text.length;
      out += blank(text, i, bodyEnd);
      i = bodyEnd;
      continue;
    }
    if (text[i] === "<" && /[A-Za-z/!?]/.test(text[i + 1] ?? "")) {
      const end = endOfTag(text, i);
      const j = end === -1 ? text.length : end + 1;
      out += blankTagKeepingContent(text, i, j);
      i = j;
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}

/**
 * Markdown and MDX: markup masking, plus MDX's import/export lines which are code, not prose —
 * and fenced code blocks, which are *examples*, not the document's own text.
 *
 * The fence masking was added 2026-07-28 after the second verification round showed the mailto
 * fix leaking through it: a documentation page whose code example contained
 * `<a href="mailto:not-our-address@example">` had that address extracted as the document's own
 * contact address. Everything between ``` or ~~~ fences is blanked, fence lines included.
 */
function maskMarkdown(text: string): string {
  // A fence is closed only by the same character, at least as long as the one that opened it —
  // CommonMark's rule. Toggling on any fence marker let a ``` line inside a ~~~ block close it and
  // reopen it, so the example address in that block came back out as the document's own text
  // (third verification round, 2026-07-28). Indented code blocks are masked for the same reason:
  // they are examples, not what the document says.
  let openFence: { char: string; length: number } | null = null;
  let prevBlank = true;
  const defenced = text
    .split("\n")
    .map((line) => {
      const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (openFence) {
        if (m && m[1][0] === openFence.char && m[1].length >= openFence.length) openFence = null;
        return " ".repeat(line.length);
      }
      if (m) {
        openFence = { char: m[1][0], length: m[1].length };
        return " ".repeat(line.length);
      }
      if (prevBlank && /^(\t| {4})\S/.test(line)) {
        prevBlank = false;
        return " ".repeat(line.length);
      }
      prevBlank = line.trim() === "";
      return line;
    })
    .join("\n");
  const masked = maskMarkup(defenced);
  return masked
    .split("\n")
    .map((line) => (/^\s*(import|export)\s/.test(line) ? " ".repeat(line.length) : line))
    .join("\n");
}

const NAMED_ENTITIES: Record<string, string> = {
  quot: '"', apos: "'", amp: "&", lt: "<", gt: ">", nbsp: " ",
  hellip: "…", mdash: "—", ndash: "–", laquo: "«", raquo: "»",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
};

/**
 * Decode character references and normalise the no-break space.
 *
 * `&amp;` is decoded last-effect by construction: the pattern consumes a whole reference at a time,
 * so `&amp;quot;` yields the literal text `&quot;` rather than a double quote.
 */
/**
 * An out-of-range code point is carried verbatim, never thrown.
 *
 * `Number.isFinite` was the only guard here, and `String.fromCodePoint` throws `RangeError` for any
 * finite value above 0x10FFFF — so `&#x110000;` anywhere in any discovered document, or in a page
 * fetched via `--policy <url>`, aborted the whole `reconcile` run with a stack trace. The store parser had this exact defect;
 * the identical line in this file went unchecked, which is why this helper names the
 * range instead of trusting a guard.
 */
function codePointOrVerbatim(cp: number, whole: string): string {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return whole;
  try {
    return String.fromCodePoint(cp);
  } catch {
    return whole;
  }
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&(#x?[0-9A-Fa-f]+|[A-Za-z]+);/g, (whole, body: string) => {
      if (body.startsWith("#x") || body.startsWith("#X")) {
        return codePointOrVerbatim(Number.parseInt(body.slice(2), 16), whole);
      }
      if (body.startsWith("#")) {
        return codePointOrVerbatim(Number.parseInt(body.slice(1), 10), whole);
      }
      return NAMED_ENTITIES[body] ?? whole;
    })
    .replace(/ /g, " ");
}

/**
 * Which masker to run — a question about the file's FORMAT, and never about whether it is a
 * declaration.
 *
 * This is one of the two uses of a file extension the ruling of 2026-09-02 leaves standing
 * (see `discover.ts`'s `DOCUMENT_FORMAT_EXTS`): nothing here decides whether a file is offered, is
 * read, or is a document. It decides which characters are markup. **The unknown case falls to `text`,
 * which keeps every character**, so the failure direction of a wrong guess is noise the reader can
 * see rather than a document silently blanked. That direction matters and is not symmetric: routing
 * a `.ts` file to the `tsx` masker would blank every string literal outside JSX, which is exactly
 * where one real tree's Terms and Privacy Policy live — a template literal in a route handler — and would
 * extract nothing at all from both. `text` keeps them whole, at the price of a few `import` lines,
 * and `stats` plus `notes` are what make a bad guess visible either way.
 */
export function extractorFor(path: string): ExtractorKind {
  const base = path.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
  if (ext === "tsx" || ext === "jsx") return "tsx";
  if (ext === "md" || ext === "mdx") return "markdown";
  if (ext === "html" || ext === "htm" || ext === "xhtml") return "html";
  return "text";
}

export interface ExtractOptions {
  docPath: string;
  content: string;
  kind?: "file" | "url";
  fetchedAt?: string;
  /** Overrides the extension-based choice; used by the fixture runner to test one masker. */
  extractor?: ExtractorKind;
}

export function extractText(opts: ExtractOptions): ExtractedDoc {
  const extractor = opts.extractor ?? extractorFor(opts.docPath);
  const masked =
    extractor === "tsx"
      ? maskJsx(opts.content)
      : extractor === "markdown"
        ? maskMarkdown(opts.content)
        : extractor === "html"
          ? maskMarkup(opts.content)
          : opts.content;

  const sourceLines = masked.split(/\r?\n/);
  const lines: ExtractedLine[] = [];
  let characters = 0;
  for (let i = 0; i < sourceLines.length; i++) {
    const text = decodeEntities(sourceLines[i]).replace(/\s+/g, " ").trim();
    if (text === "") continue;
    lines.push({ line: i + 1, text });
    characters += text.length;
  }

  /**
   * The one thing this function can say about its own result that the numbers do not.
   *
   * A masker meeting a shape it was not written for produces an empty document out of a file that
   * plainly has content, and an empty `lines[]` on its own is indistinguishable from a file that
   * really says nothing. Since 2026-09-02 a document is reached by its NAME whatever its format, so
   * the masker running on it can be a guess from an extension that means nothing — which makes this
   * the failure mode to name rather than to hope about. The document is still emitted: the reader
   * gets the digest, the byte count and this sentence, and `--policy` and the raw file are both still
   * open to them.
   */
  const notes: string[] = [];
  if (lines.length === 0 && opts.content.trim() !== "") {
    notes.push(
      `the ${extractor} extractor produced no text from ${sourceLines.length} source line(s) and ${Buffer.byteLength(opts.content)} byte(s). ` +
        "The file is not empty, so this says the masker met a shape it does not handle rather than that the document is silent — read the file itself before concluding anything from it.",
    );
  }

  return {
    doc_path: opts.docPath,
    kind: opts.kind ?? "file",
    extractor,
    sha256: createHash("sha256").update(opts.content).digest("hex"),
    read_at: new Date().toISOString(),
    ...(opts.fetchedAt ? { fetched_at: opts.fetchedAt } : {}),
    bytes: Buffer.byteLength(opts.content),
    lines,
    stats: {
      source_lines: sourceLines.length,
      text_lines: lines.length,
      characters,
    },
    ...(notes.length > 0 ? { notes } : {}),
  };
}

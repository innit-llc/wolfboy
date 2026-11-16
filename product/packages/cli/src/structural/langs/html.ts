/**
 * Angle-bracket markup: `.html`, `.vue`, `.svelte`, and the host language of ERB, Blade, Mustache,
 * Handlebars, Liquid, Twig and Markdown once their non-HTML constructs are masked.
 */

import { attr, el, expr, text, type IrNode } from "../ir.js";
import { endLine1, kids, line1, parseWith, type ParseSession, type TsNode } from "../ts.js";

/** Svelte `{...props}`; Vue `v-bind="obj"` is handled separately. */
const SPREAD = /\.\.\./;

function readAttrs(tagNode: TsNode): { attrs: ReturnType<typeof attr>[]; opaque: boolean } {
  const attrs = [];
  let opaque = false;
  for (const c of kids(tagNode)) {
    if (c.type !== "attribute") {
      // A brace expression sitting where an attribute goes is an attribute bag we cannot read.
      if (c.isNamed && SPREAD.test(c.text)) opaque = true;
      continue;
    }
    const nameNode = kids(c).find((x) => x.type === "attribute_name");
    if (!nameNode) continue;
    const name = nameNode.text;
    if (SPREAD.test(name)) {
      opaque = true;
      continue;
    }
    const quoted = kids(c).find((x) => x.type === "quoted_attribute_value");
    const bare = kids(c).find((x) => x.type === "attribute_value");
    const raw = quoted
      ? (kids(quoted).find((x) => x.type === "attribute_value")?.text ?? "")
      : (bare?.text ?? null);
    // Vue's v-bind="obj" and Angular's [attr]="obj" hand the element a bag built elsewhere.
    if (/^v-bind$/i.test(name)) {
      opaque = true;
      continue;
    }
    const dynamic = raw !== null && /^\{.*\}$/.test(raw.trim());
    attrs.push(attr(name, raw, dynamic));
  }
  return { attrs, opaque };
}

function convert(node: TsNode, ignore: TsNode | null = null): IrNode[] {
  const out: IrNode[] = [];
  for (const c of kids(node)) {
    if (ignore !== null && c.id === ignore.id) continue;
    if (c.type === "element" || c.type === "script_element" || c.type === "style_element") {
      const open = kids(c).find((x) => x.type === "start_tag" || x.type === "self_closing_tag");
      if (!open) {
        out.push(...convert(c));
        continue;
      }
      const tagName = kids(open).find((x) => x.type === "tag_name")?.text ?? null;
      const { attrs, opaque } = readAttrs(open);
      // Script and style content is not markup and carries no accessible name.
      const children = c.type === "element" ? convert(c, open) : [];
      out.push(el(tagName, line1(open), { endLine: endLine1(open), attrs, opaqueAttrs: opaque, children }));
    } else if (c.type === "start_tag" || c.type === "self_closing_tag") {
      // An opening tag with no `element` around it: the file is broken and tree-sitter recovered by
      // leaving the tag loose. Read it as an element with no children rather than dropping it.
      const tagName = kids(c).find((x) => x.type === "tag_name")?.text ?? null;
      const { attrs, opaque } = readAttrs(c);
      out.push(el(tagName, line1(c), { endLine: endLine1(c), attrs, opaqueAttrs: opaque, children: [] }));
    } else if (c.type === "text") {
      // A Svelte/Vue/Handlebars interpolation left in the text stream renders text.
      if (/\{[^}]*\}|\{\{/.test(c.text)) out.push(expr(line1(c)));
      out.push(text(c.text, line1(c)));
    } else if (c.type === "comment" || c.type === "doctype" || c.type === "raw_text") {
      // Comments are not markup. This is the block state the line-based reading does not have.
    } else if (c.isNamed) {
      out.push(...convert(c));
    }
  }
  return out;
}

export function parseHtml(source: string, session: ParseSession): IrNode[] {
  return convert(parseWith("html", source, session));
}

/**
 * A run of raw HTML written inside another language, read as markup and reported at the lines and
 * columns it occupies IN THE ORIGINAL FILE.
 *
 * The position is preserved the same way the template masks preserve it — by padding rather than by
 * arithmetic on the result — so there is no offset to get wrong: the parser is handed a string in
 * which the fragment sits exactly where it sits in the file, and every position it reports is
 * already a position in that file.
 */
export function parseHtmlFragment(
  fragment: string,
  startLine: number,
  startColumn: number,
  session: ParseSession,
): IrNode[] {
  const padded = "\n".repeat(Math.max(0, startLine - 1)) + " ".repeat(Math.max(0, startColumn)) + fragment;
  return parseHtml(padded, session);
}

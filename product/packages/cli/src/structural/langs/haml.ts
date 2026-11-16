/**
 * HAML.
 *
 * The grammar gives the element tree and the indentation nesting; what it hands back opaque is the
 * Ruby attribute hash, so this adapter carries a small hash reader. That division is worth stating:
 * the hard part — which lines belong to which element — is the grammar's, and what is left over is a
 * flat key/value scan that cannot mis-attribute anything.
 */

import { attr, el, expr, text, type IrAttr, type IrNode } from "../ir.js";
import { endLine1, kids, line1, parseWith, type ParseSession, type TsNode } from "../ts.js";
import { parseHtmlFragment } from "./html.js";

/** Split a Ruby hash body on top-level commas. */
function splitEntries(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (ch === quote && body[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    else if (ch === "," && depth === 0) {
      out.push(body.slice(start, i));
      start = i + 1;
    }
  }
  out.push(body.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

const ENTRY = /^(?::?([A-Za-z_][\w-]*)|'([^']*)'|"([^"]*)"|:'([^']*)')\s*(?::(?!:)|=>)\s*([\s\S]*)$/;

/**
 * A number written bare in a Ruby hash is a value, not an expression.
 *
 * `{ tabindex: 3 }` is the commonest HAML spelling of the positive-tabindex defect and the prototype
 * missed every one of them, including the one in this rule's own fixture: it treated any unquoted
 * right-hand side as dynamic, and the check declines on a dynamic value because it cannot know what
 * it evaluates to. A literal integer is knowable, so it is read as one. Nothing that turns on a value
 * being PRESENT changes — a numeric literal supplied a value before and supplies one now.
 */
const NUMERIC_LITERAL = /^-?\d+(?:\.\d+)?$/;

/** `{ src: 'a', 'aria-label' => 'x', html_attributes }` -> attributes, plus an opacity flag. */
export function readRubyHash(raw: string): { attrs: IrAttr[]; opaque: boolean } {
  const attrs: IrAttr[] = [];
  let opaque = false;
  const body = raw.trim().replace(/^\{/, "").replace(/\}$/, "");
  for (const entry of splitEntries(body)) {
    const m = ENTRY.exec(entry);
    if (!m) {
      // A bare identifier or a `**splat` is an attribute bag built elsewhere.
      opaque = true;
      continue;
    }
    const name = m[1] ?? m[2] ?? m[3] ?? m[4];
    const rhs = m[5].trim();
    const lit = /^'([^']*)'$/.exec(rhs) ?? /^"([^"]*)"$/.exec(rhs);
    if (lit) attrs.push(attr(name, lit[1], false));
    else if (NUMERIC_LITERAL.test(rhs)) attrs.push(attr(name, rhs, false));
    else attrs.push(attr(name, rhs, true));
  }
  return { attrs, opaque };
}

function readHtmlStyleAttrs(node: TsNode): IrAttr[] {
  const attrs: IrAttr[] = [];
  for (const a of kids(node)) {
    if (a.type !== "attribute") continue;
    const name = kids(a).find((x) => x.type === "attribute_name")?.text;
    if (!name) continue;
    const q = kids(a).find((x) => x.type === "quoted_attribute_value");
    const v = q ? (kids(q).find((x) => x.type === "attribute_value")?.text ?? null) : null;
    attrs.push(attr(name, v, v === null));
  }
  return attrs;
}

/**
 * Content written on a control's own line, which in HAML is the only place a nested element can go:
 * the language cannot nest two elements on one line, so an icon inside a button has to be written as
 * raw HTML after the tag.
 *
 * The prototype read that raw HTML as a text node, and any non-whitespace text inside a control is
 * an accessible name — so `%button{…} <i class="fa fa-times"></i>` was read as a NAMED control and
 * the icon-only check declined on the one shape it exists to catch. Reading it as markup is what the
 * file says; falling back to text when nothing parses keeps the name evidence rather than losing it.
 */
function textOrMarkup(node: TsNode, session: ParseSession): IrNode[] {
  const raw = node.text;
  if (!/<[A-Za-z][\w:-]*(\s|\/|>)/.test(raw)) return [text(raw, line1(node))];
  const nodes = parseHtmlFragment(raw, line1(node), node.startPosition.column, session);
  return nodes.some((n) => n.kind === "element") ? nodes : [text(raw, line1(node))];
}

const SKIP = new Set(["comment", "filter", "doctype", "haml_comment"]);

function convertTag(node: TsNode, session: ParseSession): IrNode {
  let tag: string | null = null;
  const attrs: IrAttr[] = [];
  let opaque = false;
  let endLine = line1(node);
  const children: IrNode[] = [];
  for (const c of kids(node)) {
    switch (c.type) {
      case "tag_name":
        tag = c.text.trim().replace(/^%/, "");
        break;
      case "class":
      case "id":
        // A line opening `.foo` or `#foo` with no %tag written IS a div.
        if (tag === null) tag = "div";
        attrs.push(attr(c.type, c.text.trim().replace(/^[.#]/, ""), false));
        break;
      case "attributes": {
        endLine = Math.max(endLine, endLine1(c));
        for (const a of kids(c)) {
          if (a.type === "ruby_attributes") {
            const r = readRubyHash(a.text);
            attrs.push(...r.attrs);
            opaque = opaque || r.opaque;
          } else if (a.type === "html_attributes") {
            attrs.push(...readHtmlStyleAttrs(a));
          }
        }
        break;
      }
      case "verbatim_string":
      case "text":
      case "plain":
        children.push(...textOrMarkup(c, session));
        break;
      case "ruby_block_output":
        children.push(expr(line1(c)), ...convertContainer(c, session));
        break;
      case "ruby_interpolation":
        children.push(expr(line1(c)));
        break;
      case "tag":
        children.push(convertTag(c, session));
        break;
      case "ruby_block_run":
        children.push(...convertContainer(c, session));
        break;
      default:
        if (c.isNamed && !SKIP.has(c.type)) children.push(...convertContainer(c, session));
    }
  }
  if (tag === null) tag = "div";
  return el(tag, line1(node), { endLine, attrs, opaqueAttrs: opaque, children });
}

function convertContainer(node: TsNode, session: ParseSession): IrNode[] {
  const out: IrNode[] = [];
  for (const c of kids(node)) {
    if (SKIP.has(c.type)) continue;
    if (c.type === "tag") out.push(convertTag(c, session));
    // `= link_to … do` RENDERS TEXT AND HOLDS A BLOCK, and the grammar nests the whole block inside
    // it, so it is both. Emitting only the expression dropped every element under it — measured on
    // 2026-08-11 as 49 of one tree's 310 `.haml` files (16%) reading as an empty document while
    // reporting `outcome=parsed`, which is the same silent loss as D1 and D10. The expression is
    // still emitted, because the block's return value is still rendered and still names a control.
    else if (c.type === "ruby_block_output") out.push(expr(line1(c)), ...convertContainer(c, session));
    else if (c.type === "verbatim_string" || c.type === "plain" || c.type === "text") {
      out.push(...textOrMarkup(c, session));
    } else if (c.isNamed) out.push(...convertContainer(c, session));
  }
  return out;
}

export function parseHaml(source: string, session: ParseSession): IrNode[] {
  return convertContainer(parseWith("haml", source, session), session);
}

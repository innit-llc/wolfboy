/**
 * Slim.
 *
 * Slim is the language the line-based reading declared out of reach, and the reason is not pattern
 * craft: it writes the tag name bare at the start of a line, so `img`, `html` and `a` are
 * indistinguishable from ordinary identifiers in every other language in a repository. A parser has
 * no such problem, because it is only ever handed a `.slim` file and reads it as a document.
 */

import { attr, el, expr, text, type IrAttr, type IrNode } from "../ir.js";
import { endLine1, kids, line1, parseWith, type ParseSession, type TsNode } from "../ts.js";

const SKIP = new Set(["code_comment", "html_comment", "doctype"]);

function readAttrs(node: TsNode): { attrs: IrAttr[]; opaque: boolean } {
  const attrs: IrAttr[] = [];
  let opaque = false;
  for (const a of kids(node)) {
    if (a.type === "attr_splat" || (a.isNamed && a.type !== "attr" && /\*/.test(a.text))) {
      opaque = true;
      continue;
    }
    if (a.type !== "attr") continue;
    const name = kids(a).find((x) => x.type === "attr_name")?.text;
    if (!name) continue;
    const q = kids(a).find((x) => x.type === "attr_value_quoted");
    if (q) {
      attrs.push(attr(name, kids(q).find((x) => x.type === "attr_value_content")?.text ?? "", false));
    } else {
      // A bare Ruby value: present, but not readable.
      const other = kids(a).find((x) => x.isNamed && x.type !== "attr_name" && x.type !== "attr_assignment");
      attrs.push(attr(name, other ? other.text : "", other !== undefined));
    }
  }
  return { attrs, opaque };
}

function convertElement(node: TsNode): IrNode {
  let tag: string | null = null;
  const attrs: IrAttr[] = [];
  let opaque = false;
  let endLine = line1(node);
  const children: IrNode[] = [];
  for (const c of kids(node)) {
    switch (c.type) {
      case "tag_name":
        tag = c.text.trim();
        break;
      case "attr_shortcuts":
        if (tag === null) tag = "div"; // `.row` with no tag name is a div
        for (const s of kids(c)) {
          if (s.type === "attr_shortcut_class") attrs.push(attr("class", s.text.replace(/^\./, ""), false));
          if (s.type === "attr_shortcut_id") attrs.push(attr("id", s.text.replace(/^#/, ""), false));
        }
        break;
      case "attrs": {
        endLine = Math.max(endLine, endLine1(c));
        const r = readAttrs(c);
        attrs.push(...r.attrs);
        opaque = opaque || r.opaque;
        break;
      }
      case "element_text":
      case "verbatim_text":
        children.push(text(c.text.replace(/^\s*\|/, ""), line1(c)));
        break;
      case "nested":
        children.push(...convertContainer(c));
        break;
      case "ruby_block_output":
        // Both an expression and a container — see the note in `convertContainer` below.
        children.push(expr(line1(c)), ...convertContainer(c));
        break;
      default:
        if (c.isNamed && !SKIP.has(c.type)) children.push(...convertContainer(c));
    }
  }
  return el(tag ?? "div", line1(node), { endLine, attrs, opaqueAttrs: opaque, children });
}

function convertContainer(node: TsNode): IrNode[] {
  const out: IrNode[] = [];
  for (const c of kids(node)) {
    if (SKIP.has(c.type)) continue;
    if (c.type === "element") out.push(convertElement(c));
    // `= link_to … do` RENDERS TEXT AND HOLDS A BLOCK, and the grammar nests the whole block inside
    // it, so it is both. Emitting only the expression dropped every element under it — the same
    // silent loss the HAML adapter carried, found in the same sweep on 2026-08-11. The expression is
    // still emitted, because the block's return value is still rendered and still names a control.
    else if (c.type === "ruby_block_output") out.push(expr(line1(c)), ...convertContainer(c));
    else if (c.type === "verbatim_text" || c.type === "element_text") out.push(text(c.text, line1(c)));
    else if (c.isNamed) out.push(...convertContainer(c));
  }
  return out;
}

export function parseSlim(source: string, session: ParseSession): IrNode[] {
  return convertContainer(parseWith("slim", source, session));
}

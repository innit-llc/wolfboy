/**
 * JSX and TSX, plus the object-literal form of the positive-tabindex check.
 *
 * Two things about JSX cost the prototype a correction each, and both are kept here because they are
 * the shape of the work a structural reading asks for:
 *   1. Elements nested inside an expression container — `{cond && (<div>…</div>)}` — are not children
 *      of the enclosing element in the parse tree, and a naive walk loses them.
 *   2. Elements written inside an ATTRIBUTE VALUE — `prepend={<div>…</div>}` — are not content of
 *      anything, and a naive walk loses those too.
 */

import { attr, el, expr, text, type IrAttr, type IrNode } from "../ir.js";
import { endLine1, kids, line1, named, parseWith, type ParseSession, type TsNode } from "../ts.js";
import type { GrammarName } from "../languages.js";

const JSXY = new Set(["jsx_element", "jsx_self_closing_element", "jsx_fragment"]);
/** Expression content that can render text, as opposed to a guard around an element. */
const TEXTY = new Set(["string", "template_string", "call_expression", "number"]);

function findJsx(node: TsNode, out: TsNode[]): TsNode[] {
  for (const c of kids(node)) {
    if (JSXY.has(c.type)) out.push(c);
    else findJsx(c, out);
  }
  return out;
}

/** Does this expression container render text, or is it only a guard around markup? */
function rendersText(exprNode: TsNode): boolean {
  const jsx = findJsx(exprNode, []);
  if (jsx.length === 0) return true; // `{label}`, `{count}` — nothing but an expression
  let texty = false;
  const visit = (n: TsNode): void => {
    if (JSXY.has(n.type)) return;
    if (TEXTY.has(n.type)) texty = true;
    for (const c of kids(n)) visit(c);
  };
  visit(exprNode);
  return texty;
}

function readAttrs(open: TsNode, sink: IrNode[]): { attrs: IrAttr[]; opaque: boolean } {
  const attrs: IrAttr[] = [];
  let opaque = false;
  for (const c of kids(open)) {
    if (c.type === "jsx_attribute") {
      const name = kids(c)[0]?.text ?? "";
      const value = kids(c).find((x) => x.type === "string" || x.type === "jsx_expression");
      if (!value) {
        attrs.push(attr(name, "", false)); // boolean attribute: present
      } else if (value.type === "string") {
        attrs.push(attr(name, kids(value).find((x) => x.type === "string_fragment")?.text ?? "", false));
      } else {
        const inner = named(value)[0];
        const lit =
          inner && (inner.type === "number" || inner.type === "string")
            ? inner.text.replace(/^["'`]|["'`]$/g, "")
            : null;
        attrs.push(attr(name, lit, lit === null));
        // Markup written inside an attribute value is markup, and belongs to the file.
        for (const j of findJsx(value, [])) sink.push(convertJsx(j, sink));
      }
    } else if (c.type === "jsx_expression") {
      opaque = true; // {...props}
    }
  }
  return { attrs, opaque };
}

const nameOf = (open: TsNode): string | null =>
  kids(open).find((x) => ["identifier", "member_expression", "nested_identifier"].includes(x.type))?.text ?? null;

function convertJsx(node: TsNode, sink: IrNode[]): IrNode {
  if (node.type === "jsx_fragment") {
    return el(null, line1(node), {
      children: kids(node)
        .filter((c) => JSXY.has(c.type))
        .map((c) => convertJsx(c, sink)),
    });
  }
  if (node.type === "jsx_self_closing_element") {
    const { attrs, opaque } = readAttrs(node, sink);
    return el(nameOf(node), line1(node), { endLine: endLine1(node), attrs, opaqueAttrs: opaque, children: [] });
  }
  const open = kids(node).find((x) => x.type === "jsx_opening_element");
  const { attrs, opaque } = readAttrs(open ?? node, sink);
  const children: IrNode[] = [];
  for (const c of kids(node)) {
    if ((open !== undefined && c.id === open.id) || c.type === "jsx_closing_element") continue;
    if (JSXY.has(c.type)) children.push(convertJsx(c, sink));
    else if (c.type === "jsx_text") children.push(text(c.text, line1(c)));
    else if (c.type === "jsx_expression") {
      const inner = named(c)[0];
      if (inner && inner.type === "comment") continue;
      for (const j of findJsx(c, [])) children.push(convertJsx(j, sink));
      if (rendersText(c)) children.push(expr(line1(c)));
    }
  }
  const head = open ?? node;
  return el(nameOf(head), line1(head), { endLine: endLine1(head), attrs, opaqueAttrs: opaque, children });
}

export function parseJsx(source: string, grammar: GrammarName, session: ParseSession): IrNode[] {
  const root = parseWith(grammar, source, session);
  const nodes: IrNode[] = [];
  const visit = (n: TsNode): void => {
    if (JSXY.has(n.type)) {
      const sink: IrNode[] = [];
      const converted = convertJsx(n, sink);
      nodes.push(converted, ...sink);
      return; // everything under it is already converted
    }
    if (n.type === "pair") {
      // The object-literal `tabIndex: 1`, which is where the line-based reading's largest single
      // gain on this rule came from (form-field descriptors). Read as a property whose key is
      // tabIndex and whose value is a numeric literal, so the two readings look for the same thing.
      const key = kids(n)[0];
      const val = n.childForFieldName("value");
      const keyText = key?.text?.replace(/^["'`]|["'`]$/g, "") ?? "";
      if (/^tab[Ii]ndex$/.test(keyText) && val && val.type === "number") {
        nodes.push(
          el(null, line1(n), { endLine: endLine1(n), attrs: [attr("tabindex", val.text, false)] }),
        );
      }
    }
    for (const c of kids(n)) visit(c);
  };
  visit(root);
  return nodes;
}

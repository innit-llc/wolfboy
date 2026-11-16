/**
 * Pug / Jade.
 *
 * A DEFECT IN THE VENDORED GRAMMAR IS WORKED AROUND HERE, and the workaround is the reason this
 * adapter is longer than the Slim one it otherwise mirrors.
 *
 * `tree-sitter-pug@1.0.12` reads a comment that opens a FRESH indentation context — one preceded by
 * a blank line — as owning every following line indented at or beyond its own column, rather than
 * every line indented STRICTLY BEYOND it. Pug's own rule is the strict one: `//- c` at column 4
 * followed by `button` at column 4 is a comment and a sibling, not a comment containing a button.
 * The grammar therefore returns a single `comment` node covering the rest of the file, with no
 * `ERROR` and no `MISSING` node anywhere in it, so `errorCount` is 0 and the parse looks clean.
 *
 * Measured on the shipped artefact, 2026-08-11 (comment at column 4, next line at column 4):
 *
 *   | blank line before the comment? | grammar's comment span | correct? |
 *   | no                             | its own line           | yes      |
 *   | yes                            | to end of file         | NO       |
 *
 * The consequence is the one this whole design exists to prevent: the document below the comment
 * disappears, the file still reports `outcome=parsed`, and no counter moves. Found from a fixture,
 * because `.pug` and `.slim` appear in no repository of the 94-repository corpus, so no corpus
 * measurement could ever have surfaced it.
 *
 * WHY IT IS FIXED HERE AND NOT IN THE GRAMMAR. The vendored `.wasm` is a third-party artefact with a
 * recorded provenance and hash; correcting it means an upstream fix and a re-vendoring, which is not
 * this module's to make. `recoverSwallowedComment` therefore reads back the lines the grammar put
 * inside a comment that do not belong to it, re-parses them at their own line numbers, and splices
 * them in. When the comment's body IS legitimately deeper-indented, nothing is recovered and the
 * body stays a comment. The upstream defect is recorded in an internal record.
 */

import { attr, el, expr, text, type IrAttr, type IrNode } from "../ir.js";
import { endLine1, kids, line1, parseWith, type ParseSession, type TsNode } from "../ts.js";

const SKIP = new Set(["comment", "block_comment", "doctype", "unbuffered_code"]);
const COMMENT = new Set(["comment", "block_comment"]);

/**
 * What a recovery needs: the file's own lines, the session to register re-parsed trees with, and a
 * budget. The budget is not a tidiness limit — a comment recovered from can itself contain a
 * swallowing comment, so a hostile file could nest recoveries without end. Exhausting it THROWS,
 * which `parseForStructure` counts as a parse failure and falls back to the line reading. A silent
 * truncation here would be the same defect this file is working around.
 */
interface PugCtx {
  lines: string[];
  session: ParseSession;
  recovered: Set<number>;
  budget: { left: number };
}

const RECOVERY_BUDGET = 200;

/** Leading-whitespace width of a line, in the same units the grammar reports a column in. */
const indentOf = (line: string): number => line.length - line.trimStart().length;

/**
 * The document a `comment` node wrongly contains, read back and re-parsed at its own line numbers.
 *
 * Returns nothing at all in the ordinary case — a comment that ends on its own line, or one whose
 * body really is indented deeper than it is. Only the grammar defect above produces a recovery.
 */
function recoverSwallowedComment(n: TsNode, ctx: PugCtx): IrNode[] {
  const startRow = n.startPosition.row;
  // A node ending at column 0 ends BEFORE that row's text, so the last row it covers is the one
  // above. Without this, a correctly-parsed comment would look as though it had swallowed the line
  // that merely follows it.
  const lastRow = n.endPosition.column === 0 ? n.endPosition.row - 1 : n.endPosition.row;
  if (lastRow <= startRow) return [];
  const col = n.startPosition.column;

  for (let row = startRow + 1; row <= lastRow && row < ctx.lines.length; row++) {
    const line = ctx.lines[row];
    if (line.trim() === "") continue;
    // Indented deeper than the comment: this really is the comment's body, and so is everything
    // under it. Nothing here is document.
    if (indentOf(line) > col) continue;
    // Indented at or above the comment's own column: a sibling the grammar took. From here to the
    // end of the comment node is document.
    if (ctx.recovered.has(row)) return [];
    ctx.recovered.add(row);
    // The trailing newline is not cosmetic: without it the grammar leaves the last block open and
    // the deepest element loses its children, which is a quieter version of the same loss.
    const slice = `${ctx.lines.slice(row, lastRow + 1).join("\n")}\n`;
    if (slice.trim() === "") return [];
    if (ctx.budget.left <= 0) {
      throw new Error(
        "pug comment recovery exceeded its budget; the file is not parsed rather than parsed in part",
      );
    }
    ctx.budget.left--;
    // Padded to its own line, exactly as the HAML fragment reader pads: the re-parse is handed a
    // string in which every recovered line sits where it sits in the file, so every position it
    // reports is already a position in that file and there is no offset to get wrong.
    const padded = "\n".repeat(row) + slice;
    return convertContainer(parseWith("pug", padded, ctx.session), ctx);
  }
  return [];
}

function readAttrs(node: TsNode): { attrs: IrAttr[]; opaque: boolean } {
  const attrs: IrAttr[] = [];
  let opaque = false;
  for (const a of kids(node)) {
    if (a.type !== "attribute") {
      if (a.isNamed && /\.\.\./.test(a.text)) opaque = true;
      continue;
    }
    const name = kids(a).find((x) => x.type === "attribute_name")?.text;
    if (!name) continue;
    if (/^&attributes$/.test(name)) {
      opaque = true;
      continue;
    }
    const q = kids(a).find((x) => x.type === "quoted_attribute_value");
    if (q) {
      attrs.push(attr(name, kids(q).find((x) => x.type === "attribute_value")?.text ?? "", false));
    } else {
      const other = kids(a).find((x) => x.isNamed && x.type !== "attribute_name");
      attrs.push(attr(name, other ? other.text : "", other !== undefined));
    }
  }
  return { attrs, opaque };
}

function convertTag(node: TsNode, ctx: PugCtx): IrNode {
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
      case "class":
      case "id":
        if (tag === null) tag = "div";
        attrs.push(attr(c.type, c.text.trim().replace(/^[.#]/, ""), false));
        break;
      case "attributes": {
        endLine = Math.max(endLine, endLine1(c));
        const r = readAttrs(c);
        attrs.push(...r.attrs);
        opaque = opaque || r.opaque;
        break;
      }
      case "content":
        children.push(text(c.text, line1(c)));
        break;
      case "children":
        children.push(...convertContainer(c, ctx));
        break;
      case "buffered_code":
      case "interpolation":
        children.push(expr(line1(c)));
        break;
      case "comment":
      case "block_comment":
        children.push(...recoverSwallowedComment(c, ctx));
        break;
      default:
        if (c.isNamed && !SKIP.has(c.type)) children.push(...convertContainer(c, ctx));
    }
  }
  return el(tag ?? "div", line1(node), { endLine, attrs, opaqueAttrs: opaque, children });
}

function convertContainer(node: TsNode, ctx: PugCtx): IrNode[] {
  const out: IrNode[] = [];
  for (const c of kids(node)) {
    // A comment is not markup, but a comment this grammar has wrongly extended over the rest of the
    // file still contains markup, and dropping it is the silent loss the header describes.
    if (COMMENT.has(c.type)) {
      out.push(...recoverSwallowedComment(c, ctx));
      continue;
    }
    if (SKIP.has(c.type)) continue;
    if (c.type === "tag") out.push(convertTag(c, ctx));
    else if (c.type === "content") out.push(text(c.text, line1(c)));
    else if (c.type === "buffered_code") out.push(expr(line1(c)));
    else if (c.isNamed) out.push(...convertContainer(c, ctx));
  }
  return out;
}

export function parsePug(source: string, session: ParseSession): IrNode[] {
  const ctx: PugCtx = {
    lines: source.split("\n"),
    session,
    recovered: new Set(),
    budget: { left: RECOVERY_BUDGET },
  };
  return convertContainer(parseWith("pug", source, session), ctx);
}

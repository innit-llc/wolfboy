/**
 * ERB and Blade: a grammar locates the non-HTML regions, the host HTML grammar reads the rest.
 *
 * This is the injection arrangement editors use, and it is the only way either language can be read
 * structurally, because neither grammar models HTML itself. The masking is STRUCTURAL here — the
 * region boundaries come from a parse, not from a pattern — which is the difference between these
 * two and the lexical masks in `masked.ts`.
 */

import type { IrNode } from "../ir.js";
import { blank, rawPhpRegions, type MaskRegion } from "../masked.js";
import { kids, parseWith, type ParseSession, type TsNode } from "../ts.js";
import { parseHtml } from "./html.js";

/**
 * Non-space filler for a region that renders text, so that a control named by `<%= t('close') %>`
 * still has an accessible name after masking.
 */
const MARK = String.fromCharCode(1);

/** ERB. `<%= %>` renders text; `<% %>` and `<%# %>` do not. */
export function parseErb(source: string, session: ParseSession): IrNode[] {
  const root = parseWith("erb", source, session);
  const regions: MaskRegion[] = [];
  const visit = (n: TsNode): void => {
    if (n.type === "output_directive") {
      regions.push({ start: n.startIndex, end: n.endIndex, fill: MARK });
      return;
    }
    if (n.type === "directive" || n.type === "comment_directive") {
      regions.push({ start: n.startIndex, end: n.endIndex, fill: " " });
      return;
    }
    for (const c of kids(n)) visit(c);
  };
  visit(root);
  return parseHtml(blank(source, regions), session);
}

/**
 * Blade. The grammar models Blade DIRECTIVES only: all HTML arrives as one opaque `text` node, so it
 * can supply the mask and nothing else.
 *
 * A DIRECTIVE'S ARGUMENT LIST IS MASKED WHOLE, and that is a separate rule from the leaf rule below
 * it, which masks a node only when it has NO children. The leaf rule exists because the grammar's
 * `text` node IS the document and must survive; but a `parameter` node whose inside the grammar
 * managed to split has children, so the leaf rule left its own text alone and PHP reached the HTML
 * parser. 2,104 of the 9,820 `parameter` nodes in the corpus's 1,030 `.blade.php` files have that
 * shape. In one profile view of a Blade application the leaked
 * `'title' => $profile->name . '…'` of an `@extends` argument put tree-sitter-html into error
 * recovery for the WHOLE FILE: every later `<div …>` came back as a bare `<` followed by an ERROR
 * node, no `element` node existed anywhere, and the file read as an empty document while reporting
 * `outcome=parsed`. That is the same class as D1 and D10 — less of the file than the file holds,
 * with no counter moving. Masking the parameter recovers 20 elements in that file and 18 in
 * `profile/show_carousel.blade.php`.
 *
 * THE FILL IS A SPACE FOR EVERY PARAMETER, WHICH IS NOT THE SPLIT `parseErb` MAKES ABOVE, and the
 * difference is measured rather than reasoned. Findings
 * from `accessibility-elements-v1` over the same 1,030 files: as shipped 255; a space fill 259,
 * losing none and gaining four; a MARK fill 240, losing 18 and gaining 3; MARK for the directives
 * that render text (`@lang`, `@choice`, `@yield`, `@stack`, the `@include` family, `@each`, `@js`,
 * `@dd`/`@dump`) and a space for the rest, 243, losing 16 and gaining 4 — and the same 243 with the
 * marker bucket cut down to `@lang` and `@choice`, so in this corpus the whole difference between
 * the two fills is `@lang`. All 16 were read in their files: every one is a control named
 * through `@lang(…)`, in its content or in a `title=` / `aria-label=`. The blanket MARK hides two
 * more that nothing names, where the marker comes from an `@if(…)` condition. So the two errors are
 * real and opposite — a space fill reports a control that `@lang` names, a MARK fill hides one that
 * nothing names — and this ships the space fill because it is the only one that removes no candidate
 * the scanner had before the fix. Which of the two the product should prefer is masking policy and
 * is the owner's; the record states what changes if they choose the other.
 *
 * A SECOND PASS RUNS AFTER THE STRUCTURAL ONE, AND IT IS LEXICAL. A raw `<?php … ?>` or `<?= … ?>`
 * block has no node in the Blade grammar — the whole file comes back as one `text` node — so
 * `rawPhpRegions` scans for the delimiters instead, and `masked.ts` holds it and states why. It is
 * handed the ALREADY-MASKED buffer rather than the source, so a `<?php` written inside a directive
 * argument or inside `{{ … }}` has been replaced before the scan sees it and cannot open a region.
 * Without this pass one tree's Blade search view read as an empty document while
 * reporting `outcome=parsed`; with it the file reads as 17 elements and no candidate anywhere in the
 * corpus moves.
 */
export function parseBlade(source: string, session: ParseSession): IrNode[] {
  const root = parseWith("blade", source, session);
  const regions: MaskRegion[] = [];
  const visit = (n: TsNode): void => {
    if (n.type === "php_statement") {
      regions.push({ start: n.startIndex, end: n.endIndex, fill: MARK });
      return;
    }
    // Whole, and without descending: a `parameter` nested inside another one is already covered by
    // the region its parent pushed, and every `parameter` is PHP whatever the grammar made of it.
    if (n.type === "parameter") {
      regions.push({ start: n.startIndex, end: n.endIndex, fill: " " });
      return;
    }
    const children = kids(n);
    if (children.length === 0) {
      if (n.type !== "text") regions.push({ start: n.startIndex, end: n.endIndex, fill: " " });
      return;
    }
    for (const c of children) visit(c);
  };
  visit(root);
  const masked = blank(source, regions);
  return parseHtml(blank(masked, rawPhpRegions(masked)), session);
}

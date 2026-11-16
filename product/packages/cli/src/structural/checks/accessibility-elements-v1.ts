/**
 * `accessibility-elements-v1` — the six element checks of `eu-accessibility-001`, written ONCE over
 * the normalised IR and therefore working in every language an adapter exists for.
 *
 * Check letters are the rule's own: (A) image with no alt, (B) document root with no lang, (C)
 * positive tabindex, (D) pointer handler with no keyboard path, (E) anchor with a handler and no
 * href, (F) icon-only control with no accessible name.
 *
 * THE WORDS COME FROM THE RULE, NOT FROM THIS FILE. Every element list, handler spelling and
 * name-supplying attribute is read out of `detector.vocabulary` by name; there is no default and no
 * fallback, and a rule that opts into this set without declaring one of the lists below fails at
 * compile time. What is written here as a literal is only ever the check's OWN SUBJECT — `img` and
 * `alt` for check (A), `html` and `lang` for (B), `tabindex` for (C), `a`, `button` and `href` for
 * (E) and (F) — because those are what the check IS, not a list two readings have to agree on.
 *
 * WHY THE SET IS VERSIONED. A change in what these checks mean ships as `-v2` and an author sees it
 * in the rule, rather than the same declaration quietly meaning something else after an upgrade.
 */

import {
  anyAttr,
  bareName,
  descendants,
  getAttr,
  hasAttr,
  type IrAttr,
  type IrElement,
  type IrNode,
} from "../ir.js";
import { vocabularyList, type Vocabulary } from "../../vocabulary.js";

export interface StructuralFinding {
  /** 1-based line of the original file. */
  line: number;
  /** Last line of the element's opening construct; equal to `line` for a single-line element. */
  endLine: number;
  /** The rule's own check letter. */
  check: string;
  /** The element the check fired on, for diagnostics. */
  tag: string;
}

/** The vocabulary lists this check set requires the rule to declare. */
export const REQUIRED_VOCABULARY = [
  "generic_elements",
  "pointer_handlers_jsx",
  "pointer_handlers_markup",
  "key_handlers",
  "icon_elements",
  "name_attributes",
  "presentation_attributes",
] as const;

/** Strip framework modifiers: `@click.stop`, `on:click|preventDefault`, `v-on:click.native`. */
const base = (name: string): string => name.split(/[.|]/)[0];

/**
 * A literal integer of 1 or more. 0, -1 and any computed value never fire, matching the rule: a
 * tabindex the code computes is not evidence that the computed value is positive.
 */
function positiveTabindex(a: IrAttr | null | undefined): boolean {
  if (!a || a.dynamic || a.value === null) return false;
  const v = String(a.value).trim().replace(/^\{|\}$/g, "").trim();
  return /^[1-9][0-9]*$/.test(v);
}

/**
 * Whether an attribute supplies text. `alt=""` is the correct decorative marking and is NOT a name;
 * `alt={x}` is unknowable and IS treated as one, because reporting it would be reporting a guess.
 */
const supplies = (a: IrAttr | null): boolean => a !== null && (a.dynamic || (a.value ?? "").trim() !== "");

interface Words {
  generic: Set<string>;
  pointer: Set<string>;
  key: string[];
  iconish: Set<string>;
  nameAttributes: string[];
  presentation: string[];
}

function words(vocab: Vocabulary | undefined, where: string): Words {
  const lower = (xs: string[]): string[] => xs.map((x) => x.toLowerCase());
  return {
    generic: new Set(lower(vocabularyList(vocab, "generic_elements", where))),
    // The line-based reading needs two pointer lists because it has no element context — `onClick`
    // is deliberately excluded from its markup pattern, where it matched Kotlin Compose modifier
    // chains. A parse tree has the element, and a `.kt` file has no adapter at all, so this side
    // reads the union of the two lists the rule declares rather than a third list of its own.
    pointer: new Set([
      ...lower(vocabularyList(vocab, "pointer_handlers_jsx", where)),
      ...lower(vocabularyList(vocab, "pointer_handlers_markup", where)),
    ]),
    key: lower(vocabularyList(vocab, "key_handlers", where)),
    iconish: new Set(lower(vocabularyList(vocab, "icon_elements", where))),
    nameAttributes: lower(vocabularyList(vocab, "name_attributes", where)),
    presentation: lower(vocabularyList(vocab, "presentation_attributes", where)),
  };
}

/**
 * Does this control have an accessible name anywhere in its subtree?
 *
 * This is the check the line-based reading cannot express, and the reason is structural rather than
 * a matter of pattern craft: in HAML, Slim and Pug a control's name arrives on a LATER LINE than the
 * control, because nesting is indentation.
 *
 * Every name-supplying attribute is tested the same way — it supplies a name when it has non-empty
 * or unknowable content. The prototype made `aria-labelledby` an exception and accepted its mere
 * presence; treating it like the others means `aria-labelledby=""` no longer names a control, which
 * reports MORE rather than fewer, and is what the attribute means.
 */
function hasAccessibleName(n: IrElement, w: Words): boolean {
  const namesSelf = (e: IrElement): boolean => w.nameAttributes.some((a) => supplies(getAttr(e, a)));
  if (namesSelf(n)) return true;
  for (const d of descendants(n)) {
    if (d.kind === "text" && d.content.trim() !== "") return true;
    if (d.kind === "expr") return true;
    if (d.kind !== "element") continue;
    if (namesSelf(d)) return true;
    if (supplies(getAttr(d, "alt"))) return true;
    // An attribute bag this adapter cannot read may carry the name.
    if (d.opaqueAttrs) return true;
  }
  return false;
}

const loc = (n: IrElement, check: string): StructuralFinding => ({
  line: n.line,
  endLine: n.endLine,
  check,
  tag: n.tag ?? "(object)",
});

export function accessibilityElementsV1(
  nodes: IrNode[],
  vocab: Vocabulary | undefined,
  where = "accessibility-elements-v1",
): StructuralFinding[] {
  const w = words(vocab, where);
  const isPointer = (name: string): boolean => w.pointer.has(base(name));
  const isKey = (name: string): boolean => w.key.some((k) => base(name).startsWith(k));
  const hasPointer = (n: IrElement): boolean => anyAttr(n, isPointer);
  const hasKey = (n: IrElement): boolean => anyAttr(n, isKey);
  // The rule's own (D1)/(D2)/(K) patterns negate `role` and `tabindex` and nothing else. This is
  // deliberately NOT `presentation_attributes`, which carries `aria-hidden` as well: adding it here
  // would suppress candidates the line reading raises, and a second eye may only add.
  const suppressedByRole = (n: IrElement): boolean => hasAttr(n, "role") || hasAttr(n, "tabindex");

  const out: StructuralFinding[] = [];
  const visit = (n: IrNode): void => {
    if (n.kind === "element") {
      // A capitalised JSX name is a component, not an HTML element: <Button> is not <button> and
      // <Html> is not <html>. The rule's own patterns are lowercase-only for exactly this reason.
      const isComponent = /^[A-Z]/.test(n.tag ?? "");
      const tag = isComponent ? " component" : (n.tag ?? "").toLowerCase();

      // (A) image with no alt at all. Presence is what is tested, never the value.
      if (tag === "img" && !n.opaqueAttrs) {
        if (!hasAttr(n, "alt") && !w.presentation.some((a) => hasAttr(n, a))) out.push(loc(n, "A"));
      }

      // (B) document root with no lang.
      if (tag === "html" && !n.opaqueAttrs) {
        if (!hasAttr(n, "lang") && !hasAttr(n, "xml:lang")) out.push(loc(n, "B"));
      }

      // (C) positive tabindex, as an attribute or as an object/hash key. Turns on the PRESENCE of a
      // readable value, so an unreadable attribute bag cannot hide it and does not disqualify it.
      const ti = n.attrs.find((a) => bareName(a.name) === "tabindex");
      if (positiveTabindex(ti)) out.push(loc(n, "C"));

      // (D) pointer handler on a generic element with no keyboard path.
      if (w.generic.has(tag) && !n.opaqueAttrs && hasPointer(n) && !hasKey(n) && !suppressedByRole(n)) {
        out.push(loc(n, "D"));
      }

      // (E) anchor carrying a pointer handler and no href of its own.
      if (tag === "a" && !n.opaqueAttrs && hasPointer(n) && !hasAttr(n, "href") && !suppressedByRole(n)) {
        out.push(loc(n, "E"));
      }

      // (F) icon-only control with no accessible name. Requires at least one element inside, so that
      // an empty <button></button> — which the rule's own patterns do not target — is not added by
      // the back door.
      if ((tag === "button" || tag === "a") && !n.opaqueAttrs) {
        const kids = [...descendants(n)].filter((d): d is IrElement => d.kind === "element");
        const iconish = kids.some(
          (d) => w.iconish.has((d.tag ?? "").toLowerCase()) || /^[A-Z]/.test(d.tag ?? ""),
        );
        if (kids.length > 0 && iconish && !hasAccessibleName(n, w)) out.push(loc(n, "F"));
      }
    }
    for (const c of n.children) visit(c);
  };
  for (const n of nodes) visit(n);
  return out;
}

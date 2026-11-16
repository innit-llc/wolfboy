/**
 * THE NAME A PERSON KNOWS AN ITEM BY.
 *
 * Where a rule's items come from the match (`reading_class.item_source` `token`, `clause` or `sub_shape`), the program
 * holds each kept place's item (place-fold.ts). That item is the census's own identity: for `token` the
 * folded matched word, several matched spans of one line joined by "+" (`from "mixpanelbrowser+import mixpanel+mixpanel
 * +mixpanelbrowser`); for `clause` the clause set that fired; for `sub_shape` a digest of the line's shape. None of these
 * is a name a person reads, and one line that matched four spellings of one vendor is one recipient, not four words.
 *
 * So the identity stays what it is (the per-place table keeps it as `program_item`, and the count rests on it), and each
 * item is SHOWN by what the rule itself says it is:
 *   - `token`: the name of the shared vocabulary entry whose anchor the matched word spells ("Mixpanel"), carried by the
 *     build as `detector.vocabulary_owners` and taken by the report from the bundle it is given (`assemble-report
 *     --bundle`, `itemLabelsOfCandidate`). The scanner writes nothing for it: a label is for display, so the findings
 *     document stays what it was. One line naming one vendor however many ways is one item; two vendors on one line are
 *     named both. A matched word that spells no anchor (a construct clause, such as a digest over an email address) is
 *     shown by its matched words, quoted.
 *   - `clause` and `sub_shape`: the rule's own `item` text with the first place of that item ("route kind like the one
 *     at src/ws.ts:12"), because the rule names no clause and a shape digest names nothing a person can open.
 */
import type { Candidate, Rule } from "wolfboy-schemas";
import { foldToken } from "./kind-key.js";

const isAlnum = (ch: string | undefined): boolean => ch !== undefined && /[a-z0-9]/.test(ch);

/** A rule's anchors folded the way the census folds a matched word, each with its owner; the first list's owner wins. */
export interface OwnerIndex {
  /** Folded anchors, longest first. */
  anchors: { folded: string; owner: string }[];
}

/** The owner index of a rule from its bundle `detector.vocabulary_owners`, or null where it carries none. */
export function ownerIndexOf(rule: Rule | undefined): OwnerIndex | null {
  const owners = rule?.detector?.vocabulary_owners;
  if (!owners || typeof owners !== "object") return null;
  const seen = new Map<string, string>();
  for (const list of Object.keys(owners)) {
    const byAnchor = owners[list];
    if (!byAnchor || typeof byAnchor !== "object") continue;
    for (const anchor of Object.keys(byAnchor)) {
      const owner = byAnchor[anchor];
      const folded = foldToken(anchor);
      if (typeof owner !== "string" || owner.length === 0 || folded.length === 0 || seen.has(folded)) continue;
      seen.set(folded, owner);
    }
  }
  if (seen.size === 0) return null;
  return { anchors: [...seen].map(([folded, owner]) => ({ folded, owner })).sort((a, b) => b.folded.length - a.folded.length) };
}

/**
 * The owners a census token spells, in order of first appearance: each "+"-joined part is scanned left to right and,
 * at every place a word may start, the longest folded anchor found there is taken whole (so `mixpanelbrowser` is the
 * anchor `mixpanel-browser`, not `mixpanel` and a remainder). A word boundary is asked for on each side of an anchor
 * whose end is a letter or digit, as `\b` would.
 */
export function ownersOfToken(token: string, index: OwnerIndex): string[] {
  const out: string[] = [];
  for (const part of token.split("+")) {
    let i = 0;
    while (i < part.length) {
      let hit: { folded: string; owner: string } | undefined;
      for (const a of index.anchors) {
        const end = i + a.folded.length;
        if (!part.startsWith(a.folded, i)) continue;
        if (isAlnum(a.folded[0]) && isAlnum(part[i - 1])) continue;
        if (isAlnum(a.folded[a.folded.length - 1]) && isAlnum(part[end])) continue;
        hit = a;
        break;
      }
      if (hit) {
        if (!out.includes(hit.owner)) out.push(hit.owner);
        i += hit.folded.length;
      } else {
        i++;
      }
    }
  }
  return out;
}

/** Whether a candidate's items (or one of its mixed limbs' items) are the matched word. */
function hasTokenItems(candidate: Candidate): boolean {
  const rc = (candidate as unknown as { reading_class?: { class?: unknown; item_source?: unknown; limbs?: unknown } }).reading_class;
  if (!rc || typeof rc !== "object") return false;
  if (rc.class === "enumeration") return rc.item_source === "token";
  if (rc.class !== "mixed" || !Array.isArray(rc.limbs)) return false;
  return rc.limbs.some((l: { class?: unknown; item_source?: unknown }) => l && l.class === "enumeration" && l.item_source === "token");
}

/**
 * The names of a candidate's token items, as the report takes them from its rule in the bundle: for each distinct
 * `matched_token` of its locations that
 * spells an anchor of its rule, the owners' names, sorted and joined by " and " ("Mixpanel"; "PostHog and Sentry").
 * Undefined where the rule's items are not the matched word, the rule carries no owners, or no token spells an anchor.
 */
export function itemLabelsOfCandidate(candidate: Candidate, rule: Rule | undefined): Record<string, string> | undefined {
  if (!hasTokenItems(candidate)) return undefined;
  const index = ownerIndexOf(rule);
  if (!index) return undefined;
  const out: Record<string, string> = {};
  for (const loc of candidate.locations as { matched_token?: unknown }[]) {
    const token = typeof loc.matched_token === "string" ? loc.matched_token : "";
    if (token.length === 0 || Object.prototype.hasOwnProperty.call(out, token)) continue;
    const owners = ownersOfToken(token, index);
    if (owners.length > 0) out[token] = [...owners].sort((a, b) => a.localeCompare(b)).join(" and ");
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * How a token item is shown where no name is known for it (a step that holds no bundle, or a word that spells no
 * anchor): its matched words, each quoted once (a word that is
 * part of a longer matched word of the same line is not repeated), joined by " and ".
 */
export function matchedWordsLabel(token: string): string {
  const parts = [...new Set(token.split("+").map((p) => p.trim()).filter((p) => p.length > 0))];
  const kept = parts.filter((p) => !parts.some((q) => q !== p && q.includes(p)));
  return kept.map((p) => JSON.stringify(p)).join(" and ");
}

/** The rule's own words for what one item is: the class's `item`, or its enumeration limbs' (distinct, joined by " or "). */
export function itemTextOf(candidate: Candidate): string {
  const rc = (candidate as unknown as { reading_class?: { item?: unknown; limbs?: unknown } }).reading_class;
  if (rc && typeof rc.item === "string" && rc.item.trim() !== "") return rc.item.trim();
  const texts = Array.isArray(rc?.limbs)
    ? [...new Set((rc!.limbs as { class?: unknown; item?: unknown }[]).filter((l) => l && l.class === "enumeration" && typeof l.item === "string" && l.item.trim() !== "").map((l) => (l.item as string).trim()))]
    : [];
  return texts.length > 0 ? texts.join(" or ") : "item";
}

/** How a `clause` or `sub_shape` item is shown: the rule's words for an item, and the first place of that item. */
export function firstPlaceLabel(itemText: string, file: string, line: number): string {
  return `${itemText} like the one at ${file}:${line}`;
}

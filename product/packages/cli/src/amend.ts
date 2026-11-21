/**
 * AMEND ON REFUSAL.
 *
 * A refused answer is kept (`capture/refused/`), with what its refusal named. The seat's next hand-back may be its whole
 * answer again, or an AMENDMENT: only the candidates and fields the refusal named, keyed by `finding_id`, and within an
 * entry's `decisions` only the decisions it changes, keyed by `unit` (or `units`). The capture lays the amendment over
 * the kept answer, and the merged whole is what it checks, in full, as any answer: nothing is accepted on the strength
 * of the part the seat did not resend. An amendment that changes a field the refusal did not name is refused, naming
 * that field, so that the parts the check already passed stay as they were (arm H's bin:37 went 13, 3, 1 problems in
 * 2026-09-30's measurement: each resend fixed what was named and broke something else).
 *
 * WHAT A REFUSAL NAMES, per candidate. The capture's rules read `decisions`, `searched` and `evidence` together (a
 * premise and an item name a decision's id; a coverage rule reads the reading block and the evidence at once), so a
 * problem about any of the three names all three. A problem about one other field (`verdict`, `confidence`,
 * `reasoning`, ...) names that field. A candidate the refusal says is missing, doubled or not handed is named whole, as
 * is every candidate when a problem names no candidate. A reader's reply is decisions only, and is named whole.
 *
 * WHICH ANSWER IS AN AMENDMENT: one that leaves out something the kept answer carried and a whole answer must carry: a
 * candidate, a field the reply schema requires of an entry, or a unit the entry's `decisions` decided. Anything else is a
 * whole answer. For an adjudicator the form decides nothing any more (below): a
 * whole answer is laid over the kept one by the same rule, and is kept as the seat's own bytes only where that changes
 * nothing (verdict-capture.ts). A refuter's whole answer is still checked as it stands.
 *
 * WHAT A REFUSAL TOLD THE SEAT TO TAKE OUT IS NOT PART OF THE BASE. Some
 * rows and objects are refused for what they are, not for what they say: a place row for a place not handed (`foreign`),
 * one recorded as not checked (`unreadable`) or one a seat before this one read and the capture kept (`kept`); a row
 * that is no row object, names no place or unit, or is a group or old-form row; a decision naming no id of the census, a
 * member as a unit, both forms at once, or a unit a reader does not hold; an object for a candidate not handed, every
 * object of a candidate answered more than once (neither is kept), or one with no `finding_id`. The
 * seat is told to remove each, or to give it under another id, so no later decision replaces it by its id. Were it part
 * of the base, an answer leaving it out would be read as an amendment and the merge would bring it back, refused again
 * on every answer up to the cap (RA5, RA5b).
 * So the refusal records them (`RefusalRemoved`, by position in the answer it checked), and they are taken out of the
 * kept answer before the next one is read as an amendment or laid over it (`withoutRemoved`). Nothing else is taken
 * out: a row refused for what it says (a decision word, a quotation, a line) stays in the base and is checked again until
 * the seat replaces it, and the merged whole is checked in full as before.
 *
 * ONE RULE FOR EVERY RESEND (the parent's decision; it closes the class
 * where the form of a resend changed what was kept and a finding came out lighter than the seat's answer, found three
 * times). After a refusal, an adjudicator's next answer, whole or an amendment, changes only what the
 * refusal named (`RESEND_RULE`, said once in every refusal and in the seat's instructions):
 * - every entry field and every part of `standing` the refusal did not name keeps its value from the answer before: left
 *   out, it is kept; sent with another value or as `null`, it is a change the refusal did not name, refused naming it. After
 *   the last refusal it still keeps the answer invalid (the seat's candidates not judged): setting it aside would take the
 *   value of an answer the seat moved on from, which can be lighter than its latest word (an earlier dismissal kept over a
 *   later violation), the path removed with the backstop (test:relay-seat's "no
 *   backstop" cases). Only a change to words never read for the finding's place (`reasoning`, `standing.effect`,
 *   `standing.fix`: `WORDS_ONLY`) is set aside there, the words before kept and the record saying so (`ResendNote`, kind
 *   `unnamed`), so that a whole answer that rewrites its reasoning does not cost the seat's bin; the rest is a proposal;
 * - what the refusal named follows the resend: a value replaces it, `null` takes it out (`standing: null` the block, where
 *   the refusal named the block), and leaving it out keeps it; an object or row the refusal told the seat to remove
 *   (`RefusalRemoved`) is not part of the base, and a key it told the seat to move stays where it was written until the
 *   answer moves it, or writes it as `null` where it is or where it belongs.
 * A refusal names inside `standing` by part (`standing.<part>`, standing.ts `checkStanding`); the whole block only where the
 * block itself was refused. Naming widens only where a correction needs it: one part of the status group names the group
 * (standing.ts `STANDING_STATUS_GROUP`), `verdict` names `standing` (the verdict decides which parts the block may hold),
 * `evidence` lets each part's `at`, and `decisive`, point again into the evidence it names (never a part's value),
 * anything named of a candidate names its `reasoning` (it explains the answer, and is never read for its place), and a
 * rule over the reading and the verdict together (verdict-capture.ts, the entry's rules) names `verdict` and `confidence`.
 * A key written out of its place and never moved (a part beside `standing`, a field of the entry inside it) stays in the
 * merged whole where the seat wrote it, so it is refused again with its place and its value stays in the chain; after
 * the last refusal a part is placed inside `standing` by the program where that does not make the finding lighter
 * (standing.ts `placingLightens`), else set aside, and the record says which (kind `unplaced`).
 * R2 is decided by the same rule: a part the refusal did not name that the seat wrote, and that passed its checks, is
 * kept, whatever it does to the count; the program does not read an intent from an omission.
 *
 * THE OUTCOME, NOT THE INPUTS (the parent's decision).
 * Each widening above lets a correction pass that the strict naming would refuse, and each opened more than that
 * correction needs (`evidence` let `decisive` lend a not-shipped premise; `verdict` opened the whole block on a kept
 * verdict; a status partner reopened a status that stood). Patching each widening leaves the next one open, so the
 * capture guards the outcome instead (verdict-capture.ts `captureAnswer`): it lays the answer over twice, once as named
 * (the merge above) and once STRICTLY (`ResendOptions.strict`: only what the refusal's own problems named, with none of
 * the widenings, `nameIn`'s `strict`), and weighs the finding each makes as the program would report it
 * (finding-weight.ts `outcomeWeightOf`). Where the answer as named makes a finding lighter than the strict one does (a
 * lower level, out of the count, a weaker status, a disposition further from "to fix"), the lightening came through
 * something the refusal did not name: the changes only a widening let in (words only aside, which no finding's place
 * reads) are refused by name, as an unnamed change is, and the kept answer takes each back to its value in the strict
 * merge (`RefusalRemoved.restored`), so a later answer cannot carry it in by leaving it out. The widenings stay: a
 * correction through one passes wherever it does not make the finding lighter. The rule is said once, in `RESEND_RULE`:
 * a change may make the finding lighter only through what the refusal itself names.
 *
 * WHAT A REFUSAL ITSELF NAMES, AND WHAT A POINTER IS. Because the guard
 * stops a lighter outcome, the refusal's own naming is as wide as a correction needs: a status set aside names its four
 * partners (standing.ts `STATUS_PARTNERS`), so its correction may be another status with that status's own part; a
 * verdict names `settles` (`nameIn`), the reason a `needs_human` is one. A part's `E<n>` is the entry it names, not the
 * number (`pointedAs`). A part the answer did not send keeps
 * the quotation it named, as named and strictly alike, and names no entry where the answer took that quotation out, which
 * is never put back (`followPointers`).
 */

import { evidenceId, evidenceIndexOf } from "./ref-ids.js";
import { ENTRY_FIELDS, STANDING_PARTS, STANDING_STATUS_GROUP, placingLightens } from "./standing.js";
import type { CaptureRole } from "./verdict-capture.js";

/**
 * The rule every adjudicator's refusal states once (verdict-capture.ts
 * `renderRefusal`), in the words the seat's instructions use (legal-adjudicator.md; test:verdict-capture checks both).
 */
export const RESEND_RULE =
  "After a refusal, your next answer, whole or with only the fields you change, changes only what the refusal names and what correcting it needs. The refusal names each field and each part of `standing` it refused; with a status, also `element`, `exemption`, `question` and `fact`; with `verdict`, also `settles`. Correcting it may also change: your `reasoning`; with a part of a status, the status, the parts that go with it, `effect` and `fix`; with `verdict`, all of `standing`; with `evidence`, where `decisive` and each part's `at` point into it. A change may make the finding lighter only through what the refusal itself names; what correcting it also lets you change may not make it lighter. An `E<n>` you send names the entry at that place in `evidence`; a `decisive` or an `at` you leave out keeps the quotation it named: where your answer moves entries it follows that quotation, and where your answer removes that quotation it names none and is refused, so point it at another quotation in that answer. A finding whose `decisive` names no quotation (absent from the block, set aside after your last refusal, or naming no entry) is placed at the heaviest of its quotations and kept places, never at the first by order. Every other field, and every other part of `standing`, keeps its value from the refused answer, whether you send it again or leave it out, and a different value or `null` for one of them is refused. What you may change takes what you send: a value replaces it, `null` takes it out, and leaving it out keeps it. A key the refusal tells you to move stays where you wrote it until you move it, or write it as `null` where it is or where it belongs; where `standing` already holds a part of that name, `null` inside `standing` takes out that part too, so write the key as `null` where it is. An object or row it tells you to remove is taken out.";

/** Where a refused answer is kept (the merged whole, where it was an amendment), relative to `.legal/`. */
export const REFUSED_DIR = "capture/refused";

/** What one refusal named: per candidate (`finding_id`; "" for a reader's reply, "*" for every candidate), its fields ("*": all). */
export type RefusalNamed = Record<string, string[]>;

/**
 * What one refusal told the seat to take out (module comment), by position in the answer the refusal checked (the answer
 * as kept under `capture/refused/`): `objects`, the positions of whole objects; `rows`, per object by its position (""
 * for a reader, whose reply is its rows), the positions of rows of its `decisions`.
 */
export interface RefusalRemoved {
  objects?: number[];
  rows?: Record<string, number[]>;
  /**
   * Per object by its position,
   * the keys refused as no field of the reply format (`fix` written beside `standing`): refused for where they are, so an
   * amendment that moves one to its place, and leaves it out here, is not merged back over the key it moved. A key written inside `standing` that is no part of it (a field of the
   * entry, or no field anywhere) is refused for where it is too, and named `standing.<key>`: it is taken out of the base's
   * `standing`, which an answer after the refusal keeps part by part and could otherwise never leave it out of.
   */
  fields?: Record<string, string[]>;
  /**
   * Per object by its position, the object the base takes in its
   * place, where the answer as named made its finding lighter (module comment, THE OUTCOME): the candidate with each
   * change that made the difference taken back to its value in the strict merge, as a change the refusal did not name is
   * never laid over, so leaving it out of the next answer keeps the value before it.
   */
  restored?: Record<string, unknown>;
}

const STANDING_PREFIX = "standing.";

/** The kept answer without what its refusal told the seat to take out (module comment); the answer itself where nothing was. */
export function withoutRemoved(role: CaptureRole, kept: unknown[], removed?: RefusalRemoved): unknown[] {
  if (!removed) return kept;
  const strip = (decisions: unknown[], key: string): unknown[] => {
    const out = new Set(removed.rows?.[key] ?? []);
    return out.size > 0 ? decisions.filter((_, i) => !out.has(i)) : decisions;
  };
  if (role === "reader") return strip(kept, "");
  const objects = new Set(removed.objects ?? []);
  return kept.flatMap((e0, i) => {
    if (objects.has(i)) return [];
    const e = removed.restored && String(i) in removed.restored ? removed.restored[String(i)] : e0;
    const r0 = asRecord(e);
    const stray = removed.fields?.[String(i)] ?? [];
    const inStanding = stray.filter((k) => k.startsWith(STANDING_PREFIX)).map((k) => k.slice(STANDING_PREFIX.length));
    let r = r0 && stray.length > 0 ? Object.fromEntries(Object.entries(r0).filter(([k]) => !stray.includes(k))) : r0;
    const std = asRecord(r?.standing);
    if (r && std && inStanding.length > 0) r = { ...r, standing: Object.fromEntries(Object.entries(std).filter(([k]) => !inStanding.includes(k))) };
    if (r && Array.isArray(r.decisions) && removed.rows?.[String(i)]) return [{ ...r, decisions: strip(r.decisions, String(i)) }];
    return [r && stray.length > 0 ? r : e];
  });
}

/** The fields a problem about any one of them names together. */
export const READING_FIELDS: readonly string[] = ["decisions", "searched", "evidence"];

const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const unitOf = (id: string): string => id.split("/")[0]!;

/** The ids one decision decides: its `unit`, or the `units` it declines, or (build unit F3) the one `place` it decides. */
function decisionIds(d: unknown): string[] {
  const r = asRecord(d);
  if (!r) return [];
  if (typeof r.place === "string" && !("unit" in r) && !("units" in r)) return [r.place];
  if (Array.isArray(r.units)) return r.units.filter((u): u is string => typeof u === "string");
  return typeof r.unit === "string" ? [r.unit] : [];
}

/** Two ids decide the same thing: the same id, or a unit and one of its sub-shapes. */
const overlaps = (a: string, b: string): boolean => a === b || (!a.includes("/") && unitOf(b) === a) || (!b.includes("/") && unitOf(a) === b);

/** The units a list of decisions decides (by unit, sub-shapes folded into their unit). */
const decidedUnits = (decisions: unknown): Set<string> => new Set((Array.isArray(decisions) ? decisions : []).flatMap(decisionIds).map(unitOf));

/**
 * THE MERGE OF DECISIONS, keyed by id: each amendment decision replaces every kept decision of the same id (a unit's
 * decision and its sub-shapes' replace each other), a unit an amendment decides leaves any kept declining group, and
 * the replacement stands where the first decision it replaced stood; a decision replacing nothing is added at the end.
 */
export function mergeDecisions(kept: readonly unknown[], amendment: readonly unknown[]): unknown[] {
  let out: unknown[] = [...kept];
  for (const next of amendment) {
    const ids = decisionIds(next);
    let at = -1;
    const kept2: unknown[] = [];
    out.forEach((d) => {
      const r = asRecord(d);
      const dIds = decisionIds(d);
      const hit = dIds.filter((x) => ids.some((y) => overlaps(x, y)));
      if (hit.length === 0) {
        kept2.push(d);
        return;
      }
      if (at < 0) at = kept2.length;
      // A declining group keeps the units the amendment does not decide.
      if (r && Array.isArray(r.units) && hit.length < dIds.length) kept2.push({ ...r, units: dIds.filter((x) => !hit.includes(x)) });
    });
    out = kept2;
    out.splice(at < 0 ? out.length : at, 0, next);
  }
  return out;
}

/** The required fields of one entry of a role's reply (the reply schema's `items.required`); none for a reader. */
export type RequiredOfEntry = readonly string[];

const idOf = (role: CaptureRole, e: unknown): string | null => {
  const r = asRecord(e);
  if (role === "reader") return null;
  return r && typeof r.finding_id === "string" ? r.finding_id : null;
};

/**
 * Whether `next` is an amendment of `kept` (module comment), and why. null: a whole answer. `removed`: what the refusal
 * of `kept` told the seat to take out, which an answer may leave out and still be whole (fix R1).
 */
export function amendmentReason(role: CaptureRole, keptAnswer: unknown, next: unknown, required: RequiredOfEntry, removed?: RefusalRemoved): string | null {
  if (!Array.isArray(keptAnswer) || !Array.isArray(next) || next.length === 0) return null;
  const kept = withoutRemoved(role, keptAnswer, removed);
  if (role === "reader") {
    const now = decidedUnits(next);
    const left = [...decidedUnits(kept)].filter((u) => !now.has(u));
    return left.length > 0 ? `it decides no unit ${left.join(", ")}, which the refused answer decided` : null;
  }
  if (role !== "adjudicator" && role !== "refuter") return null;
  if (next.some((e) => idOf(role, e) === null)) return null; // an amendment is keyed by finding_id, every entry
  const byId = new Map(next.map((e) => [idOf(role, e)!, asRecord(e)!]));
  for (const k of kept) {
    const id = idOf(role, k);
    const r = asRecord(k);
    if (!id || !r) continue;
    const n = byId.get(id);
    if (!n) return `it carries no object for ${id}, which the refused answer carried`;
    const lacking = required.filter((f) => f in r && !(f in n));
    if (lacking.length > 0) return `its object for ${id} leaves out ${lacking.map((f) => `\`${f}\``).join(", ")}`;
    if (Array.isArray(r.decisions) && Array.isArray(n.decisions)) {
      const now = decidedUnits(n.decisions);
      const left = [...decidedUnits(r.decisions)].filter((u) => !now.has(u));
      if (left.length > 0) return `its object for ${id} decides no unit ${left.join(", ")}, which the refused answer decided`;
    }
  }
  return null;
}

/** JSON with every object's keys in order: the same answer whatever order its keys were written in. */
export const canonical = (v: unknown): string | undefined =>
  JSON.stringify(v, (_k, x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]])) : x));

/**
 * What the program did after the seat's last refusal with what its last answer
 * wrote that the rule does not let stand as written (module comment), for the record (verdict-capture.ts).
 */
export interface ResendNote {
  finding_id: string;
  /** The entry's field, or `standing.<part>`. */
  path: string;
  /** What the seat wrote there. */
  value: unknown;
  /** `placed`: put where the refusals said it belongs; `set_aside`: not used, the value before kept (or none). */
  taken: "placed" | "set_aside";
  /**
   * `unnamed`: a change the last refusal did not name, to words only (`WORDS_ONLY`); `unplaced`: a key written out of its
   * place and never moved; `held`: a part written beside
   * `standing`, never moved, whose block holds that part already: the stray value is set aside and the block's own part is
   * kept (the record's `after_last_refusal[]`, never `standing_set_aside[]`, which would set the block's own part aside);
   * `unpointed`: a part whose quotation the answer after the last
   * refusal took out of `evidence` (`followPointers`), set aside by the standing check (S2, `standing_set_aside[]`); this
   * says why, with the part as the seat wrote it.
   */
  kind: "unnamed" | "unplaced" | "held" | "unpointed";
  why: string;
}

/** The record's words for each `ResendNote` (module comment). The set-aside part's is read by the report (assemble-report.ts `asideReasonWords`). */
export const RESEND_WHY = {
  unnamed: "a change the last refusal did not name, to words never read for the finding's place, in the answer after the last refusal: set aside, and the words of the answer before are kept",
  placed: "written beside `standing` and never placed inside it by the review after the refusals that said where it belongs: placed there by the program after the last refusal, where it does not make the finding lighter",
  lighter: (part: string): string => `\`${part}\` was written beside \`standing\` and never placed inside it after the refusals that said where it belongs; placed there it would make the finding lighter, so after the last refusal it is set aside`,
  taken: (part: string): string => `\`${part}\` was written beside \`standing\` and never placed inside it after the refusals that said where it belongs, and \`standing\` holds a \`${part}\` of its own, which is kept, so after the last refusal this one is set aside`,
  noBlock: (part: string): string => `\`${part}\` was written beside \`standing\` and never placed inside it after the refusals that said where it belongs, and \`standing\` is not an object it can be placed in, so after the last refusal it is set aside`,
  field: "written inside `standing` and never moved beside it by the review after the refusals that said where it belongs: set aside after the last refusal",
  unpointed: "the answer after the last refusal took out of `evidence` the quotation this part named and left the part as it was, so it names no entry and is set aside; the quotation is not put back",
} as const;

export interface Amended {
  /** The kept answer with every change the refusal named laid over it: the answer checked, and kept if refused. */
  merged: unknown;
  /** Each (candidate, field or `standing.<part>`) the answer changed, whether the refusal named it, and whether it was set aside after the last refusal. */
  changes: { id: string; field: string; named: boolean; setAside?: boolean }[];
  /** The problems of the changes the refusal did not name, which are left out of `merged` (`outsideNamed`). */
  outside: string[];
  /** After the last refusal: the keys out of place that were placed or set aside (`ResendNote`). */
  notes: ResendNote[];
}

/** How the answer is laid over: after the seat's last refusal (`lastAnswer`), and whether it was a whole answer (the refusal's words only). */
export interface ResendOptions {
  lastAnswer?: boolean;
  whole?: boolean;
  /**
   * Laid over STRICTLY (module comment, THE OUTCOME): `named` is
   * what the refusal's own problems named (`nameIn` with `strict`), and `evidence` lets no part point again into it.
   */
  strict?: boolean;
  /** What a refusal line says the last refusal named (`outsideNamed`'s "it named ..."): its strict names, where the caller has them; else `named`. */
  said?: RefusalNamed;
}

/**
 * The fields that are words only: shown, never read for a finding's
 * place, its order, its level or the count (the order reads `standing` parts by value; `effect` and `fix` it never reads).
 * Keeping the words before cannot make a finding lighter, so after the last refusal a change to one of them that the
 * refusal did not name is set aside rather than keeping the answer invalid (module comment).
 */
export const WORDS_ONLY: readonly string[] = ["reasoning", "standing.effect", "standing.fix"];

const allows = (named: RefusalNamed, id: string, field: string): boolean =>
  Boolean(named["*"]?.includes("*") || named[id]?.includes("*") || named[id]?.includes(field));
/** A part of `standing` is named by its own name, or by the whole block. */
const allowsPart = (named: RefusalNamed, id: string, part: string): boolean => allows(named, id, "standing") || Boolean(named[id]?.includes(`${STANDING_PREFIX}${part}`));
/** Only where a part points again into the evidence the refusal named: `decisive`, or a part whose value is unchanged and whose `at` is not. */
const repoints = (part: string, before: unknown, now: unknown): boolean => {
  if (part === "decisive") return typeof before === "string" && typeof now === "string";
  const b = asRecord(before);
  const n = asRecord(now);
  return b !== null && n !== null && canonical({ ...b, at: null }) === canonical({ ...n, at: null });
};

/**
 * The kept answer with the answer after its refusal laid over it (module comment): for an adjudicator, the one rule of
 * every resend; for a refuter, an amendment's fields replace the kept ones and a whole answer is not laid over. A change
 * the refusal did not name is not laid over: it is refused by name (`outside`), and the whole checked and kept is the
 * kept answer with the named changes only, so that a later answer cannot carry in what this one was refused for (after
 * the last refusal too: module comment). It is laid over the kept answer without what the refusal told the seat to take
 * out (`removed`, fix R1).
 */
export function mergeAmendment(role: CaptureRole, keptAnswer: unknown[], next: unknown[], named: RefusalNamed = { "*": ["*"] }, removed?: RefusalRemoved, opts: ResendOptions = {}): Amended {
  const kept = withoutRemoved(role, keptAnswer, removed);
  const changes: Amended["changes"] = [];
  const notes: ResendNote[] = [];
  if (role === "reader") {
    const merged = mergeDecisions(kept, next);
    if (canonical(merged) !== canonical(kept)) changes.push({ id: "", field: "decisions", named: true });
    return { merged, changes, outside: [], notes };
  }
  const own = role === "adjudicator";
  const last = own && opts.lastAnswer === true;
  const change = (id: string, field: string, value: unknown, ok: boolean, apply: () => void): void => {
    const aside = !ok && last && WORDS_ONLY.includes(field);
    changes.push({ id, field, named: ok, ...(aside ? { setAside: true } : {}) });
    if (ok) apply();
    else if (aside) notes.push({ finding_id: id, path: field, value, taken: "set_aside", kind: "unnamed", why: RESEND_WHY.unnamed });
  };
  const merged: unknown[] = kept.map((e) => e);
  for (const n of next) {
    const id = idOf(role, n)!;
    const amendment = asRecord(n)!;
    const at = merged.findIndex((e) => idOf(role, e) === id);
    if (at < 0) {
      const ok = allows(named, id, "*");
      changes.push({ id, field: "*", named: ok });
      if (ok) merged.push(amendment);
      continue;
    }
    const base = asRecord(merged[at]) ?? {};
    const out: Record<string, unknown> = { ...base };
    // The evidence the entry holds after this answer, which its pointers name.
    const evidence = { before: base.evidence, now: own && "evidence" in amendment && allows(named, id, "evidence") ? (amendment.evidence === null ? undefined : amendment.evidence) : base.evidence };
    for (const [field, value] of Object.entries(amendment)) {
      if (field === "finding_id") continue;
      if (field === "standing" && own) {
        layStanding(id, base.standing, value, out, named, change, opts.strict === true, evidence);
        continue;
      }
      // An adjudicator's `null` takes a named field out (module comment); a refuter's is laid over as it was.
      const now = own && value === null ? undefined : field === "decisions" && Array.isArray(base.decisions) && Array.isArray(value) ? mergeDecisions(base.decisions, value) : value;
      if (canonical(now) === canonical(base[field])) continue;
      change(id, field, value, allows(named, id, field), () => {
        if (now === undefined) delete out[field];
        else out[field] = now;
      });
    }
    if (own) {
      // After the last refusal a part that names no entry is set aside by
      // the standing check (S2) and the record says why (`RESEND_WHY.unpointed`).
      const unpointed = (part: string, value: unknown): void => {
        if (last) notes.push({ finding_id: id, path: `${STANDING_PREFIX}${part}`, value, taken: "set_aside", kind: "unpointed", why: RESEND_WHY.unpointed });
      };
      followPointers(id, base, out, asRecord(amendment.standing), named, change, opts.strict === true, unpointed);
    }
    merged[at] = out;
  }
  if (own) placeStrays(keptAnswer, next, merged, removed, last, notes);
  return { merged, changes, outside: outsideNamed(changes, opts.said ?? named, opts.whole === true, role), notes };
}

/**
 * A POINTER IS ITS QUOTATION (the non-author check of D5FIX4, F2). A part's
 * `at` and `decisive` that name `E<n>` name the entry at that place in the verdict's `evidence`, so the place they rest on
 * is that entry's file, lines and quotation, never the number. Before, a part was compared by its string: an answer that
 * reordered or replaced `evidence` under an unchanged `decisive` moved the finding's decisive place (into a test file,
 * whose premise then filled `ships`) with no change to any part, and the guard weighed nothing. Now a part is compared by
 * what it names (`pointedAs`): one whose `E<n>` names another entry than before is a change of that part, even under the
 * same number, and one moved with its quotation (a new number, the same entry) is no change.
 *
 * A PART THE ANSWER DID NOT SEND KEEPS ITS QUOTATION (the
 * non-author check of D5FIX5; the parent's decision closing the class). As named and strictly alike: a part this answer
 * left out (or sent with a change that was not laid) follows the quotation its `E<n>` named, at its number in the evidence
 * now; a quotation the answer corrected in place (its `lines` or `quote`, the file the same) is the same quotation, so an
 * empty quotation filled or a line number fixed keeps every pointer on it. Before, as named, such a part kept its number, a change named through `evidence`: an ordinary slip (an empty
 * quotation removed, a quotation inserted at the front, the pointers not renumbered) moved every pointer onto another
 * line, the guard refused it wherever that line was lighter, and at the last answer that refusal cost the bin (B1). Where
 * the answer took that quotation out of `evidence`, the part names no entry (its `at`, or `decisive`, is `null`): the
 * standing check refuses it (S2), and after the last refusal sets it aside, the record saying why (`RESEND_WHY.unpointed`).
 * It is never put back into `evidence`: before, the strict merge added it back at the end, and the guard's restore took
 * that `evidence`, so the empty quotation the first refusal told the seat to remove came back and no next answer could be
 * accepted (B2). A part the answer sent again as it was keeps its number (the entry now there): a change of that part,
 * named by the part itself or by `evidence` (the pointer widening, which the guard weighs). With no usable `decisive`, nothing is followed and nothing is
 * written: the decisive place is the heaviest of the finding's places, computed wherever it is read (finding-weight.ts
 * `decisivePlaceOf`), so the order of `evidence` decides nothing (A2). Before, the first quotation stood in, and the merge
 * wrote the one that stood in before an answer as `decisive`, which a removed quotation then set aside (R6a).
 */
const quotationKey = (e: unknown): string | undefined => {
  const r = asRecord(e);
  return r ? canonical({ file: r.file, lines: r.lines, quote: r.quote }) : undefined;
};
const pointerOf = (part: string, v: unknown): unknown => (part === "decisive" ? v : asRecord(v)?.at);
const quotationAt = (evidence: unknown, pointer: unknown): unknown => {
  const i = evidenceIndexOf(pointer);
  return i === null || !Array.isArray(evidence) ? undefined : evidence[i];
};
/** A part's value with its `E<n>` read as the entry it names (module comment of `followPointers`). */
const pointedAs = (part: string, v: unknown, evidence: unknown): string | undefined => {
  const p = pointerOf(part, v);
  if (evidenceIndexOf(p) === null) return canonical(v);
  const q = `the quotation ${quotationKey(quotationAt(evidence, p)) ?? "none"}`;
  return part === "decisive" ? q : canonical({ ...asRecord(v), at: q });
};

/**
 * The parts of `standing` whose `E<n>` now names another entry than before (`pointedAs`; module comment of `pointedAs`):
 * each follows its quotation, or names no entry where the answer took it out
 * (`unpointed`); one the answer sent again as it was is a change of the part, where the refusal named it or named
 * `evidence` (the pointer widening; never in the strict merge).
 */
function followPointers(
  id: string,
  base: Record<string, unknown>,
  out: Record<string, unknown>,
  sent: Record<string, unknown> | null,
  named: RefusalNamed,
  change: (id: string, field: string, value: unknown, ok: boolean, apply: () => void) => void,
  strict: boolean,
  unpointed: (part: string, value: unknown) => void,
): void {
  const b = asRecord(base.standing);
  const held = asRecord(out.standing);
  if (!b || !held || canonical(base.evidence) === canonical(out.evidence)) return;
  const o: Record<string, unknown> = { ...held };
  const pointers = !strict && allows(named, id, "evidence");
  const was = Array.isArray(base.evidence) ? (base.evidence as unknown[]) : [];
  const now = Array.isArray(out.evidence) ? (out.evidence as unknown[]) : [];
  const fresh = (e: unknown): boolean => !was.some((x) => quotationKey(x) === quotationKey(e));
  /**
   * The `E<n>` of the quotation at index `i` before, in the evidence after this answer: where it now is; else, where the
   * answer corrected it in place (its `lines` or `quote`), the entry of the same file that was no entry before, at the same
   * index or the only one; else null, the answer took it out (it is never put back).
   */
  const pointerTo = (i: number): string | null => {
    const q = asRecord(was[i]);
    if (!q) return null;
    const k = now.findIndex((e) => quotationKey(e) === quotationKey(q));
    if (k >= 0) return evidenceId(k);
    const same = now.flatMap((e, n) => (asRecord(e)?.file === q.file && fresh(e) ? [n] : []));
    if (same.includes(i)) return evidenceId(i);
    return same.length === 1 ? evidenceId(same[0]!) : null;
  };
  let moved = false;
  for (const part of Object.keys(o)) {
    if (canonical(o[part]) !== canonical(b[part])) continue;
    if (pointedAs(part, b[part], out.evidence) === pointedAs(part, b[part], base.evidence)) continue;
    if (sent !== null && part in sent && canonical(sent[part]) === canonical(b[part]) && (allowsPart(named, id, part) || pointers)) {
      change(id, `${STANDING_PREFIX}${part}`, b[part], true, () => undefined);
      continue;
    }
    const i = evidenceIndexOf(pointerOf(part, b[part]));
    if (i === null || i >= was.length) continue;
    const p = pointerTo(i);
    o[part] = part === "decisive" ? p : { ...asRecord(b[part]), at: p };
    if (p === null) unpointed(part, b[part]);
    moved = true;
  }
  if (moved) out.standing = o;
}

/** `standing` laid over part by part (module comment). */
function layStanding(
  id: string,
  before: unknown,
  sent: unknown,
  out: Record<string, unknown>,
  named: RefusalNamed,
  change: (id: string, field: string, value: unknown, ok: boolean, apply: () => void) => void,
  strict = false,
  evidence: { before: unknown; now: unknown } = { before: undefined, now: undefined },
): void {
  const whole = allows(named, id, "standing");
  if (sent === null) {
    if (before !== undefined) change(id, "standing", null, whole, () => delete out.standing);
    return;
  }
  const b = before === undefined ? {} : asRecord(before);
  const s = asRecord(sent);
  // A value that is no object, or a kept block that is none: the block as one value.
  if (!s || !b) {
    if (canonical(sent) !== canonical(before)) change(id, "standing", sent, whole, () => (out.standing = sent));
    return;
  }
  const o: Record<string, unknown> = { ...b };
  const pointers = !strict && allows(named, id, "evidence");
  for (const [part, v] of Object.entries(s)) {
    const now = v === null ? undefined : v;
    if (canonical(now) === canonical(b[part])) continue;
    // A pointer moved with its quotation names the same entry: no change.
    if (now !== undefined && pointedAs(part, now, evidence.now) === pointedAs(part, b[part], evidence.before)) {
      o[part] = now;
      continue;
    }
    change(id, `${STANDING_PREFIX}${part}`, v, allowsPart(named, id, part) || (pointers && repoints(part, b[part], v)), () => {
      if (now === undefined) delete o[part];
      else o[part] = now;
    });
  }
  if (before !== undefined || Object.keys(o).length > 0) out.standing = o;
}

const isPart = (k: string): boolean => (STANDING_PARTS as readonly string[]).includes(k) && !ENTRY_FIELDS().includes(k);

/**
 * Keys written out of their place (module comment). Before the last refusal: a key the refusal took out for where it was
 * (`removed.fields`) that this answer neither puts in its place nor writes as `null` there stays where the seat wrote it,
 * so the check refuses it again with its place, and its value stays in the merged whole the next answer amends (F3's
 * gap, R3). After the last refusal: every part of `standing` beside it, so taken out or written again, is placed inside
 * by the program where that does not make the finding lighter and the block does not hold one, else set aside; a field
 * of the entry never moved out of `standing` is set aside.
 */
function placeStrays(keptAnswer: unknown[], next: unknown[], merged: unknown[], removed: RefusalRemoved | undefined, last: boolean, notes: ResendNote[]): void {
  const sentOf = (id: string): Record<string, unknown> => asRecord(next.find((e) => idOf("adjudicator", e) === id)) ?? {};
  const pending = new Map<string, { beside: Map<string, unknown>; inside: Map<string, unknown> }>();
  for (const [pos, keys] of Object.entries(removed?.fields ?? {})) {
    const was = asRecord(keptAnswer[Number(pos)]);
    const id = idOf("adjudicator", was);
    if (!was || !id) continue;
    const sent = sentOf(id);
    const sentStanding = asRecord(sent.standing) ?? {};
    const p = pending.get(id) ?? { beside: new Map<string, unknown>(), inside: new Map<string, unknown>() };
    // A key out of place is settled where the answer writes it
    // at its place (any value), or writes it as `null` where it was written (`RESEND_RULE`: "write it as `null` where it is
    // or where it belongs"); left out, it stays where it was written.
    for (const k of keys) {
      if (k.startsWith(STANDING_PREFIX)) {
        const key = k.slice(STANDING_PREFIX.length);
        const value = asRecord(was.standing)?.[key];
        if (ENTRY_FIELDS().includes(key) && !(key in sent) && sentStanding[key] !== null && value !== undefined) p.inside.set(key, value);
      } else if (isPart(k) && !(k in sentStanding) && sent[k] !== null && was[k] !== undefined) p.beside.set(k, was[k]);
    }
    pending.set(id, p);
  }
  merged.forEach((e, at) => {
    const id = idOf("adjudicator", e);
    const r = asRecord(e);
    if (!id || !r) return;
    const out: Record<string, unknown> = { ...r };
    const p = pending.get(id);
    const std = (): Record<string, unknown> | null => (out.standing === undefined ? {} : asRecord(out.standing));
    if (!last) {
      for (const [k, v] of p?.beside ?? []) if (!(k in out)) out[k] = v;
      for (const [k, v] of p?.inside ?? []) {
        const s = std();
        if (s && !(k in s)) out.standing = { ...s, [k]: v };
      }
    } else {
      const beside = new Map(p?.beside ?? []);
      for (const k of Object.keys(out)) if (isPart(k)) beside.set(k, out[k]);
      for (const [k, v] of beside) {
        delete out[k];
        const s = std();
        const path = `${STANDING_PREFIX}${k}`;
        if (!s) notes.push({ finding_id: id, path, value: v, taken: "set_aside", kind: "unplaced", why: RESEND_WHY.noBlock(k) });
        else if (k in s) notes.push({ finding_id: id, path, value: v, taken: "set_aside", kind: "held", why: RESEND_WHY.taken(k) });
        else if (placingLightens(k, v)) notes.push({ finding_id: id, path, value: v, taken: "set_aside", kind: "unplaced", why: RESEND_WHY.lighter(k) });
        else {
          out.standing = { ...s, [k]: v };
          notes.push({ finding_id: id, path, value: v, taken: "placed", kind: "unplaced", why: RESEND_WHY.placed });
        }
      }
      for (const [k, v] of p?.inside ?? []) notes.push({ finding_id: id, path: k, value: v, taken: "set_aside", kind: "unplaced", why: RESEND_WHY.field });
    }
    merged[at] = out;
  });
}

/**
 * The reply an answer after a refusal makes: the kept answer with it laid over (`mergeAmendment`), as JSON with two-space
 * indentation and a final newline. This is the merged whole the capture checks and, accepted, keeps as the record's reply
 * (verdict-capture.ts `captureAnswer`); the assembly makes it again from the kept refused answer and the seat's hand-back
 * to prove an amended record (assemble-hooked.ts `amendmentProblem`), with `lastAnswer` as the hook
 * counted it. One copy for both.
 */
export function amendedReply(role: CaptureRole, kept: unknown[], next: unknown[], named?: RefusalNamed, removed?: RefusalRemoved, opts: ResendOptions = {}): Amended & { bytes: Buffer } {
  const m = mergeAmendment(role, kept, next, named, removed, opts);
  return { ...m, bytes: Buffer.from(`${JSON.stringify(m.merged, null, 2)}\n`, "utf8") };
}

/**
 * The fields one problem names (module comment): its field path's first name, or the reading group; inside `standing`,
 * the part.
 */
export function fieldsNamed(field: string): string[] {
  const top = /^[a-z_]+/.exec(field)?.[0] ?? "";
  if (top === "") return ["*"];
  if (top === "reading" || READING_FIELDS.includes(top)) return [...READING_FIELDS];
  if (top === "standing") {
    const part = /^standing\.([a-z_]+)/.exec(field)?.[1];
    return [part ? `${STANDING_PREFIX}${part}` : "standing"];
  }
  return [top];
}

/**
 * Adds what one problem names to `named`. `id` null: the problem names no candidate, so every candidate is named whole. A part of the status group names the group; `verdict` names `standing`;
 * anything named of a candidate names its `reasoning`. A part of
 * the status group names `standing.effect` and `standing.fix` too: words only, so a status the refusal named can carry a
 * headline and a suggestion of its own. `strict`: none of these
 * widenings, only what the problem itself names (module comment, THE OUTCOME).
 */
export function nameIn(named: RefusalNamed, id: string | null, fields: readonly string[], strict = false): void {
  const key = id ?? "*";
  const now = new Set(named[key] ?? []);
  // The reasoning explains the answer, so any correction the refusal asks of a candidate may reword it; it is never read
  // for the finding's place (`WORDS_ONLY`).
  if (!strict && id !== null && fields.length > 0) now.add("reasoning");
  for (const f of id === null ? ["*"] : fields) {
    now.add(f);
    // A refused verdict names, itself, what a move to another verdict carries
    // with it: `settles`, the reason a `needs_human` is one (so `counsel` to `question`, a wait on the program's question,
    // is a correction the refusal named). The rest of the block stays a widening, weighed by the guard (THE OUTCOME).
    if (f === "verdict") now.add(`${STANDING_PREFIX}settles`);
    if (strict) continue;
    if (f === "verdict") now.add("standing");
    if (f.startsWith(STANDING_PREFIX) && (STANDING_STATUS_GROUP as readonly string[]).includes(f.slice(STANDING_PREFIX.length))) {
      for (const g of STANDING_STATUS_GROUP) now.add(`${STANDING_PREFIX}${g}`);
      for (const w of WORDS_ONLY) if (w.startsWith(STANDING_PREFIX)) now.add(w);
    }
  }
  named[key] = [...now].sort();
}

/** The answer's changes the refusal did not name, one problem per candidate, ending with the rule (`RESEND_RULE`'s first half). */
export function outsideNamed(changes: Amended["changes"], named: RefusalNamed, whole = false, role: CaptureRole = "adjudicator"): string[] {
  const byId = new Map<string, string[]>();
  for (const c of changes) {
    if (c.named || c.setAside) continue;
    byId.set(c.id, [...(byId.get(c.id) ?? []), c.field]);
  }
  return [...byId].map(([id, fields]) => {
    const said = named[id]?.length ? `it named ${named[id]!.map((f) => `\`${f}\``).join(", ")}` : "it did not name this candidate";
    const what = fields.includes("*") ? "adds this candidate" : `changes ${[...new Set(fields)].map((f) => `\`${f}\``).join(", ")}`;
    // An adjudicator's refusal states the rule once, at its end (`RESEND_RULE`).
    const how = role === "adjudicator" ? "send it as it was, or leave it out" : "Leave out what the refusal did not name, and it is kept as it was; or send your whole answer again";
    return `the object for candidate ${id}: this ${whole ? "answer" : "amendment"} ${what}, which the last refusal did not name (${said})${role === "adjudicator" ? ": " : ". "}${how}`;
  });
}

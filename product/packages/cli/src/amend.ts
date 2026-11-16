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
 * whole answer, checked as it stands, with no restriction on what it changes: the whole answer is always open.
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
 */

import type { CaptureRole } from "./verdict-capture.js";

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
}

/** The kept answer without what its refusal told the seat to take out (module comment); the answer itself where nothing was. */
export function withoutRemoved(role: CaptureRole, kept: unknown[], removed?: RefusalRemoved): unknown[] {
  if (!removed) return kept;
  const strip = (decisions: unknown[], key: string): unknown[] => {
    const out = new Set(removed.rows?.[key] ?? []);
    return out.size > 0 ? decisions.filter((_, i) => !out.has(i)) : decisions;
  };
  if (role === "reader") return strip(kept, "");
  const objects = new Set(removed.objects ?? []);
  return kept.flatMap((e, i) => {
    if (objects.has(i)) return [];
    const r = asRecord(e);
    return r && Array.isArray(r.decisions) && removed.rows?.[String(i)] ? [{ ...r, decisions: strip(r.decisions, String(i)) }] : [e];
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

export interface Amended {
  /** The kept answer with every change the refusal named laid over it: the answer checked, and kept if refused. */
  merged: unknown;
  /** Each (candidate, field) the amendment changed, named or not. */
  changes: { id: string; field: string }[];
  /** The problems of the changes the refusal did not name, which are left out of `merged` (`outsideNamed`). */
  outside: string[];
}

const allows = (named: RefusalNamed, id: string, field: string): boolean =>
  Boolean(named["*"]?.includes("*") || named[id]?.includes("*") || named[id]?.includes(field));

/**
 * The kept answer with the amendment laid over it (module comment). A change the refusal did not name is not laid over
 * it: it is refused by name (`outside`), and the whole checked and kept is the kept answer with the named changes only,
 * so that a later amendment cannot carry in what this one was refused for. It is laid over the kept answer without what
 * the refusal told the seat to take out (`removed`, fix R1).
 */
export function mergeAmendment(role: CaptureRole, keptAnswer: unknown[], next: unknown[], named: RefusalNamed = { "*": ["*"] }, removed?: RefusalRemoved): Amended {
  const kept = withoutRemoved(role, keptAnswer, removed);
  const changes: Amended["changes"] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (role === "reader") {
    const merged = mergeDecisions(kept, next);
    if (!same(merged, kept)) changes.push({ id: "", field: "decisions" });
    return { merged, changes, outside: [] };
  }
  const merged: unknown[] = kept.map((e) => e);
  for (const n of next) {
    const id = idOf(role, n)!;
    const amendment = asRecord(n)!;
    const at = merged.findIndex((e) => idOf(role, e) === id);
    if (at < 0) {
      changes.push({ id, field: "*" });
      if (allows(named, id, "*")) merged.push(amendment);
      continue;
    }
    const base = asRecord(merged[at]) ?? {};
    const out: Record<string, unknown> = { ...base };
    for (const [field, value] of Object.entries(amendment)) {
      if (field === "finding_id") continue;
      const now = field === "decisions" && Array.isArray(base.decisions) && Array.isArray(value) ? mergeDecisions(base.decisions, value) : value;
      if (same(now, base[field])) continue;
      changes.push({ id, field });
      if (allows(named, id, field)) out[field] = now;
    }
    merged[at] = out;
  }
  return { merged, changes, outside: outsideNamed(changes, named) };
}

/**
 * The reply an amendment makes: the kept answer with the amendment laid over it (`mergeAmendment`), as JSON with
 * two-space indentation and a final newline. This is the merged whole the capture checks and, accepted, keeps as the
 * record's reply (verdict-capture.ts `captureAnswer`); the assembly makes it again from the kept refused answer and the
 * seat's hand-back to prove an amended record (assemble-hooked.ts `amendmentProblem`). One copy for both.
 */
export function amendedReply(role: CaptureRole, kept: unknown[], next: unknown[], named?: RefusalNamed, removed?: RefusalRemoved): { bytes: Buffer; outside: string[] } {
  const m = mergeAmendment(role, kept, next, named, removed);
  return { bytes: Buffer.from(`${JSON.stringify(m.merged, null, 2)}\n`, "utf8"), outside: m.outside };
}

/** The fields one problem names (module comment): its field path's first name, or the reading group. */
export function fieldsNamed(field: string): string[] {
  const top = /^[a-z_]+/.exec(field)?.[0] ?? "";
  if (top === "") return ["*"];
  if (top === "reading" || READING_FIELDS.includes(top)) return [...READING_FIELDS];
  return [top];
}

/** Adds what one problem names to `named`. `id` null: the problem names no candidate, so every candidate is named whole. */
export function nameIn(named: RefusalNamed, id: string | null, fields: readonly string[]): void {
  const key = id ?? "*";
  const now = new Set(named[key] ?? []);
  for (const f of id === null ? ["*"] : fields) now.add(f);
  named[key] = [...now].sort();
}

/** The amendment's changes the refusal did not name, one problem per candidate. */
export function outsideNamed(changes: Amended["changes"], named: RefusalNamed): string[] {
  const byId = new Map<string, string[]>();
  for (const c of changes) {
    if (allows(named, c.id, c.field)) continue;
    byId.set(c.id, [...(byId.get(c.id) ?? []), c.field]);
  }
  return [...byId].map(([id, fields]) => {
    const said = named[id]?.length ? `it named ${named[id]!.map((f) => `\`${f}\``).join(", ")}` : "it did not name this candidate";
    const what = fields.includes("*") ? "adds this candidate" : `changes ${fields.map((f) => `\`${f}\``).join(", ")}`;
    return `the object for candidate ${id}: this amendment ${what}, which the last refusal did not name (${said}). Leave out what the refusal did not name, and it is kept as it was; or send your whole answer again`;
  });
}

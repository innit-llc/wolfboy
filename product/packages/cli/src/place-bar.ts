/**
 * A4, THE ONE BAR ON `not_applicable` FOR A CANDIDATE READ PLACE BY PLACE.
 *
 * A leaf module, so that every step that must hold a `not_applicable` to the bar can import the same function: the
 * answer seat's capture and the place seat's (place-answer.ts, reading-assembly.ts), and the carry-forward step, which
 * must not carry such an answer as clean (carry-forward.ts; importing place-answer.ts there would close a load-order
 * cycle through launch-plan.ts). It imports nothing of this package but `compactIds`.
 */
import { compactIds } from "./reading.js";

/** The decisions that keep a place: read as the construct, or as the construct behind its gate. */
export const KEPT_DECISIONS: ReadonlySet<string> = new Set(["is_the_construct", "construct_but_gated"]);

/**
 * The decision that CLOSES a place: the only one under which A4 lets `not_applicable` stand (a kept, an undetermined or a
 * not-checked place holds the candidate open). Capture check C10 (place-reply.ts) acts on these rows only - a
 * row that keeps a place, or leaves it undetermined, stays in front of the person whatever its `why` says.
 */
export const CLOSING_DECISIONS: ReadonlySet<string> = new Set(["not_the_construct"]);

/**
 * Whether a place's decision closes it - the ONE definition of a closing row: capture check C10
 * holds exactly these rows, and A4 lets `not_applicable` stand only where every place is one. A decision word that is not
 * in `CLOSING_DECISIONS` (a word added to the reply's list later included) keeps the candidate open under A4 and is not
 * held by C10, so the two can never disagree about which rows close a place.
 */
export const isClosingDecision = (decision: string | undefined): boolean => decision !== undefined && CLOSING_DECISIONS.has(decision);

/** Whether a place is kept (`is_the_construct` or `construct_but_gated`). */
export const isKeptPlace = (r: { decision?: string }): boolean => r.decision !== undefined && KEPT_DECISIONS.has(r.decision);

/** One place as A4 counts it: decided (`decision`), or not checked (`not_checked`: `unreadable` or `not_answered`). */
export interface PlaceStanding {
  place: string;
  decision?: string;
  not_checked?: string;
}

/**
 * A4, the one bar on `not_applicable` for every candidate read place by place, whichever seat answers it: its answer
 * seat (over the per-place table) or, for a candidate that fits one seat, its place seat (over its own accepted rows and
 * the places it was handed as unreadable or not handed at all); and the carry of
 * an earlier answer over its carried places. `not_applicable` stands only where no place is kept (`is_the_construct` or
 * `construct_but_gated`), none is `undetermined` and none is not checked - for every reading class. Returns the
 * refusal, or null.
 */
export function notApplicableBar(verdict: unknown, places: readonly PlaceStanding[]): string | null {
  if ((typeof verdict === "string" ? verdict : "") !== "not_applicable") return null;
  // Every place that is not closed (`isClosingDecision`, the definition C10 reads) holds the
  // candidate open; kept, undetermined and not checked are named, and any other decision is counted on its own.
  const open = places.filter((r) => r.not_checked || !isClosingDecision(r.decision));
  if (open.length === 0) return null;
  const kept = open.filter((r) => r.decision !== undefined && isKeptPlace(r)).map((r) => r.place);
  const undetermined = open.filter((r) => r.decision === "undetermined").map((r) => r.place);
  const notChecked = open.filter((r) => r.decision === undefined || r.not_checked).map((r) => r.place);
  const other = open.filter((r) => !kept.includes(r.place) && !undetermined.includes(r.place) && !notChecked.includes(r.place)).map((r) => r.place);
  const ids = (list: string[]) => (list.length > 0 ? ` (${compactIds(list)})` : "");
  const others = other.length > 0 ? `, ${other.length} with a decision that does not close a place${ids(other)}` : "";
  return `A4: \`not_applicable\` stands only where no place is kept, none is undetermined and none is not checked; this candidate has ${kept.length} kept${ids(kept)}, ${undetermined.length} undetermined${ids(undetermined)}${others} and ${notChecked.length} not checked${ids(notChecked)}. Answer the verdict its places support (\`violation_candidate\` or \`needs_human\`), and name in \`reasoning\` the gate or what is missing`;
}

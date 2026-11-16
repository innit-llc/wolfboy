/**
 * The reading unit — how layer 2 reads a candidate that carries more matched lines than one seat
 * reads, and how the record of that reading is assembled by this CLI rather than by a model.
 *
 * an internal record is the design; this module is unit U2 of
 * its section 12. Layer 1's census (unit U1) groups a large candidate's locations into same-kind
 * line groups — "kinds" — and plans which kinds each seat reads. Everything here reads that census,
 * never computes one: the key derivation, the plan and the flag belong to U1 and are not restated.
 *
 * ## What this module holds, and why it is one file
 *
 *   - **the accessors** (`kindCensusOf`, `readingPlanOf`, `readingUnitsOf`, `readingClassOf`): THE
 *     ONE PLACE that knows how U1 spells its fields. Everything downstream — the packing in
 *     `scan.ts`, the payload writer in `context.ts`, the assembly below, the coverage check in
 *     `verdict-verify.ts` and the gate — asks here. A field U1 renames is a repair in one function
 *     rather than in five, which is the whole reason they are not read inline where they are needed.
 *   - **`censusHash`** — what a verdict rests on (design section 9, unit H): a digest over the census
 *     rows that a later run re-derives with no model, so a new vendor, store or route changes it and
 *     the candidate is re-adjudicated instead of being carried forward.
 *   - **`catalogueSummary`** — the bounded form of the census a verdict seat is handed (section 3.7).
 *   - **`foldDispositions`** — the bounded form of the readers' dispositions a verdict seat is handed
 *     (section 3.7). Both bounds exist because a seat's input must not be O(kinds): one real tree's
 *     `eu-dsr-001` has 16,926 of them.
 *   - **`assembleReading`** — the `reading` block itself (section 3.6), folded from the census and
 *     the seats' replies. **The seat never writes the line list**: it returns what it opened and
 *     quoted, and this function classifies every member of every kind.
 *   - **`checkReadingCoverage`** — the gate rule of section 3.6, as a pure function, so
 *     `verdict-verify` and a test run the same code on the same records.
 *
 * ## What it deliberately does NOT do
 *
 * It computes no census and plans no reading (U1). It edits no prompt and no rule (U3). It decides
 * nothing about legality, and it never turns an `undetermined` into a dismissal: the coverage check
 * reports gaps and the caller decides what to do with them.
 */

import { createHash } from "node:crypto";
import type { Candidate, FindingLocation } from "wolfboy-schemas";
import { isPlaceId, unitId } from "./ref-ids.js";
import { SHIPS_MAY_DECIDE, dutyAboutOf } from "./standing.js";

/* --------------------------------------------------------------------------------------------- *
 * The census, as this module reads it.
 * --------------------------------------------------------------------------------------------- */

/**
 * One same-kind line group, normalised out of whatever U1 wrote.
 *
 * `members` are the candidate's own `locations[]`, in path-then-line order, with the representative
 * first — which is U1's own definition of the representative ("the first member in path-then-line
 * order — never 'the most typical', which is a judgement", design section 3.1).
 */
export interface ReadingKind {
  /**
   * THE NAME OF THIS GROUP: its index in `kinds.groups`, as a decimal string — or `L<index>` where
   * the plan reads by locations and a location is its own unit.
   *
   * It is the index and not the key because **`key` is not unique**: U1's own-evidence rule makes a
   * location whose evidence is not its own line into a group of one under the same key. A payload
   * row, a seat's reply and a verdict's trail all name a group by this.
   */
  id: string;
  key: string;
  /** U1's mark for a group of one whose location's evidence is not the line it names. */
  own_evidence?: true;
  /** The fired clause set the key was made from, where U1 recorded it. */
  clause?: string;
  /** The syntactic context class: `sql`, `translation-entry`, `import-specifier`, and the rest. */
  context_class?: string;
  /** The matched token, case- and separator-folded. The ITEM, for a rule whose items are words. */
  matched_token?: string;
  member_count: number;
  members: FindingLocation[];
  representative: FindingLocation;
  sub_shapes: ReadingSubShape[];
  sub_shape_count: number;
}

/** One L1s sub-shape inside a kind: the line folded, with its own count and first member. */
export interface ReadingSubShape {
  key: string;
  member_count: number;
  first: FindingLocation;
  /** The sub-shape's own text, where U1 carried it. */
  text?: string;
}

/** A candidate's whole census, normalised. */
export interface ReadingCensus {
  spec: string;
  level: string;
  bound?: number;
  kinds: ReadingKind[];
  kinds_total: number;
  locations_total: number;
}

/** The reading plan U1 wrote: how many units, how many readers, and which kinds each reader holds. */
export interface ReadingPlan {
  reading_units: number;
  /** `kind` for the existence, enumeration and mixed classes; `location` for the per-location one. */
  unit: "kind" | "location";
  readers: number;
  /** Per reader, the unit IDS it holds, in the plan's own order. Empty for a plan with no readers. */
  reader_slices: string[][];
  /** The unit IDS the verdict seat reads itself. For an existence-class candidate, the plan's first 70. */
  seat_slice: string[];
  /** Unit IDS the plan hands to nobody, with the reason they are not read. */
  unread: { key: string; reason: ReadingNotReadReason }[];
  /** `existence` | `enumeration` | `per-location` | `mixed`, where the rule declares one. */
  reading_class?: string;
  /**
   * The place plan (`reading-plan-2`, unit `place`; full-read design, build units F1 and F3): every unit is one place,
   * and a place no seat answered is `not_answered`, never `budget`. A place seat answers one row per place (C1-C9),
   * so nothing of this plan is declined, settled by a shape ground or recorded `not_opened`.
   */
  places?: true;
}

/** The reasons a kind may be left unread (design section 3.6). Not extended here. */
/**
 * WHY A UNIT HAS NO READING, and the one of the five a seat may state about a unit it was handed.
 *
 * The first four are the plan's: the rule's own instruction, the existence-class tail, a reader that
 * did not return, a file that could not be opened. `seat_declined` is the fifth and it was added by
 * unit R1 from mechanism finding M6 of U4: one tree's `eu-dsr-001` seat was handed 70 units, opened
 * 7, and accounted for the other 63 in prose — the trail had no way to say **"I was handed this kind
 * and chose not to open it"**, so 63 honest sentences became 63 partition gaps. A word for that
 * state turns a gap into a row that names the seat as its author and carries its sentence; it does
 * NOT excuse the reading, because the row still bars `not_applicable` exactly as an unread tail does.
 */
export type ReadingNotReadReason =
  | "repository_answer"
  | "budget"
  | "rule_instruction"
  | "unreadable"
  | "seat_declined"
  | "not_opened"
  | "not_answered";

/**
 * `not_opened`: a location the seat answered as opened where its own
 * transcript shows it did not open the code around the line (seat-opened.ts): at most it saw the one line, as a search
 * result shows it. Written by the program from the capture's check and by nothing else; like `seat_declined` it bars
 * `not_applicable`, and the person is told the place was not checked.
 */
export const READING_NOT_READ_REASONS: readonly ReadingNotReadReason[] = [
  "repository_answer",
  "budget",
  "rule_instruction",
  "unreadable",
  "seat_declined",
  "not_opened",
  // Build unit F3 (full-read design 1.7): a place of a place-plan candidate no seat answered after one make-up seat.
  "not_answered",
];

/** What one seat may say about one kind (design section 3.5). */
export type ReadingDisposition =
  | "is_the_construct"
  | "not_the_construct"
  | "construct_but_gated"
  | "undetermined"
  | "not_read";

export const READING_DISPOSITIONS: readonly ReadingDisposition[] = [
  "is_the_construct",
  "not_the_construct",
  "construct_but_gated",
  "undetermined",
  "not_read",
];

/**
 * THE SIX GROUNDS A COVER MAY REST ON (design section 3.5, the safety line), as named values.
 *
 * Section 3.5, in its own words: *"a kind's members may be **covered** by the reading of its
 * representative only on grounds **intrinsic to the shape** — translation string, identifier or URI
 * literal, type definition, generated or fixture path, documentation text ... and an import
 * specifier of one package"*, and: *"A ground that depends on a call path or a gate — consent
 * recorded, dead code, server-side only, not shipped — is per file: the seat opens every member's
 * file at least once, or disposes those members `undetermined` and says so."*
 *
 * **Why a named list and not the free text beside it.** `ground` on a read row is what settled that
 * ONE representative, in the seat's own words, and it is prose. What a COVER rests on is a different
 * claim — that every member of the kind shares the representative's disposition because of what the
 * shape IS — and a claim a gate has to read is a value, not a sentence. So a seat that means to
 * cover says which of the six it is, in `cover_ground`, and a cover with no named ground carries
 * none: the CLI does not manufacture the one claim section 3.5 forbids out of whatever prose the
 * representative happened to carry.
 */
export type ReadingCoverGround =
  | "translation_string"
  | "identifier_or_uri_literal"
  | "type_definition"
  | "generated_or_fixture_path"
  | "documentation_text"
  | "import_specifier";

export const READING_COVER_GROUNDS: readonly ReadingCoverGround[] = [
  "translation_string",
  "identifier_or_uri_literal",
  "type_definition",
  "generated_or_fixture_path",
  "documentation_text",
  "import_specifier",
];

/**
 * WHAT ONE `evidence[]` ENTRY IS FOR (design section 2, E3 + E4 + E2; built in unit R1 on
 * 2026-09-22 as the repair §11.2 pre-registered when P2a failed on 3 of 8 candidates).
 *
 * `element` — this entry answers one of the parts the rule's own question walks, named in `name`.
 * `premise` — this entry establishes that the construct is here at all, quoted from one of the
 * strongest kinds the seat read, as `eu-dsr-001` Q2 and `eu-dsa-001` Q3 ask in their own words.
 * `item` — this entry is one member of the list an enumeration rule's finding IS, named in `name`.
 * `site` — this entry is one place a declared element was found or is missing, named in `name` by
 * the class of line or the route. It is admitted only where the rule is read per location, and only
 * at a location this seat itself disposed `is_the_construct` or `construct_but_gated`.
 * `dismissal` — this entry quotes a place the record's trail read and disposed `not_the_construct`,
 * shown as part of why a `not_applicable` verdict holds (the parent's decision of 2026-10-07, unit U1,
 * amending the 2026-09-22 list of four). It is admitted only on a `not_applicable` verdict, only at
 * a location a `read[]` row of this trail disposed `not_the_construct`, and at most three of them.
 * Run fm1 is why: of the 44 entries its refused and invalid verdicts gave with no role, 40 sat on a
 * `not_applicable` or `needs_human` verdict, 26 of those quoting a place the trail had dismissed, and
 * none of the four roles could stand there - each of them needs an affirmative row or a search.
 *
 * **EVERY ROLE THAT QUOTES A LOCATION IS ACCOUNTABLE FOR IT, AND BOUNDED**.
 * A verdict's trail already carries one quoted row per kind
 * read; restating those rows in `evidence[]` makes a finding look evidenced without adding a
 * reading, and a role that carries a trail row at no cost is the door that restatement walks
 * through. The door was closed on `site` alone first, and the verifier then walked the same 70 rows
 * through `element` at exit 0. It is closed on all five roles here, by one condition each:
 *
 * - a `premise` quotes a `read[]` row this seat disposed `is_the_construct` or
 *   `construct_but_gated`, and there are at most three of them — the rules' own "two or three
 *   strongest locations" — on every class, not only on the class that also demands a minimum;
 * - an `element` entry quotes such an affirmative row too, OR names in `search` a
 *   `reading.searched[]` row of this same trail whose `hits` are one or more, the recorded search
 *   being how the seat reached a site it did not open as a kind; and there are at most five entries
 *   per declared element name;
 * - an `item` entry carries a `name`, and one entry answers one item. Where the rule's items ARE
 *   the matched word it quotes a location this candidate's census holds for that item — a `read[]`
 *   row of one of the item's kinds, or a member of one of them, under any disposition, because E2
 *   admits a quoted dismissal as well as a listing. Where they are found by reading (`item_source`
 *   `reading`, `clause` or `sub_shape` — 14 of the 20 enumeration rules) no census holds a name to
 *   check this one against, so the entry stands on the same two grounds an `element` entry stands
 *   on: an affirmative row of this trail, or a search this trail records with one hit or more;
 * - a `site` is admitted only where the rule is read per location, only with a `name`, and only at a
 *   location this seat disposed affirmatively;
 * - a `dismissal` is admitted only on a `not_applicable` verdict, only at a location a `read[]` row of
 *   this trail disposed `not_the_construct`, and at most three of them (2026-10-07).
 *
 * So "no restatement on trail rows" is a count and not a judgement, on every class: at most
 * 3 + 5 × (declared elements) + (items) + 3 entries can quote a location at all, and each one is tied
 * to a row the seat judged affirmative, to a location the census holds for that item, to a search
 * the seat recorded, or (the last three, on a `not_applicable` verdict only) to a row the trail
 * dismissed. **The item half is written twice**: where the
 * item set is the census's, "(items)" is a number the machine holds, and where it is found by
 * reading it is not — 70 trail rows relabelled `{role: item, name: "member NNN"}` passed at exit 0
 * until the two grounds above were asked of them, 29 of those rows being rows the trail itself
 * disposed `not_the_construct`. The read-derived list is now bounded by what this trail found
 * rather than by a count, which is the same reading the seat is asked to have done. Anything beyond
 * that is a reading duty the run's verifier reads, and no gate claims it — least of all that a
 * read-derived list is COMPLETE (design section 2, E2).
 */
export type ReadingEvidenceRole = "element" | "premise" | "item" | "site" | "dismissal";

export const READING_EVIDENCE_ROLES: readonly ReadingEvidenceRole[] = ["element", "premise", "item", "site", "dismissal"];

/**
 * At most this many `dismissal` entries (the parent's decision of 2026-10-07): the premise's own bound, "the two or three
 * strongest locations", read for the places set aside. Every dismissed place is in the trail already with its quotation
 * and its disposition; a dismissal shows the few that say why the finding does not hold, and the cap keeps the trail
 * from being copied in under this role as it once was under `site` and `element`.
 */
export const READING_DISMISSAL_CAP = 3;

/** At most this many `premise` entries: the rules' own "two or three strongest locations". */
export const READING_PREMISE_CAP = 3;

/**
 * At most this many `element` entries per declared element name.
 *
 * The rules' own words for how much a finding shows are "the two or three strongest"; five leaves
 * room for an element that genuinely lives in several places — one entry per site is the shape the
 * adjudicator is told to write — while making a whole trail relabelled as one element impossible.
 */
export const READING_ELEMENT_ENTRY_CAP = 5;

/** One `item` entry answers one item: a second entry for the same item restates the first. */
export const READING_ITEM_ENTRY_CAP = 1;

/**
 * What a place was given, as the program wrote it (never the seat): its own `window`, a `fact` line the program tested
 * (full-read design 1.3), or a `data_summary` the program verified over every record (section 2, build unit F6). Widened
 * at the integration so a summary row is carried with its basis and never counted as read in a window.
 */
export const READ_BASES = ["window", "fact", "data_summary"] as const;
export type ReadBasis = (typeof READ_BASES)[number];

/**
 * What stands in front of a place a seat decided `construct_but_gated`, from a closed list, so that the
 * composition of severity at a place (severity-at-place.ts) can tell a gate that keeps the code out of the running
 * product from one that opens where the product runs. The seat names one on every `construct_but_gated` row (C3) and
 * keeps its `why` as the free text:
 *   - `development_or_test`: the code runs only in development or in tests (a development switch, a test environment,
 *     a transport or fixture created only for them);
 *   - `setting_changed_from_default`: it runs only when the person or operator changes a setting from its default (or
 *     gives a value to a setting that has none);
 *   - `feature_or_integration_in_use`: it runs only when a feature or an integration is in use;
 *   - `after_consent_or_permission`: it runs only after a consent or permission check;
 *   - `other`: something else, said in the seat's own words in `gate_words`.
 * Only `development_or_test` keeps a place from raising or being raised; every other kind, and a row with none (every
 * row written by an earlier version), raises as any held place does.
 */
export const PLACE_GATE_KINDS = ["development_or_test", "setting_changed_from_default", "feature_or_integration_in_use", "after_consent_or_permission", "other"] as const;
export type PlaceGateKind = (typeof PLACE_GATE_KINDS)[number];
/** The one gate kind that keeps a place out of a raise. */
export const GATE_DEVELOPMENT_OR_TEST: PlaceGateKind = "development_or_test";

/** One row a reader or a verdict seat returns: one kind (or one of its sub-shapes) it opened. */
export interface ReadingReadRow {
  kind: string;
  sub_shape?: string;
  file: string;
  lines: string;
  quote: string;
  disposition: ReadingDisposition;
  ground?: string;
  /** Which of the six intrinsic grounds this kind's other members may be covered on, where any. */
  cover_ground?: ReadingCoverGround;
  /**
   * The seat's own spelling of `kind`, where the assembler had to normalise it (U4 finding M5).
   * Written only where the two differ, so a reader of the trail sees what the seat wrote as well as
   * which census unit it resolved to, and the seat's bytes are never presented as the census's.
   */
  kind_as_written?: string;
  /**
   * This row is the VERDICT SEAT re-opening a unit a reader had already disposed (U4 finding M4).
   * The row is kept — the seat is entitled to look, and its reading is its own record — and the
   * arithmetic counts the location once, at the reader's row, so that looking twice is not a gap.
   */
  also_read_by_reader?: boolean;
  /**
   * BUILD UNIT F3 (full-read design 1.5): a row a place seat wrote for one place of a place-plan candidate. `place` is the
   * place's id (`P<n>`; `kind` is the plan's `L<n>` for the same location), `lines` the seat's line inside the place's
   * window (C4), `ground` its `why`, `data` the personal data words (`[]` on not_the_construct, W0), `item` where the
   * rule's items are found by reading, `beyond` the one line outside the window a decision or its data rests on (C9),
   * `read_basis` what the place was given (`window`, `fact`, or `data_summary` - a summary the program verified, build
   * unit F6, written by no capture yet and never counted as a window), and `line_declared` the seat's own line where its quote
   * stood on another line of the window (C5's drift recovery).
   */
  place?: string;
  data?: string[];
  item?: string;
  beyond?: { file: string; line: number; quote: string };
  read_basis?: ReadBasis;
  line_declared?: number;
  /** On a `construct_but_gated` row, the gate's kind (`PLACE_GATE_KINDS`); absent on every other row. */
  gate?: PlaceGateKind;
  /** The gate in the seat's own words, where `gate` is `other`; absent elsewhere. */
  gate_words?: string;
  /** Build unit F5: the place's premises (place-premises.ts), written by the capture and gathered by the assembly. */
  premises?: import("./place-premises.js").PlacePremises;
  /**
   * Build unit F5 M3: a row of an earlier run, carried into this one because every premise of it is reproduced and its
   * seat was not launched (carried-places.ts). Never re-verified; written by the pre-launch step, never by a seat.
   */
  carried_from?: { scan_id: string; finding_id: string };
}

/**
 * ONE UNIT THE VERDICT SEAT WAS HANDED AND CHOSE NOT TO OPEN, in the seat's own sentence (M6).
 *
 * The seat may not write `not_read[]` — the reasons on that list are the plan's — so this is the one
 * list a seat writes about what it did not read, and the assembler is what turns it into a
 * `not_read` row with the reason `seat_declined`. Silence is still a gap: a dispatched unit with
 * neither a `read[]` row nor an entry here is `unaccounted` exactly as before.
 */
export interface ReadingDeclinedRow {
  kind: string;
  note: string;
  /**
   * MEMBERS OF A UNIT THE SEAT OPENED AND DID NOT READ: absent where
   * the whole unit is declined; `"rest"` where every member the seat did not open is declined, or the member ids
   * (`"12/m3"`) it declines, exactly as the seat's `decline` named them. The assembler turns it into a `not_read` row
   * with the reason `seat_declined`, the seat's sentence and the members' `locations`, beside the unit's `read` rows.
   */
  members?: "rest" | string[];
  /** As on a read row: the seat's own spelling, where the assembler had to normalise it. */
  kind_as_written?: string;
}

/**
 * ONE LOCATION A SEAT ANSWERED AS OPENED AND DID NOT OPEN (a place counts as
 * read only where the seat actually opened the code around it). Written by the capture, never by a seat: a row of the
 * seat's decisions (its unit, a sub-shape, an `also` member, at the id's line or its `at`) whose location the seat's own
 * transcript does not show it saw (`readingOfDecisions` `opened`, seat-opened.ts). The assembler turns them into a
 * `not_read` row with the reason `not_opened`, carrying where each is; the list is kept beside it, as `declined` is.
 */
export interface ReadingUnopenedRow {
  kind: string;
  sub_shape?: string;
  /** Where the seat's row would have stood. */
  file: string;
  lines: string;
  /** The member of the unit the row accounts for, "file:line" (`memberAtRow`). */
  member: string;
}

/** One kind's members settled by the reading of its representative, and on what ground. */
export interface ReadingCoveredRow {
  kind: string;
  members: number;
  by: string;
  disposition: ReadingDisposition;
  /** One of the six of section 3.5, or absent. Never free text, and never a call path or a gate. */
  ground?: ReadingCoverGround;
}

/** One kind nobody opened, with the reason from the fixed list. */
export interface ReadingNotReadRow {
  kind: string;
  members: number;
  reason: ReadingNotReadReason;
  note?: string;
  /**
   * WHERE THE UNREAD MEMBERS ARE, on a row for a unit that was OPENED IN PART: its `read` rows hold what
   * the seat read, and this row the members it declined (`seat_declined` only), as "file:line" of each. `members` is
   * then how many of the unit's locations the row accounts for, not the unit's whole count. A row with no `locations`
   * is a whole unit nobody opened, as before.
   */
  locations?: string[];
}

/**
 * THE MEMBERS A MEMBER DECLINE LEAVES UNREAD: one function for the capture's check, the assembler and
 * the refuter's block, so the three never count them differently. `rows` are the unit's opened rows (each one location
 * of the unit, as the arithmetic counts them). `"rest"` declines every member no row was opened at: it accounts for
 * the unit's member count less its opened rows, and lists every member line no row stands at (a row the seat opened at
 * a nearby line by `at` leaves its member listed too: a place that may not have been read is listed, never hidden).
 * Member ids are resolved against the unit's members in id order (`sortedMembers`), listed or not; an id of no member
 * of this unit, or at a location a row already opened, is returned apart and accounts for nothing.
 */
export function declinedMembersOf(
  kind: ReadingKind,
  members: "rest" | readonly string[],
  rows: readonly { file: string; lines: string; sub_shape?: string }[],
): { count: number; locations: string[]; notMembers: string[]; opened: string[] } {
  // Each row at the member it stands for (`memberAtRow`, the verification's L3): a representative opened by `at` at a
  // nearby line is its member, so "rest" never lists the member that row read and the count and the list agree.
  const openedAt = new Set(rows.map((r) => memberAtRow(kind, r)));
  const sorted = sortedMembers(kind);
  const where = (m: FindingLocation) => `${m.file}:${m.start_line}`;
  if (members === "rest") {
    return { count: Math.max(0, kind.member_count - rows.length), locations: sorted.map(where).filter((l) => !openedAt.has(l)), notMembers: [], opened: [] };
  }
  const locations: string[] = [];
  const notMembers: string[] = [];
  const opened: string[] = [];
  const seen = new Set<number>();
  const prefix = `${kind.id}/m`;
  for (const id of members) {
    const n = id.startsWith(prefix) && /^\d+$/.test(id.slice(prefix.length)) ? Number(id.slice(prefix.length)) : 0;
    const member = n >= 1 ? sorted[n - 1] : undefined;
    if (!member) notMembers.push(id);
    else if (openedAt.has(where(member))) opened.push(id);
    else if (!seen.has(n)) {
      seen.add(n);
      locations.push(where(member));
    }
  }
  return { count: locations.length, locations, notMembers, opened };
}

/**
 * THE MEMBER A ROW STANDS FOR, "file:line" (the verification's L3): the member at the row's first line where one is; else
 * (a decision opened by `at` at a nearby line) the member its id names, the sub-shape's first where the row names a
 * sub-shape, else the unit's representative. One rule for the member decline, the unopened rows and the partition's
 * place-by-place check. A row is credited to this member, so `readingOfDecisions` counts it as opened only where the
 * seat opened both the row's own lines and this member's line.
 */
export function memberAtRow(kind: ReadingKind, row: { file: string; lines: string; sub_shape?: string }): string {
  const m = memberLocationAtRow(kind, row);
  return `${m.file}:${m.start_line}`;
}

/** `memberAtRow`'s member as a location: the one mapping, for the opened check that needs its file and line apart. */
export function memberLocationAtRow(kind: ReadingKind, row: { file: string; lines: string; sub_shape?: string }): FindingLocation {
  const first = Number(firstLineOf(row.lines));
  const exact = kind.members.find((m) => m.file === row.file && m.start_line === first);
  const sub = row.sub_shape !== undefined ? kind.sub_shapes.find((s) => s.key === row.sub_shape)?.first : undefined;
  return exact ?? sub ?? kind.representative;
}

/**
 * Which tool ran a recorded search, and therefore how a later run replays it: `grep` searches file
 * CONTENT with a regular expression, `glob` matches file PATHS with a path pattern. A row written
 * before 2026-09-22 carries neither word; it is replayed as `grep`, and refused - never guessed at -
 * when its pattern does not compile as a regular expression.
 */
export type ReadingSearchTool = "grep" | "glob";

/** One project-wide search a seat ran, recorded whether or not it found anything. */
export interface ReadingSearchRow {
  for: string;
  pattern: string;
  paths?: string;
  hits: number;
  hit_hash?: string;
  /** `grep` or `glob`; absent on a record written before the field existed. */
  tool?: ReadingSearchTool;
}

/** The `reading` block of a verdict (design section 3.6). Assembled here, never by a model. */
export interface VerdictReading {
  census: {
    spec: string;
    level: string;
    /** Which unit this candidate's plan reads in — `kind` or, for a per-location rule, `location`. */
    unit: "kind" | "location";
    /** Same-kind line groups in the census, whether or not they are the reading unit. */
    kinds_total: number;
    /** Reading units the trail below accounts for: the groups, or the locations. */
    units_total: number;
    locations_total: number;
    hash: string;
  };
  read: ReadingReadRow[];
  covered: ReadingCoveredRow[];
  not_read: ReadingNotReadRow[];
  searched?: ReadingSearchRow[];
  /** The seat's own list of units it was handed and did not open, carried verbatim beside the rows
   * the assembler made of it. Kept because it is the seat's record of a decision it took, and the
   * `not_read` row it produced is the assembler's restatement of it, not its original. */
  declined?: ReadingDeclinedRow[];
  /** The rows the seats answered as opened and did not open, as the capture recorded them, carried beside
   * the `not_read: not_opened` rows the assembler made of them. */
  unopened?: ReadingUnopenedRow[];
}

/* --------------------------------------------------------------------------------------------- *
 * Accessors — the one place U1's field names are read.
 * --------------------------------------------------------------------------------------------- */

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const asInt = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;

const asText = (value: unknown): string => (typeof value === "string" ? value : "");

/** Path then line, the order U1's census and `scan.ts`'s split both read members in. */
function byPathThenLine(a: FindingLocation, b: FindingLocation): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.start_line - b.start_line;
}

/**
 * Resolve one member reference against the candidate's `locations[]`.
 *
 * U1 writes a member as an INDEX into `locations[]`, and the candidate's locations are in
 * path-then-line order wherever a census exists, so an index is a stable name for a location. A
 * member written as an object carrying `file` and `start_line` is accepted too and matched back,
 * because that is the shape the design's own examples use and refusing it would make the two units
 * disagree over a difference that changes nothing about what is read.
 */
function memberLocation(ref: unknown, locations: FindingLocation[]): FindingLocation | null {
  const index = asInt(ref);
  if (index !== null) return locations[index] ?? null;
  const row = asRecord(ref);
  if (!row) return null;
  if (asInt(row.index) !== null && locations[asInt(row.index)!]) return locations[asInt(row.index)!];
  const file = asText(row.file);
  const line = asInt(row.start_line);
  if (!file || line === null) return null;
  const hit = locations.find((l) => l.file === file && l.start_line === line);
  return hit ?? ({ file, start_line: line } as FindingLocation);
}

/**
 * The census U1 wrote on this candidate, normalised — or `null` where it wrote none.
 *
 * A candidate under the bound carries no census and is read location by location, exactly as it is
 * today; `null` is that case and is not an error.
 *
 * **A GROUP IS NAMED BY ITS INDEX AND NEVER BY ITS KEY, and that is U1's rule, not a choice made
 * here.** `KindGroup.key` is not unique in `groups[]`: a location whose evidence is not its own line
 * — a value hop, a fold, an absorbed enclosing construct, a multi-line span, a corroboration from
 * another file — is a group of ONE under the same key, because no representative can be read for it.
 * So `id` below is the group's position in `groups[]`, rendered as a decimal string, and it is what
 * a payload row, a seat's reply and a verdict's trail all name. The raw key travels beside it for a
 * reader's eyes and for the census digest, and for nothing else.
 */
export function kindCensusOf(candidate: Candidate): ReadingCensus | null {
  const c = candidate as unknown as Record<string, unknown>;
  const census = asRecord(c.kinds);
  if (!census) return null;
  const locations = (candidate.locations ?? []) as FindingLocation[];
  const groups = asArray(census.groups);
  const kinds: ReadingKind[] = [];
  groups.forEach((raw, index) => {
    const g = asRecord(raw);
    if (!g) return;
    const key = asText(g.key);
    const members = asArray(g.members)
      .map((m) => memberLocation(m, locations))
      .filter((m): m is FindingLocation => m !== null);
    const representative =
      memberLocation(g.representative, locations) ?? members[0] ?? ({ file: "(unknown)", start_line: 0 } as FindingLocation);
    const subShapes: ReadingSubShape[] = [];
    for (const rawSub of asArray(g.sub_shapes)) {
      const sub = asRecord(rawSub);
      if (!sub) continue;
      const first = memberLocation(sub.first ?? sub.first_member ?? sub.representative, locations);
      subShapes.push({
        key: asText(sub.sub_shape) || asText(sub.key) || asText(sub.shape) || `${index}#${subShapes.length + 1}`,
        member_count: asInt(sub.members) ?? asInt(sub.member_count) ?? asInt(sub.count) ?? 0,
        first: first ?? representative,
        ...(asText(sub.text) ? { text: asText(sub.text) } : {}),
      });
    }
    kinds.push({
      id: String(index),
      key,
      ...(g.own_evidence === true ? { own_evidence: true as const } : {}),
      ...(asText(g.clause) ? { clause: asText(g.clause) } : {}),
      ...(asText(g.context_class) ? { context_class: asText(g.context_class) } : {}),
      ...(asText(g.matched_token) ? { matched_token: asText(g.matched_token) } : {}),
      member_count: asInt(g.member_count) ?? members.length,
      members,
      representative,
      sub_shapes: subShapes,
      sub_shape_count: asInt(g.sub_shape_count) ?? subShapes.length,
    });
  });
  return {
    spec: asText(census.spec) || "kind-census-1",
    level: asText(census.level) || "L2",
    ...(asInt(census.bound) !== null ? { bound: asInt(census.bound)! } : {}),
    kinds,
    kinds_total: asInt(census.kinds_total) ?? kinds.length,
    locations_total: locations.length,
  };
}

/**
 * The reading plan U1 wrote, normalised — or `null` where it wrote none.
 *
 * U1's plan is an ORDER and two cuts into it: `order[]` holds every unit exactly once (indices into
 * `kinds.groups` where `unit` is `"kind"`, into `locations` where it is `"location"`),
 * `read_by_seat` is how many of them the verdict seat opens itself, `reader_slices` are consecutive
 * ranges of `order` with both ends inclusive, and `not_read` is the one range nobody opens. This
 * function turns that into the three lists the rest of the module reads — the seat's units, each
 * reader's units, and the units declared not read — and does the index arithmetic once, here.
 *
 * **The unit is the plan's, not this module's.** An existence, enumeration or mixed class reads by
 * kinds; a per-location class reads by locations, and a location is then a unit of one member whose
 * representative is itself. One mechanism covers both, which is why nothing downstream asks the
 * class.
 */
export function readingPlanOf(candidate: Candidate): ReadingPlan | null {
  const c = candidate as unknown as Record<string, unknown>;
  const group = asRecord(c.adjudication_group);
  const plan = asRecord(c.reading_plan);
  if (!plan) {
    // No plan and a unit count on the group is still enough to pack by, which is the one thing the
    // packing needs. Nothing else here can be answered without the order.
    const units = asInt(group?.reading_units);
    if (units === null) return null;
    return { reading_units: units, unit: "kind", readers: asInt(group?.readers) ?? 0, reader_slices: [], seat_slice: [], unread: [] };
  }
  // `place` (reading-plan-2, the full-read form) is read as `location` was: one unit per matched location, `L<n>` ids.
  const unit = asText(plan.unit) === "location" || asText(plan.unit) === "place" ? "location" : "kind";
  const order = asArray(plan.order)
    .map(asInt)
    .filter((n): n is number => n !== null);
  const ids = order.map((index) => (unit === "location" ? unitId(index) : String(index)));
  const readBySeat = Math.max(0, Math.min(order.length, asInt(plan.read_by_seat) ?? 0));

  const sliceOf = (from: unknown, to: unknown): string[] => {
    const a = asInt(from);
    const b = asInt(to);
    if (a === null || b === null) return [];
    // BOTH ENDS INCLUSIVE, which is U1's own wording for `ReaderSlice`. Clamped rather than trusted:
    // a range that runs past the order would silently drop units here and leave them unaccounted for
    // in the trail, which is the one failure this whole record exists to make impossible.
    return ids.slice(Math.max(0, a), Math.min(ids.length, b + 1));
  };

  const readerSlices = asArray(plan.reader_slices)
    .map(asRecord)
    .filter((r): r is Record<string, unknown> => r !== null)
    .sort((x, y) => (asInt(x.reader) ?? 0) - (asInt(y.reader) ?? 0))
    .map((r) => sliceOf(r.from, r.to));

  const notRead = asRecord(plan.not_read);
  const unread: { key: string; reason: ReadingNotReadReason }[] = [];
  if (notRead) {
    const reason = asText(notRead.reason) as ReadingNotReadReason;
    for (const id of sliceOf(notRead.from, notRead.to)) {
      unread.push({ key: id, reason: READING_NOT_READ_REASONS.includes(reason) ? reason : "repository_answer" });
    }
  }

  return {
    // The unit count is the ORDER'S length — every unit is in it exactly once, which is U1's own
    // statement about `order` ("a TOTAL ordering of every unit"). `adjudication_group.reading_units`
    // is the same number written by U1 after the packing; it is read only where the order is absent,
    // so the two can never disagree here without the disagreement being visible.
    reading_units: order.length > 0 ? order.length : (asInt(group?.reading_units) ?? 0),
    unit,
    ...(asText(plan.unit) === "place" ? { places: true as const } : {}),
    readers: readerSlices.length,
    reader_slices: readerSlices,
    seat_slice: ids.slice(0, readBySeat),
    unread,
    ...(asText(plan.reading_class) ? { reading_class: asText(plan.reading_class) } : {}),
  };
}

/**
 * THE UNITS ONE SEAT ACTUALLY READS, as a census — kinds where the plan reads by kinds, and one
 * unit per location where it reads by locations.
 *
 * **Why the per-location class goes through the same object.** `baseline-006` and every rule with
 * no declared class are read line by line: each line is separately a possible violation, so the
 * reading unit is the location and the trail must carry one row per location. That is a unit of ONE
 * member whose representative is itself, which is the same shape a kind has, so the assembly, the
 * fold, the payload writer and the coverage check all work on this and none of them asks the class.
 * Nothing here reads less than the per-location behaviour of today.
 *
 * The census DIGEST is taken over the real groups either way (`censusHash`), because that is what a
 * later run re-derives and what unit H carries a verdict forward on.
 */
export function readingUnitsCensusOf(candidate: Candidate): ReadingCensus | null {
  const census = kindCensusOf(candidate);
  if (!census) return null;
  const plan = readingPlanOf(candidate);
  if (!plan || plan.unit === "kind") return census;
  const locations = (candidate.locations ?? []) as FindingLocation[];
  return {
    ...census,
    kinds: locations.map((loc, index) => {
      const l = loc as unknown as Record<string, unknown>;
      return {
        id: unitId(index),
        key: `${loc.file}:${loc.start_line}`,
        ...(asText(l.clause) ? { clause: asText(l.clause) } : {}),
        ...(asText(l.context_class) ? { context_class: asText(l.context_class) } : {}),
        ...(asText(l.matched_token) ? { matched_token: asText(l.matched_token) } : {}),
        member_count: 1,
        members: [loc],
        representative: loc,
        sub_shapes: [],
        sub_shape_count: 0,
      };
    }),
  };
}

/**
 * How many units this candidate costs one seat to read — the number every bound below is in.
 *
 * Kinds where U1 planned a reading by kinds; locations otherwise, which is today's behaviour and
 * the behaviour of every candidate under the bound. **The fallback is the larger unit count, never
 * the smaller**: a candidate whose plan cannot be read is packed as if every location had to be
 * read, so a plan this function fails to understand can only make a payload smaller.
 */
export function readingUnitsOf(candidate: Candidate): number {
  const plan = readingPlanOf(candidate);
  if (plan && plan.reading_units >= 1) return plan.reading_units;
  return candidate.locations.length;
}

/** How many readers the plan gives this candidate. 0 where it gives none, which is the ordinary case. */
export function readersOf(candidate: Candidate): number {
  const plan = readingPlanOf(candidate);
  return plan ? Math.max(0, plan.readers) : 0;
}

/** The unit the plan reads in. `kind` where there is no plan, which no caller relies on. */
export function readingUnitOf(candidate: Candidate): "kind" | "location" {
  return readingPlanOf(candidate)?.unit ?? "kind";
}

/**
 * ONE PART OF A DUTY THE RULE'S OWN QUESTION TEXT WALKS (design section 2 evidence rule E3), as the
 * rule declares it in `reading_class.elements[]` and `scan.ts` copies it onto the candidate. The
 * name is matched exactly: an evidence entry of role `element` answers the element whose `name` it
 * carries, and a recorded search answers the element whose name its `for` equals.
 */
export interface ReadingElement {
  name: string;
  question?: number;
  text?: string;
}

/**
 * The rule's declared reading class, as the rule declares it and `scan.ts` copies it onto the
 * candidate.
 *
 * Read through this accessor and nowhere else, for the reason the census accessors are: the field is
 * another unit's and a second reading of it here would be a forbidden second copy. **Absent is
 * absent**: the enumeration check below is inert on a candidate that carries no class, and two cases
 * produce one — a candidate of one of the 62 rules that declare none (55 of the 117 declare one),
 * and EVERY candidate of a `--kind-census off` run, where the copy in `scan.ts` is gated on the
 * census being on.
 */
export function readingClassOf(
  candidate: Candidate,
): {
  class?: string;
  item?: string;
  item_source?: string;
  elements?: ReadingElement[];
  limbs?: { question?: number; class?: string; item_source?: string }[];
} | null {
  const c = candidate as unknown as Record<string, unknown>;
  const declared = asRecord(c.reading_class);
  if (!declared) return null;
  /* `elements` (unit R1, 2026-09-22) travels the same way the rest of the class does: `scan.ts`
   * structuredClones the whole `reading_class` onto the candidate, so nothing here parses the rule
   * a second time. An entry with no name is dropped rather than carried half-formed, because the
   * name is what an evidence entry and a recorded search are matched against. */
  const rawElements = Array.isArray(declared.elements) ? declared.elements : [];
  const elements: ReadingElement[] = [];
  for (const raw of rawElements) {
    const row = asRecord(raw);
    const name = row ? asText(row.name) : undefined;
    if (!name) continue;
    const question = row && typeof row.question === "number" ? row.question : undefined;
    elements.push({
      name,
      ...(question !== undefined ? { question } : {}),
      ...(row && asText(row.text) ? { text: asText(row.text)! } : {}),
    });
  }
  /* `limbs` is read for two purposes: a mixed rule can carry an existence limb, and the premise
   * requirement (E4) is owed on the existence class and on a mixed rule's existence limbs alike; and an
   * enumeration limb's `item_source` says whether the program holds the limb's items (place-fold.ts
   * `programItemSourceOf`). */
  const limbs: { question?: number; class?: string; item_source?: string }[] = [];
  for (const raw of Array.isArray(declared.limbs) ? declared.limbs : []) {
    const row = asRecord(raw);
    if (!row) continue;
    limbs.push({
      ...(typeof row.question === "number" ? { question: row.question } : {}),
      ...(asText(row.class) ? { class: asText(row.class) } : {}),
      ...(asText(row.item_source) ? { item_source: asText(row.item_source) } : {}),
    });
  }
  return {
    ...(asText(declared.class) ? { class: asText(declared.class) } : {}),
    ...(asText(declared.item) ? { item: asText(declared.item) } : {}),
    ...(asText(declared.item_source) ? { item_source: asText(declared.item_source) } : {}),
    ...(elements.length > 0 ? { elements } : {}),
    ...(limbs.length > 0 ? { limbs } : {}),
  };
}

/* --------------------------------------------------------------------------------------------- *
 * What a verdict rests on: the census digest.
 * --------------------------------------------------------------------------------------------- */

/**
 * A digest over the census rows — keys, member lists and sub-shape counts (design section 9).
 *
 * **Re-derivable with no model**, which is the point: unit H carries a verdict forward only when
 * this hash, the files read and the search hits are all unchanged, so a new kind — a new vendor, a
 * new store, a new route — changes the hash and the candidate is adjudicated again. The serialised
 * form is written out rather than `JSON.stringify`d so that a field U1 adds later does not silently
 * move every hash in every stored verdict.
 */
export function censusHash(census: ReadingCensus): string {
  const h = createHash("sha256");
  h.update(`${census.spec}\u0000${census.level}\u0000${census.kinds.length}\n`);
  for (const kind of census.kinds) {
    h.update(`${kind.key}\u0000${kind.member_count}\u0000${kind.sub_shape_count}\u0000`);
    h.update(kind.members.map((m) => `${m.file}:${m.start_line}`).join("\u0001"));
    h.update("\n");
  }
  return h.digest("hex");
}

/* --------------------------------------------------------------------------------------------- *
 * The reading skeleton.
 * --------------------------------------------------------------------------------------------- */

/**
 * HOW MANY MEMBERS OF A UNIT THE SKELETON LISTS BY ID. A member past it is named by the seat as `at: "file:line"` and
 * resolved by the program; the ids of every member exist either way (`skeletonLocations`).
 */
export const SKELETON_MEMBERS_LISTED = 12;
/** How many sub-shapes of a unit the skeleton (and so the payload) lists: the largest, by members. */
export const SKELETON_SUB_SHAPES_LISTED = 3;

/** One listed location of a unit: its id and its line. */
export interface SkeletonLocation {
  id: string;
  file: string;
  start_line: number;
}

/**
 * ONE UNIT OF THE SKELETON, as the payload writes it in `kinds[]`: the program's own facts about the unit (layer 1's),
 * with an id on every location it lists. `kind` is the unit id (`12`, or `L7` where the plan reads by location);
 * `sub_shapes[].id` is `12/s2`, `member_ids[].id` is `12/m3` (path-then-line order, wherever it puts the representative), and
 * `item` the census item id of the unit's matched token. The seat copies none of it: it answers by these ids.
 */
export interface SkeletonUnit {
  kind: string;
  key: string;
  own_evidence?: true;
  clause?: string;
  context_class?: string;
  matched_token?: string;
  item?: string;
  members: number;
  /**
   * HOW MANY MEMBERS STILL OWE A DECISION once the representative is read: each is opened
   * in `also`, settled by `rest`, or declined by `decline`. Written only where the unit has more than one member.
   */
  members_owed?: number;
  files: number;
  directories: string[];
  sub_shape_count: number;
  representative: { file: string; start_line: number };
  sub_shapes: { id: string; key: string; members: number; file: string; start_line: number; text?: string }[];
  member_ids: SkeletonLocation[];
}

/** A census item (a matched token), with the handed units that carry it and how many units of the census do. */
export interface SkeletonItem {
  id: string;
  token: string;
  units: string[];
  units_total: number;
}

/** What the program writes of a seat's reading before the seat reads: `skeletonOf`. */
export interface ReadingSkeleton {
  /** `censusHash` of the candidate's census: ties the payload to the findings document it was written from. */
  census_hash: string;
  units: SkeletonUnit[];
  items: SkeletonItem[];
}

/** A unit's sub-shapes in id order: by members, most first, then by key. `s1` is the first. */
export function sortedSubShapes(kind: ReadingKind): ReadingSubShape[] {
  return [...kind.sub_shapes].sort((a, b) => b.member_count - a.member_count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** A unit's members in id order (path-then-line, the representative first where it is the first). `m1` is the first. */
export function sortedMembers(kind: ReadingKind): FindingLocation[] {
  return [...kind.members].sort(byPathThenLine);
}

/** The census items of a census: its distinct matched tokens in code-unit order, `I1` first, each with its units. */
export function censusItems(census: ReadingCensus): { id: string; token: string; units: string[] }[] {
  const byToken = new Map<string, string[]>();
  for (const k of census.kinds) {
    if (!k.matched_token) continue;
    const units = byToken.get(k.matched_token) ?? [];
    units.push(k.id);
    byToken.set(k.matched_token, units);
  }
  return [...byToken.keys()]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((token, i) => ({ id: `I${i + 1}`, token, units: byToken.get(token)! }));
}

/**
 * THE UNIT IDS ONE PAYLOAD HANDS, from the findings document alone: the verdict seat's slice (`seat`) or reader n's
 * (`{ reader: n }`, 1-based). The one rule the payload writer (`context.ts` `payloadJobs`) and the capture both use:
 * a plan that names a seat slice is followed; a plan with no seat slice and no readers, or no plan, hands every unit.
 * Null for a candidate read location by location (no census) or a reader the plan does not have.
 */
export function handedUnitIds(candidate: Candidate, who: "seat" | { reader: number }): string[] | null {
  const census = readingUnitsCensusOf(candidate);
  if (!census) return null;
  const plan = readingPlanOf(candidate);
  const known = new Set(census.kinds.map((k) => k.id));
  if (who !== "seat") {
    const slice = plan?.reader_slices[who.reader - 1];
    return slice ? slice.filter((k) => known.has(k)) : null;
  }
  if (!plan || (plan.seat_slice.length === 0 && plan.reader_slices.length === 0)) return census.kinds.map((k) => k.id);
  return plan.seat_slice.filter((k) => known.has(k));
}

/**
 * THE SKELETON OF ONE SEAT'S READING (design section 2.1): every handed unit with ids on its sub-shapes (the largest
 * `SKELETON_SUB_SHAPES_LISTED`) and its members (the first `SKELETON_MEMBERS_LISTED`), the census items the handed
 * units carry, and the census hash. **One function, used by the payload writer and by the capture, never a second
 * copy**: the capture recomputes it from the findings document to check and assemble the seat's decisions. Null for a
 * candidate read location by location. `slice` is the handed unit ids (`handedUnitIds`), in the order handed.
 */
export function skeletonOf(candidate: Candidate, slice: readonly string[]): ReadingSkeleton | null {
  const units = readingUnitsCensusOf(candidate);
  const real = kindCensusOf(candidate);
  if (!units || !real) return null;
  const byId = new Map(units.kinds.map((k) => [k.id, k]));
  const handed = slice.map((id) => byId.get(id)).filter((k): k is ReadingKind => k !== undefined);
  const handedIds = new Set(handed.map((k) => k.id));
  const items = censusItems(units);
  const itemOf = new Map(items.map((i) => [i.token, i.id]));
  return {
    census_hash: censusHash(real),
    units: handed.map((kind): SkeletonUnit => {
      const item = kind.matched_token ? itemOf.get(kind.matched_token) : undefined;
      return {
        kind: kind.id,
        key: kind.key,
        ...(kind.own_evidence ? { own_evidence: true as const } : {}),
        ...(kind.clause ? { clause: kind.clause } : {}),
        ...(kind.context_class ? { context_class: kind.context_class } : {}),
        ...(kind.matched_token ? { matched_token: kind.matched_token } : {}),
        ...(item ? { item } : {}),
        members: kind.member_count,
        ...(kind.member_count > 1 ? { members_owed: kind.member_count - 1 } : {}),
        files: new Set(kind.members.map((m) => m.file)).size,
        directories: [...new Set(kind.members.map((m) => directoryOfPath(m.file)))].sort().slice(0, 8),
        sub_shape_count: kind.sub_shape_count,
        representative: { file: kind.representative.file, start_line: kind.representative.start_line },
        sub_shapes: sortedSubShapes(kind)
          .slice(0, SKELETON_SUB_SHAPES_LISTED)
          .map((s, i) => ({
            id: `${kind.id}/s${i + 1}`,
            key: s.key,
            members: s.member_count,
            file: s.first.file,
            start_line: s.first.start_line,
            ...(s.text ? { text: s.text } : {}),
          })),
        member_ids: sortedMembers(kind)
          .slice(0, SKELETON_MEMBERS_LISTED)
          .map((m, i) => ({ id: `${kind.id}/m${i + 1}`, file: m.file, start_line: m.start_line })),
      };
    }),
    items: items
      .map((i) => ({ id: i.id, token: i.token, units: i.units.filter((u) => handedIds.has(u)), units_total: i.units.length }))
      .filter((i) => i.units.length > 0),
  };
}

/**
 * EVERY LOCATION ID OF A CANDIDATE'S CENSUS, listed or not: unit `12` (its representative), sub-shape `12/sN` (its
 * first line) and member `12/mN`, over every unit of the census (a seat may open a unit outside its slice, as run 2's
 * bin:26 seat did). What the capture resolves a decision's id, and an `at`, against.
 */
export interface SkeletonLocations {
  units: Map<string, ReadingKind>;
  /** id -> the unit id and the location (a unit id maps to its representative). */
  at: Map<string, { unit: string; location: FindingLocation; sub_shape?: string }>;
  items: Map<string, { token: string; units: string[] }>;
}

export function skeletonLocations(candidate: Candidate): SkeletonLocations | null {
  const census = readingUnitsCensusOf(candidate);
  if (!census) return null;
  const units = new Map(census.kinds.map((k) => [k.id, k]));
  const at = new Map<string, { unit: string; location: FindingLocation; sub_shape?: string }>();
  for (const kind of census.kinds) {
    at.set(kind.id, { unit: kind.id, location: kind.representative });
    sortedSubShapes(kind).forEach((s, i) => at.set(`${kind.id}/s${i + 1}`, { unit: kind.id, location: s.first, sub_shape: s.key }));
    sortedMembers(kind).forEach((m, i) => at.set(`${kind.id}/m${i + 1}`, { unit: kind.id, location: m }));
  }
  return { units, at, items: new Map(censusItems(census).map((i) => [i.id, { token: i.token, units: i.units }])) };
}

/* --------------------------------------------------------------------------------------------- *
 * The seat's decisions, keyed by the skeleton's ids.
 * --------------------------------------------------------------------------------------------- */

/**
 * WHO RETURNS DECISIONS: the verdict seat, which may decline a unit it was handed under a note, or a reader, which
 * disposes of every unit it holds (its reply had no `declined` list before either) and is attached to its candidate by
 * its launch entry, never by the locations it names; or the refuter (M5, design section 2.5), whose reading is a record
 * and not a duty: it is handed no unit to decide, may open any unit of the census, and owes no `rest` and no
 * `disposition` (its read rows carried neither as a duty before).
 */
export type DecisionSeat = "seat" | "reader" | "refuter";

/**
 * THE FIELDS A DECISION MAY NOT CARRY, and what the seat writes instead: each is the program's, written in the skeleton
 * (design section 2.4: "an answer that carries `reading.read`, `file`/`lines` on a decision without `at`, `kind`,
 * `members`, `by` or `key` is refused as rewriting the skeleton"). `sub_shape` and `cover_ground` are the two row fields
 * the decision names by an id (`12/s2`) or a word of its own (`rest`).
 */
export const SKELETON_FIELDS_INSTEAD: Readonly<Record<string, string>> = {
  kind: "`unit`, the id the payload lists",
  file: "`at` (\"file:line\"), and only where you quoted a line other than the one the id names",
  lines: "`at` (\"file:line\"), and only where you quoted a line other than the one the id names",
  sub_shape: "the sub-shape's id in `unit` (\"12/s2\")",
  cover_ground: "`rest`",
  members: "nothing: the member counts are the program's",
  by: "nothing: which row settles a unit's other members is the program's",
  key: "nothing: the unit's key is the program's",
};

/** One problem with a seat's decisions: its class and the id it names. `renderDecisionProblems` groups them. */
export interface DecisionProblem {
  cls: string;
  id: string;
  /** For `rest-missing`: the unit's member ids still owed a decision, compactly. */
  owed?: string;
}

/**
 * IDS, COMPACTLY: numeric runs of three or more as ranges ("41-63"), within one prefix ("L3-L9", "12/m2-12/m5"),
 * everything in numeric order, ids with no number last in the order given. The owed list "7, 9, 41-63" is one line
 * where a list of every id would be 64.
 */
export function compactIds(ids: readonly string[]): string {
  const unique = [...new Set(ids)];
  const numbered: { prefix: string; n: number; id: string }[] = [];
  const other: string[] = [];
  for (const id of unique) {
    const m = /^(.*?)(\d+)$/.exec(id);
    if (m) numbered.push({ prefix: m[1]!, n: Number(m[2]), id });
    else other.push(id);
  }
  numbered.sort((a, b) => (a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : a.n - b.n));
  const out: string[] = [];
  for (let i = 0; i < numbered.length; ) {
    let j = i;
    while (j + 1 < numbered.length && numbered[j + 1]!.prefix === numbered[i]!.prefix && numbered[j + 1]!.n === numbered[j]!.n + 1) j++;
    if (j - i >= 2) out.push(`${numbered[i]!.id}-${numbered[j]!.id}`);
    else for (let k = i; k <= j; k++) out.push(numbered[k]!.id);
    i = j + 1;
  }
  return [...out, ...other].join(", ");
}

const SHAPE_GROUNDS_LIST = READING_COVER_GROUNDS.join(", ");

/** The sentence for one class, with its ids. One line per class, whatever the number of ids. */
function decisionProblemText(cls: string, ids: string): string {
  if (cls.startsWith("rewrites:")) {
    const field = cls.slice("rewrites:".length);
    return `${ids}: \`${field}\` is the program's, written in the skeleton your payload lists; a decision never rewrites it. Write ${SKELETON_FIELDS_INSTEAD[field] ?? "nothing in its place"}`;
  }
  switch (cls) {
    case "reading":
      return "your answer carries a `reading` block, the old form: the program now writes the reading record from your decisions. Answer each candidate that carries `kinds` with `decisions` (one per unit you were handed, keyed by the unit's id) and `searched`, and no `reading`";
    case "no-decisions":
      return `this candidate carries \`kinds\`, and your answer has no \`decisions\` list: give one decision per unit you were handed (${ids}), keyed by its id`;
    case "no-census":
      return "this candidate carries no `kinds`: it is read location by location, and its answer takes no `decisions` and no `searched`";
    case "not-a-decision":
      return `${ids}: not an object with \`unit\` (a unit you opened) or \`units\` and \`declined\` (units you chose not to open)`;
    case "both-forms":
      return `${ids}: carries both \`unit\` and \`units\`; a decision either opens one unit or sub-shape (\`unit\`) or declines units (\`units\` with \`declined\`)`;
    case "unknown-id":
      return `${ids} name no unit, sub-shape or member of this candidate's census: write the ids exactly as your payload lists them`;
    case "member-as-unit":
      return `${ids} are member ids: a decision's \`unit\` names a unit ("12") or a sub-shape ("12/s2"), and a member you opened goes in that unit's \`also\``;
    case "not-handed":
      return `${ids} were not handed to you: a reader decides only the units it holds`;
    case "decline-not-unit":
      return `${ids}: \`units\` of a declining decision names whole units ("12"), never a sub-shape or a member`;
    case "decline-note":
      return `${ids}: \`declined\` is empty; say in one sentence why you chose not to open these units`;
    case "reader-declines":
      return `${ids}: a reader disposes of every unit it holds and declines none, nor any member of one; open each and decide it`;
    case "no-decision":
      return `units ${ids} were handed to you and have no decision: decide each (\`unit\`), or decline it (\`units\` with \`declined\`)`;
    case "twice":
      return `${ids} are decided more than once: give one decision per unit or sub-shape`;
    case "declined-and-opened":
      return `units ${ids} are both declined and opened: a unit you opened is decided, not declined`;
    case "same-location":
      return `${ids} name a location already opened in the same unit: each location is recorded once`;
    case "quote-empty":
      return `${ids}: \`quote\` is empty; every location you opened carries the line you read there, verbatim`;
    case "disposition":
      return `${ids}: \`disposition\` is not one of is_the_construct, not_the_construct, construct_but_gated, undetermined`;
    case "at-outside":
      return `${ids}: \`at\` is not "file:lines" naming a line of a file this candidate's census holds (any line of such a file is recorded as you name it)`;
    case "at-form":
      return `${ids}: \`at\` is not "file:line" (or "file:start-end") naming a line of a file that holds a member of that unit`;
    case "also-not-member":
      return `${ids}: an \`also\` entry names a member of the decision's own unit, by its id ("12/m3") or, past the listed members, by \`at\` ("file:line" of that member)`;
    case "also-form":
      return `${ids}: an \`also\` entry carries exactly one of \`member\` and \`at\`, and \`quote\``;
    case "rest-missing":
      return `units ${ids} have members you neither opened (\`also\`), settled (\`rest\`) nor declined (\`decline\`): open them in \`also\`; or settle them with \`rest\`, the one of the six shape grounds (${SHAPE_GROUNDS_LIST}) that settles them (a ground that depends on a call path or a gate is per file: open each member's file); or, where you did not read them, decline them on the unit's decision, \`"decline": {"members": "rest"}\` or their ids, with \`"note"\`, your sentence, and they are recorded as not read`;
    case "decline-form":
      return `${ids}: \`decline\` is \`{"members": "rest" or a list of this unit's member ids, "note": your sentence}\``;
    case "decline-not-member":
      return `${ids}: a \`decline\` names members of its own decision's unit, by id ("12/m3"), or \`"rest"\``;
    case "member-declined-and-opened":
      return `${ids} are both opened and declined: a member you opened is decided, not declined`;
    case "decline-twice":
      return `units ${ids} decline members on more than one decision: name every member you did not read on one \`decline\``;
    case "rest-and-decline":
      return `units ${ids} both settle their other members (\`rest\`) and decline all of them (\`"members": "rest"\`): a member is settled or not read, not both`;
    case "rest-conflict":
      return `units ${ids} carry different \`rest\` grounds on different decisions: a unit's other members are settled on one ground`;
    case "evidence-id-role":
      return `${ids}: only a \`premise\` names an opened location by \`unit\`, and only a census \`item\` names an \`item\` id with it; an element, a site and an item found by reading keep their \`file\`, \`lines\` and \`quote\``;
    case "evidence-both":
      return `${ids}: names its location twice, by \`unit\` and by \`file\`/\`lines\`/\`quote\`; an entry named by id carries no location and no quotation: the program writes them from your decision at that id`;
    case "evidence-no-unit":
      return `${ids}: an entry naming an \`item\` names in \`unit\` the opened location that carries it`;
    case "evidence-not-opened":
      return `${ids}: none of your decisions opened this id; an evidence entry names a unit, a sub-shape or an \`also\` member you opened, and the program takes its line and your quotation from that decision. A place counts as opened only where a Read of yours covers its line, or your payload's excerpt shows it and you read the payload whole: a line seen in a search result is not opened, so Read the file around it first`;
    case "premise-not-affirmative":
      return `premise ${ids}: a premise names a location you decided \`is_the_construct\` or \`construct_but_gated\``;
    case "item-not-census":
      return `${ids}: this rule's items are found by reading, not the matched word, so an item has no census id: write its \`name\`, \`file\`, \`lines\` and \`quote\``;
    case "unknown-item":
      return `${ids} name no item of this candidate's census: write the item id exactly as the payload's \`census_items\` lists it`;
    case "item-not-in-unit":
      return `${ids}: that unit does not carry the item; name an opened location of a unit the payload's \`census_items\` lists under it`;
    case "item-name":
      return `${ids}: \`name\` is not that item's token; the program writes an item's name from the census, so leave \`name\` out`;
    case "rest-not-six":
      return `${ids}: \`rest\` is not one of the six shape grounds (${SHAPE_GROUNDS_LIST})`;
    case "rest-place":
      // Names no other ground (section 14, as `locationOverturnRefused` in standing.ts).
      return `${ids}: \`rest\` \`generated_or_fixture_path\` settles members by where they sit, which does not apply to a rule whose block does not carry \`"duty_about": "product_runtime"\`, as this rule's block does not: read the members and judge only whether each line is the construct the rule names`;
    default:
      return `${ids}: ${cls}`;
  }
}

/** The problems, one line per class in first-seen order, each naming its ids compactly. */
export function renderDecisionProblems(problems: readonly DecisionProblem[]): string[] {
  const byClass = new Map<string, string[]>();
  const owed = new Map<string, string[]>();
  for (const p of problems) {
    const ids = byClass.get(p.cls) ?? [];
    ids.push(p.id);
    byClass.set(p.cls, ids);
    if (p.owed) owed.set(p.cls, [...(owed.get(p.cls) ?? []), `unit ${p.id}: ${p.owed}`]);
  }
  // The members still owed, per unit (analysis fix 5): the ids the seat answers by, so a resend needs no search for them.
  return [...byClass].map(([cls, ids]) => decisionProblemText(cls, compactIds(ids)) + (owed.has(cls) ? `. Still owed: ${owed.get(cls)!.join("; ")}` : ""));
}

/**
 * THE MEMBER IDS OF ONE UNIT STILL OWED A DECISION, compactly: every member in id order
 * that no row stands at and no `decline` names; the ids past the payload's listed members counted, not spelled.
 */
function owedMemberIds(kind: ReadingKind, openedAt: ReadonlySet<string>, declinedIds: ReadonlySet<string>): string {
  const ids = sortedMembers(kind)
    .map((m, i) => ({ id: `${kind.id}/m${i + 1}`, at: `${m.file}:${m.start_line}`, i }))
    .filter((m) => !openedAt.has(m.at) && !declinedIds.has(m.id));
  const listed = ids.filter((m) => m.i < SKELETON_MEMBERS_LISTED).map((m) => m.id);
  const past = ids.length - listed.length;
  return [listed.length > 0 ? compactIds(listed) : "", past > 0 ? `${past} more past the ${SKELETON_MEMBERS_LISTED} listed (\`at\` or \`"rest"\`)` : ""].filter(Boolean).join(", and ");
}

/** "file:line" or "file:start-end" as a file and a `lines` value, or null. The file is everything before the last colon. */
/**
 * A LINE REFERENCE, AS A FILE'S LINES ARE NUMBERED (relay integration part B, area gamma, item 2):
 * "12", "12-15", "12 to 15", "12, 15", "L12", "L12-L15", "lines 12-15" (any case), every number from 1. The one
 * copy: verdict-verify.ts `lineReferenceProblem` reads it from here.
 */
export const LINE_REFERENCE =
  /^(?:(?:L|lines?)\s*)?\d+(?:\s*(?:-|\u2013|to)\s*(?:L\s*)?\d+)?(?:\s*(?:,|;|&|and)\s*(?:(?:L|lines?)\s*)?\d+(?:\s*(?:-|\u2013|to)\s*(?:L\s*)?\d+)?)*$/i;

/**
 * "file:line" or "file:start-end". `anyLines` (the refuter's `at`, the parent's ruling of 2026-09-30 on M5): any line
 * reference a record's `lines` may hold ("8,10" included), recorded as written.
 */
function parseAt(at: string, anyLines = false): { file: string; lines: string; first: number } | null {
  const i = at.lastIndexOf(":");
  if (i <= 0) return null;
  const file = at.slice(0, i).trim();
  const lines = at.slice(i + 1).trim();
  if (anyLines) {
    const numbers = (lines.match(/\d+/g) ?? []).map(Number);
    if (!file || !LINE_REFERENCE.test(lines) || numbers.some((n) => n < 1)) return null;
    return { file, lines, first: numbers[0]! };
  }
  const m = /^(\d+)(?:-(\d+))?$/.exec(lines);
  if (!file || !m) return null;
  const first = Number(m[1]);
  if (first < 1 || (m[2] !== undefined && Number(m[2]) < first)) return null;
  return { file, lines, first };
}

const firstLineOf = (lines: string): string => /^\s*(\d+)/.exec(lines)?.[1] ?? lines.trim();

/**
 * THE KEY OF ONE OPENED LOCATION (one row per location, which replaces one row
 * per unit and sub-shape): the unit, the sub-shape the row names, and the file and first line it was opened at. The
 * assembler and the coverage check both use it, so a second row at the same location is refused in one wording, and a
 * member opened on its own (`also`) is a location of its own.
 */
export function readRowLocationKey(row: { kind?: unknown; sub_shape?: unknown; file?: unknown; lines?: unknown }): string {
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  return `${text(row.kind)}\u0000${text(row.sub_shape)}\u0000${text(row.file)}:${firstLineOf(text(row.lines))}`;
}

/** What `readingOfDecisions` made of a seat's decisions: today's rows, or the problems that refuse them. */
export interface DecisionsReading {
  read: ReadingReadRow[];
  declined: ReadingDeclinedRow[];
  problems: DecisionProblem[];
  /** The row each id the seat opened became: a decision's `unit` (unit or sub-shape id) and each `also` member id. */
  rowById: Map<string, ReadingReadRow>;
  /** The rows the seat answered as opened where `opened` says it did not open the code around them. */
  unopened: ReadingUnopenedRow[];
  /**
   * Fix R1: the positions in `decisions` of the decisions refused for what they are, which no later decision
   * replaces by its id (no object, no `unit` or `units`, both forms, an id no census names, a member as a unit, a unit a
   * reader does not hold): they are not part of the base a later answer amends (amend.ts `RefusalRemoved`).
   */
  removed?: number[];
}

const SEAT_DISPOSITIONS: readonly string[] = READING_DISPOSITIONS.filter((d) => d !== "not_read");

/**
 * THE SEAT'S DECISIONS AS TODAY'S ROWS (design sections 2.2-2.4). Each `read` row takes `kind`, `sub_shape`, `file` and
 * `lines` from the skeleton (`skeletonLocations`: the id's own line, or the seat's `at`), and `quote`, `disposition`,
 * `ground` and `cover_ground` (from `rest`) from the decision; each `also` entry is one more row, at its member's line,
 * with its own quote; a declining decision is one `declined` row per unit, each with the one note. The rows are the
 * record's `reading.read` and `reading.declined` exactly as a seat wrote them before, so `assembleReading`, the
 * coverage check, the quote check and every reader of a record read them unchanged; the program never writes a
 * quotation.
 *
 * The checks (section 2.4): every handed unit decided exactly once (itself, or its sub-shapes, never one location
 * twice); every id in the census (a unit outside a verdict seat's slice may be opened, never required; a reader decides
 * only its own); `rest` present and one of the six where the unit has members nobody opened and it was not declined,
 * and one ground per unit; `also` names members of the decision's own unit; and no decision rewrites the skeleton.
 *
 * **Three things section 2.4 would refuse are carried, on the evidence of every accepted answer on disk**: a `rest` on a unit with no member left (14 of 21 accepted answers, 94 units,
 * wrote one; it settles nothing and the row keeps it as it kept `cover_ground`), the same `rest` on several sub-shape
 * decisions of one unit (24 units in arm H's bin:26; only DIFFERENT grounds are refused), and a verdict seat declining a
 * unit outside its slice (run 2's bin:26: the assembler reports it unused, as before). Refusing them would cost the
 * seat a resend and change nothing in the record, which is the churn this form exists to end.
 *
 * **READ MEANS OPENED**. Every row this function makes - a decision's unit
 * or sub-shape, at the id's line or its `at`, and each `also` member, for a verdict seat, a reader and the refuter alike,
 * and for an amended answer the merged whole - passes through one closure (`opened` below), and that closure is the one
 * place the rule is applied: where the capture passes `opened` (the hook always does, from the seat's own transcript,
 * seat-opened.ts), a row whose location the seat did not open, or whose credited member (`memberAtRow`) it did not
 * open, is not a read row. It is recorded in `unopened` with the
 * member it stands for, still counts as that member's decision (so no `rest` is owed for it), names no id in `rowById`
 * (so no premise may rest on it), and is never the location a member decline treats as opened. Without `opened` (a
 * caller with no transcript: a unit fixture, or the `verdict-capture` command run by hand, whose records a hooked run
 * refuses at assembly) every row is read, as before. The quote check is unchanged.
 */
export function readingOfDecisions(args: {
  candidate: Candidate;
  handed: readonly string[];
  decisions: unknown;
  who: DecisionSeat;
  /** Whether the seat opened the code around `lines` of `file`; absent, every row counts as opened. */
  opened?: (file: string, lines: string) => boolean;
}): DecisionsReading {
  const locs = skeletonLocations(args.candidate);
  const problems: DecisionProblem[] = [];
  const read: ReadingReadRow[] = [];
  const declined: ReadingDeclinedRow[] = [];
  const unopened: ReadingUnopenedRow[] = [];
  /** Every row the seat answered as opened, read or not: what a member decline's "rest" is counted against. */
  const claimed: ReadingReadRow[] = [];
  const rowById = new Map<string, ReadingReadRow>();
  if (!locs) return { read, declined, problems: [{ cls: "no-census", id: "" }], rowById, unopened };
  if (!Array.isArray(args.decisions)) return { read, declined, problems: [{ cls: "no-decisions", id: compactIds(args.handed) }], rowById, unopened };
  const refuter = args.who === "refuter";
  const censusFiles = new Set([...locs.units.values()].flatMap((k) => k.members.map((m) => m.file)));
  const censusHolds = (file: string) => censusFiles.has(file);
  const plan = readingPlanOf(args.candidate);
  const readerHeld = new Set((plan?.reader_slices ?? []).flat());
  const handed = new Set(args.handed);
  const decidedIds = new Map<string, number>();
  const declinedUnits = new Map<string, number>();
  const openedUnits = new Set<string>();
  const rowsOf = new Map<string, number>();
  const restsOf = new Map<string, Set<string>>();
  const locationsOf = new Map<string, Set<string>>();
  /** Each unit's member decline, as the decision named it ("rest" or ids), and the decisions that did. */
  const memberDeclines = new Map<string, { members: "rest" | string[]; by: string[] }>();
  const text = (v: unknown): string => (typeof v === "string" ? v : "");
  const opened = (unit: string, row: ReadingReadRow, label: string) => {
    const seen = locationsOf.get(unit) ?? new Set<string>();
    const at = `${row.file}:${firstLineOf(row.lines)}`;
    if (seen.has(at)) problems.push({ cls: "same-location", id: label });
    seen.add(at);
    locationsOf.set(unit, seen);
    rowsOf.set(unit, (rowsOf.get(unit) ?? 0) + 1);
    openedUnits.add(unit);
    claimed.push(row);
    /* THE PLACE THE ROW IS CREDITED TO IS OPENED TOO. A row stands for one member
     * (`memberAtRow`): the member at its first line, else - a decision whose `at` names a line no member stands at, in
     * a unit's or a sub-shape's decision, or the refuter's `at` or `also` at any line of the census - the sub-shape's
     * first or the unit's representative. Every later count reads that member as the place the row read (the member
     * decline's "rest", the not-opened list, the partition's place-by-place check, `readAgainOf`), so a row whose own
     * lines were opened but whose member was not would make that member "opened and checked" with nothing covering it.
     * The predicate is therefore asked of both; where either fails the row is not opened and its member is listed as
     * such. Where the member is at the row's own first line (a decision at its id, an `also`), the second question is
     * the first's. */
    const credited = memberLocationAtRow(locs.units.get(unit)!, row);
    if (args.opened && !(args.opened(row.file, row.lines) && args.opened(credited.file, String(credited.start_line)))) {
      unopened.push({ kind: unit, ...(row.sub_shape !== undefined ? { sub_shape: row.sub_shape } : {}), file: row.file, lines: row.lines, member: `${credited.file}:${credited.start_line}` });
      return;
    }
    read.push(row);
    if (locs.at.has(label) && !rowById.has(label)) rowById.set(label, row);
  };

  const removed: number[] = [];
  args.decisions.forEach((value, i) => {
    const d = asRecord(value);
    const label = `decision ${i + 1}`;
    if (!d) {
      problems.push({ cls: "not-a-decision", id: label });
      removed.push(i);
      return;
    }
    const named = text(d.unit) || (Array.isArray(d.units) ? d.units.filter((u) => typeof u === "string").join("+") : "") || label;
    for (const field of Object.keys(SKELETON_FIELDS_INSTEAD)) if (field in d) problems.push({ cls: `rewrites:${field}`, id: named });
    if ("units" in d || "declined" in d) {
      if ("unit" in d) {
        problems.push({ cls: "both-forms", id: named });
        removed.push(i);
        return;
      }
      if (args.who === "reader") {
        problems.push({ cls: "reader-declines", id: named });
        return;
      }
      const units = Array.isArray(d.units) ? d.units.filter((u): u is string => typeof u === "string") : [];
      const note = text(d.declined).trim();
      if (units.length === 0) problems.push({ cls: "not-a-decision", id: label });
      if (!note) problems.push({ cls: "decline-note", id: named });
      if (units.length === 0 || units.some((u) => !locs.at.has(u))) removed.push(i);
      for (const unit of units) {
        if (!locs.units.has(unit)) {
          problems.push({ cls: locs.at.has(unit) ? "decline-not-unit" : "unknown-id", id: unit });
          continue;
        }
        declinedUnits.set(unit, (declinedUnits.get(unit) ?? 0) + 1);
        declined.push({ kind: unit, note });
      }
      return;
    }
    const id = text(d.unit);
    const loc = id ? locs.at.get(id) : undefined;
    if (!id) {
      problems.push({ cls: "not-a-decision", id: label });
      removed.push(i);
      return;
    }
    if (!loc) {
      problems.push({ cls: "unknown-id", id });
      removed.push(i);
      return;
    }
    if (/\/m\d+$/.test(id)) {
      problems.push({ cls: "member-as-unit", id });
      removed.push(i);
      return;
    }
    const unit = loc.unit;
    if (args.who === "reader" && !handed.has(unit)) {
      problems.push({ cls: "not-handed", id });
      removed.push(i);
      return;
    }
    decidedIds.set(id, (decidedIds.get(id) ?? 0) + 1);
    if (decidedIds.get(id) === 2) problems.push({ cls: "twice", id });
    const kind = locs.units.get(unit)!;
    const holds = (file: string) => kind.members.some((m) => m.file === file);
    let file = loc.location.file;
    let lines = String(loc.location.start_line);
    if (d.at !== undefined) {
      // The refuter's reading is a record, not a duty, and no check reads its partition (verdict-verify.ts skips every
      // job but the adjudicator's before recordCoverageGaps): its `at` may name any line of any file the census holds,
      // and the row is recorded there (the parent's ruling on M5, 2026-09-30). A verdict seat's names its unit's file.
      const at = parseAt(text(d.at), refuter);
      if (!at || !(refuter ? censusHolds(at.file) : holds(at.file))) problems.push({ cls: refuter ? "at-outside" : "at-form", id });
      else ({ file, lines } = at);
    }
    const quote = text(d.quote);
    if (!quote.trim()) problems.push({ cls: "quote-empty", id });
    const disposition = text(d.disposition);
    // The refuter's reading is a record: a row it opened without a disposition is admitted, as its read rows were before.
    const optional = args.who === "refuter" && d.disposition === undefined;
    if (!optional && !SEAT_DISPOSITIONS.includes(disposition)) problems.push({ cls: "disposition", id });
    const ground = text(d.ground);
    const rest = text(d.rest);
    if (d.rest !== undefined) {
      if (!READING_COVER_GROUNDS.includes(rest as ReadingCoverGround)) problems.push({ cls: "rest-not-six", id });
      // Where a member sits settles it only for an opted-in rule.
      else if (rest === "generated_or_fixture_path" && dutyAboutOf(args.candidate) !== SHIPS_MAY_DECIDE) problems.push({ cls: "rest-place", id });
      restsOf.set(unit, (restsOf.get(unit) ?? new Set<string>()).add(rest));
    }
    opened(
      unit,
      {
        kind: unit,
        ...(loc.sub_shape !== undefined ? { sub_shape: loc.sub_shape } : {}),
        file,
        lines,
        quote,
        ...(optional ? {} : { disposition: disposition as ReadingDisposition }),
        ...(ground ? { ground } : {}),
        ...(READING_COVER_GROUNDS.includes(rest as ReadingCoverGround) ? { cover_ground: rest as ReadingCoverGround } : {}),
      } as ReadingReadRow,
      id,
    );
    const also = d.also === undefined ? [] : Array.isArray(d.also) ? d.also : null;
    if (also === null) problems.push({ cls: "also-form", id });
    (also ?? []).forEach((value2, j) => {
      const a = asRecord(value2);
      const alsoLabel = a && typeof a.member === "string" ? a.member : a && typeof a.at === "string" ? `${id} also ${a.at}` : `${id} also ${j + 1}`;
      if (!a || ("member" in a) === ("at" in a)) {
        problems.push({ cls: "also-form", id: alsoLabel });
        return;
      }
      let member: FindingLocation | undefined;
      let memberLines: string | undefined;
      if (typeof a.member === "string") {
        const m = locs.at.get(a.member);
        if (m && /\/m\d+$/.test(a.member) && m.unit === unit) member = m.location;
      } else {
        const at = parseAt(text(a.at), refuter);
        if (at) member = kind.members.find((m) => m.file === at.file && m.start_line === at.first);
        // The refuter's `also` by `at`, as its decision's `at`: any line of a file the census holds, recorded as written.
        if (at && !member && refuter && censusHolds(at.file)) {
          member = { file: at.file, start_line: at.first } as FindingLocation;
          memberLines = at.lines;
        }
      }
      if (!member) {
        const cls = refuter && typeof a.at === "string" ? "at-outside" : locs.at.has(text(a.member)) || typeof a.at === "string" ? "also-not-member" : "unknown-id";
        problems.push({ cls, id: alsoLabel });
        return;
      }
      const alsoQuote = text(a.quote);
      if (!alsoQuote.trim()) problems.push({ cls: "quote-empty", id: alsoLabel });
      const alsoDisposition = a.disposition === undefined ? disposition : text(a.disposition);
      const alsoOptional = a.disposition === undefined && optional;
      if (a.disposition !== undefined && !SEAT_DISPOSITIONS.includes(alsoDisposition)) problems.push({ cls: "disposition", id: alsoLabel });
      const alsoGround = a.ground === undefined ? ground : text(a.ground);
      opened(
        unit,
        {
          kind: unit,
          file: member.file,
          lines: memberLines ?? String(member.start_line),
          quote: alsoQuote,
          ...(alsoOptional ? {} : { disposition: alsoDisposition as ReadingDisposition }),
          ...(alsoGround ? { ground: alsoGround } : {}),
        } as ReadingReadRow,
        alsoLabel,
      );
    });
    /* MEMBERS THE SEAT OPENED THE UNIT FOR AND DID NOT READ: the
     * representative read, these members not read, said in the seat's own sentence. Checked after every decision is
     * seen (a member named here that an `also` opened is refused), and recorded as a declined row of member form, which
     * the assembler turns into a `not_read: seat_declined` row beside the unit's read rows. A reader declines nothing. */
    if (d.decline !== undefined) {
      const dec = asRecord(d.decline);
      const which = dec?.members;
      const form = which === "rest" || (Array.isArray(which) && which.length > 0 && which.every((m) => typeof m === "string" && m.length > 0));
      if (args.who === "reader") problems.push({ cls: "reader-declines", id });
      else if (!dec || !form || Object.keys(dec).some((k) => k !== "members" && k !== "note")) problems.push({ cls: "decline-form", id });
      else {
        const note = text(dec.note).trim();
        if (!note) problems.push({ cls: "decline-note", id });
        const prior = memberDeclines.get(unit);
        if (prior) prior.by.push(id);
        else {
          const members = which === "rest" ? ("rest" as const) : [...(which as string[])];
          memberDeclines.set(unit, { members, by: [id] });
          declined.push({ kind: unit, note, members });
        }
      }
    }
  });

  for (const [unit, n] of declinedUnits) {
    if (n > 1) problems.push({ cls: "twice", id: unit });
    if (openedUnits.has(unit)) problems.push({ cls: "declined-and-opened", id: unit });
  }
  for (const unit of args.handed) {
    if (!openedUnits.has(unit) && !declinedUnits.has(unit)) problems.push({ cls: "no-decision", id: unit });
  }
  /* The member declines, checked for every seat that may write one (a reader's is refused where it is written): each id
   * a member of the decision's own unit and not a location a row opened, one `decline` per unit, and "rest" never beside
   * a `rest` ground on the same unit. `declinedMembersOf` is the one count the assembler and the refuter's block use. */
  const resolvedDeclines = new Map<string, ReturnType<typeof declinedMembersOf>>();
  for (const [unit, decline] of memberDeclines) {
    const resolved = declinedMembersOf(locs.units.get(unit)!, decline.members, claimed.filter((r) => r.kind === unit));
    resolvedDeclines.set(unit, resolved);
    if (decline.by.length > 1) problems.push({ cls: "decline-twice", id: unit });
    for (const m of resolved.notMembers) problems.push({ cls: "decline-not-member", id: m });
    for (const m of resolved.opened) problems.push({ cls: "member-declined-and-opened", id: m });
    if (decline.members === "rest" && (restsOf.get(unit)?.size ?? 0) > 0) problems.push({ cls: "rest-and-decline", id: unit });
  }
  for (const unit of openedUnits) {
    if (declinedUnits.has(unit)) continue;
    // The refuter owes no `rest`: its reading is a record, and a unit it opened keeps its other members as covered rows
    // with the ground it named, or none (`refutationReadingOf`), as its `covered` rows did before.
    if (args.who === "refuter") {
      if ((restsOf.get(unit)?.size ?? 0) > 1) problems.push({ cls: "rest-conflict", id: unit });
      continue;
    }
    // A unit a reader holds is settled by that reader's rows; the verdict seat's own look at it is a second look (M4).
    if (args.who === "seat" && readerHeld.has(unit) && !handed.has(unit)) continue;
    const kind = locs.units.get(unit)!;
    const rests = restsOf.get(unit)?.size ?? 0;
    const decline = memberDeclines.get(unit);
    const resolved = resolvedDeclines.get(unit);
    const left = kind.member_count - (rowsOf.get(unit) ?? 0) - (resolved?.count ?? 0);
    if (left > 0 && rests === 0) {
      const declinedIds = new Set(Array.isArray(decline?.members) ? decline.members : []);
      problems.push({ cls: "rest-missing", id: unit, owed: owedMemberIds(kind, locationsOf.get(unit) ?? new Set(), declinedIds) });
    }
    if (rests > 1) problems.push({ cls: "rest-conflict", id: unit });
  }
  return { read, declined, problems, rowById, unopened, ...(removed.length > 0 ? { removed } : {}) };
}

/**
 * EVIDENCE THAT RESTATES THE TRAIL, NAMED BY ID. A `premise`
 * entry names the id of a location the seat opened (`{role: "premise", unit: "14"}`); a census `item` entry names the
 * census item and the opened location that carries it (`{role: "item", item: "I4", unit: "12"}`). The program writes
 * the entry's `file` and `lines` from the skeleton and its `quote` from the seat's own decision at that id, and an
 * item's `name` from the census token: the seat typed the quotation once, in its decision, and the program copies no line
 * from any file. An entry with neither `unit` nor `item` is today's entry and passes through as written (elements, sites,
 * items found by reading, and a premise or item the seat chose to quote at its location). The ids a decision opened are
 * `rowById`'s: a decision's `unit` (a unit or a sub-shape) and each `also` member id.
 *
 * Refused, naming the entry or the id: an id on a role other than premise or item (evidence-id-role); an id-form entry
 * that also carries `file`, `lines` or `quote` (evidence-both); no `unit` (evidence-no-unit); an id the census does not
 * hold (unknown-id) or one this seat did not open (evidence-not-opened); a premise whose decision is not
 * `is_the_construct` or `construct_but_gated` (premise-not-affirmative); an item id on a rule whose items are not the
 * matched word (item-not-census), outside the census (unknown-item), not carried by the named unit (item-not-in-unit), or
 * with a `name` other than its token (item-name). The assembled entry is then checked by step 5a's rules as any other.
 */
export function evidenceOfIds(args: {
  candidate: Candidate;
  rowById: ReadonlyMap<string, ReadingReadRow>;
  evidence: unknown;
}): { evidence: unknown; problems: DecisionProblem[] } {
  if (!Array.isArray(args.evidence)) return { evidence: args.evidence, problems: [] };
  const locs = skeletonLocations(args.candidate);
  const tokenItems = readingClassOf(args.candidate)?.item_source === "token";
  const problems: DecisionProblem[] = [];
  const text = (v: unknown): string => (typeof v === "string" ? v : "");
  const evidence = args.evidence.map((value, i) => {
    const e = asRecord(value);
    if (!e || !("unit" in e || "item" in e)) return value;
    const label = `evidence ${i + 1}`;
    const role = text(e.role);
    if (role !== "premise" && role !== "item") {
      problems.push({ cls: "evidence-id-role", id: label });
      return value;
    }
    if ("file" in e || "lines" in e || "quote" in e) problems.push({ cls: "evidence-both", id: label });
    const unit = text(e.unit);
    if (!unit) {
      problems.push({ cls: "evidence-no-unit", id: label });
      return value;
    }
    const row = args.rowById.get(unit);
    if (!row || !locs) {
      problems.push({ cls: locs?.at.has(unit) ? "evidence-not-opened" : "unknown-id", id: unit });
      return value;
    }
    const out: Record<string, unknown> = { file: row.file, lines: row.lines, quote: row.quote, role };
    if (role === "premise") {
      if ("item" in e || "name" in e) problems.push({ cls: "evidence-id-role", id: label });
      if (row.disposition !== "is_the_construct" && row.disposition !== "construct_but_gated") problems.push({ cls: "premise-not-affirmative", id: unit });
    } else {
      let itemId = text(e.item);
      /* An item named by its location alone, where the census holds exactly one item
       * there. The program holds the items of such a rule, so it names the one it holds at that location; the seat text
       * offers this form for an item at a kept place (`{role: "item", unit: "P17"}`), which was refused for its id. */
      if (itemId === "" && tokenItems && locs.at.has(unit)) {
        const here = [...locs.items.entries()].filter(([, it]) => it.units.includes(locs.at.get(unit)!.unit)).map(([id]) => id);
        if (here.length === 1) itemId = here[0];
      }
      const item = locs.items.get(itemId);
      if (!tokenItems) {
        problems.push({ cls: "item-not-census", id: label });
        return value;
      }
      if (!item) {
        problems.push({ cls: "unknown-item", id: itemId || label });
        return value;
      }
      if (!item.units.includes(locs.at.get(unit)!.unit)) problems.push({ cls: "item-not-in-unit", id: `${itemId} at ${unit}` });
      if (e.name !== undefined && text(e.name).toLowerCase() !== item.token.toLowerCase()) problems.push({ cls: "item-name", id: itemId });
      out.name = item.token;
    }
    if (typeof e.search === "string") out.search = e.search;
    return out;
  });
  return { evidence, problems };
}

/** The note the program writes on a census unit the refuter did not name (design section 2.5 as amended, 2026-09-30). */
export const REFUTER_UNNAMED_NOTE = "not named by the refuter: its reading is a record, not a duty";

/** The note on every `not_read: not_opened` row, written by the program (the seat wrote no sentence for it). */
export const NOT_OPENED_NOTE =
  "answered as opened, but the review's own transcript shows no Read of the code around it (at most the one line, as a search result shows it)";

/**
 * THE MEMBERS A UNIT'S UNOPENED ROWS LEAVE UNREAD, "file:line" each, once: the member each row stands for,
 * less any member a read row of the unit stands at and any the seat declined. One function for the assembler and the
 * refuter's block, so the two never count them differently.
 */
export function notOpenedLocationsOf(
  kind: ReadingKind,
  readRows: readonly { file: string; lines: string; sub_shape?: string }[],
  unopened: readonly ReadingUnopenedRow[],
  declinedLocations: readonly string[],
): string[] {
  const taken = new Set([...readRows.map((r) => memberAtRow(kind, r)), ...declinedLocations]);
  const out: string[] = [];
  for (const u of unopened) {
    if (taken.has(u.member)) continue;
    taken.add(u.member);
    out.push(u.member);
  }
  return out;
}

/**
 * THE REFUTER'S READING BLOCK, WRITTEN BY THE PROGRAM FROM ITS DECISIONS.
 *  `read` as its decisions give it, at the skeleton's lines; `covered`, the members left in each
 * unit it opened, settled by the row naming its `rest` (else the first) with that ground where named, as its `covered`
 * rows were before; `not_read`, every other unit of the census, `seat_declined` with the refuter's own note where it
 * declined the unit and with `REFUTER_UNNAMED_NOTE` where it named nothing. So the block keeps the partition it had
 * (read, covered, not read), and the refuter writes no member count. No check reads that partition for coverage today:
 * verdict-verify.ts runs `recordCoverageGaps` over adjudicator jobs only (the `job.seat !== "adjudicator"` skip before
 * it); what is read of the block is its `read` rows' quotations (verdict-verify.ts, the reading-row jobs) and the whole
 * object the report copies (assemble-report.ts `refutation`), and both keep their inputs.
 */
export function refutationReadingOf(candidate: Candidate, out: DecisionsReading, searched: unknown): Record<string, unknown> {
  const census = readingUnitsCensusOf(candidate);
  const covered: Record<string, unknown>[] = [];
  const notRead: Record<string, unknown>[] = [];
  const declinedNote = new Map(out.declined.filter((d) => d.members === undefined).map((d) => [d.kind, d.note]));
  const memberDecline = new Map(out.declined.filter((d) => d.members !== undefined).map((d) => [d.kind, d]));
  for (const kind of census?.kinds ?? []) {
    const rows = out.read.filter((r) => r.kind === kind.id);
    // What the refuter answered as opened and did not open is recorded as not read, as the verdict seat's is.
    const unopened = out.unopened.filter((u) => u.kind === kind.id);
    if (rows.length > 0) {
      // Members the refuter declined in a unit it opened are recorded as not read, as the verdict seat's are.
      const decline = memberDecline.get(kind.id);
      const unread = decline?.members !== undefined ? declinedMembersOf(kind, decline.members, [...rows, ...unopened]) : null;
      if (unread && unread.count > 0) {
        notRead.push({ kind: kind.id, members: unread.count, reason: "seat_declined", note: decline!.note || REFUTER_UNNAMED_NOTE, locations: unread.locations });
      }
      const notOpened = notOpenedLocationsOf(kind, rows, unopened, unread?.locations ?? []);
      if (notOpened.length > 0) notRead.push({ kind: kind.id, members: notOpened.length, reason: "not_opened", note: NOT_OPENED_NOTE, locations: notOpened });
      const left = kind.member_count - rows.length - (unread?.count ?? 0) - notOpened.length;
      if (left > 0) {
        const first = rows.find((r) => r.cover_ground !== undefined) ?? rows[0]!;
        covered.push({
          kind: kind.id,
          members: left,
          by: `${first.file}:${first.lines}`,
          ...(first.disposition ? { disposition: first.disposition } : {}),
          ...(first.cover_ground ? { ground: first.cover_ground } : {}),
        });
      }
      continue;
    }
    if (unopened.length > 0) {
      notRead.push({ kind: kind.id, members: kind.member_count, reason: "not_opened", note: NOT_OPENED_NOTE });
      continue;
    }
    notRead.push({ kind: kind.id, members: kind.member_count, reason: "seat_declined", note: declinedNote.get(kind.id) || REFUTER_UNNAMED_NOTE });
  }
  return {
    read: out.read,
    ...(Array.isArray(searched) && searched.length > 0 ? { searched } : {}),
    ...(covered.length > 0 ? { covered } : {}),
    ...(notRead.length > 0 ? { not_read: notRead } : {}),
  };
}

/* --------------------------------------------------------------------------------------------- *
 * The bounded inputs a verdict seat is handed (design section 3.7).
 * --------------------------------------------------------------------------------------------- */

/** The largest kinds a catalogue summary names one by one. The rest are counted, never dropped. */
export const READING_CATALOGUE_TOP_KINDS = 100;

/** The matched tokens a catalogue summary names one by one. The rest are counted, never dropped. */
export const READING_CATALOGUE_TOP_TOKENS = 200;

/** The rows a fold carries in full, per direction. The rest are counted, never dropped. */
export const READING_FOLD_MAX_ROWS = 200;

/** The bounded census a verdict seat is handed: counts, then the largest kinds, then the remainder. */
export interface ReadingCatalogueSummary {
  spec: string;
  level: string;
  kinds_total: number;
  locations_total: number;
  hash: string;
  by_context_class: { context_class: string; kinds: number; members: number }[];
  by_matched_token: { matched_token: string; kinds: number; members: number }[];
  other_matched_tokens?: { tokens: number; kinds: number; members: number };
  largest_kinds: {
    kind: string;
    matched_token?: string;
    context_class?: string;
    members: number;
    sub_shapes: number;
    files: number;
    directories: string[];
    representative: string;
  }[];
  kinds_not_listed?: { kinds: number; members: number };
}

const directoryOfPath = (file: string): string => {
  const cut = file.lastIndexOf("/");
  return cut < 0 ? "." : file.slice(0, cut);
};

/**
 * The census as a seat is handed it: every count, the largest kinds named, and the rest summed.
 *
 * **Bounded by construction and never truncated silently.** Whatever the candidate holds, the seat
 * receives a few hundred rows; the kinds that did not fit are counted in `kinds_not_listed` and the
 * tokens that did not fit in `other_matched_tokens`, so a reader can always see how much of the
 * catalogue is behind the summary. The full census is in `findings.json` under `kinds[]`, and the
 * hash ties the two.
 */
export function catalogueSummary(census: ReadingCensus): ReadingCatalogueSummary {
  const byClass = new Map<string, { kinds: number; members: number }>();
  const byToken = new Map<string, { kinds: number; members: number }>();
  for (const kind of census.kinds) {
    const cls = kind.context_class ?? "(unrecorded)";
    const c = byClass.get(cls) ?? { kinds: 0, members: 0 };
    c.kinds += 1;
    c.members += kind.member_count;
    byClass.set(cls, c);
    const tok = kind.matched_token ?? "(unrecorded)";
    const t = byToken.get(tok) ?? { kinds: 0, members: 0 };
    t.kinds += 1;
    t.members += kind.member_count;
    byToken.set(tok, t);
  }
  // Descending by members, then by name, so the order is total and two runs write the same summary.
  const rank = <T extends { members: number }>(rows: [string, T][]) =>
    rows.sort((a, b) => b[1].members - a[1].members || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const tokens = rank([...byToken.entries()]);
  const namedTokens = tokens.slice(0, READING_CATALOGUE_TOP_TOKENS);
  const restTokens = tokens.slice(READING_CATALOGUE_TOP_TOKENS);

  const largest = [...census.kinds].sort(
    (a, b) => b.member_count - a.member_count || (a.id.padStart(9, "0") < b.id.padStart(9, "0") ? -1 : 1),
  );
  const named = largest.slice(0, READING_CATALOGUE_TOP_KINDS);
  const rest = largest.slice(READING_CATALOGUE_TOP_KINDS);

  return {
    spec: census.spec,
    level: census.level,
    kinds_total: census.kinds.length,
    locations_total: census.locations_total,
    hash: censusHash(census),
    by_context_class: rank([...byClass.entries()]).map(([context_class, v]) => ({ context_class, ...v })),
    by_matched_token: namedTokens.map(([matched_token, v]) => ({ matched_token, ...v })),
    ...(restTokens.length > 0
      ? {
          other_matched_tokens: {
            tokens: restTokens.length,
            kinds: restTokens.reduce((n, [, v]) => n + v.kinds, 0),
            members: restTokens.reduce((n, [, v]) => n + v.members, 0),
          },
        }
      : {}),
    largest_kinds: named.map((kind) => ({
      kind: kind.id,
      ...(kind.matched_token ? { matched_token: kind.matched_token } : {}),
      ...(kind.context_class ? { context_class: kind.context_class } : {}),
      members: kind.member_count,
      sub_shapes: kind.sub_shape_count,
      files: new Set(kind.members.map((m) => m.file)).size,
      directories: [...new Set(kind.members.map((m) => directoryOfPath(m.file)))].sort().slice(0, 8),
      representative: `${kind.representative.file}:${kind.representative.start_line}`,
    })),
    ...(rest.length > 0
      ? { kinds_not_listed: { kinds: rest.length, members: rest.reduce((n, k) => n + k.member_count, 0) } }
      : {}),
  };
}

/** The readers' dispositions, folded so the verdict seat holds a few hundred rows at most. */
export interface DispositionFold {
  rows_total: number;
  kinds_disposed: number;
  found: ReadingReadRow[];
  found_omitted: number;
  undetermined: ReadingReadRow[];
  undetermined_omitted: number;
  dismissed: { ground: string; kinds: number; members: number; example: ReadingReadRow }[];
  dismissed_kinds: number;
  dismissed_members: number;
}

/**
 * Fold the readers' rows into the bounded form the verdict seat is handed (design section 3.7).
 *
 * Every `is_the_construct` and `construct_but_gated` row travels with its quote, up to
 * `READING_FOLD_MAX_ROWS` ordered by members; every `undetermined` row likewise, because the seat
 * may not turn an undetermined into a dismissal and cannot honour that with a count; the
 * `not_the_construct` rows become counts per ground with the quote of the largest kind on each.
 * **Nothing is dropped without being counted**: `found_omitted`, `undetermined_omitted` and the
 * per-ground counts add back up to `rows_total`.
 */
export function foldDispositions(rows: ReadingReadRow[], census: ReadingCensus | null): DispositionFold {
  const members = new Map<string, number>();
  for (const kind of census?.kinds ?? []) members.set(kind.id, kind.member_count);
  const size = (row: ReadingReadRow) => members.get(row.kind) ?? 1;
  const bySize = (a: ReadingReadRow, b: ReadingReadRow) =>
    size(b) - size(a) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0);

  const found = rows
    .filter((r) => r.disposition === "is_the_construct" || r.disposition === "construct_but_gated")
    .sort(bySize);
  // A row with no disposition word ("" since fix-verify-shape R2) is listed where it was before.
  const undetermined = rows.filter((r) => r.disposition === "undetermined" || (r.disposition as string) === "").sort(bySize);
  const dismissedRows = rows.filter((r) => r.disposition === "not_the_construct").sort(bySize);

  const grounds = new Map<string, { kinds: number; members: number; example: ReadingReadRow }>();
  for (const row of dismissedRows) {
    const ground = row.ground?.trim() || "(no ground given)";
    const g = grounds.get(ground);
    if (g) {
      g.kinds += 1;
      g.members += size(row);
    } else {
      grounds.set(ground, { kinds: 1, members: size(row), example: row });
    }
  }

  return {
    rows_total: rows.length,
    kinds_disposed: new Set(rows.map((r) => r.kind)).size,
    found: found.slice(0, READING_FOLD_MAX_ROWS),
    found_omitted: Math.max(0, found.length - READING_FOLD_MAX_ROWS),
    undetermined: undetermined.slice(0, READING_FOLD_MAX_ROWS),
    undetermined_omitted: Math.max(0, undetermined.length - READING_FOLD_MAX_ROWS),
    dismissed: [...grounds.entries()]
      .sort((a, b) => b[1].members - a[1].members || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([ground, v]) => ({ ground, ...v })),
    dismissed_kinds: dismissedRows.length,
    dismissed_members: dismissedRows.reduce((n, r) => n + size(r), 0),
  };
}

/* --------------------------------------------------------------------------------------------- *
 * Assembly — the `reading` block, written by this CLI and never by a model.
 * --------------------------------------------------------------------------------------------- */

/**
 * WHICH CENSUS UNITS A SEAT'S `kind` STRING NAMES — the one place a written kind is resolved (M5).
 *
 * The trail matched `kind` as an exact string, and two seats of U4 wrote something else. The
 * `recipients-001` seat on one tree labelled its eleven rows `"0 (/square+square, declaration)"`,
 * `"1 (/square+square, import-specifier)"` and so on, where every other seat wrote the bare key;
 * nothing matched, the assembled record showed `read: 0` for a seat that had disposed all eleven
 * units, and the gate reported thirteen gaps. The same tree's `eu-dsr-001` refuter produced the same
 * class from the other side, naming many units at once in one comma-joined string
 * (`"47,37,38,39,40,48,56,57,67,68,69,70,71,72,73,74,6"`), which matches no key at all.
 *
 * Two shapes are recoverable and are recovered, with the seat's own spelling kept beside the key:
 * a key followed by a space or an opening parenthesis (a decoration), and a comma-joined list whose
 * every part is a key (one row meant for several units). **Anything else is refused at assembly and
 * the row is printed** — never dropped, because a silently dropped row is exactly the lost trail
 * this function exists to stop.
 */
export function resolveKind(written: string, census: ReadonlySet<string>): string[] {
  const raw = written.trim();
  if (census.has(raw)) return [raw];
  const decorated = /^([^\s(,]+)[\s(]/.exec(raw);
  if (decorated && census.has(decorated[1]!)) return [decorated[1]!];
  if (raw.includes(",")) {
    const parts = raw
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (parts.length > 1 && parts.every((part) => census.has(part))) return [...new Set(parts)];
  }
  return [];
}

/**
 * One row the assembler refuses rather than drops, with where it came from: a row it could not attach to any census
 * unit (M5), or a second row for a unit and sub-shape a row already disposed.
 */
export interface ReadingRowRefused {
  where: string;
  kind: string;
  problem: string;
  /** For a reader's row, the reply file it came from, where the caller named it (`assembleReadingForVerdicts`). */
  source?: string;
}

/**
 * The partition rule for two `read` rows of one unit and sub-shape, in its one wording: `checkReadingCoverage` applies
 * it to a record, and `assembleReading` refuses the second such row in the same words,
 * so the capture, which runs the assembler over a seat's answer, refuses it in them while the seat can
 * answer again.
 */
export function twoReadRowsProblem(kind: string): string {
  return `the kind ${JSON.stringify(kind)} has two \`read\` rows for the same location, so the count of what was opened is not a count.`;
}

/** What `assembleReading` was given: the census, the replies, and which planned readers returned. */
export interface AssembleReadingInput {
  candidate: Candidate;
  /** Every disposition row every reader returned, in reader order. */
  readerRows: ReadingReadRow[];
  /** The reply file each of `readerRows` came from, in the same order, where the caller knows it: a refused row names it. */
  readerSources?: string[];
  /** Which of the caller's replies each of `readerRows` came from, in the same order (two files can share a name: the
   * `--readers` directory and the older `<verdicts>/readers/` both name theirs `readers/...`). */
  readerReplyIndex?: number[];
  /** The verdict seat's own rows — the kinds it opened itself. */
  seatRows: ReadingReadRow[];
  /** The seat's recorded project-wide searches, carried through verbatim. */
  searched?: ReadingSearchRow[];
  /** The seat's own `declined[]`: units it was handed and chose not to open, with its sentence. */
  declined?: ReadingDeclinedRow[];
  /** The rows the readers and the seat answered as opened and did not open, as the capture recorded them. */
  unopened?: ReadingUnopenedRow[];
  /** Indices (0-based) of the planned readers whose reply this run holds. */
  readersReturned?: number[];
}

/**
 * THE UNITS THE PLAN ITSELF LEAVES UNREAD, and the reason it gives for each — the one statement
 * about "not read" that does not come from a model.
 *
 * Two sources, and no third: the plan's own `not_read` range, with the reason U1 wrote on it, and
 * the whole slice of any reader that did not return, which is `budget` (design section 3.6). A unit
 * the plan handed to the verdict seat itself is in neither, and that is the point — `rule_instruction`
 * is THE RULE'S instruction and `budget` is A READER THAT DID NOT RETURN, and a seat may assert
 * neither about a unit it was told to open.
 *
 * `readersReturned` says which readers' replies are in hand. `"all"` is the assembler's case, where
 * the run knows exactly that. `"unknown"` is the coverage check's: it holds a finished verdict and
 * no run state, so it cannot know which readers returned, and it therefore admits `budget` over
 * every reader's slice and binds only the seat's own units. **The two callers share this function
 * rather than each computing the set**, because a checker computing its own copy of what the
 * assembler wrote is the second copy that drifts.
 */
export function plannedNotRead(
  plan: ReadingPlan | null,
  readersReturned: number[] | "all" | "unknown",
): Map<string, ReadingNotReadReason> {
  const planned = new Map<string, ReadingNotReadReason>();
  for (const row of plan?.unread ?? []) planned.set(row.key, row.reason);
  if (!plan || plan.reader_slices.length === 0) return planned;
  const returned =
    readersReturned === "unknown"
      ? new Set<number>()
      : new Set(readersReturned === "all" ? plan.reader_slices.map((_, i) => i) : readersReturned);
  // Build unit F3 (full-read design 1.7): under the place plan a place seat that did not answer has had its make-up seat
  // (or never returned, which no hook saw), and its places are `not_answered`; `budget` stays the reason of plan-1.
  const reason: ReadingNotReadReason = plan.places ? "not_answered" : "budget";
  plan.reader_slices.forEach((slice, i) => {
    if (returned.has(i)) return;
    for (const id of slice) if (!planned.has(id)) planned.set(id, reason);
  });
  return planned;
}

/** What came back: the block, and every kind the replies and the plan together do not account for. */
export interface AssembleReadingResult {
  reading: VerdictReading;
  /** Kinds in neither `read` nor `not_read` — an incomplete run, reported and never papered over. */
  unaccounted: { kind: string; members: number; because: string }[];
  /** Rows whose `kind` names no census unit even after M5's two recoveries. The run is refused. */
  refused: ReadingRowRefused[];
  /** `declined[]` entries for a unit the reading plan already leaves unread, which is the only case
   * the loop below pushes. Where the seat declines a unit it also
   * opened, the opened branch settles the unit first and the entry is dropped without a row here. */
  declined_unused: { kind: string; because: string }[];
}

/**
 * Build the `reading` block from the census and what the seats returned (design sections 3.6, 3.7).
 *
 * **The seat never writes the line list.** It returns which representatives it opened and quoted;
 * this function folds every member of every kind into one of three dispositions — read, covered by a
 * read representative, or not read with a reason — so that the trail covers 100 % of the candidate's
 * locations whatever the seat wrote.
 *
 * **A reason is never invented.** A kind the plan handed to a reader that did not return is
 * `not_read: budget`, which is what the plan says about it. A kind the plan handed to a reader that
 * DID return and which came back with no row is in neither list: it is reported in `unaccounted`, the
 * coverage check refuses the verdict, and the run is repeated or resumed. Writing a reason there
 * would be this CLI asserting something no seat said.
 */
export function assembleReading(input: AssembleReadingInput): AssembleReadingResult {
  const real = kindCensusOf(input.candidate);
  const units = readingUnitsCensusOf(input.candidate);
  const plan = readingPlanOf(input.candidate);
  if (!real || !units) {
    throw new Error(
      `assembleReading was handed ${input.candidate.rule_id} (${input.candidate.finding_id}), which carries no kind census. ` +
        `The reading block is the record of a candidate read BY READING UNITS; a candidate under the bound is read location ` +
        `by location with no census at all, so there is nothing here to assemble. Scan with --kind-census on, or leave this ` +
        `verdict without a reading block.`,
    );
  }

  const order = new Map<string, number>();
  units.kinds.forEach((kind, i) => order.set(kind.id, i));
  const byId = new Map(units.kinds.map((k) => [k.id, k]));

  // Reader rows first, then the seat's own: a seat that re-opened a unit a reader already disposed
  // is kept once, at the reader's row, because the reader is the seat that actually read it. Both
  // rows are kept where they name different sub-shapes.
  /* M5: a written `kind` is resolved to census units here and nowhere else, and a row that resolves
   * to none is REFUSED with its bytes rather than skipped. What `continue` did before was the defect
   * itself: eleven disposed units became `read: 0` and thirteen gaps, and nothing said so. */
  const censusKeys = new Set(byId.keys());
  const refused: ReadingRowRefused[] = [];
  const cannotResolve =
    "names no reading unit of this candidate, and it is neither a unit key followed by a decoration " +
    "nor a comma-joined list whose every part is one. The seat writes the key exactly as it was " +
    "handed, with nothing appended; this row is refused rather than dropped, because a dropped row " +
    "is a reading that happened and left no trail.";
  const expand = (row: ReadingReadRow, where: string, source?: string): ReadingReadRow[] => {
    const resolved = resolveKind(row.kind, censusKeys);
    if (resolved.length === 0) {
      refused.push({ where, kind: row.kind, problem: cannotResolve, ...(source === undefined ? {} : { source }) });
      return [];
    }
    if (resolved.length === 1 && resolved[0] === row.kind) return [row];
    return resolved.map((key) => ({ ...row, kind: key, kind_as_written: row.kind }));
  };

  const readerRows = input.readerRows.flatMap((row, i) => {
    const source = input.readerSources?.[i];
    const reply = input.readerReplyIndex?.[i];
    return expand(row, "a reader's reply", source).map((r) => ({ row: r, source, reply }));
  });
  const seatRows = input.seatRows.flatMap((row) => expand(row, "the verdict seat's reply"));

  /* A second row for a unit and sub-shape a row already disposed is REFUSED in
   * the partition rule's words (`twoReadRowsProblem`), never dropped. Before, `continue` dropped it here without a trace,
   * whatever its disposition, so the partition check could never see it and the capture, which runs this function over
   * a seat's answer (reading-assembly.ts `answerRulesAtCapture`), could not refuse it while the seat could answer again.
   * A row a seat re-opens after a reader (M4, below) is a second look and is kept, as before. */
  const secondRow = (row: ReadingReadRow, earlier: string | undefined, source: string | undefined): string =>
    `repeats a \`read\` row for the same location (${row.file}:${firstLineOf(row.lines)}${row.sub_shape ? `, sub-shape ${JSON.stringify(row.sub_shape)}` : ""})` +
    `${earlier !== undefined && earlier !== source ? ` that ${earlier} already holds` : ""}: ${twoReadRowsProblem(row.kind)} ` +
    "A seat writes one row per location it opened; this row is refused rather than dropped, because a dropped row is a reading " +
    "that happened and left no trail.";

  /* M4: a seat that re-opens a unit a reader already disposed KEEPS ITS ROW and is marked, and the
   * arithmetic below counts the location once, at the reader's row. umami `eu-dsr-002` is the
   * measured case: the two readers disposed all 104 locations, the seat then opened `L0` and `L1`
   * itself, and the record "accounts for 106 of this candidate's 104 matched location(s)" — P4
   * failing on arithmetic while nothing at all went unread. Dropping the seat's row would lose a
   * reading that happened; counting it twice invents a location. Marking it does neither. */
  const read: ReadingReadRow[] = [];
  const seen = new Set<string>();
  const firstFrom = new Map<string, { row: ReadingReadRow; source: string | undefined; reply: number | undefined }>();
  const sameRow = (a: ReadingReadRow, b: ReadingReadRow): boolean => {
    const key = (r: ReadingReadRow) => JSON.stringify(Object.entries(r).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
    return key(a) === key(b);
  };
  const readerSubShapes = new Set<string>();
  const readerSites = new Set<string>();
  for (const { row, source, reply } of readerRows) {
    const id = readRowLocationKey(row);
    if (seen.has(id)) {
      const first = firstFrom.get(id);
      /* The same reading read twice, which is not a second reading: a row identical in every field to the one kept,
       * from another reply - one reply reached through two directories (`--readers` and the older
       * `<verdicts>/readers/`, which test:reading-coverage plants), or a byte-identical copy of it. Nothing that
       * happened is lost by counting it once, as before. A row that differs, or a repeat within one reply, is refused. */
      if (first && reply !== undefined && first.reply !== undefined && reply !== first.reply && sameRow(first.row, row)) continue;
      refused.push({ where: "a reader's reply", kind: row.kind, problem: secondRow(row, first?.source, source), ...(source === undefined ? {} : { source }) });
      continue;
    }
    seen.add(id);
    firstFrom.set(id, { row, source, reply });
    readerSubShapes.add(`${row.kind}\u0000${row.sub_shape ?? ""}`);
    readerSites.add(`${row.kind}\u0000${row.file}:${row.lines}`);
    read.push(row);
  }
  for (const row of seatRows) {
    const id = readRowLocationKey(row);
    if (readerSubShapes.has(`${row.kind}\u0000${row.sub_shape ?? ""}`) || readerSites.has(`${row.kind}\u0000${row.file}:${row.lines}`)) {
      read.push({ ...row, also_read_by_reader: true });
      continue;
    }
    if (seen.has(id)) {
      refused.push({ where: "the verdict seat's reply", kind: row.kind, problem: secondRow(row, undefined, undefined) });
      continue;
    }
    seen.add(id);
    read.push(row);
  }
  // Reading-plan order, then sub-shape by code unit — a total order with no tie left to the runtime,
  // for the reason `byPathThenLine` gives about `localeCompare`: this decides the bytes of a record
  // two machines must be able to compare.
  read.sort((a, b) => {
    const byKind = (order.get(a.kind) ?? 0) - (order.get(b.kind) ?? 0);
    if (byKind !== 0) return byKind;
    const sa = a.sub_shape ?? "";
    const sb = b.sub_shape ?? "";
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });

  // A row marked `also_read_by_reader` is a second look at a location that is already counted, so it
  // is not a second opened location (M4). It stays in `read[]`; it adds nothing to the arithmetic.
  const openedPerKind = new Map<string, number>();
  for (const row of read) {
    if (row.also_read_by_reader) continue;
    openedPerKind.set(row.kind, (openedPerKind.get(row.kind) ?? 0) + 1);
  }

  /* M6: the seat's own `declined[]`, resolved through the same M5 recovery, becomes the `not_read`
   * reason `seat_declined` below — with the seat's sentence carried into the row's note. */
  const declined: ReadingDeclinedRow[] = [];
  const declinedNote = new Map<string, string>();
  /** A unit's member decline (the seat opened the unit and did not read these members), by unit. */
  const memberDecline = new Map<string, ReadingDeclinedRow>();
  /* Build unit F3 (full-read design 6.1, "What is removed"): under the place plan no seat declines a place, no shape
   * ground settles one and the capture records no place as `not_opened` (C7 refuses the row instead). A record that
   * carries any of them for such a candidate was not written by the capture, and it is refused, never assembled. */
  if (plan?.places) {
    const placeRefusal = "this candidate is read by the place plan: every place is answered by its own row, checked at capture (C1-C9), and a decline, a shape ground or a place recorded as not opened is not a way to answer one";
    for (const row of input.declined ?? []) refused.push({ where: "the verdict seat's `declined[]`", kind: row.kind, problem: placeRefusal });
    for (const row of input.unopened ?? []) refused.push({ where: "the capture's `unopened` rows", kind: row.kind, problem: placeRefusal });
    for (const row of [...input.readerRows, ...input.seatRows]) if (row.cover_ground !== undefined) refused.push({ where: "a `read` row's `cover_ground`", kind: row.kind, problem: placeRefusal });
  }
  for (const row of plan?.places ? [] : (input.declined ?? [])) {
    const resolved = resolveKind(row.kind, censusKeys);
    if (resolved.length === 0) {
      refused.push({ where: "the verdict seat's `declined[]`", kind: row.kind, problem: cannotResolve });
      continue;
    }
    for (const key of resolved) {
      declined.push(key === row.kind ? row : { ...row, kind: key, kind_as_written: row.kind });
      if (row.members !== undefined) {
        if (!memberDecline.has(key)) memberDecline.set(key, row);
      } else if (!declinedNote.has(key)) declinedNote.set(key, row.note);
    }
  }
  const declinedUnused: { kind: string; because: string }[] = [];

  // Which units the plan expects nobody to have read, and why. `plannedNotRead` is the one place
  // that answers it, and the coverage check calls the same function.
  const planned = plannedNotRead(plan, input.readersReturned ?? "all");

  const covered: ReadingCoveredRow[] = [];
  const notRead: ReadingNotReadRow[] = [];
  const unaccounted: { kind: string; members: number; because: string }[] = [];

  const unopenedRows: ReadingUnopenedRow[] = [];
  for (const row of plan?.places ? [] : (input.unopened ?? [])) {
    if (byId.has(row.kind)) unopenedRows.push(row);
    else refused.push({ where: "the capture's `unopened` rows", kind: row.kind, problem: cannotResolve });
  }

  for (const kind of units.kinds) {
    const opened = openedPerKind.get(kind.id) ?? 0;
    const unopened = unopenedRows.filter((u) => u.kind === kind.id);
    if (opened > 0) {
      /* MEMBERS DECLINED IN A UNIT THAT WAS OPENED: a `not_read: seat_declined` row beside its read rows,
       * with the seat's sentence and where each unread member is; the members it accounts for are no one's cover. */
      const decline = memberDecline.get(kind.id);
      const readHere = read.filter((r) => r.kind === kind.id && !r.also_read_by_reader);
      const unread = decline?.members !== undefined
        ? declinedMembersOf(kind, decline.members, [...readHere, ...unopened])
        : null;
      if (unread && unread.count > 0) {
        notRead.push({
          kind: kind.id,
          members: unread.count,
          reason: "seat_declined",
          ...(decline!.note.trim() ? { note: decline!.note.trim() } : {}),
          locations: unread.locations,
        });
      }
      /* Members answered as opened that the seat did not open, beside its read rows, with where each is. */
      const notOpened = notOpenedLocationsOf(kind, readHere, unopened, unread?.locations ?? []);
      if (notOpened.length > 0) notRead.push({ kind: kind.id, members: notOpened.length, reason: "not_opened", note: NOT_OPENED_NOTE, locations: notOpened });
      const rest = kind.member_count - opened - (unread?.count ?? 0) - notOpened.length;
      if (rest > 0) {
        /* The row that carries the unit's `rest`: a unit decided through a sub-shape and opened at
         * members of its own (`also`) holds several rows, and its other members are settled by the decision that
         * names the ground, not by whichever row sorts first. With one row, or none carrying a ground, the first. */
        const first = read.find((r) => r.kind === kind.id && r.cover_ground !== undefined) ?? read.find((r) => r.kind === kind.id)!;
        /* THE GROUND IS THE SHAPE'S, NOT THE REPRESENTATIVE'S PROSE.
         *
         * What was copied here was `first.ground` — whatever settled the one row that was opened.
         * That is how "server-side only: this runs in the API layer" became the recorded ground of
         * 54,839 members nobody opened, which is the row section 3.5 forbids in terms: a ground that
         * depends on a call path or a gate is PER FILE. A named cover ground is carried; anything
         * else leaves the row with no ground, and the cover stands or falls on the kind's shape. */
        covered.push({
          kind: kind.id,
          members: rest,
          by: `${first.file}:${first.lines}`,
          disposition: first.disposition,
          ...(first.cover_ground && READING_COVER_GROUNDS.includes(first.cover_ground)
            ? { ground: first.cover_ground }
            : {}),
        });
      }
      continue;
    }
    /* THE PLAN'S REASON OUTRANKS THE SEAT'S SENTENCE, and the order is the point. The plan is
     * model-free — the rule's own instruction, the existence-class tail, a reader that did not
     * return — and a unit the plan never handed to this seat is not a unit the seat could decline.
     * So a `declined[]` entry over such a unit is reported as unused rather than written as a row. */
    if (memberDecline.has(kind.id)) {
      declinedUnused.push({
        kind: kind.id,
        because: "the seat declined members of this unit and opened none of it: a unit nobody opened is declined whole, and its members are not the seat's to name apart.",
      });
    }
    const reason = planned.get(kind.id);
    if (reason) {
      if (declinedNote.has(kind.id)) {
        declinedUnused.push({
          kind: kind.id,
          because: `the reading plan already leaves this unit unread for the reason "${reason}", which is the plan's own statement about it and not the seat's to restate.`,
        });
      }
      notRead.push({ kind: kind.id, members: kind.member_count, reason });
      continue;
    }
    /* A unit every row of which was answered as opened and none opened is a unit nobody opened. */
    if (unopened.length > 0) {
      notRead.push({ kind: kind.id, members: kind.member_count, reason: "not_opened", note: NOT_OPENED_NOTE });
      continue;
    }
    const note = declinedNote.get(kind.id);
    if (note !== undefined) {
      notRead.push({
        kind: kind.id,
        members: kind.member_count,
        reason: "seat_declined",
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      continue;
    }
    unaccounted.push({
      kind: kind.id,
      members: kind.member_count,
      because:
        "the reading plan handed this unit to a seat that returned, no reply carries a row for it, and the " +
        "seat's `declined[]` does not name it either. No reason from the fixed list describes that, so none " +
        "is written: silence is a gap, the run is incomplete, and the coverage check refuses the verdict " +
        "until the missing seat is re-run or the seat says in `declined[]` that it chose not to open it.",
    });
  }

  return {
    reading: {
      census: {
        spec: real.spec,
        level: real.level,
        unit: plan?.unit ?? "kind",
        kinds_total: real.kinds.length,
        units_total: units.kinds.length,
        locations_total: real.locations_total,
        hash: censusHash(real),
      },
      read,
      covered,
      not_read: notRead,
      ...(input.searched && input.searched.length > 0 ? { searched: input.searched } : {}),
      ...(declined.length > 0 ? { declined } : {}),
      ...(unopenedRows.length > 0 ? { unopened: unopenedRows } : {}),
    },
    unaccounted,
    refused,
    declined_unused: declinedUnused,
  };
}

/* --------------------------------------------------------------------------------------------- *
 * The coverage check (design section 3.6's gate rule, section 10.4's `coverage_gaps[]`).
 * --------------------------------------------------------------------------------------------- */

/** One thing wrong with a verdict's reading record, named by the branch that saw it. */
export interface ReadingCoverageGap {
  /** The check that fired: `partition`, `covered-outside-read`, `arithmetic`, `quote-floor`, … */
  check: string;
  finding_id: string;
  kind?: string;
  problem: string;
}

export interface ReadingCoverageInput {
  /** The candidate, with U1's census on it. */
  candidate: Candidate;
  /** The verdict's own `reading` block, as written. */
  reading: unknown;
  /** The verdict word, for the existence-class direction rule. */
  verdict?: string;
  /** `evidence[]`, for the enumeration check on a rule whose items are words and for the evidence
   * requirement of design section 2 (E3 + E4 + E2): `role` says what an entry is FOR and `name`
   * which element or item it answers. */
  evidence?: {
    file?: string;
    lines?: string;
    quote?: string;
    role?: string;
    name?: string;
    /** For an `element` entry — or, where the rule's items are not the matched word, an `item`
     * entry — standing on a search rather than on a kind it opened: that search's `for`. */
    search?: string;
  }[];
  /** The verdict's `rests_on` block, as written. See the premise check in `checkReadingCoverage`. */
  restsOn?: unknown;
  /**
   * Require a complete premise block on every verdict (unit H).
   *
   * **Off by default, and deliberately.** The block is written by the assembly step and only when
   * that step is given the tree it must hash, so every verdict stored before this unit — and every
   * run assembled without a tree — carries none. Turning the requirement on by default would report
   * those as gaps, which is a claim about records nobody has changed. What is ALWAYS checked, on or
   * off, is a block that is PRESENT and not `complete`: a premise record that says of itself that it
   * could not be derived is a defect wherever it appears. The operative safety sits one layer down
   * and needs no flag — `carry-forward.ts` never carries a verdict whose block is missing or
   * incomplete, so an unrequired block costs adjudication, never a stale answer.
   */
  requireRestsOn?: boolean;
}

/** A quoted location by its first line, `file:line`: how a row recorded as `3-5` and an entry quoting line 3 meet. */
function atLineOf(file: unknown, lines: unknown): string {
  return `${asText(file)}:${/\d+/.exec(asText(lines))?.[0] ?? ""}`;
}

/** The range a row's `lines` covers: the first and the last run of digits, so `8-12`, `8` and `8..12` alike. */
function lineSpanOf(lines: unknown): { start: number; end: number } | null {
  const digits = asText(lines).match(/\d+/g);
  if (digits === null || digits.length === 0) return null;
  const start = Number(digits[0]);
  const end = Number(digits[digits.length - 1]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end: Math.max(start, end) };
}

/**
 * Whether a quoted location stands on one of `rows`: the row as written (`file:lines`), its first line, or a first line
 * within the range the row covers. One matcher for every role that stands on a trail row,
 * and for the program that writes a role in (`inferredEvidenceRoles`), so the check and the writer cannot disagree.
 */
function standsOnRowOf(rows: readonly Record<string, unknown>[]): (file: unknown, lines: unknown) => boolean {
  const keys = new Set(rows.map((r) => `${asText(r.file)}:${asText(r.lines)}`));
  const atLines = new Set(rows.map((r) => atLineOf(r.file, r.lines)));
  const spans = rows
    .map((r) => ({ file: asText(r.file), span: lineSpanOf(r.lines) }))
    .filter((r): r is { file: string; span: { start: number; end: number } } => r.span !== null);
  return (file, lines) => {
    if (keys.has(`${asText(file)}:${asText(lines)}`) || atLines.has(atLineOf(file, lines))) return true;
    const at = lineSpanOf(lines);
    return at !== null && spans.some((r) => r.file === asText(file) && at.start >= r.span.start && at.start <= r.span.end);
  };
}

/**
 * The locations this candidate's census holds, in all and per item token (lower case): each kind's representative and
 * members, and every trail row of that kind. Where the rule's items are the matched word, an `item` entry quotes one of
 * its token's locations under any disposition (E2: a quoted dismissal answers the item as a listing does).
 */
function censusLocationsOf(
  census: ReadingCensus,
  readRows: readonly Record<string, unknown>[],
): { all: Set<string>; byToken: Map<string, Set<string>> } {
  const all = new Set<string>();
  const byToken = new Map<string, Set<string>>();
  for (const kind of census.kinds) {
    const here = new Set<string>([`${kind.representative.file}:${kind.representative.start_line}`]);
    for (const member of kind.members) here.add(`${member.file}:${member.start_line}`);
    for (const row of readRows) {
      if (asText(row.kind) === kind.id) here.add(atLineOf(row.file, row.lines));
    }
    for (const key of here) all.add(key);
    const token = (kind.matched_token ?? "").toLowerCase();
    if (token.length === 0) continue;
    const forToken = byToken.get(token) ?? new Set<string>();
    for (const key of here) forToken.add(key);
    byToken.set(token, forToken);
  }
  return { all, byToken };
}

/**
 * The gate rule, in one function: the trail names the document it was written against (its census
 * digest, recomputed here); every kind read or declared not read, and not read only for a reason the
 * PLAN gave; covered only within a read group; quotes at least as many as kinds read; no
 * `not_applicable` over an unread tail and no verdict but `needs_human` over a reader that did not
 * return; and — for a rule whose items ARE the matched word — every item enumerated.
 *
 * **What it does not claim.** For a read-derived rule — an entry point, a handler, a held value, a
 * channel — the completeness of the list is a reading duty stated in the rule and checked by the
 * run's verifier, and NO MACHINE CLAIMS IT HERE (design section 2, E2). The enumeration check below
 * fires only where the rule declares `item_source: "token"`, which is exactly the case where the
 * census carries the item set before any model reads a line.
 */
/**
 * Does this quotation NAME this item — at a token boundary, and not inside a longer word?
 *
 * Case-insensitive, because a vendor is written `Mixpanel` in one file and `mixpanel` in the next.
 * The boundary is "letter or digit": `_`, `-`, `.`, `/`, `@` and quotes are all boundaries, so
 * `"amplitude_notice"`, `@segment/analytics` and `mixpanel.track` each name their item, while
 * `amplituden` and `resegmentation` do not. **Only the ends that can carry one are tested**: a token
 * beginning `@` has no left boundary to ask about, and requiring one would make it unmatchable.
 */
export function quoteEnumerates(quote: string, token: string): boolean {
  if (!token) return false;
  const haystack = quote.toLowerCase();
  const needle = token.toLowerCase();
  const alnum = /[a-z0-9]/;
  const leftMatters = alnum.test(needle[0]!);
  const rightMatters = alnum.test(needle[needle.length - 1]!);
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    const before = at === 0 ? "" : haystack[at - 1]!;
    const after = haystack[at + needle.length] ?? "";
    const leftOk = !leftMatters || before === "" || !alnum.test(before);
    const rightOk = !rightMatters || after === "" || !alnum.test(after);
    if (leftOk && rightOk) return true;
    at = haystack.indexOf(needle, at + 1);
  }
  return false;
}

/**
 * THE BUDGET OUTCOME: the other outcome rule, and the sibling of the dismissal rule: "a
 * `not_read: budget` row makes the verdict `needs_human` naming the kind". A reader that did not return, or whose answer
 * was kept invalid (which leaves no reply of it on disk either), is a part of the candidate nobody read, and the seat that
 * says so has read some of it, which is what `needs_human` means and what no other verdict word says.
 *
 * ONE COPY. `checkReadingCoverage` applies it, at step 5a and, through
 * `recordCoverageGaps`, at the capture of every adjudicator answer while its seat can still answer again, on the reading
 * block step 5a assembles from the same files (reading-assembly.ts `answerRulesAtCapture`). `budgetUnits` is the number
 * of that block's `not_read` rows whose reason is `budget`. Returns the problem in the rule's words, or null.
 */
export function budgetOutcomeProblem(verdict: string | undefined, budgetUnits: number): string | null {
  if (budgetUnits <= 0 || verdict === undefined || verdict === "needs_human") return null;
  return (
    `this verdict is \`${verdict}\` and ${budgetUnits} unit(s) of its candidate are \`not_read: budget\` — a reader the plan ` +
    "gave them to did not return, or its answer was kept invalid. A verdict over a candidate a reader never finished is `needs_human` " +
    "naming how many units were not read; any other word states an answer for units nobody opened."
  );
}

/**
 * THE COVERAGE CHECK OF ONE ADJUDICATOR RECORD, AS STEP 5a RUNS IT.
 * One copy, two places: verdict-verify's loop over the assembled directory, and the capture
 * (reading-assembly.ts `answerRuleAtCapture`), which runs it on the record step 5a's first command writes from the
 * seat's answer, while the seat can still answer again. Null where the record has no trail to check: no census, no
 * `reading` block, no premise block and none required (verdict-verify passes such a record over).
 *
 * Every field the check reads travels with the entry: `role`, `name` and `search` (
 * an `element` or `item` entry standing on a search names it in `search`, and a mapping that dropped the field made
 * that ground unreachable through `verdict-verify --findings`), and the premise block with `requireRestsOn` (unit H;
 * a block that is present and says of itself that it is incomplete is a gap whether or not one is required).
 */
export function recordCoverageGaps(candidate: Candidate, holder: Record<string, unknown>, requireRestsOn: boolean): ReadingCoverageGap[] | null {
  const text = (v: unknown): string => (typeof v === "string" ? v : "");
  const entries = Array.isArray(holder.evidence) ? (holder.evidence.filter((e) => e && typeof e === "object") as Record<string, unknown>[]) : [];
  // Fix F2: a record that carries a `dismissal` is checked whatever else it carries (`dismissalRoleGaps`).
  const carriesDismissal = entries.some((e) => text(e.role).trim() === "dismissal");
  if (!kindCensusOf(candidate) && !holder.reading && !holder.rests_on && !requireRestsOn && !carriesDismissal) return null;
  return checkReadingCoverage({
    candidate,
    reading: holder.reading,
    verdict: text(holder.verdict),
    evidence: entries.map((e) => ({ file: text(e.file), lines: text(e.lines), quote: text(e.quote), role: text(e.role), name: text(e.name), search: text(e.search) })),
    restsOn: holder.rests_on,
    requireRestsOn,
  });
}

/**
 * THE ROLE THE PROGRAM WRITES IN FOR AN `evidence[]`
 * ENTRY THAT CARRIES NONE, where the record itself settles which role it is, and nowhere else. The check above is not
 * changed by it: an entry it writes is checked as the role it now carries, its quotation and its read included.
 *
 * - On a `not_applicable` verdict, `dismissal`: each role-less entry whose location stands on a trail row disposed
 *   `not_the_construct` (`standsOnRowOf`, the check's own matcher), and only where those entries and the dismissals the
 *   seat already gave are three or fewer together. Past the cap none is written, and the entries stay the seat's.
 * - On a `needs_human` verdict, an existing role where exactly one can stand. The one the record settles alone is `item`
 *   on a rule whose items are the matched word, at a location the census holds for exactly one item token and no
 *   affirmative trail row is at (where one is, `premise` could stand as well, and the program does not choose between
 *   them): the name is that token, written only where no other entry answers the same item and the entry names no other.
 * - Nowhere else. An entry on any other verdict, an entry at a place no trail row of the right disposition is at, and an
 *   entry without `file` and `lines` stay as the seat wrote them, and the check refuses them naming the roles.
 *
 * `rows`: the record's trail as the conversion holds it - a place seat's own rows with the rows kept for it, the answer
 * seat's per-place table, or a kinds seat's own rows. Each is the trail step 5a assembles or a part of it, so a role
 * written here stands on a row the record's check also sees.
 */
export function inferredEvidenceRoles(args: {
  candidate: Candidate;
  verdict: unknown;
  rows: readonly Record<string, unknown>[];
  evidence: unknown;
}): { evidence: unknown; written: number } {
  const { candidate, verdict, rows, evidence } = args;
  const declared = readingClassOf(candidate);
  if (!declared?.class || !Array.isArray(evidence)) return { evidence, written: 0 };
  const roleOf = (value: unknown): string => asText(asRecord(value)?.role).trim();
  const roleless: { value: Record<string, unknown>; index: number }[] = [];
  evidence.forEach((value, index) => {
    const entry = asRecord(value);
    if (!entry || roleOf(entry) !== "") return;
    if (asText(entry.file).length === 0 || asText(entry.lines).length === 0) return;
    roleless.push({ value: entry, index });
  });
  if (roleless.length === 0) return { evidence, written: 0 };
  const assigned = new Map<number, Record<string, unknown>>();
  if (verdict === "not_applicable") {
    const onDismissed = standsOnRowOf(rows.filter((r) => asText(r.disposition) === "not_the_construct"));
    const fits = roleless.filter((x) => onDismissed(x.value.file, x.value.lines));
    const given = evidence.filter((e) => roleOf(e) === "dismissal").length;
    if (fits.length > 0 && given + fits.length <= READING_DISMISSAL_CAP) {
      for (const x of fits) assigned.set(x.index, { ...x.value, role: "dismissal" });
    }
  } else if (verdict === "needs_human" && declared.item_source === "token") {
    const census = readingUnitsCensusOf(candidate);
    if (census) {
      const { byToken } = censusLocationsOf(census, rows);
      const onAffirmative = standsOnRowOf(
        rows.filter((r) => asText(r.disposition) === "is_the_construct" || asText(r.disposition) === "construct_but_gated"),
      );
      const answered = new Set(evidence.filter((e) => roleOf(e) === "item").map((e) => asText(asRecord(e)?.name).trim().toLowerCase()));
      const proposed = roleless.flatMap((x) => {
        if (onAffirmative(x.value.file, x.value.lines)) return [];
        const at = atLineOf(x.value.file, x.value.lines);
        const tokens = [...byToken.entries()].filter(([, where]) => where.has(at)).map(([token]) => token);
        if (tokens.length !== 1 || answered.has(tokens[0])) return [];
        const given = asText(x.value.name).trim().toLowerCase();
        return given.length > 0 && given !== tokens[0] ? [] : [{ ...x, token: tokens[0] }];
      });
      const perToken = new Map<string, number>();
      for (const p of proposed) perToken.set(p.token, (perToken.get(p.token) ?? 0) + 1);
      for (const p of proposed) if (perToken.get(p.token) === 1) assigned.set(p.index, { ...p.value, role: "item", name: p.token });
    }
  }
  if (assigned.size === 0) return { evidence, written: 0 };
  return { evidence: evidence.map((value, i) => assigned.get(i) ?? value), written: assigned.size };
}

/**
 * FIX F2: THE CONSTRAINTS ON THE ROLE `dismissal`, IN ONE PLACE, RUN
 * WHEREVER THE ROLE CAN APPEAR. The schema admits the role on every `evidence[]` entry of a verdict record (and of a
 * refutation's and a silence record's, which `dismissalOutsideVerdictProblems` refuses); the role checks of
 * `checkReadingCoverage` run only where the candidate carries a census and its rule declares a `reading_class`, so these
 * are not among them: `checkReadingCoverage` calls this before any of its branches can return, and `recordCoverageGaps`
 * does not pass over a record that carries the role.
 *
 * A dismissal is a place the trail read and set aside, shown as part of why the finding does not hold (the parent's
 * decision of 2026-10-07, unit U1), so it costs what it claims:
 * - the rule declares a `reading_class`: the roles are that vocabulary, and the program writes none on any other rule
 *   (`inferredEvidenceRoles`);
 * - the verdict is `not_applicable`: the verdict says the finding does not hold;
 * - a `read` row of the record's trail disposed the place `not_the_construct` (`standsOnRowOf`, the writer's matcher);
 * - at most READING_DISMISSAL_CAP of them.
 * Its quotation and its read are checked as every entry's are (verdict-verify's quote check, the answer seat's A2 and
 * A6); nothing here relaxes them, and A4 bars a `not_applicable` verdict as before.
 */
/** Whether the candidate's rule declares a reading class: the one test the role checks below and the capture's drop of an inert role (`inertDismissals`) share. */
export function declaresReadingClass(candidate: Candidate): boolean {
  return Boolean(readingClassOf(candidate)?.class);
}

/** What the capture dropped from one `evidence[]` entry as inert, and why (`inertDismissals`). */
export interface InertFieldDropped {
  /** The entry's position in `evidence[]`. */
  index: number;
  /** Each field dropped, with the value the seat gave it. */
  fields: Record<string, unknown>;
  why: string;
}

/**
 * A FIELD NO CHECK READS ON THAT RULE IS DROPPED AND
 * RECORDED, NEVER REFUSED. On a rule that declares no reading class, an entry carries no role (`dismissalRoleGaps`; the agent
 * text: "where it carries none, entries take no role"): a `dismissal` there says nothing any check can use, since the role's
 * constraints (a `not_applicable` verdict, a `read` row disposed `not_the_construct`, the cap) are those of a classed rule,
 * and the place the seat set aside is in its trail already with its quotation and disposition. In the runs of
 * 2026-10-26/27 it was the commonest reason a hand-back was refused, each refusal costing a resend and bringing a seat
 * one step nearer an invalid answer. So the capture takes the role out (with a `name` on
 * that entry, which says which one of a role) and records what it took (the capture ledger's `normalised`), and the
 * entry stays as plain evidence, its quotation and its read checked as every entry's are. Every other role, on every
 * rule, is left as the seat gave it: `premise`, `item` and `element` are read on a rule with no class too (the
 * answer seat's A1, the shape checks, the report's "cited as"), and on a classed rule `dismissal` is vocabulary whose
 * misuse is refused as before (`dismissalRoleGaps`).
 */
export function inertDismissals(candidate: Candidate, evidence: unknown): { evidence: unknown; dropped: InertFieldDropped[] } {
  if (!Array.isArray(evidence) || declaresReadingClass(candidate)) return { evidence, dropped: [] };
  const dropped: InertFieldDropped[] = [];
  const out = evidence.map((value, index) => {
    const e = asRecord(value);
    if (!e || asText(e.role).trim() !== "dismissal") return value;
    const fields: Record<string, unknown> = { role: e.role, ...("name" in e ? { name: e.name } : {}) };
    dropped.push({ index, fields, why: "the role `dismissal` on a rule that declares no reading class, where an entry carries no role" });
    const kept: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(e)) if (k !== "role" && k !== "name") kept[k] = v;
    return kept;
  });
  return { evidence: dropped.length > 0 ? out : evidence, dropped };
}

export function dismissalRoleGaps(input: Pick<ReadingCoverageInput, "candidate" | "verdict" | "evidence" | "reading">): ReadingCoverageGap[] {
  const gaps: ReadingCoverageGap[] = [];
  const id = input.candidate.finding_id;
  const add = (check: string, problem: string) => gaps.push({ check, finding_id: id, problem });
  const entries = (input.evidence ?? []).map((entry, index) => ({ entry, index })).filter(({ entry }) => (entry.role ?? "").trim() === "dismissal");
  if (entries.length === 0) return gaps;
  const classed = declaresReadingClass(input.candidate);
  const readRows = asArray(asRecord(input.reading)?.read).map(asRecord).filter((r): r is Record<string, unknown> => r !== null);
  const standsOnDismissed = standsOnRowOf(readRows.filter((r) => asText(r.disposition) === "not_the_construct"));
  for (const { entry, index } of entries) {
    const where = `\`evidence[${index}]\`${entry.file ? ` (${entry.file}:${entry.lines ?? ""})` : ""}`;
    const key = `${entry.file ?? ""}:${entry.lines ?? ""}`;
    if (!classed) {
      add(
        "evidence-role",
        `${where} is offered as a \`dismissal\`, and this candidate's rule declares no reading class. The roles are the vocabulary ` +
          "of a rule that declares one, and on this rule an entry carries no role: a place the trail set aside as not the construct is " +
          "in the trail already with its quotation and its disposition. Remove the role, or the entry.",
      );
    }
    if (input.verdict !== "not_applicable") {
      add(
        "evidence-role",
        `${where} is offered as a \`dismissal\`, and this verdict is ${JSON.stringify(input.verdict ?? "")}. A dismissal quotes a place ` +
          "this record read and set aside as not the construct, to show why the finding does not hold, so it is admitted only on " +
          "a `not_applicable` verdict. On any other verdict the place is in the trail already with its quotation and its disposition.",
      );
    } else if (classed && !standsOnDismissed(entry.file, entry.lines)) {
      add(
        "evidence-role",
        `${where} is offered as a \`dismissal\` at ${JSON.stringify(key)}, and no \`read\` row of this trail was opened there and ` +
          "disposed `not_the_construct`. A dismissal quotes a place this record read and set aside; a quotation from anywhere " +
          "else is evidence of something, and not of a dismissal.",
      );
    }
  }
  if (classed && entries.length > READING_DISMISSAL_CAP) {
    add(
      "dismissal-restated",
      `\`evidence[]\` carries ${entries.length} entries of role \`dismissal\`, and the cap is ${READING_DISMISSAL_CAP}: the few places that ` +
        "show why the finding does not hold, as a premise shows the two or three strongest. Every place the trail set aside is " +
        "already in it with its own quotation and its own disposition; keep the three that say the most and leave the rest to the trail.",
    );
  }
  return gaps;
}

/**
 * Fix F2: the role `dismissal` on a record that carries no verdict word - a refuter's or a silence
 * investigator's (`verdict.schema.json` `refutation.evidence`, `silence-reply.schema.json`). It is admitted only on an
 * adjudicator's `not_applicable` verdict (`dismissalRoleGaps`), so here it is refused always. `path` names the list.
 */
export function dismissalOutsideVerdictProblems(evidence: unknown, path = "evidence"): string[] {
  if (!Array.isArray(evidence)) return [];
  return evidence.flatMap((row, i) => {
    const r = asRecord(row);
    if (!r || asText(r.role).trim() !== "dismissal") return [];
    return [
      `\`${path}[${i}]\` is offered as a \`dismissal\`, and this record carries no verdict: a dismissal quotes a place a verdict's ` +
        "trail set aside as not the construct, and it is admitted only on an adjudicator's `not_applicable` verdict. Remove the role.",
    ];
  });
}

export function checkReadingCoverage(input: ReadingCoverageInput): ReadingCoverageGap[] {
  const gaps: ReadingCoverageGap[] = [];
  const id = input.candidate.finding_id;
  // THE UNITS THE PLAN READS, not the raw groups: an existence, enumeration or mixed class reads by
  // same-kind line groups and a per-location class reads by locations, and the trail has to account
  // for whichever the plan chose. `readingUnitsCensusOf` is where that choice is read, once.
  const census = readingUnitsCensusOf(input.candidate);
  const block = asRecord(input.reading);
  const add = (check: string, problem: string, kind?: string) =>
    gaps.push({ check, finding_id: id, ...(kind ? { kind } : {}), problem });
  // Fix F2: the role `dismissal` is checked before any branch below can return, on every candidate.
  gaps.push(...dismissalRoleGaps({ candidate: input.candidate, verdict: input.verdict, evidence: input.evidence, reading: input.reading }));

  /* THE PREMISE BLOCK (unit H). A verdict says what it rests on so a later run can re-derive those
   * premises with no model; a block that is absent where it was required, or present and not
   * `complete`, is a verdict no later run may carry — and a verdict that cannot be re-checked is not
   * a covered one. It is checked BEFORE the census branch because a candidate read location by line
   * rests on files and searches exactly as one read by kinds does. */
  const premises = asRecord(input.restsOn);
  if (!premises) {
    if (input.requireRestsOn) {
      add(
        "rests-on-missing",
        "this verdict carries no `rests_on` block, so nothing records the files it read, the searches it ran or the clause it " +
          "was given — and a later run has no premise to re-derive. The block is the assembly step's to write, from what the " +
          "seat already recorded; a seat is never asked for a digest.",
      );
    }
  } else if (premises.complete !== true) {
    const why = Array.isArray(premises.incomplete) ? premises.incomplete.filter((r) => typeof r === "string").join(" ") : "no reason recorded";
    add(
      "rests-on-incomplete",
      `this verdict's \`rests_on\` block says of itself that it could not be derived: ${why} A verdict whose premises are ` +
        "incomplete is never carried forward, so the cost of leaving this is re-adjudication rather than a stale answer — but " +
        "the record still asserts a reading nobody can re-check.",
    );
  }

  if (!census) {
    if (block) {
      add(
        "no-census",
        "this verdict carries a `reading` block and its candidate carries no kind census, so there is nothing to check it " +
          "against. A reading block is the record of a candidate read BY KINDS; a candidate read location by location has none.",
      );
    }
    return gaps;
  }
  if (!block) {
    add(
      "missing-reading",
      `this candidate carries a census of ${census.kinds.length} same-kind line group(s) over ${census.locations_total} ` +
        "matched location(s), and its verdict carries no `reading` block — so nothing records which of those locations was " +
        "read, which was settled by a representative, and which nobody opened.",
    );
    return gaps;
  }

  /* 0. WHAT THE TRAIL WAS WRITTEN AGAINST: the census digest, recomputed here.
   *
   * Every row below names its unit by an INDEX into one document's `kinds.groups`, so a row's name
   * means nothing except relative to that document: two units of equal member count in the same file
   * can be swapped and every other check here still passes, while every row now names a different
   * group. The digest is what ties a name to a group, and section 3.8 makes the log's addressability
   * rest on it — so it is recomputed from the candidate rather than trusted as written.
   * Taken over the REAL groups, which is what `assembleReading` writes and what a later run
   * re-derives, and not over the per-location view of them. */
  const realCensus = kindCensusOf(input.candidate);
  const declaredHash = asText(asRecord(block.census)?.hash);
  if (realCensus) {
    const expected = censusHash(realCensus);
    if (!declaredHash) {
      add(
        "census-hash",
        "this `reading` block carries no census hash, so nothing says which document it was written against. Every row " +
          "below names its unit by an index into one document's census, and without the digest an index is not a name.",
      );
    } else if (declaredHash !== expected) {
      add(
        "census-hash",
        `this \`reading\` block was written against a different document: its census hash is ${JSON.stringify(declaredHash)} and ` +
          `this candidate's census hashes to ${JSON.stringify(expected)}. A unit is named by its index in \`kinds.groups\`, so ` +
          "against another census every row of this trail names another group, and the counts can still add up.",
      );
    }
  }

  /* The plan, for the check that the trail's `not_read` rows are ones the plan gave. Read once. */
  const plan = readingPlanOf(input.candidate);
  const plannedUnread = plannedNotRead(plan, "unknown");
  const planNamesUnits =
    plan !== null && (plan.seat_slice.length > 0 || plan.reader_slices.length > 0 || plan.unread.length > 0);

  // A UNIT IS NAMED BY ITS ID AND NEVER BY ITS KEY: U1's key is not unique in `groups[]` (its
  // own-evidence rule makes a group of one under the same key), so a check keyed on `key` would
  // silently merge two groups and pass a verdict that read one of them.
  const keys = new Set(census.kinds.map((k) => k.id));
  const memberCount = new Map(census.kinds.map((k) => [k.id, k.member_count]));
  const memberFiles = new Map(census.kinds.map((k) => [k.id, new Set(k.members.map((m) => m.file))]));

  const readRows = asArray(block.read).map(asRecord).filter((r): r is Record<string, unknown> => r !== null);
  const coveredRows = asArray(block.covered).map(asRecord).filter((r): r is Record<string, unknown> => r !== null);
  const notReadRows = asArray(block.not_read).map(asRecord).filter((r): r is Record<string, unknown> => r !== null);

  // 1. The partition: every kind in exactly one of `read` and `not_read`, and nothing else in either.
  const opened = new Map<string, number>();
  const readSubShapes = new Set<string>();
  /* A ROW MARKED `also_read_by_reader` IS A SECOND LOOK, NOT A SECOND LOCATION (U4 finding M4). The
   * verdict seat is entitled to open a unit a reader already disposed, and its row is kept as its
   * own record; what it must not do is enter the arithmetic twice, which is how umami `eu-dsr-002`
   * came to "account for 106 of this candidate's 104 matched location(s)" with nothing unread. So
   * the row is checked like any other — quote, file, disposition — and counted nowhere. */
  const alsoReadRows: Record<string, unknown>[] = [];
  for (const row of readRows) {
    const kind = asText(row.kind);
    if (!keys.has(kind)) {
      add("partition", `a \`read\` row names the kind ${JSON.stringify(kind)}, which is in no census row of this candidate.`, kind);
      continue;
    }
    const alsoRead = row.also_read_by_reader === true;
    const id2 = readRowLocationKey(row);
    if (!alsoRead) {
      if (readSubShapes.has(id2)) {
        add("partition", twoReadRowsProblem(kind), kind);
        continue;
      }
      readSubShapes.add(id2);
      opened.set(kind, (opened.get(kind) ?? 0) + 1);
    } else {
      alsoReadRows.push(row);
    }
    const files = memberFiles.get(kind)!;
    const file = asText(row.file);
    if (file && !files.has(file)) {
      add(
        "read-row-off-kind",
        `a \`read\` row for the kind ${JSON.stringify(kind)} names ${file}, which holds no member of that kind — so the row is ` +
          "not a reading of this kind's representative or of one of its members.",
        kind,
      );
    }
    if (!asText(row.quote).trim()) {
      add(
        "quote-floor",
        `the \`read\` row for the kind ${JSON.stringify(kind)} carries no quote. Every kind in \`read\` carries a verbatim quote of ` +
          "what was opened — that is the evidence floor, and a row without one records a reading nobody can check.",
        kind,
      );
    }
    const disposition = asText(row.disposition);
    if (!READING_DISPOSITIONS.includes(disposition as ReadingDisposition)) {
      add("disposition", `the \`read\` row for the kind ${JSON.stringify(kind)} carries the disposition ${JSON.stringify(disposition)}, which is not one of the five.`, kind);
    }
    const declaredCover = asText(row.cover_ground);
    if (declaredCover && !READING_COVER_GROUNDS.includes(declaredCover as ReadingCoverGround)) {
      add(
        "covered-ground",
        `the \`read\` row for the kind ${JSON.stringify(kind)} offers ${JSON.stringify(declaredCover)} as the ground its other members may ` +
          `be covered on, and that is not one of the six (${READING_COVER_GROUNDS.join(", ")}). The free-text \`ground\` says what ` +
          "settled the row that was opened; this field says what the SHAPE settles for the rest, and only those six shapes do.",
        kind,
      );
    }
  }
  /* A marked row whose unit has no unmarked row is the only reading that unit has, so it counts
   * once: the mark says "a reader read this too", and where no reader's row is in the record the
   * mark cannot be allowed to erase the unit from the trail. */
  for (const row of alsoReadRows) {
    const kind = asText(row.kind);
    if (opened.has(kind)) continue;
    readSubShapes.add(readRowLocationKey(row));
    opened.set(kind, 1);
  }

  const notReadKinds = new Set<string>();
  /** Members declined in a unit that was opened, by unit: its `not_read` rows' count, checked below. */
  const declinedInOpened = new Map<string, number>();
  /** The reasons of the `not_read` rows each opened unit carries (one `seat_declined`, one `not_opened`). */
  const openedRowReasons = new Map<string, Set<string>>();
  /** The verification's L2: the places the `locations` rows of each opened unit name, to refuse one named twice. */
  const listedInOpened = new Map<string, Set<string>>();
  let repositoryAnswerKinds = 0;
  let budgetKinds = 0;
  let seatDeclinedKinds = 0;
  let seatDeclinedMembers = 0;
  let unreadableKinds = 0;
  let notOpenedKinds = 0;
  let notOpenedMembers = 0;
  for (const row of notReadRows) {
    const kind = asText(row.kind);
    if (!keys.has(kind)) {
      add("partition", `a \`not_read\` row names the kind ${JSON.stringify(kind)}, which is in no census row of this candidate.`, kind);
      continue;
    }
    if (notReadKinds.has(kind) || openedRowReasons.get(kind)?.has(asText(row.reason))) {
      add("partition", `the kind ${JSON.stringify(kind)} appears twice in \`not_read\`.`, kind);
      continue;
    }
    /* A UNIT OPENED IN PART: the seat read the representative and
     * declined some members, in its own sentence. It is the one `not_read` row a unit in `read` may have: reason
     * `seat_declined`, a note, `locations` naming members of this unit, and `members` counting the locations it
     * accounts for, which the arithmetic below adds to the unit's opened and covered ones. Every other row on an opened
     * unit is the partition gap it always was. */
    const locations = Array.isArray(row.locations) ? row.locations : null;
    if (opened.has(kind)) {
      const reasonHere = asText(row.reason);
      if ((reasonHere !== "seat_declined" && reasonHere !== "not_opened") || !locations || locations.length === 0) {
        add("partition", `the kind ${JSON.stringify(kind)} is in both \`read\` and \`not_read\`. A kind was opened or it was not, and the \`not_read\` rows an opened kind may carry name the \`locations\` of the members not read: the seat's own (\`seat_declined\`), for members it declined, and the capture's (\`not_opened\`), for members it answered as opened and did not open.`, kind);
        continue;
      }
      openedRowReasons.set(kind, (openedRowReasons.get(kind) ?? new Set<string>()).add(reasonHere));
      const unit = census.kinds.find((k) => k.id === kind)!;
      const memberAt = new Set(unit.members.map((m) => `${m.file}:${m.start_line}`));
      const foreign = locations.filter((l) => typeof l !== "string" || !memberAt.has(l));
      if (foreign.length > 0) {
        add("partition", `the \`not_read\` row for the opened kind ${JSON.stringify(kind)} names ${foreign.map((l) => JSON.stringify(l)).join(", ")} in \`locations\`, which ${foreign.length === 1 ? "is" : "are"} no member of that kind.`, kind);
      }
      /* PLACE BY PLACE (the verification's L2): each place once, across the unit's rows; none the place a read row of
       * the unit stands for (`memberAtRow`); and no count above the places the row lists. The assembler cannot write
       * any of the three; a record that does is refused, so the invariant is the check's and not only the writer's. */
      const listed = listedInOpened.get(kind) ?? new Set<string>();
      const twice = locations.filter((l, i) => typeof l === "string" && (listed.has(l) || locations.indexOf(l) !== i));
      if (twice.length > 0) {
        add("partition", `the \`not_read\` rows for the opened kind ${JSON.stringify(kind)} name ${[...new Set(twice)].map((l) => JSON.stringify(l)).join(", ")} more than once in \`locations\`: each place not read is listed once.`, kind);
      }
      for (const l of locations) if (typeof l === "string") listed.add(l);
      listedInOpened.set(kind, listed);
      const readAt = new Set(readRows.filter((r) => asText(r.kind) === kind).map((r) => memberAtRow(unit, { file: asText(r.file), lines: asText(r.lines), ...(typeof r.sub_shape === "string" ? { sub_shape: r.sub_shape } : {}) })));
      const alsoRead = locations.filter((l) => typeof l === "string" && readAt.has(l));
      if (alsoRead.length > 0) {
        add("partition", `the \`not_read\` row for the opened kind ${JSON.stringify(kind)} names ${alsoRead.map((l) => JSON.stringify(l)).join(", ")} in \`locations\`, which a \`read\` row of that kind stands at: a place is read or not read, never both.`, kind);
      }
      const count = asInt(row.members);
      if (count === null || count < 1) {
        add("arithmetic", `the \`not_read\` row for the opened kind ${JSON.stringify(kind)} carries \`members\` ${row.members === undefined ? "absent" : JSON.stringify(row.members)}, which is not a count (an integer of at least 1), so how many of its members were not read cannot be added up.`, kind);
      } else if (count > locations.length) {
        add("arithmetic", `the \`not_read\` row for the opened kind ${JSON.stringify(kind)} counts ${count} member(s) not read and lists ${locations.length} place(s): a member not read in a unit that was opened is listed where it is, so the count is never above the places listed.`, kind);
      }
      if (!asText(row.note).trim()) {
        add("not-read-against-plan", `the \`not_read\` row for the opened kind ${JSON.stringify(kind)} declines members and carries no note: the seat says in its own words why it did not read them, or it is not a reason.`, kind);
      }
      declinedInOpened.set(kind, (declinedInOpened.get(kind) ?? 0) + (count ?? 0));
      if (reasonHere === "not_opened") notOpenedMembers += count ?? 0;
      else seatDeclinedMembers += count ?? 0;
      continue;
    }
    if (locations) {
      add("partition", `the \`not_read\` row for the kind ${JSON.stringify(kind)} names \`locations\`, and nobody opened that kind: a unit nobody opened is not read whole, and \`locations\` names the unread members of a unit that was opened.`, kind);
    }
    notReadKinds.add(kind);
    const reason = asText(row.reason);
    if (!READING_NOT_READ_REASONS.includes(reason as ReadingNotReadReason)) {
      add("not-read-reason", `the \`not_read\` row for the kind ${JSON.stringify(kind)} gives the reason ${JSON.stringify(reason)}, which is not one of the fixed list (${READING_NOT_READ_REASONS.join(", ")}).`, kind);
    }
    if (reason === "repository_answer") repositoryAnswerKinds += 1;
    // `not_answered` is the place plan's `budget` (build unit F3): the same outcome rule binds it.
    if (reason === "budget" || reason === "not_answered") budgetKinds += 1;
    if (reason === "seat_declined") seatDeclinedKinds += 1;
    if (reason === "unreadable") unreadableKinds += 1;
    if (reason === "not_opened") notOpenedKinds += 1;
    const declared = asInt(row.members);
    const real = memberCount.get(kind)!;
    /* A `members` THAT IS NOT A COUNT IS A GAP, NOT A SKIP. The
     * comparison below ran only `if (declared !== null)`, so an absent or mistyped count ("999", a
     * string) skipped the one arithmetic this row exists for, with nothing said. verdict.schema.json
     * makes it an integer of at least 1, and the carry-forward reads the same field the same way. */
    if (declared === null || declared < 1) {
      add(
        "arithmetic",
        `the \`not_read\` row for the kind ${JSON.stringify(kind)} carries \`members\` ${row.members === undefined ? "absent" : JSON.stringify(row.members)}, ` +
          `which is not a count (an integer of at least 1), so what nobody opened cannot be added up; the census gives it ${real}.`,
        kind,
      );
    } else if (declared !== real) {
      add(
        "arithmetic",
        `the \`not_read\` row for the kind ${JSON.stringify(kind)} says ${declared} member(s) were not read and the census gives it ` +
          `${real}. The count of what nobody opened is the one number this record exists to carry.`,
        kind,
      );
    }
    /* THE REASON IS THE PLAN'S, NOT THE SEAT'S.
     *
     * `rule_instruction` is the RULE's instruction and `repository_answer` is the existence-class
     * tail the plan cut; `budget` is a reader that did not return. None of the three is something a
     * seat may assert about a unit the plan told it to open, and section 3.4 says it in terms: "The
     * seat may not stop before the 70 are disposed and every element answered." Without this the
     * escape hatch section 3.6 closes in `covered` reopens in `not_read` — measured on one tree's
     * `ai-transparency-008`, whose plan reads all 19 units and whose trail opened 4, declared 15
     * `not_read: rule_instruction` and was admitted with the verdict `not_applicable`.
     *
     * `unreadable` is the one reason a seat states from its own experience — a file it could not
     * open — and it is admitted anywhere, with the note that says which file and why. */
    if (planNamesUnits) {
      const note = asText(row.note).trim();
      const plannedReason = plannedUnread.get(kind);
      if (reason === "unreadable" || reason === "seat_declined" || reason === "not_opened") {
        /* THE REASONS A SEAT'S OWN READING GIVES, admitted anywhere the plan did not already answer
         * for the unit — with a sentence, or they are not reasons. `unreadable` says which file could
         * not be opened; `seat_declined` (U4 finding M6) says why a unit the seat was handed was judged
         * not worth opening; `not_opened` is the capture's, for a unit every row of which
         * the seat answered as opened and its transcript shows it did not open, with the program's
         * note. None excuses the reading, and all three bar `not_applicable` in the fifth check below exactly
         * as an unread tail does: `seat_declined` since R1-A, `not_opened` since a later change,
         * and `unreadable` by a decision (a place the seat
         * could not read is a place nobody read), which reverses what an earlier analysis found the code
         * decided. */
        if (!note) {
          add(
            "not-read-against-plan",
            `the \`not_read\` row for the unit ${JSON.stringify(kind)} gives the reason ${JSON.stringify(reason)} and carries no note. That is ` +
              "one of the two reasons a seat states from its own reading rather than from the plan, so it says in the seat's own " +
              "words which file it could not open, or why a unit it was handed was not worth opening, or it is not a reason.",
            kind,
          );
        }
      } else if (plannedReason === undefined) {
        add(
          "not-read-against-plan",
          `the \`not_read\` row for the unit ${JSON.stringify(kind)} gives the reason ${JSON.stringify(reason)}, and the reading plan ` +
            "handed that unit to a seat to open. A unit the plan told a seat to read is read, or the run is incomplete and says so: " +
            "the reasons on this list are the plan's — the rule's own instruction, the existence-class tail, a reader that did not " +
            "return — and a seat may not write one about a unit it was told to open.",
          kind,
        );
      } else if (plannedReason !== reason) {
        add(
          "not-read-against-plan",
          `the \`not_read\` row for the unit ${JSON.stringify(kind)} gives the reason ${JSON.stringify(reason)} and the reading plan ` +
            `leaves that unit unread for the reason ${JSON.stringify(plannedReason)}. The reason a unit was not opened is the plan's ` +
            "statement about it, and a trail that renames it records a reading nobody planned.",
          kind,
        );
      }
    }
  }

  for (const kind of census.kinds) {
    if (!opened.has(kind.id) && !notReadKinds.has(kind.id)) {
      add(
        "partition",
        `the reading unit ${JSON.stringify(kind.id)} (${kind.member_count} matched location(s)) is in neither \`read\` nor ` +
          "`not_read`. Every unit of the census is opened or is declared not read with a reason; a unit in neither is a " +
          "reading nobody accounted for.",
        kind.id,
      );
    }
  }

  // 2. `covered` is a property of a MEMBER of a kind whose representative was read.
  const coveredPerKind = new Map<string, number>();
  for (const row of coveredRows) {
    const kind = asText(row.kind);
    if (!keys.has(kind)) {
      add("covered-outside-read", `a \`covered\` row names the kind ${JSON.stringify(kind)}, which is in no census row of this candidate.`, kind);
      continue;
    }
    if (!opened.has(kind)) {
      add(
        "covered-outside-read",
        `the kind ${JSON.stringify(kind)} carries a \`covered\` row and is not in \`read\`. A member is covered by the reading of ` +
          "ITS OWN kind's representative and by nothing else: a kind nobody opened cannot have its members settled by one.",
        kind,
      );
      continue;
    }
    if (coveredPerKind.has(kind)) {
      add("covered-outside-read", `the kind ${JSON.stringify(kind)} has two \`covered\` rows, so how many of its members were settled by its representative is not a number.`, kind);
      continue;
    }
    // The same disposition list the `read` rows are held to. A covered row says what its kind's
    // remaining members were disposed as, so a word outside the five is as meaningless here as
    // there — and the runtime path had only the schema between it and a verdict that carried one.
    /* THE SAFETY LINE OF DESIGN SECTION 3.5, quoted where it is enforced: "a kind's members may be
     * covered by the reading of its representative only on grounds INTRINSIC TO THE SHAPE", and "a
     * ground that depends on a call path or a gate - consent recorded, dead code, server-side only,
     * not shipped - is per file: the seat opens every member's file at least once, or disposes those
     * members `undetermined` and says so". Measured before this check existed: covered rows resting
     * on "server-side only: this runs in the API layer" were admitted by everything. */
    const coverGround = asText(row.ground);
    /* D3(e):
     * THE GROUND IS NOT OPTIONAL ON A COVER. A cover is the only place in the trail where members
     * nobody opened are settled, and what settles them is what the SHAPE is; a covered row with no
     * ground says members were settled and does not say by what, which is the one row a reader of
     * the finding cannot check. The six are the whole list, so a missing ground and a ground outside
     * them are two different defects and are reported as two checks. */
    if (!coverGround) {
      add(
        "cover-ground-missing",
        `the \`covered\` row for the kind ${JSON.stringify(kind)} settles ${asInt(row.members) ?? 0} member(s) nobody opened and names no ` +
          `ground. A cover rests on one of the six shape-intrinsic grounds (${READING_COVER_GROUNDS.join(", ")}), carried from the ` +
          "representative's `cover_ground`; where none is named, nothing in the record says what settled the members, and a ground " +
          "that would depend on a call path or a gate is per file and could not be carried here at all.",
        kind,
      );
    }
    if (coverGround && !READING_COVER_GROUNDS.includes(coverGround as ReadingCoverGround)) {
      add(
        "covered-ground",
        `the \`covered\` row for the kind ${JSON.stringify(kind)} rests on the ground ${JSON.stringify(coverGround)}, which is not one of ` +
          `the six a cover may rest on (${READING_COVER_GROUNDS.join(", ")}). Members nobody opened are settled by what the SHAPE is ` +
          "and never by a call path or a gate: a ground of that kind is per file, so the seat opens every member's file at least " +
          "once, or disposes those members `undetermined` and says so.",
        kind,
      );
    }
    /* THE COVERED ROW'S DISPOSITION IS THE DISPOSITION OF THE ROW IT NAMES.
     *
     * `read[]` carries one row per SUB-SHAPE, so one kind can hold rows with different dispositions
     * — one tree's `eu-dsr-001` kind 18 holds three, two `is_the_construct` and one
     * `not_the_construct`. `covered[].by` disambiguates by naming the representative's file:line,
     * and the gate's rule as SKILL.md states it ("a covered row is admitted only for a kind that is
     * in read") is satisfied by ANY of the three. So a consumer joining `covered` to `read` on kind
     * alone silently reads whichever sub-shape row comes last — U4's verifier did exactly that and
     * produced a false contradiction. This comparison closes it: the members a representative
     * settles are settled AS THAT REPRESENTATIVE WAS, and a row saying otherwise is refused. */
    const by = asText(row.by);
    const named = readRows.filter(
      (r) => asText(r.kind) === kind && `${asText(r.file)}:${asText(r.lines)}` === by,
    );
    const coveredDispositionValue = asText(row.disposition);
    if (by && named.length === 0) {
      add(
        "covered-disposition",
        `the \`covered\` row for the kind ${JSON.stringify(kind)} names ${JSON.stringify(by)} as the representative that settled its members, ` +
          "and no `read` row of that kind was opened there. A cover is the reading of one named row extended to the members of its " +
          "own kind; where the row it names is not in the trail, nothing in the record says what settled them.",
        kind,
      );
    } else if (named.length > 0 && !named.some((r) => asText(r.disposition) === coveredDispositionValue)) {
      add(
        "covered-disposition",
        `the \`covered\` row for the kind ${JSON.stringify(kind)} disposes its members ${JSON.stringify(coveredDispositionValue)} and the \`read\` row ` +
          `it names in \`by\` (${JSON.stringify(by)}) disposes ${JSON.stringify(named.map((r) => asText(r.disposition)).join(", "))}. A kind can hold one row ` +
          "per sub-shape and those rows can differ, so the members covered by one representative take THAT representative's " +
          "disposition and no other.",
        kind,
      );
    }
    const coveredDisposition = coveredDispositionValue;
    if (!READING_DISPOSITIONS.includes(coveredDisposition as ReadingDisposition)) {
      add(
        "disposition",
        `the \`covered\` row for the kind ${JSON.stringify(kind)} carries the disposition ${JSON.stringify(coveredDisposition)}, which is not one of the five.`,
        kind,
      );
    }
    // The same count, the same rule: a `covered` row whose `members` is not an
    // integer of at least 1 was read as 0, which can make an inconsistent row add up.
    const coveredCount = asInt(row.members);
    if (coveredCount === null || coveredCount < 1) {
      add(
        "arithmetic",
        `the \`covered\` row for the kind ${JSON.stringify(kind)} carries \`members\` ${row.members === undefined ? "absent" : JSON.stringify(row.members)}, ` +
          "which is not a count (an integer of at least 1), so how many members its representative settled is not a number.",
        kind,
      );
    }
    coveredPerKind.set(kind, coveredCount ?? 0);
  }

  // 3. The arithmetic: every location of the candidate classified exactly once.
  let accountedFor = 0;
  for (const kind of census.kinds) {
    const openedHere = opened.get(kind.id) ?? 0;
    if (openedHere === 0) {
      if (notReadKinds.has(kind.id)) accountedFor += kind.member_count;
      continue;
    }
    const coveredHere = coveredPerKind.get(kind.id) ?? 0;
    const declinedHere = declinedInOpened.get(kind.id) ?? 0;
    accountedFor += openedHere + coveredHere + declinedHere;
    if (openedHere + coveredHere + declinedHere !== kind.member_count) {
      add(
        "arithmetic",
        `the reading unit ${JSON.stringify(kind.id)} holds ${kind.member_count} matched location(s); the record opens ` +
          `${openedHere}, covers ${coveredHere} and leaves ${declinedHere} not read (declined by the seat, or answered as opened and not opened), which accounts for ${openedHere + coveredHere + declinedHere}. Every location of a unit ` +
          "that was read is opened, covered by the representative that was opened, or not read and listed where it is.",
        kind.id,
      );
    }
  }
  if (accountedFor !== census.locations_total && gaps.every((g) => g.check !== "partition")) {
    add(
      "arithmetic",
      `the record accounts for ${accountedFor} of this candidate's ${census.locations_total} matched location(s).`,
    );
  }

  // 4. The evidence floor: quotes in the trail are at least as many as kinds read (E1).
  const quoted = readRows.filter((r) => asText(r.quote).trim().length > 0).length;
  if (quoted < opened.size) {
    add(
      "quote-floor",
      `${opened.size} kind(s) are recorded as read and ${quoted} of the rows carry a quote. The trail holds at least as many ` +
        "quotes as there are kinds in `read`; anything less is a reading with no record of what was read.",
    );
  }

  // 5. The direction the cap binds in.
  /* `seat_declined` joins `repository_answer` here and changes nothing about the direction the cap
   * binds in (U4 finding M6): a unit the seat was handed and chose not to open is a unit nobody
   * opened, and a dismissal is a claim about every one of them. A new word for an unread unit that
   * did not bar the dismissal would be an escape hatch, which is the one thing it must not be. */
  /* Members the seat declined in a unit it opened bar the dismissal as a declined unit does. A member nobody
   * read is a location nobody read, and a representative's reading settles its members only on a shape ground (`rest`). */
  /* Members answered as opened and not opened, and units every row of which was, bar it the same way; and
   * `unreadable` bars it: a place the seat could not read is a place
   * nobody read. The one rule, here, for every reason a seat's reading gives; the plan's `budget` keeps its own (5b). */
  const unreadKinds = repositoryAnswerKinds + seatDeclinedKinds + unreadableKinds + notOpenedKinds;
  if (unreadKinds + declinedInOpened.size > 0 && input.verdict === "not_applicable") {
    const notOpenedAt = notReadRows
      .filter((r) => asText(r.reason) === "not_opened" && Array.isArray(r.locations))
      .flatMap((r) => (r.locations as unknown[]).filter((l): l is string => typeof l === "string"));
    add(
      "repository-answer-dismissal",
      `this verdict is \`not_applicable\` and ${unreadKinds} kind(s) of its candidate are not read ` +
        `(${repositoryAnswerKinds} \`repository_answer\`, ${seatDeclinedKinds} \`seat_declined\`, ${unreadableKinds} \`unreadable\`, ${notOpenedKinds} \`not_opened\`)` +
        (declinedInOpened.size > 0 ? `, and ${seatDeclinedMembers + notOpenedMembers} member(s) of ${declinedInOpened.size} kind(s) that were opened are not read (${seatDeclinedMembers} declined, ${notOpenedMembers} answered as opened and not opened)` : "") +
        ". A dismissal is a claim about every kind and every member, and places nobody opened cannot carry it: the verdict is " +
        "`needs_human` naming how many kinds and members were not read." +
        (notOpenedKinds + notOpenedMembers > 0
          ? " A place counts as opened only where your own Reads cover its line, or your payload's excerpt shows it and you read the payload whole; a line seen in a search result is not opened. " +
            (notOpenedAt.length > 0 ? `Not opened: ${notOpenedAt.slice(0, 12).join(", ")}${notOpenedAt.length > 12 ? ` and ${notOpenedAt.length - 12} more` : ""}. ` : "") +
            "Read the file around each and answer again, or decline them."
          : ""),
    );
  }

  /* 5b. The other outcome rule, and the sibling of the one above. Its one copy is
   * `budgetOutcomeProblem` (above this function). Like every rule of this function it is applied at capture too, while
   * the seat can still answer again (`recordCoverageGaps`). */
  const budgetProblem = budgetOutcomeProblem(input.verdict, budgetKinds);
  if (budgetProblem !== null) add("budget-outcome", budgetProblem);

  /* 6. Enumeration, and ONLY where the item is the matched word.
   *
   * **What this tests, said against P3's own words** (design section 11.2): P3 asks that "the item
   * set of the census equals the set of items with an entry or a quoted dismissal". What is tested
   * here is two things, and they are not the same sentence:
   *
   * (a) AN ENTRY IS AN `evidence[]` QUOTE THAT NAMES THE ITEM, at a token boundary — `quoteEnumerates`
   *     below. A quote naming `amplitude_notice` names `amplitude`, because `_` is not a letter or a
   *     digit; a quote naming `amplituden` does not. Until 2026-09-21 this was a
   *     bare `includes`, so a two-letter vendor token was "enumerated" by almost any quote — the
   *     loose form could only ADMIT a verdict this branch should refuse, never refuse a good one.
   *
   * (b) A QUOTED DISMISSAL IS AN OPENED KIND. Where every kind carrying the item was opened, the
   *     item is not reported even with no `evidence[]` entry, because each of those kinds is in
   *     `read[]` with its own verbatim quote and its own disposition — which is what "a quoted
   *     dismissal" is, in the trail rather than in `evidence[]`. P3 as written does not say that;
   *     it is this implementation's reading of it, stated here so that a verifier knows which half
   *     is theirs. The half no machine claims at all is the read-derived rule, below. */
  const declaredClass = readingClassOf(input.candidate);
  if (declaredClass?.item_source === "token") {
    const evidence = (input.evidence ?? []).map((e) => e.quote ?? "");
    const byToken = new Map<string, { kinds: string[]; members: number }>();
    for (const kind of census.kinds) {
      const token = kind.matched_token;
      if (!token) continue;
      const row = byToken.get(token) ?? { kinds: [], members: 0 };
      row.kinds.push(kind.id);
      row.members += kind.member_count;
      byToken.set(token, row);
    }
    for (const [token, row] of [...byToken.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const inEvidence = evidence.some((q) => quoteEnumerates(q, token));
      if (inEvidence) continue;
      const unreadKinds = row.kinds.filter((k) => !opened.has(k));
      if (unreadKinds.length === 0) continue;
      add(
        "enumeration",
        `the item ${JSON.stringify(token)} appears in ${row.kinds.length} kind(s) of this candidate's census and ${unreadKinds.length} ` +
          "of them were not opened, while no `evidence[]` entry quotes it. This rule's items ARE the matched word, so the census " +
          "carries the list before any model reads a line and the finding lists every one of them or quotes the dismissal.",
        unreadKinds[0],
      );
    }
  }

  /* 7. THE EVIDENCE REQUIREMENT — what a finding SHOWS, beside the trail that records what was read
   * (design section 2, E3 + E4 + E2; unit R1, 2026-09-22).
   *
   * This is the repair design section 11.2 pre-registered: "if P2a fails on a candidate, the reading
   * rule's `evidence[]` requirement (E3 + E4 + E2) is repaired before anything ships, and no
   * restatement on trail rows is admitted". P2a failed on 3 of 8 candidates in U4 — the three
   * largest carried 5, 7 and 5 entries where the record they replaced carried three to five times
   * that — so the requirement is made mechanical here rather than left to the seat's own sense of
   * how much to show.
   *
   * IT RUNS ONLY WHERE BOTH HALVES ARE PRESENT: the candidate carries a kind census (a verdict
   * without one returned above) and its rule declares a `reading_class`. Every other verdict is
   * unchanged and every record written before this existed stays valid against its own contract.
   *
   * WHAT IT DOES NOT DECIDE: nothing here reads a quotation, and nothing here says an element is
   * ANSWERED WELL. It says an element was answered at all — by a quote or by a recorded search whose
   * hits may be zero (a search that found nothing is an answer, an omission is not) — and
   * it counts premises. Whether the premise is the strongest kind, and whether the element's entry
   * says what the element asks, is the run's verifier's reading. */
  const declaredElements = declaredClass?.elements ?? [];
  if (declaredClass?.class) {
    const evidenceRows = input.evidence ?? [];
    /* THE SEARCHES THIS TRAIL RECORDS, by what they were for, with the largest hit count each one
     * reached. Read twice below: a search answers a declared element whether or not it found
     * anything, and a search that DID find something is what an `element` entry stands on
     * where the site it quotes is not a kind the seat opened. */
    const searchHits = new Map<string, number>();
    for (const raw of asArray(block.searched)) {
      const row = asRecord(raw);
      if (!row) continue;
      const forName = asText(row.for).trim();
      if (forName.length === 0) continue;
      searchHits.set(forName, Math.max(searchHits.get(forName) ?? 0, asInt(row.hits) ?? 0));
    }
    const elementNames = new Set(declaredElements.map((e) => e.name));
    const censusTokens = new Set(
      census.kinds.map((k) => (k.matched_token ?? "").toLowerCase()).filter((t) => t.length > 0),
    );

    /* WHERE AN `item` ENTRY MAY STAND. An item is one
     * member of the list an enumeration finding IS, so the location it quotes is one this
     * candidate's census holds for that item: a row of one of the item's kinds that the seat
     * opened, or a member of one of those kinds where the kind was settled without being opened.
     * Any disposition serves, because E2 admits a quoted dismissal as well as a listing, and a
     * `covered` or `not_read` row carries no location of its own to check against. */
    const atLine = atLineOf;
    const { all: censusLocations, byToken: censusLocationsByToken } = censusLocationsOf(census, readRows);

    /* THE AFFIRMATIVE ROWS OF THE TRAIL, read twice below. A `premise` says the construct is here
     * at all and a `site` says which location a declared element was found at, and both are tied to
     * a row THIS seat opened and disposed `is_the_construct` or `construct_but_gated`. */
    const strongRows = readRows.filter((r) => {
      const d = asText(r.disposition);
      return d === "is_the_construct" || d === "construct_but_gated";
    });
    const strongKinds = new Set(strongRows.map((r) => asText(r.kind)));
    const strongKeys = new Set(strongRows.map((r) => `${asText(r.file)}:${asText(r.lines)}`));

    /* THE RANGE A ROW COVERS. A read row records the lines it read as a
     * range, so an element or item entry may quote the middle or the last line of a row this seat
     * opened and disposed affirmatively (`standsOnRowOf`). */
    const standsOnStrong = standsOnRowOf(strongRows);

    /* THE TWO GROUNDS AN ENTRY MAY STAND ON, IN ONE PLACE. An
     * `element` entry, and an `item` entry of a rule whose items are not the matched word, stand on
     * the same two things: a location this seat's own trail disposed `is_the_construct` or
     * `construct_but_gated`, or a `reading.searched[]` row of this same trail whose `hits` are one
     * or more, named in the entry's `search`. The rule is written once because the two roles must
     * not drift apart, and the sentence it returns says WHICH of the two was looked for and what
     * was found instead. The location is matched on the row as written, on its first line number,
     * and on the range the row covers, so a row recorded as `3-5` and an entry quoting line 3, 4 or
     * 5 are the same place. */
    const groundFor = (entry: (typeof evidenceRows)[number]): { ok: boolean; key: string; said: string } => {
      const key = `${entry.file ?? ""}:${entry.lines ?? ""}`;
      const search = (entry.search ?? "").trim();
      const hits = search.length > 0 ? (searchHits.get(search) ?? null) : null;
      const affirmative = standsOnStrong(entry.file, entry.lines);
      const said =
        search.length === 0
          ? "carries no `search`"
          : hits === null
            ? `names the search ${JSON.stringify(search)} in \`search\`, and no \`reading.searched[]\` row of this trail is for that name`
            : `names the search ${JSON.stringify(search)} in \`search\`, which this trail records at ${hits} hit(s)`;
      return { ok: affirmative || (hits !== null && hits >= 1), key, said };
    };

    /* WHERE A `site` IS ADMITTED AT ALL.
     * A site is one location, so it belongs to the class whose unit of reading is the location: the
     * per-location class, and a mixed rule's per-location limbs. On the existence and enumeration
     * classes the unit is the kind and the trail already carries one row per kind, so a list of
     * places under `evidence[]` there is the restatement this requirement exists to refuse. */
    const perLocationLimb =
      declaredClass.class === "per-location" ||
      (declaredClass.class === "mixed" && (declaredClass.limbs ?? []).some((l) => l.class === "per-location"));

    /* (a) EVERY ENTRY SAYS WHAT IT IS FOR. The role is what makes the other two checks countable:
     * without it an entry is a quotation with no stated job, and a trail row restated in
     * `evidence[]` is indistinguishable from an element's answer. */
    for (const [index, entry] of evidenceRows.entries()) {
      const role = (entry.role ?? "").trim();
      const name = (entry.name ?? "").trim();
      const where = `\`evidence[${index}]\`${entry.file ? ` (${entry.file}:${entry.lines ?? ""})` : ""}`;
      if (!READING_EVIDENCE_ROLES.includes(role as ReadingEvidenceRole)) {
        add(
          "evidence-role",
          `${where} carries ${role ? `the role ${JSON.stringify(role)}` : "no `role`"}, and this candidate's rule declares a reading ` +
            `class, so every entry says what it is for: one of ${READING_EVIDENCE_ROLES.join(", ")}. Without it the finding cannot ` +
            "show which part of the duty each quotation answers, and a restated trail row cannot be told from an element's answer.",
        );
        continue;
      }
      if (role === "element" && !elementNames.has(name)) {
        add(
          "evidence-role",
          `${where} answers the element ${JSON.stringify(name)}, which this rule does not declare. The elements are the parts the ` +
            `rule's own question text walks (${declaredElements.length === 0 ? "this rule declares none" : [...elementNames].join(", ")}), and an ` +
            "entry naming anything else is either a site of one of them where the rule is read per location (role `site`), or evidence " +
            "of something the rule did not ask.",
        );
      }
      /* WHERE AN `element` ENTRY STANDS. The role was the door `site` had been: 70 trail rows
       * relabelled `element` passed at exit 0, 29 of them rows the same trail disposed
       * `not_the_construct`. An element's answer now quotes a location this seat opened and found,
       * or names the search that found it - and a search that found nothing found no site. */
      if (role === "element") {
        const ground = groundFor(entry);
        const { key, said } = ground;
        if (!ground.ok) {
          add(
            "evidence-role",
            `${where} answers the element ${JSON.stringify(name)} at ${JSON.stringify(key)}, and ${said}. An element's answer stands ` +
              "on one of two things: a location this seat's own trail disposed `is_the_construct` or `construct_but_gated`, or a " +
              "search this seat recorded with one hit or more, named in `search`. Neither is present, so the entry quotes a place " +
              "nobody in this record opened and nothing in this record found - which is the shape a restated trail row takes.",
          );
        }
      }
      if (role === "item") {
        /* WHICH ITEM, AND WHERE IT STANDS.
         * The two halves of an `item` entry are its name and its location, and
         * which check can see each half depends on where the rule's items come from.
         *
         * Where the items ARE the matched word (`item_source: "token"`, 6 of the 20 enumeration
         * rules), the census holds the whole item set before any model reads a line: the name is
         * checked against the census's tokens and the location against the lines the census carries
         * under that item, any disposition, because E2 admits a quoted dismissal as well as a
         * listing.
         *
         * Where they are NOT (`reading`, `clause`, `sub_shape` — the other 14), no census can tell
         * an item's name from an invented one, so the name check is silent and the per-name cap of
         * one bounds nothing: the third verifier copied all 70 rows of a real trail into
         * `evidence[]` as `{role: item, name: "member NNN"}` and the record passed at exit 0, 29 of
         * those rows being rows the same trail disposed `not_the_construct`. What the machine CAN
         * see there is the reading that found the item, so such an entry stands on the same two
         * grounds an `element` entry stands on: an affirmative row of this trail, or a search this
         * trail records with one hit or more. An item found by reading IS a found thing; a quoted
         * dismissal is for the rules whose item set the census holds. This refuses every
         * `not_the_construct` row and admits an affirmative row only as what it is — one item the
         * seat found — and it adds a condition without removing a path, so it can create no miss.
         * What no gate claims either way is that the LIST is complete (design section 2, E2). */
        const tokenItems = declaredClass.item_source === "token";
        if (name.length === 0) {
          add(
            "evidence-role",
            `${where} is offered as a list item and carries no \`name\`. An item is one member of the list this finding IS, and the ` +
              "name is which member it is: an unnamed one is a quotation with no stated job, which is the shape a restated trail row " +
              "takes, and one entry answers one item only where the entries can be told apart by name.",
          );
        } else if (tokenItems && !censusTokens.has(name.toLowerCase())) {
          add(
            "evidence-role",
            `${where} is offered as the list item ${JSON.stringify(name)}, and this rule's items ARE the matched word, so the census ` +
              "carries the whole item set before any model reads a line and no other string is an item of this candidate.",
          );
        }
        if (tokenItems) {
          const forItem = censusLocationsByToken.get(name.toLowerCase());
          const allowed = forItem ?? censusLocations;
          const itemKey = atLine(entry.file, entry.lines);
          if (!allowed.has(itemKey)) {
            add(
              "evidence-role",
              `${where} is offered as the list item ${JSON.stringify(name)} at ${JSON.stringify(itemKey)}, and this candidate's census holds ` +
                `no location there for ${forItem ? "that item" : "any of its kinds"}. An item is one member of the list this finding IS, so ` +
                "the line it quotes is a line the census carries under that item - the row the seat opened, or one of that kind's " +
                "members where the kind was settled without being opened. Any disposition serves: a quoted dismissal answers the item " +
                "as a listing does. A quotation from anywhere else is evidence of something, and not of this item.",
            );
          }
        } else {
          const ground = groundFor(entry);
          if (!ground.ok) {
            add(
              "evidence-role",
              `${where} is offered as the list item ${JSON.stringify(name)} at ${JSON.stringify(ground.key)}, and ${ground.said}. This rule's ` +
                `items are found by reading (\`item_source: ${JSON.stringify(declaredClass.item_source ?? "")}\`), so the census holds no name to ` +
                "check this one against, and what makes the entry an item is the reading that found it: a location this seat's own trail " +
                "disposed `is_the_construct` or `construct_but_gated`, or a search this seat recorded with one hit or more, named in " +
                "`search`. Neither is present, so the entry quotes a place nobody in this record opened and nothing in this record " +
                "found - which is the shape a restated trail row takes. A quoted dismissal answers an item where the census holds the " +
                "item set; here it is a row of the trail, and the trail already carries it.",
            );
          }
        }
      }
      /* THE THREE CONSTRAINTS ON `site`. Without them the role was an open door: the verifier of
       * 2026-09-22 relabelled 70 trail rows `site`, half of them unnamed, and the gate passed them.
       * A site now costs what it claims - one location, named, that this seat read and found. */
      if (role === "site") {
        if (!perLocationLimb) {
          add(
            "evidence-role",
            `${where} is offered as a \`site\`, and this rule is read as ${JSON.stringify(declaredClass.class)}, whose unit of reading is the ` +
              "kind. The trail already carries one quoted row per kind read, so a list of places under `evidence[]` here restates it " +
              "instead of adding to it. A site is admitted where the reading is per location; what a finding shows on this class is " +
              "its premises, its elements and its items.",
          );
          continue;
        }
        if (name.length === 0) {
          add(
            "evidence-role",
            `${where} is offered as a \`site\` and carries no \`name\`. A site says WHICH class of line or which route this location ` +
              "stands for, and an unnamed one is a quotation with no stated job - which is the shape a restated trail row takes.",
          );
        }
        const siteKey = `${entry.file ?? ""}:${entry.lines ?? ""}`;
        if (!strongKeys.has(siteKey)) {
          add(
            "evidence-role",
            `${where} is offered as a \`site\` at ${JSON.stringify(siteKey)}, and no \`read\` row of this trail was opened there and disposed ` +
              "`is_the_construct` or `construct_but_gated`. A per-location reading is per location: a site is a location this seat read " +
              "and judged affirmative, so a site the trail does not carry as such is a claim about a place nobody settled.",
          );
        }
      }
      /* `dismissal`: its constraints are `dismissalRoleGaps`, run at the top of this check. */
    }

    /* (a2) HOW MANY ENTRIES ONE NAME MAY CARRY. The
     * accountability conditions above say each quoted location was read or was found; the bounds
     * here say how many of them a finding shows. Without them an element name is an unbounded
     * channel: the same 70 trail rows that walked through `site` walked through `element`, each of
     * them standing on a row the trail disposed affirmatively would still have passed. Together with
     * the premise cap, a finding can quote at most 3 + 5 x (declared elements) + (items) locations,
     * which is what makes "no restatement" a count on every class. The item half of that count is a
     * number the machine holds only where the census holds the item set; where the items are found
     * by reading, what bounds them is the ground each entry stands on (
     * the branch above), one entry per name the seat gives. */
    const namesUnderRole = (wanted: string): Map<string, number> => {
      const counts = new Map<string, number>();
      for (const e of evidenceRows) {
        if ((e.role ?? "").trim() !== wanted) continue;
        const named = (e.name ?? "").trim();
        counts.set(named, (counts.get(named) ?? 0) + 1);
      }
      return counts;
    };
    for (const [named, count] of namesUnderRole("element")) {
      if (count <= READING_ELEMENT_ENTRY_CAP) continue;
      add(
        "element-restated",
        `\`evidence[]\` carries ${count} entries of role \`element\` named ${JSON.stringify(named)}, and the cap is ` +
          `${READING_ELEMENT_ENTRY_CAP}. One entry per site is the shape an element living in several places takes, and the rules' own ` +
          "instruction for how much a finding shows is \"the two or three strongest\"; past that the entries stop being the element's " +
          "answer and become the trail copied in under one name. Every location read is already in the trail with its own quotation " +
          "and its own disposition, and what a reader needs beyond the element is the trail itself.",
      );
    }
    for (const [named, count] of namesUnderRole("item")) {
      if (count <= READING_ITEM_ENTRY_CAP) continue;
      add(
        "evidence-role",
        `\`evidence[]\` carries ${count} entries of role \`item\` named ${JSON.stringify(named)}. One entry answers one item: the list ` +
          "an enumeration finding IS has each member in it once, and a second entry for the same member adds a quotation without " +
          "adding an item. Where the item is in several places, the places are in the trail.",
      );
    }

    /* (b) E3 — WHAT THE RULE ASKS PER ELEMENT IS ANSWERED PER ELEMENT. Several entries per element
     * are expected and allowed: where the construct lives in several places, each place is its own
     * entry. A recorded search answers an element as well as a quote does, and hits 0 is an answer. */
    for (const element of declaredElements) {
      const answeredByEntry = evidenceRows.some(
        (e) => (e.role ?? "").trim() === "element" && (e.name ?? "").trim() === element.name,
      );
      if (answeredByEntry || searchHits.has(element.name)) continue;
      add(
        "element-unanswered",
        `the rule walks the element ${JSON.stringify(element.name)}${element.question ? ` in its question ${element.question}` : ""} — ` +
          `${JSON.stringify(element.text ?? "")} — and this verdict carries neither an \`evidence[]\` entry of role \`element\` named for it ` +
          "nor a recorded search whose `for` is that name. A search that returned nothing answers it; silence does not.",
      );
    }

    /* (c) E4 — THE PREMISE IS QUOTED FROM THE STRONGEST KINDS THE SEAT READ, and never more than
     * three of them. `eu-dsr-001` Q2 and `eu-dsa-001` Q3 say it in their own words: "the two or
     * three strongest locations ... list the ones you are discarding with the reason". The discard
     * list is the trail, so the premise is the only place a trail row is restated on purpose, and
     * the cap is what stops the rest of the trail being copied in behind it.
     *
     * ONLY THE MINIMUM IS THE EXISTENCE CLASS'S. The location condition and the cap hold on every
     * class: both were inside the existence branch, so a premise on an enumeration
     * or per-location candidate was unbounded and quoted whatever it liked, and the sentence "a
     * trail row can enter `evidence[]` only as one of at most three premises" was false there for
     * the same reason it was false through `element`. What the existence class alone asks is that
     * there BE premises - the other classes show the construct through their items and their
     * sites. */
    const premises = evidenceRows.filter((e) => (e.role ?? "").trim() === "premise");
    const existenceLimb =
      declaredClass.class === "existence" ||
      (declaredClass.class === "mixed" && (declaredClass.limbs ?? []).some((l) => l.class === "existence"));
    if (existenceLimb) {
      const required = Math.min(2, strongKinds.size);
      if (premises.length < required) {
        add(
          "premise",
          `this candidate's rule is read as an existence question and ${strongKinds.size} kind(s) of its trail are disposed ` +
            `\`is_the_construct\` or \`construct_but_gated\`, while \`evidence[]\` carries ${premises.length} entry(ies) of role \`premise\`. ` +
            `The finding shows the premise from the strongest kinds it read — ${required} at least, three at most — not from the ` +
            "whole trail and not from none of it.",
        );
      }
    }
    for (const [index, entry] of premises.entries()) {
      const key = `${entry.file ?? ""}:${entry.lines ?? ""}`;
      if (strongKeys.has(key)) continue;
      add(
        "premise",
        `the premise entry ${index + 1} of \`evidence[]\` quotes ${JSON.stringify(key)}, and no \`read\` row of this trail was opened there ` +
          "and disposed `is_the_construct` or `construct_but_gated`. A premise is one of the kinds the seat actually read and " +
          "found to be the construct; a quotation from anywhere else is evidence of something, and not of this premise.",
      );
    }
    if (premises.length > READING_PREMISE_CAP) {
      add(
        "premise-restated",
        `\`evidence[]\` carries ${premises.length} entries of role \`premise\` and the rules' own instruction is "the two or three ` +
          `strongest locations", so ${READING_PREMISE_CAP} is the cap. Every kind read is already in the trail with its own quotation and its own ` +
          "disposition; restating more of it under `evidence[]` makes the finding look more evidenced without one line more being " +
          "read. What a reader needs beyond the premise is the elements and the items, and beyond those it is the trail itself.",
      );
    }
  }

  return gaps;
}

/* --------------------------------------------------------------------------------------------- *
 * The orchestrator's side: reading the seats' replies off disk and assembling one document.
 *
 * Kept here rather than in `index.ts` because it is the other half of one contract — what a seat
 * returns and what the CLI makes of it — and a reader who has to hold both should find them in one
 * file. Nothing below judges anything; it parses, matches and calls the pure functions above.
 * --------------------------------------------------------------------------------------------- */

/**
 * The shapes a reader's reply may take, and why two are accepted.
 *
 * A reader returns **a JSON array of disposition rows and nothing else** — no verdict word — which
 * is what the adjudicator brief in reading mode asks for (design section 10.2). A bare array carries
 * no candidate id, so the orchestrator's file name does: `<n>-<key>-r<k>.json`. An object carrying
 * `finding_id` and `dispositions` is accepted too and is the better shape where the orchestrator can
 * produce it, because it does not make a file name load-bearing. **Where neither says which
 * candidate a reply is for, THE UNIT IDS CANNOT**, because an id is a position in one candidate's own
 * census and `"3"` is a unit of every candidate that has four. So a reply that names no
 * `finding_id` is resolved by the FILE AND LINE its rows quote, which belongs to exactly one
 * candidate's locations, and a reply whose rows resolve to two candidates is refused, never split.
 */
export interface ReaderReply {
  source: string;
  finding_id: string;
  reader?: number;
  /** Unit U1: the seat whose place rows these are, kept as read when its verdict did not hold. */
  kept_from?: string;
  rows: ReadingReadRow[];
  /** The rows the reader answered as opened and did not open, as the capture recorded them. */
  unopened?: ReadingUnopenedRow[];
}

const readRowOf = (value: unknown): ReadingReadRow | null => {
  const row = asRecord(value);
  if (!row) return null;
  const kind = asText(row.kind);
  if (!kind) return null;
  return {
    kind,
    ...(asText(row.sub_shape) ? { sub_shape: asText(row.sub_shape) } : {}),
    file: asText(row.file),
    lines: asText(row.lines),
    quote: asText(row.quote),
    /* AS WRITTEN, "" WHEN ABSENT (fix-verify-shape R2, 2026-09-24). A missing disposition was
     * defaulted to "undetermined" here, one of the five, so the coverage check's `disposition` gap
     * never saw it: a row that disposed nothing read as a row that said "undetermined". Carried as
     * written, a missing or non-string value is the gap it is; `foldDispositions` still lists such a
     * row under undetermined, which is what the seat was handed before. */
    disposition: asText(row.disposition) as ReadingDisposition,
    ...(asText(row.ground) ? { ground: asText(row.ground) } : {}),
    /* Carried through only where it names one of the six (design section 3.5): a seat that writes
     * something else has not named a ground a cover may rest on, and the assembly writes none. The
     * coverage check reports the word the seat wrote, which is where a reader sees it. */
    ...(READING_COVER_GROUNDS.includes(asText(row.cover_ground) as ReadingCoverGround)
      ? { cover_ground: asText(row.cover_ground) as ReadingCoverGround }
      : {}),
    /* BUILD UNIT F4: a place row's own fields (F3) are carried as the capture wrote them, so the per-place table and the
     * fold (`place-fold.ts`) are written from the captured rows; a row of the older forms has none of them. */
    ...(isPlaceId(asText(row.place)) ? { place: asText(row.place) } : {}),
    ...(Array.isArray(row.data) ? { data: row.data.filter((d): d is string => typeof d === "string") } : {}),
    ...(asText(row.item) ? { item: asText(row.item) } : {}),
    ...(asRecord(row.beyond) && typeof asRecord(row.beyond)!.line === "number"
      ? { beyond: { file: asText(asRecord(row.beyond)!.file), line: asRecord(row.beyond)!.line as number, quote: asText(asRecord(row.beyond)!.quote) } }
      : {}),
    ...((READ_BASES as readonly string[]).includes(asText(row.read_basis)) ? { read_basis: asText(row.read_basis) as ReadBasis } : {}),
    ...(typeof row.line_declared === "number" ? { line_declared: row.line_declared } : {}),
    // Build unit F5: a place row's premises travel with it into the assembled block, whose `rests_on.places` they make.
    ...(asRecord(row.premises) ? { premises: row.premises as unknown as NonNullable<ReadingReadRow["premises"]> } : {}),
  };
};

const searchRowOf = (value: unknown): ReadingSearchRow | null => {
  const row = asRecord(value);
  if (!row) return null;
  const forWhat = asText(row.for);
  if (!forWhat) return null;
  /* Only the two words are taken. Anything else - a tool this vocabulary does not know, a seat's
   * prose - leaves the field absent, which is the grep replay and its refusal, never a guess. */
  const tool = asText(row.tool).trim().toLowerCase();
  return {
    for: forWhat,
    pattern: asText(row.pattern),
    ...(asText(row.paths) ? { paths: asText(row.paths) } : {}),
    hits: asInt(row.hits) ?? 0,
    ...(asText(row.hit_hash) ? { hit_hash: asText(row.hit_hash) } : {}),
    ...(tool === "grep" || tool === "glob" ? { tool: tool as ReadingSearchTool } : {}),
  };
};

/** Parse one reply document into rows, whichever of the two shapes it is written in. */
export function parseReaderReply(
  source: string,
  parsed: unknown,
  /** Which candidate a quoted line belongs to, by `file:start_line`. Built once by the caller. */
  candidateOfLine: (file: string, line: number) => string | null,
): { reply: ReaderReply | null; problem: string } {
  const rows: ReadingReadRow[] = [];
  const unopened: ReadingUnopenedRow[] = [];
  let declaredId = "";
  let reader: number | undefined;
  let keptFrom = "";
  if (Array.isArray(parsed)) {
    for (const row of parsed) {
      const parsedRow = readRowOf(row);
      if (parsedRow) rows.push(parsedRow);
    }
  } else {
    const obj = asRecord(parsed);
    if (!obj) return { reply: null, problem: "holds no reply object or array at all, so nothing in it was read" };
    declaredId = asText(obj.finding_id);
    reader = asInt(obj.reader) ?? undefined;
    keptFrom = asText(obj.kept_from);
    for (const row of asArray(obj.dispositions ?? obj.read ?? obj.rows)) {
      const parsedRow = readRowOf(row);
      if (parsedRow) rows.push(parsedRow);
    }
    for (const row of asArray(obj.unopened)) {
      const u = unopenedRowOf(row);
      if (u) unopened.push(u);
    }
  }
  if (rows.length === 0 && unopened.length === 0) return { reply: null, problem: "carries no disposition row this CLI could read" };
  if (declaredId) return { reply: { source, finding_id: declaredId, reader, ...(keptFrom ? { kept_from: keptFrom } : {}), rows, ...(unopened.length > 0 ? { unopened } : {}) }, problem: "" };

  const ids = new Set<string>();
  for (const row of rows) {
    const first = Number.parseInt(row.lines.split("-")[0] ?? "", 10);
    if (!row.file || !Number.isInteger(first)) continue;
    const id = candidateOfLine(row.file, first);
    if (id) ids.add(id);
  }
  if (ids.size === 1) return { reply: { source, finding_id: [...ids][0], reader, rows }, problem: "" };
  if (ids.size === 0) {
    return {
      reply: null,
      problem:
        "names no `finding_id`, and none of the lines its rows quote is a matched location of any candidate carrying a " +
        "census in the findings document given — so there is no candidate this reply can be attached to. Pass the document " +
        "the run was scanned with, and have the orchestrator write `finding_id` into the reply.",
    };
  }
  return {
    reply: null,
    problem:
      `names no \`finding_id\` and the lines its rows quote belong to ${ids.size} different candidates ` +
      `(${[...ids].sort().join(", ")}). A reply is one seat's reading of one candidate; this CLI will not split it between two.`,
  };
}

/**
 * WHICH PLANNED READERS OF A CANDIDATE RETURNED, as 0-based indices of the plan's `reader_slices`: a reply that names
 * its reader index is believed; one that does not is matched to the plan's slices by the kinds it disposed, which is a
 * fact about the reply rather than a guess about the file name. `replies` are the candidate's own. One copy, three
 * callers: the assembly below, the readers' fold (`readersAccountOf`) and, through
 * the assembly, the capture's budget rule.
 */
export function readersReturnedOf(plan: ReadingPlan | null, replies: ReaderReply[]): Set<number> {
  const returned = new Set<number>();
  for (const reply of replies) {
    if (reply.reader && reply.reader >= 1) {
      returned.add(reply.reader - 1);
      continue;
    }
    (plan?.reader_slices ?? []).forEach((slice, i) => {
      const held = new Set(slice);
      if (reply.rows.some((row) => held.has(row.kind))) returned.add(i);
    });
  }
  return returned;
}

/** A planned reader of a candidate whose reply is not on disk: which reader it is and the units it held that nobody read. */
export interface ReaderNotReturned {
  /** 1-based, as the launch list's `reader.index`. */
  reader: number;
  of: number;
  /** The units of its slice that are `not_read: budget` (a unit the plan itself leaves unread keeps the plan's reason). */
  units: string[];
}

/**
 * WHAT THE READERS' FOLD SAYS ABOUT THE READERS: how many were planned, how many
 * returned, and each one whose reply is not on disk (it did not return, or its answer was kept invalid) with the units
 * it held. Those units are `not_read: budget` in the reading block step 5a assembles, by `plannedNotRead` over the
 * readers `readersReturnedOf` finds, so the fold and the assembly cannot disagree. Null for a candidate with no readers.
 */
export function readersAccountOf(
  candidate: Candidate,
  replies: ReaderReply[],
): { planned: number; returned: number; not_returned: ReaderNotReturned[]; units_not_read: number } | null {
  const plan = readingPlanOf(candidate);
  if (!plan || plan.reader_slices.length === 0) return null;
  const returned = readersReturnedOf(
    plan,
    replies.filter((r) => r.finding_id === candidate.finding_id),
  );
  const planned = plannedNotRead(plan, [...returned]);
  const notReturned: ReaderNotReturned[] = [];
  plan.reader_slices.forEach((slice, i) => {
    if (returned.has(i)) return;
    notReturned.push({ reader: i + 1, of: plan.reader_slices.length, units: slice.filter((id) => planned.get(id) === "budget" || planned.get(id) === "not_answered") });
  });
  return {
    planned: plan.reader_slices.length,
    returned: plan.reader_slices.length - notReturned.length,
    not_returned: notReturned,
    units_not_read: notReturned.reduce((n, r) => n + r.units.length, 0),
  };
}

/** One assembled verdict: its block, what nobody accounted for, and where the reply came from. */
export interface AssembledVerdictReading {
  finding_id: string;
  rule_id: string;
  reading: VerdictReading;
  unaccounted: { kind: string; members: number; because: string }[];
  /** Rows the assembler could not attach to a census unit (M5). Their presence refuses the run. */
  refused: ReadingRowRefused[];
  /** `declined[]` entries the plan had already answered for. Reported, never silently ignored. */
  declined_unused: { kind: string; because: string }[];
  readers_planned: number;
  readers_returned: number;
}

/**
 * Assemble the `reading` block of every verdict whose candidate carries a census.
 *
 * **What it refuses to guess.** A planned reader whose reply is not on disk makes its kinds
 * `not_read: budget`, which is what the plan says about them. A kind handed to a reader that DID
 * reply and which came back with no row is left in `unaccounted`: no reason from the fixed list
 * describes it, the run is incomplete, and the caller is told rather than handed a record that reads
 * as complete.
 */
export function assembleReadingForVerdicts(args: {
  candidates: Candidate[];
  /** One entry per verdict seat reply: the candidate's id, its own rows, and its searches. */
  seats: { finding_id: string; rows: ReadingReadRow[]; searched: ReadingSearchRow[]; declined?: ReadingDeclinedRow[]; unopened?: ReadingUnopenedRow[] }[];
  replies: ReaderReply[];
}): AssembledVerdictReading[] {
  const byId = new Map(args.candidates.map((c) => [c.finding_id, c]));
  const out: AssembledVerdictReading[] = [];
  const ids = new Set<string>([...args.seats.map((s) => s.finding_id), ...args.replies.map((r) => r.finding_id)]);
  for (const id of [...ids].sort()) {
    const candidate = byId.get(id);
    if (!candidate || !kindCensusOf(candidate)) continue;
    const plan = readingPlanOf(candidate);
    const replies = args.replies.filter((r) => r.finding_id === id);
    const seat = args.seats.find((s) => s.finding_id === id);
    const returned = readersReturnedOf(plan, replies);
    const assembled = assembleReading({
      candidate,
      readerRows: replies.flatMap((r) => r.rows),
      readerSources: replies.flatMap((r) => r.rows.map(() => r.source)),
      readerReplyIndex: replies.flatMap((r, i) => r.rows.map(() => i)),
      seatRows: seat?.rows ?? [],
      searched: seat?.searched ?? [],
      declined: seat?.declined ?? [],
      unopened: [...replies.flatMap((r) => r.unopened ?? []), ...(seat?.unopened ?? [])],
      readersReturned: [...returned],
    });
    out.push({
      finding_id: id,
      rule_id: candidate.rule_id,
      reading: assembled.reading,
      unaccounted: assembled.unaccounted,
      refused: assembled.refused,
      declined_unused: assembled.declined_unused,
      readers_planned: plan?.reader_slices.length ?? 0,
      readers_returned: returned.size,
    });
  }
  return out;
}

const declinedRowOf = (value: unknown): ReadingDeclinedRow | null => {
  const row = asRecord(value);
  if (!row) return null;
  const kind = asText(row.kind);
  if (!kind) return null;
  // A member decline keeps what the seat's decision named ("rest" or member ids), as the capture wrote it.
  const members = row.members === "rest" ? ("rest" as const) : Array.isArray(row.members) ? row.members.filter((m): m is string => typeof m === "string") : undefined;
  return { kind, note: asText(row.note), ...(members !== undefined ? { members } : {}) };
};

/**
 * Why an entry of a verdict file cannot be attributed to a candidate, or "" when it can
 * (fix-verify-shape R1). `verdict-reading` assembles a seat's reading under the candidate its
 * `finding_id` names; an entry that is not an object, or names no candidate, has nowhere to go, and
 * the command reports it instead of passing over it.
 */
export function unattributedRecordProblem(record: unknown): string {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    const what = record === null ? "null" : Array.isArray(record) ? "a list" : `a ${typeof record}`;
    return `is ${what}, not a verdict object`;
  }
  const rec = record as Record<string, unknown>;
  const id = rec.finding_id;
  if (id === undefined) {
    // A reader's disposition row at the top level was never folded either: say where it belongs.
    return typeof rec.kind === "string" && typeof rec.disposition === "string"
      ? "carries no `finding_id`; it has the shape of a reader's disposition row, and a reader's reply is read only under readers/ or --readers"
      : "carries no `finding_id`";
  }
  if (typeof id !== "string" || id === "") return `carries \`finding_id\` ${JSON.stringify(id)}, which names no candidate`;
  return "";
}

/** The seat's own rows, searches and declinations, read off a verdict object the orchestrator wrote. */
export function seatRowsOfVerdict(verdict: unknown): {
  rows: ReadingReadRow[];
  searched: ReadingSearchRow[];
  declined: ReadingDeclinedRow[];
  unopened: ReadingUnopenedRow[];
} {
  const block = asRecord(asRecord(verdict)?.reading);
  if (!block) return { rows: [], searched: [], declined: [], unopened: [] };
  return {
    rows: asArray(block.read).map(readRowOf).filter((r): r is ReadingReadRow => r !== null),
    searched: asArray(block.searched).map(searchRowOf).filter((r): r is ReadingSearchRow => r !== null),
    declined: asArray(block.declined).map(declinedRowOf).filter((r): r is ReadingDeclinedRow => r !== null),
    unopened: asArray(block.unopened).map(unopenedRowOf).filter((r): r is ReadingUnopenedRow => r !== null),
  };
}

/** One `unopened` row as the capture wrote it; null where it is not one. */
export function unopenedRowOf(value: unknown): ReadingUnopenedRow | null {
  const row = asRecord(value);
  if (!row) return null;
  const kind = asText(row.kind);
  const file = asText(row.file);
  const lines = asText(row.lines);
  const member = asText(row.member);
  if (!kind || !file || !lines || !member) return null;
  return { kind, ...(typeof row.sub_shape === "string" ? { sub_shape: row.sub_shape } : {}), file, lines, member };
}

/** What a verdict seat is handed for one candidate: the bounded catalogue and the readers' fold. */
export function seatInputsFor(args: {
  candidate: Candidate;
  readerRows: ReadingReadRow[];
}): { catalogue: ReadingCatalogueSummary; fold: DispositionFold } | null {
  const census = kindCensusOf(args.candidate);
  if (!census) return null;
  return { catalogue: catalogueSummary(census), fold: foldDispositions(args.readerRows, census) };
}

/**
 * THE PLACES ONE FINDING'S RECORD SAYS NO REVIEW READ (moved here from assemble-report.ts so that the
 * later run's partition can name them without importing the report; a place that was not read
 * must never look read or clean). Every `not_read` row of the record's reading block, whatever its reason: a unit
 * nobody opened (its census members, wherever the census lists them) and the members a review declined in a unit it
 * opened (the row's own `locations`). `places` is the rows' own count, as the reading line counts them;
 * a row counting more places than it or the census locates adds to `unlisted`, so a count is never shrunk to what can be
 * located. Null where the record names no unread place.
 *
 * `locateUnits: false` locates no whole-unit row through `candidate`'s census, and counts its places as `unlisted`: the
 * later run's partition passes it when the census the record was written against is not this candidate's (a unit id
 * would then name another unit's members), so a place is never located where it may not be.
 */
export interface NotCheckedPlaces {
  places: number;
  /** Per reason, in the order the record first gives it: how many places, and the review's own sentences. */
  reasons: { reason: string; places: number; notes: string[] }[];
  /** Every located place, by file (sorted), each file's lines ascending and distinct. */
  files: { file: string; lines: number[] }[];
  unlisted: number;
}

const ncObj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const ncOneLine = (s: string, max: number): string => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

export function notCheckedOf(
  candidate: Record<string, unknown> | undefined,
  reading: Record<string, unknown> | undefined,
  options: { locateUnits?: boolean } = {},
): NotCheckedPlaces | null {
  if (!candidate || !reading) return null;
  const rows = (Array.isArray(reading.not_read) ? reading.not_read : []).map(ncObj).filter((r): r is Record<string, unknown> => !!r);
  if (rows.length === 0) return null;
  let census: ReadingCensus | null = null;
  try {
    census = options.locateUnits === false ? null : readingUnitsCensusOf(candidate as unknown as Candidate);
  } catch {
    census = null;
  }
  const units = new Map((census?.kinds ?? []).map((k) => [k.id, k] as const));
  const reasons = new Map<string, { reason: string; places: number; notes: string[] }>();
  const byFile = new Map<string, Set<number>>();
  let places = 0;
  let unlisted = 0;
  for (const row of rows) {
    const count = Array.isArray(row.members) ? row.members.length : Math.max(0, Number(row.members ?? 0) || 0);
    const where: { file: string; line: number }[] = [];
    if (Array.isArray(row.locations)) {
      for (const l of row.locations.map(asText)) {
        const at = l.lastIndexOf(":");
        if (at > 0) where.push({ file: l.slice(0, at), line: Number.parseInt(l.slice(at + 1), 10) });
      }
    } else {
      const kind = asText(row.kind);
      const unit = units.get(kind) ?? units.get(kind.split("/")[0] ?? "");
      for (const m of unit?.members ?? []) where.push({ file: asText(m.file), line: Number(m.start_line) });
    }
    const located = where.filter((w) => w.file && Number.isFinite(w.line));
    for (const w of located) {
      const set = byFile.get(w.file) ?? new Set<number>();
      set.add(w.line);
      byFile.set(w.file, set);
    }
    places += count;
    unlisted += Math.max(0, count - located.length);
    const reason = asText(row.reason) || "(no reason given)";
    const r = reasons.get(reason) ?? { reason, places: 0, notes: [] };
    r.places += count;
    const note = ncOneLine(asText(row.note), 200);
    if (note && !r.notes.includes(note)) r.notes.push(note);
    reasons.set(reason, r);
  }
  if (places === 0 && byFile.size === 0) return null;
  const files = [...byFile.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([file, lines]) => ({ file, lines: [...lines].sort((x, y) => x - y) }));
  return { places, reasons: [...reasons.values()], files, unlisted };
}

/** Every located place of a `NotCheckedPlaces`, as `file:line`, in its file-then-line order. */
export function notCheckedLocations(nc: NotCheckedPlaces): string[] {
  return nc.files.flatMap((f) => f.lines.map((line) => `${f.file}:${line}`));
}

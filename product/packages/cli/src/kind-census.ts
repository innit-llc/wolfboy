/**
 * THE KIND CENSUS AND THE READING PLAN — what layer 2 is asked to read when a candidate is too big.
 *
 * A candidate carrying more matched locations than one seat reads used to be cut into parts of 70
 * (`splitOversizedGroups` in scan.ts), one agent per part, one verdict per part. The parts of one
 * question disagreed with each other on 11 of the 38 split candidates that were ever fully
 * adjudicated, the biggest questions in the corpus cost hundreds of agents each, and 95 % of the
 * locations reached no record at all. The design annex
 * an internal record replaces the cut: layer 1 groups the
 * candidate's locations into SAME-KIND LINE GROUPS, deterministically and with no model, and layer 2
 * reads one representative per group. The question is never divided; the 70 becomes a bound on what
 * one seat READS.
 *
 * This file does two things and decides nothing else:
 *
 *  - `computeKindCensus` — the catalogue. Every location of the candidate belongs to exactly one
 *    kind, every kind names its members, and nothing is dropped, merged across rules or reordered
 *    except into path-then-line order, which is the order the split already used.
 *  - `planReading` — the place plan: every matched location is a place, every place is read, and
 *    a candidate larger than one seat is spread over consecutive place seats. It launches nothing.
 *
 * **Nothing here removes a location.** `locations[]` stays complete and the census points into it by
 * index; a narrowing hidden in packaging is the one thing this change may not do (and
 * "subtraction is the only operation that can create a miss").
 *
 * The key itself is `kind-key.ts`, which is the port of the normaliser the 806 recorded cells of
 * cell digests were counted with; a test holds this file's
 * grouping to those counts.
 */
import type {
  Candidate,
  FindingLocation,
  KindCensus,
  KindGroup,
  ReaderSlice,
  ReadingClass,
  ReadingPlan,
} from "wolfboy-schemas";
import { kindKey, type ContextClass, CONTEXT_CLASSES } from "./kind-key.js";

export type { KindCensus, KindGroup, ReaderSlice, ReadingClass, ReadingPlan };

/**
 * The version of the catalogue's shape, written into every census so a reader knows what it holds.
 *
 * `level: "L2"` is the clustering level of an internal record — rule,
 * fired clause set, folded matched token, syntactic context class — and it is recorded beside the
 * spec because a census taken at another level would answer a different question.
 */
export const KIND_CENSUS_SPEC = "kind-census-1";
export const READING_PLAN_SPEC = "reading-plan-2";

/**
 * How many sub-shapes of one kind are LISTED. Never a silent cap: `sub_shape_count` on the same row
 * is the true total, and the ones not listed are the smallest.
 *
 * The sub-shape is the whole line with everything outside the matched spans folded, and it is what
 * says how homogeneous a kind is — three of a large Node CMS's twenty largest kinds merge constructs an
 * adjudicator must see separately (measurement.md §5). A seat needs the large ones and the count;
 * listing every one of them would put one row per location back into the document, which is the
 * cost the census exists to remove.
 */
export const SUB_SHAPES_LISTED_PER_KIND = 20;



/**
 * Where this candidate's reading class came from — `ReadingPlan.class_source` in the document.
 *
 * Two values since the §4.2 table was deleted at integration: `rule` (the compiled rule declares
 * `reading_class`) and `default-per-location` (it declares none, so the candidate is read line by
 * line). The second is not dead: `rule.schema.json` leaves `reading_class` optional and
 * `tools/build-bundle.mjs` validates it only where it is present, so a pack that adds a project rule
 * without the field still reaches that branch, and a `per-location` plan would otherwise not say
 * whether the class was declared or defaulted.
 */
export type ReadingClassSource = ReadingPlan["class_source"];


/**
 * THE EXISTENCE-CLASS READING ORDER — code shapes first, prose and catalogues last.
 *
 * An existence-class candidate above the slack band is read by one seat, which opens the units this
 * order puts first; so the order decides what the premise rests on. A locale catalogue must not
 * crowd the one migration out of the 70, which is the whole reason it is not simply "largest first".
 *
 * Exactly the seventeen classes `kind-key.ts` can return, in the annex's §3.4 order — a total
 * partition with nothing invented and nothing left out. `CONTEXT_CLASS_RANK` below is derived from
 * this array rather than written twice, and the assertion beneath it is what keeps the two lists the
 * same list if a class is ever added.
 */
export const E_CLASS_ORDER: readonly ContextClass[] = [
  "sql",
  "declaration",
  "call",
  "object-key-or-param",
  "member-access",
  "identifier-use",
  "config-entry",
  "translation-entry",
  "string-literal",
  "html-attribute",
  "import-specifier",
  "prose-doc",
  "comment",
  "css-declaration",
  "manifest-entry",
  "lockfile-entry",
  "other",
];

const CONTEXT_CLASS_RANK: ReadonlyMap<string, number> = new Map(E_CLASS_ORDER.map((c, i) => [c, i]));

/**
 * The reading order and the class list are the same seventeen classes, and this says so out loud
 * rather than leaving it to inspection: a class added to `kind-key.ts` and forgotten here would sort
 * to the end of every existence-class plan silently, and the kind it labels would be the one a seat
 * never reaches.
 */
export function assertContextClassesCovered(): void {
  const missing = CONTEXT_CLASSES.filter((c) => !CONTEXT_CLASS_RANK.has(c));
  const extra = E_CLASS_ORDER.filter((c) => !CONTEXT_CLASSES.includes(c));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `kind-census: the existence-class reading order and the context classes have drifted. ` +
        `In kind-key.ts but not in the order: ${missing.join(", ") || "(none)"}. ` +
        `In the order but not in kind-key.ts: ${extra.join(", ") || "(none)"}. ` +
        `Nothing was planned. Add the class to E_CLASS_ORDER deliberately — a class that is not in ` +
        `it sorts behind every other and is what a seat never reaches.`,
    );
  }
}

/** The first three path segments — the directory grain `cell-digest.mjs` counts by. */
function directoryOfPath(file: string): string {
  return file.split("/").slice(0, 3).join("/");
}

/**
 * Order locations by path, then by line — `byPathThenLine` in scan.ts, kept in step with it because
 * the census's member indices are indices into a candidate whose locations are in this order.
 */
function byPathThenLine(a: FindingLocation, b: FindingLocation): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.start_line - b.start_line;
}

/**
 * THE CATALOGUE of one candidate: every location in exactly one same-kind line group.
 *
 * `locations` must already be in path-then-line order (the caller sorts, exactly as the split did),
 * and every location must carry the kind facts the matcher wrote. A location without them is a
 * defect in the scan, not a kind of its own: the census refuses rather than inventing a group, so a
 * silent half-census cannot exist.
 *
 * **Never across, and the seven conditions of an internal record
 * are how that is held:** (1) rules — the key carries the rule id and this function is called per
 * candidate, and a candidate is one rule; (2) fired clause sets — in the key; (3)
 * `unanswered_preconditions` / `depends_on_applicability` — per candidate, so two candidates cannot
 * merge; (4) locations whose evidence is not the line — `joined_from`, `resolved_from`,
 * `also_opens_at`, `end_line` each make the location its own kind, below; (5) locations corroborated
 * from a different file — the same, by `corroborated_from.file`; (6) held and suppressed candidates
 * — they are not in `locations[]` at all, and the census reads nothing else; (7) `group_part`
 * siblings — a candidate with a census has no parts, and with the census off there is no census, so
 * the two never meet on one candidate.
 *
 * **`corroborated_in_project` IS NOT IN THAT LIST AND MUST NOT JOIN IT** (unit C3, 2026-09-22). At
 * project scope the annotation is ONE fact about the whole scan — identical on every location that
 * carries it, evidence line included, because `mergeShards` holds at most one corroborator record
 * per rule per scan — and the fired clause set is already in the key (`kind-key.ts`), so every
 * member of a bin fired the same clauses and therefore took the same subject decision and therefore
 * carries the same annotation. It cannot split a bin, and a representative cannot carry a mark its
 * bin-mates lack, which IS the condition (4)/(5) test. `corroborated_from` is a different case and
 * stays a singleton: it names a file THIS location's evidence is in, and another location of the
 * same bin need not have its evidence in that file or in any other.
 */
export function computeKindCensus(candidate: Candidate, bound: number): KindCensus {
  const locations = candidate.locations;
  interface Acc {
    key: string;
    own_evidence: boolean;
    clause: string;
    matched_token: string;
    context_class: ContextClass;
    members: number[];
    files: Set<string>;
    dirs: Set<string>;
    subs: Map<string, { members: number; first: number }>;
  }
  const byKey = new Map<string, Acc>();
  for (let i = 0; i < locations.length; i++) {
    const loc = locations[i];
    const facts = loc.clause === undefined || loc.matched_token === undefined || loc.context_class === undefined
      ? null
      : { clause: loc.clause, matched_token: loc.matched_token, context_class: loc.context_class as ContextClass };
    if (facts === null) {
      throw new Error(
        `kind-census: ${candidate.rule_id} ${loc.file}:${loc.start_line} carries no kind facts, so its ` +
          `same-kind line group cannot be named. Nothing was grouped. A census is computed only on a ` +
          `document scanned with the kind census ON, and every location of such a document carries ` +
          `\`clause\`, \`matched_token\` and \`context_class\`.`,
      );
    }
    // CONDITION (4) AND (5), and they are singletons rather than a wider key on purpose. A location
    // whose evidence is NOT the line it names — a value hop, a fold, an absorbed enclosing
    // construct, a span, a corroboration from another file — cannot be read off any other
    // location's representative, because what makes it a candidate is not on the representative's
    // line. Such a location is its own kind, so a seat opens it itself.
    const singleton =
      loc.resolved_from !== undefined ||
      loc.joined_from !== undefined ||
      loc.also_opens_at !== undefined ||
      loc.end_line !== undefined ||
      loc.corroborated_from !== undefined;
    const key = kindKey(candidate.rule_id, { ...facts, sub_shape: "" });
    const bucket = singleton ? `${key}\u0000own:${i}` : key;
    let acc = byKey.get(bucket);
    if (acc === undefined) {
      acc = {
        key,
        own_evidence: singleton,
        clause: facts.clause,
        matched_token: facts.matched_token,
        context_class: facts.context_class,
        members: [],
        files: new Set(),
        dirs: new Set(),
        subs: new Map(),
      };
      byKey.set(bucket, acc);
    }
    acc.members.push(i);
    acc.files.add(loc.file);
    acc.dirs.add(directoryOfPath(loc.file));
    const sub = loc.sub_shape ?? "";
    const s = acc.subs.get(sub);
    if (s === undefined) acc.subs.set(sub, { members: 1, first: i });
    else s.members++;
  }
  // Ordered by key, which is the order `(rule_id, key)` reduces to inside one candidate. Members are
  // already ascending because the loop above walks the locations in order, and the locations are in
  // path-then-line order, so `members[0]` IS the first member in that order.
  const groups: KindGroup[] = [...byKey.values()]
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.members[0] - b.members[0]))
    .map((a) => {
      const rep = a.members[0];
      const subs = [...a.subs.entries()]
        .sort((x, y) => y[1].members - x[1].members || (x[0] < y[0] ? -1 : 1))
        .slice(0, SUB_SHAPES_LISTED_PER_KIND)
        .map(([sub_shape, v]) => ({ sub_shape, members: v.members, first: v.first }));
      return {
        key: a.key,
        ...(a.own_evidence ? { own_evidence: true as const } : {}),
        clause: a.clause,
        matched_token: a.matched_token,
        context_class: a.context_class,
        member_count: a.members.length,
        members: a.members,
        representative: { index: rep, file: locations[rep].file, start_line: locations[rep].start_line },
        files: a.files.size,
        directories: a.dirs.size,
        sub_shape_count: a.subs.size,
        sub_shapes: subs,
      };
    });
  return {
    spec: KIND_CENSUS_SPEC,
    level: "L2",
    bound,
    kinds_total: groups.length,
    kinds_at_key: new Set(groups.map((g) => g.key)).size,
    locations_total: locations.length,
    sub_shapes_listed_per_kind: SUB_SHAPES_LISTED_PER_KIND,
    groups,
  };
}

/**
 * The four reading classes, as a set, so that a value read off a rule can be checked before it is
 * believed. A rule that declares something else is read from the table instead of crashing a scan:
 * `rule.schema.json` is where a malformed value is caught (unit U3), not here.
 */
export const READING_CLASSES: ReadonlySet<string> = new Set<ReadingClass>([
  "existence",
  "enumeration",
  "per-location",
  "mixed",
]);

/**
 * The class a rule declares on itself, or `undefined` where it declares none. The field is an
 * object (`{ class, item?, item_source?, limbs? }`, annex §10.6) and only its `class` decides the
 * reading unit, so this reads that one member and ignores the rest.
 */
export function declaredReadingClassOf(rule: unknown): ReadingClass | undefined {
  const declared = (rule as { reading_class?: { class?: unknown } } | null)?.reading_class?.class;
  return typeof declared === "string" && READING_CLASSES.has(declared)
    ? (declared as ReadingClass)
    : undefined;
}

/**
 * The reading class of a rule: the compiled rule's own `reading_class.class`, and nothing else.
 *
 * The scanner's embedded copy of annex §4.2 was deleted at integration with unit U3, which puts the
 * field on the 55 project rules themselves, so the rule is now the single original. `ruleId` is kept
 * in the signature because the caller identifies the rule it is planning for and a future refusal
 * needs to name it, not because any table is consulted.
 */
export function readingClassOf(
  ruleId: string,
  declared?: ReadingClass,
): { reading_class: ReadingClass; class_source: ReadingClassSource } {
  void ruleId;
  if (declared !== undefined) return { reading_class: declared, class_source: "rule" };
  // A rule with no declared class is read as per-location — every location is a reading unit, which
  // is today's behaviour for that rule and can only read more, never less (annex §3.3).
  return { reading_class: "per-location", class_source: "default-per-location" };
}

/**
 * THE PLACE PLAN — which places each seat reads.
 *
 * **Every matched location is a place, and every place is read**, whatever the rule's reading class. The class decides
 * how the candidate is ANSWERED (one answer for the installation, an enumeration, one per line), never what is read.
 * The kind census (`computeKindCensus`) stays as a label and an order for the person's report and for the payload
 * writer; it no longer decides what a seat opens. So this plan has no tail declared not read (`repository_answer`),
 * no slack rule and no extra readers: those were ways to read less than every place, and the 2026-10-01 decision
 * removed them (design section 6.1 "What is removed"). `reading-plan-1` documents that carry them keep parsing.
 *
 * `cap` is the seat's place bound (`MAX_PLACES_PER_SEAT` in scan.ts, 105). A candidate at or under it is read whole by
 * its one seat, which also answers it. A candidate over it is spread over consecutive PLACE SEATS (`reader_slices`,
 * the field name `reading-plan-1` gave them) that together hold every place exactly once, and it is answered once by
 * the seat after them. Places run in path-then-line order (the order `locations[]` is sorted in), and a seat closes at
 * a FILE BOUNDARY wherever the next file fits in a seat of its own: a file's windows are cut across seats only where
 * the file alone holds more places than a seat (design 1.4). The byte bound (220,000 bytes a seat) is applied where
 * the bytes exist, by the payload writer.
 *
 * `files[i]` is the file of the place at position `i` of the order. Where it is not given, seats are cut every `cap`
 * places, which reads exactly as much.
 */
export function planReading(
  census: KindCensus | null,
  locationCount: number,
  ruleId: string,
  cap: number,
  declared?: ReadingClass,
  files?: readonly string[],
): ReadingPlan {
  assertContextClassesCovered();
  void census;
  if (!Number.isInteger(cap) || cap < 1) throw new Error(`planReading: the seat's place bound must be a whole number of at least 1, got ${cap}`);
  const { reading_class, class_source } = readingClassOf(ruleId, declared);
  const units = locationCount;
  const order = Array.from({ length: units }, (_, i) => i);
  const slices = units > cap ? placeSeats(units, cap, files) : [];
  return {
    spec: READING_PLAN_SPEC,
    reading_class,
    class_source,
    unit: "place",
    cap,
    order,
    // With place seats, the seat that answers reads their rows and opens no place itself; without them it is the only
    // seat and reads every place the candidate has.
    read_by_seat: slices.length > 0 ? 0 : units,
    reader_slices: slices,
  };
}

/**
 * Cut `units` places into consecutive seats of at most `cap` places, closing a seat at a file boundary wherever the
 * next file fits in a seat of its own (design 1.4). Every place is in exactly one seat: the seats are consecutive,
 * disjoint, in order and cover every place from the first to the last, which a test checks on every plan it builds.
 */
export function placeSeats(units: number, cap: number, files?: readonly string[]): ReaderSlice[] {
  const runs: number[] = [];
  if (files && files.length === units) {
    for (let i = 0; i < units; ) {
      let j = i + 1;
      while (j < units && files[j] === files[i]) j++;
      runs.push(j - i);
      i = j;
    }
  } else {
    for (let i = 0; i < units; i += cap) runs.push(Math.min(cap, units - i));
  }
  const slices: ReaderSlice[] = [];
  let from = 0;
  let held = 0;
  const close = (): void => {
    if (held === 0) return;
    slices.push({ reader: slices.length + 1, from, to: from + held - 1 });
    from += held;
    held = 0;
  };
  for (let run of runs) {
    if (held + run <= cap) {
      held += run;
      continue;
    }
    // The file does not fit beside what the open seat holds: the seat closes here, at the file boundary.
    close();
    // A file larger than a seat on its own is the one case cut across seats (in path-then-line order); its last part
    // stays open, so the next file may join it.
    while (run > cap) {
      held = cap;
      close();
      run -= cap;
    }
    held = run;
  }
  close();
  return slices;
}

/**
 * The existence-class order: code shapes first, then prose and catalogues; within one class, the
 * kinds with the most members first; ties broken by the key, which is a total order.
 */
export function existenceOrder(census: KindCensus): number[] {
  return census.groups
    .map((g, i) => ({ i, rank: CONTEXT_CLASS_RANK.get(g.context_class) ?? E_CLASS_ORDER.length, g }))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        b.g.member_count - a.g.member_count ||
        (a.g.key < b.g.key ? -1 : a.g.key > b.g.key ? 1 : 0),
    )
    .map((x) => x.i);
}

/** How many reading units this candidate has — what a bin's bound is counted in from now on. */
export function readingUnitsOf(plan: ReadingPlan, census: KindCensus | null, locationCount: number): number {
  return plan.unit === "kind" ? (census?.kinds_total ?? locationCount) : locationCount;
}

/** Order a candidate's locations the way the census indexes them. Exported for the gate. */
export function sortLocationsForCensus(locations: FindingLocation[]): FindingLocation[] {
  return [...locations].sort(byPathThenLine);
}

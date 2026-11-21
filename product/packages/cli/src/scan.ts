import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Candidate,
  CensusResult,
  CensusStoppedFile,
  DeclaredVendorWithoutCandidate,
  DependencyInventoryEntry,
  Findings,
  FindingLocation,
  PartiallyReadFile,
  Rule,
  RuleWithoutCandidates,
  ScanProfile,
  ScopeAssessmentRecord,
} from "wolfboy-schemas";
import type { LoadedBundle } from "./bundle.js";
import {
  runBuiltin,
  declaresGateScope,
  type EngineResult,
  declaresJoinedView,
  directoryOf,
  fingerprint,
  groupPartFingerprint,
  preconditionsMet,
  preconditionStatus,
  type GuardScope,
  productCredentials,
  productPrintedRedaction,
} from "./engine.js";
import { dependencyInventoryOf, readScopeAndWalk, runCensusPass, type WalkedTree } from "./orientation-inputs.js";
import {
  computeKindCensus,
  declaredReadingClassOf,
  planReading,
  // Aliased at integration: `reading.ts` exports a `readingUnitsOf` of its own, which answers the
  // same question one level up — this one takes a plan, a census and a location count, that one
  // takes the candidate and reads the number this scanner already wrote on it. Producer and
  // consumer, not two copies.
  readingUnitsOf as readingUnitsOfPlan,
  type KindCensus,
  type ReadingClass,
  type ReadingPlan,
} from "./kind-census.js";
import { loadScanProfile, type LoadedScanProfile } from "./profile.js";
import { assessScope, codeMaySettle, limbIsOpen, settledByCode } from "./scope.js";
import { perRuleApplicability, type ScopeSettlement } from "./per-rule-applicability.js";
import { alternation, RECIPIENT_LIST_KIND, type ListMatching } from "./vocabulary.js";
import { kindCensusOf, readingUnitsOf } from "./reading.js";
import { DEFAULT_SEAT_MODEL, seatModelsOf, type SeatModel } from "./seat-model.js";
import { redactEvidenceValues, redactedLabelsOf, valueFreeText } from "./credential-redaction.js";
import { sha16 } from "./kind-key.js";
import { lineKeyOf } from "./place-key.js";
import { jobsForWalk, runCensusInWorker, runShardedBuiltin, type ResolvedJobs } from "./engine-pool.js";
import type { ScanProgress } from "./progress.js";
import { MAX_FILE_BYTES, MINIFIED_LINE_LIMIT } from "./walk.js";
import { COVERAGE_LIMITS_HEADING, coverageLimits, isOwnWorkingFolder, readScopeFor } from "./read-scope.js";
import {
  applicabilityByInstrument,
  candidateListLines,
  candidateTopics,
  checklistBlockHeader,
  checklistsGovernedLine,
} from "./report.js";
import { shipsPremisesForCandidates } from "./ships-premise.js";

import { reviewDeclarationCommand } from "./declaration.js";
/** The CRA gate's product limb, for the line on what the code shows. */
const PRODUCT_LIMB = "is-a-product-with-digital-elements";
/** A web manifest or service worker (census.ts). */
const WEB_CLIENT_KIND = "installable_web_client";
/** A declared dependency (census.ts): names a library, shows no call. */
const DEPENDENCY_KIND = "dependency";
/** What a web manifest or service worker is, under the CRA (the Commission's guidance, paragraphs 20 and 21). */
const WEB_CLIENT_WORDS = "a web manifest or service worker: an installable client if users install it to run on their side, not a product if it is used only in the browser (the Commission's CRA guidance, paragraphs 20 and 21) - only you can confirm which";


export interface ScanOptions {
  bundle: LoadedBundle;
  targetRoot: string;
  files?: string[]; // when set, skip the directory walk and scan exactly these (fixture tests)
  scope?: GuardScope;
  profilePath?: string;
  /**
   * The scope answers of the program's confirmed record that put rules
   * out of scope (declaration.ts `scopeSettlementsOf`), handed in by the scan command only where `profilePath` is that
   * declaration. Absent (every other caller, a `--profile` of another file) settles nothing.
   */
  scopeSettlements?: ScopeSettlement[];
  /**
   * Fields of `profilePath` read as unanswered
   * (declaration.ts `staleOrderFields`), handed in by the scan command only where `profilePath` is the program's
   * declaration; the pre-launch step leaves out the same, so the profile's digest agrees.
   */
  profileLeftOut?: readonly string[];
  /** Walk `test/`, `spec/`, `fixtures/` and their siblings; see WalkOptions. */
  includeNonProduction?: boolean;
  /**
   * False leaves `ships_premises` out of the document (every file is then
   * `unknown`, which ships). Default on. It exists so a test can hold the candidates byte-identical with and without the
   * premise: the premise is computed after the candidates are final and reads only their location paths.
   */
  shipsPremise?: boolean;
  /**
   * The classes of `rules/path-exclusions/` this run was told to READ — `--read`.
   * Absent or empty means the product default: test surfaces, vendored code and build
   * output are not read, and `coverage_limits` says how much was held back and how to open it.
   *
   * It is a set of class NAMES rather than compiled patterns because the patterns belong to the
   * bundle: `opts.bundle.readScope` carries them, resolved at build time out of the three files, so
   * this option only ever answers "which of the classes the bundle declares did the person ask for".
   */
  read?: Set<string>;
  /**
   * The per-file wall-clock budget in milliseconds (`--file-budget`), or `Infinity` for none.
   *
   * ABSENT MEANS NO BUDGET, and the `scan` command is what supplies 60 seconds — see `scanShard` in
   * engine.ts for why the default sits there and not here. Every caller of `runScan` that is not
   * that command is a gate or a harness whose contract is that its output is a function of its
   * input, and a wall-clock ceiling inside one of those would make it depend on the machine.
   */
  fileBudgetMs?: number;
  /**
   * The step-5 progress display, or absent — which is every caller but the `scan` command with
   * `--progress` resolved ON. It is told about the walk once and about each file as its record is
   * finished, and it writes to STDERR ONLY (progress.ts says why that is the whole safety argument).
   * Nothing this object does can reach the document: it is handed records that are already built,
   * and `runScan` below assembles the same `Findings` whether it is present or not.
   */
  progress?: ScanProgress;
  /**
   * How `--jobs` resolved BEFORE anything was read (`resolveJobs`), handed in by the one caller that
   * runs a pool. Absent everywhere else — a gate, a harness or the fixtures runner takes the
   * sequential path and asks for no workers at all.
   *
   * IT IS HANDED IN UNFINISHED, ON PURPOSE. `auto`'s last term is the SIZE OF THE TREE, and the tree
   * does not exist until it has been walked: `prepareScan` walks it, applies that term
   * (`jobsForWalk`) and reports the finished number as `PreparedScan.jobs`, one statement before it
   * opens the progress display — which is what makes the display's opening line and the `jobs:` line
   * the command prints the same number rather than two (open item 4 of the closing merge, repaired
   * 2026-09-16). The VALIDATION stays in `index.ts`, before the bundle is loaded: a `--jobs` value
   * this CLI cannot act on is refused before a tree is read, not after.
   */
  jobs?: ResolvedJobs;
  /**
   * How `--pack-groups` resolved (`resolvePackGroups`), handed in by the one caller that has a flag
   * to read. Absent everywhere else — a gate, a harness or the fixtures runner packs or does not
   * pack according to `PRODUCT_CLI_PACK_GROUPS`, which is on unless it says `0`.
   *
   * It is a resolved BOOLEAN and not the flag's text, for the reason `--jobs` and `--file-budget`
   * are resolved in `index.ts`: a value this CLI cannot act on is refused before a tree is read.
   */
  packGroups?: boolean;
  /**
   * How `--kind-census` resolved (`resolveKindCensus`), handed in by the one caller that has a flag
   * to read. Absent everywhere else — a gate, a harness or the fixtures runner takes the value
   * `PRODUCT_CLI_KIND_CENSUS` gives, which is on unless it says `0`.
   *
   * It is a resolved BOOLEAN and not the flag's text, for the reason `--pack-groups` is: a value
   * this CLI cannot act on is refused before a tree is read.
   */
  kindCensus?: boolean;
}

/**
 * The most locations that may reach ONE adjudicating agent, from this scan, in one payload.
 *
 * **Why a bound exists at all.** Layer 2 hands one payload to one fresh agent and expects it to
 * read every location in it. How big that payload could get was decided by each rule's
 * `fingerprint_spec` and by the orchestrator's grouping, and until this constant existed nothing
 * anywhere in the code or the schema bounded either. It reached the state it was always able to
 * reach — `recipients-006` on one tree raised ONE candidate carrying 253 locations across 91
 * files, and that adjudicator recorded in its own words that it **sampled representatively rather
 * than confirming each location individually**.
 * A sampled confirmation is the "group too large to confirm" class, and a bound in the engine is
 * what makes it impossible for every rule the bundle ships now and every clause added later —
 * per-rule tuning only ever patches the rules somebody remembers to tune.
 *
 * **The unit is the payload, not the candidate, and that correction is why this constant is named
 * for the adjudication.** `product/plugin/skills/legal-scan/SKILL.md` step 4 groups candidates and
 * hands one GROUP to one agent, so a per-candidate ceiling on its own leaves the class open: an
 * agent still receives every candidate of its group at once. Measured over the eight pass-1 runs of
 * 2026-08-26, as locations in one group, the group was larger than the largest single candidate on
 * six of the eight — 330 against 200, 269 against 91,
 * 251 against 207, 242 against 212, 110 against 100 — so one tree already
 * handed one agent 330 locations, above the size at which the one recorded failure happened, before
 * any of this existed. Both units are therefore bounded by this one number: a candidate by
 * `splitOversizedGroups`, and the group by `assignAdjudicationGroups` below it. Two different
 * numbers would say an agent reads 70 locations when they arrive in one candidate and 150 when they
 * arrive in three, which is not a claim anyone can hold.
 *
 * **Why 70.** Measured over those eight runs:
 * the median candidate
 * carries 2 locations, p75 is 7 by nearest rank and 6.5 interpolated, p90 is 40, **p95 is 70**, 12
 * candidates carry 100 or more and the largest carries 255. 70 is that p95, and putting the bound
 * there is what makes this a ceiling on the tail rather than a regrouping of the ordinary candidate
 * — 95 % of real candidates come out of `splitOversizedGroups` untouched, and the ones that do not
 * are the tail the failure was measured in. It also bounds the OTHER direction, which a much
 * smaller number would not: the largest group observed becomes 4 parts rather than the 11 a bound
 * of 25 would produce, so no reader trades one unreadable candidate for an unreadable list of them.
 *
 * **IT IS THE BEST AVAILABLE NUMBER AND IT IS NOT EVIDENCE. Read this before quoting it.** 70 is a
 * percentile of a COST distribution — how many locations candidates happen to carry — and not a
 * measured reading capacity. Nothing here or anywhere in this repository measures what an
 * adjudicator does at 70. Searching every 2026-08-25/26 run record for a sampling self-report
 * returns exactly one hit in eight runs, `recipients-006` at 253 locations across 91 files; there is
 * no self-report at 255, 249, 212, 207, 200, 149 or 100, and no self-report of reading a group in
 * full either. So the interval between 1 and 148 is unmeasured in both directions, and this
 * constant asserts nothing about it. What can be said for 70 is only this: it is below the one
 * observed failure, it is derived from something real, and it does not regroup the ordinary
 * candidate. Anyone moving it should measure an adjudicator rather than re-cut this distribution.
 *
 * **What it costs**, reported as cost and not as a quality signal: over those eight
 * runs, +30 candidate records (351 to 381, on 17 groups) and +44 adjudication groups (280 to 324).
 * At a per-candidate bound of 50 the record cost would be +51 and at 100 +15.
 */
/**
 * **THE SEAT'S PLACE BOUND, 105, which replaces the 70 above**.
 * A place seat holds at most 105 places,
 * 220,000 bytes of payload, three rules and one model. 105 is a MEASURED reading size and not a cost percentile: the
 * seat-capacity measurement and the question-clarity test ran their seats at about 105 places, and the misses did not fall at 30
 * (5.1 % against 6.5 %), so a smaller seat buys cost and no reading. Everything said above about 70 is the history of
 * the previous value. The bound limits what ONE SEAT holds and never what is read: a candidate over it is spread over
 * consecutive place seats that together hold every place (`planReading` in kind-census.ts).
 */
export const MAX_PLACES_PER_SEAT = 105;

/** The payload bound every caller already names: the seat's place bound. */
export const MAX_LOCATIONS_PER_ADJUDICATION = MAX_PLACES_PER_SEAT;

/**
 * The most locations one candidate may carry — the same number, because it is the same reader.
 *
 * A candidate is never divided between two agents, so a candidate above the payload bound would
 * make the payload bound unreachable. Kept as its own export because a test
 * and the schema both name the per-candidate ceiling specifically.
 */
export const MAX_LOCATIONS_PER_CANDIDATE = MAX_LOCATIONS_PER_ADJUDICATION;

/**
 * **THE UNIT THE TWO BOUNDS BELOW COUNT IN, once the kind census exists**.
 *
 * A candidate that carries more matched lines than one seat reads is no longer cut into parts of 70
 * locations: layer 1 groups its locations into same-kind line groups and the seat reads the groups.
 * So "70" stops meaning 70 LOCATIONS and starts meaning 70 READING UNITS — kinds where the candidate
 * has a census, locations where it has none, which is every candidate under the bound and every
 * candidate in a `--kind-census off` document. `readingUnitsOf` is the one function that answers
 * which, and `reading.ts` is the one module that knows how the census spells its fields.
 *
 * **What changes and what does not.** The number does not move, the packing is the same first fit in
 * the same order, and the `#batch-` and `bin:` key shapes are untouched — what changes is the unit
 * the bound counts in, and nothing else. One tree's `recipients-004` carries 54,770 locations in 37
 * kinds and now packs beside other candidates, where before it was 783 parts of 70 locations, each
 * one agent (design section 6.2).
 *
 * **Why `assignAdjudicationGroups` changes too, although section 13 of the annex says it does not.**
 * Section 13 says the file-group batching and the `#batch-` key are unchanged, and they are. But its
 * own invariant — "no key in this document carries more than the bound" — is stated in locations,
 * and a candidate with a census carries 58,712 of them under one key. Counted in locations the
 * batching would put that candidate alone in a batch and then `packAdjudicationGroups` would refuse
 * the document; counted in reading units both bound the thing the bound is about. Section 10.5 says
 * exactly this ("`assignAdjudicationGroups` and `packAdjudicationGroups` test
 * `reading_units ?? locations.length` against the bound") and it is the sentence that is followed.
 */
const readingUnits = readingUnitsOf;

/**
 * Order locations the way the split reads them: by path, then by line.
 *
 * Compared BY CODE UNIT and never by `localeCompare`, for the reason `scan_anchor` states one
 * function down — `localeCompare` with no locale argument collates in the runtime's DEFAULT LOCALE,
 * which is a property of the machine and not of the tree. A machine-dependent order is tolerable
 * inside one candidate; once it decides a SPLIT BOUNDARY it decides which `finding_id` carries
 * which location, and the same tree would produce different findings on two machines.
 */
function byPathThenLine(a: FindingLocation, b: FindingLocation): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.start_line - b.start_line;
}

/**
 * Emit a group larger than `MAX_LOCATIONS_PER_CANDIDATE` as several candidates of readable size.
 *
 * **Nothing is dropped, merged or deduplicated here.** Every location of the group appears in
 * exactly one part, and the parts concatenate back to the group: subtraction is the only operation
 * that can create a miss, so this function only ever redistributes. The one thing it changes about
 * the locations themselves is their ORDER, and only inside a group it actually splits — see
 * `byPathThenLine`. A group at or under the bound is returned as the object it already was, so a
 * scan that splits nothing writes the document it wrote before this function existed.
 *
 * **Three questions this answers by design, so they are not rediscovered as defects.**
 *
 * 1. *Is the split deterministic?* Yes, and it does not rest on the walker. The walker pushes in
 *    directory-traversal order, which is the filesystem's, so locations arrive in an order that can
 *    differ between machines for the same tree. Sorting first makes the boundary a function of the
 *    tree alone. Within one candidate the key is a total order with no ties: the engine emits at
 *    most one match per (rule, file, line) and the structural pass drops what the line pass already
 *    found, so no candidate carries the same location twice.
 *
 * 2. *Where does a part's `finding_id` come from?* From the group's own fingerprint and the part
 *    number — `groupPartFingerprint(rule_id, group_id, part)` — so it is derivable from the scan and
 *    from nothing else. Deliberately NOT a running counter over the candidate list: that would key a
 *    finding to how many candidates other, unrelated rules happened to raise first, and adding a
 *    rule to the bundle would move every id after it. **Part 1 is derived like the others rather
 *    than keeping the group's own id**, which is the more conservative of the two: a suppression or
 *    a stored verdict keyed on the old group id now matches nothing and the whole group comes back,
 *    instead of silencing the first 70 locations while the rest surface as if they were something
 *    new. `group_part.group_id` carries the group's identity so nothing about it is lost.
 *    `groupPartFingerprint` hashes in its own domain, separated from `fingerprint` by a character no
 *    path or line of source can carry, so a part's id cannot collide with an ordinary candidate's:
 *    the un-separated first version of this could be made to, and was.
 *
 * 3. *Should a split ever be skipped?* No, and the two cases that suggest it were considered.
 *    A group whose locations are all in ONE FILE is not cheaper to confirm — the cost the bound
 *    exists to control is the number of line ranges one agent must go and read, and 200 of them in
 *    one file is 200 readings. **No such group exists on the four trees this was measured over**:
 *    One tree's only oversized group is `eu-dsr-001`, which is `fingerprint_spec: project`
 *    and spans 200 locations across 81 files, and an earlier version of this comment cited it as a
 *    single-file `fingerprint_spec: file` group, which it is not. The case is therefore
 *    hypothetical today and the reason to refuse it is the reading cost above, not a frequency
 *    claim. It stays refused because `file`-scoped rules can produce it at any time and a skip
 *    would leave the class alive for all of them at once.
 *    A group of IDENTICAL locations cannot occur — see the no-ties note in (1) — so there is
 *    nothing to skip, and collapsing duplicates would be the removal this function may not do.
 */
export function splitOversizedGroups(
  grouped: Candidate[],
  /**
   * With the kind census ON (the default), a candidate above the bound is NOT cut: it is returned
   * whole, its locations in path-then-line order, carrying `kinds` — the same-kind line groups its
   * locations fall into — and `reading_plan`, which says what one seat reads of them. The 70 stops
   * being a divider of questions and becomes a bound on reading (design annex §3).
   *
   * With it OFF this function is the function it was: the candidate is cut into parts of
   * `MAX_LOCATIONS_PER_CANDIDATE`, each with its own `finding_id` and `group_part`, and no census
   * is computed. That is the control arm, and it is byte-identical to the document this scanner
   * wrote before the census existed.
   *
   * THE READING CLASS IS READ OFF THE CANDIDATE, not handed in. Unit U1 took it as a
   * `readingClassFor` callback because no rule carried the field yet; unit U2 copies the rule's own
   * `reading_class` verbatim onto every candidate it raises (below, in the grouping, and only when
   * this switch is on, for the reason stated there), and that copy is the one road the field
   * travels — to the payload's `rules` block for the seat, and to here for the plan. Two roads to one fact would be two copies of one decision, so the callback was
   * deleted at integration and this function reads the candidate it was handed. A candidate whose
   * rule declares nothing still plans per-location, and `reading_plan.class_source` says so.
   */
  kindCensus = false,
): Candidate[] {
  const out: Candidate[] = [];
  for (const c of grouped) {
    if (c.locations.length <= MAX_LOCATIONS_PER_CANDIDATE) {
      // A CANDIDATE THAT FITS ONE SEAT, with the census on, is read by the place plan too (full-read design 1.4: "its seat
      // also answers it (today's verdict seat, in place form)"; 6.4 P1: every place has exactly one record row; build unit
      // F3). `planReading` gives it no reader slice and `read_by_seat` = every place, so its verdict seat holds every place
      // and answers one row per place (`decisions`, place-reply.ts C1-C9). Without this it was answered by one verdict over
      // all its places with no row per place and no check that any was read. A location without its kind facts cannot be
      // censused (`computeKindCensus` refuses it by name): such a candidate is left as it was, as `toPlacePlan` leaves it.
      if (kindCensus && c.locations.length > 0) {
        const ordered = [...c.locations].sort(byPathThenLine);
        try {
          const whole: Candidate = { ...c, locations: ordered };
          const census = computeKindCensus(whole, MAX_LOCATIONS_PER_CANDIDATE);
          whole.kinds = census;
          whole.reading_plan = planReading(census, ordered.length, c.rule_id, MAX_PLACES_PER_SEAT, declaredReadingClassOf(c), ordered.map((l) => l.file));
          out.push(whole);
          continue;
        } catch {
          // left as it was (above)
        }
      }
      out.push(c);
      continue;
    }
    const ordered = [...c.locations].sort(byPathThenLine);
    if (kindCensus) {
      // THE CANDIDATE, WHOLE. Its locations are sorted — the same sort the split used, so the
      // census's member indices name locations in the order the parts concatenated in — and nothing
      // is dropped, merged or added: `locations.length` is what it was, and every location is in
      // exactly one group of the census.
      const whole: Candidate = { ...c, locations: ordered };
      const census = computeKindCensus(whole, MAX_LOCATIONS_PER_CANDIDATE);
      whole.kinds = census;
      whole.reading_plan = planReading(
        census,
        ordered.length,
        c.rule_id,
        MAX_PLACES_PER_SEAT,
        declaredReadingClassOf(c),
        ordered.map((l) => l.file),
      );
      out.push(whole);
      continue;
    }
    const of = Math.ceil(ordered.length / MAX_LOCATIONS_PER_CANDIDATE);
    for (let part = 1; part <= of; part++) {
      out.push({
        // The rule's own arrays (`context_questions`, `data_categories`, `legal_basis_refs`) are
        // carried by reference into every part, exactly as they are already shared between two
        // candidates of the same rule. `locations` is the one array this function builds, and it
        // is a fresh slice per part.
        ...c,
        finding_id: groupPartFingerprint(c.rule_id, c.finding_id, part),
        locations: ordered.slice(
          (part - 1) * MAX_LOCATIONS_PER_CANDIDATE,
          part * MAX_LOCATIONS_PER_CANDIDATE,
        ),
        group_part: {
          part,
          of,
          group_id: c.finding_id,
          locations_in_group: ordered.length,
        },
      });
    }
  }
  return out;
}

/**
 * Divide the candidates into the payloads layer 2 hands to one agent each, and bound every payload.
 *
 * **This is the unit the bound is actually about.** `splitOversizedGroups` above bounds a candidate,
 * and a candidate is not what an agent receives: `product/plugin/skills/legal-scan/SKILL.md` step 4
 * groups the candidates and gives ONE GROUP to one fresh `legal-adjudicator`. So a per-candidate
 * ceiling on its own leaves the failure it was built to prevent fully reachable — measured over the
 * eight pass-1 runs of 2026-08-26, the group was bigger than the biggest single candidate on six of
 * the eight, and one tree handed one agent 330 locations where its largest candidate was 200.
 * This function is what closes that, and after it **no payload in the document exceeds
 * `MAX_LOCATIONS_PER_ADJUDICATION` READING UNITS**, whatever any rule's `fingerprint_spec` does —
 * locations where the candidate has no kind census, kinds where it has one (`readingUnits` above).
 *
 * **The grouping key is not this function's to choose, and it is not changed here.** A candidate
 * belongs to the group of `locations[0].file` — the file of an arbitrary one of its locations —
 * exactly as a tool has assigned it since the harness was written. Two consequences
 * of that key are worth stating rather than leaving to be rediscovered, and neither is repaired
 * here because which key the product groups on is a product decision: a group can be large because
 * of locations that are not in its own file at all (a `project`-scoped candidate brings every
 * location it has into the group of its first one), and the parts of one split group land in
 * DIFFERENT groups whenever they begin in different files — 8 of the 9 split groups on the four
 * re-scanned trees do. `group_part` is what keeps that legible to the agent that gets one of them.
 *
 * **What is emitted.** Every candidate gets an `adjudication_group`, present always and not only
 * when a group had to be divided, so the orchestrator has ONE instruction — group by
 * `adjudication_group.key` — with no fallback rule that could drift from this code. A group over the
 * bound is emitted as several BATCHES carrying the same candidates: `batch` / `batches` say which of
 * them this is, in the same way `group_part`'s `part` / `of` do for a candidate, and they are
 * deliberately spelled differently because the two divisions are different divisions and a reader
 * who confuses them will double-count. Nothing is dropped: every candidate is in exactly one batch,
 * and `assignAdjudicationGroups(cs).length === cs.length` always.
 *
 * **Deterministic**, for the reason the candidate split is: the batch boundary decides which agent
 * sees which location, so a boundary that moved between machines would make an adjudication
 * unreproducible. It is a function of the candidate array alone — first-fit in array order, and the
 * array has already been sorted by severity then rule id, with the parts of a split group adjacent
 * and in part order. No filesystem order and no locale collation is read.
 *
 * **First-fit rather than anything cleverer.** A candidate is never divided between two agents, so a
 * batch must hold whole candidates; first-fit in a fixed order is the only packing that is stable
 * under adding a candidate at the end and is trivial to re-derive by hand from the document. It can
 * leave a batch part-empty — a group of a 70 and a 3 is two batches — which is a cost in agents and
 * never a loss. The one thing it cannot do is exceed the bound, and it cannot only because
 * `splitOversizedGroups` has already made every candidate fit in one batch on its own.
 */
export function assignAdjudicationGroups(candidates: Candidate[]): Candidate[] {
  // Pass 1: which batch each candidate falls in, and how big each file's group and batches are.
  // `used` and `units` count READING UNITS, which is what the bound is in; `locations` counts
  // locations, which is what `locations_in_batch` and `locations_in_file_group` have always said and
  // go on saying. The two are the same number on every candidate without a census, which is every
  // candidate in a `--kind-census off` document.
  const state = new Map<string, { batch: number; used: number; units: number; locations: number }>();
  const assigned: { file: string; batch: number }[] = [];
  for (const c of candidates) {
    // The group key: the file of the candidate's FIRST location, matching a tool.
    // A candidate always carries at least one location; the fallback is the same string that
    // harness uses, so a hypothetical empty one is grouped somewhere visible rather than crashing.
    const file = c.locations[0]?.file ?? "(unknown)";
    // READING UNITS, not locations: kinds where this candidate has a census, locations where it has
    // none. See `readingUnits` above for why this function counts them and section 13 of the annex
    // does not say so.
    const n = readingUnits(c);
    let s = state.get(file);
    if (!s) {
      s = { batch: 1, used: 0, units: 0, locations: 0 };
      state.set(file, s);
    } else if (s.used > 0 && s.used + n > MAX_LOCATIONS_PER_ADJUDICATION) {
      s.batch++;
      s.used = 0;
    }
    s.used += n;
    s.units += n;
    s.locations += c.locations.length;
    assigned.push({ file, batch: s.batch });
  }
  // Pass 2: the totals a part cannot know while it is being placed — how many batches its file
  // ended up needing, and how many locations and reading units each batch and each whole group
  // carries.
  const batchLocations = new Map<string, number>();
  const batchUnits = new Map<string, number>();
  const batchHasCensus = new Set<string>();
  for (let i = 0; i < candidates.length; i++) {
    const a = assigned[i];
    const k = JSON.stringify([a.file, a.batch]);
    batchLocations.set(k, (batchLocations.get(k) ?? 0) + candidates[i].locations.length);
    batchUnits.set(k, (batchUnits.get(k) ?? 0) + readingUnits(candidates[i]));
    if (kindCensusOf(candidates[i])) batchHasCensus.add(k);
  }
  return candidates.map((c, i) => {
    const a = assigned[i];
    const batches = state.get(a.file)?.batch ?? 1;
    const k = JSON.stringify([a.file, a.batch]);
    return {
      ...c,
      adjudication_group: {
        // A file that needed one batch keys on its own path, so the ordinary document reads exactly
        // as it did before this function existed. `file` and `batch` are the authoritative pair;
        // `key` is the single string an orchestrator can group on without composing one.
        key: batches > 1 ? `${a.file}#batch-${a.batch}` : a.file,
        file: a.file,
        batch: a.batch,
        batches,
        locations_in_batch: batchLocations.get(k) ?? c.locations.length,
        locations_in_file_group: state.get(a.file)?.locations ?? c.locations.length,
        // WRITTEN ONLY WHERE A CANDIDATE OF THIS BATCH CARRIES A CENSUS, so a document scanned with
        // `--kind-census off` is byte-for-byte the one this scanner wrote before the census existed.
        // Where it is written it is the number the bound is actually in, and `locations_in_batch`
        // beside it is how many matched lines those units stand for.
        ...(batchHasCensus.has(k) ? { reading_units_in_batch: batchUnits.get(k) ?? readingUnits(c) } : {}),
      },
    };
  });
}

/**
 * The most RULES one packed bin may hold, beside the location bound it shares with everything above.
 *
 * A bin carries every member candidate's own rule prose to the agent that reads it, and a rule's
 * prose is about 4.5 k tokens, so the rule
 * count is the second cost of a packed payload and the one the location bound cannot see. Three is
 * the figure adopted on 2026-09-17, and on the three findings documents prepared on 2026-09-16
 * (a large, a mid-sized and a small tree) it is where the bin count stops falling steeply — the large tree's 682 payloads today become
 * 254 at one rule per bin, 219 at two, 208 at three and 206 at four, and the mid-sized tree's 85 become 51, 30,
 * 22 and 19 — so the fourth rule buys about 1 % on the large tree for a quarter more prose in every child.
 *
 * IT IS A CEILING ON THE BIN AND NOT ON THE FILE GROUP. Today's key already puts every rule that
 * fires in one file into one payload, without limit: on the large tree 2 of 682 payloads hold four rules or
 * more (one of four rules, one of five; rules per payload are 599 / 70 / 11 / 1 / 1), on the mid-sized tree
 * 2 of 85, on the small tree 1 of 16 (seven rules). Packing therefore DIVIDES those few and
 * merges everything else, which is why a tree whose candidates all land in one configuration file is
 * the one shape where packing can produce more payloads than it removes. None of the three trees
 * measured does.
 */
export const MAX_RULES_PER_ADJUDICATION_BIN = 3;

/** `--pack-groups` was handed something that is neither `on` nor `off`. */
export class PackGroupsOptionError extends Error {}

/**
 * Is the packing below applied to this scan? `--pack-groups on|off`, then `PRODUCT_CLI_PACK_GROUPS`.
 *
 * **Why the switch exists at all.** Packing changes which candidates one agent is handed, so the
 * adopting decision puts a pre-registered comparison measurement in front of the merge:
 * the same candidates are adjudicated packed and unpacked and the verdicts are compared. Both arms
 * have to be runnable from one binary, and the control arm has to be the document the scanner wrote
 * before this function existed — byte for byte, so that nothing but the grouping can be the reason
 * two verdicts differ. `off` is that arm.
 *
 * **Precedence is stated once, here.** The flag wins where it was typed, because it is the more
 * specific instruction; where it was not, `PRODUCT_CLI_PACK_GROUPS=0` turns packing off for a
 * harness that cannot edit an argument vector — the same pair, and the same precedence, as
 * `--no-prefilter` / `PRODUCT_CLI_PREFILTER=0` (engine.ts `resolvePrefilterRuntimeOptions`). Any
 * other value of the variable, the empty string included, leaves packing on: a switch that turns a
 * default off does it on ONE spelling, so a typo cannot silently change what a scan hands layer 2.
 *
 * A value this CLI cannot act on is refused rather than defaulted, and `index.ts` resolves it before
 * the bundle is loaded, so the refusal arrives before a tree is read (the reason `--jobs` and
 * `--file-budget` are resolved there).
 */
export function resolvePackGroups(spec?: string): boolean {
  if (spec === undefined) return process.env.PRODUCT_CLI_PACK_GROUPS !== "0";
  if (spec === "on" || spec === "off") return spec === "on";
  throw new PackGroupsOptionError(
    `--pack-groups takes \`on\` or \`off\`, got ${JSON.stringify(spec)}. Nothing was scanned. ` +
      `\`on\` is the default: the run's candidates are packed into bins of at most ` +
      `${MAX_LOCATIONS_PER_ADJUDICATION} locations and ${MAX_RULES_PER_ADJUDICATION_BIN} rules, and ` +
      `each bin is one adjudicating agent. \`off\` leaves one payload per file group, which is the ` +
      `document this scanner wrote before packing existed and the control arm of the comparison ` +
      `measurement. PRODUCT_CLI_PACK_GROUPS=0 in the environment does the same as \`off\`.`,
  );
}

/** `--kind-census` was handed something that is neither `on` nor `off`. */
export class KindCensusOptionError extends Error {}

/**
 * Does this scan compute the same-kind line groups? `--kind-census on|off`, then
 * `PRODUCT_CLI_KIND_CENSUS`.
 *
 * **Why the switch exists at all.** The census changes what a large candidate looks like in the
 * document — it is written whole, with a catalogue, instead of being cut into parts of 70 — and the
 * control arm has to be the document this scanner wrote before it existed, byte for byte, so that
 * nothing but the grouping can be the reason two readings differ. `off` is that arm, and it is what
 * `test:kind-census` holds the new code to on two real trees.
 *
 * **Precedence is stated once, here**, and it is `--pack-groups`' precedence: the flag wins where it
 * was typed; where it was not, `PRODUCT_CLI_KIND_CENSUS=0` turns the census off for a harness that
 * cannot edit an argument vector. Any other value of the variable, the empty string included, leaves
 * it on — a switch that turns a default off does it on ONE spelling, so a typo cannot silently
 * change what a scan hands layer 2.
 */
export function resolveKindCensus(spec?: string): boolean {
  if (spec === undefined) return process.env.PRODUCT_CLI_KIND_CENSUS !== "0";
  if (spec === "on" || spec === "off") return spec === "on";
  throw new KindCensusOptionError(
    `--kind-census takes \`on\` or \`off\`, got ${JSON.stringify(spec)}. Nothing was scanned. ` +
      `\`on\` is the default: a candidate carrying more than ${MAX_LOCATIONS_PER_CANDIDATE} ` +
      `locations is written whole, with the same-kind line groups its locations fall into and the ` +
      `plan for reading them, instead of being cut into parts of ${MAX_LOCATIONS_PER_CANDIDATE}. ` +
      `\`off\` cuts it into parts, which is the document this scanner wrote before the census ` +
      `existed. PRODUCT_CLI_KIND_CENSUS=0 in the environment does the same as \`off\`.`,
  );
}

/**
 * Order the candidates the way the packing reads them: by rule, then by the first location's file
 * and line, then by `finding_id`.
 *
 * RULE-MAJOR IS THE WHOLE POINT and it is not the document's own order (severity, then rule). A
 * packed bin carries one copy of each member rule's prose, so neighbours that share a rule are the
 * cheap ones to put together; the measured groups are one candidate each — 84 groups for 97
 * candidates on one tree, 62 of 65 groups on another — so file-major packing would buy almost
 * nothing.
 *
 * THE FIRST LOCATION IS `locations[0]` AS STORED, and not the smallest location under
 * `byPathThenLine`. The two are not always the same candidate: `splitOversizedGroups` returns a group
 * at or under the bound without sorting its locations, so a candidate's first entry is the walker's
 * first and not the path-order first. `locations[0]` is chosen because it is the same entry
 * `assignAdjudicationGroups` keys its file group on one function up — one reading of "first" in the
 * whole grouping stage rather than two. It costs nothing here: on the largest tree 6 of 820 candidates have
 * `locations[0] !== min(locations)`, and packing under either reading gives the same 208 bins with
 * the same members;
 * the two other trees carry no such candidate at all.
 *
 * TOTAL, with no tie left to the runtime. `byPathThenLine` is reused rather than restated, for the
 * reason it gives about `localeCompare`: a comparison that reads the machine's default locale would
 * make the bin boundary a property of the machine. `rule_id` is compared BY CODE UNIT here for the
 * same reason, and `finding_id` breaks the last tie — it is unique in a document (asserted by
 * a test) and derived from the scan's own content, so two candidates of
 * one rule that begin at the same line still pack in a fixed order.
 */
function byRuleThenFirstLocation(a: Candidate, b: Candidate): number {
  if (a.rule_id !== b.rule_id) return a.rule_id < b.rule_id ? -1 : 1;
  // A candidate always carries at least one location; the fallback is the one
  // `assignAdjudicationGroups` uses for the same hypothetical, so an empty one sorts somewhere
  // visible rather than crashing.
  const fa = a.locations[0] ?? { file: "(unknown)", start_line: 0 };
  const fb = b.locations[0] ?? { file: "(unknown)", start_line: 0 };
  const byLocation = byPathThenLine(fa, fb);
  if (byLocation !== 0) return byLocation;
  return a.finding_id < b.finding_id ? -1 : a.finding_id > b.finding_id ? 1 : 0;
}

/**
 * Merge the payloads into bins of useful size, so that a run spends one agent on several small
 * questions instead of one agent on each.
 *
 * **The cost this removes.** A child's price is a near-constant whatever it is handed: over the 82
 * adjudicators of one real run of 2026-09-02, the correlation of price with locations is -0.12
 * and with API calls 0.76, because every child performs the same investigation ritual of about eight
 * calls. 47 of that run's 84 children held ONE location in ONE file and cost what a child holding
 * fifty cost. So the run's bill is the number of children times a constant, and the number of
 * children is what this function cuts: on the three documents prepared on 2026-09-16, the large tree's 682
 * payloads become 208, the mid-sized tree's 85 become 22 and the small tree's 16 become 8.
 *
 * **What it may not do, and does not.** It merges WHOLE CANDIDATES and never divides one — the
 * division of a candidate is `splitOversizedGroups` and this function is its opposite number, so a
 * candidate that arrives at the bound leaves alone in a bin of its own (nothing else fits beside 70
 * locations). It removes nothing and adds nothing: every candidate is in exactly one bin,
 * `packAdjudicationGroups(cs).length === cs.length` always, and the candidates come back in the
 * array order they arrived in — the packing order below is a reading order over a copy, so the
 * document's own order (severity, then rule id, with the parts of a split group adjacent) is
 * untouched and a `--pack-groups off` run is byte-identical to the document written before this
 * function existed.
 *
 * **First-fit, in a fixed order, exactly as `assignAdjudicationGroups` batches.** For each candidate
 * in rule-major order, the first bin that can take it — the bin's reading units plus this
 * candidate's are at or under `MAX_LOCATIONS_PER_ADJUDICATION`, and it either brings no new rule or the bin
 * holds fewer than `MAX_RULES_PER_ADJUDICATION_BIN` — and otherwise a new bin. That is the whole
 * algorithm, and it is chosen for being re-derivable by hand from the document rather than for
 * packing tightly: a reader with the candidate list can reproduce every bin with a pencil. Cost is
 * one scan of the open bins per candidate, quadratic in the worst case and invisible at real sizes —
 * 6.9 ms over the largest tree's 820 candidates and 208 bins, against a 269-second scan (measured 2026-09-17).
 *
 * **What is emitted.** The bin becomes `adjudication_group.key`, which is the one thing SKILL.md
 * step 4 groups on, so the orchestrator's instruction does not change. The key is
 * `bin:<n>#<rule ids>` — self-describing on purpose, because a reader of the document, a run log or
 * an audit record must be able to see that a payload is a packed bin and which rules are in it
 * without joining back to the candidates. WHEN PACKING IS ON, EVERY KEY IN THE DOCUMENT IS A BIN
 * KEY: the two key spaces never mix inside one document, which is what keeps `bin:` from having to
 * be distinguishable from a file path. The file-group fields beside it — `file`, `batch`, `batches`,
 * `locations_in_batch`, `locations_in_file_group` — are NOT rewritten and they still say exactly
 * what they said: which file this candidate is named for and how its file's group was divided.
 * They are no longer the payload, and the schema says so on both fields; `locations_in_bin` is what
 * one agent is being asked to read. `group_part` is untouched in meaning and in value — it divides
 * one candidate that was too big, this merges candidates that were too small, and a candidate can
 * carry both.
 *
 * **The precondition, stated as plainly as `assignAdjudicationGroups` states its own.** This
 * function keeps the payload bound only because `splitOversizedGroups` HAS ALREADY RUN: nothing here
 * divides a candidate, so a candidate that arrives above the bound cannot be made to fit, and the
 * document would carry a payload over the bound while saying so in `locations_in_bin`. The pipeline
 * never produces one — `runScan` calls the split, the grouping and then this, in that order — so the
 * refusal below is unreachable from the product and is there for the next caller, which on the
 * current plan is a unit of the layer-2 cost lane. It REFUSES rather than clamping: the alternative
 * is a document that breaks the one invariant `MAX_LOCATIONS_PER_ADJUDICATION` exists for, and a
 * scan that stops with a message naming the missing step is the smaller loss.
 *
 * **Why the bin count is not emitted beside the bin number.** `batches` exists because a candidate
 * cannot see how many batches its own file needed; how many bins a run has is one `unique` over the
 * keys of a document the reader already holds, and a second copy of a derivable number is a thing
 * two places must agree on.
 */
/**
 * How many reading units this candidate is — its groups where it carries a census, its locations
 * where it does not.
 *
 * One function, read by the packer's precondition and by the annotation `runScan` writes, so the two
 * cannot answer differently.
 */
function unitsOfCandidate(c: Candidate): number {
  return c.reading_plan === undefined
    ? c.locations.length
    : readingUnitsOfPlan(c.reading_plan, c.kinds ?? null, c.locations.length);
}

export function packAdjudicationGroups(
  candidates: Candidate[],
  /**
   * The seat model of each rule (`seat_model` on the rule, `sonnet` where absent; seat-model.ts). THE PACKER NEVER
   * MIXES MODELS IN ONE SEAT (full-read design 1.4 and 1.6): a bin holds the candidates of rules of one model only, and
   * its marker names that model (`adjudication_group.seat_model`), which the launch list reads. A caller that passes
   * nothing packs every rule as `sonnet`, which is every rule today.
   */
  seatModelOf: (ruleId: string) => SeatModel = () => DEFAULT_SEAT_MODEL,
): Candidate[] {
  // Pass 0: the precondition, checked rather than assumed — see the paragraph above. Reading the
  // whole array once is O(n) beside a packing that is not, and it turns "the caller forgot the
  // split" from a document that quietly breaks the bound into a message that names the step.
  //
  // A CANDIDATE THAT CARRIES A CENSUS IS EXEMPT, and that is not a hole in the precondition — it is
  // the design. Such a candidate was deliberately NOT divided (`splitOversizedGroups` with the kind
  // census on): it is one question with one verdict, its locations are grouped into same-kind line
  // groups, and what one seat reads is those groups. It gets its own payload, which is what the
  // first fit below gives it anyway: its location count is above the bound, so no bin can hold it
  // beside anything else. Refusing it here would refuse the very document the census exists to
  // produce.
  //
  // What the refusal still catches is exactly what it always caught: a candidate with NO census and
  // more locations than one agent reads, handed to a function that merges whole candidates and
  // divides none — the caller who forgot the split.
  //
  // THE PRECONDITION IS IN READING UNITS, which for a candidate with no census is its location
  // count and therefore exactly what this check has always tested. A candidate WITH a census is
  // over the bound in units when its kinds are, and its own payload is the correct answer for it —
  // so it is not refused here; it is placed in a bin of its own by the first fit below, which no
  // other candidate can join.
  //
  // THE FITTING TEST BELOW COUNTS READING UNITS, not locations. Unit U1 left it counting locations
  // and said so here, because moving it would have moved bins that U1 had not measured; unit U2
  // made the move and measured it, so one tree's `recipients-004` — 54,770 locations in 37 groups —
  // is 37 units to the packer and can share a bin with other questions.
  const oversized = candidates.find(
    (c) => !kindCensusOf(c) && c.locations.length > MAX_LOCATIONS_PER_ADJUDICATION,
  );
  if (oversized) {
    throw new Error(
      `packAdjudicationGroups was handed ${oversized.rule_id} (${oversized.finding_id}) carrying ` +
        `${oversized.locations.length} locations, above MAX_LOCATIONS_PER_ADJUDICATION ` +
        `(${MAX_LOCATIONS_PER_ADJUDICATION}), and no kind census that would make it readable by kinds. ` +
        `This function merges whole candidates and never divides one, so it cannot make that candidate ` +
        `fit: call splitOversizedGroups first, as runScan does.`,
    );
  }

  // Pass 1: the reading order. Indices, so the input array is never sorted in place — the caller's
  // array and the document's order belong to the caller (the same reason `splitOversizedGroups`
  // copies before it sorts).
  const order = candidates.map((_, i) => i);
  order.sort((x, y) => byRuleThenFirstLocation(candidates[x], candidates[y]));

  // Pass 2: first fit. `bins` is in creation order, which is the order the scan below reads them in,
  // so "the first bin that fits" means the same thing on every machine.
  const bins: { units: number; locations: number; rules: Set<string>; members: number; census: boolean; model: SeatModel }[] = [];
  const binOfCandidate = new Array<number>(candidates.length);
  for (const i of order) {
    const c = candidates[i];
    // The bound is in READING UNITS. A candidate whose kinds are already at or over the bound finds
    // no bin that can take it and opens one of its own, which is the "own payload with one verdict
    // seat" of annex section 3.2 — the same first fit reaching the same answer, with no special case.
    const n = readingUnits(c);
    const locations = c.locations.length;
    const hasCensus = kindCensusOf(c) !== null;
    const model = seatModelOf(c.rule_id);
    let target = bins.findIndex(
      (b) =>
        b.model === model &&
        b.units + n <= MAX_LOCATIONS_PER_ADJUDICATION &&
        (b.rules.has(c.rule_id) || b.rules.size < MAX_RULES_PER_ADJUDICATION_BIN),
    );
    if (target < 0) {
      bins.push({ units: 0, locations: 0, rules: new Set(), members: 0, census: false, model });
      target = bins.length - 1;
    }
    const bin = bins[target];
    bin.units += n;
    bin.locations += locations;
    bin.rules.add(c.rule_id);
    bin.members++;
    bin.census = bin.census || hasCensus;
    binOfCandidate[i] = target;
  }

  // Pass 3: the key, and the three facts a child needs about the bin it was handed. The rule ids are
  // sorted by code unit rather than left in the order they were added, so the key of a bin is a
  // function of its membership alone and two documents can be diffed on it.
  const keys = bins.map(
    (b, idx) =>
      `bin:${idx + 1}#${[...b.rules].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)).join("+")}`,
  );
  return candidates.map((c, i) => {
    const g = c.adjudication_group;
    // Unreachable: this runs immediately after `assignAdjudicationGroups`, which emits a marker on
    // every candidate. Written as a pass-through rather than a non-null assertion so that a caller
    // that ever packs an unassigned array gets its candidates back whole instead of a marker with
    // half its fields missing.
    if (!g) return c;
    const idx = binOfCandidate[i];
    const bin = bins[idx];
    return {
      ...c,
      adjudication_group: {
        ...g,
        key: keys[idx],
        bin: idx + 1,
        rules_in_bin: [...bin.rules].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)),
        candidates_in_bin: bin.members,
        locations_in_bin: bin.locations,
        // The one model every seat of this bin reads on (full-read design 1.6): the rule's own setting.
        seat_model: bin.model,
        // WRITTEN ONLY WHERE A CANDIDATE OF THIS BIN CARRIES A CENSUS, for the reason
        // `reading_units_in_batch` is: a `--kind-census off` document must be byte-for-byte the one
        // this scanner wrote before the census existed. `locations_in_bin` goes on saying how many
        // matched lines the bin stands for, and this says how many units one seat reads.
        ...(bin.census ? { reading_units_in_bin: bin.units } : {}),
      },
    };
  });
}

/**
 * The recipient vocabulary lists a bundle carries, by list name.
 *
 * A list qualifies when its rule declares `kind: "recipient"` for it in `detector.vocabulary_kinds`
 * — the field `tools/build-bundle.mjs` merges out of `rules/vocabulary/*.yaml`. That is the ONLY
 * thing that distinguishes a list of vendor spellings from a list of construct spellings once the
 * build has flattened both into `detector.vocabulary`: `payment_recipients` holds `stripe`,
 * `api.paddle.com` and `com.adyen`, and `outbound_webhook_target` holds `webhook_url` and
 * `callbackUrl`, and after the flatten they are both `string[]`.
 *
 * **Kept out of a hand-written list of names on purpose.** Naming the thirteen recipient lists here
 * would be a copy that agrees on the day it is written and goes stale the first time a recipient
 * list is authored — silently, and in the direction of reading less. The project's rules forbid it by name.
 */
export function recipientAnchorLists(
  rules: Rule[],
): Map<string, { anchors: string[]; matching?: ListMatching; rules: string[] }> {
  const lists = new Map<string, { anchors: string[]; matching?: ListMatching; rules: string[] }>();
  for (const rule of [...rules].sort((a, b) => a.id.localeCompare(b.id))) {
    const kinds = rule.detector?.vocabulary_kinds;
    if (!kinds) continue;
    for (const name of Object.keys(kinds).sort()) {
      if (kinds[name] !== RECIPIENT_LIST_KIND) continue;
      const anchors = rule.detector?.vocabulary?.[name];
      if (!Array.isArray(anchors) || anchors.length === 0) continue;
      const existing = lists.get(name);
      if (existing) {
        if (!existing.rules.includes(rule.id)) existing.rules.push(rule.id);
        continue;
      }
      lists.set(name, {
        anchors: [...anchors],
        // Read the way `expandPattern` reads it, from the same field, so a dependency name is
        // tested against the spelling tolerance the rule's own patterns were compiled with — never
        // a literal comparison, which would miss `Stripe`, `help-scout` and `mailgunjs` and report
        // every one of them as a vendor nothing looked for.
        matching: rule.detector?.vocabulary_matching?.[name],
        rules: [rule.id],
      });
    }
  }
  return lists;
}

/**
 * Dependencies spelled like a recipient vendor the rules know, with no matched line naming them.
 *
 * ## What this is
 *
 * Two things this scan already read, intersected: the manifest says a package is installed, and the
 * rules that know that vendor's spellings matched no line containing it. Both halves are facts a
 * reader confirms by opening a file. **The row is an observation and never a verdict**, and it is
 * emitted for the same reason `suppressed_by_corroboration` is: an absence nobody can enumerate is
 * indistinguishable from a producer that does not record.
 *
 * ## What it does NOT say, and every clause here was written against a specific wrong reading
 *
 * - **Not "the vendor receives data".** A manifest entry is a package that was installed. The
 *   `@sendgrid/mail` reasoning in `census.ts`'s header governs this field too.
 * - **Not "the detector missed something".** The rules that splice the list may have had no file on
 *   their surface, may not be about this construct, or may be right that nothing in this tree names
 *   the vendor outside its manifest. Which of those it is, is read from the tree.
 * - **Not "the manifest is wrong".** A dependency that is declared, installed and used exactly as
 *   intended produces this row whenever no rule pattern happens to name it.
 * - **Not a dichotomy between those.** The 2026-08-27 profile-gating repair recorded exactly this
 *   defect (D2): "either the answer is wrong, or the candidate is" enumerated two outcomes that
 *   excluded the true one, and the project's own harvest classed 8 of 21 cases as neither.
 *
 * ## The one limit worth stating in the type, because it can only over-report
 *
 * `candidates_naming_it` counts matched lines containing **this dependency's own spelling**, not
 * every spelling of the vendor behind it. The bundle carries anchors flattened per list and carries
 * no vendor identity, so a candidate naming Paddle as `api.paddle.com` does not count against a
 * dependency called `@paddle/paddle-js`. The row is therefore an over-report in that shape, which
 * is the cheap direction — a reader dismisses it in one line, where a missing row would be silence.
 *
 * ## The inverse direction is deliberately absent
 *
 * A candidate naming a vendor no manifest declares is NOT reported here. A vendor reached over
 * plain HTTP with no SDK is ordinary rather than notable, so a row for it would train a reader to
 * ignore the array. `SKILL.md` step 4 hands that direction to the adjudicating agent, which has the
 * file open, as something worth stating in a verdict.
 */
export function declaredVendorsWithoutCandidates(
  inventory: DependencyInventoryEntry[],
  rules: Rule[],
  matched: { ruleId: string; lineText: string }[],
): DeclaredVendorWithoutCandidate[] {
  const lists = recipientAnchorLists(rules);
  if (lists.size === 0 || inventory.length === 0) return [];

  // One compiled matcher per list, and per anchor only for the lists a name reached. Anchored at
  // both ends: a DEPENDENCY NAME either is the vendor's spelling or is not, and a substring test
  // would make `stripe` out of `stripe-webhook-mock` and `eslint-plugin-stripe`.
  const wholeName = new Map<string, RegExp>();
  const perAnchor = new Map<string, RegExp[]>();
  for (const [name, list] of lists) {
    wholeName.set(name, new RegExp(`^${alternation(list.anchors, list.matching)}$`));
    perAnchor.set(
      name,
      list.anchors.map((a) => new RegExp(`^${alternation([a], list.matching)}$`)),
    );
  }

  // Matched lines, grouped by the rule that matched them, so a rule that never fired costs nothing.
  const linesByRule = new Map<string, string[]>();
  for (const m of matched) {
    const rows = linesByRule.get(m.ruleId) ?? [];
    rows.push(m.lineText);
    linesByRule.set(m.ruleId, rows);
  }

  const out: DeclaredVendorWithoutCandidate[] = [];
  for (const entry of inventory) {
    const matchedLists: string[] = [];
    const matchedAnchors = new Set<string>();
    for (const [name, list] of lists) {
      if (!wholeName.get(name)!.test(entry.package)) continue;
      matchedLists.push(name);
      const res = perAnchor.get(name)!;
      list.anchors.forEach((a, i) => {
        if (res[i].test(entry.package)) matchedAnchors.add(a);
      });
    }
    if (matchedLists.length === 0) continue;

    const consulted = [...new Set(matchedLists.flatMap((n) => lists.get(n)!.rules))].sort();
    // The anchors this dependency matched, as substring tests against a matched line. Not anchored:
    // a candidate line is code, and the spelling sits inside it.
    const inLine = [...matchedAnchors].map(
      (a) => new RegExp(alternation([a], listMatchingOf(lists, matchedLists, a))),
    );
    let naming = 0;
    for (const ruleId of consulted) {
      for (const text of linesByRule.get(ruleId) ?? []) {
        if (inLine.some((re) => re.test(text))) naming++;
      }
    }
    if (naming > 0) continue;

    out.push({
      package: entry.package,
      matched_anchor_lists: [...matchedLists].sort(),
      matched_anchors: [...matchedAnchors].sort(),
      declared: entry.declared,
      declared_only: entry.declared_only,
      ...(entry.call_sites_not_read ? { call_sites_not_read: entry.call_sites_not_read } : {}),
      // Always 0 by construction, and written rather than implied: a record whose defining property
      // is invisible is a record a reader has to take on trust.
      candidates_naming_it: 0,
      rules_consulted: consulted,
    });
  }
  // Code unit, not `localeCompare`, for the reason `census.ts`'s dependency loop states: the same
  // tree must produce the same document on every machine.
  return out.sort((a, b) => (a.package < b.package ? -1 : a.package > b.package ? 1 : 0));
}

/** The matching of the first list that carries this anchor. Lists agree on tolerance in practice;
 * where two do not, the first by name is used and the test is a substring test either way. */
function listMatchingOf(
  lists: Map<string, { anchors: string[]; matching?: ListMatching; rules: string[] }>,
  names: string[],
  anchor: string,
): ListMatching | undefined {
  for (const n of [...names].sort()) {
    const l = lists.get(n);
    if (l && l.anchors.includes(anchor)) return l.matching;
  }
  return undefined;
}

/**
 * The instrument a CELEX identifier names, as the number an Official Journal citation prints —
 * `2024/2847` for the Cyber Resilience Act, whether the checklist's `source_url` carries the act as
 * first published (`celex/32024R2847`) or a consolidated rendering of it
 * (`celex/02024R2847-20241120`). Null when the url names no instrument of that kind.
 *
 * **The first character of a CELEX identifier is its SECTOR, and that is the whole of the repair
 * made on 2026-09-08.** Sector `3` is secondary legislation as the Journal first published it;
 * sector `0` is a consolidated rendering of that same act, and it carries the date the
 * consolidation speaks as (`-YYYYMMDD`) after the number. The year, the type letter and the number
 * in between are identical in the two forms, because they ARE the instrument — so the two
 * identifiers are one instrument and this function returns one token for both. Until this function
 * existed the caller matched `/celex\/3(\d{4})[A-Z](\d{4})/i` inline, which requires the literal
 * `celex/3`; when the legal side moved GDPR, GPSR, the AI Act and the CRA onto consolidated
 * identifiers nothing matched, and `candidates[].depends_on_applicability` was
 * emitted for nobody — a finding that turns on an unresolved scope question reached the user's
 * adjudicator with nothing on it saying so. A check caught it and now
 * asserts both forms against this function directly.
 *
 * **No base-to-consolidated table, deliberately.** A check keeps a hand-written
 * `CONSOLIDATED` map, and needs one: it must FETCH a particular rendering, and which rendering is
 * current is a fact about EUR-Lex that no identifier states. Identity needs no such table — the
 * sector digit and the date suffix are simply dropped — and a copy of that map here would be the
 * forbidden second copy, needing a new row every time the legal side consolidates another
 * act. The CLI must not import from `tools/` either way.
 *
 * **What it does NOT read, and why that is deliberate rather than an omission.** The rule base also
 * cites Court of Justice cases (sector `6`, e.g. `62020CJ0184`, 57 urls) and Commission
 * communications (sector `5`, e.g. `52025XC06233`, 3 urls). Neither is an act, so no applicability
 * checklist assesses one, and reading either as legislation would put a case number where an
 * instrument number belongs. The sector alternation is what excludes them, and it excluded them
 * before this change too.
 *
 * **The number is unpadded here, and this is the ONE place it happens.** CELEX pads the number to
 * four digits — GDPR is `0679` — and the Official Journal never prints that zero, so every citation
 * in the rule base writes `2016/679`. The expression this replaces kept the padding, so the key it
 * built for GDPR, the EAA, the GPSR and every Directive was a string no citation contains and those
 * instruments could never annotate a candidate on EITHER identifier form. That is the same class of
 * defect as the sector digit above — a key that does not name the thing it is a key for — and it is
 * repaired the same way: by normalising once, where the key is made, so that the two identifier
 * forms and the citation text all agree. Padding is not information: CELEX writes `0679` and the
 * Journal writes `679` for one and the same instrument. Nothing downstream re-pads, and nothing
 * else in the CLI builds this key.
 *
 * **What normalising cannot do is widen the match wrongly.** The key is looked for inside citation
 * prose with `includes`, so a shorter key is a looser one. Measured over the whole rule base on
 * 2026-09-08: each of the seven instruments an applicability checklist names matches exactly the
 * citations that name that instrument, and no citation of any other instrument contains any of
 * them. The record has the counts.
 */
export function celexInstrumentToken(url: string | null | undefined): string | null {
  const m = /celex\/[03](\d{4})[A-Z](\d{4})/i.exec(url ?? "");
  // `(?=\d)` keeps the last digit of a number that is all zeros, which is not a real CELEX number
  // but is the one input that would otherwise leave an empty string where a number belongs.
  return m ? `${m[1]}/${m[2].replace(/^0+(?=\d)/, "")}` : null;
}

/**
 * EVERYTHING THIS SCAN DECIDES BEFORE A DETECTOR READS A BYTE: the profile, the read scope, the
 * walk and the bundle's own rule count.
 *
 * It is its own function for exactly one reason — the worker pool (`--jobs`, engine-pool.ts) needs
 * the walk list BEFORE the engine runs, so that it can hand the workers file indices, and it must
 * be the same walk `runScan` would have made. Splitting the decision out is how the two paths share
 * one walk instead of keeping a forbidden second copy; `runScan` with no `precomputed`
 * argument calls it itself and is byte-for-byte the function it was.
 *
 * It PRINTS the scan-profile report where a report exists, which is why it must be called once per
 * scan and never twice.
 */
export interface PreparedScan {
  startedAt: string;
  /** The `--profile` file as loaded and checked, or `null` when none was given — `profile` is its
   * profile and `loaded.validation` is the block the document carries. */
  loaded: LoadedScanProfile | null;
  profile: ScanProfile | null;
  readScope: ReturnType<typeof readScopeFor>;
  /**
   * `sizes` is present only where this scan WALKED the tree — a caller that supplied its own `files`
   * list (the fixtures runner, the mutation harness, the reconciliation tests) never reached the
   * walker and has no sizes to hand on. Nothing but the progress display reads it, and it treats an
   * absent array as "no byte total", which costs that caller an ETA it never asks for.
   */
  walked: WalkedTree;
  /**
   * `--jobs` as THIS TREE resolved it — `ScanOptions.jobs` with the one term that needs the walk
   * applied (`jobsForWalk`) — or `null` where the caller handed none and is running sequentially.
   *
   * It is decided here because the progress display is opened here and its opening line names the
   * number: a resolution made afterwards, in the caller, would print one number on stderr and
   * another on stdout, which is exactly what it did until 2026-09-16. Every reader takes it from
   * this field, so there is one resolution and not two.
   */
  jobs: ResolvedJobs | null;
  rulesInBundle: number;
}

/** The two whole-tree passes a scan makes. Supplied TOGETHER by the sharded path, or by neither. */
export interface ScanPasses {
  engine: EngineResult;
  census: CensusResult;
}

/**
 * THE DIGEST A FINDINGS DOCUMENT RECORDS OF THE PROFILE THE SCAN READ (`profile_digest`), over the
 * profile as `loadScanProfile` returned it. Exported (relay rework item 4, 2026-09-24) so that the
 * pre-launch step can check that the profile a launch brief hands on is the one the scan read, by
 * this function rather than by a second copy of it.
 */
export function profileDigest(profile: ScanProfile): string {
  return createHash("sha256").update(JSON.stringify(profile)).digest("hex");
}

export function prepareScan(opts: ScanOptions): PreparedScan {
  const startedAt = new Date().toISOString();
  // W5, 2026-09-02. Until today this line was `JSON.parse(readFileSync(...)) as ScanProfile` and the
  // cast was the whole of the checking: `scan-profile.schema.json`'s own description said so, in
  // capitals, from 2026-08-05. It is checked now, and a violation is REPORTED AND SURVIVED rather
  // than refused — the block is printed here, before the walk, so it is the first thing the command
  // says, and the run continues with each violating field treated as unanswered. An invalid profile
  // must never make a scan quieter; see profile.ts for why that direction is the only safe one.
  const loaded = opts.profilePath ? loadScanProfile(opts.profilePath, opts.profileLeftOut ?? []) : null;
  if (loaded && loaded.report !== "") console.log(loaded.report);
  const profile: ScanProfile | null = loaded ? loaded.profile : null;

  // The walker now opens `test/`, `spec/`, `fixtures/` and their siblings, and each rule's
  // `detector.file_globs` decides whether it is about them. Before 2026-07-28 the walker skipped
  // those trees for all 43 rules at once, which meant a rule could not opt in even in principle:
  // a live API key or a real person's data inside a test fixture is exposure whether or not the
  // file ships, and no rule could say so. Owner decision; see globs.ts and engine.ts:surfaceAllows.
  // The READ SCOPE of this run, compiled once from what the bundle carries. A caller that supplies
  // its own `files` list — the fixtures runner, the mutation harness, the reconciliation tests —
  // never reaches the walker and is therefore untouched by the scope: those callers name the exact
  // files they mean, and a scope that second-guessed them would silently delete half a fixture
  // suite. `readScopeFor(null, …)` is the same no-op for a bundle built before the scope existed.
  // Both are computed in `orientation-inputs.ts`: they are inputs of the orientation
  // sheet every adjudicator reads, so they live in a listed verdict-rules source and this scan reads the same ones.
  const { readScope, walked } = readScopeAndWalk({
    targetRoot: opts.targetRoot,
    bundleReadScope: opts.bundle.readScope,
    ...(opts.read ? { read: opts.read } : {}),
    ...(opts.files ? { files: opts.files } : {}),
    ...(opts.includeNonProduction !== undefined ? { includeNonProduction: opts.includeNonProduction } : {}),
  });
  // How many rules the BUNDLE ships, which is not `bundle.rules.length` once `--rules` has narrowed
  // it. `manifest.packs` is the only record of the whole, and it is read defensively: a caller that
  // hands `runScan` a hand-built manifest with no `packs` — which several gate tools do, planting a
  // two-rule bundle to exercise one mechanism — must not crash the scan over a number that is only
  // ever reported. Where the manifest says less than the run actually ran, the run wins, so the
  // sentence can never read "3 of 2".
  const rulesDeclaredByPacks = (opts.bundle.manifest.packs ?? []).reduce((n, p) => n + (p.rules ?? 0), 0);
  const rulesInBundle = Math.max(rulesDeclaredByPacks, opts.bundle.rules.length);
  // `auto`'S LAST TERM IS THE TREE, AND IT IS APPLIED HERE — before the display is opened, because
  // the display's opening line names the number of workers. Until this line existed the caller
  // applied it AFTER `prepareScan` returned, so a small tree printed `jobs 4` on stderr while stdout
  // printed `jobs: 1 (auto: tree below 256 KB, sequential)` a few seconds later (open item 4 of the
  // closing merge, 2026-09-16). `index.ts` reads the answer back off `PreparedScan.jobs`.
  //
  // THE BYTE TOTAL IS THE WALK'S OWN SIZES SUMMED — one pass over an array already in memory, not a
  // second `stat` of the tree. `walkTarget` stats every file it accepts for its size limit and keeps
  // the number (`WalkResult.sizes`), and this is the reader the merge used to give a second stat
  // pass of its own: 5,721 redundant `stat` calls on a large Node CMS at `--jobs 4` (independent verification
  // note §9.1, 2026-09-16). A caller that supplied its own `files` list walked nothing and has no
  // sizes, so no tree-size term can be applied to it and its number is left as it came.
  const jobs =
    opts.jobs === undefined
      ? null
      : walked.sizes === undefined
        ? opts.jobs
        : jobsForWalk(
            opts.jobs,
            walked.sizes.reduce((a, b) => a + b, 0),
          );
  // THE STATUS DISPLAY IS OPENED HERE AND NOWHERE ELSE, because this is the one function both
  // paths call before a detector reads a byte and it is contracted to run once per scan. The
  // sequential path reaches it through `runScan`; the sharded path calls it itself and then builds
  // the pool. Putting it in `runScan` instead would open the display AFTER the sharded run had
  // finished, which is the one moment a progress display is of no use to anybody.
  // THE SIZES COME FROM THE WALK AND ARE NOT TAKEN AGAIN. `walkTarget` stats every file it accepts
  // (its own `MAX_FILE_BYTES` test), so the display's byte total is that stat's number rather than a
  // second pass over the tree, which is what this seam used to cost when the stream was on
  opts.progress?.start({
    targetRoot: opts.targetRoot,
    files: walked.files,
    ...(walked.sizes ? { sizes: walked.sizes } : {}),
    // THE FINISHED NUMBER, from the line above, and the display holds no other. A caller with a
    // display but no `jobs` is running this thread's sequential path, which is `jobs 1`.
    jobs: jobs === null ? 1 : jobs.jobs,
  });
  return { startedAt, loaded, profile, readScope, walked, jobs, rulesInBundle };
}

// The census pass moved to `orientation-inputs.ts`: its result holds the dependency
// inventory the orientation sheet is built from. Re-exported so existing callers keep their import.
export { runCensusPass };

/** The engine's partially-read rows with the census's stops on them; see the caller. */
export function withCensusStops(
  rows: PartiallyReadFile[],
  stops: CensusStoppedFile[],
  notRead: { file: string }[],
  walkOrder: string[],
): PartiallyReadFile[] {
  if (stops.length === 0) return rows;
  const notReadFiles = new Set(notRead.map((n) => n.file));
  const out = rows.map((r) => ({ ...r }));
  const byFile = new Map(out.map((r) => [r.file, r] as const));
  for (const { file, ...stop } of stops) {
    if (notReadFiles.has(file)) continue;
    const row = byFile.get(file);
    if (row) row.census_stopped_for_time = stop;
    else {
      const added: PartiallyReadFile = { file, census_stopped_for_time: stop };
      out.push(added);
      byFile.set(file, added);
    }
  }
  const order = new Map(walkOrder.map((f, i) => [f, i] as const));
  return out.sort((a, b) => (order.get(a.file) ?? 0) - (order.get(b.file) ?? 0));
}

/**
 * Run both whole-tree passes SEQUENTIALLY, in this thread — the path `--jobs 1` takes and the only
 * path anything but the `scan` command has ever taken.
 */
export function runScanPasses(opts: ScanOptions, prepared: PreparedScan): ScanPasses {
  const progress = opts.progress;
  return {
    engine: runBuiltin(
      opts.bundle.rules,
      opts.targetRoot,
      prepared.walked.files,
      opts.scope ?? "project",
      prepared.profile,
      // `undefined` leaves the prefilter exactly where it was — the CLI's `--no-prefilter` reaches
      // the engine through the environment, not through this call (see `runBuiltin`).
      undefined,
      opts.fileBudgetMs ?? Infinity,
      // The step-5 progress seam, after the budget: `undefined` whenever the display is off.
      progress ? (record) => progress.file(record) : undefined,
      // No test seams on this path.
      undefined,
      // Whether every candidate carries its kind facts. Resolved ONCE, here and in the sharded path
      // beside it, from the same function — the two halves of one scan must not answer it apart.
      opts.kindCensus ?? resolveKindCensus(),
      // The labels are redacted, with the CLI's own credential patterns, never a bundle's — see `compileForScan`.
      true,
    ),
    census: runCensusPass(opts.targetRoot, prepared.walked.files, opts.fileBudgetMs ?? Infinity),
  };
}

/**
 * @param precomputed the two whole-tree passes, already run — the worker pool's result. Omitted by
 *   every caller but `runScanSharded`, and then this function runs them itself, synchronously, in
 *   this thread. It is one argument and not two so that a caller cannot supply an engine result
 *   from one walk beside a census from another: `runScanSharded` is the only thing that builds it,
 *   out of the one `PreparedScan` it also passes in.
 */
export async function runScanSharded(
  opts: ScanOptions,
  jobs: ResolvedJobs,
  rulesSpec?: string,
  /**
   * The walk, when the caller has already taken it — and it carries the per-file sizes the queue
   * needs (`PreparedScan.walked.sizes`), so the tree is stat'ed once and by the walker. `index.ts`
   * has it: `auto` cannot decide how many workers to build without the tree's byte total, and
   * `prepareScan` PRINTS the scan-profile report, so it must be called once per scan and never
   * twice. Omitted — every caller but `index.ts` — and this function walks itself, exactly as it
   * did before.
   */
  alreadyWalked?: PreparedScan,
): Promise<Findings> {
  const prepared = alreadyWalked ?? prepareScan(opts);
  // THE CENSUS, IN ITS OWN WORKER, STARTED BEFORE THE DETECTORS AND AWAITED AFTER THEM (owner
  // decision, 2026-09-15; step3-workers/proposal.md §A.5 and open decision 2).
  //
  // It is a second, independent pass over the same file list with its own collectors — census.ts
  // says why the engine is not reused for it — and it is NOT SHARDED: it holds cross-file state
  // that is last-wins in walk order (`xcodeGenAliases`, whose own comment explains that XcodeGen
  // splits a project across manifests that `include:` each other), and sharding it would buy 4 %
  // and put that map at risk for it.
  //
  // MEASURED BOTH WAYS rather than argued — two binaries, run alternately, three times each
  // (2026-09-15). On a mid-sized tree, where the census is 2,972 ms of a sequential pass (the design's own
  // §A.5 figure, quoted rather than re-measured because `census.ts` is code this lane has not
  // touched), moving it off this thread is worth 8.2 % of the whole scan at `--jobs 4`
  // (12.24 s -> 11.23 s) and 4.3 % at
  // `--jobs 2` (15.24 s -> 14.58 s), with every one of the three runs faster than every one of the
  // three it is compared with. On a small tree, where the census is 169 ms, it is a tie
  // inside the noise (4.89 s -> 4.93 s at `--jobs 4`, 3.86 s both ways at `--jobs 2`): the tree is
  // too small for the overlap to pay for the thread, and too small for it to cost anything either.
  // Peak resident memory is unchanged in both (this worker loads no bundle and compiles no rule).
  // The document is byte-identical either way, which is what `test:jobs-determinism` and the
  // baseline hashes hold.
  const censusPass = runCensusInWorker(opts.targetRoot, prepared.walked.files, opts.fileBudgetMs ?? Infinity);
  // MARKED OBSERVED, not handled. The real handling is the `await` at the end of this function,
  // which re-raises whatever this rejected with. But that await is only reached if the POOL
  // succeeds, and the pool has a live way of failing — a prefilter self-check abort inside a
  // worker (§E.3). Were both to fail, the census's rejection would sit unobserved while the pool's
  // error propagated, and Node would print an unhandled-rejection trace over the four-line report
  // the person is meant to read. One no-op catch closes that, and changes nothing else: the
  // promise still rejects, and the await below still throws.
  censusPass.catch(() => undefined);
  const engine = await runShardedBuiltin({
    // The bundle DIRECTORY, not the loaded bundle: every worker loads and integrity-checks it
    // itself, and applies `--rules` with the same `selectRules` this command applied, so the
    // narrowing is one implementation rather than a rule list shipped over `postMessage` (see
    // worker-entry.ts, which refuses to scan if its own rule ids differ from this thread's).
    bundleDir: opts.bundle.dir,
    ...(rulesSpec === undefined ? {} : { rulesSpec }),
    rules: opts.bundle.rules,
    targetRoot: opts.targetRoot,
    files: prepared.walked.files,
    // THE WALKER'S OWN SIZES (`WalkResult.sizes`), handed on rather than stat'ed a second time —
    // the same numbers `jobsForWalk` was decided on above. Absent only for a caller that supplied
    // its own `files` list and never walked, and then the pool stats them itself (`measureWalk`).
    ...(prepared.walked.sizes === undefined ? {} : { sizes: prepared.walked.sizes }),
    scope: opts.scope ?? "project",
    // Unread there, as it is unread in `runBuiltin` — see `ShardedRunOptions.profile` for why the
    // field exists at all. It is passed rather than left out so that the two paths carry the same
    // value and a future reader who restores the gate on one path meets the note on both.
    profile: prepared.profile,
    jobs: jobs.jobs,
    shuffleSeed: jobs.shuffleSeed,
    // Per file and per worker, so this is the same ceiling `--jobs 1` applies and not a share of one.
    fileBudgetMs: opts.fileBudgetMs ?? Infinity,
    // Completion order, on this thread, as each chunk comes home — see `ShardedRunOptions`.
    ...(opts.progress ? { onRecord: (record) => opts.progress!.file(record) } : {}),
    // Crosses to every worker in `WorkerInit`, resolved once here — see `resolveKindCensus`.
    kindCensus: opts.kindCensus ?? resolveKindCensus(),
  });
  const census = await censusPass;
  return runScan(opts, prepared, { engine, census });
}

/**
 * The scan, assembled.
 *
 * @param prepared the walk and everything decided before it — see `prepareScan`. Omitted by every
 *   caller but the sharded path.
 */
export function runScan(opts: ScanOptions, prepared?: PreparedScan, precomputed?: ScanPasses): Findings {
  const prep = prepared ?? prepareScan(opts);
  const { startedAt, loaded, profile, readScope, walked, rulesInBundle } = prep;
  const passes = precomputed ?? runScanPasses(opts, prep);

  const {
    matches,
    suppressed,
    corroborationSuppressed,
    filesScanned,
    filesSkipped,
    filesNotRead,
    filesPartiallyRead: engineFilesPartiallyRead,
    filesCommentSyntaxUnregistered,
    filesReadFromUtf16,
    filesReadNotUtf8,
    filesCommentFormReadAsCode,
    commentFormsReadAsCode,
    derivedViewsBuilt,
    derivedViewsFailed,
    gatesOpenedByScope,
    joinedViewsBuilt,
    joinedViewsNotApplicable,
    joinedConstructsRefused,
    joinedOuterDuplicatesDropped,
    structural,
    filesOnSurface,
  } = passes.engine;

  // Files the per-file wall-clock budget stopped, READ OFF THE TWO ARRAYS rather than counted by the
  // engine — `coverage_limits`' own rule applied one field earlier: every number in this document
  // must be checkable against the field beside it, and a counter kept separately is a second tally
  // that can disagree with what it counts. Both arrays are written on every scan, so this is 0 on
  // every scan in which nothing was stopped, and the key it feeds is then not written at all (see
  // `stats` below and `Findings.stats.files_stopped_for_time`).
  // THE CENSUS'S STOPS, each named in the one list a reader looks in for a file not read
  // whole: on the engine's row for the file where there is one, else on a row of its own, in walk order.
  // A file the engine did not read at all is already in `files_not_read`; its census stop stays named in
  // the census's own `files_stopped_for_time`.
  const filesPartiallyRead = withCensusStops(engineFilesPartiallyRead, passes.census.files_stopped_for_time ?? [], filesNotRead, walked.files);
  const filesStoppedForTime =
    filesNotRead.filter((n) => n.reason === "time-budget").length +
    filesPartiallyRead.filter((p) => p.stopped_for_time !== undefined || p.census_stopped_for_time !== undefined).length;

  // Every rule's precondition status against this profile, computed once here and read by both
  // halves of the document below. Two consumers must agree on it exactly — a candidate saying a
  // question is open while the roster says it is answered would be the "second copy" defect
  // the project's rules name — and the walk is cheap but not free at 63 rules times two arrays.
  const preconditions = new Map(
    opts.bundle.rules.map((r) => [r.id, preconditionStatus(r, profile)] as const),
  );

  // IS THIS SCAN THE CENSUS ARM? Resolved once, here, above everything that turns on it: the copy
  // of the rule's `reading_class` onto the candidate (in the loop below) and `splitOversizedGroups`
  // (further down) must not be able to disagree about which arm this scan is, and
  // `resolveKindCensus` reads `process.env`, which two reads could in principle see differ.
  const kindCensusOn = opts.kindCensus ?? resolveKindCensus();

  // Collapse matches that share a fingerprint into a single candidate carrying every location,
  // so one issue is adjudicated once no matter how many times it appears in the code.
  const byFp = new Map<string, Candidate>();
  // CREDENTIAL REDACTION OF THE LABEL (R3′): old label to new, for every label a candidate located
  // credential material in, unioned over every candidate with that label so the new label is a
  // function of the old one — every same-kind group keeps exactly its members. Applied below where
  // the label is copied onto the location, the one place a label leaves a match, so the census, the
  // reading plan, the payload catalogue and this document all hold the same label.
  const redactedLabel = redactedLabelsOf(matches);
  const printed = productPrintedRedaction();
  for (const m of matches) {
    const spec = m.rule.fingerprint_spec ?? "default";
    // `directory` collapses every hit in one directory into a single candidate carrying every
    // location. Added 2026-07-27 for the volume problem the owner named: a tree of forty-seven
    // near-identical files should be one question the agent answers once, with the forty-seven
    // locations still in the output, rather than forty-seven adjudications or — worse — a rule
    // narrowed until the tree disappears. W4 measured exactly this shape: 47 hits under
    // `examples/`, 46 of them the same template file, counted as 47 separate facts.
    // The directory is the file's immediate parent, which is the reading a rule author will
    // predict; a rule wanting coarser grouping already has `file` and `project`.
    // `directoryOf` is imported from engine.ts rather than written here: `detector.gate_scope`
    // reads the same word, and a rule author who sets `fingerprint_spec: "directory"` and
    // `gate_scope: "directory"` expects one answer from both. See its own comment for why.
    /* The id and the sub-shape are digests every
     * findings document, report and record carries, and the same on every computer; a digest of a line holding a
     * guessable credential lets anyone holding the file recover it by hashing candidates. Both are taken over the line's
     * value-free form (every credential region the printed redaction marks, as a marker with no digest): unchanged for
     * a line with nothing to redact, so no other id moves. */
    const freeLine = valueFreeText(productPrintedRedaction(), m.lineText);
    const fp =
      spec === "project"
        ? fingerprint(m.rule.id, "", "")
        : spec === "directory"
          ? fingerprint(m.rule.id, directoryOf(m.file), "")
          : spec === "file"
            ? fingerprint(m.rule.id, m.file, "")
            : fingerprint(m.rule.id, m.file, freeLine);
    // `end_line` is set only where the reading that produced the candidate knows it — today, only
    // the structural one. A wrapped element opens on the reported line and the defect is the absence
    // of something several lines down, so an adjudicator handed one line number would be reading
    // half a sentence.
    // `resolved_from` is set only where the local-value reading is what made the line match. It is
    // per LOCATION and not per candidate, because two locations collapsed into one candidate may
    // have been reached through different definitions — or one directly and one through a hop — and
    // a reader checking the second must be told about the second. Each hop names its definition
    // line and never quotes it: since 2026-09-23 findings.json carries no raw source text, so the
    // reader opens `definition_line` in `file` (the hop's in-memory `definitionText` stays with the
    // reading and is not written).
    const location = {
      file: m.file,
      start_line: m.line,
      ...(m.endLine ? { end_line: m.endLine } : {}),
      ...(m.hops && m.hops.length > 0
        ? {
            resolved_from: m.hops.map((h) => ({
              name: h.name,
              definition_line: h.definitionLine,
            })),
          }
        : {}),
      // `corroborated_from` on the same terms, one field over: set only where a wider
      // `detector.gate_scope` is what let this candidate through, and per LOCATION because two
      // locations collapsed into one candidate may have had their gates opened by different files —
      // or one by another file and one by its own. The engine hands over the record it built during
      // the walk, unmapped, so the field names exist in one place.
      ...(m.corroboratedFrom ? { corroborated_from: m.corroboratedFrom } : {}),
      // `corroborated_in_project` is the annotation a rule in `gate_mode: "annotate"` carries — one
      // fact layer 1 computed about the WHOLE declared scope, written on every location of the
      // clauses `detector.gate_applies_to` names and on no other location of any rule. It is
      // per location for the mechanical reason the two fields above are: the engine writes it on
      // the match, and two matches collapsed into one candidate are not guaranteed to be the same
      // rule's subject. `!== undefined` and not a truth test — `false` is the answer this mechanism
      // exists to deliver, and a truth test would drop exactly the locations that carry it.
      ...(m.corroboratedInProject !== undefined ? { corroborated_in_project: m.corroboratedInProject } : {}),
      // Written only beside `true`, which is the only case in which there is a file a reader can
      // open. Same record, unmapped, as `corroborated_from` above.
      ...(m.corroboratedInProjectFrom ? { corroborated_in_project_from: m.corroboratedInProjectFrom } : {}),
      // `joined_from` on the same terms again: set only where the joined-construct view is what made
      // the line match, and per LOCATION because two locations collapsed into one candidate may have
      // been folded from different spans — or one from a fold and one from its own single line. The
      // engine hands over the span it built during the walk, unmapped, so the field names exist in
      // one place.
      ...(m.joinedFrom ? { joined_from: m.joinedFrom } : {}),
      // The opening lines of the ENCLOSING constructs that were collapsed into this location — one
      // construct reported at several depths, reported at the innermost report that reads the same
      // thing. Written only where this location absorbed one, which is nowhere at all for a rule
      // that does not declare the joined view. It is on the location and not inside `joined_from`
      // because the report that absorbs an enclosing fold is often NOT itself fold-derived — a plain
      // matched line inside the span — and such a location has no `joined_from` to hang it on.
      ...(m.absorbedOpenings && m.absorbedOpenings.length > 0
        ? { also_opens_at: m.absorbedOpenings }
        : {}),
      // The kind facts, where the run computed them (`--kind-census on`, the default). Four fields,
      // copied and not recomputed: the matcher wrote them where the line's own text still existed,
      // and `lineText` above is trimmed and cut to 300 characters. With the census off `kindFacts`
      // is `undefined` and the spread adds nothing, which is what makes such a document byte-for-byte
      // the one this scanner wrote before the census existed.
      //
      // ON EVERY LOCATION and not only on the ones that end up in a census: the key is what a reader
      // of this document re-derives a candidate's groups from, and a field present on some
      // candidates and absent on others would make that reader's rule conditional on a count. The
      // cost is measured and stated in `findings.schema.json` rather than left to be discovered.
      ...(m.kindFacts
        ? {
            clause: m.kindFacts.clause,
            matched_token: redactedLabel.get(m.kindFacts.matched_token) ?? m.kindFacts.matched_token,
            context_class: m.kindFacts.context_class,
            sub_shape:
              freeLine !== m.lineText || (m.kindRedactions?.length ?? 0) > 0
                ? sha16(`value-free\u0000${m.kindFacts.clause}\u0000${freeLine}`)
                : m.kindFacts.sub_shape,
          }
        : {}),
      // The place's text fingerprint (place-key.ts, which says exactly what it
      // covers): how a later run tells the same place from a new one whatever line it moved to. Taken from the line as
      // the report and the log would print it, so it holds nothing of a credential.
      line_key: lineKeyOf(printed, m.lineText),
    };
    const existing = byFp.get(fp);
    if (existing) {
      existing.locations.push(location);
      continue;
    }
    byFp.set(fp, {
      finding_id: fp,
      rule_id: m.rule.id,
      title: m.rule.title,
      severity: m.rule.severity,
      rule_confidence: m.rule.rule_confidence,
      locations: [location],
      context_questions: m.rule.context_questions,
      // The applicability questions this candidate's rule turns on and THIS PROFILE DOES NOT
      // ANSWER. Present only when there are any, so an absent key is "this rule asked nothing that
      // was left open" and never "the questions were answered".
      //
      // Before 2026-08-25 an unanswered question removed the rule from the scan, so this candidate
      // did not exist and nothing had to be said. It runs now (engine.ts `preconditionStatus`), and
      // the ruling is that its candidates must reach layer 2 **carrying the
      // open question** — a candidate raised on an unanswered premise must not read like one raised
      // on an answered premise. The adjudicator puts the question to the person; it never answers it
      // from the code (a fact about the product is asked, never inferred from source
      // vocabulary).
      ...((preconditions.get(m.rule.id)?.unanswered ?? []).length > 0
        ? { unanswered_preconditions: [...(preconditions.get(m.rule.id)?.unanswered ?? [])] }
        : {}),
      // The applicability questions this candidate's rule turns on and THIS PROFILE ANSWERED IN A
      // WAY THAT PUTS THE RULE OUT OF SCOPE. Present only when there are any.
      //
      // **This is the contradiction, on the candidate itself**: the person declared the rule's
      // subject out of scope and the detector found the construct anyway. Before 2026-08-27 the
      // answer removed the rule from the scan, so this candidate did not exist and the document
      // said `state: not-evaluated` — measured over the eight pass-1 runs of 2026-08-26, 21 of the
      // 69 located misses were exactly that, and one tree declared `audience.consumer: false`
      // while shipping a public careers portal a job applicant uses.
      //
      // A SIBLING OF `unanswered_preconditions`, NEVER THE SAME FIELD, and the two must not be
      // merged: that one says *nobody answered*, this one says *somebody answered no and the
      // scanner found something anyway*. They differ in what the reader is asked to do — an
      // unanswered question is put to the person, an answered one is put back to them against the
      // line that contradicts it — and a rule can carry both at once.
      //
      // It is NOT `unmet_preconditions`, which keeps its shipped meaning of "the rule never ran"
      // and which `SKILL.md` step 3b tells an agent to report as `not_applicable`. Reusing that
      // name here would have an agent report `not_applicable` about a rule that raised a
      // contradiction, which is the failure this whole change exists to end.
      //
      // Like `unanswered_preconditions`, it is not a reason to drop, downgrade or defer the
      // candidate, and the adjudicator never resolves the contradiction from the code: a fact about
      // the product is asked of the person.
      ...((preconditions.get(m.rule.id)?.unmet ?? []).length > 0
        ? { declared_inapplicable_preconditions: [...(preconditions.get(m.rule.id)?.unmet ?? [])] }
        : {}),
      legal_basis_refs: m.rule.legal_basis.map((b) => b.cite),
      // When the duty behind those citations starts to apply. Declared by 49 of the 56 rules,
      // validated by the build against `rule.schema.json`, shipped inside `rules.json` — and copied
      // into no output at all until 2026-08-13, so the only way an author could get an applicability
      // date in front of a reader was to write it into prose. `eu-cra-001` and `eu-cra-002` do
      // exactly that (`… from 2027-12-11` inside `title`), and that is the workaround; a consumer
      // being able to read the date as data is the fix. The class is on record: a checklist row was
      // proposed with "every finding must be worded as preparation" and shipped with the date in no
      // parsed field.
      //
      // **Copying it changes nothing about what fires.** Every rule that raised a candidate before
      // this line existed raises the same candidate now, including the three whose date is still in
      // the future (`ai-prohibited-004` 2026-12-02, `eu-cra-001` and `eu-cra-002` 2027-12-11).
      // Whether a not-yet-applicable rule should still produce candidates is a product decision that
      // belongs to the owner, and nothing here answers it: the date is surfaced, not acted on.
      //
      // Absent for the seven `baseline-*` rules, which declare none. That absence means "this rule
      // states no date", never "the duty applies now" — they rest on several instruments in three
      // jurisdictions with different start dates, which one scalar field cannot express.
      effective_date: m.rule.effective_date,
      // The kinds of personal data the rule's author says the matched construct involves. Same
      // defect class and same fix as `effective_date` directly above: declared by 53 of the 56
      // rules, validated by the build against `rule.schema.json`, shipped whole inside `rules.json`
      // — and copied into no output at all until 2026-08-13, so no reader of a scan could see what
      // kind of data a candidate was about except by inferring it from the title.
      //
      // **These are the rule author's own labels, not a validated taxonomy, and a consumer must not
      // treat them as one.** `rule.schema.json` calls them fideslang keys and constrains their
      // shape — lowercase dotted segments, no duplicates — but never their membership: there is no
      // enum, no registry file in this repository, and the rule base itself records the keys as
      // unverified against published fideslang with several of them house extensions (see the
      // comments in eu-special-categories-003 and -004's own rule.yaml). A census on 2026-08-13
      // found 33 distinct values over 99 entries carrying three unreconciled splits. The owner
      // approved reconciling them the same day and it was done: user.behaviour, user.credentials and
      // user.date_of_birth were each shown to be a key no current fideslang release carries — the
      // first appears in none at all, the other two were 1.4.4 keys that 2.0.0 removed — so no merge
      // lost a distinction. The census now reads 30 distinct values over 99 entries, 90 of them
      // fideslang 2.0.0 keys.
      //
      // WHAT REMAINS, and it is a different thing: one string can be a parent of another
      // (user.device beside user.device.cookie_id). fideslang declares that relation itself, so it is
      // granularity rather than a split, and the hazard sits in a consumer that compares dotted paths
      // as opaque strings. Five house keys over nine entries also remain, carried by no fideslang
      // release; one of them (user.genetic) is the same class as the three fixed but is not a split,
      // so it was left for the owner. Group or display these strings; never conclude from a
      // difference in spelling that two rules mean different things.
      //
      // **Copying it changes nothing about what fires**, and it is not a finding about the scanned
      // code: no detector reads this field, nothing here asserts that the repository actually holds
      // any of the named categories, and no consumer may read it as a reason to drop, downgrade or
      // defer a candidate.
      //
      // Three declarations, three different statements, all three preserved exactly: a populated
      // list names categories; `[]` says the author considered the question and named none (8
      // rules); absent says the rule states nothing at all (3 rules — the two eu-cra rules are
      // product-security duties with no personal-data object, and eu-data-act-001 argues its own
      // absence in terms, its duty being expressly about any data rather than personal data).
      //
      // A fresh array rather than the rule's own. This is the first array-valued field carried into
      // a candidate, and without the copy every candidate of a rule would share one array instance
      // with the loaded bundle, so a single downstream `push` would rewrite the rule for every
      // later candidate in the process. Nothing mutates it today; the copy costs one spread and
      // removes the class of bug rather than relying on nobody ever writing it.
      data_categories: m.rule.data_categories ? [...m.rule.data_categories] : undefined,
      // WHICH UNIT THIS CANDIDATE'S RULE IS READ IN, what its items are, and where the item list
      // comes from — copied verbatim from the rule, exactly as `effective_date` and
      // `data_categories` above are, and for the same reason: a field authored on the rule,
      // validated by the build and shipped inside `rules.json` reaches no reader until something
      // copies it out.
      //
      // **Without this line the whole reading_class path is inert on a real run.** The field is
      // lifted into the payload's `rules` block by `RULE_OWNED_IN_PAYLOAD` in `context.ts` (design
      // section 10.6), and `collectRuleProse` builds that block from the CANDIDATE, not from the
      // bundle's rule; `checkReadingCoverage` in `reading.ts` reads it through `readingClassOf`,
      // also off the candidate, to decide whether the enumeration completeness check applies. Both
      // therefore see nothing at all unless the candidate carries the field, however many rules
      // declare one.
      //
      // **THE CLASS TRAVELS WITH THE CENSUS**, and that is the exact condition on the copy below:
      // it is written when `kindCensusOn` is true and the rule declares one, and not otherwise.
      // The reason is that the reading rule the class selects IS the census's mechanism — the class
      // decides how the seat's catalogue is read (`planReading` in `kind-census.ts`), and with the
      // census off no catalogue, no plan and no seat of that kind exists; the seat gets the
      // pre-census document and the pre-census texts apply to it. Carrying the field into the off
      // arm would put a field in the document that nothing in that arm reads.
      //
      // It is also what makes the off arm PRISTINE, and that is measurable: with the census off
      // this scanner writes the document it wrote before any of U1, U2 and U3 existed, byte for
      // byte, which is what the three pinned trees in the baseline hold. Until the
      // condition was added the copy ran on both arms, the 55 rules gained the field at U3, and the
      // off arm's documents differed from the pins by exactly that field on 14 of 32 candidates on
      // one small tree and 34 of 128 on a mid-sized one.
      //
      // READ THROUGH A CAST AND NOT DECLARED ON `Rule`. The shape is unit U3's and its single
      // original is `rule.schema.json`: `class`, with `item` and `item_source` where the class is
      // an enumeration and `limbs[]` where it is `mixed`. A TypeScript restatement of that shape
      // here would be a forbidden second copy, and it would be the copy that falls
      // behind when U3's schema moves. `readingClassOf` in `reading.ts` reads the field the same
      // way and says the same thing.
      //
      // A FRESH DEEP COPY rather than the rule's own object, for the reason `data_categories`
      // above is copied rather than shared: without it every candidate of one rule would hold the
      // one instance the bundle loaded, and a single downstream write would rewrite the rule for
      // every later candidate in the process. Nothing mutates it today; the copy removes the class
      // of bug instead of resting on nobody ever writing it.
      ...(!kindCensusOn ||
      (m.rule as unknown as Record<string, unknown>).reading_class === undefined
        ? {}
        : {
            reading_class: structuredClone(
              (m.rule as unknown as Record<string, unknown>).reading_class,
            ),
          }),
      // The rule's role
      // (`finding_role`), copied where the rule declares one and absent otherwise (absent is `duty_check`), so it reaches the
      // seat in the payload's `rules` block (`RULE_OWNED_IN_PAYLOAD`, context.ts) and the adjudicator's rule 6c can read it.
      // It changes nothing that fires and no finding id: a candidate of a rule that declares no role is byte for byte as before.
      ...((m.rule as unknown as Record<string, unknown>).finding_role === undefined
        ? {}
        : { finding_role: (m.rule as unknown as Record<string, unknown>).finding_role }),
      // What the rule's duty is about (`duty_about`), copied where the
      // rule declares one and absent otherwise (absent declares nothing, and never takes row 4), as `finding_role` is: it reaches the seat's rule block and
      // the second look's launch side. A candidate of a rule that declares none is byte for byte as before.
      ...((m.rule as unknown as Record<string, unknown>).duty_about === undefined
        ? {}
        : { duty_about: (m.rule as unknown as Record<string, unknown>).duty_about }),
      // What the matched line establishes and — the part several rules use it for — what it does
      // not. Authored in all 56 rules, linted by the build for legality assertions and for CJK, and
      // shipped inside `rules.json`, but until 2026-08-11 it was copied into no output at all, so
      // the sentence reached neither the adjudicating agent nor the user. That is not tidiness:
      // eu-retention-001 discloses the `:41` artefact here and nowhere else (the cited line may be
      // the setting's name rather than the line that bound), and eu-consent-021, eu-consent-017 and
      // eu-cra-002 use it the same way to say what a candidate is NOT a finding of. A disclosure
      // that reaches no reader is not a disclosure — an internal record
      // -2026-08-10.md §7.5 recorded the gap the day the rule started relying on it.
      //
      // Copied verbatim, `{file}` and `{line}` placeholders intact. No substitution machinery
      // exists anywhere in this codebase, and two reasons say it should stay that way — the first
      // the stronger. (1) Substituting the first location would misdescribe every candidate that
      // carries more than one: a `project`- or `file`-scoped rule collapses every hit into one
      // candidate, and three of the templates tell the reader to go and read all of `locations`, so
      // naming one line as *the* matched line is the misreading those rules exist to prevent.
      // (2) A path out of the scanned repository, interpolated here, would put text that repository
      // controls inside a field the adjudicator reads as the rule's own words. The path already
      // reaches the agent in `locations`, where it is plainly data.
      //
      // What the build actually screens this field for, stated exactly because this comment named
      // the wrong lint until 2026-08-11: ASSERTION_PATTERN (legality claims), the field-scoped CJK
      // lint, and — added on 2026-08-11, together with `title` — INJECTION_PATTERN. See
      // tools/build-bundle.mjs and the dated corrections in an internal record No lint
      // screens the scanned repository's own text, which is the whole of reason (2).
      // The skill tells the orchestrator what the two placeholders stand for.
      evidence_template: m.rule.evidence_template,
      remediation_template: m.rule.remediation_template,
    });
  }

  // EVERY RULE IN THE BUNDLE IS EVALUATED. Until 2026-08-27 this line was
  // `opts.bundle.rules.filter((r) => preconditionsMet(r, profile))` and the complement was reported
  // as `state: not-evaluated` — a rule that read no line because of an answer in a profile the runs
  // themselves describe as drafted and unconfirmed. See `engine.ts` `preconditionsMet` for the
  // measurement that priced removing the switch, and `declaredInapplicable` below for what the
  // answer is used for instead.
  const applicable = opts.bundle.rules;
  // Rules that ran on a question this profile leaves open. Counted rather than only listed, because
  // `stats` is what the console line and the `--fail-on-unreviewed` message are assembled from, and a reader
  // who never opens the JSON must still be told the number.
  const ranOnUnanswered = applicable.filter(
    (r) => (preconditions.get(r.id)?.unanswered ?? []).length > 0,
  );
  // Rules that ran although the profile's own answers put them out of scope. The same shape as
  // `ranOnUnanswered` and counted for the same reason, and `preconditionsMet` is called rather than
  // the `unmet` array re-tested, so the predicate that decides the label has exactly one definition.
  const declaredInapplicable = applicable.filter((r) => !preconditionsMet(r, profile));

  // ------------------------------------------------------------------------------------------
  // The roster of rules that produced nothing: the absence of a finding is `unknown`,
  // never `clean`.
  //
  // Until 2026-08-19 this document contained findings and nothing else, so a rule that ran over
  // the whole tree and matched none of it was indistinguishable — in the JSON, in the SARIF and
  // on the console — from a rule that never ran, from a rule whose declared surface met no file
  // here, and from a repository that is genuinely in order. The adjudicating agent could not know
  // that a rule existed, let alone that it had run and found nothing, so `SKILL.md` step 3 told it
  // to "report 'no candidates found' and stop". That is the one sentence a compliance tool must
  // never be able to produce on the strength of a detector having failed to reach the code.
  //
  // The size of the silence is measured rather than asserted: 212 of the 450 G3 mutants that
  // record it take their whole file to zero candidates.
  // Those are deliberate one-token edits to a fixture the rule is known to catch, so each
  // is a spelling layer 1 does not have — and in every one of the 212 the whole file goes quiet.
  //
  // THREE THINGS THIS DELIBERATELY DOES NOT DO.
  //   1. It does not evaluate jurisdiction. `jurisdiction` is copied verbatim here and this array
  //      applies nothing. Since 2026-09-22 the comparison with `profile.distribution_regions` is
  //      COMPUTED once per rule, in `per-rule-applicability.ts`, and written into
  //      `per_rule_applicability` beside these rows — where a rule that raised nothing and is out
  //      of jurisdiction carries the answer the orchestrator needs for its `unknown_rules` entry.
  //      Computed there, applied by the skill, and still applied by nothing in this scan: the
  //      block removes no row and changes none. See engine.ts's `preconditionsMet` for the owner
  //      correction of 2026-07-27 that took the per-rule region GATE out of the scan, and note
  //      that `["EU"]` against `["DE","FR"]` is a judgement rather than a string test.
  //   2. It does not repeat a rule that fired. Those are in `candidates`; the two arrays partition
  //      the bundle's rules and never overlap.
  //   3. It changes no candidate. Nothing below is read by the engine, by the fingerprint collapse
  //      or by the applicability annotation; every count is derived from work that had already
  //      been done.
  const firedRuleIds = new Set(matches.map((m) => m.rule.id));
  // Summed once, here, rather than per rule inside the loop: the array a reader can open is the
  // authority, and recomputing the number from the rule's patterns would be a second copy that
  // could disagree with it.
  const corroborationByRule = new Map<string, number>();
  for (const s of corroborationSuppressed) {
    corroborationByRule.set(s.rule_id, (corroborationByRule.get(s.rule_id) ?? 0) + s.matches);
  }
  const rulesWithoutCandidates: RuleWithoutCandidates[] = opts.bundle.rules
    .filter((r) => !firedRuleIds.has(r.id))
    .map((r) => {
      const { unmet, unanswered } = preconditions.get(r.id) ?? { unmet: [], unanswered: [] };
      const removed = corroborationByRule.get(r.id) ?? 0;
      return {
        rule_id: r.id,
        title: r.title,
        // ALWAYS `evaluated`, because from 2026-08-27 nothing stops a rule from running: a profile
        // answer labels its output and never removes it. `state` was
        // `unmet.length === 0 ? "evaluated" : "not-evaluated"` until then.
        //
        // **`not-evaluated` is kept in the schema and in every reader, and is not dead.** The eight
        // pass-1 findings documents on disk carry it, `sarif.ts` maps it, `censusRoster` counts it
        // and a test builds rows in that state; a consumer that stopped being able
        // to read a document written last week would be a subtraction of its own. What changed is
        // that this scanner no longer WRITES it — see `declaredInapplicable` above.
        state: "evaluated" as const,
        // Fresh arrays rather than the rule's own, for the reason `data_categories` above is
        // copied: without it every emitted record would share one array instance with the loaded
        // bundle, and one downstream `push` would rewrite the rule for the rest of the process.
        jurisdiction: [...r.jurisdiction],
        evidence_template: r.evidence_template,
        // `context_questions` and `legal_basis` are deliberately NOT copied here, and the first
        // draft of this array did copy both. Measured on the demo tree: with them the array is
        // 698 KB of an 879 KB document — 274 KB of questions and 377 KB of quoted provisions for
        // 45 rules that raised nothing — against 47 KB without. Layer 2 runs in the user's agent
        // and the user pays for every byte of it, and both fields ship whole inside
        // the bundle the orchestrator already has: the skill reads them out of
        // the `rules.json` of the bundle the scan names (its `bundle:` line) for the one or two rules it decides to investigate,
        // rather than being handed all 56 rules' worth on every scan. A candidate carries them
        // because a candidate is posted to a fresh subagent with no bundle beside it; a roster row
        // is read by the orchestrator, which has one. `evidence_template` stays because it is the
        // sentence that says what the rule was looking for, it is what the reader needs to decide
        // whether this silence is surprising, and it is small — 52 to 3,665 characters, 34 KB over
        // all 45.
        effective_date: r.effective_date,
        // The applicability questions this rule turns on and the profile does not answer. Emitted on
        // BOTH states, and that is deliberate: a rule can be switched off by one answered
        // precondition while a second is left open, and the reader has to see both before deciding
        // whether the declaration is right. Present only when non-empty, so an absent key means
        // "nothing was left open", never "the questions were answered".
        //
        // Before 2026-08-25 an unanswered precondition was read as an answer of no, so every rule in
        // this position was `not-evaluated` and this array could not exist. It now runs
        // (engine.ts `preconditionStatus`) and `SKILL.md` step 3b tells the agent to report the
        // silence as `unknown` with the open question named, never as `not_applicable`.
        ...(unanswered.length > 0 ? { unanswered_preconditions: unanswered } : {}),
        // The applicability questions this rule turns on that the profile answered in a way that
        // puts the rule out of scope — and the rule ran anyway.
        //
        // **On a row of this array the sentence is the opposite of the one on a candidate, and it is
        // worth saying out loud: the declaration is CORROBORATED.** The person said the subject was
        // absent, the detector was allowed to look for it, and it found nothing. That is a weak
        // statement about the code — every caveat on any other silent row still applies, and a
        // detector that did not find a construct has not established that it is absent — but it is a
        // statement, where before 2026-08-27 there was a rule that never opened a file.
        //
        // Emitted with `unmet_preconditions` deliberately NOT emitted beside it. The two would carry
        // the identical array under two names in one object, which is a forbidden second copy,
        // and the older name means "the rule never ran", which is now false of every row
        // this scanner writes.
        ...(unmet.length > 0 ? { declared_inapplicable_preconditions: unmet } : {}),
        // Emitted on every row now, where the `not-evaluated` branch used to replace both with
        // `unmet_preconditions`. A rule out of scope by declaration reads files like any other, so
        // it has a surface count and can have corroboration removals, and both are what tell a
        // reader whether its silence is about the code or about the tree's layout.
        files_on_surface: filesOnSurface.get(r.id) ?? 0,
        // Omitted rather than written as 0: a rule whose gate never shut makes no statement here,
        // and `0` would read as one.
        ...(removed > 0 ? { matches_removed_by_corroboration: removed } : {}),
      };
    })
    .sort((a, b) => a.rule_id.localeCompare(b.rule_id));

  // Applicability (coverage-map row C1). The census runs in a scan as well as in `reconcile` because
  // the limbs are answered from code facts, and a scan that could not say whether an instrument
  // reaches the project would leave every CRA citation in the pack unqualified. It is the same
  // collectors over the same walked files, so nothing new is read from disk. `runCensusPass` above
  // is where it is called; on the sharded path it has already run, in its own worker, alongside the
  // detectors rather than after them.
  const census = passes.census;
  const scope = assessScope(opts.bundle.checklists ?? [], census.facts, profile);

  // The one mechanical cross-check between the two halves of this document: a package the manifest
  // declares, spelled like a vendor the recipient rules know, that no matched line names. Owner
  // direction, 2026-08-28. It is computed from `matches` — the lines that became the candidates
  // below, one collapse away — rather than from `candidates`, because a location carries no text
  // and re-reading the files to recover it would be a second pass over the tree for a string the
  // engine already had in hand.
  const declaredVendorsWithoutCandidates_ = declaredVendorsWithoutCandidates(
    census.dependency_inventory,
    opts.bundle.rules,
    matches.map((m) => ({ ruleId: m.rule.id, lineText: m.lineText })),
  );

  const grouped = [...byFp.values()].sort((a, b) => {
    const sev = { high: 0, medium: 1, low: 2 } as const;
    return sev[a.severity] - sev[b.severity] || a.rule_id.localeCompare(b.rule_id);
  });
  // The fingerprint collapse above answers "how many questions is this?", and it has no opinion at
  // all about how big one question may be. This is where that opinion is applied — after the sort,
  // so the parts of a split group are adjacent and in part order by construction rather than by
  // relying on the sort being stable over rows that compare equal.
  //
  // Then the payload bound, in the same expression because the two are one guarantee and running
  // either alone leaves it unmet: the split makes every candidate fit in one agent's payload, and
  // the grouping makes every payload fit. Both run before the applicability annotation below, which
  // assigns a fresh array per candidate, so every part and every batch gets its own.
  //
  // `splitOversizedGroups` does one of two things now, and the switch decides which: with the kind
  // census ON it stops cutting and hands the oversized candidate back whole with its catalogue and
  // its reading plan; with it OFF it cuts, exactly as before.
  //
  // THE READING CLASS COMES FROM THE RULE, AND FROM NOWHERE ELSE. `reading_class` is on the 55
  // project rules and in `rule.schema.json` since unit U3; the scanner's embedded copy of annex
  // §4.2 and `readingClassOf`'s fallback branch were deleted together at integration, leaving the
  // rule the single original (never a second copy of a fact two places must agree on).
  // The grouping above copies that field verbatim onto every candidate OF THIS ARM — the copy is
  // gated on `kindCensusOn` for the reason stated there — and `splitOversizedGroups` reads it from
  // the candidate — one road, not a lookup table beside it. On the off arm no candidate carries the
  // field and the splitter cuts, which is the pre-census behaviour in both respects. A rule that
  // declares nothing is still read line by line, and `reading_plan.class_source` says so rather
  // than leaving a reader to guess.
  const bounded = assignAdjudicationGroups(splitOversizedGroups(grouped, kindCensusOn));
  // Then the merge, which is the opposite operation and the last word on which candidates one agent
  // sees together: the two above make every payload SMALL ENOUGH, and this one makes the small ones
  // worth a whole agent (idea A, adopted 2026-09-17). It is applied after them and never before,
  // because a bin may only hold candidates that already fit in one payload on their own.
  //
  // `opts.packGroups` is the resolved `--pack-groups` value and reaches here from `index.ts` alone;
  // every other caller of `runScan` is a gate or a harness that passes nothing, and the environment
  // decides for those, exactly as it does for the prefilter. `resolvePackGroups` states the
  // precedence once and this line reads it rather than restating it.
  const candidates = (opts.packGroups ?? resolvePackGroups())
    ? packAdjudicationGroups(bounded, (() => {
        const models = seatModelsOf(opts.bundle.rules);
        return (ruleId: string) => models.get(ruleId) ?? DEFAULT_SEAT_MODEL;
      })())
    : bounded;

  // THE READING UNITS, written after the packing and never before: `reading_units` is a statement
  // about the CANDIDATE and not about the bin, so it survives both operations unchanged, and putting
  // it on last means no packer can be tempted to recompute it. It is what a bin's bound is counted
  // in from now on (unit U2 makes the packer read it); today it is written, and `test:kind-census`
  // holds it to the plan beside it.
  if (kindCensusOn) {
    for (const c of candidates) {
      if (c.adjudication_group === undefined) continue;
      const plan = c.reading_plan;
      c.adjudication_group.reading_units = unitsOfCandidate(c);
      if (plan !== undefined && plan.reader_slices.length > 0) {
        c.adjudication_group.readers = plan.reader_slices.length;
      }
    }
  }

  // A candidate is annotated, never removed. Each legal_basis citation that names an instrument
  // with an assessment carries that assessment's verdict, so a reader sees which of a rule's
  // several citations depend on a scope question and which do not. The map's instruction on the
  // baseline pack is the reason this is per citation rather than per finding: "keep rules
  // dual-cited so the CRA scope gate never silences the GDPR basis".
  for (const c of candidates) {
    const notes = scope.assessments
      .filter((a) => {
        const token = celexInstrumentToken(a.source_url);
        return token !== null && (c.legal_basis_refs ?? []).some((ref) => ref.includes(token));
      })
      .map((a) => ({ checklist_id: a.checklist_id, verdict: a.verdict, because: a.because }));
    if (notes.length > 0) c.depends_on_applicability = notes;
  }

  return {
    scan_id: randomUUID(),
    bundle: { version: opts.bundle.manifest.bundle_version, sha256: opts.bundle.digest, signature: opts.bundle.signature },
    profile_digest: profile ? profileDigest(profile) : null,
    // Emitted only where `--profile` was given, because there is nothing to check without one. The
    // digest above tells the two absences apart: `profile_digest: null` with no block is a run that
    // was given no profile, and a digest with no block is a document written before 2026-09-02.
    ...(loaded ? { profile_validation: loaded.validation } : {}),
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    target: opts.targetRoot,
    stats: {
      files_scanned: filesScanned,
      files_skipped: filesSkipped + walked.skipped,
      rules_evaluated: applicable.length,
      // ZERO FROM 2026-08-27, ON EVERY SCAN, AND KEPT RATHER THAN DELETED. Nothing in a ScanProfile
      // removes a rule from a scan any more, so the honest value of this counter is 0 and it is
      // written rather than dropped: the field is in `findings.schema.json`, it is in the eight
      // pass-1 documents on disk with non-zero values, and a consumer that reads it must keep
      // getting an answer. Its successor is `rules_run_on_declared_inapplicable_precondition`
      // below, which counts the same rules on the other side of the change — they ran.
      rules_suppressed_by_precondition: opts.bundle.rules.length - applicable.length,
      // Rules that ran BECAUSE a precondition was left open rather than answered. Until 2026-08-25
      // this population was inside `rules_suppressed_by_precondition`: an unanswered question was
      // read as an answer of no and the rule was removed, so the counter said the person had put
      // the rule out of scope when the person had said nothing at all. It is a separate counter and
      // not a correction inside the other one, because the two are different facts about different
      // rules and a reader must not have to subtract to get either.
      rules_run_on_unanswered_precondition: ranOnUnanswered.length,
      // Rules that ran although the profile's own answers put them out of scope. Until 2026-08-27
      // this population WAS `rules_suppressed_by_precondition` — the same rules, on the other side
      // of the change — and a separate counter rather than a correction inside that one for the
      // reason the counter above gives: a reader must not have to subtract to get either.
      //
      // It is a cost figure and never a quality figure: it says how many rules read the
      // tree on a premise the person denied, not how many of them were right to.
      rules_run_on_declared_inapplicable_precondition: declaredInapplicable.length,
      candidates_suppressed_by_guard: suppressed.length,
      // Match LINES the corroboration gate removed, summed over the gate decisions listed in
      // `suppressed_by_corroboration` — the same relationship `files_excluded_by_walker` has to
      // `excluded_by_walker`, and asserted as arithmetic by a check.
      //
      // The unit word differs from `candidates_suppressed_by_guard` directly above on purpose.
      // Both counters count match lines; that one calls them candidates, which is inaccurate for
      // the same reason it would be inaccurate here — a suppressed line never reached the
      // fingerprint collapse, so it was never a candidate, and forty-seven lines of one file
      // routinely collapse into one. The older name is not this work item's to change.
      matches_suppressed_by_corroboration: corroborationSuppressed.reduce((n, s) => n + s.matches, 0),
      files_excluded_by_walker: walked.excluded.reduce((n, e) => n + (e.files ?? 0), 0),
      // Files the engine itself opened and did not read to any rule — the same relationship
      // `files_excluded_by_walker` has to `excluded_by_walker`, one layer further in. It is a
      // SUBSET of `files_skipped` above, which also carries every walker skip, and that is exactly
      // why it exists: `files_skipped` cannot be decomposed by a reader.
      files_not_read_by_engine: filesNotRead.length,
      // Files the engine READ with at least one line blanked by the minification ceiling
      // (walk.ts `blankLongLines`, 2026-09-07). NOT a subset of `files_skipped` and never added to
      // it or to the counter above: these files were scanned and are inside `files_scanned`, and
      // what they lost is lines, not the file. `files_partially_read` names each one and each line.
      files_partially_read: filesPartiallyRead.length,
      // Files the per-file wall-clock budget stopped (`--file-budget`, 60 s by default): the rows of
      // `files_partially_read` carrying a `stopped_for_time` block, plus the rows of
      // `files_not_read` whose reason is `time-budget`.
      //
      // WRITTEN ONLY WHEN IT IS NON-ZERO, which the two counters above it are not, and the exception
      // is deliberate. The house rule — write the counter on every scan, zero included, because a
      // key present only when something happened cannot be told apart from a producer that stopped
      // writing it — rests on the fact being UNRECOVERABLE without the key. It is recoverable here:
      // both arrays this is read off are written on every scan, empty or not, so "was any file cut
      // short for time?" has an answer in the document with or without this key, and a producer from
      // before the budget existed gives the same answer for the same reason — it had no budget to
      // cut one short with. What writing it unconditionally would cost is the property step 4 was
      // approved under (design §D.3): a scan in which no file overruns writes the document it wrote
      // before the budget existed, byte for byte, which is what the three corpus baselines hold.
      // RE-TAKEN AND KEPT ON 2026-09-16, after independent verification asked for both readings. The
      // precedent below, `gates_opened_by_scope`, is NOT what decides it and is no longer cited as
      // though it were: that key is written when the BUNDLE declares `gate_scope`, so its presence is
      // fixed for a given bundle and tree-independent, while this one's presence depends on the tree
      // and on how loaded the machine was. What decides it is the property above — byte identity of a
      // scan that stops nothing, which every step of this lane is held against — and the fact that
      // this key is the only thing in step 4 that would break that identity on every tree at once.
      ...(filesStoppedForTime > 0 ? { files_stopped_for_time: filesStoppedForTime } : {}),
      // Files read WHOLE whose comments were read as CODE, because no comment syntax is registered
      // for their extension (`strip-comments.ts` `BY_EXT`). The opposite direction from every
      // counter around it and never added to any of them: these files were scanned and every line of
      // them reached every rule — including the comment lines, which is the hole. Reported in
      // `coverage_limits`; the repair is a row in `BY_EXT` and is an engine backlog item.
      files_comment_syntax_unregistered: filesCommentSyntaxUnregistered,
      // The class the counter above cannot see: files whose extension IS
      // registered, but whose language has a comment form the registered mode reads as code - Perl
      // POD, INI `;`, `.properties` `!`, a SCSS-family `//` line, a nested block comment's tail,
      // and Python docstrings and Elixir documentation attributes, which are code by the owner's
      // 2026-09-24 decision and counted so that decision's reach is stated. Declared in
      // `strip-comments.ts` `COMMENT_FORMS_READ_AS_CODE`; every declared form is a key below, zero
      // included. A size, never added to any other counter, and not in `coverage_limits`.
      files_comment_form_read_as_code: filesCommentFormReadAsCode,
      comment_forms_read_as_code: commentFormsReadAsCode,
      // Refusals the CENSUS recorded while reading manifests — a `package.json` that fails
      // `JSON.parse` (a UTF-8 BOM is enough, and npm itself accepts one), or one whose
      // `dependencies`, `optionalDependencies`, `devDependencies` or `peerDependencies` value is not
      // an object. **Not the same population as the counter above and never added to it**: those
      // files reached no rule, these reached every rule and were refused by the dependency parse
      // alone. A block-level refusal is per block: the manifest's other three blocks are still read,
      // so a manifest can appear here and still contribute packages to the inventory.
      //
      // It exists because an empty `dependency_inventory` from a manifest that could not be read
      // was indistinguishable from an empty one from a tree with no npm manifest, while the
      // inventory's own description tells a reader that an empty inventory is a statement about npm
      // manifests. `census.manifests_not_usable` names the files and says why; this is the count a
      // reader of `stats` sees. Written on every scan, zero included: a counter present only when
      // something failed cannot be told apart from a producer that stopped writing it.
      //
      // **A count of REFUSALS, not of files.** One manifest with a malformed `devDependencies` and a
      // malformed `peerDependencies` counts 2, and contributes its `dependencies` packages to the
      // inventory in the same breath.
      manifests_not_usable: (census.manifests_not_usable ?? []).length,
      // What the opt-in derived views (engine.ts, derive.ts) did on this tree. `failed` is the one
      // worth reading: it counts files where a rule asked for an expanded view, could not have one,
      // and fell back to the file's own text. The fallback direction is safe — the unexpanded text
      // is what every rule saw before the views existed — but a silent degrade is still a degrade.
      derived_views_built: derivedViewsBuilt,
      derived_views_failed: derivedViewsFailed,
      // (rule, file) gates that were shut on a file's own text and were opened by a wider
      // `detector.gate_scope` — what that field did on this tree, reported as cost.
      //
      // WRITTEN ONLY WHEN THE BUNDLE CARRIES A RULE THAT CAN MOVE IT, zero included, and the two
      // counters above it are written always. The difference is not a slip. Any bundle can move
      // those; no bundle without a declaring rule can move this one, and the proof this mechanism
      // ships under is that a scan under such a bundle writes the document it wrote before the field
      // existed — a key whose only possible value is 0 would break that for every user of every
      // bundle to buy nothing. So absence states "no rule here can widen a gate" and `0` states "one
      // can and none did on this tree", which are different facts and neither is a producer that
      // stopped writing a key. The predicate is the engine's, not a second reading of the bundle
      // taken here.
      ...(declaresGateScope(opts.bundle.rules) ? { gates_opened_by_scope: gatesOpenedByScope } : {}),
      // What the joined-construct view did on this tree, written under exactly the rule the line
      // above is written under and for exactly the same reason: no bundle without a declaring rule
      // can move any of the three, so writing them always would make every scan under today's
      // bundle differ from the scan it produced yesterday to buy nothing. The three count different
      // populations and must never be added — two count FILES (one folded something, one had
      // nothing to fold) and the third counts CONSTRUCTS a ceiling turned down.
      ...(declaresJoinedView(opts.bundle.rules)
        ? {
            joined_views_built: joinedViewsBuilt,
            joined_views_not_applicable: joinedViewsNotApplicable,
            joined_constructs_refused: joinedConstructsRefused,
            // The fourth of the group and the only one that counts CANDIDATES: enclosing
            // fold-derived reports removed because everything they read was also read by a report
            // inside them. Written under the same condition as the three beside it — no bundle
            // without a declaring rule can move any of the four — and the removals it counts are
            // enumerable one by one from `locations[].also_opens_at`.
            joined_outer_duplicates_dropped: joinedOuterDuplicatesDropped,
          }
        : {}),
      // What the structural (parse-tree) reading did on this tree — see engine.ts and structural/.
      // The three `built / no_adapter / …` counts exist so that "the second eye read this file and
      // agreed" can be told apart from "the second eye could not read this file" and from "no rule
      // asked for it", which are three different answers that must never be added together. The
      // three candidate counts are the product cost of the second eye, reported as cost per
      // the design and never as a quality signal.
      structural_trees_built: structural.treesBuilt,
      structural_no_adapter: structural.noAdapter,
      structural_grammar_unavailable: structural.grammarUnavailable,
      structural_parse_failed: structural.parseFailed,
      structural_skipped_too_large: structural.skippedTooLarge,
      structural_skipped_partial_source: structural.skippedPartialSource,
      structural_findings_out_of_range: structural.findingsOutOfRange,
      structural_candidates_added: structural.candidatesAdded,
      structural_candidates_duplicate: structural.candidatesDuplicate,
      structural_candidates_dropped_by_match_without: structural.candidatesDroppedByMatchWithout,
    },
    candidates,
    // Every rule that produced none — the other half of the same document, and the half that did
    // not exist before 2026-08-19. See the construction above.
    rules_without_candidates: rulesWithoutCandidates,
    // One file this scan really read, for the single SARIF result that says how much of this scan
    // established nothing. It is here rather than derived inside `sarif.ts` because only the scan
    // knows which files it opened, and re-walking the tree to find out would double the walk on
    // every run. Nothing else reads it, and nothing about a candidate depends on it. See
    // `Findings.scan_anchor` for why an output format makes this necessary, and `sarif.ts` for the
    // sentence the reader is shown.
    //
    // Sorted rather than "the first one the walker produced": `walkTarget` pushes in directory
    // traversal order, which is the filesystem's order and can differ between machines for the same
    // tree, and an anchor that moves makes a CI alert move with it.
    //
    // Compared by code unit and NOT by `localeCompare`, which is what the first draft of this line
    // used. `localeCompare` with no locale argument collates in the runtime's DEFAULT LOCALE, which
    // is a property of the machine and not of the tree. The two disagree on case, verified by
    // execution under `en-US`: `localeCompare` orders `app/layout.tsx` before `CHANGELOG.md` and a
    // code-unit comparison orders them the other way, because `C` is 0x43 and `a` is 0x61.
    // The property this line exists to have is that the same tree anchors on the same file
    // everywhere, and a locale-sensitive comparison does not have it. **On the seven trees this
    // change was measured over, the correction moved no anchor at all** — it is made for the
    // property, not for an observed difference.
    ...(walked.files.length > 0
      ? { scan_anchor: { file: [...walked.files].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0] } }
      : {}),
    // The applicability verdicts, above the findings rather than among them. Coverage-map row C29
    // states the reason in terms: this is "an applicability signal, not a finding", and reporting
    // it as a finding puts a violation candidate on every password manager on GitHub. Nothing here
    // removes or downgrades a candidate; the verdicts annotate the citations that turn on them.
    // Each evidence row's `value` is a census capture kept as text, so it goes through the same
    // credential redaction as the labels (R3′; `redactEvidenceValues`), here and nowhere earlier.
    applicability: redactEvidenceValues(scope.assessments, productCredentials()),
    // Gates the bundle ships that carry no `limbs` yet, named rather than dropped: a scan that
    // silently assessed one instrument would look like a scan that had considered all of them.
    applicability_not_assessed: scope.skipped,
    // The questions that are answered ONCE PER RULE rather than once per candidate, settled here
    // from the person's own declaration so that no seat re-derives them.
    //
    // **It removes nothing and changes no candidate.** Every entry of `candidates`,
    // `rules_without_candidates` and the payload files is byte-for-byte what it was before this key
    // existed — the block is an ANSWER written beside the findings, and the orchestrator is what
    // acts on it (`legal-scan/SKILL.md` step 4). The per-rule region gate the owner took out of the
    // scan on 2026-07-27 is not reopened: that gate deleted candidates silently, which is the one
    // thing layer 1 must never do. See `per-rule-applicability.ts` for the whole of the design and
    // for the membership list the jurisdiction judgement turns on.
    per_rule_applicability: perRuleApplicability(
      opts.bundle.rules,
      candidates,
      profile,
      preconditions,
      opts.scopeSettlements ?? [],
    ),
    // Emitted so a guard can be audited. A suppressed candidate never reaches the adjudicating
    // agent, which makes a wrong guard invisible — the failure that hid eu-dsa-001 being silenced
    // on 81% of real repositories by country-flag paths and emoji category names. Carried in the
    // findings file rather than only in the summary so that the ledger and eval tooling can read
    // it back.
    suppressed_by_guard: suppressed,
    // Every corroboration gate that shut on a file where the rule's own `match` patterns did fire,
    // one entry per (rule, file) — the unit the gate decides in. Emitted for the reason
    // `suppressed_by_guard` is emitted, and it is the field that reaches real scans: no rule has
    // declared `detector.guard_missing` since the owner removed the mechanism on 2026-07-27 (0 of
    // 56 today), while nine rules declare `detector.also_in_file`, so until 2026-08-13 the output
    // could describe the suppression that never happens and not the one that happens 11,976 times
    // over the pinned corpus. Emitted even when empty, like `suppressed_by_guard`: "no gate shut
    // anywhere in this tree" is a statement, and an absent key would be indistinguishable from a
    // scanner that does not record.
    //
    // It adds nothing to `candidates` and removes nothing from it. The gate decides exactly what it
    // decided before; this is the decision written down.
    suppressed_by_corroboration: corroborationSuppressed,
    // Which languages the structural reading could not read at all, named once each with the error
    // and the number of files it cost. Same remedy as suppressed_by_guard and excluded_by_walker,
    // one layer further out: a number alone says a hole exists, and this says where it is and how
    // to close it. Absent when nothing failed, so an empty list is never mistaken for a report.
    ...(structural.grammarsUnavailable.size > 0
      ? {
          structural_grammars_unavailable: [...structural.grammarsUnavailable].map(([language, g]) => ({
            language,
            error: g.error,
            files: g.files,
          })),
        }
      : {}),
    // What the walker refused to open, and why. Same remedy as suppressed_by_guard and for the
    // same reason: a file the walker never opens can never reach the adjudicating agent, so an
    // exclusion that is wrong is invisible. The walker's exclusion set is the larger version of
    // the problem — one hidden setting deciding the scanning surface of all 42 rules at once —
    // and until each rule declares its own surface in `detector.file_globs`, reporting is what
    // makes it auditable. Owner decision, 2026-07-27.
    excluded_by_walker: walked.excluded,
    // WHAT THIS SCAN READ PAST, and what would open it — the one model every output renders.
    //
    // Owner decision, 2026-09-10, and the second half of it is the reason this field exists rather
    // than a `read_scope` block beside `excluded_by_walker`: "doing that makes it an optimisation of that
    // one part, so make it consistent with the other outputs too". A scan falls short of reading
    // everything in five ways; the new one is one of them, and giving it its own block in its own
    // words would have left the other four to be discovered by each reader separately and let the
    // console, the SARIF and the agent's report say different things about the same tree.
    //
    // Assembled from this document's own fields and from nothing else — the walker exclusions above,
    // the two file lists below, the counters in `stats`, and the roster — so every number here can
    // be checked against the field beside it rather than against a second tally. The
    // sentences it carries are the ONLY wording: `summarize()`, `toSarif()` and
    // `skills/legal-scan/SKILL.md` print these strings and compose none of their own.
    coverage_limits: coverageLimits({
      scope: readScope,
      bundleDeclaresReadScope: opts.bundle.readScope !== null && opts.bundle.readScope !== undefined,
      excluded: walked.excluded,
      filesNotRead,
      filesPartiallyRead,
      commentSyntaxUnregistered: filesCommentSyntaxUnregistered,
      filesReadFromUtf16,
      filesReadNotUtf8,
      maxFileBytes: MAX_FILE_BYTES,
      lineLimit: MINIFIED_LINE_LIMIT,
      fileBudgetMs: opts.fileBudgetMs ?? Infinity,
      rulesRun: applicable.length,
      rulesInBundle,
      // `--rules` is applied in `index.ts` before `runScan` ever sees the bundle, so the run's own
      // rule array IS the selection and the manifest's pack counts are the only record of the whole.
      // A run that was not narrowed has the two equal; a narrowed run does not, and the member says
      // which rules were asked for rather than making the reader subtract two numbers.
      narrowedTo: rulesInBundle > applicable.length ? opts.bundle.rules.map((r) => r.id) : null,
      unansweredPreconditions: ranOnUnanswered.length,
      declaredInapplicable: declaredInapplicable.length,
      profileGiven: profile !== null,
      rulesSilent: rulesWithoutCandidates.length,
      readDespiteName: walked.readDespiteName,
      reScanReads: walked.reScanReads,
    }),
    // Every dependency the tree's `package.json` manifests declare in `dependencies`,
    // `optionalDependencies`, `devDependencies` or `peerDependencies`, called or not, each
    // declaration labelled with the block it came from — the census's own inventory, copied verbatim
    // from the result computed twelve lines above for the scope assessment. Four blocks since the
    // ruling; `bundledDependencies` is still read by nothing, because it is an
    // array of names rather than a declaration map and its members are declared in one of the four
    // anyway. The same limit is stated in the schema description and in `SKILL.md` step 4. **It is here so that layer 2 can see it.** Owner direction, 2026-08-28: the
    // inventory "absolutely must be passed" to the adjudicating agent, and until that day the census
    // fed the scope assessment and pillar 2's reconciliation while the part of the system that reads
    // code in context was handed candidate fields, the ScanProfile and `.legal/memory.md` and
    // nothing about dependencies at all.
    //
    // Copied and not recomputed: `runCensus` is called once per scan and this is its output. A
    // second pass over the manifests here would be a forbidden second copy, and it would
    // be a copy that agrees on the day it is written.
    //
    // Emitted even when empty, like `files_not_read` below and for the same reason: a tree with no
    // npm manifest is a statement about the tree, and an absent key would be indistinguishable from
    // a scanner that does not record. Three of the eight pinned pass-1 trees are in exactly that
    // position — three real trees declare their dependencies in Composer,
    // Bundler and NuGet files that this census does not parse — so the empty case is the common one
    // and is the one most in need of being told apart from silence.
    dependency_inventory: dependencyInventoryOf(census),
    // Dependencies spelled like a recipient vendor the rules know, with no candidate naming them.
    // See `declaredVendorsWithoutCandidates` for what this is and, more importantly, what it is not.
    declared_vendors_without_candidates: declaredVendorsWithoutCandidates_,
    // Every file the engine opened and handed to no rule, NAMED. Emitted even when empty, for the
    // reason `suppressed_by_corroboration` is: "the engine read every file the walker offered it"
    // is a statement about this scan, and an absent key would be indistinguishable from a scanner
    // that does not record.
    //
    // This is the third and innermost of the three refusal channels this document carries, and the
    // last one that was silent. `excluded_by_walker` says what was never opened; this says what was
    // opened and then set aside; `suppressed_by_corroboration` and `suppressed_by_guard` say what
    // matched and was then removed. Until 2026-08-25 the middle one was a single integer folded
    // into `stats.files_skipped`, so a file the minification proxy misjudged — an authored YAML
    // document with one long line, a squashed SQL migration, a base64 blob in a configuration file
    // — produced the identical output to a file that was read and held nothing. Owner ruling,
    // 2026-08-25: do not remove the skip, report it. See `NotReadFile` for the two reasons and
    // walk.ts `looksMinified` for why the ceiling is a proxy and is named as one.
    files_not_read: filesNotRead,
    // Every file the engine read with a line blanked by the minification ceiling, NAMED, with each
    // blanked line and the length it held. The array above says which files were not read; this
    // says which were not read WHOLE, and 2026-08-25's argument is the same one at a smaller unit:
    // a reduction nobody can see is a reduction nobody audits. Emitted even when empty, like
    // `files_not_read` and for the same reason. See `PartiallyReadFile` for what a row implies
    // about the two readings that are refused on such a file.
    files_partially_read: filesPartiallyRead,
    // DOES IT SHIP, AS THE PROGRAM READS IT: for every file holding
    // a location, the premise read from the repository's own build and tooling files (ships-premise.ts), handed to the
    // seats beside their payload and digested into the verdicts' `facts` premise. Computed last, from the final
    // candidates' location paths: it removes nothing, reorders nothing and changes no candidate.
    ...(opts.shipsPremise === false ? {} : { ships_premises: shipsPremisesForCandidates(opts.targetRoot, candidates) }),
  };
}

/**
 * The one reading of `rules_without_candidates` — every population of it that any output names.
 *
 * There are three channels that have to describe the same silence: the `summarize()` block below,
 * which a person reads; the `--fail-on-unreviewed` exit-code message in `index.ts`, which a CI operator reads;
 * and the SARIF coverage result in `sarif.ts`, which a code-scanning consumer reads. Each derived
 * its own counts once, and they drifted in exactly the way that costs:
 *
 *  - **2026-08-21, first round.** Over a tree of only `test/` and `spec/` files `summarize()` said
 *    "56 ran over this tree and matched nothing … of which 54 were offered no file at all", and the
 *    `--fail-on` line beneath it said "56 rule(s) ran and found nothing" with no correction — the
 *    one sentence a CI log gets read for, stating that fifty-six rules had read the tree when two
 *    had. `summarize()` and `index.ts` were pointed here.
 *  - **2026-08-21, second round.** `index.ts` counted its "matched nothing" clause from
 *    `readSomething`, which CONTAINS `gated` — the rules whose patterns did match and were then
 *    silenced by a corroboration gate. On one real tree that clause called 35 rules
 *    silent when 5 had matched, `eu-retention-001` 590 times. The population is now named here
 *    (`matchedNothing`) rather than assembled by whichever caller happens to need it, and
 *    `sarif.ts` was pointed here as well, through `censusRoster`.
 *
 * So the counts are derived HERE, once, and every caller imports them. The project's rules forbid keeping
 * a second copy of anything two places must agree on by name: a number computed twice drifts, and
 * this one has now drifted twice.
 *
 * Every population is returned as the rows themselves, not as a count, because the callers name
 * rule ids as well as totals and a count cannot be re-expanded into one.
 */
export interface SilentRuleCensus {
  /** Every rule that produced no candidate: the whole `rules_without_candidates` roster. */
  all: RuleWithoutCandidates[];
  /** `state: "evaluated"` — in scope, whatever its surface turned out to be. */
  evaluated: RuleWithoutCandidates[];
  /** `state: "not-evaluated"` — the ScanProfile put it out of scope before it read a line. */
  notEvaluated: RuleWithoutCandidates[];
  /**
   * Evaluated AND offered at least one file (`files_on_surface > 0`).
   *
   * **This is the population whose silence is about the code, and it CONTAINS `gated`.** It is not
   * the population a sentence ending "and matched nothing" may be counted from — see
   * `matchedNothing` below, which is this minus the rules whose patterns did match.
   */
  readSomething: RuleWithoutCandidates[];
  /** Evaluated but offered no file (`files_on_surface === 0`): silence about the tree's layout. */
  noSurface: RuleWithoutCandidates[];
  /**
   * Evaluated, offered at least one file, matched its own patterns in it, and was then silenced by a
   * corroboration gate. A subset of `readSomething`, so it can never overlap `noSurface`.
   */
  gated: RuleWithoutCandidates[];
  /**
   * Evaluated, offered at least one file, and whose own patterns matched NOTHING in it:
   * `readSomething` minus `gated`.
   *
   * **This is the only population the words "matched nothing" may be counted from.** A gate-silenced
   * rule was offered a file AND its patterns matched lines in it; it produced no candidate only
   * because a corroboration gate removed the matches afterwards. Counting it into "matched nothing"
   * states the opposite of what happened, about the rules whose silence is the LEAST `unknown`-like
   * in the roster — the design calls them "the most worth reading". Measured on
   * one real tree on 2026-08-21: 35 rules produced no candidate, 5 of them had matched,
   * `eu-retention-001` 590 times and `eu-retention-002` 246 times, and the `--fail-on` line said all
   * thirty-five "matched nothing".
   *
   * The two populations are disjoint and, with `noSurface` and `notEvaluated`, they partition
   * `all` — which is why each is stated in its own clause and its own unit rather than corrected by
   * an "of which" that a reader may not reach.
   *
   * **That partition is enforced by `censusRoster`, not merely claimed here.** This paragraph said
   * "they partition `all`" from 2026-08-21 and nothing checked it; on 2026-08-24 a verifier broke it
   * four ways through this exported function. `censusRoster` now classifies each row by its own
   * fields alone and throws rather than returning a census whose clauses do not add up.
   */
  matchedNothing: RuleWithoutCandidates[];
}

/**
 * The census over the whole roster a `Findings` carries. Every CLI channel that speaks about the
 * silent rules counts from here.
 */
export function censusSilentRules(f: Findings): SilentRuleCensus {
  return censusRoster(f.rules_without_candidates ?? []);
}

/**
 * The same census over an arbitrary set of roster rows.
 *
 * `sarif.ts` needs it: that file deliberately restricts the roster to the rules the SARIF document
 * it is writing actually describes (`toSarif` is called once with the whole bundle and once with a
 * single rule), so it cannot pass a whole `Findings`. Before 2026-08-21 it re-derived the four
 * populations with its own copies of these predicates — a third copy of the arithmetic, one channel
 * over from the two this function was extracted to unify.
 */
export function censusRoster(rows: RuleWithoutCandidates[]): SilentRuleCensus {
  const all = rows;
  const evaluated = all.filter((r) => r.state === "evaluated");
  const notEvaluated = all.filter((r) => r.state === "not-evaluated");
  const readSomething = evaluated.filter((r) => surfaceOf(r) > 0);
  const noSurface = evaluated.filter((r) => surfaceOf(r) === 0);
  // ROW-WISE, not by rule id. Until 2026-08-24 this line read
  // `readSomething.filter((r) => !gatedIds.has(r.rule_id))` over a Set of the gated rules' ids, so
  // two roster rows sharing one `rule_id` — one gated, one not — dropped BOTH out of
  // `matchedNothing` and the four populations summed to 1 of 2. `runScan` writes one row per rule
  // and cannot produce that shape today (engine.ts:570,663), but `censusRoster` is exported, three
  // output channels now count from it, and an invariant that holds only because of what the current
  // producer happens to do is not an invariant. A row is classified by its own fields and by
  // nothing another row carries.
  const gated = readSomething.filter((r) => removalsOf(r) > 0);
  const matchedNothing = readSomething.filter((r) => removalsOf(r) === 0);

  // THE PARTITION, ENFORCED RATHER THAN ASSERTED IN PROSE. The `SilentRuleCensus` doc comment above
  // has claimed since 2026-08-21 that these four populations partition `all`; nothing checked it,
  // and an independent verifier broke it on 2026-08-24 with four synthetic rows fed straight to this
  // exported function. A test's own partition check runs over data `runScan`
  // produced, so under the current producer it cannot fail — it holds the message, not the invariant.
  //
  // TWO SHAPES ARE REFUSED HERE RATHER THAN BUCKETED, because both would sum to 1 per row and still
  // make a channel print a false sentence:
  //
  //  - A row with `files_on_surface: 0` AND `matches_removed_by_corroboration > 0` is
  //    self-contradictory: a corroboration gate can only remove matches the rule found in a file it
  //    was offered. Bucketed into `noSurface` it prints "offered no file at all" about a rule that
  //    demonstrably matched; bucketed into `gated` it prints a removal count for a rule that read
  //    nothing. There is no honest clause for it, so it is not printed at all.
  //  - A negative `files_on_surface`, or a `state` outside the two the schema allows, falls into no
  //    population and is caught by the sum below.
  //
  // Failing loudly is the point: a census three channels are about to print is not a place to
  // absorb a contradiction quietly. Every message names the rows, so the caller can see which.
  const contradictory = evaluated.filter((r) => surfaceOf(r) === 0 && removalsOf(r) > 0);
  if (contradictory.length > 0) {
    throw new Error(
      `rules_without_candidates is inconsistent: ${contradictory.length} row(s) report ` +
        `files_on_surface: 0 together with matches_removed_by_corroboration > 0, which cannot both ` +
        `be true — a corroboration gate removes matches the rule found in a file it was offered. ` +
        `Rows: ${contradictory
          .map((r) => `${r.rule_id} (files_on_surface ${r.files_on_surface}, removals ${r.matches_removed_by_corroboration})`)
          .join(", ")}`,
    );
  }
  const sum = matchedNothing.length + gated.length + noSurface.length + notEvaluated.length;
  if (sum !== all.length) {
    const placed = new Set<RuleWithoutCandidates>([...matchedNothing, ...gated, ...noSurface, ...notEvaluated]);
    const unplaced = all.filter((r) => !placed.has(r));
    throw new Error(
      `rules_without_candidates does not partition: the four populations the CLI, the --fail-on-unreviewed ` +
        `message and the SARIF coverage result each print sum to ${sum}, not to the ${all.length} ` +
        `row(s) in the roster. ${unplaced.length} row(s) fall into no population: ${
          unplaced
            .map((r) => `${r.rule_id} (state ${JSON.stringify(r.state)}, files_on_surface ${r.files_on_surface})`)
            .join(", ") || "none — some row is in two"
        }`,
    );
  }

  return { all, evaluated, notEvaluated, readSomething, noSurface, gated, matchedNothing };
}

/**
 * `files_on_surface` as a number this function may compare. Absent is 0 — the schema makes the field
 * optional and `runScan` omits it on a `not-evaluated` row — but a present non-integer or negative
 * value is neither 0 nor positive, so it is returned as-is and lands in no population, where the
 * partition check above names it.
 */
function surfaceOf(r: RuleWithoutCandidates): number {
  const n = r.files_on_surface ?? 0;
  return Number.isInteger(n) ? n : Number.NaN;
}

/** The same reading for the corroboration-gate removals (exported for the layer-2 report's silent-rule row). */
export function removalsOf(r: Pick<RuleWithoutCandidates, "matches_removed_by_corroboration">): number {
  const n = r.matches_removed_by_corroboration ?? 0;
  return Number.isInteger(n) ? n : Number.NaN;
}

/**
 * How many files `summarize()` names one by one before it stops and points at the findings file.
 *
 * The console is a screen and the findings file is the record, so the cap is a display decision and
 * not a reporting one: `files_not_read` carries every path, uncapped, and the line above the list
 * says how many were left out. Twenty is enough to name every such file in this workspace's own
 * tree (eight, measured 2026-08-25) and in every corpus tree measured with it.
 */
const NOT_READ_DISPLAY_LIMIT = 20;

/** The `.legal` folder the plugin keeps its working files in (the skill's paths; the walker never opens a dot-folder). */
const WORKING_FOLDER = ".legal";

/**
 * WHAT "SKIPPED" WAS. The paid run of
 * 2026-11-12 printed "Not read: none" on the first screen and "files 11 scanned / 4 skipped" below it: the four were the
 * plugin's own working files under `.legal/`, which the walker leaves out by rule with every dot-folder, and "skipped"
 * read as code not read. The count is unchanged (`stats.files_skipped`); the words say what it holds, from the walker's
 * own rows (`excluded_by_walker`), so the two lines no longer contradict each other.
 */
export function leftOutWords(f: Findings): string {
  const skipped = f.stats?.files_skipped ?? 0;
  if (skipped <= 0) return "";
  const rows = (f as { excluded_by_walker?: { dir?: string; files?: number | null }[] }).excluded_by_walker ?? [];
  const working = rows.filter((r) => r.dir === WORKING_FOLDER || (r.dir ?? "").startsWith(`${WORKING_FOLDER}/`)).reduce((n, r) => n + (r.files ?? 0), 0);
  const own = Math.min(working, skipped);
  const rest = skipped - own;
  const parts = [
    ...(own > 0 ? [`${own} in ${WORKING_FOLDER}, the scan's own working files`] : []),
    ...(rest > 0 ? [`${rest} in dot, machine-written or generated places no rule reads`] : []),
  ];
  return ` / ${skipped} left out by rule (${parts.join("; ")}; each place is under excluded_by_walker)`;
}

/**
 * The walker's refusals by its own reason, as the full report prints them under the members that count them: files and
 * places per reason, the largest first. WolfBoy's
 * own `.legal` at the top is left out, as the sentence above it says (read-scope.ts `isOwnWorkingFolder`): it counted
 * there ("hidden-directory 7 file(s) in 4 place(s)" under a sentence that leaves `.legal` out, FIN4 P2 item 8).
 */
export function walkerReasonParts(excluded: readonly { reason: string; dir?: string; files: number | null }[]): string[] {
  const byReason = new Map<string, { files: number; dirs: number; unknown: boolean }>();
  for (const e of excluded) {
    if (typeof e.dir === "string" && isOwnWorkingFolder(e.dir)) continue;
    const r = byReason.get(e.reason) ?? { files: 0, dirs: 0, unknown: false };
    r.files += e.files ?? 0;
    r.dirs += 1;
    if (e.files === null) r.unknown = true;
    byReason.set(e.reason, r);
  }
  return [...byReason]
    .sort((a, b) => b[1].files - a[1].files)
    .map(([reason, r]) => `${reason} ${r.files}${r.unknown ? "+" : ""} file(s) in ${r.dirs} place(s)`);
}

export function summarize(f: Findings, rules: Rule[]): string {
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const lines: string[] = [];
  // The three severity markers moved to `report.ts` with the candidate row that carries them, and
  // the reason they are padded to 8 characters moved with them: rule ids and paths line up in a
  // column, and ● (U+25CF) has the same East Asian width class as ■ and ▲, so all three rows shift
  // together whether or not the terminal renders ambiguous-width glyphs as double width.
  lines.push(`scan ${f.scan_id.slice(0, 8)} | bundle ${f.bundle.version} | files ${f.stats?.files_scanned ?? 0} scanned${leftOutWords(f)} | rules ${f.stats?.rules_evaluated ?? 0}`);
  // A guard removes a candidate before the agent ever sees it, so the count belongs on the first
  // screen rather than only inside the JSON: silent removals are the ones nobody audits.
  const guardSuppressed = f.stats?.candidates_suppressed_by_guard ?? 0;
  if (guardSuppressed > 0) {
    lines.push(
      `${guardSuppressed} candidate(s) removed by a guard before adjudication — listed under suppressed_by_guard in the findings file`,
    );
  }
  // The other suppression, and the one that actually fires: a corroboration gate removes match
  // lines before they are ever fingerprinted, so nothing about them reached this screen or the
  // findings file until 2026-08-13. Two units in one sentence because they are two facts — how many
  // lines were dropped, and how many (rule, file) decisions dropped them — and a reader who sees
  // only the first cannot tell one shut gate over a large file from many gates over a tree.
  const corroborationSuppressed = f.stats?.matches_suppressed_by_corroboration ?? 0;
  if (corroborationSuppressed > 0) {
    lines.push(
      `${corroborationSuppressed} matched line(s) removed by a corroboration gate before they became candidates, ` +
        `in ${(f.suppressed_by_corroboration ?? []).length} rule/file decision(s) — listed under ` +
        `suppressed_by_corroboration in the findings file`,
    );
  }
  // The other half of the same mechanism: gates a wider `detector.gate_scope` OPENED. It belongs
  // beside the count of what the gate removed because it is the same field's cost — every one of
  // these decisions released lines that the file-scoped reading would have deleted, and those lines
  // are adjudicated in the user's own agent, which the user pays for. 0 for every
  // bundle in which no rule declares the field, so this line does not appear today.
  const gatesOpenedByScope = f.stats?.gates_opened_by_scope ?? 0;
  if (gatesOpenedByScope > 0) {
    lines.push(
      `${gatesOpenedByScope} corroboration gate(s) opened by a wider detector.gate_scope — the ` +
        `corroborating file and line are on each candidate's location, in corroborated_from`,
    );
  }
  // A construct a ceiling refused is a construct the fold did not read, and it is on this screen for
  // the reason the parse failures below are: the reading degrades to the line it opens on, which can
  // never remove a candidate, but a degrade nobody can see is a degrade nobody audits. Absent for
  // every bundle in which no rule declares the view, so this line does not appear today.
  const joinedRefused = f.stats?.joined_constructs_refused ?? 0;
  if (joinedRefused > 0) {
    lines.push(
      `${joinedRefused} multi-line construct(s) not folded — over the line or character ceiling, or ` +
        `never closed in their file; each was read as the single line it opens on`,
    );
  }
  // THE ONE SUBTRACTION ON THIS SCREEN, and it is here because it is the one. Every other line in
  // this block reports a widening or a degrade; this one reports candidates that were REMOVED, and a
  // user comparing two scans across the change that introduced it would otherwise watch findings
  // disappear with nothing in the output saying why. Absent for every bundle in which no rule
  // declares the view, so this line does not appear today.
  const joinedCollapsed = f.stats?.joined_outer_duplicates_dropped ?? 0;
  if (joinedCollapsed > 0) {
    lines.push(
      `${joinedCollapsed} enclosing construct(s) not reported separately — everything each of them ` +
        `matched is matched by a construct inside it, which is what is reported; their opening lines ` +
        `are on that location, in also_opens_at`,
    );
  }
  // A file a rule asked to have parsed and could not is a file only one of the two readings saw.
  // It never removes a candidate — the line reading has already run — but it is a hole, and a hole
  // nobody can see is a hole nobody closes, so it goes on the first screen beside the guard count.
  //
  // EVERY TERM OF THIS SUM IS A FILE COUNT. `structural_findings_out_of_range` is deliberately not
  // among them: it counts discarded findings, not files, and adding it would make the sentence
  // "N file(s)" untrue and let N exceed the number of files scanned.
  const structuralDegraded =
    (f.stats?.structural_grammar_unavailable ?? 0) +
    (f.stats?.structural_parse_failed ?? 0) +
    (f.stats?.structural_skipped_too_large ?? 0) +
    // A file count like the three above, added here on 2026-09-07 with the counter itself: a file
    // the ceiling reduced is read by the line patterns only, which is exactly what this sentence
    // says. Leaving it out would have made the sentence's population smaller than the truth.
    (f.stats?.structural_skipped_partial_source ?? 0);
  if (structuralDegraded > 0) {
    const langs = (f.structural_grammars_unavailable ?? [])
      .map((g) => `${g.language} (${g.files})`)
      .join(", ");
    lines.push(
      `${structuralDegraded} file(s) were read by the line-based patterns only, because the structural reading could not open them` +
        (langs ? `: ${langs} — see structural_grammars_unavailable` : ""),
    );
  }
  // Reported on its own line and in its own unit, for the same reason: a finding the engine refused
  // to emit is a candidate the user never sees, and one nobody counts is one nobody audits.
  const outOfRange = f.stats?.structural_findings_out_of_range ?? 0;
  if (outOfRange > 0) {
    lines.push(
      `${outOfRange} structural finding(s) were discarded for naming a line outside the file they were found in`,
    );
  }
  // Same principle applied one layer earlier: a file that was never opened produced no candidate,
  // and without this line the reader cannot tell that from "there was nothing there". The
  // non-production trees are called out by name because that exclusion is the one under review —
  // it is a single hidden setting deciding the scanning surface of every rule at once.
  // Which rules read the non-production trees, named. The exclusion used to be one hidden setting
  // covering all 43 rules; it is now a per-rule declaration, and a declaration nobody can see is
  // the same hidden setting under a new name.
  // --- Applicability, printed before the findings and never among them. -----------------------
  //
  // Coverage-map row C29: "an applicability signal, not a finding — it must be worded that way or
  // every password manager on GitHub gets a violation candidate". Row B11 says the same about the
  // AI Act: "this looks Annex III — classify yourself", never "you are high-risk". So this block
  // states what the tree shows, names the questions the tree does not answer, and stops.
  const scope = f.applicability ?? [];
  if (scope.length > 0) {
    lines.push("");
    lines.push("APPLICABILITY — does the instrument reach this project at all");
    // ONE BLOCK PER INSTRUMENT, NOT ONE PER CHECKLIST.
    // All three measured trees carry four entries, all four for the Cyber Resilience
    // Act and differing only in `checklist_id`, and this block printed the same 42 lines four
    // times — 173 of one tree's 1,035 lines, and the reader was asked four times whether their
    // product is a motor vehicle. `applicabilityByInstrument` decides that two entries may share
    // one block by comparing what this very block WOULD PRINT for each of them, so a collapse
    // can only happen where there is provably nothing to lose; where they differ in anything a
    // reader would see, each prints its own block under a header naming its checklist.
    const applicabilityBlock = (a: ScopeAssessmentRecord): void => {
      lines.push(`    ${a.because}`);
      // A disagreement between what the person said and what their tree does, printed first
      // because it is the most valuable thing this section can carry. It never resolves itself
      // toward the declaration: a scanner an answer can switch off is a self-assessment form.
      //
      // **What the disagreement is worth is printed with it, from 2026-08-03.** A contradiction
      // whose facts are all of the annotating kinds does not settle the limb — the reader does —
      // and saying "the duty is treated as applying" over such a disagreement was the report
      // asserting the opposite of what the same block said four lines lower, under the label
      // `annotation only - cannot decide the verdict`, about the very same file and line.
      for (const c of a.contradictions ?? []) {
        const e = c.evidence[0];
        // The population, never the sample's length (MODERATE 1 of the 2026-09-03 verification):
        // `evidence[]` is a 20-example preview since the containment landed, and "(+19 more)" was
        // printed over a limb carrying 51. `evidence_count` is exact and computed before the cap.
        const cTotal = c.evidence_count ?? c.evidence.length;
        const more = cTotal > 1 ? `  (+${cTotal - 1} more)` : "";
        const limb = a.limbs.find((l) => l.limb_id === c.limb_id);
        // Since 2026-11-10 only a `decided_by: code` limb is settled by the tree (`settledByCode`): a
        // limb about the product is the person's to answer, whatever the tree holds.
        const decides = limb !== undefined && settledByCode(limb);
        lines.push(`    ! your declaration and this repository disagree: ${c.limb_id}`);
        lines.push(`      you declared ${c.declared_by} = false`);
        if (e) lines.push(`      the tree says otherwise: ${e.kind}  ${e.file}:${e.line}${more}`);
        lines.push(
          decides
            ? `      the duty is treated as applying; check that line if your declaration is right`
            : limb !== undefined && !codeMaySettle(limb)
              ? `      this is a fact about the product: the code can contradict your answer and cannot decide it; because the two disagree, the question stays open below - check the line above and answer it again`
              : `      none of these facts can decide the limb on its own, so your answer does not close it and the tree does not close it either — the limb stays open below and you answer it`,
        );
      }
      // Every limb the tree or the person answered, with **what the answer is worth** on the same
      // line. Two corrections of 2026-07-30, both of them cases of the report knowing something and
      // not printing it:
      //
      // 1. A limb settled purely by a declaration carries no facts, and the old guard skipped any
      //    limb with no facts, so the single input that moved a verdict from `likely-applies` to
      //    `applies` appeared nowhere in the block — measured on one open-source repository, where the string
      //    `in-the-course-of-a-commercial-activity` occurred zero times in the whole output.
      // 2. An annotation-only limb printed the word `settled`, exactly as a required limb does.
      //    Under a decision most commercial evidence annotates and cannot
      //    decide, so a reader has to be able to see which of the two they are looking at.
      const printedAbove = new Set<string>();
      for (const l of a.limbs) {
        const ev = l.supporting_count > 0 ? l.supporting : l.opposing;
        if (l.state === "unresolved") continue;
        // A limb left open by a contradiction is already printed twice — in the `!` block above,
        // with the same first fact and the same `(+n more)`, and under TO ANSWER below with its
        // question. A third copy here carrying a different label is the self-contradiction this
        // block was corrected for on 2026-08-03, in the other direction.
        if (l.state === "contradicted-by-declaration" && l.supporting_count === 0) continue;
        // A limb still open that bears on the verdict — since 2026-11-10 that includes every such
        // limb about the product the code bears on — is printed once, under TO ANSWER below, with
        // what the code suggests. Printing it here as well is the second copy this block avoids.
        // An open annotation-only limb with facts stays here, so its facts are still shown: a
        // demotion in deciding power is not a suppression.
        if (limbIsOpen(l) && l.bears_on_verdict) continue;
        const answeredWithoutFacts =
          l.state === "settled-by-declaration" || l.state === "settled-by-premise";
        if (ev.length === 0 && !answeredWithoutFacts) continue;
        // Said as what it is: what the
        // code shows, what the person answered, or what the EU rules take as given; never "settled" of a product fact. A `supported` limb that bears on the verdict is
        // printed here only when it is a `decided_by: code` limb (a product fact still open is under TO ANSWER), so it is
        // "settled by the code"; a fact about the product is what the code suggests.
        const label =
          l.state === "supported"
            ? l.bears_on_verdict
              ? "settled by the code"
              : codeMaySettle(l)
                ? "annotates"
                : "annotates (what the code suggests; yours to answer)"
            : l.state === "settled-by-premise"
              ? "taken as given by the EU rules"
              : l.state === "settled-by-declaration" && l.decided_by === "premise"
                ? "you answered No to the region question for the EU, which answers"
                : l.state === "settled-by-declaration"
                  ? "you answered"
                  : l.state;
        const weight = l.bears_on_verdict ? "" : "  [annotation only - cannot decide the verdict]";
        const declared =
          l.declared_by && l.declared_value !== null && l.declared_value !== undefined && l.decided_by !== "premise"
            ? ` (you declared ${l.declared_by} = ${l.declared_value})`
            : "";
        const first = ev[0];
        // Same correction, on the array this line actually chose: `ev` is `supporting` where that is
        // non-empty and `opposing` otherwise, so the population is the matching count.
        const evTotal = l.supporting_count > 0 ? l.supporting_count : l.opposing_count;
        const more = evTotal > 1 ? `  (+${evTotal - 1} more)` : "";
        lines.push(
          `    ${label}: ${l.limb_id}${declared}${weight}` +
            (first ? `\n      ${first.kind}  ${first.file}:${first.line}${more}` : ""),
        );
        printedAbove.add(l.limb_id);
      }
      // An unresolved limb is the output, not a gap in it. Naming which one, and how it would be
      // settled, is what stops a reader taking "likely-applies" for a decision. Split in two: a
      // limb that bears on the verdict is a question the reader has to answer, and one that does
      // not is context. Printing both at the same weight — as the first version of this block did
      // — buries the two that matter under six that do not.
      // Derived from `unresolved_limbs` rather than from the state alone, so the one list the JSON
      // publishes and the one the console prints cannot disagree. A limb whose declaration was
      // contradicted by facts that cannot decide it is in that list from 2026-08-03; before the
      // correction it was in neither, because the evaluator counted it as settled.
      const openIds = new Set(a.unresolved_limbs ?? []);
      const open = a.limbs.filter((l) => openIds.has(l.limb_id));
      for (const l of open.filter((l) => l.bears_on_verdict)) {
        lines.push(`    TO ANSWER (${l.decided_by}): ${l.limb_id}`);
        lines.push(`      ${l.question.replace(/\s+/g, " ").trim()}`);
        // What the code
        // suggests, under the question it bears on, and never as an answer. A contradicted limb's
        // facts are already printed in the block above.
        if (l.state === "contradicted-by-declaration") continue;
        // An open limb the person gave a value
        // for is one whose `declared_answers` does not list that value (scope.ts): say so, so the answer is not lost.
        if (l.declared_by && typeof l.declared_value === "boolean") {
          lines.push(`      you declared ${l.declared_by} = ${String(l.declared_value)}; that does not answer this question`);
        }
        // A web manifest or service worker is named as what it is, never
        // as a yes (WEB_CLIENT_WORDS); the other facts suggest what they show.
        const webClient = l.supporting.filter((e) => e.kind === WEB_CLIENT_KIND);
        // A dependency only names a library: it is shown last,
        // and where it is all the code holds it is said as that, never as a yes.
        const sug = (l.supporting_count > 0 ? l.supporting.filter((e) => e.kind !== WEB_CLIENT_KIND) : l.opposing)
          .map((e, i) => ({ e, i }))
          .sort((p, q) => Number(p.e.kind === DEPENDENCY_KIND) - Number(q.e.kind === DEPENDENCY_KIND) || p.i - q.i)
          .map(({ e }) => e);
        const sugTotal = l.supporting_count > 0 ? l.supporting_count - webClient.length : l.opposing_count;
        const s0 = sug[0];
        if (s0 !== undefined && s0.kind === DEPENDENCY_KIND && l.supporting_count > 0) {
          // Words
          lines.push(`      the code holds only a dependency here, which names a library that may or may not open a connection - only you can confirm: ${s0.file}:${s0.line}` + (sugTotal > 1 ? `  (+${sugTotal - 1} more)` : ""));
        } else if (s0 !== undefined) {
          lines.push(
            `      the code suggests ${l.supporting_count > 0 && l.opposing_count > 0 ? "both yes and no" : l.supporting_count > 0 ? "yes" : "no"}, which only you can confirm: ${s0.kind}  ${s0.file}:${s0.line}` +
              (sugTotal > 1 ? `  (+${sugTotal - 1} more)` : ""),
          );
        } else if (l.limb_id === PRODUCT_LIMB) {
          // What the code shows when it holds nothing users install
          // or run on their side: what a hosted web application or API looks like, said as that and never as a yes or a no.
          lines.push(`      the code shows nothing users install or run on their side (no package, app bundle, installer, browser extension or release); a web app or API you run on your own servers looks like this - only you can confirm it`);
        }
        // A web manifest or service worker, said as what it is.
        if (webClient.length > 0) {
          lines.push(`      ${WEB_CLIENT_WORDS}: ${webClient[0]!.file}:${webClient[0]!.line}${webClient.length > 1 ? `  (+${webClient.length - 1} more)` : ""}`);
        }
        // Where the person records the answer.
        if (l.declared_by && l.declared_by !== "regions_not_offered") {
          lines.push(`      answer it as ${l.declared_by} (yes or no): ${reviewDeclarationCommand()}`);
        }
      }
      // Those printed above with their facts are not counted again here.
      const context = open.filter((l) => !l.bears_on_verdict && !printedAbove.has(l.limb_id));
      if (context.length > 0) {
        lines.push(
          `    ${context.length} further question(s) the code does not answer, which add detail to a finding ` +
            `rather than decide whether the law applies: ${context.map((l) => l.limb_id).join(", ")}`,
        );
      }
    };
    for (const g of applicabilityByInstrument(scope)) {
      const first = g.entries[0];
      if (first === undefined) continue;
      if (g.identical) {
        lines.push(`  ${first.law}  [${first.verdict}]`);
        if (g.entries.length > 1) lines.push(checklistsGovernedLine(g));
        applicabilityBlock(first);
      } else {
        for (const a of g.entries) {
          lines.push(checklistBlockHeader(a));
          applicabilityBlock(a);
        }
      }
    }
    const notAssessed = f.applicability_not_assessed ?? [];
    if (notAssessed.length > 0) {
      lines.push(
        `  ${notAssessed.length} further law(s) have a scope test still written as prose, so their reach was not assessed: ` +
          notAssessed.join(", "),
      );
    }
    lines.push(
      "  This section is a classification, not a finding. No candidate below was removed, " +
        "suppressed or downgraded by it; where a candidate's own citation turns on one of these " +
        "verdicts, it carries the verdict in depends_on_applicability.",
    );
    lines.push("");
  }

  // --- WHAT THIS SCAN READ PAST — one block, one order, one wording (2026-09-10). ---------------
  //
  // Six separate lines stood here until this unit: the rules that declare their own surface, the
  // walker's aggregate, its non-production "of which", the engine's refusals, the blanked lines, and
  // nothing at all about the read scope, which did not exist. They were six answers to one question
  // and no two of them were phrased alike; the walker line described an exclusion the walker had
  // stopped making, and the `file_globs` line described a default (`test, spec, fixtures, mocks,
  // stories`) that the WALKER no longer applies — true of `engine.ts:surfaceAllows` and false of the
  // walk, with nothing on the screen saying which. The instruction on the design was
  // "make it consistent with the other outputs too", and this is it: the model is built once in
  // `read-scope.ts`, carried in `findings.coverage_limits`, and PRINTED FROM ITS OWN SENTENCES here,
  // in the SARIF and in the layer-2 report. This function composes none of them.
  //
  // The per-file lists stay, underneath the sentence that counts them, because the reader's question
  // about a file is never "how many" but "was MY file read" — and they stay capped at
  // NOT_READ_DISPLAY_LIMIT, with the findings file named as the uncapped record.
  const limits = f.coverage_limits;
  const excluded = f.excluded_by_walker ?? [];
  const notRead = f.files_not_read ?? [];
  const partial = f.files_partially_read ?? [];

  // The detail that sits UNDER a member: the directories the two path members count from, and the
  // files the third counts. Built here and printed inside the loop below, because a list printed
  // after the block is read as belonging to the last member — the first draft of this change put the
  // walker's by-reason index under "rules that ran and produced no candidate".
  const byReasonDetail = (): string[] => {
    const parts = walkerReasonParts(excluded);
    if (parts.length === 0) return [];
    return [
      `      the members above, by the walker's own reason: ${parts.join(" | ")} — every directory ` +
        `is named under excluded_by_walker in the findings file`,
    ];
  };

  // The reader's question about a file is never "how many" but "was MY file read", so the files are
  // NAMED — capped for the screen, with the count of what was left out and the findings key that
  // holds all of them. "This file was not read" and "this file was read and three of its lines were
  // not" are different statements and the reader's next action differs, so the two lists stay apart.
  const notReadDetail = (): string[] => {
    const out: string[] = [];
    const longLine = notRead.filter((n) => n.reason === "long-line");
    const unreadable = notRead.filter((n) => n.reason === "unreadable");
    if (longLine.length > 0) {
      const limit = longLine[0]?.threshold;
      out.push(
        `      ${longLine.length} were skipped as build output because a line exceeded ${limit ?? "the"} ` +
          `character(s). That test is a proxy for build output and an authored file with one long line ` +
          `reaches it too — check these before treating them as read:`,
      );
      for (const n of longLine.slice(0, NOT_READ_DISPLAY_LIMIT)) {
        out.push(`        ${n.file} (longest line ${n.longest_line ?? "?"})`);
      }
      if (longLine.length > NOT_READ_DISPLAY_LIMIT) {
        out.push(`        ... and ${longLine.length - NOT_READ_DISPLAY_LIMIT} more in files_not_read`);
      }
    }
    if (unreadable.length > 0) {
      out.push(`      ${unreadable.length} could not be read at all:`);
      for (const n of unreadable.slice(0, NOT_READ_DISPLAY_LIMIT)) {
        out.push(`        ${n.file} — ${n.detail ?? "no detail"}`);
      }
      if (unreadable.length > NOT_READ_DISPLAY_LIMIT) {
        out.push(`        ... and ${unreadable.length - NOT_READ_DISPLAY_LIMIT} more in files_not_read`);
      }
    }
    // Its own list, like the two above it: "no rule read a line of this file, because the clock ran
    // out before the first one did" is a different statement from the other two and the reader's
    // next action differs — this one is an option away from being read.
    const outOfTime = notRead.filter((n) => n.reason === "time-budget");
    if (outOfTime.length > 0) {
      out.push(
        `      ${outOfTime.length} were stopped before any rule read a line, because opening and preparing the ` +
          `file alone passed the per-file time budget:`,
      );
      for (const n of outOfTime.slice(0, NOT_READ_DISPLAY_LIMIT)) {
        out.push(`        ${n.file} — ${n.elapsed_ms ?? "?"} ms against a ${n.budget_ms ?? "?"} ms budget`);
      }
      if (outOfTime.length > NOT_READ_DISPLAY_LIMIT) {
        out.push(`        ... and ${outOfTime.length - NOT_READ_DISPLAY_LIMIT} more in files_not_read`);
      }
    }
    if (partial.length > 0) {
      out.push(
        `      the lines left out are named here, each by the file's own line number; neither the ` +
          `yaml-anchors gate view nor the structural reading may be used on a file in this list, ` +
          `because both read the document rather than the line:`,
      );
      // Added only when a row in the list actually carries one, so a tree the budget never touched
      // prints the block it printed before the budget existed.
      if (partial.some((p) => p.census_stopped_for_time !== undefined)) {
        out.push(
          `      a row reading "census stopped for time" is the census's own pass over the file: it passed the ` +
            `per-file time budget there and read the file only up to the stage named; --file-budget raises it:`,
        );
      }
      if (partial.some((p) => p.stopped_for_time !== undefined)) {
        out.push(
          `      a row reading "stopped for time" is the other cause: the file's read passed the ` +
            `per-file time budget, so the rule named there read it only down to that line and the rules ` +
            `below it did not read it at all. --file-budget <seconds> raises the budget, --file-budget off ` +
            `removes it:`,
        );
      }
      for (const p of partial.slice(0, NOT_READ_DISPLAY_LIMIT)) {
        // TWO CAUSES SINCE 2026-09-16 and a row states the ones it has, in this order, so a row with
        // only blanked lines prints the line it printed before the budget existed, character for
        // character. `p.lines` is optional now — a row here for the time budget alone has none.
        const parts: string[] = [];
        if (p.lines && p.lines.length > 0) {
          parts.push(`line(s) ${p.lines.map((l) => `${l.line} (${l.length} chars)`).join(", ")}`);
        }
        const s = p.stopped_for_time;
        if (s) {
          parts.push(
            `stopped for time at line ${s.lines_read + 1} of ${s.lines_total}, after ${s.rules_completed} of ` +
              `${s.rules_total} rules had read it (${s.elapsed_ms} ms against a ${s.budget_ms} ms budget)`,
          );
        }
        const r = p.structural_reading_stopped;
        if (r) {
          parts.push(
            `read line by line by every rule, but its structural reading stopped after ${r.elapsed_ms} ms ` +
              `against a ${r.allowance_ms} ms allowance, so no rule read it as a document`,
          );
        }
        const cs = p.census_stopped_for_time;
        if (cs) {
          parts.push(
            `census stopped for time at ${cs.stage}` +
              (cs.lines_read !== undefined ? ` line ${cs.lines_read + 1} of ${cs.lines_total}` : "") +
              ` (${cs.elapsed_ms} ms against a ${cs.budget_ms} ms budget)`,
          );
        }
        out.push(`        ${p.file} — ${parts.join("; ")}`);
      }
      if (partial.length > NOT_READ_DISPLAY_LIMIT) {
        out.push(`        ... and ${partial.length - NOT_READ_DISPLAY_LIMIT} more in files_partially_read`);
      }
    }
    return out;
  };

  if (limits) {
    lines.push("");
    lines.push(COVERAGE_LIMITS_HEADING);
    for (const limit of limits.limits) {
      lines.push(`  ${limit.sentence}`);
      if (limit.id === "refused-by-rule") for (const d of byReasonDetail()) lines.push(d);
      if (limit.id === "not-readable-as-code") for (const d of notReadDetail()) lines.push(d);
    }
  } else if (excluded.length > 0 || notRead.length > 0 || partial.length > 0) {
    // A document written before 2026-09-10 carries the counts and not the model. Its lists are still
    // printed — they are fields of that document — under a heading that says why the sentences are
    // missing, because `summarize()` is exported and the eval tooling reads old documents back.
    lines.push("");
    lines.push(
      `${COVERAGE_LIMITS_HEADING} — this scan document was written before the coverage model, so ` +
        `only the counts it carried are below.`,
    );
    for (const d of byReasonDetail()) lines.push(d);
    for (const d of notReadDetail()) lines.push(d);
  }
  // The rules that declare their own scanning surface, kept as its own line and REWORDED. The old
  // sentence named the walker's default; a rule's `file_globs` overrides `engine.ts:surfaceAllows`,
  // which is a per-rule default, and it does NOT override the run's read scope — a class the run did
  // not opt into is not read for any rule, and the block above is where that is stated.
  const widened = rules.filter((r) => (r.detector.file_globs ?? []).length > 0);
  if (widened.length > 0) {
    lines.push(
      `  ${widened.length} rule(s) declare their own scanning surface with detector.file_globs, so the ` +
        `per-rule default (which excludes test, spec, fixtures, mocks and stories) does not apply to ` +
        `them: ${widened.map((r) => r.id).join(", ")}. The read scope above still does.`,
    );
  }
  // The census's own refusal, one channel further in again: a `package.json` the walker read, every
  // rule saw, and the DEPENDENCY parse could take nothing from. Printed because the alternative is
  // the state the design forbids — `dependency_inventory: []` from a manifest that could not be read
  // reads exactly like `dependency_inventory: []` from a tree with no npm manifest, and the
  // inventory's own description tells the reader the second thing.
  //
  // **The count is of REFUSALS, not of files, and the sentence says so.** Since the census reads
  // four dependency blocks a single manifest can contribute one refusal
  // per malformed block while its other blocks are read normally — so "N files were read and no
  // dependency was taken from them" would be false in two ways at once: it would count blocks as
  // files, and it would claim nothing was taken from a manifest that may have supplied most of the
  // inventory. That is the D5 fault of this same session's earlier console line, which claimed a
  // comparison the code did not run; the repair there and here is the same one, which is to say
  // exactly what was refused.
  const manifestsNotUsable = f.stats?.manifests_not_usable ?? 0;
  if (manifestsNotUsable > 0) {
    lines.push(
      `${manifestsNotUsable} dependency declaration(s) in this tree's package.json files were ` +
        `refused — a file that is not valid JSON, or one block of a file holding something that is ` +
        `not a name-to-version map — so this scan's dependency inventory does not cover what those ` +
        `refusals would have declared. A file's other blocks are still read, so this is not a ` +
        `statement that a whole manifest was lost. The count is stats.manifests_not_usable in the ` +
        `findings file, and census.manifests_not_usable in the reconciliation input names each file ` +
        `and says which block`,
    );
  }
  // --- What produced nothing, printed whether or not anything else did. ---------------
  //
  // This block used to be one sentence — "No candidates found." — printed when `candidates` was
  // empty, and nothing at all when it was not. Both were wrong in the same way. The first says
  // "nothing found" where the truthful statement is "N rules read your code and matched none of
  // it, M never ran, and neither of those is a statement that your code is in order". The second
  // let a scan that raised four candidates and left fifty-two rules silent read as a scan of four
  // questions.
  //
  // Printed BEFORE the candidate list, and printed even when the list is long, because a reader
  // who stops after the findings has read the half of the document that cannot mislead them.
  // Counted by `censusSilentRules` above rather than here, so that the `--fail-on-unreviewed` message in
  // index.ts and this block can never state different numbers about the same roster.
  const census = censusSilentRules(f);
  const silent = census.all;
  const notEvaluated = census.notEvaluated;
  if (silent.length > 0) {
    lines.push("");
    lines.push(
      `UNKNOWN — ${silent.length} rule(s) produced no candidate. That is not a finding that your code is in order.`,
    );
    // FOUR CLAUSES, EACH IN ITS OWN UNIT, AND TOGETHER THEY ARE THE WHOLE ROSTER.
    //
    // Until 2026-08-24 the first clause counted `census.evaluated` — which CONTAINS `noSurface` and
    // `gated` — and corrected itself with two "of which" lines beneath. Three things were wrong with
    // that, and the file said so about itself in two other places while doing it. On an empty
    // directory it printed "56 ran over this tree and matched nothing" beside "files 0 scanned"; on
    // a gated tree it printed "36 ran over this tree and matched nothing" where 33 had, and called
    // `eu-retention-002` silent in the same block that then said it had matched. `index.ts` argues
    // in terms that an "of which" is the wrong shape — "a reader may not reach" it — and the
    // `matchedNothing` doc comment above states that it "is the only population the words 'matched
    // nothing' may be counted from". The correction now happens before the sentence is written
    // rather than after it is read.
    if (census.matchedNothing.length > 0) {
      lines.push(
        `  ${census.matchedNothing.length} were offered at least one file in this tree and matched nothing. ` +
          `A detector that did not find the construct is not evidence that the construct is absent — it may ` +
          `be spelled a way these patterns do not know.`,
      );
    }
    // The two populations whose silence means something different from the rest. Named on their own
    // lines, in their own unit, because a reader who cannot see them reads every row the same way.
    if (census.gated.length > 0) {
      lines.push(
        `  ${census.gated.length} DID match their own patterns and were then silenced by a corroboration gate — ` +
          `the construct is in this tree: ${census.gated.map((r) => `${r.rule_id} (${r.matches_removed_by_corroboration})`).join(", ")}`,
      );
    }
    if (census.noSurface.length > 0) {
      lines.push(
        `  ${census.noSurface.length} were in scope but were offered no file at all in this tree (their declared ` +
          `surface matched nothing here), so their silence is about the layout of this repository and not about ` +
          `its code: ${census.noSurface.map((r) => r.rule_id).join(", ")}`,
      );
    }
    if (notEvaluated.length > 0) {
      lines.push(
        `  ${notEvaluated.length} never ran, because answers in your own ScanProfile put them out of scope. ` +
          `Check those answers against your README and your product before accepting the silence: ` +
          `${notEvaluated.map((r) => `${r.rule_id} (${(r.unmet_preconditions ?? []).join(" ")})`).join(", ")}`,
      );
    }
    lines.push(
      "  Each is listed under rules_without_candidates in the findings file with its title and what it was " +
        "looking for (evidence_template). Adjudicate them: where a rule's silence is surprising for this " +
        "product, search the repository yourself before accepting it.",
    );
    lines.push("");
  }

  // THE QUESTIONS NOBODY ANSWERED, printed whatever the candidate count is and in its own block.
  //
  // Counted over the WHOLE document — candidates as well as the silent roster — because a rule that
  // ran on an open premise and then fired is the case where the premise matters most. Grouped by
  // expression rather than by rule: the person answers a question, not a rule, and one unanswered
  // `features.ugc` is holding two rules open here.
  //
  // Before 2026-08-25 this block could not exist, because an unanswered question removed the rule
  // and the console said the person's own answers had put it out of scope — about a profile that
  // carried no such answer. See engine.ts `preconditionStatus`.
  const openQuestions = new Map<string, string[]>();
  for (const r of [...(f.rules_without_candidates ?? []), ...f.candidates]) {
    const id = "rule_id" in r ? r.rule_id : "";
    for (const q of r.unanswered_preconditions ?? []) {
      const seen = openQuestions.get(q) ?? [];
      if (!seen.includes(id)) seen.push(id);
      openQuestions.set(q, seen);
    }
  }
  if (openQuestions.size > 0) {
    lines.push(
      `${openQuestions.size} question(s) in your ScanProfile are unanswered, and the rules that turn on them ` +
        `RAN ANYWAY rather than being switched off. Nothing here is out of scope on the strength of a ` +
        `silence — answer these and re-run to narrow it, or read the findings as they stand:`,
    );
    for (const [q, ids] of [...openQuestions].sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`  ${q} — ${ids.length} rule(s): ${ids.join(", ")}`);
    }
    lines.push("");
  }

  // WHAT YOU DECLARED, AGAINST WHAT THIS SCAN FOUND. Printed whatever the candidate count is, in its
  // own block, above the findings.
  //
  // **This is the valuable output of the change of 2026-08-27**, and it has two halves that must
  // both be printed:
  //
  //  - CONTRADICTED — you declared this out of scope and the detector raised candidates on its
  //    subject. Before the change the rule read no line and the document said `not-evaluated`, so
  //    this sentence was unreachable however wrong the answer was. Measured over the eight pass-1
  //    runs of 2026-08-26: 21 of the 69 located misses were rules in exactly this position, and
  //    one tree declared `audience.consumer: false` over a public careers portal.
  //  - CORROBORATED — you declared this out of scope, the detector was allowed to look, and it found
  //    nothing. **Worth one line and not zero**: it is the difference between an answer nobody
  //    checked and an answer a pass over the tree did not contradict. It is not a clearance, and the
  //    sentence says so, because a detector that did not find a construct has not established that
  //    the construct is absent.
  //
  // Assembled from the document's own fields and from nothing else — the candidates and the roster
  // rows each carry `declared_inapplicable_preconditions`, so this block is a reading of what was
  // written rather than a second computation that could disagree with it.
  //
  // Grouped by rule and not by expression, unlike the block above: what the reader has to do here is
  // open a file at a line, and the line belongs to a rule. The expression is printed beside it
  // because it names the field of their own profile they have to go and re-answer.
  const contradicted = new Map<string, { conds: string[]; locations: number; first: string }>();
  for (const c of f.candidates) {
    const conds = c.declared_inapplicable_preconditions ?? [];
    if (conds.length === 0) continue;
    const entry = contradicted.get(c.rule_id) ?? { conds: [...conds], locations: 0, first: "" };
    entry.locations += c.locations.length;
    // The first location in document order, which is the sort `runScan` already applied — so the
    // line a reader is sent to is the same one on two runs of the same tree.
    const l = c.locations[0];
    if (!entry.first && l) entry.first = `${l.file}:${l.start_line}`;
    contradicted.set(c.rule_id, entry);
  }

  // THE SILENT HALF IS NOT ONE POPULATION, AND CALLING IT ONE PRINTED A SENTENCE THE SAME SCREEN
  // CONTRADICTED (found by independent verification, 2026-08-27, defect D1).
  //
  // Until that day this half was built from EVERY labelled roster row —
  // `if (conds.length > 0 && !contradicted.has(...))` — and then said of all of them: "answered out
  // of scope and raised nothing, so this pass did not contradict the answer". A roster row is silent
  // in three different ways and that sentence is true of exactly one of them. Reproduced on a
  // planted tree: a labelled rule whose own patterns matched and whose corroboration gate then shut
  // printed in the UNKNOWN block four lines above as "DID match their own patterns … the construct is
  // in this tree" and in this block as "raised nothing"; a labelled rule offered no file at all
  // printed as a detector that looked and found nothing; and scanning an EMPTY DIRECTORY reported
  // four corroborations beside "files 0 scanned".
  //
  // `censusRoster` exists to make exactly this distinction, and the `matchedNothing` doc comment 400
  // lines above says in terms that it "is the only population the words 'matched nothing' may be
  // counted from". So this block counts from the census, one clause per population, in the shape the
  // UNKNOWN block above already uses — and no labelled row is dropped: the four clauses below cover
  // the four populations `censusRoster` partitions the roster into, so every labelled row is printed
  // under the sentence that is true of it.
  const labelledRow = (r: RuleWithoutCandidates): string[] | null => {
    const conds = r.declared_inapplicable_preconditions ?? [];
    // A rule cannot be in both arrays — `runScan` partitions the bundle between them — but this is
    // read from a document rather than from the run that wrote it, so the exclusion is asserted
    // here rather than assumed of the producer.
    return conds.length > 0 && !contradicted.has(r.rule_id) ? [...conds] : null;
  };
  const labelledIn = (rows: RuleWithoutCandidates[]): Array<[string, string[]]> =>
    rows
      .map((r) => [r.rule_id, labelledRow(r)] as const)
      .filter((e): e is [string, string[]] => e[1] !== null)
      .sort((a, b) => a[0].localeCompare(b[0]));
  const namesOf = (entries: Array<[string, string[]]>): string =>
    entries.map(([id, conds]) => `${id} (${conds.join(" ")})`).join(", ");
  const corroborated = labelledIn(census.matchedNothing);
  const labelledGated = labelledIn(census.gated);
  const labelledNoSurface = labelledIn(census.noSurface);
  const labelledNotEvaluated = labelledIn(census.notEvaluated);
  const silentLabelled =
    corroborated.length + labelledGated.length + labelledNoSurface.length + labelledNotEvaluated.length;

  if (contradicted.size > 0 || silentLabelled > 0) {
    lines.push(
      `YOUR DECLARATION, AGAINST WHAT THIS SCAN FOUND — ${contradicted.size + silentLabelled} rule(s) ran ` +
        `although answers in your ScanProfile put them out of scope. None of them was switched off; ` +
        `a declaration labels what a rule reports and never stops it from reading:`,
    );
    for (const [id, e] of [...contradicted].sort((a, b) => a[0].localeCompare(b[0]))) {
      // "raised N location(s) ON ITS SUBJECT" stood here until 2026-08-27 and asserted what layer 1
      // does not establish (defect D3). A location is a line that matched a pattern; whether it is
      // on the rule's subject is the question layer 2 exists to answer, and several rules say so in
      // their own `evidence_template` — `ai-transparency-008`'s reads "the detector did not establish
      // that AI-generated text reaches a publisher", while this line called four matches on a CSV
      // analytics dump row "on its subject". The sentence now claims only that the lines matched, and
      // sends the reader to the rule's own account of what that does and does not establish.
      //
      // "either the answer is wrong, or the candidate is" stood beside it and was a false dichotomy
      // (defect D2). The project's own harvest classes 8 of the 21 recorded cases as ones where the
      // declared answer is right AND the candidate is legitimate — an analytics application + `ai-transparency-008`
      // is recorded there as an answer the investigator independently corroborated, on a rule firing
      // from its publishing-sink branch. Enumerating two outcomes that exclude the true one sends the
      // person to re-answer a question they answered correctly, under the authority of an imperative.
      // What is printed now is what was observed, and the question is handed over rather than framed.
      lines.push(
        `  ! ${id} — your ScanProfile answers ${e.conds.join(" ")} in a way that puts this rule out of scope, ` +
          `and this scan raised ${e.locations} location(s) whose lines matched this rule's patterns, first at ` +
          `${e.first || "(no location)"}. What such a match does and does not establish is in that rule's ` +
          `evidence_template, beside the candidate in the findings file. Read the line and say what it is: an ` +
          `answer that is right about the shipped product and a line that is right about tooling, a fixture or ` +
          `a dependency can both stand, and a rule's construct can be wider than the question you answered. ` +
          `Nothing here decides which, and the scanner may not — a fact about your product is yours to state.`,
      );
    }
    // COUNTED FROM `matchedNothing` AND FROM NOTHING ELSE. This is the only one of the four clauses
    // that may say the detector looked and found nothing.
    if (corroborated.length > 0) {
      lines.push(
        `  ${corroborated.length} answered out of scope, were offered at least one file, and matched nothing in ` +
          `it, so this pass did not contradict the answer — which is not the same as confirming it, and is not ` +
          `a clearance: ${namesOf(corroborated)}`,
      );
    }
    // The other three silences, each in its own unit. A labelled rule whose gate shut is the OPPOSITE
    // of a corroboration: the construct is demonstrably in this tree, on lines the rule itself
    // matched.
    if (labelledGated.length > 0) {
      lines.push(
        `  ${labelledGated.length} answered out of scope DID match their own patterns here and were then silenced ` +
          `by a corroboration gate, so this pass did not corroborate the answer — the construct is in this tree ` +
          `and the removals are listed under suppressed_by_corroboration: ${namesOf(labelledGated)}`,
      );
    }
    if (labelledNoSurface.length > 0) {
      lines.push(
        `  ${labelledNoSurface.length} answered out of scope were offered no file at all in this tree, so this ` +
          `pass neither contradicted nor corroborated the answer — nothing was read for them, and their silence ` +
          `is about this repository's layout: ${namesOf(labelledNoSurface)}`,
      );
    }
    // Unreachable from a scan this version writes — a labelled row is written only for a rule that
    // ran — and printed anyway, because `summarize()` is exported and is called on documents written
    // before 2026-08-27. A row that carried both would otherwise be counted into the header and
    // named nowhere.
    if (labelledNotEvaluated.length > 0) {
      lines.push(
        `  ${labelledNotEvaluated.length} answered out of scope never ran at all in the pass that wrote this ` +
          `document, so nothing here bears on the answer: ${namesOf(labelledNotEvaluated)}`,
      );
    }
    lines.push("");
  }

  // WHAT YOUR MANIFEST DECLARES, AGAINST WHAT THIS SCAN NAMED. Its own block, above the findings,
  // printed whatever the candidate count is — and printed only when there is something to print.
  //
  // **Modelled line for line on the declaration block above, including its two recorded wording
  // defects, because this is the same shape of sentence and would have acquired the same faults.**
  //   - D3: it may not say what a match or a silence MEANS. The sentence states what was compared
  //     and what came back, and nothing about what either establishes.
  //   - D2: no dichotomy. "Either the dependency is unused or the detector missed it" excludes the
  //     commonest case of all — a dependency that is used exactly as intended by code no rule of
  //     this bundle is about — and would send a person to look for a defect that is not there.
  //
  // **The header acquired the D3 fault anyway and was corrected on 2026-08-28.** It said "no line
  // any rule matched in this tree contains that spelling", and the comparison
  // `declaredVendorsWithoutCandidates` actually runs is against the matched lines of `consulted` —
  // the rules that splice the lists this name matched — so a line matched by any other rule of the
  // bundle was never looked at. Found by independent verification; the per-row sentence below and
  // the schema description were both already accurate, and only this one sentence over-claimed.
  //
  // The inverse direction is deliberately not printed. A candidate naming a vendor that no manifest
  // declares is ordinary: a vendor is routinely reached over plain HTTP with no SDK at all, so a
  // console line for it would fire on almost every tree and train the reader to skip this block.
  // `SKILL.md` step 4 hands that direction to the adjudicating agent, which has the file open.
  const declaredVendors = f.declared_vendors_without_candidates ?? [];
  if (declaredVendors.length > 0) {
    lines.push(
      `WHAT YOUR MANIFEST DECLARES, AGAINST WHAT THIS SCAN NAMED — ${declaredVendors.length} declared ` +
        `dependency(ies) are spelled like a recipient this bundle's vocabulary knows, and no line ` +
        `matched by the rules that splice those vocabulary lists contains that spelling. Lines ` +
        `matched by every other rule of this bundle were not compared against these names, and ` +
        `each row below names the rules that were:`,
    );
    for (const d of declaredVendors) {
      const where = d.declared[0];
      // **A SECOND DECLARATION IS NOT A SECOND MANIFEST, AND THIS SENTENCE USED TO SAY IT WAS.**
      // Until the inventory read four blocks a package could carry a
      // second `declared` entry only from a second `package.json`, so "and in N other manifest(s)"
      // was true. One manifest declaring the same package in `dependencies` and in
      // `devDependencies` — the exact shape the `field` label was added to describe — then made it
      // false: a tree with ONE manifest printed "and in 1 other manifest(s)", sending a reader to a
      // file that does not exist, three lines above this block's own promise that "both halves are
      // things you can check by opening a file". Found by independent verification, 2026-08-28, and it is the D5 fault
      // of the day before — a console sentence claiming something the code did not do — in the same
      // function that had it repaired for `manifests_not_usable` in the same session.
      //
      // **Both units are now named, because they are different numbers and the reader needs the
      // one that sends them to a file.** DECLARATIONS is what `declared` counts; MANIFEST FILES is
      // what a reader opens. The block a declaration sits in is printed with the citation for the
      // same reason: a reader opening `package.json:11` should already know it is the
      // `devDependencies` line before they get there.
      const manifestFiles = new Set(d.declared.map((x) => x.file)).size;
      const others =
        d.declared.length > 1
          ? ` and in ${d.declared.length - 1} further declaration(s), ` +
            (manifestFiles === 1
              ? `all in that same manifest file`
              : `spread over ${manifestFiles} manifest files in total`)
          : "";
      lines.push(
        `  ? ${d.package} — declared at ${where ? `${where.file}:${where.line} in ${where.field}` : "(no manifest line)"}` +
          `${others}, ` +
          `${
            !d.declared_only
              ? "and imported in this tree"
              : d.call_sites_not_read
                ? `with no import found in what this scan read, while ${d.call_sites_not_read.lines_past_ceiling} line(s) past the line ceiling and ${d.call_sites_not_read.files} file(s) not read to their end could hold one: whether it is imported was NOT READ`
                : "and imported from nowhere this scan could see"
          }. ` +
          `It matches ${d.matched_anchors.join(", ")} in ${d.matched_anchor_lists.join(", ")}, and ` +
          `${d.rules_consulted.join(", ")} matched no line containing that spelling here. ` +
          `Both halves are things you can check by opening a file. Nothing here says the vendor ` +
          `receives anything, that a detector missed something, or that the manifest is wrong — a ` +
          `dependency used exactly as intended by code no rule of this bundle is about produces this ` +
          `line, and so does a vendor named in this tree only by a spelling that is not this one.`,
      );
    }
    lines.push("");
  }

  if (f.candidates.length === 0) {
    // "No detector matched anything in this tree" was false whenever a match was removed before it
    // could become a candidate, and it was the ONE sentence in this block that carried neither a
    // count nor a correction. On the tree that a test case (8) builds — a single
    // line, `export const config = { enableCleanup: false };` — `eu-retention-002`'s own pattern
    // matches and a corroboration gate then removes it, and this line still said that nothing
    // matched. It is the design's defect in its plainest form: absence of a CANDIDATE reported as
    // absence of a MATCH.
    //
    // What is stated now is only what the scan can support — no candidate was raised — with the two
    // removal channels named whenever they are non-empty, so a reader is sent to the rows where the
    // construct is demonstrably present rather than away from them. Nothing here asserts that no
    // detector matched: `suppressed_by_corroboration` and `suppressed_by_guard` are the record, and
    // a reading of this tree that produced neither a candidate nor a removal is still not a finding
    // that the tree is in order.
    const removals: string[] = [];
    if (census.gated.length > 0) {
      removals.push(
        `${census.gated.length} rule(s) DID match their own patterns here and were then silenced by a ` +
          `corroboration gate (${census.gated.map((r) => `${r.rule_id} (${r.matches_removed_by_corroboration})`).join(", ")}) ` +
          `— listed under suppressed_by_corroboration`,
      );
    }
    if (guardSuppressed > 0) {
      removals.push(`${guardSuppressed} match(es) were removed by a guard — listed under suppressed_by_guard`);
    }
    lines.push(
      `0 candidate(s) were raised in this tree.` +
        (removals.length > 0
          ? ` That is not the same as nothing matching: ${removals.join("; and ")}. The construct is in this tree.`
          : "") +
        ` This is not a report that the project meets any standard, and it must not be read or repeated as ` +
        `one: read the UNKNOWN block above.`,
    );
    return lines.join("\n");
  }
  // WHAT THIS HEADLINE COUNTS, and why it is not `f.candidates.length`.
  //
  // A group the engine split is ONE question emitted as several records. Counting the records makes
  // the first number a user reads move for a reason that has nothing to do with their code: the same
  // unchanged tree that reported 68 candidates reports 77 the day the bound ships, and the honest
  // reading of that line is "this repository has nine more problems than it had yesterday". So the
  // headline counts QUESTIONS — a group once, however many parts it was emitted as — and the record
  // count is named beside it rather than dropped, because the rows printed below are records and a
  // reader who counts them must be able to reconcile the two numbers.
  const groupIds = new Set(f.candidates.map((c) => c.group_part?.group_id ?? c.finding_id));
  const splitGroups = new Set(
    f.candidates.filter((c) => c.group_part).map((c) => c.group_part?.group_id),
  );
  lines.push(
    `${groupIds.size} candidate(s), pre-adjudication — not a determination that a violation occurred` +
      (splitGroups.size > 0
        ? `. ${splitGroups.size} of them carried more locations than one agent is asked to read and are ` +
          `listed below as ${f.candidates.length} record(s); the parts of one group are one candidate`
        : "") +
      `:`,
  );
  // GROUPED BY TOPIC AND CAPPED AT TEN PER TOPIC. The
  // rows themselves are unchanged, byte for byte, and still start at column 0; what is new is the
  // heading above each topic and the line under a capped one saying how many records were left out
  // and that the document holds them. Ghost printed 820 unbroken rows here and prints at most 260
  // now. THE DOCUMENT IS UNAFFECTED — `candidates` carries every record, uncapped, which is why a
  // cap here is a display decision and not a reporting one (the same convention
  // NOT_READ_DISPLAY_LIMIT already states above). The grouping, the order and the cap live in
  // `report.ts`, with the rest of this feature's wording, so a change to any of them is one edit.
  for (const line of candidateListLines(candidateTopics(f, rules), (id) => ruleById.get(id)?.title ?? "")) {
    lines.push(line);
  }
  lines.push("");
  // In the reader's words, not the plugin's field names.
  lines.push("Next: each candidate needs a review in context, which the plugin's AI review does, before any conclusion is drawn.");
  return lines.join("\n");
}

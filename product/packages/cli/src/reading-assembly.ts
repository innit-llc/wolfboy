/**
 * What `verdict-reading` reads from a verdicts directory and writes into `--assemble-into`, as two
 * functions (relay rework item 5, third author, 2026-09-24).
 *
 * The code below was the body of the `verdict-reading` action in `index.ts`. It was MOVED here, not
 * copied, so that `assemble-report` can derive the assembled copy of a verdicts directory itself and
 * compare it with the copy on disk, instead of trusting a derived file it did not produce.
 * The action calls these functions and still does
 * every print, every refusal and every write; one copy, two callers.
 *
 * EVERY FILE HERE IS READ THROUGH THE ONE READER OF PROGRAM-WRITTEN FILES (program-file.ts).
 * The records under `verdicts/` and `readers/` are written by the capture, each as a
 * new regular file with one name. What else stands there - a named pipe, a link, a device, a file with a second name -
 * is not a record the capture wrote: it is never opened for reading, so no command waits on it, and it is listed in
 * `refused` with its kind and path. A plain `readFileSync` here hung `verdict-reading` and `assemble-report` on a named
 * pipe with no output.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { relativePath } from "./project-path.js";
import { createHash } from "node:crypto";
import { readRegularFile } from "./project-read.js";
import { findingsChangedProblem } from "./log-digest.js";
import { keptPlacesNamed } from "./state-record.js";
import { sawAt, type SeatPayload, type SeatSight } from "./seat-opened.js";
import { isPlacePlanCandidate, lineStandsAsBeyond, placePayloadOf, PLACES_KEPT_DIR, programLineStands, readingOfPlaceDecisions, type PlaceCapture } from "./place-reply.js";
import { loadDeclarationSource } from "./declaration.js";
import { outcomeWeightOf, type OutcomeWeight } from "./finding-weight.js";
import { documentationPagesOf, premisesOfFindings } from "./second-look.js";
import { checkStanding, locationOverturnRefused, SHIPS_PREMISES, STANDING_OPENS_VERDICT, standingRefusal, type ShipsPremise, type StandingSetAside } from "./standing.js";
import { isPlaceId, isUnitId, placeIndexOf, placeOfUnit, unitOfPlace } from "./ref-ids.js";
import { isKeptPlace, KEPT_DECISIONS } from "./place-bar.js";
import { answerOfPlaces, isAnswerSeatCandidate, notApplicableBar, type AnswerCapture } from "./place-answer.js";
import type { AnswerSeatWork } from "./answer-premises.js";
import { placeTableOf } from "./place-fold.js";
import type { PlaceRowIn } from "./severity-at-place.js";
import type { Candidate, Rule } from "wolfboy-schemas";
import { loadBundle } from "./bundle.js";
import {
  assembleReadingForVerdicts,
  kindCensusOf,
  parseReaderReply,
  recordCoverageGaps,
  seatRowsOfVerdict,
  unattributedRecordProblem,
  type AssembledVerdictReading,
  type ReaderReply,
  type ReadingReadRow,
  handedUnitIds,
  readingOfDecisions,
  renderDecisionProblems,
  readingUnitsCensusOf,
  evidenceOfIds,
  inferredEvidenceRoles,
  inertDismissals,
  readingClassOf,
  refutationReadingOf,
} from "./reading.js";
import { programFileBytes, readProgramFile } from "./program-file.js";
import { answersFromApplicability, buildRestsOn, handedPremiseOf, shipsFactsOf, TreeReader, type RestsOn, type SeatSightStamp } from "./rests-on.js";
import { instructionsPremise, type InstructionsPremise, instructionsPremiseOfRecord } from "./instructions.js";
import { readingSpecDigest, seatPremisesOf, seatUntakenOf } from "./place-premises.js";
import { VERDICT_SET_FIELD, filesQuotedByNestedRecords, verdictSetKindOfRefuterRecord } from "./verdict-set.js";

/** What the action read: the seats' rows, the readers' replies, and the files it could not use. */
export interface VerdictsForReading {
  seats: Parameters<typeof assembleReadingForVerdicts>[0]["seats"];
  replies: ReaderReply[];
  unreadable: { path: string; problem: string }[];
  unreadableVerdicts: string[];
  unattributed: { path: string; index: number; problem: string }[];
  /** Kept for `--assemble-into`: the verdict documents as they were parsed. */
  verdictDocs: { rel: string; parsed: unknown }[];
  /** Kept for `--assemble-into`: the refutation and silence files, read once here and copied through untouched. */
  passthrough: { rel: string; bytes: Buffer }[];
  /**
   * What is not a regular file with one name (a named pipe, a symbolic link, a device, a socket, a hard link), with the
   * one reader's refusal naming its kind: not a record the capture wrote, never opened. A caller refuses the run on it.
   */
  refused: { path: string; problem: string }[];
}

/** Which candidate a quoted line belongs to, for a reply that names no finding_id (see `readVerdictsForReading`). */
function ownerOfLineFor(candidates: Candidate[]): (file: string, line: number) => string | null {
  const ownerOfLine = new Map<string, string | null>();
  for (const c of candidates) {
    if (!kindCensusOf(c)) continue;
    for (const loc of c.locations) {
      const at = `${loc.file}:${loc.start_line}`;
      ownerOfLine.set(at, ownerOfLine.has(at) && ownerOfLine.get(at) !== c.finding_id ? null : c.finding_id);
    }
  }
  return (file, line) => ownerOfLine.get(`${file}:${line}`) ?? null;
}

/**
 * One file the capture wrote, through the one reader (program-file.ts `readProgramFile`): its parsed JSON; or the one
 * reader's refusal for what is not a regular file with one name (never opened, so never waited on); or why a regular
 * file could not be read or parsed.
 */
function readRecordJson(full: string): { parsed: unknown } | { refused: string } | { unreadable: string } {
  const got = readProgramFile("the record file", full);
  if (!got.ok) return got.exit === "refused" ? { refused: got.problem } : { unreadable: `could not be read: ${got.problem}` };
  try {
    return { parsed: JSON.parse(got.value.toString("utf8")) };
  } catch (e) {
    return { unreadable: `could not be read as JSON: ${(e as Error).message}` };
  }
}

/**
 * Unit U1: where the capture keeps, under the project's `.legal/`, the place rows of a seat whose verdict
 * did not hold - every row that passed the place checks, one file per candidate and seat, in the readers' form with
 * `kept_from` naming the seat - and the hook ledger's line for that seat names each file with its sha256.
 */
export { PLACES_KEPT_DIR };

/**
 * The kept place rows beside a readers directory (`<legal>/readers` -> `<legal>/capture/places-kept`), read as the
 * readers' replies are, named `capture/places-kept/<file>`. They are read as read places wherever the readers' replies
 * are: by the capture (a make-up seat's C1 and A4), by step 5a's first command and by the assembly.
 */
function keptPlaceRepliesInto(readersDir: string, owner: (file: string, line: number) => string | null, out: Pick<VerdictsForReading, "replies" | "unreadable" | "refused">): void {
  const dir = join(dirname(resolve(readersDir)), PLACES_KEPT_DIR);
  if (!existsSync(dir)) return;
  // Only a file the hook's own line in the state folder names, with these
  // bytes' sha256, is read as places; any other is read by no one here, and the assembly refuses it by name
  // (assemble-hooked.ts, unit U1).
  const named = keptPlacesNamed(dirname(resolve(readersDir)));
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".json")) continue;
    const rel = `${PLACES_KEPT_DIR}/${name}`;
    if (!keptFileNamed(named, rel, join(dir, name))) continue;
    const got = readRecordJson(join(dir, name));
    if ("refused" in got) out.refused.push({ path: rel, problem: got.refused });
    else if ("unreadable" in got) out.unreadable.push({ path: rel, problem: got.unreadable });
    else {
      const { reply, problem } = parseReaderReply(rel, got.parsed, owner);
      if (reply && reply.kept_from) out.replies.push(reply);
      else out.unreadable.push({ path: rel, problem: reply ? "names no seat it was kept from (`kept_from`)" : problem });
    }
  }
}

/** Whether the kept file at `abs` is named `rel` in `named` with its bytes' sha256 (state-record.ts `keptPlacesNamed`). */
export function keptFileNamed(named: ReadonlyMap<string, string>, rel: string, abs: string): boolean {
  const want = named.get(rel);
  if (want === undefined) return false;
  try {
    return createHash("sha256").update(readRegularFile(abs)).digest("hex") === want;
  } catch {
    return false;
  }
}

/** The readers' replies under one directory, walked from `root` and named `readers/<path below root>`. */
function walkReaderReplies(
  dir: string,
  root: string,
  owner: (file: string, line: number) => string | null,
  out: Pick<VerdictsForReading, "replies" | "unreadable" | "refused">,
): void {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walkReaderReplies(full, root, owner, out);
      continue;
    }
    if (!name.endsWith(".json")) continue;
    const rel = `readers/${relativePath(root, full)}`;
    const got = readRecordJson(full);
    if ("refused" in got) {
      out.refused.push({ path: rel, problem: got.refused });
      continue;
    }
    if ("unreadable" in got) {
      out.unreadable.push({ path: rel, problem: got.unreadable });
      continue;
    }
    const { reply, problem } = parseReaderReply(rel, got.parsed, owner);
    if (reply) out.replies.push(reply);
    else out.unreadable.push({ path: rel, problem });
  }
}

/**
 * The readers' replies in a readers directory outside the verdicts directory (`.legal/readers`), read exactly as
 * `readVerdictsForReading` reads them: the capture reads them with this for a verdict seat after readers,
 * so that the reading block it checks the answer against is the one step 5a assembles.
 */
export function readReaderReplies(readersDir: string, candidates: Candidate[]): Pick<VerdictsForReading, "replies" | "unreadable" | "refused"> {
  const out: Pick<VerdictsForReading, "replies" | "unreadable" | "refused"> = { replies: [], unreadable: [], refused: [] };
  const owner = ownerOfLineFor(candidates);
  if (existsSync(readersDir)) walkReaderReplies(readersDir, readersDir, owner, out);
  keptPlaceRepliesInto(readersDir, owner, out);
  return out;
}

/** Read a verdicts directory, and a readers directory outside it when one is given, as `verdict-reading` does. */
export function readVerdictsForReading(verdictsDir: string, candidates: Candidate[], readersDir?: string): VerdictsForReading {
  // Which candidate a quoted line belongs to, for a reply that names no finding_id. It is the LINE
  // and not the unit id: an id is a position in one candidate's own census, so "3" is a unit of
  // every candidate that has four, and resolving by it would attach a reply to the wrong question.
  // A line that two candidates both match is ambiguous and the reply is refused rather than split.
  const owner = ownerOfLineFor(candidates);

  const seats: Parameters<typeof assembleReadingForVerdicts>[0]["seats"] = [];
  const replies: ReaderReply[] = [];
  const unreadable: { path: string; problem: string }[] = [];
  const unreadableVerdicts: string[] = [];
  // Entries of a verdict file that name no candidate (fix-verify-shape R1): `index` is the entry's
  // position in its file, 0 for a file that holds one object.
  const unattributed: { path: string; index: number; problem: string }[] = [];
  // Kept only for `--assemble-into`: the verdict documents as they were parsed, and the files
  // that are copied through untouched (a refutation carries its own reading block and is
  // deliberately not coverage-checked, design section 9).
  const verdictDocs: { rel: string; parsed: unknown }[] = [];
  const passthrough: { rel: string; bytes: Buffer }[] = [];
  const refused: { path: string; problem: string }[] = [];
  const walk = (dir: string, underReaders: boolean) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full, underReaders || name === "readers");
        continue;
      }
      if (!name.endsWith(".json")) continue;
      const rel = relativePath(verdictsDir, full);
      // The refuter's and the silence investigator's files are not assembled here: a refutation carries
      // its own reading block and is deliberately NOT coverage-checked (design section 9), and a
      // silence record is about a rule that raised no candidate at all. They are read here, once, through the one
      // reader, and copied from these bytes: a copy made by a second read of the path could not be the file this walk
      // looked at. One that cannot be read makes the run incomplete, as a verdict file does: it is never copied.
      if (!underReaders && (rel.includes("refutation/") || rel.includes("silence/"))) {
        const got = readProgramFile("the record file", full);
        if (got.ok) passthrough.push({ rel, bytes: got.value });
        else if (got.exit === "refused") refused.push({ path: rel, problem: got.problem });
        else {
          unreadable.push({ path: rel, problem: `could not be read: ${got.problem}` });
          unreadableVerdicts.push(rel);
        }
        continue;
      }
      const got = readRecordJson(full);
      if ("refused" in got) {
        refused.push({ path: rel, problem: got.refused });
        continue;
      }
      if ("unreadable" in got) {
        unreadable.push({ path: rel, problem: got.unreadable });
        // A VERDICT FILE THAT CANNOT BE READ MAKES THE RUN INCOMPLETE: its
        // records are not assembled, so the quote check over the assembly never sees them.
        if (!underReaders) unreadableVerdicts.push(rel);
        continue;
      }
      const parsed = got.parsed;
      if (underReaders) {
        const { reply, problem } = parseReaderReply(rel, parsed, owner);
        if (reply) replies.push(reply);
        else unreadable.push({ path: rel, problem });
        continue;
      }
      verdictDocs.push({ rel, parsed });
      (Array.isArray(parsed) ? parsed : [parsed]).forEach((record, index) => {
        // AN ENTRY THAT NAMES NO CANDIDATE IS NOT SKIPPED IN SILENCE (fix-verify-shape R1,
        // 2026-09-24). Until then an entry with no `finding_id` - or one that was not an object at
        // all - was passed over with `continue`: its reading was never assembled, it was copied
        // through unchanged, nothing was printed and the command exited 0 as if the run were whole.
        // It is now listed, printed and refused with exit 5, the code an incomplete run takes.
        const problem = unattributedRecordProblem(record);
        if (problem) {
          unattributed.push({ path: rel, index, problem });
          return;
        }
        const id = (record as { finding_id: string }).finding_id;
        const { rows, searched, declined } = seatRowsOfVerdict(record);
        seats.push({ finding_id: id, rows, searched, declined });
      });
    }
  };
  // The readers' replies live outside the gated directory (.legal/readers), so they are walked
  // from their own root: the quote check reads a disposition array as an unevidenced verdict, and
  // keeping them beside the verdicts is what invalidated 104 records in one run on 2026-09-21.
  walk(verdictsDir, false);
  if (readersDir) {
    walkReaderReplies(readersDir, readersDir, owner, { replies, unreadable, refused });
    keptPlaceRepliesInto(readersDir, owner, { replies, unreadable, refused });
  }
  return { seats, replies, unreadable, unreadableVerdicts, unattributed, verdictDocs, passthrough, refused };
}

/**
 * EVERY RULE STEP 5a APPLIES TO ONE SEAT'S ANSWER, APPLIED AT CAPTURE ("a rule
 * the assembly applies to one seat's answer is applied where the seat can still answer again"; the budget rule was its
 * first instance). Each rule is the function step 5a runs, over the record step 5a writes, from the same inputs (the
 * candidate from the scan's findings document, the readers' replies on disk read by `readReaderReplies`), so the seat is
 * refused in the rule's own words while it has refusals left:
 *
 * - `verdict`, for each verdict of an ADJUDICATOR answer (every adjudicator entry, with readers before it or none): the
 *   reading block `assembleReadingForVerdicts` assembles from it; step 5a's first command refuses a row of the seat's
 *   that names no reading unit or repeats a row for the same unit and sub-shape and a unit
 *   nobody accounted for (`refused`, `unaccounted`, in that function's words), and
 *   where there is neither, its second command runs `recordCoverageGaps` over the record as the first writes it. The
 *   premise block is the assembly step's to write and never a seat's (a reply that carries one is refused by its schema),
 *   so its two rules are not asked here: `rests-on-missing` and `rests-on-incomplete` are step 5a's own.
 * - `reader`, for a READER answer: the reply attributed to its candidate as step 5a attributes it (`parseReaderReply`),
 *   the rows step 5a's first command refuses in it (the same function over the reply alone), then the same
 *   coverage check over the block assembled with it and the replies already on disk, kept to the gaps that
 *   name a kind this reader was handed. A gap of another unit is another seat's (another reader's, or the verdict seat's
 *   still to come); a row naming a kind it was not handed, or a handed kind with no row, the capture's id check refuses.
 *
 * Where the findings document cannot be read here, the rules are left to step 5a, which names it (a stated limit).
 *
 * `sight`: what the seat's own transcript shows it opened (seat-opened.ts `seatSightOf`). Where it is given
 * (the hook always gives it), each of the three conversions applies the one rule of `readingOfDecisions`: a row the seat
 * did not open is recorded as not opened, never as read. Its relative paths resolve against the scan's own root
 * (the findings document's `target`; the folder above `.legal` where that is not absolute).
 */
export function answerRulesAtCapture(
  findingsPath: string,
  readersDir: string,
  sight?: SeatSight,
  /** Build unit F3: the payload the seat was handed, against which a place seat's rows are checked (C1-C9). */
  payload?: SeatPayload,
  /** Build unit F4: the fold the answer seat's entry names (A5), absolute. */
  foldPath?: string,
  /** Build unit F5 M3: the carried rows of the readers the run did not launch (carried-places.ts), read beside those on disk. */
  carried?: () => ReaderReply[],
  /**
   * What the seat ran under, taken by the hook when the seat ends - the effort levels its own transcript records
   * (C3) and the instructions digested then (C5). Absent (a hand capture), nothing is written and a later run carries none
   * of this seat's verdicts.
   */
  basis?: SeatBasis,
): {
  verdict: (verdict: Record<string, unknown>) => string[];
  reader: (reply: unknown, kinds: string[]) => string[];
  convertVerdicts: (reply: unknown) => DecisionsConversion;
  convertReader: (reply: unknown, who: { finding_id: string; reader: number }) => DecisionsConversion;
  convertRefutations: (reply: unknown) => DecisionsConversion;
  /**
   * One record entry of an adjudicator's answer, weighed as the
   * program would report its finding (finding-weight.ts `outcomeWeightOf`), from this document's candidate and premises;
   * null where the document holds no such candidate. The capture's guard on a resend (verdict-capture.ts `weigh`).
   */
  weigh: (entry: Record<string, unknown>) => OutcomeWeight | null;
} {
  let loaded: { candidates: Candidate[]; replies: ReaderReply[]; root: string; bundleVersion: string; shipsPremises: unknown } | null | undefined;
  const load = (): { candidates: Candidate[]; replies: ReaderReply[]; root: string; bundleVersion: string; shipsPremises: unknown } | null => {
    if (loaded !== undefined) return loaded;
    try {
      const bytes = programFileBytes("the findings document", findingsPath);
      // A document changed after the scan is read as one that cannot be read (log-digest.ts).
      if (findingsChangedProblem(findingsPath, bytes) !== null) throw new Error("changed after the scan");
      const findings = JSON.parse(bytes.toString("utf8")) as { candidates?: Candidate[]; target?: unknown; bundle?: { version?: unknown }; ships_premises?: unknown };
      const candidates = Array.isArray(findings.candidates) ? findings.candidates : [];
      const projectDir = dirname(dirname(resolve(findingsPath)));
      const root = typeof findings.target === "string" && isAbsolute(findings.target) ? findings.target : resolve(projectDir, typeof findings.target === "string" ? findings.target : ".");
      const bundleVersion = typeof findings.bundle?.version === "string" ? findings.bundle.version : "";
      loaded = { candidates, replies: [...readReaderReplies(readersDir, candidates).replies, ...(carried?.() ?? [])], root, bundleVersion, shipsPremises: findings.ships_premises };
    } catch {
      loaded = null;
    }
    return loaded;
  };
  /** The one rule's predicate, where the capture was given what the seat saw; else none (every row is read). */
  const opened = (): ((file: string, lines: string) => boolean) | undefined => {
    const root = load()?.root;
    return sight && root !== undefined ? (file, lines) => sawAt(sight, root, file, lines) : undefined;
  };
  /** Build unit F3: what a place seat's rows are checked against; null where the capture was given no payload. */
  let placeCap: PlaceCapture | null | undefined;
  const placeCapture = (): PlaceCapture | null => {
    if (placeCap !== undefined) return placeCap;
    const root = load()?.root;
    // Build unit F5: every accepted place row carries its premises (design section 4), taken here once per answer. The effort as the hook took it - null where the seat's transcript could not be read (a reason on each
    // row, `seatUntakenOf`), absent where no hook took it (a hand capture: the row records none).
    const premises = { readingSpec: readingSpecDigest({}), model: payload?.model ?? null, ...(basis ? { effort: basis.effort } : {}) };
    // Unit U1: the rows a seat before this one read, kept apart from its verdict, are read places for this one.
    const kept = (findingId: string) => (load()?.replies ?? []).filter((r) => r.kept_from && r.finding_id === findingId).flatMap((r) => r.rows);
    placeCap = payload && root !== undefined ? { payload: placePayloadOf(payload, shipsFactsOf(load()?.shipsPremises)), sight, root, premises, kept } : null;
    return placeCap;
  };
  /** Build unit F4: what an answer seat's answer is checked against (A1-A6): the per-place table from the readers' records. */
  // One slot of tree-wide work for every answer-seat candidate of this answer (answer-premises.ts).
  const answerWork: AnswerSeatWork = {};
  const answerCapture = (candidate: Candidate): AnswerCapture | null => {
    const inputs = load();
    if (!inputs) return null;
    return { table: placeTableOf(candidate, inputs.replies), foldPath: foldPath ?? null, sight, root: inputs.root, model: payload?.model ?? null, work: answerWork };
  };
  const gapText = (g: { check: string; kind?: string; problem: string }): string => `${g.check}${g.kind ? ` (kind ${g.kind})` : ""}: ${g.problem}`;
  const verdict = (v: Record<string, unknown>): string[] => {
    const id = typeof v.finding_id === "string" ? v.finding_id : "";
    const inputs = load();
    const candidate = inputs?.candidates.find((c) => c.finding_id === id);
    if (!inputs || !candidate) return [];
    // The record as step 5a's first command writes it: the seat's fields, with the reading block it assembles. A
    // candidate with no census has no block to assemble, and the record is checked as the seat wrote it.
    let record: Record<string, unknown> = v;
    if (kindCensusOf(candidate)) {
      const [assembled] = assembleReadingForVerdicts({ candidates: [candidate], seats: [{ finding_id: id, ...seatRowsOfVerdict(v) }], replies: inputs.replies });
      if (!assembled) return [];
      const first = [
        ...assembled.refused.filter((r) => r.where !== "a reader's reply").map((r) => `reading: ${r.where} writes the kind ${JSON.stringify(r.kind)}, which ${r.problem}`),
        ...assembled.unaccounted.map((u) => `reading: the unit ${JSON.stringify(u.kind)} (${u.members} matched location(s)): ${u.because}`),
      ];
      if (first.length > 0) return first;
      record = { ...v, reading: assembled.reading };
    }
    return (recordCoverageGaps(candidate, record, false) ?? []).map(gapText);
  };
  const reader = (reply: unknown, kinds: string[]): string[] => {
    const inputs = load();
    if (!inputs) return [];
    const parsed = parseReaderReply("your reply", reply, ownerOfLineFor(inputs.candidates));
    // The rule's words are step 5a's, written for the orchestrator; the lead says what the seat can do about them.
    if (!parsed.reply) return [`your reply cannot be attached to the candidate whose kinds you were handed: write each row's \`file\` and \`lines\` as the location was handed to you (step 5a: the reply ${parsed.problem})`];
    const own = parsed.reply;
    const candidate = inputs.candidates.find((c) => c.finding_id === own.finding_id);
    if (!candidate || !kindCensusOf(candidate)) return [];
    // The rows step 5a's first command refuses in this reply (a second row for a unit and sub-shape),
    // by the same function over this reply alone: a file already on disk is not this seat's to
    // answer for, and a row of it is never what makes this reply a duplicate.
    const [alone] = assembleReadingForVerdicts({ candidates: [candidate], seats: [], replies: [own] });
    const refusedRows = (alone?.refused ?? []).map((r) => `reading: your reply writes the kind ${JSON.stringify(r.kind)}, which ${r.problem}`);
    if (refusedRows.length > 0) return refusedRows;
    const [assembled] = assembleReadingForVerdicts({ candidates: [candidate], seats: [], replies: [...inputs.replies, own] });
    if (!assembled) return [];
    const held = new Set(kinds);
    return (recordCoverageGaps(candidate, { reading: assembled.reading }, false) ?? []).filter((g) => g.kind !== undefined && held.has(g.kind)).map(gapText);
  };
  const convertVerdicts = (reply: unknown): DecisionsConversion => {
    const inputs = load();
    const candidateOf = (id: string): Candidate | null => inputs?.candidates.find((c) => c.finding_id === id) ?? null;
    const root = inputs?.root;
    // The seat's own sight, as premises, for a verdict not read place by place; taken once per answer.
    const sightStamp = (): SeatSightStamp | undefined => {
      if (!sight || root === undefined) return undefined;
      const taken = seatPremisesOf(sight, new TreeReader(root), [payload?.readPath, payload?.payloadPath].filter((p): p is string => typeof p === "string"));
      return { files: taken.files.map((f) => f.path), searches: taken.searches, ...(taken.incomplete.length > 0 ? { incomplete: taken.incomplete } : {}) };
    };
    /* What the seat's own transcript could not give when it ended - its sight, its effort - written on every
     * verdict it gave (`seat_untaken`), so that the verdict is never carried, by that reason; the current run is not
     * refused for it (the block stays complete). */
    const untaken = basis ? seatUntakenOf({ sight, effort: basis.effort }) : [];
    // The scan's ships premises, where its findings document holds them.
    const premiseOf = inputs ? shipsPremiseOf(inputs.shipsPremises, inputs.root) : undefined;
    return withSeatBasis(verdictsFromDecisions(reply, candidateOf, opened(), placeCapture, answerCapture, premiseOf), candidateOf, {
      model: payload?.model,
      ...(basis ? { effort: basis.effort, instructions: basis.instructions, sight: sightStamp, untaken } : {}),
    });
  };
  const convertReader = (reply: unknown, who: { finding_id: string; reader: number }): DecisionsConversion => {
    const candidate = load()?.candidates.find((c) => c.finding_id === who.finding_id) ?? null;
    // Build unit F3: a place seat of a place-plan candidate answers one row per place (design 1.5), checked C1-C9.
    if (candidate && isPlacePlanCandidate(candidate)) {
      const out = readingOfPlaceDecisions({ candidate, decisions: reply, capture: placeCapture() });
      if (out.unconvertible) return { record: null, problems: [], unconvertible: out.unconvertible };
      return { record: { finding_id: who.finding_id, reader: who.reader, dispositions: out.read }, form: 2, problems: out.problems.map((text) => ({ item: null, text })), ...(out.removed ? { removedRows: { "": out.removed } } : {}) };
    }
    const handed = candidate ? handedUnitIds(candidate, { reader: who.reader }) : null;
    if (!candidate || !handed || !readingUnitsCensusOf(candidate)) {
      return { record: null, problems: [], unconvertible: `the findings document holds no candidate ${JSON.stringify(who.finding_id)} with a reader ${who.reader} in its reading plan, so this reader's decisions cannot be turned into its record` };
    }
    const out = readingOfDecisions({ candidate, handed, decisions: reply, who: "reader", opened: opened() });
    return {
      record: { finding_id: who.finding_id, reader: who.reader, dispositions: out.read, ...(out.unopened.length > 0 ? { unopened: out.unopened } : {}) },
      form: 2,
      problems: renderDecisionProblems(out.problems).map((text) => ({ item: null, text })),
      ...(out.removed ? { removedRows: { "": out.removed } } : {}),
    };
  };
  const convertRefutations = (reply: unknown): DecisionsConversion => {
    const inputs = load();
    return refutationsFromDecisions(reply, (id) => inputs?.candidates.find((c) => c.finding_id === id) ?? null, opened());
  };
  // A candidate read place by place is weighed at the kept places its report
  // reads: the place table made from the readers' records and this answer's own rows, as the assembly makes it
  // (assemble-report.ts `placeTablesOf`); before, every candidate was weighed at its locations.
  const rowsOf = (candidate: Candidate, entry: Record<string, unknown>): readonly PlaceRowIn[] =>
    isPlacePlanCandidate(candidate) ? (placeTableOf(candidate, load()?.replies ?? [], seatRowsOfVerdict(entry).rows) as unknown as readonly PlaceRowIn[]) : [];
  const weigh = (entry: Record<string, unknown>): OutcomeWeight | null => {
    const inputs = load();
    const candidate = inputs?.candidates.find((c) => c.finding_id === entry.finding_id);
    if (!inputs || !candidate) return null;
    const doc = { ships_premises: inputs.shipsPremises };
    const premises = premisesOfFindings(doc);
    const documentationPages = documentationPagesOf(doc);
    const rows = rowsOf(candidate, entry);
    return outcomeWeightOf(entry, candidate as unknown as Record<string, unknown>, { ...(premises ? { premises } : {}), ...(documentationPages ? { documentationPages } : {}) }, rows);
  };
  return { verdict, reader, convertVerdicts, convertReader, convertRefutations, weigh };
}

/**
 * THE MODEL A WHOLE VERDICT'S SEAT RAN ON, WRITTEN ON ITS RECORD. A verdict not read place by
 * place rests on the model its seat was launched on as a place rests on its own (`place-premises.ts` premise `model`),
 * and nothing else records it: the launch entry names it, the capture is handed it (`SeatPayload.model`), and the record
 * is the only thing a later run reads. So every entry of such a candidate gets `seat_model`, and the record becomes the
 * program's (form 2; the answer is kept whole beside it, as for decisions). The assembly moves it into `rests_on.model`.
 * A place-plan candidate's places and answer seat record theirs in their own premises. Where the capture has no model (no
 * launch entry, a hand capture), nothing is written, and a later run gives the verdict again rather than guess one.
 */
export function withSeatModel(conversion: DecisionsConversion, candidateOf: (id: string) => Candidate | null, model: string | undefined): DecisionsConversion {
  return withSeatBasis(conversion, candidateOf, { model });
}

/** What the hook takes when a seat ends, for its records (`answerRulesAtCapture`'s last argument). */
export interface SeatBasis {
  /**
   * The effort levels the seat's own transcript records (`seat-effort.ts` `transcriptEffort`); null where it cannot be
   * read, which is recorded as a reason (`seatUntakenOf`), never as an empty effort.
   */
  effort: string[] | null;
  /** The instructions digested when the seat ended (`instructions.ts` `instructionsPremise`); absent where they could not be. */
  instructions?: InstructionsPremise;
}

/**
 * WHAT A SEAT RAN UNDER, WRITTEN ON EVERY RECORD IT GAVE, by the program and never by the seat (the reply schema
 * has none of these fields), so that the record - the only thing a later run reads - says it:
 *   - `seat_instructions` (C5) and `seat_effort` (C3) on every verdict: the instructions digested when the seat ended,
 *     not when the run is assembled (a run resumed after a plugin update recorded the newer instructions for verdicts
 *     judged under the older), and the levels its transcript records;
 *   - `seat_model` and `seat_sight` (C2) on a verdict not read place by place: the launch entry's model, and
 *     what the seat's own transcript shows it opened and searched - such a seat may not record `searched[]`;
 *   - `seat_untaken` on every verdict, where the seat's own transcript could not give its sight or its
 *     effort (`place-premises.ts` `seatUntakenOf`): the assembly records it as `rests_on.untaken`, and a later run never
 *     carries the verdict, by that reason. It is not a coverage gap: the block stays complete.
 * A place-plan candidate's places record the model, the effort and the reading spec (which digests the instructions) on
 * their own rows at capture. The record becomes the program's (form 2; the answer is kept whole beside it).
 */
export function withSeatBasis(
  conversion: DecisionsConversion,
  candidateOf: (id: string) => Candidate | null,
  basis: { model?: string; effort?: string[] | null; instructions?: InstructionsPremise; sight?: () => SeatSightStamp | undefined; untaken?: string[] },
): DecisionsConversion {
  if (conversion.unconvertible || !Array.isArray(conversion.record)) return conversion;
  const model = typeof basis.model === "string" && basis.model ? basis.model : undefined;
  const effort = Array.isArray(basis.effort) && basis.effort.length > 0 ? basis.effort : undefined;
  let sight: SeatSightStamp | undefined | null = null;
  let stamped = 0;
  const record = conversion.record.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const id = (entry as { finding_id?: unknown }).finding_id;
    const candidate = typeof id === "string" ? candidateOf(id) : null;
    if (!candidate) return entry;
    const place = isPlacePlanCandidate(candidate);
    if (sight === null && !place) sight = basis.sight?.();
    const add: Record<string, unknown> = {
      ...(basis.instructions ? { seat_instructions: basis.instructions } : {}),
      ...(effort ? { seat_effort: effort } : {}),
      ...(!place && model ? { seat_model: model } : {}),
      ...(!place && sight ? { seat_sight: sight } : {}),
      ...(basis.untaken && basis.untaken.length > 0 ? { seat_untaken: basis.untaken } : {}),
    };
    if (Object.keys(add).length === 0) return entry;
    stamped += 1;
    const { seat_model: _m, seat_effort: _e, seat_instructions: _i, seat_sight: _s, seat_untaken: _u, ...own } = entry as Record<string, unknown>;
    return { ...own, ...add };
  });
  return stamped > 0 ? { ...conversion, record, form: 2 } : conversion;
}

/**
 * WHAT THE CAPTURE WRITES FROM A SEAT'S DECISIONS: the record in today's format, the
 * problems that refuse the answer (grouped by class, naming ids), or why no record can be made at all. The record is
 * the program's: the seat's own fields as it wrote them, with `decisions` and `searched` turned into the `reading` block
 * a seat wrote before (its `read`, `searched` and `declined` lists). The answer itself is kept, whole, beside it.
 */
export interface DecisionsConversion {
  record: unknown;
  /** 2 where any decisions were turned into a record (the record is then the program's, not the answer's slice). */
  form?: 2;
  /**
   * `field`: what the problem names for an amendment (amend.ts), where it is not `decisions`. An answer seat's A1-A6
   * problems name its answer whole (`*`, build unit F4): its verdict, evidence and reasoning are one answer over the fold,
   * so a fix of one may need any other (A4's is the verdict), and the merged whole is checked A1-A6 again.
   * `opens` (M1): the fields beside
   * `field` the problem also names, where correcting it may change them (a `standing` part refused for its verdict or for
   * a quotation that does not resolve: standing.ts `STANDING_OPENS_VERDICT`, `STANDING_OPENS_QUOTATION`).
   * `strays`: the keys the problem refuses for
   * where they are, as paths in the entry (`standing.<key>` for a key inside `standing` that is no part of it), which the
   * refusal takes out of the base a later amendment is laid over (amend.ts `RefusalRemoved.fields`).
   */
  problems: { item: number | null; text: string; field?: string; opens?: readonly string[]; strays?: readonly string[]; names?: readonly string[] }[];
  unconvertible?: string;
  /**
   * Unit U1: per place-plan candidate, the rows that passed every place check (place-reply.ts `passed`),
   * whatever else refuses the answer. The capture keeps them as read where the seat's answer ends without a record.
   */
  placesPassed?: { finding_id: string; rows: ReadingReadRow[] }[];
  /**
   * Fix R1: per entry by its position in the reply ("" for a reader's reply, which is its rows), the positions
   * in its `decisions` of the rows refused for what they are (place-reply.ts and reading.ts `removed`): the seat is told to
   * remove each, so the refusal records them and they are not part of the base a later answer amends (amend.ts).
   */
  removedRows?: Record<string, number[]>;
  /**
   * What the capture took out of the record as inert, never a reason to refuse (reading.ts
   * `inertDismissals`): per entry by its position in the reply, the candidate, the `evidence[]` entry, the fields dropped
   * with the seat's values, and why. The capture ledger carries it beside the record.
   */
  normalised?: { item: number; finding_id: string; evidence: number; fields: Record<string, unknown>; why: string }[];
}

/**
 * A PLACE SEAT'S ITEMS, WRITTEN FROM ITS OWN PLACE ROWS. Where the rule's items are found by
 * reading (not the matched word), a place row decided `is_the_construct` or `construct_but_gated` already names the item
 * the place is (`item`), so an `item` entry that names that place by id (`{role: "item", unit: "P17"}`, with or without a
 * census id beside it) or names the item alone (`{role: "item", name}`) is written by the program: the item's name and
 * the place's file, line and quotation, from the row. fm1's one-seat bins gave 15 such entries over their refused and
 * invalid hand-backs, each refused as a census id on a read-derived rule (item-not-census) and again for the location
 * and name it did not carry. A name given beside the id must be the row's item; a place not kept, or one whose row names
 * no item, is refused naming it. Every other entry is returned as it came, for `evidenceOfIds` and the record's checks.
 */
export function placeItemsOf(
  candidate: Candidate,
  rowById: ReadonlyMap<string, ReadingReadRow>,
  evidence: unknown,
): { evidence: unknown; problems: string[] } {
  const problems: string[] = [];
  if (!Array.isArray(evidence) || readingClassOf(candidate)?.item_source === "token") return { evidence, problems };
  const kept = (r: ReadingReadRow): boolean => (r.disposition === "is_the_construct" || r.disposition === "construct_but_gated");
  const itemOf = (r: ReadingReadRow): string => r.item ?? "";
  const rows = [...new Set(rowById.values())];
  const written = (r: ReadingReadRow): Record<string, unknown> => ({ role: "item", name: itemOf(r), file: r.file, lines: r.lines, quote: r.quote });
  const out = evidence.map((value, i) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const e = value as Record<string, unknown>;
    if (e.role !== "item" || "file" in e || "lines" in e || "quote" in e) return value;
    const label = `evidence ${i + 1}`;
    const name = typeof e.name === "string" ? e.name.trim() : "";
    const unit = typeof e.unit === "string" ? e.unit : "";
    if (unit && (isPlaceId(unit) || isUnitId(unit))) {
      const row = rowById.get(unit) ?? rowById.get(placeOfUnit(unit) ?? unit);
      if (!row) return value;
      const place = row.place ?? unit;
      if (!kept(row)) {
        problems.push(`${label} names the place ${place} as an item, and that place's row is decided ${row.disposition}: an item names a place decided is_the_construct or construct_but_gated`);
        return value;
      }
      if (!itemOf(row)) {
        problems.push(`${label} names the place ${place} as an item, and its row names no item: write the item in that row's \`item\`, or name it by \`name\` with its file, lines and quote`);
        return value;
      }
      if (name && name.toLowerCase() !== itemOf(row).toLowerCase()) {
        problems.push(`${label} names the place ${place} and the item ${JSON.stringify(name)}, and that place's row names the item ${JSON.stringify(itemOf(row))}: give the place alone, or the item's name alone`);
        return value;
      }
      return written(row);
    }
    if (!unit && !("item" in e) && name) {
      const row = rows.find((r) => kept(r) && itemOf(r).toLowerCase() === name.toLowerCase());
      if (!row) {
        problems.push(`${label} names the item ${JSON.stringify(name)}, and no place you (or the seat before you) decided is_the_construct or construct_but_gated names that item: name an item a kept place names, or give the line you found it at by \`file\`, \`lines\` and \`quote\``);
        return value;
      }
      return written(row);
    }
    return value;
  });
  return { evidence: out, problems };
}

/**
 * The places a place seat's `standing` part may rest on: of the
 * rows its answer became (its own, and the rows kept from a seat before it), those of a place id (ref-ids.ts, from `P0`)
 * decided is_the_construct or construct_but_gated (place-bar.ts `KEPT_DECISIONS`, the rule A1 holds an answer seat to).
 * In the build the smoke test ran, this filter read `P[1-9]...` and so never held the first place.
 */
export function keptPlacesOfRows(rowById: ReadonlyMap<string, ReadingReadRow>): Set<string> {
  return new Set([...rowById].filter(([k, r]) => isPlaceId(k) && KEPT_DECISIONS.has(r.disposition ?? "")).map(([k]) => k));
}

/**
 * An adjudicator's answer, entry by entry. **The form is set by the payload, not by the answer's shape** (the parent's
 * amendment to design section 6, 2026-09-30): a candidate that carries a census was handed a skeleton, and its entry is
 * accepted only with `decisions`; a `reading` block is refused naming the new form, on every candidate. A candidate with
 * no census takes neither. `candidateOf` null (no findings document) turns no decisions into a record: `unconvertible`.
 */
export function verdictsFromDecisions(
  reply: unknown,
  candidateOf: ((id: string) => Candidate | null) | null,
  opened?: (file: string, lines: string) => boolean,
  /** Build unit F3: what a place seat's rows are checked against (design 1.7); absent or null, a place-plan candidate's rows are not written. */
  placeCapture?: () => PlaceCapture | null,
  /** Build unit F4: what an answer seat's answer is checked against (A1-A6); absent or null, its answer is not written. */
  answerCapture?: (candidate: Candidate) => AnswerCapture | null,
  /** The scan's ships premise for a file (`shipsPremiseOf`); absent, none. */
  premiseOf?: (file: string) => ShipsPremise | null,
): DecisionsConversion {
  if (!Array.isArray(reply)) return { record: reply, problems: [] };
  const problems: DecisionsConversion["problems"] = [];
  const placesPassed: NonNullable<DecisionsConversion["placesPassed"]> = [];
  const removedRows: NonNullable<DecisionsConversion["removedRows"]> = {};
  /** Per finding, the place ids of the rows that passed the place checks: a `standing` part's `P<n>`. */
  const keptPlaceIds = new Map<string, Set<string>>();
  let unconvertible: string | undefined;
  let form: 2 | undefined;
  const record = reply.map((value, i) => {
    const entry = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    if (!entry) return value;
    const own: string[] = [];
    if ("reading" in entry) own.push(...renderDecisionProblems([{ cls: "reading", id: "" }]));
    const id = typeof entry.finding_id === "string" ? entry.finding_id : "";
    const carries = "decisions" in entry || "searched" in entry;
    if (!candidateOf) {
      if (carries) unconvertible = "this answer carries `decisions`, which the capture turns into the record from the scan's findings document: pass --findings (the hook always has it)";
      problems.push(...own.map((text) => ({ item: i, text })));
      return entry;
    }
    const candidate = id ? candidateOf(id) : null;
    // Build unit F4: the answer seat after a place-plan candidate's place seats decides no place and answers once (A1-A6).
    if (candidate && isAnswerSeatCandidate(candidate)) {
      const cap = answerCapture?.(candidate) ?? null;
      if (!cap) {
        unconvertible = "this answer is an answer seat's, checked against the per-place table and the fold (A1-A6), which only the capture hook has: it is not written by hand";
        return entry;
      }
      const out = answerOfPlaces({ candidate, entry, capture: cap });
      // The rows this answer may rest a `standing` part on are the
      // table's kept places, the ones A1 admits as premises: the smoke's seat rested every part on a place a reader kept,
      // and the capture held no place for it at all, so all seven parts were set aside.
      keptPlaceIds.set(id, new Set(cap.table.filter(isKeptPlace).map((r) => r.place)));
      form = 2;
      problems.push(...[...own, ...out.problems].map((text) => ({ item: i, text, field: "*" })));
      // Unit U1 (2026-10-07): a role the record settles is written in, over the per-place table (the trail it stands on).
      const tableRows = cap.table.map((r) => ({ file: r.file, lines: r.line_decided ?? String(r.line), disposition: r.not_checked ? "" : (r.decision ?? "") }));
      const roles = inferredEvidenceRoles({ candidate, verdict: out.entry.verdict, rows: tableRows, evidence: out.entry.evidence });
      return roles.written > 0 ? { ...out.entry, evidence: roles.evidence } : out.entry;
    }
    // Build unit F3: a place-plan candidate's decisions are one row per place (design 1.5), checked C1-C9.
    if (candidate && isPlacePlanCandidate(candidate)) {
      const out = readingOfPlaceDecisions({ candidate, decisions: entry.decisions ?? [], capture: placeCapture?.() ?? null });
      if (out.unconvertible) {
        unconvertible = out.unconvertible;
        return entry;
      }
      if (out.passed && out.passed.length > 0) placesPassed.push({ finding_id: id, rows: out.passed });
      keptPlaceIds.set(id, keptPlacesOfRows(out.rowById));
      if (out.removed) removedRows[String(i)] = out.removed;
      // Evidence that names a place by id (`unit: "P17"`) is the place's unit's (`L17`), whose row this is.
      const evidence = Array.isArray(entry.evidence)
        ? entry.evidence.map((e) => {
            const unit = e && typeof e === "object" ? unitOfPlace((e as Record<string, unknown>).unit) : null;
            return unit ? { ...(e as Record<string, unknown>), unit } : e;
          })
        : entry.evidence;
      const items = placeItemsOf(candidate, out.rowById, evidence);
      const ev = evidenceOfIds({ candidate, rowById: out.rowById, evidence: items.evidence });
      // Unit U1 (2026-10-07): a role the record settles is written in, over the seat's own rows and the rows kept for it.
      const roles = inferredEvidenceRoles({ candidate, verdict: entry.verdict, rows: [...new Set(out.rowById.values())] as unknown as Record<string, unknown>[], evidence: ev.evidence });
      form = 2;
      own.push(...out.problems, ...items.problems, ...renderDecisionProblems(ev.problems));
      problems.push(...own.map((text) => ({ item: i, text })));
      // Verification A, VA-1: the place seat that answers a candidate fitting one seat is held to A4 as an answer seat
      // is (place-answer.ts `notApplicableBar`, the one rule for both); it names the whole entry, verdict and rows.
      const a4 = notApplicableBar(entry.verdict, out.standing ?? []);
      if (a4) problems.push({ item: i, text: a4, field: "*" });
      const searched = Array.isArray(entry.searched) ? entry.searched : undefined;
      const reading = { read: out.read, ...(searched && searched.length > 0 ? { searched } : {}) };
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(entry)) {
        if (k === "decisions") next.reading = reading;
        else if (k === "evidence") next.evidence = roles.evidence;
        else if (k !== "searched" && k !== "reading") next[k] = v;
      }
      if (!("reading" in next)) next.reading = reading;
      return next;
    }
    const handed = candidate ? handedUnitIds(candidate, "seat") : null;
    if (!candidate || !handed) {
      if (candidate && carries) own.push(...renderDecisionProblems([{ cls: "no-census", id: "" }]));
      problems.push(...own.map((text) => ({ item: i, text })));
      return entry;
    }
    if (own.length === 0 || "decisions" in entry) {
      const out = readingOfDecisions({ candidate, handed, decisions: entry.decisions, who: "seat", opened });
      if (out.removed) removedRows[String(i)] = out.removed;
      // Premises and census items named by id (M5): filled from the seat's own decisions, then checked as any entry.
      const ev = evidenceOfIds({ candidate, rowById: out.rowById, evidence: entry.evidence });
      // Unit U1 (2026-10-07): a role the record settles is written in, over the seat's own rows (a part of the trail).
      const roles = inferredEvidenceRoles({ candidate, verdict: entry.verdict, rows: out.read as unknown as Record<string, unknown>[], evidence: ev.evidence });
      form = 2;
      own.push(...renderDecisionProblems([...out.problems, ...ev.problems]));
      problems.push(...own.map((text) => ({ item: i, text })));
      const searched = Array.isArray(entry.searched) ? entry.searched : undefined;
      const reading = {
        read: out.read,
        ...(searched && searched.length > 0 ? { searched } : {}),
        ...(out.declined.length > 0 ? { declined: out.declined } : {}),
        ...(out.unopened.length > 0 ? { unopened: out.unopened } : {}),
      };
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(entry)) {
        if (k === "decisions") next.reading = reading;
        else if (k === "evidence") next.evidence = roles.evidence;
        else if (k !== "searched" && k !== "reading") next[k] = v;
      }
      if (!("reading" in next)) next.reading = reading;
      return next;
    }
    problems.push(...own.map((text) => ({ item: i, text })));
    return entry;
  });
  /* A field no check reads on that rule is dropped and recorded, never refused (reading.ts `inertDismissals`):
   * over the record the program writes, after every path above, so that the record's checks, run on it next, never see it.
   * The record is then the program's (form 2) whatever path wrote it. */
  const normalised: NonNullable<DecisionsConversion["normalised"]> = [];
  const written = record.map((value, i) => {
    const entry = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    const id = entry && typeof entry.finding_id === "string" ? entry.finding_id : "";
    const candidate = entry && id && candidateOf ? candidateOf(id) : null;
    if (!entry || !candidate) return value;
    const inert = inertDismissals(candidate, entry.evidence);
    // A wait that names no question the program asks is refused, under
    // `standing`, so that the seat names the question (verdict-capture.ts reads a `standing` problem as not the conversion's). So is every other part of `standing` that does not stand,
    // naming beside `standing` the fields its correction may change (`opens`: M1 of the non-author check). `names`: what the refusal names inside `standing` (its parts, or the block).
    const refuse = (text: string, opens?: readonly string[], strays?: readonly string[], names?: readonly string[]): void => {
      problems.push({ item: i, text, field: "standing", names: names ?? ["standing"], ...(opens && opens.length > 0 ? { opens } : {}), ...(strays && strays.length > 0 ? { strays: strays.map((k) => `standing.${k}`) } : {}) });
    };
    const withStanding = standingOfEntry(inert.dropped.length > 0 ? { ...entry, evidence: inert.evidence } : entry, candidate, keptPlaceIds.get(id) ?? new Set(), placeCapture, premiseOf, refuse);
    if (inert.dropped.length === 0 && withStanding === null) return value;
    for (const d of inert.dropped) normalised.push({ item: i, finding_id: id, evidence: d.index, fields: d.fields, why: d.why });
    form = 2;
    return withStanding ?? { ...entry, evidence: inert.evidence };
  });
  return {
    record: written,
    problems,
    ...(form ? { form } : {}),
    ...(unconvertible ? { unconvertible } : {}),
    ...(placesPassed.length > 0 ? { placesPassed } : {}),
    ...(Object.keys(removedRows).length > 0 ? { removedRows } : {}),
    ...(normalised.length > 0 ? { normalised } : {}),
  };
}

/** The program's closed list of questions: every profile field carrying an `x-question`. */
let questionIdsCache: ReadonlySet<string> | null = null;
export function standingQuestionIds(): ReadonlySet<string> {
  if (!questionIdsCache) questionIdsCache = new Set(loadDeclarationSource().fields.map((f) => f.field));
  return questionIdsCache;
}

/**
 * The program's "does it ship" premise for a file, from
 * the findings document's `ships_premises`, where it stands: `unknown` as written; any other premise only with at least
 * one `because` line, every one of them found at its line in the tree (`programLineStands`, the one quote comparison).
 * A premise that does not stand, or a file with none, is null: the place ships.
 */
export function shipsPremiseOf(premises: unknown, root: string): (file: string) => ShipsPremise | null {
  const table = premises && typeof premises === "object" && !Array.isArray(premises) ? (premises as Record<string, unknown>) : {};
  const known = new Map<string, ShipsPremise | null>();
  const lines = new Map<string, string[] | null>();
  return (file) => {
    const got = known.get(file);
    if (got !== undefined) return got;
    const e = Object.prototype.hasOwnProperty.call(table, file) ? table[file] : undefined;
    const row = e && typeof e === "object" && !Array.isArray(e) ? (e as { premise?: unknown; because?: unknown }) : null;
    const premise = row && (SHIPS_PREMISES as readonly unknown[]).includes(row.premise) ? (row.premise as ShipsPremise) : null;
    const stands = (b: unknown): boolean => {
      const q = b && typeof b === "object" && !Array.isArray(b) ? (b as { file?: unknown; line?: unknown; quote?: unknown }) : null;
      return !!q && typeof q.file === "string" && typeof q.line === "number" && typeof q.quote === "string" && programLineStands(root, q.file, q.line, q.quote, lines);
    };
    const out = premise === "unknown" ? premise : premise && Array.isArray(row?.because) && row.because.length > 0 && row.because.every(stands) ? premise : null;
    known.set(file, out);
    return out;
  };
}

/**
 * The `standing` block of one verdict entry, checked S1-S6 and S8
 * (standing.ts `checkStanding`): the parts that stand are written as the record's `standing`, every part set aside as
 * `standing_set_aside[]`. A block on a `not_applicable` verdict is not read and is recorded as set aside whole. Null where
 * the entry carries no block (nothing to write). An omitted `ships` takes the scan's premise for the
 * decisive place's file, where `premiseOf` gives one. Wherever anything is set aside, `onRefused` is handed the
 * sentence that refuses it, and the capture sends it back to the seat (`answerRulesAtCapture`'s conversion), as it sends
 * back a place row that fails; the record written here is the one kept after the seat's last refusal (verdict-capture.ts
 * `lastAnswer`) or where no capture refuses (the assembly over a record already on disk), with the verdict kept.
 */
export function standingOfEntry(
  entry: Record<string, unknown>,
  candidate: Candidate,
  keptPlaces: ReadonlySet<string>,
  placeCapture?: () => PlaceCapture | null,
  premiseOf?: (file: string) => ShipsPremise | null,
  /**
   * Called with the sentence that refuses the block (standing.ts
   * `checkStanding`'s `refused`: since any part that did not
   * stand), and the fields beside `standing` a correction may change (`checkStanding`'s `opens`; for a block on a verdict
   * that takes none, the verdict: M1 of the non-author check); the capture sends it back to the seat. Absent, the block is only
   * checked and recorded, as before. `strays` (D5FIX2, F2): the keys inside the block that are no part of it
   * (`checkStanding`'s `strays`). `names`: what the refusal names inside
   * `standing`, each part it sets aside (`checkStanding`'s `names`), or the whole block where the block is refused.
   */
  onRefused?: (text: string, opens?: readonly string[], strays?: readonly string[], names?: readonly string[]) => void,
): Record<string, unknown> | null {
  if (!("standing" in entry)) return null;
  const { standing: raw, standing_set_aside: _given, ...rest } = entry;
  const verdict = typeof entry.verdict === "string" ? entry.verdict : "";
  if (verdict !== "violation_candidate" && verdict !== "needs_human") {
    const notRead: StandingSetAside[] = [{ part: "standing", value: raw, why: `\`standing\` belongs on a finding you let stand; this verdict is \`${verdict}\`, so it is not read` }];
    onRefused?.(standingRefusal(undefined, notRead, STANDING_OPENS_VERDICT), STANDING_OPENS_VERDICT, undefined, ["standing"]);
    return { ...rest, standing_set_aside: notRead };
  }
  const cap = placeCapture?.() ?? null;
  const checked = checkStanding(raw, {
    verdict,
    evidence: entry.evidence,
    keptPlaces,
    bases: (candidate.legal_basis_refs ?? []).length,
    questions: standingQuestionIds(),
    elements: new Set((readingClassOf(candidate)?.elements ?? []).map((e) => e.name)),
    ...(cap ? { lineStands: (file: string, line: number, quote: string) => lineStandsAsBeyond(cap, file, line, quote) } : {}),
    ...(premiseOf
      ? {
          premiseOf,
          placeFile: (place: string) => {
            const n = placeIndexOf(place);
            const loc = n === null ? undefined : candidate.locations?.[n];
            return loc && typeof loc.file === "string" ? loc.file : null;
          },
        }
      : {}),
  });
  if (checked.refused) onRefused?.(checked.refused, checked.opens, checked.strays, checked.names);
  return { ...rest, ...(checked.standing ? { standing: checked.standing } : {}), ...(checked.setAside.length > 0 ? { standing_set_aside: checked.setAside } : {}) };
}

/**
 * A refuter's answer, entry by entry (M5; design section 2.5 as the parent amended it, 2026-09-30). Where the candidate
 * carries a census, the refuter's reading is `decisions` (optional: its reading is a record, not a duty) and `searched`,
 * and the program writes the refutation's `reading` block from them (`refutationReadingOf`); a `reading` block is refused
 * naming the new form, as the adjudicator's is. A candidate with no census takes neither.
 */
export function refutationsFromDecisions(reply: unknown, candidateOf: ((id: string) => Candidate | null) | null, opened?: (file: string, lines: string) => boolean): DecisionsConversion {
  if (!Array.isArray(reply)) return { record: reply, problems: [] };
  const problems: DecisionsConversion["problems"] = [];
  const removedRows: NonNullable<DecisionsConversion["removedRows"]> = {};
  let unconvertible: string | undefined;
  let form: 2 | undefined;
  const record = reply.map((value, i) => {
    const entry = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    if (!entry) return value;
    const own: string[] = [];
    if ("reading" in entry) own.push(...renderDecisionProblems([{ cls: "reading", id: "" }]));
    const carries = "decisions" in entry || "searched" in entry;
    const candidate = candidateOf && typeof entry.finding_id === "string" ? candidateOf(entry.finding_id) : null;
    // R-2: a location ground overturns only an opted-in rule's finding.
    const located = candidate ? locationOverturnRefused(entry, candidate) : null;
    if (located) own.push(located);
    if (!candidateOf) {
      if (carries) unconvertible = "this answer carries `decisions` or `searched`, which the capture turns into the record from the scan's findings document: pass --findings (the hook always has it)";
    } else if (candidate && carries && !readingUnitsCensusOf(candidate)) {
      own.push(...renderDecisionProblems([{ cls: "no-census", id: "" }]));
    } else if (candidate && carries) {
      const out = readingOfDecisions({ candidate, handed: [], decisions: entry.decisions ?? [], who: "refuter", opened });
      if (out.removed) removedRows[String(i)] = out.removed;
      form = 2;
      own.push(...renderDecisionProblems(out.problems));
      problems.push(...own.map((text) => ({ item: i, text })));
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(entry)) if (k !== "decisions" && k !== "searched" && k !== "reading") next[k] = v;
      next.reading = refutationReadingOf(candidate, out, entry.searched);
      return next;
    }
    problems.push(...own.map((text) => ({ item: i, text })));
    return entry;
  });
  return { record, problems, ...(form ? { form } : {}), ...(unconvertible ? { unconvertible } : {}), ...(Object.keys(removedRows).length > 0 ? { removedRows } : {}) };
}

/** The record's `seat_instructions`, as `buildRestsOn` takes them; a problem where there are none. */
function instructionsOfRecord(value: unknown): { premise?: InstructionsPremise; problem?: string } {
  const premise = instructionsPremiseOfRecord(value);
  if (premise) return { premise };
  return { problem: "the capture recorded no instructions for this verdict's seat (`seat_instructions`, written when the seat ends)" };
}

/** The premise block's inputs (unit H): the tree the digests are taken over and the bundle's rules. */
export interface PremiseInputs {
  tree: TreeReader;
  rules: Map<string, Rule>;
  version: string;
  files: Record<string, string> | undefined;
  /** The instructions this run's seats judged by, taken once (`instructions.ts`). */
  instructions: ReturnType<typeof instructionsPremise>;
}

export function premiseInputs(treeRoot: string, bundleDir: string): PremiseInputs {
  const loaded = loadBundle(bundleDir);
  return {
    tree: new TreeReader(treeRoot),
    rules: new Map(loaded.rules.map((r) => [r.id, r])),
    version: loaded.manifest.bundle_version,
    files: loaded.manifest.files,
    instructions: instructionsPremise(),
  };
}

/**
 * The files `--assemble-into` writes, in the order it writes them: every verdict document with its
 * assembled `reading` block and, where the premise inputs are given, its `rests_on` block merged in;
 * then every refutation and silence file byte for byte. Readers' replies are not copied.
 */
export function assembledCopies(args: {
  verdictsDir: string;
  read: Pick<VerdictsForReading, "verdictDocs" | "passthrough">;
  assembled: AssembledVerdictReading[];
  candidates: Candidate[];
  perRuleApplicability: Parameters<typeof answersFromApplicability>[0];
  premise: PremiseInputs | null;
  /** The findings document's profile digest and dependency inventory, which every seat was handed. */
  handed?: Parameters<typeof handedPremiseOf>[0] & { ships_premises?: unknown };
  /** With `handed`, whether the orientation sheet the briefs name was beside the findings (`orientationSheetBeside`). */
  orientationSheet?: boolean;
}): { files: { rel: string; content: string | Buffer }[]; merged: number; premised: number; copied: number } {
  const { assembled, candidates } = args;
  const { verdictDocs, passthrough } = args.read;
  const premiseTree = args.premise?.tree ?? null;
  const premiseRules = args.premise?.rules ?? new Map<string, Rule>();
  const premiseVersion = args.premise?.version ?? "";
  const premiseFiles = args.premise?.files;
  const files: { rel: string; content: string | Buffer }[] = [];
  const blockOf = new Map(assembled.map((a) => [a.finding_id, a.reading]));
  /* THE FILES EVERY RECORD OF THE SET QUOTED ARE PREMISES OF THE CARRY. A verdict's
   * placement rests on its refutation and its second look as well as on its own record (verdict-set.ts), so a file either of
   * them quoted is digested with the verdict's own: a later run that finds it changed (or gone) judges the finding again
   * rather than carry a placement that quotes a line no longer there. The refuter seat's files are read once, from the bytes
   * this step copies (`passthrough`), and each is put under the field of its kind; several files of one kind (an answer
   * asked again) each add their quotations. */
  const nestedOf = new Map<string, Record<string, unknown>>();
  for (const p of passthrough) {
    if (!p.rel.includes("refutation/")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(p.bytes.toString("utf8"));
    } catch {
      continue; // a file that does not parse is refused where it is read for the report; it adds no premise here
    }
    for (const one of Array.isArray(parsed) ? parsed : [parsed]) {
      if (!one || typeof one !== "object" || Array.isArray(one)) continue;
      const rec = one as Record<string, unknown>;
      const id = typeof rec.finding_id === "string" ? rec.finding_id : "";
      if (!id) continue;
      const row = nestedOf.get(id) ?? {};
      const field = VERDICT_SET_FIELD[verdictSetKindOfRefuterRecord(rec)];
      const before = row[field] as { evidence?: unknown } | undefined;
      row[field] = { ...rec, evidence: [...(Array.isArray(before?.evidence) ? before.evidence : []), ...(Array.isArray(rec.evidence) ? rec.evidence : [])] };
      nestedOf.set(id, row);
    }
  }
  /* UNIT F'S SETTLED ANSWERS AS PREMISES (unit GFH-2, 2026-09-22). They are written HERE, by the
   * assembly step, and never by a seat or by the scan: the scan settles the answer and writes it
   * into `per_rule_applicability`, and this step attaches each rule's rows to the verdicts of
   * that rule so a later run can tell a verdict whose declaration moved from one whose did not.
   * A document with no block yields an empty map, and then no verdict carries an answers row. */
  const settledAnswers = answersFromApplicability(args.perRuleApplicability);
  // Absent where the caller handed no findings document: then no `handed` row is written, and a later run that compares
  // one gives the verdict again rather than trusting a row that says "no profile, no inventory" nobody checked.
  const handed = args.handed !== undefined ? handedPremiseOf(args.handed, args.orientationSheet as boolean) : undefined;
  // The scan's ships premises, a premise of every verdict on a file that has one (rests-on.ts `shipsFactsOf`).
  const shipsFacts = args.handed !== undefined ? shipsFactsOf(args.handed.ships_premises) : undefined;
  const candidateOf = new Map(candidates.map((c) => [c.finding_id, c]));
  let premised = 0;
  let merged = 0;
  let copied = 0;
  for (const doc of verdictDocs) {
    const records = Array.isArray(doc.parsed) ? doc.parsed : [doc.parsed];
    const out = records.map((record) => {
      const id = (record as { finding_id?: string })?.finding_id;
      const block = id ? blockOf.get(id) : undefined;
      const candidate = id ? candidateOf.get(id) : undefined;
      let premises: RestsOn | undefined;
      if (premiseTree && candidate) {
        const rec = record as Record<string, unknown>;
        const reading = (block ?? (rec.reading as Record<string, unknown> | undefined)) as
          | { read?: { file?: string }[]; searched?: { for?: string; pattern?: string; paths?: string; hits?: number }[] }
          | undefined;
        premises = buildRestsOn({
          candidate,
          ...(shipsFacts ? { ships: shipsFacts } : {}),
          source: {
            read: reading?.read ?? [],
            searched: reading?.searched ?? [],
            evidence: [
              ...(Array.isArray(rec.evidence) ? (rec.evidence as { file?: string }[]) : []),
              ...filesQuotedByNestedRecords(nestedOf.get(id ?? "") ?? {}).map((file) => ({ file })),
            ],
          },
          tree: premiseTree,
          rule: premiseRules.get(candidate.rule_id),
          bundleVersion: premiseVersion,
          bundleFiles: premiseFiles,
          answers: settledAnswers.get(candidate.rule_id),
          /* The instructions the capture digested when the seat ended, never this step's: a run assembled
           * after a plugin update would otherwise record the newer instructions for a verdict judged under the older. A
           * record without them (a hand capture, or one captured before) makes the block incomplete. */
          instructions: instructionsOfRecord(rec.seat_instructions),
          ...(handed ? { handed } : {}),
          model: rec.seat_model,
          effort: rec.seat_effort,
          sight: rec.seat_sight,
          // What the seat's own transcript could not give when it ended; only a later run's carry reads it.
          untaken: rec.seat_untaken,
        });
        /* Build unit F5 (design section 4): a place-plan candidate's verdict also rests on each place's own premises,
         * written on its row by the capture. A row without them (captured before this unit) puts no place here, and a
         * later run reads that place again. */
        if (isPlacePlanCandidate(candidate)) {
          const rows = (reading?.read ?? []) as { premises?: unknown }[];
          const places = rows
            .map((r) => r.premises)
            .filter((p): p is NonNullable<RestsOn["places"]>[number] => !!p && typeof p === "object" && typeof (p as { key?: unknown }).key === "string")
            .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.row.line - b.row.line));
          premises = { ...premises, places };
          /* VA-5: an answer seat's own premises, written by the capture on its record, move into the block;
           * a record without them (captured before) puts none here, and a later run gives its answer again. */
          const answer = (rec.reading as { answer_premises?: unknown } | undefined)?.answer_premises;
          if (isAnswerSeatCandidate(candidate) && answer && typeof answer === "object" && !Array.isArray(answer)) {
            premises = { ...premises, answer: answer as NonNullable<RestsOn["answer"]> };
          }
        }
        premised += 1;
      }
      if (!block && !premises) return record;
      if (block) merged += 1;
      return {
        ...(record as Record<string, unknown>),
        ...(block ? { reading: block } : {}),
        ...(premises ? { rests_on: premises } : {}),
      };
    });
    files.push({ rel: doc.rel, content: `${JSON.stringify(Array.isArray(doc.parsed) ? out : out[0], null, 2)}\n` });
  }
  for (const p of passthrough) {
    files.push({ rel: p.rel, content: p.bytes });
    copied += 1;
  }
  return { files, merged, premised, copied };
}

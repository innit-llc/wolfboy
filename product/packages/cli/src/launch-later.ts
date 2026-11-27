/**
 * THE REFUTER AND SILENCE-INVESTIGATOR ENTRIES OF THE LAUNCH LIST.
 *
 * The pre-launch step writes the adjudicator entries (`launch-plan.ts`) and leaves these two kinds out,
 * because neither is known before the seats run: a refuter exists only once an adjudicator has returned
 * a `violation_candidate`, and which silent rules are searched is the orchestrator's reasoning (SKILL.md
 * step 3c: no table from profile features to rule ids, here or anywhere). While a scan runs, the launch
 * gate refuses every `Agent` launch that is not an entry of the list, so without these entries no refuter
 * and no silence investigator could be launched. Two commands append them:
 *
 * - `refuter-entries --record <captured adjudicator record>`: one entry per `violation_candidate` in
 *   that record (a candidate carrying `kinds` is one candidate, refuted once). The brief is made ONLY
 *   from the candidate as the scan's payload holds it, its rule's block from the same payload, the
 *   census summary where the candidate has one, and the scanner's orientation sheet marked as not
 *   quotable. The record is read for one thing - which `finding_id`s it classes `violation_candidate` -
 *   and the brief builder is never handed the record: nothing of the verdict, its evidence, its
 *   `reading` block or the readers' dispositions can reach a refuter.
 *   Under the recommended shape (`refute_later`, no second check) it appends only the second look's entries (in every other
 *   shape beside the refuter entries): a refuter
 *   in challenge mode for each high finding the review took out of the count on its own word (`buildChallengeEntries`,
 *   `second-look.ts`), whose brief carries that claim and its line and nothing else of the record; in a shape with the
 *   second check, also for each high finding the review ruled out as not applicable.
 * - `silence-entries --rules <ids>`: one entry for the group of silent rules the orchestrator names.
 *   The brief carries the rules' rows, the whole `coverage_limits` block, the `.legal/` exclusion and
 *   the set-aside list, in the program's words, with the profile, the orientation sheet and the
 *   corroboration entries the investigator's definition says it is handed.
 *
 * Each entry has the adjudicator entries' shape where it can: the WHOLE `Agent` input with a one-line
 * prompt naming the brief, a stable id, a wave within the list's capacity and after the seat it waits
 * for, and the path the capture command writes its answer to (`recordPathFor`, imported: one scheme).
 * The list is replaced atomically (the gate may read it at any moment) under a lock (two appends at
 * once would otherwise lose one), and a request naming a candidate or a rule that does not exist, or
 * one already listed, is refused by name with nothing written. A violation candidate the command cannot
 * make an entry for (a split-group part, one already listed) is held and named; the record's other
 * candidates still get theirs.
 *
 * Nothing the program wrote earlier is taken as given when it is read back here: the list, the findings
 * document, the payload, the orientation sheet and notes, the run context, and the captured record with
 * its kept reply are each read only while they have the sha256 the program recorded when it wrote them,
 * and refused by name otherwise (`launch-list-file.ts`).
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { relativePath } from "./project-path.js";
import type { Command } from "commander";
import { type ReadBack, appendEntries, readLaunchList, readRecorded, replaceLaunchList, sha256Of, withListLock } from "./launch-list-file.js";
import { readProgramFile } from "./program-file.js";
import { alreadyHasEntry, currentExaminations, examines, recordLabelOf, standingRefuters } from "./launch-list-file.js";
import { isLocationOverturn } from "./standing.js";
import { redactForPrint } from "./printed-output.js";
import {
  LAUNCH_FORM,
  LONG_TEXT_KEY,
  PLUGIN_NAME,
  READ_LINE_LIMIT,
  briefReadWords,
  captureKeyOf,
  joinLongText,
  lineSafeJson,
  lineSafeText,
  lineStats,
  type AgentInput,
  type LaunchEntry,
  type LaunchList,
  type ReadRole,
  type SeatRead,
} from "./launch-plan.js";
import { canonicalJson } from "./rests-on.js";
import { LEDGER_FILE, recordPathFor } from "./verdict-capture.js";
import { readRegularFile } from "./project-read.js";
import { findingsChangedProblem } from "./log-digest.js";
import { placeId, placeIndexOf } from "./ref-ids.js";
import { CHALLENGE_MODE, challengeEntryId, challengeOf, documentationPagesOf, isChallengeEntry, locationChallengeOf, premisesOfFindings, type Challenge } from "./second-look.js";
import { declaredInapplicableOf, loadDeclarationSource, type DeclarationSource } from "./declaration.js";

/** The program's question source for the second look's row-5 test, read once; null where it cannot be read (no kind known). */
let declSource: DeclarationSource | null | undefined;
const declarationSource = (): DeclarationSource | null => {
  if (declSource === undefined) {
    try {
      declSource = loadDeclarationSource();
    } catch {
      declSource = null;
    }
  }
  return declSource;
};

export const REFUTER_AGENT = `${PLUGIN_NAME}:legal-refuter`;
export const SILENCE_AGENT = `${PLUGIN_NAME}:legal-silence-investigator`;

export type LaterRole = "refuter" | "silence-investigator";

/** A file the program read to make an entry, with its sha256 at that moment. */
export interface MadeFrom {
  what: string;
  path: string;
  sha256: string;
}

export interface LaterEntry {
  /** `refute-` + 12 hex of sha256(finding_id), or `silence-` + 12 hex of sha256(the rule ids, sorted, one per line). */
  id: string;
  order: number;
  wave: number;
  role: LaterRole;
  /** A refuter waits for the verdict seat whose record named its candidate; a silence entry waits for nothing. */
  after: string[];
  finding_ids: string[];
  rule_ids: string[];
  /** Where the capture command writes this launch's answer, relative to `.legal` (`verdict-capture.ts` `recordPathFor`). */
  record: string;
  /** The `--key` that capture takes for it: the silence batch name (the entry id). A refuter handed one candidate needs none. */
  capture_key: string | null;
  made_from: MadeFrom[];
  brief_path: string;
  brief_sha256: string;
  /** In the background, as every listed launch (launch-plan.ts `LAUNCH_FORM`). */
  launch: typeof LAUNCH_FORM;
  agent_input: AgentInput;
  agent_input_sha256: string;
  /**
   * `challenge` on a refuter entry
   * that is the second look at a finding the first review took out of the count on its own word (`second-look.ts`): its
   * seat answers in challenge mode, and its outcome moves the finding's placement, never its verdict. Absent on every
   * other entry.
   */
  mode?: typeof CHALLENGE_MODE;
  /** On a challenge entry: what the first review claimed, as the brief names it (`second-look.ts` `Challenge`). */
  claim?: Challenge["claim"];
}

/** One request the list has honoured: the record a refuter request examined, or the rules a silence request named. */
export interface Appended {
  command: "refuter-entries" | "silence-entries" | "makeup-entries";
  /** A make-up request (design 1.7): the entry whose seat ended without an accepted answer. */
  makeup_of?: string;
  record?: string;
  record_sha256?: string;
  rule_ids?: string[];
  entries: string[];
  /** Violation candidates of the record that got no entry, each with the reason (a split-group part, one already listed, ...). */
  held?: Held[];
}

/** A candidate a refuter request could not make an entry for, and why. The record's other candidates still get theirs. */
export interface Held {
  finding_id: string;
  reason: string;
}

const sha256 = (s: string | Uint8Array): string => createHash("sha256").update(s).digest("hex");
export const refuterEntryId = (findingId: string): string => `refute-${sha256(findingId).slice(0, 12)}`;
export const silenceEntryId = (ruleIds: string[]): string => `silence-${sha256([...ruleIds].sort().join("\n")).slice(0, 12)}`;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/**
 * A JSON value as fenced, line-safe lines of a brief, without indentation, as the payload reading copies are written.
 */
const jsonBlock = (v: unknown): string[] => ["```json", lineSafeJson(v, READ_LINE_LIMIT, ""), "```"];

const LINE_SAFE_SENTENCE =
  `No line of this brief is longer than ${READ_LINE_LIMIT} characters. In its JSON, a string too long for one line is written as {"${LONG_TEXT_KEY}": [...]}: the string is its parts joined with nothing between them.`;

/**
 * The brief as written: line-safe, and where it is longer than one Read with no limit returns (2,000
 * lines), saying so on its third line with its own length, so the seat reads all of it (run 1's largest
 * candidate gives a 4,712-line brief).
 */
function finish(lines: string[]): string {
  let text = lineSafeText(`${lines.join("\n")}\n`);
  const n = lineStats(text).lines;
  if (n > 2000) {
    const parts = text.split("\n");
    parts.splice(2, 0, `This brief is ${n + 1} lines long: read all of them (a Read with no limit returns at most 2,000).`);
    text = parts.join("\n");
  }
  if (lineStats(text).over_limit > 0) throw new Error(`a brief line is longer than ${READ_LINE_LIMIT} characters`);
  return text;
}

// ------------------------------------------------------------------------------------------------
// THE BRIEFS. Pure: each takes only what it may carry.
// ------------------------------------------------------------------------------------------------

/**
 * A refuter's brief. Its arguments are its whole input: the candidate as the payload holds it, the rule's
 * block from the same payload, and the orientation sheet. There is no parameter through which a verdict,
 * its evidence, its `reading` block, a reader's disposition or the orchestrator's notes could arrive.
 *
 * The rule's block is pasted whole, every field, as before cost step 1. That step's first build kept only the two
 * fields the refuter's definition names (`legal_basis_refs`, `context_questions`); its verification found run 2's
 * refuters quoting the others (`evidence_template`, `remediation_template`, `title`, `data_categories`,
 * `depends_on_applicability`, `reading_class`) and grounding dispositions on them. What a seat uses is not bounded by what its definition names.
 * The sheet is pasted whole too: the first build pasted its path classes and named the rest by file, which 25 of run
 * 2's 80 refuters would have had to open to keep what they used, for a saving of about nothing.
 */
/**
 * BUILD UNIT F4: what a place-plan
 * candidate's refuter is never given - a seat's decision, `data`, `item`, `why` or `beyond`, the fold, or the answer's
 * reasoning. None of them is in the scan's payload; the brief also drops any such field a candidate object carries.
 */
export const REFUTER_WITHHELD_FIELDS: readonly string[] = ["decisions", "decision", "reading", "verdict", "reasoning", "evidence", "fold", "answer", "why", "data", "item", "beyond", "disposition", "ground"];

/** One place as a place-plan candidate's refuter is given it: its id, where it is, and its window's lines. */
export interface RefuterPlace {
  id: string;
  at: string;
  window: string | null;
  given: string;
}

/**
 * The place list of a place-plan candidate, from the scan's payloads of the seats that held its places (each place is in
 * exactly one): id, file:line and window lines only. A payload that cannot be read is skipped; a place in none of them is
 * listed by its location with no window.
 */
export function refuterPlacesOf(candidate: Json, payloads: readonly unknown[]): RefuterPlace[] {
  const fid = String(candidate.finding_id);
  const out = new Map<string, RefuterPlace>();
  for (const p of payloads) {
    const cands = isObject(p) && Array.isArray(p.candidates) ? p.candidates.filter(isObject) : [];
    for (const c of cands.filter((x) => x.finding_id === fid)) {
      for (const l of Array.isArray(c.locations) ? c.locations.filter(isObject) : []) {
        const id = str(l.place);
        if (!id || out.has(id)) continue;
        const ctx = isObject(l.context) ? l.context : null;
        const w = ctx && Array.isArray(ctx.window) && ctx.window.length === 2 ? `${ctx.window[0]}-${ctx.window[1]}` : null;
        out.set(id, { id, at: `${String(l.file)}:${String(l.start_line)}`, window: w, given: str(l.given) ?? "window" });
      }
    }
  }
  const locs = Array.isArray(candidate.locations) ? candidate.locations.filter(isObject) : [];
  locs.forEach((l, n) => {
    if (!out.has(placeId(n))) out.set(placeId(n), { id: placeId(n), at: `${String(l.file)}:${String(l.start_line)}`, window: null, given: "not in a payload" });
  });
  return [...out.values()].sort((x, y) => (placeIndexOf(x.id) ?? -1) - (placeIndexOf(y.id) ?? -1));
}

export function refuterBrief(a: { scanId: string; runId: string; id: string; candidate: Json; ruleBlock: Json; sheet: string | null; places?: RefuterPlace[]; challenge?: Challenge }): string {
  const fid = String(a.candidate.finding_id);
  const rule = String(a.candidate.rule_id);
  // F4 (R3): a place-plan candidate is shown with its place list and none of the withheld fields.
  const placeForm = Array.isArray(a.places);
  if (placeForm) {
    const shown: Json = {};
    for (const [k, v] of Object.entries(a.candidate)) if (k !== "locations" && !REFUTER_WITHHELD_FIELDS.includes(k)) shown[k] = v;
    a = { ...a, candidate: { ...shown, locations: (a.places ?? []).map((p) => ({ file: p.at.slice(0, p.at.lastIndexOf(":")), start_line: Number(p.at.slice(p.at.lastIndexOf(":") + 1)) })) } };
  }
  const locations = Array.isArray(a.candidate.locations) ? a.candidate.locations : [];
  const files = [...new Set(locations.map((l) => (isObject(l) ? str(l.file) : null)).filter((f): f is string => f !== null))];
  const census = a.candidate.kinds_catalogue !== undefined;
  const ch = a.challenge;
  // A location look challenges the second review's overturn, not the first review's claim.
  const whose = ch?.claim === "location" ? "the second review (the ordinary refuter)" : "the first review";
  return finish([
    `# Launch brief ${a.id}`,
    "",
    `Written by the scanner (\`legal-scan refuter-entries\`) for scan ${a.scanId}, run ${a.runId}.`,
    "You were launched with one line naming this file. Everything this launch hands you is in this brief: open no other file under `.legal/`, and never name `.legal` in a Grep glob or path: Grep leaves it out by itself.",
    LINE_SAFE_SENTENCE,
    ch
      ? `This brief is made from the scanner's own output, the candidate as the scan's payload holds it, its rule's block from the same payload, ${census ? "the census summary, " : ""}and the orientation sheet, and from one thing another agent wrote: the claim ${whose} made about this finding and the line that claim rests on (section "The claim to challenge"). Nothing else that review wrote is in it: not its reasoning, its other quotations, or what it read.`
      : `This brief is made from the scanner's own output only: the candidate as the scan's payload holds it, its rule's block from the same payload, ${census ? "the census summary, " : ""}and the orientation sheet. Nothing another agent wrote about this candidate is in it.`,
    "",
    "## What you are",
    ch
      ? `The second look at one finding, in challenge mode: \`${fid}\` of rule \`${rule}\`. ${ch.claim === "location" ? "The second review overturned it as not applicable, on the claim below, and so took it out of what the report counts as a problem." : "The first review kept its construct and took it out of what the report counts as a problem, on the claim below."} Your agent definition's section "Challenge mode" is yours: try to show that claim wrong. Return one object, for \`${fid}\`, with \`mode\` set to \`challenge\`.`
      : `The refuter for one candidate: \`${fid}\` of rule \`${rule}\`. Return one object, for \`${fid}\`.`,
    ...(ch ? ["", ...challengeSection(ch)] : []),
    "",
    "## Where to start",
    `Open the candidate's own ground first: ${files.length > 0 ? `the ${files.length} file(s) its \`locations\` name (${files.join(", ")})` : "its `locations` name no file"}${census ? ", the representative of each kind the census summary names" : ""}, the tree's manifests and its top-level docs. Then work outward exactly as your agent definition orders. This section orders your reading and nothing else.`,
    "",
    "## The candidate, as the scan's payload holds it",
    ...jsonBlock(a.candidate),
    ...(placeForm
      ? [
          "",
          "## Its places",
          `Every place of this candidate, by id, with its file and line and the lines of its window (${(a.places ?? []).length} places). You are given no seat's decision, data, item, reason or line outside a window for any of them, nor the program's fold of those decisions, nor the verdict's reasoning: open the windows you choose and judge them yourself.`,
          ...jsonBlock((a.places ?? []).map((p) => ({ id: p.id, at: p.at, window: p.window, given: p.given }))),
        ]
      : []),
    "",
    `## Its rule's block, from the same payload's \`rules\` (the one whose \`rule_id\` is \`${rule}\`)`,
    ...jsonBlock(a.ruleBlock),
    ...(census
      ? [
          "",
          "## The scanner's census summary",
          "The candidate's `kinds_catalogue` above is the scanner's census summary: its same-kind line groups counted by context class and by matched token, and the largest kinds with their representative, members and files, computed with no model involved. Use it to choose what to open. It is nobody's selection, and it names nothing any agent read or concluded.",
        ]
      : []),
    "",
    "## The orientation sheet: NOT quotable evidence",
    ...(a.sheet !== null
      ? [
          "The scanner's orientation sheet for this repository (`orientation.md`, computed with no model involved), pasted below. It is not quotable evidence: quote only the repository's own files. A quotation taken from this sheet is refused by the quote check, because the sheet is not a file of the repository.",
          "",
          "----- orientation sheet begins -----",
          a.sheet.replace(/\n$/, ""),
          "----- orientation sheet ends -----",
        ]
      : ["No orientation sheet was written for this scan (run with `--orientation off`)."]),
    "",
    "## Your reply",
    ch
      ? `Reply exactly as your agent definition's section "Challenge mode" says: \`mode\` is \`challenge\`, and \`grounds\`, on \`overturned\` only, is ${ch.claim === "location" ? "`duty-arises-there`, the ground that section names for a location claim" : ch.claim === "not_applicable" ? "`applies-after-all`, the ground that section names for a finding the first review ruled out" : "one of the three that section names for a claim of the first review"}. This brief adds no field to it.`
      : "Reply exactly as your agent definition says. This brief adds no field to it.",
  ]);
}

/**
 * The claim a challenge seat tries
 * to show wrong, in the record's own parts (the element, the basis and limb, or the ships value) and the line it rests on.
 * Nothing of the first review's reasoning: `second-look.ts` `Challenge` has no field through which it could arrive.
 */
function challengeSection(ch: Challenge): string[] {
  const claim =
    ch.claim === "duty_met"
      ? `The first review said the duty is met at the line below${ch.element ? `, which it said meets this element of the duty: ${JSON.stringify(ch.element)}` : ""}.`
      : ch.claim === "exempt"
        ? `The first review said the code's shape is exempt${ch.exemption ? ` under \`${ch.exemption.basis}\` of the rule's \`legal_basis_refs\` (in the rule's block below), by this limb: ${JSON.stringify(ch.exemption.limb)}` : ""}, at the line below.`
        : ch.claim === "not_applicable"
          ? // Words
            "The first review ruled the finding out as not applicable: that the rule's duty does not reach this code, or that the match is incidental and not what the rule looks for. It named the line below as part of why (or, where it named none, the candidate's first place). The run's shape includes the second check, so a high finding ruled out is looked at once more."
          : ch.claim === "location"
          ? `The second review, which tries to disprove a finding, overturned it on the location ground \`${ch.ground ?? ""}\` (your agent definition's section "Grounds that overturn a finding" defines it): that where the line sits, whether it runs or whether it ships takes this rule's duty away here. The rule opts in (\`"duty_about": "product_runtime"\`), so that ground may stand; the ground's words can be true of the file while the rule's duty still arises there.`
          : `The first review said the finding's decisive place is not part of the shipped product (\`${ch.ships ?? ""}\`), on the line below; the program's ships premise for that file does not say so (only a \`test\` or \`development\` premise does; any other premise is information only).`;
  const by = ch.claim === "location" ? "the second review" : "the first review";
  return [
    "## The claim to challenge",
    claim,
    ...(ch.at ? [`The line it rests on, as ${by} named it:`, ...jsonBlock(ch.at)] : [`${by.charAt(0).toUpperCase()}${by.slice(1)} named no line the program could resolve; the claim stands on its words alone.`]),
    ch.claim === "location"
      ? "If the claim holds, answer `upheld` plainly; the finding then stays not applicable, as the second review placed it, with your answer beside it."
      : "If the claim holds, answer `upheld` plainly; the finding then stays where the first review put it, with your answer beside it.",
  ];
}

/** A silence investigator's brief: the program's text for every part the orchestrator used to write. */
export function silenceBrief(a: {
  scanId: string;
  runId: string;
  id: string;
  rules: Json[];
  suppressed: Json[];
  coverageLimits: unknown;
  setAside: { dir: string; entries: string[] }[];
  profile: unknown;
  profileNote: string;
  sheet: string | null;
  notes: string | null;
}): string {
  const ids = a.rules.map((r) => String(r.rule_id));
  return finish([
    `# Launch brief ${a.id}`,
    "",
    `Written by the scanner (\`legal-scan silence-entries\`) for scan ${a.scanId}, run ${a.runId}, for the rules the orchestrator named: ${ids.join(", ")}.`,
    "You were launched with one line naming this file. Everything this launch hands you is in this brief.",
    LINE_SAFE_SENTENCE,
    "",
    "## What you are",
    `The silence investigator for ${ids.length} rule(s) that ran over this repository and produced no candidate: ${ids.join(", ")}. Return one object per rule, for exactly these.`,
    "",
    "## Leave `.legal/` out of every search",
    "`.legal/` holds this run's working files, the files set aside unread at the start of this run, and the person's own inputs; none of them is the project. Grep leaves `.legal/` out by itself, so never name it in a glob or a path; open no Grep or Glob hit under `.legal/`, and where a search returns a path under `.legal/`, discard the hit and say so in `searched`. Everything from `.legal/` you are entitled to is in this brief, the `suppressed_by_corroboration` entries of your rules included, so you have no reason to open `.legal/findings.json` either.",
    "",
    "## Set aside at the start of this run, unread",
    ...(a.setAside.length > 0
      ? [
          ...a.setAside.map((s) => `- \`${s.dir}/\`: ${s.entries.length > 0 ? s.entries.map((e) => `\`${e}\``).join(", ") : "(empty)"}`),
          "They were found in the tree before this run began and moved aside unread. They are not the project and not this run's: open none of them.",
        ]
      : ["Nothing: no `.legal/set-aside-*` directory exists in this run."]),
    "",
    "## Your rules, as the scan reported them (`rules_without_candidates`)",
    ...jsonBlock(a.rules),
    "",
    "## The lines the scanner already removed for your rules (`suppressed_by_corroboration`)",
    ...(a.suppressed.length > 0
      ? [`All ${a.suppressed.length} entr${a.suppressed.length === 1 ? "y" : "ies"} whose \`rule_id\` is one of your rules.`, ...jsonBlock(a.suppressed)]
      : ["None: no `suppressed_by_corroboration` entry names one of your rules."]),
    "",
    "## The scan's coverage limits: the whole `coverage_limits` block",
    "A construct found only in a tree the scan never read (tests, vendored, build, docs) is a scope fact, not a detector gap; this block is what tells the two apart.",
    ...(a.coverageLimits !== undefined ? jsonBlock(a.coverageLimits) : ["This scan's findings document carries no `coverage_limits` block."]),
    "",
    "## The ScanProfile",
    a.profileNote,
    ...(a.profile !== null && a.profile !== undefined ? jsonBlock(a.profile) : []),
    "",
    "## The orientation sheet, and the searches it has already run",
    ...(a.sheet !== null
      ? [
          "The scanner's orientation sheet for this repository (`orientation.md`), pasted below. Its term table is the record of the searches the sheet has already run. A sheet row is never `apparently_absent` by itself.",
          "",
          "----- orientation sheet begins -----",
          a.sheet.replace(/\n$/, ""),
          "----- orientation sheet ends -----",
        ]
      : ["No orientation sheet was written for this scan (run with `--orientation off`)."]),
    "",
    "## The orchestrator's paragraph about this repository",
    ...(a.notes !== null ? ["----- paragraph begins -----", a.notes.replace(/\n$/, ""), "----- paragraph ends -----"] : ["Not written for this run."]),
    "",
    "## Your reply",
    `Reply exactly as your agent definition says: one object per rule, for ${ids.join(", ")}. This brief adds no field to it.`,
  ]);
}

// ------------------------------------------------------------------------------------------------
// THE ENTRIES. Pure: they take the list and the texts, and return entries and briefs or the refusals.
// ------------------------------------------------------------------------------------------------

export interface SourceText {
  path: string;
  text: string;
}

export type Built = { ok: true; entries: LaterEntry[]; briefs: Map<string, string>; appended: Appended; held: Held[]; covered?: { finding_id: string; entry: string }[] } | { ok: false; refused: string[] };

function entryFor(
  list: LaunchList,
  role: LaterRole,
  id: string,
  findingIds: string[],
  ruleIds: string[],
  record: string,
  captureKey: string | null,
  madeFrom: MadeFrom[],
  briefsDir: string,
  brief: string,
  description: string,
): LaterEntry {
  const briefPath = join(briefsDir, `${id}.md`);
  // The background form, as every listed launch has it (launch-plan.ts `LAUNCH_FORM`): the launch gate lets no
  // other form through, because a foreground launch's result, which binds the entry to its seat, arrives only
  // after the seat has answered. The entry
  // states it as `launch`, beside the input,: no field of the input says it in every session.
  const agentInput: AgentInput = {
    subagent_type: role === "refuter" ? REFUTER_AGENT : SILENCE_AGENT,
    description,
    // Cost step 1, B1(a): a brief longer than one Read is read in the ranges the line lists, all in one message.
    // W6: a short fixed text naming the brief, as launch-plan.ts writes an adjudicator's.
    prompt: `${briefReadWords(briefPath, brief)} and follow it.`,
    model: list.model,
  };
  if (agentInput.prompt.includes("\n") || agentInput.prompt.length > READ_LINE_LIMIT) throw new Error(`the launch prompt of ${id} is not one line within ${READ_LINE_LIMIT} characters`);
  return {
    id,
    order: 0,
    wave: 0,
    role,
    after: [],
    finding_ids: findingIds,
    rule_ids: ruleIds,
    record,
    capture_key: captureKey,
    made_from: madeFrom,
    brief_path: briefPath,
    brief_sha256: sha256(brief),
    launch: LAUNCH_FORM,
    agent_input: agentInput,
    agent_input_sha256: sha256(canonicalJson(agentInput)),
  };
}

const parseJson = (s: SourceText): { ok: true; value: unknown } | { ok: false; problem: string } => {
  try {
    return { ok: true, value: JSON.parse(s.text) };
  } catch (e) {
    return { ok: false, problem: `${s.path} is not JSON (${(e as Error).message})` };
  }
};

/** The `finding_id`s a captured adjudicator record classes `violation_candidate`, and nothing else of it. */
export function violationIds(record: SourceText): { ok: true; ids: string[] } | { ok: false; problem: string } {
  const parsed = parseJson(record);
  if (!parsed.ok) return parsed;
  if (!Array.isArray(parsed.value)) return { ok: false, problem: `${record.path} is not a JSON array of verdicts` };
  const ids: string[] = [];
  for (const v of parsed.value) if (isObject(v) && v.verdict === "violation_candidate" && str(v.finding_id)) ids.push(v.finding_id as string);
  return { ok: true, ids };
}

// `examines` and `currentExaminations` live in launch-list-file.ts, beside the superseded refuter entries
// the relaunch rule reads without loading this module; they are re-exported here for the readers that import them here.
export { examines, currentExaminations };

/** The records (paths under `.legal/`) examined for refuters as their bytes are now (`currentExaminations`). */
export function examinedRecords(list: LaunchList, legalDir: string): Set<string> {
  return new Set(currentExaminations(list, legalDir).map((a) => a.record as string));
}

/** The refuter entries for one captured adjudicator record, whose seat is `source`. */
export function buildRefuterEntries(
  list: LaunchList,
  a: {
    source: LaunchEntry;
    record: SourceText;
    recordRel: string;
    payload: SourceText;
    sheet: SourceText | null;
    briefsDir: string;
    /**
     * Verification A, VA-3: the findings document, where a candidate's `reading_plan` lives (every payload copy drops
     * it, context.ts): only whether each candidate is read place by place is read from it.
     */
    findings?: SourceText;
  },
): Built {
  const refused: string[] = [];
  // Examined as its bytes are now (`examines`); a record replaced at the same path is examined again.
  const examined = (list.appended ?? []).filter((x) => examines(x, a.recordRel, a.record.text)).at(-1);
  if (examined) refused.push(`${a.recordRel} was already examined for refuters: it gave ${examined.entries.length > 0 ? examined.entries.join(", ") : "no entry"}`);
  const ids = violationIds(a.record);
  if (!ids.ok) return { ok: false, refused: [...refused, ids.problem] };
  const payload = parseJson(a.payload);
  if (!payload.ok) return { ok: false, refused: [...refused, payload.problem] };
  const pv = isObject(payload.value) ? payload.value : {};
  const candidates = (Array.isArray(pv.candidates) ? pv.candidates : []).filter(isObject);
  // VA-3: the candidates the findings document plans place by place (a payload's candidate carries no plan).
  const placeRead = new Set<string>();
  const fdoc = a.findings ? parseJson(a.findings) : null;
  if (fdoc?.ok && isObject(fdoc.value) && Array.isArray(fdoc.value.candidates)) {
    for (const c of fdoc.value.candidates.filter(isObject)) if (isObject(c.reading_plan) && c.reading_plan.unit === "place" && typeof c.finding_id === "string") placeRead.add(c.finding_id);
  }
  const rules = (Array.isArray(pv.rules) ? pv.rules : []).filter(isObject);
  // Only the ordinary pass's entries: a second look of the same finding is another seat.
  const listed = new Map<string, string>();
  for (const e of list.entries) if (e.role === "refuter" && !isChallengeEntry(e)) for (const f of e.finding_ids) listed.set(f, e.id);
  const entries: LaterEntry[] = [];
  const briefs = new Map<string, string>();
  const madeFrom: MadeFrom[] = [
    { what: "the captured adjudicator record: only the finding_ids it classes violation_candidate are read from it", path: a.record.path, sha256: sha256(a.record.text) },
    { what: "the payload the verdict seat was handed: the candidate and its rule's block", path: a.payload.path, sha256: sha256(a.payload.text) },
    ...(a.sheet ? [{ what: "the orientation sheet, pasted as not quotable", path: a.sheet.path, sha256: sha256(a.sheet.text) }] : []),
  ];
  // A problem with one candidate holds that candidate only: the record's other candidates still get their
  // entries, and every held candidate is named with its reason.
  const held: Held[] = [];
  const hold = (finding_id: string, reason: string): void => {
    held.push({ finding_id, reason });
  };
  const times = new Map<string, number>();
  for (const fid of ids.ids) times.set(fid, (times.get(fid) ?? 0) + 1);
  for (const [fid, n] of times) {
    if (n > 1) {
      hold(fid, `it is classed violation_candidate ${n} times in ${a.recordRel}, so which object is its verdict is not clear`);
      continue;
    }
    const already = listed.get(fid);
    if (already) {
      hold(fid, alreadyHasEntry(already));
      continue;
    }
    const candidate = candidates.find((c) => c.finding_id === fid);
    if (!candidate) {
      hold(fid, `it is not a candidate of ${a.payload.path}, the payload the seat of ${a.recordRel} was handed`);
      continue;
    }
    if (candidate.group_part !== undefined) {
      hold(fid, "it is one part of a split group (group_part): SKILL.md step 5 refutes the group once, after every part has returned, and this command does not build a group refutation");
      continue;
    }
    const rule = str(candidate.rule_id);
    const ruleBlock = rules.find((r) => r.rule_id === rule);
    if (!rule || !ruleBlock) {
      hold(fid, `the payload ${a.payload.path} holds no rules block for its rule ${rule ?? "(none)"}`);
      continue;
    }
    const id = refuterEntryId(fid);
    const target = recordPathFor("refuter", { ids: [fid] });
    if (target.problem !== undefined) {
      hold(fid, target.problem);
      continue;
    }
    let brief: string;
    try {
      // F4 (R3): a place-plan candidate's refuter is given its place list, from the payloads of the seats that held its places.
      let places: RefuterPlace[] | undefined;
      if ((isObject(candidate.reading_plan) && candidate.reading_plan.unit === "place") || placeRead.has(fid)) {
        if (a.findings && placeRead.has(fid) && !madeFrom.some((m) => m.path === a.findings?.path)) {
          madeFrom.push({ what: "the findings document: only which candidates are read place by place (their reading plan)", path: a.findings.path, sha256: sha256(a.findings.text) });
        }
        const held = list.entries.filter((e) => e.finding_ids.includes(fid) && e.role !== "refuter" && e.role !== "silence-investigator").map((e) => (e as { payload_path?: string }).payload_path).filter((p): p is string => typeof p === "string");
        const docs: unknown[] = [payload.value];
        for (const path of [...new Set(held)]) {
          try {
            const text = readRegularFile(path, "utf8");
            docs.push(JSON.parse(text));
            madeFrom.push({ what: "a payload of a seat that held this candidate's places: the place ids, lines and windows only", path, sha256: sha256(text) });
          } catch {
            // skipped: refuterPlacesOf lists a place of no payload by its location
          }
        }
        places = refuterPlacesOf(candidate, docs);
      }
      brief = refuterBrief({ scanId: list.scan_id, runId: list.run_id, id, candidate, ruleBlock, sheet: a.sheet ? a.sheet.text : null, ...(places ? { places } : {}) });
    } catch (e) {
      hold(fid, `no line-safe brief could be written (${(e as Error).message})`);
      continue;
    }
    const entry = entryFor(list, "refuter", id, [fid], [rule], target.rel, null, madeFrom, a.briefsDir, brief, `Refute ${fid} (${rule})`);
    entry.after = [a.source.id];
    entries.push(entry);
    briefs.set(id, brief);
  }
  if (refused.length > 0) return { ok: false, refused };
  return {
    ok: true,
    entries,
    briefs,
    held,
    appended: { command: "refuter-entries", record: a.recordRel, record_sha256: sha256(a.record.text), entries: entries.map((e) => e.id), ...(held.length > 0 ? { held } : {}) },
  };
}

/**
 * THE SECOND LOOK'S ENTRIES for one captured adjudicator record (design-not-violations.md
 * section 2.5 item 5, the owner's answer to its question 3 of 2026-11-02), appended in every run shape: one `legal-refuter` entry in challenge mode for each finding of the record that
 * `second-look.ts` `challengeOf` says the first review took out of the count on its own word (high; `duty_met` or `exempt`,
 * or not shipped where the build files do not say so too). Every other finding of the record gets nothing and is not
 * held: no second look is due for it.
 *
 * The brief is the refuter's (`refuterBrief`), with the claim and the line it rests on beside it and nothing else of the
 * record: the record is read for the verdict word and the standing block's parts that make the claim, and the brief
 * builder is handed only the `Challenge` made of them. The record's answer is captured as a refuter's, to
 * `verdicts/refutation/challenge-<finding_id>.json` (`recordPathFor`), and the assembly reads it by its `mode`. Where the run
 * has the second check, the ordinary refuter does not stand in for it: it tries to show the candidate is no violation, the
 * same direction as the claim, so an upheld refutation would leave a finding taken out of the count on the first review's
 * word alone.
 */
export function buildChallengeEntries(
  list: LaunchList,
  a: { source: LaunchEntry; record: SourceText; recordRel: string; payload: SourceText; sheet: SourceText | null; briefsDir: string; findings: SourceText; secondCheck?: boolean },
): Built {
  const refused: string[] = [];
  const examined = (list.appended ?? []).filter((x) => examines(x, a.recordRel, a.record.text)).at(-1);
  if (examined) refused.push(`${a.recordRel} was already examined for refuters: it gave ${examined.entries.length > 0 ? examined.entries.join(", ") : "no entry"}`);
  const parsed = parseJson(a.record);
  if (!parsed.ok) return { ok: false, refused: [...refused, parsed.problem] };
  if (!Array.isArray(parsed.value)) return { ok: false, refused: [...refused, `${a.record.path} is not a JSON array of verdicts`] };
  const payload = parseJson(a.payload);
  if (!payload.ok) return { ok: false, refused: [...refused, payload.problem] };
  const fdoc = parseJson(a.findings);
  if (!fdoc.ok) return { ok: false, refused: [...refused, fdoc.problem] };
  const pv = isObject(payload.value) ? payload.value : {};
  const candidates = (Array.isArray(pv.candidates) ? pv.candidates : []).filter(isObject);
  const rules = (Array.isArray(pv.rules) ? pv.rules : []).filter(isObject);
  const fv = isObject(fdoc.value) ? fdoc.value : {};
  const documented = new Map((Array.isArray(fv.candidates) ? fv.candidates : []).filter(isObject).map((c) => [str(c.finding_id) ?? "", c] as const));
  const premises = premisesOfFindings(fv);
  // The pages the premise classes as
  // documentation, which a seat's own `documentation` reaches whole: the capture reads them as the assembly does.
  const documentationPages = documentationPagesOf(fv);
  // Only second looks: where the run has the second check, the finding's
  // ordinary refuter entry is another seat, asked another question, and never stands in for this one.
  const listed = new Map<string, string>();
  for (const e of list.entries) if (isChallengeEntry(e)) for (const f of e.finding_ids) listed.set(f, e.id);
  const madeFrom: MadeFrom[] = [
    {
      what: a.secondCheck
        ? "the captured adjudicator record: for each violation_candidate, its verdict word and the parts of its standing block that make the claim (status, element or exemption, ships, decisive, and the line they name); for each not_applicable, its verdict word and the line it quoted as part of why the finding does not hold; nothing else of it"
        : "the captured adjudicator record: for each violation_candidate, its verdict word and the parts of its standing block that make the claim (status, element or exemption, ships, decisive, and the line they name); nothing else of it",
      path: a.record.path,
      sha256: sha256(a.record.text),
    },
    { what: "the payload the verdict seat was handed: the candidate and its rule's block", path: a.payload.path, sha256: sha256(a.payload.text) },
    { what: "the findings document: each candidate's level, locations and rule role, and the scan's ships premises", path: a.findings.path, sha256: sha256(a.findings.text) },
    ...(a.sheet ? [{ what: "the orientation sheet, pasted as not quotable", path: a.sheet.path, sha256: sha256(a.sheet.text) }] : []),
  ];
  const held: Held[] = [];
  const entries: LaterEntry[] = [];
  const briefs = new Map<string, string>();
  const byId = new Map<string, Json[]>();
  // In a shape with the second check, a finding the seat
  // ruled out (`not_applicable`) is read too: a high one gets a second look (`second-look.ts` `dismissalClaimOf`).
  const read = (v: Json): boolean => v.verdict === "violation_candidate" || (a.secondCheck === true && v.verdict === "not_applicable");
  for (const v of parsed.value) if (isObject(v) && read(v) && str(v.finding_id)) byId.set(v.finding_id as string, [...(byId.get(v.finding_id as string) ?? []), v]);
  for (const [fid, objects] of byId) {
    const candidate = candidates.find((c) => c.finding_id === fid);
    const whole = documented.get(fid) ?? candidate;
    const rule = str(candidate?.rule_id) ?? str(whole?.rule_id);
    const ruleBlock = rules.find((r) => r.rule_id === rule);
    const role = str(ruleBlock?.finding_role) ?? str(whole?.finding_role) ?? undefined;
    // Only a rule that
    // declares `duty_about: product_runtime` may take row 4; with no declaration nothing is passed and the row never applies.
    const dutyAbout = str(ruleBlock?.duty_about) ?? str(whole?.duty_about) ?? undefined;
    // WP4's question kinds, so a "check your answer" finding (row 5) is not due one.
    const declaredInapplicable = whole ? declaredInapplicableOf(declarationSource(), whole.declared_inapplicable_preconditions) : [];
    const due = whole ? objects.map((v) => challengeOf({ record: v, candidate: whole, ...(role ? { role } : {}), ...(dutyAbout ? { dutyAbout } : {}), declaredInapplicable, ...(premises ? { premises } : {}), ...(documentationPages ? { documentationPages } : {}), secondCheck: a.secondCheck === true })) : [];
    const challenge = due.find((c) => c !== null) ?? null;
    if (challenge === null) continue;
    if (objects.length > 1) {
      held.push({ finding_id: fid, reason: `it is classed ${objects.length} times in ${a.recordRel}, so which object's claim is the first review's is not clear: no second look is appended for it` });
      continue;
    }
    const already = listed.get(fid);
    if (already) {
      held.push({ finding_id: fid, reason: alreadyHasEntry(already) });
      continue;
    }
    if (!candidate) {
      held.push({ finding_id: fid, reason: `it is not a candidate of ${a.payload.path}, the payload the seat of ${a.recordRel} was handed` });
      continue;
    }
    if (candidate.group_part !== undefined) {
      held.push({ finding_id: fid, reason: "it is one part of a split group (group_part): its verdict is made of every part's, and this command does not build a second look over a group" });
      continue;
    }
    if (!rule || !ruleBlock) {
      held.push({ finding_id: fid, reason: `the payload ${a.payload.path} holds no rules block for its rule ${rule ?? "(none)"}` });
      continue;
    }
    const id = challengeEntryId(fid);
    const target = recordPathFor("refuter", { ids: [fid], challenge: true });
    if (target.problem !== undefined) {
      held.push({ finding_id: fid, reason: target.problem });
      continue;
    }
    let brief: string;
    try {
      const placeRead = (isObject(candidate.reading_plan) && candidate.reading_plan.unit === "place") || (isObject(whole?.reading_plan) && (whole?.reading_plan as Json).unit === "place");
      let places: RefuterPlace[] | undefined;
      if (placeRead) {
        const docs: unknown[] = [payload.value];
        const heldBy = list.entries.filter((e) => e.finding_ids.includes(fid) && e.role !== "refuter" && e.role !== "silence-investigator").map((e) => (e as { payload_path?: string }).payload_path).filter((p): p is string => typeof p === "string");
        for (const path of [...new Set(heldBy)]) {
          try {
            const text = readRegularFile(path, "utf8");
            docs.push(JSON.parse(text));
            if (!madeFrom.some((m) => m.path === path)) madeFrom.push({ what: "a payload of a seat that held this candidate's places: the place ids, lines and windows only", path, sha256: sha256(text) });
          } catch {
            // skipped: refuterPlacesOf lists a place of no payload by its location
          }
        }
        places = refuterPlacesOf(candidate, docs);
      }
      brief = refuterBrief({ scanId: list.scan_id, runId: list.run_id, id, candidate, ruleBlock, sheet: a.sheet ? a.sheet.text : null, challenge, ...(places ? { places } : {}) });
    } catch (e) {
      held.push({ finding_id: fid, reason: `no line-safe brief could be written (${(e as Error).message})` });
      continue;
    }
    const entry = entryFor(list, "refuter", id, [fid], [rule], target.rel, null, madeFrom, a.briefsDir, brief, `Second look at ${fid} (${rule})`);
    entry.after = [a.source.id];
    entry.mode = CHALLENGE_MODE;
    entry.claim = challenge.claim;
    entries.push(entry);
    briefs.set(id, brief);
  }
  if (refused.length > 0) return { ok: false, refused };
  return {
    ok: true,
    entries,
    briefs,
    held,
    appended: { command: "refuter-entries", record: a.recordRel, record_sha256: sha256(a.record.text), entries: entries.map((e) => e.id), ...(held.length > 0 ? { held } : {}) },
  };
}

/**
 * THE SECOND LOOK AT A LOCATION OVERTURN, for one captured ordinary refuter
 * record: one `legal-refuter` entry in challenge mode for each finding the record overturns on a location ground of a rule
 * that opts in (`second-look.ts` `locationChallengeOf`), at every level, waiting on the refuter's own entry. Its brief is the
 * refuter's (`refuterBrief`), with the ground and the first line the refuter quoted beside it and nothing else of the record.
 * A finding that already has a second look (the first review's claim) gets no other: that look decides it. Only a run with
 * the ordinary refuter reaches this, so a run in the recommended shape (`refute_later`) is unchanged.
 */
export function buildLocationLookEntries(
  list: LaunchList,
  a: { source: LaterEntry; record: SourceText; recordRel: string; payload: SourceText; sheet: SourceText | null; briefsDir: string; findings: SourceText; superseded?: ReadonlyMap<string, string> },
): Built {
  const refused: string[] = [];
  const examined = (list.appended ?? []).filter((x) => examines(x, a.recordRel, a.record.text)).at(-1);
  if (examined) refused.push(`${a.recordRel} was already examined for second looks: it gave ${examined.entries.length > 0 ? examined.entries.join(", ") : "no entry"}`);
  const parsed = parseJson(a.record);
  if (!parsed.ok) return { ok: false, refused: [...refused, parsed.problem] };
  const payload = parseJson(a.payload);
  if (!payload.ok) return { ok: false, refused: [...refused, payload.problem] };
  const fdoc = parseJson(a.findings);
  if (!fdoc.ok) return { ok: false, refused: [...refused, fdoc.problem] };
  const pv = isObject(payload.value) ? payload.value : {};
  const candidates = (Array.isArray(pv.candidates) ? pv.candidates : []).filter(isObject);
  const rules = (Array.isArray(pv.rules) ? pv.rules : []).filter(isObject);
  const fv = isObject(fdoc.value) ? fdoc.value : {};
  const documented = new Map((Array.isArray(fv.candidates) ? fv.candidates : []).filter(isObject).map((c) => [str(c.finding_id) ?? "", c] as const));
  const listed = new Map<string, string>();
  for (const e of list.entries) if (isChallengeEntry(e)) for (const f of e.finding_ids) listed.set(f, e.id);
  const madeFrom: MadeFrom[] = [
    { what: "the captured refuter record: for each overturn, its outcome, its ground and the first line it quoted; nothing else of it", path: a.record.path, sha256: sha256(a.record.text) },
    { what: "the payload the verdict seat was handed: the candidate and its rule's block", path: a.payload.path, sha256: sha256(a.payload.text) },
    { what: "the findings document: each candidate's level, locations and rule's duty_about", path: a.findings.path, sha256: sha256(a.findings.text) },
    ...(a.sheet ? [{ what: "the orientation sheet, pasted as not quotable", path: a.sheet.path, sha256: sha256(a.sheet.text) }] : []),
  ];
  const held: Held[] = [];
  const covered: { finding_id: string; entry: string }[] = [];
  const entries: LaterEntry[] = [];
  const briefs = new Map<string, string>();
  const objects = (Array.isArray(parsed.value) ? parsed.value : [parsed.value]).filter(isObject);
  for (const r of objects) {
    const fid = str(r.finding_id);
    if (!fid || !a.source.finding_ids.includes(fid)) continue;
    const candidate = candidates.find((c) => c.finding_id === fid);
    const whole = documented.get(fid) ?? candidate;
    const rule = str(candidate?.rule_id) ?? str(whole?.rule_id);
    const ruleBlock = rules.find((x) => x.rule_id === rule);
    // The rule's `duty_about` as the findings document carries it, which is what the assembly reads (locationOverturnRefused).
    const challenge = whole ? locationChallengeOf({ refutation: r, candidate: whole }) : null;
    if (challenge === null) continue;
    // The first review's claim already has a second look: it decides this finding (assemble-report.ts, the two passes).
    const has = listed.get(fid);
    /* A second look that is superseded decides nothing. It may have been made from this record before the record was
     * replaced at its path, from the adjudicator's record before that one was replaced, or for a refuter entry that no
     * longer stands, so the reason is the one the supersession rule gives (launch-list-file.ts `standingRefuters`, the
     * reason the assembly prints too), never a guess at which. A finding has one second-look entry in a run (its id and
     * its answer's file are the finding's), so no other is written: the look is held, with why, and the report shows it as
     * not answered. */
    const why = has === undefined ? undefined : a.superseded?.get(has);
    if (why !== undefined) {
      held.push({ finding_id: fid, reason: `its second look ${has} is superseded and decides nothing, because ${why}; a finding has one second-look entry in a run, so no other could be written` });
      continue;
    }
    if (has !== undefined) {
      covered.push({ finding_id: fid, entry: has });
      continue;
    }
    if (!candidate || !rule || !ruleBlock) {
      held.push({ finding_id: fid, reason: `the payload ${a.payload.path} holds no candidate or rules block for it, so no second look at its location overturn could be written` });
      continue;
    }
    const id = challengeEntryId(fid);
    const target = recordPathFor("refuter", { ids: [fid], challenge: true });
    if (target.problem !== undefined) {
      held.push({ finding_id: fid, reason: target.problem });
      continue;
    }
    let brief: string;
    try {
      brief = refuterBrief({ scanId: list.scan_id, runId: list.run_id, id, candidate, ruleBlock, sheet: a.sheet ? a.sheet.text : null, challenge });
    } catch (e) {
      held.push({ finding_id: fid, reason: `no line-safe brief could be written (${(e as Error).message})` });
      continue;
    }
    const entry = entryFor(list, "refuter", id, [fid], [rule], target.rel, null, madeFrom, a.briefsDir, brief, `Second look at ${fid} (${rule})`);
    entry.after = [a.source.id];
    entry.mode = CHALLENGE_MODE;
    entry.claim = challenge.claim;
    entries.push(entry);
    briefs.set(id, brief);
    listed.set(fid, id);
  }
  if (refused.length > 0) return { ok: false, refused };
  return {
    ok: true,
    entries,
    briefs,
    held,
    ...(covered.length > 0 ? { covered } : {}),
    appended: { command: "refuter-entries", record: a.recordRel, record_sha256: sha256(a.record.text), entries: entries.map((e) => e.id), ...(held.length > 0 ? { held } : {}) },
  };
}

/** The one silence entry for the group of silent rules the orchestrator named. */
export function buildSilenceEntry(
  list: LaunchList,
  a: { ruleIds: string[]; findings: SourceText; runContext: SourceText; sheet: SourceText | null; notes: SourceText | null; setAside: { dir: string; entries: string[] }[]; briefsDir: string },
): Built {
  const refused: string[] = [];
  const findings = parseJson(a.findings);
  if (!findings.ok) return { ok: false, refused: [findings.problem] };
  const fv = isObject(findings.value) ? findings.value : {};
  if (fv.scan_id !== list.scan_id) refused.push(`${a.findings.path} is scan ${String(fv.scan_id)}, and the launch list is scan ${list.scan_id}`);
  const silent = (Array.isArray(fv.rules_without_candidates) ? fv.rules_without_candidates : []).filter(isObject);
  const inEntry = new Map<string, string>();
  for (const e of list.entries) if (e.role === "silence-investigator") for (const r of e.rule_ids) inEntry.set(r, e.id);
  if (a.ruleIds.length === 0) refused.push("no rule was named");
  const seen = new Set<string>();
  const rows: Json[] = [];
  for (const r of a.ruleIds) {
    if (seen.has(r)) {
      refused.push(`${r} is named twice in this request`);
      continue;
    }
    seen.add(r);
    const row = silent.find((x) => x.rule_id === r);
    if (!row) refused.push(`${r} is not a rule this scan reported silent (findings.json rules_without_candidates)`);
    else if (inEntry.has(r)) refused.push(`${r} is already in the silence entry ${inEntry.get(r)}`);
    else rows.push(row);
  }
  const ctx = parseJson(a.runContext);
  if (!ctx.ok) refused.push(ctx.problem);
  if (refused.length > 0) return { ok: false, refused };
  const context = joinLongText(ctx.ok ? ctx.value : null);
  const cv = isObject(context) ? context : {};
  const suppressed = (Array.isArray(fv.suppressed_by_corroboration) ? fv.suppressed_by_corroboration : []).filter((s) => isObject(s) && seen.has(String(s.rule_id))) as Json[];
  const ruleIds = rows.map((r) => String(r.rule_id));
  const id = silenceEntryId(ruleIds);
  const target = recordPathFor("silence-investigator", { key: id, ids: ruleIds });
  if (target.problem !== undefined) return { ok: false, refused: [target.problem] };
  let brief: string;
  try {
    brief = silenceBrief({
      scanId: list.scan_id,
      runId: list.run_id,
      id,
      rules: rows,
      suppressed,
      coverageLimits: fv.coverage_limits,
      setAside: a.setAside,
      profile: cv.profile ?? null,
      profileNote: str(cv.profile_note) ?? "The run context names no ScanProfile note.",
      sheet: a.sheet ? a.sheet.text : null,
      notes: a.notes ? a.notes.text : null,
    });
  } catch (e) {
    return { ok: false, refused: [`no line-safe brief could be written (${(e as Error).message})`] };
  }
  const madeFrom: MadeFrom[] = [
    { what: "the scan's findings document: the rules' rows, their suppressed_by_corroboration entries and the coverage_limits block", path: a.findings.path, sha256: sha256(a.findings.text) },
    { what: "the run context: the ScanProfile", path: a.runContext.path, sha256: sha256(a.runContext.text) },
    ...(a.sheet ? [{ what: "the orientation sheet", path: a.sheet.path, sha256: sha256(a.sheet.text) }] : []),
    ...(a.notes ? [{ what: "the orchestrator's paragraph about this repository", path: a.notes.path, sha256: sha256(a.notes.text) }] : []),
  ];
  const entry = entryFor(list, "silence-investigator", id, [], ruleIds, target.rel, id, madeFrom, a.briefsDir, brief, `Silence investigation of ${ruleIds.length} rule(s): ${ruleIds.join(", ")}`);
  return { ok: true, entries: [entry], briefs: new Map([[id, brief]]), held: [], appended: { command: "silence-entries", rule_ids: ruleIds, entries: [id] } };
}

/** `appendEntries` lives with the list's one writer (launch-list-file.ts), which a new attempt's list carries through too. */
export { appendEntries } from "./launch-list-file.js";

// ------------------------------------------------------------------------------------------------
// THE COMMANDS
// ------------------------------------------------------------------------------------------------

export const LATER_EXIT = { written: 0, refused: 1, unreadable: 2, locked: 3 } as const;

/** The lock is the list's own (`launch-list-file.ts`); re-exported for the callers that took it from here. */
export { withListLock } from "./launch-list-file.js";

interface Paths {
  legalDir: string;
  launchDir: string;
  listPath: string;
}

const pathsOf = (opts: Record<string, unknown>): Paths => {
  const legalDir = resolve(typeof opts.legal === "string" ? opts.legal : ".legal");
  const launchDir = resolve(typeof opts.launchDir === "string" ? opts.launchDir : join(legalDir, "launch"));
  return { legalDir, launchDir, listPath: join(launchDir, "launch-list.json") };
};

type Outcome = { exit: number; lines: string[] };
const exitOf = (r: { exit: "unreadable" | "refused" }): number => (r.exit === "unreadable" ? LATER_EXIT.unreadable : LATER_EXIT.refused);
const refusal = (problem: string, exit: number): Outcome => ({ exit, lines: [`refused: ${problem}. Nothing was written.`] });

/** A file a seat was handed, as the file another step wrote (not the program's reading copy of it), with the sha256 the pre-launch step recorded. */
const originalOf = (r: SeatRead): { path: string; sha256: string | undefined } => (r.copied_from ? { path: r.copied_from.path, sha256: r.copied_from.sha256 } : { path: r.path, sha256: r.sha256 });

/**
 * The pre-launch step's record, on the list itself, of a file every seat of the run is handed, or null
 * where it named none. A list with no verdict entry has it too.
 */
function runRead(list: LaunchList, role: ReadRole): SeatRead | null {
  return (list.run_reads ?? []).find((r) => r.role === role) ?? null;
}

/**
 * `body` under the list's lock, a lock refusal exiting 3 by name. A launch directory that does not exist
 * is refused as unreadable before any lock is taken: there is no list to append to.
 */
function underListLock(p: Paths, body: () => Outcome): Outcome {
  if (!existsSync(p.launchDir)) {
    return refusal(`the launch directory ${p.launchDir} does not exist, so there is no launch list: it is written by the pre-launch step (\`legal-scan adjudicate --shape\`)`, LATER_EXIT.unreadable);
  }
  const r = withListLock(p.listPath, body);
  return "locked" in r ? refusal(r.locked, LATER_EXIT.locked) : r;
}

/** The findings document the list was made from, read back only while it is the document the pre-launch step read. */
function findingsOf(list: LaunchList, listPath: string): ReadBack<Buffer> {
  if (!list.findings) {
    return { ok: false, exit: "refused", problem: `${listPath} records no findings document (the pre-launch step records the one it read, with its sha256): run the pre-launch step (\`legal-scan adjudicate --shape\`) again` };
  }
  const read = readRecorded("the findings document", list.findings.path, list.findings.sha256, "the launch list's `findings` (recorded by the pre-launch step)");
  // And only while it is the document the scan wrote (log-digest.ts).
  const changed = read.ok ? findingsChangedProblem(list.findings.path, read.value) : null;
  return changed === null ? read : { ok: false, exit: "refused", problem: changed };
}

/**
 * The payload a verdict seat was handed, read back only while it has the sha256 the scan recorded for it
 * when it wrote it: the findings document's `context_payloads` row, "which is what a consumer checks"
 * (`context.ts`).
 */
function payloadOf(findingsPath: string, findingsText: string, source: LaunchEntry): ReadBack<Buffer> {
  let rows: unknown[];
  try {
    const fv = JSON.parse(findingsText) as { context_payloads?: { payloads?: unknown } };
    rows = Array.isArray(fv?.context_payloads?.payloads) ? fv.context_payloads.payloads : [];
  } catch (e) {
    return { ok: false, exit: "unreadable", problem: `${findingsPath} is not JSON (${(e as Error).message})` };
  }
  // The entry's key, by the one rule (launch-plan.ts captureKeyOf): for a verdict entry, its payload's key.
  const key = captureKeyOf(source);
  const row = rows.find((r) => isObject(r) && key !== null && r.key === key) as Json | undefined;
  if (!row || typeof row.path !== "string") {
    return { ok: false, exit: "refused", problem: `the findings document ${findingsPath} has no context_payloads row for ${key}, the payload of ${source.id}` };
  }
  const at = resolve(dirname(findingsPath), row.path);
  if (at !== resolve(source.payload_path)) {
    return { ok: false, exit: "refused", problem: `the list names ${source.payload_path} as the payload of ${source.id}, and the findings document's row for ${key} names ${at}` };
  }
  return readRecorded("the payload", source.payload_path, typeof row.sha256 === "string" ? row.sha256 : null, `the findings document's context_payloads row for ${key} (recorded by the scan when it wrote the payload)`);
}

/**
 * Append through THE ONE LIST WRITER (`replaceLaunchList`, launch-list-file.ts; relay integration part B, item 2): it
 * writes the briefs aside, records their digests, and moves them into place and replaces the list only while the list
 * is still the one read under the lock (`listSha`) and the run is still active; otherwise nothing is written.
 */
function commit(p: Paths, list: LaunchList, listSha: string, built: Extract<Built, { ok: true }>, writtenBy: string): { ok: true; next: LaunchList } | { ok: false; problem: string } {
  const next = appendEntries(list, built.entries, built.appended);
  const files = new Map([...built.briefs].map(([id, text]): [string, string] => [join(p.launchDir, "briefs", `${id}.md`), text]));
  try {
    replaceLaunchList(p.listPath, next, writtenBy, files, listSha);
  } catch (e) {
    return { ok: false, problem: (e as Error).message };
  }
  return { ok: true, next };
}

function report(next: LaunchList, added: string[], held: Held[], head: string): string[] {
  const lines = [head];
  for (const id of added) {
    const e = next.entries.find((x) => x.id === id) as LaterEntry;
    lines.push(`  ${e.id} wave ${e.wave}: ${e.agent_input.description}; its answer is captured to ${e.record}${captureKeyOf(e) ? ` (--key ${captureKeyOf(e)})` : ""}`);
    lines.push(`    agent_input: ${JSON.stringify(e.agent_input)}`);
  }
  for (const h of held) lines.push(`  held, no entry: ${JSON.stringify(h.finding_id)} - ${h.reason}`);
  lines.push(`The list now holds ${next.entries.length} entr${next.entries.length === 1 ? "y" : "ies"}. Launch each new entry's agent_input exactly as written.`);
  return lines;
}

interface LedgerLine {
  role: string;
  key: string | null;
  sha256: string;
  reply: { file: string; sha256: string; json_start: number; json_end: number } | null;
  /** 2 where the record is the program's, made from the seat's decisions; its answer's digest. */
  form?: 2;
  answer_sha256?: string;
}

/** The latest ledger line for `rel`, or why there is none. */
function ledgerEntryFor(legalDir: string, rel: string): LedgerLine | string {
  const ledger = join(legalDir, LEDGER_FILE);
  // Through the one reader (program-file.ts, item 4): regular-file checks only; the ledger's lines carry the digests.
  const got = readProgramFile("the capture ledger", ledger);
  if (!got.ok) {
    return got.code === "ENOENT"
      ? `${rel} is not a record the capture command wrote: there is no capture ledger (${ledger}). Refuter entries are made only from a captured record`
      : `${rel} cannot be checked against the capture ledger: ${got.problem}`;
  }
  const text = got.value.toString("utf8");
  let found: LedgerLine | null = null;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const e = JSON.parse(line) as { file?: unknown; role?: unknown; key?: unknown; sha256?: unknown; form?: unknown; answer_sha256?: unknown; reply?: { file?: unknown; sha256?: unknown; json_start?: unknown; json_end?: unknown } };
      if (e.file !== rel || typeof e.role !== "string" || typeof e.sha256 !== "string") continue;
      const r = e.reply;
      const reply =
        r && typeof r.file === "string" && typeof r.sha256 === "string" && Number.isInteger(r.json_start) && Number.isInteger(r.json_end)
          ? { file: r.file, sha256: r.sha256, json_start: r.json_start as number, json_end: r.json_end as number }
          : null;
      found = {
        role: e.role,
        key: typeof e.key === "string" ? e.key : null,
        sha256: e.sha256,
        reply,
        ...(e.form === 2 && typeof e.answer_sha256 === "string" ? { form: 2 as const, answer_sha256: e.answer_sha256 } : {}),
      };
    } catch {
      // An unreadable ledger line names no record; `verdict-capture --check-ledger` reports it.
    }
  }
  return found ?? `${rel} is not a record the capture command wrote: no line of ${ledger} names it. Refuter entries are made only from a captured record`;
}

/**
 * The ledger line a request relies on, checked against the other file the capture command wrote in the
 * same act: the kept reply must still have the sha256 the line records, and the record must be the byte
 * slice of it that the line names (the capture command writes exactly that slice). A record written by
 * hand and given a ledger line of its own has no such reply. Returns the problem, or null.
 */
function replyDisagrees(legalDir: string, rel: string, led: LedgerLine, record: Buffer): string | null {
  if (!led.reply) return `the ledger line for ${rel} names no kept reply, so it is not a line the capture command wrote`;
  const reply = readRecorded("the kept reply", join(legalDir, led.reply.file), led.reply.sha256, `the ledger line for ${rel} (written by verdict-capture)`);
  if (!reply.ok) return reply.problem;
  const slice = reply.value.subarray(led.reply.json_start, led.reply.json_end);
  /* A FORM-2 RECORD is the program's, made from the seat's decisions, so it is not the slice: the slice
   * must be the answer the ledger line names, and the record must answer the same candidates with the same verdicts,
   * in the same order, which is all this command reads from it. */
  if (led.form === 2) {
    if (sha256Of(slice) !== led.answer_sha256) return `${rel}'s kept reply ${led.reply.file} does not hold, at bytes ${led.reply.json_start}-${led.reply.json_end}, the answer its ledger line names`;
    const pairs = (bytes: Buffer): string => {
      try {
        const v = JSON.parse(bytes.toString("utf8")) as unknown;
        return JSON.stringify((Array.isArray(v) ? v : [v]).map((x) => [(x as Record<string, unknown>)?.finding_id, (x as Record<string, unknown>)?.verdict]));
      } catch {
        return "(unreadable)";
      }
    };
    if (pairs(slice) !== pairs(record)) return `${rel} does not answer the candidates of its kept reply ${led.reply.file} with the same verdicts`;
    return null;
  }
  if (Buffer.compare(slice, record) !== 0) return `${rel} is not the slice of its kept reply ${led.reply.file} that its ledger line names (bytes ${led.reply.json_start}-${led.reply.json_end})`;
  return null;
}

/**
 * WHAT `refuter-entries --record <record>` DOES NOW, before it writes anything:
 * its refusal; no entry, where the run has the refute_later shape; or the entries it would append and
 * the candidates it would hold back. The command writes what this returns (`runRefuterEntries`), and the relay's
 * hand-back asks it, through `refuterEntriesToAppend`, whether a record is still due, so the two never disagree.
 */
type RefuterPlan = { kind: "refused" | "none"; outcome: Outcome } | { kind: "built"; built: Extract<Built, { ok: true }>; looks?: true };

function planRefuterEntries(p: Paths, list: LaunchList, recordAbs: string, rel: string): RefuterPlan {
  const no = (outcome: Outcome): RefuterPlan => ({ kind: "refused", outcome });
  // Through the one reader (program-file.ts, item 4); its sha256 is compared with the ledger's below.
  const recordRead = readProgramFile(recordLabelOf(rel), recordAbs);
  if (!recordRead.ok) return no(recordRead.exit === "refused" ? refusal(recordRead.problem, LATER_EXIT.refused) : { exit: LATER_EXIT.unreadable, lines: [`--record ${recordAbs} cannot be read`] });
  const record = recordRead.value;
  const led = ledgerEntryFor(p.legalDir, rel);
  if (typeof led === "string") return no(refusal(led, LATER_EXIT.refused));
  if (led.role === "refuter") return planLocationLooks(p, list, recordAbs, rel, led, record);
  if (led.role !== "adjudicator") return no(refusal(`${rel} was captured as a ${led.role} record, not an adjudicator's or a refuter's`, LATER_EXIT.refused));
  const now = sha256Of(record);
  if (now !== led.sha256) return no(refusal(`${rel} has changed since the capture command wrote it (ledger sha256 ${led.sha256.slice(0, 16)}..., now ${now.slice(0, 16)}...)`, LATER_EXIT.refused));
  const disagrees = replyDisagrees(p.legalDir, rel, led, record);
  if (disagrees) return no(refusal(disagrees, LATER_EXIT.refused));
  const source = list.entries.find((e): e is LaunchEntry => (e.role === "adjudicator" || e.role === "verdict-after-readers") && captureKeyOf(e) === led.key);
  if (!source) return no(refusal(`${rel} answers the payload ${String(led.key)}, and no verdict entry of run ${list.run_id} is for it`, LATER_EXIT.refused));
  const findings = findingsOf(list, p.listPath);
  if (!findings.ok) return no(refusal(findings.problem, exitOf(findings)));
  const payload = payloadOf((list.findings as { path: string }).path, findings.value.toString("utf8"), source);
  if (!payload.ok) return no(refusal(payload.problem, exitOf(payload)));
  let sheet: SourceText | null = null;
  const sheetRead = source.reads.find((r) => r.role === "orientation-sheet");
  if (sheetRead) {
    const o = originalOf(sheetRead);
    const got = readRecorded("the orientation sheet", o.path, o.sha256, `the reads of ${source.id} (recorded by the pre-launch step)`);
    if (!got.ok) return no(refusal(got.problem, exitOf(got)));
    sheet = { path: o.path, text: got.value.toString("utf8") };
  }
  /* The recommended shape has no second check: no refuter
   * is launched for a violation candidate, and the record gives only the second look's entries, for the findings the first
   * review took out of the count on its own word. A record that gives none writes nothing, as before. */
  if (list.shape === "refute_later") {
    const challenges = buildChallengeEntries(list, {
      source,
      record: { path: recordAbs, text: record.toString("utf8") },
      recordRel: rel,
      payload: { path: source.payload_path, text: payload.value.toString("utf8") },
      sheet,
      briefsDir: join(p.launchDir, "briefs"),
      findings: { path: (list.findings as { path: string }).path, text: findings.value.toString("utf8") },
    });
    if (!challenges.ok) return no({ exit: LATER_EXIT.refused, lines: ["refused, and nothing was written:", ...challenges.refused.map((r) => `  - ${r}`)] });
    if (challenges.entries.length === 0 && challenges.held.length === 0) {
      return {
        kind: "none",
        outcome: {
          exit: LATER_EXIT.written,
          lines: [
            `refuter-entries: no entry - run ${list.run_id} has no second check (shape refute_later, the one chosen for it), so no refuter is launched in this run (SKILL.md step 5), and no finding of ${rel} is due a second look (a high finding the review took out of the count on its own word). Nothing was written.`,
          ],
        },
      };
    }
    return { kind: "built", built: challenges };
  }
  const inputs = {
    source,
    record: { path: recordAbs, text: record.toString("utf8") },
    recordRel: rel,
    payload: { path: source.payload_path, text: payload.value.toString("utf8") },
    sheet,
    briefsDir: join(p.launchDir, "briefs"),
    findings: { path: (list.findings as { path: string }).path, text: findings.value.toString("utf8") },
  };
  const built = buildRefuterEntries(list, inputs);
  if (!built.ok) return no({ exit: LATER_EXIT.refused, lines: ["refused, and nothing was written:", ...built.refused.map((r) => `  - ${r}`)] });
  /* The second look in every shape: the ordinary refuter tries to show a
   * candidate is no violation, the same direction as a claim of duty met, exempt or not shipped, so it never challenges that
   * claim. The record gives both kinds of entry, appended and recorded as examined once. */
  const looks = buildChallengeEntries(list, { ...inputs, secondCheck: true });
  if (!looks.ok) return no({ exit: LATER_EXIT.refused, lines: ["refused, and nothing was written:", ...looks.refused.map((r) => `  - ${r}`)] });
  const entries = [...built.entries, ...looks.entries];
  const held = [...built.held, ...looks.held];
  return {
    kind: "built",
    built: { ok: true, entries, briefs: new Map([...built.briefs, ...looks.briefs]), held, appended: { ...built.appended, entries: entries.map((e) => e.id), ...(held.length > 0 ? { held } : {}) } },
  };
}

/**
 * `refuter-entries --record <a captured ordinary refuter record>`: the second
 * looks at its location overturns (`buildLocationLookEntries`). A challenge record, or one that overturns nothing on a
 * location ground of a rule that opts in, gives none and writes nothing.
 */
function planLocationLooks(p: Paths, list: LaunchList, recordAbs: string, rel: string, led: LedgerLine, record: Buffer): RefuterPlan {
  const no = (outcome: Outcome): RefuterPlan => ({ kind: "refused", outcome });
  const none: RefuterPlan = {
    kind: "none",
    outcome: { exit: LATER_EXIT.written, lines: [`refuter-entries: no entry - ${rel} overturns no finding on a location ground of a rule that opts in, so no second look is due for it. Nothing was written.`] },
  };
  if (sha256Of(record) !== led.sha256) return no(refusal(`${rel} has changed since the capture command wrote it (ledger sha256 ${led.sha256.slice(0, 16)}..., now ${sha256Of(record).slice(0, 16)}...)`, LATER_EXIT.refused));
  const disagrees = replyDisagrees(p.legalDir, rel, led, record);
  if (disagrees) return no(refusal(disagrees, LATER_EXIT.refused));
  const source = list.entries.find((e): e is LaterEntry => e.role === "refuter" && (e as LaterEntry).record === rel) as LaterEntry | undefined;
  if (!source) return no(refusal(`${rel} is no refuter entry's record in run ${list.run_id}`, LATER_EXIT.refused));
  if (isChallengeEntry(source)) return none;
  /* What can be due is read from the record first: one that overturns none of its findings on a location ground gives no
   * second look whatever the findings document, the payload or the sheet hold, so it gives none, and is never refused for
   * one of them. Every refusal below is then of a record that may be due a look. */
  let objects: Json[] | null = null;
  try {
    const v: unknown = JSON.parse(record.toString("utf8"));
    objects = (Array.isArray(v) ? v : [v]).filter(isObject);
  } catch {
    objects = null;
  }
  if (objects !== null && !objects.some((r) => source.finding_ids.includes(str(r.finding_id) ?? "") && isLocationOverturn(r))) return none;
  const fid = source.finding_ids[0];
  const verdictEntry = list.entries.find((e): e is LaunchEntry => (e.role === "adjudicator" || e.role === "verdict-after-readers") && e.finding_ids.includes(fid));
  if (!verdictEntry) return no(refusal(`no verdict entry of run ${list.run_id} holds ${fid}, the finding ${rel} answers`, LATER_EXIT.refused));
  const findings = findingsOf(list, p.listPath);
  if (!findings.ok) return no(refusal(findings.problem, exitOf(findings)));
  const payload = payloadOf((list.findings as { path: string }).path, findings.value.toString("utf8"), verdictEntry);
  if (!payload.ok) return no(refusal(payload.problem, exitOf(payload)));
  let sheet: SourceText | null = null;
  const sheetRead = verdictEntry.reads.find((r) => r.role === "orientation-sheet");
  if (sheetRead) {
    const o = originalOf(sheetRead);
    const got = readRecorded("the orientation sheet", o.path, o.sha256, `the reads of ${verdictEntry.id} (recorded by the pre-launch step)`);
    if (!got.ok) return no(refusal(got.problem, exitOf(got)));
    sheet = { path: o.path, text: got.value.toString("utf8") };
  }
  const built = buildLocationLookEntries(list, {
    source,
    record: { path: recordAbs, text: record.toString("utf8") },
    recordRel: rel,
    payload: { path: verdictEntry.payload_path, text: payload.value.toString("utf8") },
    sheet,
    briefsDir: join(p.launchDir, "briefs"),
    findings: { path: (list.findings as { path: string }).path, text: findings.value.toString("utf8") },
    superseded: standingRefuters(list, p.legalDir).superseded,
  });
  if (!built.ok) return no({ exit: LATER_EXIT.refused, lines: ["refused, and nothing was written:", ...built.refused.map((r) => `  - ${r}`)] });
  if (built.entries.length === 0 && built.held.length === 0) {
    // An overturn whose finding already has its second look gives none: that look decides it, and the line says so.
    const c = built.covered ?? [];
    if (c.length === 0) return none;
    return {
      kind: "none",
      outcome: {
        exit: LATER_EXIT.written,
        lines: [`refuter-entries: no entry - ${rel} overturns ${c.map((x) => x.finding_id).join(", ")} on a location ground of a rule that opts in, and ${c.length === 1 ? "that finding already has its" : "each of those findings already has its"} second look (${c.map((x) => x.entry).join(", ")}), which decides it, so no other is appended. Nothing was written.`],
      },
    };
  }
  return { kind: "built", built, looks: true };
}

/** The adjudicator record `--record` names, which must be under `--legal`, or the command's refusal. */
function recordArg(p: Paths, opts: Record<string, unknown>): { ok: true; recordAbs: string; rel: string } | { ok: false; outcome: Outcome } {
  if (typeof opts.record !== "string") return { ok: false, outcome: { exit: LATER_EXIT.refused, lines: ["--record is required: the adjudicator record the capture command wrote"] } };
  const recordAbs = resolve(opts.record);
  const rel = relativePath(p.legalDir, recordAbs);
  if (rel.startsWith("..") || isAbsolute(rel)) return { ok: false, outcome: { exit: LATER_EXIT.refused, lines: [`--record ${opts.record} is not under ${p.legalDir}`] } };
  return { ok: true, recordAbs, rel };
}

/**
 * A REFUSAL OF `refuter-entries` IS WHOLE ON ITS FIRST LINE.
 * The receipt of a seat whose answer the hook captured carries the
 * first line of this command's refusal (hook-capture.ts `appendRefuterEntries`), and a refusal made of a head line and
 * reason lines reached the seat as "refused, and nothing was written:" with no reason. So every outcome this command
 * returns other than a write is one line: its lines joined, through the printed redaction, each run of white space made
 * one space. `runRefuterEntries` returns through this alone, so no refusal of it, present or later, reaches a receipt cut.
 * Where this meets the one printed-output path, the redaction is the
 * program's one printed redaction, printed-output.ts `redactForPrint` - the function every write of the CLI and of the
 * hooks goes through - and not a second use of baseline-002's clauses here. It is applied before the lines are joined,
 * since a credential's shape may span lines; the boundary's own pass over the joined line then finds nothing more to
 * do, so the receipt, the terminal and the seat carry the same one line.
 */
export function refusalWhole(o: Outcome): Outcome {
  if (o.exit === LATER_EXIT.written) return o;
  const text = o.lines.map((l) => l.trim()).filter((l) => l !== "").join("\n");
  if (text === "") return o;
  // Redacted as written (a credential's shape may span lines), then made one line.
  return { exit: o.exit, lines: [redactForPrint(text).replace(/\s+/g, " ")] };
}

export function runRefuterEntries(opts: Record<string, unknown>): Outcome {
  return refusalWhole(refuterEntriesOutcome(opts));
}

function refuterEntriesOutcome(opts: Record<string, unknown>): Outcome {
  const p = pathsOf(opts);
  const arg = recordArg(p, opts);
  if (!arg.ok) return arg.outcome;
  const { recordAbs, rel } = arg;
  return underListLock(p, (): Outcome => {
    const l = readLaunchList(p.listPath);
    if (!l.ok) return refusal(l.problem, exitOf(l));
    const plan = planRefuterEntries(p, l.value, recordAbs, rel);
    if (plan.kind !== "built") return plan.outcome;
    const built = plan.built;
    const c = commit(p, l.value, l.sha256, built, `refuter-entries --record ${rel}`);
    if (!c.ok) return refusal(c.problem, LATER_EXIT.refused);
    const n = built.entries.length;
    // Each kind counted in its own words: a shape with the second check appends both.
    const looks = built.entries.filter((e) => isChallengeEntry(e)).length;
    const plain = n - looks;
    const counted = [
      ...(plain > 0 ? [`${plain} refuter entr${plain === 1 ? "y" : "ies"}`] : []),
      ...(looks > 0 ? [`${looks} second-look entr${looks === 1 ? "y" : "ies"} (a refuter in challenge mode)`] : []),
    ].join(" and ");
    const head =
      n > 0
        ? `refuter-entries: ${counted} for ${rel}, appended to ${p.listPath}${built.held.length > 0 ? `; ${built.held.length} candidate(s) held` : ""}:`
        : built.held.length > 0
          ? plan.looks === true
            ? `refuter-entries: ${rel} gives no second-look entry: the second look at each of its ${built.held.length} overturn(s) on a location ground is held (below); recorded as examined in ${p.listPath} (${c.next.entries.length} entries).`
            : `refuter-entries: ${rel} gives no refuter entry: each of its ${built.held.length} violation candidate(s) is held (below); recorded as examined in ${p.listPath} (${c.next.entries.length} entries).`
          : `refuter-entries: ${rel} classes no candidate violation_candidate, so it gives no refuter entry; recorded as examined in ${p.listPath} (${c.next.entries.length} entries).`;
    return { exit: LATER_EXIT.written, lines: n > 0 || built.held.length > 0 ? report(c.next, built.entries.map((e) => e.id), built.held, head) : [head] };
  });
}

/**
 * F1 of an internal record: what `refuter-entries --record <record>` would append to `list` now,
 * read without the list's lock and writing nothing - its refuter entries, and the held candidates the report reads (a
 * hold on a candidate that already has a refuter entry is not one: assemble-hooked.ts `heldRefutations`) - or null where
 * it would append nothing: a refusal, the refute_later shape, or a record that classes no candidate violation_candidate.
 * The relay's hand-back names a record as due only where this is not null (hook-launch.ts `refuterEntriesDue`).
 */
export function refuterEntriesToAppend(opts: { record: string; legal: string; launchDir: string }, list: LaunchList): { entries: number; held: number } | null {
  const v = refuterEntriesPreview(opts, list);
  return v.kind === "due" ? { entries: v.entries, held: v.held.length } : null;
}

/**
 * The same reading, with what a caller must say where nothing is appended: `refused` with the command's one line (it
 * refuses, and would refuse if run now), `none` (it would append and hold nothing), or `due`. A held second look at a
 * location overturn is a look not written, so it counts whether or not its finding has a refuter entry; the command
 * records each hold with its reason when it runs.
 */
export type RefuterEntriesPreview = { kind: "refused"; line: string } | { kind: "none" } | { kind: "due"; entries: number; held: Held[] };
export function refuterEntriesPreview(opts: { record: string; legal: string; launchDir: string }, list: LaunchList): RefuterEntriesPreview {
  const p = pathsOf(opts);
  const arg = recordArg(p, opts);
  if (!arg.ok) return { kind: "refused", line: refusalWhole(arg.outcome).lines[0] ?? `exit ${arg.outcome.exit}` };
  const plan = planRefuterEntries(p, list, arg.recordAbs, arg.rel);
  if (plan.kind === "refused") return { kind: "refused", line: refusalWhole(plan.outcome).lines[0] ?? `exit ${plan.outcome.exit}` };
  if (plan.kind !== "built") return { kind: "none" };
  const refuted = new Set(list.entries.flatMap((e) => (e.role === "refuter" ? e.finding_ids : [])));
  const held = plan.built.held.filter((h) => plan.looks === true || !refuted.has(h.finding_id));
  const entries = plan.built.entries.length;
  return entries > 0 || held.length > 0 ? { kind: "due", entries, held } : { kind: "none" };
}

/** The `.legal/set-aside-*` directories and their top-level entries, as the set-aside list. */
export function setAsideList(legalDir: string): { dir: string; entries: string[] }[] {
  let names: string[] = [];
  try {
    names = readdirSync(legalDir).sort();
  } catch {
    return [];
  }
  return names
    .filter((n) => n.startsWith("set-aside-") && statSync(join(legalDir, n)).isDirectory())
    .map((n) => ({ dir: `.legal/${n}`, entries: readdirSync(join(legalDir, n)).sort() }));
}

export function runSilenceEntries(opts: Record<string, unknown>): Outcome {
  const p = pathsOf(opts);
  if (typeof opts.rules !== "string") return { exit: LATER_EXIT.refused, lines: ["--rules is required: the silent rules, comma-separated, that one investigator searches"] };
  const ruleIds = opts.rules.split(",").map((r) => r.trim()).filter((r) => r !== "");
  return underListLock(p, (): Outcome => {
    const l = readLaunchList(p.listPath);
    if (!l.ok) return refusal(l.problem, exitOf(l));
    const list = l.value;
    if (typeof opts.findings === "string" && (!list.findings || resolve(opts.findings) !== resolve(list.findings.path))) {
      return refusal(`--findings ${resolve(opts.findings)} is not the findings document the launch list was made from (${list.findings?.path ?? "the list records none"}): a silence brief is made only from that document`, LATER_EXIT.refused);
    }
    const findings = findingsOf(list, p.listPath);
    if (!findings.ok) return refusal(findings.problem, exitOf(findings));
    if (!Array.isArray(list.run_reads)) {
      return refusal(`${p.listPath} records no run_reads (the run context, the sheet and the paragraph with their sha256, which the pre-launch step records on the list since 2026-09-25): run the pre-launch step (\`legal-scan adjudicate --shape\`) again`, LATER_EXIT.refused);
    }
    const ctxRead = runRead(list, "run-context");
    const ctx = readRecorded("the run context", list.run_context_path, ctxRead && ctxRead.path === list.run_context_path ? ctxRead.sha256 : null, "the launch list's run_reads (recorded where the pre-launch step wrote it)");
    if (!ctx.ok) return refusal(ctx.problem, exitOf(ctx));
    const handed: { sheet: SourceText | null; notes: SourceText | null } = { sheet: null, notes: null };
    for (const [key, role, what] of [
      ["sheet", "orientation-sheet", "the orientation sheet"],
      ["notes", "orientation-notes", "the orchestrator's paragraph"],
    ] as const) {
      const r = runRead(list, role);
      if (!r) continue;
      const o = originalOf(r);
      const got = readRecorded(what, o.path, o.sha256, "the launch list's run_reads (recorded by the pre-launch step)");
      if (!got.ok) return refusal(got.problem, exitOf(got));
      handed[key] = { path: o.path, text: got.value.toString("utf8") };
    }
    const built = buildSilenceEntry(list, {
      ruleIds,
      findings: { path: (list.findings as { path: string }).path, text: findings.value.toString("utf8") },
      runContext: { path: list.run_context_path, text: ctx.value.toString("utf8") },
      sheet: handed.sheet,
      notes: handed.notes,
      setAside: setAsideList(p.legalDir),
      briefsDir: join(p.launchDir, "briefs"),
    });
    if (!built.ok) return { exit: LATER_EXIT.refused, lines: ["refused, and nothing was written:", ...built.refused.map((r) => `  - ${r}`)] };
    const c = commit(p, list, l.sha256, built, `silence-entries --rules ${(built.appended.rule_ids ?? []).join(",")}`);
    if (!c.ok) return refusal(c.problem, LATER_EXIT.refused);
    return { exit: LATER_EXIT.written, lines: report(c.next, built.entries.map((e) => e.id), [], `silence-entries: 1 silence entry for ${ruleIds.length} rule(s), appended to ${p.listPath}:`) };
  });
}

export function registerLaunchLater(program: Command): void {
  program
    .command("refuter-entries")
    .description(
      "Append to the launch list, for a captured adjudicator record, one refuter entry per violation_candidate where the run has the second check (relay rework item 4), and in every shape one second-look entry (a refuter in challenge mode) per high finding the review took out of the count on its own word (where the run has the second check, also per high finding the review ruled out as not applicable). Run it each time the capture command writes an adjudicator record; a refuter's brief is the candidate, its rule's block, the census summary and the orientation sheet, and nothing of the verdict; a second look's adds the claim and its line. Run it too for a captured refuter record: where it overturns a finding on a location ground of a rule that opts in, it appends that finding's second look, unless the finding already has one (the first review's, which then decides it).",
    )
    .option("--record <file>", "the adjudicator record the capture command wrote (.legal/verdicts/<nnn>-<key>.json)")
    .option("--legal <dir>", "the run's working directory (default: .legal)")
    .option("--launch-dir <dir>", "the launch directory (default: <legal>/launch)")
    .action((opts) => {
      const r = runRefuterEntries(opts as Record<string, unknown>);
      for (const l of r.lines) console.log(l);
      process.exitCode = r.exit;
    });
  program
    .command("silence-entries")
    .description(
      "Append to the launch list one silence-investigator entry for the silent rules the orchestrator chose (relay rework item 4). The brief carries the rules' rows, the whole coverage_limits block, the .legal/ exclusion and the set-aside list in the program's words.",
    )
    .option("--rules <ids>", "the silent rules one investigator searches, comma-separated")
    .option("--legal <dir>", "the run's working directory (default: .legal)")
    .option("--launch-dir <dir>", "the launch directory (default: <legal>/launch)")
    .option("--findings <file>", "the findings document the launch list was made from, which is the default; any other document is refused")
    .action((opts) => {
      const r = runSilenceEntries(opts as Record<string, unknown>);
      for (const l of r.lines) console.log(l);
      process.exitCode = r.exit;
    });
}

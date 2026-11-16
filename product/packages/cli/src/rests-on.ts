/**
 * What a layer-2 verdict rests on, and whether a later run may carry it forward (unit H).
 *
 * ## Why this file exists
 *
 * Adjudication is the expensive half of a scan: layer 1 casts wide and costs seconds, layer 2 reads
 * and judges and costs money in the user's own agent. Most of that money, on the second run of the
 * same repository, re-answers questions nothing has touched. This module makes a verdict say WHAT
 * IT RESTED ON, in data rather than in prose, so that a later run can recompute those premises with
 * no model and tell an untouched question from a moved one.
 *
 * **No model runs here and none is consulted.** Every premise is a digest a machine derives from
 * the tree and the bundle, and a verdict is carried forward only when every one of them is
 * reproduced exactly. The strongest word this file may use about a carried verdict is CARRIED: it
 * is not re-verified, it was not re-read, and the record says which run it came from - the wording
 * discipline `reconcile-diff.ts` keeps for `saved`, for the same reason.
 *
 * ## The premise kinds, and how a new one is added
 *
 * A premise is a named row with an identity and a digest. The comparison below walks the kinds in a
 * FIXED ORDER and stops at the first that differs, so the reason a candidate is re-adjudicated is
 * always one named premise and never "something changed":
 *
 *   1. `candidate` - the candidate's own identity, the content key below. It is compared, and not
 *                    merely used to find the previous verdict: a verdict may reach its candidate by
 *                    a route that does not turn on the key - the finding id - and a candidate whose
 *                    matched text changed is then a changed premise, never a carry.
 *   2. `rule`      - the rule's own compiled clause, digested. A rule change re-adjudicates every
 *                    verdict of that rule, which is what the bound in ideas.md section H asks for.
 *   3. `instructions` - what the seat judged by: the adjudicator's agent text, the legal-scan skill
 *                    and the declared version of the program's verdict rules, digested (`instructions.ts`). A
 *                    verdict judged under other instructions is given again.
 *   4. `handed`    - what every seat is handed beside its payload and that no other premise covers:
 *                    the person's profile, by the scan's `profile_digest`, and the dependency inventory without
 *                    positions (`handedPremiseOf` below).
 *      `facts`     - what the scan computed beyond the matched lines and wrote onto the candidate or its locations,
 *                    which the seat is handed: `corroborated_in_project` above all, which the agent
 *                    text calls a strong reason to dismiss. Digested without positions (`scanFactsOf`); every field of a
 *                    candidate and of a location is named in `CANDIDATE_FIELDS` / `LOCATION_FIELDS` with the premise
 *                    that compares it, and a gate holds those tables to the findings schema, so a field added later
 *                    is compared or named, never silently handed.
 *   5. `model`     - the model the seat that gave a verdict NOT read place by place ran on:
 *                    the launch entry's model, written on the record by the capture (`seat_model`) and moved here by
 *                    the assembly. A place-plan candidate compares it on each place's row and on its answer seat's
 *                    premises instead (`place-premises.ts`). A verdict that records none is given again once.
 *      `effort`    - the effort levels the seat's own transcript records, written by the capture
 *                    (`seat_effort`); a verdict is carried only where its seat ran at the adjudicator's pin alone.
 * **What the seat ran under is taken when the seat ends, not when the run is assembled.** The capture writes on
 * every verdict it takes the instructions it digested then (`seat_instructions`, C5: a run resumed after a plugin update
 * records the instructions each seat judged by) and the effort; on a verdict not read place by place it also writes what
 * the seat's own transcript shows it opened and searched (`seat_sight`, C2: such a seat may not record `searched[]`, so
 * an absence it rests on was replayed nowhere). A verdict whose record lacks the instructions or, not read place by
 * place, the sight is never carried: its block is incomplete. Where the seat's own transcript could not
 * be read when it ended, the sight it gives is empty and the effort absent; the capture says so on the record
 * (`seat_untaken`) and the block keeps it as `untaken` - never carried, by that reason, and not incomplete, so the run
 * that wrote it is not refused for it.
 *   6. `answers`   - unit F's per-rule answers, below.
 *   7. `census`    - the candidate's kind census, content-keyed (below).
 *   8. `files`     - every file a seat opened, by path and content sha256.
 *   9. `searches`  - every search a seat ran, replayed, by hit-set digest.
 *
 * **The bundle's version and md5 are recorded and NOT compared.** The version stood in for the
 * instructions, which are now their own premise, and for the rules, each of which has its own digest. A version that
 * moves with the bundle's content would move on any edit to any rule, and comparing it would send every
 * verdict of every rule back on that edit - against the per-rule scoping `rule` exists for. Nothing a verdict rests on
 * is in the bundle beside its own rule: the bundle is `rules.json`, the read scope (which decides what is matched, and
 * so moves the content key or the census where it touches a candidate) and pillar 2's checklists.
 *
 * **Unit F's per-rule answers are a premise kind, and since unit GFH-2 (2026-09-22) they are
 * written and compared.** F settles a fact about the PRODUCT once from the person's declaration - a
 * rule id, a question, an answer and the field the answer was read from - and every verdict of that
 * rule rests on it exactly as it rests on a file it opened. Until this unit the slot was reserved
 * and empty, and the consequence was a real one: a person who edited `distribution_regions` between
 * two runs got every verdict carried forward, because no premise recorded the answer it had rested
 * on. `answersFromApplicability` below builds the rows from the block the scan wrote, the assembly
 * step writes them, and `carry-forward.ts` compares them in the order above - after `bundle`,
 * because an answer about the product is a premise of the same kind as the bundle's version and is
 * cheaper to compare than anything that reads the tree.
 *
 * **What the digest covers, and the one alternative that was rejected.** It is taken over the
 * answer, the profile field it was read from AND the value that field held, canonicalised. Covering
 * the answer word alone would be cheaper - a person who adds a region would keep every verdict whose
 * answer did not flip - and it was rejected: a seat is handed `settled_premise`, which quotes the
 * declared regions verbatim, so a verdict can rest on the VALUE and not only on the word, and
 * carrying it forward would keep a verdict whose stated ground no longer matches the declaration.
 * The wider direction costs re-adjudication on a declaration change, which is rare and visible; the
 * narrower one costs a verdict nobody would ever re-check. A declared region list is canonicalised
 * as a SET - sorted and de-duplicated - so re-ordering the same regions is not a change.
 *
 * ## Identity is CONTENT, never position
 *
 * A line number drifts for reasons that have nothing to do with meaning, so nothing here is keyed on
 * one. The fold applied to every text component is the one `reconcile-diff.schema.json`'s
 * `$defs.contentKey` states for pillar 2 - every whitespace run to one space, trimmed, lower-cased,
 * and nothing else - and that schema stays the statement of record; `foldText` below is this
 * pillar's implementation of the same fold, not a second statement of it.
 *
 * That has one consequence worth writing down, because it looks like a defect and is not: the census
 * digest this module compares is NOT `reading.censusHash`. That hash includes each member's
 * `file:start_line` and therefore moves when a file merely gains an import at the top. It is the
 * right digest for tying a trail's row names to one document - which is what design section 9 built
 * it for - and the wrong one for asking whether the candidate is the same candidate. So both are
 * recorded: `census.hash` is carried verbatim for audit, and `census.content_hash`, over the kind
 * keys in order with their member counts and the FILES of their members, is what the comparison
 * uses.
 *
 * ## What is deliberately not here
 *
 * **No verdict word is moved and nothing is re-judged.** This module partitions; the orchestrator
 * dispatches. **A verdict is never carried into "no violation" by silence**: a previous record that
 * is `not_read`, that carries no complete premise block, or whose reading left a gap is
 * re-adjudicated, and the partition says so per candidate.
 *
 * ## Determinism
 *
 * No clock, no randomness, no network. The tree and the bundle are the only inputs, so two runs of
 * this module over the same pair produce byte-identical output and a gate can pin it.
 */

import { createHash } from "node:crypto";
import { projectFileDigest, treeLinesDigest } from "./redaction-key.js";
import { valueFreeText } from "./credential-redaction.js";
import { productPrintedRedaction } from "./product-redaction.js";
import { existsSync, readdirSync, realpathSync, statSync, type Dirent } from "node:fs";
import { join, resolve } from "node:path";
import type {
  Candidate,
  PerRuleApplicability,
  PerRuleApplicabilityRow,
  PerRuleQuestion,
  Rule,
} from "wolfboy-schemas";
import { compileGlobs, globsAllow } from "./globs.js";
import { censusHash, kindCensusOf, memberLocationAtRow, readingUnitsCensusOf, type ReadingCensus, type ReadingSearchTool } from "./reading.js";
import type { InstructionsPremise } from "./instructions.js";
import { dialectOf } from "./regex-dialect.js";
import { walkTarget } from "./walk.js";
import { readRegularFile, readSourceText } from "./project-read.js";
import { CARRY_CLOCK, hostEngineNow, hostGlobCutProblem, hostGlobFilter, hostGlobToolFilter, runHostEngine, searchInputProblem, searchScopeOf, WHOLE_TREE, type EngineClock, type EngineRequest, type HostEngine, type TreeScope } from "./host-search.js";

/**
 * The premise record's own spec. Bumped when a digest's input changes, so that an old block is not
 * silently compared against a new derivation: a mismatch of spec is a changed premise, never a
 * match. `rests-on-2`: the capture records a row as read only
 * where the seat's own transcript shows it opened the code around it and the member the row is
 * credited to. A verdict captured before that
 * rule names no place it did not open, so its reading - and the files its block lists as read - may
 * rest on rows nobody opened: it is never carried forward, and is adjudicated once again instead.
 * `rests-on-3`: the files a block rests on include, for each read row,
 * the file of the member that row is credited to (`memberLocationAtRow`) - a row at a line of one
 * file may stand for the unit's representative in another, and since `rests-on-2` it counts as read
 * only where that member was opened too, so the verdict rests on that file as much as on the row's
 * own. A block written before it does not list that file, so it is adjudicated once again instead.
 * `rests-on-4`: a file's digest is
 * keyed with this computer's key (`projectFileDigest`) and a line's text is taken value-free, so an unkeyed digest of a
 * short file or of a line holding a credential is no longer written. A block written before it holds the unkeyed forms,
 * so it is adjudicated once again instead.
 * `rests-on-5`: a search's `hit_hash` over the lines it matched, and its
 * `dialect`, are keyed with this computer's key (`treeLinesDigest`), never an unkeyed sha256 of tree lines; a search
 * over paths alone (a glob, a file list) keeps the plain digest of the paths. A block written before it holds the
 * unkeyed forms, so it is adjudicated once again instead.
 * `rests-on-6`: a search the host's engine refuses keeps the keyed digest of the
 * engine's error text (`treeLinesDigest`), which quotes the seat's pattern, as the other two forms do. A block written
 * before it holds the unkeyed form, so it is adjudicated once again instead.
 */
export const RESTS_ON_SPEC = "rests-on-6";

/**
 * The order premises are compared in. One reason per candidate, and always the same one.
 *
 * `candidate` - the content key - is compared FIRST after the spec, because it is the identity the
 * rest of the block hangs from: a verdict given over other text is not this candidate's verdict,
 * whatever its files and searches still re-derive.
 */
export const PREMISE_ORDER = ["spec", "candidate", "rule", "instructions", "handed", "facts", "model", "effort", "answers", "census", "files", "searches"] as const;
export type PremiseKind = (typeof PREMISE_ORDER)[number];
/**
 * Every field of the verdict schema's `rests_on` block (`$defs.restsOn`) that is not a
 * premise of `PREMISE_ORDER`, with the reason it is not one. The carry gate fails where a field of the block is in
 * neither list, so a field the block gains is never carried silently because no premise compares it. What the tie
 * cannot hold: the ORDER of `PREMISE_ORDER`, which the premise table reads from the list under test.
 */
export const NOT_PREMISE_FIELDS: Readonly<Record<string, string>> = {
  places: "each place's own premises, compared place by place in PLACE_PREMISE_ORDER (place-premises.ts); a verdict is carried whole only where every place is",
  answer: "the answer seat's own premises (its fold, model, files and searches), compared after every place is carried (firstChangedAnswerPremise)",
  bundle: "the bundle's version and md5, recorded and not compared: either covers every rule of the bundle, and the rule's own clause digest carries the bound",
  complete: "the block's own state, not a premise: a block that is not complete is never carried (previous-premises-incomplete)",
  incomplete: "the reasons a block is not complete, read only to say why it is not carried",
  untaken: "the premises the seat's own transcript could not give: a block that names any is never carried (previous-premises-untaken)",
};

export interface RestsOnFile {
  /** Path relative to the scanned tree, exactly as the seat's row wrote it. */
  path: string;
  /** sha256 over the file's bytes, or absent where the file could not be read. */
  sha256?: string;
  /** Present and true where the path named no readable file when the block was written. */
  missing?: true;
}

export interface RestsOnSearch {
  /** The element of the duty the seat said this search was for. Carried, never compared. */
  for: string;
  /** The pattern the seat wrote, verbatim. Part of the identity. */
  pattern: string;
  /**
   * Which tool ran it, where the seat's row said: `grep` replays as a regular expression over file
   * CONTENT, `glob` as a path pattern over the tree's file PATHS. Absent where the row did not say,
   * and then the replay is the regex one - an old record keeps exactly the reading it had.
   */
  tool?: ReadingSearchTool;
  /** The seat's own words about where it searched. Carried for a reader; the machine uses `scope`. */
  paths?: string;
  /**
   * THE SCOPE THE ROW WAS DIGESTED OVER: the empty string is the whole tree, anything else is a path
   * relative to it. It records a derivation and
   * never stands in for what the seat wrote: every later run derives the scope again from the
   * written path (the host call's `input.path`, else `paths`; for a reply's row, the folder its
   * words name), on that run's tree, and reads the place again wherever the two differ
   * (`scopeNowOf`) - a link re-pointed, made or removed in the path, or prose this code now reads
   * otherwise. The replay then runs over the scope derived on that run, which equals this one.
   */
  scope: string;
  /** Regex flags the replay uses, resolved once with `scope`; `U` (`MULTILINE_FLAG`): replayed across lines (VA-7). */
  flags: string;
  /** How many lines the replay matched. */
  hits: number;
  /** The seat's own count, where it recorded one. Carried so a disagreement is visible, not compared. */
  seat_hits?: number;
  /** sha256 over the sorted hit set, each hit the path and the folded line. */
  hit_hash?: string;
  /** Why this row carries no `hit_hash` - an uncompilable pattern, most often. */
  unreplayable?: string;
  /**
   * C2-4: where the pattern holds a construct ripgrep and this replay read differently on some characters
   * (`regex-dialect.ts`), sha256 over every line of the scope that holds such a character (in a search across lines,
   * every such file whole). Compared beside `hit_hash` (`dialectMoved`): a later run whose digest differs cannot stand
   * for the host's search. Absent where the pattern reads alike on every line.
   */
  dialect?: string;
  /**
   * The seat's Grep `glob`, verbatim: the replay reads it piece by piece as ripgrep does
   * (host-search.ts `hostGlobFilter`), or hands it to the host's engine. Absent where the search named none, and on every
   * row written before the capture kept it (those are rows with no `input`: `replayRecorded`).
   */
  glob?: string;
  /** The seat's Grep `type` (a ripgrep file type), verbatim; only the host's engine replays it. */
  type?: string;
  /**
   * The host call's whole input, as the seat's transcript holds it: what the seat passed, every key.
   * A replay reads a row only where it understands every key and value here (host-search.ts `searchInputProblem`).
   */
  input?: Record<string, unknown>;
  /**
   * The host's own search engine (Claude Code's ripgrep) that replayed
   * this search at capture, by its executable's real path and its version text. Wherever that engine is found, every
   * Grep and Glob holding the host call's input of a path the tree holds is replayed by it (place-premises.ts
   * `searchPremiseOf`), and the row names it where its answer reproduces the host's result; absent where no engine was
   * found (today's replay then stands only under the fallback's file-set rule, `fallbackReplay`) and on every row with no
   * `input`. A premise: a later run with another engine, or none, reads the place again; it never replays this row any
   * other way.
   */
  engine?: HostEngine;
}

/**
 * One row of unit F's premise kind: a question about the PRODUCT that was settled once from the
 * person's declaration, and which this verdict was given as a premise rather than deciding for
 * itself. Built by `answersFromApplicability`, written by the assembly step, compared by
 * `carry-forward.ts`.
 */
export interface RestsOnAnswer {
  rule_id: string;
  question: string;
  digest: string;
  source: string;
}

export interface RestsOn {
  spec: string;
  /** The candidate's identity, keyed on content. */
  candidate: { content_key: string; locations: number };
  rule: { id: string; hash: string };
  /** Recorded for audit and NOT compared (the header says why). */
  bundle: { version: string; md5: string };
  /** The instructions the seat judged by. Absent on a block written before; such a verdict is given again. */
  instructions?: InstructionsPremise;
  /** What every seat is handed beside its payload. Absent on a block written before. */
  handed?: RestsOnHanded;
  /**
   * The model the seat that gave this verdict ran on, for a candidate not read place by place (the launch
   * entry's model, which the capture writes on the record as `seat_model`). Absent on a block written before, on a
   * record the capture was given no model for, and on a place-plan candidate, whose places and answer seat record theirs.
   */
  model?: string;
  /**
   * The scan's own facts handed to the seat on this candidate and its locations (`scanFactsOf`), without
   * positions. Absent on a block written before; such a verdict is given again once.
   */
  facts?: { digest: string; fields: number };
  /**
   * The effort levels the seat's own transcript records (`seat_effort`, written by the capture). Absent
   * where none was recorded; a verdict is carried only where it is exactly the adjudicator's pin.
   */
  effort?: string[];
  /** Absent where the candidate carries no kind census - it is then read location by location. */
  census?: { hash: string; content_hash: string };
  files: RestsOnFile[];
  searches: RestsOnSearch[];
  /**
   * One row per per-rule answer the scan settled for this candidate's rule, sorted by question.
   * Absent where the run settled none - a document from before unit F, or a run whose
   * `distribution_regions` question was not answered at all.
   */
  answers?: RestsOnAnswer[];
  /**
   * Build unit F5 (full-read design section 4): a place-plan candidate's places, each with its own premises 1 and 4-8
   * (`place-premises.ts`); premises 2 and 3 are this block's `rule` and `answers`. Compared place by place by
   * `carry-forward.ts`; absent on a candidate of the old form.
   */
  places?: import("./place-premises.js").PlacePremises[];
  /**
   * VA-5: the answer seat's own premises, for a candidate answered by an answer seat after its place seats -
   * the fold's digest and the files and searches of the seat's own transcript (`answer-premises.ts`). Written by the
   * capture on the seat's record and moved here by the assembly; compared by `carry-forward.ts` after every place.
   */
  answer?: import("./place-premises.js").AnswerPremises;
  /** False where any premise could not be derived. A block that is not complete is NEVER carried. */
  complete: boolean;
  /** Why it is not complete, one sentence per reason. Absent when it is. */
  incomplete?: string[];
  /**
   * Premises the seat's own transcript could not give when the seat ended (its sight, its effort: the
   * record's `seat_untaken`, `place-premises.ts` `seatUntakenOf`), one sentence each. A block that holds any is NEVER
   * carried (`carry-forward.ts`, `previous-premises-untaken`), and it is not a reason the block is incomplete: the run
   * that wrote it is not refused for it (step 5a reads `complete` alone), because the seat's rows were already held to
   * its transcript by the capture and by the assembly's transcript check. Absent where there is none.
   */
  untaken?: string[];
}

/* --------------------------------------------------------------------------------------------- *
 * The fold, and the digests built on it.
 * --------------------------------------------------------------------------------------------- */

/**
 * The text fold of `reconcile-diff.schema.json`'s `$defs.contentKey`, which is the statement of
 * record: every whitespace run - the class `\s`, plus U+00A0 and U+FEFF - becomes one space, the
 * ends are trimmed, and the result is lower-cased. Nothing else: no accent folding, no separator
 * removal, no Unicode normalisation.
 */
export function foldText(text: string): string {
  return text.replace(/[\s ﻿]+/g, " ").trim().toLowerCase();
}

/** A stable serialisation: object keys sorted, so a re-ordered bundle is not a changed rule. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const rec = value as Record<string, unknown>;
  return `{${Object.keys(rec)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`)
    .join(",")}}`;
}

/**
 * A list in the order of one string key - the order `<` gives strings (UTF-16 code units), which is the order the
 * default sort gives them - with the items of one key in the order given. No comparator is written, so
 * none is left with an arm no case can hold: V8's sort reads a comparator's result only as below zero or not, so the
 * `a > b ? 1 : 0` arm of the three-way comparators this replaced (in `bundleMd5`, `restsOnAnswersOf` and `partition`)
 * could be changed to anything and no case on this engine could tell.
 */
export function inKeyOrder<T>(list: readonly T[], keyOf: (item: T) => string): T[] {
  const groups = new Map<string, T[]>();
  for (const item of list) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.keys()].sort().flatMap((key) => groups.get(key) ?? []);
}

/** What `inHolderOrder` and `holdersByKey` read of an earlier verdict (carry-forward.ts `PreviousVerdict`). */
export interface HeldVerdict {
  finding_id: string;
  record: Record<string, unknown>;
  source?: string;
  scan_id?: string;
}

/**
 * THE ONE ORDER IN WHICH EARLIER VERDICTS HOLD A KEY. By finding id, the order `<` gives
 * strings; two verdicts of one finding id (an earlier run's log can list one twice) by their records' canonical text,
 * then the file each was read from, then its scan: an order of the verdicts themselves, never of the list they came in.
 * Two verdicts equal on all four are indistinguishable to every reader of the carry, so which comes first changes
 * nothing. No comparator is written (`inKeyOrder`), and the canonical text is computed only where a finding id repeats.
 */
export function inHolderOrder<T extends HeldVerdict>(list: readonly T[]): T[] {
  const byId = inKeyOrder(list, (v) => v.finding_id);
  const out: T[] = [];
  for (let i = 0; i < byId.length; ) {
    let j = i + 1;
    while (j < byId.length && byId[j]!.finding_id === byId[i]!.finding_id) j += 1;
    const run = byId.slice(i, j);
    out.push(...(run.length > 1 ? inKeyOrder(run, (v) => [canonicalJson(v.record), v.source ?? "", v.scan_id ?? ""].join(FIELD_SEP)) : run));
    i = j;
  }
  return out;
}

/**
 * WHICH EARLIER VERDICT HOLDS EACH KEY: the first in `inHolderOrder` that names it. The one
 * rule for every keyed choice of the carry - a content key, a finding id the key missed on, a place's key - so which
 * verdict is carried, compared or reported never depends on the order the earlier run lists its verdicts in (a `Map.set`
 * per verdict kept the LAST listed, which is how the holder of a content key was chosen before). A verdict never
 * displaces itself: of two entries one verdict gives under one key, the first holds.
 */
export function holdersByKey<T extends HeldVerdict, V>(list: readonly T[], entriesOf: (item: T) => Iterable<readonly [string, V]>): Map<string, { holder: T; value: V }> {
  const held = new Map<string, { holder: T; value: V }>();
  for (const item of inHolderOrder(list)) {
    for (const [key, value] of entriesOf(item)) if (!held.has(key)) held.set(key, { holder: item, value });
  }
  return held;
}

/** How a candidate of this scan came to be paired with an earlier verdict of its content key (`pairByKey`). */
export type PairedBy = "finding" | "place" | "rule";

/** What `pairByKey` returns. Every map is keyed by the candidate or the verdict object itself. */
export interface KeyPairing<C, V> {
  /** Each candidate paired, with the earlier verdict it is compared with and how it was paired. */
  pairOf: Map<C, { verdict: V; by: PairedBy }>;
  /**
   * An earlier verdict left unpaired whose own candidate (the same finding id, or the same places) is in this scan
   * and was paired with another earlier verdict: that candidate, and how it is this verdict's own.
   */
  ownTaken: Map<V, { own: C; by: "finding" | "place" }>;
  /**
   * An earlier verdict left unpaired with no own candidate of its content key in this scan, where every candidate of
   * that key was paired with another: how many candidates of that key this scan raised. (Its own candidate may be in
   * this scan under another content key; the partition reads that.)
   */
  leftOver: Map<V, number>;
  /**
   * An earlier verdict left unpaired with no own candidate of its content key in this scan, beside
   * candidates of that key left with no own earlier verdict of the key, where nothing recorded places it on one of
   * them: how many candidates and how many verdicts of the key were left. Never compared with any of them. (Either side
   * may have its own counterpart under another content key; the partition reads that.)
   */
  unplaced: Map<V, { candidates: number; verdicts: number }>;
  /** A candidate left unpaired for the same reason, with the same two counts. Given to a seat again. */
  unplacedCandidates: Map<C, { candidates: number; verdicts: number }>;
  /** How many earlier verdicts hold each content key a candidate of this scan has (0 where none). */
  verdictsOfKey: Map<string, number>;
}

/**
 * WITHIN ONE CONTENT KEY, EACH CANDIDATE IS PAIRED WITH ITS OWN EARLIER VERDICT. Two candidates of one key
 * (two lines of one file that differ only in letter case; two parts of a split group over identical lines) are two
 * candidates with two earlier verdicts, so today's candidates and the earlier verdicts of a key are paired as
 * multisets, as pillar 2 pairs content keys (`reconcile-diff.ts`), but by place and never by the order of a list:
 *   1. the same finding id - the scan's fingerprint of the candidate's place (its rule, its file and its line's text;
 *      for a part of a split group, the group and the part's position); recorded by every verdict;
 *   2. then, among those left, the same places - the set of place keys (rule, file, folded text, occurrence) the
 *      verdict's own `rests_on.places` records, equal to the candidate's; only a verdict read place by place records
 *      them, and a candidate or a verdict with a place whose key cannot be taken has none;
 *   3. then, for what is left on both sides, the one candidate left with the one earlier verdict left that has no own
 *      candidate of the key in this scan - only where exactly one of each is left and that verdict lists no place
 *      rows. Where more are left on either side, or the verdict left lists places that are not the
 *      candidate's, nothing recorded says which line each verdict answered (a verdict not read place by place records
 *      no line, and its finding id is not the candidate's), and pairing them in finding-id order could compare - and,
 *      where no premise moved, carry - one line's verdict on another line. So none of them is paired: each verdict
 *      left is `unplaced` (listed not chosen) and each candidate left is given to a seat again.
 * Within each step a candidate takes the first verdict in `inHolderOrder` that qualifies, so of two records of one
 * candidate's own verdict the first holds, as `holdersByKey` would choose it. A verdict whose own candidate is a
 * candidate of the key never goes to step 3: it is `ownTaken`, never carried onto another candidate. A candidate with
 * nothing left is not paired: no earlier verdict is handed to two candidates. The finding id goes before the places
 * because a place's occurrence moves when a line of the same text is added above it, and a finding id does not: a
 * third case-variant line written above two others would otherwise take the first one's verdict, and the first the
 * second's.
 */
export function pairByKey<C extends { finding_id: string }, V extends HeldVerdict>(args: {
  candidates: readonly C[];
  previous: readonly V[];
  keyOfCandidate: (candidate: C) => string;
  keyOfVerdict: (verdict: V) => string | null;
  /** The candidate's places as one string ("" where it has none, or one cannot be keyed); read only where needed. */
  placesOfCandidate: (candidate: C) => string;
  /** The places the verdict's own block records, as one string ("" where none, or a row has no key). */
  placesOfVerdict: (verdict: V) => string;
  /**
   * Whether the verdict's own block lists any place row at all, keyed or not (it was read place by
   * place). Such a verdict left for step 3 has places that are not the candidate's, so it is never paired there.
   * Absent, a verdict lists places where `placesOfVerdict` gives any.
   */
  listsPlaces?: (verdict: V) => boolean;
}): KeyPairing<C, V> {
  const out: KeyPairing<C, V> = { pairOf: new Map(), ownTaken: new Map(), leftOver: new Map(), unplaced: new Map(), unplacedCandidates: new Map(), verdictsOfKey: new Map() };
  const listsPlaces = args.listsPlaces ?? ((verdict: V): boolean => args.placesOfVerdict(verdict) !== "");
  const push = <K, T>(map: Map<K, T[]>, key: K, item: T): void => {
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  };
  const verdictsByKey = new Map<string, V[]>();
  for (const verdict of inHolderOrder(args.previous)) {
    const key = args.keyOfVerdict(verdict);
    if (key) push(verdictsByKey, key, verdict);
  }
  const candidatesByKey = new Map<string, C[]>();
  for (const candidate of inKeyOrder(args.candidates, (c) => c.finding_id)) push(candidatesByKey, args.keyOfCandidate(candidate), candidate);

  for (const [key, candidates] of candidatesByKey) {
    const verdicts = verdictsByKey.get(key) ?? [];
    out.verdictsOfKey.set(key, verdicts.length);
    if (verdicts.length === 0) continue;
    const taken = new Set<V>();
    const pair = (candidate: C, verdict: V, by: PairedBy): void => {
      out.pairOf.set(candidate, { verdict, by });
      taken.add(verdict);
    };
    const free = (list: readonly V[] | undefined): V | undefined => list?.find((v) => !taken.has(v));

    // 1. The same finding id.
    const verdictsByFinding = new Map<string, V[]>();
    for (const verdict of verdicts) push(verdictsByFinding, verdict.finding_id, verdict);
    for (const candidate of candidates) {
      const verdict = free(verdictsByFinding.get(candidate.finding_id));
      if (verdict) pair(candidate, verdict, "finding");
    }

    // 2. The same places, where a verdict of the key records any.
    const verdictsByPlaces = new Map<string, V[]>();
    const placesOfVerdict = new Map<V, string>();
    for (const verdict of verdicts) {
      const places = args.placesOfVerdict(verdict);
      placesOfVerdict.set(verdict, places);
      if (places) push(verdictsByPlaces, places, verdict);
    }
    const candidateByPlaces = new Map<string, C>();
    if (verdictsByPlaces.size > 0) {
      for (const candidate of candidates) {
        const places = args.placesOfCandidate(candidate);
        if (!places) continue;
        if (!candidateByPlaces.has(places)) candidateByPlaces.set(places, candidate);
        if (out.pairOf.has(candidate)) continue;
        const verdict = free(verdictsByPlaces.get(places));
        if (verdict) pair(candidate, verdict, "place");
      }
    }

    // The verdicts left: one whose own candidate is a candidate of this key is not handed to another.
    const candidateByFinding = new Map(candidates.map((c) => [c.finding_id, c] as const));
    const unowned: V[] = [];
    for (const verdict of verdicts) {
      if (taken.has(verdict)) continue;
      const byFinding = candidateByFinding.get(verdict.finding_id);
      const places = placesOfVerdict.get(verdict) ?? "";
      const byPlaces = places ? candidateByPlaces.get(places) : undefined;
      if (byFinding) out.ownTaken.set(verdict, { own: byFinding, by: "finding" });
      else if (byPlaces) out.ownTaken.set(verdict, { own: byPlaces, by: "place" });
      else unowned.push(verdict);
    }

    // 3. What is left on both sides: paired only where the place cannot disagree, never by list order.
    const waiting = candidates.filter((c) => !out.pairOf.has(c));
    if (waiting.length === 0) for (const verdict of unowned) out.leftOver.set(verdict, candidates.length);
    else if (unowned.length === 1 && waiting.length === 1 && !listsPlaces(unowned[0]!)) pair(waiting[0]!, unowned[0]!, "rule");
    else if (unowned.length > 0) {
      const counts = { candidates: waiting.length, verdicts: unowned.length };
      for (const verdict of unowned) out.unplaced.set(verdict, counts);
      for (const candidate of waiting) out.unplacedCandidates.set(candidate, counts);
    }
  }
  return out;
}

const sha256Hex = (text: string): string => createHash("sha256").update(text).digest("hex");

/** The unit separators the keys below are built with, named so no call site retypes them. */
const FIELD_SEP = "\u0000";
const ITEM_SEP = "\u0001";

/**
 * The census digest the comparison uses: the kind keys IN THEIR CENSUS ORDER, each with its member
 * count, its sub-shape count and the sorted set of files its members sit in.
 *
 * The order is in the digest on purpose. Every row of a `reading` block names its unit by an INDEX
 * into `kinds.groups`, so two units swapping places renames every row while changing nothing else;
 * a digest blind to order would carry forward a trail whose rows now point at other groups.
 *
 * Line numbers are NOT in it, which is the whole difference from `censusHash`: a new vendor, a new
 * store or a new route is a new key and re-adjudicates the candidate, while an import added at the
 * top of a file is not a change to what the candidate is.
 */
export function censusContentHash(census: ReadingCensus): string {
  const h = createHash("sha256");
  h.update(`${census.spec}${FIELD_SEP}${census.level}${FIELD_SEP}${census.kinds.length}\n`);
  for (const kind of census.kinds) {
    const files = [...new Set(kind.members.map((m) => m.file))].sort();
    h.update(
      `${foldText(kind.key)}${FIELD_SEP}${kind.member_count}${FIELD_SEP}${kind.sub_shape_count}${FIELD_SEP}${files.join(ITEM_SEP)}\n`,
    );
  }
  return h.digest("hex");
}

/**
 * A rule's presentation lines: the
 * title of a finding to fix and what to do. They say what the report shows, never how a verdict is reached, so no rule
 * digest is taken over them: a wording change must send no verdict back and reopen no decision. The build already moves
 * them out of the rule into `rule-lines.json` (tools/build-bundle.mjs imports this list); `ruleHash` leaves them out by
 * name as well, so a rule object that still carries them digests as the same rule.
 */
export const RULE_LINE_FIELDS: readonly string[] = ["problem_line", "fix_line"];

/** The rule's own compiled definition, digested, without its presentation lines. A changed clause is a changed premise. */
export function ruleHash(rule: Rule | undefined, ruleId: string): string {
  if (!rule) return `absent:${ruleId}`;
  const judged: Record<string, unknown> = { ...(rule as unknown as Record<string, unknown>) };
  for (const field of RULE_LINE_FIELDS) delete judged[field];
  return sha256Hex(canonicalJson(judged));
}

/** The bundle's fastening: md5 over its manifest's file digests, which covers every shipped asset. */
export function bundleMd5(files: Record<string, string> | undefined): string {
  const entries = inKeyOrder(Object.entries(files ?? {}), ([path]) => path);
  return createHash("md5").update(canonicalJson(entries)).digest("hex");
}

/* --------------------------------------------------------------------------------------------- *
 * Unit F's settled answers, as premise rows (unit GFH-2, 2026-09-22).
 * --------------------------------------------------------------------------------------------- */

/**
 * The declared value, folded for the digest. A list of regions is a SET - sorted and de-duplicated -
 * so that re-ordering the same declaration is not a change; anything else is canonical JSON, folded,
 * which covers a boolean, a number, a string and a nested object alike.
 */
function declaredKey(value: unknown): string {
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return [...new Set((value as string[]).map(foldText))].sort().join(ITEM_SEP);
  }
  return foldText(canonicalJson(value));
}

/**
 * THE DIGEST OF ONE SETTLED ANSWER: the answer, the profile field it was read from, and the value
 * that field held. The file header states why the value is in it and what the cheaper alternative
 * would have cost. The QUESTION is not in the digest - it is half of the row's identity, and a
 * question whose wording changed is a row that no longer matches rather than an answer that moved.
 */
export function answerDigest(question: PerRuleQuestion): string {
  return sha256Hex(
    `${foldText(question.answer)}${FIELD_SEP}${foldText(question.answered_from)}${FIELD_SEP}${declaredKey(question.declared)}`,
  );
}

/**
 * Every answer the scan settled for one rule: the jurisdiction question first by construction, then
 * one row per `applicability_preconditions` expression. Sorted by question, so two runs of one
 * document produce byte-identical rows.
 */
export function restsOnAnswersOf(row: PerRuleApplicabilityRow): RestsOnAnswer[] {
  const rows: RestsOnAnswer[] = [row.jurisdiction_question, ...(row.premise_questions ?? [])].map((q) => ({
    rule_id: row.rule_id,
    question: q.question,
    digest: answerDigest(q),
    source: q.answered_from,
  }));
  return inKeyOrder(rows, (r) => r.question);
}

/**
 * The premise rows of every rule the scan answered, by rule id. Read by the assembly step, which
 * writes them onto each verdict, and by `carry-forward.ts`, which compares them - one builder, so
 * the writer and the comparer cannot drift apart.
 *
 * **A run whose `distribution_regions` question was NOT answered still produces rows.** Its answer
 * is `unanswered` with no declared value, and that is what the verdict rested on: the seat was told
 * to adjudicate on the merits and carry the open question. A later run in which the person has
 * answered therefore moves the digest, and the verdict is re-adjudicated - which is the whole point
 * of the kind.
 */
export function answersFromApplicability(
  block: PerRuleApplicability | null | undefined,
): Map<string, RestsOnAnswer[]> {
  const byRule = new Map<string, RestsOnAnswer[]>();
  if (!block || !Array.isArray(block.rules)) return byRule;
  for (const row of block.rules) byRule.set(row.rule_id, restsOnAnswersOf(row));
  return byRule;
}

/* --------------------------------------------------------------------------------------------- *
 * What every seat is handed beside its payload.
 * --------------------------------------------------------------------------------------------- */

/** The `handed` premise as a verdict's block records it. */
export interface RestsOnHanded {
  /** sha256 over the profile digest and the inventory rows; what is compared. */
  digest: string;
  /** The scan's `profile_digest` (null where no profile was read). Carried so a reason can say the profile moved. */
  profile_digest: string | null;
  /** How many packages the inventory listed. Carried for a reader, not compared on its own. */
  packages: number;
  /**
   * `false` where the briefs named no orientation sheet (none
   * stood beside the findings: `--orientation off`, or a scan run outside the launcher with the sheet turned off);
   * absent where they named one. In the digest only when false, so a block of a run with a sheet digests as before.
   */
  sheet?: false;
  /**
   * Everything in `digest` but the packages'
   * declaration rows: the profile, the sheet, and which packages the inventory lists with whether each is imported from
   * nowhere and whether its call sites were read. Where it is the same on both sides and only `rows` differ, the change is
   * a declaration of a package already listed (a version bump, above all), and it counts only for a verdict that rests on
   * that package (`carry-forward.ts` `packageChangeCounts`). Absent on a block written before; such a block carries only
   * where `digest` is the same.
   */
  rest?: string;
  /** Per package: the first 16 hex of the digest of its declaration rows, without positions. */
  rows?: Record<string, string>;
}

/** The orientation sheet the briefs name, beside the findings document; the one name launch-plan.ts reads. */
export const ORIENTATION_SHEET_FILE = "orientation.md";

/**
 * The scan a sheet was made for, written beside
 * it by the scan that wrote it: `{"scan_id": ...}`. The sheet itself carries no scan id (orientation.ts, "Determinism":
 * it is byte-identical across runs of one tree, and a gate holds that), so the id it belongs to is this file's.
 */
export const ORIENTATION_SCAN_FILE = "orientation-scan.json";

/** The text of `ORIENTATION_SCAN_FILE` for the scan `scanId`. */
export function orientationScanText(scanId: string): string {
  return `${JSON.stringify({ scan_id: scanId })}\n`;
}

/**
 * The orientation sheet beside the findings in `findingsDir`, or
 * null where there is none. The one test of whether the briefs name a sheet: the launch list asks it to name the sheet,
 * and `adjudicate`, `verdict-reading` and `assemble-report` ask it to record what the seats were handed. A sheet is beside the findings of the scan `scanId` (the findings document's
 * `scan_id`) only where `ORIENTATION_SCAN_FILE` beside it names that scan: a sheet an earlier scan left (a scan with
 * `--orientation off` writes none and removes nothing) is never named for a later one. Nothing here removes a file.
 */
export function orientationSheetBeside(findingsDir: string, scanId: unknown): string | null {
  const path = join(findingsDir, ORIENTATION_SHEET_FILE);
  if (typeof scanId !== "string" || scanId === "" || !existsSync(path)) return null;
  try {
    const bound = JSON.parse(readRegularFile(join(findingsDir, ORIENTATION_SCAN_FILE), "utf8")) as { scan_id?: unknown } | null;
    return bound !== null && typeof bound === "object" && bound.scan_id === scanId ? path : null;
  } catch {
    return null;
  }
}

/**
 * THE `handed` PREMISE: what every adjudicator's brief carries whatever its payload, that a verdict may rest on and that
 * no file or search premise covers - the person's ScanProfile and the dependency inventory (launch-plan.ts, cost step 1
 * B2(i): "the brief carries the profile and the whole dependency inventory, one line per package").
 *
 *   - The profile is taken by the scan's `profile_digest`, which the launch already holds every brief to (a profile
 *     whose digest differs is refused at launch). The per-rule answers (`answers`) cover the fields the program settles
 *     for a rule; a seat is handed the WHOLE profile, so any field of it is a ground a verdict may rest on.
 *   - The inventory is digested WITHOUT POSITIONS, as everything here is: each package's name, `declared_only`, and its
 *     declarations with every field but `line`. Its call-site list and count are left out - they are positions and a
 *     count of positions, moving with any edit anywhere, and the files a verdict quoted or opened are premises of their
 *     own. A declaration added, removed, moved to another block or given another version is a change.
 */
export function handedPremiseOf(doc: { profile_digest?: unknown; dependency_inventory?: unknown } | null | undefined, sheet: boolean): RestsOnHanded {
  // No default: a caller that does not say whether the briefs named the sheet would
  // record one side of the comparison by a guess (the gate's controls caught exactly that).
  if (typeof sheet !== "boolean") throw new TypeError("handedPremiseOf: say whether the briefs named the orientation sheet (orientationSheetBeside)");
  const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  const profile = typeof doc?.profile_digest === "string" ? doc.profile_digest : null;
  const inventory = Array.isArray(doc?.dependency_inventory) ? doc.dependency_inventory : [];
  const entries = inventory.map((entry) => {
    const e = isRec(entry) ? entry : {};
    const declared = (Array.isArray(e.declared) ? e.declared : [])
      .map((d) => canonicalJson(isRec(d) ? Object.fromEntries(Object.entries(d).filter(([k]) => k !== "line")) : d))
      .sort();
    const listed = { package: e.package ?? null, declared_only: e.declared_only ?? null, ...(e.call_sites_not_read ? { call_sites_not_read: true } : {}) };
    // The not-read status digested as a mark only where present: an entry without it digests as before.
    return {
      row: canonicalJson({ package: e.package ?? null, declared_only: e.declared_only ?? null, declared, ...(e.call_sites_not_read ? { call_sites_not_read: true } : {}) }),
      listed: canonicalJson(listed),
      name: typeof e.package === "string" ? e.package : canonicalJson(e.package ?? null),
      declared,
    };
  });
  const rows = entries.map((x) => x.row).sort();
  /* The same inventory split in two: what each package's declarations say (`rows`, by package), and
   * everything else (`rest`). A name listed twice digests its declarations together, so no row is lost to the key. */
  const byName = new Map<string, string[]>();
  for (const x of entries) byName.set(x.name, [...(byName.get(x.name) ?? []), ...x.declared]);
  const perPackage: Record<string, string> = {};
  for (const name of [...byName.keys()].sort()) perPackage[name] = sha256Hex(canonicalJson({ spec: "handed-row-1", declared: (byName.get(name) ?? []).sort() })).slice(0, 16);
  return {
    digest: sha256Hex(canonicalJson({ spec: "handed-1", profile, inventory: rows, ...(sheet ? {} : { sheet: "none" }) })),
    profile_digest: profile,
    packages: rows.length,
    ...(sheet ? {} : { sheet: false as const }),
    rest: sha256Hex(canonicalJson({ spec: "handed-rest-1", profile, listed: entries.map((x) => x.listed).sort(), ...(sheet ? {} : { sheet: "none" }) })),
    rows: perPackage,
  };
}

/** One package of today's inventory as the comparison reads it: where it is declared and called. */
export interface InventoryPackageNow {
  package: string;
  /** The manifests that declare it, relative to the tree. */
  declared_in: string[];
  call_site_count: number;
  /** The files of the call sites the inventory lists (a sample of at most a few; `call_site_count` is exact). */
  call_sites: string[];
  call_sites_not_read: boolean;
}

/** Today's inventory by package name, for `carry-forward.ts` `packageChangeCounts`. */
export function inventoryNowOf(doc: { dependency_inventory?: unknown } | null | undefined): Map<string, InventoryPackageNow> {
  const out = new Map<string, InventoryPackageNow>();
  const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  for (const entry of Array.isArray(doc?.dependency_inventory) ? doc.dependency_inventory : []) {
    if (!isRec(entry) || typeof entry.package !== "string") continue;
    const was = out.get(entry.package);
    const declaredIn = (Array.isArray(entry.declared) ? entry.declared : []).flatMap((d) => (isRec(d) && typeof d.file === "string" ? [d.file] : []));
    const sites = (Array.isArray(entry.call_sites) ? entry.call_sites : []).flatMap((c) => (isRec(c) && typeof c.file === "string" ? [c.file] : []));
    out.set(entry.package, {
      package: entry.package,
      declared_in: [...new Set([...(was?.declared_in ?? []), ...declaredIn])].sort(),
      call_site_count: (was?.call_site_count ?? 0) + (typeof entry.call_site_count === "number" ? entry.call_site_count : 0),
      call_sites: [...new Set([...(was?.call_sites ?? []), ...sites])].sort(),
      call_sites_not_read: (was?.call_sites_not_read ?? false) || Boolean(entry.call_sites_not_read),
    });
  }
  return out;
}

/* --------------------------------------------------------------------------------------------- *
 * Every field a seat is handed on a candidate or a location, and the premise that compares it.
 * --------------------------------------------------------------------------------------------- */

/**
 * THE CLASS BEHIND C1: `corroborated_in_project` was written onto locations, handed to every seat and called
 * "a STRONG REASON TO DISMISS" by the agent text, and no premise compared it - nobody had to decide that, it only had to
 * be added without anyone asking. So every property the findings schema gives a location or a candidate is named here
 * with what compares it, a test holds the key sets to the schema, and `scanFactsOf` digests
 * exactly the fields named `facts`. A field added later fails that gate until it is named. The words before the colon
 * are the premise; `facts` fields are digested without positions (`POSITION_KEYS`).
 */
export const LOCATION_FIELDS: Readonly<Record<string, string>> = {
  // Not a premise: the place's identity for the comparison and decisions (place-key.ts),
  // taken from the matched line's text, which the content key already reads; it stays out of every payload (context.ts).
  line_key: "candidate: the content key reads the matched line's text, of which this is a fingerprint; never handed to a seat",
  file: "candidate: the content key holds the file and the folded text of the matched line",
  start_line: "candidate: the content key reads the matched line's text, never its number",
  end_line: "window: a line of the matched file - a place's window, or the whole matched file of a candidate not read place by place (`files`)",
  joined_from: "window: a span of the matched file, as `end_line`",
  also_opens_at: "window: lines of the matched file, as `end_line`",
  resolved_from: "facts: the names of the same-file definitions a use site was reached through (their lines are lines of the matched file, as `end_line`)",
  corroborated_from: "facts: the other file whose text opened the rule's gate, and the gate's scope",
  corroborated_in_project: "facts: whether the whole declared scope holds the rule's corroborator vocabulary (C1)",
  corroborated_in_project_from: "facts: where that vocabulary was found",
  clause: "census: a kind fact of the matched line",
  matched_token: "census: a kind fact of the matched line",
  context_class: "census: a kind fact of the matched line",
  sub_shape: "census: a kind fact of the matched line",
};
export const CANDIDATE_FIELDS: Readonly<Record<string, string>> = {
  finding_id: "candidate: a route to the earlier verdict; the content key is what is compared",
  rule_id: "rule: the compiled rule's digest",
  title: "rule: copied from the compiled rule",
  severity: "rule: copied from the compiled rule",
  rule_confidence: "rule: copied from the compiled rule",
  context_questions: "rule: copied from the compiled rule",
  legal_basis_refs: "rule: copied from the compiled rule",
  reading_class: "rule: copied from the compiled rule",
  finding_role: "rule: copied from the compiled rule",
  duty_about: "rule: copied from the compiled rule",
  effective_date: "rule: copied from the compiled rule",
  data_categories: "rule: copied from the compiled rule",
  evidence_template: "rule: copied from the compiled rule",
  remediation_template: "rule: copied from the compiled rule",
  unanswered_preconditions: "handed: derived from the rule and the person's profile (`rule`, `handed`, `answers`)",
  declared_inapplicable_preconditions: "handed: derived from the rule and the person's profile (`rule`, `handed`, `answers`)",
  depends_on_applicability: "facts: the scope assessments of the bundle's checklists over the whole tree's code facts and the profile, handed in the payload's rule block",
  dataflow: "not handed: no source of this scanner writes it",
  suppressed_by: "not handed: a suppressed candidate is left out of the output and of every payload",
  group_part: "logistics: which part of a group split at the location bound this is; no other part's location is handed",
  adjudication_group: "model and logistics: its `seat_model` is `model`; the rest is the payload's key, its bin and their sizes",
  kinds: "census: the kind census, content-keyed",
  reading_plan: "census: a function of the census and the seat bound",
  locations: "each location by LOCATION_FIELDS",
};
/** The keys `facts` fields are digested without: a fact that only moved is the same fact. */
export const POSITION_KEYS: ReadonlySet<string> = new Set(["line", "start_line", "end_line", "definition_line", "lines"]);
const factFieldsOf = (table: Readonly<Record<string, string>>): string[] => Object.keys(table).filter((k) => table[k]!.startsWith("facts:"));
export const LOCATION_FACT_FIELDS: readonly string[] = factFieldsOf(LOCATION_FIELDS);
export const CANDIDATE_FACT_FIELDS: readonly string[] = factFieldsOf(CANDIDATE_FIELDS);

function positionFree(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(positionFree);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([k]) => !POSITION_KEYS.has(k)).map(([k, v]) => [k, positionFree(v)]));
  }
  return value;
}

/** The `facts` fields one record (a location, a candidate, a payload's rule block) carries, without positions; null where it carries none. */
export function factsOfRecord(record: unknown, fields: readonly string[]): Record<string, unknown> | null {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  const rec = record as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of fields) if (rec[f] !== undefined) out[f] = positionFree(rec[f]);
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * THE `facts` PREMISE of a verdict: the candidate's own `facts` fields and every location's, each location
 * named by its file and the folded text of its matched line (as the content key names it), digested without positions.
 * A location whose `corroborated_in_project` flipped, whose corroborating file changed or whose definitions were reached
 * under other names, and a candidate whose scope assessment moved, is a changed premise. A place compares the same
 * fields on its own window (`place-premises.ts` `placeWindowsOfPayload`).
 */
export function scanFactsOf(candidate: Candidate, tree: TreeReader, ships?: ReadonlyMap<string, string>): { digest: string; fields: number } {
  const own = factsOfRecord(candidate, CANDIDATE_FACT_FIELDS);
  let fields = own ? Object.keys(own).length : 0;
  const locations: string[] = [];
  for (const loc of candidate.locations ?? []) {
    const facts = factsOfRecord(loc, LOCATION_FACT_FIELDS);
    // The ships premise of the location's file, as the seat was handed it.
    const premise = ships?.get(loc.file);
    if (!facts && premise === undefined) continue;
    fields += (facts ? Object.keys(facts).length : 0) + (premise === undefined ? 0 : 1);
    locations.push(canonicalJson({ file: loc.file, line: tree.foldedLine(loc.file, loc.start_line) ?? "", facts, ...(premise === undefined ? {} : { ships: premise }) }));
  }
  locations.sort();
  return { digest: sha256Hex(canonicalJson({ spec: "facts-1", candidate: own, locations })), fields };
}

/**
 * THE SHIPS PREMISE AS A PREMISE: findings.json `ships_premises`, one
 * canonical text per file, without positions (each `because` line by its file and quotation; a premise whose manifest line
 * only moved is the same premise). Digested into the `facts` premise of every candidate with a location in the file
 * (`scanFactsOf`) and into the window of every place in it (place-premises.ts `placeWindowsOfPayload`), so a changed
 * manifest that changes a file's premise, or the line it rests on, re-reads the verdicts and places on that file and no
 * others. A document without the field gives an empty map: every digest is then exactly what it was before WP6.
 */
export function shipsFactsOf(premises: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!premises || typeof premises !== "object" || Array.isArray(premises)) return out;
  for (const [file, row] of Object.entries(premises as Record<string, unknown>)) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const r = row as { premise?: unknown; because?: unknown; conflict?: unknown };
    const because = (Array.isArray(r.because) ? r.because : []).map((b) => (b && typeof b === "object" ? { file: (b as { file?: unknown }).file ?? null, quote: (b as { quote?: unknown }).quote ?? null } : null));
    out.set(file, canonicalJson({ premise: r.premise ?? null, because, conflict: Array.isArray(r.conflict) ? r.conflict : [] }));
  }
  return out;
}

/* --------------------------------------------------------------------------------------------- *
 * The tree: reading a line, hashing a file, replaying a search.
 * --------------------------------------------------------------------------------------------- */

/** The most entries `TreeReader.plainFiles` lists before it gives up: a bound on the time a listing may take. */
export const PLAIN_LISTING_MAX = 1_000_000;

/** One tree, read once. Every digest below comes through here, so a file is opened at most once. */
export class TreeReader {
  private readonly cache = new Map<string, string[] | null>();
  private readonly digests = new Map<string, string | null>();
  /** C2-4: the lines (0-based) whose CR LF end `lines` cut off, by file; a file with none has no entry. */
  private readonly crs = new Map<string, Set<number>>();
  private files: string[] | null = null;
  /** The host engine's runs over this tree, by engine and arguments: each search runs once per reader. */
  readonly engineRuns = new Map<string, ReturnType<typeof runHostEngine>>();

  constructor(readonly root: string) {}

  /** The scanned files of this tree, through the same walker the scan itself uses. */
  scannedFiles(): string[] {
    if (this.files === null) this.files = walkTarget(this.root).files.slice().sort();
    return this.files;
  }

  private scannedSetMemo: Set<string> | null = null;
  /** `scannedFiles` as a set. */
  scannedSet(): Set<string> {
    if (this.scannedSetMemo === null) this.scannedSetMemo = new Set(this.scannedFiles());
    return this.scannedSetMemo;
  }

  private plain: { files: string[]; links: string[] } | { problem: string } | null = null;
  /**
   * EVERY FILE OF THE TREE, as a plain listing: each regular file below the
   * root, from the root, hidden names, ignored files, version-control folders and `node_modules` included, nothing
   * left out by name, size or kind. A symbolic link is not a file here and a linked folder is not entered, as ripgrep's
   * walk does not follow links unless asked (`--follow`, which neither of the host's tools passes). Every symbolic link
   * met is listed apart (`links`, from the root, not entered). Nothing is
   * opened and nothing is run. A folder that cannot be listed, or a tree of more than `PLAIN_LISTING_MAX` entries, gives
   * a problem instead: no listing then shows what the host's search could reach.
   */
  plainFiles(): { files: string[]; links: string[] } | { problem: string } {
    if (this.plain !== null) return this.plain;
    const files: string[] = [];
    const links: string[] = [];
    const stack: string[] = [""];
    let seen = 0;
    while (stack.length > 0) {
      const rel = stack.pop()!;
      let entries: Dirent[];
      try {
        entries = readdirSync(rel === "" ? this.root : join(this.root, rel), { withFileTypes: true });
      } catch (e) {
        this.plain = { problem: `the folder ${JSON.stringify(rel === "" ? "." : rel)} cannot be listed (${(e as Error).message})` };
        return this.plain;
      }
      for (const d of entries) {
        seen += 1;
        if (seen > PLAIN_LISTING_MAX) {
          this.plain = { problem: `the tree holds more than ${PLAIN_LISTING_MAX} entries` };
          return this.plain;
        }
        const child = rel === "" ? d.name : `${rel}/${d.name}`;
        if (d.isDirectory()) stack.push(child);
        else if (d.isFile()) files.push(child);
        else if (d.isSymbolicLink()) links.push(child);
      }
    }
    this.plain = { files: files.sort(), links: links.sort() };
    return this.plain;
  }

  lines(rel: string): string[] | null {
    if (this.cache.has(rel)) return this.cache.get(rel) ?? null;
    let out: string[] | null = null;
    try {
      const full = join(this.root, rel);
      if (existsSync(full) && statSync(full).isFile()) {
        // Cut at CR LF or LF, as before; the lines whose carriage return was cut are kept apart for `rawLine` (C2-4).
        out = readSourceText(full).split("\n");
        const cr = new Set<number>();
        for (let k = 0; k < out.length - 1; k++) {
          if (out[k]!.endsWith("\r")) {
            out[k] = out[k]!.slice(0, -1);
            cr.add(k);
          }
        }
        if (cr.size > 0) this.crs.set(rel, cr);
      }
    } catch {
      out = null;
    }
    this.cache.set(rel, out);
    return out;
  }

  /** C2-4: the line at a 0-based index as the file holds it - with the carriage return `lines` cut, where it had one. */
  rawLine(rel: string, index: number): string {
    const line = this.lines(rel)?.[index] ?? "";
    return this.crs.get(rel)?.has(index) ? `${line}\r` : line;
  }

  sha256(rel: string): string | null {
    if (this.digests.has(rel)) return this.digests.get(rel) ?? null;
    let out: string | null = null;
    try {
      const full = join(this.root, rel);
      if (existsSync(full) && statSync(full).isFile()) out = projectFileDigest(readRegularFile(full));
    } catch {
      out = null;
    }
    this.digests.set(rel, out);
    return out;
  }

  /**
   * The text at a 1-based line, value-free and folded. The empty string where the line is not there to read. Value-free: the content key and the facts digest are
   * written in the evidence log, and a digest of a line holding a guessable credential could be reversed by hashing
   * candidates; a line with nothing to redact folds as before, so no other key moves.
   */
  foldedLine(rel: string, line: number): string {
    const lines = this.lines(rel);
    if (!lines || line < 1 || line > lines.length) return "";
    return foldText(valueFreeText(productPrintedRedaction(), lines[line - 1] ?? ""));
  }
}

/**
 * The seat's prose about where it searched, resolved ONCE into a scope a machine can replay.
 *
 * Seats write this field in their own words - "whole repository", "backend/src", an absolute tree
 * path with a parenthetical after it, a pointer into a payload file. A path that resolves inside the
 * tree becomes the scope; anything else is replayed over the whole tree, which is the wider reading
 * and therefore the one that cannot hide a change.
 * The path the prose names is resolved by `searchScopeOf`, as every row's
 * scope is: `src/`, `./src`, `src/.`, `src//` and `.legal/../src` are `src`, and a link is followed, so the row's
 * digest is taken over the files its folder holds (before, such a row was digested over no file at all). A path that
 * names nothing in the tree is the whole tree, as before. A path whose real path leaves the tree is digested over the
 * whole tree too (before, a folder beside the tree was kept as `../name` and digested over no file), and `outside`
 * says so: the assembly then records the row under `untaken`, so no later run carries the verdict on it.
 * The path goes to `searchScopeOf` AS WRITTEN: an absolute path stays
 * absolute (before, the tree's own path was cut from the front of the text and every leading `/` stripped, so
 * `/elsewhere/lib` became the folder `elsewhere/lib` of the tree, missing, and the whole tree with nothing under
 * `untaken`; and `<tree>-old/lib`, a sibling whose name begins with the tree's, became `-old/lib`), `~` is the home
 * folder. A spelling this program cannot place in the tree is outside it, never "a missing folder inside the tree":
 * one beginning with `~` and a user name, `$` or `%` (a variable), a drive letter or a backslash, and one whose
 * backslashes, read as `/`, leave the tree. Words with spaces between them are read as the whole tree, as before,
 * unless one of them is a path written from outside the tree's own names (absolute, `~`, a variable, a drive, or a
 * `..` part) that is outside it. `written` is the one path the words name, where they name one: the host's Glob cut
 * is tested on it (`hostGlobCutProblem`). The same function gives the scope again on every later run, from the same
 * words, and a row whose scope it now gives otherwise is read again (`scopeNowOf`).
 * On Windows a drive path (`D:\work\proj\src`,
 * `C:/...`), a share (`\\server\share\...`), `~\` and backslashes between names are how the host itself writes a
 * path, so they are placed as the host places them (`searchScopeOf`, in the platform's own path rules), as an absolute
 * POSIX path is elsewhere; before, every one of them was "a place this program cannot place in the tree", so on Windows
 * no verdict resting on a search the seat ran with a path was ever carried, and every later scan judged it again. Still
 * outside on Windows: `~` and a user name, a variable, a path relative to a drive (`C:src`) and one from the current
 * drive's root (`\src`). Elsewhere nothing changes. `platform`: the caller's (tests name another).
 */
export function resolveSearchScope(paths: string | undefined, root: string, platform: NodeJS.Platform = process.platform): { scope: TreeScope; flags: string; outside?: string; written?: string } {
  const prose = (paths ?? "").trim();
  const flags = /case.?insensitive/i.test(prose) ? "i" : "";
  if (!prose) return { scope: WHOLE_TREE, flags };
  const text = (prose.replace(/\s*\([^)]*\)\s*$/, "").trim().split("#")[0] ?? "").trim();
  if (!text) return { scope: WHOLE_TREE, flags };
  const outsideOf = (named: string, why: string) => ({ scope: WHOLE_TREE, flags, outside: `the seat's words name ${JSON.stringify(named.slice(0, 80))}, which ${why}, so no replay of the tree reads what the search searched` });
  // One path: placed as the host would place it, or outside.
  const place = (one: string): { at: "tree"; scope: TreeScope } | { at: "missing" } | { at: "outside"; why: string } => {
    const unplaceable =
      platform === "win32"
        ? /^~[^/\\]/.test(one) || /^[$%]/.test(one) || /^[A-Za-z]:(?![/\\])/.test(one) || /^\\(?!\\)/.test(one)
        : /^~[^/]/.test(one) || /^[$%]/.test(one) || /^[A-Za-z]:/.test(one) || one.startsWith("\\");
    if (unplaceable) return { at: "outside", why: "this program cannot place in the tree (a user's home, a variable, a drive or a Windows path)" };
    const where = searchScopeOf(root, one);
    if (where.at === "outside") return { at: "outside", why: where.why ?? "is outside the tree" };
    if (one.includes("\\") && searchScopeOf(root, one.replace(/\\/g, "/")).at === "outside") return { at: "outside", why: "is outside the tree once its backslashes are read as folder separators" };
    return where.at === "tree" ? { at: "tree", scope: where.scope } : { at: "missing" };
  };
  if (!/\s/.test(text)) {
    const where = place(text);
    if (where.at === "outside") return outsideOf(text, where.why);
    return where.at === "tree" ? { scope: where.scope, flags, written: text } : { scope: WHOLE_TREE, flags, written: text };
  }
  // Words: an absolute path with spaces in it where it is one place (a tree whose path holds a space); otherwise the whole
  // tree, as before, unless a word is a path written from outside the tree's own names that is outside it. The tree's own
  // path, where the words spell it out, is read as the tree (`<tree>/src and lib` names nothing outside it).
  if (/^[/~]/.test(text) || (platform === "win32" && /^([A-Za-z]:[/\\]|\\\\)/.test(text))) {
    const whole = place(text);
    if (whole.at === "tree") return { scope: whole.scope, flags, written: text };
    if (whole.at === "outside") return outsideOf(text, whole.why);
  }
  let words = text;
  for (const spelling of new Set([resolve(root), realRootOf(root)])) {
    words = words.split(spelling).map((piece, k) => (k > 0 && (piece === "" || /^[/\s]/.test(piece)) ? `.${piece}` : k > 0 ? `${spelling}${piece}` : piece)).join("");
  }
  for (const word of words.split(/[\s,;]+/)) {
    const one = word.replace(/^[`'"<\[({]+|[`'">\])},:;]+$/g, "");
    if (!one || !(/^[/\\~$%]/.test(one) || /^[A-Za-z]:/.test(one) || /(^|[/\\])\.\.([/\\]|$)/.test(one))) continue;
    const where = place(one);
    if (where.at === "outside") return outsideOf(one, where.why);
  }
  return { scope: WHOLE_TREE, flags };
}

/**
 * Replay one search over the tree and digest its hit set.
 *
 * The hit set is a sorted MULTISET of the path and the folded line - a multiset so that a second
 * copy of a line that already matched is a change, and folded and position-free so that the same
 * line one row further down is not. This is the only new engine piece unit H adds, and it is a
 * plain search.
 *
 * ## The surface, and why no recorded search is carried on it alone
 *
 * This function walks `tree.scannedFiles()`, the scanner's own walker, for a `grep` row exactly as
 * for a `glob` row (`replayGlob`). A file the scanner EXCLUDES - a test, a spec, a mock, a lock
 * file, a hidden folder, a file over the walker's size bound, `node_modules` - is outside its hit
 * set, so on its own it cannot see a matching line land in such a file.
 * So no comparison lets it stand for a recorded search on its own. Every
 * row a later run compares goes through `replayRecorded`: a row holding the host call's `input` is replayed by the
 * host's engine where the capture found one, and otherwise, like every row with no `input` (a row of a log written
 * before the capture kept it, and a reply's own `searched[]` row), only through `fallbackReplay`, which reaches this
 * function only where a plain listing of the row's scope holds no file the host's search could reach that this walk
 * does not read - checked on each run's own tree; a Glob holding the input is replayed over that plain listing
 * instead, and one with no input stands only where that listing agrees with this walk's (`inputlessReplay`). A reply's
 * `searched[]` row is digested here when the verdict is assembled (`buildRestsOn`), and the same check is made there:
 * where it fails, the block records why under `untaken`, so the verdict is not carried. The one row left to this
 * function's surface alone is a search of the program's own records (`.legal`, `inputlessReplay`): no file there is
 * the tree's, and what the seat was handed is a premise of its own (premise 5).
 *
 * Its scope is a canonical one (host-search.ts `searchScopeOf`, the `TreeScope` type): a row is judged over the file set
 * of that scope alone.
 *
 * Files a seat READ are not subject to it: `TreeReader.sha256()` hashes any path in the tree,
 * scanned or not, so the `files` premise covers an excluded file the seat opened. The cost is
 * fidelity to the seat's own `hits`, which is carried as `seat_hits` and never compared.
 */
export function replaySearch(
  tree: TreeReader,
  pattern: string,
  scope: TreeScope,
  flags: string,
  tool?: ReadingSearchTool,
  opts: { at?: boolean; glob?: string } = {},
): { hits: number; hit_hash: string; dialect?: string; at?: string[] } | { unreplayable: string } {
  if (tool === "glob") return replayGlob(tree, pattern, scope, opts);
  /* A Grep narrowed by `glob` searches only the files ripgrep's overrides keep (host-search.ts
   * `hostGlobFilter`); a piece of a shape this replay does not read makes the search unreplayable here. */
  let kept: ((rel: string) => boolean) | null = null;
  if (opts.glob !== undefined && opts.glob.trim() !== "") {
    const filter = hostGlobFilter(opts.glob, scope);
    if (typeof filter !== "function") return { unreplayable: `today's replay does not read the search's glob: ${filter.unsupported}.` };
    kept = filter;
  }
  // VA-7: a multiline search (the host's Grep with `multiline: true`) is replayed over each file's whole text, as the
  // host ran it, a match spanning lines included; `^` and `$` still match at every line, as the host's do. The host runs it as `rg -U --multiline-dotall` (Claude Code's own Grep text), so `.` matches a line end
  // too - the `s` flag; without it a match spanning lines through `.` was replayed as finding nothing.
  const multiline = flags.includes(MULTILINE_FLAG);
  let re: RegExp;
  let host: { pattern: string; flags: string };
  try {
    host = hostRegex(pattern, flags.split(MULTILINE_FLAG).join(""));
    re = new RegExp(host.pattern, multiline ? [...new Set([...host.flags, "g", "m", "s"])].join("") : host.flags);
  } catch (e) {
    return { unreplayable: `the recorded pattern does not compile as a regular expression: ${(e as Error).message}` };
  }
  /* C2-4: a construct ripgrep reads otherwise on any text makes the search unreplayable; one it reads otherwise
   * only on some characters makes every line of the scope holding such a character (in a search across lines, every such
   * file) part of what the replay records (`dialect`), so a later edit that adds or changes one is seen with no host. */
  const dialect = dialectOf(host.pattern, { caseless: host.flags.includes("i"), acrossLines: multiline });
  if (dialect.unreplayable) return { unreplayable: dialect.unreplayable };
  const sensitive: string[] = [];
  const inScope = (rel: string) => scope === "" || rel === scope || rel.startsWith(`${scope}/`);
  const hits: string[] = [];
  /* Where asked, every line a hit covers as `path:line`, for the comparison with what the host returned. */
  const at: string[] = [];
  for (const rel of tree.scannedFiles()) {
    if (!inScope(rel)) continue;
    if (kept && !kept(rel)) continue;
    const lines = tree.lines(rel);
    if (!lines) continue;
    if (dialect.sensitive) {
      if (multiline) {
        if (lines.some((_, k) => dialect.sensitive!(tree.rawLine(rel, k)))) sensitive.push(`${rel}${FIELD_SEP}${tree.sha256(rel) ?? ""}`);
      } else {
        lines.forEach((_, k) => {
          const raw = tree.rawLine(rel, k);
          if (dialect.sensitive!(raw)) sensitive.push(`${rel}${FIELD_SEP}${raw}`);
        });
      }
    }
    if (multiline) {
      // Each match is its whole lines, as the host prints them: the lines from the one it starts on to the one it ends on.
      const text = lines.join("\n");
      const starts = [0];
      for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
      const lineAt = (offset: number): number => {
        let lo = 0;
        let hi = starts.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (starts[mid]! <= offset) lo = mid;
          else hi = mid - 1;
        }
        return lo;
      };
      for (const m of text.matchAll(re)) {
        const first = lineAt(m.index ?? 0);
        const last = lineAt(Math.max(m.index ?? 0, (m.index ?? 0) + m[0].length - 1));
        hits.push(`${rel}${FIELD_SEP}${foldText(lines.slice(first, last + 1).join("\n"))}`);
        if (opts.at) for (let n = first; n <= last; n++) at.push(`${rel}:${n + 1}`);
      }
      continue;
    }
    lines.forEach((line, i) => {
      re.lastIndex = 0;
      if (re.test(line)) {
        hits.push(`${rel}${FIELD_SEP}${foldText(line)}`);
        if (opts.at) at.push(`${rel}:${i + 1}`);
      }
    });
  }
  hits.sort();
  return {
    hits: hits.length,
    hit_hash: treeLinesDigest(hits.join("\n")),
    ...(dialect.sensitive ? { dialect: treeLinesDigest(JSON.stringify(sensitive.sort())) } : {}),
    ...(opts.at ? { at: [...new Set(at)].sort() } : {}),
  };
}

/**
 * C2-4: where a recorded search and its replay today disagree on `dialect`, why the replay cannot stand for
 * the host's search; null where they agree. One comparison for every premise that replays a search (a verdict's,
 * a place's, an answer seat's). A record written before this comparison carries no digest, so a pattern that has one
 * today is read again once rather than carried on a digest it never took.
 */
export function dialectMoved(recorded: RestsOnSearch, replayed: { dialect?: string }): string | null {
  if (recorded.dialect === replayed.dialect) return null;
  const multiline = recorded.flags.includes(MULTILINE_FLAG);
  const host = hostRegex(recorded.pattern, recorded.flags.split(MULTILINE_FLAG).join(""));
  const constructs = dialectOf(host.pattern, { caseless: host.flags.includes("i"), acrossLines: multiline }).constructs;
  return `the search ${JSON.stringify(recorded.pattern.slice(0, 60))} holds ${constructs.length > 0 ? constructs.join(", ") : "a construct"}, which the host's search (ripgrep) and this replay read differently on some characters, and the lines of its scope that hold such characters are not the ones it was recorded over${recorded.dialect === undefined ? " (its record took no such digest)" : ""}: the replay cannot stand for the host's search.`;
}

/* --------------------------------------------------------------------------------------------- *
 * A recorded row, replayed as it was recorded.
 * --------------------------------------------------------------------------------------------- */

const firstLine = (text: string): string => text.split("\n")[0] ?? "";

/**
 * The digest a search of a path the tree does not hold replays to: the host's Grep refused it ("Path does not exist")
 * before ripgrep ran, and the replay gives the same outcome while the path is still missing - never the digest of an
 * empty hit set, so the path's appearing, with or without a matching line, is a change.
 */
export function missingPathHash(scope: string): string {
  return sha256Hex(`path-missing${FIELD_SEP}${scope}`);
}

/** What the host's engine is asked, from a row's own fields. */
export function engineRequestOf(row: Pick<RestsOnSearch, "pattern" | "flags" | "glob" | "type"> & { scope: TreeScope; tool?: string }): EngineRequest {
  return {
    ...(row.tool === "glob" ? { tool: "glob" as const } : {}),
    pattern: row.pattern,
    scope: row.scope,
    caseless: row.flags.includes("i"),
    multiline: row.flags.includes(MULTILINE_FLAG),
    ...(row.glob !== undefined && row.glob.trim() !== "" ? { glob: row.glob } : {}),
    ...(row.type !== undefined && row.type !== "" ? { type: row.type } : {}),
  };
}

/** A Glob's listed files, digested as `replayGlob` digests its hits: the sorted paths, one per line. */
const listedHash = (files: readonly string[]): string => sha256Hex([...files].sort().join("\n"));

/**
 * One search replayed with the host's own engine over the tree, digested as `replaySearch` digests its hits (the path
 * and the folded matched lines, a sorted multiset), or for a Glob as `replayGlob` digests its files; where asked, every
 * line a match covers as `path:line` (a Glob's files). Where ripgrep refused the arguments, the outcome is that refusal
 * (`refused`), digested with what it said: ripgrep reads its arguments before it searches, so the same engine refuses
 * the same arguments over any tree. Each run is kept on the tree's reader, so the places of one seat run its searches
 * once.
 */
export function engineReplay(
  tree: TreeReader,
  q: EngineRequest,
  engine: HostEngine,
  opts: { at?: boolean } = {},
  clock: EngineClock = CARRY_CLOCK,
): { hits: number; hit_hash: string; at?: string[]; refused?: string } | { unreplayable: string } {
  const key = JSON.stringify([engine.path, engine.version, q]);
  let run = tree.engineRuns.get(key);
  if (run === undefined) {
    run = runHostEngine(engine, tree.root, q, clock);
    // A run the clock did not allow is not kept: another process, with time left, may make it.
    if (!("failed" in run)) tree.engineRuns.set(key, run);
  }
  if ("failed" in run) return { unreplayable: `the host's own search engine cannot stand for the search: ${run.failed}.` };
  // Keyed as the other two forms: the engine's error text quotes the
  // seat's pattern, which may hold a credential with a metacharacter in it.
  if ("refused" in run) return { hits: 0, hit_hash: treeLinesDigest(`engine-refused${FIELD_SEP}${run.refused}`), refused: run.refused, ...(opts.at ? { at: [] } : {}) };
  if ("listed" in run) return { hits: run.listed.length, hit_hash: listedHash(run.listed), ...(opts.at ? { at: [...run.listed] } : {}) };
  const hits: string[] = [];
  const at: string[] = [];
  for (const m of run.matches) {
    hits.push(`${m.file}${FIELD_SEP}${foldText(m.text)}`);
    if (opts.at) for (let k = 0; k < m.text.split("\n").length; k++) at.push(`${m.file}:${m.line + k}`);
  }
  hits.sort();
  return { hits: hits.length, hit_hash: treeLinesDigest(hits.join("\n")), ...(opts.at ? { at: [...new Set(at)].sort() } : {}) };
}

/**
 * TODAY'S REPLAY OF A CAPTURED SEARCH, WHERE NO ENGINE STANDS FOR IT - only
 * where it searches at least every file the host's search could have searched. Today's replay reads the scanner's own
 * read scope (`scannedFiles`), which leaves out tests, specs, mocks, fixtures, lock files, hidden folders, large files
 * and `node_modules`, all of which the host's ripgrep searches; a search that matched nothing there when the seat ran
 * it would otherwise be carried after a matching line lands there. So:
 * - a Grep stands only where every file of the tree's plain listing (`plainFiles`) below its scope that the host's
 *   pieces let through (`hostGlobFilter`: its version-control pieces, the seat's glob, the guard's `.legal` piece) - or,
 *   for a search of one file, that file - is a file the replay reads; the first one it does not read makes the search
 *   unreplayable, at capture and at every later run, so a new such file is seen too. Erring wider is allowed (the
 *   listing holds ignored files ripgrep skips), erring narrower never;
 * - a Glob is replayed over the plain listing itself, the pattern read as ripgrep reads the host Glob's one piece
 *   (`hostGlobToolFilter`), no file left out but by the pattern; a pattern the host rewrites, or a Glob run with its
 *   flags changed, is unreplayable (`globToolProblem`).
 * A glob of a shape this replay does not read, a `type`, and a glob on a search of one file are unreplayable here, and so
 * is a folder holding a symbolic link this replay does not follow.
 * The same rule holds a row with no `input` (`inputlessReplay`): such a row
 * names no host call whose input could be checked, so this check, made on each run's own tree, is all that lets
 * today's replay stand for it.
 */
export function fallbackReplay(
  tree: TreeReader,
  row: { pattern: string; scope: TreeScope; flags: string; tool?: ReadingSearchTool; glob?: string; type?: string; written: string | undefined },
  opts: { at?: boolean; env?: NodeJS.ProcessEnv } = {},
): { hits: number; hit_hash: string; dialect?: string; at?: string[] } | { unreplayable: string } {
  const listing = tree.plainFiles();
  if ("problem" in listing) return { unreplayable: `today's replay cannot be shown to search every file the host's search could: ${listing.problem}.` };
  const inScope = (rel: string) => row.scope === "" || rel.startsWith(`${row.scope}/`);
  const read = tree.scannedSet();
  /* A symbolic link below the searched folder that this replay does not
   * follow: the walker reads a link to a file of the tree and no other link, and the plain listing a Glob is replayed
   * over follows none. The engine's ripgrep follows no link it meets below the searched path, but nothing here shows
   * how the host's search was run (another ripgrep, its configuration), and a search that followed it would search
   * files this replay never lists: not provably covered, so read again. */
  const linked = listing.links.filter((rel) => inScope(rel) && (row.tool === "glob" || !read.has(rel)));
  if (linked.length > 0) {
    return { unreplayable: `${linked[0]}${linked.length > 1 ? ` and ${linked.length - 1} other link(s)` : ""} below the searched folder is a symbolic link that today's replay does not follow, and a search of the folder that followed it would search files this replay does not list, so it cannot stand for the search where the host's own engine does not.` };
  }
  if (row.tool === "glob") {
    /* The folder is the canonical scope below the tree's real root (it
     * holds no link); the host's pattern cut is tested on the path the seat wrote, as the host holds it, never on this
     * folder's real path (`hostGlobCutProblem`). */
    let isFolder = row.scope === "";
    if (!isFolder) {
      try {
        isFolder = statSync(join(realRootOf(tree.root), row.scope)).isDirectory();
      } catch {
        isFolder = false;
      }
    }
    if (!isFolder) return { unreplayable: "the Glob names a path that is not a folder of the tree, which this replay does not list." };
    const problem = hostGlobCutProblem(row.pattern, tree.root, row.written, opts.env ?? {});
    if (problem) return { unreplayable: problem };
    const keep = hostGlobToolFilter(row.pattern, row.scope);
    if (typeof keep !== "function") return { unreplayable: `today's replay does not read the Glob's pattern: ${keep.unsupported}.` };
    const listed = listing.files.filter((rel) => inScope(rel) && keep(rel));
    return { hits: listed.length, hit_hash: listedHash(listed), ...(opts.at ? { at: listed } : {}) };
  }
  if (row.type !== undefined && row.type !== "") return { unreplayable: `today's replay does not read a ripgrep file type (the search's type ${JSON.stringify(row.type)}).` };
  const glob = row.glob !== undefined && row.glob.trim() !== "" ? row.glob : undefined;
  const oneFile = row.scope !== "" && tree.lines(row.scope) !== null;
  if (oneFile) {
    if (glob !== undefined) return { unreplayable: "today's replay does not read a glob on a search of one file." };
    if (!read.has(row.scope)) return { unreplayable: `today's replay does not read ${row.scope}, the one file the host's search searched, so it cannot stand for it.` };
  } else {
    const could = hostGlobFilter(glob ?? "", row.scope);
    if (typeof could !== "function") return { unreplayable: `today's replay does not read the search's glob: ${could.unsupported}.` };
    const unread = listing.files.filter((rel) => inScope(rel) && could(rel) && !read.has(rel));
    if (unread.length > 0) {
      return { unreplayable: `today's replay does not read ${unread[0]}${unread.length > 1 ? ` and ${unread.length - 1} other file(s)` : ""} below the searched folder, which the host's search could have searched, so it cannot stand for the search where the host's own engine does not.` };
    }
  }
  return replaySearch(tree, row.pattern, row.scope, row.flags, row.tool, { ...(opts.at ? { at: true } : {}), ...(glob !== undefined ? { glob } : {}) });
}

/** The `for` of every row the capture writes for a search the seat ran (place-premises.ts `searchPremiseOf`). */
export const SEAT_SEARCH_FOR = "a search the seat ran";

/** The tree's root with every link in it followed (the root as given where it cannot be read). */
function realRootOf(root: string): string {
  try {
    return realpathSync(root);
  } catch {
    return root;
  }
}

/**
 * THE SCOPE A ROW'S WRITTEN PATH GIVES ON THIS TREE, for a later run. The
 * host's behaviour is applied to what the seat wrote, at every run: the scope is derived again from it and compared
 * with the scope the row was digested over (its recorded `scope`), never taken from that record. What the seat wrote is
 * the host call's `path` for a row holding the input, `paths` for a capture's row with none (a row of an earlier log,
 * a search of the program's own files), and for a reply's own `searched[]` row (one whose `for` is the seat's, not
 * `SEAT_SEARCH_FOR`) the folder its words name, read by `resolveSearchScope` as at assembly (the flags it reads from
 * the same words are compared too). Any difference - a link in the path re-pointed, made or removed, a folder that
 * became a link, words this code now reads otherwise - and a path now outside the tree are read again: the host's
 * search of the same input today reads another folder, or one no replay of the tree reads. `written` is the one path
 * the seat wrote, where there is one, for the host's Glob cut (`hostGlobCutProblem`).
 */
export function scopeNowOf(root: string, row: RestsOnSearch): { at: "tree"; scope: TreeScope; written: string | undefined } | { at: "missing"; scope: string; written: string | undefined } | { unreplayable: string } {
  const recorded = typeof row.scope === "string" ? row.scope : "";
  if (row.input === undefined && row.for !== SEAT_SEARCH_FOR) {
    const now = resolveSearchScope(typeof row.paths === "string" ? row.paths : undefined, root);
    if (now.outside !== undefined) return { unreplayable: `${now.outside}.` };
    if (now.scope !== recorded || now.flags !== row.flags) {
      return { unreplayable: `the seat's words about where it searched (${JSON.stringify(String(row.paths ?? "").slice(0, 80))}) give the scope ${JSON.stringify(now.scope)}${now.flags ? " without regard to case" : ""} on this tree, and the row was digested over ${JSON.stringify(recorded.slice(0, 80))}${row.flags ? ` with the flags ${JSON.stringify(row.flags)}` : ""}, so a replay of the row would not search what its search searched now.` };
    }
    return { at: "tree", scope: now.scope, written: now.written };
  }
  const input = row.input as Record<string, unknown> | undefined;
  const written = input !== undefined ? (typeof input.path === "string" ? input.path : undefined) : typeof row.paths === "string" ? row.paths : undefined;
  const where = searchScopeOf(root, written);
  if (where.at === "outside") return { unreplayable: outsideReason(written, where.why) };
  if (where.scope !== recorded) {
    return { unreplayable: `the searched path ${JSON.stringify((written ?? "(none: the host's working folder)").slice(0, 80))} gives ${where.at === "missing" ? "the missing path" : "the scope"} ${JSON.stringify(where.scope.slice(0, 80))} on this tree, and the row was digested over ${JSON.stringify(recorded.slice(0, 80))}: a symbolic link in the path was re-pointed, made or removed since, so the host's search of the same input now reads another folder.` };
  }
  return where.at === "tree" ? { at: "tree", scope: where.scope, written } : { at: "missing", scope: where.scope, written };
}

/**
 * THE ONE REPLAY OF A RECORDED SEARCH ROW, for every comparison that replays one: a verdict's searches (carry-forward.ts)
 * and a place's and an answer seat's (place-premises.ts `seatBasisChange`). A row is replayed as it was recorded:
 * - a row holding the host call's input is replayed only where every key and value in it is understood
 *   (host-search.ts `searchInputProblem`), so a row a later build of this program wrote is read again by this one;
 * - a row the host's engine replayed is replayed by that engine alone: another engine, or none, reads the place again;
 * - the row's scope is derived on this tree from what the seat wrote - the host call's `path`, else `paths`; for a reply's
 *   row, the folder its words name - by `searchScopeOf`, the one function every row's scope goes through, and compared
 *   with the scope the row was digested over (`scopeNowOf`): a
 *   path that now resolves outside the tree, or to another scope (a link in it re-pointed, made or removed), is read
 *   again; a row holding the input whose searched path the tree no longer holds gives the host's own outcome for it
 *   (`missingPathHash`), and a row with none is read again (a search of a path outside the tree is never captured
 *   complete: place-premises.ts `searchPremiseOf`); every replay below runs over the scope derived on this run;
 * - every other row holding the input is today's replay where it searches at least what the host could
 *   (`fallbackReplay`), checked again on this run's tree;
 * - a row with no input (written before the capture kept it, or a reply's own
 *   `searched[]` row) goes through the same check (`inputlessReplay`), on this run's tree: today's replay stands for it
 *   only where the row's scope holds no file the host's search could reach that the replay does not read (a Glob: only
 *   where the plain listing lists what the replay lists), so it is never carried where today's replay alone would not
 *   carry it. It is never replayed by the host's engine: nothing in such a row shows that the
 *   call it stands for was ripgrep's, with which pieces (the capture before the input dropped every Grep's `glob` and
 *   `type`; a reply's row is the seat's own words), so no engine call can be shown to be the host's. A row naming an
 *   engine and no input is read again.
 */
export function replayRecorded(tree: TreeReader, row: RestsOnSearch, opts: { at?: boolean } = {}): { hits: number; hit_hash: string; dialect?: string; at?: string[] } | { unreplayable: string } {
  /* `at`: where asked, the places the replay found, as the
   * replay below gives them (`path:line` for a Grep, the listed path for a Glob), so a caller reads the same replay the
   * search premise compares, never another one (carry-forward.ts `packageChangeCounts`). */
  const at = opts.at ? { at: true } : {};
  try {
    if (row.input !== undefined) {
      const problem = searchInputProblem(row.tool === "glob" ? "glob" : "grep", row.input);
      if (problem) return { unreplayable: problem };
    } else if (row.engine) {
      return { unreplayable: "the row names the host's own search engine but not the host call's input, so no call of that engine can be shown to be the search the host ran." };
    }
    if (row.engine) {
      const now = hostEngineNow(process.env, tree.root, CARRY_CLOCK);
      if ("missing" in now) return { unreplayable: `the search was replayed with the host's own search engine (${row.engine.path}, ${firstLine(row.engine.version)}), and this run has none (${now.missing}).` };
      if (now.path !== row.engine.path || now.version !== row.engine.version) {
        return { unreplayable: `the search was replayed with the host's own search engine ${row.engine.path} (${firstLine(row.engine.version)}), and this run's is ${now.path} (${firstLine(now.version)}): it is read again rather than replayed with another engine.` };
      }
    }
    /* The row's scope on THIS tree, derived again from what the seat
     * wrote (`scopeNowOf`), never from the scope recorded earlier: outside the tree, or another scope than the one the row
     * was digested over (a link in the path re-pointed, made or removed), read again; missing, the host's own outcome
     * for a row holding the input, and read again for a row with none; otherwise every replay below runs over the scope
     * derived here, which is the recorded one. */
    const now = scopeNowOf(tree.root, row);
    if ("unreplayable" in now) return now;
    if (now.at === "missing") {
      if (row.input !== undefined) return { hits: 0, hit_hash: missingPathHash(now.scope), ...(opts.at ? { at: [] } : {}) };
      return { unreplayable: `the searched path ${JSON.stringify(now.scope.slice(0, 80))} is not in this tree, and the row records no input of the host call, so nothing shows what the host's search of it gives now.` };
    }
    if (row.engine) {
      // The engine is given the pattern uncut, so the host's cut is tested here, on this run, from the written path.
      if (row.tool === "glob") {
        const cut = hostGlobCutProblem(row.pattern, tree.root, now.written, {});
        if (cut) return { unreplayable: cut };
      }
      const r = engineReplay(tree, engineRequestOf({ ...row, scope: now.scope }), row.engine, at, CARRY_CLOCK);
      return "unreplayable" in r ? r : { hits: r.hits, hit_hash: r.hit_hash, ...(opts.at && r.at ? { at: r.at } : {}) };
    }
    if (row.input !== undefined) {
      const r = fallbackReplay(tree, { ...row, scope: now.scope, written: now.written }, at);
      return "unreplayable" in r ? r : { hits: r.hits, hit_hash: r.hit_hash, ...(r.dialect ? { dialect: r.dialect } : {}), ...(opts.at && r.at ? { at: r.at } : {}) };
    }
    if (row.type !== undefined) return { unreplayable: "the row names a ripgrep file type and no engine, and today's replay does not read a file type." };
    const r = inputlessReplay(tree, { ...row, scope: now.scope, written: now.written }, at);
    return "unreplayable" in r ? r : { hits: r.hits, hit_hash: r.hit_hash, ...(r.dialect ? { dialect: r.dialect } : {}), ...(opts.at && r.at ? { at: r.at } : {}) };
  } catch (e) {
    return { unreplayable: `the search could not be replayed (${(e as Error).message}).` };
  }
}

/** The folder of the program's own records in the tree (legal-dir.ts `LEGAL_DIR_NAME`); the walker never enters it. */
const OWN_RECORDS_DIR = ".legal";

/**
 * Whether a search's scope is the program's own records (`.legal` and below),
 * tested on the canonical scope alone (`searchScopeOf`), so `.legal/../src` is `src` and never the exemption.
 */
export function isOwnRecordsScope(scope: TreeScope): boolean {
  return scope === OWN_RECORDS_DIR || scope.startsWith(`${OWN_RECORDS_DIR}/`);
}

/** Why a search whose written path resolves outside the tree, or cannot be placed in it, is never replayed. */
function outsideReason(written: string | undefined, why?: string): string {
  return `the searched path ${JSON.stringify((written ?? "").slice(0, 80))} ${why ? `is not a place of this tree: ${why}` : "resolves, on this tree, to a place outside it"}, so the host searched files that no replay of the tree reads.`;
}

/**
 * TODAY'S REPLAY OF A SEARCH ROW WITH NO `input` - a row of a log written
 * before the capture kept the host call's input, a reply's own `searched[]` row (which names no host call), or a
 * capture's row of the program's own files - for the carry (`replayRecorded`) and for the check made when a reply's
 * row is assembled (`buildRestsOn`). The rule is `fallbackReplay`'s, on this tree: a Grep stands on today's replay only
 * where the plain listing of its scope holds no file the host's search could reach that the replay does not read (for
 * a search of one file, only where the replay reads that file), and a Glob only where the plain listing, read as the
 * host's Glob reads the pattern, lists exactly what today's replay lists over the scanner's files - the replay the row
 * was digested by, so such a row is never carried where that replay alone would not carry it. The host's
 * engine is never used here (`replayRecorded`). A search of the program's own records (`.legal` and below) is replayed
 * as it always was: no file there is the tree's, the walker reads none of them, and what the seat was handed is a
 * premise of its own (premise 5), so the check would only read the place again for the run's own records.
 */
export function inputlessReplay(
  tree: TreeReader,
  row: { pattern: string; scope: TreeScope; flags: string; tool?: ReadingSearchTool; glob?: string; type?: string; written: string | undefined },
  opts: { at?: boolean } = {},
): { hits: number; hit_hash: string; dialect?: string; at?: string[] } | { unreplayable: string } {
  /* `scope` is the scope derived on THIS tree from what the seat wrote,
   * by its caller (`replayRecorded` through `scopeNowOf`, or `buildRestsOn` through `resolveSearchScope`): a path outside
   * the tree or missing from it never reaches here (a row with no input names no host outcome for a path that is not
   * there, so the caller reads it again), and nothing here derives a scope from a recorded one. */
  if (typeof row.scope !== "string") return { unreplayable: "the row's scope is not a path, so no replay can stand for it." };
  const scope = row.scope;
  if (isOwnRecordsScope(scope)) {
    return replaySearch(tree, row.pattern, scope, row.flags, row.tool, { ...(opts.at ? { at: true } : {}), ...(row.glob !== undefined ? { glob: row.glob } : {}) });
  }
  const listed = fallbackReplay(tree, { ...row, scope }, opts);
  if (row.tool !== "glob" || "unreplayable" in listed) return listed;
  /* A Glob: the plain listing read as the host's Glob reads the pattern stands only where it lists exactly what today's
   * replay lists over the scanner's files, the replay such a row was digested by - so the row moves where either does,
   * and no file the host's Glob could list is one today's replay leaves out. */
  const walked = replaySearch(tree, row.pattern, scope, row.flags, "glob", opts.at ? { at: true } : {});
  if ("unreplayable" in walked) return walked;
  if (walked.hit_hash !== listed.hit_hash) {
    return { unreplayable: `the Glob lists ${listed.hits} file(s) among every file of its folder, read as the host's Glob reads the pattern, and ${walked.hits} among the files the scanner reads, so today's replay cannot stand for it.` };
  }
  return listed;
}

/**
 * A content search as the host ran it. The host's Grep is ripgrep, whose regular expressions take a leading inline flag
 * group - `(?i)posthog` is `posthog` without regard to case - and JavaScript's do not: before 2026-10-01 every such row
 * was unreplayable ("Invalid group"; the skeleton measurement's four `rests-on-incomplete` gaps). A group of
 * the flags that mean the same on one line in both (`i`, `m`, `s`) at the very start of the pattern is read as those
 * flags. Any other inline flag, or one later in the pattern, is left in place, so that row stays unreplayable rather
 * than being replayed with another meaning.
 */
/** The flag a search row carries where the host ran it across lines (a Grep with `multiline: true`); never a JavaScript flag. */
export const MULTILINE_FLAG = "U";

export function hostRegex(pattern: string, flags: string): { pattern: string; flags: string } {
  const lead = /^\(\?([ims]+)\)/.exec(pattern);
  if (!lead) return { pattern, flags };
  return { pattern: pattern.slice(lead[0].length), flags: [...new Set([...flags, ...lead[1]!])].join("") };
}

/**
 * Replay one PATH search - a `glob` row - and digest its hit set.
 *
 * A glob names files, not lines, so the hit set is the sorted set of paths the pattern matches
 * inside the scope, and nothing is read. The matcher is the one the scanner already uses for
 * `detector.file_globs` (`globs.ts`), so a glob is never compiled as a regular expression: `**` in
 * a path pattern means whole segments, and handing it to `new RegExp` is what made this class of
 * row unreplayable before 2026-09-22.
 *
 * The surface is the SCANNED tree, as it is for a content search, and what keeps that surface from
 * standing for a recorded search on its own is stated once, at `replaySearch` above: a later run
 * replays a recorded Glob with the host's engine, or over the tree's plain listing
 * (`fallbackReplay`), and a Glob with no input stands on this function only where that plain
 * listing agrees with it (`inputlessReplay`).
 */
function replayGlob(
  tree: TreeReader,
  pattern: string,
  scope: TreeScope,
  opts: { at?: boolean } = {},
): { hits: number; hit_hash: string; at?: string[] } | { unreplayable: string } {
  let compiled: ReturnType<typeof compileGlobs>;
  try {
    compiled = compileGlobs([pattern]);
  } catch (e) {
    return { unreplayable: `the recorded pattern does not compile as a path glob: ${(e as Error).message}` };
  }
  const inScope = (rel: string) => scope === "" || rel === scope || rel.startsWith(`${scope}/`);
  const hits: string[] = [];
  for (const rel of tree.scannedFiles()) {
    if (!inScope(rel)) continue;
    if (globsAllow(compiled, rel)) hits.push(rel);
  }
  hits.sort();
  return { hits: hits.length, hit_hash: sha256Hex(hits.join("\n")), ...(opts.at ? { at: [...hits] } : {}) };
}

/* --------------------------------------------------------------------------------------------- *
 * Writing the block.
 * --------------------------------------------------------------------------------------------- */

/** The rows the assembly step reads off a verdict to know what the seat opened and searched. */
export interface RestsOnSource {
  /**
   * `reading.read[]` rows, for the files the seat opened: each row's own file, and the file of the
   * member the row is credited to (`kind`, `lines` and `sub_shape` name it).
   */
  read?: { file?: string; kind?: unknown; lines?: unknown; sub_shape?: unknown }[];
  /** `reading.searched[]` rows, verbatim. */
  searched?: { for?: string; pattern?: string; paths?: string; hits?: number; tool?: string }[];
  /** `evidence[]`, whose files the seat also opened - it quoted them. */
  evidence?: { file?: string }[];
  /** The candidate's kind census, where it has one. */
  census?: ReadingCensus | null;
}

export interface BuildRestsOnArgs {
  candidate: Candidate;
  source: RestsOnSource;
  tree: TreeReader;
  rule?: Rule;
  bundleVersion: string;
  bundleFiles?: Record<string, string>;
  /**
   * The per-rule answers the scan settled for THIS candidate's rule, from
   * `answersFromApplicability`. Absent where the document carries no `per_rule_applicability`
   * block, and then the block records no answers and a later run compares none.
   */
  answers?: RestsOnAnswer[];
  /**
   * The instructions this run judges by (`instructions.ts` `instructionsPremise`), taken once by the caller.
   * Absent or carrying a problem, the block is incomplete and never carried.
   */
  instructions?: { premise?: InstructionsPremise; problem?: string };
  /** What every seat of this run was handed beside its payload (`handedPremiseOf` over the findings document). */
  handed?: RestsOnHanded;
  /** The scan's ships premises by file (`shipsFactsOf`), digested into `facts`. */
  ships?: ReadonlyMap<string, string>;
  /**
   * The record's `seat_model`, which the capture wrote from the seat's launch entry. Recorded for a candidate
   * not read place by place where it is a string; anything else records none, and a later run gives the verdict again.
   */
  model?: unknown;
  /** The record's `seat_effort`, which the capture read from the seat's own transcript. */
  effort?: unknown;
  /**
   * The record's `seat_sight` - what the seat's own transcript shows it opened (paths of the tree) and
   * searched (each search as a premise, replayed and held to the host's result at capture). Required for a candidate not
   * read place by place: absent, the block is incomplete.
   */
  sight?: unknown;
  /** The record's `seat_untaken` - what the seat's own transcript could not give when it ended. */
  untaken?: unknown;
}

/** The record's `seat_sight` as the capture writes it, or null where it is not that shape. */
export interface SeatSightStamp {
  files: string[];
  searches: RestsOnSearch[];
  incomplete?: string[];
}
export function seatSightStampOf(value: unknown): SeatSightStamp | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.files) || !v.files.every((f) => typeof f === "string")) return null;
  if (!Array.isArray(v.searches) || !v.searches.every((x) => !!x && typeof x === "object" && typeof (x as { pattern?: unknown }).pattern === "string")) return null;
  if (v.incomplete !== undefined && (!Array.isArray(v.incomplete) || !v.incomplete.every((x) => typeof x === "string"))) return null;
  return { files: v.files as string[], searches: v.searches as RestsOnSearch[], ...(Array.isArray(v.incomplete) && v.incomplete.length > 0 ? { incomplete: v.incomplete as string[] } : {}) };
}

/**
 * The record's `seat_untaken` as the block records it. Absent, nothing was left untaken; a list of sentences,
 * those; any other value says something could not be taken without saying what, so it is kept as a reason of its own
 * rather than read as nothing (a value that cannot be read is never "unchanged").
 */
export function untakenOfRecord(value: unknown): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value) && value.every((x) => typeof x === "string" && x !== "")) return value as string[];
  return ["the record's `seat_untaken` is not a list of sentences, so what its seat's own transcript could not give is not known."];
}

/**
 * The candidate's content key: its rule, and every location as its file plus the FOLDED TEXT of the
 * line it names, sorted. The line number is deliberately absent - that is what makes a candidate
 * which merely moved down its file the same candidate, and it is the identity discipline
 * `reconcile-diff.ts` documents for pillar 2, applied to pillar 1's candidates.
 *
 * A location whose line cannot be read contributes the empty text and is counted in `unreadable`;
 * the caller makes the block incomplete on it, because a key that is partly guessed is a key that
 * can match the wrong verdict.
 */
export function candidateContentKey(candidate: Candidate, tree: TreeReader): { key: string; unreadable: number } {
  const parts: string[] = [];
  let unreadable = 0;
  for (const loc of candidate.locations ?? []) {
    const folded = tree.foldedLine(loc.file, loc.start_line);
    if (!folded) unreadable += 1;
    parts.push(`${loc.file}${FIELD_SEP}${folded}`);
  }
  parts.sort();
  return { key: sha256Hex(`${candidate.rule_id}${FIELD_SEP}${parts.join(ITEM_SEP)}`), unreadable };
}

/** Build the premise block for one verdict from what R1 already records. The seat writes no hash. */
export function buildRestsOn(args: BuildRestsOnArgs): RestsOn {
  const { candidate, source, tree } = args;
  const incomplete: string[] = [];

  const { key, unreadable } = candidateContentKey(candidate, tree);
  if (unreadable > 0) {
    incomplete.push(
      `${unreadable} of ${(candidate.locations ?? []).length} matched location(s) name a line this tree does not have, so the candidate's content key is partly empty.`,
    );
  }

  const paths = new Set<string>();
  for (const row of source.read ?? []) if (row.file) paths.add(row.file);
  /* THE FILE OF THE MEMBER A READ ROW IS CREDITED TO. A row recorded `at` a line no
   * member stands at is credited to the sub-shape's first or the unit's representative (`memberLocationAtRow`), which
   * may be in another file, and it counts as read only where that member's line was opened too. The
   * verdict therefore rests on that file: without it, an edit beside the credited member - not a matched line, so the
   * content key does not move - left every premise unchanged and the verdict was carried. Added, never instead. */
  const units = new Map((readingUnitsCensusOf(candidate)?.kinds ?? []).map((k) => [k.id, k] as const));
  for (const row of source.read ?? []) {
    const unit = typeof row.kind === "string" ? units.get(row.kind) : undefined;
    if (!unit || !row.file || typeof row.lines !== "string") continue;
    const credited = memberLocationAtRow(unit, {
      file: row.file,
      lines: row.lines,
      ...(typeof row.sub_shape === "string" ? { sub_shape: row.sub_shape } : {}),
    });
    if (credited.file) paths.add(credited.file);
  }
  for (const row of source.evidence ?? []) if (row.file) paths.add(row.file);
  /* THE WINDOWS A SEAT WAS HANDED, FOR A CANDIDATE NOT READ PLACE BY PLACE. Its payload hands the
   * seat an excerpt of up to `window_lines` lines each side of every matched line (context.ts), and a verdict may rest
   * on those lines without quoting them or recording a read row: the content key digests the matched line alone, so an
   * edit beside it left every premise unchanged and the verdict was carried. A place-plan candidate compares each
   * place's window on its own row (place-premises.ts, premise `window`); any other candidate rests on the whole file of
   * each matched location, which holds its window whatever the window's size. Added, never instead. */
  /* WHAT THE SEAT OPENED AND SEARCHED, FROM ITS OWN TRANSCRIPT, for a candidate not read place by place:
   * such a seat may not record `searched[]` where the candidate carries no `kinds` (the capture refuses it), so a verdict
   * resting on "nothing was found" rested on a search nobody replayed. The capture writes the seat's sight on the record
   * (`seat_sight`); without it the block is incomplete and the verdict is never carried. Every candidate of the seat's
   * bin rests on the seat's whole sight (a Read is not attributed to one candidate). */
  const notPlace = candidate.reading_plan?.unit !== "place";
  const sight = notPlace ? seatSightStampOf(args.sight) : null;
  if (notPlace) for (const loc of candidate.locations ?? []) if (loc.file) paths.add(loc.file);
  /* WHAT THE SEAT'S SIGHT COULD NOT GIVE STOPS THE CARRY, NEVER THIS RUN. The sight is a
   * premise for a later run's comparison only: this run's reading is held to the seat's transcript by the capture
   * (`opened`) and by the assembly's transcript check, not by it. So a search of the seat's that the replay cannot hold
   * to the host's result (a Grep narrowed by `glob` or `type`, which the capture does not keep and the replay runs
   * unnarrowed; one the host answered with an error; one whose result line is not stamped as the seat's), a file it
   * opened that this tree no longer holds, and the capture's own reasons for either go into `untaken`
   * (`previous-premises-untaken` at the partition), as an unreadable transcript does - never into
   * `incomplete`, on which step 5a refuses this run. A file or a search the seat's own rows name (`read`, `evidence`,
   * `searched[]`) and the matched files stay where they were (unit H). */
  const sightUntaken: string[] = [];
  /* A `searched[]` row the carry's rule would not let stand (below). */
  const searchedUntaken: string[] = [];
  const rowPaths = new Set(paths);
  if (notPlace) {
    if (!sight) {
      incomplete.push(
        "the capture recorded nothing of what this verdict's seat opened and searched (`seat_sight`), so a search an absence rests on cannot be replayed.",
      );
    } else {
      for (const f of sight.files) paths.add(f);
      sightUntaken.push(...(sight.incomplete ?? []).map((r) => `what the seat opened or searched is not wholly a premise: ${r}`));
    }
  }
  const files: RestsOnFile[] = [...paths].sort().map((path) => {
    const digest = tree.sha256(path);
    return digest ? { path, sha256: digest } : { path, missing: true as const };
  });
  const sightMissing = files.filter((f) => f.missing && !rowPaths.has(f.path));
  if (sightMissing.length > 0) {
    sightUntaken.push(
      `what the seat opened or searched is not wholly a premise: ${sightMissing.length} file(s) the seat opened are not in this tree: ${sightMissing.map((f) => f.path).join(", ")}.`,
    );
  }
  const missing = files.filter((f) => f.missing && rowPaths.has(f.path));
  if (missing.length > 0) {
    incomplete.push(
      `${missing.length} file(s) a seat recorded reading are not in this tree: ${missing.map((f) => f.path).join(", ")}.`,
    );
  }

  const searches: RestsOnSearch[] = [];
  for (const row of source.searched ?? []) {
    const pattern = typeof row.pattern === "string" ? row.pattern : "";
    const { scope, flags, outside, written } = resolveSearchScope(row.paths, tree.root);
    const tool = row.tool === "grep" || row.tool === "glob" ? (row.tool as ReadingSearchTool) : undefined;
    const base = {
      for: typeof row.for === "string" ? row.for : "",
      pattern,
      ...(tool ? { tool } : {}),
      ...(row.paths ? { paths: row.paths } : {}),
      scope,
      flags,
      ...(typeof row.hits === "number" ? { seat_hits: row.hits } : {}),
    };
    if (!pattern) {
      searches.push({ ...base, hits: 0, unreplayable: "the row records no pattern, so there is nothing to replay." });
      continue;
    }
    const replayed = replaySearch(tree, pattern, scope, flags, tool);
    if ("unreplayable" in replayed) {
      searches.push({ ...base, hits: 0, unreplayable: replayed.unreplayable });
      continue;
    }
    searches.push({ ...base, hits: replayed.hits, hit_hash: replayed.hit_hash, ...(replayed.dialect ? { dialect: replayed.dialect } : {}) });
    /* The row is digested and decides `complete` exactly as before; whether a
     * later run may carry the verdict on it is the carry's own rule (`inputlessReplay`), checked here on this tree too, so a
     * row resting on files the replay does not read is never carried, even after such a file is deleted. Where it fails,
     * the reason goes to `untaken` (it stops the carry alone), never to `incomplete`. */
    // Where it does not refuse the row, `inputlessReplay` gives this same digest (its Grep is this call; its Glob stands
    // only where it agrees with it).
    const held = inputlessReplay(tree, { pattern, scope, flags, ...(tool ? { tool } : {}), written });
    if ("unreplayable" in held) searchedUntaken.push(`a search the answer records is not wholly a premise: ${held.unreplayable}`);
    // A row naming a place outside the tree - written with `..`, through
    // a link, as an absolute path, from `~`, or in a spelling this program cannot place - is digested over the whole tree
    // (its `complete` as before) and never carried.
    if (outside !== undefined) searchedUntaken.push(`a search the answer records is not wholly a premise: ${outside}.`);
  }
  const unreplayable = searches.filter((s) => s.unreplayable);
  if (unreplayable.length > 0) {
    incomplete.push(
      `${unreplayable.length} recorded search(es) cannot be replayed, so a later run cannot tell whether they still return the same lines.`,
    );
  }
  if (sight) {
    searches.push(...sight.searches);
    // Where the capture gave no reason of its own (a record it did not write), the searches say it.
    const sightUnreplayable = sight.searches.filter((s) => s.unreplayable || !s.hit_hash);
    if (sightUnreplayable.length > 0 && !(sight.incomplete ?? []).length) {
      sightUntaken.push(
        `what the seat opened or searched is not wholly a premise: ${sightUnreplayable.length} search(es) the seat ran cannot be replayed (the first: ${sightUnreplayable[0]!.unreplayable ?? "it carries no hit-set digest"}).`,
      );
    }
  }

  const census = source.census ?? kindCensusOf(candidate);
  /* WHAT THE SEAT'S OWN TRANSCRIPT COULD NOT GIVE, recorded beside the premises it would have given (the
   * sight above is then empty, the effort absent) and never as a reason the block is incomplete: it stops the carry
   * alone, and the current run is not refused for it. */
  const untaken = [...untakenOfRecord(args.untaken), ...sightUntaken, ...searchedUntaken];
  const instructions = args.instructions?.premise;
  if (!instructions) {
    incomplete.push(
      `the instructions this verdict was judged by cannot be digested (${args.instructions?.problem ?? "none were handed to this step"}), so a later run cannot tell whether they moved.`,
    );
  }
  if (!args.rule) {
    incomplete.push(
      `the bundle handed to this step carries no rule ${candidate.rule_id}, so the clause this verdict rests on is not digested.`,
    );
  }

  return {
    spec: RESTS_ON_SPEC,
    candidate: { content_key: key, locations: (candidate.locations ?? []).length },
    rule: { id: candidate.rule_id, hash: ruleHash(args.rule, candidate.rule_id) },
    bundle: { version: args.bundleVersion, md5: bundleMd5(args.bundleFiles) },
    ...(instructions ? { instructions } : {}),
    ...(args.handed ? { handed: args.handed } : {}),
    facts: scanFactsOf(candidate, tree, args.ships),
    ...(candidate.reading_plan?.unit !== "place" && typeof args.model === "string" && args.model ? { model: args.model } : {}),
    ...(Array.isArray(args.effort) && args.effort.length > 0 && args.effort.every((e) => typeof e === "string" && e !== "") ? { effort: args.effort as string[] } : {}),
    // Written only where there is one: an empty array and an absent field would be two spellings of
    // "this run settled nothing", and the comparison would then have to know they are the same.
    ...(args.answers && args.answers.length > 0 ? { answers: args.answers } : {}),
    ...(census ? { census: { hash: censusHash(census), content_hash: censusContentHash(census) } } : {}),
    files,
    searches,
    complete: incomplete.length === 0,
    ...(incomplete.length > 0 ? { incomplete } : {}),
    ...(untaken.length > 0 ? { untaken } : {}),
  };
}

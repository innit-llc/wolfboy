/**
 * THE PRE-LAUNCH DERIVATION, ONE FUNCTION FOR THE TWO COMMANDS THAT NEED IT.
 *
 * `adjudicate` writes the plan (`.legal/adjudicate-plan.json`) and, with `--carry-into`, the carried
 * verdicts (`.legal/verdicts-carried`). `assemble-report` read both at the end of the run and took
 * both as given: a plan edited to move a lost verdict into `pre_settled` was assembled as a
 * declaration, and a carried verdict edited by hand, or planted for a candidate a seat was
 * launched for, reached the log as the person's earlier answer. Neither file is a
 * primary record: each is made from findings.json, the previous run the person named, the tree and
 * the bundle. So `assemble-report` now makes both again with THIS function and refuses every field
 * of the plan and every byte of a carried file that differs (never trust a
 * derived file the command did not produce itself).
 *
 * The code was moved here from `adjudicate`'s action in index.ts, which now calls it; what it reads,
 * computes and writes did not change. Two things stay with the action because they are its own
 * options and not derivable from any record: the label of the previous run (`--previous-scan`,
 * `--previous-findings`, a record's own `scan_id` in a directory of the run's files, or a digest of
 * the path; never a scan id a log states, at its top or on a record (carry-forward.ts
 * `earlierRunWords`), which the plan records as `previous_scan_id` and `assemble-report` takes from
 * there, and the writing of both files.
 */
import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { relativePath } from "./project-path.js";
import type { Candidate, Findings, Rule } from "wolfboy-schemas";
import { partition, type PartitionResult, type PreviousVerdict } from "./carry-forward.js";
import { placesNowFromPayloads, readingSpecDigest } from "./place-premises.js";
import { placesToRead, seatPlacesOfPayloads } from "./carried-places.js";
import { foldDigestOfCarried } from "./answer-premises.js";
import { preLaunchPlan, type PreLaunchPlan } from "./pre-launch.js";
import { readNamedFile } from "./program-file.js";
import { answersFromApplicability, handedPremiseOf, inventoryNowOf, shipsFactsOf, type TreeReader } from "./rests-on.js";
import { instructionsPremise } from "./instructions.js";
import { agentFileEffort } from "./seat-effort.js";
import { SEAT_CLASS_WORDS } from "./verdict-verify.js";

/** A previous record that names a candidate and carries no verdict word of the three (fix-verify-shape CF1). */
export interface PreviousNotTaken {
  source: string;
  finding_id: string;
  verdict: unknown;
}

export interface PreviousRun {
  /** The previous run's verdicts, not yet labelled: `scan_id` is set from the label when the plan is made. */
  previous: PreviousVerdict[];
  /* No record names the run: a directory passed as --previous is a folder in the
   * scanned tree as a log is a file in it (a folder named like a log, or a link to one, is read as a directory), and a
   * repository can ship either; so neither a log's `scan_id`, top-level or on a record (
   * a test case), nor a directory's records give the label. It is `--previous-scan`,
   * `--previous-findings`' scan id, or the digest of the path (index.ts). */
  notTaken: PreviousNotTaken[];
  /**
   * The sha256 of what was read and
   * parsed: a log's bytes; for a folder of run files, of each file's path and sha256 in the order read. The plan keeps it
   * (`previous_sha256`), so a file swapped after the pre-launch step read it is refused by the assembly, and the vouch
   * (plugin-sessions.ts) is checked on these bytes, not on a second read. Absent only where nothing was read.
   */
  sha256?: string;
  /** Whether `--previous` named a folder of run files. */
  isDirectory?: boolean;
}

/** A file of the previous run that could not be read as JSON; `path` is the file, as `adjudicate` names it. */
export class PreviousRunUnreadable extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * THE PREVIOUS RUN'S VERDICTS. A directory of the run's own files, or one assembled log: both
 * shapes exist in this repository and the skill writes the first, so both are read. A refuter's
 * or a silence investigator's file is NOT a candidate's answer and is not taken as one — a refutation
 * carries on the terms of the verdict it belongs to, which is carried or not as one. So a refuter's file (an ordinary refutation or a second look) is read
 * only for the finding it names: that finding's verdict set is then not whole in the record the carry would copy, and it
 * is judged again (`set_apart`, verdict-set.ts).
 */
export function readPreviousRun(previousPath: string): PreviousRun {
  const previous: PreviousVerdict[] = [];
  // Previous records that name a candidate and carry no verdict word of the three (fix-verify-shape CF1).
  const notTaken: PreviousNotTaken[] = [];
  // Every file read, by its path and its bytes' sha256, in the order read.
  const readParts: string[] = [];
  const noteRead = (full: string, bytes: Buffer): void => {
    readParts.push(`${relativePath(previousPath, full)}\u0000${createHash("sha256").update(bytes).digest("hex")}`);
  };
  const takeRecord = (parsed: unknown, source: string) => {
    const records = Array.isArray(parsed) ? parsed : [parsed];
    for (const record of records) {
      if (!record || typeof record !== "object" || Array.isArray(record)) continue;
      const rec = record as Record<string, unknown>;
      const id = typeof rec.finding_id === "string" ? rec.finding_id : "";
      if (!id) continue;
      if (typeof rec.disposition === "string" && !rec.verdict) continue; // a reader's reply, not a verdict
      /* A RECORD WITH NO VERDICT WORD IS NOT A VERDICT, and is not carried as one (fix-verify-shape
       * CF1, 2026-09-24). It was taken with `verdict: ""` - or with whatever foreign word it held -
       * and the comparison below never reads the word, so a record whose label sat under `class`,
       * as 61 of live run 1's did, could be carried into a later run as a settled answer. Not taken,
       * its candidate has no previous verdict and is adjudicated again, and the count is printed. */
      if (typeof rec.verdict !== "string" || !SEAT_CLASS_WORDS.adjudicator.includes(rec.verdict)) {
        notTaken.push({ source, finding_id: id, verdict: rec.verdict });
        continue;
      }
      previous.push({ record: rec, finding_id: id, verdict: typeof rec.verdict === "string" ? rec.verdict : "", source, scan_id: "" });
    }
  };
  /* THE KINDS OF A FINDING'S VERDICT SET (verdict-set.ts) THE RUN KEPT APART from
   * the record that would be carried: a directory's refuter files (an ordinary refutation, or a second look in challenge mode),
   * and a log's `challenges[]` rows. The carry reads them through `verdictSetOf` and does not carry a finding whose record
   * lacks one: until this unit a refutation or a second look kept apart was dropped and the verdict carried without it. */
  const apart = new Map<string, Set<string>>();
  const basisById = new Map<string, NonNullable<PreviousVerdict["basis"]>>();
  const keptApart = (id: string, kind: string) => {
    if (!id) return;
    if (!apart.has(id)) apart.set(id, new Set());
    apart.get(id)!.add(kind);
  };
  const readRefuterDir = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        readRefuterDir(full);
        continue;
      }
      if (!name.endsWith(".json")) continue;
      const got = readNamedFile("a record of the previous run", full);
      if (!got.ok) throw new PreviousRunUnreadable(full, got.problem);
      noteRead(full, got.value);
      let parsed: unknown;
      try {
        parsed = JSON.parse(got.value.toString("utf8"));
      } catch (e) {
        throw new PreviousRunUnreadable(full, (e as Error).message);
      }
      for (const r of Array.isArray(parsed) ? parsed : [parsed]) {
        if (!r || typeof r !== "object" || Array.isArray(r)) continue;
        const rec = r as Record<string, unknown>;
        keptApart(typeof rec.finding_id === "string" ? rec.finding_id : "", rec.mode === "challenge" ? "second_look" : "refutation");
      }
    }
  };
  const readPreviousDir = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === "refutation") {
          readRefuterDir(full);
          continue;
        }
        if (name === "readers" || name === "silence") continue;
        readPreviousDir(full);
        continue;
      }
      if (!name.endsWith(".json")) continue;
      const got = readNamedFile("a record of the previous run", full);
      if (!got.ok) throw new PreviousRunUnreadable(full, got.problem);
      noteRead(full, got.value);
      try {
        takeRecord(JSON.parse(got.value.toString("utf8")), relativePath(previousPath, full));
      } catch (e) {
        throw new PreviousRunUnreadable(full, (e as Error).message);
      }
    }
  };
  const isDirectory = statSync(previousPath).isDirectory();
  let sha256: string;
  if (isDirectory) {
    readPreviousDir(previousPath);
    sha256 = createHash("sha256").update(readParts.join("\n")).digest("hex");
  } else {
    // A run the person names may be a link or a backup, and is never a file that can block (program-file.ts `readNamedFile`):
    // a named pipe here hung `adjudicate`.
    const got = readNamedFile("the previous run's log", previousPath);
    if (!got.ok) throw new PreviousRunUnreadable(previousPath, got.problem);
    sha256 = createHash("sha256").update(got.value).digest("hex");
    let log: Record<string, unknown>;
    try {
      log = JSON.parse(got.value.toString("utf8")) as Record<string, unknown>;
    } catch (e) {
      throw new PreviousRunUnreadable(previousPath, (e as Error).message);
    }
    const rows = Array.isArray(log.verdicts) ? log.verdicts : Array.isArray(log) ? log : [];
    // A record's own `scan_id` here names nothing: the label is never a string the log wrote.
    takeRecord(rows, basename(previousPath));
    for (const c of Array.isArray(log.challenges) ? log.challenges : []) {
      if (c && typeof c === "object" && !Array.isArray(c)) keptApart(typeof (c as Record<string, unknown>).finding_id === "string" ? ((c as Record<string, unknown>).finding_id as string) : "", "second_look");
    }
    /* The earlier log's comparison basis: where each finding was and its level, read only to say where a
     * gone verdict was (carry-forward.ts `GoneRow.place`); never a premise. A log made before release 1 has none. */
    const comparison = log && typeof log === "object" && !Array.isArray(log) ? (log.comparison as Record<string, unknown> | undefined) : undefined;
    const basisRows = comparison && typeof comparison === "object" && Array.isArray(comparison.basis) ? (comparison.basis as unknown[]) : [];
    for (const b of basisRows) {
      if (!b || typeof b !== "object" || Array.isArray(b)) continue;
      const r = b as Record<string, unknown>;
      if (typeof r.finding_id !== "string" || typeof r.file !== "string" || r.file === "") continue;
      basisById.set(r.finding_id, { file: r.file, line: Number.isInteger(r.line) ? (r.line as number) : null, level: typeof r.level === "string" ? r.level : null });
    }
  }
  for (const p of previous) {
    const kinds = apart.get(p.finding_id);
    if (kinds) p.set_apart = [...kinds].sort();
    const basis = basisById.get(p.finding_id);
    if (basis) p.basis = basis;
  }
  return { previous, notTaken, sha256, isDirectory };
}

export interface AdjudicatePlanArgs {
  findings: Findings;
  /** Whether the orientation sheet the briefs name is beside the findings (`orientationSheetBeside`). */
  orientationSheet: boolean;
  /** `--findings` as it was typed: the plan records it so. */
  findingsTyped: string;
  /** Null where no previous run was given: then nothing is compared and nothing is carried. */
  previous: {
    /** `--previous` as it was typed: the plan records it so. */
    typed: string;
    run: PreviousRun;
    /** The label every carried verdict takes, and `previous_scan_id` in the plan. */
    scanId: string;
    /** The scanned tree as it is today: every premise is re-derived from it. */
    tree: TreeReader;
    /** The rule bundle, for the per-rule clause digest and the bundle version. */
    bundle: { rules: Map<string, Rule>; version: string; files?: Record<string, string> };
  } | null;
  /**
   * This run's run-wide `--seat-model`, an option of the same `adjudicate` command as
   * `--previous`. Every seat of the run is launched on it, so the comparison takes it as the model now, and the plan
   * records it (`seat_model_override`) for `assemble-report` to make the same partition again.
   */
  seatModelOverride?: string;
}

/**
 * THE BYTES OF A DERIVED FILE: the one serialisation `adjudicate` writes the plan and every carried
 * verdict with, `verdict-verify` writes its report with, and `assemble-report` compares all three in
 * (its `asWritten`). The plan and the carried verdicts leave this module as these bytes and nothing
 * else: the object they are made from can hold what no file can - a
 * key whose value is `undefined`, as a previous record with no `verdict` key gave `previous_not_taken`
 * - and `assemble-report`, which makes both again, compared that object with the file `adjudicate` had
 * written from it, and refused the plan as edited.
 */
export function derivedFileContent(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export interface AdjudicatePlan {
  plan: PreLaunchPlan;
  /** The partition's rows, counts and gone rows; each carried verdict by id only (its bytes are `carried`). */
  result: (Omit<PartitionResult, "carried"> & { carried: { finding_id: string }[] }) | null;
  /** The bytes `adjudicate --out` writes: the plan, key order included. */
  content: string;
  /** The files `adjudicate --carry-into` writes: the name, the candidate and the bytes. */
  carried: { rel: string; finding_id: string; content: string }[];
}

/**
 * A FINDINGS DOCUMENT THE DERIVATION CANNOT USE, named by JSON path (relay integration part B, area γ, item 4).
 *
 * Every problem below reached the derivation outside every guard and ended `adjudicate`, the assembly
 * and `verdict-reading` in a stack trace; `adjudicatePlan` and `verdict-reading` now ask this first and
 * refuse by name, with what findings.schema.json requires at that path. What is absent where the
 * derivation already reads an absence (no `per_rule_applicability`, no payload index) is not a problem
 * here, with one exception: `launching` names the candidates the plan is about to hand to seats, and a
 * document with no payload index at all while some are to be launched is refused (without the index the `important` reach counted 0 candidates, and every high-severity candidate was written unadjudicated).
 */
export class FindingsUnusable extends Error {
  constructor(
    readonly problems: string[],
    source = "findings.json",
  ) {
    super(`${source} cannot be used as the scan's findings document: ${problems.join("; ")}`);
    this.name = "FindingsUnusable";
  }
}

/** `findingsInputProblems` as a refusal: throws `FindingsUnusable` naming every problem, with the path as typed. */
export function assertFindingsUsable(findings: unknown, source?: string, launching?: readonly string[]): void {
  const problems = findingsInputProblems(findings, launching);
  if (problems.length > 0) throw new FindingsUnusable(problems, source);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const kindOf = (v: unknown): string =>
  v === undefined ? "absent" : v === null ? "null" : Array.isArray(v) ? "a list" : typeof v === "object" ? "an object" : `a ${typeof v}`;

export function findingsInputProblems(findings: unknown, launching?: readonly string[]): string[] {
  const problems: string[] = [];
  const need = (path: string, what: string, value: unknown) =>
    problems.push(`${path} is ${kindOf(value)}; findings.schema.json requires ${what}`);
  if (!isRecord(findings)) {
    need("(the document)", "an object", findings);
    return problems;
  }
  const candidates = findings.candidates;
  if (candidates !== undefined && !Array.isArray(candidates)) need("candidates", "a list of candidate objects", candidates);
  else
    ((candidates ?? []) as unknown[]).forEach((c, i) => {
      if (!isRecord(c)) need(`candidates[${i}]`, "a candidate object", c);
    });
  const index = findings.context_payloads;
  if (index !== undefined) {
    if (!isRecord(index)) need("context_payloads", "the payload index object", index);
    else if (!Array.isArray(index.payloads)) need("context_payloads.payloads", "a list of payload rows", index.payloads);
    else
      (index.payloads as unknown[]).forEach((row, i) => {
        if (!isRecord(row)) need(`context_payloads.payloads[${i}]`, "a payload row object", row);
        else if (typeof row.key !== "string") need(`context_payloads.payloads[${i}].key`, "a string", row.key);
      });
  }
  const block = findings.per_rule_applicability;
  if (block !== undefined && block !== null) {
    if (!isRecord(block)) need("per_rule_applicability", "an object", block);
    else if (!Array.isArray(block.rules)) need("per_rule_applicability.rules", "a list of rule rows", block.rules);
    else
      (block.rules as unknown[]).forEach((row, i) => {
        const at = `per_rule_applicability.rules[${i}]`;
        if (!isRecord(row)) {
          need(at, "a rule row object", row);
          return;
        }
        if (typeof row.rule_id !== "string") need(`${at}.rule_id`, "a string", row.rule_id);
        if (!Array.isArray(row.jurisdiction)) need(`${at}.jurisdiction`, "a list of the rule's jurisdictions", row.jurisdiction);
        if (!isRecord(row.jurisdiction_question)) need(`${at}.jurisdiction_question`, "a question object", row.jurisdiction_question);
        if (row.premise_questions !== undefined) {
          if (!Array.isArray(row.premise_questions)) need(`${at}.premise_questions`, "a list of question objects", row.premise_questions);
          else
            (row.premise_questions as unknown[]).forEach((q, j) => {
              if (!isRecord(q)) need(`${at}.premise_questions[${j}]`, "a question object", q);
            });
        }
      });
  }
  if (launching && problems.length === 0 && index === undefined) {
    // No payload index at all, while candidates the scan grouped for a seat are to be
    // launched. An index that is present and lists no row for a candidate's group is not refused here: the
    // launch-plan unit reads an empty index as "nothing to launch", and whether a present
    // index can omit a group is stated for the merge step. A candidate with no adjudication group (a unit fixture's,
    // never a scan's: findings.schema.json puts one on every candidate) is not counted.
    const launched = new Set(launching);
    const ids = ((candidates ?? []) as unknown[])
      .filter((c): c is Record<string, unknown> => isRecord(c) && launched.has(c.finding_id as string))
      .filter((c) => isRecord(c.adjudication_group) && typeof c.adjudication_group.key === "string")
      .map((c) => String(c.finding_id))
      .sort();
    if (ids.length > 0) {
      problems.push(
        `context_payloads is absent, and ${ids.length} candidate(s) are to be adjudicated (${ids.slice(0, 5).join(", ")}${ids.length > 5 ? `, and ${ids.length - 5} more` : ""}): the scan wrote no payload index (was it run with --context-window 0?), so no seat could be handed its payload, and the important reach would count every one of them as not reached`,
      );
    }
  }
  return problems;
}

export function adjudicatePlan(args: AdjudicatePlanArgs): AdjudicatePlan {
  const { findings } = args;
  assertFindingsUsable(findings, args.findingsTyped);
  const prev = args.previous;
  const candidates = (findings.candidates ?? []) as Candidate[];
  /* THE ANSWERS THE DECLARATION SETTLES, as premises (unit GFH-2). They are handed to the
   * comparison so that a verdict given under one declaration is not carried into a run made under
   * another: `answers` is compared straight after the bundle's version. */
  const settledAnswers = answersFromApplicability(findings.per_rule_applicability);
  const result = prev
    ? partition({
        candidates,
        previous: prev.run.previous.map((p) => ({ ...p, scan_id: prev.scanId })),
        tree: prev.tree,
        rules: prev.bundle.rules,
        bundleVersion: prev.bundle.version,
        bundleFiles: prev.bundle.files,
        answers: settledAnswers,
        /* What the seats judge by, and what every seat is handed beside its payload - compared straight
         * after the rule, so a verdict judged under other instructions or handed another profile is given again. */
        instructions: instructionsPremise(),
        handed: handedPremiseOf(findings, args.orientationSheet),
        /* Today's inventory by package, so a package's
         * changed declaration counts only for the verdicts that rest on it (carry-forward.ts `handedChange`). */
        inventory: inventoryNowOf(findings),
        /* The ships premise of each location's file, compared in `facts`. */
        ships: shipsFactsOf((findings as { ships_premises?: unknown }).ships_premises),
        ...(args.seatModelOverride ? { seatModel: args.seatModelOverride } : {}),
        /* The level a seat of this run runs at - the adjudicator's pin, which only an environment variable
         * the scan's own session removes outranks. A verdict or a place given at another level is given again. */
        effortNow: (() => {
          try {
            return agentFileEffort("legal-adjudicator");
          } catch {
            return null;
          }
        })(),
        /* Build unit F5 (design section 4): each place of a place-plan candidate is compared on its own premises - the
         * text this run's payloads wrote for it, and this run's reading spec digest. */
        placesNow: (() => {
          const windows = placesNowFromPayloads(dirname(resolve(args.findingsTyped)), findings.context_payloads?.payloads ?? [], shipsFactsOf((findings as { ships_premises?: unknown }).ships_premises));
          return (c: Candidate) => windows.get(c.finding_id) ?? null;
        })(),
        readingSpec: readingSpecDigest({}),
        /* VA-5: an answer seat's answer is compared on the fold this run would hand it over the carried places. */
        answerFoldNow: foldDigestOfCarried,
      })
    : null;
  /* Build unit F5 M3 (carried-places.ts): which seats of the candidates still read hold only carried places, and are
   * not launched; a carried place in a seat that is launched is read again (`seat-launched`). */
  const seatsRead = result
    ? placesToRead({ rows: result.rows, seats: seatPlacesOfPayloads(dirname(resolve(args.findingsTyped)), findings.context_payloads?.payloads ?? []) })
    : null;

  /* THE PRE-LAUNCH PLAN: the declaration first, the previous run second, the price of what is left
   * third — one function, one order, one printed block (`pre-launch.ts`). */
  const plan = preLaunchPlan({
    candidates,
    payloads: findings.context_payloads?.payloads ?? [],
    applicability: findings.per_rule_applicability ?? null,
    carried: result ? result.carried.map((row) => row.finding_id) : [],
    partitionApplied: result !== null,
    previousScanId: prev ? prev.scanId : null,
    carriedSeats: seatsRead ? seatsRead.seats : [],
  });
  // Every candidate the plan hands to a seat has a payload row for its group, or nothing is planned.
  assertFindingsUsable(findings, args.findingsTyped, plan.to_adjudicate);
  const settledIds = new Set(plan.pre_settled.map((row) => row.finding_id));
  // The id list is written ONCE, at the top level where it has always been and where the skill
  // dispatches from; `pre_launch` carries the counts, the set-aside records and the price.
  const { to_adjudicate: toAdjudicate, ...preLaunchRecord } = plan;
  const document: Record<string, unknown> = {
    tool: "adjudicate",
    findings: args.findingsTyped,
    previous: prev ? prev.typed : null,
    // Only where a previous run was read: a plan with none is as before.
    ...(prev && typeof prev.run.sha256 === "string" ? { previous_sha256: prev.run.sha256 } : {}),
    previous_scan_id: prev ? prev.scanId : null,
    bundle_version: prev ? prev.bundle.version : null,
    ...(args.seatModelOverride ? { seat_model_override: args.seatModelOverride } : {}),
    pre_launch: preLaunchRecord,
    counts: result ? result.counts : null,
    to_adjudicate: toAdjudicate,
    rows: seatsRead ? seatsRead.rows : [],
    gone: result ? result.gone : [],
    // Earlier verdicts not compared because another held the key a candidate was looked up by; never gone.
    not_chosen: result ? result.not_chosen : [],
    previous_not_taken: prev ? prev.run.notTaken : [],
  };
  /* Build unit F5 M3: the carried rows of every reader seat that is not launched, which the fold and the assembly read
   * beside the readers' replies on disk (carried-places.ts `carriedReaderReplies`). Present only where there is one. */
  const notLaunched = new Set((plan.carried_seats ?? []).map((s) => s.key));
  const carriedPlaces = (seatsRead?.seats ?? []).filter((s) => notLaunched.has(s.key));
  if (carriedPlaces.length > 0) document.carried_places = carriedPlaces;

  /* A CANDIDATE THE DECLARATION SET ASIDE IS NOT CARRIED, whatever the previous run decided
   * about it. The declaration is this run's own answer and the carried verdict is the earlier
   * run's; the settlement wins, the candidate is reported as not applicable by declaration, and
   * the overlap is counted in the printed block rather than resolved in silence. */
  const carried: AdjudicatePlan["carried"] = [];
  for (const row of result ? result.carried : []) {
    if (settledIds.has(row.finding_id)) continue;
    carried.push({ rel: `${row.finding_id}.json`, finding_id: row.finding_id, content: derivedFileContent([row.record]) });
  }
  /* The carried verdicts leave as bytes only: `result.carried` keeps the ids and
   * no record object, which `carried[].content` holds as the bytes `--carry-into` writes. */
  const handed = result ? { ...result, rows: seatsRead ? seatsRead.rows : result.rows, carried: result.carried.map((row) => ({ finding_id: row.finding_id })) } : null;
  return { plan, result: handed, content: derivedFileContent(document), carried };
}

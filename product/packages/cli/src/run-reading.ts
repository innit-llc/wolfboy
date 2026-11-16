/**
 * THE READING INPUTS OF A RUN, DERIVED ONCE.
 *
 * Two commands derive the same assembled reading of a run: `verdict-reading` (skill step 5a), which writes the assembled
 * copies, and `assemble-report` (step 6), which makes them again and refuses any copy that differs. Both read the seats'
 * verdict files, the readers' replies, and the rows of the readers the run did not launch because every place each
 * holds was carried (build unit F5 M3, carried-places.ts). Until this module the carried rows entered `verdict-reading`
 * only where its caller passed `--launch-dir`, and entered `assemble-report` always; the skill's step 5a command named
 * no `--launch-dir`, so on a continuation with carried reader rows the two disagreed and the assembly was refused
 * (`assembled-differs`), in a continuation hand run of 2026-10-27. Whether an input enters the reading was
 * decided by the skill's text, not by the program.
 *
 * Now one function, `readingInputsOfRun`, takes the run's verdicts and readers directories and the run's plan, and
 * returns every reply the reading is folded from, the carried rows included; both commands call it. Which plan is the
 * run's is decided here too, not by a flag: `verdict-reading` reads the plan the run's launch list names (the launch
 * directory beside `--verdicts`, `.legal/launch` on the skill's scheme, unless `--launch-dir` names another), and
 * `assemble-report` uses the plan it made again from the run's inputs (compared field by field with the plan on disk
 * before this is reached), so both read one plan's carried rows. A launch list that names a plan this command cannot
 * read at the digest the list recorded stops the assembly by name: before, it gave no carried rows and the assembly
 * came out short without a word.
 *
 * Nothing here is a judgement and nothing is written; it consults no model.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import type { Candidate } from "wolfboy-schemas";
import { carriedReaderReplies } from "./carried-places.js";
import { programFileBytes } from "./program-file.js";
import { readVerdictsForReading, type VerdictsForReading } from "./reading-assembly.js";

/** The launch directory of a run whose seats wrote into `verdictsDir`: `.legal/launch` beside `.legal/verdicts`. */
export function launchDirBeside(verdictsDir: string): string {
  return join(dirname(verdictsDir), "launch");
}

/**
 * The plan the run's launch list names, read at the digest the list recorded. `plan: null` with no problem where the
 * directory holds no launch list (a run with nothing to launch, or one assembled outside the skill's scheme): such a
 * run carries no reader rows. A problem where a list stands and its plan cannot be read as the list recorded it.
 */
export function planOfLaunchDir(launchDir: string): { plan: unknown; listPath: string | null } | { problem: string } {
  const listPath = join(launchDir, "launch-list.json");
  if (!existsSync(listPath)) return { plan: null, listPath: null };
  let named: unknown;
  try {
    named = (JSON.parse(programFileBytes("the launch list", listPath).toString("utf8")) as { plan?: unknown }).plan;
  } catch (e) {
    return { problem: `the launch list ${listPath} could not be read as JSON (${(e as Error).message})` };
  }
  // The pre-launch step names the plan on the list only where the plan holds carried reader rows (launch-plan.ts, `planFile`).
  if (named === undefined) return { plan: null, listPath };
  if (named === null || typeof named !== "object" || typeof (named as { path?: unknown }).path !== "string" || typeof (named as { sha256?: unknown }).sha256 !== "string") {
    return { problem: `the launch list ${listPath} names no plan (path and sha256)` };
  }
  const { path, sha256 } = named as { path: string; sha256: string };
  let bytes: Buffer;
  try {
    bytes = programFileBytes("the pre-launch plan", path);
  } catch (e) {
    return { problem: `the plan ${path} that the launch list ${listPath} names could not be read (${(e as Error).message})` };
  }
  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== sha256) return { problem: `the plan ${path} has sha256 ${got}, and the launch list ${listPath} recorded ${sha256}: it was written after the list, or by another run` };
  try {
    return { plan: JSON.parse(bytes.toString("utf8")), listPath };
  } catch (e) {
    return { problem: `the plan ${path} could not be read as JSON (${(e as Error).message})` };
  }
}

/**
 * Every input the run's reading is folded from: the seats' verdict files and the readers' replies on disk
 * (`readVerdictsForReading`), and the carried rows of `plan` (`carriedReaderReplies`), after them. The one derivation
 * `verdict-reading` and `assemble-report` both use.
 */
export function readingInputsOfRun(args: { verdictsDir: string; candidates: Candidate[]; readersDir?: string; plan: unknown }): VerdictsForReading & { carried: number } {
  const read = readVerdictsForReading(args.verdictsDir, args.candidates, args.readersDir);
  const carried = carriedReaderReplies(args.plan);
  read.replies.push(...carried);
  return { ...read, carried: carried.length };
}

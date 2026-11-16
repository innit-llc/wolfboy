/**
 * A SEAT'S READ OF A FILE THE LAUNCH LIST NAMES, CHECKED AT READ TIME (integration part B, area hooks, item 4; the
 * parent's B8; hooks-launch T1). The launch gate checks every file of a seat's entry against the sha256 the list records
 * when the seat is launched (hook-launch.ts `seatFileProblems`). Between that check and the seat's Read the file could
 * change. This route closes that window for the Read tool: a seat's `PreToolUse` on Read of a file the launch list names
 * is refused unless the file, read now, is a regular file with one link whose sha256 is every one the list records for
 * it (the bytes' own, or the UTF-8 text's, as the gate accepts).
 *
 * A SEAT READS UNDER `.legal` ONLY WHAT ITS OWN LAUNCH ENTRY NAMES.
 * In the owner's second live run 56 of 77 refuters' searches listed the
 * run's own records under `.legal/`, and 35 printed lines from them, though a refuter must not see the adjudicator's
 * reasoning. So a seat's Read, Grep or Glob that reaches under the run's `.legal` (hook.ts `seatReach`: the path it
 * names, its pattern's leading folders, or a `.legal` folder its pattern names) is refused unless it is a Read, or a
 * Grep with a path and no glob, of a file the seat's own entry names: its brief, and for a pre-launch entry the files
 * its `reads` name (the payload or its reading copy and the file that copy was made from, the sheet,
 * the paragraph, the fold). The entry is the one the launch hook bound the seat to (hook-launch.ts `seatBinding`, the
 * one binding rule). The launch result that carries the binding arrives as the seat starts, and a seat's first Read
 * came 1.95 s or more after the gate's check in the 13 recorded launches, so a seat not bound yet is waited for, up to
 * SEAT_BINDING_WAIT_MS; a seat still not bound then reads nothing under `.legal`. Every file outside `.legal` passes,
 * checked against the list's digests where some entry names it (an orientation sheet the pre-launch step was given
 * from outside `.legal`). The orchestrator's own tools, and any other agent's, are untouched (the route's `who`).
 *
 * WHEN: only for the plugin's own seats (the route's `who`), only while a run's marker stands (the route's `when`), and
 * only while the event belongs to the active run (hook-launch.ts `eventInActiveRun`). The list counts as the one the
 * pre-launch step wrote only when its sha256 is the one the active-run marker records, as the gate launches only from
 * that list; where it is not, or the list or the marker cannot be read, every call that reaches under the run's
 * `.legal` is refused and every other call passes.
 *
 * FAILING CLOSED: decided in the entry without this module (hook.ts `seatReadFailsClosed`): a seat's call that reaches
 * under the run's `.legal` while a marker stands. The entry refuses such a call when this route throws, when its module
 * does not load, and when it runs past HOOK_ROUTE_DEADLINE_MS (12 s, counted from the route's start; the wait for a
 * binding stays well inside it). What still lets such a call through is what no hook of this plugin can refuse: stdin
 * not closed within HOOK_STDIN_DEADLINE_MS (the entry cannot tell whose call it is, and exits 1), and an entry that
 * Claude Code itself times out (hooks.json's 30 s) or that cannot start at all, where Claude Code lets the call go
 * ahead (probe fact (f)). A call that reaches no further than the project fails open, as before; so does a Grep of
 * the project with no glob, or with only `!` pieces, which `.legal/.ignore` keeps out of `.legal`.
 *
 * A SEAT'S GREP OF A FOLDER THAT HOLDS `.legal` LEAVES `.legal` OUT. ripgrep's globs override its
 * ignore files, so a Grep of the project whose glob takes files in went past `.legal/.ignore`: `*.json` returned
 * `.legal/findings.json`, and `*` or `**` every file under `.legal`, the adjudicators' records in `.legal/verdicts`
 * among them. Such a call is not refused, since it
 * searches the project too: it goes ahead with one more glob piece, `!/<the run's .legal relative to the folder>`,
 * appended last, where ripgrep's last matching glob decides, so ripgrep never enters the run's `.legal` and the rest of
 * the search is unchanged. Every Grep of such a folder gets it, with a glob or without, so the guard no longer rests on
 * the content of a `.legal/.ignore` it did not write. Nothing is written in the person's project.
 *
 * LIMITS: a search of the project that is not aimed at `.legal` passes, so Glob still lists the names of the files under
 * `.legal` (its default ignores no ignore file); a Glob or Grep pattern whose wildcards happen to match `.legal`
 * (`*` + `/verdicts/*`) is not recognised as aimed there, and a Grep of the project with such a glob is kept out of the
 * run's `.legal` by the piece above; the piece is anchored to the folder Claude Code runs ripgrep in, which is the folder
 * searched on Linux and macOS (2.1.285), and where the path from that folder to `.legal` holds a character a glob piece
 * cannot carry, or is not spelled as the folder's listing spells it (another case or a short name, which a file system
 * that ignores case still finds), the piece names `.legal` alone and leaves out every `.legal` below the
 * folder; a listed path written
 * through a symlinked folder is recognised by its real path only when it exists; the file can still change between
 * this check and the Read itself.
 *
 * READING: the list and every file it names are read through area alpha's one reader of
 * program-written files (program-file.ts readProgramFile: lstat, a regular file with one name, opened read-only,
 * non-blocking and without following a link, the same file after the open), and a listed file's digest is compared by
 * the launch gate's own rule (hook-launch.ts listedDigestMatches). The list's layout is read through launch-plan.ts's own
 * types.
 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { PASS, seatReach, type HookContext, type HookDecision } from "./hook.js";
import { eventInActiveRun, listedDigestMatches, markerRecording, readActiveRun, seatBinding, type ListedEntry } from "./hook-launch.js";
import { readProgramFile } from "./program-file.js";
import { readLaunchEvents, type LaunchEntry, type LaunchList } from "./launch-plan.js";
import { placeTablePath } from "./place-fold.js";
import { valueText } from "./value-text.js";

const sha256 = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** How long a seat the launch hook has not bound yet is waited for, from the route's start (well inside HOOK_ROUTE_DEADLINE_MS). */
export const SEAT_BINDING_WAIT_MS = 4000;
const BINDING_POLL_MS = 200;

/** Every path one entry names for its seat to read, with each sha256 recorded for it, resolved from `base`. */
export function entryFiles(e: ListedEntry, base: string, out: Map<string, string[]> = new Map()): Map<string, string[]> {
  const add = (path: unknown, digest: unknown): void => {
    if (typeof path !== "string" || path === "") return;
    const key = resolve(base, path);
    const digests = out.get(key) ?? [];
    if (typeof digest === "string" && !digests.includes(digest)) digests.push(digest);
    out.set(key, digests);
  };
  add(e.brief_path, e.brief_sha256);
  // An entry launch-later appended names only its brief; a pre-launch entry names what its brief names too.
  const reads: LaunchEntry["reads"] = "reads" in e && Array.isArray(e.reads) ? e.reads : [];
  for (const r of reads) {
    add(r.path, r.sha256);
    if (r.copied_from) add(r.copied_from.path, r.copied_from.sha256);
  }
  return out;
}

/** Every path the list names for a seat to read, with each sha256 recorded for it (none where the list records none). */
export function listedFiles(list: LaunchList, base: string = process.cwd()): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const e of Array.isArray(list.entries) ? (list.entries as ListedEntry[]) : []) entryFiles(e, base, out);
  return out;
}

/** A call the run's integrity leaves undecidable, or a listed file that is not the program's: the seat hands back. */
const refuse = (text: string): HookDecision => ({
  kind: "deny",
  reason:
    `wolfboy: ${text} A seat reads only the files the pre-launch step wrote for it, as it wrote them. Do not read the file by another route; ` +
    "hand back now, saying which file could not be read. The orchestrator runs the pre-launch step again and relaunches the seat.",
});

/** A call into `.legal` the seat's launch does not hand it: refused, and the seat goes on without it. */
const keepOut = (text: string): HookDecision => ({
  kind: "deny",
  reason:
    `wolfboy: ${text} Under .legal/ a seat reads its brief and the files its brief names, by Read, and nothing else: the rest is this run's own working files and records, not the project. ` +
    "Do not reach them by another route. Go on with your task without this call, searching the project's own folders.",
});

/** A path from the searched folder to `.legal` that one glob piece carries as it is: no space, comma, wildcard or escape. */
const PLAIN_GLOB_PATH = /^[A-Za-z0-9._@+=%~:/-]+$/;

/**
 * The glob piece that keeps ripgrep out of the run's `.legal`: anchored to the searched folder, or,
 * where the path to it cannot be one piece or is not spelled as the folder lists it (`exact` false: seatReach's
 * `legalExact`), the folder's name alone (every `.legal` below the searched folder).
 */
export function legalExclusion(legalBelow: string, exact: boolean): string {
  return exact && PLAIN_GLOB_PATH.test(legalBelow) && !legalBelow.split("/").includes("..") ? `!/${legalBelow}` : `!${legalBelow.split("/").pop() ?? legalBelow}`;
}

/** A seat's Grep of a folder that holds the run's `.legal`: the same call, with the exclusion piece appended last. */
function leaveLegalOut(ctx: HookContext, legalBelow: string, exact: boolean): HookDecision {
  const input = (typeof ctx.input.tool_input === "object" && ctx.input.tool_input !== null ? ctx.input.tool_input : {}) as Record<string, unknown>;
  const glob = typeof input.glob === "string" && input.glob.trim() !== "" ? input.glob.trim() : "";
  const piece = legalExclusion(legalBelow, exact);
  return { kind: "replace-input", updatedInput: { ...input, glob: glob === "" ? piece : `${glob} ${piece}` } };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The entry the launch hook bound this seat to, waiting up to SEAT_BINDING_WAIT_MS for the binding; null if none came. */
async function boundEntry(ctx: HookContext, list: LaunchList): Promise<{ id: string; entry: ListedEntry | null } | null> {
  const run = ctx.run;
  const agentId = ctx.input.agent_id;
  if (!run || typeof agentId !== "string" || agentId === "") return null;
  const until = Date.now() + SEAT_BINDING_WAIT_MS;
  for (;;) {
    // An events file the reader refuses throws: the route fails, and the entry refuses the call (fails closed).
    const b = seatBinding(run.launchDir, readLaunchEvents(run.eventsPath).events, agentId);
    if (b.launched) {
      const id = b.launched.entry;
      const entry = (Array.isArray(list.entries) ? (list.entries as ListedEntry[]) : []).find((e) => e.id === id) ?? null;
      return { id, entry };
    }
    if (Date.now() >= until) return null;
    await sleep(BINDING_POLL_MS);
  }
}

/** A listed file read now, against every digest `digests` records for it. */
function digestProblem(hit: string, digests: string[]): HookDecision | null {
  const got = readProgramFile("the listed file", hit);
  if (!got.ok) return refuse(`${valueText(hit)}, a file the launch list names, cannot be read as the file the program wrote: ${valueText(got.problem)}.`);
  const bytes = got.value;
  const changed = digests.filter((d) => !listedDigestMatches(bytes, d));
  if (changed.length > 0) {
    return refuse(`${hit}, a file the launch list names, has changed since the pre-launch step recorded it (sha256 ${sha256(bytes).slice(0, 16)}…, the list records ${changed.map((d) => `${d.slice(0, 16)}…`).join(" and ")}).`);
  }
  return null;
}

/**
 * The one file under `.legal` an answer seat is sent to that its entry cannot name - its
 * candidate's per-place table. Its brief, its fold and the agent text's "Answer mode" each tell it to read rows of that
 * table, and the fold command writes the table with the fold after the pre-launch step (index.ts `verdict-reading
 * --fold`), so the entry names the fold with no digest and the table not at all: in both of Try A's runs the answer
 * seat's Read of it was refused. It passes only for an entry of role `verdict-after-readers` with one candidate and a
 * fold the entry names, where that fold names this very path as its `per_place_table`, and where the path is that
 * candidate's table under this run's `.legal` (place-fold.ts `placeTablePath`): never the folder, another candidate's
 * table, or any other file. A fold that cannot be read or parsed opens nothing.
 */
function isOwnPlaceTable(entry: ListedEntry, mine: Map<string, string[]>, run: { projectDir: string; legalDir: string }, targets: readonly string[]): boolean {
  const e = entry as unknown as Record<string, unknown>;
  if (e.role !== "verdict-after-readers") return false;
  const ids = Array.isArray(e.finding_ids) ? e.finding_ids : [];
  const id = ids[0];
  if (ids.length !== 1 || typeof id !== "string" || id === "") return false;
  const fold = e.fold as { file?: unknown } | undefined;
  if (!fold || typeof fold !== "object" || typeof fold.file !== "string" || fold.file === "") return false;
  const foldPath = resolve(run.projectDir, fold.file);
  if (!mine.has(foldPath)) return false;
  const table = resolve(placeTablePath(run.legalDir, id));
  if (!targets.includes(table)) return false;
  const got = readProgramFile("the fold", foldPath);
  if (!got.ok) return false;
  let named: unknown;
  try {
    named = (JSON.parse(got.value.toString("utf8")) as { per_place_table?: { path?: unknown } } | null)?.per_place_table?.path;
  } catch {
    return false;
  }
  return typeof named === "string" && resolve(run.projectDir, named) === table;
}

/** PreToolUse on Read, Grep and Glob, a seat of this plugin. */
export async function onSeatRead(ctx: HookContext): Promise<HookDecision> {
  const run = ctx.run;
  if (!run || !eventInActiveRun(ctx)) return PASS;
  const reach = seatReach(ctx);
  if (reach === null) return PASS;
  if (!reach.inLegal && reach.legalBelow !== null) return leaveLegalOut(ctx, reach.legalBelow, reach.legalExact);
  // Each path, run id and error message in these sentences through `valueText`.
  const what = `this ${reach.tool} of ${valueText(reach.target)}`;
  const unsure = (why: string): HookDecision => (reach.inLegal ? refuse(`${what} is refused because ${why}, so no file of the run can be checked.`) : PASS);
  const marker = readActiveRun(run.launchDir);
  if (marker.state === "none") return PASS;
  if (marker.state === "unreadable") return unsure(`the active-run marker in ${valueText(run.launchDir)} cannot be read (${valueText(marker.error)})`);
  const listRead = readProgramFile("the launch list", run.listPath);
  if (!listRead.ok) return unsure(`the launch list ${valueText(run.listPath)} cannot be read (${valueText(listRead.problem)})`);
  const listBytes = listRead.value;
  // the marker was read first: a list the program replaced since is taken once the marker records it.
  if ((marker.marker.list_sha256 === null || listRead.sha256 !== marker.marker.list_sha256) && markerRecording(run.launchDir, marker.marker, listRead.sha256) === null) {
    return unsure(`the launch list ${valueText(run.listPath)} is not the one the pre-launch step wrote for run ${valueText(marker.marker.run_id)} (sha256 ${listRead.sha256.slice(0, 16)}…)`);
  }
  let list: LaunchList;
  try {
    list = JSON.parse(listBytes.toString("utf8")) as LaunchList;
  } catch (e) {
    return unsure(`the launch list ${valueText(run.listPath)} does not read as JSON (${valueText(messageOf(e))})`);
  }
  if (!reach.inLegal) {
    // Outside `.legal`: a file some entry names is checked against the list's digests (as in earlier versions); the rest passes.
    if (reach.file === null) return PASS;
    const listed = listedFiles(list, run.projectDir);
    const hit = reach.file.find((p) => listed.has(p));
    return hit === undefined ? PASS : (digestProblem(hit, listed.get(hit) ?? []) ?? PASS);
  }
  if (reach.file === null) {
    const kind = reach.tool === "Glob" ? "a Glob" : "a Grep with a glob or with no path";
    return keepOut(`${what} is refused: it lies under the run's .legal (${valueText(run.legalDir)}), and ${kind} there never reads one file your launch entry names.`);
  }
  const bound = await boundEntry(ctx, list);
  if (bound === null) {
    return refuse(`${what} is refused because this seat (${String(ctx.input.agent_id)}) is not bound to an entry of the launch list ${SEAT_BINDING_WAIT_MS / 1000} s after it asked, so no file under the run's .legal can be matched to its launch.`);
  }
  if (bound.entry === null) {
    return refuse(`${what} is refused because this seat is bound to the entry ${valueText(bound.id)}, which the launch list ${valueText(run.listPath)} does not hold.`);
  }
  const mine = entryFiles(bound.entry, run.projectDir);
  const hit = reach.file.find((p) => mine.has(p));
  if (hit === undefined) {
    if (isOwnPlaceTable(bound.entry, mine, run, reach.file)) return PASS;
    return keepOut(`${what} is refused: it lies under the run's .legal (${valueText(run.legalDir)}), and your launch entry ${valueText(bound.id)} does not name it.`);
  }
  return digestProblem(hit, mine.get(hit) ?? []) ?? PASS;
}

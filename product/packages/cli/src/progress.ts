/**
 * STEP 5 OF THE SPEED-UP LANE: what the person watching a scan sees while it runs.
 * The owner's reason, 2026-09-14: a user must not sit through a
 * silent quarter of an hour.
 *
 * ## EVERYTHING HERE IS WRITTEN TO `stderr`. NOTHING HERE IS EVER WRITTEN TO `stdout`.
 *
 * That is not a matter of taste, and it is the whole reason this feature is safe to ship (§E.3).
 * Several permanent gates assert the ABSENCE of text in this command's stdout —
 * a test asserts that a rule id followed by `" ("` appears nowhere in
 * it, `:781` that `/! gated-corroborated/` does not, `:1106` that a whole heading does not — and a
 * single progress line on stdout would put that entire class of gate one careless byte away from a
 * false green. A test builds its haystack as `${stdout}${stderr}` and asserts
 * absences in it, which is why `--progress` must also DEFAULT TO SILENT under a pipe: every gate
 * runs the CLI through `execFileSync`, never a TTY, so `auto` writes nothing for any of them and no
 * gate tool needed a line changed. A test additionally asserts that no
 * sentence written here contains a phrase `test-fail-on.mjs` asserts absent, reading those phrases
 * out of that file, so a future sentence cannot turn one of its controls green by accident.
 *
 * ## WHAT IS SHOWN, AND WHY IT IS TOPICS AND NOT LINES
 *
 * The display exists for the WAITING EXPERIENCE. 996 matched lines or 122 candidates scrolling past
 * make a first-time reader conclude "false positives" and leave, before layer 2 — which runs in
 * their own agent and is where precision is decided — has read a single one of them. So the default
 * detail level is `topics`: one updating line carrying files read, elapsed, an ETA once it means
 * anything, and HOW MANY TOPICS are waiting to be reviewed; no per-candidate line at all. A topic is
 * a rule PACK, and its label is read from `TOPIC_LABELS` below. The closing block names each topic
 * with the number of FILES that carry a candidate, and says what happens next: layer 2 reviews them
 * in the user's agent. Nothing here calls a candidate a finding, and nothing here says how many
 * survive review — no such figure is approved for public use.
 *
 * `--progress-detail candidates` restores the per-location stream for a reader who wants it. Both
 * levels obey `--progress auto|always|never`, and neither changes a byte of stdout or of the
 * findings document.
 *
 * ## It decides nothing (§E.5)
 *
 * Which locations may be counted is `confirmedInRecord` in `engine.ts`, called from here and from
 * nowhere else, and built out of the merge's own subtractions. This file formats what that function
 * returns and counts what it defers. It never inspects a rule, a pattern or a line.
 *
 * ## A display may never fail a scan
 *
 * Every byte this file writes goes through `write` below, which is wrapped in a `try/catch` and
 * latched off by a `process.stderr` `error` listener. The failure that made this necessary: with
 * `--progress always` and the reader of stderr gone first (`2>&1 | head`, `| less` then `q`), the
 * EPIPE was unhandled — the scan exited 1 and at `--jobs >= 2` never wrote its findings document at
 * all. A scan whose screen goes away must finish,
 * write its document and exit exactly as `--progress never` does.
 */
import { basename } from "node:path";
import { checksFoundNothing, group, plural } from "./count-words.js";
import { placeCountOf } from "./launch-plan.js";
import { OWN_ERASE, writeOwnErase } from "./printed-output.js";
import { CANDIDATE_LINE_TEXT_CHARS, confirmedInRecord, productPrintedRedaction, streamableRuleIds, type FileRecord } from "./engine.js";
import { redactCutText, type PrintedRedaction } from "./credential-redaction.js";
import type { Findings, Rule } from "wolfboy-schemas";
import { OWN_WORKING_FOLDER, refusedByRuleOf } from "./read-scope.js";

/**
 * THE THREE FORMATTERS THE CONSOLE REPORT SHARES WITH THIS DISPLAY, exported for that reason alone (`group` and `plural` from count-words.ts).
 *
 * `scan.ts`'s first screen states the same three things this block states — how many files were
 * read, how long it took, and how many files carry a candidate — and the project's rule for two places
 * that must agree is to export and import rather than to copy. A second `toLocaleString` call or a
 * second "N s under a minute" rule in `report.ts` is exactly the drift this repository keeps
 * removing: the console would say `5720 files in 51 s` beside `5,720 files in 50 s` on stderr, for
 * one run of one tree.
 */
export { checksFoundNothing, group, plural };

/** `--progress` as typed. `auto` is the default and means "only when stderr is a terminal". */
export type ProgressMode = "auto" | "always" | "never";

/** `--progress-detail` as typed. `topics` is the default. */
export type ProgressDetail = "topics" | "candidates";

/** A `--progress`/`--progress-detail` value this module cannot act on. `index.ts` makes it exit 1. */
export class ProgressOptionError extends Error {}

export function resolveProgressMode(spec: string | undefined): ProgressMode {
  if (spec === undefined) return "auto";
  if (spec === "auto" || spec === "always" || spec === "never") return spec;
  throw new ProgressOptionError(
    `--progress must be one of: auto, always, never — got ${JSON.stringify(spec)}. ` +
      `auto (the default) streams to stderr only when stderr is a terminal; always streams whatever ` +
      `stderr is; never streams nothing. No mode writes to stdout, and none of the three changes the ` +
      `findings document.`,
  );
}

export function resolveProgressDetail(spec: string | undefined): ProgressDetail {
  if (spec === undefined) return "topics";
  if (spec === "topics" || spec === "candidates") return spec;
  throw new ProgressOptionError(
    `--progress-detail must be one of: topics, candidates — got ${JSON.stringify(spec)}. ` +
      `topics (the default) counts the topics waiting to be reviewed and names them at the end; ` +
      `candidates additionally prints every confirmed location as its file finishes. Neither writes ` +
      `to stdout, and neither changes the findings document.`,
  );
}

/**
 * THE ONE PLACE A TOPIC'S HUMAN LABEL IS DECIDED, keyed by rule pack id.
 *
 * **Decided by the owner on 2026-09-16, exactly as proposed.** The wording is PUBLIC-FACING TEXT and
 * therefore the owner's and nobody else's; the proposal decided
 * on is an internal record, and these 27 rows are
 * its second column, unchanged. The decision is this object and no other edit, which is why every
 * display path below reads `topicLabel` and never a pack id, and why the gate's own topic oracle
 * imports `topicLabel` from here rather than keeping a second copy of the wording.
 *
 * A pack with no row here shows its own id, which is what every pack did before this object was
 * filled: a pack added to the bundle tomorrow is legible on the day it ships and gets its label when
 * its wording is decided.
 */
export const TOPIC_LABELS: Readonly<Record<string, string>> = {
  "acting-as-subject": "actions taken as the user",
  "ai-inference": "AI model calls",
  "ai-prohibited": "prohibited AI practices",
  "ai-transparency": "AI disclosure",
  baseline: "secrets and transport safety",
  "delegated-access": "access on someone's behalf",
  "derived-personal-data": "data derived about people",
  "device-telemetry": "device telemetry",
  "eu-accessibility": "accessibility",
  "eu-consent": "tracking and consent",
  "eu-cra": "product security duties",
  "eu-data-act": "data portability",
  "eu-dsa": "user content and moderation",
  // Replacing the 2026-09-16 words: a
  // developer who is not a lawyer does not know "data subject"; the report's own area name (assemble-report.ts `areas`) says it.
  "eu-dsr": "people's requests about their data",
  "eu-market": "geographic restrictions",
  "eu-minors": "children's accounts",
  "eu-retention": "retention periods",
  "eu-special-categories": "sensitive categories of data",
  "exposure-surface": "admin and internal access paths",
  "extension-code": "third-party code run in-process",
  federation: "federated servers",
  // Replacing the 2026-09-16 words with the report's own area name.
  "identity-issuance": "sign-in data shared with other services",
  "platform-store": "storage the OS owns",
  presence: "presence and activity status",
  recipients: "third parties receiving data",
  "remote-actuation": "remote control of devices",
  "safeguard-reach": "safeguards that may not reach",
};

/** The label to show for a pack: its own id until its wording is decided. */
export function topicLabel(pack: string): string {
  return TOPIC_LABELS[pack] ?? pack;
}

/** One row of the topic table: the owner's label for a pack, and the files that carry a candidate. */
export interface TopicRow {
  label: string;
  files: number;
}

/**
 * THE DOCUMENT'S OWN TOPICS, AND THE ONE FUNCTION THAT COMPUTES THEM.
 *
 * Every location of every candidate the document carries, grouped by rule PACK and counted in
 * FILES. It was a private method of the display until 2026-09-16; it is a free function now because
 * the console's first screen (`report.ts`) prints the same table, and the project's rule for two
 * places that must agree is "export it and import it" rather than keep a second copy. This is that
 * export: one body, called from the closing block and from the console, so the two cannot disagree.
 *
 * IT DECIDES NOTHING. Both callers run after `writeFindingsJson`, so this REPORTS what the merge
 * already decided rather than deciding it a second time.
 *
 * @param packByRuleId the packs of the rules THIS RUN compiled. A rule the caller was not given has
 *   no pack here and is skipped rather than shown under an invented name.
 */
export function topicsOfDocument(
  findings: Findings,
  packByRuleId: ReadonlyMap<string, string>,
): Map<string, Set<string>> {
  const byPack = new Map<string, Set<string>>();
  for (const c of findings.candidates ?? []) {
    const pack = packByRuleId.get(c.rule_id);
    if (pack === undefined) continue;
    for (const l of c.locations ?? []) {
      const files = byPack.get(pack);
      if (files) files.add(l.file);
      else byPack.set(pack, new Set([l.file]));
    }
  }
  return byPack;
}

/**
 * The rows in the ONE order both tables print them in: by file count, largest first, and by LABEL
 * where two counts are equal.
 *
 * The tie-break is on the label and never on the pack id, so that `federated servers` sorts before
 * `prohibited AI practices` — the reader sees labels, and two runs of one tree must not print two
 * orders.
 */
export function topicRowsOf(topics: ReadonlyMap<string, ReadonlySet<string>>): TopicRow[] {
  return [...topics.entries()]
    .map(([pack, files]) => ({ label: topicLabel(pack), files: files.size }))
    .sort((a, b) => b.files - a.files || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

/**
 * The table as LINES, which is the unit both callers need and the reason this is not two renderers.
 *
 * Two columns, and the count is RIGHT-ALIGNED:
 * a column of numbers a reader compares is read down its last digit, and
 * `1,365` beside `4` left-aligned puts the two on different columns. The closing block printed the
 * count left-aligned until that decision; it prints this, because there is one renderer.
 */
export function topicTableLines(rows: readonly TopicRow[]): string[] {
  const widest = rows.reduce((w, r) => Math.max(w, r.label.length), 0);
  const widestCount = rows.reduce((w, r) => Math.max(w, group(r.files).length), 0);
  return rows.map(
    (r) =>
      `  ${r.label.padEnd(widest)}  ${group(r.files).padStart(widestCount)} ` +
      `${plural(r.files, "file", "files")}`,
  );
}

/**
 * THE AREA TABLE OF THE QUICK SCAN'S SCREEN.
 *
 * One row per area (a rule pack, under its owner's label), counted in PLACES - the document's candidate records - with
 * a bar split by each place's severity. Places, not files and not groups, because the end of the run
 * accounts for the same places by outcome and the two screens must add up to one number.
 *
 * NO ROW OF THE HIGHEST CLASSES IS EVER FOLDED (the parent's ruling of 2026-10-13, reconciling two rulings: the owner's
 * of 2026-09-16, no cap on the topic table, because a cap hid a topic's row on a large tree; and the owner-approved
 * mock-up of 2026-10-12, five rows and "N more areas"). The rows are in order of severity; a row holding a high place
 * or a place of the prohibited-practice area is always shown, however many such rows there are; only rows below them
 * are folded, into one line that names how many and points at the report, where every row is. The report keeps the
 * full table, uncapped. The third class of the ruling, a not-checked item, has no instance here: this table is drawn
 * before step 2, when nothing has been checked by Claude yet, and no terminal screen after step 2 draws an area table.
 */
export interface AreaRow {
  pack: string;
  label: string;
  high: number;
  medium: number;
  low: number;
  places: number;
}

/** The area whose places are prohibited practices: its row is never folded. */
export const PROHIBITED_PRACTICE_PACK = "ai-prohibited";
/** How many rows the table shows before it folds the rest (the mock-up of 2026-10-12), unless more must be shown. */
export const AREA_ROWS_SHOWN = 5;
/** The width of the longest bar, in cells. */
export const AREA_BAR_WIDTH = 26;
const BAR_CELL = { high: "█", medium: "▓", low: "░" } as const;
/** The legend beside the headline, in the bar's own cells. */
export const AREA_LEGEND = `${BAR_CELL.high} high  ${BAR_CELL.medium} medium  ${BAR_CELL.low} low`;

/** A row that is never folded: it holds a high place, or a place of the prohibited-practice area. */
export function areaAlwaysShown(r: AreaRow): boolean {
  return r.high > 0 || r.pack === PROHIBITED_PRACTICE_PACK;
}

/**
 * The document's areas, in the one order the table prints them: the rows never folded first, the prohibited-practice
 * area first among them, then by high places, medium places, low places, all places, and the label.
 */
export function areaRowsOf(
  findings: Findings,
  packByRuleId: ReadonlyMap<string, string>,
): AreaRow[] {
  const byPack = new Map<string, AreaRow>();
  for (const c of findings.candidates ?? []) {
    const pack = packByRuleId.get(c.rule_id);
    if (pack === undefined) continue;
    let row = byPack.get(pack);
    if (row === undefined) {
      row = { pack, label: topicLabel(pack), high: 0, medium: 0, low: 0, places: 0 };
      byPack.set(pack, row);
    }
    /* A place is one location (a file and a line), counted as
     * launch-plan.ts `placeCountOf` counts it, so this screen and the start question say one number of places. */
    const n = placeCountOf(c);
    row.places += n;
    // The document's own severity of the place (`candidates[].severity`), so a reader re-derives the bar from it alone.
    const sev = c.severity;
    if (sev === "high") row.high += n;
    else if (sev === "medium") row.medium += n;
    else row.low += n;
  }
  const rank = (r: AreaRow): number[] => [
    areaAlwaysShown(r) ? 0 : 1,
    r.pack === PROHIBITED_PRACTICE_PACK ? 0 : 1,
    -r.high,
    -r.medium,
    -r.low,
    -r.places,
  ];
  return [...byPack.values()].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return (ra[i] as number) - (rb[i] as number);
    return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
  });
}

/** The cells of one bar: its length by places against the largest row, each severity present given at least one. */
export function areaBarOf(r: AreaRow, largest: number): string {
  const length = Math.max(1, Math.round((r.places * AREA_BAR_WIDTH) / Math.max(1, largest)));
  const parts = [r.high, r.medium, r.low];
  const present = parts.filter((n) => n > 0).length;
  const cells: number[] = parts.map((n) => (n > 0 && length >= present ? 1 : 0));
  let left = length - cells.reduce((a, b) => a + b, 0);
  const share = parts.map((n) => (n / Math.max(1, r.places)) * length);
  while (left > 0) {
    let best = 0;
    for (let i = 1; i < 3; i++) if ((share[i] as number) - (cells[i] as number) > (share[best] as number) - (cells[best] as number)) best = i;
    cells[best] = (cells[best] as number) + 1;
    left--;
  }
  return BAR_CELL.high.repeat(cells[0] as number) + BAR_CELL.medium.repeat(cells[1] as number) + BAR_CELL.low.repeat(cells[2] as number);
}

/** The rows shown, and the rows folded: at least five shown, and every row that is never folded. */
export function areaRowsShown(rows: readonly AreaRow[]): { shown: AreaRow[]; folded: AreaRow[] } {
  const always = rows.filter(areaAlwaysShown).length;
  const n = Math.max(AREA_ROWS_SHOWN, always);
  return { shown: rows.slice(0, n), folded: rows.slice(n) };
}

/** The table as lines: the shown rows with their bars, then one line for the folded rows, if any. */
export function areaTableLines(rows: readonly AreaRow[]): string[] {
  const { shown, folded } = areaRowsShown(rows);
  const largest = rows.reduce((m, r) => Math.max(m, r.places), 0);
  const foldedPlaces = folded.reduce((n, r) => n + r.places, 0);
  const widest = shown.reduce((w, r) => Math.max(w, r.label.length), 0);
  const countWidth = [...shown.map((r) => r.places), foldedPlaces].reduce((w, n) => Math.max(w, group(n).length), 0);
  const out = shown.map((r) => `  ${r.label.padEnd(widest)}  ${areaBarOf(r, largest).padEnd(AREA_BAR_WIDTH)}  ${group(r.places).padStart(countWidth)}`);
  if (folded.length > 0) {
    const text = `  ${group(folded.length)} more ${plural(folded.length, "area", "areas")}, all in the full list`;
    out.push(`${text.padEnd(2 + widest + 2 + AREA_BAR_WIDTH + 2)}${group(foldedPlaces).padStart(countWidth)}`);
  }
  return out;
}

/** What a `read-scope:<class>` member holds back, as the noun the sentence wants. */
const READ_SCOPE_NOUN: Readonly<Record<string, string>> = { tests: "test", vendored: "vendored", build: "built" };

/**
 * THE FOLDERS NO RULE READS, ONE
 * COMPUTATION for the quick scan's line, the end screen, report.md, not-checked.md and the record. The `refused-by-rule`
 * member counts every folder the walker leaves out by rule, WolfBoy's own working folder (`.legal`) among them; the
 * report said "19+ files in machine-written folders (node_modules, .git and the like)" where the 19 were `.legal`'s and
 * neither node_modules nor anything like it was there, while the end screen, which did not count the member at all, said
 * "not read: none". `.legal` holds the scan's own files, never the project's, so it is not counted here (the quick scan's
 * statistics line still names it); the folders that are counted are named from the walker's own rows. Made from read-scope.ts `refusedByRuleOf`, the one computation the scan's own sentence
 * takes too: the dependency lock files were added into the files "in the <named> folders" (a root `package-lock.json`
 * read as a file of `.git`); they are counted apart now, and every refused folder is named.
 */
export { OWN_WORKING_FOLDER };
export interface FoldersNotRead {
  /** Files counted in the folders refused by rule, `.legal`'s left out. */
  files: number;
  /** Folders whose files were not counted. */
  uncounted: number;
  /** Folders refused by rule, `.legal` left out: how many, where none is named. */
  folders: number;
  /** The folders, by the walker's rows, most files first, `.legal` left out. */
  names: string[];
  /** Dependency lock files and test or story files refused by their names, counted apart. */
  lockFiles: number;
  testFiles: number;
  /** Files refused by their names where only the member's counts say so (no walker row tells their kind). */
  byName?: number;
}
export function foldersNotReadOf(findings: Findings): FoldersNotRead | null {
  const r = refusedByRuleOf((findings as { excluded_by_walker?: { reason?: string; dir?: string; files?: number | null }[] }).excluded_by_walker ?? []);
  if (r.folders.length > 0 || r.lockFiles + r.testFiles > 0) {
    return { files: r.folderFiles, uncounted: r.uncounted, folders: r.folders.length, names: r.folders.map((f) => f.dir), lockFiles: r.lockFiles, testFiles: r.testFiles };
  }
  /* A document whose walker rows say nothing of what the member counts (a planted one; a scan writes both): the member's
   * counts, never less than it records ("Not read: 0 files" over two folders would hide them). Its files refused by name
   * cannot be told apart here, so they are said as files refused by their names. `.legal` has no row to be told apart by. */
  if (r.own !== null) return null;
  const limit = (findings.coverage_limits?.limits ?? []).find((l) => l.id === "refused-by-rule");
  const c = (limit?.counts ?? {}) as Record<string, number | undefined>;
  const files = c.files_in_directories ?? 0;
  const uncounted = (c.directories_not_enumerated ?? 0) > 0 ? 1 : 0;
  if ((c.directories ?? 0) === 0 && (c.files ?? 0) === 0) return null;
  return { files, uncounted, folders: c.directories ?? 0, names: [], lockFiles: 0, testFiles: 0, byName: c.files ?? 0 };
}
/**
 * The words of `foldersNotReadOf`, `names` already joined in the form the screen prints (plain, or markdown): the folders,
 * then the files refused by name, each its own part. "1+ file" had "+" with the
 * singular: a count that is only a lower bound takes the plural.
 */
export function foldersNotReadWords(d: FoldersNotRead, names: string): string {
  return foldersNotReadParts(d, names).join(", ");
}
/**
 * The same parts in the three lengths the screens' 80 columns take (`notReadFolded`): `long` as the report says it, `short`
 * without "which the scan never reads", `count` with the folders as a number. The
 * screens keep to 80 columns: since the folders were named (r15-b item 4) the quick scan's line ran to 103 on a demo app
 * with only `.git` left out, and nothing folded it: it folded only the files the walker did not open.
 */
export function foldersNotReadParts(d: FoldersNotRead, names: string, form: "long" | "short" | "count" = "long"): string[] {
  const k = d.names.length;
  // With no folder named, how many folders the walker refused (not only those whose files went uncounted).
  const n = Math.max(d.folders ?? 0, d.uncounted);
  // "the a, b, c and 1 more folders": the names shown, then how many more.
  const which = k === 0 ? (n > 1 ? `${group(n)} folders` : "a folder") : `the ${names} ${k === 1 ? "folder" : "folders"}${k > 3 ? ` and ${group(k - 3)} more` : ""}`;
  const plus = d.uncounted > 0;
  const folders = Math.max(n, k);
  const out =
    folders === 0
      ? []
      : form === "count"
        ? [`${group(folders)} ${folders === 1 ? "folder" : "folders"}`]
        : [`${d.files > 0 ? `${group(d.files)}${plus ? "+" : ""} ${plus ? "files" : plural(d.files, "file", "files")} in ` : ""}${which}${form === "long" ? ", which the scan never reads" : ""}`];
  if ((d.lockFiles ?? 0) > 0) out.push(`${group(d.lockFiles)} dependency lock ${plural(d.lockFiles, "file", "files")}`);
  if ((d.byName ?? 0) > 0) out.push(`${group(d.byName ?? 0)} ${plural(d.byName ?? 0, "file", "files")} refused by ${d.byName === 1 ? "its name" : "their names"}`);
  if ((d.testFiles ?? 0) > 0) out.push(`${group(d.testFiles)} test or story ${plural(d.testFiles, "file", "files")}${form === "long" ? ` by ${d.testFiles === 1 ? "its name" : "their names"}` : ""}`);
  return out;
}
/** The folder names as `foldersNotReadWords` takes them, plain: the first three ("a, b and c"); the words say how many more. */
export function folderNamesOf(names: readonly string[]): string {
  const shown = names.slice(0, 3);
  return shown.length <= 1 ? shown.join("") : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

/**
 * What the quick scan did not read and how many checks found nothing (the mock-up's last line of screen 3, two rows since
 * INT-R19: `notReadLine` and `checksFoundNothing`).
 * Read from the same `coverage_limits` members' counts the full section prints the sentences of, never parsed back out
 * of a sentence; files stopped for time are files not read whole, so they are named here too.
 */
export function notReadParts(findings: Findings): { notRead: string[]; folders: string[]; foldersShort: string[]; foldersCount: string[]; notOpened: string[]; notOpenedFiles: number; silent: number } {
  const limits = findings.coverage_limits?.limits ?? [];
  const notRead: string[] = [];
  // WHAT THE WALKER DID NOT OPEN AND WHAT NO RULE
  // READ, from the `not-readable-as-code` member's own counts (and the walker's rows only to tell the size ceiling apart):
  // until 2026-11-10 this line counted the read scope and the time budget alone, so a tree whose 1.3 MB source file was
  // refused printed "Not read: none". Kept apart from `notRead` because the report's first screen counts these by its own
  // kinds (assemble-report.ts `notReadItemsOf`); the quick scan's line and the end screens print both (`notReadAll`).
  const notOpened: string[] = [];
  const asCode = limits.find((l) => l.id === "not-readable-as-code")?.counts as Record<string, number | undefined> | undefined;
  const walkerRows = (findings as { excluded_by_walker?: { reason?: string; files?: number | null }[] }).excluded_by_walker ?? [];
  const tooLarge = walkerRows.filter((e) => e.reason === "size-limit").reduce((s, e) => s + (e.files ?? 0), 0);
  const refused = asCode?.refused_by_the_walker ?? 0;
  const timeWhole = ((findings as { files_not_read?: { reason?: string }[] }).files_not_read ?? []).filter((x) => x.reason === "time-budget").length;
  const noRule = Math.max(0, (asCode?.read_to_no_rule ?? 0) - timeWhole);
  const entries = asCode?.entries_not_regular_or_not_opened ?? 0;
  // A Git LFS pointer's content was not read; a file not in UTF-8 was
  // read with its other bytes as replacement characters, so it was read only in part.
  const lfs = asCode?.git_lfs_pointers_not_read ?? 0;
  const notUtf8 = asCode?.files_read_with_bytes_not_utf8 ?? 0;
  if (tooLarge > 0) notOpened.push(`${group(tooLarge)} ${plural(tooLarge, "file", "files")} too large`);
  if (refused - tooLarge > 0) notOpened.push(`${group(refused - tooLarge)} ${plural(refused - tooLarge, "file", "files")} not text or of a type not scanned`);
  if (entries > 0) notOpened.push(`${group(entries)} ${plural(entries, "link or special file", "links or special files")} not opened`);
  if (lfs > 0) notOpened.push(`${group(lfs)} Git LFS ${plural(lfs, "pointer", "pointers")}`);
  if (notUtf8 > 0) notOpened.push(`${group(notUtf8)} ${plural(notUtf8, "file", "files")} not UTF-8, read in part`);
  if (noRule > 0) notOpened.push(`${group(noRule)} ${plural(noRule, "file", "files")} unreadable`);
  for (const l of limits) {
    if (!l.id.startsWith("read-scope:") || l.read === true) continue;
    const files = (l.counts as { files?: number } | undefined)?.files ?? 0;
    if (files <= 0) continue;
    const cls = l.id.slice("read-scope:".length);
    notRead.push(`${group(files)} ${READ_SCOPE_NOUN[cls] ?? cls} ${plural(files, "file", "files")}`);
  }
  const stopped = findings.stats?.files_stopped_for_time ?? 0;
  if (stopped > 0) notRead.push(`${group(stopped)} ${plural(stopped, "file", "files")} stopped for time`);
  const silent = (limits.find((l) => l.id === "rules-silent")?.counts as { rules_silent?: number } | undefined)?.rules_silent ?? 0;
  // The folders no rule reads, said once: the report's first screen words them from
  // the same computation (assemble-report.ts `notReadMachine`), so `folders` is kept apart from `notRead`.
  const f = foldersNotReadOf(findings);
  const folders = f ? [foldersNotReadWords(f, folderNamesOf(f.names))] : [];
  const foldersShort = f ? [foldersNotReadParts(f, folderNamesOf(f.names), "short").join(", ")] : [];
  const foldersCount = f ? [foldersNotReadParts(f, folderNamesOf(f.names), "count").join(", ")] : [];
  return { notRead, folders, foldersShort, foldersCount, notOpened, notOpenedFiles: Math.max(0, refused) + entries + lfs + notUtf8 + noRule, silent };
}

/** Every part of what was not read, as the quick scan's line and the end screens print it. */
export function notReadAll(parts: { notRead: string[]; folders?: readonly string[]; notOpened: string[] }): string[] {
  return [...parts.notRead, ...(parts.folders ?? []), ...parts.notOpened];
}

/**
 * The quick scan's "Not read" line, as the mock-up's screen 3 prints it. The checks that found nothing follow on a row of
 * their own (`quickScanDoneLines`), in the one sentence every other surface prints: beside even "Not read: none" that
 * sentence ran to 82 columns at three digits.
 */
export function notReadLine(findings: Findings): string {
  return notReadFolded(notReadParts(findings), (notRead) => `  Not read: ${notRead.length === 0 ? "none" : notRead.join(", ")}`);
}

/**
 * THE SCREEN'S 80 COLUMNS, for every screen that prints a "Not read" line (the quick scan's and the end screen's row): where every part does not fit, the walker's
 * parts become one count of files, each named in the report's full section. `line` lays the parts out as the screen does.
 */
export function notReadFolded(
  parts: { notRead: string[]; folders?: readonly string[]; foldersShort?: readonly string[]; foldersCount?: readonly string[]; notOpened: string[]; notOpenedFiles: number },
  line: (notRead: string[]) => string,
): string {
  const n = parts.notOpenedFiles;
  const first = [...parts.notRead, ...(parts.folders ?? [])];
  const folded = parts.notOpened.length === 0 ? null : `${group(n)} ${first.length > 0 ? "other " : ""}${plural(n, "file", "files")}`;
  const fits = (l: string): boolean => [...l].length <= 80;
  const full = line(notReadAll(parts));
  if (fits(full)) return full;
  // Then the folders said shorter, then counted; each the report's full section names.
  const tries = [
    folded === null ? null : line([...first, folded]),
    parts.foldersShort ? line([...parts.notRead, ...parts.foldersShort, ...(folded === null ? parts.notOpened : [folded])]) : null,
    parts.foldersCount ? line([...parts.notRead, ...parts.foldersCount, ...(folded === null ? parts.notOpened : [folded])]) : null,
  ].filter((l): l is string => l !== null);
  return tries.find(fits) ?? tries[tries.length - 1] ?? full;
}

/**
 * THE QUICK SCAN'S SCREEN (the mock-up's screen 3), as lines: one function, printed by the stderr closing block and as
 * the console's first screen, so the two cannot disagree ("export it and import it").
 */
export function quickScanDoneLines(findings: Findings, rules: readonly Rule[]): string[] {
  const scanned = findings.stats?.files_scanned ?? 0;
  const rows = areaRowsOf(findings, new Map(rules.map((r) => [r.id, r.pack])));
  const places = rows.reduce((n, r) => n + r.places, 0);
  const lines = [
    `✔ Quick scan done in ${duration(elapsedMsOf(findings) ?? 0)}${DOT}${group(scanned)} ${plural(scanned, "file", "files")} ` +
      `read on this computer, no AI`,
    "",
  ];
  const head = `  ${group(places)} ${plural(places, "place", "places")} worth a look` + (rows.length === 0 ? "" : `, in ${group(rows.length)} ${plural(rows.length, "area", "areas")}`);
  lines.push(rows.length === 0 ? head : `${head}${" ".repeat(Math.max(2, 69 - head.length - AREA_LEGEND.length))}${AREA_LEGEND}`);
  if (rows.length > 0) {
    lines.push("");
    lines.push(...areaTableLines(rows));
  }
  lines.push("");
  if (places > 0) lines.push("  A place worth a look is not a problem yet. Step 2 reads each one.");
  lines.push(notReadLine(findings), `  ${checksFoundNothing(notReadParts(findings).silent)}`);
  return lines;
}

/**
 * Is the stream on for this run?
 *
 * `auto` reads `process.stderr.isTTY`, which Node leaves `undefined` for a pipe or a file, so the
 * comparison is against `true` and not a truth test — the one thing that must not happen is a
 * harness inheriting a stream because a property was merely present.
 */
export function progressIsOn(mode: ProgressMode): boolean {
  if (mode === "never") return false;
  if (mode === "always") return true;
  return process.stderr.isTTY === true;
}

/**
 * What a scan tells its progress display. `undefined` everywhere the stream is off, so the whole
 * feature is `opts.progress?.file(record)` at every call site and costs one property read.
 */
export interface ScanProgress {
  /**
   * Once, after the walk and before the first file is read.
   *
   * `sizes` is the WALK's own sizes, parallel to `files` (`WalkResult.sizes`) — this display does
   * not stat anything itself. Absent where the caller supplied its own file list and never walked;
   * the byte total is then 0 and no ETA is ever shown, which is right for a caller with no tree.
   *
   * `jobs` is the number of workers THIS TREE resolved to, and it arrives here rather than at
   * construction for one reason: `auto`'s last term is the size of the tree, so the number is not
   * final until the walk is done, and the walk is what this call reports. The display held the
   * PRE-walk number until 2026-09-16 and its opening line could therefore name a number the scan
   * never used — `jobs 4` on stderr against `jobs: 1 (auto: tree below 256 KB, sequential)` on
   * stdout (open item 4 of the closing merge). One number now, read from `PreparedScan.jobs`.
   */
  start(input: { targetRoot: string; files: string[]; sizes?: number[]; jobs: number }): void;
  /** Once per file, as its record is finished. */
  file(record: FileRecord): void;
  /**
   * Once, after the document has been written. `outPath` is `null` when `--out` was not given.
   *
   * `findings` is THE DOCUMENT THIS SCAN PRODUCED, and the closing block is counted from it rather
   * than from what the display could confirm while the walk was going (parent decision, 2026-09-16 —
   * see `finish` below). A caller that has no document to hand omits it and gets the running set,
   * which is the only thing knowable without one.
   */
  finish(input: { outPath: string | null; findings?: Findings }): void;
}

/** At most four redraws a second (§E.4: "rewritten in place every 250 ms"). */
const REDRAW_MS = 250;

/**
 * `keep` for a line that must never be cut at all — see `say`. `Number.MAX_SAFE_INTEGER` rather than
 * the line's own length so that the call site says "all of it" once, whatever the line turns out to
 * be: a `keep` computed from the text is a second copy of the text's length.
 */
const MAX_KEEP = Number.MAX_SAFE_INTEGER;

/** The window the ETA's rate is measured over, so a slow patch of the tree does not set it alone. */
const SMOOTH_MS = 30_000;

/**
 * How much of the walk's bytes must be done before an ETA is shown at all.
 *
 * At one file of 1,468 the estimate was `~36:00` against an actual 14 seconds — a 150x overestimate,
 * and the FIRST number a person reads. The queue is
 * ordered largest-first, so the opening sample is the worst one the run will ever take. Below this
 * fraction no ETA is printed at all, which is honest and costs one comparison.
 */
const ETA_MIN_FRACTION = 0.1;

/** How much of a matched line is quoted. The line is already trimmed and cut to 300 by the engine. */
const QUOTE_CHARS = 80;

/**
 * The width assumed for a stream that reports none — a pipe, a file, a pty that answers 0.
 *
 * EVERY line this file writes is cut to the terminal's width, or to this where there is no width to
 * read. Before that, the `progress:` sentences were the only lines that were
 * not, so on an 80-column terminal one of them wrapped to four lines while a long quote beside it
 * was cut — two rules for one screen. One rule now, applied in `say`, so a sentence added later
 * cannot escape it.
 */
const FALLBACK_COLUMNS = 160;

/**
 * The severity markers of `summarize` (scan.ts), spelled the same way so that a reader does not
 * have to learn two vocabularies for the same three words. Padded to 8 characters there and here.
 */
const SEV_MARK: Record<string, string> = { high: "■ HIGH  ", medium: "▲ MEDIUM", low: "● LOW   " };

/** Widest rule id in the shipped bundle is 25 characters; one space of slack keeps the column. */
const RULE_ID_WIDTH = 26;

/** The field separator of the owner's 2026-09-16 shape, with one space on each side. */
const DOT = " · ";


/**
 * `m:ss` under an hour, `h:mm:ss` over it. Seconds are floored, never rounded up past the total.
 *
 * Not exported: it is reached only through `duration()`, which is what both screens print, and an
 * export nothing imports is a promise this module does not have to keep.
 */
function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const two = (n: number): string => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** How long the whole scan took, for the closing block: `12 s` under a minute, `4:12` over it. */
export function duration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return total < 60 ? `${total} s` : clock(ms);
}

/**
 * HOW LONG THE SCAN TOOK, READ OFF THE DOCUMENT — THE ONE INTERVAL BOTH SCREENS STATE.
 *
 * `null` where the document cannot say: every caller that has no document yet, and an old document
 * carrying neither timestamp. `finish()` then falls back to its own clock, which is the only
 * interval knowable without a document, exactly as it falls back to its own file tally.
 *
 * WHY THIS IS ONE FUNCTION AND NOT TWO SUBTRACTIONS. Until 2026-09-17 the first screen computed
 * `completed_at - started_at` from the document in `report.ts` while this file's closing block
 * passed `now - this.startedAt`, its own clock, which starts EARLIER — the bundle load and the walk
 * preparation are inside it. The formatter was shared and the INTERVAL was not, so one run
 * printed `app · 5,720 files in 6:08` on stdout and `scanned app: 5,720 files in 6:10` on
 * stderr, while a comment in `report.ts` gave the shared formatter as the reason that could not
 * happen (found by an independent check, 2026-09-17). It is the same defect the file count had
 * one field earlier and it is repaired the same way: both screens read the document. This removes a
 * second copy rather than adding one.
 */
export function elapsedMsOf(findings: Findings | undefined): number | null {
  // `?? ""` because both fields are optional on the type, and `Date.parse("")` is NaN — rejected
  // here rather than formatted, so a document that cannot say never prints a negative or a NaN.
  const ms = Date.parse(findings?.completed_at ?? "") - Date.parse(findings?.started_at ?? "");
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}



/**
 * THE DISPLAY. One per scan, constructed only when the stream is on.
 *
 * @param rules the selection this run compiled — the `--rules` narrowing included, so a narrowed
 *   run counts the narrowed rules and nothing else. Severities and PACKS are read from the same
 *   objects, so a marker or a topic on the screen and the one in the final block cannot disagree.
 * @param detail `topics` (the default) or `candidates` — see the file header.
 *
 * HOW `--jobs` RESOLVED IS NOT A CONSTRUCTOR ARGUMENT: it arrives at `start`, with the walk, because
 * `auto`'s last term is the size of the tree (see `ScanProgress.start`). It is handed in rather than
 * inferred either way, because `--jobs 1` is a different code path and not a pool of size one.
 */
class StderrProgress implements ScanProgress {
  private readonly streamable: ReadonlySet<string>;
  private readonly severity: ReadonlyMap<string, string>;
  private readonly pack: ReadonlyMap<string, string>;
  private readonly detail: ProgressDetail;
  private readonly tty: boolean;
  private readonly startedAt = Date.now();
  /**
   * The display is off for the rest of the run: the reader of stderr has gone. LATCHING, and set
   * from two places — the `error` listener registered in the constructor and the `catch` in `write`
   * — because the two paths deliver the same EPIPE differently.
   */
  private stopped = false;
  /** A progress line is on screen and the next write must erase it first. TTY only. */
  private lineDrawn = false;
  private lastDraw = 0;
  private total = 0;
  private done = 0;
  private bytesTotal = 0;
  private bytesDone = 0;
  private sizes: number[] = [];
  /** Set by `start`, from the walk — never at construction. See `ScanProgress.start`. */
  private jobs = 1;
  private targetRoot = "";
  private confirmed = 0;
  private undecided = 0;
  /** pack id -> the files that carry at least one confirmed candidate of that pack. */
  private readonly topics = new Map<string, Set<string>>();
  /** `(at, bytesDone)` samples, oldest first, trimmed to the smoothing window. */
  private readonly samples: { at: number; bytes: number }[] = [];

  /**
   * `baseline-002`'s clauses compiled for printed text, when the line is printed at all. A candidate's
   * line can carry a credential (on a `baseline-002` candidate it IS the credential), and this stream
   * goes to a terminal or a CI log, which leaves the run's folder. Until 2026-10-12 it printed the line
   * as it stood (verification note of 2026-09-23, part A 4).
   */
  private readonly credentials: PrintedRedaction | null;
  /** The rules of this run, for the closing block's area table (the console's first screen reads the same ones). */
  private readonly rules: readonly Rule[];

  constructor(rules: Rule[], detail: ProgressDetail) {
    this.rules = rules;
    // The CLI's own credential patterns, whatever bundle runs.
    this.credentials = detail === "candidates" ? productPrintedRedaction() : null;
    this.streamable = streamableRuleIds(rules);
    this.severity = new Map(rules.map((r) => [r.id, r.severity]));
    this.pack = new Map(rules.map((r) => [r.id, r.pack]));
    this.detail = detail;
    this.tty = process.stderr.isTTY === true;
    // THE LISTENER THAT KEEPS A CLOSED READER FROM FAILING THE SCAN. A write to a pipe
    // whose reader has gone reports EPIPE ASYNCHRONOUSLY, as an `error` event on the stream: with no
    // listener that event is thrown, which at `--jobs 1` exits 1 after the document is written and
    // at `--jobs >= 2` lands inside the pool's `message` handler and kills the run BEFORE it. One
    // listener turns both into "stop drawing", and it never throws and never prints.
    //
    // IT IS PROCESS-GLOBAL, NOT DISPLAY-GLOBAL, and it is never removed (independent verification
    // note F3, 2026-09-16): while it is registered it swallows every `error` this process raises on
    // stderr, including one raised by `engineFailure`'s own `process.stderr.write` — that path still
    // reaches `process.exit(1)`, so the exit code survives, and the alternative (an uncaught throw
    // that loses the scan) is plainly worse. It is registered ONLY here, in this constructor, so a
    // run with the display off — `--progress never`, and `auto` under a pipe, which is every gate
    // and every CI run — registers nothing at all.
    process.stderr.on("error", () => {
      this.stopped = true;
    });
  }

  /**
   * The only place this file writes a byte, so that the two ways a closed reader surfaces — a throw
   * here (a synchronous EBADF or EPIPE) and the `error` event above — are both a latch and never an
   * exception a scan can die of. After the latch, every call below is a no-op and the scan runs on
   * exactly as `--progress never` does. `ownErase`: the program's own erase, written past the printed form
   * (printed-output.ts `writeOwnErase`), which writes every other ESC as an escape.
   */
  private write(text: string, ownErase = false): void {
    if (this.stopped) return;
    try {
      if (ownErase) writeOwnErase(process.stderr);
      else process.stderr.write(text);
    } catch {
      this.stopped = true;
    }
  }

  /**
   * Write one COMPLETE line, erasing the in-place progress line first where there is one, and CUT to
   * the width. Only `draw` writes a line it does not end, which is the state `erase` is for.
   *
   * @param keep characters at the head of `text` that must survive the cut whatever the width is —
   *   the `(rule, file, line)` of a candidate line, which is what a reader acts on and what the gate
   *   compares against the document, and the document's own path in the closing block.
   */
  private say(text: string, keep = 0): void {
    this.erase();
    const limit = Math.max(keep, this.width());
    this.write(`${text.length > limit ? text.slice(0, limit) : text}\n`);
  }

  private erase(): void {
    if (!this.lineDrawn) return;
    this.write(OWN_ERASE, true);
    this.lineDrawn = false;
  }

  /**
   * The width every line is cut to: one short of the terminal's own, so the last column is left for
   * the cursor and nothing wraps; `FALLBACK_COLUMNS` where the stream reports no width at all.
   */
  private width(): number {
    const c = process.stderr.columns;
    return typeof c === "number" && c > 20 ? c - 1 : FALLBACK_COLUMNS;
  }

  /**
   * The ETA, on BYTES and not on files (§E.4), or `null` while it would be a number worth nothing.
   *
   * Per-file cost varies by a factor of 184 per kilobyte over one tree (`measurements.md` §5) and
   * file sizes span three orders of magnitude on every tree measured, so bytes remaining is the
   * better predictor of the two available — and the queue is ordered largest-first, which makes a
   * files-remaining estimate optimistic exactly at the start, where a person reads it.
   *
   * Nothing is offered until `ETA_MIN_FRACTION` of the walk's bytes are done. After that
   * it is measured over the last 30 seconds, rounded to the nearest 10 seconds and prefixed `~`: an
   * ETA stated to the second, on a scan whose per-file cost spans two orders of magnitude, is a
   * promise this tool cannot keep.
   */
  private eta(now: number): string | null {
    if (this.bytesTotal <= 0 || this.bytesDone >= this.bytesTotal) return null;
    if (this.bytesDone < this.bytesTotal * ETA_MIN_FRACTION) return null;
    const oldest = this.samples[0];
    const spanMs = now - oldest.at;
    const spanBytes = this.bytesDone - oldest.bytes;
    if (spanMs <= 0 || spanBytes <= 0) return null;
    const remaining = ((this.bytesTotal - this.bytesDone) * spanMs) / spanBytes;
    const rounded = Math.round(remaining / 10_000) * 10_000;
    // NO `~0:00 left` (independent verification note F6, 2026-09-16). It is honest — the estimate
    // rounds to zero at this granularity — but it reads as "finished" beside several more seconds of
    // scanning, and the line is for a person who is waiting. Below the granularity the honest answer
    // is no estimate, which is the same answer this method gives before the floor is reached.
    if (rounded <= 0) return null;
    return `~${clock(rounded)}`;
  }

  /** The one line that is rewritten in place. Its text is the whole of what `topics` shows. */
  private progressLine(now: number): string {
    const eta = this.eta(now);
    if (this.detail === "topics") {
      // The mock-up's screen 2: what is being read and how far it is, with
      // the time left only where it is known. No count of places while the scan runs.
      const width = 26;
      const filled = this.total === 0 ? 0 : Math.min(width, Math.floor((this.done * width) / this.total));
      return (
        `  Quick scan  ${"█".repeat(filled)}${"░".repeat(width - filled)}  ${group(this.done)} of ${group(this.total)} files` +
        `${eta === null ? "" : `${DOT}about ${eta} left`}`
      );
    }
    return (
      `  scanning  ${group(this.done)} / ${group(this.total)} files   ` +
      `${megabytes(this.bytesDone)} / ${megabytes(this.bytesTotal)} MB   ` +
      `${clock(now - this.startedAt)} elapsed   ${eta ?? "~--:--"} left   ` +
      `jobs ${this.jobs}   ${group(this.confirmed)} confirmed   ${group(this.undecided)} undecided`
    );
  }

  private draw(now: number, force: boolean): void {
    if (!force && now - this.lastDraw < REDRAW_MS) return;
    this.lastDraw = now;
    const line = this.progressLine(now);
    const limit = this.width();
    const cut = line.length > limit ? line.slice(0, limit) : line;
    if (this.tty) {
      this.erase();
      this.write(cut);
      this.lineDrawn = true;
      return;
    }
    // No terminal: the same line, on a line of its own, at the same rate. `\r` into a log file
    // produces one unreadable line, and a redraw every 250 ms is what `--progress always` asked for.
    this.write(`${cut}\n`);
  }

  start(input: { targetRoot: string; files: string[]; sizes?: number[]; jobs: number }): void {
    this.total = input.files.length;
    this.targetRoot = input.targetRoot;
    // THE NUMBER THIS TREE RESOLVED TO, not the one the command line asked for: `prepareScan` has
    // applied `auto`'s tree-size term by the time it calls this, so the opening line below and the
    // `jobs:` line the command prints at the end are one resolution read twice.
    this.jobs = input.jobs;
    // THE WALK'S OWN SIZES, NOT A SECOND `stat` PASS. `walkTarget` stats every file it
    // accepts for its size limit and now keeps the number; a caller that supplied its own file list
    // walked nothing and hands none, and then the byte total is 0 and no ETA is ever offered.
    this.sizes = input.sizes ?? [];
    this.bytesTotal = this.sizes.reduce((a, b) => a + b, 0);
    this.samples.push({ at: Date.now(), bytes: 0 });
    if (this.detail !== "topics") {
      this.say(
        `progress: scanning ${group(this.total)} ${plural(this.total, "file", "files")}, ` +
          `${megabytes(this.bytesTotal)} MB, jobs ${this.jobs}. Confirmed locations print below as ` +
          `each file finishes, in completion order, not walk order.`,
      );
      // WHAT "undecided" COUNTS, EXACTLY. The count is `confirmedInRecord`'s `deferred`,
      // which is two populations and not one: a candidate a wider gate is holding, AND every
      // candidate of a rule whose mechanism cannot be decided from one file. The earlier sentence
      // named only the first, so a directory-scope rule whose corroborator sits in the candidate's
      // own file — nothing held, nothing suppressed — was counted under a word that did not cover it.
      //
      // IT FITS IN `FALLBACK_COLUMNS`, and so does every other sentence written here, because `say`
      // cuts what does not and a cut explanation is worse than a short one. The gate asserts it: a
      // `progress:` line that does not end in a full stop was truncated.
      this.say(
        `progress: undecided = candidates a wider detector.gate_scope holds, and every candidate ` +
          `of a gate_scope or guard_missing rule. The document decides both.`,
      );
    }
    this.draw(Date.now(), true);
  }

  file(record: FileRecord): void {
    const now = Date.now();
    this.done++;
    this.bytesDone += this.sizes[record.index] ?? 0;
    this.samples.push({ at: now, bytes: this.bytesDone });
    while (this.samples.length > 2 && now - this.samples[0].at > SMOOTH_MS) this.samples.shift();
    // THE ONE DECISION, AND IT IS NOT TAKEN HERE: `confirmedInRecord` is the merge's own
    // subtraction, exported for this call and no other (§E.5).
    const { confirmed, deferred } = confirmedInRecord(record, this.streamable);
    this.undecided += deferred;
    for (const c of confirmed) {
      this.confirmed++;
      // THE TOPIC IS THE RULE'S PACK, COUNTED IN FILES: one file carrying three candidates of one
      // pack is one place to look, not three. The same sets feed the running count and the closing
      // block, so the two cannot disagree.
      const pack = this.pack.get(c.ruleId);
      if (pack !== undefined) {
        const files = this.topics.get(pack);
        if (files) files.add(record.file);
        else this.topics.set(pack, new Set([record.file]));
      }
      if (this.detail !== "candidates") continue;
      const mark = SEV_MARK[this.severity.get(c.ruleId) ?? ""] ?? "        ";
      const head = `  ${mark}  ${c.ruleId.padEnd(RULE_ID_WIDTH)}  ${c.file}:${c.line}  `;
      // The engine cut the line at 300 characters before this redaction could see it: `redactCutText`.
      const quoted = this.credentials ? redactCutText(this.credentials, c.lineText.trim(), CANDIDATE_LINE_TEXT_CHARS) : c.lineText.trim();
      this.say(`${head}${quoted.slice(0, QUOTE_CHARS)}`, head.length);
    }
    this.draw(now, false);
  }

  /**
   * THE CLOSING BLOCK: one line per topic, counted in FILES.
   *
   * Files and not lines and not candidates, because the number a person acts on is how many places
   * they have to look. Sorted by that count, largest first, and by label where two are equal so that
   * two runs of one tree cannot print two orders. The last line names the document and says what
   * happens next — and says NOTHING about how many candidates survive review: no such figure is
   * approved for public use, and a screen that guessed one would be this tool making the precision
   * claim its own contract forbids it.
   */
  finish(input: { outPath: string | null; findings?: Findings }): void {
    const now = Date.now();
    this.erase();
    // The mock-up's screen 3: the same lines the console prints as its first screen, from one function.
    if (input.findings !== undefined) {
      // Where stdout is a
      // terminal too, the console prints these very lines a moment later on the same screen, so the closing block leaves
      // them to it; where stdout goes to a pipe or a file, the person watching stderr sees them here.
      if (process.stdout.isTTY === true) return;
      for (const line of quickScanDoneLines(input.findings, this.rules)) this.say(line, MAX_KEEP);
      return;
    }
    // No document to hand: what the display itself counted, and nothing it could not.
    this.say(
      `✔ Quick scan done in ${duration(now - this.startedAt)}${DOT}${group(this.done)} ${plural(this.done, "file", "files")} ` +
        `read on this computer, no AI`,
      MAX_KEEP,
    );
  }


}

/**
 * The display for this run, or `undefined` when `--progress` resolved to off.
 *
 * Returning `undefined` rather than a no-op object is deliberate: with the stream off, nothing is
 * constructed, nothing is listened to and every call site is one optional-chaining read. A no-op
 * object would make "the stream is off" and "the stream is on and printed nothing" the same shape in
 * the code, which is the conflation this repository spends most of its comments removing.
 */
export function createProgress(mode: ProgressMode, detail: ProgressDetail, rules: Rule[]): ScanProgress | undefined {
  if (!progressIsOn(mode)) return undefined;
  return new StderrProgress(rules, detail);
}

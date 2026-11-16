/**
 * PER-PLACE CARRY-FORWARD (full-read design section 4, review R8; build unit F5).
 *
 * A candidate read by the place plan (`reading-plan-2`, unit `place`) is decided one place at a time, and a later run
 * should read again only the places whose ground moved. This module says what one place's row rested on, in data a
 * machine re-derives with no model, and compares it.
 *
 * ## Identity is content
 *
 * A place is `(rule id, file, the matched line's text folded, the occurrence of that folded text in the file)`. The line
 * number is not part of it: a place that only moved down its file is the same place, and its carried row is re-based by
 * the distance its window moved.
 *
 * ## The premises, compared in this order (the first that differs is the one reason the place is read again)
 *
 *   1. `spec`     - a DIGEST, never a hand-kept constant (R8.2): sha256 over the adjudicator's agent text (whose place
 *                   mode is the seat text), the legal-scan skill and the declared version of the program's verdict rules (`instructions.ts`: the place's instructions, as a verdict's), the two reply schemas, and the compiled program files that
 *                   write a place's payload (`context.js`, `place-facts.js`, `data-summary.js`; a file not built yet is
 *                   the word `absent`, so the day it is built every place is read once). Changing any of them reads
 *                   every place again. The bundle's version is NOT in it: a version that moves with any
 *                   rule's edit would read every place of every rule again on it; the place's own rule is
 *                   premise 2.
 *   2. `rule`     - the rule's compiled clause digest, from the verdict's own premise block (`rests-on.ts` `ruleHash`).
 *   3. `answers`  - the rule's per-rule answers from the declaration, from the same block (`answerDigest` rows).
 *   3a. `handed`  - what every seat is handed beside its payload - the person's profile and the dependency inventory
 *                   (`rests-on.ts` `handedPremiseOf`) - from the same block, against this run's. A place seat
 *                   is handed both, as a verdict seat is, so a place read under another profile is read again.
 *   4. `model`    - the seat model the place was read on, against the model it would be read on now.
 *   5. `window`   - sha256 of the text the program wrote for the place (its window lines, its import region, its
 *                   enclosing lines; a fact place: its line and its fact), without absolute line numbers. A data summary
 *                   (build unit F6) is digested as written, with every file of its group, when that unit writes one.
 *   6. `followed` - lines a follower added outside the window. Empty while the data-flow map is on hold; compared all the
 *                   same, so a record that names any is never carried by a run that names none.
 *   7. `files`    - every file the seat Read outside its payload, a `beyond` file included (C9 requires its Read), by
 *                   sha256. A Read is not attributed to one place: every file the seat opened is a premise of every
 *                   place of that seat, the safe direction.
 *   8. `searches` - every search the seat RAN, from its own transcript (not the searches it chose to report), replayed
 *                   over the tree as `rests-on.ts` replays a verdict's (R8.3). A search whose hits differ reads every
 *                   place of that seat again.
 *
 * ## What is never carried
 *
 * A place with no row in the earlier run (new, not checked, its row refused, its answer refused) has no premises and is
 * read. A premise block that is not complete (a file it opened is gone, a search does not replay, the spec could not be
 * digested, or the seat's own transcript could not be read for premises 7 and 8 or its effort when it
 * ended: `seatUntakenOf`) is never carried. A carried row is labelled CARRIED with the run it came from - never
 * re-verified.
 *
 * No clock, no randomness, no network: two comparisons of the same pair of runs are byte-identical.
 */
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { relativePath } from "./project-path.js";
import { fileURLToPath } from "node:url";
import {
  canonicalJson,
  CANDIDATE_FACT_FIELDS,
  factsOfRecord,
  LOCATION_FACT_FIELDS,
  dialectMoved,
  foldText,
  engineReplay,
  fallbackReplay,
  engineRequestOf,
  missingPathHash,
  MULTILINE_FLAG,
  isOwnRecordsScope,
  replayRecorded,
  replaySearch,
  SEAT_SEARCH_FOR,
  type RestsOnFile,
  type RestsOnSearch,
  type TreeReader,
} from "./rests-on.js";
import { pluginRoot } from "./seat-effort.js";
import { INSTRUCTIONS_SKILL, VERDICT_RULES_JUDGES_AS, VERDICT_RULES_VERSION, judgedAsThroughMarks, verdictRulesAlikeWords, verdictRulesJudgedAs, type VerdictRulesLink } from "./instructions.js";
import { VERDICT_RULES_BUILD_DIGEST } from "./verdict-rules-digest.generated.js";
import { schemaText } from "./schema-validate.js";
import type { SeatSearch, SeatSight } from "./seat-opened.js";
import { CAPTURE_CLOCK, hostEngineNow, hostErrorIsMissingPath, hostErrorIsRefusal, hostGlobCutProblem, searchInputProblem, searchScopeOf, type TreeScope } from "./host-search.js";
import { readRegularFile } from "./project-read.js";
import { valueFreeText } from "./credential-redaction.js";
import { productPrintedRedaction } from "./product-redaction.js";

/** The block's own spec: a block written to another is never compared (its derivation may differ). */
/* `place-premises-2`: the window digest also covers the scan's facts on the place and on its rule block (C1),
 * and a place records the effort its seat ran at (C3); a place written to `-1` is read again once. */
export const PLACE_PREMISES_SPEC = "place-premises-2";
export const PLACE_PREMISE_ORDER = ["spec", "rule", "answers", "handed", "model", "effort", "window", "followed", "files", "searches"] as const;
export type PlacePremiseKind = (typeof PLACE_PREMISE_ORDER)[number];
/**
 * Every premise a place's carry compares, in the words the person reads - the one list both the plan's
 * "carried" reason and the report's "carried from an earlier scan, because nothing they rested on has changed (...)"
 * name. Keyed by the kinds `firstChangedPlacePremise` walks, so a premise the comparison gains cannot be missing from
 * what the person is told it compared (the report's own list had kept an earlier five after two changes
 * added the profile and dependency list the seat was handed and the effort level).
 */
export const PLACE_PREMISE_WORDS: Record<PlacePremiseKind, string> = {
  spec: "the review instructions",
  rule: "the rule",
  answers: "your answers",
  handed: "your profile and the list of dependencies the review was given",
  model: "the model",
  effort: "the effort level the review ran at",
  window: "the lines around the match and the scan's facts about them",
  followed: "the lines the data was followed to",
  files: "the files the review opened",
  searches: "the searches the review ran",
};
/** `PLACE_PREMISE_WORDS` in `PLACE_PREMISE_ORDER`, as one list ("a, b, and c"). */
export function placePremisesInWords(): string {
  const words = PLACE_PREMISE_ORDER.map((k) => PLACE_PREMISE_WORDS[k]);
  return `${words.slice(0, -1).join(", ")}, and ${words[words.length - 1]}`;
}

/**
 * Every field of the verdict schema's place block (`$defs.placePremises`), named with
 * the place premise of `PLACE_PREMISE_ORDER` that compares it, or with the reason no premise does. The carry gate fails
 * where the schema's block and this table disagree, so a field the block gains cannot be carried silently.
 */
export const PLACE_FIELDS: Readonly<Record<string, { premise: PlacePremiseKind; not?: undefined } | { premise?: undefined; not: string }>> = {
  spec: { premise: "spec" },
  key: { not: "the place's identity (rule, file, folded text, occurrence): how the earlier row is found, so never compared" },
  rule_id: { premise: "rule" },
  file: { not: "part of the place's key, which finds the earlier row; recorded for a reader" },
  occurrence: { not: "part of the place's key, which finds the earlier row; recorded for a reader" },
  reading_spec: { premise: "spec" },
  model: { premise: "model" },
  effort: { premise: "effort" },
  window: { premise: "window" },
  window_start: { not: "where the window began, read to re-base a carried row's lines and never compared, so a place that only moved is the same place" },
  followed: { premise: "followed" },
  files: { premise: "files" },
  searches: { premise: "searches" },
  row: { not: "the earlier answer on the place: what is carried, not what it rests on" },
  complete: { not: "the row's own state, not a premise: a row that is not complete is read again (premises-incomplete)" },
  incomplete: { not: "the reasons a row is not complete, read only to say why it is read again" },
};
/** The place premises no field of the place's block holds - each is read from the verdict's own `rests_on`. */
export const PLACE_PREMISES_FROM_BLOCK: Readonly<Partial<Record<PlacePremiseKind, string>>> = {
  answers: "the rule's settled answers, read from the verdict's own rests_on block (answers), not from the place's",
  handed: "the profile and dependency inventory, read from the verdict's own rests_on block (handed), not from the place's",
};

/** What the reading spec digests (premise 1). */
export const READING_SPEC_AGENT = join("agents", "legal-adjudicator.md");
export const READING_SPEC_SCHEMAS: readonly string[] = ["reader-reply.schema.json", "adjudicator-reply.schema.json"];
/**
 * The program files that write what a place seat reads: the payload (`context.js`, `place-facts.js`, `data-summary.js`)
 * and, since verification A's VA-6, the seat's brief and its reading copy of the payload (`launch-plan.js`
 * `briefText`, `seatReadOf`), so a change to either re-reads every place rather than carrying it.
 */
export const READING_SPEC_PROGRAM: readonly string[] = ["context.js", "place-facts.js", "data-summary.js", "launch-plan.js"];

const sha256Hex = (s: string | Buffer): string => createHash("sha256").update(s).digest("hex");
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The row a place seat wrote, as a carry needs it (the fields of design 1.5, with the read basis). */
export interface PlaceRowSnapshot {
  line: number;
  quote: string;
  decision: string;
  data: string[];
  why: string;
  read_basis: import("./reading.js").ReadBasis;
  item?: string;
  beyond?: { file: string; line: number; quote: string };
  line_declared?: number;
  /** The gate's kind on a `construct_but_gated` row (reading.ts `PLACE_GATE_KINDS`), and its words on `other`. */
  gate?: import("./reading.js").PlaceGateKind;
  gate_words?: string;
}

/** One place's premises, written on its row at capture and gathered into the verdict's `rests_on.places` at assembly. */
export interface PlacePremises {
  spec: string;
  /** The identity (content): sha256 over the rule id, the file, the folded matched text and its occurrence. */
  key: string;
  rule_id: string;
  file: string;
  occurrence: number;
  /** Premise 1: the reading spec digest; "" where it could not be taken (and then `complete` is false). */
  reading_spec: string;
  /** Premise 4: the model the seat read on; null where the launch named none. */
  model: string | null;
  /** The effort levels the seat's own transcript records; null or absent where none could be read. */
  effort?: string[] | null;
  /** Premise 5: the digest of the place's text as the program wrote it, and the scan's facts handed on it. */
  window: string;
  /** Where the window began (a fact place: its matched line), to re-base a carried row's lines. */
  window_start: number;
  /** Premise 6: reserved; empty while the data-flow map is on hold. */
  followed: { file: string; line: number; sha256: string }[];
  /** Premise 7. */
  files: RestsOnFile[];
  /** Premise 8. */
  searches: RestsOnSearch[];
  row: PlaceRowSnapshot;
  complete: boolean;
  incomplete?: string[];
}

/* --------------------------------------------------------------------------------------------- *
 * Premise 1: the reading spec.
 * --------------------------------------------------------------------------------------------- */

export interface ReadingSpecArgs {
  /** Not digested (the header says why); accepted so an older caller still compiles. */
  bundleVersion?: string;
  /** The plugin's folder (default `pluginRoot()`), whose agent text is digested. */
  pluginDir?: string;
  /** The compiled program's folder (default: beside this module). */
  programDir?: string;
  /**
   * The verdict-rules version to digest under (default `VERDICT_RULES_VERSION`),
   * and the declared links to follow (default `VERDICT_RULES_JUDGES_AS`): a gate plants a place read under an earlier
   * version, or compares without a declaration. The program itself passes neither.
   */
  verdictRules?: string;
  declared?: Readonly<Record<string, VerdictRulesLink>>;
  /**
   * The build digest digested under the program's
   * own version (default `VERDICT_RULES_BUILD_DIGEST`; null digests as a build from before it was recorded): a gate plants
   * a place read by another build. The program itself passes none.
   */
  build?: string | null;
}

/**
 * The reading spec as a run digests it. `digest` is the spec under the program's own verdict-rules version, the one a
 * place row records; `alike` is the same spec under each earlier version the
 * program's is declared to judge as (`instructions.ts` `verdictRulesJudgedAs`, the one derivation), so a row read under
 * one of them carries as if read under today's. A row records `digest` only, never an `alike` digest: what wrote a
 * row stays what ran (`instructions.ts` `VERDICT_RULES_JUDGES_AS` says why).
 */
export interface ReadingSpecDigest {
  digest: string;
  problem?: string;
  alike?: { verdict_rules: string; digest: string }[];
}

/** The reading spec digest, or "" with the reason where the agent text or a schema cannot be read. */
export function readingSpecDigest(args: ReadingSpecArgs): ReadingSpecDigest {
  const version = args.verdictRules ?? VERDICT_RULES_VERSION;
  const parts: [string, string][] = [];
  const problems: string[] = [];
  const take = (label: string, path: string, absentWord: string | null): void => {
    try {
      parts.push([label, sha256Hex(readRegularFile(path))]);
    } catch (e) {
      if (absentWord !== null && (e as NodeJS.ErrnoException).code === "ENOENT") parts.push([label, absentWord]);
      else problems.push(`${label} (${path}) cannot be read: ${(e as Error).message}`);
    }
  };
  let plugin: string;
  try {
    plugin = args.pluginDir ?? pluginRoot();
  } catch (e) {
    return { digest: "", problem: `the reading spec's folders cannot be found: ${(e as Error).message}` };
  }
  const program = args.programDir ?? dirname(fileURLToPath(import.meta.url));
  take("agent", join(plugin, READING_SPEC_AGENT), null);
  take("skill", join(plugin, INSTRUCTIONS_SKILL), null);
  // The reply schemas as this program carries them: the digest of a schema's text is its file's digest.
  for (const s of READING_SPEC_SCHEMAS) parts.push([`schema ${s}`, sha256Hex(Buffer.from(schemaText(s), "utf8"))]);
  for (const p of READING_SPEC_PROGRAM) take(`program ${p}`, join(program, p), "absent");
  if (problems.length > 0) return { digest: "", problem: problems.join("; ") };
  // The version stands first, as it always has, so the digest under the program's own version is the one rows recorded. Under the program's own version the build that
  // read is digested too, so a row read by another build of it (every one but today's was never released) is read again;
  // the digests under the earlier versions a link reaches stay as those rows recorded them.
  const build = version === VERDICT_RULES_VERSION ? (args.build === undefined ? VERDICT_RULES_BUILD_DIGEST : args.build) : null;
  const under = (v: string): string =>
    sha256Hex(canonicalJson([["verdict_rules", v], ...(v === version && build !== null ? ([["verdict_rules_build", build]] as [string, string][]) : []), ...parts]));
  const alike = verdictRulesJudgedAs(version, args.declared ?? VERDICT_RULES_JUDGES_AS).slice(1).map((v) => ({ verdict_rules: v, digest: under(v) }));
  return { digest: under(version), ...(alike.length > 0 ? { alike } : {}) };
}

/**
 * Whether a place row's recorded reading spec is today's or one of its declared
 * equivalents: the comparison of premise 1, used by `firstChangedPlacePremise` and nowhere else.
 */
export function readingSpecHolds(recorded: string, now: ReadingSpecDigest): boolean {
  return recorded === now.digest || (now.alike ?? []).some((a) => a.digest === recorded);
}

/**
 * For a carried place's sentence: "" where the row was read under today's spec, and
 * otherwise the words that its review instructions hold by a declared equivalence of the program's verdict rules.
 */
export function specAlikeWords(recorded: string, now: ReadingSpecDigest | undefined): string {
  if (!now || recorded === now.digest) return "";
  const hit = (now.alike ?? []).find((a) => a.digest === recorded);
  const words = hit ? verdictRulesAlikeWords(hit.verdict_rules) : null;
  return words ? `, the review instructions with the program's verdict rules ${words}` : "";
}

/* --------------------------------------------------------------------------------------------- *
 * Identity, and premise 5 from a payload.
 * --------------------------------------------------------------------------------------------- */

/**
 * A file's lines value-free and folded, once per lines array: a place key and a window digest are written in the evidence log, and a digest of a line holding a
 * guessable credential could be reversed by hashing candidates. A line with nothing to redact folds as before.
 */
const FREE_FOLDED = new WeakMap<string[], string[]>();
function freeFolded(lines: string[]): string[] {
  let out = FREE_FOLDED.get(lines);
  if (!out) {
    const pr = productPrintedRedaction();
    out = lines.map((l) => foldText(valueFreeText(pr, l)));
    FREE_FOLDED.set(lines, out);
  }
  return out;
}

/** A place's content identity, over its value-free line; null where its line cannot be read. */
export function placeKeyOf(ruleId: string, file: string, line: number, lines: string[] | null): { key: string; occurrence: number } | null {
  if (!lines || !Number.isInteger(line) || line < 1 || line > lines.length) return null;
  const free = freeFolded(lines);
  const folded = free[line - 1]!;
  let occurrence = 0;
  for (let i = 0; i < line; i++) if (free[i] === folded) occurrence += 1;
  return { key: sha256Hex(canonicalJson([ruleId, file, folded, occurrence])), occurrence };
}

/** A place as one payload wrote it: its window digest and where the window began. */
export interface PlaceWindow {
  window: string;
  window_start: number;
  given: "window" | "fact";
}

/** `file\0line`: how a payload's place is matched to a candidate's location. */
export const placeAt = (file: string, line: number): string => `${file}\u0000${line}`;

/** Every readable place of a parsed payload, by finding id and then by `placeAt(file, start_line)`. */
export function placeWindowsOfPayload(parsed: unknown, ships?: ReadonlyMap<string, string>): Map<string, Map<string, PlaceWindow>> {
  const out = new Map<string, Map<string, PlaceWindow>>();
  if (!isObj(parsed)) return out;
  const excerpts = new Map<string, { file: string; start: number; lines: string[] }>();
  for (const e of Array.isArray(parsed.excerpts) ? parsed.excerpts : []) {
    if (!isObj(e) || typeof e.id !== "string" || typeof e.file !== "string") continue;
    const start = Number(e.start_line);
    if (!Number.isInteger(start)) continue;
    excerpts.set(e.id, { file: e.file, start, lines: typeof e.text === "string" ? e.text.split("\n") : [] });
  }
  /* The scan's facts on each rule block (`depends_on_applicability`), by rule id, digested into every
   * place of the rule beside the place's own (`corroborated_in_project` and the rest of `LOCATION_FACT_FIELDS`). */
  const ruleFacts = new Map<string, Record<string, unknown> | null>();
  for (const r of Array.isArray(parsed.rules) ? parsed.rules : []) {
    if (isObj(r) && typeof r.rule_id === "string") ruleFacts.set(r.rule_id, factsOfRecord(r, CANDIDATE_FACT_FIELDS));
  }
  const whole = (id: unknown): [string, string] | null => {
    const ex = typeof id === "string" ? excerpts.get(id) : undefined;
    return ex ? [ex.file, ex.lines.join("\n")] : null;
  };
  for (const c of Array.isArray(parsed.candidates) ? parsed.candidates : []) {
    if (!isObj(c) || typeof c.finding_id !== "string" || !Array.isArray(c.locations)) continue;
    const byAt = out.get(c.finding_id) ?? new Map<string, PlaceWindow>();
    const candidateFacts = factsOfRecord(c, CANDIDATE_FACT_FIELDS) ?? (typeof c.rule_id === "string" ? ruleFacts.get(c.rule_id) ?? null : null);
    for (const l of c.locations) {
      if (!isObj(l) || typeof l.file !== "string") continue;
      const matched = Number(l.start_line);
      if (!Number.isInteger(matched)) continue;
      // The ships premise of the place's file, as the seat's brief handed it; absent, the digest is as before.
      const premise = ships?.get(l.file);
      const facts = { place: factsOfRecord(l, LOCATION_FACT_FIELDS), candidate: candidateFacts, ...(premise === undefined ? {} : { ships: premise }) };
      if (l.given === "fact" && isObj(l.fact)) {
        // The fact without its absolute line numbers: a fact that only moved is the same fact.
        const fact = Object.fromEntries(Object.entries(l.fact).filter(([k]) => !/^(line|start_line|end_line|lines)$/.test(k)));
        byAt.set(placeAt(l.file, matched), { given: "fact", window_start: matched, window: sha256Hex(canonicalJson({ given: "fact", file: l.file, fact, facts })) });
        continue;
      }
      if (l.given !== "window" || !isObj(l.context)) continue;
      const ctx = l.context;
      const ex = typeof ctx.window === "string" ? excerpts.get(ctx.window) : undefined;
      const wl = Array.isArray(ctx.window_lines) ? ctx.window_lines.map(Number) : [];
      if (!ex || wl.length !== 2 || !wl.every(Number.isInteger)) continue;
      const [a, b] = wl as [number, number];
      const text = ex.lines.slice(Math.max(0, a - ex.start), Math.max(0, b - ex.start + 1));
      if (text.length !== b - a + 1) continue;
      const window = sha256Hex(
        canonicalJson({
          given: "window",
          file: l.file,
          at: matched - a,
          window: ((pr) => text.map((x) => (typeof x === "string" ? valueFreeText(pr, x) : x)))(productPrintedRedaction()),
          imports: whole(ctx.imports),
          encloses: (Array.isArray(ctx.encloses) ? ctx.encloses : []).map(whole),
          facts,
        }),
      );
      byAt.set(placeAt(l.file, matched), { given: "window", window_start: a, window });
    }
    out.set(c.finding_id, byAt);
  }
  return out;
}

/* --------------------------------------------------------------------------------------------- *
 * Premises 7 and 8: what the seat opened and searched, from its own transcript.
 * --------------------------------------------------------------------------------------------- */

function realOf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/**
 * Whether the replay reproduces what the host returned for the search, or why not. The replay
 * is a premise only where it does: every difference between the host's search and the replay - `rg`'s multiline dotall,
 * a `glob` or `type` filter it does not read, the regular-expression dialect, a file the scanner does not read, a file
 * `rg` skips - then reads the place again instead of carrying it on a search the replay does not stand for (the host's
 * own engine, tried first where it is found, is held to the same comparison: `searchPremiseOf`). Compared where the host's
 * result can be read as matched lines (`content` with line numbers) or as files (the other modes, and Glob); where only
 * part of it was returned (a limit or an offset), every part must be in the replay. Returns null where it is reproduced.
 */
export function hostDifference(s: SeatSearch, replayAt: readonly string[], tree: TreeReader, scope: TreeScope): string | null {
  const host = s.host;
  if (!host) return "the host's result for this search is not in the seat's transcript, so the replay cannot be shown to reproduce it.";
  if (host.error !== undefined) return `the host returned an error for it (${JSON.stringify(host.error.slice(0, 80))}), not a result the replay can reproduce.`;
  const root = realOf(tree.root);
  const relOf = (p: string): string => {
    const t = p.trim();
    if (!isAbsolute(t)) return t.replace(/^\.\//, "");
    const rel = relativePath(root, realOf(t));
    return rel;
  };
  const oneFile = scope !== "" && tree.lines(scope) !== null;
  let hostSet: string[];
  let replaySet: string[];
  let what: string;
  const fileOfAt = (a: string) => a.replace(/:\d+$/, "");
  if (host.content !== undefined && host.numbered !== false) {
    what = "matched line(s)";
    hostSet = [];
    for (const line of host.content.split("\n")) {
      if (oneFile) {
        const m = /^(\d+):/.exec(line);
        if (m) hostSet.push(`${scope}:${m[1]}`);
      } else {
        const m = /^(.+?):(\d+):/.exec(line);
        if (m) hostSet.push(`${relOf(m[1]!)}:${m[2]}`);
      }
    }
    replaySet = [...replayAt];
  } else {
    what = "file(s)";
    if (host.content !== undefined || host.counts !== undefined) {
      const text = host.content ?? host.counts ?? "";
      hostSet = [];
      for (const line of text.split("\n")) {
        if (line.trim() === "" || line === "--") continue;
        if (oneFile) {
          hostSet.push(scope);
          continue;
        }
        const m = (host.counts !== undefined ? /^(.+):(\d+)$/ : /^(.+?):/).exec(line);
        if (m) hostSet.push(relOf(m[1]!));
      }
    } else hostSet = (host.files ?? []).map(relOf);
    replaySet = s.tool === "glob" ? [...replayAt] : replayAt.map(fileOfAt);
  }
  const h = new Set(hostSet);
  const r = new Set(replaySet);
  const missing = [...h].filter((x) => !r.has(x)).sort();
  const extra = host.partial ? [] : [...r].filter((x) => !h.has(x)).sort();
  if (missing.length === 0 && extra.length === 0) return null;
  const first = missing[0] !== undefined ? `the host returned ${missing[0]}, which the replay does not find` : `the replay finds ${extra[0]}, which the host did not return`;
  return `the replay does not reproduce the host's result (${h.size} ${what} returned, ${r.size} replayed; ${first}), so a place resting on it is read again rather than carried.`;
}

/**
 * A seat's Grep or Glob, replayed over the tree once, as a premise row.
 * The row stands for the host's search only where a replay reproduces what the
 * host returned, over at least the files the host's search could reach, and the replays are tried in this order:
 * 1. the host's own engine (host-search.ts), wherever it is found: every Grep and Glob of a path inside the tree is
 *    replayed by the ripgrep Claude Code ships, as the host ran it, and the row records the engine's path and version
 *    as a premise. A host that refused ripgrep's arguments is reproduced by the engine refusing the same arguments. The
 *    engine's answer is the row: one that differs from the host's result, or a run that fails, leaves it unreplayable.
 * 2. only where no engine is found, today's replay, and only where it searches at least every file the host's search
 *    could have searched (rests-on.ts `fallbackReplay`); a `type`, a glob on a search of one file and a glob shape it
 *    does not read are unreplayable there.
 * A host that refused a path the tree does not hold is reproduced while the path is still missing (`missingPathHash`).
 * A search of a path outside the tree is unreplayable: the host searched files neither replay reads. The path is read
 * by host-search.ts `searchScopeOf`, as every row's scope is: relative or absolute alike, every link in it followed, so
 * a link to a folder outside the tree is outside. A search whose
 * input holds a key or value the replay does not understand, the plugin's own refusals and a host result the
 * transcript does not hold stay unreplayable: the place is read again. A search of the program's own files is
 * recorded and replayed exactly as before (its replay stands for nothing; the payload's text is premise 5): a later run
 * replays it as before where it lies under `.legal`, and by the rule for a row with no input everywhere else
 * (rests-on.ts `inputlessReplay`). A search the transcript gives with no input
 * (none does since the capture kept it) is never replayed by the engine, only as in 2. Nothing thrown while a search is
 * replayed leaves this function: it is the row's reason.
 */
export function searchPremiseOf(s: SeatSearch, tree: TreeReader, own: ReadonlySet<string> = new Set()): RestsOnSearch {
  try {
    return searchPremiseRow(s, tree, own);
  } catch (e) {
    return { for: SEAT_SEARCH_FOR, pattern: s.pattern ?? "", tool: s.tool, ...(s.path ? { paths: s.path } : {}), scope: "", flags: "", hits: 0, unreplayable: `the search could not be replayed (${(e as Error).message}).` };
  }
}

function searchPremiseRow(s: SeatSearch, tree: TreeReader, own: ReadonlySet<string>): RestsOnSearch {
  let flags = s.case_insensitive ? "i" : "";
  const multiline = s.tool === "grep" && s.multiline === true;
  /* The searched path, by the one function every row's scope goes through
   * (host-search.ts `searchScopeOf`): a relative path and an absolute one alike, every link in it followed as the host's
   * ripgrep follows a link named as its path. A path outside the tree is recorded with no scope and never replayed
   * (below); a path the tree does not hold keeps its own path from the root, for the host's missing-path outcome. */
  const where = searchScopeOf(tree.root, s.path);
  const scope: string = where.at === "outside" ? "" : where.scope;
  // VA-7: a multiline Grep keeps its flag (`U`, rests-on.ts `MULTILINE_FLAG`) and is replayed over each file's whole text.
  if (multiline) flags = `${flags}${MULTILINE_FLAG}`;
  /* A search of the program's own files (the seat's payload, its reading copy, anything under `.legal/`)
   * is not compared: the scanner reads none of them, and the payload's text is a premise of its own (premise 5). Tested
   * on the canonical scope alone; one of them outside the tree is outside, as any path there is. */
  const ownSearch = where.at === "tree" && (own.has(where.real) || isOwnRecordsScope(where.scope));
  const input = ownSearch ? undefined : s.input;
  const glob = s.tool === "grep" && typeof input?.glob === "string" && input.glob.trim() !== "" ? input.glob : undefined;
  const type = s.tool === "grep" && typeof input?.type === "string" && input.type !== "" ? input.type : undefined;
  const base: RestsOnSearch = {
    for: SEAT_SEARCH_FOR,
    pattern: s.pattern,
    tool: s.tool,
    ...(s.path ? { paths: s.path } : {}),
    scope,
    flags,
    ...(glob !== undefined ? { glob } : {}),
    ...(type !== undefined ? { type } : {}),
    ...(input !== undefined ? { input } : {}),
    hits: 0,
  };
  if (!s.pattern) return { ...base, hits: 0, unreplayable: "the search names no pattern, so there is nothing to replay." };
  if (ownSearch && where.at === "tree") {
    const replayed = replaySearch(tree, s.pattern, where.scope, flags, s.tool, { at: true });
    if ("unreplayable" in replayed) return { ...base, hits: 0, unreplayable: replayed.unreplayable };
    return { ...base, hits: replayed.hits, hit_hash: replayed.hit_hash, ...(replayed.dialect ? { dialect: replayed.dialect } : {}) };
  }
  if (input !== undefined) {
    const problem = searchInputProblem(s.tool, input);
    if (problem) return { ...base, hits: 0, unreplayable: problem };
  }
  // Outside the tree, the host searched files neither replay reads: today's
  // replay over the tree is a smaller file set, and its glob, anchored where the host searched, cannot be read at the
  // tree's root. Read again.
  if (where.at === "outside") return { ...base, hits: 0, unreplayable: `the seat searched ${s.path}, ${where.why ? `which is not a place of this tree (${where.why})` : "outside the tree"}, so the host searched files that neither the host's engine nor today's replay reads here.` };
  // The host refused a path the tree does not hold, before ripgrep ran: the same outcome while the path is still missing.
  if (where.at === "missing") {
    if (input !== undefined && s.host?.error !== undefined && hostErrorIsMissingPath(s.host.error)) return { ...base, hits: 0, hit_hash: missingPathHash(where.scope) };
    return { ...base, hits: 0, unreplayable: `the seat searched ${s.path}, which this tree does not hold, and ${input === undefined ? "the search records no input of the host call" : "the host's result for it is not its refusal of a missing path"}, so no replay can be shown to reproduce it.` };
  }
  const host = s.host;
  if (!host) return { ...base, hits: 0, unreplayable: "the host's result for this search is not in the seat's transcript, so no replay can be shown to reproduce it." };
  if (host.error !== undefined && (s.tool !== "grep" || !hostErrorIsRefusal(host.error))) {
    return { ...base, hits: 0, unreplayable: `the host returned an error for it (${JSON.stringify(host.error.slice(0, 80))}), not a result a replay can reproduce.` };
  }
  if (/[^iU]/.test(flags)) return { ...base, hits: 0, unreplayable: `the search's flags ${JSON.stringify(flags)} are not ones the host's search takes.` };
  if (s.tool === "glob") {
    // The host's pattern cut, on the path the seat wrote as the host holds
    // it (no link followed), never on its real path.
    const problem = hostGlobCutProblem(s.pattern, tree.root, s.path, process.env);
    if (problem) return { ...base, hits: 0, unreplayable: problem };
  }
  // A search with no input names no host call the engine could repeat
  // exactly (rests-on.ts `replayRecorded`): never the engine for it.
  const engine = input !== undefined ? hostEngineNow(process.env, tree.root, CAPTURE_CLOCK) : { missing: "the search records no input of the host call, so no call of the host's engine can be shown to be the search the host ran" };
  if (!("missing" in engine)) {
    // 1. The host's own engine, over the host's file set.
    const ran = engineReplay(tree, engineRequestOf({ tool: s.tool, pattern: s.pattern, scope: where.scope, flags, glob, type }), engine, { at: true }, CAPTURE_CLOCK);
    if ("unreplayable" in ran) return { ...base, hits: 0, unreplayable: ran.unreplayable };
    let differs: string | null;
    if (host.error !== undefined) differs = ran.refused !== undefined ? null : "it searched where the host returned an error.";
    else if (ran.refused !== undefined) differs = `it refused the arguments (${JSON.stringify((ran.refused.split("\n")[0] ?? "").slice(0, 80))}) where the host returned a result.`;
    else differs = hostDifference(s, ran.at ?? [], tree, where.scope);
    if (differs) return { ...base, hits: 0, unreplayable: `the host's own search engine (${engine.path}) does not reproduce it: ${differs}` };
    return { ...base, engine, hits: ran.hits, hit_hash: ran.hit_hash };
  }
  // 2. No engine: today's replay, only where it searches at least what the host could.
  if (host.error !== undefined) return { ...base, hits: 0, unreplayable: `the host's ripgrep refused the search (${JSON.stringify(host.error.slice(0, 80))}), and only the host's own engine reproduces a refusal: ${engine.missing}.` };
  const replayed = fallbackReplay(tree, { pattern: s.pattern, scope: where.scope, flags, tool: s.tool, ...(glob !== undefined ? { glob } : {}), ...(type !== undefined ? { type } : {}), written: s.path }, { at: true, env: process.env });
  if ("unreplayable" in replayed) return { ...base, hits: 0, unreplayable: `${replayed.unreplayable} The host's own search engine cannot be run to replay it instead: ${engine.missing}.` };
  const differs = hostDifference(s, replayed.at ?? [], tree, where.scope);
  if (differs) return { ...base, hits: 0, unreplayable: differs };
  return { ...base, hits: replayed.hits, hit_hash: replayed.hit_hash, ...(replayed.dialect ? { dialect: replayed.dialect } : {}) };
}

/**
 * WHAT A SEAT'S OWN TRANSCRIPT COULD NOT GIVE WHEN THE SEAT ENDED, one sentence per premise. Every premise
 * taken from that transcript - what the seat opened and searched (`seat-opened.ts` `seatSightOf`, whose `basis.problem`
 * says why nothing was taken) and the effort it ran at (`seat-effort.ts` `transcriptEffort`, null where the transcript
 * cannot be read) - goes through here, and the reason is written beside the premise wherever it is recorded: a place
 * row's and an answer seat's `incomplete`, a verdict record's `seat_untaken` (the block's `untaken`). Before, an
 * unreadable transcript gave no files, no searches and no reason, so the sight read as complete while resting on
 * nothing, and only the effort, read from the same file, kept the verdict from being carried. A premise not given here
 * (`undefined`) is not this caller's; an effort read as `[]` (the transcript read, no level on it) is taken - the effort
 * comparison gives that verdict again on its own.
 *
 * The reason only stops the carry. It is never a coverage gap for the run that wrote it: the seat's rows are held to its
 * transcript by the capture (`opened`) and by the assembly's transcript check, not by these premises.
 */
export function seatUntakenOf(a: { sight?: SeatSight; effort?: string[] | null }): string[] {
  const out: string[] = [];
  if (a.sight?.basis.problem) out.push(`what the seat opened and searched cannot be taken from its own transcript: ${a.sight.basis.problem}.`);
  if (a.effort === null) out.push("the effort level the seat ran at cannot be taken from its own transcript: no transcript of the seat's own could be read for it.");
  return out;
}

/**
 * Premises 7 and 8 of every place of one seat: the files of the tree the seat Read outside its payload (the payload, its
 * reading copy and anything under `.legal/` are the program's own), and every search it ran. `untaken` is
 * why the seat's own transcript gave none of them, where it could not be read (`seatUntakenOf`): a caller records it
 * beside them, so an empty sight is never read as "the seat opened nothing".
 */
export function seatPremisesOf(sight: SeatSight | undefined, tree: TreeReader, own: string[]): { files: RestsOnFile[]; searches: RestsOnSearch[]; incomplete: string[]; untaken: string[] } {
  const incomplete: string[] = [];
  if (!sight) return { files: [], searches: [], incomplete: ["nothing shows what the seat opened or searched"], untaken: [] };
  const untaken = seatUntakenOf({ sight });
  const root = realOf(tree.root);
  const skip = new Set(own.map(realOf));
  const paths = new Set<string>();
  for (const abs of sight.ranges.keys()) {
    if (skip.has(abs)) continue;
    const rel = relativePath(root, abs);
    if (rel === "" || rel.startsWith("../") || rel === ".." || isAbsolute(rel)) continue;
    const posix = rel;
    if (posix === ".legal" || posix.startsWith(".legal/")) continue;
    paths.add(posix);
  }
  const files: RestsOnFile[] = [...paths].sort().map((path) => {
    const digest = tree.sha256(path);
    return digest ? { path, sha256: digest } : { path, missing: true as const };
  });
  const missing = files.filter((f) => f.missing);
  if (missing.length > 0) incomplete.push(`${missing.length} file(s) the seat Read cannot be digested: ${missing.map((f) => f.path).join(", ")}.`);
  const searches = (sight.searches ?? []).map((s) => searchPremiseOf(s, tree, skip));
  const unreplayable = searches.filter((s) => s.unreplayable);
  // The first search's own reason, so the row (and a verdict's `untaken`) says why, not only how many.
  if (unreplayable.length > 0) incomplete.push(`${unreplayable.length} search(es) the seat ran cannot be replayed (the first: ${unreplayable[0]!.unreplayable}).`);
  return { files, searches, incomplete, untaken };
}

/* --------------------------------------------------------------------------------------------- *
 * The comparison.
 * --------------------------------------------------------------------------------------------- */

/** What this run would read a place on: its window, the model, the spec, and the verdict-level premises. */
export interface PlaceNow {
  key: string;
  window: PlaceWindow | null;
  model: string;
  /** The adjudicator's effort pin today; null, no place is carried. Not given, compared as null. */
  effort?: string | null;
  readingSpec: ReadingSpecDigest;
  /** The rule's clause digest today, and the one the earlier verdict rests on. */
  ruleHash: { today: string; was: string };
  /**
   * The `handed` digest today and as the earlier verdict's block recorded it, null where there is none. Absent
   * on both sides is not a change (as for a verdict); absent on one side is. Not given at all, it is compared as null.
   */
  handed?: { today: string | null; was: string | null };
  /** The rule's answers today and as the earlier verdict recorded them, each a sorted list of `question\0digest`. */
  answers: { today: string[]; was: string[] };
  /** The bundle version today and as the earlier verdict recorded it: recorded, NOT compared. Optional. */
  bundle?: { today: string; was: string };
}

/** The first premise of an earlier place that this run does not reproduce, or null where every one is reproduced. */
export function firstChangedPlacePremise(prev: PlacePremises, now: PlaceNow, tree: TreeReader): { premise: PlacePremiseKind; because: string } | null {
  for (const premise of PLACE_PREMISE_ORDER) {
    if (premise === "spec") {
      if (prev.spec !== PLACE_PREMISES_SPEC) return { premise, because: `the place's premises were written to ${prev.spec} and this run derives ${PLACE_PREMISES_SPEC}.` };
      if (now.readingSpec.problem || !now.readingSpec.digest) return { premise, because: `this run cannot digest its reading spec (${now.readingSpec.problem ?? "no digest"}), so no place is carried.` };
      // Past a product update, the releases' marks decide
      // (`instructions.ts` `judgedAsThroughMarks`, the one derivation a whole verdict's instructions use too).
      const marked = readingSpecHolds(prev.reading_spec, now.readingSpec)
        ? null
        : judgedAsThroughMarks(prev.rule_id, (s) => s.reading_spec === now.readingSpec.digest, (s) => s.reading_spec === prev.reading_spec);
      if (marked !== null && marked.carried === false) return { premise, because: marked.because };
      if (marked === null && !readingSpecHolds(prev.reading_spec, now.readingSpec)) {
        return { premise, because: `the reading spec (the agent text, the legal-scan skill, the program's verdict rules, the reply schemas or the program that writes the payload) is now ${now.readingSpec.digest.slice(0, 12)} and the place was read under ${String(prev.reading_spec).slice(0, 12)}.` };
      }
      continue;
    }
    if (premise === "rule") {
      if (now.ruleHash.today !== now.ruleHash.was) return { premise, because: `rule ${prev.rule_id}'s clause digest is now ${now.ruleHash.today.slice(0, 12)} and the place was read under ${now.ruleHash.was.slice(0, 12)}.` };
      continue;
    }
    if (premise === "answers") {
      if (canonicalJson(now.answers.today) !== canonicalJson(now.answers.was)) return { premise, because: `the per-rule answers the declaration settles for ${prev.rule_id} are not the answers the place was read under.` };
      continue;
    }
    if (premise === "handed") {
      const today = now.handed?.today ?? null;
      const was = now.handed?.was ?? null;
      if (today !== was) {
        return {
          premise,
          because:
            was === null
              ? "the verdict that holds the place records nothing of the profile and the dependency inventory its seats were handed, so what the place rested on beside its payload cannot be re-derived."
              : today === null
                ? "the place rests on the profile and the dependency inventory its seat was handed, and this comparison was given neither."
                : "the profile or the dependency inventory every seat is handed is not the one the place was read with.",
        };
      }
      continue;
    }
    if (premise === "model") {
      if (prev.model !== now.model) return { premise, because: `the place would be read on ${now.model} and was read on ${prev.model ?? "no named model"}.` };
      continue;
    }
    if (premise === "effort") {
      const pin = now.effort ?? null;
      const was = Array.isArray(prev.effort) ? prev.effort : [];
      if (!pin) return { premise, because: "this run cannot read the effort the adjudicator's agent file pins, so no place is carried." };
      if (was.length !== 1 || was[0] !== pin) return { premise, because: `the place's seat ran at ${was.length > 0 ? was.join(", ") : "no recorded effort level"} and a seat runs at ${pin} now (the adjudicator's pin).` };
      continue;
    }
    if (premise === "window") {
      if (!now.window) return { premise, because: "this run's payload writes no window for the place (it is unreadable or not in a payload)." };
      if (now.window.window !== prev.window) return { premise, because: "the text the program wrote for the place (its window, import region or enclosing lines, or its fact), or a fact the scan handed on it or on its rule (such as `corroborated_in_project`), is not what it was read on." };
      continue;
    }
    if (premise === "followed") {
      if (prev.followed.length > 0) return { premise, because: `the place rests on ${prev.followed.length} followed line(s) and this run follows none (the data-flow map is on hold).` };
      continue;
    }
    if (premise === "files") {
      const changed = seatBasisChange(prev.files, [], tree, { seat: "the seat", outside: " outside the place's window" });
      if (changed) return { premise, because: changed.because };
      continue;
    }
    const changed = seatBasisChange([], prev.searches, tree, { seat: "the seat", outside: "" });
    if (changed) return { premise, because: changed.because };
  }
  return null;
}

/**
 * THE ONE COMPARISON OF A SEAT'S OWN FILES AND SEARCHES (premises 7 and 8 of a place; the answer seat's
 * too). Every file the seat Read, by digest; every search it ran, replayed over the tree - its hits, and (C2-4) the lines
 * on which ripgrep and the replay read its pattern differently. The first that no longer holds, or null.
 */
export function seatBasisChange(
  files: readonly RestsOnFile[],
  searches: readonly RestsOnSearch[],
  tree: TreeReader,
  words: { seat: string; outside: string },
): { premise: "files" | "searches"; because: string } | null {
  for (const f of files) {
    if (f.missing || !f.sha256) return { premise: "files", because: `${f.path}, which ${words.seat} Read, was recorded without a digest.` };
    const today = tree.sha256(f.path);
    if (today === null) return { premise: "files", because: `${f.path}, which ${words.seat} Read, is not in this tree.` };
    if (today !== f.sha256) return { premise: "files", because: `${f.path}, which ${words.seat} Read${words.outside}, has changed.` };
  }
  const own = words.seat === "the seat" ? "the seat's" : `${words.seat}'s`;
  for (const s of searches) {
    if (s.unreplayable || !s.hit_hash) return { premise: "searches", because: `a search ${words.seat} ran cannot be replayed: ${s.unreplayable ?? "no hit-set digest"}.` };
    // Replayed as recorded: its glob, its engine, the input it was taken from (rests-on.ts `replayRecorded`).
    const replayed = replayRecorded(tree, s);
    if ("unreplayable" in replayed) return { premise: "searches", because: `a search ${words.seat} ran no longer replays: ${replayed.unreplayable}` };
    if (replayed.hit_hash !== s.hit_hash) return { premise: "searches", because: `${own} search ${JSON.stringify(s.pattern.slice(0, 60))} now returns ${replayed.hits} line(s) where it returned ${s.hits}, or different lines.` };
    const moved = dialectMoved(s, replayed);
    if (moved) return { premise: "searches", because: moved };
  }
  return null;
}

/* --------------------------------------------------------------------------------------------- *
 * VA-5: the answer seat's own premises.
 * --------------------------------------------------------------------------------------------- */

/** The answer premises' own spec: a block written to another is never compared. */
export const ANSWER_PREMISES_SPEC = "answer-premises-1";

/**
 * What the answer of an answer seat (a place-plan candidate answered after its place seats) rests on beyond its places
 * (design section 4: "The answer is carried only when every place carried, the fold digest is equal, its searches replay
 * to the same hits and its files (A2's included) are unchanged"). Written by the capture (`answer-premises.ts`).
 */
export interface AnswerPremises {
  spec: string;
  /** sha256 of the fold as the program lays it out over the per-place table, without what names the run (`foldDigestOf`). */
  fold: string;
  /** Every file of the tree the answer seat Read outside the program's own files (the fold, `.legal/`), by sha256. */
  files: RestsOnFile[];
  /** Every search the answer seat ran, from its own transcript, replayed and compared with the host's result at capture. */
  searches: RestsOnSearch[];
  /** The model the answer seat ran on (its launch entry's); absent on premises written before, given again. */
  model?: string;
  complete: boolean;
  incomplete?: string[];
}

/**
 * The first of an earlier answer's own premises this run does not reproduce, or null. `foldNow` is the digest of the fold
 * this run would hand a new answer seat over its carried places (null where it cannot say). Absent premises - an answer
 * captured before they were written - are a premise not reproduced: the candidate goes to a fresh answer seat.
 */
export function firstChangedAnswerPremise(
  prev: AnswerPremises | undefined,
  foldNow: string | null,
  tree: TreeReader,
  /** The model an answer seat of this candidate would run on now (`carry-forward.ts` `modelNowOf`). */
  modelNow: string,
): { premise: "answer" | "model" | "fold" | "files" | "searches"; because: string } | null {
  if (!prev || typeof prev !== "object") return { premise: "answer", because: "the earlier answer records no premises of its own (the fold it was given, the files and searches of its seat), so it is given again over the carried places." };
  if (prev.spec !== ANSWER_PREMISES_SPEC) return { premise: "answer", because: `the earlier answer's premises were written to ${String(prev.spec)} and this run derives ${ANSWER_PREMISES_SPEC}.` };
  if (prev.complete !== true) return { premise: "answer", because: `the earlier answer's premises are incomplete: ${(prev.incomplete ?? ["no reason recorded"]).join(" ")}` };
  if (typeof prev.model !== "string" || !prev.model) return { premise: "model", because: `the earlier answer records no model its seat ran on, so it is given again on ${modelNow} over the carried places.` };
  if (prev.model !== modelNow) return { premise: "model", because: `the earlier answer was given on ${prev.model} and an answer seat would run on ${modelNow} now, so it is given again over the carried places.` };
  if (foldNow === null) return { premise: "fold", because: "this run cannot make the fold of the carried places, so the fold the earlier answer was given cannot be compared." };
  if (foldNow !== prev.fold) return { premise: "fold", because: "the fold this run would hand the answer seat over the carried places is not the fold the earlier answer was given." };
  return seatBasisChange(prev.files ?? [], prev.searches ?? [], tree, { seat: "the answer seat", outside: "" });
}

/** A carried row, re-based to where the place's window stands now. */
export function rebasedRow(prev: PlacePremises, now: PlaceWindow): PlaceRowSnapshot {
  const shift = now.window_start - prev.window_start;
  const row = prev.row;
  return {
    ...row,
    line: row.line + shift,
    ...(row.line_declared !== undefined ? { line_declared: row.line_declared + shift } : {}),
    // A `beyond` in the place's own file moves with it only where that file is unchanged, which premise 7 already
    // requires (the seat Read it): an unchanged file has not moved, so its line stands.
  };
}

/** The place premises an earlier verdict's block records, where it records them in this unit's shape. */
export function placePremisesOfBlock(block: unknown): PlacePremises[] {
  if (!isObj(block) || !Array.isArray(block.places)) return [];
  return block.places.filter((p): p is PlacePremises => isObj(p) && typeof p.key === "string" && typeof p.spec === "string" && isObj(p.row));
}

/**
 * What this run's payloads wrote for every place (premise 5), by finding id: each payload the scan listed, read back only
 * while it has the digest the scan recorded (a payload edited after the scan is not this run's), merged across the
 * payloads a candidate's places are split over.
 */
export function placesNowFromPayloads(findingsDir: string, rows: readonly { path?: unknown; sha256?: unknown }[], ships?: ReadonlyMap<string, string>): Map<string, Map<string, PlaceWindow>> {
  const out = new Map<string, Map<string, PlaceWindow>>();
  for (const row of rows) {
    if (typeof row.path !== "string") continue;
    let bytes: Buffer;
    try {
      bytes = readRegularFile(join(findingsDir, row.path));
    } catch {
      continue;
    }
    if (typeof row.sha256 === "string" && sha256Hex(bytes) !== row.sha256) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      continue;
    }
    for (const [id, places] of placeWindowsOfPayload(parsed, ships)) {
      const into = out.get(id) ?? new Map<string, PlaceWindow>();
      for (const [at, w] of places) into.set(at, w);
      out.set(id, into);
    }
  }
  return out;
}

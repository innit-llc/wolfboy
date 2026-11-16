/**
 * THE TEAM'S SAVED ANSWERS, CONFIRMED BY EACH PERSON IN EACH FOLDER (design rf11 3.3).
 *
 * The program writes `.legal/profile.json` and its record, and the pair is committed so that teammates need not answer
 * again. Nothing ties the pair to who answered, so a pair a clone, a fork or a merged pull request brought would settle a
 * region's rules unseen. Here a pair settles nothing in a folder on a computer until the person running the scan there
 * has confirmed it once: answers the program wrote in this folder are confirmed by being written (`how`
 * "answered-here"); any other pair is put to the person as one question, in place of the region questions, through the
 * relay's program confirmation (hook-question.ts `writeConfirmationQuestion`; `how` "confirmed").
 *
 * The confirmation is the person's own record in their state folder (state-record.ts, kind `TEAM_ANSWERS_RECORD`),
 * keyed by the scanned folder's real path, never inside the scanned folder or any git work tree: it keeps the sha256 of
 * each of the two files, the answers themselves and the commit facts shown, and only the latest pair this folder
 * confirmed, so changed bytes, or an older pair restored, are asked about again. A record that is refused is read as
 * none and is not written, and the person is told why in one sentence.
 *
 * This module is not a verdict-rules source: declaration.ts (one) never imports it, so the state folder's reading and
 * writing stay out of the capture's closure.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { gitRunnerOrWhy } from "./child-program.js";
import { answerLabelOf, DECLARATION_RECORD_FILE, isUnansweredValue, localDay, REGION_NAMES, type DeclarationSource, type ReadDeclaration } from "./declaration.js";
import { readProgramFile } from "./program-file.js";
import { readStateRecord, TEAM_ANSWERS_RECORD, writeStateRecord } from "./state-record.js";

/** The confirmation's purpose (hook-question.ts `ConfirmationSpec.purpose`). */
export const TEAM_ANSWERS_PURPOSE = "team-answers";
/** The question's header, as AskUserQuestion shows it (at most 12 characters). */
export const TEAM_ANSWERS_HEADER = "Team answers";
export const USE_THEM = "Use them in this folder on this computer";
export const NOT_NOW = "Not now: every region's rules run this time";
export const TEAM_VALUE_BY_LABEL: Readonly<Record<string, string>> = { [USE_THEM]: "use", [NOT_NOW]: "not-now" };

/** Who last changed the record file, as git records it; information, never proof of who answered. */
export interface CommitFacts {
  id: string;
  author: string;
  date: string;
  default_branch: string | null;
  on_default_branch: boolean | null;
}
/** What git said about the record file: its last commit, "not in git" (changed in the working tree, or never committed), or why git was not read. */
export type CommitReading = { facts: CommitFacts } | { facts: null; why: null } | { facts: null; why: string };

export interface TeamAnswersRecord {
  kind: "team-answers-confirmation";
  version: 1;
  declaration_dir: string;
  profile_sha256: string;
  record_sha256: string;
  /** The answers as the profile file held them when they were confirmed. */
  answers: unknown;
  /** The record's own `written_at`: the day the answers were saved. */
  saved_at: string;
  commit: CommitFacts | null;
  confirmed_at: string;
  how: "answered-here" | "confirmed";
}

/** Where this folder stands with the pair: confirmed here (the record), or not, with the last confirmation if any and why a record could not be read. */
export interface TeamState {
  confirmed: boolean;
  record: TeamAnswersRecord | null;
  earlier: TeamAnswersRecord | null;
  profileSha256: string;
  recordSha256: string;
  /** What the confirmation is bound to (hook-question.ts `ConfirmationSpec.about`). */
  about: string;
  /** One sentence where the state record could not be read (a refused place, no state folder); null otherwise. */
  unreadable: string | null;
}

const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The sha256 of each of the two files, read through the one reader of program-written files; null where either cannot be read. */
function pairDigests(read: ReadDeclaration): { profile: string; record: string } | null {
  const p = readProgramFile("the declaration", read.profilePath);
  const r = readProgramFile("the declaration's record", join(read.dir, DECLARATION_RECORD_FILE));
  return p.ok && r.ok ? { profile: sha256(p.value), record: sha256(r.value) } : null;
}

function parseRecord(text: string): TeamAnswersRecord | null {
  try {
    const d: unknown = JSON.parse(text);
    if (!isObj(d) || d.kind !== "team-answers-confirmation" || d.version !== 1) return null;
    if (typeof d.profile_sha256 !== "string" || typeof d.record_sha256 !== "string" || typeof d.confirmed_at !== "string") return null;
    if (d.how !== "answered-here" && d.how !== "confirmed") return null;
    return d as unknown as TeamAnswersRecord;
  } catch {
    return null;
  }
}

/** Whether the pair in `read` (status ok) is confirmed in the scanned folder `target` on this computer. Null where the pair cannot be read. */
export function teamAnswersState(stateDir: string | null, target: string, read: ReadDeclaration): TeamState | null {
  if (read.status !== "ok") return null;
  const d = pairDigests(read);
  if (d === null) return null;
  const about = `${d.profile}:${d.record}`;
  const got = readStateRecord(stateDir, target, TEAM_ANSWERS_RECORD);
  const base = { profileSha256: d.profile, recordSha256: d.record, about };
  if (!got.read) return { ...base, confirmed: false, record: null, earlier: null, unreadable: got.absent ? null : got.why };
  const rec = parseRecord(got.text);
  if (rec !== null && rec.profile_sha256 === d.profile && rec.record_sha256 === d.record) return { ...base, confirmed: true, record: rec, earlier: null, unreadable: null };
  return { ...base, confirmed: false, record: null, earlier: rec, unreadable: null };
}

/**
 * Keep the pair in `read` as confirmed in `target` on this computer: `how` "answered-here" where the program has just
 * written it from the person's answers, "confirmed" where the person chose USE_THEM. Returns the record (kept or not)
 * and, where it could not be kept, the one sentence that says why.
 */
export function confirmTeamAnswers(stateDir: string | null, target: string, read: ReadDeclaration, how: TeamAnswersRecord["how"], commit: CommitFacts | null, at: Date): { record: TeamAnswersRecord | null; refused: string | null } {
  const d = read.status === "ok" ? pairDigests(read) : null;
  if (d === null || read.record === null) return { record: null, refused: `The answers in ${read.profilePath} could not be read back, so they are not kept as confirmed in this folder on this computer; the next scan here asks about them again.` };
  const record: TeamAnswersRecord = {
    kind: "team-answers-confirmation",
    version: 1,
    declaration_dir: read.dir,
    profile_sha256: d.profile,
    record_sha256: d.record,
    answers: read.content,
    saved_at: read.record.written_at,
    commit,
    confirmed_at: at.toISOString(),
    how,
  };
  const w = writeStateRecord(stateDir, target, TEAM_ANSWERS_RECORD, `${JSON.stringify(record, null, 2)}\n`);
  if (w.written) return { record, refused: null };
  return { record, refused: `The answers are used this run, but the confirmation could not be kept outside the project (${w.why}), so the next scan in this folder asks about them again.` };
}

/** Who last changed the record file in `dir`, through the reviewed git runner (child-program.ts); nothing the folder holds chooses the program. */
export function commitFactsOf(dir: string, project: string): CommitReading {
  const g = gitRunnerOrWhy(dir, project);
  if (!("run" in g)) return { facts: null, why: g.why };
  const status = g.run(["status", "--porcelain", "--", DECLARATION_RECORD_FILE]);
  if (status.status !== 0) return { facts: null, why: null };
  if (String(status.stdout ?? "").trim() !== "") return { facts: null, why: null };
  const log = g.run(["log", "-1", "--format=%H%x00%an%x00%aI", "--", DECLARATION_RECORD_FILE]);
  const parts = String(log.stdout ?? "").trim().split(String.fromCharCode(0));
  if (log.status !== 0 || parts.length !== 3 || !/^[0-9a-f]{40,64}$/.test(parts[0]!)) return { facts: null, why: null };
  const [id, author, date] = parts as [string, string, string];
  const head = g.run(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
  const ref = String(head.stdout ?? "").trim();
  if (head.status !== 0 || !ref.startsWith("refs/remotes/origin/")) return { facts: { id, author, date, default_branch: null, on_default_branch: null } };
  const anc = g.run(["merge-base", "--is-ancestor", id, ref]);
  const on = anc.status === 0 ? true : anc.status === 1 ? false : null;
  return { facts: { id, author, date, default_branch: ref.slice("refs/remotes/origin/".length), on_default_branch: on } };
}

function readPath(obj: unknown, path: string): unknown {
  let at: unknown = obj;
  for (const k of path.split(".")) {
    if (!isObj(at)) return undefined;
    at = at[k];
  }
  return at;
}

/** A region's short name: "EU", "Japan", "US". */
const regionName = (code: string): string => (REGION_NAMES[code] ?? code).replace(/^the /, "");

/**
 * The saved answers grouped by kind on at most three lines (the regions; who the product is offered to and the service;
 * the features), every answer shown: the whole profile is handed to every seat, so hiding some is not safe. Answers of
 * No in a group are named together at its end. Each entry is `name: answer`; `entries` keys them for the change line.
 */
export function groupedAnswers(source: DeclarationSource, content: unknown, jurisdictions: string[]): { lines: string[]; entries: Map<string, string> } {
  const entries = new Map<string, string>();
  const groups: { name: string; items: string[]; no: string[] }[] = [
    { name: "Regions", items: [], no: [] },
    { name: "Offered", items: [], no: [] },
    { name: "Features", items: [], no: [] },
  ];
  const yes = readPath(content, "distribution_regions");
  const no = readPath(content, "regions_not_offered");
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((c): c is string => typeof c === "string" && c !== "unknown") : []);
  for (const code of [...new Set([...jurisdictions, ...list(yes), ...list(no)])].sort()) {
    const answer = list(yes).includes(code) ? "Yes" : list(no).includes(code) ? "No" : "not answered";
    entries.set(regionName(code), answer);
    groups[0]!.items.push(`${regionName(code)}: ${answer}`);
  }
  for (const { field, x } of source.fields) {
    if (x.per === "jurisdiction") continue;
    const value = readPath(content, field);
    if (value === undefined || value === null || isUnansweredValue(x, value)) continue;
    const label = answerLabelOf(x, value) ?? JSON.stringify(value);
    const header = x.per === "part" ? (x.parts?.[0]?.header ?? x.header) : x.header;
    entries.set(header, label);
    const g = field.startsWith("audience.") || field.startsWith("scope.") ? groups[1]! : groups[2]!;
    if (label === "No") g.no.push(header);
    else g.items.push(`${header}: ${label}`);
  }
  const lines = groups
    .map((g) => ({ name: g.name, parts: [...g.items, ...(g.no.length > 0 ? [`No: ${g.no.join(", ")}`] : [])] }))
    .filter((g) => g.parts.length > 0)
    .flatMap((g) => groupLines(g.name, g.parts));
  return { lines, entries };
}

/** The width the question's grouped answer lines keep to (mock M17: within 80 columns, as a terminal shows them). */
export const ANSWER_LINES_WIDTH = 80;

/**
 * (mock M17) One group's answers in aligned lines of at most 80 columns: the
 * group's name, then its parts joined by " · ", continued under the first part where the next one would pass 80; a part
 * longer than a line (the "No:" list) breaks after a comma. Never cut: every answer is shown.
 */
export function groupLines(name: string, parts: readonly string[]): string[] {
  const lead = `  ${name.padEnd(9)} `;
  const indent = " ".repeat(lead.length);
  const room = ANSWER_LINES_WIDTH - lead.length;
  const pieces = parts.flatMap((p) => {
    if (p.length <= room) return [p];
    const out: string[] = [];
    let cur = "";
    for (const w of p.split(/(?<=,) /)) {
      if (cur !== "" && cur.length + 1 + w.length > room) {
        out.push(cur);
        cur = w;
      } else cur = cur === "" ? w : `${cur} ${w}`;
    }
    if (cur !== "") out.push(cur);
    return out;
  });
  const lines: string[] = [];
  let cur = "";
  for (const piece of pieces) {
    if (cur !== "" && cur.length + 3 + piece.length > room) {
      lines.push(cur);
      cur = piece;
    } else cur = cur === "" ? piece : `${cur} · ${piece}`;
  }
  if (cur !== "") lines.push(cur);
  return lines.map((l, i) => `${i === 0 ? lead : indent}${l}`);
}

/** The sentence on who last changed the record file. */
function commitSentence(c: CommitReading): string {
  if (c.facts !== null) {
    const branch = c.facts.on_default_branch === true ? `, on ${c.facts.default_branch}` : c.facts.on_default_branch === false ? `, not on ${c.facts.default_branch}` : "";
    return `The answer file was last changed in commit ${c.facts.id.slice(0, 7)} by ${c.facts.author}, ${localDay(c.facts.date)}${branch} (the author as git records it: information, not proof of who answered).`;
  }
  if (c.why === null) return "The answer file is not in git: it was changed in the working tree after its last commit, or never committed.";
  return `Who last changed the answer file could not be read from git (${c.why}).`;
}

/**
 * The one question of the round (design rf11 3.3, mock M17): what is saved, when, who last changed it as git records it,
 * every saved answer grouped, what changed since this folder last confirmed a pair, and the two options.
 */
export function teamAnswersQuestion(source: DeclarationSource, read: ReadDeclaration, jurisdictions: string[], commit: CommitReading, earlier: TeamAnswersRecord | null): { question: { question: string; header: string; multiSelect: false; options: { label: string; description: string }[] }; valueByLabel: Record<string, string> } {
  const now = groupedAnswers(source, read.content, jurisdictions);
  // (mock M17) The question says who asks it: the program, not the review.
  const lines = ["Answers about the product are saved in this repository  (asked by WolfBoy)", `Saved ${localDay(read.record?.written_at ?? "")}. ${commitSentence(commit)}`];
  if (earlier !== null) {
    const before = groupedAnswers(source, earlier.answers, jurisdictions).entries;
    const changed = [...new Set([...before.keys(), ...now.entries.keys()])]
      .filter((k) => before.get(k) !== now.entries.get(k))
      .map((k) => `${k}: ${before.get(k) ?? "not answered"} → ${now.entries.get(k) ?? "not answered"}`);
    lines.push(`Changed since you confirmed them in this folder on ${localDay(earlier.confirmed_at)}${changed.length > 0 ? `: ${changed.join("; ")}` : ""}.`);
  }
  lines.push(...now.lines, "Use them in this folder on this computer? They decide which rules run, and the review is told them.");
  return {
    question: {
      question: lines.join("\n"),
      header: TEAM_ANSWERS_HEADER,
      multiSelect: false,
      options: [
        { label: USE_THEM, description: "They are kept as confirmed for this folder on this computer, and this scan runs again with them." },
        { label: NOT_NOW, description: "No saved answer about the product is used this time; \"review my answers\" (--review-declaration) lets you answer them yourself." },
      ],
    },
    valueByLabel: { ...TEAM_VALUE_BY_LABEL },
  };
}

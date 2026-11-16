/**
 * WHAT CHANGED SINCE THE EARLIER REVIEW, AS THE REPORT SAYS IT (design rf13
 * 3.2.1; mocks M8, M9, M9b): the since rows, the "New or higher" notes and `changes.md`, read from the evidence log's
 * `comparison` block (comparison.ts, rf11-a4-2026-11-06.md section 1.1) and from nothing else, so no view counts a
 * change apart from the log. Pure: the caller gives each finding's F-number, title and link.
 */
import { inertJoin, inSpan, markdownCode, markdownText, md, ours, programText, type Inert, type Spanned } from "./printed-output.js";
import { group } from "./progress.js";
import { LATER_CAUSE_WORDS } from "./launch-plan.js";

/** A count as `group` writes it, its digits and separators: program text. */
const groupOf = (n: number): Inert => programText(group(n));

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : undefined);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export interface Standing {
  disposition: string;
  level: string | null;
  places: number;
}
export interface ChangeRow {
  id: string;
  rule: string;
  change: string;
  kind: string;
  /** The earlier finding it was compared with (its id may differ: `from_finding_id`). */
  earlier: (Standing & { id: string }) | null;
  now: Standing | null;
  carried: boolean;
  /** Why it was judged again, in `changes.md`'s words; null where it was carried or the plan gave no reason. */
  cause: string | null;
  /** The premise that changed (rests-on.ts), where the plan named one. */
  premise: string | null;
}
export interface GoneRow {
  id: string;
  rule: string;
  file: string | null;
  line: number | null;
  disposition: string;
  level: string | null;
  cause: string;
  stillGone: boolean;
  sameFile: string[] | null;
}
export interface LaterComparison {
  /** The earlier review's completion time (ISO), where its log gave one. */
  earlierAt: string | null;
  digest: string;
  digestWhy: string;
  compared: boolean;
  why: string;
  changes: ChangeRow[];
  gone: GoneRow[];
  notCompared: number;
  /**
   * When the review each finding's verdict stands on was made, from this log's
   * basis rows (`reviewed_at`): a date, null where the log it was carried from does not say, absent with no verdict.
   */
  reviewed: ReadonlyMap<string, string | null>;
}

const standing = (v: unknown): Standing | null => {
  const o = obj(v);
  if (!o) return null;
  const places = Number(o.places);
  return { disposition: str(o.disposition), level: str(o.level) || null, places: Number.isFinite(places) ? places : 0 };
};

/** The log's `comparison` block as this module reads it; null where the run compared with no earlier review. */
export function laterComparisonOf(block: unknown): LaterComparison | null {
  const b = obj(block);
  const e = obj(b?.earlier);
  if (!b || !e) return null;
  const changes: ChangeRow[] = arr(b.changes).flatMap((x) => {
    const o = obj(x);
    if (!o || !str(o.finding_id)) return [];
    const was = obj(o.earlier);
    const ws = standing(was);
    const cause = obj(o.cause);
    const premise = str(cause?.premise) || null;
    const reason = str(cause?.reason);
    const words = cause ? (LATER_CAUSE_WORDS[premise ?? ""] ?? LATER_CAUSE_WORDS[reason] ?? null) : null;
    return [{ id: str(o.finding_id), rule: str(o.rule_id), change: str(o.change), kind: str(o.kind), earlier: ws ? { ...ws, id: str(was?.finding_id) || str(o.finding_id) } : null, now: standing(o.now), carried: o.carried === true, cause: words, premise }];
  });
  const gone: GoneRow[] = arr(b.gone).flatMap((x) => {
    const o = obj(x);
    if (!o || !str(o.finding_id)) return [];
    const p = obj(o.place);
    const line = Number(p?.line);
    return [{ id: str(o.finding_id), rule: str(o.rule_id), file: str(p?.file) || null, line: p && Number.isInteger(line) ? line : null, disposition: str(o.earlier_disposition), level: str(o.earlier_level) || null, cause: str(o.cause) || "unknown", stillGone: o.still_gone === true, sameFile: Array.isArray(o.same_file) ? o.same_file.map(str).filter(Boolean) : null }];
  });
  const nc = Number(b.not_compared);
  const reviewed = new Map<string, string | null>();
  for (const x of arr(b.basis)) {
    const o = obj(x);
    if (o && str(o.finding_id) && "reviewed_at" in o) reviewed.set(str(o.finding_id), /^\d{4}-\d{2}-\d{2}/.test(str(o.reviewed_at)) ? str(o.reviewed_at) : null);
  }
  return { earlierAt: str(e.completed_at) || null, digest: str(e.digest), digestWhy: str(e.digest_why), compared: e.compared === true, why: str(e.why), changes, gone, notCompared: Number.isInteger(nc) && nc > 0 ? nc : 0, reviewed };
}

/** The three since rows' contents (design 3.2.1's table): every change of list, level or places is in `up` or `down`. */
export interface Since {
  /** New or higher: to fix or to clarify now, and new there, moved in, higher, or with a place it did not have. */
  up: ChangeRow[];
  /** Lower or gone, in the order the row names its kinds: gone, now ruled out, lower or moved. */
  down: ChangeRow[];
  gone: number;
  ruledOut: number;
  lower: number;
  unchanged: number;
  /** The first of `down` that was high: the row names it (R1). */
  highDown: ChangeRow | null;
  /** New places a review ruled out: no since row, listed in `changes.md` only. */
  newRuledOut: ChangeRow[];
}
export function sinceOf(c: LaterComparison): Since {
  const of = (k: string): ChangeRow[] => c.changes.filter((r) => r.change === k);
  const gone = of("gone");
  const ruledOut = of("now_ruled_out");
  const lower = of("lower_or_moved");
  const down = [...gone, ...ruledOut, ...lower];
  return { up: of("new_or_higher"), down, gone: gone.length, ruledOut: ruledOut.length, lower: lower.length, unchanged: of("unchanged").length, highDown: down.find((r) => r.earlier?.level === "high") ?? null, newRuledOut: of("new_ruled_out") };
}

/** A disposition's list, as the report names it (comparison.ts: the lists). */
export function listWord(disposition: string): Inert {
  if (disposition === "to_fix") return ours("to fix");
  if (disposition === "counsel") return ours("to clarify");
  if (disposition === "question" || disposition === "check_answer") return ours("to answer");
  if (disposition === "settled_by_answer") return ours("out of scope");
  if (disposition === "not_applicable") return ours("ruled out");
  return ours("not counted");
}

/** The short note a new-or-higher finding takes on the end screen and in "Now to fix" ("new", "now high, was medium"). */
/* `where`: the F-number words of a gone finding
 * whose same-file link names this new one (the same rule in the same file), so an edited line reads "new, where F1 was (now
 * gone)", not only "new". Never "fixed". */
export function upNote(r: ChangeRow, where: Inert | null = null): Inert {
  const clarify = r.now?.disposition === "counsel" ? ours("to clarify, ") : ours("");
  if (r.kind === "level_rose" && r.earlier) return md`${clarify}now ${markdownText(r.now?.level ?? "unrated")}, was ${markdownText(r.earlier.level ?? "unrated")}`;
  if (r.kind === "moved_in" && r.earlier) return md`${clarify}was ${listWord(r.earlier.disposition)}`;
  if (r.kind === "place_gained") return md`${clarify}a new place`;
  return where ? md`${clarify}new, where ${where} was (now gone)` : md`${clarify}new`;
}

/** The gone row whose same-file link names this finding of this scan, if any. */
export function goneWhereOf(c: LaterComparison, id: string): GoneRow | null {
  return c.gone.find((g) => !g.stillGone && (g.sameFile ?? []).includes(id)) ?? null;
}

/** The lower-or-gone row's kinds, named ("2 gone, maybe not fixed · 1 now ruled out"). */
export function downParts(s: Since): Inert {
  return inertJoin(
    [
    s.gone > 0 ? md`${groupOf(s.gone)} gone, maybe not fixed` : ours(""),
    s.ruledOut > 0 ? md`${groupOf(s.ruledOut)} now ruled out` : ours(""),
    s.lower > 0 ? md`${groupOf(s.lower)} lower or moved` : ours(""),
  ]
    .filter(Boolean), ours(" · "));
}
/** How the high finding among the lower or gone left ("gone", "now ruled out", "lower or moved"). */
export const downWord = (r: ChangeRow): Inert => (r.change === "gone" ? ours("gone") : r.change === "now_ruled_out" ? ours("now ruled out") : ours("lower or moved"));

/** What the caller gives for a finding: its F-number words and title, and its link in the report folder. */
export interface LaterLookup {
  /** A finding listed in this report (to fix, to clarify, to answer, not counted): its F-number ("F28"), title and file link. */
  listed(id: string): { f: Inert; title: Inert; link: Inert } | null;
  /** A finding not listed now (gone, ruled out): its F-number from the folder's number list where it had one, and its rule's title. */
  earlier(id: string, rule: string): { f: Inert | null; title: Inert };
  /** Words for a finding of this scan by id, as a same-file line or the new ruled-out list names it (its list and link). */
  describe(id: string): Inert;
  /** The area a rule is listed under ("To fix by area"'s names). */
  area(rule: string): Inert;
  /** A date as the report says it ("4 Nov"); "" where the text holds no date. */
  day(iso: string): Inert;
  /** A listed finding's own place (`file:line`), to tell apart the findings of one group; "" where it has none. */
  place(id: string): Spanned | null;
  /**
   * The person's standing decision about a finding (design 3.4): its state at
   * this assembly ("gone" where its finding was not raised in this run) and when it was made; null where there is none.
   */
  decision?(id: string): { state: "applied" | "new_look" | "expired" | "gone"; at: string } | null;
}

/** A decision as `changes.md` marks its finding (design 3.4's table). */
function decisionMark(look: LaterLookup, id: string): Inert {
  const d = look.decision?.(id) ?? null;
  if (d === null) return ours("");
  const day = look.day(d.at);
  if (d.state === "applied") return md` · decided by you on ${day}`;
  if (d.state === "gone") return md` · you had decided it on ${day}`;
  return md` · your decision of ${day} needs a new look${d.state === "expired" ? ours(": its date passed") : ours("")}`;
}

/**
 * The unchanged findings to fix or to clarify
 * whose decision came back (it needs a new look, or its date passed): back in "New or higher" (design 3.4) and counted
 * there, not under Unchanged, in every view (the since rows, the end screen, changes.md). Read at each use.
 */
export function backRowsOf(c: LaterComparison, look: Pick<LaterLookup, "decision">): ChangeRow[] {
  return c.changes.filter((r) => {
    if (r.change !== "unchanged" || (r.now?.disposition !== "to_fix" && r.now?.disposition !== "counsel")) return false;
    const d = look.decision?.(r.id) ?? null;
    return d !== null && d.state !== "applied" && d.state !== "gone";
  });
}

/** `changes.md`'s words for the new-or-higher entries decided by you. */
export const CHANGES_WORDS = {
  decidedHeading: ours("Decided by you"),
  decidedLead: (earlier: Inert): Inert =>
    md`New or higher since ${earlier}, and decided by you: counted in the since row, left out of the lists you work from.`,
  upAllDecided: (n: number): Inert => md`None besides the ${n === 1 ? ours("one") : groupOf(n)} decided by you, listed under [Decided by you](#decided-by-you).`,
  // Words
  upAlsoDecided: (n: number): Inert => md`And the ${n === 1 ? ours("one") : groupOf(n)} decided by you, listed under [Decided by you](#decided-by-you).`,
} as const;

const GONE_CAUSE_TEXT: Readonly<Record<string, string>> = {
  file_removed: "the file is gone",
  rule_removed: "the rule is no longer in WolfBoy's rules",
  rule_changed: "WolfBoy's rule changed",
  line_changed: "the line changed",
  unknown: "this scan raised nothing there",
};
const levelOf = (s: Standing | null): Inert => (s?.level ? md`, ${markdownText(s.level)}` : ours(""));
const name = (f: Inert | null, title: Inert): Inert => md`${f ? md`${f} · ` : ours("")}${title}`;

/**
 * (design 3.2.1, the Unchanged row; mock M9b, its last line): the unchanged
 * findings by area (`look.area`), each carried one with the date of the review it stands on (`c.reviewed`, from the log
 * it was carried from) or, where that log does not record it, saying so; each judged again with its cause. A finding not
 * listed in this report (ruled out) is named by its F-number where it had one and its rule's title, with its list.
 */
function unchangedByArea(c: LaterComparison, same: ChangeRow[], look: LaterLookup): Inert[] {
  const rows = same.map((r) => {
    const l = look.listed(r.id);
    const e = l ? null : look.earlier(r.earlier?.id ?? r.id, r.rule);
    const head = l ? md`${name(l.f, l.title)} · ${l.link}` : md`${name(e?.f ?? null, e?.title ?? markdownText(r.rule))} · ${listWord(r.now?.disposition ?? ours(""))}`;
    const at = c.reviewed.get(r.id) ?? null;
    const day = at === null ? ours("") : look.day(at);
    const tail = !r.carried
      ? md`judged again because ${markdownText(r.cause ?? "the earlier review did not record enough to carry them")}`
      : day
        ? md`carried, reviewed on ${day}`
        : ours("carried; when it was reviewed is not known: the log it was carried from does not record it");
    const f = Number((l?.f ?? e?.f ?? ours("")).replace(/^F/, ""));
    return { area: look.area(r.rule), f: Number.isInteger(f) && f > 0 ? f : Number.MAX_SAFE_INTEGER, id: r.id, head, tail };
  }).map((x, _, all) => {
    // Findings of one group share its F-number, title and link: each then names its own place.
    const at = all.some((y) => y !== x && y.head === x.head) ? look.place(x.id) : null;
    return { ...x, line: md`- ${x.head}${at ? md` · ${inSpan(at)}` : ours("")} · ${x.tail}${decisionMark(look, x.id)}` };
  });
  const areas = [...new Set(rows.map((x) => x.area))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const out: Inert[] = [];
  for (const area of areas) {
    out.push(ours(""), md`### ${area}`);
    const its = rows.filter((x) => x.area === area).sort((a, b) => a.f - b.f || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const x of its) out.push(x.line);
  }
  return out;
}

/** [design 3.2.1; mock M9b]: `changes.md`, every change by its row, with its cause; "Gone" is never "fixed". */
export function changesLines(c: LaterComparison, s: Since, look: LaterLookup, head: { earlier: Inert; project: Inert; today: Inert }): Inert[] {
  const out: Inert[] = [md`# What changed since ${head.earlier} · ${head.project}${head.today ? md` · ${head.today}` : ours("")}`, ours("")];
  if (!c.compared) {
    out.push(md`Not compared with ${head.earlier}: ${markdownText(c.why || "its log holds no comparison basis")}. Nothing is counted as new, lower or gone. [report](report.md)`, ours(""));
    return out;
  }
  out.push(md`Each place compared with ${head.earlier}. [report](report.md)`, ours(""));
  const entry = (r: ChangeRow, note: Inert): Inert => {
    const l = look.listed(r.id);
    const t = l ? md`${name(l.f, l.title)} · ${l.link}` : name(look.earlier(r.earlier?.id ?? r.id, r.rule).f, look.earlier(r.earlier?.id ?? r.id, r.rule).title);
    return md`- ${t} · ${note}${decisionMark(look, r.id)}`;
  };
  const why = (r: ChangeRow): Inert => {
    if (r.carried || r.cause === null) return ours("");
    const codeSame = r.premise !== null && r.premise !== "candidate" && r.premise !== "places-changed";
    return md` · judged again because ${markdownText(r.cause)}${codeSame ? ours("; the code at its place did not change") : ours("")}`;
  };
  const upEntry = (r: ChangeRow): Inert => {
    const now = md`${listWord(r.now?.disposition ?? ours(""))}${r.kind === "level_rose" ? md`, now ${markdownText(r.now?.level ?? "unrated")}, was ${markdownText(r.earlier?.level ?? "unrated")}` : levelOf(r.now)}`;
    const what = r.kind === "moved_in" ? md`was ${listWord(r.earlier?.disposition ?? ours(""))}` : r.kind === "level_rose" ? ours("") : ours("a new place");
    return entry(r, md`${now}${what ? md` · ${what}` : ours("")}${why(r)}`);
  };
  /* (design 3.4: a decided finding leaves "New or higher") An entry whose
   * decision applies is listed under "Decided by you" instead, right after; one whose decision needs a new look stays,
   * marked. The two sections' entries together are the since row's count, which no decision changes. */
  const upDecided = s.up.filter((r) => look.decision?.(r.id)?.state === "applied");
  const upOpen = s.up.filter((r) => !upDecided.includes(r));
  const back = backRowsOf(c, look);
  out.push(ours("## New or higher"));
  if (upOpen.length === 0 && back.length === 0) out.push(upDecided.length === 0 ? ours("None.") : CHANGES_WORDS.upAllDecided(upDecided.length));
  for (const r of upOpen) out.push(upEntry(r));
  // Words
  for (const r of back) out.push(entry(r, md`${listWord(r.now?.disposition ?? ours(""))}${levelOf(r.now)} · unchanged since ${head.earlier}`));
  if (upDecided.length > 0 && upOpen.length + back.length > 0) out.push(ours(""), CHANGES_WORDS.upAlsoDecided(upDecided.length));
  if (upDecided.length > 0) {
    out.push(ours(""), md`## ${CHANGES_WORDS.decidedHeading}`, CHANGES_WORDS.decidedLead(head.earlier));
    for (const r of upDecided) out.push(upEntry(r));
  }
  out.push(ours(""), ours("## Lower or moved"));
  const lower = s.down.filter((r) => r.change === "lower_or_moved");
  if (lower.length === 0) out.push(ours("None."));
  for (const r of lower) {
    const was = md`was ${listWord(r.earlier?.disposition ?? ours(""))}${levelOf(r.earlier)}`;
    const now = r.kind === "level_fell" ? md`now ${markdownText(r.now?.level ?? "unrated")}` : r.kind === "place_lost" ? md`${groupOf(r.now?.places ?? 0)} of ${groupOf(r.earlier?.places ?? 0)} places` : md`now ${listWord(r.now?.disposition ?? ours(""))}`;
    out.push(entry(r, md`${was} · ${now}${why(r)}`));
  }
  out.push(ours(""), ours("## Now ruled out"));
  const ruled = s.down.filter((r) => r.change === "now_ruled_out");
  if (ruled.length === 0) out.push(ours("None."));
  for (const r of ruled) out.push(entry(r, md`was ${listWord(r.earlier?.disposition ?? ours(""))}${levelOf(r.earlier)}${why(r)} · ${look.describe(r.id)}`));
  out.push(ours(""), ours("## Gone"));
  const goneNow = c.gone.filter((g) => !g.stillGone);
  if (goneNow.length === 0) out.push(ours("None."));
  else {
    out.push(ours("Gone is not the same as fixed: this scan raised nothing for the rule there, which is not a check that the duty is met."));
    // Said once: why an edit or a move shows as gone and new.
    out.push(ours("A finding is known by its rule, its file and the text of its line: an edited line, or a file moved or renamed, shows here as gone, and its new place as new; a decision you made about the old one does not follow it."));
  }
  for (const g of goneNow) {
    const e = look.earlier(g.id, g.rule);
    // The earlier log's place is the project's text (FR5 item 2).
    const at = g.file ? md`, at ${markdownCode(`${g.file}${g.line !== null ? md`:${g.line}` : ours("")}`)}` : ours("");
    const same =
      g.sameFile === null
        ? ours("")
        : g.sameFile.length === 0
          ? ours("; no new finding of this rule in that file")
          : md`. In the same file this scan raised ${groupOf(g.sameFile.length)} new ${g.sameFile.length === 1 ? ours("finding") : ours("findings")} of this rule: ${inertJoin(g.sameFile.map((id) => look.describe(id)), ours("; "))}`;
    out.push(md`- ${name(e.f, e.title)} · was ${listWord(g.disposition)}${g.level ? md`, ${markdownText(g.level)}` : ours("")}${at} · ${programText(GONE_CAUSE_TEXT[g.cause] ?? GONE_CAUSE_TEXT.unknown ?? "")}${decisionMark(look, g.id)}${same}`);
  }
  const still = c.gone.filter((g) => g.stillGone).length;
  if (still > 0) out.push(md`- ${groupOf(still)} more ${still === 1 ? ours("finding is") : ours("findings are")} still gone from earlier reviews (not counted as a change since ${head.earlier}).`);
  out.push(ours(""), ours("## Unchanged"), md`The same list, the same level and the same places as in ${head.earlier}.`);
  const same = c.changes.filter((r) => r.change === "unchanged" && !back.includes(r));
  const carried = same.filter((r) => r.carried);
  const again = same.filter((r) => !r.carried);
  if (carried.length > 0) {
    const days = carried.map((r) => c.reviewed.get(r.id) ?? null);
    const known = days.filter((d): d is string => d !== null && look.day(d) !== "").sort();
    const unknown = days.length - known.length;
    const oldest = known.length > 0 ? md`; the oldest review among them was on ${look.day(known[0] as string)}` : ours("");
    const notSaid = unknown > 0 ? md` For ${groupOf(unknown)} of them the log they were carried from does not record when ${unknown === 1 ? ours("it was") : ours("they were")} reviewed.` : ours("");
    out.push(md`- **${groupOf(carried.length)} carried** from ${head.earlier}, not re-read${oldest}: nothing their reviews read or searched changed. A change in a file a review neither read nor searched is not seen.${notSaid}`);
  }
  if (again.length > 0) {
    const causes = new Map<string, number>();
    for (const r of again) causes.set(r.cause ?? ours("the earlier review did not record enough to carry them"), (causes.get(r.cause ?? ours("the earlier review did not record enough to carry them")) ?? 0) + 1);
    out.push(md`- **${groupOf(again.length)} judged again with the same outcome**: ${inertJoin([...causes].map(([w, n]) => md`${groupOf(n)} because ${markdownText(w)}`), ours("; "))}.`);
  }
  if (same.length === 0) out.push(ours("None."));
  out.push(...unchangedByArea(c, same, look));
  if (s.newRuledOut.length > 0) {
    // Each row is a finding, and several can sit on one place.
    out.push(ours(""), ours("## New ruled-out verdicts"), ours("New findings a review ruled out; nothing you had changed."));
    for (const r of s.newRuledOut) out.push(md`- ${look.describe(r.id)}`);
  }
  if (c.notCompared > 0) out.push(ours(""), md`${groupOf(c.notCompared)} earlier ${c.notCompared === 1 ? ours("verdict was") : ours("verdicts were")} not compared (not chosen for this run, or raised now with no verdict); never counted as gone.`);
  return out;
}

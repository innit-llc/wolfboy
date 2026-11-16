/**
 * The tier of a duty across regimes (H5a stage 1): which penalty tier of its own regime a rule's `legal_basis` cite
 * falls in. The report's "Fix first" order reads only "top" or "not top", so every lower tier counts the same, and an
 * entry that lays down no duty (a definition, a recital, a scope or date article, guidance or a judgment) takes none.
 *
 * The table is authored once in `rules/penalty-tiers/penalty-tiers.yaml`, its quotations checked against the official
 * texts by the quotation receipts beside it, and compiled into the bundle as `penalty-tiers.json`, hashed into
 * `manifest.files` like every other bundle file. This module reads it from the bundle only, never from `rules/`.
 * `tools/build-bundle.mjs` refuses a rule whose cite this module cannot resolve (`penaltyTierCoverage`), so every cite a
 * shipped rule carries resolves.
 *
 * How a cite resolves, in order:
 *   1. an `explicit` entry whose pattern matches the start of the cite decides it;
 *   2. otherwise the regime whose `match` pattern occurs earliest in the cite is the regime, and the provisions are
 *      every reference the cite names from the first one after that name (Art./Article N(..), Annex <roman>, Recital N,
 *      joined by "and", "or", ",", "&", "plus", "read with", bare numbers and ranges; `readProvisions`), less any of
 *      another instrument ("of the ePrivacy Directive") or after another regime's name. Each is resolved on its own and
 *      the heaviest tier decides; `appliesFrom` is read across the duties among them, a penalty paragraph not counting
 *      as one (2026-10-28, after the legal check found two cites whose operative article came after a definition or
 *      recital, and a cite whose later-applying points were read as Art 5(1)). The reader's grammar is fixed, so the
 *      build also refuses a cite whose heading names a reference of its regime the reader did not read
 *      (`unreadReferences`, in `penaltyTierCoverage`): a phrasing it does not know fails loud instead of resolving by
 *      the provisions before it (the re-check of the same day);
 *   3. inside the regime: a recital, a definitions article or a `no_duty` provision gives `no_duty`; a cited penalty
 *      paragraph takes the tier it sets; a provision that carries another's duty (`carried_duties`) takes that duty's
 *      tier, followed to the last link of a chain; a provision a tier line names takes that line's tier (the heaviest, where a cite without a paragraph could
 *      fall under more than one); in a tiered regime any other provision takes its `unlisted` line (the lower tier); in
 *      a regime without tiers every other provision is `top`.
 * A cite nothing resolves gives `top` with `unresolved: true`: the order rounds up where it cannot tell, never down.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "./bundle.js";

export type PenaltyTier = "top" | "not_top" | "no_duty";

export interface TierOfBasis {
  tier: PenaltyTier;
  /** The regime's short name as the report will print it, e.g. "GDPR", "AI Act"; "" where the cite names no regime. */
  regime: string;
  /** e.g. "GDPR Art 83(5)(a)"; for a regime without tiers its penalty article. */
  penaltyCite: string;
  /**
   * False for a regime whose penalty article sets no tiers. On an `unresolved` answer it is the regime's own value
   * where the cite names a regime the table declares, and false where it names none; read `unresolved` first.
   */
  tiered: boolean;
  /**
   * ISO date from which the cited duty applies, where the act stages it later than the table's review date (CRA,
   * AI Act). Absent where the duty applies already. Where the cite names several duty provisions, present only when
   * every one of them applies later, and then the earliest of their dates; a cite in which any named duty applies
   * already carries none, and `appliesLater` says which parts do not. The table is a dated review: a caller printing
   * "applies from {date}; prepare now" also compares the date with the run's own date.
   */
  appliesFrom?: string;
  /**
   * Present only where the cite names duty provisions that do not all apply on one date: each named provision that
   * applies after the review date, with its date (the others apply already). A report states the cite as in force for
   * the rest and as applying later for these, e.g. "Art 5(1)(a) applies; Art 5(1)(ba) applies from 2026-12-02".
   */
  appliesLater?: { provision: string; appliesFrom: string }[];
  /**
   * ISO date from which the penalty provision named in `penaltyCite` applies, where the act stages it later than the
   * table's review date, read from the same `application` lines as `appliesFrom` (CRA Art 64 under Art 71(2), first
   * subparagraph: 11 December 2027, while Art 14 applies from 11 September 2026). Absent where the fine provision
   * applies already or the table gives it no date. A report says "whose fines apply from {date}" only while the scan's
   * own date is before it.
   */
  penaltyAppliesFrom?: string;
  /** The id of the table line the answer came from (the regime id plus the line), for the record and the checker. */
  line: string;
  /** The regime id in the table; "" where none. */
  regimeId: string;
  /**
   * The provision the answer came from, e.g. "83(5)", "Annex I", "Recital 26": where the cite names several, the one
   * whose tier is the heaviest (the first of them on a tie). "" where none was read.
   */
  provision: string;
  /** Every provision the cite's heading names, as read, in the cite's order; [] where none was read. */
  provisions: string[];
  /** True only where no line of the table resolves the cite; the tier is then `top` (round up). */
  unresolved?: true;
  /**
   * What the table's own text says of this answer's penalties, for the words a
   * report prints (the order reads `tier` alone). `basis`: "fine_list" - a fine list, penalty paragraph or annex line of a
   * tiered regime names the provision; "unlisted" - no fine list of a tiered regime names it and it takes the regime's
   * unlisted line; "no_tiers" - the regime's penalty provisions set no tiers by duty. `memberStates`: the quoted
   * provision that leaves the penalties to the Member States, where the table marks one (`member_states` on the unlisted
   * line, `member_states_penalty` on a regime without tiers; the build's guard holds each to its quotation). `quoted`:
   * false only for a regime without tiers whose penalty provisions the table does not quote. Absent on `no_duty` and
   * `unresolved` answers.
   */
  penaltyText?: {
    basis: "fine_list" | "unlisted" | "no_tiers";
    memberStates?: string;
    quoted: boolean;
    /** On `no_tiers`: the penalty routes the table quotes for this provision only (`PenaltyQuote.reaches`). */
    routes?: { cite: string; says: string }[];
  };
}

interface ProvisionLine {
  id: string;
  tier?: "top" | "not_top" | "no_duty";
  penalty_cite?: string;
  provisions?: string[];
  /** The point of a declared closed list this tier line transcribes, e.g. "83(5)(a)". */
  point?: string;
  quote?: string;
  /** On a tiered regime's unlisted line: its quotation leaves the penalties to the Member States (guarded). */
  member_states?: boolean;
}
/** A regime's quoted penalty provision. */
interface PenaltyQuote {
  id: string;
  cite: string;
  quote: string;
  /**
   * On a regime without tiers, a penalty route this quotation adds
   * for only some of the regime's duties (Data Act Art 40(4): Chapters II, III and V): the provisions it reaches (the
   * table's provision forms, ranges allowed), `why` they are those, and `says`, what the quotation lets happen, in the
   * words the report prints after its cite. The guard requires all three together, and only on a regime without tiers.
   * The words name the cite and add `says`, so `says` states only what the quotation says.
   */
  reaches?: string[];
  says?: string;
  why?: string;
}
interface AnnexLine {
  id: string;
  annex: string;
  tier: "top" | "not_top";
  penalty_cite: string;
}
interface ApplicationLine {
  id: string;
  provisions: string[];
  date: string | null;
  cite: string;
}
/** A provision that lays down no duty of its own but carries another provision's (AI Act Art 111(4) carries Art
 * 50(2)): it takes the tier that provision resolves to in the same regime, so the two cannot drift apart. */
interface CarriedDutyLine {
  id: string;
  provisions: string[];
  duty: string;
  quote?: string;
}
/** A penalty paragraph whose points the tier lines transcribe, and the tier every one of those lines carries. */
interface ClosedList {
  id: string;
  paragraph: string;
  opens?: string;
  tier?: "top" | "not_top";
}
export interface PenaltyRegime {
  id: string;
  name: string;
  match: string[];
  tiered: boolean | null;
  coverage?: "definitions_only";
  penalty_cite: string;
  definitions?: string[];
  no_duty?: { id?: string; provisions: string[]; quote?: string; why?: string }[];
  tiers?: ProvisionLine[];
  penalty_paragraphs?: ProvisionLine[];
  annexes?: AnnexLine[];
  carried_duties?: CarriedDutyLine[];
  closed_lists?: ClosedList[];
  unlisted?: ProvisionLine;
  application?: ApplicationLine[];
  penalty_quotes?: PenaltyQuote[];
  /**
   * A regime without tiers whose penalties the Member States lay down: the
   * penalty quotation that says so, `<id>` of its own `penalty_quotes` or `<regime id>/<id>` of another regime's (a
   * delegated act, an amending directive). The build's guard holds it to the quotation's words.
   */
  member_states_penalty?: string;
}
export interface PenaltyExplicit {
  id: string;
  match: string;
  jurisdiction?: string[];
  regime?: string;
  provision?: string;
  tier?: PenaltyTier;
  why?: string;
}
export interface PenaltyTierTable {
  table_id: string;
  reviewed_at: string;
  regimes: PenaltyRegime[];
  explicit: PenaltyExplicit[];
}

/** The bundle file the build writes and this module reads. */
export const PENALTY_TIERS_FILE = "penalty-tiers.json";

/**
 * The compiled table from a bundle directory, its bytes checked against the digest `manifest.json` lists for it (the
 * bundle is taken whole or not at all, as `loadBundle` takes it). Throws where the manifest does not list the file or
 * the digest does not match.
 */
export function loadPenaltyTiers(bundleDir: string): PenaltyTierTable {
  const manifest = JSON.parse(readFileSync(join(bundleDir, "manifest.json"), "utf8")) as { files?: Record<string, string> };
  const expected = manifest?.files?.[PENALTY_TIERS_FILE];
  if (typeof expected !== "string") {
    throw new Error(`manifest.json does not list ${PENALTY_TIERS_FILE}, so the penalty tiers are covered by no digest`);
  }
  const bytes = readFileSync(join(bundleDir, PENALTY_TIERS_FILE));
  const actual = sha256(bytes);
  if (actual !== expected) {
    throw new Error(`bundle integrity error: ${PENALTY_TIERS_FILE} sha256 mismatch (expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`);
  }
  const table = JSON.parse(bytes.toString("utf8")) as PenaltyTierTable;
  const problems = penaltyTableShapeProblems(table);
  if (problems.length > 0) throw new Error(`${PENALTY_TIERS_FILE}: ${problems.join("; ")}`);
  return table;
}

/** The shape this module reads, said plainly where it is not there. */
export function penaltyTableShapeProblems(table: unknown): string[] {
  const t = table as Partial<PenaltyTierTable> | null;
  const out: string[] = [];
  if (t === null || typeof t !== "object") return ["the table is not an object"];
  if (typeof t.reviewed_at !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(t.reviewed_at)) out.push("reviewed_at is not an ISO date");
  if (!Array.isArray(t.regimes) || t.regimes.length === 0) out.push("regimes is not a non-empty list");
  if (!Array.isArray(t.explicit)) out.push("explicit is not a list");
  const ids = new Set<string>();
  for (const r of t.regimes ?? []) {
    if (!r || typeof r.id !== "string" || typeof r.name !== "string" || !Array.isArray(r.match) || r.match.length === 0) {
      out.push(`a regime lacks id, name or match: ${JSON.stringify(r)?.slice(0, 80)}`);
      continue;
    }
    if (ids.has(r.id)) out.push(`regime id ${r.id} is declared twice`);
    ids.add(r.id);
    // A tiered regime needs a line for the provisions its lists do not name, unless one of its lines covers every
    // provision (the DSA's Art 52(3) first sentence: "a failure to comply with an obligation laid down in this Regulation").
    const coversAll = (r.tiers ?? []).some((l) => (l.provisions ?? []).includes("*"));
    if (r.tiered === true && !r.unlisted && !coversAll) out.push(`regime ${r.id} is tiered and has no unlisted line`);
    for (const line of [...(r.tiers ?? []), ...(r.penalty_paragraphs ?? [])]) {
      if (line.tier !== "top" && line.tier !== "not_top") out.push(`${r.id}/${line.id}: tier must be top or not_top`);
    }
    for (const line of r.carried_duties ?? []) {
      if (!line || typeof line.id !== "string" || !Array.isArray(line.provisions) || line.provisions.length === 0 || typeof line.duty !== "string") {
        out.push(`${r.id}: a carried_duties line lacks id, provisions or duty`);
      }
    }
    for (const p of r.match) {
      try {
        new RegExp(p);
      } catch (e) {
        out.push(`${r.id}: match pattern ${JSON.stringify(p)} does not compile (${(e as Error).message})`);
      }
    }
  }
  for (const e of t.explicit ?? []) {
    if (!e || typeof e.id !== "string" || typeof e.match !== "string") out.push(`an explicit entry lacks id or match`);
    else if (e.regime !== undefined && !ids.has(e.regime)) out.push(`explicit ${e.id} names regime ${e.regime}, which the table does not declare`);
    else if (e.tier === undefined && (e.regime === undefined || e.provision === undefined)) out.push(`explicit ${e.id} gives neither a tier nor a regime and provision`);
  }
  return out;
}

/* ------------------------------------------------------------------ provisions */

/** A provision as read from a cite or a table line. */
type Provision =
  | { kind: "article"; art: string; path: string[] }
  | { kind: "annex"; annex: string }
  | { kind: "recital"; n: string };

const ARTICLE_REF = String.raw`\bArt(?:icles?|s?\.)?\s*(\d+[a-z]?)((?:\s?\((?:\d+[a-z]?|[a-z]{1,3})\))*)`;
const ANNEX_REF = String.raw`\bAnnex\s+([IVXLC]+)\b`;
const RECITAL_REF = String.raw`\bRecitals?\s+(\d+)`;
const PROVISION_RE = new RegExp(`${ARTICLE_REF}|${ANNEX_REF}|${RECITAL_REF}`, "gi");

function provisionAt(m: RegExpExecArray): Provision {
  if (m[1] !== undefined) {
    const path = [...(m[2] ?? "").matchAll(/\(([^)]+)\)/g)].map((x) => x[1]);
    return { kind: "article", art: m[1].toLowerCase(), path };
  }
  if (m[3] !== undefined) return { kind: "annex", annex: m[3].toUpperCase() };
  return { kind: "recital", n: m[4] };
}

/** The first provision reference at or after `from`; failing that, the first anywhere in the cite. */
export function readProvision(cite: string, from = 0): Provision | null {
  PROVISION_RE.lastIndex = 0;
  let first: Provision | null = null;
  for (let m = PROVISION_RE.exec(cite); m !== null; m = PROVISION_RE.exec(cite)) {
    const p = provisionAt(m);
    if (m.index >= from) return p;
    first ??= p;
  }
  return first;
}

// The heading's provision list, read on from the first reference. Each step is anchored where the last one ended
// (sticky), so nothing past the first word that is neither a connector nor a reference is read: the context prose after
// a heading ("- addressed to providers (Art. 3(3))", a quoted provision) names provisions the cite does not rest on.
const DESIGNATOR = String.raw`\((?:\d+[a-z]?|[a-z]{1,3})\)`;
const STICKY_PROVISION = new RegExp(`${ARTICLE_REF}|${ANNEX_REF}|${RECITAL_REF}`, "iy");
const ANY_PROVISION = new RegExp(`${ARTICLE_REF}|${ANNEX_REF}|${RECITAL_REF}`, "i");
/** "first subparagraph", "third paragraph", "second sentence": they narrow the reference and change no designator. */
const QUALIFIER = /,?\s*(?:first|second|third|fourth|fifth|sixth|last)\s+(?:subparagraph|paragraph|sentence)\b/iy;
/** "point (ba)", "points (ba)", "point 2": a point of the reference's last paragraph, appended to it. */
const POINT = /,?\s*points?\s+(?:\((\d+[a-z]?|[a-z]{1,3})\)|(\d+[a-z]?)\b)/iy;
/** An annex's own subdivisions ("Part I point (2)(c)", "Section III(c)"): the tier is the annex's, so they are skipped. */
const ANNEX_PART = new RegExp(
  String.raw`(?:,?\s*(?:Part|Section|Chapter)\s+[IVXLC]+\b(?:${DESIGNATOR})*|,?\s*points?\s*(?:\(\d+[a-z]?\)|\d+[a-z]?\b)(?:${DESIGNATOR})*)`,
  "iy",
);
/** A parenthesis that is prose, not a designator ("(definition of consent)"), skipped when it names no provision. */
const PROSE_PAREN = /\s*\(([^()]{4,120})\)/y;
/** "and", "or", ",", "&", "plus", "read with", ...; then an optional "the" ("Art. 2(1) and the Art. 3 defined terms"). */
const CONNECTOR = /\s*(?:,|;|\/|&)?\s*(?:(?:and\/or|and also|and|or|plus|as well as|read (?:together )?with|in conjunction with|together with|with)\s+)?(?:the\s+)?/iy;
/** "and, for consent, Art. 7": a short aside between commas after "and"/"or", read past only where a reference follows. */
const ASIDE = /\s*,?\s*(?:and|or)\s*,\s*[a-z][a-z' -]{0,60}?,\s*(?:the\s+)?/iy;
const BARE_DESIGNATORS = new RegExp(`(?:${DESIGNATOR})+`, "y");
/** A number that is a count or an amount, not an article: "30 days", "16 years", "4 %". */
const NOT_AN_ARTICLE = String.raw`(?!\s*(?:%|per cent|days?|months?|years?|hours?|weeks?|EUR|euros?)\b)`;
const BARE_ARTICLE = new RegExp(String.raw`(\d{1,3}[a-z]?)((?:${DESIGNATOR})*)(?![\d/.,]\d)(?![\d/])${NOT_AN_ARTICLE}`, "y");
const BARE_RECITAL = new RegExp(String.raw`(\d{1,3})(?![\d/.,]\d)(?![\d/(])${NOT_AN_ARTICLE}`, "y");
const RANGE_END = /\s*(?:to|-)\s*(\d+)\b(?![(/])/y;
/** After a singular reference only "to" or an unspaced hyphen makes a range: a spaced dash ends the heading. */
const SINGULAR_RANGE_END = new RegExp(String.raw`(?:\s+to\s+|-)(\d{1,3})\b(?![(/]|[.,]\d)${NOT_AN_ARTICLE}`, "y");
const DESIGNATOR_RANGE_END = /\s*(?:to|-)\s*\((\d+)\)/y;
/** "Article 29 Working Party": a body's name, not a provision. */
const NOT_A_PROVISION = /\s+(?:Data Protection\s+)?Working Party\b/y;
/** "of", "in", then the instrument a reference belongs to ("of Directive 2002/58/EC", "of the ePrivacy Directive"). */
const OF_LEAD = /\s+(?:of|in)\s+(?:the\s+)?/y;
/** An instrument named by number, by an all-capitals short name, or by a capitalised name ending in its kind. "of this
 * Regulation" and a bare "of the Regulation" name none, so they stay with the cite's own regime. */
const OF_INSTRUMENT =
  /(?:Directive|Regulation|Decision)\s*(?:\(|No\b|\d)|(?:Treaty|Charter)\b|(?:(?:[A-Z][\w-]*|e-?[A-Z][\w-]*)\s+){1,6}(?:Directive|Regulation|Act|Decision|Treaty|Charter|Convention|Code)\b|[A-Z]{2,}\b/y;
const PLURAL = /^(?:Art(?:icles|s)|Recitals)\b/i;

function stickyAt(re: RegExp, s: string, at: number): RegExpExecArray | null {
  re.lastIndex = at;
  return re.exec(s);
}

/**
 * Where a cite's reading may look. `limit`: the first other regime's name after the cite's own (a reference after
 * "narrower than AI Act" is not this cite's). `heading`: the end of the cite's heading as well (`headingEnd`), the
 * window the coverage check holds the reader to. With the regime's own name patterns and every other regime's, so "of
 * the GDPR" in a GDPR cite stays the GDPR's and "of the Data Act" does not.
 */
interface ReadScope {
  limit: number;
  heading: number;
  own: RegExp[];
  others: RegExp[];
}

/** Abbreviations whose full stop does not end a sentence ("Cal. Civ. Code", "S.B. 243", "Art. 7", "et seq."). */
const ABBREVIATION = /(?:^|[\s(.])(?:[A-Za-z]|Art|Arts|Sec|Secs|No|Nos|Cal|Civ|Gen|Bus|Prof|Stat|Rev|Inc|Ltd|Co|Corp|Dept|St|Dr|Mr|Ms|cf|e\.g|i\.e|vs?|pp?|paras?|seq|Reg|Dir|Ch|Pt|ed|vol)$/;

const ABBREVIATION_ANY_CASE = new RegExp(ABBREVIATION.source, "i");

/**
 * The end of a cite's heading, where its context prose begins: the first dash, colon or opening quotation mark (inside
 * a parenthesis too: "Art. 19(1) ('Exclusion for ...') excludes ..."), or the first full stop outside parentheses that
 * ends a sentence (followed by a capital, not after an abbreviation); else the cite's length. `sentenceBeforeNumber`: a full stop followed by a number ends it as
 * well ("... vice-chairs. 38 pages"), for the citation the report prints (`citationOf`); the resolver's window keeps the
 * default.
 */
export function headingEnd(c: string, opts: { sentenceBeforeNumber?: boolean } = {}): number {
  let depth = 0;
  for (let i = 0; i < c.length; i++) {
    const ch = c[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === ":" || ch === '"' || ch === "“" || ch === "”" || ch === "‘") return i;
    if ((ch === "'" || ch === "’") && (i === 0 || /[\s(]/.test(c[i - 1]))) return i;
    if (ch === "—" || ch === "–") {
      // An en or em dash between two designators or numbers is a range ("12–22", "(4)–(5)"), not the heading's end.
      if (!(/[\d)]/.test(c[i - 1] ?? "") && /[\d(]/.test(c[i + 1] ?? ""))) return i;
    }
    if (ch === "-" && c[i - 1] === " " && c[i + 1] === " ") return i;
    if (ch === "." && depth === 0 && /^\s+[A-Z]/.test(c.slice(i + 1, i + 3)) && !ABBREVIATION.test(c.slice(Math.max(0, i - 8), i))) return i;
    // Before a number, an abbreviation in either case keeps the heading going ("Deliberation no. 2020-092", "Art. 9").
    if (opts.sentenceBeforeNumber && ch === "." && depth === 0 && /^\s+\d/.test(c.slice(i + 1, i + 3)) && !ABBREVIATION_ANY_CASE.test(c.slice(Math.max(0, i - 8), i))) return i;
  }
  return c.length;
}

/** True where the reference ending at `end` is followed by "of"/"in" and another instrument than the cite's own. */
function ofOther(c: string, end: number, scope?: ReadScope): boolean {
  const lead = stickyAt(OF_LEAD, c, end);
  if (!lead) return false;
  const at = end + lead[0].length;
  if (scope?.own.some((re) => stickyAt(re, c, at) !== null)) return false;
  if (scope?.others.some((re) => stickyAt(re, c, at) !== null)) return true;
  return stickyAt(OF_INSTRUMENT, c, at) !== null;
}

/** A reference match that is no provision of the cite's regime: a body's name, or a provision of another instrument. */
function notOwnReference(c: string, m: RegExpExecArray, scope?: ReadScope): boolean {
  const end = m.index + m[0].length;
  return stickyAt(NOT_A_PROVISION, c, end) !== null || ofOther(c, end, scope);
}

/**
 * Every provision the cite's heading names, in order: the first reference at or after `from` (failing that, the first
 * anywhere, as `readProvision` reads it), then each further reference joined to it by a connector ("and", "or", ",",
 * "read with", "in conjunction with"), with points ("points (ba) and (bb)"), sibling designators ("Art. 33(1), (3) and
 * (4)") and, after a plural "Arts."/"Articles", bare numbers and ranges. Reading stops at the first word that is
 * neither, and a reference followed by "of <another instrument>" is not this regime's and ends the list.
 */
export function readProvisions(cite: string, from = 0): Provision[] {
  return readProvisionsIn(cite, from);
}

/** The cite's own regime named again after a connector ("Art. 24 and 25; GDPR Art. 30"): its length, with what follows. */
function ownNameAt(cite: string, at: number, scope?: ReadScope): number {
  for (const re of scope?.own ?? []) {
    const m = stickyAt(re, cite, at);
    if (m) return m[0].length + (/^\s*,?\s*/.exec(cite.slice(at + m[0].length))?.[0].length ?? 0);
  }
  return 0;
}

/** The next reference joined to the last one by a connector, an aside, or the regime's own name repeated; or null. */
function nextReference(cite: string, at: number, scope?: ReadScope): { m: RegExpExecArray; start: number } | null {
  const c = stickyAt(CONNECTOR, cite, at);
  const next = at + (c ? c[0].length : 0);
  let m = stickyAt(STICKY_PROVISION, cite, next);
  if (m) return { m, start: next };
  if (next > at) {
    const own = ownNameAt(cite, next, scope);
    if (own > 0 && (m = stickyAt(STICKY_PROVISION, cite, next + own))) return { m, start: next + own };
  }
  const aside = stickyAt(ASIDE, cite, at);
  if (aside && (m = stickyAt(STICKY_PROVISION, cite, at + aside[0].length))) return { m, start: at + aside[0].length };
  return null;
}

function readProvisionsIn(cite: string, from: number, scope?: ReadScope): Provision[] {
  const limit = scope?.limit ?? cite.length;
  PROVISION_RE.lastIndex = 0;
  let first: RegExpExecArray | null = null;
  let fallback: RegExpExecArray | null = null;
  for (let m = PROVISION_RE.exec(cite); m !== null; m = PROVISION_RE.exec(cite)) {
    if (notOwnReference(cite, m, scope)) continue;
    if (m.index >= from) {
      // The first reference must come before any other regime's name: one after "narrower than AI Act" is that act's.
      // It may follow the heading ("Directive 2011/93/EU ..., CELEX 32011L0093 - Art. 2, points (c) and (e)").
      if (m.index < limit) first = m;
      break;
    }
    fallback ??= m;
  }
  first ??= fallback;
  if (!first) return [];
  const out: Provision[] = [provisionAt(first)];
  let plural = PLURAL.test(first[0]);
  let at = first.index + first[0].length;
  for (let steps = 0; steps < 200; steps++) {
    const p = out[out.length - 1];
    let m: RegExpExecArray | null;
    // Narrow the last reference, or skip what belongs to it.
    if ((m = stickyAt(QUALIFIER, cite, at))) {
      at += m[0].length;
      continue;
    }
    if (p.kind === "article" && (m = stickyAt(POINT, cite, at))) {
      out[out.length - 1] = { ...p, path: [...p.path, m[1] ?? m[2]] };
      at += m[0].length;
      continue;
    }
    if (p.kind === "annex" && (m = stickyAt(ANNEX_PART, cite, at)) && m[0].length > 0) {
      at += m[0].length;
      continue;
    }
    if (p.kind === "article" && p.path.length === 0 && (m = stickyAt(plural ? RANGE_END : SINGULAR_RANGE_END, cite, at))) {
      // "Arts. 12 to 22", "Art. 30 to 32", "12-22": every article of the range.
      const lo = num(p.art);
      const hi = Number(m[1]);
      if (!Number.isNaN(lo) && hi > lo && hi - lo <= 60) for (let n = lo + 1; n <= hi; n++) out.push({ kind: "article", art: String(n), path: [] });
      at += m[0].length;
      continue;
    }
    if (p.kind === "recital" && (m = stickyAt(SINGULAR_RANGE_END, cite, at))) {
      const lo = Number(p.n);
      const hi = Number(m[1]);
      if (hi > lo && hi - lo <= 60) for (let n = lo + 1; n <= hi; n++) out.push({ kind: "recital", n: String(n) });
      at += m[0].length;
      continue;
    }
    if (p.kind === "article" && p.path.length > 0 && /^\d+$/.test(p.path[p.path.length - 1]) && (m = stickyAt(DESIGNATOR_RANGE_END, cite, at))) {
      // "33(4)-(5)", "30(1) to (4)": every paragraph of the range.
      const lo = Number(p.path[p.path.length - 1]);
      const hi = Number(m[1]);
      if (hi > lo && hi - lo <= 30) for (let n = lo + 1; n <= hi; n++) out.push({ ...p, path: [...p.path.slice(0, -1), String(n)] });
      at += m[0].length;
      continue;
    }
    if ((m = stickyAt(PROSE_PAREN, cite, at)) && !ANY_PROVISION.test(m[1])) {
      at += m[0].length;
      continue;
    }
    // Then a connector and a further reference, or stop.
    const ref = nextReference(cite, at, scope);
    if (ref) {
      if (notOwnReference(cite, ref.m, scope)) break;
      out.push(provisionAt(ref.m));
      plural = PLURAL.test(ref.m[0]);
      at = ref.start + ref.m[0].length;
      continue;
    }
    const c = stickyAt(CONNECTOR, cite, at);
    const next = at + (c ? c[0].length : 0);
    if (p.kind === "recital" && next > at && (m = stickyAt(BARE_RECITAL, cite, next))) {
      // "Recitals 32 and 42", "Recital 80 and 81": a bare number after a recital is a recital.
      out.push({ kind: "recital", n: m[1] });
      at = next + m[0].length;
      continue;
    }
    if (p.kind === "article" && next > at && (m = stickyAt(BARE_DESIGNATORS, cite, next))) {
      // A sibling of the last reference: "(3)" after 33(1) replaces the paragraph, "(g)" after 28(3)(e) the point.
      const designators = [...m[0].matchAll(/\(([^)]+)\)/g)].map((x) => x[1]);
      const isDigit = (s: string) => /^\d/.test(s);
      let depth = p.path.length - 1;
      while (depth >= 0 && isDigit(p.path[depth]) !== isDigit(designators[0])) depth--;
      if (depth < 0) break;
      out.push({ kind: "article", art: p.art, path: [...p.path.slice(0, depth), ...designators] });
      at = next + m[0].length;
      continue;
    }
    if (next > at && (m = stickyAt(BARE_ARTICLE, cite, next)) && (p.kind === "article" || plural || m[2].length > 0)) {
      // "Arts. 13 and 14", "Art. 4(1) and 4(3)", "Art. 4(11), 6 and 7": a bare number joined to an article reference by a
      // connector is an article (1 to 3 digits, and not a count: "30 days", "16 years").
      const end = next + m[0].length;
      if (ofOther(cite, end, scope)) break;
      out.push({ kind: "article", art: m[1].toLowerCase(), path: [...m[2].matchAll(/\(([^)]+)\)/g)].map((x) => x[1]) });
      at = end;
      continue;
    }
    break;
  }
  return out;
}

export function provisionLabel(p: Provision | null): string {
  if (!p) return "";
  if (p.kind === "annex") return `Annex ${p.annex}`;
  if (p.kind === "recital") return `Recital ${p.n}`;
  return `${p.art}${p.path.map((x) => `(${x})`).join("")}`;
}

/** A table spec: "*", "5", "12-22", "25(2)", "30(1)-(4)", "5(1)(ba)", "Annex I". */
type Spec =
  | { kind: "any" }
  | { kind: "annex"; annex: string }
  | { kind: "article"; lo: string; hi: string; path: string[]; paraHi?: string };

function parseSpec(s: string): Spec {
  const t = s.trim();
  if (t === "*") return { kind: "any" };
  const annex = /^Annex\s+([IVXLC]+)$/i.exec(t);
  if (annex) return { kind: "annex", annex: annex[1].toUpperCase() };
  const range = /^(\d+[a-z]?)-(\d+[a-z]?)$/.exec(t);
  if (range) return { kind: "article", lo: range[1], hi: range[2], path: [] };
  const paraRange = /^(\d+[a-z]?)\((\d+)\)-\((\d+)\)$/.exec(t);
  if (paraRange) return { kind: "article", lo: paraRange[1], hi: paraRange[1], path: [paraRange[2]], paraHi: paraRange[3] };
  const plain = /^(\d+[a-z]?)((?:\([^)]+\))*)$/.exec(t);
  if (plain) {
    const path = [...plain[2].matchAll(/\(([^)]+)\)/g)].map((x) => x[1]);
    return { kind: "article", lo: plain[1], hi: plain[1], path };
  }
  throw new Error(`penalty table: provision spec ${JSON.stringify(s)} cannot be read`);
}

const num = (a: string): number => (/^\d+$/.test(a) ? Number(a) : Number.NaN);

function articleInRange(art: string, lo: string, hi: string): boolean {
  if (lo === hi) return art === lo;
  const n = num(art);
  return !Number.isNaN(n) && n >= num(lo) && n <= num(hi);
}

/**
 * "full": the spec covers the cited provision. "partial": the cite names the article and no paragraph while the spec
 * covers only some of its paragraphs, so the cite could fall under it or not. "none": it does not.
 */
function specMatch(spec: Spec, p: Provision): "full" | "partial" | "none" {
  if (spec.kind === "any") return p.kind === "recital" ? "none" : "full";
  if (spec.kind === "annex") return p.kind === "annex" && p.annex === spec.annex ? "full" : "none";
  if (p.kind !== "article" || !articleInRange(p.art, spec.lo, spec.hi)) return "none";
  if (spec.path.length === 0) return "full";
  if (spec.paraHi !== undefined) {
    if (p.path.length === 0) return "partial";
    const n = num(p.path[0]);
    return !Number.isNaN(n) && n >= num(spec.path[0]) && n <= num(spec.paraHi) ? "full" : "none";
  }
  for (let i = 0; i < spec.path.length; i++) {
    if (i >= p.path.length) return "partial";
    if (p.path[i] !== spec.path[i]) return "none";
  }
  return "full";
}

function bestMatch(specs: string[] | undefined, p: Provision): "full" | "partial" | "none" {
  let best: "full" | "partial" | "none" = "none";
  for (const s of specs ?? []) {
    const m = specMatch(parseSpec(s), p);
    if (m === "full") return "full";
    if (m === "partial") best = "partial";
  }
  return best;
}

const WEIGHT: Record<PenaltyTier, number> = { top: 2, not_top: 1, no_duty: 0 };

/* ------------------------------------------------------------------ resolution */

function appliesFromOf(regime: PenaltyRegime, p: Provision | null, reviewedAt: string): string | undefined {
  if (!p || p.kind === "recital") return undefined;
  for (const line of regime.application ?? []) {
    if (bestMatch(line.provisions, p) === "full") {
      return line.date !== null && line.date > reviewedAt ? line.date : undefined;
    }
  }
  return undefined;
}

function inRegime(table: PenaltyTierTable, regime: PenaltyRegime, p: Provision | null, cite: string, seen: string[] = []): TierOfBasis {
  const label = provisionLabel(p);
  const base = { regime: regime.name, regimeId: regime.id, tiered: regime.tiered === true, provision: label, provisions: label ? [label] : [] };
  const answer = (tier: PenaltyTier, line: string, penaltyCite: string): TierOfBasis => {
    const appliesFrom = tier === "no_duty" ? undefined : appliesFromOf(regime, p, table.reviewed_at);
    const penaltyText = tier === "no_duty" ? undefined : penaltyTextOf(table, regime, line, p);
    // The fine provision's own date, by the regime's application lines.
    const penaltyAppliesFrom = tier === "no_duty" || penaltyCite === "" ? undefined : appliesFromOf(regime, readProvision(penaltyCite), table.reviewed_at);
    return {
      ...base,
      tier,
      line: `${regime.id}/${line}`,
      penaltyCite,
      ...(appliesFrom ? { appliesFrom } : {}),
      ...(penaltyAppliesFrom ? { penaltyAppliesFrom } : {}),
      ...(penaltyText ? { penaltyText } : {}),
    };
  };
  if (p?.kind === "recital") return answer("no_duty", "recital", "");
  if (p?.kind === "article" && (regime.definitions ?? []).includes(p.art)) return answer("no_duty", "definitions", "");
  if (p) {
    for (const nd of regime.no_duty ?? []) {
      if (bestMatch(nd.provisions, p) === "full") return answer("no_duty", `no_duty:${nd.provisions.join(",")}`, "");
    }
  }
  if (regime.coverage === "definitions_only") return unresolved(cite, regime, p);
  if (!p) {
    // A regime without tiers puts every duty in its top tier, so the provision is not needed; a tiered one needs it.
    return regime.tiered === false ? answer("top", "no-tiers", regime.penalty_cite) : unresolved(cite, regime, p);
  }
  for (const line of regime.penalty_paragraphs ?? []) {
    if ((line.provisions ?? []).length > 0 && bestMatch(line.provisions, p) === "full") {
      return answer(line.tier as PenaltyTier, line.id, line.penalty_cite ?? regime.penalty_cite);
    }
  }
  if (p.kind === "annex") {
    const a = (regime.annexes ?? []).find((x) => x.annex === p.annex);
    if (a) return answer(a.tier, a.id, a.penalty_cite);
  }
  // A provision that carries another's duty takes the tier that duty resolves to here, followed to its last link (CRA
  // Art 25 -> Art 24(3) -> Art 14(1)); a line met twice on one chain is a loop, which the table cannot answer.
  const carriedLines: { tier: PenaltyTier; line: string; cite: string; m: "full" | "partial" }[] = [];
  for (const line of regime.carried_duties ?? []) {
    const m = bestMatch(line.provisions, p);
    if (m === "none") continue;
    if (seen.includes(line.id)) return unresolved(cite, regime, p);
    const r = inRegime(table, regime, readProvision(`Art. ${line.duty}`), cite, [...seen, line.id]);
    if (r.unresolved) return unresolved(cite, regime, p);
    carriedLines.push({ tier: r.tier, line: `${line.id} -> ${r.line}`, cite: `${r.penaltyCite}, through Art ${line.provisions.join(", ")}`, m });
  }
  const fullCarried = carriedLines.find((x) => x.m === "full");
  if (fullCarried) return answer(fullCarried.tier, fullCarried.line, fullCarried.cite);
  if (regime.tiered !== true) return answer("top", "no-tiers", regime.penalty_cite);
  let best: { tier: PenaltyTier; line: string; cite: string } | null = null;
  let partial = false;
  for (const line of regime.tiers ?? []) {
    const m = bestMatch(line.provisions, p);
    if (m === "none") continue;
    if (m === "partial") partial = true;
    const tier = line.tier as PenaltyTier;
    if (!best || WEIGHT[tier] > WEIGHT[best.tier]) best = { tier, line: line.id, cite: line.penalty_cite ?? regime.penalty_cite };
  }
  // A cite without a paragraph that a carried line covers in part could be that paragraph: it counts as a partial line.
  for (const x of carriedLines) {
    partial = true;
    if (!best || WEIGHT[x.tier] > WEIGHT[best.tier]) best = { tier: x.tier, line: x.line, cite: x.cite };
  }
  const unlisted = regime.unlisted as ProvisionLine;
  if (!best) return answer(unlisted.tier as PenaltyTier, unlisted.id, unlisted.penalty_cite ?? regime.penalty_cite);
  // A cite without a paragraph that a line covers only in part could also be an unlisted paragraph: the heavier wins.
  if (partial && WEIGHT[unlisted.tier as PenaltyTier] > WEIGHT[best.tier]) {
    return answer(unlisted.tier as PenaltyTier, unlisted.id, unlisted.penalty_cite ?? regime.penalty_cite);
  }
  return answer(best.tier, best.line, best.cite);
}

/** The penalty quotation a regime's `member_states_penalty` names (`<id>` of its own, `<regime id>/<id>` of another's); null where none. */
function memberStatesQuote(table: PenaltyTierTable, regime: PenaltyRegime): PenaltyQuote | null {
  const ref = regime.member_states_penalty;
  if (typeof ref !== "string" || ref === "") return null;
  const [owner, id] = ref.includes("/") ? [table.regimes.find((r) => r.id === ref.slice(0, ref.indexOf("/"))), ref.slice(ref.indexOf("/") + 1)] : [regime, ref];
  return (owner?.penalty_quotes ?? []).find((q) => q.id === id) ?? null;
}

/** `TierOfBasis.penaltyText` for an answer through `line` (the last link of a carried chain decides). */
function penaltyTextOf(table: PenaltyTierTable, regime: PenaltyRegime, line: string, p: Provision | null): NonNullable<TierOfBasis["penaltyText"]> {
  const last = (line.split(" -> ").pop() ?? line).replace(/^[^/]*\//, "");
  if (regime.tiered !== true || last === "no-tiers") {
    const ms = memberStatesQuote(table, regime);
    // A route the table quotes for some duties only is named where this provision is one of them.
    const routes = p ? (regime.penalty_quotes ?? []).filter((q) => q.reaches && q.says && bestMatch(q.reaches, p) === "full").map((q) => ({ cite: q.cite, says: q.says as string })) : [];
    return { basis: "no_tiers", ...(ms ? { memberStates: ms.cite } : {}), quoted: ms !== null || (regime.penalty_quotes ?? []).length > 0, ...(routes.length > 0 ? { routes } : {}) };
  }
  if (regime.unlisted && last === regime.unlisted.id) {
    return { basis: "unlisted", ...(regime.unlisted.member_states === true && regime.unlisted.penalty_cite ? { memberStates: regime.unlisted.penalty_cite } : {}), quoted: true };
  }
  return { basis: "fine_list", quoted: true };
}

/**
 * The words a quotation must open with to be marked as leaving the penalties
 * to the Member States: "Member States shall lay down (the rules on) ... penalties / measures / sanctions ...
 * infringement(s)", or "Member States shall determine the sanctions applicable to infringements".
 */
const MEMBER_STATES_PENALTY = /^Member States shall (?:lay down|determine)\b[^.]*\b(?:penalties|sanctions|measures)\b[^.]*\binfringements?\b/;

function unresolved(cite: string, regime: PenaltyRegime | null, p: Provision | null): TierOfBasis {
  const label = provisionLabel(p);
  return {
    tier: "top",
    regime: regime?.name ?? "",
    regimeId: regime?.id ?? "",
    penaltyCite: "",
    // The regime's own value where one is named (a fact of the table), false where none is: not a claim about the cite.
    tiered: regime?.tiered === true,
    line: "unresolved",
    provision: label,
    provisions: label ? [label] : [],
    unresolved: true,
  };
}

/**
 * The answer for a cite whose heading names several provisions of one regime: each is resolved on its own, the heaviest
 * tier decides (top over not_top over no_duty), and `appliesFrom` is read across the duty provisions (see the field).
 * A provision nothing resolves makes the whole cite unresolved, so the build refuses it until the table says.
 */
function combine(answers: TierOfBasis[], labels: string[], penalty: boolean[]): TierOfBasis {
  const open = answers.find((a) => a.unresolved);
  if (open) return { ...open, provisions: labels };
  let best = answers[0];
  for (const a of answers) if (WEIGHT[a.tier] > WEIGHT[best.tier]) best = a;
  // A penalty paragraph cited beside a duty sets the duty's tier and is no duty of its own, so it does not make the
  // duty read as in force ("AI Act Art. 5(1)(ba) and Art. 99(3)" applies from 2026-12-02). Where the cite names only
  // penalty paragraphs, they are read as the duties.
  const named = answers.filter((a, i) => a.tier !== "no_duty" && !penalty[i]);
  const duties = named.length > 0 ? named : answers.filter((a) => a.tier !== "no_duty");
  const later = duties.filter((a) => a.appliesFrom !== undefined);
  const out: TierOfBasis = { ...best, provisions: labels };
  delete out.appliesFrom;
  delete out.appliesLater;
  if (later.length > 0 && later.length === duties.length) {
    out.appliesFrom = later.map((a) => a.appliesFrom as string).sort()[0];
  }
  const dates = new Set(duties.map((a) => a.appliesFrom ?? ""));
  if (later.length > 0 && dates.size > 1) {
    out.appliesLater = later.map((a) => ({ provision: a.provision, appliesFrom: a.appliesFrom as string }));
  }
  return out;
}

/** Every explicit entry whose pattern matches the cite and whose jurisdiction list (if any) holds the given one. */
export function explicitMatches(cite: string, jurisdiction: string | undefined, table: PenaltyTierTable): PenaltyExplicit[] {
  return table.explicit.filter(
    (e) => new RegExp(e.match).test(cite) && (!e.jurisdiction || (jurisdiction !== undefined && e.jurisdiction.includes(jurisdiction))),
  );
}

export function tierOfBasis(cite: string, jurisdiction: string | undefined, table: PenaltyTierTable): TierOfBasis {
  const c = cite.replace(/\s+/g, " ").trim();
  const explicit = explicitMatches(c, jurisdiction, table)[0];
  if (explicit) {
    const regime = explicit.regime ? table.regimes.find((r) => r.id === explicit.regime) ?? null : null;
    if (explicit.tier !== undefined) {
      return {
        tier: explicit.tier,
        regime: regime?.name ?? "",
        regimeId: regime?.id ?? "",
        penaltyCite: explicit.tier === "no_duty" ? "" : regime?.penalty_cite ?? "",
        tiered: regime?.tiered === true,
        line: `explicit/${explicit.id}`,
        provision: explicit.provision ?? "",
        provisions: explicit.provision ? [explicit.provision] : [],
      };
    }
    if (regime && explicit.provision) {
      const p = readProvision(`Art. ${explicit.provision}`);
      const r = inRegime(table, regime, p, c);
      return { ...r, line: `explicit/${explicit.id} -> ${r.line}` };
    }
  }
  const reading = readCite(c, table);
  if (!reading) return unresolved(c, null, readProvision(c));
  const { regime, named } = reading;
  if (named.length <= 1) return inRegime(table, regime, named[0] ?? null, c);
  return combine(
    named.map((p) => inRegime(table, regime, p, c)),
    named.map((p) => provisionLabel(p)),
    named.map((p) => isPenaltyParagraph(regime, p)),
  );
}

function isPenaltyParagraph(regime: PenaltyRegime, p: Provision): boolean {
  return (regime.penalty_paragraphs ?? []).some((l) => (l.provisions ?? []).length > 0 && bestMatch(l.provisions, p) === "full");
}

/** The regime a cite names (the earliest name), where its reading may look, and the provisions read there. */
function readCite(c: string, table: PenaltyTierTable): { regime: PenaltyRegime; from: number; scope: ReadScope; named: Provision[] } | null {
  let found: { regime: PenaltyRegime; at: number; end: number } | null = null;
  for (const regime of table.regimes) {
    for (const pattern of regime.match) {
      const m = new RegExp(pattern).exec(c);
      if (m && (found === null || m.index < found.at)) found = { regime, at: m.index, end: m.index + m[0].length };
    }
  }
  if (!found) return null;
  const { regime, end } = found;
  let limit = c.length;
  const others: RegExp[] = [];
  for (const r of table.regimes) {
    if (r === regime) continue;
    for (const pattern of r.match) {
      others.push(new RegExp(pattern, "y"));
      const g = new RegExp(pattern, "g");
      g.lastIndex = end;
      const m = g.exec(c);
      // Outside parentheses only: "Delegated Regulation (EU) 2018/389 (the regulatory technical standards under
      // Directive (EU) 2015/2366), Art. 22" names the parent act to say what the cite's own act is.
      if (m && m.index < limit && depthAt(c, m.index) === 0) limit = m.index;
    }
  }
  const scope: ReadScope = { limit, heading: Math.min(limit, headingEnd(c)), own: regime.match.map((p) => new RegExp(p, "y")), others };
  return { regime, from: end, scope, named: readProvisionsIn(c, end, scope) };
}

function depthAt(c: string, at: number): number {
  let depth = 0;
  for (let i = 0; i < at; i++) {
    if (c[i] === "(") depth++;
    else if (c[i] === ")") depth = Math.max(0, depth - 1);
  }
  return depth;
}

/** A reference a heading names: an article (with a sibling designator where it is "(3)" after "33(1),"), an annex or a
 * recital. */
type HeadingReference = { p: Provision; sibling?: string; text: string };

// A bare number or a sibling designator joined to the reference before it: ", 6", " and 7", " to 32", "-22", ", (3)".
const CHAIN_NUMBER = new RegExp(
  String.raw`(\s*(?:,|;|\/|&)?\s*(?:and\/or|and also|and|or|plus|to)?\s*|-)(\d{1,3}[a-z]?)((?:${DESIGNATOR})*)(?![\d/.,]\d)(?![\d/])${NOT_AN_ARTICLE}`,
  "y",
);
const CHAIN_SIBLING = new RegExp(String.raw`(\s*(?:,|&)?\s*(?:and|or|to|-)?\s*)((?:${DESIGNATOR})+)`, "y");

/**
 * Every reference the cite's heading names that belongs to its regime, found independently of the reader: each
 * Art./Article/Arts./Annex/Recital(s) reference from the regime's name to the heading's end (or another regime's
 * name), less one followed by "of"/"in" another instrument or naming a body, with the bare numbers and sibling
 * designators joined to it. The coverage check compares it with what the reader read.
 */
function headingReferences(c: string, from: number, scope: ReadScope): HeadingReference[] {
  const out: HeadingReference[] = [];
  const re = new RegExp(PROVISION_RE.source, "gi");
  re.lastIndex = from;
  for (let m = re.exec(c); m !== null && m.index < scope.heading; m = re.exec(c)) {
    if (notOwnReference(c, m, scope)) continue;
    const chain: HeadingReference[] = [{ p: provisionAt(m), text: m[0] }];
    let at = m.index + m[0].length;
    let foreign = false;
    for (let steps = 0; steps < 60 && at < scope.heading; steps++) {
      const head = chain[0].p;
      const n = head.kind !== "annex" ? stickyAt(CHAIN_NUMBER, c, at) : null;
      if (n && n[1].trim().length > 0 && at + n[0].length <= scope.heading) {
        const path = [...n[3].matchAll(/\(([^)]+)\)/g)].map((x) => x[1]);
        chain.push({ p: head.kind === "recital" ? { kind: "recital", n: n[2] } : { kind: "article", art: n[2].toLowerCase(), path }, text: n[2] + n[3] });
        at += n[0].length;
        if (ofOther(c, at, scope)) foreign = true;
        continue;
      }
      const s = head.kind === "article" ? stickyAt(CHAIN_SIBLING, c, at) : null;
      if (s && s[1].trim().length > 0 && at + s[0].length <= scope.heading) {
        const last = chain[chain.length - 1].p;
        const first = /\(([^)]+)\)/.exec(s[2])?.[1] ?? "";
        if (last.kind === "article") chain.push({ p: last, sibling: first, text: s[2] });
        at += s[0].length;
        continue;
      }
      break;
    }
    if (!foreign) out.push(...chain);
    re.lastIndex = Math.max(re.lastIndex, at);
  }
  return out;
}

function referenceRead(ref: HeadingReference, read: Provision[]): boolean {
  const p = ref.p;
  return read.some((r) => {
    if (p.kind === "annex") return r.kind === "annex" && r.annex === p.annex;
    if (p.kind === "recital") return r.kind === "recital" && r.n === p.n;
    if (r.kind !== "article" || r.art !== p.art) return false;
    if (ref.sibling !== undefined) return r.path.includes(ref.sibling);
    // A paragraph read covers the article named, and an article read covers its paragraphs (it resolves to the heaviest).
    const n = Math.min(p.path.length, r.path.length);
    return p.path.slice(0, n).every((d, i) => r.path[i] === d);
  });
}

/**
 * The references a cite's heading names in its own regime that the reader did not read ("Art 7" in "GDPR Art. 4(11),
 * see also Art. 7"), each as the heading writes it. Empty where an explicit entry decides the cite, where it names no
 * regime, or where every reference was read. The coverage check refuses a cite with any, so the reader can never stop
 * silently before a provision its heading names.
 */
export function unreadReferences(cite: string, jurisdiction: string | undefined, table: PenaltyTierTable): string[] {
  const c = cite.replace(/\s+/g, " ").trim();
  if (explicitMatches(c, jurisdiction, table).length > 0) return [];
  const reading = readCite(c, table);
  if (!reading) return [];
  const out: string[] = [];
  for (const ref of headingReferences(c, reading.from, reading.scope)) {
    if (!referenceRead(ref, reading.named) && !out.includes(ref.text)) out.push(ref.text);
  }
  return out;
}

/**
 * Every `legal_basis[].cite` of the given rules that the table does not resolve to exactly one answer: a cite no line
 * resolves, and a cite two explicit entries both claim. Each problem names the rule id and the cite. The build refuses
 * a bundle with any.
 */
export function penaltyTierCoverage(
  rules: { id: string; legal_basis?: { cite: string; jurisdiction?: string }[] }[],
  table: PenaltyTierTable,
): string[] {
  const out: string[] = [];
  for (const rule of rules) {
    for (const [i, b] of (rule.legal_basis ?? []).entries()) {
      const c = b.cite.replace(/\s+/g, " ").trim();
      const head = c.length > 120 ? `${c.slice(0, 120)}…` : c;
      const claims = explicitMatches(c, b.jurisdiction, table);
      if (claims.length > 1) {
        out.push(`${rule.id} legal_basis[${i}]: two explicit entries (${claims.map((e) => e.id).join(", ")}) claim the cite ${JSON.stringify(head)}`);
        continue;
      }
      const r = tierOfBasis(b.cite, b.jurisdiction, table);
      if (r.unresolved) {
        out.push(
          `${rule.id} legal_basis[${i}]: no line of the penalty-tier table resolves the cite ${JSON.stringify(head)}` +
            (r.regimeId ? ` (read as regime ${r.regimeId}, provision ${JSON.stringify(r.provision)})` : " (no regime named)"),
        );
        continue;
      }
      const unread = unreadReferences(b.cite, b.jurisdiction, table);
      if (unread.length > 0) {
        out.push(
          `${rule.id} legal_basis[${i}]: the cite ${JSON.stringify(head)} names ${unread.map((u) => JSON.stringify(u)).join(", ")} in its heading, ` +
            `which the reader did not read (it read ${JSON.stringify(r.provisions.join("; "))}); teach the reader the phrasing or decide the cite with an explicit entry`,
        );
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ guards on the table */

/** A table spec as the provision it names; a range as its atomic provisions ("25-39" -> 25..39, "30(1)-(4)"). */
function atomicSpecs(specs: string[]): string[] {
  const out: string[] = [];
  for (const s of specs) {
    let m: RegExpExecArray | null;
    if ((m = /^(\d+)-(\d+)$/.exec(s))) for (let k = Number(m[1]); k <= Number(m[2]); k++) out.push(String(k));
    else if ((m = /^(\d+[a-z]?)\((\d+)\)-\((\d+)\)$/.exec(s))) for (let k = Number(m[2]); k <= Number(m[3]); k++) out.push(`${m[1]}(${k})`);
    else out.push(s);
  }
  return out;
}
const specProvision = (spec: string): Provision | null => readProvision(/^Annex /i.test(spec) ? spec : `Art. ${spec}`);
const paragraphOfPoint = (point: string | undefined): string => (point ?? "").replace(/\([a-z]{1,2}\)$/, "");

/**
 * Whether a penalty `cite` names the provision a quotation's `cite` names, in the same law: the
 * law's name (the text before the first provision) is the same, and every provision of the quotation is one of the cite's.
 */
function citeNamesQuote(cite: string, quoteCite: string): boolean {
  const lawOf = (c: string): string => c.slice(0, Math.max(0, c.search(/\b(?:Art|Annex|Recital)/))).trim();
  const own = readProvisions(cite);
  const named = readProvisions(quoteCite);
  // A cite of a whole article (or paragraph) names each of its paragraphs (points): `EAA Art 30` names Art 30(1).
  const covers = (a: Provision, b: Provision): boolean =>
    a.kind === "article" && b.kind === "article" ? a.art === b.art && a.path.every((x, i) => b.path[i] === x) : JSON.stringify(a) === JSON.stringify(b);
  return lawOf(quoteCite) !== "" && lawOf(quoteCite) === lawOf(cite) && named.length > 0 && named.every((q) => own.some((o) => covers(o, q)));
}

/**
 * What the table does with its closed lists and its carried duties, held to what the lists and the quotations say
 * (2026-10-28, after the re-check found a closed list's line could be given the wrong tier, or be pre-empted by a line
 * read before the tier lines, and a carried line could carry a tier the law does not give). Empty when:
 *   - each declared closed list declares its `tier`, and every tier line of it, and the penalty paragraph line naming
 *     it, carries that tier;
 *   - every provision a closed-list line holds resolves through that same line;
 *   - no line read before the tier lines (definitions, no_duty, penalty paragraphs, annexes, carried duties) names a
 *     provision a closed list holds;
 *   - every carried line quotes its source, its quotation names the duty it carries, its chain ends in a duty (not a
 *     loop, not an unresolved or no-duty provision).
 * The build refuses a table with any. The quotation step holds each declared tier to its paragraph's fine as fetched.
 */
export function penaltyTableGuardProblems(table: PenaltyTierTable): string[] {
  const out: string[] = [];
  for (const regime of table.regimes) {
    // A mark that the Member States lay down the penalties is what the report's
    // words say of the law, so each is held to its quotation, and a regime without tiers whose own quotation says so
    // must carry the mark (else its words would say less than the law).
    if (regime.unlisted?.member_states === true && !MEMBER_STATES_PENALTY.test(regime.unlisted.quote ?? "")) {
      out.push(`${regime.id}/${regime.unlisted.id}: is marked member_states, and its quotation does not leave the penalties to the Member States`);
    } else if (regime.unlisted && regime.unlisted.member_states !== true && MEMBER_STATES_PENALTY.test(regime.unlisted.quote ?? "")) {
      out.push(`${regime.id}/${regime.unlisted.id}: its quotation leaves the penalties to the Member States, and the line is not marked member_states`);
    }
    if (regime.member_states_penalty !== undefined) {
      const q = memberStatesQuote(table, regime);
      if (regime.tiered !== false) out.push(`${regime.id}: names a member_states_penalty, and only a regime without tiers takes one (a tiered regime marks its unlisted line)`);
      if (!q) out.push(`${regime.id}: member_states_penalty ${regime.member_states_penalty} names no penalty quotation of the table`);
      else if (!MEMBER_STATES_PENALTY.test(q.quote)) out.push(`${regime.id}: member_states_penalty ${regime.member_states_penalty} names a quotation that does not leave the penalties to the Member States`);
      // And the quotation is one of the regime's own penalty provisions (its `penalty_cite`): a mark
      // borrowed from another law (a delegated act's parent, an amended directive) holds only where the regime says its
      // penalties sit there; any other borrowed mark would make the report say another law's penalties are this one's.
      else if (!citeNamesQuote(regime.penalty_cite ?? "", q.cite)) out.push(`${regime.id}: member_states_penalty ${regime.member_states_penalty} names ${q.cite}, which is not among the regime's own penalty provisions (${regime.penalty_cite ?? "none"})`);
    } else if (regime.tiered === false && (regime.penalty_quotes ?? []).some((q) => MEMBER_STATES_PENALTY.test(q.quote))) {
      out.push(`${regime.id}: has no tiers and quotes a provision that leaves the penalties to the Member States, and names none as its member_states_penalty`);
    }
    // A route for some duties only says what it reaches, why, and what it lets happen, all three, and
    // only on a regime without tiers (the only words that print it).
    for (const q of regime.penalty_quotes ?? []) {
      const given = [q.reaches !== undefined, q.says !== undefined, q.why !== undefined].filter(Boolean).length;
      if (given > 0 && given < 3) out.push(`${regime.id}/${q.id}: a penalty quotation that reaches some duties only gives reaches, says and why together`);
      else if (given === 3 && (!Array.isArray(q.reaches) || q.reaches.length === 0 || !q.says?.trim() || !q.why?.trim())) out.push(`${regime.id}/${q.id}: reaches, says and why are not all given`);
      else if (given === 3 && regime.tiered !== false) out.push(`${regime.id}/${q.id}: only a regime without tiers takes a penalty route for some duties`);
    }
    const decls = regime.closed_lists ?? [];
    const lines = regime.tiers ?? [];
    const members = new Map<string, ProvisionLine[]>();
    for (const decl of decls) {
      if (decl.tier !== "top" && decl.tier !== "not_top") out.push(`${regime.id}/${decl.id}: declares no tier (top or not_top), so its lines cannot be held to one`);
      const own = lines.filter((l) => paragraphOfPoint(l.point) === decl.paragraph);
      members.set(decl.id, own);
      for (const l of own) {
        if (l.tier !== decl.tier) out.push(`${regime.id}/${l.id}: is a line of ${decl.paragraph}, which is ${decl.tier}, and carries ${l.tier}`);
        for (const spec of atomicSpecs(l.provisions ?? [])) {
          const p = specProvision(spec);
          const r = inRegime(table, regime, p, `guard ${regime.id} ${spec}`);
          if (r.line !== `${regime.id}/${l.id}`) out.push(`${regime.id}/${l.id}: holds ${spec}, which resolves through ${r.line} (${r.tier}), not through its own line`);
        }
      }
      for (const pp of regime.penalty_paragraphs ?? []) {
        if ((pp.provisions ?? []).includes(decl.paragraph) && pp.tier !== decl.tier) {
          out.push(`${regime.id}/${pp.id}: is the penalty paragraph ${decl.paragraph}, which is ${decl.tier}, and carries ${pp.tier}`);
        }
      }
    }
    // Lines the resolver reads before the tier lines must not reach into a closed list.
    const early: [string, string[]][] = [
      ["definitions", regime.definitions ?? []],
      ...(regime.no_duty ?? []).map((l, i): [string, string[]] => [`no_duty ${l.id ?? i}`, l.provisions]),
      ...(regime.penalty_paragraphs ?? []).map((l): [string, string[]] => [`penalty_paragraphs ${l.id}`, l.provisions ?? []]),
      ...(regime.annexes ?? []).map((l): [string, string[]] => [`annexes ${l.id}`, [`Annex ${l.annex}`]]),
      ...(regime.carried_duties ?? []).map((l): [string, string[]] => [`carried_duties ${l.id}`, l.provisions]),
    ];
    for (const [what, specs] of early) {
      for (const spec of specs) {
        const p = specProvision(spec);
        if (!p) continue;
        for (const decl of decls) {
          for (const l of members.get(decl.id) ?? []) {
            if (bestMatch(l.provisions, p) !== "none") {
              out.push(`${regime.id}: ${what} names ${spec}, which closed list ${decl.id} holds through ${l.id}; read before the tier lines, it would take it out of its list`);
            }
          }
        }
      }
    }
    for (const line of regime.carried_duties ?? []) {
      const quote = line.quote;
      if (typeof quote !== "string" || quote.length === 0) {
        out.push(`${regime.id}/${line.id}: a carried line quotes nothing, so what it carries is not shown from the law`);
      } else {
        const named = [...quote.matchAll(new RegExp(PROVISION_RE.source, "gi"))].map((m) => provisionLabel(provisionAt(m)));
        if (!named.includes(line.duty)) out.push(`${regime.id}/${line.id}: carries ${line.duty}, which its quotation does not name (it names ${named.join(", ") || "nothing"})`);
      }
      for (const spec of line.provisions) {
        const r = inRegime(table, regime, specProvision(spec), `guard ${regime.id} ${spec}`);
        if (r.unresolved) out.push(`${regime.id}/${line.id}: ${spec} resolves to no tier (a loop of carried lines, or a duty no line resolves)`);
        else if (r.tier === "no_duty") out.push(`${regime.id}/${line.id}: carries ${line.duty}, which lays down no duty`);
      }
    }
  }
  return out;
}

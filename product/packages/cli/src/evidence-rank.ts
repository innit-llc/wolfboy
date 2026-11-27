/**
 * WHAT A PLACE SHOWS, AS ONE RANK, AND THE
 * ONE FUNCTION EVERY LISTING ORDERS BY.
 *
 * Every place a scan reports carries where it sits (`locations[].path_class`, path-class.ts) and, where every clause that
 * found it matched a word rather than a construct, `tier: "word"` (engine.ts). The two say how much a place shows about
 * what the product's code does, and this module turns them into one rank:
 *
 *   0 a construct in code; 1 in configuration; 2 in example data or a template; 3 a word only (the word tier, in any of
 *   those); 4 in a translation catalogue, a CI file or a prose file (a README, a changelog, a page of Markdown); 5 in a class not read by default (documentation sites, vendored
 *   code, tests, build output), read because the run was asked to (`--read`).
 * Example data, templates, translation catalogues and CI files are read, and listed
 * last; the prohibited-practice area is ordered like any other. The area table of the first screen, the candidate list
 * below it and in quick-scan.txt, and each row's words about where its places are, all take the rank from
 * `evidenceRankOf` and nothing else, so no two listings can order one place two ways.
 *
 * IT ORDERS AND WORDS; IT REMOVES NOTHING. The findings document, its order, its locations' order and everything the AI
 * review is handed are written before any of this runs and are not read back from it: a place in the last rank is
 * listed, counted and reviewed exactly as a place in the first.
 *
 * A place whose document carries no `path_class` (one written before 0.1.3) is taken as code, and a place with no `tier`
 * as a construct: an unknown place is listed first rather than last, so a document this module cannot read fully is
 * shown as it was before, never demoted.
 */
import type { PathClass } from "./path-class.js";
import { group } from "./count-words.js";

/** The rank of a place: 0 shows the most about what the product's code does, 5 the least. */
export type EvidenceRank = 0 | 1 | 2 | 3 | 4 | 5;

/** How many ranks there are, for arrays indexed by rank. */
export const EVIDENCE_RANKS = 6;

/** The rank of the word tier: below every construct in code, configuration, example data and templates. */
export const WORD_TIER_RANK: EvidenceRank = 3;

/** The rank each path class gives a construct found in it. Every class is named, so a new class cannot go unranked. */
export const PATH_CLASS_RANK: Readonly<Record<PathClass, EvidenceRank>> = {
  code: 0,
  config: 1,
  "example-data": 2,
  template: 2,
  translation: 4,
  ci: 4,
  // README, CHANGELOG and other prose files:
  // with translations and CI files, never "in code".
  prose: 4,
  // a word list, a vocabulary, an image: with
  // prose, never "in code".
  asset: 4,
  docs: 5,
  vendored: 5,
  test: 5,
  build: 5,
};

/**
 * What each rank's places are, as a row says it after a count ("3 in example data or templates, 40 words only"). DRAFT
 * wording. These are the screen's words; a test holds
 * them to the screen's word list (no internal word) and to 80 columns, and holds them free of "," and ":", which is
 * where `evidenceNoteLines` wraps a note.
 */
export const EVIDENCE_WORDS: readonly string[] = [
  "in code",
  "in configuration",
  "in example data or templates",
  "words only",
  "in prose or data or translations or CI files",
  "in files read only with --read",
];

/** The word tier's words for one place, after "1" ("1 word only") or alone ("a word only"). */
export const WORD_ONLY_ONE = "word only";

/** A rank's words after a count of `n` places. */
export function evidenceWordsFor(rank: number, n: number): string {
  return rank === WORD_TIER_RANK && n === 1 ? WORD_ONLY_ONE : (EVIDENCE_WORDS[rank] as string);
}

/** The fields of a location this module reads. */
export interface RankedLocation {
  file: string;
  start_line: number;
  path_class?: string;
  tier?: string;
}

/**
 * THE ONE FUNCTION: a location's rank, from its path class and its tier. The word tier puts a place no higher than rank
 * 3; a place that is lower already by its path class (a translation, a CI file, a class read only on request) keeps
 * that lower rank.
 */
export function evidenceRankOf(l: { path_class?: string; tier?: string }): EvidenceRank {
  const byPath = pathRankOf(l);
  const byTier = l.tier === "word" ? WORD_TIER_RANK : 0;
  return (byPath > byTier ? byPath : byTier) as EvidenceRank;
}

/** The rank of the path class alone (a construct's rank there), also for saying where a word-tier place sits. */
function pathRankOf(l: { path_class?: string }): EvidenceRank {
  return l.path_class === undefined ? 0 : (PATH_CLASS_RANK[l.path_class as PathClass] ?? 0);
}

/**
 * One place of a candidate: a file and a line (launch-plan.ts `placeCountOf` counts the same), with the best rank of the
 * locations on that line and the index of the first of them in the document's own order.
 */
export interface RankedPlace {
  file: string;
  line: number;
  rank: EvidenceRank;
  /** Where a word-tier place sits by its path alone (the rank its path class gives). */
  pathRank: EvidenceRank;
  /** The index in `locations` of the first location on this line. */
  index: number;
}

/** A candidate's places in the document's order, one per file and line, each with its rank. */
export function rankedPlacesOf(c: { locations?: readonly RankedLocation[] }): RankedPlace[] {
  const byKey = new Map<string, RankedPlace>();
  const out: RankedPlace[] = [];
  (c.locations ?? []).forEach((l, index) => {
    const key = `${l.file}\u0000${l.start_line}`;
    const rank = evidenceRankOf(l);
    const had = byKey.get(key);
    if (had === undefined) {
      const p: RankedPlace = { file: l.file, line: l.start_line, rank, pathRank: pathRankOf(l), index };
      byKey.set(key, p);
      out.push(p);
    } else if (rank < had.rank) {
      had.rank = rank;
      had.pathRank = pathRankOf(l);
    }
  });
  return out;
}

/**
 * A CANDIDATE'S FACE: the location a listing names for it. The first location,
 * in the document's own order, of the best rank the candidate holds; until 0.1.3 it was `locations[0]`, the first in
 * path order, so a mark holding a call in product code was named by a CI helper whose path sorts before it.
 */
export function faceOf<L extends RankedLocation>(c: { locations: readonly L[] }): L | undefined {
  let best: L | undefined;
  let bestRank = EVIDENCE_RANKS;
  for (const l of c.locations) {
    const r = evidenceRankOf(l);
    if (r < bestRank) {
      best = l;
      bestRank = r;
      if (r === 0) break;
    }
  }
  return best;
}

/** The best rank a candidate holds (0 where it has no location, as an unknown place is taken as code). */
export function bestRankOf(c: { locations?: readonly RankedLocation[] }): EvidenceRank {
  let best = EVIDENCE_RANKS - 1;
  const locs = c.locations ?? [];
  if (locs.length === 0) return 0;
  for (const l of locs) best = Math.min(best, evidenceRankOf(l));
  return best as EvidenceRank;
}

/**
 * Places counted by rank, and where the word-tier places sit by path: what a row says about where its places are. The
 * counts add up to the places the row counts (`placeCountOf`), a candidate with no location counting one place of rank 0.
 */
export interface EvidenceTally {
  /** Places per rank, indexed by rank. */
  places: number[];
  /** Word-tier places per the rank of their path class alone (0 code, 1 configuration, 2 example data or templates). */
  wordsByPath: number[];
}

export function emptyTally(): EvidenceTally {
  return { places: new Array<number>(EVIDENCE_RANKS).fill(0), wordsByPath: new Array<number>(EVIDENCE_RANKS).fill(0) };
}

/** Adds a candidate's places to a tally (and returns it). */
export function tallyInto(t: EvidenceTally, c: { locations?: readonly RankedLocation[] }): EvidenceTally {
  const places = rankedPlacesOf(c);
  if (places.length === 0) t.places[0] = (t.places[0] as number) + 1;
  for (const p of places) {
    t.places[p.rank] = (t.places[p.rank] as number) + 1;
    if (p.rank === WORD_TIER_RANK) t.wordsByPath[p.pathRank] = (t.wordsByPath[p.pathRank] as number) + 1;
  }
  return t;
}

/** One candidate's tally. */
export function tallyOf(c: { locations?: readonly RankedLocation[] }): EvidenceTally {
  return tallyInto(emptyTally(), c);
}

/** ", in example data or templates" where every word-tier place sits in one path class's rank other than code; else "". */
function wordsWhere(t: EvidenceTally): string {
  const at = t.wordsByPath.map((n, r) => (n > 0 ? r : -1)).filter((r) => r >= 0);
  return at.length === 1 && at[0] !== 0 ? `, ${EVIDENCE_WORDS[at[0] as number]}` : "";
}

/**
 * WHERE THE PLACES OF A ROW WITH NO CONSTRUCT IN CODE ARE, IN PLAIN
 * WORDS (DRAFT).
 * THE FIRST SCREEN DOES NOT GROW FOR THE COMMON
 * CASE. A row (or a record of one rank) holding a construct in code says nothing (""), so it has no line under it: on
 * real trees nearly every row holds some configuration, example data, CI file or word beside its code, so a line under
 * every such row kept the screen well over the line budget it held before 0.1.3 (the record's item 9 counts
 * it). Where those places are is on the full list, under each record (report.ts `whereLines`). A row with no construct
 * in code says where its places are, because nothing else on the screen does:
 *
 * - every place in one rank: "all in example data or templates", "all words only, in example data or templates" (where
 *   the words sit in one class), or, for one place, the rank's words alone ("in configuration");
 * - several ranks: the counts by rank, best first, after "not in code:" ("only words in code:" where the only places in
 *   code files are word-tier ones), "not in code: 1 in configuration, 2 in example data or templates".
 */
export function evidenceNote(t: EvidenceTally): string {
  const ranks = t.places.map((n, r) => (n > 0 ? r : -1)).filter((r) => r >= 0);
  if (ranks.length === 0 || (t.places[0] as number) > 0) return "";
  const total = t.places.reduce((a, b) => a + b, 0);
  if (ranks.length === 1) {
    const r = ranks[0] as number;
    const where = r === WORD_TIER_RANK ? wordsWhere(t) : "";
    return total === 1 ? `${r === WORD_TIER_RANK ? `a ${WORD_ONLY_ONE}` : EVIDENCE_WORDS[r]}${where}` : `all ${EVIDENCE_WORDS[r]}${where}`;
  }
  const list = ranks.map((r) => `${group(t.places[r] as number)} ${evidenceWordsFor(r, t.places[r] as number)}`).join(", ");
  return `${(t.wordsByPath[0] as number) > 0 ? "only words in code" : "not in code"}: ${list}`;
}

/**
 * The note, laid out as lines of at most `width` columns under a row: `indent` before the first, the same before every
 * line it wraps onto. Wrapped between two counts (after a ", " or the ": " of the opening words), so "1 in" is never
 * left at a line's end with its words on the next; a single count too long for a line is wrapped at its spaces.
 */
export function evidenceNoteLines(note: string, indent: string, width = 80): string[] {
  if (note === "") return [];
  const chunks = note.split(/(?<=[,:]) /);
  const out: string[] = [];
  let line = indent;
  const room = (l: string, w: string): boolean => [...l].length + (l === indent ? 0 : 1) + [...w].length <= width;
  for (const chunk of chunks) {
    if (line !== indent && !room(line, chunk)) {
      out.push(line);
      line = indent;
    }
    if (room(line, chunk)) {
      line = line === indent ? line + chunk : `${line} ${chunk}`;
      continue;
    }
    for (const w of chunk.split(" ")) {
      if (line !== indent && !room(line, w)) {
        out.push(line);
        line = indent;
      }
      line = line === indent ? line + w : `${line} ${w}`;
    }
  }
  out.push(line);
  return out;
}

/**
 * A CANDIDATE'S PLACES SPLIT BY RANK, for the list: one part per rank it holds,
 * best first, each with its places and its first location in the document's order. A rule that groups by project puts
 * every place of a tree into one candidate; the list shows its code part apart from its example data, so a call in
 * product code is not "1 of 228". The candidate stays one record and one unit of the AI review: only the listing splits.
 */
export interface EvidencePart {
  rank: EvidenceRank;
  places: number;
  first: { file: string; line: number };
}

export function evidencePartsOf(c: { locations?: readonly RankedLocation[] }): EvidencePart[] {
  const parts = new Map<EvidenceRank, EvidencePart>();
  for (const p of rankedPlacesOf(c)) {
    const had = parts.get(p.rank);
    if (had === undefined) parts.set(p.rank, { rank: p.rank, places: 1, first: { file: p.file, line: p.line } });
    else had.places++;
  }
  return [...parts.values()].sort((a, b) => a.rank - b.rank);
}

/** One part as the list words it: "3 in example data or templates, first at examples/tasks.json:4". */
export function evidencePartWords(p: EvidencePart, withFirst: boolean): string {
  return `${group(p.places)} ${evidenceWordsFor(p.rank, p.places)}${withFirst ? `, first at ${p.first.file}:${p.first.line}` : ""}`;
}

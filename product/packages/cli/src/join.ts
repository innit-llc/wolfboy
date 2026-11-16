/**
 * Non-redundancy join — did pillar 1 already say this?
 *
 * The most decisive column in the trial was "does the code scan already report this", because a
 * reconciliation finding that duplicates a detector candidate adds nothing however accurate it is.
 * The trial answered that column from memory and **got it wrong 2 times in 8**, both times in the
 * optimistic direction, and both were caught only by recomputing against the findings file. That
 * base rate is why this is a module and not an instruction.
 *
 * Two rules govern what it does, and the second one is the whole design:
 *
 * 1. **It annotates. It never suppresses.** Nothing is removed on the strength of an overlap. The
 *    agent (and the reader) get the overlapping rule's identity and its first context question and
 *    decide what the overlap means.
 * 2. **A shared line is not a duplicate.** `baseline-006` — "password or other secret sent in a URL
 *    query string" — fires on the *exact line* that sends a user's coordinates to a geocoding
 *    service in Germany. It is reading the API key in the query string; pillar 2 is reading the
 *    destination. Same line, unrelated questions. A suppressor keyed on line overlap would have
 *    deleted the finding the owner did not know about, which was the single most important result
 *    the trial produced.
 *
 * So `same_line` is reported as a flag on the annotation, not as a verdict, and the disposition
 * (`different-question` / `duplicate` / `related`) is set downstream by whoever can read both
 * questions.
 */


import type { Findings, Pillar1Overlap, Pillar1Status } from "wolfboy-schemas";
import { readFindingsText } from "./log-digest.js";
import { readRegularFile } from "./project-read.js";

export type { Pillar1Overlap, Pillar1Status };

export interface Pillar1Index {
  source: string;
  scan_id: string;
  target: string;
  /**
   * QUESTIONS, not rows of `findings.candidates`. A group the scanner split because it carried more
   * locations than one agent reads is one candidate emitted as several records, and counting the
   * records makes this number move on an unchanged repository the day the bound ships. `records`
   * below is the other number, kept beside it so the two can be reconciled rather than guessed at.
   */
  candidates: number;
  /** Rows of `findings.candidates`. Equal to `candidates` unless a group was split. */
  candidate_records: number;
  locations: number;
  byFile: Map<string, Map<string, { ref: Pillar1Overlap; lines: Set<number> }>>;
}

/**
 * Build the lookup from a pillar-1 findings file.
 *
 * Paths in `locations[].file` are relative to that scan's `target`, and a reconciliation run uses
 * the same relative form, so no path rewriting is needed — but the two targets are reported side
 * by side so a mismatch is visible rather than silently producing zero overlaps.
 */
export function loadPillar1Index(path: string): Pillar1Index {
  // A document changed after the scan is refused (log-digest.ts `readFindingsText`).
  const findings = JSON.parse(readFindingsText(path)) as Findings;
  const byFile: Pillar1Index["byFile"] = new Map();
  let locations = 0;

  // KEYED ON THE QUESTION, NOT ON THE ROW. Two parts of one split group are one candidate, and a
  // file whose locations straddle a part boundary would otherwise produce two overlap rows for one
  // rule, each carrying a fraction of `locations_in_file` — measured on the four re-scanned trees:
  // a handful of such files on each of four real trees. The reader of an
  // overlap is asking "does the code scan already report this rule here", which one row answers.
  // `finding_id` stays the id of a real candidate — the first part seen, which is part 1 because the
  // parts are adjacent and in order in the array — and `group_id` is added where the row covers more
  // than that one part, so nothing points at an id no candidate carries.
  const questions = new Set<string>();
  for (const candidate of findings.candidates ?? []) {
    const questionId = candidate.group_part?.group_id ?? candidate.finding_id;
    questions.add(questionId);
    for (const loc of candidate.locations ?? []) {
      locations++;
      const file = loc.file.replace(/\\/g, "/");
      let perFile = byFile.get(file);
      if (!perFile) {
        perFile = new Map();
        byFile.set(file, perFile);
      }
      let entry = perFile.get(questionId);
      if (!entry) {
        entry = {
          ref: {
            finding_id: candidate.finding_id,
            ...(candidate.group_part ? { group_id: candidate.group_part.group_id } : {}),
            rule_id: candidate.rule_id,
            title: candidate.title,
            first_context_question: candidate.context_questions?.[0],
            same_line: false,
            locations_in_file: 0,
            // THE QUALIFIER TRAVELS WITH THE CANDIDATE. Before 2026-08-27 a rule the ScanProfile
            // answered out of scope produced no candidate, so pillar 2 could never receive one; from
            // that date it can, and an overlap that arrives without this field tells the
            // declaration-reconcile agent that the code scan reports the construct here flatly, when
            // what the scan reports is a construct the person's own declaration says is not in this
            // product. Reproduced on one real tree: about 200 overlaps over 16 rules including `eu-dsa-001`
            // and `eu-dsa-002`, under `features.ugc: false`, with nothing in the object saying so.
            //
            // Copied verbatim and never recomputed: the candidate is the record, and re-evaluating
            // the profile here would be a forbidden second copy. It annotates and never
            // suppresses, like every other field on this object.
            ...((candidate.declared_inapplicable_preconditions ?? []).length > 0
              ? { declared_inapplicable_preconditions: [...(candidate.declared_inapplicable_preconditions ?? [])] }
              : {}),
          },
          lines: new Set<number>(),
        };
        perFile.set(questionId, entry);
      }
      entry.lines.add(loc.start_line);
      entry.ref.locations_in_file++;
    }
  }

  return {
    source: path,
    scan_id: findings.scan_id,
    target: findings.target,
    candidates: questions.size,
    candidate_records: (findings.candidates ?? []).length,
    locations,
    byFile,
  };
}

/** Pillar-1 candidates touching `file`, with `same_line` set against `line`. */
export function overlapsFor(index: Pillar1Index, file: string, line: number): Pillar1Overlap[] {
  const perFile = index.byFile.get(file.replace(/\\/g, "/"));
  if (!perFile) return [];
  return [...perFile.values()]
    .map(({ ref, lines }) => ({ ...ref, same_line: lines.has(line) }))
    .sort((a, b) => Number(b.same_line) - Number(a.same_line) || a.rule_id.localeCompare(b.rule_id));
}

export interface Locatable {
  file: string;
  line: number;
  pillar1_overlaps?: Pillar1Overlap[];
}

/**
 * Attach overlaps in place. Returns how many items got at least one.
 *
 * When the index exists, **every** item gets the field, empty array included. An absent field would
 * mean "the join did not run" and an empty one means "the join ran and found nothing", and the
 * first real agent run reported that it could not tell those apart — which is the same distinction
 * the skill's own first step insists on, failing one level down. A reader who cannot tell "we did
 * not check" from "there is nothing" has been given a number they cannot use.
 */
export function annotateLocatables(items: Locatable[], index: Pillar1Index | null): number {
  if (!index) return 0;
  let annotated = 0;
  for (const item of items) {
    const overlaps = overlapsFor(index, item.file, item.line);
    item.pillar1_overlaps = overlaps;
    if (overlaps.length > 0) annotated++;
  }
  return annotated;
}

export function statusOf(index: Pillar1Index | null, reason?: string): Pillar1Status {
  if (!index) {
    return {
      computed: false,
      reason: reason ?? "no pillar-1 findings file supplied (--findings); overlap with the code scan was not computed",
    };
  }
  return {
    computed: true,
    source: index.source,
    scan_id: index.scan_id,
    target: index.target,
    candidates: index.candidates,
    candidate_records: index.candidate_records,
    locations: index.locations,
  };
}

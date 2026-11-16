/**
 * A PLACE'S IDENTITY ACROSS RUNS (design rf13 3.2.1, "Unchanged: ... the same
 * places", "New or higher: ... or has a place it did not have"; 3.4, a decision holds while its kept places are the same).
 *
 * A place is one location, a file and a line; across runs it is the same place where its file and the text of its line
 * are the same, wherever the line has moved to (a line pushed down by an import above it is not a new place). Each
 * location of findings.json carries `line_key`, written by the scan from the line it read; a finding's place set is one
 * key per place, `<file>#<line_key>`, with `#<n>` added for the n-th (n >= 2) place of the same file and text, so two
 * equal lines in one file stay two places. The comparison's basis row (`place_keys`) and the log's `listed[].places`
 * both hold this set, from this one module, so "unchanged" and "the decision holds" read one identity.
 *
 * WHAT THE FINGERPRINT COVERS, exactly: the location's line text as the scan's matcher read it (trimmed and cut to 300
 * characters, `lineText`), passed through the rule the report and the log print by (credential-redaction.ts
 * `redactPrintedText`, baseline-002's clauses), then every program redaction marker (`PROGRAM_MARKER_RE`) replaced by the
 * fixed text `[redacted]`, then every run of white space made one space and the ends trimmed; its sha256 under the
 * prefix `place-text|`, the first 16 hex digits. So no credential's text and no marker's digest enters it: a change of
 * the marker's form or key moves no fingerprint, and the fingerprint holds nothing of a hidden value.
 *
 * No model runs here, and nothing here is a premise of a verdict (outside the verdict-rules closure).
 */

import { createHash } from "node:crypto";
import { PROGRAM_MARKER_RE, redactPrintedText, type PrintedRedaction } from "./credential-redaction.js";

/** What every program marker becomes before the fingerprint is taken. */
export const PLACE_TEXT_MARK = "[redacted]";
/** A location's `line_key`: 16 lower-case hex digits. */
export const LINE_KEY = /^[0-9a-f]{16}$/;

/** The fingerprint of one location's line text (`lineText` as the matcher read it). */
export function lineKeyOf(pr: PrintedRedaction, lineText: string): string {
  const text = redactPrintedText(pr, lineText)
    .replace(new RegExp(PROGRAM_MARKER_RE.source, "g"), PLACE_TEXT_MARK)
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(`place-text|${text}`).digest("hex").slice(0, 16);
}

/** One location as the set reads it. */
export interface KeyedLocation {
  file: string;
  start_line: number;
  line_key?: unknown;
}

/**
 * A finding's place set, sorted: one key per location, `<file>#<line_key>` (with `#<n>` for the n-th location of the
 * same file and text, in line order); a location with no `line_key` (a findings.json written before it) is
 * `<file>:<line>`, which is how a place was named before.
 */
export function placeSetOf(locations: readonly KeyedLocation[]): string[] {
  const ordered = [...locations].sort((x, y) => (x.file < y.file ? -1 : x.file > y.file ? 1 : x.start_line - y.start_line));
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (const l of ordered) {
    if (typeof l.line_key !== "string" || !LINE_KEY.test(l.line_key)) {
      out.push(`${l.file}:${l.start_line}`);
      continue;
    }
    const base = `${l.file}#${l.line_key}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.push(n === 1 ? base : `${base}#${n}`);
  }
  return [...new Set(out)].sort();
}

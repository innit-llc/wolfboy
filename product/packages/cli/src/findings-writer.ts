import { createHash, type Hash } from "node:crypto";
import { writeSync } from "node:fs";
import { openReplacement } from "./project-write.js";
import type { Candidate, Findings } from "wolfboy-schemas";

/** The indent unit `JSON.stringify(findings, null, 2)` used, and the one this file must match. */
const INDENT = "  ";

/**
 * Write `findings` to `outPath`, byte-identical to
 * `writeFileSync(outPath, JSON.stringify(findings, null, 2))`, without ever holding the whole
 * serialized document in memory at once.
 *
 * ## Why this exists
 *
 * `findings.candidates` carries one entry per fingerprint and nothing bounds how many fingerprints a
 * tree can raise — a tree dense enough with distinct matched lines (a machine-generated fixture
 * corpus, for instance) can push a single `JSON.stringify(findings, null, 2)` call past V8's maximum
 * string length, which throws `RangeError: Invalid string length` out of `JSON.stringify` itself,
 * AFTER detection has already finished successfully. Every other field in this document is bounded
 * by something that does not scale with the size of the scanned tree the same way
 * (`rules_without_candidates` by the bundle's own rule count, `excluded_by_walker` by directory, and
 * so on), so `candidates` is the only array streamed element by element here; every other top-level
 * field is written with a single `JSON.stringify` call exactly as it always was.
 *
 * ## How it stays byte-identical
 *
 * `JSON.stringify` walks a plain object's own enumerable keys in the same order `Object.keys` does,
 * so reading `Object.keys(findings)` here reproduces the exact key order `runScan` (scan.ts) built,
 * whatever that order is today or becomes later — this file does not hard-code a second copy of the
 * `Findings` field list for that order to drift against (never keep a second copy of
 * anything two places must agree on). Each `candidates` element is serialized on its own with plain
 * `JSON.stringify(candidate, null, 2)` — safe because every candidate is already bounded to at most
 * `MAX_LOCATIONS_PER_CANDIDATE` locations by `splitOversizedGroups` (scan.ts), so no single element
 * is itself a volume risk — and then re-indented to the depth it would have carried had the whole
 * document been produced by one `JSON.stringify` call. `reindentAllLines` and
 * `reindentContinuationLines` below are the two shapes that re-indenting takes: an array element
 * starts a fresh line of the document, so every one of its own lines shifts by the same amount;
 * an object property's value begins on the same line as its key, so only its SECOND line onward
 * shifts.
 *
 * ## What it does not do
 *
 * It never concatenates the array into one string before writing: each candidate's text is written
 * to the file descriptor and released before the next one is serialized, so memory use is bounded by
 * one candidate at a time rather than by the whole array.
 */
/** Where the document is written, and the sha256 of every byte written to it (the scan records it: log-digest.ts). */
type Sink = { fd: number; hash: Hash };

export function writeFindingsJson(outPath: string, findings: Findings): { sha256: string } {
  // A fresh file beside outPath, never through a link, renamed over it once whole (project-write.ts).
  const out = openReplacement(outPath);
  // The sha256 of the bytes as they are written, for the state folder.
  const fd: Sink = { fd: out.fd, hash: createHash("sha256") };
  let whole = false;
  try {
    // Mirrors JSON.stringify's own behaviour: an object property whose value is `undefined` is
    // omitted entirely rather than written as `null`. (`Findings` never actually has one at the top
    // level today — every optional field is left off the object rather than set to `undefined` — but
    // this keeps that true by construction instead of by accident.)
    const record = findings as unknown as Record<string, unknown>;
    const keys = Object.keys(findings).filter((k) => record[k] !== undefined);
    if (keys.length === 0) {
      writeChunk(fd, "{}");
      whole = true;
      return { sha256: fd.hash.digest("hex") };
    }
    writeChunk(fd, "{\n");
    keys.forEach((key, i) => {
      const value = record[key];
      writeChunk(fd, `${INDENT}${JSON.stringify(key)}: `);
      if (key === "candidates" && Array.isArray(value)) {
        writeCandidatesArray(fd, value as Candidate[]);
      } else {
        // Every other field ships whole inside the bundle or is small by construction (a roster
        // sized to the rule count, a handful of stats) — see the file header.
        writeChunk(fd, reindentContinuationLines(JSON.stringify(value, null, 2), 1));
      }
      writeChunk(fd, i < keys.length - 1 ? ",\n" : "\n");
    });
    writeChunk(fd, "}");
    whole = true;
  } finally {
    if (whole) out.commit();
    else out.abandon();
  }
  return { sha256: fd.hash.digest("hex") };
}

/** `candidates`, written one element at a time so the array is never assembled as one string. */
function writeCandidatesArray(fd: Sink, candidates: Candidate[]): void {
  if (candidates.length === 0) {
    writeChunk(fd, "[]");
    return;
  }
  writeChunk(fd, "[\n");
  candidates.forEach((c, i) => {
    writeChunk(fd, reindentAllLines(JSON.stringify(c, null, 2), 2));
    writeChunk(fd, i < candidates.length - 1 ? ",\n" : "\n");
  });
  writeChunk(fd, `${INDENT}]`);
}

/**
 * Shift every line of a standalone `JSON.stringify(value, null, 2)` result by `levels` indent
 * levels — for an array element, whose first line starts a fresh line of the document exactly like
 * every line after it.
 */
function reindentAllLines(text: string, levels: number): string {
  const prefix = INDENT.repeat(levels);
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}

/**
 * Shift every line of a standalone `JSON.stringify(value, null, 2)` result EXCEPT the first by
 * `levels` indent levels — for an object property's value, whose first line is written straight
 * after `"key": ` on the key's own line and so carries no indent of its own.
 */
function reindentContinuationLines(text: string, levels: number): string {
  const prefix = INDENT.repeat(levels);
  return text
    .split("\n")
    .map((line, i) => (i === 0 ? line : prefix + line))
    .join("\n");
}

/**
 * Write `text` to `fd` in full, looping on partial writes rather than assuming one syscall covers an
 * arbitrarily large chunk.
 */
function writeChunk(fd: Sink, text: string): void {
  const buf = Buffer.from(text, "utf8");
  fd.hash.update(buf);
  let offset = 0;
  while (offset < buf.length) {
    offset += writeSync(fd.fd, buf, offset, buf.length - offset);
  }
}

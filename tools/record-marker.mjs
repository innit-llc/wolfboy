/**
 * The citation marker: the one form in which a product, rule or tool file may cite the private record it was written
 * from (evaluation records and working documents), so the trail stays in the private original and never reaches a
 * public tree or a bundle.
 *
 *   ... the measured cost is lower.
 *
 * One form: ``, the citation holding no bracket (a marker that does is no marker, so the
 * reference in it stays visible to the self-scan), on one line or continued across the lines of one comment. The
 * projection (string values) and the export (every copied text file) remove each marker together with the space before
 * it, so the sentence around it must read without it. The self-scan fails a private reference anywhere outside a marker, and any marker
 * that survives into an exported tree. A marker belongs in a code comment, a schema description or a rule source's
 * note - never in a string the program prints, which carries plain public words instead.
 */
import { TEXT_OPENER, binaryOpenerForm } from "../product/packages/cli/scripts/marker-reading.mjs";
// What goes with a marker: the one space or tab before it; or, when it opens a comment line that follows a comment line
// of the same kind, the line break and the comment prefix before it (the text after it then continues the line above).
// The same kind: a // line after a // line; a * line after a * line of a block comment still open (holding no */). A
// line that opens a block comment (/*, /**) keeps its own line. A // line joined to a line that closes a block
// comment would carry its text out of the comment, into code.
// Each look back to the start of the line is tried only where a line break follows, (?=\n), which changes no match:
// the same alternative goes on to match that line break. Tried at every position, it read back to the start of the line
// each time, so the strip's cost grew with the square of a line's length: the export spent 18 minutes on it, nearly all
// on the one 271,178-character line of the compiled-in schemas, and two tests stripped long lines by a second, shorter
// pattern of their own, which could disagree with this one. With the guard the strip is linear and the only strip.
const LEAD = String.raw`(?:(?=\n)(?<=^[ \t]*\/\/[^\n]*)\n[ \t]*\/\/[ \t]*|(?=\n)(?<=^[ \t]*\*(?:(?!\*\/)[^\n])*)\n[ \t]*\*(?!\/)[ \t]*|[ \t])?`;
// The marker: on one line, or continued on up to six comment lines (each opening with * or //), holding no bracket.
// The opener is spelled in two pieces so this file, which the public tree carries, holds no marker of its own.
export const MARKER_OPEN = "[" + "record: ";
const BODY = String.raw`\[` + "record: " + String.raw`[^[\]\n]*(?:\n[ \t]*(?:\*(?!\/)|\/\/)[^[\]\n]*){0,6}\]`;
export const RECORD_MARKER_RE = new RegExp(LEAD + BODY, "gm");
// The opener's bracket, word and colon, with nothing after them yet: a text without it holds no marker, whole or broken.
const OPENER_ROOT = "[" + "record:";
// What a marker the strip cannot remove leaves behind: the opener's bracket, word and colon, followed by white space (a
// line break included) or by nothing at all - a marker broken right after its colon, after its opener, or across lines
// that are not comment lines, one holding a bracket, one nested in another. The one sign every reader of a surviving
// marker reads: stripRecordMarkersStrict below, and the self-scan's two readers (public-self-scan.mjs privateReferences,
// private-terms.mjs termReader). Without a g flag, so it keeps no position between calls.
// The pack's safeguard reads by the same object (product/packages/cli/scripts/marker-reading.mjs).
export const LEFTOVER_OPENER_RE = TEXT_OPENER;

/** The text with every marker removed, unchecked; not exported: every reader strips through stripRecordMarkersStrict. */
function removeRecordMarkers(text) {
  return text.replace(RECORD_MARKER_RE, "");
}

/**
 * The one strip, which every reader that strips a marker imports: the export, the projection and the bundle build
 * (through stripRecordMarkersInData), test:public-shipped-text and test:release-package. The text with every marker
 * removed; throws when LEFTOVER_OPENER_RE still finds an opener afterwards, so the reader stops rather than write a
 * citation out. A text that holds no opener is returned as it is.
 */
export function stripRecordMarkersStrict(text, label) {
  if (!text.includes(OPENER_ROOT)) return text;
  const out = removeRecordMarkers(text);
  const i = out.search(LEFTOVER_OPENER_RE);
  if (i >= 0) throw new Error(`${label}: a ${MARKER_OPEN}...] marker the strip could not remove (a bracket inside it, a nested marker, a break right after its colon or its opener, or a break onto a line that is not a comment): ${JSON.stringify(out.slice(i, i + 80))}`);
  return out;
}

/**
 * Null where a binary file's bytes hold no marker's opener in any encoding one could be written in - one byte a
 * character (UTF-8, Latin-1 and the like), UTF-16 or UTF-32 in either byte order, at any offset - else one sentence
 * naming the file. A binary cannot be rewritten without its markers,
 * so an opener found in one is refused, never copied; any opener counts, whatever follows it.
 */
export function binaryOpenerProblem(bytes, label) {
  const form = binaryOpenerForm(bytes);
  return form === null ? null : `${label}: a binary file holding a marker's opener in ${form}, which cannot be removed from it`;
}

/** How many markers the text holds. */
export function countRecordMarkers(text) {
  return (text.match(RECORD_MARKER_RE) ?? []).length;
}

/** The line with each marker blanked to spaces of the same length, so positions survive. */
export function maskRecordMarkers(line) {
  return line.replace(RECORD_MARKER_RE, (m) => " ".repeat(m.length));
}

/** Strip markers from every string value of parsed data, in place; returns how many were removed. */
export function stripRecordMarkersInData(value) {
  let n = 0;
  const walk = (v) => {
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        if (typeof v[i] === "string") {
          n += countRecordMarkers(v[i]);
          v[i] = stripRecordMarkersStrict(v[i], "a string value");
        } else walk(v[i]);
      }
    } else if (v && typeof v === "object") {
      for (const k of Object.keys(v)) {
        if (typeof v[k] === "string") {
          n += countRecordMarkers(v[k]);
          v[k] = stripRecordMarkersStrict(v[k], `the value of ${k}`);
        } else walk(v[k]);
      }
    }
  };
  walk(value);
  return n;
}

/**
 * Fields the product shows or asks exactly as written: a checklist's or a gate's question, the law's quoted words, their
 * article and citation, a rule's title and its remediation. A marker in one of them changes what the person reads or is
 * asked, so none may hold one: such a field carries plain public words only, as a printed string does.
 */
export const SHOWN_AS_IS = new Set(["question", "quote", "cite", "article", "title", "remediation_template"]);

/**
 * In data that ships, a marker holds a CITATION and nothing else: a pointer to a private record, never a sentence of its
 * own. Stripping a citation can then take nothing away that the reader of the field needs, whatever field it sits in.
 * History, reasons and corrections go in a YAML comment beside the field (a comment reaches neither a bundle nor the
 * public form); what the user or the agent needs goes in the field as plain public words.
 *
 * The shape: at most CITATION_MAX characters; parts separated by ", " or "; "; each part words separated by one space;
 * and every word one of: a date (2026-07-28 or 2026-07), a number (12, 12b, 4.9), a finding or note id (V10, F1, R2, m5),
 * a record id (capitals, possibly digits, a dash and digits: RK-4, M5-1), a commit id (7 to 40 hex digits), a path (one with a slash, or a
 * file name with a record extension), a part letter (A), or one of CITATION_WORDS (nouns naming a record or a part of one). There is no verb, so no sentence; no
 * question mark, no list enumerator, and no code or markup character. Examples: "decision, 2026-07-28"; "note R1,
 * 2026-10-07"; "commits 1234abc, 5678def"; "notes/x.md section 4.9".
 */
export const CITATION_MAX = 80;
export const CITATION_WORDS = new Set([
  "admissions", "appendix", "area", "assembly", "author", "batch", "brief", "briefs", "capture", "case", "cases",
  "chain", "check", "checker", "checks", "class", "commit", "commits", "coordinator", "correction", "corrections",
  "decision", "decisions", "design", "detection", "finding", "findings", "fix", "fixes", "guard", "hardening",
  "hooks", "incident", "independent", "integration", "item", "items", "launch", "legal", "list", "log", "merge",
  "note", "notes", "opt-in", "owner", "parent", "part", "plan", "point", "proposal", "question", "re-check",
  "recheck", "record", "records", "relay", "report", "review", "round", "rounds", "row", "rows", "rule", "ruling",
  "rulings", "run", "section", "sections", "slice", "step", "steps", "stop", "table", "unit", "units",
  "verification", "verifier", "wave",
]);
const CITATION_TOKENS = [
  /^\d{4}-\d{2}(?:-\d{2})?$/, // a date
  /^\d+[a-z]?(?:\.\d+[a-z]?)*$/, // a number: a brief, a run, a section
  /^(?:[A-Z]{1,3}\d{1,4}[a-z]?|[a-z]\d{1,4})$/, // a finding or note id (V10, F1, R2; m5: one lower-case letter, then digits only)
  /^[A-Z]{1,4}\d{0,3}-\d{1,4}[a-z]?$/, // a record id: capitals (and digits), a dash and digits
  /^[0-9a-f]{7,40}$/, // a commit id
  /^[\w.-]+(?:\/[\w.-]+)+\/?$/, // a path
  /^[\w-]+(?:\.[\w-]+)*\.(?:md|tsv|json|yaml|yml|txt|csv|log)$/, // a file name
  /^[A-Z]$/, // a part letter
];
const isCitationWord = (w) => CITATION_WORDS.has(w.toLowerCase()) || CITATION_TOKENS.some((re) => re.test(w));

/** The citation inside one matched marker (the text between the opener and the closing bracket), trimmed. */
export function markerBody(marker) {
  const m = marker.trim();
  return m.slice(MARKER_OPEN.length, -1).trim();
}

/** Why a marker's body is not a citation, or null when it is one. */
export function citationProblem(body) {
  const b = String(body);
  if (b.trim() === "") return "it is empty";
  if (b.includes("?")) return "it asks a question";
  if (/(?:^|\s)(?:\(?[a-z0-9]{1,2}\)|[-*+])\s/i.test(b) || /[\n\r]/.test(b)) return "it holds a list";
  if (/[`=<>{}()[\]\\"'*|$#~^&@!%]/.test(b)) return "it holds code or markup";
  if (b.length > CITATION_MAX) return `it is ${b.length} characters long, over the cap of ${CITATION_MAX}`;
  for (const part of b.split(/[,;] /)) {
    for (const w of part.split(" ")) {
      if (!isCitationWord(w)) return `it says something of its own: ${JSON.stringify(w.slice(0, 30))} is not a date, a number, an id, a commit, a path or a citation word`;
    }
  }
  return null;
}

/**
 * What stripping the markers would do to parsed data that ships (a rule, a checklist, a scope gate), as a list of
 * problems: a string the strip would leave blank, a marker in a field of SHOWN_AS_IS, and a marker that is not a
 * citation (citationProblem). A list item is judged by the key of the list that holds it. Empty when the data may ship.
 */
export function markerFieldProblems(value) {
  const problems = [];
  const walk = (v, path, key) => {
    if (typeof v === "string") {
      if (!v.includes(MARKER_OPEN)) return;
      if (SHOWN_AS_IS.has(key)) problems.push(`${path}: a ${MARKER_OPEN}...] marker in a field the product shows or asks as written`);
      if (v.trim() !== "" && removeRecordMarkers(v).trim() === "") problems.push(`${path}: stripping the record markers leaves it empty`);
      for (const m of v.matchAll(new RegExp(RECORD_MARKER_RE.source, RECORD_MARKER_RE.flags))) {
        const why = citationProblem(markerBody(m[0]));
        if (why) problems.push(`${path}: a ${MARKER_OPEN}...] marker that is not a citation (${why}); history, reasons and corrections go in a YAML comment beside the field, and what the reader needs goes in the field as plain words`);
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, key));
    else if (v && typeof v === "object") for (const k of Object.keys(v)) walk(v[k], path ? `${path}.${k}` : k, k);
  };
  walk(value, "", "");
  return problems;
}

/**
 * Why the markers of one exported text file are not all citations, one message per marker, naming its line: every
 * marker the export strips holds a citation and nothing else, whether it stands in a code comment, a JSON string,
 * Markdown or any other text, and it sits on one line. A JSON file is also read as data, so a string value the strip
 * would leave blank, or a marker in a field the product shows or asks as written, fails as it does in a rule.
 */
export function exportMarkerProblems(text, label) {
  const out = [];
  for (const m of String(text).matchAll(new RegExp(BODY, "g"))) {
    const why = citationProblem(m[0].slice(MARKER_OPEN.length, -1).trim());
    if (why) out.push(`${label}:${text.slice(0, m.index).split("\n").length}: a ${MARKER_OPEN}...] marker that is not a citation (${why})`);
  }
  if (/\.json$/i.test(label)) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
    if (data !== undefined) for (const p of markerFieldProblems(data)) if (!p.includes("is not a citation")) out.push(`${label}: ${p}`);
  }
  return out;
}

/** Strip the markers from parsed data that ships; throws, naming every problem, when markerFieldProblems finds any. */
export function stripShippedRecordMarkers(value) {
  const problems = markerFieldProblems(value);
  if (problems.length) throw new Error(`record markers: ${problems.join("; ")}`);
  return stripRecordMarkersInData(value);
}

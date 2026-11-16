/**
 * The pack's safeguard, as a check of contents: what scripts/pack-public-only.mjs refuses in the files a pack would ship
 * (prepack, before npm writes the tarball), and what scripts/release-pack.mjs refuses in the tarball npm wrote (after
 * the pack). One check, read by both, so the two cannot disagree. Importing it runs nothing.
 *
 * WHY THE TARBALL TOO.
 * `npm pack --ignore-scripts` still runs the package's `prepare` script (npm 10.9.3: a `prepare` that rewrote a shipped
 * file put its text into the tarball, `--dry-run` included). release-pack ran the safeguard last in prepack and then
 * `npm pack --ignore-scripts`, so a `prepare` could change the files after the safeguard had passed them. Checking the
 * artefact instead of its inputs closes the class: whatever npm or a script did before the tarball existed, the bytes
 * read are the bytes that would be published. release-pack imports this module before it runs any step of the package,
 * so a step that rewrites this file does not change the check.
 *
 * WHAT IS REFUSED: three signs the public form never carries, each by content, and anything it cannot read for them.
 * - A record marker, its opener followed by any white space or by nothing. The export removes every one and refuses a
 *   tree where one survives.
 * - A path into the private workspace's record folders: the evaluation folder as a path part (at the start, after a
 *   slash or backslash - so absolute, `./`, `../` and Windows paths too - or after a character no path holds, then a
 *   separator and a name), or the corpus cache's own name; never a word.
 * - `provenance`, the rule's authoring record, at any depth of any file of the bundle (a key of the parsed JSON; in a
 *   file that is not JSON, a quoted key and a colon), which the public projection drops.
 * - A file that is not UTF-8 text with no NUL, unless it is a binary the pack ships on purpose (`KNOWN_BINARY`: the
 *   grammars' WebAssembly modules), whose bytes are still read for the first two signs; and a file it cannot read at
 *   all (in a tarball: an entry that is not a regular file, or a tarball that cannot be read).
 * The words that would be refused are spelled in pieces below, so this file holds none of them.
 */
import { gunzipSync } from "node:zlib";
import { TEXT_OPENER, binaryOpenerForm, isWebAssembly, textOf } from "./marker-reading.mjs";

// A path into the record folders, read as pack-public-only.mjs read it before this module held the check.
const EVAL = "ev" + "al";
const RECORD_PATH = new RegExp(`(?:^|[\\\\/]|[^\\w.\\\\/-])${EVAL}[\\\\/]+[\\w.-]|\\.${"corpus"}-cache(?![\\w-])`, "m");
// The binaries the pack ships on purpose: the grammars this package's `files` lists, WebAssembly modules.
const KNOWN_BINARY = (rel, bytes) => /^grammars[\\/][^\\/]+\.wasm$/.test(rel) && isWebAssembly(bytes);

const countProvenance = (v) => {
  let n = 0;
  const visit = (x) => {
    if (Array.isArray(x)) x.forEach(visit);
    else if (x !== null && typeof x === "object") {
      for (const [k, y] of Object.entries(x)) {
        if (k === "provenance") n++;
        visit(y);
      }
    }
  };
  visit(v);
  return n;
};

/**
 * The refusals for `entries` (`{ rel, shown, bytes }`, or `{ rel, shown, error }` for one that cannot be read), each a
 * sentence; empty where every entry passes. `lead` begins each sentence and `ships` names where the files are
 * ("this package would ship", "the tarball npm wrote holds"); the sentences of the prepack step are unchanged.
 */
export function publicOnlyRefusals(entries, { lead = "pack: refusing to pack:", ships = "this package would ship" } = {}) {
  const unreadable = [];
  const marked = [];
  const pathed = [];
  const notText = [];
  const authoredIn = [];
  let authored = 0;
  for (const e of entries) {
    if (e.bytes === undefined) {
      unreadable.push(e);
      continue;
    }
    const { rel, bytes } = e;
    const text = textOf(bytes);
    if (text === null && !KNOWN_BINARY(rel, bytes)) notText.push(e);
    const read = text ?? bytes.toString("latin1");
    // A binary is read for a marker's opener in every form, followed by anything (a binary cannot be stripped).
    if (text !== null ? TEXT_OPENER.test(text) : binaryOpenerForm(bytes) !== null) marked.push(e);
    if (RECORD_PATH.test(read)) pathed.push(e);
    if (text !== null && rel.split(/[\\/]/)[0] === "bundle") {
      let n = 0;
      try {
        n = countProvenance(JSON.parse(text));
      } catch {
        n = /"provenance"\s*:/.test(text) ? 1 : 0;
      }
      if (n > 0) {
        authored += n;
        authoredIn.push(e);
      }
    }
  }
  const out = [];
  if (unreadable.length > 0) {
    out.push(`${lead} ${unreadable.length} file(s) or folder(s) ${ships} cannot be read (the first: ${unreadable[0].shown}, ${unreadable[0].error}), so what would ship cannot be checked.`);
  }
  if (notText.length > 0) {
    out.push(`${lead} ${notText.length} file(s) ${ships} are neither UTF-8 text nor a binary it ships on purpose (the first: ${notText[0].shown}), so this step cannot read them for the signs below.`);
  }
  if (marked.length > 0) {
    out.push(`${lead} ${marked.length} file(s) ${ships} hold a record marker (the first: ${marked[0].shown}), so this is the private source tree, and a release is packed only from the public export, which removes every marker.`);
  }
  if (pathed.length > 0) {
    out.push(`${lead} ${pathed.length} file(s) ${ships} name a path in the private workspace's record folders (the first: ${pathed[0].shown}), and a release ships only files of the public form, which names none.`);
  }
  if (authored > 0) {
    out.push(
      `${lead} the bundle ${ships} (${authoredIn[0].shown}${authoredIn.length > 1 ? ` and ${authoredIn.length - 1} more` : ""}) carries the authoring record (provenance) of ${authored} rule(s), so it was built from the private rule sources, and a release ships only the bundle built from the public form (the public export's own build).`,
    );
  }
  return out;
}

/**
 * The entries of an npm tarball (`gz`: the .tgz's bytes), each `{ rel, shown, bytes }` with `rel` its path inside the
 * package folder (`package/` taken off), or `{ rel, shown, error }` for an entry that is not a regular file. Reads the
 * ustar headers npm writes, with their `prefix` field and pax (`x`) and GNU long-name (`L`) records for long paths.
 * Throws where the bytes are not a gzip'd tar it can read.
 */
export function tarballEntries(gz) {
  const tar = gunzipSync(gz);
  const out = [];
  const str = (b, at, len) => {
    const s = b.subarray(at, at + len);
    const z = s.indexOf(0);
    return (z < 0 ? s : s.subarray(0, z)).toString("utf8");
  };
  let longName = null;
  for (let at = 0; at + 512 <= tar.length; ) {
    const h = tar.subarray(at, at + 512);
    if (h.every((b) => b === 0)) break;
    const size = Number.parseInt(str(h, 124, 12).trim() || "0", 8);
    if (!Number.isFinite(size) || size < 0) throw new Error(`a tar header at ${at} gives no size`);
    const type = String.fromCharCode(h[156] || 48);
    const body = tar.subarray(at + 512, at + 512 + size);
    if (body.length !== size) throw new Error(`the tar entry at ${at} is cut short`);
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === "x" || type === "L") {
      const text = body.toString("utf8");
      longName = type === "L" ? text.replace(/\0+$/, "") : (/(?:^|\n)\d+ path=([^\n]*)\n/.exec(text)?.[1] ?? longName);
      continue;
    }
    if (type === "g") continue;
    const prefix = str(h, 345, 155);
    const name = longName ?? (prefix !== "" ? `${prefix}/${str(h, 0, 100)}` : str(h, 0, 100));
    longName = null;
    const rel = name.replace(/^package\//, "");
    if (type === "5") continue;
    if (type === "0" || type === "7") out.push({ rel, shown: `package/${rel}`, bytes: Buffer.from(body) });
    else out.push({ rel, shown: `package/${rel}`, error: `a tar entry of type ${JSON.stringify(type)}, not a regular file` });
  }
  return out;
}

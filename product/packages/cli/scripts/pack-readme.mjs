#!/usr/bin/env node
/**
 * Put the repository's README into this package for `npm pack` / `npm publish`, as the npm page, and take it out again
 * after.
 *
 *   node scripts/pack-readme.mjs copy     (prepack, after pack-plugin.mjs copy)
 *   node scripts/pack-readme.mjs remove   (postpack, first)
 *
 * WHY. npm shows a package's README.md as its
 * page. Until 0.1.2 that was the plugin's README, copied with the plugin's other entries, so a visitor from npm met a
 * page about the AI review with no first step, no sample and no cost.
 * Since 0.1.2 the npm page is the same README as GitHub's: the repository's root README, one text, so there is no
 * second page to keep in agreement. pack-plugin.mjs no longer copies the plugin's README.md, which stays
 * in the repository (product/plugin/README.md).
 *
 * WHAT IS WRITTEN. The root README, three folders up (the public tree's root, where the export copies it unchanged),
 * with every relative link made absolute: an inline link `[text](target)` or a reference definition `[label]: target`
 * whose target has no scheme, does not start with `#` and is not `//...` becomes `<repository>/blob/main/<target>`,
 * where <repository> is package.json's `homepage` without its `#readme` (the one source of the address; GitHub sends a
 * folder's /blob/ address on to its /tree/ page). An anchor stays: it points into the page itself. Code is left as it
 * is (fenced blocks and inline code spans), and so are the line endings. Nothing else of the text changes.
 *
 * WHAT IS REFUSED, WITH NOTHING WRITTEN: a package folder that already holds a README.md this step did not write (the
 * package's own; overwriting it and then removing it would lose it); a root README that is missing; a relative image
 * (`![alt](file)`) or HTML attribute (`href=`, `src=`), which have no form here that would show on npm, so passing
 * them on would put a broken link or picture on the npm page; a homepage that is not a GitHub repository's address.
 *
 * WHAT `remove` DELETES: exactly the README.md `copy` wrote. `copy` first writes COPIED, holding the sha256 of the
 * README it is about to write; `remove` deletes README.md only where its bytes still have that digest (or it is gone),
 * then COPIED. A COPIED that is not such a record, or a README.md whose bytes changed after the copy, removes nothing and
 * stops the step in one sentence. A `copy` that finds a COPIED left by a pack that never reached its `remove` removes
 * that copy first.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(PKG, "..", "..", "..", "README.md");
const TARGET = join(PKG, "README.md");
const COPIED = join(PKG, ".pack-readme-copied.json");
const mode = process.argv[2];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const stop = (sentence) => {
  console.error(`pack-readme: ${sentence}`);
  process.exit(1);
};
/** The bytes of a regular file; undefined where nothing is there; null where something else is (a folder, a link). */
const fileBytes = (p) => {
  let st;
  try {
    st = lstatSync(p);
  } catch {
    return undefined;
  }
  return st.isFile() ? readFileSync(p) : null;
};

/** The digest COPIED records, or why COPIED is not the record this step writes. */
function copiedRecord() {
  let rec;
  try {
    rec = JSON.parse(readFileSync(COPIED, "utf8"));
  } catch {
    return { problem: "it is not JSON" };
  }
  if (rec === null || typeof rec !== "object" || Array.isArray(rec) || Object.keys(rec).join() !== "sha256" || !/^[0-9a-f]{64}$/.test(String(rec.sha256))) {
    return { problem: "it is not one sha256 digest" };
  }
  return { digest: rec.sha256 };
}

/** Remove what a `copy` wrote, as COPIED records it; a COPIED or a README.md this step cannot vouch for stops the step. */
function removeCopy() {
  if (fileBytes(COPIED) === undefined) return;
  const { digest, problem } = copiedRecord();
  if (problem !== undefined) stop(`${COPIED} is not the record this step writes (${problem}), so nothing was removed; delete it by hand once the package folder holds only its own files.`);
  const now = fileBytes(TARGET);
  if (now === null || (now !== undefined && sha256(now) !== digest)) {
    stop(`${TARGET} is not the README this step wrote (it changed after the copy), so nothing was removed; keep what you need of it, then delete it and ${COPIED} by hand.`);
  }
  rmSync(TARGET, { force: true });
  rmSync(COPIED, { force: true });
}

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const isRelative = (t) => t !== "" && !t.startsWith("#") && !t.startsWith("//") && !SCHEME.test(t);

/** A target written in angle brackets keeps them. */
const wrapLike = (written, to) => (written.startsWith("<") ? `<${to}>` : to);

/** A line split into its code spans and the text around them (a backtick run with no closing run of its length is text). */
function segments(line) {
  const out = [];
  let text = "";
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "`") {
      text += line[i++];
      continue;
    }
    let n = 0;
    while (line[i + n] === "`") n++;
    const run = "`".repeat(n);
    let j = i + n;
    let close = -1;
    while ((j = line.indexOf(run, j)) >= 0) {
      if (line[j + n] !== "`" && line[j - 1] !== "`") {
        close = j;
        break;
      }
      while (line[j] === "`") j++;
    }
    if (close < 0) {
      text += run;
      i += n;
      continue;
    }
    out.push({ code: false, text });
    text = "";
    out.push({ code: true, text: line.slice(i, close + n) });
    i = close + n;
  }
  out.push({ code: false, text });
  return out;
}

/** The README with its relative links made absolute under `blob`, the targets made so, and what refuses it. */
function absoluteLinks(readme, blob) {
  const made = [];
  const refused = [];
  const absolute = (t) => {
    made.push(t);
    return `${blob}${t.replace(/^\/+/, "")}`;
  };
  let fence = null;
  const lines = readme.split(/(?<=\n)/).map((piece) => {
    const end = /\r?\n$/.exec(piece)?.[0] ?? "";
    const line = piece.slice(0, piece.length - end.length);
    const opens = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      if (opens && opens[1][0] === fence[0] && opens[1].length >= fence.length && line.trim() === opens[1]) fence = null;
      return piece;
    }
    if (opens) {
      fence = opens[1];
      return piece;
    }
    // A reference definition; a footnote (`[^1]: text`) is not one.
    const definition = /^( {0,3}\[(?!\^)[^\]]+\]:[ \t]*)(<[^>]*>|\S+)(.*)$/.exec(line);
    if (definition) {
      const bare = definition[2].replace(/^<|>$/g, "");
      if (!isRelative(bare)) return piece;
      const to = wrapLike(definition[2], absolute(bare));
      return `${definition[1]}${to}${definition[3]}${end}`;
    }
    const written = segments(line)
      .map(({ code, text }) => {
        if (code) return text;
        for (const m of text.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]*)/g)) if (isRelative(m[1])) refused.push(`the image ${m[0]}...)`);
        for (const m of text.matchAll(/\b(?:href|src)\s*=\s*["']([^"']*)["']/gi)) if (isRelative(m[1])) refused.push(`the HTML attribute ${m[0]}`);
        return text.replace(/\]\(([ \t]*)(<[^>]*>|[^)\s]+)/g, (all, space, target) => {
          const bare = target.replace(/^<|>$/g, "");
          return isRelative(bare) ? `](${space}${wrapLike(target, absolute(bare))}` : all;
        });
      })
      .join("");
    return `${written}${end}`;
  });
  return { text: lines.join(""), made, refused };
}

if (mode === "remove") {
  removeCopy();
  process.exit(0);
}
if (mode !== "copy") stop("usage: pack-readme.mjs copy|remove");
removeCopy();
const own = fileBytes(TARGET);
if (own !== undefined) stop(`this package already holds ${TARGET}, which this step did not write; refusing to overwrite the package's own README (nothing was written).`);
const source = fileBytes(SOURCE);
if (source === undefined || source === null) stop(`there is no README at ${SOURCE}, the repository's root README this package's npm page is made from; nothing was written.`);
let homepage = "";
try {
  homepage = String(JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")).homepage ?? "");
} catch {
  // not read: the check below says so
}
const repository = /^(https:\/\/github\.com\/[^/#?\s]+\/[^/#?\s]+?)(?:#readme)?$/.exec(homepage)?.[1];
if (repository === undefined) stop(`package.json's homepage (${JSON.stringify(homepage)}) is not a GitHub repository's address, which the README's relative links are made absolute to; nothing was written.`);
const { text, made, refused } = absoluteLinks(source.toString("utf8"), `${repository}/blob/main/`);
if (refused.length > 0) stop(`${SOURCE} holds ${refused.length} relative link(s) this step cannot make absolute for the npm page (the first: ${refused[0]}); nothing was written.`);
const out = Buffer.from(text, "utf8");
writeFileSync(COPIED, `${JSON.stringify({ sha256: sha256(out) })}\n`);
writeFileSync(TARGET, out);
// stderr, not stdout: `npm pack --json` prints its JSON on stdout after the prepack scripts.
console.error(`pack-readme: the repository's README (${SOURCE}), ${made.length} relative link(s) made absolute under ${repository}/blob/main/ -> ${TARGET}`);

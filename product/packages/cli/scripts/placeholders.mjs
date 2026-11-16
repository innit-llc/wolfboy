#!/usr/bin/env node
/**
 * The placeholders that wait for a decision not made yet: one list, read by every step that can let them out. The
 * product's name is decided (WolfBoy; the npm package and the command `wolfboy`); the patterns of its old placeholders
 * stay on the list, so that one left behind is still found.
 *
 *   node scripts/placeholders.mjs (--tree <folder> | --tarball <file.tgz>) [--release]
 *
 * WHY ONE LIST. The public tree carries blanks for what is not decided yet: the product's name, its npm scope and
 * command, the repository and contact addresses, counsel's review, the plugin's author. Each was left visible on
 * purpose, and until this list nothing stopped a publish while one remained: the export printed some of them as rows
 * of its allow-list, and the pack printed none. The public export (run in the maintainers' private workspace) prints
 * every placeholder this list finds in the tree it writes and, with `--release`, refuses that tree; this script reads a
 * packed tarball or a folder the same way, so the release workflow can check the very tarball it publishes.
 *
 * The patterns are built from parts, so that this file holds none of the strings it looks for and reads clean.
 *
 * Without `--release` it prints what remains and exits 0; with it, it exits 1 while any remains. Exit 2: a usage error.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tarballEntries } from "./public-only-check.mjs";

const re = (...parts) => new RegExp(parts.join(""), "g");

/** Each placeholder: an id, the pattern, and what the decision, once made, puts in its place. */
export const PLACEHOLDERS = [
  { id: "owner-blank", re: re("\\[", "TB", "D\\b"), what: "an owner's blank (the bracketed TBD marker): a decision or a text not written yet" },
  { id: "reserved-host", re: re("\\b[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.inv", "alid\\b"), what: "a reserved placeholder host: the repository, a contact address or the schemas' address" },
  { id: "command-name", re: re("\\bprod", "uct-cli\\b"), what: "the command's placeholder name" },
  { id: "npm-scope", re: re("@prod", "uct/"), what: "the npm scope's placeholder" },
  { id: "root-package-name", re: re("\\btbd-prod", "uct-name\\b"), what: "the root package's placeholder name" },
  { id: "plugin-author", re: re('"found', 'er"'), what: "the placeholder author and owner of the plugin and its marketplace" },
  { id: "prototype-label", re: re("\\b(?:P0|early) proto", "type\\b"), what: "a prototype label the plugin manager or the command's help shows" },
];

/**
 * Every placeholder in `files` (`[{ rel, text }]`): `{ total, byId: { id: { what, lines, files: Set, where: [] } } }`,
 * `where` holding `rel:line` for each line, in file order.
 */
export function placeholderHits(files) {
  const byId = Object.fromEntries(PLACEHOLDERS.map((p) => [p.id, { what: p.what, lines: 0, files: new Set(), where: [] }]));
  let total = 0;
  for (const { rel, text } of files) {
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      for (const p of PLACEHOLDERS) {
        p.re.lastIndex = 0;
        if (!p.re.test(line)) continue;
        const b = byId[p.id];
        b.lines++;
        b.files.add(rel);
        b.where.push(`${rel}:${i + 1}`);
        total++;
      }
    });
  }
  return { total, byId };
}

/** The text files of a folder (`node_modules` and `.git` not walked; a file with a NUL in its first 8,000 bytes skipped). */
export function treeTexts(dir) {
  const out = [];
  const rec = (d) => {
    for (const name of readdirSync(join(dir, d)).sort()) {
      if (name === "node_modules" || name === ".git") continue;
      const rel = d ? `${d}/${name}` : name;
      const st = statSync(join(dir, rel));
      if (st.isDirectory()) rec(rel);
      else if (st.isFile()) {
        const buf = readFileSync(join(dir, rel));
        if (!buf.subarray(0, 8000).includes(0)) out.push({ rel, text: buf.toString("utf8") });
      }
    }
  };
  rec("");
  return out;
}

/** The lines a person reads: one per placeholder found, with its count and up to `show` places. */
export function placeholderReport({ total, byId }, show = 5) {
  const out = [`placeholders waiting for a decision: ${total} line(s)`];
  for (const [id, b] of Object.entries(byId)) {
    if (!b.lines) continue;
    out.push(`  ${String(b.lines).padStart(4)} line(s) in ${b.files.size} file(s)  ${id}: ${b.what}`);
    for (const w of b.where.slice(0, show)) out.push(`          ${w}`);
    if (b.where.length > show) out.push(`          ... ${b.where.length - show} more`);
  }
  return out;
}

function main(argv) {
  let tree = null;
  let tarball = null;
  let release = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--tree" && i + 1 < argv.length) tree = argv[++i];
    else if (argv[i] === "--tarball" && i + 1 < argv.length) tarball = argv[++i];
    else if (argv[i] === "--release") release = true;
    else {
      console.error(`placeholders: ${JSON.stringify(argv[i])} is not an option (--tree <folder>, --tarball <file.tgz>, --release)`);
      return 2;
    }
  }
  if ((tree === null) === (tarball === null)) {
    console.error("placeholders: give one of --tree <folder> or --tarball <file.tgz>");
    return 2;
  }
  const files =
    tree !== null
      ? treeTexts(resolve(tree))
      : tarballEntries(readFileSync(resolve(tarball)))
          .filter((e) => e.bytes && !e.bytes.subarray(0, 8000).includes(0))
          .map((e) => ({ rel: e.shown, text: e.bytes.toString("utf8") }));
  const hits = placeholderHits(files);
  for (const line of placeholderReport(hits)) console.log(line);
  if (release && hits.total > 0) {
    console.error(`placeholders: refused for a release: ${hits.total} placeholder line(s) remain; each waits for a decision.`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));

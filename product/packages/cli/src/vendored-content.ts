/**
 * VENDORED CODE BY WHAT THE FILE ITSELF CARRIES.
 *
 * The `vendored` read-scope class decides by path (rules/path-exclusions/vendored-code.yaml: folder names, tested for
 * another project's origin, and minified or bundled file names). A library copied anywhere else in a tree - an editor
 * library under a documentation site's scripts, with its author's banner on its first line - sat in no such folder and
 * was read as the product's own code, and the coverage block said nothing was held back. This module is the walker's
 * second test, beside the path one: what the file's own first and last bytes show. Three signs, each named in the walk's
 * record (`WalkResult.heldByContent`) with the evidence it found:
 *
 *   1. ANOTHER PROJECT'S BANNER: the file's first comment names a product with a version ("jQuery v3.5.1", "Bootstrap
 *      v4.0.0"), a product then a copyright ("SomeEditor, copyright (c) by ..."), or a product after `@license`
 *      ("@license Lodash"), and says copyright or licence somewhere in that comment. The project's own banner is not
 *      another project's: a name that is the project's own (its manifest's name, its folder's name) or a copyright
 *      holder named in the project's own licence file is the project's, and the file is read. Since the product the banner names must also
 *      be the file's own name or a folder's on its path (a copied library keeps its name), and a comment saying the file was
 *      modified or adapted from other code, or naming an "original copyright", marks a file the project derived and
 *      keeps as its own: both are read.
 *   2. A BUNDLER'S WRAPPER at the head: a UMD factory, a webpack, browserify or Parcel runtime, a bundler's pointer to
 *      its licence file. Written by a tool around code that was assembled, never source a person edits.
 *   3. A SOURCE-MAP TRAILER at the end of a JavaScript or CSS file (`//# sourceMappingURL=`): the mark of built output.
 *
 * A bare `Copyright 2024 <holder>` or a licence header with no product name (the house header many projects put on
 * every file) is not a sign: it names no other project, and a guard on it would hold back whole projects.
 */
import { basename, join } from "node:path";
import { readRegularFile } from "./project-read.js";

/** How many bytes of a file's head the test reads (the walker's binary sniff already reads them). */
export const CONTENT_HEAD_BYTES = 4096;
/** How many bytes of a JavaScript or CSS file's end the source-map test reads. */
export const CONTENT_TAIL_BYTES = 512;
/** The files whose last bytes are read: the formats a source-map comment is defined for. */
export const TAIL_READ = /\.(?:js|mjs|cjs|css)$/i;

/** What the project calls itself, folded: its manifest names, its folder's name, the holders its own licence names. */
export interface OwnNames {
  names: Set<string>;
  holders: Set<string>;
}

const fold = (s: string): string => s.toLowerCase().replace(/\.js$/, "").replace(/[^a-z0-9]+/g, "");

/** Words that name no one: a holder made only of these is no holder. */
const NOT_A_HOLDER = new Set(
  (
    "and others other contributors contributor authors author the inc llc ltd limited corp corporation company gmbh foundation " +
    "software project projects team all rights reserved copyright licensed license licence under its affiliates by with for of"
  ).split(" "),
);
/** Words a banner's first word can be that name no product. */
const NOT_A_NAME = new Set(
  (
    "copyright licensed license licence spdx version the this that author authors python node nodejs java php ruby go golang " +
    "typescript javascript ecmascript es html css utf iso rfc http https mit apache bsd gpl lgpl agpl mpl isc generated auto " +
    "do note see file module package source code part based from release build revision rev v " +
    // Licence families written as an
    // acronym before their version ("CC BY-SA 4.0", "EPL 2.0"): a licence, not a product.
    "cc epl eupl cddl osl afl"
  ).split(" "),
);

function holderWords(text: string): string[] {
  const out: string[] = [];
  const re = /(?:copyright|\(c\)|\u00a9)\s*(?:\(c\)|\u00a9)?\s*(?:\d{4}(?:\s*[-,]\s*\d{4})*\s*)?(?:by\s+)?([^\n|*]{0,80})/gi;
  for (const m of text.matchAll(re)) {
    for (const w of (m[1] ?? "").toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 3 && !NOT_A_HOLDER.has(w) && !/^\d+$/.test(w)) out.push(w);
  }
  return out;
}

function readSmall(path: string): string | null {
  try {
    const b = readRegularFile(path);
    return b.length > 256 * 1024 ? b.subarray(0, 256 * 1024).toString("utf8") : b.toString("utf8");
  } catch {
    return null;
  }
}

/**
 * The project's own names, read once per walk from the scan root: `package.json` and `composer.json` names, a
 * `pyproject.toml` or `Cargo.toml` `name`, the root folder's own name, and the holders the root licence files name in
 * their first 60 lines (a licence file that goes on to list bundled libraries names them further down).
 */
export function ownNamesOf(root: string): OwnNames {
  const names = new Set<string>();
  const holders = new Set<string>();
  const add = (n: unknown) => {
    if (typeof n !== "string") return;
    for (const part of n.split("/")) {
      const f = fold(part.replace(/^@/, ""));
      if (f.length >= 2) names.add(f);
    }
  };
  add(basename(root));
  for (const manifest of ["package.json", "composer.json"]) {
    const t = readSmall(join(root, manifest));
    if (t === null) continue;
    try {
      add((JSON.parse(t) as { name?: unknown }).name);
    } catch {
      /* not JSON: no name from it */
    }
  }
  for (const manifest of ["pyproject.toml", "Cargo.toml"]) {
    const t = readSmall(join(root, manifest));
    const m = t?.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
    if (m) add(m[1]);
  }
  for (const lic of ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "LICENCE.md", "COPYING", "COPYING.md"]) {
    const t = readSmall(join(root, lic));
    if (t === null) continue;
    // Only the lines that open with a copyright mark: a licence's own text ("the copyright owner or entity authorized")
    // names no holder.
    const lines = t.split(/\r?\n/).slice(0, 60).filter((l) => /^\s*(?:copyright\s*(?:\(c\)|\u00a9)?|\(c\)|\u00a9)\s*\d{4}|^\s*copyright\s*(?:\(c\)|\u00a9)/i.test(l));
    for (const w of holderWords(lines.join("\n"))) holders.add(w);
  }
  return { names, holders };
}

/** The file's first comment, each line without its comment marks, at most 12 lines. */
function firstComment(text: string): string[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  let i = 0;
  if ((lines[0] ?? "").startsWith("#!")) i++;
  while (i < lines.length && (lines[i] ?? "").trim() === "") i++;
  const first = (lines[i] ?? "").trimStart();
  const raw: string[] = [];
  if (first.startsWith("/*")) {
    for (let k = i; k < Math.min(lines.length, i + 12); k++) {
      raw.push(lines[k] ?? "");
      if ((lines[k] ?? "").includes("*/")) break;
    }
  } else {
    const mark = first.startsWith("//") ? "//" : first.startsWith("#") ? "#" : null;
    if (mark === null) return [];
    for (let k = i; k < Math.min(lines.length, i + 12) && (lines[k] ?? "").trimStart().startsWith(mark); k++) raw.push(lines[k] ?? "");
  }
  return raw.map((l) => l.replace(/^\s*(?:\/\*+!?|\/\/+!?|\*+(?!\/)|#+)\s*/, "").replace(/\*+\/\s*$/, "").trim()).filter((l) => l !== "");
}

const NAME = "([A-Za-z][\\w.+-]*(?:\\s[A-Z][\\w.+-]*)?)";
const NAME_VERSION = new RegExp(`^(?:@license\\s+)?${NAME}\\s+v?\\d+\\.\\d+(?:\\.\\d+)?\\b`);
// Case-sensitive, so NAME's second word is a
// capitalised one: with the `i` flag "Original copyright:" read as a product named "Original copyright". The word
// "copyright" itself is spelt in its three cases.
const NAME_COPYRIGHT = new RegExp(`^${NAME}\\s*[,:-]\\s*(?:[Cc]opyright\\b|COPYRIGHT\\b|\\([Cc]\\)|\\u00a9)`);
/**
 * A comment that says the file was modified, adapted or ported from other
 * code, or names an original copyright, is the mark of a file the project derived and keeps as its own: read.
 */
const DERIVED = /\b(?:modified|adapted|derived|ported|forked)\s+(?:code\s+)?from\b|\boriginal(?:ly)?\s+(?:copyright|code|author|source|work)\b|\bbased\s+on\s+(?:code|work)\b/i;
/** The suffixes a copied library's file name carries after its product's name: a version, a build kind, a format. */
const FILE_NAME_SUFFIXES = /(?:[.-](?:min|bundle|umd|esm|cjs|full|slim|prod|production|dev|development|pack|packed|core|all|browser|global|dist))+$|[.-]v?\d+(?:\.\d+)*$/i;

/**
 * Whether the product a banner names is the file's own name, or the name of a
 * folder on its way from the scan root (a library's modes, add-ons and chunks keep the library's folder, not its name):
 * `chart.js` and "Chart.js", `body-scroll-lock.js` and "tua-body-scroll-lock", `jquery-3.7.1.min.js` and "jQuery".
 * A copied library keeps its name; a file of the product's own that opens with an older or a borrowed banner (an event
 * emitter copied into the top of a product's embed loader, a colour formula citing its standard's version) does not.
 * One folded name holds the other, the shorter of four characters or more.
 */
function namesAgree(product: string, fileName: string, folderPath: string): boolean {
  const p = fold(product);
  if (p.length === 0) return false;
  const agree = (n: string): boolean => {
    let f = n.replace(/\.[^.]+$/, "");
    for (let k = 0; k < 4; k++) {
      const next = f.replace(FILE_NAME_SUFFIXES, "");
      if (next === f) break;
      f = next;
    }
    const g = fold(f);
    const [short, long] = g.length <= p.length ? [g, p] : [p, g];
    return short.length >= 4 && long.includes(short);
  };
  return agree(fileName) || folderPath.split("/").some((seg) => seg !== "" && agree(seg));
}
const SAYS_LICENCE = /\(c\)|\u00a9|copyright|licen[cs]e|@preserve/i;

/** Sign 1: the product another project's banner names, or null. */
function foreignBanner(text: string, own: OwnNames, fileName: string, folderPath: string): string | null {
  const comment = firstComment(text);
  if (comment.length === 0) return null;
  const whole = comment.join("\n");
  if (!SAYS_LICENCE.test(whole)) return null;
  if (DERIVED.test(whole)) return null;
  for (const line of comment.slice(0, 8)) {
    // A bare `@license <word>` is a licence's
    // name or a project's own edition marker ("@license Enterprise", on every file of one corpus tree's own code), so it is
    // no sign by itself; a product after `@license` WITH a version is still NAME_VERSION's.
    const m = line.match(NAME_VERSION) ?? line.match(NAME_COPYRIGHT);
    if (!m) continue;
    const name = (m[1] ?? "").trim();
    // An SPDX tag ("SPDX-FileCopyrightText: Copyright ...", a REUSE-style header) names a holder, not a product.
    if (/^spdx/i.test(name)) continue;
    const first = fold(name.split(/\s/)[0] ?? "");
    if (first === "" || NOT_A_NAME.has(first) || NOT_A_NAME.has(name.toLowerCase().split(/\s/)[0] ?? "")) continue;
    // A name holding the word licence is a
    // licence's own name, wrapped onto the line with its version ("Public License 2.0" under "...the terms of the
    // Eclipse"): the first version of this test read it as another project's banner and held back most of one corpus
    // tree's own source, whose every file carries that header.
    if (/licen[cs]e/i.test(name)) continue;
    if (own.names.has(fold(name)) || own.names.has(first)) return null;
    // The holder is the project itself: a holder the root licence names, or one of the project's own names (its
    // manifest name or its folder's), so "Copyright (c) 2023 <Project> Team" is the project's own banner.
    if (holderWords(whole).some((w) => own.holders.has(w) || own.names.has(w))) return null;
    // Another project's file carries that project's name.
    if (!namesAgree(name, fileName, folderPath)) continue;
    return `another project's banner at its head ("${line.length > 80 ? `${line.slice(0, 77)}...` : line}")`;
  }
  return null;
}

/** Sign 2: a bundler's wrapper in the head, or null. */
const WRAPPERS: readonly [RegExp, string][] = [
  [/typeof\s+exports\s*={2,3}\s*['"]object['"]\s*&&\s*typeof\s+module\s*!={1,2}\s*['"]undefined['"]|['"]object['"]\s*={2,3}\s*typeof\s+exports\s*&&\s*['"]undefined['"]\s*!={1,2}\s*typeof\s+module/, "a UMD library wrapper at its head"],
  // Anchored at the file's start: a project's own code that mentions webpack's runtime (a debug helper hooking its
  // require, a component naming a chunk) is not a bundle.
  [/^\s*\/\*{6}\/\s|^\s*(?:["']use strict["'];?\s*)?\(\s*(?:self|window|this|globalThis)\s*(?:\.\s*|\[\s*["'])webpack(?:Chunk|Jsonp)|^\s*(?:["']use strict["'];?\s*)?\(\s*\(\s*\)\s*=>\s*\{\s*(?:\/\/\s*webpackBootstrap|(?:var|const|let)\s+__webpack_modules__)/, "a webpack runtime at its head"],
  [/^\s*(?:require\s*=\s*)?\(function\s*\(\)\s*\{\s*function\s+r\(e,\s*n,\s*t\)|^\s*require\s*=\s*\(function\s+e\(t,\s*n,\s*r\)/, "a browserify runtime at its head"],
  [/^\s*(?:var\s+)?parcelRequire\s*=|\$parcel\$global\b/, "a Parcel runtime at its head"],
  [/\/\*!\s*For license information please see\s+\S+\.LICENSE\.txt\s*\*\//, "a bundler's pointer to its licence file at its head"],
];

/** Sign 3: a source-map trailer. */
const SOURCE_MAP_TRAILER = /[#@]\s*sourceMappingURL\s*=\s*[^\s*]+\s*(?:\*\/)?\s*$/;

/**
 * Whether a file's own bytes show it to be vendored code, and the evidence; null where they do not. `head` is the
 * file's first bytes (CONTENT_HEAD_BYTES), `tail` its last ones where it is a JavaScript or CSS file longer than its head.
 */
export function vendoredByContent(name: string, head: Uint8Array, tail: Uint8Array | undefined, own: OwnNames, folderPath = ""): string | null {
  const text = Buffer.from(head).toString("utf8");
  const opening = text.slice(0, 2048);
  for (const [re, words] of WRAPPERS) if (re.test(opening)) return words;
  const banner = foreignBanner(text, own, name, folderPath);
  if (banner !== null) return banner;
  if (TAIL_READ.test(name)) {
    const end = tail === undefined ? text : Buffer.from(tail).toString("utf8");
    if (SOURCE_MAP_TRAILER.test(end)) return "a source-map trailer at its end";
  }
  return null;
}

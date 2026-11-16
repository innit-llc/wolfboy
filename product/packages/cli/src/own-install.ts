/**
 * THE PROGRAM NEVER COUNTS ITS OWN FILES AS THE PROJECT'S.
 *
 * Until npm carries the package, a team runs the rules check from a second checkout of this repository inside its job's
 * workspace. Checked out at `wolfboy/`, the natural choice, a push counted this repository's own rules, tools and
 * sources: 8,564 places on a tree whose own code held 16, and a minute instead of a second. A rule bundle named by
 * `--bundle` in a folder the walk reads is the same class: its rules' words would be read as the project's.
 *
 * NOTHING IS LEFT UNREAD TO FIX IT. Leaving the folder out of the walk would be a narrowing decided by the program; the
 * scan is refused instead, before anything is read, with the folder named and the two places that work: a folder whose
 * name starts with a dot (the walk never reads one, `walk.ts` `folderKind`), or outside the scanned folder. A program
 * whose folder IS the scanned folder (this repository scanning itself) or holds it (a scan of one of its fixtures) is
 * not refused: the folder is then the project. A folder the walk never enters by its name alone (`node_modules`, `dist`,
 * `.git`, a hidden folder) holds it safely, so an `npm install` into the project is not refused.
 */
import { realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { programFolder } from "./bundle.js";
import { relativePath } from "./project-path.js";
import { folderKind } from "./walk.js";

const real = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

/** The kinds of folder the walk never enters, whatever the options (`walk.ts` `folderKind`). */
const NEVER_ENTERED = new Set(["git", "generated", "hidden"]);

/**
 * The first of this program's folders that the scan of `target` would read, with its path relative to `target`, or null.
 * `bundleDir` is the folder of the rule bundle the scan runs, which `--bundle` or `LEGAL_BUNDLE_DIR` may put anywhere.
 */
export function ownFilesInsideTarget(target: string, bundleDir: string): { rel: string; what: "program" | "bundle" } | null {
  const root = real(target);
  const candidates: Array<{ dir: string; what: "program" | "bundle" }> = [
    { dir: real(programFolder()), what: "program" },
    { dir: real(bundleDir), what: "bundle" },
  ];
  for (const c of candidates) {
    const rel = relativePath(root, c.dir);
    if (rel === "" || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) continue;
    if (rel.split("/").some((name) => NEVER_ENTERED.has(folderKind(name) ?? ""))) continue;
    return { rel, what: c.what };
  }
  return null;
}

/** The refusal, one plain sentence on stderr, exit 1. */
export function ownFilesRefusal(found: { rel: string; what: "program" | "bundle" }): string {
  const which = found.what === "program" ? "this program's own files" : "the rule bundle this scan runs";
  return (
    `The folder this scan reads holds ${which} at ${found.rel}/, and they would be counted as this project's code. ` +
    "Put them where the scan does not read: in a folder whose name starts with a dot (for example .wolfboy), or outside the folder you scan. Nothing was scanned."
  );
}

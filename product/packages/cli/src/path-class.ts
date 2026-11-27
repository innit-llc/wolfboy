/**
 * EVERY SCANNED PATH'S CLASS, ONE FUNCTION.
 * Documentation sites and vendored code are not read by default; example data,
 * templates, translation catalogues and CI files are read, and listed last. Both need one answer to "where does this
 * place sit", given to every place a scan reports (`locations[].path_class` in findings.json) and to nothing else.
 *
 * ONE SOURCE. Which class is made of what, and in which order a path is tested, is tools/shared-path-exclusions.mjs
 * `PATH_CLASS_SOURCES`; the build writes it into the bundle's read-scope.json as `path_classes`, and this module reads
 * only that. A read-scope class is named there by its id and tested here with that class's own compiled patterns
 * (read-scope.ts), so "held back as vendored" and "classed vendored" cannot disagree: a folder named like vendored code
 * that the walker read because nothing in it showed another project's code is masked here exactly as it is there, and
 * a file the walker found vendored by its content (vendored-content.ts) is vendored here. A path no class names is
 * `code`.
 *
 * A PATH CLASS IS WHERE A FILE SITS, NEVER WHAT IT IS FOR. It orders and labels what was read; it removes nothing,
 * and every place keeps reaching the AI review whatever its class.
 */
import { ClearedFolders, NAME_NOMINATED_CLASSES, type PathClassSource, type ReadDespiteName, type ReadScope } from "./read-scope.js";

/** Every class a place can carry, in the order the findings schema's enum lists them (a test pins the two together). */
export const PATH_CLASS_IDS = ["code", "config", "example-data", "template", "translation", "ci", "prose", "asset", "docs", "vendored", "test", "build"] as const;
export type PathClass = (typeof PATH_CLASS_IDS)[number];

const KNOWN: ReadonlySet<string> = new Set(PATH_CLASS_IDS);

interface Compiled {
  id: PathClass;
  test: (relPath: string) => boolean;
}

/**
 * The classifier of one run: the bundle's path classes, the run's read scope (whose classes it tests with their own
 * compiled patterns), the folders the walker read despite their name, and the files it found vendored by content.
 */
export function pathClassifier(input: {
  pathClasses: readonly PathClassSource[] | undefined;
  scope: ReadScope;
  readDespiteName?: readonly ReadDespiteName[];
  vendoredByContent?: readonly string[];
}): (relPath: string) => PathClass {
  const cleared = new ClearedFolders();
  for (const r of input.readDespiteName ?? []) cleared.add(r.dir.replace(/\\/g, "/"));
  const byContent = new Set(input.vendoredByContent ?? []);
  const compiled: Compiled[] = [];
  for (const pc of input.pathClasses ?? []) {
    if (!KNOWN.has(pc.id)) continue;
    const id = pc.id as PathClass;
    if ("read_scope" in pc) {
      const cls = input.scope.classes.find((c) => c.id === pc.read_scope);
      if (cls === undefined) continue;
      // The read scope's own test: a class a folder name only nominates (vendored code, and from documentation sites) is tested with the
      // cleared folders masked, so a `docs` folder the walker read as the product's own is `code` here, in every run.
      const masked = NAME_NOMINATED_CLASSES.has(pc.read_scope) && cleared.size > 0;
      compiled.push({
        id,
        test: (p) => {
          const tested = masked ? cleared.mask(p) : p;
          return cls.compiled.some((re) => re.test(tested));
        },
      });
      continue;
    }
    const res = pc.patterns.map((p) => new RegExp(p));
    compiled.push({ id, test: (p) => res.some((re) => re.test(p)) });
  }
  const memo = new Map<string, PathClass>();
  return (relPath: string): PathClass => {
    const p = relPath.replace(/\\/g, "/");
    const had = memo.get(p);
    if (had !== undefined) return had;
    let got: PathClass = byContent.has(p) ? "vendored" : "code";
    if (got === "code") for (const c of compiled) if (c.test(p)) {
      got = c.id;
      break;
    }
    memo.set(p, got);
    return got;
  };
}

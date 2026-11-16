/**
 * WHAT `.legal/` HOLDS, AND WHAT MAY BE DELETED.
 *
 * Kept apart from legal-dir.ts on purpose: legal-dir.ts is one of the verdict rules' sources (`VERDICT_RULES_SOURCES`,
 * pinned by test:verdict-rules-version), and nothing here decides what a verdict may be. Imported by the assembly
 * (assemble-report.ts writes the README with the report) and by the `tidy` command (explain.ts); never by a hook or the capture.
 */
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { EVIDENCE_DIR_NAME, EVIDENCE_LOG_NAME } from "./legal-dir.js";
import { createExclusive } from "./program-file.js";
import { relativePath } from "./project-path.js";
import { readRegularFile } from "./project-read.js";
/**
 * `.legal/README.txt`, written where the
 * assembly writes the report, only where there is none (one already there is the person's): what to keep (the reviews, which the next scan reuses, and the
 * answers), what may be deleted (the folders an earlier scan set aside, which no step reads), and Docker, which reads no
 * nested ignore file. git ignores it (legal-dir.ts's `.gitignore` is an allow-list); the seats' Grep does not see it (`.ignore`).
 */
export const LEGAL_README_FILE = "README.txt";
export const LEGAL_README_TEXT = [
  "Written by the compliance scanner: what this folder holds, and what you may delete.",
  "",
  "Keep:",
  "- evidence/ : your reviews, one log per finished AI review. The next scan reuses each",
  "  unchanged answer of the latest one instead of paying for it again. Deleting a log loses",
  "  that review: the next scan judges every place again, at the full price.",
  "- profile.json and profile-record.json : your answers about the product (commit both).",
  "",
  "You may delete:",
  "- set-aside-<time>/ : working files an earlier scan moved aside before it started. No later",
  "  step reads them, and a later scan's carry never does: it reads evidence/ only.",
  "  `wolfboy tidy` (in Claude Code, the plugin's `legal-scan tidy`) lists them with their sizes",
  "  and prints the command that deletes them; it deletes nothing itself.",
  "Delete nothing else here while a scan is running.",
  "",
  "Many files here hold lines of this repository's code in clear, including lines from files",
  "git ignores (such as .env). git ignores this folder, but Docker reads only the .dockerignore",
  "of its build context: where a Dockerfile copies the whole folder (COPY . .), add the line",
  ".legal to .dockerignore.",
  "",
].join("\n");

const SET_ASIDE_NAME = /^set-aside-[0-9A-Za-z._-]+$/;
const DOCKERFILE_NAME = /^(Dockerfile|Containerfile)([._-].*)?$|\.(Dockerfile|Containerfile)$/i;

/**
 * Where the scanned folder has a Dockerfile at its root and the root's
 * `.dockerignore` does not exclude `.legal`, one line saying so; null otherwise. A `.dockerignore` line excludes it when,
 * without a leading `/` or a trailing `/` or `/**`, it is `.legal`, `**\/.legal`, `.*` or `*`, and no later `!` line takes
 * `.legal` back. Read through the project reader (a link or a non-regular file is not read: the line is then said).
 */
export function dockerIgnoreGap(target: string): string | null {
  let names: string[];
  try {
    names = readdirSync(target);
  } catch {
    return null;
  }
  const docker = names.filter((n) => DOCKERFILE_NAME.test(n)).sort()[0];
  if (!docker) return null;
  let text = "";
  try {
    text = readRegularFile(join(target, ".dockerignore")).toString("utf8");
  } catch {
    text = "";
  }
  let excluded = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const back = line.startsWith("!");
    const p = (back ? line.slice(1) : line).trim().replace(/^\/+/, "").replace(/\/(\*\*)?$/, "");
    if (p === ".legal" || p === "**/.legal" || (!back && (p === ".*" || p === "*"))) excluded = !back;
  }
  return excluded ? null : `Docker: this folder has ${docker} and its .dockerignore does not exclude .legal/, so a build that copies the whole folder (COPY . .) puts the scan's files, which hold lines of your code in clear, into the image. Add the line .legal to .dockerignore.`;
}

/** A folder's size in bytes, its links not followed; null where it cannot be read. */
function folderBytes(dir: string): number | null {
  let total = 0;
  const stack = [dir];
  try {
    while (stack.length > 0) {
      const d = stack.pop() as string;
      for (const n of readdirSync(d)) {
        const st = lstatSync(join(d, n));
        if (st.isDirectory()) stack.push(join(d, n));
        else total += st.size;
      }
    }
  } catch {
    return null;
  }
  return total;
}

const sizeWords = (b: number | null): string => (b === null ? "size not known" : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} kB`);

/**
 * The `tidy` command's lines: what in
 * `<target>/.legal` to keep (the reviews under evidence/, with their count and size) and the folders set aside by earlier
 * scans, each with its size, then the command that deletes them, for the person to run themselves. It deletes nothing and
 * never lists evidence/: no paid review can be lost by it. A set-aside entry that is not a plain folder is not listed.
 */
export function legalTidyLines(target: string, cwd: string, platform: NodeJS.Platform = process.platform): string[] {
  const legal = join(resolve(target), ".legal");
  const shown = (p: string): string => relativePath(cwd, p) || p;
  if (!existsSync(legal)) return [`No .legal folder in ${shown(resolve(target))}: nothing to tidy.`];
  const names = ((): string[] => {
    try {
      return readdirSync(legal).sort();
    } catch {
      return [];
    }
  })();
  const isDir = (p: string): boolean => {
    try {
      return lstatSync(p).isDirectory();
    } catch {
      return false;
    }
  };
  const out: string[] = [];
  const ev = join(legal, EVIDENCE_DIR_NAME);
  const logs = isDir(ev) ? ((): string[] => { try { return readdirSync(ev).filter((n) => EVIDENCE_LOG_NAME.test(n)); } catch { return []; } })() : [];
  out.push(
    logs.length > 0
      ? `Keep ${shown(ev)}: ${logs.length} ${logs.length === 1 ? "review" : "reviews"} (${sizeWords(folderBytes(ev))}). The next scan reuses each unchanged answer of the latest one; deleting a log loses that review, and the next scan judges every place again, at the full price.`
      : `No review is kept in ${shown(ev)} yet.`,
  );
  const aside = names.filter((n) => SET_ASIDE_NAME.test(n) && isDir(join(legal, n)));
  if (aside.length === 0) out.push("Nothing to tidy: no folder set aside by an earlier scan.");
  else {
    const sizes = aside.map((n) => folderBytes(join(legal, n)));
    const all = sizes.every((s) => s !== null) ? sizes.reduce<number>((a, s) => a + (s ?? 0), 0) : null;
    out.push(`May be deleted: ${aside.length} ${aside.length === 1 ? "folder" : "folders"} an earlier scan set aside before it started (${sizeWords(all)} in all). No later step reads them:`);
    aside.forEach((n, i) => out.push(`  ${shown(join(legal, n))}  (${sizeWords(sizes[i] ?? null)})`));
    const paths = aside.map((n) => `'${shown(join(legal, n))}'`).join(" ");
    out.push("This command deletes nothing. To delete them, run this in your own terminal:");
    out.push(platform === "win32" ? `  Remove-Item -Recurse -Force -LiteralPath ${aside.map((n) => `'${shown(join(legal, n))}'`).join(", ")}` : `  rm -rf -- ${paths}`);
  }
  const docker = dockerIgnoreGap(resolve(target));
  if (docker) out.push(docker);
  return out;
}

/** Writes `.legal/README.txt` where the folder exists and holds none; returns whether it wrote it. Never creates `.legal`. */
export function writeLegalReadme(legalDir: string): boolean {
  try {
    if (!lstatSync(legalDir).isDirectory()) return false;
  } catch {
    return false;
  }
  return createExclusive(join(legalDir, LEGAL_README_FILE), LEGAL_README_TEXT);
}

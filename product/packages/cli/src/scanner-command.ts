/**
 * A command of the scanner as a person or the orchestrator can run it, as written (
 * a resume command was shown as `<plugin>/bin/legal-scan ...` and the abort command as a bare
 * `legal-scan ...`, which no shell finds). The plugin's own `bin/legal-scan` where this program is the plugin's
 * (`pluginLauncher`); else this very program, by the Node.js that runs it and the absolute path of the CLI's `index.js`
 * beside this file - the same form `legal-scan session`'s own command line takes (scan-profile.ts `sessionCommand`).
 * Never a placeholder and never a bare name.
 *
 * FROM THE FILE SYSTEM, NEVER FROM A VARIABLE.
 * The plugin and its launcher are found from this file's own place, as bin/node-choice.bash finds this program
 * from the launcher's own place, read backwards; no environment variable takes part. Until this change the launcher was
 * named from CLAUDE_PLUGIN_ROOT, which Claude Code does not set for a Bash-tool command, so a value there came from a
 * project's settings (or the parent shell): pointed into the project, it made the pre-launch step tell the orchestrator
 * to run `<project>/bin/legal-scan launch-next ...`, and the abort command likewise.
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StartupRefusal } from "./startup-refusal.js";
import { readRegularFile } from "./project-read.js";

const real = (p: string): string | null => {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
};
const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** This CLI's own package folder: the parent of the `dist` this file is in, by its real path. */
export function ownPackage(): string {
  const self = fileURLToPath(import.meta.url);
  return join(dirname(real(self) ?? resolve(self)), "..");
}

/**
 * The plugin this program belongs to, by its real path, or null: bin/node-choice.bash's rule for the program, read
 * backwards from this package (`pkg`, by default this file's own).
 * - An installed plugin is this package: the npm package carries the plugin's files at its root, so its folder holds
 *   `.claude-plugin/plugin.json` beside `package.json` and `dist/`.
 * - The source checkout keeps the two apart: the plugin is `product/plugin`, beside `product/packages/cli`, holding
 *   `.claude-plugin/plugin.json` and no `package.json` of its own (one that held a package.json would run its own
 *   program), and its `../packages/cli` must be this very package.
 * Null where neither holds: a copy of `dist/` alone, or a build run outside any plugin.
 */
export function ownPlugin(pkg: string = ownPackage()): string | null {
  const here = real(pkg);
  if (here === null) return null;
  if (isFile(join(here, ".claude-plugin", "plugin.json"))) return here;
  const beside = real(join(here, "..", "..", "plugin"));
  if (beside === null || !isFile(join(beside, ".claude-plugin", "plugin.json")) || existsSync(join(beside, "package.json"))) return null;
  return real(join(beside, "..", "packages", "cli")) === here ? beside : null;
}

/** The plugin's launcher, `bin/legal-scan` of `ownPlugin`, by its full path; null where there is no such file. */
export function pluginLauncher(plugin: string | null = ownPlugin()): string | null {
  if (plugin === null) return null;
  const launcher = join(plugin, "bin", "legal-scan");
  return isFile(launcher) ? launcher : null;
}

/**
 * THE ONE WRITER OF TOLD COMMANDS, AND ITS READER. Every word of a
 * told command - the program's own path and every value - is written as one POSIX shell word in single quotes, each
 * `'` inside it written `'\''` (`shellWord`); only a word made of lower-case letters and dashes alone (a command name
 * such as `run-abort`, a flag such as `--launch-dir`, or `--`), which holds no character a shell gives a meaning to,
 * is written bare, so the person reads `run-abort --launch-dir '<folder>'`. Inside single quotes a POSIX shell gives no
 * character a meaning, so a path whose folder names hold `$(...)`, a backtick, `"`, `\`, `!`, `*`, a new line or a
 * leading `-` reaches the program as itself and runs nothing. Until this change the words were put in double quotes
 * unescaped, where a project folder named `$(...)` or with a backtick ran that command when the orchestrator ran a
 * told command, and a `"` or a trailing `\` broke it. The
 * words are given as a list, never as a command line, so no caller can put a value into a command unquoted.
 */
export function shellWord(word: string): string {
  return `'${word.replaceAll("'", "'\\''")}'`;
}

/** A word with no character a shell gives a meaning to, written bare: a command name, a flag, or `--`. */
const INERT_WORD = /^(?:(?:--?)?[a-z][a-z-]*|--)$/;

/**
 * TOLD TEXT IS BASH TEXT. A told command is run by Claude Code's Bash tool,
 * which is bash on every platform (Git Bash on native Windows), or by a person, told to run it in bash; the launcher it
 * names is itself a bash script. So every told word is written in a form bash reads as itself, and dash (POSIX sh) reads
 * the same. No one form runs in PowerShell, bash and dash alike (`& '<path>' ...`, the one form PowerShell runs, is a
 * syntax error in bash and dash), so told text does not try to run in PowerShell; what it keeps there is that nothing
 * runs: a told scanner command starts with its quoted launcher path, which PowerShell reads as an expression followed
 * by a stray word, a parse error that runs nothing, and a told fragment that starts with a bare word (`rm -r <path>`,
 * `pass --launch-dir <folder>`) holds only quoted words PowerShell also reads as themselves. Earlier a value was
 * written `'...'\''...'`, which PowerShell reads as the end of the word: a folder named `x'; 7*6; 'y` ran `7*6` there. Every told value comes from the environment (the launcher's own path is
 * under the person's home folder in all 18 `scannerCommand` sites), so each word is written in one of two forms, or
 * refused:
 * - `'<value>'` where the value holds no single quote (`'`, nor U+2018-U+201B, which PowerShell also takes as one):
 *   inside single quotes no character has a meaning to bash, dash or PowerShell;
 * - else `"<value>"` where it holds none of `$`, a backtick, `"` (nor U+201C-U+201E, PowerShell's other double quotes)
 *   or `!` (history in an interactive bash), and every `\` in it is followed by another character than `\`: inside
 *   double quotes bash and dash keep a `\` as itself except before `$`, a backtick, `"`, `\` or a new line (bash
 *   manual, "Double Quotes"; POSIX 2.2.3), and PowerShell keeps it everywhere, so a launcher under a Windows profile
 *   folder whose name holds `'` (a path such as `D:\O'Brien\x`) is told; an earlier form refused every `\` here, so
 *   such a person was told no command at all;
 * - else, or where the value holds a character that is not a letter, mark, number, punctuation, symbol or space
 *   (a control character, a new line, a direction override, a format character, which can also make a terminal show
 *   other text than it runs), nothing is told: `ToldValueRefused`, one sentence at the program's boundary.
 * `toldCommandWords` reads exactly these forms back. `shellWord` stays the POSIX writer of the SessionStart environment
 * file, which only bash reads.
 */
const TOLD_CHARS = /^[\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}]*$/u;
const SINGLE_QUOTES = /['\u2018-\u201B]/u;
const DOUBLE_QUOTE_SIGNS = /[$`"!\u201C-\u201E]/u;
/** A `\` bash's double quotes would not keep as itself: the last character (it would quote the closing `"`), or before `\`. */
const DOUBLE_QUOTE_BACKSLASH = /\\(?:\\|$)/u;

/** Said where a person is told a command to run: told text is bash text. */
export const IN_BASH = "in bash (on Windows, Git Bash)";

/** A value no told form keeps as itself in bash; the program's boundary prints its sentence (exit 1). */
export class ToldValueRefused extends StartupRefusal {
  constructor(readonly value: string) {
    super(
      `legal-scan: a command this program was about to tell you to run in bash names a value that no form of quoting it writes keeps as itself, so it stopped without telling it: ${visibleValue(value)}. Rename the folder, or give a value, with no control or direction character, and with no single quote where it also holds one of $ \` " ! or a backslash that is doubled or last.`,
    );
    this.name = "ToldValueRefused";
  }
}

/** The value with every character outside `TOLD_CHARS` and every `"`/`\\` written as an escape, so a refusal shows what it names. */
function visibleValue(value: string): string {
  let out = "";
  for (const c of value) out += TOLD_CHARS.test(c) && c !== '"' && c !== "\\" ? c : `\\u{${(c.codePointAt(0) ?? 0).toString(16)}}`;
  return `"${out}"`;
}

/** One quoted word of told text, in the form bash reads as itself, or `ToldValueRefused`. */
export function toldQuoted(w: string): string {
  if (!TOLD_CHARS.test(w)) throw new ToldValueRefused(w);
  if (!SINGLE_QUOTES.test(w)) return `'${w}'`;
  if (!DOUBLE_QUOTE_SIGNS.test(w) && !DOUBLE_QUOTE_BACKSLASH.test(w)) return `"${w}"`;
  throw new ToldValueRefused(w);
}

/** One word of told command text, as `scannerCommand` writes it: bare where inert, else quoted by `toldQuoted`. */
const toldWord = (w: string): string => (INERT_WORD.test(w) ? w : toldQuoted(w));

export function scannerCommand(args: readonly string[], launcher: string | null = pluginLauncher()): string {
  const program = launcher !== null ? [launcher] : [process.execPath, join(dirname(resolve(fileURLToPath(import.meta.url))), "index.js")];
  return [...program, ...args].map(toldWord).join(" ");
}

/**
 * THE COMMAND A PERSON TYPES IN THEIR OWN TERMINAL. `scannerCommand` names this
 * program by its full path, which is right for a command Claude Code's Bash tool runs and for a person who runs the
 * plugin's launcher. For a person who ran `npx wolfboy@<version> scan`, that path is a folder inside npm's cache
 * (`<cache>/_npx/<hash>/node_modules/wolfboy/bin/legal-scan`), which they never typed and which npm may delete. So, read
 * from the file system as `scannerCommand` reads it:
 * - where this package sits in npm's `_npx` cache, the person ran it through `npx`: `npx <name>@<version>`, the name and
 *   version from this package's own package.json, then `personArgs`;
 * - else where the program's name on `PATH` resolves to this very program (a global install, by its real path), the bare
 *   name, then `personArgs`; checked after the cache, because `npx` puts its own `.bin` folder on `PATH` while it runs;
 * - else `scannerCommand(args)`, as before.
 * `personArgs` are the words the person's form needs (the bare `scan` reads the folder it runs in and writes under
 * `.legal/`); they are told words like any other. Only person-facing lines call this: a command Claude Code runs keeps the
 * full path, so a project's own `node_modules` can never answer for this program there.
 */
export function personCommand(args: readonly string[], personArgs: readonly string[], pkg: string = ownPackage(), pathList: string = process.env["PATH"] ?? ""): string {
  const here = real(pkg);
  const manifest = here === null ? null : readManifest(join(here, "package.json"));
  if (here !== null && manifest !== null) {
    const parts = here.split(/[\\/]+/);
    const n = parts.length;
    const spec = `${manifest.name}@${manifest.version}`;
    if (n >= 4 && parts[n - 4] === "_npx" && parts[n - 2] === "node_modules" && parts[n - 1] === manifest.name && NPM_SPEC.test(spec)) {
      return ["npx", spec, ...personArgs.map(toldWord)].join(" ");
    }
    const self = real(join(here, manifest.bin));
    if (self !== null && BIN_NAME.test(manifest.binName) && onPath(manifest.binName, self, pathList)) return [manifest.binName, ...personArgs.map(toldWord)].join(" ");
  }
  return scannerCommand(args);
}

/** A package spec written bare: an npm name and an exact version, no character a shell gives a meaning to. */
const NPM_SPEC = /^[a-z0-9][a-z0-9._-]*@[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/;
/** A program name written bare. */
const BIN_NAME = /^[a-z][a-z0-9-]*$/;

/** This package's name, version and one program (`bin`), or null where package.json does not say them. */
function readManifest(path: string): { name: string; version: string; binName: string; bin: string } | null {
  try {
    const pkg = JSON.parse(readFileSync(path, "utf8")) as { name?: unknown; version?: unknown; bin?: unknown };
    if (typeof pkg.name !== "string" || typeof pkg.version !== "string") return null;
    const bins: Array<[string, unknown]> = typeof pkg.bin === "string" ? [[pkg.name, pkg.bin]] : pkg.bin && typeof pkg.bin === "object" ? Object.entries(pkg.bin as Record<string, unknown>) : [];
    const only = bins.length === 1 ? bins[0]! : null;
    if (only === null || typeof only[1] !== "string") return null;
    return { name: pkg.name, version: pkg.version, binName: only[0], bin: only[1] };
  } catch {
    return null;
  }
}

/**
 * Whether `name`, looked up on `pathList` as a shell would, is this program (`self`, a real path): the first file of that
 * name on it whose real path is `self` (npm's link on POSIX), or on Windows npm's `<name>.cmd` shim whose
 * `node_modules\...\*.js` target is `self`.
 */
function onPath(name: string, self: string, pathList: string): boolean {
  for (const dir of pathList.split(delimiter)) {
    if (dir === "") continue;
    const file = join(dir, name);
    if (isFile(file)) return real(file) === self;
    if (process.platform === "win32" && isFile(`${file}.cmd`)) {
      try {
        // A folder on PATH may be anyone's (a project's own .bin among them): read without blocking, regular files only.
        const m = /%dp0%\\(node_modules\\[^"\r\n]+?\.js)"/i.exec(readRegularFile(`${file}.cmd`, "utf8"));
        return m !== null && real(join(dir, ...m[1]!.split("\\"))) === self;
      } catch {
        return false;
      }
    }
  }
  return false;
}

/**
 * TOLD ARGUMENT FRAGMENTS. Words a refusal tells the orchestrator or
 * the person to add to a command (`pass --launch-dir <folder>`, `add -- --resume <id>`), or a command of another
 * program it tells them to run (`rm -r <path>`), written word by word exactly as `scannerCommand` writes its words. Until
 * this change such fragments put the value into the text by hand, unquoted: a project folder named with `$(...)` or a
 * backtick ran that command when the fragment was composed into a command as written, and a folder name with a space
 * split into two words. So no told text puts a value next to a
 * shell word anywhere but here.
 */
export function toldArgs(args: readonly string[]): string {
  return args.map(toldWord).join(" ");
}

/** A word of an older told command that a shell reads as itself, unquoted: no character with a meaning to the shell. */
const PLAIN_WORD = /^[A-Za-z0-9_@%+=:,./-]$/;

/**
 * The words a POSIX shell passes for `command`, read without a shell, or null where reading them would need one.
 * Read: single-quoted text (every character as itself), `\'` between quoted parts (the `'` that `shellWord` writes),
 * double-quoted text - the form `toldQuoted` writes for a value holding `'`, and the form of a command written before
 * every told command took this one - and plain words, but only where the shell would read them as themselves:
 * double-quoted text holding no `$` or backtick, and no `\` that is last or followed by `\`, `$`, a backtick, `"` or
 * a new line (elsewhere bash and dash keep `\` as itself in double quotes: a Windows path such as
 * `"D:\O'Brien\x"`), and plain characters from `PLAIN_WORD`'s set.
 * Anything else - a `$`, a backtick, a glob character, `;`, `|`, `&`, a redirection, an unquoted new line, a backslash
 * outside quotes anywhere but before `'` - is refused, never guessed: the shell would expand or run it, and the reader
 * would read other words than the shell does. So a command this function
 * reads names, for each word, exactly what the shell would have passed, and a command it cannot read that way is
 * not read at all.
 */
export function toldCommandWords(command: string): string[] | null {
  const words: string[] = [];
  let i = 0;
  const n = command.length;
  while (i < n) {
    while (i < n && (command[i] === " " || command[i] === "\t")) i++;
    if (i >= n) break;
    let word = "";
    while (i < n && command[i] !== " " && command[i] !== "\t") {
      const c = command[i] as string;
      if (c === "'") {
        const end = command.indexOf("'", i + 1);
        if (end < 0) return null;
        word += command.slice(i + 1, end);
        i = end + 1;
      } else if (c === "\\") {
        if (command[i + 1] !== "'") return null;
        word += "'";
        i += 2;
      } else if (c === '"') {
        const end = command.indexOf('"', i + 1);
        if (end < 0) return null;
        const inner = command.slice(i + 1, end);
        if (/[$`]/.test(inner) || /\\(?:[\\$`"\n]|$)/.test(inner)) return null;
        word += inner;
        i = end + 1;
      } else if (PLAIN_WORD.test(c)) {
        word += c;
        i++;
      } else return null;
    }
    words.push(word);
  }
  return words;
}

/**
 * THE ONE READING OF A STORED FOLD COMMAND'S SHAPE, for both of its readers (`toldFoldCommand` here and hook-capture.ts
 * `runFoldCommand`):
 * where `verdict-reading` stands in `words`, or -1 where they are not a legal-scan verdict-reading command. It stands
 * second, after the launcher (`<plugin>/bin/legal-scan`, or a bare `legal-scan` in a launch list written before told
 * commands took their form), or third, after a Node and the CLI's `index.js`. The launcher's path is written with the
 * platform's separator (`join`), so on native Windows it ends `\legal-scan`: until this change both readers matched
 * `/` alone, and there every auto-mode receipt said the fold "is not a legal-scan verdict-reading command", wrote no
 * fold, and told the person to end the run and scan again.
 */
export function verdictReadingAt(words: readonly string[]): number {
  const at = words.indexOf("verdict-reading");
  if (at === 2 || (at === 1 && /(?:^|[\\/])legal-scan$/.test(words[0] ?? ""))) return at;
  return -1;
}

/**
 * A verdict seat's fold command, as this version tells it, from the command a launch list stored. The
 * stored string is data, never a command passed on as stored: its words are read (`toldCommandWords`) and
 * `verdict-reading` and the words after it are written again by `scannerCommand`, with this program's own launcher. So a
 * launch list written by an earlier version - a bare `legal-scan verdict-reading ...`, or one with double-quoted paths -
 * is told in this version's form, and one whose words a shell would expand (its project folder's name holds a `$`, a backtick or a
 * backslash) is not told at all: null, and the caller says why.
 */
export function toldFoldCommand(stored: string): string | null {
  const words = toldCommandWords(stored);
  if (words === null) return null;
  const at = verdictReadingAt(words);
  if (at < 0) return null;
  try {
    return scannerCommand(words.slice(at));
  } catch (e) {
    if (e instanceof ToldValueRefused) return null;
    throw e;
  }
}

/**
 * Said where a stored fold command is not told (`toldFoldCommand` null). A launch list this version writes is always
 * told (its fold command is `scannerCommand`'s, which `toldCommandWords` reads back, and `verdictReadingAt` reads its
 * launcher on every platform), so what is left is a launch list another version wrote, or one changed since. Until
 * this change the sentence said why as a fact (its folder names hold characters a shell would expand), which on native
 * Windows was not the reason.
 */
export const FOLD_NOT_TOLD =
  "this launch list's fold command is not in a form this version writes and reads back (another version wrote it, or it was changed since), so it is not shown and not run; end the run and scan again with this version";

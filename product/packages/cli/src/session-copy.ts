/**
 * WHICH COPY OF THE PROGRAM STARTS THE SCAN'S SESSION, AND THE SHORT COMMAND.
 *
 * Every scan conversation is started by `session`, from the person's own terminal. Told by the plugin, that command is the
 * launcher's full path inside Claude Code's plugin cache, and the path names the plugin's version, so a saved command goes
 * stale at the next update. The short command is this program installed once as an npm global (`npm install -g
 * <package>@<the plugin's version>`), after which `<bin> session` works in any terminal, PowerShell included (npm's own
 * shim runs it with Node). Two things keep that from undoing the design:
 *
 * - The installed plugin's copy is the one that matches the plugin's hooks. A global copy of another version would start
 *   a session whose profile the plugin's SessionStart hook may not recognise, so `session` reads which copy Claude Code
 *   runs (`claude plugin list --json`, the same listing the plugin's README already names; it makes no model call) and,
 *   where the versions differ, says so and starts the session through the plugin's own copy (`<installPath>/dist/index.js`,
 *   the package's own program, as the plugin's launcher runs it) with the same arguments. Nothing is installed or updated
 *   for the person: the line names the command that makes the two match.
 * - The offer of the short command is printed only by the plugin's own copy, and only while no command of that name is on
 *   PATH, so it is said until the person takes it and never after.
 *
 * The package's name, its bin and the plugin's name are read from the program's own package.json and plugin manifest,
 * never written here: no second copy of a name.
 */
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { toldArgs } from "./scanner-command.js";

/** One entry of `claude plugin list --json` (fields as Claude Code 2.1 prints them: id, version, enabled, installPath). */
export interface PluginEntry {
  id: string;
  version: string | null;
  enabled: boolean;
  installPath: string;
}

/** The entries of the listing for the plugin named `name` (an id `<name>@<marketplace>`); an unreadable listing gives none. */
export function pluginEntriesOf(listed: unknown, name: string): PluginEntry[] {
  if (!Array.isArray(listed)) return [];
  const out: PluginEntry[] = [];
  for (const e of listed) {
    if (e === null || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.installPath !== "string" || r.id.split("@")[0] !== name) continue;
    out.push({ id: r.id, version: typeof r.version === "string" ? r.version : null, enabled: r.enabled !== false, installPath: r.installPath });
  }
  return out;
}

/** This package's own name, first bin and version, from its package.json; null where it cannot be read. */
export interface OwnPackageFacts {
  name: string;
  bin: string | null;
  version: string | null;
}
export function ownPackageFacts(pkgDir: string): OwnPackageFacts | null {
  try {
    const d = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as Record<string, unknown>;
    if (typeof d.name !== "string") return null;
    const bin = typeof d.bin === "object" && d.bin !== null ? (Object.keys(d.bin)[0] ?? null) : null;
    return { name: d.name, bin, version: typeof d.version === "string" ? d.version : null };
  } catch {
    return null;
  }
}

/** The plugin's name from its manifest (`.claude-plugin/plugin.json`), or null. */
export function pluginNameOf(pluginDir: string): string | null {
  try {
    const d = JSON.parse(readFileSync(join(pluginDir, ".claude-plugin", "plugin.json"), "utf8")) as Record<string, unknown>;
    return typeof d.name === "string" && d.name !== "" ? d.name : null;
  } catch {
    return null;
  }
}

const realOr = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

export type SessionCopy =
  /** This program is the installed plugin's copy; `offer` is the short command's line where no such command is on PATH. */
  | { kind: "plugin-copy"; offer: string | null }
  /** Another copy (an npm global, a build) of the plugin's version: it starts the session itself. */
  | { kind: "same" }
  /** Another copy of another version: the plugin's own copy starts the session; `line` says so. */
  | { kind: "plugin-instead"; entry: PluginEntry; line: string }
  /** The plugin is not in the listing, or the listing could not be read: the session starts as it is; `line` says why, or null. */
  | { kind: "unchecked"; line: string | null };

export interface SessionCopyInput {
  /** This program's plugin folder (scanner-command.ts `ownPlugin`), or null. */
  mine: string | null;
  own: OwnPackageFacts | null;
  pluginName: string | null;
  /** The listing's entries for the plugin; null where `claude plugin list --json` did not run or printed no JSON. */
  entries: PluginEntry[] | null;
  /** Whether a command named as this package's bin is on PATH (outside the folder the session starts in). */
  shortOnPath: boolean;
}

/**
 * A told command, written word by word by the one writer of told
 * commands (scanner-command.ts `toldArgs`), or null where a word holds a value no told form keeps as itself: the package
 * name, the bin and the version come from package.json and Claude Code's listing, so they are values, never put into
 * the text by hand (test:skill-cli-names T5c). Null drops the told command from the line; it never stops the session.
 */
function toldOrNull(words: readonly string[]): string | null {
  try {
    return toldArgs(words);
  } catch {
    return null;
  }
}

/** The command that installs this package at `version` as an npm global, as told text, or null. */
export function installCommand(own: OwnPackageFacts, version: string): string | null {
  return toldOrNull(["npm", "install", "-g", `${own.name}@${version}`]);
}

/** The short command's offer, printed by the plugin's own copy; null where no part of it can be told. */
export function shortCommandOffer(own: OwnPackageFacts, version: string): string | null {
  const install = installCommand(own, version);
  const start = own.bin === null ? null : toldOrNull([own.bin, "session"]);
  if (install === null || start === null) return null;
  return (
    `  Next time, a short command: run  ${install}  once, and then  ${start}  starts ` +
    "this session from any terminal, in the folder to scan. After a plugin update it says so and uses the plugin's own copy."
  );
}

/** Which copy starts the session (see the file's header). */
export function sessionCopy(input: SessionCopyInput): SessionCopy {
  const { mine, own, pluginName, entries } = input;
  if (mine === null || own === null || pluginName === null) return { kind: "unchecked", line: null };
  if (entries === null) return { kind: "unchecked", line: `  Could not read which copy of the ${pluginName} plugin Claude Code runs (claude plugin list --json); starting this session with this copy.` };
  const enabled = entries.filter((e) => e.enabled);
  if (enabled.length === 0) {
    return { kind: "unchecked", line: `  Claude Code lists no enabled ${pluginName} plugin (claude plugin list --json), and the scan needs it in the session: install or enable it, then ask for the scan.` };
  }
  const here = realOr(mine);
  const self = enabled.find((e) => realOr(e.installPath) === here);
  if (self) {
    const version = self.version ?? own.version;
    return { kind: "plugin-copy", offer: !input.shortOnPath && own.bin !== null && version !== null ? shortCommandOffer(own, version) : null };
  }
  const other = enabled.find((e) => e.version !== null && e.version !== own.version);
  if (!other || other.version === null) return { kind: "same" };
  const install = installCommand(own, other.version);
  return {
    kind: "plugin-instead",
    entry: other,
    line:
      `  ${own.bin ?? own.name} is version ${own.version ?? "unknown"} and the plugin Claude Code runs is version ${other.version}, so this session is ` +
      `started by the plugin's own copy (${other.installPath}).${install === null ? "" : ` To make them match: ${install}`}`,
  };
}

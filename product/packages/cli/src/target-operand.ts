/**
 * (items 1, 2) THE FOLDER A COMMAND READS: its
 * `--target`, or ONE path given after the command's name, which means exactly what `--target <path>` means.
 *
 * WHY. Commander accepts words a command does not declare and hands them to no one, so `scan ./my-app`, run from
 * another folder, scanned the folder it was run in, printed "0 places worth a look" and exited 0: the
 * person read their project as clean. One function decides the folder for every command that has a
 * `--target` option (found from the command's own definitions, so a command added later is covered without being named
 * here): the path is set as that command's `--target` before any other hook or the action reads the options, and a path
 * given together with `--target`, or more than one path, is refused before anything is read or written.
 *
 * A command's own requirements are read from its definition or marked on the command itself, never kept as a list here:
 * whether `--target` must be given (a `requiredOption`, whose check commander makes before any hook runs, so it is taken
 * over by `targetRequirementsFromDefinitions` and made here after the path is taken, with commander's own sentence and
 * exit code), and whether it must name a folder that exists (`targetRule`; the scan: a path that does not exist, or a
 * file, is refused with one line and exit 1, where it used to print a normal "0 places" screen and exit 0).
 *
 * A command that declares positional arguments of its own (`decide`, `deepen`, `explain`: a finding, its words) keeps
 * them: its words are not folders, so only a command whose one declared argument is `[folder]`, or that declares none,
 * takes a path as its `--target`.
 */
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { valueText } from "./value-text.js";

/** What a command requires of its `--target`, marked where the command is defined. */
export interface TargetRule {
  /** `--target` (or the one path) must be given: commander's required option, read after the path is taken. */
  required?: boolean;
  /** It must name a folder that exists: refused before anything is read or written where it does not. */
  mustBeFolder?: boolean;
}
const RULES = new WeakMap<object, TargetRule>();
/** Mark a command's requirements of its `--target`. Returns the command, so it reads as one more step of its definition. */
export function targetRule<C extends object>(command: C, rule: TargetRule): C {
  RULES.set(command, rule);
  return command;
}

/** The parts of a commander command this reads and sets. */
export interface TargetCommand {
  name(): string;
  readonly args: readonly string[];
  readonly registeredArguments?: readonly { name(): string }[];
  readonly options: readonly { attributeName(): string; long?: string; flags: string; mandatory?: boolean }[];
  opts(): Record<string, unknown>;
  getOptionValueSource(key: string): string | undefined;
  setOptionValueWithSource(key: string, value: unknown, source: "cli"): unknown;
}

/**
 * One quoted path, as the refusals print it: as the person typed it, between double quotes, its control characters as
 * escapes (`valueText`). Until 0.1.2 it was
 * `JSON.stringify`, which doubled every backslash of a Windows path (`"..\\my app"` for `..\my app`).
 */
const said = (p: string): string => `"${valueText(p)}"`;

/**
 * What the filesystem says about a folder to scan before anything is read into it, as one sentence, or `""` where it is
 * a folder. The one wording: the scan's refusal prints it (and the screens that used to carry it after a scan).
 */
export function targetPathProblem(targetRoot: string): string {
  if (!existsSync(targetRoot)) return `The folder to scan, ${targetRoot}, does not exist: check the path.`;
  if (!statSync(targetRoot).isDirectory()) return `The folder to scan, ${targetRoot}, is a file, not a folder: give the folder that holds the project.`;
  return "";
}

/**
 * Take a path given after the command's name as its `--target`, and check what the command requires of it. Returns
 * the line to refuse with (exit 1, nothing read or written), or null where the command may go on. A command with no
 * `--target` option is left as it is.
 */
export function targetFromOperands(command: TargetCommand): { refused: string } | null {
  const option = command.options.find((o) => o.attributeName() === "target");
  if (option === undefined || !takesFolderWords(command)) return null;
  const rule = RULES.get(command) ?? {};
  const name = command.name();
  const paths = [...command.args];
  if (paths.length > 1) {
    return { refused: `${name} takes one folder, and ${paths.length} were given (${paths.map(said).join(", ")}). Give the project folder once: after the command's name, or with --target. Nothing was read or written.` };
  }
  if (paths.length === 1) {
    if (command.getOptionValueSource("target") === "cli") {
      return { refused: `${name} was given its folder twice: ${said(paths[0]!)} after its name, and ${said(String(command.opts().target))} with --target. Give it once. Nothing was read or written.` };
    }
    command.setOptionValueWithSource("target", paths[0], "cli");
  }
  const target = command.opts().target;
  // Commander's own sentence and exit code for a required option, so a caller that reads it reads it as before.
  if (rule.required === true && (typeof target !== "string" || target === "")) return { refused: `error: required option '${option.flags}' not specified` };
  return null;
}

/**
 * Where the command requires a folder that exists (`targetRule` `mustBeFolder`: the scan), the line to refuse with
 * where its --target is not one; null otherwise. Asked after the account's anchor (which refuses first, as before) and
 * before any hook writes.
 */
export function targetFolderRefusal(command: TargetCommand): string | null {
  if (RULES.get(command)?.mustBeFolder !== true) return null;
  const target = command.opts().target;
  const problem = targetPathProblem(resolve(typeof target === "string" && target !== "" ? target : "."));
  return problem === "" ? null : `${problem} Nothing was scanned.`;
}

/** The name of the one positional argument a command may declare for its folder (`scan [folder]`). */
export const FOLDER_ARGUMENT = "folder";

/**
 * Whether the words after a command's name are its folder: it has a `--target` option and declares no positional
 * argument of its own, or only `[folder]`. The one test of it, for `targetFromOperands`, the required `--target` and the
 * stray words below.
 */
function takesFolderWords(command: TargetCommand): boolean {
  if (!command.options.some((o) => o.attributeName() === "target")) return false;
  const declared = command.registeredArguments ?? [];
  return declared.length === 0 || (declared.length === 1 && declared[0]!.name() === FOLDER_ARGUMENT);
}

/**
 * WORDS NO COMMAND TAKES. Commander
 * hands a word a command does not declare to no one, so `doctor ./x` ran as `doctor` and said nothing of the word. Every
 * command whose words are not its folder (`takesFolderWords`) refuses them with commander's own setting
 * (`allowExcessArguments(false)`: one line naming the count, exit 1, before any hook or the action runs); a command that
 * declares words of its own (`decide`, `deepen`, `explain`, `session`) keeps them, and one that takes a folder keeps
 * `targetFromOperands`' refusals. Called once, after every command is defined.
 */
export function strayWordsRefusedFromDefinitions(root: { readonly commands: readonly unknown[] }): void {
  for (const sub of root.commands as (TargetCommand & { readonly commands: readonly unknown[]; allowExcessArguments(allow?: boolean): unknown })[]) {
    if (!takesFolderWords(sub)) sub.allowExcessArguments(false);
    strayWordsRefusedFromDefinitions(sub);
  }
}

/**
 * Every command under `root` (sub-commands included) whose `--target` is a required option: the requirement is taken
 * off the option, where commander checks it before any hook could take the path given after the command's name, and
 * put on the command's rule, which `targetFromOperands` checks after it. Called once, after every command is defined.
 */
export function targetRequirementsFromDefinitions(root: { readonly commands: readonly unknown[] }): void {
  for (const sub of root.commands as (TargetCommand & { readonly commands: readonly unknown[] })[]) {
    const option = sub.options.find((o) => o.attributeName() === "target") as { mandatory?: boolean } | undefined;
    if (takesFolderWords(sub) && option !== undefined && option.mandatory === true) {
      option.mandatory = false;
      RULES.set(sub, { ...(RULES.get(sub) ?? {}), required: true });
    }
    targetRequirementsFromDefinitions(sub);
  }
}

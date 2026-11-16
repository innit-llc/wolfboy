/**
 * REFUSING WRITES INTO THE RUN'S RECORD DIRECTORIES (relay item 3, milestone 4; proposal §3.5 part 3), AND INTO THE
 * DECLARATION'S FILES AND THE FILES THAT DECIDE THIS GUARD'S WINDOWS (see DECLARATION_WRITTEN_BY and WINDOW_WRITTEN_BY below, each with the window it is refused in).
 *
 * The program writes every file under these directories itself, in its own process: a seat's answer through
 * the capture hook, the launch list and its events through `adjudicate` and the hooks, the payloads through
 * `scan`, the carried and assembled verdicts through their commands. No tool call has a reason to write
 * there, so a Write, Edit, MultiEdit or NotebookEdit whose target lies under one of them is denied, whoever
 * makes it (the main session or any agent), with a reason that says what to do instead. Probe fact (c): a
 * PreToolUse deny cancels the call and hands the reason to the caller.
 *
 * WHICH `.legal`, AND WHEN: only the run's own, `$CLAUDE_PROJECT_DIR/.legal` (runPaths), and only while the event
 * belongs to the active run: the active-run marker stands (hook.ts `runMarkerStands`, the rows' `when`) and names the
 * event's session, or names none and this session has claimed it (hook-launch.ts `eventInActiveRun`, the rule the
 * launch gate acts on; a marker that does not read counts as the run's). A `.legal` in another folder is not this
 * run's. Before the pre-launch step writes the marker, once `run-abort` or the assembly removes it, and in a session
 * other than the run's, nothing is refused: a person's own `rm -rf .legal/verdicts` a week after the scan passes. What that gives up, with the consumers' checks
 * below as the backstop in each case: a second session on the project during the run (a `claude -p` started from the
 * run's Bash included) is not refused; nor is a write after the run has ended; and a marker a run left without
 * being ended keeps the guard on in that run's own session until `legal-scan run-abort`, which the refusal names.
 * The declaration's files and the files that decide the windows are refused over a wider window of their own as
 * well: from every scan in a Claude Code session, whether or not it asks anything, to the end of the run that follows
 * it, in that session (declarationUnderWay; DECLARATION_WRITTEN_BY below).
 * A path is resolved the way the kernel opens it, one component at a time, a symlink replaced by its target before the next component is read (so a `..` after a
 * link leaves the link's target, where path.resolve would leave the link's folder), and compared without regard to
 * case with each record directory both as written under `.legal` and as kernelPath resolves it (a `verdicts/` that
 * is itself a symlink). On a case-insensitive file system `.LEGAL/verdicts` is `.legal/verdicts`, and refusing it
 * elsewhere costs nothing.
 *
 * Bash is read word by word, on a best-effort basis. The line is cut into simple commands at an unquoted newline and
 * at ; & | ( ); a backslash-newline pair is a line continuation; a heredoc's body is skipped to its delimiter line
 * (the command substitutions of a body whose delimiter is unquoted are read, since they run); a `#` that starts a
 * word runs to the end of its line. Before its command word, assignments, the reserved words `if then else elif do
 * while until ! { coproc function` and the commands that run another (`sudo`, `env`, `command`, `exec`, `nohup`,
 * `time`, `timeout`, `nice`, `stdbuf`, `setsid`, `doas`, `ionice`, `busybox`, and `flock` with its lock, or the
 * string of its `-c`) are passed over. `$PWD`, `$CLAUDE_PROJECT_DIR`, `$HOME` (also in braces) and a leading `~`
 * become the values this hook holds (the event's cwd, the project, the hook's HOME) before a word is resolved.
 * What is read: redirections (`>`, `>>`, `&>`, `<>`), `tee` and `sponge`, `dd of=`, the destination of `cp`, `mv`,
 * `ln`, `install`, `rsync` and `scp` (`-t DIR` alone or in a cluster, `--target-directory`, or the last operand;
 * `install -d` makes directories, as `mkdir` does), a copy into `.legal` itself of a directory named like a record
 * directory (or of a whole folder's contents: a source `.`, `-T`, an rsync source ending in `/`), the operands of
 * `rm`, `touch`, `truncate`, `unlink`, `shred`, `mkfifo` and `mknod` and of `sed`, `perl`, `ruby` and `yq` editing in place (their `-i`
 * as a flag letter before the first letter that takes a value), the output options of `curl`, `wget`, `sort` and
 * `iconv`, the archive `tar` creates, appends to or updates (`-f`, `--file`), the folder `tar` or `unzip` extracts
 * into, `find`'s `-delete` and the command of its `-exec`, `-execdir`, `-ok` and `-okdir`, the command `xargs` runs,
 * the string of `bash`/`sh`/`zsh`/`dash`/`ksh -c` and of `eval`, and a heredoc or here-string that a shell runs (given
 * to it directly or as /dev/stdin, to `source` or `.` of /dev/stdin, to `sudo -s`, through a pipe, as a subshell's or
 * group's input, or written to a file that a later command of the call runs; to 3 levels), each when the path names
 * a record directory or one of the guarded files (the declaration's files and the files that decide the windows); for
 * those files alone also the SOURCE of a move (`mv`, `rename`, `rsync --remove-source-files`), which takes the file
 * away from where the program reads it; a whole folder's contents copied, or an archive extracted, into
 * a folder that directly holds one of those files (`guardedFileIn`); and, in the
 * run's window, a delete (`rm`, `unlink`, `shred`, `find`'s `-delete`) or a move of a folder that holds the active-run
 * marker, which would end the run with no end recorded (`holdsMarker`). Its limits are in GUARD_BASH_LIMITS. A
 * command that runs the program (`legal-scan ...`, `node .../index.js ...`) is never refused for its own writes: the
 * program writing its own directories is the design; the shell redirecting its output there is refused.
 *
 * WHAT THIS GUARD IS FOR, AND WHAT THE RUN'S INTEGRITY RESTS ON. This guard is the first stop that tells the
 * orchestrator where records come from: at the moment of the call, with a reason that says what to do instead. The
 * integrity of the run's records rests on the consumers' checks, not on this guard: a write it misreads (see
 * GUARD_BASH_LIMITS) is caught there. verdict-capture's `checkLedger`, run at assembly, refuses a `.json` under
 * verdicts/ or readers/ that no ledger line names, a record whose bytes differ from its line's sha256, a record its
 * line names that is not there, and a ledger line that does not read. It does not catch a record written together
 * with its own ledger line: the `verdict-capture` command run by hand, its `--replace`, or a hook's line copied with
 * its `via`. What closes those is not this guard and not a file under `.legal`:
 * the hook writes a line for each record it takes, with the record's sha256 and the transcript paths Claude Code handed
 * it, into the person's state folder (`seat-captures.jsonl`), and the assembly accepts a record only where such a line
 * names it, taking every transcript path from that line (assemble-hooked.ts `transcriptCheck`, the check proposal §3.5,
 * P:277, asks of assembly: each record against the seat's own transcript). The session's transcript and the seat's,
 * beside it in Claude Code's folder, are refused to file tools in every session (`placeRowDenial`). The record
 * directories and the window files are refused to file tools in every session too (`onFileWrite`); the Bash rows keep
 * the run's window. A Bash command is the stated limit (design rf13 3.4).
 */
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, sep } from "node:path";
import { atOrInside, dotDotReadings, kernelPath, locate, type Located } from "./file-identity.js";
import { DECLARATION_PROFILE_FILE, DECLARATION_RECORD_FILE, REVIEW_DECLARATION_FLAG } from "./declaration-files.js";
import { ACTIVE_RUN_MARKER as ACTIVE_RUN_FILE, HOME_ENV, PASS, RECORD_DIRS, RUN_OUTPUTS, SCAN_UNDER_WAY_FILE, homePath, patternLead, type HookContext, type HookDecision } from "./hook.js";
import { anchorStateDir, processStateDir } from "./start-record.js";
import { DEEP_CHECKS_RECORD, GUARDED_STATE_RECORDS, workTreeCounted } from "./state-record.js";
import { REDACTION_KEY_FILE, redactionKeyPlaces } from "./redaction-key.js";
import { readRegularFile } from "./project-read.js";
// From value-text.ts, which imports nothing, not printed-output.ts: the
// guard rows carry no failClosed (hook.ts), so a module of this one's static graph that does not load lets the call
// through, and the redaction is loaded only to print (hook-entry.ts), where its failure withholds the words. (Since
// rf11-fx5b and rf11-if5 they carry one, hook.ts `guardTargetMayBe` and `scanMayBeUnderWay`; the scan-time windows'
// modules are loaded on demand, `decideWithWindows` below.)
import { valueText } from "./value-text.js";

/** What writes each record directory: the text of the deny reason. */
const WRITTEN_BY: Record<string, string> = {
  verdicts: "a seat's answer becomes a record here only through the plugin's hook, as the seat hands it back",
  readers: "a reader's answer becomes a record here only through the plugin's hook, as the seat hands it back",
  capture: "the capture ledger, the kept answers and the hook ledgers are written only by the program",
  launch: "the launch list, its briefs and its events are written by `legal-scan adjudicate` and the plugin's hooks",
  payloads: "the payloads are written by `legal-scan scan`",
  "verdicts-carried": "carried verdicts are written by `legal-scan adjudicate --carry-into`",
  "verdicts-assembled": "assembled verdicts are written by `legal-scan verdict-reading --assemble-into`",
};

/**
 * THE DECLARATION'S FILES, each with what writes
 * it: the text of the deny reason. Paths under `.legal`, compared as whole files. The program writes each of them in
 * its own process, so no tool call has a reason to write, edit, move or delete one while the declaration questions or
 * the run that follows them are under way: a Write, Edit, MultiEdit or NotebookEdit of one, or a Bash write that
 * names one (a redirection, a copy or move that lands on it, an in-place edit, `rm` ...), is refused then, in the
 * session the scan runs in. Their window is wider than the record directories': the declaration is read before the
 * active-run marker is written (by the scan and the pre-launch step), and the orchestrator works between the two, so it
 * runs from every scan in the session, whether or not it asks anything (hook-question.ts declarationUnderWay: the
 * ledger's last `scan-started` or round line later than the last run's end, in the session it names),
 * to the run's end, and while the event belongs to the active run. A move whose SOURCE is one of them is refused as
 * well (M4): it takes the file away from where the program reads it. What it gives up, as for the record directories:
 * a folder above them removed or replaced whole (`rm -rf .legal/launch`), a file written before the session's scan or
 * outside a session (a hand-made declaration and record, a stated limit), and a
 * second session on the project.
 */
const DECLARATION_WRITTEN_BY: Record<string, string> = {
  [DECLARATION_PROFILE_FILE]: "`legal-scan scan` writes the declaration from the person's answers to its questions",
  [DECLARATION_RECORD_FILE]: "`legal-scan scan` writes the declaration's record beside the declaration",
};

/**
 * THE FILES THAT DECIDE THIS GUARD'S WINDOWS, each with what writes it:
 * the active-run marker, whose presence is the run's window, and the active-run history, whose last run end closes the
 * declaration window (and whose mtime hook.ts's light entry compares with the declaration ledger's before this guard is
 * even started). One `touch` of the history turned the guard off for every declaration file until this was added. They
 * are refused like the declaration's files, in both windows (in the run's they lie under launch/, a record directory,
 * and their own reason is given first): a tool call cannot end the window it is refused in; the program's own commands
 * (`legal-scan run-abort`, the assembly) are never refused.
 */
const WINDOW_WRITTEN_BY: Record<string, string> = {
  [`launch/${ACTIVE_RUN_FILE}`]: "`legal-scan adjudicate` writes the active-run marker when a run starts, and `legal-scan run-abort` or the assembly removes it when the run ends",
  [`launch/${SCAN_UNDER_WAY_FILE}`]: "the scan, its questions and the pre-launch step write the scan-under-way marker, which the plugin's shim reads when the hook cannot run, and `legal-scan run-abort` or the assembly removes it when a run ends",
};
/**
 * The relay's questions, answers and ledgers (every kind's, the program's
 * confirmation's included) and the active-run history are no longer files under `launch/`: they are records in the
 * person's state folder, refused by the state rows below in every session (state-record.ts GUARDED_STATE_RECORDS).
 */
/** Every file this guard refuses by its own name (compared whole), with what writes it; before the record directories. */
const GUARDED_FILES: Record<string, string> = { ...DECLARATION_WRITTEN_BY, ...WINDOW_WRITTEN_BY };

/**
 * THE PERSON'S OWN RECORDS IN THE STATE FOLDER (design rf11 3.3, 3.4, 3.5; section 9's
 * "Guard rows"): each guarded kind's folder under `<state folder>/legal-scan/` (state-record.ts
 * GUARDED_STATE_RECORDS), refused to every tool call in EVERY SESSION the plugin's hooks run in, whether or not a scan or
 * run is under way, since decisions and confirmations are taken after a run has ended. A write into one, a delete or
 * move of one of its files, a copy or extraction that lands on it by its name, and a delete or move of a folder that
 * holds it are refused, as for the declaration's files. The record directories and the declaration's files keep their
 * windows (whereOf): outside them only these rows act. The state folder is the program's own rule
 * (start-record.ts `processStateDir`) in the hook's environment; a Bash call that sets XDG_STATE_HOME for its own
 * command, or a state folder named through a variable the hook does not hold, is not seen (GUARD_BASH_LIMITS). Best
 * effort, like every row: off whenever the hook cannot start.
 */
const STATE_PREFIX = "state:";
/**
 * The redaction key (redaction-key.ts), the state folder's one
 * secret: whoever knows it reverses every redaction marker and keyed digest made under it. It gets the records' rows
 * (no write, edit, move or delete, in every session) and, alone of them, a read row (`onKeyRead`).
 */
const KEY_ROW = `${STATE_PREFIX}${REDACTION_KEY_FILE}`;
const STATE_WRITTEN_BY: Record<string, { noun: string; writtenBy: string; folder: string; where?: string }> = {
  ...Object.fromEntries(GUARDED_STATE_RECORDS.map((r) => [`${STATE_PREFIX}${r.kind.folder}`, { noun: r.noun, writtenBy: r.writtenBy, folder: r.kind.folder }])),
  [KEY_ROW]: {
    noun: "the redaction key, which keeps credentials out of every report and evidence log WolfBoy writes on this computer",
    writtenBy: "only the program makes it, once, and nothing else may write, read, move or remove it",
    folder: REDACTION_KEY_FILE,
    where: "kept in the person's own state folder (legal-scan/redaction-key) or the program's own temporary folder (wolfboy-redaction-key)",
  },
};
const isStateName = (name: string): boolean => Object.hasOwn(STATE_WRITTEN_BY, name);
/** A name this guard refuses as a whole file or folder, beyond the record directories: the guarded files and the state records' folders. */
const isGuardedName = (name: string): boolean => name in GUARDED_FILES || isStateName(name);
/**
 * Each guarded kind's folder, and the redaction key's file and spare folder; none where there is no state folder. Compared by identity (file-identity.ts `atOrInside`), not by text.
 */
function stateRoots(): [string, string[]][] {
  const stateDir = processStateDir();
  const key = redactionKeyPlaces();
  // And the anchor, the OS account's own
  // state folder (start-record.ts `anchorStateDir`), where the plugin's SessionStart hook records each session with the
  // state folder it used: guarded as the state folder is, whether or not the session's state folder is that one.
  const anchor = anchorStateDir();
  const dirs = [stateDir, anchor].filter((d, i, all): d is string => d !== null && all.indexOf(d) === i);
  const keyRoot: [string, string[]] = [KEY_ROW, [...(key.file === null ? [] : [key.file]), ...(anchor === null || anchor === stateDir ? [] : [join(anchor, REDACTION_KEY_FILE)]), key.spare]];
  if (dirs.length === 0) return [keyRoot];
  return [
    // `processStateDir` names the program's own folder (`<state folder>/legal-scan`), where every kind has its folder.
    ...GUARDED_STATE_RECORDS.map((r): [string, string[]] => [`${STATE_PREFIX}${r.kind.folder}`, dirs.map((d) => join(d, r.kind.folder))]),
    keyRoot,
  ];
}
/** The decisions this guard made for the state records: they hold in every session, so no window is added to their reason. */
const STATE_DENIALS = new WeakSet<HookDecision>();

export const GUARD_BASH_LIMITS = [
  "a path held in a variable is not read except in the spellings `~` (alone or before `/`), `$NAME` and `${NAME}` for PWD, CLAUDE_PROJECT_DIR and HOME; not read are `~user`, `~+`, `~-`, `${NAME...}` with an operator (`${PWD%/}`, `${CLAUDE_PROJECT_DIR:-.}`), any other variable, a path built by command substitution ($(...) or backticks) or reached through a glob or a brace expansion ({a,b}), a program held in a variable or built by substitution (`c=cp; $c ...`, `$(echo cp) ...`), and a command behind an alias or a shell function",
  "a relative path and $PWD are resolved against the event's cwd, whatever `cd` or `pushd` ran before them in the command, so `cd .legal && ... > verdicts/x` and `pushd .legal; ... > verdicts/x` are not seen",
  "a write made by another program's own code is not seen: awk's `print >`, sed's `w` command and flag, python, node, perl and ruby given a script with -c or -e, in a heredoc or in a script file. A script a shell runs is read only when it is a heredoc or here-string of the same call that the shell reads directly or as /dev/stdin, that `source` or `.` of /dev/stdin or `sudo -s` reads, that reaches the shell through a pipe (`cat <<EOF | sh`) or as a subshell's or group's input (`( bash ) <<EOF`), or that the call writes with `>`, `>>` or tee to a file a later command of the call runs (`bash f`, `./f`, `sh < f`); not read are text from another program (`printf ... | sh`, `curl ... | bash`), a script written by another program or in an earlier call, and a heredoc passed on by any other route (xargs, a named pipe, a copy of the file)",
  "a program not named in this module's header is not read for what it writes: among them split, csplit, uniq IN OUT, patch, zip, gzip, xz and other compressors working in place, openssl's -out, git checkout, git restore and git mv, editors",
  "a shell's -c string, eval's string, flock's -c string and a heredoc or here-string a shell runs are read to 3 levels of nesting, and a command substitution inside double quotes to 32; one nested deeper is not read",
  "a delete or move of .legal itself or of a folder above it is refused only in the run's window, and there as a folder that holds the active-run marker (.legal/launch, .legal and every folder above them: the operands of rm, unlink and shred, find's -delete, a move's source); a copy or an extraction into such a folder (rsync's --delete included) is read for its destination alone, not for the names it brings, and is refused only where the destination is .legal itself or a folder that directly holds a guarded file (a whole folder's contents or an archive). Otherwise refused are only paths under a record directory, the declaration's files, the files that decide the guard's windows and the confirmation's files, these in every session (DECLARATION_WRITTEN_BY, WINDOW_WRITTEN_BY), and copies into .legal of a record directory's name; a move's source is read only where it is one of those files or a folder that holds the marker (a record directory's own files may be moved out, as step 1a does before a run), and a source that an archiver deletes (tar's --remove-files, zip's -m) is not read",
  "a command the shell would parse differently from this word-level reading is read as the reading splits it: among them a command inside backticks, a $'...' string, a `case` pattern's `)` inside a double-quoted $(...) (it ends the substitution for this reading), a `>` inside [[ ]] (read as a redirection), and a body line of an unquoted heredoc that ends in a backslash (bash joins the next line to it, so a delimiter line right after it does not end the body; this reading ends it there)",
  "a command run by a program not named in this module's header as one that runs another (for example chrt, taskset, chroot, runuser, su -c, script -c, watch, unbuffer, strace, xvfb-run, parallel, toybox) is not read; watch and parallel join their words into a shell command, so a quoted `>` among them is a redirection there and a word here",
  "a path the command learns only when it runs is not read: a path `xargs` receives on its input, from `-a FILE` or from a here-string (`echo .legal/profile.json | xargs -I{} mv {} /tmp/`, `xargs mv -t /tmp <<< .legal/profile.json`, `xargs -a /tmp/list mv -t /tmp`), `find`'s match `{}` in the command of `-exec`, `-execdir`, `-ok` or `-okdir` (`find .legal -name profile.json -exec mv {} /tmp/ \\;`), a path through a symbolic link that an earlier command of the same call made (`ln -s .legal L && mv L/profile.json /tmp/`; a link made by an earlier call is followed), and the members of an archive extracted into a folder above the guarded files (`tar -xf /tmp/a.tar` or `unzip -o /tmp/a.zip` in the project folder)",
  "a PowerShell command is read with this reading's words and operators (its `;`, `|`, `&` and redirections), its named parameters taken out, and the cmdlets Remove-Item, Set-Content, Add-Content, Out-File, New-Item, Clear-Content, Tee-Object, Copy-Item, Move-Item and Rename-Item (with their aliases) read as rm, touch, tee, cp, mv and rename; not read are .NET calls ([IO.File]::WriteAllText), `$env:` variables, a script block or a string run with Invoke-Expression, PowerShell's backtick escapes, and every other cmdlet",
  "the person's records in the state folder are found where the hook's own environment puts the state folder (XDG_STATE_HOME, %LOCALAPPDATA%, the home folder): a command that sets XDG_STATE_HOME for itself, or names the folder through a variable other than HOME, is not read",
  " the deeper checks' rows read the command's or the code's text as written: a `.legal/deep` or a check's test name spelled through a variable, split by quotes or joined in code (`'legal_' + 'check_7c1e02'`), reached by a `cd` into `.legal` before a relative `deep/`, or written in a script file the command runs is not seen; a check whose record is not in the state folder the hook's environment names has no test name to read",
];

/** How deep a shell's -c string (or eval's) is read inside another. */
const MAX_SHELL_DEPTH = 3;
const SPLIT = sep === "\\" ? /[\\/]+/ : /\/+/;

/** The kernel's reading of a path now lives with the identity comparison. */
export { kernelPath };

/**
 * Where a hook call's paths are read from: the event's cwd; the run's `.legal`; each record directory and guarded file
 * under it, and each state record's folder, as a path, compared with a tool's path by identity (`placeAt`, file-identity.ts
 * `atOrInside`). `vars`: the values this hook holds for the shell's `$PWD`,
 * `$CLAUDE_PROJECT_DIR` and `$HOME`.
 */
interface Where {
  cwd: string;
  /** The run's `.legal`, or null where there is none. */
  legal: string | null;
  roots: [string, string[]][];
  /** Each protected path located once per call (`placeAt`). */
  located: Map<string, Located>;
  vars: Record<string, string>;
  /**
   * "run": the event belongs to the active run (the record directories and the guarded files); "declaration": a run's
   * declaration is under way in this session, from its scan (the guarded files alone); "none": neither, and only the
   * state records' rows act. The state records' folders are among the roots in every window.
   */
  window: "run" | "declaration" | "none";
  /** A PowerShell command (the PowerShell tool): its cmdlets are read as the commands they stand for (POWERSHELL_AS). */
  powershell: boolean;
}

/** The guarded files (the declaration's, and those that decide the windows) come first, so that one under launch/ is refused with its own writer. */
function whereFrom(
  cwd: string,
  legalDir: string | null,
  base: string,
  vars: Record<string, string>,
  window: "run" | "declaration" | "none" | "records",
  state: [string, string[]][] = [],
  powershell = false,
  fileTool = false,
): Where {
  const legal = legalDir === null ? null : isAbsolute(legalDir) ? legalDir : join(base, legalDir);
  const rootsOf = (rel: string): string[] => [join(legal ?? "", ...rel.split("/"))];
  // Outside both windows only the state rows act (the confirmation's files moved there); in either, every guarded file. A file tool (Write, Edit, MultiEdit, NotebookEdit) never writes the run's
  // files: the record directories and the window files (the active-run marker among them) are refused to it in every
  // session, so no other session's file tool rewrites the marker to move the run's window, or a ledger the run reads.
  const fileNames = legalDir === null ? [] : window === "run" || window === "declaration" ? Object.keys(GUARDED_FILES) : fileTool ? Object.keys(WINDOW_WRITTEN_BY) : [];
  const files = fileNames.map((f): [string, string[]] => [f, rootsOf(f)]);
  const dirs = legalDir === null || (!fileTool && (window === "declaration" || window === "none")) ? [] : RECORD_DIRS.map((d): [string, string[]] => [d, rootsOf(d)]);
  return { cwd, legal, roots: [...state, ...files, ...dirs], located: new Map(), vars, window: window === "records" ? "run" : window, powershell };
}

/*
 * THE SCAN-TIME WINDOWS' MODULES ARE LOADED ONLY WHERE THE RUN'S .legal STANDS.
 * The rows that act in every session (the person's records in the state folder, the redaction key, any project's record
 * directories, the deeper checks' rows) need nothing of hook-launch.ts or hook-question.ts, whose graphs were most of
 * this module's load: every Read, Grep, Glob, Write, Edit and shell call starts the routes' process for those rows, in
 * every session and project, and paid for loading the scan's launch and question code there (measured in the record:
 * some 70 ms of each such call on Linux). whereOf asks for the run's and the declaration's windows only where the run's
 * .legal exists (`legalThere`), and only there are the two modules needed, so they are loaded there, by the route
 * before it decides (`decideWithWindows`, which hook.ts's guard routes call). Where `.legal` appears between that
 * load and whereOf's own look, whereOf throws WindowsNotLoaded and the decision is taken again with them loaded, so
 * no call is decided on a window the guard could not read. A module that does not load fails the route, which its
 * failClosed decides, as when this module's own static import of them failed.
 */
type WindowModules = { launch: typeof import("./hook-launch.js"); question: typeof import("./hook-question.js") };
let windowModules: WindowModules | null = null;
class WindowsNotLoaded extends Error {}
async function loadWindows(): Promise<void> {
  if (windowModules !== null) return;
  const [launch, question] = await Promise.all([import("./hook-launch.js"), import("./hook-question.js")]);
  windowModules = { launch, question };
}
function windows(): WindowModules {
  if (windowModules === null) throw new WindowsNotLoaded("hook-guard.ts: the scan-time windows' modules are not loaded");
  return windowModules;
}
/** One guard row's decision, with the windows' modules loaded where the run's `.legal` stands (see above). */
export async function decideWithWindows(ctx: HookContext, decide: (ctx: HookContext) => HookDecision): Promise<HookDecision> {
  if (ctx.run !== null && existsSync(ctx.run.legalDir)) await loadWindows();
  try {
    return decide(ctx);
  } catch (e) {
    if (!(e instanceof WindowsNotLoaded)) throw e;
    await loadWindows();
    return decide(ctx);
  }
}

/**
 * What this event is refused: the state records' folders always; and the run's `.legal`
 * while the event belongs to the active run (eventInActiveRun), or, for the declaration's files alone, while this
 * session's declaration questions are under way (declarationUnderWay). Those two rows keep exactly the windows they
 * had: outside both, the window is "none" and only the state records' rows act. Null where there is nothing to refuse
 * (no state folder and no window).
 */
function whereOf(ctx: HookContext, fileTool = false): Where | null {
  const run = ctx.run;
  const sessionId = typeof ctx.input.session_id === "string" && ctx.input.session_id !== "" ? ctx.input.session_id : null;
  const legalThere = run !== null && existsSync(run.legalDir);
  let window: "none" | "run" | "declaration" = "none";
  if (legalThere) {
    const w = windows();
    window = w.launch.eventInActiveRun(ctx) ? "run" : w.question.declarationUnderWay(run.launchDir, sessionId, w.launch.latestRunEndAt(run.launchDir)) ? "declaration" : "none";
  }
  const state = stateRoots();
  if (window === "none" && state.length === 0 && !legalThere) return null;
  const fallback = run?.projectDir ?? process.cwd();
  const cwd = typeof ctx.input.cwd === "string" && isAbsolute(ctx.input.cwd) ? ctx.input.cwd : fallback;
  const vars: Record<string, string> = { PWD: cwd, HOME: process.env[HOME_ENV] ?? "" };
  if (run !== null) vars.CLAUDE_PROJECT_DIR = run.projectDir;
  return whereFrom(cwd, legalThere ? run.legalDir : null, fallback, vars, window, state, ctx.input.tool_name === "PowerShell", fileTool);
}

/** The record directory of the run's `.legal` a path lies under (its name), or null. */
export function recordDirOf(target: string, cwd: string, legalDir: string): string | null {
  return dirOf(target, whereFrom(cwd, legalDir, cwd, {}, "records"));
}

/** A protected path located, once per call. */
function placeAt(path: string, at: Where): Located {
  let l = at.located.get(path);
  if (l === undefined) {
    l = locate(path, at.cwd);
    at.located.set(path, l);
  }
  return l;
}

/** Whether two located paths are one file or folder. */
const samePlace = (a: Located, b: Located): boolean => atOrInside(a, b) && atOrInside(b, a);

function dirOf(target: string | Located, at: Where): string | null {
  const t = typeof target === "string" ? locate(target, at.cwd) : target;
  for (const [d, roots] of at.roots) for (const root of roots) if (atOrInside(t, placeAt(root, at))) return d;
  return null;
}

/**
 * A shell word with `$PWD`, `${PWD}`, `$CLAUDE_PROJECT_DIR`, `${CLAUDE_PROJECT_DIR}`, `$HOME`, `${HOME}` and a
 * leading `~` (alone or before `/`) replaced by the values this hook holds; a name this hook holds no value for
 * stays as written. Quoting is already gone, so a `'$PWD'` written in single quotes is expanded too: a folder
 * literally named `$PWD` is not a case worth a miss.
 */
function expand(word: string, at: Where): string {
  const w = word.replace(/\$(?:\{(PWD|CLAUDE_PROJECT_DIR|HOME)\}|(PWD|CLAUDE_PROJECT_DIR|HOME)(?![A-Za-z0-9_]))/g, (m, a?: string, b?: string) => at.vars[(a ?? b) as string] || m);
  // The leading `~`: the hooks' one path normaliser (hook.ts `homePath`).
  const h = homePath(w, at.vars.HOME);
  return at.powershell ? h : gitBashPath(h, process.platform, tmpdir(), at.cwd);
}
/** Every reading of a Bash word (`gitBashReadings`), `expand`'s first. */
function expandAll(word: string, at: Where): string[] {
  const w = word.replace(/\$(?:\{(PWD|CLAUDE_PROJECT_DIR|HOME)\}|(PWD|CLAUDE_PROJECT_DIR|HOME)(?![A-Za-z0-9_]))/g, (m, a?: string, b?: string) => at.vars[(a ?? b) as string] || m);
  const h = homePath(w, at.vars.HOME);
  return at.powershell ? [h] : gitBashReadings(h, process.platform, tmpdir(), at.cwd);
}

/**
 * A Bash word as the shell of Claude Code's Bash
 * tool on Windows opens it. That shell is Git Bash (MSYS2): it opens `/c/<path>` (and `/cygdrive/c/<path>`) as
 * `C:\<path>`, and `/tmp/...` in the account's temporary folder (Git for Windows mounts `/tmp` there), where Node,
 * and so this guard, read both against the current drive's root (`D:\c\<path>`), a folder no guarded file is in: a
 * Bash append into the person's state folder spelled so went ahead. Elsewhere, and for a PowerShell word, the word is
 * returned as it is. Other mount points (`/`, `/usr`, Git's own folder) hold no guarded file and are read as before.
 */
export function gitBashPath(word: string, platform: NodeJS.Platform = process.platform, temp: string = tmpdir(), cwd: string | null = null): string {
  if (platform !== "win32") return word;
  // Every spelling the MSYS2 runtime (a fork of
  // Cygwin's) opens on a drive, read from Cygwin's user guide ("Mapping path names", read 2026-11-11): "Paths using
  // backslashes or starting with a drive letter are always handled as Win32 paths" (so `/c\Users\me` and `C:/x` are
  // read as Node reads them, and stay as written here); two leading slashes are a UNC path (as written); every other path
  // that starts with `/` is a POSIX path, whose duplicate slashes, `.` and `..` the runtime takes out by their text
  // (`/tmp/../c/x` is `/c/x`), and whose first names may be the cygdrive prefix (`/` in Git for Windows: `/c/x`, also
  // `/cygdrive/c/x`) or "the /proc/cygdrive symlink, which allows to use a fixed path ... even if the actual cygdrive
  // prefix has been changed" (`/proc/cygdrive/c/x`). Git for Windows mounts its POSIX names without regard to case
  // (`posix=0`), so they are matched so.
  if (!word.startsWith("/") || word.startsWith("//") || word.includes("\\")) return word;
  // Cygwin's /proc (user guide, "The /proc filesystem"; MSYS2 and Git for
  // Windows keep it): `/proc/<pid>/root` (also `self`, `thread-self`) is a link to `/`, so the rest is read from `/` by
  // the rules below; `/proc/<pid>/cwd` is a link to that process's working folder, read here as the event's cwd, as a
  // relative path is (a `cd` earlier in the command is not seen: the stated limit), with the rest kept for Windows' rules
  // to resolve against it as the link would (`/proc/self/cwd/../x` is the cwd's parent's `x`). Read before `..` is taken
  // out by text, which would join `..` to `cwd` and name nothing. Every other `/proc` path is left as written.
  return gitBashReadings(word, platform, temp, cwd)[0] ?? word;
}

/**
 * EVERY READING OF A GIT BASH PATH THE GUARD TAKES, the
 * first the one `gitBashPath` returns. `..` is taken out BEFORE the `/proc` and drive mapping, under both readings of how
 * the MSYS2 runtime resolves a path: (1) links first, name by name, so `..` before `/proc/<pid>/root` or `cwd` pops the
 * name before it (`/c/../proc/self/root/c/x`, `/x/../proc/...`, `/tmp/../proc/self/cwd/x`, `/proc/self/fd/../cwd/x`) and
 * a `..` after `/proc/<pid>/cwd` is kept for Windows' rules to resolve against the working folder, as the link would;
 * (2) by text, Cygwin's documented rule, every `..` taken out first and `/proc/<pid>/root|cwd` then read on what is left
 * (`/proc/self/cwd/../../../c/x` is `/c/x`). Both are returned where they differ; the guard refuses where either names
 * a protected file or folder. A word that is not a POSIX path (see `gitBashPath`) has one reading, itself.
 */
export function gitBashReadings(word: string, platform: NodeJS.Platform = process.platform, temp: string = tmpdir(), cwd: string | null = null, depth = 0): string[] {
  if (platform !== "win32" || depth > 8) return [word];
  if (!word.startsWith("/") || word.startsWith("//") || word.includes("\\")) return [word];
  const isProc = (n: string[]): "root" | "cwd" | null =>
    n.length >= 3 && /^proc$/i.test(n[0] as string) && /^(?:self|thread-self|[0-9]+)$/i.test(n[1] as string) && /^(?:root|cwd)$/i.test(n[2] as string) ? ((n[2] as string).toLowerCase() as "root" | "cwd") : null;
  const atCwd = (rest: string[]): string | null => {
    if (cwd === null || cwd === "") return null;
    const base = cwd.startsWith("/") && !cwd.startsWith("//") && !cwd.includes("\\") ? (gitBashReadings(cwd, platform, temp, null, depth + 1)[0] ?? cwd) : cwd;
    return rest.length === 0 ? base : `${base.replace(/[\\/]+$/, "")}\\${rest.join("\\")}`;
  };
  const mapped = (names: string[]): string => {
    const posix = `/${names.join("/")}`;
    const drive = /^\/(?:proc\/cygdrive\/|cygdrive\/)?([A-Za-z])(?=\/|$)/i.exec(posix);
    if (drive) return `${(drive[1] as string).toUpperCase()}:\\${posix.slice(drive[0].length).replace(/^\/+/, "")}`;
    if (/^\/tmp(?=\/|$)/i.test(posix)) return `${temp.replace(/[\\/]+$/, "")}${posix.slice("/tmp".length)}`;
    return word;
  };
  const out: string[] = [];
  // (1) Links first, name by name.
  {
    const raw = word.split("/").filter((n) => n !== "" && n !== ".");
    let stack: string[] = [];
    let done: string | null = null;
    for (let i = 0; i < raw.length && done === null; i++) {
      const n = raw[i] as string;
      if (n === "..") stack.pop();
      else stack.push(n);
      const proc = stack.length === 3 ? isProc(stack) : null;
      if (proc === "root") stack = [];
      else if (proc === "cwd") done = atCwd(raw.slice(i + 1)) ?? word;
    }
    out.push(done ?? mapped(stack));
  }
  // (2) By text: every `..` out first, then `/proc/<pid>/root|cwd` read on what is left, again after each `root`.
  {
    let names: string[] = [];
    for (const n of word.split("/")) {
      if (n === "" || n === ".") continue;
      if (n === "..") names.pop();
      else names.push(n);
    }
    let done: string | null = null;
    for (let k = 0; k < 64 && done === null; k++) {
      const proc = isProc(names);
      if (proc === "root") names = names.slice(3);
      else if (proc === "cwd") done = atCwd(names.slice(3)) ?? word;
      else break;
    }
    out.push(done ?? mapped(names));
  }
  return [...new Set(out)];
}

/** A Bash word's record directory: dirOf after expand. */
const dirOfWord = (word: string, at: Where): string | null => {
  for (const r of expandAll(word, at)) {
    const d = dirOf(r, at);
    if (d !== null) return d;
  }
  return null;
};

const isLegalItself = (word: string, at: Where): boolean => at.legal !== null && expandAll(word, at).some((r) => samePlace(locate(r, at.cwd), placeAt(at.legal as string, at)));

/**
 * The guarded file (DECLARATION_WRITTEN_BY, WINDOW_WRITTEN_BY) that lies directly in the folder `word` names, as the
 * kernel reaches it, or null. A whole folder's contents copied, or an archive
 * extracted, into that folder land on it by its name: `cp -r /tmp/x/. .legal/launch/` in the declaration window, where
 * launch/ is not a record directory, wrote over the declaration's question round.
 */
function guardedFileIn(word: string, at: Where): string | null {
  for (const reading of expandAll(word, at)) {
    const folder = locate(reading, at.cwd);
    for (const [f, roots] of at.roots) if (isGuardedName(f) && roots.some((r) => samePlace(placeAt(dirname(r), at), folder))) return f;
  }
  return null;
}

/** The active-run marker's name among the guarded files (WINDOW_WRITTEN_BY). */
const MARKER_FILE = `launch/${ACTIVE_RUN_FILE}`;

/**
 * In the run's window, whether `word` names a folder that holds the active-run marker - its own folder `.legal/launch`,
 * `.legal` and every folder above them - as the kernel reaches it. Deleting or
 * moving one removes the marker and ends the run with no end recorded, as SKILL.md step 1a did whenever the skill
 * started again from step 1, so it is refused like the marker itself. Outside the run's window there is no marker.
 */
function holdsMarker(word: string, at: Where): boolean {
  if (at.window !== "run") return false;
  return expandAll(word, at).some((reading) => {
    const folder = locate(reading, at.cwd);
    return (at.roots.find(([f]) => f === MARKER_FILE)?.[1] ?? []).some((m) => atOrInside(placeAt(m, at), folder) && !atOrInside(folder, placeAt(m, at)));
  });
}
const holderText = (word: string): string => `${word}, a folder that holds the active-run marker,`;

/**
 * The state record (its name) whose folder lies at or under the folder `word` names, as
 * the kernel reaches it, or null: deleting or moving that folder takes the person's records with it.
 */
function holdsStateRecord(word: string, at: Where): string | null {
  for (const reading of expandAll(word, at)) {
    const folder = locate(reading, at.cwd);
    for (const [f, roots] of at.roots) if (isStateName(f) && roots.some((r) => atOrInside(placeAt(r, at), folder))) return f;
  }
  return null;
}
const stateHolderText = (word: string): string => `${word}, a folder that holds the person's records,`;

/** `dir` null: the write reaches every record directory (a whole folder's contents copied or extracted into .legal). */
function denyFor(target: string, dir: string | null): HookDecision {
  // The target is the tool's input: its control characters as escapes (`valueText`).
  const what = valueText(target);
  const state = dir !== null && isStateName(dir) ? STATE_WRITTEN_BY[dir] : undefined;
  if (state !== undefined) {
    const d: HookDecision = {
      kind: "deny",
      reason:
        `wolfboy: ${what} is refused: it reaches ${state.noun}, ${state.where ?? `kept in the person's own state folder (legal-scan/${state.folder}/)`}, and ${state.writtenBy}. ` +
        "Do not write, edit, move or delete it, whoever asks: a record there stands for the person's own word on this computer. This refusal holds in every session.",
    };
    STATE_DENIALS.add(d);
    return d;
  }
  if (dir !== null && dir in DECLARATION_WRITTEN_BY) {
    return {
      kind: "deny",
      reason:
        `wolfboy: ${what} is refused: .legal/${dir} is one of the declaration's files, which the program writes itself (${DECLARATION_WRITTEN_BY[dir]}). ` +
        `Do not write, edit, move or delete it: the scan asks the person its questions and writes their answers; to change an answer, run the scan again as it was run, with ${REVIEW_DECLARATION_FLAG} added.`,
    };
  }
  if (dir !== null && dir in WINDOW_WRITTEN_BY) {
    return {
      kind: "deny",
      reason:
        `wolfboy: ${what} is refused: .legal/${dir} is one of the files that decide how long this guard refuses writes, which the program writes itself (${WINDOW_WRITTEN_BY[dir]}). ` +
        "Do not write, edit, move or delete it: a run is started and ended by the program's own commands, never by a change to its files.",
    };
  }
  const head = dir
    ? `${what} into .legal/${dir}/ is refused. This run's records are written by the program itself: ${WRITTEN_BY[dir] ?? "the program writes this directory"}.`
    : `${what} would reach every record directory of .legal/ (${RECORD_DIRS.map((d) => `${d}/`).join(", ")}) and is refused. This run's records are written by the program itself.`;
  return {
    kind: "deny",
    reason:
      `wolfboy: ${head} ` +
      "Do not write, edit, move or delete files there. If a seat's answer is missing, relaunch that seat from the launch list; the assembly step names every seat whose record is missing.",
  };
}

/** One simple command: its words, quotes removed, and the text a heredoc or here-string gives its standard input. */
interface Simple {
  w: string[];
  /**
   * The indices in `w` of the words this reading made into operators: a redirection, and a heredoc's or here-string's
   * `<<`. A quoted word that starts with `>` or `<` is a word.
   */
  ops: Set<number>;
  /** The body of the last `<<`/`<<-` heredoc or the word of the last `<<<` here-string on fd 0, else null. */
  stdin: string | null;
  /** A `|` or `|&` follows it (not `||`): its output is the next command's standard input. */
  pipe: boolean;
}

const newSimple = (): Simple => ({ w: [], ops: new Set(), stdin: null, pipe: false });

/** A heredoc whose body starts after the next unquoted newline. */
interface Heredoc {
  delim: string;
  /** `<<-`: leading tabs are removed from the body's lines and from the delimiter line. */
  strip: boolean;
  /** Its delimiter was written with a quote or a backslash: the body is taken as written, and nothing in it runs. */
  quoted: boolean;
  /** On fd 0, so it is the command's standard input. */
  stdin: boolean;
  of: Simple;
}

/** How many levels deep a command substitution inside double quotes is read as a command line; one deeper is text. */
const MAX_QUOTED_SUBSTITUTION = 32;

/**
 * The simple commands of a shell command line. A new command starts at each unquoted newline
 * and at ; & | ( ); a space or a tab splits words, as bash splits them (a carriage return, a form feed or a no-break space is part of a word);
 * quotes are removed. A backslash-newline pair, outside single
 * quotes, is a line continuation and is dropped. A heredoc's body is skipped to its delimiter line, several heredocs of
 * one line in order; the body is kept as its command's standard input when on fd 0, and when the delimiter is unquoted
 * the command substitutions in it are read as commands of their own, since the shell runs them. A `#` that starts a
 * word runs to the end of its line. Arithmetic (`$((...))`, `((...))`, `$[...]`) is one word and opens no heredoc,
 * the substitutions in it read; `$"..."` is `"..."`. A `$(...)` inside double quotes is a command line of
 * its own, with its own quotes and heredocs: its commands are read as commands of their own, and the word keeps its
 * text. Best effort (GUARD_BASH_LIMITS).
 */
function simpleCommands(command: string, bs: Backslash = "escape"): Simple[] {
  return scanCommands(command, 0, 0, bs).commands;
}

/**
 *
 * How a reading takes a back-slash. "escape", the first reading and the one this module always had: bash's escape outside
 * quotes, and dropped before every character inside double quotes. "bash": bash's own rule inside double quotes, where a
 * back-slash is dropped only before `$`, a backquote, `"`, a back-slash or a line break and kept before anything else (so
 * `"D:\work\..."` is the Windows path Git Bash hands on). "literal": PowerShell's, where a back-slash is a path separator
 * and never an escape (its escape is the backtick, not read): kept on Windows, read as "/" elsewhere, where PowerShell's
 * file system provider takes either. A command line is read in its tool's two readings and refused where either names a
 * guarded place (`checkLine`): the second reading only adds refusals.
 */
type Backslash = "escape" | "bash" | "literal";
const BASH_DOUBLE_QUOTE_ESCAPES = new Set(["$", "`", '"', "\\", "\n"]);
const readingsOf = (at: Where): Backslash[] => (at.powershell ? ["escape", "literal"] : ["escape", "bash"]);

/**
 * The index of the last character of the arithmetic whose text starts at `from` (after `$((`, `((` or `$[`), or -1.
 * `$[` ends at the `]` at its own level; `((` ends at `))`, and a `)` at its own level that no second `)` follows gives
 * -1, since bash then reads a `(` and a subshell.
 */
function arithmeticEnd(command: string, from: number, bracket: boolean): number {
  const [open, close] = bracket ? ["[", "]"] : ["(", ")"];
  let depth = 0;
  for (let j = from; j < command.length; j++) {
    if (command[j] === open) depth++;
    else if (command[j] === close) {
      if (depth > 0) depth--;
      else if (bracket) return j;
      else return command[j + 1] === ")" ? j + 1 : -1;
    }
  }
  return -1;
}

/**
 * Read `command` from `from` into simple commands. `nested` > 0: the inside of a `$(` within double quotes, that many
 * levels deep; the `)` that closes it ends the reading, and `end` is its index (the command's length when none comes).
 * A heredoc still waiting for its body at that `)` is not skipped: the lines after it are read as commands.
 */
function scanCommands(command: string, from: number, nested: number, bs: Backslash = "escape"): { commands: Simple[]; end: number } {
  const out: Simple[] = [newSimple()];
  const inBodies: Simple[] = [];
  let pendingBodies: Heredoc[] = [];
  /** A heredoc or here-string operator whose word is being read. */
  let op: { strip: boolean; stdin: boolean; hereString: boolean } | null = null;
  let cur = "";
  let begun = false;
  let quotedWord = false;
  let quote: string | null = null;
  /** Unquoted `(` not yet closed, inside a nested reading. */
  let depth = 0;
  const last = (): Simple => out[out.length - 1];
  const push = (): void => {
    if (begun) {
      last().w.push(cur);
      if (op?.hereString) {
        if (op.stdin) last().stdin = cur;
      } else if (op) pendingBodies.push({ delim: cur, strip: op.strip, quoted: quotedWord, stdin: op.stdin, of: last() });
      op = null;
    }
    cur = "";
    begun = false;
    quotedWord = false;
  };
  const nextCommand = (): void => {
    if (last().w.length) out.push(newSimple());
  };
  const done = (end: number): { commands: Simple[]; end: number } => {
    push();
    return { commands: [...out, ...inBodies].filter((s) => s.w.length > 0), end };
  };
  /** Arithmetic opening at `i` with `skip` characters: added to the word, the substitutions in it read; its last index, or -1. */
  const arithmetic = (i: number, skip: number, bracket: boolean): number => {
    const e = arithmeticEnd(command, i + skip, bracket);
    if (e < 0) return -1;
    cur += command.slice(i, e + 1);
    begun = true;
    for (const inner of substitutions(command.slice(i + skip, e))) inBodies.push(...simpleCommands(inner, bs));
    return e;
  };
  for (let i = from; i < command.length; i++) {
    const c = command[i];
    // The "literal" reading (PowerShell): a back-slash is a separator in every quote and outside them.
    if (c === "\\" && bs === "literal") {
      cur += sep;
      begun = true;
      continue;
    }
    if (quote) {
      if (c === quote) quote = null;
      else if (quote === '"' && c === "$" && command[i + 1] === "(" && nested < MAX_QUOTED_SUBSTITUTION) {
        const a = command[i + 2] === "(" ? arithmetic(i, 3, false) : -1;
        if (a >= 0) i = a;
        else {
          const inner = scanCommands(command, i + 2, nested + 1, bs);
          inBodies.push(...inner.commands);
          cur += command.slice(i, inner.end + 1);
          i = inner.end;
        }
      } else if (c === "\\" && quote === '"' && i + 1 < command.length && (bs === "escape" || BASH_DOUBLE_QUOTE_ESCAPES.has(command[i + 1]))) {
        i++;
        if (command[i] !== "\n") cur += command[i];
      } else cur += c;
      continue;
    }
    if (c === "\\" && i + 1 < command.length) {
      i++;
      if (command[i] !== "\n") {
        cur += command[i];
        begun = true;
        quotedWord = true;
      }
      continue;
    }
    // `$"..."` is a string quoted as `"..."` (translated by the locale).
    if (c === "$" && command[i + 1] === '"') continue;
    const arith =
      c === "$" && command[i + 1] === "[" ? arithmetic(i, 2, true)
      : c === "$" && command[i + 1] === "(" && command[i + 2] === "(" ? arithmetic(i, 3, false)
      : c === "(" && command[i + 1] === "(" && !begun ? arithmetic(i, 2, false)
      : -1;
    if (arith >= 0) {
      i = arith;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      begun = true;
      quotedWord = true;
    } else if (c === "#" && !begun) {
      while (i + 1 < command.length && command[i + 1] !== "\n") i++;
    } else if (c === "\n") {
      push();
      op = null;
      if (pendingBodies.length > 0) {
        i = skipBodies(command, i, pendingBodies, inBodies, bs);
        pendingBodies = [];
      }
      nextCommand();
    } else if (c === " " || c === "\t") push();
    else if (c === "|") {
      push();
      if (command[i + 1] === "|") i++;
      else {
        for (let n = out.length - 1; n >= 0; n--) {
          if (out[n].w.length > 0) {
            out[n].pipe = true;
            break;
          }
        }
        if (command[i + 1] === "&") i++;
      }
      nextCommand();
    } else if (c === ")" && nested > 0 && depth === 0) return done(i);
    else if (c === ";" || c === "&" || c === "(" || c === ")") {
      push();
      if (c === "&" && command[i + 1] === ">") {
        cur = "&";
        begun = true;
        continue;
      }
      if (c === "(") depth++;
      else if (c === ")" && depth > 0) depth--;
      nextCommand();
    } else if (c === ">" || c === "<") {
      // A redirection operator is its own word, with any fd number or & before it.
      const fd = /^\d+$|^&$/.test(cur) ? cur : "";
      if (!fd) push();
      cur = "";
      begun = false;
      quotedWord = false;
      let word = `${fd}${c}`;
      if (c === "<" && command[i + 1] === "<") {
        word += command[++i];
        const hereString = command[i + 1] === "<";
        if (hereString || command[i + 1] === "-") word += command[++i];
        op = { strip: word.endsWith("-"), stdin: fd === "" || fd === "0", hereString };
      } else while (command[i + 1] === ">" || command[i + 1] === "&" || command[i + 1] === "|") word += command[++i];
      last().w.push(word);
      last().ops.add(last().w.length - 1);
    } else {
      cur += c;
      begun = true;
    }
  }
  return done(command.length);
}

/**
 * Skip the heredoc bodies that follow the newline at `nl`, each up to its delimiter line (as written, or with one
 * trailing carriage return removed); returns the index of the newline that ends the last delimiter line skipped. A
 * body whose delimiter line never comes is not skipped, nor is any after it: the rest is read as commands, since
 * reading too much can only refuse where skipping the rest could hide a write. A `<<` inside arithmetic opens no
 * heredoc. Until integration part B this reading took the one in `$((1<<EOF))` for a heredoc, and a later line `EOF`
 * then hid every line before it (`cp ... .legal/verdicts/x1.json` passed): not skipping a
 * body that never closes did not cover that. scanCommands now reads arithmetic as one word, so none opens.
 */
function skipBodies(command: string, nl: number, bodies: Heredoc[], inBodies: Simple[], bs: Backslash = "escape"): number {
  let at = nl + 1;
  for (const b of bodies) {
    const lines: string[] = [];
    let p = at;
    let closed = false;
    while (p <= command.length) {
      const end = command.indexOf("\n", p);
      const raw = command.slice(p, end < 0 ? command.length : end);
      const line = b.strip ? raw.replace(/^\t+/, "") : raw;
      p = end < 0 ? command.length + 1 : end + 1;
      if (line === b.delim || line.replace(/\r$/, "") === b.delim) {
        closed = true;
        break;
      }
      lines.push(line);
    }
    if (!closed) break;
    at = p;
    const body = lines.join("\n");
    if (b.stdin) b.of.stdin = body;
    if (!b.quoted) for (const inner of substitutions(body)) inBodies.push(...simpleCommands(inner, bs));
  }
  return at - 1;
}

/** The commands of the `$( )` and backquote substitutions in a text (a heredoc body whose delimiter is unquoted). */
function substitutions(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end < 0) break;
      out.push(text.slice(i + 1, end));
      i = end;
    } else if (text[i] === "$" && text[i + 1] === "(") {
      let depth = 0;
      let j = i + 1;
      for (; j < text.length; j++) {
        if (text[j] === "(") depth++;
        else if (text[j] === ")" && --depth === 0) break;
      }
      out.push(text.slice(i + 2, j));
      i = j;
    }
  }
  return out;
}

const PROGRAM = /(^|\/)(legal-scan|index\.js|hook-entry\.js)$/;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
/** The paths through which a program reads its own standard input as a file. */
const STDIN_PATHS = new Set(["/dev/stdin", "/dev/fd/0", "/proc/self/fd/0"]);
const nameOf = (word: string): string => word.replace(/^.*\//, "");
const baseOf = (path: string): string => path.replace(/[\\/]+$/, "").replace(/^.*[\\/]/, "");

/**
 * Reserved words that come before a command's own words in one simple command as this reading cuts it:
 * `coproc NAME {` and `function NAME` also name something before the command.
 */
const RESERVED = new Set(["if", "then", "else", "elif", "do", "while", "until", "!", "{", "coproc", "function"]);

/**
 * Commands that run the command after them: their options that take a value, how many plain words they take first,
 * and (flock) the option whose value is a string run by a shell instead of a command in the words that follow.
 */
const WRAPPERS: Record<string, { value: RegExp; positional: number; script?: RegExp }> = {
  sudo: { value: /^-[ugCDhprtUT]$/, positional: 0 },
  env: { value: /^-[uCS]$/, positional: 0 },
  command: { value: /^$/, positional: 0 },
  exec: { value: /^-a$/, positional: 0 },
  nohup: { value: /^$/, positional: 0 },
  time: { value: /^-[fo]$/, positional: 0 },
  timeout: { value: /^-[ks]$/, positional: 1 },
  nice: { value: /^-n$/, positional: 0 },
  stdbuf: { value: /^(-[ioe]|--(input|output|error))$/, positional: 0 },
  setsid: { value: /^$/, positional: 0 },
  doas: { value: /^-[aCu]$/, positional: 0 },
  ionice: { value: /^(-[cnpPu]|--(class|classdata|pid|pgid|uid))$/, positional: 0 },
  busybox: { value: /^$/, positional: 0 },
  flock: { value: /^(-[wE]|--(timeout|wait|conflict-exit-code))$/, positional: 1, script: /^(-c|--command)$/ },
};

/**
 * The index of the command word, past assignments, reserved words and wrappers with their options; or, for
 * `flock LOCK -c STRING`, the string a shell runs. `shell`: `sudo` or `doas` given `-s` or `-i` (`--shell`,
 * `--login`) and no command, which starts a shell that reads its standard input.
 */
function commandIndex(args: string[]): { k: number; script: string | null; shell: boolean } {
  let k = 0;
  let shell = false;
  for (;;) {
    const a = args[k];
    if (a === undefined) return { k, script: null, shell };
    if (ASSIGNMENT.test(a)) {
      k++;
      continue;
    }
    if (RESERVED.has(a)) {
      k++;
      if (a === "function" || (a === "coproc" && args[k + 1] === "{")) k++;
      continue;
    }
    const w = WRAPPERS[nameOf(a)];
    if (!w) return { k, script: null, shell: false };
    const su = nameOf(a) === "sudo" || nameOf(a) === "doas";
    k++;
    while (k < args.length && (ASSIGNMENT.test(args[k]) || (args[k].startsWith("-") && args[k] !== "-"))) {
      if (args[k] === "--") {
        k++;
        break;
      }
      if (su && /^(-[A-Za-z]*[si][A-Za-z]*|--shell|--login)$/.test(args[k])) shell = true;
      k += w.value.test(args[k]) ? 2 : 1;
    }
    k += w.positional;
    if (w.script?.test(args[k] ?? "")) return { k: args.length, script: args[k + 1] ?? null, shell: false };
  }
}

/** The string a shell runs with -c (a short-option cluster holding `c`), or null when it runs none. */
function shellString(rest: string[]): string | null {
  let c = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--") return c ? rest[i + 1] ?? null : null;
    if (/^[-+]o$|^[-+]O$|^--(rcfile|init-file)$/.test(a)) {
      i++;
      continue;
    }
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(a)) {
      c = true;
      continue;
    }
    if (a.startsWith("-") || a.startsWith("+")) continue;
    return c ? a : null;
  }
  return null;
}

/** find: its starting points (the words before its first expression) and the commands of -exec, -execdir, -ok, -okdir. */
function findParts(rest: string[]): { starts: string[]; execs: string[][]; deletes: boolean } {
  const starts: string[] = [];
  let i = 0;
  // Its own options come before the starting points: -H, -L, -P, -O<level>, -D <debug options>.
  while (i < rest.length && (/^-(H|L|P|O\d*)$/.test(rest[i]) || rest[i] === "-D")) i += rest[i] === "-D" ? 2 : 1;
  while (i < rest.length && !/^[-(!]/.test(rest[i]) && rest[i] !== ")") starts.push(rest[i++]);
  const execs: string[][] = [];
  let deletes = false;
  for (; i < rest.length; i++) {
    if (rest[i] === "-delete") deletes = true;
    if (!/^-(exec|execdir|ok|okdir)$/.test(rest[i])) continue;
    const cmd: string[] = [];
    for (i++; i < rest.length && rest[i] !== ";" && !(rest[i] === "+" && cmd.at(-1) === "{}"); i++) cmd.push(rest[i]);
    execs.push(cmd);
  }
  // `{}` stands for each file found, which lies under a starting point: read the command once per starting point.
  const withStarts = execs.flatMap((cmd) => (cmd.includes("{}") ? (starts.length ? starts : ["."]).map((s) => cmd.map((x) => (x === "{}" ? s : x))) : [cmd]));
  return { starts: starts.length ? starts : ["."], execs: withStarts, deletes };
}

/** xargs: the command it runs, past its own options. */
function xargsCommand(rest: string[]): string[] {
  let i = 0;
  while (i < rest.length && rest[i].startsWith("-") && rest[i] !== "-") {
    const a = rest[i];
    if (a === "--") return rest.slice(i + 1);
    i += /^-[InPdLsaE]$/.test(a) || /^--(arg-file|delimiter|max-args|max-procs|max-chars|process-slot-var)$/.test(a) ? 2 : 1;
  }
  return rest.slice(i);
}

/** Long options of the copy commands that take their value in the next word. */
const COPY_LONG_VALUE: Record<string, string[]> = {
  cp: ["--suffix", "--sparse"],
  mv: ["--suffix"],
  ln: ["--suffix"],
  install: ["--suffix", "--mode", "--owner", "--group", "--strip-program"],
  rsync: ["--rsh", "--rsync-path", "--exclude", "--include", "--filter", "--files-from", "--exclude-from", "--include-from", "--temp-dir", "--partial-dir", "--link-dest", "--compare-dest", "--copy-dest", "--backup-dir", "--suffix", "--chmod", "--chown", "--log-file", "--password-file", "--out-format", "--bwlimit", "--timeout", "--max-size", "--min-size", "--port"],
};

/**
 * The copy commands: their short letters that take a value, and whether `-t`, `-T` and `--target-directory` name a
 * target (GNU coreutils). rsync's `-t` is --times and its `-T` takes a folder; scp's `-t` is its own remote sink mode
 * and its `-T` a check it skips; so neither is read as a target there. A remote `host:path` operand of scp or rsync
 * resolves to no record directory.
 */
const COPIERS: Record<string, { valued: string; targets: boolean }> = {
  cp: { valued: "S", targets: true },
  mv: { valued: "S", targets: true },
  ln: { valued: "S", targets: true },
  install: { valued: "Smog", targets: true },
  rsync: { valued: "eBfTM", targets: false },
  scp: { valued: "cFiJloPSDX", targets: false },
};

/**
 * cp, mv, ln, install, rsync and scp: the destination (`-t DIR` alone or inside a short-option cluster, `-tDIR`,
 * `--target-directory`, else the last operand), the sources, whether `-T` makes the destination the copy itself,
 * and whether install only makes directories (`-d`, `--directory`: it then writes no file, as `mkdir`). A cluster is
 * read up to the first option that takes a value.
 */
function copyParts(cmd: string, rest: string[]): { dest: string | null; sources: string[]; noTarget: boolean; dirsOnly: boolean } {
  const { valued, targets } = COPIERS[cmd];
  let target: string | null = null;
  let noTarget = false;
  let dirsOnly = false;
  const operands: string[] = [];
  let options = true;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (options && a === "--") {
      options = false;
      continue;
    }
    if (options && a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = eq >= 0 ? a.slice(0, eq) : a;
      if (targets && name === "--target-directory") target = eq >= 0 ? a.slice(eq + 1) : rest[++i] ?? "";
      else if (targets && name === "--no-target-directory") noTarget = true;
      else if (cmd === "install" && name === "--directory") dirsOnly = true;
      else if (eq < 0 && COPY_LONG_VALUE[cmd]?.includes(name)) i++;
      continue;
    }
    if (options && a.startsWith("-") && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        const f = a[j];
        if (targets && f === "t") {
          target = j + 1 < a.length ? a.slice(j + 1) : rest[++i] ?? "";
          break;
        }
        if (targets && f === "T") noTarget = true;
        if (cmd === "install" && f === "d") dirsOnly = true;
        if (valued.includes(f)) {
          if (j + 1 === a.length) i++;
          break;
        }
      }
      continue;
    }
    operands.push(a);
  }
  if (target !== null) return { dest: target, sources: operands, noTarget, dirsOnly };
  return { dest: operands.length ? operands[operands.length - 1] : null, sources: operands.slice(0, -1), noTarget, dirsOnly };
}

/**
 * tar (extracting: `x` in its first word or in any short-option cluster, `--extract`, `--get`) and unzip: the folder
 * they write into (`-C DIR`, `-CDIR`, `--directory[=]DIR`; unzip's `-d`), which is the cwd when none is named; null
 * when they do not extract.
 */
function extractDir(cmd: string, rest: string[]): string | null {
  if (cmd === "tar" || cmd === "gtar" || cmd === "bsdtar") {
    let extract = rest.length > 0 && /^-?[A-Za-z]+$/.test(rest[0]) && !rest[0].startsWith("--") && rest[0].includes("x");
    let dir: string | null = null;
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === "--extract" || a === "--get" || (/^-[A-Za-z]+$/.test(a) && a.includes("x"))) extract = true;
      else if (a === "-C" || a === "--directory" || /^-[A-Za-z]*C$/.test(a)) dir = rest[++i] ?? "";
      else if (a.startsWith("--directory=")) dir = a.slice("--directory=".length);
      else if (/^-C./.test(a)) dir = a.slice(2);
    }
    return extract ? dir ?? "." : null;
  }
  if (cmd === "unzip") {
    if (rest.some((a) => /^-[A-Za-z]*[clptvZ]/.test(a) && !a.startsWith("-d"))) return null;
    let dir: string | null = null;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "-d") dir = rest[++i] ?? "";
      else if (/^-d./.test(rest[i])) dir = rest[i].slice(2);
    }
    return dir ?? ".";
  }
  return null;
}

/** Output options: short letters and long names whose value is a file (or a folder) the command writes. */
const OUTPUT_OPTIONS: Record<string, { short: string; long: string[] }> = {
  curl: { short: "o", long: ["--output", "--output-dir"] },
  wget: { short: "OP", long: ["--output-document", "--directory-prefix"] },
  sort: { short: "o", long: ["--output"] },
  iconv: { short: "o", long: ["--output"] },
};

/**
 * The editors that can edit their operands in place: the letters that take the rest of their cluster (or the next
 * word when last), the letters that take only the digits after them (perl's `-l` and `-0`, `-0x` with hex digits),
 * the long option that means in place, and whether options end at the first operand (perl and ruby read the words
 * after their script or first file as its arguments).
 */
const IN_PLACE: Record<string, { rest: string; digits: string; long: RegExp | null; stopAtOperand: boolean }> = {
  sed: { rest: "efl", digits: "", long: /^--in-place(=|$)/, stopAtOperand: false },
  perl: { rest: "eEMmIxdDFC", digits: "l0", long: null, stopAtOperand: true },
  ruby: { rest: "eEIrCxFK", digits: "0TW", long: null, stopAtOperand: true },
  yq: { rest: "opIs", digits: "", long: /^--(inplace|in-place)(=|$)/, stopAtOperand: false },
};

/**
 * Whether an editor of IN_PLACE edits in place: `i` as a flag letter before the first letter of its cluster that
 * takes a value (so `-MList::Util` and `-Ilib` are not `-i`), or its long option.
 */
function editsInPlace(cmd: string, rest: string[]): boolean {
  const e = IN_PLACE[cmd];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--") return false;
    if (a.startsWith("--")) {
      if (e.long?.test(a)) return true;
      continue;
    }
    if (!a.startsWith("-") || a === "-") {
      if (e.stopAtOperand) return false;
      continue;
    }
    for (let j = 1; j < a.length; j++) {
      const f = a[j];
      if (f === "i") return true;
      if (e.digits.includes(f)) {
        if (f === "0" && /[xX]/.test(a[j + 1] ?? "")) for (j++; /[0-9a-fA-F]/.test(a[j + 1] ?? ""); ) j++;
        else while (/[0-9]/.test(a[j + 1] ?? "")) j++;
        continue;
      }
      if (e.rest.includes(f)) {
        if (j + 1 === a.length) i++;
        break;
      }
    }
  }
  return false;
}

/** tar's short letters that take a value: the rest of a `-` cluster, else the next word; in the old form, the next words in order. */
const TAR_VALUED = "fCbFgHKLNTVXI";

/**
 * The archive tar writes when it creates, appends to, updates or deletes from one (`c`, `r`, `u`, `A` in a cluster or
 * the old-form first word; `--create`, `--append`, `--update`, `--catenate`, `--concatenate`, `--delete`): the value
 * of `-f`, of a cluster's `f`, of `--file[=]`, or of the old form's `f` (`tar cf FILE`). Null when it writes none.
 */
function tarArchive(rest: string[]): string | null {
  let writes = false;
  let file: string | null = null;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--") break;
    if (i === 0 && /^[A-Za-z]+$/.test(a)) {
      const values = [...a].filter((f) => TAR_VALUED.includes(f));
      if (/[cruA]/.test(a)) writes = true;
      for (const f of values) {
        const v = rest[++i] ?? "";
        if (f === "f") file = v;
      }
      continue;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = eq >= 0 ? a.slice(0, eq) : a;
      if (["--create", "--append", "--update", "--catenate", "--concatenate", "--delete"].includes(name)) writes = true;
      else if (name === "--file") file = eq >= 0 ? a.slice(eq + 1) : rest[++i] ?? "";
      continue;
    }
    if (!/^-[A-Za-z]/.test(a)) continue;
    for (let j = 1; j < a.length; j++) {
      const f = a[j];
      if ("cruA".includes(f)) writes = true;
      if (TAR_VALUED.includes(f)) {
        const v = j + 1 < a.length ? a.slice(j + 1) : rest[++i] ?? "";
        if (f === "f") file = v;
        break;
      }
    }
  }
  return writes && file !== null && file !== "" ? file : null;
}

/** The values of a command's output options: `-o FILE`, `-oFILE`, a cluster ending in the letter (`-sSo FILE`), `--output[=]FILE`. */
function outputValues(rest: string[], short: string, long: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--") break;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (long.includes(eq >= 0 ? a.slice(0, eq) : a)) out.push(eq >= 0 ? a.slice(eq + 1) : rest[++i] ?? "");
    } else if (/^-[A-Za-z]/.test(a)) {
      if (short.includes(a[1])) out.push(a.length > 2 ? a.slice(2) : rest[++i] ?? "");
      else if (/^-[A-Za-z]+$/.test(a) && short.includes(a[a.length - 1])) out.push(rest[++i] ?? "");
    }
  }
  return out;
}

/** Paths the shell itself writes for a simple command: its output redirections, and `<>` (opened for reading and writing). */
function redirectedPaths(s: Simple): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.w.length; i++) {
    if (s.ops.has(i) && /^(\d*|&)(>{1,2}[&|]?|<>)$/.test(s.w[i]) && s.w[i + 1] !== undefined && !/^&\d*$/.test(s.w[i + 1])) out.push(s.w[i + 1]);
  }
  return out;
}

/** The paths a simple command's standard input is read from: its `<` redirections. */
function inputPaths(s: Simple): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.w.length; i++) if (s.ops.has(i) && /^0?<$/.test(s.w[i]) && s.w[i + 1] !== undefined) out.push(s.w[i + 1]);
  return out;
}

/**
 * Whether a shell given no -c string reads its script from standard input: no script operand, `-s`, `-`, or a script
 * operand that names standard input (/dev/stdin, /dev/fd/0, /proc/self/fd/0).
 */
function readsStdin(rest: string[]): boolean {
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--") return rest[i + 1] === undefined || rest[i + 1] === "-" || STDIN_PATHS.has(rest[i + 1]);
    if (/^[-+]o$|^[-+]O$|^--(rcfile|init-file)$/.test(a)) {
      i++;
      continue;
    }
    if (a === "-" || /^-[A-Za-z]*s[A-Za-z]*$/.test(a)) return true;
    if (a.startsWith("-") || a.startsWith("+")) continue;
    return STDIN_PATHS.has(a);
  }
  return true;
}

/** A shell's script file: its first operand (read when it runs no -c string). */
function scriptFile(rest: string[]): string | null {
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--") return rest[i + 1] ?? null;
    if (/^[-+]o$|^[-+]O$|^--(rcfile|init-file)$/.test(a)) {
      i++;
      continue;
    }
    if (a.startsWith("-") || a.startsWith("+")) continue;
    return a;
  }
  return null;
}

/** The file `source` or `.` reads: its first operand. */
const sourced = (rest: string[]): string | null => (rest[0] === "--" ? rest[1] : rest[0]) ?? null;

/**
 * Whether a command (its words, no redirections) runs what comes on its standard input as a script: a shell that reads
 * its script from there (`sh`, `sudo sh`, `bash -s`, `bash /dev/stdin`), `source` or `.` of /dev/stdin, and `sudo -s`
 * or `-i` with no command.
 */
function runsStdin(args: string[]): boolean {
  const { k, script, shell } = commandIndex(args);
  if (shell) return true;
  if (script !== null || args[k] === undefined) return false;
  const cmd = nameOf(args[k]);
  const rest = args.slice(k + 1);
  if (SHELLS.has(cmd)) return shellString(rest) === null && readsStdin(rest);
  return (cmd === "source" || cmd === ".") && STDIN_PATHS.has(sourced(rest) ?? "");
}

/** The files a command runs as a script: its command word, a shell's script file, what `source` or `.` reads, and the `<` input of a command that runs its standard input. */
function filesRun(s: Simple, args: string[]): string[] {
  const { k, script } = commandIndex(args);
  const out: string[] = [];
  const first = args[k];
  if (script === null && first !== undefined) {
    const cmd = nameOf(first);
    const rest = args.slice(k + 1);
    out.push(first);
    if (SHELLS.has(cmd) && shellString(rest) === null) out.push(scriptFile(rest) ?? "");
    if (cmd === "source" || cmd === ".") out.push(sourced(rest) ?? "");
  }
  if (runsStdin(args)) out.push(...inputPaths(s));
  return out.filter((p) => p !== "");
}

/**
 * Whether the heredoc or here-string of command `n` of a line is run as a script by a route checkCommand does not see: a later command of its pipeline runs its standard input (`cat <<EOF | sh`, also past a
 * group's `}`); command `n` has no command word or is a group's `}`, and an earlier command runs its standard input
 * with no text of its own (`( bash ) <<EOF`, `{ sh; } <<EOF`); or command `n` writes a file (a `>` or `>>`
 * redirection, or tee's operand) that a later command runs (`bash f`, `source f`, `. f`, `./f`, `sh < f`), the paths
 * compared after expand and kernelPath.
 */
function runByAShell(list: Simple[], args: string[][], n: number, at: Where): boolean {
  const closer = (m: number): boolean => args[m].every((a) => a === "}");
  let m = n;
  while (!list[m].pipe && m + 1 < list.length && closer(m + 1)) m++;
  while (list[m].pipe && m + 1 < list.length) {
    m++;
    if (runsStdin(args[m])) return true;
  }
  if (closer(n) && list.slice(0, n).some((s, e) => s.stdin === null && runsStdin(args[e]))) return true;
  const key = (p: string): string => kernelPath(expand(p, at), at.cwd).toLowerCase();
  const { k } = commandIndex(args[n]);
  const tee = nameOf(args[n][k] ?? "") === "tee" ? args[n].slice(k + 1).filter((a) => !a.startsWith("-")) : [];
  const written = new Set([...redirectedPaths(list[n]), ...tee].map(key));
  if (written.size === 0) return false;
  return list.some((s, e) => e > n && filesRun(s, args[e]).some((p) => written.has(key(p))));
}

/** Read a whole command line; the first refusal found, or null. */
/**
 * PowerShell's cmdlets and their aliases that write, delete, copy or move, read as the
 * command of this reading they stand for (names compared without regard to case, as PowerShell does). An operand of a
 * cmdlet read as `touch` is taken as written, its parameter values included (`Set-Content -Path X -Value Y` names X and
 * Y): a value that names a guarded path is refused, which costs nothing elsewhere. What is not read is in
 * GUARD_BASH_LIMITS.
 */
const POWERSHELL_AS: Record<string, string> = Object.fromEntries([
  ...["remove-item", "ri", "del", "erase", "rd", "rmdir"].map((n) => [n, "rm"]),
  ...["set-content", "sc", "add-content", "ac", "out-file", "new-item", "ni", "clear-content", "clc"].map((n) => [n, "touch"]),
  ...["tee-object"].map((n) => [n, "tee"]),
  ...["copy-item", "cpi", "copy"].map((n) => [n, "cp"]),
  ...["move-item", "mi", "move"].map((n) => [n, "mv"]),
  ...["rename-item", "rni", "ren"].map((n) => [n, "rename"]),
  // A permission or attribute change makes a record unreadable without a write.
  ...["set-acl", "set-itemproperty", "sp", "clear-itemproperty", "clp"].map((n) => [n, "chmod"]),
]);
/**
 * THE COMMANDS THAT CHANGE A FILE'S PERMISSIONS, OWNER OR ATTRIBUTES:
 * each operand is read as a write (a record made unreadable or immutable is as lost to the program as one rewritten), and
 * a folder operand that holds the marker or the person's records is refused as its delete is. The mode, owner or ACL
 * operand (`000`, `root:root`, `u:x:---`, `+i`) names no guarded path and is read for nothing.
 */
const PERMISSION_CHANGERS = new Set(["chmod", "chown", "chgrp", "setfacl", "chattr", "chflags", "icacls", "cacls", "attrib", "takeown"]);

/**
 * A PowerShell command's words with its named parameters taken out (`-Path`, `-Force`, `-Path:X` keeps X), so that the
 * readings above see operands only; the value of `-Destination` (or `-Target`) is put last, where a copy's or a move's
 * destination is read. A switch's following word is kept as an operand, which reads more, never less.
 */
function powershellOperands(rest: string[]): string[] {
  const out: string[] = [];
  const last: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i] as string;
    const named = /^-([A-Za-z][A-Za-z0-9]*)(:(.*))?$/.exec(w);
    if (!named) {
      out.push(w);
      continue;
    }
    const isDest = /^(destination|target)$/i.test(named[1] as string);
    const value = named[2] !== undefined ? (named[3] ?? "") : isDest ? (rest[++i] ?? "") : null;
    if (value === null || value === "") continue;
    (isDest ? last : out).push(value);
  }
  return [...out, ...last];
}

/** A command line in each of its tool's readings (`readingsOf`): the first refusal any of them gives. */
function checkLine(command: string, at: Where, depth: number): HookDecision | null {
  for (const bs of readingsOf(at)) {
    const hit = checkLineAs(command, at, depth, bs);
    if (hit) return hit;
  }
  return null;
}

function checkLineAs(command: string, at: Where, depth: number, bs: Backslash): HookDecision | null {
  const list = simpleCommands(command, bs);
  // A word this reading made into an operator, and the word after it, are the shell's, not the command's.
  const args = list.map((s) => s.w.filter((_, i) => !s.ops.has(i) && !(i > 0 && s.ops.has(i - 1))));
  for (let n = 0; n < list.length; n++) {
    for (const p of redirectedPaths(list[n])) {
      const dir = dirOfWord(p, at);
      if (dir) return denyFor(`the command's write to ${p}`, dir);
    }
    const hit = checkCommand(args[n], at, depth, list[n].stdin);
    if (hit) return hit;
  }
  if (depth >= MAX_SHELL_DEPTH) return null;
  for (let n = 0; n < list.length; n++) {
    const text = list[n].stdin;
    const hit = text !== null && runByAShell(list, args, n, at) ? checkLine(text, at, depth + 1) : null;
    if (hit) return hit;
  }
  return null;
}

/** Read one command's words (no redirections): what its program writes, and the commands it runs. `stdin`: the text a heredoc or here-string gives it. */
function checkCommand(args: string[], at: Where, depth: number, stdin: string | null = null): HookDecision | null {
  const { k, script, shell } = commandIndex(args);
  if (script !== null) return depth < MAX_SHELL_DEPTH ? checkLine(script, at, depth + 1) : null;
  // `sudo -s` or `-i` with no command: the shell it starts reads the heredoc or here-string.
  if (shell && stdin !== null && depth < MAX_SHELL_DEPTH) {
    const hit = checkLine(stdin, at, depth + 1);
    if (hit) return hit;
  }
  const first = args[k] ?? "";
  // The program writing its own directories is the design.
  if (PROGRAM.test(first) || (nameOf(first) === "node" && PROGRAM.test(args[k + 1] ?? ""))) return null;
  const cmd = at.powershell ? (POWERSHELL_AS[nameOf(first).toLowerCase()] ?? nameOf(first)) : nameOf(first);
  const rest = at.powershell ? powershellOperands(args.slice(k + 1)) : args.slice(k + 1);
  const deny = (p: string, how = "the command's write to"): HookDecision | null => {
    const dir = dirOfWord(p, at);
    return dir ? denyFor(`${how} ${p}`, dir) : null;
  };
  const firstOf = (list: (HookDecision | null)[]): HookDecision | null => list.find((d) => d !== null) ?? null;

  if (SHELLS.has(cmd)) {
    const inner = shellString(rest) ?? (stdin !== null && readsStdin(rest) ? stdin : null);
    return inner !== null && depth < MAX_SHELL_DEPTH ? checkLine(inner, at, depth + 1) : null;
  }
  // `source` or `.` of /dev/stdin runs the heredoc or here-string.
  if ((cmd === "source" || cmd === ".") && stdin !== null && STDIN_PATHS.has(sourced(rest) ?? "") && depth < MAX_SHELL_DEPTH) {
    const hit = checkLine(stdin, at, depth + 1);
    if (hit) return hit;
  }
  if (cmd === "eval") return depth < MAX_SHELL_DEPTH ? checkLine(rest.join(" "), at, depth + 1) : null;
  if (cmd === "xargs") return checkCommand(xargsCommand(rest), at, depth);
  if (cmd === "find") {
    const f = findParts(rest);
    const deleted = f.deletes ? firstOf(f.starts.map((s) => deny(s, "the command's delete under"))) : null;
    if (deleted) return deleted;
    // A delete under a folder that holds the active-run marker can remove it; find starts at `.` where none is named.
    const holder = f.deletes ? (f.starts.length > 0 ? f.starts : ["."]).find((s) => holdsMarker(s, at)) : undefined;
    if (holder !== undefined) return denyFor(`the command's delete under ${holderText(holder)}`, MARKER_FILE);
    const stateHolder = f.deletes ? (f.starts.length > 0 ? f.starts : ["."]).find((s) => holdsStateRecord(s, at) !== null) : undefined;
    if (stateHolder !== undefined) return denyFor(`the command's delete under ${stateHolderText(stateHolder)}`, holdsStateRecord(stateHolder, at));
    return firstOf(f.execs.map((e) => checkCommand(e, at, depth)));
  }

  const written: string[] = [];
  for (const x of rest) if (x.startsWith("of=")) written.push(x.slice(3));
  const operands = rest.filter((a) => !a.startsWith("-"));
  if (cmd === "tee" || cmd === "sponge") written.push(...operands);
  // mkdir, rmdir and `install -d` are left out: an empty directory holds no record, and SKILL.md step 1a creates each
  // working directory empty. A move's or copy's source is not read: moving files out is what step 1a asks, before
  // the run; a record moved away during the run is `missing` at the ledger check (a guarded file's is read: M4, below). `mkfifo` and `mknod` make a file
  // where a record is read (a named pipe under verdicts/ hung two commands), so their
  // operands are writes too.
  if (["rm", "touch", "truncate", "unlink", "shred", "mkfifo", "mknod"].includes(cmd) || PERMISSION_CHANGERS.has(cmd)) written.push(...operands);
  if (IN_PLACE[cmd] && editsInPlace(cmd, rest)) written.push(...operands);
  const output = OUTPUT_OPTIONS[cmd];
  if (output) written.push(...outputValues(rest, output.short, output.long));
  const archive = cmd === "tar" || cmd === "gtar" || cmd === "bsdtar" ? tarArchive(rest) : null;
  if (archive !== null) written.push(archive);
  const hit = firstOf(written.filter((p) => p !== "").map((p) => deny(p)));
  if (hit) return hit;
  // The delete of a folder that holds the active-run marker.
  const deletedHolder = ["rm", "unlink", "shred"].includes(cmd) || PERMISSION_CHANGERS.has(cmd) ? operands.find((p) => holdsMarker(p, at)) : undefined;
  if (deletedHolder !== undefined) return denyFor(`the command's delete of ${holderText(deletedHolder)}`, MARKER_FILE);
  // The delete of a folder that holds the person's records, in every window.
  const deletedState = ["rm", "unlink", "shred"].includes(cmd) || PERMISSION_CHANGERS.has(cmd) ? operands.find((p) => holdsStateRecord(p, at) !== null) : undefined;
  if (deletedState !== undefined) return denyFor(`the command's ${PERMISSION_CHANGERS.has(cmd) ? "permission change" : "delete"} of ${stateHolderText(deletedState)}`, holdsStateRecord(deletedState, at));

  // M4: a move or rename whose SOURCE is a guarded file takes it away from where the program reads it - the
  // ledger and the question file moved away let the pre-launch step run past an unanswered round (F11, F16) - so it is
  // refused like a write. A record directory's own files may still be moved out (step 1a, before a run; the ledger check
  // at the assembly finds a record missing), and a folder above the files is the stated limit (GUARD_BASH_LIMITS).
  const removesSources = cmd === "mv" || (cmd === "rsync" && rest.some((a) => a === "--remove-source-files" || a === "--remove-sent-files"));
  const movedFrom = removesSources ? copyParts(cmd, rest).sources : cmd === "rename" ? operands : [];
  const moved = firstOf(
    movedFrom.map((src) => {
      const f = dirOfWord(src, at);
      return f !== null && isGuardedName(f) ? denyFor(`the command's move of ${src}`, f) : null;
    }),
  );
  if (moved) return moved;
  // The move of a folder that holds the active-run marker.
  const movedHolder = movedFrom.find((src) => holdsMarker(src, at));
  if (movedHolder !== undefined) return denyFor(`the command's move of ${holderText(movedHolder)}`, MARKER_FILE);
  const movedState = movedFrom.find((src) => holdsStateRecord(src, at) !== null);
  if (movedState !== undefined) return denyFor(`the command's move of ${stateHolderText(movedState)}`, holdsStateRecord(movedState, at));
  if (COPIERS[cmd]) {
    const c = copyParts(cmd, rest);
    if (c.dirsOnly || c.dest === null || c.dest === "") return null;
    const into = deny(c.dest);
    if (into) return into;
    // A copy or move into a folder that lands on one of the declaration's files by its name (hardening 2).
    const landed = firstOf(
      c.sources.map((s) => {
        const f = dirOfWord(join(c.dest as string, baseOf(s)), at);
        return f !== null && isGuardedName(f) ? denyFor(`the command's copy of ${s} into ${c.dest}`, f) : null;
      }),
    );
    if (landed) return landed;
    const whole = c.noTarget || c.sources.some((s) => baseOf(s) === "." || (cmd === "rsync" && /[\\/]$/.test(s)));
    if (!isLegalItself(c.dest, at)) {
      // A whole folder's contents copied into a folder that directly holds a guarded file land on it by its name.
      const held = whole ? guardedFileIn(c.dest, at) : null;
      return held !== null ? denyFor(`the command's copy of a whole folder's contents into ${c.dest} (${c.sources.join(" ")})`, held) : null;
    }
    // Into .legal itself: a source named like a record directory lands on it; a whole folder's contents land on all of them.
    const named = c.sources.map((s) => baseOf(s).toLowerCase()).find((b) => RECORD_DIRS.includes(b));
    if (named) return denyFor(`the command's copy of ${named}/ into .legal/`, named);
    return whole ? denyFor(`the command's copy of a whole folder's contents into .legal/ (${c.sources.join(" ")})`, null) : null;
  }
  const into = extractDir(cmd, rest);
  if (into !== null) {
    const dir = dirOfWord(into, at);
    if (dir) return denyFor(`the command's extraction into ${into}`, dir);
    if (isLegalItself(into, at)) return denyFor(`the command's extraction into ${into}`, null);
    // An archive extracted into a folder that directly holds a guarded file lands on it by its name.
    const held = guardedFileIn(into, at);
    if (held !== null) return denyFor(`the command's extraction into ${into}`, held);
  }
  return null;
}

/**
 * A refusal with where the run stands: the guard acts only while the event belongs to the active run (integration part
 * B item 3). In the run's window it names the program's own commands for where the run stands and what to launch next,
 * and says that ending the run is the person's decision (SKILL.md step 4). Before this it
 * told the orchestrator to end the run itself with run-abort wherever it inferred that no scan was running.
 */
function withRunEnd(d: HookDecision | null, ctx: HookContext, at: Where): HookDecision {
  if (!d || d.kind !== "deny" || !ctx.run || STATE_DENIALS.has(d) || at.window === "none") return d ?? PASS;
  if (at.window === "declaration") {
    return {
      ...d,
      reason: `${d.reason} This refusal holds in this session from its last scan (recorded in the declaration ledger), whether or not that scan asked anything, until the run that follows it ends; a person who means to change the file by hand does it outside this Claude Code session.`,
    };
  }
  const { launch } = windows();
  return {
    ...d,
    reason:
      `${d.reason} This refusal holds while this session's scan run is active (its marker ${join(ctx.run.launchDir, ACTIVE_RUN_FILE)} stands). ` +
      `Where the run stands: ${launch.scannerCommand(["run-status", "--launch-list", ctx.run.listPath])}; what to launch next: ${launch.launchNextCommand(ctx.run.launchDir)}. ` +
      `A run is never ended on an inference that it is over: ${launch.personEndsText(ctx.run.launchDir)}.`,
  };
}

/**
 * THE DEEPER CHECKS' ROWS (design rf13 3.9, "What WolfBoy itself can still cause" and
 * section 9's guard row). A deeper check writes one test file under
 * `.legal/deep/<id>/<time>/` and prints the lines that copy it to its runnable name, run the copy and delete it, for the
 * person's own terminal. These rows refuse, in EVERY SESSION the plugin's hooks run in, whether or not a scan, a run or
 * a check is under way, and whoever makes the call:
 *   - a call of a command tool (Bash, PowerShell, Monitor: `tool_input.command`) or of the VS Code extension's code tool
 *     (`mcp__ide__executeCode`: `tool_input.code`) whose text names `.legal/deep` (`/` or `\\`) or the test name of a
 *     check on record (`legal_check_<id>`, `LegalCheck<id>`, read with case, `_`, `-` and spaces ignored), so that every
 *     runner's copy, run and delete line is refused, and so is a read of the check's files through a command;
 *   - a Write, Edit, MultiEdit or NotebookEdit of a path under `.legal/deep`, or whose name holds such a test name (a
 *     copy made by writing the file).
 * The checks on record are the `test_id`s of every line of the deeper checks' record in the person's state folder
 * (state-record.ts DEEP_CHECKS_RECORD), read whole for every call (one folder read). The rows read the text as written
 * (GUARD_BASH_LIMITS, last item); the scan-time rows keep their windows (whereOf), so no scan-time row acts in a later
 * session. Best effort, like every row: off whenever the hook cannot start.
 */
const DEEP_PATH_TEXT = /\.legal[\\/]+deep(?![A-Za-z0-9_.-])/i;
const DEEP_TEST_ID = /^[A-Za-z0-9]{4,40}$/;
const DEEP_RECORD_FILES_MAX = 512;
const DEEP_RECORD_BYTES_MAX = 4 * 1024 * 1024;
/** The refusal's fixed sentence (crf11d-r2 W7; design 3.9). */
export const DEEP_GUARD_SENTENCE =
  "WolfBoy's guard: a deeper check's test files are copied, run and deleted only in your own terminal; to delete a leftover copy, run the rm line there.";

/**
 * What `deepTestIds` holds where the record or its folder is there
 * and cannot be read (a permission change, a file that is not a regular one, one over the size limit): the rows then
 * refuse every name of the test-name form (fail closed), since the ids they would refuse are not known.
 */
export const DEEP_RECORD_UNREAD = "*";
/** What such a refusal names. */
const DEEP_UNREAD_NAMED = "a deeper check's test name (legal_check_..., LegalCheck...), refused while the record of the deeper checks cannot be read";

/**
 * Every `test_id` on the deeper checks' record in the state folder, lower-cased; none where there is no record, and
 * `DEEP_RECORD_UNREAD` where the record or its folder is there and does not read.
 */
export function deepTestIds(stateDir: string | null = processStateDir()): string[] {
  if (stateDir === null) return [];
  const dir = join(stateDir, DEEP_CHECKS_RECORD.folder);
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(DEEP_CHECKS_RECORD.extension));
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT" ? [] : [DEEP_RECORD_UNREAD];
  }
  if (names.length > DEEP_RECORD_FILES_MAX) return [DEEP_RECORD_UNREAD];
  const ids = new Set<string>();
  for (const n of names) {
    let text: string;
    try {
      const p = join(dir, n);
      if (lstatSync(p).size > DEEP_RECORD_BYTES_MAX) return [DEEP_RECORD_UNREAD];
      text = readRegularFile(p, "utf8");
    } catch (e) {
      // A record removed between the listing and the read holds no id; any other failure leaves the ids unknown.
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      return [DEEP_RECORD_UNREAD];
    }
    for (const l of text.split("\n")) {
      if (!l.includes("test_id")) continue;
      try {
        const id = (JSON.parse(l) as Record<string, unknown>).test_id;
        if (typeof id === "string" && DEEP_TEST_ID.test(id)) ids.add(id.toLowerCase());
      } catch {
        // not a line of the record
      }
    }
  }
  return [...ids];
}

/** The text with `/./` steps taken out, so that `.legal/./deep` reads as `.legal/deep`. */
const withoutDotSteps = (text: string): string => text.replace(/[\\/]\.(?=[\\/])/g, "");
/** The test name of a check on record that `text` names, or null. */
function deepTestNamed(text: string, ids: readonly string[]): string | null {
  if (ids.length === 0) return null;
  const flat = text.toLowerCase().replace(/[_\-\s]/g, "");
  if (ids.includes(DEEP_RECORD_UNREAD)) return /legalcheck[a-z0-9]{4}/.test(flat) ? DEEP_RECORD_UNREAD : null;
  for (const id of ids) if (flat.includes(`legalcheck${id}`)) return `legal_check_${id}`;
  return null;
}

/** What a deeper check's row refuses in `text` (a command, code, or a path), or null. */
export function deepRowNamed(text: string, ids: readonly string[] = deepTestIds()): string | null {
  if (DEEP_PATH_TEXT.test(withoutDotSteps(text))) return ".legal/deep/";
  const name = deepTestNamed(text, ids);
  return name === null ? null : name === DEEP_RECORD_UNREAD ? DEEP_UNREAD_NAMED : `the test name of a deeper check on record (${name})`;
}

function deepDenial(target: string, namedRaw: string): HookDecision {
  // The target is the tool's input: its control characters as escapes (`valueText`).
  const what = valueText(target);
  const named = valueText(namedRaw);
  const d: HookDecision = {
    kind: "deny",
    reason: `wolfboy: ${what} is refused: it names ${named}. ${DEEP_GUARD_SENTENCE} This refusal holds in every session.`,
  };
  STATE_DENIALS.add(d);
  return d;
}

/**
 * The state records' folders as text, for the code tool (best effort): `legal-scan/<folder>` with either separator,
 * and each folder's full path as the hook's environment names it.
 */
function stateRecordNamed(code: string): string | null {
  const flat = code.replace(/\\+/g, "/").toLowerCase();
  // The redaction key, by either of its places.
  if (flat.includes(`legal-scan/${REDACTION_KEY_FILE}`) || flat.includes("wolfboy-redaction-key")) return STATE_WRITTEN_BY[KEY_ROW].noun;
  for (const r of GUARDED_STATE_RECORDS) if (flat.includes(`legal-scan/${r.kind.folder}`)) return `${r.noun} (legal-scan/${r.kind.folder}/ in the person's own state folder)`;
  return null;
}

/**
 * PreToolUse on the VS Code extension's code tool (`mcp__ide__executeCode`; crf11d-r2 W4): its `tool_input.code` read with
 * the rows that act in every session, as text: the deeper checks' rows and the person's records in the state folder.
 */
export function onCode(ctx: HookContext): HookDecision {
  const code = (ctx.input.tool_input as Record<string, unknown> | undefined)?.code;
  if (typeof code !== "string") return PASS;
  const deep = deepRowNamed(code);
  if (deep !== null) return deepDenial(`${String(ctx.input.tool_name)} code`, deep);
  const state = stateRecordNamed(code);
  if (state === null) return PASS;
  const d: HookDecision = {
    kind: "deny",
    reason: `wolfboy: ${String(ctx.input.tool_name)} code is refused: it names ${state}. Do not write, edit, move or delete the person's records, whoever asks. This refusal holds in every session.`,
  };
  STATE_DENIALS.add(d);
  return d;
}

/**
 * Two rows for the file tools, in every session:
 * - A `.git` written at, or at any folder above, a place the program refuses inside a git work tree: the state folder
 *   (`legal-scan/`), the redaction key's spare folder and Claude Code's transcript folder for this session; not at the
 *   OS account's home folder or above it, where the place rule does not count the work tree (state-record.ts
 *   `workTreeCounted`). One empty `.git` there made every record "inside a git work tree", stopping every scan.
 * - A write into Claude Code's transcript folder for this session (the folder of the event's `transcript_path`, which
 *   holds the seats' transcripts too): the assembly's transcript check reads those files as Claude Code wrote them.
 * A Bash command is outside these rows (design 3.4's stated limit).
 */
function placeRowDenial(target: string, t: Located, ctx: HookContext): HookDecision | null {
  // The target is the tool's input: its control characters as escapes (`valueText`).
  const what = valueText(target);
  const transcript = typeof ctx.input.transcript_path === "string" && isAbsolute(ctx.input.transcript_path) ? dirname(ctx.input.transcript_path) : null;
  const stateDir = processStateDir();
  const places: { place: string; noun: string }[] = [
    ...(stateDir === null ? [] : [{ place: stateDir, noun: "the person's own state folder, which holds their records" }]),
    { place: redactionKeyPlaces().spare, noun: "the folder that holds the redaction key where the state folder cannot" },
    ...(transcript === null ? [] : [{ place: transcript, noun: "the folder where Claude Code keeps this session's transcripts" }]),
  ];
  // Both rows by identity (file-identity.ts): the `.git` found among the
  // target's names as the file system reads them, the places compared as files, not as text.
  const g = t.names.indexOf(".git");
  if (g >= 0) {
    const above = locate(t.root + t.parts.slice(0, g).join(sep), t.root);
    for (const p of places) {
      if (!atOrInside(locate(p.place, t.root), above) || !workTreeCounted(above.path)) continue;
      const d: HookDecision = {
        kind: "deny",
        reason: `wolfboy: ${what} is refused: a .git there would put ${p.noun} inside a git work tree, where WolfBoy keeps nothing and reads nothing, and every scan would stop. This refusal holds in every session.`,
      };
      STATE_DENIALS.add(d);
      return d;
    }
  }
  if (transcript !== null && atOrInside(t, locate(transcript, t.root))) {
    const d: HookDecision = {
      kind: "deny",
      reason: `wolfboy: ${what} is refused: it reaches the folder where Claude Code keeps this session's transcripts (${valueText(transcript)}), which only Claude Code writes; WolfBoy's assembly reads them as Claude Code wrote them. This refusal holds in every session.`,
    };
    STATE_DENIALS.add(d);
    return d;
  }
  return null;
}

/**
 * PreToolUse on Read, Grep and Glob, in
 * every session: the redaction key is not read by any tool call, whoever makes it. Refused: a Read whose path, as named
 * or with every link resolved, is the key file or lies in the spare folder, compared with the key's and the spare's own
 * real paths too, so a link a commit plants, or a state folder reached through a link, does not reach it; and a Grep or
 * Glob of the key, the spare folder, or ANY folder that holds either (the state folder, `~/.local/state`, `~/.local`,
 * the home folder, the root), since Claude Code's search engine prints the key's line from any of them. A Grep of the
 * project, or of any folder that holds neither, passes. A Bash command is the stated limit. A Glob whose pattern climbs with `..`
 * (or starts at the root) names, before its first wildcard, a folder outside the one searched; Claude Code may move the
 * Glob's folder up to it, so that folder, in each of its readings (`otherReadings`), is searched too: a Glob whose
 * pattern climbs to a folder that holds the key is a Glob of that folder, refused the same way (the parent's decision of
 * 2026-11-10 on R10-DOTDOT's Q1). So is a pattern whose folder lies inside the one
 * searched by its text: a link there can lead anywhere, so its folder is read by its real path like any other.
 */
export function onKeyRead(ctx: HookContext): HookDecision {
  const ti = (ctx.input.tool_input ?? {}) as Record<string, unknown>;
  const tool = String(ctx.input.tool_name);
  const cwd = typeof ctx.input.cwd === "string" && isAbsolute(ctx.input.cwd) ? ctx.input.cwd : (ctx.run?.projectDir ?? process.cwd());
  const named = tool === "Read" ? ti.file_path : ti.path;
  if (tool === "Read" && (typeof named !== "string" || named === "")) return PASS;
  const given = typeof named === "string" && named !== "" ? homePath(named, process.env[HOME_ENV] ?? "") : cwd;
  const key = redactionKeyPlaces();
  const places = [key.file, key.spare].flatMap((k): Located[] => (k === null ? [] : [locate(k, cwd)]));
  const searched: Array<readonly [string, string]> = [[typeof named === "string" && named !== "" ? named : cwd, given]];
  const lead = tool === "Glob" && typeof ti.pattern === "string" ? patternLead(homePath(ti.pattern, process.env[HOME_ENV] ?? "")) : "";
  // Every pattern's folder, not only one that climbs
  // with `..` or starts at the root: a folder inside the searched one by its text can be a link to a folder elsewhere
  // (`stt/l?gal-scan/r*` under `src`, `src/stt` a link to `~/.local/state`), and its real path is what is searched.
  if (lead !== "") {
    const folder = isAbsolute(lead) ? lead : `${given.replace(/[\\/]+$/, "")}${sep}${lead}`;
    for (const f of [folder, ...otherReadings(folder, cwd)]) searched.push([f, f]);
  }
  for (const [shown, path] of searched) {
    // By identity (file-identity.ts `atOrInside`): every spelling of the key's
    // path that opens the key, a link to it and a hard link to it included, is the key.
    const t = locate(path, cwd);
    const inside = places.some((k) => atOrInside(t, k));
    if (!inside && (tool === "Read" || !places.some((k) => atOrInside(k, t)))) continue;
    const above = !inside;
    const d: HookDecision = {
      kind: "deny",
      reason:
        `wolfboy: this ${tool} of ${valueText(shown)} is refused: it reaches ${STATE_WRITTEN_BY[KEY_ROW].noun}${above ? ", which lies in a folder below the one searched" : ""}. Whoever knows the key can undo every redaction WolfBoy made with it, so no tool call reads it, whoever asks. ` +
        `${above ? "Search the project, or a folder that does not hold WolfBoy's state folder, instead. " : ""}This refusal holds in every session.`,
    };
    STATE_DENIALS.add(d);
    return d;
  }
  return PASS;
}

/** PreToolUse on Write, Edit, MultiEdit and NotebookEdit: the target path. */
export function onFileWrite(ctx: HookContext): HookDecision {
  const ti = (ctx.input.tool_input ?? {}) as Record<string, unknown>;
  const target = ctx.input.tool_name === "NotebookEdit" ? ti.notebook_path : ti.file_path;
  if (typeof target !== "string" || target === "") return PASS;
  const cwd = typeof ctx.input.cwd === "string" && isAbsolute(ctx.input.cwd) ? ctx.input.cwd : (ctx.run?.projectDir ?? process.cwd());
  // A `~/` target is the home folder's, as Claude Code opens it (hook.ts `homePath`).
  const home = homePath(target, process.env[HOME_ENV] ?? "");
  // The target located once, by identity (file-identity.ts), for every row below.
  const t = locate(home, cwd);
  // The deeper checks' rows first: they hold in every session. Read on the name as
  // written, as the file system spells it, and as it reads each name (case, a trailing dot, a stream suffix).
  const deep = deepRowNamed(home) ?? deepRowNamed(t.path) ?? deepRowNamed(`/${t.names.join("/")}`);
  if (deep !== null) return deepDenial(`${ctx.input.tool_name} of ${valueText(target)}`, deep);
  const placed = placeRowDenial(`${ctx.input.tool_name} of ${target}`, t, ctx);
  if (placed !== null) return placed;
  const at = whereOf(ctx, true);
  const dir = at === null ? null : dirOf(t, at);
  if (at !== null && dir !== null) return withRunEnd(denyFor(`${ctx.input.tool_name} of ${target}`, dir), ctx, at);
  // Any project's run files, not only this session's project: a session opened
  // in another folder, steered there, wrote this project's launch events, reservations, marker and capture ledger.
  const other = legalRunDirOf(t);
  if (other !== null) return elsewhereDenial(`${ctx.input.tool_name} of ${target}`, other);
  // And WolfBoy's run files and outputs (hook.ts
  // RUN_OUTPUTS), in every session and any project, as the record directories are: the plan, the findings, the logs and
  // the reports are read back as the program wrote them.
  const output = legalRunOutputOf(t, home);
  return output === null ? PASS : outputDenial(`${ctx.input.tool_name} of ${target}`, output);
}

/**
 * The readings of a file tool's path other than the
 * one the guard rows take (`locate`), where the tool may open another file than that one: on macOS and Linux, a path
 * with a `..` name after a symbolic link, read by its text as well as by the kernel (file-identity.ts `dotDotReadings`);
 * on Windows, a Git Bash spelling (`/c/<path>`, `/cygdrive/c/<path>`, `/tmp/...`) read as Git Bash opens it
 * (`gitBashPath`) as well as by Windows' own path rules, which read it against the current drive's root (`D:\c\<path>`).
 * Which of them Claude Code's file tools open is not documented; the guard refuses where either names a protected file
 * or folder (the parent's decision of 2026-11-10). `named` is the path as given, after a leading `~` (hook.ts `homePath`).
 */
export function otherReadings(named: string, cwd: string, platform: NodeJS.Platform = process.platform, temp: string = tmpdir()): string[] {
  if (platform !== "win32") return dotDotReadings(named, cwd);
  // Each reading of the Git Bash path.
  return gitBashReadings(named, platform, temp, cwd).filter((r) => r !== named);
}

/** The field of a file tool's input that names its path (an empty or missing one is the working folder). */
const PATH_FIELD: Readonly<Record<string, string>> = { Read: "file_path", Write: "file_path", Edit: "file_path", MultiEdit: "file_path", NotebookEdit: "notebook_path", Grep: "path", Glob: "path" };

/**
 * A file guard's decision (`onFileWrite`,
 * `onKeyRead`, hook-seat-read.ts `onSeatRead`) on the path as given and, where the tool may open another file
 * (`otherReadings`), on each other reading in its place: the first refusal, else the decision on the path as given.
 * It only adds refusals: a call the guard refused on the path as given is refused as before.
 */
export async function onEveryReading(ctx: HookContext, decide: (ctx: HookContext) => HookDecision | Promise<HookDecision>): Promise<HookDecision> {
  const first = await decide(ctx);
  if (first.kind === "deny") return first;
  const field = PATH_FIELD[String(ctx.input.tool_name)];
  const ti = (typeof ctx.input.tool_input === "object" && ctx.input.tool_input !== null ? ctx.input.tool_input : {}) as Record<string, unknown>;
  const named = field === undefined ? undefined : ti[field];
  if (typeof named !== "string" || named === "") return first;
  const cwd = typeof ctx.input.cwd === "string" && isAbsolute(ctx.input.cwd) ? ctx.input.cwd : (ctx.run?.projectDir ?? process.cwd());
  for (const other of otherReadings(homePath(named, process.env[HOME_ENV] ?? ""), cwd)) {
    const d = await decide({ ...ctx, input: { ...ctx.input, tool_input: { ...ti, [field as string]: other } } });
    if (d.kind === "deny") return d;
  }
  return first;
}

/**
 * The record directory (RECORD_DIRS) of any project's `.legal` that a located
 * path is or lies in, read on the names as the file system reads them; null where none. The window files lie under
 * `launch/`, one of them.
 */
function legalRunDirOf(t: Located): string | null {
  for (let j = 0; j + 1 < t.names.length; j++) if (t.names[j] === ".legal" && RECORD_DIRS.includes(t.names[j + 1])) return t.names[j + 1];
  return null;
}

/**
 * The run file or output (hook.ts RUN_OUTPUTS) of any
 * project's `.legal` that a located path is, or lies in for a folder's entry; null where none. Read on the names as the file
 * system reads them and on the path as given, each name compared without regard to case, a trailing dot or space, or a
 * stream suffix (`findings.json::$DATA`), so no spelling that opens the file escapes; one that names another file is
 * refused too, which costs nothing (no step writes such a name).
 */
function legalRunOutputOf(t: Located, given: string): string | null {
  const fold = (n: string): string => n.toLowerCase().replace(/:.*$/, "").replace(/[. ]+$/, "");
  for (const names of [t.names, given.split(/[\\/]+/)]) {
    const f = names.map(fold);
    for (let j = 0; j + 1 < f.length; j++) {
      if (f[j] !== ".legal") continue;
      const next = f[j + 1] as string;
      if (Object.hasOwn(RUN_OUTPUTS, `${next}/`) && j + 2 < f.length) return `${next}/`;
      if (j + 2 === f.length && Object.hasOwn(RUN_OUTPUTS, next)) return next;
      if (j + 2 === f.length && Object.hasOwn(RUN_OUTPUTS, `${next}/`)) return `${next}/`;
    }
  }
  return null;
}

/** A file tool's write of a run file or output. */
function outputDenial(target: string, output: string): HookDecision {
  const d: HookDecision = {
    kind: "deny",
    reason:
      `wolfboy: ${valueText(target)} is refused: it reaches .legal/${output} of a scanned project, which ${RUN_OUTPUTS[output] ?? "the program writes"}. ` +
      "Do not write or edit it, in this project or any other: the next step, and the person, read it as the program wrote it. This refusal holds in every session.",
  };
  STATE_DENIALS.add(d);
  return d;
}

/** A file tool's write into a record directory of a `.legal` other than this run's. */
function elsewhereDenial(target: string, dir: string): HookDecision {
  const d: HookDecision = {
    kind: "deny",
    reason:
      `wolfboy: ${valueText(target)} is refused: it reaches .legal/${dir}/ of a scanned project, where ${WRITTEN_BY[dir] ?? "the program writes every file"}. ` +
      "Do not write, edit, move or delete files there, in this project or any other: a scan run reads them as the program wrote them. This refusal holds in every session.",
  };
  STATE_DENIALS.add(d);
  return d;
}

/**
 * PreToolUse on Bash, PowerShell and Monitor: a best-effort, word-level
 * reading of the command's write forms. Each tool hands its command in `tool_input.command` (Claude Code's tools
 * reference: PowerShell has "the same fields as the Bash tool"; a Monitor watch of a WebSocket takes `ws` in place of
 * `command`, and runs no command). A PowerShell command is read with the same reading, its cmdlets as POWERSHELL_AS maps them.
 */
export function onBash(ctx: HookContext): HookDecision {
  const command = (ctx.input.tool_input as Record<string, unknown> | undefined)?.command;
  if (typeof command !== "string") return PASS;
  // The deeper checks' rows first: they hold in every session.
  const deep = deepRowNamed(command);
  if (deep !== null) return deepDenial(`this ${String(ctx.input.tool_name)} command`, deep);
  const at = whereOf(ctx);
  if (!at) return PASS;
  return withRunEnd(checkLine(command, at, 0), ctx, at);
}

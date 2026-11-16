/**
 * ONE FAILURE BOUNDARY FOR THE RELAY'S COMMANDS (relay integration part B, area γ, item 4).
 *
 * Five path inputs ended `assemble-report` in a stack trace (a carried entry
 * that is a directory, a carried directory it may not read, a `--verdicts` naming a file, an assembled
 * entry that is a directory, a ledger entry naming a directory) and three findings documents that did
 * the same to `adjudicate` and to the assembly. Each could have been given a `try` of its own; the
 * class is fixed here instead, once: `runAtBoundary` runs the ONE call that runs every action
 * (`parseAsync`), and a throw out of a relay command's action ends in one named line on stderr and
 * that command's own "input unusable" exit code - never a stack trace. The actions write last, so a
 * throw leaves nothing written (each command's record says where it writes).
 *
 * A command that is not the relay's is rethrown unchanged: its behaviour is not this unit's to change. One is named since
 * (`PLAIN_REFUSAL_EXITS`): `ropa`, whose refusals of a layer-2 input it cannot use ended in a Node stack that
 * quoted the input. Whatever reaches stderr, here or in a stack, goes through the printed redaction (printed-output.ts).
 */
import { isFileHeldRefusal, isLinkRefusal } from "./project-write.js";
import { isLaunchRecordRefusal } from "./state-record.js";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { LATER_EXIT } from "./launch-later.js";
import { CAPTURE_EXIT } from "./verdict-capture.js";
import { StartupRefusal } from "./startup-refusal.js";

/** Each relay command's exit code for an input it cannot use: the code its own help already gives it. */
export const RELAY_COMMAND_EXITS: Readonly<Record<string, number>> = {
  "assemble-report": 1,
  adjudicate: 2,
  "verdict-capture": CAPTURE_EXIT.unreadable,
  "verdict-verify": 2,
  "verdict-reading": 2,
  "refuter-entries": LATER_EXIT.unreadable,
  "silence-entries": LATER_EXIT.unreadable,
  // The run's three status commands behind the same boundary. run-status
  // exits 2 on a launch list it cannot read (index.ts), and a throw there takes the same code; run-abort and run-gate
  // named no code for an input they cannot use (the marker, the gate's records) and take 2 as well, in place of Node's
  // uncaught-exception exit.
  "run-status": 2,
  "run-abort": 2,
  "run-gate": 2,
  // Launch-next exits 2 on a marker or a list it cannot read, and a throw there takes the same code.
  "launch-next": 2,
};

/**
 * Commands outside the relay whose refusal is one named line too, with the exit code they had:
 * `ropa` throws on a layer-2 input it cannot use (an activity proposed by a rule with no
 * candidate ruled real, a citation that is not a candidate location, declared ids without `--reconcile`), and that ended
 * in Node's stack, exit 1. It now ends in the boundary's one line, exit 1 still.
 */
export const PLAIN_REFUSAL_EXITS: Readonly<Record<string, number>> = {
  ropa: 1,
};

/**
 * AN INPUT READ THAT NAMES ITS PATH. Node's EISDIR on a read carries no path (the open succeeds and the
 * read fails), so a boundary that only prints the message cannot say which input it was: every raw
 * read the assembly makes of a path it was handed goes through here.
 */
export class InputUnusable extends Error {
  constructor(
    readonly path: string,
    detail: string,
  ) {
    super(detail.includes(path) ? detail : `${path}: ${detail}`);
    this.name = "InputUnusable";
  }
}

/** Every `.json` file under a directory, sorted; a directory it cannot list is named. */
export function jsonFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (at: string) => {
    let names: string[];
    try {
      names = readdirSync(at).sort();
    } catch (e) {
      throw new InputUnusable(at, (e as Error).message);
    }
    for (const name of names) {
      const full = join(at, name);
      let isDir: boolean;
      try {
        isDir = statSync(full).isDirectory();
      } catch (e) {
        throw new InputUnusable(full, (e as Error).message);
      }
      if (isDir) walk(full);
      else if (name.endsWith(".json")) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/** The one line a relay command ends on when its action throws. */
export function boundaryLine(command: string, e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  const path = (e as { path?: unknown } | null)?.path;
  const named = typeof path === "string" && !message.includes(path) ? ` (${path})` : "";
  return `✘ ${command}: stopped on an input it cannot use: ${message}${named}`;
}

/**
 * Run the program's one parse inside the boundary. `preAction` records which command's action runs, so
 * the boundary knows whose exit code to take; a throw from any other command, or from the parse itself,
 * goes on unchanged.
 */
export async function runAtBoundary(program: Command, argv?: readonly string[]): Promise<void> {
  const seen: { command: string | null } = { command: null };
  program.hook("preAction", (_self, action) => {
    seen.command = action.name();
  });
  try {
    await program.parseAsync(argv as string[] | undefined);
  } catch (e) {
    // A startup lookup that failed (startup-refusal.ts): its one sentence, exit 1, for every command.
    if (e instanceof StartupRefusal) {
      process.stderr.write(`${e.message}\n`);
      process.exitCode = 1;
      return;
    }
    const command = seen.command;
    const exit = command === null ? undefined : (RELAY_COMMAND_EXITS[command] ?? PLAIN_REFUSAL_EXITS[command]);
    // A write refused because a name on its way is a symbolic link (project-write.ts) ends every command in
    // the refusal's own sentence - which path, which link, why, what to do - never in a stack. A file another program holds open on Windows: its one sentence, never a stack.
    if (isLinkRefusal(e) || isFileHeldRefusal(e)) {
      process.stderr.write(`${e.message}\n`);
      process.exitCode = exit ?? 1;
      return;
    }
    // A relay or history record the state folder cannot keep (state-record.ts
    // `LaunchRecordRefusal`): its own sentence, never a stack.
    if (isLaunchRecordRefusal(e)) {
      process.stderr.write(`${e.message}\n`);
      process.exitCode = exit ?? 1;
      return;
    }
    if (command === null || exit === undefined) throw e;
    process.stderr.write(`${boundaryLine(command, e)}\n`);
    process.exitCode = exit;
  }
}

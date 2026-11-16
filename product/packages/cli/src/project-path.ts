/**
 * THE ONE FORM OF A PATH BETWEEN TWO PLACES. Every path the program makes from one place to another (a file of the
 * scanned tree named from its root, a record named from `.legal/`, a file shown from the working folder) is made here,
 * and its names are joined by `/` on every system. That is the form the program stores in its records, prints, compares
 * with what it stored and hands on to the seats, so a path made on Windows matches the same path made on Linux, and a
 * record written on one is read on the other.
 *
 * On POSIX this is `relative` itself: `/` is the only separator there, and a `\` inside a name is a character of that
 * name, so it stays. On Windows each `\` separator becomes `/`; a name there holds neither character.
 *
 * A check of the sources refuses a `relative` from `node:path`, or a separator swapped by hand, anywhere else in the
 * program, so no path reaches a record or a comparison in the system's own form.
 */
import { relative, sep } from "node:path";

/** The path from `from` to `to`, its names joined by `/`: `""` where they are one place, `..` segments where `to` is outside. */
export function relativePath(from: string, to: string): string {
  return slashPath(relative(from, to));
}

/** A path the system made (with `join`, `relative` or a listing), its names joined by `/`. */
export function slashPath(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

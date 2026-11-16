/**
 * THE ONE READER OF A FILE FOR RECORD MARKERS, shared by the pack's safeguard (scripts/pack-public-only.mjs) and the
 * export that writes the public tree, which reads every file it copies by these functions.
 *
 * WHY. Until this change the two kept their own copies, held equal by a test on a list of texts, and they disagreed on a
 * grammar holding a marker's opener one byte a character followed by something other than white space: the export
 * refused it (any opener in a binary), the pack passed it (its one-byte reading of a binary used the text sign, an
 * opener followed by white space or the end). Now each reads through the functions below, so they cannot disagree:
 * - `textOf`: a file is text where it is UTF-8 and holds no NUL; its text exactly as decoded.
 * - `TEXT_OPENER`: in a text, what a marker the strip cannot remove leaves behind - the opener's bracket, word and colon,
 *   followed by white space (a line break included) or by nothing at all.
 * - `isWebAssembly`: a binary shipped on purpose begins with WebAssembly's four bytes (`\0asm`).
 * - `binaryOpenerForm`: in a binary, the opener's bracket, word and colon in any form one could be written in - one byte
 *   a character, UTF-16 or UTF-32 in either byte order - followed by anything: a binary cannot be stripped, so any
 *   opener in one refuses it.
 * The opener is spelled in pieces so this file, which the public tree carries, holds no marker of its own. Node's own
 * modules only: the pack runs it inside the package, and the export imports it from here.
 */
const ROOT = "[" + "rec" + "ord:";

export const TEXT_OPENER = new RegExp(`\\[${"rec" + "ord"}:(?:\\s|$)`);

const UTF8 = new TextDecoder("utf-8", { fatal: true });

/** The file's text where it is UTF-8 holding no NUL, else null. */
export function textOf(bytes) {
  if (bytes.includes(0)) return null;
  try {
    UTF8.decode(bytes);
  } catch {
    return null;
  }
  return bytes.toString("utf8");
}

/** Whether the bytes begin as a WebAssembly module does. */
export const isWebAssembly = (bytes) => bytes.subarray(0, 4).equals(Buffer.from([0, 0x61, 0x73, 0x6d]));

const spread = (width, big) =>
  Buffer.from(
    [...ROOT].flatMap((c) => {
      const unit = new Array(width).fill(0);
      unit[big ? width - 1 : 0] = c.charCodeAt(0);
      return unit;
    }),
  );
const FORMS = [
  ["one byte a character", Buffer.from(ROOT, "latin1")],
  ["UTF-16LE", spread(2, false)],
  ["UTF-16BE", spread(2, true)],
  ["UTF-32LE", spread(4, false)],
  ["UTF-32BE", spread(4, true)],
];

/** The form in which a binary holds a marker's opener, or null where it holds none. */
export function binaryOpenerForm(bytes) {
  for (const [name, needle] of FORMS) if (bytes.indexOf(needle) >= 0) return name;
  return null;
}

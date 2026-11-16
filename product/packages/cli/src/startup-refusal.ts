/**
 * A STARTUP LOOKUP THAT FAILED, SAID IN ONE PLAIN SENTENCE.
 *
 * The program looks for a few things before it can do anything: the rule bundle (`--bundle`, `LEGAL_BUNDLE_DIR`, the
 * bundle shipped with the program) and the JSON schemas it validates with. Until a fix a bundle folder that did not
 * exist, or a CLI with no schemas anywhere, ended in an uncaught error and a Node stack. Every such lookup now throws
 * this, with one sentence that says what is missing and what to do, and the program's one boundary
 * (command-boundary.ts `runAtBoundary`) prints the sentence alone and exits 1, for every command. Nothing is written
 * after it.
 */
export class StartupRefusal extends Error {
  constructor(sentence: string) {
    super(sentence);
    this.name = "StartupRefusal";
  }
}

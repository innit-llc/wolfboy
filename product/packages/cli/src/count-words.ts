/**
 * Words of counts every surface prints, in a module that
 * imports nothing: progress.ts re-exports them. ci-check.ts took `checksFoundNothing` from progress.ts, whose static
 * imports reach the scanning engine and, through it, the install guard (engine -> strip-comments -> ruby-prism ->
 * install-guard-on): loading the CI check, or anything that loads it (host-env.ts), installed the guard.
 */

/** A count with its thousands separated, as every surface prints one (`progress.ts` says why it is shared). */
export function group(n: number): string {
  return n.toLocaleString("en-US");
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * THE CHECKS THAT FOUND NOTHING, one sentence for every surface a person reads: the quick scan's screen, report.md's first screen
 * and its Not checked block, not-checked.md, both end screens, the record and the CI step summary. They said the one fact
 * six ways ("which is not a pass", "which is not a clean result", "that does not mean the code is fine", "does not mean
 * their duties are met", "free of what they look for", "Checks that found nothing: N"). The fact it keeps: a check that
 * finds nothing is not evidence that the code is fine. It lives in this module of words that imports nothing
 * (progress.ts re-exports it), so ci-check.ts takes it without loading the scanning engine; importing assemble-report.ts
 * would close a cycle. `ran` and `where` add what a surface knows beside the count
 * (not-checked.md: of how many that ran; the CI summary: in the tree or on the changed files); no surface prints it
 * shorter.
 */
export function checksFoundNothing(n: number, o: { ran?: number; where?: string } = {}): string {
  return `${group(n)} ${plural(n, "check", "checks")}${o.ran !== undefined ? ` of the ${group(o.ran)} that ran` : ""} found nothing${o.where ? ` ${o.where}` : ""}, which does not prove the code is fine`;
}

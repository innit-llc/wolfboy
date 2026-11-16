// The gate list, derived from package.json and checked against an internal record
//
// WHY THIS EXISTS. §11 of the governance document states how many steps `npm run gates` runs and
// which tools it runs that the section does not list as rows. That number went stale THREE TIMES on
// 2026-08-13 alone — eleven, then fourteen, then fifteen, then sixteen — and the correction block
// written that morning contained a sentence that was itself false within hours: "`rule-diff-sweep`
// is not an additional step — it rides inside `test:mutations`, deliberately, to keep the count at
// fourteen." `tools/build-bundle.mjs` carried the same stale count in three of its own comments.
// The block names its own cause in one line: THE COUNT LIVES IN A DOCUMENT THAT NOTHING VERIFIES.
//
// THE COUNT ALONE IS NOT ENOUGH, and that was decided rather than assumed. `rule-diff-sweep.mjs` was
// wired into `test:mutations` with `&&` specifically so that the total would not move. A check that
// compared only the total would have passed that day and every day since, while the document's list
// of tools was already wrong. So the derivation produces BOTH the ordered step names AND the tool
// each step actually invokes, and all three — count, names, tools — are compared.
//
// ONE AUTHORITATIVE LIST, AND IT IS package.json. `scripts.gates` is what actually runs; the block in
// §11 is a transcription of it and is never the source. Nothing here writes to the document. When the
// two disagree, the build fails and prints the block to paste, so the repair is copy-and-paste and
// the direction of the copy is not a matter of judgement. This is the same shape as the two guards
// already in `tools/build-bundle.mjs` — the stale-build guard and the check-set drift guard — and it
// is there for the same stated reason: where the second copy cannot be removed (a Markdown document
// cannot import from a JSON file), what can be had is a build that refuses to run while the two
// disagree.
//
// THE SELF-TEST IS NOT BEHIND A FLAG. A check states the rule this follows:
// "a self-test behind a flag is one nobody runs". `selfTest()` runs on every build, before the real
// files are read, over synthetic inputs only. It carries a DELIBERATELY WEAK comparison
// (`weakCompareCountOnly`) as a permanent negative control: the two breakages the weak version lets
// through are the two that matter most, and if someone later simplifies `compareGateList` down to
// counting, the self-test goes red instead of the repository quietly losing the check.
//
// SCOPE, stated so it is not mistaken for more. This checks ONE block in ONE document against
// `scripts.gates`. It does not read the prose of §11, deliberately: that section's correction blocks
// are a dated archaeological record which quotes its own past false counts on purpose ("This
// paragraph said 'eleven steps'…"), and a checker that grepped prose for stale numbers would fight
// the document's own design. §11 therefore says, in the block's own header, that the block is the
// only live statement of the count and that every number in the surrounding prose is dated history.

import { readFileSync, existsSync } from "node:fs";

export const BEGIN_MARKER = "<!-- BEGIN gate-list";
export const END_MARKER = "<!-- END gate-list -->";
const FENCE = "```gate-list";

const STEP_INVOCATION = /^npm run ([A-Za-z0-9:_.-]+)$/;
// A step may preload a module (`node --import
// <module> <path>`, as `test:rules` preloads the module that keeps the account's state folder unwritten): the
// step's file is still the path after the preloads.
const NODE_INVOCATION = /^node\s+(?:--import\s+\S+\s+)*(\S+)(?:\s|$)/;
const BLOCK_HEADER = /^steps:\s*(\d+)$/;
const BLOCK_ROW = /^(\d+)\.?\s+(\S+)\s+(\S.*)$/;

/**
 * A failure that means the derivation or the parse could not see its subject at all. It is raised
 * rather than returned because "could not look" must never be reachable from the same code path as
 * "looked and found no differences" — that equivalence is the defect `source-text-check.mjs` was
 * written against, and it applies here word for word.
 */
export class GateListUnreadable extends Error {}

/**
 * Derive the ordered gate steps from a package.json document. THE ONLY AUTHORITATIVE LIST.
 *
 * Strict on purpose. A command shape this does not understand raises instead of being skipped,
 * because a silently shortened list is exactly the failure being guarded against: it would make the
 * document look correct while describing a run that no longer happens.
 */
export function deriveGateList(packageJsonText) {
  let pkg;
  try {
    pkg = JSON.parse(packageJsonText);
  } catch (e) {
    throw new GateListUnreadable(`package.json does not parse as JSON: ${e.message}`);
  }
  const scripts = pkg.scripts;
  if (!scripts || typeof scripts !== "object") {
    throw new GateListUnreadable("package.json has no `scripts` object, so the gate list cannot be derived");
  }
  const gates = scripts.gates;
  if (typeof gates !== "string" || gates.trim() === "") {
    throw new GateListUnreadable("package.json has no `scripts.gates`, so the gate list cannot be derived");
  }

  const steps = [];
  for (const raw of gates.split("&&")) {
    const part = raw.trim();
    const m = part.match(STEP_INVOCATION);
    if (!m) {
      throw new GateListUnreadable(
        `\`scripts.gates\` contains a step this derivation cannot read: "${part}". Every step must be ` +
          `exactly \`npm run <script-name>\`. Extend the derivation in tools/gate-list.mjs to understand ` +
          `the new shape — do not work around it by loosening the documented gate list`,
      );
    }
    const name = m[1];
    const command = scripts[name];
    if (typeof command !== "string") {
      throw new GateListUnreadable(
        `\`scripts.gates\` runs \`npm run ${name}\` and package.json has no \`scripts.${name}\` — the gate ` +
          `list cannot be derived and the gate itself would fail on that step`,
      );
    }
    const targets = [];
    for (const rawInner of command.split("&&")) {
      const inner = rawInner.trim();
      const t = inner.match(NODE_INVOCATION);
      if (!t) {
        throw new GateListUnreadable(
          `\`scripts.${name}\` contains a command this derivation cannot read: "${inner}". Every command ` +
            `must be \`node [--import <module>] <path> [args]\`. Extend the derivation in tools/gate-list.mjs rather than ` +
            `dropping the tool from the documented gate list`,
        );
      }
      targets.push(t[1]);
    }
    steps.push({ name, targets });
  }
  if (steps.length === 0) {
    throw new GateListUnreadable("`scripts.gates` yielded no steps, which cannot be right");
  }
  return steps;
}

/**
 * Render the block exactly as an internal record must carry it. This is what the failure message
 * prints, so that the repair is a paste and not a transcription — a guard whose message does not
 * tell you the repair gets worked around, and a guard that makes you retype a list is a guard that
 * introduces the defect it exists to catch.
 */
export function renderGateListBlock(steps) {
  const width = Math.max(...steps.map((s) => s.name.length)) + 2;
  const ordinalWidth = String(steps.length).length;
  const rows = steps.map((s, i) =>
    `${String(i + 1).padStart(ordinalWidth)}  ${s.name.padEnd(width)}${s.targets.join(" ")}`,
  );
  return [FENCE, `steps: ${steps.length}`, ...rows, "```"].join("\n");
}

/**
 * Read the block back out of the document. Returns { count, steps }.
 *
 * Every way of failing to find or read the block raises. A block that cannot be located is not an
 * empty block: treating "no block" as "nothing to compare" would let the check be disabled by
 * deleting six lines, which is the cheapest possible workaround and therefore the one to close.
 */
export function parseGateListBlock(docText) {
  const begin = docText.indexOf(BEGIN_MARKER);
  if (begin === -1) {
    throw new GateListUnreadable(
      `the \`${BEGIN_MARKER} …\` marker is not in the document, so the gate list it must carry could ` +
        `not be found. It belongs in the section that describes the gate`,
    );
  }
  const end = docText.indexOf(END_MARKER, begin);
  if (end === -1) {
    throw new GateListUnreadable(`\`${BEGIN_MARKER} …\` is present but \`${END_MARKER}\` is not`);
  }
  if (docText.indexOf(BEGIN_MARKER, begin + BEGIN_MARKER.length) !== -1) {
    throw new GateListUnreadable(
      `\`${BEGIN_MARKER} …\` appears more than once — there must be exactly one gate-list block`,
    );
  }
  const region = docText.slice(begin, end);
  const fenceStart = region.indexOf(FENCE);
  if (fenceStart === -1) {
    throw new GateListUnreadable(`the gate-list markers are present but the \`${FENCE}\` fence between them is not`);
  }
  const afterFence = region.slice(fenceStart + FENCE.length);
  const fenceEnd = afterFence.indexOf("\n```");
  if (fenceEnd === -1) {
    throw new GateListUnreadable(`the \`${FENCE}\` fence is never closed before \`${END_MARKER}\``);
  }
  const body = afterFence.slice(0, fenceEnd);

  const lines = body.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
  if (lines.length === 0) throw new GateListUnreadable("the gate-list block is empty");

  const header = lines[0].trim().match(BLOCK_HEADER);
  if (!header) {
    throw new GateListUnreadable(
      `the gate-list block's first line is "${lines[0].trim()}"; it must be \`steps: <n>\``,
    );
  }
  const count = Number(header[1]);

  const steps = [];
  for (const line of lines.slice(1)) {
    // Trimmed at both ends: `renderGateListBlock` right-aligns the ordinals, so every row of a
    // ten-or-more-step gate but the last few carries leading spaces. The first draft of this regex
    // was anchored at `^(\d+)` and rejected the block this same file renders — found by round-
    // tripping the real 16-step list, and it is why the round-trip is now a self-test case.
    const m = line.trim().match(BLOCK_ROW);
    if (!m) {
      throw new GateListUnreadable(
        `the gate-list block has a line that does not parse: "${line.trim()}". Each row is ` +
          `\`<n>  <script-name>  <tool> [<tool> …]\``,
      );
    }
    steps.push({ ordinal: Number(m[1]), name: m[2], targets: m[3].trim().split(/\s+/) });
  }
  return { count, steps };
}

/**
 * Compare the derived list against the documented block. Returns a list of human-readable
 * differences, empty when they agree.
 *
 * THREE THINGS ARE COMPARED and each one has gone wrong in this repository: the total, the ordered
 * step names, and the tools each step invokes. The third is the one a count-only check cannot see,
 * and it is the one that produced the false sentence about `rule-diff-sweep`.
 */
export function compareGateList(derived, documented) {
  const diffs = [];
  if (documented.count !== documented.steps.length) {
    diffs.push(
      `the block says \`steps: ${documented.count}\` and then lists ${documented.steps.length} of them — ` +
        `the block disagrees with itself`,
    );
  }
  if (documented.count !== derived.length) {
    diffs.push(
      `the block says \`steps: ${documented.count}\` and \`npm run gates\` runs ${derived.length}`,
    );
  }
  const n = Math.max(derived.length, documented.steps.length);
  for (let i = 0; i < n; i++) {
    const d = derived[i];
    const b = documented.steps[i];
    const at = `step ${i + 1}`;
    if (d && !b) {
      diffs.push(`${at} \`${d.name}\` (${d.targets.join(" ")}) runs in the gate and is not in the block`);
      continue;
    }
    if (b && !d) {
      diffs.push(`${at} \`${b.name}\` is in the block and does not run in the gate`);
      continue;
    }
    if (b.ordinal !== i + 1) {
      diffs.push(`${at} is numbered ${b.ordinal} in the block`);
    }
    if (d.name !== b.name) {
      diffs.push(`${at} is \`${d.name}\` in the gate and \`${b.name}\` in the block`);
      continue;
    }
    const dt = d.targets.join(" ");
    const bt = b.targets.join(" ");
    if (dt !== bt) {
      diffs.push(`${at} \`${d.name}\` runs \`${dt}\` and the block says \`${bt}\``);
    }
  }
  return diffs;
}

/**
 * THE DELIBERATELY WEAK VERSION, kept as a permanent negative control and never called by the build.
 *
 * This is the check that was explicitly rejected: compare the totals and nothing else. It is here so
 * that `selfTest()` can demonstrate, every run, which breakages it lets through — and so that a later
 * simplification of `compareGateList` towards this shape turns the build red rather than passing
 * quietly. An assertion set that only separates "some check exists" from "no check" locks nothing;
 * that finding is recorded five times over in a check and it applies to this file
 * as much as to a stripper.
 */
export function weakCompareCountOnly(derived, documented) {
  return documented.count === derived.length
    ? []
    : [`the block says \`steps: ${documented.count}\` and \`npm run gates\` runs ${derived.length}`];
}

// ---------------------------------------------------------------- the self-test

const SELF_TEST_PKG = {
  scripts: {
    gates: "npm run alpha && npm run beta && npm run gamma",
    alpha: "node --import ./check/preload.mjs check/alpha.mjs",
    beta: "node check/beta.mjs --flag",
    gamma: "node check/gamma.mjs && node check/gamma-extra.mjs --self-test",
  },
};

const SELF_TEST_DOC = [
  "text before",
  `${BEGIN_MARKER} -->`,
  "",
  FENCE,
  "steps: 3",
  "1  alpha  check/alpha.mjs",
  "2  beta   check/beta.mjs",
  "3  gamma  check/gamma.mjs check/gamma-extra.mjs",
  "```",
  "",
  END_MARKER,
  "text after",
].join("\n");

/**
 * The five breakages, each stated as a mutation of the package.json side or of the document side of
 * the pair above, with the answer each comparison must give. `weak` records what the count-only
 * version does, and it is the point of the exercise rather than an aside.
 */
const BREAKAGES = [
  {
    id: "B0",
    what: "nothing changed (negative control)",
    pkg: (p) => p,
    doc: (d) => d,
    strongCatches: false,
    weakCatches: false,
  },
  {
    id: "B1",
    what: "a step added to package.json and not to the document",
    pkg: (p) => ({
      scripts: { ...p.scripts, gates: `${p.scripts.gates} && npm run delta`, delta: "node check/delta.mjs" },
    }),
    doc: (d) => d,
    strongCatches: true,
    weakCatches: true,
  },
  {
    id: "B2",
    what: "a step removed from package.json, still in the document",
    pkg: (p) => ({ scripts: { ...p.scripts, gates: "npm run alpha && npm run gamma" } }),
    doc: (d) => d,
    strongCatches: true,
    weakCatches: true,
  },
  {
    id: "B3",
    what: "a step renamed in package.json, count unchanged",
    pkg: (p) => ({
      scripts: {
        gates: "npm run alpha && npm run beta-renamed && npm run gamma",
        alpha: p.scripts.alpha,
        "beta-renamed": p.scripts.beta,
        gamma: p.scripts.gamma,
      },
    }),
    doc: (d) => d,
    strongCatches: true,
    weakCatches: false,
  },
  {
    id: "B4",
    what: "the document's count edited to a wrong number while its list stays right",
    pkg: (p) => p,
    doc: (d) => d.replace("steps: 3", "steps: 4"),
    strongCatches: true,
    weakCatches: true,
  },
  {
    id: "B5",
    what: "a second tool added inside an existing step, count and names unchanged (the `rule-diff-sweep` case)",
    pkg: (p) => ({
      scripts: { ...p.scripts, beta: "node check/beta.mjs --flag && node check/beta-extra.mjs" },
    }),
    doc: (d) => d,
    strongCatches: true,
    weakCatches: false,
  },
];

/**
 * Run the breakages through both comparisons. Returns a list of failures; empty means the check
 * behaves as this file claims. Called unconditionally by tools/build-bundle.mjs before it reads the
 * real package.json and the real document.
 */
export function selfTest() {
  const failures = [];
  for (const b of BREAKAGES) {
    const pkgText = JSON.stringify(b.pkg(SELF_TEST_PKG));
    const docText = b.doc(SELF_TEST_DOC);
    let derived;
    let documented;
    try {
      derived = deriveGateList(pkgText);
      documented = parseGateListBlock(docText);
    } catch (e) {
      failures.push(`${b.id} (${b.what}): the inputs no longer read at all — ${e.message}`);
      continue;
    }
    const strong = compareGateList(derived, documented).length > 0;
    const weak = weakCompareCountOnly(derived, documented).length > 0;
    if (strong !== b.strongCatches) {
      failures.push(
        `${b.id} (${b.what}): compareGateList ${strong ? "reported a difference" : "reported none"} and ` +
          `must ${b.strongCatches ? "report one" : "report none"}`,
      );
    }
    if (weak !== b.weakCatches) {
      failures.push(
        `${b.id} (${b.what}): the count-only negative control ${weak ? "reported a difference" : "reported none"} ` +
          `and must ${b.weakCatches ? "report one" : "report none"} — if the strong comparison has been ` +
          `simplified towards counting, this is where it shows`,
      );
    }
  }
  // THE ROUND TRIP, and it is here because the first draft of this file failed it. `parseGateListBlock`
  // was anchored at `^(\d+)` and therefore could not read the block `renderGateListBlock` produces for
  // a gate of ten or more steps, where the ordinals are right-aligned and every early row starts with
  // a space. The three-step synthetic pair above could not see it: at one digit there is no padding.
  // That is the same finding as the `exact3` engine in a check — an assertion whose
  // input was too small to reproduce the mechanism it was named after — so the case is a twelve-step
  // list, chosen to force two-digit ordinals, and the repair the failure message prints is now proved
  // to be a repair rather than a second broken block.
  const wide = {
    scripts: Object.fromEntries([
      ["gates", Array.from({ length: 12 }, (_, i) => `npm run s${i + 1}`).join(" && ")],
      ...Array.from({ length: 12 }, (_, i) => [`s${i + 1}`, `node tools/s${i + 1}.mjs`]),
    ]),
  };
  try {
    const derivedWide = deriveGateList(JSON.stringify(wide));
    const rendered = renderGateListBlock(derivedWide);
    const doc = `${BEGIN_MARKER} -->\n\n${rendered}\n\n${END_MARKER}\n`;
    const reparsed = parseGateListBlock(doc);
    const diffs = compareGateList(derivedWide, reparsed);
    if (diffs.length > 0) {
      failures.push(
        `the block this file renders does not read back as the list it was rendered from ` +
          `(${diffs.length} difference(s), first: ${diffs[0]}) — the repair the failure message prints ` +
          `would not repair anything`,
      );
    }
  } catch (e) {
    failures.push(`the rendered block does not parse at all: ${e.message}`);
  }

  // The unreadable paths, which must never be reachable from the same result as "no differences".
  const unreadable = [
    ["a package.json with no `gates` script", () => deriveGateList(JSON.stringify({ scripts: { a: "node x.mjs" } }))],
    ["a gates step that is not `npm run <name>`", () => deriveGateList(JSON.stringify({ scripts: { gates: "node check/x.mjs" } }))],
    ["a step command that is not `node <path>`", () => deriveGateList(JSON.stringify({ scripts: { gates: "npm run a", a: "tsc -p ." } }))],
    ["a document with no gate-list block", () => parseGateListBlock("nothing here")],
    ["a gate-list block whose row does not parse", () => parseGateListBlock(SELF_TEST_DOC.replace("2  beta   check/beta.mjs", "beta"))],
    ["a gate-list block with no `steps:` header", () => parseGateListBlock(SELF_TEST_DOC.replace("steps: 3\n", ""))],
  ];
  for (const [what, fn] of unreadable) {
    let raised = false;
    try {
      fn();
    } catch (e) {
      raised = e instanceof GateListUnreadable;
    }
    if (!raised) failures.push(`${what} did not raise GateListUnreadable — "could not look" is being reported as "looked and agreed"`);
  }
  return failures;
}

/**
 * The whole check, as tools/build-bundle.mjs calls it. Returns a list of error strings for the
 * caller's own error collection; empty means package.json and the document agree.
 */
export function checkGateList(packageJsonPath, docPath) {
  const selfFailures = selfTest();
  if (selfFailures.length > 0) {
    return selfFailures.map(
      (f) => `the gate-list check's own self-test failed, so its verdict on the document means nothing: ${f}`,
    );
  }
  if (!existsSync(packageJsonPath)) return [`${packageJsonPath} is missing, so the gate list cannot be derived`];
  if (!existsSync(docPath)) return [`${docPath} is missing, so the gate list cannot be checked against it`];

  let derived;
  let documented;
  try {
    derived = deriveGateList(readFileSync(packageJsonPath, "utf8"));
  } catch (e) {
    return [`the gate list could not be derived from package.json: ${e.message}`];
  }
  try {
    documented = parseGateListBlock(readFileSync(docPath, "utf8"));
  } catch (e) {
    return [
      `the gate list in ${docPath} could not be read: ${e.message}. ` +
        `The block must be exactly:\n\n${renderGateListBlock(derived)}\n`,
    ];
  }
  const diffs = compareGateList(derived, documented);
  if (diffs.length === 0) return [];
  return [
    `${docPath} does not describe the gate that package.json defines:\n` +
      diffs.map((d) => `      · ${d}`).join("\n") +
      `\n    package.json is the only authoritative list and nothing here edits the document. ` +
      `Replace everything between \`${BEGIN_MARKER} …\` and \`${END_MARKER}\` in that document with exactly ` +
      `this, and re-read the prose beside it:\n\n${renderGateListBlock(derived)}\n`,
  ];
}

#!/usr/bin/env node
/**
 * Reading `rules/vocabulary/` — the one place every authoring-side tool loads shared word lists.
 *
 * ## What a shared list is, and why it is not just a rule's vocabulary
 *
 * `detector.vocabulary` puts a rule's word lists in one place WITHIN THAT RULE. A list that SEVERAL
 * rules must agree on is a different problem, and the mechanism did not solve it: the spellings of
 * the payment vendors are written in `rules/packs/eu-cra/eu-cra-001/rule.yaml` and again in
 * `rules/packs/eu-dsr/eu-dsr-001/rule.yaml`, and the recipients family being authored needs them a
 * third time. Three copies of one fact is what the project's rules forbid by name. A shared list is authored
 * once under `rules/vocabulary/` and named by each rule in `detector.shared_vocabulary`.
 *
 * ## Why the loading lives HERE and the merging does not
 *
 * The merge — what a shared list contributes, and what happens when a name collides — is
 * `mergeSharedVocabulary` in `product/packages/cli/src/vocabulary.ts`, beside `expandPattern`,
 * and it is IMPORTED from the CLI's compiled output by everything that needs it. That is the same
 * decision `tools/build-bundle.mjs` already made and wrote down for `expandPattern`: re-deriving
 * the splice in a second place would be a copy that agrees on the day it is written.
 *
 * What is left over is reading the files and validating their shape, which is a build-time concern
 * that the shipped scanner has no use for: a user's machine has a bundle and no authoring tree.
 * That is this file. Four tools read rule YAML and expand its patterns —
 * `tools/build-bundle.mjs`, two tools,
 * a tool — and all four call `loadSharedVocabulary` and
 * `effectiveVocabulary` from here, so a rule's effective word lists are computed once, in one way.
 *
 * ## Every way this fails, and it fails loudly in all of them
 *
 * - A file that does not parse as YAML. Skipping it would leave every list it declared "not
 *   declared", and the rules importing them would fail one step later blaming the wrong file.
 * - A file that does not satisfy `vocabulary.schema.json` — a recipient entry with no jurisdiction
 *   source, a list with no `kind`, an unknown field.
 * - TWO FILES DECLARING ONE LIST NAME. Which one a rule got would otherwise depend on the order
 *   `readdirSync` returned, which is not a decision anybody made.
 * - A name a rule imports that no file declares (`mergeSharedVocabulary`).
 * - A name a rule imports that it ALSO declares itself (`mergeSharedVocabulary`) — no precedence,
 *   in either direction, for the reasons written there.
 *
 * A MISSING DIRECTORY IS NOT AN ERROR: it means no shared lists exist, which is the state this
 * mechanism shipped in. Every import then fails by name, which is the loud half of the same fact.
 *
 * ## ONE RESEARCH RECORD, N MEMBERSHIPS (`also_in`)
 *
 * Until 2026-09-02 an anchor that belonged in two lists needed TWO ENTRIES — and a recipient entry
 * is a research record, so two entries meant the same vendor document fetched, quoted and receipted
 * twice. One research pass hit the wall and stopped at it: *"Hotjar, FullStory, Microsoft Clarity,
 * Amplitude and PostHog are already researched entries there … Putting them in a session-replay list
 * as well would mean a second copy of five researched vendor entries — the exact defect the project's
 * 'never keep a second copy' rule and the consolidation itself exist to remove"*, and it routed the
 * question to the owner as *"either the generator must allow one vendor entry to belong to several
 * lists, or the replay spellings must become a `kind: term` list"*. The owner took the first.
 *
 * So an entry may name, in `also_in`, the other lists it ALSO belongs to. The entry itself — the
 * vendor, what it receives, the jurisdiction, the source that establishes it, and the quoted receipt
 * in the `<file>.quotes.json` beside its own file — stays in ONE place. `resolveMultiMembership`
 * below appends the entry to each list it names, so every reader that goes through this loader sees
 * one list with the borrowed entries in it, and a check, which reads the
 * YAML files off disk rather than this map, still finds the record exactly once. That is the whole
 * of the decision: the membership is resolved, the record is not copied.
 *
 * IT IS INERT BY ABSENCE. An entry with no `also_in` is read exactly as before, and a list nothing
 * joins is byte-identical — proved on 2026-09-03 by building `dist/bundle/` before and after this
 * change from one pinned snapshot of `rules/`.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { CJK_PATTERN, stringLeaves } from "./lint-patterns.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * THE RULES DIRECTORY AND THE VOCABULARY DIRECTORY MOVE TOGETHER, BY CONSTRUCTION.
 *
 * A rule's word lists live beside its packs: the working tree is `rules/packs/` and
 * `rules/vocabulary/`, siblings. Every tool that builds a SNAPSHOT of the rules — a test harness
 * writing a throwaway tree, a before/after sweep materialising two commits — redirects the build
 * with `RULES_DIR`. Five such redirects exist (a test,
 * three more tests,
 * a tool). Until this function, ONE of them also set `VOCABULARY_DIR`, and the
 * other four silently resolved a snapshot's imports against the WORKING TREE's word lists: the same
 * list on both sides of a comparison that exists to find a difference.
 *
 * That was harmless only because `rules/vocabulary/` is empty, and it is a defect of exactly the
 * class this mechanism is built against — a silent wrong answer rather than a loud refusal. Pairing
 * the two by hand at every call site does not close it: the next tool to redirect the rules has to
 * remember, and forgetting leaves no trace. So there is nothing left to remember. The vocabulary
 * directory is DERIVED from the rules directory whenever the rules directory has been redirected,
 * and a redirect that points somewhere with no `vocabulary` sibling therefore loads NO shared list —
 * at which point every import fails by name, which is loud.
 *
 * `VOCABULARY_DIR` stays an explicit override, with precedence over the derivation, for the one
 * case the derivation cannot serve: a harness whose `RULES_DIR` is a copy of REAL rules and which
 * therefore wants the REAL word lists (a test).
 */
export function deriveVocabularyDir(env = process.env) {
  if (env.VOCABULARY_DIR) return resolve(env.VOCABULARY_DIR);
  if (env.RULES_DIR) return join(dirname(resolve(env.RULES_DIR)), "vocabulary");
  return join(ROOT, "rules", "vocabulary");
}

/** Where shared lists live for this process. See `deriveVocabularyDir` for how it is chosen. */
export const VOCABULARY_DIR = deriveVocabularyDir();

const VOCABULARY_SCHEMA_PATH = join(ROOT, "product/packages/schemas/schemas/vocabulary.schema.json");

/**
 * The `matching` a list of VENDOR NAMES declares about its own anchors. Written once and imported by
 * every generator that emits such a list, so the decision is recorded in one place and cited five
 * times rather than re-argued five times.
 *
 * WHY BOTH FLAGS, FOR THIS KIND OF LIST. A vendor name is not spelled by the vendor at the site that
 * uses it — it is spelled by whoever wrote the line, in whatever case and with whatever separator
 * the language's convention wants. The same vendor appears as `postmark` in a Mix dependency,
 * `Postmark` inside `Bamboo.PostmarkAdapter`, `POSTMARK_API_KEY` in an environment name;
 * `help_scout` as a module path and `helpscout` as a hostname. Measured 2026-08-27: of 1,083 anchor bases,
 * 1,051 are spelled in ONE case form and 1,059 in ONE separator skeleton, and `recipients-005`
 * reached one of the four Elixir mailer adapters in an Elixir analytics application for that reason alone.
 *
 * IT IS NOT AUTOMATIC FOR EVERY LIST. A list of REGION CODES or of CONFIGURATION KEYS is a different
 * question — the spelling there is fixed by a cloud provider or by a framework, not by the author of
 * the line — and such a list writes its own object rather than importing this one.
 */
export const VENDOR_NAME_MATCHING = Object.freeze({
  case_insensitive: true,
  separator_insensitive: true,
});

/**
 * PROJECTION — a second list built by MOVING named anchors out of a source list, ADDED 2026-09-22.
 *
 * ## The problem it answers
 *
 * `matching` is a property of a LIST, and so is every boundary the importing rule writes around a
 * splice: a rule that splices `(?&delivery_recipients)` binds all 95 anchors the same way. Six of
 * those anchors are npm scopes ending in `/`, so a trailing word boundary over the whole list would
 * stop `@aws-sdk/client-s3` matching — which is why the word-END guard was never added and why four
 * word-shaped anchors (`a2`, `pigeon`, `houston`, `pusher`) are read inside longer words. The
 * anchors are right and the list-wide bound is wrong, so the answer is a SECOND list holding those
 * anchors and nothing else, which the rule binds on its own terms.
 *
 * ## Why MOVE and not copy, and why it is not a second copy of a fact
 *
 * `payment_sdk_names_cra_scope` has been projected from `payment_recipients` since V2b by a
 * declaration in a tool, and it COPIES: `eu-cra-001` asks a different
 * question of the same spellings and both lists must carry them. These items need the opposite —
 * the loose clause must STOP seeing the anchor — so a projection here MOVES: the anchor leaves the
 * source list's entry and exists exactly once afterwards, in the projected list.
 *
 * Neither list is hand-maintained. Both are written from one declaration by the generator that owns
 * the file, so the two lists cannot drift; the guards below refuse to write a file in which they
 * have. This is the same argument the CRA subset's own note makes, applied to a move.
 *
 * ## What a projection may and may not do (the guards, in order)
 *
 *  1. It may only move a spelling that IS an anchor of an entry of the source list — "an anchor
 *     above", since the projected list is emitted after its source in the same file. A spelling
 *     nothing above declares is a new anchor entering through a side door, and the run stops.
 *  2. It may RE-CASE a moved anchor — `stripe` → `stripe`, `Stripe`, `STRIPE` — because a projected
 *     list may declare exact matching where its source folds case, and the case forms then have to
 *     be written out. It may not respell one: every projected spelling must be the moved anchor
 *     under `toLowerCase()`, so a projection can never introduce a different word.
 *  3. It may not empty an entry. An entry with no anchors is a research record nothing can reach.
 *  4. It may not move an anchor out of an entry that declares `also_in`: that entry is borrowed by
 *     other lists as a whole, and moving one of its anchors would silently subtract the spelling
 *     from every list that borrows it. Subtraction is the only operation that can create a miss.
 *  5. Two projections may not move the same anchor.
 *
 * ## What the projected list carries
 *
 * Its own `matching` — that is the whole point — and the source list's `kind`, so a projected
 * recipient list is still a recipient list and `vocabulary_kinds` downstream still reads these
 * anchors as vendor spellings (`mergeVocabularyKinds`, `test:kind-census`). Its entries are the
 * source entries the anchors came from, with the researched fields written out verbatim by the
 * generator, because `vocabulary.schema.json` requires `vendor`, `receives`, `jurisdiction` and
 * `jurisdiction_source` on every `recipient` entry and a generator never invents a value to satisfy
 * a requirement. The copy is generated, never typed, and a check covers it
 * by the receipt of the identical field it was projected from rather than by a second receipt.
 *
 * @param {object} args
 * @param {string} args.sourceName   the list the anchors leave (for every message)
 * @param {string} args.sourceKind   the projected lists inherit it
 * @param {object[]} args.entries    the source list's entries, as the generator built them
 * @param {object[]} args.projections `{ name, move, spell?, matching, purpose, note }`
 * @param {string} args.generator    the generator's own filename, for the projected entries' note
 * @param {string[]} args.problems   appended to; a non-empty array makes the generator refuse to write
 * @returns {{ entries: object[], lists: Record<string, object> }} the source entries with the moved
 *   anchors gone, and the projected lists in declaration order
 */
export function projectAnchors({ sourceName, sourceKind, entries, projections, generator, problems }) {
  const remaining = entries.map((entry) => ({ ...entry, anchors: [...(entry.anchors ?? [])] }));
  const claimed = new Map();
  const lists = {};
  for (const projection of projections) {
    const movedByEntry = new Map(); // index in `remaining` -> spellings, in declaration order
    for (const anchor of projection.move) {
      const claimant = claimed.get(anchor);
      if (claimant !== undefined) {
        problems.push(
          `${projection.name} moves ${JSON.stringify(anchor)} out of ${sourceName}, and so does ` +
            `${claimant} — an anchor is moved once or the two projected lists disagree about who holds it`,
        );
        continue;
      }
      const owners = remaining.filter((entry) => entry.anchors.includes(anchor));
      if (owners.length === 0) {
        problems.push(
          `${projection.name} projects ${JSON.stringify(anchor)}, which no entry of ${sourceName} ` +
            `declares — a projection MOVES a spelling the list above already carries and never adds one`,
        );
        continue;
      }
      if (owners.length > 1) {
        problems.push(
          `${projection.name} projects ${JSON.stringify(anchor)}, which ${owners.length} entries of ` +
            `${sourceName} declare — the anchor's home entry is ambiguous and the move would take it from all of them`,
        );
        continue;
      }
      const owner = owners[0];
      if (Array.isArray(owner.also_in) && owner.also_in.length > 0) {
        problems.push(
          `${projection.name} projects ${JSON.stringify(anchor)} out of an entry that declares ` +
            `${ALSO_IN_FIELD}: ${owner.also_in.join(", ")} — moving it would subtract the spelling from ` +
            `those lists too, which nothing here asked for`,
        );
        continue;
      }
      const spellings = projection.spell?.[anchor] ?? [anchor];
      let respelt = false;
      for (const spelling of spellings) {
        if (spelling.toLowerCase() !== anchor.toLowerCase()) {
          problems.push(
            `${projection.name} spells the moved anchor ${JSON.stringify(anchor)} as ` +
              `${JSON.stringify(spelling)}, which is not a case form of it — a projection may re-case a ` +
              `moved anchor and may never respell one`,
          );
          respelt = true;
        }
      }
      if (respelt) continue;
      claimed.set(anchor, projection.name);
      owner.anchors = owner.anchors.filter((a) => a !== anchor);
      const index = remaining.indexOf(owner);
      movedByEntry.set(index, [...(movedByEntry.get(index) ?? []), ...spellings]);
    }
    const projectedEntries = [...movedByEntry.keys()].sort((a, b) => a - b).map((index) => {
      const owner = remaining[index];
      const source = entries[index];
      const anchors = movedByEntry.get(index);
      return {
        ...source,
        anchors,
        note:
          `${projectedEntryDeclaration(sourceName)} ${anchors.map((a) => JSON.stringify(a)).join(", ")} ${anchors.length === 1 ? "is" : "are"} ` +
          `${sourceName}'s own anchor${anchors.length === 1 ? "" : "s"}, MOVED here by ${generator} so that the ` +
          `importing rule can bind ${anchors.length === 1 ? "it" : "them"} with a boundary the source list cannot ` +
          `carry for all of its anchors; ${anchors.length === 1 ? "it is" : "they are"} not in ${sourceName} any ` +
          `more, and the same spelling is never in both. The researched fields above are a verbatim copy of that ` +
          `record, written by the generator and never by hand, and the workspace's vendor-quote check covers them by ` +
          `that record's own receipt. ` +
          String(source.note ?? ""),
      };
    });
    for (const [index] of movedByEntry) {
      if (remaining[index].anchors.length === 0) {
        problems.push(
          `${projection.name} would empty the ${sourceName} entry ` +
            `${JSON.stringify(remaining[index].vendor ?? remaining[index].term ?? "(unnamed)")} — an entry with ` +
            `no anchors is a research record nothing can reach`,
        );
      }
    }
    // `matching` is EMITTED ONLY IF IT DECLARES A FLAG. `vocabulary.schema.json` gives the field
    // `minProperties: 1` and calls it "opt-in and inert by absence", so an EXACT projected list
    // writes no `matching` at all rather than an empty object: an empty object is the one spelling
    // the schema refuses, because it says nothing that its absence does not say. A projection
    // declares `matching: {}` to mean exact, and that is where it is written down.
    lists[projection.name] = {
      kind: sourceKind,
      purpose: projection.purpose,
      ...(Object.keys(projection.matching ?? {}).length > 0 ? { matching: projection.matching } : {}),
      entries: projectedEntries,
    };
    if (projectedEntries.length === 0) {
      problems.push(`${projection.name} projects no anchor at all, so the list would be empty`);
    }
  }
  return { entries: remaining, lists };
}

/**
 * The entry field that names the OTHER lists an entry also belongs to. Written once, imported by
 * `vocabulary.schema.json`'s reader and by every message below, so the field has one spelling.
 */
/**
 * THE ONE SENTENCE THAT SAYS "THIS ENTRY IS A PROJECTION OF THAT LIST", written by
 * `projectAnchors` and READ by a check. It is here, exported, and not
 * written out in both places: two copies of a sentence two tools must agree on go on compiling
 * after the first edit that touches only one of them, which the project's rules forbid in those words.
 *
 * The verifier's use is load-bearing rather than cosmetic. Gate 28 lets a projected field be
 * covered by the receipt of the field it was copied from; without a declaration to read, "copied
 * from" would have to be guessed from the text alone, and any field byte-identical to another
 * receipted field of the same kind in the same file would be covered — a hand-added entry that
 * copy-pasted another vendor's `receives` would pass unreceipted. With this declaration the
 * verifier demands that the copy's own entry SAY it is a projection, name the list it is a
 * projection of, and carry the covering row's vendor. A projected entry that loses this sentence
 * stops being covered and the gate fails, which is the direction a check should fail in.
 */
export const projectedEntryDeclaration = (sourceName) =>
  `PROJECTED ENTRY, and the record it is projected from is the ${sourceName} entry for the same vendor above.`;

/** The list name a projected entry's note declares as its source, or null if the note is not one.
 * Anchored at the start: the sentence is the first thing `projectAnchors` writes. */
export function projectedEntrySource(note) {
  if (typeof note !== "string") return null;
  const m = /^PROJECTED ENTRY, and the record it is projected from is the ([A-Za-z0-9_]+) entry for the same vendor above\./.exec(
    note,
  );
  return m ? m[1] : null;
}

export const ALSO_IN_FIELD = "also_in";

/**
 * The field a BORROWED copy carries so that every later reader can say where the record lives.
 *
 * It exists only in memory: it is put on the copy this loader appends, never on anything on disk,
 * and nothing writes a shared entry back out. `tools/build-bundle.mjs` reads `anchors`, `matching`
 * and `kind` off a shared list and nothing else, so the marker cannot reach `dist/bundle/`.
 */
export const BORROWED_FROM_FIELD = "also_in_from";

/**
 * Resolve `also_in`: append every entry that names other lists to each of those lists.
 *
 * WHY THE MEMBERSHIP IS DECLARED ON THE ENTRY AND NOT AS A LIST-LEVEL `includes:`. Both forms were
 * written out. A list-level `includes: [{ list, entry }]` has to ADDRESS an entry, and an entry has
 * no address: its identity is `vendor` or `term`, free prose that already contains em dashes, commas
 * and four-clause corporate names ("Paddle.com Market Limited, 30 Old Bailey, … / Paddle.com Canada
 * Ltd, …"), so the reference would either be an unreadable key or would require a NEW `id` field —
 * a second name for a thing that already has one, on every entry, to serve the few that are
 * borrowed. It also splits one failure into two ("no such list" and "no such entry in it") and, if
 * an identity is ever repeated inside one list, has no answer at all. `also_in` needs no addressing
 * scheme, because it is written where the entry is: the reference is the declaration.
 *
 * WHAT THE ENTRY FORM COSTS, stated rather than hidden: the TARGET list's file no longer answers
 * "what is in this list?" on its own. That is why the resolved view is produced HERE, in the one
 * loader every authoring-side tool goes through, rather than in the build — a tool,
 * two tools part (C) all read this
 * map, so an anchor that arrives by reference is measured, probed and reported exactly like one
 * written in place. A mechanism resolved in `tools/build-bundle.mjs` alone would have made the
 * volume gate blind to precisely the anchors nobody typed into the file it is looking at.
 *
 * FOUR HARD ERRORS, and each one is a thing that would otherwise be silent:
 *
 * - A TARGET NO FILE DECLARES. The entry says it belongs somewhere that does not exist; the rules
 *   importing that name fail one step later blaming the wrong file. Named on both sides.
 * - AN ENTRY NAMING ITS OWN LIST. It is already there. Left alone it would double every one of its
 *   anchors, which `sharedListItems` then reports as two entries claiming one spelling — true, and
 *   about the wrong thing.
 * - A CROSS-KIND JOIN. `kind` decides what an entry must carry: a `recipient` entry landing in a
 *   `term` list is an entry the target list's own contract forbids, and the schema cannot see it
 *   because the schema validates a file and this happens between two of them.
 * - AN ANCHOR THAT ARRIVES ON TOP OF ONE ALREADY IN THE TARGET. `sharedListItems` would catch it at
 *   build time and name `entry [7]` of a list whose file has five entries — an index pointing at
 *   nothing a reader can find. Caught here instead, naming the borrowed entry, its home file and
 *   the entry it collided with.
 *
 * CHAINS ARE NOT FOLLOWED, BY CONSTRUCTION. Resolution reads `also_in` only from entries a file
 * DECLARES (the arrays are snapshotted before anything is appended) and the copy it appends carries
 * no `also_in`, so no borrowed entry can re-export and no cycle can form. A two-hop membership is
 * written as two names on the one entry.
 */
export function resolveMultiMembership(shared, declaredIn = new Map()) {
  const errors = [];
  const homeOf = (name) => declaredIn.get(name) ?? "an unnamed file";
  // Snapshot every declared list's entries BEFORE appending: what is resolved is what the files
  // declare, never what a previous append put there.
  const declared = Object.entries(shared).map(([name, list]) => [name, list, (list.entries ?? []).slice()]);
  const joined = new Set();

  for (const [name, list, entries] of declared) {
    entries.forEach((entry, index) => {
      const targets = entry?.[ALSO_IN_FIELD];
      if (!Array.isArray(targets) || targets.length === 0) return;
      const identity = entry.vendor ?? entry.term ?? `[${index}]`;
      const where = `vocabulary/${homeOf(name)}: list "${name}" entry [${index}] (${identity})`;
      for (const target of targets) {
        if (target === name) {
          errors.push(
            `${where} names "${target}" in ${ALSO_IN_FIELD}, which is the list that declares it. An ` +
              `entry is already a member of its own list; every anchor would arrive on top of itself`,
          );
          continue;
        }
        if (!Object.prototype.hasOwnProperty.call(shared, target)) {
          const available = Object.keys(shared).sort();
          errors.push(
            `${where} names "${target}" in ${ALSO_IN_FIELD}, which no file in the shared vocabulary ` +
              `directory declares (declared: ${available.length > 0 ? available.join(", ") : "none"})`,
          );
          continue;
        }
        const into = shared[target];
        if (into.kind !== list.kind) {
          errors.push(
            `${where} is an entry of a "${list.kind}" list and names "${target}" in ${ALSO_IN_FIELD}, ` +
              `which vocabulary/${homeOf(target)} declares as "${into.kind}". A list's kind decides what ` +
              `its entries must carry, so an entry may only join a list of its own kind`,
          );
          continue;
        }
        const copy = { ...entry };
        delete copy[ALSO_IN_FIELD];
        copy[BORROWED_FROM_FIELD] = { list: name, file: homeOf(name), entry: index, identity };
        into.entries.push(copy);
        joined.add(target);
      }
    });
  }

  // The arrival collision, on the lists that actually received something. Lists nobody joined are
  // not walked at all, so a duplicate written inside ONE file still fails where it always did —
  // `sharedListItems`, with the message and the two entry indices that message has always carried.
  for (const target of [...joined].sort()) {
    const owner = new Map();
    (shared[target].entries ?? []).forEach((entry, index) => {
      const from = entry?.[BORROWED_FROM_FIELD];
      const identity = entry?.vendor ?? entry?.term ?? `[${index}]`;
      const describe = from
        ? `the entry "${from.identity}" borrowed from list "${from.list}" (vocabulary/${from.file})`
        : `entry [${index}] ("${identity}") declared in vocabulary/${homeOf(target)}`;
      for (const anchor of entry?.anchors ?? []) {
        const first = owner.get(anchor);
        if (first === undefined) {
          owner.set(anchor, { describe, borrowed: Boolean(from) });
          continue;
        }
        // Both sides written into the one file is the OLD error, and it stays where it was:
        // `sharedListItems`, with the two entry indices that message has always carried. Reporting
        // it here as well would change what an author sees for an input that has nothing to do with
        // this mechanism.
        if (!from && !first.borrowed) continue;
        errors.push(
          `vocabulary: list "${target}" would hold the anchor ${JSON.stringify(anchor)} twice — ${first.describe} ` +
            `and ${describe} both carry it. One spelling belongs to one entry within one list, or a ` +
            `reader cannot tell which entry a match is evidence of. Remove the anchor from one of the ` +
            `two entries, or drop the ${ALSO_IN_FIELD} membership that brings it in`,
        );
      }
    });
  }
  return errors;
}

/**
 * Every shared list on disk, keyed by the name a rule imports it under.
 *
 * Returns `{ shared, errors, files }`. `errors` is a list of messages and is never thrown from:
 * `tools/build-bundle.mjs` collects errors from a dozen checks and reports them together so an
 * author fixes a tree in one pass, and a loader that threw would report the first one alone.
 * A caller that has no error list of its own uses `loadSharedVocabularyOrThrow`.
 */
export function loadSharedVocabulary(dir = VOCABULARY_DIR) {
  // NOT `{}`. A list name is authored text, and `vocabulary.schema.json` accepts `__proto__` —
  // it is a legal `(?&name)` identifier and matches `propertyNames`. On a plain object,
  // `shared["__proto__"] = list` invokes `Object.prototype`'s setter instead of creating an own
  // property: the list is then readable in memory, so the build's own pattern lint expands the
  // splice and passes, and invisible to `JSON.stringify`, so the bundle ships `vocabulary: {}` and
  // every scan dies with `TypeError: items is not iterable`. Green build, broken artefact, failure
  // on the user's machine — the one shape this mechanism's header says it does not have. A
  // null-prototype object has no inherited setter to hit, and it closes the whole class rather than
  // the one name: no key of `Object.prototype` can ever be confused with a declared list.
  const shared = Object.create(null);
  const errors = [];
  const files = [];
  if (!existsSync(dir)) return { shared, errors, files };

  let ajv;
  let validate;
  try {
    ajv = addFormats(new Ajv2020({ allErrors: true, strict: false }));
    validate = ajv.compile(JSON.parse(readFileSync(VOCABULARY_SCHEMA_PATH, "utf8")));
  } catch (e) {
    errors.push(
      `the shared vocabulary schema could not be read from ${VOCABULARY_SCHEMA_PATH}: ` +
        `${String(e.message).split("\n")[0]}. No shared list is loaded without it — an unvalidated ` +
        `list is how a recipient entry with no jurisdiction source reaches a rule`,
    );
    return { shared, errors, files };
  }

  // Sorted so the run is reproducible and a collision message names the same two files every time.
  const declaredIn = new Map();
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
    const path = join(dir, file);
    files.push(path);
    let doc;
    try {
      doc = parseYaml(readFileSync(path, "utf8"));
    } catch (e) {
      errors.push(`vocabulary/${file}: YAML parse error: ${e.message}`);
      continue;
    }
    if (!validate(doc)) {
      for (const err of validate.errors ?? []) {
        errors.push(`vocabulary/${file}: ${err.instancePath || "/"} ${err.message}`);
      }
      continue;
    }
    // Field-scoped CJK lint, the same discipline `tools/build-bundle.mjs` applies to a
    // rule: the PROSE of this file is English, and `anchors` is exempt for the reason the whole
    // `detector` subtree is exempt there — an anchor is detector content and may legitimately spell
    // something that is not English. A file-level grep would reject the legitimate case, which is
    // exactly the false positive the language policy names.
    for (const [path, text] of stringLeaves(doc)) {
      if (/\.anchors\[\d+\]$/.test(path)) continue;
      const chars = [...new Set(text.match(CJK_PATTERN) ?? [])];
      if (chars.length === 0) continue;
      errors.push(
        `vocabulary/${file}: field ${path} contains CJK characters (${chars.slice(0, 12).join("")}) — ` +
          `a shared list's prose is English (the project's English-first rule); only \`anchors\` may spell non-English content`,
      );
    }
    for (const [name, list] of Object.entries(doc.lists)) {
      const first = declaredIn.get(name);
      if (first !== undefined) {
        errors.push(
          `vocabulary/${file}: declares the list "${name}", which vocabulary/${first} already ` +
            `declares. One list has one home: which of the two a rule imported would otherwise ` +
            `depend on the order the directory was read in`,
        );
        continue;
      }
      declaredIn.set(name, file);
      shared[name] = list;
    }
  }
  // AFTER every file has been read, never during. An entry may name a list a LATER file declares,
  // and resolving as each file arrives would make membership depend on directory order — the same
  // silent wrong answer the one-list-one-home error above exists to refuse.
  for (const e of resolveMultiMembership(shared, declaredIn)) errors.push(e);
  return { shared, errors, files };
}

/** `loadSharedVocabulary` for callers with no error list of their own: the first problem throws. */
export function loadSharedVocabularyOrThrow(dir = VOCABULARY_DIR) {
  const { shared, errors } = loadSharedVocabulary(dir);
  if (errors.length > 0) throw new Error(`shared vocabulary could not be loaded:\n  ${errors.join("\n  ")}`);
  return shared;
}

/**
 * One rule's EFFECTIVE word lists: what it declares itself, plus the shared lists it imports.
 *
 * The merge itself is the engine's own `mergeSharedVocabulary`, handed in by the caller from
 * `product/packages/cli/dist/vocabulary.js`, so the lists a tool reasons about are the lists the
 * build merges — see the header for why it is not reimplemented here.
 */
export function effectiveVocabulary(detector, shared, where, mergeSharedVocabulary) {
  return mergeSharedVocabulary(detector?.vocabulary, detector?.shared_vocabulary, shared ?? {}, where);
}

/**
 * One rule's EFFECTIVE per-list matching: what it declares for its own lists, plus what each shared
 * list it imports declares about itself.
 *
 * The merge is the engine's own `mergeVocabularyMatching`, handed in by the caller for the same
 * reason `effectiveVocabulary` above takes `mergeSharedVocabulary`: the flags a tool reasons about
 * must be the flags the build writes and the engine compiles.
 *
 * It is a SEPARATE call rather than a second return value of `effectiveVocabulary`, because the
 * anchors and the flags are merged for different callers: `clause-cover`, `vocab-probe` and
 * `eval-explain` want the words, and only the build writes the flags into the bundle. A caller that
 * wants both makes both calls; a caller that forgets this one gets exact matching, which is what
 * every list compiled to before the capability existed.
 */
export function effectiveVocabularyMatching(detector, shared, where, mergeVocabularyMatching) {
  return mergeVocabularyMatching(
    detector?.vocabulary_matching,
    detector?.shared_vocabulary,
    shared ?? {},
    where,
  );
}

/**
 * One rule's EFFECTIVE per-list kinds: what each shared list it imports says its own items ARE.
 *
 * Same shape and same reason as `effectiveVocabularyMatching` above — the merge is the engine's own
 * `mergeVocabularyKinds`, handed in by the caller, so the kinds a tool reasons about are the kinds
 * the build writes into the bundle.
 *
 * No `own` argument, and that is not an omission: `kind` is a field of a shared vocabulary FILE
 * (`vocabulary.schema.json` requires it there), a rule has no field to declare one in, and so there
 * is nothing for a rule's declaration to collide with.
 */
export function effectiveVocabularyKinds(detector, shared, mergeVocabularyKinds) {
  return mergeVocabularyKinds(detector?.shared_vocabulary, shared ?? {});
}

/**
 * ONE GATE'S CARRIER RULE, PARSED AND READY TO CLONE — and it is one function rather than three
 * lines in five files because the fifth caller is what proved the class.
 *
 * `rules/packs/baseline/baseline-001/rule.yaml` is the `CARRIER` of FIVE tools:
 * `test-shared-vocabulary`, `test-pattern-compile`, `test-vocabulary-matching`,
 * `test-path-exclusions` and `test-local-values`. Each clones it into a planted rules directory
 * beside a planted — or absent — vocabulary directory, so any `shared_vocabulary` key the real rule
 * carries names lists that directory does not declare, the planted build stops, and cases that are
 * not about the carrier at all go red: *"shared_vocabulary names \"log_sinks_dotted\", which no file
 * in the shared vocabulary directory declares (declared: none)"*.
 *
 * DELETING THE KEY IS NOT ENOUGH, and that is the trap this function exists to close. The carrier's
 * own patterns SPLICE the lists it imports, so a clone with the key removed and the lists gone fails
 * one step later on *"pattern splices (?&…) but detector.vocabulary declares no such list"*. Both
 * failures were reproduced on 2026-09-04.
 *
 * So the import is RESOLVED as `tools/build-bundle.mjs` resolves it — the anchors AND the matching
 * flags, so that a carrier importing a tolerant list later does not clone as an exact-matching one
 * and quietly test something the bundle does not ship — and only then is the key removed.
 *
 * `vocabulary_kinds` is DELIBERATELY NOT carried, and the reason is a hard one rather than an
 * oversight: it is a field the BUILD writes into the bundle and `rule.schema.json` does not allow on
 * an authoring rule, so setting it here makes every planted build fail with *"/detector must NOT
 * have additional properties"* — reproduced across all five gates on 2026-09-04 before this line was
 * removed. A tool that needs the kinds of a carrier's imported lists asks `effectiveVocabularyKinds`
 * for them; it must not put them on the rule. **A carrier that imports nothing is returned
 * exactly as it was parsed**, so this is a no-op for every tool until the day its carrier takes an
 * import.
 *
 * The engine's merge functions are loaded DYNAMICALLY rather than imported at the top of this
 * module, for the reason every merge helper above takes its merge function as an argument: this file
 * is imported by tools that neither need nor have a compiled CLI, and a top-level dependency on
 * `product/packages/cli/dist/` would make a missing build their failure too.
 */
export async function loadCarrierRule(carrierPath, dir = VOCABULARY_DIR) {
  const rule = parseYaml(readFileSync(carrierPath, "utf8"));
  const detector = rule?.detector;
  if (!detector || detector.shared_vocabulary === undefined) return rule;

  const enginePath = fileURLToPath(new URL("../product/packages/cli/dist/vocabulary.js", import.meta.url));
  let engine;
  try {
    engine = await import(pathToFileURL(enginePath).href);
  } catch (error) {
    throw new Error(
      `${carrierPath} imports shared vocabulary, so resolving it needs the engine's own merge ` +
        `functions from ${enginePath}, which could not be loaded (${error.message}). Run ` +
        `\`pnpm -C product -r build\` and try again`,
    );
  }

  const shared = loadSharedVocabularyOrThrow(dir);
  const where = `carrier ${carrierPath}`;
  const vocabulary = effectiveVocabulary(detector, shared, where, engine.mergeSharedVocabulary);
  if (vocabulary !== undefined) detector.vocabulary = vocabulary;
  const matching = effectiveVocabularyMatching(detector, shared, where, engine.mergeVocabularyMatching);
  if (matching !== undefined) detector.vocabulary_matching = matching;
  delete detector.shared_vocabulary;
  return rule;
}

/**
 * THE LEGAL ENTITY'S NAME ALONE, per recipient entry, by the entry's name (its `vendor` text before the first
 * " <em dash> ").
 *
 * The self-name question (product/packages/cli/src/own-name.ts) shows each vendor entry it offers by its name and its
 * legal entity, and the person reads the entity's NAME, never its street address. The `vendor` text after the entry's
 * name is the research's own words for the entity, and those words carry an address on some entries ("InnoCraft
 * Limited, 7 Waterloo Quay, ..."), a note on others ("customer-dependent: ..."), or several entities ("Paddle.com
 * Market Limited, 30 Old Bailey, ... / Paddle.com Inc., ..."). Every cutting rule tried against the 80 recipient
 * entries failed on at least one of them (a comma is part of "Stripe Payments Europe, Limited" and "LogRocket, Inc.",
 * and ends the name in "Google LLC, 1600 Amphitheatre Parkway"), so the name is recorded here, once, and each generator
 * writes it to the entry as `legal_name`.
 *
 * NOTHING HERE IS NEW RESEARCH. `legalNameOf` refuses a name that is not cut from the entry's own words: every part
 * (several entities are joined by " / ") must occur verbatim in the entity text, and none may hold a standalone number,
 * which is what a street number, a post code or a registry number is. An entry whose entity text names no entity (it
 * opens with a bracket, "(see note for the entities the research recorded)") carries no `legal_name`; an entry the
 * research found to name no single entity is listed in NO_SINGLE_LEGAL_NAME with the reason; an entry with no entity
 * text at all (the identity lists name the entity in the entry's own name) carries none. Any other entry without a
 * name here is a generator problem, so a new vendor cannot reach the question with its address.
 */
export const LEGAL_NAMES = Object.freeze({
  // comms-recipients (gen-comms-recipients.mjs)
  "Amazon Web Services": "Amazon Web Services EMEA SARL",
  Resend: "Plus Five Five, Inc.",
  "Twilio SendGrid": "Twilio Ireland Limited",
  "Mailchimp Transactional (Mandrill)": "The Rocket Science Group LLC",
  "Mailchimp Marketing": "The Rocket Science Group LLC",
  Slack: "Slack Technologies Limited",
  Discord: "Discord Netherlands BV",
  "Microsoft Teams": "Microsoft Ireland Operations Limited",
  Telegram: "Telegram Messenger Inc.",
  // observ-recipients (gen-observ-recipients.mjs)
  PostHog: "PostHog Inc.",
  "Google Analytics and Google Tag Manager": "Google LLC",
  Mixpanel: "Mixpanel, Inc.",
  "Vercel Web Analytics and Speed Insights": "Vercel Inc.",
  "Twilio Segment": "Twilio Ireland Limited",
  Fullstory: "Fullstory, Inc.",
  Amplitude: "Amplitude, Inc.",
  "Plausible Analytics": "Plausible Insights OÜ",
  "Matomo Analytics (formerly Piwik)": "InnoCraft Limited",
  "Gravatar (Automattic)": "Aut O'Mattic A8C Ireland Ltd.",
  DiceBear: "Florian Körner",
  "wsrv.nl (formerly images.weserv.nl)": "Andries Louw Wolthuizen and Kleis Auke Wolthuizen",
  WorkOS: "WorkOS, Inc.",
  LogRocket: "LogRocket, Inc.",
  Mouseflow: "Mouseflow ApS",
  OpenReplay: "Asayer SAS",
  "Datadog Real User Monitoring and Session Replay": "Datadog, Inc.",
  Sentry: "Functional Software, Inc.",
  Rollbar: "Rollbar, Inc.",
  "BugSnag (SmartBear)": "SmartBear Software Inc.",
  Honeybadger: "Honeybadger Industries LLC",
  AppSignal: "AppSignal B.V.",
  Raygun: "Raygun Limited",
  Airbrake: "Airbrake Technologies, Inc.",
  // payment-recipients (gen-payment-recipients.mjs)
  Stripe: "Stripe Payments Europe, Limited",
  PayPal: "PayPal (Europe) S.a r.l. et Cie, S.C.A.",
  "Braintree (a PayPal service)": "PayPal (Europe) S.a r.l. et Cie, S.C.A.",
  Adyen: "Adyen N.V.",
  Square: "Squareup International Limited",
  Klarna: "Klarna Bank AB (publ)",
  Mollie: "Mollie B.V.",
  Paddle: "Paddle.com Market Limited / Paddle.com Inc. / Paddle Payments Limited / Paddle.com Canada Ltd",
  "Lemon Squeezy": "Sold through Link, LLC",
  Polar: "Polar Software Inc.",
  // storage-recipients (gen-storage-recipients.mjs)
  "Google Cloud Storage": "Google Cloud EMEA Limited",
  "Microsoft Azure Blob Storage": "Microsoft Ireland Operations Limited",
  Cloudinary: "Cloudinary Ltd.",
  "DigitalOcean Spaces": "DigitalOcean, LLC",
  "Cloudflare R2": "Cloudflare, Inc.",
  Uploadthing: "T3 Tools, Inc.",
  "Backblaze B2": "Backblaze, Inc.",
  "Apple Push Notification service (APNs)": "Apple Inc.",
  OneSignal: "OneSignal, Inc.",
  PubNub: "PubNub Inc.",
  Svix: "Svix Inc.",
});

/** Entries whose entity text the research found to name no single entity: no `legal_name`, and the reason. */
export const NO_SINGLE_LEGAL_NAME = Object.freeze({
  Mailgun: "customer-dependent: the notice names Sinch AB (publ) or whichever of its subsidiaries the customer contracted with",
  Mailjet: "customer-dependent: the terms name five entities and the notice Sinch AB (publ) or a subsidiary, by contract",
});

const ENTITY_SEPARATOR = ` ${String.fromCharCode(0x2014)} `;

/**
 * The `legal_name` a generator writes for the entry whose `vendor` text is `label`, or undefined where the entry
 * carries none (see LEGAL_NAMES). Appends to `problems` when the entry needs a name the table does not hold, or when the
 * table's name is not cut from the entry's own words or holds a standalone number.
 * @param {string} label the entry's `vendor` text as the generator writes it
 * @param {string[]} problems appended to; a non-empty array makes the generator refuse to write
 * @returns {string | undefined}
 */
export function legalNameOf(label, problems) {
  const text = String(label ?? "").replace(/\s+/g, " ").trim();
  const at = text.indexOf(ENTITY_SEPARATOR);
  if (at <= 0) return undefined;
  const name = text.slice(0, at).trim();
  const entity = text.slice(at + ENTITY_SEPARATOR.length);
  const legal = Object.hasOwn(LEGAL_NAMES, name) ? LEGAL_NAMES[name] : undefined;
  if (legal === undefined) {
    // The entity text's last part opens with a bracket where the research recorded no entity it could name ("(see note
    // for the entities the research recorded)"); such an entry carries no name, and so does one the research found to
    // name no single entity. Any other entry needs one.
    const last = entity.includes(ENTITY_SEPARATOR) ? entity.slice(entity.lastIndexOf(ENTITY_SEPARATOR) + ENTITY_SEPARATOR.length) : entity;
    if (!last.trim().startsWith("(") && !Object.hasOwn(NO_SINGLE_LEGAL_NAME, name)) {
      problems.push(
        `${name}: its vendor text names an entity and LEGAL_NAMES (tools/shared-vocabulary.mjs) records no name for it; ` +
          `add the entity's name alone, cut from ${JSON.stringify(entity)}, or list the entry in NO_SINGLE_LEGAL_NAME with the reason`,
      );
    }
    return undefined;
  }
  for (const part of legal.split(" / ")) {
    if (!entity.includes(part)) problems.push(`${name}: LEGAL_NAMES gives "${part}", which is not in the entry's own words "${entity}"`);
    if (/(?<![A-Za-z0-9])[0-9]+(?![A-Za-z0-9])/.test(part)) problems.push(`${name}: LEGAL_NAMES gives "${part}", which holds a standalone number (an address, post code or registry number is not a name)`);
  }
  return legal;
}

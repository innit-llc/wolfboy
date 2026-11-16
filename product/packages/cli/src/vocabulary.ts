/**
 * `detector.vocabulary` — the words a rule looks for, declared once and spliced into every place
 * that needs them.
 *
 * WHY IT EXISTS. A rule that is read two ways has to look for the same words both ways. The
 * structural prototype held its own copies of this rule's element lists, handler spellings and
 * name-supplying attributes, and by the time the two were read side by side they had already
 * drifted: the copy matched `x-on:key` and `onkey` where the rule's own negation did not, and
 * treated `img`, `use`, `path`, `symbol` and `label` as things the rule had never named. Two copies
 * of one list is the failure the project's rules name directly — "never keep a second copy of anything two
 * places must agree on; export it and import it" — so the rule declares the list and both readings
 * splice it.
 *
 * THE SPLICE SYNTAX IS `(?&name)`, AND THE CHOICE IS LOAD-BEARING. `new RegExp("{{name}}")` compiles
 * and matches nothing: a consumer that forgot to expand it would report zero findings and look
 * healthy, which is the one failure mode this whole design must not have. `new RegExp("(?&name)")`
 * throws `Invalid regular expression`. Every consumer that compiles a rule's pattern without going
 * through this module therefore CRASHES rather than under-measuring. `(?&name)` is also PCRE's own
 * syntax for "insert the named group here", so it is not an invention.
 *
 * Items are LITERAL TEXT, not fragments of regular expression: each is escaped on the way in, so
 * `(click)` matches the six characters `(click)`. They are spliced longest-first so that no item can
 * shadow a longer one that starts with it.
 *
 * THE SPLICED FORM IS A PREFIX TRIE, not a flat `a|b|c` (2026-09-15, step 1 of the speed-up lane).
 * It accepts exactly the same strings in exactly the same order of preference and is a great deal
 * faster to run: see `alternation` for the measurement, the two rewrites the equivalence rests on,
 * and why the factoring is done on the ATOMS an item is made of rather than on its finished source.
 */

/** Named lists of literal strings, exactly as `detector.vocabulary` declares them. */
export type Vocabulary = Record<string, string[]>;

/**
 * The splice syntax itself, as source text, so that every regular expression built from it is built
 * from ONE original.
 *
 * `SPLICE` (global) and `SPLICE_AT` (sticky, further down) are the same six-character syntax under
 * two flags, and until 2026-09-15 they were two transcriptions of it — a forbidden second copy,
 * four characters wide. It is EXPORTED because a checker outside this module that has to
 * splice a pattern the way `expandPattern` splices it — the speed-up lane's equivalence harness
 * under an internal record expands every rule's patterns two ways and compares them — would
 * otherwise re-type the syntax and become a third copy of it.
 */
export const SPLICE_SOURCE = "\\(\\?&([A-Za-z_][A-Za-z0-9_]*)\\)";

const SPLICE = new RegExp(SPLICE_SOURCE, "g");

/**
 * A LIST NAME IS AUTHORED TEXT, AND `__proto__` IS A LEGAL ONE.
 *
 * `(?&__proto__)` is a valid splice, `rule.schema.json` and `vocabulary.schema.json` both accept
 * the name, and YAML and `JSON.parse` both define it as a real own property — so a bundle can
 * legitimately carry a list called `__proto__`. Every place in this module that treats a
 * vocabulary as a MAP must therefore go through these two helpers rather than `obj[name]`:
 *
 * - reading `({} as Vocabulary)["__proto__"]` returns `Object.prototype`, which is truthy and whose
 *   `.length` is `undefined`, so the "declares no such list" guard below does NOT fire and
 *   `alternation` is handed an object it cannot iterate. The scan dies with
 *   `TypeError: items is not iterable` instead of naming the rule and the list.
 * - writing `obj["__proto__"] = items` on a plain object invokes the inherited setter and creates
 *   no own property at all, so the list is present in memory and absent from `JSON.stringify`.
 *
 * Both are the same defect — an inherited slot mistaken for a declared list — and both are closed
 * for EVERY key of `Object.prototype` at once, rather than by naming `__proto__` in a denylist that
 * two schemas would then have to keep in step.
 */
function ownList(vocabulary: Vocabulary | undefined, name: string): string[] | undefined {
  if (!vocabulary || !Object.prototype.hasOwnProperty.call(vocabulary, name)) return undefined;
  return vocabulary[name];
}

/** An empty vocabulary that no key of `Object.prototype` can be mistaken for. See `ownList`. */
function emptyVocabulary(): Vocabulary {
  return Object.create(null) as Vocabulary;
}

/** Escape every regular-expression metacharacter, so an item matches itself and nothing else. */
export function escapeLiteral(item: string): string {
  return item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ========================================================================= *
 * TOLERANT ANCHOR MATCHING — how a list's items are spelled into the pattern.
 * ========================================================================= *
 *
 * WHY IT EXISTS. Every item is escaped literal text and the engine compiles with no flags, so an
 * anchor matched the exact bytes somebody typed and nothing else. Measured on 2026-08-27: of 1,083 anchor bases
 * across the shared recipient lists, 24 are spelled with more than one separator skeleton and 32 in
 * more than one case form. `recipients-005` compiled with its real vocabulary fires on
 * `Bamboo.SendGridAdapter` and is silent on `Bamboo.PostmarkAdapter`, `Bamboo.MailgunAdapter` and
 * `Bamboo.MandrillAdapter` — one of four Elixir mailer adapters is reached, and the difference is
 * that somebody typed `SendGrid` with a capital G into `comms-recipients.yaml` and typed the other
 * three vendors in lower case only.
 *
 * WHERE THE TOLERANCE IS APPLIED, AND WHY IT IS NOT A REGEXP FLAG. `new RegExp(p, "i")` would make
 * the WHOLE clause case-blind, including the construct guard the clause is built out of — a rule
 * that says `<groupId>` would start accepting `<GROUPID>`, and a clause splicing one flagged list
 * and one unflagged one could not have both. So the tolerance is compiled into the ALTERNATION and
 * nowhere else: exactly the items of exactly the flagged list change, and every other character of
 * the pattern is the character the author wrote. (`(?i:…)` — a modifier group, which would express
 * this directly — is not available: Node 22 throws `Invalid group` on it.)
 *
 * IT IS ONLY EVER A WIDENING. An item's tolerant form matches a superset of what its exact form
 * matches, so no line that is a candidate today stops being one. That is what makes the flag safe
 * under this project's doctrine, and it is also why `assertTolerantListsAreReadPositively` below
 * refuses a flagged list spliced into a NEGATIVE field: widening `match_without`, `path_without` or
 * `guard_missing` disqualifies more lines, which is subtraction wearing the coat of an addition.
 *
 * THE TWO FLAGS ARE TWO QUESTIONS AND ARE DECLARED SEPARATELY. Case is a property of how a language
 * spells a name (`postmark` in a dependency line, `Postmark` in a module name); separator is a
 * property of how an ecosystem joins words (`help_scout`, `helpscout`, `help-scout`). They carry
 * different risks — separator tolerance is the one that can reach across characters the author
 * wrote — so they can be turned on one at a time and their cost measured one at a time.
 */

/** How one named list's items are spelled into the pattern. Absent means: exactly, as before. */
export interface ListMatching {
  /** ASCII letters of the item match in either case. Non-ASCII letters do not — see `foldedChar`. */
  case_insensitive?: boolean;
  /** A separator run BETWEEN two alphanumerics matches any separators, or none — see `SEPARATORS`. */
  separator_insensitive?: boolean;
}

/** Per-list matching, keyed by the list name it applies to. Every name must be a declared list. */
export type VocabularyMatching = Record<string, ListMatching>;

/** The flag names `ListMatching` defines. A key outside this set is an authoring mistake, not a no-op. */
const MATCHING_FLAGS = ["case_insensitive", "separator_insensitive"] as const;

/**
 * The characters a separator run may be made of, and the ones it may be swapped for.
 *
 * `-`, `_` and `.` join the parts of ONE identifier, package name or hostname, and are the three the
 * corpus actually varies between. **Whitespace and `/` are deliberately absent.** Admitting them
 * would let `help_scout` match `help scout` and `@stripe/js` match `@stripejs` — the anchor
 * reaching across a boundary it was never meant to cross, which is the one failure mode this
 * capability must not have.
 */
export const SEPARATORS = "-_.";

/** A separator run that sits BETWEEN two alphanumerics. A leading or trailing run is never flexible. */
export const INNER_SEPARATOR_RUN = /(?<=[A-Za-z0-9])[-_.]+(?=[A-Za-z0-9])/g;

/**
 * One character as a case-blind class, or escaped as itself.
 *
 * ONLY ASCII LETTERS ARE FOLDED, and that is a decision rather than an oversight. `toUpperCase()` on
 * a non-ASCII letter is not a per-character operation: `ß` upper-cases to the TWO characters `SS`,
 * which inside a class would silently become "an `S`"; `İ` lower-cases to two code points. A pair of
 * such classes matches strings the author never wrote and the failure is invisible. So a non-ASCII
 * letter is emitted as itself, case-sensitively, and an author who needs both cases of one writes
 * both spellings — which is what the vocabulary files already do.
 */
function foldedChar(ch: string): string {
  if (ch.length !== 1 || !/[A-Za-z]/.test(ch)) return escapeLiteral(ch);
  return `[${ch.toUpperCase()}${ch.toLowerCase()}]`;
}

/**
 * One item as an ARRAY OF ATOMS, under this list's matching: one entry per code point, plus one per
 * inner separator run. Joined with nothing between them they are the item's regular-expression
 * source, which is what this function returned as a string (as `itemSource`) until 2026-09-15.
 *
 * WHY THE UNITS ARE RETURNED RATHER THAN A FINISHED STRING. `alternation` below factors a list's
 * shared prefixes into a trie, and a trie has to know where one matching unit ends and the next
 * begins. In the finished source that boundary is not visible without re-parsing a regular
 * expression: `\.` is one unit written in two characters, `[Aa]` one unit in four, `[-_.]{0,2}` one
 * unit in eleven, and a lazy quantifier or an authored group would be others again. The prototype
 * this change comes from did re-parse the source and had one short alternation it got
 * wrong and could not account for. The units are known HERE, where they are made, so they are handed
 * over rather than reconstructed, and no re-parser exists to be wrong.
 *
 * With no matching — the default, and every list until 2026-08-27 — each atom is one code point
 * through `escapeLiteral` and nothing else, so an unflagged list joins back to the byte-identical
 * source it compiled to before either mechanism existed. (`escapeLiteral` replaces one character at
 * a time, so escaping each code point and joining is the same string as escaping the whole item.)
 *
 * ITERATION IS BY CODE POINT, not by index: `[...item]` keeps a surrogate pair together, so an
 * astral character can never be split into two halves that a class would then match separately —
 * nor, now, into two trie atoms that a later item could branch between.
 *
 * A SEPARATOR RUN MAY NEVER GROW. A run of length n becomes `[-_.]{0,n}`, so `mailgun.js` reaches
 * `mailgunjs`, `mailgun-js` and `mailgun_js` and never `mailgun--js`. The zero is what buys the
 * un-separated spelling; the ceiling is what stops the anchor drifting.
 */
export function itemAtoms(item: string, matching: ListMatching | undefined): string[] {
  const charAtom = matching?.case_insensitive ? foldedChar : escapeLiteral;
  const chars = (text: string): string[] => [...text].map((ch) => charAtom(ch));
  if (!matching?.separator_insensitive) return chars(item);
  const atoms: string[] = [];
  let last = 0;
  INNER_SEPARATOR_RUN.lastIndex = 0;
  for (let m = INNER_SEPARATOR_RUN.exec(item); m !== null; m = INNER_SEPARATOR_RUN.exec(item)) {
    atoms.push(...chars(item.slice(last, m.index)), `[${SEPARATORS}]{0,${m[0].length}}`);
    last = m.index + m[0].length;
  }
  atoms.push(...chars(item.slice(last)));
  return atoms;
}

/** The matching declared for one list, read the `ownList` way — see `ownList` for why. */
function listMatching(matching: VocabularyMatching | undefined, name: string): ListMatching | undefined {
  if (!matching || !Object.prototype.hasOwnProperty.call(matching, name)) return undefined;
  return matching[name];
}

/**
 * Refuse a `vocabulary_matching` that does not describe this rule's lists.
 *
 * Four hard errors, and each is a declaration that would otherwise LOOK like it did something:
 *
 * - A NAME NO LIST HAS. The flag would apply to nothing, and the list the author meant would go on
 *   matching exactly — the silence this whole repair exists to end, re-created by a typo.
 * - A FLAG NAME `ListMatching` DOES NOT DEFINE. `case_insensitve: true` is a no-op that reads in
 *   review as the capability being on.
 * - AN ENTRY THAT TURNS NOTHING ON. `{}`, or every flag false, is a list that is written down as
 *   flagged and compiles exactly as before.
 * - THE WHOLE OBJECT EMPTY. `vocabulary_matching: {}` names no list at all, so this loop runs zero
 *   times and the field survives the build into the bundle, where it reads as the capability being
 *   ON and compiles as it being OFF — the same defect as the per-list `{}` one level out, and it
 *   was left open when that one was closed (found by the independent verification of 2026-08-27).
 *   It is a hard error and NOT stripped by the build, for the reason the other three are: an author
 *   who wrote it meant something, and quietly deleting the field answers them with silence.
 */
export function assertVocabularyMatching(
  vocabulary: Vocabulary | undefined,
  matching: VocabularyMatching | undefined,
  where: string,
): void {
  if (!matching) return;
  if (Object.keys(matching).length === 0) {
    throw new Error(
      `${where}: detector.${VOCABULARY_MATCHING_FIELD} is present and empty, so it names no list and ` +
        `changes no pattern, while a reader — and any audit counting which rules carry the capability — ` +
        `reads it as the capability being on. Name the list it was meant for, or remove the field`,
    );
  }
  for (const name of Object.keys(matching)) {
    if (!ownList(vocabulary, name)) {
      throw new Error(
        `${where}: detector.vocabulary_matching names "${name}", which is not one of this rule's ` +
          `vocabulary lists (declared: ${Object.keys(vocabulary ?? {}).join(", ") || "none"})`,
      );
    }
    const entry = matching[name] as Record<string, unknown>;
    const unknown = Object.keys(entry ?? {}).filter((k) => !(MATCHING_FLAGS as readonly string[]).includes(k));
    if (unknown.length > 0) {
      throw new Error(
        `${where}: detector.vocabulary_matching.${name} declares ${unknown.join(", ")}, which no matching ` +
          `flag is called (known: ${MATCHING_FLAGS.join(", ")}) — a misspelt flag is read as the ` +
          `capability being on and compiles as it being off`,
      );
    }
    if (!MATCHING_FLAGS.some((f) => entry?.[f] === true)) {
      throw new Error(
        `${where}: detector.vocabulary_matching.${name} turns no flag on, so the list is written down as ` +
          `matched tolerantly and compiles exactly as it did before. Set one of ${MATCHING_FLAGS.join(", ")} ` +
          `or remove the entry`,
      );
    }
  }
}

/**
 * The two lookarounds that read what follows or precedes them as a NEGATION, and the words for them.
 *
 * `(?=` and `(?<=` are their positive twins and are deliberately absent: a wider list inside a
 * POSITIVE lookaround makes the clause accept more lines, which is the widening the flag is for.
 * A named capture group opens `(?<name>`, which is why the lookbehind key is the four characters
 * `(?<!` and never the two `(?<` — the shorter test would refuse a splice nobody negated.
 */
const NEGATIVE_LOOKAROUNDS = new Map<string, string>([
  ["(?!", "a negative lookahead"],
  ["(?<!", "a negative lookbehind"],
]);

/** The same splice as `SPLICE`, anchored: `y` matches at `lastIndex` or not at all. See `spliceSites`. */
const SPLICE_AT = new RegExp(SPLICE_SOURCE, "y");

/** The text that opens the group at `at`. Four-character forms are tested first, so `(?<!` beats `(?<`. */
function groupOpening(pattern: string, at: number): string {
  for (const opening of ["(?<=", "(?<!", "(?:", "(?=", "(?!"]) {
    if (pattern.startsWith(opening, at)) return opening;
  }
  return "(";
}

/**
 * One `(?&name)` splice and the innermost negative lookaround around it, if any. `negation` is the
 * construct's own opening text — `(?!` or `(?<!` — so the message can quote the characters the
 * author wrote rather than a description of them; `NEGATIVE_LOOKAROUNDS` holds the words.
 */
interface SpliceSite {
  name: string;
  negation?: string;
}

/**
 * Every `(?&name)` in one pattern, WITH THE SYNTACTIC CONTEXT IT SITS IN.
 *
 * A regular expression is walked rather than searched, because the question is where a splice sits
 * and no text pattern answers that. Three states are tracked and they are the three that decide
 * whether a `(` opens a group at all:
 *
 * - AN ESCAPE consumes the character after it, so `\(` is a literal parenthesis and not a group.
 * - A CHARACTER CLASS suspends grouping entirely: `[()]` is two literal characters. `]` immediately
 *   after `[` closes the class, which is JavaScript's own reading (`[]` matches nothing) and not
 *   POSIX's.
 * - THE OPEN-GROUP STACK is what a splice's context is read off. A splice is recognised BEFORE the
 *   group classifier, because `(?&name)` starts with `(` too and must not be pushed as a group.
 *
 * An unbalanced `)` pops an empty stack and is ignored: a pattern that does not compile is
 * `test:pattern-compile`'s failure to report, and this walk must not throw a second, confusing one.
 */
function spliceSites(pattern: string): SpliceSite[] {
  const sites: SpliceSite[] = [];
  const open: string[] = [];
  let inClass = false;
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (inClass) {
      if (ch === "]") inClass = false;
      i += 1;
      continue;
    }
    if (ch === "[") {
      inClass = true;
      i += 1;
      continue;
    }
    if (ch === "(") {
      SPLICE_AT.lastIndex = i;
      const splice = SPLICE_AT.exec(pattern);
      if (splice) {
        const negation = [...open].reverse().find((o) => NEGATIVE_LOOKAROUNDS.has(o));
        sites.push(negation ? { name: splice[1], negation } : { name: splice[1] });
        i += splice[0].length;
        continue;
      }
      const opening = groupOpening(pattern, i);
      open.push(opening);
      i += opening.length;
      continue;
    }
    if (ch === ")") {
      open.pop();
      i += 1;
      continue;
    }
    i += 1;
  }
  return sites;
}

/** Every detector field that is a list of patterns — read by shape, so a field added later is covered. */
function patternFieldsOf(detector: Record<string, unknown> | undefined): [string, string[]][] {
  const fields: [string, string[]][] = [];
  for (const field of Object.keys(detector ?? {})) {
    const value = detector?.[field];
    if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
      fields.push([field, value as string[]]);
    }
  }
  return fields;
}

/**
 * Refuse a flagged list that is read as a NEGATION — by field, and by where in the pattern it sits.
 *
 * `match` and `also_in_file` are read positively: widening what they match raises more candidates,
 * which is cost. `match_without` and `path_without` DISQUALIFY a line, and `guard_missing` reports
 * when its pattern is absent — widening any of the three makes the rule fire LESS. Under this
 * project's doctrine subtraction is the only operation that can create a miss, so a tolerant list
 * reaching one of those fields is refused rather than compiled.
 *
 * THE FIELD NAME IS NOT THE WHOLE QUESTION, and reading only the field name was this check's own
 * defect, found by the independent verification of 2026-08-27. A list spliced inside `(?!…)` or
 * `(?<!…)` in `match` — a POSITIVELY read field — is read as a negation by the regular-expression
 * engine just the same, and widening it deletes findings. It is not hypothetical: `eu-accessibility-001`
 * splices `key_handlers` inside `(?!…)` in four of its fifteen `match` patterns and `eu-retention-002`
 * splices `inverted_words` inside `(?!…)` in `match` and `also_in_file`. Flagging `key_handlers`
 * built with exit 0, passed the gate with zero failures, and took `eu-accessibility-001` from one
 * location to none on `<div onClick={f} ONKEY={g}>x</div>` — a keyboard-accessibility finding
 * deleted by an edit that read, in review and in the gate, as a pure widening. So the splice's
 * SYNTACTIC CONTEXT is walked (see `spliceSites`) and every pattern field is walked, not three.
 *
 * A DOUBLY NEGATED SPLICE — one inside `(?!(?!…))` — really would widen, and it is refused anyway.
 * Refusing it stops a build nobody has written yet; admitting it would rest the guard on a parity
 * argument a reviewer has to re-derive, and getting that argument wrong costs a miss nobody counts.
 * The message names the construct, so an author who means it can restructure the clause.
 */
export function assertTolerantListsAreReadPositively(
  detector: Record<string, unknown> | undefined,
  matching: VocabularyMatching | undefined,
  where: string,
): void {
  if (!matching || Object.keys(matching).length === 0) return;
  for (const field of ["match_without", "path_without", "guard_missing"]) {
    for (const pattern of (detector?.[field] as string[] | undefined) ?? []) {
      SPLICE.lastIndex = 0;
      for (let m = SPLICE.exec(String(pattern)); m !== null; m = SPLICE.exec(String(pattern))) {
        if (listMatching(matching, m[1])) {
          throw new Error(
            `${where}: detector.${field} splices (?&${m[1]}), which detector.vocabulary_matching flags as ` +
              `tolerantly matched. Tolerant matching only ever widens what a list matches, and this field ` +
              `is read as a negation, so widening it would make the rule fire on FEWER lines — a narrowing ` +
              `wearing the coat of an addition`,
          );
        }
      }
    }
  }
  for (const [field, patterns] of patternFieldsOf(detector)) {
    patterns.forEach((pattern, index) => {
      for (const site of spliceSites(pattern)) {
        if (!site.negation || !listMatching(matching, site.name)) continue;
        throw new Error(
          `${where}: detector.${field}[${index}] splices (?&${site.name}) inside ` +
            `${NEGATIVE_LOOKAROUNDS.get(site.negation)} ${site.negation}…), which ` +
            `detector.vocabulary_matching flags as tolerantly matched. Tolerant matching only ever ` +
            `widens what a list matches, and a wider list inside a negation disqualifies MORE lines, so ` +
            `the rule would fire on FEWER — a narrowing wearing the coat of an addition. The FIELD is ` +
            `read positively; this splice is not`,
        );
      }
    });
  }
}

/**
 * A list's items in the order they are spliced: longest first, ties broken by `localeCompare`.
 *
 * Longest first because with `["on:key", "on:keydown"]` the shorter branch would otherwise win and
 * the longer one could never match, which is a silent narrowing rather than an error. The order is
 * decided by the ITEMS' own lengths, never by the source they compile to, so declaring a matching
 * flag cannot re-order the branches of a list.
 *
 * Exported for the same reason `SPLICE_SOURCE` is: a checker that states what the old flat
 * alternation was — a test and the speed-up lane's corpus harness both do
 * — needs this order, and a re-typed comparator would be a second copy of it that agreed on the day
 * it was written.
 */
export function sortedItems(items: string[]): string[] {
  return [...items].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

/**
 * One node of the prefix trie `alternation` builds. `children` is a `Map`, so ITERATION ORDER IS
 * INSERTION ORDER — which is what carries the longest-first order of the items into the order of the
 * emitted branches.
 */
interface TrieNode {
  terminal: boolean;
  children: Map<string, TrieNode>;
}

/**
 * Everything BELOW one trie node, as regular-expression source.
 *
 * A node with one child emits `atom + child`; several children emit `(?:c1|c2|…)`; a node that is
 * TERMINAL and also has children wraps them as `(?:…)?`, because the item that ended here may be
 * matched without any of the continuations below it.
 *
 * The `?` IS GREEDY, and here is what that actually buys — stated correctly after independent
 * verification measured the previous wording here wrong.
 * A test compares PRESENCE (does it match) and OFFSET (where the
 * leftmost match begins), and a LAZY `??` in this position would be harmless to both: it still
 * accepts the same language and still begins a match at the same leftmost position, so that gate
 * would stay green under it — the offset check is not, and was never, what catches a lazy
 * quantifier here. What the greedy `?` actually buys is which spelling is MATCHED: trying the
 * longer continuation before the empty one is what carries the flat form's longest-first
 * preference into the matched text, in every case where no nullable atom sits between the two
 * branches. Where one does — a `[-_.]{0,n}` separator run that can match zero characters — the
 * winner can already differ from the flat form's own, regardless of greediness; `alternation`'s
 * own documentation above states that case, and a test pins it as a
 * recorded example. On a plain prefix chain it is never the other way round: an item whose atoms
 * are a proper prefix of another item's atoms is always the SHORTER item — equal atoms consume
 * equal numbers of UTF-16 units, so a proper atom-prefix is a proper string-prefix — and
 * `sortedItems` therefore always inserts the longer one first.
 */
function emitTrie(node: TrieNode): string {
  const branches = [...node.children].map(([atom, child]) => atom + emitTrie(child));
  if (branches.length === 0) return "";
  if (branches.length === 1) return node.terminal ? `(?:${branches[0]})?` : branches[0];
  return node.terminal ? `(?:${branches.join("|")})?` : `(?:${branches.join("|")})`;
}

/**
 * One named list as an alternation, ready to be spliced into a pattern, WITH ITS SHARED PREFIXES
 * FACTORED INTO A TRIE: `(?:[Kk](?:[Ll][Aa][Rr][Nn][Aa]|[Oo][Uu][Nn][Tt]))` where the flat form was
 * `(?:[Kk][Ll][Aa][Rr][Nn][Aa]|[Kk][Oo][Uu][Nn][Tt])`.
 *
 * WHY. Profiling of a real scan on 2026-09-14 put 74 % of scan time in V8's
 * regular-expression engine, and the cost is concentrated in exactly these alternations: a branch
 * spelled per character as case classes has no literal first character, so V8 restarts hundreds of
 * branches at every position of every line. Factoring the shared prefixes measured 1.41× end to end
 * and up to 18× on the hottest clause, with the findings document byte-identical.
 *
 * THE ACCEPTED LANGUAGE IS UNCHANGED BY CONSTRUCTION, and the argument is two identities rather than
 * a measurement:
 *   - concatenation distributes over alternation, so `(?:PQ|PR)` and `P(?:Q|R)` accept the same
 *     strings — that is every non-terminal node;
 *   - `(?:PQ|P)` ≡ `P(?:Q)?` — that is every terminal node that also has children.
 * A trie is those two rewrites applied repeatedly, so the emitted source and the flat source accept
 * the same strings whatever they are spliced into — and therefore also begin a match at the same
 * offset, which is the one positional fact the engine reads (`engine.ts` takes `exec().index` on an
 * `also_in_file` clause and writes the line it falls on into `corroborated_from`).
 *
 * WHAT IS NOT PRESERVED, STATED HERE BECAUSE IT IS REAL: which of several overlapping spellings
 * WINS. The flat form orders its branches by item length; a trie groups them by shared prefix, which
 * is a different order, and two items can match the same text when one of the atoms between them is
 * NULLABLE — `[-_.]{0,n}`, which may match nothing. `recipients-004` has the shape: its
 * `captcha_recipients` declares `h-captcha-response`, `hcaptcha.com`, `h-captcha` and `hcaptcha`
 * with both flags on, and on the text `hcaptcha.com` the flat form's winner is `hcaptcha.com` while
 * the trie's is `hcaptcha`, reached through `h[-_.]{0,1}captcha` with the run empty. Both match, at
 * offset 0, which is everything this engine asks. Audited 2026-09-15 across every consumer of a
 * compiled clause: all of them are `test`, except `engine.ts` 1557, which reads `.index`, and
 * `engine.ts` 1958, which records a clause's own `source` and reads `guard_missing` — a field no
 * rule in this repository has carried since 2026-07-27. Nothing reads the text a clause matched.
 * A test is the standing check of all of this, including the pin on that
 * one worked example, so the limit stays a recorded property rather than a later surprise.
 *
 * TWO CASES THAT LOOK LIKE EDGES AND ARE NOT. Two items that produce the same atoms — `a-b` and
 * `a_b` under `separator_insensitive`, `AB` and `ab` under `case_insensitive` — walk one path and
 * mark it terminal twice, which is the flat form's duplicate branch with one of the two removed; and
 * an item that produces no atoms at all (the empty string, which `rule.schema.json` does not
 * forbid) marks the ROOT terminal, so the whole alternation becomes optional, which is what the flat
 * form's empty branch means. A list of ONE item never branches, so it emits the byte-identical
 * `(?:…)` it emitted before this function had a trie in it.
 *
 * The result is always wrapped in `(?:…)`, unchanged: callers splice it into larger patterns and
 * into `^…$` (`scan.ts`), and a bare alternation would bind those anchors to its first branch alone.
 */
export function alternation(items: string[], matching?: ListMatching): string {
  const root: TrieNode = { terminal: false, children: new Map() };
  for (const item of sortedItems(items)) {
    let node = root;
    // TRIE KEYS ARE THE ATOM STRINGS, and two atoms whose strings differ are never merged even when
    // the characters they match overlap: `[-_.]{0,1}` and `[-_.]{0,2}` are two keys, and so are
    // `[Aa]` and `a`. Merging on anything cleverer than string identity would mean deciding that two
    // different sub-expressions match the same set, which is the re-parsing this design avoids.
    for (const atom of itemAtoms(item, matching)) {
      let next = node.children.get(atom);
      if (next === undefined) {
        next = { terminal: false, children: new Map() };
        node.children.set(atom, next);
      }
      node = next;
    }
    node.terminal = true;
  }
  const branches = [...root.children].map(([atom, child]) => atom + emitTrie(child));
  // No branches at all: an empty list, or a list whose only item is the empty string. Both produced
  // `(?:)` before the trie and produce it now. (`expandPattern` refuses to splice an empty list, so
  // the first of the two never reaches a pattern; it is answered here so that a direct caller —
  // `scan.ts` compiles single-anchor alternations — cannot get something else.)
  if (branches.length === 0) return "(?:)";
  const body = branches.join("|");
  return root.terminal ? `(?:(?:${body})?)` : `(?:${body})`;
}

/**
 * Expand every `(?&name)` in one pattern.
 *
 * A splice naming a list the rule did not declare is a HARD ERROR. It is never expanded to an empty
 * alternation and never left in place to fail later: an undeclared name is an authoring mistake, and
 * the two silent readings of it — matching nothing, or matching everything — are both worse than a
 * build that stops.
 */
export function expandPattern(
  pattern: string,
  vocabulary: Vocabulary | undefined,
  where: string,
  matching?: VocabularyMatching,
): string {
  SPLICE.lastIndex = 0;
  if (!SPLICE.test(pattern)) return pattern;
  return pattern.replace(SPLICE, (_full, name: string) => {
    const items = ownList(vocabulary, name);
    if (!items || items.length === 0) {
      throw new Error(
        `${where}: pattern splices (?&${name}) but detector.vocabulary declares no such list` +
          (vocabulary ? ` (declared: ${Object.keys(vocabulary).join(", ") || "none"})` : " (no vocabulary declared)"),
      );
    }
    // `matching` is optional and every caller that omits it gets the byte-identical source it got
    // before tolerant matching existed — that is what makes turning the capability on a change to
    // the flagged lists alone. See `itemAtoms`.
    return alternation(items, listMatching(matching, name));
  });
}

/** Expand a list of patterns. */
export function expandPatterns(
  patterns: string[] | undefined,
  vocabulary: Vocabulary | undefined,
  where: string,
  matching?: VocabularyMatching,
): string[] {
  return (patterns ?? []).map((p) => expandPattern(p, vocabulary, where, matching));
}

/**
 * One declared list, by name. Used by structural check sets, which read the same lists the patterns
 * splice. A missing list throws for the same reason an undeclared splice does: a check set that
 * silently fell back to a built-in list would be the second copy re-entering through the back door.
 */
export function vocabularyList(vocabulary: Vocabulary | undefined, name: string, where: string): string[] {
  const items = ownList(vocabulary, name);
  if (!items || items.length === 0) {
    throw new Error(`${where}: detector.vocabulary declares no list named "${name}"`);
  }
  return items;
}

/* ========================================================================= *
 * SHARED VOCABULARY — one word list, imported by many rules.
 * ========================================================================= *
 *
 * WHY IT EXISTS. `detector.vocabulary` above put a rule's word lists in one place WITHIN THAT RULE,
 * and that is as far as it reaches. The spelling of a payment vendor is written today in
 * `rules/packs/eu-cra/eu-cra-001/rule.yaml` and again in `rules/packs/eu-dsr/eu-dsr-001/rule.yaml`,
 * and the recipients family being authored needs the same spellings a third time. Three copies of
 * one fact is what the project's rules forbid by name — "never keep a second copy of anything two places
 * must agree on; export it and import it" — so a list may now live in `rules/vocabulary/*.yaml`
 * and be named by any number of rules in `detector.shared_vocabulary`.
 *
 * THE ONE DESIGN PROBLEM, AND HOW IT IS SOLVED. A splice needs a FLAT LIST OF LITERALS. A reader of
 * a shared list needs FOUR THINGS PER ENTRY — who the recipient is, the anchors that spell it, what
 * it receives, and the jurisdiction with the source that establishes it. Those two shapes are not
 * the same shape, and a file that stored both would be storing one fact twice: the flat list would
 * be a copy of the anchors, and the day someone edited one the two would disagree — which is the
 * failure this whole mechanism exists to end, reintroduced inside its own file.
 *
 * So the flat list is NOT STORED. The file holds entries; the spliced list is a PROJECTION of them
 * — every entry's `anchors`, concatenated in file order — computed here on every read. There is
 * exactly one copy on disk, it is the structured one, and the flat one cannot drift from it because
 * it does not exist until it is asked for. `sharedListItems` is that projection and is the only way
 * a shared list becomes items.
 *
 * WHERE RESOLUTION HAPPENS, AND WHY THE ENGINE DOES NOT DO IT. `tools/build-bundle.mjs` merges the
 * imported lists into each rule's `detector.vocabulary` and writes the result into the bundle, so a
 * shipped bundle carries no imports and the scanner needs no access to `rules/vocabulary/` — which
 * it would not have, since a user's machine has the bundle and nothing else. The engine's own
 * defence against a bundle that was NOT built that way is `assertSharedVocabularyResolved`.
 */

/**
 * One entry of a shared list. `anchors` is the only field this module reads: the rest is what the
 * entry is FOR — `product/packages/schemas/schemas/vocabulary.schema.json` is what requires a
 * recipient entry to carry its identity, what it receives, and its jurisdiction with a source, and
 * `rules/vocabulary/README.md` is where the shape is explained to an author.
 */
export interface SharedEntry {
  anchors: string[];
  [field: string]: unknown;
}

/** One named shared list: what kind of thing its entries are, and the entries. */
export interface SharedList {
  kind: string;
  entries: SharedEntry[];
  [field: string]: unknown;
}

/** Every shared list on disk, keyed by the name a rule imports it under. */
export type SharedVocabulary = Record<string, SharedList>;

/** The `detector` field a rule names shared lists in. Written once; imported wherever it is read. */
export const SHARED_VOCABULARY_FIELD = "shared_vocabulary";

/**
 * The literal items one shared list contributes — every entry's `anchors`, in file order.
 *
 * THE PROJECTION. Nothing else turns a shared list into items, so the flat form exists only as a
 * return value and can never be edited out of step with the entries it came from.
 *
 * Three hard errors, and each one is a thing that would otherwise be silent:
 *
 * - AN EMPTY LIST, or an entry with no anchors. `expandPattern` above already refuses to splice an
 *   empty list, because an empty alternation matches either nothing or everything depending on how
 *   it is written and both readings are wrong. A shared list reaching that state is the same defect
 *   one file earlier, and it is caught with the file and the list named rather than the rule.
 * - AN ANCHOR THAT IS NOT A STRING. Items are literal text; a number or a null spliced through
 *   `escapeLiteral` becomes the characters of its own `String()` and matches something nobody wrote.
 * - THE SAME ANCHOR ON TWO ENTRIES OF ONE LIST. Harmless to the alternation — a duplicate branch
 *   changes nothing about what matches — and NOT harmless to a reader, which is why it stops the
 *   build: it means two entries claim one spelling, and which of them a match belongs to is a
 *   question the file no longer answers. `Stripe` appearing in `payment_vendors` and again in
 *   `subprocessors` is a different thing entirely and is not an error: two lists are two questions.
 */
export function sharedListItems(name: string, list: SharedList, where: string): string[] {
  const entries = list?.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`${where}: shared vocabulary list "${name}" has no entries`);
  }
  const items: string[] = [];
  const owner = new Map<string, number>();
  entries.forEach((entry, index) => {
    const anchors = entry?.anchors;
    if (!Array.isArray(anchors) || anchors.length === 0) {
      throw new Error(`${where}: shared vocabulary list "${name}" entry [${index}] declares no anchors`);
    }
    for (const anchor of anchors) {
      if (typeof anchor !== "string" || anchor.length === 0) {
        throw new Error(
          `${where}: shared vocabulary list "${name}" entry [${index}] has an anchor that is not a ` +
            `non-empty string (${JSON.stringify(anchor)}) — anchors are literal text`,
        );
      }
      const first = owner.get(anchor);
      if (first !== undefined) {
        throw new Error(
          `${where}: shared vocabulary list "${name}" gives the anchor ${JSON.stringify(anchor)} to ` +
            `entry [${first}] and again to entry [${index}] — one spelling belongs to one entry, or ` +
            `a reader cannot tell which entry a match is evidence of`,
        );
      }
      owner.set(anchor, index);
      items.push(anchor);
    }
  });
  return items;
}

/**
 * A rule's EFFECTIVE vocabulary: the lists it declares itself, plus the shared lists it imports,
 * under the names the shared file gives them.
 *
 * COLLISION IS A HARD ERROR, IN BOTH DIRECTIONS, AND THERE IS NO PRECEDENCE. If a rule declares
 * `payment_vendors` in its own `detector.vocabulary` AND imports a shared list of that name, the
 * build stops and names both sides.
 *
 * The alternative was a precedence rule, and every version of one is worse:
 *
 * - LOCAL WINS makes a correction to the shared file invisible to the rule that most needed it. The
 *   shared list would be edited, every other rule would move, and this one would not — while its
 *   `shared_vocabulary` line went on saying that it had.
 * - SHARED WINS silently discards a rule author's own list. The words are still written in the
 *   rule, a reader still reads them as what the rule looks for, and they are not.
 * - MERGING THE TWO produces a list that exists nowhere on disk, so no file answers "what does this
 *   rule look for?".
 *
 * All three are the same shape: a mechanism that looks like it worked. The error costs one rename
 * and names both files; silence costs a miss nobody counts.
 *
 * `where` names the rule, so an author is told which rule to change, not just which list.
 */
export function mergeSharedVocabulary(
  own: Vocabulary | undefined,
  imports: string[] | undefined,
  shared: SharedVocabulary,
  where: string,
): Vocabulary | undefined {
  if (!imports || imports.length === 0) return own;
  // `Object.assign` onto a null-prototype object rather than `{ ...(own ?? {}) }`: see `ownList`
  // above. A spread produces a plain object, and `merged["__proto__"] = items` on one of those
  // creates no own property, so the list would survive in memory, expand into every pattern that
  // splices it, and vanish from the bundle at `JSON.stringify`.
  const merged: Vocabulary = Object.assign(emptyVocabulary(), own ?? {});
  const seen = new Set<string>();
  for (const name of imports) {
    if (seen.has(name)) {
      throw new Error(`${where}: ${SHARED_VOCABULARY_FIELD} names "${name}" twice`);
    }
    seen.add(name);
    if (own && Object.prototype.hasOwnProperty.call(own, name)) {
      throw new Error(
        `${where}: "${name}" is declared in this rule's detector.vocabulary AND imported through ` +
          `${SHARED_VOCABULARY_FIELD} — there is no precedence between them, deliberately, because ` +
          `either precedence leaves one of the two lists written down and not read. Rename the ` +
          `rule's own list, or delete it and keep the import`,
      );
    }
    const list = Object.prototype.hasOwnProperty.call(shared, name) ? shared[name] : undefined;
    if (!list) {
      const available = Object.keys(shared).sort();
      throw new Error(
        `${where}: ${SHARED_VOCABULARY_FIELD} names "${name}", which no file in the shared ` +
          `vocabulary directory declares (declared: ${available.length > 0 ? available.join(", ") : "none"})`,
      );
    }
    merged[name] = sharedListItems(name, list, where);
  }
  return merged;
}

/**
 * The `detector` field a rule's per-list matching is carried in. Written once; imported wherever read.
 */
export const VOCABULARY_MATCHING_FIELD = "vocabulary_matching";

/**
 * A rule's EFFECTIVE per-list matching: what it declares for its own lists, plus what each shared
 * list declares about ITSELF.
 *
 * WHY A SHARED LIST CARRIES ITS OWN MATCHING. "Vendor names are typed in whatever case and with
 * whatever separator the ecosystem wants" is a fact about the LIST, not about any rule that imports
 * it. Written in the importing rules instead, it would be re-typed once per importer and would drift
 * the first time one of them was edited — a forbidden second copy, re-created one file
 * further out. Declared on the list, one edit reaches every importer and no importer can disagree.
 *
 * COLLISION IS A HARD ERROR, for the same reason and in the same direction as `mergeSharedVocabulary`
 * above: a rule that flags an IMPORTED list in its own `vocabulary_matching` is stating a second
 * opinion about a fact the shared file owns, and either precedence leaves one of the two written
 * down and not read.
 *
 * The result is merged into the bundle by `tools/build-bundle.mjs` exactly as the anchors are, so a
 * shipped bundle carries the flags and never needs `rules/vocabulary/`.
 */
export function mergeVocabularyMatching(
  own: VocabularyMatching | undefined,
  imports: string[] | undefined,
  shared: SharedVocabulary,
  where: string,
): VocabularyMatching | undefined {
  const merged: VocabularyMatching = Object.assign(
    Object.create(null) as VocabularyMatching,
    own ?? {},
  );
  for (const name of imports ?? []) {
    const list = Object.prototype.hasOwnProperty.call(shared, name) ? shared[name] : undefined;
    const declared = (list as { matching?: ListMatching } | undefined)?.matching;
    if (!declared) continue;
    if (own && Object.prototype.hasOwnProperty.call(own, name)) {
      throw new Error(
        `${where}: "${name}" is flagged in this rule's detector.${VOCABULARY_MATCHING_FIELD} AND carries ` +
          `its own matching in the shared vocabulary file — there is no precedence between them, ` +
          `deliberately. How a list's own spellings are matched belongs to the list; delete the rule's entry`,
      );
    }
    merged[name] = declared;
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * The `detector` field a rule's per-list kinds are carried in. Written once; imported wherever read.
 */
export const VOCABULARY_KINDS_FIELD = "vocabulary_kinds";

/**
 * WHAT each shared list's items are, keyed by the list name — the `kind` the shared file declares.
 *
 * WHY THIS TRAVELS IN THE BUNDLE, and the argument is `mergeVocabularyMatching`'s above, unchanged
 * except for the field it is about. "These anchors are spellings a vendor OWNS" is a fact about the
 * LIST, declared once in `rules/vocabulary/` beside the anchors, and it is the difference between
 * `payment_recipients` (Stripe, Paddle, Adyen — names of companies) and `outbound_webhook_target`
 * (`webhook_url`, `callbackUrl` — names of constructs). Both are lists of literal text spliced into
 * a pattern, and after `mergeSharedVocabulary` flattens them into `detector.vocabulary` **nothing in
 * the bundle can tell them apart**.
 *
 * A consumer that needs the distinction therefore has exactly two options: carry it, or keep a list
 * of which names are vendor lists. The second is the copy the project's rules forbid by name — it agrees on
 * the day it is written and goes stale the first time a new recipient list is authored, silently,
 * in the direction of reading less. So it is carried, by the same pass and in the same shape as the
 * matching flags, and the engine still needs no access to `rules/vocabulary/`.
 *
 * NO `own` PARAMETER AND NO COLLISION CHECK, unlike the matching merge. A rule cannot declare a kind
 * for one of its own lists: `kind` is a field of a shared vocabulary file, `vocabulary.schema.json`
 * requires it there, and a rule-local list is a list of whatever its rule says it is. There is
 * nothing for a rule's declaration to collide with, so there is no precedence question to answer.
 *
 * A LIST WHOSE FILE DECLARES NO KIND CONTRIBUTES NOTHING, and the field stays absent — the state
 * every rule shipped in before this existed.
 */
export function mergeVocabularyKinds(
  imports: string[] | undefined,
  shared: SharedVocabulary,
): Record<string, string> | undefined {
  const merged: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const name of imports ?? []) {
    const list = Object.prototype.hasOwnProperty.call(shared, name) ? shared[name] : undefined;
    const kind = list?.kind;
    if (typeof kind !== "string" || kind.length === 0) continue;
    merged[name] = kind;
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * The `kind` a recipient list declares — the one value that says a list's anchors are vendor
 * spellings rather than construct spellings.
 *
 * Exported so that the scanner and `rules/vocabulary/*.yaml` agree by import rather than by two
 * places writing the same word. `vocabulary.schema.json` is where the set of legal kinds is stated.
 */
export const RECIPIENT_LIST_KIND = "recipient";

/**
 * The `detector` field the owner of each shared anchor is carried in. Written once; imported wherever read.
 */
export const VOCABULARY_OWNERS_FIELD = "vocabulary_owners";

/** " <em dash> ": what a recipient entry's `vendor` writes between the name and the legal entity. */
const NAME_ENTITY_SEPARATOR = ` ${String.fromCharCode(0x2014)} `;

/**
 * The name an entry of a shared list goes by: a recipient entry's `vendor` up to its first space, em dash, space (the
 * files write "Mixpanel <em dash> Mixpanel, Inc.": the name, then the legal entity), the whole `vendor` where it has
 * none, or a term entry's `term`. Undefined for an entry that carries neither.
 */
export function entryName(entry: SharedEntry): string | undefined {
  const vendor = typeof entry.vendor === "string" ? entry.vendor.trim() : "";
  if (vendor.length > 0) {
    const cut = vendor.indexOf(NAME_ENTITY_SEPARATOR);
    return cut > 0 ? vendor.slice(0, cut).trim() : vendor;
  }
  const term = typeof entry.term === "string" ? entry.term.trim() : "";
  return term.length > 0 ? term : undefined;
}

/**
 * WHO each shared anchor is a spelling of, by list and anchor: `{ analytics_recipients: { "mixpanel-browser": "Mixpanel",
 * ... } }`. Fix C2-2: a token item is the matched word as the census holds it (`mixpanelbrowser`, or several
 * spans of one line joined by "+"), which no person reads as a name, and two spellings of one vendor on one line are
 * one recipient. The entry a spelling belongs to says both, and the shared file already states it beside the anchors;
 * `mergeSharedVocabulary` flattens it away, so the build carries it here the way it carries `kind` and `matching`, and
 * the report names a candidate's token items from it (`item-label.ts`; the scanner does not read it).
 *
 * Only the NAME travels, never what the entry says the vendor receives or where it is established: the bundle
 * carries no per-vendor entries (build-bundle.mjs refuses prose that promises them).
 */
export function mergeVocabularyOwners(
  imports: string[] | undefined,
  shared: SharedVocabulary,
): Record<string, Record<string, string>> | undefined {
  const merged: Record<string, Record<string, string>> = Object.create(null) as Record<string, Record<string, string>>;
  for (const name of imports ?? []) {
    const list = Object.prototype.hasOwnProperty.call(shared, name) ? shared[name] : undefined;
    if (!list || !Array.isArray(list.entries)) continue;
    const owners: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const entry of list.entries) {
      const owner = entry ? entryName(entry) : undefined;
      if (!owner || !Array.isArray(entry.anchors)) continue;
      for (const anchor of entry.anchors) if (typeof anchor === "string" && anchor.length > 0) owners[anchor] = owner;
    }
    if (Object.keys(owners).length > 0) merged[name] = owners;
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * The legal entity a recipient entry names, by its NAME ALONE: the entry's `legal_name`, or undefined where it carries
 * none. NOT the
 * `vendor` text after its name: those are the research's words for the entity, and on some entries they carry a street
 * address ("InnoCraft Limited, 7 Waterloo Quay, ..."), a note or several entities, and no cutting rule holds for every
 * entry. The generators write `legal_name` from tools/shared-vocabulary.mjs `LEGAL_NAMES`, which refuses a name not cut
 * verbatim from the entry's own words or holding a standalone number.
 */
export function entryEntity(entry: SharedEntry): string | undefined {
  const name = typeof entry.legal_name === "string" ? entry.legal_name.replace(/\s+/g, " ").trim() : "";
  return name.length > 0 ? name : undefined;
}

/**
 * THE LEGAL ENTITY of each recipient entry the rule's shared lists hold, by the entry's name (`entryName`): `{ "Matomo
 * Analytics (formerly Piwik)": "InnoCraft Limited, ..." }`. The self-name question names
 * each vendor it offers by its name and its legal entity (the owner's wording of 2026-11-07, self-name-proposal section
 * 3), and the bundle carried the name only. The entity is the entry's own words after its name; what the vendor
 * receives and where it is established still never travel.
 */
export function mergeVocabularyEntities(imports: string[] | undefined, shared: SharedVocabulary): Record<string, string> | undefined {
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const name of imports ?? []) {
    const list = Object.prototype.hasOwnProperty.call(shared, name) ? shared[name] : undefined;
    if (!list || !Array.isArray(list.entries)) continue;
    for (const entry of list.entries) {
      const owner = entry ? entryName(entry) : undefined;
      const entity = entry ? entryEntity(entry) : undefined;
      if (owner && entity && !(owner in out)) out[owner] = entity;
    }
  }
  return Object.keys(out).length > 0 ? { ...out } : undefined;
}

/**
 * Refuse a rule whose `shared_vocabulary` was never resolved.
 *
 * Called by the engine on every rule it compiles. Imports are resolved at BUILD time and a bundle
 * therefore carries none; a rule reaching the engine with the field still on it came from a bundle
 * that some other path produced, and its imported lists are simply absent. Left alone, the splices
 * naming them would throw out of `expandPattern` with a message about `detector.vocabulary` — true,
 * and pointing the reader at the wrong file. Worse, a rule that imports a list only for a
 * structural check and splices nothing would not throw at all: it would scan, find nothing where
 * the shared words were, and report the silence as a result.
 */
export function assertSharedVocabularyResolved(detector: Record<string, unknown>, where: string): void {
  const declared = detector?.[SHARED_VOCABULARY_FIELD];
  if (Array.isArray(declared) && declared.length > 0) {
    throw new Error(
      `${where}: detector.${SHARED_VOCABULARY_FIELD} is still present (${declared.join(", ")}), so this ` +
        `rule's shared word lists were never merged into detector.vocabulary. Bundles are built by ` +
        `tools/build-bundle.mjs, which resolves them; a bundle that still carries imports was not ` +
        `built by it, and scanning with it would look for the shared words nowhere`,
    );
  }
}

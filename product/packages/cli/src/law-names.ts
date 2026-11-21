/**
 * A LAW IN FULL AT THE PROGRAM'S FIRST MENTION ON EVERY
 * PAGE, SHORT AFTER. The names come from one source, the bundle (penalty-tier.ts `lawFullNamesOf`: a checklist's `law`,
 * else the penalty table's `full_name`), keyed by the short name the penalty table uses; the record reads the copy the
 * assembly wrote into the log (`summary.law_names`). The rule is the program's own words only: the program supplies a
 * name where it composes a sentence (`lawMark`), and its page resolves the marks (`lawMarksResolved`). Before, a pass
 * read every page's prose and renamed the first short form it met, whoever wrote it: the review's "DSA key" became the
 * Digital Services Act, a folder `src/GDPR/` a path that does not exist, a project `PSD2-Gateway` a law.
 */

/** Each law's full name by the short name the penalty table uses. */
export type LawNames = Readonly<Record<string, string>>;

/** A bill named by its letters and number ("California S.B. 243"): its full name already says the number. */
const BILL = /\b[SA]\.B\. \d+$/;
/** An act named by its number ("Directive 2011/93/EU"): the number is its official name, not an abbreviation, and is left as written. */
const BY_NUMBER = /^(?:Regulation|Directive)\b.*\d/;
/** A law named by its number or a bill named by its letters: named in full wherever the program names it. */
export const lawNumbered = (short: string): boolean => BY_NUMBER.test(short) || BILL.test(short);
/** A short name without the place it is of ("APPI (Japan)" is "APPI"). */
const coreOf = (short: string): string => (BY_NUMBER.test(short) ? short : short.replace(/ \([^()]*\)$/, ""));
const placeOf = (short: string): string | null => (BY_NUMBER.test(short) ? null : (/^.+ \((.+)\)$/.exec(short)?.[1] ?? null));

/** What stands in brackets after the full name at a first mention, or null where the full name is the whole of it. */
function bracketOf(short: string, full: string): string | null {
  const core = coreOf(short);
  if (BILL.test(short) || BY_NUMBER.test(short) || full.includes(core)) return null;
  const place = placeOf(short);
  if (place !== null) return full.includes(place) ? core : `${core}, ${place}`;
  return short;
}

/** A law's name at its first mention on a page: in full, with its short form in brackets where that is not inside it. */
export function lawFirstName(short: string, names: LawNames = {}): string {
  const full = names[short];
  if (!full) return short;
  const b = bracketOf(short, full);
  return b === null ? full : `${full} (${b})`;
}

/** The name the program writes for a law: its short form; a law named by its number, or a bill, in full. */
export const lawLaterName = (short: string, names: LawNames = {}): string => (lawNumbered(short) ? (names[short] ?? short) : short);

/*
 * NAMES SUPPLIED BY THE PROGRAM,
 * BY LAW ID. A sentence the program composes names a law by `lawMark` (its id: the penalty table's short name), never by
 * writing either name itself. The page, as it will be read, resolves its marks in reading order (`lawMarksResolved`, one
 * tracker per page): the first mark of each law in full with its short form, every later one in its short form. Nothing
 * else on the page is read: words the program did not write (the review's, the person's, a path, a project's name, the
 * bundle's titles and citations) are never renamed, so a short form used in another sense ("a 1024-bit DSA key", "the CRA
 * (Experian)") stays as written. A mark is made of control characters a value can never hold (`markdownText` and
 * `valueText` escape them), so nothing a value holds can be read as one.
 */
const MARK_OPEN = "\u0001\u0002";
const MARK_CLOSE = "\u0003";
const MARK = /\u0001\u0002([^\u0001-\u0003]*)\u0003/g;

/** A law the program names, by its id, as a mark its page resolves. */
export const lawMark = (short: string): string => `${MARK_OPEN}${short}${MARK_CLOSE}`;

/** Whether a text holds a mark. */
export const lawMarked = (text: string): boolean => text.includes(MARK_OPEN);

/** A text's marks in their later form (the short name): for what is not a page, such as the log, a comparison or a key. */
export const lawMarksShort = (text: string, names: LawNames = {}): string => (lawMarked(text) ? text.replace(MARK, (_w, short: string) => lawLaterName(short, names)) : text);

/** A text split into its own words and the laws it names, in order (the record's form of a sentence the log keeps). */
export function lawMarkParts(text: string): (string | { law: string })[] {
  const out: (string | { law: string })[] = [];
  let at = 0;
  for (const hit of text.matchAll(MARK)) {
    if ((hit.index ?? 0) > at) out.push(text.slice(at, hit.index));
    out.push({ law: hit[1] ?? "" });
    at = (hit.index ?? 0) + hit[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/**
 * The marks of one page resolved in reading order (the page's one tracker): each law's first mark in full with its short
 * form (`lawFirstName`), every later one in its short form (`lawLaterName`); `escape` writes a name as the page writes
 * text (Markdown's escapes; none for the record's blocks). Text without a mark is returned as it is.
 */
export function lawMarksResolved(texts: readonly string[], names: LawNames, escape: (s: string) => string = (s) => s): string[] {
  const seen = new Set<string>();
  return texts.map((t) => (lawMarked(t) ? t.replace(MARK, (_w, short: string) => escape(seen.has(short) ? lawLaterName(short, names) : (seen.add(short), lawFirstName(short, names)))) : t));
}

/** Each table of names as one expression over the program's own fixed texts (`lawsMarkedIn`), longest name first. */
const OWN = new WeakMap<LawNames, { re: RegExp; keys: string[] }>();
/**
 * A text the program itself carries (its question table, scan-profile.schema.json's `x-question`: a header such as "CRA
 * product", a question naming "GDPR Article 9(2)", what an answer settles) with each law it names, by its short form or
 * its full name, given by its id (`lawMark`), so its page names the law as it names every law the program writes. Only
 * the program's own fixed texts are read so, never a value: the review's, the person's, a path, a project's name or the
 * bundle's titles and citations are never passed here.
 */
export function lawsMarkedIn(text: string, names: LawNames): string {
  let own = OWN.get(names);
  if (!own) {
    const alts: { key: string; source: string }[] = [];
    for (const [short, full] of Object.entries(names)) {
      if (!full || BY_NUMBER.test(short)) continue;
      for (const form of [full, coreOf(short)]) alts.push({ key: short, source: form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") });
    }
    alts.sort((x, y) => y.source.length - x.source.length);
    own = { re: new RegExp(alts.map((a) => `(?<![\\p{L}\\p{N}_])(${a.source})(?![\\p{L}\\p{N}_])`).join("|") || "(?!)", "gu"), keys: alts.map((a) => a.key) };
    OWN.set(names, own);
  }
  const { re, keys } = own;
  return text.replace(re, (whole: string, ...groups: unknown[]) => {
    const i = groups.findIndex((g, j) => j < keys.length && typeof g === "string");
    return i < 0 ? whole : lawMark(keys[i] ?? whole);
  });
}

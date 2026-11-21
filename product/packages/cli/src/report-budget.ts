/**
 * ONE SOURCE FOR WHAT THE AI
 * WRITES AND WHERE THE REPORT PRINTS IT. Before, the capture's word limits for the review's headline (`effect`, 20 words)
 * and its suggested change (`fix`, 40 words) and the layout's row budgets (a finding's card 16 rows, a group's 13, the
 * first screen 45) were two copies of one fact that disagreed: a card at the capture's limits ran to 19 rows, and the
 * card gave up the reason, the provision's region words and the rule's own line for the suggestion (the non-author
 * re-check, and the first check before it). Here the budgets are set once, the AI's limits are derived from them, and
 * the capture (standing.ts) and the report (assemble-report.ts) both test a text with the same functions: a headline or a
 * suggestion the capture keeps fits its own rows (`HEADLINE_ROWS`, `SUGGESTION_ROWS`), and one it would not keep is not
 * printed in its place. A card as a whole is not held to its rows by construction: the reason is printed whole, so a
 * long reason makes a card longer (17 Nov, the third non-author re-check, d5).
 *
 * The rows, as the raw-view gate counts them (75 columns, report-form.ts `rowsAt`):
 * - a finding's card (16; a group's 13) is a target. What a person must see never gives way on it (the parent's decision
 *   for 17 Nov): the headline as its title (2 rows), the status line (2), the place (4 with a path of 80
 *   characters, 2 with one of 60 or fewer), the reason, whole (as many rows as it takes), and what to do: the review's
 *   suggestion with its label (2) and the rule's own line (2) or a pointer to it. Only these give way, in this order
 *   (assemble-report.ts `cardLines`): the blank row under the title, the place's link for a numbered reference, what to
 *   say (1), the provision line's region words, its second row; then the rule's line for its pointer. A card runs over
 *   its rows only with all of them gone, and the raw-view gate holds that.
 * - a front-page entry: the headline (3, its lead being longer than the card's), the level and the check's title (1),
 *   the code line and its text (2), the suggestion (2) and the rule's line (2); in its compact form the headline, the
 *   level with the code line, its text, and the suggestion with a sentence saying where the rule's line is (2-3): seven
 *   rows at most, two of which fit the first screen beside its other parts (assemble-report.ts `firstScreenLines`).
 * - the laws line on the first screen: at most `LAWS_LINE_ROWS` rows as printed, its laws named in full at their first
 *   mention (the parent's decision on law names).
 * Why the words are counted as well: the instructions ask the review for words, which it can count; the rows are the
 * program's own test of the same text, which no instruction can ask for, and decide where words of unusual length meet.
 */
import { markdownTextOf as markdownText, REPORT_WIDTH, rowsAt, wrapProse } from "./report-form.js";

/** A finding's card at most (design 6; 16 by the parent's decision of 2026-11-16, r19-f-2026-11-16.md P1). */
export const CARD_ROWS = 16;
/** A group's card before its "Places" (design 6). */
export const GROUP_CARD_ROWS = 13;
/** The first screen of report.md: every row above "To fix by area" (r19-brief.md: one screen). */
export const FIRST_SCREEN_ROWS = 45;
/**
 * The laws line's rows as printed on the first screen (17 Nov,
 * the third non-author re-check's d1: it was bounded by a count with each law by its short name, and printed more). 8 is the
 * longest of the nine answered shapes test-report-front-page builds with the real penalty table, after the counted
 * sentences stopped repeating "that the findings cite": 5-6 rows in seven of them, 8 where one region was answered Yes,
 * another No and the third not at all; the first screen keeps two Fix first entries in all nine.
 */
export const LAWS_LINE_ROWS = 8;
/** The rows the review's headline may take as a finding's card title. */
export const HEADLINE_ROWS = 2;
/** The rows the review's headline may take in a front-page entry's first line (its longest lead on the first screen). */
export const ENTRY_HEADLINE_ROWS = 3;
/** The rows the review's suggestion may take with its label, on the card and in a front-page entry. */
export const SUGGESTION_ROWS = 2;
/**
 * The label printed before the review's suggestion (P3: it says plainly that the suggestion is the AI review's and is to
 * be checked before it is applied). "for this code" was dropped: the suggestion stands under the finding's own code line.
 */
export const SUGGESTION_LABEL = "What to do (the AI review's suggestion; check it before applying):";
/** The headline's words: a sentence of this many words of ordinary length fits both (test-report-front-page). */
export const EFFECT_MAX_WORDS = 18;
/**
 * The suggestion's words, two numbers on purpose (the parent's decision of 17 Nov,). `FIX_ASK_WORDS` is what the instructions ask the review for; `FIX_MAX_WORDS` is
 * what the capture and the report keep. The two rows with the label hold about 78 characters of suggestion: 12 words of
 * ordinary length fit them in 73% of samples drawn from the bundle's own advice lines (498 of 679 sliding windows), 10
 * words in 98% (the second non-author re-check); and the one paid run (16 Nov) shows the review overshooting a
 * word bound by one word (4 of its 11 single to-fix headlines had 21 words against 20). So the review is asked for 10
 * and the capture keeps up to 12: the margin absorbs the overshoot, and the rows (`suggestionRows`) still decide where
 * words of unusual length meet. A suggestion set aside is said on the finding's page, never silently (assemble-report.ts).
 */
export const FIX_ASK_WORDS = 10;
/** The suggestion's words the capture and the report keep: the margin above `FIX_ASK_WORDS`; the rows decide beyond. */
export const FIX_MAX_WORDS = 12;
/** The card title's lead, for a finding number of two digits. */
export const CARD_HEADLINE_LEAD = "# F99 · ";
/** The longest lead a headline has on the first screen: a finding number of two digits, a group's member "(99 of 99)". */
export const HEADLINE_LEAD = "**[F99](findings/abcdef.md) (99 of 99) · ";

const sentence = (t: string): string => (/[.!?]["')\]]?$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);
const rowsOf = (text: string): number => wrapProse(text, { width: REPORT_WIDTH, first: "- ", indent: "  " }).reduce((n, l) => n + rowsAt(l, REPORT_WIDTH), 0);
/** Words, as the capture counts them. */
export const wordsOf = (t: string): number => t.trim().split(/\s+/).filter(Boolean).length;
const headlineText = (effect: string): string => {
  const t = effect.replace(/\s+/g, " ").trim();
  return markdownText(sentence(`${t.charAt(0).toUpperCase()}${t.slice(1)}`));
};
/** The rows a headline takes as a card's title, as the report prints it (escaped, with its full stop). */
export const headlineRows = (effect: string): number => rowsAt(`${CARD_HEADLINE_LEAD}${headlineText(effect)}`, REPORT_WIDTH);
/** The rows a headline takes in a front-page entry's first line, as the report prints it. */
export const entryHeadlineRows = (effect: string): number => rowsOf(`${HEADLINE_LEAD}${headlineText(effect)}**\\`);
/** The rows a suggestion takes with its label, on the card and in a front-page entry, as the report prints it. */
export function suggestionRows(fix: string): number {
  return rowsOf(`${SUGGESTION_LABEL} ${markdownText(sentence(fix.replace(/\s+/g, " ").trim()))}`);
}
/** Why a headline does not fit its budget, in the capture's words (S5); null where it fits. */
export function headlineRowsProblem(effect: string): string | null {
  const rows = headlineRows(effect);
  if (rows > HEADLINE_ROWS) return `\`effect\` takes ${rows} rows of the finding's card title; at most ${HEADLINE_ROWS} (S5)`;
  const entry = entryHeadlineRows(effect);
  return entry > ENTRY_HEADLINE_ROWS ? `\`effect\` takes ${entry} rows of a finding's entry on the report's front page; at most ${ENTRY_HEADLINE_ROWS} (S5)` : null;
}
/** Why a suggestion does not fit its budget, in the capture's words (S5); null where it fits. */
export function suggestionRowsProblem(fix: string): string | null {
  const rows = suggestionRows(fix);
  return rows > SUGGESTION_ROWS ? `\`fix\` takes ${rows} rows of the finding's card with its label; at most ${SUGGESTION_ROWS} (S5)` : null;
}
/** A headline the report prints as one: within its words and its rows. */
export const headlineFits = (effect: string): boolean => effect.trim() !== "" && wordsOf(effect) <= EFFECT_MAX_WORDS && headlineRowsProblem(effect) === null;
/** A suggestion the report prints: within its words and its rows (a record kept by an earlier version may hold a longer one). */
export const suggestionFits = (fix: string): boolean => fix.trim() !== "" && wordsOf(fix) <= FIX_MAX_WORDS && suggestionRows(fix) <= SUGGESTION_ROWS;

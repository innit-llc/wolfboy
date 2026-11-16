/**
 * Which language a path is read as, and which grammars that language needs.
 *
 * `languageFor` is A PURE FUNCTION OF ONE PATH, deliberately. It takes no project, no profile, no
 * corpus and no file list, so there is nowhere to hang a "what is this repository mostly written in"
 * heuristic — the pre-classification pass the integration design rejects (§9b). Structural reading
 * runs on EVERY file the walker hands the engine; a `.jsx` file in an otherwise-PHP repository is
 * parsed like any other, because maintaining a list of which files get parsed is itself a defect
 * surface.
 *
 * A file with no adapter is reported as `no-adapter` and counted, never as "clean": "the structural
 * side found nothing here" and "the structural side cannot read this" are different answers and must
 * never be added together.
 */

/** A language an adapter exists for. */
export type StructuralLanguage =
  | "html"
  | "tsx"
  | "ts"
  | "haml"
  | "slim"
  | "pug"
  | "erb"
  | "blade"
  | "mustache"
  | "markdown"
  | "heex"
  | "elixir";

/**
 * A tree-sitter grammar, by the key the third-party inventory gives it.
 *
 * THE FILENAMES ARE NOT WRITTEN HERE. `product/packages/cli/grammars/third-party.json` is the single
 * authority for what is vendored, what each artefact is called, where it came from and under what
 * licence; the loader reads the language key out of it rather than keeping a second list beside it
 * (`grammars.ts`). These keys therefore have to be exactly the inventory's `language` values, and a
 * key with no entry there is reported as an unavailable grammar rather than guessed at.
 */
export type GrammarName = "html" | "tsx" | "ts" | "erb" | "haml" | "slim" | "pug" | "blade" | "heex" | "elixir";

export const GRAMMAR_NAMES: GrammarName[] = [
  "html",
  "tsx",
  "ts",
  "erb",
  "haml",
  "slim",
  "pug",
  "blade",
  "heex",
  "elixir",
];

/**
 * The grammars a language needs, in the order they are used. ERB and Blade need two: a grammar that
 * locates the non-HTML regions, and the host HTML grammar that reads what is left. That is the
 * injection arrangement editors use, and it is the only way either language can be read
 * structurally, because neither grammar models HTML itself.
 *
 * HEEX IS THE OPPOSITE CASE AND NEEDS ONE. `tree-sitter-heex` models the document — tags, components,
 * slots, attributes and text are its own node types — so `langs/heex.ts` converts its tree directly
 * and no HTML grammar is involved.
 *
 * `elixir` NEEDS TWO, AND IT IS THE ERB ARRANGEMENT RATHER THAN THE HEEX ONE. What a `.ex` file
 * contributes is the HEEx templates written inside it as `~H` sigils, so the Elixir grammar locates
 * the regions — `sigil` nodes whose `sigil_name` is `H`, taking the `quoted_content` range — and the
 * HEEx grammar reads what is inside them. Until 2026-08-28 the second grammar was the only one:
 * `tree-sitter-elixir` is Apache-2.0, which a check reserved to the owner, so
 * the regions were found by reading the text (`masked.ts`, `maskOutsideHeexSigils`). APACHE-2.0
 * WAS PERMITTED FOR VENDORED GRAMMARS ON 2026-08-28 and the grammar is now vendored, so the
 * boundaries come from a parse. The lexical scanner stays where it is, documented, for the reason
 * given in its own header.
 */
export const GRAMMARS_FOR: Record<StructuralLanguage, GrammarName[]> = {
  html: ["html"],
  tsx: ["tsx"],
  ts: ["ts"],
  haml: ["haml"],
  slim: ["slim"],
  pug: ["pug"],
  erb: ["erb", "html"],
  blade: ["blade", "html"],
  mustache: ["html"],
  markdown: ["html"],
  heex: ["heex"],
  elixir: ["elixir", "heex"],
};

/**
 * Extension to language. `.html.erb`, `.html.haml`, `.html.slim` and `.html.heex` all end in the
 * inner extension, which is what this table reads; `.blade.php` is tested first because it also ends
 * in `.php`.
 */
const BY_EXT: [RegExp, StructuralLanguage][] = [
  [/\.blade\.php$/i, "blade"],
  [/\.(html?|vue|svelte|htm)$/i, "html"],
  [/\.(erb|rhtml)$/i, "erb"],
  [/\.haml$/i, "haml"],
  [/\.slim$/i, "slim"],
  [/\.(pug|jade)$/i, "pug"],
  [/\.(mustache|hbs|handlebars|liquid|twig|njk|ejs)$/i, "mustache"],
  [/\.(mdx?|markdown)$/i, "markdown"],
  [/\.heex$/i, "heex"],
  // `.eex` is plain Embedded Elixir and is NOT HEEx: it has no components, no `{…}` attribute
  // syntax and no sigil, and its `<%= … %>` / `<% … %>` spelling is the one `tree-sitter-embedded-
  // template` already reads for ERB — the same grammar, already vendored, no adapter of its own. It
  // is therefore the ERB language and deliberately not the HEEx one.
  //
  // `.eex` IS ALSO A GENERIC TEMPLATE SUFFIX — `X.eex` renders to X — so the extension alone does
  // not say the file is markup. Measured over the 98-tree corpus on 2026-08-28: 50 `.eex` files, all
  // in an Elixir analytics application, of which 45 are `*.sql.eex`, one `*.mjml.eex`, one `*.html.eex`, and one each of
  // `.sh`, `.bat` and `.args`. The 48 non-markup ones are read here anyway, and the reason is that
  // reading them costs nothing measurable: all 50 parse, and the 48 produce ZERO elements — SQL and
  // shell reach the HTML grammar as text, so no element is invented from them (PART 8 of
  // a check pins both halves). Restricting the row to `*.html.eex` would
  // subtract the 91 elements of `stats_report.mjml.eex`, and subtraction is the only operation that
  // can create a miss. `strip-comments.ts` resolves the same suffix the other way and states why:
  // there the inner extension decides what a COMMENT is, and guessing wrong changes what is
  // stripped; here it would decide only whether a file is read at all.
  [/\.eex$/i, "erb"],
  [/\.exs?$/i, "elixir"],
  [/\.(jsx|tsx|gjs|gts)$/i, "tsx"],
  [/\.(mts|cts|ts)$/i, "ts"],
  [/\.([cm]?js)$/i, "tsx"],
];

export function languageFor(relPath: string): StructuralLanguage | null {
  const p = relPath.toLowerCase();
  for (const [re, lang] of BY_EXT) if (re.test(p)) return lang;
  return null;
}

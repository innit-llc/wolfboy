import { parse as parseYaml } from "yaml";

/**
 * THE TWO FACT KINDS THE PROGRAM TESTS ON THE LINE ITSELF.
 *
 * A place is normally handed to its seat with its window (`context.ts` `growWindow`, 40 lines each side). Two kinds of
 * place are handed as ONE FACT LINE instead - the matched line, its kind and the evidence the program checked - and
 * only where the program's own test on that line passes:
 *
 * - `documentation_text`: a line of a `.md`, `.markdown`, `.rst` or `.adoc` file that lies outside every fenced or
 *   delimited block, outside every indented block, is not an `import`/`export` line or a line carrying an HTML or JSX
 *   tag, and carries no substitution syntax. Every `.mdx` and `.txt` line is windowed (MDX imports live components;
 *   `.txt` holds mail templates and doctests).
 * - `translation_string`: an entry of a catalogue file the program PARSES WHOLE - JSON or ARB, YAML, PO/POT, Apple
 *   `.strings`, Java `.properties` - whose matched line is one key with a plain string value. JSON, YAML and
 *   `.properties` count only under a locale directory; `.po`, `.pot`, `.strings` and `.arb` are catalogue extensions.
 *   XLIFF, `.resx` and JS/TS message modules are not parsed by this program, so their lines are windowed.
 *
 * **A file extension, a directory name or a file name is never the whole test** (R2): each fact needs the line (and,
 * for a catalogue, the whole file) to pass. The kind census (`kind-key.ts`) is not consulted: it is an ordering and a
 * label, not the test. `import_specifier` is not a fact kind (R5): an import line is windowed like any other code.
 *
 * **Everything that fails a test is windowed**, which is the reading the place had before this unit; nothing here can
 * remove a place, and a doubt always resolves to the window. A fact is a statement of what the line is, never of what
 * the answer is: the seat still decides the place.
 */

export type PlaceFactKind = "translation_string" | "documentation_text";

/** The longest matched line given as a fact. A longer line is windowed rather than cut (design 1.3: up to 400). */
export const FACT_LINE_MAX_CHARS = 400;

export interface PlaceFact {
  kind: PlaceFactKind;
  /** The matched line, verbatim. */
  text: string;
  /** What the program checked, in words the seat and the person read. */
  evidence: string;
}

/** The directory names a JSON, YAML or `.properties` catalogue must sit under (design 1.3; not `messages`, `intl`). */
export const LOCALE_DIRECTORIES = ["locales", "locale", "i18n", "translations", "lang", "l10n"] as const;

const DOC_EXTENSIONS = new Set(["md", "markdown", "rst", "adoc"]);

/** Substitution syntax of templates and message formats. A line or value carrying any of it is windowed. */
const SUBSTITUTION =
  /\{\{|\{%|<%|\$\{|%\{|\$\(|\{[A-Za-z_0-9][\w.,: -]*\}|%(?:\d+\$)?[-+ #0]*\d*(?:\.\d+)?[sdifu@]|%\([\w.-]+\)[sdif]/;

/** An HTML or JSX tag, an HTML comment or a processing instruction anywhere on the line. */
const TAG = /<\/?[A-Za-z][\w:.-]*(?:\s|\/?>|$)|<!|<\?/;

/** An `import` or `export` line (MDX-style in a doc; any module syntax). */
const IMPORT_EXPORT = /^\s*(?:import|export)\b/;

function extensionOf(file: string): string {
  const base = file.slice(file.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function underLocaleDirectory(file: string): boolean {
  const parts = file.toLowerCase().split("/").slice(0, -1);
  return parts.some((p) => (LOCALE_DIRECTORIES as readonly string[]).includes(p));
}

// ------------------------------------------------------------------------------------------------
// documentation_text
// ------------------------------------------------------------------------------------------------

/**
 * Which lines of a documentation file lie OUTSIDE every block (`true` = prose position). Computed once per file, from
 * the top, so a fence opened 300 lines above a match still blocks it. Conservative in every doubt: an unclosed fence
 * blocks to the end of the file.
 */
export function prosePositions(lines: readonly string[], ext: string): boolean[] {
  const out = new Array<boolean>(lines.length).fill(false);
  let fence: { ch: string; len: number } | null = null;
  let delimiter: string | null = null;
  let htmlComment = false;
  let rawTag: string | null = null;
  let frontMatter: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && (ext === "md" || ext === "markdown") && /^(---|\+\+\+)\s*$/.test(line)) {
      frontMatter = line.trim();
      continue;
    }
    if (frontMatter !== null) {
      if (line.trim() === frontMatter || (frontMatter === "---" && line.trim() === "...")) frontMatter = null;
      continue;
    }
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1][0] === fence.ch && close[1].length >= fence.len) fence = null;
      continue;
    }
    if (delimiter !== null) {
      if (line.trim() === delimiter) delimiter = null;
      continue;
    }
    if (htmlComment) {
      if (line.includes("-->")) htmlComment = false;
      continue;
    }
    if (rawTag !== null) {
      if (new RegExp(`</${rawTag}\\s*>`, "i").test(line)) rawTag = null;
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (open) {
      fence = { ch: open[1][0], len: open[1].length };
      continue;
    }
    if (ext === "adoc" && /^(-{4,}|\.{4,}|\+{4,}|\/{4,})\s*$/.test(line)) {
      delimiter = line.trim();
      continue;
    }
    if (line.includes("<!--") && !line.slice(line.indexOf("<!--")).includes("-->")) {
      htmlComment = true;
      continue;
    }
    const raw = /^\s*<(script|style|pre|iframe|template|noscript|textarea|svg)\b/i.exec(line);
    if (raw && !new RegExp(`</${raw[1]}\\s*>`, "i").test(line)) {
      rawTag = raw[1];
      continue;
    }
    // Indented blocks: four spaces or a tab in Markdown; in AsciiDoc and reStructuredText ANY leading whitespace (an
    // indented AsciiDoc paragraph is literal; an indented rst line is a literal block, a directive's body or a quote).
    if (ext === "adoc" || ext === "rst") {
      if (/^\s/.test(line)) continue;
    } else if (/^( {4}|\t)/.test(line)) continue;
    // rst explicit markup (`.. directive::`, comments) and AsciiDoc block macros (`include::`, `image::`) are not prose.
    if (ext === "rst" && /^\.\.(\s|$)/.test(line)) continue;
    if (ext === "adoc" && /^[A-Za-z][\w-]*::/.test(line)) continue;
    out[i] = true;
  }
  return out;
}

function documentationFact(ext: string, positions: boolean[], lines: readonly string[], lineNo: number): PlaceFact | null {
  const text = lines[lineNo - 1];
  if (text === undefined || !positions[lineNo - 1]) return null;
  if (text.trim().length === 0) return null;
  if (IMPORT_EXPORT.test(text) || TAG.test(text) || SUBSTITUTION.test(text)) return null;
  return {
    kind: "documentation_text",
    text,
    evidence: `a prose line of a .${ext} file: outside every fenced, delimited and indented block, not an import, export or tag line, and no substitution syntax`,
  };
}

// ------------------------------------------------------------------------------------------------
// translation_string
// ------------------------------------------------------------------------------------------------

type Catalogue = { format: string; why: string; entry: (line: string) => { key: string; value: string } | null };

/** A value a fact may carry: a string with no substitution syntax and no markup. */
function plainValue(value: string): boolean {
  return !SUBSTITUTION.test(value) && !TAG.test(value);
}

/** Every `key -> string value` pair of a parsed document, as `key\0value`. */
function stringPairs(doc: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (typeof x === "string") out.add(`${k}\u0000${x}`);
        else walk(x);
      }
    }
  };
  walk(doc);
  return out;
}

const JSON_ENTRY = /^\s*("(?:[^"\\]|\\.)*")\s*:\s*("(?:[^"\\]|\\.)*")\s*,?\s*$/;
const YAML_ENTRY = /^\s*(?:-\s+)?("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s:#'"!&*|>{}[\],-][^:#]*?)\s*:\s+(.+?)\s*$/;
const PO_LINE = /^\s*(?:(msgctxt|msgid|msgid_plural|msgstr(?:\[\d+\])?)\s+)?("(?:[^"\\]|\\.)*")\s*$/;
const STRINGS_ENTRY = /^\s*("(?:[^"\\]|\\.)*")\s*=\s*("(?:[^"\\]|\\.)*")\s*;\s*$/;
const PROPERTIES_ENTRY = /^\s*([^#!\s=:][^=:]*?)\s*[=:]\s*(.*?)\s*$/;

function jsonCatalogue(text: string, format: string, why: string): Catalogue | null {
  let pairs: Set<string>;
  try {
    pairs = stringPairs(JSON.parse(text));
  } catch {
    return null;
  }
  return {
    format,
    why,
    entry: (line) => {
      const m = JSON_ENTRY.exec(line);
      if (!m) return null;
      const key = JSON.parse(m[1]) as string;
      const value = JSON.parse(m[2]) as string;
      return pairs.has(`${key}\u0000${value}`) ? { key, value } : null;
    },
  };
}

function yamlCatalogue(text: string, why: string): Catalogue | null {
  let pairs: Set<string>;
  try {
    pairs = stringPairs(parseYaml(text));
  } catch {
    return null;
  }
  return {
    format: "YAML",
    why,
    entry: (line) => {
      const m = YAML_ENTRY.exec(line);
      if (!m) return null;
      const rawValue = m[2];
      // A block scalar, an anchor, an alias, a tag, a flow collection or a trailing comment is not one plain value.
      if (/^[|>&*!{[]/.test(rawValue) || /\s#/.test(rawValue)) return null;
      let key: unknown;
      let value: unknown;
      try {
        key = parseYaml(m[1]);
        value = parseYaml(rawValue);
      } catch {
        return null;
      }
      if (typeof key !== "string" || typeof value !== "string") return null;
      return pairs.has(`${key}\u0000${value}`) ? { key, value } : null;
    },
  };
}

function poCatalogue(lines: readonly string[], why: string): Catalogue | null {
  // The whole file must be PO: comments, blank lines, keyword lines and string continuations, a continuation only
  // after a keyword or another continuation.
  let afterString = false;
  for (const line of lines) {
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) {
      afterString = false;
      continue;
    }
    const m = PO_LINE.exec(line);
    if (!m) return null;
    if (m[1] === undefined && !afterString) return null;
    afterString = true;
  }
  return {
    format: "PO",
    why,
    entry: (line) => {
      const m = PO_LINE.exec(line);
      if (!m) return null;
      return { key: m[1] ?? "(continuation)", value: JSON.parse(m[2]) as string };
    },
  };
}

function stringsCatalogue(lines: readonly string[], why: string): Catalogue | null {
  let inComment = false;
  for (const line of lines) {
    if (inComment) {
      if (line.includes("*/")) inComment = false;
      continue;
    }
    const t = line.trim();
    if (t === "" || t.startsWith("//")) continue;
    if (t.startsWith("/*")) {
      if (!t.includes("*/")) inComment = true;
      continue;
    }
    if (!STRINGS_ENTRY.test(line)) return null;
  }
  return {
    format: "Apple .strings",
    why,
    entry: (line) => {
      const m = STRINGS_ENTRY.exec(line);
      if (!m) return null;
      try {
        return { key: JSON.parse(m[1]) as string, value: JSON.parse(m[2]) as string };
      } catch {
        return null;
      }
    },
  };
}

function propertiesCatalogue(lines: readonly string[], why: string): Catalogue | null {
  // A continued value (a line ending in a backslash) spans lines; such a file is not read line by line here.
  for (const line of lines) {
    const t = line.trim();
    if (t === "" || t.startsWith("#") || t.startsWith("!")) continue;
    if (/\\$/.test(line)) return null;
    if (!PROPERTIES_ENTRY.test(line)) return null;
  }
  return {
    format: ".properties",
    why,
    entry: (line) => {
      const t = line.trim();
      if (t.startsWith("#") || t.startsWith("!")) return null;
      const m = PROPERTIES_ENTRY.exec(line);
      return m ? { key: m[1], value: m[2] } : null;
    },
  };
}

/** The file as a catalogue the program parsed whole, or null where it is not one (its lines are then windowed). */
export function catalogueOf(file: string, lines: readonly string[]): Catalogue | null {
  const ext = extensionOf(file);
  const locale = underLocaleDirectory(file);
  const text = lines.join("\n");
  const inLocale = "under a locale directory";
  switch (ext) {
    case "arb":
      return jsonCatalogue(text, "ARB", "a catalogue extension");
    case "json":
      return locale ? jsonCatalogue(text, "JSON", inLocale) : null;
    case "yml":
    case "yaml":
      return locale ? yamlCatalogue(text, inLocale) : null;
    case "po":
    case "pot":
      return poCatalogue(lines, "a catalogue extension");
    case "strings":
      return stringsCatalogue(lines, "a catalogue extension");
    case "properties":
      return locale ? propertiesCatalogue(lines, inLocale) : null;
    default:
      return null;
  }
}

function translationFact(catalogue: Catalogue, lines: readonly string[], lineNo: number): PlaceFact | null {
  const text = lines[lineNo - 1];
  if (text === undefined) return null;
  const entry = catalogue.entry(text);
  if (!entry || !plainValue(entry.value)) return null;
  return {
    kind: "translation_string",
    text,
    evidence: `an entry of a ${catalogue.format} catalogue the program parsed whole (${catalogue.why}); the line is one key with a plain string value, no substitution syntax and no markup`,
  };
}

// ------------------------------------------------------------------------------------------------
// The one entry point
// ------------------------------------------------------------------------------------------------

/**
 * The fact test for one file, built once and asked once per place: `(startLine, endLine) => PlaceFact | null`.
 * A place gets a fact only where its match is ONE line, at most `FACT_LINE_MAX_CHARS` characters, in a file whose bytes
 * are the text (`transcoded` false), and the line passes its kind's test. Everything else returns null: windowed.
 */
export function placeFactsFor(
  file: string,
  lines: readonly string[],
  transcoded: boolean,
): (startLine: number, endLine: number) => PlaceFact | null {
  if (transcoded || lines.length === 0) return () => null;
  const ext = extensionOf(file);
  let test: ((lineNo: number) => PlaceFact | null) | null = null;
  if (DOC_EXTENSIONS.has(ext)) {
    const positions = prosePositions(lines, ext);
    test = (lineNo) => documentationFact(ext, positions, lines, lineNo);
  } else {
    const catalogue = catalogueOf(file, lines);
    if (catalogue) test = (lineNo) => translationFact(catalogue, lines, lineNo);
  }
  if (!test) return () => null;
  const asked = test;
  return (startLine, endLine) => {
    if (endLine !== startLine) return null;
    const text = lines[startLine - 1];
    if (text === undefined || text.length > FACT_LINE_MAX_CHARS) return null;
    return asked(startLine);
  };
}

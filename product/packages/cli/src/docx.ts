/**
 * A minimal, byte-deterministic OOXML word-processing document writer.
 *
 * ## Why this file exists instead of an npm package
 *
 * The product's output has to be a word-processor document, because that is what the platform this
 * output targets will accept: its Policies module takes "PDF, DOCX, ODT, XLSX, ODS, PPTX, or ODP"
 * and nothing else.
 * Of those seven, DOCX is the one that is both editable — the document ships with
 * blanks a person must fill in, so a PDF would be the wrong artefact — and the right shape for
 * prose and nested lists rather than a grid.
 *
 * A `.docx` is a ZIP of XML parts. Both halves are in Node's standard library or are twenty lines
 * of arithmetic, so the alternative to this file is a dependency, and a compliance scanner's
 * dependency list is part of what a reader has to trust. `wolfboy` depends on `commander`,
 * `web-tree-sitter`, `yaml` and the workspace schemas package; this file is here so that list does
 * not grow.
 *
 * ## Determinism, which is a requirement and not a preference
 *
 * Nothing in this pipeline reads the wall clock — `buildRopa` and the CLI's `ropa` action contain
 * no `Date.now()` and no `new Date()`, and the RoPA gate exploits that with a byte-for-byte
 * comparison against a frozen export. A `.docx` is a hostile format for that property: ZIP entries
 * carry modification timestamps and `docProps/core.xml` normally carries created/modified times.
 * Both are refused here:
 *
 * - **Every ZIP entry's timestamp is the same constant**, `DOS_TIMESTAMP` below.
 * - **`docProps/core.xml` carries no `dcterms:created` or `dcterms:modified`.** Both elements are
 *   optional in the core-properties part. Any date that appears in the document body is read out of
 *   the layer-2 input, the same place every other date in this pipeline is read from.
 * - **Entries are stored, not deflated.** Compression would still be deterministic run to run, but
 *   only for one build of zlib; storing makes the bytes a function of the content alone, so two
 *   machines produce the same file. The cost is size, and the ceiling is the platform's 25 MB
 *   upload limit — a record of a few hundred processing activities is two orders of magnitude
 *   inside it. Stored entries are ordinary ZIP entries and every conforming reader accepts them.
 */

// ------------------------------------------------------------------------------------------------
// The document model
// ------------------------------------------------------------------------------------------------

/** One run of text inside a paragraph, with the character formatting it carries. */
export interface DocxRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  /**
   * Yellow text highlight. Used by the RoPA document for one purpose only — marking a value nobody
   * has answered — so that an unanswered field cannot be mistaken for finished prose by a reader
   * skimming an uploaded document. See `ropa-docx.ts`.
   */
  highlight?: boolean;
  /** Renders in a monospaced face. Used for file paths, rule ids and quoted source lines. */
  mono?: boolean;
}

export type DocxHeadingLevel = 1 | 2 | 3 | 4;

export type DocxBlock =
  | { kind: "title"; runs: DocxRun[] }
  | { kind: "heading"; level: DocxHeadingLevel; runs: DocxRun[] }
  | {
      kind: "paragraph";
      runs: DocxRun[];
      /** Indent depth in list steps (one step = 360 twips = 0.25 inch). */
      indent?: number;
      /** Prefix the paragraph with a bullet glyph appropriate to its indent depth. */
      bullet?: boolean;
    };

// ------------------------------------------------------------------------------------------------
// XML
// ------------------------------------------------------------------------------------------------

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/**
 * Escape text for an XML text node or attribute value.
 *
 * All five predefined entities are escaped rather than the strict minimum, because the same
 * function is used for both positions and an attribute needs the quote forms. The characters this
 * runs over are layer-2 free text — vendor names, quoted source lines, an operator's own note — so
 * the input genuinely contains ampersands, angle brackets and quotes.
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * The characters XML 1.0 cannot represent at all, removed.
 *
 * A control character reaching the file would make the whole part unparseable, so the document
 * would fail to open rather than losing one character. Tab becomes a space and the line breaks are
 * handled by the caller (`runXml` splits on them and emits `<w:br/>`), so what is left here is the
 * genuinely unrepresentable set: C0 other than tab/LF/CR, plus DEL and the C1 range, which are
 * legal in XML 1.0 only as character references and carry no meaning in this document.
 */
function stripUnrepresentable(text: string): string {
  // The class is written with \u escapes on purpose: a literal control character in this source
  // file is the exact defect `npm run lint:source-text` exists to refuse.
  const unrepresentable = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
  return text.replace(/\t/g, " ").replace(unrepresentable, "");
}

function runPropsXml(run: DocxRun): string {
  const props: string[] = [];
  if (run.mono) props.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>');
  if (run.bold) props.push("<w:b/>");
  if (run.italic) props.push("<w:i/>");
  if (run.highlight) props.push('<w:highlight w:val="yellow"/>');
  return props.length > 0 ? `<w:rPr>${props.join("")}</w:rPr>` : "";
}

function runXml(run: DocxRun): string {
  const lines = stripUnrepresentable(run.text).split(/\r\n|\r|\n/);
  const body = lines
    .map((line) => `<w:t xml:space="preserve">${escapeXml(line)}</w:t>`)
    .join("<w:br/>");
  return `<w:r>${runPropsXml(run)}${body}</w:r>`;
}

/** One indent step, in twips. 360 twips = 0.25 inch, Word's own default list step. */
const INDENT_STEP = 360;

const BULLET_GLYPHS = ["•", "–", "◦"];

function paragraphXml(block: DocxBlock): string {
  if (block.kind === "title") {
    return `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${block.runs.map(runXml).join("")}</w:p>`;
  }
  if (block.kind === "heading") {
    return `<w:p><w:pPr><w:pStyle w:val="Heading${block.level}"/></w:pPr>${block.runs.map(runXml).join("")}</w:p>`;
  }
  const indent = block.indent ?? 0;
  const props: string[] = [];
  if (indent > 0) props.push(`<w:ind w:left="${indent * INDENT_STEP}" w:hanging="${block.bullet ? INDENT_STEP : 0}"/>`);
  const pPr = props.length > 0 ? `<w:pPr>${props.join("")}</w:pPr>` : "";
  // Indent 1 is the first bullet level, so the glyph index is one below the indent depth.
  const glyph = BULLET_GLYPHS[Math.min(Math.max(indent - 1, 0), BULLET_GLYPHS.length - 1)];
  const runs = block.bullet ? [{ text: `${glyph}  ` }, ...block.runs] : block.runs;
  return `<w:p>${pPr}${runs.map(runXml).join("")}</w:p>`;
}

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export function documentXml(blocks: DocxBlock[]): string {
  const body = blocks.map(paragraphXml).join("");
  const sect =
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/>' +
    "</w:sectPr>";
  return `${XML_DECL}<w:document xmlns:w="${W_NS}"><w:body>${body}${sect}</w:body></w:document>\n`;
}

function headingStyle(id: string, name: string, halfPoints: number, beforeTwips: number): string {
  return (
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/>` +
    `<w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${beforeTwips}" w:after="120"/></w:pPr>` +
    `<w:rPr><w:b/><w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/></w:rPr></w:style>`
  );
}

export function stylesXml(): string {
  return (
    `${XML_DECL}<w:styles xmlns:w="${W_NS}">` +
    "<w:docDefaults><w:rPrDefault><w:rPr>" +
    '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="21"/><w:szCs w:val="21"/>' +
    "</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>" +
    '<w:spacing w:after="120" w:line="264" w:lineRule="auto"/>' +
    "</w:pPr></w:pPrDefault></w:docDefaults>" +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/>' +
    '<w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr>' +
    '<w:rPr><w:b/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>' +
    headingStyle("Heading1", "heading 1", 32, 360) +
    headingStyle("Heading2", "heading 2", 26, 300) +
    headingStyle("Heading3", "heading 3", 23, 240) +
    headingStyle("Heading4", "heading 4", 21, 200) +
    "</w:styles>\n"
  );
}

export function corePropsXml(title: string): string {
  return (
    `${XML_DECL}<cp:coreProperties ` +
    'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    `<dc:title>${escapeXml(title)}</dc:title>` +
    // No dcterms:created and no dcterms:modified, deliberately: both elements are optional, and
    // both would have to come from the clock. See this file's header.
    "</cp:coreProperties>\n"
  );
}

const CONTENT_TYPES_XML =
  `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ' +
  'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ' +
  'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '<Override PartName="/docProps/core.xml" ' +
  'ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
  "</Types>\n";

const ROOT_RELS_XML =
  `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  '<Relationship Id="rId1" ' +
  'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
  'Target="word/document.xml"/>' +
  '<Relationship Id="rId2" ' +
  'Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" ' +
  'Target="docProps/core.xml"/>' +
  "</Relationships>\n";

const DOCUMENT_RELS_XML =
  `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  '<Relationship Id="rId1" ' +
  'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" ' +
  'Target="styles.xml"/>' +
  "</Relationships>\n";

/** The parts of the package, in the order they are written. Exported so a gate can assert the set. */
export const DOCX_PARTS = [
  "[Content_Types].xml",
  "_rels/.rels",
  "docProps/core.xml",
  "word/document.xml",
  "word/_rels/document.xml.rels",
  "word/styles.xml",
] as const;

// ------------------------------------------------------------------------------------------------
// ZIP
// ------------------------------------------------------------------------------------------------

/**
 * The single modification timestamp every entry carries: 1980-01-01 00:00:00, the earliest instant
 * the DOS date format can express. A constant rather than the clock, so that two runs over the same
 * input produce the same bytes. See this file's header.
 */
const DOS_TIMESTAMP = { time: 0x0000, date: 0x0021 } as const;

/**
 * CRC-32 (IEEE 802.3), written out rather than taken from `zlib.crc32`.
 *
 * `zlib.crc32` arrived in Node 20.15; this package declares no engine floor, and a package that
 * throws `TypeError: z.crc32 is not a function` on an older runtime would fail at the one moment
 * the user is trying to produce audit evidence. Twelve lines of arithmetic is a smaller liability
 * than that.
 */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

/**
 * Write a ZIP archive with every entry stored (compression method 0) and every timestamp fixed.
 *
 * Store-only keeps the output a pure function of the entry names and their bytes: no compression
 * level, no zlib build, nothing outside this file can move a byte of it. Conforming ZIP readers —
 * Word, LibreOffice, `unzip`, Python's `zipfile` — read stored entries as ordinary entries.
 */
export function zipStore(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed to extract: 2.0
    local.writeUInt16LE(0, 6); // general purpose bit flag: none
    local.writeUInt16LE(0, 8); // compression method: stored
    local.writeUInt16LE(DOS_TIMESTAMP.time, 10);
    local.writeUInt16LE(DOS_TIMESTAMP.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // compressed size == uncompressed size when stored
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    name.copy(local, 30);
    locals.push(local, entry.data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0); // central directory header signature
    central.writeUInt16LE(20, 4); // version made by: 2.0, MS-DOS
    central.writeUInt16LE(20, 6); // version needed to extract
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIMESTAMP.time, 12);
    central.writeUInt16LE(DOS_TIMESTAMP.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // file comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal file attributes
    central.writeUInt32LE(0, 38); // external file attributes
    central.writeUInt32LE(offset, 42); // relative offset of local header
    name.copy(central, 46);
    centrals.push(central);

    offset += local.length + size;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(0, 4); // number of this disk
  end.writeUInt16LE(0, 6); // disk where the central directory starts
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // archive comment length
  return Buffer.concat([...locals, centralDirectory, end]);
}

// ------------------------------------------------------------------------------------------------
// The package
// ------------------------------------------------------------------------------------------------

/**
 * Serialise a block list to a `.docx` package.
 *
 * `title` reaches `docProps/core.xml` only. The visible title of the document is whatever the first
 * block says it is; nothing here composes text.
 */
export function buildDocx(blocks: DocxBlock[], title: string): Buffer {
  const parts: Record<(typeof DOCX_PARTS)[number], string> = {
    "[Content_Types].xml": CONTENT_TYPES_XML,
    "_rels/.rels": ROOT_RELS_XML,
    "docProps/core.xml": corePropsXml(title),
    "word/document.xml": documentXml(blocks),
    "word/_rels/document.xml.rels": DOCUMENT_RELS_XML,
    "word/styles.xml": stylesXml(),
  };
  return zipStore(DOCX_PARTS.map((name) => ({ name, data: Buffer.from(parts[name], "utf8") })));
}

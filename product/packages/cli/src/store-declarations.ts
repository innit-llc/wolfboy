/**
 * Store declarations — the app-store half of coverage row A14.
 *
 * A privacy policy is what the developer says to users; a store declaration is what they say to
 * Apple or Google, in a structured form, under the store's own taxonomy. The reconciliation this
 * pillar performs — published statement versus code — applies to both, and until 2026-07-28 only
 * the web-document half existed. (The walker could not even open `.xcprivacy` until the same day;
 * the coverage map records that as the thing that kept row A14 Partial.)
 *
 * Everything here is deterministic parsing. Nothing concludes anything: whether a declared data
 * type matches what the census saw, whether a tracking domain is in the outbound hosts, whether an
 * omission matters — all of that is the agent's, downstream. The one rule this module enforces on
 * itself is the project's standing one: **a file that could not be parsed is reported as exactly
 * that**, never dropped, because a malformed declaration and no declaration are different facts.
 *
 * Two formats:
 *
 * - **Apple `PrivacyInfo.xcprivacy`** — an XML property list with a documented, stable shape
 *   (NSPrivacyTracking, NSPrivacyTrackingDomains, NSPrivacyCollectedDataTypes,
 *   NSPrivacyAccessedAPITypes). Parsed fully, with a small plist reader below; no dependency is
 *   worth taking for four keys.
 *
 * - **Google Play data safety CSV** — the export/import file of the Play Console form. There is no
 *   canonical in-repo copy of this format, so it is parsed **generically**: rows and cells, plus
 *   the file name that led to it. The deterministic layer does not guess at column meanings it
 *   cannot verify; the agent reads the rows. This is a decision recorded in
 *   an internal record (the input shape had to be chosen) and the choice is the honest
 *   minimum: carry the data, claim nothing about it.
 */

import type { CensusCategory } from "wolfboy-schemas";
import { shownText } from "./walk.js";

/* --------------------------------------------------------------------- *
 * A minimal XML plist reader.
 * --------------------------------------------------------------------- */

type PlistValue = string | number | boolean | PlistValue[] | { [key: string]: PlistValue };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/**
 * One pass, never two. Three chained `replace` calls decoded `&#38;lt;` — an escaped ampersand
 * followed by the literal text "lt;" — into `<`, because the numeric pass produced an `&` that the
 * named pass then consumed. A single alternation cannot do that: each match is replaced once and the
 * regex engine resumes after it. An out-of-range code point is left verbatim rather than throwing,
 * which is the difference between a manifest that reports one bad character and a manifest that
 * vanishes.
 */
function decodeEntities(s: string): string {
  return s.replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos));/g, (whole, hex, dec, named) => {
    if (named) return ENTITIES[named];
    const cp = hex ? parseInt(hex, 16) : Number(dec);
    if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return whole;
    try {
      return String.fromCodePoint(cp);
    } catch {
      return whole;
    }
  });
}

/**
 * Text content of an element, as `plistlib` would see it: comments removed, CDATA sections unwrapped
 * and *not* entity-decoded (that is what CDATA is for), everything else decoded. Whitespace is left
 * alone — a plist string is whatever is between the tags, and trimming it silently rewrote
 * declarations that begin or end with a space.
 */
function elementText(raw: string): string {
  let out = "";
  let i = 0;
  while (i < raw.length) {
    if (raw.startsWith("<!--", i)) {
      const end = raw.indexOf("-->", i);
      i = end === -1 ? raw.length : end + 3;
      continue;
    }
    if (raw.startsWith("<![CDATA[", i)) {
      const end = raw.indexOf("]]>", i);
      out += end === -1 ? raw.slice(i + 9) : raw.slice(i + 9, end);
      i = end === -1 ? raw.length : end + 3;
      continue;
    }
    // Scan forward for the next `<`, not for each marker over the whole remainder. The two
    // `indexOf` calls this replaces re-scanned to the end of the element on every chunk, so a
    // document of alternating comments and text cost O(n^2): 703 KB took 24 seconds, and the
    // walker's cap is 1 MB.
    let nextSpecial = -1;
    for (let j = raw.indexOf("<", i); j !== -1; j = raw.indexOf("<", j + 1)) {
      if (raw.startsWith("<!--", j) || raw.startsWith("<![CDATA[", j)) {
        nextSpecial = j;
        break;
      }
    }
    const chunk = nextSpecial === -1 ? raw.slice(i) : raw.slice(i, nextSpecial);
    out += decodeEntities(chunk);
    i = nextSpecial === -1 ? raw.length : nextSpecial;
  }
  return out;
}

/** One XML tag: its name, whether it closes or self-closes, and where it ends. */
function nextTag(xml: string, from: number): { name: string; closing: boolean; selfClosing: boolean; start: number; end: number } | null {
  let i = xml.indexOf("<", from);
  while (i !== -1) {
    // Skip comments, CDATA, processing instructions and the doctype — a plist starts with two of
    // them. CDATA is skipped by its own terminator, not by the next `>`: `<![CDATA[a>b]]>` contains
    // one, and treating it as a tag boundary ends the section three characters early.
    if (xml.startsWith("<!--", i)) {
      const c = xml.indexOf("-->", i);
      i = xml.indexOf("<", c === -1 ? xml.length : c + 3);
      continue;
    }
    if (xml.startsWith("<![CDATA[", i)) {
      const c = xml.indexOf("]]>", i);
      i = xml.indexOf("<", c === -1 ? xml.length : c + 3);
      continue;
    }
    if (xml[i + 1] === "?" || xml[i + 1] === "!") {
      const c = xml.indexOf(">", i);
      i = xml.indexOf("<", c === -1 ? xml.length : c + 1);
      continue;
    }
    const end = xml.indexOf(">", i);
    if (end === -1) return null;
    const raw = xml.slice(i + 1, end).trim();
    const closing = raw.startsWith("/");
    const selfClosing = raw.endsWith("/");
    const name = raw.replace(/^\//, "").replace(/\/$/, "").split(/\s/)[0];
    return { name, closing, selfClosing, start: i, end: end + 1 };
  }
  return null;
}

/**
 * Keys seen twice in one dictionary during the current parse. Module-scoped because `parseValue` is
 * recursive and its signature is part of the exported `parsePlist` contract; reset by `parsePlist`
 * before every parse and drained by the caller immediately after.
 */
let duplicateKeys: string[] = [];

/** Parse the value that starts at the tag beginning at `from`. Throws on malformed input. */
function parseValue(xml: string, from: number): { value: PlistValue; next: number } {
  const tag = nextTag(xml, from);
  if (!tag || tag.closing) throw new Error(`expected a value tag at offset ${from}`);
  const simpleText = (name: string): { value: string; next: number } => {
    const close = xml.indexOf(`</${name}>`, tag.end);
    if (close === -1) throw new Error(`<${name}> never closes`);
    return { value: elementText(xml.slice(tag.end, close)), next: close + name.length + 3 };
  };
  switch (tag.name) {
    // `<true/>` is the form every real manifest uses, but `<true></true>` is valid XML and
    // `plistlib` accepts it. Returning `tag.end` for the long form left the reader positioned on
    // `</true>`, which the enclosing dict then read as a key it did not expect — and the whole
    // manifest was discarded over a legal spelling.
    case "true":
    case "false": {
      const value = tag.name === "true";
      if (tag.selfClosing) return { value, next: tag.end };
      const close = xml.indexOf(`</${tag.name}>`, tag.end);
      if (close === -1) throw new Error(`<${tag.name}> never closes`);
      return { value, next: close + tag.name.length + 3 };
    }
    case "string":
    case "date":
    case "data": {
      if (tag.selfClosing) return { value: "", next: tag.end };
      const { value, next } = simpleText(tag.name);
      return { value, next };
    }
    case "integer":
    case "real": {
      const { value, next } = simpleText(tag.name);
      return { value: Number(value), next };
    }
    case "array": {
      if (tag.selfClosing) return { value: [], next: tag.end };
      const items: PlistValue[] = [];
      let i = tag.end;
      for (;;) {
        const t = nextTag(xml, i);
        if (!t) throw new Error("<array> never closes");
        if (t.closing && t.name === "array") return { value: items, next: t.end };
        const parsed = parseValue(xml, t.start);
        items.push(parsed.value);
        i = parsed.next;
      }
    }
    case "dict": {
      // `Object.create(null)`, not `{}`. A manifest containing `<key>__proto__</key>` writing into an
      // object literal reaches `Object.prototype`'s own slot, and a later `dict.NSPrivacyTracking`
      // lookup can then resolve to something the manifest planted rather than to something it
      // declared. No global pollution and no accidental trigger — but a parser that can be made to
      // attribute a declaration to a developer is a defect in a product whose third pillar is signed
      // evidence, and a null-prototype dictionary has no inherited slots to reach.
      if (tag.selfClosing) return { value: Object.create(null) as { [key: string]: PlistValue }, next: tag.end };
      const out = Object.create(null) as { [key: string]: PlistValue };
      let i = tag.end;
      for (;;) {
        const t = nextTag(xml, i);
        if (!t) throw new Error("<dict> never closes");
        if (t.closing && t.name === "dict") return { value: out, next: t.end };
        if (t.name !== "key") throw new Error(`expected <key> in <dict>, got <${t.name}>`);
        const close = xml.indexOf("</key>", t.end);
        if (close === -1) throw new Error("<key> never closes");
        const key = elementText(xml.slice(t.end, close));
        // A repeated key is not a merge and not a preference: `plistlib` keeps the last, and so does
        // this — but saying nothing about it let a manifest that names a collected data type in its
        // first NSPrivacyCollectedDataTypes array report `collected: []`, because a later empty
        // array overwrote it, with `problems` empty. The
        // reader cannot reach `problems` from here, so duplicates are collected and drained by the
        // caller.
        if (Object.prototype.hasOwnProperty.call(out, key)) duplicateKeys.push(key);
        const parsed = parseValue(xml, close + 6);
        out[key] = parsed.value;
        i = parsed.next;
      }
    }
    case "plist":
      return parseValue(xml, tag.end);
    default:
      throw new Error(`unsupported plist tag <${tag.name}>`);
  }
}

export function parsePlist(xml: string): PlistValue {
  duplicateKeys = [];
  return parseValue(xml, 0).value;
}

/** Duplicate keys from the most recent `parsePlist`, in the order they were seen. */
export function lastDuplicateKeys(): string[] {
  return [...duplicateKeys];
}

/* --------------------------------------------------------------------- *
 * Apple's taxonomy, the parts of it this module is confident of.
 *
 * Labels exist so a reader sees "Email address", not an identifier. **Unknown entries pass
 * through with their identifier and no label** — a taxonomy Apple extends tomorrow must not make
 * this parser wrong today, and inventing a label for an unknown type would be exactly the kind of
 * silent guess the deterministic layer is forbidden.
 * --------------------------------------------------------------------- */

const APPLE_DATA_TYPES: Record<string, string> = Object.assign(Object.create(null), {
  NSPrivacyCollectedDataTypeName: "Name",
  NSPrivacyCollectedDataTypeEmailAddress: "Email address",
  NSPrivacyCollectedDataTypePhoneNumber: "Phone number",
  NSPrivacyCollectedDataTypePhysicalAddress: "Physical address",
  NSPrivacyCollectedDataTypeOtherUserContactInfo: "Other user contact info",
  NSPrivacyCollectedDataTypeHealth: "Health",
  NSPrivacyCollectedDataTypeFitness: "Fitness",
  NSPrivacyCollectedDataTypePaymentInfo: "Payment info",
  NSPrivacyCollectedDataTypeCreditInfo: "Credit info",
  NSPrivacyCollectedDataTypeOtherFinancialInfo: "Other financial info",
  NSPrivacyCollectedDataTypePreciseLocation: "Precise location",
  NSPrivacyCollectedDataTypeCoarseLocation: "Coarse location",
  NSPrivacyCollectedDataTypeSensitiveInfo: "Sensitive info",
  NSPrivacyCollectedDataTypeContacts: "Contacts",
  NSPrivacyCollectedDataTypeEmailsOrTextMessages: "Emails or text messages",
  NSPrivacyCollectedDataTypePhotosorVideos: "Photos or videos",
  NSPrivacyCollectedDataTypeAudioData: "Audio data",
  NSPrivacyCollectedDataTypeGameplayContent: "Gameplay content",
  NSPrivacyCollectedDataTypeCustomerSupport: "Customer support",
  NSPrivacyCollectedDataTypeOtherUserContent: "Other user content",
  NSPrivacyCollectedDataTypeBrowsingHistory: "Browsing history",
  NSPrivacyCollectedDataTypeSearchHistory: "Search history",
  NSPrivacyCollectedDataTypeUserID: "User ID",
  NSPrivacyCollectedDataTypeDeviceID: "Device ID",
  NSPrivacyCollectedDataTypePurchaseHistory: "Purchase history",
  NSPrivacyCollectedDataTypeProductInteraction: "Product interaction",
  NSPrivacyCollectedDataTypeAdvertisingData: "Advertising data",
  NSPrivacyCollectedDataTypeOtherUsageData: "Other usage data",
  NSPrivacyCollectedDataTypeCrashData: "Crash data",
  NSPrivacyCollectedDataTypePerformanceData: "Performance data",
  NSPrivacyCollectedDataTypeOtherDiagnosticData: "Other diagnostic data",
  NSPrivacyCollectedDataTypeEnvironmentScanning: "Environment scanning",
  NSPrivacyCollectedDataTypeHands: "Hands",
  NSPrivacyCollectedDataTypeHead: "Head",
  NSPrivacyCollectedDataTypeOtherDataTypes: "Other data types",
});

/**
 * Apple's own wording for the six purposes, verbatim. Two were paraphrased until 2026-07-28 and both
 * paraphrases changed the declaration: "Developer's Advertising or Marketing" became "Developer's
 * advertising", dropping *marketing* from what the developer had declared, and "Product
 * Personalization" was respelled into en-GB. A label exists so a reader sees words instead of an
 * identifier; it must be the store's words, because the developer chose them.
 */
const APPLE_PURPOSES: Record<string, string> = Object.assign(Object.create(null), {
  NSPrivacyCollectedDataTypePurposeThirdPartyAdvertising: "Third-Party Advertising",
  NSPrivacyCollectedDataTypePurposeDeveloperAdvertising: "Developer's Advertising or Marketing",
  NSPrivacyCollectedDataTypePurposeAnalytics: "Analytics",
  NSPrivacyCollectedDataTypePurposeProductPersonalization: "Product Personalization",
  NSPrivacyCollectedDataTypePurposeAppFunctionality: "App Functionality",
  NSPrivacyCollectedDataTypePurposeOther: "Other Purposes",
});

/**
 * The five required-reason API categories Apple documents. Present only so an identifier outside the
 * set is *noticed*: nothing here maps a category to anything, because nothing in this repository can
 * — see the note in the SKILL about what the census cannot compare these against.
 */
const APPLE_API_CATEGORIES = new Set([
  "NSPrivacyAccessedAPICategoryFileTimestamp",
  "NSPrivacyAccessedAPICategorySystemBootTime",
  "NSPrivacyAccessedAPICategoryDiskSpace",
  "NSPrivacyAccessedAPICategoryActiveKeyboards",
  "NSPrivacyAccessedAPICategoryUserDefaults",
]);

/**
 * Every key Apple documents for a privacy manifest, at each level.
 *
 * The parser reported unrecognised *values* and said nothing about unrecognised *keys*, so a
 * singular typo (`NSPrivacyTrackingDomain`), a case change, or stray whitespace inside a key made a
 * declaration vanish with `problems` empty. Six such constructions returned an empty declaration
 * and complete silence. A key outside these sets is now
 * always reported: the module cannot know whether Apple added it yesterday or the developer
 * mistyped it, and either way the reader must be told the parser did not use it.
 */
const APPLE_TOP_KEYS = new Set([
  "NSPrivacyTracking",
  "NSPrivacyTrackingDomains",
  "NSPrivacyCollectedDataTypes",
  "NSPrivacyAccessedAPITypes",
]);
const APPLE_COLLECTED_KEYS = new Set([
  "NSPrivacyCollectedDataType",
  "NSPrivacyCollectedDataTypeLinked",
  "NSPrivacyCollectedDataTypeTracking",
  "NSPrivacyCollectedDataTypePurposes",
]);
const APPLE_API_KEYS = new Set([
  "NSPrivacyAccessedAPIType",
  "NSPrivacyAccessedAPITypeReasons",
]);

/**
 * A documented key holding the wrong kind of value.
 *
 * The reason this exists at all: `typeof x === "boolean" ? … : undefined` reads a
 * `<string>true</string>` as "the key is not there", and the module's own promise — *missing is not
 * `false`* — then means two different things at once. A manifest that declares tracking, written by
 * a developer who typed the wrong tag, came back `tracking` absent, `collected: []` and
 * `problems: []`: a clean report of nothing, about a file that says something. Absence must mean
 * absence, so every documented key that is present with the wrong type is recorded here and the
 * value is still not used.
 */
function typeOfPlist(v: PlistValue): string {
  if (Array.isArray(v)) return "array";
  if (v === null || v === undefined) return "absent";
  if (typeof v === "object") return "dict";
  return typeof v;
}

export interface StoreCollectedType {
  /** The store's own identifier, verbatim. */
  type: string;
  /** Human-readable name, only where the identifier is a known one. */
  label?: string;
  linked?: boolean;
  tracking?: boolean;
  purposes: { id: string; label?: string }[];
  /** The census axis this declared collection bears on. */
  categories: CensusCategory[];
}

export interface StoreDeclaration {
  file: string;
  format: "apple-xcprivacy" | "play-data-safety-csv";
  /** Apple: the NSPrivacyTracking flag. Absent where the key is missing — missing is not `false`. */
  tracking?: boolean;
  /** Apple: domains the app declares it contacts for tracking. The census's outbound hosts are the code-side counterpart. */
  tracking_domains: string[];
  collected: StoreCollectedType[];
  /** Apple: declared use of APIs that require a reason (file timestamps, UserDefaults, …). */
  accessed_api_types: { type: string; reasons: string[] }[];
  /** Play CSV: the raw rows, cells split. Interpretation is deliberately the agent's. */
  rows?: string[][];
  /**
   * What could not be understood in **this file**: a malformed plist, a documented key holding the
   * wrong kind of value, an entry missing its identifier. A non-empty list is a fact about the
   * declaration, not an error of this run, and `problems.length > 0` is meant to be usable as "look
   * at this one".
   */
  problems: string[];
  /**
   * Decisions this module made, which are true of every file of the kind and say nothing about this
   * one — that Play rows are carried uninterpreted, that an unrecognised identifier was passed
   * through with no label. Split out of `problems` on 2026-07-28: one note emitted on every Play CSV
   * ever parsed made `problems.length > 0` mean nothing at all.
   */
  notes: string[];
}

/* --------------------------------------------------------------------- *
 * Apple
 * --------------------------------------------------------------------- */

const asArray = (v: PlistValue | undefined): PlistValue[] => (Array.isArray(v) ? v : []);
const asDict = (v: PlistValue): { [key: string]: PlistValue } =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as { [key: string]: PlistValue }) : {};

export function parseXcprivacy(file: string, content: string): StoreDeclaration {
  const out: StoreDeclaration = {
    file,
    format: "apple-xcprivacy",
    tracking_domains: [],
    collected: [],
    accessed_api_types: [],
    problems: [],
    notes: [],
  };
  let root: PlistValue;
  try {
    root = parsePlist(content);
  } catch (e) {
    out.problems.push(`not parseable as a plist: ${(e as Error).message}`);
    return out;
  }
  for (const key of lastDuplicateKeys()) {
    out.problems.push(`the key ${key} appears more than once; the last value won, so any earlier one was discarded without being read`);
  }
  const dict = asDict(root);
  if (Object.keys(dict).length === 0) {
    // Distinguish "not a dictionary" from "an empty dictionary": the second parsed correctly and
    // declares nothing, which is a fact about the file rather than a shape complaint.
    out.problems.push(
      Array.isArray(root) || typeof root !== "object" || root === null
        ? `parsed, but the top level is ${typeOfPlist(root)} — not the shape of a privacy manifest, which is a dictionary`
        : "parsed, and the top-level dictionary is empty — the file declares nothing at all",
    );
    return out;
  }
  for (const key of Object.keys(dict)) {
    if (!APPLE_TOP_KEYS.has(key)) {
      out.problems.push(`unrecognised top-level key ${JSON.stringify(key)} — not read. Check the spelling against Apple's documented keys; a near miss such as a singular NSPrivacyTrackingDomain declares nothing`);
    }
  }

  /** Present but the wrong shape is a problem; absent is not. */
  const wrongType = (key: string, where: string, expected: string, got: PlistValue | undefined) => {
    const actual = typeOfPlist(got as PlistValue);
    out.problems.push(
      actual === expected
        ? `${where}${key} is ${actual} but empty, so nothing could be read from it — reported here rather than read as absent`
        : `${where}${key} is ${actual}, expected ${expected} — the value was not used, so it is reported here rather than read as absent`,
    );
  };

  if (dict.NSPrivacyTracking !== undefined) {
    if (typeof dict.NSPrivacyTracking === "boolean") out.tracking = dict.NSPrivacyTracking;
    else wrongType("NSPrivacyTracking", "", "true/false", dict.NSPrivacyTracking);
  }
  if (dict.NSPrivacyTrackingDomains !== undefined) {
    if (Array.isArray(dict.NSPrivacyTrackingDomains)) {
      for (const [i, d] of dict.NSPrivacyTrackingDomains.entries()) {
        if (typeof d === "string") out.tracking_domains.push(d);
        else wrongType(`[${i}]`, "NSPrivacyTrackingDomains", "string", d);
      }
    } else wrongType("NSPrivacyTrackingDomains", "", "array", dict.NSPrivacyTrackingDomains);
  }

  if (dict.NSPrivacyCollectedDataTypes !== undefined && !Array.isArray(dict.NSPrivacyCollectedDataTypes)) {
    wrongType("NSPrivacyCollectedDataTypes", "", "array", dict.NSPrivacyCollectedDataTypes);
  }
  for (const [i, entry] of asArray(dict.NSPrivacyCollectedDataTypes).entries()) {
    const at = `NSPrivacyCollectedDataTypes[${i}].`;
    const e = asDict(entry);
    if (Object.keys(e).length === 0) {
      out.problems.push(
        typeOfPlist(entry) === "dict"
          ? `NSPrivacyCollectedDataTypes[${i}] is an empty dictionary — it declares nothing and was not read`
          : `NSPrivacyCollectedDataTypes[${i}] is ${typeOfPlist(entry)}, expected dict — the entry was not read`,
      );
      continue;
    }
    for (const key of Object.keys(e)) {
      if (!APPLE_COLLECTED_KEYS.has(key)) out.problems.push(`unrecognised key ${JSON.stringify(key)} in ${at.slice(0, -1)} — not read`);
    }
    const type = typeof e.NSPrivacyCollectedDataType === "string" ? e.NSPrivacyCollectedDataType : "";
    if (!type) {
      if (e.NSPrivacyCollectedDataType !== undefined) wrongType("NSPrivacyCollectedDataType", at, "string", e.NSPrivacyCollectedDataType);
      else out.problems.push(`NSPrivacyCollectedDataTypes[${i}] has no NSPrivacyCollectedDataType`);
      continue;
    }
    if (e.NSPrivacyCollectedDataTypePurposes !== undefined && !Array.isArray(e.NSPrivacyCollectedDataTypePurposes)) {
      wrongType("NSPrivacyCollectedDataTypePurposes", at, "array", e.NSPrivacyCollectedDataTypePurposes);
    }
    const purposes: { id: string; label?: string }[] = [];
    for (const [j, p] of asArray(e.NSPrivacyCollectedDataTypePurposes).entries()) {
      if (typeof p !== "string") {
        wrongType(`NSPrivacyCollectedDataTypePurposes[${j}]`, at, "string", p);
        continue;
      }
      purposes.push({ id: p, ...(APPLE_PURPOSES[p] ? { label: APPLE_PURPOSES[p] } : {}) });
      // The unknown-passes-through promise, kept for purposes as well as for data types. It was kept
      // only for data types until 2026-07-28, so an identifier Apple has not published — or one the
      // developer mistyped — went out with no label and nothing said about it.
      if (!APPLE_PURPOSES[p]) out.notes.push(`unrecognised purpose identifier ${p} in ${at.slice(0, -1)} — carried verbatim, no label`);
    }
    let tracking: boolean | undefined;
    if (e.NSPrivacyCollectedDataTypeTracking !== undefined) {
      if (typeof e.NSPrivacyCollectedDataTypeTracking === "boolean") tracking = e.NSPrivacyCollectedDataTypeTracking;
      else wrongType("NSPrivacyCollectedDataTypeTracking", at, "true/false", e.NSPrivacyCollectedDataTypeTracking);
    }
    let linked: boolean | undefined;
    if (e.NSPrivacyCollectedDataTypeLinked !== undefined) {
      if (typeof e.NSPrivacyCollectedDataTypeLinked === "boolean") linked = e.NSPrivacyCollectedDataTypeLinked;
      else wrongType("NSPrivacyCollectedDataTypeLinked", at, "true/false", e.NSPrivacyCollectedDataTypeLinked);
    }
    out.collected.push({
      type,
      ...(APPLE_DATA_TYPES[type] ? { label: APPLE_DATA_TYPES[type] } : {}),
      ...(linked !== undefined ? { linked } : {}),
      ...(tracking !== undefined ? { tracking } : {}),
      purposes,
      // Declared collection bears on the census's collection axis; where the entry is declared as
      // tracking, a third party is receiving it by Apple's own definition of the word, so the
      // recipients axis applies too. Nothing else is inferred.
      categories: tracking ? ["collection", "recipients"] : ["collection"],
    });
    if (!APPLE_DATA_TYPES[type]) out.notes.push(`unrecognised data type identifier ${type} — carried verbatim, no label`);
  }

  if (dict.NSPrivacyAccessedAPITypes !== undefined && !Array.isArray(dict.NSPrivacyAccessedAPITypes)) {
    wrongType("NSPrivacyAccessedAPITypes", "", "array", dict.NSPrivacyAccessedAPITypes);
  }
  for (const [i, entry] of asArray(dict.NSPrivacyAccessedAPITypes).entries()) {
    const at = `NSPrivacyAccessedAPITypes[${i}].`;
    const e = asDict(entry);
    if (Object.keys(e).length === 0) {
      out.problems.push(
        typeOfPlist(entry) === "dict"
          ? `NSPrivacyAccessedAPITypes[${i}] is an empty dictionary — it declares nothing and was not read`
          : `NSPrivacyAccessedAPITypes[${i}] is ${typeOfPlist(entry)}, expected dict — the entry was not read`,
      );
      continue;
    }
    for (const key of Object.keys(e)) {
      if (!APPLE_API_KEYS.has(key)) out.problems.push(`unrecognised key ${JSON.stringify(key)} in ${at.slice(0, -1)} — not read`);
    }
    const type = typeof e.NSPrivacyAccessedAPIType === "string" ? e.NSPrivacyAccessedAPIType : "";
    if (!type) {
      if (e.NSPrivacyAccessedAPIType !== undefined) wrongType("NSPrivacyAccessedAPIType", at, "string", e.NSPrivacyAccessedAPIType);
      else out.problems.push(`NSPrivacyAccessedAPITypes[${i}] has no NSPrivacyAccessedAPIType`);
      continue;
    }
    const reasons: string[] = [];
    for (const [j, r] of asArray(e.NSPrivacyAccessedAPITypeReasons).entries()) {
      if (typeof r === "string") reasons.push(r);
      else wrongType(`NSPrivacyAccessedAPITypeReasons[${j}]`, at, "string", r);
    }
    if (e.NSPrivacyAccessedAPITypeReasons !== undefined && !Array.isArray(e.NSPrivacyAccessedAPITypeReasons)) {
      wrongType("NSPrivacyAccessedAPITypeReasons", at, "array", e.NSPrivacyAccessedAPITypeReasons);
    }
    if (!APPLE_API_CATEGORIES.has(type)) {
      out.notes.push(`unrecognised accessed-API category ${type} — carried verbatim`);
    }
    out.accessed_api_types.push({ type, reasons });
  }
  return out;
}

/* --------------------------------------------------------------------- *
 * Google Play
 * --------------------------------------------------------------------- */

/**
 * A CSV splitter that understands quotes and embedded commas.
 *
 * Two corrections on 2026-07-28. **Every row is kept, including an all-empty one.** Dropping them
 * looked harmless and was not: a blank answer row in a data-safety form is a fact — the developer
 * left it blank — and, worse, dropping rows shifts every index after it, so an agent that says "row
 * 14 declares location" is pointing at a different row than the file's fourteenth. **A bare quote
 * inside an unquoted cell is a literal.** `RFC 4180` has no meaning for `36" monitor`, but Play
 * exports are written by hand as often as by machine, and the previous reading — start a quoted
 * section here — swallowed the rest of the line, commas and all, into one cell.
 */
function splitCsv(content: string): { rows: string[][]; unterminatedQuote: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let cellStartedQuoted = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (quoted) {
      if (ch === '"') {
        if (content[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
      continue;
    }
    // A quote opens a quoted section only at the start of a cell. Anywhere else it is a character
    // the developer typed.
    if (ch === '"' && cell === "" && !cellStartedQuoted) { quoted = true; cellStartedQuoted = true; continue; }
    if (ch === '"') { cell += '"'; continue; }
    if (ch === ",") { row.push(cell); cell = ""; cellStartedQuoted = false; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && content[i + 1] === "\n") i++;
      row.push(cell); cell = ""; cellStartedQuoted = false;
      rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  // A trailing newline ends the last row; anything after it is a real final row, even if empty.
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return { rows, unterminatedQuote: quoted };
}

export function parsePlayDataSafetyCsv(file: string, content: string): StoreDeclaration {
  const out: StoreDeclaration = {
    file,
    format: "play-data-safety-csv",
    tracking_domains: [],
    collected: [],
    accessed_api_types: [],
    rows: [],
    problems: [],
    notes: [],
  };
  const { rows, unterminatedQuote } = splitCsv(content);
  if (rows.length === 0) {
    out.problems.push("the file is empty");
    return out;
  }
  if (unterminatedQuote) {
    // Everything from the opening quote to the end of the file became one cell, so every row after
    // it disappeared and the row numbers an agent cites no longer name the rows the developer sees.
    out.problems.push(
      `a quoted cell is never closed, so the rest of the file was read as one value: ${rows.length} row(s) here, and the row numbers below do not correspond to the file`,
    );
  }
  out.rows = rows;
  // Deliberately no column interpretation: Google's export format is not documented in a form this
  // repository has verified against a primary source, and a guessed mapping that is wrong would put
  // words in the developer's declaration. The agent reads the rows; this layer only carries them.
  //
  // A `note`, not a `problem`. It is emitted on every Play CSV this module will ever parse, so as a
  // problem it made `problems.length > 0` true of every such file and therefore useless as a signal
  // that one of them needs attention.
  out.notes.push(
    "rows carried without interpretation: the deterministic layer does not map Play CSV columns to meanings it has not verified",
  );
  return out;
}

/* --------------------------------------------------------------------- *
 * Finding the files
 * --------------------------------------------------------------------- */

export function isXcprivacyPath(path: string): boolean {
  return path.toLowerCase().endsWith(".xcprivacy");
}

export function isPlayDataSafetyPath(path: string): boolean {
  const lower = path.toLowerCase();
  const base = lower.split("/").pop() ?? "";
  if (!base.endsWith(".csv")) return false;
  // The marker may be in a directory rather than the file name — `play/data-safety/export.csv` is
  // how the Play Console's export is filed as often as `data_safety_export.csv`, and testing the
  // basename alone missed it.
  return ["data_safety", "data-safety", "datasafety"].some((m) => lower.includes(m));
}

/**
 * Third-party manifests, which are most of the manifests in a real iOS repository.
 *
 * A CocoaPods, Carthage or SPM checkout contains one `PrivacyInfo.xcprivacy` per vendored SDK, and
 * every one of them declares what *that SDK* collects — not what the app declares to Apple. Reporting
 * them together produces a picture of the developer's declaration that is mostly somebody else's.
 * They are collected, never dropped (the standing rule), and flagged so the agent can tell them
 * apart.
 */
const VENDORED_MARKERS = [
  // Trees the walker DOES walk, which is the whole point of the list. `node_modules/`, `vendor/`
  // and `.build/` were in it until 2026-07-29 and could essentially never fire, because the walker
  // excludes those trees before this function is ever reached — while `ThirdParty/`, `Frameworks/`,
  // `External/`, `Libraries/` and SPM's `SourcePackages/checkouts/` are walked and were NOT flagged,
  // so a dependency's declaration was handed to the agent as the app's own.
  "/pods/",
  "/carthage/",
  "/thirdparty/",
  "/third_party/",
  "/frameworks/",
  "/external/",
  "/libraries/",
  "/sourcepackages/checkouts/",
  "/submodules/",
  ".xcframework/",
];

export function isVendoredManifest(path: string): boolean {
  const p = `/${path.toLowerCase()}`;
  // `.framework/` is deliberately not a marker: `MyApp.framework/PrivacyInfo.xcprivacy` is the app's
  // own, and flagging it as somebody else's is the same error in the other direction. A vendored
  // framework is caught by the directory it sits in, not by its own suffix.
  return VENDORED_MARKERS.some((m) => p.includes(m));
}

export interface StoreCollection {
  declarations: StoreDeclaration[];
  /** Paths that look like a manifest and could not be read at all. */
  unreadable: string[];
  /**
   * Manifests the walker never offered — a binary plist rejected as `binary-content`, a Play CSV over
   * the size limit, a file in a skipped tree. **This list is the whole point of the type.** All three
   * paths previously ended in silence: the file was not in `files`, so nothing here saw it, and the
   * summary said "no store declarations found" about a repository that ships one. A manifest that was
   * not read and a manifest that does not exist are different facts.
   */
  excluded: { file: string; reason: string }[];
}

/** Does this path look like a store declaration, judged on its name alone? */
export function looksLikeStoreDeclaration(path: string): boolean {
  return isXcprivacyPath(path) || isPlayDataSafetyPath(path);
}

export function collectStoreDeclarations(
  files: string[],
  readFile: (rel: string) => string | null,
  /**
   * Paths the walker refused, in full, from `WalkResult.refused`.
   *
   * **Not `WalkResult.excluded`.** That list is a summary: aggregated by (reason, directory), capped
   * at three examples each, and not enumerating generated trees at all. Reading refused manifests
   * out of it meant that a manifest under `node_modules/`, `vendor/` or `dist/` appeared in none of
   * the three lists this function returns, and that a binary-plist manifest inside a `.framework`
   * vanished whenever three alphabetically earlier siblings had consumed the example slots — the
   * exact scenario the field was added for.
   *
   * Each in its two forms (walk.ts `shownText`): the name is tested on `path`, the match form, and reported as `shown`,
   * the form a person reads, where that is not the path's text (a byte that is not valid UTF-8): such a path is never a
   * file the walker offered, whatever its match form says.
   */
  refusedByWalker: { path: string; reason: string; shown?: string }[] = [],
): StoreCollection {
  const declarations: StoreDeclaration[] = [];
  const unreadable: string[] = [];
  const excluded: { file: string; reason: string }[] = [];
  const seenPath = new Set<string>();
  for (const f of files) {
    if (!looksLikeStoreDeclaration(f)) continue;
    // A path listed twice by the caller is one file, not two declarations.
    if (seenPath.has(f)) continue;
    seenPath.add(f);
    const content = readFile(f);
    if (content === null) {
      unreadable.push(f);
      continue;
    }
    const parsed = isXcprivacyPath(f) ? parseXcprivacy(f, content) : parsePlayDataSafetyCsv(f, content);
    if (isVendoredManifest(f)) {
      parsed.notes.push(
        "this manifest is inside a vendored dependency tree, so it declares what that dependency collects, not what this app declares to the store",
      );
    }
    declarations.push(parsed);
  }
  const walked = new Set(files);
  const reportedExcluded = new Set<string>();
  for (const r of refusedByWalker) {
    if (!looksLikeStoreDeclaration(r.path)) continue;
    const asText = r.shown === undefined || r.shown === shownText(r.path);
    const file = asText ? r.path : (r.shown as string);
    // A file the walker offered is not excluded, and one refused under two rules is still one file.
    if ((asText && walked.has(r.path)) || reportedExcluded.has(`${asText ? "t" : "s"}\0${file}`)) continue;
    reportedExcluded.add(`${asText ? "t" : "s"}\0${file}`);
    excluded.push({ file, reason: r.reason });
  }
  declarations.sort((a, b) => a.file.localeCompare(b.file));
  unreadable.sort((a, b) => a.localeCompare(b));
  excluded.sort((a, b) => a.file.localeCompare(b.file));
  return { declarations, unreadable, excluded };
}

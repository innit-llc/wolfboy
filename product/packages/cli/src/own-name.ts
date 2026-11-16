/**
 * THE PRODUCT'S OWN NAME.
 *
 * When the scanned tree is a vendor's own software, the five recipient-identity rules read the product's own name as an
 * outside party that receives data (on one vendor's own analytics application, nearly every one of `recipients-006`'s places). Which product the
 * code is, is a fact about the product: it is ASKED (the self-name question, `product_identity.vendor_software` in
 * scan-profile.schema.json) and never inferred from the tree.
 *
 * With an answer naming an entry (its own software, or a fork of it), NOTHING IS REMOVED FROM WHAT LAYER 2 READS:
 * - a place whose matched words all belong to that entry (`ownNameEntryOf`, by the bundle's `vocabulary_owners`, never by
 *   matching a name) is still read, every one, by a place seat told the answer and asked one question
 *   (`OWN_NAME_QUESTION`): does the place only name the product, or does it send, load or call a service the publisher runs;
 * - such a place on a line that names a host or a URL under that name (`namesPublisherHost`) is read with the rule's
 *   full questions, as any other place: a publisher's own service is an outside recipient for anyone other than the
 *   publisher running its own hosted service, and the same code serves every operator, so the place is the construct;
 * - a line that also spells another entry stays an ordinary place.
 * Unanswered, `none`, or in CI (which reads no answer), every place is read as before the question existed.
 *
 * THE PREMISE: the root manifests' own package names (`manifestNamesOf`) are handed to the seats beside the answer, the
 * way ships-premise.ts hands its premise. They may corroborate or contradict the answer and never decide it; a
 * contradiction asks the person to check the answer. Reading the manifests is reading data: nothing is run.
 */
import { join } from "node:path";
import type { Candidate, FindingLocation, Rule } from "wolfboy-schemas";
import { ownerIndexOf, ownersOfToken, type OwnerIndex } from "./item-label.js";
import { readSourceText } from "./project-read.js";

/** The profile field the self-name answer is stored in (scan-profile.schema.json). */
export const VENDOR_SOFTWARE_FIELD = "product_identity.vendor_software";
/**
 * The rules the self-name answer re-routes: the five whose question is "who receives" and whose items are the vendors
 * their shared recipient lists name (proposal section 5). The consent rules that also import recipient lists
 * (`eu-consent-005`, `-006`) are not among them: their target, a tracker loaded or storage written, is real in the
 * vendor's own tree too (proposal section 5).
 */
export const SELF_NAME_RULES: ReadonlySet<string> = new Set(["recipients-001", "recipients-002", "recipients-004", "recipients-005", "recipients-006"]);
/** The one item the own-name places are listed under in the report. */
export const OWN_NAME_ITEM = "the product's own name";
/**
 * The one question a seat reading own-name places is asked, in place of the rule's context questions. Its
 * answers are the place decision words every place seat writes (legal-adjudicator.md, "When your payload carries
 * `own_name`").
 */
export const OWN_NAME_QUESTION =
  "The person running this scan answered that the code is the software of the vendor named in `own_name.entry` (or a fork of it, where `own_name.relation` is `fork`). For each place: does the code at this place only name the product itself (a class, a namespace, a translation, a document, a configuration key, a file of the product), or does it send, load or call something from a service the publisher runs (its API, a plugin marketplace, downloads, a shop, its hosted service)? Naming only is `not_the_construct`; sending, loading or calling is `is_the_construct`, and `why` names the service. The answer is the person's; where the place, or `own_name.manifest_names`, shows it cannot be true, say so in `why`.";

export interface VendorSoftware {
  entry: string;
  relation: "own" | "fork";
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The self-name answer a profile holds, or null (unanswered, `none`, or no profile). */
export function vendorSoftwareOf(profile: unknown): VendorSoftware | null {
  const at = isRecord(profile) && isRecord(profile.product_identity) ? profile.product_identity.vendor_software : undefined;
  if (!isRecord(at) || typeof at.entry !== "string" || at.entry.length === 0) return null;
  return at.relation === "own" || at.relation === "fork" ? { entry: at.entry, relation: at.relation } : null;
}

/** The one entry every part of a matched token belongs to, or null where it spells none or more than one. */
export function ownNameEntryOf(token: unknown, index: OwnerIndex | null): string | null {
  if (index === null || typeof token !== "string" || token.length === 0) return null;
  const owners = ownersOfToken(token, index);
  return owners.length === 1 ? owners[0]! : null;
}

/**
 * The VENDOR entries a rule's shared lists name: the owners of its lists of kind "recipient" (`detector.vocabulary_kinds`;
 * a list the bundle gives no kind counts). A "term" list's entry names a concept ("Icon, icon-font and icon-set delivery
 * CDNs"), never a vendor whose software the code could be, so the question never offers one and no place of one is read
 * as the product's own name.
 */
export function vendorEntriesOf(rule: Rule | undefined): Set<string> {
  const out = new Set<string>();
  const owners = rule?.detector?.vocabulary_owners;
  const kinds = rule?.detector?.vocabulary_kinds;
  for (const [list, byAnchor] of Object.entries(owners ?? {})) {
    const kind = kinds?.[list];
    if (kind !== undefined && kind !== "recipient") continue;
    for (const name of Object.values(byAnchor ?? {})) if (typeof name === "string") out.add(name);
  }
  return out;
}

export interface OwnNameTally {
  entry: string;
  /** The entry's legal entity, as the bundle carries it (`detector.vocabulary_entities`); absent where it names none. */
  entity?: string;
  /** Places of the five rules' candidates whose matched words all belong to the entry. */
  places: number;
  /** One key per such place (`<finding id>#<position>`): the question's order key, a place being one decision row. */
  placeKeys: string[];
  candidates: Candidate[];
}

/** The vendor entries the five rules' candidates name, each with its places, the most places first (then by name). */
export function ownNameTally(rules: readonly Rule[], candidates: readonly Candidate[]): OwnNameTally[] {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const indexes = new Map<string, OwnerIndex | null>();
  const vendors = new Map<string, Set<string>>();
  const tally = new Map<string, OwnNameTally>();
  for (const c of candidates) {
    if (!SELF_NAME_RULES.has(c.rule_id)) continue;
    const rule = byId.get(c.rule_id);
    if (!indexes.has(c.rule_id)) indexes.set(c.rule_id, ownerIndexOf(rule));
    if (!vendors.has(c.rule_id)) vendors.set(c.rule_id, vendorEntriesOf(rule));
    const index = indexes.get(c.rule_id) ?? null;
    const vendorNames = vendors.get(c.rule_id)!;
    (c.locations as (FindingLocation & { matched_token?: unknown })[]).forEach((loc, i) => {
      const entry = ownNameEntryOf(loc.matched_token, index);
      if (entry === null || !vendorNames.has(entry)) return;
      let t = tally.get(entry);
      if (!t) {
        const entity = rule?.detector?.vocabulary_entities?.[entry];
        t = { entry, ...(entity ? { entity } : {}), places: 0, placeKeys: [], candidates: [] };
        tally.set(entry, t);
      }
      t.places++;
      t.placeKeys.push(`${c.finding_id}#${i}`);
      if (!t.candidates.includes(c)) t.candidates.push(c);
    });
  }
  return [...tally.values()].sort((a, b) => b.places - a.places || (a.entry < b.entry ? -1 : a.entry > b.entry ? 1 : 0));
}

/**
 * The words an entry's name is spelt with in a host: the first run of four or more letters and digits of each of the
 * entry's anchors (`matomo.php` gives `matomo`, `@sentry/node` gives `sentry`, `_paq` gives none), lower-cased.
 */
export function nameWordsOf(rule: Rule | undefined, entry: string): string[] {
  const owners = rule?.detector?.vocabulary_owners;
  const out = new Set<string>();
  if (!owners) return [];
  for (const list of Object.values(owners)) {
    for (const [anchor, owner] of Object.entries(list ?? {})) {
      if (owner !== entry) continue;
      const run = /[a-z0-9]{4,}/.exec(anchor.toLowerCase());
      if (run) out.add(run[0]);
    }
  }
  return [...out].sort();
}

/** The last labels of a dotted word that are a file's type, not a host's top-level domain (`matomo.php`, `piwik.js`). */
const FILE_TYPES = new Set([
  "js", "ts", "py", "rb", "go", "md", "sh", "pl", "cs", "rs", "kt", "mo", "po", "so", "cc", "db", "gz", "vb", "hh", "ps", "ml", "el", "fs", "jl", "tf", "ex", "hs", "cpp", "php", "json", "css", "scss", "less", "html", "htm", "twig", "tpl", "txt", "xml", "yml", "yaml", "svg", "png", "jpg", "jpeg", "gif", "ico", "map", "mjs", "cjs", "jsx", "tsx", "vue", "ini", "lock", "log", "sql", "csv", "java", "swift", "dart", "lua", "zip", "tar", "pdf", "woff", "woff2", "ttf", "eot", "rst", "toml", "conf", "cfg", "env", "dist", "phtml", "inc", "test", "spec", "min", "less",
]);
/** Top-level domains longer than two letters a publisher's host is written under (two-letter ones are country codes). */
const LONG_TLDS = new Set(["com", "org", "net", "info", "biz", "pro", "app", "dev", "cloud", "tech", "site", "online", "xyz", "shop", "store", "page", "host", "services", "software", "systems", "digital", "network", "global", "eu", "us", "io", "co", "ai"]);

/**
 * Whether a source line names a host or a URL under one of the entry's name words: an `http(s)://` (or any scheme) URL
 * containing one, or a dotted host name whose top-level label is a domain (`api.matomo.org`, `matomo.cloud`), not a
 * file type (`matomo.php`). Such a place is read with the rule's full questions.
 */
export function namesPublisherHost(line: string | undefined, words: readonly string[]): boolean {
  if (typeof line !== "string" || words.length === 0) return false;
  const low = line.toLowerCase();
  for (const m of low.matchAll(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>`)\]]+/g)) if (words.some((w) => m[0].includes(w))) return true;
  for (const m of low.matchAll(/(?<![a-z0-9_.-])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+)([a-z]{2,})(?![a-z0-9_-])/g)) {
    const tld = m[2]!;
    if (FILE_TYPES.has(tld)) continue;
    if (tld.length > 2 && !LONG_TLDS.has(tld)) continue;
    const labels = m[1]!.split(".").filter((l) => l.length > 0);
    if (labels.some((l) => words.some((w) => l.includes(w)))) return true;
  }
  return false;
}

export interface ManifestName {
  file: string;
  name: string;
}
const MANIFESTS: { file: string; read: (text: string) => string | null }[] = [
  { file: "package.json", read: (t) => jsonName(t) },
  { file: "composer.json", read: (t) => jsonName(t) },
  { file: "pyproject.toml", read: (t) => tomlName(t, ["project", "tool.poetry"]) },
  { file: "Cargo.toml", read: (t) => tomlName(t, ["package"]) },
  { file: "go.mod", read: (t) => /^module\s+(\S+)/m.exec(t)?.[1] ?? null },
  { file: "pom.xml", read: (t) => /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/.exec(t.replace(/<parent>[\s\S]*?<\/parent>/, ""))?.[1] ?? null },
];
function jsonName(text: string): string | null {
  try {
    const v = JSON.parse(text) as unknown;
    return isRecord(v) && typeof v.name === "string" && v.name.length > 0 ? v.name : null;
  } catch {
    return null;
  }
}
function tomlName(text: string, tables: string[]): string | null {
  let table = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const head = /^\[([^\]]+)\]$/.exec(line);
    if (head) {
      table = head[1]!.trim();
      continue;
    }
    const kv = /^name\s*=\s*["']([^"']+)["']/.exec(line);
    if (kv && tables.includes(table)) return kv[1]!;
  }
  return null;
}

/** The package names the tree's root manifests give the tree itself (read as data; a file that cannot be read is skipped). */
export function manifestNamesOf(root: string): ManifestName[] {
  const out: ManifestName[] = [];
  for (const m of MANIFESTS) {
    let text: string;
    try {
      text = readSourceText(join(root, m.file));
    } catch {
      continue;
    }
    const name = m.read(text);
    if (name) out.push({ file: m.file, name });
  }
  return out;
}

export type OwnNamePremise = "corroborates" | "contradicts" | "silent";
/**
 * What the manifest names say of the answer: `corroborates` where one spells a name word of the entry; `contradicts`
 * where the answer is the vendor's own software and the root manifests name the tree something that spells none of them
 * (a fork may carry a name of its own, so a fork's answer is never contradicted); `silent` where no manifest names it.
 */
export function ownNamePremiseOf(answer: VendorSoftware, names: readonly ManifestName[], words: readonly string[]): OwnNamePremise {
  if (names.length === 0) return "silent";
  const spells = names.some((n) => words.some((w) => n.name.toLowerCase().includes(w)));
  if (spells) return "corroborates";
  return answer.relation === "own" && words.length > 0 ? "contradicts" : "silent";
}
/** The sentence a scan prints where the manifests contradict the answer. */
export function contradictionSentence(answer: VendorSoftware, names: readonly ManifestName[], reviewCommand: string): string {
  const listed = names.map((n) => `${n.file} names it "${n.name}"`).join("; ");
  return `Your answer says this code is ${answer.entry}'s own software, and its root package manifests do not name it so (${listed}). Check the answer: ${reviewCommand}`;
}

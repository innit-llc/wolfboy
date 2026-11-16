/**
 * Declaration reconciliation — the deterministic half.
 *
 * `scan` emits `findings.json` and the `legal-scan` skill adjudicates it. This does the same thing
 * for pillar 2: everything a machine can settle without judgement is settled here and written to
 * one file, and the `declaration-reconcile` skill reads that file and does the part that needs
 * reading comprehension.
 *
 * What is deterministic, and therefore here:
 *
 * - which documents exist and what was searched for them (`discover.ts`)
 * - what their text is, with the line numbers a quotation will cite (`extract.ts`)
 * - what the code does — recipients, transfers, retention, collection (`census.ts`)
 * - which of those facts sit where the code scan already reported something (`join.ts`)
 * - the Art 13/14 checklist the agent walks, carried in the bundle so it is version-pinned and
 *   integrity-checked like the rules
 * - the mechanical state of each of those checklists' scope gates, for the gates that ship `limbs`
 *   (`scope.ts`, the same evaluator `scan` calls — W2, 2026-09-01)
 *
 * What is judgement, and therefore not here: whether a claim is falsified, whether a fact involves
 * personal data, whether silence in the document is an omission. The whole point of the split is
 * that the first list can be regression-tested and the second cannot, and mixing them is how a
 * mechanism nobody can audit gets built.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, join as joinPath, resolve } from "node:path";
import { relativePath } from "./project-path.js";
import type {
  DeclaredArtifactAbsentReason,
  DeclaredArtifactEvidence,
  DeclaredArtifactKind,
  DeclaredArtifactReconciliation,
  DiscoveryResult,
  DocumentNameShapeKind,
  ReconcileInput,
  ScanProfile,
  ScopeEvidence,
  StoreDeclaration,
  WalkerExclusion,
} from "wolfboy-schemas";
import type { LoadedBundle } from "./bundle.js";
import { runCensus, type CensusFact } from "./census.js";
import { redactEvidenceValues, redactPrintedText, redactStringsInPlace } from "./credential-redaction.js";
import { productCredentials, productPrintedRedaction } from "./engine.js";
import { DECLARATION_GLOBS, discoverDocuments, nameShapeGlobFor, type DiscoveredDoc } from "./discover.js";
import { extractText, LINE_LOCATES_NOTHING_CHARS, type ExtractedDoc } from "./extract.js";
import { loadScanProfile } from "./profile.js";
import { annotateLocatables, loadPillar1Index, statusOf, type Pillar1Index } from "./join.js";
import { assessScope, settledByCode } from "./scope.js";
import {
  collectStoreDeclarations,
  isPlayDataSafetyPath,
  isVendoredManifest,
  isXcprivacyPath,
  looksLikeStoreDeclaration,
} from "./store-declarations.js";
import { UNREADABLE_REASONS, walkTarget } from "./walk.js";
import { readSourceText } from "./project-read.js";
import { fetchHonouringProxy } from "./proxied-fetch.js";

export const RECONCILE_DISCLAIMER =
  "This output is informational only and does not constitute legal advice. It records what documents were found, what text they contain, and what the code does; whether any of it meets a legal requirement is a question for human review.";

export interface ReconcileOptions {
  bundle: LoadedBundle;
  targetRoot: string;
  /** `--policy` values: repository paths, absolute paths, or URLs. */
  policies?: string[];
  /** `--findings` value: a pillar-1 findings.json to join against. */
  findingsPath?: string;
  /** Fixture runs pass an explicit file list and skip the walk, as `runScan` does. */
  files?: string[];
  /**
   * `--profile` value: the ScanProfile JSON, carried into the output verbatim and — from
   * 2026-09-01, W2 — also handed to the gate evaluator, whose result is emitted as `applicability`.
   *
   * **Added 2026-08-04 because the field the AI Act Annex III design names as the deciding authority
   * was read by nothing.** Those three gates carry `ask_the_user: true` and no `limbs`, so
   * `assessScope` skips them and `features.annex_iii_use` reached no part of the pipeline: two scans
   * with all three of its flags true and all three false produced byte-identical output. `scan`
   * already took `--profile` for rule preconditions; the reconciliation half never did, so no
   * checklist gate could see a profile answer at all.
   *
   * Carried whole rather than picked apart. A later checklist's gate may turn on a `features.*`
   * field nothing names yet, and copying one field at a time is the defect class already recorded
   * twice in this repository — `clause-cover` importing the walker's extension set rather than
   * keeping a copy, `test-reconcile` reading the census-category enum from the schema after a
   * hand-maintained copy failed three checklists the day a category was added.
   */
  profilePath?: string;
  /** `--fetch-timeout`: seconds one `--policy` URL may take, request to last byte. */
  fetchTimeoutSeconds?: number;
}

/**
 * Documents larger than this are recorded but not extracted; a policy is a few thousand words. The
 * same limit caps a fetched `--policy` URL, where it is enforced WHILE reading: the body is read in
 * chunks and the read stops once it passes this size, so a server that sends without end cannot
 * fill the memory of the machine running the scan.
 */
export const MAX_DOCUMENT_BYTES = 2_000_000;

/**
 * Seconds one `--policy` URL may take, from the request to the last byte of the body. Until
 * 2026-10-12 the fetch had no limit at all, so a server that accepted the connection and never
 * answered held `reconcile` forever (architecture review 2026-09-14, D H1 and G F8).
 */
export const DEFAULT_FETCH_TIMEOUT_SECONDS = 30;
/**
 * THE LONGEST `--fetch-timeout`. Until 2026-10-12 any positive number was taken: Node's timer
 * holds at most 2^31-1 ms (about 24.8 days), so 3,000,000 s aborted after about 1 ms with a message saying the server
 * had not answered within 3,000,000 seconds, and 5,000,000 s threw an uncaught RangeError from `AbortSignal.timeout`.
 * One hour: a single document that has not arrived in an hour is not arriving, and the bound is far under the timer's.
 */
export const MAX_FETCH_TIMEOUT_SECONDS = 3600;

/** `--fetch-timeout` as typed: the seconds, or the plain refusal. Undefined is the default. */
export function parseFetchTimeout(typed: string | undefined): { seconds: number } | { problem: string } {
  if (typed === undefined) return { seconds: DEFAULT_FETCH_TIMEOUT_SECONDS };
  const n = Number(typed);
  if (typed.trim() === "" || !Number.isFinite(n) || n <= 0 || n > MAX_FETCH_TIMEOUT_SECONDS) {
    return {
      problem: `--fetch-timeout must be a number of seconds greater than 0 and at most ${MAX_FETCH_TIMEOUT_SECONDS} (one hour), not ${JSON.stringify(typed)}. Nothing was fetched or written.`,
    };
  }
  return { seconds: n };
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

async function fetchDocument(
  url: string,
  timeoutSeconds: number = DEFAULT_FETCH_TIMEOUT_SECONDS,
): Promise<{ content: string; fetchedAt: string } | { error: string }> {
  // One signal for the whole exchange, the body included: a server that sends its headers and then
  // trickles the body is held to the same limit as one that never answers.
  const timedOut = () => `no complete response within ${timeoutSeconds} seconds (--fetch-timeout); the request was abandoned`;
  let signal: AbortSignal;
  try {
    // Inside a `try` of its own: a value the timer cannot hold is a recorded failure, never a crash.
    // `parseFetchTimeout` bounds the option, so this is reached only by a caller that skipped it.
    if (!(timeoutSeconds > 0 && timeoutSeconds <= MAX_FETCH_TIMEOUT_SECONDS)) throw new RangeError(`the timeout ${timeoutSeconds} s is outside 0-${MAX_FETCH_TIMEOUT_SECONDS} s`);
    signal = AbortSignal.timeout(Math.max(1, Math.round(timeoutSeconds * 1000)));
  } catch (e) {
    return { error: `the fetch was not started: ${(e as Error).message}` };
  }
  try {
    // Identify the tool. Not doing so is why 11 of 25 real EU legal pages answered HTTP 403 on
    // 2026-07-28: an unidentified request looks like a scraper to ordinary bot protection. The
    // string says what this is and does not imitate a browser — a site that declines an identified
    // compliance fetch is entitled to, and the refusal is reported rather than worked around.
    // Through the proxy the environment names, as every request of this program.
    const res = await fetchHonouringProxy(url, {
      headers: {
        Accept: "text/html,text/plain,*/*",
        "User-Agent": "declaration-reconcile/0.1 (compliance self-check; reads a site's own published legal pages)",
        "Accept-Language": "*",
      },
      signal,
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return { error: `HTTP ${res.status} ${res.statusText}` };
    }
    const declared = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_DOCUMENT_BYTES) {
      await res.body?.cancel().catch(() => undefined);
      return { error: `the response declares ${declared} bytes, over the ${MAX_DOCUMENT_BYTES}-byte limit; not read` };
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_DOCUMENT_BYTES) {
          await reader.cancel().catch(() => undefined);
          return { error: `the response passed the ${MAX_DOCUMENT_BYTES}-byte limit; reading stopped at ${total} bytes and nothing of it was kept` };
        }
        chunks.push(value);
      }
    }
    // `Response.text()` decodes as UTF-8 whatever the charset header says; this does the same.
    return { content: new TextDecoder("utf-8").decode(Buffer.concat(chunks)), fetchedAt: new Date().toISOString() };
  } catch (e) {
    if (signal.aborted) return { error: timedOut() };
    return { error: fetchErrorText(e) };
  }
}

/**
 * A deep copy of `value` with every credential `baseline-002` recognises in any of its strings replaced
 * by the program's marker (`[redacted:baseline-002#<clause>:<digest>]`, the same marker the report and
 * the evidence log carry). Used for the two parts of the reconciliation input that copy a code line
 * verbatim: the census facts (`line_text`, and a `value` captured from the line) and the lines that
 * reference a declaration (`discovery.referencing_files[].line_text`). Until 2026-10-12 a credential
 * on such a line was written out in clear (record of 2026-09-23, open item 2, part A 5 and 6). The
 * file and line stay, so a person finds the line; nothing else about a fact changes, because a
 * string with nothing to redact comes back as it was. The patterns are the CLI's own (engine.ts
 * `productPrintedRedaction`), whatever bundle runs.
 */
function redactedCopy<T>(value: T): T {
  const copy = structuredClone(value);
  redactStringsInPlace(productPrintedRedaction(), copy);
  return copy;
}

/** The census as the reconciliation input carries it: `redactedCopy` of its facts, the rest as it is. */
function redactedCensus<T extends { facts: unknown[] }>(census: T): T {
  return { ...census, facts: redactedCopy(census.facts) };
}

/**
 * The transport error itself, not only the wrapper's message. Node's `fetch` throws one TypeError,
 * "fetch failed", for every transport failure and keeps what happened in `cause` — "connect
 * ECONNREFUSED 127.0.0.1:8080", "getaddrinfo ENOTFOUND example.invalid", a certificate error.
 * Recorded as "fetch failed" alone, `fetch_failures[].error` could not say which of those it was,
 * and reconcile-input.schema.json promises that field "kept verbatim so the failure can be
 * reproduced".
 */
function fetchErrorText(e: unknown): string {
  const err = e as { message?: unknown; cause?: unknown };
  const message = typeof err?.message === "string" && err.message ? err.message : String(e);
  const cause = err?.cause as { message?: unknown; code?: unknown } | undefined;
  const detail =
    typeof cause?.message === "string" && cause.message
      ? cause.message
      : typeof cause?.code === "string"
        ? cause.code
        : "";
  return detail && !message.includes(detail) ? `${message}: ${detail}` : message;
}

/* ------------------------------------------------------------------------- *
 * declared_artifacts — the operator's own answer, put beside what this run saw.
 * ------------------------------------------------------------------------- *
 *
 * W1 of the pillar-2 plan, 2026-09-01. `ScanProfile.declared_artifacts` — does a privacy policy
 * exist, a set of terms, an Apple privacy manifest, a Play data-safety form — was declared in
 * `scan-profile.schema.json` and READ BY NO CODE: grepped across the product, the tools and the
 * rules on 2026-09-01, the only non-documentation hits were the type declaration and its compiled
 * twin. A person who answered "yes, we publish a privacy policy" was answering into a file nothing
 * opened, which is the same defect the `--profile` flag itself was added to `reconcile` for on
 * 2026-08-04 (`features.annex_iii_use` reached no part of the pipeline).
 *
 * WHAT THIS MAY DO, AND WHAT IT MAY NOT. It puts the answer beside the observation and hands the
 * disagreement back as a question. It never overrides the answer, never suppresses a checklist item,
 * never says the document does not exist, and never concludes anything about any law. **Whether a
 * product publishes a privacy policy is a fact about the product: it is asked of the person running
 * the scan, or read from their declared documents, and it is never inferred from the source**.
 * Code corroborates or contradicts such an answer; it does not
 * decide it.
 *
 * WHY THE TWO KINDS ARE OBSERVED DIFFERENTLY, which is the whole of the honesty in this block:
 *
 * - A store manifest is identified BY ITS FORMAT. `.xcprivacy` is an Apple privacy manifest and a
 *   data-safety CSV is a Play export; `store-declarations.ts` already decides both, and this code
 *   reads its answer rather than re-deriving one. Two nuances it must carry rather than flatten: a
 *   manifest in a VENDORED tree declares what that dependency collects and is never the app's own
 *   (so a tree carrying only those must never produce `observed-but-not-declared` against the
 *   operator), and a manifest that could not be read is not a missing one.
 *
 * - A privacy policy is NOT identified at all. `discover.ts` opens with "It classifies nothing", and
 *   it is right to: a page that turns out to be a marketing blurb costs one read, and a policy the
 *   tool never found costs a finding nobody will ever see. So there is no per-document type to join
 *   on, and inventing one here would be building the classifier this project designed, measured and
 *   discarded in 2026-08-04. What exists is the glob that matched the NAME and the words in the name
 *   itself, so that is what is used, and the entry says in as many words that a shape-match is not
 *   an identification. The four passes that produce no glob at all — sibling, content, explicit,
 *   url — contribute no kind signal.
 *
 *   **Neither direction of that is free**, and two earlier versions of this comment said one was.
 *   Attributing a kind the name does not settle silences `declared-but-not-observed` when the answer
 *   is yes; withholding one the name does settle silences `observed-but-not-declared` when the
 *   answer is no. `nameShapeKinds` states which way each case is decided and why, case by case.
 */

/** Every kind, in the order the summary prints them. All four appear in every run. */
export const DECLARED_ARTIFACT_KINDS: DeclaredArtifactKind[] = [
  "privacy_policy",
  "tos",
  "xcprivacy",
  "play_data_safety",
];

/**
 * How each kind is spoken about in the talk-back sentence.
 *
 * `subject` completes "whether this product …", and `ask` completes "or …". `--policy` is offered
 * for the two web kinds because it is the only route to a document published outside the tree; for
 * a store manifest there is no such flag, and offering one would be inventing a feature.
 */
const KIND_PROSE: Record<
  DeclaredArtifactKind,
  { label: string; article: string; subject: string; ask: string }
> = {
  privacy_policy: {
    label: "privacy policy",
    article: "a",
    subject: "publishes a privacy policy",
    ask: "point the scan at the document with --policy <path-or-url>",
  },
  tos: {
    label: "terms-of-service",
    article: "a",
    subject: "publishes terms of service",
    ask: "point the scan at the document with --policy <path-or-url>",
  },
  xcprivacy: {
    label: "Apple privacy manifest",
    article: "an",
    subject: "ships an Apple privacy manifest (PrivacyInfo.xcprivacy)",
    ask: "point the scan at a tree that contains the manifest",
  },
  play_data_safety: {
    label: "Play data-safety export",
    article: "a",
    subject: "has filed a Play data-safety form",
    ask: "point the scan at a tree that contains the export",
  },
};

/**
 * What recognises each store manifest, stated per kind because the two are not equally strong.
 *
 * Typed over the two store kinds alone, so the note below cannot reach for a value that is not
 * there. The asymmetry is real and is written into the note the entry carries: Apple's extension
 * names this file and nothing else, while the Play side rests on the Console's filing convention.
 */
const STORE_IDENTIFICATION: Record<"xcprivacy" | "play_data_safety", string> = {
  xcprivacy:
    "Apple's own .xcprivacy extension, which names this file and nothing else, and the plist inside it is parsed in full",
  play_data_safety:
    "the Play Console's own filing convention — a CSV under a data-safety name — which is a weaker signal than Apple's extension, and the rows inside are carried uninterpreted because the format is not documented in a form this repository has verified",
};

/**
 * The word a declaration glob is built around: `**\/*{-,_,.}regulamin*` -> `regulamin`.
 *
 * Derived from `DECLARATION_GLOBS` rather than written out beside it, so a glob added to
 * `discover.ts` cannot land in a name family by accident and cannot be forgotten either — an
 * unrecognised word simply carries no kind signal, and `DECLARATION_GLOBS_WITHOUT_NAME_SHAPE` below
 * says which those are. Keeping a hand-copied list of globs here is the defect class this
 * repository has recorded twice (the walker's extension set copied into `clause-cover`, the
 * census-category enum copied into `test-reconcile`).
 */
function globWord(glob: string): string {
  return glob
    .replace(/^\*\*\//, "")
    .replace(/^\*\{[^}]*\}/, "")
    .replace(/\*/g, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

/**
 * A path, folded so that a title token can be looked for in it however it was written.
 *
 * Accents are decomposed and dropped and every separator is removed, so `Polityka_Prywatności`,
 * `polityka-prywatnosci` and `PolitykaPrywatnosci/page.tsx` all fold to one string a token can be
 * found in. This is the same reading `DECLARATION_GLOBS` already takes of real slugs — a compound
 * legal-page name is separator-joined — with the separators taken out instead of enumerated.
 */
function foldPath(path: string): string {
  return path
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * The same fold with the WORD BOUNDARIES kept: `PrivacyAndTerms/page.tsx` -> `privacy`, `and`,
 * `terms`, `page`, `tsx`. Separators split, and so does a camelCase hump, because a router directory
 * is where the two conventions meet.
 *
 * **Why a second reading of the same name exists, rather than one loosened one** (defect D10,
 * 2026-09-01). The collapsed fold above needs long tokens: with every separator removed, a short one
 * matches inside ordinary words, which is what `"nda"` did inside `standards/`, and
 * `MIN_TITLE_TOKEN` is the guard that keeps it from happening again. But that guard also kept the
 * word `terms` — five characters, and the primary English name of one of the two kinds — out of the
 * terms vocabulary, so `privacy-and-terms.md` was read as a privacy document only while its mirror
 * `terms-and-privacy.md` was read as both. **The guard exists to stop substring accidents, not to
 * blind a kind to its own primary word**, so the short words are matched here instead, where a
 * boundary is required and a substring cannot collide: `xterms` is not `terms`.
 */
function foldTokens(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * The boundary tokens of the document's OWN name — the basename without its extension, and the
 * directory that names it where the basename does not.
 *
 * **Bounded to the name, not the path** (defect D12, 2026-09-01). Read over the whole path, the
 * boundary route counted a DIRECTORY as the document's vocabulary: `docs/terms/privacy.md` came
 * back as a candidate for both kinds because it sits in a `terms/` folder, which says where the
 * file is filed and not what it is.
 *
 * **The asymmetry with the long-token route is deliberate.** Those tokens keep reading the whole
 * path, because a directory IS how the glob families already read a name — `discover.ts` tests a
 * router file under its directory's path, and `**\/legal/*` is a directory pattern outright — so
 * withdrawing the full path there would narrow what discovery itself already decided. The boundary
 * route is the new one and it is the one that carries short words, so it is the one that has to be
 * conservative about where it looks.
 *
 * **The directory is consulted when, and only when, the basename names no kind at all.** That is
 * exactly the router case: `PrivacyAndTerms/page.tsx` is one document whose name is its directory,
 * and `discover.ts` (`identityPaths`, `siblingRoot`) already reads it that way. Deriving the
 * condition — "the basename says nothing" — rather than copying that module's list of role
 * basenames keeps this file from holding a second copy of a constant it does not own. Checked
 * against the cases that must not move: `api/terms/index.md` stays terms-only (its basename says
 * nothing, its directory says terms, and terms is what its glob already said), and
 * `docs/terms/privacy.md` becomes privacy-only, which is the defect.
 *
 * ONE RESIDUE, RECORDED RATHER THAN FIXED: a long token still reads the whole path, so
 * `docs/privacy/terms.md` is a candidate for both kinds while `docs/terms/privacy.md` is a candidate
 * for one. The two routes read different amounts of the path by design, and the asymmetry follows
 * from that; both directions stay visible in the evidence line either way.
 */
function identityTokens(path: string): string[] {
  const segments = path.replace(/\\/g, "/").split("/").filter(Boolean);
  const base = segments.pop() ?? "";
  const own = foldTokens(base.replace(/\.[^.]+$/, ""));
  if (own.some(namesEitherKind)) return own;
  const parent = segments.pop();
  return parent ? [...own, ...foldTokens(parent)] : own;
}

/**
 * Tokens that mark a path as being about privacy or data protection, and tokens that mark one as
 * being about terms, in the languages `DECLARATION_GLOBS` covers.
 *
 * **NEITHER DIRECTION IS FREE, AND AN EARLIER VERSION OF THIS COMMENT CLAIMED ONE WAS.** It said
 * these tokens "never attribute a kind, they only ever take one away", so a missing token could
 * "never cost a question silenced". Both halves were wrong, and the second was wrong in the way this
 * whole block exists to prevent (defect D8, 2026-09-01):
 *
 * - A token that is MISSING leaves an attribution standing that the name does not settle. With the
 *   answer `true` that prints `consistent`, and the question is silenced — the D1 mechanism exactly.
 * - A token that is too BROAD takes an attribution away. With the answer `false` that also prints
 *   `consistent`, and the `observed-but-not-declared` question is silenced instead. Measured: with
 *   the other kind's vocabulary used as a disqualifier, `terms-and-privacy.md` beside `tos: false`
 *   went silent, where before the qualifier stage existed it had asked.
 *
 * There is no setting of these lists that cannot silence something, so the rule is chosen rather
 * than assumed: **a name that carries BOTH kinds' vocabulary is a candidate for BOTH** — the one
 * arrangement that leaves a question standing whichever field is answered NO — with both answered
 * yes nothing is asked, which is correct and is not what this clause is about. A name that
 * carries a THIRD kind's standing title (`accord de confidentialité`, an NDA) is a candidate for
 * neither, and stays visible in the entry's `document-kind-not-derivable` line.
 *
 * Written folded (`foldPath`) and LONG — at least `MIN_TITLE_TOKEN` characters, checked by the gate
 * rather than left to an author's eye. That guard was stated here before it was enforced, and a
 * three-character token slipped in under it: `"nda"` matched inside `sta`**`nda`**`rds`, so
 * `docs/standards/politique-de-confidentialite.md` lost its attribution for the name of its
 * directory (defect D7, 2026-09-01).
 */
const MIN_TITLE_TOKEN = 6;

const PRIVACY_TITLE_TOKENS = [
  "privacy", "privacidad", "privatezza", "privaatsus", "privatuma", "privatumo", "prywatno",
  "privatliv", "priobhaideachais", "datenschutz", "confidentialite",
  "danychosobowych", "daneosobowe", "ochronydanych",
  "osobnichudaj", "osobnychudaj", "soukromi", "sukromi",
  "osobnipodaci", "osebnipodatki",
  "personuppgift", "integritet", "persondata", "personoplysninger",
  "henkilotiedot", "tietosuoja", "adatvedelmi", "adatkezelesi",
  "isikuandmed", "andmekaitse", "personasdati", "datuaizsardziba",
  "asmensduomenys", "duomenuapsauga", "persoonsgegevens", "privacybeleid",
  "dadospessoais", "datipersonali", "donneespersonnelles", "datospersonales",
  "datepersonale", "szemelyesadatok", "sonraipearsanta", "cosaintsonrai", "dejtapersonali",
];

const TERMS_TITLE_TOKENS = [
  "termsofservice", "termsofuse", "termsandconditions", "termsconditions",
  "regulamin", "voorwaarden", "nutzungsbedingungen", "geschaftsbedingungen",
  "conditionsgenerales", "conditionsdutilisation", "conditionsutilisation",
  "condicionesgenerales", "condicionesdeuso", "condizionigenerali", "condizionidiuso",
  "podminky", "podmienky", "pogojiuporabe", "uvjetikoristenja", "termenisiconditii",
  "felhasznalasifeltetelek", "szerzodesifeltetelek", "kasutustingimused",
  "lietosanasnoteikumi", "naudojimosalygos", "allmannavillkor", "anvandarvillkor",
  "handelsbetingelser", "kayttoehdot", "obchodnipodminky", "obchodnepodmienky",
  "termosdeuso", "termosdeservico", "tearmaiusaide", "terminitaluzu",
];

/**
 * Standing titles of a THIRD kind of document that carry a family word.
 *
 * A confidentiality undertaking is neither the site's privacy notice nor its terms, so a path
 * carrying one of these is a candidate for neither kind — unlike a path carrying both kinds'
 * vocabulary, which is a candidate for both. Whole phrases as `foldPath` produces them, with the
 * `de`-less spelling beside the ordinary one because both are written.
 */
const NDA_TITLE_TOKENS = [
  "accorddeconfidentialite",
  "accordconfidentialite",
  "engagementdeconfidentialite",
  "engagementconfidentialite",
  "clausedeconfidentialite",
  "nondisclosure",
];

/** Every token these lists and the per-word rules hold, for the length guard the gate enforces. */
export const NAME_TITLE_TOKENS: Readonly<Record<"privacy" | "terms" | "third_kind", readonly string[]>> = {
  privacy: PRIVACY_TITLE_TOKENS,
  terms: TERMS_TITLE_TOKENS,
  third_kind: NDA_TITLE_TOKENS,
};

/** The length every title token must clear, exported so the gate enforces the guard this file states. */
export const MIN_TITLE_TOKEN_LENGTH = MIN_TITLE_TOKEN;

/**
 * What a glob's word says about the kind, and what the document's own path must also say.
 *
 * `requires` — at least one of these must appear in the folded path before the word's OWN kind is
 * claimed. Present only where the word names no kind at all on its own (Polish `polityka`).
 * `not_with` — a standing title of a THIRD kind; where one appears the document is a candidate for
 * neither kind. The OTHER kind's vocabulary is deliberately NOT in this list: it adds that kind
 * rather than removing this one (see `nameShapeKinds`).
 */
interface NameShape {
  kind: "privacy_policy" | "tos";
  requires: string[];
  not_with: string[];
}

/**
 * The two kinds a document's name can be a candidate for.
 *
 * An alias of the schema package's `DocumentNameShapeKind`, which is itself derived from
 * `DeclaredArtifactKind`, rather than a third handwritten copy of the same two words: the schema
 * emits the field, this module computes it, and `discover.ts` carries it, so all three read one
 * definition (never keep a second copy of anything two places must agree on).
 */
export type DocumentKind = DocumentNameShapeKind;

type WordRule = { kind: "privacy_policy" | "tos"; requires?: string[]; also_not_with?: string[] };

/**
 * The glob word of each `DECLARATION_GLOBS` entry that names a kind, re-derived token by token on
 * 2026-09-01 after adversarial verification found the class (defect D1).
 *
 * **The defect.** `polityka` is Polish for *policy*, not for *privacy*: `polityka prywatności` is a
 * privacy policy, `polityka cookies` is a cookie policy. It sat in the privacy family unqualified,
 * so `polityka-cookies.md` beside `privacy_policy: true` produced `consistent` with no question —
 * a cookie policy SILENCING "we did not observe your privacy policy". English `policy` was already
 * excluded for exactly that reason and its Polish cognate was not, which falsified this file's own
 * twice-stated claim that the derivation under-claims and never over-claims. The claim is the
 * requirement; the code now answers to it.
 *
 * **The test each token is held to.** Does the word name a document of this kind in its own
 * language, ON ITS OWN? If it does, it goes in the family bare. If it does not — Polish `polityka`
 * is `policy` — it takes a `requires` and claims its kind only where the name carries the qualifier
 * its language uses. If it names no kind under any qualifier, it belongs in neither family, where
 * `**\/*policy*`, `**\/legal/*`, `**\/imprint*`, `readme*` and the rest already sit. `not_with` is
 * a separate question and a rarer one: it names a THIRD kind's standing title built on a family word
 * (an `accord de confidentialité` is a confidentiality undertaking, neither the notice nor the
 * terms), and a name carrying one is a candidate for neither kind.
 *
 * **A standing title of the OTHER kind built on this word does NOT disqualify it** — corrected
 * 2026-09-01 (defect D8), and this header stated the superseded rule for a round after the code
 * stopped following it. `Podmínky ochrany osobních údajů` is a Czech PRIVACY notice built on the
 * terms word, and treating such a name as settling nothing silenced the `observed-but-not-declared`
 * question. Those names are candidates for BOTH kinds; `nameShapeKinds` is where that is decided and
 * why, and it is the single statement of record for this whole derivation.
 *
 * **Neither direction of an error here is free**, and an earlier version of this header claimed one
 * was ("under-claiming is the direction this table is allowed to be wrong in … over-claiming is the
 * one that silences"). Both silence something: claiming a kind the name does not settle silences
 * `declared-but-not-observed` on an answer of yes, and withholding one the name does settle silences
 * `observed-but-not-declared` on an answer of no. What holds in both directions is only this — a
 * document that reaches no family is still discovered, still listed in `discovery.found[]`, still
 * counted in the entry's `document-kind-not-derivable` line, and the put_back still says how many
 * documents were found.
 */
const NAME_WORDS: Record<string, WordRule> = {
  /* ---- privacy ---- */
  // en. `privacy*` names the notice; no other legal document in a tree is called that.
  privacy: { kind: "privacy_policy" },
  // pl. THE D1 TOKEN. "polityka" alone is "policy" and names no kind, so it requires the
  // qualifier the Polish title actually carries: prywatności / ochrony danych / danych osobowych.
  // `polityka-cookies` and `polityka-zwrotow` now reach no family, which is the correct answer.
  polityka: { kind: "privacy_policy", requires: ["prywatno", "danychosobowych", "daneosobowe", "ochronydanych"] },
  // fr. "confidentialité" names the privacy notice (politique de confidentialité), but an NDA is an
  // *accord* / *engagement de confidentialité* — a legal document of a third kind. Disqualified on
  // the WHOLE FOLDED PHRASE, never on a fragment: written as the bare `"nda"` this matched inside
  // `standards/` and cost a real French privacy policy its attribution for the name of its
  // directory (defect D7, 2026-09-01). Each spelling below is what `foldPath` produces from the
  // real title, and each clears MIN_TITLE_TOKEN.
  confidentialite: { kind: "privacy_policy", also_not_with: NDA_TITLE_TOKENS },
  "confidentialité": { kind: "privacy_policy", also_not_with: NDA_TITLE_TOKENS },
  // es. "privacidad" is privacy; the Spanish NDA is *confidencialidad*, a different word.
  privacidad: { kind: "privacy_policy" },
  // nl / sv / da / da. Each is a closed compound naming the notice itself.
  privacyverklaring: { kind: "privacy_policy" },
  integritetspolicy: { kind: "privacy_policy" },
  persondatapolitik: { kind: "privacy_policy" },
  privatlivspolitik: { kind: "privacy_policy" },
  // fi. "tietosuoja" is data protection; tietosuojaseloste / tietosuojakäytäntö are the notice.
  tietosuoja: { kind: "privacy_policy" },
  // hu. adatvédelmi / adatkezelési tájékoztató are both standing titles for the notice.
  adatvedelmi: { kind: "privacy_policy" },
  "adatvédelmi": { kind: "privacy_policy" },
  adatkezelesi: { kind: "privacy_policy" },
  "adatkezelési": { kind: "privacy_policy" },
  // et / de / mt / ga. Closed compounds or fixed titles; none names a document of another kind.
  privaatsuspoliitika: { kind: "privacy_policy" },
  datenschutzerklarung: { kind: "privacy_policy" },
  "datenschutzerklärung": { kind: "privacy_policy" },
  privatezza: { kind: "privacy_policy" },
  priobhaideachais: { kind: "privacy_policy" },
  "príobháideachais": { kind: "privacy_policy" },

  /* ---- terms ---- */
  // en. `terms*` names the terms. It is also the shortest primary word either kind has (five
  // characters), which is why the other-kind test reads this table at WORD BOUNDARIES as well as
  // reading the title lists as substrings: kept out of the substring list by MIN_TITLE_TOKEN, it
  // left `privacy-and-terms.md` read as a privacy document only while `terms-and-privacy.md` was
  // read as both (defect D10, 2026-09-01). That boundary read is bounded to the document's own name
  // rather than its path, so a `terms/` directory does not make every file inside it a terms
  // candidate (defect D12) — see `identityTokens`.
  terms: { kind: "tos" },
  // pl. "regulamin" is the standing title for terms. A *regulamin ochrony danych osobowych* is a
  // privacy document built on that word, and it carries the privacy vocabulary too, so it is a
  // candidate for BOTH kinds — not disqualified from this one, which is what this comment claimed
  // until the D8 correction.
  regulamin: { kind: "tos" },
  // fr. Each spelling is an explicit "conditions … d'utilisation / générales" compound.
  "conditions-generales": { kind: "tos" },
  "conditions-générales": { kind: "tos" },
  "conditions-utilisation": { kind: "tos" },
  "conditions-dutilisation": { kind: "tos" },
  "conditions-d-utilisation": { kind: "tos" },
  // es / it. "condiciones de privacidad" and "condizioni di privacy" both exist in the wild; those
  // names carry the privacy vocabulary too, so they are candidates for both kinds (see
  // `nameShapeKinds`), which is what keeps a question standing on either field answered "no".
  condiciones: { kind: "tos" },
  condizioni: { kind: "tos" },
  // it / mt. "termini e condizioni", "termini tal-użu".
  termini: { kind: "tos" },
  // nl. "algemene voorwaarden"; a "privacy-voorwaarden" page carries both vocabularies and is a
  // candidate for both kinds.
  voorwaarden: { kind: "tos" },
  // pt / sv / da / fi.
  termos: { kind: "tos" },
  villkor: { kind: "tos" },
  betingelser: { kind: "tos" },
  kayttoehdot: { kind: "tos" },
  "käyttöehdot": { kind: "tos" },
  // cs / sk. VERIFIED AGAINST THE D1 CLASS: "podmínky" is conditions, and *Podmínky ochrany
  // osobních údajů* is a standing Czech title for a PRIVACY notice. It keeps the family — the word
  // does name the terms kind — and that title also carries the privacy vocabulary (osobnichudaj,
  // soukromi, and the Slovak pair), so it is a candidate for both kinds rather than for neither.
  podminky: { kind: "tos" },
  "podmínky": { kind: "tos" },
  podmienky: { kind: "tos" },
  // sl / hr / ro / hu.
  pogoji: { kind: "tos" },
  uvjeti: { kind: "tos" },
  termeni: { kind: "tos" },
  feltetelek: { kind: "tos" },
  "feltételek": { kind: "tos" },
  // et.
  tingimused: { kind: "tos" },
  // lv. VERIFIED AGAINST THE D1 CLASS: "noteikumi" is rules, and *privātuma noteikumi* is the
  // privacy policy while *lietošanas noteikumi* is the terms. Kept, because a bare `noteikumi` page
  // is the site's terms; the privacy title carries the privacy vocabulary (privatuma,
  // datuaizsardziba) and is therefore a candidate for both kinds.
  noteikumi: { kind: "tos" },
  // lt / ga.
  salygos: { kind: "tos" },
  "sąlygos": { kind: "tos" },
  tearmai: { kind: "tos" },
  "tearmaí": { kind: "tos" },
  "téarmaí": { kind: "tos" },
  // et / de / lv, closed compounds that name the terms and nothing else.
  kasutustingimused: { kind: "tos" },
  nutzungsbedingungen: { kind: "tos" },
  geschaftsbedingungen: { kind: "tos" },
  "geschäftsbedingungen": { kind: "tos" },
  "lietosanas-noteikumi": { kind: "tos" },
  "lietošanas-noteikumi": { kind: "tos" },
};

/**
 * The words of `NAME_WORDS` themselves, per kind, folded and kept as WHOLE WORDS.
 *
 * The second half of the other-kind test, and the half that carries the short primary words the
 * substring lists cannot hold (defect D10, 2026-09-01). Derived from the same table the families
 * are, so a word added there is a word both routes know about — there is no second list to drift.
 *
 * Multi-part words (`conditions-generales`) are dropped: they cannot equal a single boundary token,
 * and their long collapsed spellings are already in the title lists.
 */
const NAME_WORD_VOCABULARY: Record<DocumentKind, Set<string>> = (() => {
  const out: Record<DocumentKind, Set<string>> = { privacy_policy: new Set(), tos: new Set() };
  for (const [word, rule] of Object.entries(NAME_WORDS)) {
    // A word that names its kind only with a qualifier does not name it here either: `polityka`
    // alone is `policy`, and letting it stand as vocabulary would put D1 back through this door.
    if (rule.requires && rule.requires.length > 0) continue;
    const folded = foldTokens(word);
    if (folded.length === 1) out[rule.kind].add(folded[0]);
  }
  return out;
})();

/** Does this boundary token name either kind on its own? Used to decide whether a basename speaks. */
function namesEitherKind(token: string): boolean {
  return NAME_WORD_VOCABULARY.privacy_policy.has(token) || NAME_WORD_VOCABULARY.tos.has(token);
}

/**
 * Which kind a matched glob is a NAME SHAPE for, and what the path must also say.
 * Absent means the glob is a name shape for neither kind.
 */
export const DECLARATION_GLOB_NAME_SHAPE: ReadonlyMap<string, NameShape> = new Map(
  DECLARATION_GLOBS.flatMap((glob): [string, NameShape][] => {
    const rule = NAME_WORDS[globWord(glob)];
    if (!rule) return [];
    return [[glob, { kind: rule.kind, requires: rule.requires ?? [], not_with: [...(rule.also_not_with ?? [])] }]];
  }),
);

/** The globs that carry no kind signal, exported so a gate can count them rather than assume them. */
export const DECLARATION_GLOBS_WITHOUT_NAME_SHAPE: string[] = DECLARATION_GLOBS.filter(
  (g) => !DECLARATION_GLOB_NAME_SHAPE.has(g),
);

/**
 * Which kinds this document's NAME makes it a candidate for, and how it got there.
 *
 * The whole per-kind derivation, in one function, so a gate can exercise the decision directly
 * rather than only through a whole run — and so there is one place to read it rather than a rule
 * spread across a table and a loop. It reads the document's name and nothing else, and its answer
 * is a CANDIDATE, never an identification: discovery classifies nothing and neither does this.
 *
 * Four outcomes:
 *
 * - **the glob's own kind** — its word names that kind and any `requires` the word needs is in the
 *   path (`docs/terms.md`, `polityka-prywatnosci.md`).
 * - **both kinds** — the name also carries the other kind's vocabulary (`terms-and-privacy.md`,
 *   `Podmínky ochrany osobních údajů`). **Both, never neither**: whichever field is answered NO, a
 *   question stays standing — with both answered yes nothing is asked, which is the correct output
 *   and not what this rule is for. Treating such a name as settling nothing silenced the
 *   `observed-but-not-declared` side (defect D8, 2026-09-01); the loose form of this sentence,
 *   which said a question stood whichever way either field was answered, is corrected here (D11).
 * - **the other kind only** — the word's own `requires` is unmet while the other kind's vocabulary
 *   is present, which is what a `polityka-regulamin` shaped name says.
 * - **neither** — a `requires` unmet with nothing else in the name, or a third kind's standing title
 *   (an NDA). Both stay visible in the entry's `document-kind-not-derivable` line.
 */
export function nameShapeKinds(
  path: string,
  glob: string | undefined,
): { kinds: DocumentKind[]; reason: string } {
  if (!glob) return { kinds: [], reason: "no-glob" };
  const shape = DECLARATION_GLOB_NAME_SHAPE.get(glob);
  if (!shape) return { kinds: [], reason: "glob-names-no-kind" };
  const folded = foldPath(path);
  if (shape.not_with.some((t) => folded.includes(t))) return { kinds: [], reason: "third-kind-title" };

  const other: DocumentKind = shape.kind === "privacy_policy" ? "tos" : "privacy_policy";
  const otherTokens = shape.kind === "privacy_policy" ? TERMS_TITLE_TOKENS : PRIVACY_TITLE_TOKENS;
  const ownMet = shape.requires.length === 0 || shape.requires.some((t) => folded.includes(t));
  // Two readings of the same name, for the reason `foldTokens` states: the title lists are long
  // tokens matched as substrings over the whole path, and the family words are matched at word
  // boundaries over the document's OWN name — so the short ones (`terms`, five characters) can be
  // read without lowering the guard that keeps `nda` out of `standards`, and without a `terms/`
  // directory turning every file inside it into a terms candidate (defect D12).
  const tokens = identityTokens(path);
  const otherPresent =
    otherTokens.some((t) => folded.includes(t)) ||
    tokens.some((t) => NAME_WORD_VOCABULARY[other].has(t));

  const kinds: DocumentKind[] = [];
  if (ownMet) kinds.push(shape.kind);
  if (otherPresent) kinds.push(other);
  const reason =
    kinds.length === 2
      ? "both-kinds-in-the-name"
      : kinds.length === 0
        ? "qualifier-unmet"
        : ownMet
          ? "glob-word"
          : "other-kind-vocabulary";
  return { kinds, reason };
}

/**
 * Every discovered document, with the kinds its own NAME makes it a candidate for.
 *
 * **Why this exists** (a gap found in one real run, 2026-09-02). The kind derivation above was reachable
 * only from `matched_glob` — the glob a document was FOUND BY — so a document the content pass found
 * carried no kind signal even when its name says exactly what it is. That tree's real Terms and Privacy
 * Policy for its paid hosted tier are two route files named `terms.ts` and `privacy.ts`;
 * the name passes never tested them because `ts` was not one of the extensions those passes then
 * considered, the content pass found both correctly, and they arrived indistinguishable from 108
 * translation catalogues in a 165-line listing. The run's orchestrator read that listing in full,
 * skimmed past both, and told six of seven subagents that the repository contained no
 * terms-of-service document at all. (The extension restriction itself was removed on 2026-09-02, so
 * those two are now found BY NAME. This function still decides the kind for every document another
 * pass reaches — an explicitly supplied path, a sibling, a content match — and for those it is the
 * only route to a kind at all.)
 *
 * `discover.ts` records each document's own `name_shape_glob` whatever route reached it; this
 * function turns that into the kinds, so the console and any consumer of the JSON can put the
 * documents most likely to decide the run at the top of the list. **It is a statement about the
 * name.** Nothing here identifies a document, changes which documents were found, or moves a
 * `declared_artifacts_reconciliation` count — `observeDocumentKind` still reads `matched_glob` and
 * only `matched_glob`, because that entry is about what discovery observed and not about what a name
 * suggests.
 */
export function withNameShapeKinds(found: DiscoveredDoc[]): DiscoveredDoc[] {
  return found.map((doc) => {
    if (doc.kind !== "file") return doc;
    const { kinds } = nameShapeKinds(doc.path, doc.matched_glob ?? doc.name_shape_glob);
    return kinds.length > 0 ? { ...doc, name_shape_kinds: kinds } : doc;
  });
}

/** Everything the four entries are computed from. Pure: no filesystem, no clock, no randomness. */
export interface DeclaredArtifactsObservation {
  profile: ScanProfile | null;
  discovery: DiscoveryResult;
  /**
   * The extracted text of every document this run read, where the caller has it.
   *
   * **Read for one thing only: whether a document this entry is about to name is a shell** (a gap
   * found in one real run, 2026-09-02). That run's `put_back` asked a person to confirm that a
   * 14-character Angular route wrapper was their privacy policy while the same run's own
   * thin-document warning was calling the same file a shell — two parts of one tool disagreeing
   * inside one document about whether that file is a usable signal. The threshold is the one
   * `documentShapeWarnings` already uses, imported from there rather than restated, so the console
   * warning and this sentence can never come to hold different ideas of "thin".
   *
   * Optional: a caller that has no extraction step passes nothing and the clause is simply absent.
   */
  documents?: { doc_path: string; lines: { text: string }[] }[];
  storeDeclarations: StoreDeclaration[];
  storeUnreadable: string[];
  storeExcluded: { file: string; reason: string }[];
  filesWalked: number;
  /**
   * What the W5 load step replaced at `/declared_artifacts`, in the form the file held it in, where
   * it replaced anything there. Optional: a caller that built its own profile object never went
   * through that step and passes nothing, and `readDeclared`'s own check still answers for it.
   */
  downgradedDeclaredArtifacts?: unknown;
}

/**
 * What the person answered, and — where that is nothing — which of the five silences it was.
 *
 * `downgradedDeclaredArtifacts` is what the W5 load step replaced at `/declared_artifacts`, in the
 * form the file held it in, or `undefined` where it replaced nothing there. **It exists because a
 * downgrade must not turn one silence into another one.** The load step nulls a
 * `declared_artifacts` that is not an object, exactly as it nulls any other rejected field; without
 * this parameter the null then falls into the branch below and the sentence put to the person reads
 * *"the profile carries no declared_artifacts object, so nobody was asked"* — untrue of a file that
 * carries one, and the one place in this change where a person's own answer was replaced by a denial
 * that they gave one. (Defect D2 of the independent check of 2026-09-02.) The reason is carried
 * through rather than re-derived, and the value with it, so the talk-back sentence quotes what they
 * wrote.
 */
function readDeclared(
  profile: ScanProfile | null,
  kind: DeclaredArtifactKind,
  downgradedDeclaredArtifacts?: unknown,
): { declared: boolean | null; reason: DeclaredArtifactAbsentReason | null; raw?: unknown } {
  if (profile === null || profile === undefined) return { declared: null, reason: "no-profile" };
  const block = profile.declared_artifacts;
  if (block === null || block === undefined) {
    // The load step replaced something here, and what it replaced was not itself an absence: the
    // person wrote a `declared_artifacts` and it was not an object of answers. That is the fourth
    // silence, not the second, and it names the value.
    if (downgradedDeclaredArtifacts !== undefined && downgradedDeclaredArtifacts !== null) {
      return { declared: null, reason: "declared-artifacts-not-an-object", raw: downgradedDeclaredArtifacts };
    }
    return { declared: null, reason: "no-declared-artifacts-object" };
  }
  // A `declared_artifacts` that is a string, a number or an array reaches this code for the same
  // reason a non-boolean field does, and `in` throws a TypeError on a primitive, which would end the
  // whole run over a typo in one line of JSON. It is recorded and the run continues: a malformed
  // answer must never stop a scan or narrow one.
  //
  // Written on 2026-09-01 because nothing validated a profile at runtime. Something does from
  // 2026-09-02 (W5), and this check is KEPT: `buildReconcileInput` is not the only caller — this
  // function is reachable with a profile object a caller built itself and never took through
  // `loadScanProfile` — and its five reasons are a published contract. Defence in depth, not a
  // duplicate. On the `--profile` path the load step reaches this shape first and the branch above
  // renders the same reason from what it carried through, so the value is quoted either way.
  if (typeof block !== "object" || Array.isArray(block)) {
    return { declared: null, reason: "declared-artifacts-not-an-object", raw: block };
  }
  if (!(kind in block)) return { declared: null, reason: "field-not-answered" };
  const raw = (block as Record<string, unknown>)[kind];
  if (typeof raw === "boolean") return { declared: raw, reason: null };
  // A value that is neither true nor false is not an answer, and reading it as `false` would be the
  // worse half of guessing. Reachable on any path: a caller that built the profile itself, and the
  // `--profile` path, where such a value is reported against the schema and arrives here as `null`.
  return { declared: null, reason: "field-not-a-boolean", raw };
}

/** The clause that names the answer inside the talk-back sentence. */
function answerClause(
  declared: boolean | null,
  reason: DeclaredArtifactAbsentReason | null,
  raw: unknown,
): string {
  if (declared === true) return 'answers "yes"';
  if (declared === false) return 'answers "no"';
  switch (reason) {
    case "no-profile":
      return "is not answered (no --profile was given, so nobody was asked)";
    case "no-declared-artifacts-object":
      return "is not answered (the profile carries no declared_artifacts object, so nobody was asked)";
    case "declared-artifacts-not-an-object":
      return `is not answered (declared_artifacts holds ${JSON.stringify(raw)} rather than an object of answers, so nothing in it is read as an answer; on the --profile path this is reported against scan-profile.schema.json as well, and this run continued rather than stopping)`;
    case "field-not-a-boolean":
      return `is not answered (it holds ${JSON.stringify(raw)}, which is not one of the two answers this field takes, so it is read as unanswered rather than as an answer; on the --profile path the same value is reported against scan-profile.schema.json and the run continues)`;
    default:
      return "is not answered (the declared_artifacts object does not answer it, so nobody was asked)";
  }
}

/**
 * THE STANDARD TALK-BACK SENTENCE (W1, 2026-09-01). One template, used for every entry.
 *
 * Four fills and three fixed clauses: it names the field and the answer, names what this run
 * observed and where in this same file that is recorded, says the scanner settles it in neither
 * direction, and asks. **Never "you said X but actually Y"** — the observation is what this run saw,
 * not what is true. Never an instruction to change the answer. Never a statement about a legal
 * requirement. The wording is pinned in `reconcile-input.schema.json` `$defs`
 * `declaredArtifactReconciliation.put_back` as well, and the two are meant to be read together.
 */
function standardPutBack(parts: {
  field: string;
  answer: string;
  observation: string;
  pointer: string;
  subject: string;
  ask: string;
}): string {
  return (
    `The scan profile field ${parts.field} ${parts.answer}. ` +
    `${parts.observation}. The evidence for that sits in this file's ${parts.pointer}. ` +
    `The scanner settles this in neither direction and never answers for the person: whether this product ${parts.subject} is a fact about the product, asked of the person running the scan and never inferred from the source. ` +
    `Please answer or confirm ${parts.field}, or ${parts.ask}.`
  );
}

/**
 * Up to three paths, named in the ask so the person can act on the sentence without opening the
 * JSON. Capped rather than complete: the complete list is `discovery.found[]` and the evidence
 * array, both of which the same sentence points at, and a talk-back sentence carrying forty paths
 * is one nobody reads.
 */
function namePaths(paths: string[]): string {
  const shown = paths.slice(0, 3).join(", ");
  return paths.length > 3 ? `${shown} and ${paths.length - 3} more` : shown;
}

/** The store half: evidence, the count that may be called observed, and the observation clause. */
function observeStoreKind(
  kind: "xcprivacy" | "play_data_safety",
  input: DeclaredArtifactsObservation,
): { evidence: DeclaredArtifactEvidence[]; observed: number; clause: () => string; ask: () => string; note: string } {
  const format = kind === "xcprivacy" ? "apple-xcprivacy" : "play-data-safety-csv";
  const isKindPath = kind === "xcprivacy" ? isXcprivacyPath : isPlayDataSafetyPath;
  const { label, article } = KIND_PROSE[kind];

  const evidence: DeclaredArtifactEvidence[] = [];
  /** Files of this kind that count as observed, named in the ask so the person can confirm one. */
  const observedPaths: string[] = [];
  let parsed = 0;
  let unread = 0;
  let vendored = 0;

  for (const d of input.storeDeclarations) {
    if (d.format !== format) continue;
    if (isVendoredManifest(d.file)) {
      vendored++;
      evidence.push({
        role: "store-manifest-vendored",
        field: "store_declarations[]",
        path: d.file,
        detail: "inside a vendored dependency tree: it declares what that dependency collects, not what this app declares to the store",
      });
      continue;
    }
    parsed++;
    observedPaths.push(d.file);
    evidence.push({ role: "store-manifest-parsed", field: "store_declarations[]", path: d.file });
  }

  // The two lists that say a manifest exists and was not read. Both count as observed — the file is
  // in the tree, and what is unknown is its contents rather than its existence.
  for (const [file, field, detail] of [
    ...input.storeUnreadable.map((f) => [f, "store_declarations_unreadable[]", "looks like a manifest and could not be read"] as const),
    ...input.storeExcluded.map((e) => [e.file, "store_declarations_excluded[]", `the walker did not offer it (${e.reason})`] as const),
  ]) {
    if (!isKindPath(file)) continue;
    if (isVendoredManifest(file)) {
      vendored++;
      evidence.push({
        role: "store-manifest-vendored",
        field,
        path: file,
        detail: `inside a vendored dependency tree, and ${detail}`,
      });
      continue;
    }
    unread++;
    observedPaths.push(file);
    evidence.push({ role: "store-manifest-unread", field, path: file, detail });
  }

  const observed = parsed + unread;
  if (observed === 0 && vendored === 0) {
    evidence.push({
      role: "nothing-observed",
      field: "stats.files_walked",
      detail: `${input.filesWalked} file(s) were walked and none of them was offered to the store-declaration parser as ${article} ${label}; what the walker refused is in excluded_by_walker`,
    });
  }

  const clause = (): string => {
    if (parsed > 0 && unread > 0) {
      return `This run read ${parsed} ${label}(s) and found ${unread} more of that kind it could not read`;
    }
    if (parsed > 0) return `This run read ${parsed} ${label}(s) in the tree`;
    if (unread > 0) return `This run found ${unread} file(s) that look like ${article} ${label} and could not read them`;
    if (vendored > 0) {
      return `This run observed no ${label} of this app's own — the ${vendored} manifest(s) it found sit in vendored dependency trees and declare what those dependencies collect`;
    }
    return `This run observed no ${label} in what was scanned`;
  };

  // Same rule as the document half (defect D2): where this run has a file of the kind in hand, the
  // ask is to say whether it is the one the field is about; only where it has none is the ask to
  // point the scan at a tree that contains one.
  const ask = (): string =>
    observedPaths.length > 0
      ? `say whether ${namePaths(observedPaths)} is the ${label} this field is about`
      : KIND_PROSE[kind].ask;

  const note =
    `${label}s are recognised by ${STORE_IDENTIFICATION[kind]}. That is the store's own convention rather than a name the author chose, which is what makes this side an identification of the KIND — it says nothing about what the file declares. ` +
    `Read: ${parsed} parsed, ${unread} present and unread, ${vendored} inside a vendored dependency tree. ` +
    "A manifest that could not be read is not a missing one, and a vendored dependency's manifest is not this app's own declaration in either direction.";

  return { evidence, observed, clause, ask, note };
}

/**
 * A document whose extracted text is too short to be the document itself.
 *
 * The single statement of this threshold: `documentShapeWarnings` prints the console warning from
 * it and `observeDocumentKind` puts the same fact into the talk-back sentence, so the two halves of
 * the tool cannot come to disagree about whether a file is a shell — which is exactly what they did
 * on 2026-09-02 (a gap found in one real run).
 */
const THIN_DOCUMENT_CHARS = 4000;

/** The document half: candidates by NAME SHAPE only, and the sentence that says so. */
function observeDocumentKind(
  kind: "privacy_policy" | "tos",
  input: DeclaredArtifactsObservation,
): { evidence: DeclaredArtifactEvidence[]; observed: number; clause: () => string; ask: () => string; note: string } {
  const label = KIND_PROSE[kind].label;
  const found = input.discovery.found ?? [];
  const evidence: DeclaredArtifactEvidence[] = [];
  const shapedPaths: string[] = [];
  // Documents the person handed over themselves. They can never acquire a `matched_glob` —
  // `discover.ts` pass 1 skips anything already in `found` — so they are named in the ask rather
  // than asked for again (defect D2, 2026-09-01), and they are named there BESIDE any name shape
  // this run found rather than instead of one (a gap found in one real run, 2026-09-02).
  const supplied = found.filter((d) => d.found_by === "explicit" || d.found_by === "url");
  const suppliedPaths = supplied.map((d) => d.path);

  /** Characters of extracted text per document, for the thin-document clause. */
  const extractedChars = new Map<string, number>();
  for (const doc of input.documents ?? []) {
    extractedChars.set(doc.doc_path, doc.lines.reduce((n, l) => n + l.text.length, 0));
  }
  const thinChars = (path: string): number | null => {
    const chars = extractedChars.get(path);
    return chars !== undefined && chars < THIN_DOCUMENT_CHARS ? chars : null;
  };

  let noGlob = 0;
  let otherKind = 0;
  let kindless = 0;
  let unqualified = 0;

  for (const doc of found) {
    const glob = doc.matched_glob;
    if (!glob) {
      noGlob++;
      continue;
    }
    const { kinds, reason } = nameShapeKinds(doc.path, glob);
    if (kinds.includes(kind)) {
      shapedPaths.push(doc.path);
      // The thin clause, appended rather than substituted: the name shape is still the reason this
      // file is here, and the reader is told in the same breath that this run's own extraction says
      // the text may never have arrived. Suppressing the evidence line on a thin file would be
      // subtraction; saying nothing about the thinness is what let two parts of one tool disagree.
      const thin = thinChars(doc.path);
      const thinClause =
        thin === null
          ? ""
          : `; this run extracted only ${thin} character(s) of text from it, under the ${THIN_DOCUMENT_CHARS}-character mark this same run's document-shape warning uses, so it may be a shell that builds its text in the browser rather than the document itself`;
      evidence.push({
        role: "document-name-shape",
        field: "discovery.found[]",
        path: doc.path,
        detail:
          (reason === "both-kinds-in-the-name"
            ? `matched ${glob} and its name carries both kinds' vocabulary, so it is a candidate for the ${label} AND for the other kind; a name shape is not an identification`
            : reason === "other-kind-vocabulary"
              ? `matched ${glob}, whose word names the other kind, and its name carries ${label} vocabulary; a name shape is not an identification`
              : `matched ${glob}, which is a ${label} name shape; a name shape is not an identification`) + thinClause,
      });
      continue;
    }
    // Counted apart, because they are three different facts. A document the OTHER kind claims is
    // accounted for by that kind's entry; one whose glob names a document of neither kind — an
    // imprint, a cookie policy, a README — is accounted for by nothing at all; and one whose name
    // settles no kind (a Polish `polityka` with no qualifier, an NDA's standing title) is accounted
    // for here and nowhere else.
    if (kinds.length > 0) otherKind++;
    else if (reason === "glob-names-no-kind") kindless++;
    else unqualified++;
  }

  const shaped = shapedPaths.length;

  // The documents the person handed over, as their own evidence rather than as a share of a count.
  //
  // A gap found in one real run, 2026-09-02: the two real declarations that run supplied with
  // `--policy` were visible only inside the undifferentiated "16 document(s) were reached by the
  // sibling, content, explicit or url pass" figure, alongside fourteen translation catalogues. A
  // document a person handed over is not one of sixteen things the pass could not type; it is the
  // thing they answered with, and the ask below has to be able to name it.
  //
  // **It is not counted as observed and it must not be.** Discovery types nothing, and an
  // explicitly supplied document can never acquire a `matched_glob`; treating "they gave us a file"
  // as "we observed a privacy policy" would be the classifier this project discarded on 2026-08-04.
  for (const doc of supplied) {
    const thin = thinChars(doc.path);
    evidence.push({
      role: "document-supplied-explicitly",
      field: "discovery.found[]",
      path: doc.path,
      detail:
        `handed over by the person with --policy (found_by: ${doc.found_by}), so it carries no matched_glob and can never acquire one; ` +
        `it is not counted as an observation of the ${label} kind, because discovery types nothing and the question of which document is which is the person's to answer` +
        (thin === null
          ? ""
          : `. This run extracted only ${thin} character(s) of text from it, under the ${THIN_DOCUMENT_CHARS}-character mark this same run's document-shape warning uses`),
    });
  }

  if (noGlob + otherKind + kindless + unqualified > 0) {
    evidence.push({
      role: "document-kind-not-derivable",
      field: "discovery.found[]",
      detail:
        `${noGlob} document(s) were reached by the sibling, content, explicit or url pass and carry no matched_glob at all` +
        (supplied.length > 0
          ? `, ${supplied.length} of them handed over by the person with --policy (${namePaths(suppliedPaths)}) and listed separately above under document-supplied-explicitly` +
            (supplied.length === noGlob ? " — every one of them" : "")
          : "") +
        `; ${kindless} matched a glob that names a document of neither kind; ${otherKind} carry the other kind's name shape; ` +
        `${unqualified} carry a name that settles no kind at all — a word that names one only with a qualifier the name does not carry (a Polish "polityka" with no "prywatnosci"), or a third kind's standing title (an "accord de confidentialite", which is neither the notice nor the terms). ` +
        "Discovery does not type documents, so this pass says nothing about what any of them is",
    });
  }

  if (shaped === 0) {
    const l = input.discovery.looked_at;
    evidence.push({
      role: "nothing-observed",
      field: "discovery.looked_at",
      detail: l
        ? `${l.files_tested_by_name ?? l.files_walked} file(s) were tested by name against ${l.globs.length} glob(s), whatever their extension, and ${l.content_scan.files_read} file(s) were read for content at a threshold of ${l.content_scan.marker_threshold} marker(s)`
        : "what was searched is recorded in discovery.looked_at",
    });
  }

  const clause = (): string => {
    if (shaped > 0) return `This run found ${shaped} document(s) whose name matches the ${label} name shape`;
    if (found.length > 0) {
      return `This run found no document whose name matches the ${label} name shape, among the ${found.length} declaration-shaped document(s) it did find`;
    }
    return `This run found no declaration document of any shape, so none matches the ${label} name shape`;
  };

  /**
   * The second half of the ask, chosen from what this run actually has (defect D2, 2026-09-01).
   *
   * The fill used to come from the kind alone, which produced two sentences nobody could act on:
   * one asked a person to pass `--policy` for a document they had just passed with `--policy`, and
   * one asked them to point the scan at a document the same sentence had just reported finding.
   * The action offered has to be one that can change the answer.
   *
   * **THE TWO CASES ARE NOT ALTERNATIVES, corrected 2026-09-02 (a gap found in one real run).**
   * Written as an if/else in that order, a name shape found anywhere in the tree hid the document
   * the person had just supplied. That run passed the real privacy policy with `--policy`,
   * discovery separately globbed `…/privacy-policy-page.html` — an Angular route wrapper holding
   * fourteen characters of text — and the sentence asked the person to confirm the wrapper, with no
   * acknowledgement anywhere in it that they had supplied anything at all. Both populations are
   * named where both exist, joined by "or", and a named file this run's own extraction reports as
   * too thin to be the document says so in the same sentence rather than leaving the person to find
   * the contradiction three sections away.
   */
  const ask = (): string => {
    const parts: string[] = [];
    if (shaped > 0) {
      const thin = shapedPaths.filter((p) => thinChars(p) !== null);
      parts.push(
        `say whether ${namePaths(shapedPaths)} is the ${label} this field is about` +
          (thin.length > 0
            ? ` — noting that this run extracted under ${THIN_DOCUMENT_CHARS} characters of text from ${namePaths(thin)}, so what was read there may be a shell rather than the document`
            : ""),
      );
    }
    if (suppliedPaths.length > 0) {
      parts.push(
        `say whether the document already supplied with --policy (${namePaths(suppliedPaths)}) is the one this field is about`,
      );
    }
    if (parts.length === 0) return KIND_PROSE[kind].ask;
    return parts.join(", or ");
  };

  const note =
    `Discovery found ${found.length} declaration-shaped document(s); ${shaped} document(s) match the ${label} name shape; ` +
    `${suppliedPaths.length} document(s) were handed over by the person with --policy and are named in the ask beside any name shape rather than instead of one. ` +
    "shape-match is not identification — discovery classifies nothing, and the sibling, content, explicit and url passes carry no glob at all. " +
    "Which document is which is a question for the person, and the put_back asks it.";

  return { evidence, observed: shaped, clause, ask, note };
}

/**
 * The four entries. Deterministic, and ADD-shaped: it reads what the rest of the pipeline already
 * produced and removes nothing from it.
 */
export function reconcileDeclaredArtifacts(
  input: DeclaredArtifactsObservation,
): DeclaredArtifactReconciliation[] {
  return DECLARED_ARTIFACT_KINDS.map((kind) => {
    const profile_field = `declared_artifacts.${kind}`;
    const { declared, reason, raw } = readDeclared(input.profile, kind, input.downgradedDeclaredArtifacts);
    const store = kind === "xcprivacy" || kind === "play_data_safety";
    const seen = store
      ? observeStoreKind(kind as "xcprivacy" | "play_data_safety", input)
      : observeDocumentKind(kind as "privacy_policy" | "tos", input);

    const status =
      declared === null
        ? "unanswered"
        : declared && seen.observed === 0
          ? "declared-but-not-observed"
          : !declared && seen.observed > 0
            ? "observed-but-not-declared"
            : "consistent";

    // Pointers, in the order they appear, deduplicated: the sentence names where a reader checks
    // this, and every name is a field of this same file rather than a copy of its contents.
    const fields = [...new Set(seen.evidence.map((e) => e.field))].join(" and ");

    return {
      kind,
      profile_field,
      declared,
      declared_absent_reason: reason,
      observation: {
        basis: store ? ("store-manifest-format" as const) : ("document-name-shape" as const),
        observed: seen.observed,
        evidence: seen.evidence,
        note: seen.note,
      },
      status,
      put_back:
        status === "consistent"
          ? null
          : standardPutBack({
              field: profile_field,
              answer: answerClause(declared, reason, raw),
              observation: seen.clause(),
              pointer: fields,
              subject: KIND_PROSE[kind].subject,
              ask: seen.ask(),
            }),
    };
  });
}

export async function buildReconcileInput(opts: ReconcileOptions): Promise<ReconcileInput> {
  const targetRoot = opts.targetRoot;

  // Read before the walk, so a profile problem is named before anything else this command prints
  // rather than producing a report that silently says nobody was asked.
  //
  // W5, 2026-09-02: this was `JSON.parse(readFileSync(...)) as ScanProfile`, the same unchecked cast
  // `scan.ts` carried, and the two are now one shared step. A malformed profile no longer ends the
  // run either: the violations are printed and the run continues with each violating field treated
  // as unanswered, which is the direction `readDeclared` below already took for one field family and
  // this generalises to the whole profile. See profile.ts.
  const loaded = opts.profilePath ? loadScanProfile(opts.profilePath) : null;
  if (loaded && loaded.report !== "") console.log(loaded.report);
  const profile: ScanProfile | null = loaded ? loaded.profile : null;

  // `alwaysReport` is what makes a refused store manifest visible. The walker's `excluded` summary
  // caps examples at three per directory and never enumerates generated trees, so a manifest under
  // `node_modules/` or a binary plist inside a `.framework` could be refused and appear nowhere at
  // all — neither parsed, nor unreadable, nor excluded.
  //
  // **A second predicate from 2026-09-02**: a file whose own NAME is a declaration's name. Once the
  // name passes stopped consulting a file's extension, the only files whose names say "declaration"
  // and which discovery never sees are the ones the walker refused before handing anything over —
  // and the commonest legal document this tool cannot read is a `privacy.pdf`. The same capped
  // summary hides them for the same reason. Asked through `discover.ts`'s own glob set rather than a
  // second list of patterns here; the sweep this widens was already running for the store manifests.
  const declarationNamed = (p: string): boolean => nameShapeGlobFor(p) !== null;
  const walked = opts.files
    ? { files: opts.files, skipped: 0, excluded: [] as WalkerExclusion[], refused: [] as { path: string; reason: string }[] }
    : walkTarget(targetRoot, {
        includeNonProduction: true,
        alwaysReport: (p) => looksLikeStoreDeclaration(p) || declarationNamed(p),
      });

  // One read cache shared by discovery, the census and extraction. A large repository is walked
  // once and every file is opened at most once. A path is read under the target unless it is
  // absolute, which only a `--policy` path outside the target is (below): that one is read as the
  // absolute path it is.
  const cache = new Map<string, string | null>();
  const readFile = (path: string): string | null => {
    if (cache.has(path)) return cache.get(path)!;
    let content: string | null = null;
    try {
      content = readSourceText(isAbsolute(path) ? path : joinPath(targetRoot, path));
    } catch {
      content = null;
    }
    cache.set(path, content);
    return content;
  };

  // `--policy` values split four ways. A URL is fetched. An absolute path inside the target is made
  // relative, so it joins with the walked paths. An absolute path outside the target is kept as
  // given and read as the absolute path it is. A relative path is taken from the working directory
  // when that lands inside the target (so `--target repo --policy repo/PRIVACY.md` works from the
  // parent directory), and otherwise under the target.
  //
  // **Until 2026-09-24 an absolute path outside the target was never read.** It was kept as given here
  // but read by `joinPath(targetRoot, …)` like every other path, and joining puts "/x/PRIVACY.md"
  // under the target: `--policy /PRIVACY.md` read <target>/PRIVACY.md, and an existing file elsewhere
  // was reported "unreadable" — although the declaration-reconcile SKILL documents `--policy` as "a
  // repository path, an absolute path or a URL", and this module's own option says the same. Now
  // `/PRIVACY.md` is the filesystem's /PRIVACY.md; the target's is `--policy PRIVACY.md`.
  const urlPolicies: string[] = [];
  const pathPolicies: string[] = [];
  for (const p of opts.policies ?? []) {
    if (isUrl(p)) urlPolicies.push(p);
    else {
      const abs = resolve(p);
      const rel = relativePath(targetRoot, abs).replace(/\\/g, "/");
      pathPolicies.push(rel.startsWith("..") ? p.replace(/\\/g, "/") : rel);
    }
  }

  const fetched = new Map<string, { content: string; fetchedAt: string }>();
  const fetchFailures: { url: string; error: string }[] = [];
  for (const url of urlPolicies) {
    const result = await fetchDocument(url, opts.fetchTimeoutSeconds);
    if ("error" in result) fetchFailures.push({ url, error: result.error });
    else fetched.set(url, result);
  }

  // The whole line redacted, then cut: the census and the discovery cut a line at 300 characters, and a
  // credential straddling the cut no longer matched its clause when `redactedCopy` ran over the cut text afterwards.
  const linePrinted = productPrintedRedaction();
  const lineText = (trimmed: string): string => redactPrintedText(linePrinted, trimmed);
  const discovery = discoverDocuments({
    lineText,
    files: walked.files,
    explicitPaths: pathPolicies,
    // A URL that could not be fetched is not a document; it is a failure, reported below. Listing
    // it as "found" would make an unreachable policy look like a read one.
    urls: [...fetched.keys()],
    readFile,
    // Only the refusals that are about whether the file can be READ. One refused for sitting in a
    // vendored or test tree is a placement decision the aggregated `excluded_by_walker` reports;
    // one the walker could not open is a document this run does not have, and if its name says
    // "privacy policy" that belongs in the screened list by name.
    refusedByWalker: walked.refused.filter((r) => UNREADABLE_REASONS.has(r.reason as never)),
  });

  const documents: ExtractedDoc[] = [];
  const unextractable: { path: string; reason: string }[] = [];
  for (const doc of discovery.found as DiscoveredDoc[]) {
    if (doc.kind === "url") {
      const got = fetched.get(doc.path)!;
      documents.push(
        extractText({
          docPath: doc.path,
          content: got.content,
          kind: "url",
          fetchedAt: got.fetchedAt,
          extractor: "html",
        }),
      );
      continue;
    }
    const content = readFile(doc.path);
    if (content === null) {
      unextractable.push({ path: doc.path, reason: "unreadable" });
      continue;
    }
    if (Buffer.byteLength(content) > MAX_DOCUMENT_BYTES) {
      unextractable.push({ path: doc.path, reason: `over ${MAX_DOCUMENT_BYTES} bytes` });
      continue;
    }
    documents.push(extractText({ docPath: doc.path, content }));
  }

  const census = runCensus({ files: walked.files, readFile, lineText });

  // The store half of coverage row A14: Apple privacy manifests and Play data safety exports found
  // in the tree, parsed without judgement. The agent reconciles them against the census the same
  // way it reconciles a policy — declared-but-not-seen and seen-but-not-declared, in both
  // directions. An unreadable manifest is reported, because a declaration that could not be read
  // and a repository with no declaration are different facts.
  // The walker's exclusions are passed in, not ignored: the three ways a real manifest disappears —
  // a binary plist inside a vendored `.framework` rejected as `binary-content`, a Play CSV over the
  // size limit, a file in a skipped tree — all end with the file never reaching `walked.files`. Read
  // from there, "no store declarations" was indistinguishable from "three were found and none was
  // opened".
  const stores = collectStoreDeclarations(walked.files, readFile, walked.refused);

  let index: Pillar1Index | null = null;
  let joinError: string | undefined;
  if (opts.findingsPath) {
    try {
      index = loadPillar1Index(opts.findingsPath);
    } catch (e) {
      joinError = `could not read ${opts.findingsPath}: ${(e as Error).message}`;
    }
  }
  const annotated = annotateLocatables(census.facts as CensusFact[], index);
  const sameLine = (census.facts as CensusFact[]).filter((f) =>
    f.pillar1_overlaps?.some((o) => o.same_line),
  ).length;

  // Every checklist the bundle carries goes into the file, and none is picked here. Which
  // instruments reach this project is a legal test — is it an intermediary service, is the provider
  // established in the Union — and the deterministic layer cannot run one in full. Each checklist
  // carries its own applicability gate for the agent to answer. Until 2026-07-28 this line read
  // `checklists[0]`, which named the first list and made every later one invisible.
  //
  // "cannot run one" read as an absolute until 2026-09-01, when the mechanical part of the same
  // test started running below. Nothing about the selection changed: no checklist is dropped, and
  // no verdict emitted here decides which lists the agent walks.
  const checklists = opts.bundle.checklists ?? [];

  // The mechanical half of the same gates, run here as well as in `scan` (W2, 2026-09-01).
  //
  // `assessScope` is the evaluator `scan.ts` already calls, imported rather than reimplemented: one
  // function, one set of limb states, so the two halves of the product cannot come to hold
  // different mechanical rules about the same gate. The inputs are this run's own census facts and
  // this run's own profile, which is why this is not a copy of the scan's answer — a reconcile run
  // over a tree the scan never walked gets its own verdict, computed the same way.
  //
  // What it does NOT do is settle the gate. Every limb whose answer needs a person or a document is
  // still open here. The relationship between these states and the agent's step-3a walk is stated
  // once, in `reconcile-input.schema.json`'s `applicability` description, and is not restated here.
  const scope = assessScope(checklists, census.facts, profile);

  return {
    reconcile_id: randomUUID(),
    bundle: { version: opts.bundle.manifest.bundle_version, sha256: opts.bundle.digest, signature: opts.bundle.signature },
    generated_at: new Date().toISOString(),
    target: targetRoot,
    discovery: {
      ...discovery,
      // Each document's own name shape, so a 165-line listing can be sorted by what is likely to
      // decide the run rather than only by which pass reached it (a gap found in another real run).
      found: withNameShapeKinds(discovery.found as DiscoveredDoc[]),
      fetch_failures: fetchFailures,
      unextractable,
      referencing_files: redactedCopy(discovery.referencing_files),
    },
    documents,
    checklists,
    checklist_ids: checklists.map((c) => c.checklist_id),
    // Null rather than omitted when no profile was given: "nobody was asked" and "the field is not
    // in this schema" are different statements, and only the first is true here.
    //
    // From 2026-09-02 this is the profile AS READ rather than as written, and the two differ only
    // where a field the schema rejects was downgraded to `null`. What the file itself held is not
    // lost: `profile_validation.violations[].found` carries the rejected value verbatim beside its
    // path. One profile per run, not two — see profile.ts § ONE PROFILE, NOT TWO.
    profile,
    // Emitted only where `--profile` was given, because with no profile there is nothing to check.
    // Absent with a non-null `profile` means a document written before 2026-09-02.
    ...(loaded ? { profile_validation: loaded.validation } : {}),
    // The same three statements, per declared artifact, with what this run saw beside each. Emitted
    // on every run, profile or no profile: with none, the four entries say "nobody was asked", which
    // is what makes an unanswered question visible instead of absent (W1, 2026-09-01).
    declared_artifacts_reconciliation: reconcileDeclaredArtifacts({
      profile,
      discovery,
      // Read for one thing: whether a document the put_back is about to name is a shell. Passed in
      // rather than re-extracted, so the sentence and the console's own thin-document warning are
      // reading the same bytes (a gap found in one real run, 2026-09-02).
      documents,
      storeDeclarations: stores.declarations,
      storeUnreadable: stores.unreadable,
      storeExcluded: stores.excluded,
      filesWalked: walked.files.length,
      // The reason carried forward rather than re-derived, so a `declared_artifacts` the schema
      // rejected keeps its own silence and its own quoted value in the sentence put to the person
      // (D2 of the 2026-09-02 check). `undefined` where the load step replaced nothing there.
      downgradedDeclaredArtifacts: loaded?.downgraded.get("/declared_artifacts"),
    }),
    // One assessment per bundled gate that carries `limbs`, and the ids of the gates that do not.
    // Both emitted on every run, profile or no profile: with none, every limb reports
    // `declared_value: null` and no limb is in either declaration state, which is what makes a
    // question nobody was asked visible instead of absent (W2, 2026-09-01).
    //
    // Each evidence row's `value` is a census capture kept as text, so it goes through the credential
    // redaction findings.json applies to the same rows (R3′): the same function, `redactEvidenceValues`,
    // with the CLI's own `baseline-002` compiled by the same `productCredentials`,
    // exactly as `scan.ts` does where it writes `applicability`. Here, as there, it runs after
    // `assessScope`, so no limb state is computed from a redacted value. The rows carry no copy of the
    // source line (`file` and `line` locate it), in this document as in findings.json, whose
    // `applicability.items` this schema's `$defs.scopeAssessment` mirrors.
    applicability: redactEvidenceValues(scope.assessments, productCredentials()),
    applicability_not_assessed: scope.skipped,
    store_declarations: stores.declarations,
    store_declarations_unreadable: stores.unreadable,
    store_declarations_excluded: stores.excluded,
    census: redactedCensus(census),
    pillar1: statusOf(index, joinError),
    stats: {
      files_walked: walked.files.length,
      documents_found: discovery.found.length,
      documents_extracted: documents.length,
      // Beside documents_found so screening never lowers that number with nothing to say why
      // (LOW 2 of the 2026-09-02 verification).
      documents_screened: (discovery.looked_at.content_scan.screened ?? []).length,
      // How many of the found documents carry a declaration-shaped NAME, whatever pass reached them
      // (a gap found in another real run). A count beside `documents_found` is what makes "165 documents"
      // legible as "165 candidates, 7 of which are named like a declaration".
      documents_declaration_shaped: withNameShapeKinds(discovery.found as DiscoveredDoc[]).filter(
        (d) => (d.name_shape_kinds?.length ?? 0) > 0,
      ).length,
      referencing_files: discovery.referencing_files.length,
      census_facts: census.facts.length,
      store_declarations_found: stores.declarations.length,
      declared_only_dependencies: census.declared_only_dependencies.length,
      // Of those, the ones whose call sites could be on lines the census did not read; only when any.
      ...(census.declared_only_dependencies.some((d) => d.call_sites_not_read)
        ? { declared_only_dependencies_not_read: census.declared_only_dependencies.filter((d) => d.call_sites_not_read).length }
        : {}),
      facts_with_pillar1_overlap: annotated,
      facts_on_a_pillar1_line: sameLine,
    },
    excluded_by_walker: walked.excluded,
    disclaimer: RECONCILE_DISCLAIMER,
  };
}

/**
 * Summary printed after `reconcile`.
 *
 * Structured on the same principle as `summarize()` in `scan.ts`: what was found, and next to it
 * what was looked at and did not produce anything, so that a discovery which failed is legible
 * from the terminal rather than only from the JSON.
 */
/**
 * Two shapes a fetched page takes that make its extracted text unusable, and which no synthetic
 * fixture produces. Both measured on real EU legal pages, 2026-07-28:
 *
 * - **Thin.** A page that renders its terms with JavaScript delivers a shell: one site's terms
 *   extracted to 23 lines and 2,486 characters. Nothing failed — the document was found, the fetch
 *   returned 200, extraction "succeeded" — and a checklist walked against it would answer *absent*
 *   for every item, about a page whose text never arrived.
 * - **One line.** Another delivered its whole document inside a single 249,424-character line.
 *   Extraction succeeded and every quotation would cite the same line number, which is the same as
 *   citing none.
 *
 * Reported, never silently corrected: what the tool has is what it has, and the reader has to know
 * which of the two they are looking at.
 */
function documentShapeWarnings(input: ReconcileInput): string[] {
  const out: string[] = [];
  for (const doc of input.documents) {
    const chars = doc.lines.reduce((n, l) => n + l.text.length, 0);
    const longest = doc.lines.reduce((m, l) => Math.max(m, l.text.length), 0);
    // A third shape, and the extractor is the one that knows about it: a masker that produced nothing
    // out of a file that has content. Printed here rather than only in the JSON, because a document
    // with no text and no explanation reads exactly like a document that says nothing.
    for (const note of doc.notes ?? []) out.push(`${doc.doc_path}: ${note}`);
    // The threshold is `THIN_DOCUMENT_CHARS`, shared with the declared-artifacts put_back rather
    // than written twice: two parts of one tool disagreeing about whether a file is a shell is the
    // defect a gap found in one real run recorded.
    if (chars < THIN_DOCUMENT_CHARS) {
      out.push(
        `${doc.doc_path}: only ${chars} characters of text across ${doc.lines.length} line(s). A legal document is normally several thousand. If this page builds its text in the browser, what was read is a shell — treat every checklist item as unresolved, not absent.`,
      );
    }
    // The threshold is `LINE_LOCATES_NOTHING_CHARS`, imported from `extract.ts` where the shape is
    // recorded, rather than written as a literal here: `reconcile-verify` refuses to write a
    // tool-extracted quotation out of a line at or over the same number, and the warning a person
    // reads and the refusal a tool takes must not be able to drift apart (run 4, 2026-09-03).
    if (longest >= LINE_LOCATES_NOTHING_CHARS) {
      out.push(
        `${doc.doc_path}: its longest line is ${longest} characters. Line numbers cannot locate anything in it, so a quotation citing a line here points at the whole document. Anchor every quotation of it on a short, distinctive, contiguous run of its words, and say in the reasoning that the line number alone does not pinpoint the passage.`,
      );
    }
  }
  return out;
}

/**
 * Exit code when at least one document was requested with `--policy` and not one of them could be
 * read into this run: every URL failed to fetch, and every path was unreadable or over the size limit
 * (`discovery.unextractable`, whose schema description calls both "text could not be obtained").
 *
 * Until 2026-09-24 this command exited 0 in that state — the failures were collected, printed near
 * the end of the summary and recorded in the input, and a CI job that depended on the command passed
 * with nothing it had asked for reconciled (the 2026-09-14 architecture review, pillar 2, H1).
 *
 * **Why 11.** Every number from 0 to 7 already means something in this CLI: 1 and 2 are what it
 * reserves for a caller's mistake and an input file it could not read, where the command stops and
 * writes nothing; 3 and 4 are `scan`'s (places waiting for a review met `--fail-on-unreviewed`; the scan reached nothing); 5 is a
 * quotation or a reading that could not be verified (`reconcile-verify`, `verdict-verify`,
 * `verdict-reading`, `questionnaire verify`); 6 is `reconcile-diff`'s differences-found and
 * `questionnaire ingest`'s no-questions; 7 is answers that do not fit a questionnaire. This state is
 * none of those. The run completed and wrote its input, and whatever auto-discovery found in the tree
 * was reconciled; what it could not do is the one thing its caller asked for by name. 8 is reserved
 * by a recorded design for the planned `policy check` command,
 * and 9, 10, 12 and 13 are exit
 * codes Node itself uses — 9 for an invalid option, including one in NODE_OPTIONS — so a caller could
 * not tell them from this state. 11 is assigned nowhere: not in this CLI, not in a recorded design,
 * not by Node. (The first version of this fix, 2026-09-24, took 8 without knowing the reservation; a
 * non-author verification found it.) Only this command binds 11, and a test
 * turns red if another exported EXIT_* constant ever does, or if anything but `policy check`'s
 * constant binds 8.
 *
 * **What does not set it.** A run where at least one requested document was read exits 0 as before,
 * with the others listed where they always were. A run with no `--policy` exits 0 whatever discovery
 * found: "no declaration was found" is a result this command reports in words (the
 * declaration-reconcile SKILL, step 2), not a request it failed.
 */
export const EXIT_NO_REQUESTED_DOCUMENT = 11;

/** What happened to each document requested with `--policy`, derived from the input alone. */
export interface RequestedDocumentOutcome {
  /** Requested documents whose text is in `documents[]`. */
  read: string[];
  /** Requested documents whose text is not, each with the reason the input records for it. */
  not_read: { path: string; problem: string }[];
}

/**
 * Derived from the reconciliation input rather than from the run's local state, so the exit code,
 * the console and anyone re-reading the written file reach the same answer from the same record: a
 * URL is requested when discovery found it `url` or it is in `fetch_failures`, a path when discovery
 * found it `explicit`, and a requested document was read when `documents[]` holds its text.
 */
export function requestedDocumentOutcome(input: ReconcileInput): RequestedDocumentOutcome {
  const d = input.discovery;
  const extracted = new Set(input.documents.map((doc) => doc.doc_path));
  const read: string[] = [];
  const notRead: { path: string; problem: string }[] = [];
  for (const doc of d.found) {
    if (doc.found_by !== "explicit" && doc.found_by !== "url") continue;
    if (extracted.has(doc.path)) {
      read.push(doc.path);
      continue;
    }
    const why = d.unextractable.find((u) => u.path === doc.path);
    notRead.push({ path: doc.path, problem: why ? why.reason : "its text is not in documents[]" });
  }
  for (const f of d.fetch_failures) notRead.push({ path: f.url, problem: f.error });
  return { read, not_read: notRead };
}

/** 0, or EXIT_NO_REQUESTED_DOCUMENT when documents were requested and none of them was read. */
export function reconcileExitCode(input: ReconcileInput): number {
  const outcome = requestedDocumentOutcome(input);
  return outcome.read.length === 0 && outcome.not_read.length > 0 ? EXIT_NO_REQUESTED_DOCUMENT : 0;
}

export function summarizeReconcile(input: ReconcileInput): string {
  const lines: string[] = [];
  const d = input.discovery;

  /* PRINTED FIRST, before the header, when nothing requested was read. The same failures were
   * always in the summary, but after the document listing — which on a real repository can run to
   * 165 lines — and under an exit code of 0; the cause of a failed run is the first thing its reader
   * needs. The rest of the summary follows unchanged, including the could-not-be-fetched block. */
  if (reconcileExitCode(input) === EXIT_NO_REQUESTED_DOCUMENT) {
    const { not_read: notRead } = requestedDocumentOutcome(input);
    lines.push(
      `None of the ${notRead.length} document(s) requested with --policy could be read, so this run reconciled none of them — exit ${EXIT_NO_REQUESTED_DOCUMENT}:`,
    );
    for (const n of notRead) lines.push(`  ${n.path} — ${n.problem}`);
    lines.push(
      // True with and without --out: this function is not told whether the input is being written,
      // and the "Wrote" hand-off after the summary says whether it was.
      "  Each is recorded in the reconciliation input (written only when --out is given): discovery.fetch_failures for a URL, discovery.unextractable for a path. What auto-discovery found in the tree is reported below as usual.",
    );
    lines.push("");
  }

  lines.push(
    `reconcile ${input.reconcile_id.slice(0, 8)} | bundle ${input.bundle.version} | files ${input.stats.files_walked} walked`,
  );
  lines.push("");

  if (input.stats.documents_found === 0) {
    lines.push(
      `No declaration documents found. This is NOT a statement that this project has no privacy policy or terms.`,
    );
    lines.push(
      `  by name:    ${d.looked_at.files_tested_by_name ?? d.looked_at.files_walked} file(s) tested against ${d.looked_at.globs.join(", ")} — every walked file, whatever its extension`,
    );
    lines.push(
      `  by content: ${d.looked_at.content_scan.files_read} file(s) read; none contained ${d.looked_at.content_scan.marker_threshold} or more of the phrases a privacy notice or a set of terms uses`,
    );
    lines.push(
      "Pass --policy <path|url> if the declaration lives outside the repository, or is written in a way this pass does not recognise.",
    );
  } else {
    lines.push(`${input.stats.documents_found} declaration document(s):`);
    const byWay = new Map<string, number>();
    for (const doc of d.found) byWay.set(doc.found_by, (byWay.get(doc.found_by) ?? 0) + 1);
    const sizeOf = (doc: DiscoveredDoc): string => {
      const extracted = input.documents.find((x) => x.doc_path === doc.path);
      return extracted ? `${extracted.stats.text_lines} text line(s)` : "not extracted";
    };

    /* THE NAMED BLOCK (a gap found in one real run, 2026-09-02). Printed FIRST and never grouped.
     *
     * That run's orchestrator read a 165-line listing in full and skimmed past its two most
     * consequential rows — that tree's real Terms and Privacy Policy for its paid hosted tier, rendered
     * as TypeScript route handlers, at lines 120 and 121 — because 108 of the other rows were
     * near-identical translation catalogues and a list that is mostly noise does not get equal
     * attention per line. It then told six of seven subagents that no terms-of-service document
     * existed anywhere in the repository.
     *
     * So the documents whose own NAME is a declaration's name are named here, individually, before
     * anything else, with the kind their name is a candidate for. This is a statement about the
     * name — discovery classifies nothing — and it is exactly the sentence a triaging reader needs
     * first. Nothing is removed from the list below by appearing here. */
    const named = (d.found as DiscoveredDoc[]).filter((doc) => (doc.name_shape_kinds?.length ?? 0) > 0);
    if (named.length > 0) {
      lines.push(
        `  ${named.length} of them carry a declaration-shaped NAME — every one named here, because this is the line a reader must not skim past:`,
      );
      const kindOrder = (doc: DiscoveredDoc) =>
        doc.name_shape_kinds!.includes("privacy_policy") && doc.name_shape_kinds!.includes("tos")
          ? 0
          : doc.name_shape_kinds!.includes("privacy_policy")
            ? 1
            : 2;
      for (const doc of [...named].sort((a, b) => kindOrder(a) - kindOrder(b) || a.path.localeCompare(b.path))) {
        lines.push(`    ${doc.name_shape_kinds!.join(" + ").padEnd(24)} ${doc.path}  (${doc.found_by})  ${sizeOf(doc)}`);
      }
      lines.push(
        "    A name shape is a candidate and never an identification: discovery types nothing. It says which documents to read first, not what they are.",
      );
    } else {
      lines.push(
        "  None of them carries a declaration-shaped name. That is a statement about the names in this tree, not about whether a declaration is among them — the content pass finds documents whose names say nothing.",
      );
    }

    /* THE POINTERS (a gap found in a third real run, 2026-09-03). Printed immediately after the
     * named block, because they answer a different question from every other row and answering it
     * wrongly is what that run nearly did.
     *
     * `fastlane/metadata_bwpm_prod/default/privacy_url.txt` holds exactly
     * `https://bitwarden.com/privacy/` and nothing else. Discovery found both copies correctly and
     * offered them as candidate declarations, which is right — and then the thin-document warning
     * fired on them, and the run's own working premise was written as "this repository carries no
     * privacy policy". It carries no privacy-policy PROSE, and it states twice, affirmatively, where
     * the prose is published. Those are different sentences, and one line in a sixty-document
     * listing is where the difference was nearly lost.
     *
     * Nothing is removed from the listing below by appearing here. */
    const pointers = (d.found as DiscoveredDoc[]).filter((doc) => doc.url_pointer !== undefined);
    /* WHICH OF THE ADDRESSES THIS RUN ACTUALLY READ (hole 6 of the bitwarden-url run, 2026-09-03).
     *
     * This block used to end with the flat sentence "This run did not fetch any of them" — and on
     * the first `--policy <url>` run that sentence was FALSE in its own console output: the run had
     * fetched `https://bitwarden.com/privacy/`, which is exactly what two of the six pointers name.
     * A console that misstates what the run read is the same defect class as a report that does, one
     * step earlier.
     *
     * Matched EXACTLY against the fetched documents' own `doc_path`, with no normalising of trailing
     * slashes or case. A URL that differs by one character is a different address, and the failure
     * direction of an exact match is to under-claim — to say a document was not read when a
     * near-identical one was — which is the safe direction for a disclosure whose whole job is to
     * mark the boundary of what was read. */
    const fetchedUrls = new Set(
      input.documents.filter((doc) => doc.kind === "url").map((doc) => doc.doc_path),
    );
    if (pointers.length > 0) {
      const distinct = new Set(pointers.map((p) => p.url_pointer!.url));
      const readCount = [...distinct].filter((u) => fetchedUrls.has(u)).length;
      lines.push(
        `  ${pointers.length} of them is a POINTER, not a document: the whole file is one URL, naming ${distinct.size} document(s) published outside this repository, of which this run read ${readCount}.`,
      );
      for (const doc of [...pointers].sort((a, b) => a.path.localeCompare(b.path))) {
        const url = doc.url_pointer!.url;
        lines.push(
          `    ${doc.url_pointer!.convention.padEnd(16)} ${doc.path}  ->  ${url}  [${fetchedUrls.has(url) ? "fetched this run" : "NOT fetched"}]`,
        );
      }
      lines.push(
        `    --policy <url> reads a published page in full; for an address this run did not fetch it has read the pointer and not the document it points at, and "no policy in this tree" and "no policy" are different statements.`,
      );
    }

    /* KNOWN EXTERNAL DOCUMENTS NOT FETCHED THIS RUN — the disclosure, on its own line, the design's
     * shape: what was not read is stated, and nothing is fetched to make the statement go away.
     *
     * Printed separately from the pointer rows above because it answers a different question. That
     * block asks "what kind of thing is this file"; this one asks "what does this run NOT know", and
     * a reader of a report needs the second one in front of them when they read every `unresolved`
     * below it. Run 4 measured what it costs to be without it: two seats independently discovered
     * `https://bitwarden.com/terms/` — one from the fetched policy's own prose, one from a hardcoded
     * constant in the source — and seven DSA terms items plus ten Data Act switching-terms items sat
     * `unresolved` for want of exactly that document, with nothing in the machinery's own output
     * saying an unread external document existed.
     *
     * **The boundary of this block, stated because it is narrower than the sentence it prints.** It
     * names the addresses this run holds AS ADDRESSES — store-metadata URL pointers. A terms URL
     * hardcoded in a Swift constant, or named in a fetched page's own footer, is not a `url_pointer`
     * and does not appear here; run 4's own `terms/` was found by two reading agents and by a grep,
     * and this block would not have caught it. Widening the block would mean classifying arbitrary
     * URLs in source as declarations, which is the judgement `discover.ts` refuses to make.
     *
     * **Nothing is fetched.** A scanner that reached out to an address it found in somebody's
     * repository would be making a network request the person did not ask for, at a host they may
     * not control. The recovery is one flag, named here, and it is theirs to run. */
    const unfetched = [...new Set(pointers.map((p) => p.url_pointer!.url))]
      .filter((u) => !fetchedUrls.has(u))
      .sort();
    if (unfetched.length > 0) {
      lines.push("");
      lines.push(
        `  KNOWN EXTERNAL DOCUMENTS NOT FETCHED THIS RUN — ${unfetched.length} address(es) this tree names and this run did not read:`,
      );
      for (const url of unfetched) {
        const named = pointers
          .filter((p) => p.url_pointer!.url === url)
          .map((p) => `${p.url_pointer!.convention} (${p.path})`);
        lines.push(`    ${url}`);
        lines.push(`      named by: ${named.join(", ")}`);
      }
      lines.push(
        `    Nothing was fetched to close this list: a scanner does not reach out to an address it found in somebody's repository on its own. Re-run with --policy <url> (repeatable) for each one you want read.`,
      );
      lines.push(
        `    Until then, every checklist item that turns on one of these documents is unresolved for want of the document, which is a different statement from the document being silent — say which in the report.`,
      );
    }

    /* The rest, with near-identical clusters collapsed to one line each.
     *
     * The clustering key is structural — the pass that found it, its directory and its extension —
     * and never a word in the path: "is this a locale file?" is exactly the name-derived judgement
     * this module refuses to make about what a file IS. Seventeen `.json` files in one directory
     * found by one pass are seventeen rows that tell a reader one thing, and printing them as one
     * line with a count is what leaves room for the rows that tell them something. Every document is
     * still listed individually in `discovery.found[]`, and every one of them is still extracted.
     *
     * **The extension in this key is DISPLAY, not judgement**: it groups
     * rows that look alike on one line and decides nothing about any file. Every document in a
     * collapsed group was found, extracted and listed; the group only chooses how many lines the
     * console spends saying so. */
    const rest = (d.found as DiscoveredDoc[]).filter((doc) => (doc.name_shape_kinds?.length ?? 0) === 0);
    const groups = new Map<string, { found_by: string; dir: string; ext: string; docs: DiscoveredDoc[] }>();
    for (const doc of rest) {
      const p = doc.path.replace(/\\/g, "/");
      const slash = p.lastIndexOf("/");
      const dir = slash < 0 ? "" : p.slice(0, slash);
      const base = slash < 0 ? p : p.slice(slash + 1);
      const dot = base.lastIndexOf(".");
      const ext = dot > 0 ? base.slice(dot) : "";
      // Keyed by the three fields serialised together, and the fields are then read back off
      // the stored object rather than split out of the key: a directory may contain any character
      // a separator could be, and a key that has to be taken apart again is a key that can be
      // taken apart wrongly.
      const key = JSON.stringify([doc.found_by, dir, ext]);
      if (!groups.has(key)) groups.set(key, { found_by: doc.found_by, dir, ext, docs: [] });
      groups.get(key)!.docs.push(doc);
    }
    const CLUSTER_MIN = 3;
    if (rest.length > 0) lines.push(`  the other ${rest.length}:`);
    /* Most expensive first, not insertion order — the same correction the screened preview and the
     * outbound-host annotation each took (LOW 1, 2026-09-02), for the same reason and now with a
     * measurement behind it.
     *
     * **Measured on a real tree and it corrects that run's own third gap — with its own first
     * figures corrected in turn** (independent verification, 2026-09-03, MODERATE 3). Every number
     * below is re-derived from the run's own `reconcile/reconcile-input.json`, in bytes, so it can be
     * checked without re-running anything.
     *
     * Hole #3 attributed a "~2.26 MB text-extraction bill" to a glob collision: `**\/*policy*`
     * sweeping in files of the codebase's own unrelated organisation-"Policy" feature. **The whole
     * document set is 1,635,429 bytes**, so that figure is larger than everything discovered. The
     * collision is real as a ROW COUNT — 43 of 60 documents arrive by glob or sibling — and small as
     * a byte cost:
     *
     *   16 localisation catalogues, found by the CONTENT pass   1,379,031 B   84.3 %
     *   all 43 glob+sibling rows                                  221,258 B   13.5 %
     *   the 21 policy-named `.swift` documents among them         134,712 B    8.2 %
     *   all 34 `.swift` documents                                 208,256 B   12.7 %
     *
     * (The 17th content-pass document is `LICENSE.txt` at 35,140 B, not a catalogue — the first
     * version of this comment counted it as one and said "17 catalogues, 1.53 MB of 1.64 MB", and
     * "40 short Swift files carrying 105 KB" where there are 34 carrying 208 KB.)
     *
     * Ordering by cost is what makes the real bill legible from the terminal instead of from a
     * script; the glob is NOT narrowed, because narrowing it would buy 8.2 % of one document set and
     * The design forbids buying that with a subtraction. */
    const byCost = [...groups.values()].sort((a, b) => {
      const bytesOf = (g: { docs: DiscoveredDoc[] }) =>
        g.docs.reduce((n, doc) => n + (input.documents.find((x) => x.doc_path === doc.path)?.bytes ?? 0), 0);
      return bytesOf(b) - bytesOf(a) || a.dir.localeCompare(b.dir);
    });
    for (const { found_by: foundBy, dir, ext, docs } of byCost) {
      if (docs.length < CLUSTER_MIN) {
        for (const doc of docs) lines.push(`    ${doc.found_by.padEnd(8)} ${doc.path}  ${sizeOf(doc)}`);
        continue;
      }
      const textLines = docs.reduce(
        (n, doc) => n + (input.documents.find((x) => x.doc_path === doc.path)?.stats.text_lines ?? 0),
        0,
      );
      const bytes = docs.reduce(
        (n, doc) => n + (input.documents.find((x) => x.doc_path === doc.path)?.bytes ?? 0),
        0,
      );
      lines.push(
        `    ${foundBy.padEnd(8)} ${docs.length} file(s) in ${dir === "" ? "the repository root" : `${dir}/`} ending ${ext || "(no extension)"} — ${textLines} text line(s), ${bytes} byte(s) in total, each one listed in discovery.found[]:`,
      );
      /* EVERY basename, wrapped, never elided (M1 of the run-2 verification).
       *
       * This printed the first three and counted the rest, and that reintroduced the exact artefact
       * hole 1 is about, one level down: a thirteen-file `docs/pages/` group whose twelfth member is
       * a genuine 4.6 KB privacy statement called `help.md` — content-found, matching no glob, which
       * is the population the content pass exists for — printed as `guide_0.md, guide_1.md,
       * guide_10.md, and 10 more`, and the real declaration appeared nowhere in the output at all.
       * Before the clustering it had a line of its own. Step 2-0's enumeration does not recover it
       * either, because that list is the NAME-shaped set and this document's name says nothing.
       *
       * The collapse was for the row count, not for the names: a basename is short, and seventeen of
       * them wrapped over three lines is still one entry instead of seventeen. */
      const names = docs.map((doc) => doc.path.split("/").pop() ?? doc.path);
      const WRAP = 100;
      let line = "";
      for (const name of names) {
        const next = line === "" ? name : `${line}, ${name}`;
        if (next.length > WRAP && line !== "") {
          lines.push(`             ${line},`);
          line = name;
        } else {
          line = next;
        }
      }
      if (line !== "") lines.push(`             ${line}`);
    }

    lines.push(
      `  found by: ${[...byWay.entries()].map(([k, v]) => `${k} ${v}`).join(", ")}`,
    );
    const totalBytes = input.documents.reduce((n, doc) => n + doc.bytes, 0);
    lines.push(
      `  ${input.documents.length} document(s) extracted, ${totalBytes} byte(s) of text in total — this is what a consumer of documents[] reads if it trusts discovery at face value, and it is a cost, not a finding.`,
    );
    lines.push(
      `  Discovery is not a completeness claim: ${d.looked_at.files_tested_by_name ?? d.looked_at.files_walked} file(s) were tested by name and ${d.looked_at.content_scan.files_read} read for content. A declaration published only on the website, or written in a way this pass does not recognise, is reachable with --policy and no other way.`,
    );
  }

  /* What the sibling pass reached and did not add (a gap found in one real run, 2026-09-02).
   *
   * A count of dropped neighbours is not a record of them: that run's output said "105 dropped over
   * the limit" and named none. Printed here with the numbers the neighbourhood test was decided on,
   * so a reader can dispute the decision from the terminal. */
  const declined = (d.looked_at.sibling_expansions ?? []).filter((e) => (e.not_added?.length ?? 0) > 0);
  if (declined.length > 0) {
    lines.push("");
    const total = declined.reduce((n, e) => n + (e.not_added?.length ?? 0), 0);
    lines.push(
      `${total} neighbour(s) of a discovered document were reached by the sibling pass and not added — named, not dropped:`,
    );
    for (const e of declined) {
      lines.push(
        `  ${e.root}/  ${e.declaration_named_under_root ?? "?"} of ${e.candidates_under_root ?? "?"} candidate(s) under it carry a declaration-shaped name, so it ${e.neighbourhood_confirmed ? "is" : "is not"} read as a neighbourhood of declarations; ${e.added} added, ${e.not_added!.length} not:`,
      );
      lines.push(`      ${e.not_added!.slice(0, 5).map((n) => n.file).join(", ")}${e.not_added!.length > 5 ? `, and ${e.not_added!.length - 5} more, all of them in discovery.looked_at.sibling_expansions[].not_added` : ""}`);
    }
    lines.push(
      "  Each of these was still read by the content pass, which reads every walked file whatever it is called, and --policy <path> reads any of them in full as a supplied document.",
    );
  }

  // The screened files, printed rather than left in the JSON (2026-09-02, a gap found in one real
  // run). The screen is an addition only if what it screened is visible: a reader has to be able to
  // see that a file was reached, what it said, and that one flag puts it back. Printed with the
  // measurement that decided it, so the decision can be disputed from the terminal.
  const screened = d.looked_at.content_scan.screened ?? [];
  if (screened.length > 0) {
    lines.push("");
    // Two populations since 2026-09-02, counted separately in this sentence because they are
    // different statements: one is "we read it and it does not read like a document", the other is
    // "we did not read it". A name match reaches the second one now that the name passes do not
    // consult a file's extension.
    //
    // **The second is not "could not read them as text"** (F3 of the 2026-09-03 verification, which
    // corrected this sentence). Three refusals land here and only one is about bytes: a file refused
    // for its extension was never opened, and a file over the size ceiling is usually text. Each row
    // below carries its own label, derived from the refusal, and this summary says only what is true
    // of all three — that the tool did not read them.
    const unreadable = screened.filter((s) => s.shape === undefined).length;
    const shapeless = screened.length - unreadable;
    const why =
      unreadable === 0
        ? "because they said what a legal document says and did not read like one"
        : shapeless === 0
          ? "because this tool did not read them — see each row's own reason"
          : `${unreadable} that this tool did not read (each row says why), ${shapeless} that said what a legal document says and did not read like one`;
    lines.push(
      `${screened.length} file(s) were reached and not offered as candidate declarations — ${why}. Screened out of the candidate list, not deleted:`,
    );
    // Largest first, not walk order (LOW 1): the biggest screened file is the one a reader most
    // wants to eyeball for a real policy, and printing the first ten in path order can hide it in
    // the "… and N more". A readability-screened file has no measurement to sort by and is printed
    // FIRST, because it is the shorter list and the one whose reason a reader has not seen before.
    // The JSON array stays in its own order; only this preview is sorted.
    const screenedPreview = [...screened].sort(
      (a, b) =>
        (a.shape === undefined ? 0 : 1) - (b.shape === undefined ? 0 : 1) ||
        (b.shape?.lines ?? 0) - (a.shape?.lines ?? 0),
    );
    for (const s of screenedPreview.slice(0, 10)) {
      // The label is the discovery pass's own, so the console cannot describe a refusal differently
      // from the JSON. `not read` is the fallback for an entry written before the labels existed.
      lines.push(
        `  ${s.file}  ${s.shape ? `${s.shape.lines} line(s), prose ${s.shape.prose_char_ratio}` : (s.screened_label ?? "not read")}`,
      );
      if (s.markers.length > 0) lines.push(`      matched: ${s.markers.join(", ")}`);
      if (s.shape) lines.push(`      ${s.shape.reason}`);
      else if (s.screened_reason) lines.push(`      ${s.screened_reason}`);
    }
    if (screened.length > 10) lines.push(`  … and ${screened.length - 10} more, all of them in discovery.looked_at.content_scan.screened`);
    lines.push(
      "  If one of these IS a declaration — a policy kept in a message catalogue is a case this tool has a fixture for and has not yet observed in a scanned repository — pass --policy <path> and it is read in full as a supplied document.",
    );
  }

  if (d.fetch_failures.length > 0) {
    lines.push("");
    lines.push(`${d.fetch_failures.length} document(s) could not be fetched — reported, not silently dropped:`);
    for (const f of d.fetch_failures) lines.push(`  ${f.url} — ${f.error}`);
  }
  if (d.unextractable.length > 0) {
    lines.push("");
    for (const u of d.unextractable) lines.push(`  not extracted: ${u.path} — ${u.reason}`);
  }

  if (d.referencing_files.length > 0) {
    const files = new Set(d.referencing_files.map((r) => r.file));
    lines.push("");
    lines.push(
      `${files.size} file(s) reference a document without being one — these are where a changelog or version record can disagree with the text.`,
    );
  }

  lines.push("");
  // Both counts, because they answer different questions. The row count is how much was found; the
  // distinct count is how many questions there are. On one real application 1,195 outbound-host
  // rows were 68 hosts, and 863 of the rows were a single one — an agent handed the rows without
  // the grouping spends its first move rebuilding it. Nothing is dropped: every row stays in the
  // file, and the summary says how many questions they amount to.
  const distinct = new Map<string, Set<string>>();
  for (const f of input.census.facts) {
    if (!distinct.has(f.collector)) distinct.set(f.collector, new Set());
    distinct.get(f.collector)!.add(f.value);
  }
  lines.push(`${input.stats.census_facts} code fact(s) — by collector, as rows and as distinct values:`);
  const c = input.census.stats.by_collector;
  for (const name of Object.keys(c).sort()) {
    const d = distinct.get(name)?.size ?? 0;
    lines.push(`  ${String(c[name]).padStart(5)} row(s)  ${String(d).padStart(4)} distinct  ${name}`);
  }
  if (input.census.stats.identifiers_not_requests > 0) {
    lines.push(
      `  ${String(input.census.stats.identifiers_not_requests).padStart(5)}         —          URL(s) naming a vocabulary rather than a destination, not emitted as facts`,
    );
  }
  if (input.census.declared_only_dependencies.length > 0) {
    lines.push(
      `  ${String(input.census.declared_only_dependencies.length).padStart(5)}  package(s) declared with no call site — listed under declared_only_dependencies, NOT reported as recipients`,
    );
    // An absence over lines nobody read is not an absence: the person reads how many are NOT READ.
    const unread = input.census.declared_only_dependencies.filter((d) => d.call_sites_not_read);
    if (unread.length > 0) {
      const u = unread[0].call_sites_not_read!;
      lines.push(
        `        of which ${unread.length} NOT READ: no call site was found in what the census read, but ${u.lines_past_ceiling} line(s) past the line ceiling and ${u.files} file(s) not read to their end (census.files_long_lines_not_read, census.files_stopped_for_time) could hold one, so whether they are imported is not known`,
      );
    }
  }
  // The same discipline, for the other collector that needs it (2026-09-02, a third gap of one
  // real run). Printed as a cost and a caution, never as a suppression: every row is still in
  // `facts` and every verdict is unchanged.
  const noCall = input.census.outbound_hosts_without_a_request_construct ?? [];
  if (noCall.length > 0) {
    const rows = noCall.reduce((n, e) => n + e.facts, 0);
    lines.push(
      `  ${String(rows).padStart(5)}  outbound-host row(s) in ${noCall.length} file(s) with no request construct anywhere in the file — still facts, still counted, and NOT a recipient until somebody finds the call site:`,
    );
    // Most rows first, not walk order (LOW 1): the file the annotation is most about — 134
    // marketing rows on one tree — was being pushed into "… and N more" while five one-row files
    // printed. The JSON array stays in path order; only this preview is sorted.
    const noCallPreview = [...noCall].sort((a, b) => b.facts - a.facts);
    for (const e of noCallPreview.slice(0, 5)) {
      lines.push(
        `        ${e.file}  ${e.facts} row(s), ${e.distinct_values} distinct host(s)${e.test_or_fixture_file ? "  [test/fixture file]" : ""}${e.long_lines_not_read ? `  [${e.long_lines_not_read} line(s) past the line ceiling NOT READ: a request construct there is not known]` : ""}`,
      );
    }
    if (noCall.length > 5) lines.push(`        … and ${noCall.length - 5} more, in census.outbound_hosts_without_a_request_construct`);
    // The files the preview left out still say how many of them had lines not read.
    const noCallUnread = noCall.filter((e) => e.long_lines_not_read);
    if (noCallUnread.length > 0) {
      lines.push(
        `        ${noCallUnread.length} of these ${noCall.length} file(s) have lines past the line ceiling that were NOT READ (long_lines_not_read): for those, "no request construct" holds only for the lines read.`,
      );
    }
    lines.push(
      "        A hostname in a comparison table of other companies' products, a logo carousel or a test fixture is the same shape of false signal as a package nothing imports. This is a statement about each file, not about the program: a host whose request is built elsewhere is listed here and is still a real recipient.",
    );
  }

  lines.push("");
  if (input.pillar1.computed) {
    // Both numbers, with the tight one first. Sharing a file with a candidate means very little —
    // a rule with many locations puts most of a repository "in overlap" — and quoting only that
    // figure makes the two pillars look far more redundant than they are.
    lines.push(
      `code-scan overlap against ${input.pillar1.candidates} pillar-1 candidate(s): ${input.stats.facts_on_a_pillar1_line} fact(s) sit on the same line, ${input.stats.facts_with_pillar1_overlap} merely in the same file.`,
    );
    lines.push(
      "  Annotated, never suppressed. A shared line is not a duplicate: a rule about a secret in a URL and a question about where that URL sends data are the same line and different questions.",
    );
  } else {
    lines.push(`code-scan overlap: not computed — ${input.pillar1.reason}`);
  }

  lines.push("");
  lines.push(
    ...(() => {
      // Printed unconditionally. Returning `[]` on an empty list meant the commonest outcome —
      // nothing found — produced no line at all, so a reader could not tell whether the scanner had
      // looked. And the unreadable and walker-excluded lists were never printed by anything, which
      // made the SKILL's instruction to report them describe a field nobody would ever see.
      const sd = input.store_declarations;
      const unreadable = input.store_declarations_unreadable ?? [];
      const excluded = input.store_declarations_excluded ?? [];
      const lines2 = ["", `store declarations: ${sd.length} parsed, ${unreadable.length} unreadable, ${excluded.length} not offered by the walker`];
      if (sd.length === 0 && unreadable.length === 0 && excluded.length === 0) {
        lines2.push("  No Apple privacy manifest and no Play data-safety export was found in what was scanned. That is a fact about this tree, not a statement that the developer has filed none.");
      }
      for (const d of sd) {
        const bits = [
          d.format,
          d.tracking !== undefined ? `tracking=${d.tracking}` : null,
          d.tracking_domains.length ? `${d.tracking_domains.length} tracking domain(s)` : null,
          d.collected.length ? `${d.collected.length} collected data type(s)` : null,
          d.rows?.length ? `${d.rows.length} row(s), uninterpreted` : null,
        ].filter(Boolean);
        lines2.push(`  ${d.file}  ${bits.join(" | ")}`);
        for (const prob of d.problems) lines2.push(`    ! ${prob}`);
        for (const note of d.notes ?? []) lines2.push(`    - ${note}`);
      }
      for (const f of unreadable) lines2.push(`  ! ${f} — looks like a manifest and could not be read`);
      for (const e of excluded) lines2.push(`  ! ${e.file} — looks like a manifest and the walker did not offer it (${e.reason})`);
      return lines2;
    })(),
    ...(() => {
      const warnings = documentShapeWarnings(input);
      return warnings.length === 0 ? [] : ["", "Documents whose extracted text may not be usable:", ...warnings.map((w) => `  ! ${w}`)];
    })(),
    ...(() => {
      // Printed unconditionally, for the reason the store block above gives: a section that vanishes
      // when it holds nothing leaves a reader unable to tell whether the scanner looked. With no
      // --profile every entry reads `unanswered`, and printing those four is the point — a question
      // nobody has been asked is then visible instead of absent (W1, 2026-09-01).
      const entries = input.declared_artifacts_reconciliation;
      if (!entries) {
        return [
          "",
          "declared artifacts: not computed for this file. It was produced before the profile's own answers were read, which is not the same as a profile that answered nothing.",
        ];
      }
      const open = entries.filter((e) => e.status !== "consistent");
      const out = [
        "",
        `declared artifacts (what the profile answered, beside what this run saw): ${entries.length - open.length} of ${entries.length} agree, ${open.length} to put to the person before anything else.`,
      ];
      for (const e of open) {
        out.push(`  ? ${e.kind.padEnd(17)} ${e.status}`);
        if (e.put_back) out.push(`    ${e.put_back}`);
      }
      // The caveat is printed in EVERY branch, not only when everything agrees (defect D4,
      // 2026-09-01). In the ordinary mixed run the header alone read "1 of 4 agree", and "agree"
      // with nothing beside it invites the reading that the document was checked and found good.
      // The `observation.note` that carries this qualification never reaches the console.
      out.push(
        '  "Agree" means an answer and an observation do not disagree. It is never a statement that a document exists, that it was read, or that it says what it should.',
      );
      if (open.length > 0) {
        out.push(
          '  The scanner resolves none of these. Each is a question for the person running the scan, and an answer nobody gave is never read as a "no".',
        );
      }
      return out;
    })(),
    ...(() => {
      /* The mechanical gate test, printed short (W2, 2026-09-01).
       *
       * `scan` prints the long form of this — every settled limb, every open one, with its question.
       * This block is deliberately not that: the reader of a reconcile summary is on their way to
       * the step-3a gate walk, and what they need from here is how many gates were assessed, what
       * each verdict is, and every question the run raised and did not answer. The long form is in
       * `applicability[]` in the JSON, one field away.
       *
       * Printed unconditionally, for the reason the two blocks above give: a section that vanishes
       * when it holds nothing leaves a reader unable to tell whether the scanner looked. */
      const assessments = input.applicability;
      if (!assessments) {
        return [
          "",
          "applicability: not computed for this file — whatever produced it did not run the gate evaluator, which is not the same as a run in which no gate was assessed.",
        ];
      }
      const notAssessed = input.applicability_not_assessed ?? [];
      const total = assessments.length + notAssessed.length;
      const out = [
        "",
        `applicability (the mechanical gate test, run here over this run's own census facts and profile): ${assessments.length} of ${total} bundled checklist(s) assessed, ${notAssessed.length} not assessed.`,
      ];
      const VERDICTS = ["applies", "likely-applies", "does-not-apply", "unresolved"];
      const byVerdict = new Map<string, string[]>(VERDICTS.map((v) => [v, []]));
      // A verdict word this console does not know about is named rather than dropped. It cannot
      // arise from the current evaluator, and an unknown value silently vanishing from a count is
      // the one way this block could report fewer gates than were assessed and look complete.
      const unknownVerdicts: string[] = [];
      for (const a of assessments) {
        const bucket = byVerdict.get(a.verdict);
        if (bucket) bucket.push(a.checklist_id);
        else unknownVerdicts.push(`${a.checklist_id} -> ${a.verdict}`);
      }
      out.push(`  by verdict: ${VERDICTS.map((v) => `${v} ${byVerdict.get(v)!.length}`).join(", ")}`);
      for (const v of VERDICTS) {
        const ids = byVerdict.get(v)!;
        if (ids.length > 0) out.push(`    ${v}: ${ids.join(", ")}`);
      }
      if (unknownVerdicts.length > 0) {
        out.push(`    verdict word this summary does not recognise: ${unknownVerdicts.join(", ")}`);
      }
      if (notAssessed.length > 0) {
        out.push(
          `  not assessed — ${notAssessed.length} bundled checklist(s) carry no gate limbs, so nothing above says anything about ${notAssessed.length === 1 ? "it" : "them"}, and the agent still walks ${notAssessed.length === 1 ? "its" : "their"} gate from its prose: ${notAssessed.join(", ")}`,
        );
      }

      // The limbs where the profile's answer and this run's census do not agree. `contradictions[]`
      // is built by filtering exactly the limbs in this state, so the two counts are printed from
      // their own sources and compared rather than assumed equal: if they ever stop matching, the
      // difference is named here instead of one of the two lists quietly going missing.
      const contradictedLimbs = assessments.flatMap((a) =>
        a.limbs.filter((l) => l.state === "contradicted-by-declaration").map((l) => `${a.checklist_id}/${l.limb_id}`),
      );
      const contradictionEntries = assessments.flatMap((a) =>
        (a.contradictions ?? []).map((c) => `${a.checklist_id}/${c.limb_id}`),
      );
      const onlyIn = (xs: string[], ys: string[]) => xs.filter((x) => !ys.includes(x));
      const settledByDeclaration = assessments.reduce(
        (n, a) => n + a.limbs.filter((l) => l.state === "settled-by-declaration").length,
        0,
      );
      // Two states, both of which exist only because a profile answered a limb the gate names a
      // field for. Printed with the count of each, and with the reason there can be none: a run with
      // no profile is a run in which nobody was asked, and that has to read differently from a run
      // in which someone was asked and agreed with their own tree.
      out.push(
        `  limbs in a declaration state: settled-by-declaration ${settledByDeclaration}, contradicted-by-declaration ${contradictedLimbs.length}` +
          (input.profile ? "" : " (no --profile was given, so no limb can be in either state)"),
      );
      const missingEntry = onlyIn(contradictedLimbs, contradictionEntries);
      const missingLimb = onlyIn(contradictionEntries, contradictedLimbs);
      if (missingEntry.length > 0 || missingLimb.length > 0) {
        out.push(
          `  ! the two records of that disagreement do not match: ${missingEntry.length} limb(s) in the contradicted state carry no contradictions[] entry (${missingEntry.join(", ") || "none"}), and ${missingLimb.length} entr(ies) name a limb not in that state (${missingLimb.join(", ") || "none"})`,
        );
      }

      // One printed question per distinct disagreement, not per gate. Three of the bundled
      // checklists reference one CRA scope gate, so the same limb, the same profile field and the
      // same facts come back three times; printing the sentence three times would make one question
      // look like three. The count of limbs is kept on the header so nothing is hidden by the
      // grouping.
      const groups = new Map<
        string,
        {
          limb_id: string;
          declared_by: string;
          question: string;
          answer: string;
          /**
           * Whether the tree settles this limb on its own — `settledByCode` in scope.ts, the same
           * test `scan.ts` makes before printing its own version of this line. It decides which
           * of the two sentences below the question carries, and the two say opposite things about
           * what the person's answer changes, so getting it from the emitted limb rather than from
           * the state is the whole point.
           */
          settledByTree: boolean;
          evidence: ScopeEvidence[];
          /**
           * The EXACT number of facts on this limb, from `contradictions[].evidence_count`, which is
           * computed before the 20-example cap. `evidence` is a preview and its length is not the
           * population — MODERATE 1 of the 2026-09-03 verification, where this console printed
           * "holds 20 fact(s) … and 19 more" over a limb carrying 228.
           */
          evidence_count: number;
          checklists: string[];
        }
      >();
      for (const a of assessments) {
        for (const c of a.contradictions ?? []) {
          const key = `${c.limb_id} ${c.declared_by} ${c.evidence.map((e) => e.fact_id).join(",")}`;
          const seen = groups.get(key);
          if (seen) {
            seen.checklists.push(a.checklist_id);
            // OR-ed rather than left at the first gate's value: a group is one question printed
            // once, and if any gate in it settles the limb from the tree, the sentence that says
            // the answer does not move that verdict is the true one for that gate.
            const seenLimb = a.limbs.find((l) => l.limb_id === c.limb_id);
            seen.settledByTree = seen.settledByTree || (seenLimb !== undefined && settledByCode(seenLimb));
            continue;
          }
          const limb = a.limbs.find((l) => l.limb_id === c.limb_id);
          groups.set(key, {
            // Since 2026-11-10 only a `decided_by: code` limb is settled by the tree: a limb about
            // the product never is, whatever it holds (`settledByCode`, scope.ts).
            settledByTree: limb !== undefined && settledByCode(limb),
            evidence_count: c.evidence_count ?? c.evidence.length,
            limb_id: c.limb_id,
            declared_by: c.declared_by,
            question: (limb?.question ?? "").replace(/\s+/g, " ").trim(),
            // Read back from the emitted limb rather than assumed. Only a declared `false` can put a
            // limb in this state today, and writing `answers "no"` as a constant would be this
            // console asserting a property of `scope.ts` that it does not itself check.
            answer:
              limb?.declared_value === false
                ? 'answers "no"'
                : limb?.declared_value === true
                  ? 'answers "yes"'
                  : `records declared_value ${JSON.stringify(limb?.declared_value ?? null)}`,
            evidence: c.evidence,
            checklists: [a.checklist_id],
          });
        }
      }
      if (groups.size === 0) {
        out.push(
          input.profile
            ? "  No limb where the profile's answer and this run's census disagree. That is a statement about the limbs a gate names a profile field for, and about this run's facts; it is not a statement that anything was verified."
            : '  Nobody was asked on this run, so there is nothing here to disagree with. An unasked limb is never read as a "no": pass --profile to answer the limbs the gates name a field for.',
        );
      } else {
        out.push(
          `  ${contradictedLimbs.length} limb(s) where the profile's answer and this run's census do not agree — ${groups.size} distinct question${groups.size === 1 ? "" : "s"}, and this run answers none of them:`,
        );
        for (const g of groups.values()) {
          out.push(`  ? ${g.limb_id}  (reported by ${g.checklists.join(", ")})`);
          if (g.question) out.push(`    The limb asks: ${g.question}`);
          const first = g.evidence[0];
          const where = first ? `the first of them is ${first.kind} at ${first.file}:${first.line}` : "none of them is carried here";
          /* **THE POPULATION, NEVER THE SAMPLE'S LENGTH** (independent verification, 2026-09-03,
           * MODERATE 1). `evidence[]` became a 20-example sample the day the containment landed, and
           * these two sentences went on reading its length: on one tree the console said "this run's
           * census holds 20 fact(s) … and 19 more" over a limb whose `evidence_count` is 228. Both
           * lines were exact before the cap, and `scope.ts`'s own claim that "nothing is silent" was
           * true of every verdict and false of the prose a person actually reads. The exact figure
           * sits one field away and is what both numbers now come from; the sample's own size is
           * said out loud where the two differ, so a reader knows the list is a preview. */
          const shown = g.evidence.length;
          const total = g.evidence_count;
          const rest =
            total > 1
              ? `, and ${total - 1} more${total > shown ? ` (this file carries ${shown} of them as examples; all ${total} are counted)` : ""}`
              : "";
          out.push(
            `    The scan profile field ${g.declared_by} ${g.answer}, and this run's census holds ${total} fact(s) the gate names as bearing on that limb — ${where}${rest}. ` +
              "The evidence for that sits in this file's applicability[].contradictions[].evidence. " +
              "The scanner leaves this disagreement open and never answers for the person: the limb asks a fact about the product, which is asked of the person running the scan, and the census can corroborate or contradict that answer while this file never rewrites it — declared_value still records what was answered. " +
              `Please answer or confirm ${g.declared_by}, or say which of those lines is not what it looks like.`,
          );
          // **What the answer actually moves, said on the line that asks for it.** The same branch
          // `scan.ts` prints under its own contradiction block, in the same two directions, brought
          // here because without it the ask above overpromises: on the trees where the tree settles
          // the limb by itself, answering the question either way leaves that checklist's verdict
          // exactly where it is, and a person who reads "please answer or confirm" alone will expect
          // otherwise. It is still worth answering, and the sentence says why rather than dropping
          // the ask.
          out.push(
            g.settledByTree
              ? "    Your answer does not move this checklist's verdict: the facts above settle the limb on their own, so the same verdict follows whichever way the field is answered — it still matters for the record, and for every limb this run leaves open."
              : "    None of those facts can decide the limb on its own, so your answer does not close it and the tree does not close it either — it stays open for you to answer.",
          );
        }
      }
      // Printed in every branch, for the reason the declared-artifacts caveat above is: a block a
      // reader meets on the way to the gate walk must say what it is before they act on it.
      out.push(
        "  A verdict here is a classification and not a finding, and nothing in this file was removed, suppressed or downgraded by one. " +
          "These states are evidence for the agent's gate walk rather than the answer to it, and reconcile-input.schema.json's applicability field is where that is stated in full.",
      );
      return out;
    })(),
    "",
    `Next: reconcile the documents against these facts (see the declaration-reconcile skill). ${
      input.checklist_ids.length > 0
        ? `Checklists in bundle (${input.checklist_ids.length}): ${input.checklist_ids.join(", ")}. Each carries its own applicability gate — answer it before walking that list's items.`
        : "No checklists in this bundle."
    }`,
  );

  return lines.join("\n");
}

/**
 * THE IDS A SEAT NAMES THINGS BY, AND FROM WHICH NUMBER EACH COUNTS.
 * One definition for whoever numbers them and whoever checks them: in the build the smoke test
 * ran, the program numbered places from `P0` and the `standing` check refused index 0, so every part a seat rested on
 * the first place was set aside. Every numbering, every check and the schemas' patterns take their form from here: the
 * place plan's test compares the schemas' patterns with these, and finds any other source that tests an id form of its
 * own.
 *
 * - A place: `P<n>`, n the place's position in the candidate's `locations`, counted from `P0` (the first location).
 * - The reading plan's unit of the same location: `L<n>`, the same n, counted from `L0`.
 * - An entry of a verdict's own `evidence[]`: `E<n>`, counted from `E1` (the first entry).
 * - One of the rule's legal bases, in `standing.duty`: `L<n>`, counted from `L1` (the first of the candidate's
 *   `legal_basis_refs`). A different list from the reading plan's units, read only in `duty`.
 */

/** A count from 0 written without a leading zero. */
const FROM_0 = "(?:0|[1-9][0-9]*)";
/** A count from 1 written without a leading zero. */
const FROM_1 = "[1-9][0-9]*";

/** Pattern sources (no anchors), for a schema or a larger pattern. */
export const PLACE_ID = `P${FROM_0}`;
export const UNIT_ID = `L${FROM_0}`;
export const EVIDENCE_ID = `E${FROM_1}`;
export const BASIS_ID = `L${FROM_1}`;
/** What a `standing` part's `at` (and `decisive`) names by id: an evidence entry or a place. */
export const STANDING_REF_ID = `(?:${EVIDENCE_ID}|${PLACE_ID})`;
/** The whole-string form a schema carries for each, and the one these functions test. */
export const anchored = (source: string): string => `^${source}$`;

const PLACE_RE = new RegExp(anchored(PLACE_ID));
const UNIT_RE = new RegExp(anchored(UNIT_ID));
const EVIDENCE_RE = new RegExp(anchored(EVIDENCE_ID));
const BASIS_RE = new RegExp(anchored(BASIS_ID));

const countOf = (id: string): number => Number(id.slice(1));

/** The place id of the location at `index` of the candidate's `locations`. */
export const placeId = (index: number): string => `P${index}`;
export const isPlaceId = (id: unknown): id is string => typeof id === "string" && PLACE_RE.test(id);
/** The position in `locations` a place id names, or null where it is no place id. */
export const placeIndexOf = (id: unknown): number | null => (isPlaceId(id) ? countOf(id) : null);

/** The reading plan's unit id of the location at `index`. */
export const unitId = (index: number): string => `L${index}`;
export const isUnitId = (id: unknown): id is string => typeof id === "string" && UNIT_RE.test(id);
/** The unit id of the same location as a place id (`P17` -> `L17`), or null where it is no place id. */
export const unitOfPlace = (place: unknown): string | null => (isPlaceId(place) ? unitId(countOf(place)) : null);
/** The place id of the same location as a unit id (`L17` -> `P17`), or null where it is no unit id. */
export const placeOfUnit = (unit: unknown): string | null => (isUnitId(unit) ? placeId(countOf(unit)) : null);

/** The id of `evidence[index]` (index from 0): `E1` is the first entry. */
export const evidenceId = (index: number): string => `E${index + 1}`;
/** The index in `evidence[]` (from 0) an evidence id names, or null where it is no evidence id. */
export const evidenceIndexOf = (id: unknown): number | null => (typeof id === "string" && EVIDENCE_RE.test(id) ? countOf(id) - 1 : null);

/** The id of `legal_basis_refs[index]` (index from 0): `L1` is the first basis. */
export const basisId = (index: number): string => `L${index + 1}`;
/** The index in `legal_basis_refs` (from 0) a basis id names, or null where it is no basis id. */
export const basisIndexOf = (id: unknown): number | null => (typeof id === "string" && BASIS_RE.test(id) ? countOf(id) - 1 : null);

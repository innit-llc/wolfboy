/**
 * The declaration's file names and the scan's review flag, in a module that
 * imports nothing. declaration.ts defines what the declaration is and re-exports these names; the write
 * guard (hook-guard.ts) names them in its refusals and its tables, and takes them from here, so that the guard's
 * module, which a Write, Edit, Read and shell call loads in every session, does not load declaration.ts and the schema
 * code it reads (some 20 ms of the routes' process on Linux, measured in the record).
 */
export const DECLARATION_PROFILE_FILE = "profile.json";
export const DECLARATION_RECORD_FILE = "profile-record.json";
/**
 * The scan's review entrance: it puts the saved answers this run's candidates turn on back to the person
 * as questions, in a session through the relay and in a terminal at once; refused with no terminal and in CI, where
 * nobody is asked. One name: the scan command registers it by this constant, the statement names it through `{flag}`,
 * and the write guard's refusal names it.
 */
export const REVIEW_DECLARATION_FLAG = "--review-declaration";

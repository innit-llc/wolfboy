/**
 * THE INSTALL GUARD'S SWITCH.
 *
 * Imported first by every module the program starts a process or a thread with (index.js, hook-entry.js,
 * hook-child.js, worker-entry.js, census-worker.js, ruby-prism.js), and by nothing else: evaluating it turns the
 * install guard on for that thread (install-guard.ts, `guardThisInstall`: in an installed plugin, the check of
 * install-files.json, then the refusal of any module resolved outside the install). The guard's own module runs nothing
 * when imported, so the package's build and pack scripts may take its functions (scripts/install-files.mjs takes
 * `packageFolder`) without the guard acting on them; test:release-package holds both halves.
 */
import { guardThisInstall } from "./install-guard.js";

guardThisInstall();

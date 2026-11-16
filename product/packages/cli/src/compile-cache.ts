/**
 * NODE'S MODULE COMPILE CACHE FOR
 * THE HOOKS' ROUTES. The routes' thread or process (hook-child.ts) turns it on before it loads hook.js and the route
 * modules, so that a later hook call reads their compiled code from the cache instead of compiling them again
 * (`module.enableCompileCache`, Node 22.1 and later; on an older Node nothing is turned on).
 *
 * WHERE IT MAY BE. The cache holds code Node runs, so it lives where only what can already change the plugin's own
 * files can write: the plugin's data folder Claude Code gives every hook process (CLAUDE_PLUGIN_DATA,
 * `~/.claude/plugins/data/<id>/`, kept across updates and deleted with the plugin), in its folder
 * `node-compile-cache`. Never inside the scanned repository: where that folder, or the nearest of its folders that
 * exists, is by its real path the project folder (CLAUDE_PROJECT_DIR) or inside it, or the working folder or inside it,
 * or where CLAUDE_PLUGIN_DATA is unset or not an absolute path, no cache is turned on.
 *
 * IT DECIDES NOTHING. Turning it on, a folder that cannot be made or written, a cache Node finds stale or broken: each
 * only changes how fast a module loads. Every failure here is swallowed, Node itself ignores a cache it cannot read or
 * write, and nothing here reads the event. This module imports only Node's own modules.
 */
import * as nodeModule from "node:module";
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, sep } from "node:path";

/** The variable Claude Code sets, for every hook process, to the plugin's data folder. */
export const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
/** The cache's own folder inside it. */
export const COMPILE_CACHE_FOLDER = "node-compile-cache";

/** `p` by its real path where only its first part exists: the nearest existing folder's real path and the names below it. */
function realOrNearest(p: string): string | null {
  const below: string[] = [];
  let at = p;
  for (let n = 0; n < 256; n++) {
    try {
      const r = realpathSync.native(at);
      return below.length === 0 ? r : join(r, ...below);
    } catch {
      const up = dirname(at);
      if (up === at) return null;
      below.unshift(basename(at));
      at = up;
    }
  }
  return null;
}

/** Whether `inner` is `outer` or inside it, both real paths; without regard to case where the file system usually has none. */
function atOrInside(inner: string, outer: string, platform: NodeJS.Platform): boolean {
  const fold = (s: string): string => (platform === "win32" || platform === "darwin" ? s.toLowerCase() : s);
  const o = fold(outer).replace(/[\\/]+$/, "");
  const i = fold(inner);
  return i === o || i.startsWith(`${o}${sep}`) || (platform === "win32" && i.startsWith(`${o}/`));
}

/** The cache's folder for these surroundings, or null where it may not be (above). */
export function hookCompileCacheDir(env: NodeJS.ProcessEnv, cwd: string, platform: NodeJS.Platform = process.platform): string | null {
  const data = env[PLUGIN_DATA_ENV];
  if (typeof data !== "string" || data === "" || !isAbsolute(data)) return null;
  const dir = join(data, COMPILE_CACHE_FOLDER);
  const real = realOrNearest(dir);
  if (real === null) return null;
  for (const place of [env.CLAUDE_PROJECT_DIR, cwd]) {
    if (typeof place !== "string" || place === "" || !isAbsolute(place)) continue;
    const placeReal = realOrNearest(place);
    if (placeReal === null || atOrInside(real, placeReal, platform) || atOrInside(dir, place, platform)) return null;
  }
  return dir;
}

/** Turns the cache on for this thread where it may be; never throws, and decides nothing. */
export function enableHookCompileCache(): void {
  try {
    const enable = (nodeModule as unknown as { enableCompileCache?: (dir: string) => unknown }).enableCompileCache;
    if (typeof enable !== "function") return;
    const dir = hookCompileCacheDir(process.env, process.cwd());
    if (dir !== null) enable(dir);
  } catch {
    // no cache: modules compile as they always did
  }
}

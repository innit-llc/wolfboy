/**
 * The proxy variables the web-archive client reads (archive.ts), in a module
 * that imports nothing: host-env.ts lists them, and importing archive.ts for their names loaded engine.js and with it
 * the install guard's switch (ruby-prism.ts), so any process that read the host's list switched the guard on.
 */
export const HTTPS_PROXY_ENV = "HTTPS_PROXY";
export const HTTPS_PROXY_LOWER_ENV = "https_proxy";
export const HTTP_PROXY_ENV = "HTTP_PROXY";
export const HTTP_PROXY_LOWER_ENV = "http_proxy";
export const NO_PROXY_ENV = "NO_PROXY";
export const NO_PROXY_LOWER_ENV = "no_proxy";

/** The proxy a request goes through: its host, its port, and the `Proxy-Authorization` value its address carries, if any. */
export interface ProxyAddress {
  host: string;
  port: number;
  auth: string | null;
}

/**
 * THE ONE READING OF THE PROXY VARIABLES, for every
 * request this program sends (the archive lookup, a `--policy` URL, the CI check run). An `https:` address goes through
 * `HTTPS_PROXY` (or `https_proxy`), an `http:` one through `HTTP_PROXY` (or `http_proxy`); `NO_PROXY` (or `no_proxy`) naming
 * the host, a domain above it or `*` sends it directly. Null where no proxy applies; `{ refused }` where the variable names a
 * proxy that is not an `http://` address, the only kind this program speaks to, so that nothing is sent around it. Until
 * 2026-11-10 only the archive lookup read these variables: a `--policy` URL and the check run went straight out.
 * Imports nothing, as the rest of this module.
 */
export function proxyFor(env: NodeJS.ProcessEnv, target: { protocol: string; hostname: string }): ProxyAddress | null | { refused: "not-http" } {
  const https = target.protocol === "https:";
  const raw = ((https ? (env[HTTPS_PROXY_ENV] ?? env[HTTPS_PROXY_LOWER_ENV]) : (env[HTTP_PROXY_ENV] ?? env[HTTP_PROXY_LOWER_ENV])) ?? "").trim();
  if (raw === "") return null;
  const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const no = (env[NO_PROXY_ENV] ?? env[NO_PROXY_LOWER_ENV] ?? "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => s !== "");
  const covered = no.some((n) => {
    if (n === "*") return true;
    const d = n.replace(/^\*?\./, "").replace(/:\d+$/, "");
    return host === d || host.endsWith(`.${d}`);
  });
  if (covered) return null;
  let u: URL;
  try {
    u = new URL(raw.includes("://") ? raw : `http://${raw}`);
  } catch {
    return { refused: "not-http" };
  }
  if (u.protocol !== "http:" || u.hostname === "") return { refused: "not-http" };
  const auth = u.username !== "" ? `Basic ${Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64")}` : null;
  return { host: u.hostname.replace(/^\[|\]$/g, ""), port: u.port === "" ? 80 : Number(u.port), auth };
}

// ── External v1-compatible server helpers ────────────────────────
// Pure helpers shared by main (chat.ts endpoint resolution) and the
// renderer (EditProfileModal validation). No electron/node imports so
// both sides — and jest — can use them directly.

/**
 * Validate + normalize a user-entered external server URL.
 * Accepts "host:port" or "host" shorthand as http:// for convenience,
 * requires http/https schemes, drops query/hash and any trailing slash
 * (the client appends its own paths: /health, /v1/chat/completions, …).
 * Returns null when the input cannot form a valid origin.
 */
export function normalizeExternalServerUrl(raw: string): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  let candidate = trimmed;
  // Shorthand: "192.168.1.10:8080" or "localhost" → assume http.
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) {
    candidate = `http://${candidate}`;
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;
  // Keep an optional base path (proxies mount llama-server under a prefix),
  // but drop query/hash and any trailing slash — we append our own paths.
  const basePath = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${basePath}`;
}

/** True when the raw input normalizes to a usable external origin. */
export function isValidExternalServerUrl(raw: string): boolean {
  return normalizeExternalServerUrl(raw) !== null;
}

// Secret-store addressing for per-profile external server API keys.
// The key itself never lives on the Profile object (localStorage) — only
// in the main-process encrypted store, addressed by these helpers.
// Scope is per-profile so deleting a profile drops its whole scope.
export function externalServerSecretScope(profileId: string): string {
  return `profile:${profileId}`;
}

export const EXTERNAL_API_KEY_SECRET_KEY = 'externalApiKey';

/**
 * Bearer token for the llama-server Synapse launches itself. Same per-profile
 * scope as the external key (deleting a profile drops both), different key.
 * llama.cpp v1.0.0 (#32113) disables server tools/MCP on a non-loopback bind
 * unless a key is set, so a LAN-shared profile needs one to keep tools.
 */
export const LOCAL_API_KEY_SECRET_KEY = 'localServerApiKey';

/**
 * True when a server bound to this host can only be reached from this machine.
 * llama.cpp v1.0.0 gates the parts of its API that a stranger could abuse
 * (tools, MCP, private-URL media) on exactly this distinction, so both the
 * launch arguments and the profile UI need the same answer. `0.0.0.0` and `::`
 * are wildcard binds, not loopback — they are the case that needs a key.
 */
export function isLoopbackHost(host: string): boolean {
  const h = (host ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  return /^127(\.\d{1,3}){3}$/.test(h);
}

/**
 * Validate + normalize a user-entered --cors-origins list. llama.cpp matches
 * this against browser Origin headers, so only '*', the documented special
 * value 'localhost' (same-origin only), and scheme-qualified origins can ever
 * match; a bare host like "192.168.1.5" parses but matches nothing.
 * Returns the string to pass to llama-server, or null when the list must be
 * dropped.
 */
export function normalizeCorsOrigins(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1 && parts[0] === '*') return '*';
  if (parts.length === 1 && parts[0].toLowerCase() === 'localhost')
    return 'localhost';
  const valid = parts.every((part) => /^https?:\/\/[^/\s,]+$/i.test(part));
  return valid ? parts.join(',') : null;
}

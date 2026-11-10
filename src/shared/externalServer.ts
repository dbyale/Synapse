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

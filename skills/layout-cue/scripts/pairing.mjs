// Shared rules for the localhost agent-pairing bridge. This module must stay
// browser-safe: the extension imports isAllowedAuditOrigin from it.

// Chrome derives an unpacked extension ID from the SHA-256 of its absolute
// directory, encoding the first 16 bytes as letters a-p. Web Crypto keeps this
// usable in both Node and the extension service worker.
export async function extensionIdFromDirectory(directory) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(directory)));
  let id = '';
  for (const byte of bytes.subarray(0, 16)) {
    id += String.fromCharCode(97 + (byte >> 4));
    id += String.fromCharCode(97 + (byte & 15));
  }
  return id;
}

export function isAllowedAuditOrigin(url, allowedOrigins) {
  try {
    return allowedOrigins.has(new URL(url).origin);
  } catch {
    return false;
  }
}

export function extensionIdFromNativeManifest(text) {
  try {
    const manifest = JSON.parse(text);
    for (const origin of manifest?.allowed_origins ?? []) {
      const match = /^chrome-extension:\/\/([a-p]{32})\/$/.exec(origin);
      if (match) return match[1];
    }
  } catch {}
  return null;
}

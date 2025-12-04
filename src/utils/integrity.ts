// core/utils/integrity.ts
export const isBrowser =
  typeof window !== "undefined" && typeof window.document !== "undefined";

/**
 * Normalize integrity field. Accepts "sha256-<b64>" or "<b64>".
 */
export function parseIntegrity(integrity?: string): string | null {
  if (!integrity) return null;
  const trimmed = integrity.trim();
  if (trimmed.startsWith("sha256-")) return trimmed.slice("sha256-".length);
  return trimmed;
}

/**
 * Compute SHA-256 and return base64 string of the digest.
 * Works in both browser and Node.js.
 */
export async function sha256Base64(
  bytes: ArrayBuffer | Uint8Array,
): Promise<string> {
  if (isBrowser && typeof crypto !== "undefined" && (crypto as any).subtle) {
    const buffer = bytes instanceof ArrayBuffer ? bytes : bytes.buffer;
    const digest = await (crypto as any).subtle.digest("SHA-256", buffer);
    // convert ArrayBuffer to base64
    const u8 = new Uint8Array(digest);
    let binary = "";
    for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
    return btoa(binary);
  } else {
    // Node.js
    const cryptoModule = await import("crypto");
    const hash = cryptoModule.createHash("sha256");
    // Buffer.from works with ArrayBuffer
    const buf =
      bytes instanceof ArrayBuffer ? Buffer.from(bytes) : Buffer.from(bytes);
    hash.update(buf);
    return hash.digest("base64");
  }
}

export async function importFromBytes(bytes: Uint8Array): Promise<any> {
  // Browser: blob URL
  if (isBrowser) {
    const blob = new Blob([bytes], { type: "application/javascript" });
    const blobUrl = URL.createObjectURL(blob);
    try {
      const mod = await import(/* @vite-ignore */ blobUrl);
      return mod;
    } finally {
      setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
    }
  }

  // Node: write temp file and import via file://
  const fs = await import("fs/promises");
  const os = await import("os");
  const path = await import("path");
  const { pathToFileURL } = await import("url");

  const tmpDir = os.tmpdir();
  const fileName = `plugin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mjs`;
  const filePath = path.join(tmpDir, fileName);
  await fs.writeFile(filePath, Buffer.from(bytes));
  try {
    const fileUrl = pathToFileURL(filePath).href;
    const mod = await import(/* @vite-ignore */ fileUrl);
    return mod;
  } finally {
    fs.unlink(filePath).catch(() => {});
  }
}

/**
 * Fetch URL as ArrayBuffer
 */
export async function fetchAsArrayBuffer(url: string): Promise<ArrayBuffer> {
  if (isBrowser) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    return await res.arrayBuffer();
  } else {
    // Node: use fetch if available (node 18+) otherwise fallback to dynamic import of 'node-fetch' is omitted
    // Node 18+ has global fetch
    // This will throw if no global fetch, but most setups running ESM Node 18+ will be fine.
    // If your build targets older Node, add a fetch polyfill or use http(s).get here.
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    return await res.arrayBuffer();
  }
}

/**
 * Given entry URL and expected integrity base64, verify and import module.
 * Returns the imported module.
 */
export async function verifyAndImport(
  entryUrl: string,
  expectedIntegrityB64?: string,
) {
  // If no integrity requested, just import (but we still attempt to fetch and verify only if expected provided)
  if (!expectedIntegrityB64) {
    return await import(/* @vite-ignore */ entryUrl);
  }

  // 1) fetch bytes
  const bytes = await fetchAsArrayBuffer(entryUrl);

  // 2) compute hash
  const actualB64 = await sha256Base64(bytes);

  if (actualB64 !== expectedIntegrityB64) {
    throw new Error(
      `Integrity mismatch for ${entryUrl}. expected=${expectedIntegrityB64} actual=${actualB64}`,
    );
  }

  // 3) If browser: create blob URL and import
  if (isBrowser) {
    const blob = new Blob([bytes], { type: "application/javascript" });
    const blobUrl = URL.createObjectURL(blob);
    try {
      const mod = await import(/* @vite-ignore */ blobUrl);
      return mod;
    } finally {
      // revoke
      setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
    }
  }

  // 4) Node.js: write a temp file and import from file://
  else {
    const fs = await import("fs/promises");
    const os = await import("os");
    const path = await import("path");
    const { pathToFileURL } = await import("url");

    const tmpDir = os.tmpdir();
    const fileName = `plugin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mjs`;
    const filePath = path.join(tmpDir, fileName);
    await fs.writeFile(filePath, Buffer.from(bytes));

    try {
      const fileUrl = pathToFileURL(filePath).href;
      const mod = await import(/* @vite-ignore */ fileUrl);
      return mod;
    } finally {
      // cleanup file (async, don't block)
      fs.unlink(filePath).catch(() => {});
    }
  }
}

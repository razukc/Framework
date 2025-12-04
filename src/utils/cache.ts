// core/utils/cache.ts
// Cross-runtime cache for plugin bytes.
// Browser: IndexedDB (store under DB name "my_framework_plugins")
// Node: file cache (directory: either process.cwd()/.plugin_cache or os.tmpdir())
// Note: the Node-side caching uses encoded URL as filename. For production, you'd want to hash the URL (sha256 hex) to ensure safe filenames; I used encodeURIComponent for simplicity and clarity. We can switch to a hash quickly if you prefer.

export const isBrowser =
  typeof window !== "undefined" && typeof window.document !== "undefined";

type CacheRecord = {
  url: string; // entry URL
  manifestUrl?: string; // manifest URL
  version?: string; // manifest.version if available
  integrityB64?: string; // base64 sha256 used to verify cached bytes
  bytes: Uint8Array; // raw bytes of entry file
  cachedAt: number;
};

/* ---------------- Browser IndexedDB ---------------- */
async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("my_framework_plugins", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("plugins")) {
        db.createObjectStore("plugins", { keyPath: "url" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(url: string): Promise<CacheRecord | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("plugins", "readonly");
    const store = tx.objectStore("plugins");
    const r = store.get(url);
    r.onsuccess = () => resolve(r.result ?? null);
    r.onerror = () => reject(r.error);
  });
}

async function idbPut(record: CacheRecord): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("plugins", "readwrite");
    const store = tx.objectStore("plugins");
    const r = store.put(record);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

/* ---------------- Node file cache ---------------- */
import { promises as fsPromises } from "fs";
import * as path from "path";
import * as os from "os";

function nodeCacheDir(): string {
  // prefer .plugin_cache in project root, fallback to tmpdir
  const projectCache = path.join(process.cwd(), ".plugin_cache");
  try {
    // ensure exists
    if (!fsPromises.stat(projectCache)) {
      // noop; actual creation happens in write
    }
    return projectCache;
  } catch {
    return path.join(os.tmpdir(), "my_framework_plugin_cache");
  }
}

async function ensureDir(dir: string) {
  try {
    await fsPromises.mkdir(dir, { recursive: true });
  } catch {
    // ignore
  }
}

// helper to convert URL string to sha256 hex
async function urlToHashHex(url: string): Promise<string> {
  const crypto = await import("crypto");
  const hash = crypto.createHash("sha256");
  hash.update(url);
  return hash.digest("hex");
}

async function nodeGet(url: string): Promise<CacheRecord | null> {
  const dir = nodeCacheDir();
  const hash = await urlToHashHex(url); // safe filename
  const metaPath = path.join(dir, `${hash}.meta.json`);
  const bytesPath = path.join(dir, `${hash}.bytes`);
  try {
    const metaRaw = await fsPromises.readFile(metaPath, "utf-8");
    const meta = JSON.parse(metaRaw);
    const bytes = await fsPromises.readFile(bytesPath);
    return {
      url,
      manifestUrl: meta.manifestUrl,
      version: meta.version,
      integrityB64: meta.integrityB64,
      bytes: new Uint8Array(bytes),
      cachedAt: meta.cachedAt || Date.now(),
    };
  } catch {
    return null;
  }
}

async function nodePut(record: CacheRecord): Promise<void> {
  const dir = nodeCacheDir();
  await ensureDir(dir);
  const hash = await urlToHashHex(record.url);
  const metaPath = path.join(dir, `${hash}.meta.json`);
  const bytesPath = path.join(dir, `${hash}.bytes`);
  const meta = {
    manifestUrl: record.manifestUrl,
    version: record.version,
    integrityB64: record.integrityB64,
    cachedAt: record.cachedAt || Date.now(),
  };
  await fsPromises.writeFile(metaPath, JSON.stringify(meta), "utf-8");
  await fsPromises.writeFile(bytesPath, Buffer.from(record.bytes));
}

/* ---------------- Public API ---------------- */

export async function cacheGet(url: string): Promise<CacheRecord | null> {
  if (isBrowser) {
    return await idbGet(url);
  } else {
    return await nodeGet(url);
  }
}

export async function cachePut(
  record: Omit<CacheRecord, "cachedAt">,
): Promise<void> {
  const rec: CacheRecord = { ...record, cachedAt: Date.now() };
  if (isBrowser) {
    await idbPut(rec);
  } else {
    await nodePut(rec);
  }
}

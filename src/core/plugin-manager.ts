// core/PluginManager.ts
import { compareVersions } from "../utils/semver.js";
import {
  parseIntegrity,
  sha256Base64,
  importFromBytes,
  fetchAsArrayBuffer,
  calculateIntegrity,
} from "../utils/integrity.js";
import { cacheGet, cachePut } from "../utils/cache";
import { verifyManifestSignature } from "../utils/signature";

type PluginType = "local" | "remote" | "wasm" | "unknown";
export type PluginEnvironment = "development" | "production" | "test";
export interface PluginContext {
  env: PluginEnvironment;
  app: any;
}
export interface Plugin {
  name: string;
  version?: string;
  type?: PluginType;
  setup: (ctx: PluginContext) => void | Promise<void>;
  install?: (app: any, options?: Record<string, any>) => Promise<void> | void;
  onInit?: (app: any) => void;
  onReady?: (app: any) => void;
  onError?: (error: any) => void;
  onUnload?: () => void;
}

interface PluginManifest {
  name: string;
  version?: string;
  entry: string;
  type?: "module" | "commonjs";
  compatibility?: Record<string, string>;
  env?: PluginEnvironment[];
  signature?: string;
  integrity?: string;
  metadata?: Record<string, any>;
}

interface PluginRecord {
  instance: Plugin;
  manifest?: PluginManifest;
  type: PluginType;
  context?: any;
}

export class PluginManager {
  private app: any;
  private plugins: Map<string, PluginRecord> = new Map();
  private events = new Map<string, Set<(data?: any) => void>>();
  private cacheKey = "plugin-manifests-cache";
  private env: PluginEnvironment;
  private cache: Map<string, any> = new Map();

  constructor(
    app: any,
    env: PluginEnvironment = (process.env.NODE_ENV as PluginEnvironment) ||
      "development",
  ) {
    this.app = app;
    this.env = env;
  }

  /**
   * Unified method for installing any plugin
   */
  async use(pluginOrManifest: Plugin | PluginManifest, ctx: PluginContext) {
    if ("setup" in pluginOrManifest) {
      return this.register(pluginOrManifest, ctx);
    } else {
      return this.installRemote(pluginOrManifest, ctx);
    }
  }

  private async register(plugin: Plugin, ctx: PluginContext) {
    if (this.plugins.has(plugin.name)) return;
    this.plugins.set(plugin.name, plugin);
    await plugin.setup(ctx);
    console.log(`[PluginManager] Registered: ${plugin.name}`);
  }
  // async use(pluginOrName: any, options?: any): Promise<void> {
  //   try {
  //     const type = this.resolveType(pluginOrName);
  //     if (type === "local") {
  //       await this.installLocal(pluginOrName, options);
  //     } else if (type === "remote") {
  //       await this.installRemote(pluginOrName.url, options);
  //     } else {
  //       console.warn(`[PluginManager] Unknown plugin type:`, pluginOrName);
  //     }
  //   } catch (error) {
  //     console.error(`[PluginManager] Failed to install plugin:`, error);
  //   }
  // }

  /**
   * Determine if the plugin is local, remote or unknown
   */
  private resolveType(pluginOrName: any): PluginType {
    if (typeof pluginOrName === "object" && pluginOrName.install)
      return "local";
    if (typeof pluginOrName === "object" && pluginOrName.from === "remote")
      return "remote";
    return "unknown";
  }

  /**
   * Install a local plugin
   */
  private async installLocal(plugin: Plugin, options?: any) {
    if (this.plugins.has(plugin.name)) {
      console.warn(
        `[PluginManager] Plugin "${plugin.name}" already installed.`,
      );
      return;
    }

    try {
      const context = this.createContext(plugin.name);
      if (plugin.install)
        await plugin.install(this.app, { ...options, context });
      plugin.onInit?.(this.app);
      this.plugins.set(plugin.name, {
        instance: plugin,
        type: "local",
        context,
      });
      console.log(`[PluginManager] Installed local plugin: ${plugin.name}`);
    } catch (err) {
      plugin.onError?.(err);
      throw err;
    }
  }

  /**
   * Install a remote plugin via manifest.json
   */
  private async installRemote(baseUrl: string, options?: any) {
    const manifestUrl = `${baseUrl.replace(/\/$/, "")}/manifest.json`;
    const cachedManifests = this.getCachedManifests();
    const cached = cachedManifests[manifestUrl];
    let manifest: PluginManifest | null = null;
    try {
      const res = await fetch(manifestUrl, { cache: "no-store" });
      if (!res.ok)
        throw new Error(`Failed to load manifest from ${manifestUrl}`);
      const fetched: PluginManifest = await res.json();
      // Compare versions (use cached if up-to-date)
      if (
        cached &&
        cached.version &&
        fetched.version &&
        compareVersions(fetched.version, cached.version) <= 0
      ) {
        console.log(
          `[PluginManager] Using cached manifest for ${fetched.name}`,
        );
        manifest = cached;
      } else {
        manifest = fetched;
        cachedManifests[manifestUrl] = fetched;
        this.saveCachedManifests(cachedManifests);
        console.log(
          `[PluginManager] Updated manifest cached for ${fetched.name}`,
        );
      }
    } catch (err) {
      if (cached) {
        console.warn(
          `[PluginManager] Offline mode: using cached manifest for ${cached.name}`,
        );
        manifest = cached;
      } else {
        throw err;
      }
    }
    if (!manifest)
      throw new Error(`Manifest could not be loaded: ${manifestUrl}`);
    if (this.plugins.has(manifest.name)) {
      console.warn(
        `[PluginManager] Plugin "${manifest.name}" already installed.`,
      );
      return;
    }

    const entryUrl = `${baseUrl.replace(/\/$/, "")}/${manifest.entry}`;
    const expectedB64 = parseIntegrity(manifest.integrity); // returns base64 or null

    // Place this check before any network fetch or cache load to prevent malicious installs.
    const publicKey = `-----BEGIN PUBLIC KEY-----
    ...your trusted public key...
    -----END PUBLIC KEY-----`;

    if (!verifyManifestSignature(manifest, publicKey)) {
      throw new Error(
        `[PluginManager] Manifest signature verification failed for plugin ${manifest.name}`,
      );
    }

    // Try cache first
    try {
      const cached = await cacheGet(entryUrl);
      if (
        cached &&
        expectedB64 &&
        cached.integrityB64 === expectedB64 &&
        cached.version === manifest.version
      ) {
        // safe to use cached bytes
        console.log(
          `[PluginManager] Loading plugin "${manifest.name}" from local cache.`,
        );
        const mod = await importFromBytes(cached.bytes);
        const plugin: Plugin = mod.default || mod;
        const context = this.createContext(manifest.name);
        if (plugin.install)
          await plugin.install(this.app, { ...options, context });
        plugin.onInit?.(this.app);
        this.plugins.set(manifest.name, {
          instance: plugin,
          manifest,
          type: "remote",
          context,
        });
        console.log(
          `[PluginManager] Installed remote plugin (from cache): ${manifest.name}`,
        );
        return;
      }
    } catch (err) {
      console.warn(`[PluginManager] Cache read failed for ${entryUrl}:`, err);
      // proceed to fetch and verify
    }

    // Fetch bytes, verify integrity, then cache & import
    let bytesBuffer: ArrayBuffer;
    try {
      bytesBuffer = await fetchAsArrayBuffer(entryUrl);
    } catch (err) {
      // if network fails and we had some cached (without integrity/version match), optionally fall back:
      const cached = await cacheGet(entryUrl);
      if (cached) {
        console.warn(
          `[PluginManager] Network failed; falling back to cached plugin for ${manifest.name}`,
        );
        const mod = await importFromBytes(cached.bytes);
        const plugin: Plugin = mod.default || mod;
        const context = this.createContext(manifest.name);
        if (plugin.install)
          await plugin.install(this.app, { ...options, context });
        plugin.onInit?.(this.app);
        this.plugins.set(manifest.name, {
          instance: plugin,
          manifest,
          type: "remote",
          context,
        });
        return;
      }
      throw err;
    }

    const bytesUint8 = new Uint8Array(bytesBuffer);
    if (expectedB64) {
      const actualB64 = await sha256Base64(bytesUint8);
      if (actualB64 !== expectedB64) {
        throw new Error(
          `Integrity mismatch for ${entryUrl}. expected=${expectedB64} actual=${actualB64}`,
        );
      }
    } else {
      console.warn(
        `[PluginManager] No integrity provided for ${manifest.name}; caching is allowed but less secure.`,
      );
    }

    // Cache the verified bytes
    try {
      await cachePut({
        url: entryUrl,
        manifestUrl,
        version: manifest.version,
        integrityB64: expectedB64 ?? undefined,
        bytes: bytesUint8,
      });
      console.log(`[PluginManager] Cached plugin bytes for ${manifest.name}`);
    } catch (err) {
      console.warn(
        `[PluginManager] Failed to cache plugin bytes for ${manifest.name}:`,
        err,
      );
    }

    // Import from bytes (ensures same execution path as cache load)
    const module = await importFromBytes(bytesUint8);
    const plugin: Plugin = module.default || module;
    const context = this.createContext(manifest.name);
    if (plugin.install) await plugin.install(this.app, { ...options, context });

    plugin.onInit?.(this.app);
    this.plugins.set(manifest.name, {
      instance: plugin,
      manifest,
      type: "remote",
      context,
    });
    console.log(`[PluginManager] Installed remote plugin: ${manifest.name}`);
  }

  private getCachedManifests(): Record<string, PluginManifest> {
    try {
      return JSON.parse(localStorage.getItem(this.cacheKey) || "{}");
    } catch {
      return {};
    }
  }

  private saveCachedManifests(cache: Record<string, PluginManifest>) {
    localStorage.setItem(this.cacheKey, JSON.stringify(cache));
  }

  /**
   * Create a plugin-scoped context
   */
  private createContext(name: string) {
    return {
      emit: (event: string, data?: any) => this.emit(`${name}:${event}`, data),
      on: (event: string, handler: (data?: any) => void) =>
        this.on(`${name}:${event}`, handler),
      off: (event: string, handler: (data?: any) => void) =>
        this.off(`${name}:${event}`, handler),
      app: this.app,
    };
  }

  /**
   * Plugin intercommunication (namespaced events)
   */
  on(event: string, handler: (data?: any) => void) {
    if (!this.events.has(event)) this.events.set(event, new Set());
    this.events.get(event)!.add(handler);
  }

  off(event: string, handler: (data?: any) => void) {
    this.events.get(event)?.delete(handler);
  }

  emit(event: string, data?: any) {
    this.events.get(event)?.forEach((fn) => fn(data));
  }

  /**
   * Unload a plugin safely
   */
  async unload(name: string) {
    const record = this.plugins.get(name);
    if (!record) return;
    try {
      record.instance.onUnload?.();
      this.plugins.delete(name);
      console.log(`[PluginManager] Unloaded plugin: ${name}`);
    } catch (err) {
      record.instance.onError?.(err);
    }
  }

  /**
   * Reload plugin (useful for development)
   */
  async reload(name: string) {
    const record = this.plugins.get(name);
    if (!record) return;
    await this.unload(name);
    if (record.type === "local") await this.installLocal(record.instance);
    if (record.type === "remote" && record.manifest) {
      const baseUrl = record.manifest.entry.replace(/\/[^/]+$/, "");
      await this.installRemote(baseUrl);
    }
  }

  /**
   * Access installed plugins
   */
  getPlugins(): string[] {
    return [...this.plugins.keys()];
  }
}

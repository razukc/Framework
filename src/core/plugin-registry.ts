// core/plugin-registry.ts
import semver from "semver";

export interface PluginManifest {
  name: string;
  version: string;
  entry: string;
  integrity?: string;
  signature?: string;
  env?: string[];
  description?: string;
  author?: string;
  homepage?: string;
}

export interface RegistrySource {
  name: string;
  url: string;
  priority?: number;
}

export class PluginRegistryService {
  private registries: RegistrySource[] = [];
  private manifests: Map<string, PluginManifest[]> = new Map();
  private cache: Map<string, any> = new Map();

  constructor(initialRegistries?: RegistrySource[]) {
    if (initialRegistries) this.registries = initialRegistries;
  }

  registerRegistry(source: RegistrySource) {
    if (!this.registries.find((r) => r.url === source.url)) {
      this.registries.push(source);
    }
  }

  async sync() {
    console.log("[Registry] Syncing plugin manifests from all sources...");
    for (const source of this.registries.sort(
      (a, b) => (b.priority || 0) - (a.priority || 0),
    )) {
      try {
        const res = await fetch(source.url);
        if (!res.ok) throw new Error(`Failed to fetch ${source.url}`);
        const list = await res.json();

        if (!Array.isArray(list)) continue;
        for (const manifest of list) {
          const versions = this.manifests.get(manifest.name) || [];
          versions.push(manifest);
          this.manifests.set(manifest.name, versions);
        }
      } catch (err) {
        console.warn(`[Registry] Failed to sync from ${source.name}:`, err);
      }
    }
    console.log("[Registry] Sync complete.");
  }

  getManifest(
    name: string,
    versionRange: string = "*",
  ): PluginManifest | undefined {
    const versions = this.manifests.get(name);
    if (!versions || versions.length === 0) return undefined;

    const sorted = versions.sort((a, b) =>
      semver.rcompare(a.version, b.version),
    );
    return sorted.find((v) => semver.satisfies(v.version, versionRange));
  }

  list() {
    const out: Record<string, string[]> = {};
    for (const [name, versions] of this.manifests.entries()) {
      out[name] = versions.map((v) => v.version);
    }
    return out;
  }

  async refresh(name: string) {
    for (const source of this.registries) {
      try {
        const res = await fetch(`${source.url}/${name}.json`);
        if (!res.ok) continue;
        const manifest = await res.json();
        if (!manifest.name) continue;

        const existing = this.manifests.get(name) || [];
        existing.push(manifest);
        this.manifests.set(name, existing);
        console.log(`[Registry] Updated ${name} from ${source.name}`);
      } catch (err) {
        console.warn(`[Registry] Could not refresh ${name} from ${source.url}`);
      }
    }
  }
}

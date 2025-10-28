import type { PluginManager } from './plugin-manager.js';
import type { PluginRegistry } from './plugin-registry.js';
import { CapabilityAwareSandbox } from '../sandbox/capability-aware-sandbox.js';
import { CapabilityManager } from './CapabilityManager.js';

export type UpgradePolicy = {
  autoApply?: boolean;
  maxRetries?: number;
  stagedPercent?: number;
  healthTimeoutMs?: number;
};

export type PluginManifest = {
  name: string;
  version?: string;
  entry?: string;
  capabilities?: string[];
  integrity?: string;
  [k: string]: any;
};

type ShadowRecord = {
  manifest: PluginManifest;
  sandboxController: any;
  startedAt: number;
  attempts: number;
};

export class UpgradeManager {
  pluginManager: PluginManager;
  registry: PluginRegistry;
  sandboxMgr: CapabilityAwareSandbox;
  capabilityMgr: CapabilityManager;
  policy: UpgradePolicy;
  shadowMap: Map<string, ShadowRecord>;

  constructor(opts: {
    pluginManager: PluginManager;
    registry: PluginRegistry;
    sandboxMgr: CapabilityAwareSandbox;
    capabilityMgr: CapabilityManager;
    policy?: UpgradePolicy;
  }) {
    this.pluginManager = opts.pluginManager;
    this.registry = opts.registry;
    this.sandboxMgr = opts.sandboxMgr;
    this.capabilityMgr = opts.capabilityMgr;
    this.policy = Object.assign({ autoApply:false, maxRetries:1, stagedPercent:100, healthTimeoutMs:8000 }, opts.policy || {});
    this.shadowMap = new Map<string, ShadowRecord>();
  }

  /**
   * Check installed plugins against registry manifests and return available updates.
   */
  async checkForUpdates(): Promise<Array<{ name: string; current?: string; latest?: string }>> {
    const out: Array<{ name: string; current?: string; latest?: string }> = [];
    const installed = (typeof this.pluginManager.listInstalled === 'function') ? this.pluginManager.listInstalled() : [];
    for (const name of installed) {
      const currentRec = this.pluginManager.getPluginRecord(name) as any;
      const currentVersion = currentRec?.version ?? currentRec?.manifest?.version;
      const manifest = (await this.registry.getManifest(name)) as PluginManifest | null;
      if (!manifest) continue;
      const latestVersion = manifest.version;
      if (!currentVersion || latestVersion !== currentVersion) {
        out.push({ name, current: currentVersion, latest: latestVersion });
      }
    }
    return out;
  }

  /**
   * Start a shadow upgrade for a plugin (download candidate, verify, start in sandbox).
   */
  async startShadowUpgrade(pluginName: string): Promise<boolean> {
    const manifest = (await this.registry.getManifest(pluginName)) as PluginManifest | null;
    if (!manifest) throw new Error(`Manifest for ${pluginName} not found`);
    const entryUrl = manifest.entry;
    if (!entryUrl) throw new Error(`Manifest for ${pluginName} missing entry URL`);

    const requested = manifest.capabilities ?? [];
    const grants = this.capabilityMgr.grantCapabilities(requested, manifest.name)
      .filter((g) => g.granted)
      .map((g) => ({ name: g.name, context: g.context }));

    const ctrl = await this.sandboxMgr.startSandboxedPlugin(entryUrl, grants, manifest);
    try {
      if (typeof ctrl.install === 'function') await ctrl.install({});
      if (typeof ctrl.onLoad === 'function') await ctrl.onLoad();
      if (typeof ctrl.onReady === 'function') await ctrl.onReady();
    } catch (err) {
      try { if (typeof ctrl.terminate === 'function') ctrl.terminate(); } catch(_) {}
      throw new Error(`Shadow install failed for ${pluginName}: ${String(err)}`);
    }

    const rec: ShadowRecord = { manifest, sandboxController: ctrl, startedAt: Date.now(), attempts: 0 };
    this.shadowMap.set(pluginName, rec);
    return true;
  }

  /**
   * Run health check against a shadow candidate.
   */
  async runHealthCheck(pluginName: string, timeoutMs?: number): Promise<boolean> {
    const rec = this.shadowMap.get(pluginName);
    if (!rec) throw new Error(`No shadow candidate for ${pluginName}`);
    const ctrl = rec.sandboxController;
    const to = timeoutMs ?? this.policy.healthTimeoutMs ?? 8000;

    try {
      const healthPromise = (typeof ctrl.onHealthCheck === 'function') ? ctrl.onHealthCheck() : Promise.resolve(true);
      const result = await Promise.race([healthPromise, new Promise((_, rej) => setTimeout(() => rej(new Error('healthcheck timed out')), to))]);
      return Boolean(result);
    } catch (err) {
      console.warn(`[UpgradeManager] health check failed for ${pluginName}:`, String(err));
      return false;
    }
  }

  /**
   * Promote a shadow candidate into production (atomic swap with rollback on failure).
   */
  async promoteShadow(pluginName: string): Promise<boolean> {
    const shadow = this.shadowMap.get(pluginName);
    if (!shadow) throw new Error(`No shadow candidate for ${pluginName}`);
    const manifest = shadow.manifest;

    try {
      if (typeof shadow.sandboxController.onActivate === 'function') await shadow.sandboxController.onActivate();
      await this.pluginManager.replaceWithSandboxed(pluginName, shadow.sandboxController, manifest);
      this.shadowMap.delete(pluginName);
      return true;
    } catch (err) {
      try { if (shadow.sandboxController && typeof shadow.sandboxController.terminate === 'function') shadow.sandboxController.terminate(); } catch(_) {}
      this.shadowMap.delete(pluginName);
      console.error(`[UpgradeManager] Promotion failed for ${pluginName}:`, String(err));
      return false;
    }
  }

  async abortShadow(pluginName: string) {
    const rec = this.shadowMap.get(pluginName);
    if (!rec) return false;
    try { rec.sandboxController.terminate(); } catch(e) {}
    this.shadowMap.delete(pluginName);
    return true;
  }

  listShadows() {
    return Array.from(this.shadowMap.entries()).map(([k, v]) => ({ name: k, manifest: v.manifest, startedAt: v.startedAt, attempts: v.attempts }));
  }
}
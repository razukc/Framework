import type { PluginManager } from './plugin-manager.js';
import type { PluginRegistry } from './plugin-registry.js';
import { CapabilityAwareSandbox } from '../sandbox/capability-aware-sandbox.js';
import { CapabilityManager } from './CapabilityManager.js';

export class UpgradeManager {
  constructor(opts: { pluginManager: PluginManager; registry: PluginRegistry; sandboxMgr: CapabilityAwareSandbox; capabilityMgr: CapabilityManager; policy?: any }) {
    this.pluginManager = opts.pluginManager;
    this.registry = opts.registry;
    this.sandboxMgr = opts.sandboxMgr;
    this.capabilityMgr = opts.capabilityMgr;
    this.policy = Object.assign({ autoApply:false, maxRetries:1, stagedPercent:100, healthTimeoutMs:8000 }, opts.policy || {});
    this.shadowMap = new Map();
  }

  // Methods (startShadowUpgrade, runHealthCheck, promoteShadow, abortShadow) are implemented in runtime code base.
}
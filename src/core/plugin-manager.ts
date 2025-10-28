import { MessageBus } from './message-bus.js';
import { CapabilityManager } from './CapabilityManager.js';
import { HostBridge } from './host-bridge.js';

export type PluginRecord = {
  name: string;
  manifest?: any;
  controller?: any;
  isSandboxed?: boolean;
  state?: string;
  version?: string;
};

export class PluginManager {
  private app: any;
  private hostBridge?: HostBridge;
  private capabilityManager: CapabilityManager;
  private bus: MessageBus;
  private plugins = new Map<string, PluginRecord>();

  constructor(opts: { app?: any; hostBridge?: HostBridge; capabilityManager?: CapabilityManager; bus?: MessageBus }) {
    this.app = opts.app ?? {};
    this.hostBridge = opts.hostBridge;
    this.capabilityManager = opts.capabilityManager ?? new CapabilityManager();
    this.bus = opts.bus ?? new MessageBus();
  }

  setHostBridge(hb: HostBridge) {
    this.hostBridge = hb;
  }

  registerPlugin(pluginName: string, controller: any, manifest?: any, isSandboxed = false) {
    const rec: PluginRecord = {
      name: pluginName,
      manifest,
      controller,
      isSandboxed,
      state: 'installed',
      version: manifest?.version,
    };
    this.plugins.set(pluginName, rec);
    if (isSandboxed && this.hostBridge && controller?.rawController) {
      this.hostBridge.registerWorker(pluginName, controller.rawController);
    }
  }

  getPluginRecord(name: string) {
    return this.plugins.get(name);
  }

  listInstalled() {
    return Array.from(this.plugins.keys());
  }

  async replaceWithSandboxed(pluginName: string, sandboxController: any, manifest: any) {
    const old = this.plugins.get(pluginName);

    const safeCall = async (ctrl: any, method: string) => {
      if (!ctrl) return;
      try {
        if (typeof ctrl[method] === 'function') {
          await ctrl[method]();
        }
      } catch (err) {
        throw err;
      }
    };

    try {
      if (old && old.controller) {
        try {
          await safeCall(old.controller, 'onDeactivate');
        } catch (err) {
          console.warn(`[PluginManager] Warning: onDeactivate failed for ${pluginName}:`, err);
        }
      }

      await safeCall(sandboxController, 'onActivate');

      if (old && old.controller) {
        try {
          await safeCall(old.controller, 'onUnload');
        } catch (err) {
          console.error(`[PluginManager] Failed to unload old plugin ${pluginName}; rolling back.`, err);
          try {
            await safeCall(sandboxController, 'onDeactivate');
            if (typeof sandboxController.terminate === 'function') sandboxController.terminate();
          } catch (e) { console.error('[PluginManager] rollback: failed to stop new controller', e); }

          try { await safeCall(old.controller, 'onActivate'); } catch (e) { console.error('[PluginManager] rollback: failed to reactivate old controller', e); }

          throw new Error(`Failed to unload previous plugin: ${err?.message || err}`);
        }
      }

      this.plugins.set(pluginName, {
        name: pluginName,
        manifest,
        controller: sandboxController,
        isSandboxed: true,
        state: 'activated',
        version: manifest?.version,
      });

      if (this.hostBridge && sandboxController?.rawController) {
        this.hostBridge.registerWorker(pluginName, sandboxController.rawController);
      }

      console.log(`[PluginManager] Replaced plugin ${pluginName} with new sandboxed version ${manifest?.version}`);
      return true;
    } catch (err) {
      console.error(`[PluginManager] replaceWithSandboxed failed for ${pluginName}:`, err);
      try {
        if (sandboxController) {
          try { await safeCall(sandboxController, 'onDeactivate'); } catch (_) {}
          if (typeof sandboxController.terminate === 'function') sandboxController.terminate();
        }
      } catch (e) {}
      if (old && old.controller) {
        try {
          await safeCall(old.controller, 'onActivate');
          this.plugins.set(pluginName, old);
        } catch (e) {
          console.error('[PluginManager] Failed to reactivate previous plugin after replace failure', e);
        }
      }
      throw err;
    }
  }

  async uninstallPlugin(name: string) {
    const rec = this.plugins.get(name);
    if (!rec) return;
    try {
      if (rec.controller && typeof rec.controller.onDeactivate === 'function') await rec.controller.onDeactivate();
    } catch (e) { console.warn('[PluginManager] uninstall deactivation error', e); }
    try {
      if (rec.controller && typeof rec.controller.onUnload === 'function') await rec.controller.onUnload();
    } catch (e) { console.warn('[PluginManager] uninstall unload error', e); }
    if (rec.isSandboxed && this.hostBridge) {
      try { this.hostBridge.unregisterWorker(name); } catch (e) {}
    }
    this.plugins.delete(name);
  }
}
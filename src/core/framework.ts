import { MessageBus } from './message-bus.js';
import { CapabilityManager } from './CapabilityManager.js';
import { HostBridge } from './host-bridge.js';
import { PluginManager } from './plugin-manager.js';
import { CapabilityAwareSandbox } from '../sandbox/capability-aware-sandbox.js';

export class Framework {
  public app: any;
  public capabilityManager: CapabilityManager;
  public bus: MessageBus;
  public hostBridge: HostBridge;
  public pluginManager: PluginManager;
  public sandboxManager: CapabilityAwareSandbox;

  constructor(app: any = {}, opts: any = {}) {
    this.app = app;
    this.capabilityManager = opts.capabilityManager ?? new CapabilityManager();
    this.bus = opts.bus ?? new MessageBus();
    this.hostBridge = opts.hostBridge ?? new HostBridge(this.bus, this.capabilityManager);
    this.pluginManager = opts.pluginManager ?? new PluginManager({
      app: this.app,
      hostBridge: this.hostBridge,
      capabilityManager: this.capabilityManager,
      bus: this.bus
    });
    this.sandboxManager = opts.sandboxManager ?? new CapabilityAwareSandbox((cap, ctx, pluginName) => {
      switch (cap) {
        case 'logger': return { log: (...a:any[])=>console.log(`[${pluginName}]`, ...a), info: (...a:any[])=>console.info(`[${pluginName}]`, ...a), warn: (...a:any[])=>console.warn(`[${pluginName}]`, ...a), error: (...a:any[])=>console.error(`[${pluginName}]`, ...a) };
        case 'storage': return { get: async(k:string)=>null, set: async(k:string,v:any)=>true };
        case 'network': return { fetch: async(url:string,opts?:any)=>({status:418, body:'network disabled'}) };
        default: return {};
      }
    });
  }

  async init() {
    this.capabilityManager.defineCapability('logger', { allowed: true, contextFactory: (pn?:string)=>({}) });
    this.capabilityManager.defineCapability('storage', { allowed: true, contextFactory: (pn?:string)=>({}) });
    this.capabilityManager.defineCapability('network', { allowed: false, contextFactory: (pn?:string)=>({}) });
    this.capabilityManager.defineCapability('bus', { allowed: true, contextFactory: (pn?:string)=>({}) });

    this.pluginManager.setHostBridge(this.hostBridge);
    return this;
  }

  registerPlugin(name: string, controller: any, manifest?: any, isSandboxed = false) {
    this.pluginManager.registerPlugin(name, controller, manifest, isSandboxed);
  }
}
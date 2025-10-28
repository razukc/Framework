export type Capability = string;
export interface CapabilityGrant {
  name: Capability;
  granted: boolean;
  reason?: string;
  context?: Record<string, any>;
}

export interface CapabilityPolicyEntry {
  allowed: boolean;
  contextFactory?: (pluginName?: string) => Record<string, any>;
}

export class CapabilityManager {
  private policy: Record<string, CapabilityPolicyEntry> = {};
  defineCapability(name: Capability, entry: CapabilityPolicyEntry) {
    this.policy[name] = entry;
  }
  grantCapabilities(requested: Capability[], pluginName?: string): CapabilityGrant[] {
    return requested.map((cap) => {
      const p = this.policy[cap];
      if (!p) return { name: cap, granted: false, reason: 'unknown capability' };
      if (!p.allowed) return { name: cap, granted: false, reason: 'denied by policy' };
      return { name: cap, granted: true, context: p.contextFactory?.(pluginName) ?? {} };
    });
  }
  async verifyPublish(pluginName: string, topic: string) { return true; }
  async verifyRPC(pluginName: string, topic: string) { return true; }
  async verifySubscribe(pluginName: string, topic: string) { return true; }
  verify(pluginName: string, req: any) { return true; }
}
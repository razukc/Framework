import { MessageBus } from './message-bus.js';
import { CapabilityManager } from './CapabilityManager.js';

type WorkerController = {
  post: (msg: any) => void;
  on: (handler: (msg: any) => void) => void;
  terminate: () => void;
};

export class HostBridge {
  private bus: MessageBus;
  private capabilityManager: CapabilityManager;
  private workers = new Map<string, WorkerController>();
  private pending = new Map<string, { resolve: (v:any)=>void; reject: (e:any)=>void; timer: any }>();
  private nextRpc = 1;

  constructor(bus: MessageBus, capabilityManager: CapabilityManager) {
    this.bus = bus;
    this.capabilityManager = capabilityManager;
  }

  registerWorker(pluginName: string, ctrl: WorkerController) {
    if (this.workers.has(pluginName)) {
      console.warn(`[HostBridge] Overwriting worker for ${pluginName}`);
    }
    this.workers.set(pluginName, ctrl);
    ctrl.on((msg: any) => this.handleWorkerMessage(pluginName, ctrl, msg));
  }

  unregisterWorker(pluginName: string) {
    const ctrl = this.workers.get(pluginName);
    if (!ctrl) return;
    try { ctrl.terminate(); } catch(_) {}
    this.workers.delete(pluginName);
  }

  private genRpcId() {
    return `rpc_${Date.now()}_${this.nextRpc++}`;
  }

  private async handleWorkerMessage(pluginName: string, ctrl: WorkerController, msg: any) {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'bus:publish') {
      const allowed = await this.capabilityManager.verifyPublish(pluginName, msg.topic);
      if (!allowed) {
        if (msg.rpcId) ctrl.post({ type: 'bus:rpc:response', rpcId: msg.rpcId, ok: false, error: 'publish denied' });
        return;
      }
      this.bus.publish(pluginName, msg.topic, msg.payload).catch((e)=>{ console.error('[HostBridge] publish error', e); });
      return;
    }

    if (msg.type === 'bus:request') {
      const allowed = await this.capabilityManager.verifyRPC(pluginName, msg.topic);
      if (!allowed) {
        ctrl.post({ type: 'bus:rpc:response', rpcId: msg.rpcId ?? null, ok: false, error: 'rpc denied' });
        return;
      }

      this.bus.request(pluginName, msg.topic, msg.payload, msg.timeoutMs ?? 5000)
        .then((result) => {
          ctrl.post({ type: 'bus:rpc:response', rpcId: msg.rpcId, ok: true, result });
        })
        .catch((err) => {
          ctrl.post({ type: 'bus:rpc:response', rpcId: msg.rpcId, ok: false, error: err?.message ?? String(err) });
        });

      return;
    }

    if (msg.type === 'bus:response') {
      const rpcId = msg.rpcId;
      if (!rpcId) return;
      const pend = this.pending.get(rpcId);
      if (!pend) return;
      clearTimeout(pend.timer);
      this.pending.delete(rpcId);
      if (msg.ok) pend.resolve(msg.result); else pend.reject(new Error(msg.error || 'worker response error'));
      return;
    }
  }

  async invokeOnPlugin(targetPlugin: string | null, topic: string, payload: any, timeoutMs = 5000): Promise<any> {
    if (targetPlugin && this.workers.has(targetPlugin)) {
      const ctrl = this.workers.get(targetPlugin)!;
      const rpcId = this.genRpcId();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { this.pending.delete(rpcId); reject(new Error('invokeOnPlugin timeout')); }, timeoutMs);
        this.pending.set(rpcId, { resolve, reject, timer });
        try {
          ctrl.post({ type: 'bus:rpc:invoke', rpcId, topic, payload, timeoutMs });
        } catch (e) {
          clearTimeout(timer);
          this.pending.delete(rpcId);
          reject(e);
        }
      });
    }

    return this.bus.request(null, topic, payload, timeoutMs);
  }
}
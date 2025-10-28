const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';
const isNode = !isBrowser;

type CapabilityGrant = { name: string; context?: Record<string, any> };

export class CapabilityAwareSandbox {
  private hostApiFactory: (cap: string, context: Record<string, any>, pluginName: string) => Record<string, any>;
  private lifecycleTimeoutMs: number;
  private cache = new Map<string, { bytes: Uint8Array; integrity?: string; version?: string }>();

  constructor(hostApiFactory: (cap: string, context: Record<string, any>, pluginName: string) => Record<string, any>, lifecycleTimeoutMs = 8000) {
    this.hostApiFactory = hostApiFactory;
    this.lifecycleTimeoutMs = lifecycleTimeoutMs;
  }

  private parseIntegrity(integrity?: string): string | null {
    if (!integrity) return null;
    const m = integrity.match(/^sha256-(.+)$/);
    return m ? m[1] : null;
  }

  private async sha256Base64(bytes: Uint8Array): Promise<string> {
    if (isBrowser && typeof crypto !== 'undefined' && (crypto as any).subtle) {
      const hash = await (crypto as any).subtle.digest('SHA-256', bytes);
      const b64 = this.arrayBufferToBase64(hash);
      return b64;
    } else {
      const crypto = await import('crypto');
      const h = crypto.createHash('sha256').update(Buffer.from(bytes)).digest();
      return Buffer.from(h).toString('base64');
    }
  }

  private arrayBufferToBase64(buf: ArrayBuffer | Uint8Array) {
    let bytes: Uint8Array;
    if (buf instanceof Uint8Array) bytes = buf;
    else bytes = new Uint8Array(buf);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const slice = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, Array.from(slice));
    }
    if (typeof btoa !== 'undefined') return btoa(binary);
    else return Buffer.from(binary, 'binary').toString('base64');
  }

  private async fetchAsArrayBuffer(url: string): Promise<ArrayBuffer> {
    if (isNode && url.startsWith('file://')) {
      const fs = await import('fs/promises');
      const { fileURLToPath } = await import('url');
      const p = fileURLToPath(url);
      const buf = await fs.readFile(p);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    return await res.arrayBuffer();
  }

  private async createWorkerFromSourceBytes(bytes: Uint8Array) {
    if (isBrowser) {
      const blob = new Blob([bytes], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      const worker = new Worker(url, { type: 'module' });
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return {
        post: (m: any) => worker.postMessage(m),
        on: (h: (m: any) => void) => { worker.onmessage = (e) => h(e.data); },
        terminate: () => worker.terminate(),
        raw: worker,
      };
    } else {
      const { Worker } = await import('worker_threads');
      const fs = await import('fs/promises');
      const os = await import('os');
      const path = await import('path');
      const { pathToFileURL } = await import('url');

      const tmpdir = os.tmpdir();
      const fileName = `plugin-worker-${Date.now()}-${Math.random().toString(36).slice(2,8)}.mjs`;
      const filePath = path.join(tmpdir, fileName);
      await fs.writeFile(filePath, Buffer.from(bytes));

      const worker = new Worker(pathToFileURL(filePath).href, { eval: false });
      worker.once('exit', () => fs.unlink(filePath).catch(()=>{}));

      return {
        post: (m: any) => worker.postMessage(m),
        on: (h: (m: any) => void) => worker.on('message', (d) => h(d)),
        terminate: () => worker.terminate(),
        raw: worker,
      };
    }
  }

  private async getWorkerBootstrapSource(): Promise<string> {
    try {
      if (isNode) {
        const fs = await import('fs/promises');
        const path = await import('path');
        const repoRoot = path.join(process.cwd());
        const candidate = path.join(repoRoot, 'src', 'sandbox', 'worker-bootstrap-capabilities.js');
        const exists = await fs.stat(candidate).then(()=>true).catch(()=>false);
        if (exists) {
          const txt = await fs.readFile(candidate, { encoding: 'utf8' });
          return txt;
        }
      }
    } catch (e) {}
    try {
      const url = '/sandbox/worker-bootstrap-capabilities.js';
      const res = await fetch(url);
      if (res.ok) return await res.text();
    } catch (e) {}
    return `
    const decodeBase64 = (b64) => {
      if (typeof atob !== 'undefined') {
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return arr;
      } else {
        return Uint8Array.from(Buffer.from(b64, 'base64'));
      }
    };
    async function importPluginFromBytes(bytes) {
      if (typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
        const blob = new Blob([bytes], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        try { const mod = await import(url); return mod.default || mod; } finally { setTimeout(()=>URL.revokeObjectURL(url), 0); }
      } else {
        const code = Array.from(bytes).map(b=>String.fromCharCode(b)).join('');
        const m = { exports: {} }; const fn = new Function('exports','module', code); fn(m.exports, m); return m.exports.default || m.exports;
      }
    }
    let pluginPkg = null;
    self.onmessage = async (ev) => {
      const msg = ev.data;
      if (!msg || !msg.__request_id) return;
      const id = msg.__request_id;
      const action = msg.action;
      try {
        if (!pluginPkg) {
          if (!self.PLUGIN_BASE64) throw new Error('PLUGIN_BASE64 missing');
          const bytes = decodeBase64(self.PLUGIN_BASE64);
          pluginPkg = await importPluginFromBytes(bytes);
          if (pluginPkg && typeof pluginPkg.attachHost === 'function') pluginPkg.attachHost(self.GRANTED_CAPABILITIES || {});
        }
        if (!pluginPkg) throw new Error('plugin load failed');
        let result;
        switch(action) {
          case 'install': result = await (pluginPkg.install ? pluginPkg.install(msg.payload) : null); break;
          case 'onLoad': result = await (pluginPkg.onLoad ? pluginPkg.onLoad() : null); break;
          case 'onReady': result = await (pluginPkg.onReady ? pluginPkg.onReady() : null); break;
          case 'onActivate': result = await (pluginPkg.onActivate ? pluginPkg.onActivate() : null); break;
          case 'onDeactivate': result = await (pluginPkg.onDeactivate ? pluginPkg.onDeactivate() : null); break;
          case 'onUnload': result = await (pluginPkg.onUnload ? pluginPkg.onUnload() : null); break;
          case 'healthCheck': result = await (pluginPkg.healthCheck ? pluginPkg.healthCheck() : true); break;
          default: throw new Error('Unknown action ' + action);
        }
        self.postMessage({ __response_id: id, ok: true, result });
      } catch (err) {
        self.postMessage({ __response_id: id, ok: false, error: (err && err.message) ? err.message : String(err) });
      }
    };
    `;
  }

  private async loadAndVerify(entryUrl: string, manifest?: { integrity?: string; version?: string }) : Promise<Uint8Array> {
    const cached = this.cache.get(entryUrl);
    const expected = this.parseIntegrity(manifest?.integrity);
    if (cached && expected && cached.integrity === expected && cached.version === manifest?.version) {
      return cached.bytes;
    }

    const arrayBuffer = await this.fetchAsArrayBuffer(entryUrl);
    const bytes = new Uint8Array(arrayBuffer);

    if (expected) {
      const actual = await this.sha256Base64(bytes);
      if (actual !== expected) throw new Error(`Integrity mismatch for ${entryUrl}`);
    }

    this.cache.set(entryUrl, { bytes, integrity: expected ?? undefined, version: manifest?.version });
    return bytes;
  }

  private async buildWrapperSource(pluginBytes: Uint8Array, grants: CapabilityGrant[]) {
    const b64 = (typeof Buffer !== 'undefined') ? Buffer.from(pluginBytes).toString('base64') : (btoa(String.fromCharCode(...Array.from(pluginBytes))));
    const grantsJson = JSON.stringify(grants || []);
    const bootstrap = await this.getWorkerBootstrapSource();
    return `self.PLUGIN_BASE64='${b64}';\nself.GRANTED_CAPABILITIES=${grantsJson};\n${bootstrap}`;
  }

  async startSandboxedPlugin(entryUrl: string, grants: CapabilityGrant[] = [], manifest?: any) {
    const pluginBytes = await this.loadAndVerify(entryUrl, manifest);
    const wrapperSource = await this.buildWrapperSource(pluginBytes, grants);
    const wrapperBytes = (typeof Buffer !== 'undefined') ? Buffer.from(wrapperSource) : new TextEncoder().encode(wrapperSource);

    const workerCtrl = await this.createWorkerFromSourceBytes(wrapperBytes);

    let nextId = 1;
    const pending = new Map<number, { resolve: (v:any)=>void; reject: (e:any)=>void; timer: any }>();

    workerCtrl.on((msg: any) => {
      if (!msg) return;
      if (msg.__response_id) {
        const id = msg.__response_id as number;
        const entry = pending.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        pending.delete(id);
        if (msg.ok) entry.resolve(msg.result); else entry.reject(new Error(msg.error || 'worker error'));
        return;
      }
      if (msg.type === 'hostLog') {
        console[msg.level ?? 'log'](`[plugin-sandbox]`, msg.message);
      } else if (msg.type === 'emitEvent') {
        console.log('[plugin event]', msg.name, msg.payload);
      }
    });

    const callWorker = (action: string, payload?: any, timeoutMs = this.lifecycleTimeoutMs) => {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Worker action ${action} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try {
          workerCtrl.post({ __request_id: id, action, payload });
        } catch (e) {
          clearTimeout(timer);
          pending.delete(id);
          reject(e);
        }
      });
    };

    const controller = {
      install: (opts?: any) => callWorker('install', opts),
      onLoad: () => callWorker('onLoad'),
      onReady: () => callWorker('onReady'),
      onActivate: () => callWorker('onActivate'),
      onDeactivate: () => callWorker('onDeactivate'),
      onUnload: () => callWorker('onUnload'),
      onHealthCheck: () => callWorker('healthCheck'),
      terminate: () => { try { workerCtrl.terminate(); } catch (e) {} },
      rawController: workerCtrl,
    };

    return controller;
  }
}
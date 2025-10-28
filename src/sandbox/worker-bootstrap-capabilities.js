// Worker bootstrap (capabilities-aware)
// This is used inside workers. It expects self.PLUGIN_BASE64 and self.GRANTED_CAPABILITIES.

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

const safeLog = (level, msg) => {
  self.postMessage({ type: 'hostLog', level, message: String(msg) });
};

const createCapabilityAPIs = (grants) => {
  const api = {};
  for (const g of grants) {
    const name = g.name;
    const ctx = g.context || {};
    switch (name) {
      case 'logger':
        api.logger = {
          log: (msg) => safeLog('log', msg),
          info: (msg) => safeLog('info', msg),
          warn: (msg) => safeLog('warn', msg),
          error: (msg) => safeLog('error', msg),
        };
        break;
      case 'storage':
        (function() {
          const store = new Map(Object.entries(ctx || {}));
          api.storage = {
            get: async (k) => store.get(k),
            set: async (k, v) => { store.set(k, v); return true; },
            keys: async () => Array.from(store.keys()),
          };
        })();
        break;
      case 'network':
        api.network = {
          fetch: async (url, opts) => {
            const allowedHosts = ctx.allowedHosts || null;
            try {
              const u = new URL(url);
              if (allowedHosts && !allowedHosts.includes(u.hostname)) throw new Error('Host not permitted');
            } catch (e) {
              throw e;
            }
            const res = await fetch(url, opts);
            const text = await res.text();
            return { status: res.status, body: text };
          }
        };
        break;
      default:
        api[name] = {};
    }
  }
  return api;
};

async function importPluginModuleFromBytes(bytes) {
  if (typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
    const blob = new Blob([bytes], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    try {
      const mod = await import(url);
      return mod.default || mod;
    } finally { setTimeout(()=>URL.revokeObjectURL(url), 0); }
  } else {
    const code = Array.from(bytes).map(b=>String.fromCharCode(b)).join('');
    const m = { exports: {} };
    const fn = new Function('exports','module', code);
    fn(m.exports, m);
    return m.exports.default || m.exports;
  }
}

let pluginPkg = null;
let capabilityApis = {};

self.onmessage = async (ev) => {
  const msg = ev.data;
  if (!msg || !msg.__request_id) return;
  const id = msg.__request_id;
  const action = msg.action;
  try {
    if (!pluginPkg) {
      if (!self.PLUGIN_BASE64) throw new Error('PLUGIN_BASE64 not provided');
      const bytes = decodeBase64(self.PLUGIN_BASE64);
      const grants = Array.isArray(self.GRANTED_CAPABILITIES) ? self.GRANTED_CAPABILITIES : [];
      capabilityApis = createCapabilityAPIs(grants);
      pluginPkg = await importPluginModuleFromBytes(bytes);
      if (pluginPkg && typeof pluginPkg.attachHost === 'function') {
        pluginPkg.attachHost(capabilityApis);
      }
    }
    if (!pluginPkg) throw new Error('plugin failed to import');
    let result;
    switch(action) {
      case 'install': result = await maybeCall(pluginPkg, 'install', msg.payload); break;
      case 'onLoad': result = await maybeCall(pluginPkg, 'onLoad'); break;
      case 'onReady': result = await maybeCall(pluginPkg, 'onReady'); break;
      case 'onActivate': result = await maybeCall(pluginPkg, 'onActivate'); break;
      case 'onDeactivate': result = await maybeCall(pluginPkg, 'onDeactivate'); break;
      case 'onUnload': result = await maybeCall(pluginPkg, 'onUnload'); break;
      case 'healthCheck': result = await maybeCall(pluginPkg, 'healthCheck'); break;
      default: throw new Error('Unknown action ' + action);
    }
    self.postMessage({ __response_id: id, ok: true, result });
  } catch (err) {
    self.postMessage({ __response_id: id, ok: false, error: (err && err.message) ? err.message : String(err) });
  }
};

async function maybeCall(pkg, name, payload) {
  if (!pkg[name]) return null;
  return await pkg[name](payload);
}
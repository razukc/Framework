export function attachHost(host) {
  self.host = host;
}

export async function install() {
  self.host?.logger?.info?.('demo-plugin install');
}

export async function onLoad() {
  self.host?.logger?.info?.('demo-plugin onLoad');
}

export async function onReady() {
  self.host?.logger?.info?.('demo-plugin onReady');
}

export async function onActivate() {
  self.host?.logger?.info?.('demo-plugin activated');
}

export async function onDeactivate() {
  self.host?.logger?.info?.('demo-plugin deactivated');
}

export async function onUnload() {
  self.host?.logger?.info?.('demo-plugin unloaded');
}

export async function healthCheck() {
  return true;
}
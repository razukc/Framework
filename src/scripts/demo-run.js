#!/usr/bin/env node
import { Framework } from '../dist/src/core/framework.js';

async function main(){
  const fw = new Framework();
  await fw.init();
  console.log('Framework initialized');

  const manifest = { name: 'demo-plugin', version: '0.0.1', entry: 'file://' + new URL('../src/plugins/demo-plugin/index.js', import.meta.url).pathname, capabilities: ['logger'], integrity: null };
  const grants = fw.capabilityManager.grantCapabilities(manifest.capabilities || [], manifest.name).filter(g=>g.granted).map(g=>({ name:g.name, context:g.context }));
  const controller = await fw.sandboxManager.startSandboxedPlugin(manifest.entry, grants, manifest);
  await controller.install();
  await controller.onLoad();
  await controller.onReady();
  await controller.onActivate();
  console.log('Demo plugin activated. Running healthCheck...');
  const ok = await controller.onHealthCheck();
  console.log('healthCheck result:', ok);
  await controller.onDeactivate();
  await controller.onUnload();
  controller.terminate();
  console.log('Demo run complete.');
}

main().catch(err => { console.error(err); process.exit(1); });
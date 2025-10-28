export class PluginRegistry {
  // In a real implementation this would fetch manifests from remote registries.
  constructor() {}
  async getManifest(name: string) {
    // stub: return null or a simple manifest if available in plugins folder
    return null;
  }
}
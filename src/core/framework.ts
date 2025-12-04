import { PluginManager } from "./plugin-manager";

export class Framework extends PluginManager<Framework> {
  public state: Record<string, any> = {};
  public config: Record<string, any>;

  constructor(config: Record<string, any> = {}) {
    super();
    this.config = config;
  }

  set(key: string, value: any): void {
    this.state[key] = value;
  }

  get<T = any>(key: string): T | undefined {
    return this.state[key];
  }

  run(): void {
    console.log("[Framework] Running with state:", this.state);
  }
}

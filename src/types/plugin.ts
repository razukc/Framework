export interface Plugin<TFramework = any> {
  /** Plugin name */
  name: string;

  /** Optional version */
  version?: string;

  /** Optional dependencies */
  requires?: string[];

  /** Called when the plugin is installed */
  install(framework: TFramework, options?: Record<string, any>): void;
}

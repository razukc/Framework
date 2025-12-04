import type { Plugin } from "../types/plugin.js";
import type { Framework } from "../core/framework";

export const LoggerPlugin: Plugin<Framework> = {
  name: "Logger",
  install(framework, options = {}) {
    framework.log = (
      message: string,
      level: "info" | "warn" | "error" = "info",
    ) => {
      const prefix = options.prefix ?? "[Logger]";
      console[level](`${prefix} ${message}`);
    };
  },
};

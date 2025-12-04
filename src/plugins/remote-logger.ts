import type { Plugin } from "../types/plugin.js";
import type { Framework } from "../core/framework";

export const RemoteLogger: Plugin<Framework> = {
  name: "RemoteLogger",
  install(framework) {
    framework.remoteLog = (msg: string) => {
      console.log(`[RemoteLogger] ${msg}`);
    };
  },
};

export default RemoteLogger;

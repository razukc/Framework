import path from "path";
import chokidar from "chokidar";
import { PluginManager } from "../core/plugin-manager.js";

const pm = new PluginManager("development");
const ctx = { env: "development", app: {} };

const pluginDir = path.resolve("./plugins");

chokidar
  .watch(pluginDir, { ignoreInitial: true })
  .on("change", async (filePath) => {
    const name = path.basename(path.dirname(filePath));
    console.log(`[HotReload] Change detected in ${name}`);
    await pm.reload(name, ctx);
  });

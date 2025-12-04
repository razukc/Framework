import { Framework } from "./core/framework.js";
import { LoggerPlugin } from "./plugins/logger.js";

const app = new Framework({ debug: true });

// Static plugin
app.use(LoggerPlugin, { prefix: "[MyApp]" });

// Dynamic plugin — local or remote
await app.loadPlugin("./plugins/remoteLogger.js"); // local
// OR load from CDN: await app.loadPlugin("https://cdn.example.com/plugins/remoteLogger.js");

app.log("Core initialized");
app.remoteLog("Dynamically loaded plugin working!");
app.run();

console.log("Installed plugins:", app.list());

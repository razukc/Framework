#!/usr/bin/env node
/**
 * Usage:
 *   node scripts/sign-manifests.js <plugins-folder> <private-key.pem>
 *
 * Signs each manifest.json in the folder using RSA-SHA256.
 * Adds a `signature` field (base64) to each manifest.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

const pluginsRoot = process.argv[2];
const privateKeyPath = process.argv[3];
if (!pluginsRoot || !privateKeyPath) {
  console.error(
    "Usage: node scripts/sign-manifests.js <plugins-folder> <private-key.pem>",
  );
  process.exit(1);
}

// Read private key
const privateKey = fs.readFileSync(path.resolve(privateKeyPath), "utf-8");

(async () => {
  try {
    const absRoot = path.resolve(pluginsRoot);
    const pluginDirs = fs
      .readdirSync(absRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(absRoot, d.name));

    for (const pluginDir of pluginDirs) {
      const manifestPath = path.join(pluginDir, "manifest.json");
      if (!fs.existsSync(manifestPath)) continue;

      const manifestRaw = fs.readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(manifestRaw);

      // Remove old signature if exists
      delete manifest.signature;

      // Stringify deterministically (sorted keys)
      const sortedKeys = Object.keys(manifest).sort();
      const canonical = JSON.stringify(
        sortedKeys.reduce((obj, k) => {
          obj[k] = manifest[k];
          return obj;
        }, {}),
      );

      const sign = crypto.createSign("RSA-SHA256");
      sign.update(canonical);
      sign.end();
      const signatureBase64 = sign.sign(privateKey, "base64");

      manifest.signature = signatureBase64;
      fs.writeFileSync(
        manifestPath,
        JSON.stringify(manifest, null, 2),
        "utf-8",
      );
      console.log(`[Signed] ${manifest.name}`);
    }

    console.log("All manifests signed successfully.");
  } catch (err) {
    console.error("Error signing manifests:", err);
    process.exit(1);
  }
})();

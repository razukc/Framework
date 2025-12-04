#!/usr/bin/env node
/**
 * Usage:
 *   node scripts/update-all-manifests.js path/to/plugins-folder
 *
 * This script:
 * 1) Scans all subfolders in the given folder
 * 2) For each subfolder with a manifest.json:
 *    - Reads the manifest
 *    - Computes SHA-256 base64 of entry file
 *    - Updates manifest.integrity
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

const pluginsRoot = process.argv[2];
if (!pluginsRoot) {
  console.error(
    "Usage: node scripts/update-all-manifests.js <plugins-root-folder>",
  );
  process.exit(1);
}

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

      if (!manifest.entry) {
        console.warn(`Skipping ${pluginDir}: no entry field in manifest`);
        continue;
      }

      const entryPath = path.join(pluginDir, manifest.entry);
      if (!fs.existsSync(entryPath)) {
        console.warn(
          `Skipping ${pluginDir}: entry file not found: ${manifest.entry}`,
        );
        continue;
      }

      const bytes = fs.readFileSync(entryPath);
      const hash = crypto.createHash("sha256");
      hash.update(bytes);
      const digestBase64 = hash.digest("base64");
      manifest.integrity = `sha256-${digestBase64}`;

      fs.writeFileSync(
        manifestPath,
        JSON.stringify(manifest, null, 2),
        "utf-8",
      );
      console.log(`[Updated] ${manifest.name}: ${manifest.integrity}`);
    }

    console.log("All manifests updated successfully.");
  } catch (err) {
    console.error("Error updating manifests:", err);
    process.exit(1);
  }
})();

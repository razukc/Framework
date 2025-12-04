#!/usr/bin/env node
/**
 * Usage:
 *   node scripts/update-manifest-integrity.js path/to/plugin
 *
 * This script:
 * 1) Reads <plugin-dir>/manifest.json
 * 2) Computes SHA-256 base64 of <plugin-dir>/<entry>
 * 3) Updates manifest.json.integrity field automatically
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

const pluginDir = process.argv[2];
if (!pluginDir) {
  console.error(
    "Usage: node scripts/update-manifest-integrity.js <plugin-dir>",
  );
  process.exit(1);
}

(async () => {
  try {
    const absDir = path.resolve(pluginDir);
    const manifestPath = path.join(absDir, "manifest.json");

    if (!fs.existsSync(manifestPath)) {
      throw new Error(`manifest.json not found in ${absDir}`);
    }

    const manifestRaw = fs.readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(manifestRaw);

    if (!manifest.entry) {
      throw new Error(`"entry" field missing in manifest.json`);
    }

    const entryPath = path.join(absDir, manifest.entry);
    if (!fs.existsSync(entryPath)) {
      throw new Error(`Plugin entry file not found: ${entryPath}`);
    }

    // Compute SHA-256 base64
    const bytes = fs.readFileSync(entryPath);
    const hash = crypto.createHash("sha256");
    hash.update(bytes);
    const digestBase64 = hash.digest("base64");
    manifest.integrity = `sha256-${digestBase64}`;

    // Write back to manifest.json
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
    console.log(
      `Updated manifest.integrity for plugin ${manifest.name}: ${manifest.integrity}`,
    );
  } catch (err) {
    console.error("Failed to update manifest integrity:", err);
    process.exit(1);
  }
})();

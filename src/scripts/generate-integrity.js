#!/usr/bin/env node
/**
 * Usage: node generate-integrity.js path/to/plugin/index.js
 * Outputs: sha256-<base64>
 */
import fs from "fs";
import crypto from "crypto";
import path from "path";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node generate-integrity.js <file>");
  process.exit(1);
}

(async () => {
  try {
    const absolutePath = path.resolve(filePath);
    const bytes = fs.readFileSync(absolutePath);
    const hash = crypto.createHash("sha256");
    hash.update(bytes);
    const digestBase64 = hash.digest("base64");
    console.log(`sha256-${digestBase64}`);
  } catch (err) {
    console.error("Failed to generate integrity:", err);
    process.exit(1);
  }
})();

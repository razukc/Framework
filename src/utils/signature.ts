// core/utils/signature.ts
import crypto from "crypto";

export function verifyManifestSignature(
  manifest: any,
  publicKey: string,
): boolean {
  if (!manifest.signature) return true; // optional
  const signature = manifest.signature;
  const copy = { ...manifest };
  delete copy.signature;

  // deterministic stringify (sorted keys)
  const sortedKeys = Object.keys(copy).sort();
  const canonical = JSON.stringify(
    sortedKeys.reduce((obj, k) => {
      obj[k] = copy[k];
      return obj;
    }, {}),
  );

  const verify = crypto.createVerify("RSA-SHA256");
  verify.update(canonical);
  verify.end();

  return verify.verify(publicKey, signature, "base64");
}

// Smoke test for `node.json`. Exercises Node-specific globals (`process`,
// `Buffer`) via the `node:` import scheme, NodeNext module resolution, and
// noUncheckedIndexedAccess on `process.env`.

import { Buffer } from "node:buffer";
import process from "node:process";

export const NODE_ENV: string = process.env["NODE_ENV"] ?? "development";

export function encodeUtf8(input: string): Buffer {
  return Buffer.from(input, "utf8");
}

export const SAMPLE: Buffer = encodeUtf8("binderly");

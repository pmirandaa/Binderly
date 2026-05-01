// Smoke test for `library.json`. Library presets emit declarations + source
// maps and run under composite project mode; this file confirms the preset
// type-checks node-targeted source. The actual `dist/` outputs are NOT
// produced during the test suite (each preset is exercised with `--noEmit`
// at the CLI), but the option set itself must be coherent.

import process from "node:process";

export interface PackageInfo {
  readonly name: string;
  readonly env: string;
}

export function describePackage(name: string): PackageInfo {
  const env: string = process.env["NODE_ENV"] ?? "development";
  return { name, env };
}

export const SELF: PackageInfo = describePackage("@binderly/tsconfig");

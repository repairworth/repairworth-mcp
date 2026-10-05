// Maintainer script: copies the repairworth.com engine and the state-law dataset into vendor/, and
// recomputes the parity vectors from the engine SOURCE. It expects the site repository two levels
// up, or at REPAIRWORTH_SITE. Package users never run it: vendor/ and test/vectors.json are
// committed, and neither the server nor the tests read anything outside this package.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCases } from "./cases.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const site = resolve(root, process.env.REPAIRWORTH_SITE ?? "../..");
const vendor = join(root, "vendor");
const ENGINE = join(site, "src/engine.js");
const RELEASE = join(site, "research/laws/release");
const CSV = "us-state-auto-repair-estimate-laws.csv";
const NOTICE = "DO NOT EDIT. Synced from the repairworth.com sources by scripts/sync.mjs.";

// The engine keeps its own terms (LICENSE, part 2); the notice travels at the top of the file.
const HEADER = [
  "// DO NOT EDIT. Synced from the repairworth.com engine by scripts/sync.mjs.",
  "// Copyright (c) 2026 RepairWorth. All rights reserved. Distributed with repairworth-mcp only: see LICENSE.",
];
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

// 1. Dataset: the exact bytes, checked against the release's own checksum before anything is
//    written. A CSV has no comment syntax, so its notice and checksum live in vendor/SOURCE.json.
const csv = readFileSync(join(RELEASE, CSV));
const sums = readFileSync(join(RELEASE, "SHA256SUMS"), "utf8");
const expected = sums.split(/\r?\n/).map((row) => row.trim().split(/\s+/)).find(([, name]) => name?.replace(/^\*/, "") === CSV)?.[0];
if (!expected) throw new Error(`SHA256SUMS has no line for ${CSV}: nothing was synced.`);
if (sha256(csv) !== expected) throw new Error(`${CSV} does not match SHA256SUMS (${sha256(csv)} against ${expected}): nothing was synced.`);

// 2. Engine: the source file, unchanged, under the notice. An engine that fails its own test suite
//    is being edited: nothing is copied. Line endings are left out of its fingerprint.
const engine = readFileSync(ENGINE, "utf8").replace(/\r\n/g, "\n");
const siteTests = spawnSync(process.execPath, ["--test", "tests/engine.test.cjs"], { cwd: site, encoding: "utf8" });
if (siteTests.status !== 0) {
  console.error(`${siteTests.stdout}${siteTests.stderr}`.trim().split("\n").slice(-25).join("\n"));
  throw new Error("The engine fails its own test suite: nothing was synced.");
}

mkdirSync(vendor, { recursive: true });
writeFileSync(join(vendor, CSV), csv);
writeFileSync(join(vendor, "engine.cjs"), `${HEADER.join("\n")}\n${engine}`);
writeFileSync(
  join(vendor, "SOURCE.json"),
  `${JSON.stringify({ notice: NOTICE, engine: { file: "engine.cjs", header_lines: HEADER.length, sha256: sha256(engine) }, dataset: { file: CSV, sha256: expected } }, null, 2)}\n`,
);

// 3. Parity vectors. The expected value is what the engine SOURCE returns for the arguments as JSON
//    carries them, not what vendor/ returns.
const E = createRequire(import.meta.url)(ENGINE);
const direct = {
  analyze_quote: (args) => E.calculateQuote(args),
  compare_quotes: (args) => E.compareQuotes(args.a, args.b, args.scopes),
  maintenance_plan: (args) => E.maintenancePlan(args),
  towing_estimate: (args) => E.towingEstimate(args),
};
const cases = buildCases(E).map(({ tool, label, args }) => {
  const sent = JSON.parse(JSON.stringify(args));
  return { tool, label, args: sent, expected: direct[tool](sent) };
});
mkdirSync(join(root, "test"), { recursive: true });
writeFileSync(join(root, "test/vectors.json"), `{"cases":[\n${cases.map((c) => JSON.stringify(c)).join(",\n")}\n]}\n`);

const refused = cases.filter((c) => !c.expected.valid).length;
console.log(`vendor/engine.cjs: ${sha256(engine).slice(0, 12)}`);
console.log(`vendor/${CSV}: ${expected.slice(0, 12)} (matches SHA256SUMS)`);
console.log(`test/vectors.json: ${cases.length} cases, ${refused} refused by the engine, across ${new Set(cases.map((c) => c.tool)).size} tools`);

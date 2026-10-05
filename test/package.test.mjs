// What the package promises beyond parity: untouched copies in vendor/, schemas that say what the
// engine enforces, a server that refuses what the engine would silently drop, and clean public files.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import E from "../vendor/engine.cjs";
import { tools } from "../src/tools.js";

const root = new URL("../", import.meta.url);
const bytes = (path) => readFileSync(new URL(path, root));
// A checkout may rewrite the line endings of text files; the dataset is compared byte for byte.
const read = (path) => bytes(path).toString("utf8").replace(/\r\n/g, "\n");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const byName = new Map(tools.map((t) => [t.name, t]));
const run = (name, args) => byName.get(name).handler(args);

test("vendor/ holds the engine and the dataset unchanged", () => {
  const record = JSON.parse(read("vendor/SOURCE.json"));
  assert.match(record.notice, /^DO NOT EDIT\./);
  const lines = read(`vendor/${record.engine.file}`).split("\n");
  assert.match(lines[0], /^\/\/ DO NOT EDIT\. Synced from the repairworth\.com engine/);
  assert.match(lines[1], /All rights reserved\. Distributed with repairworth-mcp only/);
  assert.equal(sha256(lines.slice(record.engine.header_lines).join("\n")), record.engine.sha256, "the engine was edited after the sync");
  assert.equal(sha256(bytes(`vendor/${record.dataset.file}`)), record.dataset.sha256, "the dataset was edited after the sync");
});

test("the tools are the five announced, and leave out what the site does not publish", () => {
  assert.deepEqual([...byName.keys()], ["analyze_quote", "compare_quotes", "maintenance_plan", "towing_estimate", "state_estimate_law"]);
  assert.equal(read("src/tools.js").includes("repairOrReplace"), false);
});

test("the schemas carry the engine's statuses and limits", () => {
  const quote = byName.get("analyze_quote").inputSchema.properties;
  const line = quote.lines.items.properties;
  for (const modes of [quote.totalMode.enum, line.mode.enum]) {
    for (const mode of modes) assert.equal(E.normalizeMoneyValue(mode, 1, 2).valid, true, mode);
    // The engine's list is not exported: one status more or less shows here.
    for (const other of ["", "estimate", "free", "tbd", "none", "zero"]) assert.equal(E.normalizeMoneyValue(other, 1, 2).valid, false, other);
    assert.equal(modes.length, 5);
  }
  assert.equal(quote.totalLow.maximum, E.LIMITS.money);
  assert.equal(E.calculateQuote({ totalMode: "fixed", totalLow: E.LIMITS.money }).valid, true);
  assert.equal(E.calculateQuote({ totalMode: "fixed", totalLow: E.LIMITS.money + 1 }).valid, false);

  const plan = byName.get("maintenance_plan").inputSchema.properties;
  assert.deepEqual([plan.months.minimum, plan.months.maximum], [1, E.LIMITS.months]);
  for (const [months, valid] of [[1, true], [E.LIMITS.months, true], [0, false], [E.LIMITS.months + 1, false], [1.5, false]]) {
    assert.equal(E.maintenancePlan({ months, reserveMonthly: 1 }).valid, valid, `months=${months}`);
  }

  const tow = byName.get("towing_estimate").inputSchema;
  const base = { base: 1, includedDistance: 0, totalDistance: 1, perDistance: 1, unit: "mi" };
  assert.equal(E.towingEstimate(base).valid, true);
  for (const key of tow.required) {
    const { [key]: _, ...rest } = base;
    assert.equal(E.towingEstimate(rest).valid, false, `${key} is not required by the engine`);
  }
  assert.deepEqual(Object.keys(tow.properties).filter((key) => !tow.required.includes(key)), ["fees"]);
  for (const unit of tow.properties.unit.enum) assert.equal(E.towingEstimate({ ...base, unit }).valid, true, unit);
  assert.equal(tow.properties.perDistance.maximum, E.LIMITS.rate);
  assert.equal(E.towingEstimate({ ...base, perDistance: E.LIMITS.rate + 1 }).valid, false);
  assert.equal(tow.properties.totalDistance.maximum, E.LIMITS.distance);
  assert.equal(E.towingEstimate({ ...base, totalDistance: E.LIMITS.distance + 1 }).valid, false);
});

test("the server refuses what the engine would ignore or coerce without a word", () => {
  const refused = (name, args, pattern) => {
    const { payload, isError } = run(name, args);
    assert.equal(isError, true, JSON.stringify(args));
    assert.deepEqual(Object.keys(payload), ["error"]);
    assert.match(payload.error, pattern);
  };
  refused("analyze_quote", { total_low: 100 }, /^Unknown input in the quote: total_low\./);
  refused("analyze_quote", JSON.parse('{"__proto__": 1}'), /^Unknown input in the quote: __proto__\./);
  refused("analyze_quote", { lines: { parts: 100 } }, /lines must be an array\.$/);
  refused("analyze_quote", { lines: [null] }, /lines\[0\] must be an object\.$/);
  refused("analyze_quote", { lines: [{ mode: "fixed", low: 1, amount: 2 }] }, /^Unknown input in the quote\.lines\[0\]: amount\./);
  refused("analyze_quote", { lines: [{ mode: "fixed", low: 1, sign: "-1" }] }, /sign must be 1 or -1\.$/);
  refused("analyze_quote", { lines: [{ mode: "fixed", low: 1, conditionalRefund: "false" }] }, /conditionalRefund must be true or false\.$/);
  refused("analyze_quote", { lines: [{ mode: "fixed", low: 1, key: 7 }] }, /key must be a string\.$/);
  refused("compare_quotes", { a: {}, b: {}, quoteC: {} }, /^Unknown input in compare_quotes: quoteC\./);
  refused("compare_quotes", { a: "1200", b: {} }, /^quote A must be an object\.$/);
  refused("compare_quotes", { a: {}, b: { lines: [[]] } }, /^quote B\.lines\[0\] must be an object\.$/);
  refused("compare_quotes", { a: {}, b: {}, scopes: null }, /^scopes must be an object\.$/);
  refused("compare_quotes", { a: {}, b: {}, scopes: { c: {} } }, /^Unknown input in scopes: c\./);
  refused("compare_quotes", { a: {}, b: {}, scopes: { a: "included" } }, /^scopes\.a must be an object\.$/);
  refused("compare_quotes", { a: {}, b: {}, scopes: { b: { alignment: true } } }, /^scopes\.b: every value must be a string\.$/);
  refused("maintenance_plan", { months: 12, plannedLow: 100 }, /^Unknown input in maintenance_plan: plannedLow\./);
  refused("maintenance_plan", { months: 12, events: "oil change" }, /^events must be an array\.$/);
  refused("maintenance_plan", { months: 12, events: ["oil change"] }, /^events\[0\] must be an object\.$/);
  refused("maintenance_plan", { months: 12, events: [{ month: 1, low: 1, mode: "fixed" }] }, /^Unknown input in events\[0\]: mode\./);
  refused("towing_estimate", { base: 80, distance: 25 }, /^Unknown input in towing_estimate: distance\./);

  // A missing quote is the engine's to report, in its own words.
  const { payload, isError } = run("compare_quotes", { a: { totalMode: "fixed", totalLow: 500 } });
  assert.equal(isError, true);
  assert.deepEqual(payload.errors, [{ quote: "B", message: "Enter a communicated total or at least one known line amount." }]);
});

// Public files: everything outside node_modules, the lockfile and the local build notes.
function publicFiles(dir = "") {
  return readdirSync(new URL(dir || ".", root), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) return ["node_modules", ".git"].includes(entry.name) ? [] : publicFiles(`${path}/`);
    return entry.name === "package-lock.json" || entry.name.endsWith(".local.md") ? [] : [path];
  });
}

test("no public file holds a local path, and none calls RepairWorth a repair business", () => {
  const files = publicFiles();
  assert.ok(files.includes("README.md") && files.includes("vendor/engine.cjs") && files.includes("docs/tools.mdx"));
  for (const file of files) {
    const text = read(file);
    assert.doesNotMatch(text, /[A-Za-z]:[\\/](Users|Documents|Windows)\b/, `${file}: drive path`);
    assert.doesNotMatch(text, /(^|[\s"'(=])\/(Users|home)\/[\w.-]+/m, `${file}: home path`);
    assert.doesNotMatch(text, /RepairWorth(\.com)? is an? (auto |car |repair )*(garage|shop|mechanic|dealer)/i, `${file}`);
  }
});

test("README and docs link to the site four times at most, to the agreed pages", () => {
  // Tool pages first (owner rule of 2026-10-01, "commercial first"); the home page is no longer linked.
  const allowed = ["https://repairworth.com/car-repair-estimate/", "https://repairworth.com/towing/cost-calculator/",
    "https://repairworth.com/maintenance/cost-planner/", "https://repairworth.com/data-sources/"];
  const links = (text) => text.match(/https?:\/\/(www\.)?repairworth\.com[^\s)"'`>\]]*/g) ?? [];
  for (const group of [["README.md"], ["docs/index.mdx", "docs/tools.mdx"]]) {
    const found = group.flatMap((file) => links(read(file)));
    assert.ok(found.length >= 1 && found.length <= 4, `${group}: ${found.length} links`);
    for (const url of found) assert.ok(allowed.includes(url), `${group}: ${url}`);
  }
  const docs = JSON.parse(read("docs.json"));
  assert.equal(docs.$schema, "https://docs.page/schema.json");
  for (const { href } of docs.sidebar.flatMap((group) => group.pages)) {
    assert.ok(publicFiles("docs/").includes(`docs/${href === "/" ? "index" : href.slice(1)}.mdx`), href);
  }
});

test("package.json names the project's own namespace and ships only what runs", () => {
  const pkg = JSON.parse(read("package.json"));
  const server = JSON.parse(read("server.json"));
  assert.equal(pkg.name, "repairworth-mcp");
  assert.equal(pkg.mcpName, "io.github.repairworth/repairworth-mcp");
  assert.equal(pkg.repository.url, "git+https://github.com/repairworth/repairworth-mcp.git");
  assert.equal(pkg.license, "SEE LICENSE IN LICENSE");
  assert.deepEqual(pkg.files, ["bin", "src", "vendor", "README.md", "LICENSE"]);
  assert.deepEqual(Object.keys(pkg.dependencies), ["@modelcontextprotocol/sdk"]);
  assert.deepEqual([server.name, server.version, server.packages[0].identifier, server.packages[0].version], [pkg.mcpName, pkg.version, pkg.name, pkg.version]);
  assert.ok(server.description.length <= 100);
  const license = read("LICENSE");
  for (const part of [/MIT License/, /vendor\/engine\.cjs\): Copyright \(c\) 2026 RepairWorth\. All rights reserved\./, /Creative Commons Attribution 4\.0 International/]) assert.match(license, part);
});

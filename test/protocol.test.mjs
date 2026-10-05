// Protocol: the real binary as a child process, spoken to in raw JSON-RPC over its stdin and stdout.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const bin = fileURLToPath(new URL("../bin/repairworth-mcp.js", import.meta.url));
const waiting = new Map();
let child;
let nextId = 1;
let initialized;

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method}: no answer`)), 15000);
    waiting.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}
const call = async (name, args) => (await request("tools/call", { name, arguments: args })).result;
const body = (result) => JSON.parse(result.content[0].text);

// One call per tool.
const SAMPLES = {
  analyze_quote: { totalMode: "fixed", totalLow: "1400", lines: [{ key: "parts", mode: "fixed", low: 800 }, { key: "labor", mode: "fixed", low: 500 }, { key: "tax", mode: "fixed", low: "80" }] },
  compare_quotes: { a: { totalMode: "fixed", totalLow: 1320 }, b: { totalMode: "range", totalLow: 1500, totalHigh: 1750 }, scopes: { a: { alignment: "included" }, b: { alignment: "excluded" } } },
  maintenance_plan: { months: 12, reserveMonthly: 50, events: [{ label: "Brake service", month: 3, low: 600, high: 1200 }] },
  towing_estimate: { base: 80, includedDistance: 10, totalDistance: 25, perDistance: 4, fees: 20, unit: "mi" },
  state_estimate_law: { state: "CA" },
};

before(async () => {
  child = spawn(process.execPath, [bin], { stdio: ["pipe", "pipe", "ignore"] });
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line) continue;
      // stdout carries JSON-RPC and nothing else: a stray line fails the parse.
      const message = JSON.parse(line);
      waiting.get(message.id)?.(message);
      waiting.delete(message.id);
    }
  });
  initialized = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "repairworth-mcp-test", version: "0.0.0" },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
});
after(() => {
  child.stdin.end();
  child.kill();
});

test("initialize reports the package name and version and the tools capability", () => {
  assert.equal(initialized.jsonrpc, "2.0");
  assert.deepEqual(initialized.result.serverInfo, { name: pkg.name, version: pkg.version });
  assert.ok(initialized.result.capabilities.tools);
  assert.equal(typeof initialized.result.protocolVersion, "string");
});

test("tools/list returns the five tools with an object schema and a description", async () => {
  const { tools } = (await request("tools/list", {})).result;
  assert.deepEqual(tools.map((t) => t.name), Object.keys(SAMPLES));
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, "object", tool.name);
    assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
    assert.ok(tool.description.length > 80, tool.name);
  }
});

test("tools/call succeeds once per tool", async () => {
  for (const [name, args] of Object.entries(SAMPLES)) {
    const result = await call(name, args);
    assert.notEqual(result.isError, true, `${name}: ${result.content[0].text}`);
    assert.equal(result.content[0].type, "text");
    assert.equal(typeof body(result), "object");
  }
  assert.deepEqual(body(await call("analyze_quote", SAMPLES.analyze_quote)).reconciliation, { lowCents: 2000, highCents: 2000 });
  assert.equal(body(await call("compare_quotes", SAMPLES.compare_quotes)).direction, "b-higher");
  assert.equal(body(await call("maintenance_plan", SAMPLES.maintenance_plan)).monthlyLowCents, 10000);
  assert.equal(body(await call("towing_estimate", SAMPLES.towing_estimate)).totalCents, 16000);
  assert.equal(body(await call("state_estimate_law", SAMPLES.state_estimate_law)).law.state, "California");
});

test("an input the engine refuses returns isError with the engine's own errors", async () => {
  const result = await call("towing_estimate", { base: "", includedDistance: 0, totalDistance: 10, perDistance: 4, unit: "mi" });
  assert.equal(result.isError, true);
  assert.deepEqual(body(result), { valid: false, errors: [{ field: "base", code: "required", message: "Base fee is required." }] });
});

test("an unknown state, an unknown key and an unknown tool are refused", async () => {
  const state = await call("state_estimate_law", { state: "ZZ" });
  assert.equal(state.isError, true);
  assert.match(body(state).error, /^Unknown state code: "ZZ"/);
  const typo = await call("analyze_quote", { total_low: 1400 });
  assert.equal(typo.isError, true);
  assert.match(body(typo).error, /^Unknown input in the quote: total_low\./);
  const missing = await call("repair_or_replace", {});
  assert.equal(missing.isError, true);
});

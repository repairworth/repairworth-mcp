// Parity: each case of test/vectors.json (the calls of the site's engine test suite, answered by the
// engine SOURCE at sync time) goes through the MCP handler, and must come back as the engine gave it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import E from "../vendor/engine.cjs";
import { tools } from "../src/tools.js";

const { cases } = JSON.parse(readFileSync(new URL("./vectors.json", import.meta.url), "utf8"));
const byName = new Map(tools.map((t) => [t.name, t]));
const asJson = (value) => JSON.parse(JSON.stringify(value));
// The engine called directly, with no tool in between.
const direct = {
  analyze_quote: (args) => E.calculateQuote(args),
  compare_quotes: (args) => E.compareQuotes(args.a, args.b, args.scopes),
  maintenance_plan: (args) => E.maintenancePlan(args),
  towing_estimate: (args) => E.towingEstimate(args),
};

test("the vectors cover every engine tool, with accepted and refused inputs", () => {
  assert.ok(cases.length >= 20, `${cases.length} cases`);
  for (const name of Object.keys(direct)) {
    const own = cases.filter((c) => c.tool === name);
    assert.ok(own.some((c) => c.expected.valid) && own.some((c) => !c.expected.valid), name);
  }
  assert.deepEqual([...new Set(cases.map((c) => c.tool))].sort(), Object.keys(direct).sort());
});

for (const { tool, label, args, expected } of cases) {
  test(`${tool}: ${label}`, () => {
    const { payload, isError } = byName.get(tool).handler(args);
    assert.deepEqual(asJson(payload), expected, "the handler differs from the engine source");
    assert.deepEqual(asJson(payload), asJson(direct[tool](args)), "the handler differs from the vendored engine");
    assert.equal(isError, !expected.valid);
    assert.equal("error" in payload, false, "refused by the server, not by the engine");
  });
}

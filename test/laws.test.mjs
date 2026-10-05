// state_estimate_law: the 50 states and DC answer with their own row, as published.
import assert from "node:assert/strict";
import { test } from "node:test";
import { COLUMNS, STATE_CODES, STATUS_MEANING } from "../src/laws.js";
import { tools } from "../src/tools.js";

const USPS = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
const law = tools.find((t) => t.name === "state_estimate_law");
const lookup = (state) => law.handler({ state });

test("the dataset holds one row for each of the 50 states and DC", () => {
  assert.equal(USPS.length, 51);
  assert.deepEqual([...STATE_CODES].sort(), [...USPS].sort());
  assert.deepEqual(law.inputSchema.properties.state.enum, STATE_CODES);
});

test("every state answers with its row, its status, its source and the notice", () => {
  for (const code of USPS) {
    const { payload, isError } = lookup(code);
    assert.equal(isError, false, code);
    assert.deepEqual(Object.keys(payload.law), COLUMNS, code);
    assert.equal(payload.law.state_code, code);
    assert.ok(payload.law.state.length > 3, code);
    assert.ok(Object.hasOwn(STATUS_MEANING, payload.law.status), `${code}: status ${payload.law.status} has no meaning on file`);
    assert.equal(payload.status_meaning, STATUS_MEANING[payload.law.status]);
    assert.match(payload.law.official_url, /^(https?:\/\/\S+)?$/, code);
    assert.match(payload.law.checked_on, /^\d{4}-\d{2}-\d{2}$/, code);
    if (payload.law.status === "verified") {
      assert.ok(payload.law.statute_citation && payload.law.official_url && payload.law.verified_quote, `${code}: a verified row names its statute, its official page and a quote`);
    }
    assert.match(payload.disclaimer, /^Not legal advice\. Verify the official text\./);
    assert.match(payload.notes.empty_values, /not established from the source read/);
    assert.equal(payload.dataset.license, "CC BY 4.0");
    assert.equal(payload.dataset.rows, 51);
    assert.match(payload.dataset.sha256, /^[0-9a-f]{64}$/);
  }
  assert.match(law.description, /Not legal advice/);
});

test("a code is read whatever its case or padding", () => {
  assert.deepEqual(lookup(" ca ").payload, lookup("CA").payload);
  assert.equal(lookup("dc").payload.law.state_code, "DC");
});

test("an unknown code is refused with the list of codes", () => {
  for (const state of ["ZZ", "California", "", 42, null, undefined, ["CA"]]) {
    const { payload, isError } = lookup(state);
    assert.equal(isError, true, String(state));
    assert.match(payload.error, /^Unknown state code: /);
    assert.match(payload.error, /AL, AK, AZ/);
    assert.deepEqual(Object.keys(payload), ["error"]);
  }
  assert.match(law.handler({ code: "CA" }).payload.error, /^Unknown input in state_estimate_law: code\./);
});

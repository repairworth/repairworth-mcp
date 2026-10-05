// The state-law dataset, read from the copy in vendor/. Rows are returned as published: nothing is
// inferred, filled in or reworded here.
import { readFileSync } from "node:fs";

const source = JSON.parse(readFileSync(new URL("../vendor/SOURCE.json", import.meta.url), "utf8"));
const text = readFileSync(new URL(`../vendor/${source.dataset.file}`, import.meta.url), "utf8");

// RFC 4180: quoted fields may hold commas, line breaks and doubled quotes.
function parseCsv(csv) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (csv[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && csv[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const [header, ...records] = parseCsv(text);
const laws = new Map(records.map((cells) => [cells[header.indexOf("state_code")], Object.fromEntries(header.map((name, i) => [name, cells[i]]))]));

export const STATE_CODES = [...laws.keys()];
export const COLUMNS = header;

// Wording of the dataset's own documentation.
export const STATUS_MEANING = {
  verified: "The official text was read and the row names a statute or rule. Rule values come from that text.",
  no_statute_found: "An official source was read on the date given and no dedicated statute was found. This is a negative finding: it cannot be proven by quotation. Rule cells are empty.",
  lead: "The official text was not read; any citation or reference kept in the record is a pointer to follow up, and the rule fields are empty.",
};
export const DISCLAIMER = "Not legal advice. Verify the official text. This dataset summarizes public legal texts for research and consumer information. Laws change, and a short summary can miss exceptions. Read the official text, or ask a lawyer, before relying on any row.";
const NOTES = {
  empty_values: 'An empty value means "not established from the source read". It does not mean "no rule".',
  scope: "Only state-level law is covered. Municipal ordinances are out of scope.",
  secondary_url: "A legal mirror, given for convenience only. It is never used as evidence.",
};

export const DATASET = {
  title: "U.S. State Auto Repair Estimate Laws",
  publisher: "RepairWorth",
  url: "https://repairworth.com/car-repair-estimate/",
  license: "CC BY 4.0",
  license_url: "https://creativecommons.org/licenses/by/4.0/",
  rows: laws.size,
  latest_check: records.map((cells) => cells[header.indexOf("checked_on")]).sort().pop(),
  sha256: source.dataset.sha256,
};

export function stateLaw(code) {
  const law = typeof code === "string" ? laws.get(code.trim().toUpperCase()) : undefined;
  if (!law) return null;
  return { law, status_meaning: STATUS_MEANING[law.status], disclaimer: DISCLAIMER, notes: NOTES, dataset: DATASET };
}

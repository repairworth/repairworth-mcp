# repairworth-mcp

A Model Context Protocol server (stdio) that runs the calculation engine of the RepairWorth
[car repair estimate checker](https://repairworth.com/car-repair-estimate/) from an MCP client. RepairWorth is an
independent publication that helps drivers read a US auto repair quote before they pay.

The server works on the amounts written on a quote. It checks that a total agrees with its itemized lines,
compares two quotes line by line, rebuilds a towing bill from its own terms, and spreads planned maintenance over
a number of months. A fifth tool looks up one state in a dataset of state laws on auto repair estimates.

**What it does not do.** The server holds no market price and no typical range. It does not say what a repair
should cost, and it does not say whether a quote is fair. Every dollar amount in a result was computed from an
amount the caller supplied.

The engine is not re-implemented here. The site's engine file is copied unchanged into `vendor/`, and the test
suite checks that each tool returns what the engine returns.

## Install

Requires Node.js 18 or later. The package is not on npm yet: install it from this repository.

```bash
git clone https://github.com/repairworth/repairworth-mcp.git
cd repairworth-mcp
npm ci
```

Claude Desktop (`claude_desktop_config.json`), with the absolute path of your clone:

```json
{
  "mcpServers": {
    "repairworth": {
      "command": "node",
      "args": ["/absolute/path/to/repairworth-mcp/bin/repairworth-mcp.js"]
    }
  }
}
```

Claude Code:

```bash
claude mcp add repairworth -- node /absolute/path/to/repairworth-mcp/bin/repairworth-mcp.js
```

## Tools

| Tool | What it returns |
|---|---|
| `analyze_quote` | One quote: the total it supports, the sum of its known lines, the lines with no amount, and the gap between the communicated total and the itemized lines. |
| `compare_quotes` | Two quotes for the same job: the price gap as an interval (B minus A), the lines that differ, and the scope items the two quotes state differently. |
| `maintenance_plan` | Planned services and an optional monthly reserve, as a total and a monthly amount over a horizon of 1 to 240 months. |
| `towing_estimate` | A towing quote rebuilt from its base fee, included distance, total distance, rate per mile or kilometer, and other fees. |
| `state_estimate_law` | One US state or DC: the row of the dataset "U.S. State Auto Repair Estimate Laws", with its status, citation and official URL. |

`analyze_quote` and `compare_quotes` run the same functions as the car repair estimate checker linked above.
`towing_estimate` runs the function of the site's [towing cost calculator](https://repairworth.com/towing/cost-calculator/),
and `maintenance_plan` the one of its [maintenance cost planner](https://repairworth.com/maintenance/cost-planner/).

### Inputs

- A dollar amount is a number, or a string such as `"85"`, `"85.50"` or `"$1,234.50"`, with two decimals at most.
- A line or a total has a status: `fixed` (one amount), `range` (`low` to `high`), `unknown` (the quote gives no
  amount), `included` (covered elsewhere) or `not-applicable`. Only `fixed` and `range` carry an amount. The
  three others are never counted as zero.
- A credit is a positive amount with `sign: -1`. A refundable charge, such as a core charge, is a line with
  `conditionalRefund: true`: it stays out of the total and is reported in the refund fields.
- `maintenance_plan` takes the services, months and prices from the caller. The engine holds no maintenance
  schedule and no service interval.
- An unknown key is refused rather than ignored, so a misspelt input cannot change a total silently.

### Results

Each of the four calculation tools returns the engine's result unchanged, as JSON. Amounts are integer US cents
(`displayLowCents: 140000` is $1,400.00).

An input the engine refuses returns `isError: true` with the engine's own result: `valid: false` and an `errors`
list whose messages are the ones the site shows. A call the server refuses for its shape (an unknown key, a line
that is not an object) returns `isError: true` with a single `error` message.

Example: `analyze_quote` with a total of 1,400 and three lines of 800, 500 and 80 returns, among other fields:

```json
{
  "valid": true,
  "basis": "communicated-total",
  "knownLowCents": 138000,
  "knownHighCents": 138000,
  "displayLowCents": 140000,
  "displayHighCents": 140000,
  "unknown": [],
  "reconciliation": { "lowCents": 2000, "highCents": 2000 }
}
```

The lines add up to $1,380 and the communicated total is $1,400: $20 of the total is not itemized.

When two quotes are ranges that overlap, `compare_quotes` returns `direction: "overlap"` and reports no quote as
lower. A price gap only compares like with like when `comparableScope` is true.

## State laws on repair estimates

`state_estimate_law` takes a two-letter code (`"CA"`, `"DC"`) and returns the row of the dataset as published,
in `law`, with 18 columns: the citation, the official URL, the rules on written estimates, on exceeding the
estimate without new consent and on returning replaced parts, a verbatim quote, and the date of the check.

**Not legal advice. Verify the official text.** The dataset summarizes public legal texts for research and
consumer information. Laws change, and a short summary can miss exceptions. Every response repeats this notice
in `disclaimer`.

| `status` | Meaning |
|---|---|
| `verified` | The official text was read and the row names a statute or rule. Rule values come from that text. |
| `no_statute_found` | An official source was read on the date given and no dedicated statute was found. This is a negative finding: it cannot be proven by quotation. Rule cells are empty. |
| `lead` | The official text was not read; any citation or reference kept in the record is a pointer to follow up, and the rule fields are empty. |

An empty value means "not established from the source read". It does not mean "no rule". Only state-level law is
covered; municipal ordinances are out of scope. The sources behind RepairWorth data are listed on its
[data sources page](https://repairworth.com/data-sources/).

## How the package is built

- `vendor/engine.cjs` is the site's engine under a two-line notice. `vendor/us-state-auto-repair-estimate-laws.csv`
  is the dataset, byte for byte. `vendor/SOURCE.json` records the SHA-256 of both, and the tests recompute them.
- `scripts/sync.mjs` is the maintainer's script that refreshes `vendor/` and `test/vectors.json` from the site
  sources. It refuses to copy a dataset that does not match its published checksum. Nothing else reads outside
  this package: `npm ci && npm test` runs from a bare copy of the repository.
- `test/vectors.json` holds the calls of the engine's own test suite with the answers of the engine source. Each
  one is replayed through the MCP handler and must come back identical.

```bash
npm ci
npm test
```

## License

Three parts, three sets of terms (see `LICENSE`):

- Server code: MIT.
- Calculation engine (`vendor/engine.cjs`): all rights reserved, distributed with this package only.
- Dataset (`vendor/us-state-auto-repair-estimate-laws.csv`): CC BY 4.0. Cite it as: RepairWorth (2026). U.S. State
  Auto Repair Estimate Laws [Data set].

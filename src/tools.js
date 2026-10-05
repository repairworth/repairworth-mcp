// Tools: thin adapters over the engine copied into vendor/. A tool passes its arguments to one engine
// function and returns what the engine returns. No figure, range or verdict is added here.
import E from "../vendor/engine.cjs";
import { DISCLAIMER, STATE_CODES, stateLaw } from "./laws.js";

const NO_PRICE = "The tool holds no market price and no typical range: it does not say what the work should cost or whether a price is fair.";
const REFUSAL = "An input the engine refuses comes back with `valid: false` and the engine's own messages.";

// Statuses accepted by the engine's normalizeMoneyValue.
const MODES = ["fixed", "range", "unknown", "included", "not-applicable"];

const money = (description, maximum = E.LIMITS.money) => ({
  type: ["number", "string"],
  minimum: 0,
  maximum,
  description: `${description} US dollars with at most two decimals: a number, or a string such as "85", "85.50" or "$1,234.50".`,
});

const lineSchema = {
  type: "object",
  properties: {
    key: { type: "string", description: 'Stable identifier of the line, such as "parts" or "labor". compare_quotes matches the lines of two quotes by this key. Default: "line-<index>".' },
    label: { type: "string", description: "Name of the line as it should appear in messages. Default: \"Line <n>\"." },
    mode: {
      type: "string",
      enum: MODES,
      default: "unknown",
      description: "fixed: one amount in `low`. range: `low` to `high`. unknown: the quote gives no amount for this line. included: covered by another line or by the total. not-applicable: the line does not exist on this quote. Only fixed and range carry an amount; the three others are never counted as zero.",
    },
    low: money("Amount of the line, or its lower bound. Never negative: a credit is a positive amount with `sign: -1`."),
    high: money("Upper bound of the line (range only)."),
    sign: { type: "integer", enum: [1, -1], default: 1, description: "-1 for a credit or discount, which is subtracted from the known lines." },
    conditionalRefund: { type: "boolean", default: false, description: "true for an amount refunded only if a condition is met, such as a core charge returned with the old part. It stays out of the total and is reported in the refund fields." },
  },
  additionalProperties: false,
};

const quoteProperties = {
  totalMode: { type: "string", enum: MODES, default: "unknown", description: "Status of the total written on the quote. fixed: one amount in `totalLow`. range: `totalLow` to `totalHigh`. unknown, included or not-applicable: no total was communicated, and the known lines are summed instead." },
  totalLow: money("Communicated total, or its lower bound."),
  totalHigh: money("Upper bound of the communicated total (range only)."),
  lines: { type: "array", items: lineSchema, description: "Itemized lines of the quote: parts, labor, fees, tax, credits, refundable charges." },
};
const quoteSchema = (description) => ({ type: "object", description, properties: quoteProperties, additionalProperties: false });

const scopeSchema = (side) => ({
  type: "object",
  description: `What quote ${side} says about each scope item, keyed by an item name of your choice (for example "alignment" or "programming"). The site uses the values not-specified, included, excluded and not-applicable; an item left out counts as not-specified.`,
  additionalProperties: { type: "string" },
});

const wholeMonths = (description) => ({ type: ["integer", "string"], minimum: 1, maximum: E.LIMITS.months, description });

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const refuse = (error) => ({ payload: { error }, isError: true });
const engineResult = (result) => ({ payload: result, isError: !result.valid });

// Structure only. What the engine validates (amounts, statuses, months, distances, units) is left to
// the engine, whose messages come back unchanged. What is refused below is what the engine would
// ignore or coerce without a word: an unknown key, a line that is not an object, a sign that is not
// 1 or -1.
function unknownKeys(value, properties, where) {
  const allowed = Object.keys(properties);
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  return extra.length ? `Unknown input in ${where}: ${extra.join(", ")}. Expected: ${allowed.join(", ")}.` : null;
}

function quoteProblem(quote, where) {
  if (!isObject(quote)) return `${where} must be an object.`;
  let problem = unknownKeys(quote, quoteProperties, where);
  if (problem || quote.lines === undefined) return problem;
  if (!Array.isArray(quote.lines)) return `${where}.lines must be an array.`;
  for (const [index, line] of quote.lines.entries()) {
    const at = `${where}.lines[${index}]`;
    if (!isObject(line)) return `${at} must be an object.`;
    if ((problem = unknownKeys(line, lineSchema.properties, at))) return problem;
    for (const key of ["key", "label"]) if (line[key] !== undefined && typeof line[key] !== "string") return `${at}.${key} must be a string.`;
    if (line.sign !== undefined && line.sign !== 1 && line.sign !== -1) return `${at}.sign must be 1 or -1.`;
    if (line.conditionalRefund !== undefined && typeof line.conditionalRefund !== "boolean") return `${at}.conditionalRefund must be true or false.`;
  }
  return null;
}

const analyzeQuote = {
  name: "analyze_quote",
  description: `Checks the arithmetic of one US auto repair quote or estimate from the amounts read on it: the communicated total and the itemized lines (parts, labor, fees, tax, credits, refundable core charges). Returns the result of the repairworth.com engine unchanged: \`basis\` (communicated-total, complete-known-breakdown or partial-known-breakdown), the total the quote supports (\`displayLowCents\`, \`displayHighCents\`), the sum of the known lines, the lines with no amount (\`unknown\`), the refundable amounts, and \`reconciliation\`, the gap between the communicated total and the itemized lines, given only when every line is known. Amounts come back in integer US cents. ${NO_PRICE} ${REFUSAL}`,
  inputSchema: { type: "object", properties: quoteProperties, additionalProperties: false },
  handler(args) {
    const problem = quoteProblem(args, "the quote");
    return problem ? refuse(problem) : engineResult(E.calculateQuote(args));
  },
};

const compareProperties = {
  a: quoteSchema("Quote A."),
  b: quoteSchema("Quote B."),
  scopes: {
    type: "object",
    description: "Optional. What each quote says it covers, so that a price gap is not read without the scope gap.",
    properties: { a: scopeSchema("A"), b: scopeSchema("B") },
    additionalProperties: false,
  },
};

const compareQuotes = {
  name: "compare_quotes",
  description: `Compares two US auto repair quotes for the same job, A and B, from the amounts read on them. Returns the result of the repairworth.com engine unchanged: \`deltaLowCents\` and \`deltaHighCents\` (B minus A, an interval when a quote is a range), \`direction\` (equal, overlap, a-higher or b-higher), \`lineDifferences\` (lines matched by \`key\`: same-amount, amount-differs, status-differs, only-in-a, only-in-b, both-unspecified, same-status) and the scope items the two quotes state differently (\`scopeDifferences\`, \`comparableScope\`). When the two ranges overlap the direction is \`overlap\` and no quote is reported as lower. The tool names no winner: a price gap only compares like with like when \`comparableScope\` is true. Amounts come back in integer US cents. ${NO_PRICE} ${REFUSAL}`,
  inputSchema: { type: "object", properties: compareProperties, required: ["a", "b"], additionalProperties: false },
  handler(args) {
    let problem = unknownKeys(args, compareProperties, "compare_quotes");
    // A missing quote is left to the engine, which reports it for that quote.
    for (const side of ["a", "b"]) if (!problem && args[side] !== undefined) problem = quoteProblem(args[side], `quote ${side.toUpperCase()}`);
    if (!problem && args.scopes !== undefined) {
      if (!isObject(args.scopes)) problem = "scopes must be an object.";
      else problem = unknownKeys(args.scopes, compareProperties.scopes.properties, "scopes");
      for (const side of ["a", "b"]) {
        const scope = problem ? undefined : args.scopes[side];
        if (scope === undefined) continue;
        if (!isObject(scope)) problem = `scopes.${side} must be an object.`;
        else if (Object.values(scope).some((value) => typeof value !== "string")) problem = `scopes.${side}: every value must be a string.`;
      }
    }
    return problem ? refuse(problem) : engineResult(E.compareQuotes(args.a, args.b, args.scopes));
  },
};

const eventProperties = {
  label: { type: "string", description: "Name of the service. Default: \"Service <n>\"." },
  month: wholeMonths("Month of the planning horizon in which the service falls, counted from 1. It must fall inside the horizon."),
  low: money("Price the user was given for the service, or its lower bound."),
  high: money("Upper bound of that price. Leave it out for a single amount."),
};

const maintenanceProperties = {
  months: wholeMonths(`Planning horizon in whole months, from 1 to ${E.LIMITS.months}. Required.`),
  reserveMonthly: money("Optional amount set aside each month for unplanned work. When it is left out the total is flagged as partial."),
  events: {
    type: "array",
    description: "Planned services, at most 24 (a row with every field blank is skipped). A plan needs at least one service or a monthly reserve.",
    items: { type: "object", properties: eventProperties, additionalProperties: false },
  },
};

const maintenancePlan = {
  name: "maintenance_plan",
  description: `Turns the maintenance services a driver already has a price for, plus an optional monthly reserve, into a total and a monthly amount over a planning horizon. Every service, month and amount comes from the caller: the engine holds no maintenance schedule, no service interval and no price, and it adds none. Returns the result of the repairworth.com engine unchanged: the services in month order, \`plannedLowCents\` and \`plannedHighCents\`, the reserve over the horizon, \`totalLowCents\` and \`totalHighCents\`, the monthly amounts, and the flags \`totalIsPartial\` and \`monthlyRounded\`. Amounts come back in integer US cents. ${REFUSAL}`,
  inputSchema: { type: "object", properties: maintenanceProperties, required: ["months"], additionalProperties: false },
  handler(args) {
    let problem = unknownKeys(args, maintenanceProperties, "maintenance_plan");
    if (!problem && args.events !== undefined) {
      if (!Array.isArray(args.events)) problem = "events must be an array.";
      else {
        for (const [index, event] of args.events.entries()) {
          if (problem) break;
          problem = isObject(event) ? unknownKeys(event, eventProperties, `events[${index}]`) : `events[${index}] must be an object.`;
        }
      }
    }
    return problem ? refuse(problem) : engineResult(E.maintenancePlan(args));
  },
};

const distance = (description) => ({
  type: ["number", "string"],
  minimum: 0,
  maximum: E.LIMITS.distance,
  description: `${description} In the unit given by \`unit\`, with at most two decimals when sent as a string.`,
});

const towingProperties = {
  base: money("Base or hook-up fee on the towing quote."),
  includedDistance: distance("Distance covered by the base fee. 0 when none is included."),
  totalDistance: distance("Total distance of the tow."),
  perDistance: money("Rate per mile or per kilometer on the towing quote.", E.LIMITS.rate),
  fees: money("Optional. Other fees on the quote (storage, winching, after-hours). When it is left out the total is flagged as partial."),
  unit: { type: "string", enum: ["mi", "km"], description: "Unit of the two distances and of the rate: miles or kilometers." },
};

const towingEstimate = {
  name: "towing_estimate",
  description: `Rebuilds a towing quote or invoice from its own terms: base fee, distance covered by the base fee, total distance, rate per mile or per kilometer, and other fees. Every rate comes from the quote being checked. Returns the result of the repairworth.com engine unchanged: \`billableMiles\`, \`mileageCents\`, \`totalCents\`, and the flags \`totalIsPartial\` (other fees unknown) and \`mileageRounded\`. Distances come back in miles and amounts in integer US cents. ${NO_PRICE} ${REFUSAL}`,
  inputSchema: {
    type: "object",
    properties: towingProperties,
    required: ["base", "includedDistance", "totalDistance", "perDistance", "unit"],
    additionalProperties: false,
  },
  handler(args) {
    const problem = unknownKeys(args, towingProperties, "towing_estimate");
    return problem ? refuse(problem) : engineResult(E.towingEstimate(args));
  },
};

const lawProperties = {
  state: { type: "string", enum: STATE_CODES, description: "Two-letter USPS code of a US state, or DC." },
};

const stateEstimateLaw = {
  name: "state_estimate_law",
  description: `Looks up one US state, or the District of Columbia, in the dataset "U.S. State Auto Repair Estimate Laws" published by RepairWorth. Returns the row as published: its \`status\` (verified, no_statute_found or lead), the statute citation, the URL of the official state source, the rules on written estimates, on exceeding the estimate without new consent and on returning replaced parts, a verbatim quote of the official text, and the date it was checked. An empty value means "not established from the source read", not "no rule". Only state-level law is covered. ${DISCLAIMER}`,
  inputSchema: { type: "object", properties: lawProperties, required: ["state"], additionalProperties: false },
  handler(args) {
    const problem = unknownKeys(args, lawProperties, "state_estimate_law");
    if (problem) return refuse(problem);
    const payload = stateLaw(args.state);
    if (payload) return { payload, isError: false };
    return refuse(`Unknown state code: ${JSON.stringify(args.state) ?? "none given"}. Expected a two-letter USPS code among: ${STATE_CODES.join(", ")}.`);
  },
};

export const tools = [analyzeQuote, compareQuotes, maintenancePlan, towingEstimate, stateEstimateLaw];

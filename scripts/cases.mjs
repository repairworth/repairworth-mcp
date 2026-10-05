// Parity cases: the calls of the site's own engine test suite, written as MCP tool arguments.
// scripts/sync.mjs runs them on the engine SOURCE and stores the answers in test/vectors.json.
// Left out: the functions that no tool exposes, the inputs JSON cannot carry (NaN, Infinity,
// undefined) and the suite's fictional service fixtures, which are not copied into this package.
const line = (key, label, mode, low = "", high = "", extra = {}) => ({ key, label, mode, low, high, sign: 1, conditionalRefund: false, ...extra });
const quote = (totalMode = "unknown", totalLow = "", totalHigh = "", lines = []) => ({ totalMode, totalLow, totalHigh, lines });
const lcg = (seed) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const SEEDED = 5; // first iterations of each seeded property test of the suite

export function buildCases(E) {
  const cases = [];
  const add = (tool, label, args) => cases.push({ tool, label, args });
  const analyze = (label, args) => add("analyze_quote", label, args);
  const compare = (label, a, b, scopes) => add("compare_quotes", label, scopes ? { a, b, scopes } : { a, b });
  const plan = (label, args) => add("maintenance_plan", label, args);
  const tow = (label, args) => add("towing_estimate", label, args);

  // analyze_quote
  analyze("communicated total, no itemization", quote("fixed", "2000"));
  analyze("detailed quote reconciles in cents", quote("fixed", "1400", "", [line("parts", "Parts", "fixed", "800"), line("labor", "Labor", "fixed", "500"), line("fees", "Fees", "fixed", "30"), line("tax", "Tax", "fixed", "50")]));
  analyze("exact cents and a zero credit", quote("unknown", "", "", [line("units", "Units", "fixed", "19.99"), line("credit", "Credit", "fixed", "0")]));
  analyze("included, unknown and not-applicable are not zero", quote("fixed", "1000", "", [line("parts", "Parts", "included"), line("labor", "Labor", "unknown"), line("fees", "Fees", "not-applicable")]));
  analyze("ranges keep their bounds", quote("unknown", "", "", [line("parts", "Parts", "range", "300", "500"), line("labor", "Labor", "range", "200", "300"), line("fees", "Fees", "fixed", "20")]));
  analyze("reversed range is refused", quote("unknown", "", "", [line("parts", "Parts", "range", "500", "300")]));
  analyze("Infinity is refused", quote("unknown", "", "", [line("parts", "Parts", "fixed", "Infinity")]));
  analyze("credit and conditional refund", quote("fixed", "1480", "", [
    line("parts", "Parts", "fixed", "800"), line("labor", "Labor", "fixed", "500"),
    line("fees", "Fees", "fixed", "130"), line("tax", "Tax", "fixed", "50"),
    line("discount", "Credit", "fixed", "0", "", { sign: -1 }),
    line("core", "Core refund", "fixed", "100", "", { conditionalRefund: true }),
  ]));
  // The suite's money tables, sent as a communicated total.
  for (const input of ["0", "19.99", "$1,234.50", 1.25, "85", "85.5", "85.50", ".5", "0.50", "85.", "$85", "$ 85", "1,234.56", "$1,234", "  85  ", 19.99, 0.1 + 0.2 - 0.3 + 1, 99999999.99]) {
    analyze(`total accepted: ${JSON.stringify(input)}`, quote("fixed", input));
  }
  for (const input of ["", " ", "12.345", "1,23", "1 000", "USD 12", "1e3", "$", ".", "-", "12,3456", "1.234.5", "abc", "12a", "Infinity", "NaN", "-5", true, false, {}, [], null, 4.125, -1]) {
    analyze(`total refused: ${JSON.stringify(input)}`, quote("fixed", input));
  }

  // compare_quotes
  compare(
    "two fixed quotes, one scope difference",
    quote("fixed", "1320", "", [line("parts", "Parts", "fixed", "800"), line("labor", "Labor", "fixed", "500"), line("fees", "Fees", "fixed", "20")]),
    quote("fixed", "1750", "", [line("parts", "Parts", "fixed", "1000"), line("labor", "Labor", "fixed", "650"), line("programming", "Programming", "fixed", "100")]),
    { a: { programming: "not-specified" }, b: { programming: "included" } },
  );
  compare("overlapping ranges have no certain direction", quote("range", "1000", "1400"), quote("range", "1200", "1500"));
  compare("equal totals", quote("fixed", "500"), quote("fixed", "500.00"));
  compare("a range around a fixed total is not equal", quote("range", "400", "600"), quote("fixed", "500"));
  compare(
    "every line kind, credit sign, core refund",
    quote("unknown", "", "", [
      line("parts", "Parts", "fixed", "800"), line("labor", "Labor", "fixed", "500"), line("fees", "Fees", "fixed", "20"),
      line("tax", "Tax", "unknown"), line("shop", "Shop supplies", "included"), line("disposal", "Disposal", "not-applicable"),
      line("diag", "Diagnosis", "included"), line("discount", "Credit", "fixed", "50", "", { sign: -1 }),
      line("core", "Core refund", "fixed", "100", "", { conditionalRefund: true }), line("alignment", "Alignment", "fixed", "90"),
    ]),
    quote("unknown", "", "", [
      line("parts", "Parts", "fixed", "800"), line("labor", "Labor", "range", "400", "700"), line("fees", "Fees", "unknown"),
      line("tax", "Tax", "unknown"), line("shop", "Shop supplies", "included"), line("disposal", "Disposal", "not-applicable"),
      line("diag", "Diagnosis", "not-applicable"), line("discount", "Credit", "fixed", "80", "", { sign: -1 }),
      line("core", "Core refund", "fixed", "150", "", { conditionalRefund: true }), line("programming", "Programming", "fixed", "60"),
    ]),
    { a: { x: "included", y: "excluded" }, b: { x: "included", y: "included", z: "not-specified" } },
  );
  // Not in the suite: a comparison the engine refuses.
  compare("added: quote B has no amount", quote("fixed", "500"), quote());

  // Seeded quote ranges (suite seed 20260922).
  let rand = lcg(20260922);
  for (let index = 0; index < SEEDED; index++) {
    const a = Math.round(rand() * 100000) / 100;
    const b = a + Math.round(rand() * 100000) / 100;
    const c = Math.round(rand() * 100000) / 100;
    const d = c + Math.round(rand() * 100000) / 100;
    analyze(`seeded ranges ${index}`, quote("unknown", "", "", [line("one", "One", "range", a, b), line("two", "Two", "range", c, d)]));
    compare(`seeded ranges ${index}`, quote("range", a, b), quote("range", c, d));
    compare(`seeded ranges ${index}, swapped`, quote("range", c, d), quote("range", a, b));
  }

  // Seeded line differences (suite seed 424242). The suite draws 8 more numbers per iteration for
  // its own sampling: they are drawn here too, so that the lines are the suite's.
  rand = lcg(424242);
  const cents = () => Math.round(rand() * 500000);
  const makeLine = () => {
    const low = cents();
    const high = rand() < 0.5 ? low : low + cents();
    const sign = rand() < 0.3 ? -1 : 1;
    return line("x", "X", low === high ? "fixed" : "range", (low / 100).toFixed(2), (high / 100).toFixed(2), { sign });
  };
  for (let index = 0; index < SEEDED; index++) {
    const la = makeLine();
    const lb = makeLine();
    compare(`seeded line differences ${index}`, quote("fixed", "1", "", [la]), quote("fixed", "1", "", [lb]));
    for (let k = 0; k < 8; k++) rand();
  }

  // maintenance_plan. The suite's first two calls carry a `mode` key on the service, which the
  // engine never reads and the site's form never sends: it is left out here.
  const blankRow = { label: "", month: "", low: "", high: "" };
  plan("services inside an explicit horizon", { months: 12, reserveMonthly: 50, events: [{ label: "Known service", month: 3, low: 600, high: 1200 }] });
  plan("service after the horizon is refused", { months: 6, reserveMonthly: 0, events: [{ label: "Late", month: 8, low: 1 }] });
  plan("blank rows, optional reserve", { months: "12", reserveMonthly: "", events: [blankRow, { label: "Brakes", month: "9", low: "300", high: "" }, blankRow, { label: "Tires", month: "3", low: "600", high: "900" }, { label: "", month: 3, low: "50" }] });
  plan("partial rows report every error", { months: 6, events: [{ label: "Oil", month: "", low: "" }, { month: "8", low: "12.345" }, { month: "2", low: "100", high: "50" }, { month: "2.5", low: "1" }] });
  plan("reserve only", { months: 10, reserveMonthly: "0", events: [blankRow] });
  plan("empty plan is refused", { months: 12, reserveMonthly: "", events: [blankRow, blankRow] });
  plan("exact monthly amount", { months: 4, reserveMonthly: "25", events: [] });
  plan("horizon is required", { months: "", reserveMonthly: 1 });
  plan("25 services are refused", { months: 12, events: Array.from({ length: 25 }, () => ({ month: 1, low: 1 })) });

  // towing_estimate
  const km = (miles) => E.convertDistance(miles, "mi", "km");
  tow("included distance", { base: 80, includedDistance: 10, totalDistance: 25, perDistance: 4, fees: 20, unit: "mi" });
  tow("tow shorter than the included distance", { base: 80, includedDistance: 10, totalDistance: 5, perDistance: 4, fees: 20, unit: "mi" });
  tow("same tow in kilometers", { base: 80, includedDistance: km(10), totalDistance: km(25), perDistance: 4, fees: 20, unit: "km" });
  tow("negative distance is refused", { base: 80, includedDistance: 0, totalDistance: -1, perDistance: 4, fees: 0, unit: "mi" });
  tow("other fees left blank", { base: "80", includedDistance: "10", totalDistance: "25", perDistance: "4", fees: "", unit: "mi" });
  tow("other fees of zero", { base: "80", includedDistance: "10", totalDistance: "25", perDistance: "4", fees: "0", unit: "mi" });
  tow("every error at once", { base: "", includedDistance: "1,000.5", totalDistance: "12.345", perDistance: "4.125", fees: "-3", unit: "yd" });
  tow("thousands separators, no fees key", { base: "$1,000", includedDistance: "1,000", totalDistance: "1,000.5", perDistance: "1", unit: "mi" });
  tow("mileage rounded to the cent", { base: 0, includedDistance: 0, totalDistance: "0.33", perDistance: "1.01", fees: 0, unit: "mi" });
  tow("mileage exact", { base: 0, includedDistance: 0, totalDistance: "10", perDistance: "1.01", fees: 0, unit: "mi" });
  for (const [included, total] of [[0, 7], [3, 40], [12.5, 13], [100, 50]]) {
    tow(`${included}/${total} in miles`, { base: 75, includedDistance: included, totalDistance: total, perDistance: 3.5, fees: 12, unit: "mi" });
    tow(`${included}/${total} in kilometers`, { base: 75, includedDistance: km(included), totalDistance: km(total), perDistance: 3.5, fees: 12, unit: "km" });
  }

  return cases;
}

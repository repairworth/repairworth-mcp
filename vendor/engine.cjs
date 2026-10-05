// DO NOT EDIT. Synced from the repairworth.com engine by scripts/sync.mjs.
// Copyright (c) 2026 RepairWorth. All rights reserved. Distributed with repairworth-mcp only: see LICENSE.
/* RepairWorth calculation core v2. Pure functions; no DOM, network or hidden pricing. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RepairWorthEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MILES_TO_KM = 1.609344;
  const LIMITS = Object.freeze({
    money: 100000000,
    rate: 100000,
    hours: 10000,
    distance: 1000000,
    quantity: 100000,
    months: 240
  });

  function number(value) {
    if (value === '' || value === null || value === undefined || typeof value === 'boolean') return null;
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }

  function isBlank(value) {
    return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
  }

  /* Decimal with optional '-', optional comma thousands groups, at most two decimals ('85.', '.5' accepted). */
  function decimalFromString(text) {
    const match = text.match(/^(-?)(\d+|\d{1,3}(?:,\d{3})+)?(?:\.(\d{0,2}))?$/);
    if (!match || (!match[2] && !match[3])) return null;
    const result = Number(match[1] + (match[2] ? match[2].replaceAll(',', '') : '0') + (match[3] ? '.' + match[3] : ''));
    return Number.isFinite(result) ? result : null;
  }

  function moneyNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    let text = value.trim();
    if (text[0] === '$') text = text.slice(1).trim();
    return text ? decimalFromString(text) : null;
  }

  /* True when n has at most two decimals (float noise tolerated, a real third decimal is not). */
  function hasTwoDecimalsAtMost(n) {
    const scaled = n * 100;
    return Math.abs(scaled - Math.round(scaled)) <= Math.max(1e-9, Math.abs(scaled) * Number.EPSILON * 4);
  }

  function toCents(value, options = {}) {
    const n = moneyNumber(value);
    const maximum = options.maximum ?? LIMITS.money;
    const minimum = options.allowNegative ? -maximum : 0;
    if (n === null || n < minimum || n > maximum || !hasTwoDecimalsAtMost(n)) return null;
    return Math.round((n + Number.EPSILON) * 100);
  }

  /* Field parsers: status 'blank' | 'format' | 'range' | 'ok'. */
  function parseMoneyField(value, maximum = LIMITS.money) {
    if (isBlank(value)) return { status: 'blank', cents: null };
    const n = moneyNumber(value);
    if (n === null || !hasTwoDecimalsAtMost(n)) return { status: 'format', cents: null };
    if (n < 0 || n > maximum) return { status: 'range', cents: null };
    return { status: 'ok', cents: toCents(n, { maximum }) };
  }

  function parseDistanceField(value) {
    if (isBlank(value)) return { status: 'blank', value: null };
    let n = null;
    if (typeof value === 'number') n = Number.isFinite(value) ? value : null;
    else if (typeof value === 'string') n = decimalFromString(value.trim());
    if (n === null) return { status: 'format', value: null };
    if (n < 0 || n > LIMITS.distance) return { status: 'range', value: null };
    return { status: 'ok', value: n };
  }

  function moneyFieldError(field, label, status, maximum = LIMITS.money) {
    if (status === 'blank') return { field, code: 'required', message: label + ' is required.' };
    if (status === 'format') return { field, code: 'format', message: label + ': enter a dollar amount such as 85 or 85.50.' };
    return { field, code: 'range', message: label + ' must be between $0 and ' + money(maximum) + '.' };
  }

  function fromCents(value) {
    return value / 100;
  }

  function money(value) {
    const decimals = Math.abs(value - Math.round(value)) > 1e-9 ? 2 : 0;
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD', minimumFractionDigits: decimals, maximumFractionDigits: 2
    }).format(value);
  }

  function range(low, high) {
    return Math.abs(low - high) < 0.005 ? money(low) : money(low) + '–' + money(high);
  }

  function normalizeMoneyValue(mode, lowValue, highValue, options = {}) {
    const allowed = ['fixed', 'range', 'unknown', 'included', 'not-applicable'];
    if (!allowed.includes(mode)) return { valid: false, message: 'Choose an amount status.' };
    if (mode === 'unknown' || mode === 'included' || mode === 'not-applicable') {
      return { valid: true, mode, lowCents: null, highCents: null };
    }
    const lowCents = toCents(lowValue, options);
    if (lowCents === null) return { valid: false, message: 'Enter a valid US dollar amount with no more than two decimal places.' };
    const highCents = mode === 'range' ? toCents(highValue, options) : lowCents;
    if (highCents === null) return { valid: false, message: 'Enter a valid upper amount.' };
    if (lowCents > highCents) return { valid: false, message: 'The upper amount must be at least the lower amount.' };
    return { valid: true, mode, lowCents, highCents };
  }

  function calculateQuote(input) {
    const source = input && typeof input === 'object' ? input : {};
    const errors = [];
    const total = normalizeMoneyValue(source.totalMode || 'unknown', source.totalLow, source.totalHigh);
    if (!total.valid) errors.push({ field: 'total', message: total.message });
    const lines = Array.isArray(source.lines) ? source.lines : [];
    let knownLowCents = 0;
    let knownHighCents = 0;
    let refundLowCents = 0;
    let refundHighCents = 0;
    let additiveCount = 0;
    const unknown = [];
    const normalizedLines = lines.map((line, index) => {
      const key = typeof line.key === 'string' && line.key ? line.key : 'line-' + index;
      const label = typeof line.label === 'string' && line.label ? line.label : 'Line ' + (index + 1);
      const mode = line.mode || 'unknown';
      const amount = normalizeMoneyValue(mode, line.low, line.high, { allowNegative: false });
      if (!amount.valid) errors.push({ field: key, message: label + ': ' + amount.message });
      const sign = line.sign === -1 ? -1 : 1;
      const conditionalRefund = Boolean(line.conditionalRefund);
      if (amount.valid && (mode === 'fixed' || mode === 'range')) {
        additiveCount += conditionalRefund ? 0 : 1;
        if (conditionalRefund) {
          refundLowCents += amount.lowCents;
          refundHighCents += amount.highCents;
        } else if (sign === 1) {
          knownLowCents += amount.lowCents;
          knownHighCents += amount.highCents;
        } else {
          knownLowCents -= amount.highCents;
          knownHighCents -= amount.lowCents;
        }
      } else if (amount.valid && mode === 'unknown') {
        unknown.push({ key, label });
      }
      return Object.assign({ key, label, sign, conditionalRefund }, amount);
    });
    if (errors.length) return { valid: false, errors, lines: normalizedLines };

    const totalKnown = total.mode === 'fixed' || total.mode === 'range';
    const hasKnownBreakdown = additiveCount > 0;
    const breakdownComplete = hasKnownBreakdown && unknown.length === 0;
    const displayLowCents = totalKnown ? total.lowCents : hasKnownBreakdown ? knownLowCents : null;
    const displayHighCents = totalKnown ? total.highCents : hasKnownBreakdown ? knownHighCents : null;
    if (displayLowCents === null || displayHighCents === null) {
      return {
        valid: false,
        errors: [{ field: 'total', message: 'Enter a communicated total or at least one known line amount.' }],
        lines: normalizedLines,
        unknown
      };
    }

    let reconciliation = null;
    if (totalKnown && breakdownComplete) {
      reconciliation = { lowCents: total.lowCents - knownHighCents, highCents: total.highCents - knownLowCents };
    }
    const afterRefundLowCents = displayLowCents - refundHighCents;
    const afterRefundHighCents = displayHighCents - refundLowCents;
    return {
      valid: true, errors: [], total, lines: normalizedLines, totalKnown, hasKnownBreakdown, breakdownComplete, unknown,
      knownLowCents, knownHighCents, displayLowCents, displayHighCents, refundLowCents, refundHighCents,
      afterRefundLowCents, afterRefundHighCents, reconciliation,
      basis: totalKnown ? 'communicated-total' : breakdownComplete ? 'complete-known-breakdown' : 'partial-known-breakdown'
    };
  }

  function compareQuotes(aInput, bInput, scopes = {}) {
    const a = calculateQuote(aInput);
    const b = calculateQuote(bInput);
    const errors = [];
    if (!a.valid) errors.push({ quote: 'A', message: a.errors[0].message });
    if (!b.valid) errors.push({ quote: 'B', message: b.errors[0].message });
    if (errors.length) return { valid: false, errors, a, b };

    const deltaLowCents = b.displayLowCents - a.displayHighCents;
    const deltaHighCents = b.displayHighCents - a.displayLowCents;
    const overlaps = deltaLowCents <= 0 && deltaHighCents >= 0;
    const equalTotals = deltaLowCents === 0 && deltaHighCents === 0;
    const keys = new Set([...Object.keys(scopes.a || {}), ...Object.keys(scopes.b || {})]);
    const scopeDifferences = [];
    const scopeSummary = { different: 0, same: 0, bothNotSpecified: 0 };
    for (const key of keys) {
      const av = (scopes.a || {})[key] || 'not-specified';
      const bv = (scopes.b || {})[key] || 'not-specified';
      if (av !== bv) { scopeDifferences.push({ key, a: av, b: bv }); scopeSummary.different++; }
      else if (av === 'not-specified') scopeSummary.bothNotSpecified++;
      else scopeSummary.same++;
    }
    return {
      valid: true, errors: [], a, b, deltaLowCents, deltaHighCents, overlaps, equalTotals, scopeDifferences, scopeSummary,
      comparableScope: scopeDifferences.length === 0,
      lineDifferences: lineDifferences(a.lines, b.lines),
      direction: equalTotals ? 'equal' : overlaps ? 'overlap' : deltaLowCents > 0 ? 'b-higher' : 'a-higher'
    };
  }

  /* Signed contribution interval of a numeric line. Conditional refunds are compared as refund amounts
     (positive = refund offered), since they never enter the displayed total. */
  function lineContribution(item) {
    if (item.conditionalRefund || item.sign !== -1) return [item.lowCents, item.highCents];
    return [-item.highCents, -item.lowCents];
  }

  function lineDifferences(aLines, bLines) {
    const numeric = item => item.mode === 'fixed' || item.mode === 'range';
    const side = item => item ? { mode: item.mode, lowCents: item.lowCents, highCents: item.highCents, sign: item.sign, conditionalRefund: item.conditionalRefund } : null;
    const aMap = new Map(aLines.map(item => [item.key, item]));
    const bMap = new Map(bLines.map(item => [item.key, item]));
    const keys = [...aMap.keys(), ...[...bMap.keys()].filter(key => !aMap.has(key))];
    return keys.map(key => {
      const a = aMap.get(key);
      const b = bMap.get(key);
      let kind;
      let deltaLowCents = null;
      let deltaHighCents = null;
      if (!b) kind = 'only-in-a';
      else if (!a) kind = 'only-in-b';
      else if (numeric(a) && numeric(b) && a.conditionalRefund === b.conditionalRefund) {
        const [aLow, aHigh] = lineContribution(a);
        const [bLow, bHigh] = lineContribution(b);
        deltaLowCents = bLow - aHigh;
        deltaHighCents = bHigh - aLow;
        kind = aLow === bLow && aHigh === bHigh ? 'same-amount' : 'amount-differs';
      } else if (numeric(a) || numeric(b) || a.mode !== b.mode || a.conditionalRefund !== b.conditionalRefund) kind = 'status-differs';
      else kind = a.mode === 'unknown' ? 'both-unspecified' : 'same-status';
      return {
        key, label: (a || b).label, a: side(a), b: side(b), kind, deltaLowCents, deltaHighCents,
        conditionalRefund: Boolean((a || b).conditionalRefund)
      };
    });
  }

  function towingEstimate(input) {
    const source = input && typeof input === 'object' ? input : {};
    const unit = source.unit;
    const rateLabel = unit === 'km' ? 'Rate per kilometer' : 'Rate per mile';
    const errors = [];
    const moneyFields = [['base', 'Base fee', LIMITS.money, true], ['perDistance', rateLabel, LIMITS.rate, true], ['fees', 'Other fees', LIMITS.money, false]];
    const distances = [['includedDistance', 'Included distance'], ['totalDistance', 'Total distance']];
    const cents = {};
    const values = {};
    for (const [key, label, max, required] of moneyFields) {
      const parsed = parseMoneyField(source[key], max);
      if (parsed.status === 'ok') cents[key] = parsed.cents;
      else if (parsed.status !== 'blank' || required) errors.push(moneyFieldError(key, label, parsed.status, max));
      else cents[key] = null;
    }
    for (const [key, label] of distances) {
      const parsed = parseDistanceField(source[key]);
      if (parsed.status === 'ok') values[key] = parsed.value;
      else if (parsed.status === 'blank') errors.push({ field: key, code: 'required', message: label + ' is required.' });
      else if (parsed.status === 'format') errors.push({ field: key, code: 'format', message: label + ': enter a distance such as 25 or 12.5 (up to two decimals).' });
      else errors.push({ field: key, code: 'range', message: label + ' must be between 0 and ' + LIMITS.distance.toLocaleString('en-US') + '.' });
    }
    if (!['mi', 'km'].includes(unit)) errors.push({ field: 'unit', code: isBlank(unit) ? 'required' : 'format', message: 'Choose miles or kilometers.' });
    if (errors.length) return { valid: false, errors };
    const factor = unit === 'km' ? MILES_TO_KM : 1;
    const totalMiles = values.totalDistance / factor;
    const includedMiles = values.includedDistance / factor;
    const billableMiles = Math.max(0, totalMiles - includedMiles);
    const rawMileage = billableMiles * cents.perDistance;
    const mileageCents = Math.round(rawMileage);
    const feesKnown = cents.fees !== null;
    return {
      valid: true, errors: [], unit, totalMiles, includedMiles, billableMiles, baseCents: cents.base, rateCents: cents.perDistance,
      mileageCents, mileageRounded: Math.abs(rawMileage - mileageCents) > 1e-9,
      feesKnown, feesCents: cents.fees, totalIsPartial: !feesKnown,
      totalCents: cents.base + mileageCents + (feesKnown ? cents.fees : 0)
    };
  }

  /* Two readings. Cash: money out of pocket now. Economic: net cost over the horizon.
     The economic reading is NOT discounted for interest, financing, taxes on the sale or risk. */
  function repairOrReplace(input) {
    const source = input && typeof input === 'object' ? input : {};
    const fields = [
      ['saleValueNow', 'Sale value now (as-is)'], ['repairNow', 'Repair needed now'],
      ['keepFuture', 'Other expected keep costs'], ['keepResidual', 'Expected keep-path residual value'],
      ['replacementPrice', 'Replacement vehicle price'], ['acquisitionFees', 'Taxes and acquisition fees'],
      ['replaceFuture', 'Expected replacement costs'], ['replaceResidual', 'Expected replacement residual value']
    ];
    const cashKeys = ['repairNow', 'replacementPrice', 'acquisitionFees', 'saleValueNow'];
    const values = {};
    const errors = [];
    const missing = [];
    let horizonMonths = null;
    if (isBlank(source.horizonMonths)) missing.push('horizonMonths');
    else {
      const n = number(source.horizonMonths);
      if (n === null || !Number.isInteger(n)) errors.push({ field: 'horizonMonths', code: 'format', message: 'Horizon: enter a whole number of months from 1 to ' + LIMITS.months + '.' });
      else if (n < 1 || n > LIMITS.months) errors.push({ field: 'horizonMonths', code: 'range', message: 'Horizon must be from 1 to ' + LIMITS.months + ' months.' });
      else horizonMonths = n;
    }
    for (const [key, label] of fields) {
      const parsed = parseMoneyField(source[key]);
      if (parsed.status === 'ok') values[key] = parsed.cents;
      else if (parsed.status === 'blank') missing.push(key);
      else errors.push(moneyFieldError(key, label, parsed.status));
    }
    const cashValid = cashKeys.every(key => key in values);
    const economicValid = horizonMonths !== null && fields.every(([key]) => key in values);
    const result = {
      valid: cashValid || economicValid, errors, missing, horizonMonths, cashValid, economicValid,
      repairCashCents: null, replaceCashCents: null, keepCostCents: null, replaceCostCents: null, lowerPath: null, differenceCents: null
    };
    if (cashValid) {
      result.repairCashCents = values.repairNow;
      result.replaceCashCents = values.replacementPrice + values.acquisitionFees - values.saleValueNow;
    }
    if (economicValid) {
      const keep = values.saleValueNow + values.repairNow + values.keepFuture - values.keepResidual;
      const replace = values.replacementPrice + values.acquisitionFees + values.replaceFuture - values.replaceResidual;
      result.keepCostCents = keep;
      result.replaceCostCents = replace;
      result.lowerPath = keep === replace ? 'tie' : keep < replace ? 'keep' : 'replace';
      result.differenceCents = Math.abs(keep - replace);
    }
    return result;
  }

  function maintenancePlan(input) {
    const source = input && typeof input === 'object' ? input : {};
    const errors = [];
    let months = null;
    if (isBlank(source.months)) errors.push({ field: 'months', code: 'required', message: 'Planning horizon is required.' });
    else {
      const n = number(source.months);
      if (n === null || !Number.isInteger(n)) errors.push({ field: 'months', code: 'format', message: 'Planning horizon: enter a whole number of months from 1 to ' + LIMITS.months + '.' });
      else if (n < 1 || n > LIMITS.months) errors.push({ field: 'months', code: 'range', message: 'Planning horizon must be from 1 to ' + LIMITS.months + ' months.' });
      else months = n;
    }
    const reserve = parseMoneyField(source.reserveMonthly);
    const reserveKnown = reserve.status === 'ok';
    if (reserve.status === 'format' || reserve.status === 'range') errors.push(moneyFieldError('reserveMonthly', 'Monthly reserve', reserve.status));
    let events = Array.isArray(source.events) ? source.events : [];
    if (!Array.isArray(source.events) && (!isBlank(source.plannedLow) || !isBlank(source.plannedHigh))) {
      events = [{ label: 'Planned services', month: 1, low: source.plannedLow, high: source.plannedHigh }];
    }
    const maxMonth = months ?? LIMITS.months;
    const normalizedEvents = [];
    let rowErrors = 0;
    let filledRows = 0;
    events.forEach((raw, index) => {
      const event = raw && typeof raw === 'object' ? raw : {};
      if (['label', 'month', 'low', 'high'].every(part => isBlank(event[part]))) return;
      filledRows++;
      const name = 'Service ' + (index + 1);
      const rowStart = errors.length;
      const push = (part, code, message) => errors.push({ field: 'event-' + index + '-' + part, code, message: name + ': ' + message });
      let month = null;
      if (isBlank(event.month)) push('month', 'required', 'month is required.');
      else {
        const n = number(event.month);
        if (n === null || !Number.isInteger(n)) push('month', 'format', 'enter a whole month number from 1 to ' + maxMonth + '.');
        else if (n < 1 || n > maxMonth) push('month', 'range', 'month must fall inside the planning horizon (1 to ' + maxMonth + ').');
        else month = n;
      }
      const low = parseMoneyField(event.low);
      if (low.status === 'blank') push('low', 'required', 'cost is required.');
      else if (low.status === 'format') push('low', 'format', 'enter a dollar amount such as 85 or 85.50.');
      else if (low.status === 'range') push('low', 'range', 'cost must be between $0 and ' + money(LIMITS.money) + '.');
      const high = parseMoneyField(event.high);
      if (high.status === 'format') push('high', 'format', 'enter an upper dollar amount such as 85 or 85.50.');
      else if (high.status === 'range') push('high', 'range', 'upper cost must be between $0 and ' + money(LIMITS.money) + '.');
      else if (high.status === 'ok' && low.status === 'ok' && high.cents < low.cents) push('high', 'range', 'the upper cost must be at least the lower cost.');
      if (errors.length > rowStart) { rowErrors++; return; }
      const highCents = high.status === 'ok' ? high.cents : low.cents;
      normalizedEvents.push({
        index, label: String(event.label ?? '').trim().slice(0, 120) || name, month,
        mode: highCents === low.cents ? 'fixed' : 'range', lowCents: low.cents, highCents
      });
    });
    if (filledRows > 24) errors.push({ field: 'events', code: 'range', message: 'Plan at most 24 services.' });
    if (!normalizedEvents.length && !reserveKnown && !rowErrors && reserve.status === 'blank') {
      errors.push({ field: 'events', code: 'empty', message: 'Add at least one planned service or a monthly reserve.' });
    }
    if (errors.length) return { valid: false, errors };
    normalizedEvents.sort((x, y) => x.month - y.month || x.index - y.index);
    const plannedLowCents = normalizedEvents.reduce((sum, item) => sum + item.lowCents, 0);
    const plannedHighCents = normalizedEvents.reduce((sum, item) => sum + item.highCents, 0);
    const reserveTotalCents = reserveKnown ? reserve.cents * months : null;
    const totalLowCents = plannedLowCents + (reserveTotalCents ?? 0);
    const totalHighCents = plannedHighCents + (reserveTotalCents ?? 0);
    return {
      valid: true, errors: [], months, events: normalizedEvents, plannedLowCents, plannedHighCents,
      reserveKnown, reserveMonthlyCents: reserve.cents, reserveTotalCents, totalLowCents, totalHighCents, totalIsPartial: !reserveKnown,
      monthlyLowCents: Math.round(totalLowCents / months), monthlyHighCents: Math.round(totalHighCents / months),
      monthlyRounded: totalLowCents % months !== 0 || totalHighCents % months !== 0
    };
  }

  /* Compatibility calculator retained for old saved worksheets and migration tests. */
  function estimate(input) {
    if (!input || typeof input !== 'object') return { valid: false, errors: [{ field: '', message: 'Enter your assumptions first.' }] };
    if (input.kind === 'towing') {
      const lowModel = towingEstimate({ base: input.partsLow, includedDistance: 0, totalDistance: input.distance, perDistance: input.hoursLow, fees: input.fees, unit: input.unit });
      const highModel = towingEstimate({ base: input.partsHigh, includedDistance: 0, totalDistance: input.distance, perDistance: input.hoursHigh, fees: input.fees, unit: input.unit });
      if (!lowModel.valid) return lowModel;
      if (!highModel.valid) return highModel;
      return {
        valid: true, errors: [], low: fromCents(lowModel.totalCents), high: fromCents(highModel.totalCents),
        rawLow: fromCents(lowModel.totalCents), rawHigh: fromCents(highModel.totalCents),
        partsLow: number(input.partsLow), partsHigh: number(input.partsHigh), laborLow: fromCents(lowModel.mileageCents),
        laborHigh: fromCents(highModel.mileageCents), fees: number(input.fees), rounding: 0
      };
    }
    const keys = ['partsLow', 'partsHigh', 'hoursLow', 'hoursHigh', 'rate', 'fees'];
    const values = {};
    const errors = [];
    keys.forEach(key => {
      const n = number(input[key]);
      if (n === null || n < 0) errors.push({ field: key, message: 'Enter a valid non-negative number.' });
      else values[key] = n;
    });
    if (values.partsLow > values.partsHigh) errors.push({ field: 'partsHigh', message: 'The maximum must be at least the minimum.' });
    if (values.hoursLow > values.hoursHigh) errors.push({ field: 'hoursHigh', message: 'The maximum must be at least the minimum.' });
    if (errors.length) return { valid: false, errors };
    const lowCents = toCents(values.partsLow) + Math.round(values.hoursLow * toCents(values.rate, { maximum: LIMITS.rate })) + toCents(values.fees);
    const highCents = toCents(values.partsHigh) + Math.round(values.hoursHigh * toCents(values.rate, { maximum: LIMITS.rate })) + toCents(values.fees);
    const low = fromCents(lowCents);
    const high = fromCents(highCents);
    const laborLow = values.hoursLow * values.rate;
    const laborHigh = values.hoursHigh * values.rate;
    const midpoint = (low + high) / 2;
    return {
      valid: true, errors: [], low, high, rawLow: low, rawHigh: high,
      partsLow: values.partsLow, partsHigh: values.partsHigh, laborLow, laborHigh, fees: values.fees,
      partsShare: midpoint ? ((values.partsLow + values.partsHigh) / 2) / midpoint : 0,
      laborShare: midpoint ? ((laborLow + laborHigh) / 2) / midpoint : 0,
      feesShare: midpoint ? values.fees / midpoint : 0, basis: 'legacy-user-assumptions', rounding: 0
    };
  }

  function compare(quote, result, sameScope) {
    const amountCents = toCents(quote);
    if (!result || !result.valid) return { valid: false, message: 'Complete a valid scenario before comparing.' };
    if (amountCents === null) return { valid: false, message: 'Enter a valid quote amount.' };
    if (!sameScope) return { valid: false, message: 'Confirm that the quote covers the same work and exclusions.' };
    const lowCents = Math.round(result.rawLow * 100);
    const highCents = Math.round(result.rawHigh * 100);
    const status = amountCents < lowCents ? 'below' : amountCents > highCents ? 'above' : 'within';
    return {
      valid: true, status, amount: fromCents(amountCents),
      difference: fromCents(status === 'below' ? lowCents - amountCents : status === 'above' ? amountCents - highCents : 0),
      label: status[0].toUpperCase() + status.slice(1) + ' your scenario range'
    };
  }

  function convertDistance(value, from, to) {
    const n = number(value);
    if (n === null || n < 0 || !['mi', 'km'].includes(from) || !['mi', 'km'].includes(to)) return null;
    return from === to ? n : from === 'mi' ? n * MILES_TO_KM : n / MILES_TO_KM;
  }

  return Object.freeze({
    number, moneyNumber, toCents, fromCents, money, range, normalizeMoneyValue, calculateQuote,
    compareQuotes, towingEstimate, repairOrReplace, maintenancePlan, estimate, compare, convertDistance, LIMITS, MILES_TO_KM
  });
});

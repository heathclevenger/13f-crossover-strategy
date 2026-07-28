const state = { data: null, activeDaily: [], filtered: [], chart: null, chartSelection: null };
const $ = (id) => document.getElementById(id);
const pct = (value, digits = 1) => value == null || !Number.isFinite(value) ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
const metricClass = (value) => value >= 0 ? "positive" : "negative";
const money = (value) => value == null || !Number.isFinite(value) ? "—" : new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0
}).format(value);
const signedMoney = (value) => value == null || !Number.isFinite(value) ? "—"
  : `${value > 0 ? "+" : value < 0 ? "−" : ""}${money(Math.abs(value))}`;

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab,.tab-panel").forEach((node) => node.classList.remove("active"));
    button.classList.add("active");
    $(button.dataset.tab).classList.add("active");
    if (button.dataset.tab === "backtest") requestAnimationFrame(updateBacktest);
    if (button.dataset.tab === "holdings" || button.dataset.tab === "backtest") renderHoldingsHistory();
  });
});

function dailyReturns(rows, key) {
  return rows.slice(1).map((row, i) => row[key] / rows[i][key] - 1).filter(Number.isFinite);
}
function totalReturn(rows, key) {
  if (rows.length < 2) return null;
  return (rows.at(-1)[key] / rows[0][key] - 1) * 100;
}
function maxDrawdown(rows, key) {
  let peak = -Infinity, worst = 0;
  rows.forEach((row) => { peak = Math.max(peak, row[key]); worst = Math.min(worst, row[key] / peak - 1); });
  return worst * 100;
}
function volatility(rows, key) {
  const returns = dailyReturns(rows, key);
  if (returns.length < 2) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}
function setMetric(id, value) {
  const el = $(id); el.textContent = pct(value); el.className = metricClass(value || 0);
}

function displayDate(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric"
  });
}

function nextSignalDate(latestQuarter) {
  const match = latestQuarter.match(/(\d{4}) Q([1-4])/);
  if (!match) return null;
  let year = Number(match[1]), quarter = Number(match[2]) + 1;
  if (quarter === 5) { quarter = 1; year += 1; }
  const quarterEnd = new Date(Date.UTC(year, quarter * 3, 0));
  quarterEnd.setUTCDate(quarterEnd.getUTCDate() + 50);
  return quarterEnd.toISOString().slice(0, 10);
}

function renderBuyList(list) {
  const quarterLabel = `${list.year} Q${list.quarter}`;
  $("lastListUpdate").textContent = displayDate(list.effectiveDate);
  $("lastListQuarter").textContent = `${quarterLabel} · 50-day filing delay`;
  $("nextListUpdate").textContent = displayDate(nextSignalDate(quarterLabel));
  $("positionCount").textContent = list.positions.length;
  $("targetWeight").textContent = `${(100 / list.positions.length).toFixed(1)}%`;
  $("buyListTitle").textContent = `${quarterLabel} crossover`;
  $("buyListBody").innerHTML = list.positions.map((row, i) => `
    <tr><td>${i + 1}</td><td class="ticker">${row.symbol}</td><td>${row.issuer}</td>
    <td><span class="rank-chip">${row.holderRank}</span></td><td><span class="rank-chip">${row.valueRank}</span></td>
    <td>${row.targetWeight.toFixed(1)}%</td></tr>`).join("");
}

function renderSelectedBuyList() {
  const year = Number($("buyListYear").value);
  const quarter = Number($("buyListQuarter").value);
  const list = state.data.buyLists.find((item) => item.year === year && item.quarter === quarter);
  if (list) renderBuyList(list);
}

function populateQuarterOptions() {
  const year = Number($("buyListYear").value);
  const quarters = state.data.buyLists
    .filter((item) => item.year === year)
    .map((item) => item.quarter)
    .sort((a, b) => b - a);
  $("buyListQuarter").innerHTML = quarters.map((quarter) => `<option value="${quarter}">Q${quarter}</option>`).join("");
  renderSelectedBuyList();
}

function renderCurrent() {
  const { metadata, buyLists } = state.data;
  $("asOfLabel").textContent = `Data through ${metadata.asOf}`;
  const years = [...new Set(buyLists.map((item) => item.year))].sort((a, b) => b - a);
  $("buyListYear").innerHTML = years.map((year) => `<option value="${year}">${year}</option>`).join("");
  $("buyListYear").addEventListener("change", populateQuarterOptions);
  $("buyListQuarter").addEventListener("change", renderSelectedBuyList);
  populateQuarterOptions();
}

function normalizedRows(rows) {
  if (!rows.length) return [];
  const s0 = rows[0].strategy, p0 = rows[0].spy;
  return rows.map((row) => ({ ...row, strategyNorm: row.strategy / s0 * 100, spyNorm: row.spy / p0 * 100 }));
}

function drawChart(rows) {
  const canvas = $("performanceChart");
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * ratio; canvas.height = rect.height * ratio;
  const ctx = canvas.getContext("2d"); ctx.scale(ratio, ratio);
  const w = rect.width, h = rect.height, pad = { l: 48, r: 16, t: 16, b: 30 };
  ctx.clearRect(0, 0, w, h);
  if (rows.length < 2) return;
  const values = rows.flatMap((r) => [r.strategyNorm, r.spyNorm]);
  let min = Math.min(...values), max = Math.max(...values);
  const margin = (max - min || 10) * .1; min -= margin; max += margin;
  ctx.strokeStyle = "rgba(64,88,107,.2)"; ctx.fillStyle = "rgba(64,88,107,.72)"; ctx.font = "11px system-ui";
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (h - pad.t - pad.b) * i / 4;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    const val = max - (max - min) * i / 4; ctx.fillText(`${(val - 100).toFixed(0)}%`, 4, y + 4);
  }
  const x = (i) => pad.l + (w - pad.l - pad.r) * i / (rows.length - 1);
  const y = (v) => pad.t + (h - pad.t - pad.b) * (max - v) / (max - min);
  const years = [];
  rows.forEach((row, index) => {
    const year = Number(row.date.slice(0, 4));
    if (!years.length || years.at(-1).year !== year) years.push({ year, index });
  });
  const yearStep = years.length <= 12 ? 1 : years.length <= 22 ? 2 : 5;
  years.forEach(({ year, index }) => {
    const px = x(index);
    ctx.beginPath(); ctx.strokeStyle = "rgba(64,88,107,.18)";
    ctx.moveTo(px, pad.t); ctx.lineTo(px, h - pad.b); ctx.stroke();
    if ((year - years[0].year) % yearStep === 0) {
      ctx.save(); ctx.translate(px + 3, h - 8); ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = "rgba(64,88,107,.72)"; ctx.font = "10px system-ui"; ctx.fillText(String(year), 0, 0); ctx.restore();
    }
  });
  [["strategyNorm", "#40586b", 3], ["spyNorm", "#c58b5e", 2]].forEach(([key, color, width]) => {
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = width;
    rows.forEach((row, i) => i ? ctx.lineTo(x(i), y(row[key])) : ctx.moveTo(x(i), y(row[key])));
    ctx.stroke();
  });
  if (state.chartSelection) {
    const selectedIndex = rows.findIndex((row) => row.date === state.chartSelection.date);
    if (selectedIndex >= 0) {
      const key = state.chartSelection.key;
      const color = key === "strategyNorm" ? "#40586b" : "#c58b5e";
      ctx.beginPath();
      ctx.arc(x(selectedIndex), y(rows[selectedIndex][key]), 6, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#f5f1e8";
      ctx.stroke();
    }
  }
  state.chart = { rows, pad, width: w, height: h, x, y };
}

function quarterRows(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const d = new Date(row.date + "T00:00:00");
    const key = `${d.getFullYear()} Q${Math.floor(d.getMonth() / 3) + 1}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return [...groups.entries()].map(([quarter, qRows]) => ({
    quarter, strategy: totalReturn(qRows, "strategy"), spy: totalReturn(qRows, "spy"),
    standardDeviation: volatility(qRows, "strategy"),
    spyStandardDeviation: volatility(qRows, "spy"),
    maximumDrawdown: maxDrawdown(qRows, "strategy"),
    spyMaximumDrawdown: maxDrawdown(qRows, "spy"),
  }));
}

function updateBacktest() {
  if (!state.data) return;
  state.chartSelection = null;
  $("chartTooltip").hidden = true;
  const start = $("startDate").value, end = $("endDate").value;
  const raw = state.activeDaily.filter((row) => row.date >= start && row.date <= end);
  const rows = normalizedRows(raw); state.filtered = rows;
  const sr = totalReturn(rows, "strategyNorm"), pr = totalReturn(rows, "spyNorm");
  setMetric("strategyReturn", sr);
  $("spyReturn").textContent = `SPY ${pct(pr)}`;
  setMetric("strategyDrawdown", maxDrawdown(rows, "strategyNorm"));
  $("spyDrawdown").textContent = `SPY ${pct(maxDrawdown(rows, "spyNorm"))}`;
  setMetric("strategyVolatility", volatility(rows, "strategyNorm"));
  $("spyVolatility").textContent = `SPY ${pct(volatility(rows, "spyNorm"))}`;
  setMetric("excessReturn", sr - pr);
  drawChart(rows);
  const quarters = quarterRows(rows);
  $("quarterCount").textContent = `${quarters.length} quarters`;
  $("quarterTableBody").innerHTML = quarters.slice().reverse().map((q) => `
    <tr><td><strong>${q.quarter}</strong></td><td class="${metricClass(q.strategy)}">${pct(q.strategy)}</td>
    <td class="${metricClass(q.spy)}">${pct(q.spy)}</td><td class="${metricClass(q.strategy-q.spy)}">${pct(q.strategy-q.spy)}</td>
    <td><div class="metric-pair"><span>Strategy ${pct(q.standardDeviation)}</span><small>S&amp;P ${pct(q.spyStandardDeviation)}</small></div></td>
    <td><div class="metric-pair"><span class="${metricClass(q.maximumDrawdown)}">Strategy ${pct(q.maximumDrawdown)}</span><small class="${metricClass(q.spyMaximumDrawdown)}">S&amp;P ${pct(q.spyMaximumDrawdown)}</small></div></td></tr>`).join("");
}

function summaryPeriod(rows, prefix) {
  const strategy = totalReturn(rows, "strategy");
  const spy = totalReturn(rows, "spy");
  const excess = strategy - spy;
  const drawdown = maxDrawdown(rows, "strategy");
  const spyDrawdown = maxDrawdown(rows, "spy");
  const stdDev = volatility(rows, "strategy");
  const spyStdDev = volatility(rows, "spy");
  $(`${prefix}Strategy`).textContent = pct(strategy);
  $(`${prefix}Spy`).textContent = pct(spy);
  const excessElement = $(`${prefix}Excess`);
  excessElement.textContent = pct(excess);
  excessElement.className = metricClass(excess || 0);
  $(`${prefix}StdDev`).textContent = `Strategy ${pct(stdDev)}`;
  $(`${prefix}SpyStdDev`).textContent = `S&P 500 ${pct(spyStdDev)}`;
  $(`${prefix}Drawdown`).textContent = `Strategy ${pct(drawdown)}`;
  $(`${prefix}SpyDrawdown`).textContent = `S&P 500 ${pct(spyDrawdown)}`;
}

function renderSummary() {
  const daily = state.data.scenarios?.noTax_4_4 || state.data.daily;
  const latestDate = new Date(`${daily.at(-1).date}T00:00:00Z`);
  const oneYearStart = new Date(latestDate);
  oneYearStart.setUTCFullYear(oneYearStart.getUTCFullYear() - 1);
  const oneYearStartDate = oneYearStart.toISOString().slice(0, 10);
  summaryPeriod(daily.filter((row) => row.date >= "2005-01-01"), "summary2000");
  summaryPeriod(daily.filter((row) => row.date >= "2010-01-01"), "summary2010");
  summaryPeriod(daily.filter((row) => row.date >= "2020-01-01"), "summary2020");
  summaryPeriod(daily.filter((row) => row.date >= oneYearStartDate), "summary1Year");
}

function scenarioKey() {
  return `${$("taxSetting").value}_${$("investmentFrequency").value}_${$("signalFrequency").value}`;
}

function investmentScale() {
  const amount = Number($("investmentAmount").value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount / 100000 : 1;
}

function capitalGainsTax(shortAmount, longAmount, shortRate, longRate) {
  let shortNet = shortAmount;
  let longNet = longAmount;
  if (shortNet < 0 && longNet > 0) {
    const offset = Math.min(-shortNet, longNet);
    shortNet += offset;
    longNet -= offset;
  } else if (longNet < 0 && shortNet > 0) {
    const offset = Math.min(-longNet, shortNet);
    longNet += offset;
    shortNet -= offset;
  }
  return {
    shortNet,
    longNet,
    taxableShort: Math.max(shortNet, 0),
    taxableLong: Math.max(longNet, 0),
    tax: Math.max(shortNet, 0) * shortRate + Math.max(longNet, 0) * longRate,
  };
}

function firstMarketDateOnOrAfter(value) {
  const prices = state.data.marketPrices?.SPY || [];
  let low = 0, high = prices.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (prices[mid][0] < value) low = mid + 1;
    else high = mid;
  }
  return prices[low]?.[0] || null;
}

function lastMarketDateOnOrBefore(value) {
  const prices = state.data.marketPrices?.SPY || [];
  let low = 0, high = prices.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (prices[mid][0] <= value) low = mid + 1;
    else high = mid;
  }
  return prices[low - 1]?.[0] || null;
}

function marketPrice(symbol, value) {
  const prices = state.data.marketPrices?.[symbol] || [];
  let low = 0, high = prices.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (prices[mid][0] <= value) low = mid + 1;
    else high = mid;
  }
  return prices[low - 1]?.[1] ?? null;
}

function daysBetween(start, end) {
  return Math.round((
    new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)
  ) / 86400000);
}

function allocateUnderweight(symbols, lots, cash, tradingDate) {
  const available = symbols.filter((symbol) => {
    const price = marketPrice(symbol, tradingDate);
    return price != null && price > 0;
  });
  if (!available.length || cash <= 0) return;
  const values = Object.fromEntries(available.map((symbol) => [
    symbol,
    lots.filter((lot) => lot.symbol === symbol)
      .reduce((sum, lot) => sum + lot.units * marketPrice(symbol, tradingDate), 0),
  ]));
  const ordered = available.map((symbol) => [values[symbol], symbol])
    .sort((a, b) => a[0] - b[0]);
  let level = ordered[0][0], remaining = cash, groupSize = 1;
  for (let index = 1; index < ordered.length; index += 1) {
    const nextLevel = ordered[index][0];
    const cost = (nextLevel - level) * groupSize;
    if (remaining < cost) {
      level += remaining / groupSize;
      remaining = 0;
      break;
    }
    remaining -= cost;
    level = nextLevel;
    groupSize += 1;
  }
  if (remaining > 0) level += remaining / ordered.length;
  ordered.forEach(([value, symbol]) => {
    const allocation = Math.max(level - value, 0);
    if (allocation > 1e-8) {
      const price = marketPrice(symbol, tradingDate);
      lots.push({ symbol, units: allocation / price, purchased: tradingDate, purchasePrice: price });
    }
  });
}

function exactTaxSimulation(startDate, endDate, taxMode, investmentsPerYear, updatesPerYear, amount, shortRate, longRate) {
  const start = firstMarketDateOnOrAfter(startDate);
  const end = lastMarketDateOnOrBefore(endDate);
  if (!start || !end || start > end) return null;
  const allSignals = state.data.buyLists.map((signal) => ({
    ...signal,
    tradingDate: firstMarketDateOnOrAfter(signal.effectiveDate),
  })).filter((signal) => signal.tradingDate && signal.tradingDate <= end);
  const updateEligible = (signal) => updatesPerYear === 4
    || (updatesPerYear === 2 && [2, 4].includes(signal.quarter))
    || (updatesPerYear === 1 && signal.quarter === 4);
  const startingSignal = allSignals.filter((signal) => updateEligible(signal) && signal.tradingDate <= start).at(-1);
  if (!startingSignal) return null;
  const events = new Map();
  allSignals.filter((signal) => signal.tradingDate > start).forEach((signal) => {
    const event = events.get(signal.tradingDate) || {};
    event.review = true;
    if (investmentsPerYear === 4) event.contribution = true;
    if (updateEligible(signal)) event.signal = signal;
    events.set(signal.tradingDate, event);
  });
  if (investmentsPerYear === 52) {
    const weekKey = (value) => {
      const day = new Date(`${value}T00:00:00Z`);
      day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
      return day.toISOString().slice(0, 10);
    };
    const startingWeek = weekKey(start);
    const seenWeeks = new Set([startingWeek]);
    (state.data.marketPrices?.SPY || []).forEach(([tradingDate]) => {
      if (tradingDate <= start || tradingDate > end) return;
      const week = weekKey(tradingDate);
      if (seenWeeks.has(week)) return;
      seenWeeks.add(week);
      const event = events.get(tradingDate) || {};
      event.contribution = true;
      events.set(tradingDate, event);
    });
  }
  const lots = [];
  let activeSymbols = startingSignal.positions.map((row) => row.symbol);
  let basis = amount;
  let realizedShort = 0, realizedLong = 0;
  const annualRealized = {};
  const yearly = [];
  allocateUnderweight(activeSymbols, lots, amount, start);

  const recordSale = (lot, units, price, tradingDate) => {
    const gain = units * (price - lot.purchasePrice);
    const year = tradingDate.slice(0, 4);
    if (!annualRealized[year]) annualRealized[year] = { short: 0, long: 0 };
    if (daysBetween(lot.purchased, tradingDate) >= 366) {
      realizedLong += gain;
      annualRealized[year].long += gain;
    } else {
      realizedShort += gain;
      annualRealized[year].short += gain;
    }
    return units * price;
  };

  const captureYear = (year) => {
    const requestedEnd = year === Number(end.slice(0, 4)) ? end : `${year}-12-31`;
    const snapshotDate = lastMarketDateOnOrBefore(requestedEnd);
    if (!snapshotDate || snapshotDate < start) return;
    let unrealized = 0;
    lots.forEach((lot) => {
      const price = marketPrice(lot.symbol, snapshotDate);
      if (price != null) unrealized += lot.units * (price - lot.purchasePrice);
    });
    const realized = annualRealized[String(year)] || { short: 0, long: 0 };
    yearly.push({
      year,
      date: snapshotDate,
      strategyRealized: realized.short + realized.long,
      strategyUnrealized: unrealized,
    });
  };

  const eventEntries = [...events.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  let nextSnapshotYear = Number(start.slice(0, 4));
  eventEntries.forEach(([tradingDate, event]) => {
    const eventYear = Number(tradingDate.slice(0, 4));
    while (nextSnapshotYear < eventYear) {
      captureYear(nextSnapshotYear);
      nextSnapshotYear += 1;
    }
    let proceeds = 0;
    if (event.review) {
      if (event.signal) activeSymbols = event.signal.positions.map((row) => row.symbol);
      const current = new Set(activeSymbols);
      const portfolioValue = lots.reduce((sum, lot) => {
        const price = marketPrice(lot.symbol, tradingDate);
        return sum + (price == null ? 0 : lot.units * price);
      }, 0);
      const target = activeSymbols.length ? portfolioValue / activeSymbols.length : 0;
      const excess = Object.fromEntries(activeSymbols.map((symbol) => [
        symbol,
        Math.max(lots.filter((lot) => lot.symbol === symbol).reduce((sum, lot) => {
          const price = marketPrice(symbol, tradingDate);
          return sum + (price == null ? 0 : lot.units * price);
        }, 0) - target, 0),
      ]));
      const retained = [];
      lots.forEach((lot) => {
        const price = marketPrice(lot.symbol, tradingDate);
        const removed = !current.has(lot.symbol);
        const sellAllowed = taxMode === "noTax"
          || (taxMode === "strategyTax" && daysBetween(lot.purchased, tradingDate) >= 366)
          || (taxMode === "noRealizedGains" && price != null && price <= lot.purchasePrice);
        if (removed && sellAllowed && price != null) {
          proceeds += recordSale(lot, lot.units, price, tradingDate);
        } else if (["strategyTax", "noTax"].includes(taxMode)
          && !removed && sellAllowed && price != null && excess[lot.symbol] > 1e-8) {
          const saleValue = Math.min(lot.units * price, excess[lot.symbol]);
          const soldUnits = saleValue / price;
          proceeds += recordSale(lot, soldUnits, price, tradingDate);
          excess[lot.symbol] -= saleValue;
          if (lot.units - soldUnits > 1e-10) retained.push({ ...lot, units: lot.units - soldUnits });
        } else {
          retained.push(lot);
        }
      });
      lots.splice(0, lots.length, ...retained);
    }
    let contribution = 0;
    if (event.contribution) {
      contribution = amount;
      basis += amount;
    }
    allocateUnderweight(activeSymbols, lots, contribution + proceeds, tradingDate);
  });
  while (nextSnapshotYear <= Number(end.slice(0, 4))) {
    captureYear(nextSnapshotYear);
    nextSnapshotYear += 1;
  }

  let endingValue = 0, unrealizedShort = 0, unrealizedLong = 0;
  lots.forEach((lot) => {
    const price = marketPrice(lot.symbol, end);
    if (price == null) return;
    const value = lot.units * price;
    const gain = value - lot.units * lot.purchasePrice;
    endingValue += value;
    if (daysBetween(lot.purchased, end) >= 366) unrealizedLong += gain;
    else unrealizedShort += gain;
  });
  const realizedTax = capitalGainsTax(realizedShort, realizedLong, shortRate, longRate).tax;
  const totalTax = capitalGainsTax(
    realizedShort + unrealizedShort,
    realizedLong + unrealizedLong,
    shortRate,
    longRate
  ).tax;

  const spyLots = [{ purchased: start, units: amount / marketPrice("SPY", start), purchasePrice: marketPrice("SPY", start) }];
  eventEntries.forEach(([tradingDate, event]) => {
    if (event.contribution) {
      const price = marketPrice("SPY", tradingDate);
      spyLots.push({ purchased: tradingDate, units: amount / price, purchasePrice: price });
    }
  });
  let spyEndingValue = 0, spyShort = 0, spyLong = 0;
  spyLots.forEach((lot) => {
    const price = marketPrice("SPY", end);
    const value = lot.units * price;
    const gain = value - lot.units * lot.purchasePrice;
    spyEndingValue += value;
    if (daysBetween(lot.purchased, end) >= 366) spyLong += gain;
    else spyShort += gain;
  });
  const spyTax = capitalGainsTax(spyShort, spyLong, shortRate, longRate).tax;
  yearly.forEach((row) => {
    const endPrice = marketPrice("SPY", row.date);
    row.spyRealized = 0;
    row.spyUnrealized = spyLots
      .filter((lot) => lot.purchased <= row.date)
      .reduce((sum, lot) => sum + lot.units * (endPrice - lot.purchasePrice), 0);
  });
  return {
    basis, endingValue, realizedShort, realizedLong, unrealizedShort, unrealizedLong,
    realizedTax, totalTax, liquidationTax: totalTax - realizedTax,
    spyEndingValue, spyShort, spyLong, spyTax, yearly,
  };
}

function formatInvestmentAmount() {
  const input = $("investmentAmount");
  const amount = Number(input.value.replace(/[^0-9.]/g, ""));
  input.value = Number.isFinite(amount) && amount > 0
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount)
    : "25,000";
  renderHoldingsHistory();
}

function activePortfolioHistory() {
  return state.data.portfolioHistory?.[scenarioKey()] || [];
}

function configureHoldingsDates() {
  const history = activePortfolioHistory();
  if (!history.length) return;
  const first = history[0].date;
  const last = history.at(-1).date;
  const start = $("holdingsStartDate");
  const end = $("holdingsEndDate");
  start.min = end.min = first;
  start.max = end.max = last;
  if (!start.value || start.value < first || start.value > last) {
    const desired = $("startDate").value || first;
    start.value = desired < first ? first : desired > last ? last : desired;
  }
  if (!end.value || end.value < first || end.value > last) {
    const desired = $("endDate").value || last;
    end.value = desired < first ? first : desired > last ? last : desired;
  }
  if (start.value > end.value) start.value = end.value;
  const input = $("holdingsDate");
  input.min = start.value;
  input.max = end.value;
  if (!input.value || input.value < input.min || input.value > input.max) input.value = input.max;
}

function renderHoldingsHistory() {
  const history = activePortfolioHistory();
  if (!history.length) return;
  configureHoldingsDates();
  const portfolioSnapshot = history.filter((row) => row.date <= $("holdingsDate").value).at(-1) || history[0];
  $("historyTitle").textContent = `Portfolio on ${displayDate(portfolioSnapshot.date)}`;
  $("historyPositionCount").textContent = `${portfolioSnapshot.holdings.length} positions`;
  $("holdingsHistoryBody").innerHTML = portfolioSnapshot.holdings.map((row, index) => `
    <tr><td>${index + 1}</td><td class="ticker">${row.symbol}</td><td>${row.weight.toFixed(1)}%</td></tr>`).join("");
  const shortRate = Math.min(100, Math.max(0, Number($("shortTermTaxRate").value) || 0)) / 100;
  const longRate = Math.min(100, Math.max(0, Number($("longTermTaxRate").value) || 0)) / 100;
  const amount = investmentScale() * 100000;
  const exact = exactTaxSimulation(
    $("holdingsStartDate").value,
    $("holdingsEndDate").value,
    $("taxSetting").value,
    Number($("investmentFrequency").value),
    Number($("signalFrequency").value),
    amount,
    shortRate,
    longRate
  );
  if (!exact) return;
  const basis = Math.max(exact.basis, 1);
  const strategyTaxPaid = exact.totalTax;
  const strategyLiquidationValue = exact.endingValue - exact.totalTax;
  const spyLiquidationTax = exact.spyTax;
  const spyLiquidationValue = exact.spyEndingValue - exact.spyTax;
  const spyUnrealizedPct = (exact.spyShort + exact.spyLong) / basis * 100;
  const unrealizedPct = (exact.unrealizedShort + exact.unrealizedLong) / basis * 100;
  const realizedPct = (exact.realizedShort + exact.realizedLong) / basis * 100;
  const afterTaxReturn = (strategyLiquidationValue / basis - 1) * 100;
  const spyAfterTaxReturn = (spyLiquidationValue / basis - 1) * 100;
  setMetric("taxStrategyTotalReturn", afterTaxReturn);
  $("taxSpyTotalReturn").textContent = `S&P 500 ${pct(spyAfterTaxReturn)}`;
  $("taxStrategyEndingValue").textContent = money(strategyLiquidationValue);
  $("taxSpyEndingValue").textContent = money(spyLiquidationValue);
  $("taxContributedCapital").textContent = money(basis);
  $("taxSpyContributedCapital").textContent = money(basis);
  $("taxEstimatedPaid").textContent = money(strategyTaxPaid);
  $("taxSpyEstimatedPaid").textContent = `S&P 500 ${money(spyLiquidationTax)}`;
  setMetric("taxUnrealizedStrategy", unrealizedPct);
  $("taxUnrealizedSpy").textContent = `S&P 500 ${pct(spyUnrealizedPct)}`;
  setMetric("taxRealizedStrategy", realizedPct);
  setMetric("taxAfterTaxReturn", afterTaxReturn);
  setMetric("taxSpyReturn", spyAfterTaxReturn);

  $("taxYearlyBody").innerHTML = exact.yearly.map((row) => `
    <tr>
      <td class="ticker">${row.year}</td>
      <td class="${row.strategyRealized < 0 ? "tax-loss" : "tax-gain"}">${signedMoney(row.strategyRealized)}</td>
      <td class="${row.strategyUnrealized < 0 ? "tax-loss" : "tax-gain"}">${signedMoney(row.strategyUnrealized)}</td>
      <td>${signedMoney(row.spyRealized)}</td>
      <td class="${row.spyUnrealized < 0 ? "tax-loss" : "tax-gain"}">${signedMoney(row.spyUnrealized)}</td>
    </tr>`).join("");
}

function updateHoldingsRange() {
  if ($("holdingsStartDate").value > $("holdingsEndDate").value) {
    if (document.activeElement === $("holdingsStartDate")) $("holdingsEndDate").value = $("holdingsStartDate").value;
    else $("holdingsStartDate").value = $("holdingsEndDate").value;
  }
  $("startDate").value = $("holdingsStartDate").value;
  $("endDate").value = $("holdingsEndDate").value;
  $("holdingsDate").min = $("holdingsStartDate").value;
  $("holdingsDate").max = $("holdingsEndDate").value;
  if ($("holdingsDate").value < $("holdingsDate").min || $("holdingsDate").value > $("holdingsDate").max) {
    $("holdingsDate").value = $("holdingsDate").max;
  }
  updateBacktest();
  renderHoldingsHistory();
}

function updateBacktestRange() {
  updateBacktest();
  $("holdingsStartDate").value = $("startDate").value;
  $("holdingsEndDate").value = $("endDate").value;
  configureHoldingsDates();
  renderHoldingsHistory();
}

function updateScenario() {
  $("taxSummarySetting").value = $("taxSetting").value;
  state.activeDaily = state.data.scenarios?.[scenarioKey()] || state.data.daily;
  const first = state.activeDaily[0].date, last = state.activeDaily.at(-1).date;
  $("startDate").min = $("endDate").min = first;
  $("startDate").max = $("endDate").max = last;
  if ($("startDate").value < first || $("startDate").value > last) $("startDate").value = first;
  if ($("endDate").value > last || $("endDate").value < first) $("endDate").value = last;
  $("chartTooltip").hidden = true;
  updateBacktest();
  configureHoldingsDates();
  renderHoldingsHistory();
}

function inspectChart(event) {
  if (!state.chart?.rows?.length) return;
  const canvas = $("performanceChart");
  const rect = canvas.getBoundingClientRect();
  const { rows, pad, width } = state.chart;
  const localX = Math.min(width - pad.r, Math.max(pad.l, event.clientX - rect.left));
  const index = Math.round((localX - pad.l) / (width - pad.l - pad.r) * (rows.length - 1));
  const row = rows[index];
  const localY = event.clientY - rect.top;
  const strategyDistance = Math.abs(localY - state.chart.y(row.strategyNorm));
  const spyDistance = Math.abs(localY - state.chart.y(row.spyNorm));
  const selectedKey = strategyDistance <= spyDistance ? "strategyNorm" : "spyNorm";
  state.chartSelection = { date: row.date, key: selectedKey };
  drawChart(rows);
  const strategyGain = row.strategyNorm - 100, spyGain = row.spyNorm - 100;
  const tooltip = $("chartTooltip");
  tooltip.innerHTML = `<strong>${row.date}</strong><span>Strategy ${pct(strategyGain)}</span><br><span>S&amp;P 500 ${pct(spyGain)}</span>`;
  tooltip.style.left = `${localX}px`;
  tooltip.style.top = `${Math.max(70, event.clientY - rect.top)}px`;
  tooltip.hidden = false;
}

async function init() {
  try {
    const response = await fetch("data/strategy.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Dashboard data has not been generated.");
    state.data = await response.json();
    const { daily, metadata } = state.data;
    const integerFormat = new Intl.NumberFormat("en-US");
    $("coveragePositionRecords").textContent = integerFormat.format(metadata.coverage?.positionRecords || 0);
    $("coverageUniqueSymbols").textContent = integerFormat.format(metadata.coverage?.uniqueSymbols || 0);
    state.activeDaily = state.data.scenarios?.strategyTax_4_4 || daily;
    $("startDate").min = $("endDate").min = state.activeDaily[0].date;
    $("startDate").max = $("endDate").max = state.activeDaily.at(-1).date;
    $("startDate").value = metadata.defaultStartDate || state.activeDaily[0].date;
    $("endDate").value = state.activeDaily.at(-1).date;
    $("startDate").addEventListener("change", updateBacktestRange);
    $("endDate").addEventListener("change", updateBacktestRange);
    ["taxSetting", "investmentFrequency", "signalFrequency"].forEach((id) => $(id).addEventListener("change", updateScenario));
    $("taxSummarySetting").addEventListener("change", () => {
      $("taxSetting").value = $("taxSummarySetting").value;
      updateScenario();
    });
    $("investmentAmount").addEventListener("input", renderHoldingsHistory);
    $("investmentAmount").addEventListener("blur", formatInvestmentAmount);
    $("investmentAmount").addEventListener("change", formatInvestmentAmount);
    $("holdingsDate").addEventListener("change", renderHoldingsHistory);
    $("shortTermTaxRate").addEventListener("input", renderHoldingsHistory);
    $("longTermTaxRate").addEventListener("input", renderHoldingsHistory);
    $("holdingsStartDate").addEventListener("change", updateHoldingsRange);
    $("holdingsEndDate").addEventListener("change", updateHoldingsRange);
    $("resetDates").addEventListener("click", () => {
      $("startDate").value = state.activeDaily[0].date > "2005-01-01" ? state.activeDaily[0].date : "2005-01-01";
      $("endDate").value = state.activeDaily.at(-1).date;
      updateBacktestRange();
    });
    $("performanceChart").addEventListener("click", inspectChart);
    window.addEventListener("resize", () => state.filtered.length && drawChart(state.filtered));
    renderCurrent(); updateBacktest(); configureHoldingsDates(); renderHoldingsHistory();
    renderSummary();
    document.querySelectorAll(".info-button").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const opening = !button.classList.contains("open");
        document.querySelectorAll(".info-button.open").forEach((item) => item.classList.remove("open"));
        if (opening) button.classList.add("open");
      });
    });
    document.addEventListener("click", () => {
      document.querySelectorAll(".info-button.open").forEach((item) => item.classList.remove("open"));
    });
    if (metadata.warning) { $("dataWarning").hidden = false; $("dataWarning").textContent = metadata.warning; }
  } catch (error) {
    $("dataWarning").hidden = false;
    $("dataWarning").textContent = `${error.message} Run build_dashboard_data.py, then refresh this page.`;
  }
}
init();

// test_backtest.mjs
// Запуск: node test_backtest.mjs
// Скачивает свечи с Binance и прогоняет бэктест всех стратегий

import https from "https";

// ── Параметры ──────────────────────────────────────────────────────────────
const SYMBOL = "BTCUSDT";
const INTERVAL = "1h";
const LIMIT = 1000; // свечей для теста

// ── Старые пороги ──────────────────────────────────────────────────────────
const OLD = {
  MIN_PROFIT_FACTOR: 1.3,
  MIN_WIN_RATE: 40,
  MIN_TRADES_REQUIRED: 12,
  MAX_DRAWDOWN_ALLOWED: 20,
  MIN_VOLATILITY: 0.18,
};

// ── Новые пороги ───────────────────────────────────────────────────────────
const NEW = {
  MIN_PROFIT_FACTOR: 0.7,
  MIN_WIN_RATE: 45,
  MIN_TRADES_REQUIRED: 10,
  MAX_DRAWDOWN_ALLOWED: 25,
  MIN_VOLATILITY: 0.15,
};

// ── Получить свечи с Binance ───────────────────────────────────────────────
const fetchCandles = () =>
  new Promise((resolve, reject) => {
    const path = `/api/v3/klines?symbol=${SYMBOL}&interval=${INTERVAL}&limit=${LIMIT}`;
    const req = https.get(
      { hostname: "api.binance.com", path, timeout: 15000 },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          const raw = JSON.parse(data);
          const candles = raw.map((k) => ({
            openTime: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5]),
          }));
          resolve(candles);
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("TIMEOUT"));
    });
    req.on("error", reject);
  });

// ── Индикаторы (inline без npm) ────────────────────────────────────────────
const calcEMA = (arr, period) => {
  const k = 2 / (period + 1);
  const result = [];
  let ema = arr[0];
  for (let i = 0; i < arr.length; i++) {
    ema = i === 0 ? arr[0] : arr[i] * k + ema * (1 - k);
    if (i >= period - 1) result.push(ema);
  }
  return result;
};

const calcRSI = (closes, period = 14) => {
  const result = [];
  let gains = 0,
    losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d;
    else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  result.push(100 - 100 / (1 + avgGain / (avgLoss || 0.0001)));
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    result.push(100 - 100 / (1 + avgGain / (avgLoss || 0.0001)));
  }
  return result;
};

const calcATR = (candles, period = 14) => {
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high,
      l = candles[i].low,
      pc = candles[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const result = [];
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(atr);
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
    result.push(atr);
  }
  return result;
};

const calcMACD = (closes) => {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const minLen = Math.min(ema12.length, ema26.length);
  const macdLine = [];
  for (let i = 0; i < minLen; i++)
    macdLine.push(
      ema12[ema12.length - minLen + i] - ema26[ema26.length - minLen + i],
    );
  const signal = calcEMA(macdLine, 9);
  const histogram = macdLine.slice(-signal.length).map((v, i) => v - signal[i]);
  return { histogram };
};

const calcBB = (closes, period = 20) => {
  const result = [];
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(
      slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period,
    );
    result.push({ upper: mean + 2 * std, middle: mean, lower: mean - 2 * std });
  }
  return result;
};

// ── Стратегии ──────────────────────────────────────────────────────────────
const momentumStrategy = (candles) => {
  if (candles.length < 100) return { signal: "HOLD" };
  const closes = candles.map((c) => c.close);
  const last = candles.at(-1),
    prev = candles.at(-2),
    prev2 = candles.at(-3);
  const rsi = calcRSI(closes);
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const ema200 = calcEMA(closes, 200);
  const atr = calcATR(candles);
  const macd = calcMACD(closes);
  const lastRSI = rsi.at(-1),
    lastEMA20 = ema20.at(-1),
    lastEMA50 = ema50.at(-1);
  const lastEMA200 = ema200.at(-1),
    lastATR = atr.at(-1);
  const lastMACD = macd.histogram.at(-1),
    prevMACD = macd.histogram.at(-2);
  const price = last.close;
  const atrPercent = (lastATR / price) * 100;
  if (atrPercent < 0.15) return { signal: "HOLD" };
  const uptrend = price > lastEMA20 && lastEMA20 > lastEMA50;
  const downtrend = price < lastEMA20 && lastEMA20 < lastEMA50;
  const longUp = lastEMA200 ? lastEMA50 > lastEMA200 : true;
  const longDown = lastEMA200 ? lastEMA50 < lastEMA200 : true;
  const twoGreen = last.close > last.open && prev.close > prev.open;
  const twoRed = last.close < last.open && prev.close < prev.open;
  if (
    uptrend &&
    longUp &&
    lastRSI > 50 &&
    lastRSI < 65 &&
    lastMACD > 0 &&
    lastMACD > prevMACD &&
    twoGreen
  )
    return { signal: "BUY" };
  if (
    downtrend &&
    longDown &&
    lastRSI < 50 &&
    lastRSI > 35 &&
    lastMACD < 0 &&
    lastMACD < prevMACD &&
    twoRed
  )
    return { signal: "SELL" };
  return { signal: "HOLD" };
};

const meanReversionStrategy = (candles) => {
  if (candles.length < 60) return { signal: "HOLD" };
  const closes = candles.map((c) => c.close);
  const last = candles.at(-1),
    prev = candles.at(-2);
  const price = last.close;
  const rsi = calcRSI(closes);
  const atr = calcATR(candles);
  const bb = calcBB(closes);
  const lastRSI = rsi.at(-1),
    prevRSI = rsi.at(-2);
  const lastATR = atr.at(-1),
    lastBB = bb.at(-1);
  const atrPercent = (lastATR / price) * 100;
  if (atrPercent < 0.18) return { signal: "HOLD" };
  const bbWidth = (lastBB.upper - lastBB.lower) / lastBB.middle;
  if (bbWidth < 0.01) return { signal: "HOLD" };
  const twoGreen = last.close > last.open && prev.close > prev.open;
  const twoRed = last.close < last.open && prev.close < prev.open;
  const rsiUp = lastRSI > prevRSI,
    rsiDown = lastRSI < prevRSI;
  if (lastRSI < 32 && price < lastBB.lower && rsiUp && twoGreen)
    return { signal: "BUY" };
  if (lastRSI > 68 && price > lastBB.upper && rsiDown && twoRed)
    return { signal: "SELL" };
  return { signal: "HOLD" };
};

const breakoutStrategy = (candles) => {
  if (candles.length < 60) return { signal: "HOLD" };
  const closes = candles.map((c) => c.close);
  const last = candles.at(-1),
    prev = candles.at(-2),
    prev2 = candles.at(-3);
  const price = last.close;
  const ema20 = calcEMA(closes, 20),
    ema50 = calcEMA(closes, 50);
  const atr = calcATR(candles),
    rsi = calcRSI(closes);
  const lastEMA20 = ema20.at(-1),
    lastEMA50 = ema50.at(-1);
  const lastATR = atr.at(-1),
    lastRSI = rsi.at(-1);
  const atrPercent = (lastATR / price) * 100;
  if (atrPercent < 0.18) return { signal: "HOLD" };
  const lookback = closes.slice(-21, -1);
  const high20 = Math.max(...lookback),
    low20 = Math.min(...lookback);
  const volumes = candles.slice(-20).map((c) => c.volume);
  const avgVol =
    volumes.slice(0, -1).reduce((a, b) => a + b, 0) / (volumes.length - 1);
  const volRatio = last.volume / avgVol;
  const range = last.high - last.low || 1;
  const body = Math.abs(last.close - last.open);
  const bodyRatio = body / range;
  const bullish = last.close > last.open && bodyRatio > 0.5;
  const bearish = last.close < last.open && bodyRatio > 0.5;
  const upMom = last.close > prev.close && prev.close > prev2.close;
  const downMom = last.close < prev.close && prev.close < prev2.close;
  const uptrend = lastEMA20 > lastEMA50,
    downtrend = lastEMA20 < lastEMA50;
  if (
    price > high20 &&
    uptrend &&
    bullish &&
    lastRSI > 52 &&
    lastRSI < 75 &&
    volRatio > 1.3 &&
    upMom
  )
    return { signal: "BUY" };
  if (
    price < low20 &&
    downtrend &&
    bearish &&
    lastRSI < 48 &&
    lastRSI > 25 &&
    volRatio > 1.3 &&
    downMom
  )
    return { signal: "SELL" };
  return { signal: "HOLD" };
};

// ── Бэктест ────────────────────────────────────────────────────────────────
const backtest = (candles, strategy) => {
  let balance = 1000;
  let position = null;
  const trades = [];
  let lossStreak = 0,
    cooldown = 0;
  const atrValues = calcATR(candles);

  for (let i = 60; i < candles.length - 1; i++) {
    const slice = candles.slice(0, i + 1);
    const signal = strategy(slice);
    const nextCandle = candles[i + 1];
    const price = nextCandle?.open;
    if (!price) continue;
    const currentATR = atrValues[Math.min(i, atrValues.length - 1)];
    if (!currentATR) continue;
    const atrPercent = (currentATR / price) * 100;

    if (position) {
      const c = candles[i + 1];
      if (!c) continue;
      const cur = c.close ?? price;
      position.bestPrice =
        position.type === "LONG"
          ? Math.max(position.bestPrice, c.high)
          : Math.min(position.bestPrice, c.low);

      const longSL = position.entry * (1 - position.slPercent);
      const longTP = position.entry * (1 + position.tpPercent);
      const shortSL = position.entry * (1 + position.slPercent);
      const shortTP = position.entry * (1 - position.tpPercent);

      const hitSL =
        position.type === "LONG" ? c.low <= longSL : c.high >= shortSL;
      const hitTP =
        position.type === "LONG" ? c.high >= longTP : c.low <= shortTP;

      let trailingHit = false,
        trailExit = cur;
      const pnlP =
        position.type === "LONG"
          ? (cur - position.entry) / position.entry
          : (position.entry - cur) / position.entry;

      if (pnlP >= 0.01) {
        const td = (currentATR * 1.0) / position.entry;
        const tl =
          position.type === "LONG"
            ? position.bestPrice * (1 - td)
            : position.bestPrice * (1 + td);
        trailingHit = position.type === "LONG" ? c.low <= tl : c.high >= tl;
        trailExit = tl;
      }

      const timeExit = i - position.entryIndex >= 72;

      if (hitSL || hitTP || trailingHit || timeExit) {
        let exitPrice = cur,
          reason = "TIME";
        if (hitSL && hitTP) {
          exitPrice = position.type === "LONG" ? longSL : shortSL;
          reason = "SL";
        } else if (hitSL) {
          exitPrice = position.type === "LONG" ? longSL : shortSL;
          reason = "SL";
        } else if (hitTP) {
          exitPrice = position.type === "LONG" ? longTP : shortTP;
          reason = "TP";
        } else if (trailingHit) {
          exitPrice = trailExit;
          reason = "TRAIL";
        }

        exitPrice *= position.type === "LONG" ? 0.9997 : 1.0003;
        const realPnl =
          position.type === "LONG"
            ? (exitPrice - position.entry) / position.entry
            : (position.entry - exitPrice) / position.entry;
        const profit = position.amount * realPnl - position.amount * 0.001 * 2;
        balance += profit;
        if (profit < 0) {
          cooldown = 2;
          lossStreak++;
        } else {
          lossStreak = 0;
        }
        trades.push({ profit, reason });
        position = null;
      }
      continue;
    }

    if (cooldown > 0) {
      cooldown--;
      continue;
    }
    if (!signal || signal.signal === "HOLD") continue;
    if (atrPercent < 0.15) continue;
    if (lossStreak >= 4) continue;

    const slPercent = (currentATR * 1.5) / price;
    const tpPercent = (currentATR * 3.5) / price;
    if (slPercent < 0.002) continue;

    const riskAmount = balance * 0.01;
    const positionSize = Math.min(riskAmount / slPercent, balance * 0.3);
    const actualEntry =
      signal.signal === "BUY" ? price * 1.0003 : price * 0.9997;

    position = {
      type: signal.signal === "BUY" ? "LONG" : "SHORT",
      entry: actualEntry,
      amount: positionSize,
      entryIndex: i,
      bestPrice: actualEntry,
      slPercent,
      tpPercent,
    };
  }

  const wins = trades.filter((t) => t.profit > 0);
  const losses = trades.filter((t) => t.profit < 0);
  const totalProfit = wins.reduce((s, t) => s + t.profit, 0);
  const totalLoss = losses.reduce((s, t) => s + Math.abs(t.profit), 0);
  const winRate = trades.length ? (wins.length / trades.length) * 100 : 0;
  const profitFactor =
    totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0;

  let peak = 1000,
    maxDrawdown = 0,
    running = 1000;
  for (const t of trades) {
    running += t.profit;
    if (running > peak) peak = running;
    const dd = (peak - running) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  return {
    finalBalance: balance,
    totalTrades: trades.length,
    winRate,
    profitFactor,
    maxDrawdown: maxDrawdown * 100,
  };
};

// ── Проверка порогов ───────────────────────────────────────────────────────
const checkThresholds = (result, thresholds, regime) => {
  const {
    MIN_PROFIT_FACTOR,
    MIN_WIN_RATE,
    MIN_TRADES_REQUIRED,
    MAX_DRAWDOWN_ALLOWED,
  } = thresholds;
  return (
    result.totalTrades >= MIN_TRADES_REQUIRED &&
    result.profitFactor >= MIN_PROFIT_FACTOR &&
    result.winRate >= MIN_WIN_RATE &&
    result.maxDrawdown <= MAX_DRAWDOWN_ALLOWED
  );
};

const pf = (v) => (Number.isFinite(v) ? v.toFixed(2) : "∞");

// ── Главный запуск ──────────────────────────────────────────────────────────
console.log("\n🔍 Загружаем свечи с Binance...");
const candles = await fetchCandles();
console.log(`✅ Загружено ${candles.length} свечей (${INTERVAL})\n`);

const splitIndex = Math.floor(candles.length * 0.8);
const btCandles = candles.slice(0, splitIndex);

console.log("⚙️  Запускаем бэктест...\n");

const strategies = [
  { name: "Momentum", fn: momentumStrategy },
  { name: "Mean Reversion", fn: meanReversionStrategy },
  { name: "Breakout", fn: breakoutStrategy },
];

const results = {};
for (const s of strategies) {
  results[s.name] = backtest(btCandles, s.fn);
}

// ── Вывод результатов ───────────────────────────────────────────────────────
console.log("═══════════════════════════════════════════════════════════════");
console.log("  РЕЗУЛЬТАТЫ БЭКТЕСТА");
console.log("═══════════════════════════════════════════════════════════════");

for (const [name, r] of Object.entries(results)) {
  const passOld = checkThresholds(r, OLD);
  const passNew = checkThresholds(r, NEW);
  console.log(`\n📈 ${name}`);
  console.log(`   Trades:       ${r.totalTrades}`);
  console.log(`   WinRate:      ${r.winRate.toFixed(1)}%`);
  console.log(`   ProfitFactor: ${pf(r.profitFactor)}`);
  console.log(`   MaxDrawdown:  ${r.maxDrawdown.toFixed(1)}%`);
  console.log(`   Balance:      $${r.finalBalance.toFixed(2)}`);
  console.log(
    `   Старые пороги: ${passOld ? "✅ ПРОХОДИТ" : "❌ НЕ ПРОХОДИТ"}`,
  );
  console.log(
    `   Новые пороги:  ${passNew ? "✅ ПРОХОДИТ" : "❌ НЕ ПРОХОДИТ"}`,
  );
}

console.log(
  "\n═══════════════════════════════════════════════════════════════",
);
console.log("  ИТОГ: какие стратегии будут торговать");
console.log("═══════════════════════════════════════════════════════════════");

const willTrade = Object.entries(results).filter(([n, r]) =>
  checkThresholds(r, NEW),
);
if (willTrade.length) {
  console.log(`\n✅ При новых порогах будут торговать:`);
  for (const [name] of willTrade) console.log(`   → ${name}`);
} else {
  console.log("\n❌ Даже с новыми порогами нет подходящих стратегий");
  console.log("   Нужно ещё снизить пороги или улучшить стратегии");
}

console.log("");

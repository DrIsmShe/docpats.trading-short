import "dotenv/config";
import { loadOrTrainModel, predictSignal } from "./services/ml/ml.service.js";
import { fetchAndStoreCandles } from "./services/market/market.service.js";
import Candle from "./models/Candle.js";
import { momentumStrategy } from "./services/strategies/momentum.strategy.js";
import { meanReversionStrategy } from "./services/strategies/meanReversion.strategy.js";
import { breakoutStrategy } from "./services/strategies/breakout.strategy.js";
import { backtest } from "./services/backtest/backtest.service.js";
import { detectMarketRegime } from "./services/market/marketRegime.js";
import { calculateATR } from "./services/indicators/indicators.service.js";
import Position from "./models/Position.model.js";
import { getHigherTimeframeTrend } from "./services/market/multiTimeframe.service.js";
import {
  openPosition,
  monitorPositions,
  getUSDTBalance,
  getCurrentPrice,
} from "./services/execution/execution.service.js";
import {
  notifyStart,
  notifySignal,
  notifyOpenPosition,
  notifyNoEdge,
  notifyError,
  notifyLowBalance,
} from "./services/telegram/telegram.service.js";

const SYMBOL = "BTCUSDT";
const INTERVAL = "1h";
const LIMIT = 2000;
const BOT_TYPE = "SHORT";

const MIN_BALANCE = 10;
const MIN_PROFIT_FACTOR = 0.8;
const MIN_WIN_RATE = 30;
const MIN_TRADES_REQUIRED = 5;
const MAX_DRAWDOWN_ALLOWED = 30;
const RISK_PERCENT = 0.01;
const MIN_USDT_AMOUNT = 15; // 15 USDT * плечо 10 = 150 USDT контракт

const ML_THRESHOLD_SHORT = 0.4;

export const botState = {
  regime: "—",
  htfTrend: "—",
  volatility: 0,
  bestStrategy: "—",
  lastRun: null,
  mlConfidence: 0,
  botType: BOT_TYPE,
  strategies: [],
};

const printResult = (title, r) => {
  const pf = Number.isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : "∞";
  console.log(`\n📈 ${title}`);
  console.log(`  Balance:      ${r.finalBalance.toFixed(2)}`);
  console.log(`  Trades:       ${r.totalTrades}`);
  console.log(`  WinRate:      ${r.winRate.toFixed(1)}%`);
  console.log(`  ProfitFactor: ${pf}`);
  console.log(`  MaxDrawdown:  ${r.maxDrawdown?.toFixed(1)}%`);
};

const getVolatility = (candles) => {
  const atr = calculateATR(candles);
  const lastATR = atr.at(-1);
  const price = candles.at(-1)?.close;
  return price && lastATR ? (lastATR / price) * 100 : 0;
};

const getVolumeRatio = (candles) => {
  const volumes = candles.slice(-20).map((c) => c.volume);
  const avgVolume =
    volumes.slice(0, -1).reduce((a, b) => a + b, 0) / (volumes.length - 1);
  const lastVol = candles.at(-1)?.volume ?? 0;
  return avgVolume > 0 ? lastVol / avgVolume : 0;
};

const getRiskProfile = (strategyName) => {
  if (strategyName === "Momentum") return { sl: 1.2, tp: 2.8 };
  if (strategyName === "Breakout") return { sl: 1.0, tp: 3.0 };
  if (strategyName === "Mean Reversion") return { sl: 0.9, tp: 1.8 };
  return { sl: 1.0, tp: 2.5 };
};

const calcSLTP = (price, atr, strategyName) => {
  const profile = getRiskProfile(strategyName);
  return {
    stopLoss: price + atr * profile.sl,
    takeProfit: price - atr * profile.tp,
  };
};

const filterValidShort = (strategies, regime) =>
  strategies.filter((x) => {
    const r = x.result;
    if (!r) return false;

    if (x.name === "Breakout") {
      return regime === "DOWNTREND";
    }

    if (x.name === "Momentum") {
      return regime === "DOWNTREND" || regime === "RANGE";
    }

    const baseValid =
      r.totalTrades >= MIN_TRADES_REQUIRED &&
      r.profitFactor >= MIN_PROFIT_FACTOR &&
      r.winRate >= MIN_WIN_RATE &&
      (r.maxDrawdown ?? 100) <= MAX_DRAWDOWN_ALLOWED;

    return baseValid && regime === "RANGE";
  });

const getStrategyScore = (result) => {
  const pf = Number.isFinite(result.profitFactor) ? result.profitFactor : 3;
  const wr = result.winRate ?? 0;
  const dd = result.maxDrawdown ?? 100;
  const trades = result.totalTrades ?? 0;
  return pf * 40 + wr * 0.8 + trades * 1.5 - dd * 1.2;
};

const sortBest = (strategies) =>
  [...strategies].sort(
    (a, b) => getStrategyScore(b.result) - getStrategyScore(a.result),
  );

export const start = async () => {
  try {
    console.log(
      `\n🔴 SHORT BOT [${new Date().toLocaleTimeString()}] Trading system...\n`,
    );

    await monitorPositions();
    await fetchAndStoreCandles(SYMBOL, INTERVAL);

    const balance = await getUSDTBalance();
    console.log("💰 USDT Balance:", balance.toFixed(2));

    if (balance < MIN_BALANCE) {
      await notifyLowBalance({ balance, required: MIN_BALANCE });
      return;
    }

    const candles = await Candle.find({ symbol: SYMBOL, interval: INTERVAL })
      .sort({ openTime: 1 })
      .limit(LIMIT);

    if (!candles || candles.length < 300) {
      console.log("❌ Недостаточно свечей");
      return;
    }

    const splitIndex = Math.floor(candles.length * 0.8);
    const backtestCandles = candles.slice(0, splitIndex);
    const liveCandles = candles.slice(0);

    const momentumResult = backtest(backtestCandles, momentumStrategy);
    const meanResult = backtest(backtestCandles, meanReversionStrategy);
    const breakoutResult = backtest(backtestCandles, breakoutStrategy);

    const regime = detectMarketRegime(candles);
    const volatility = getVolatility(candles);
    const htfTrend = await getHigherTimeframeTrend(SYMBOL);
    const volRatio = getVolumeRatio(candles);

    console.log(`🧠 1h Regime: ${regime}  |  4h Trend: ${htfTrend}`);
    console.log(`📊 Volatility (ATR): ${volatility.toFixed(2)}%`);
    console.log(`📊 Volume ratio: ${volRatio.toFixed(2)}x`);

    printResult("Momentum", momentumResult);
    printResult("Mean Reversion", meanResult);
    printResult("Breakout", breakoutResult);

    if (regime === "UPTREND") {
      console.log("⛔ SHORT бот: UPTREND — пропускаем");
      return;
    }

    const allStrategies = [
      { name: "Momentum", fn: momentumStrategy, result: momentumResult },
      { name: "Mean Reversion", fn: meanReversionStrategy, result: meanResult },
      { name: "Breakout", fn: breakoutStrategy, result: breakoutResult },
    ];

    const valid = filterValidShort(allStrategies, regime);

    Object.assign(botState, {
      regime,
      htfTrend,
      volatility,
      bestStrategy: valid.length ? sortBest(valid)[0].name : "None",
      lastRun: new Date().toISOString(),
      strategies: [
        { name: "Momentum", ...momentumResult },
        { name: "Mean Reversion", ...meanResult },
        { name: "Breakout", ...breakoutResult },
      ],
    });

    await notifyStart({
      symbol: SYMBOL,
      interval: INTERVAL,
      balance,
      regime,
      volatility,
    });

    if (volatility < 0.18) {
      console.log("🧊 Flat / low volatility → skip");
      return;
    }

    if (!valid.length) {
      console.log("\n⚠️ Нет edge для SHORT → пропускаем");
      await notifyNoEdge({ symbol: SYMBOL, regime });
      return;
    }

    // ── ML фильтр ─────────────────────────────────────
    const mlModel = await loadOrTrainModel(candles);
    const { confidence } = await predictSignal(liveCandles, mlModel);

    botState.mlConfidence = confidence;
    console.log(`🤖 ML: вероятность роста = ${(confidence * 100).toFixed(1)}%`);

    if (confidence >= ML_THRESHOLD_SHORT) {
      console.log(
        `⛔ SHORT бот: ML ${(confidence * 100).toFixed(1)}% >= 40% — не шортим`,
      );
      return;
    }

    console.log(
      `✅ SHORT бот: ML ${(confidence * 100).toFixed(1)}% < 40% — ищем SELL`,
    );

    const best = sortBest(valid)[0];
    const liveSignal = best.fn(liveCandles);

    console.log(`\n🏆 Strategy: ${best.name}`);
    console.log(`📡 Signal: ${liveSignal.signal} — ${liveSignal.reason}`);

    if (liveSignal.signal !== "SELL") {
      console.log("⏸️ SHORT бот: нет SELL сигнала → пропускаем");
      return;
    }

    await notifySignal({
      strategy: best.name,
      signal: liveSignal.signal,
      reason: `[SHORT BOT] ${liveSignal.reason}`,
      symbol: SYMBOL,
    });

    const currentPrice = await getCurrentPrice(SYMBOL);
    const lastATR = calculateATR(candles).at(-1);
    if (!lastATR) return;

    const { stopLoss, takeProfit } = calcSLTP(currentPrice, lastATR, best.name);

    // Размер позиции — минимум 15 USDT (x10 плечо = 150 USDT контракт)
    let riskPercent = RISK_PERCENT;
    if (confidence <= 0.25) riskPercent = 0.0125;
    else if (confidence <= 0.32) riskPercent = 0.01;
    else riskPercent = 0.0075;

    const usdtAmount = Math.max(balance * riskPercent, MIN_USDT_AMOUNT);

    console.log(
      `\n💸 SELL | ${usdtAmount.toFixed(2)} USDT | SL: ${stopLoss.toFixed(2)} | TP: ${takeProfit.toFixed(2)} | ML: ${(confidence * 100).toFixed(1)}%`,
    );

    // ── Cooldown 30 мин ───────────────────────────────
    const lastClosed = await Position.findOne({
      symbol: SYMBOL,
      status: "CLOSED",
    }).sort({ closedAt: -1 });

    if (lastClosed?.closedAt) {
      const minutesSinceClose =
        (Date.now() - new Date(lastClosed.closedAt).getTime()) / 60000;
      if (minutesSinceClose < 30) {
        console.log(`⏳ Cooldown: ${minutesSinceClose.toFixed(1)} мин`);
        return;
      }
    }

    const position = await openPosition({
      symbol: SYMBOL,
      side: "SELL",
      usdtAmount,
      stopLoss,
      takeProfit,
    });

    if (position) {
      await notifyOpenPosition({
        symbol: SYMBOL,
        side: "SELL",
        entryPrice: position.entryPrice,
        quantity: position.quantity,
        stopLoss,
        takeProfit,
        usdtAmount,
      });
      console.log("✅ SHORT позиция открыта!");
    }
  } catch (err) {
    console.error("❌ SHORT BOT ERROR:", err.message);
    await notifyError(`[SHORT BOT] ${err.message}`);
  }
};

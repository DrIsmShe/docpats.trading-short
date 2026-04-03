import { calculateATR } from "../indicators/indicators.service.js";

const RISK_PER_TRADE = 0.01; // 1% баланса на сделку
const FEE = 0.001;
const SLIPPAGE = 0.0003;

const ATR_MULTIPLIER_SL = 1.5; // было 1.0 — стоп подальше от шума
const ATR_MULTIPLIER_TP = 3.5; // было 2.5 — RR = 2.3
const TRAILING_TRIGGER = 0.01; // включаем трейлинг после +1%
const TRAILING_DISTANCE = 1.0; // трейлинг = 1.0 ATR
const MAX_HOLD = 72; // было 48 — даём больше времени

export const backtest = (candles, strategy) => {
  let balance = 1000;
  let position = null;
  const trades = [];

  let lossStreak = 0;
  let cooldown = 0;

  // ✅ Считаем ATR один раз для всего массива
  const atrValues = calculateATR(candles);

  for (let i = 60; i < candles.length - 1; i++) {
    const slice = candles.slice(0, i + 1);
    const signal = strategy(slice);

    const nextCandle = candles[i + 1];
    const price = nextCandle?.open;
    if (!price) continue;

    // ✅ Исправлен индекс ATR — берём последний доступный элемент для текущей позиции
    const atrIndex = Math.min(i, atrValues.length - 1);
    const currentATR = atrValues[atrIndex];
    if (!currentATR) continue;

    const atrPercent = (currentATR / price) * 100;

    // ======================
    // 📊 УПРАВЛЕНИЕ ПОЗИЦИЕЙ
    // ======================
    if (position) {
      const currentCandle = candles[i + 1];
      if (!currentCandle) continue;

      const currentPrice = currentCandle.close ?? price;
      const holdingTime = i - position.entryIndex;

      const pnlPercent =
        position.type === "LONG"
          ? (currentPrice - position.entry) / position.entry
          : (position.entry - currentPrice) / position.entry;

      // Обновляем лучшую цену для трейлинга
      if (position.type === "LONG") {
        position.bestPrice = Math.max(position.bestPrice, currentCandle.high);
      } else {
        position.bestPrice = Math.min(position.bestPrice, currentCandle.low);
      }

      const longSLPrice = position.entry * (1 - position.slPercent);
      const longTPPrice = position.entry * (1 + position.tpPercent);
      const shortSLPrice = position.entry * (1 + position.slPercent);
      const shortTPPrice = position.entry * (1 - position.tpPercent);

      const hitSL =
        position.type === "LONG"
          ? currentCandle.low <= longSLPrice
          : currentCandle.high >= shortSLPrice;

      const hitTP =
        position.type === "LONG"
          ? currentCandle.high >= longTPPrice
          : currentCandle.low <= shortTPPrice;

      // Трейлинг-стоп
      let trailingHit = false;
      let trailingExitPrice = currentPrice;

      if (pnlPercent >= TRAILING_TRIGGER) {
        const trailDist = (currentATR * TRAILING_DISTANCE) / position.entry;
        const trailingLevel =
          position.type === "LONG"
            ? position.bestPrice * (1 - trailDist)
            : position.bestPrice * (1 + trailDist);

        trailingHit =
          position.type === "LONG"
            ? currentCandle.low <= trailingLevel
            : currentCandle.high >= trailingLevel;

        trailingExitPrice = trailingLevel;
      }

      const timeExit = holdingTime >= MAX_HOLD;

      if (hitSL || hitTP || trailingHit || timeExit) {
        let exitPrice = currentPrice;
        let reason = "TIME";

        // При конфликте SL+TP — берём худший сценарий (SL)
        if (hitSL && hitTP) {
          exitPrice = position.type === "LONG" ? longSLPrice : shortSLPrice;
          reason = "SL";
        } else if (hitSL) {
          exitPrice = position.type === "LONG" ? longSLPrice : shortSLPrice;
          reason = "SL";
        } else if (hitTP) {
          exitPrice = position.type === "LONG" ? longTPPrice : shortTPPrice;
          reason = "TP";
        } else if (trailingHit) {
          exitPrice = trailingExitPrice;
          reason = "TRAIL";
        }

        // Слиппедж при выходе
        exitPrice *= position.type === "LONG" ? 1 - SLIPPAGE : 1 + SLIPPAGE;

        const realPnl =
          position.type === "LONG"
            ? (exitPrice - position.entry) / position.entry
            : (position.entry - exitPrice) / position.entry;

        const profit = position.amount * realPnl - position.amount * FEE * 2;

        balance += profit;

        if (profit < 0) {
          cooldown = 2; // было 3 — меньше пауза после лосса
          lossStreak++;
        } else {
          lossStreak = 0;
        }

        trades.push({
          type: position.type,
          entry: position.entry,
          exit: exitPrice,
          profit,
          holdingTime,
          reason,
        });

        position = null;
      }

      continue;
    }

    // Cooldown после лосса
    if (cooldown > 0) {
      cooldown--;
      continue;
    }

    // Фильтры входа
    if (!signal || signal.signal === "HOLD") continue;
    if (atrPercent < 0.15) continue;
    if (lossStreak >= 4) continue;

    const slPercent = (currentATR * ATR_MULTIPLIER_SL) / price;
    const tpPercent = (currentATR * ATR_MULTIPLIER_TP) / price;
    if (slPercent < 0.002) continue;

    const riskAmount = balance * RISK_PER_TRADE;
    const positionSize = Math.min(riskAmount / slPercent, balance * 0.3);

    const actualEntry =
      signal.signal === "BUY" ? price * (1 + SLIPPAGE) : price * (1 - SLIPPAGE);

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

  // Метрики
  const wins = trades.filter((t) => t.profit > 0);
  const losses = trades.filter((t) => t.profit < 0);

  const totalProfit = wins.reduce((sum, t) => sum + t.profit, 0);
  const totalLoss = losses.reduce((sum, t) => sum + Math.abs(t.profit), 0);

  const winRate = trades.length ? (wins.length / trades.length) * 100 : 0;
  const profitFactor =
    totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0;

  let peak = 1000;
  let maxDrawdown = 0;
  let running = 1000;

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
    avgProfit: wins.length ? totalProfit / wins.length : 0,
    avgLoss: losses.length ? totalLoss / losses.length : 0,
    maxDrawdown: maxDrawdown * 100,
    trades,
  };
};

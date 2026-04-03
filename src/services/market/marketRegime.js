import {
  calculateEMA,
  calculateATR,
} from "../indicators/indicators.service.js";

export const detectMarketRegime = (candles) => {
  if (candles.length < 50) {
    return "UNKNOWN";
  }

  const closes = candles.map((c) => c.close);

  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const atr = calculateATR(candles);

  const lastPrice = closes.at(-1);
  const lastEMA20 = ema20.at(-1);
  const lastEMA50 = ema50.at(-1);
  const prevEMA50 = ema50.at(-5);
  const lastATR = atr.at(-1);

  if (!lastEMA20 || !lastEMA50 || !lastATR || !lastPrice) {
    return "UNKNOWN";
  }

  const atrPercent = (lastATR / lastPrice) * 100;

  // Чуть менее строгий фильтр низкой волатильности
  if (atrPercent < 0.15) {
    return "LOW_VOL";
  }

  if (lastEMA20 > lastEMA50 * 1.001 && lastEMA50 > prevEMA50) {
    return "UPTREND";
  }

  if (lastEMA20 < lastEMA50 * 0.999 && lastEMA50 < prevEMA50) {
    return "DOWNTREND";
  }

  return "RANGE";
};

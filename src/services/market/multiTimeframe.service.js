import { getKlines } from "../binance/binance.service.js";
import {
  calculateEMA,
  calculateATR,
} from "../indicators/indicators.service.js";

export const getHigherTimeframeTrend = async (symbol) => {
  try {
    const klines = await getKlines(symbol, "4h", 100);
    if (!klines || klines.length < 50) return "UNKNOWN";

    const candles = klines.map((k) => ({
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));

    const closes = candles.map((c) => c.close);
    const ema20 = calculateEMA(closes, 20);
    const ema50 = calculateEMA(closes, 50);
    const atr = calculateATR(candles);

    const lastPrice = closes.at(-1);
    const lastEMA20 = ema20.at(-1);
    const lastEMA50 = ema50.at(-1);
    const lastATR = atr.at(-1);

    if (!lastEMA20 || !lastEMA50 || !lastATR) return "UNKNOWN";

    const atrPct = (lastATR / lastPrice) * 100;
    if (atrPct < 0.2) return "FLAT";

    if (lastEMA20 > lastEMA50 * 1.002) return "UPTREND";
    if (lastEMA20 < lastEMA50 * 0.998) return "DOWNTREND";
    return "RANGE";
  } catch (err) {
    console.error("❌ HTF error:", err.message);
    return "UNKNOWN";
  }
};

// export const isSignalAlignedWithHTF = (signal, htfTrend) => {
//   if (!signal || signal === "HOLD") return true;

//   if (htfTrend === "UPTREND") {
//     return signal === "BUY";
//   }

//   if (htfTrend === "DOWNTREND") {
//     return signal === "SELL";
//   }

//   if (htfTrend === "RANGE" || htfTrend === "FLAT" || htfTrend === "UNKNOWN") {
//     return true;
//   }

//   return true;
// };
export const isSignalAlignedWithHTF = (signal, htfTrend) => {
  // Полностью убираем блокировку — риск контролируется через SL/TP
  return true;
};

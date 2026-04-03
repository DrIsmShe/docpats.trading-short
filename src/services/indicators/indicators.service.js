import { RSI, EMA } from "technicalindicators";
import { ATR } from "technicalindicators";
export const calculateRSI = (closes) => {
  return RSI.calculate({
    values: closes,
    period: 14,
  });
};

export const calculateEMA = (closes, period = 20) => {
  return EMA.calculate({
    values: closes,
    period,
  });
};

export const calculateATR = (candles) => {
  return ATR.calculate({
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
    close: candles.map((c) => c.close),
    period: 14,
  });
};

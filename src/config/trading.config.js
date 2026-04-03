// ======================
// ⚙️ ЦЕНТРАЛЬНЫЙ КОНФИГ
// ======================

export const CONFIG = {
  // Пара и таймфрейм
  SYMBOL: "BTCUSDT",
  INTERVAL: "1h",
  LIMIT: 2000,

  // Пороги качества стратегии
  MIN_TRADES_REQUIRED: 10,
  MIN_PROFIT_FACTOR: 1.0, // снизили с 1.2 — начинаем торговать
  MIN_WIN_RATE: 38, // снизили с 40
  MAX_DRAWDOWN_ALLOWED: 30, // подняли с 25

  // Риск на сделку
  MIN_BALANCE: 10,
  RISK_PERCENT: 0.01, // 1% баланса
  ATR_SL_MULTIPLIER: 1.0,
  ATR_TP_MULTIPLIER: 2.5,

  // Рынок
  MIN_VOLATILITY: 0.15,
};

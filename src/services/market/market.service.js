import Candle from "../../models/Candle.js";
import { getKlines } from "../binance/binance.service.js";

export const fetchAndStoreCandles = async (
  symbol,
  interval,
  totalCandles = 2000,
) => {
  const batchSize = 1000;
  let allFormatted = [];
  let endTime = undefined;

  for (let batch = 0; batch < Math.ceil(totalCandles / batchSize); batch++) {
    const klines = await getKlines(symbol, interval, batchSize, endTime);

    if (!klines || klines.length === 0) break;

    const formatted = klines.map((k) => ({
      symbol,
      interval,
      openTime: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));

    // Следующий батч — от начала текущего назад
    endTime = formatted[0].openTime - 1;

    // Старые свечи в начало
    allFormatted = [...formatted, ...allFormatted];
  }

  // Убираем дубликаты и сортируем
  const seen = new Set();
  const unique = allFormatted
    .filter((c) => {
      if (seen.has(c.openTime)) return false;
      seen.add(c.openTime);
      return true;
    })
    .sort((a, b) => a.openTime - b.openTime);

  let saved = 0;
  for (const candle of unique) {
    try {
      await Candle.updateOne(
        {
          symbol: candle.symbol,
          interval: candle.interval,
          openTime: candle.openTime,
        },
        candle,
        { upsert: true },
      );
      saved++;
    } catch (err) {}
  }

  console.log(`✅ Saved/updated ${saved} candles (fetched: ${unique.length})`);
};

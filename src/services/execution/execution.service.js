import crypto from "crypto";
import axios from "axios";
import Position from "../../models/Position.model.js";

// ─── Фьючерсные эндпоинты ──────────────────────────────────────────────────
const BASE_URLS = ["https://fapi.binance.com"];

const TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const binanceRequest = async (method, endpoint, params = {}, headers = {}) => {
  let lastError;

  for (const baseUrl of BASE_URLS) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const url = `${baseUrl}${endpoint}`;
        const config = {
          method,
          url,
          timeout: TIMEOUT_MS,
          headers,
        };

        if (method === "GET") {
          config.params = params;
        } else {
          config.url = `${url}?${params}`;
        }

        const res = await axios(config);
        return res.data;
      } catch (err) {
        lastError = err;
        console.warn(
          `⚠️  [${baseUrl}] попытка ${attempt}/${MAX_RETRIES}: ${err.message}`,
        );

        if (err.response?.status === 400 || err.response?.status === 401) {
          throw err;
        }

        if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
      }
    }
  }

  throw lastError;
};

const sign = (queryString) =>
  crypto
    .createHmac("sha256", process.env.BINANCE_SECRET_KEY)
    .update(queryString)
    .digest("hex");

const privatePost = async (endpoint, params = {}) => {
  const timestamp = Date.now();
  const query = new URLSearchParams({ ...params, timestamp }).toString();
  const signature = sign(query);
  const fullQuery = `${query}&signature=${signature}`;

  return binanceRequest("POST", endpoint, fullQuery, {
    "X-MBX-APIKEY": process.env.BINANCE_API_KEY,
  });
};

const privateGet = async (endpoint, params = {}) => {
  const timestamp = Date.now();
  const query = new URLSearchParams({ ...params, timestamp }).toString();
  const signature = sign(query);

  return binanceRequest(
    "GET",
    endpoint,
    Object.fromEntries(new URLSearchParams(`${query}&signature=${signature}`)),
    { "X-MBX-APIKEY": process.env.BINANCE_API_KEY },
  );
};

// ======================
// 📊 ТЕКУЩАЯ ЦЕНА
// ======================
export const getCurrentPrice = async (symbol) => {
  const data = await binanceRequest("GET", "/fapi/v1/ticker/price", { symbol });
  return parseFloat(data.price);
};

// ======================
// 📊 БАЛАНС USDT (фьючерсный)
// ======================
export const getUSDTBalance = async () => {
  const account = await privateGet("/fapi/v2/account");
  const usdt = account.assets.find((a) => a.asset === "USDT");
  return parseFloat(usdt?.availableBalance ?? "0");
};

// ======================
// 🔢 LOT SIZE
// ======================
const getSymbolInfo = async (symbol) => {
  const data = await binanceRequest("GET", "/fapi/v1/exchangeInfo");
  return data.symbols.find((s) => s.symbol === symbol);
};

const roundToStepSize = (quantity, stepSize) => {
  const precision = Math.round(-Math.log10(parseFloat(stepSize)));
  return parseFloat(quantity.toFixed(precision));
};

// ======================
// 🚀 ОТКРЫТЬ SHORT ПОЗИЦИЮ
// ======================
export const openPosition = async ({
  symbol,
  side,
  usdtAmount,
  stopLoss,
  takeProfit,
}) => {
  try {
    const existing = await Position.findOne({ symbol, status: "OPEN" });
    if (existing) {
      console.log(`⚠️ Позиция уже открыта для ${symbol}`);
      return null;
    }

    const price = await getCurrentPrice(symbol);
    const symbolInfo = await getSymbolInfo(symbol);
    const lotFilter = symbolInfo.filters.find(
      (f) => f.filterType === "LOT_SIZE",
    );
    const stepSize = lotFilter?.stepSize ?? "0.001";

    const rawQty = (usdtAmount * 10) / price; // умножаем на плечо x10
    const quantity = roundToStepSize(rawQty, stepSize);
    const notional = quantity * price;

    if (notional < 5) {
      console.error(`❌ Notional too small: ${notional.toFixed(2)} < 5`);
      return null;
    }

    console.log(`\n🚀 Открываем ${side} ${symbol} (FUTURES)`);
    console.log(`   Цена: ${price} | Qty: ${quantity} | USDT: ${usdtAmount}`);
    console.log(
      `   SL: ${stopLoss?.toFixed(2)} | TP: ${takeProfit?.toFixed(2)}`,
    );

    // Устанавливаем плечо x1 (без плеча)
    await privatePost("/fapi/v1/leverage", {
      symbol,
      leverage: 10,
    });

    // Открываем рыночный ордер
    const order = await privatePost("/fapi/v1/order", {
      symbol,
      side, // SELL для шорта
      type: "MARKET",
      quantity,
      positionSide: "SHORT", // для Hedge Mode
    });

    const filledPrice = parseFloat(order.avgPrice ?? price);
    const filledQty = parseFloat(order.executedQty);

    console.log(`✅ Ордер исполнен: ${filledPrice} x ${filledQty}`);

    const position = await Position.create({
      symbol,
      side,
      entryPrice: filledPrice,
      quantity: filledQty,
      usdtAmount,
      stopLoss,
      takeProfit,
      orderId: order.orderId,
      status: "OPEN",
      openedAt: new Date(),
    });

    return position;
  } catch (err) {
    console.error(
      "❌ Ошибка открытия позиции:",
      err.response?.data || err.message,
    );
    return null;
  }
};

// ======================
// 🔒 ЗАКРЫТЬ ПОЗИЦИЮ
// ======================
export const closePosition = async (positionId, reason = "MANUAL") => {
  try {
    const position = await Position.findById(positionId);
    if (!position || position.status !== "OPEN") return null;

    const price = await getCurrentPrice(position.symbol);
    const closeSide = position.side === "SELL" ? "BUY" : "SELL";

    console.log(`\n🔒 Закрываем SHORT ${position.symbol} (${reason})`);

    const order = await privatePost("/fapi/v1/order", {
      symbol: position.symbol,
      side: closeSide,
      type: "MARKET",
      quantity: position.quantity,
      positionSide: "SHORT",
      reduceOnly: true,
    });

    const exitPrice = parseFloat(order.avgPrice ?? price);
    const pnlPercent = (position.entryPrice - exitPrice) / position.entryPrice;
    const pnlUSDT = position.usdtAmount * pnlPercent;
    const feeUSDT = position.usdtAmount * 0.001 * 2;
    const netPnL = pnlUSDT - feeUSDT;

    position.status = "CLOSED";
    position.exitPrice = exitPrice;
    position.pnlPercent = pnlPercent * 100;
    position.pnlUSDT = netPnL;
    position.closeReason = reason;
    position.closedAt = new Date();
    await position.save();

    console.log(`✅ SHORT закрыт | PnL: ${netPnL.toFixed(4)} USDT`);
    return position;
  } catch (err) {
    console.error("❌ Ошибка закрытия:", err.response?.data || err.message);
    return null;
  }
};

// ======================
// 👁️ МОНИТОР SL/TP
// ======================
export const monitorPositions = async () => {
  try {
    const openPositions = await Position.find({ status: "OPEN" });

    for (const pos of openPositions) {
      const price = await getCurrentPrice(pos.symbol);

      if (pos.stopLoss) {
        const slHit =
          pos.side === "SELL" ? price >= pos.stopLoss : price <= pos.stopLoss;
        if (slHit) {
          console.log(`🛑 SL сработал ${pos.symbol} @ ${price}`);
          await closePosition(pos._id, "SL");
          continue;
        }
      }

      if (pos.takeProfit) {
        const tpHit =
          pos.side === "SELL"
            ? price <= pos.takeProfit
            : price >= pos.takeProfit;
        if (tpHit) {
          console.log(`🎯 TP сработал ${pos.symbol} @ ${price}`);
          await closePosition(pos._id, "TP");
          continue;
        }
      }

      const hoursOpen = (Date.now() - pos.openedAt.getTime()) / 3600000;
      if (hoursOpen > 48) {
        console.log(`⏱️ Таймаут ${pos.symbol}`);
        await closePosition(pos._id, "TIMEOUT");
      }
    }
  } catch (err) {
    console.error("❌ Ошибка монитора:", err.message);
  }
};

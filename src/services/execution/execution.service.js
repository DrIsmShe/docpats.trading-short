import crypto from "crypto";
import axios from "axios";
import Position from "../../models/Position.model.js";

// ─── Binance имеет несколько зеркал — пробуем по порядку ───────────────────
const BASE_URLS = [
  "https://api.binance.com",
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api3.binance.com",
  "https://api4.binance.com",
];

// ─── Таймаут и retry настройки ─────────────────────────────────────────────
const TIMEOUT_MS = 15000;   // 15 секунд на запрос
const MAX_RETRIES = 3;       // попыток на каждый URL
const RETRY_DELAY_MS = 2000; // пауза между попытками

// ─── Опциональный прокси из .env ──────────────────────────────────────────
// Если есть PROXY_URL в .env (формат: http://user:pass@host:port) — используем
let proxyConfig = null;
if (process.env.PROXY_URL) {
  try {
    const url = new URL(process.env.PROXY_URL);
    proxyConfig = {
      host: url.hostname,
      port: parseInt(url.port),
      protocol: url.protocol.replace(":", ""),
      ...(url.username && {
        auth: { username: url.username, password: url.password },
      }),
    };
    console.log(`🔌 Прокси настроен: ${url.hostname}:${url.port}`);
  } catch {
    console.warn("⚠️ Неверный формат PROXY_URL — прокси отключён");
  }
}

// ─── Задержка ──────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Универсальный запрос с retry по всем зеркалам ────────────────────────
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
          ...(proxyConfig && { proxy: proxyConfig }),
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
        const isTimeout =
          err.code === "ETIMEDOUT" ||
          err.code === "ECONNABORTED" ||
          err.message?.includes("timeout") ||
          err.message?.includes("secureConnect");

        console.warn(
          `⚠️  [${baseUrl}] попытка ${attempt}/${MAX_RETRIES}: ${err.message}`
        );

        // Ошибка авторизации или биржи — не ретраим
        if (err.response?.status === 400 || err.response?.status === 401) {
          throw err;
        }

        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS);
        }
      }
    }
    console.warn(`❌ ${baseUrl} недоступен — пробуем следующий...`);
  }

  throw lastError;
};

// ======================
// 🔐 ПОДПИСЬ
// ======================
const sign = (queryString) => {
  return crypto
    .createHmac("sha256", process.env.BINANCE_SECRET_KEY)
    .update(queryString)
    .digest("hex");
};

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
    { "X-MBX-APIKEY": process.env.BINANCE_API_KEY }
  );
};

// ======================
// 📊 ТЕКУЩАЯ ЦЕНА
// ======================
export const getCurrentPrice = async (symbol) => {
  const data = await binanceRequest("GET", "/api/v3/ticker/price", { symbol });
  return parseFloat(data.price);
};

// ======================
// 📊 БАЛАНС USDT
// ======================
export const getUSDTBalance = async () => {
  const account = await privateGet("/api/v3/account");
  const usdt = account.balances.find((b) => b.asset === "USDT");
  return parseFloat(usdt?.free ?? "0");
};

// ======================
// 🔢 LOT SIZE
// ======================
const getSymbolInfo = async (symbol) => {
  const data = await binanceRequest("GET", "/api/v3/exchangeInfo", { symbol });
  return data.symbols[0];
};

const roundToStepSize = (quantity, stepSize) => {
  const precision = Math.round(-Math.log10(parseFloat(stepSize)));
  return parseFloat(quantity.toFixed(precision));
};

// ======================
// 🚀 ОТКРЫТЬ ПОЗИЦИЮ
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
      (f) => f.filterType === "LOT_SIZE"
    );
    const stepSize = lotFilter?.stepSize ?? "0.001";
    const minNotionalFilter = symbolInfo.filters.find(
      (f) => f.filterType === "MIN_NOTIONAL"
    );
    const minNotional = parseFloat(minNotionalFilter?.minNotional ?? "5");

    const rawQty = usdtAmount / price;
    const quantity = roundToStepSize(rawQty, stepSize);
    const notional = quantity * price;

    if (notional < minNotional) {
      console.error(`❌ Notional too small: ${notional.toFixed(2)} < ${minNotional}`);
      return null;
    }
    if (quantity <= 0) {
      console.error("❌ Количество слишком маленькое");
      return null;
    }

    console.log(`\n🚀 Открываем ${side} ${symbol}`);
    console.log(`   Цена: ${price} | Qty: ${quantity} | USDT: ${usdtAmount}`);
    console.log(`   SL: ${stopLoss?.toFixed(2)} | TP: ${takeProfit?.toFixed(2)}`);

    const order = await privatePost("/api/v3/order", {
      symbol,
      side,
      type: "MARKET",
      quantity,
    });

    const filledPrice = parseFloat(order.fills?.[0]?.price ?? price);
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

    console.log(`💾 Позиция сохранена: ${position._id}`);
    return position;
  } catch (err) {
    console.error("❌ Ошибка открытия позиции:", err.response?.data || err.message);
    return null;
  }
};

// ======================
// 🔒 ЗАКРЫТЬ ПОЗИЦИЮ
// ======================
export const closePosition = async (positionId, reason = "MANUAL") => {
  try {
    const position = await Position.findById(positionId);
    if (!position || position.status !== "OPEN") {
      console.log("⚠️ Позиция не найдена или уже закрыта");
      return null;
    }

    const closeSide = position.side === "BUY" ? "SELL" : "BUY";
    const price = await getCurrentPrice(position.symbol);

    console.log(`\n🔒 Закрываем позицию ${position._id} (${reason})`);
    console.log(`   Цена входа: ${position.entryPrice} | Текущая: ${price}`);

    const order = await privatePost("/api/v3/order", {
      symbol: position.symbol,
      side: closeSide,
      type: "MARKET",
      quantity: position.quantity,
    });

    const exitPrice = parseFloat(order.fills?.[0]?.price ?? price);
    const pnlPercent =
      position.side === "BUY"
        ? (exitPrice - position.entryPrice) / position.entryPrice
        : (position.entryPrice - exitPrice) / position.entryPrice;

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

    console.log(`✅ Позиция закрыта`);
    console.log(
      `   Выход: ${exitPrice} | PnL: ${netPnL.toFixed(4)} USDT (${(pnlPercent * 100).toFixed(2)}%)`
    );

    return position;
  } catch (err) {
    console.error("❌ Ошибка закрытия позиции:", err.response?.data || err.message);
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
          pos.side === "BUY" ? price <= pos.stopLoss : price >= pos.stopLoss;
        if (slHit) {
          console.log(`🛑 SL сработал для ${pos.symbol} @ ${price}`);
          await closePosition(pos._id, "SL");
          continue;
        }
      }

      if (pos.takeProfit) {
        const tpHit =
          pos.side === "BUY"
            ? price >= pos.takeProfit
            : price <= pos.takeProfit;
        if (tpHit) {
          console.log(`🎯 TP сработал для ${pos.symbol} @ ${price}`);
          await closePosition(pos._id, "TP");
          continue;
        }
      }

      const hoursOpen = (Date.now() - pos.openedAt.getTime()) / 3600000;
      if (hoursOpen > 48) {
        console.log(`⏱️ Таймаут позиции ${pos.symbol} (${hoursOpen.toFixed(1)}h)`);
        await closePosition(pos._id, "TIMEOUT");
      }
    }
  } catch (err) {
    console.error("❌ Ошибка монитора:", err.message);
  }
};

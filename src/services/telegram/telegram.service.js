import axios from "axios";

const BASE = "https://api.telegram.org";

const send = async (text) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) return;

  try {
    await axios.post(`${BASE}/bot${token}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    });
  } catch (err) {
    console.error(
      "❌ Telegram error:",
      err.response?.data?.description || err.message,
    );
  }
};

export const notifyStart = async ({
  symbol,
  interval,
  balance,
  regime,
  volatility,
}) => {
  await send(
    `🚀 <b>Бот запущен</b>\n` +
      `Пара: <code>${symbol} ${interval}</code>\n` +
      `Баланс: <b>${balance.toFixed(2)} USDT</b>\n` +
      `Режим рынка: <b>${regime}</b>\n` +
      `Волатильность: <b>${volatility.toFixed(2)}%</b>`,
  );
};

export const notifySignal = async ({ strategy, signal, reason, symbol }) => {
  const emoji = signal === "BUY" ? "📈" : signal === "SELL" ? "📉" : "⏸️";
  await send(
    `${emoji} <b>Сигнал: ${signal}</b>\n` +
      `Стратегия: <code>${strategy}</code>\n` +
      `Пара: <code>${symbol}</code>\n` +
      `Причина: ${reason}`,
  );
};

export const notifyOpenPosition = async ({
  symbol,
  side,
  entryPrice,
  quantity,
  stopLoss,
  takeProfit,
  usdtAmount,
}) => {
  const emoji = side === "BUY" ? "🟢" : "🔴";
  await send(
    `${emoji} <b>Позиция открыта</b>\n` +
      `Пара: <code>${symbol}</code>\n` +
      `Сторона: <b>${side}</b>\n` +
      `Цена входа: <b>${entryPrice.toFixed(2)}</b>\n` +
      `Количество: <code>${quantity}</code>\n` +
      `Сумма: <b>${usdtAmount.toFixed(2)} USDT</b>\n` +
      `SL: <code>${stopLoss?.toFixed(2) ?? "—"}</code>\n` +
      `TP: <code>${takeProfit?.toFixed(2) ?? "—"}</code>`,
  );
};

export const notifyClosePosition = async ({
  symbol,
  side,
  entryPrice,
  exitPrice,
  pnlUSDT,
  pnlPercent,
  reason,
  holdingHours,
}) => {
  const profit = pnlUSDT >= 0;
  const emoji = profit ? "✅" : "❌";
  await send(
    `${emoji} <b>Позиция закрыта (${reason})</b>\n` +
      `Пара: <code>${symbol}</code>\n` +
      `Сторона: <b>${side}</b>\n` +
      `Вход: <code>${entryPrice.toFixed(2)}</code> → Выход: <code>${exitPrice.toFixed(2)}</code>\n` +
      `PnL: <b>${pnlUSDT >= 0 ? "+" : ""}${pnlUSDT.toFixed(4)} USDT (${pnlPercent.toFixed(2)}%)</b>\n` +
      `Время в позиции: ${holdingHours.toFixed(1)}ч`,
  );
};

export const notifyNoEdge = async ({ symbol, regime }) => {
  await send(
    `⚠️ <b>Нет преимущества</b>\n` +
      `Пара: <code>${symbol}</code>\n` +
      `Режим: ${regime}\n` +
      `Торговля пропущена`,
  );
};

export const notifyError = async (message) => {
  await send(`❌ <b>Ошибка бота</b>\n<code>${message}</code>`);
};

export const notifyLowBalance = async ({ balance, required }) => {
  await send(
    `💸 <b>Низкий баланс</b>\n` +
      `Текущий: <b>${balance.toFixed(2)} USDT</b>\n` +
      `Минимум: <b>${required} USDT</b>`,
  );
};

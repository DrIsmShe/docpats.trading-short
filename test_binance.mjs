// test_binance.mjs
// Запуск: node test_binance.mjs
// Или с ключами: BINANCE_API_KEY=xxx BINANCE_SECRET_KEY=yyy node test_binance.mjs

import crypto from "crypto";
import https from "https";

const API_KEY = process.env.BINANCE_API_KEY || "";
const SECRET_KEY = process.env.BINANCE_SECRET_KEY || "";

const MIRRORS = [
  "api.binance.com",
  "api1.binance.com",
  "api2.binance.com",
  "api3.binance.com",
  "api4.binance.com",
];

const TIMEOUT = 10000; // 10 секунд

// ── Простой GET запрос через https (без axios) ──────────────────────────────
const httpsGet = (hostname, path) =>
  new Promise((resolve, reject) => {
    const req = https.get({ hostname, path, timeout: TIMEOUT }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("TIMEOUT"));
    });
    req.on("error", reject);
  });

// ── Подпись для приватных запросов ─────────────────────────────────────────
const sign = (query) =>
  crypto.createHmac("sha256", SECRET_KEY).update(query).digest("hex");

const httpsGetPrivate = (hostname, path, params) =>
  new Promise((resolve, reject) => {
    const query = new URLSearchParams({
      ...params,
      timestamp: Date.now(),
    }).toString();
    const sig = sign(query);
    const fullPath = `${path}?${query}&signature=${sig}`;

    const req = https.get(
      {
        hostname,
        path: fullPath,
        timeout: TIMEOUT,
        headers: { "X-MBX-APIKEY": API_KEY },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("TIMEOUT"));
    });
    req.on("error", reject);
  });

// ── Тест 1: Пинг всех зеркал ───────────────────────────────────────────────
const testMirrors = async () => {
  console.log("\n═══════════════════════════════════════");
  console.log("  ТЕСТ 1: Доступность зеркал Binance");
  console.log("═══════════════════════════════════════");

  let bestMirror = null;

  for (const host of MIRRORS) {
    const start = Date.now();
    try {
      const res = await httpsGet(host, "/api/v3/ping");
      const ms = Date.now() - start;
      if (res.status === 200) {
        console.log(`  ✅ ${host} — ${ms}ms`);
        if (!bestMirror) bestMirror = host;
      } else {
        console.log(`  ⚠️  ${host} — HTTP ${res.status}`);
      }
    } catch (err) {
      console.log(`  ❌ ${host} — ${err.message}`);
    }
  }

  return bestMirror;
};

// ── Тест 2: Получить цену BTC ───────────────────────────────────────────────
const testPrice = async (host) => {
  console.log("\n═══════════════════════════════════════");
  console.log("  ТЕСТ 2: Цена BTC/USDT");
  console.log("═══════════════════════════════════════");

  try {
    const res = await httpsGet(host, "/api/v3/ticker/price?symbol=BTCUSDT");
    if (res.body?.price) {
      console.log(
        `  ✅ BTC/USDT = $${parseFloat(res.body.price).toLocaleString()}`,
      );
      return true;
    } else {
      console.log("  ❌ Не удалось получить цену:", res.body);
      return false;
    }
  } catch (err) {
    console.log("  ❌ Ошибка:", err.message);
    return false;
  }
};

// ── Тест 3: Баланс (нужны API ключи) ───────────────────────────────────────
const testBalance = async (host) => {
  console.log("\n═══════════════════════════════════════");
  console.log("  ТЕСТ 3: Баланс USDT (API ключи)");
  console.log("═══════════════════════════════════════");

  if (!API_KEY || !SECRET_KEY) {
    console.log("  ⚠️  API ключи не переданы — пропускаем");
    console.log(
      "  👉 Запусти: BINANCE_API_KEY=xxx BINANCE_SECRET_KEY=yyy node test_binance.mjs",
    );
    return;
  }

  try {
    const res = await httpsGetPrivate(host, "/api/v3/account", {});
    if (res.status === 200 && res.body?.balances) {
      const usdt = res.body.balances.find((b) => b.asset === "USDT");
      const btc = res.body.balances.find((b) => b.asset === "BTC");
      console.log(`  ✅ API ключи работают!`);
      console.log(`  💰 USDT: ${parseFloat(usdt?.free ?? 0).toFixed(2)}`);
      console.log(`  ₿  BTC:  ${parseFloat(btc?.free ?? 0).toFixed(6)}`);
    } else if (res.status === 401) {
      console.log("  ❌ Неверные API ключи (401 Unauthorized)");
    } else if (res.status === 403) {
      console.log("  ❌ Нет прав (403) — проверь IP whitelist в Binance");
    } else {
      console.log(`  ❌ Ошибка ${res.status}:`, res.body);
    }
  } catch (err) {
    console.log("  ❌ Ошибка:", err.message);
  }
};

// ── Главный запуск ──────────────────────────────────────────────────────────
console.log("\n🔍 Тест подключения к Binance API");
console.log(`   Node.js ${process.version}`);
console.log(`   Время: ${new Date().toLocaleString()}`);

const bestMirror = await testMirrors();

if (!bestMirror) {
  console.log("\n🚨 Ни одно зеркало недоступно!");
  console.log("   Решения:");
  console.log("   1. Включи VPN");
  console.log("   2. Добавь PROXY_URL в .env");
  console.log("   3. Перенеси бота на VPS");
} else {
  console.log(`\n  🏆 Лучшее зеркало: ${bestMirror}`);
  await testPrice(bestMirror);
  await testBalance(bestMirror);
}

console.log("\n═══════════════════════════════════════\n");

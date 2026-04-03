import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cron from "node-cron";
import { connectDB } from "./config/db.js";
import Position from "./models/Position.model.js";
import { getUSDTBalance } from "./services/execution/execution.service.js";
import { start, botState } from "./app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "../public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/dashboard.html"));
});

app.get("/api/stats", async (req, res) => {
  try {
    const balance = await getUSDTBalance();
    const closed = await Position.find({ status: "CLOSED" }).sort({
      closedAt: -1,
    });
    const open = await Position.findOne({ status: "OPEN" });
    const wins = closed.filter((t) => (t.pnlUSDT ?? 0) > 0);
    const losses = closed.filter((t) => (t.pnlUSDT ?? 0) <= 0);
    const totalPnL = closed.reduce((s, t) => s + (t.pnlUSDT ?? 0), 0);
    const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
    res.json({
      balance,
      totalPnL,
      totalTrades: closed.length,
      wins: wins.length,
      losses: losses.length,
      winRate,
      openPosition: open,
      ...botState,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/trades", async (req, res) => {
  try {
    const trades = await Position.find({ status: "CLOSED" })
      .sort({ closedAt: -1 })
      .limit(parseInt(req.query.limit) || 20);
    res.json(trades);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/positions/open", async (req, res) => {
  try {
    res.json(await Position.find({ status: "OPEN" }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Защита от параллельных запусков
let isRunning = false;

const runBot = async () => {
  if (isRunning) {
    console.log("⏳ Бот уже запущен — пропускаем");
    return;
  }
  isRunning = true;
  try {
    await start();
  } finally {
    isRunning = false;
  }
};

const init = async () => {
  await connectDB();
  app.listen(PORT, () => console.log(`📊 Dashboard: http://localhost:${PORT}`));

  // Первый запуск сразу
  await runBot();

  // ✅ Каждые 5 минут
  cron.schedule("0,5,10,15,20,25,30,35,40,45,50,55 * * * *", () => {
    console.log(`\n🕐 [${new Date().toLocaleTimeString()}] Cron 5m...`);
    runBot().catch(console.error);
  });
};

init().catch(console.error);

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import Position from "../../models/Position.js";
import { getUSDTBalance } from "../execution/execution.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const startDashboard = (app, state = {}) => {
  // Статика — отдаём dashboard.html
  app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../../../public/dashboard.html"));
  });

  // API: статистика
  app.get("/api/stats", async (req, res) => {
    try {
      const balance = await getUSDTBalance();
      const closed = await Position.find({ status: "CLOSED" }).sort({
        closedAt: -1,
      });
      const open = await Position.findOne({ status: "OPEN" });

      const wins = closed.filter((t) => t.pnlUSDT > 0);
      const losses = closed.filter((t) => t.pnlUSDT <= 0);
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
        // Из глобального state (обновляется в app.js)
        regime: state.regime ?? "—",
        htfTrend: state.htfTrend ?? "—",
        volatility: state.volatility ?? 0,
        bestStrategy: state.bestStrategy ?? "—",
        strategies: state.strategies ?? [],
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // API: открытые позиции
  app.get("/api/positions/open", async (req, res) => {
    const pos = await Position.find({ status: "OPEN" });
    res.json(pos);
  });

  // API: история сделок
  app.get("/api/trades", async (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const trades = await Position.find({ status: "CLOSED" })
      .sort({ closedAt: -1 })
      .limit(limit);
    res.json(trades);
  });
};

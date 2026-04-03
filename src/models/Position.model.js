import mongoose from "mongoose";

const PositionSchema = new mongoose.Schema({
  symbol: { type: String, required: true },
  side: { type: String, enum: ["BUY", "SELL"], required: true },
  entryPrice: { type: Number, required: true },
  exitPrice: { type: Number },
  quantity: { type: Number, required: true },
  usdtAmount: { type: Number, required: true },
  stopLoss: { type: Number },
  takeProfit: { type: Number },
  orderId: { type: String },
  status: { type: String, enum: ["OPEN", "CLOSED"], default: "OPEN" },
  pnlPercent: { type: Number },
  pnlUSDT: { type: Number },
  closeReason: { type: String },
  openedAt: { type: Date, default: Date.now },
  closedAt: { type: Date },
});

// Индекс для быстрого поиска открытых позиций
PositionSchema.index({ symbol: 1, status: 1 });

export default mongoose.model("Position", PositionSchema);

import mongoose from "mongoose";

const candleSchema = new mongoose.Schema(
  {
    symbol: String,
    interval: String,
    openTime: Number,

    open: Number,
    high: Number,
    low: Number,
    close: Number,
    volume: Number,
  },
  { timestamps: true },
);

candleSchema.index({ symbol: 1, interval: 1, openTime: 1 }, { unique: true });

export default mongoose.model("Candle", candleSchema);

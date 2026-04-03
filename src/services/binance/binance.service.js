import axios from "axios";

const BASE_URL = "https://api.binance.com";

export const getKlines = async (
  symbol,
  interval,
  limit = 1000,
  endTime = undefined,
) => {
  try {
    const params = { symbol, interval, limit };
    if (endTime) params.endTime = endTime;

    const res = await axios.get(`${BASE_URL}/api/v3/klines`, { params });
    return res.data;
  } catch (error) {
    console.error("❌ Binance error:", error.message);
    return [];
  }
};

import axios from "axios";
import crypto from "crypto";

const BASE_URL = "https://api.binance.com";

// подпись запроса
const sign = (queryString, secret) => {
  return crypto.createHmac("sha256", secret).update(queryString).digest("hex");
};

// приватный GET запрос
export const privateRequest = async (endpoint, params = {}) => {
  try {
    const API_KEY = process.env.BINANCE_API_KEY;
    const SECRET_KEY = process.env.BINANCE_SECRET_KEY;

    const timestamp = Date.now();

    const query = new URLSearchParams({
      ...params,
      timestamp,
    }).toString();

    const signature = sign(query, SECRET_KEY);

    const url = `${BASE_URL}${endpoint}?${query}&signature=${signature}`;

    const res = await axios.get(url, {
      headers: {
        "X-MBX-APIKEY": API_KEY,
      },
    });

    return res.data;
  } catch (error) {
    console.error(
      "❌ Private API error:",
      error.response?.data || error.message,
    );
  }
};

import "dotenv/config";
import cron from "node-cron";

const runBot = async () => {
  try {
    // Запускаем app.js как дочерний процесс — самый надёжный способ
    const { spawn } = await import("child_process");

    await new Promise((resolve, reject) => {
      const child = spawn("node", ["src/app.js"], {
        cwd: process.cwd(),
        stdio: "inherit", // показываем вывод в консоль
        env: process.env,
      });

      child.on("close", (code) => {
        if (code === 0 || code === null) resolve();
        else reject(new Error(`Bot exited with code ${code}`));
      });

      child.on("error", reject);
    });
  } catch (err) {
    console.error("❌ Bot error:", err.message);
  }
};

console.log("⏰ Scheduler запущен");
console.log("📅 Расписание: каждый час в :01\n");

// Каждый час в :01
cron.schedule("1 * * * *", () => {
  console.log(`\n🕐 [${new Date().toISOString()}] Запуск по расписанию...`);
  runBot();
});

// Первый запуск сразу
console.log("▶️ Первый запуск...");
runBot();

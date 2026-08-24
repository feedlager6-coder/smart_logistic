import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import cookieParser from "cookie-parser";
import apiRouter from "./artifacts/api-server/src/routes";
import { startTelegramPolling } from "./artifacts/api-server/src/lib/telegram";

const PORT = 3000;

async function startServer() {
  const app = express();

  app.use(cors());
  app.use(cookieParser());
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // Mount backend API routes on /api
  app.use("/api", apiRouter);

  // Development: Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      configFile: path.resolve(process.cwd(), "artifacts/smartroute/vite.config.ts"),
      server: { middlewareMode: true },
      appType: "spa",
      root: path.resolve(process.cwd(), "artifacts/smartroute"),
    });
    app.use(vite.middlewares);
  } else {
    // Production: serve built static assets
    const distPath = path.resolve(process.cwd(), "artifacts/smartroute/dist/public");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`SmartRoute server running on http://0.0.0.0:${PORT}`);
    // Start Telegram bot polling if token exists
    startTelegramPolling();
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

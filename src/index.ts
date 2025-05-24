import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import {
  serveAuthUrl,
  handleOAuthCallback,
} from "./controllers/oauthController";
import { runEmailSync } from "./jobs/syncGmail";
import cron from "node-cron";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get("/", (_, res) => {
  res.send(`<a href="/auth/google">Login With Google</a>`);
});

const authRouter = express.Router();
authRouter.get("/google", serveAuthUrl);
authRouter.get("/google/callback", handleOAuthCallback);
app.use("/auth", authRouter);

app.get("/sync-now", async (_req, res) => {
  // Manual trigger endpoint
  console.log("Manual sync triggered via /sync-now endpoint.");
  runEmailSync().catch((err) => {
    console.error("Manual sync from endpoint failed:", err);
  });
  res.send("✅ Email sync initiated in background. Check logs for progress.");
});

app.listen(port, () => {
  console.log(`🚀 Server ready at http://localhost:${port}`);
  console.log(`🔗 OAuth Start: http://localhost:${port}/auth/google`);

  // Schedule the sync job
  // Runs every 5 minutes.
  const CRON_SCHEDULE = process.env.CRON_SCHEDULE || "*/5 * * * *";
  if (cron.validate(CRON_SCHEDULE)) {
    cron.schedule(CRON_SCHEDULE, () => {
      console.log(
        `🕒 [${new Date().toISOString()}] Running scheduled email sync...`
      );
      runEmailSync().catch((err) => {
        console.error(
          `❌ [${new Date().toISOString()}] Scheduled email sync failed:`,
          err.message
        );
      });
    });
    console.log(
      `🕒 Email sync scheduled with cron expression: ${CRON_SCHEDULE}`
    );
  } else {
    console.error(
      `❌ Invalid CRON_SCHEDULE: ${CRON_SCHEDULE}. Sync job will not run.`
    );
  }
});

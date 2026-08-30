import app from "./app";
import { env } from "./config/env";
import { initializeOperationalGraph } from "./agent/operational-agent";
import { startTelegramIntegration, stopTelegramIntegration } from "./features/telegram/telegram.startup";

initializeOperationalGraph()
  .then(() => app.listen(env.port, () => {
    console.log(`Hijau AI backend listening on port ${env.port}`);
    void startTelegramIntegration().catch((error: unknown) => console.error("Telegram integration failed", error));
  }))
  .catch((error: unknown) => { console.error("Operational graph initialization failed", error); process.exitCode = 1; });

const shutdown = () => { stopTelegramIntegration(); process.exit(0); };
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

import { loadConfig } from "@editloom/config";

export function runWorker({ config = loadConfig(), once = false, logger = console } = {}) {
  logger.info(JSON.stringify({ event: "worker_ready", poll_ms: config.queuePollMs }));
  if (once) return { stop() {} };

  const interval = setInterval(() => {
    // Task 7 replaces this heartbeat with durable outbox polling and job claims.
    logger.info(JSON.stringify({ event: "worker_poll", status: "idle" }));
  }, config.queuePollMs);

  return { stop: () => clearInterval(interval) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runWorker({ once: process.argv.includes("--once") });
}

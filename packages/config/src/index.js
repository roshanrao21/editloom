const DEFAULTS = Object.freeze({
  nodeEnv: "development",
  webHost: "127.0.0.1",
  webPort: 3000,
  apiHost: "127.0.0.1",
  apiPort: 3001,
  queuePollMs: 1000,
  storageRoot: ".local-storage"
});

function readPort(value, key, fallback) {
  if (value === undefined || value === "") return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${key} must be an integer between 1 and 65535`);
  }
  return port;
}

function readPositiveInteger(value, key, fallback) {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${key} must be a positive integer`);
  }
  return number;
}

function readNonEmpty(value, key, fallback) {
  if (value === undefined || value === "") return fallback;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

function readOptionalNonEmpty(value, key) {
  if (value === undefined || value === "") return null;
  return readNonEmpty(value, key);
}

/**
 * Builds runtime configuration from an injected environment. Secret values are
 * supplied only through the environment and are never returned by the API.
 */
export function loadConfig(env = process.env) {
  return Object.freeze({
    nodeEnv: readNonEmpty(env.NODE_ENV, "NODE_ENV", DEFAULTS.nodeEnv),
    webHost: readNonEmpty(env.EDITLOOM_WEB_HOST, "EDITLOOM_WEB_HOST", DEFAULTS.webHost),
    webPort: readPort(env.EDITLOOM_WEB_PORT, "EDITLOOM_WEB_PORT", DEFAULTS.webPort),
    apiHost: readNonEmpty(env.EDITLOOM_API_HOST, "EDITLOOM_API_HOST", DEFAULTS.apiHost),
    apiPort: readPort(env.EDITLOOM_API_PORT, "EDITLOOM_API_PORT", DEFAULTS.apiPort),
    queuePollMs: readPositiveInteger(env.EDITLOOM_QUEUE_POLL_MS, "EDITLOOM_QUEUE_POLL_MS", DEFAULTS.queuePollMs),
    storageRoot: readNonEmpty(env.EDITLOOM_STORAGE_ROOT, "EDITLOOM_STORAGE_ROOT", DEFAULTS.storageRoot),
    databaseUrl: readOptionalNonEmpty(env.DATABASE_URL, "DATABASE_URL")
  });
}

// debug-log.mjs
// Derivado de V0v1kkk/openviking-antigravity-memory (MIT).
// Cambio: TODO lo que se escribe al log pasa por redactSecrets() y por el
// scrubbing explícito de la API key de la sesión. El original escribía el
// payload tal cual (el test de redacción no lo detectaba porque nunca le
// pasaba la clave a log()).

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { redactSecrets } from "./capture-utils.mjs";

function ensureDir(filePath) {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
  } catch {
    /* best effort */
  }
}

function writeLine(filePath, line) {
  try {
    appendFileSync(filePath, `${line}\n`);
  } catch {
    /* best effort */
  }
}

function localISO() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  const sign = off <= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().replace(
    "Z",
    `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`,
  );
}

function scrub(value, secret) {
  let text;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  text = redactSecrets(text);
  if (secret && secret.length >= 8) text = text.split(secret).join("[REDACTED_API_KEY]");
  return text;
}

const noop = () => {};

export function createLogger(hookName, overrideCfg) {
  const c = overrideCfg || {};
  if (!c.debug) return { log: noop, logError: noop };

  const logPath = c.debugLogPath;
  if (!logPath) return { log: noop, logError: noop };
  ensureDir(logPath);

  const secret = c.apiKey;

  function log(stage, data) {
    writeLine(logPath, scrub({ ts: localISO(), hook: hookName, stage, data }, secret));
  }

  function logError(stage, err) {
    const error =
      err instanceof Error ? { message: err.message, stack: err.stack } : String(err);
    writeLine(logPath, scrub({ ts: localISO(), hook: hookName, stage, error }, secret));
  }

  return { log, logError };
}

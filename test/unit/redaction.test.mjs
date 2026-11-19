// Test de redacción REAL. El original era vacuo: construía el logger con
// apiKey pero nunca le pasaba la clave a log(), así que la aserción no podía
// fallar nunca. Aquí se prueban las dos vías: log y texto capturado.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLogger } from "../../scripts/shared/debug-log.mjs";
import { sanitizeCapturedText, redactSecrets } from "../../scripts/shared/capture-utils.mjs";

const KEY = "sk-proj-AbCdEf0123456789XyZ";

describe("redaction: logs", () => {
  let tempDir;
  let logPath;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ag-redact-test-"));
    logPath = join(tempDir, "hooks.jsonl");
  });

  after(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it("no escribe la API key aunque se pase dentro del payload", async () => {
    const logger = createLogger("test-scope", {
      debug: true,
      debugLogPath: logPath,
      apiKey: KEY,
    });

    // Caso realista: la clave viaja dentro de los datos del evento.
    logger.log("test_event", { status: "ok", headers: { Authorization: `Bearer ${KEY}` }, key: KEY });

    const content = await readFile(logPath, "utf-8");
    assert.ok(!content.includes(KEY), "la API key no debe aparecer en el log");
    assert.ok(!content.includes("AbCdEf0123456789XyZ"), "no debe quedar ningún fragmento de la clave");
    assert.ok(content.includes("test_event"));
  });

  it("redacta tokens con formato de secreto en el log", async () => {
    const logger = createLogger("test-scope", { debug: true, debugLogPath: logPath });
    logger.log("gh", { token: "ghp_0123456789abcdefghijABCDEFGHIJ012345", env: "AWS_KEY=AKIAIOSFODNN7EXAMPLE" });

    const content = await readFile(logPath, "utf-8");
    assert.ok(!content.includes("ghp_0123456789abcdefghijABCDEFGHIJ012345"));
    assert.ok(!content.includes("AKIAIOSFODNN7EXAMPLE"));
  });
});

describe("redaction: texto capturado", () => {
  it("redacta claves sk-, Bearer, JWT, PEM y líneas .env", () => {
    const samples = [
      `mi clave es ${KEY} y ya`,
      "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop",
      "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----",
      "OPENVIKING_API_KEY=abcdef1234567890",
      "password = 'supersecretopass'",
    ];
    const out = samples.map((s) => sanitizeCapturedText(s)).join("\n");
    assert.ok(!out.includes(KEY), "sk- debe redactarse");
    assert.ok(!out.includes("eyJhbGciOiJIUzI1NiJ9"), "JWT debe redactarse");
    assert.ok(!out.includes("MIIEvQIBADANBg"), "PEM debe redactarse");
    assert.ok(!out.includes("abcdef1234567890"), "línea .env debe redactarse");
    assert.ok(!out.includes("supersecretopass"), "password debe redactarse");
    assert.ok(out.includes("[REDACTED"), "debe quedar una marca de redacción");
  });

  it("no toca texto normal (control de falsos positivos)", () => {
    const normal = "La clave del problema es el rendimiento del servidor y el token de diseño.";
    const out = sanitizeCapturedText(normal);
    assert.equal(out, normal);
  });

  it("redactSecrets es idempotente", () => {
    const once = redactSecrets(`key=${KEY}`);
    assert.equal(redactSecrets(once), once);
  });
});

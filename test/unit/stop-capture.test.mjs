// Captura real (hook Stop) contra un servidor HTTP simulado en puerto efímero.
//
// Antes solo se probaba el encolado por fallo de red (puerto muerto 19999), así
// que el camino feliz de /messages/batch, el umbral de commit y el payload de
// /commit nunca se ejercitaban. Esto no toca la memoria real del usuario.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleStopWorker } from "../../scripts/antigravity-hook.mjs";

const SECRET = "sk-proj-AbCdEf0123456789XyZ";

describe("captura real del hook Stop", () => {
  let server;
  let port;
  let dir;
  let transcript;
  let seen;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "ov-stop-"));
    mkdirSync(join(dir, "state"), { recursive: true });
    mkdirSync(join(dir, "pending"), { recursive: true });

    transcript = join(dir, "transcript.jsonl");
    await writeFile(
      transcript,
      [
        JSON.stringify({
          step_index: 0,
          source: "USER_EXPLICIT",
          type: "USER_INPUT",
          status: "DONE",
          content: `configura la memoria del plugin con la clave ${SECRET}`,
        }),
        JSON.stringify({
          step_index: 1,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          content: "Se instala el plugin y se apunta al servidor local del puerto 1933.",
        }),
      ].join("\n"),
    );

    seen = { batch: null, commit: null, sessionGets: 0 };

    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        let json = null;
        try {
          json = body ? JSON.parse(body) : null;
        } catch {
          json = null;
        }
        res.setHeader("Content-Type", "application/json");
        if (req.url.includes("/messages/batch")) {
          seen.batch = json;
          res.end(JSON.stringify({ status: "ok", result: { message_count: json.messages.length } }));
        } else if (req.url.includes("/commit")) {
          seen.commit = json;
          res.end(JSON.stringify({ status: "ok", result: { task_id: "task-prueba" } }));
        } else if (req.method === "GET") {
          seen.sessionGets += 1;
          res.end(JSON.stringify({ status: "ok", result: { pending_tokens: 99999 } }));
        } else {
          res.end(JSON.stringify({ status: "ok", result: {} }));
        }
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
  });

  const cfg = () => ({
    enabled: true,
    autoCapture: true,
    stateDir: join(dir, "state"),
    pendingDir: join(dir, "pending"),
    sessionPrefix: "ag-",
    commitTokenThreshold: 1,
    commitKeepRecentCount: 7,
    timeoutMs: 5000,
    userAgent: "openviking-antigravity-memory/test",
    captureMaxLength: 24000,
    debug: false,
  });

  const creds = () => ({
    baseUrl: `http://127.0.0.1:${port}`,
    apiKey: "",
    account: "",
    user: "",
    peerId: "antigravity",
  });

  it("envía los turnos, redacta el secreto y hace commit con keep_recent_count", async () => {
    await handleStopWorker(
      { conversationId: "conv-prueba", transcriptPath: transcript },
      cfg(),
      creds(),
      () => {},
    );

    assert.ok(seen.batch, "debe llamar a /messages/batch");
    assert.equal(seen.batch.messages.length, 2, "un turno de usuario y uno de asistente");

    const wire = JSON.stringify(seen.batch);
    assert.ok(!wire.includes(SECRET), "la clave no debe salir hacia OpenViking");
    assert.ok(wire.includes("[REDACTED_API_KEY]"), "debe ir la marca de redacción");

    assert.ok(seen.sessionGets >= 1, "debe consultar pending_tokens");
    assert.ok(seen.commit, "al superar el umbral debe hacer commit");
    assert.equal(seen.commit.keep_recent_count, 7, "el campo correcto del esquema 0.5.x");
    assert.ok(!("keep_recent_messages" in seen.commit), "no debe enviar el campo inexistente");
  });

  it("es idempotente: un segundo Stop no reenvía los mismos turnos", async () => {
    seen.batch = null;
    seen.commit = null;

    await handleStopWorker(
      { conversationId: "conv-prueba", transcriptPath: transcript },
      cfg(),
      creds(),
      () => {},
    );

    assert.equal(seen.batch, null, "no debe reenviar turnos ya capturados");
    assert.equal(seen.commit, null, "tampoco debe commitear de nuevo");
  });
});

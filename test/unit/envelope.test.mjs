// Regresión del bug más caro del plugin original: el sobre de respuesta.
// El hook leía result.entries sobre {status, result} y el auto-recall devolvía
// 0 entradas siempre, sin error visible.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { unwrapEnvelope } from "../../scripts/shared/ov-response.mjs";

describe("unwrapEnvelope", () => {
  it("desempaqueta /api/v1/* ({status, result})", () => {
    const body = { status: "ok", result: { entries: [{ uri: "viking://x" }], stats: {} }, error: null };
    const out = unwrapEnvelope(body);
    assert.deepEqual(Object.keys(out).sort(), ["entries", "stats"]);
    assert.equal(out.entries.length, 1);
  });

  it("deja intactas las respuestas planas (/health)", () => {
    const body = { status: "ok", healthy: true, version: "0.5.3", auth_mode: "dev" };
    const out = unwrapEnvelope(body);
    assert.equal(out.version, "0.5.3");
    assert.equal(out.healthy, true);
  });

  it("no toca arreglos ni cadenas", () => {
    assert.deepEqual(unwrapEnvelope([1, 2]), [1, 2]);
    assert.equal(unwrapEnvelope("texto"), "texto");
    assert.equal(unwrapEnvelope(null), null);
  });

  it("no confunde un result legítimo anidado dos veces", () => {
    const body = { status: "ok", result: { result: "interno" } };
    assert.deepEqual(unwrapEnvelope(body), { result: "interno" });
  });
});

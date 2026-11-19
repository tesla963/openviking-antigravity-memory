// Extractor de turnos desde las bases de conversaciones de Antigravity.
//
// Las bases (~/.gemini/antigravity/conversations/*.db y las del CLI) guardan los
// pasos en protobuf. Verificado contra el binario de Antigravity
// (`trajectory_steps_go_proto`) y sobre 57 bases reales:
//
//   step_type = 14 (user_input)  -> payload.19.2  = texto del usuario
//   step_type = 15 (planner)     -> payload.20.1  = texto del asistente
//                                   payload.20.3  = thinking (SE DESCARTA)
//                                   payload.20.7  = llamada de herramienta (fuera)
//   step_type = 90 / 17 / 101 / 132  -> sistema, checkpoints, herramientas (fuera)
//   status != 3  -> paso cancelado o fallido (fuera)
//
// Sólo lectura: se abre con immutable=1 para no tocar el WAL de Antigravity.

import { DatabaseSync } from "node:sqlite";

const USER_STEP = 14;
const ASSISTANT_STEP = 15;
const STATUS_DONE = 3;

function readVarint(buf, i) {
  let result = 0;
  let shift = 0;
  for (;;) {
    if (i >= buf.length) throw new RangeError("varint truncado");
    const byte = buf[i++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [result, i];
    shift += 7;
    if (shift > 63) throw new RangeError("varint demasiado largo");
  }
}

/** Devuelve { fieldNumber: Buffer | number } del primer nivel de un mensaje. */
export function decodeFields(buf) {
  const out = {};
  let i = 0;
  while (i < buf.length) {
    let key;
    [key, i] = readVarint(buf, i);
    const field = key >> 3;
    const wire = key & 7;
    if (wire === 0) {
      let v;
      [v, i] = readVarint(buf, i);
      out[field] = v;
    } else if (wire === 2) {
      let len;
      [len, i] = readVarint(buf, i);
      out[field] = buf.subarray(i, i + len);
      i += len;
    } else if (wire === 5) {
      i += 4;
    } else if (wire === 1) {
      i += 8;
    } else {
      break;
    }
  }
  return out;
}

function textFrom(buf) {
  if (!buf || typeof buf === "number") return "";
  return buf.toString("utf8").trim();
}

function timestampFrom(metadata) {
  if (!metadata || typeof metadata === "number") return null;
  const outer = decodeFields(metadata);
  const inner = outer[5];
  if (!inner || typeof inner === "number") return null;
  const time = decodeFields(inner);
  const seconds = time[1];
  if (typeof seconds !== "number" || seconds < 1_000_000_000) return null;
  return new Date(seconds * 1000).toISOString();
}

/**
 * Extrae los turnos conversacionales de una base.
 * @returns {{idx:number, role:"user"|"assistant", content:string, createdAt:string|null}[]}
 */
export function extractTurnsFromDb(dbPath, { minChars = 20 } = {}) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db
      .prepare(
        "SELECT idx, step_type, step_payload, metadata FROM steps " +
          "WHERE step_type IN (?, ?) AND status = ? ORDER BY idx ASC",
      )
      .all(USER_STEP, ASSISTANT_STEP, STATUS_DONE);

    const turns = [];
    for (const row of rows) {
      const payload = row.step_payload;
      if (!payload) continue;
      const outer = decodeFields(payload);
      let text = "";
      let role = null;

      if (row.step_type === USER_STEP) {
        const body = outer[19];
        if (body && typeof body !== "number") text = textFrom(decodeFields(body)[2]);
        role = "user";
      } else if (row.step_type === ASSISTANT_STEP) {
        const body = outer[20];
        if (body && typeof body !== "number") text = textFrom(decodeFields(body)[1]);
        role = "assistant";
      }

      if (!role || text.length < minChars) continue;
      turns.push({
        idx: Number(row.idx),
        role,
        content: text,
        createdAt: timestampFrom(row.metadata),
      });
    }
    return turns;
  } finally {
    db.close();
  }
}

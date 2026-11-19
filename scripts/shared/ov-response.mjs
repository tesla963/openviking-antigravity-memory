// Desempaquetado de respuestas de OpenViking.
//
// /health responde plano:            {"status":"ok","healthy":true,"version":"0.5.3"}
// /api/v1/* responde con sobre:      {"status":"ok","result":{...},"error":null}
//
// El plugin original devolvía el cuerpo completo y luego leía `result.entries`
// sobre el sobre, así que el auto-recall SIEMPRE obtenía 0 entradas y el hook
// respondía {} sin error. Este módulo existe para que ese contrato tenga una
// sola implementación y una prueba que lo cubra.

export function unwrapEnvelope(body) {
  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    Object.prototype.hasOwnProperty.call(body, "status") &&
    Object.prototype.hasOwnProperty.call(body, "result")
  ) {
    return body.result;
  }
  return body;
}

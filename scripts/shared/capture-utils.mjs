// capture-utils.mjs
// Derivado de V0v1kkk/openviking-antigravity-memory (MIT, Vladimir Rogozhin).
//
// PODA: se eliminan ~340 líneas inalcanzables en este plugin (AST y formateo de
// bloques de herramientas: normalizeType/isToolCallBlock/buildToolPart/
// extractTextFromContent/extractTextFromPayload/extractPartsFromPayload/
// extractCaptureTurns/normalizeCaptureRole/...) que nunca se llaman desde
// antigravity-transcript.mjs; la captura descarta tool_calls y tool_results.
//
// AÑADIDO: redacción de secretos antes de que el texto entre a la memoria,
// porque una clave pegada en el chat se guardaba tal cual.

const ACK_RE =
  /^(?:ok|okay|k|yes|yep|no|nope|thanks|thank you|thx|done|收到|好的|好|嗯|可以|继续|不用|不需要|没了|好了)[.!?。！？\s]*$/i;
const SLASH_COMMAND_RE = /^\/[a-z0-9_-]{1,64}\b/i;

const METADATA_KEYS = [
  "session_id",
  "sessionid",
  "sessionkey",
  "conversation_id",
  "conversationid",
  "channel",
  "sender",
  "user_id",
  "userid",
  "agent_id",
  "agentid",
  "timestamp",
  "timezone",
  "cwd",
  "model",
  "permission_mode",
];

// --- utilidades mínimas ------------------------------------------------------

function oneLine(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

export function truncateCaptureText(text, maxChars = 2000) {
  const value = String(text || "").trim();
  if (!Number.isFinite(maxChars) || maxChars <= 0 || value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 20)).trimEnd()}\n[truncated]`;
}

function stripMetadataFences(text) {
  return String(text || "").replace(/```(?:json)?\s*([\s\S]*?)```/gi, (match, body) => {
    const lower = body.toLowerCase();
    let hits = 0;
    for (const key of METADATA_KEYS) {
      const re = new RegExp(`["']?${key}["']?\\s*:`, "i");
      if (re.test(lower)) hits += 1;
    }
    return hits >= 3 ? "" : match;
  });
}

function stripInjectedDigestBlocks(text) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  let skipping = false;
  let skipUntilMcpHint = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^OpenViking session archive digest:/i.test(trimmed)) {
      skipping = true;
      skipUntilMcpHint = true;
      continue;
    }
    if (/^OpenViking memory digest:/i.test(trimmed)) {
      skipping = true;
      skipUntilMcpHint = false;
      continue;
    }
    if (skipping) {
      if (skipUntilMcpHint) {
        if (/^More detail: use the OpenViking MCP /i.test(trimmed)) {
          skipping = false;
          skipUntilMcpHint = false;
        }
        continue;
      }
      if (!trimmed) {
        skipping = false;
        continue;
      }
      if (
        /^(?:[-*]\s+|#{1,6}\s+|More detail:|Use OpenViking MCP|Latest committed archive|Resume continuity|viking:\/\/)/i.test(
          trimmed,
        ) ||
        /^\s{2,}\S/.test(line)
      ) {
        continue;
      }
      skipping = false;
    }
    out.push(line);
  }

  return out.join("\n");
}

// --- redacción de secretos ---------------------------------------------------
// Se aplica al texto capturado (no a los logs, que ya se redactan aparte).

export const SECRET_PATTERNS = [
  // Claves privadas PEM completas
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    "[REDACTED_PRIVATE_KEY]"],
  // JWT
  [/\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, "[REDACTED_JWT]"],
  // OpenAI / Anthropic / OpenRouter / DeepSeek
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_API_KEY]"],
  // GitHub
  [
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    "[REDACTED_GITHUB_TOKEN]",
  ],
  // AWS
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]"],
  // Google API key
  [/\bAIza[0-9A-Za-z_-]{30,}\b/g, "[REDACTED_GOOGLE_KEY]"],
  // Slack
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED_SLACK_TOKEN]"],
  // Authorization: Bearer <token>
  [/\b(Bearer\s+)(?=[A-Za-z0-9\-._~+/]{12,})(?:[A-Za-z0-9\-._~+/]*(?:\d)[A-Za-z0-9\-._~+/]*|[A-Za-z0-9\-._~+/]{32,})=*/gi, "$1[REDACTED_BEARER]"],
  // asignaciones api_key = "...", token: "...", password=...
  [
    /\b(api[_-]?key|apikey|secret[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|password|passwd|pwd)\b(\s*[:=]\s*)(["']?)([^\s"',;]{6,})\3/gi,
    "$1$2$3[REDACTED]$3",
  ],
  // líneas estilo .env con nombre sensible
  [
    /^(\s*[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL)[A-Z0-9_]*\s*=\s*)(\S{6,})\s*$/gm,
    "$1[REDACTED]",
  ],
];

export function redactSecrets(text) {
  let value = String(text || "");
  for (const [re, replacement] of SECRET_PATTERNS) value = value.replace(re, replacement);
  return value;
}

// --- API del plugin ----------------------------------------------------------

export function sanitizeCapturedText(text) {
  let value = String(text || "");
  value = value
    .replace(/\u0000/g, "")
    .replace(/<openviking-context\b[^>]*>[\s\S]*?<\/openviking-context>/gi, " ")
    .replace(/<relevant-memor(?:y|ies)\b[^>]*>[\s\S]*?<\/relevant-memor(?:y|ies)>/gi, " ")
    .replace(/^\s*Sender\s*\([^)]+\)\s*```[\s\S]*?```\s*/gim, " ")
    .replace(/^\s*Conversation (?:metadata|info):\s*```[\s\S]*?```\s*/gim, " ")
    .replace(/^\s*\[?\d{4}-\d{2}-\d{2}[T ][^\]\n]{3,80}\]?\s*/gm, "")
    .replace(/^\s*\d{10,13}\s+/gm, "");
  value = stripMetadataFences(value);
  value = stripInjectedDigestBlocks(value);
  value = value.replace(/^\s*More detail: use the OpenViking MCP .*$/gim, " ");
  value = redactSecrets(value);
  return value
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hasEnoughSignal(text) {
  const cjk = text.match(/[\u3400-\u9fff]/g)?.length || 0;
  const alnum = text.match(/[a-z0-9]/gi)?.length || 0;
  return cjk >= 4 || alnum >= 6 || text.length >= 12;
}

function isPunctuationOnly(text) {
  return !/[a-z0-9\u3400-\u9fff]/i.test(text);
}

export function shouldCaptureText(text, role, cfg = {}) {
  const maxLength = cfg.captureMaxLength || 24000;
  const sanitized = sanitizeCapturedText(text);
  if (!sanitized) return { shouldCapture: false, reason: "empty", text: "" };

  const capped = truncateCaptureText(sanitized, maxLength);
  const compact = oneLine(capped);
  const isToolSummary = /^\[tool-(?:call|result)\b/i.test(compact);

  if (!isToolSummary && role === "user" && SLASH_COMMAND_RE.test(compact)) {
    return { shouldCapture: false, reason: "slash_command", text: "" };
  }
  if (!isToolSummary && ACK_RE.test(compact)) {
    return { shouldCapture: false, reason: "ack", text: "" };
  }
  if (!isToolSummary && isPunctuationOnly(compact)) {
    return { shouldCapture: false, reason: "punctuation", text: "" };
  }
  if (!isToolSummary && !hasEnoughSignal(compact)) {
    return { shouldCapture: false, reason: "too_short", text: "" };
  }
  if (/^\[openviking-memory\]/i.test(compact)) {
    return { shouldCapture: false, reason: "plugin_status", text: "" };
  }

  return { shouldCapture: true, reason: "ok", text: capped };
}

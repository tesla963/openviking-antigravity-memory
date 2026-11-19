#!/usr/bin/env node

/**
 * Maintenance & Diagnostics CLI for OpenViking Antigravity Plugin
 *
 * Usage:
 *   node manage.mjs status
 *   node manage.mjs list
 *   node manage.mjs flush [conversationId]
 *   node manage.mjs replay
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.mjs";
import { unwrapEnvelope } from "./shared/ov-response.mjs";
import { resolveOpenVikingCredentials } from "./shared/credentials.mjs";
import { listPending, replayPending } from "./shared/pending-queue.mjs";
import { sendSessionMessages } from "./shared/batch-send.mjs";
import { shouldCaptureText } from "./shared/capture-utils.mjs";
import { computeTurnHash } from "./antigravity-transcript.mjs";
import { extractTurnsFromDb } from "./shared/sqlite-transcript.mjs";

const CONVERSATION_DIRS = [
  join(homedir(), ".gemini", "antigravity", "conversations"),
  join(homedir(), ".gemini", "antigravity-cli", "conversations"),
];

function redactKey(key) {
  if (!key) return "<none>";
  if (key.length <= 8) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function makeFetchJSON(creds, cfg) {
  return async function fetchJSON(apiPath, init = {}) {
    const baseUrl = (creds.baseUrl || "http://127.0.0.1:1933").replace(/\/+$/, "");
    const url = `${baseUrl}${apiPath.startsWith("/") ? apiPath : `/${apiPath}`}`;
    const headers = {
      "Content-Type": "application/json",
      "User-Agent": cfg.userAgent || "openviking-antigravity-memory/0.1.0",
      ...(init.headers || {}),
    };
    if (creds.apiKey) headers["Authorization"] = `Bearer ${creds.apiKey}`;
    if (creds.account) headers["X-OpenViking-Account"] = creds.account;
    if (creds.user) headers["X-OpenViking-User"] = creds.user;
    if (creds.peerId || cfg.actorPeerId) headers["X-OpenViking-Actor-Peer"] = creds.peerId || cfg.actorPeerId;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs || 15000);
    try {
      const res = await fetch(url, { ...init, headers, signal: controller.signal });
      const text = await res.text();
      let result = null;
      try { result = JSON.parse(text); } catch { result = text; }
      // Ver nota en antigravity-hook.mjs: /api/v1/* viene envuelto en {status, result}.
      const payload = unwrapEnvelope(result);
      return { ok: res.ok, status: res.status, result: res.ok ? payload : undefined, error: !res.ok ? (result?.error?.message || result?.detail || result || `HTTP ${res.status}`) : undefined };
    } catch (err) {
      return { ok: false, status: 0, error: err?.message || String(err) };
    } finally {
      clearTimeout(timer);
    }
  };
}

async function getPluginSessions(stateDir) {
  const files = await readdir(stateDir).catch(() => []);
  const sessions = [];
  for (const f of files) {
    if (!f.startsWith("session_") || !f.endsWith(".json")) continue;
    try {
      const content = await readFile(join(stateDir, f), "utf-8");
      const state = JSON.parse(content);
      if (state?.conversationId) {
        sessions.push(state);
      }
    } catch {}
  }
  return sessions;
}

async function cmdStatus(cfg, creds) {
  const fetchJSON = makeFetchJSON(creds, cfg);
  const healthRes = await fetchJSON("/health");
  const statusRes = await fetchJSON("/api/v1/system/status");
  const pending = await listPending();
  const sessions = await getPluginSessions(cfg.stateDir);

  console.log("=== OpenViking Antigravity Plugin Status ===");
  console.log(`Server URL:         ${creds.baseUrl}`);
  console.log(`Server Healthy:     ${healthRes.ok ? "YES (v" + (healthRes.result?.version || "unknown") + ")" : "NO (" + (healthRes.error || "unreachable") + ")"}`);
  console.log(`Auth Mode:          ${healthRes.result?.auth_mode || "unknown"}`);
  console.log(`Account:            ${creds.account || "<none>"}`);
  console.log(`User:               ${creds.user || "<none>"}`);
  console.log(`API Key:            ${redactKey(creds.apiKey)}`);
  console.log(`Credential Source:  ${creds.credentialSource} (${creds.cliPath || "none"})`);
  console.log(`Actor Peer ID:      ${creds.peerId || cfg.actorPeerId}`);
  console.log(`Session Prefix:     ${cfg.sessionPrefix}`);
  console.log(`Pending Queue:      ${pending.length} item(s) in ${cfg.pendingDir}`);
  console.log(`Tracked Sessions:   ${sessions.length} session(s) in ${cfg.stateDir}`);
  console.log(`Log File:           ${cfg.debugLogPath}`);
  console.log(`System Status API:  ${statusRes.ok ? "OK" : "Error (" + statusRes.error + ")"}`);
}

async function cmdList(cfg, creds) {
  const pending = await listPending();
  const sessions = await getPluginSessions(cfg.stateDir);

  console.log(`=== Tracked Antigravity Sessions (${sessions.length}) ===`);
  for (const s of sessions) {
    console.log(`- Conversation ID:  ${s.conversationId}`);
    console.log(`  Session ID:       ${cfg.sessionPrefix}${s.conversationId}`);
    console.log(`  Captured Turns:   ${s.capturedHashes?.length || 0}`);
    console.log(`  Last Activity:    ${new Date(s.lastActivityAt || s.createdAt).toISOString()}`);
    console.log(`  Last Committed:   ${s.lastCommittedAt ? new Date(s.lastCommittedAt).toISOString() : "never"}`);
  }

  console.log(`\n=== Pending Queue Items (${pending.length}) ===`);
  for (const p of pending) {
    console.log(`- File: ${p.filename} | Type: ${p.entry.type} | Session: ${p.entry.sessionId} | Retries: ${p.entry.retries || 0}`);
  }
}

async function cmdFlush(cfg, creds, targetConversationId) {
  const fetchJSON = makeFetchJSON(creds, cfg);
  console.log("Replaying pending offline queue...");
  const replayResult = await replayPending(fetchJSON, (cat, d) => console.log(`[replay] ${cat}:`, d));
  console.log(`Replayed: ${replayResult.replayed}, Failed: ${replayResult.failed}, Skipped: ${replayResult.skipped}, Deferred: ${replayResult.deferred}`);

  const sessions = await getPluginSessions(cfg.stateDir);
  const filtered = targetConversationId
    ? sessions.filter((s) => s.conversationId === targetConversationId || `${cfg.sessionPrefix}${s.conversationId}` === targetConversationId)
    : sessions;

  console.log(`Flushing/committing ${filtered.length} session(s)...`);
  for (const s of filtered) {
    const sid = `${cfg.sessionPrefix}${s.conversationId}`;
    console.log(`Committing session ${sid}...`);
    const res = await fetchJSON(`/api/v1/sessions/${encodeURIComponent(sid)}/commit`, {
      method: "POST",
      body: JSON.stringify({ keep_recent_count: cfg.commitKeepRecentCount }),
    });
    if (res.ok) {
      console.log(`  -> Success (task: ${res.result?.task_id || "ok"})`);
    } else {
      console.log(`  -> Failed: ${res.error}`);
    }
  }
}

async function cmdReplay(cfg, creds) {
  const fetchJSON = makeFetchJSON(creds, cfg);
  console.log("Replaying pending queue items...");
  const result = await replayPending(fetchJSON, (cat, d) => console.log(`[replay] ${cat}:`, d));
  console.log(`Done. Replayed: ${result.replayed}, Failed: ${result.failed}, Skipped: ${result.skipped}, Deferred: ${result.deferred}`);
}

function backfillStatePath(cfg, conversationId) {
  return join(cfg.stateDir, `session_${conversationId}.json`);
}

async function loadBackfillState(cfg, conversationId) {
  try {
    const data = JSON.parse(await readFile(backfillStatePath(cfg, conversationId), "utf-8"));
    return { data, hashes: new Set(Array.isArray(data.capturedHashes) ? data.capturedHashes : []) };
  } catch {
    return { data: { conversationId }, hashes: new Set() };
  }
}

/**
 * Vuelca a OpenViking las conversaciones históricas de Antigravity (IDE y CLI).
 *
 * Idempotente por diseño: usa los mismos hashes y el mismo archivo de estado que
 * el hook Stop, así que un panel ya capturado en vivo nunca se duplica.
 * `--dry-run` no escribe nada en el servidor.
 */
async function cmdBackfill(cfg, creds, args = []) {
  const dryRun = args.includes("--dry-run");
  const onlyArg = args.map((a) => /^--only=(.+)$/.exec(a)).find(Boolean);
  const only = onlyArg ? onlyArg[1] : null;
  const fetchJSON = makeFetchJSON(creds, cfg);

  const rows = [];
  const totals = { user: 0, assistant: 0, chars: 0, skipped: 0, conversations: 0 };

  for (const dir of CONVERSATION_DIRS) {
    let files = [];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith(".db"));
    } catch {
      continue;
    }
    for (const file of files.sort()) {
      const conversationId = file.replace(/\.db$/, "");
      if (only && conversationId !== only) continue;

      let turns = [];
      try {
        turns = extractTurnsFromDb(join(dir, file));
      } catch (err) {
        console.error(`  ! ${conversationId}: ${err.message}`);
        continue;
      }
      if (turns.length === 0) continue;

      const { data, hashes } = await loadBackfillState(cfg, conversationId);
      const kept = [];
      for (const turn of turns) {
        const verdict = shouldCaptureText(turn.content, turn.role, cfg);
        if (!verdict.shouldCapture) {
          totals.skipped += 1;
          continue;
        }
        const hash = computeTurnHash(conversationId, turn.idx, turn.role, verdict.text);
        if (hashes.has(hash)) {
          totals.skipped += 1;
          continue;
        }
        kept.push({
          hash,
          role: turn.role,
          content: verdict.text,
          created_at: turn.createdAt || undefined,
        });
      }
      if (kept.length === 0) continue;

      const chars = kept.reduce((n, k) => n + k.content.length, 0);
      rows.push({ conversationId, dir, turns: turns.length, kept, chars, data, hashes });
      totals.conversations += 1;
      totals.chars += chars;
      for (const k of kept) totals[k.role] += 1;
    }
  }

  console.log(`\n=== Backfill de paneles de Antigravity ${dryRun ? "(DRY RUN, no se envía nada)" : ""} ===\n`);
  for (const row of rows) {
    const kind = row.dir.includes("antigravity-cli") ? "CLI" : "IDE";
    console.log(
      `  ${kind}  ${row.conversationId}  ${String(row.kept.length).padStart(3)} turnos  ${row.chars.toLocaleString()} chars`,
    );
  }
  if (rows.length === 0) {
    console.log("  (nada nuevo que volcar)");
    return;
  }

  const tokens = Math.round(totals.chars / 4);
  console.log(
    `\n  Conversaciones: ${totals.conversations} · user ${totals.user} · asistente ${totals.assistant}` +
      ` · ${totals.chars.toLocaleString()} chars ≈ ${tokens.toLocaleString()} tokens · omitidos ${totals.skipped}`,
  );

  if (dryRun) {
    console.log("\n  Nada enviado. Revisa los números y vuelve a correr sin --dry-run para aplicar.\n");
    return;
  }

  await mkdir(cfg.stateDir, { recursive: true, mode: 0o700 });
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const sessionId = `${cfg.sessionPrefix}${row.conversationId}`;
    const payloads = row.kept.map(({ role, content, created_at }) => ({
      role,
      content,
      ...(created_at ? { created_at } : {}),
    }));
    const result = await sendSessionMessages(fetchJSON, sessionId, payloads);
    sent += result.sent;
    failed += result.failed;

    if (result.sent > 0) {
      await fetchJSON(`/api/v1/sessions/${encodeURIComponent(sessionId)}/commit`, {
        method: "POST",
        body: JSON.stringify({ keep_recent_count: 0 }),
      });
      for (const k of row.kept.slice(0, result.sent)) row.hashes.add(k.hash);
      await writeFile(
        backfillStatePath(cfg, row.conversationId),
        `${JSON.stringify(
          {
            ...row.data,
            conversationId: row.conversationId,
            capturedHashes: [...row.hashes].slice(-500),
            lastBackfillAt: Date.now(),
          },
          null,
          2,
        )}\n`,
        { mode: 0o600 },
      );
    }
    console.log(`  → ${sessionId}: ${result.sent} enviados, ${result.failed} fallidos`);
  }
  console.log(`\n  Total: ${sent} mensajes enviados, ${failed} fallidos. El commit es asíncrono.\n`);
}

async function main() {
  const cmd = (process.argv[2] || "status").toLowerCase();
  const cfg = loadConfig();
  const creds = resolveOpenVikingCredentials({
    ...process.env,
    OPENVIKING_CLI_CONFIG_FILE: cfg.cliConfigFile,
  });

  switch (cmd) {
    case "status":
      await cmdStatus(cfg, creds);
      break;
    case "list":
      await cmdList(cfg, creds);
      break;
    case "flush":
      await cmdFlush(cfg, creds, process.argv[3]);
      break;
    case "replay":
      await cmdReplay(cfg, creds);
      break;
    case "backfill":
      await cmdBackfill(cfg, creds, process.argv.slice(3));
      break;
    default:
      console.error(
        `Unknown command: ${cmd}. Available: status, list, flush, replay, backfill [--dry-run] [--only=<id>]`,
      );
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Management command failed:", err);
  process.exitCode = 1;
});

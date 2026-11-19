#!/usr/bin/env node
/**
 * Instalador idempotente y portable del plugin OpenViking Memory para Antigravity.
 *
 * Derivado de V0v1kkk/openviking-antigravity-memory (MIT). Cambios:
 *  - Sin rutas de Linux del autor: todo se resuelve con homedir().
 *  - Sin registro de tenants ni claves ajenas: soporta auth_mode "dev".
 *  - Sin `rm -rf`: el reemplazo es un rename atómico y el anterior va a backups/.
 *  - Genera hooks.json y mcp_config.json con rutas absolutas reales.
 *  - `--dry-run` valida y muestra el plan sin escribir nada.
 *
 * Uso:
 *   node scripts/install.mjs [--dry-run] [--test] [--plugin-dir <ruta>]
 *        [--url http://127.0.0.1:1933] [--api-key <clave>]
 *        [--account <cuenta>] [--user <usuario>]
 */

import { chmod, cp, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir, platform } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = resolvePath(join(__dirname, ".."));

const DEFAULTS = {
  url: process.env.OPENVIKING_URL || "http://127.0.0.1:1933",
  pluginDir: join(homedir(), ".gemini", "config", "plugins", "openviking-memory"),
  apiKey: process.env.OPENVIKING_API_KEY || "",
  account: process.env.OPENVIKING_ACCOUNT || "",
  user: process.env.OPENVIKING_USER || "",
};

const COLOR = process.stdout.isTTY;
const c = (code, s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const logStep = (m) => console.log(`${c(34, "[install]")} ${m}`);
const logOk = (m) => console.log(`${c(32, "[ok]")} ${m}`);
const logWarn = (m) => console.log(`${c(33, "[warn]")} ${m}`);
const logErr = (m) => console.error(`${c(31, "[error]")} ${m}`);

function parseArgs(argv) {
  const out = { ...DEFAULTS, dryRun: false, runTests: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--test") out.runTests = true;
    else if (a === "--plugin-dir") out.pluginDir = resolvePath(argv[++i]);
    else if (a === "--url") out.url = argv[++i];
    else if (a === "--api-key") out.apiKey = argv[++i];
    else if (a === "--account") out.account = argv[++i];
    else if (a === "--user") out.user = argv[++i];
    else if (a === "-h" || a === "--help") {
      console.log(
        "Uso: node scripts/install.mjs [--dry-run] [--test] [--plugin-dir RUTA]\n" +
          "     [--url URL] [--api-key CLAVE] [--account CUENTA] [--user USUARIO]",
      );
      process.exit(0);
    } else {
      throw new Error(`Argumento desconocido: ${a}`);
    }
  }
  out.url = out.url.replace(/\/+$/, "");
  return out;
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function checkHealth(url) {
  const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`/health respondió HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== "ok" && data.healthy !== true) {
    throw new Error(`servidor no saludable: ${JSON.stringify(data)}`);
  }
  return data;
}

function renderTemplate(template, vars) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : m,
  );
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const runtimeRoot = join(homedir(), ".openviking", "antigravity");
  const ovcliConf = join(runtimeRoot, "ovcli.conf");
  const backupsRoot = join(runtimeRoot, "backups");

  logStep(`Plataforma: ${platform()} · Node ${process.version}`);
  const major = Number(process.version.replace(/^v/, "").split(".")[0]);
  if (major < 18) throw new Error(`Node.js >= 18 requerido, encontrado ${process.version}`);
  logOk(`Node.js ${process.version}`);

  logStep(`Comprobando OpenViking en ${opts.url} ...`);
  const health = await checkHealth(opts.url);
  logOk(`OpenViking ${health.version || "?"} · auth_mode=${health.auth_mode || "desconocido"}`);

  const authMode = health.auth_mode || "unknown";
  const needsKey = authMode !== "dev";
  if (needsKey && !opts.apiKey) {
    throw new Error(
      `El servidor exige autenticación (auth_mode=${authMode}). Pasa --api-key o define OPENVIKING_API_KEY.`,
    );
  }
  if (!needsKey) logOk("auth_mode dev: no se requiere API key");

  const vars = {
    PLUGIN_DIR: opts.pluginDir,
    RUNTIME_DIR: runtimeRoot,
    OVCLI_CONF: ovcliConf,
    URL: opts.url,
    // Ruta absoluta al intérprete: Antigravity ejecuta los hooks con
    // /bin/sh -c, y ese shell no hereda el PATH del usuario. Con "node" a
    // secas el hook muere con `sh: node: command not found` (exit 127).
    NODE_BIN: process.execPath,
  };

  const itemsToCopy = [
    "plugin.json",
    "README.md",
    "DESIGN.md",
    "THIRD_PARTY_NOTICES.md",
    "LICENSE",
    "install.sh",
    "uninstall.sh",
    "servers",
    "scripts",
    "skills",
    "rules",
  ];

  if (opts.dryRun) {
    logStep("DRY RUN — no se escribe nada");
    console.log(`  plugin_dir : ${opts.pluginDir}`);
    console.log(`  runtime    : ${runtimeRoot}`);
    console.log(`  ovcli.conf : ${ovcliConf} (0600)`);
    console.log(`  backup dir : ${backupsRoot}`);
    console.log(`  copiaría   : ${itemsToCopy.join(", ")}`);
    console.log("  generar    : hooks.json, mcp_config.json (rutas absolutas)");
    return;
  }

  logStep("Preparando directorios de runtime (0700)...");
  for (const d of [
    runtimeRoot,
    join(runtimeRoot, "state"),
    join(runtimeRoot, "pending"),
    join(runtimeRoot, "logs"),
    backupsRoot,
  ]) {
    await mkdir(d, { recursive: true, mode: 0o700 });
    await chmod(d, 0o700);
  }

  const ovcliContent = {
    url: opts.url,
    api_key: opts.apiKey || "",
    account: opts.account || "",
    user: opts.user || "",
    actor_peer_id: "antigravity",
    peer_id: "antigravity",
  };
  await writeFile(ovcliConf, `${JSON.stringify(ovcliContent, null, 2)}\n`, { mode: 0o600 });
  await chmod(ovcliConf, 0o600);
  logOk(`Credenciales en ${ovcliConf} (0600)`);

  if (opts.runTests) {
    logStep("Ejecutando suite de pruebas...");
    await execFileAsync("node", ["--test", "test/unit/*.test.mjs"], {
      cwd: SOURCE_ROOT,
      env: { ...process.env, OPENVIKING_CLI_CONFIG_FILE: ovcliConf },
    });
    logOk("Pruebas en verde");
  }

  logStep("Preparando staging (junto al destino, para evitar EXDEV)...");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const staging = join(dirname(opts.pluginDir), `.openviking-memory-staging-${stamp}`);
  await mkdir(staging, { recursive: true, mode: 0o755 });

  for (const item of itemsToCopy) {
    const src = join(SOURCE_ROOT, item);
    if (!(await exists(src))) {
      logWarn(`omitido (no existe): ${item}`);
      continue;
    }
    await cp(src, join(staging, item), { recursive: true });
  }

  // Render de configuración con rutas absolutas reales
  for (const name of ["hooks.json", "mcp_config.json"]) {
    const tpl = await readFile(join(SOURCE_ROOT, name), "utf-8");
    await writeFile(join(staging, name), renderTemplate(tpl, vars), { mode: 0o644 });
  }
  logOk("hooks.json y mcp_config.json generados con rutas absolutas");

  for (const f of [
    "servers/mcp-proxy.mjs",
    "scripts/antigravity-hook.mjs",
    "scripts/manage.mjs",
    "install.sh",
    "uninstall.sh",
  ]) {
    await chmod(join(staging, f), 0o755).catch(() => {});
  }

  // Validación previa al reemplazo: el staging debe ser un plugin usable.
  logStep("Validando staging...");
  for (const name of ["hooks.json", "mcp_config.json"]) {
    const parsed = JSON.parse(await readFile(join(staging, name), "utf-8"));
    if (JSON.stringify(parsed).includes("{{")) {
      throw new Error(`${name} quedó con placeholders sin resolver`);
    }
  }
  for (const f of ["scripts/antigravity-hook.mjs", "servers/mcp-proxy.mjs", "plugin.json"]) {
    if (!(await exists(join(staging, f)))) throw new Error(`staging incompleto: falta ${f}`);
  }
  logOk("staging válido (JSON parseable, sin placeholders, scripts presentes)");

  logStep("Instalando (rename con rollback)...");
  await mkdir(dirname(opts.pluginDir), { recursive: true });
  let backupDir = null;
  try {
    if (await exists(opts.pluginDir)) {
      backupDir = join(backupsRoot, `openviking-memory-${stamp}`);
      await rename(opts.pluginDir, backupDir);
      logOk(`Instalación anterior movida a ${backupDir}`);
    }
    await rename(staging, opts.pluginDir);
  } catch (err) {
    if (backupDir && !(await exists(opts.pluginDir))) {
      await rename(backupDir, opts.pluginDir).catch(() => {});
      logWarn("Rollback aplicado: se restauró la instalación anterior");
    }
    if (await exists(staging)) {
      const failed = `${staging}.failed-${stamp}`;
      await rename(staging, failed).catch(() => {});
      logWarn(`Staging conservado para inspección: ${failed}`);
    }
    throw err;
  }
  logOk(`Plugin instalado en ${opts.pluginDir}`);

  console.log(`
Instalación completa.
  Plugin    : ${opts.pluginDir}
  Runtime   : ${runtimeRoot}
  OpenViking: ${opts.url} (auth_mode=${authMode})
  Diagnóstico: node ${join(opts.pluginDir, "scripts", "manage.mjs")} status
`);
}

main().catch((err) => {
  logErr(`Instalación fallida: ${err.message}`);
  process.exitCode = 1;
});

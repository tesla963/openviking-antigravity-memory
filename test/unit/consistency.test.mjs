// Guardas de regresión para el fork macOS.
// Estas pruebas existen porque los bugs originales eran silenciosos:
// rutas de Linux ajenas, campo de commit incorrecto y colas en carpetas
// distintas según quién las leyera.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function read(p) {
  return readFile(join(ROOT, p), "utf-8");
}

async function allScripts() {
  const out = [];
  for (const dir of ["scripts", "scripts/shared", "servers"]) {
    let entries;
    try {
      entries = await readdir(join(ROOT, dir));
    } catch {
      continue;
    }
    for (const f of entries.filter((n) => n.endsWith(".mjs"))) out.push(join(dir, f));
  }
  return out;
}

describe("portabilidad: sin rutas del autor", () => {
  it("hooks.json usa el intérprete absoluto, no 'node' a secas", async () => {
    const text = await read("hooks.json");
    assert.ok(
      text.includes("{{NODE_BIN}}"),
      "Antigravity ejecuta con /bin/sh -c, que no hereda el PATH: 'node' muere con exit 127",
    );
    const install = await read("scripts/install.mjs");
    assert.ok(install.includes("NODE_BIN: process.execPath"));
  });

  it("hooks.json y mcp_config.json usan placeholders, no /home/", async () => {
    for (const f of ["hooks.json", "mcp_config.json"]) {
      const text = await read(f);
      assert.ok(!text.includes("/home/"), `${f} no debe contener rutas /home/`);
      assert.ok(text.includes("{{PLUGIN_DIR}}"), `${f} debe usar {{PLUGIN_DIR}}`);
    }
  });

  it("instalador y desinstalador no tienen rutas /home/", async () => {
    for (const f of ["scripts/install.mjs", "uninstall.sh"]) {
      const text = await read(f);
      assert.ok(!text.includes("/home/"), `${f} no debe contener rutas /home/`);
    }
  });
});

describe("compatibilidad con OpenViking 0.5.x", () => {
  it("el commit usa keep_recent_count y no keep_recent_messages", async () => {
    for (const f of await allScripts()) {
      const text = await read(f);
      assert.ok(
        !text.includes("keep_recent_messages"),
        `${f} usa keep_recent_messages (campo inexistente en el esquema 0.5.x)`,
      );
    }
  });

  it("la cola pendiente vive en ~/.openviking/antigravity/pending", async () => {
    const text = await read("scripts/shared/pending-queue.mjs");
    assert.ok(
      text.includes('join(homedir(), ".openviking", "antigravity", "pending")'),
      "la cola debe coincidir con config.mjs y manage.mjs",
    );
  });
});

describe("seguridad de datos", () => {
  it("sanitizeCapturedText redacta secretos antes de capturar", async () => {
    const { sanitizeCapturedText } = await import("../../scripts/shared/capture-utils.mjs");
    const out = sanitizeCapturedText("token sk-ant-abcdefghijklmnopqrstuvwx");
    assert.ok(!out.includes("sk-ant-abcdefghijklmnopqrstuvwx"));
  });

  it("el instalador no borra recursivamente el plugin", async () => {
    const text = await read("scripts/install.mjs");
    assert.ok(!/\brm\s*\(/.test(text), "install.mjs no debe llamar a rm()");
    assert.ok(text.includes("rename("), "debe usar rename atómico");
  });

  it("el staging se crea junto al destino y hay rollback", async () => {
    const text = await read("scripts/install.mjs");
    assert.ok(
      text.includes(".openviking-memory-staging-"),
      "el staging debe vivir junto al plugin para evitar EXDEV",
    );
    assert.ok(!text.includes("join(runtimeRoot, `staging-"), "no debe usar runtimeRoot");
    assert.ok(text.includes("backupDir"), "debe restaurar el backup si falla el rename");
    assert.ok(text.includes("Rollback aplicado"), "debe registrar el rollback");
  });

  it("el hook resuelve credenciales con el ovcli.conf del plugin", async () => {
    const text = await read("scripts/antigravity-hook.mjs");
    assert.ok(text.includes("OPENVIKING_CLI_CONFIG_FILE: cfg.cliConfigFile"));
    assert.ok(
      text.includes("apiKey: creds.apiKey"),
      "el logger debe recibir la key para el scrub literal",
    );
  });

  it("uninstall crea el backup antes de condicionar", async () => {
    const text = await read("uninstall.sh");
    const mkdirAt = text.indexOf('mkdir -p "$BACKUP_DIR"');
    const ifAt = text.indexOf('if [[ -d "$PLUGIN_DIR" ]]');
    assert.ok(mkdirAt > 0 && ifAt > 0 && mkdirAt < ifAt);
  });

  it("el runtime se crea bajo el home del usuario", async () => {
    const text = await read("scripts/install.mjs");
    assert.ok(text.includes('join(homedir(), ".openviking", "antigravity")'));
  });
});

describe("entorno de prueba", () => {
  it("el home de este test es el del usuario real", () => {
    assert.ok(homedir().startsWith("/"));
  });
});

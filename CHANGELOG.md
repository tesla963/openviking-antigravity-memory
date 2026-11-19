# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-09-27 — backfill de paneles históricos

- Nuevo `scripts/shared/sqlite-transcript.mjs`: lee las bases de conversaciones de
  Antigravity (IDE y CLI) en solo lectura y decodifica el protobuf de los pasos.
  Campos verificados contra `trajectory_steps_go_proto` del binario:
  `type=14 → .19.2` (usuario), `type=15 → .20.1` (asistente); se descartan
  thinking (`.20.3`), herramientas (132), sistema (90/17/101) y pasos no completados.
- Nuevo comando `manage.mjs backfill [--dry-run] [--only=<id>]`: vuelca el
  histórico reutilizando el mismo hash y el mismo archivo de estado que el hook
  `Stop`, así que un panel ya capturado en vivo no se duplica.
- Los mensajes llevan `created_at` por turno cuando se puede leer del metadata,
  para que el pasado no se aplane en la fecha de hoy.
- **hooks.json usa la ruta absoluta del intérprete** (`process.execPath`):
  Antigravity ejecuta con `/bin/sh -c`, que no hereda el PATH; con `node` a secas
  el hook moría con `sh: node: command not found` (262 casos en el log, exit 127)
  y por eso no había ni una sola captura.

## [0.2.1] - 2026-09-27 — correcciones de la revisión de pares

Revisión hecha por Antigravity (Herdr, pane t19) sobre 544b841. Veredicto:
"aprobado con observaciones menores". Los 4 defectos que señaló eran reales y
están corregidos:

- **Credenciales**: el hook y `manage` llamaban a `resolveOpenVikingCredentials()`
  sin argumentos, así que leían `~/.openviking/ovcli.conf` mientras el instalador
  escribe en `~/.openviking/antigravity/ovcli.conf`. En `auth_mode: dev`
  funcionaba de casualidad; con API key habría dado 401. Ahora se pasa
  `OPENVIKING_CLI_CONFIG_FILE: cfg.cliConfigFile`.
- **Scrub de la API key en logs**: el logger recibía `cfg`, que no expone
  `apiKey`, así que el reemplazo literal nunca corría. Ahora recibe
  `{ ...cfg, apiKey: creds.apiKey }`.
- **`uninstall.sh --purge`**: `mkdir -p "$BACKUP_DIR"` estaba dentro del `if` del
  plugin, así que con el plugin ya ausente la purga fallaba en silencio. Movido
  antes del condicional.
- **Atomicidad del instalador**: el staging se creaba en `~/.openviking/...` y el
  destino en `~/.gemini/...` (riesgo EXDEV); y dos `rename` sin rollback podían
  dejar el plugin inexistente. Ahora el staging vive junto al destino, hay
  validación previa (JSON parseable, sin `{{` pendientes, scripts presentes) y
  rollback del backup si falla el segundo rename.
- **Redacción, falsos positivos**: la regla de Bearer censuraba prosa
  ("The Bearer authentication protocol"). Ahora exige token real (dígito o 32+
  caracteres). Y las contraseñas de 6-7 caracteres ya se redactan.

Pruebas: 33/33 (seis nuevas para estos casos).

## [0.2.0] - 2026-09-27 — fork macOS (tesla963)

Basado en 0.1.0 de Vladimir Rogozhin (MIT).

### Fixed
- **Auto-recall muerto**: `fetchJSON` devolvía el sobre completo `{status, result}`
  mientras `recall-core` leía `result.entries`, así que el recall obtenía 0
  entradas **siempre** y el hook respondía `{}` sin error. Ahora se desempaqueta
  con `unwrapEnvelope` (`scripts/shared/ov-response.mjs`). Verificado contra
  OpenViking 0.5.3: 10 entradas y 6.289 caracteres inyectados.
- **Commit con campo inexistente**: se enviaba `keep_recent_messages`; el
  esquema de 0.5.x espera `keep_recent_count` (3 sitios corregidos).
- **Cola offline en carpeta distinta** a la que reporta `manage.mjs` y purga
  `uninstall.sh`: ahora todo usa `~/.openviking/antigravity/pending`.
- **Redacción de secretos**: `capture-utils` y `debug-log` no redactaban nada.
  Ahora se filtran claves `sk-`, JWT, Bearer, PEM, tokens de GitHub/Slack/AWS/
  Google y líneas `.env` antes de que el texto entre a la memoria.
- **Test de redacción vacuo**: la aserción no podía fallar porque la clave nunca
  llegaba a `log()`. Reescrito con casos reales.

### Changed
- Instalador portable: sin rutas `/home/<autor>`, sin registro de tenants, con
  soporte `auth_mode: dev`, `--dry-run`, backup por `rename` atómico (sin
  `rm -rf`) y generación de `hooks.json`/`mcp_config.json` con rutas absolutas.
- Desinstalador portable: mueve a `backups/` en vez de borrar y purga **ambas**
  rutas de cola.
- `capture-utils.mjs`: 499 → ~215 líneas (se elimina el parser de bloques de
  herramientas, inalcanzable en este plugin).
- Nuevas pruebas: `consistency.test.mjs` y `envelope.test.mjs` (27 pruebas).

### Removed (pendiente de confirmación del dueño)
- `scripts/shared/{profile-inject,setup-wizard,plugin-config,session-model,uri-guard}.mjs`
  y `test/unit/session.test.mjs`: sin importadores. No se borraron por la regla
  de seguridad del entorno; ver `docs/FORK-NOTES.md`.

## [0.1.0] - 2026-08-17

### Added
- Native Antigravity 2.0 plugin integration for OpenViking memory.
- `PreInvocation` lifecycle hook: automatic memory recall before model turn with per-turn hash deduplication.
- `Stop` lifecycle hook: non-blocking fast exit (<500ms) with detached background worker for transcript parsing and message batching.
- Model Context Protocol (MCP) proxy: stdio-to-HTTP gateway for `search`, `read`, `find`, `remember`, and experience tools.
- Periodic session distillation policy (20k token threshold + 30-minute idle session sweep).
- Local offline resilient pending queue (`pending-queue.mjs`) with automatic replay.
- Idempotent automated installer (`install.sh` / `install.mjs`) and uninstaller (`uninstall.sh`).
- Comprehensive diagnostic and maintenance CLI (`scripts/manage.mjs`).
- Complete unit, integration, and identity-isolation test suite.

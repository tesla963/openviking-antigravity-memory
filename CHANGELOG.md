# Changelog

All notable changes to this project will be documented in this file.

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

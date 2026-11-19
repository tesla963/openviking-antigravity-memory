# Notas del fork (tesla963)

Fork de [`V0v1kkk/openviking-antigravity-memory`](https://github.com/V0v1kkk/openviking-antigravity-memory)
(MIT, © Vladimir Rogozhin). El aviso de copyright original se conserva en `LICENSE`.

## Qué se verificó antes de tocar código

- OpenViking 0.5.3 nativo en `127.0.0.1:1933`, `auth_mode: dev` (sin API key).
  **No hace falta Docker**: el plugin es un cliente HTTP del servidor local.
- Antigravity 2.14.0 soporta hooks globales de plugin en
  `~/.gemini/config/plugins/<nombre>/hooks.json` con los eventos
  `PreInvocation` / `Stop` que usa este plugin.

## El bug que importaba

`fetchJSON` devolvía el sobre completo de OpenViking:

```json
{ "status": "ok", "result": { "entries": [...] }, "error": null }
```

y `recall-core` leía `result.entries` sobre ese sobre → **0 entradas siempre**.
Consecuencia: el hook respondía `{}` (fail-open silencioso) y **el auto-recall
nunca inyectó nada**, en ninguna instalación. El commit también perdía el
`task_id` por la misma razón.

Arreglo: `scripts/shared/ov-response.mjs` → `unwrapEnvelope()`, con prueba en
`test/unit/envelope.test.mjs`.

Evidencia de la corrección contra el servidor real:

```
antes:  recall_context_assembled | {"entries": 0, ...}
después: recall_context_assembled | {"entries": 10, "usedTokens": 1552, ...}
        recall_injected | {"length": 6289}
```

## Diferencias con el upstream

| Área | Upstream 0.1.0 | Este fork 0.2.0 |
|---|---|---|
| Rutas | `/home/vladimir/...` fijas | `homedir()` + plantillas `{{PLUGIN_DIR}}` |
| Instalador | exige `tenant-keys.json` | `auth_mode: dev` sin claves; `--dry-run` |
| Reemplazo | `rm -rf` del plugin | `rename` atómico + `backups/` |
| Commit | `keep_recent_messages` | `keep_recent_count` |
| Cola | `~/.openviking/pending` (no coincide con `manage`) | `~/.openviking/antigravity/pending` |
| Secretos | sin redacción | `redactSecrets()` en captura y logs |
| Tests | 1 vacuo de redacción | 27, incluidos envoltorio y consistencia |

## Pendiente: poda de archivos sin importadores

El entorno del dueño bloquea `rm` y `mv` por política, así que estos archivos
siguen en el árbol aunque no los importe nadie (verificado con grafo de
imports). Para completar la poda, ejecutar desde la raíz del repo:

```bash
mkdir -p ~/.hermes/cache/scratch/ov_ag_attic
git rm scripts/shared/profile-inject.mjs \
       scripts/shared/setup-wizard.mjs \
       scripts/shared/plugin-config.mjs \
       scripts/shared/session-model.mjs \
       scripts/shared/uri-guard.mjs \
       test/unit/session.test.mjs
git commit -m "chore: prune modules with no importers"
```

Se ahorran exactamente 633 líneas (verificado con `git show --stat`).
`recall-compress-core.mjs` **no** se poda: lo importa
`recall-core.mjs` (el upstream lo daba por huérfano y habría roto el recall).

## Compatibilidad

- Probado contra OpenViking 0.5.3 (server MCP 1.30.0).
- Antigravity 2.14.0 en macOS 26.7, Node 22.23.1.
- `manage.mjs status` reporta: servidor, auth, cuenta, cola y sesiones seguidas.

#!/usr/bin/env bash
# Desinstalador portable. Derivado de V0v1kkk/openviking-antigravity-memory (MIT).
# Cambios: ruta dinámica, sin `rm -rf` (todo se mueve a backups) y purga de las
# DOS rutas de cola posibles (la del plugin y la heredada ~/.openviking/pending).
set -euo pipefail

PLUGIN_DIR="${OPENVIKING_PLUGIN_DIR:-$HOME/.gemini/config/plugins/openviking-memory}"
RUNTIME_DIR="$HOME/.openviking/antigravity"
LEGACY_PENDING="$HOME/.openviking/pending"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$RUNTIME_DIR/backups/uninstalled-$STAMP"

PURGE=false
for arg in "$@"; do
  [[ "$arg" == "--purge" ]] && PURGE=true
done

if [[ -d "$PLUGIN_DIR" ]]; then
  mkdir -p "$BACKUP_DIR"
  mv "$PLUGIN_DIR" "$BACKUP_DIR/plugin"
  echo "[uninstall] Plugin movido a $BACKUP_DIR/plugin (nada se borró)"
else
  echo "[uninstall] Plugin no encontrado en $PLUGIN_DIR"
fi

if [[ "$PURGE" == "true" ]]; then
  echo "[uninstall] Retirando estado, credenciales y colas..."
  for item in "$RUNTIME_DIR/state" "$RUNTIME_DIR/pending" "$RUNTIME_DIR/logs" \
              "$RUNTIME_DIR/ovcli.conf" "$LEGACY_PENDING"; do
    if [[ -e "$item" ]]; then
      mv "$item" "$BACKUP_DIR/" 2>/dev/null || true
      echo "  movido: $item"
    fi
  done
  echo "[uninstall] Purga completa. Todo quedó en $BACKUP_DIR"
else
  echo "[uninstall] Estado y credenciales conservados en $RUNTIME_DIR"
  echo "[uninstall] Usa --purge para retirarlos (se mueven a backups, no se borran)."
fi

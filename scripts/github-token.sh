#!/usr/bin/env bash
#
# Resuelve el token de GitHub que usará el servidor MCP y lo imprime por stdout.
# Todo lo demás va a stderr, para que quien captura la salida reciba solo el
# token y los mensajes se sigan viendo en la terminal.
set -euo pipefail

say() { printf '%s\n' "$*" >&2; }

token=""
origin=""

# 1. El que se pasa explícitamente gana sobre todo lo demás.
if [ -n "${TOKEN:-}" ]; then
  token="$TOKEN"
  origin="la variable TOKEN"

# 2. La variable propia del servidor, si ya la tienes exportada.
elif [ -n "${CODE_REVIEW_MCP_GITHUB_TOKEN:-}" ]; then
  token="$CODE_REVIEW_MCP_GITHUB_TOKEN"
  origin="CODE_REVIEW_MCP_GITHUB_TOKEN del entorno"

# 3. La sesión de gh. GITHUB_TOKEN se vacía a propósito: si hay uno caducado en
#    el entorno, gh lo prefiere sobre el llavero y devolvería uno que no sirve.
elif command -v gh >/dev/null 2>&1 && keyring="$(GITHUB_TOKEN= gh auth token 2>/dev/null)" && [ -n "$keyring" ]; then
  token="$keyring"
  origin="tu sesión de gh"
fi

# 4. Si no hay nada, se pide. Con -s, para que no quede en pantalla ni en el
#    historial del shell.
if [ -z "$token" ]; then
  if [ ! -t 0 ]; then
    say "No hay token de GitHub y no puedo pedirlo (no es una terminal interactiva)."
    say
    say "Elige una:"
    say "  make register TOKEN=ghp_tu_token"
    say "  export CODE_REVIEW_MCP_GITHUB_TOKEN=ghp_tu_token && make register"
    say "  gh auth login"
    exit 1
  fi

  say "No encontré ningún token de GitHub."
  say "Necesita el scope 'repo'. Se puede crear en https://github.com/settings/tokens"
  say
  printf 'Token de GitHub: ' >&2
  read -rs token
  say
  origin="lo que acabas de escribir"
fi

# Comprobarlo ahora ahorra registrar un token que falla al primer PR. GH_TOKEN
# tiene prioridad sobre GITHUB_TOKEN en gh, así que valida el que nos importa.
if command -v gh >/dev/null 2>&1; then
  if user="$(GH_TOKEN="$token" gh api user --jq .login 2>/dev/null)"; then
    say "Token válido (de $origin) — autenticado como $user"
  else
    say "GitHub rechazó ese token (de $origin)."
    say "Comprueba que no esté caducado y que tenga el scope 'repo'."
    exit 1
  fi
else
  say "Usando el token de $origin (sin gh instalado no puedo comprobarlo)."
fi

printf '%s' "$token"

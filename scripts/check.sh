#!/usr/bin/env bash
#
# Comprueba el entorno necesario para el servidor MCP.
# Sale con 1 si falta algo obligatorio, para que `make install` no siga adelante
# y falle más tarde con un error peor de entender.
set -uo pipefail

NODE_MIN=20

missing=0
warnings=0

if [ -t 1 ]; then
  OK=$'\033[32m✓\033[0m'; FAIL=$'\033[31m✗\033[0m'; WARN=$'\033[33m!\033[0m'; DIM=$'\033[2m'; OFF=$'\033[0m'
else
  OK="ok"; FAIL="FALTA"; WARN="aviso"; DIM=""; OFF=""
fi

line() { printf '  %s %-16s %s\n' "$1" "$2" "$3"; }

# Sin esto no hay nada que hacer.
required() {
  local name="$1" version="$2" help="$3"
  if [ -n "$version" ]; then
    line "$OK" "$name" "$version"
  else
    line "$FAIL" "$name" "${DIM}$help${OFF}"
    missing=$((missing + 1))
  fi
}

# Se puede vivir sin ello, pero conviene saberlo.
optional() {
  local name="$1" version="$2" note="$3"
  if [ -n "$version" ]; then
    line "$OK" "$name" "$version"
  else
    line "$WARN" "$name" "${DIM}$note${OFF}"
    warnings=$((warnings + 1))
  fi
}

echo "Obligatorio"

node_version="$(node --version 2>/dev/null)"
if [ -n "$node_version" ]; then
  major="${node_version#v}"; major="${major%%.*}"
  if [ "$major" -lt "$NODE_MIN" ]; then
    line "$FAIL" "node" "${DIM}$node_version — hace falta $NODE_MIN o superior${OFF}"
    missing=$((missing + 1))
  else
    line "$OK" "node" "$node_version"
  fi
else
  line "$FAIL" "node" "${DIM}no instalado — https://nodejs.org${OFF}"
  missing=$((missing + 1))
fi

required "pnpm"   "$(pnpm --version 2>/dev/null)"                    "no instalado — npm i -g pnpm"
required "git"    "$(git --version 2>/dev/null | cut -d' ' -f3)"     "no instalado — el flujo lee el repositorio con git"
required "gh"     "$(gh --version 2>/dev/null | head -1 | cut -d' ' -f3)" "no instalado — brew install gh"
required "claude" "$(command -v claude >/dev/null 2>&1 && echo ok)"  "no encontrado — es el CLI de Claude Code"

# Estar instalado no basta: sin sesión ni token no se puede leer un PR.
if command -v gh >/dev/null 2>&1; then
  if GITHUB_TOKEN= gh auth status >/dev/null 2>&1; then
    line "$OK" "sesión de gh" "$(GITHUB_TOKEN= gh api user --jq .login 2>/dev/null || echo activa)"
  else
    line "$WARN" "sesión de gh" "${DIM}sin sesión — gh auth login, o pasa TOKEN al registrar${OFF}"
    warnings=$((warnings + 1))
  fi
fi

# No bloquea: si no hay ninguno, `make register` lo pide por teclado. Solo en un
# entorno no interactivo hace falta traerlo de antes.
if token_output="$(scripts/github-token.sh 2>&1 >/dev/null </dev/null)"; then
  line "$OK" "token" "${token_output#Token válido }"
else
  line "$WARN" "token" "${DIM}ninguno disponible — se pedirá al ejecutar make register${OFF}"
  warnings=$((warnings + 1))
fi

echo
echo "Analizadores del paso de análisis"

optional "pmd"           "$(pmd --version 2>/dev/null | head -1)"    "Java: se usará la imagen de Docker"
optional "semgrep"       "$(semgrep --version 2>/dev/null | head -1)" "todos los lenguajes: se usará la imagen de Docker"
optional "ruff"          "$(ruff --version 2>/dev/null)"             "Python: se usará la imagen de Docker"
optional "detekt"        "$(command -v detekt >/dev/null 2>&1 && echo ok)" "Kotlin quedará sin analizar: no hay imagen oficial"
optional "golangci-lint" "$(command -v golangci-lint >/dev/null 2>&1 && echo ok)" "Go quedará sin analizar: necesita el toolchain local"

echo
echo "Docker"

if ! command -v docker >/dev/null 2>&1; then
  line "$WARN" "docker" "${DIM}no instalado — solo se analizarán los lenguajes con herramienta local${OFF}"
  warnings=$((warnings + 1))
elif docker info >/dev/null 2>&1; then
  line "$OK" "docker" "$(docker --version | cut -d' ' -f3 | tr -d ,)"
else
  # Instalado pero parado es peor que no tenerlo: parece disponible y falla.
  line "$WARN" "docker" "${DIM}instalado pero el daemon no responde — arranca Docker Desktop${OFF}"
  warnings=$((warnings + 1))
fi

echo
if [ "$missing" -gt 0 ]; then
  echo "Falta $missing requisito(s) obligatorio(s): resuélvelos antes de instalar."
  exit 1
fi

if [ "$warnings" -gt 0 ]; then
  echo "Todo lo obligatorio está. $warnings aviso(s): el servidor funciona, con menos cobertura."
else
  echo "Entorno completo."
fi

# Instalación y mantenimiento del servidor MCP code-review-steps.
#
# El objetivo de este Makefile es que instalar esto sea `make install` y nada
# más: comprobar el entorno, compilar, registrar el servidor en Claude Code y
# dejar el comando /revisar-pr listo.

SHELL := /bin/bash

NAME    := code-review-steps
ROOT    := $(shell pwd)
ENTRY   := $(ROOT)/dist/index.js
SCOPE   ?= user
COMMANDS_DIR ?= $(HOME)/.claude/commands

# El token lo resuelve scripts/github-token.sh, por este orden:
#   1. TOKEN=...  pasado a make
#   2. CODE_REVIEW_MCP_GITHUB_TOKEN del entorno
#   3. la sesión de `gh`
#   4. se pide por teclado, sin eco
# Y lo valida contra la API antes de registrar nada.
TOKEN ?=

.DEFAULT_GOAL := help

.PHONY: help
help: ## Muestra esta ayuda
	@echo "code-review-steps — servidor MCP para revisar pull requests"
	@echo
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "Variables:  SCOPE=user|project   TOKEN=<token de GitHub>"
	@echo
	@echo "El token se busca en este orden: TOKEN=... , la variable de entorno"
	@echo "CODE_REVIEW_MCP_GITHUB_TOKEN, tu sesión de gh, y si no hay ninguno se pide."

.PHONY: install
install: check build register command ## Instala todo: dependencias, build, servidor y comando
	@echo
	@echo "Listo. Reinicia Claude Code para que cargue el servidor."
	@echo "Después, desde cualquier repositorio:  /revisar-pr <número del PR>"

.PHONY: check
check: ## Comprueba que están las herramientas necesarias
	@scripts/check.sh

.PHONY: deps
deps: ## Instala las dependencias de Node
	pnpm install

.PHONY: build
build: deps ## Compila el servidor
	pnpm build

.PHONY: register
register: ## Registra el servidor en Claude Code (SCOPE=user|project, TOKEN=...)
	@if [ ! -f "$(ENTRY)" ]; then echo "Falta $(ENTRY). Ejecuta 'make build' primero."; exit 1; fi
	@token="$$(TOKEN='$(TOKEN)' scripts/github-token.sh)" || exit 1; \
	claude mcp remove --scope $(SCOPE) $(NAME) >/dev/null 2>&1 || true; \
	claude mcp add --scope $(SCOPE) $(NAME) -e CODE_REVIEW_MCP_GITHUB_TOKEN="$$token" -- node "$(ENTRY)"

.PHONY: unregister
unregister: ## Quita el servidor de Claude Code
	claude mcp remove --scope $(SCOPE) $(NAME)

.PHONY: command
command: ## Instala el comando /revisar-pr
	@mkdir -p "$(COMMANDS_DIR)"
	@cp commands/revisar-pr.md "$(COMMANDS_DIR)/revisar-pr.md"
	@echo "Comando instalado en $(COMMANDS_DIR)/revisar-pr.md"

.PHONY: status
status: ## Muestra si el servidor y el comando están instalados
	@printf "servidor:  "; claude mcp list 2>/dev/null | grep -q "$(NAME)" && echo "registrado" || echo "NO registrado"
	@printf "comando:   "; [ -f "$(COMMANDS_DIR)/revisar-pr.md" ] && echo "instalado" || echo "NO instalado"
	@printf "build:     "; [ -f "$(ENTRY)" ] && echo "compilado" || echo "sin compilar"
	@printf "token:     "; \
	if [ -n "$(TOKEN)" ]; then echo "de la variable TOKEN"; \
	elif [ -n "$$CODE_REVIEW_MCP_GITHUB_TOKEN" ]; then echo "de CODE_REVIEW_MCP_GITHUB_TOKEN"; \
	elif GITHUB_TOKEN= gh auth token >/dev/null 2>&1; then echo "de tu sesión de gh"; \
	else echo "no hay — se pedirá al registrar"; fi

.PHONY: uninstall
uninstall: ## Quita el servidor y el comando
	@claude mcp remove --scope $(SCOPE) $(NAME) >/dev/null 2>&1 || true
	@rm -f "$(COMMANDS_DIR)/revisar-pr.md"
	@echo "Desinstalado. Los archivos del proyecto y los exports de ~/.code-review-steps se conservan."

.PHONY: dev
dev: ## Compila en modo watch
	pnpm dev

.PHONY: inspect
inspect: build ## Abre el MCP Inspector contra el servidor
	pnpm inspect

.PHONY: clean
clean: ## Borra lo compilado
	rm -rf dist

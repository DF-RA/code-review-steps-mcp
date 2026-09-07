# code-review-steps-mcp

Servidor MCP que guía la revisión de pull requests paso a paso. Expone el flujo a
través de los tres primitivos de MCP: tools, resources y prompts. Corre sobre
**stdio**, así que el cliente (Claude Code, Claude Desktop, MCP Inspector) lo
lanza como proceso hijo.

## Requisitos

Obligatorio: **Node >= 20**, **pnpm**, **git**, [**gh**](https://cli.github.com)
(por donde se consultan los pull requests) y el CLI de **Claude Code**.

Opcional: **Docker** y los analizadores de cada lenguaje (PMD, detekt,
golangci-lint, ESLint, Ruff, Semgrep). Sin ellos el servidor funciona igual, con
menos cobertura en el paso de análisis.

`make check` te dice qué tienes y qué te falta.

## Instalación

```bash
make install
```

Comprueba el entorno, instala dependencias, compila, registra el servidor en
Claude Code y deja el comando `/revisar-pr` listo. Después hay que **reiniciar
Claude Code** para que cargue el servidor.

## Comandos de `make`

```
make            # equivale a make help
```

### Instalar y desinstalar

| Comando | Qué hace |
| --- | --- |
| `make install` | Todo: `check` + `build` + `register` + `command` |
| `make register` | Solo registra el servidor en Claude Code |
| `make unregister` | Solo lo quita de Claude Code |
| `make command` | Solo instala el comando `/revisar-pr` |
| `make uninstall` | Quita el servidor y el comando. Conserva los archivos del proyecto y los exports de `~/.code-review-steps` |

### Comprobar

| Comando | Qué hace |
| --- | --- |
| `make check` | Qué hay instalado y qué falta. Sale con error si falta algo obligatorio |
| `make status` | Si el servidor, el comando, el build y el token están en su sitio |
| `make help` | La lista de targets |

### Desarrollo

| Comando | Qué hace |
| --- | --- |
| `make deps` | Instala las dependencias de Node |
| `make build` | Compila `src/` en `dist/` |
| `make dev` | Compila en modo watch |
| `make test` | Pasa los tests |
| `make test-watch` | Pasa los tests en modo watch |
| `make coverage` | Tests con cobertura y sus umbrales (Node >= 22) |
| `make lint` | ESLint sobre `src/` y `test/` |
| `make typecheck` | Tipos de `src/` y `test/` |
| `make verify` | Lo mismo que la CI: tipos, lint y tests |
| `make inspect` | Compila y abre el MCP Inspector |
| `make clean` | Borra `dist/` |

### Variables

| Variable | Por defecto | Para qué |
| --- | --- | --- |
| `SCOPE` | `user` | `user` lo guarda en `~/.claude.json` y sirve en cualquier repositorio; `project` lo guarda en el `.mcp.json` del repo actual |
| `TOKEN` | *(se busca)* | Token de GitHub concreto, en vez del que se resuelva solo |
| `COMMANDS_DIR` | `~/.claude/commands` | Dónde se instala el comando `/revisar-pr` |

```bash
make install SCOPE=project              # solo para este repositorio
make register TOKEN=ghp_tu_token        # con un token concreto
make status                             # sin tocar nada, solo mirar
```

### El token de GitHub

Se busca por este orden, y el primero que aparezca gana:

| | Cómo |
| --- | --- |
| 1. Pasado a make | `make register TOKEN=ghp_tu_token` |
| 2. Variable de entorno | `export CODE_REVIEW_MCP_GITHUB_TOKEN=ghp_tu_token` |
| 3. Tu sesión de `gh` | `gh auth login` |
| 4. Se pide por teclado | si no hay ninguno de los anteriores |

Cuando se pide, se lee **sin eco**: no queda en pantalla ni en el historial del
shell.

**El token se comprueba contra la API antes de registrarlo**, así que un token
caducado o sin el scope `repo` se detecta ahora y no en mitad de la primera
revisión:

```
Token válido (de tu sesión de gh) — autenticado como tu-usuario
```

Un detalle que importa: al preguntar a `gh` se vacía `GITHUB_TOKEN` a propósito.
Si tienes uno caducado exportado en el entorno, `gh` lo prefiere sobre el del
llavero y devolvería un token que no funciona — que es exactamente el fallo que
da un 401 difícil de diagnosticar.

`make status` dice de dónde saldría el token, sin mostrarlo.

### `make check`

Comprueba el entorno y **corta la instalación si falta algo obligatorio**, para
no descubrirlo a mitad de la primera revisión.

```
Obligatorio
  ✓ node             v22.22.2
  ✓ pnpm             10.0.0
  ✓ git              2.50.1
  ✓ gh               2.93.0
  ✓ claude           ok
  ✓ sesión de gh     tu-usuario
  ✓ token            (de tu sesión de gh) — autenticado como tu-usuario

Analizadores del paso de análisis
  ! pmd              Java: se usará la imagen de Docker
  ! semgrep          todos los lenguajes: se usará la imagen de Docker
  ! ruff             Python: se usará la imagen de Docker
  ! detekt           Kotlin quedará sin analizar: no hay imagen oficial
  ! golangci-lint    Go quedará sin analizar: necesita el toolchain local

Docker
  ✓ docker           27.4.0

Todo lo obligatorio está. 5 aviso(s): el servidor funciona, con menos cobertura.
```

Qué bloquea y qué no:

- **Bloquean**: `node` (20 o superior), `pnpm`, `git`, `gh` y `claude`. Sin ellos
  no hay flujo posible.
- **Avisan**: los analizadores, Docker, la sesión de `gh` y el token. El servidor
  funciona igual, con menos cobertura, y el token se puede introducir al
  registrar.

Comprueba cosas que suelen dar problemas y no se ven a simple vista: que `node`
llegue a la versión mínima, que `gh` tenga **sesión** y no solo esté instalado, y
que el **daemon** de Docker responda — Docker instalado pero parado es peor que no
tenerlo, porque parece disponible y falla al usarlo.

## Configuración

El servidor lee su configuración de variables de entorno, que se declaran en el
bloque `env` de la configuración del cliente MCP.

| Variable | Obligatoria | Para qué |
| --- | --- | --- |
| `CODE_REVIEW_MCP_GITHUB_TOKEN` | No | Token de GitHub que se usará para consultar los PRs. |
| `CODE_REVIEW_MCP_PMD_PATH` | No | Ruta del ejecutable de PMD. Por defecto se busca `pmd` en el `PATH`. |
| `CODE_REVIEW_MCP_PMD_RULESET` | No | Ruleset de PMD. Por defecto el de este repo (`rulesets/java.xml`). |
| `CODE_REVIEW_MCP_DETEKT_PATH` | No | Ruta del ejecutable de detekt. |
| `CODE_REVIEW_MCP_SEMGREP_CONFIG` | No | Config de Semgrep. Por defecto `p/default`; apunta a un directorio local de reglas propias para correr sin red. |
| `CODE_REVIEW_MCP_SIGNATURE` | No | Firma al pie de cada comentario. Por defecto `Powered by Claude Code`. |
| `CODE_REVIEW_MCP_EXTENSIONS_DIR` | No | Directorio de extensiones. Por defecto `~/.code-review-steps/extensions`. |
| `CODE_REVIEW_MCP_DOCKER` | No | `off` desactiva el uso de Docker como alternativa a las herramientas locales. |
| `CODE_REVIEW_MCP_PMD_IMAGE` | No | Imagen de PMD. Por defecto `pmdcode/pmd:latest`. |
| `CODE_REVIEW_MCP_RUFF_IMAGE` | No | Imagen de Ruff. Por defecto `ghcr.io/astral-sh/ruff:latest`. |
| `CODE_REVIEW_MCP_SEMGREP_IMAGE` | No | Imagen de Semgrep. Por defecto `semgrep/semgrep:latest`. |

### Sobre el token

Cómo se elige al instalar está en [El token de GitHub](#el-token-de-github). Esto
es lo que hace el servidor con él en tiempo de ejecución.

Si defines `CODE_REVIEW_MCP_GITHUB_TOKEN`, el servidor lo inyecta al subproceso
`gh` como `GH_TOKEN`. Eso importa por la precedencia que aplica `gh`:

```
GH_TOKEN  >  GITHUB_TOKEN  >  sesión del keyring (gh auth login)
```

Al entrar como `GH_TOKEN`, el token configurado gana siempre — incluso sobre un
`GITHUB_TOKEN` heredado del entorno que esté caducado o sea inválido, que de otro
modo provoca errores 401 difíciles de diagnosticar.

Si **no** defines la variable, el servidor no toca el entorno y deja que `gh`
resuelva la autenticación por su cuenta.

El token necesita el scope `repo`. Ten en cuenta que queda en texto plano en el
archivo de configuración del cliente: si ese archivo se versiona (un `.mcp.json`
compartido, por ejemplo), no pongas el token ahí.

## Instalación manual, sin `make`

Si prefieres hacerlo a mano, o el Makefile no encaja en tu entorno:

```bash
pnpm install
pnpm build

claude mcp add --scope user code-review-steps \
  -e CODE_REVIEW_MCP_GITHUB_TOKEN=ghp_tu_token \
  -- node "$(pwd)/dist/index.js"

cp commands/revisar-pr.md ~/.claude/commands/
```

`--scope user` lo guarda en `~/.claude.json` y queda disponible desde cualquier
repositorio: el repositorio a revisar se pasa en cada llamada, no se fija en la
configuración.

Para no escribir el token en el archivo, se puede guardar por referencia y
exportarlo en el shell:

```bash
claude mcp add --scope user code-review-steps \
  -e 'CODE_REVIEW_MCP_GITHUB_TOKEN=${CODE_REVIEW_MCP_GITHUB_TOKEN}' \
  -- node "$(pwd)/dist/index.js"

echo 'export CODE_REVIEW_MCP_GITHUB_TOKEN="$(gh auth token)"' >> ~/.zshrc
```

O directamente en el JSON de configuración:

```json
{
  "mcpServers": {
    "code-review-steps": {
      "command": "node",
      "args": ["/ruta/al/proyecto/dist/index.js"],
      "env": {
        "CODE_REVIEW_MCP_GITHUB_TOKEN": "ghp_tu_token"
      }
    }
  }
}
```

Hay que **reiniciar Claude Code** para que el servidor esté disponible.

## El comando `/revisar-pr`

Lo instala `make command` (y `make install`). Vive versionado en
`commands/revisar-pr.md` y se copia a `~/.claude/commands/`:

```markdown
---
description: Revisa un pull request paso a paso con el MCP code-review-steps
argument-hint: <número o URL del PR>
---

Revisa el pull request `$ARGUMENTS` siguiendo el flujo del servidor MCP
`code-review-steps`. El repositorio es el directorio de trabajo actual.

... (un apartado por paso, y la instrucción de detenerse en create_draft)
```

Uso:

```
/revisar-pr 200
/revisar-pr https://github.com/owner/repo/pull/200
```

El comando se detiene en el paso 7 y espera a que revises el borrador en el
navegador antes de continuar.

## El flujo de revisión

Las tools **no son independientes**: son los pasos de una secuencia, y cada uno
consume lo que produjo el anterior.

```
1. start_review(pr, repo)          → reviewId
2. task_context(reviewId)          → qué pedía la tarea (prompt + record_task_context)
3. get_pr_files(reviewId)          → archivos del PR
4. analyze_pr(reviewId)            → problemas detectados por las herramientas
5. get_file_diff(reviewId, pathId) → diff + los problemas de ese archivo
6. review_file(reviewId, pathId)   → el agente analiza y registra sus comentarios
   (5 y 6, uno por archivo)
7. create_draft(reviewId)          → borrador en una página local, para revisarlo
8. get_draft_status(reviewId)      → qué decidió la persona sobre cada comentario
9. publish_review(reviewId)        → publicarlos en el PR
   o create_fix_list(reviewId)     → o convertirlos en lista de trabajo
```

Por qué encadenado y no cuatro tools sueltas:

- **No se puede saltar un paso.** Cada tool exige lo que necesita y, si falta,
  dice exactamente qué llamar antes. El flujo no depende de que el agente
  recuerde seguirlo.
- **Todos los pasos ven el mismo código.** `start_review` resuelve los commits
  una vez y los congela en la revisión. Si alguien empuja al PR a mitad de la
  revisión, ningún paso empieza a mirar algo distinto de lo que vieron los
  anteriores.
- **Nada se recalcula.** El análisis del paso 3 se guarda y el paso 4 lo reparte
  por archivo. La revisión de un archivo es instantánea.

El `reviewId` viaja por referencia: el diff y los hallazgos se quedan en el
servidor, no se arrastran por el contexto del agente de un paso a otro.

Las revisiones viven en memoria del proceso y caducan a las 4 horas. Para no
perder el trabajo hecho, se exportan a un archivo y se retoman cuando quieras
(ver **Interrumpir y retomar** más abajo).

## Los pasos

### 1. `start_review(pr, repo)`

Abre la revisión. Devuelve el `reviewId`, el autor, las ramas y el estado del
pipeline.

- `pr`: el número (`200`) o la URL completa del pull request.
- `repo`: la **ruta local del clon**. Todos los pasos trabajan sobre ese
  checkout, porque los analizadores leen archivos de disco.
- Solo acepta **pull requests abiertos**: uno cerrado o mergeado no tiene nada
  que revisar.
- El estado del pipeline se normaliza a `passing`, `failing`, `pending` o `none`;
  cuando falla, lista los checks caídos con su enlace.

### 2. `task_context(reviewId)` — prompt

Busca en el gestor de tareas qué se pidió, para poder revisar el cambio contra lo
que debía hacer y no solo contra sí mismo.

El prompt le pide al agente que extraiga del título o la descripción un código de
tarea, lo consulte en el gestor que uséis y compruebe a quién está asignado. El
resultado se guarda con `record_task_context` y **queda en la revisión**: se
resuelve una sola vez y todos los archivos se revisan contra la misma tarea.

Qué gestor es, con qué formato de código y con qué herramientas se consulta lo
define una [extensión](#extensiones). Sin ninguna, el prompt pide el código en
genérico y funciona igual.

Quien consulta el gestor es el **agente**, no este servidor: un servidor MCP no
consume otros servidores MCP.

Es un paso obligatorio, pero **no exige que haya tarea**. Si el PR no referencia
ninguna, si el gestor no está disponible o si no encuentra el código, se registra
con `found: false` y la revisión continúa sin ese contexto. Lo que no se puede es
saltárselo en silencio: quedaría sin saberse si el cambio se comparó con lo que se
pidió o solo consigo mismo.

Si la tarea está asignada a alguien que no es el autor del PR, se avisa **a ti**,
en la salida de `record_task_context`. Ese dato no llega al paso 6 ni aparece en
ningún comentario: los comentarios se publican y los lee el equipo, así que hablan
del código, no de las personas.

### 3. `get_pr_files(reviewId)`

Los archivos del PR, agrupados por tipo de cambio (añadidos, modificados,
eliminados, renombrados). Quedan guardados en la revisión: los pasos siguientes
solo aceptan rutas de esta lista.

### 4. `analyze_pr(reviewId)`

Pasa los analizadores estáticos sobre los archivos del PR, **una sola vez**, y
guarda los problemas en la revisión.

Se ejecuta sobre todo el PR de golpe por una limitación real de las
herramientas: **ninguna sabe analizar un diff**. PMD, Ruff o Semgrep parsean
código, y un diff son fragmentos sueltos sin imports ni estructura. Necesitan el
archivo entero, así que el análisis vive en su propio paso y su resultado pasa a
ser contexto del resto del flujo.

| Lenguaje | Herramienta | Instalación |
| --- | --- | --- |
| Java | PMD | `brew install pmd` |
| Kotlin | detekt | `brew install detekt` |
| Go | golangci-lint | `brew install golangci-lint` |
| JavaScript / TypeScript | ESLint **del propio repo** vía `npx --no-install` | `npm i -D eslint` en el repo |
| Python | Ruff | `brew install ruff` |
| Todos | Semgrep | `brew install semgrep` |

- **Si la herramienta no está instalada, se usa Docker.** Sin configurar nada:

  | Herramienta | Imagen | Motivo |
  | --- | --- | --- |
  | PMD | `pmdcode/pmd` | analiza fuentes, no necesita compilar |
  | Ruff | `ghcr.io/astral-sh/ruff` | igual |
  | Semgrep | `semgrep/semgrep` | igual, y resuelve su soporte flojo en Windows |
  | detekt | — | no hay imagen oficial publicada; instalación local |
  | ESLint | — | necesita el `node_modules` del repo para cargar su config |
  | golangci-lint | — | necesita el toolchain de Go, los módulos y, si son privados, credenciales |

  El repositorio se monta en **solo lectura**, el contenedor corre con tu uid, y
  solo Semgrep tiene red (la necesita para sus reglas). Se desactiva con
  `CODE_REVIEW_MCP_DOCKER=off`.

- **Una herramienta ausente no rompe el análisis**: se reporta cuál faltó y por
  qué, y las demás siguen. Si no se ejecuta **ninguna**, el paso devuelve error:
  un "sin problemas" ahí significaría "nadie miró", no "está limpio".
- **Los archivos de lenguajes sin analizador se listan aparte** (`unanalyzed`),
  para que quede claro que nadie los revisó automáticamente.
- **Solo lo que el PR introdujo.** Los analizadores que leen fuentes aisladas
  (PMD, detekt, Ruff, Semgrep) se ejecutan dos veces: sobre la versión base de
  cada archivo y sobre la del PR. Solo entra lo que **no existía antes**. Eso
  elimina el caso que un filtro por líneas no resuelve: una regla de clase o
  método entero (`CyclomaticComplexity`, `GodClass`) que se reporta en la línea
  de la firma y aparecería solo porque el PR tocó esa firma, aunque el problema
  lleve ahí años.

  La versión base se extrae con `git archive` a un directorio temporal: no se
  hace checkout, no se crea un worktree y no queda nada en tu clon.

  ESLint y golangci-lint no pueden analizar una copia aislada (necesitan el
  proyecto entero alrededor), así que para ellos se filtra por líneas tocadas.
- **No se deduplican los hallazgos entre herramientas.** Si PMD y Semgrep señalan
  lo mismo, se ven los dos con su origen: que dos coincidan es señal, no ruido.
- **Ruleset propio para Java** (`rulesets/java.xml`): el `quickstart` de PMD con
  `MethodNamingConventions` ajustada para aceptar el patrón
  `metodo_escenario_esperado` de los tests. Sin ese ajuste, una suite bien
  nombrada aparece como decenas de hallazgos de severidad alta y entierra lo que
  importa: medido sobre un PR real, 45 hallazgos de los que 41 eran esa sola
  regla. Con el ajuste quedan 4, todos accionables. Para usar el ruleset de tu
  proyecto, apunta `CODE_REVIEW_MCP_PMD_RULESET` a su ruta.

### 5. `get_file_diff(reviewId, pathId)`

El diff de un archivo **junto con los problemas que el paso 3 detectó en él**.
Es lo que necesitas para revisar ese archivo, en una sola respuesta.

- El archivo se indica con su `pathId`, no con su ruta: `get_pr_files` devuelve
  uno por archivo. Si le pasas la ruta, el error te dice cuál es su `pathId`.
- Los problemas no se recalculan: vienen del análisis de la revisión.
- El diff completo se guarda la primera vez, así que pedir otra parte del mismo
  archivo no vuelve a llamar a git.
- Los diffs largos llegan **por partes**, cortadas entre bloques de cambio
  (`@@`), nunca a mitad de uno; cada parte repite la cabecera del archivo. La
  respuesta trae `totalHunks`, `hunksIncluded`, `hasMore` y `nextOffset`: se pide
  la siguiente pasando ese `nextOffset` como `offset`.
- Si ninguna herramienta cubre el lenguaje del archivo, lo dice: ese archivo lo
  revisa solo el agente.
- Lo que las herramientas no cubren —diseño, lógica de negocio, si los tests
  prueban lo que dicen— es lo que valora el agente a partir del diff.

### 6. `review_file(reviewId, pathId)` — prompt

Aquí entra el juicio, que es lo que ninguna herramienta cubre. Es un **prompt**,
no una tool: construye la revisión de un archivo con todo el contexto dentro.

Lo que le llega al agente:

- El pull request: título, **descripción**, autor y ramas.
- **El contexto de la tarea** que resolvió el paso 2, ya escrito. No se vuelve a
  consultar el gestor por cada archivo: sería una llamada por archivo para el
  mismo dato, y podría contestar cosas distintas a mitad de la revisión.
- El archivo y **su estado en el PR**: nuevo, modificado, eliminado, renombrado.
- Los problemas que detectaron las herramientas en el paso 3.
- El diff del paso 4.

Y le pide analizarlo desde cinco perspectivas: **programador** (correctitud,
casos límite, duplicación), **QA** (qué queda sin test, si los tests prueban
comportamiento), **arquitecto** (capas, dependencias, contratos), **product
manager** (si resuelve lo que se pidió, y si sobra alcance) y **líder de
proyecto**, que lee a los cuatro, descarta el ruido y decide qué se queda. Solo
la conclusión del líder se registra.

Dos reglas que el prompt impone y conviene conocer:

- **Solo se comenta lo que está en el diff.** Lo preexistente no es asunto de esa
  revisión, por mejorable que parezca.
- **Un comentario por punto, anclado a su línea**, para que cada uno se pueda
  discutir y resolver por separado.

Si el cliente soporta sub-agentes (Claude Code sí), los cinco roles corren en
paralelo; si no, el agente recorre las cinco perspectivas una a una.

### `record_file_review(reviewId, path, comments)`

Guarda la conclusión del paso 6 en la revisión, ya con el formato con el que se
publicaría. Se llama siempre, incluso sin comentarios: así queda constancia de
qué archivos se revisaron, y la respuesta dice cuáles faltan.

Cada comentario lleva un `scope`:

| scope | Cuándo |
| --- | --- |
| `line` | Lo normal: anclado a la línea de la que habla |
| `file` | Afecta al archivo entero y no se puede señalar una línea |
| `pr` | No pertenece a ningún archivo (un pipeline caído, por ejemplo) |

Y una severidad: `blocker`, `issue`, `suggestion` o `question`.

**No publica nada en GitHub.** El comentario se queda en la revisión para que lo
leas antes de que lo vea nadie más.

Así queda renderizado:

```markdown
> [!TIP]
> **💡 Sugerencia — Import redundante**
> `src/test/java/com/ejemplo/OrderServiceTest.java` L34
>
> La línea 6 ya importa esa clase de forma estática y aquí no se usa cualificada,
> así que este import no aporta nada. Bórralo.

_Powered by Claude Code_
```

Cada severidad se publica como un **alert de GitHub**, que se renderiza con color
e icono propios. Es la única forma de meter color en un comentario: el markdown de
GitHub no admite estilos, y un badge de imagen sería una petición más para quien
lo lee.

| Severidad | Alert | Color |
| --- | --- | --- |
| `blocker` | `[!CAUTION]` | rojo |
| `issue` | `[!WARNING]` | ámbar |
| `suggestion` | `[!TIP]` | verde |
| `question` | `[!NOTE]` | azul |

La etiqueta en texto (`🛑 Bloqueante`) se mantiene dentro del alert aunque este ya
traiga su icono: así la severidad sigue siendo legible donde el alert no se
renderiza, como una terminal o el texto en crudo.

La firma no es decoración: quien lea esto en un PR tiene que saber que lo escribió
una máquina antes de decidir cuánto se fía. Se cambia con
`CODE_REVIEW_MCP_SIGNATURE`.

### 7. `create_draft(reviewId)`

Junta los comentarios registrados en un borrador y lo sirve en una página local
para que lo leas en el navegador antes de que exista fuera de tu máquina.

Devuelve un enlace tipo `http://127.0.0.1:54886/r/<reviewId>`. En esa página, cada
comentario se puede:

- **editar** — el texto que quede es el que se publicaría;
- marcar **válido**;
- marcar **descartado**;
- marcar **otra vuelta**, para que el agente lo rehaga.

La página **no tiene ningún campo de texto libre** más allá del editor del propio
comentario, y es deliberado: cada acción reconstruye la lista entera desde el
servidor, así que un campo a medio escribir sería algo que hay que salvar de cada
clic. Marcar es todo el mensaje; qué cambiar te lo pregunta el agente en la
conversación, donde la respuesta puede ser tan larga como haga falta.

Y un botón para **confirmar** el borrador cuando termines.

Sobre el servidor:

- Escucha solo en `127.0.0.1` y en un **puerto libre que elige el sistema**
  (`port 0`), así que no choca con nada que tengas levantado.
- La ruta lleva el `reviewId`, que es un UUID: no es adivinable por otra cosa que
  corra en la máquina.
- Se levanta con la primera llamada y muere con el servidor MCP.
- La página **no carga nada de internet**: renderiza el markdown con su propio
  código, en unas 60 líneas, en vez de traer una librería por CDN.
- Cada comentario lleva el **color de su severidad** en el borde y en la etiqueta,
  con la misma correspondencia que los alerts de GitHub, para distinguirlos de un
  vistazo sin leer.

Volver a llamarla después de rehacer comentarios **conserva las decisiones que ya
tomaste** sobre los demás: solo se rehace lo que pediste rehacer.

### 8. `get_draft_status(reviewId)`

Qué decidiste sobre cada comentario. El agente la consulta cuando le avisas de que
ya revisaste la página.

- Si el borrador no está confirmado, lo dice y espera.
- Si hay comentarios marcados **otra vuelta**, los devuelve y le dice al agente que
  te pregunte qué cambiar de cada uno antes de rehacerlos, registrarlos de nuevo y
  volver a crear el borrador.
- Cuando está confirmado y sin pendientes, devuelve en `approved` los comentarios
  aprobados ya renderizados, listos para publicar.

El agente **no espera bloqueado**: pregunta cuando le dices, en vez de quedarse
colgado en una tool sin poder hacer nada más.

### 9. Publicar o resolver

Al confirmar el borrador el flujo se bifurca, según de quién sea el pull request.

#### `publish_review(reviewId, event?)`

Publica los comentarios aprobados como un review de GitHub.

**Llamarla sin `event` no publica nada**: devuelve lo que se publicaría, cuántos
bloqueantes hay y qué comentarios hubo que degradar. Solo publica cuando se le
pasa el tipo:

| `event` | Efecto |
| --- | --- |
| `COMMENT` | Deja los comentarios sin aprobar ni bloquear |
| `REQUEST_CHANGES` | Pide cambios y bloquea el merge |
| `APPROVE` | Aprueba el pull request |

Es la **única tool del flujo que escribe fuera de tu máquina**, y no se puede
deshacer: los comentarios quedan en el PR y le llegan al equipo.

Los tres anclajes se reparten así: los de línea van inline, los de archivo como
comentario de archivo, y los de PR al cuerpo del review.

**Un comentario sobre una línea que el PR no toca no lo acepta la API de GitHub**,
y eso pasa más de lo que parece: si el cambio deja huérfano un import que ya
estaba, el problema lo introduce el PR pero la línea culpable no está en el diff.
En vez de fallar la publicación entera, esos comentarios se degradan a comentario
de archivo con una nota de a qué línea se referían, y la llamada en seco te dice
cuáles antes de publicar.

#### `create_fix_list(reviewId)` + `next_fix` + `complete_fix`

La otra salida: convertir los comentarios aprobados en una lista de cosas que
arreglar. Es lo que quieres cuando **el pull request es tuyo** y no vas a
comentarte a ti mismo.

- `create_fix_list` crea la lista y la página pasa a modo lista de trabajo.
- `next_fix` devuelve el siguiente pendiente con su archivo, su línea y el
  comentario completo.
- `complete_fix` lo cierra como `done` o `skipped`, con una nota de qué se hizo.

Se puede marcar desde el navegador o desde el agente: es el mismo estado. Nada de
esto sale de tu máquina.

## Interrumpir y retomar

Una revisión de 48 archivos es trabajo de un rato, y vive en memoria del proceso:
reiniciar Claude Code la borra. Estas dos tools la hacen persistente.

### `export_review(reviewId, file?)`

Guarda la revisión entera en un JSON: el pull request, los commits congelados, la
tarea, los archivos, el análisis de las herramientas, los comentarios y **las
decisiones que tomaste sobre cada uno**.

Por defecto va a `~/.code-review-steps/<repo>-pr<número>.json`, uno por pull
request. Con `file` se puede elegir otra ruta.

Devuelve un resumen de por dónde iba, que es lo que verás al retomarla:

```
PR #123 — feat: [PROJ-1234] añadir el campo de cancelación al evento
Rama: feature/campo-cancelacion → develop
Tarea: PROJ-1234
Archivos: 48
Análisis: PMD, Ruff, Semgrep
Revisados: 1 de 48
Borrador: 2 comentario(s) · 1 válidos, 0 descartados, 1 para otra vuelta, 0 sin revisar
```

### `import_review(file)`

Devuelve la revisión al servidor **con el mismo `reviewId`**, así que los pasos
siguientes y el enlace del borrador funcionan igual que antes.

Comprueba que el clon siga ahí y que el commit revisado siga en él. Si la rama se
borró o el clon cambió, avisa: lo revisado corresponde a unos commits concretos y
seguir a ciegas sobre otros sería peor que empezar de nuevo.

El formato lleva un número de versión: un archivo guardado con otra versión del
servidor falla diciéndolo, en vez de cargarse a medias.

## Extensiones

Lo que es propio de un equipo —qué gestor de tareas usa, con qué formato de
código, qué convenciones aplica en las revisiones— no vive en este repositorio.
Se declara en **extensiones**, archivos JSON que el servidor lee de:

```
~/.code-review-steps/extensions/*.json
```

Se puede cambiar el directorio con `CODE_REVIEW_MCP_EXTENSIONS_DIR`.

Ese directorio está **fuera del proyecto** a propósito: así lo específico de tu
empresa se queda en tu máquina o en un repositorio suyo, y este repo no lo
contiene ni lo publica.

### Formato

```json
{
  "name": "jira",
  "description": "Contexto de tareas desde Jira.",
  "taskTracker": {
    "name": "Jira",
    "codePattern": "[A-Z]{2,}-\\d+",
    "codeExample": "PROJ-1234",
    "instructions": "Consulta Jira con las herramientas que tengas conectadas y quédate con la descripción y los criterios de aceptación."
  },
  "reviewGuidance": "En este equipo la lógica de negocio vive en el paquete domain y no puede depender de infrastructure. Todo endpoint nuevo necesita su test de contrato."
}
```

| Campo | Dónde entra |
| --- | --- |
| `taskTracker.name` | Cómo se nombra el gestor en el prompt del paso 2 |
| `taskTracker.codePattern` | El formato del código que el agente debe buscar |
| `taskTracker.codeExample` | Un ejemplo, para que no tenga que interpretar la expresión |
| `taskTracker.instructions` | Cómo consultarlo y con qué herramientas |
| `reviewGuidance` | Se añade al prompt del paso 6 como convenciones del equipo |

Ambos campos son opcionales. Sin `taskTracker`, el paso 2 pide el código en
genérico; sin `reviewGuidance`, la revisión usa solo los criterios de los cinco
roles.

### Cómo se combinan

- **`taskTracker`**: gana el primero que lo declare, por orden alfabético de
  archivo. Solo hay un gestor de tareas.
- **`reviewGuidance`**: se suman todas. Puedes tener una extensión con las
  convenciones de la empresa y otra con las de tu equipo.

Las extensiones se leen **en cada uso**, así que editar una tiene efecto sin
reiniciar el servidor. Un archivo con JSON inválido se ignora y se avisa por
`stderr`, sin tumbar la revisión.

Son **datos, no código**: aportan textos y patrones, y el servidor no ejecuta
nada que venga de ellas.

## Resources

- **`review://comment-layout`** — el formato con el que se publican los
  comentarios: la plantilla, la tabla de severidades y un ejemplo de cada tipo de
  anclaje (línea, archivo, PR).
- **`review://comment-layout/{severity}`** — *resource template*: el formato y los
  ejemplos de una severidad concreta (`blocker`, `issue`, `suggestion`,
  `question`). El valor se autocompleta desde el cliente.

Lo mismo está disponible como tool, **`get_comment_layout`**, porque no todos los
clientes muestran los resources y el agente que redacta los comentarios tiene que
poder leer el formato que debe seguir.

> En MCP, un *resource template* no es una "plantilla" de contenido: es un recurso
> **parametrizado**, con una URI variable según RFC 6570 (`file:///{path}`). Por eso
> el layout completo es un recurso normal y aparece en `resources/list`, mientras
> que `resources/templates/list` solo lista el que lleva `{severity}`.

## Scripts de pnpm

Es lo que hay por debajo de los targets de `make`. Se pueden usar directamente,
pero para instalar es más cómodo `make`.

| Script | Qué hace |
| --- | --- |
| `pnpm build` | Compila `src/` en `dist/` y deja el entrypoint ejecutable. |
| `pnpm dev` | `tsc --watch`. |
| `pnpm typecheck` | Chequeo de tipos de `src/` y `test/`, sin generar salida. |
| `pnpm lint` | ESLint sobre `src/` y `test/`. |
| `pnpm test` | Pasa los tests. |
| `pnpm test:watch` | Los mismos tests, en modo watch. |
| `pnpm test:coverage` | Tests con cobertura y umbrales. Necesita Node >= 22. |
| `pnpm verify` | `typecheck` + `lint` + `test`, que es lo que corre la CI. |
| `pnpm start` | Ejecuta el servidor compilado sobre stdio. |
| `pnpm inspect` | Compila y abre la UI del MCP Inspector contra el servidor. |
| `pnpm inspect:cli` | Igual, pero en modo CLI: sin navegador, imprime y termina. |

## Tests

```bash
make test        # o pnpm test
make test-watch  # se vuelven a pasar al guardar
make coverage    # con umbrales de cobertura, necesita Node >= 22
make verify      # tipos + lint + tests, lo mismo que la CI
```

Se ejecutan con el runner de Node (`node:test`) y **tsx**, que quita los tipos al
vuelo. No hay paso de compilación previo: los tests importan de `src/` y ven el
mismo código que se publica.

### Qué se prueba

`test/` espeja `src/`: `test/analysis/sarif.test.ts` prueba `src/analysis/sarif.ts`.
Lo cubierto es la lógica que decide qué acaba en la revisión —parseo de diffs e
informes, aislamiento de lo que el PR introdujo, formato de los comentarios,
sesión y export/import—, no las tools ni los prompts, que son adaptadores del
SDK sobre esa lógica.

Lo que lee un clon (`git.ts`, `changed-files.ts`, `file-diff.ts`, `baseline.ts`)
se prueba contra un **repositorio git temporal de verdad**, que crea
`test/helpers/repo.ts`. Un diff escrito a mano demostraría que el parser sabe
leer el fixture, no que sabe leer a git; y varios de los casos que importan
—rutas con espacios o acentos, renombrados, la línea de contexto en blanco que
es un espacio y no una cadena vacía— solo aparecen si git es quien genera la
salida.

La página del borrador va como una cadena de JavaScript de navegador dentro de
`renderPage`, así que la única forma de probar qué pasa al pulsar algo es
**ejecutarla**: `test/helpers/dom.ts` es el DOM mínimo que ese script toca y
`test/helpers/page.ts` lo corre contra el **servidor de borrador real**, no
contra un mock. Un clic en el test hace el mismo POST que haría en el navegador.

Los helpers de `test/helpers/` son cinco:

| Helper | Para qué |
| --- | --- |
| `repo.ts` | Un clon git desechable, con identidad fija y sin leer la configuración global |
| `env.ts` | Cambia variables de entorno para un solo test y las restaura al salir |
| `session.ts` | Una `ReviewSession` de ejemplo, con y sin los pasos opcionales |
| `dom.ts` | El DOM mínimo que necesita el script de la página del borrador |
| `page.ts` | Ejecuta ese script contra el servidor de borrador de verdad |

### Cobertura

`make coverage` falla si baja del 90 % de líneas, el 85 % de ramas o el 90 % de
funciones. Solo mide los archivos que los tests importan, así que es un trinquete
sobre lo que ya está cubierto, no una medida del proyecto entero. Y no mide el
script de la página: para Node es una cadena, no código, aunque los tests sí lo
ejecuten.

### Escribir un test nuevo

- Un archivo `*.test.ts` dentro de `test/`, en la carpeta que corresponda a la de
  `src/`. El runner los encuentra solo.
- Los imports relativos llevan extensión `.js`, igual que en `src/`.
- El nombre del test dice qué comportamiento se espera, no qué función se llama:
  lo que se lee cuando falla es esa frase.
- Nada de tocar `~/.code-review-steps` ni el repositorio: directorios temporales
  con `mkdtemp` y limpieza en `t.after`.

## Integración continua

`.github/workflows/ci.yml` pasa tipos, lint y tests en **Node 20, 22 y 24**, y
compila. La cobertura va en un trabajo aparte porque los umbrales
(`--test-coverage-lines` y compañía) no existen antes de Node 22.

## MCP Inspector

`make inspect` lo abre. El Inspector está instalado como dependencia de desarrollo, así que la versión
queda fijada en el lockfile y no hay que descargarlo en cada ejecución.

### Modo UI

```bash
pnpm inspect
```

Abre la interfaz web del Inspector y arranca el servidor por debajo con
`node dist/index.js`. Desde ahí puedes listar tools, resources y prompts,
invocarlos con argumentos y ver el tráfico JSON-RPC en crudo.

### Modo CLI

No abre navegador: ejecuta un método, imprime el resultado y termina. Es lo que
conviene para smoke tests y para scripts.

```bash
# Listar los primitivos
pnpm inspect:cli --method tools/list
pnpm inspect:cli --method resources/list
pnpm inspect:cli --method prompts/list

# Consultar un PR
pnpm inspect:cli --method tools/call --tool-name get_pr_info \
  --tool-arg pr=14148 --tool-arg repo=cli/cli

# O pegando la URL, sin indicar el repositorio
pnpm inspect:cli --method tools/call --tool-name get_pr_info \
  --tool-arg pr=https://github.com/cli/cli/pull/14148

# Archivos que toca el PR, desde el clon local
pnpm inspect:cli --method tools/call --tool-name get_pr_files \
  --tool-arg pr=200 --tool-arg repo=/Users/tu/github/tu-repo

# Diff de uno de esos archivos
pnpm inspect:cli --method tools/call --tool-name get_file_diff \
  --tool-arg reviewId=<el que devolvió start_review> \
  --tool-arg pathId=<el pathId que devolvió get_pr_files>

# Leer el resource
pnpm inspect:cli --method resources/read --uri review://checklist
```

Para probar con un token concreto sin dejarlo en el historial del shell:

```bash
CODE_REVIEW_MCP_GITHUB_TOKEN="$(gh auth token)" pnpm inspect:cli \
  --method tools/call --tool-name get_pr_info --tool-arg pr=14148 --tool-arg repo=cli/cli
```

### Sin el Inspector

También puedes hablar el protocolo a mano por stdin, útil cuando quieres ver los
mensajes exactamente como los recibe el servidor:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0.0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node dist/index.js
```

## Estructura del proyecto

```
Makefile           # instalación y mantenimiento
.github/workflows/
└── ci.yml         # tipos, lint y tests en Node 20, 22 y 24
commands/
└── revisar-pr.md  # el slash command, se copia a ~/.claude/commands/
rulesets/
└── java.xml       # PMD quickstart con el naming de tests ajustado
scripts/
├── check.sh       # comprobación del entorno (make check)
└── github-token.sh # resolución y validación del token (make register)
src/
├── index.ts          # entrypoint: crea el servidor y lo conecta a stdio
├── server.ts         # construye el McpServer y registra cada primitivo
├── errors.ts         # UserFacingError: errores pensados para que los lea el modelo
├── changed-files.ts  # archivos del PR según git, normalizados
├── file-diff.ts      # diff de un archivo concreto del PR
├── static-analysis.ts # orquesta los analizadores y aísla lo que el PR introdujo
├── draft/
│   ├── draft.ts      # modelo del borrador y estados de cada comentario
│   ├── server.ts     # servidor local en 127.0.0.1, puerto libre del sistema
│   └── page.ts       # la página: markdown renderizado sin dependencias
├── extensions/
│   └── extension.ts  # carga de las extensiones declarativas
├── review/
│   ├── fixes.ts        # los comentarios convertidos en trabajo por hacer
│   ├── persistence.ts  # exportar y retomar una revisión desde un archivo
│   ├── session.ts      # estado compartido: commits, tarea, archivos, hallazgos, comentarios
│   ├── task-context.ts # qué pedía la tarea, resuelto una vez por revisión
│   └── comments.ts     # modelo y formato de los comentarios del agente
├── analysis/
│   ├── types.ts          # Finding común, severidad normalizada, contrato Analyzer
│   ├── changed-lines.ts  # líneas que el PR añadió o modificó, por archivo
│   ├── baseline.ts       # copia temporal de la versión base, vía git archive
│   ├── docker.ts         # alternativa en contenedor: montaje ro, uid, red
│   ├── registry.ts       # qué analizador mira qué archivos
│   ├── run-tool.ts       # ejecutor común: exit codes, timeouts, "no instalado"
│   ├── sarif.ts          # lector SARIF, compartido por detekt y Semgrep
│   ├── pmd.ts            # Java
│   ├── detekt.ts         # Kotlin
│   ├── golangci.ts       # Go
│   ├── eslint.ts         # JS/TS
│   ├── ruff.ts           # Python
│   └── semgrep.ts        # transversal
├── git/
│   └── git.ts            # wrapper de git: cwd, timeout, resolución de refs
├── github/
│   ├── gh.ts             # wrapper del CLI gh: entorno, cwd, timeout y errores
│   ├── pr-query.ts       # localiza el PR y resuelve sus ramas y su estado
│   ├── repo-target.ts    # interpreta el repositorio y la referencia al PR
│   └── pull-request.ts   # consulta del PR y normalización del pipeline
├── tools/            # un archivo por tool + un index que las registra
├── resources/        # un archivo por resource + un index que los registra
└── prompts/          # un archivo por prompt + un index que los registra
test/                 # espeja src/: test/analysis/sarif.test.ts prueba src/analysis/sarif.ts
└── helpers/
    ├── repo.ts       # repositorio git temporal, para lo que lee un clon de verdad
    ├── env.ts        # variables de entorno de un solo test, restauradas al salir
    ├── session.ts    # una ReviewSession de ejemplo
    ├── dom.ts        # el DOM mínimo que toca el script de la página
    └── page.ts       # ejecuta ese script contra el servidor de borrador real
```

## Añadir un primitivo nuevo

1. Crea el módulo dentro de `tools/`, `resources/` o `prompts/`, exportando una
   función `registerX(server)`.
2. Añade una línea al `index.ts` de esa carpeta. `server.ts` no se toca.

## Convenciones

- **Nunca escribir en stdout.** Con el transporte stdio, stdout es el canal del
  protocolo; todo log tiene que ir a `stderr` (`console.error`).
- **`gh` se ejecuta con `execFile` y lista de argumentos, nunca a través del
  shell.** Los argumentos llegan del modelo y no pueden acabar interpretados como
  una línea de comando. El argumento `repo` se valida además contra
  `owner/nombre`.
- Un fallo de GitHub se devuelve como resultado con `isError: true` y un mensaje
  accionable, no como una excepción que tumbe la llamada.
- **Los argumentos opcionales no llevan validaciones de formato en el schema.**
  Los clientes suelen mandar `""` en vez de omitir el campo, y una validación en
  el schema se dispara antes que el handler, devolviendo un error de protocolo
  (`-32602`) en lugar de un mensaje útil. El formato se valida al normalizar el
  argumento, ya dentro del código.
- El código fuente es ESM con `module: NodeNext`, así que los imports relativos
  llevan extensión `.js` aunque los archivos sean `.ts`.
- `registerTool` recibe un *shape* de Zod (un objeto plano de validadores), no un
  `z.object(...)`. El SDK deriva el JSON Schema a partir de él.
- El código y sus comentarios van en inglés; la documentación, en español. Los
  tests son código: van en inglés, nombres de test incluidos.
- **Un cambio de comportamiento llega con su test.** Ninguno de los fallos que
  han aparecido hasta ahora se veía leyendo el código: un cuerpo de varios
  párrafos que se salía del blockquote de la alerta, o `git ls-tree` citando las
  rutas con acentos y devolviéndole a git una forma que no casa con nada. Los dos
  necesitaban que algo los ejecutara.
- **La página del borrador no guarda estado que no esté en el servidor.** Cada
  acción reconstruye la lista entera, así que cualquier cosa a medio escribir es
  algo que hay que salvar de cada clic. Por eso el único campo que queda es el
  editor del comentario, que tiene su botón de guardar; lo que hace falta contar
  se cuenta en la conversación, no en la página.

## Licencia

MIT — ver [LICENSE](LICENSE).

Las dependencias son todas permisivas (MIT, ISC, BSD). Los analizadores que el
servidor ejecuta tienen licencias propias, algunas copyleft (`golangci-lint` es
GPL-3.0, Semgrep LGPL-2.1), pero se ejecutan como **procesos separados** y no se
redistribuyen con este código, así que no imponen sus condiciones sobre él. Eso
cambiaría si algún día se empaquetaran dentro de una imagen propia.

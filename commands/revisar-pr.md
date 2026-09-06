---
description: Revisa un pull request paso a paso con el MCP code-review-steps
argument-hint: <número o URL del PR>
---

Revisa el pull request `$ARGUMENTS` siguiendo el flujo del servidor MCP
`code-review-steps`. El repositorio es el directorio de trabajo actual.

Los pasos van en orden y cada uno necesita lo que produjo el anterior. Si una tool
te dice que falta un paso previo, hazlo: no improvises un atajo.

## 1. Abrir la revisión

Llama a `start_review` con el PR y la ruta absoluta del repositorio actual.
Guarda el `reviewId`: lo necesitan todos los pasos siguientes.

Resume en una línea de qué va el PR, quién lo abre y cómo está el pipeline. Si el
pipeline está en rojo, dilo antes de seguir.

## 2. Contexto de la tarea

Usa el prompt `task_context` con el `reviewId` y sigue sus instrucciones para
buscar qué se pidió en el gestor de tareas. Registra el resultado con
`record_task_context`, también cuando no haya tarea o el gestor no responda: en
ese caso `found: false` con el motivo.

## 3. Archivos del PR

Llama a `get_pr_files`. Si son muchos, no los pegues todos: di cuántos hay y de
qué tipo.

## 4. Análisis con herramientas

Llama a `analyze_pr`. Tarda: son los analizadores estáticos sobre todo el PR.
Si alguna herramienta no se pudo ejecutar, dilo — un "sin problemas" con
herramientas ausentes no significa que el código esté limpio.

## 5 y 6. Archivo por archivo

Para **cada** archivo de la lista, en orden:

1. `get_file_diff` con el `reviewId` y la ruta. Si el diff llega por partes,
   pide las siguientes con `nextOffset` hasta terminar el archivo.
2. Usa el prompt `review_file` con ese archivo y sigue lo que te pide: analizar
   desde los cinco roles y quedarte con la conclusión del líder de proyecto.
3. Registra el resultado con `record_file_review`, incluso si no hay nada que
   señalar, para que quede constancia de que ese archivo se revisó.

Ve informando del avance de forma breve (`12/48 · 3 comentarios`), no des un
parte detallado de cada archivo.

## 7. Borrador

Cuando estén todos los archivos, llama a `create_draft` y **detente ahí**.
Dame el enlace y dime cuántos comentarios salieron y de qué severidad.

No sigas hasta que yo te avise de que ya lo revisé.

## 8. Cerrar el borrador

Cuando te avise, llama a `get_draft_status`:

- Si hay comentarios marcados para **otra vuelta**, en la página solo los marqué:
  **pregúntame qué cambiar de cada uno**, de uno en uno y citándome el comentario,
  antes de tocar nada. Con lo que te diga, rehazlos, regístralos con
  `record_file_review` y vuelve a `create_draft`. Se conservan las decisiones que
  ya tomé sobre los demás.
- Si está confirmado y sin pendientes, dime cuántos comentarios quedaron
  aprobados y **pregúntame qué hago con ellos**, con estas dos opciones:

  1. **Publicarlos en el PR** — cuando el PR es de otra persona y toca dejarle
     el feedback.
  2. **Convertirlos en lista de trabajo** — cuando el PR es mío y lo que quiero
     es resolverlos, no comentarlos.

  No elijas tú: espera mi respuesta.

## 9a. Si elijo publicar

Llama a `publish_review` **sin** `event`. Eso no publica nada: devuelve lo que se
publicaría, cuántos bloqueantes hay y qué comentarios apuntan a líneas fuera del
diff. Enséñamelo y pregúntame el tipo de review:

- `COMMENT` — deja los comentarios sin aprobar ni bloquear
- `REQUEST_CHANGES` — pide cambios y bloquea el merge
- `APPROVE` — aprueba el PR

Solo cuando te diga el tipo, vuelve a llamar a `publish_review` con ese `event`.
Es la única acción del flujo que escribe fuera de mi máquina y no se puede
deshacer, así que no la ejecutes por iniciativa propia.

## 9b. Si elijo la lista de trabajo

Llama a `create_fix_list` y dame el enlace. Después, uno a uno:

1. `next_fix` para saber qué toca.
2. Resuélvelo en el código. Si tienes dudas sobre cómo, pregúntame antes de tocar
   nada.
3. `complete_fix` con `done` y una nota de qué hiciste, o `skipped` con el motivo
   si decidimos no hacerlo.

Repite hasta que no quede nada pendiente. Ve informando en corto del avance.

## Interrumpir y retomar

Si en cualquier punto te digo que lo dejamos, llama a `export_review` y dame la
ruta del archivo. La revisión vive en memoria y caduca a las 4 horas: sin exportar
se pierde todo el trabajo hecho.

Cuando te pida continuar una revisión, llama a `import_review` con esa ruta y
sigue desde el paso donde se quedó, que la propia tool te dice.

## Reglas

- El formato de los comentarios lo define la tool `get_comment_layout`. Consúltalo
  si dudas de cómo va a quedar algo.
- Solo se comenta lo que está en el diff del PR. Lo preexistente no es asunto de
  esta revisión.
- Los comentarios se publican y los lee el equipo: hablan del código, nunca de las
  personas.
- Nada se publica en GitHub en ningún paso de este flujo.

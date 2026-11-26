# Diagnóstico de 69 escenarios sin operaciones — 25/11/2026

## Alcance y evidencia

Corte original de SQLite: **25/11/2026 17:52:47 ART**. Las secciones 1–8 reconstruyen los 69 registros de ese corte. La comprobación final se amplió hasta **25/11/2026 22:55:34 ART** y se documenta por separado al final, porque producción siguió operando durante la auditoría. Ventana principal desde **24/11/2026 10:23:32 ART**, arranque del backend con PR #7. Todos los horarios de este informe son ART (UTC−3).

GitHub `master` y el checkout limpio de producción: `f3e0a446bbff4b2c683ffc6a1d4a15db7cce4edd`. PR #7 fue fusionado como `66a87fc4` el 24/11 a las 10:14:24. El backend arrancó a las 10:23:32; el frontend fue actualizado posteriormente. Se verificaron en el JavaScript del contenedor las funciones de auditoría del PR #7 y el defecto de identidad de Gemini. La imagen del backend es `sha256:f03bf66ec7cf5074bdb6ea469d8c7630eafb1707acc1190a5d20a9160ec9300a`; el commit del checkout no constituye por sí solo una etiqueta de procedencia de esa imagen.

Se abrió SQLite con `readOnly: true`, se exportaron las tablas operativas dentro de una única transacción de lectura y se reconstruyó una copia SQLite local. `PRAGMA quick_check`: **ok**. No se copiaron tablas de credenciales ni sesiones. Los datos de trabajo están en `scratch/diagnosis-20261125/`, excluido de Git. SHA-256 de la copia lógica SQLite: `04b7216481d9e82ebc447ce8fb3fb561198c27f30b4936a898655467aae19d4b`.

Evidencias locales: `operational-copy.sqlite`, `audit.json`, `summary.json`, `ai-status.json`, `scheduler.json`, `provider-runtime.json`, `backend.log`, `audits.json`, `replay.json`, `events.json`, `bybit-5m.json`, `bybit-15m.json`. Los 23 candidatos y su recálculo están en [el CSV adjunto](diagnosis-2026-11-25-candidates.csv). Los snapshots originales y las políticas utilizadas permanecen en la copia local.

No se modificó producción, SQLite productiva, presupuestos, riesgo ni Kill Switch. No hubo reinicios, órdenes, llamadas pagas de prueba, merge ni despliegue.

## 1. Diagnóstico principal

**Los 69 registros no representan 69 operaciones rechazadas. Son 65 observaciones neutrales y 4 hipótesis direccionales anteriores al PR #7.** Después del despliegue se propusieron 23 candidatos —20 SHORT y 3 LONG— y ninguno superó la construcción determinista del escenario. Por eso no hubo zonas direccionales, revalidaciones ni entradas paper posteriores.

Hay tres causas distintas:

1. **Propuestas no elegibles:** 14 fallan primero por verificación estructural y 9 por R:R. El recálculo independiente de los 23 muestra 22 sin ningún objetivo que alcance 4R netos. El restante alcanza 4,89R con un objetivo de 58.200 que no tiene anclaje verificable en su snapshot.
2. **Gemini no participa correctamente:** 29 intentos sin respuesta válida. El estado actual del adaptador muestra `HTTP_503`; un defecto de identidad de modelo impide conservar correctamente el error y consultar la pausa desde descubrimiento. No se puede reconstruir el HTTP exacto de cada uno de los 29 intentos.
3. **Cobertura bloqueada por presupuesto:** desde el 25/11 a las 09:00, 16 análisis terminan `BUDGET_BLOCKED`. El límite específico de OpenAI es USD 0,40; el gasto bruto diario pertinente era USD 0,3983 y la reserva requerida USD 0,0192. Aunque el resumen global dice `OK` y quedan USD 4,5886 diarios, esa llamada no cabe en el límite por proveedor.

No se ha demostrado ninguna operación histórica elegible que el parche de Gemini convierta automáticamente en trade. Sí se ha demostrado una falla operativa que dificulta la recuperación y el diagnóstico del proveedor.

## 2. Distribución real y reconstrucción de los 69

Por fecha de creación del escenario:

| Clase final | Antes del despliegue | Después | Total |
|---|---:|---:|---:|
| Observación neutral: ruptura/completada, sin trade | 24 | 7 | 31 |
| Observación neutral: reemplazada por nuevo análisis | 0 | 20 | 20 |
| Observación neutral: cancelada tras revisión IA | 5 | 0 | 5 |
| Observación neutral: expirada | 9 | 0 | 9 |
| LONG: invalidado por precio | 1 | 0 | 1 |
| SHORT: invalidado por precio | 1 | 0 | 1 |
| SHORT: cancelado tras revisión IA | 2 | 0 | 2 |
| **Total** | **42** | **27** | **69** |

Una de las nueve observaciones antiguas expiró después del despliegue. La tabla clasifica cohortes por creación; no confunde esa expiración con una observación nueva. No hubo expiraciones direccionales. Cero autorizaciones, entradas o cierres paper en toda la base.

Rechazos de candidatos posteriores al PR #7, contando el primer motivo registrado:

| Motivo real | Cantidad | % de 23 candidatos |
|---|---:|---:|
| `UNVERIFIED_STRUCTURAL_LEVELS` | 14 | **60,87%** |
| `RR_UNQUALIFIED` | 9 | 39,13% |
| `RR_POLICY_REJECTED` | 0 | 0% |
| `INVALID_ENTRY_GEOMETRY`, `INVALID_STOP_SIDE`, `ENTRY_DRIFT`, `MISSING_STRUCTURAL_TARGET`, `INVALID_TARGET` | 0 | 0% |

Los 16 bloqueos de presupuesto y los 2 análisis sin proveedor válido no son candidatos rechazados. Tampoco hay rechazos posteriores por consenso o condiciones no automatizables: el flujo nunca llegó a esas etapas.

**Qué falla estructuralmente:** los 14 rechazos incluyen el objetivo extendido; uno también incluye el corto. No faltan todas las estructuras: hay swings, OB, FVG y VWAP. `verifyProposedLevels` compara los niveles con los swings activos, rangos OB/FVG activos y VWAP, con sus tolerancias actuales. Los objetivos extendidos propuestos quedan fuera de ese conjunto.

Hay una diferencia entre el contexto enviado y el conjunto aceptado: `recentSwings` se envía a los modelos pero no se usa como ancla en ese validador. En 6 candidatos hay al menos un nivel rechazado cercano a uno de esos swings; en 5, todos los niveles rechazados tendrían esa coincidencia. **Los cinco siguen sin alcanzar 4R netos.** No se amplió el conjunto de anclas: que un swing aparezca en el contexto no demuestra que siga siendo un objetivo válido o no mitigado.

Ejemplos verificables:

- 24/11 12:45: SHORT, entrada 59.900, SL 60.667, objetivos 59.360 / 58.700. El último no coincide con anclas aceptadas; R:R netos recalculados **0,57 / 1,35**. Aceptar el swing histórico no habilitaría el trade.
- 24/11 15:00: SHORT, entrada 60.600, SL 61.000, objetivos 59.400 / 58.200. Netos **2,39 / 4,89**. El objetivo que supera 4R carece de ancla, incluso buscando coincidencias en los swings recientes del snapshot.
- 24/11 18:00: LONG, entrada 59.748, SL 59.151, objetivos 60.943 / 62.138. Brutos **2 / 4**, netos **1,69 / 3,46** después de costos. El descarte por R:R está respaldado.

Distribución de R:R: mínimo / mediana / máximo. Para los 9 `RR_UNQUALIFIED` son los cálculos persistidos; para los otros 14 es recálculo aislado con su snapshot y política, sin simular fills.

| Grupo | Corto bruto | Corto neto | Extendido bruto | Extendido neto |
|---|---|---|---|---|
| 9 `RR_UNQUALIFIED` | 0,92 / 1,41 / 2,07 | 0,50 / 1,09 / 1,69 | 1,92 / 2,51 / 4,00 | 1,25 / 1,94 / 3,46 |
| 14 estructurales | 0,68 / 1,105 / 3,00 | 0,54 / 0,895 / 2,39 | 1,41 / 2,29 / 6,00 | 1,20 / 1,89 / 4,89 |

## 3. Embudo operativo y estado de producción

| Etapa | Anteriores al PR #7 | Posteriores |
|---|---:|---:|
| Solicitudes registradas en `discovery_analyses` | No instrumentado | 45 |
| Ejecuciones finalizadas, incluidos fallos/bloqueos | No instrumentado | 45 |
| Análisis con al menos una respuesta IA válida | No reconstruible exactamente | 27 |
| Análisis con llamadas a proveedores | No reconstruible exactamente | 29 |
| Sin propuesta direccional | No instrumentado | 4 |
| Propuestas LONG / SHORT | No instrumentado | 3 / 20 |
| Candidatos rechazados antes del registro | No instrumentado | 23 |
| Escenarios direccionales aceptados | 4 | 0 |
| Escenarios direccionales con zona confirmada | 2 | 0 |
| Revalidaciones direccionales, eventos | 3 | 0 |
| Señales autorizadas | 0 | 0 |
| Entradas paper | 0 | 0 |
| Cierres TP / SL | 0 / 0 | 0 / 0 |

Las 36 revalidaciones neutrales antiguas no forman parte del embudo de operaciones. En las tres direccionales, OpenAI respondió WAIT; Gemini respondió APPROVE una vez y REJECT dos veces. Hubo espera por absorción/volumen sin confirmar y rechazos por degradación de la zona; las razones completas están en `scenario_revalidations.details_json`. No se reinterpretan esas opiniones históricas como pruebas de rentabilidad.

La primera pérdida de todos los candidatos efectivamente propuestos ocurre **antes de registrar una hipótesis direccional**. Desde las 09:00 del día 25, la pérdida ocurre aún antes: en la reserva presupuestaria.

Estado observado:

- Backend, PostgreSQL y Redis propios: saludables; frontend propio en ejecución. Solo se inspeccionaron contenedores del proyecto.
- `SIGNALS_ONLY` confirmado en API y configuración cargada; Kill Switch inactivo, sin cambios.
- WS conectado, último mensaje 8 ms antes de `/health`, cero gaps reportados. Velas cerradas presentes en los seis marcos; sus edades desde apertura eran compatibles con sus intervalos.
- Scheduler activo, sin ejecución concurrente ni pausa global vigente, 27 ejecuciones con escenarios y cero escenarios activos. Intervalo 60 min, cooldown 15 min, movimiento 1,5%, disparos 1h y estructura 15m habilitados.
- 11 disparos registrados por cambio estructural 15m, 6 por ruptura neutral y uno por movimiento de 1,77%, además de cierres horarios y timer. Máxima separación entre solicitudes auditadas: 60,61 min. Se registraron 11 mensajes de cooldown, uno de backoff y uno de estructura sin cambios; los logs suprimen repeticiones, por lo que no equivalen al total de ticks bloqueados.
- Veinte neutrales fueron reemplazados: no hay evidencia de que el antiguo bloqueo por neutral siga siendo la causa. No hubo candidatos aceptados sobre los cuales la deduplicación pudiera suprimir una oportunidad posterior.
- Presupuesto global USD 5/día, 20/mes, 0,05/solicitud; límites por proveedor OpenAI 0,40 y Gemini 0,40. Reservas pendientes: cero. Las 29 faltas de respuesta Gemini se contabilizan conservadoramente como `UNCERTAIN_TIMEOUT`, con latencia cero: **ese nombre no prueba 29 timeouts reales**.

## 4. Contraste con mercado real

Se consultó la [API oficial Bybit V5 Kline](https://bybit-exchange.github.io/docs/v5/market/kline), `BTCUSDT`, `linear`, intervalos 5 y 15 minutos. Se conservaron URL, respuesta y fecha de consulta. Hay 426 velas de 5m y 142 de 15m incluyendo cuatro horas de contexto previo; no hay saltos entre timestamps. Se excluyó la vela todavía abierta del análisis de eventos.

Se eligieron ocho velas de 15m de mayor movimiento absoluto apertura–cierre, separadas al menos una hora. **La selección del movimiento es retrospectiva; la evidencia técnica utilizada es exclusivamente el último snapshot cuyo análisis había terminado antes de abrir esa vela.** No se afirma que su máximo/mínimo fuese predecible ni que tocar una zona garantice fill.

| Evento ART | Apertura → cierre; rango | Contexto conocido antes | Análisis y propuesta previa | Por qué no hubo señal / evaluación |
|---|---|---|---|---|
| 24/11 12:00–12:15 | 60.413,1 → 59.947,9 (−0,770%); 59.860–60.509,5 | Snapshot 11:00: 15m/1h bajistas, high 60.628,8, low 59.360,3 | Ambos proveedores sin respuesta válida; ninguna propuesta | Pérdida de cobertura del proveedor. Sesgo bajista detectable; entrada con SL/TP elegibles no demostrada. |
| 24/11 14:00–14:15 | 59.390,9 → 59.841,0 (+0,758%); 59.231–60.084,3 | Snapshot 13:00: bajista, high 60.666,5, low 59.716,9 | OpenAI SHORT 59.900 / SL 60.667 / TP 59.360 y 58.700; Gemini sin respuesta | TP extendido no verificado, netos 0,57/1,35. Descarte legítimo; el rebote no prueba un LONG causalmente confirmado. |
| 25/11 06:00–06:15 | 59.391,8 → 59.048,2 (−0,579%); 59.013,4–59.409,4 | Snapshot 05:00: bajista, EQH 59.380 y EQL 58.961,9 | OpenAI SHORT 59.200 / SL 59.650 / TP 58.571 y 58.132; Gemini sin respuesta | Netos 1,09/1,92. Dirección compatible con la caída, trade no elegible por R:R. |
| 25/11 10:30–10:45 | 58.822,6 → 58.269,6 (−0,940%); 58.185–58.880,9 | Snapshot 10:15: bajista, low previo 58.425,5 | Reserva bloqueada; ningún modelo consultado | La ruptura del low puede detectarse al confirmarse el cierre, pero no se evaluó un plan nuevo. Cobertura perdida por límite; trade válido no demostrado. |
| 25/11 11:45–12:00 | 57.354,1 → 58.210,9 (+1,494%); 57.257–58.244 | Snapshot 11:00: bajista, precio 58.053,1; el mínimo 57.257 aún no era conocido | Presupuesto bloqueado; ninguna propuesta | El rebote se observa después. No puede asignarse anticipadamente una compra al mínimo. |
| 25/11 13:00–13:15 | 58.309,3 → 58.625,9 (+0,543%); 58.245–58.699 | Snapshot 12:00: bajista, LH 58.896,5 | Presupuesto bloqueado; ninguna propuesta | Rebote sin ruptura de ese high en la vela elegida; no demuestra confirmación LONG. |
| 25/11 14:00–14:15 | 58.589,7 → 59.224,7 (+1,084%); 58.429,3–59.439,4 | Snapshot 13:00: LH 58.700 y LL 57.257 conocidos | Presupuesto bloqueado; ninguna propuesta | Ruptura de 58.700 verificable al cierre: evento razonable para reevaluar. No prueba por sí solo retesteo, consenso ni 4R. |
| 25/11 16:15–16:30 | 59.892 → 60.200,5 (+0,515%); 59.892–60.380 | Snapshot 15:45: 15m alcista y 1h en rango; precio 59.650,6 | Presupuesto bloqueado; ninguna propuesta | El cambio de régimen ya estaba en el snapshot, pero no llegó a modelos. Omisión de análisis demostrada; omisión de trade elegible no demostrada. |

La falta de respuesta de Gemini no debe interpretarse como aprobación ni como sesgo neutral. En las filas presupuestarias, ambos proveedores figuran `NOT_REQUESTED`.

## 5. Defecto demostrado y límites de la arquitectura

**Identidad inconsistente de Gemini — corregida en la rama independiente.**

- `backend/src/ai/router/ai-router.ts`, `AiModelRouter.routeModel`: AUTOMATIC/HYBRID podían devolver `gemini-2.0-flash` sin normalizar antes de calcular precio y reservar.
- `backend/src/ai/gemini-adapter.ts`, `evaluateWithCustomPrompt`: ya redirigía ese nombre a `gemini-2.5-flash` y guardaba su fallo/pausa bajo el nombre efectivo.
- `getDiscoveryHealth`: buscaba literalmente el alias recibido. Descubrimiento veía ausencia de error y pausa, reservaba con el modelo anterior y persistía `NO_VALID_RESPONSE`. La pausa interna del adaptador podía impedir la solicitud, pero el llamador no lo sabía y podía contabilizar una respuesta ausente como incierta.
- Evidencia: configuración guardada `gemini-2.5-flash`, router automático, 29 registros auditados/contables bajo `gemini-2.0-flash`, estado actual `HTTP_503`. Dos pruebas deterministas fallaron antes del parche: selección 2.0 en lugar de 2.5 y código HTTP nulo al consultar el alias. Ahora pasan, junto con una prueba de descubrimiento completo que verifica pausa antes de reservar y recuperación posterior.

**R:R efectivo:** política administrativa versión 3, `minNetRR=4`, `minRRShort=2`, `minRRExtended=4`, `RR_BOTH`. El piso efectivo es `max(minNetRR, mínimo del objetivo)`: **4 para ambos**. Un corto de 2,5R netos y un extendido menor a 4R se rechazan; no es una relajación implícita. El valor 4 fue persistido en una actualización administrativa. El nombre “1:2” puede inducir a error si se omite ese piso global. Candidatos observados descartados **exclusivamente** por exigir 4 en lugar de 2: **cero**. El único corto neto mayor a 2 es 2,39, pero su propuesta también contiene un objetivo extendido sin anclaje.

**Calidad de propuestas:** OpenAI tuvo 20 respuestas BEARISH y 7 NEUTRAL; 4 no propusieron nada y 3 NEUTRAL incluyeron un LONG. Los niveles de esos tres LONG coinciden exactamente con el ejemplo numérico del prompt basado en el precio redondeado: SL −1%, TP +2% y +4%. Eso explica su geometría bruta 2R/4R y neta aproximada 1,69R/3,46R. La coincidencia está demostrada; que eliminar el ejemplo produzca mejores propuestas no está demostrado sin nueva evidencia. No se ejecutó una optimización ni se cambiaron prompts para aumentar operaciones.

**Vigencia/condiciones:** las cuatro hipótesis antiguas tenían 12h de vigencia, ninguna expiró. Dos confirmaron zona; dos se invalidaron al cruzar SL. Una contenía una condición de patrón compuesta no automatizable. El LONG requería patrón de vela, cierre sobre EMA20 y BOS; cruzó SL unos 12,5 minutos después de registrarse. No hay evidencia de una expiración que impidiera esperar confirmaciones en esas cuatro. Los 23 candidatos posteriores fueron rechazados antes de construir planes; la auditoría guarda sus niveles y decisiones, pero no el JSON completo de sus condiciones. Por ello no se puede probar alcanzabilidad temporal de cada plan original rechazado.

## 6. Corrección realizada y propuestas pendientes

El parche normaliza el modelo seleccionado **antes de precio, reserva, solicitud y auditoría** y permite consultar la salud por alias. Conserva la pausa por modelo, el intento único por reserva y los controles de presupuesto. No cambia el proveedor ni el modelo que el adaptador ya ejecutaba. La reserva Gemini puede aumentar al usar el costo del modelo efectivo; no se aumentó ningún límite.

Propuestas administrativas o de diseño, **no aplicadas**:

- Si el objetivo administrativo es que rijan únicamente los topes globales USD 5/día y 20/mes, el cambio concreto es `providerLimits: {}` conservando `maxCostPerRequestUsd: 0.05`. Esto requiere autorización: elimina el sublímite 0,40 y puede consumir el presupuesto mensual más rápido. Habría eliminado el bloqueo específico de los 16 análisis, pero no garantiza respuestas Gemini ni trades.
- Mantener el piso 4R y presentar “objetivo corto — mínimo efectivo 4R” mientras esté vigente. Bajar a 2R modificaría la política del proyecto y no rescata por sí solo ninguno de estos 23 candidatos.
- Sustituir los precios ilustrativos del prompt por un contrato sin niveles calculados artificialmente, y exigir referencia a anclas verificables. Afecta directamente el patrón observado en 3 candidatos. Mejorar propuestas futuras es una hipótesis a validar; no debe estirarse el TP para fabricar 4R.
- Alinear/documentar las anclas que reciben los modelos con las que acepta el motor. Ampliar a swings históricos sin verificar vigencia aumentaría falsas confluencias; no se hizo. Cinco candidatos cambiarían su primer motivo de rechazo, pero seguirían sin 4R.

Una operación elegible necesita un objetivo estructural verificable con beneficio neto ≥4 veces la pérdida neta, zona y SL coherentes, datos recientes, restricciones administrativas satisfechas, condiciones del watcher alcanzadas y doble validación. La magnitud de una vela aislada no sustituye esos requisitos.

## 7. Prueba integral paper

La prueba de integración ahora recorre, con fixtures locales y evaluador dual simulado:

`Hipótesis direccional → watcher → zona → revalidación APPROVE/APPROVE → ENTRY_VALIDATED → señal SQLite → ENTRY_TRIGGERED → TRACKING → COMPLETED_TP / COMPLETED_SL`.

Verifica entrada persistida, actualización durante seguimiento, precio/hora de salida, signo del PnL neto y lifecycle. Cierra la base en disco, la reabre y compara el registro completo. El SL usa un precio observado 50 USDT más allá del stop para comprobar la salida desfavorable. Las notificaciones y el proveedor están simulados; no hay órdenes ni IA paga. Esto prueba capacidad técnica de simulación, no ejecución real ni rentabilidad.

Validación focalizada: **45/45 pruebas** en `gemini-discovery-recovery`, `discovery-audit-regression`, `config-risk-router`, `autonomous-analysis-cost-controls`, `waiting-confirmation-budget-recovery` y `autonomous-pipeline-e2e`. Incluyen el caso explícito de objetivo corto 2,5R netos y extendido inferior a 4R, rechazado por la política efectiva. TypeScript backend `--noEmit` aprobado. Se usó una clave local ficticia exclusivamente para el test de cifrado. No se ejecutaron backtests ni suites generales repetidas.

## 8. Resultado final

**Combinación: falla operativa demostrada en Gemini + configuración presupuestaria que corta cobertura + propuestas históricas descartables bajo la política vigente.**

No se ha demostrado que la arquitectura cuantitativa sea excesivamente restrictiva ni que el parche produzca una frecuencia mínima de operaciones. Los 69 no prueban 69 oportunidades perdidas. La corrección hace coherentes el proveedor efectivo, su presupuesto y su recuperación; el circuito paper ya es técnicamente capaz de abrir, seguir y cerrar. La cobertura autónoma actual seguirá limitada por el subpresupuesto y la disponibilidad del proveedor hasta resolverlos de forma autorizada.

## Actualización final — 25/11/2026 22:55 ART

Se obtuvo una **segunda copia lógica consistente**, también con `quick_check=ok`, en `scratch/diagnosis-20261125/final/`. No se sobrescribió la evidencia de los 69 originales. Se amplió la descarga Bybit hasta el nuevo corte: 62 velas adicionales de 5m y 20 de 15m, incluyendo solapamiento de límite y la vela abierta; los ocho eventos analizados arriba conservan su evidencia causal original.

Producción tiene ahora **71 registros: 70 finalizados y una observación neutral activa; cero hipótesis direccionales activas, señales o entradas paper**. Las dos observaciones adicionales provienen de candidatos LONG descartados. El primer neutral nuevo fue reemplazado por el segundo.

Hubo tres bloqueos presupuestarios adicionales a las 18:45, 19:45 y 20:45. El reinicio diario ocurre a las **21:00 ART (00:00 UTC)**. Después volvió a haber respuestas OpenAI, sin intervención nuestra:

| Hora | Propuesta OpenAI | Entrada / SL | TP corto / extendido | R:R netos | Resultado |
|---|---|---|---|---|---|
| 21:15 | BULLISH, LONG | 60.950 / 60.341 | 62.169 / 63.388 | 1,69 / 3,46 | `RR_UNQUALIFIED` |
| 22:00 | BULLISH, LONG | 60.504 / 59.899 | 61.714 / 62.924 | 1,69 / 3,46 | `RR_UNQUALIFIED` |

Gemini volvió a figurar sin respuesta válida y con el alias incorrecto en ambas auditorías; su estado vigente conserva `HTTP_503`. Los dos nuevos LONG también reproducen los niveles del ejemplo porcentual del prompt. Son **cinco propuestas de ese patrón sobre 25** en la ventana extendida, todas por debajo de 4R netos.

Embudo acumulado posterior al PR #7 hasta las 22:55: **50 solicitudes finalizadas → 31 con intentos de proveedores → 29 con respuesta válida → 25 propuestas (5 LONG, 20 SHORT) → 25 rechazadas → 0 escenarios direccionales → 0 zonas/revalidaciones/autorizaciones/entradas/cierres paper**. Resultados de análisis: 25 `CANDIDATES_REJECTED`, 4 `AI_NO_TRADE`, 19 `BUDGET_BLOCKED`, 2 `PROVIDER_UNAVAILABLE`.

Distribución final: **14 `UNVERIFIED_STRUCTURAL_LEVELS` (56%) y 11 `RR_UNQUALIFIED` (44%)**. Sigue sin haber candidatos perdidos exclusivamente por el piso global 4R frente al corto 2R. El nuevo par tiene 2R/4R brutos y 1,69R/3,46R netos. El CSV adjunto conserva los 23 candidatos del corte original; esta tabla documenta los dos adicionales y sus snapshots completos están en la segunda copia.

Gasto del nuevo día UTC: USD 0,049417; reservas cero. El campo `lastBudgetDenial` conserva la última denegación histórica, **no significa que el nuevo día siga bloqueado**. WS conectado, datos de 3 ms de antigüedad y cero gaps. Esto demuestra recuperación autónoma del scheduler tras el reset; el sublímite sigue configurado y puede volver a detener las llamadas cuando se alcance.

PR independiente: [#8](https://github.com/augustobx/nanotrading/pull/8). No fusionado ni desplegado. La disponibilidad Gemini y la calidad de propuestas siguen siendo limitaciones reales; no se atribuye al parche una rentabilidad ni una cantidad mínima de operaciones.

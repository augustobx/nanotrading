# NanoLabs AI Trading — Segunda auditoría autónoma, riesgo y costos
**Fecha:** 21/11/2026 · **Base auditada:** `master@50ad03a` · **PR:** #3
**Alcance:** código estático + CI de GitHub; NO incluye consultas al volumen SQLite ni ejecución prospectiva de mercados en el servidor.
**Modo seguro de despliegue:** `SIGNALS_ONLY`, sin ejecución real de órdenes.

## Diagnóstico: el gasto no era exclusivamente de «esperar zonas»
1. `AutonomousDiscoveryScheduler` ejecutaba el descubrimiento por reloj (60m), vela 1h, ruptura 15m, variación de precio y ruptura NEUTRAL incluso con planes activos. Además, `RANGE_BREAKOUT` evitaba cooldown y listeners anónimos podían acumularse tras start/stop.
2. `AlgorithmicWatcher` solicitaba revalidación nuevamente desde `WAITING_CONFIRMATION` en el siguiente tick; sus rupturas NEUTRAL no exigían el RVOL 1,2 que declaraba el plan. Un precio fuera de la zona podía contar como «IN_ZONE».
3. `AiMarketDiscoveryEngine` registraba NEUTRAL con rangos de ancho cero o niveles ±0,6% no respaldados por velas; también podía crear consenso aparente cuando ambas APIs fallaron.
4. `MarketCoordinator` exponía DOS canales automáticos que podían consumir tokens: consenso del setup tradicional y descubrimiento autónomo.
5. `HardBudgetManager` aplicaba alertas sobre neto, pero límites estrictos sobre bruto; `calculateCallCost` podía sumar dos veces reasoning tokens ya incluidos en completion. `logAiConsumption` suprimía errores de SQLite.
6. El descubrimiento preliminar todavía utilizaba 10.000 USDT/1% fijo y el setup técnico podía inspeccionar vela abierta, aunque la política administrativa configurara otros valores.

### Qué significaban las 109 llamadas
Los 109 registros entregados por el usuario no equivalen necesariamente a 109 descubrimientos; una evaluación dual son al menos dos llamadas. El panel mostraba US$0,9993 **brutos estimados**, US$0,0359 **netos registrados** y US$0,9634 de descuento **administrativamente declarado, no verificado en factura**. El hard limit debe seguir usando bruto. Sin la DB real no se puede asignar con rigor cada llamada a su disparador.

## Remediaciones incluidas en el PR #3
- **Orquestación:** NO llamar a IA mientras exista un escenario vigente vigilado; cooldown también para rupturas NEUTRAL; un solo descubrimiento concurrente; ventana de 4h si el régimen estructural sigue igual; backoff exponencial de 30m–4h si ambas APIs fallan; listeners desuscritos y contadores sin falsos éxitos.
- **Watcher:** 10+ velas anteriores cerradas y RVOL>=1,2 antes de disparar ruptura neutral; una solicitud por cierre de vela; WAITING_CONFIRMATION sin llamadas por tick, solo nuevo cierre+30min; última reevaluación persistida en payload JSON de SQLite.
- **Datos/zonas:** no generar un rango de vigilancia sin niveles reales ni ancho positivo; touch solo dentro del intervalo; indicadores/estrategias basados en velas cerradas.
- **Integridad de decisiones:** mercado sin respuestas IA no es «consenso neutral»; bloqueo económico conserva escenarios válidos esperando confirmación; solo una ruta automática de IA cuando el scheduler autónomo está habilitado.
- **Riesgo:** análisis de R:R inicial usa capital, porcentaje, spread y umbrales de la política real; setups con R:R incompatible con el mínimo administrativo se rechazan antes de vigilancia.
- **Economía:** alertas y reactivación comparan bruto + reservas, no neto promocional; no doble cuenta de tokens de razonamiento; ledger de IA deja de silenciar errores, bloquea futuras llamadas si falla y registra `analysis_id` por descubrimiento, reevaluación o setup.
- **Observabilidad:** dashboard distingue proveedor CONFIGURADO de proveedor comprobado; indicador de vigilancia local sin IA; gasto bruto comprometido/limite y recuento de escenarios observados.
- **Calidad:** pruebas unitarias nuevas para espera con costo cero, concurrencia, volumetría, reloj UTC/ART, escritura de ledger, recuperación, límites brutos y razonamiento; CI incluye TypeScript, Next y Docker.

## Criterios de aceptación obligatorios en producción
1. Confirmar SHA del PR fusionado, CI verde y backup/restauración aislada SQLite; no rotar `CONFIG_MASTER_KEY` nuevamente.
2. Mantener `SIGNALS_ONLY`; verificar Bybit REST/WS, vigencia de velas, ordenbook y Kill Switch.
3. Con un escenario vigente, mantener 60 minutos de ticks y cierres sin **ningún `MARKET_DISCOVERY` automático**. La observación algorítmica es US$0.
4. Si un plan queda `WAITING_CONFIRMATION`, exigir un nuevo cierre de vela apropiado y mínimo de 30 min antes de solicitar otra revalidación; no repetir en ticks.
5. Ante NEUTRAL, una mecha o volumen insuficiente no deben generar IA; cierre confirmado con RVOL>=1,2 debe generar como máximo un disparador, respetando cooldown y sin otro plan válido.
6. Ante error de ambas APIs, no registrar falso consenso. Registrar consumos de llamadas inciertas conservadoramente y su `analysis_id`.
7. Comparar gasto bruto por proveedor, modelo y tarea con límite diario/mensual; no descontar promociones estimadas en hard budget.
8. Verificar en UI que `2026-11-22T00:00:00Z` se muestra como 21/11/2026 21:00 ART, y no 09:00.
9. Realizar 24–48 h de forward **paper** sin resetear historial y comprobar transición: descubierto -> esperando -> zona -> confirmación -> validado -> fill observado -> TP/SL o expiración, con costos y PnL netos.
10. Confirmar `docker compose ps` antes/después y ausencia de reinicios de otras aplicaciones NanoLabs.

## Auditoría real de las 109 llamadas (SQL read-only en SQLite)
Ejecutar sobre el volumen correcto del servidor, sin exponer secretos ni modificar tablas:
```sql
SELECT task, provider, model, status,
       COUNT(*) AS calls,
       ROUND(SUM(COALESCE(cost_gross_usd,cost_usd)),6) AS gross_usd,
       ROUND(SUM(COALESCE(cost_net_usd,cost_usd)),6) AS net_usd,
       SUM(tokens_prompt) AS input_tokens,
       SUM(tokens_completion) AS output_tokens,
       SUM(tokens_reasoning) AS reasoning_subset
FROM ai_consumption_logs
WHERE timestamp >= (strftime('%s','now','start of day') * 1000)
GROUP BY task, provider, model, status
ORDER BY gross_usd DESC;
```
Para llamadas posteriores al PR #3, `analysis_id` permite agrupar gastos por decisión. Históricos anteriores sin `analysis_id` NO permiten atribución inequívoca al trigger.

```sql
SELECT analysis_id, task, COUNT(*) AS calls,
       ROUND(SUM(COALESCE(cost_gross_usd,cost_usd)),6) AS gross_usd
FROM ai_consumption_logs
WHERE timestamp >= (strftime('%s','now','start of day')*1000)
GROUP BY analysis_id,task ORDER BY gross_usd DESC LIMIT 30;
```

## Limitaciones que NO se deben ocultar
- Los registros de producción son necesarios para determinar qué porcentaje del gasto provenía de descubrimiento, consenso legado, reevaluación, pruebas manuales, fallos/reintentos o promociones estimadas.
- Las reservas de HardBudgetManager están en memoria: un proceso detenido en mitad de una solicitud podría perder una reserva no reconciliada. Hasta que exista un journal transaccional recuperable ante crashes, tratarlo como **riesgo residual** y mantener límites conservadores.
- El fingerprint de régimen estructural/cooldown del scheduler sigue siendo memoria de proceso; un reinicio puede volver a justificar un descubrimiento inicial. La DB conserva los escenarios y evita reanalizarlos si siguen vigentes.
- No hay comprobación independiente de descuentos de OpenAI, tarifas finales, pagos o resultados de trading; no confundir ahorro estimado con factura.
- Las pruebas automatizadas no acreditan rentabilidad ni eficacia prospectiva. No habilitar LIVE sin ensayo de fallos, inversión de la cartera y revisión humana.
- El repositorio NO proporciona una conexión SSH directa a este entorno de revisión: el deploy debe realizarse mediante proceso independiente y verificado.

**Condición de salida:** PR en verde, merge aprobado, despliegue conservador, telemetría real y forward paper confirmado. No declarar «100% listo» antes de esos cuatro hitos.

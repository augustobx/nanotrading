# Correcciones del descubrimiento — 23/11/2026

Base: `31c2cf6`. Rama local: `codex/fix-discovery-audit`.

## Comportamiento

- Una observación NEUTRAL ya no tiene exclusividad sobre el descubrimiento. Una estructura nueva o un movimiento significativo puede producir otro análisis, conservando cooldown, presupuesto, deduplicación y exclusión de llamadas simultáneas.
- Un nuevo análisis con escenario sustituye las observaciones neutrales anteriores; su cierre se registra como sustitución, conservando el historial.
- Los análisis persisten su snapshot, política, disponibilidad de proveedores, niveles propuestos, motivos de rechazo y escenarios resultantes. La clasificación distingue propuestas rechazadas de ausencia de propuesta y fallos del proveedor.
- Gemini distingue timeout, HTTP 429/503, respuesta inválida y otros errores. Una pausa creciente por modelo afecta únicamente al descubrimiento. La revalidación sigue requiriendo sus verificaciones y consenso.
- Cada llamada custom a Gemini hace una sola solicitud bajo su reserva. Los reintentos ocurren en llamadas posteriores con nueva autorización presupuestaria; no se cambia a un modelo no reservado. Las reservas inciertas siguen contabilizándose conservadoramente.
- Descubrimiento, revalidación y creación de señal comparten el mínimo R:R efectivo. Los modos exclusivos no usan el otro objetivo como alternativa. No se modificó la política administrativa ni se redujeron sus límites.
- El panel distingue análisis, neutrales, hipótesis, confirmaciones de zona, revalidaciones, autorizaciones y entradas/cierres paper. Las rupturas neutrales no se presentan como operaciones.

## Persistencia y API

Migración aditiva al iniciar SQLite: tabla `discovery_analyses` e índice por fecha. La clave del análisis es el `snapshotId` usado por sus escenarios. Cada registro contiene el snapshot y política inmutables; no contiene credenciales ni prompts crudos.

- `GET /api/v1/discovery/audit?limit=10`: embudo agregado, política efectiva y análisis recientes sin duplicar snapshots. Límite máximo: 100.
- `GET /api/v1/discovery/audit/:id`: análisis completo, incluyendo el snapshot, aunque no haya generado escenarios.
- El detalle de escenario incluye `discoveryAudit` para el snapshot original y `relatedDiscoveryAudits` para los cinco análisis más recientes asociados al ID persistido. La deduplicación entre proveedores conserva esos enlaces y devuelve un único escenario.

El historial existente no se reescribe. Los conteos de análisis auditados empiezan con esta actualización; las revalidaciones neutrales históricas permanecen separadas de las direccionales. `IN_ZONE` representa confirmación de zona según el lifecycle, no todo contacto físico del precio.

## Validación local

51 pruebas aprobadas en estos archivos:

```text
backend/tests/unit/discovery-audit-regression.test.ts
backend/tests/unit/gemini-discovery-recovery.test.ts
backend/tests/unit/autonomous-analysis-cost-controls.test.ts
backend/tests/unit/fase5c2-autonomous-levels.test.ts
backend/tests/unit/fase5a-ai-discovery-scenarios.test.ts
backend/tests/unit/fase5c-prospective-paper.test.ts
backend/tests/integration/autonomous-pipeline-e2e.test.ts
```

Ejecutadas con `node --import tsx --test` y los archivos anteriores. Incluyen una entrada paper persistida mediante el watcher, revalidación, coordinador, máquina de estados y monitor; no usan IA paga ni órdenes de trading.

Comprobaciones TypeScript de backend y frontend con `--noEmit`: aprobadas. `git diff --check`: aprobado. No se ejecutaron suites generales, backtests ni builds Docker. El panel fue verificado en navegador con fixtures locales: escritorio (1280 px), móvil (390 px), detalles expandibles, historial vacío y fallo de API. Ninguna vista de prueba se conectó a producción.

Verificación adicional de SQLite: base creada con `31c2cf6`, apertura con el esquema actualizado y reapertura con el código anterior; el escenario legado permaneció idéntico.

## Despliegue y reversión pendientes

Producción no fue modificada. Antes de un despliegue autorizado, obtener y verificar un backup consistente de SQLite y conservar la imagen anterior. Confirmar `SIGNALS_ONLY`, presupuestos y límites administrativos existentes.

Después del despliegue, verificar salud, creación de la tabla, lectura del panel y registros de la siguiente ejecución autónoma. No es necesario disparar un descubrimiento manual pago para validar la migración.

Para revertir, volver a la imagen anterior manteniendo el mismo volumen. La nueva tabla puede permanecer: el código anterior la ignora. No borrar ni restaurar encima de datos nuevos sin revisar su alcance.

La disponibilidad real de Gemini no fue verificada con llamadas pagas. El parche mejora su manejo y diagnóstico; no garantiza la recuperación del proveedor ni una frecuencia de operaciones.

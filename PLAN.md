# NanoLabs AI Trading — Master Plan & Execution Roadmap

**Proyecto:** NanoLabs AI Trading  
**Instrumento:** BTCUSDT Perpetual (Bybit V5 Linear)  
**Entorno de Producción:** Servidor Dedicado Debian (`/opt/apps/nanolabs-ai-trading`)  
**Zona Horaria de Referencia:** `America/Argentina/Buenos_Aires`  
**Última Actualización:** 2026-11-20

---

## Matriz de Fases y Estado de Avance

| Fase | Título | Alcance Principal | Estado |
| :--- | :--- | :--- | :--- |
| **Fase 0** | Auditoría, Arquitectura y Preparación | Estructura del proyecto, tipados, docker aislado, CI/scripts, base de datos | **COMPLETADA** |
| **Fase 1** | Bybit y Mercado en Tiempo Real | Clientes V5 REST & WS, streams multitemporales, gaps, orderbook, server API, gráficos en vivo | **COMPLETADA** |
| **Fase 2** | Motor Técnico Cuantitativo & SMC/ICT | Detección de Swings, BOS, CHoCH, FVG, OB, Liquidez, Estrategias A y B, R:R 1:4 estricto | **COMPLETADA** |
| **Fase 3** | Integración de IA & Motor de Consenso | Proveedores OpenAI y Gemini independientes, schemas estructurados, consenso, control de costos | **COMPLETADA** |
| **Fase 4** | Alertas, Máquina de Estados y PWA | Ciclo de vida completo de señales, Telegram Bot, Web Push PWA, UI con NanoLabs Theme 2 | **COMPLETADA** |
| **Fase 4.5** | Centro de Configuración, Riesgo y Router de IA | Gestión de capital, techos de SL, credenciales Bybit/IA, router multimodelo, auditoría | **COMPLETADA** |
| **Fase 5A** | Inteligencia Autónoma & Descubrimiento 1:2 / 1:4 | Descubrimiento autónomo IA, registro de escenarios, Algorithmic Watcher, reevaluación | **COMPLETADA** |
| **Fase 5B** | Validación Histórica & Backtesting Real (90 Días) | Histórico Bybit sin look-ahead, comparación 1:2 vs 1:4, Scheduler autónomo, Trading Laboratory | **COMPLETADA** |
| **Fase 5C** | Validación en Vivo & Paper Trading Acumulado | Seguimiento de decisiones IA, resultados netos acumulados, métricas de efectividad | **COMPLETADA** |
| **Fase 6** | Preparación para Ejecución Asistida | Abstracción de ejecución privada, reconciliación, kill switch avanzado (modo deshabilitado por defecto) | PENDIENTE |

---

## FASE 0: Auditoría, Arquitectura y Preparación
- [x] Inicializar repositorio Git y `.gitignore`.
- [x] Documentar `AGENTS.md` con reglas permanentes.
- [x] Crear `PLAN.md` maestro.
- [x] Configurar `package.json` raíz y estructura monorepo backend / frontend / docker.
- [x] Esquemas de base de datos (`candles`, `market_snapshots`, `system_events`, `setups`).
- [x] Capa dual SQLite WAL (desarrollo/tests) y PostgreSQL (producción/docker).
- [x] Configuración Docker Compose aislada en red `nanolabs_trading_net`.

---

## FASE 1: Bybit y Mercado en Tiempo Real
- [x] `BybitRestClient`: Klines, Ticker, OrderBook, InstrumentsInfo con backoff exponencial.
- [x] `BybitWsClient`: Conexión persistente, heartbeat 20s, watchdog 40s, reconexión automática.
- [x] `CandleManager`: 6 temporalidades (1m, 5m, 15m, 1h, 4h, 1d), confirmación de velas, detección y backfill de gaps.
- [x] `OrderBookManager`: Profundidad L2 (50 niveles), sequence guard, spreads, desequilibrio (imbalance).
- [x] Servidor API interno (HTTP + WebSocket) y frontend PWA interactivo con NanoLabs Visual Theme 2.

---

## FASE 2: Motor Técnico Cuantitativo & SMC/ICT
- [x] `SmcDetector`: Detección sin look-ahead bias de Swing Highs/Lows, BOS, CHoCH, Fair Value Gaps (FVG), Order Blocks (OB) con desplazamiento y barridos de liquidez.
- [x] Registro explícito de timestamps: `patternOriginTimestamp`, `confirmedAtTimestamp`, `operationalAvailableTimestamp`.
- [x] `TechnicalIndicators`: RSI Wilder con neutralidad en precio plano, ATR, EMA con salvaguarda de suficiencia de histórico (EMA 200), VWAP intradía con reinicio a las 00:00 UTC, RVOL.
- [x] `RiskCalculator`: Cálculo cuantitativo de riesgo para LONG y SHORT, tamaño de posición quantizado por `qtyStep`, comisiones maker/taker por valor nocional, deslizamiento, cruce de spread, costo de funding, redondeo por `tickSize` y filtro estricto de R:R neto $\ge$ 1:4.
- [x] Estrategias A (Continuación de Tendencia) y B (Barrido de Liquidez y Reversión).

---

## FASE 3: Integración de IA & Motor de Consenso
- [x] **Catálogo de Modelos (`models-catalog.ts`)**:
  - OpenAI: `gpt-4o`, `gpt-4o-mini`, `o3-mini`.
  - Google Gemini: `gemini-2.0-flash`, `gemini-2.0-flash-lite`, `gemini-1.5-flash`, `gemini-1.5-pro`.
  - Costos por 1M de tokens (input/output) y parámetros de inferencia determinista (`temperature: 0.1`).
- [x] **Snapshot Inmutable (`snapshot-builder.ts`)**:
  - Hash criptográfico SHA-256 (`snapshotId`), timestamp UTC, ticker Bybit, libro L2 top 5, contexto multitemporal (6 temporalidades), setup candidato y estado de integridad de datos.
- [x] **Adaptador OpenAI (`openai-adapter.ts`)**:
  - Rol: Analista Cuantitativo y de Estructura de Mercado.
  - Salida estructurada JSON (schema estricto): veredicto, confianza, razonamiento, argumentos a favor/en contra, evaluación de riesgo, verosimilitud de target.
  - Soporte para mock evaluator para pruebas unitarias deterministas.
- [x] **Adaptador Gemini (`gemini-adapter.ts`)**:
  - Rol: Auditor Crítico de Riesgos e Invalidaciones ("abogado del diablo").
  - Salida estructurada JSON idéntica para comparación paritaria.
  - Detección de trampas de liquidez, contradicciones de flujo de órdenes y objetivos ficticios.
- [x] **Control de Presupuesto y Costos (`cost-tracker.ts`)**:
  - Registro de tokens de entrada/salida y cálculo exacto en USD por consulta.
  - Control de presupuesto diario ($5.00/día) y mensual ($50.00/mes) con bloqueo automático.
- [x] **Motor de Consenso Determinista (`consensus-engine.ts`)**:
  - Flujo de decisión jerárquico en 14 pasos.
  - **Doble Aprobación Obligatoria**: Ambos analistas deben emitir `APPROVE` con confianza $\ge 70\%$.
  - Si una IA rechaza $\to$ `DISCARDED`. Si una IA aconseja esperar $\to$ `WAITING_CONDITIONS`.
  - **Determinismo Absoluto**: El filtro de R:R neto $\ge$ 1:4, la sincronización del orderbook y la integridad de datos tienen prioridad total sobre cualquier opinión de IA.
  - Comprobación de deslizamiento de precio post-análisis (máx 0.15% de drift).
  - Garantía `SIGNALS_ONLY`: sin dinero real ni claves de ejecución privadas.
- [x] **Persistencia en SQLite y PostgreSQL (`database.ts`, `postgres-database.ts`)**:
  - Tablas `ai_reviews` y `signals` implementadas con paridad estricta y consultas optimizadas.
- [x] **Endpoints Internos de API y WebSocket (`server.ts`)**:
  - `GET /api/v1/ai/status`: Estado de proveedores, modelos, presupuesto y consumo.
  - `GET /api/v1/ai/reviews`: Revisiones de analistas IA con filtrado por setup.
  - `GET /api/v1/signals`: Historial de señales evaluadas por consenso.
  - `POST /api/v1/ai/evaluate`: Disparador de auditoría de consenso sobre setup activo.
  - Emisión en tiempo real de `signal_evaluated` por WebSocket interno.
- [x] **Frontend PWA con NanoLabs Theme 2 (`AiAnalystsCard.tsx`, `page.tsx`)**:
  - Panel interactivo con tres pestañas: Modelos & Presupuesto, Señales Evaluadas y Auditorías Históricas.
  - Comparativa paritaria OpenAI vs. Gemini con badges de consenso y justificaciones completas.
  - URLs dinámicas basadas en `window.location.hostname` para compatibilidad de servidor.

---

## FASE 4: Alertas, Máquina de Estados, Worker 24/7 y PWA
- [x] **Correcciones Críticas de Fase 3**:
  - `models-catalog.ts`: Verificación oficial de catálogo OpenAI/Gemini, depreciación de obsoletos (`gpt-3.5-turbo`, `gemini-1.0-pro`), fechas de vigencia de tarifas y cálculo estimado.
  - Endpoints frontend resilientes: helper `api-config.ts` (`getApiBaseUrl()`, `getWebSocketLiveUrl()`) con soporte dual (dev localhost y reverse proxy HTTPS/WSS bajo Nginx Proxy Manager sin contenido mixto).
  - Seguridad en `POST /api/v1/ai/evaluate`: Autenticación con `x-admin-key`/Bearer token, rate limiting de 10 req/min, deduplicación de evaluaciones concurrentes, validación de `setupId`, salvaguarda de presupuesto y auditoría en base de datos.
  - Drift de precio dinámico en `consensus-engine.ts`: Ajustado a $\min(0.15\%\text{ precio}, 10\%\text{ riesgo}, 5\%\text{ ATR})$, con validación de SL previo a entrada y disclaimer de subjetividad de confianza IA.
- [x] **Máquina de Estados Persistente (`signal-state-machine.ts`)**:
  - 17 estados formales (`OBSERVING`, `SETUP_DETECTED`, `APPROACHING_ZONE`, `IN_ZONE`, `WAITING_CONFIRMATION`, `AI_REVIEW`, `ENTRY_VALIDATED`, `ALERT_SENT`, `ENTRY_TRIGGERED`, `TRACKING`, `COMPLETED_TP`, `COMPLETED_SL`, `EXPIRED`, `INVALIDATED`, `CANCELLED`, `DATA_UNAVAILABLE`, `ERROR`).
  - Matriz estricta de transiciones `VALID_TRANSITIONS` e idempotencia.
  - Persistencia de cada transición en tabla `signal_lifecycle` y métricas en `signals` (SQLite WAL y PostgreSQL).
  - Recuperación automática en reboot (`recoverActiveSignals()`).
- [x] **Worker Desacoplado de Monitoreo 24/7 (`market-monitor-worker.ts`)**:
  - Procesamiento por eventos de ticks de precio y cierre de velas.
  - Detección de aproximación ($\le 0.25\%$) y entrada en zona ($\le 0.05\%$).
  - Ejecución de llenado en simulación paper trading $\to$ `TRACKING`.
  - Cálculo en tiempo real de MFE (Máxima Excursión Favorable en R), MAE (Máxima Excursión Adversa en R) y duración.
  - Detección de TP alcanzado $\to$ `COMPLETED_TP` (+netRR, beneficio neto USDT).
  - Detección de SL alcanzado $\to$ `COMPLETED_SL` (-1.0R, pérdida acotada).
  - Expiración (4h sin fill) e invalidación estructural por vela cerrada adversa.
- [x] **Integración Bot de Telegram (`telegram-notifier.ts`)**:
  - Mensajería estructurada HTML con targets, SL, TP, R:R $\ge 1:4.0$, consenso OpenAI/Gemini y disclaimers.
  - Ventana de deduplicación de 60 segundos y reintentos con backoff exponencial.
  - Registro de auditoría en tabla `notifications_log`.
- [x] **Notificaciones Web Push PWA (`web-push-notifier.ts`, `sw.js`)**:
  - Protocolo VAPID con claves criptográficas y gestión de suscripciones en base de datos.
  - Service Worker nativo para recepción en background, vibración y apertura/foco de dashboard.
  - Poda automática de suscripciones caducadas (HTTP 404/410).
- [x] **Seguridad Operativa y Kill Switch**:
  - Garantía absoluta de modo `SIGNALS_ONLY` y `PAPER_TRADING` (ejecución real con dinero deshabilitada).
  - Kill Switch interactivo persistente: cancela señales activas y detiene nuevas operaciones.
- [x] **Frontend PWA Mejorado (`page.tsx`, `SignalLifecycleMonitor.tsx`, `NotificationsModal.tsx`)**:
  - Panel en vivo de seguimiento de ciclo de vida de señales con badges de estado y barras de MFE/MAE.
  - Modal interactivo de Centro de Notificaciones con tests de Telegram y Web Push.
  - Botón de Kill Switch en barra superior y registro de Service Worker en cliente.
- [x] **Cobertura Integral de Pruebas**:
  - 57 pruebas unitarias pasando al 100% (incluyendo transiciones de máquina de estados, worker 24/7, deduplicación de alertas, VAPID y seguridad de endpoints).
  - Test de integración E2E con Bybit V5 en vivo verificado exitosamente.

---

## FASE 4.5: Centro de Configuración, Riesgo y Router Inteligente de IA
- [x] **Seguridad Criptográfica y Autenticación Administrativa**:
  - `encryption.ts`: Cifrado y descifrado autenticado AES-256-GCM con derivación de clave maestra PBKDF2 (100.000 iteraciones SHA-256) y enmascaramiento seguro de secretos (`maskSecret`).
  - `auth-manager.ts`: Autenticación timing-safe con `crypto.timingSafeEqual`, gestión de sesiones con expiración TTL (8 horas), rate limiting estricto y bloqueo temporal tras 5 intentos fallidos.
- [x] **Política de Gestión de Capital y Riesgo Cuantitativo (`risk-policy.ts`)**:
  - `RiskPolicyManager`: Gestión de capital operativo USDT, riesgo máximo por operación (% y USDT con aplicación imperativa del valor más restrictivo).
  - Límites de pérdida diaria y semanal (% y USDT), límite de señales simultáneas activas, límite de entradas diarias y corte por pérdidas consecutivas.
  - Techos máximos de Stop Loss estructural: techo por distancia porcentual, techo por distancia absoluta USDT, techo por múltiplo de ATR 15m y techo por pérdida monetaria máxima.
  - Regla fundamental inviolable: Descarte estructural de cualquier setup que requiera un SL mayor al tope permitido (prohibida la compresión artificial de SL).
  - `RiskCalculator.calculateInteractive`: Cálculo interactivo en tiempo real con quantización por `tickSize` (0.1) y `qtyStep` (0.001 BTC), desglose de comisiones taker/maker y validación de R:R neto $\ge 1:4.0$.
- [x] **Gestión de Credenciales Bybit V5 (`bybit-credentials.ts`)**:
  - Almacenamiento cifrado de API Key y API Secret para Mainnet y Testnet.
  - Consulta y verificación obligatoria contra `/v5/user/query-api`.
  - Detección y rechazo tajante de claves con permisos de escritura, órdenes, posiciones, trading o transferencias (enforcement estricto de sólo lectura).
  - Consulta automática de saldo en USDT y tarifas reales de cuenta (`/v5/account/fee-rate`).
- [x] **Enrutador Multimodelo de Inteligencia Artificial (`ai-router.ts`)**:
  - 4 modos de selección: `AUTOMATIC`, `MANUAL_GLOBAL`, `MANUAL_BY_TASK`, `HYBRID`.
  - 4 perfiles de enrutamiento: `ECONOMIC`, `BALANCED`, `MAX_QUALITY`, `CUSTOM`.
  - Asignación específica por tarea (evaluación de setups, auditoría de riesgo, consenso, explicaciones en lenguaje natural, resúmenes periódicos, contexto multitemporal).
  - Fallback automático por presupuesto: degradación transparente a modelos económicos (`gpt-4o-mini`, `gemini-2.0-flash`) cuando el presupuesto restante es $< \$0.50$.
  - Preservación íntegra del motor de consenso y del fallback de 4 modos (`DUAL_AI`, `SINGLE_AI_OPENAI`, `SINGLE_AI_GEMINI`, `AI_UNAVAILABLE`).
- [x] **Panel y Métricas de Consumo de IA**:
  - Registro cronológico inmutable de consumo (`ai_consumption_logs`): tokens de entrada, salida, en caché, costo estimado USD y latencia en milisegundos.
  - Estadísticas agregadas: gasto de hoy, ayer, últimos 7 días, mes, total histórico, desglose por proveedor, modelo y tarea.
  - Exportación directa a archivo CSV descargable (`GET /api/v1/config/ai/consumption/export`).
- [x] **Persistencia y Paridad de Base de Datos**:
  - Tablas creadas con paridad completa en SQLite WAL y PostgreSQL: `risk_policies`, `bybit_credentials`, `ai_provider_credentials`, `ai_router_config`, `ai_consumption_logs`, `config_audit_logs`.
- [x] **Centro de Configuración Frontend en PWA (`ConfigCenterModal.tsx`, `page.tsx`)**:
  - Modal profesional adaptado a NanoLabs Visual Theme 2 accesible desde cabecera.
  - 9 pestañas interactivas completas: General, Gestión de Riesgo, Bybit, OpenAI, Gemini, Router de IA, Gastos y Consumo, Notificaciones, Seguridad y Auditoría.
  - Barra superior de resumen en tiempo real: Modo de Router, Presupuesto consumido/límite, Riesgo máximo, Techo de SL y estado del Kill Switch.
- [x] **Cobertura de Pruebas Automatizadas**:
  - 72 pruebas unitarias pasando al 100% (incluyendo 8 pruebas exhaustivas de cifrado, login timing-safe, rate limiting, techos de SL, calculadora interactiva, rechazo de permisos de trading en Bybit, routing multimodelo y agregación de consumo).

---

## [Fase 4.6] — Hard Budget Limit Estricto & GPT-6 Luna [COMPLETADA]
- [x] **Modelo Oficial OpenAI GPT-6 Luna (`models-catalog.ts`, `openai-adapter.ts`)**:
  - Incorporado al catálogo con status `ACTIVE` y tarifas oficiales: Entrada: US\$0,10/1M, Caché entrada: US\$0,01/1M, Escritura de caché: US\$0,125/1M, Salida: US\$0,50/1M.
  - Soporte para selector de esfuerzo de razonamiento (`low`, `medium`, `high`).
  - Cómputo exacto de tokens internos de razonamiento dentro de los tokens facturables de salida.
  - Compatibilidad confirmada con Responses API y JSON estructurado para consenso.
- [x] **Sistema de Control de Presupuesto Duro (`HardBudgetManager`)**:
  - Límites económicos estrictos persistentes: Presupuesto diario global (\$0,50 USD por defecto), Presupuesto mensual global (\$10,00 USD por defecto), Costo máximo individual por petición (\$0,05 USD).
  - Reservas presupuestarias atómicas previas a la inferencia (`preCallReservation`) con cálculo del peor escenario.
  - Conciliación atómica posterior (`reconcileReservation`) con recálculo exacto del gasto real y liberación de remanentes.
  - Recuperación y expiración automática de reservas huérfanas en reinicio.
  - Alertas automáticas y deduplicadas enviadas sin consumo de tokens de IA en umbrales de 50%, 80%, 95% y 100% (Telegram, Web Push y Dashboard).
- [x] **Mecanismo de Hard Stop Inviolable (`AI_BUDGET_EXCEEDED`)**:
  - Transición inmediata del motor de consenso al estado `AI_BUDGET_EXCEEDED` ante agotamiento del presupuesto.
  - Separación total entre límite económico y fallas técnicas.
  - Las llamadas pagas se bloquean al 100%, preservando sin interrupción la captura de Bybit WebSocket, klines, libro de órdenes, indicadores técnicos, detección de setups y monitoreo de señales activas.
  - Reactivación administrativa manual mediante endpoint seguro `POST /api/v1/config/budget/reactivate`.
- [x] **Persistencia en Base de Datos & Endpoints REST**:
  - Tabla `hard_budget_config` en SQLite y PostgreSQL con soporte versionado y auditoría.
  - Endpoints implementados: `GET /api/v1/config/budget`, `POST /api/v1/config/budget`, `POST /api/v1/config/budget/reactivate`.
- [x] **Corrección de Conexión en Memoria de Adaptadores IA**:
  - Métodos `updateCredentials` en `OpenAiAdapter` y `GeminiAdapter` y `updateAiCredentials` en `ConsensusEngine`.
  - Carga automática y descifrado de claves guardadas en arranque y aplicación en caliente al guardar en Centro de Configuración.
  - Dashboard muestra estado `DUAL_AI` (`AVAILABLE` / `DISPONIBLE`) en OpenAI y Gemini en tiempo real.
- [x] **Pruebas Automatizadas**:
  - 79 pruebas unitarias pasando al 100% (7 nuevas pruebas dedicadas a GPT-6 Luna, reservas atómicas, hard stop y reactivación).

---

## [Fase 4.6.1] — Seguridad, Presupuestos Inviolables y Verificación Real de IA [COMPLETADA]
- [x] **Eliminación Total de Autenticación Automática Insegura**:
  - Eliminadas claves administrativas fijas del frontend y variables de entorno expuestas (`ADMIN_API_KEY`).
  - Rotada la clave administrativa predeterminada.
  - Implementada autenticación administrativa mediante login seguro y sesión con hash SHA-256 + salt criptográfico.
  - Gestión de sesión basada en cookies `HttpOnly`, `SameSite: Strict` y tokens CSRF anti-falsificación.
  - Protección estricta de rutas de configuración, credenciales, presupuestos y Kill Switch.
  - Cero secretos administrativos en `localStorage`. Soporte para cierre de sesión (`POST /api/v1/admin/logout`).
- [x] **Corrección del Botón de Reactivación de Presupuesto (`HardBudgetManager`)**:
  - Los gastos confirmados son inmutables: una reactivación manual jamás borra ni reduce el consumo acumulado.
  - Si el gasto acumulado del día supera el límite actual, se exige ingresar un nuevo límite diario estrictamente superior al gasto actual para desbloquear las evaluaciones.
  - Auditoría inmutable de reactivaciones con registro de usuario IP y nuevo límite configurado.
- [x] **Cobertura de Pruebas Automatizadas**:
  - 87 pruebas unitarias pasando al 100% (incluyendo pruebas de seguridad de sesión, inmutabilidad de gastos y reactivación condicional).

---

## [Fase 4.6.2] — Integración y Corrección Oficial de Tokens Gratuitos de OpenAI (Data Sharing) [COMPLETADA]
- [x] **Corrección del Catálogo de Modelos Elegibles (`models-catalog.ts`)**:
  - Contrastado exhaustivamente contra el Help Article oficial 10306912 de OpenAI.
  - `gpt-6-luna`: Mantenido con status oficial en el Grupo Principal (250.000 tokens/día compartidos).
  - `gpt-4-turbo`: Excluido formalmente del descuento promocional (`freeTierGroup: 'NONE'`).
  - `o3-mini`: Excluido formalmente del grupo de modelos pequeños (`freeTierGroup: 'NONE'`).
  - Modelos oficiales elegibles vigentes incorporados: `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5-mini` y `o4-mini` (Grupo Modelos Pequeños - 2.500.000 tokens/día compartidos).
  - Grupos completamente configurables dinámicamente (`mainGroupModels`, `smallGroupModels`) ante futuras actualizaciones de OpenAI.
- [x] **Corrección de la Verificación Oficial de Beneficios**:
  - Se eliminó la presunción indebida de beneficio activo basada en una simple prueba de API Key o modelo.
  - Distinción cuádruple formal:
    1. **Elegibilidad documentada del modelo** (`isEligible`).
    2. **Participación declarada del proyecto** (`verificationStatus: 'DECLARED_BY_ADMIN'`).
    3. **Consumo gratuito estimado** (`discountStatus: 'ESTIMATED'`).
    4. **Beneficio comprobado en facturación oficial** (`verificationStatus: 'CONFIRMED_BILLED'`, `discountStatus: 'CONFIRMED_BILLED'`).
  - Verificación mediante datos oficiales de facturación/uso cuando están disponibles y autorizados, o confirmación administrativa explícita tras revisión del panel oficial de OpenAI (Settings > Data Sharing).
- [x] **Gestión de Cupo Compartido por Organización OpenAI**:
  - Reconocimiento explícito de que el cupo diario de 250k y 2.5M tokens pertenece a la organización OpenAI y no a una clave aislada.
  - Método `reconcileOrganizationalUsage(...)` para conciliar el consumo local con el consumo global de otros proyectos.
  - Aplicación de reserva de seguridad conservadora (`externalUsageBufferTokens`, 5.000 tokens por defecto) cuando el consumo global es estimado.
- [x] **AI Model Router Multimodelo (`ai-router.ts`)**:
  - Priorización inteligente de modelos elegibles para el programa Data Sharing según complejidad.
  - Admisión de `gpt-6-luna`, `gpt-4o`, `gpt-5.4-mini`, `gpt-5-mini` y `o4-mini` sin restringir análisis críticos exclusivamente a un modelo.
  - Implementación de método reproducible y seguro `compareModels(...)` para benchmarking de modelos sin interferir en el motor de riesgo ni en el consenso técnico.
- [x] **Persistencia y UI Frontend en PWA (`ConfigCenterModal.tsx`)**:
  - Columna `discount_status` persistida en tabla `ai_consumption_logs` (SQLite WAL y PostgreSQL).
  - Badges informativos según verificación real: `COMPROBADO EN FACTURACIÓN` (verde), `DECLARADO POR ADMIN (Estimado)` (ámbar) y `SIN VERIFICAR` (gris).
  - Desglose completo de métricas financieras: Bruto teórico, Descuento aplicado, Costo neto facturable, Tokens gratuitos bonificados y Modelos compartidos.
- [x] **Cobertura Integral de Pruebas Automatizadas**:
  - 100 pruebas unitarias pasando al 100% (15 pruebas dedicadas a modelos excluidos, modelos elegibles, verificación real, cupo organizacional, regla oficial de exceso, concurrencia, recuperación en reboot y persistencia de descuentos).

---

## [Fase 5A] — Análisis Inteligente Autónomo, Descubrimiento de Entradas 1:2 y 1:4, Watcher Algorítmico y Reevaluación [COMPLETADA]
- [x] **Motor de Inteligencia de Mercado (`MarketIntelligenceSummary`)**:
  - Captura continua y unificada del panorama multitemporal de 6 temporalidades (1D, 4H, 1H, 15m, 5m, 1m).
  - Integración de indicadores matemáticos deterministas: RSI Wilder, ATR, EMA 20/50/200 con guarda histórica, VWAP intradía con reinicio a 00:00 UTC, Volumen Relativo (RVOL), Swings High/Low sin look-ahead bias, Break of Structure (BOS) y Change of Character (CHoCH), Fair Value Gaps (FVG) y Order Blocks (OB).
  - Ticker en vivo (Last, Mark, Index, Spread L2, Funding Rate 8h, Open Interest) y estado de sincronización del orderbook.
- [x] **Motor de Descubrimiento Autónomo de Mercado (`AiMarketDiscoveryEngine`)**:
  - Inferencia desacoplada de OpenAI y Gemini sobre un mismo snapshot cuantitativo inmutable.
  - Descubrimiento de hipótesis LONG y SHORT operables sin depender exclusivamente de estrategias A y B preconfiguradas.
  - Regla imperativa: Conclusión "No operar es una decisión válida y a menudo la mejor" ante confluencia deficiente.
  - Integración con tareas `MARKET_DISCOVERY` y `SCENARIO_GENERATION` del AI Model Router y reserva presupuestaria atómica en `HardBudgetManager`.
- [x] **Registro Central de Escenarios (`ScenarioRegistry`)**:
  - Persistencia completa en SQLite WAL y PostgreSQL (`scenarios`, `scenario_lifecycle`, `scenario_revalidations`).
  - Deduplicación y agrupación inteligente de propuestas similares entre OpenAI y Gemini para evitar duplicaciones operativas.
  - Trazabilidad estricta de ciclo de vida: `SCENARIO_PROPOSED` $\to$ `SCENARIO_REGISTERED` $\to$ `SCENARIO_MONITORING` $\to$ `APPROACHING_ZONE` $\to$ `IN_ZONE` $\to$ `REVALIDATION_REQUESTED` $\to$ `AI_REVALIDATING` $\to$ `ENTRY_VALIDATED` / `WAITING_CONFIRMATION` / `INVALIDATED` / `EXPIRED` / `CANCELLED`.
- [x] **Vigilante Algorítmico Continuo (`AlgorithmicWatcher`)**:
  - Vigilancia permanente en background tick a tick sobre WebSocket y cierres de vela con **0 tokens de IA consumidos**.
  - Detección precisa de aproximación ($\le 0.35\%$) con transición a `APPROACHING_ZONE` y alerta temprana.
  - Detección de mitigación en zona operativa con transición automática a `IN_ZONE` y solicitud de reevaluación (`REVALIDATION_REQUESTED`).
  - Detección y cancelación inmediata (`INVALIDATED`) ante vulneración de Stop Loss o nivel estructural antes de mitigar la zona.
  - Control de expiración temporal automática (`EXPIRED`).
- [x] **Reevaluación de Entrada por IA (`AiEntryRevalidation`)**:
  - Consulta event-driven a OpenAI y Gemini al tocar la zona registrada (tarea `SCENARIO_REVALIDATION`).
  - Verificación de confirmaciones en microestructura, absorción en libro de órdenes y persistencia de hipótesis original.
  - Matriz de consenso y fallback preservada (`DUAL_AI`, `SINGLE_AI_OPENAI`, `SINGLE_AI_GEMINI`, `AI_UNAVAILABLE`).
  - Determinismo cuantitativo inviolable: recálculo estricto en tiempo real mediante `RiskCalculator.calculateDualTargets(...)` con comisiones maker/taker, spread y slippage para verificar net R:R $\ge 2.0$ y net R:R $\ge 4.0$.
  - Transición a `ENTRY_VALIDATED` con emisión de alerta y generación de señal virtual en `SIGNALS_ONLY`.
- [x] **Objetivos de Riesgo/Beneficio 1:2 y 1:4**:
  - Variantes virtuales independientes vinculadas al mismo setup (`RR_1_2`, `RR_1_4`, `RR_BOTH`).
  - Prohibida la compresión artificial de SL o estiramiento arbitrario de TP: los objetivos se anclan a niveles estructurales reales verificados.
- [x] **Endpoints REST y WebSocket en Tiempo Real (`server.ts`)**:
  - `GET /api/v1/discovery/market-intelligence`: Panorama multitemporal integral.
  - `GET /api/v1/discovery/scenarios`: Listado con filtrado por estado, modo R:R y paginación.
  - `GET /api/v1/discovery/scenarios/:id`: Detalle profundo de escenario, ciclo de vida e historial de reevaluaciones.
  - `POST /api/v1/discovery/trigger`: Disparador administrativo de ciclo de descubrimiento IA.
  - `POST /api/v1/discovery/scenarios/:id/revalidate`: Reevaluación administrativa bajo demanda.
  - Eventos WebSocket emitidos: `scenario_registered`, `scenario_status_changed`, `scenario_updated`, `scenario_approaching`, `scenario_entry_validated`, `discovery_completed`.
- [x] **Dashboard de Análisis Inteligente en Frontend (`AiTradingIntelligence.tsx`)**:
  - Componente integrado en `http://localhost:3000` con diseño oficial NanoLabs Theme 2 (`visual-nanolabs`).
  - Vista de Escenarios Detectados con filtrado rápido (Todos, 1:2 y 1:4 Ambos, 1:2 Corto, 1:4 Extendido).
  - Panorama Multitemporal Cuantitativo de 6 temporalidades con badges de sesgo de OpenAI y Gemini.
  - Panel detallado de escenario con comparativa de interpretaciones, condiciones de activación, triggers de invalidación y línea de tiempo de eventos.
  - Panel en vivo del Algorithmic Watcher con métricas de vigilancia y gasto de IA.
- [x] **Cobertura Exhaustiva de Pruebas Automatizadas**:
  - 109 pruebas unitarias pasando al 100% (+9 pruebas dedicadas exclusivamente a Fase 5A: persistencia, deduplicación dual AI, descubrimiento autónomo, rechazo de R:R ficticio, vigilancia algorítmica sin IA, llegada a zona, invalidación por SL, reevaluación de consenso y hard budget limit).

---

## [Fase 5B] — Validación Histórica, Backtesting Real 90 Días Bybit V5 Linear y Trading Laboratory [COMPLETADA]

- [x] **Motor de Importación Histórica Bybit V5 Linear (`HistoricalDataManager`)**:
  - Paginación continua inversa en `/v5/market/kline` con límite de 1000 velas por petición para `BTCUSDT` categoría `linear`.
  - Almacenamiento indexado en SQLite (`historical_candles`) para las 5 temporalidades (1d, 4h, 1h, 15m, 5m).
  - Cobertura total verificada: 40.000 velas reales descargadas y almacenadas (1000 en 1d, 1000 en 4h, 3000 en 1h, 9000 en 15m, 26000 en 5m).
  - Ordenamiento UTC estricto, detección de gaps y persistencia local sin look-ahead bias.

- [x] **Scheduler Autónomo de Descubrimiento (`AutonomousDiscoveryScheduler`)**:
  - Ejecución autónoma 24/7 en backend independientemente de si el navegador está abierto o cerrado.
  - Event Dispatcher conectado al cierre de velas de `1h` y shifts estructurales de `15m` (BOS/CHoCH).
  - Disparador por desplazamiento significativo de mercado (movimiento $\ge 1.5\%$ respecto al último análisis).
  - Control de throttle y cooldown (mínimo 15 minutos entre ejecuciones, configurable).
  - Salvaguarda de presupuesto estricta: bloquea ejecuciones si `HardBudgetManager.isBlocked()` está activo.
  - Persistencia de configuración en tabla `discovery_scheduler_config` de SQLite.
  - Endpoints REST: `GET /api/v1/discovery/scheduler/status`, `GET /api/v1/discovery/scheduler/config`, `POST /api/v1/discovery/scheduler/config`.

- [x] **Motor Cuantitativo de Backtesting Determinista (`BacktestEngine`)**:
  - Reutilización estricta del motor de producción (`SmcDetector`, `StrategyATrendContinuation`, `StrategyBLiquiditySweep`, `RiskCalculator`).
  - Simulación financiera realista:
    - Comisiones Bybit: Maker 0.02% (entrada/salida con órdenes pasivas) y Taker 0.055% (gatillo de entrada y Stop Loss).
    - Costo de cruce de spread (0.10 USDT).
    - Slippage de mercado (0.02%).
    - Resolución conservadora imperativa: si el Stop Loss y el Take Profit se tocan dentro de la misma vela de 5m, se asume Stop Loss primero (pérdida).
  - Segregación temporal:
    - **In-Sample**: Primeros 60 días (entrenamiento y comportamiento estructural).
    - **Out-of-Sample**: Últimos 30 días (validación ciega sin sobreajuste).
  - Análisis diferencial de objetivos duales 1:2 y 1:4 calculados analíticamente con comisiones netas garantizadas.
  - Modo Cartera Combinada: deduplicación temporal de operaciones para eliminar exposición concurrente en el mismo activo.
  - Métricas registradas: Total Trades, Wins, Losses, Win Rate %, Net PnL (USDT y R), Expectancy R, Max Drawdown (% y R), Profit Factor, MFE promedio (R) y MAE promedio (R).

- [x] **Resultados Oficiales del Backtest Real de 90 Días (BTCUSDT · Bybit V5 Linear)**:
  - **Estrategia A (LONG 1:4)**: 34 trades, Win Rate 20.6%, Net PnL **+$1,585.7 USDT (+36.2R)**, Expectancy **+1.06R**, Profit Factor **1.34**, Max DD 25.0%.
  - **Estrategia A (LONG 1:2)**: 34 trades, Win Rate 26.5%, Net R **+6.9R**, Expectancy **+0.20R**, Max DD 26.6%.
  - **Estrategia A (SHORT 1:4)**: 24 trades, Win Rate 12.5%, Net R **+7.7R**, Expectancy **+0.32R**, Max DD 32.4%.
  - **Estrategia B (LONG 1:2)**: 15 trades, Win Rate 26.7%, Net R **+9.1R**, Expectancy **+0.61R**, Max DD 37.0%.
  - **Cartera Combinada (Sin Duplicación)**: 60 trades, Win Rate 23.3%, Net R **+8.2R**, Expectancy **+0.14R**.
  - **Comparativa In-Sample vs Out-of-Sample**:
    - In-Sample (Días 1-60): 118 trades, Win Rate 16.1%, PF 0.46, Exp +0.14R.
    - Out-of-Sample (Días 61-90): 54 trades, Win Rate 24.1%, PF 0.84, Exp **+0.33R** (validación positiva fuera de muestra).

- [x] **Interfaz "Trading Laboratory" en Frontend (`TradingLaboratory.tsx`)**:
  - Componente integrado en Next.js con estilo corporativo oficial NanoLabs Theme 2 (`visual-nanolabs`).
  - Selector de parámetros de backtesting (período, in-sample, estrategia, dirección y ratio).
  - Tarjetas KPI principales con visualización de Expectancy R, Profit Factor, PnL neto y Max Drawdown.
  - Tabla de rendimiento comparativo obligatorio por estrategia, dirección y ratio.
  - Panel comparativo In-Sample vs Out-of-Sample.
  - Registro interactivo de trades barra a barra con filtrado por TP, SL y expiradas.
  - Exportación directa a formatos CSV y JSON para análisis externo.

- [x] **Diferenciación Estricta de IA vs Backtest**:
  - El backtest histórico mide exclusivamente las estrategias cuantitativas deterministas A y B.
  - Se prohíbe inventar decisiones históricas simuladas de OpenAI o Gemini; la efectividad de las IA se mide prospectivamente en tiempo real en Fase 5C.

- [x] **Cobertura de Pruebas Automatizadas**:
  - **113 pruebas unitarias aprobadas al 100%** (incluye `fase5a-lifecycle-replay.test.ts` y `fase5b-backtest-engine.test.ts`).

---

## FASE 5B (AUDITORÍA FINANCIERA & CONCILIACIÓN CANÓNICA) + FASE 5C (INICIO)

- [x] **Auditoría Financiera Obligatoria Trade-a-Trade**:
  - **Causa Raíz de PnL negativo con R positivo**: Descubierta asimetría en la definición de 1R. En pérdidas por Stop Loss se debitaban -$175 USDT en caja por comisiones taker de apertura y cierre + slippage, pero se contabilizaba -1.0R nominal ($100), mientras que las ganancias dividían por $100 bruto.
  - **Causa de Caso A LONG 1:4 (+36.2R con 6-7 wins)**: 6 operaciones ganadoras se abrieron en velas sucesivas durante el mismo rally apuntando al mismo swing high mayor ($81,954.6), rindiendo entre +6.35R y +12.86R cada una en lugar de un ratio fijo sintético.
  - **Causa de Drawdown Inflado (142.4%)**: Suma cruzada de 4 variantes concurrentes simulando sobre la misma cuenta sin control de margen ni detención de equity.
- [x] **Motor Contable Canónico Unificado**:
  - $1R \equiv \text{netLossUSDT}$ real (pérdida neta estimada al Stop Loss incluyendo comisiones taker de entrada y salida, spread y slippage).
  - Al tocar SL: resultado exacto **-1.00R**.
  - Al tocar TP: $R = \text{netRewardUSDT} / \text{netLossUSDT}$.
  - Invariante estricto verificado: PnL en USDT negativo $\iff$ $R < 0$. PnL positivo $\iff$ $R > 0$.
  - Cero inconsistencias en los 172 trades históricos auditados.
- [x] **Objetivos 100% Estructurales**:
  - Eliminación de la generación de targets sintéticos en el vacío (`solveTargetPriceForNetRR`).
  - Take Profits anclados exclusivamente a niveles técnicos verificados de SMC (swings 1H/4H, FVGs y Order Blocks). Si el objetivo no alcanza el R:R neto requerido, el setup se descarta.
- [x] **Cartera Simulada Real**:
  - Restricción estricta de **máximo 1 posición abierta simultánea** en `BTCUSDT`.
  - Simulación de capital dinámico (inicio $10,000 USDT) con detención por margen o límite de drawdown (30%).
  - Cartera ejecutada resultante: 10 trades, Max Drawdown 43.0%, 0 equity negativa.
- [x] **Banner de Advertencia en Frontend (`TradingLaboratory.tsx`)**:
  - Desplegado banner oficial: *"Resultados históricos pendientes de conciliación contable"*, preservando el histórico anterior como evidencia y contrastando la corrida canónica.
- [x] **Inicio de Fase 5C: Registro Prospectivo de IA**:
  - Soporte de decisión formal `NEUTRAL` ("No operar es una decisión válida").
  - Registro estructurado de hipótesis de OpenAI y Gemini con snapshot, zonas de interés y justificaciones.
  - Monitoreo algorítmico continuo con 0 costo de IA en reposo, reservando reevaluación para el ingreso a la zona.
  - Badge formal en UI para escenarios neutrales y en monitoreo.

---

## FASE 5C — EJECUCIÓN PROSPECTIVA, OBJETIVOS 1:2 VS 1:4 Y PAPER TRADING (COMPLETADA)

- [x] **Resolución Definitiva de 1:2 vs 1:4 con Niveles Estructurales SMC Reales**:
  - **Causa Raíz de resultados idénticos en commit anterior**: La función `simulateSetupCandidate` sólo incluía `setup.takeProfitPrice` como único candidato, forzando a que las variantes `RR_1_2` y `RR_1_4` seleccionaran el mismo precio si cumplía ambos umbrales.
  - **Solución Canónica Implementada**: Extracción algorítmica de niveles estructurales reales en marcos temporales de 15m y 1H (`SmcDetector.analyzeStructure`: swings 15m, swings 1H, FVGs activos y swing mayor del setup).
  - **Evaluación Independiente y Sin Look-Ahead Bias**: Cada nivel se evalúa con `RiskCalculator.calculate` en la dirección del trade. `RR_1_2` toma el primer nivel con $R:R \ge 2.0$, mientras que `RR_1_4` toma el primer nivel con $R:R \ge 4.0$.
  - **Unicidad de Objetivo Documentada**: Si una oportunidad sólo presenta un objetivo mayor que satisface ambos umbrales sin niveles intermedios, se documenta explícitamente como *"Objetivo estructural único (alcanza >= 4.0R, sin niveles intermedios)"*. Si existen niveles intermedios válidos, se evalúan independientemente produciendo resultados divergentes comprobados.
  - **Persistencia Completa**: Se persisten en SQLite `expected_net_rr`, `structural_justification` y `exclusion_reason` en la tabla `backtest_trades`.

- [x] **Auditoría Detallada del Drawdown del 40.53% (Trade #10)**:
  - **Auditoría trade-a-trade de la Cartera Combinada**: Los trades #1 a #9 tuvieron un drawdown progresivo de 1.46% a 11.16%.
  - **Motivo de la Pérdida Catastrófica en Trade #10**: En `STRATEGY_B_LIQUIDITY_SWEEP_REVERSAL` (LONG en $78,896.1 con SL en $78,892.7), la distancia de Stop Loss fue de solo $3.40 USDT. El sizing previo dividía `targetRiskUSDT / priceDistance` sin sumar comisiones, resultando en `rawQty = 100 / 3.4 = 29.411 BTC` ($2,320,400 de nocional = 232x leverage). Las comisiones taker de apertura y cierre sumaron $1,744.52 USDT ($2,552 con spread y slippage), generando una pérdida neta de -$3,117.95 USDT que disparó el drawdown instantáneamente al **40.53%**.
  - **Detención por Margin Halt**: El Kill Switch / Margin Halt se activó de forma inmediata tras el cierre del Trade #10 al superar el umbral de seguridad del 30%, bloqueando los 75 trades subsiguientes y preservando $6,314.01 de capital.
  - **Corrección Definitiva en `RiskCalculator`**: Se reformuló el denominador de dimensionamiento para que sea `totalRiskPerUnit` (incluyendo distancia de precio + comisiones taker de entrada + comisiones taker de salida + spread + slippage), garantizando que jamás una pérdida supere el riesgo autorizado. Se implementó además un **techo estricto de apalancamiento a 5.0x máximo**.

- [x] **Conexión de Paper Trading Prospectivo End-to-End**:
  - Conexión del evento `entry_validated` de `AiEntryRevalidation` a `SignalStateMachine.registerSignalFromScenario`.
  - Creación inmediata de posiciones de papel en modo `SIMULATED_PAPER_ENTRY` para cada variante calificada (`RR_1_2` y/o `RR_1_4`).
  - Transición automática a `TRACKING`, con actualización en vivo de MFE, MAE y cierre determinista por TP o SL al tick y vela cerrada por `MarketMonitorWorker`.
  - Registro de decisiones formales `NEUTRAL` ("No operar es una decisión válida").

- [x] **Verificación Honesta de Credenciales (`Cero Datos Ficticios`)**:
  - Verificación rigurosa en SQLite (`ai_provider_credentials`) y `.env`. Estado actual: `MISSING_CREDENTIALS` (0 filas en BD y claves vacías en `.env`).
  - Reportado con transparencia en UI y consola sin inventar claves ficticias ni mocks decorativos.

- [x] **Panel Administrativo y Dashboard (NanoLabs Theme 2)**:
  - `TradingLaboratory.tsx`: Integración de columnas para `R:R Esp.` y `Justificación Estructural`, junto con el Callout de auditoría del Drawdown del 40.53% y el comparativo 1:2 vs 1:4.
  - `AiTradingIntelligence.tsx`: Pestaña dedicada para *Paper Trading Prospectivo*, tarjeta de estado del *Scheduler Autónomo* y banners de estado de credenciales OpenAI/Gemini según Theme 2.

- [x] **Cobertura de Pruebas Automatizadas**:
  - **121 pruebas unitarias aprobadas al 100%** (8 nuevas pruebas en `fase5c-prospective-paper.test.ts` cubriendo 1:2 vs 1:4, unicidad de swing mayor, exclusión de objetivos no estructurales, sizing con comisiones y límite a 5x, invariante de 1R, escenario NEUTRAL, ciclo paper trading y scheduler presupuesto bloqueado).

---

## FASE 5C (ACTUALIZADA) — CORRECCIÓN ARQUITECTÓNICA FUNDAMENTAL: IA COMO ANALISTA PRINCIPAL DEL MERCADO (COMPLETADA)

- [x] **OpenAI y Gemini como Analistas Principales del Mercado Discrecional**:
  - **Desacoplamiento Total de Estrategias Fijas**: Las IAs ya no son meras aprobadoras de Estrategia A o Estrategia B precalculadas. Reciben un `MarketIntelligenceSummary` omnicomprensivo con 6 temporalidades (`1d`, `4h`, `1h`, `15m`, `5m`, `1m`), SMC/ICT completo (swings, BOS, CHoCH, Order Blocks, FVGs, sweeps de liquidez), order flow, spread, profundidad de order book top 5, Open Interest, funding rate y volatilidad 24h.
  - **Estrategias A y B como Referencias Algorítmicas Comparativas**: Los setups matemáticos tradicionales se preservan y exponen bajo el campo `algorithmicReferenceSetups` para referencia comparativa, pero ya no operan como filtro excluyente ni condicionan el descubrimiento de la IA.
  - **Razonamiento Autónomo Discrecional**: Cada modelo analiza independientemente qué está haciendo el mercado (`whatMarketIsDoing`), por qué podría estar haciéndolo (`whyMarketIsDoingIt`), evidencias técnicas (`evidenceList`), sesgo direccional (`bias`), horizonte preferido (`preferredHorizon`), temporalidad recomendada (`recommendedTimeframe`) y condiciones faltantes.
  - **Neutralidad Formal y Preservación de Capital**: Si el mercado carece de confluencia técnica, las IAs fundamentan `noTradeJustification` generando un escenario formal `NO_TRADE_OBSERVATION` bajo la filosofía rectora: *"No operar es una decisión válida y a menudo la mejor"*. Sin inventar probabilidades estadísticas ni porcentajes ficticios.

- [x] **Contrato Estructurado y Persistente `AI_WATCH_PLAN`**:
  - Toda oportunidad generada por las IAs crea un contrato persistente con: `id`, `scenarioId`, `direction`, `marketThesis`, `horizon`, `primaryTimeframe`, `watchZone`, `candidateStopLoss`, `candidateTakeProfits` (con elegibilidad dual 1:2 y 1:4), `confirmationSequence`, `invalidationConditions`, `expirationTimestamp` y `reevaluationTriggers`.
  - **Operadores Deterministas Permitidos**: Condiciones observables construidas con operadores algorítmicos formales (`PRICE_IN_RANGE`, `PRICE_TOUCH_LEVEL`, `PRICE_CROSS_ABOVE`, `PRICE_CROSS_BELOW`, `RSI_THRESHOLD`, `SPREAD_TOLERANCE`, `CANDLE_CLOSE_ABOVE`, `CANDLE_CLOSE_BELOW`, `STRUCTURE_BREAK`, `SWEEP_CONFIRMED`, `TIME_ELAPSED`).
  - **Gestión de Condiciones No Automatizables**: Si la IA requiere validaciones cualitativas o subjetivas no verificables por el stream de datos, el contrato se marca con `automatable: false`, bloqueando la auto-aprobación del motor y transitando a `WAITING_CONFIRMATION`.
  - **Persistencia en Base de Datos**: Creación de la tabla `ai_watch_plans` e índices en SQLite y soporte para PostgreSQL, con CRUD completo e historial de ciclo de vida.

- [x] **Vigilancia Algorítmica en Tiempo Real (`AlgorithmicWatcher`)**:
  - Monitoreo en vivo de múltiples planes activos sobre cada tick de mercado sin consumo continuo de tokens (0 llamadas de IA en reposo).
  - Evaluación determinista de condiciones observables y desencadenamiento de `APPROACHING_ZONE` cuando el precio se acerca a la zona operativa.
  - Detección inmediata de invalidación: si el precio cruza el Stop Loss o invalida la hipótesis antes de ingresar a la zona, el plan transita inmediatamente a `INVALIDATED`.
  - Detección de activación: al satisfacerse las condiciones observables automatizables en zona, el watcher emite `revalidation_requested` para consultar a las IAs.

- [x] **Reevaluación Inteligente y Validaciones Cuantitativas de Seguridad**:
  - Al activarse un plan, `AiEntryRevalidation` consulta nuevamente a OpenAI y Gemini inyectando el contrato original `AI_WATCH_PLAN`, la evolución del mercado y el snapshot de precio actual.
  - **Control Previo de Stop Loss**: Descarte inmediato si el precio vulneró el Stop Loss antes de la validación.
  - **Tolerancia Dinámica de Desviación de Precio (`Dynamic Price Drift`)**: Cálculo de tolerancia máxima en función de la distancia al Stop Loss (`min(0.15%, 10% del riesgo)`). Si el precio se aleja materialmente durante el análisis, el escenario transita a `EXPIRED` evitando entradas tardías o slippage excesivo.
  - **Recálculo Cuantitativo de R:R Neto**: `RiskCalculator.calculateDualTargets` audita matemáticamente que la entrada en el precio actual descontando comisiones taker/maker, spread y slippage mantenga un R:R neto $\ge 2.0$ y/o $\ge 4.0$. Si no califica, se cancela la entrada.
  - **Presupuesto y Seguridad Operativa**: Control estricto de `HardBudgetManager` y garantía de modo `SIGNALS_ONLY` y Paper Trading sin claves privadas de ejecución real.

- [x] **Panel Visual y Dashboard (NanoLabs Theme 2)**:
  - Integración del panel interactivo de `AI_WATCH_PLAN` en `AiTradingIntelligence.tsx`, mostrando el ID del contrato, horizonte, badge de automatabilidad, tesis cualitativa, chips de operadores y condiciones observables en tiempo real.
  - Endpoint REST `GET /api/v1/discovery/watch-plans` para auditoría y consulta de planes de vigilancia activos e históricos.

- [x] **Cobertura de Pruebas Automatizadas**:
  - **126 pruebas unitarias aprobadas al 100%**: 5 nuevas pruebas especializadas en `fase5c-architectural-correction.test.ts` verificando:
    1. Descubrimiento autónomo multi-temporal con SMC completo sin Estrategia A/B obligatoria.
    2. Manejo de condiciones no automatizables (`automatable: false` -> `WAITING_CONFIRMATION`).
    3. Replay determinista de ciclo completo: descubrimiento -> registro de plan -> aproximación -> activación en zona -> reevaluación dual -> validación cuantitativa -> apertura de señales paper trading prospectivas 1:2 y 1:4.
    4. Garantía de invalidación determinista y control dinámico de desviación de precio (price drift).
    5. Conclusión formal neutral generando plan de espera sin forzar señales.

---

## FASE 5C.2 — AUTONOMÍA REAL DE LAS IA, ANCLAJE CUANTITATIVO Y RECONCILIACIÓN (COMPLETADA)

- [x] **Descubrimiento Dual e Independiente de OpenAI y Gemini**:
  - Ambas IAs analizan sobre el mismo snapshot inmutable multitemporal (6TF) sin conocer la respuesta del otro.
  - Registro de llamadas, tokens (input/output), modelos utilizados (`gpt-4o`, `gemini-2.5-flash`), timestamps y costos exactos.
- [x] **Anclaje Cuantitativo Estricto de Niveles Propuestos**:
  - `verifyProposedLevels`: Auditoría determinista de cada nivel de entrada, stop loss y target contra swings, Order Blocks, FVGs, soportes, resistencias y VWAP del snapshot.
  - Rechazo de niveles alucinados o fuera de contexto.
- [x] **Ruptura de Rango Neutral y Redescubrimiento**:
  - Las observaciones `NEUTRAL` monitorean el rango sin forzar operaciones. Al confirmarse la ruptura de piso o techo, transitan a `COMPLETED` y disparan un nuevo ciclo de análisis autónomo.
- [x] **Vigilancia Secuencial Inicial**:
  - Implementación del orden secuencial de pasos de confirmación ($1 \to 2 \to 3$).

---

## FASE 5C.3 — AUTONOMÍA COMPLETA DE CONFIRMACIONES Y VALIDACIÓN PROSPECTIVA (COMPLETADA)

- [x] **Eliminación de Dependencias de Confirmación Manual**:
  - Implementación de operadores algorítmicos nativos evaluados en velas cerradas en `AlgorithmicWatcher`:
    - `CANDLE_PATTERN`: `BEARISH_ENGULFING`, `BULLISH_ENGULFING`, `SHOOTING_STAR`, `PIN_BAR` / `HAMMER`, `INVERTED_HAMMER`.
    - `LEVEL_REJECTION_WICK`: Rechazo de nivel con mecha (resistencia y soporte) con ratio configurable `minWickRatio`.
    - `STRUCTURE_CLOSE`: Cierre de vela confirmado por encima/debajo de estructura.
    - `BREAK_AND_RETEST`: Ruptura seguida de retesteo de nivel dentro de tolerancia.
    - `SWEEP_AND_RECLAIM`: Barrido de liquidez y recuperación del nivel.
    - `VOLUME_EXPANSION`: Desplazamiento acompañado por volumen relativo ($rvol \ge threshold$).
    - `BOS_CONFIRMED` / `CHOCH_CONFIRMED`: Quiebre estructural confirmado en microestructura con timestamp posterior a discovery.
  - Todos estos operadores se marcan automáticamente como `automatable: true`.
  - Normalización inteligente de alias propuestos por las IA (`BEARISH_ENGULFING`, `SHOOTING_STAR`, etc. mapeados a `CANDLE_PATTERN`).
  - Salvaguarda: Si una condición cualitativa no puede expresarse mediante los operadores disponibles, se mantiene `automatable: false` y solicita reevaluación por IA, manteniendo `WAITING_CONFIRMATION` sin auto-aprobar condiciones desconocidas.
- [x] **Vigilante Algorítmico Secuencial Cronológico**:
  - Enlace cronológico estricto ($t_k \ge t_{k-1}$).
  - Control de tiempo máximo entre pasos con `maxStepDurationMs`: si transcurre más tiempo del permitido entre el paso anterior y el actual, el escenario se invalida automáticamente.
  - Protección estricta contra eventos obsoletos: velas cerradas con timestamp anterior a `discoveryTimestamp` son ignoradas tajantemente.
- [x] **Reevaluación Pre-Entrada y Conexión Automática a Paper Trading**:
  - Al cumplirse la secuencia de confirmaciones en zona, se consulta a las IA con el snapshot actualizado y se audita cuantitativamente el R:R neto ($\ge 1:2$ y $\ge 1:4$) en `RiskCalculator`.
  - Al validarse la entrada (`ENTRY_VALIDATED`), se abre inmediatamente la posición virtual de paper trading en `SignalStateMachine` y `MarketMonitorWorker`, registrando precio de entrada, SL, TP 1:2, TP 1:4, comisiones, MFE, MAE y seguimiento tick a tick.
  - Cero dinero real, cero claves privadas de trading: estricta garantía `SIGNALS_ONLY`.
- [x] **Visualización Coherente de Observaciones NEUTRAL en Dashboard**:
  - Ocultación total de Stop Loss, Take Profit y R:R para observaciones neutrales (`N/A (Observación)` / `---`).
  - Renderizado de límites de consolidación (`Rango [Piso - Techo]`).
  - Banner explicativo dedicado en el detalle de escenario sin métricas comerciales.
  - Filtros y pestañas dedicadas: `TODOS`, `TRADES (ENTRADAS)`, `OBSERVACIONES NEUTRALES`, `COMPLETADOS (RUPTURA)`, `INVALIDADOS / EXPIRADOS`.
  - Subtítulo formal: *"Los escenarios son hipótesis de análisis técnico bajo vigilancia algorítmica 24/7, no operaciones ejecutadas."*
- [x] **Reconciliación Contable de IA Transparente**:
  - Desglose contable en API y Dashboard:
    - Gasto Bruto Hoy vs Gasto Neto Hoy.
    - Descuento Promocional Estimado (OpenAI Data Sharing) con badge `ESTIMADO PROMO`.
    - Descuento Facturado Confirmado.
    - Gasto Bruto Histórico vs Gasto Neto Histórico.
    - Reservas Pendientes y Saldo Disponible Diario ($0.50 USD limit).
    - Prohibición estricta de inflar límites presupuestarios con descuentos estimados.
- [x] **Cobertura Completa de Pruebas**:
  - **140 pruebas unitarias aprobadas al 100% (0 fallos)** en la suite completa de backend.

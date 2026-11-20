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
| **Fase 5** | Backtesting, Paper Trading & Validación | Motor de backtesting sin look-ahead bias, simulador de paper trading en vivo, métricas reales | PENDIENTE |
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
  - Google Gemini: `gemini-2.5-flash`, `gemini-1.5-pro`, `gemini-2.0-flash`.
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

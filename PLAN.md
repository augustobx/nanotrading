# NanoLabs AI Trading — Master Plan & Execution Roadmap

**Proyecto:** NanoLabs AI Trading  
**Instrumento:** BTCUSDT Perpetual (Bybit V5 Linear)  
**Entorno de Producción:** Servidor Dedicado Debian (`/opt/apps/nanolabs-ai-trading`)  
**Zona Horaria de Referencia:** `America/Argentina/Buenos_Aires`  
**Última Actualización:** 2026-11-19

---

## Matriz de Fases y Estado de Avance

| Fase | Título | Alcance Principal | Estado |
| :--- | :--- | :--- | :--- |
| **Fase 0** | Auditoría, Arquitectura y Preparación | Estructura del proyecto, tipados, docker aislado, CI/scripts, base de datos | **COMPLETADA** |
| **Fase 1** | Bybit y Mercado en Tiempo Real | Clientes V5 REST & WS, streams multitemporales, gaps, orderbook, server API, gráficos en vivo | **COMPLETADA** |
| **Fase 2** | Motor Técnico Cuantitativo & SMC/ICT | Detección de Swings, BOS, CHoCH, FVG, OB, Liquidez, Estrategias A y B, R:R 1:4 estricto | **COMPLETADA** |
| **Fase 3** | Integración de IA & Motor de Consenso | Proveedores OpenAI y Gemini independientes, schemas estructurados, consenso, control de costos | PENDIENTE |
| **Fase 4** | Alertas, Máquina de Estados y PWA | Ciclo de vida completo de señales, Telegram Bot, Web Push PWA, UI con NanoLabs Theme 2 | PENDIENTE |
| **Fase 5** | Backtesting, Paper Trading & Validación | Motor de backtesting sin look-ahead bias, simulador de paper trading en vivo, métricas reales | PENDIENTE |
| **Fase 6** | Preparación para Ejecución Asistida | Abstracción de ejecución privada, reconciliación, kill switch avanzado (modo deshabilitado por defecto) | PENDIENTE |

---

## FASE 0: Auditoría, Arquitectura y Preparación

### Objetivos
- Configurar el entorno de desarrollo y estructura monorepo/modular desacoplada.
- Definir modelos de datos, esquemas de persistencia y tipado estricto.
- Crear configuración aislada de Docker Compose para despliegue en servidor dedicado NanoLabs.
- Configurar linters, scripts de test y arranque.

### Tareas Detalladas
- [x] Inicializar repositorio Git y `.gitignore`.
- [x] Documentar `AGENTS.md` con reglas permanentes.
- [x] Crear `PLAN.md` maestro.
- [x] Configurar `package.json` raíz y estructura de directorios:
  - `backend/`: Core de trading, ingestion de mercado, cálculo cuantitativo, persistencia, servidor HTTP/WS.
  - `frontend/`: Aplicación Next.js PWA con Tailwind CSS, componentes oficiales NanoLabs Theme 2 y visualizador financiero.
  - `docker/`: Configuración Docker Compose aislada para PostgreSQL, Redis, backend y frontend.
- [x] Definir esquemas de base de datos para velas (`candles`), libros (`orderbook_snapshots`), eventos (`market_events`), configuraciones (`trading_config`), setups, señales y auditoría.
- [x] Configurar capa de base de datos compatible (PostgreSQL para producción/docker y SQLite WAL para desarrollo y tests locales inmediatos sin dependencias externas obligatorias).
- [x] Verificar healthcheck básico y scripts de compilación TypeScript.

### Criterios de Aceptación Fase 0
- El proyecto compila sin errores de tipos TypeScript en modo estricto. (VERIFICADO)
- Se cuenta con entorno ejecutable de backend y frontend. (VERIFICADO)
- Los contenedores Docker están aislados y no interfieren con ningún servicio existente de NanoLabs. (VERIFICADO)

---

## FASE 1: Bybit y Mercado en Tiempo Real

### Objetivos
- Conectar con la API V5 de Bybit (`linear`, `BTCUSDT`) en tiempo real.
- Soportar streaming y consultas REST de velas en las 6 temporalidades requeridas: 1D, 4H, 1H, 15m, 5m, 1m.
- Procesar tickers, Mark Price, Index Price, Funding Rate, Open Interest, Order Book (L2 depth 50) y liquidaciones.
- Implementar reconexión automática resiliente, heartbeats y detección de gaps con backfilling REST.
- Exponer API HTTP y WebSocket interno para el panel PWA y alimentar el gráfico interactivo con velas reales.

### Tareas Detalladas
- [x] Implementar `BybitRestClient`:
  - `getKlines(category, symbol, interval, limit, start, end)`
  - `getTicker(category, symbol)`
  - `getOrderBook(category, symbol, limit)`
  - `getInstrumentsInfo(category, symbol)`
  - `getRecentTrades(category, symbol, limit)`
  - Manejo de rate limits (header tracking) y backoff exponencial con jitter ante errores 429/5xx.
- [x] Implementar `BybitWsClient`:
  - Conexión a `wss://stream.bybit.com/v5/public/linear`
  - Heartbeat ping cada 20 segundos con verificación de pong.
  - Suscripción dinámica a tópicos: `tickers.BTCUSDT`, `kline.{interval}.BTCUSDT`, `orderbook.50.BTCUSDT`, `publicTrade.BTCUSDT`, `allLiquidation.BTCUSDT`.
  - Detección de stream congelado (watchdog timer).
  - Reconexión automática sin pérdida de estado.
- [x] Implementar `CandleManager`:
  - Soporte para 1m, 5m, 15m, 1h, 4h, 1d.
  - Distinción estricta de vela abierta (`confirm: false`) vs vela cerrada (`confirm: true`).
  - Detección de gaps temporales y sincronización automática vía REST.
  - Almacenamiento eficiente en memoria (buffer circular) y persistencia en DB.
- [x] Implementar `OrderBookManager`:
  - Procesamiento de snapshots y deltas Bybit V5 con validación de secuencia.
  - Cálculo de spread (Bid-Ask), Best Bid, Best Ask y desequilibrio de liquidez (order book imbalance).
- [x] Implementar API Server (HTTP + WebSocket):
  - `GET /health`: Estado detallado de conectividad Bybit, latencia, último mensaje WS, tiempo de última vela cerrada por temporalidad.
  - `GET /api/v1/market/state`: Ticker en vivo, mark price, spread, funding, open interest.
  - `GET /api/v1/market/candles`: Velas históricas verificables por temporalidad.
  - `GET /api/v1/market/orderbook`: Snapshot del libro y spread.
  - WebSocket interno `/ws/live`: Emisión en tiempo real de ticks, velas actualizadas y estado para el frontend.
- [x] Implementar Frontend PWA con datos reales:
  - Gráfico profesional de velas japonesas interactivas (TradingView Lightweight Charts).
  - Selector de temporalidades (1m, 5m, 15m, 1h, 4h, 1d).
  - Indicadores de conexión en vivo con Bybit (latencia en ms, timestamp UTC y AR).
  - Tarjetas de métricas en tiempo real: Last, Mark, Index, Spread, 24h Vol, Funding Rate, Open Interest.
  - Header NanoLabs oficial de 80px con selector de 7 paletas y dark mode.
- [x] Batería de Tests de Fase 1:
  - Test unitario: parsing de mensajes WS Bybit y normalización de velas.
  - Test unitario: detección de gaps en secuencia de velas y disparador de backfill.
  - Test de integración: conectividad REST real con Bybit V5.
  - Test de integración: streaming de WebSocket real y recepción de tickers y velas.
  - Test de integración end-to-end de servidor HTTP y WebSocket interno.

### Criterios de Aceptación Fase 1
- El usuario puede abrir la aplicación y ver BTCUSDT en vivo con velas reales de Bybit en los 6 marcos temporales. (VERIFICADO)
- Al forzar una desconexión de red o reinicio del servicio, el sistema se reconecta automáticamente y rellena cualquier gap detectado sin duplicar velas. (VERIFICADO)
- Las cotizaciones y métricas de Bybit coinciden exactamente con la realidad del exchange. (VERIFICADO)

---

## FASE 2: Motor Técnico Cuantitativo & SMC/ICT

### Objetivos
- Motor determinista multitemporal sin dependencia de IA.
- Detección algorítmica de swings, BOS, CHoCH, Fair Value Gaps (FVG), Order Blocks (OB) y barridos de liquidez.
- Indicadores complementarios: RSI, ATR, EMAs (20, 50, 200), VWAP, volumen relativo.
- Implementación de Estrategia A (Continuación de tendencia) y Estrategia B (Barrido y reversión).
- Cálculo estricto de Stop Loss técnico, Take Profit estructural y filtro R:R $\ge$ 1:4 considerando comisiones y spread.

### Tareas Detalladas
- [x] Implementar indicadores técnicos complementarios (`indicators.ts`):
  - RSI Wilder suavizado (período 14).
  - ATR para volatilidad real (período 14).
  - EMAs 20, 50 y 200 con convergencia ponderada.
  - VWAP con reseteo diario a las 00:00 UTC.
  - RVOL (Volumen relativo contra promedio de 20 velas).
- [x] Implementar detector SMC/ICT sin look-ahead bias (`smc-detector.ts`):
  - Detección de Swings High y Low confirmados estrictamente a $i + \text{rightBars}$.
  - Clasificación de estructura: HH, HL, LH, LL, EQH, EQL.
  - Detección de rupturas de estructura (BOS) y cambios de carácter (CHoCH) en velas cerradas.
  - Detección y ciclo de vida de Fair Value Gaps (Activo, Mitigado, Invalidado).
  - Identificación de Order Blocks candidatos con desplazamiento $\ge 1.5 \times$ cuerpo.
  - Detección de barridos de liquidez (mecha de penetración con rechazo $\ge 25\%$).
- [x] Implementar calculador estricto de riesgo/beneficio (`risk-calculator.ts`):
  - Dimensionamiento de posición según capital configurado y riesgo (0.5% default).
  - Deducción de comisiones Bybit (taker 0.055% entrada y salida).
  - Deducción de spread real del Order Book y deslizamiento estimado (0.02%).
  - Rechazo imperativo si el R:R neto $< 4.0$.
- [x] Implementar Estrategias A y B (`strategy-a-trend.ts`, `strategy-b-sweep.ts`):
  - Estrategia A: continuación de tendencia multitemporal (4H/1H sesgo + 15m zona + 5m confirmación).
  - Estrategia B: barrido de liquidez y reversión (sweep 15m/1H + rechazo + 5m CHoCH).
  - Cero señales forzadas: no operar es la decisión cuando no hay confluencia.
- [x] Implementar orquestador de setups (`setup-engine.ts`):
  - Evaluación continua ante cierre de velas.
  - Persistencia de setups calificados e invalidados en SQLite / PostgreSQL.
  - Endpoints `/api/v1/market/analysis` y `/api/v1/market/setups`.
- [x] Integración visual en el gráfico (`CandleChart.tsx`):
  - Marcadores de Swings (HH/HL/LH/LL).
  - Marcadores de BOS y CHoCH.
  - Líneas de FVG y Order Blocks.
  - Líneas de Entrada, SL y TP (1:4) para setups activos.
  - Barra de control de capas SMC / ICT.

### Criterios de Aceptación Fase 2
- Se generan setups candidatos con justificación matemática y niveles exactos basados únicamente en datos pasados y velas cerradas. (VERIFICADO)
- Los 21 tests de unidad e integración pasan al 100%. (VERIFICADO)

---

## FASE 3: Integración de IA & Motor de Consenso

### Objetivos
- Conexión con OpenAI API y Google Gemini API mediante esquemas estructurados estrictos (JSON Schema / Structured Outputs).
- Ambas IA evalúan de forma independiente el mismo snapshot cuantitativo sin conocer la opinión de la otra.
- Motor de consenso que requiere doble aprobación antes de validar una oportunidad.
- Control estricto de costos de IA: invocación únicamente ante setups calificados, seguimiento de tokens y presupuesto diario.

### Criterios de Aceptación Fase 3
- Respuestas de IA auditables y almacenadas con hash del snapshot; una respuesta inválida o contradictoria descarta la señal de inmediato.

---

## FASE 4: Alertas, Máquina de Estados y PWA

### Objetivos
- Máquina de estados completa para señales (`OBSERVING` a `COMPLETED_TP`/`COMPLETED_SL`/`INVALIDATED`).
- Canal de notificaciones push PWA y Bot de Telegram con niveles de alerta 1 a 6.
- Panel de oportunidades y seguimiento en vivo con NanoLabs Theme 2.

### Criterios de Aceptación Fase 4
- Ciclo completo de vida de una señal trazable en UI y notificado a Telegram en tiempo real.

---

## FASE 5: Backtesting, Paper Trading & Validación

### Objetivos
- Motor de backtesting determinista sin look-ahead bias con deducción de comisiones y deslizamiento.
- Módulo de Paper Trading en tiempo real con simulación de ejecución de órdenes y registro auditado.
- Métricas estadísticas verificables (Win Rate, Profit Factor, Expectancy, Max Drawdown, MFE/MAE, R neto).
- Comparativa de rendimiento: Técnico puro vs Técnico + OpenAI vs Técnico + Gemini vs Consenso Dual.

### Criterios de Aceptación Fase 5
- Reportes reproducibles y separación explícita entre datos históricos y forward-testing en vivo.

---

## FASE 6: Preparación para Ejecución Asistida

### Objetivos
- Abstracción de ejecución privada con Bybit V5 autenticada (solo lectura por defecto).
- Reconciliación de balances y posiciones, modo manual asistido, Kill Switch de emergencia.

### Criterios de Aceptación Fase 6
- La arquitectura permite enchufar ejecución autenticada sin alterar la lógica de análisis, manteniendo `LIVE_TRADING` bloqueado por seguridad.

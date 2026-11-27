# NanoLabs AI Trading

## Actualización 2026-11-27 — Fast Lane cuantitativa (SHADOW por defecto)

**Estado real:** BTCUSDT y ETHUSDT siguen conectados a Bybit V5 Linear. Ahora se evalúa cada cierre **5m** con reglas puramente matemáticas de **barrido SFP** y **pullback EMA21 5m / tendencia EMA50 15m**, sin solicitar opiniones de GPT ni Gemini. Se audita también cada vela que no tenga patrón y se registra el motivo cuando un candidato queda descartado.

- **Modo `SHADOW`** (predeterminado): se recopila evidencia cuantitativa, pero la vía matemática **no crea operaciones paper**. El circuito heredado de IA permanece activo para investigación/comparación.
- **Modo `PAPER`** (opt-in explícito `QUANT_SIGNAL_MODE=PAPER` en `.env` y reinicio): la vía matemática puede emitir señales paper solo si supera riesgo, spreads, R:R neto y límites globales. El discovery/watch/revalidation automático por IA deja de ser una fuente operativa de señales. **Sin ejecución real.**
- La política de riesgo existente **NO baja automáticamente**: `minNetRR=4` sigue siendo 4R. Para comparar 2R y 4R está el replay de investigación; cualquier cambio de la política debe evaluarse por separado.
- El frontend principal `/` se ha simplificado: mercado, estado, últimas decisiones, métricas y paper. Todo el panel anterior se conserva en `/legacy`.
- Los endpoints de auditoría matemática son `GET /api/v1/markets/BTCUSDT/quant` y `.../ETHUSDT/quant`. No consumen tokens IA.
- Para ejecutar el backtest **offline** de 90 días sobre velas históricas previamente importadas: `node backend/dist/scripts/run-quant-90d.js` (BTC), o `node backend/dist/scripts/run-quant-90d.js --eth` (ETH). Compara dos objetivos netos (2R/4R), con 60 días de desarrollo y 30 fuera de muestra, sin asumir rentabilidad. Esta primera versión no simula parciales/trailing ni reemplaza un test prospectivo de fills.

### Reseteo protegido del historial operativo (requiere servidor y backup)

La tarea del usuario es empezar desde cero con descubrimientos, escenarios, señales, paper, auditorías y backtests anteriores. **No eliminar volúmenes Docker ni SQLite directamente**: eso borraría las credenciales cifradas, cuentas, políticas de riesgo y claves de login.

1. Tras aprobar PR y verificar el código fusionado, compilar **ambos** contenedores sin pararlos: `docker compose build backend frontend`.
2. Detener únicamente los servicios app: `docker compose stop frontend backend`.
3. Hacer backup del volumen en frío con una ruta de acceso restringido, por ejemplo:
   `docker run --rm -v nanolabs_trading_data:/source:ro -v "$BACKUP":/backup alpine:3.20 sh -ec 'cd /source && tar -cf /backup/sqlite-volume.tar .'`.
   Confirmar `tar -tf "$BACKUP/sqlite-volume.tar"` incluye `./trading.db` y guardar `sha256sum`.
4. Con ambos contenedores todavía detenidos, ejecutar el **script offline**, vía imagen nueva, montando backup `-v "$BACKUP":/backup:ro`, las variables `CONFIRM_OPERATIONAL_RESET=DELETE_NON_CONFIG_DATA` y `CONFIRMED_BACKUP_FILE=/backup/sqlite-volume.tar`, con el comando `node backend/dist/scripts/reset-operational-history.js`. Sin las tres garantías, se rechaza.
5. Reiniciar `docker compose up -d --no-deps --force-recreate backend frontend` y comprobar `/health`, ambos `/api/v1/markets` y auditorías `/quant`.

**Se conservan** configuraciones, credenciales, sesiones administrativas, historial `historical_candles` (única base para los 90 días), suscripciones y consumos reales de IA. El presupuesto ya gastado NO se pone artificialmente en cero. El reset no se ha ejecutado en producción desde GitHub; exige intervención explícita por SSH y respaldo.

---

> **Sistema inteligente de análisis cuantitativo, monitoreo multitemporal y asistencia de trading 24/7 en BTCUSDT Perpetual (Bybit V5 Linear).**

---

## 1. Filosofía y Principios Operativos

1. **"No operar es una decisión válida y a menudo la mejor"**: El sistema no fuerza señales. No busca operaciones todos los días, sino setups con confluencia técnica estricta y ratio beneficio/riesgo (R:R) neto $\ge$ 1:4.
2. **Cero Datos Simulados**: Todos los precios, velas, libro de órdenes, spreads, volumen y métricas provienen en tiempo real de la API V5 oficial de Bybit.
3. **Seguridad Operativa**:
   - Modo de inicio: `SIGNALS_ONLY` y `PAPER_TRADING`.
   - La ejecución real con dinero (`LIVE_TRADING`) está desactivada por defecto a nivel arquitectónico y protegida por un **Kill Switch** de emergencia.
   - Ninguna IA tiene acceso directo a claves de trading privadas ni permisos de movimiento de fondos.
4. **Determinismo sobre IA**: El motor algorítmico y matemático cuantitativo tiene prioridad absoluta sobre cualquier modelo de lenguaje. OpenAI y Google Gemini actúan como analistas independientes sobre snapshots inmutables para proveer consenso o detectar riesgos ignorados.

---

## 2. Arquitectura del Sistema

```
                            ┌──────────────────────────────────────────────┐
                            │            BYBIT V5 LINEAR API               │
                            │  (REST: klines, tickers, orderbook, specs)   │
                            │  (WS: tickers, 6 klines, orderbook, trades)  │
                            └──────────────────────┬───────────────────────┘
                                                   │
                                                   ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             BACKEND ENGINE (Node.js 22)                          │
├──────────────────────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────┐   ┌───────────────────────┐   ┌────────────────────┐  │
│  │    BybitWsClient      │   │    BybitRestClient    │   │ DatabaseService    │  │
│  │ (Heartbeat, Reconnect)│   │  (Retry & Backoff)    │   │ (SQLite WAL / PG)  │  │
│  └──────────┬────────────┘   └───────────┬───────────┘   └─────────┬──────────┘  │
│             │                            │                         │             │
│             ▼                            ▼                         ▼             │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │                    MarketCoordinator & CandleManager                        │ │
│  │   - Multi-timeframe accumulator: 1m, 5m, 15m, 1h, 4h, 1d                   │ │
│  │   - Gap Detector con autorecuperación vía REST                              │ │
│  │   - OrderBook L2 Depth & Spread Manager                                     │ │
│  │   - Auditoría y Snapshots periódicos                                        │ │
│  └───────────────────────────────────────┬─────────────────────────────────────┘ │
│                                          │                                       │
│                                          ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │                     API Server (HTTP & Live WebSocket)                      │ │
│  │   - GET /health                                                             │ │
│  │   - GET /api/v1/market/state                                                │ │
│  │   - GET /api/v1/market/candles?timeframe=...                                │ │
│  │   - GET /api/v1/market/orderbook                                            │ │
│  │   - WS /ws/live (Streaming reactivo sin recarga)                            │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────┬───────────────────────────────────────┘
                                           │
                                           ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                            FRONTEND PWA (Next.js 15)                             │
├──────────────────────────────────────────────────────────────────────────────────┤
│  - Shell Oficial NanoLabs con Header de 80px y Selector de 7 Paletas Corporativas│
│  - Gráfico interactivo financiero TradingView (Lightweight Charts) con 6 TFs     │
│  - Ticker en vivo con visual flash de cotización Last, Mark, Index, Spread       │
│  - OrderBook Depth & Medidor de Imbalance                                        │
│  - Matriz de estado de las 6 temporalidades                                      │
│  - Tarjetas de estado de OpenAI y Google Gemini                                  │
│  - PWA instalable en móvil y escritorio con modo oscuro estricto                 │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Estructura de Directorios

```
c:/NanoLabs/OnlyTrading/
├── backend/
│   ├── src/
│   │   ├── types/               # Tipos TypeScript para mercado, velas, ticks
│   │   ├── config/              # Configuración y variables de entorno
│   │   ├── bybit/               # Clientes Bybit V5 REST y WebSocket
│   │   ├── market/              # CandleManager, OrderBookManager, Coordinator
│   │   ├── storage/             # DatabaseService (SQLite WAL y PostgreSQL)
│   │   ├── api/                 # Servidor HTTP y WebSocket Server (/ws/live)
│   │   └── index.ts             # Punto de entrada de backend
│   └── tests/                   # Batería de tests unitarios y de integración
├── frontend/
│   ├── src/
│   │   ├── app/                 # Next.js App Router (layout, page, globals.css)
│   │   ├── components/          # CandleChart, OrderBookWidget, MultiTimeframeMatrix
│   │   └── nanolabs-components/ # Paletas oficiales NanoLabs, ThemeContext, Selector
│   └── public/                  # Manifest PWA y activos estáticos
├── docker/
│   ├── docker-compose.yml       # Stack aislado para el dedicado Debian
│   ├── backend.Dockerfile
│   └── frontend.Dockerfile
├── AGENTS.md                    # Reglas permanentes del proyecto
├── PLAN.md                      # Roadmap y estado de avance de las fases
└── package.json                 # Workspaces raíz
```

---

## 4. Instalación y Ejecución Local

### Prerrequisitos
- Node.js >= 22.10
- npm >= 10.9

### Instalación de dependencias
```bash
npm install
```

### Ejecución de Pruebas
```bash
# Ejecutar todas las pruebas unitarias y de integración real con Bybit
npm run test:backend
```

### Iniciar Backend en Desarrollo
```bash
npm run dev:backend
```
El servidor backend escuchará en `http://localhost:3001` y su WebSocket en `ws://localhost:3001/ws/live`.

### Iniciar Frontend en Desarrollo
```bash
npm run dev:frontend
```
El panel PWA estará accesible en `http://localhost:3000`.

---

## 5. Despliegue en Servidor Dedicado NanoLabs

El proyecto se encuentra totalmente paquetizado en `docker/docker-compose.yml` para desplegarse en `/opt/apps/nanolabs-ai-trading` sin interferir con otros contenedores del servidor:

- Red aislada: `nanolabs_trading_net`
- Volúmenes dedicados: `nanolabs_trading_pgdata`, `nanolabs_trading_redisdata`
- Contenedores independientes con healthchecks automáticos.

```bash
cd docker
docker compose up -d --build
```

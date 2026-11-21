# Reglas Permanentes de NanoLabs AI Trading (AGENTS.md)

Este documento define la arquitectura, normas operativas, estándares de código y directivas permanentes para cualquier agente que trabaje en el proyecto **NanoLabs AI Trading**.

---

## 1. Misión y Filosofía del Producto
1. **NanoLabs AI Trading** es un sistema inteligente de análisis técnico cuantitativo, monitoreo 24/7 y asistencia en toma de decisiones para `BTCUSDT` Perpetual (Bybit V5 Linear).
2. **"No operar es una decisión válida y a menudo la mejor"**: El sistema no fuerza señales. Si no hay confluencia técnica estricta y ratio beneficio/riesgo (R:R) neto $\ge$ 1:4, la conclusión imperativa es **ESPERAR** o **DESCARTAR**.
3. **Cero Datos Ficticios**: Jamás inventar velas, cotizaciones, spreads, libros de órdenes ni métricas. Si un dato no está disponible o el stream se congela, el sistema pasa a estado `DATA_UNAVAILABLE` y bloquea nuevas señales.
4. **Seguridad Operativa y Ejecución**: Comienza en modo `SIGNALS_ONLY` y `PAPER_TRADING`. La ejecución real con dinero (`LIVE_TRADING`) está deshabilitada a nivel de código y arquitectura. Ninguna IA tiene acceso a claves privadas de trading.
5. **Determinismo sobre IA**: Las IAs (OpenAI y Google Gemini) actúan como analistas independientes sobre un snapshot estático e idéntico. Una IA jamás puede saltarse los controles deterministas de riesgo, invalidación o filtros técnicos.

---

## 2. Reglas Globales de NanoLabs
1. **Diseño Visual Oficial (`visual-nanolabs` / Theme 2)**:
   - Header de 80px con badge de la app, estado de conexión Bybit, selector de paleta corporativa y toggle dark/light.
   - Sincronización estricta de `data-theme="dark"` y clase `.dark` en `<html>`.
   - Paletas oficiales disponibles:
     1. 🟠 **Sunset Orange** (`#FF6600` - Insignia NanoLabs por defecto)
     2. 🔵 **Orion Blue** (`#2563EB`)
     3. 🟢 **Emerald Racing** (`#059669`)
     4. 🟣 **Purple Nebula** (`#7C3AED`)
     5. 🔴 **Crimson Sport** (`#DC2626`)
     6. 🟡 **Cyber Gold** (`#D97706`)
     7. ⚫ **Titanium Stealth** (`#475569`)
   - Tablas contenidas en `.overflow-x-auto.custom-scrollbar` con ancho mínimo controlado.
   - Tipografía: Inter para cuerpo, Poppins para títulos, JetBrains Mono para cotizaciones y métricas numéricas.
2. **Login Oficial (`login-nanolabs`)**:
   - Escena espacial reactiva en Canvas 2D nativo con partículas formando el isotipo de NanoLabs y apertura radial. Tarjeta de ingreso de 440-500px a la derecha. Píldora `Powered by NanoLabs`.
3. **Aislamiento en Servidor Dedicado Debian**:
   - Ruta objetivo de despliegue: `/opt/apps/nanolabs-ai-trading`.
   - Backups en `/opt/backups/nanolabs-ai-trading`.
   - Jamás modificar, reiniciar o interactuar con contenedores de otros proyectos (OnlyCars, OnlyFood, OnlyPadel, Nginx Proxy Manager, Portainer, etc.).
   - Utilizar redes y volúmenes Docker con prefijo `nanolabs_trading_`.
   - Zona horaria de referencia operativa: `America/Argentina/Buenos_Aires`.

---

## 3. Integración con Bybit V5 Linear
- **Categoría**: `linear`.
- **Símbolo**: `BTCUSDT`.
- **Endpoints REST**: `https://api.bybit.com/v5/market/...`
  - `/v5/market/kline` (intervals: `1`, `5`, `15`, `60`, `240`, `D`)
  - `/v5/market/tickers` (lastPrice, markPrice, indexPrice, fundingRate, openInterest)
  - `/v5/market/orderbook` (depth: 50)
  - `/v5/market/instruments-info` (tickSize: 0.10, qtyStep: 0.001, minOrderQty: 0.001)
  - `/v5/market/recent-trade`
- **WebSocket Público**: `wss://stream.bybit.com/v5/public/linear`
  - Ping/Pong cada 20 segundos (`{"op":"ping"}`).
  - Reconexión automática con backoff exponencial (1s, 2s, 4s, ..., máx 30s) y jitter.
  - Topics suscritos:
    - `tickers.BTCUSDT`
    - `kline.1.BTCUSDT`, `kline.5.BTCUSDT`, `kline.15.BTCUSDT`, `kline.60.BTCUSDT`, `kline.240.BTCUSDT`, `kline.D.BTCUSDT`
    - `orderbook.50.BTCUSDT`
    - `publicTrade.BTCUSDT`
    - `liquidation.BTCUSDT`
- **Gestión de Velas**:
  - Distinguir velas abiertas (`confirm: false`) de velas cerradas (`confirm: true`).
  - Las señales y cálculos estructurales deben basarse únicamente en velas cerradas.
  - Detección de gaps: si se pierde un timestamp en la secuencia de klines, disparar backfill REST inmediato.
  - Timestamps almacenados en milisegundos UTC; renderizados en UI según `America/Argentina/Buenos_Aires`.

---

## 4. Motor Cuantitativo y SMC/ICT
- **Marcos temporales obligatorios**:
  - `1D`: Tendencia macro, máximos/mínimos estructurales, zonas Premium/Discount, ATR diario.
  - `4H`: Estructura intermedia, BOS (Break of Structure), CHoCH (Change of Character), FVG candidatos, Order Blocks.
  - `1H`: Estructura intradía, máximos/mínimos de sesiones (Asia, London, NY), liquidez descansando.
  - `15m`: Identificación de setups potenciales (barridos, retrocesos a zonas de demanda/oferta, confluencia).
  - `5m`: Gatillo y confirmación de microestructura (BOS en micro, volumen de absorción, retesteo limpio).
  - `1m`: Filtro de precisión de spread y timing de entrada.
- **Estrategias base**:
  - **Estrategia A (Trend Continuation)**: Ruptura estructural con desplazamiento fuerte, retroceso a FVG/OB en confluencia con sesgo 4H/1H, gatillo en 5m/15m.
  - **Estrategia B (Liquidity Sweep & Reversal)**: Barrido de Equal Highs/Lows o sesión high/low, absorción con mecha y cierre de rechazo, CHoCH confirmado en 5m, entrada en mitigación.
- **Regla Estricta 1:4 Risk/Reward**:
  - $R:R = \frac{\text{Beneficio Neto Estimado}}{\text{Pérdida Máxima Estimada}} \ge 4.0$.
  - Descontar fees de entrada (taker/maker), fees de salida, spread estimado y slippage.
  - Nunca forzar un TP arbitrario; el TP debe anclarse a un nivel estructural real.

---

## 5. Arquitectura de IAs y Consenso
- **Proveedores**: OpenAI API (`gpt-4o` / compatible estructurado) y Google Gemini API (`gemini-2.0-flash` / `gemini-1.5-pro` / `gemini-2.0-flash-lite`).
- **Evaluación Independiente**: Ambas IAs reciben exactamente el mismo payload JSON con el snapshot del mercado (indicadores, klines resumidas, contexto multitemporal, setup detectado, niveles de SL/TP calculados).
- **Consenso Determinista**:
  - Si ambas IAs emiten `APPROVE` y el motor técnico confirma que el precio no se ha desplazado más allá de la tolerancia $\to$ estado `ENTRY_VALIDATED`.
  - Si una IA emite `REJECT` o advierte contradicciones severas $\to$ estado `WAITING_CONFIRMATION` o `INVALIDATED`.
  - Si una IA falla por rate-limit o timeout, se activa degradación configurada (por defecto no emitir señal sin doble validación).
- **Eficiencia de Costos**: Solo se consulta a las IAs cuando el motor técnico local detecta un setup preliminar válido (event-driven). No realizar llamadas continuas periódicas a las APIs de IA.

---

## 6. Ciclo de Vida de Señales (Máquina de Estados)
`OBSERVING` $\to$ `SETUP_DETECTED` $\to$ `APPROACHING_ZONE` $\to$ `IN_ZONE` $\to$ `WAITING_CONFIRMATION` $\to$ `AI_REVIEW` $\to$ `ENTRY_VALIDATED` $\to$ `ALERT_SENT` $\to$ `ENTRY_TRIGGERED` $\to$ `TRACKING` $\to$ (`COMPLETED_TP` | `COMPLETED_SL` | `EXPIRED` | `INVALIDATED` | `CANCELLED`).
- En cualquier momento: `DATA_UNAVAILABLE` suspende la publicación de señales.
- `Kill Switch` activo bloquea toda operación y notifica emergencia.

---

## 7. Estándares de Código y Calidad
- Lenguaje: TypeScript estricto (`noImplicitAny`, `strictNullChecks`).
- Arquitectura desacoplada: Servicios independientes de ingesta, cálculo, decisión, API y presentación.
- Tests automatizados obligatorios: Unitarios para cálculos matemáticos e indicadores, integración para API Bybit, simulación de WS y desconexiones.
- Cero librerías ficticias o mocks decorativos en producción.

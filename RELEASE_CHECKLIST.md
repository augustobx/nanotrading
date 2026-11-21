# NanoLabs AI Trading — Release Gate / Auditoría

**No habilitar operaciones reales. Mantener `SIGNALS_ONLY`.**
Código de auditoría: PR #1, rama `fix/audit-hardening-20261121`.
Este documento describe pasos de OPERACIÓN, no afirma que producción esté verificada.

## 1. Verificaciones previas
- CI GitHub Actions: builds de backend/frontend + suite unitaria segmentada totalmente en verde en el commit exacto a desplegar.
- GitHub PR actualizado, revisar diff y confirmar que master no cambió desde el inicio.
- Confirmar DB real: `DB_TYPE=sqlite`, `DB_SQLITE_PATH=/app/data/trading.db`; el volumen `nanolabs_trading_data` contiene la persistencia.
- Mantener otras aplicaciones NanoLabs fuera de Compose, sin prune ni cambios en `proxy`.
- Registrar `docker compose ps`, hashes de imágenes actuales y salud de DB antes de actuar.

## 2. **Bloqueo de credenciales cifradas** (obligatorio)
La versión anterior cifraba con `CONFIG_MASTER_KEY` si existía, o
`ADMIN_API_KEY`, o una constante publicada en el código.
La versión nueva **solo** acepta `CONFIG_MASTER_KEY` de 32+ bytes.
No desplegar hasta conocer **qué clave cifró el volumen actual**, o hasta
confirmar que no hay credenciales cifradas guardadas.

- Elegir nueva clave aleatoria **fuera de GitHub** y guardarla en secreto local seguro:
  `openssl rand -hex 32`. No rotar una clave ya vigente a ciegas.
- Hacer BACKUP externo verificable del volumen SQLite, incluidas transacciones WAL,
  y registrar una ruta de rollback. **No basta copiar solo el archivo .db mientras escribe el backend**.
- Construir imagen nueva SIN levantarla: `docker compose build backend frontend`.
- Detener SOLO el backend NanoTrading (y frontend si depende de él):
  `docker compose stop frontend backend`. No detener Postgres/Redis de otros proyectos.
- La migración offline requiere `DB_SQLITE_PATH`, `CONFIG_MASTER_KEY` y
  `LEGACY_VAULT_SECRET` como variables temporales **que no se registren en la terminal**.
  El valor antiguo se obtiene de la configuración real usada al cifrar; no adivinar.
- Correr dry run del script en contenedor efímero, con el volumen de NanoTrading montado;
  luego con `OFFLINE_VAULT_MIGRATION=YES` y `--apply`.
  Script: `backend/scripts/migrate-vault-key.ts`.
  Si no hay credenciales, no se deben ejecutar escrituras innecesarias.
- Confirmar backup `trading.db.pre-vault-*.sqlite`, validación de integridad y capacidad
  de descifrar todas las credenciales. El script no imprime secretos.
- **Nunca ejecutar simultáneamente la migración y el backend productivo**.
- Al reiniciar con la nueva clave, verificar acceso a OpenAI, Gemini y Bybit desde
  el panel autenticado antes de habilitar descubrimiento.
- No guardar `LEGACY_VAULT_SECRET` en `.env` permanente ni en el repositorio.

## 3. Despliegue y smoke
- `TRADING_MODE=SIGNALS_ONLY` y no órdenes reales.
- `docker compose up -d --no-deps backend frontend` solo después de la migración.
- Verificar `docker compose ps`, logs de los dos contenedores,
  `/health`, precio/WS, endpoints protegidos (401 sin sesión; 200 con sesión),
  persistencia y estado del scheduler / watcher.
- Activar prueba controlada con presupuesto mínimo; **no forzar operaciones**.
- Confirmar que el primer PAPER trade nace de una confirmación posterior,
  tiene una sola exposición, sizing real, costos y salida observada.
- Confirmar después de reiniciar que Kill Switch, escenarios y operaciones
  mantienen estado. No usar dinero real para esta validación.

## 4. Rollback
- Conservar imágenes anteriores, backup SQLite íntegro y clave antigua protegida
  hasta comprobar servicio estable.
- Un rollback de código **sin rollback de clave/base** puede romper el cifrado.
  Restaurar versión + base + clave como una unidad y comprobar integridad.
- No usar `docker compose down -v`, `docker system prune` o reinicios globales.

## 5. Límites explícitos de esta revisión
Las pruebas automáticas no sustituyen verificaciones de red reales, análisis
de facturación OpenAI/Gemini ni forward paper trading prospectivo.
No clasificar como listo para LIVE hasta pruebas de fallos, reintentos, duplicidad,
acceso indebido y drawdown, y revisión de la configuración real.

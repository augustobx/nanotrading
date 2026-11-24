/**
 * NanoTrading - Formatters for Operational Clarity & Argentine Timezone
 */

export const ARGENTINA_TIMEZONE = 'America/Argentina/Buenos_Aires';

/**
 * Format a timestamp into Argentine Date & Time
 * e.g. "24/11/2026 10:24 ART" or "24/11/2026 10:24:30 ART"
 */
export function formatArgentinaDateTime(
  timestamp?: number | string | Date | null,
  options: { includeSeconds?: boolean; includeZone?: boolean } = {}
): string {
  if (!timestamp) return '---';
  const date = typeof timestamp === 'number' || typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  if (isNaN(date.getTime())) return '---';

  const { includeSeconds = false, includeZone = true } = options;

  try {
    const formatter = new Intl.DateTimeFormat('es-AR', {
      timeZone: ARGENTINA_TIMEZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: includeSeconds ? '2-digit' : undefined,
      hour12: false,
    });

    const formatted = formatter.format(date);
    return includeZone ? `${formatted} ART` : formatted;
  } catch {
    return date.toLocaleString('es-AR');
  }
}

/**
 * Format a timestamp into Argentine Time only
 * e.g. "10:24:30"
 */
export function formatArgentinaTime(
  timestamp?: number | string | Date | null,
  includeSeconds: boolean = true
): string {
  if (!timestamp) return '---';
  const date = typeof timestamp === 'number' || typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  if (isNaN(date.getTime())) return '---';

  try {
    return new Intl.DateTimeFormat('es-AR', {
      timeZone: ARGENTINA_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      second: includeSeconds ? '2-digit' : undefined,
      hour12: false,
    }).format(date);
  } catch {
    return date.toLocaleTimeString('es-AR');
  }
}

/**
 * Format a timestamp into Argentine Date only
 * e.g. "24/11/2026"
 */
export function formatArgentinaDate(timestamp?: number | string | Date | null): string {
  if (!timestamp) return '---';
  const date = typeof timestamp === 'number' || typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  if (isNaN(date.getTime())) return '---';

  try {
    return new Intl.DateTimeFormat('es-AR', {
      timeZone: ARGENTINA_TIMEZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  } catch {
    return date.toLocaleDateString('es-AR');
  }
}

/**
 * Format timestamp into relative time ("hace 5m", "hace 2h", "en 15m")
 */
export function formatTimeAgo(timestamp?: number | string | Date | null): string {
  if (!timestamp) return '---';
  const date = typeof timestamp === 'number' || typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  if (isNaN(date.getTime())) return '---';

  const now = Date.now();
  const diffMs = now - date.getTime();
  const absDiff = Math.abs(diffMs);
  const isFuture = diffMs < 0;

  const seconds = Math.floor(absDiff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const prefix = isFuture ? 'en ' : 'hace ';

  if (seconds < 45) return isFuture ? 'en unos segundos' : 'hace unos segundos';
  if (minutes < 60) return `${prefix}${minutes}m`;
  if (hours < 24) return `${prefix}${hours}h ${minutes % 60}m`;
  return `${prefix}${days}d ${hours % 24}h`;
}

/**
 * Format USD currency
 */
export function formatUsd(amount?: number | null, decimals: number = 4): string {
  if (amount === undefined || amount === null || isNaN(amount)) return '$0.0000 USD';
  return `$${amount.toFixed(decimals)} USD`;
}

/**
 * Format BTCUSDT Price
 */
export function formatPrice(price?: number | null, decimals: number = 1): string {
  if (price === undefined || price === null || isNaN(price)) return '---';
  return `$${price.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * Format percentage
 */
export function formatPercent(pct?: number | null, decimals: number = 2): string {
  if (pct === undefined || pct === null || isNaN(pct)) return '0.00%';
  return `${pct.toFixed(decimals)}%`;
}

/**
 * Format duration ms
 */
export function formatDurationMs(ms?: number | null): string {
  if (!ms || ms <= 0) return '< 1m';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

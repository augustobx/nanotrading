/**
 * NanoLabs AI Trading - API & WebSocket URL Resolution Utility
 * 
 * Supports:
 * - Local development on localhost/127.0.0.1 (defaults to port 3001)
 * - Production deployments behind Nginx Proxy Manager / HTTPS
 * - Same-origin reverse proxy mappings without mixed-content errors
 * - Explicit override via NEXT_PUBLIC_API_URL and NEXT_PUBLIC_WS_URL
 */

export function getApiBaseUrl(): string {
  // 1. Explicit environment variable override
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/+$/, '');
  }

  // 2. Client-side browser resolution
  if (typeof window !== 'undefined') {
    // If accessing on port 3000 (localhost or LAN IP like 192.168.x.x), backend is on port 3001
    if (window.location.port === '3000') {
      return `${window.location.protocol}//${window.location.hostname}:3001`;
    }

    // In production behind reverse proxy (e.g. Nginx Proxy Manager):
    // Use same-origin protocol and host (port 443 / HTTPS) to eliminate CORS and mixed-content issues
    return `${window.location.protocol}//${window.location.host}`;
  }

  // 3. Server-side / fallback
  return 'http://localhost:3001';
}

export function getWebSocketLiveUrl(): string {
  // 1. Explicit environment variable override
  if (process.env.NEXT_PUBLIC_WS_URL) {
    return process.env.NEXT_PUBLIC_WS_URL;
  }

  // 2. Client-side browser resolution
  if (typeof window !== 'undefined') {
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    // If accessing on port 3000 (localhost or LAN IP like 192.168.x.x), backend WS is on port 3001
    if (window.location.port === '3000') {
      return `${wsProto}//${window.location.hostname}:3001/ws/live`;
    }

    // In production behind reverse proxy (Nginx Proxy Manager upgrades /ws/live)
    return `${wsProto}//${window.location.host}/ws/live`;
  }

  return 'ws://localhost:3001/ws/live';
}

/** Admin mutations require a validated session AND the session-bound CSRF token. */
export async function getAdminMutationHeaders(): Promise<Record<string, string>> {
  const response = await fetch(`${getApiBaseUrl()}/api/v1/auth/status`, { credentials: 'include' });
  if (!response.ok) throw new Error('No se pudo validar la sesión administrativa');
  const session = await response.json();
  if (!session.authenticated || !session.csrfToken) {
    throw new Error('Iniciá sesión como administrador antes de ejecutar esta acción');
  }
  return { 'Content-Type': 'application/json', 'x-csrf-token': session.csrfToken };
}

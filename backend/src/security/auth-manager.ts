import crypto from 'crypto';
import http from 'http';
import { config } from '../config/index.js';
import { DatabaseService } from '../storage/database.js';

export const REVOKED_ADMIN_KEYS = new Set([
  'nanolabs_admin_sec_2026',
  'admin',
  'password',
  '12345678',
  '123456789',
  'qwerty',
]);

export interface AdminSession {
  token: string;
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
  ipAddress?: string;
  userAgent?: string;
}

export class AuthManager {
  private db?: DatabaseService;
  private activeSessions: Map<string, AdminSession> = new Map();
  private failedAttempts: Map<string, { count: number; lastAttempt: number }> = new Map();
  private sessionTtlMs: number = 12 * 60 * 60 * 1000; // 12 hours
  private maxFailedAttempts: number = 5;
  private lockoutDurationMs: number = 15 * 60 * 1000; // 15 minutes lockout

  constructor(db?: DatabaseService) {
    this.db = db;
    this.bootstrapEnvAdmin();
  }

  public setDatabase(db: DatabaseService): void {
    this.db = db;
    this.bootstrapEnvAdmin();
  }

  /**
   * Hashes a password using scrypt with a unique random salt.
   */
  public hashPassword(password: string, salt?: string): { hash: string; salt: string } {
    const actualSalt = salt || crypto.randomBytes(16).toString('hex');
    const derivedKey = crypto.scryptSync(password, actualSalt, 64);
    return {
      hash: derivedKey.toString('hex'),
      salt: actualSalt,
    };
  }

  /**
   * Verifies a password against a salt and hash using timing-safe comparison.
   */
  public verifyPassword(password: string, hash: string, salt: string): boolean {
    try {
      const derivedKey = crypto.scryptSync(password, salt, 64);
      const hashBuf = Buffer.from(hash, 'hex');
      if (derivedKey.length !== hashBuf.length) {
        return false;
      }
      return crypto.timingSafeEqual(derivedKey, hashBuf);
    } catch {
      return false;
    }
  }

  /**
   * Bootstraps admin password from process.env.ADMIN_API_KEY if present and secure.
   */
  private bootstrapEnvAdmin(): void {
    const envKey = (process.env.ADMIN_API_KEY || '').trim();
    if (!envKey || REVOKED_ADMIN_KEYS.has(envKey)) {
      return;
    }
    if (this.db && !this.db.hasAdminCredentials()) {
      const { hash, salt } = this.hashPassword(envKey);
      this.db.setAdminCredentials(hash, salt);
    }
  }

  /**
   * Checks if an admin credential has been set up in database or explicit environment.
   */
  public isInitialized(): boolean {
    if (this.db?.hasAdminCredentials()) {
      return true;
    }
    const envKey = (process.env.ADMIN_API_KEY || '').trim();
    return !!envKey && !REVOKED_ADMIN_KEYS.has(envKey);
  }

  public reset(): void {
    this.activeSessions.clear();
    this.failedAttempts.clear();
  }

  /**
   * Sets up the initial administrator password securely.
   */
  public setupInitialAdmin(password: string, clientIp?: string): {
    success: boolean;
    token?: string;
    csrfToken?: string;
    expiresAt?: number;
    error?: string;
  } {
    if (this.isInitialized()) {
      return { success: false, error: 'El administrador ya se encuentra inicializado en el sistema.' };
    }
    const cleanPw = (password || '').trim();
    if (REVOKED_ADMIN_KEYS.has(cleanPw)) {
      return { success: false, error: 'Esta clave se encuentra en la lista de claves revocadas e inseguras.' };
    }
    if (cleanPw.length < 10) {
      return { success: false, error: 'La clave administrativa debe tener al menos 10 caracteres.' };
    }

    const { hash, salt } = this.hashPassword(cleanPw);
    if (this.db) {
      this.db.setAdminCredentials(hash, salt);
      this.db.logConfigAudit({
        category: 'AUTH',
        action: 'INITIAL_ADMIN_SETUP',
        details: { initialized: true },
        ipAddress: clientIp,
      });
    }

    return this.createSession(clientIp);
  }

  /**
   * Attempts admin login with rate limiting, revocation check, and timing-safe verification.
   */
  public login(
    key: string,
    clientIp?: string,
    userAgent?: string
  ): {
    success: boolean;
    token?: string;
    csrfToken?: string;
    expiresAt?: number;
    error?: string;
    lockedUntil?: number;
    requiresSetup?: boolean;
    isRevoked?: boolean;
  } {
    const ipKey = clientIp || 'global';
    const now = Date.now();

    // 1. Check lockout
    const attempt = this.failedAttempts.get(ipKey);
    if (attempt && attempt.count >= this.maxFailedAttempts) {
      const remainingSec = Math.ceil((attempt.lastAttempt + this.lockoutDurationMs - now) / 1000);
      if (remainingSec > 0) {
        return {
          success: false,
          error: `Demasiados intentos fallidos. Bloqueado temporalmente por ${remainingSec} segundos.`,
          lockedUntil: attempt.lastAttempt + this.lockoutDurationMs,
        };
      } else {
        this.failedAttempts.delete(ipKey);
      }
    }

    const cleanKey = (key || '').trim();

    // 2. Reject revoked keys immediately
    if (REVOKED_ADMIN_KEYS.has(cleanKey)) {
      const current = this.failedAttempts.get(ipKey) || { count: 0, lastAttempt: now };
      current.count += 1;
      current.lastAttempt = now;
      this.failedAttempts.set(ipKey, current);
      return {
        success: false,
        isRevoked: true,
        error: 'Esta credencial ha sido revocada permanentemente por directiva de seguridad.',
      };
    }

    // 3. Check initialized
    if (!this.isInitialized()) {
      const fallbackKey = (config.security.adminApiKey || '').trim();
      if (!fallbackKey || REVOKED_ADMIN_KEYS.has(fallbackKey) || cleanKey !== fallbackKey) {
        const current = this.failedAttempts.get(ipKey) || { count: 0, lastAttempt: now };
        current.count += 1;
        current.lastAttempt = now;
        this.failedAttempts.set(ipKey, current);
        return {
          success: false,
          requiresSetup: true,
          error: 'El sistema requiere configuración inicial de clave administrativa.',
        };
      }
    }

    // 4. Verify password
    let valid = false;
    if (this.db?.hasAdminCredentials()) {
      const creds = this.db.getAdminCredentials()!;
      valid = this.verifyPassword(cleanKey, creds.passwordHash, creds.salt);
    } else {
      const expected = (config.security.adminApiKey || '').trim();
      if (expected && !REVOKED_ADMIN_KEYS.has(expected)) {
        const keyBuf = Buffer.from(cleanKey);
        const expBuf = Buffer.from(expected);
        valid = keyBuf.length === expBuf.length && crypto.timingSafeEqual(keyBuf, expBuf);
      }
    }

    if (!valid) {
      const current = this.failedAttempts.get(ipKey) || { count: 0, lastAttempt: now };
      current.count += 1;
      current.lastAttempt = now;
      this.failedAttempts.set(ipKey, current);
      return { success: false, error: 'Credencial administrativa incorrecta.' };
    }

    // 5. Success
    this.failedAttempts.delete(ipKey);
    return this.createSession(clientIp, userAgent);
  }

  private createSession(clientIp?: string, userAgent?: string) {
    const token = crypto.randomBytes(32).toString('hex');
    const csrfToken = crypto.randomBytes(32).toString('hex');
    const session: AdminSession = {
      token,
      csrfToken,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.sessionTtlMs,
      ipAddress: clientIp,
      userAgent,
    };
    this.activeSessions.set(token, session);
    this.db?.saveAdminSession(session);
    return {
      success: true,
      token,
      csrfToken,
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Extracts cookie from IncomingMessage headers.
   */
  public parseCookies(req: http.IncomingMessage): Record<string, string> {
    const list: Record<string, string> = {};
    const rc = req.headers.cookie;
    if (!rc) return list;

    rc.split(';').forEach((cookie) => {
      const parts = cookie.split('=');
      const name = parts.shift()?.trim();
      const value = parts.join('=').trim();
      if (name) list[name] = decodeURIComponent(value);
    });
    return list;
  }

  /**
   * Validates token string (legacy / test helper).
   */
  public validateTokenString(tokenOrHeader: string): { valid: boolean; reason?: string; session?: AdminSession } {
    const token = tokenOrHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return { valid: false, reason: 'Empty token' };
    }
    if (REVOKED_ADMIN_KEYS.has(token)) {
      return { valid: false, reason: 'Revoked administrative key' };
    }
    const envKey = (config.security.adminApiKey || '').trim();
    if (envKey && !REVOKED_ADMIN_KEYS.has(envKey)) {
      const tokenBuf = Buffer.from(token);
      const expBuf = Buffer.from(envKey);
      if (tokenBuf.length === expBuf.length && crypto.timingSafeEqual(tokenBuf, expBuf)) {
        return { valid: true };
      }
    }
    let session = this.activeSessions.get(token);
    if (!session && this.db) {
      session = this.db.getAdminSession(token) || undefined;
      if (session) {
        this.activeSessions.set(token, session);
      }
    }
    if (!session) {
      return { valid: false, reason: 'Session not found' };
    }
    if (Date.now() > session.expiresAt) {
      this.activeSessions.delete(token);
      this.db?.deleteAdminSession(token);
      return { valid: false, reason: 'Session expired' };
    }
    return { valid: true, session };
  }

  /**
   * Validates request authorization with session lookup and CSRF check.
   */
  public validateAuth(tokenOrHeader: string, clientIp?: string): boolean;
  public validateAuth(req: http.IncomingMessage): { valid: boolean; reason?: string; session?: AdminSession };
  public validateAuth(
    reqOrToken: http.IncomingMessage | string,
    clientIp?: string
  ): boolean | { valid: boolean; reason?: string; session?: AdminSession } {
    if (typeof reqOrToken === 'string') {
      return this.validateTokenString(reqOrToken).valid;
    }

    const req = reqOrToken;
    const cookies = this.parseCookies(req);
    const sessionCookie = cookies['nanolabs_admin_session'];
    const authHeader = req.headers['authorization'];
    const adminKeyHeader = (req.headers['x-admin-key'] as string) || '';

    let token: string | undefined;
    let isCookieAuth = false;

    if (sessionCookie) {
      token = sessionCookie.trim();
      isCookieAuth = true;
    } else if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (adminKeyHeader) {
      token = adminKeyHeader.trim();
    }

    if (!token) {
      return { valid: false, reason: 'No session token or authorization header found' };
    }

    // 1. Immediately reject any revoked key
    if (REVOKED_ADMIN_KEYS.has(token)) {
      return { valid: false, reason: 'Revoked administrative key' };
    }

    // 2. Allow valid non-revoked environment adminApiKey (for tests / server-to-server)
    const envKey = (config.security.adminApiKey || '').trim();
    if (envKey && !REVOKED_ADMIN_KEYS.has(envKey)) {
      const tokenBuf = Buffer.from(token);
      const expBuf = Buffer.from(envKey);
      if (tokenBuf.length === expBuf.length && crypto.timingSafeEqual(tokenBuf, expBuf)) {
        return { valid: true };
      }
    }

    // 3. Lookup session in memory or DB
    let session = this.activeSessions.get(token);
    if (!session && this.db) {
      session = this.db.getAdminSession(token) || undefined;
      if (session) {
        this.activeSessions.set(token, session);
      }
    }

    if (!session) {
      return { valid: false, reason: 'Session not found or terminated' };
    }

    if (Date.now() > session.expiresAt) {
      this.activeSessions.delete(token);
      this.db?.deleteAdminSession(token);
      return { valid: false, reason: 'Session expired' };
    }

    // 4. CSRF Check for mutation requests (POST, PUT, DELETE, PATCH) when authenticated via Cookie
    const method = (req.method || 'GET').toUpperCase();
    if (isCookieAuth && (method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH')) {
      const csrfHeader = ((req.headers['x-csrf-token'] as string) || '').trim();
      if (!csrfHeader || csrfHeader !== session.csrfToken) {
        return { valid: false, reason: 'CSRF token missing or mismatch' };
      }
    }

    return { valid: true, session };
  }

  /**
   * Terminates an active session from memory and database.
   */
  public logout(token?: string, req?: http.IncomingMessage): void {
    let targetToken = token;
    if (!targetToken && req) {
      const cookies = this.parseCookies(req);
      targetToken = cookies['nanolabs_admin_session'];
    }
    if (!targetToken) return;
    this.activeSessions.delete(targetToken);
    this.db?.deleteAdminSession(targetToken);
  }

  /**
   * Purges expired sessions.
   */
  public purgeExpiredSessions(): void {
    const now = Date.now();
    for (const [token, session] of this.activeSessions.entries()) {
      if (now > session.expiresAt) {
        this.activeSessions.delete(token);
      }
    }
    this.db?.deleteExpiredAdminSessions();
  }
}

export const authManager = new AuthManager();

import crypto from 'crypto';
import { config } from '../config/index.js';

export interface AdminSession {
  token: string;
  createdAt: number;
  expiresAt: number;
  ipAddress?: string;
}

export class AuthManager {
  private activeSessions: Map<string, AdminSession> = new Map();
  private failedAttempts: Map<string, { count: number; lastAttempt: number }> = new Map();
  private sessionTtlMs: number = 24 * 60 * 60 * 1000; // 24 hours
  private maxFailedAttempts: number = 5;
  private lockoutDurationMs: number = 15 * 60 * 1000; // 15 minutes lockout

  /**
   * Timing-safe verification of the admin key.
   */
  public verifyAdminKey(key?: string): boolean {
    if (!key) return false;
    const expected = config.security.adminApiKey || 'nanolabs_admin_sec_2026';
    const keyBuf = Buffer.from(key);
    const expectedBuf = Buffer.from(expected);
    if (keyBuf.length !== expectedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(keyBuf, expectedBuf);
  }

  /**
   * Attempts admin login with rate limiting. Returns session token on success.
   */
  public login(key: string, ipAddress?: string): { success: boolean; token?: string; expiresAt?: number; error?: string; lockedUntil?: number } {
    const ipKey = ipAddress || 'global';
    const now = Date.now();

    // Check lockout
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

    if (!this.verifyAdminKey(key)) {
      const current = this.failedAttempts.get(ipKey) || { count: 0, lastAttempt: now };
      current.count += 1;
      current.lastAttempt = now;
      this.failedAttempts.set(ipKey, current);
      return { success: false, error: 'Clave administrativa incorrecta.' };
    }

    // Success: clear failed attempts
    this.failedAttempts.delete(ipKey);

    const token = crypto.randomBytes(32).toString('hex');
    const session: AdminSession = {
      token,
      createdAt: now,
      expiresAt: now + this.sessionTtlMs,
      ipAddress,
    };
    this.activeSessions.set(token, session);

    return { success: true, token, expiresAt: session.expiresAt };
  }

  /**
   * Validates if a token or direct admin key is valid.
   */
  public validateAuth(authHeader?: string, ipAddress?: string): boolean {
    if (!authHeader) return false;

    // Check direct Bearer token or raw key
    let token = authHeader;
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    }

    // Direct key comparison
    if (this.verifyAdminKey(token)) {
      return true;
    }

    // Session token lookup
    const session = this.activeSessions.get(token);
    if (!session) return false;

    if (Date.now() > session.expiresAt) {
      this.activeSessions.delete(token);
      return false;
    }

    return true;
  }

  /**
   * Terminates an active session.
   */
  public logout(token?: string): void {
    if (!token) return;
    let cleanToken = token;
    if (token.startsWith('Bearer ')) {
      cleanToken = token.slice(7).trim();
    }
    this.activeSessions.delete(cleanToken);
  }

  /**
   * Cleans up expired sessions.
   */
  public purgeExpiredSessions(): void {
    const now = Date.now();
    for (const [token, session] of this.activeSessions.entries()) {
      if (now > session.expiresAt) {
        this.activeSessions.delete(token);
      }
    }
  }
}

export const authManager = new AuthManager();

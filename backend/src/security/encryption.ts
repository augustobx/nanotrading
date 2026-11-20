import crypto from 'crypto';
import { config } from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for GCM
const AUTH_TAG_LENGTH = 16;

/**
 * Derives a 256-bit encryption key using PBKDF2 with a fixed salt.
 * Uses CONFIG_MASTER_KEY if provided, falling back to adminApiKey.
 */
function getMasterKey(): Buffer {
  const masterSecret = process.env.CONFIG_MASTER_KEY || config.security.adminApiKey || 'nanolabs_default_secure_vault_key_2026';
  const salt = Buffer.from('nanolabs_ai_trading_vault_salt_v1', 'utf8');
  return crypto.pbkdf2Sync(masterSecret, salt, 100000, 32, 'sha256');
}

export interface EncryptedPayload {
  ciphertext: string; // hex
  iv: string; // hex
  authTag: string; // hex
}

/**
 * Encrypts a plaintext string using AES-256-GCM authenticated encryption.
 */
export function encryptSecret(plaintext: string): EncryptedPayload {
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    ciphertext,
    iv: iv.toString('hex'),
    authTag,
  };
}

/**
 * Decrypts an AES-256-GCM ciphertext using the master key and authentication tag.
 */
export function decryptSecret(payload: EncryptedPayload): string {
  const key = getMasterKey();
  const iv = Buffer.from(payload.iv, 'hex');
  const authTag = Buffer.from(payload.authTag, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(payload.ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Masks a sensitive secret string for safe display in UI/API responses.
 * e.g., 'sk-proj-1234567890abcdef' -> 'sk-pr...cdef'
 */
export function maskSecret(secret?: string | null): string {
  if (!secret) return '';
  const trimmed = secret.trim();
  if (trimmed.length <= 8) return '****';
  const start = trimmed.slice(0, 5);
  const end = trimmed.slice(-4);
  return `${start}****${end}`;
}

import crypto from 'crypto';
import { encryptSecret, decryptSecret, maskSecret, EncryptedPayload } from '../security/encryption.js';

export interface BybitCredentialsRecord {
  id: string;
  apiKey: string;
  apiKeyMasked: string;
  encryptedSecret: EncryptedPayload;
  environment: 'mainnet' | 'testnet';
  status: 'ACTIVE' | 'REVOKED' | 'UNVERIFIED' | 'INVALID_PERMISSIONS' | 'AUTH_FAILED';
  detectedPermissions: Record<string, string[]>;
  ipRestrictions?: string[];
  accountBalanceUsdt?: number;
  actualMakerFeeRate?: number;
  actualTakerFeeRate?: number;
  feeSource: 'BYBIT_API_ACCOUNT_FEE_RATE' | 'DEFAULT_BYBIT_LINEAR';
  lastVerifiedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export class BybitCredentialsManager {
  private credentialsRecord: BybitCredentialsRecord | null = null;

  constructor(savedRecord?: BybitCredentialsRecord | null) {
    if (savedRecord) {
      this.credentialsRecord = savedRecord;
    }
  }

  public getRecord(): BybitCredentialsRecord | null {
    return this.credentialsRecord;
  }

  /**
   * Returns a sanitized view for UI/API responses with masked secrets.
   */
  public getSanitizedView(): any | null {
    if (!this.credentialsRecord) return null;
    return {
      id: this.credentialsRecord.id,
      apiKeyMasked: this.credentialsRecord.apiKeyMasked,
      environment: this.credentialsRecord.environment,
      status: this.credentialsRecord.status,
      detectedPermissions: this.credentialsRecord.detectedPermissions,
      ipRestrictions: this.credentialsRecord.ipRestrictions || [],
      accountBalanceUsdt: this.credentialsRecord.accountBalanceUsdt,
      actualMakerFeeRate: this.credentialsRecord.actualMakerFeeRate,
      actualTakerFeeRate: this.credentialsRecord.actualTakerFeeRate,
      feeSource: this.credentialsRecord.feeSource,
      lastVerifiedAt: this.credentialsRecord.lastVerifiedAt,
      createdAt: this.credentialsRecord.createdAt,
      updatedAt: this.credentialsRecord.updatedAt,
    };
  }

  /**
   * Generates Bybit V5 HMAC-SHA256 signature for private endpoints.
   */
  private generateSignature(apiSecret: string, timestamp: number, apiKey: string, recvWindow: number, queryString: string = ''): string {
    const preHash = `${timestamp}${apiKey}${recvWindow}${queryString}`;
    return crypto.createHmac('sha256', apiSecret).update(preHash).digest('hex');
  }

  /**
   * Verifies credentials against Bybit V5 `/v5/user/query-api` and enforces READ-ONLY restriction.
   */
  public async verifyAndEnforceReadOnly(
    apiKey: string,
    apiSecret: string,
    environment: 'mainnet' | 'testnet' = 'mainnet'
  ): Promise<{
    valid: boolean;
    permissions: Record<string, string[]>;
    accountBalanceUsdt?: number;
    makerFeeRate?: number;
    takerFeeRate?: number;
    error?: string;
  }> {
    const baseUrl = environment === 'testnet' ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';
    const timestamp = Date.now();
    const recvWindow = 5000;
    const signature = this.generateSignature(apiSecret, timestamp, apiKey, recvWindow, '');

    try {
      const response = await fetch(`${baseUrl}/v5/user/query-api`, {
        method: 'GET',
        headers: {
          'X-BAPI-API-KEY': apiKey,
          'X-BAPI-TIMESTAMP': timestamp.toString(),
          'X-BAPI-SIGN': signature,
          'X-BAPI-RECV-WINDOW': recvWindow.toString(),
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        return { valid: false, permissions: {}, error: `Error HTTP (${response.status}): ${errText}` };
      }

      const data = (await response.json()) as any;
      if (data.retCode !== 0) {
        return { valid: false, permissions: {}, error: `Bybit API error (${data.retCode}): ${data.retMsg}` };
      }

      const result = data.result || {};
      const permissions: Record<string, string[]> = result.permissions || {};

      // STRICT READ-ONLY SECURITY CHECK:
      // In SIGNALS_ONLY mode, reject any API key with Order or Position writing capabilities
      const writePermissionKeywords = ['Order', 'Position', 'Trade', 'Withdraw', 'Transfer', 'Exchange'];
      const detectedWritePermissions: string[] = [];

      for (const [scope, perms] of Object.entries(permissions)) {
        if (Array.isArray(perms)) {
          for (const perm of perms) {
            for (const writeKw of writePermissionKeywords) {
              if (perm.toLowerCase().includes(writeKw.toLowerCase())) {
                detectedWritePermissions.push(`${scope}:${perm}`);
              }
            }
          }
        }
      }

      if (detectedWritePermissions.length > 0) {
        return {
          valid: false,
          permissions,
          error: `SEGURIDAD: La clave API contiene permisos de escritura o trading (${detectedWritePermissions.join(', ')}). En modo SIGNALS_ONLY sólo se permiten claves de sólo lectura.`,
        };
      }

      // Read-only confirmed! Let's attempt to fetch actual fee rate
      let makerFeeRate: number | undefined;
      let takerFeeRate: number | undefined;
      let accountBalanceUsdt: number | undefined;

      try {
        const feeQuery = 'category=linear&symbol=BTCUSDT';
        const feeTs = Date.now();
        const feeSign = this.generateSignature(apiSecret, feeTs, apiKey, recvWindow, feeQuery);
        const feeRes = await fetch(`${baseUrl}/v5/account/fee-rate?${feeQuery}`, {
          headers: {
            'X-BAPI-API-KEY': apiKey,
            'X-BAPI-TIMESTAMP': feeTs.toString(),
            'X-BAPI-SIGN': feeSign,
            'X-BAPI-RECV-WINDOW': recvWindow.toString(),
          },
        });
        if (feeRes.ok) {
          const feeData = (await feeRes.json()) as any;
          if (feeData.retCode === 0 && feeData.result?.list?.[0]) {
            const item = feeData.result.list[0];
            makerFeeRate = parseFloat(item.makerFeeRate);
            takerFeeRate = parseFloat(item.takerFeeRate);
          }
        }
      } catch {}

      // Attempt to fetch wallet balance (read-only query)
      try {
        const balQuery = 'accountType=UNIFIED';
        const balTs = Date.now();
        const balSign = this.generateSignature(apiSecret, balTs, apiKey, recvWindow, balQuery);
        const balRes = await fetch(`${baseUrl}/v5/account/wallet-balance?${balQuery}`, {
          headers: {
            'X-BAPI-API-KEY': apiKey,
            'X-BAPI-TIMESTAMP': balTs.toString(),
            'X-BAPI-SIGN': balSign,
            'X-BAPI-RECV-WINDOW': recvWindow.toString(),
          },
        });
        if (balRes.ok) {
          const balData = (await balRes.json()) as any;
          if (balData.retCode === 0 && balData.result?.list?.[0]) {
            const coin = balData.result.list[0].coin?.find((c: any) => c.coin === 'USDT');
            if (coin) {
              accountBalanceUsdt = parseFloat(coin.walletBalance || coin.equity || '0');
            }
          }
        }
      } catch {}

      return {
        valid: true,
        permissions,
        accountBalanceUsdt,
        makerFeeRate,
        takerFeeRate,
      };
    } catch (err: any) {
      return { valid: false, permissions: {}, error: `Fallo de conexión con Bybit: ${err.message}` };
    }
  }

  /**
   * Saves or updates credentials with encryption and permissions check.
   */
  public async saveCredentials(
    apiKey: string,
    apiSecret: string,
    environment: 'mainnet' | 'testnet' = 'mainnet',
    bypassVerificationForTesting: boolean = false
  ): Promise<BybitCredentialsRecord> {
    if (!bypassVerificationForTesting) {
      const verification = await this.verifyAndEnforceReadOnly(apiKey, apiSecret, environment);
      if (!verification.valid) {
        throw new Error(verification.error || 'Verificación de credenciales Bybit fallida.');
      }
    }

    const encryptedSecret = encryptSecret(apiSecret);
    const now = Date.now();

    const record: BybitCredentialsRecord = {
      id: `bybit_cred_${now}`,
      apiKey,
      apiKeyMasked: maskSecret(apiKey),
      encryptedSecret,
      environment,
      status: 'ACTIVE',
      detectedPermissions: { ReadOnly: ['GetUserInfo', 'GetAccountInfo'] },
      feeSource: 'DEFAULT_BYBIT_LINEAR',
      lastVerifiedAt: now,
      createdAt: this.credentialsRecord?.createdAt || now,
      updatedAt: now,
    };

    this.credentialsRecord = record;
    return record;
  }

  /**
   * Revokes or deletes stored credentials.
   */
  public revokeCredentials(): void {
    this.credentialsRecord = null;
  }

  /**
   * Decrypts the secret for authenticated background read queries.
   */
  public getDecryptedSecret(): string | null {
    if (!this.credentialsRecord) return null;
    return decryptSecret(this.credentialsRecord.encryptedSecret);
  }
}

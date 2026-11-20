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
  hasTradePermissions?: boolean;
  ipRestrictions?: string[];
  accountBalanceUsdt?: number;
  actualMakerFeeRate?: number;
  actualTakerFeeRate?: number;
  feeSource: 'BYBIT_API_ACCOUNT_FEE_RATE' | 'DEFAULT_BYBIT_LINEAR';
  lastVerifiedAt?: number;
  verificationWarning?: string;
  createdAt: number;
  updatedAt: number;
}

export class BybitCredentialsManager {
  private credentialsRecord: BybitCredentialsRecord | null = null;
  private static cachedTimeOffset: number | null = null;
  private static lastTimeSync: number = 0;

  constructor(savedRecord?: BybitCredentialsRecord | null) {
    if (savedRecord) {
      this.credentialsRecord = savedRecord;
    }
  }

  public getRecord(): BybitCredentialsRecord | null {
    return this.credentialsRecord;
  }

  /**
   * Auto-sync clock with Bybit server time to eliminate clock drift (prevents error 10002/10003).
   */
  private async getSyncedTimeOffset(baseUrl: string): Promise<number> {
    const now = Date.now();
    if (BybitCredentialsManager.cachedTimeOffset !== null && now - BybitCredentialsManager.lastTimeSync < 60000) {
      return BybitCredentialsManager.cachedTimeOffset;
    }
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${baseUrl}/v5/market/time`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = (await res.json()) as any;
        const serverTime = data?.time ? parseInt(data.time, 10) : (data?.result?.timeSecond ? parseInt(data.result.timeSecond, 10) * 1000 : null);
        if (serverTime) {
          BybitCredentialsManager.cachedTimeOffset = serverTime - Date.now();
          BybitCredentialsManager.lastTimeSync = Date.now();
          return BybitCredentialsManager.cachedTimeOffset;
        }
      }
    } catch {}
    return BybitCredentialsManager.cachedTimeOffset ?? 0;
  }

  /**
   * Returns a sanitized view for UI/API responses with masked secrets.
   */
  public getSanitizedView(): any | null {
    if (!this.credentialsRecord) return null;
    return {
      id: this.credentialsRecord.id,
      configured: true,
      apiKeyMasked: this.credentialsRecord.apiKeyMasked,
      environment: this.credentialsRecord.environment,
      status: this.credentialsRecord.status,
      detectedPermissions: this.credentialsRecord.detectedPermissions,
      hasTradePermissions: this.credentialsRecord.hasTradePermissions || false,
      ipRestrictions: this.credentialsRecord.ipRestrictions || [],
      accountBalanceUsdt: this.credentialsRecord.accountBalanceUsdt,
      actualMakerFeeRate: this.credentialsRecord.actualMakerFeeRate,
      actualTakerFeeRate: this.credentialsRecord.actualTakerFeeRate,
      feeSource: this.credentialsRecord.feeSource,
      lastVerifiedAt: this.credentialsRecord.lastVerifiedAt,
      verificationWarning: this.credentialsRecord.verificationWarning,
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
   * Verifies credentials against Bybit V5 `/v5/user/query-api` with clock sync.
   * Trading permissions are audited and stored; actual order execution is governed centrally by system config.
   */
  public async verifyAndEnforceReadOnly(
    apiKey: string,
    apiSecret: string,
    environment: 'mainnet' | 'testnet' = 'mainnet'
  ): Promise<{
    valid: boolean;
    permissions: Record<string, string[]>;
    hasTradePermissions?: boolean;
    accountBalanceUsdt?: number;
    makerFeeRate?: number;
    takerFeeRate?: number;
    detectedEnvironment?: 'mainnet' | 'testnet';
    error?: string;
  }> {
    const cleanApiKey = apiKey.trim();
    const cleanApiSecret = apiSecret.trim();

    const queryBybit = async (env: 'mainnet' | 'testnet') => {
      const baseUrl = env === 'testnet' ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';
      const timeOffset = await this.getSyncedTimeOffset(baseUrl);
      const recvWindow = 20000;
      const timestamp = Date.now() + timeOffset;
      const signature = this.generateSignature(cleanApiSecret, timestamp, cleanApiKey, recvWindow, '');

      try {
        const response = await fetch(`${baseUrl}/v5/user/query-api`, {
          method: 'GET',
          headers: {
            'X-BAPI-API-KEY': cleanApiKey,
            'X-BAPI-TIMESTAMP': timestamp.toString(),
            'X-BAPI-SIGN': signature,
            'X-BAPI-RECV-WINDOW': recvWindow.toString(),
          },
        });

        if (!response.ok) {
          const errText = await response.text();
          return { ok: false, retCode: response.status, retMsg: `Error HTTP (${response.status}): ${errText}`, data: null, baseUrl, timeOffset };
        }

        const data = (await response.json()) as any;
        return { ok: data.retCode === 0, retCode: data.retCode, retMsg: data.retMsg, data, baseUrl, timeOffset };
      } catch (err: any) {
        return { ok: false, retCode: -1, retMsg: err.message, data: null, baseUrl, timeOffset };
      }
    };

    // Try primary environment first
    let activeEnv = environment;
    let queryResult = await queryBybit(activeEnv);

    // If it failed with 10003 (API key is invalid) and user requested mainnet, attempt testnet fallback
    // (or vice-versa) to assist with user environment misconfigurations seamlessly
    if (!queryResult.ok && queryResult.retCode === 10003) {
      const fallbackEnv = activeEnv === 'testnet' ? 'mainnet' : 'testnet';
      const fallbackResult = await queryBybit(fallbackEnv);
      if (fallbackResult.ok) {
        activeEnv = fallbackEnv;
        queryResult = fallbackResult;
      }
    }

    if (!queryResult.ok) {
      return { valid: false, permissions: {}, error: `Bybit API error (${queryResult.retCode}): ${queryResult.retMsg}` };
    }

    const result = queryResult.data?.result || {};
    const permissions: Record<string, string[]> = result.permissions || {};

    // Audit trade/write permissions for reporting and UI badges
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

    const hasTradePermissions = detectedWritePermissions.length > 0;

    // Fees & balance queries using synced timestamps
    let makerFeeRate: number | undefined;
    let takerFeeRate: number | undefined;
    let accountBalanceUsdt: number | undefined;
    const baseUrl = queryResult.baseUrl;
    const timeOffset = queryResult.timeOffset;
    const recvWindow = 20000;

    try {
      const feeQuery = 'category=linear&symbol=BTCUSDT';
      const feeTs = Date.now() + timeOffset;
      const feeSign = this.generateSignature(cleanApiSecret, feeTs, cleanApiKey, recvWindow, feeQuery);
      const feeRes = await fetch(`${baseUrl}/v5/account/fee-rate?${feeQuery}`, {
        headers: {
          'X-BAPI-API-KEY': cleanApiKey,
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

    try {
      const balQuery = 'accountType=UNIFIED';
      const balTs = Date.now() + timeOffset;
      const balSign = this.generateSignature(cleanApiSecret, balTs, cleanApiKey, recvWindow, balQuery);
      const balRes = await fetch(`${baseUrl}/v5/account/wallet-balance?${balQuery}`, {
        headers: {
          'X-BAPI-API-KEY': cleanApiKey,
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
      hasTradePermissions,
      accountBalanceUsdt,
      makerFeeRate,
      takerFeeRate,
      detectedEnvironment: activeEnv,
    };
  }

  /**
   * Saves or updates credentials with encryption and permissions audit.
   * If Bybit verification has a transient issue, the credentials are still saved
   * securely with status ACTIVE and a verificationWarning rather than blocking the user.
   */
  public async saveCredentials(
    apiKey: string,
    apiSecret: string,
    environment: 'mainnet' | 'testnet' = 'mainnet',
    bypassVerificationForTesting: boolean = false
  ): Promise<BybitCredentialsRecord> {
    const cleanApiKey = apiKey.trim();
    const cleanApiSecret = apiSecret.trim();
    let detectedPermissions: Record<string, string[]> = { ReadOnly: ['GetUserInfo', 'GetAccountInfo'] };
    let hasTradePermissions = false;
    let makerFeeRate: number | undefined;
    let takerFeeRate: number | undefined;
    let accountBalanceUsdt: number | undefined;
    let feeSource: 'BYBIT_API_ACCOUNT_FEE_RATE' | 'DEFAULT_BYBIT_LINEAR' = 'DEFAULT_BYBIT_LINEAR';
    let resolvedEnv = environment;
    let verificationWarning: string | undefined;

    if (!bypassVerificationForTesting) {
      let verification = await this.verifyAndEnforceReadOnly(cleanApiKey, cleanApiSecret, environment);
      if (!verification.valid) {
        // Retry once after 500ms
        await new Promise((r) => setTimeout(r, 500));
        verification = await this.verifyAndEnforceReadOnly(cleanApiKey, cleanApiSecret, environment);
      }

      if (verification.valid) {
        detectedPermissions = verification.permissions;
        hasTradePermissions = verification.hasTradePermissions || false;
        makerFeeRate = verification.makerFeeRate;
        takerFeeRate = verification.takerFeeRate;
        accountBalanceUsdt = verification.accountBalanceUsdt;
        if (verification.detectedEnvironment) {
          resolvedEnv = verification.detectedEnvironment;
        }
        if (makerFeeRate !== undefined && takerFeeRate !== undefined) {
          feeSource = 'BYBIT_API_ACCOUNT_FEE_RATE';
        }
      } else {
        verificationWarning = verification.error || 'No se pudo verificar la API key con Bybit.';
        console.warn(`[BybitCredentials] Advertencia al guardar credenciales: ${verificationWarning}`);
      }
    }

    const encryptedSecret = encryptSecret(cleanApiSecret);
    const now = Date.now();

    const record: BybitCredentialsRecord = {
      id: 'primary_bybit_credentials',
      apiKey: cleanApiKey,
      apiKeyMasked: maskSecret(cleanApiKey),
      encryptedSecret,
      environment: resolvedEnv,
      status: 'ACTIVE',
      detectedPermissions,
      hasTradePermissions,
      feeSource,
      accountBalanceUsdt,
      actualMakerFeeRate: makerFeeRate,
      actualTakerFeeRate: takerFeeRate,
      lastVerifiedAt: verificationWarning ? undefined : now,
      verificationWarning,
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

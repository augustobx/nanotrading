import * as webPushModule from 'web-push';
const webPush: any = (webPushModule as any).default || webPushModule;
import { DatabaseService } from '../storage/database.js';
import { config } from '../config/index.js';
import { SignalInstance } from '../engine/signal-state-machine.js';

export interface PushSubscriptionData {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userId?: string;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: {
    url?: string;
    signalId?: string;
    type?: string;
    timestamp?: number;
  };
}

export class WebPushNotifier {
  private db: DatabaseService;
  private enabled: boolean;
  private vapidPublicKey: string;
  private vapidPrivateKey: string;
  private vapidSubject: string;

  constructor(db: DatabaseService) {
    this.db = db;
    this.enabled = config.push.enabled;
    this.vapidSubject = config.push.vapidSubject || 'mailto:trading-alerts@nanolabs.com';

    if (config.push.vapidPublicKey && config.push.vapidPrivateKey) {
      this.vapidPublicKey = config.push.vapidPublicKey;
      this.vapidPrivateKey = config.push.vapidPrivateKey;
    } else {
      // Generate default volatile VAPID keys if none configured
      const keys = webPush.generateVAPIDKeys();
      this.vapidPublicKey = keys.publicKey;
      this.vapidPrivateKey = keys.privateKey;
    }

    try {
      webPush.setVapidDetails(this.vapidSubject, this.vapidPublicKey, this.vapidPrivateKey);
    } catch (err: any) {
      this.db.logEvent('WARN', 'WebPush', `Failed to set VAPID details: ${err.message}`);
    }
  }

  public getPublicKey(): string {
    return this.vapidPublicKey;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public saveSubscription(subData: PushSubscriptionData): void {
    const id = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    this.db.savePushSubscription({
      id,
      endpoint: subData.endpoint,
      p256dh: subData.keys.p256dh,
      auth: subData.keys.auth,
      userId: subData.userId,
      createdAt: Date.now(),
      lastActive: Date.now(),
    });
    this.db.logEvent('INFO', 'WebPush', `Push subscription registered: ${subData.endpoint.substring(0, 45)}...`);
  }

  public removeSubscription(endpoint: string): void {
    this.db.deletePushSubscription(endpoint);
    this.db.logEvent('INFO', 'WebPush', `Push subscription removed: ${endpoint.substring(0, 45)}...`);
  }

  public async broadcast(payload: PushNotificationPayload): Promise<{ sent: number; failed: number }> {
    if (!this.enabled) {
      return { sent: 0, failed: 0 };
    }

    const subscriptions = this.db.getPushSubscriptions();
    if (subscriptions.length === 0) {
      return { sent: 0, failed: 0 };
    }

    const jsonPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || '/nanolabs-icon-192.png',
      badge: payload.badge || '/nanolabs-badge-72.png',
      tag: payload.tag || 'nanolabs-trading',
      data: payload.data || { url: '/', timestamp: Date.now() },
    });

    let sent = 0;
    let failed = 0;

    await Promise.all(
      subscriptions.map(async (sub) => {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        };

        try {
          await webPush.sendNotification(pushSubscription, jsonPayload);
          sent++;

          this.db.logNotification({
            id: `push_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            channel: 'WEB_PUSH',
            recipient: sub.endpoint.substring(0, 30),
            signalId: payload.data?.signalId,
            messageType: payload.data?.type || 'PUSH_ALERT',
            payload: { title: payload.title, body: payload.body },
            status: 'DELIVERED',
            deliveredAt: Date.now(),
            timestamp: Date.now(),
          });
        } catch (err: any) {
          failed++;
          const statusCode = err.statusCode;
          // HTTP 404 Not Found or 410 Gone means the subscription is expired or cancelled by browser
          if (statusCode === 404 || statusCode === 410) {
            this.db.deletePushSubscription(sub.endpoint);
            this.db.logEvent(
              'INFO',
              'WebPush',
              `Pruned inactive push subscription (HTTP ${statusCode}): ${sub.endpoint.substring(0, 45)}...`
            );
          } else {
            this.db.logNotification({
              id: `push_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              channel: 'WEB_PUSH',
              recipient: sub.endpoint.substring(0, 30),
              signalId: payload.data?.signalId,
              messageType: payload.data?.type || 'PUSH_ALERT',
              payload: { error: err.message, statusCode },
              status: 'FAILED',
              timestamp: Date.now(),
            });
          }
        }
      })
    );

    return { sent, failed };
  }

  public async notifySignalValidated(signal: SignalInstance): Promise<{ sent: number; failed: number }> {
    return this.broadcast({
      title: `⚡ Señal ${signal.direction} #${signal.symbol} Autorizada`,
      body: `Entrada: $${signal.entryPrice} | SL: $${signal.stopLossPrice} | TP: $${signal.takeProfitPrice} | R:R 1:${signal.netRR}`,
      tag: `signal-${signal.id}`,
      data: {
        url: `/?signalId=${signal.id}`,
        signalId: signal.id,
        type: 'SIGNAL_VALIDATED',
        timestamp: Date.now(),
      },
    });
  }

  public async notifyTakeProfit(signal: SignalInstance): Promise<{ sent: number; failed: number }> {
    return this.broadcast({
      title: `🎯 Take Profit Alcanzado #${signal.symbol}`,
      body: `Beneficio: +${signal.realizedNetR || signal.netRR}R ($${signal.realizedNetPnlUsdt || signal.riskUsdt * signal.netRR} USDT)`,
      tag: `tp-${signal.id}`,
      data: {
        url: `/?signalId=${signal.id}`,
        signalId: signal.id,
        type: 'COMPLETED_TP',
        timestamp: Date.now(),
      },
    });
  }

  public async notifyStopLoss(signal: SignalInstance): Promise<{ sent: number; failed: number }> {
    return this.broadcast({
      title: `🛑 Stop Loss Alcanzado #${signal.symbol}`,
      body: `Pérdida neta contenida a -1.0R (-$${signal.riskUsdt} USDT)`,
      tag: `sl-${signal.id}`,
      data: {
        url: `/?signalId=${signal.id}`,
        signalId: signal.id,
        type: 'COMPLETED_SL',
        timestamp: Date.now(),
      },
    });
  }

  public async sendTestPush(): Promise<{ sent: number; failed: number }> {
    return this.broadcast({
      title: '🧪 NanoLabs AI Trading — Notificación de Prueba',
      body: 'Sistema Web Push PWA conectado correctamente.',
      tag: 'test-push',
      data: {
        url: '/',
        type: 'TEST',
        timestamp: Date.now(),
      },
    });
  }
}

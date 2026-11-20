import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseService } from '../../src/storage/database.js';
import { TelegramNotifier } from '../../src/notifications/telegram-notifier.js';
import { WebPushNotifier } from '../../src/notifications/web-push-notifier.js';

test('TelegramNotifier - Unconfigured instance skips gracefully and audits', async () => {
  const db = new DatabaseService(':memory:');
  const tg = new TelegramNotifier(db, undefined, undefined, false);

  assert.equal(tg.isConfigured(), false);

  const res = await tg.sendMessage('Mensaje de prueba', 'TEST_ALERT', 'sig_123');
  assert.equal(res.success, false);
  assert.match(res.error || '', /no configurado/i);

  const history = db.getNotificationHistory(10);
  assert.equal(history.length, 1);
  assert.equal(history[0].channel, 'TELEGRAM');
  assert.equal(history[0].status, 'SKIPPED_NOT_CONFIGURED');

  db.close();
});

test('TelegramNotifier - Deduplication prevents repeated alerts within window', async () => {
  const db = new DatabaseService(':memory:');
  const tg = new TelegramNotifier(db, 'dummy_token', 'dummy_chat', true);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    ({
      json: async () => ({ ok: true, result: { message_id: 999 } }),
    } as any);

  try {
    // First call: actually delivers
    const res1 = await tg.sendMessage('Mensaje repetido', 'TEST_ALERT', 'sig_dup_1');
    assert.equal(res1.success, true);

    // Second call with same messageType and signalId within window
    const res2 = await tg.sendMessage('Mensaje repetido', 'TEST_ALERT', 'sig_dup_1');
    assert.equal(res2.success, true); // Deduplicated treated as successfully handled

    const history = db.getNotificationHistory(10);
    assert.equal(history.length, 2);
    const statuses = history.map((h) => h.status);
    assert.ok(statuses.includes('DEDUPLICATED'));
    assert.ok(statuses.includes('DELIVERED'));
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});

test('WebPushNotifier - Subscription registration, key generation and pruning', () => {
  const db = new DatabaseService(':memory:');
  const push = new WebPushNotifier(db);

  // VAPID public key must be valid base64url string
  const pubKey = push.getPublicKey();
  assert.ok(pubKey && pubKey.length > 30);

  // Register subscription
  push.saveSubscription({
    endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/gAAAAAB',
    keys: {
      p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9t0A3CjcWZQu06W9',
      auth: 'tBHItJI5svbpez7KI4CCXg',
    },
    userId: 'admin_1',
  });

  const subs = db.getPushSubscriptions();
  assert.equal(subs.length, 1);
  assert.equal(subs[0].userId, 'admin_1');

  // Pruning / unsubscribe
  push.removeSubscription('https://updates.push.services.mozilla.com/wpush/v2/gAAAAAB');
  const remaining = db.getPushSubscriptions();
  assert.equal(remaining.length, 0);

  db.close();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { GeminiAdapter } from '../../src/ai/gemini-adapter.js';

test('Gemini separates HTTP failures, pauses discovery and recovers with one request per reservation', async () => {
  const fetchBefore = globalThis.fetch, nowBefore = Date.now;
  let now = Date.now(), calls = 0, status = 429;
  Date.now = () => now;
  globalThis.fetch = async () => { calls++; return status === 200
    ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"bias":"NEUTRAL","scenarios":[]}' }] } }] }), { status: 200 })
    : new Response('', { status }); };
  const adapter = new GeminiAdapter({ apiKey: 'fixture-only', model: 'gemini-2.5-flash' });
  try {
    assert.equal(await adapter.evaluateWithCustomPrompt('fixture', 'gemini-2.5-flash', { discovery: true }), null);
    assert.equal(adapter.getDiscoveryHealth().failureCode, 'HTTP_429');
    assert.equal(calls, 1);
    await adapter.evaluateWithCustomPrompt('fixture', 'gemini-2.5-flash', { discovery: true });
    assert.equal(calls, 1);
    now = adapter.getDiscoveryHealth().retryNotBefore; status = 503;
    await adapter.evaluateWithCustomPrompt('fixture', 'gemini-2.5-flash', { discovery: true });
    assert.equal(adapter.getDiscoveryHealth().failureCode, 'HTTP_503');
    assert.equal(calls, 2);
    const secondPause = adapter.getDiscoveryHealth().retryNotBefore - now;
    assert.equal(secondPause, 10 * 60000);
    now = adapter.getDiscoveryHealth().retryNotBefore; status = 200;
    assert.ok(await adapter.evaluateWithCustomPrompt('fixture', 'gemini-2.5-flash', { discovery: true }));
    assert.equal(adapter.getDiscoveryHealth().consecutiveFailures, 0);
    assert.equal(calls, 3);
  } finally { globalThis.fetch = fetchBefore; Date.now = nowBefore; }
});

test('Gemini identifies timeout and invalid responses; discovery pause does not skip revalidation', async () => {
  const fetchBefore = globalThis.fetch;
  const adapter = new GeminiAdapter({ apiKey: 'fixture-only', timeoutMs: 5 });
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })));
  });
  try {
    assert.equal(await adapter.evaluateWithCustomPrompt('fixture', undefined, { discovery: true }), null);
    assert.equal(adapter.getDiscoveryHealth().failureCode, 'TIMEOUT');
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"verdict":"WAIT"}' }] } }] })); };
    assert.ok(await adapter.evaluateWithCustomPrompt('revalidation'));
    assert.equal(calls, 1);
    adapter.updateCredentials('fixture-only');
    globalThis.fetch = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }));
    assert.equal(await adapter.evaluateWithCustomPrompt('fixture', undefined, { discovery: true }), null);
    assert.equal(adapter.getDiscoveryHealth().failureCode, 'INVALID_RESPONSE');
    for (const body of ['<html>upstream error</html>', 'null']) {
      adapter.updateCredentials('fixture-only');
      globalThis.fetch = async () => new Response(body, { status: 200 });
      assert.equal(await adapter.evaluateWithCustomPrompt('fixture', undefined, { discovery: true }), null);
      assert.equal(adapter.getDiscoveryHealth().failureCode, 'INVALID_RESPONSE');
      assert.equal(adapter.getStatus().availabilityStatus, 'INVALID_RESPONSE');
    }
  } finally { globalThis.fetch = fetchBefore; }
});

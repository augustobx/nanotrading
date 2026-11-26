import test from 'node:test';
import assert from 'node:assert/strict';
import { GeminiAdapter } from '../../src/ai/gemini-adapter.js';
import { AiModelRouter } from '../../src/ai/router/ai-router.js';
import { getModelMetadata } from '../../src/ai/models-catalog.js';

test('Automatic routing reserves the same Gemini model that executes and reports its discovery pause', async () => {
  const router = new AiModelRouter();
  const decision = router.routeModel('MARKET_DISCOVERY', 'GEMINI', 5);
  assert.equal(decision.selectedModel, 'gemini-2.5-flash');
  assert.equal(decision.estimatedCostPer1kTokensUsd,
    getModelMetadata(decision.selectedModel).estimatedInputCostPerMillion / 1000);
  const previousFetch = globalThis.fetch;
  const adapter = new GeminiAdapter({ apiKey: 'fixture-only' });
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    assert.match(String(url), new RegExp(`/models/${decision.selectedModel}:generateContent$`));
    return new Response('', { status: 503 });
  };
  try {
    await adapter.evaluateWithCustomPrompt('fixture', decision.selectedModel, { discovery: true });
    assert.equal(adapter.getDiscoveryHealth(decision.selectedModel).failureCode, 'HTTP_503');
    assert.ok(adapter.getDiscoveryHealth(decision.selectedModel).retryNotBefore > Date.now());
    await adapter.evaluateWithCustomPrompt('fixture', decision.selectedModel, { discovery: true });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = previousFetch; }
});

test('Retired Gemini aliases expose the actual model failure and cooldown', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 429 });
  const adapter = new GeminiAdapter({ apiKey: 'fixture-only' });
  try {
    await adapter.evaluateWithCustomPrompt('fixture', 'gemini-2.0-flash', { discovery: true });
    assert.equal(adapter.getDiscoveryHealth('gemini-2.0-flash').failureCode, 'HTTP_429');
    assert.deepEqual(adapter.getDiscoveryHealth('gemini-2.0-flash'),
      adapter.getDiscoveryHealth('gemini-2.5-flash'));
  } finally { globalThis.fetch = previousFetch; }
});

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

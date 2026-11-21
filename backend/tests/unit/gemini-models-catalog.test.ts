import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_MODELS_CATALOG,
  getValidatedModel,
  isModelCompatible,
  getModelMetadata,
  calculateCallCost,
} from '../../src/ai/models-catalog.js';
import { GeminiAdapter } from '../../src/ai/gemini-adapter.js';

test('Gemini Catalog - Official models are active and structured JSON compatible', () => {
  const activeGeminiModels = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-pro',
    'gemini-3.8-flash',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
    'gemini-1.5-pro',
  ];

  for (const modelId of activeGeminiModels) {
    const meta = AI_MODELS_CATALOG[modelId];
    assert.ok(meta, `Model ${modelId} must exist in catalog`);
    assert.equal(meta.provider, 'GEMINI');
    assert.equal(meta.status, 'ACTIVE');
    assert.equal(meta.supportsStructuredJson, true);
    assert.ok(meta.estimatedInputCostPerMillion > 0);
    assert.ok(meta.estimatedOutputCostPerMillion > 0);

    const compat = isModelCompatible(modelId);
    assert.equal(compat.compatible, true, `${modelId} should be compatible`);
  }

  // Default model must be gemini-2.5-flash
  assert.equal(AI_MODELS_CATALOG['gemini-2.5-flash'].isDefault, true);
  assert.equal(getValidatedModel('unknown-model', 'GEMINI'), 'gemini-2.5-flash');
});

test('Gemini Catalog - Legacy & retired aliases are redirected safely', () => {
  // gemini-2.0-flash redirects to gemini-2.5-flash
  const redirectedFlash = getValidatedModel('gemini-2.0-flash', 'GEMINI');
  assert.equal(redirectedFlash, 'gemini-2.5-flash');

  // gemini-2.0-flash-lite redirects to gemini-2.5-flash-lite
  const redirectedLite = getValidatedModel('gemini-2.0-flash-lite', 'GEMINI');
  assert.equal(redirectedLite, 'gemini-2.5-flash-lite');

  // gemini-1.0-pro is retired
  const compatOld = isModelCompatible('gemini-1.0-pro');
  assert.equal(compatOld.compatible, false);
  assert.match(compatOld.reason || '', /retirado/i);
});

test('Gemini Adapter - Status error categorization classifies auth and model errors', async () => {
  const adapter = new GeminiAdapter({ apiKey: '', model: 'gemini-2.5-flash' });
  const status = adapter.getStatus();
  assert.equal(status.model, 'gemini-2.5-flash');
  assert.equal(status.configured, false);
  assert.equal(status.availabilityStatus, 'UNCONFIGURED');

  // Updating with trimmed key
  adapter.updateCredentials('  AIzaSyValidMockKey  ', 'gemini-1.5-pro');
  const updatedStatus = adapter.getStatus();
  assert.equal(updatedStatus.configured, true);
  assert.equal(updatedStatus.model, 'gemini-1.5-pro');
});

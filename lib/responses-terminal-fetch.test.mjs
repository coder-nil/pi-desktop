import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
import { stream } from '../node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js';
const jiti = createJiti(import.meta.url);
const { responsesTerminalFetch } = await jiti.import('./responses-terminal-fetch.ts');
const model = { id: 'gpt-5.6-sol', api: 'openai-responses', provider: 'OpenAI', baseUrl: 'https://example.invalid', reasoning: true, input: ['text'], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };

for (const [type, status, expected] of [
  ['response.completed', 'completed', 'stop'],
  ['response.incomplete', 'incomplete', 'length'],
  ['response.failed', 'failed', 'error'],
]) {
  test(`settles ${type} without waiting for HTTP EOF`, { timeout: 2000 }, async () => {
    let cancelled = false;
    const encoder = new TextEncoder();
    const frame = `event: ${type}\r\ndata: ${JSON.stringify({ type, response: {
      id: 'resp_test', status, output: [], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
      ...(status === 'incomplete' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
      ...(status === 'failed' ? { error: { code: 'test_error', message: 'failed' } } : {}),
    } })}\r\n\r\n`;
    const signal = new AbortController().signal;
    const fetch = responsesTerminalFetch(async () => new Response(new ReadableStream({
      start(controller) {
        // Split even CRLF boundaries across network chunks; intentionally never close.
        for (const byte of encoder.encode(frame)) controller.enqueue(Uint8Array.of(byte));
      },
      cancel() { cancelled = true; },
    }), { headers: { 'content-type': 'text/event-stream' } }));
    const result = await stream(model, { messages: [{ role: 'user', content: 'test', timestamp: 1 }] }, { apiKey: 'test', fetch, signal }).result();
    assert.equal(result.stopReason, expected);
    assert.equal(cancelled, true);
    assert.equal(signal.aborted, false);
    if (status === 'completed') {
      assert.equal(result.rawStopReason, 'completed');
      assert.equal(result.usage.totalTokens, 12);
    }
  });
}

test('preserves text, nonterminal events and incomplete EOF for SDK validation', async () => {
  const content = 'data: {"type":"response.output_text.delta","delta":"中文 response.completed"}\n\n';
  const bytes = new TextEncoder().encode(content);
  const fetch = responsesTerminalFetch(async () => new Response(new ReadableStream({
    start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close(); },
  }), { headers: { 'content-type': 'text/event-stream' } }));
  assert.equal(await (await fetch('https://example.invalid')).text(), content);
});

test('does not wrap JSON or HTTP error responses', async () => {
  for (const response of [Response.json({ ok: true }), new Response('error', { status: 500 })]) {
    assert.equal(await responsesTerminalFetch(async () => response)('https://example.invalid'), response);
  }
});

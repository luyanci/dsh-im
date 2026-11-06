import test from 'node:test';
import assert from 'node:assert/strict';

import { downloadOneBotMedia } from '../../../src/channels/onebot/onebot-api.mjs';

function streamResponse(chunks, headers = {}) {
  let index = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: name => headers[name.toLowerCase()] ?? null },
    body: {
      getReader() {
        return {
          async read() {
            if (index >= chunks.length) return { done: true, value: undefined };
            return { done: false, value: chunks[index++] };
          },
          async cancel() {},
          releaseLock() {},
        };
      },
    },
  };
}

test('media is read under a running cap, not after buffering', async () => {
  // A response that lies about its length must still be cut off mid-stream.
  const response = streamResponse([new Uint8Array(8), new Uint8Array(8), new Uint8Array(8)]);
  await assert.rejects(
    () => downloadOneBotMedia('https://example.test/a.png', { maxBytes: 10, fetchImpl: async () => response }),
    /exceeds 10 bytes/,
  );
});

test('a declared length over the cap is refused before reading', async () => {
  let read = 0;
  const response = streamResponse([new Uint8Array(4)], { 'content-length': '999' });
  response.body.getReader = () => ({ async read() { read += 1; return { done: true }; } });
  await assert.rejects(
    () => downloadOneBotMedia('https://example.test/a.png', { maxBytes: 10, fetchImpl: async () => response }),
    /is 999 bytes/,
  );
  assert.equal(read, 0, 'the body was never read');
});

test('a small response keeps its bytes and media type', async () => {
  const response = streamResponse([new Uint8Array([1, 2, 3])], { 'content-type': 'image/png; charset=binary' });
  const media = await downloadOneBotMedia('https://example.test/a.png', {
    maxBytes: 10,
    fetchImpl: async () => response,
  });
  assert.deepEqual([...media.data], [1, 2, 3]);
  assert.equal(media.mediaType, 'image/png');
});

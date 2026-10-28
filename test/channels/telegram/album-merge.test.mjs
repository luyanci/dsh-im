import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeAlbumMessage } from '../../../src/channels/telegram/telegram-runtime.mjs';

const image = (name) => ({ name, mediaType: 'image/jpeg', size: 1, load: async () => ({}) });

test('album members fold into one message', () => {
  const base = { content: '这些字为什么凑一块就看不懂了', images: [image('a.jpg')], addressed: true };
  const extra = { content: '', images: [image('b.jpg')], addressed: false };
  const merged = mergeAlbumMessage(base, extra);
  assert.equal(merged.images.length, 2);
  assert.deepEqual(merged.images.map((item) => item.name), ['a.jpg', 'b.jpg']);
  assert.equal(merged.content, '这些字为什么凑一块就看不懂了');
  assert.equal(merged.addressed, true);
});

test('a caption-less first member still becomes addressed', () => {
  const base = { content: '', images: [image('a.jpg')], addressed: false };
  const extra = { content: '@bot 看这个', images: [image('b.jpg')], addressed: true };
  const merged = mergeAlbumMessage(base, extra);
  assert.equal(merged.content, '@bot 看这个');
  assert.equal(merged.addressed, true);
  assert.equal(merged.images.length, 2);
});

test('distinct captions are kept on separate lines', () => {
  const merged = mergeAlbumMessage(
    { content: '第一张', images: [image('a.jpg')], addressed: true },
    { content: '第二张', images: [image('b.jpg')], addressed: false },
  );
  assert.equal(merged.content, '第一张\n第二张');
});

test('non-string content is not concatenated', () => {
  const voice = { kind: 'voice', reason: 'no speech recognized' };
  const merged = mergeAlbumMessage(
    { content: voice, images: [], addressed: false },
    { content: '文字', images: [image('b.jpg')], addressed: false },
  );
  assert.equal(merged.content, '文字');
});

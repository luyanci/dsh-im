import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeTelegramUpdate } from '../../../src/channels/telegram/telegram-runtime.mjs';

const GROUP = -1002863898776;
const BOT_ID = 8685935858;

function normalize(message, loadFile = async () => ({ data: Buffer.alloc(0) })) {
  return normalizeTelegramUpdate({
    update_id: 9700,
    message: {
      message_id: 4500,
      date: 1,
      chat: { id: GROUP, type: 'supergroup', title: 'ycfed', is_forum: true },
      message_thread_id: 4184,
      from: { id: 6997371558, is_bot: false, first_name: 'YC' },
      ...message,
    },
  }, {
    botId: BOT_ID,
    username: 'yc_deepseek_bot',
    groupTriggers: { version: 1, defaults: { mode: 'mention', senders: [] }, groups: {} },
    loadFile,
  });
}

const staticSticker = {
  file_id: 'STATIC-FILE',
  file_unique_id: 'UNIQ-STATIC',
  file_size: 24000,
  emoji: '🌶',
  is_animated: false,
  is_video: false,
};

test('a static sticker becomes an image with a text placeholder', () => {
  const message = normalize({ sticker: staticSticker });
  assert.equal(message.content, '[贴纸 🌶]');
  assert.equal(message.images.length, 1);
  assert.equal(message.images[0].name, 'UNIQ-STATIC.webp');
  assert.equal(message.images[0].mediaType, 'image/webp');
});

test('a video sticker falls back to its thumbnail', async () => {
  const seen = [];
  const message = normalize({
    sticker: {
      file_id: 'VIDEO-FILE',
      file_unique_id: 'UNIQ-VIDEO',
      emoji: '❤️',
      is_animated: false,
      is_video: true,
      thumbnail: { file_id: 'THUMB-FILE', file_size: 17000, width: 320, height: 320 },
    },
  }, async (fileId) => {
    seen.push(fileId);
    return { data: Buffer.from('x') };
  });
  assert.equal(message.images.length, 1);
  await message.images[0].load({});
  assert.deepEqual(seen, ['THUMB-FILE']);
});

test('replying to the bot with a sticker is addressed and still carries the image', () => {
  const message = normalize({
    sticker: staticSticker,
    reply_to_message: { message_id: 9, from: { id: BOT_ID, is_bot: true } },
  });
  assert.equal(message.addressed, true);
  assert.equal(message.images.length, 1);
});

test('a sticker without an emoji still gets a placeholder', () => {
  const message = normalize({ sticker: { ...staticSticker, emoji: undefined } });
  assert.equal(message.content, '[贴纸]');
});

test('a text message is unaffected', () => {
  const message = normalize({ text: '普通消息' });
  assert.equal(message.content, '普通消息');
  assert.equal(message.images.length, 0);
});

test('a photo still wins over an absent sticker', () => {
  const message = normalize({ photo: [{ file_id: 'PHOTO-FILE', file_unique_id: 'U', width: 100, height: 100 }] });
  assert.equal(message.images.length, 1);
  assert.equal(message.content, '');
});

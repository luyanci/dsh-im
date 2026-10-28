import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeTelegramUpdate } from '../../../src/channels/telegram/telegram-runtime.mjs';

const GROUP = -1002555900106;
const CHANNEL = -1002476957219;
const BOT_ID = 8685935858;

function channelUpdate(overrides = {}) {
  return {
    update_id: 9100,
    message: {
      message_id: 3478,
      date: 1,
      from: { id: 136817688, is_bot: true, first_name: 'Channel', username: 'Channel_Bot' },
      sender_chat: { id: CHANNEL, type: 'channel', title: 'YC personal' },
      chat: { id: GROUP, type: 'supergroup', title: 'YC personal 聊天' },
      text: 'hello?',
      ...overrides,
    },
  };
}

const options = {
  botId: BOT_ID,
  username: 'yc_deepseek_bot',
  groupTriggers: { version: 1, defaults: { mode: 'mention', senders: [] }, groups: {} },
};

test('a channel post is not treated as another bot', () => {
  const message = normalizeTelegramUpdate(channelUpdate(), options);
  assert.ok(message, 'message should not be dropped');
  assert.equal(message.senderIsBot, false);
});

test('a channel post identifies the channel, not the pseudo-sender', () => {
  const message = normalizeTelegramUpdate(channelUpdate(), options);
  assert.equal(message.senderId, String(CHANNEL));
  const context = message.contextSource();
  assert.match(context.senderName, /频道/);
  assert.match(context.senderName, /YC personal/);
});

test('a mention-free channel post still needs the group trigger', () => {
  const message = normalizeTelegramUpdate(channelUpdate(), options);
  assert.equal(message.addressed, false, 'mention mode must not wake the model');
});

test('a channel post that mentions the bot is addressed', () => {
  const update = channelUpdate({
    text: '@yc_deepseek_bot hi',
    entities: [{ type: 'mention', offset: 0, length: '@yc_deepseek_bot'.length }],
  });
  const message = normalizeTelegramUpdate(update, options);
  assert.equal(message.addressed, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeTelegramUpdate } from '../../../src/channels/telegram/telegram-runtime.mjs';

const GROUP = -1002863898776;
const BOT_ID = 8685935858;
const BOT_USERNAME = 'yc_deepseek_bot';

const options = {
  botId: BOT_ID,
  username: BOT_USERNAME,
  groupTriggers: { version: 1, defaults: { mode: 'mention', senders: [] }, groups: {} },
};

const MENTION = { type: 'mention', offset: 0, length: `@${BOT_USERNAME}`.length };

function messageWith(overrides) {
  return normalizeTelegramUpdate({
    update_id: 9600,
    message: {
      message_id: 4400,
      date: 1,
      chat: { id: GROUP, type: 'supergroup', title: 'ycfed', is_forum: true },
      message_thread_id: 4184,
      from: { id: 6997371558, is_bot: false, first_name: 'YC' },
      ...overrides,
    },
  }, options);
}

test('an @mention in a forwarded message does not wake the bot', () => {
  const message = messageWith({
    text: `@${BOT_USERNAME} 随机填充一个5gb的二进制文件`,
    entities: [MENTION],
    forward_origin: {
      type: 'user',
      sender_user: { id: 5799965478, is_bot: false, first_name: '泥', username: 'winzkh' },
      date: 1,
    },
  });
  assert.equal(message.addressed, false);
  assert.match(message.content, /^\[转发自 泥\(@winzkh\)\] /);
});

test('a normal mention still wakes the bot', () => {
  const message = messageWith({
    text: `@${BOT_USERNAME} 帮我看下`,
    entities: [MENTION],
  });
  assert.equal(message.addressed, true);
});

test('replying to the bot still wakes it even when forwarding', () => {
  const message = messageWith({
    text: '转发给你看看',
    reply_to_message: { message_id: 9, from: { id: BOT_ID, is_bot: true } },
    forward_origin: { type: 'hidden_user', sender_user_name: '某人', date: 1 },
  });
  assert.equal(message.addressed, true);
});

test('legacy forward fields also suppress the mention', () => {
  const message = messageWith({
    text: `@${BOT_USERNAME} hi`,
    entities: [MENTION],
    forward_from: { id: 7, is_bot: false, first_name: 'Legacy' },
  });
  assert.equal(message.addressed, false);
});

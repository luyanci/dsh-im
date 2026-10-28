import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeTelegramUpdate } from '../../../src/channels/telegram/telegram-runtime.mjs';

const GROUP = -1002863898776;
const BOT_ID = 8685935858;

const options = {
  botId: BOT_ID,
  username: 'yc_deepseek_bot',
  groupTriggers: { version: 1, defaults: { mode: 'mention', senders: [] }, groups: {} },
};

function updateWith(extra, text = '@yc_deepseek_bot 做点事') {
  return normalizeTelegramUpdate({
    update_id: 9500,
    message: {
      message_id: 4382,
      date: 1,
      chat: { id: GROUP, type: 'supergroup', title: 'ycfed', is_forum: true },
      message_thread_id: 4184,
      from: { id: 6997371558, is_bot: false, first_name: 'YC' },
      text,
      entities: [{ type: 'mention', offset: 0, length: '@yc_deepseek_bot'.length }],
      ...extra,
    },
  }, options);
}

test('a forwarded user message names the original author', () => {
  const message = updateWith({
    forward_origin: {
      type: 'user',
      sender_user: { id: 5799965478, is_bot: false, first_name: '泥', username: 'winzkh' },
      date: 1,
    },
  });
  assert.equal(message.content, '[转发自 泥(@winzkh)] 做点事');
});

test('a hidden user origin keeps only the visible name', () => {
  const message = updateWith({
    forward_origin: { type: 'hidden_user', sender_user_name: '某人', date: 1 },
  });
  assert.equal(message.content, '[转发自 某人（隐藏账号）] 做点事');
});

test('a channel origin names the channel', () => {
  const message = updateWith({
    forward_origin: {
      type: 'channel',
      chat: { id: -1001, type: 'channel', title: 'YC personal', username: 'luyancia' },
      date: 1,
    },
  });
  assert.equal(message.content, '[转发自 YC personal(@luyancia)] 做点事');
});

test('a legacy forward_from still gets marked', () => {
  const message = updateWith({
    forward_from: { id: 7, is_bot: false, first_name: 'Legacy' },
  });
  assert.equal(message.content, '[转发自 Legacy] 做点事');
});

test('an ordinary message is untouched', () => {
  const message = updateWith({});
  assert.equal(message.content, '做点事');
});

test('a forwarded message without text is not given a prefix', () => {
  const message = updateWith({
    text: undefined,
    forward_origin: { type: 'hidden_user', sender_user_name: '某人', date: 1 },
  });
  assert.equal(message.content, '');
});

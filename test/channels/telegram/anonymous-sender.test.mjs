import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeTelegramUpdate } from '../../../src/channels/telegram/telegram-runtime.mjs';

const GROUP = -1002863898776;
const BOT_ID = 8685935858;

function anonymousUpdate(overrides = {}) {
  return {
    update_id: 9001,
    message: {
      message_id: 500,
      date: 1,
      from: { id: 1087968824, is_bot: true, first_name: 'Group', username: 'GroupAnonymousBot' },
      sender_chat: { id: GROUP, type: 'supergroup', title: 'ycfed' },
      chat: { id: GROUP, type: 'supergroup', title: 'ycfed' },
      text: '@yc_deepseek_bot 111',
      entities: [{ type: 'mention', offset: 0, length: '@yc_deepseek_bot'.length }],
      ...overrides,
    },
  };
}

const options = {
  botId: BOT_ID,
  username: 'yc_deepseek_bot',
  groupTriggers: { version: 1, defaults: { mode: 'mention', senders: [] }, groups: {} },
};

test('an anonymous admin message is not treated as a bot message', () => {
  const message = normalizeTelegramUpdate(anonymousUpdate(), options);
  assert.ok(message, 'message should not be dropped');
  assert.equal(message.senderIsBot, false);
});

test('the anonymous sender is labelled so the model knows who it cannot see', () => {
  const message = normalizeTelegramUpdate(anonymousUpdate(), options);
  const context = message.contextSource();
  assert.notEqual(context.senderName, 'Group');
  assert.match(context.senderName, /匿名/);
});

test('a real bot sender is still flagged as a bot', () => {
  const update = anonymousUpdate();
  update.message.from = { id: 777, is_bot: true, first_name: 'OtherBot' };
  delete update.message.sender_chat;
  const message = normalizeTelegramUpdate(update, options);
  assert.equal(message.senderIsBot, true);
});

test('a human sender is unaffected', () => {
  const update = anonymousUpdate();
  update.message.from = { id: 6997371558, is_bot: false, first_name: 'YC' };
  delete update.message.sender_chat;
  const message = normalizeTelegramUpdate(update, options);
  assert.equal(message.senderIsBot, false);
  assert.equal(message.contextSource().senderName, 'YC');
});

test('a mention still addresses the anonymous message', () => {
  const message = normalizeTelegramUpdate(anonymousUpdate(), options);
  assert.equal(message.addressed, true);
});

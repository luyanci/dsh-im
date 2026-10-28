import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeTelegramUpdate } from '../../../src/channels/telegram/telegram-runtime.mjs';

const options = {
  botId: 8685935858,
  username: 'yc_deepseek_bot',
  groupTriggers: { version: 1, defaults: { mode: 'mention', senders: [] }, groups: {} },
};

function reply(threadId, isForum) {
  const chat = { id: -1002555900106, type: 'supergroup', title: 'YC personal 聊天' };
  if (isForum) chat.is_forum = true;
  return normalizeTelegramUpdate({
    update_id: 1000 + threadId,
    message: {
      message_id: 900,
      message_thread_id: threadId,
      chat,
      from: { id: 6997371558, is_bot: false, first_name: 'YC' },
      text: '@yc_deepseek_bot hi',
      entities: [{ type: 'mention', offset: 0, length: '@yc_deepseek_bot'.length }],
    },
  }, options);
}

test('a reply thread in a plain supergroup stays in the chat-level conversation', () => {
  const one = reply(2382, false);
  const two = reply(2405, false);
  assert.equal(one.conversationId, '-1002555900106');
  assert.equal(two.conversationId, '-1002555900106');
});

test('a forum topic still gets its own conversation', () => {
  const topic = reply(4184, true);
  assert.equal(topic.conversationId, '-1002555900106:4184');
});

test('a plain supergroup still echoes the thread id when replying', () => {
  const message = reply(2382, false);
  assert.equal(message.replyTarget.messageThreadId, 2382);
});

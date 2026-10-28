import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeTelegramUpdate } from '../../../src/channels/telegram/telegram-runtime.mjs';

const GROUP = -1002555900106;
const CHANNEL = -1002476957219;
const BOT_ID = 8685935858;

const options = {
  botId: BOT_ID,
  username: 'yc_deepseek_bot',
  groupTriggers: { version: 1, defaults: { mode: 'mention', senders: [] }, groups: {} },
};

function anonymous(signature) {
  const message = {
    message_id: 3485,
    date: 1,
    from: { id: 1087968824, is_bot: true, first_name: 'Group' },
    sender_chat: { id: GROUP, type: 'supergroup', title: 'YC personal 聊天' },
    chat: { id: GROUP, type: 'supergroup', title: 'YC personal 聊天' },
    text: '然后是匿名 不知道能不能看到我成员标签',
  };
  if (signature !== undefined) message.author_signature = signature;
  return { update_id: 9200, message };
}

test('the anonymous admin custom title is surfaced', () => {
  const message = normalizeTelegramUpdate(anonymous('娇小萝莉就是好'), options);
  assert.equal(message.contextSource().senderName, '匿名群管理员 · 娇小萝莉就是好');
});

test('an unsigned anonymous admin keeps the plain label', () => {
  const message = normalizeTelegramUpdate(anonymous(undefined), options);
  assert.equal(message.contextSource().senderName, '匿名群管理员');
});

test('a blank signature is ignored', () => {
  const message = normalizeTelegramUpdate(anonymous('   '), options);
  assert.equal(message.contextSource().senderName, '匿名群管理员');
});

test('a channel post signature is appended to the channel name', () => {
  const update = {
    update_id: 9201,
    message: {
      message_id: 3478,
      date: 1,
      from: { id: 136817688, is_bot: true, first_name: 'Channel' },
      sender_chat: { id: CHANNEL, type: 'channel', title: 'YC personal' },
      chat: { id: GROUP, type: 'supergroup', title: 'YC personal 聊天' },
      text: 'hello?',
      author_signature: '值班小编',
    },
  };
  const message = normalizeTelegramUpdate(update, options);
  assert.equal(message.contextSource().senderName, '频道：YC personal · 值班小编');
});

test('a normal member is never given a signature suffix', () => {
  const update = {
    update_id: 9202,
    message: {
      message_id: 500,
      date: 1,
      from: { id: 6997371558, is_bot: false, first_name: 'YC' },
      chat: { id: GROUP, type: 'supergroup', title: 'YC personal 聊天' },
      text: 'hi',
      author_signature: '不该出现',
    },
  };
  const message = normalizeTelegramUpdate(update, options);
  assert.equal(message.contextSource().senderName, 'YC');
});

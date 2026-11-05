import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeOneBotEvent,
  oneBotQuotedReference,
  OneBotFormatError,
} from '../../../src/channels/onebot/onebot-normalize.mjs';

const SELF_ID = 2951316926;
const GROUP_ID = 904897306;
const USER_ID = 2058282593;

const triggers = {
  version: 1,
  defaults: { mode: 'mention', senders: [] },
  groups: {},
};

function groupEvent(segments, overrides = {}) {
  return {
    post_type: 'message',
    message_type: 'group',
    sub_type: 'normal',
    self_id: SELF_ID,
    group_id: GROUP_ID,
    group_name: '小号集合！',
    user_id: USER_ID,
    message_id: -1419597919,
    sender: { user_id: USER_ID, nickname: 'LYX233', card: 'YC酱⁧~啾⁦', role: 'owner' },
    message: segments,
    ...overrides,
  };
}

function normalize(event, options = {}) {
  return normalizeOneBotEvent(event, { selfId: SELF_ID, groupTriggers: triggers, ...options });
}

test('a bare group message is not addressed under the mention trigger', () => {
  const message = normalize(groupEvent([{ type: 'text', data: { text: '111' } }]));
  assert.equal(message.kind, 'group');
  assert.equal(message.addressed, false);
  assert.equal(message.content, '111');
  assert.equal(message.conversationKey, `group:${GROUP_ID}`);
  assert.equal(message.senderId, String(USER_ID));
});

test('an @ on our own account addresses the message and is not kept as text', () => {
  const message = normalize(groupEvent([
    { type: 'at', data: { qq: String(SELF_ID) } },
    { type: 'text', data: { text: ' 123' } },
  ]));
  assert.equal(message.addressed, true);
  assert.equal(message.content, ' 123');
});

test('an @ on someone else stays in the text', () => {
  const message = normalize(groupEvent([
    { type: 'at', data: { qq: '10001', name: '泥' } },
    { type: 'text', data: { text: ' 看这个' } },
  ]));
  assert.equal(message.addressed, false);
  assert.equal(message.content, '@泥 看这个');
});

test('the message_id sign is preserved verbatim, not normalised', () => {
  const negative = normalize(groupEvent([{ type: 'text', data: { text: 'a' } }]));
  const positive = normalize(groupEvent([{ type: 'text', data: { text: 'b' } }], { message_id: 720373615 }));
  assert.equal(negative.messageId, '-1419597919');
  assert.equal(positive.messageId, '720373615');
});

test('a reply segment carries the quoted id and nothing else', () => {
  const message = normalize(groupEvent([
    { type: 'reply', data: { id: '392264416' } },
    { type: 'at', data: { qq: String(SELF_ID) } },
    { type: 'text', data: { text: ' 123' } },
  ]));
  assert.deepEqual(message.replyTo, { messageId: '392264416' });
  assert.equal(message.content, ' 123');
  assert.equal(message.addressed, true);
});

test('a reply carries a loader when the runtime can resolve quoted ids', async () => {
  const asked = [];
  const message = normalizeOneBotEvent(groupEvent([
    { type: 'reply', data: { id: '392264416' } },
    { type: 'text', data: { text: ' 看这个' } },
  ]), {
    selfId: SELF_ID,
    groupTriggers: triggers,
    loadReply: async (messageId) => {
      asked.push(messageId);
      return { authorName: '泥', content: '原话' };
    },
  });
  assert.equal(message.replyTo.messageId, '392264416');
  assert.equal(typeof message.replyTo.load, 'function');
  assert.deepEqual(await message.replyTo.load({}), { authorName: '泥', content: '原话' });
  assert.deepEqual(asked, ['392264416']);
});

test('a get_msg payload becomes the quoted reference the pipeline renders', () => {
  const reference = oneBotQuotedReference({
    message_type: 'group',
    message_id: 392264416,
    sender: { user_id: SELF_ID, nickname: 'VC酱2号机', card: '' },
    message: [
      { type: 'at', data: { qq: '2058282593', name: '泥' } },
      { type: 'text', data: { text: ' 帮我看看' } },
      { type: 'image', data: { file: 'abc.jpg' } },
    ],
  });
  assert.equal(reference.authorId, String(SELF_ID));
  assert.equal(reference.authorName, 'VC酱2号机');
  assert.equal(reference.content, '@泥 帮我看看');
  assert.deepEqual(reference.attachments, [{ kind: 'image', name: 'abc.jpg' }]);
});

test('a deleted quote is null, an unreadable one is unsupported', () => {
  assert.equal(oneBotQuotedReference(null), null);
  const odd = oneBotQuotedReference({ sender: { user_id: '1' }, message: [] });
  assert.equal(odd.unavailableReason, 'unsupported');
  assert.equal(odd.authorId, '1');
});

test('a private message is always addressed and keys on the user', () => {
  const message = normalize({
    post_type: 'message',
    message_type: 'private',
    sub_type: 'friend',
    self_id: SELF_ID,
    user_id: USER_ID,
    message_id: 1701683830,
    sender: { user_id: USER_ID, nickname: 'LYX233' },
    message: [{ type: 'text', data: { text: '111' } }],
  });
  assert.equal(message.kind, 'direct');
  assert.equal(message.addressed, true);
  assert.equal(message.conversationKey, `direct:${USER_ID}`);
  assert.deepEqual(message.replyTarget, { userId: String(USER_ID) });
});

test('an image segment downloads lazily from its signed url', async () => {
  const seen = [];
  const message = normalize(groupEvent([
    { type: 'image', data: { file: 'DD49F613B75F3BC701B2E1D6A1FB4FCD.jpg', url: 'https://multimedia.nt.qq.com.cn/download?x=1' } },
  ]), {
    loadImage: async (url) => { seen.push(url); return Buffer.from('bytes'); },
  });
  assert.equal(message.images.length, 1);
  const [image] = message.images;
  assert.equal(image.name, 'DD49F613B75F3BC701B2E1D6A1FB4FCD.jpg');
  assert.equal(image.mediaType, 'image/jpeg');
  assert.deepEqual(await image.load({}), Buffer.from('bytes'));
  assert.deepEqual(seen, ['https://multimedia.nt.qq.com.cn/download?x=1']);
});

test('self echoes are dropped before anything else happens', () => {
  assert.equal(normalize(groupEvent([{ type: 'text', data: { text: 'x' } }], {
    post_type: 'message_sent',
  })), null);
  assert.equal(normalize(groupEvent([{ type: 'text', data: { text: 'x' } }], {
    sender: { user_id: SELF_ID },
    user_id: SELF_ID,
  })), null);
});

test('non-message posts are ignored', () => {
  assert.equal(normalize({ post_type: 'meta_event', meta_event_type: 'heartbeat' }), null);
  assert.equal(normalize({ post_type: 'notice', notice_type: 'notify' }), null);
});

test('a CQ-string message fails loudly instead of vanishing', () => {
  assert.throws(
    () => normalize(groupEvent('111', { message: '111' })),
    (error) => error instanceof OneBotFormatError && error.code === 'string-message',
  );
});

test('face and forward segments render as placeholders', () => {
  const message = normalize(groupEvent([
    { type: 'face', data: { id: '178' } },
    { type: 'forward', data: { id: 'abc' } },
  ]));
  assert.equal(message.content, '[表情][合并转发]');
});

test('a document segment becomes a lazy file source with a prompt marker', () => {
  const message = normalizeOneBotEvent(groupEvent([
    { type: 'file', data: { file: '报告.pdf', url: 'https://multimedia.test/f?id=1', file_size: 2048 } },
  ]), {
    selfId: SELF_ID,
    groupTriggers: triggers,
    loadImage: async () => ({ data: Buffer.from('pdf') }),
  });
  assert.equal(message.files.length, 1);
  assert.equal(message.files[0].name, '报告.pdf');
  assert.equal(message.files[0].size, 2048);
  // A document-only message still needs prompt content, or the turn is rejected.
  assert.equal(message.content, '[文件 报告.pdf]');
});

test('a document without a download url is only mentioned', () => {
  const message = normalizeOneBotEvent(groupEvent([
    { type: 'file', data: { file: '无名.zip' } },
  ]), { selfId: SELF_ID, groupTriggers: triggers });
  assert.equal(message.files.length, 0);
  assert.match(message.content, /无名\.zip/);
});

test('the sender display name prefers the group card', () => {
  const message = normalize(groupEvent([{ type: 'text', data: { text: 'x' } }]));
  assert.equal(message.contextSource().senderName, 'YC酱⁧~啾⁦');
  assert.equal(message.contextSource().conversationTitle, '小号集合！');
  assert.equal(message.senderRole, 'owner');
});

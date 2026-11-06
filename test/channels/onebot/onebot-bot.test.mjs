import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  base64ImageFile,
  createOneBotBotClient,
  ONEBOT_TEXT_CHUNK,
  splitOneBotText,
} from '../../../src/channels/onebot/onebot-bot.mjs';

function fakeApi() {
  const calls = [];
  return {
    calls,
    async sendGroupMsg(groupId, message) {
      calls.push({ action: 'send_group_msg', groupId, message });
      return { message_id: calls.length };
    },
    async sendPrivateMsg(userId, message, groupId) {
      calls.push({ action: 'send_private_msg', userId, message, groupId });
      return { message_id: calls.length };
    },
    async uploadGroupFile(groupId, file, name) {
      calls.push({ action: 'upload_group_file', groupId, file, name });
      return { file_id: `f${calls.length}` };
    },
    async uploadPrivateFile(userId, file, name) {
      calls.push({ action: 'upload_private_file', userId, file, name });
      return { file_id: `f${calls.length}` };
    },
  };
}

test('short text goes out as one ordinary message', async () => {
  const api = fakeApi();
  const bot = createOneBotBotClient({ api });
  await bot.sendText({ groupId: '904897306' }, '在');
  assert.deepEqual(api.calls, [{
    action: 'send_group_msg',
    groupId: '904897306',
    message: [{ type: 'text', data: { text: '在' } }],
  }]);
});

test('long text is split on a newline and sent as several messages', () => {
  const paragraph = 'x'.repeat(1000);
  const chunks = splitOneBotText(`${paragraph}\n${paragraph}`, ONEBOT_TEXT_CHUNK);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0], paragraph);
  assert.equal(chunks[1], paragraph);
});

test('a split never produces an empty chunk and keeps every character', () => {
  const text = Array.from({ length: 40 }, () => '这是一段用来测试分段的文字。').join('\n');
  const chunks = splitOneBotText(text, 200);
  assert.ok(chunks.every((chunk) => chunk.length > 0));
  assert.equal(chunks.join('\n').replace(/\s+/gu, ''), text.replace(/\s+/gu, ''));
});

test('a private conversation routes to send_private_msg', async () => {
  const api = fakeApi();
  const bot = createOneBotBotClient({ api });
  await bot.sendText({ userId: '2058282593' }, 'hi');
  assert.equal(api.calls[0].action, 'send_private_msg');
  assert.equal(api.calls[0].groupId, undefined);
});

test('a group-temporary session passes its origin group to send_private_msg', async () => {
  const api = fakeApi();
  const bot = createOneBotBotClient({ api });
  await bot.sendText({ userId: '2058282593', temporaryGroupId: '904897306' }, 'hi');
  assert.equal(api.calls[0].action, 'send_private_msg');
  assert.equal(api.calls[0].groupId, '904897306');
});

test('a delivery block degrades to its text', async () => {
  const api = fakeApi();
  const bot = createOneBotBotClient({ api });
  await bot.sendDelivery({ groupId: '1' }, { text: '# 标题\n\n正文', format: 'markdown' });
  assert.deepEqual(api.calls[0].message, [{ type: 'text', data: { text: '# 标题\n\n正文' } }]);
});

test('an artifact descriptor ({ bytes, fileName }) is what the bridge actually hands over', async () => {
  const api = fakeApi();
  const bot = createOneBotBotClient({ api });
  const bytes = Buffer.from('png-bytes');
  await bot.sendImage({ userId: '2058282593' }, {
    bytes,
    fileName: 'generated.png',
    mediaType: 'image/png',
  });
  assert.equal(api.calls[0].action, 'send_private_msg');
  assert.equal(api.calls[0].message[0].data.file, base64ImageFile(bytes));
});

test('an image is sent as base64 first and the working form is remembered', async () => {
  const api = fakeApi();
  const bot = createOneBotBotClient({ api });
  const bytes = Buffer.from('png-bytes');
  await bot.sendImage({ groupId: '1' }, { data: bytes, mediaType: 'image/png' });
  assert.equal(api.calls[0].message[0].type, 'image');
  assert.equal(api.calls[0].message[0].data.file, base64ImageFile(bytes));

  // Second image takes the remembered form, so a protocol end that only accepts
  // base64 never pays for the url attempt again.
  await bot.sendImage({ groupId: '1' }, { data: bytes, mediaType: 'image/png' });
  assert.equal(api.calls.length, 2);
});

test('a failing base64 form falls back to the artifact url', async () => {
  const calls = [];
  const api = {
    async sendGroupMsg(_groupId, message) {
      calls.push(message);
      if (message[0]?.data?.file?.startsWith('base64://')) throw new Error('invalid image format');
      return { message_id: calls.length };
    },
    async sendPrivateMsg() { throw new Error('unexpected'); },
  };
  const bot = createOneBotBotClient({ api, logger: { warn() {} } });
  await bot.sendImage({ groupId: '1' }, { data: Buffer.from('x'), url: 'https://cdn.test/a.png' });
  assert.equal(calls.length, 2);
  assert.equal(calls[1][0].data.file, 'https://cdn.test/a.png');
});

test('an image with neither data nor a url fails loudly', async () => {
  const bot = createOneBotBotClient({ api: fakeApi() });
  await assert.rejects(() => bot.sendImage({ groupId: '1' }, { mediaType: 'image/png' }), /needs bytes, data or a path/);
});

test('the explicit file form stages a file:// uri and cleans it up', async () => {
  const api = fakeApi();
  const bot = createOneBotBotClient({ api, format: 'file' });
  await bot.sendImage({ groupId: '1' }, { bytes: Buffer.from('png'), fileName: 'a.png' });
  const handle = api.calls[0].message[0].data.file;
  assert.match(handle, /^file:\/\/.*dsh-im-onebot-[0-9a-f-]+\.png$/);
  // The temp copy must not outlive the send.
  await assert.rejects(() => readFile(handle.slice('file://'.length)), /ENOENT/);
});

test('there is no typing indicator to send', () => {
  const bot = createOneBotBotClient({ api: fakeApi() });
  assert.equal(bot.sendTyping, undefined);
});

test('a document goes out through the protocol end upload action', async () => {
  const api = fakeApi();
  const bot = createOneBotBotClient({ api });
  await bot.sendFile({ groupId: '904897306' }, {
    bytes: Buffer.from('report'),
    fileName: '报告.txt',
    mediaType: 'text/plain',
  });
  await bot.sendFile({ userId: '2058282593' }, { bytes: Buffer.from('x'), name: 'a.txt' });
  assert.deepEqual(api.calls.map(call => call.action), ['upload_group_file', 'upload_private_file']);
  assert.equal(api.calls[0].name, '报告.txt');
  assert.equal(api.calls[0].file, base64ImageFile(Buffer.from('report')));
  assert.equal(api.calls[1].name, 'a.txt');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

import WebSocket from 'ws';

import { createOneBotRuntime, createOneBotRuntimeStatus } from '../../../src/channels/onebot/onebot-runtime.mjs';

const SELF_ID = '2951316926';
const GROUP_ID = 904897306;
const USER_ID = 2058282593;

function runtimeConfig(overrides = {}) {
  return {
    botId: 'onebot_test',
    selfId: SELF_ID,
    name: 'VC酱2号机',
    host: '127.0.0.1',
    port: 0,
    path: '/onebot/v11/ws',
    accessToken: '',
    selfIds: [],
    imageSendFormat: 'auto',
    ...overrides,
  };
}

/** A bridge stub that records what the runtime hands it. */
function fakeBridge() {
  const accepted = [];
  return {
    accepted,
    accept(message) {
      accepted.push(message);
      return Promise.resolve();
    },
    waitForIdle() {
      return Promise.resolve();
    },
  };
}

const harness = { ensureRunning: async () => {} };
function fakeState() {
  const seen = new Set();
  return {
    hasSeen: (id) => seen.has(id),
    markSeen: (id) => seen.add(id),
    get: () => null,
    set: () => {},
  };
}

async function startRuntime(overrides = {}) {
  const bridge = fakeBridge();
  const runtime = createOneBotRuntime({
    config: runtimeConfig(overrides),
    harness,
    state: fakeState(),
    logger: { warn() {}, error() {} },
    createBridge: () => bridge,
  });
  await runtime.start();
  return { runtime, bridge };
}

function connect(runtime) {
  return new WebSocket(`ws://127.0.0.1:${runtime.address.port}/onebot/v11/ws`, {
    headers: { 'X-Self-ID': SELF_ID, 'X-Client-Role': 'Universal' },
  });
}

function groupMessage(segments, overrides = {}) {
  return JSON.stringify({
    post_type: 'message',
    message_type: 'group',
    group_id: GROUP_ID,
    user_id: USER_ID,
    message_id: -1419597919,
    self_id: Number(SELF_ID),
    sender: { user_id: USER_ID, nickname: 'LYX233', card: 'YC酱', role: 'owner' },
    message: segments,
    ...overrides,
  });
}

test('the runtime listens and reports it', async (t) => {
  const { runtime } = await startRuntime();
  t.after(() => runtime.stop());
  assert.equal(runtime.status.listening, true);
  assert.equal(runtime.status.connectionState, 'listening');
  assert.equal(runtime.status.ready, false);
  assert.ok(runtime.address.port > 0);
});

test('a connected protocol end flips the status and hands messages to the bridge', async (t) => {
  const { runtime, bridge } = await startRuntime();
  t.after(() => runtime.stop());
  const ws = connect(runtime);
  // Attach before the socket opens: the runtime asks for get_login_info as soon
  // as the connection is accepted.
  ws.on('message', (raw) => {
    const frame = JSON.parse(raw.toString('utf8'));
    if (frame.action === 'get_login_info') {
      ws.send(JSON.stringify({
        status: 'ok',
        retcode: 0,
        data: { user_id: Number(SELF_ID), nickname: 'VC酱2号机' },
        echo: frame.echo,
      }));
    }
  });
  await once(ws, 'open');
  t.after(() => ws.close());

  ws.send(groupMessage([
    { type: 'at', data: { qq: SELF_ID } },
    { type: 'text', data: { text: ' 123' } },
  ]));
  await new Promise((resolve) => setTimeout(resolve, 120));

  assert.equal(bridge.accepted.length, 1);
  assert.equal(bridge.accepted[0].addressed, true);
  assert.equal(bridge.accepted[0].taggedAtSelf, true);
  assert.equal(bridge.accepted[0].content, ' 123');
  assert.equal(runtime.status.ready, true);
  assert.equal(runtime.status.selfId, SELF_ID);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(runtime.status.nickname, 'VC酱2号机');
});

test('self echoes are dropped and unaddressed chatter is still handed over', async (t) => {
  const { runtime, bridge } = await startRuntime();
  t.after(() => runtime.stop());
  const ws = connect(runtime);
  await once(ws, 'open');
  t.after(() => ws.close());

  ws.send(groupMessage([{ type: 'text', data: { text: 'echo' } }], { post_type: 'message_sent' }));
  ws.send(groupMessage([{ type: 'text', data: { text: '闲聊' } }]));
  await new Promise((resolve) => setTimeout(resolve, 120));

  // The echo never reaches the bridge; the unaddressed message does, because
  // the bridge — not the transport — owns the trigger decision.
  assert.equal(bridge.accepted.length, 1);
  assert.equal(bridge.accepted[0].addressed, false);
  assert.equal(bridge.accepted[0].content, '闲聊');
});

test('a malformed frame is logged and never throws', async (t) => {
  const warnings = [];
  const bridge = fakeBridge();
  const runtime = createOneBotRuntime({
    config: runtimeConfig(),
    harness,
    state: fakeState(),
    logger: { warn: (line) => warnings.push(line), error() {} },
    createBridge: () => bridge,
  });
  await runtime.start();
  t.after(() => runtime.stop());
  const ws = connect(runtime);
  await once(ws, 'open');
  t.after(() => ws.close());

  ws.send(groupMessage('not-an-array', { message: '111' }));
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(bridge.accepted.length, 0);
  assert.ok(warnings.some((line) => line.includes('dropped a message')));
});

test('a quoted reply resolves its content through get_msg', async (t) => {
  const { runtime, bridge } = await startRuntime();
  t.after(() => runtime.stop());
  const ws = connect(runtime);
  ws.on('message', (raw) => {
    const frame = JSON.parse(raw.toString('utf8'));
    if (frame.action === 'get_login_info') {
      ws.send(JSON.stringify({
        status: 'ok', retcode: 0, data: { user_id: Number(SELF_ID), nickname: 'VC酱2号机' }, echo: frame.echo,
      }));
      return;
    }
    if (frame.action === 'get_msg') {
      ws.send(JSON.stringify({
        status: 'ok',
        retcode: 0,
        data: {
          message_id: Number(frame.params.message_id),
          sender: { user_id: 2058282593, nickname: 'LYX233', card: 'YC酱' },
          message: [{ type: 'text', data: { text: '被引用的话' } }],
        },
        echo: frame.echo,
      }));
    }
  });
  await once(ws, 'open');
  t.after(() => ws.close());

  ws.send(groupMessage([
    { type: 'reply', data: { id: '392264416' } },
    { type: 'at', data: { qq: SELF_ID } },
    { type: 'text', data: { text: ' 这是什么' } },
  ]));
  await new Promise((resolve) => setTimeout(resolve, 120));

  assert.equal(bridge.accepted.length, 1);
  const [message] = bridge.accepted;
  assert.equal(message.replyTo.messageId, '392264416');
  // The reply pipeline calls this lazily; QQ sent only the id.
  assert.deepEqual(await message.replyTo.load({}), {
    authorId: '2058282593',
    authorName: 'YC酱',
    content: '被引用的话',
  });
});

test('replying to the bot\'s own message wakes the model without an @', async (t) => {
  const { runtime, bridge } = await startRuntime();
  t.after(() => runtime.stop());
  const ws = connect(runtime);
  ws.on('message', (raw) => {
    const frame = JSON.parse(raw.toString('utf8'));
    if (frame.action === 'get_msg') {
      // The quoted message was written by the bot itself.
      ws.send(JSON.stringify({
        status: 'ok',
        retcode: 0,
        data: {
          message_id: Number(frame.params.message_id),
          sender: { user_id: Number(SELF_ID), nickname: 'VC酱2号机', card: '' },
          message: [{ type: 'text', data: { text: '我上一条回复' } }],
        },
        echo: frame.echo,
      }));
    }
  });
  await once(ws, 'open');
  t.after(() => ws.close());

  ws.send(groupMessage([
    { type: 'reply', data: { id: '392264416' } },
    { type: 'text', data: { text: '这句啥意思' } },
  ]));
  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.equal(bridge.accepted.length, 1);
  assert.equal(bridge.accepted[0].addressed, true, 'a reply to the bot is a tag');
  assert.equal(bridge.accepted[0].repliedToBot, true);
});

test('replying to someone else does not wake the model', async (t) => {
  const { runtime, bridge } = await startRuntime();
  t.after(() => runtime.stop());
  const ws = connect(runtime);
  ws.on('message', (raw) => {
    const frame = JSON.parse(raw.toString('utf8'));
    if (frame.action === 'get_msg') {
      ws.send(JSON.stringify({
        status: 'ok',
        retcode: 0,
        data: {
          message_id: Number(frame.params.message_id),
          sender: { user_id: 2058282593, nickname: 'LYX233', card: 'YC酱' },
          message: [{ type: 'text', data: { text: '别人的话' } }],
        },
        echo: frame.echo,
      }));
    }
  });
  await once(ws, 'open');
  t.after(() => ws.close());

  ws.send(groupMessage([
    { type: 'reply', data: { id: '392264416' } },
    { type: 'text', data: { text: '这句啥意思' } },
  ]));
  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.equal(bridge.accepted.length, 1);
  assert.equal(bridge.accepted[0].addressed, false);
});

test('stopping closes the listener and clears the status', async () => {
  const { runtime } = await startRuntime();
  const stopped = await runtime.stop();
  assert.equal(stopped.listening, false);
  assert.equal(stopped.ready, false);
  assert.equal(stopped.connectionState, 'idle');
  assert.equal(runtime.address, null);
});

test('the runtime status starts from the shared bridge counters', () => {
  const status = createOneBotRuntimeStatus();
  assert.equal(status.messagesReceived, 0);
  assert.equal(status.ready, false);
  assert.equal(status.listening, false);
});

test('an expired image url falls back to get_image', async (t) => {
  // A sticker whose rkey died: the url answers 400 "download url has expired",
  // NapCat still has the bytes and returns them as base64.
  const bridge = fakeBridge();
  const logs = [];
  const runtime = createOneBotRuntime({
    config: runtimeConfig(),
    harness,
    state: fakeState(),
    logger: { info: (line) => logs.push(String(line)), warn() {}, error() {} },
    createBridge: () => bridge,
    loadImage: async () => {
      throw new Error('OneBot media download failed with HTTP 400');
    },
    createApi: () => ({
      getImage: async ({ file }) => ({
        // A path that does not exist here forces the base64 branch.
        file: 'C:\\nowhere\\sticker.jpg',
        file_name: file,
        base64: Buffer.from('IMAGE-BYTES').toString('base64'),
      }),
    }),
  });
  t.after(() => runtime.stop());
  await runtime.start();
  const ws = connect(runtime);
  await once(ws, 'open');
  t.after(() => ws.close());

  ws.send(groupMessage([
    {
      type: 'image',
      data: { file: '9C13BCDE82047B02D9CBB52AA12D64F4.jpg', url: 'https://gchat.qpic.cn/download?rkey=dead' },
    },
  ]));
  for (let i = 0; i < 40 && bridge.accepted.length === 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(bridge.accepted.length, 1);
  const bytes = await bridge.accepted[0].images[0].load({ maxBytes: 1024 });
  assert.equal(Buffer.from(bytes).toString(), 'IMAGE-BYTES');
  assert.match(logs.join('\n'), /image url download failed for 9C13BCDE82047B02D9CBB52AA12D64F4\.jpg/);
  assert.match(logs.join('\n'), /inbound image via get-image-base64/);
});

test('a failed image url is not retried for every image', async (t) => {
  // With the rkey service gone every link is dead; probing each one wastes a
  // round trip before the same get_image fallback runs.
  const bridge = fakeBridge();
  const logs = [];
  let urlAttempts = 0;
  const runtime = createOneBotRuntime({
    config: runtimeConfig(),
    harness,
    state: fakeState(),
    logger: { info: (line) => logs.push(String(line)), warn() {}, error() {} },
    createBridge: () => bridge,
    loadImage: async () => {
      urlAttempts += 1;
      throw new Error('OneBot media download failed with HTTP 400');
    },
    createApi: () => ({
      getImage: async () => ({ base64: Buffer.from('STICKER').toString('base64') }),
    }),
  });
  t.after(() => runtime.stop());
  await runtime.start();
  const ws = connect(runtime);
  await once(ws, 'open');
  t.after(() => ws.close());

  ws.send(groupMessage([
    { type: 'image', data: { file: 'first.jpg', url: 'https://gchat.qpic.cn/download?rkey=dead' } },
    { type: 'image', data: { file: 'second.jpg', url: 'https://gchat.qpic.cn/download?rkey=dead' } },
  ]));
  for (let i = 0; i < 40 && bridge.accepted.length === 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const [message] = bridge.accepted;
  assert.equal(message.images.length, 2);
  for (const image of message.images) {
    assert.equal(Buffer.from(await image.load({})).toString(), 'STICKER');
  }
  assert.equal(urlAttempts, 1, 'the second image skips the url it knows is dead');
  assert.match(logs.join('\n'), /image url skipped for second\.jpg/);
});

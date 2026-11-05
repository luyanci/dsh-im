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

import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

import WebSocket from 'ws';

import {
  checkOneBotHandshake,
  createOneBotServer,
  ONEBOT_UNIVERSAL_ROLE,
} from '../../../src/channels/onebot/onebot-connection.mjs';
import { createOneBotApi, sendTextMessage, textSegment } from '../../../src/channels/onebot/onebot-api.mjs';

const SELF_ID = '2951316926';

function handshake(headers = {}, { url = '/onebot/v11/ws', accessToken = '', selfId, selfIds = [] } = {}) {
  const requestUrl = new URL(`http://127.0.0.1${url}`);
  return checkOneBotHandshake({ headers, url: requestUrl, accessToken, selfId, selfIds });
}

test('a handshake needs both identity headers', () => {
  assert.deepEqual(handshake({}), { ok: false, status: 400, reason: 'missing X-Self-ID' });
  assert.deepEqual(handshake({ 'x-self-id': SELF_ID }), { ok: false, status: 400, reason: 'missing X-Client-Role' });
});

test('the token may arrive as a header or as a query parameter', () => {
  const base = { 'x-self-id': SELF_ID, 'x-client-role': ONEBOT_UNIVERSAL_ROLE };
  assert.equal(handshake(base, { accessToken: 'secret' }).ok, false);
  assert.equal(handshake({ ...base, authorization: 'Bearer secret' }, { accessToken: 'secret' }).ok, true);
  assert.equal(handshake(base, { accessToken: 'secret', url: '/onebot/v11/ws?access_token=secret' }).ok, true);
  assert.equal(handshake(base).ok, true, 'an empty configured token means no check');
});

test('an account allowlist and the action role are enforced', () => {
  const base = { 'x-self-id': SELF_ID, 'x-client-role': ONEBOT_UNIVERSAL_ROLE };
  assert.equal(handshake(base, { selfIds: ['10001'] }).status, 403);
  assert.equal(handshake(base, { selfIds: [SELF_ID] }).ok, true);
  assert.equal(handshake({ ...base, 'x-client-role': 'Event' }).status, 400);
  // An Api-only client carries actions but no events, so it must be refused.
  assert.equal(handshake({ ...base, 'x-client-role': 'Api' }).status, 400);
  assert.match(handshake({ ...base, 'x-client-role': 'Api' }).reason, /Universal/);
});

test('the handshake account must match the configured QQ number', () => {
  const base = { 'x-self-id': SELF_ID, 'x-client-role': ONEBOT_UNIVERSAL_ROLE };
  assert.equal(handshake(base, { selfId: SELF_ID }).ok, true);
  const wrong = handshake(base, { selfId: '10001' });
  assert.equal(wrong.status, 403);
  assert.match(wrong.reason, /does not match/);
});

async function startServer(options = {}) {
  const server = createOneBotServer({ port: 0, accessToken: '', ...options });
  const address = await server.listen();
  return { server, address };
}

function connect(address, headers = { 'x-self-id': SELF_ID, 'x-client-role': ONEBOT_UNIVERSAL_ROLE }) {
  return new WebSocket(`ws://127.0.0.1:${address.port}/onebot/v11/ws`, { headers });
}

function nextConnected(server) {
  return new Promise((resolve) => {
    const off = server.onState(({ kind, session }) => {
      if (kind === 'connected') {
        off();
        resolve(session);
      }
    });
  });
}

test('a connected session receives events and answers actions', async (t) => {
  const { server, address } = await startServer();
  t.after(() => server.close());

  const frames = [];
  server.onFrame((frame) => {
    frames.push(frame);
  });

  const statePromise = nextConnected(server);
  const ws = connect(address);
  await once(ws, 'open');
  const session = await statePromise;
  assert.equal(session.selfId, SELF_ID);

  // The protocol end pushes an event; the listener sees it.
  ws.send(JSON.stringify({ post_type: 'message', message_type: 'group', message_id: 1 }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].post_type, 'message');
  ws.close();
});

test('actions correlate by echo and reject a failed retcode', async (t) => {
  const { server, address } = await startServer();
  t.after(() => server.close());

  const statePromise = nextConnected(server);
  const ws = connect(address);
  await once(ws, 'open');
  const session = await statePromise;

  ws.on('message', (raw) => {
    const frame = JSON.parse(raw.toString('utf8'));
    if (frame.action === 'get_login_info') {
      ws.send(JSON.stringify({ status: 'ok', retcode: 0, data: { user_id: 2951316926, nickname: 'VC酱2号机' }, echo: frame.echo }));
    } else if (frame.action === 'send_group_msg') {
      ws.send(JSON.stringify({ status: 'failed', retcode: 100, wording: 'group not found', echo: frame.echo }));
    }
  });

  const api = createOneBotApi(session);
  const info = await api.getLoginInfo();
  assert.equal(info.nickname, 'VC酱2号机');

  await assert.rejects(() => api.sendGroupMsg(904897306, [textSegment('hi')]), /group not found/);
  ws.close();
});

test('a second connection for the same account is refused', async (t) => {
  const { server, address } = await startServer();
  t.after(() => server.close());

  const first = connect(address);
  await once(first, 'open');
  await new Promise((resolve) => setTimeout(resolve, 50));

  const second = connect(address);
  const [code] = await once(second, 'close');
  assert.equal(code, 4009);
  first.close();
});

test('sendTextMessage routes to the conversation kind', async () => {
  const calls = [];
  const session = {
    request(action, params) {
      calls.push({ action, params });
      return Promise.resolve({ message_id: 1 });
    },
  };
  const api = createOneBotApi(session);
  await sendTextMessage(api, { kind: 'group', groupId: '904897306' }, 'hello');
  await sendTextMessage(api, { kind: 'direct', userId: '2058282593' }, 'hi');
  assert.deepEqual(calls, [
    { action: 'send_group_msg', params: { group_id: 904897306, message: [{ type: 'text', data: { text: 'hello' } }] } },
    { action: 'send_private_msg', params: { user_id: 2058282593, message: [{ type: 'text', data: { text: 'hi' } }] } },
  ]);
});

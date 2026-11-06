import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createOneBotRpcHandler,
  ONEBOT_ENDPOINTS,
} from '../../../plugin-src/host/channels/onebot/rpc.mjs';

function fakeController() {
  const calls = [];
  return {
    calls,
    status: () => ({ revision: 1, ready: false, bots: [] }),
    addBot: async (payload) => { calls.push(['add', payload]); return { revision: 2, ready: false, bots: [] }; },
    deleteBot: async (botId) => { calls.push(['delete', botId]); return { revision: 3, ready: false, bots: [] }; },
    restartBot: async (botId) => { calls.push(['restart', botId]); return { revision: 4, ready: false, bots: [] }; },
    setSettings: async (botId, patch) => { calls.push(['settings', botId, patch]); return { revision: 5, ready: false, bots: [] }; },
  };
}

test('status takes no fields and returns the snapshot', async () => {
  const handler = createOneBotRpcHandler(fakeController());
  const result = await handler(ONEBOT_ENDPOINTS.status, {});
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { revision: 1, ready: false, bots: [] });

  const rejected = await handler(ONEBOT_ENDPOINTS.status, { unexpected: 1 });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'bad-request');
});

test('add-bot requires a QQ number and forwards the rest', async () => {
  const controller = fakeController();
  const handler = createOneBotRpcHandler(controller);

  const bad = await handler(ONEBOT_ENDPOINTS.addBot, { selfId: 'abc' });
  assert.equal(bad.ok, false);

  const good = await handler(ONEBOT_ENDPOINTS.addBot, { selfId: '2951316926', port: 6800, accessToken: 't' });
  assert.equal(good.ok, true);
  assert.deepEqual(controller.calls[0], ['add', { selfId: '2951316926', port: 6800, accessToken: 't' }]);
});

test('add-bot rejects unknown and out-of-range fields', async () => {
  const handler = createOneBotRpcHandler(fakeController());
  assert.equal((await handler(ONEBOT_ENDPOINTS.addBot, { selfId: '2951316926', bogus: 1 })).ok, false);
  assert.equal((await handler(ONEBOT_ENDPOINTS.addBot, { selfId: '2951316926', port: 0 })).ok, false);
  assert.equal((await handler(ONEBOT_ENDPOINTS.addBot, { selfId: '2951316926', port: 70000 })).ok, false);
  assert.equal((await handler(ONEBOT_ENDPOINTS.addBot, { selfId: '2951316926', path: 'onebot' })).ok, false);
  assert.equal((await handler(ONEBOT_ENDPOINTS.addBot, { selfId: '2951316926', imageSendFormat: 'png' })).ok, false);
});

test('delete needs an explicit confirm and restart only a bot id', async () => {
  const controller = fakeController();
  const handler = createOneBotRpcHandler(controller);
  assert.equal((await handler(ONEBOT_ENDPOINTS.deleteBot, { botId: 'onebot_abc' })).ok, false);
  const deleted = await handler(ONEBOT_ENDPOINTS.deleteBot, { botId: 'onebot_abc', confirm: true });
  assert.equal(deleted.ok, true);
  assert.deepEqual(controller.calls[0], ['delete', 'onebot_abc']);

  const restarted = await handler(ONEBOT_ENDPOINTS.restartBot, { botId: 'onebot_abc' });
  assert.equal(restarted.ok, true);
  assert.deepEqual(controller.calls[1], ['restart', 'onebot_abc']);
});

test('set-settings splits the bot id from the patch', async () => {
  const controller = fakeController();
  const handler = createOneBotRpcHandler(controller);
  const result = await handler(ONEBOT_ENDPOINTS.setSettings, { botId: 'onebot_abc', port: 6811 });
  assert.equal(result.ok, true);
  assert.deepEqual(controller.calls[0], ['settings', 'onebot_abc', { port: 6811 }]);
});

test('access-policy.set forwards the policy itself, not the envelope', async () => {
  // Regression: this row passed the whole { botId, policy } payload as the policy,
  // so the controller received an object without direct/group and every save
  // failed with "请同时提交完整的私聊和群聊访问设置。".
  const controller = fakeController();
  controller.updateAccessPolicy = async (botId, policy) => {
    controller.calls.push(['policy', botId, policy]);
    return { botId, accessPolicy: policy };
  };
  const policy = {
    direct: {
      mode: 'open',
      open: { defaultCanExecuteCommands: true, commandPermissionOverrides: [] },
      allowlist: { users: [] },
    },
    group: {
      mode: 'open',
      open: { defaultCanExecuteCommands: true, commandPermissionOverrides: [] },
      allowlist: { users: [] },
    },
  };

  const handler = createOneBotRpcHandler(controller);
  const result = await handler(ONEBOT_ENDPOINTS.setAccessPolicy, { botId: 'onebot_abc', policy });

  assert.equal(result.ok, true);
  assert.deepEqual(controller.calls[0], ['policy', 'onebot_abc', policy]);

  const incomplete = await handler(ONEBOT_ENDPOINTS.setAccessPolicy, {
    botId: 'onebot_abc',
    policy: { direct: policy.direct },
  });
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.error.code, 'bad-request');
});

test('an unknown endpoint and a controller failure both fail closed', async () => {
  const handler = createOneBotRpcHandler(fakeController());
  const unknown = await handler('onebot.nope', {});
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'onebot-unknown-endpoint');

  const failing = createOneBotRpcHandler({
    status: () => ({}),
    addBot: async () => { throw new Error('listen blew up'); },
  });
  const result = await failing(ONEBOT_ENDPOINTS.addBot, { selfId: '2951316926' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'onebot-operation-failed');
  assert.match(result.error.message, /listen blew up/);
});

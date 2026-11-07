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

test('message-mode.set forwards busyMessageMode, not a mode field', async () => {
  // Same class of bug as the access-policy row: the payload carries
  // `busyMessageMode`, so reading `payload.mode` handed the controller undefined
  // and every save failed with "Message mode must be queue or steer".
  const controller = fakeController();
  controller.updateBusyMessageMode = async (botId, mode) => {
    controller.calls.push(['mode', botId, mode]);
    return { botId, busyMessageMode: mode };
  };

  const handler = createOneBotRpcHandler(controller);
  const result = await handler(ONEBOT_ENDPOINTS.setBusyMessageMode, { botId: 'onebot_abc', busyMessageMode: 'steer' });

  assert.equal(result.ok, true);
  assert.deepEqual(controller.calls[0], ['mode', 'onebot_abc', 'steer']);

  const invalid = await handler(ONEBOT_ENDPOINTS.setBusyMessageMode, { botId: 'onebot_abc', busyMessageMode: 'later' });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'bad-request');
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

test('group rules are read, listed and saved through the controller', async () => {
  const calls = [];
  const controller = {
    groupRulesPanel: async (botId) => {
      calls.push(['panel', botId]);
      return { defaults: { mode: 'mention', senders: [] }, groups: {}, seen: [], available: [] };
    },
    listGroups: async (botId) => {
      calls.push(['list', botId]);
      return [{ groupId: '904897306', groupName: '小号集合！', memberCount: 5 }];
    },
    updateGroupRules: async (botId, payload) => {
      calls.push(['update', botId, payload]);
      return { defaults: payload.config.defaults, groups: payload.config.groups, seen: [], available: [] };
    },
  };
  const handler = createOneBotRpcHandler(controller);

  const panel = await handler(ONEBOT_ENDPOINTS.getGroupRules, { botId: 'onebot_abc' });
  assert.equal(panel.ok, true);
  assert.deepEqual(calls.at(-1), ['panel', 'onebot_abc']);

  const listed = await handler(ONEBOT_ENDPOINTS.listGroups, { botId: 'onebot_abc' });
  assert.equal(listed.ok, true);
  assert.equal(listed.value[0].groupId, '904897306');

  const saved = await handler(ONEBOT_ENDPOINTS.setGroupRules, {
    botId: 'onebot_abc',
    config: {
      defaults: { mode: 'mention', senders: [] },
      groups: { 904897306: { mode: 'all', senders: [] } },
    },
    removed: ['909906121'],
  });
  assert.equal(saved.ok, true);
  assert.deepEqual(calls.at(-1), ['update', 'onebot_abc', {
    config: {
      defaults: { mode: 'mention', senders: [] },
      groups: { 904897306: { mode: 'all', senders: [] } },
    },
    removed: ['909906121'],
  }]);

  // An unknown mode falls back to the default; only a malformed rule set is refused.
  const badSenders = await handler(ONEBOT_ENDPOINTS.setGroupRules, {
    botId: 'onebot_abc',
    config: { defaults: { mode: 'all', senders: 'nope' }, groups: {} },
  });
  assert.equal(badSenders.ok, false);
  assert.equal(badSenders.error.code, 'bad-request');
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

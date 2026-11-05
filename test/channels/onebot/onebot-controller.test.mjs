import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { OneBotController } from '../../../src/channels/onebot/onebot-controller.mjs';
import { OneBotConfigStore } from '../../../src/channels/onebot/onebot-config-store.mjs';
import { createOneBotRuntimeStatus } from '../../../src/channels/onebot/onebot-runtime.mjs';

const SELF_ID = '2951316926';

function fakeCredentials() {
  const store = new Map();
  return {
    store,
    async set(ref, value) { store.set(ref, value); },
    async resolve(ref) { return store.has(ref) ? { value: store.get(ref) } : undefined; },
    async unset(ref) { store.delete(ref); },
  };
}

function fakeRuntimeFactory(log = []) {
  return (options) => {
    const status = createOneBotRuntimeStatus();
    const runtime = {
      options,
      status,
      started: false,
      async start() {
        this.started = true;
        status.listening = true;
        status.connectionState = 'listening';
        log.push(['start', options.config.botId, options.config.port]);
        return status;
      },
      async stop() {
        this.started = false;
        status.listening = false;
        status.connectionState = 'idle';
        log.push(['stop', options.config.botId]);
        return status;
      },
      waitForIdle: () => Promise.resolve(),
    };
    return runtime;
  };
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-onebot-controller-'));
  const configStore = await new OneBotConfigStore(join(root, 'onebot.json')).load();
  const credentials = fakeCredentials();
  const log = [];
  const controller = new OneBotController({
    credentials,
    configStore,
    createRuntime: fakeRuntimeFactory(log),
    harness: { ensureRunning: async () => {} },
    state: {},
    logger: { warn() {} },
  });
  return { controller, configStore, credentials, log, root };
}

test('adding a bot stores it, keeps the token in credentials and starts a listener', async (t) => {
  const { controller, configStore, credentials, log } = await setup();
  t.after(() => controller.close());
  const status = await controller.addBot({ selfId: SELF_ID, accessToken: 'secret', port: 6800 });
  assert.equal(status.bots.length, 1);
  assert.equal(status.bots[0].port, 6800);
  assert.equal(status.bots[0].accessTokenConfigured, true);
  assert.ok(!JSON.stringify(status).includes('secret'), 'the token never appears in status');
  assert.equal(configStore.list()[0].selfId, SELF_ID);
  assert.deepEqual([...credentials.store.values()], ['secret']);
  assert.deepEqual(log, [['start', status.bots[0].botId, 6800]]);
});

test('initialize starts every saved bot', async (t) => {
  const { controller, configStore } = await setup();
  await configStore.save({ selfId: '10001', port: 6801 });
  await configStore.save({ selfId: '10002', port: 6802 });
  const status = await controller.initialize();
  t.after(() => controller.close());
  assert.equal(status.bots.length, 2);
  assert.ok(status.bots.every((bot) => bot.listening === true));
});

test('changing settings restarts the listener with the new port', async (t) => {
  const { controller, log } = await setup();
  t.after(() => controller.close());
  const first = await controller.addBot({ selfId: SELF_ID, port: 6810 });
  const botId = first.bots[0].botId;
  const status = await controller.setSettings(botId, { port: 6811, imageSendFormat: 'url' });
  assert.equal(status.bots[0].port, 6811);
  assert.equal(status.bots[0].imageSendFormat, 'url');
  assert.deepEqual(log, [
    ['start', botId, 6810],
    ['stop', botId],
    ['start', botId, 6811],
  ]);
});

test('an async runtime factory is awaited before start is called', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-onebot-async-'));
  const configStore = await new OneBotConfigStore(join(root, 'onebot.json')).load();
  const log = [];
  const controller = new OneBotController({
    credentials: fakeCredentials(),
    configStore,
    // Production's factory awaits the workspace record first, so it returns a
    // promise; the controller must not treat that promise as the runtime.
    createRuntime: async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      const status = createOneBotRuntimeStatus();
      return {
        status,
        async start() {
          log.push('start');
          status.listening = true;
        },
        async stop() {},
      };
    },
    harness: { ensureRunning: async () => {} },
    state: {},
    logger: { warn() {} },
  });
  t.after(() => controller.close());
  const status = await controller.addBot({ selfId: SELF_ID, port: 6820 });
  assert.equal(status.bots[0].listening, true);
  assert.deepEqual(log, ['start']);
});

test('deleting a bot stops it, forgets it and drops its token', async () => {
  const { controller, configStore, credentials } = await setup();
  const created = await controller.addBot({ selfId: SELF_ID, accessToken: 'secret' });
  const botId = created.bots[0].botId;
  const status = await controller.deleteBot(botId);
  assert.equal(status.bots.length, 0);
  assert.equal(configStore.list().length, 0);
  assert.equal(credentials.store.size, 0);
});

test('a listener that cannot bind surfaces as a bot error, not a crash', async (t) => {
  const { controller } = await setup();
  t.after(() => controller.close());
  const failing = new OneBotController({
    credentials: fakeCredentials(),
    configStore: await new OneBotConfigStore(join(await mkdtemp(join(tmpdir(), 'dsh-onebot-')), 'c.json')).load(),
    createRuntime: () => ({
      status: createOneBotRuntimeStatus(),
      start: async () => { throw new Error('EADDRINUSE'); },
      stop: async () => {},
    }),
    harness: { ensureRunning: async () => {} },
    state: {},
    logger: { warn() {} },
  });
  t.after(() => failing.close());
  const status = await failing.addBot({ selfId: SELF_ID });
  assert.match(status.bots[0].error.message, /EADDRINUSE/);
  assert.equal(status.bots[0].listening, false);
});

test('the connect check sends a test message to the last conversation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-onebot-test-'));
  const configStore = await new OneBotConfigStore(join(root, 'c.json')).load();
  const sent = [];
  const status = createOneBotRuntimeStatus();
  const controller = new OneBotController({
    credentials: fakeCredentials(),
    configStore,
    createRuntime: () => ({
      status: { ...status, listening: true, lastTarget: { groupId: '904897306' } },
      async start() {},
      async stop() {},
      async sendText(target, text) { sent.push([target, text]); },
    }),
    harness: { ensureRunning: async () => {} },
    state: {},
    logger: { warn() {} },
  });
  t.after(() => controller.close());
  const added = await controller.addBot({ selfId: SELF_ID, port: 6840 });
  const botId = added.bots[0].botId;
  const checked = await controller.restartBot(botId, { sendTest: true });
  assert.deepEqual(checked.testMessage, { sent: true });
  assert.equal(sent[0][0].groupId, '904897306');
  assert.match(sent[0][1], /连接检查/);
  // Without a conversation there is nothing to prove.
  const idle = await controller.restartBot(botId);
  assert.equal(idle.testMessage, undefined);
});

test('two accounts cannot share one listener port', async (t) => {
  const { controller } = await setup();
  t.after(() => controller.close());
  await controller.addBot({ selfId: SELF_ID, port: 6830 });
  await assert.rejects(
    () => controller.addBot({ selfId: '2058282593', port: 6830 }),
    (error) => error.code === 'onebot-port-in-use' && /6830/.test(error.message),
  );
  // Moving the first account onto a free port is allowed.
  const [first] = controller.status().bots;
  const moved = await controller.setSettings(first.botId, { port: 6831 });
  assert.equal(moved.bots.find(bot => bot.botId === first.botId).port, 6831);
});

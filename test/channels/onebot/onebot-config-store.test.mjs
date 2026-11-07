import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  deriveOneBotBotIdentity,
  maskOneBotSelfId,
  normalizeOneBotSettings,
  OneBotConfigStore,
  ONEBOT_DEFAULT_PATH,
  ONEBOT_DEFAULT_PORT,
} from '../../../src/channels/onebot/onebot-config-store.mjs';

async function store() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-onebot-config-'));
  const path = join(root, 'onebot.json');
  const instance = new OneBotConfigStore(path);
  await instance.load();
  return { instance, path };
}

test('identity derives from the QQ number and never leaks it', () => {
  const identity = deriveOneBotBotIdentity('2951316926');
  assert.match(identity.botId, /^onebot_[a-f0-9]{24}$/);
  assert.match(identity.accessTokenRef, /^DSH_ONEBOT_ACCESS_TOKEN_[A-F0-9]{24}$/);
  assert.equal(deriveOneBotBotIdentity('2951316926').botId, identity.botId);
  assert.equal(maskOneBotSelfId('2951316926'), '2951•••926');
});

test('settings fall back to loopback defaults', () => {
  assert.deepEqual(normalizeOneBotSettings({}), {
    host: '127.0.0.1',
    port: ONEBOT_DEFAULT_PORT,
    path: ONEBOT_DEFAULT_PATH,
    imageSendFormat: 'auto',
    selfIds: [],
  });
  assert.equal(normalizeOneBotSettings({ port: 99999 }).port, ONEBOT_DEFAULT_PORT);
  assert.equal(normalizeOneBotSettings({ port: 7000 }).port, 7000);
  assert.equal(normalizeOneBotSettings({ path: 'onebot' }).path, '/onebot');
  assert.equal(normalizeOneBotSettings({ imageSendFormat: 'nope' }).imageSendFormat, 'auto');
  assert.equal(normalizeOneBotSettings({ imageSendFormat: 'url' }).imageSendFormat, 'url');
});

test('saving a bot writes a 0600 document and keeps the token out of it', async () => {
  const { instance, path } = await store();
  const saved = await instance.save({ selfId: '2951316926', port: 6800 });
  assert.equal(saved.selfId, '2951316926');
  assert.equal(saved.port, 6800);
  const document = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(document.version, 1);
  assert.equal(document.bots.length, 1);
  assert.ok(JSON.stringify(document).includes('DSH_ONEBOT_ACCESS_TOKEN_'));
  assert.ok(!JSON.stringify(document).includes('secret'), 'no secret material in the document');
});

test('a saved bot reloads with the same identity', async () => {
  const { instance, path } = await store();
  await instance.save({ selfId: '2951316926', name: 'VC酱2号机' });
  const reopened = await new OneBotConfigStore(path).load();
  const bot = reopened.getByPlatformId('2951316926');
  assert.equal(bot.name, 'VC酱2号机');
  assert.equal(bot.path, ONEBOT_DEFAULT_PATH);
});

test('update patches one field and keeps the rest', async () => {
  const { instance } = await store();
  const saved = await instance.save({ selfId: '2951316926', port: 6700, name: 'a' });
  const patched = await instance.update(saved.botId, { port: 6701 });
  assert.equal(patched.port, 6701);
  assert.equal(patched.name, 'a');
  assert.equal(instance.list().length, 1);
});

test('group reply rules survive a save and reload with the mention default', async () => {
  const { instance, path } = await store();
  const saved = await instance.save({ selfId: '2951316926' });
  // A fresh bot answers to mentions only, exactly like before this setting existed.
  assert.deepEqual(saved.groupTriggers.defaults, { mode: 'mention', senders: [] });

  const rules = {
    version: 1,
    defaults: { mode: 'mention', senders: [] },
    groups: { 904897306: { mode: 'all', senders: ['2058282593'] } },
    hiddenGroupIds: [],
  };
  await instance.update(saved.botId, { groupTriggers: rules });
  const reopened = await new OneBotConfigStore(path).load();
  const bot = reopened.getByPlatformId('2951316926');
  assert.equal(bot.groupTriggers.groups['904897306'].mode, 'all');
  assert.deepEqual(bot.groupTriggers.groups['904897306'].senders, ['2058282593']);
  // Updating an unrelated field must not drop the rules.
  const patched = await instance.update(saved.botId, { port: 6702 });
  assert.equal(patched.groupTriggers.groups['904897306'].mode, 'all');
});

test('remove reports whether anything changed', async () => {
  const { instance } = await store();
  const saved = await instance.save({ selfId: '2951316926' });
  assert.equal(await instance.remove('onebot_000000000000000000000000'), false);
  assert.equal(await instance.remove(saved.botId), true);
  assert.equal(instance.list().length, 0);
});

test('a damaged document is an error, not a silent empty config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-onebot-config-'));
  const path = join(root, 'onebot.json');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, JSON.stringify({ version: 1, bots: 'nope' }), 'utf8');
  await assert.rejects(() => new OneBotConfigStore(path).load(), /invalid bot data/);
});

test('a missing document is an empty config', async () => {
  const { instance } = await store();
  assert.deepEqual(instance.list(), []);
});

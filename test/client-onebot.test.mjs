import test from 'node:test';
import assert from 'node:assert/strict';

import { toTokenBotShape } from '../plugin-src/client/channels/onebot/api.js';

test('a saved alias survives the OneBot status adapter', async () => {
  // The host puts the alias in bot.name (see withBotAlias); the live nickname must
  // not win over it, or the settings card would show the nickname again.
  const shaped = toTokenBotShape({
    bots: [{
      botId: 'onebot_1',
      selfId: '2951316926',
      name: 'QQ 2951•••926',
      nickname: 'VC酱2号机',
      bot: { name: 'a' },
      ready: true,
    }],
  });
  assert.equal(shaped.bots[0].bot.name, 'a');
  assert.equal(shaped.bots[0].connected, true);
  assert.equal(shaped.bots[0].bot.idMasked, '2951•••926');
});

test('without an alias the nickname is used', async () => {
  const shaped = toTokenBotShape({
    bots: [{ botId: 'onebot_1', selfId: '2951316926', nickname: 'VC酱2号机', ready: false }],
  });
  assert.equal(shaped.bots[0].bot.name, 'VC酱2号机');
  assert.equal(shaped.bots[0].state, 'offline');
});

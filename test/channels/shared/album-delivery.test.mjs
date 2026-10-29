import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  OUTBOUND_ARTIFACT_TOOL,
  OutboundArtifactRegistry,
  createOutboundArtifactTool,
} from '../../../src/channels/shared/semantic/artifact.mjs';
import { deliverOutboundArtifacts } from '../../../src/channels/shared/semantic/artifact-delivery.mjs';

let fixtureId = 0;

async function committedArtifact(t, fileName, content) {
  fixtureId += 1;
  const suffix = String(fixtureId);
  const workspace = await mkdtemp(join(tmpdir(), `dsh-im-album-${suffix}-`));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const registry = new OutboundArtifactRegistry({ uuid: () => `artifact-${suffix}` });
  t.after(() => registry.clear());
  const sessionId = `session-${suffix}`;
  const agent = {
    session: {
      header: { id: sessionId, cwd: workspace },
      events: [
        { type: 'turn/start', data: { turn: 1 } },
        { type: 'user/message', data: { turn: 1, source: { rpcId: `rpc-${suffix}` } } },
      ],
    },
  };
  t.after(registry.openConsumer(sessionId, `rpc-${suffix}`));
  for (const event of agent.session.events) {
    registry.observeSessionEvent(agent.session, event);
  }
  await writeFile(join(workspace, fileName), content);
  const tool = createOutboundArtifactTool({ registry });
  const execution = {
    name: OUTBOUND_ARTIFACT_TOOL,
    callId: `call-${suffix}`,
    rootCallId: `call-${suffix}`,
    token: Symbol(`call-${suffix}`),
    agent,
  };
  await tool.definition.execute({ path: fileName }, execution);
  tool.onResult(execution, { isError: false });
  return registry.take(sessionId, 1)[0];
}

const IMAGE = Buffer.from('89504e470d0a1a0a', 'hex');

test('two consecutive images go out as one album', async (t) => {
  const groups = [];
  const singles = [];
  const delivery = await deliverOutboundArtifacts({
    artifacts: [
      await committedArtifact(t, 'a.png', IMAGE),
      await committedArtifact(t, 'b.png', IMAGE),
    ],
    deliveryId: 'reply-1',
    channelKey: 'telegram',
    sendImage: async (file) => {
      singles.push(file.fileName);
      return ['single'];
    },
    sendImageGroup: async (files) => {
      groups.push(files.map((file) => file.fileName));
      return ['album-1'];
    },
    sendFile: async () => ['file'],
  });
  assert.deepEqual(groups, [['a.png', 'b.png']]);
  assert.deepEqual(singles, []);
  assert.equal(delivery.artifactsSent, 2);
});

test('a single image still uses the plain photo send', async (t) => {
  const groups = [];
  const singles = [];
  await deliverOutboundArtifacts({
    artifacts: [await committedArtifact(t, 'a.png', IMAGE)],
    deliveryId: 'reply-2',
    channelKey: 'telegram',
    sendImage: async (file) => {
      singles.push(file.fileName);
      return ['single'];
    },
    sendImageGroup: async (files) => {
      groups.push(files.length);
      return ['album'];
    },
    sendFile: async () => ['file'],
  });
  assert.deepEqual(singles, ['a.png']);
  assert.deepEqual(groups, []);
});

test('a non-image artifact breaks the album run', async (t) => {
  const groups = [];
  const singles = [];
  const files = [];
  await deliverOutboundArtifacts({
    artifacts: [
      await committedArtifact(t, 'a.png', IMAGE),
      await committedArtifact(t, 'doc.txt', 'plain text'),
      await committedArtifact(t, 'b.png', IMAGE),
      await committedArtifact(t, 'c.png', IMAGE),
    ],
    deliveryId: 'reply-3',
    channelKey: 'telegram',
    sendImage: async (file) => {
      singles.push(file.fileName);
      return ['single'];
    },
    sendImageGroup: async (batch) => {
      groups.push(batch.map((file) => file.fileName));
      return ['album'];
    },
    sendFile: async (file) => {
      files.push(file.fileName);
      return ['file'];
    },
  });
  assert.deepEqual(groups, [['b.png', 'c.png']]);
  assert.deepEqual(singles, ['a.png']);
  assert.deepEqual(files, ['doc.txt']);
});

test('an album failure falls back to single photo sends', async (t) => {
  const singles = [];
  let attempts = 0;
  const delivery = await deliverOutboundArtifacts({
    artifacts: [
      await committedArtifact(t, 'a.png', IMAGE),
      await committedArtifact(t, 'b.png', IMAGE),
    ],
    deliveryId: 'reply-4',
    channelKey: 'telegram',
    sendImage: async (file) => {
      singles.push(file.fileName);
      return ['single'];
    },
    sendImageGroup: async () => {
      attempts += 1;
      const error = new Error('album rejected');
      error.code = 'telegram-provider-error';
      throw error;
    },
    sendFile: async () => ['file'],
  });
  assert.equal(attempts, 1);
  assert.deepEqual(singles, ['a.png', 'b.png']);
  assert.equal(delivery.artifactsSent, 2);
});

test('eleven images are split into ten plus a single', async (t) => {
  const groups = [];
  const singles = [];
  const artifacts = [];
  for (let index = 0; index < 11; index += 1) {
    artifacts.push(await committedArtifact(t, `p${index}.png`, IMAGE));
  }
  await deliverOutboundArtifacts({
    artifacts,
    deliveryId: 'reply-5',
    channelKey: 'telegram',
    sendImage: async (file) => {
      singles.push(file.fileName);
      return ['single'];
    },
    sendImageGroup: async (files) => {
      groups.push(files.length);
      return ['album'];
    },
    sendFile: async () => ['file'],
  });
  assert.deepEqual(groups, [10]);
  assert.deepEqual(singles, ['p10.png']);
});

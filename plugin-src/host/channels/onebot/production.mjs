/**
 * Production wiring for the OneBot channel.
 *
 * One Harness client, one conversation-state store per QQ account, one
 * controller holding a reverse-WS listener per account. No workspace store, no
 * delivery targets, no command executor: this first version keeps the shared bot
 * plumbing at its defaults, so a bot in OneBot behaves like any other channel
 * except that it never dials out.
 */
import { resolve } from 'node:path';

import { OneBotConfigStore } from '../../../../src/channels/onebot/onebot-config-store.mjs';
import { OneBotController } from '../../../../src/channels/onebot/onebot-controller.mjs';
import { OneBotHarnessClient } from '../../../../src/channels/onebot/onebot-harness-client.mjs';
import { OneBotStateStore } from '../../../../src/channels/onebot/onebot-state-store.mjs';
import { OneBotRuntime } from '../../../../src/channels/onebot/onebot-runtime.mjs';
import { prepareBotWorkspace } from '../../../../src/channels/shared/default-workspace.mjs';
import { harnessConnection } from '../../harness-connection.mjs';
import { pluginPaths } from '../shared/production.mjs';

export async function createProductionController(ctx, config = {}, internals = {}) {
  const ConfigStore = internals.ConfigStore ?? OneBotConfigStore;
  const StateStore = internals.StateStore ?? OneBotStateStore;
  const HarnessClient = internals.HarnessClient ?? OneBotHarnessClient;
  const Controller = internals.Controller ?? OneBotController;
  const Runtime = internals.Runtime ?? OneBotRuntime;
  const logger = typeof ctx?.logger === 'function' ? ctx.logger('dsh-im:onebot') : (ctx?.logger ?? console);

  const paths = pluginPaths(config, 'onebot');
  const configStore = await new ConfigStore(paths.config).load();
  const { defaultWorkspace, ungroupedWorkspace } = await prepareBotWorkspace(config);
  const connection = harnessConnection(ctx, config, { competitiveApprovals: false });
  const harness = new HarnessClient({
    ...connection,
    workspace: defaultWorkspace,
    ungroupedWorkspace,
    autostart: false,
    dshBin: config.dshBin ?? 'dsh',
  });

  const stateStores = new Map();
  const stateFor = async (botId) => {
    const existing = stateStores.get(botId);
    if (existing !== undefined) return existing;
    const store = await new StateStore(resolve(paths.bots, botId, 'state.json')).load();
    stateStores.set(botId, store);
    return store;
  };

  const controller = new Controller({
    credentials: ctx?.credentials ?? null,
    configStore,
    harness,
    stateFor,
    logger,
    createRuntime: (options) => new Runtime(options),
    replyTimeoutMs: config.replyTimeoutMs ?? 600_000,
  });
  await controller.initialize();
  return {
    controller,
    close: () => controller.close(),
  };
}

/**
 * Production wiring for the OneBot channel.
 *
 * One Harness client, one conversation-state store and one workspace record per
 * QQ account, one controller holding a reverse-WS listener per account. The
 * workspace store is what gives every bot its own working directory, like the
 * other channels: `createBotWorkspaceScope` rebinds the harness and state for a
 * bot, and `createWorkspaceAwareController` exposes the settings calls on top of
 * the plain controller.
 */
import { resolve } from 'node:path';

import { OneBotConfigStore } from '../../../../src/channels/onebot/onebot-config-store.mjs';
import { OneBotController } from '../../../../src/channels/onebot/onebot-controller.mjs';
import { OneBotHarnessClient } from '../../../../src/channels/onebot/onebot-harness-client.mjs';
import { OneBotStateStore } from '../../../../src/channels/onebot/onebot-state-store.mjs';
import { OneBotRuntime } from '../../../../src/channels/onebot/onebot-runtime.mjs';
import { listAgentPresetCatalog } from '../../../../src/channels/shared/agent-preset.mjs';
import { listModelCatalog } from '../../../../src/channels/shared/model-setting.mjs';
import {
  BotWorkspaceStore,
  createBotWorkspaceScope,
  createWorkspaceAwareController,
  observeBotWorkspaceRemovals,
} from '../../../../src/channels/shared/bot-workspace-store.mjs';
import { prepareBotWorkspace } from '../../../../src/channels/shared/default-workspace.mjs';
import { harnessConnection } from '../../harness-connection.mjs';
import { initialAccessPolicyFor } from '../shared/access-policy-production.mjs';
import { pluginPaths } from '../shared/production.mjs';

const CHANNEL = 'onebot';

export async function createProductionController(ctx, config = {}, internals = {}) {
  const ConfigStore = internals.ConfigStore ?? OneBotConfigStore;
  const StateStore = internals.StateStore ?? OneBotStateStore;
  const HarnessClient = internals.HarnessClient ?? OneBotHarnessClient;
  const Controller = internals.Controller ?? OneBotController;
  const Runtime = internals.Runtime ?? OneBotRuntime;
  const WorkspaceStore = internals.WorkspaceStore ?? BotWorkspaceStore;
  const logger = typeof ctx?.logger === 'function' ? ctx.logger('dsh-im:onebot') : (ctx?.logger ?? console);
  const agentPresetCatalog = () => listAgentPresetCatalog(ctx);

  const paths = pluginPaths(config, CHANNEL);
  const configStore = await new ConfigStore(paths.config).load();
  const { defaultWorkspace, ungroupedWorkspace } = await prepareBotWorkspace(config);
  const workspaces = internals.workspaces
    ?? await new WorkspaceStore(paths.workspaces, {
      defaultWorkspace,
      ungroupedWorkspace,
      groupByAgentPreset: config.groupByAgentPreset,
    }).load();

  const configuredBots = configStore.list();
  await workspaces.reconcile?.(configuredBots.map(bot => bot.botId));
  await Promise.all(configuredBots.map(bot => workspaces.ensure(bot.botId, {
    defaultAgentPreset: config.agentPreset,
    initialAccessPolicy: initialAccessPolicyFor(CHANNEL, bot),
  })));
  // A bot removed from the config must lose its workspace record in the same
  // step, or a later save with the same QQ number inherits stale settings.
  const observedConfigStore = typeof configStore.remove === 'function'
    ? observeBotWorkspaceRemovals(configStore, { workspaces })
    : configStore;

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

  const coreController = new Controller({
    credentials: ctx?.credentials ?? null,
    configStore: observedConfigStore,
    harness,
    stateFor,
    logger,
    createRuntime: async (options) => {
      const botId = options.config.botId;
      await workspaces.ensure(botId, {
        defaultAgentPreset: config.agentPreset,
        initialAccessPolicy: initialAccessPolicyFor(CHANNEL, options.config),
      });
      const workspaceScope = createBotWorkspaceScope(harness, {
        botId,
        workspaces,
        state: options.state,
        agentPresetCatalog,
      });
      return new Runtime({
        ...options,
        harness: workspaceScope.harness,
        state: workspaceScope.state,
      });
    },
    replyTimeoutMs: config.replyTimeoutMs ?? 600_000,
  });

  const controller = createWorkspaceAwareController(coreController, {
    harness,
    workspaces,
    stateFor,
    agentPresetCatalog,
    // Without a model catalog the settings panel renders an empty model list.
    modelCatalog: options => listModelCatalog(harness, options),
  });
  await controller.initialize();
  return {
    controller,
    close: () => controller.close(),
  };
}

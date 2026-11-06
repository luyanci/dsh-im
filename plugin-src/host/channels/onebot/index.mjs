import { createProductionController } from './production.mjs';
import { createOneBotRpcHandler, installOneBotRpc, ONEBOT_RPC_CHANNEL } from './rpc.mjs';
import { installProductionChannel } from '../shared/startup.mjs';

export const name = 'dsh-im-onebot-host';
export const inject = ['connection', 'credentials', 'typertGateway'];

export async function apply(ctx, config = {}) {
  if (config?.controller) return installOneBotRpc(ctx, config.controller, config.rpcAuthority);
  return installProductionChannel(ctx, config, {
    channel: 'onebot',
    rpcChannel: ONEBOT_RPC_CHANNEL,
    createProduction: () => createProductionController(ctx, config, config.internals ?? {}),
    createHandler: controller => createOneBotRpcHandler(controller),
  });
}

export function createOneBotHostPlugin(config) {
  return Object.freeze({ name, inject, apply: (ctx) => apply(ctx, config) });
}

export { createProductionController } from './production.mjs';
export {
  ONEBOT_ENDPOINTS,
  ONEBOT_RPC_CHANNEL,
  ONEBOT_RPC_ENDPOINTS,
  createOneBotRpcHandler,
  installOneBotRpc,
} from './rpc.mjs';
export { OneBotController } from '../../../../src/channels/onebot/onebot-controller.mjs';
export { OneBotRuntime } from '../../../../src/channels/onebot/onebot-runtime.mjs';

/** Client-side RPC surface for the OneBot channel (see host rpc.mjs). */
export const ONEBOT_RPC_CHANNEL = '/onebot';

export const ONEBOT_ENDPOINTS = Object.freeze({
  // Shared management names for the generic calls; the two OneBot-specific ones
  // carry the listener settings no other channel has.
  status: 'connection.status',
  deleteBot: 'bot.delete',
  restartBot: 'bot.reconnect',
  addBot: 'onebot.add-bot',
  setSettings: 'onebot.set-settings',
  setWorkspace: 'bot.workspace.set',
  setModel: 'bot.model.set',
  setAgentPreset: 'bot.agent-preset.set',
  setAccessPolicy: 'bot.access-policy.set',
  setAlias: 'bot.alias.set',
});

/** Unwrap the `{ ok, value }` envelope the management RPC returns. */
export function unwrapRpcResult(result) {
  if (result && result.ok === false) {
    const error = new Error(result.error?.message ?? 'OneBot 操作失败');
    error.code = result.error?.code;
    error.details = result.error?.details ?? {};
    throw error;
  }
  return result?.value ?? result;
}

/** Coerce a status payload into the shape the panel renders. */
export function normalizeSnapshot(value) {
  const bots = Array.isArray(value?.bots) ? value.bots : [];
  return {
    revision: Number.isSafeInteger(value?.revision) ? value.revision : 0,
    ready: value?.ready === true,
    bots: bots.map((bot) => ({
      botId: String(bot.botId ?? ''),
      selfId: String(bot.selfId ?? ''),
      name: typeof bot.name === 'string' && bot.name ? bot.name : String(bot.selfId ?? ''),
      host: String(bot.host ?? '127.0.0.1'),
      port: Number(bot.port ?? 0),
      path: String(bot.path ?? '/onebot/v11/ws'),
      imageSendFormat: String(bot.imageSendFormat ?? 'auto'),
      listening: bot.listening === true,
      connected: bot.ready === true,
      connectionState: String(bot.connectionState ?? 'idle'),
      nickname: typeof bot.nickname === 'string' ? bot.nickname : null,
      error: bot.error?.message ?? null,
      // Decorated by the workspace-aware controller; the settings rows read these.
      workspace: typeof bot.workspace === 'string' && bot.workspace ? bot.workspace : null,
      alias: typeof bot.alias === 'string' ? bot.alias : null,
      model: bot.model ?? null,
      agentPreset: bot.agentPreset ?? null,
      accessPolicy: bot.accessPolicy ?? null,
    })),
  };
}

/** Turn any thrown value into something worth showing under a form. */
export function presentError(error) {
  if (!error) return null;
  return {
    code: error.code ?? 'onebot-error',
    message: error.message ?? String(error),
  };
}

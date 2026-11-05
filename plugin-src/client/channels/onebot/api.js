/**
 * Client-side RPC surface for the OneBot channel.
 *
 * The shared token-channel machinery drives the page, so this module only has to
 * adapt OneBot's status payload into the shape it expects and keep the two
 * OneBot-specific endpoints next to the shared ones.
 */
import { localizeText } from '../../i18n.js';
import { TOKEN_BOT_ENDPOINTS, createTokenChannelApi } from '../shared/token-api.js';

export const ONEBOT_RPC_CHANNEL = '/onebot';

export const ONEBOT_ENDPOINTS = Object.freeze({
  ...TOKEN_BOT_ENDPOINTS,
  // Adding an account replaces the token flow: the QQ number and the listener
  // settings are what the protocol end needs, not a platform token.
  bindCredentials: 'onebot.add-bot',
  addBot: 'onebot.add-bot',
  setSettings: 'onebot.set-settings',
});

export function maskSelfId(selfId) {
  const value = String(selfId ?? '');
  return value.length > 6 ? `${value.slice(0, 4)}•••${value.slice(-3)}` : value;
}

const base = createTokenChannelApi('OneBot', ' OneBot 反向 WebSocket');

/**
 * OneBot reports `ready` (a live protocol-end connection) where the shared
 * adapter expects `connected`/`state`, and has no platform username.
 */
export function toTokenBotShape(value) {
  const bots = Array.isArray(value?.bots) ? value.bots : [];
  return {
    ...value,
    bots: bots.map((bot) => {
      const connected = bot?.ready === true;
      return {
        ...bot,
        connected,
        state: connected ? 'connected' : bot?.connectionState === 'listening' ? 'connecting' : 'offline',
        bot: {
          ...(bot?.bot ?? {}),
          name: bot?.nickname ?? bot?.name ?? localizeText('OneBot 账号'),
          username: '',
          idMasked: maskSelfId(bot?.selfId),
        },
      };
    }),
  };
}

export const unwrapRpcResult = base.unwrapRpcResult;
export const presentError = base.presentError;

export function normalizeSnapshot(value) {
  return base.normalizeSnapshot(toTokenBotShape(value));
}

export const onebotClientApi = Object.freeze({
  unwrapRpcResult,
  normalizeSnapshot,
  presentError,
});

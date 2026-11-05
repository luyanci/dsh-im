/**
 * The bot client the shared text bridge drives.
 *
 * The bridge calls `sendText(target, text)` for every answer, `sendDelivery`
 * when it has a rendered block, `sendImage`/`sendFile` for artifacts and
 * `sendTyping` for the "typing…" hint. Everything else (cards, stickers,
 * streams) is optional: the bridge checks `typeof … === 'function'`, so leaving
 * them off is how this channel opts out of progress presentation.
 *
 * Channel policy (`docs/onebot-channel.md` §6.1): a turn produces no placeholder
 * and no progress messages — the final answer is simply one or more ordinary
 * messages. QQ has no message editing and no recall here, so there is nothing to
 * update or delete afterwards.
 */
import { readFile } from 'node:fs/promises';

import { imageSegment, textSegment } from './onebot-api.mjs';

/**
 * QQ clients render long text as a wall; splitting keeps each message readable
 * and mirrors the "several ordinary messages" presentation. The split prefers a
 * newline, then a space, then a hard cut.
 */
export const ONEBOT_TEXT_CHUNK = 1500;

export function splitOneBotText(text, limit = ONEBOT_TEXT_CHUNK) {
  const source = typeof text === 'string' ? text : String(text ?? '');
  if (source.length === 0) return [];
  if (source.length <= limit) return [source];
  const chunks = [];
  let remaining = source;
  while (remaining.length > limit) {
    const window = remaining.slice(0, limit);
    const newline = window.lastIndexOf('\n');
    const space = window.lastIndexOf(' ');
    const cut = newline > limit / 2 ? newline : space > limit / 2 ? space : limit;
    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).replace(/^\s+/, '');
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

/** Encode bytes as the `base64://` payload OneBot implementations accept. */
export function base64ImageFile(data) {
  return `base64://${Buffer.isBuffer(data) ? data.toString('base64') : Buffer.from(data).toString('base64')}`;
}

function targetKind(target) {
  if (target?.groupId !== undefined) return 'group';
  if (target?.userId !== undefined) return 'user';
  return null;
}

function textOfDelivery(delivery) {
  if (typeof delivery === 'string') return delivery;
  if (typeof delivery?.text === 'string') return delivery.text;
  if (typeof delivery?.markdown === 'string') return delivery.markdown;
  return '';
}

export function createOneBotBotClient({
  api,
  getApi,
  logger,
  format = 'auto',
  chunkLimit = ONEBOT_TEXT_CHUNK,
  readFileImpl = readFile,
} = {}) {
  // The session only exists after the protocol end connects, so the client is
  // built first and resolves the api per call.
  const resolveApi = typeof getApi === 'function'
    ? getApi
    : () => api;
  if (typeof getApi !== 'function'
    && (typeof api?.sendGroupMsg !== 'function' || typeof api?.sendPrivateMsg !== 'function')) {
    throw new TypeError('createOneBotBotClient needs an api or a getApi function');
  }
  // `auto` remembers which form worked so the retries happen once, not per image.
  let resolvedFormat = format === 'auto' ? null : format;

  function currentApi() {
    const resolved = resolveApi();
    if (resolved === undefined || resolved === null) {
      throw new Error('OneBot protocol end is not connected');
    }
    return resolved;
  }

  async function send(target, message) {
    const kind = targetKind(target);
    const client = currentApi();
    if (kind === 'group') return client.sendGroupMsg(target.groupId, message);
    if (kind === 'user') return client.sendPrivateMsg(target.userId, message);
    throw new Error('OneBot target must carry groupId or userId');
  }

  async function sendText(target, text) {
    const chunks = splitOneBotText(text, chunkLimit);
    let last;
    for (const chunk of chunks) {
      last = await send(target, [textSegment(chunk)]);
    }
    return last;
  }

  /**
   * Send one image artifact. The artifact layer hands over
   * `{ bytes, fileName, mediaType }`; a `{ data }` buffer or `{ path }` is also
   * accepted so a caller (and the tests) can pass bytes directly.
   */
  async function sendImage(target, file) {
    const bytes = Buffer.isBuffer(file?.bytes) ? file.bytes
      : typeof file?.data !== 'undefined' ? file.data
        : file?.path ? await readFileImpl(file.path) : undefined;
    if (bytes === undefined) {
      throw new Error('OneBot image delivery needs bytes, data or a path');
    }
    // §5: the accepted form depends on the protocol end, so try base64 first and
    // fall back to the http url when the artifact carries one.
    const attempts = resolvedFormat === null ? ['base64', 'url'] : [resolvedFormat];
    let lastError;
    for (const attempt of attempts) {
      try {
        const handle = attempt === 'url'
          ? file?.url
          : base64ImageFile(bytes);
        if (typeof handle !== 'string' || handle.length === 0) throw new Error(`image form ${attempt} needs a url`);
        const result = await send(target, [imageSegment(handle)]);
        resolvedFormat = attempt;
        return result;
      } catch (error) {
        lastError = error;
        logger?.warn?.(`OneBot image send failed as ${attempt}: ${error?.message ?? error}`);
      }
    }
    throw lastError ?? new Error('OneBot image delivery failed');
  }

  return {
    /** No typing indicator exists on QQ; the bridge treats this as optional. */
    sendTyping: undefined,

    sendText,

    /** Markdown blocks degrade to their text: QQ receives plain text only. */
    async sendDelivery(target, delivery) {
      return sendText(target, textOfDelivery(delivery));
    },

    sendImage,

    /** Exposed for the runtime's own attachment handling and for tests. */
    send,
  };
}

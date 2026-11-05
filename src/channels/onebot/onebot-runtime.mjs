/**
 * Turn OneBot v11 events into the semantic message the shared bridge consumes.
 *
 * Shape mirrors `normalizeTelegramUpdate` on purpose: the bridge, the group
 * archive and the reply reference layer all read the same fields, so a channel
 * only has to fill them in.
 *
 * Measured facts this encodes (`docs/onebot-channel.md` §2.1):
 *   - `message_id` signs are unstable, so ids are opaque strings;
 *   - `at` carries `data.qq` as a string;
 *   - `reply` carries only `data.id`; resolving it needs a `get_msg` call, which
 *     the caller does when it resolves `replyTo`;
 *   - an `image` segment has a bare resource name in `data.file` and the bytes
 *     behind `data.url`, so the image is downloaded lazily on demand.
 */
import { groupTriggerAddressed } from '../telegram/group-triggers.mjs';

/** Raised when the protocol end sends a shape the first version does not parse. */
export class OneBotFormatError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'OneBotFormatError';
    this.code = code;
  }
}

const MEDIA_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

function mediaTypeOf(name) {
  const extension = String(name ?? '').split('?')[0].split('.').pop()?.toLowerCase();
  return MEDIA_TYPES[extension] ?? 'image/jpeg';
}

function isSelfEcho(event, selfId) {
  if (event?.post_type === 'message_sent') return true;
  const sender = event?.sender?.user_id ?? event?.user_id;
  return selfId !== undefined && sender !== undefined && String(sender) === String(selfId);
}

/**
 * Lazy image source: `load()` downloads the bytes from the signed url the event
 * carries. The url expires, so it is never stored beyond the closure.
 */
export function oneBotImageSource(segment, { loadImage } = {}) {
  const data = segment?.data ?? {};
  const url = typeof data.url === 'string' && data.url.length > 0 ? data.url : undefined;
  const file = typeof data.file === 'string' && data.file.length > 0 ? data.file : undefined;
  if (url === undefined && file === undefined) return null;
  const name = file ?? `onebot-image-${Date.now()}`;
  return {
    name,
    mediaType: mediaTypeOf(name),
    size: undefined,
    load: (options) => {
      if (url === undefined) throw new Error('OneBot image segment carries no download url');
      if (typeof loadImage !== 'function') throw new Error('OneBot image downloader is unavailable');
      return loadImage(url, options);
    },
  };
}

function renderSegment(segment, { selfId }) {
  const type = segment?.type;
  const data = segment?.data ?? {};
  switch (type) {
    case 'text':
      return { text: String(data.text ?? '') };
    case 'at': {
      const qq = String(data.qq ?? '');
      if (qq === String(selfId)) return { text: '', tagged: true };
      const name = typeof data.name === 'string' && data.name.length > 0 ? data.name : qq;
      return { text: `@${name}` };
    }
    case 'reply':
      return { text: '', replyToId: String(data.id ?? '') };
    case 'image':
      return { image: segment };
    case 'face':
      return { text: '[表情]' };
    case 'mface': {
      const summary = String(data.summary ?? '').trim();
      return { text: summary.length > 0 ? `[表情 ${summary}]` : '[表情]' };
    }
    case 'forward':
      // Deferred: merged forwards are read through get_forward_msg later.
      return { text: '[合并转发]' };
    default:
      return { text: '' };
  }
}

/**
 * Normalize one event. Returns `null` for anything that is not a fresh inbound
 * message (meta events, notices, self echoes, malformed frames).
 */
export function normalizeOneBotEvent(event, {
  selfId,
  groupTriggers,
  loadImage,
} = {}) {
  if (event?.post_type !== 'message') return null;
  if (isSelfEcho(event, selfId)) return null;

  const messageType = event?.message_type;
  if (messageType !== 'group' && messageType !== 'private') return null;

  if (typeof event.message === 'string') {
    // The protocol end was configured with `messageFormat: string`. Parsing CQ
    // codes is a deferred item; refuse loudly instead of dropping silently.
    throw new OneBotFormatError(
      'OneBot message arrived as a CQ string; configure messageFormat: array',
      'string-message',
    );
  }
  if (!Array.isArray(event.message)) return null;

  const direct = messageType === 'private';
  const chatId = direct ? event.user_id : event.group_id;
  if (chatId === undefined || chatId === null) return null;
  const senderId = event.user_id ?? event.sender?.user_id;
  if (senderId === undefined || senderId === null) return null;
  const messageId = event.message_id;
  if (messageId === undefined || messageId === null) return null;

  let text = '';
  let tagged = false;
  let replyToId;
  const images = [];
  for (const segment of event.message) {
    const rendered = renderSegment(segment, { selfId });
    text += rendered.text ?? '';
    if (rendered.tagged === true) tagged = true;
    if (rendered.replyToId !== undefined) replyToId = rendered.replyToId;
    if (rendered.image !== undefined) {
      const source = oneBotImageSource(rendered.image, { loadImage });
      if (source !== null) images.push(source);
    }
  }

  const conversationId = String(chatId);
  const key = `${direct ? 'direct' : 'group'}:${conversationId}`;
  const addressed = direct || groupTriggerAddressed(groupTriggers, {
    chatId: String(chatId),
    senderId: String(senderId),
    tagged,
  });

  return {
    messageId: String(messageId),
    senderId: String(senderId),
    contextSource: () => ({
      senderName: event.sender?.card
        || event.sender?.nickname
        || `QQ ${senderId}`,
      senderUsername: undefined,
      conversationTitle: direct ? undefined : event.group_name ?? undefined,
      chatId: String(chatId),
      threadId: undefined,
    }),
    senderIsBot: false,
    senderRole: event.sender?.role ?? undefined,
    kind: direct ? 'direct' : 'group',
    conversationId,
    content: text,
    plainText: true,
    images,
    files: [],
    ...(replyToId === undefined ? {} : { replyTo: { messageId: replyToId } }),
    addressed,
    replyTarget: direct
      ? { userId: String(chatId) }
      : { groupId: String(chatId) },
    conversationKey: key,
  };
}

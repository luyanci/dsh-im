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
 * Lazy file source for documents, videos and voice: `load()` downloads the bytes
 * from the signed url the event carries. The url expires, so it is never stored
 * beyond the closure.
 */
export function oneBotFileSource(segment, { loadFile } = {}) {
  const data = segment?.data ?? {};
  const url = typeof data.url === 'string' && data.url.length > 0 ? data.url : undefined;
  if (url === undefined) return null;
  const declared = typeof data.file === 'string' && data.file.length > 0
    ? data.file
    : typeof data.name === 'string' && data.name.length > 0 ? data.name : undefined;
  const name = declared ?? `onebot-file-${Date.now()}`;
  const declaredMediaType = typeof data.mime_type === 'string' ? data.mime_type : undefined;
  return {
    name,
    ...(declaredMediaType ? { mediaType: declaredMediaType } : mediaTypeOf(name) ? { mediaType: mediaTypeOf(name) } : {}),
    size: Number.isFinite(Number(data.file_size)) ? Number(data.file_size) : undefined,
    load: (options) => {
      if (typeof loadFile !== 'function') throw new Error('OneBot file downloader is unavailable');
      return loadFile(url, options);
    },
  };
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
    case 'file':
    case 'video':
    case 'record':
      return { file: segment };
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

const QUOTED_MEDIA_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  amr: 'audio/amr',
  silk: 'audio/silk',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};

function quotedMediaType(name, fallback) {
  const extension = String(name).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return QUOTED_MEDIA_TYPES[extension] ?? fallback;
}

/**
 * A quoted image or file keeps its bytes behind `data.url`, a signed download
 * link. Returning a lazy source lets the normal inbound-file pipeline fetch and
 * stage it, so a quote of a photo reaches the model as a real attachment instead
 * of a bare filename.
 */
function quotedFileSource(name, data, fetchImpl, fallbackMediaType) {
  const url = typeof data.url === 'string' ? data.url.trim() : '';
  if (!url) return null;
  return {
    name,
    mediaType: quotedMediaType(name, fallbackMediaType),
    async load({ signal, maxBytes } = {}) {
      const response = await fetchImpl(url, { signal });
      if (!response.ok) {
        throw new Error(`quoted media download failed (HTTP ${response.status})`);
      }
      const length = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(length) && Number.isInteger(maxBytes) && maxBytes > 0 && length > maxBytes) {
        throw new Error(`quoted media is larger than ${maxBytes} bytes`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (Number.isInteger(maxBytes) && maxBytes > 0 && bytes.length > maxBytes) {
        throw new Error(`quoted media is larger than ${maxBytes} bytes`);
      }
      return bytes;
    },
  };
}

/**
 * Turn a `get_msg` result into the quoted reference shape the reply pipeline
 * expects. Returning `null` means the message is gone; an object with no text
 * and no attachments still carries the author, so the model at least knows who
 * was quoted.
 */
export function oneBotQuotedReference(quoted, { fetch: fetchImpl = globalThis.fetch } = {}) {
  if (quoted === null || quoted === undefined) return null;
  const sender = quoted.sender ?? {};
  const segments = Array.isArray(quoted.message) ? quoted.message : [];
  let content = '';
  const attachments = [];
  const files = [];
  for (const segment of segments) {
    const data = segment?.data ?? {};
    switch (segment?.type) {
      case 'text':
        content += String(data.text ?? '');
        break;
      case 'at': {
        const name = typeof data.name === 'string' && data.name ? data.name : String(data.qq ?? '');
        content += `@${name}`;
        break;
      }
      case 'face':
        content += '[表情]';
        break;
      case 'image': {
        const name = typeof data.file === 'string' && data.file ? data.file : 'image';
        attachments.push({ kind: 'image', name });
        const quotedFile = quotedFileSource(name, data, fetchImpl, 'image/jpeg');
        if (quotedFile !== null) files.push(quotedFile);
        break;
      }
      case 'file': {
        const name = typeof data.file === 'string' && data.file
          ? data.file
          : typeof data.name === 'string' && data.name ? data.name : 'file';
        attachments.push({ kind: 'file', name });
        const quotedFile = quotedFileSource(name, data, fetchImpl, 'application/octet-stream');
        if (quotedFile !== null) files.push(quotedFile);
        break;
      }
      case 'mface': {
        const summary = typeof data.summary === 'string' ? data.summary : '';
        content += summary ? `[表情 ${summary}]` : '[表情]';
        break;
      }
      case 'forward':
        attachments.push({ kind: 'other', name: 'forward' });
        break;
      default:
        break;
    }
  }
  const authorName = typeof sender.card === 'string' && sender.card
    ? sender.card
    : typeof sender.nickname === 'string' && sender.nickname ? sender.nickname : undefined;
  const authorId = sender.user_id === undefined || sender.user_id === null
    ? undefined : String(sender.user_id);
  return {
    ...(authorId === undefined ? {} : { authorId }),
    ...(authorName === undefined ? {} : { authorName }),
    ...(content.trim() ? { content: content.trim() } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(files.length > 0 ? { files } : {}),
    ...(!content.trim() && attachments.length === 0 ? { unavailableReason: 'unsupported' } : {}),
  };
}

/**
 * Normalize one event. Returns `null` for anything that is not a fresh inbound
 * message (meta events, notices, self echoes, malformed frames).
 *
 * `loadReply` resolves a quoted message id through `get_msg`; without it the
 * reference still carries the id, but the reply block would reach the model as
 * `not-delivered` because QQ sends no content with the `reply` segment.
 */
export function normalizeOneBotEvent(event, {
  selfId,
  groupTriggers,
  loadImage,
  loadFile,
  loadReply,
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
  const files = [];
  for (const segment of event.message) {
    const rendered = renderSegment(segment, { selfId });
    text += rendered.text ?? '';
    if (rendered.tagged === true) tagged = true;
    if (rendered.replyToId !== undefined) replyToId = rendered.replyToId;
    if (rendered.image !== undefined) {
      const source = oneBotImageSource(rendered.image, { loadImage });
      if (source !== null) images.push(source);
    }
    if (rendered.file !== undefined) {
      // A file without a signed url cannot be fetched; keep the mention so the
      // model still learns something arrived.
      const source = oneBotFileSource(rendered.file, { loadFile: loadFile ?? loadImage });
      if (source !== null) files.push(source);
      else if (rendered.file?.data?.file) text += `[文件 ${rendered.file.data.file}]`;
    }
  }

  // A document-only message still needs a prompt: the harness rejects a turn that
  // carries neither text nor images, so name the attachment.
  if (text.trim().length === 0 && images.length === 0 && files.length > 0) {
    text = `[文件 ${files.map(source => source.name).join('、')}]`;
  }

  const conversationId = String(chatId);
  const key = `${direct ? 'direct' : 'group'}:${conversationId}`;
  const senderName = event.sender?.card
    || event.sender?.nickname
    || `QQ ${senderId}`;
  // `sub_type: 'group'` marks a temporary session opened from a group.
  const temporaryGroupId = direct
    && event.sub_type === 'group'
    && event.group_id !== undefined && event.group_id !== null
    ? String(event.group_id)
    : undefined;
  const addressed = direct || groupTriggerAddressed(groupTriggers, {
    chatId: String(chatId),
    senderId: String(senderId),
    tagged,
  });

  return {
    messageId: String(messageId),
    senderId: String(senderId),
    chatId: String(chatId),
    contextSource: () => ({
      senderName: senderName,
      senderUsername: undefined,
      conversationTitle: direct ? undefined : event.group_name ?? undefined,
      chatId: String(chatId),
      threadId: undefined,
    }),
    senderIsBot: false,
    // Group prompts are prefixed with the speaker, so the model can tell who is
    // talking; without it every member reads as the same unnamed voice.
    speakerName: senderName,
    senderName: senderName,
    senderRole: event.sender?.role ?? undefined,
    kind: direct ? 'direct' : 'group',
    conversationId,
    content: text,
    plainText: true,
    images,
    files,
    // QQ sends only the quoted id, so the reply pipeline resolves the content
    // later through `load`; without a loader the block degrades to the id alone.
    ...(replyToId === undefined ? {} : {
      replyTo: typeof loadReply === 'function'
        ? { messageId: replyToId, load: options => loadReply(replyToId, options) }
        : { messageId: replyToId },
    }),
    addressed,
    // Whether the message carried an explicit @ on us; a quoted reply to our own
    // message counts as tagging too, which the runtime adds once it has resolved
    // the quote author.
    taggedAtSelf: tagged,
    // A private event with `sub_type: 'group'` is a temporary group session: the
    // reply goes through send_private_msg, but the origin group must travel with
    // it or the answer is filed as an ordinary DM.
    replyTarget: direct
      ? {
        userId: String(chatId),
        ...(temporaryGroupId === undefined ? {} : { temporaryGroupId }),
      }
      : { groupId: String(chatId) },
    conversationKey: key,
  };
}

/**
 * A group reply to the bot's own message is the QQ equivalent of Telegram's
 * "reply to the bot", which the shared trigger rules treat as tagging.
 */
export function oneBotAddressedForQuote(groupTriggers, { chatId, senderId }) {
  return groupTriggerAddressed(groupTriggers, {
    chatId: String(chatId),
    senderId: String(senderId),
    tagged: true,
  });
}

/**
 * OneBot v11 actions the channel actually needs.
 *
 * The channel receives and sends; it does not moderate. Group management
 * (`set_group_ban`, `set_group_kick`, `delete_msg`, member lookups) belongs to a
 * workspace-side caller — see `docs/onebot-channel.md` §7.1.
 *
 * Message payloads are built here as segment arrays, because the protocol end is
 * configured with `messageFormat: array` and never receives CQ strings.
 */

/** A plain text segment. */
export function textSegment(text) {
  return { type: 'text', data: { text: String(text) } };
}

/**
 * Download inbound media (images and files) from the signed url the protocol end
 * attaches. Returns `{ data, mediaType? }`, the shape the inbound pipelines read.
 */
export async function downloadOneBotMedia(url, {
  signal,
  maxBytes = 20 * 1024 * 1024,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new TypeError('OneBot media download needs an http(s) url');
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('No fetch implementation available');
  const response = await fetchImpl(url, { signal });
  if (!response.ok) throw new Error(`OneBot media download failed with HTTP ${response.status}`);
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`OneBot media is ${declared} bytes; the limit is ${maxBytes}`);
  }
  // Content-Length can be missing or wrong (chunked transfer), so the cap has to
  // be enforced while reading: buffering first would let a lying response exhaust
  // memory before the check runs.
  const body = response.body;
  let data;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new Error(`OneBot media exceeds ${maxBytes} bytes`);
        }
        chunks.push(Buffer.from(value));
      }
    } catch (error) {
      throw error;
    } finally {
      reader.releaseLock?.();
    }
    data = Buffer.concat(chunks, total);
  } else {
    data = Buffer.from(await response.arrayBuffer());
    if (data.length > maxBytes) {
      throw new Error(`OneBot media is ${data.length} bytes; the limit is ${maxBytes}`);
    }
  }
  const mediaType = response.headers?.get?.('content-type')?.split(';', 1)[0].trim();
  return { data, ...(mediaType ? { mediaType } : {}) };
}


/** An image segment. `file` is whatever the protocol end accepts; see §5. */
export function imageSegment(file) {
  return { type: 'image', data: { file: String(file) } };
}

/**
 * Wrap a session's `request()` in the handful of actions this channel uses.
 * Every method returns the action's `data` and throws on a failed retcode.
 */
export function createOneBotApi(session) {
  if (session === undefined || typeof session?.request !== 'function') {
    throw new Error('createOneBotApi needs a connected OneBot session');
  }
  return {
    /** `{ user_id, nickname }` of the logged-in account. */
    getLoginInfo: () => session.request('get_login_info'),

    /**
     * Send to a private chat; resolves `{ message_id }`. A group-temporary
     * session passes the originating `groupId` so the reply lands in that
     * session rather than a plain DM.
     */
    sendPrivateMsg: (userId, message, groupId) => session.request('send_private_msg', {
      user_id: Number(userId),
      message,
      ...(groupId === undefined || groupId === null || groupId === ''
        ? {} : { group_id: Number(groupId) }),
    }),

    /** Send to a group; resolves `{ message_id }`. */
    sendGroupMsg: (groupId, message) => session.request('send_group_msg', {
      group_id: Number(groupId),
      message,
    }),

    /**
     * Fetch one message by id. The reply segment carries only an id, so this is
     * how a quoted message is resolved into content and an author.
     */
    getMsg: (messageId) => session.request('get_msg', { message_id: Number(messageId) }),

    /**
     * Every group the account has joined, for the group-rules settings panel.
     * Shape varies by implementation, so the caller normalizes it.
     */
    getGroupList: () => session.request('get_group_list'),

    /**
     * Resolve a file a message pointed at but did not inline a url for.
     *
     * OneBot v11 `get_file` answers with `{ file, url?, base64?, file_size,
     * file_name }`. NapCat sends group/private file segments without `url`, so
     * callers hand its `file_id` (or `file`) here instead of guessing a path.
     */
    getFile: (params) => session.request('get_file', params),

    /**
     * NapCat resolves an image segment to bytes even when the signed url in the
     * event has expired: it answers with a local cached path, a base64 payload,
     * and the (possibly dead) url.
     */
    getImage: (params) => session.request('get_image', params),

    /**
     * NapCat extensions that turn a file id into a real http url (the standard
     * `get_file` answers with a staged local path). Both reject on protocol ends
     * that never implemented them, so callers fall back to `get_file`.
     */
    getPrivateFileUrl: (userId, fileId) => session.request('get_private_file_url', {
      user_id: Number(userId),
      file_id: fileId,
    }),

    getGroupFileUrl: (groupId, fileId, busid = 102) => session.request('get_group_file_url', {
      group_id: Number(groupId),
      file_id: fileId,
      busid,
    }),

    /**
     * Upload a file into a group. `file` accepts a path, an http url or a
     * `base64://` payload; `name` is what the group member sees.
     */
    uploadGroupFile: (groupId, file, name) => session.request('upload_group_file', {
      group_id: Number(groupId),
      file,
      name,
    }),

    /** Same for a private chat; SnowLuma implements both actions. */
    uploadPrivateFile: (userId, file, name) => session.request('upload_private_file', {
      user_id: Number(userId),
      file,
      name,
    }),
  };
}

/**
 * Send one text through whichever route the conversation needs.
 * `conversation` is `{ kind: 'direct', userId }` or `{ kind: 'group', groupId }`.
 */
export async function sendTextMessage(api, conversation, text) {
  const message = [textSegment(text)];
  if (conversation.kind === 'group') return api.sendGroupMsg(conversation.groupId, message);
  return api.sendPrivateMsg(conversation.userId, message);
}

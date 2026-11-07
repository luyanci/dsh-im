/**
 * What dsh-im does when a turn finishes successfully but produced no text.
 *
 * A model can end a turn after doing all its work through tools; the reader then
 * sees a progress bubble disappear and nothing else. `notice` keeps the Chat
 * honest with one short line ("本轮处理已结束，没有文本回复。"), `silent` lets the
 * turn end without a message. The value is stored per bot, next to the other
 * per-bot switches, and read from the shared bot settings document.
 */

export const EMPTY_ANSWER_MODES = Object.freeze(['notice', 'silent']);

/** Default keeps the behaviour every existing bot already has. */
export const DEFAULT_EMPTY_ANSWER_MODE = 'notice';

export const SET_EMPTY_ANSWER_MODE_ENDPOINT = 'bot.empty-answer.set';

export function normalizeEmptyAnswerMode(value) {
  return value === 'silent' ? 'silent' : DEFAULT_EMPTY_ANSWER_MODE;
}

export function validateEmptyAnswerMode(value) {
  if (!EMPTY_ANSWER_MODES.includes(value)) {
    throw new TypeError('Empty-answer mode must be notice or silent');
  }
  return value;
}

/** Only `silent` is worth storing; everything else is the default. */
export function isStoredEmptyAnswerMode(value) {
  return value === 'silent';
}

export function validEmptyAnswerPayload(payload) {
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    && Object.keys(payload).length === 2
    && typeof payload.botId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(payload.botId)
    && EMPTY_ANSWER_MODES.includes(payload.emptyAnswerMode);
}

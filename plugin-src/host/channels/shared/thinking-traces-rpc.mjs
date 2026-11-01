export const SET_THINKING_TRACES_ENDPOINT = 'bot.thinking-traces.set';
export const SET_FINAL_EDIT_ENDPOINT = 'bot.final-edit.set';

const BOT_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function validThinkingTracesPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Reflect.ownKeys(payload).length !== 2
    || !Object.hasOwn(payload, 'botId') || !Object.hasOwn(payload, 'thinkingTraces')
    || typeof payload.botId !== 'string'
    || !BOT_ID.test(payload.botId)
    || typeof payload.thinkingTraces !== 'boolean') return false;
  return true;
}

export function validFinalEditPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Reflect.ownKeys(payload).length !== 2
    || !Object.hasOwn(payload, 'botId') || !Object.hasOwn(payload, 'editFinalAnswer')
    || typeof payload.botId !== 'string'
    || !BOT_ID.test(payload.botId)
    || typeof payload.editFinalAnswer !== 'boolean') return false;
  return true;
}

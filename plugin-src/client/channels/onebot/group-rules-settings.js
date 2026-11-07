/**
 * Bot in groups: per-group reply rules for the OneBot (QQ) channel.
 *
 * Mirrors the Telegram panel — the rule set, the mode names and the wording are
 * the same — with two QQ differences: the group list comes from the protocol end
 * (`get_group_list`) instead of an archive, and a group is picked from that list
 * or typed as a number (QQ has no usernames or invite links to resolve).
 */
import * as React from 'react';

import { h } from '../../i18n.js';
import {
  GROUP_TRIGGER_MODE_OPTIONS,
  entryFromConfig,
  splitMemberIds,
} from '../telegram/group-triggers-settings.js';

export const ONEBOT_GROUP_RULES_ENDPOINTS = Object.freeze({
  get: 'onebot.group-rules.get',
  set: 'onebot.group-rules.set',
  list: 'onebot.group-rules.list',
});

const LIST_MODES = new Set(['mention-list', 'all-list']);

const NUMERIC_GROUP_ID = /^\d{5,20}$/;

function isListMode(mode) {
  return LIST_MODES.has(mode);
}

function unwrapRpcResult(result) {
  if (result?.ok === false) {
    const error = new Error(result.error?.message || '无法读取或保存群聊设置，请稍后重试。');
    error.code = result.error?.code;
    throw error;
  }
  return result?.ok === true ? result.value : result;
}

/** Host snapshot → editor state. */
export function stateFromSnapshot(value) {
  const source = value && typeof value === 'object' ? value : {};
  const groups = {};
  for (const [groupId, entry] of Object.entries(source.groups ?? {})) {
    groups[String(groupId)] = entryFromConfig(entry);
  }
  const seen = {};
  for (const entry of Array.isArray(source.seen) ? source.seen : []) {
    const chatId = typeof entry?.chatId === 'string' ? entry.chatId : '';
    if (!chatId) continue;
    seen[chatId] = { title: typeof entry.title === 'string' ? entry.title : null };
  }
  const available = [];
  for (const entry of Array.isArray(source.available) ? source.available : []) {
    const groupId = typeof entry?.groupId === 'string' ? entry.groupId : '';
    if (!groupId) continue;
    available.push({
      groupId,
      groupName: typeof entry.groupName === 'string' ? entry.groupName : null,
      memberCount: Number.isInteger(entry.memberCount) ? entry.memberCount : null,
    });
  }
  return { defaults: entryFromConfig(source.defaults), groups, seen, available, removed: [] };
}

function ModeField({ entry, onChange, disabled }) {
  return h('label', { className: 'dim-accessField' },
    h('span', null, '响应条件'),
    h('select', {
      value: entry.mode,
      disabled,
      onChange: (event) => onChange(event.target.value),
    }, GROUP_TRIGGER_MODE_OPTIONS.map((option) => h('option', {
      key: option.value,
      value: option.value,
    }, option.label))));
}

function MembersField({ entry, onChange, disabled }) {
  const help = isListMode(entry.mode)
    ? (splitMemberIds(entry.sendersText).length > 0
      ? null : '名单为空：该模式不会响应任何成员。')
    : '当前模式不使用名单。';
  return h('label', { className: 'dim-accessField' },
    h('span', null, '成员 QQ 号（每行一个）'),
    h('textarea', {
      value: entry.sendersText,
      rows: 3,
      spellCheck: false,
      disabled,
      onChange: (event) => onChange(event.target.value),
    }),
    help ? h('span', { className: 'dim-channelHelp' }, help) : null);
}

function ValueRow({ label, value }) {
  return h('div', { className: 'dim-accessField' },
    h('span', null, label),
    h('code', { className: 'dim-groupTriggerValue' }, value));
}

export function OneBotGroupRulesSettings({ account, rpcCall }) {
  const [state, setState] = React.useState(null);
  const [manualId, setManualId] = React.useState('');
  const [phase, setPhase] = React.useState('loading');
  const [saving, setSaving] = React.useState(false);
  const [feedback, setFeedback] = React.useState(null);

  const botId = account?.botId;

  const load = React.useCallback(async () => {
    setPhase('loading');
    setFeedback(null);
    try {
      const value = unwrapRpcResult(await rpcCall(ONEBOT_GROUP_RULES_ENDPOINTS.get, { botId }));
      setState(stateFromSnapshot(value));
      setPhase('ready');
    } catch (error) {
      setPhase('error');
      setFeedback({ tone: 'error', message: error?.message || '无法读取群聊设置，请稍后重试。' });
    }
  }, [botId, rpcCall]);

  React.useEffect(() => { void load(); }, [load]);

  if (phase === 'loading') {
    return h('div', { className: 'dim-accessState', 'aria-busy': 'true' }, '正在读取群聊设置…');
  }
  if (phase === 'error' || !state) {
    return h('div', { className: 'dim-accessState', role: 'alert' },
      h('p', null, feedback?.message || '无法读取群聊设置，请稍后重试。'),
      h('button', { type: 'button', className: 'dim-deliveryButton', onClick: () => void load() },
        '重试'));
  }

  const removed = new Set(state.removed);
  // Configured groups first, then whatever the protocol end just reported.
  const groupIds = [...new Set([
    ...Object.keys(state.groups),
    ...state.available.map((group) => group.groupId),
  ])].filter((groupId) => !removed.has(groupId));

  const titleOf = (groupId) => state.seen[groupId]?.title
    ?? state.available.find((group) => group.groupId === groupId)?.groupName
    ?? null;
  const pickable = state.available.filter((group) => !Object.hasOwn(state.groups, group.groupId)
    && !removed.has(group.groupId));

  const updateDefault = (patch) => {
    setState((current) => ({ ...current, defaults: { ...current.defaults, ...patch } }));
    setFeedback(null);
  };
  const updateGroup = (groupId, patch) => {
    setState((current) => ({
      ...current,
      groups: {
        ...current.groups,
        [groupId]: { ...(current.groups[groupId] ?? current.defaults), ...patch },
      },
    }));
    setFeedback(null);
  };
  const removeGroup = (groupId) => {
    setState((current) => {
      const groups = { ...current.groups };
      delete groups[groupId];
      return { ...current, groups, removed: [...current.removed, groupId] };
    });
    setFeedback({ tone: 'success', message: '已从列表移除，保存后生效。' });
  };
  const addGroup = (groupId, title = null) => {
    const id = String(groupId ?? '').trim();
    if (!id) {
      setFeedback({ tone: 'error', message: '需要一个群号。' });
      return;
    }
    if (!NUMERIC_GROUP_ID.test(id)) {
      setFeedback({ tone: 'error', message: '群号应为 5~20 位数字。' });
      return;
    }
    if (Object.hasOwn(state.groups, id)) {
      setFeedback({ tone: 'error', message: '该群已在列表中，请编辑上方的卡片。', detail: id });
      return;
    }
    setState((current) => ({
      ...current,
      groups: { ...current.groups, [id]: { ...current.defaults } },
      removed: current.removed.filter((entry) => entry !== id),
      seen: title ? { ...current.seen, [id]: { title } } : current.seen,
    }));
    setManualId('');
    setFeedback({ tone: 'success', message: '已添加，保存后生效。' });
  };
  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const groups = {};
      for (const [groupId, entry] of Object.entries(state.groups)) {
        groups[groupId] = { mode: entry.mode, senders: splitMemberIds(entry.sendersText) };
      }
      const value = unwrapRpcResult(await rpcCall(ONEBOT_GROUP_RULES_ENDPOINTS.set, {
        botId,
        config: {
          defaults: { mode: state.defaults.mode, senders: splitMemberIds(state.defaults.sendersText) },
          groups,
        },
        removed: state.removed,
      }));
      setState(stateFromSnapshot(value));
      setFeedback({ tone: 'success', message: '群聊设置已保存，机器人已重连。' });
    } catch (error) {
      setFeedback({ tone: 'error', message: error?.message || '无法保存群聊设置，请稍后重试。' });
    } finally {
      setSaving(false);
    }
  };

  return h('form', { className: 'dim-accessPage', onSubmit: (event) => void save(event) },
    h('fieldset', { className: 'dim-accessScene' },
      h('legend', null, '新群聊默认设置'),
      h('div', { className: 'dim-accessControls' },
        h(ModeField, {
          entry: state.defaults,
          disabled: saving,
          onChange: (mode) => updateDefault({ mode }),
        })),
      h(MembersField, {
        entry: state.defaults,
        disabled: saving,
        onChange: (sendersText) => updateDefault({ sendersText }),
      })),

    groupIds.map((groupId) => {
      const configured = Object.hasOwn(state.groups, groupId);
      const entry = state.groups[groupId] ?? state.defaults;
      const title = titleOf(groupId);
      const known = state.available.find((group) => group.groupId === groupId) ?? null;
      return h('fieldset', { key: groupId, className: 'dim-accessScene' },
        h('legend', null, title || groupId),
        h(ValueRow, { label: '群号', value: groupId }),
        known === null ? h(ValueRow, { label: '状态', value: '不在当前群列表' }) : null,
        known?.memberCount === null || known === null
          ? null : h(ValueRow, { label: '成员数', value: String(known.memberCount) }),
        configured
          ? h(ModeField, {
              entry,
              disabled: saving,
              onChange: (mode) => updateGroup(groupId, { mode }),
            })
          : h(ValueRow, { label: '响应条件', value: GROUP_TRIGGER_MODE_OPTIONS.find((option) => option.value === state.defaults.mode)?.label ?? '—' }),
        configured
          ? h(MembersField, {
              entry,
              disabled: saving,
              onChange: (sendersText) => updateGroup(groupId, { sendersText }),
            })
          : null,
        h('div', { className: 'dim-accessActions' },
          configured
            ? null
            : h('button', {
                type: 'button',
                className: 'dim-deliveryButton',
                'data-kind': 'primary',
                disabled: saving,
                onClick: () => updateGroup(groupId, {}),
              }, '自定义'),
          h('button', {
            type: 'button',
            className: 'dim-deliveryButton',
            'data-kind': 'danger',
            disabled: saving,
            onClick: () => removeGroup(groupId),
          }, '× 移除')));
    }),

    h('fieldset', { className: 'dim-accessScene' },
      h('legend', null, '添加群聊'),
      pickable.length > 0
        ? h('label', { className: 'dim-accessField' },
            h('span', null, '从机器人加入的群中选择'),
            h('select', {
              value: '',
              disabled: saving,
              onChange: (event) => {
                const group = pickable.find((item) => item.groupId === event.target.value);
                if (group) addGroup(group.groupId, group.groupName);
              },
            }, [
              h('option', { key: '', value: '' }, '— 选择一个群 —'),
              ...pickable.map((group) => h('option', { key: group.groupId, value: group.groupId },
                group.groupName ?? '未命名群', ` (${group.groupId})`)),
            ]))
        : h('p', { className: 'dim-channelHelp' },
            '读不到群列表（机器人可能未连接），可直接填写群号。'),
      h('label', { className: 'dim-accessField' },
        h('span', null, '群号'),
        h('textarea', {
          value: manualId,
          rows: 1,
          spellCheck: false,
          placeholder: '904897306',
          style: { resize: 'none', minHeight: '2.4em', overflow: 'hidden' },
          onChange: (event) => setManualId(event.target.value.replace(/[\s\u00a0]+/g, '')),
          onKeyDown: (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (!saving) addGroup(manualId);
          },
        })),
      h('div', { className: 'dim-accessActions' },
        h('button', {
          type: 'button',
          className: 'dim-deliveryButton',
          'data-kind': 'primary',
          disabled: saving || !manualId,
          onClick: () => addGroup(manualId),
        }, '+ 添加'))),

    feedback
      ? h('p', {
          className: 'dim-accessFeedback',
          'data-tone': feedback.tone,
          role: feedback.tone === 'error' ? 'alert' : 'status',
          'aria-live': 'polite',
        }, feedback.message, feedback.detail ? h('code', { className: 'dim-groupTriggerValue' }, feedback.detail) : null)
      : null,

    h('div', { className: 'dim-accessActions' },
      h('button', {
        type: 'submit',
        className: 'dim-deliveryButton',
        'data-kind': 'primary',
        disabled: saving,
      }, saving ? '正在保存…' : '保存群聊设置')));
}

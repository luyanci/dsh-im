export const ONEBOT_STYLE_ID = 'xmanrui-dsh-im-onebot-settings';

const CSS = String.raw`
.dob-page { --ddt-accent: #0a84ff; --ddt-accent-deep: #0757a6; --ddt-accent-wash: #eef5ff; }
.dob-avatar { background: linear-gradient(145deg, #fff, #f8fafb); border: 1px solid #e5e6eb; }
.dob-avatar svg { display: block; }
.dob-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.dob-formHint { grid-column: 1 / -1; margin: -4px 0 0; color: var(--dsw-alias-label-tertiary, #8f959e); font-size: 11px; line-height: 1.55; }
.dob-state { font-size: 12px; }
.dob-state[data-state="connected"] { color: var(--dsw-alias-state-success-primary, #20a162); }
.dob-state[data-state="listening"] { color: var(--dsw-alias-state-warning-primary, #d97706); }
.dob-state[data-state="idle"] { color: var(--dsw-alias-label-tertiary, #8f959e); }
.dob-state[data-state="error"] { color: var(--dsw-alias-state-error-primary, #d54941); }
.dob-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
@container (max-width: 680px) {
  .dob-form { grid-template-columns: minmax(0, 1fr); }
}
`;

export function installOneBotStyles() {
  if (typeof document === 'undefined') return () => {};
  const existing = document.querySelector(`style[data-plugin-css="${ONEBOT_STYLE_ID}"]`);
  if (existing) return () => {};
  const style = document.createElement('style');
  style.dataset.plugin = '@xmanrui/dsh-im';
  style.dataset.pluginCss = ONEBOT_STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  return () => style.remove();
}

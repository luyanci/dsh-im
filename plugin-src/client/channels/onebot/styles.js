export const ONEBOT_STYLE_ID = 'xmanrui-dsh-im-onebot-settings';

/**
 * The OneBot page reuses the shared `ddt-*` card language (installed by the
 * DingTalk base styles); only the OneBot-specific rows are declared here.
 */
const CSS = String.raw`
.dob-page { --ddt-accent: #0a84ff; --ddt-accent-deep: #0757a6; --ddt-accent-wash: #eef5ff; }
.dob-avatar { display: inline-flex; align-items: center; justify-content: center; }
.dob-accountHeader { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dob-accountIdentity { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.dob-accountIdentity strong { font-size: 14px; }
.dob-accountIdentity small { color: var(--dsw-alias-label-tertiary, #8f959e); font-size: 12px; }
.dob-state { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
.dob-state[data-tone="success"] { color: var(--dsw-alias-state-success-primary, #20a162); }
.dob-state[data-tone="warning"] { color: var(--dsw-alias-state-warning-primary, #d97706); }
.dob-state[data-tone="error"] { color: var(--dsw-alias-state-error-primary, #d54941); }
.dob-hint { margin: 6px 0 0; color: var(--dsw-alias-label-tertiary, #8f959e); font-size: 12px; line-height: 1.6; }
.dob-error { margin: 6px 0 0; color: var(--dsw-alias-state-error-primary, #d54941); font-size: 12px; line-height: 1.6; }
.dob-setup { display: grid; gap: 10px; }
.dob-steps { margin: 0; padding-left: 1.25rem; display: grid; gap: 4px; color: var(--dsw-alias-label-secondary, #4e5969); font-size: 12px; line-height: 1.7; }
.dob-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
.dob-formActions { grid-column: 1 / -1; }
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

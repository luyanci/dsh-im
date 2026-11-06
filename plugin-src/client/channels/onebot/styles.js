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
/* The shared field styles only cover inputs, so the image-format select would
   otherwise render as a raw native control. */
.dim-panel .dob-form select {
  width: 100%; min-width: 0; height: 38px; padding: 0 30px 0 11px;
  border: 1px solid var(--dsw-alias-border-l2, #dfe1e5); border-radius: 8px; outline: none;
  color: var(--dsw-alias-label-primary, #1f2329);
  background-color: var(--dsw-alias-bg-layer-1, #fff);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5 6 8l3.5-3.5' fill='none' stroke='%238f959e' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 10px center;
  appearance: none; font: 13px inherit; cursor: pointer;
  transition: border-color .16s ease, box-shadow .16s ease;
}
.dim-panel .dob-form select:focus { border-color: #4e5969; box-shadow: 0 0 0 3px rgb(78 89 105 / 10%); }
.dim-panel .dob-form select:disabled { cursor: default; opacity: .6; }
@container (max-width: 680px) {
  .dob-form { grid-template-columns: minmax(0, 1fr); }
}
`;

export function installOneBotStyles() {
  if (typeof document === 'undefined') return () => {};
  const existing = document.querySelector(`style[data-plugin-css="${ONEBOT_STYLE_ID}"]`);
  if (existing) return () => {};
  const style = document.createElement('style');
  style.dataset.plugin = '@luyanci/dsh-im';
  style.dataset.pluginCss = ONEBOT_STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  return () => style.remove();
}

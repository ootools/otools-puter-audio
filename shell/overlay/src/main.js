/**
 * OTools 插件版入口（覆盖上游同名文件）。
 *
 * 与上游 `src/main.js` 的差别只有第一行：先装 OTools 的语言 / 本地文件两件套
 * （`shell/src/otools/boot.js`）。必须在 `new App()` **之前**装好，否则界面会
 * 先按英文画一遍再被翻译层翻一遍，看得见闪一下。
 *
 * 其余启动流程一行未改，包括：
 *   - 上游的 `window.puter.ui.onLaunchedWithItems`（Puter 桌面的「打开方式」）：
 *     插件里 `window.puter` 不存在，这段自然跳过，不需要改。
 *   - 注销旧版留下的 service worker。
 */

import './otools/boot.js';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/panels.css';
import './styles/editor.css';
import { App } from './app.js';
import { FEATURES } from './features.js';
import { createShell } from './ui/shell.js';
import { openFiles } from './storage/files.js';

const app = new App();
for (const install of FEATURES) install(app);
createShell(app, document.getElementById('app'));
app.setStatus(`Launched in ${(performance.now() / 1000).toFixed(2)} seconds`);

// Files handed to the app by the Puter desktop ("Open with").
const p = typeof window !== 'undefined' ? window.puter : null;
if (p?.ui?.onLaunchedWithItems) {
  p.ui.onLaunchedWithItems((items) => openFiles(app, items));
}

// Retire the service worker from the previous version of this app.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations?.().then((regs) => regs.forEach((r) => r.unregister())).catch(() => {});
}

// 插件没有 devtools，留一个稳定的全局句柄，排查时能在宿主 console 里敲。
if (typeof window !== 'undefined') window.audioStudio = app;

if (import.meta.env.DEV) {
  window.as = app;
  // Dev hook: open gitignored test media from .dev-media/ by file name.
  app.openDev = async (names) => {
    const files = await Promise.all(names.map(async (n) => new File([await (await fetch(`/.dev-media/${n}`)).blob()], n)));
    return openFiles(app, files);
  };
}

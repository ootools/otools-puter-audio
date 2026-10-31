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
import { onHostOpenFiles } from './otools/openfile.js';
import * as host from './otools/host.js';
import { setAudioMcpContext } from './otools/mcp-context.js';
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
// MCP 领域工具的活句柄：当前打开的 Session（app.active）。getter 捕获 app，
// 切换/新建文档后自动跟上；领域工具经 setAudioMcpContext 从这里取。
setAudioMcpContext({ editorContext: () => app.active });
for (const install of FEATURES) install(app);
createShell(app, document.getElementById('app'));
app.setStatus(`Launched in ${(performance.now() / 1000).toFixed(2)} seconds`);

// Files handed to the app by the Puter desktop ("Open with").
const p = typeof window !== 'undefined' ? window.puter : null;
if (p?.ui?.onLaunchedWithItems) {
  p.ui.onLaunchedWithItems((items) => openFiles(app, items));
}

/**
 * 宿主的「打开方式」：系统里双击已绑定扩展名的音频/工程文件 → 用本插件打开。
 *
 * 走与「文件 ▸ 打开」和拖放完全相同的 `openFiles` 入口（按扩展名分流到工程/音频/
 * MIDI 三种打开器）。字节由宿主读，不经过库路径解析——投递来的是本机任意路径，
 * 不在库目录里。
 */
onHostOpenFiles((files) => {
  void (async () => {
    const opened = [];
    for (const file of files) {
      try {
        const record = await host.readFile(file.path);
        if (!record) continue;
        const blob = host.base64ToBlob(record.dataBase64, record.mime);
        opened.push(new File([blob], file.name, { type: record.mime }));
      } catch (error) {
        console.error('[otools] open delivered file failed', file.path, error);
      }
    }
    if (opened.length) await openFiles(app, opened);
  })();
});

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

/**
 * 启动胶水：把「语言 + 本地文件」两件事一次装好。
 * ------------------------------------------------------------------
 * 各插件的 overlay 入口（`shell/overlay/src/main.js`）在渲染界面之前 import 它
 * 一次就行。之所以集中在这里，是因为这两件事有顺序依赖：
 *
 *   1. 先装 i18n —— 之后所有 `t()` 才拿得到当前语言；
 *   2. 再装 DOM 翻译层 —— 它订阅 i18n 的变更，切语言时整棵树重译。
 *
 * 顺序反过来会出现「界面按英文画完再翻一遍」这种闪一下的效果。
 *
 * **与同源的五个 puter-* 插件不同，这里没有第三步「主题跟随宿主」**：
 * Audio Studio 是暗色调音台，默认就是暗黑（见 `shell/edits.mjs` 把
 * `lib/prefs.js` 的 `theme` 默认值从 `'system'` 改成 `'dark'`），刻意不跟随宿主，
 * 免得在浅色宿主里变成一片刺眼的浅色工作区。用户可以在
 * Preferences → Appearance 里自己改，改过就一直是用户的。
 *
 * 幂等：重复 import / 重复调用都不会装第二遍。
 */

import { installI18n } from './i18n.js';
import { installDomTranslation } from './dom-i18n.js';
import { APP } from './app.js';
import { usingHost, libraryDir } from './local.js';
import { installMcpBridge } from './mcp.js';
import { audioMcpTools } from './mcp-tools.js';

let booted = false;

export function boot() {
  if (booted) return;
  booted = true;

  installI18n();
  installDomTranslation();

  // 库目录提前建好：用户第一次保存时不想再等一次目录创建 + 宿主往返。
  // 失败也不影响启动（宿主不在时本来就用浏览器兜底）。
  if (usingHost()) {
    libraryDir().catch(() => { /* 建不了目录不该让启动失败 */ });
  }

  // MCP 桥挂在最后：宿主读 `window.__otoolsMcp` 时会用到上面装好的库目录能力，
  // 所以它必须晚于 i18n / 主题就绪。挂载本身没有副作用（只赋值，不触发工具调用）。
  // 领域级工具（读/改当前 session）在 `otools/mcp-tools.js`；活句柄（当前 Session）由
  // overlay 入口 `main.js` 在应用就绪后经 `setAudioMcpContext` 交进来。
  installMcpBridge({ extraTools: audioMcpTools() });

  if (typeof document !== 'undefined') {
    document.documentElement.dataset.otoolsPlugin = APP.id;
  }
}

boot();

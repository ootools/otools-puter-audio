/**
 * OTools 插件版的 Vite 配置（覆盖上游同名文件）。
 *
 * 与上游的差别：
 *   1. **不再引入 `../../dev/puter-localhost.mjs`**。上游那个插件把开发服务器
 *      挂在 `audio-studio.puter.localhost`，是因为 Puter 的应用沙箱按子域名区分
 *      账号；插件版没有 Puter，直接跑 127.0.0.1 即可。而且 `dev/` 不在上游快照里
 *      （我们只快照 `src/audio-studio`），留着这行会直接构建失败。
 *   2. **产物落到仓库根的 `dist/`**（`plugin.json` 的 `entry: dist/index.html`）。
 *      构建根目录是 `.build/`（upstream + 移植层的合成树），所以这里写 `../dist`。
 *   3. `emptyOutDir: false`：dist/ 的清扫交给 `scripts/tree.mjs` 的 `sweepDist()`，
 *      它拿 Vite JS API 报回来的「本次产出了哪些文件」做差集，只删几个带哈希的
 *      旧 chunk，而不是把整个目录删掉重来。
 *
 * `base: './'` 是必须的：宿主用 `otools-plugin://<uuid>/dist/index.html` 提供
 * 插件，相对路径是唯一能同时适配「宿主加载」和「dist 拖进浏览器」的写法。
 */
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    cssTarget: 'safari16',
    // 编辑器是一个大的单页应用；很少用到的工具按需加载。
    chunkSizeWarningLimit: 1000,
    outDir: '../dist',
    emptyOutDir: false,
    sourcemap: false,
  },
  optimizeDeps: {
    include: ['@breezystack/lamejs', 'lucide'],
  },
  server: {
    host: '127.0.0.1',
    port: 5523,
    strictPort: true,
    fs: {
      // 构建根是 `.build/`，而 node_modules 在仓库根（上一级）。不显式放行的话，
      // dev / vitest 会以 `Denied ID …/node_modules/…?url` 拒掉包内资源。
      allow: ['..'],
    },
  },
  worker: { format: 'es' },
  test: {
    // 上游的测试跑在 jsdom 下（界面/面板用例需要 DOM）。
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
    testTimeout: 30_000,
  },
});

/**
 * 从构建树里删掉的路径：只服务 Puter 云 / 公网分发的文件。
 * ------------------------------------------------------------------
 * 删完之后的 `keep` 是断言：这些文件必须还在，否则说明删过头了
 * （上游改了路径、或者 drop 列表写宽了）。
 *
 * 只删**公网才需要**的东西。图标与 manifest 留着——favicon 与安装提示
 * 在宿主 webview 里照样有用，而且 overlay 的 index.html 还在引用它们。
 */
export const drops = [
  'public/robots.txt', // 给爬虫看的，插件里没有意义
  'public/social-graph.jpg', // og:image，只在公网分享链接时有意义（overlay 已去掉 og 标签）
  'public/sw.js', // 旧版 PWA 的 service worker；入口 main.js 会主动注销它
];

export const keep = [
  'index.html',
  'src/main.js',
  'src/storage/puter.js',
  'public/manifest.json',
  'public/favicon.ico',
];

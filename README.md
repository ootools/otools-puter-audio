# otools-puter-audio

**Audio Studio** —— [HeyPuter/everything](https://github.com/HeyPuter/everything) 的
`src/audio-studio` 移植成 OTools 插件：同一套波形 / 多轨音频编辑器，但工程与导出
文件存到**这台机器上的普通文件**，而不是 Puter 云盘。

- 上游：`HeyPuter/everything` → `src/audio-studio`（提交号见 `upstream.lock.json`）
- 上游代码原样放在 `upstream/`，**不要就地改**；所有移植改动在 `shell/`
- 产物：`dist/`（纯前端静态资源）+ `dist-pack/*.oplg`（插件安装包）

## 与上游的差别

| 方面 | 上游 | 本插件 |
| --- | --- | --- |
| 文件后端 | Puter 云盘（`window.puter`） | OTools 宿主的本机磁盘（`shell/overlay/src/storage/puter.js` 整文件替换） |
| 账号 | Puter 登录 / 头像 / 退出 | 恒为「已登录到这台机器」，账号入口摘掉 |
| AI 语音合成 | Puter AI | 不可用（入口保留但会提示不可用） |
| 主题 | 默认跟随系统 | **默认暗黑**（Preferences → Appearance 可改） |
| 语言 | 英文 | 跟随宿主语言；内置简体中文词典（`shell/src/otools/i18n.zh-CN.js`） |
| 开发服务器 | `audio-studio.puter.localhost:5621` | `127.0.0.1:5523` |

## 常用命令

```sh
npm install --legacy-peer-deps   # 依赖（.npmrc 已开 legacy-peer-deps）
npm run check-upstream           # 校验 upstream/ 与 lock 一致
npm test                         # 移植层测试（i18n / DOM 翻译 / 宿主桥）
npm run build                    # 合成 .build/ → vite build → dist/
npm run pack                     # 打 .oplg 到 dist-pack/
npm run verify                   # 独立校验 .oplg
npm run i18n-report              # 词典覆盖率报告（--missing 看缺哪些）
npm run dev                      # 本地开发服务器（宿主不在，走浏览器兜底）
```

## 目录

```
upstream/    上游 src/audio-studio 的原样快照（内容哈希锁定）
shell/
  src/otools/  与业务无关的通用层：宿主桥 host.js、本地文件后端 local.js、
               多语言 i18n.js + dom-i18n.js + i18n.zh-CN.js、身份配置 app.js
  overlay/     整文件替换上游的文件（入口 HTML / vite 配置 / main.js / storage/puter.js）
  edits.mjs    逐条外科手术式改动（每条都校验命中次数）
  drop.mjs     从构建树里删掉的路径
scripts/     构建 / 打包 / 校验 / 同步上游 / i18n 工具
```

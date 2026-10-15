/**
 * 逐条外科手术式改动（1~5 行的局部修改）。
 * ------------------------------------------------------------------
 * 每一条都必须能命中：`expect` 是硬约束。上游改了那段代码，构建会报
 * 「命中 N 次，期望 M 次」并打印是哪一条、为什么改。**不要为了让构建过而
 * 放宽 expect**，要去读上游的新代码，把 find/replace 更新到新的形状。
 *
 * 超过 5 行、或者涉及结构性改动，就别放这里——走 shell/overlay/ 整文件替换
 * （本项目的 `src/storage/puter.js` 与 `src/main.js` 就是这么换掉的）。
 *
 * 这批改动只有两条主题：**默认暗黑** 与 **摘掉需要 Puter 账号的入口**。
 * 文件一律走本机（见 shell/overlay/src/storage/puter.js）。
 */
export const edits = [
  {
    file: 'src/lib/prefs.js',
    find: `  theme: 'system',`,
    replace: `  theme: 'dark', // 移植：插件版默认暗黑（上游是跟随系统）`,
    expect: 1,
    why: '主题默认值：Audio Studio 是暗色调音台，插件版不跟随宿主，开箱即暗黑。用户在 Preferences → Appearance 里改过就一直用用户的。',
  },
  {
    file: 'src/ui/shell.js',
    find: `docTitle, h('div.spacer'), createAccount(app));`,
    replace: `docTitle, h('div.spacer'));`,
    expect: 1,
    why: '顶栏右侧的 Puter 账号控件（登录按钮 / 头像菜单）：本地文件模型下没有账号可看，整块去掉。',
  },
];

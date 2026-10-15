/**
 * 本插件的身份配置——移植层里**唯一**有项目个性的通用模块。
 * ------------------------------------------------------------------
 * `host.js` / `i18n.js` / `dom-i18n.js` / `local.js` 都是与业务无关的通用实现，
 * 它们的「项目个性」全部从这里读（这套工具链与 otools-puter-ps / -3d /
 * -documents / -spreadsheet / -presentation 五个仓库同源，改这个文件就够了）。
 */

export const APP = {
  /** 插件包 id：`plugin.json` 的 `packid`/`uuid`，也是宿主侧识别用的名字。 */
  id: 'otools-puter-audio',

  /**
   * 宿主桥挂到 window 上的全局名。
   * 刻意不与上游的 `window.puter` 撞名——排查时在 console 里敲它，
   * 一眼能分清「这是我们自己的桥」还是「上游遗留」。
   */
  bridge: 'otoolsPuterAudio',

  /** 英文产品名（错误提示里保留原文）。 */
  product: 'Audio Studio',

  /** 简体中文产品名。 */
  productCN: '音频工作室',

  /** 本机默认库目录名（放在宿主的「文档」目录下）。 */
  folder: 'Audio Studio',

  /** 库目录的标记文件名：有它才算「这是本插件的库」，避免误认用户目录。 */
  marker: 'audio-studio.json',

  /**
   * 找库目录时问宿主要哪些已知路径，按顺序试第一个存在的。
   * 媒体类插件一律「文档 → 主目录」，不碰 videos/downloads。
   */
  rootKeys: ['documents', 'home'],

  /** 本插件的主格式扩展名（打开/保存对话框的过滤器、另存的默认后缀）。 */
  extensions: ['wav', 'aiff', 'aif', 'flac', 'mp3', 'm4a', 'opus', 'ogg', 'asesx'],

  /**
   * 用户内容区的选择器——DOM 翻译层**整棵跳过**这些节点。
   *
   * 只写**叶子**，不写容器：写容器会把里面的「删除」「重命名」这类按钮
   * 一起跳过，界面上就永远留着英文。这里放的是用户自己起的文件名 / 轨名 /
   * 标记名 / 工作区名，翻译它们等于改用户的数据。
   *
   * 反过来，**界面文案所在的叶子不能写进来**。这几个类曾经写进来过，结果是
   * 媒体浏览器的 `Home` / `Add Folder...`、轨道头上的效果名、效果架里的效果名
   * 一直是英文——它们是界面文案，不是用户数据：
   *   `.media-tree-name`（文件夹树，含 `Home` / `Add Folder...`）
   *   `.mt-th-fxname`（轨道头效果芯片，含效果名与 `No effects`）
   *   `.mx-fx-name`（混音器里的效果按钮，文本就是效果名）
   *   `.rack-name`（效果架里那个可点的效果名按钮）
   * 用真宿主探针逐面板核对可见文本才发现的。
   */
  i18nSkip: [
    '.doc-title',
    '.track-name',
    '.mt-th-name',
    '.mt-video-name',
    '.mx-name',
    '.rack-target-name',
    '.name-cell',
    '.batch-name',
    '.media-preview-name',
    '.ws-name',
    '.sc-name',
    '.io-recover-name',
  ],
};

export default APP;

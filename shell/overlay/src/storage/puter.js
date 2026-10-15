/**
 * 本机文件版的 Puter 适配层（覆盖上游同名文件）。
 * ------------------------------------------------------------------
 * 上游把「应用向 Puter 要的一切」收敛在这一个模块里（`auth` / `env` / 文件读写 /
 * 目录列举 / 打开·另存·选目录对话框 / 预览 URL），其余代码只 `import * as puter
 * from '../storage/puter.js'`。所以换掉这一个文件，整个应用就从「存到 Puter 云盘」
 * 变成「存到这台机器上的普通文件」——`upstream/` 一行都不用改。
 *
 * 导出清单与上游**逐条一致**（其余代码按名字 import，签名不能变）：
 *   APP_DIR · sdk · env · canSignOut · isSignedIn · signIn · signOut · getUser ·
 *   getProfilePicture · pickFiles · pickSave · readFile · writeFile · homeDir ·
 *   appDir · readdir · stat · exists · mkdir · readRange · readURL · pickDirectory ·
 *   isDir · dirname · joinPath
 *
 * ## 路径模型
 *
 * 上游的路径是 Puter 云盘路径（`/<用户名>/AudioStudio/xxx.wav`），上游代码到处
 * 按 `/` 切它（`dirname`、面包屑、`dirOf`、取文件名）。插件版沿用「虚拟路径 +
 * 真·本机路径透传」两条腿：
 *
 *   `/`              → 宿主的「文档」目录（退到主目录）——媒体浏览器的「Home」
 *   `/AudioStudio`   → 本机库目录 `<文档>/Audio Studio`（`local.js` 的 libraryDir）
 *   其它（含 `\`）   → 用户用对话框选的、宿主传进来的**真·本机绝对路径**，原样透传
 *
 * 交给上游的路径一律**归一成 `/`**（`posix()`）：这样上游那些
 * `path.lastIndexOf('/')` 在 Windows 上也不会失效，而宿主（Rust `PathBuf`）
 * 本来就同时接受 `/` 与 `\`。
 *
 * ## 三条退路（见 shell/src/otools/local.js）
 *   1. **宿主磁盘**（OTools 里）：系统打开 / 另存对话框 + 真·本地读写；
 *   2. **浏览器下载 / `<input type=file>`**：宿主不在时的兜底；
 *   3. **OPFS**：连下载都不方便时的最后退路（内容不出现在用户文件系统里）。
 *
 * ## 关于 Puter 登录
 *   `isSignedIn()` 恒为 true（「已登录到这台机器」）、`signIn()`/`signOut()` 是
 *   空操作、`getUser()` 给一个本地身份、`getProfilePicture()` 恒为 null。
 *   `sdk()` 返回一个**非空**的本地替身，这样上游那些 `if (puter.sdk())` 的
 *   「Puter 文件夹」保存目标才会出现——它们实际落到本机目录，正是我们要的。
 *   真正需要云的能力（Puter AI 语音合成）上游自己会判断 `sdk()` 之外的信号，
 *   在插件里表现为「不可用」，不在这个底座里假装它能用。
 */

import * as host from '../otools/host.js';
import { APP } from '../otools/app.js';
import { t } from '../otools/i18n.js';
import {
  exportFile, importFiles, libraryDir, localAuth, localUser, usingHost,
  opfsList, opfsRead, opfsWrite,
} from '../otools/local.js';

/** 上游自己的应用目录名（界面里会显示成 `~/AudioStudio`）。 */
export const APP_DIR = 'AudioStudio';

/** 虚拟根：宿主的「文档」目录。媒体浏览器把它显示成 “Home”。 */
const HOME = '/';
/** 虚拟的应用目录：本机库目录。 */
const APP_ROOT = `/${APP_DIR}`;

/* -------------------------------------------------------------- 路径工具 */

/** 一律用 `/`：上游到处按 `/` 切路径，Windows 的 `\` 会让那些判断失效。 */
const posix = (p) => String(p || '').replace(/\\/g, '/');

/** 归一化：去空白、统一分隔符、压掉重复斜杠。空串原样返回。 */
function normPath(p) {
  const s = posix(p).trim();
  if (!s) return '';
  return s.replace(/\/{2,}/g, '/');
}

const trimSlash = (p) => String(p || '').replace(/\/+$/, '');

const missing = (path) => Object.assign(new Error(`No such file or directory: ${path}`), { code: 'ENOENT' });

/** 宿主的「文档」目录（退到主目录）；拿不到就空串。 */
function rootDir() {
  return APP.rootKeys.map((k) => host.knownPath(k)).find((p) => p) || '';
}

/**
 * 虚拟路径 → 真·本机路径。
 * 不在虚拟命名空间里的路径（用户选的、宿主给的）原样返回。
 */
async function realPath(path) {
  const p = normPath(path);
  if (!p) return '';
  if (p === HOME) return rootDir();
  if (p === APP_ROOT) return libraryDir();
  if (p.startsWith(`${APP_ROOT}/`)) {
    const dir = await libraryDir();
    return dir ? `${trimSlash(dir)}/${p.slice(APP_ROOT.length + 1)}` : '';
  }
  return p;
}

/* ------------------------------------------------------------ OPFS 兜底 */

// OPFS 的文件名不能含 `/`：按段编码再用 `~` 连起来，既能还原也能做前缀匹配。
const opfsKey = (path) => normPath(path).split('/').map(encodeURIComponent).join('~');
const opfsKeyOf = (name) => { try { return decodeURIComponent(String(name).split('~').join('/')); } catch { return ''; } };

/** OPFS 里落在 `dir/` 下的条目（宿主不在时的目录列举）。 */
async function opfsEntries(dir) {
  const base = dir === HOME ? '' : trimSlash(dir);
  const prefix = base ? `${base}/` : '/';
  const out = [];
  for (const entry of await opfsList()) {
    const path = opfsKeyOf(entry.name);
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    if (!rest || rest.includes('/')) continue; // 只列直接子项
    const file = await opfsRead(entry.name);
    out.push({ name: rest, path, is_dir: false, size: file?.size || 0, modified: file?.lastModified || 0 });
  }
  return out;
}

/* --------------------------------------------------------------- SDK 替身 */

/**
 * `sdk()` 的返回值。
 *
 * 上游到处是 `if (puter.sdk())`：为真才显示「Puter 文件夹」这个保存目标、
 * 才走云分支。插件版让它恒为真——云分支被换成了本机分支（就是这个文件），
 * 而 `ui` 刻意留空，`ui.onWindowClose`（Puter 桌面的关闭提示）与
 * `ui.onLaunchedWithItems`（Puter 的「打开方式」）自然都不会触发。
 */
const SDK_STUB = {
  env: 'app',
  auth: {
    isSignedIn: () => true,
    signIn: async () => localUser(),
    signOut: () => {},
    getUser: async () => localUser(),
    getProfilePicture: async () => null,
  },
  fs: {},
  ui: {},
};

export function sdk() {
  return SDK_STUB;
}

/** 插件总是跑在宿主的应用窗口里：让上游走 `env === 'app'` 的分支。 */
export function env() {
  return 'app';
}

/** 本地文件模型下没有「退出登录」这回事。 */
export function canSignOut() {
  return false;
}

export async function isSignedIn() {
  return localAuth.isSignedIn();
}

export async function signIn() {
  return localAuth.signIn();
}

export async function signOut() {
  localAuth.signOut();
}

export async function getUser() {
  return localUser();
}

/** 本机身份没有头像（也刻意不发任何远程请求）。 */
export async function getProfilePicture() {
  return null;
}

/* ---------------------------------------------------------------- 对话框 */

/** 上游到处判断 `item.is_dir` / `item.isDir`，两个都认。 */
export function isDir(item) {
  return Boolean(item?.is_dir ?? item?.isDir);
}

/** 一个「像 Puter FSItem」的对象：`openFiles` 会先试 `read()`，再退回 `readFile(path)`。 */
function fsItem(path, name, blob, { isDir: dir = false } = {}) {
  const p = posix(path);
  return {
    name: name || host.baseName(p),
    path: p,
    is_dir: dir,
    isDir: dir,
    size: blob?.size || 0,
    modified: Date.now(),
    uid: p,
    async read() {
      if (dir) throw new Error(`${p} is a folder`);
      return blob ?? readFile(p);
    },
  };
}

/**
 * 打开文件对话框（上游的 `ui.showOpenFilePicker`）。
 * 宿主在就用系统对话框（返回真·本机路径），不在就用 `<input type=file>`。
 * 取消时返回空数组——上游对空数组是安全的（`openFromPuter` 直接 `openFiles(app, [])`）。
 */
export async function pickFiles({ multiple = true, accept } = {}) {
  const files = await importFiles({ accept, multiple, title: t('Open') });
  return files.map((f) => fsItem(f.path || f.name, f.name, f.blob));
}

/** 另存对话框（上游的 `ui.showSaveFilePicker`）。取消时抛错，与上游一致。 */
export async function pickSave(blob, suggestedName) {
  const saved = await exportFile(blob, suggestedName);
  if (!saved.path) throw new Error(t('Save cancelled'));
  return fsItem(saved.path, saved.name, blob);
}

/** 选目录对话框（上游的 `ui.showDirectoryPicker`）。取消时抛错，与上游一致。 */
export async function pickDirectory() {
  const dir = await host.pickFolder({ title: t('Choose a folder') });
  if (!dir) throw new Error(t('No folder selected'));
  return fsItem(dir, host.baseName(dir), null, { isDir: true });
}

/* ------------------------------------------------------------- 文件读写 */

/** 读一个文件，返回 Blob（找不到就抛，与 Puter SDK 一致）。 */
export async function readFile(path) {
  const p = normPath(path);
  if (!usingHost()) {
    const file = await opfsRead(opfsKey(p));
    if (!file) throw missing(p);
    return file;
  }
  const real = await realPath(p);
  if (!real) throw missing(p);
  const file = await host.readFile(real);
  if (!file) throw missing(p);
  const blob = host.base64ToBlob(file.dataBase64, file.mime || host.mimeForPath(real));
  // 上游有几处会给读回来的 Blob 补 name（`Object.assign(await readFile(...), {name})`）；
  // 我们自己也挂一份，省得调用方还要自己去猜。
  try {
    blob.name = file.name || host.baseName(real);
    blob.path = p;
  } catch { /* 某些环境的 Blob 不可扩展，忽略 */ }
  return blob;
}

/**
 * 写一个文件（父目录会自动补齐）。
 *
 * 返回一个 FSItem 形状的对象——上游只用到 `item.uid`，其余是给排查看的。
 */
export async function writeFile(path, data, _options = {}) {
  const p = normPath(path);
  const blob = data instanceof Blob ? data : new Blob([data]);
  if (!p) return fsItem('', '', blob);
  if (!usingHost()) {
    await opfsWrite(opfsKey(p), blob);
    return fsItem(p, host.baseName(p), blob);
  }
  const real = await realPath(p);
  if (!real) throw new Error(t('OTools host is not available'));
  const parent = host.dirName(real);
  if (parent) await host.createDir(parent);
  await host.writeBlob(real, blob);
  return fsItem(p, host.baseName(real), blob);
}

/** 读取 `count` 字节（从 `offset` 开始）。返回 Blob，调用方按 `.arrayBuffer()` 用。 */
export async function readRange(path, offset, count) {
  const start = Math.max(0, Number(offset) || 0);
  const length = Math.max(0, Number(count) || 0);
  const blob = await wholeBlob(path);
  if (!blob) throw missing(path);
  return blob.slice(start, start + length);
}

/**
 * 头尾两次读取（媒体浏览器探测时长）命中的是同一个文件，
 * 所以这里缓存最近读过的整份 Blob，免得把一个大文件读两遍。
 * 只缓存不超过 64 MB 的，最多 4 份——再大就现读现扔，宁可慢也不占内存。
 */
const rangeCache = new Map();
const RANGE_CACHE_MAX = 4;
const RANGE_CACHE_BYTES = 64 * 1024 * 1024;

async function wholeBlob(path) {
  const p = normPath(path);
  const hit = rangeCache.get(p);
  if (hit) {
    rangeCache.delete(p);
    rangeCache.set(p, hit);
    return hit;
  }
  const blob = await readFile(p);
  if (blob && blob.size <= RANGE_CACHE_BYTES) {
    rangeCache.set(p, blob);
    while (rangeCache.size > RANGE_CACHE_MAX) rangeCache.delete(rangeCache.keys().next().value);
  }
  return blob;
}

/**
 * 一个能流式播放的 URL（上游用它给 `<audio>` 做预览）。
 *
 * Puter 给的是带签名的临时 URL；本机文件没有这种东西，所以读出来做一个
 * object URL，并保留最近几个、把更早的 revoke 掉——否则每点一个文件就漏一份。
 */
const urlCache = new Map();
const URL_CACHE_MAX = 3;

export async function readURL(path, _expiresIn = '2h') {
  const p = normPath(path);
  const hit = urlCache.get(p);
  if (hit) {
    urlCache.delete(p);
    urlCache.set(p, hit);
    return hit;
  }
  const blob = await readFile(p);
  const url = URL.createObjectURL(blob);
  urlCache.set(p, url);
  while (urlCache.size > URL_CACHE_MAX) {
    const [oldKey, oldUrl] = urlCache.entries().next().value;
    URL.revokeObjectURL(oldUrl);
    urlCache.delete(oldKey);
  }
  return url;
}

/* ------------------------------------------------------------- 目录操作 */

/** 列出目录（目录不存在时返回 []，与上游一致）。 */
export async function readdir(path) {
  const p = normPath(path) || HOME;
  if (!usingHost()) return opfsEntries(p);
  const real = await realPath(p);
  if (!real) return [];
  const entries = await host.listDir(real);
  const base = p === HOME ? '' : trimSlash(p);
  return entries.map((e) => ({
    name: e.name,
    path: `${base}/${e.name}`,
    is_dir: Boolean(e.isDir),
    size: e.size || 0,
    modified: e.modified || 0,
  }));
}

/** 一个路径的元数据。找不到就抛（`exists` 会把它吃掉）。 */
export async function stat(path) {
  const p = normPath(path);
  if (p === HOME) return { name: '', path: HOME, is_dir: true, size: 0, modified: 0 };
  if (!usingHost()) {
    const file = await opfsRead(opfsKey(p));
    if (!file) throw missing(p);
    return { name: host.baseName(p), path: p, is_dir: false, size: file.size, modified: file.lastModified || 0 };
  }
  const real = await realPath(p);
  if (!real) throw missing(p);
  const parent = host.dirName(real);
  if (!parent) throw missing(p);
  const entries = await host.listDir(parent);
  const found = entries.find((e) => e.name === host.baseName(real));
  if (!found) throw missing(p);
  return { name: found.name, path: p, is_dir: Boolean(found.isDir), size: found.size || 0, modified: found.modified || 0 };
}

export async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** 建目录（宿主用 create_dir_all，会补齐父级）。 */
export async function mkdir(path) {
  const p = normPath(path);
  if (!p || !usingHost()) return;
  const real = await realPath(p);
  if (real) await host.createDir(real);
}

/* ------------------------------------------------------------ 路径字符串 */

/** 父目录。虚拟路径与真·本机路径都能用（`/` 与 `\` 都认）。 */
export function dirname(path = '') {
  const s = posix(path);
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  if (i < 0) return '';
  return i > 0 ? s.slice(0, i) : '/';
}

export function joinPath(dir, name) {
  return `${String(dir).replace(/\/+$/, '')}/${name}`;
}

/* ----------------------------------------------------------------- 根目录 */

/** 虚拟根：宿主的「文档」目录。 */
export async function homeDir() {
  return HOME;
}

/** 默认写入目录：本机库目录（虚拟的 `/AudioStudio`）。 */
export async function appDir() {
  // 顺手把目录建出来：第一次打开媒体浏览器时不想看到「目录不存在」。
  try {
    await libraryDir();
  } catch { /* 宿主不在时交给 OPFS 兜底 */ }
  return APP_ROOT;
}

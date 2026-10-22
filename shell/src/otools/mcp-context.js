/**
 * audio 插件 MCP 领域工具的「活上下文」。
 * ------------------------------------------------------------------
 * 参照 otools-puter-video / spreadsheet：入口在应用就绪后调
 * `setAudioMcpContext()` 把 `editorContext` 交进来，工具被调用时再解析——
 * 没打开 session 就给一句可行动的错。
 *
 * 上下文形状（由 `shell/overlay/src/main.js` 提供）：
 *
 *   { editorContext }   // () => app.active（当前 Session）；在首页时可能是 null
 *
 * 领域工具只认当前 Session（model/session.js）：`session.state` 里有 `tracks`/`clips`，
 * 编辑走 `session.apply(label, nextState)`（可撤销，界面跟着变）。
 */

let context = null;

/** 由 overlay 入口在应用就绪后调用；传 null 表示重置（测试用）。 */
export function setAudioMcpContext(next) {
  context = next || null;
}

export function getAudioMcpContext() {
  return context;
}

/** 当前打开的 Session；没有时给出可行动的说明。 */
export function requireSession() {
  const session = context && typeof context.editorContext === 'function' ? context.editorContext() : null;
  if (!session || !session.state || typeof session.apply !== 'function') {
    throw new Error('No session is open in the editor. Open or create a session in the app, then retry.');
  }
  return session;
}

/** MCP 形状的文本结果。 */
export const text = (value) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
  isError: false,
});

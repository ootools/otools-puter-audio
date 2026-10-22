/**
 * audio 插件 MCP 工具汇总。
 * ------------------------------------------------------------------
 * 文件级工具在 `mcp.js`（list_library/read_file/write_file/library_path），领域级
 * 工具在 `mcp-audio-tools.js`。入口 `boot.js` 调
 * `installMcpBridge({ extraTools: audioMcpTools() })` 一并挂给宿主。
 */
import { mcpToolNames } from './mcp.js';
import { audioMcpTools } from './mcp-audio-tools.js';

export { audioMcpTools };

/** 完整工具名清单（文件级 + 领域级），顺序须与 plugin.json 的 mcp.expose 一致。 */
export function audioToolNames() {
  return [...mcpToolNames(), ...audioMcpTools().map((tool) => tool.name)];
}

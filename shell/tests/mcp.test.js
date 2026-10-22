// @vitest-environment jsdom
/**
 * 插件侧 MCP 桥的边界。
 *
 * 只测「契约」——宿主读 `window.__otoolsMcp` 能得到什么形状、异常怎么变成
 * isError、路径守卫挡不挡越界、写工具落点对不对；不测文案翻译（这些描述是
 * 给 AI 读的，本来就不进 i18n 词表）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const LIB = '/Users/local/Documents';

vi.mock('../src/otools/local.js', () => ({
  libraryDir: vi.fn(),
}));

vi.mock('../src/otools/host.js', () => ({
  joinPath: vi.fn(async (...parts) => parts.filter(Boolean).join('/')),
  dirName: vi.fn((p) => {
    const at = String(p).lastIndexOf('/');
    return at > 0 ? String(p).slice(0, at) : '';
  }),
  listDir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  createDir: vi.fn(),
}));

import { installMcpBridge, mcpToolDefs, mcpToolNames } from '../src/otools/mcp.js';
import { libraryDir } from '../src/otools/local.js';
import * as host from '../src/otools/host.js';
import { audioMcpTools, audioToolNames } from '../src/otools/mcp-tools.js';
import { setAudioMcpContext } from '../src/otools/mcp-context.js';

const bridge = () => window.__otoolsMcp;

/** 一个内存假 Session：只实现领域工具真正用到的那几个成员。 */
function fakeSession() {
  const state = {
    sampleRate: 48000,
    master: { id: 'master', type: 'master', name: 'Mix', volume: 0, pan: 0 },
    tracks: [
      { id: 't1', type: 'audio', name: 'Track 1', volume: 0, pan: 0, mute: false, solo: false },
      { id: 't2', type: 'audio', name: 'Track 2', volume: 0, pan: 0, mute: false, solo: false },
    ],
    clips: [
      {
        id: 'c1', trackId: 't1', name: 'Clip A', start: 0, offset: 0, length: 48000,
        gain: 0, fadeIn: { length: 0, curve: 0 }, fadeOut: { length: 0, curve: 0 },
        volumeEnv: [], panEnv: [], mute: false, locked: false,
      },
    ],
  };
  const s = {
    name: 'Session',
    sampleRate: 48000,
    state,
    cursor: 0,
    selection: { start: 0, end: 0, channels: [true, true], tracks: [] },
    selectedClips: new Set(),
    get duration() {
      return state.clips.reduce((n, c) => Math.max(n, c.start + c.length), 0);
    },
    apply(label, next) {
      if (!next || next === s.state) return false;
      s.state = next;
      return true;
    },
    setCursor(frame) {
      s.cursor = frame;
    },
    selectClips(ids) {
      s.selectedClips = new Set(ids);
    },
  };
  return s;
}

describe('MCP 桥', () => {
  beforeEach(() => {
    delete window.__otoolsMcp;
    vi.clearAllMocks();
    libraryDir.mockResolvedValue(LIB);
    host.listDir.mockResolvedValue([]);
    host.readFile.mockResolvedValue(null);
    installMcpBridge({ extraTools: audioMcpTools() });
  });

  it('挂载 window.__otoolsMcp 且暴露 listTools/call', () => {
    expect(typeof bridge().listTools).toBe('function');
    expect(typeof bridge().call).toBe('function');
  });

  it('listTools 返回带 name/inputSchema/annotations 的工具表', async () => {
    const tools = await bridge().listTools();
    expect(tools.map((tool) => tool.name)).toEqual(audioToolNames());
    for (const tool of tools) {
      expect(typeof tool.name).toBe('string');
      expect(tool.inputSchema).toBeTypeOf('object');
      expect(tool.annotations).toBeTypeOf('object');
    }
  });

  it('list_library 映射宿主条目并跳过库标记文件', async () => {
    host.listDir.mockResolvedValue([
      { name: 'audio-studio.json', isDir: false, size: 1, modified: 1 },
      { name: 'a.docx', isDir: false, size: 12, modified: 5 },
      { name: 'archive', isDir: true, size: 0, modified: 6 },
    ]);

    const result = await bridge().call('list_library', {});
    expect(result.isError).toBe(false);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.entries).toEqual([
      { path: 'a.docx', name: 'a.docx', kind: 'file', size: 12, modified: 5 },
      { path: 'archive', name: 'archive', kind: 'directory', size: 0, modified: 6 },
    ]);
    expect(host.listDir).toHaveBeenCalledWith(LIB);
  });

  it('list_library 支持子目录并把相对路径拼进条目', async () => {
    host.listDir.mockResolvedValue([{ name: 'q3.docx', isDir: false, size: 3, modified: 9 }]);
    const result = await bridge().call('list_library', { path: 'reports' });
    const payload = JSON.parse(result.content[0].text);
    expect(host.listDir).toHaveBeenCalledWith(`${LIB}/reports`);
    expect(payload.entries[0].path).toBe('reports/q3.docx');
  });

  it('read_file 返回 base64 内容与元信息', async () => {
    host.readFile.mockResolvedValue({
      name: 'a.txt',
      size: 2,
      mime: 'text/plain',
      dataBase64: 'aGk=',
    });
    const result = await bridge().call('read_file', { path: 'a.txt' });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text)).toEqual({
      path: 'a.txt',
      size: 2,
      mime: 'text/plain',
      base64: 'aGk=',
    });
  });

  it('read_file 拒绝跳出库目录的路径', async () => {
    const result = await bridge().call('read_file', { path: '../secret.txt' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/inside the library folder/);
    expect(host.readFile).not.toHaveBeenCalled();
  });

  it('read_file 拒绝绝对路径', async () => {
    const result = await bridge().call('read_file', { path: '/etc/passwd' });
    expect(result.isError).toBe(true);
    expect(host.readFile).not.toHaveBeenCalled();
  });

  it('read_file 对不存在的文件返回 isError', async () => {
    const result = await bridge().call('read_file', { path: 'missing.txt' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/No such file/);
  });

  it('write_file 建父目录并写入 base64', async () => {
    const result = await bridge().call('write_file', {
      path: 'exports/deck.pptx',
      base64: 'aGk=',
    });
    expect(result.isError).toBe(false);
    expect(host.createDir).toHaveBeenCalledWith(`${LIB}/exports`);
    expect(host.writeFile).toHaveBeenCalledWith(`${LIB}/exports/deck.pptx`, 'aGk=');
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      path: 'exports/deck.pptx',
      bytes: 2,
    });
  });

  it('write_file 缺 base64 时返回 isError 且不落盘', async () => {
    const result = await bridge().call('write_file', { path: 'a.txt' });
    expect(result.isError).toBe(true);
    expect(host.writeFile).not.toHaveBeenCalled();
  });

  it('业务能力抛错时由桥转成 isError', async () => {
    host.listDir.mockRejectedValue(new Error('disk gone'));
    const result = await bridge().call('list_library', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('disk gone');
  });

  it('未知工具返回 isError，而不是抛异常', async () => {
    const result = await bridge().call('nope', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Unknown tool/);
  });

  it('宿主不在时给出可行动的说明', async () => {
    libraryDir.mockResolvedValue('');
    const result = await bridge().call('list_library', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/OTools host is not available/);
  });

  it('extraTools 可以追加领域工具，run 不会外泄给宿主', async () => {
    delete window.__otoolsMcp;
    const run = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }], isError: false }));
    installMcpBridge({ extraTools: [{ name: 'domain_tool', description: 'x', run }] });

    const tools = await bridge().listTools();
    const added = tools.find((tool) => tool.name === 'domain_tool');
    expect(added).toBeTruthy();
    expect(added.run).toBeUndefined();

    const result = await bridge().call('domain_tool', { a: 1 });
    expect(run).toHaveBeenCalledWith({ a: 1 });
    expect(result.content[0].text).toBe('ok');
  });

  it('工具表与 plugin.json 的 mcp 声明一致', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(here, '..', '..', 'plugin.json'), 'utf8'),
    );
    expect(manifest.mcp.enabled).toBe(true);
    expect(manifest.mcp.backend).toBe('webview');
    expect(manifest.mcp.namespace).toBe('puter-audio');
    expect(manifest.mcp.expose).toEqual(audioToolNames());
    for (const tool of [...mcpToolDefs(), ...audioMcpTools()]) {
      expect(manifest.mcp.annotations?.[tool.name]).toBeTypeOf('object');
    }
  });
});

describe('MCP 领域工具（audio）', () => {
  let session;
  beforeEach(() => {
    delete window.__otoolsMcp;
    vi.clearAllMocks();
    installMcpBridge({ extraTools: audioMcpTools() });
    session = fakeSession();
    setAudioMcpContext({ editorContext: () => session });
  });

  it('get_session 报出名称/采样率/时长/轨道与片段数', async () => {
    const result = await bridge().call('get_session', {});
    expect(result.isError).toBe(false);
    const payload = JSON.parse(result.content[0].text);
    expect(payload).toMatchObject({ name: 'Session', sampleRate: 48000, durationSeconds: 1, trackCount: 2, clipCount: 1 });
  });

  it('list_tracks / list_clips / read_clip 读出结构', async () => {
    const t = JSON.parse((await bridge().call('list_tracks', {})).content[0].text);
    expect(t.tracks.map((x) => x.id)).toEqual(['t1', 't2']);
    expect(t.tracks[0].clipCount).toBe(1);
    const c = JSON.parse((await bridge().call('list_clips', {})).content[0].text);
    expect(c.clips[0]).toMatchObject({ id: 'c1', trackId: 't1', startSeconds: 0, lengthSeconds: 1 });
    const one = JSON.parse((await bridge().call('read_clip', { clipId: 'c1' })).content[0].text);
    expect(one).toMatchObject({ id: 'c1', gainDb: 0 });
  });

  it('set_clip_gain 改增益并落到 state', async () => {
    const result = await bridge().call('set_clip_gain', { clipId: 'c1', gainDb: -6 });
    expect(result.isError).toBe(false);
    expect(session.state.clips[0].gain).toBe(-6);
  });

  it('set_clip_fade 设淡入长度（秒→帧）', async () => {
    const result = await bridge().call('set_clip_fade', { clipId: 'c1', dir: 'in', lengthSeconds: 0.5 });
    expect(result.isError).toBe(false);
    expect(session.state.clips[0].fadeIn.length).toBe(24000);
    expect(JSON.parse(result.content[0].text).lengthSeconds).toBe(0.5);
  });

  it('move_clip 改起点并跨轨', async () => {
    const result = await bridge().call('move_clip', { clipId: 'c1', startSeconds: 2, trackId: 't2' });
    expect(result.isError).toBe(false);
    const c = session.state.clips[0];
    expect(c.start).toBe(96000);
    expect(c.trackId).toBe('t2');
  });

  it('trim_clip 裁掉尾部', async () => {
    const result = await bridge().call('trim_clip', { clipId: 'c1', edge: 'out', toSeconds: 0.5 });
    expect(result.isError).toBe(false);
    expect(session.state.clips[0].length).toBe(24000);
  });

  it('split_clip 在指定位置切成两段', async () => {
    const result = await bridge().call('split_clip', { clipId: 'c1', atSeconds: 0.5 });
    expect(result.isError).toBe(false);
    expect(session.state.clips.length).toBe(2);
  });

  it('remove_clip 删掉片段', async () => {
    const result = await bridge().call('remove_clip', { clipId: 'c1' });
    expect(result.isError).toBe(false);
    expect(session.state.clips.length).toBe(0);
  });

  it('rename_track / set_track_level / add_track 改轨道', async () => {
    const rn = await bridge().call('rename_track', { trackId: 't1', name: 'Vocals' });
    expect(JSON.parse(rn.content[0].text).name).toBe('Vocals');
    expect(session.state.tracks[0].name).toBe('Vocals');
    const lv = await bridge().call('set_track_level', { trackId: 't1', volumeDb: -3, mute: true });
    expect(lv.isError).toBe(false);
    expect(session.state.tracks[0]).toMatchObject({ volume: -3, mute: true });
    const add = await bridge().call('add_track', { name: 'FX' });
    expect(add.isError).toBe(false);
    expect(session.state.tracks.length).toBe(3);
    expect(session.state.tracks[2].name).toBe('FX');
  });

  it('set_playhead 与 select_clips 生效', async () => {
    await bridge().call('set_playhead', { seconds: 0.5 });
    expect(session.cursor).toBe(24000);
    const sel = await bridge().call('select_clips', { clipIds: ['c1'] });
    expect(JSON.parse(sel.content[0].text).selected).toEqual(['c1']);
  });

  it('未知片段返回 isError', async () => {
    const result = await bridge().call('set_clip_gain', { clipId: 'nope', gainDb: 0 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Unknown clip/);
  });

  it('没打开 session 时领域工具给出可行动说明', async () => {
    setAudioMcpContext({ editorContext: () => null });
    const result = await bridge().call('get_session', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/No session is open/);
  });
});

/**
 * audio 插件的领域级 MCP 工具（"应用级"MCP 第一批）。
 * ------------------------------------------------------------------
 * 直接驱动当前 Session（`model/session.js`）：读轨道/片段、改增益/淡入淡出/位置/
 * 裁剪/切分/删除、加轨/改名/推子、设播放头与选中。每个写操作都经
 * `session.apply(label, nextState)`——和界面编辑同一撤销栈，UI 会跟着变。
 *
 * 时间：对外一律**秒**，内部换帧（`session.sampleRate`）。
 * 由 `mcp-tools.js` 汇总，入口 `installMcpBridge({ extraTools })` 挂给宿主。
 */
import { requireSession, text } from './mcp-context.js';
import {
  findClip,
  findTrack,
  createTrack,
  addTrack,
  updateTrack,
  updateClips,
  removeClips,
  moveClips,
  splitClips,
  trimClip,
  setFade,
  audioTracks,
} from '../model/session-edits.js';

/** 秒 → 帧。 */
const frames = (session, seconds) => Math.round(Number(seconds) * session.sampleRate);
/** 帧 → 秒（三位小数）。 */
const secs = (session, f) => Math.round(((Number(f) || 0) / session.sampleRate) * 1000) / 1000;

function clipSummary(session, c) {
  return {
    id: c.id,
    trackId: c.trackId,
    name: c.name,
    startSeconds: secs(session, c.start),
    lengthSeconds: secs(session, c.length),
    gainDb: c.gain ?? 0,
    muted: Boolean(c.mute),
    locked: Boolean(c.locked),
  };
}

/** 提交新 state；没变化（锁定/无操作）时给出可读的错。 */
function commit(session, label, next) {
  if (!next || next === session.state) {
    throw new Error('Nothing changed: the clip may be locked, or the value is out of range.');
  }
  session.apply(label, next);
}

function needClip(session, id) {
  const clip = findClip(session.state, String(id || '').trim());
  if (!clip) throw new Error(`Unknown clip ${id}. Use list_clips to read ids.`);
  return clip;
}

function needTrack(session, id) {
  const track = findTrack(session.state, String(id || '').trim());
  if (!track) throw new Error(`Unknown track ${id}. Use list_tracks to read ids.`);
  return track;
}

async function runGetSession() {
  const s = requireSession();
  const st = s.state;
  return text({
    name: s.name,
    sampleRate: s.sampleRate,
    durationSeconds: secs(s, s.duration),
    playheadSeconds: secs(s, s.cursor),
    selection: { startSeconds: secs(s, s.selection.start), endSeconds: secs(s, s.selection.end) },
    trackCount: st.tracks.length,
    clipCount: st.clips.length,
  });
}

async function runListTracks() {
  const s = requireSession();
  return text({
    tracks: s.state.tracks.map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      volumeDb: t.volume ?? 0,
      pan: t.pan ?? 0,
      mute: Boolean(t.mute),
      solo: Boolean(t.solo),
      clipCount: s.state.clips.filter((c) => c.trackId === t.id).length,
    })),
  });
}

async function runListClips(args) {
  const s = requireSession();
  const trackId = args.trackId ? String(args.trackId) : null;
  const clips = s.state.clips
    .filter((c) => !trackId || c.trackId === trackId)
    .sort((a, b) => a.start - b.start)
    .map((c) => clipSummary(s, c));
  return text({ clips });
}

async function runReadClip(args) {
  const s = requireSession();
  const c = needClip(s, args.clipId);
  return text({
    ...clipSummary(s, c),
    offsetSeconds: secs(s, c.offset),
    fadeIn: { lengthSeconds: secs(s, c.fadeIn?.length || 0), curve: c.fadeIn?.curve ?? 0 },
    fadeOut: { lengthSeconds: secs(s, c.fadeOut?.length || 0), curve: c.fadeOut?.curve ?? 0 },
    sourceId: c.sourceId || null,
  });
}

async function runSetClipGain(args) {
  const s = requireSession();
  const c = needClip(s, args.clipId);
  const gain = Number(args.gainDb);
  if (!Number.isFinite(gain)) throw new Error('gainDb must be a number (dB, 0 = unchanged).');
  commit(s, 'MCP: clip gain', updateClips(s.state, [c.id], { gain }));
  return text({ clipId: c.id, gainDb: gain });
}

async function runSetClipFade(args) {
  const s = requireSession();
  const c = needClip(s, args.clipId);
  const dir = String(args.dir || 'in');
  if (!['in', 'out'].includes(dir)) throw new Error("dir must be 'in' or 'out'.");
  const patch = {};
  if (args.lengthSeconds != null) {
    const len = frames(s, args.lengthSeconds);
    if (len < 0) throw new Error('lengthSeconds must be zero or more.');
    patch.length = len;
  }
  if (args.curve != null) patch.curve = Number(args.curve);
  if (!Object.keys(patch).length) throw new Error('Pass lengthSeconds and/or curve.');
  commit(s, 'MCP: clip fade', setFade(s.state, [c.id], dir, patch));
  const saved = findClip(s.state, c.id);
  const f = dir === 'in' ? saved.fadeIn : saved.fadeOut;
  return text({ clipId: c.id, dir, lengthSeconds: secs(s, f.length), curve: f.curve });
}

async function runMoveClip(args) {
  const s = requireSession();
  const c = needClip(s, args.clipId);
  let dt = 0;
  let dTrack = 0;
  if (args.startSeconds != null) dt = frames(s, args.startSeconds) - c.start;
  if (args.trackId) {
    const audio = audioTracks(s.state);
    const from = audio.findIndex((t) => t.id === c.trackId);
    const to = audio.findIndex((t) => t.id === String(args.trackId));
    if (to < 0) throw new Error(`Unknown audio track ${args.trackId}.`);
    dTrack = to - from;
  }
  if (!dt && !dTrack) throw new Error('Pass startSeconds and/or trackId (a different value).');
  commit(s, 'MCP: move clip', moveClips(s.state, [c.id], dt, dTrack));
  const saved = findClip(s.state, c.id);
  return text(clipSummary(s, saved));
}

async function runTrimClip(args) {
  const s = requireSession();
  const c = needClip(s, args.clipId);
  const edge = String(args.edge || 'in');
  if (!['in', 'out'].includes(edge)) throw new Error("edge must be 'in' or 'out'.");
  if (args.toSeconds == null) throw new Error('toSeconds is required.');
  commit(s, 'MCP: trim clip', trimClip(s.state, c.id, edge, frames(s, args.toSeconds)));
  const saved = findClip(s.state, c.id);
  return text(clipSummary(s, saved));
}

async function runSplitClip(args) {
  const s = requireSession();
  const c = needClip(s, args.clipId);
  if (args.atSeconds == null) throw new Error('atSeconds is required.');
  commit(s, 'MCP: split clip', splitClips(s.state, [c.id], frames(s, args.atSeconds)));
  const parts = s.state.clips.filter((x) => x.trackId === c.trackId).sort((a, b) => a.start - b.start).map((x) => x.id);
  return text({ clipId: c.id, atSeconds: Number(args.atSeconds), trackClips: parts });
}

async function runRemoveClip(args) {
  const s = requireSession();
  const c = needClip(s, args.clipId);
  commit(s, 'MCP: remove clip', removeClips(s.state, [c.id]));
  return text({ removed: c.id });
}

async function runRenameTrack(args) {
  const s = requireSession();
  const t = needTrack(s, args.trackId);
  const name = String(args.name || '').trim();
  if (!name) throw new Error('name is required.');
  commit(s, 'MCP: rename track', updateTrack(s.state, t.id, { name }));
  return text({ trackId: t.id, name });
}

async function runSetTrackLevel(args) {
  const s = requireSession();
  const t = needTrack(s, args.trackId);
  const patch = {};
  if (args.volumeDb != null) patch.volume = Number(args.volumeDb);
  if (args.pan != null) patch.pan = Number(args.pan);
  if (args.mute != null) patch.mute = Boolean(args.mute);
  if (args.solo != null) patch.solo = Boolean(args.solo);
  if (!Object.keys(patch).length) throw new Error('Pass volumeDb, pan, mute and/or solo.');
  commit(s, 'MCP: track level', updateTrack(s.state, t.id, patch));
  const saved = findTrack(s.state, t.id);
  return text({ trackId: t.id, volumeDb: saved.volume, pan: saved.pan, mute: saved.mute, solo: saved.solo });
}

async function runAddTrack(args) {
  const s = requireSession();
  const track = createTrack({ name: args.name ? String(args.name) : undefined });
  commit(s, 'MCP: add track', addTrack(s.state, track));
  return text({ trackId: track.id, name: track.name, type: track.type });
}

async function runSetPlayhead(args) {
  const s = requireSession();
  if (args.seconds == null) throw new Error('seconds is required.');
  s.setCursor(frames(s, args.seconds));
  return text({ playheadSeconds: secs(s, s.cursor) });
}

async function runSelectClips(args) {
  const s = requireSession();
  const ids = (Array.isArray(args.clipIds) ? args.clipIds : [args.clipId])
    .map((v) => String(v == null ? '' : v).trim())
    .filter(Boolean);
  const missing = ids.filter((id) => !findClip(s.state, id));
  if (missing.length) throw new Error(`Unknown clip id(s): ${missing.join(', ')}`);
  s.selectClips(ids, 'set');
  return text({ selected: [...s.selectedClips] });
}

export function audioMcpTools() {
  return [
    {
      name: 'get_session',
      title: 'Describe the open session',
      description:
        'Return the open audio session: name, sample rate, duration, playhead, selection, and how many tracks and clips it has. Call this first.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false },
      run: runGetSession,
    },
    {
      name: 'list_tracks',
      title: 'List tracks',
      description: 'List the session tracks with id, name, type, level (dB), pan, mute/solo and clip count.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false },
      run: runListTracks,
    },
    {
      name: 'list_clips',
      title: 'List clips',
      description:
        'List clips in timeline order with id, track, name, start/length (seconds), gain, mute and lock. Pass trackId to list one track only.',
      inputSchema: {
        type: 'object',
        properties: { trackId: { type: 'string', description: 'Only list clips on this track.' } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      run: runListClips,
    },
    {
      name: 'read_clip',
      title: 'Read one clip',
      description: 'Return one clip in detail: times (seconds), gain, fade in/out, source and flags.',
      inputSchema: {
        type: 'object',
        properties: { clipId: { type: 'string', description: 'Clip id from list_clips.' } },
        required: ['clipId'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
      run: runReadClip,
    },
    {
      name: 'set_clip_gain',
      title: 'Set a clip’s gain',
      description: 'Set a clip’s gain in dB (0 = unchanged, negative quieter). One undoable step.',
      inputSchema: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'Clip id from list_clips.' },
          gainDb: { type: 'number', description: 'Gain in dB.' },
        },
        required: ['clipId', 'gainDb'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      run: runSetClipGain,
    },
    {
      name: 'set_clip_fade',
      title: 'Set a clip’s fade in or out',
      description: 'Set the fade length (seconds) and/or curve for the in or out edge of a clip.',
      inputSchema: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'Clip id from list_clips.' },
          dir: { type: 'string', enum: ['in', 'out'], description: 'Which fade: in or out.' },
          lengthSeconds: { type: 'number', description: 'Fade length in seconds (0 clears it).' },
          curve: { type: 'number', description: 'Fade curve shape (0 = linear).' },
        },
        required: ['clipId', 'dir'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      run: runSetClipFade,
    },
    {
      name: 'move_clip',
      title: 'Move a clip',
      description: 'Move a clip to a new start time (seconds) and/or another audio track. Clamped to the timeline.',
      inputSchema: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'Clip id from list_clips.' },
          startSeconds: { type: 'number', description: 'New start time in seconds.' },
          trackId: { type: 'string', description: 'Target audio track id.' },
        },
        required: ['clipId'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      run: runMoveClip,
    },
    {
      name: 'trim_clip',
      title: 'Trim a clip edge',
      description: 'Trim the in or out edge of a clip to a timeline position (seconds).',
      inputSchema: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'Clip id from list_clips.' },
          edge: { type: 'string', enum: ['in', 'out'], description: 'Edge to trim: in (start) or out (end).' },
          toSeconds: { type: 'number', description: 'New timeline position of that edge, in seconds.' },
        },
        required: ['clipId', 'edge', 'toSeconds'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      run: runTrimClip,
    },
    {
      name: 'split_clip',
      title: 'Split a clip',
      description: 'Split a clip at a timeline position (seconds) into two clips.',
      inputSchema: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'Clip id from list_clips.' },
          atSeconds: { type: 'number', description: 'Timeline position to split at, in seconds.' },
        },
        required: ['clipId', 'atSeconds'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      run: runSplitClip,
    },
    {
      name: 'remove_clip',
      title: 'Remove a clip',
      description: 'Remove a clip from the timeline. Undoable.',
      inputSchema: {
        type: 'object',
        properties: { clipId: { type: 'string', description: 'Clip id from list_clips.' } },
        required: ['clipId'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
      run: runRemoveClip,
    },
    {
      name: 'rename_track',
      title: 'Rename a track',
      description: 'Rename a track.',
      inputSchema: {
        type: 'object',
        properties: {
          trackId: { type: 'string', description: 'Track id from list_tracks.' },
          name: { type: 'string', description: 'New name.' },
        },
        required: ['trackId', 'name'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      run: runRenameTrack,
    },
    {
      name: 'set_track_level',
      title: 'Set track level, pan, mute or solo',
      description: 'Set a track’s volume (dB), pan, mute and/or solo.',
      inputSchema: {
        type: 'object',
        properties: {
          trackId: { type: 'string', description: 'Track id from list_tracks.' },
          volumeDb: { type: 'number', description: 'Track volume in dB.' },
          pan: { type: 'number', description: 'Pan, -100..100.' },
          mute: { type: 'boolean' },
          solo: { type: 'boolean' },
        },
        required: ['trackId'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      run: runSetTrackLevel,
    },
    {
      name: 'add_track',
      title: 'Add an audio track',
      description: 'Append a new audio track. Returns its id and name.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Optional track name.' } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      run: runAddTrack,
    },
    {
      name: 'set_playhead',
      title: 'Set the playhead',
      description: 'Move the playhead (cursor) to a time in seconds.',
      inputSchema: {
        type: 'object',
        properties: { seconds: { type: 'number', description: 'Time in seconds.' } },
        required: ['seconds'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      run: runSetPlayhead,
    },
    {
      name: 'select_clips',
      title: 'Select clips',
      description: 'Set the clip selection to the given ids (empty deselects). Many edits and commands act on the selection.',
      inputSchema: {
        type: 'object',
        properties: {
          clipIds: { type: 'array', items: { type: 'string' }, description: 'Clip ids to select.' },
          clipId: { type: 'string', description: 'Single clip id (alternative).' },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      run: runSelectClips,
    },
  ];
}

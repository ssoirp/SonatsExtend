'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  DEFAULT_CONFIG, type Config,
  type SongConfig, type SongConfigMap, type SongData,
  loadProject, saveProject, getActiveProjectId,
  exportPlaylistConfig,
} from '@/lib/state';
import { hasToken, playTrack, pausePlayback, seekTo, getPlaybackState } from '@/lib/spotify';

type Song = SongData;

function formatMs(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const t = Math.floor((ms % 1000) / 100);
  return `${m}:${String(s).padStart(2, '0')}.${t}`;
}

function parseMsInput(input: string): number | null {
  const trimmed = input.trim();
  const colonMatch = trimmed.match(/^(\d+):(\d{1,2})(?:\.(\d))?$/);
  if (colonMatch) {
    const mins = parseInt(colonMatch[1]);
    const secs = parseInt(colonMatch[2]);
    const tenths = parseInt(colonMatch[3] || '0');
    return (mins * 60 + secs) * 1000 + tenths * 100;
  }
  const numMatch = trimmed.match(/^(\d+(?:\.\d+)?)$/);
  if (numMatch) return Math.round(parseFloat(numMatch[1]) * 1000);
  return null;
}

function getEffectiveInMs(song: Song, cfg: SongConfig | undefined, globalCfg: Config): number | null {
  if (cfg?.inMs !== undefined) return cfg.inMs;
  const idx = cfg?.inCue ?? globalCfg.inCue;
  const val = { ...song.cues, ...cfg?.cues }[String(idx)];
  return val !== undefined ? val : null;
}

function getEffectiveOutMs(song: Song, cfg: SongConfig | undefined, globalCfg: Config): number | null {
  if (cfg?.outMs !== undefined) return cfg.outMs;
  const idx = cfg?.outCue ?? globalCfg.outCue;
  const val = { ...song.cues, ...cfg?.cues }[String(idx)];
  return val !== undefined ? val : null;
}

type SongStatus = 'ok' | 'missing-in' | 'missing-out' | 'no-cues';

function getSongStatus(song: Song, cfg: SongConfig | undefined, globalCfg: Config): SongStatus {
  const hasIn = getEffectiveInMs(song, cfg, globalCfg) !== null;
  const hasOut = getEffectiveOutMs(song, cfg, globalCfg) !== null;
  if (hasIn && hasOut) return 'ok';
  if (!hasIn && !hasOut) return 'no-cues';
  if (!hasIn) return 'missing-in';
  return 'missing-out';
}

const STATUS_BADGE: Record<SongStatus, { label: string; bg: string; color: string }> = {
  ok:           { label: 'Configurat', bg: 'rgba(29,185,84,0.14)',  color: '#4dcf74' },
  'missing-in': { label: 'Falta IN',   bg: 'rgba(240,165,0,0.14)', color: '#f0a500' },
  'missing-out':{ label: 'Falta OUT',  bg: 'rgba(240,165,0,0.14)', color: '#f0a500' },
  'no-cues':    { label: 'Sense cues', bg: 'rgba(255,71,87,0.14)', color: '#ff6b6b' },
};

function PlaybackBar({
  durationMs, inMs, outMs, positionMs, isActive,
  onSeek, onInChange, onOutChange,
}: {
  durationMs: number;
  inMs: number | null;
  outMs: number | null;
  positionMs: number;
  isActive: boolean;
  onSeek: (ms: number) => void;
  onInChange: (ms: number) => void;
  onOutChange: (ms: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'in' | 'out' | null>(null);

  const msToPercent = (ms: number) => Math.max(0, Math.min(100, (ms / durationMs) * 100));

  function getMsFromEvent(e: React.MouseEvent | MouseEvent) {
    const rect = barRef.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    return Math.round((x / rect.width) * durationMs);
  }

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const ms = getMsFromEvent(e);
      if (dragging === 'in') onInChange(ms);
      else onOutChange(ms);
    };
    const onUp = () => setDragging(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, durationMs]);

  function handleBarClick(e: React.MouseEvent) {
    if (dragging) return;
    onSeek(getMsFromEvent(e));
  }

  const inPct = inMs !== null ? msToPercent(inMs) : null;
  const outPct = outMs !== null ? msToPercent(outMs) : null;
  const posPct = isActive ? msToPercent(positionMs) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div
        ref={barRef}
        onClick={handleBarClick}
        style={{
          position: 'relative', height: 28, borderRadius: 6,
          background: 'rgba(255,255,255,0.05)',
          cursor: 'pointer', userSelect: 'none',
          overflow: 'visible',
        }}
      >
        {/* Active region highlight */}
        {inPct !== null && outPct !== null && (
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${inPct}%`, width: `${outPct - inPct}%`,
            background: 'rgba(29,185,84,0.12)',
            borderRadius: 4,
          }} />
        )}

        {/* IN marker */}
        {inPct !== null && (
          <div
            onMouseDown={e => { e.stopPropagation(); setDragging('in'); }}
            style={{
              position: 'absolute', top: -2, bottom: -2,
              left: `${inPct}%`, transform: 'translateX(-50%)',
              width: 10, cursor: 'ew-resize', zIndex: 2,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <div style={{
              width: 3, height: '100%', borderRadius: 2,
              background: '#f0a500',
              boxShadow: '0 0 6px rgba(240,165,0,0.4)',
            }} />
          </div>
        )}

        {/* OUT marker */}
        {outPct !== null && (
          <div
            onMouseDown={e => { e.stopPropagation(); setDragging('out'); }}
            style={{
              position: 'absolute', top: -2, bottom: -2,
              left: `${outPct}%`, transform: 'translateX(-50%)',
              width: 10, cursor: 'ew-resize', zIndex: 2,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <div style={{
              width: 3, height: '100%', borderRadius: 2,
              background: '#a78bfa',
              boxShadow: '0 0 6px rgba(167,139,250,0.4)',
            }} />
          </div>
        )}

        {/* Playhead */}
        {posPct !== null && (
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${posPct}%`, transform: 'translateX(-50%)',
            width: 2, background: '#1DB954',
            boxShadow: '0 0 4px rgba(29,185,84,0.5)',
            zIndex: 3, pointerEvents: 'none',
            borderRadius: 1,
          }} />
        )}

        {/* Cue tick marks */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {/* Duration label right-aligned */}
          <span style={{
            position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
            fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text3)', opacity: 0.5,
          }}>
            {formatMs(durationMs)}
          </span>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
        {inMs !== null && (
          <span style={{ color: '#f0a500' }}>IN {formatMs(inMs)}</span>
        )}
        {outMs !== null && (
          <span style={{ color: '#a78bfa' }}>OUT {formatMs(outMs)}</span>
        )}
        {inMs !== null && outMs !== null && (
          <span style={{ color: 'var(--text3)' }}>
            durada: {formatMs(outMs - inMs)}
          </span>
        )}
      </div>
    </div>
  );
}

interface SongEditorProps {
  song: Song;
  globalConfig: Config;
  songCfg: SongConfig | undefined;
  onChange: (cfg: SongConfig) => void;
  isActive: boolean;
  isPlaying: boolean;
  positionMs: number;
  onPlay: (startMs: number) => void;
  onPause: () => void;
  onPreview: () => void;
  onSeek: (ms: number) => void;
  onDelete: () => void;
}

function SongEditor({
  song, globalConfig, songCfg, onChange,
  isActive, isPlaying, positionMs, onPlay, onPause, onPreview, onSeek, onDelete,
}: SongEditorProps) {
  const [expanded, setExpanded] = useState(false);
  const [inInput, setInInput] = useState('');
  const [outInput, setOutInput] = useState('');
  const inMs = getEffectiveInMs(song, songCfg, globalConfig);
  const outMs = getEffectiveOutMs(song, songCfg, globalConfig);
  const status = getSongStatus(song, songCfg, globalConfig);
  const badge = STATUS_BADGE[status];
  const allCues = { ...song.cues, ...songCfg?.cues };
  const cueIndices = Array.from(new Set(Object.keys(allCues).map(Number))).sort((a, b) => a - b);

  useEffect(() => {
    setInInput(inMs !== null ? formatMs(inMs) : '');
    setOutInput(outMs !== null ? formatMs(outMs) : '');
  }, [inMs, outMs]);

  function update(patch: Partial<SongConfig>) {
    onChange({ ...(songCfg || {}), ...patch });
  }

  function handleInInputBlur() {
    const ms = parseMsInput(inInput);
    if (ms !== null) {
      update({ inMs: ms, inCue: undefined });
    } else {
      setInInput(inMs !== null ? formatMs(inMs) : '');
    }
  }

  function handleOutInputBlur() {
    const ms = parseMsInput(outInput);
    if (ms !== null) {
      update({ outMs: ms, outCue: undefined });
    } else {
      setOutInput(outMs !== null ? formatMs(outMs) : '');
    }
  }

  function clearIn() {
    const { inMs: _inMs, inCue: _inCue, ...rest } = songCfg || {};
    onChange(rest);
  }

  function clearOut() {
    const { outMs: _outMs, outCue: _outCue, ...rest } = songCfg || {};
    onChange(rest);
  }

  const positionDisplay = isActive ? formatMs(positionMs) : null;

  const rowBorderColor = isActive
    ? 'rgba(29,185,84,0.28)'
    : status !== 'ok'
      ? 'rgba(240,165,0,0.18)'
      : 'rgba(255,255,255,0.07)';

  return (
    <div style={{
      borderRadius: 12,
      background: '#161622',
      border: `1px solid ${rowBorderColor}`,
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '10px 14px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text)',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: isActive ? 'rgba(29,185,84,0.12)' : 'rgba(255,255,255,0.04)',
            color: isActive ? '#1DB954' : 'var(--text3)',
            fontSize: 13,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, marginTop: 2,
          }}>
            🎵
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{song.name}</p>
            <p style={{ fontSize: 11, color: 'var(--text3)' }}>{song.artist}</p>
            {!expanded && (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                IN: {inMs !== null ? formatMs(inMs) : '—'} → OUT: {outMs !== null ? formatMs(outMs) : '—'}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{
              fontSize: 11, fontWeight: 500,
              padding: '3px 9px', borderRadius: 6,
              background: badge.bg, color: badge.color,
            }}>
              {badge.label}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>{expanded ? '▲' : '▼'}</span>
          </div>
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="btn-ghost"
            style={{ color: 'var(--text3)', fontSize: 14, padding: '0 4px', flexShrink: 0 }}
            onMouseEnter={e => (e.currentTarget.style.color = '#ff4757')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text3)')}
          >
            ✕
          </button>
        </div>
      </button>

      {expanded && (
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.07)',
          padding: '12px 14px 16px',
          background: 'rgba(0,0,0,0.2)',
          display: 'flex', flexDirection: 'column', gap: 14,
        }}>
          {/* Mini player */}
          <div style={{
            background: 'rgba(0,0,0,0.25)',
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.07)',
            padding: '10px 12px',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {(!isActive || !isPlaying) ? (
                <button
                  onClick={() => onPlay(inMs ?? 0)}
                  className="btn-interact"
                  style={{
                    padding: '5px 12px', borderRadius: 7,
                    fontSize: 11, fontWeight: 600,
                    background: 'rgba(29,185,84,0.18)',
                    color: '#1DB954',
                  }}
                >
                  ▶ Play
                </button>
              ) : (
                <button
                  onClick={onPause}
                  className="btn-interact"
                  style={{
                    padding: '5px 12px', borderRadius: 7,
                    fontSize: 11, fontWeight: 600,
                    background: 'rgba(255,71,87,0.18)',
                    color: '#ff4757',
                  }}
                >
                  ⏸ Pausa
                </button>
              )}
              <button
                onClick={onPreview}
                disabled={inMs === null || outMs === null}
                className="btn-interact"
                style={{
                  padding: '5px 12px', borderRadius: 7,
                  fontSize: 11, fontWeight: 600,
                  background: 'rgba(167,139,250,0.14)',
                  color: '#a78bfa',
                  opacity: inMs === null || outMs === null ? 0.4 : 1,
                  cursor: inMs === null || outMs === null ? 'not-allowed' : 'pointer',
                }}
              >
                ⏩ Preview
              </button>
              {isActive && (
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12, color: '#1DB954',
                  marginLeft: 'auto',
                }}>
                  📍 {positionDisplay}
                </span>
              )}
            </div>

            {isActive && (
              <div className="fade-up" style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => update({ inMs: positionMs, inCue: undefined })}
                  className="btn-interact"
                  style={{
                    padding: '4px 10px', borderRadius: 6,
                    fontSize: 11,
                    background: 'rgba(240,165,0,0.18)',
                    color: '#f0a500',
                  }}
                >
                  ← Marcar IN
                </button>
                <button
                  onClick={() => update({ outMs: positionMs, outCue: undefined })}
                  className="btn-interact"
                  style={{
                    padding: '4px 10px', borderRadius: 6,
                    fontSize: 11,
                    background: 'rgba(167,139,250,0.18)',
                    color: '#a78bfa',
                  }}
                >
                  Marcar OUT →
                </button>
                <button
                  onClick={() => seekTo(inMs ?? 0).catch(() => {})}
                  className="btn-interact"
                  style={{
                    padding: '4px 10px', borderRadius: 6,
                    fontSize: 11,
                    background: 'rgba(255,255,255,0.07)',
                    color: 'var(--text2)',
                  }}
                >
                  ⏮ Anar a IN
                </button>
              </div>
            )}

            {/* Playback bar */}
            <PlaybackBar
              durationMs={song.duration_ms}
              inMs={inMs}
              outMs={outMs}
              positionMs={positionMs}
              isActive={isActive}
              onSeek={onSeek}
              onInChange={ms => update({ inMs: ms, inCue: undefined })}
              onOutChange={ms => update({ outMs: ms, outCue: undefined })}
            />
          </div>

          {/* IN / OUT inputs */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{
                fontSize: 10, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.08em',
                color: '#f0a500',
              }}>
                IN (m:ss.t)
              </label>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="text"
                  value={inInput}
                  onChange={e => setInInput(e.target.value)}
                  onBlur={handleInInputBlur}
                  onKeyDown={e => e.key === 'Enter' && handleInInputBlur()}
                  placeholder="0:00.0"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    padding: '7px 10px',
                    borderRadius: 8,
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: 'var(--text)',
                    flex: 1, minWidth: 0,
                    outline: 'none',
                  }}
                />
                {inMs !== null && (
                  <button
                    onClick={clearIn}
                    className="btn-ghost"
                    style={{ color: 'var(--text3)', fontSize: 14, padding: '0 2px' }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#ff4757')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--text3)')}
                  >
                    ✕
                  </button>
                )}
              </div>
              {inMs !== null && (
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
                  {inMs} ms
                </p>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{
                fontSize: 10, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.08em',
                color: '#a78bfa',
              }}>
                OUT (m:ss.t)
              </label>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="text"
                  value={outInput}
                  onChange={e => setOutInput(e.target.value)}
                  onBlur={handleOutInputBlur}
                  onKeyDown={e => e.key === 'Enter' && handleOutInputBlur()}
                  placeholder="0:00.0"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    padding: '7px 10px',
                    borderRadius: 8,
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: 'var(--text)',
                    flex: 1, minWidth: 0,
                    outline: 'none',
                  }}
                />
                {outMs !== null && (
                  <button
                    onClick={clearOut}
                    className="btn-ghost"
                    style={{ color: 'var(--text3)', fontSize: 14, padding: '0 2px' }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#ff4757')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--text3)')}
                  >
                    ✕
                  </button>
                )}
              </div>
              {outMs !== null && (
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
                  {outMs} ms
                </p>
              )}
            </div>
          </div>

          {/* Cues de Mixxx */}
          {cueIndices.length > 0 && (
            <details style={{ fontSize: 11 }}>
              <summary style={{
                color: 'var(--text3)',
                cursor: 'pointer',
                userSelect: 'none',
                listStyle: 'none',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <span style={{ fontSize: 9 }}>▶</span>
                Cues de Mixxx ({cueIndices.length})
              </summary>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ color: 'var(--text3)', fontSize: 10 }}>Cue IN</label>
                    <select
                      value={songCfg?.inCue ?? globalConfig.inCue}
                      onChange={e => update({ inCue: Number(e.target.value), inMs: undefined })}
                      style={{
                        background: '#26263a',
                        border: '1px solid rgba(255,255,255,0.07)',
                        borderRadius: 7,
                        padding: '5px 8px',
                        fontSize: 11,
                        color: 'var(--text)',
                        outline: 'none',
                      }}
                    >
                      {cueIndices.map(idx => (
                        <option key={idx} value={idx}>Cue {idx} ({formatMs(allCues[String(idx)] ?? 0)})</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ color: 'var(--text3)', fontSize: 10 }}>Cue OUT</label>
                    <select
                      value={songCfg?.outCue ?? globalConfig.outCue}
                      onChange={e => update({ outCue: Number(e.target.value), outMs: undefined })}
                      style={{
                        background: '#26263a',
                        border: '1px solid rgba(255,255,255,0.07)',
                        borderRadius: 7,
                        padding: '5px 8px',
                        fontSize: 11,
                        color: 'var(--text)',
                        outline: 'none',
                      }}
                    >
                      {cueIndices.map(idx => (
                        <option key={idx} value={idx}>Cue {idx} ({formatMs(allCues[String(idx)] ?? 0)})</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {cueIndices.map(idx => (
                    <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <label style={{ color: 'var(--text3)', fontSize: 10 }}>Cue {idx}</label>
                      <input
                        type="text"
                        value={allCues[String(idx)] !== undefined ? formatMs(allCues[String(idx)]) : ''}
                        onChange={e => {
                          const ms = parseMsInput(e.target.value);
                          if (ms !== null) {
                            update({ cues: { ...songCfg?.cues, [String(idx)]: ms } });
                          }
                        }}
                        placeholder="—"
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11,
                          width: 78,
                          padding: '5px 8px',
                          borderRadius: 7,
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.07)',
                          color: 'var(--text)',
                          outline: 'none',
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

export default function ConfigPage() {
  const router = useRouter();
  const [songs, setSongs] = useState<Song[]>([]);
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [songConfigs, setSongConfigs] = useState<SongConfigMap>({});
  const [projectName, setProjectName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [saved, setSaved] = useState(false);
  const [filter, setFilter] = useState<'all' | 'ok' | 'incomplete'>('all');
  const [search, setSearch] = useState('');
  const [showAddSong, setShowAddSong] = useState(false);
  const [newSongUri, setNewSongUri] = useState('');
  const [newSongName, setNewSongName] = useState('');
  const [newSongArtist, setNewSongArtist] = useState('');

  const [activeSongUri, setActiveSongUri] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [previewSongUri, setPreviewSongUri] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => {
    const id = getActiveProjectId();
    const project = loadProject(id);
    setProjectId(id);
    setProjectName(project.name);
    setSongs(project.songs);
    setConfig(project.config);
    setSongConfigs(project.songConfigs);
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const startPolling = useCallback((songUri: string, outMsLimit?: number) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const state = await getPlaybackState();
        if (!state) return;
        setPositionMs(state.position_ms);
        setIsPlaying(state.is_playing);
        if (!state.is_playing) {
          setPreviewSongUri(null);
        }
        if (outMsLimit !== undefined && state.position_ms >= outMsLimit) {
          stopPolling();
          await pausePlayback().catch(() => {});
          setIsPlaying(false);
          setPreviewSongUri(null);
        }
      } catch { /* ignore */ }
    }, 500);
  }, [stopPolling]);

  async function handlePlay(songUri: string, startMs: number) {
    if (!hasToken()) { router.push('/'); return; }
    try {
      await playTrack(songUri, startMs);
      setActiveSongUri(songUri);
      setIsPlaying(true);
      setPreviewSongUri(null);
      startPolling(songUri);
    } catch {
      alert('Error: comprova que Spotify estigui actiu en algun dispositiu');
    }
  }

  async function handlePause() {
    stopPolling();
    await pausePlayback().catch(() => {});
    setIsPlaying(false);
    setPreviewSongUri(null);
  }

  async function handlePreview(songUri: string) {
    const song = songs.find(s => s.uri === songUri);
    if (!song) return;
    const cfg = songConfigs[songUri];
    const inMs = getEffectiveInMs(song, cfg, config);
    const outMs = getEffectiveOutMs(song, cfg, config);
    if (inMs === null || outMs === null) return;
    if (!hasToken()) { router.push('/'); return; }
    try {
      await playTrack(songUri, inMs);
      setActiveSongUri(songUri);
      setIsPlaying(true);
      setPreviewSongUri(songUri);
      startPolling(songUri, outMs);
    } catch {
      alert('Error: comprova que Spotify estigui actiu en algun dispositiu');
    }
  }

  async function handleSeek(songUri: string, ms: number) {
    if (!hasToken()) { router.push('/'); return; }
    if (activeSongUri !== songUri) {
      await handlePlay(songUri, ms);
    } else {
      await seekTo(ms).catch(() => {});
      setPositionMs(ms);
    }
  }

  function updateSongConfig(songUri: string, cfg: SongConfig) {
    setSongConfigs(prev => ({ ...prev, [songUri]: cfg }));
  }

  function handleDeleteSong(uri: string) {
    setSongs(prev => prev.filter(s => s.uri !== uri));
    setSongConfigs(prev => {
      const next = { ...prev };
      delete next[uri];
      return next;
    });
    if (activeSongUri === uri) {
      handlePause();
      setActiveSongUri(null);
    }
  }

  function handleAddSong() {
    let uri = newSongUri.trim();
    if (!uri) return;
    if (uri.startsWith('https://open.spotify.com/track/')) {
      const id = uri.split('/track/')[1]?.split('?')[0];
      if (id) uri = `spotify:track:${id}`;
    }
    if (!uri.startsWith('spotify:track:')) {
      alert('URI invàlida. Format: spotify:track:XXXX o URL de Spotify');
      return;
    }
    if (songs.some(s => s.uri === uri)) {
      alert('Aquesta cançó ja existeix al projecte');
      return;
    }
    const newSong: Song = {
      uri,
      name: newSongName.trim() || 'Cançó sense nom',
      artist: newSongArtist.trim() || 'Artista desconegut',
      duration_ms: 240000,
      cues: {},
    };
    setSongs(prev => [...prev, newSong]);
    setNewSongUri('');
    setNewSongName('');
    setNewSongArtist('');
    setShowAddSong(false);
  }

  function handleSave() {
    saveProject({
      id: projectId,
      name: projectName,
      songs,
      config,
      songConfigs,
      played: loadProject(projectId).played,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleExport() {
    const data = exportPlaylistConfig(config, songConfigs, songs);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bingo-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (data.config) setConfig(data.config);
        if (data.songConfigs) setSongConfigs(data.songConfigs);
        if (data.songs) setSongs(data.songs);
      } catch {
        alert('Error llegint el fitxer de configuració');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  const configuredCount = songs.filter(s => getSongStatus(s, songConfigs[s.uri], config) === 'ok').length;

  const filteredSongs = songs.filter(song => {
    const status = getSongStatus(song, songConfigs[song.uri], config);
    if (filter === 'ok' && status !== 'ok') return false;
    if (filter === 'incomplete' && status === 'ok') return false;
    if (search && !song.name.toLowerCase().includes(search.toLowerCase()) && !song.artist.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  function field(label: string, key: keyof Config, note: string) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>{label}</label>
        <p style={{ fontSize: 10, color: 'var(--text3)' }}>{note}</p>
        <input
          type="number"
          value={config[key]}
          onChange={e => setConfig(c => ({ ...c, [key]: Number(e.target.value) }))}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 14,
            width: 72,
            padding: '7px 10px',
            borderRadius: 8,
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.07)',
            color: 'var(--text)',
            outline: 'none',
          }}
        />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', display: 'flex', flexDirection: 'column' }}>
      {/* Sticky header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: 'rgba(5,5,8,0.88)',
        backdropFilter: 'blur(14px)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        padding: '14px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <button
          onClick={() => router.push('/')}
          className="btn-ghost"
          style={{ color: 'var(--text2)', fontSize: 14 }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text2)')}
        >
          ← Inici
        </button>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 17, fontWeight: 700,
          color: 'var(--text)',
          position: 'absolute', left: '50%', transform: 'translateX(-50%)',
        }}>
          Configuració
        </h1>
        <button
          onClick={handleSave}
          className="btn-interact"
          style={{
            padding: '7px 18px',
            borderRadius: 10,
            fontSize: 13, fontWeight: 600,
            background: saved ? '#26263a' : '#1DB954',
            color: saved ? 'var(--text2)' : '#000',
            transition: 'background 0.2s, color 0.2s',
          }}
        >
          {saved ? '✓ Desat' : 'Desar'}
        </button>
      </header>

      <main style={{
        flex: 1,
        padding: '20px 20px 40px',
        display: 'flex', flexDirection: 'column', gap: 20,
        maxWidth: 720, width: '100%', margin: '0 auto',
      }}>
        {/* Opcions globals */}
        <div>
          <p style={{
            fontSize: 11, fontWeight: 700,
            color: 'var(--text3)',
            textTransform: 'uppercase', letterSpacing: '0.1em',
            marginBottom: 10,
          }}>
            Opcions globals
          </p>
          <div style={{
            background: '#161622',
            borderRadius: 16,
            border: '1px solid rgba(255,255,255,0.07)',
            padding: '16px 20px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 16,
          }}>
            {field('Hot cue IN', 'inCue', 'Índex cue d\'entrada')}
            {field('Hot cue OUT', 'outCue', 'Índex cue de sortida')}
            {field('Inici per defecte (s)', 'defaultInSec', 'Si no hi ha cue IN')}
            {field('Fi per defecte (s)', 'defaultOutSec', 'Si no hi ha cue OUT')}
          </div>
        </div>

        {/* Editor de cues */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <p style={{
              fontSize: 11, fontWeight: 700,
              color: 'var(--text3)',
              textTransform: 'uppercase', letterSpacing: '0.1em',
            }}>
              Editor de Cues
            </p>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text3)' }}>
              <span style={{ color: '#1DB954' }}>{configuredCount}</span> / {songs.length} configurades
            </span>
          </div>

          {/* Search + filter */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Cerca cançó..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                flex: 1, minWidth: 120,
                padding: '9px 14px',
                background: '#161622',
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: 10,
                fontSize: 13,
                color: 'var(--text)',
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: 4 }}>
              {(['all', 'ok', 'incomplete'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className="btn-interact"
                  style={{
                    padding: '8px 13px',
                    borderRadius: 10,
                    fontSize: 12,
                    background: filter === f ? 'rgba(255,255,255,0.11)' : 'rgba(255,255,255,0.04)',
                    color: filter === f ? 'var(--text)' : 'var(--text3)',
                  }}
                >
                  {f === 'all' ? 'Totes' : f === 'ok' ? '✓ OK' : '⚠ Incompletes'}
                </button>
              ))}
            </div>
          </div>

          {/* Active song indicator */}
          {activeSongUri && (
            <div style={{
              background: '#161622',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 10,
              padding: '8px 12px',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: isPlaying ? '#1DB954' : 'rgba(255,255,255,0.2)',
                animation: isPlaying ? 'dotPulse 2s infinite' : 'none',
              }} />
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>
                {isPlaying ? '● Reproduint' : '⏸ Pausat'}: {songs.find(s => s.uri === activeSongUri)?.name}
              </span>
              {previewSongUri && (
                <span style={{ color: '#a78bfa', fontSize: 12, marginLeft: 4 }}>· Preview</span>
              )}
            </div>
          )}

          {/* Song list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filteredSongs.map(song => (
              <SongEditor
                key={song.uri}
                song={song}
                globalConfig={config}
                songCfg={songConfigs[song.uri]}
                onChange={cfg => updateSongConfig(song.uri, cfg)}
                isActive={activeSongUri === song.uri}
                isPlaying={activeSongUri === song.uri && isPlaying}
                positionMs={activeSongUri === song.uri ? positionMs : 0}
                onPlay={startMs => handlePlay(song.uri, startMs)}
                onPause={handlePause}
                onPreview={() => handlePreview(song.uri)}
                onSeek={ms => handleSeek(song.uri, ms)}
                onDelete={() => handleDeleteSong(song.uri)}
              />
            ))}
            {filteredSongs.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--text3)', textAlign: 'center', padding: '24px 0' }}>
                Cap cançó coincideix amb el filtre
              </p>
            )}
          </div>
        </div>

        {/* Add song */}
        {showAddSong ? (
          <div style={{
            background: '#161622',
            borderRadius: 16,
            border: '1px solid rgba(255,255,255,0.07)',
            padding: '16px 20px',
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <p style={{
              fontSize: 11, fontWeight: 700,
              color: 'var(--text3)',
              textTransform: 'uppercase', letterSpacing: '0.1em',
            }}>
              Afegir cançó
            </p>
            <input
              type="text"
              placeholder="URI de Spotify (spotify:track:... o URL)"
              value={newSongUri}
              onChange={e => setNewSongUri(e.target.value)}
              style={{
                padding: '9px 14px', background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
                fontSize: 13, color: 'var(--text)', outline: 'none',
              }}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <input
                type="text"
                placeholder="Nom de la cançó"
                value={newSongName}
                onChange={e => setNewSongName(e.target.value)}
                style={{
                  padding: '9px 14px', background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
                  fontSize: 13, color: 'var(--text)', outline: 'none',
                }}
              />
              <input
                type="text"
                placeholder="Artista"
                value={newSongArtist}
                onChange={e => setNewSongArtist(e.target.value)}
                style={{
                  padding: '9px 14px', background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
                  fontSize: 13, color: 'var(--text)', outline: 'none',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleAddSong}
                className="btn-interact"
                style={{
                  padding: '9px 18px', borderRadius: 10,
                  fontSize: 13, fontWeight: 600,
                  background: '#1DB954', color: '#000',
                }}
              >
                Afegir
              </button>
              <button
                onClick={() => { setShowAddSong(false); setNewSongUri(''); setNewSongName(''); setNewSongArtist(''); }}
                className="btn-interact"
                style={{
                  padding: '9px 18px', borderRadius: 10,
                  fontSize: 13, color: 'var(--text3)',
                  background: 'rgba(255,255,255,0.05)',
                }}
              >
                Cancel·lar
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAddSong(true)}
            className="btn-interact"
            style={{
              padding: '12px 18px', borderRadius: 12,
              fontSize: 13, color: 'var(--text3)',
              background: 'rgba(255,255,255,0.04)',
              border: '1px dashed rgba(255,255,255,0.12)',
            }}
          >
            + Afegir cançó per URI
          </button>
        )}

        {/* Export / Import */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button
            onClick={handleExport}
            className="btn-interact"
            style={{
              padding: '9px 18px',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.07)',
              background: '#1e1e2e',
              color: 'var(--text2)',
              fontSize: 13,
            }}
          >
            ↓ Exportar JSON
          </button>
          <label
            className="btn-interact"
            style={{
              padding: '9px 18px',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.07)',
              background: '#1e1e2e',
              color: 'var(--text2)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            ↑ Importar JSON
            <input type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
          </label>
        </div>
      </main>
    </div>
  );
}

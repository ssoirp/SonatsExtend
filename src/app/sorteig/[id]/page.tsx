'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { hasToken, playTrack, pausePlayback, seekTo, getPlaybackState } from '@/lib/spotify';
import {
  fetchSorteig, fetchSorteigItems, updateSorteigItem, updateSorteig, saveSongTimecodes,
  type DbSorteig, type DbSorteigItem,
} from '@/lib/supabase';

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
    return (parseInt(colonMatch[1]) * 60 + parseInt(colonMatch[2])) * 1000 + parseInt(colonMatch[3] || '0') * 100;
  }
  const numMatch = trimmed.match(/^(\d+(?:\.\d+)?)$/);
  if (numMatch) return Math.round(parseFloat(numMatch[1]) * 1000);
  return null;
}

type Tab = 'edit' | 'play';

export default function SorteigPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [sorteig, setSorteig] = useState<DbSorteig | null>(null);
  const [items, setItems] = useState<DbSorteigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('edit');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'ok' | 'missing'>('all');
  const [saving, setSaving] = useState(false);

  // Playback state
  const [activeUri, setActiveUri] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Bingo play state
  const [playedIndices, setPlayedIndices] = useState<number[]>([]);
  const [currentItem, setCurrentItem] = useState<DbSorteigItem | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [countdownFraction, setCountdownFraction] = useState(0);
  const [totalSec, setTotalSec] = useState(0);
  const outMsRef = useRef(0);
  const inMsRef = useRef(0);
  const localCountdownRef = useRef(0);
  const totalSecRef = useRef(0);
  const advancingRef = useRef(false);

  useEffect(() => {
    loadData();
  }, [id]);

  async function loadData() {
    const [s, it] = await Promise.all([fetchSorteig(id), fetchSorteigItems(id)]);
    setSorteig(s);
    setItems(it);
    setLoading(false);
  }

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  function startEditPolling(songUri: string, outLimit?: number) {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const state = await getPlaybackState();
        if (!state) return;
        setPositionMs(state.position_ms);
        setIsPlaying(state.is_playing);
        if (outLimit && state.position_ms >= outLimit) {
          stopPolling();
          await pausePlayback().catch(() => {});
          setIsPlaying(false);
        }
      } catch { /* ignore */ }
    }, 500);
  }

  async function handlePlay(uri: string, startMs: number) {
    if (!hasToken()) { router.push('/'); return; }
    try {
      await playTrack(uri, startMs);
      setActiveUri(uri);
      setIsPlaying(true);
      startEditPolling(uri);
    } catch { alert('Comprova que Spotify estigui actiu'); }
  }

  async function handlePause() {
    stopPolling();
    await pausePlayback().catch(() => {});
    setIsPlaying(false);
  }

  async function handleSeek(uri: string, ms: number) {
    if (activeUri !== uri) {
      await handlePlay(uri, ms);
    } else {
      await seekTo(ms).catch(() => {});
      setPositionMs(ms);
    }
  }

  async function handlePreview(item: DbSorteigItem) {
    if (item.in_ms == null || item.out_ms == null) return;
    try {
      await playTrack(item.uri, item.in_ms);
      setActiveUri(item.uri);
      setIsPlaying(true);
      startEditPolling(item.uri, item.out_ms);
    } catch { alert('Comprova que Spotify estigui actiu'); }
  }

  async function handleUpdateItem(itemId: string, field: 'in_ms' | 'out_ms', value: number | null) {
    setItems(prev => prev.map(it => it.id === itemId ? { ...it, [field]: value } : it));
    await updateSorteigItem(itemId, { [field]: value });
  }

  async function handleSaveAll() {
    setSaving(true);
    for (const item of items) {
      if (item.in_ms != null || item.out_ms != null) {
        await saveSongTimecodes(
          item.uri,
          item.in_ms != null ? Math.round(item.in_ms / 1000) : null,
          item.out_ms != null ? Math.round(item.out_ms / 1000) : null,
        );
      }
    }
    setSaving(false);
  }

  // Bingo play logic
  const remainingItems = items.filter((_, i) => !playedIndices.includes(i));

  function startBingoPolling() {
    stopPolling();
    advancingRef.current = false;
    pollRef.current = setInterval(async () => {
      localCountdownRef.current = Math.max(0, localCountdownRef.current - 0.5);
      try {
        const state = await getPlaybackState();
        if (state) {
          localCountdownRef.current = Math.max(0, (outMsRef.current - state.position_ms) / 1000);
        }
      } catch { /* ignore */ }
      setCountdown(Math.ceil(localCountdownRef.current));
      const total = totalSecRef.current;
      setCountdownFraction(total > 0 ? Math.max(0, Math.min(1, localCountdownRef.current / total)) : 0);
      if (localCountdownRef.current <= 0 && !advancingRef.current) {
        advancingRef.current = true;
        stopPolling();
        setCountdown(null);
        setCountdownFraction(0);
        playNextBingo();
      }
    }, 500);
  }

  async function playNextBingo(customRemaining?: DbSorteigItem[]) {
    const rem = customRemaining ?? remainingItems;
    if (rem.length === 0) {
      setIsPlaying(false);
      setCurrentItem(null);
      setCountdown(null);
      return;
    }
    const idx = Math.floor(Math.random() * rem.length);
    const item = rem[idx];
    const itemIndex = items.indexOf(item);

    setPlayedIndices(prev => [...prev, itemIndex]);
    setCurrentItem(item);

    const inMs = item.in_ms ?? 30000;
    const outMs = item.out_ms ?? 60000;
    outMsRef.current = outMs;
    inMsRef.current = inMs;
    const sec = Math.max(1, (outMs - inMs) / 1000);
    setTotalSec(sec);
    totalSecRef.current = sec;
    localCountdownRef.current = sec;
    setCountdown(Math.ceil(sec));
    setCountdownFraction(1);

    try {
      await playTrack(item.uri, inMs);
      setActiveUri(item.uri);
      setIsPlaying(true);
      startBingoPolling();
    } catch { setIsPlaying(false); }
  }

  async function handleBingoStart() {
    if (isPlaying) {
      stopPolling();
      await pausePlayback().catch(() => {});
      setIsPlaying(false);
      return;
    }
    if (currentItem) {
      try {
        await playTrack(currentItem.uri, 0);
        setIsPlaying(true);
        startBingoPolling();
      } catch { /* ignore */ }
      return;
    }
    await playNextBingo();
  }

  function handleBingoReset() {
    stopPolling();
    setPlayedIndices([]);
    setCurrentItem(null);
    setCountdown(null);
    setCountdownFraction(0);
    setIsPlaying(false);
  }

  if (loading) {
    return <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: 'var(--text3)' }}>Carregant...</p>
    </div>;
  }

  if (!sorteig) {
    return <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: 'var(--text3)' }}>Bingo no trobat</p>
    </div>;
  }

  const configuredCount = items.filter(it => it.in_ms != null && it.out_ms != null).length;

  const filteredItems = items.filter(item => {
    if (filter === 'ok' && (item.in_ms == null || item.out_ms == null)) return false;
    if (filter === 'missing' && item.in_ms != null && item.out_ms != null) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!(item.title?.toLowerCase().includes(q) || item.artist?.toLowerCase().includes(q))) return false;
    }
    return true;
  });

  const CIRCUMFERENCE = 2 * Math.PI * 36;
  const fraction = countdownFraction;
  const progressColor = fraction > 0.5 ? '#1DB954' : fraction > 0.25 ? '#f0a500' : '#ff4757';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: 'rgba(5,5,8,0.88)', backdropFilter: 'blur(14px)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        padding: '12px 20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <button onClick={() => router.push('/')} className="btn-ghost" style={{ color: 'var(--text2)', fontSize: 14 }}>
            ← Inici
          </button>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700 }}>
            {sorteig.name}
          </h1>
          <button
            onClick={() => router.push(`/sorteig/${id}/butlletes`)}
            className="btn-interact"
            style={{
              padding: '6px 14px', borderRadius: 8,
              fontSize: 12, fontWeight: 600,
              background: 'rgba(167,139,250,0.15)', color: '#a78bfa',
            }}
          >
            Butlletes
          </button>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['edit', 'play'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="btn-interact"
              style={{
                flex: 1, padding: '8px', borderRadius: 8,
                fontSize: 13, fontWeight: 600,
                background: tab === t ? 'rgba(255,255,255,0.1)' : 'transparent',
                color: tab === t ? 'var(--text)' : 'var(--text3)',
              }}
            >
              {t === 'edit' ? 'Editar Cançons' : 'Jugar Bingo'}
            </button>
          ))}
        </div>
      </header>

      {tab === 'edit' ? (
        <main style={{ flex: 1, padding: '16px 20px 40px', maxWidth: 720, width: '100%', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text3)' }}>
              <span style={{ color: '#1DB954' }}>{configuredCount}</span> / {items.length} configurades
            </span>
            <button
              onClick={handleSaveAll}
              disabled={saving}
              className="btn-interact"
              style={{
                padding: '6px 14px', borderRadius: 8,
                fontSize: 12, fontWeight: 600,
                background: saving ? '#26263a' : '#1DB954',
                color: saving ? 'var(--text2)' : '#000',
              }}
            >
              {saving ? 'Desant...' : 'Desar a BBDD'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <input
              type="text" placeholder="Cerca..." value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                flex: 1, minWidth: 120, padding: '8px 12px',
                background: '#161622', border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: 8, fontSize: 13, color: 'var(--text)', outline: 'none',
              }}
            />
            {(['all', 'ok', 'missing'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} className="btn-interact" style={{
                padding: '7px 12px', borderRadius: 8, fontSize: 12,
                background: filter === f ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
                color: filter === f ? 'var(--text)' : 'var(--text3)',
              }}>
                {f === 'all' ? 'Totes' : f === 'ok' ? 'OK' : 'Falten'}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filteredItems.map(item => (
              <SongItemEditor
                key={item.id}
                item={item}
                isActive={activeUri === item.uri}
                isPlaying={activeUri === item.uri && isPlaying}
                positionMs={activeUri === item.uri ? positionMs : 0}
                onPlay={ms => handlePlay(item.uri, ms)}
                onPause={handlePause}
                onPreview={() => handlePreview(item)}
                onSeek={ms => handleSeek(item.uri, ms)}
                onInChange={ms => handleUpdateItem(item.id, 'in_ms', ms)}
                onOutChange={ms => handleUpdateItem(item.id, 'out_ms', ms)}
                onSetIn={ms => handleUpdateItem(item.id, 'in_ms', ms)}
                onSetOut={ms => handleUpdateItem(item.id, 'out_ms', ms)}
              />
            ))}
          </div>
        </main>
      ) : (
        /* PLAY TAB */
        <main style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 16, padding: '24px 16px 32px',
        }}>
          {/* Current song card */}
          <div className="fade-up" style={{
            maxWidth: 460, width: '100%',
            background: 'linear-gradient(160deg, #161622, #1a1a2a)',
            borderRadius: 24, padding: '28px 28px 20px', minHeight: 170,
            border: isPlaying ? '1px solid rgba(29,185,84,0.35)' : '1px solid rgba(255,255,255,0.07)',
            boxShadow: isPlaying ? '0 0 48px rgba(29,185,84,0.1)' : '0 8px 40px rgba(0,0,0,0.4)',
            display: 'flex', flexDirection: 'column',
          }}>
            {currentItem ? (
              <>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flex: 1 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
                      color: '#1DB954', background: 'rgba(29,185,84,0.12)',
                      padding: '3px 8px', borderRadius: 6,
                    }}>
                      {playedIndices.length} / {items.length}
                    </span>
                    <p style={{
                      fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                      letterSpacing: '0.1em', color: 'var(--text3)', margin: '10px 0',
                    }}>
                      {currentItem.artist}
                    </p>
                    <p style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 'clamp(22px, 4vw, 30px)', fontWeight: 800,
                      letterSpacing: '-0.3px', lineHeight: 1.15,
                    }}>
                      {currentItem.title}
                    </p>
                  </div>
                  {countdown !== null && (
                    <div style={{ position: 'relative', width: 88, height: 88, flexShrink: 0 }}>
                      <svg width={88} height={88} style={{ transform: 'rotate(-90deg)' }}>
                        <circle cx={44} cy={44} r={36} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={3.5} />
                        <circle cx={44} cy={44} r={36} fill="none" stroke={progressColor} strokeWidth={3.5}
                          strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
                          strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.5s linear, stroke 0.5s' }} />
                      </svg>
                      <div style={{
                        position: 'absolute', inset: 0,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 500, color: progressColor }}>{countdown}</span>
                        <span style={{ fontSize: 9, color: 'var(--text3)' }}>seg</span>
                      </div>
                    </div>
                  )}
                </div>
                {countdown !== null && (
                  <div style={{ marginTop: 16, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${fraction * 100}%`, background: progressColor, borderRadius: 2, transition: 'width 0.5s linear, background 0.5s' }} />
                  </div>
                )}
              </>
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span style={{ fontSize: 36, opacity: 0.3 }}>🎵</span>
                <p style={{ fontSize: 14, color: 'var(--text3)' }}>
                  {remainingItems.length === 0 ? 'Totes les cançons han sonat!' : 'Prem Iniciar per començar'}
                </p>
              </div>
            )}
          </div>

          {/* Controls */}
          <div style={{ maxWidth: 460, width: '100%', display: 'flex', gap: 10 }}>
            {currentItem === null && remainingItems.length === 0 ? (
              <button onClick={handleBingoReset} className="btn-interact" style={{
                flex: 1, padding: '20px', borderRadius: 18, fontSize: 18, fontWeight: 700,
                background: 'rgba(255,71,87,0.1)', border: '1px solid rgba(255,71,87,0.2)', color: '#ff6b6b',
              }}>
                Reiniciar
              </button>
            ) : (
              <>
                <button onClick={handleBingoStart} className="btn-interact" style={{
                  flex: 1, padding: '20px', borderRadius: 18, fontSize: 18, fontWeight: 700,
                  background: isPlaying ? '#ff4757' : '#1DB954',
                  color: isPlaying ? '#fff' : '#000',
                }}>
                  {isPlaying ? 'Pausa' : currentItem ? 'Reprendre' : 'Iniciar'}
                </button>
                {isPlaying && remainingItems.length > 0 && (
                  <button onClick={() => playNextBingo()} className="btn-interact" style={{
                    width: 76, borderRadius: 18, background: '#f0a500', color: '#000', fontSize: 22, fontWeight: 700,
                  }}>
                    ⏭
                  </button>
                )}
              </>
            )}
          </div>

          {/* Played list */}
          {playedIndices.length > 0 && (
            <div style={{ maxWidth: 460, width: '100%' }}>
              <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>Cançons sonades ({playedIndices.length})</p>
              <div style={{
                background: '#161622', borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.07)',
                maxHeight: 200, overflowY: 'auto', padding: '8px 12px',
              }}>
                {playedIndices.map((idx, i) => {
                  const item = items[idx];
                  return (
                    <div key={i} style={{
                      padding: '6px 0', display: 'flex', gap: 8, alignItems: 'center',
                      borderBottom: i < playedIndices.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                    }}>
                      <span style={{
                        fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
                        color: '#1DB954', background: 'rgba(29,185,84,0.12)',
                        padding: '2px 6px', borderRadius: 5, minWidth: 26, textAlign: 'center',
                      }}>
                        #{i + 1}
                      </span>
                      <div>
                        <p style={{ fontSize: 12, fontWeight: 600 }}>{item?.artist}</p>
                        <p style={{ fontSize: 11, color: 'var(--text3)' }}>{item?.title}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </main>
      )}
    </div>
  );
}

function SongItemEditor({ item, isActive, isPlaying, positionMs, onPlay, onPause, onPreview, onSeek, onInChange, onOutChange, onSetIn, onSetOut }: {
  item: DbSorteigItem;
  isActive: boolean;
  isPlaying: boolean;
  positionMs: number;
  onPlay: (ms: number) => void;
  onPause: () => void;
  onPreview: () => void;
  onSeek: (ms: number) => void;
  onInChange: (ms: number | null) => void;
  onOutChange: (ms: number | null) => void;
  onSetIn: (ms: number) => void;
  onSetOut: (ms: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [inInput, setInInput] = useState(item.in_ms != null ? formatMs(item.in_ms) : '');
  const [outInput, setOutInput] = useState(item.out_ms != null ? formatMs(item.out_ms) : '');

  useEffect(() => {
    setInInput(item.in_ms != null ? formatMs(item.in_ms) : '');
    setOutInput(item.out_ms != null ? formatMs(item.out_ms) : '');
  }, [item.in_ms, item.out_ms]);

  const hasIn = item.in_ms != null;
  const hasOut = item.out_ms != null;
  const status = hasIn && hasOut ? 'ok' : !hasIn && !hasOut ? 'no-cues' : !hasIn ? 'missing-in' : 'missing-out';
  const badge = {
    ok: { label: 'OK', bg: 'rgba(29,185,84,0.14)', color: '#4dcf74' },
    'missing-in': { label: 'Falta IN', bg: 'rgba(240,165,0,0.14)', color: '#f0a500' },
    'missing-out': { label: 'Falta OUT', bg: 'rgba(240,165,0,0.14)', color: '#f0a500' },
    'no-cues': { label: 'Sense IN/OUT', bg: 'rgba(255,71,87,0.14)', color: '#ff6b6b' },
  }[status];

  function handleInBlur() {
    const ms = parseMsInput(inInput);
    if (ms !== null) onInChange(ms);
    else setInInput(item.in_ms != null ? formatMs(item.in_ms) : '');
  }

  function handleOutBlur() {
    const ms = parseMsInput(outInput);
    if (ms !== null) onOutChange(ms);
    else setOutInput(item.out_ms != null ? formatMs(item.out_ms) : '');
  }

  return (
    <div style={{
      borderRadius: 12, background: '#161622',
      border: `1px solid ${isActive ? 'rgba(29,185,84,0.28)' : status !== 'ok' ? 'rgba(240,165,0,0.18)' : 'rgba(255,255,255,0.07)'}`,
      overflow: 'hidden',
    }}>
      <button onClick={() => setExpanded(e => !e)} style={{
        width: '100%', textAlign: 'left', padding: '10px 14px',
        background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
            color: 'var(--text3)', background: 'rgba(255,255,255,0.04)',
            padding: '3px 7px', borderRadius: 5, minWidth: 26, textAlign: 'center',
          }}>
            {item.position}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 600 }}>{item.title}</p>
            <p style={{ fontSize: 11, color: 'var(--text3)' }}>{item.artist}</p>
            {!expanded && (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                IN: {hasIn ? formatMs(item.in_ms!) : '—'} → OUT: {hasOut ? formatMs(item.out_ms!) : '—'}
              </p>
            )}
          </div>
          <span style={{
            fontSize: 11, fontWeight: 500, padding: '3px 9px', borderRadius: 6,
            background: badge.bg, color: badge.color,
          }}>
            {badge.label}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && (
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.07)',
          padding: '12px 14px 16px', background: 'rgba(0,0,0,0.2)',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          {/* Mini player */}
          <div style={{
            background: 'rgba(0,0,0,0.25)', borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.07)', padding: '10px 12px',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {(!isActive || !isPlaying) ? (
                <button onClick={() => onPlay(item.in_ms ?? 0)} className="btn-interact" style={{
                  padding: '5px 12px', borderRadius: 7, fontSize: 11, fontWeight: 600,
                  background: 'rgba(29,185,84,0.18)', color: '#1DB954',
                }}>
                  ▶ Play
                </button>
              ) : (
                <button onClick={onPause} className="btn-interact" style={{
                  padding: '5px 12px', borderRadius: 7, fontSize: 11, fontWeight: 600,
                  background: 'rgba(255,71,87,0.18)', color: '#ff4757',
                }}>
                  ⏸ Pausa
                </button>
              )}
              <button onClick={onPreview} disabled={!hasIn || !hasOut} className="btn-interact" style={{
                padding: '5px 12px', borderRadius: 7, fontSize: 11, fontWeight: 600,
                background: 'rgba(167,139,250,0.14)', color: '#a78bfa',
                opacity: !hasIn || !hasOut ? 0.4 : 1,
              }}>
                ⏩ Preview
              </button>
              {isActive && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#1DB954', marginLeft: 'auto' }}>
                  {formatMs(positionMs)}
                </span>
              )}
            </div>
            {isActive && (
              <div className="fade-up" style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => onSetIn(positionMs)} className="btn-interact" style={{
                  padding: '4px 10px', borderRadius: 6, fontSize: 11,
                  background: 'rgba(240,165,0,0.18)', color: '#f0a500',
                }}>
                  ← Marcar IN
                </button>
                <button onClick={() => onSetOut(positionMs)} className="btn-interact" style={{
                  padding: '4px 10px', borderRadius: 6, fontSize: 11,
                  background: 'rgba(167,139,250,0.18)', color: '#a78bfa',
                }}>
                  Marcar OUT →
                </button>
                <button onClick={() => onSeek(item.in_ms ?? 0)} className="btn-interact" style={{
                  padding: '4px 10px', borderRadius: 6, fontSize: 11,
                  background: 'rgba(255,255,255,0.07)', color: 'var(--text2)',
                }}>
                  ⏮ Anar a IN
                </button>
              </div>
            )}
          </div>

          {/* IN / OUT inputs */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#f0a500' }}>
                IN (m:ss.t)
              </label>
              <input type="text" value={inInput} onChange={e => setInInput(e.target.value)}
                onBlur={handleInBlur} onKeyDown={e => e.key === 'Enter' && handleInBlur()}
                placeholder="0:00.0"
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 12, padding: '7px 10px', borderRadius: 8,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                  color: 'var(--text)', outline: 'none',
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#a78bfa' }}>
                OUT (m:ss.t)
              </label>
              <input type="text" value={outInput} onChange={e => setOutInput(e.target.value)}
                onBlur={handleOutBlur} onKeyDown={e => e.key === 'Enter' && handleOutBlur()}
                placeholder="0:00.0"
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 12, padding: '7px 10px', borderRadius: 8,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                  color: 'var(--text)', outline: 'none',
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

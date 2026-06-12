'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { hasToken, playTrack, pausePlayback, getPlaybackState } from '@/lib/spotify';
import {
  loadConfig, loadPlayed, savePlayed, loadSongs, loadSongConfigs,
  saveBingoSession, loadBingoSession, loadProject, saveProject, getActiveProjectId, type SongData,
} from '@/lib/state';

type Song = SongData;

function getSongMs(song: Song, role: 'in' | 'out', config: any): number {
  const songConfigs = loadSongConfigs();
  const songCfg = songConfigs[song.uri];

  const directKey = role === 'in' ? 'inMs' : 'outMs';
  if (songCfg?.[directKey] !== undefined) return songCfg[directKey];

  const key = role === 'in' ? 'inCue' : 'outCue';
  const defaultKey = role === 'in' ? 'defaultInSec' : 'defaultOutSec';

  const cueIdx = songCfg?.[key] ?? config[key];

  const customVal = songCfg?.cues?.[String(cueIdx)];
  if (customVal !== undefined) return customVal;

  const originalVal = song.cues[String(cueIdx)];
  if (originalVal !== undefined) return originalVal;

  return config[defaultKey] * 1000;
}

const CIRCUMFERENCE = 2 * Math.PI * 36;

function CountdownRing({ countdown, totalSec }: { countdown: number; totalSec: number }) {
  const fraction = totalSec > 0 ? countdown / totalSec : 0;
  const clampedFraction = Math.max(0, Math.min(1, fraction));
  const offset = CIRCUMFERENCE * (1 - clampedFraction);
  const color = fraction > 0.5 ? '#1DB954' : fraction > 0.25 ? '#f0a500' : '#ff4757';

  return (
    <div style={{ position: 'relative', width: 88, height: 88, flexShrink: 0 }}>
      <svg width={88} height={88} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={44} cy={44} r={36} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={3.5} />
        <circle
          cx={44} cy={44} r={36} fill="none"
          stroke={color}
          strokeWidth={3.5}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.8s linear, stroke 0.5s' }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 22, fontWeight: 500,
          color, lineHeight: 1,
        }}>
          {countdown}
        </span>
        <span style={{ fontSize: 9, color: 'var(--text3)' }}>seg</span>
      </div>
    </div>
  );
}

export default function Bingo() {
  const router = useRouter();
  const [current, setCurrent] = useState<Song | null>(null);
  const [playing, setPlaying] = useState(false);
  const [remaining, setRemaining] = useState<Song[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [totalSec, setTotalSec] = useState(0);
  const [showPlayed, setShowPlayed] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const outMsRef = useRef<number>(0);
  const lastPositionRef = useRef<number>(0);
  const advancingRef = useRef(false);
  const nextRemainingRef = useRef<Song[]>([]);
  const playNextRef = useRef<(rem: Song[]) => Promise<void>>(() => Promise.resolve());
  // Comptador local en segons — avança encara que el poll a Spotify falli
  const localCountdownRef = useRef<number>(0);

  const allSongsRef = useRef<Song[]>([]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    advancingRef.current = false;
    setCountdown(null);
  }, []);

  const startBingoPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    advancingRef.current = false;
    pollRef.current = setInterval(async () => {
      // Comptador local: avança sempre, encara que el poll a Spotify falli
      localCountdownRef.current = Math.max(0, localCountdownRef.current - 0.5);

      try {
        const state = await getPlaybackState();
        if (state) {
          const pos = state.position_ms;
          lastPositionRef.current = pos;
          // Sincronitza amb la posició real quan el poll funciona
          localCountdownRef.current = Math.max(0, (outMsRef.current - pos) / 1000);
        }
      } catch { /* ignore poll errors, fallback a comptador local */ }

      setCountdown(Math.ceil(localCountdownRef.current));

      if (localCountdownRef.current <= 0 && !advancingRef.current) {
        advancingRef.current = true;
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        setCountdown(null);
        playNextRef.current(nextRemainingRef.current);
      }
    }, 500);
  }, []);

  const playNext = useCallback(async (currentRemaining: Song[]) => {
    if (currentRemaining.length === 0) {
      setPlaying(false);
      stopPolling();
      setCurrent(null);
      saveBingoSession(null);
      return;
    }
    const config = loadConfig();
    const idx = Math.floor(Math.random() * currentRemaining.length);
    const song = currentRemaining[idx];
    const newRemaining = currentRemaining.filter((_, i) => i !== idx);

    const inMs = getSongMs(song, 'in', config);
    const outMs = getSongMs(song, 'out', config);
    outMsRef.current = outMs;
    nextRemainingRef.current = newRemaining;
    const totalSecVal = Math.max(1, (outMs - inMs) / 1000);
    setTotalSec(totalSecVal);
    localCountdownRef.current = totalSecVal;

    setRemaining(newRemaining);
    setCurrent(song);
    setCountdown(null);

    saveBingoSession({ currentUri: song.uri, outMs, totalSec: totalSecVal, inMs });

    const played = loadPlayed();
    played.push(song.uri);
    savePlayed(played);

    try {
      await playTrack(song.uri, inMs);
    } catch {
      setPlaying(false);
      return;
    }

    startBingoPolling();
  }, [stopPolling, startBingoPolling]);

  useEffect(() => { playNextRef.current = playNext; }, [playNext]);

  useEffect(() => {
    if (!hasToken()) { router.push('/'); return; }
    const allSongs = loadSongs();
    allSongsRef.current = allSongs;
    const played = loadPlayed();
    const rem = allSongs.filter(s => !played.includes(s.uri));
    setRemaining(rem);

    const session = loadBingoSession();
    if (session) {
      const song = allSongs.find(s => s.uri === session.currentUri);
      if (song) {
        setCurrent(song);
        outMsRef.current = session.outMs;
        setTotalSec(session.totalSec);
        nextRemainingRef.current = rem;

        getPlaybackState().then(state => {
          if (!state) return;
          lastPositionRef.current = state.position_ms;
          const secs = Math.max(0, (session.outMs - state.position_ms) / 1000);
          localCountdownRef.current = secs;
          setCountdown(Math.ceil(secs));
          if (state.is_playing) {
            setPlaying(true);
            startBingoPolling();
          }
        }).catch(() => {});
      }
    }
  }, [router, startBingoPolling]);

  async function handleStart() {
    if (playing) {
      stopPolling();
      await pausePlayback().catch(() => {});
      setPlaying(false);
      return;
    }

    if (current !== null) {
      const resumePos = lastPositionRef.current;
      const expectedRem = Math.max(0, (outMsRef.current - resumePos) / 1000);
      localCountdownRef.current = expectedRem;
      setCountdown(Math.ceil(expectedRem));
      try {
        await playTrack(current.uri, resumePos);
        setPlaying(true);
        startBingoPolling();
      } catch { /* ignore */ }
      return;
    }

    setPlaying(true);
    await playNext(remaining);
  }

  useEffect(() => () => stopPolling(), [stopPolling]);

  function handleReset() {
    const p = loadProject(getActiveProjectId());
    p.played = [];
    saveProject(p);
    saveBingoSession(null);
    setCurrent(null);
    setRemaining(loadSongs());
    setPlaying(false);
    setCountdown(null);
    stopPolling();
  }

  const total = allSongsRef.current.length;
  const playedUris = loadPlayed();
  const playedCount = playedUris.length;
  const playedSongs = playedUris
    .map((uri, i) => {
      const song = allSongsRef.current.find(s => s.uri === uri);
      return song ? { ...song, playOrder: i + 1 } : null;
    })
    .filter(Boolean) as (Song & { playOrder: number })[];
  const sortedPlayedSongs = [...playedSongs].sort((a, b) => a.artist.localeCompare(b.artist, 'ca') || a.name.localeCompare(b.name, 'ca'));

  const canStart = remaining.length > 0 || current !== null;

  const progressFraction = countdown !== null && totalSec > 0 ? countdown / totalSec : 0;
  const progressColor = progressFraction > 0.5 ? '#1DB954' : progressFraction > 0.25 ? '#f0a500' : '#ff4757';

  return (
    <div style={{
      minHeight: '100vh',
      background: `
        radial-gradient(ellipse 80% 60% at 50% 40%, rgba(29,185,84,0.05) 0%, transparent 100%),
        #050508
      `,
      color: 'var(--text)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '20px 24px 0',
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

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: playing ? '#1DB954' : 'rgba(255,255,255,0.2)',
            boxShadow: playing ? '0 0 6px #1DB954' : 'none',
            animation: playing ? 'dotPulse 2s infinite' : 'none',
            transition: 'all 0.3s',
            flexShrink: 0,
          }} />
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 13, color: 'var(--text3)',
          }}>
            {playedCount} / {total}
          </span>
        </div>
      </div>

      {/* Main content */}
      <div style={{
        flex: 1,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 16, padding: '24px 16px 32px',
      }}>
        {/* Song card */}
        <div
          key={current?.uri ?? 'empty'}
          className="fade-up"
          style={{
            maxWidth: 460, width: '100%',
            background: 'linear-gradient(160deg, #161622 0%, #1a1a2a 100%)',
            borderRadius: 24,
            padding: '28px 28px 20px',
            minHeight: 170,
            border: playing ? '1px solid rgba(29,185,84,0.35)' : '1px solid rgba(255,255,255,0.07)',
            boxShadow: playing
              ? '0 0 48px rgba(29,185,84,0.1), 0 16px 56px rgba(0,0,0,0.5)'
              : '0 8px 40px rgba(0,0,0,0.4)',
            animation: playing ? 'pulseRing 3.5s infinite' : undefined,
            transition: 'border-color 0.5s, box-shadow 0.5s',
            display: 'flex', flexDirection: 'column',
          }}
        >
          {current ? (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flex: 1 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10, fontWeight: 600,
                      color: '#1DB954',
                      background: 'rgba(29,185,84,0.12)',
                      padding: '3px 8px',
                      borderRadius: 6,
                      flexShrink: 0,
                    }}>
                      {playedCount} / {total}
                    </span>
                  </div>
                  <p style={{
                    fontSize: 11, fontWeight: 600,
                    textTransform: 'uppercase', letterSpacing: '0.1em',
                    color: 'var(--text3)',
                    marginBottom: 10,
                  }}>
                    {current.artist}
                  </p>
                  <p style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 'clamp(22px, 4vw, 30px)',
                    fontWeight: 800,
                    letterSpacing: '-0.3px',
                    lineHeight: 1.15,
                    color: 'var(--text)',
                  }}>
                    {current.name}
                  </p>
                </div>
                {countdown !== null && (
                  <CountdownRing countdown={countdown} totalSec={totalSec} />
                )}
              </div>

              {countdown !== null && (
                <div style={{
                  marginTop: 16,
                  height: 3, borderRadius: 2,
                  background: 'rgba(255,255,255,0.07)',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${progressFraction * 100}%`,
                    background: progressColor,
                    borderRadius: 2,
                    transition: 'width 0.8s linear, background 0.5s',
                  }} />
                </div>
              )}
            </>
          ) : (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 36, opacity: 0.3 }}>🎵</span>
              <p style={{ fontSize: 14, color: 'var(--text3)' }}>
                {remaining.length === 0 ? 'Totes les cançons han sonat!' : 'Prem Iniciar per començar'}
              </p>
            </div>
          )}
        </div>

        {/* Controls */}
        <div style={{ maxWidth: 460, width: '100%', display: 'flex', gap: 10 }}>
          {current === null && remaining.length === 0 ? (
            <button
              onClick={handleReset}
              className="btn-interact"
              style={{
                flex: 1,
                padding: '20px 32px',
                borderRadius: 18,
                fontSize: 18, fontWeight: 700,
                background: 'rgba(255,71,87,0.1)',
                border: '1px solid rgba(255,71,87,0.2)',
                color: '#ff6b6b',
              }}
            >
              🔄 Reiniciar Bingo
            </button>
          ) : (
            <>
              <button
                onClick={handleStart}
                disabled={!canStart}
                className="btn-interact"
                style={{
                  flex: 1,
                  padding: '20px 32px',
                  borderRadius: 18,
                  fontSize: 18, fontWeight: 700,
                  background: playing ? '#ff4757' : '#1DB954',
                  color: playing ? '#fff' : '#000',
                  opacity: !canStart ? 0.4 : 1,
                  cursor: !canStart ? 'not-allowed' : 'pointer',
                }}
              >
                {playing ? '⏸ Pausa' : current !== null ? '▶ Reprendre' : '▶ Iniciar'}
              </button>

              {playing && remaining.length > 0 && (
                <button
                  onClick={() => playNext(remaining)}
                  className="btn-interact"
                  style={{
                    width: 76,
                    borderRadius: 18,
                    background: '#f0a500',
                    color: '#000',
                    fontSize: 22, fontWeight: 700,
                  }}
                >
                  ⏭
                </button>
              )}
            </>
          )}
        </div>

        {/* Played songs toggle */}
        <div style={{ maxWidth: 460, width: '100%' }}>
          <button
            onClick={() => setShowPlayed(v => !v)}
            className="btn-ghost"
            style={{
              color: 'var(--text3)',
              fontSize: 13,
              width: '100%',
              textAlign: 'center',
              padding: '6px 0',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text2)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text3)')}
          >
            {showPlayed ? '▲' : '▼'} Cançons sonades ({playedCount})
          </button>

          {showPlayed && (
            <div
              className="fade-up"
              style={{
                marginTop: 8,
                background: '#161622',
                borderRadius: 16,
                border: '1px solid rgba(255,255,255,0.07)',
                maxHeight: 180,
                overflowY: 'auto',
                padding: '10px 14px',
              }}
            >
              {sortedPlayedSongs.map((song, i) => (
                <div
                  key={song.uri}
                  style={{
                    padding: '7px 0',
                    borderBottom: i < sortedPlayedSongs.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                    display: 'flex', gap: 10, alignItems: 'center',
                  }}
                >
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10, fontWeight: 600,
                    color: '#1DB954',
                    background: 'rgba(29,185,84,0.12)',
                    padding: '2px 6px',
                    borderRadius: 5,
                    minWidth: 26,
                    textAlign: 'center',
                    flexShrink: 0,
                  }}>
                    #{song.playOrder}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{song.artist}</p>
                    <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{song.name}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

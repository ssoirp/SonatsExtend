'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { hasToken, playTrack, pausePlayback, seekTo, getPlaybackState, getTrackDuration, getTracksInfo } from '@/lib/spotify';
import {
  fetchSorteig, fetchSorteigItems, updateSorteigItem, updateSorteig, saveSongTimecodes,
  insertSorteigItems, deleteSorteigItem, lookupSongTimecodes, fetchTicketsForSorteig,
  type DbSorteig, type DbSorteigItem, type DbTicket, type PlayState,
} from '@/lib/supabase';

function formatMs(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const t = Math.floor((ms % 1000) / 100);
  return `${m}:${String(s).padStart(2, '0')}.${t}`;
}

function parseSpotifyUri(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let m = s.match(/spotify:track:([a-zA-Z0-9]+)/);
  if (m) return `spotify:track:${m[1]}`;
  m = s.match(/open\.spotify\.com\/track\/([a-zA-Z0-9]+)/);
  if (m) return `spotify:track:${m[1]}`;
  if (/^[a-zA-Z0-9]{22}$/.test(s)) return `spotify:track:${s}`;
  return null;
}

// Calcula línia/bingo a partir de les cançons que REALMENT han sonat
// (playedPositions = índexs a `items` ja sortejats), no del que marca el jugador.
function computeLineAndBingo(ticket: DbTicket, gridCols: number, playedPositions: Set<number>): { line: boolean; bingo: boolean } {
  const positions = ticket.song_positions ?? [];
  const total = positions.length;
  if (total === 0 || gridCols <= 0) return { line: false, bingo: false };
  const achieved = new Set<number>();
  positions.forEach((pos, idx) => { if (playedPositions.has(pos)) achieved.add(idx); });
  const bingo = achieved.size === total;
  const rows = Math.ceil(total / gridCols);

  let line = false;
  for (let r = 0; r < rows && !line; r++) {
    let full = true;
    for (let c = 0; c < gridCols; c++) {
      const idx = r * gridCols + c;
      if (idx >= total || !achieved.has(idx)) { full = false; break; }
    }
    if (full) line = true;
  }
  for (let c = 0; c < gridCols && !line; c++) {
    let full = true;
    for (let r = 0; r < rows; r++) {
      const idx = r * gridCols + c;
      if (idx >= total || !achieved.has(idx)) { full = false; break; }
    }
    if (full) line = true;
  }
  return { line, bingo };
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
  const [saveStatus, setSaveStatus] = useState<Record<string, 'saving' | 'saved' | 'error'>>({});
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

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
  const [autoMode, setAutoMode] = useState(true);
  const outMsRef = useRef(0);
  const inMsRef = useRef(0);
  const durationMsRef = useRef<number | null>(null);
  const autoModeRef = useRef(true);
  const localCountdownRef = useRef(0);
  const totalSecRef = useRef(0);
  const advancingRef = useRef(false);
  // Confirmació de reproducció real (per evitar salts prematurs i comptar com a "sonada")
  const pendingIndexRef = useRef<number | null>(null);
  const confirmedSecRef = useRef(0);
  const committedRef = useRef(false);
  const currentPositionRef = useRef(0);
  const playedIndicesRef = useRef<number[]>([]);

  function addPlayedIndex(idx: number) {
    if (!playedIndicesRef.current.includes(idx)) {
      playedIndicesRef.current = [...playedIndicesRef.current, idx];
      setPlayedIndices(playedIndicesRef.current);
    }
  }

  async function persistPlayState(overrides: Partial<PlayState> = {}) {
    const state: PlayState = {
      playedIndices: playedIndicesRef.current,
      currentIndex: pendingIndexRef.current,
      positionMs: currentPositionRef.current,
      isPlaying: false,
      autoMode: autoModeRef.current,
      ...overrides,
    };
    try {
      await updateSorteig(id, { play_state: state });
    } catch { /* ignore */ }
  }

  // Avisos de línia/bingo
  const [toasts, setToasts] = useState<{ id: string; text: string; kind: 'line' | 'bingo' }[]>([]);
  const ticketStatusRef = useRef<Map<string, { line: boolean; bingo: boolean }>>(new Map());
  const ticketPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadData();
  }, [id]);

  async function loadData() {
    const [s, it] = await Promise.all([fetchSorteig(id), fetchSorteigItems(id)]);
    setSorteig(s);
    setItems(it);

    const ps = s?.play_state;
    if (ps) {
      playedIndicesRef.current = ps.playedIndices ?? [];
      setPlayedIndices(playedIndicesRef.current);
      autoModeRef.current = ps.autoMode ?? true;
      setAutoMode(autoModeRef.current);

      if (ps.currentIndex != null && it[ps.currentIndex]) {
        const item = it[ps.currentIndex];
        const inMs = item.in_ms ?? 30000;
        const outMs = item.out_ms ?? 60000;
        const position = ps.positionMs ?? inMs;

        setCurrentItem(item);
        pendingIndexRef.current = ps.currentIndex;
        currentPositionRef.current = position;
        inMsRef.current = inMs;
        outMsRef.current = outMs;
        durationMsRef.current = null;
        committedRef.current = playedIndicesRef.current.includes(ps.currentIndex);
        confirmedSecRef.current = committedRef.current ? Math.min(5, (outMs - inMs) / 1000) : 0;

        const total = Math.max(1, (outMs - inMs) / 1000);
        totalSecRef.current = total;
        setTotalSec(total);
        const remaining = Math.max(0, (outMs - position) / 1000);
        localCountdownRef.current = remaining;
        setCountdown(Math.ceil(remaining));
        setCountdownFraction(total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0);
      }
    }

    setLoading(false);
  }

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // Avisos de línia/bingo: comprova periòdicament les butlletes generades
  useEffect(() => {
    if (tab !== 'play' || !sorteig) return;
    const gridCols = sorteig.grid_cols || 3;
    const playedSet = new Set(playedIndices);

    async function checkTickets() {
      const tickets = await fetchTicketsForSorteig(id);
      const newToasts: { id: string; text: string; kind: 'line' | 'bingo' }[] = [];
      for (const t of tickets) {
        const status = computeLineAndBingo(t, gridCols, playedSet);
        const prev = ticketStatusRef.current.get(t.id) ?? { line: false, bingo: false };
        const label = t.card_number != null ? `Targeta #${t.card_number}` : `Targeta ${t.id.slice(0, 4)}`;
        if (status.bingo && !prev.bingo) {
          newToasts.push({ id: `${t.id}-bingo-${Date.now()}`, text: `${label} ha fet BINGO! 🎉`, kind: 'bingo' });
        } else if (status.line && !prev.line) {
          newToasts.push({ id: `${t.id}-line-${Date.now()}`, text: `${label} ha fet LÍNIA! 🎵`, kind: 'line' });
        }
        ticketStatusRef.current.set(t.id, status);
      }
      if (newToasts.length > 0) {
        setToasts(prev => [...prev, ...newToasts]);
        for (const toast of newToasts) {
          setTimeout(() => setToasts(prev => prev.filter(x => x.id !== toast.id)), 8000);
        }
      }
    }

    checkTickets();
    ticketPollRef.current = setInterval(checkTickets, 4000);
    return () => {
      if (ticketPollRef.current) { clearInterval(ticketPollRef.current); ticketPollRef.current = null; }
    };
  }, [tab, sorteig, id, playedIndices]);

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
    setSaveStatus(s => ({ ...s, [itemId]: 'saving' }));
    try {
      await updateSorteigItem(itemId, { [field]: value });
      setSaveStatus(s => ({ ...s, [itemId]: 'saved' }));
      setTimeout(() => {
        setSaveStatus(s => {
          if (s[itemId] !== 'saved') return s;
          const next = { ...s };
          delete next[itemId];
          return next;
        });
      }, 1500);
    } catch (err) {
      setSaveStatus(s => ({ ...s, [itemId]: 'error' }));
      alert('Error desant el canvi: ' + (err as Error).message);
    }
  }

  async function handleDeleteItem(itemId: string) {
    if (!confirm('Eliminar aquesta cançó del bingo?')) return;
    try {
      await deleteSorteigItem(itemId);
      setItems(prev => {
        const next = prev.filter(it => it.id !== itemId);
        updateSorteig(id, { n: next.length }).catch(() => {});
        return next;
      });
    } catch (err) {
      alert('Error eliminant la cançó: ' + (err as Error).message);
    }
  }

  async function handleImportUris() {
    const lines = importText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const parsed = lines.map(parseSpotifyUri).filter((u): u is string => u !== null);
    const uniqueNew = [...new Set(parsed)].filter(uri => !items.some(it => it.uri === uri));

    if (parsed.length === 0) {
      setImportResult('No s\'ha trobat cap URI vàlida.');
      return;
    }
    if (uniqueNew.length === 0) {
      setImportResult('Totes les URIs ja són a la llista.');
      return;
    }

    setImporting(true);
    setImportResult(null);
    try {
      const tracks = await getTracksInfo(uniqueNew);
      const timecodes = await lookupSongTimecodes(uniqueNew);
      let nextPos = items.reduce((max, it) => Math.max(max, it.position), 0) + 1;

      const newItems = tracks.map(track => {
        const tc = timecodes.get(track.uri);
        return {
          sorteig_id: id,
          position: nextPos++,
          uri: track.uri,
          title: track.name,
          artist: track.artists.map(a => a.name).join(', '),
          in_ms: tc?.in_bingo ?? null,
          out_ms: tc?.out_bingo ?? null,
          is_star: false,
        };
      });

      await insertSorteigItems(newItems);
      await updateSorteig(id, { n: items.length + newItems.length });
      await loadData();

      const withCues = newItems.filter(it => it.in_ms != null && it.out_ms != null).length;
      const notFound = uniqueNew.length - tracks.length;
      let msg = `Importades ${newItems.length} cançó(ns), ${withCues} amb IN/OUT ja definits.`;
      if (notFound > 0) msg += ` ${notFound} URI(s) no trobades a Spotify.`;
      setImportResult(msg);
      setImportText('');
    } catch (err) {
      setImportResult('Error important: ' + (err as Error).message);
    }
    setImporting(false);
  }

  async function handleSaveAll() {
    setSaving(true);
    try {
      for (const item of items) {
        if (item.in_ms != null || item.out_ms != null) {
          await saveSongTimecodes(
            item.uri,
            item.title ?? '',
            item.artist ?? '',
            item.in_ms,
            item.out_ms,
          );
        }
      }
    } catch (err) {
      alert('Error desant a la BBDD de cançons: ' + (err as Error).message);
    }
    setSaving(false);
  }

  // Bingo play logic
  const remainingItems = items.filter((_, i) => !playedIndices.includes(i));

  // En mode auto, el tall es fa a l'OUT marcat; si no, sona fins al final real de la cançó
  function getEndMs() {
    if (autoModeRef.current) return outMsRef.current;
    return durationMsRef.current ?? outMsRef.current;
  }

  function startBingoPolling() {
    stopPolling();
    advancingRef.current = false;
    pollRef.current = setInterval(async () => {
      localCountdownRef.current = Math.max(0, localCountdownRef.current - 0.5);
      try {
        const state = await getPlaybackState();
        if (state) {
          if (state.duration_ms != null) durationMsRef.current = state.duration_ms;
          currentPositionRef.current = state.position_ms;
          localCountdownRef.current = Math.max(0, (getEndMs() - state.position_ms) / 1000);
          if (state.is_playing) confirmedSecRef.current += 0.5;
        }
      } catch { /* ignore */ }
      const total = Math.max(1, (getEndMs() - inMsRef.current) / 1000);
      totalSecRef.current = total;
      setTotalSec(total);
      setCountdown(Math.ceil(localCountdownRef.current));
      setCountdownFraction(total > 0 ? Math.max(0, Math.min(1, localCountdownRef.current / total)) : 0);

      // Un cop hem confirmat almenys 5s (o tota la durada, si és més curta)
      // de reproducció real, marquem la cançó com a sonada.
      const minPlayed = Math.min(5, total);
      if (!committedRef.current && pendingIndexRef.current != null && confirmedSecRef.current >= minPlayed) {
        committedRef.current = true;
        addPlayedIndex(pendingIndexRef.current);
        persistPlayState({ isPlaying: true });
      }

      // No avancem fins que no s'hagi confirmat reproducció real, per evitar
      // salts prematurs causats per lectures de posició incorrectes.
      if (localCountdownRef.current <= 0 && confirmedSecRef.current >= minPlayed && !advancingRef.current) {
        advancingRef.current = true;
        stopPolling();
        setCountdown(null);
        setCountdownFraction(0);
        playNextBingo();
      }
    }, 500);
  }

  function toggleAutoMode() {
    const next = !autoMode;
    setAutoMode(next);
    autoModeRef.current = next;
    persistPlayState({ isPlaying });
    if (next && isPlaying) {
      // Si ja hem passat el punt OUT, salta a la següent immediatament
      getPlaybackState().then(state => {
        if (!state || advancingRef.current) return;
        if (state.position_ms >= outMsRef.current) {
          advancingRef.current = true;
          stopPolling();
          setCountdown(null);
          setCountdownFraction(0);
          playNextBingo();
        }
      }).catch(() => {});
    }
  }

  async function playNextBingo(customRemaining?: DbSorteigItem[]) {
    // Finalitzem la cançó anterior: si ha sonat almenys 5s (o tota la durada
    // prevista, si és més curta) la marquem com a sonada; si no, la tornem a
    // la bossa però l'excloem d'aquest sorteig per evitar repetir-la de seguida.
    const prevIdx = pendingIndexRef.current;
    if (prevIdx != null && !committedRef.current) {
      const threshold = Math.min(5, totalSecRef.current || 5);
      if (confirmedSecRef.current >= threshold) {
        addPlayedIndex(prevIdx);
      }
    }
    // Calculem sempre la llista de pendents a partir de `playedIndicesRef`
    // (sempre actualitzat), no de `remainingItems` (pot estar desactualitzat
    // per closures antigues), per evitar repetir cançons ja sonades.
    let rem = customRemaining ?? items.filter((_, i) => !playedIndicesRef.current.includes(i));
    if (prevIdx != null && !playedIndicesRef.current.includes(prevIdx)) {
      // La cançó anterior no s'ha marcat com a sonada (no ha arribat al
      // mínim); l'excloem igualment d'aquest sorteig per no repetir-la de seguida.
      const prevSong = items[prevIdx];
      const filtered = rem.filter(it => it !== prevSong);
      if (filtered.length > 0) rem = filtered;
    }

    if (rem.length === 0) {
      setIsPlaying(false);
      setCurrentItem(null);
      setCountdown(null);
      pendingIndexRef.current = null;
      currentPositionRef.current = 0;
      persistPlayState({ currentIndex: null, positionMs: 0, isPlaying: false });
      return;
    }
    const idx = Math.floor(Math.random() * rem.length);
    const item = rem[idx];
    const itemIndex = items.indexOf(item);

    setCurrentItem(item);
    pendingIndexRef.current = itemIndex;
    confirmedSecRef.current = 0;
    committedRef.current = false;

    const inMs = item.in_ms ?? 30000;
    const outMs = item.out_ms ?? 60000;
    outMsRef.current = outMs;
    inMsRef.current = inMs;
    durationMsRef.current = null;
    currentPositionRef.current = inMs;
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
      persistPlayState({ isPlaying: true });
    } catch { setIsPlaying(false); }
  }

  async function handleBingoStart() {
    if (isPlaying) {
      stopPolling();
      await pausePlayback().catch(() => {});
      setIsPlaying(false);
      persistPlayState({ isPlaying: false });
      return;
    }
    if (currentItem) {
      try {
        // Agafem la posició real de Spotify just abans de reprendre, perquè
        // la guardada (BBDD/ref) pot quedar desfasada i provocar un salt/tall audible.
        let resumePos = currentPositionRef.current;
        try {
          const state = await getPlaybackState();
          if (state) resumePos = state.position_ms;
        } catch { /* ignore */ }
        currentPositionRef.current = resumePos;
        await playTrack(currentItem.uri, resumePos);
        setIsPlaying(true);
        startBingoPolling();
        persistPlayState({ isPlaying: true });
      } catch { /* ignore */ }
      return;
    }
    await playNextBingo();
  }

  async function handleNavigate(path: string) {
    if (tab === 'play' && (currentItem || playedIndicesRef.current.length > 0)) {
      try {
        const state = await getPlaybackState();
        if (state) currentPositionRef.current = state.position_ms;
      } catch { /* ignore */ }
      await persistPlayState({ isPlaying });
    }
    router.push(path);
  }

  function handleBingoReset() {
    stopPolling();
    playedIndicesRef.current = [];
    setPlayedIndices([]);
    setCurrentItem(null);
    setCountdown(null);
    setCountdownFraction(0);
    setIsPlaying(false);
    pendingIndexRef.current = null;
    confirmedSecRef.current = 0;
    committedRef.current = false;
    currentPositionRef.current = 0;
    persistPlayState({ playedIndices: [], currentIndex: null, positionMs: 0, isPlaying: false });
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
      {/* Avisos de línia/bingo */}
      {toasts.length > 0 && (
        <div style={{
          position: 'fixed', top: 12, left: 0, right: 0, zIndex: 100,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
          pointerEvents: 'none', padding: '0 16px',
        }}>
          {toasts.map(t => (
            <div key={t.id} className="fade-up" style={{
              maxWidth: 460, width: '100%',
              padding: '12px 18px', borderRadius: 14,
              fontSize: 14, fontWeight: 700, textAlign: 'center',
              background: t.kind === 'bingo' ? 'rgba(29,185,84,0.18)' : 'rgba(240,165,0,0.18)',
              border: `1px solid ${t.kind === 'bingo' ? 'rgba(29,185,84,0.4)' : 'rgba(240,165,0,0.4)'}`,
              color: t.kind === 'bingo' ? '#1DB954' : '#f0a500',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              backdropFilter: 'blur(8px)',
            }}>
              {t.text}
            </div>
          ))}
        </div>
      )}

      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: 'rgba(5,5,8,0.88)', backdropFilter: 'blur(14px)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        padding: '12px 20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <button onClick={() => handleNavigate('/')} className="btn-ghost" style={{ color: 'var(--text2)', fontSize: 14 }}>
            ← Inici
          </button>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700 }}>
            {sorteig.name}
          </h1>
          <button
            onClick={() => handleNavigate(`/sorteig/${id}/butlletes`)}
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

          {/* Import URIs */}
          <div style={{
            marginBottom: 12, borderRadius: 12, background: '#161622',
            border: '1px solid rgba(255,255,255,0.07)', overflow: 'hidden',
          }}>
            <button onClick={() => setImportOpen(o => !o)} style={{
              width: '100%', textAlign: 'left', padding: '10px 14px',
              background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              fontSize: 13, fontWeight: 600,
            }}>
              <span>＋ Importar cançons (URIs / enllaços de Spotify)</span>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>{importOpen ? '▲' : '▼'}</span>
            </button>
            {importOpen && (
              <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <textarea
                  value={importText}
                  onChange={e => setImportText(e.target.value)}
                  placeholder={'Una per línia:\nspotify:track:XXXXXXXXXXXXXXXXXXXXXX\nhttps://open.spotify.com/track/XXXXXXXXXXXXXXXXXXXXXX'}
                  rows={4}
                  style={{
                    fontFamily: 'var(--font-mono)', fontSize: 12, padding: '8px 10px', borderRadius: 8,
                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                    color: 'var(--text)', outline: 'none', resize: 'vertical',
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    onClick={handleImportUris}
                    disabled={importing || !importText.trim()}
                    className="btn-interact"
                    style={{
                      padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                      background: importing ? '#26263a' : '#1DB954',
                      color: importing ? 'var(--text2)' : '#000',
                      opacity: !importText.trim() ? 0.5 : 1,
                    }}
                  >
                    {importing ? 'Important...' : 'Importar'}
                  </button>
                  {importResult && (
                    <span style={{ fontSize: 11, color: 'var(--text3)' }}>{importResult}</span>
                  )}
                </div>
              </div>
            )}
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
                saveStatus={saveStatus[item.id]}
                onPlay={ms => handlePlay(item.uri, ms)}
                onPause={handlePause}
                onPreview={() => handlePreview(item)}
                onSeek={ms => handleSeek(item.uri, ms)}
                onInChange={ms => handleUpdateItem(item.id, 'in_ms', ms)}
                onOutChange={ms => handleUpdateItem(item.id, 'out_ms', ms)}
                onSetIn={ms => handleUpdateItem(item.id, 'in_ms', ms)}
                onSetOut={ms => handleUpdateItem(item.id, 'out_ms', ms)}
                onDelete={() => handleDeleteItem(item.id)}
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
                      fontFamily: 'var(--font-display)',
                      fontSize: 'clamp(20px, 4vw, 28px)', fontWeight: 800,
                      letterSpacing: '-0.3px', lineHeight: 1.15, margin: '10px 0 4px',
                    }}>
                      {currentItem.artist}
                    </p>
                    <p style={{
                      fontSize: 'clamp(15px, 2.5vw, 19px)', fontWeight: 600,
                      letterSpacing: '-0.2px', lineHeight: 1.2, color: 'var(--text2)',
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

          {/* Auto mode toggle */}
          <div style={{ maxWidth: 460, width: '100%', display: 'flex', justifyContent: 'center' }}>
            <button onClick={toggleAutoMode} className="btn-interact" style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 16px', borderRadius: 999,
              background: autoMode ? 'rgba(29,185,84,0.12)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${autoMode ? 'rgba(29,185,84,0.3)' : 'rgba(255,255,255,0.1)'}`,
              color: autoMode ? '#1DB954' : 'var(--text3)',
              fontSize: 12, fontWeight: 600,
            }}>
              <span style={{
                width: 28, height: 16, borderRadius: 999, position: 'relative', flexShrink: 0,
                background: autoMode ? '#1DB954' : 'rgba(255,255,255,0.15)',
                transition: 'background 0.2s',
              }}>
                <span style={{
                  position: 'absolute', top: 2, left: autoMode ? 14 : 2,
                  width: 12, height: 12, borderRadius: '50%', background: '#fff',
                  transition: 'left 0.2s',
                }} />
              </span>
              Mode Auto {autoMode ? "— talla a l'OUT" : '— sona fins al final'}
            </button>
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

function SongItemEditor({ item, isActive, isPlaying, positionMs, saveStatus, onPlay, onPause, onPreview, onSeek, onInChange, onOutChange, onSetIn, onSetOut, onDelete }: {
  item: DbSorteigItem;
  isActive: boolean;
  isPlaying: boolean;
  positionMs: number;
  saveStatus?: 'saving' | 'saved' | 'error';
  onPlay: (ms: number) => void;
  onPause: () => void;
  onPreview: () => void;
  onSeek: (ms: number) => void;
  onInChange: (ms: number | null) => void;
  onOutChange: (ms: number | null) => void;
  onSetIn: (ms: number) => void;
  onSetOut: (ms: number) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [inInput, setInInput] = useState(item.in_ms != null ? formatMs(item.in_ms) : '');
  const [outInput, setOutInput] = useState(item.out_ms != null ? formatMs(item.out_ms) : '');
  const [durationMs, setDurationMs] = useState<number | null>(null);

  useEffect(() => {
    setInInput(item.in_ms != null ? formatMs(item.in_ms) : '');
    setOutInput(item.out_ms != null ? formatMs(item.out_ms) : '');
  }, [item.in_ms, item.out_ms]);

  useEffect(() => {
    if (expanded && durationMs === null) {
      getTrackDuration(item.uri).then(setDurationMs);
    }
  }, [expanded, durationMs, item.uri]);

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
          <span
            onClick={e => { e.stopPropagation(); onDelete(); }}
            title="Eliminar cançó"
            role="button"
            style={{
              fontSize: 13, color: 'var(--text3)', padding: '4px 6px', borderRadius: 6,
              lineHeight: 1, cursor: 'pointer',
            }}
          >
            🗑
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

          {/* Timeline visualizer */}
          <Timeline
            durationMs={durationMs}
            inMs={item.in_ms}
            outMs={item.out_ms}
            positionMs={isActive ? positionMs : null}
            onSeek={onSeek}
            onInChange={onInChange}
            onOutChange={onOutChange}
          />

          {/* Save status */}
          {saveStatus && (
            <p style={{
              fontSize: 10, fontWeight: 600, textAlign: 'right', marginTop: -4,
              color: saveStatus === 'error' ? '#ff6b6b' : saveStatus === 'saved' ? '#1DB954' : 'var(--text3)',
            }}>
              {saveStatus === 'saving' ? 'Desant…' : saveStatus === 'saved' ? '✓ Desat' : '✕ Error en desar'}
            </p>
          )}

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

function Timeline({ durationMs, inMs, outMs, positionMs, onSeek, onInChange, onOutChange }: {
  durationMs: number | null;
  inMs: number | null;
  outMs: number | null;
  positionMs: number | null;
  onSeek: (ms: number) => void;
  onInChange: (ms: number | null) => void;
  onOutChange: (ms: number | null) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'in' | 'out' | null>(null);
  const [dragMs, setDragMs] = useState(0);

  const msFromClientX = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || !durationMs) return 0;
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(frac * durationMs);
  }, [durationMs]);

  useEffect(() => {
    if (!dragging) return;
    function handleMove(e: PointerEvent) {
      setDragMs(msFromClientX(e.clientX));
    }
    function handleUp(e: PointerEvent) {
      const ms = msFromClientX(e.clientX);
      if (dragging === 'in') onInChange(ms);
      else onOutChange(ms);
      setDragging(null);
    }
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [dragging, msFromClientX, onInChange, onOutChange]);

  if (!durationMs) {
    return (
      <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'center', padding: '10px 0' }}>
        Carregant durada de la cançó…
      </div>
    );
  }

  const liveInMs = dragging === 'in' ? dragMs : inMs;
  const liveOutMs = dragging === 'out' ? dragMs : outMs;
  const inPct = liveInMs != null ? Math.max(0, Math.min(100, (liveInMs / durationMs) * 100)) : null;
  const outPct = liveOutMs != null ? Math.max(0, Math.min(100, (liveOutMs / durationMs) * 100)) : null;
  const posPct = positionMs != null ? Math.max(0, Math.min(100, (positionMs / durationMs) * 100)) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div
        ref={trackRef}
        onClick={e => onSeek(msFromClientX(e.clientX))}
        style={{
          position: 'relative', height: 28, borderRadius: 6,
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.08)',
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        {/* IN -> OUT range */}
        {inPct != null && outPct != null && outPct > inPct && (
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${inPct}%`, width: `${outPct - inPct}%`,
            background: 'rgba(29,185,84,0.10)',
          }} />
        )}
        {/* Playback position */}
        {posPct != null && (
          <div style={{
            position: 'absolute', top: 0, bottom: 0, width: 2,
            left: `${posPct}%`, background: '#1DB954',
            transition: dragging ? 'none' : 'left 0.4s linear',
            boxShadow: '0 0 6px rgba(29,185,84,0.8)',
          }} />
        )}
        {/* IN handle */}
        {inPct != null && (
          <div
            onPointerDown={e => { e.stopPropagation(); setDragMs(liveInMs ?? 0); setDragging('in'); }}
            title="Arrossega per ajustar IN"
            style={{
              position: 'absolute', top: -3, bottom: -3, width: 8, marginLeft: -4,
              left: `${inPct}%`, background: '#f0a500', borderRadius: 3,
              cursor: 'ew-resize', zIndex: 2,
            }}
          />
        )}
        {/* OUT handle */}
        {outPct != null && (
          <div
            onPointerDown={e => { e.stopPropagation(); setDragMs(liveOutMs ?? 0); setDragging('out'); }}
            title="Arrossega per ajustar OUT"
            style={{
              position: 'absolute', top: -3, bottom: -3, width: 8, marginLeft: -4,
              left: `${outPct}%`, background: '#a78bfa', borderRadius: 3,
              cursor: 'ew-resize', zIndex: 2,
            }}
          />
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text3)' }}>
        <span>0:00</span>
        {dragging && (
          <span style={{ color: dragging === 'in' ? '#f0a500' : '#a78bfa', fontWeight: 600 }}>
            {dragging === 'in' ? 'IN' : 'OUT'}: {formatMs(dragMs)}
          </span>
        )}
        <span>{formatMs(durationMs)}</span>
      </div>
    </div>
  );
}

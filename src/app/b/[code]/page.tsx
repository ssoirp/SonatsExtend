'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  fetchSorteigByShareCode, fetchSorteigItems, createTicket,
  fetchTicketsByDevice, updateTicketMarked,
  type DbSorteig, type DbSorteigItem, type DbTicket,
} from '@/lib/supabase';

function getDeviceId(): string {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem('sonats_device_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('sonats_device_id', id);
  }
  return id;
}

function shuffleWithSeed(arr: number[], seed: string): number[] {
  const result = [...arr];
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  }
  for (let i = result.length - 1; i > 0; i--) {
    h = ((h << 5) - h + i) | 0;
    const j = Math.abs(h) % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export default function ButlletaPage() {
  const params = useParams();
  const code = params.code as string;

  const [sorteig, setSorteig] = useState<DbSorteig | null>(null);
  const [items, setItems] = useState<DbSorteigItem[]>([]);
  const [ticket, setTicket] = useState<DbTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cardSongs, setCardSongs] = useState<DbSorteigItem[]>([]);
  const [marked, setMarked] = useState<number[]>([]);

  useEffect(() => {
    loadButlleta();
  }, [code]);

  async function loadButlleta() {
    try {
      const s = await fetchSorteigByShareCode(code);
      if (!s) { setError('Bingo no trobat'); setLoading(false); return; }
      setSorteig(s);

      const it = await fetchSorteigItems(s.id);
      setItems(it);

      const deviceId = getDeviceId();
      const existing = await fetchTicketsByDevice(s.id, deviceId);

      let t: DbTicket;
      if (existing.length > 0) {
        t = existing[0];
      } else {
        const gridSize = (s.grid_rows || 3) * (s.grid_cols || 3);
        const allPositions = it.map((_, i) => i);
        const shuffled = shuffleWithSeed(allPositions, deviceId + s.id + Date.now().toString());
        const selectedPositions = shuffled.slice(0, Math.min(gridSize, it.length));
        t = await createTicket(s.id, deviceId, selectedPositions, s.grid_rows || 3, s.grid_cols || 3);
      }

      setTicket(t);
      setMarked(t.marked || []);

      const songs = (t.song_positions || []).map((pos: number) => it[pos]).filter(Boolean);
      setCardSongs(songs);
    } catch (err) {
      setError('Error carregant la butlleta');
    }
    setLoading(false);
  }

  async function toggleMark(index: number) {
    if (!ticket) return;
    const newMarked = marked.includes(index)
      ? marked.filter(i => i !== index)
      : [...marked, index];
    setMarked(newMarked);
    await updateTicketMarked(ticket.id, newMarked);
  }

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', background: '#050508',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ textAlign: 'center' }}>
          <span style={{ fontSize: 42 }}>🎵</span>
          <p style={{ color: 'rgba(240,240,250,0.55)', marginTop: 12, fontSize: 14 }}>
            Generant butlleta...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        minHeight: '100vh', background: '#050508',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ textAlign: 'center' }}>
          <span style={{ fontSize: 42 }}>😕</span>
          <p style={{ color: '#ff6b6b', marginTop: 12, fontSize: 16 }}>{error}</p>
        </div>
      </div>
    );
  }

  const gridCols = sorteig?.grid_cols || 3;
  const gridRows = sorteig?.grid_rows || 3;
  const allMarked = marked.length === cardSongs.length && cardSongs.length > 0;

  return (
    <div style={{
      minHeight: '100vh',
      background: `
        radial-gradient(ellipse 80% 60% at 50% 30%, rgba(29,185,84,0.06) 0%, transparent 100%),
        #050508
      `,
      color: '#f0f0fa',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '24px 16px 40px',
    }}>
      {/* Title */}
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <h1 style={{
          fontFamily: 'var(--font-display, system-ui)',
          fontSize: 28, fontWeight: 800,
          letterSpacing: '-0.3px',
          marginBottom: 6,
        }}>
          🎵 {sorteig?.name}
        </h1>
        <p style={{ fontSize: 12, color: 'rgba(240,240,250,0.4)' }}>
          La teva butlleta · {gridRows}×{gridCols}
        </p>
      </div>

      {allMarked && (
        <div style={{
          background: 'rgba(29,185,84,0.15)',
          border: '2px solid rgba(29,185,84,0.4)',
          borderRadius: 16, padding: '16px 24px',
          textAlign: 'center', marginBottom: 20,
          animation: 'fadeUp 0.3s both',
          maxWidth: 400, width: '100%',
        }}>
          <p style={{ fontSize: 24, fontWeight: 800, color: '#1DB954' }}>
            🎉 BINGO! 🎉
          </p>
          <p style={{ fontSize: 13, color: 'rgba(240,240,250,0.55)', marginTop: 4 }}>
            Has marcat totes les cançons!
          </p>
        </div>
      )}

      {/* Card grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
        gap: 6,
        maxWidth: Math.min(gridCols * 100, 500),
        width: '100%',
      }}>
        {cardSongs.map((song, i) => {
          const isMarked = marked.includes(i);
          return (
            <button
              key={i}
              onClick={() => toggleMark(i)}
              style={{
                background: isMarked
                  ? 'rgba(29,185,84,0.2)'
                  : 'rgba(255,255,255,0.04)',
                border: `2px solid ${isMarked
                  ? 'rgba(29,185,84,0.5)'
                  : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 10,
                padding: '12px 8px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s',
                minHeight: 72,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              {isMarked && (
                <div style={{
                  position: 'absolute', top: 4, right: 4,
                  width: 18, height: 18, borderRadius: '50%',
                  background: '#1DB954',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, color: '#000', fontWeight: 700,
                }}>
                  ✓
                </div>
              )}
              <p style={{
                fontSize: 11, fontWeight: 700,
                color: isMarked ? '#1DB954' : '#f0f0fa',
                lineHeight: 1.2,
                wordBreak: 'break-word',
              }}>
                {song.title}
              </p>
              <p style={{
                fontSize: 9, marginTop: 3,
                color: isMarked ? 'rgba(29,185,84,0.7)' : 'rgba(240,240,250,0.35)',
              }}>
                {song.artist}
              </p>
            </button>
          );
        })}
      </div>

      {/* Stats */}
      <div style={{
        marginTop: 20,
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: 12,
        color: 'rgba(240,240,250,0.4)',
      }}>
        {marked.length} / {cardSongs.length} marcades
      </div>
    </div>
  );
}

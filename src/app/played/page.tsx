'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadPlayed, loadSongs, type SongData } from '@/lib/state';

interface PlayedSong extends SongData {
  playOrder: number;
}

export default function PlayedPage() {
  const router = useRouter();
  const [played, setPlayed] = useState<PlayedSong[]>([]);
  const [totalSongs, setTotalSongs] = useState(0);

  useEffect(() => {
    const allSongs = loadSongs();
    setTotalSongs(allSongs.length);
    const uris = loadPlayed();
    const withOrder = uris
      .map((uri, i) => {
        const song = allSongs.find(s => s.uri === uri);
        return song ? { ...song, playOrder: i + 1 } : null;
      })
      .filter(Boolean) as PlayedSong[];
    withOrder.sort((a, b) => a.artist.localeCompare(b.artist, 'ca') || a.name.localeCompare(b.name, 'ca'));
    setPlayed(withOrder);
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', display: 'flex', flexDirection: 'column' }}>
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
          Cançons Sonades
        </h1>
        <div style={{ width: 60 }} />
      </header>

      <main style={{
        flex: 1,
        padding: '20px 20px 32px',
        display: 'flex', flexDirection: 'column', gap: 16,
        maxWidth: 560, width: '100%', margin: '0 auto',
      }}>
        <p style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11, fontWeight: 600,
          color: 'var(--text3)',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}>
          {played.length} de {totalSongs} cançons
        </p>

        {played.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: '72px 0', gap: 12,
          }}>
            <span style={{ fontSize: 42, opacity: 0.25 }}>🎵</span>
            <p style={{ fontSize: 14, color: 'var(--text3)' }}>Encara no ha sonat cap cançó.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {played.map(song => (
              <div
                key={song.uri}
                style={{
                  background: '#161622',
                  borderRadius: 12,
                  border: '1px solid rgba(255,255,255,0.07)',
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10, fontWeight: 600,
                  color: '#1DB954',
                  background: 'rgba(29,185,84,0.12)',
                  padding: '3px 7px',
                  borderRadius: 6,
                  minWidth: 28,
                  textAlign: 'center',
                  flexShrink: 0,
                }}>
                  #{song.playOrder}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{song.artist}</p>
                  <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{song.name}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

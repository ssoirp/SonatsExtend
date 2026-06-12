'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { hasToken, startSpotifyAuth, clearToken, getPlaylistTracks } from '@/lib/spotify';
import { fetchSorteigs, createSorteig, insertSorteigItems, lookupSongTimecodes, updateSorteig, deleteSorteig, type DbSorteig } from '@/lib/supabase';

function parsePlaylistId(input: string): string | null {
  const trimmed = input.trim();
  // spotify:playlist:XXXXX
  const uriMatch = trimmed.match(/^spotify:playlist:([a-zA-Z0-9]+)$/);
  if (uriMatch) return uriMatch[1];
  // https://open.spotify.com/playlist/XXXXX?...
  const urlMatch = trimmed.match(/open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)/);
  if (urlMatch) return urlMatch[1];
  // Just an ID
  if (/^[a-zA-Z0-9]{10,}$/.test(trimmed)) return trimmed;
  return null;
}

export default function Home() {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const [sorteigs, setSorteigs] = useState<DbSorteig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewBingo, setShowNewBingo] = useState(false);
  const [creating, setCreating] = useState(false);
  const [bingoName, setBingoName] = useState('');
  const [playlistInput, setPlaylistInput] = useState('');
  const [playlistError, setPlaylistError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  useEffect(() => {
    setConnected(hasToken());
    loadSorteigs();
  }, []);

  async function loadSorteigs() {
    try {
      const data = await fetchSorteigs();
      setSorteigs(data);
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function handleCreateBingo() {
    if (!bingoName.trim()) return;
    const playlistId = parsePlaylistId(playlistInput);
    if (!playlistId) {
      setPlaylistError('URL o ID de playlist invàlida. Enganxa una URL de Spotify (https://open.spotify.com/playlist/...) o un ID.');
      return;
    }
    setPlaylistError('');
    setCreating(true);
    try {
      const tracks = await getPlaylistTracks(playlistId);
      if (tracks.length === 0) {
        setPlaylistError('La playlist està buida o no s\'ha pogut accedir.');
        setCreating(false);
        return;
      }

      const uris = tracks.map(t => t.uri);
      const timecodes = await lookupSongTimecodes(uris);

      const sorteig = await createSorteig({
        name: bingoName.trim(),
        playlistId,
      });

      const items = tracks.map((track, i) => {
        const tc = timecodes.get(track.uri);
        return {
          sorteig_id: sorteig.id,
          position: i + 1,
          uri: track.uri,
          title: track.name,
          artist: track.artists.map(a => a.name).join(', '),
          in_ms: tc?.in_bingo ?? null,
          out_ms: tc?.out_bingo ?? null,
          is_star: false,
        };
      });

      await insertSorteigItems(items);
      await updateSorteig(sorteig.id, { n: tracks.length });

      router.push(`/sorteig/${sorteig.id}`);
    } catch (err) {
      setPlaylistError('Error: ' + (err as Error).message);
    }
    setCreating(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('Segur que vols eliminar aquest bingo?')) return;
    try {
      await deleteSorteig(id);
      setSorteigs(s => s.filter(x => x.id !== id));
    } catch (err) {
      alert('Error eliminant: ' + (err as Error).message);
      await loadSorteigs();
    }
  }

  async function handleRename(id: string) {
    const name = editName.trim();
    if (!name) { setEditingId(null); return; }
    try {
      await updateSorteig(id, { name });
      setSorteigs(s => s.map(x => x.id === id ? { ...x, name } : x));
    } catch { /* ignore */ }
    setEditingId(null);
  }

  return (
    <main className="fade-up" style={{
      minHeight: '100vh',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: 32,
      background: `
        radial-gradient(ellipse 55% 45% at 15% 5%, rgba(29,185,84,0.08) 0%, transparent 100%),
        radial-gradient(ellipse 55% 45% at 85% 95%, rgba(120,60,220,0.08) 0%, transparent 100%),
        #050508
      `,
    }}>
      <div style={{
        position: 'fixed', inset: 0,
        backgroundImage: `
          linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)
        `,
        backgroundSize: '52px 52px',
        pointerEvents: 'none',
      }} />

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 480 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 32 }}>
          <div style={{
            width: 80, height: 80, borderRadius: 24,
            background: 'linear-gradient(145deg, #1e1e2e, #26263a)',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: '0 4px 32px rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 34, marginBottom: 24,
          }}>
            🎵
          </div>
          <h1 style={{
            fontFamily: 'var(--font-display)', fontSize: 40, fontWeight: 800,
            letterSpacing: '-0.5px', color: 'var(--text)', marginBottom: 8, textAlign: 'center',
          }}>
            Bingo Musical
          </h1>
          <p style={{
            fontSize: 11, fontWeight: 500, color: 'var(--text3)',
            letterSpacing: '0.14em', textTransform: 'uppercase',
          }}>
            SonatsExtend
          </p>
        </div>

        {!connected ? (
          <button onClick={startSpotifyAuth} className="btn-interact" style={{
            width: '100%', padding: '20px 32px', borderRadius: 18,
            background: '#1DB954', color: '#000', fontWeight: 700, fontSize: 18,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          }}>
            <SpotifyIcon /> Connectar Spotify
          </button>
        ) : (
          <>
            {/* Bingos list */}
            <div style={{
              background: '#161622', borderRadius: 16,
              border: '1px solid rgba(255,255,255,0.07)',
              padding: 16, marginBottom: 16,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <p style={{
                  fontSize: 10, fontWeight: 700, color: 'var(--text3)',
                  textTransform: 'uppercase', letterSpacing: '0.1em',
                }}>
                  Els meus Bingos
                </p>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text3)' }}>
                  {sorteigs.length}
                </span>
              </div>

              {loading ? (
                <p style={{ fontSize: 13, color: 'var(--text3)', textAlign: 'center', padding: 20 }}>Carregant...</p>
              ) : sorteigs.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text3)', textAlign: 'center', padding: 20 }}>
                  Cap bingo creat. Crea&apos;n un!
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {sorteigs.map(s => (
                    <div key={s.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '12px 14px', borderRadius: 12,
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid transparent',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                    }}
                    onClick={() => editingId !== s.id && router.push(`/sorteig/${s.id}`)}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(29,185,84,0.08)'; e.currentTarget.style.borderColor = 'rgba(29,185,84,0.2)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'transparent'; }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {editingId === s.id ? (
                          <input
                            autoFocus
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            onBlur={() => handleRename(s.id)}
                            onKeyDown={e => { if (e.key === 'Enter') handleRename(s.id); if (e.key === 'Escape') setEditingId(null); }}
                            onClick={e => e.stopPropagation()}
                            style={{
                              width: '100%', background: 'rgba(255,255,255,0.08)',
                              border: '1px solid rgba(255,255,255,0.15)',
                              borderRadius: 6, padding: '3px 8px',
                              fontSize: 14, fontWeight: 600, color: 'var(--text)', outline: 'none',
                            }}
                          />
                        ) : (
                          <p
                            style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}
                            onDoubleClick={e => { e.stopPropagation(); setEditingId(s.id); setEditName(s.name ?? ''); }}
                          >
                            {s.name}
                          </p>
                        )}
                        <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                          {s.n} cançons · {new Date(s.created_at).toLocaleDateString('ca')}
                        </p>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); handleDelete(s.id); }}
                        className="btn-ghost"
                        style={{ color: 'var(--text3)', fontSize: 13, padding: '0 4px' }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#ff4757')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--text3)')}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* New bingo */}
            {showNewBingo ? (
              <div style={{
                background: '#161622', borderRadius: 16,
                border: '1px solid rgba(255,255,255,0.07)',
                padding: 16, marginBottom: 16,
                display: 'flex', flexDirection: 'column', gap: 12,
              }}>
                <p style={{
                  fontSize: 10, fontWeight: 700, color: 'var(--text3)',
                  textTransform: 'uppercase', letterSpacing: '0.1em',
                }}>
                  Nou Bingo
                </p>
                <input
                  autoFocus
                  value={bingoName}
                  onChange={e => setBingoName(e.target.value)}
                  placeholder="Nom del bingo..."
                  style={{
                    padding: '10px 14px', background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
                    fontSize: 14, color: 'var(--text)', outline: 'none',
                  }}
                />

                <div>
                  <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 6 }}>
                    Playlist de Spotify
                  </p>
                  <p style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 8 }}>
                    Enganxa la URL o ID de la playlist (p.ex. https://open.spotify.com/playlist/...)
                  </p>
                  <input
                    value={playlistInput}
                    onChange={e => { setPlaylistInput(e.target.value); setPlaylistError(''); }}
                    placeholder="https://open.spotify.com/playlist/..."
                    style={{
                      width: '100%',
                      padding: '10px 14px', background: 'rgba(255,255,255,0.05)',
                      border: `1px solid ${playlistError ? 'rgba(255,71,87,0.4)' : 'rgba(255,255,255,0.1)'}`,
                      borderRadius: 10,
                      fontSize: 13, color: 'var(--text)', outline: 'none',
                    }}
                  />
                  {playlistError && (
                    <p style={{ fontSize: 11, color: '#ff6b6b', marginTop: 6 }}>{playlistError}</p>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button
                    onClick={handleCreateBingo}
                    disabled={!bingoName.trim() || !playlistInput.trim() || creating}
                    className="btn-interact"
                    style={{
                      flex: 1, padding: '12px', borderRadius: 10,
                      fontSize: 14, fontWeight: 600,
                      background: '#1DB954', color: '#000',
                      opacity: (!bingoName.trim() || !playlistInput.trim() || creating) ? 0.4 : 1,
                    }}
                  >
                    {creating ? 'Creant bingo...' : 'Crear Bingo'}
                  </button>
                  <button
                    onClick={() => { setShowNewBingo(false); setBingoName(''); setPlaylistInput(''); setPlaylistError(''); }}
                    className="btn-interact"
                    style={{
                      padding: '12px 18px', borderRadius: 10,
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
                onClick={() => setShowNewBingo(true)}
                className="btn-interact"
                style={{
                  width: '100%', padding: '16px', borderRadius: 14,
                  fontSize: 15, fontWeight: 600,
                  background: '#1DB954', color: '#000',
                  marginBottom: 16,
                }}
              >
                + Nou Bingo des de Spotify
              </button>
            )}

            <button
              onClick={() => { clearToken(); setConnected(false); }}
              className="btn-ghost"
              style={{ color: 'var(--text3)', fontSize: 13, width: '100%', textAlign: 'center', marginTop: 8 }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text2)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text3)')}
            >
              Desconnectar Spotify
            </button>
          </>
        )}
      </div>
    </main>
  );
}

function SpotifyIcon() {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" style={{ flexShrink: 0 }}>
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

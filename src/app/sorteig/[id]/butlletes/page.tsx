'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import QRCode from 'qrcode';
import { fetchSorteig, fetchSorteigItems, updateSorteig, type DbSorteig, type DbSorteigItem } from '@/lib/supabase';

const GRID_OPTIONS = [
  { rows: 3, cols: 3, label: '3×3 (9)' },
  { rows: 3, cols: 4, label: '3×4 (12)' },
  { rows: 4, cols: 3, label: '4×3 (12)' },
  { rows: 4, cols: 4, label: '4×4 (16)' },
  { rows: 4, cols: 5, label: '4×5 (20)' },
  { rows: 5, cols: 4, label: '5×4 (20)' },
  { rows: 5, cols: 5, label: '5×5 (25)' },
];

export default function ButlletesPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [sorteig, setSorteig] = useState<DbSorteig | null>(null);
  const [items, setItems] = useState<DbSorteigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [gridRows, setGridRows] = useState(3);
  const [gridCols, setGridCols] = useState(3);
  const [qrUrl, setQrUrl] = useState('');
  const [saved, setSaved] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    loadData();
  }, [id]);

  async function loadData() {
    const [s, it] = await Promise.all([fetchSorteig(id), fetchSorteigItems(id)]);
    setSorteig(s);
    setItems(it);
    if (s) {
      setGridRows(s.grid_rows || 3);
      setGridCols(s.grid_cols || 3);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!sorteig?.share_code) return;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const url = `${origin}/b/${sorteig.share_code}`;
    setQrUrl(url);

    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, url, {
        width: 280,
        margin: 2,
        color: { dark: '#f0f0fa', light: '#161622' },
      });
    }
  }, [sorteig?.share_code, loading]);

  async function handleSaveGrid() {
    if (!sorteig) return;
    await updateSorteig(id, { grid_rows: gridRows, grid_cols: gridCols });
    setSorteig({ ...sorteig, grid_rows: gridRows, grid_cols: gridCols });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const cellCount = gridRows * gridCols;
  const configuredSongs = items.filter(it => it.in_ms != null && it.out_ms != null);
  const hasSufficientSongs = configuredSongs.length >= cellCount;

  if (loading) {
    return <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: 'var(--text3)' }}>Carregant...</p>
    </div>;
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: 'rgba(5,5,8,0.88)', backdropFilter: 'blur(14px)',
        borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '14px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <button onClick={() => router.push(`/sorteig/${id}`)} className="btn-ghost" style={{ color: 'var(--text2)', fontSize: 14 }}>
          ← Sorteig
        </button>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700 }}>
          Butlletes
        </h1>
        <div style={{ width: 60 }} />
      </header>

      <main style={{
        flex: 1, padding: '20px 20px 40px',
        display: 'flex', flexDirection: 'column', gap: 20,
        maxWidth: 520, width: '100%', margin: '0 auto',
      }}>
        {/* Grid format */}
        <div style={{
          background: '#161622', borderRadius: 16,
          border: '1px solid rgba(255,255,255,0.07)', padding: 16,
        }}>
          <p style={{
            fontSize: 10, fontWeight: 700, color: 'var(--text3)',
            textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12,
          }}>
            Format de la butlleta
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {GRID_OPTIONS.map(opt => (
              <button
                key={`${opt.rows}x${opt.cols}`}
                onClick={() => { setGridRows(opt.rows); setGridCols(opt.cols); }}
                className="btn-interact"
                style={{
                  padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  background: gridRows === opt.rows && gridCols === opt.cols
                    ? 'rgba(29,185,84,0.15)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${gridRows === opt.rows && gridCols === opt.cols
                    ? 'rgba(29,185,84,0.3)' : 'transparent'}`,
                  color: gridRows === opt.rows && gridCols === opt.cols ? '#1DB954' : 'var(--text3)',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: 12, color: 'var(--text2)' }}>
                {cellCount} cel·les per butlleta
              </p>
              <p style={{
                fontSize: 11, marginTop: 4,
                color: hasSufficientSongs ? '#4dcf74' : '#ff6b6b',
              }}>
                {hasSufficientSongs
                  ? `${configuredSongs.length} cançons disponibles`
                  : `Falten ${cellCount - configuredSongs.length} cançons configurades (tens ${configuredSongs.length})`
                }
              </p>
            </div>
            <button
              onClick={handleSaveGrid}
              className="btn-interact"
              style={{
                padding: '7px 16px', borderRadius: 8,
                fontSize: 12, fontWeight: 600,
                background: saved ? '#26263a' : '#1DB954',
                color: saved ? 'var(--text2)' : '#000',
              }}
            >
              {saved ? '✓ Desat' : 'Desar'}
            </button>
          </div>
        </div>

        {/* Preview */}
        <div style={{
          background: '#161622', borderRadius: 16,
          border: '1px solid rgba(255,255,255,0.07)', padding: 16,
        }}>
          <p style={{
            fontSize: 10, fontWeight: 700, color: 'var(--text3)',
            textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12,
          }}>
            Previsualització
          </p>

          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
            gap: 4,
          }}>
            {Array.from({ length: cellCount }).map((_, i) => {
              const song = items[i % items.length];
              return (
                <div key={i} style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 6, padding: '8px 6px',
                  textAlign: 'center', minHeight: 52,
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <p style={{ fontSize: 9, fontWeight: 600, color: 'var(--text)', lineHeight: 1.2 }}>
                    {song?.title?.slice(0, 20) ?? '—'}
                  </p>
                  <p style={{ fontSize: 8, color: 'var(--text3)', marginTop: 2 }}>
                    {song?.artist?.slice(0, 18) ?? ''}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* QR Code */}
        <div style={{
          background: '#161622', borderRadius: 16,
          border: '1px solid rgba(255,255,255,0.07)', padding: 16,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
        }}>
          <p style={{
            fontSize: 10, fontWeight: 700, color: 'var(--text3)',
            textTransform: 'uppercase', letterSpacing: '0.1em',
          }}>
            Codi QR per als jugadors
          </p>

          <div style={{
            background: '#161622', borderRadius: 12,
            padding: 16, border: '2px solid rgba(255,255,255,0.1)',
          }}>
            <canvas ref={canvasRef} />
          </div>

          <p style={{ fontSize: 12, color: 'var(--text2)', textAlign: 'center' }}>
            Escaneja per obtenir una butlleta
          </p>

          <div style={{
            background: 'rgba(255,255,255,0.04)',
            borderRadius: 8, padding: '8px 14px',
            fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text3)',
            wordBreak: 'break-all',
          }}>
            {qrUrl}
          </div>

          <button
            onClick={() => navigator.clipboard.writeText(qrUrl)}
            className="btn-interact"
            style={{
              padding: '8px 18px', borderRadius: 8,
              fontSize: 12, fontWeight: 600,
              background: 'rgba(255,255,255,0.07)', color: 'var(--text2)',
            }}
          >
            Copiar URL
          </button>
        </div>
      </main>
    </div>
  );
}

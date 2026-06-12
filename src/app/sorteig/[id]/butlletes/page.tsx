'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import QRCode from 'qrcode';
import {
  fetchSorteig, fetchSorteigItems, updateSorteig,
  createPaymentTicket, fetchUnclaimedPaymentTicket, fetchTicketById,
  type DbSorteig, type DbSorteigItem, type DbTicket,
} from '@/lib/supabase';

function pickCardPositions(items: DbSorteigItem[], cellCount: number): number[] {
  const configuredIdx = items
    .map((it, i) => ({ it, i }))
    .filter(x => x.it.in_ms != null && x.it.out_ms != null)
    .map(x => x.i);
  const pool = configuredIdx.length >= cellCount ? configuredIdx : items.map((_, i) => i);
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(cellCount, shuffled.length));
}

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

  // Payment mode
  const [togglingPayment, setTogglingPayment] = useState(false);
  const [paymentTicket, setPaymentTicket] = useState<DbTicket | null>(null);
  const [generatingTicket, setGeneratingTicket] = useState(false);
  const paymentCanvasRef = useRef<HTMLCanvasElement>(null);
  const paymentPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Resume any unclaimed payment ticket on load
  useEffect(() => {
    if (!sorteig?.payment_mode) return;
    fetchUnclaimedPaymentTicket(id).then(t => { if (t) setPaymentTicket(t); });
  }, [sorteig?.payment_mode, id]);

  // Render the payment ticket QR
  useEffect(() => {
    if (!paymentTicket || paymentTicket.claimed_at) return;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const url = `${origin}/b/${paymentTicket.code}`;
    if (paymentCanvasRef.current) {
      QRCode.toCanvas(paymentCanvasRef.current, url, {
        width: 240,
        margin: 2,
        color: { dark: '#f0f0fa', light: '#161622' },
      });
    }
  }, [paymentTicket]);

  // Poll until the current payment ticket gets scanned
  useEffect(() => {
    if (paymentPollRef.current) { clearInterval(paymentPollRef.current); paymentPollRef.current = null; }
    if (!paymentTicket || paymentTicket.claimed_at) return;
    paymentPollRef.current = setInterval(async () => {
      const t = await fetchTicketById(paymentTicket.id);
      if (t?.claimed_at) {
        setPaymentTicket(t);
      }
    }, 2000);
    return () => {
      if (paymentPollRef.current) { clearInterval(paymentPollRef.current); paymentPollRef.current = null; }
    };
  }, [paymentTicket]);

  async function handleTogglePaymentMode() {
    if (!sorteig) return;
    const next = !sorteig.payment_mode;
    setTogglingPayment(true);
    try {
      await updateSorteig(id, { payment_mode: next });
      setSorteig({ ...sorteig, payment_mode: next });
      if (!next) setPaymentTicket(null);
    } catch (err) {
      alert('Error canviant el mode: ' + (err as Error).message);
    }
    setTogglingPayment(false);
  }

  async function handleGenerateTicket() {
    if (!sorteig) return;
    setGeneratingTicket(true);
    try {
      const positions = pickCardPositions(items, gridRows * gridCols);
      const t = await createPaymentTicket(id, positions, gridRows, gridCols);
      setPaymentTicket(t);
    } catch (err) {
      alert('Error generant la butlleta: ' + (err as Error).message);
    }
    setGeneratingTicket(false);
  }

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

        {/* Payment mode toggle */}
        <div style={{
          background: '#161622', borderRadius: 16,
          border: '1px solid rgba(255,255,255,0.07)', padding: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700 }}>Mode pagament</p>
            <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, maxWidth: 320 }}>
              {sorteig?.payment_mode
                ? 'A més del QR públic, el venedor pot generar un QR únic per butlleta. Un cop escanejat, desapareix.'
                : 'El QR públic genera butlletes gratuïtes i autogenerades per dispositiu.'}
            </p>
          </div>
          <button
            onClick={handleTogglePaymentMode}
            disabled={togglingPayment}
            className="btn-interact"
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 14px', borderRadius: 999, flexShrink: 0,
              background: sorteig?.payment_mode ? 'rgba(29,185,84,0.12)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${sorteig?.payment_mode ? 'rgba(29,185,84,0.3)' : 'rgba(255,255,255,0.1)'}`,
              color: sorteig?.payment_mode ? '#1DB954' : 'var(--text3)',
              fontSize: 12, fontWeight: 600,
            }}
          >
            <span style={{
              width: 28, height: 16, borderRadius: 999, position: 'relative', flexShrink: 0,
              background: sorteig?.payment_mode ? '#1DB954' : 'rgba(255,255,255,0.15)',
              transition: 'background 0.2s',
            }}>
              <span style={{
                position: 'absolute', top: 2, left: sorteig?.payment_mode ? 14 : 2,
                width: 12, height: 12, borderRadius: '50%', background: '#fff',
                transition: 'left 0.2s',
              }} />
            </span>
            {sorteig?.payment_mode ? 'ON' : 'OFF'}
          </button>
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

        {/* QR Code - públic (sempre disponible, encara que hi hagi mode pagament) */}
        <div style={{
          background: '#161622', borderRadius: 16,
          border: '1px solid rgba(255,255,255,0.07)', padding: 16,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
        }}>
          <p style={{
            fontSize: 10, fontWeight: 700, color: 'var(--text3)',
            textTransform: 'uppercase', letterSpacing: '0.1em',
          }}>
            Codi QR públic
          </p>

          <div style={{
            background: '#161622', borderRadius: 12,
            padding: 16, border: '2px solid rgba(255,255,255,0.1)',
          }}>
            <canvas ref={canvasRef} />
          </div>

          <p style={{ fontSize: 12, color: 'var(--text2)', textAlign: 'center' }}>
            Escaneja per obtenir una butlleta gratuïta i autogenerada
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

        {/* QR Code - mode pagament */}
        {sorteig?.payment_mode && (
          <div style={{
            background: '#161622', borderRadius: 16,
            border: '1px solid rgba(255,255,255,0.07)', padding: 16,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
          }}>
            <p style={{
              fontSize: 10, fontWeight: 700, color: 'var(--text3)',
              textTransform: 'uppercase', letterSpacing: '0.1em',
            }}>
              Butlleta de pagament
            </p>

            {paymentTicket && !paymentTicket.claimed_at ? (
              <>
                <div style={{
                  background: '#161622', borderRadius: 12,
                  padding: 16, border: '2px solid rgba(255,255,255,0.1)',
                }}>
                  <canvas ref={paymentCanvasRef} />
                </div>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#1DB954' }}>
                  Targeta #{paymentTicket.card_number}
                </p>
                <p style={{ fontSize: 12, color: 'var(--text2)', textAlign: 'center' }}>
                  Dona aquest QR a la persona un cop hagi pagat.<br />Desapareixerà quan l&apos;escanegi.
                </p>
                <p style={{ fontSize: 11, color: 'var(--text3)' }}>
                  ⏳ Esperant escaneig...
                </p>
              </>
            ) : paymentTicket?.claimed_at ? (
              <>
                <div style={{
                  width: 240, height: 240, borderRadius: 12,
                  border: '2px solid rgba(29,185,84,0.3)', background: 'rgba(29,185,84,0.08)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}>
                  <span style={{ fontSize: 40 }}>✓</span>
                  <p style={{ fontSize: 14, fontWeight: 700, color: '#1DB954' }}>
                    Targeta #{paymentTicket.card_number} bescanviada
                  </p>
                </div>
                <button
                  onClick={handleGenerateTicket}
                  disabled={generatingTicket || !hasSufficientSongs}
                  className="btn-interact"
                  style={{
                    padding: '10px 20px', borderRadius: 10,
                    fontSize: 13, fontWeight: 700,
                    background: '#1DB954', color: '#000',
                    opacity: generatingTicket || !hasSufficientSongs ? 0.5 : 1,
                  }}
                >
                  {generatingTicket ? 'Generant...' : 'Generar següent butlleta'}
                </button>
              </>
            ) : (
              <>
                <p style={{ fontSize: 12, color: 'var(--text2)', textAlign: 'center', maxWidth: 320 }}>
                  Quan algú hagi pagat, prem el botó per generar el seu QR d&apos;un sol ús.
                </p>
                <button
                  onClick={handleGenerateTicket}
                  disabled={generatingTicket || !hasSufficientSongs}
                  className="btn-interact"
                  style={{
                    padding: '10px 20px', borderRadius: 10,
                    fontSize: 13, fontWeight: 700,
                    background: '#1DB954', color: '#000',
                    opacity: generatingTicket || !hasSufficientSongs ? 0.5 : 1,
                  }}
                >
                  {generatingTicket ? 'Generant...' : 'Generar QR butlleta'}
                </button>
                {!hasSufficientSongs && (
                  <p style={{ fontSize: 11, color: '#ff6b6b', textAlign: 'center' }}>
                    Configura {cellCount - configuredSongs.length} cançó(ns) més abans de generar butlletes.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

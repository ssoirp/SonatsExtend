'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { hasToken, startSpotifyAuth, clearToken } from '@/lib/spotify';
import {
  clearPlayed, loadPlayed, loadSongs, loadProjectList, getActiveProjectId, setActiveProjectId,
  createProject, deleteProject, saveProjectList, saveBingoSession,
} from '@/lib/state';

const SpotifyIcon = () => (
  <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" style={{ flexShrink: 0 }}>
    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
  </svg>
);

export default function Home() {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [activeId, setActiveId] = useState('');
  const [showNewProject, setShowNewProject] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    setConnected(hasToken());
    const list = loadProjectList();
    setProjects(list);
    setActiveId(getActiveProjectId());
    const played = loadPlayed();
    const total = loadSongs().length;
    setHasSession(played.length > 0 && played.length < total);
  }, []);

  function selectProject(id: string) {
    setActiveProjectId(id);
    setActiveId(id);
  }

  function handleNewProject() {
    const name = newName.trim();
    if (!name) return;
    const p = createProject(name);
    setProjects(loadProjectList());
    selectProject(p.id);
    setNewName('');
    setShowNewProject(false);
  }

  function handleDeleteProject(id: string) {
    if (projects.length <= 1) return;
    deleteProject(id);
    const list = loadProjectList();
    setProjects(list);
    setActiveId(getActiveProjectId());
  }

  function handleRenameProject(id: string) {
    const name = editName.trim();
    if (!name) return;
    const list = projects.map(p => p.id === id ? { ...p, name } : p);
    setProjects(list);
    saveProjectList(list);
    setEditingId(null);
  }

  function handleContinue() {
    router.push('/bingo');
  }

  function handleReset() {
    clearPlayed();
    saveBingoSession(null);
    router.push('/bingo');
  }

  return (
    <main
      className="fade-up"
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        background: `
          radial-gradient(ellipse 55% 45% at 15% 5%,  rgba(29,185,84,0.08)  0%, transparent 100%),
          radial-gradient(ellipse 55% 45% at 85% 95%, rgba(120,60,220,0.08) 0%, transparent 100%),
          #050508
        `,
        position: 'relative',
      }}
    >
      <div style={{
        position: 'fixed', inset: 0,
        backgroundImage: `
          linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)
        `,
        backgroundSize: '52px 52px',
        pointerEvents: 'none',
        zIndex: 0,
      }} />

      <div style={{
        position: 'relative', zIndex: 1,
        width: '100%', maxWidth: 340,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
      }}>
        <div style={{
          width: 80, height: 80,
          borderRadius: 24,
          background: 'linear-gradient(145deg, #1e1e2e, #26263a)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 4px 32px rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 34,
          marginBottom: 24,
        }}>
          🎵
        </div>

        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 40,
          fontWeight: 800,
          letterSpacing: '-0.5px',
          color: 'var(--text)',
          marginBottom: 8,
          textAlign: 'center',
        }}>
          Bingo Musical
        </h1>

        <p style={{
          fontSize: 11,
          fontWeight: 500,
          color: 'var(--text3)',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          marginBottom: 32,
        }}>
          Pompeu Farra &apos;26
        </p>

        {/* Project selector */}
        <div style={{
          width: '100%',
          background: '#161622',
          borderRadius: 16,
          border: '1px solid rgba(255,255,255,0.07)',
          padding: '12px',
          marginBottom: 20,
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <p style={{
            fontSize: 10, fontWeight: 700,
            color: 'var(--text3)',
            textTransform: 'uppercase', letterSpacing: '0.1em',
            marginBottom: 4, paddingLeft: 4,
          }}>
            Projecte
          </p>
          {projects.map(p => (
            <div
              key={p.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 12px',
                borderRadius: 12,
                background: p.id === activeId ? 'rgba(29,185,84,0.12)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${p.id === activeId ? 'rgba(29,185,84,0.3)' : 'transparent'}`,
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onClick={() => selectProject(p.id)}
            >
              <span style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: p.id === activeId ? '#1DB954' : 'rgba(255,255,255,0.15)',
              }} />
              {editingId === p.id ? (
                <input
                  autoFocus
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onBlur={() => handleRenameProject(p.id)}
                  onKeyDown={e => { if (e.key === 'Enter') handleRenameProject(p.id); if (e.key === 'Escape') setEditingId(null); }}
                  onClick={e => e.stopPropagation()}
                  style={{
                    flex: 1, background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 6, padding: '3px 8px',
                    fontSize: 13, color: 'var(--text)', outline: 'none',
                  }}
                />
              ) : (
                <span
                  style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}
                  onDoubleClick={e => { e.stopPropagation(); setEditingId(p.id); setEditName(p.name); }}
                >
                  {p.name}
                </span>
              )}
              {projects.length > 1 && (
                <button
                  onClick={e => { e.stopPropagation(); handleDeleteProject(p.id); }}
                  className="btn-ghost"
                  style={{ color: 'var(--text3)', fontSize: 13, padding: '0 4px' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#ff4757')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text3)')}
                >
                  ✕
                </button>
              )}
            </div>
          ))}

          {showNewProject ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleNewProject(); if (e.key === 'Escape') setShowNewProject(false); }}
                placeholder="Nom del projecte..."
                style={{
                  flex: 1, padding: '8px 12px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 10, fontSize: 13,
                  color: 'var(--text)', outline: 'none',
                }}
              />
              <button
                onClick={handleNewProject}
                className="btn-interact"
                style={{
                  padding: '8px 14px', borderRadius: 10,
                  fontSize: 12, fontWeight: 600,
                  background: '#1DB954', color: '#000',
                }}
              >
                Crear
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowNewProject(true)}
              className="btn-interact"
              style={{
                padding: '8px 12px', borderRadius: 10,
                fontSize: 12, color: 'var(--text3)',
                background: 'rgba(255,255,255,0.04)',
                border: '1px dashed rgba(255,255,255,0.12)',
              }}
            >
              + Nou projecte
            </button>
          )}
        </div>

        {!connected ? (
          <button
            onClick={startSpotifyAuth}
            className="btn-interact"
            style={{
              width: '100%',
              padding: '20px 32px',
              borderRadius: 18,
              background: '#1DB954',
              color: '#000',
              fontWeight: 700,
              fontSize: 18,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
            }}
          >
            <SpotifyIcon />
            Connectar Spotify
          </button>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
              <button
                onClick={handleContinue}
                className="btn-interact"
                style={{
                  width: '100%',
                  padding: '20px 32px',
                  borderRadius: 18,
                  background: '#1DB954',
                  color: '#000',
                  fontWeight: 700,
                  fontSize: 18,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                }}
              >
                <SpotifyIcon />
                {hasSession ? 'Continuar Bingo' : 'Començar Bingo'}
              </button>

              {hasSession && (
                <button
                  onClick={handleReset}
                  className="btn-interact"
                  style={{
                    width: '100%',
                    padding: '14px 28px',
                    borderRadius: 14,
                    background: 'rgba(255,71,87,0.1)',
                    border: '1px solid rgba(255,71,87,0.2)',
                    color: '#ff6b6b',
                    fontWeight: 600,
                    fontSize: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  Reiniciar Bingo
                </button>
              )}

              <button
                onClick={() => router.push('/config')}
                className="btn-interact"
                style={{
                  width: '100%',
                  padding: '18px 28px',
                  borderRadius: 16,
                  background: '#1e1e2e',
                  border: '1px solid rgba(255,255,255,0.07)',
                  color: 'var(--text)',
                  fontWeight: 600,
                  fontSize: 16,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                Configurar
              </button>

              <button
                onClick={() => router.push('/played')}
                className="btn-interact"
                style={{
                  width: '100%',
                  padding: '18px 28px',
                  borderRadius: 16,
                  background: '#1e1e2e',
                  border: '1px solid rgba(255,255,255,0.07)',
                  color: 'var(--text)',
                  fontWeight: 600,
                  fontSize: 16,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                Cançons Jugades
              </button>
            </div>

            <button
              onClick={() => { clearToken(); setConnected(false); }}
              className="btn-ghost"
              style={{
                color: 'var(--text3)',
                fontSize: 13,
                marginTop: 20,
              }}
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

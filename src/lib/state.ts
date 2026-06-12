import defaultSongsData from '@/data/songs.json';
import defaultProjectData from '@/data/default-project.json';

export interface Config {
  inCue: number;
  outCue: number;
  defaultInSec: number;
  defaultOutSec: number;
}

export const DEFAULT_CONFIG: Config = {
  inCue: 1,
  outCue: 3,
  defaultInSec: 30,
  defaultOutSec: 60,
};

export interface SongConfig {
  inCue?: number;
  outCue?: number;
  cues?: Record<string, number>;
  inMs?: number;
  outMs?: number;
}

export type SongConfigMap = Record<string, SongConfig>;

export interface SongData {
  uri: string;
  name: string;
  artist: string;
  duration_ms: number;
  cues: Record<string, number>;
}

export interface Project {
  id: string;
  name: string;
  songs: SongData[];
  config: Config;
  songConfigs: SongConfigMap;
  played: string[];
}

export interface PlaylistExport {
  version: number;
  exportedAt: string;
  config: Config;
  songConfigs: SongConfigMap;
  songs: SongData[];
}

const DEFAULT_PROJECT_ID = 'default';

function getProjectKey(id: string) {
  return `bingo_project_${id}`;
}

const isBrowser = typeof window !== 'undefined';

export function loadProjectList(): { id: string; name: string }[] {
  if (!isBrowser) return [{ id: DEFAULT_PROJECT_ID, name: 'Pompeu Farra \'26' }];
  try {
    const list = JSON.parse(localStorage.getItem('bingo_projects') || '[]');
    if (list.length === 0) {
      return [{ id: DEFAULT_PROJECT_ID, name: 'Pompeu Farra \'26' }];
    }
    return list;
  } catch { return [{ id: DEFAULT_PROJECT_ID, name: 'Pompeu Farra \'26' }]; }
}

export function saveProjectList(list: { id: string; name: string }[]) {
  localStorage.setItem('bingo_projects', JSON.stringify(list));
}

export function getActiveProjectId(): string {
  if (!isBrowser) return DEFAULT_PROJECT_ID;
  return localStorage.getItem('bingo_active_project') || DEFAULT_PROJECT_ID;
}

export function setActiveProjectId(id: string) {
  localStorage.setItem('bingo_active_project', id);
}

export function loadProject(id: string): Project {
  if (!isBrowser) {
    return { id, name: '', songs: defaultSongsData as SongData[], config: DEFAULT_CONFIG, songConfigs: {}, played: [] };
  }
  try {
    const raw = localStorage.getItem(getProjectKey(id));
    if (raw) {
      const p = JSON.parse(raw) as Project;
      return { ...p, config: { ...DEFAULT_CONFIG, ...p.config } };
    }
  } catch { /* fall through */ }

  if (id === DEFAULT_PROJECT_ID) {
    return migrateFromLegacy();
  }

  return {
    id,
    name: 'Nou projecte',
    songs: [],
    config: DEFAULT_CONFIG,
    songConfigs: {},
    played: [],
  };
}

export function saveProject(p: Project) {
  localStorage.setItem(getProjectKey(p.id), JSON.stringify(p));
  const list = loadProjectList();
  if (!list.find(l => l.id === p.id)) {
    list.push({ id: p.id, name: p.name });
    saveProjectList(list);
  } else {
    const idx = list.findIndex(l => l.id === p.id);
    if (idx >= 0 && list[idx].name !== p.name) {
      list[idx].name = p.name;
      saveProjectList(list);
    }
  }
}

export function deleteProject(id: string) {
  localStorage.removeItem(getProjectKey(id));
  const list = loadProjectList().filter(l => l.id !== id);
  saveProjectList(list);
  if (getActiveProjectId() === id) {
    setActiveProjectId(list[0]?.id || DEFAULT_PROJECT_ID);
  }
}

export function createProject(name: string): Project {
  const id = `proj_${Date.now().toString(36)}`;
  const p: Project = {
    id,
    name,
    songs: [],
    config: DEFAULT_CONFIG,
    songConfigs: {},
    played: [],
  };
  saveProject(p);
  return p;
}

function migrateFromLegacy(): Project {
  const defaultProject = defaultProjectData as any;
  let config = defaultProject.config;
  let songConfigs = defaultProject.songConfigs;
  let played: string[] = [];

  try {
    const oldConfig = JSON.parse(localStorage.getItem('bingo_config') || '{}');
    if (Object.keys(oldConfig).length > 0) {
      config = { ...config, ...oldConfig };
    }
  } catch {}
  try {
    const oldSongConfigs = JSON.parse(localStorage.getItem('bingo_song_configs') || '{}');
    if (Object.keys(oldSongConfigs).length > 0) {
      songConfigs = { ...songConfigs, ...oldSongConfigs };
    }
  } catch {}
  try { played = JSON.parse(localStorage.getItem('bingo_played') || '[]'); } catch {}

  return {
    id: DEFAULT_PROJECT_ID,
    name: 'Pompeu Farra \'26',
    songs: defaultProject.songs,
    config,
    songConfigs,
    played,
  };
}

// Legacy wrappers for bingo page (operate on active project)
export function loadConfig(): Config {
  return loadProject(getActiveProjectId()).config;
}

export function saveConfig(c: Config) {
  const p = loadProject(getActiveProjectId());
  p.config = c;
  saveProject(p);
}

export function loadSongConfigs(): SongConfigMap {
  return loadProject(getActiveProjectId()).songConfigs;
}

export function saveSongConfigs(sc: SongConfigMap) {
  const p = loadProject(getActiveProjectId());
  p.songConfigs = sc;
  saveProject(p);
}

export function loadPlayed(): string[] {
  return loadProject(getActiveProjectId()).played;
}

export function savePlayed(played: string[]) {
  const p = loadProject(getActiveProjectId());
  p.played = played;
  saveProject(p);
}

export function clearPlayed() {
  const p = loadProject(getActiveProjectId());
  p.played = [];
  saveProject(p);
}

export function loadSongs(): SongData[] {
  return loadProject(getActiveProjectId()).songs;
}

export interface BingoSession {
  currentUri: string;
  outMs: number;
  totalSec: number;
  inMs: number;
}

export function saveBingoSession(session: BingoSession | null) {
  if (!isBrowser) return;
  if (session) {
    localStorage.setItem('bingo_session', JSON.stringify(session));
  } else {
    localStorage.removeItem('bingo_session');
  }
}

export function loadBingoSession(): BingoSession | null {
  if (!isBrowser) return null;
  try {
    const raw = localStorage.getItem('bingo_session');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function exportPlaylistConfig(config: Config, songConfigs: SongConfigMap, songs: SongData[]): PlaylistExport {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    config,
    songConfigs,
    songs,
  };
}

const CLIENT_ID = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID!;
const REDIRECT_URI = process.env.NEXT_PUBLIC_SPOTIFY_REDIRECT_URI!;
const SCOPES = 'user-read-playback-state user-modify-playback-state';

// PKCE helpers
function generateCodeVerifier(length = 128) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  return Array.from(crypto.getRandomValues(new Uint8Array(length)))
    .map((b) => chars[b % chars.length])
    .join('');
}

async function generateCodeChallenge(verifier: string) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export async function startSpotifyAuth() {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  sessionStorage.setItem('pkce_verifier', verifier);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

export async function exchangeCode(code: string): Promise<string> {
  const verifier = sessionStorage.getItem('pkce_verifier')!;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  const data = await res.json();
  const token = data.access_token;
  const expires = Date.now() + data.expires_in * 1000;
  localStorage.setItem('spotify_token', token);
  localStorage.setItem('spotify_token_expires', String(expires));
  if (data.refresh_token) localStorage.setItem('spotify_refresh_token', data.refresh_token);
  return token;
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem('spotify_refresh_token');
  if (!refreshToken) return null;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    clearToken();
    return null;
  }
  const data = await res.json();
  const token = data.access_token;
  const expires = Date.now() + data.expires_in * 1000;
  localStorage.setItem('spotify_token', token);
  localStorage.setItem('spotify_token_expires', String(expires));
  if (data.refresh_token) localStorage.setItem('spotify_refresh_token', data.refresh_token);
  return token;
}

export function hasToken(): boolean {
  const token = localStorage.getItem('spotify_token');
  const refresh = localStorage.getItem('spotify_refresh_token');
  return !!(token || refresh);
}

let refreshPromise: Promise<string | null> | null = null;

export async function getToken(): Promise<string | null> {
  const token = localStorage.getItem('spotify_token');
  const expires = Number(localStorage.getItem('spotify_token_expires') || 0);
  if (token && Date.now() < expires) return token;
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

export function clearToken() {
  localStorage.removeItem('spotify_token');
  localStorage.removeItem('spotify_token_expires');
  localStorage.removeItem('spotify_refresh_token');
}

async function api(method: string, path: string, body?: object) {
  const token = await getToken();
  if (!token) throw new Error('No token');
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204 || res.status === 202) return null;
  if (!res.ok) throw new Error(`Spotify ${res.status}`);
  return res.json();
}

export async function playTrack(uri: string, position_ms: number) {
  await api('PUT', '/me/player/play', { uris: [uri], position_ms });
}

export async function pausePlayback() {
  await api('PUT', '/me/player/pause');
}

export async function resumePlayback() {
  await api('PUT', '/me/player/play');
}

export async function getCurrentPosition(): Promise<number | null> {
  const data = await api('GET', '/me/player');
  if (!data || !data.is_playing) return null;
  return data.progress_ms;
}

export async function seekTo(position_ms: number) {
  await api('PUT', `/me/player/seek?position_ms=${Math.round(position_ms)}`, undefined);
}

export async function getPlaybackState(): Promise<{ position_ms: number; is_playing: boolean } | null> {
  const data = await api('GET', '/me/player');
  if (!data) return null;
  return { position_ms: data.progress_ms ?? 0, is_playing: data.is_playing ?? false };
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  images: { url: string }[];
  tracks: { total: number };
}

export interface SpotifyTrack {
  uri: string;
  name: string;
  artists: { name: string }[];
  duration_ms: number;
}

export async function getUserPlaylists(): Promise<SpotifyPlaylist[]> {
  const playlists: SpotifyPlaylist[] = [];
  let url = '/me/playlists?limit=50';
  while (url) {
    const data = await api('GET', url);
    if (!data) break;
    playlists.push(...data.items);
    url = data.next ? data.next.replace('https://api.spotify.com/v1', '') : '';
  }
  return playlists;
}

export async function getPlaylistTracks(playlistId: string): Promise<SpotifyTrack[]> {
  const tracks: SpotifyTrack[] = [];
  let url = `/playlists/${playlistId}/tracks?limit=100&fields=items(track(uri,name,artists(name),duration_ms)),next`;
  while (url) {
    const data = await api('GET', url);
    if (!data) break;
    for (const item of data.items) {
      if (item.track && item.track.uri) {
        tracks.push(item.track);
      }
    }
    url = data.next ? data.next.replace('https://api.spotify.com/v1', '') : '';
  }
  return tracks;
}

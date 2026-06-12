import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface DbSong {
  id: number;
  title: string;
  artist: string;
  year: number | null;
  spotify: string | null;
  in_bingo: number | null;
  out_bingo: number | null;
}

export interface DbSorteig {
  id: string;
  user_id: string;
  name: string | null;
  playlist_id: string | null;
  n: number;
  seed: string | null;
  random_mode: boolean;
  fast_mode: boolean;
  is_public: boolean;
  share_code: string | null;
  grid_rows: number;
  grid_cols: number;
  created_at: string;
  updated_at: string;
}

export interface DbSorteigItem {
  id: string;
  sorteig_id: string;
  position: number;
  uri: string;
  title: string | null;
  artist: string | null;
  in_ms: number | null;
  out_ms: number | null;
  is_star: boolean;
  created_at: string;
}

export interface DbTicket {
  id: string;
  sorteig_id: string | null;
  session_id: string | null;
  device_id: string | null;
  seed: string | null;
  locked: boolean;
  marked: number[];
  song_positions: number[];
  created_at: string;
}

export async function fetchSorteigs(): Promise<DbSorteig[]> {
  const { data, error } = await supabase
    .from('sorteigs')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchSorteig(id: string): Promise<DbSorteig | null> {
  const { data, error } = await supabase
    .from('sorteigs')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return null;
  return data;
}

export async function fetchSorteigByShareCode(code: string): Promise<DbSorteig | null> {
  const { data, error } = await supabase
    .from('sorteigs')
    .select('*')
    .eq('share_code', code)
    .single();
  if (error) return null;
  return data;
}

export async function fetchSorteigItems(sorteigId: string): Promise<DbSorteigItem[]> {
  const { data, error } = await supabase
    .from('sorteig_items')
    .select('*')
    .eq('sorteig_id', sorteigId)
    .order('position', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createSorteig(params: {
  name: string;
  playlistId?: string;
  gridRows?: number;
  gridCols?: number;
}): Promise<DbSorteig> {
  const shareCode = Math.random().toString(16).slice(2, 10);
  const { data, error } = await supabase
    .from('sorteigs')
    .insert({
      user_id: '11111111-2222-3333-4444-555555555555',
      name: params.name,
      playlist_id: params.playlistId ?? null,
      n: 0,
      random_mode: true,
      fast_mode: false,
      is_public: false,
      share_code: shareCode,
      grid_rows: params.gridRows ?? 3,
      grid_cols: params.gridCols ?? 3,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateSorteig(id: string, updates: Partial<Pick<DbSorteig, 'name' | 'grid_rows' | 'grid_cols' | 'n'>>) {
  const { error } = await supabase
    .from('sorteigs')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteSorteig(id: string) {
  await supabase.from('sorteig_items').delete().eq('sorteig_id', id);
  await supabase.from('tickets').delete().eq('sorteig_id', id);
  const { error } = await supabase.from('sorteigs').delete().eq('id', id);
  if (error) throw error;
}

export async function insertSorteigItems(items: Omit<DbSorteigItem, 'id' | 'created_at'>[]) {
  const { error } = await supabase.from('sorteig_items').insert(items);
  if (error) throw error;
}

export async function updateSorteigItem(id: string, updates: { in_ms?: number | null; out_ms?: number | null }) {
  const { error } = await supabase.from('sorteig_items').update(updates).eq('id', id);
  if (error) throw error;
}

export async function deleteSorteigItem(id: string) {
  const { error } = await supabase.from('sorteig_items').delete().eq('id', id);
  if (error) throw error;
}

export async function lookupSongTimecodes(spotifyUris: string[]): Promise<Map<string, { in_bingo: number | null; out_bingo: number | null }>> {
  const map = new Map<string, { in_bingo: number | null; out_bingo: number | null }>();
  if (spotifyUris.length === 0) return map;

  const { data, error } = await supabase
    .from('songs')
    .select('spotify, in_bingo, out_bingo')
    .in('spotify', spotifyUris);
  if (error) return map;

  for (const row of data ?? []) {
    if (row.spotify) {
      map.set(row.spotify, { in_bingo: row.in_bingo, out_bingo: row.out_bingo });
    }
  }
  return map;
}

export async function saveSongTimecodes(spotifyUri: string, inSec: number | null, outSec: number | null) {
  const { data: existing } = await supabase
    .from('songs')
    .select('id, in_bingo, out_bingo')
    .eq('spotify', spotifyUri)
    .single();

  if (existing) {
    if (existing.in_bingo === null && inSec !== null || existing.out_bingo === null && outSec !== null) {
      await supabase.from('songs').update({
        in_bingo: existing.in_bingo ?? inSec,
        out_bingo: existing.out_bingo ?? outSec,
      }).eq('id', existing.id);
    }
  }
}

export async function createTicket(sorteigId: string, deviceId: string, songPositions: number[], gridRows: number, gridCols: number): Promise<DbTicket> {
  const { data, error } = await supabase
    .from('tickets')
    .insert({
      sorteig_id: sorteigId,
      device_id: deviceId,
      seed: Math.random().toString(36).slice(2),
      locked: false,
      marked: [],
      song_positions: songPositions,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function fetchTicket(id: string): Promise<DbTicket | null> {
  const { data, error } = await supabase
    .from('tickets')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return null;
  return data;
}

export async function fetchTicketsByDevice(sorteigId: string, deviceId: string): Promise<DbTicket[]> {
  const { data, error } = await supabase
    .from('tickets')
    .select('*')
    .eq('sorteig_id', sorteigId)
    .eq('device_id', deviceId);
  if (error) return [];
  return data ?? [];
}

export async function updateTicketMarked(ticketId: string, marked: number[]) {
  const { error } = await supabase
    .from('tickets')
    .update({ marked })
    .eq('id', ticketId);
  if (error) throw error;
}

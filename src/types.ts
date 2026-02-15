export interface User {
  id: string;
  telegram_id: number;
  timezone: string;
  utc_offset: number;
  is_virtual: boolean;
  created_at: string;
  stats_chains: number;
  stats_completions: number;
  stats_score: number;
}

export interface Chain {
  id: string;
  date: string;
  hour: number;
  status: 'active' | 'completed' | 'broken';
  current_tz: number;
  blocks_count: number;
  created_at: string;
  completed_at: string | null;
}

export interface Message {
  id: string;
  chain_id: string;
  block_num: number;
  user_id: string | null;
  is_ai: boolean;
  content: string;
  content_translated: string | null;
  media_type: 'text' | 'photo' | 'voice';
  media_url: string | null;
  timezone: string;
  utc_offset: number;
  context_tag: string | null;
  hash: string;
  prev_hash: string | null;
  created_at: string;
}

export interface ContextTag {
  city: string;
  weather: string;
  mood: string;
  localTime: string;
}

export type ChainAction = 'delivered' | 'completed' | 'broken';

export interface TickResult {
  chainId: string;
  action: ChainAction;
  blockNum: number;
  isAi: boolean;
  message: string;
}

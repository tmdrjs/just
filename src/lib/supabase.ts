import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && key);

let client: SupabaseClient | null = null;

/** 브라우저 전용 Supabase 클라이언트. 세션은 localStorage에 남아 재방문 시 그대로 쓰인다. */
export function getSupabase(): SupabaseClient {
  if (!client) {
    if (!url || !key) throw new Error("Supabase 환경변수가 설정되지 않았습니다.");
    client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  return client;
}

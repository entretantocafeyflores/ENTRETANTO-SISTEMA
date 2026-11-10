import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
export const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

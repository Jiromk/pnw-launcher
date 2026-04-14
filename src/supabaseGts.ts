import { createClient } from "@supabase/supabase-js";

const SUPABASE_GTS_URL = "https://bakostikmkxhtlzlcyky.supabase.co";
const SUPABASE_GTS_ANON_KEY = "sb_publishable_1A7TB4mar3L8Gurm7BvN7g_jXIrHqO-";

export const supabaseGts = createClient(SUPABASE_GTS_URL, SUPABASE_GTS_ANON_KEY);

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://dovowxtsdwbmvraamkvd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_dtIeQ2y8EOG6SRaB_C2sFQ__CZNiRSO";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    flowType: "pkce",
    detectSessionInUrl: true,
  },
});

"use strict";

(function () {
  const SUPABASE_URL =
    "https://tlbjolxocqozkxtmswrr.supabase.co";

  const SUPABASE_ANON_KEY =
    "sb_publishable_O3BbJ4wRt5tjn1cIRA2YgQ_CCgI-asz";

  const REMEMBER_KEY =
    "nexusnote-remember-session";

  const storage = {
    getItem(key) {
      return (
        localStorage.getItem(key) ||
        sessionStorage.getItem(key)
      );
    },

    setItem(key, value) {
      const remember =
        localStorage.getItem(REMEMBER_KEY) !== "false";

      localStorage.removeItem(key);
      sessionStorage.removeItem(key);

      const selectedStorage =
        remember
          ? localStorage
          : sessionStorage;

      selectedStorage.setItem(key, value);
    },

    removeItem(key) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    }
  };

  if (!window.supabase) {
    console.error(
      "A biblioteca do Supabase não foi carregada."
    );
    return;
  }

  window.supabaseClient =
    window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
          storage
        }
      }
    );
})();
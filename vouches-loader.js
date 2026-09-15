// ============================================================
// AceSnap live vouches loader
//
// IMPORTANT:
// - Your existing hardcoded VOUCHES array stays untouched.
// - Approved Supabase vouches are appended to it.
// - Do NOT declare another `let VOUCHES` here.
// ============================================================

const ACESNAP_SUPABASE_URL = "https://vqdfbwjcugnbkxyrtnxn.supabase.co";
const ACESNAP_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZxZGZid2pjdWduYmt4eXJ0bnhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0ODg0NzIsImV4cCI6MjEwNTA2NDQ3Mn0.23WNEL6Ztu_cMYZKc-NvI63CCuaHYTmYDI4Nf6f96Q0";

const aceSnapSupabase = window.supabase.createClient(
  ACESNAP_SUPABASE_URL,
  ACESNAP_SUPABASE_ANON_KEY
);

// Keep a permanent copy of the original hardcoded vouches.
// This prevents live Supabase vouches from replacing them.
function getStaticVouches() {
  if (!Array.isArray(window.__ACESNAP_STATIC_VOUCHES)) {
    window.__ACESNAP_STATIC_VOUCHES = VOUCHES.map(v => ({ ...v }));
  }

  return window.__ACESNAP_STATIC_VOUCHES;
}

async function loadVouches() {
  try {
    const staticVouches = getStaticVouches();

    const { data, error } = await aceSnapSupabase
      .from("vouches")
      .select("name, role, quote, rating, avatar_url, link, created_at")
      .eq("status", "approved")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to load Supabase vouches:", error);

      // If Supabase fails, keep the original vouches visible.
      VOUCHES.length = 0;
      VOUCHES.push(...staticVouches);
    } else {
      const liveVouches = (data || []).map(v => ({
        name: v.name,
        role: v.role,
        quote: v.quote,
        rating: v.rating,
        avatar: v.avatar_url || "",
        link: v.link || ""
      }));

      // 3 original vouches + all approved Supabase vouches.
      VOUCHES.length = 0;
      VOUCHES.push(...staticVouches, ...liveVouches);
    }

    if (typeof renderVouches === "function") {
      renderVouches();
    }
  } catch (err) {
    console.error("Unexpected vouch loader error:", err);

    if (typeof renderVouches === "function") {
      renderVouches();
    }
  }
}

// Make it available globally if you ever want to refresh manually.
window.loadVouches = loadVouches;

// Load approved vouches automatically.
loadVouches();

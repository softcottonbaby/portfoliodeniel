// --- Vouches (live, auto-approved via admin.html) ---
// Replaces the old hardcoded VOUCHES array. Approved vouches load
// straight from Supabase — approve one in admin.html and it shows
// up here automatically, no code edits or redeploys needed.

const SUPABASE_URL = "https://vqdfbwjcugnbkxyrtnxn.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZxZGZid2pjdWduYmt4eXJ0bnhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0ODg0NzIsImV4cCI6MjEwNTA2NDQ3Mn0.23WNEL6Ztu_cMYZKc-NvI63CCuaHYTmYDI4Nf6f96Q0";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let VOUCHES = [];

async function loadVouches() {
  const { data, error } = await supabaseClient
    .from('vouches')
    .select('name, role, quote, rating, avatar_url, link')
    .eq('status', 'approved')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to load vouches:', error);
    VOUCHES = [];
  } else {
    VOUCHES = data.map(v => ({
      name: v.name,
      role: v.role,
      quote: v.quote,
      rating: v.rating,
      avatar: v.avatar_url || "",
      link: v.link || ""
    }));
  }
  renderVouches();
}

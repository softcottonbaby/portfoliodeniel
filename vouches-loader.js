// ============================================================
// AceSnap live vouches loader
// Fast version — uses Supabase REST directly.
// ============================================================

const ACESNAP_SUPABASE_URL =
    "https://vqdfbwjcugnbkxyrtnxn.supabase.co";

const ACESNAP_SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZxZGZid2pjdWduYmt4eXJ0bnhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0ODg0NzIsImV4cCI6MjEwNTA2NDQ3Mn0.23WNEL6Ztu_cMYZKc-NvI63CCuaHYTmYDI4Nf6f96Q0";

function getStaticVouches() {
    if (!Array.isArray(window.__ACESNAP_STATIC_VOUCHES)) {
        window.__ACESNAP_STATIC_VOUCHES = VOUCHES.map(v => ({ ...v }));
    }

    return window.__ACESNAP_STATIC_VOUCHES;
}

async function loadVouches() {
    try {
        const staticVouches = getStaticVouches();

        const url =
            `${ACESNAP_SUPABASE_URL}/rest/v1/vouches` +
            `?select=name,role,quote,rating,avatar_url,link,created_at` +
            `&status=eq.approved` +
            `&order=created_at.desc`;

        const response = await fetch(url, {
            method: "GET",
            headers: {
                "apikey": ACESNAP_SUPABASE_ANON_KEY,
                "Authorization": `Bearer ${ACESNAP_SUPABASE_ANON_KEY}`
            }
        });

        if (!response.ok) {
            throw new Error(`Supabase HTTP ${response.status}`);
        }

        const data = await response.json();

        const liveVouches = (data || []).map(v => ({
            name: v.name,
            role: v.role,
            quote: v.quote,
            rating: v.rating,
            avatar: v.avatar_url || "",
            link: v.link || ""
        }));

        VOUCHES.length = 0;
        VOUCHES.push(...staticVouches, ...liveVouches);

        if (typeof renderVouches === "function") {
            renderVouches();
        }

        console.log(
            `AceSnap: loaded ${liveVouches.length} live vouch(es).`
        );

    } catch (err) {
        console.error("Failed to load Supabase vouches:", err);

        VOUCHES.length = 0;
        VOUCHES.push(...getStaticVouches());

        if (typeof renderVouches === "function") {
            renderVouches();
        }
    }
}

window.loadVouches = loadVouches;

loadVouches();

import { useState, useEffect, useCallback, useRef } from "react";

const BOT_TOKEN = "8662339296:AAEMzUBkgN9nuDLmDgxE93l5IarlGiB0Ikc";
const CHANNEL_ID = "-1003831838516";
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const CACHE_KEY = "tg_leos_pov_v1";
const OFFSET_KEY = "tg_leos_pov_offset_v1";
const SECRET_CODE = "LJCBSET";

function getCached() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "[]"); } catch { return []; }
}
function saveCached(photos) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(photos.map(({ id, file_id, caption, date }) => ({ id, file_id, caption, date })))); } catch {}
}
function getStoredOffset() {
  try { return parseInt(localStorage.getItem(OFFSET_KEY) || "0", 10) || 0; } catch { return 0; }
}
function saveOffset(n) { try { localStorage.setItem(OFFSET_KEY, String(n)); } catch {} }

async function fetchUpdates(offset) {
  const params = `limit=100&allowed_updates=${encodeURIComponent('["channel_post"]')}${offset ? `&offset=${offset}` : ""}`;
  const res = await fetch(`${API}/getUpdates?${params}`);
  if (!res.ok) throw new Error(`Network error ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || "Telegram API error");
  return data.result;
}

async function resolveUrl(file_id) {
  try {
    const res = await fetch(`${API}/getFile?file_id=${encodeURIComponent(file_id)}`);
    const data = await res.json();
    if (data.ok) return `https://api.telegram.org/file/bot${BOT_TOKEN}/${data.result.file_path}`;
  } catch {}
  return null;
}

async function resolveBatch(photos, onProgress) {
  const SIZE = 6;
  const results = photos.map((p) => ({ ...p }));
  for (let i = 0; i < photos.length; i += SIZE) {
    const batch = photos.slice(i, i + SIZE);
    const urls = await Promise.all(batch.map((p) => resolveUrl(p.file_id)));
    batch.forEach((photo, j) => {
      const idx = results.findIndex((p) => p.id === photo.id);
      if (idx !== -1) results[idx].url = urls[j] || "error";
    });
    onProgress([...results]);
    if (i + SIZE < photos.length) await new Promise((r) => setTimeout(r, 120));
  }
  return results;
}

const FacebookIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>
  </svg>
);
const TikTokIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34l-.02-8.38a8.17 8.17 0 0 0 4.79 1.52V5.01a4.85 4.85 0 0 1-1-.32z"/>
  </svg>
);
const InstagramIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
    <circle cx="12" cy="12" r="5"/>
    <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>
  </svg>
);
const GearIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);

export default function LeosPOV() {
  const [photos, setPhotos]       = useState([]);
  const [status, setStatus]       = useState("idle");
  const [errMsg, setErrMsg]       = useState("");
  const [lightbox, setLightbox]   = useState(null);
  const [lbReady, setLbReady]     = useState(false);
  const [settings, setSettings]   = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [toast, setToast]         = useState("");
  const keyBuffer                 = useRef("");
  const keyTimer                  = useRef(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2800);
  };

  const load = useCallback(async (force = false) => {
    setStatus("loading");
    setErrMsg("");
    try {
      const cached = force ? [] : getCached();
      const cachedIds = new Set(cached.map((p) => p.id));
      if (cached.length > 0) {
        setPhotos(cached.map((p) => ({ ...p, url: null })));
        setStatus("resolving");
      }
      const offset = force ? 0 : getStoredOffset();
      const updates = await fetchUpdates(offset);
      const newPhotos = [];
      let maxId = offset;
      for (const u of updates) {
        if (u.update_id >= maxId) maxId = u.update_id + 1;
        const post = u.channel_post;
        if (!post?.photo) continue;
        if (CHANNEL_ID && String(post.chat.id) !== String(CHANNEL_ID)) continue;
        if (cachedIds.has(post.message_id) && !force) continue;
        const largest = post.photo[post.photo.length - 1];
        newPhotos.push({ id: post.message_id, file_id: largest.file_id, caption: post.caption || "", date: new Date(post.date * 1000), url: null });
      }
      if (maxId > offset) saveOffset(maxId);
      const seen = new Set();
      const merged = [...newPhotos, ...cached.map((p) => ({ ...p, url: null }))]
        .filter((p) => { if (seen.has(p.id)) return false; seen.add(p.id); return true; })
        .sort((a, b) => new Date(b.date) - new Date(a.date));
      saveCached(merged);
      setPhotos(merged);
      if (!merged.length) { setStatus("done"); return; }
      setStatus("resolving");
      await resolveBatch(merged, (u) => setPhotos([...u]));
      setStatus("done");
    } catch (e) {
      setErrMsg(e.message);
      setStatus("error");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Secret code listener
  useEffect(() => {
    const handler = (e) => {
      if (["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName)) return;
      keyBuffer.current += e.key.toUpperCase();
      if (keyBuffer.current.length > SECRET_CODE.length)
        keyBuffer.current = keyBuffer.current.slice(-SECRET_CODE.length);
      clearTimeout(keyTimer.current);
      keyTimer.current = setTimeout(() => { keyBuffer.current = ""; }, 1800);
      if (keyBuffer.current === SECRET_CODE) {
        keyBuffer.current = "";
        setSettings((s) => !s);
        setResetDone(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => { window.removeEventListener("keydown", handler); clearTimeout(keyTimer.current); };
  }, []);

  // Lightbox keyboard nav
  useEffect(() => {
    const vis = photos.filter((p) => p.url && p.url !== "error");
    const h = (e) => {
      if (settings) return;
      if (lightbox === null) return;
      if (e.key === "Escape") setLightbox(null);
      if (e.key === "ArrowRight") { setLbReady(false); setLightbox((i) => Math.min(i + 1, vis.length - 1)); }
      if (e.key === "ArrowLeft")  { setLbReady(false); setLightbox((i) => Math.max(i - 1, 0)); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [lightbox, photos, settings]);

  const handleResetGallery = () => {
    try { localStorage.removeItem(CACHE_KEY); localStorage.removeItem(OFFSET_KEY); } catch {}
    setPhotos([]);
    setResetDone(true);
    showToast("Gallery cache cleared.");
    setTimeout(() => { setSettings(false); setResetDone(false); load(true); }, 1200);
  };

  const visiblePhotos = photos.filter((p) => p.url && p.url !== "error");
  const lbPhoto = lightbox !== null ? visiblePhotos[lightbox] : null;
  const isWorking = status === "loading" || status === "resolving";

  const openLb = (i) => { setLbReady(false); setLightbox(i); };
  const navLb  = (d) => { setLbReady(false); setLightbox((i) => Math.max(0, Math.min(visiblePhotos.length - 1, i + d))); };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@300;400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        html {
          width: 100%;
          height: 100%;
          background: #090d14;
          -webkit-text-size-adjust: 100%;
        }

        body {
          width: 100%;
          min-height: 100%;
          background: #090d14;
          margin: 0;
          padding: 0;
        }

        #root, [data-reactroot] {
          width: 100%;
          min-height: 100vh;
        }

        :root {
          --bg:       #090d14;
          --surface:  #0f1520;
          --surface2: #141c2a;
          --border:   #1e2a3a;
          --border2:  #243040;
          --white:    #f0f2f5;
          --grey:     #8a9ab0;
          --grey-dim: #4a5568;
          --red-dim:  rgba(192,57,43,0.12);
          --sans:     'Outfit', sans-serif;
          --display:  'Bebas Neue', sans-serif;
        }

        .pf {
          width: 100%;
          min-height: 100vh;
          background: var(--bg);
          color: var(--white);
          font-family: var(--sans);
          display: flex;
          flex-direction: column;
        }

        /* ── NAV ── */
        .pf-nav {
          width: 100%;
          position: sticky; top: 0; z-index: 100;
          background: rgba(9,13,20,0.92);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border-bottom: 1px solid var(--border);
          padding: 0 48px; height: 60px;
          display: flex; align-items: center; justify-content: flex-end; gap: 20px;
        }
        @media (max-width: 560px) { .pf-nav { padding: 0 18px; height: 54px; } }

        .pf-nav-right { display: flex; align-items: center; gap: 16px; }
        .pf-socials { display: flex; align-items: center; gap: 2px; }

        .pf-social-link {
          display: flex; align-items: center; justify-content: center;
          width: 34px; height: 34px;
          color: var(--grey-dim); text-decoration: none; border-radius: 6px;
          transition: color 0.18s, background 0.18s;
          -webkit-tap-highlight-color: transparent;
        }
        .pf-social-link:hover { color: var(--white); background: var(--surface); }

        .pf-btn {
          background: none; border: 1px solid var(--border); color: var(--grey);
          padding: 6px 14px; font-family: var(--sans); font-size: 0.7rem;
          font-weight: 400; letter-spacing: 0.08em; cursor: pointer;
          transition: border-color 0.18s, color 0.18s, background 0.18s;
          white-space: nowrap; -webkit-tap-highlight-color: transparent; border-radius: 4px;
        }
        .pf-btn:hover:not(:disabled) { border-color: var(--grey); color: var(--white); background: var(--surface); }
        .pf-btn:disabled { opacity: 0.3; cursor: default; }

        /* ── HERO ── */
        .pf-hero {
          width: 100%;
          padding: 52px 48px 40px;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          text-align: center; gap: 8px;
          border-bottom: 1px solid var(--border);
        }
        @media (max-width: 560px) { .pf-hero { padding: 36px 18px 28px; } }

        .pf-hero-eyebrow { font-size: 0.64rem; font-weight: 500; letter-spacing: 0.28em; text-transform: uppercase; color: var(--grey-dim); }
        .pf-hero-title { font-family: var(--display); font-size: clamp(3.8rem, 9vw, 7.5rem); letter-spacing: 0.04em; line-height: 0.9; color: var(--white); }
        .pf-count { font-size: 0.72rem; color: var(--grey-dim); font-weight: 300; margin-top: 6px; }

        /* ── GRID ── */
        .pf-grid {
          width: 100%;
          padding: 20px 48px 72px;
          columns: 3; column-gap: 8px;
        }
        @media (max-width: 860px) { .pf-grid { columns: 2; } }
        @media (max-width: 560px) { .pf-grid { columns: 2; padding: 12px 10px 60px; column-gap: 6px; } }

        .pf-cell { break-inside: avoid; margin-bottom: 8px; position: relative; overflow: hidden; background: var(--surface); display: block; cursor: pointer; }
        @media (max-width: 560px) { .pf-cell { margin-bottom: 6px; } }

        .pf-cell img { width: 100%; height: auto; display: block; opacity: 0; transition: opacity 0.3s ease, transform 0.45s cubic-bezier(0.25,0.46,0.45,0.94); }
        .pf-cell img.img-loaded { opacity: 1; }
        .pf-cell:hover img { transform: scale(1.04); }

        .pf-overlay {
          position: absolute; inset: 0;
          background: linear-gradient(to top, rgba(9,13,20,0.7) 0%, transparent 55%);
          opacity: 0; transition: opacity 0.22s;
          display: flex; align-items: flex-end; padding: 12px 13px; pointer-events: none;
        }
        .pf-cell:hover .pf-overlay { opacity: 1; }
        .pf-cap { font-size: 0.78rem; font-weight: 300; color: rgba(240,242,245,0.88); line-height: 1.4; transform: translateY(4px); opacity: 0; transition: opacity 0.22s, transform 0.22s; }
        .pf-cell:hover .pf-cap { opacity: 1; transform: translateY(0); }

        .pf-skel { padding-top: 128%; background: linear-gradient(90deg, var(--surface) 25%, #162030 50%, var(--surface) 75%); background-size: 200% 100%; animation: shimmer 1.8s infinite; }
        @keyframes shimmer { to { background-position: -200% 0; } }

        /* ── States ── */
        .pf-state {
          width: 100%;
          flex: 1;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 12px; text-align: center;
          padding: 80px 48px;
          min-height: 40vh;
        }
        .pf-state-h { font-family: var(--display); font-size: 1.6rem; letter-spacing: 0.08em; color: var(--grey-dim); }
        .pf-state-bar { width: 28px; height: 1px; background: var(--border); }
        .pf-state-p { font-size: 0.76rem; font-weight: 300; color: var(--grey-dim); line-height: 1.9; }

        .pf-dots { position: fixed; bottom: 22px; right: 24px; display: flex; gap: 4px; opacity: 0.5; z-index: 50; }
        .pf-dot { width: 3px; height: 3px; border-radius: 50%; background: var(--grey); animation: pulse 1.1s ease-in-out infinite; }
        .pf-dot:nth-child(2) { animation-delay: 0.18s; }
        .pf-dot:nth-child(3) { animation-delay: 0.36s; }
        @keyframes pulse { 0%,100%{ opacity:0.2; transform:scale(0.7); } 50%{ opacity:1; transform:scale(1); } }

        /* ── Lightbox ── */
        .pf-lb { position: fixed; inset: 0; z-index: 800; background: rgba(6,9,14,0.97); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 52px 72px 46px; animation: fade-in 0.18s; }
        @media (max-width: 560px) { .pf-lb { padding: 52px 6px 50px; } }
        @keyframes fade-in { from { opacity: 0; } }

        .pf-lb-wrap { flex: 1; display: flex; align-items: center; justify-content: center; width: 100%; position: relative; min-height: 0; }
        .pf-lb img { max-width: 100%; max-height: calc(100dvh - 120px); object-fit: contain; display: block; opacity: 0; transition: opacity 0.25s; }
        .pf-lb img.lb-ready { opacity: 1; }
        .pf-lb-spin { position: absolute; width: 20px; height: 20px; border: 1.5px solid var(--border); border-top-color: var(--grey); border-radius: 50%; animation: spin 0.7s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .pf-lb-close { position: fixed; top: 16px; right: 22px; background: none; border: none; font-family: var(--sans); font-size: 0.68rem; font-weight: 400; letter-spacing: 0.12em; color: var(--grey-dim); cursor: pointer; padding: 8px; transition: color 0.15s; -webkit-tap-highlight-color: transparent; }
        .pf-lb-close:hover { color: var(--white); }
        .pf-lb-prev, .pf-lb-next { position: fixed; top: 50%; transform: translateY(-50%); background: none; border: none; font-family: var(--display); font-size: 2.4rem; color: var(--grey-dim); cursor: pointer; padding: 16px 20px; line-height: 1; transition: color 0.15s; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
        .pf-lb-prev { left: 0; }
        .pf-lb-next { right: 0; }
        .pf-lb-prev:hover:not(:disabled), .pf-lb-next:hover:not(:disabled) { color: var(--white); }
        .pf-lb-prev:disabled, .pf-lb-next:disabled { opacity: 0.12; cursor: default; }
        .pf-lb-footer { width: 100%; display: flex; justify-content: space-between; align-items: center; padding-top: 12px; border-top: 1px solid var(--border); margin-top: 12px; flex-shrink: 0; }
        .pf-lb-cap { font-size: 0.82rem; font-weight: 300; color: var(--grey); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 68%; }
        .pf-lb-idx { font-size: 0.67rem; font-weight: 500; letter-spacing: 0.12em; color: var(--grey-dim); flex-shrink: 0; }

        /* ── Footer ── */
        .pf-footer { width: 100%; margin-top: auto; border-top: 1px solid var(--border); padding: 22px 48px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
        @media (max-width: 560px) { .pf-footer { padding: 18px; flex-direction: column; gap: 12px; text-align: center; } }
        .pf-footer-name { font-family: var(--display); font-size: 1rem; letter-spacing: 0.1em; color: var(--grey-dim); }
        .pf-footer-copy { font-size: 0.68rem; font-weight: 300; color: var(--grey-dim); letter-spacing: 0.04em; }
        .pf-footer-socials { display: flex; gap: 2px; }

        /* ── Settings Modal ── */
        .pf-settings-overlay {
          position: fixed; inset: 0; z-index: 900;
          background: rgba(4,7,12,0.88);
          backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
          display: flex; align-items: center; justify-content: center; padding: 24px;
          animation: fade-in 0.2s;
        }
        .pf-settings-panel {
          background: var(--surface); border: 1px solid var(--border2);
          width: 100%; max-width: 420px; overflow: hidden;
          animation: panel-in 0.22s cubic-bezier(0.16,1,0.3,1);
        }
        @keyframes panel-in { from { opacity:0; transform:translateY(10px) scale(0.98); } }

        .pf-settings-header { padding: 20px 24px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
        .pf-settings-title-wrap { display: flex; align-items: center; gap: 10px; }
        .pf-settings-icon { color: var(--grey-dim); display: flex; align-items: center; }
        .pf-settings-title { font-family: var(--display); font-size: 1.05rem; letter-spacing: 0.14em; color: var(--white); }
        .pf-settings-badge { font-size: 0.58rem; font-weight: 500; letter-spacing: 0.18em; text-transform: uppercase; color: var(--grey-dim); background: var(--surface2); border: 1px solid var(--border); padding: 2px 7px; border-radius: 2px; }
        .pf-settings-close { background: none; border: none; color: var(--grey-dim); cursor: pointer; padding: 4px; font-size: 1rem; line-height: 1; transition: color 0.15s; -webkit-tap-highlight-color: transparent; }
        .pf-settings-close:hover { color: var(--white); }
        .pf-settings-body { padding: 20px 24px 24px; display: flex; flex-direction: column; gap: 14px; }
        .pf-settings-section { background: var(--surface2); border: 1px solid var(--border); padding: 16px 18px; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
        .pf-settings-section-label { font-size: 0.8rem; font-weight: 500; color: var(--white); letter-spacing: 0.04em; margin-bottom: 4px; }
        .pf-settings-section-desc { font-size: 0.7rem; font-weight: 300; color: var(--grey-dim); line-height: 1.6; }
        .pf-settings-action { flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
        .pf-stat { font-size: 0.68rem; color: var(--grey-dim); text-align: right; }
        .pf-stat strong { color: var(--grey); font-weight: 500; }

        .pf-btn-danger { background: rgba(192,57,43,0.12); border: 1px solid rgba(192,57,43,0.3); color: #e05a4e; padding: 7px 16px; font-family: var(--sans); font-size: 0.72rem; font-weight: 500; letter-spacing: 0.06em; cursor: pointer; transition: background 0.18s, border-color 0.18s, color 0.18s; white-space: nowrap; -webkit-tap-highlight-color: transparent; border-radius: 4px; }
        .pf-btn-danger:hover:not(:disabled) { background: rgba(192,57,43,0.22); border-color: rgba(192,57,43,0.55); color: #f07060; }
        .pf-btn-danger:disabled { opacity: 0.4; cursor: default; }
        .pf-btn-success { background: rgba(39,174,96,0.12); border: 1px solid rgba(39,174,96,0.3); color: #4ec882; padding: 7px 16px; font-family: var(--sans); font-size: 0.72rem; font-weight: 500; letter-spacing: 0.06em; border-radius: 4px; cursor: default; }

        .pf-settings-divider { height: 1px; background: var(--border); }
        .pf-settings-hint { font-size: 0.64rem; font-weight: 300; color: var(--grey-dim); text-align: center; letter-spacing: 0.06em; line-height: 1.7; opacity: 0.6; }

        /* ── Toast ── */
        .pf-toast { position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%); z-index: 1000; background: var(--surface2); border: 1px solid var(--border2); color: var(--white); font-size: 0.76rem; font-weight: 400; letter-spacing: 0.04em; padding: 10px 22px; white-space: nowrap; animation: toast-in 0.22s cubic-bezier(0.16,1,0.3,1); pointer-events: none; }
        @keyframes toast-in { from { opacity:0; transform: translateX(-50%) translateY(8px); } }
      `}</style>

      <div className="pf">

        {/* ── NAV ── */}
        <nav className="pf-nav">
          <div className="pf-nav-right">
            <div className="pf-socials">
              <a className="pf-social-link" href="https://www.facebook.com/ragingkamote12" target="_blank" rel="noopener noreferrer" aria-label="Facebook"><FacebookIcon /></a>
              <a className="pf-social-link" href="https://www.tiktok.com/@leojcb09?is_from_webapp=1&sender_device=pc" target="_blank" rel="noopener noreferrer" aria-label="TikTok"><TikTokIcon /></a>
              <a className="pf-social-link" href="https://www.instagram.com/leonjcb09/" target="_blank" rel="noopener noreferrer" aria-label="Instagram"><InstagramIcon /></a>
            </div>
            <button className="pf-btn" onClick={() => load(true)} disabled={isWorking}>
              {status === "loading" ? "loading…" : "↺ refresh"}
            </button>
          </div>
        </nav>

        {/* ── HERO ── */}
        <div className="pf-hero">
          <p className="pf-hero-eyebrow">Photography Portfolio</p>
          <h1 className="pf-hero-title">Leo's POV</h1>
          {visiblePhotos.length > 0 && (
            <span className="pf-count">{visiblePhotos.length} photo{visiblePhotos.length !== 1 ? "s" : ""}</span>
          )}
        </div>

        {/* ── Loading ── */}
        {status === "loading" && photos.length === 0 && (
          <div className="pf-state"><p className="pf-state-h">Loading…</p></div>
        )}

        {/* ── Error ── */}
        {status === "error" && (
          <div className="pf-state">
            <p className="pf-state-h">Failed to load</p>
            <div className="pf-state-bar" />
            <p className="pf-state-p">{errMsg}</p>
            <button className="pf-btn" onClick={() => load()} style={{ marginTop: 12 }}>try again</button>
          </div>
        )}

        {/* ── Empty ── */}
        {status === "done" && photos.length === 0 && (
          <div className="pf-state">
            <p className="pf-state-h">No Photos Yet</p>
            <div className="pf-state-bar" />
            <p className="pf-state-p">Post photos to your Telegram channel<br />and they will appear here.</p>
          </div>
        )}

        {/* ── Grid ── */}
        {photos.length > 0 && (
          <main className="pf-grid">
            {photos.map((photo, i) => {
              const hasUrl = photo.url && photo.url !== "error";
              const visIdx = visiblePhotos.findIndex((p) => p.id === photo.id);
              return (
                <div key={photo.id} className="pf-cell" onClick={() => hasUrl && openLb(visIdx)} style={{ cursor: hasUrl ? "pointer" : "default" }}>
                  {hasUrl ? (
                    <>
                      <img src={photo.url} alt={photo.caption || `Photo ${i + 1}`} loading={i < 6 ? "eager" : "lazy"} decoding="async" onLoad={(e) => e.currentTarget.classList.add("img-loaded")} />
                      <div className="pf-overlay">{photo.caption && <p className="pf-cap">{photo.caption}</p>}</div>
                    </>
                  ) : (
                    <div className="pf-skel" />
                  )}
                </div>
              );
            })}
          </main>
        )}

        {/* ── Resolving dots ── */}
        {status === "resolving" && (
          <div className="pf-dots"><div className="pf-dot" /><div className="pf-dot" /><div className="pf-dot" /></div>
        )}

        {/* ── Footer ── */}
        <footer className="pf-footer">
          <span className="pf-footer-name">LEO'S POV</span>
          <span className="pf-footer-copy">© {new Date().getFullYear()} All rights reserved</span>
          <div className="pf-footer-socials">
            <a className="pf-social-link" href="https://www.facebook.com/ragingkamote12" target="_blank" rel="noopener noreferrer" aria-label="Facebook"><FacebookIcon /></a>
            <a className="pf-social-link" href="https://www.tiktok.com/@leojcb09?is_from_webapp=1&sender_device=pc" target="_blank" rel="noopener noreferrer" aria-label="TikTok"><TikTokIcon /></a>
            <a className="pf-social-link" href="https://www.instagram.com/leonjcb09/" target="_blank" rel="noopener noreferrer" aria-label="Instagram"><InstagramIcon /></a>
          </div>
        </footer>

        {/* ── Lightbox ── */}
        {lightbox !== null && lbPhoto && (
          <div className="pf-lb" onClick={(e) => e.currentTarget === e.target && setLightbox(null)}>
            <button className="pf-lb-close" onClick={() => setLightbox(null)}>✕ close</button>
            <button className="pf-lb-prev" onClick={() => navLb(-1)} disabled={lightbox === 0}>‹</button>
            <button className="pf-lb-next" onClick={() => navLb(1)} disabled={lightbox === visiblePhotos.length - 1}>›</button>
            <div className="pf-lb-wrap">
              {!lbReady && <div className="pf-lb-spin" />}
              <img key={lbPhoto.id} src={lbPhoto.url} alt={lbPhoto.caption || ""} className={lbReady ? "lb-ready" : ""} onLoad={() => setLbReady(true)} />
            </div>
            <div className="pf-lb-footer">
              <span className="pf-lb-cap">{lbPhoto.caption || ""}</span>
              <span className="pf-lb-idx">{lightbox + 1} / {visiblePhotos.length}</span>
            </div>
          </div>
        )}

        {/* ── Secret Settings Modal ── */}
        {settings && (
          <div className="pf-settings-overlay" onClick={(e) => e.currentTarget === e.target && setSettings(false)}>
            <div className="pf-settings-panel">
              <div className="pf-settings-header">
                <div className="pf-settings-title-wrap">
                  <span className="pf-settings-icon"><GearIcon /></span>
                  <span className="pf-settings-title">SETTINGS</span>
                  <span className="pf-settings-badge">Admin</span>
                </div>
                <button className="pf-settings-close" onClick={() => setSettings(false)}>✕</button>
              </div>
              <div className="pf-settings-body">
                <div className="pf-settings-section">
                  <div>
                    <p className="pf-settings-section-label">Gallery Cache</p>
                    <p className="pf-settings-section-desc">Locally cached photo metadata<br />used for instant loading on refresh.</p>
                  </div>
                  <div className="pf-settings-action">
                    <span className="pf-stat"><strong>{getCached().length}</strong> photo{getCached().length !== 1 ? "s" : ""} cached</span>
                  </div>
                </div>
                <div className="pf-settings-section">
                  <div>
                    <p className="pf-settings-section-label">Reset Gallery</p>
                    <p className="pf-settings-section-desc">Clears all cached photos and<br />re-fetches everything from Telegram.</p>
                  </div>
                  <div className="pf-settings-action">
                    {resetDone ? (
                      <span className="pf-btn-success">✓ Done</span>
                    ) : (
                      <button className="pf-btn-danger" onClick={handleResetGallery} disabled={isWorking}>Reset Gallery</button>
                    )}
                  </div>
                </div>
                <div className="pf-settings-divider" />
                <p className="pf-settings-hint">
                  Press <strong style={{color:"var(--grey-dim)"}}>LJCBSET</strong> anywhere on the page<br />to open or close this panel
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Toast ── */}
        {toast && <div className="pf-toast">{toast}</div>}

      </div>
    </>
  );
}
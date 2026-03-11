import { useState, useEffect, useCallback, useRef } from "react";

const BOT_TOKEN  = "8662339296:AAEMzUBkgN9nuDLmDgxE93l5IarlGiB0Ikc";
const CHANNEL_ID = "-1003831838516";
const API        = `https://api.telegram.org/bot${BOT_TOKEN}`;
const CACHE_KEY   = "tg_leos_pov_v3";
const DELETED_KEY = "tg_leos_pov_deleted_v1"; // persisted set of removed message IDs
const SECRET     = "LJCBSET";
const POLL_MS    = 20000;

// ─── In-memory URL cache (survives re-renders, not page reload – Telegram URLs expire) ───
const urlCache = new Map();
async function resolveUrl(file_id) {
  if (urlCache.has(file_id)) return urlCache.get(file_id);
  try {
    const r = await fetch(`${API}/getFile?file_id=${encodeURIComponent(file_id)}`);
    const d = await r.json();
    if (d.ok) {
      const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${d.result.file_path}`;
      urlCache.set(file_id, url);
      return url;
    }
  } catch {}
  return null;
}

// ─── Resolve thumb + full in parallel, update photo entry live ───
async function resolvePhoto(photo, onUpdate) {
  const [thumbUrl, fullUrl] = await Promise.all([
    resolveUrl(photo.thumb_file_id),
    resolveUrl(photo.file_id),
  ]);
  const updated = { ...photo, thumbUrl: thumbUrl || null, url: fullUrl || "error" };
  onUpdate(updated);
  return updated;
}

// ─── localStorage ───
function getCached() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "[]"); } catch { return []; }
}
function saveCached(photos) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(
      photos.map(({ id, file_id, thumb_file_id, caption, date, w, h }) =>
        ({ id, file_id, thumb_file_id, caption, date, w, h }))
    ));
  } catch {}
}


// ─── Deleted IDs store ───────────────────────────────────────────────────────
function getDeleted() {
  try { return new Set(JSON.parse(localStorage.getItem(DELETED_KEY) || "[]")); } catch { return new Set(); }
}
function saveDeleted(set) {
  try { localStorage.setItem(DELETED_KEY, JSON.stringify([...set])); } catch {}
}
function addDeleted(id) {
  const s = getDeleted(); s.add(id); saveDeleted(s);
}

// ─── Fetch Telegram updates ─────────────────────────────────────────────────
// We intentionally NEVER pass an offset so Telegram never deletes pending
// updates. The localStorage cache is the permanent source of truth; getUpdates
// is only used to discover photos not yet in the cache.
async function fetchUpdates() {
  const p = `limit=100&allowed_updates=${encodeURIComponent('["channel_post","edited_channel_post"]')}`;
  const r = await fetch(`${API}/getUpdates?${p}`);
  if (!r.ok) throw new Error(`Network error ${r.status}`);
  const d = await r.json();
  if (!d.ok) throw new Error(d.description || "Telegram API error");
  return d.result;
}

function parsePhotosFromUpdates(updates, skipIds = new Set()) {
  const photos = [];
  const deletedIds = new Set(); // IDs permanently deleted via #deleted caption

  for (const u of updates) {
    // Detect #deleted caption edits on existing posts
    const edited = u.edited_channel_post;
    if (edited && CHANNEL_ID && String(edited.chat.id) === String(CHANNEL_ID)) {
      if ((edited.caption || "").toLowerCase().includes("#deleted")) {
        telegramDeletedIds.add(edited.message_id);
      }
    }

    const post = u.channel_post;
    if (!post?.photo) continue;
    if (CHANNEL_ID && String(post.chat.id) !== String(CHANNEL_ID)) continue;
    if (skipIds.has(post.message_id)) continue;
    // Skip if caption already has #deleted
    if ((post.caption || "").toLowerCase().includes("#deleted")) continue;

    const sizes   = post.photo;
    const largest = sizes[sizes.length - 1];
    const thumb   = sizes.find(s => s.width >= 80) || sizes[0];
    photos.push({
      id:            post.message_id,
      file_id:       largest.file_id,
      thumb_file_id: thumb.file_id,
      caption:       post.caption || "",
      date:          new Date(post.date * 1000),
      w:             largest.width,
      h:             largest.height,
      thumbUrl:      null,
      url:           null,
    });
  }
  return { photos, deletedIds };
}

// ─── Icons ───
const FacebookIcon  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>;
const TikTokIcon    = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34l-.02-8.38a8.17 8.17 0 0 0 4.79 1.52V5.01a4.85 4.85 0 0 1-1-.32z"/></svg>;
const InstagramIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>;

const GearIcon      = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;

// ─── PhotoCell: viewport-aware, thumb→full two-phase loader ───
function PhotoCell({ photo, index, onClick, deletionMode, onDelete }) {
  const wrapRef      = useRef(null);
  const [visible, setVisible]     = useState(index < 6); // first 6 eager
  const [thumbLoaded, setThumbLoaded] = useState(false);
  const [fullLoaded, setFullLoaded]   = useState(false);
  const aspectRatio  = photo.w && photo.h ? photo.w / photo.h : 1;

  // IntersectionObserver – start loading when 200px away from viewport
  useEffect(() => {
    if (visible) return;
    const el = wrapRef.current;
    if (!el || !window.IntersectionObserver) { setVisible(true); return; }
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); io.disconnect(); } },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  const hasThumb = photo.thumbUrl && photo.thumbUrl !== "error";
  const hasFull  = photo.url     && photo.url     !== "error";

  return (
    <div
      ref={wrapRef}
      className={`pf-cell${deletionMode ? " deletion-active" : ""}`}
      onClick={() => hasFull && onClick()}
      style={{ cursor: hasFull ? "pointer" : "default", aspectRatio }}
    >
      {/* Shimmer — shown until thumb appears */}
      {!thumbLoaded && !fullLoaded && <div className="pf-skel" />}

      {/* Thumbnail layer — blurred placeholder, loads first */}
      {visible && hasThumb && (
        <img
          className={`pf-img pf-thumb${thumbLoaded ? " loaded" : ""}`}
          src={photo.thumbUrl}
          alt=""
          aria-hidden="true"
          decoding="async"
          onLoad={() => setThumbLoaded(true)}
        />
      )}

      {/* Full-res layer — fades in sharp over the thumb */}
      {visible && hasFull && (
        <img
          className={`pf-img pf-full${fullLoaded ? " loaded" : ""}`}
          src={photo.url}
          alt={photo.caption || `Photo ${index + 1}`}
          decoding="async"
          onLoad={() => setFullLoaded(true)}
        />
      )}

      {/* Caption overlay */}
      {hasFull && photo.caption && (
        <div className="pf-overlay">
          <p className="pf-cap">{photo.caption}</p>
        </div>
      )}

      {/* Admin delete button */}
      {deletionMode && hasFull && (
        <button
          className="pf-cell-delete"
          onClick={e => { e.stopPropagation(); onDelete(photo.id); }}
          title="Remove from gallery"
        >
          ×
        </button>
      )}
    </div>
  );
}

// ─── LightboxViewer: swipe-horizontal (next/prev), swipe-down (close), backdrop click ───
function LightboxViewer({ photos, index, onClose, onNav, lbReady, setLbReady }) {
  const photo      = photos[index];
  const slideRef   = useRef(null);
  const lbRef      = useRef(null);
  const touchStart = useRef({ x: 0, y: 0 });
  const touchDelta = useRef({ x: 0, y: 0 });
  const gesture    = useRef(null); // null | "horizontal" | "vertical"
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => { setLbReady(false); }, [index, setLbReady]);

  // ── Touch ─────────────────────────────────────────────────────────────────
  const onTouchStart = (e) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    touchDelta.current = { x: 0, y: 0 };
    gesture.current    = null;
  };

  const onTouchMove = (e) => {
    if (!slideRef.current) return;
    const dx = e.touches[0].clientX - touchStart.current.x;
    const dy = e.touches[0].clientY - touchStart.current.y;
    touchDelta.current = { x: dx, y: dy };

    // Lock gesture direction on first significant move
    if (!gesture.current && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
      gesture.current = Math.abs(dy) > Math.abs(dx) ? "vertical" : "horizontal";
    }

    if (gesture.current === "horizontal") {
      const clamped = Math.max(-130, Math.min(130, dx));
      slideRef.current.style.transition = "none";
      slideRef.current.style.transform  = `translateX(${clamped}px)`;
    }

    if (gesture.current === "vertical" && dy > 0) {
      // drag the whole lightbox down
      const clamp = Math.min(dy, 280);
      const scale = 1 - clamp / 1800;
      const alpha = 1 - clamp / 320;
      if (lbRef.current) {
        lbRef.current.style.transition  = "none";
        lbRef.current.style.transform   = `translateY(${clamp}px)`;
        lbRef.current.style.opacity     = Math.max(0, alpha);
      }
      slideRef.current.style.transition = "none";
      slideRef.current.style.transform  = `scale(${scale})`;
    }
  };

  const onTouchEnd = () => {
    if (!slideRef.current) return;
    const { x: dx, y: dy } = touchDelta.current;

    if (gesture.current === "horizontal") {
      slideRef.current.style.transition = "";
      slideRef.current.style.transform  = "";
      if (dx < -60 && index < photos.length - 1) onNav(1);
      else if (dx > 60 && index > 0)             onNav(-1);
    }

    if (gesture.current === "vertical") {
      if (dy > 110) {
        // dismiss — fly out downward
        setDismissing(true);
        if (lbRef.current) {
          lbRef.current.style.transition = "transform .28s ease, opacity .28s ease";
          lbRef.current.style.transform  = "translateY(100%)";
          lbRef.current.style.opacity    = "0";
        }
        setTimeout(onClose, 260);
      } else {
        // snap back
        if (lbRef.current) {
          lbRef.current.style.transition = "transform .25s ease, opacity .25s ease";
          lbRef.current.style.transform  = "";
          lbRef.current.style.opacity    = "";
        }
        slideRef.current.style.transition = "";
        slideRef.current.style.transform  = "";
      }
    }

    gesture.current = null;
  };

  // ── Desktop: click dark backdrop to close ─────────────────────────────────
  const onBackdrop = (e) => {
    // Close if the click landed directly on the backdrop, not on any child
    if (e.target === lbRef.current) onClose();
  };

  // Dots
  const total = photos.length;
  const maxDots = 7, half = Math.floor(maxDots / 2);
  let start = Math.max(0, index - half);
  const end = Math.min(total, start + maxDots);
  start = Math.max(0, end - maxDots);

  return (
    <div ref={lbRef} className="pf-lb" onClick={onBackdrop}>
      <button className="pf-lb-close" onClick={onClose}>✕ close</button>

      <button className="pf-lb-prev" onClick={() => onNav(-1)} disabled={index === 0}>‹</button>
      <button className="pf-lb-next" onClick={() => onNav(1)}  disabled={index === photos.length - 1}>›</button>

      <div
        className="pf-lb-wrap"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <div ref={slideRef} className="pf-lb-img-slide">
          {!lbReady && <div className="pf-lb-spin" />}
          <img
            key={photo.id}
            src={photo.url}
            alt={photo.caption || ""}
            className={lbReady ? "lb-ready" : ""}
            onLoad={() => setLbReady(true)}
          />
        </div>
      </div>

      <div className="pf-lb-dots">
        {Array.from({ length: end - start }, (_, i) => (
          <div key={start + i} className={`pf-lb-dot${start + i === index ? " active" : ""}`} />
        ))}
      </div>

      <div className="pf-lb-footer">
        <span className="pf-lb-cap">{photo.caption || ""}</span>
        <span className="pf-lb-idx">{index + 1} / {total}</span>
      </div>
    </div>
  );
}

// ─── Main Component ───
export default function LeosPOV() {
  const [photos, setPhotos]       = useState([]);
  const [status, setStatus]       = useState("idle");
  const [errMsg, setErrMsg]       = useState("");
  const [lightbox, setLightbox]   = useState(null);
  const [lbReady, setLbReady]     = useState(false);
  const [settings, setSettings]   = useState(false);
  const [resetDone, setResetDone]   = useState(false);
  const [deleteAllDone, setDeleteAllDone] = useState(false);
  const [toast, setToast]         = useState("");
  const [newPrompt, setNewPrompt]   = useState(null);
  const [deletionMode, setDeletionMode]   = useState(false);
  const keyBuffer   = useRef("");
  const keyTimer    = useRef(null);
  const pollTimer   = useRef(null);
  const loadingRef  = useRef(false);
  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2800);
  }, []);

  // Update a single photo in state by id
  const patchPhoto = useCallback((updated) => {
    setPhotos(prev => prev.map(p => p.id === updated.id ? updated : p));
  }, []);

  // Remove a photo from cache + deleted set + state
  const deletePhoto = useCallback((id) => {
    addDeleted(id);
    urlCache.delete && urlCache.forEach((v, k) => {}); // keep urlCache intact (file_ids reusable)
    const updated = getCached().filter(p => p.id !== id);
    saveCached(updated);
    setPhotos(prev => prev.filter(p => p.id !== id));
    showToast("Photo removed from gallery.");
  }, [showToast]);

  // ── Main load ────────────────────────────────────────────────────────────
  const load = useCallback(async (force = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setStatus("loading");
    setErrMsg("");

    try {
      // 1. Restore from cache instantly → stable skeleton grid with correct aspect ratios
      const cached    = force ? [] : getCached();
      const cachedIds = new Set(cached.map(p => p.id));

      if (cached.length > 0) {
        setPhotos(cached.map(p => ({ ...p, thumbUrl: null, url: null })));
        setStatus("resolving");
      }

      // 2. Pull all available Telegram updates (no offset = nothing ever deleted from server)
      const updates   = await fetchUpdates();
      const { photos: newPhotos, deletedIds } = parsePhotosFromUpdates(updates, force ? new Set() : cachedIds);

      // Apply #deleted caption changes + admin deletions
      const deleted = getDeleted();
      deletedIds.forEach(id => { deleted.add(id); addDeleted(id); });

      // 3. Merge + sort, filtering out hidden/deleted IDs
      const seen = new Set();
      const merged = [...newPhotos, ...cached.map(p => ({ ...p, thumbUrl: null, url: null }))]
        .filter(p => {
          if (seen.has(p.id)) return false;
          seen.add(p.id);
          return !deleted.has(p.id);
        })
        .sort((a, b) => new Date(b.date) - new Date(a.date));

      saveCached(merged);
      setPhotos(merged);
      if (!merged.length) { setStatus("done"); return; }
      setStatus("resolving");

      // 4. Resolve each photo independently in parallel → patch as each completes
      //    Above-fold (first 8) fire immediately; rest get a tiny stagger to avoid throttling
      await Promise.all(
        merged.map((photo, i) =>
          new Promise(resolve => {
            const delay = i < 8 ? 0 : Math.floor(i / 6) * 150;
            setTimeout(() => resolvePhoto(photo, patchPhoto).then(resolve), delay);
          })
        )
      );

      setStatus("done");
    } catch (e) {
      setErrMsg(e.message);
      setStatus("error");
    } finally {
      loadingRef.current = false;
    }
  }, [patchPhoto]);

  // ── Silent poll ──────────────────────────────────────────────────────────
  const silentPoll = useCallback(async () => {
    if (loadingRef.current) return;
    try {
      const updates   = await fetchUpdates();
      const cached    = getCached();
      const { photos: newPhotos, deletedIds } = parsePhotosFromUpdates(updates, new Set(cached.map(p => p.id)));

      // Apply #deleted caption changes
      const deleted = getDeleted();
      let deletedCount = 0;
      deletedIds.forEach(id => { if (!deleted.has(id)) { deleted.add(id); addDeleted(id); deletedCount++; } });

      if (!newPhotos.length && deletedCount === 0) return;

      const fullCached = getCached();
      const seenPoll = new Set();
      const merged = [...newPhotos, ...fullCached.map(p => ({ ...p, thumbUrl: null, url: null }))]
        .filter(p => {
          if (seenPoll.has(p.id)) return false;
          seenPoll.add(p.id);
          return !deleted.has(p.id);
        })
        .sort((a, b) => new Date(b.date) - new Date(a.date));

      saveCached(merged);
      setPhotos(merged);

      if (deletedCount > 0) showToast(`${deletedCount} photo${deletedCount > 1 ? "s" : ""} permanently deleted`);
      if (newPhotos.length > 0) setNewPrompt({ count: newPhotos.length });

      // Resolve new photos immediately
      await Promise.all(newPhotos.map(photo => resolvePhoto(photo, patchPhoto)));
      setStatus("done");
    } catch {}
  }, [patchPhoto, showToast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    pollTimer.current = setInterval(silentPoll, POLL_MS);
    return () => clearInterval(pollTimer.current);
  }, [silentPoll]);

  // Auto-dismiss new-photo prompt after 8s
  useEffect(() => {
    if (!newPrompt) return;
    const t = setTimeout(() => setNewPrompt(null), 8000);
    return () => clearTimeout(t);
  }, [newPrompt]);

  // ── Secret code ──────────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e) => {
      if (["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName)) return;
      keyBuffer.current = (keyBuffer.current + e.key.toUpperCase()).slice(-SECRET.length);
      clearTimeout(keyTimer.current);
      keyTimer.current = setTimeout(() => { keyBuffer.current = ""; }, 1800);
      if (keyBuffer.current === SECRET) { keyBuffer.current = ""; setSettings(s => !s); setResetDone(false); }
    };
    window.addEventListener("keydown", h);
    return () => { window.removeEventListener("keydown", h); clearTimeout(keyTimer.current); };
  }, []);

  // ── Lightbox keyboard nav ────────────────────────────────────────────────
  const visiblePhotos = photos.filter(p => p.url && p.url !== "error");
  useEffect(() => {
    const h = (e) => {
      if (settings || lightbox === null) return;
      if (e.key === "Escape")      setLightbox(null);
      if (e.key === "ArrowRight")  { setLbReady(false); setLightbox(i => Math.min(i + 1, visiblePhotos.length - 1)); }
      if (e.key === "ArrowLeft")   { setLbReady(false); setLightbox(i => Math.max(i - 1, 0)); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [lightbox, visiblePhotos.length, settings]);

  const handleReset = () => {
    try {
      // Permanently wipe ALL stored data — cache, deleted list, url memory
      localStorage.removeItem(CACHE_KEY);
      localStorage.removeItem(DELETED_KEY);
      urlCache.clear();
    } catch {}
    loadingRef.current = false;
    setPhotos([]);
    setStatus("idle");
    setResetDone(true);
    showToast("All images wiped. Re-fetching…");
    setTimeout(() => { setSettings(false); setResetDone(false); load(true); }, 800);
  };

  const handleDeleteAll = () => {
    try {
      localStorage.removeItem(CACHE_KEY);
      localStorage.removeItem(DELETED_KEY);
      urlCache.clear();
    } catch {}
    loadingRef.current = false;
    setPhotos([]);
    setStatus("done");
    setDeleteAllDone(true);
    showToast("All images permanently deleted.");
    setTimeout(() => { setSettings(false); setDeleteAllDone(false); }, 1200);
  };

  const lbPhoto   = lightbox !== null ? visiblePhotos[lightbox] : null;
  const isWorking = status === "loading" || status === "resolving";
  const openLb    = (i) => { setLbReady(false); setLightbox(i); };
  const navLb     = (d) => { setLbReady(false); setLightbox(i => Math.max(0, Math.min(visiblePhotos.length - 1, i + d))); };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@300;400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { width: 100%; min-height: 100%; background: #090d14; -webkit-text-size-adjust: 100%; }
        #root, [data-reactroot] { width: 100%; min-height: 100vh; }

        :root {
          --bg:      #090d14;
          --surface: #0f1520;
          --surf2:   #141c2a;
          --border:  #1e2a3a;
          --bord2:   #243040;
          --white:   #f0f2f5;
          --grey:    #8a9ab0;
          --dim:     #4a5568;
          --sans:    'Outfit', sans-serif;
          --disp:    'Bebas Neue', sans-serif;
        }

        .pf { width: 100%; min-height: 100vh; background: var(--bg); color: var(--white); font-family: var(--sans); display: flex; flex-direction: column; }

        /* NAV */
        .pf-nav { width: 100%; position: sticky; top: 0; z-index: 100; background: rgba(9,13,20,0.92); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border-bottom: 1px solid var(--border); padding: 0 48px; height: 60px; display: flex; align-items: center; justify-content: flex-end; gap: 16px; }
        @media (max-width: 560px) { .pf-nav { padding: 0 18px; height: 52px; } }

        .pf-socials { display: flex; align-items: center; gap: 2px; }
        .pf-social-link { display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; color: var(--dim); text-decoration: none; border-radius: 6px; transition: color .18s, background .18s; -webkit-tap-highlight-color: transparent; }
        .pf-social-link:hover { color: var(--white); background: var(--surface); }

        .pf-btn { background: none; border: 1px solid var(--border); color: var(--grey); padding: 6px 14px; font-family: var(--sans); font-size: .7rem; font-weight: 400; letter-spacing: .08em; cursor: pointer; border-radius: 4px; transition: border-color .18s, color .18s, background .18s; white-space: nowrap; -webkit-tap-highlight-color: transparent; }
        .pf-btn:hover:not(:disabled) { border-color: var(--grey); color: var(--white); background: var(--surface); }
        .pf-btn:disabled { opacity: .3; cursor: default; }

        .pf-live { display: flex; align-items: center; gap: 6px; font-size: .65rem; letter-spacing: .1em; color: var(--dim); }
        .pf-live-dot { width: 6px; height: 6px; border-radius: 50%; background: #3a7d44; flex-shrink: 0; animation: live 2.5s ease-in-out infinite; }
        @keyframes live { 0%{box-shadow:0 0 0 0 rgba(58,125,68,.55)} 60%{box-shadow:0 0 0 5px rgba(58,125,68,0)} 100%{box-shadow:0 0 0 0 rgba(58,125,68,0)} }

        /* HERO */
        .pf-hero { width: 100%; padding: 52px 48px 40px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 8px; border-bottom: 1px solid var(--border); }
        @media (max-width: 560px) { .pf-hero { padding: 36px 18px 28px; } }
        .pf-eyebrow { font-size: .64rem; font-weight: 500; letter-spacing: .28em; text-transform: uppercase; color: var(--dim); }
        .pf-title   { font-family: var(--disp); font-size: clamp(3.8rem, 9vw, 7.5rem); letter-spacing: .04em; line-height: .9; color: var(--white); }
        .pf-photo-count { font-size: .72rem; color: var(--dim); font-weight: 300; margin-top: 6px; }

        /* GRID */
        .pf-grid { width: 100%; padding: 20px 48px 72px; columns: 3; column-gap: 8px; }
        @media (max-width: 860px) { .pf-grid { columns: 2; } }
        @media (max-width: 560px) { .pf-grid { columns: 2; padding: 12px 10px 60px; column-gap: 6px; } }

        /* CELL */
        .pf-cell { break-inside: avoid; margin-bottom: 8px; position: relative; overflow: hidden; background: var(--surface); display: block; }
        @media (max-width: 560px) { .pf-cell { margin-bottom: 6px; } }

        /* Image layers */
        .pf-img {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          opacity: 0;
        }
        /* Thumbnail: blurred placeholder, shown until full loads */
        .pf-thumb        { filter: blur(12px); transform: scale(1.06); transition: opacity .25s ease; z-index: 1; }
        .pf-thumb.loaded { opacity: 1; }

        /* Full res: fades in sharp on top */
        .pf-full        { filter: none; transform: none; transition: opacity .35s ease; z-index: 2; }
        .pf-full.loaded { opacity: 1; }

        /* Hover zoom only on the full layer */
        .pf-cell:hover .pf-full { transform: scale(1.04); transition: opacity .35s ease, transform .5s cubic-bezier(.25,.46,.45,.94); }

        /* Caption overlay */
        .pf-overlay { position: absolute; inset: 0; z-index: 3; background: linear-gradient(to top, rgba(9,13,20,.72) 0%, transparent 52%); opacity: 0; transition: opacity .22s; display: flex; align-items: flex-end; padding: 12px 13px; pointer-events: none; }
        .pf-cell:hover .pf-overlay { opacity: 1; }
        .pf-cap { font-size: .78rem; font-weight: 300; color: rgba(240,242,245,.9); line-height: 1.4; transform: translateY(4px); opacity: 0; transition: opacity .22s, transform .22s; }
        .pf-cell:hover .pf-cap { opacity: 1; transform: translateY(0); }

        /* Shimmer skeleton */
        .pf-skel { position: absolute; inset: 0; background: linear-gradient(90deg, var(--surface) 25%, #162030 50%, var(--surface) 75%); background-size: 200% 100%; animation: shimmer 1.6s infinite; }
        @keyframes shimmer { to { background-position: -200% 0; } }

        /* States */
        .pf-state { width: 100%; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; text-align: center; padding: 80px 48px; min-height: 40vh; }
        .pf-state-h   { font-family: var(--disp); font-size: 1.6rem; letter-spacing: .08em; color: var(--dim); }
        .pf-state-bar { width: 28px; height: 1px; background: var(--border); }
        .pf-state-p   { font-size: .76rem; font-weight: 300; color: var(--dim); line-height: 1.9; }

        /* Dots */
        .pf-dots { position: fixed; bottom: 22px; right: 24px; display: flex; gap: 4px; opacity: .5; z-index: 50; }
        .pf-dot  { width: 3px; height: 3px; border-radius: 50%; background: var(--grey); animation: pulse 1.1s ease-in-out infinite; }
        .pf-dot:nth-child(2) { animation-delay: .18s; }
        .pf-dot:nth-child(3) { animation-delay: .36s; }
        @keyframes pulse { 0%,100%{opacity:.2;transform:scale(.7)} 50%{opacity:1;transform:scale(1)} }

        /* LIGHTBOX */
        .pf-lb { position: fixed; inset: 0; z-index: 800; background: rgba(6,9,14,.97); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 56px 0 48px; animation: fadein .18s; }
        @keyframes fadein { from { opacity: 0; } }

        /* swipeable image area */
        .pf-lb-wrap {
          flex: 1; display: flex; align-items: center; justify-content: center;
          width: 100%; position: relative; min-height: 0;
          overflow: hidden;
          touch-action: pan-y;
        }
        .pf-lb-img-slide {
          display: flex; align-items: center; justify-content: center;
          width: 100%; height: 100%;
          transition: transform .28s cubic-bezier(.25,.46,.45,.94);
          will-change: transform;
        }
        .pf-lb img {
          max-width: calc(100% - 140px);
          max-height: calc(100dvh - 130px);
          object-fit: contain; display: block;
          opacity: 0; transition: opacity .25s;
          pointer-events: none;
          user-select: none;
          -webkit-user-drag: none;
        }
        @media (max-width: 560px) {
          .pf-lb img { max-width: calc(100% - 24px); }
        }
        .pf-lb img.lb-ready { opacity: 1; }
        .pf-lb-spin { position: absolute; width: 20px; height: 20px; border: 1.5px solid var(--border); border-top-color: var(--grey); border-radius: 50%; animation: spin .7s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* close */
        .pf-lb-close { position: fixed; top: 16px; right: 22px; background: none; border: none; font-family: var(--sans); font-size: .68rem; letter-spacing: .12em; color: var(--dim); cursor: pointer; padding: 8px; transition: color .15s; -webkit-tap-highlight-color: transparent; }
        .pf-lb-close:hover { color: var(--white); }

        /* desktop arrow buttons */
        .pf-lb-prev, .pf-lb-next {
          position: fixed; top: 50%; transform: translateY(-50%);
          width: 52px; height: 52px;
          background: rgba(255,255,255,.07);
          border: 1px solid rgba(255,255,255,.1);
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-family: var(--disp); font-size: 1.6rem; color: var(--grey);
          cursor: pointer; line-height: 1;
          transition: background .18s, border-color .18s, color .18s, opacity .18s;
          -webkit-tap-highlight-color: transparent; touch-action: manipulation;
        }
        .pf-lb-prev { left: 18px; }
        .pf-lb-next { right: 18px; }
        .pf-lb-prev:hover:not(:disabled), .pf-lb-next:hover:not(:disabled) {
          background: rgba(255,255,255,.14); border-color: rgba(255,255,255,.22); color: var(--white);
        }
        .pf-lb-prev:disabled, .pf-lb-next:disabled { opacity: .15; cursor: default; }

        /* hide arrow buttons on touch devices */
        @media (hover: none) {
          .pf-lb-prev, .pf-lb-next { display: none; }
        }

        /* swipe hint dots on mobile */
        .pf-lb-dots {
          display: none;
          gap: 5px;
          justify-content: center;
          padding: 6px 0 0;
        }
        @media (hover: none) { .pf-lb-dots { display: flex; } }
        .pf-lb-dot {
          width: 5px; height: 5px; border-radius: 50%;
          background: var(--dim); transition: background .2s, transform .2s;
          flex-shrink: 0;
        }
        .pf-lb-dot.active { background: var(--white); transform: scale(1.3); }

        /* footer */
        .pf-lb-footer { width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 12px 48px 0; border-top: 1px solid var(--border); margin-top: 12px; flex-shrink: 0; }
        @media (max-width: 560px) { .pf-lb-footer { padding: 10px 16px 0; } }
        .pf-lb-cap { font-size: .82rem; font-weight: 300; color: var(--grey); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 68%; }
        .pf-lb-idx { font-size: .67rem; font-weight: 500; letter-spacing: .12em; color: var(--dim); flex-shrink: 0; }

        /* FOOTER */
        .pf-footer { width: 100%; margin-top: auto; border-top: 1px solid var(--border); padding: 22px 48px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
        @media (max-width: 560px) { .pf-footer { padding: 18px; flex-direction: column; gap: 12px; text-align: center; } }
        .pf-footer-name { font-family: var(--disp); font-size: 1rem; letter-spacing: .1em; color: var(--dim); }
        .pf-footer-copy { font-size: .68rem; font-weight: 300; color: var(--dim); }
        .pf-footer-socials { display: flex; gap: 2px; }

        /* SETTINGS */
        .pf-sett-overlay { position: fixed; inset: 0; z-index: 900; background: rgba(4,7,12,.88); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; padding: 24px; animation: fadein .2s; }
        .pf-sett-panel   { background: var(--surface); border: 1px solid var(--bord2); width: 100%; max-width: 420px; overflow: hidden; animation: panelin .22s cubic-bezier(.16,1,.3,1); }
        @keyframes panelin { from { opacity:0; transform:translateY(10px) scale(.98); } }
        .pf-sett-hdr  { padding: 20px 24px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
        .pf-sett-tw   { display: flex; align-items: center; gap: 10px; }
        .pf-sett-ico  { color: var(--dim); display: flex; align-items: center; }
        .pf-sett-ttl  { font-family: var(--disp); font-size: 1.05rem; letter-spacing: .14em; color: var(--white); }
        .pf-sett-bdg  { font-size: .58rem; font-weight: 500; letter-spacing: .18em; text-transform: uppercase; color: var(--dim); background: var(--surf2); border: 1px solid var(--border); padding: 2px 7px; border-radius: 2px; }
        .pf-sett-x    { background: none; border: none; color: var(--dim); cursor: pointer; padding: 4px; font-size: 1rem; line-height: 1; transition: color .15s; -webkit-tap-highlight-color: transparent; }
        .pf-sett-x:hover { color: var(--white); }
        .pf-sett-body { padding: 20px 24px 24px; display: flex; flex-direction: column; gap: 14px; }
        .pf-sett-row  { background: var(--surf2); border: 1px solid var(--border); padding: 16px 18px; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
        .pf-sett-lbl  { font-size: .8rem; font-weight: 500; color: var(--white); margin-bottom: 4px; }
        .pf-sett-desc { font-size: .7rem; font-weight: 300; color: var(--dim); line-height: 1.6; }
        .pf-sett-act  { flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
        .pf-stat      { font-size: .68rem; color: var(--dim); } .pf-stat strong { color: var(--grey); font-weight: 500; }
        .pf-btn-danger  { background: rgba(192,57,43,.12); border: 1px solid rgba(192,57,43,.3); color: #e05a4e; padding: 7px 16px; font-family: var(--sans); font-size: .72rem; font-weight: 500; letter-spacing: .06em; cursor: pointer; transition: background .18s,border-color .18s,color .18s; border-radius: 4px; -webkit-tap-highlight-color: transparent; }
        .pf-btn-danger:hover:not(:disabled) { background: rgba(192,57,43,.22); border-color: rgba(192,57,43,.55); color: #f07060; }
        .pf-btn-danger:disabled { opacity: .4; cursor: default; }
        .pf-btn-ok { background: rgba(39,174,96,.12); border: 1px solid rgba(39,174,96,.3); color: #4ec882; padding: 7px 16px; font-family: var(--sans); font-size: .72rem; font-weight: 500; letter-spacing: .06em; border-radius: 4px; cursor: default; }
        .pf-sett-div  { height: 1px; background: var(--border); }
        .pf-sett-hint { font-size: .64rem; font-weight: 300; color: var(--dim); text-align: center; letter-spacing: .06em; line-height: 1.7; opacity: .6; }

        /* ADMIN DELETE BUTTON ON CELL */
        .pf-cell-delete {
          position: absolute;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%) scale(0.88);
          z-index: 10;
          width: 56px; height: 56px;
          border-radius: 50%;
          background: rgba(8,11,18,0.72);
          border: 2px solid rgba(255,255,255,0.28);
          color: #fff;
          font-size: 1.75rem;
          line-height: 1;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          opacity: 0;
          transition: opacity .2s, background .15s, transform .2s, border-color .15s;
          -webkit-tap-highlight-color: transparent;
          backdrop-filter: blur(10px);
          padding: 0;
        }
        .pf-cell:hover .pf-cell-delete,
        .pf-cell-delete:focus { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        .pf-cell-delete:hover { background: rgba(192,57,43,0.88); border-color: rgba(192,57,43,0.6); }
        .pf-cell-delete:active { transform: translate(-50%, -50%) scale(0.93); }
        /* Dim overlay on the cell when in deletion mode */
        .pf-cell.deletion-active::after {
          content: "";
          position: absolute; inset: 0;
          background: rgba(8,11,18,0.38);
          border-radius: inherit;
          pointer-events: none;
          z-index: 5;
        }

        /* Always visible on touch */
        @media (hover: none) { .pf-cell-delete { opacity: 1; transform: translate(-50%, -50%) scale(1); } }

        /* ADMIN MODE BAR */
        .pf-del-bar {
          width: 100%;
          background: rgba(192,57,43,0.12);
          border-bottom: 1px solid rgba(192,57,43,0.28);
          padding: 7px 48px;
          display: flex; align-items: center; gap: 10px;
          font-size: .7rem; font-weight: 500;
          letter-spacing: .1em; text-transform: uppercase;
          color: #e05a4e;
        }
        @media (max-width: 560px) { .pf-del-bar { padding: 7px 18px; } }
        .pf-del-bar-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: #e05a4e; flex-shrink: 0;
          animation: live 2.5s ease-in-out infinite;
        }
        .pf-del-exit {
          margin-left: auto;
          background: none; border: 1px solid rgba(192,57,43,0.4);
          color: #e05a4e; font-family: var(--sans);
          font-size: .65rem; letter-spacing: .1em;
          padding: 3px 10px; cursor: pointer;
          border-radius: 3px;
          transition: background .15s;
          -webkit-tap-highlight-color: transparent;
        }
        .pf-del-exit:hover { background: rgba(192,57,43,0.15); }

        /* NEW PHOTO PROMPT */
        .pf-new-prompt {
          position: fixed;
          top: 72px;
          left: 50%;
          transform: translateX(-50%) translateY(-4px);
          z-index: 500;
          display: flex;
          align-items: center;
          gap: 10px;
          background: var(--white);
          color: #090d14;
          padding: 10px 18px 10px 14px;
          border-radius: 999px;
          font-family: var(--sans);
          font-size: .78rem;
          font-weight: 500;
          letter-spacing: .02em;
          box-shadow: 0 4px 24px rgba(0,0,0,.45), 0 1px 4px rgba(0,0,0,.3);
          cursor: pointer;
          white-space: nowrap;
          animation: prompt-in .35s cubic-bezier(.16,1,.3,1);
          transition: transform .18s, box-shadow .18s;
          -webkit-tap-highlight-color: transparent;
          user-select: none;
        }
        .pf-new-prompt:hover {
          transform: translateX(-50%) translateY(-6px);
          box-shadow: 0 8px 32px rgba(0,0,0,.5), 0 2px 6px rgba(0,0,0,.3);
        }
        .pf-new-prompt:active {
          transform: translateX(-50%) translateY(-2px);
        }
        @keyframes prompt-in {
          from { opacity: 0; transform: translateX(-50%) translateY(-16px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(-4px); }
        }
        .pf-prompt-dot {
          width: 8px; height: 8px;
          border-radius: 50%;
          background: #3a7d44;
          flex-shrink: 0;
          animation: live 2.5s ease-in-out infinite;
        }
        .pf-prompt-dismiss {
          margin-left: 4px;
          width: 18px; height: 18px;
          border-radius: 50%;
          background: rgba(9,13,20,.12);
          display: flex; align-items: center; justify-content: center;
          font-size: .65rem;
          flex-shrink: 0;
          transition: background .15s;
        }
        .pf-new-prompt:hover .pf-prompt-dismiss { background: rgba(9,13,20,.2); }

        /* TOAST */
        .pf-toast { position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%); z-index: 1000; background: var(--surf2); border: 1px solid var(--bord2); color: var(--white); font-size: .76rem; padding: 10px 22px; white-space: nowrap; pointer-events: none; animation: toast-in .22s cubic-bezier(.16,1,.3,1); }
        @keyframes toast-in { from { opacity:0; transform:translateX(-50%) translateY(8px); } }
      `}</style>

      <div className="pf">

        {/* NAV */}
        <nav className="pf-nav">
          <div className="pf-socials">
            <a className="pf-social-link" href="https://www.facebook.com/ragingkamote12"                              target="_blank" rel="noopener noreferrer" aria-label="Facebook"><FacebookIcon /></a>
            <a className="pf-social-link" href="https://www.tiktok.com/@leojcb09?is_from_webapp=1&sender_device=pc"  target="_blank" rel="noopener noreferrer" aria-label="TikTok"><TikTokIcon /></a>
            <a className="pf-social-link" href="https://www.instagram.com/leonjcb09/"                                target="_blank" rel="noopener noreferrer" aria-label="Instagram"><InstagramIcon /></a>
          </div>
          <div className="pf-live"><span className="pf-live-dot" /><span>live</span></div>
          <button className="pf-btn" onClick={() => { urlCache.clear(); load(true); }} disabled={isWorking}>
            {status === "loading" ? "loading…" : "↺ refresh"}
          </button>
        </nav>

        {/* HERO */}
        <div className="pf-hero">
          <p className="pf-eyebrow">Photography Portfolio</p>
          <h1 className="pf-title">Leo's POV</h1>
          {visiblePhotos.length > 0 && (
            <span className="pf-photo-count">{visiblePhotos.length} photo{visiblePhotos.length !== 1 ? "s" : ""}</span>
          )}
        </div>

        {/* Deletion Mode Bar */}
        {deletionMode && (
          <div className="pf-del-bar">
            <span className="pf-del-bar-dot" />
            <span>Deletion Mode — tap trash icon to remove photos</span>
            <button className="pf-del-exit" onClick={() => setDeletionMode(false)}>Exit</button>
          </div>
        )}

        {/* Loading */}
        {status === "loading" && photos.length === 0 && (
          <div className="pf-state"><p className="pf-state-h">Loading…</p></div>
        )}

        {/* Error */}
        {status === "error" && (
          <div className="pf-state">
            <p className="pf-state-h">Failed to load</p>
            <div className="pf-state-bar" />
            <p className="pf-state-p">{errMsg}</p>
            <button className="pf-btn" onClick={() => load()} style={{ marginTop: 12 }}>try again</button>
          </div>
        )}

        {/* Empty */}
        {status === "done" && photos.length === 0 && (
          <div className="pf-state">
            <p className="pf-state-h">No Photos Yet</p>
            <div className="pf-state-bar" />
            <p className="pf-state-p">Post photos to your Telegram channel<br />and they will appear here.</p>
          </div>
        )}

        {/* Grid */}
        {photos.length > 0 && (
          <main className="pf-grid">
            {photos.map((photo, i) => {
              const visIdx = visiblePhotos.findIndex(p => p.id === photo.id);
              return (
                <PhotoCell
                  key={photo.id}
                  photo={photo}
                  index={i}
                  onClick={() => !deletionMode && visIdx >= 0 && openLb(visIdx)}
                  deletionMode={deletionMode}
                  onDelete={deletePhoto}
                />
              );
            })}
          </main>
        )}

        {/* Resolving indicator */}
        {status === "resolving" && (
          <div className="pf-dots"><div className="pf-dot"/><div className="pf-dot"/><div className="pf-dot"/></div>
        )}

        {/* Footer */}
        <footer className="pf-footer">
          <span className="pf-footer-name">LEO'S POV</span>
          <span className="pf-footer-copy">© {new Date().getFullYear()} All rights reserved</span>
          <div className="pf-footer-socials">
            <a className="pf-social-link" href="https://www.facebook.com/ragingkamote12"                             target="_blank" rel="noopener noreferrer" aria-label="Facebook"><FacebookIcon /></a>
            <a className="pf-social-link" href="https://www.tiktok.com/@leojcb09?is_from_webapp=1&sender_device=pc" target="_blank" rel="noopener noreferrer" aria-label="TikTok"><TikTokIcon /></a>
            <a className="pf-social-link" href="https://www.instagram.com/leonjcb09/"                               target="_blank" rel="noopener noreferrer" aria-label="Instagram"><InstagramIcon /></a>
          </div>
        </footer>

        {/* Lightbox */}
        {lightbox !== null && lbPhoto && (
          <LightboxViewer
            photos={visiblePhotos}
            index={lightbox}
            onClose={() => setLightbox(null)}
            onNav={navLb}
            lbReady={lbReady}
            setLbReady={setLbReady}
          />
        )}

        {/* Settings */}
        {settings && (
          <div className="pf-sett-overlay" onClick={e => e.currentTarget === e.target && setSettings(false)}>
            <div className="pf-sett-panel">
              <div className="pf-sett-hdr">
                <div className="pf-sett-tw">
                  <span className="pf-sett-ico"><GearIcon /></span>
                  <span className="pf-sett-ttl">SETTINGS</span>
                  <span className="pf-sett-bdg">Admin</span>
                </div>
                <button className="pf-sett-x" onClick={() => setSettings(false)}>✕</button>
              </div>
              <div className="pf-sett-body">
                <div className="pf-sett-row">
                  <div><p className="pf-sett-lbl">Gallery Cache</p><p className="pf-sett-desc">Locally cached photo metadata<br />for instant loading on refresh.</p></div>
                  <div className="pf-sett-act"><span className="pf-stat"><strong>{getCached().length}</strong> photo{getCached().length !== 1 ? "s" : ""}</span></div>
                </div>
                <div className="pf-sett-row">
                  <div><p className="pf-sett-lbl">Reset Gallery</p><p className="pf-sett-desc">Wipes cached photos and re-fetches.<br />Previously deleted photos stay deleted.</p></div>
                  <div className="pf-sett-act">
                    {resetDone
                      ? <span className="pf-btn-ok">✓ Done</span>
                      : <button className="pf-btn-danger" onClick={handleReset} disabled={isWorking}>Reset Gallery</button>}
                  </div>
                </div>
                <div className="pf-sett-row">
                  <div>
                    <p className="pf-sett-lbl">Deletion Mode</p>
                    <p className="pf-sett-desc">Show × button on photos.<br />Tap to permanently remove from gallery.</p>
                  </div>
                  <div className="pf-sett-act">
                    <button
                      className={deletionMode ? "pf-btn-danger" : "pf-btn"}
                      style={{ minWidth: 72 }}
                      onClick={() => { setDeletionMode(m => !m); setSettings(false); }}
                    >
                      {deletionMode ? "✓ Active" : "Enable"}
                    </button>
                  </div>
                </div>
                <div className="pf-sett-row">
                  <div>
                    <p className="pf-sett-lbl">Delete All Images</p>
                    <p className="pf-sett-desc">Permanently removes all photos<br />from this device. Cannot be undone.</p>
                  </div>
                  <div className="pf-sett-act">
                    {deleteAllDone
                      ? <span className="pf-btn-ok">✓ Deleted</span>
                      : <button className="pf-btn-danger" onClick={handleDeleteAll} disabled={isWorking}>Delete All</button>}
                  </div>
                </div>
                <div className="pf-sett-div" />
                <p className="pf-sett-hint">Press <strong style={{color:"var(--grey)"}}>LJCBSET</strong> to toggle this panel</p>
              </div>
            </div>
          </div>
        )}

        {/* New photo prompt */}
        {newPrompt && (
          <div
            className="pf-new-prompt"
            onClick={() => {
              window.scrollTo({ top: 0, behavior: "smooth" });
              setNewPrompt(null);
            }}
          >
            <span className="pf-prompt-dot" />
            <span>
              {newPrompt.count} new photo{newPrompt.count > 1 ? "s" : ""} — tap to view
            </span>
            <span
              className="pf-prompt-dismiss"
              onClick={e => { e.stopPropagation(); setNewPrompt(null); }}
            >✕</span>
          </div>
        )}

        {/* Toast */}
        {toast && <div className="pf-toast">{toast}</div>}
      </div>
    </>
  );
}
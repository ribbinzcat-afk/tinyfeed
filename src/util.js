/* ===== util: escape / เวลา / เรนเดอร์ข้อความ =====
 * `[img:ชื่อ]` และ `[sticker:ชื่อ]` ถูกแปลงกลางที่ renderRich() ที่นี่
 * ทุกแอปจึงได้ฟีเจอร์นี้ฟรี — ห้าม parse token เอง (CONVENTIONS.md บทที่ 4.8)
 * ขึ้นกับ store.js อย่างเดียว (getGallery) ห้าม import จาก index.js */
import { getGallery } from "./store.js";

export function unescapeLite(s) {
    return String(s == null ? "" : s)
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

export function findSticker(name) {
    const k = String(name || "").trim().toLowerCase();
    if (!k) return null;
    return getGallery().stickers.find((s) => String(s.name || "").trim().toLowerCase() === k) || null;
}

export function findGalleryImage(name) {
    const k = String(name || "").trim().toLowerCase();
    if (!k) return null;
    return getGallery().images.find((s) => String(s.name || "").trim().toLowerCase() === k) || null;
}

export function htmlToPlain(html) {
    const d = document.createElement("div");
    d.innerHTML = String(html || "").replace(/<br\s*\/?>/gi, "\n");
    return (d.textContent || "").trim();
}

export function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return "เมื่อสักครู่";
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} นาทีที่แล้ว`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} ชั่วโมงที่แล้ว`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d} วันที่แล้ว`;
    if (d < 30) return `${Math.floor(d / 7)} สัปดาห์ที่แล้ว`;
    if (d < 365) return `${Math.floor(d / 30)} เดือนที่แล้ว`;
    return `${Math.floor(d / 365)} ปีที่แล้ว`;
}

export function itemTimestamp(item) {
    if (item.ts) return item.ts;
    const m = String(item.id || "").match(/(\d{10,})/);
    return m ? Number(m[1]) : null;
}

export function displayTime(item) {
    const ts = itemTimestamp(item);
    return ts ? timeAgo(ts) : (item.time || "");
}

export function escapeText(str) {
    const div = document.createElement("div");
    div.textContent = String(str == null ? "" : str);
    return div.innerHTML;
}

export function escapeHtml(str) {
    return escapeText(str).replace(/\n/g, "<br>");
}

export function resolveMediaPriority(s) {
    s = String(s == null ? "" : s);
    const hasValidImg = [...s.matchAll(/\[img:([^\]]+)\]/gi)].some((m) => findGalleryImage(unescapeLite(m[1])));
    if (hasValidImg) s = s.replace(/\[sticker:[^\]]+\]/gi, "");
    return s;
}

export function renderRich(html) {
    let s = resolveMediaPriority(html);
    // โทเคนคลังรูป: [sticker:ชื่อ] → รูปสติกเกอร์ · [img:ชื่อ] → รูปพร้อมคำบรรยาย (ทำก่อน markdown)
    s = s.replace(/\[sticker:([^\]]+)\]/gi, (m, n) => renderStickerToken(unescapeLite(n)));
    s = s.replace(/\[img:([^\]]+)\]/gi, (m, n) => renderImgToken(unescapeLite(n)));
    s = s.replace(/`([^`<]+)`/g, '<code class="tinyfeed-code">$1</code>');
    s = s.replace(/\*\*([^*<]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*<\n]+)\*/g, "<em>$1</em>");
    s = s.replace(/~~([^~<]+)~~/g, "<del>$1</del>");
    s = s.replace(/(^|[\s(])#([^\s#@<&]+)/g, '$1<span class="tinyfeed-tag">#$2</span>');
    s = s.replace(/(^|[\s(])@([^\s#@<&]+)/g, '$1<span class="tinyfeed-mention">@$2</span>');
    return s;
}

export function escapeAttr(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export function renderStickerToken(name) {
    const s = findSticker(name);
    if (s && s.url) {
        return `<img class="tinyfeed-sticker-img" src="${escapeAttr(s.url)}" alt="${escapeText(s.name)}" title="${escapeText(s.name)}" onerror="this.classList.add('tinyfeed-img-broken')" />`;
    }
    return `<span class="tinyfeed-token-missing">[สติกเกอร์: ${escapeText(name)}]</span>`;
}

export function renderImgToken(name) {
    const im = findGalleryImage(name);
    if (im && im.url) {
        // คำบรรยายไม่โชว์ในเนื้อหา (ใช้เป็น prompt + โชว์ตอนดูรูปเต็มในคลังเท่านั้น)
        return `<span class="tinyfeed-content-img-wrap"><img class="tinyfeed-content-img" src="${escapeAttr(im.url)}" alt="${escapeText(im.name)}" onerror="this.classList.add('tinyfeed-img-broken')" /></span>`;
    }
    return `<span class="tinyfeed-token-missing">[รูป: ${escapeText(name)}]</span>`;
}

export function stripWrapBrackets(s) {
    s = String(s == null ? "" : s).trim();
    if (/^\[(?:sticker|img):[^\]]+\]$/i.test(s)) return s;   // เป็นโทเคนล้วน อย่าแตะ
    if (s.startsWith("[") && !/^\[(?:sticker|img):/i.test(s)) s = s.slice(1);
    if (s.endsWith("]")) {
        const tail = s.slice(s.lastIndexOf("["));
        if (!/^\[(?:sticker|img):[^\]]+\]$/i.test(tail)) s = s.slice(0, -1);   // ] ไม่ได้ปิดโทเคนท้ายข้อความ
    }
    return s.trim();
}

export function stripReasoning(raw) {
    let s = String(raw || "");
    // 1) ใช้ reasoning tag ที่ตั้งไว้ใน SillyTavern (ถ้ามี)
    try {
        const r = getContext().powerUserSettings && getContext().powerUserSettings.reasoning;
        if (r && r.prefix && r.suffix) {
            const esc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            s = s.replace(new RegExp(`${esc(r.prefix)}[\\s\\S]*?${esc(r.suffix)}`, "g"), "");
            // reasoning ถูกตัดกลางคัน (มี prefix แต่ไม่มี suffix) → ตัดตั้งแต่ prefix ทิ้ง
            const pi = s.indexOf(r.prefix);
            if (pi !== -1 && s.indexOf(r.suffix, pi) === -1) s = s.slice(0, pi);
        }
    } catch (e) { /* ไม่มี config ก็ข้ามไป fallback */ }
    // 2) fallback: tag ยอดนิยม (ทั้งแบบปิดครบ และแบบเปิดค้างเพราะถูกตัด)
    s = s.replace(/<(think|thinking|reason|reasoning)>[\s\S]*?<\/\1>/gi, "");
    s = s.replace(/<(think|thinking|reason|reasoning)>[\s\S]*$/i, "");
    return s.trim();
}

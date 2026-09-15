/* ===== util: escape / เวลา / เรนเดอร์ข้อความ =====
 * `[img:ชื่อ]` และ `[sticker:ชื่อ]` ถูกแปลงกลางที่ renderRich() ที่นี่
 * ทุกแอปจึงได้ฟีเจอร์นี้ฟรี — ห้าม parse token เอง (CONVENTIONS.md บทที่ 4.8)
 * ขึ้นกับ store.js อย่างเดียว (getGallery) ห้าม import จาก index.js */
import { getGallery, getSetting } from "./store.js";

// ตัดอักขระที่ "ครอบทั้งชื่อ" ออก (AI ชอบตอบชื่อมาแบบมีเครื่องหมายคำพูด/วงเล็บ/ป้ายกำกับหุ้ม)
// ต่างจาก regex เดิม (^["'“”\[\(]+|["'“”\]\)]+$) ตรงที่ตัดเฉพาะคู่ที่ห่อ "ทั้งสตริง" จริงๆ
// เช่น `แนน (สาวน้อย)` ไม่ขึ้นต้นด้วยวงเล็บ → ไม่ถูกแตะ (บั๊กเดิม: ตัด "(" นำหน้ากับ ")" ท้ายแยกกันคนละที่)
export function cleanAiName(s) {
    let name = String(s == null ? "" : s).trim();
    const pairs = [['"', '"'], ["'", "'"], ["“", "”"], ["[", "]"], ["(", ")"]];
    let changed = true;
    while (changed) {
        changed = false;
        for (const [open, close] of pairs) {
            if (name.length >= 2 && name.startsWith(open) && name.endsWith(close)) {
                name = name.slice(1, -1).trim();
                changed = true;
                break;
            }
        }
    }
    return name;
}

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

// ===== มาโคร @user =====
// เนื้อหาที่ผู้ใช้เขียนเอง (ไบโอ / สตอรี่ / โน้ต / โพสต์ในโปรไฟล์) เก็บตัวอักษร "@user" ไว้ตรงๆ เสมอ
// เพื่อไม่ให้ชื่อ persona ของเจ้าของเครื่องติดไปกับข้อมูลที่ส่งออก (การ์ดตัวละคร) แล้วค่อยแทนเป็นชื่อจริงตอน render
// index.js เป็นคนฉีด resolver เข้ามา — ไฟล์นี้ import จาก index.js ไม่ได้ (CLAUDE.md กฎเหล็กข้อ 4)
let mentionUserResolver = null;
export function setMentionUserResolver(fn) { mentionUserResolver = fn; }
function currentUserDisplayName() {
    try {
        return (mentionUserResolver && mentionUserResolver()) || "";
    } catch (e) {
        console.error("[tinyfeed] mentionUserResolver ล้มเหลว:", e);   // fallback = แสดง "@user" ตามเดิม
        return "";
    }
}

// ===== เฟส E: [genimg:ชื่อ|คำบรรยาย] — ให้ AI ขอรูปที่ยังไม่มีในคลังได้ =====
// การยิงคำขอจริง (ยุ่งกับ eventSource/getContext) ต้องอยู่ใน index.js เสมอ (กฎเหล็กข้อ 4 — ไฟล์นี้ import
// จาก index.js ไม่ได้) ใช้แพทเทิร์นฉีด callback เดียวกับ mentionUserResolver ด้านบน
let genImageHandler = null;
export function setGenImageHandler(fn) { genImageHandler = fn; }
function requestGenImage(name, description) {
    try {
        return (genImageHandler && genImageHandler(name, description)) || null;
    } catch (e) {
        console.error("[tinyfeed] genImageHandler ล้มเหลว:", e);
        return null;
    }
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

const CHAT_TIME_MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

// เวลาแบบสัมบูรณ์ (ต่างจาก timeAgo ที่เป็นสัมพัทธ์) — ใช้กับเส้นคั่นเวลาในแชท
// วันนี้ = "HH:MM" · เมื่อวาน = "เมื่อวาน HH:MM" · ปีนี้ = "D MMM HH:MM" · ข้ามปี = "D MMM YYYY HH:MM"
export function formatChatTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    const now = new Date();
    const pad2 = (n) => String(n).padStart(2, "0");
    const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay(d, now)) return hm;
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (sameDay(d, yesterday)) return `เมื่อวาน ${hm}`;
    const datePart = `${d.getDate()} ${CHAT_TIME_MONTHS_TH[d.getMonth()]}`;
    return d.getFullYear() === now.getFullYear() ? `${datePart} ${hm}` : `${datePart} ${d.getFullYear()} ${hm}`;
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

const GENIMG_TOKEN_RE = /\[genimg:([^\]|]+)\|([^\]]+)\]/i;

export function resolveMediaPriority(s) {
    s = String(s == null ? "" : s);
    const hasValidImg = [...s.matchAll(/\[img:([^\]]+)\]/gi)].some((m) => findGalleryImage(unescapeLite(m[1])));
    // [genimg:] ที่กำลังขอ/รอเจนอยู่ก็ต้องชนะสติกเกอร์เหมือนรูปที่มีอยู่แล้วในคลัง (AI ตั้งใจส่งรูปมา ไม่ใช่ตกลง
    // ไปใช้สติกเกอร์สำรอง) — เจอบั๊กจริงจากผู้ใช้ 2026-09-15: โพสต์ที่มีทั้งคู่ สติกเกอร์โผล่แทนรูปที่กำลังเจน
    const hasGenImg = GENIMG_TOKEN_RE.test(s);
    if (hasValidImg || hasGenImg) s = s.replace(/\[sticker:[^\]]+\]/gi, "");
    return s;
}

// แทนที่โทเคน [genimg:ชื่อ|คำบรรยาย] ทั้งหมดใน s ด้วยผลลัพธ์จาก mapFn(name, description) — ใช้ร่วมกันทั้ง
// renderRich() (เรนเดอร์อินไลน์) และ renderPostBody() ของ index.js (ดึงออกไปเก็บในโซนสื่อเหมือน img/sticker)
// เพื่อให้ "จำนวนที่ขอได้สูงสุดต่อข้อความ" นับรวมกันจริง ไม่ใช่นับแยกคนละที่ (เกินโควตา = ปล่อยเป็นข้อความดิบ)
export function replaceGenImgTokens(s, mapFn) {
    const maxGenImg = Math.max(0, parseInt(getSetting("genImageMaxPerMessage"), 10) || 0);
    let count = 0;
    return String(s == null ? "" : s).replace(/\[genimg:([^\]|]+)\|([^\]]+)\]/gi, (m, n, d) => {
        count++;
        if (count > maxGenImg) return m;
        return mapFn(unescapeLite(n).trim(), unescapeLite(d).trim());
    });
}

export function renderRich(html) {
    let s = resolveMediaPriority(html);
    // โทเคนคลังรูป: [sticker:ชื่อ] → รูปสติกเกอร์ · [img:ชื่อ] → รูปพร้อมคำบรรยาย (ทำก่อน markdown)
    s = s.replace(/\[sticker:([^\]]+)\]/gi, (m, n) => renderStickerToken(unescapeLite(n)));
    s = s.replace(/\[img:([^\]]+)\]/gi, (m, n) => renderImgToken(unescapeLite(n)));
    // [genimg:ชื่อ|คำบรรยาย] → ขอรูปที่ยังไม่มีในคลัง (เฟส E) — ใช้ในบริบทที่ไม่ใช่โพสต์ฟีด (คอมเมนต์/แชต/โน้ต ฯลฯ)
    // ที่ไม่มีโซนสื่อแยกให้ดึงไปวาง จึงเรนเดอร์อินไลน์ตรงนี้เลย (renderPostBody() ของโพสต์ฟีดดึงออกไปเองต่างหาก)
    s = replaceGenImgTokens(s, (name, desc) => renderGenImgToken(name, desc));
    s = s.replace(/`([^`<]+)`/g, '<code class="tinyfeed-code">$1</code>');
    s = s.replace(/\*\*([^*<]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*<\n]+)\*/g, "<em>$1</em>");
    s = s.replace(/~~([^~<]+)~~/g, "<del>$1</del>");
    s = s.replace(/(^|[\s(])#([^\s#@<&]+)/g, '$1<span class="tinyfeed-tag">#$2</span>');
    // @user → ชื่อ persona ปัจจุบัน · ต้องอยู่ "ก่อน" กฎ @mention ทั่วไป
    // ผลลัพธ์ขึ้นต้นด้วย "<" ซึ่งไม่เข้าเงื่อนไข (^|[\s(]) ของกฎถัดไป จึงไม่ถูกแทนซ้ำ
    s = s.replace(/(^|[\s(])@user\b/gi, (m, pre) => `${pre}<span class="tinyfeed-mention">@${escapeText(currentUserDisplayName() || "user")}</span>`);
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

// [genimg:ชื่อ|คำบรรยาย] — ถ้ารูปมาถึงคลังแล้ว (ชื่อตรงกับที่ขอ) แสดงเหมือน [img:] ปกติเลย ไม่ต้องถามสถานะอีก
// ถ้ายังไม่มี ให้ index.js (ผ่าน requestGenImage) ตัดสินใจว่าจะยิงคำขอหรือไม่ แล้วคืนสถานะมาเลือก UI ที่ตรงจริง
export function renderGenImgToken(name, description) {
    const im = findGalleryImage(name);
    if (im && im.url) {
        return `<span class="tinyfeed-content-img-wrap"><img class="tinyfeed-content-img" src="${escapeAttr(im.url)}" alt="${escapeText(im.name)}" onerror="this.classList.add('tinyfeed-img-broken')" /></span>`;
    }
    const status = requestGenImage(name, description); // "pending" | "failed" | null (ยังไม่ขอ/ฟีเจอร์ปิดอยู่)
    if (status === "pending") {
        return `<span class="tinyfeed-token-missing tinyfeed-generating"><i class="fa-solid fa-spinner fa-spin"></i> กำลังเจนรูป: ${escapeText(name)}…</span>`;
    }
    if (status === "failed") {
        return `<span class="tinyfeed-token-missing">[เจนรูปไม่สำเร็จ: ${escapeText(name)}]</span>`;
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

// ===== อัปโหลดรูปจากเครื่อง: ย่อ+บีบใน browser ก่อนส่งขึ้นเซิร์ฟเวอร์ (ไม่ import อะไรเพิ่ม — canvas ล้วน) =====
// ขนาด/คุณภาพเป้าหมายต่อชนิดการใช้งาน (ด้านยาวสุด px, คุณภาพ webp/jpeg 0-1)
export const IMG_KINDS = {
    image: { max: 1280, q: 0.82 },      // รูปในคลัง
    sticker: { max: 320, q: 0.90 },     // สติกเกอร์ (มักโปร่งใส)
    avatar: { max: 256, q: 0.85 },      // โปรไฟล์ / NPC / กลุ่ม
    wallpaper: { max: 1440, q: 0.82 },  // วอลเปเปอร์ / พื้นหลังเวที
    sprite: { max: 512, q: 0.90 },      // สไปรต์เพ็ท (มักโปร่งใส)
    thumb: { max: 320, q: 0.85 },       // สินค้า / ไอเทม
};
const IMG_GIF_MAX_BYTES = 2 * 1024 * 1024;   // GIF เคลื่อนไหวห้ามผ่าน canvas (จะกลายเป็นภาพนิ่ง) — จำกัดขนาดแทน

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("อ่านไฟล์ไม่สำเร็จ"));
        reader.readAsDataURL(file);
    });
}

function loadImageEl(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("ไฟล์นี้ไม่ใช่รูปภาพที่เปิดได้"));
        img.src = url;
    });
}

// data:mime;base64,xxxx → { mime, base64 } (ตัด prefix ออกให้ ไม่งั้นเซิร์ฟเวอร์ decode ไม่ได้)
function splitDataUrl(dataUrl) {
    const m = String(dataUrl || "").match(/^data:([^;]+);base64,(.*)$/s);
    if (!m) throw new Error("แปลงรูปเป็น base64 ไม่สำเร็จ");
    return { mime: m[1], base64: m[2] };
}

const MIME_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

/**
 * ย่อ+บีบไฟล์รูปจากเครื่องผู้ใช้ → { base64, ext } พร้อมส่งขึ้นเซิร์ฟเวอร์ (ไม่ persist base64 ที่ไหน)
 * @param {File} file  ไฟล์จาก <input type="file">
 * @param {keyof IMG_KINDS} kind  ใช้กำหนดขนาด/คุณภาพเป้าหมาย
 */
export async function downscaleImageFile(file, kind) {
    if (!file || !(file.type || "").startsWith("image/")) {
        throw new Error("เลือกไฟล์รูปภาพเท่านั้น");
    }
    const spec = IMG_KINDS[kind] || IMG_KINDS.image;

    // GIF เคลื่อนไหว — ผ่าน canvas จะกลายเป็นภาพนิ่ง จึงส่งไฟล์ดิบขึ้นเลย (จำกัดขนาดกันหนักเกิน)
    if (file.type === "image/gif") {
        if (file.size > IMG_GIF_MAX_BYTES) {
            throw new Error("ไฟล์ GIF ใหญ่เกิน 2MB — ลองไฟล์เล็กลง หรือแปลงเป็น WebP/PNG ก่อน");
        }
        const dataUrl = await readFileAsDataUrl(file);
        const { base64 } = splitDataUrl(dataUrl);
        return { base64, ext: "gif" };
    }

    const srcUrl = await readFileAsDataUrl(file);
    const img = await loadImageEl(srcUrl);
    const scale = Math.min(1, spec.max / Math.max(img.naturalWidth, img.naturalHeight));   // ไม่ขยายรูปที่เล็กอยู่แล้ว
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);

    // เช็คว่าเบราว์เซอร์เข้ารหัส webp ได้จริง (บาง engine เก่าจะคืน png เงียบๆ)
    let dataUrl = canvas.toDataURL("image/webp", spec.q);
    if (!dataUrl.startsWith("data:image/webp")) {
        // fallback: png (คงความโปร่งใส) เว้นแต่ไฟล์ต้นทางทึบแสงอยู่แล้ว → jpeg (เล็กกว่า)
        const opaque = file.type === "image/jpeg" || file.type === "image/bmp";
        dataUrl = canvas.toDataURL(opaque ? "image/jpeg" : "image/png", spec.q);
    }
    const { mime, base64 } = splitDataUrl(dataUrl);
    return { base64, ext: MIME_EXT[mime] || "png" };
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

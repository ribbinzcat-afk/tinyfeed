import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

// โมดูลย่อย (ดู CONVENTIONS.md บทที่ 7 — module layout)
import {
    extensionName, extensionFolderPath,
    defaultSettings, getFeedData, getGallery, getSetting, saveFeedData, saveGallery, setSetting,
} from "./src/store.js";
import {
    displayTime, escapeAttr, escapeHtml, escapeText, findGalleryImage, htmlToPlain,
    renderImgToken, renderRich, renderStickerToken, resolveMediaPriority,
    stripReasoning, stripWrapBrackets, timeAgo, unescapeLite,
} from "./src/util.js";
import {
    composeBarHtml, emptyInlineHtml, emptyStateHtml, skeletonCardHtml,
} from "./src/components.js";


// อ้างอิงโมดูล core ของ SillyTavern แบบ lazy (โหลดใน init) เพื่อดึง user_avatar ที่ context ไม่ได้ export
// ใช้ dynamic import + try/catch จะได้ไม่พังทั้งไฟล์ถ้าเวอร์ชันไหน export ไม่ตรง
let stScriptModule = null;


// อ่านค่า setting (fallback เป็นค่า default ถ้ายังไม่มี key นั้น — เผื่อผู้ใช้เก่าที่ settings ถูกสร้างก่อน key ใหม่)

// บันทึกค่า setting

function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }
    // migrate ค่าเก่า: "both" (โพสต์+ข่าว) → แบบใหม่ที่รวมคอมเมนต์ด้วย
    if (extension_settings[extensionName].injectMode === "both") {
        extension_settings[extensionName].injectMode = "posts_comments_news";
    }
    migrateLegacyAvatars();   // ย้ายรูป override เก่าเข้าโปรไฟล์ persona/char
    migrateVerseScenes();     // ย้ายซีนเก่าจาก TinyVerse → TinyTheater (ครั้งเดียว)
    const enabled = extension_settings[extensionName].enabled;
    $("#tinyfeed-enabled").prop("checked", enabled);
    applyMenuVisibility(enabled);
    applyTheme(extension_settings[extensionName].theme || "dark");
    applyWallpaper();
    applyAppearance();
    applyCustomCss();
}

// ใส่วอลเปเปอร์หน้าโฮม (ลิงก์ภายนอก)
function applyWallpaper() {
    const url = String(getSetting("wallpaperUrl") || "").trim();
    const home = $("#tinyfeed-home");
    if (url) {
        home.css("background-image", `url("${url.replace(/["\\]/g, "")}")`)
            .addClass("tinyfeed-has-wallpaper");
    } else {
        home.css("background-image", "").removeClass("tinyfeed-has-wallpaper");
    }
    // ความทึบ scrim ที่ทับวอลเปเปอร์ (0–100% → 0.0–1.0)
    let ov = parseInt(getSetting("wallpaperOverlay"), 10);
    if (!Number.isFinite(ov)) ov = 45;
    ov = Math.min(100, Math.max(0, ov));
    if (home.length) home[0].style.setProperty("--tf-wp-overlay-alpha", String(ov / 100));
}

// ซ่อน/แสดงปุ่มในเมนูตาม setting
function applyMenuVisibility(enabled) {
    $("#tinyfeed-menu-button").toggle(Boolean(enabled));
}

function onEnabledChange(event) {
    const value = Boolean($(event.target).prop("checked"));
    extension_settings[extensionName].enabled = value;
    saveSettingsDebounced();
    applyMenuVisibility(value);
    console.log(`[${extensionName}] enabled:`, value);
}

// เปิด/ปิด panel โทรศัพท์
function openPhone() {
    $("#tinyfeed-overlay").addClass("tinyfeed-visible");
    clearUnread();          // เปิดดูแล้ว เคลียร์จุดแดง
    restoreLastScreen();    // กลับไปหน้าจอล่าสุด (ไม่งั้นไปโฮม)
    console.log(`[${extensionName}] Phone opened`);
}

// ===== App Shell: ทะเบียนแอป + หน้าโฮม + สลับแอป =====

/* ทะเบียนแอปเดียวของทั้งระบบ — เพิ่มแอปใหม่ = เพิ่ม entry ที่นี่ที่เดียว
 * (เดิมกระจาย 4 ที่: HOME_APPS / APP_META / MEMO_APPS / whitelist ใน openApp → ไม่ตรงกันสักที่)
 * ความหมายของแต่ละ field + checklist เพิ่มแอปใหม่ อยู่ใน CONVENTIONS.md บทที่ 2
 *   home     = โผล่บนหน้าโฮม
 *   remember = จำเป็นหน้าจอล่าสุด (เดิม MEMO_APPS)
 *   label    = ชื่อใน dashboard/keyword editor ถ้าต่างจาก name (เดิม APP_META)
 *   a, b     = สีไล่เฉดของไอคอนโฮม (a = สีหลัก ใช้เป็นสีประจำแอปด้วย)
 */
const APPS = [
    {
        id: "feed", name: "TinyFeed", icon: "fa-hashtag", a: "#1d9bf0", b: "#0a6bd8",
        panel: "#tinyfeed-app-feed", home: true, remember: true,
        open() {
            $("#tinyfeed-app-feed .tinyfeed-tabs").removeClass("tinyfeed-hidden");
            applyFeedComposeMode();
            switchTab(activeTab);
        },
    },
    {
        id: "connect", name: "TinyConnect", icon: "fa-comment-dots", a: "#22c55e", b: "#15a34a",
        panel: "#tinyfeed-app-connect", home: true, remember: true,
        open() { openConnectList(); },
        back() { if (isConnectThreadOpen()) { openConnectList(); return true; } return false; },
    },
    {
        id: "stream", name: "TinyStream", icon: "fa-video", a: "#a855f7", b: "#7e22ce",
        panel: "#tinyfeed-app-stream", home: true, remember: true,
        open() { renderStream(); maybeStartStreamTimer(); },
    },
    {
        id: "memo", name: "TinyMemo", icon: "fa-calendar-check", a: "#f59e0b", b: "#d97706",
        panel: "#tinyfeed-app-memo", home: true, remember: true,
        open() { switchMemoTab(memoTab); },
    },
    {
        id: "forum", name: "TinyForum", icon: "fa-comments", a: "#ef4444", b: "#b91c1c",
        panel: "#tinyfeed-app-forum", home: true, remember: true,
        open() { openForumList(); },
        back() { if (isForumThreadOpen()) { openForumList(); return true; } return false; },
    },
    {
        id: "gallery", name: "TinyGallery", label: "คลังสื่อ", icon: "fa-images", a: "#ec4899", b: "#be185d",
        panel: "#tinyfeed-app-gallery", home: true, remember: true,
        open() { openGallery(); },
    },
    {
        id: "bank", name: "TinyBank", icon: "fa-wallet", a: "#10b981", b: "#047857",
        panel: "#tinyfeed-app-bank", home: true, remember: true,
        open() { renderBank(); },
    },
    {
        id: "shop", name: "TinyShop", icon: "fa-bag-shopping", a: "#f97316", b: "#c2410c",
        panel: "#tinyfeed-app-shop", home: true, remember: true,
        open() { renderShop(); },
    },
    {
        id: "pet", name: "TinyPet", icon: "fa-paw", a: "#8b5cf6", b: "#6d28d9",
        panel: "#tinyfeed-app-pet", home: true, remember: false,   // เพ็ทมี state ของตัวเอง ไม่คืนหน้าจอ
        open() {
            petActionSprite = ""; petBubble = "";
            renderPet();          // sync decay + วาดหน้าจอตามสถานะ (create/dead/active)
            startPetLiveTick();   // อัปเดตบาร์สดๆ ระหว่างเปิดแอป
        },
    },
    {
        id: "verse", name: "TinyVerse", icon: "fa-globe", a: "#6366f1", b: "#4338ca",
        panel: "#tinyfeed-app-verse", home: true, remember: true,
        open() { versePostId = null; openVerse(); },
        back() { if (isVersePostOpen()) { closeVersePost(); return true; } return false; },
    },
    {
        id: "theater", name: "TinyTheater", icon: "fa-masks-theater", a: "#e11d48", b: "#9f1239",
        panel: "#tinyfeed-app-theater", home: true, remember: true,
        open() { openTheater(); },
    },
    {
        id: "novel", name: "TinyNovel", icon: "fa-book-open", a: "#0ea5e9", b: "#0369a1",
        panel: "#tinyfeed-app-novel", home: true, remember: true,
        open() { openNovel(); },
        back() {
            if (novelScreen === "chars") { novelScreen = "read"; renderNovel(); return true; }   // ตัวละคร → กลับไปอ่านต่อ
            if (novelScreen !== "shelf") { novelScreen = "shelf"; novelBookId = null; renderNovel(); return true; }
            return false;
        },
    },
];

const APP_BY_ID = Object.fromEntries(APPS.map((a) => [a.id, a]));

/* ทะเบียน overlay/modal — ใช้ร่วมกันระหว่าง openApp (กันค้างข้ามแอป) และ handleBack (ปุ่มย้อนกลับ)
 * เดิมสองที่นี้ถือลิสต์คนละชุด → char-profile / verse-import / verse-poster ปิดด้วยปุ่มย้อนกลับไม่ได้ */
const OVERLAYS = [
    { sel: "#tinyfeed-gallery-picker", close: closeGalleryOverlays },
    { sel: "#tinyfeed-gallery-view", close: closeGalleryOverlays },
    { sel: "#tinyfeed-gallery-edit", close: closeGalleryOverlays },
    { sel: "#tinyfeed-char-picker", close: closeCharPicker },
    { sel: "#tinyfeed-char-profile", close: closeCharProfile },
    { sel: "#tinyfeed-verse-import-modal", close: closeVerseImport },
    { sel: "#tinyfeed-verse-poster-modal", close: closeVersePosterPicker },
    { sel: "#tinyfeed-slip-modal", close: closeSlipModal },
    { sel: "#tinyfeed-donate-modal", close: closeDonateModal },
    { sel: "#tinyfeed-shop-edit-modal", close: closeShopEditModal },
    { sel: "#tinyfeed-pet-shop-modal", close: closePetShop },
    { sel: "#tinyfeed-pet-item-modal", close: closePetItemModal },
    { sel: "#tinyfeed-pet-topup-modal", close: closePetTopup },
    { sel: "#tinyfeed-pet-game-modal", close: closePetGame },
];

function anyOverlayOpen() {
    return OVERLAYS.some((o) => !$(o.sel).hasClass("tinyfeed-hidden"));
}

// ปิดเฉพาะ overlay ที่เปิดอยู่จริง (เดิมเรียก close ทุกตัวรัวๆ ไม่ว่าตัวไหนเปิด)
function closeOpenOverlays() {
    OVERLAYS.forEach((o) => { if (!$(o.sel).hasClass("tinyfeed-hidden")) o.close(); });
}

// หยุด timer ทุกตัวที่ผูกกับหน้าจอ (พื้นหลัง petTimer/proactiveTimer ยังเดินต่อ)
function clearScreenTimers() {
    clearStreamTimer();
    clearHomeClock();
    clearPetLiveTick();
}

let currentApp = "home";

function goHome() {
    currentApp = "home";
    clearScreenTimers();
    closeOpenOverlays();
    $(".tinyfeed-app").addClass("tinyfeed-hidden");
    $("#tinyfeed-home").removeClass("tinyfeed-hidden");
    $(".tinyfeed-title").text("TinyPhone");
    $("#tinyfeed-home-btn, #tinyfeed-back").addClass("tinyfeed-hidden");
    $("#tinyfeed-settings-btn").removeClass("tinyfeed-hidden");   // เฟืองเข้าถึงได้จากโฮม
    try { $("#tinyfeed-home .tinyfeed-home-hello").text(`สวัสดี, ${getUserName()}`); } catch (e) { /* ไม่มีชื่อผู้ใช้ = คงข้อความเดิมไว้ */ }
    renderHomeWidgets();
    renderHomeApps();
    saveLastScreen();
}

function openApp(id) {
    const app = APP_BY_ID[id];
    if (!app) {
        toastr.info("แอปนี้กำลังจะมา เร็วๆ นี้! 📱", "TinyPhone");
        return;
    }
    clearScreenTimers();
    closeOpenOverlays();   // กัน overlay ค้างข้ามแอป
    $("#tinyfeed-home").addClass("tinyfeed-hidden");
    $(".tinyfeed-app").addClass("tinyfeed-hidden");
    $("#tinyfeed-home-btn, #tinyfeed-settings-btn").removeClass("tinyfeed-hidden");
    $("#tinyfeed-back").addClass("tinyfeed-hidden");

    currentApp = app.id;
    $(app.panel).removeClass("tinyfeed-hidden");
    $(".tinyfeed-title").text(app.name);
    if (typeof app.open === "function") app.open();
    saveLastScreen();
}

// ===== TinyStream: ไลฟ์สตรีม + คอมเมนต์สด =====
let isGeneratingStream = false;
let streamTimer = null;

function getStreamData() {
    const data = getFeedData();
    if (!data.stream || typeof data.stream !== "object") {
        data.stream = { live: false, title: "", direction: "", viewers: 0, comments: [] };
    }
    if (!Array.isArray(data.stream.comments)) data.stream.comments = [];
    if (typeof data.stream.direction !== "string") data.stream.direction = "";
    // เลือกสตรีมเมอร์ในหน้าแอป (ผูกกับแชท): mainStreamer "" = ตัวละครหลัก, POSTER_USER = เรา, หรือชื่อ NPC/ตัวละคร
    if (typeof data.stream.mainStreamer !== "string") data.stream.mainStreamer = "";
    if (!Array.isArray(data.stream.coHosts)) data.stream.coHosts = [];
    return data.stream;
}

// true = ผู้ใช้เป็นสตรีมเมอร์หลักเอง (ไม่ใช่ตัวละคร AI)
function streamerIsUser() {
    return getStreamData().mainStreamer === POSTER_USER;
}

// avatarItem จากชื่อผู้พูดในไลฟ์ (ผู้ใช้ / ตัวละครหลัก / NPC) — จับคู่กับ username/alias ด้วย
function streamSpeakerAvatarItem(name) {
    const who = String(name || "").trim();
    if (nameMatchesUser(who)) return { isUser: true, author: who };
    if (nameMatchesChar(who)) return { isMain: true, author: who };
    return { author: who, avatar: getNpcAvatar(who) };
}

// สตรีมเมอร์หลักปัจจุบัน { name, avatarItem } — เลือกในหน้าแอป (เก็บใน stream data)
function getStreamer() {
    const main = getStreamData().mainStreamer || "";
    if (main === POSTER_USER) {
        return { name: getUserName(), avatarItem: { isUser: true, author: getUserName() } };
    }
    if (main) return { name: main, avatarItem: streamSpeakerAvatarItem(main) };
    // ค่าเริ่มต้น = ตัวละครหลัก (ใช้ชื่อ display = username/alias)
    const name = getCharName();
    return { name, avatarItem: { isMain: true, author: name } };
}

// รายชื่อผู้ไลฟ์ที่เป็น AI (หลัก + ตัวละครร่วมไลฟ์) — ไม่รวมผู้ใช้ (ผู้ใช้พิมพ์เอง)
function getStreamHosts() {
    const hosts = [];
    const seen = new Set();
    const add = (nm) => {
        const k = String(nm || "").trim();
        if (!k || k === POSTER_USER || k === getUserName()) return;   // ข้ามผู้ใช้ (ไม่ให้ AI พูดแทน)
        if (!seen.has(k.toLowerCase())) { seen.add(k.toLowerCase()); hosts.push(k); }
    };
    if (!streamerIsUser()) add(getStreamer().name);
    for (const co of (getStreamData().coHosts || [])) add(co);
    return hosts;
}

// ผู้ใช้เป็นหนึ่งในผู้ไลฟ์ไหม (เป็นหลัก หรือมาไลฟ์ร่วม) — โชว์ช่องพิมพ์คำพูดของเรา
function userIsHost() {
    return streamerIsUser() || (getStreamData().coHosts || []).includes(POSTER_USER);
}

// แปลงค่า host (ชื่อ หรือ POSTER_USER) เป็น { name, avatarItem } สำหรับแสดงผล
function hostDisplay(hostVal) {
    if (hostVal === POSTER_USER) return { name: getUserName(), avatarItem: { isUser: true, author: getUserName() } };
    return { name: hostVal, avatarItem: streamSpeakerAvatarItem(hostVal) };
}

// ชนิดการพูด: มีคอมเมนต์ผู้ใช้ค้างล่าสุด = ตอบ, ไม่งั้น = เล่าเรื่อง
function streamSpeakKind() {
    const s = getStreamData();
    for (let i = s.comments.length - 1; i >= 0; i--) {
        const c = s.comments[i];
        if (c.isStreamer) break;
        if (c.isUser) return "reply";
    }
    return "talk";
}

// ผู้พูด AI คนถัดไป (วนเวียนจากคนที่พูดล่าสุด → การันตีว่าตัวร่วมได้คิว)
function nextStreamHost(hosts) {
    const last = String(getStreamData().lastSpeaker || "");
    const idx = hosts.findIndex((h) => h.toLowerCase() === last.toLowerCase());
    return hosts[(idx + 1) % hosts.length];
}

// วาดรูปโปรไฟล์ผู้ไลฟ์ในกรอบสตรีม — แตะรูป AI = ให้พูด · แตะรูปเรา = พิมพ์เอง
// ปุ่มดินสอ = เปลี่ยนสตรีมเมอร์หลัก · ปุ่มกากบาท = เอาตัวร่วมออก · ปุ่ม + = เพิ่มตัวร่วม
function renderStreamHosts() {
    const s = getStreamData();
    const main = getStreamer();
    const mainVal = s.mainStreamer || "";
    const mainIsUser = mainVal === POSTER_USER;
    // ตัวร่วมไลฟ์ (ไม่ซ้ำกับหลัก) — อาจมี POSTER_USER (เรา)
    const co = (s.coHosts || []).filter((v) => {
        if (mainIsUser) return v !== POSTER_USER;
        return v !== mainVal && v !== main.name;
    });
    const multi = co.length > 0;
    const hint = (isUser) => isUser ? "แตะเพื่อพิมพ์คำพูดของเรา" : "แตะให้พูด";
    // สตรีมเมอร์หลัก
    let html = `<div class="tinyfeed-stream-host tinyfeed-stream-host-main" ${mainIsUser ? `data-user="1"` : `data-name="${escapeAttr(main.name)}"`} title="${hint(mainIsUser)}">
        ${multi ? `<span class="tinyfeed-host-crown"><i class="fa-solid fa-crown"></i></span>` : ""}
        <span class="tinyfeed-host-edit" title="เปลี่ยนสตรีมเมอร์หลัก"><i class="fa-solid fa-pen"></i></span>
        ${makeAvatar(main.avatarItem)}
        <span class="tinyfeed-host-name">${escapeText(main.name)}</span>
    </div>`;
    // ตัวร่วมไลฟ์
    for (const v of co) {
        const d = hostDisplay(v);
        const isUser = v === POSTER_USER;
        html += `<div class="tinyfeed-stream-host" data-role="co" ${isUser ? `data-user="1"` : `data-name="${escapeAttr(d.name)}"`} data-val="${escapeAttr(v)}" title="${hint(isUser)}">
            <span class="tinyfeed-host-remove" title="เอาออก"><i class="fa-solid fa-xmark"></i></span>
            ${makeAvatar(d.avatarItem)}
            <span class="tinyfeed-host-name">${escapeText(d.name)}</span>
        </div>`;
    }
    html += `<div id="tinyfeed-stream-addhost" class="tinyfeed-stream-addhost" title="เพิ่มตัวละคร/เราเอง มาไลฟ์ร่วม"><i class="fa-solid fa-plus"></i></div>`;
    $("#tinyfeed-stream-hosts").html(html);
}

// พื้นหลังกรอบสตรีม: ลิงก์รูป > สีตามธีม > สีพื้นม่วงเริ่มต้น
function applyStreamBg() {
    const stage = $("#tinyfeed-app-stream .tinyfeed-stream-stage");
    if (!stage.length) return;
    const url = String(getSetting("streamBgUrl") || "").trim();
    if (url) {
        stage.css("background-image", `url("${url.replace(/["\\]/g, encodeURIComponent)}")`);
    } else if (getSetting("streamBgTheme")) {
        stage.css("background-image", "linear-gradient(135deg, var(--tf-accent), color-mix(in srgb, var(--tf-accent) 50%, #000))");
    } else {
        stage.css("background-image", "linear-gradient(135deg, #a855f7, #7e22ce)");
    }
}

function clearStreamTimer() {
    if (streamTimer) { clearInterval(streamTimer); streamTimer = null; }
}

function maybeStartStreamTimer() {
    clearStreamTimer();
    const s = getStreamData();
    const viewersAuto = getSetting("streamCommentMode") === "auto";
    // มอโนล็อกใช้ได้เฉพาะสตรีมเมอร์ที่เป็นตัวละคร AI
    const talk = Boolean(getSetting("streamStreamerTalk")) && !streamerIsUser();
    if (currentApp === "stream" && s.live && (viewersAuto || talk)) {
        const sec = Math.max(4, parseInt(getSetting("streamAutoInterval"), 10) || 12);
        streamTimer = setInterval(() => {
            if (isGeneratingStream) return;
            // สลับระหว่างสตรีมเมอร์เล่าเรื่อง กับ คอมเมนต์ผู้ชม
            if (talk && (!viewersAuto || Math.random() < 0.4)) streamerSpeak("talk", { silent: true });
            else if (viewersAuto) loadLiveComments({ silent: true });
        }, sec * 1000);
    }
}

function renderStream() {
    const s = getStreamData();
    const streamer = getStreamer();
    renderStreamHosts();
    applyStreamBg();
    $("#tinyfeed-app-stream .tinyfeed-stream-title").text(s.live ? (s.title || "กำลังไลฟ์สด") : "ยังไม่ได้เริ่มไลฟ์");
    // ชื่อผู้ไลฟ์: รวมตัวละครร่วมไลฟ์ (+ เราเอง ถ้าเรามาไลฟ์ร่วม/เป็นหลัก)
    const hostNames = getStreamHosts();
    if (userIsHost()) hostNames.unshift(getUserName());
    const byLine = hostNames.length ? hostNames.join(", ") : streamer.name;
    $("#tinyfeed-app-stream .tinyfeed-stream-streamer").text(s.live ? `โดย ${byLine}${s.direction ? " · " + s.direction : ""}` : "");
    $("#tinyfeed-stream-toggle").text(s.live ? "จบไลฟ์" : "เริ่มไลฟ์");
    $(".tinyfeed-stream-live").toggleClass("tinyfeed-hidden", !s.live);
    $(".tinyfeed-stream-viewers").toggleClass("tinyfeed-hidden", !s.live).text(`👁 ${formatCount(s.viewers)}`);
    const userHost = userIsHost();
    // เราเป็นผู้ไลฟ์ (หลัก/ร่วม) = แถบพิมพ์คำพูดของเรา · ไม่งั้น = แถบคอมเมนต์ผู้ชม
    $(".tinyfeed-stream-compose").toggleClass("tinyfeed-hidden", !(s.live && !userHost));
    $(".tinyfeed-stream-streamer-compose").toggleClass("tinyfeed-hidden", !(s.live && userHost));
    // ฟอร์มตั้งหัวข้อ + ปุ่มให้ AI ตั้งหัวข้อโชว์ตอนยังไม่ไลฟ์
    $("#tinyfeed-stream-startform").toggleClass("tinyfeed-hidden", s.live);
    $("#tinyfeed-stream-ai-title").toggleClass("tinyfeed-hidden", s.live);
    // ปุ่ม "ให้สตรีมเมอร์พูด" (AI) โชว์เมื่อมีสตรีมเมอร์ AI อย่างน้อย 1 คน (รวมกรณีเราไลฟ์ + มีตัวละครร่วม)
    $("#tinyfeed-stream-speak").toggleClass("tinyfeed-hidden", !(s.live && getStreamHosts().length > 0));
    // แถบเครื่องมือลอย (ปุ่มโหลดคอมเมนต์สด) โชว์เฉพาะโหมด manual ระหว่างไลฟ์
    $("#tinyfeed-stream-tools").toggleClass("tinyfeed-hidden",
        !(s.live && getSetting("streamCommentMode") === "manual"));
    // ไอคอนโดเนทอยู่ในแถบพิมพ์คอมเมนต์ (โชว์อัตโนมัติเมื่อ compose ผู้ชมโชว์) · ปุ่มลบไลฟ์: เมื่อจบไลฟ์แล้วยังมีประวัติค้าง
    $("#tinyfeed-stream-clear").toggleClass("tinyfeed-hidden", !(!s.live && s.comments.length > 0));

    // แคปชันบนเวที = ประโยคล่าสุดที่สตรีมเมอร์พูด
    const lastSpeak = [...s.comments].reverse().find((c) => c.isStreamer);
    $(".tinyfeed-stream-caption").toggleClass("tinyfeed-hidden", !(s.live && lastSpeak))
        .html(lastSpeak ? `🎙 ${renderRich(lastSpeak.text)}` : "");

    const rows = s.comments.map((c) => {
        if (c.isSystem) {
            return `<div class="tinyfeed-stream-divider"><span>${c.text}</span></div>`;
        }
        if (c.isDonation) {
            const color = donateTierColor(c.amount);
            return `<div class="tinyfeed-stream-donation" style="--donate-color:${color}">
                <div class="tinyfeed-stream-donation-head">
                    <span class="tinyfeed-stream-donation-who"><i class="fa-solid fa-gift"></i> ${escapeText(c.author)}</span>
                    <span class="tinyfeed-stream-donation-amt">${formatMoney(c.amount)}</span>
                </div>
                ${c.text ? `<div class="tinyfeed-stream-donation-msg">${renderRich(c.text)}</div>` : ""}
            </div>`;
        }
        if (c.isStreamer) {
            // ใช้ avatar ของผู้พูดจริง (รองรับไลฟ์หลายตัวละคร)
            const spkAva = (c.author && c.author !== streamer.name) ? streamSpeakerAvatarItem(c.author) : streamer.avatarItem;
            return `<div class="tinyfeed-stream-speak-row">
                ${makeAvatar(spkAva)}
                <div class="tinyfeed-stream-speak-body">
                    <span class="tinyfeed-stream-speak-label"><i class="fa-solid fa-microphone"></i> ${escapeText(c.author)} · สตรีมเมอร์</span>
                    <span class="tinyfeed-stream-speak-text">${renderRich(c.text)}</span>
                </div>
            </div>`;
        }
        return `
        <div class="tinyfeed-stream-comment">
            ${makeAvatar(c.isUser ? { isUser: true, author: c.author } : { author: c.author, avatar: c.avatar || "" })}
            <div class="tinyfeed-stream-comment-body">
                <span class="tinyfeed-stream-comment-author">${escapeText(c.author)}</span>
                <span class="tinyfeed-stream-comment-text">${renderRich(c.text)}</span>
            </div>
        </div>`;
    }).join("");
    const box = $("#tinyfeed-stream-comments");
    box.html(rows);
    if (box[0]) box.scrollTop(box[0].scrollHeight);
    updateChatInjection();
}

async function toggleStream() {
    const s = getStreamData();
    if (s.live) {
        s.live = false;
        s.comments.push({ isSystem: true, text: "⏹ จบไลฟ์แล้ว", ts: Date.now() });
        clearStreamTimer();
        saveFeedData();
        renderStream();
        return;
    }
    // เริ่มไลฟ์: ใช้หัวข้อที่ผู้ใช้กรอก หรือให้ AI ตั้งถ้าเว้นว่าง
    if (isGeneratingStream) return;
    const userTitle = String($("#tinyfeed-stream-title-input").val() || "").trim();
    const direction = String($("#tinyfeed-stream-direction-input").val() || "").trim();
    isGeneratingStream = true;
    const btn = $("#tinyfeed-stream-toggle");
    btn.prop("disabled", true).text("กำลังเริ่ม...");
    try {
        const streamer = getStreamer();
        let title = userTitle;
        if (!title) {
            const q = `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] ${streamer.name} กำลังจะไลฟ์สดในแอปสตรีมมิ่ง ` +
                (direction ? `แนวทางไลฟ์: ${direction}. ` : "") +
                `ตั้งหัวข้อไลฟ์สั้นๆ 1 บรรทัดให้เข้ากับสถานการณ์ในเนื้อเรื่องตอนนี้ ใช้ภาษาเดียวกับเนื้อเรื่อง ตอบเฉพาะหัวข้อ ไม่ต้องมีอย่างอื่น`;
            const raw = await tinyGenerate(q, 60, "stream");
            title = stripReasoning(raw).split("\n")[0].replace(/^["'“”]+|["'“”]+$/g, "").trim();
        }
        s.title = title || "ไลฟ์สด";
        s.direction = direction;
        s.live = true;
        s.viewers = 20 + Math.floor(Math.random() * 4800);
        s.comments.push({ isSystem: true, text: escapeText(`🔴 เริ่มไลฟ์ — ${s.title}`), ts: Date.now() });
        $("#tinyfeed-stream-title-input").val("");
        $("#tinyfeed-stream-direction-input").val("");
        saveFeedData();
        renderStream();
        maybeStartStreamTimer();
        // สตรีมเมอร์ตัวละครทักเปิดไลฟ์เอง · ถ้าเราเป็นสตรีมเมอร์ให้พิมพ์เอง
        if (!streamerIsUser()) await streamerSpeak("open", { silent: true });
        loadLiveComments({ silent: true });               // ผู้ชมทักทาย
    } catch (e) {
        console.error(`[${extensionName}] start stream failed:`, e);
        toastr.error("เริ่มไลฟ์ไม่สำเร็จ ลองใหม่นะ", "TinyStream");
    } finally {
        isGeneratingStream = false;
        btn.prop("disabled", false);
        renderStream();
    }
}

// tier โดเนท (คงลำดับที่เก็บไว้ — ไม่ sort เพื่อให้แก้ไขไม่เด้ง) + สีตามจำนวนเงิน (SuperChat)
function getDonateTiers() {
    const t = getSetting("donateTiers");
    return (Array.isArray(t) && t.length ? t : defaultSettings.donateTiers)
        .map((x) => ({ min: Math.max(0, parseInt(x.min, 10) || 0), color: String(x.color || "#1d9bf0") }));
}
function donateTierColor(amount) {
    const amt = Number(amount) || 0;
    const tiers = getDonateTiers().sort((a, b) => a.min - b.min);
    let color = tiers.length ? tiers[0].color : "#1d9bf0";
    for (const t of tiers) { if (amt >= t.min) color = t.color; }
    return color;
}

// วาดตัวแก้ tier โดเนทในหน้า config
function renderDonateTiers() {
    const tiers = getDonateTiers();
    $("#tinyfeed-donate-tiers").html(tiers.map((t, i) => `
        <div class="tinyfeed-donate-tier-row" data-index="${i}">
            <span class="tinyfeed-donate-tier-ge">≥</span>
            <input class="tinyfeed-donate-tier-min" type="number" min="0" value="${t.min}" />
            <input class="tinyfeed-donate-tier-color" type="color" value="${escapeAttr(t.color)}" />
            <span class="tinyfeed-donate-tier-del" title="ลบ tier"><i class="fa-solid fa-trash"></i></span>
        </div>
    `).join("") || `<span class="tinyfeed-field-hint">ยังไม่มี tier</span>`);
}

// แยกบรรทัดโดเนทจากผลลัพธ์ AI: DONATE: ชื่อ | จำนวนเงิน | ข้อความ
function parseDonations(raw) {
    const s = stripReasoning(raw);
    const out = [];
    const re = /DONATE:\s*(.+)/gi;
    let m;
    while ((m = re.exec(s)) !== null) {
        const parts = m[1].split("|");
        if (parts.length < 2) continue;
        const author = parts[0].replace(/^["'“”\[\(]+|["'“”\]\)]+$/g, "").trim();
        const amount = Math.abs(Math.round(parseFloat(String(parts[1]).replace(/[^\d.]/g, "")) || 0));
        const text = parts.slice(2).join("|").trim();
        if (author && amount) out.push({ author, amount, text });
    }
    return out;
}

// ประมวลผลโดเนทที่ AI สร้าง: เข้าบัญชี + ดันการ์ดโดเนทลงคอมเมนต์ไลฟ์
function processDonations(raw) {
    if (!getSetting("streamDonateEnabled")) return;
    const s = getStreamData();
    // สตรีมเมอร์ (หลัก + ตัวร่วมไลฟ์ทุกคน) + ผู้ใช้ = โดเนทให้ไลฟ์ตัวเองไม่ได้
    const hostSet = new Set([...getStreamHosts(), getStreamer().name, getUserName()]
        .map((n) => String(n || "").trim().toLowerCase()).filter(Boolean));
    const cap = Math.max(1, parseInt(getSetting("bankDonateMax"), 10) || 5000);
    // เงินเข้า TinyBank เฉพาะเมื่อ "เรา" เป็นคนไลฟ์ (เจ้าของไลฟ์) — ถ้าคนอื่นไลฟ์ เงินไม่เข้าบัญชีเรา
    const userHost = userIsHost();
    for (const d of parseDonations(raw)) {
        if (hostSet.has(d.author.trim().toLowerCase())) continue;
        const amount = Math.min(cap, d.amount);
        if (userHost) bankAdd(amount, `โดเนทจาก ${d.author}`, "stream", { silentToast: true });
        s.comments.push({ isDonation: true, author: d.author, amount, text: escapeHtml(d.text || ""), ts: Date.now() });
    }
}

async function loadLiveComments(opts) {
    opts = opts || {};
    const s = getStreamData();
    if (!s.live || isGeneratingStream) return;
    isGeneratingStream = true;
    const btn = $("#tinyfeed-stream-loadcomments");
    btn.addClass("tinyfeed-generating").prop("disabled", true);
    try {
        const streamer = getStreamer();
        const you = getUserName();
        const npcNames = getNpcs().map((n) => String(n.name || "").trim()).filter(Boolean);
        const recent = s.comments.slice(-6).map((c) => `${c.author}: ${htmlToPlain(c.text)}`).join("\n");
        const extra = String(getSetting("streamExtraPrompt") || "").trim();
        // ระบบโดเนท: ให้ AI เลือกให้ผู้ชมโดเนทเอง (กำหนดจำนวน + ข้อความ)
        const donateLine = getSetting("streamDonateEnabled")
            ? ` [ระบบโดเนท] ผู้ชมบางคนอาจโดเนทเงินให้สตรีมเมอร์ได้ (0-1 คนต่อรอบ ไม่ต้องมีทุกครั้ง). ถ้าจะให้ใครโดเนท ใส่บรรทัดแยกในรูปแบบนี้: DONATE: <ชื่อผู้ชม> | <จำนวนเงินเป็นตัวเลข เช่น 20-2000> | <ข้อความโดเนทสั้นๆ>.`
            : "";
        const q = buildPrompt("streamComments", {
            streamer: streamer.name, title: s.title,
            direction: s.direction ? ` แนวทางไลฟ์: ${s.direction}.` : "",
            roster: npcNames.length ? " หรือใช้ NPC เหล่านี้บ้าง: " + npcNames.join(", ") : "",
            extra: (extra ? ` คำสั่งเพิ่มเติม: ${extra}.` : "") + donateLine,
            context: crossAppContext("stream"),
            recent: recent ? `\nคอมเมนต์ล่าสุด (อย่าซ้ำ):\n${recent}\n` : "",
        });
        const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("streamTokens"), 10) || 300), "stream");
        // กรองไม่ให้สตรีมเมอร์ (หลัก + ตัวร่วมไลฟ์ทุกคน) หรือผู้ใช้ โผล่เป็นผู้ชมสุ่ม
        // (คนพวกนี้ต้อง "พูดในไลฟ์" ผ่าน streamerSpeak ไม่ใช่คอมเมนต์สตรีมตัวเอง)
        const hostSet = new Set([...getStreamHosts(), streamer.name, you]
            .map((n) => String(n || "").trim().toLowerCase()).filter(Boolean));
        const list = parseCommentLines(raw, streamer.name)
            .filter((c) => !hostSet.has(c.author.trim().toLowerCase()))
            .map((c) => ({ author: c.author, avatar: getNpcAvatar(c.author), text: c.text, ts: Date.now() }));
        const before = s.comments.length;
        s.comments.push(...list);
        processDonations(raw);   // โดเนทที่ AI กำหนด → เข้าบัญชี + การ์ดโดเนท
        if (s.comments.length > before) { saveFeedData(); renderStream(); }
    } catch (e) {
        console.error(`[${extensionName}] live comments failed:`, e);
        if (!opts.silent) toastr.error("โหลดคอมเมนต์ไม่สำเร็จ", "TinyStream");
    } finally {
        isGeneratingStream = false;
        btn.removeClass("tinyfeed-generating").prop("disabled", false);
    }
}

// ให้สตรีมเมอร์ AI พูด 1 ประโยค — kind: "open" | "reply" | "talk"
// opts.host = บังคับให้คนนี้พูด · ถ้าไม่ระบุและมีหลายคน = วนเวียนทีละคน (การันตีตัวร่วมได้คิว)
async function streamerSpeak(kind, opts) {
    opts = opts || {};
    const s = getStreamData();
    if (!s.live || isGeneratingStream) return;
    const hosts = getStreamHosts();   // เฉพาะ AI (ไม่รวมเรา)
    if (!hosts.length) return;        // ไม่มีสตรีมเมอร์ AI (เช่นเราไลฟ์คนเดียว)
    const you = getUserName();
    // เลือกผู้พูดรอบนี้: แตะรูป = คนนั้น · เปิดไลฟ์ = คนเดียว · หลายคน = 2 คนสลับกันพูด (ได้หลายฟองใน 1 การเจน)
    let speakers;
    if (opts.host && hosts.some((h) => h.toLowerCase() === String(opts.host).toLowerCase())) {
        speakers = [hosts.find((h) => h.toLowerCase() === String(opts.host).toLowerCase())];
    } else if (hosts.length > 1 && kind !== "open") {
        const first = nextStreamHost(hosts);
        const fi = hosts.findIndex((h) => h.toLowerCase() === first.toLowerCase());
        const second = hosts[(fi + 1) % hosts.length];
        speakers = (second && second.toLowerCase() !== first.toLowerCase()) ? [first, second] : [first];
    } else {
        speakers = [hosts.length > 1 ? nextStreamHost(hosts) : hosts[0]];
    }
    isGeneratingStream = true;
    $("#tinyfeed-stream-speak").addClass("tinyfeed-generating").prop("disabled", true);   // ไอคอนหมุนบอกว่ากำลังเจน
    try {
        // รวมโดเนทเข้า transcript ด้วย (สตรีมเมอร์จะได้เห็นข้อความ+ยอดโดเนท แล้วขอบคุณ/ตอบได้)
        const transcript = s.comments.slice(-8).filter((c) => !c.isSystem)
            .map((c) => {
                if (c.isDonation) return `${c.author} (โดเนท ${formatMoney(c.amount)}): ${htmlToPlain(c.text) || "(ไม่มีข้อความ)"}`;
                return `${c.isStreamer ? c.author + " (สตรีมเมอร์)" : c.author}: ${htmlToPlain(c.text)}`;
            }).join("\n");
        const taskText = kind === "open"
            ? `เพิ่งเปิดไลฟ์ — ทักทายผู้ชมและเกริ่นสั้นๆ ว่าจะไลฟ์เรื่องอะไร`
            : kind === "reply"
                ? `อ่านคอมเมนต์/โดเนทล่าสุดของผู้ชม (โดยเฉพาะของ ${you}) แล้วโต้ตอบ/ตอบกลับ/ขอบคุณคนโดเนทแบบอ่านแชตสดๆ`
                : `พูดคุย/เล่าเรื่องต่อเกี่ยวกับหัวข้อไลฟ์ ให้ต่อเนื่องเป็นธรรมชาติ`;
        const extra = String(getSetting("streamExtraPrompt") || "").trim();
        const extraLine = (extra ? ` คำสั่งเพิ่มเติม: ${extra}.` : "") + galleryPromptBlock();
        const transcriptLine = transcript ? `\nแชตล่าสุด:\n${transcript}\n` : "";

        const spoken = [];   // ชื่อผู้ที่พูดจริงในรอบนี้ (สำหรับ lastSpeaker)
        const pushSpeak = (author, escapedHtml) => {
            s.comments.push({ isStreamer: true, author, text: escapedHtml, ts: Date.now() });
            spoken.push(author);
        };

        if (speakers.length === 1) {
            const speaker = speakers[0];
            const others = hosts.filter((h) => h.toLowerCase() !== speaker.toLowerCase());
            if (userIsHost() && !streamerIsUser()) others.push(you);
            const coLine = others.length
                ? ` คุณกำลังไลฟ์ร่วมกับ: ${others.join(", ")} — พูดในนามของ ${speaker} เท่านั้น จะทัก/โต้ตอบคนอื่นก็ได้ แต่ห้ามพูดแทน ${you}.`
                : "";
            const q = buildPrompt("streamerSpeak", {
                streamer: speaker, title: s.title,
                direction: (s.direction ? ` แนวทางไลฟ์: ${s.direction}.` : "") + coLine,
                task: " " + taskText + ".",
                extra: extraLine,
                context: crossAppContext("stream"),
                transcript: transcriptLine,
            });
            const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("streamTokens"), 10) || 300), "stream");
            let line = stripWrapBrackets(stripReasoning(raw).trim());
            const esc = speaker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            line = line.replace(new RegExp(`^${esc}\\s*[:：]\\s*`, "i"), "").trim();
            if (line) pushSpeak(speaker, escapeHtml(line));
        } else {
            // หลายผู้พูดใน 1 การเจน → รูปแบบ SPEAK: ชื่อ | คำพูด
            const userCoLine = (userIsHost() && !streamerIsUser()) ? ` ห้ามพูดแทน ${you}.` : "";
            const q =
                `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง ไม่ต้องเล่าเป็นบทบรรยาย] กำลังไลฟ์สดหัวข้อ "${s.title}"` +
                (s.direction ? ` แนวทางไลฟ์: ${s.direction}.` : ".") +
                ` ให้สตรีมเมอร์เหล่านี้สลับกันพูดสั้นๆ ในไลฟ์ พูดคุย/โต้ตอบกันได้: ${speakers.join(", ")}. ${taskText}.${userCoLine}` +
                extraLine +
                crossAppContext("stream") +
                transcriptLine +
                `\nตอบเป็นบรรทัด รูปแบบ: SPEAK: <ชื่อผู้พูด> | <คำพูด> — 1 บรรทัดต่อ 1 คำพูด รวมไม่เกิน ${speakers.length} บรรทัด ใช้เฉพาะชื่อที่ระบุเท่านั้น`;
            const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("streamTokens"), 10) || 300), "stream");
            const parsed = parseCommentLines(raw, speakers[0], "SPEAK");   // c.text ถูก escape แล้ว
            let idx = 0;
            for (const c of parsed) {
                const match = hosts.find((h) => h.toLowerCase() === String(c.author).trim().toLowerCase());
                const author = match || speakers[idx % speakers.length];
                const text = stripWrapBrackets(String(c.text || "").trim());
                if (text) { pushSpeak(author, text); idx++; }
            }
            // parse ไม่ได้เลย → ให้คนแรกพูด 1 บรรทัดจากข้อความดิบ
            if (!spoken.length) {
                const line = stripWrapBrackets(stripReasoning(raw).trim());
                if (line) pushSpeak(speakers[0], escapeHtml(line));
            }
        }

        if (spoken.length) {
            s.lastSpeaker = spoken[spoken.length - 1];   // จำไว้เพื่อวนเวียนคนถัดไป
            saveFeedData();
            renderStream();
        } else if (!opts.silent) {
            toastr.info("สตรีมเมอร์ยังไม่พูดอะไร ลองใหม่นะ", "TinyStream");
        }
    } catch (e) {
        console.error(`[${extensionName}] streamerSpeak failed:`, e);
        if (!opts.silent) toastr.error("สตรีมเมอร์พูดไม่สำเร็จ", "TinyStream");
    } finally {
        isGeneratingStream = false;
        $("#tinyfeed-stream-speak").removeClass("tinyfeed-generating").prop("disabled", false);
    }
}


// เติมหัวข้อไลฟ์ให้ช่อง input ด้วย AI (ปุ่มในฟอร์มเริ่มไลฟ์)
async function fillStreamAiTitle() {
    if (isGeneratingStream) return;
    if (!getCurrentCharacter()) { toastr.info("เปิดแชทที่มีตัวละครก่อนนะ", "TinyStream"); return; }
    const streamer = getStreamer();
    const direction = String($("#tinyfeed-stream-direction-input").val() || "").trim();
    isGeneratingStream = true;
    const btn = $("#tinyfeed-stream-ai-title");
    btn.addClass("tinyfeed-generating").prop("disabled", true);
    try {
        const q = `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] ${streamer.name} กำลังจะไลฟ์สด ` +
            (direction ? `แนวทางไลฟ์: ${direction}. ` : "") +
            `ตั้งหัวข้อไลฟ์สั้นๆ 1 บรรทัดให้เข้ากับสถานการณ์ในเนื้อเรื่อง ใช้ภาษาเดียวกับเนื้อเรื่อง ตอบเฉพาะหัวข้อ ไม่ต้องมีอย่างอื่น`;
        const raw = await tinyGenerate(q, 60, "stream");
        const t = stripReasoning(raw).split("\n")[0].replace(/^["'“”]+|["'“”]+$/g, "").trim();
        if (t) $("#tinyfeed-stream-title-input").val(t);
    } catch (e) {
        console.error(`[${extensionName}] ai title failed:`, e);
        toastr.error("ตั้งหัวข้อไม่สำเร็จ ลองใหม่นะ", "TinyStream");
    } finally {
        isGeneratingStream = false;
        btn.removeClass("tinyfeed-generating").prop("disabled", false);
    }
}

// ปุ่ม "ให้สตรีมเมอร์พูด" — ถ้ามีคอมเมนต์ผู้ใช้ค้าง = ตอบ, ไม่งั้น = เล่าเรื่อง
function streamerSpeakButton() {
    if (!getStreamData().live) return;
    streamerSpeak(streamSpeakKind(), {});   // วนเวียนผู้พูดให้เอง
}

async function sendStreamComment(text) {
    const clean = String(text || "").trim();
    const s = getStreamData();
    if (!clean || !s.live) return;
    s.comments.push({ author: getUserName(), isUser: true, text: escapeHtml(clean), ts: Date.now() });
    saveFeedData();
    $("#tinyfeed-stream-input").val("");
    renderStream();
    // สตรีมเมอร์ (ตัวละคร) อ่านคอมเมนต์เราแล้วตอบ (auto) — ข้ามถ้าเราเป็นสตรีมเมอร์เอง
    if (getSetting("streamStreamerReply") && !streamerIsUser()) {
        await streamerSpeak("reply", { silent: true });
    }
    // โหมด onupdate: คอมเมนต์เราทำให้ผู้ชมรีแอคต่อ
    if (getSetting("streamCommentMode") === "onupdate") {
        await loadLiveComments({ silent: true });
    }
}

// เราเป็นสตรีมเมอร์เอง — พิมพ์คำพูดของสตรีมเมอร์เอง (ไม่ใช้ AI)
async function sendStreamerLine(text) {
    const clean = String(text || "").trim();
    const s = getStreamData();
    if (!clean || !s.live || !userIsHost()) return;
    s.comments.push({ isStreamer: true, author: getUserName(), text: escapeHtml(clean), ts: Date.now() });
    saveFeedData();
    $("#tinyfeed-stream-streamer-input").val("");
    renderStream();
    // โหมด onupdate: คำพูดสตรีมเมอร์ทำให้ผู้ชมรีแอค
    if (getSetting("streamCommentMode") === "onupdate") {
        await loadLiveComments({ silent: true });
    }
}

// ── ผู้ชมโดเนทให้สตรีมเมอร์ (หักจาก TinyBank) ──
function openDonateModal() {
    const s = getStreamData();
    if (!s.live || userIsHost()) return;
    $("#tinyfeed-donate-amount, #tinyfeed-donate-note").val("");
    $("#tinyfeed-donate-to").text(getStreamer().name || "สตรีมเมอร์");
    $("#tinyfeed-donate-balance").text(formatMoney(getBankData().balance));
    $("#tinyfeed-donate-modal").removeClass("tinyfeed-hidden");
    setTimeout(() => $("#tinyfeed-donate-amount").trigger("focus"), 30);
}
function closeDonateModal() { $("#tinyfeed-donate-modal").addClass("tinyfeed-hidden"); }

async function sendUserDonate() {
    const s = getStreamData();
    if (!s.live || userIsHost()) return;
    const amt = parseInt($("#tinyfeed-donate-amount").val(), 10);
    const note = String($("#tinyfeed-donate-note").val() || "").trim();
    if (!Number.isFinite(amt) || amt <= 0) { toastr.info("ใส่จำนวนเงินก่อนนะ", "TinyStream"); return; }
    const streamerName = getStreamer().name || "สตรีมเมอร์";
    if (!bankDeduct(amt, `โดเนทให้ ${streamerName}`, "stream")) return;   // ยอดไม่พอ → toast ในตัว
    s.comments.push({ isDonation: true, isUser: true, author: getUserName(), amount: amt, text: escapeHtml(note), ts: Date.now() });
    saveFeedData();
    closeDonateModal();
    renderStream();
    // สตรีมเมอร์ (ตัวละคร) ขอบคุณ/รีแอคโดเนท (ถ้าเปิดให้ตอบ และมีสตรีมเมอร์ AI)
    if (getSetting("streamStreamerReply") && !streamerIsUser()) {
        await streamerSpeak("reply", { silent: true });
    }
}

// ลบไลฟ์ที่จบแล้ว (เคลียร์คอมเมนต์/หัวข้อ เริ่มใหม่ได้) — คงค่าสตรีมเมอร์หลัก/ตัวร่วมไว้
function clearEndedStream() {
    const s = getStreamData();
    if (s.live) return;
    if (!confirm("ลบไลฟ์นี้ (คอมเมนต์ + หัวข้อทั้งหมด) ใช่ไหม?")) return;
    s.comments = [];
    s.title = "";
    s.direction = "";
    s.viewers = 0;
    s.lastSpeaker = "";
    saveFeedData();
    renderStream();
    toastr.success("ลบไลฟ์เก่าแล้ว", "TinyStream");
}

// ===== TinyBank: ธนาคาร/การเงิน (ผูกกับแชท) =====
function getBankData() {
    const data = getFeedData();
    if (!data.bank || typeof data.bank !== "object") data.bank = { balance: 0, txns: [] };
    if (typeof data.bank.balance !== "number" || !isFinite(data.bank.balance)) data.bank.balance = 0;
    if (!Array.isArray(data.bank.txns)) data.bank.txns = [];
    return data.bank;
}

function formatMoney(n) {
    const cur = getSetting("bankCurrency") || "฿";
    const num = Number(n || 0).toLocaleString();
    return getSetting("bankCurrencyAfter") ? `${num}${cur}` : `${cur}${num}`;
}

// แกนธุรกรรม: dir "in" = เงินเข้า, "out" = เงินออก · app = แหล่งที่มา (bank/stream/connect/shop)
// คืน true ถ้าสำเร็จ · opts.silentToast = ไม่เด้ง toast ยอดไม่พอ
function bankTxn(dir, amount, label, app, opts) {
    opts = opts || {};
    const amt = Math.abs(Math.round(Number(amount) || 0));
    if (!amt) return false;
    const b = getBankData();
    if (dir === "out" && amt > b.balance) {
        if (!opts.silentToast) toastr.warning("ยอดเงินไม่พอ", "TinyBank");
        return false;
    }
    b.balance += dir === "in" ? amt : -amt;
    b.txns.unshift({
        id: "tx" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        dir, amount: amt, label: String(label || ""), app: app || "bank", ts: Date.now(),
    });
    if (b.txns.length > 200) b.txns.length = 200;
    saveFeedData();
    if (currentApp === "bank") renderBank();
    return true;
}
function bankAdd(amount, label, app, opts) { return bankTxn("in", amount, label, app, opts); }
function bankDeduct(amount, label, app, opts) { return bankTxn("out", amount, label, app, opts); }

// ไอคอน + ป้ายชื่อแอปต้นทางของธุรกรรม
function bankTxnMeta(app) {
    switch (app) {
        case "stream": return { icon: "fa-video", name: "TinyStream" };
        case "connect": return { icon: "fa-comment-dots", name: "TinyConnect" };
        case "shop": return { icon: "fa-bag-shopping", name: "ร้านค้า" };
        default: return { icon: "fa-wallet", name: "ธนาคาร" };
    }
}

function renderBank() {
    const b = getBankData();
    $("#tinyfeed-bank-balance").text(formatMoney(b.balance));
    if (!b.txns.length) {
        $("#tinyfeed-bank-txns").html(emptyStateHtml("fa-receipt", "ยังไม่มีธุรกรรม", "เติมเงิน/จ่ายเงินเอง หรือรับโดเนทจากไลฟ์"));
        return;
    }
    $("#tinyfeed-bank-txns").html(b.txns.map((t) => {
        const m = bankTxnMeta(t.app);
        const sign = t.dir === "in" ? "+" : "−";
        return `<div class="tinyfeed-bank-txn">
            <div class="tinyfeed-bank-txn-icon tinyfeed-bank-${t.dir}"><i class="fa-solid ${m.icon}"></i></div>
            <div class="tinyfeed-bank-txn-body">
                <div class="tinyfeed-bank-txn-label">${escapeText(t.label || (t.dir === "in" ? "เงินเข้า" : "เงินออก"))}</div>
                <div class="tinyfeed-bank-txn-sub">${m.name} · ${timeAgo(t.ts)}</div>
            </div>
            <div class="tinyfeed-bank-txn-amt tinyfeed-bank-${t.dir}">${sign}${formatMoney(t.amount)}</div>
        </div>`;
    }).join(""));
}

// ปุ่มเติม/จ่ายเงินเอง (อ่านจากฟอร์มในแอป)
function bankManualTxn(dir) {
    const amt = parseInt($("#tinyfeed-bank-amount").val(), 10);
    const label = String($("#tinyfeed-bank-label").val() || "").trim();
    if (!Number.isFinite(amt) || amt <= 0) { toastr.info("ใส่จำนวนเงินก่อนนะ", "TinyBank"); return; }
    const ok = bankTxn(dir, amt, label || (dir === "in" ? "เติมเงิน" : "จ่ายเงิน"), "bank");
    if (ok) {
        $("#tinyfeed-bank-amount, #tinyfeed-bank-label").val("");
    }
}

// ===== TinyShop: ร้านค้า (แคตตาล็อก global, ยอดซื้อผูกกับแชท) =====
function getShop() {
    const store = extension_settings[extensionName] || {};
    if (!Array.isArray(store.shop)) { store.shop = []; setSetting("shop", store.shop); }
    return store.shop;
}
function saveShop() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    extension_settings[extensionName].shop = getShop();
    saveSettingsDebounced();
}
function getShopOwned() {
    const data = getFeedData();
    if (!data.shopOwned || typeof data.shopOwned !== "object") data.shopOwned = {};
    return data.shopOwned;
}
function shopId() { return "sh" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
// หมวดสินค้า (global setting) — คล้ายห้องของ TinyForum · คืน "ดิบ" (รวมช่องว่าง) ให้ตัวแก้ในตั้งค่าทำงานได้
function getShopCategories() {
    const c = getSetting("shopCategories");
    if (!Array.isArray(c)) return defaultSettings.shopCategories.slice();
    return c.map((x) => String(x == null ? "" : x));
}
// เฉพาะหมวดที่มีชื่อจริง (สำหรับ chip bar / select / prompt)
function shopCatsClean() { return getShopCategories().map((x) => x.trim()).filter(Boolean); }
let shopFilterCat = "__all__";   // หมวดที่กรองอยู่ในแอป
let shopEditId = null;           // id สินค้าที่กำลังแก้ไข
let isShopBusy = false;          // กัน AI สร้างสินค้าซ้อน

// แถบชิปหมวด: "ทั้งหมด" + แต่ละหมวด
function renderShopCatBar() {
    const cats = shopCatsClean();
    const chip = (val, label) => `<div class="tinyfeed-shop-cat-chip${shopFilterCat === val ? " tinyfeed-shop-cat-chip-active" : ""}" data-cat="${escapeAttr(val)}">${escapeText(label)}</div>`;
    $("#tinyfeed-shop-catbar").html(chip("__all__", "ทั้งหมด") + cats.map((c) => chip(c, c)).join(""));
}
// เติม <select> หมวด (add form / edit modal) คงค่าที่เลือกไว้ถ้ายังมี
function fillShopCatSelect($sel, keep) {
    const cats = shopCatsClean();
    const cur = keep != null ? keep : $sel.val();
    $sel.html(`<option value="">— ไม่ระบุหมวด —</option>` + cats.map((c) => `<option value="${escapeAttr(c)}">${escapeText(c)}</option>`).join(""));
    if (cur && cats.includes(cur)) $sel.val(cur);
}
// thumbnail: รูป > อิโมจิ > ไอคอนกล่อง
function shopThumbHtml(it) {
    if (it.image) return `<img class="tinyfeed-shop-thumb" src="${escapeAttr(it.image)}" alt="${escapeText(it.name)}" onerror="this.classList.add('tinyfeed-img-broken')" />`;
    if (it.emoji) return `<div class="tinyfeed-shop-thumb tinyfeed-shop-emoji-thumb">${escapeText(it.emoji)}</div>`;
    return `<div class="tinyfeed-shop-thumb tinyfeed-shop-noimg"><i class="fa-solid fa-box"></i></div>`;
}

function renderShop() {
    $("#tinyfeed-shop-balance").text(formatMoney(getBankData().balance));
    fillShopCatSelect($("#tinyfeed-shop-cat"));
    // กรองหมวดที่หายไปแล้ว
    if (shopFilterCat !== "__all__" && !shopCatsClean().includes(shopFilterCat)) shopFilterCat = "__all__";
    renderShopCatBar();
    const owned = getShopOwned();
    let items = getShop();
    if (shopFilterCat !== "__all__") items = items.filter((it) => (it.cat || "") === shopFilterCat);
    if (!items.length) {
        $("#tinyfeed-shop-grid").html(emptyStateHtml("fa-bag-shopping", "ยังไม่มีสินค้า",
            shopFilterCat === "__all__" ? 'เพิ่มเอง หรือกด "ให้ AI สร้างสินค้า"' : "หมวดนี้ยังไม่มีสินค้า"));
        return;
    }
    $("#tinyfeed-shop-grid").html(items.map((it) => {
        const n = owned[it.id] || 0;
        return `<div class="tinyfeed-shop-item" data-id="${escapeAttr(it.id)}">
            <div class="tinyfeed-shop-thumb-wrap">
                ${shopThumbHtml(it)}
                ${n ? `<span class="tinyfeed-shop-owned">มี ${n}</span>` : ""}
                <span class="tinyfeed-shop-edit" title="แก้ไขสินค้า"><i class="fa-solid fa-pen"></i></span>
                <span class="tinyfeed-shop-del" title="ลบสินค้า"><i class="fa-solid fa-trash"></i></span>
            </div>
            <div class="tinyfeed-shop-name">${escapeText(it.name)}</div>
            ${it.cat ? `<div class="tinyfeed-shop-cat-tag">${escapeText(it.cat)}</div>` : ""}
            ${it.desc ? `<div class="tinyfeed-shop-desc">${escapeText(it.desc)}</div>` : ""}
            <button class="tinyfeed-shop-buy tinyfeed-btn-primary" data-id="${escapeAttr(it.id)}">${formatMoney(it.price)}</button>
        </div>`;
    }).join(""));
}

function addShopItem() {
    const name = String($("#tinyfeed-shop-name").val() || "").trim();
    const price = parseInt($("#tinyfeed-shop-price").val(), 10);
    const image = String($("#tinyfeed-shop-image").val() || "").trim();
    const emoji = String($("#tinyfeed-shop-emoji").val() || "").trim().slice(0, 4);
    const desc = String($("#tinyfeed-shop-desc").val() || "").trim();
    const cat = String($("#tinyfeed-shop-cat").val() || "").trim();
    if (!name) { toastr.info("ตั้งชื่อสินค้าก่อนนะ", "TinyShop"); return; }
    if (!Number.isFinite(price) || price <= 0) { toastr.info("ใส่ราคาสินค้าก่อนนะ", "TinyShop"); return; }
    getShop().push({ id: shopId(), name, price, image, emoji, desc, cat });
    saveShop();
    $("#tinyfeed-shop-name, #tinyfeed-shop-price, #tinyfeed-shop-image, #tinyfeed-shop-emoji, #tinyfeed-shop-desc").val("");
    renderShop();
    toastr.success(`เพิ่มสินค้า "${name}" แล้ว`, "TinyShop");
}
// แก้ไขสินค้า (ใส่รูป/อิโมจิ/หมวด/รายละเอียด)
function openShopEdit(id) {
    const it = getShop().find((x) => String(x.id) === String(id));
    if (!it) return;
    shopEditId = String(id);
    $("#tinyfeed-shop-edit-name").val(it.name || "");
    $("#tinyfeed-shop-edit-price").val(it.price || "");
    $("#tinyfeed-shop-edit-image").val(it.image || "");
    $("#tinyfeed-shop-edit-emoji").val(it.emoji || "");
    fillShopCatSelect($("#tinyfeed-shop-edit-cat"), it.cat || "");
    $("#tinyfeed-shop-edit-desc").val(it.desc || "");
    $("#tinyfeed-shop-edit-modal").removeClass("tinyfeed-hidden");
}
function closeShopEditModal() { $("#tinyfeed-shop-edit-modal").addClass("tinyfeed-hidden"); shopEditId = null; }
function saveShopEdit() {
    const it = getShop().find((x) => String(x.id) === String(shopEditId));
    if (!it) { closeShopEditModal(); return; }
    const name = String($("#tinyfeed-shop-edit-name").val() || "").trim();
    const price = parseInt($("#tinyfeed-shop-edit-price").val(), 10);
    if (!name) { toastr.info("ตั้งชื่อสินค้าก่อนนะ", "TinyShop"); return; }
    if (!Number.isFinite(price) || price <= 0) { toastr.info("ใส่ราคาสินค้าก่อนนะ", "TinyShop"); return; }
    it.name = name;
    it.price = price;
    it.image = String($("#tinyfeed-shop-edit-image").val() || "").trim();
    it.emoji = String($("#tinyfeed-shop-edit-emoji").val() || "").trim().slice(0, 4);
    it.cat = String($("#tinyfeed-shop-edit-cat").val() || "").trim();
    it.desc = String($("#tinyfeed-shop-edit-desc").val() || "").trim();
    saveShop();
    closeShopEditModal();
    renderShop();
    toastr.success("บันทึกแล้ว", "TinyShop");
}
// AI สร้างสินค้าเข้ากับโลกของเนื้อเรื่อง
async function generateShopItems(opts) {
    opts = opts || {};
    if (isShopBusy) return;
    const ctx = getContext();
    if (typeof ctx.generateQuietPrompt !== "function") { if (!opts.silent) toastr.error("เวอร์ชัน ST นี้ไม่มี generateQuietPrompt", "TinyShop"); return; }
    if (!getCurrentCharacter()) { if (!opts.silent) toastr.info("เปิดแชทที่มีตัวละครก่อนนะ", "TinyShop"); return; }
    isShopBusy = true;
    const btn = $("#tinyfeed-shop-generate");
    btn.addClass("tinyfeed-generating").prop("disabled", true);
    try {
        const cats = shopCatsClean();
        const extra = String(getSetting("shopExtraPrompt") || "").trim();
        const q = buildPrompt("shopItems", {
            cats: cats.join(", "),
            extra: extra ? `คำสั่งเพิ่มเติม: ${extra}. ` : "",
            context: crossAppContext("shop"),
        });
        const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("shopTokens"), 10) || 400), "shop");
        const added = parseShopItems(raw, cats);
        if (!added) { if (!opts.silent) toastr.warning("AI ไม่ได้ส่งสินค้ากลับมา ลองใหม่นะ", "TinyShop"); return; }
        saveShop();
        renderShop();
        if (!opts.silent) toastr.success(`AI สร้างสินค้า ${added} ชิ้นแล้ว`, "TinyShop");
    } catch (e) {
        console.error(`[${extensionName}] generate shop items failed:`, e);
        if (!opts.silent) toastr.error("สร้างสินค้าไม่สำเร็จ ลองใหม่นะ", "TinyShop");
    } finally {
        isShopBusy = false;
        btn.removeClass("tinyfeed-generating").prop("disabled", false);
    }
}
// ITEM: ชื่อ | ราคา | หมวด | อิโมจิ | รายละเอียด  (คืนจำนวนที่เพิ่ม)
function parseShopItems(raw, cats) {
    const s = stripReasoning(raw);
    const lowerCats = cats.map((c) => c.toLowerCase());
    const re = /ITEM:\s*(.+)/gi;
    let m, count = 0;
    while ((m = re.exec(s)) !== null) {
        const parts = m[1].split("|").map((x) => x.trim());
        const name = (parts[0] || "").replace(/^["'“”\[\(]+|["'“”\]\)]+$/g, "").trim();
        const price = Math.abs(Math.round(parseFloat(String(parts[1] || "").replace(/[^\d.]/g, "")) || 0));
        let cat = (parts[2] || "").trim();
        const emoji = (parts[3] || "").trim().slice(0, 4);
        const desc = (parts[4] || "").trim();
        if (!name || !price) continue;
        if (!lowerCats.includes(cat.toLowerCase())) cat = cats[0] || "";
        getShop().push({ id: shopId(), name, price, image: "", emoji, desc, food: 0, cat });
        count++;
    }
    return count;
}
function deleteShopItem(id) {
    const shop = getShop();
    const i = shop.findIndex((x) => String(x.id) === String(id));
    if (i < 0) return;
    shop.splice(i, 1);
    saveShop();
    renderShop();
}
function buyShopItem(id) {
    const it = getShop().find((x) => String(x.id) === String(id));
    if (!it) return;
    if (!bankDeduct(it.price, `ซื้อ ${it.name}`, "shop")) return;   // ยอดไม่พอ → toast ในตัว
    const owned = getShopOwned();
    owned[id] = (owned[id] || 0) + 1;
    saveFeedData();
    renderShop();
    toastr.success(`ซื้อ "${it.name}" แล้ว`, "TinyShop");
}

// ===== TinyGallery: คลังรูป + สติกเกอร์ (global, ไม่ผูกกับแชท) =====
let galleryTab = "images";        // "images" | "stickers"
let galleryPickTarget = null;     // { kind, onPick } ตอนเปิด picker เลือกมาส่ง

function galleryId() {
    return "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function openGallery() {
    renderGalleryAlbums();
    switchGalleryTab(galleryTab);
}

function switchGalleryTab(tab) {
    galleryTab = tab === "stickers" ? "stickers" : "images";
    $(".tinyfeed-tab[data-gtab]").removeClass("tinyfeed-tab-active");
    $(`.tinyfeed-tab[data-gtab="${galleryTab}"]`).addClass("tinyfeed-tab-active");
    $("#tinyfeed-gallery-panel-images").toggleClass("tinyfeed-hidden", galleryTab !== "images");
    $("#tinyfeed-gallery-panel-stickers").toggleClass("tinyfeed-hidden", galleryTab !== "stickers");
    renderGalleryGrid(galleryTab === "stickers" ? "sticker" : "image");
}

// เติม dropdown อัลบั้ม (คงค่าที่เลือกไว้ถ้ายังมีอยู่)
function fillAlbumSelect($sel, albums, keep) {
    const cur = keep != null ? keep : $sel.val();
    $sel.html(albums.map((a) => `<option value="${escapeAttr(a)}">${escapeText(a)}</option>`).join(""));
    if (cur && albums.includes(cur)) $sel.val(cur);
}

function renderGalleryAlbums() {
    const g = getGallery();
    fillAlbumSelect($("#tinyfeed-gallery-img-album"), g.imageAlbums);
    fillAlbumSelect($("#tinyfeed-gallery-stk-album"), g.stickerAlbums);
}

// อัลบั้มที่กำลังเลือกในแท็บนั้น
function currentAlbum(kind) {
    const sel = kind === "sticker" ? "#tinyfeed-gallery-stk-album" : "#tinyfeed-gallery-img-album";
    return String($(sel).val() || "ทั่วไป");
}

function renderGalleryGrid(kind) {
    const g = getGallery();
    const album = currentAlbum(kind);
    const list = (kind === "sticker" ? g.stickers : g.images).filter((it) => (it.album || "ทั่วไป") === album);
    const gridSel = kind === "sticker" ? "#tinyfeed-gallery-stk-grid" : "#tinyfeed-gallery-img-grid";
    if (!list.length) {
        $(gridSel).html(emptyInlineHtml(`ยังไม่มี${kind === "sticker" ? "สติกเกอร์" : "รูป"}ในอัลบั้มนี้ · เพิ่มด้านบนได้เลย`));
        return;
    }
    $(gridSel).html(list.map((it) => `
        <div class="tinyfeed-gallery-item" data-kind="${kind}" data-id="${escapeAttr(it.id)}">
            <div class="tinyfeed-gallery-thumb-wrap">
                <img class="tinyfeed-gallery-thumb" src="${escapeAttr(it.url)}" alt="${escapeText(it.name)}" onerror="this.classList.add('tinyfeed-img-broken')" />
                <span class="tinyfeed-gallery-item-actions">
                    <span class="tinyfeed-gallery-item-edit" title="แก้ไข/ย้ายอัลบั้ม"><i class="fa-solid fa-pen"></i></span>
                    <span class="tinyfeed-gallery-item-del" title="ลบ"><i class="fa-solid fa-trash"></i></span>
                </span>
            </div>
            <div class="tinyfeed-gallery-item-name">${escapeText(it.name)}</div>
        </div>
    `).join(""));
}

function addGalleryImage() {
    const url = String($("#tinyfeed-gallery-img-url").val() || "").trim();
    const caption = String($("#tinyfeed-gallery-img-caption").val() || "").trim();
    const name = String($("#tinyfeed-gallery-img-name").val() || "").trim();
    if (!url) { toastr.info("ใส่ลิงก์รูปก่อนนะ", "TinyGallery"); return; }
    const g = getGallery();
    const finalName = name || `รูป-${g.images.length + 1}`;
    if (g.images.some((im) => String(im.name).trim().toLowerCase() === finalName.toLowerCase())) {
        toastr.info("มีชื่อนี้อยู่แล้ว ตั้งชื่ออื่นนะ (ชื่อใช้อ้างอิงตอนส่ง)", "TinyGallery"); return;
    }
    g.images.push({ id: galleryId(), url, caption, name: finalName, album: currentAlbum("image"), ts: Date.now() });
    saveGallery();
    $("#tinyfeed-gallery-img-url, #tinyfeed-gallery-img-caption, #tinyfeed-gallery-img-name").val("");
    renderGalleryGrid("image");
    toastr.success(`เพิ่มรูป "${finalName}" แล้ว`, "TinyGallery");
}

function addGallerySticker() {
    const url = String($("#tinyfeed-gallery-stk-url").val() || "").trim();
    const name = String($("#tinyfeed-gallery-stk-name").val() || "").trim();
    if (!url) { toastr.info("ใส่ลิงก์สติกเกอร์ก่อนนะ", "TinyGallery"); return; }
    const g = getGallery();
    const finalName = name || `สติกเกอร์-${g.stickers.length + 1}`;
    if (g.stickers.some((s) => String(s.name).trim().toLowerCase() === finalName.toLowerCase())) {
        toastr.info("มีชื่อนี้อยู่แล้ว ตั้งชื่ออื่นนะ (ชื่อใช้อ้างอิงตอนส่ง)", "TinyGallery"); return;
    }
    g.stickers.push({ id: galleryId(), url, name: finalName, album: currentAlbum("sticker"), ts: Date.now() });
    saveGallery();
    $("#tinyfeed-gallery-stk-url, #tinyfeed-gallery-stk-name").val("");
    renderGalleryGrid("sticker");
    toastr.success(`เพิ่มสติกเกอร์ "${finalName}" แล้ว`, "TinyGallery");
}

function addGalleryAlbum(kind) {
    const g = getGallery();
    const arr = kind === "sticker" ? g.stickerAlbums : g.imageAlbums;
    const name = String(window.prompt("ชื่ออัลบั้มใหม่:", "") || "").trim();
    if (!name) return;
    if (arr.some((a) => a.trim().toLowerCase() === name.toLowerCase())) {
        toastr.info("มีอัลบั้มชื่อนี้แล้ว", "TinyGallery"); return;
    }
    arr.push(name);
    saveGallery();
    renderGalleryAlbums();
    $(kind === "sticker" ? "#tinyfeed-gallery-stk-album" : "#tinyfeed-gallery-img-album").val(name);
    renderGalleryGrid(kind);
}

function deleteGalleryAlbum(kind) {
    const g = getGallery();
    const arr = kind === "sticker" ? g.stickerAlbums : g.imageAlbums;
    const album = currentAlbum(kind);
    if (album === "ทั่วไป") { toastr.info("ลบอัลบั้ม 'ทั่วไป' ไม่ได้", "TinyGallery"); return; }
    if (arr.length <= 1) { toastr.info("ต้องเหลืออัลบั้มอย่างน้อย 1 อัน", "TinyGallery"); return; }
    if (!window.confirm(`ลบอัลบั้ม "${album}"? รายการในนั้นจะย้ายไปอัลบั้ม 'ทั่วไป'`)) return;
    const items = kind === "sticker" ? g.stickers : g.images;
    items.forEach((it) => { if ((it.album || "ทั่วไป") === album) it.album = "ทั่วไป"; });
    const idx = arr.indexOf(album);
    if (idx >= 0) arr.splice(idx, 1);
    saveGallery();
    renderGalleryAlbums();
    $(kind === "sticker" ? "#tinyfeed-gallery-stk-album" : "#tinyfeed-gallery-img-album").val("ทั่วไป");
    renderGalleryGrid(kind);
}

function deleteGalleryItem(kind, id) {
    const g = getGallery();
    const arr = kind === "sticker" ? g.stickers : g.images;
    const idx = arr.findIndex((it) => String(it.id) === String(id));
    if (idx < 0) return;
    arr.splice(idx, 1);
    saveGallery();
    renderGalleryGrid(kind);
}

// หาไอเท็มในคลังตาม kind + id
function getGalleryItem(kind, id) {
    const g = getGallery();
    return (kind === "sticker" ? g.stickers : g.images).find((it) => String(it.id) === String(id)) || null;
}

// ===== ดูรูปเต็ม (lightbox) — โชว์รูปใหญ่ + ชื่อ + คำบรรยาย =====
function openGalleryView(kind, id) {
    const it = getGalleryItem(kind, id);
    if (!it) return;
    $("#tinyfeed-gallery-view-img").removeClass("tinyfeed-img-broken").attr("src", it.url);
    $("#tinyfeed-gallery-view-name").text(it.name || "");
    const cap = kind === "image" ? String(it.caption || "").trim() : "";
    $("#tinyfeed-gallery-view-cap").text(cap).toggleClass("tinyfeed-hidden", !cap);
    $("#tinyfeed-gallery-view").removeClass("tinyfeed-hidden");
}
function closeGalleryView() {
    $("#tinyfeed-gallery-view").addClass("tinyfeed-hidden");
}

// ===== แก้ไขชื่อ/คำบรรยาย + ย้ายอัลบั้ม =====
let galleryEditRef = null;   // { kind, id }
function openGalleryEdit(kind, id) {
    const it = getGalleryItem(kind, id);
    if (!it) return;
    galleryEditRef = { kind, id };
    const g = getGallery();
    const albums = kind === "sticker" ? g.stickerAlbums : g.imageAlbums;
    $("#tinyfeed-gallery-edit-title").text(kind === "sticker" ? "แก้ไขสติกเกอร์" : "แก้ไขรูป");
    $("#tinyfeed-gallery-edit-name").val(it.name || "");
    $("#tinyfeed-gallery-edit-caption").val(it.caption || "");
    $("#tinyfeed-gallery-edit-caption-field").toggleClass("tinyfeed-hidden", kind !== "image");
    fillAlbumSelect($("#tinyfeed-gallery-edit-album"), albums, it.album || "ทั่วไป");
    $("#tinyfeed-gallery-edit").removeClass("tinyfeed-hidden");
}
function closeGalleryEdit() {
    $("#tinyfeed-gallery-edit").addClass("tinyfeed-hidden");
    galleryEditRef = null;
}
function saveGalleryEdit() {
    if (!galleryEditRef) return;
    const { kind, id } = galleryEditRef;
    const it = getGalleryItem(kind, id);
    if (!it) { closeGalleryEdit(); return; }
    const newName = String($("#tinyfeed-gallery-edit-name").val() || "").trim();
    if (!newName) { toastr.info("ตั้งชื่อก่อนนะ", "TinyGallery"); return; }
    const arr = kind === "sticker" ? getGallery().stickers : getGallery().images;
    if (arr.some((x) => x.id !== it.id && String(x.name).trim().toLowerCase() === newName.toLowerCase())) {
        toastr.info("มีชื่อนี้อยู่แล้ว ตั้งชื่ออื่นนะ", "TinyGallery"); return;
    }
    it.name = newName;
    if (kind === "image") it.caption = String($("#tinyfeed-gallery-edit-caption").val() || "").trim();
    it.album = String($("#tinyfeed-gallery-edit-album").val() || "ทั่วไป");
    saveGallery();
    closeGalleryEdit();
    renderGalleryGrid(kind);
    toastr.success("บันทึกแล้ว", "TinyGallery");
}

// ปิด overlay ทั้งหมดของคลัง (picker/ดูรูป/แก้ไข)
function closeGalleryOverlays() {
    closeGalleryPicker();
    closeGalleryView();
    closeGalleryEdit();
}

// ===== ตัวเลือกตัวละคร (กดรูปโปรไฟล์ → เลือก) ใช้ร่วม TinyFeed + TinyStream =====
const POSTER_USER = "__user__";
const POSTER_AUTO = "__auto__";
let charPickTarget = null;   // callback(value) เมื่อเลือก

// สร้างรายการตัวเลือก [{ value, name, node(html avatar) }]
function charPickerItems(opts) {
    opts = opts || {};
    const out = [];
    const exclude = new Set((opts.exclude || []).map(String));
    if (opts.includeUser && !exclude.has(POSTER_USER)) {
        out.push({ value: POSTER_USER, name: getUserName() + " (เรา)", node: makeAvatar({ isUser: true, author: getUserName() }) });
    }
    const char = getCurrentCharacter();
    const mainName = getCharName();
    if (opts.includeMain !== false && char && mainName && !exclude.has(mainName)) {
        out.push({ value: mainName, name: mainName, node: makeAvatar({ isMain: true, author: mainName }) });
    }
    for (const npc of getNpcs()) {
        const nm = String(npc.name || "").trim();
        if (nm && !exclude.has(nm)) out.push({ value: nm, name: nm, node: makeAvatar({ author: nm, avatar: npc.avatar || "" }) });
    }
    // "อัตโนมัติ" อยู่ล่างสุดเสมอ
    if (opts.includeAuto) {
        out.push({ value: POSTER_AUTO, name: "อัตโนมัติ (AI เลือก)", node: `<div class="tinyfeed-avatar tinyfeed-avatar-auto"><i class="fa-solid fa-wand-magic-sparkles"></i></div>` });
    }
    return out;
}

function openCharPicker(opts, onPick) {
    const items = charPickerItems(opts);
    if (!items.length) { toastr.info("ยังไม่มีตัวละคร/NPC ให้เลือก", "TinyPhone"); return; }
    charPickTarget = onPick;
    $("#tinyfeed-char-picker-title").text((opts && opts.title) || "เลือกตัวละคร");
    $("#tinyfeed-char-picker-list").html(items.map((it) => `
        <div class="tinyfeed-char-pick" data-value="${escapeAttr(it.value)}">
            ${it.node}
            <span class="tinyfeed-char-pick-name">${escapeText(it.name)}</span>
        </div>
    `).join(""));
    $("#tinyfeed-char-picker").removeClass("tinyfeed-hidden");
}

function closeCharPicker() {
    $("#tinyfeed-char-picker").addClass("tinyfeed-hidden");
    charPickTarget = null;
}

function pickChar(value) {
    const cb = charPickTarget;
    closeCharPicker();
    if (typeof cb === "function") cb(value);
}

// ===== config: เลือกอัลบั้มที่ให้ AI เข้าถึง (checkbox + แบ่งหน้า) =====
const GALLERY_CFG_PER_PAGE = 8;
let galleryCfgPage = 0;

// รวมชื่ออัลบั้มทั้งรูป + สติกเกอร์ (ไม่ซ้ำ เรียงตามที่พบ)
function allGalleryAlbums() {
    const g = getGallery();
    const seen = new Set();
    const out = [];
    [...g.imageAlbums, ...g.stickerAlbums].forEach((a) => {
        const k = String(a);
        if (!seen.has(k)) { seen.add(k); out.push(k); }
    });
    return out;
}

function renderGalleryCfgAlbums() {
    const scope = getSetting("galleryPromptScope") || "all";
    $("#tinyfeed-cfg-gallery-albums").toggleClass("tinyfeed-hidden", scope !== "selected");
    if (scope !== "selected") return;
    const albums = allGalleryAlbums();
    const selected = new Set((getSetting("galleryAlbums") || []).map((a) => String(a)));
    const pages = Math.max(1, Math.ceil(albums.length / GALLERY_CFG_PER_PAGE));
    galleryCfgPage = Math.min(Math.max(0, galleryCfgPage), pages - 1);
    const start = galleryCfgPage * GALLERY_CFG_PER_PAGE;
    const pageItems = albums.slice(start, start + GALLERY_CFG_PER_PAGE);
    $("#tinyfeed-cfg-gallery-albums-list").html(pageItems.map((a) => `
        <label class="tinyfeed-gallery-cfg-item">
            <input type="checkbox" class="tinyfeed-cfg-gallery-album" value="${escapeAttr(a)}" ${selected.has(a) ? "checked" : ""} />
            <span>${escapeText(a)}</span>
        </label>
    `).join("") || `<span class="tinyfeed-field-hint">ยังไม่มีอัลบั้ม</span>`);
    $("#tinyfeed-cfg-gallery-albums-pager").toggleClass("tinyfeed-hidden", pages <= 1);
    $("#tinyfeed-cfg-gallery-albums-info").text(`${galleryCfgPage + 1}/${pages}`);
}

// ===== Picker: เลือกสติกเกอร์/รูป จากคลังมาส่งในแอปอื่น =====
function openGalleryPicker(kind, onPick) {
    const g = getGallery();
    const items = kind === "sticker" ? g.stickers : g.images;
    if (!items.length) {
        toastr.info(`ยังไม่มี${kind === "sticker" ? "สติกเกอร์" : "รูป"}ในคลัง — เพิ่มที่แอป TinyGallery ก่อนนะ`, "TinyGallery");
        return;
    }
    galleryPickTarget = { kind, onPick };
    $("#tinyfeed-gallery-picker-title").text(kind === "sticker" ? "เลือกสติกเกอร์" : "เลือกรูป");
    const albums = kind === "sticker" ? g.stickerAlbums : g.imageAlbums;
    fillAlbumSelect($("#tinyfeed-gallery-picker-album"), albums, albums[0]);
    renderPickerGrid();
    $("#tinyfeed-gallery-picker").removeClass("tinyfeed-hidden");
}

function renderPickerGrid() {
    if (!galleryPickTarget) return;
    const kind = galleryPickTarget.kind;
    const g = getGallery();
    const album = String($("#tinyfeed-gallery-picker-album").val() || "ทั่วไป");
    const list = (kind === "sticker" ? g.stickers : g.images).filter((it) => (it.album || "ทั่วไป") === album);
    if (!list.length) {
        $("#tinyfeed-gallery-picker-grid").html(emptyInlineHtml("อัลบั้มนี้ว่าง"));
        return;
    }
    $("#tinyfeed-gallery-picker-grid").html(list.map((it) => `
        <div class="tinyfeed-gallery-pick" data-name="${escapeAttr(it.name)}" title="${escapeText(it.name)}">
            <img class="tinyfeed-gallery-thumb" src="${escapeAttr(it.url)}" alt="${escapeText(it.name)}" onerror="this.classList.add('tinyfeed-img-broken')" />
            <div class="tinyfeed-gallery-item-name">${escapeText(it.name)}</div>
        </div>
    `).join(""));
}

function closeGalleryPicker() {
    $("#tinyfeed-gallery-picker").addClass("tinyfeed-hidden");
    galleryPickTarget = null;
}

function pickGalleryItem(name) {
    if (!galleryPickTarget) return;
    const kind = galleryPickTarget.kind;
    const cb = galleryPickTarget.onPick;
    const token = `[${kind === "sticker" ? "sticker" : "img"}:${name}]`;
    closeGalleryPicker();
    if (typeof cb === "function") cb(token, name, kind);
}

// แทรกโทเคนลงช่องพิมพ์ (สำหรับแอปที่พิมพ์ก่อนแล้วค่อยโพสต์ เช่น TinyFeed)
function insertIntoInput(sel, token) {
    const el = $(sel);
    if (!el.length) return;
    const cur = String(el.val() || "");
    const glue = cur && !/\s$/.test(cur) ? " " : "";
    el.val(cur + glue + token + " ").trigger("input").focus();
}

// ===== TinyConnect: แชตสไตล์ไลน์ =====
let activeThread = null;
let activeThreadName = "";
let isConnectReplying = false;

function getConnectData() {
    const data = getFeedData();
    if (!data.connect || typeof data.connect !== "object") data.connect = { threads: {} };
    if (!data.connect.threads) data.connect.threads = {};
    return data.connect;
}

function getThread(key) {
    if (key === "pet") return getPet().dm;   // เพ็ทเก็บห้องแชตแบบ global (ไม่ผูกแชท) → persist ด้วย savePet()
    const c = getConnectData();
    if (!Array.isArray(c.threads[key])) c.threads[key] = [];
    return c.threads[key];
}

// แชตกลุ่ม: [{ id, name, members:[ชื่อ] }]
function getConnectGroups() {
    const c = getConnectData();
    if (!Array.isArray(c.groups)) c.groups = [];
    return c.groups;
}

function findGroup(key) {
    return getConnectGroups().find((g) => "group:" + g.id === key) || null;
}

// เปิด/ปิดฟอร์มสร้างกลุ่ม
function toggleGroupForm(show) {
    const form = $("#tinyfeed-connect-groupform");
    if (!show) { form.addClass("tinyfeed-hidden"); return; }
    const rows = getConnectContacts().map((c) => `
        <label class="tinyfeed-group-member">
            <input type="checkbox" class="tinyfeed-group-check" value="${escapeAttr(c.name)}" />
            <span>${escapeText(c.name)}</span>
        </label>`).join("");
    $("#tinyfeed-group-members").html(rows || `<span class="tinyfeed-field-hint">ยังไม่มีคนให้เลือก</span>`);
    $("#tinyfeed-group-name").val("");
    $("#tinyfeed-group-avatar").val("");
    form.removeClass("tinyfeed-hidden");
}

function createGroup() {
    const name = String($("#tinyfeed-group-name").val() || "").trim();
    const avatar = String($("#tinyfeed-group-avatar").val() || "").trim();
    const members = $(".tinyfeed-group-check:checked").map(function () { return $(this).val(); }).get();
    if (!name) { toastr.info("ตั้งชื่อกลุ่มก่อนนะ", "TinyConnect"); return; }
    if (members.length < 2) { toastr.info("เลือกสมาชิกอย่างน้อย 2 คน", "TinyConnect"); return; }
    getConnectGroups().push({ id: "g" + Date.now(), name, members, avatar });
    saveFeedData();
    toggleGroupForm(false);
    renderConnectList();
}

function deleteGroup(key) {
    const g = findGroup(key);
    if (!g) return;
    if (!confirm(`ลบกลุ่ม "${g.name}" ใช่ไหม?`)) return;
    const c = getConnectData();
    c.groups = getConnectGroups().filter((x) => x.id !== g.id);
    delete c.threads[key];
    saveFeedData();
    renderConnectList();
}

// รายชื่อ contact = ตัวละครหลัก + NPC ประจำ + เพ็ท (global, ถ้ามี)
function getConnectContacts() {
    const contacts = [];
    const char = getCurrentCharacter();
    if (char) contacts.push({ key: "main", name: getCharName(), isMain: true, avatar: "" });
    for (const npc of getNpcs()) {
        const name = String(npc.name || "").trim();
        if (name) contacts.push({ key: "npc:" + name, name, isMain: false, avatar: npc.avatar || "" });
    }
    const p = getPet();
    if (p.exists && !p.isDead) contacts.push({ key: "pet", name: p.name || "เพ็ท", isPet: true, avatar: petSpriteUrl(petState()) });
    return contacts;
}

function contactAvatarItem(c) {
    if (c.isPet) return { author: c.name, avatar: c.avatar || "", emoji: PET_STATE_EMOJI[petState()] || "🐾" };
    return c.isMain ? { isMain: true, author: c.name } : { author: c.name, avatar: c.avatar || "" };
}

function isConnectThreadOpen() {
    return !$("#tinyfeed-connect-thread").hasClass("tinyfeed-hidden");
}

function openConnectList() {
    activeThread = null;
    closeConnectPlusMenu();
    toggleGroupForm(false);
    $("#tinyfeed-connect-tools").removeClass("tinyfeed-hidden");
    $("#tinyfeed-connect-thread").addClass("tinyfeed-hidden");
    $("#tinyfeed-connect-list").removeClass("tinyfeed-hidden");
    $("#tinyfeed-home-btn, #tinyfeed-settings-btn").removeClass("tinyfeed-hidden");
    $("#tinyfeed-back").addClass("tinyfeed-hidden");
    $(".tinyfeed-title").text("TinyConnect");
    renderConnectList();
}

function renderConnectList() {
    const contacts = getConnectContacts();
    const groups = getConnectGroups();
    if (!contacts.length && !groups.length) {
        $("#tinyfeed-connect-list").html(emptyStateHtml("fa-comment-dots", "ยังไม่มีคนให้คุย", "เปิดแชทที่มีตัวละคร หรือเพิ่ม NPC ประจำในแอป TinyFeed"));
        return;
    }
    const threads = getConnectData().threads;
    const lastOf = (key, fallback) => {
        const t = threads[key] || [];
        if (!t.length) return fallback;
        const m = t[t.length - 1];
        const who = m.from === "user" ? getUserName() : (m.author || "");
        return `${who ? who + ": " : ""}${htmlToPlain(m.text)}`.slice(0, 42);
    };

    const contactRows = contacts.map((c) => `
        <div class="tinyfeed-connect-contact" data-key="${escapeAttr(c.key)}" data-name="${escapeAttr(c.name)}">
            ${makeAvatar(contactAvatarItem(c))}
            <div class="tinyfeed-connect-contact-body">
                <div class="tinyfeed-connect-contact-name">${escapeText(c.name)}</div>
                <div class="tinyfeed-connect-contact-last">${escapeText(lastOf(c.key, "แตะเพื่อเริ่มแชต"))}</div>
            </div>
        </div>`).join("");

    const groupRows = groups.map((g) => {
        const key = "group:" + g.id;
        const groupAva = g.avatar
            ? makeAvatar({ author: g.name, avatar: g.avatar })
            : makeAnonAvatar(g.name);
        return `<div class="tinyfeed-connect-contact tinyfeed-connect-group" data-key="${escapeAttr(key)}" data-name="${escapeAttr(g.name)}" data-group="1">
            ${groupAva}
            <div class="tinyfeed-connect-contact-body">
                <div class="tinyfeed-connect-contact-name">${escapeText(g.name)} <span class="tinyfeed-group-count">(${g.members.length})</span></div>
                <div class="tinyfeed-connect-contact-last">${escapeText(lastOf(key, g.members.join(", ")))}</div>
            </div>
            <span class="tinyfeed-group-edit" data-key="${escapeAttr(key)}" title="ตั้งรูปกลุ่ม"><i class="fa-solid fa-camera"></i></span>
            <span class="tinyfeed-group-del" data-key="${escapeAttr(key)}" title="ลบกลุ่ม"><i class="fa-solid fa-trash"></i></span>
        </div>`;
    }).join("");

    $("#tinyfeed-connect-list").html(contactRows + groupRows);
}

function openThread(key, name) {
    activeThread = key;
    activeThreadName = name;
    $("#tinyfeed-connect-list, #tinyfeed-connect-tools").addClass("tinyfeed-hidden");
    toggleGroupForm(false);
    $("#tinyfeed-connect-thread").removeClass("tinyfeed-hidden");
    $("#tinyfeed-home-btn, #tinyfeed-settings-btn").addClass("tinyfeed-hidden");
    $("#tinyfeed-back").removeClass("tinyfeed-hidden");
    $(".tinyfeed-title").text(name);
    // แถบเครื่องมือในห้องแชต: 1:1 = ปุ่ม "ให้ตอบกลับ" · กลุ่ม = "ให้กลุ่มคุยกันต่อ" · เพ็ท = ไม่มี (คุยเล่นได้ ไม่ใช้ AI RP)
    const isGroup = Boolean(findGroup(key));
    const isPet = key === "pet";
    $("#tinyfeed-connect-thread-tools").toggleClass("tinyfeed-hidden", isPet);
    $("#tinyfeed-connect-reply").toggleClass("tinyfeed-hidden", isGroup || isPet);
    $("#tinyfeed-group-continue").toggleClass("tinyfeed-hidden", !isGroup);
    renderThread();
    saveLastScreen();
    $("#tinyfeed-connect-input").trigger("focus");
}

// แตกข้อความแชตเป็นบับเบิล: media token ([sticker:]/[img:]) = บับเบิลเดี่ยวเสมอ ·
// ข้อความรอบๆ แตกตามบรรทัดเมื่อเปิด connectSplitBubbles (ปิด = ข้อความรวมเป็นก้อนเดียว)
function connectBubbleSegments(text) {
    const s = resolveMediaPriority(text);   // รูป > สติกเกอร์ (ก่อนแตกบับเบิล)
    const splitText = getSetting("connectSplitBubbles");
    const segs = [];
    const pushText = (chunk) => {
        if (splitText) {
            chunk.split(/(?:<br\s*\/?>|\n)+/i).map((x) => x.trim()).filter(Boolean).forEach((x) => segs.push(x));
        } else {
            const t = String(chunk || "").replace(/^(?:<br\s*\/?>|\s)+|(?:<br\s*\/?>|\s)+$/gi, "");
            if (t) segs.push(t);
        }
    };
    const mediaRe = /\[(?:sticker|img):[^\]]+\]/gi;
    let last = 0, m;
    while ((m = mediaRe.exec(s)) !== null) {
        if (m.index > last) pushText(s.slice(last, m.index));
        segs.push(m[0]);   // media = บับเบิลเดี่ยว
        last = mediaRe.lastIndex;
    }
    if (last < s.length) pushText(s.slice(last));
    return segs.length ? segs : [String(text || "")];
}

function renderThread() {
    if (!activeThread) return;
    const msgs = getThread(activeThread);
    const contact = getConnectContacts().find((c) => c.key === activeThread)
        || { name: activeThreadName, isMain: false, avatar: "" };
    const group = findGroup(activeThread);
    const delBtn = (i) => `<span class="tinyfeed-msg-del" data-idx="${i}" title="ลบข้อความ"><i class="fa-solid fa-trash"></i></span>`;
    // แยกข้อความ → หลายบับเบิล: สติกเกอร์/รูปแยกบับเบิลเสมอ (แม้อยู่กลางข้อความไม่ขึ้นบรรทัดใหม่) ·
    // ส่วนข้อความแยกตามบรรทัดเมื่อเปิด connectSplitBubbles
    const bubblesHtml = (text) => {
        const segs = connectBubbleSegments(text);
        return segs.map((s) => `<div class="tinyfeed-msg-bubble">${renderRich(s)}</div>`).join("");
    };
    const rows = msgs.map((m, i) => {
        const content = m.isSlip ? slipCardHtml(m) : bubblesHtml(m.text);
        if (m.from === "user") {
            return `<div class="tinyfeed-msg tinyfeed-msg-user" data-idx="${i}">
                ${delBtn(i)}
                <div class="tinyfeed-msg-stack">${content}</div>
            </div>`;
        }
        // แชตกลุ่ม: ใช้ avatar/ชื่อของสมาชิกที่พูด
        const who = group ? (m.author || group.name) : contact.name;
        const avaItem = group
            ? { author: who, avatar: getNpcAvatar(who), isMain: who === ((getCurrentCharacter() || {}).name || "") }
            : contactAvatarItem(contact);
        return `<div class="tinyfeed-msg tinyfeed-msg-contact" data-idx="${i}">
            ${makeAvatar(avaItem)}
            <div class="tinyfeed-msg-col">
                ${group ? `<span class="tinyfeed-msg-author">${escapeText(who)}</span>` : ""}
                <div class="tinyfeed-msg-stack">${content}</div>
            </div>
            ${delBtn(i)}
        </div>`;
    }).join("");
    const typing = isConnectReplying
        ? `<div class="tinyfeed-msg tinyfeed-msg-contact">
               ${makeAvatar(contactAvatarItem(contact))}
               <div class="tinyfeed-msg-bubble tinyfeed-msg-typing">กำลังพิมพ์…</div>
           </div>`
        : "";
    const box = $("#tinyfeed-connect-messages");
    box.html(rows + typing);
    if (box[0]) box.scrollTop(box[0].scrollHeight);   // เลื่อนลงล่างสุด
    updateChatInjection();
}

// ลบบับเบิลแชท 1 อัน (อ้างตาม index ในเธรด)
function deleteConnectMessage(idx) {
    if (!activeThread || isNaN(idx)) return;
    const msgs = getThread(activeThread);
    if (idx < 0 || idx >= msgs.length) return;
    if (!confirm("ต้องการลบข้อความนี้ใช่ไหม?")) return;
    msgs.splice(idx, 1);
    saveFeedData();
    renderThread();
}

// การ์ดสลิปโอนเงินในแชท
function slipCardHtml(m) {
    const inbound = m.dir === "in";
    return `<div class="tinyfeed-slip ${inbound ? "tinyfeed-slip-in" : "tinyfeed-slip-out"}">
        <div class="tinyfeed-slip-head"><i class="fa-solid fa-money-bill-transfer"></i> ${inbound ? "โอนเงินเข้า" : "โอนเงินออก"}</div>
        <div class="tinyfeed-slip-amount">${formatMoney(m.amount)}</div>
        ${m.note ? `<div class="tinyfeed-slip-note">${escapeText(m.note)}</div>` : ""}
        <div class="tinyfeed-slip-badge"><i class="fa-solid fa-circle-check"></i> โอนสำเร็จ</div>
    </div>`;
}

// เปิด/ปิด modal โอนเงินในแชทที่เปิดอยู่
function openSlipModal() {
    if (!activeThread) return;
    $("#tinyfeed-slip-amount, #tinyfeed-slip-note").val("");
    $("#tinyfeed-slip-to").text(activeThreadName || "");
    $("#tinyfeed-slip-modal").removeClass("tinyfeed-hidden");
    setTimeout(() => $("#tinyfeed-slip-amount").trigger("focus"), 30);
}
function closeSlipModal() { $("#tinyfeed-slip-modal").addClass("tinyfeed-hidden"); }

// เมนู (+) ฟังก์ชันเสริมในแชท (สไตล์ไลน์) — ตอนนี้มีแค่โอนเงิน · ออกแบบให้เพิ่มรายการอนาคตได้ง่าย
// (เช่น แชร์โพสต์ฟีด / แชร์ข่าว / แชร์กระทู้ / แชร์สตรีม / แชร์สินค้า — เพิ่มออบเจกต์ในอาเรย์นี้ + ใส่ run)
const CONNECT_PLUS_ACTIONS = [
    { id: "slip", icon: "fa-money-bill-transfer", label: "โอนเงิน", run: () => openSlipModal() },
];
function renderConnectPlusMenu() {
    $("#tinyfeed-connect-plusmenu").html(CONNECT_PLUS_ACTIONS.map((a) =>
        `<div class="tinyfeed-plusmenu-item" data-action="${escapeAttr(a.id)}"><i class="fa-solid ${a.icon}"></i> ${escapeText(a.label)}</div>`
    ).join(""));
}
function toggleConnectPlusMenu(force) {
    const menu = $("#tinyfeed-connect-plusmenu");
    if (!menu.length) return;
    const willShow = force != null ? force : menu.hasClass("tinyfeed-hidden");
    if (willShow) renderConnectPlusMenu();
    menu.toggleClass("tinyfeed-hidden", !willShow);
}
function closeConnectPlusMenu() { $("#tinyfeed-connect-plusmenu").addClass("tinyfeed-hidden"); }

// ผู้ใช้โอนเงินออก → หักบัญชี + ดันสลิปในแชท
function sendUserSlip() {
    if (!activeThread) return;
    const amt = parseInt($("#tinyfeed-slip-amount").val(), 10);
    const note = String($("#tinyfeed-slip-note").val() || "").trim();
    if (!Number.isFinite(amt) || amt <= 0) { toastr.info("ใส่จำนวนเงินก่อนนะ", "TinyConnect"); return; }
    const toName = activeThreadName || "ผู้รับ";
    if (!bankDeduct(amt, `โอนให้ ${toName}`, "connect")) return;   // ยอดไม่พอ → มี toast ในตัว
    getThread(activeThread).push({ from: "user", isSlip: true, dir: "out", amount: amt, note, ts: Date.now() });
    saveFeedData();
    closeSlipModal();
    renderThread();
}

// คู่แชท (1:1) ส่งสลิปโอนเข้า: SLIP: จำนวนเงิน | โน้ต
function processConnectSlip(raw, fromName) {
    if (!getSetting("connectSlipEnabled") || !activeThread) return;
    const m = /SLIP:\s*([^\n|]+)(?:\|([^\n]*))?/i.exec(stripReasoning(raw));
    if (!m) return;
    const amount = Math.abs(Math.round(parseFloat(String(m[1]).replace(/[^\d.]/g, "")) || 0));
    if (!amount) return;
    const note = String(m[2] || "").trim();
    if (bankAdd(amount, `รับโอนจาก ${fromName}`, "connect", { silentToast: true })) {
        getThread(activeThread).push({ from: "contact", author: fromName, isSlip: true, dir: "in", amount, note, ts: Date.now() });
    }
}

// ส่งข้อความ = แค่ต่อคิว (ไม่ generate ทันที) เพื่อพิมพ์/แนบรูป/สติกเกอร์หลายอันใน 1 รอบ
// แล้วค่อยกดปุ่ม "ให้ตอบกลับ" ให้ตัวละครตอบทีเดียว
function sendConnectMessage(text) {
    const clean = String(text || "").trim();
    if (!clean || !activeThread) return;
    getThread(activeThread).push({ from: "user", text: escapeHtml(clean), ts: Date.now() });
    if (activeThread === "pet") { petBondAdd(2); savePet(); }   // เพ็ท = global → persist ด้วย savePet + คุยด้วยเพิ่มผูกพันนิดหน่อย
    else saveFeedData();
    $("#tinyfeed-connect-input").val("").css("height", "");   // เคลียร์ + คืนความสูงเริ่มต้น
    renderThread();
}

async function generateConnectReply() {
    if (isConnectReplying || !activeThread) return;
    const name = activeThreadName;
    const you = getUserName();
    const group = findGroup(activeThread);
    const transcript = getThread(activeThread).slice(-12)
        .map((m) => {
            const who = m.from === "user" ? you : (group ? (m.author || name) : name);
            const body = m.isSlip ? `[โอนเงิน ${formatMoney(m.amount)}${m.note ? " — " + m.note : ""}]` : htmlToPlain(m.text);
            return `${who}: ${body}`;
        }).join("\n");

    // --- แชตกลุ่ม: ให้สมาชิก 1-2 คนตอบ ---
    if (group) {
        const extraG = String(getSetting("connectExtraPrompt") || "").trim();
        const qg =
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] นี่คือแชตกลุ่มชื่อ "${group.name}" ` +
            `สมาชิก: ${group.members.join(", ")} และ ${you}. ` +
            `ให้สมาชิกในกลุ่ม 1-2 คน (เลือกเอง ห้ามใช้ ${you}) ตอบ/คุยต่อจากข้อความล่าสุดอย่างเป็นธรรมชาติ สั้นเหมือนแชตจริง ` +
            `ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดหรือกระทำแทน ${you}.\n` +
            (extraG ? `คำสั่งเพิ่มเติม: ${extraG}.\n` : "") +
            crossAppContext("connect") +
            galleryPromptBlock() +
            `บทแชตล่าสุด:\n${transcript}\n` +
            `ตอบบรรทัดละคนในรูปแบบนี้เท่านั้น:\nMSG: <ชื่อสมาชิก> | <ข้อความ>`;
        isConnectReplying = true;
        renderThread();
        try {
            const raw = await tinyGenerate(qg, Math.max(1, parseInt(getSetting("connectTokens"), 10) || 200), "connect");
            const list = parseCommentLines(raw, group.members[0] || name, "MSG")
                .filter((c) => c.author.trim().toLowerCase() !== you.trim().toLowerCase());
            if (list.length) {
                for (const c of list.slice(0, 3)) {
                    getThread(activeThread).push({ from: "contact", author: c.author, text: c.text, ts: Date.now() });
                }
                saveFeedData();
            } else {
                toastr.warning("ยังไม่มีใครตอบในกลุ่ม ลองใหม่นะ", "TinyConnect");
            }
        } catch (e) {
            console.error(`[${extensionName}] group reply failed:`, e);
            toastr.error("ตอบแชตกลุ่มไม่สำเร็จ", "TinyConnect");
        } finally {
            isConnectReplying = false;
            renderThread();
        }
        return;
    }

    const slipLine = getSetting("connectSlipEnabled")
        ? `[ระบบโอนเงิน] ถ้า ${name} อยากโอนเงินให้ ${you} (เฉพาะตอนที่เข้ากับเนื้อเรื่องจริงๆ ไม่ต้องบ่อย) ให้ใส่บรรทัดแยกท้ายข้อความ: SLIP: <จำนวนเงิน> | <โน้ตสั้นๆ>.\n`
        : "";
    const q =
        `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] นี่คือแชตส่วนตัวในแอปแชต (คล้ายไลน์) ระหว่าง ${you} กับ ${name}. ` +
        `ตอบข้อความล่าสุดในบทบาทของ ${name} แบบเป็นธรรมชาติ สั้นกระชับเหมือนแชตจริง (1-3 ประโยค) ` +
        `ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดหรือกระทำแทน ${you}.\n` +
        (String(getSetting("connectExtraPrompt") || "").trim() ? `คำสั่งเพิ่มเติม: ${String(getSetting("connectExtraPrompt")).trim()}.\n` : "") +
        slipLine +
        crossAppContext("connect") +
        galleryPromptBlock() +
        `บทแชตล่าสุด:\n${transcript}\n` +
        `ตอบเฉพาะข้อความของ ${name} เท่านั้น ไม่ต้องใส่ชื่อนำหน้า`;

    isConnectReplying = true;
    renderThread();   // โชว์ "กำลังพิมพ์…"
    try {
        const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("connectTokens"), 10) || 200), "connect");
        let reply = stripReasoning(raw).trim();
        // ถ้าโมเดลห่อด้วย [... Message: ข้อความ] ให้ดึงเฉพาะเนื้อในออกมา
        const wrapped = [...reply.matchAll(/\[[^\]]*?Message:\s*([^\]]+)\]/gi)];
        if (wrapped.length) reply = wrapped.map((m) => m[1].trim()).join("\n");
        reply = reply.replace(/^SLIP:.*$/gim, "").trim();   // ตัดบรรทัดสลิปออกจากข้อความ (จัดการแยก)
        // ตัดวงเล็บ/ป้ายกำกับที่หลงเหลือ + "ชื่อ:" นำหน้า (ไม่ทำลายโทเคนสติกเกอร์/รูป)
        reply = stripWrapBrackets(reply);
        const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        reply = reply.replace(new RegExp(`^${esc}\\s*[:：]\\s*`, "i"), "").trim();
        if (reply) {
            getThread(activeThread).push({ from: "contact", text: escapeHtml(reply), ts: Date.now() });
            saveFeedData();
        }
        processConnectSlip(raw, name);   // คู่แชทโอนเงินเข้า (ถ้าเปิดระบบ + AI ส่ง SLIP)
        if (!reply && !getThread(activeThread).some((m) => m.isSlip && m.ts > Date.now() - 3000)) {
            toastr.warning("ยังไม่มีคำตอบกลับมา ลองใหม่นะ", "TinyConnect");
        }
    } catch (e) {
        console.error(`[${extensionName}] connect reply failed:`, e);
        toastr.error("ตอบแชตไม่สำเร็จ ลองใหม่นะ", "TinyConnect");
    } finally {
        isConnectReplying = false;
        renderThread();
    }
}

function closePhone() {
    $("#tinyfeed-overlay").removeClass("tinyfeed-visible");
    clearStreamTimer();   // ปิดเครื่อง = หยุด timer สตรีม
    clearHomeClock();     // หยุดนาฬิกาหน้าโฮม
    clearPetLiveTick();   // หยุด live tick เพ็ท (พื้นหลัง petTimer ยังเดินเพื่อ decay/แจ้งเตือน)
    console.log(`[${extensionName}] Phone closed`);
}

// ใช้ธีมกับตัวเครื่อง + ปรับไอคอน
function applyTheme(theme) {
    const phone = $("#tinyfeed-phone");
    phone.removeClass("tinyfeed-theme-dark tinyfeed-theme-light");
    phone.addClass(`tinyfeed-theme-${theme}`);
    // แจ้งเตือนอยู่นอกตัวเครื่อง ต้องใส่ธีมแยก
    $("#tinyfeed-notif")
        .removeClass("tinyfeed-theme-dark tinyfeed-theme-light")
        .addClass(`tinyfeed-theme-${theme}`);
    // ธีมมืดโชว์ไอคอนพระอาทิตย์ (กดเพื่อไปสว่าง), ธีมสว่างโชว์พระจันทร์
    const icon = $("#tinyfeed-theme");
    icon.removeClass("fa-moon fa-sun");
    icon.addClass(theme === "dark" ? "fa-sun" : "fa-moon");
}

function toggleTheme() {
    const current = extension_settings[extensionName].theme || "dark";
    const next = current === "dark" ? "light" : "dark";
    extension_settings[extensionName].theme = next;
    saveSettingsDebounced();
    applyTheme(next);
    console.log(`[${extensionName}] theme:`, next);
}

// ===== ปรับแต่งหน้าตา (Appearance) =====
const ACCENT_PRESETS = [
    { name: "ฟ้า", color: "#1d9bf0", hue: 205 },
    { name: "ชมพู", color: "#ec4899", hue: 330 },
    { name: "ม่วง", color: "#a855f7", hue: 270 },
    { name: "เขียว", color: "#22c55e", hue: 140 },
    { name: "ส้ม", color: "#f59e0b", hue: 35 },
    { name: "แดง", color: "#ef4444", hue: 0 },
];

// ใช้ค่าปรับแต่งทั้งหมดกับ DOM (เรียกตอนโหลด + ทุกครั้งที่แก้)
function applyAppearance() {
    const phone = document.getElementById("tinyfeed-phone");
    const notif = document.getElementById("tinyfeed-notif");
    const accent = String(getSetting("accentColor") || "").trim();
    [phone, notif].forEach((el) => {
        if (!el) return;
        if (accent) el.style.setProperty("--tf-accent", accent);
        else el.style.removeProperty("--tf-accent");
    });
    // ฟิลเตอร์พื้นหลัง (0–90% → 0.0–0.9)
    let op = parseInt(getSetting("overlayOpacity"), 10);
    if (!Number.isFinite(op)) op = 50;
    op = Math.min(90, Math.max(0, op));
    const overlay = document.getElementById("tinyfeed-overlay");
    if (overlay) overlay.style.setProperty("--tf-overlay-alpha", String(op / 100));
    // สีไอคอน/พื้นหลังโฮมตามธีม
    if (phone) {
        phone.classList.toggle("tinyfeed-themed-icons", Boolean(getSetting("themedIcons")));
        phone.classList.toggle("tinyfeed-themed-home", Boolean(getSetting("themedHomeBg")));
        let hue = parseInt(getSetting("homeBgHue"), 10);
        if (!Number.isFinite(hue)) hue = 210;
        phone.style.setProperty("--tf-home-hue", String(hue));
        // ความทึบพื้นหลังวิดเจ็ต (สีตาม --tf-topbar = ตามธีม)
        let wop = parseInt(getSetting("widgetOpacity"), 10);
        if (!Number.isFinite(wop)) wop = 82;
        wop = Math.min(100, Math.max(0, wop));
        phone.style.setProperty("--tf-widget-alpha", `${wop}%`);
    }
}

// วาด swatch สีสำเร็จรูปในหน้า settings + ไฮไลต์อันที่เลือกอยู่
function renderAccentSwatches() {
    const cur = String(getSetting("accentColor") || "").trim().toLowerCase();
    const html = ACCENT_PRESETS.map((p) =>
        `<div class="tinyfeed-accent-swatch${cur === p.color.toLowerCase() ? " tinyfeed-accent-active" : ""}" data-color="${p.color}" data-hue="${p.hue}" style="background:${p.color}" title="${p.name}"></div>`
    ).join("");
    $("#tinyfeed-accent-presets").html(html);
}

// ใส่ CSS ของผู้ใช้ลง <style> เฉพาะ (สร้างครั้งเดียว อัปเดตทุกครั้งที่แก้)
function applyCustomCss() {
    let el = document.getElementById("tinyfeed-custom-css");
    if (!el) {
        el = document.createElement("style");
        el.id = "tinyfeed-custom-css";
        document.head.appendChild(el);
    }
    el.textContent = String(getSetting("customCss") || "");
}

// ===== วิดเจ็ตหน้าโฮม =====
let homeClockTimer = null;

function clearHomeClock() {
    if (homeClockTimer) { clearInterval(homeClockTimer); homeClockTimer = null; }
}

function updateHomeClock() {
    const box = document.querySelector("#tinyfeed-widget-clock .tinyfeed-widget-time");
    if (!box) return;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    box.textContent = `${hh}:${mm}`;
    const dateEl = document.querySelector("#tinyfeed-widget-clock .tinyfeed-widget-date");
    if (dateEl) {
        try {
            dateEl.textContent = now.toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long" });
        } catch (e) { dateEl.textContent = now.toDateString(); }
    }
}

// ===== หน้าโฮม: กริดแอปแบบแบ่งหน้า (รองรับแอปในอนาคต) =====
// แอปที่โผล่บนหน้าโฮม — มาจากทะเบียน APPS (ดู App Shell ด้านบน) ไม่ใช่ลิสต์แยก
const HOME_APPS_PER_PAGE = 9;   // 3 คอลัมน์ × 3 แถวต่อหน้า

function appIconHtml(a) {
    return `<div class="tinyfeed-app-icon" data-app="${a.id}">
        <div class="tinyfeed-app-tile" style="--app-a:${a.a}; --app-b:${a.b};"><i class="fa-solid ${a.icon}"></i></div>
        <span class="tinyfeed-app-name">${a.name}</span>
    </div>`;
}

function renderHomeApps() {
    const pager = $("#tinyfeed-home-pager");
    if (!pager.length) return;
    const homeApps = APPS.filter((a) => a.home);
    const pages = [];
    for (let i = 0; i < homeApps.length; i += HOME_APPS_PER_PAGE) {
        const slice = homeApps.slice(i, i + HOME_APPS_PER_PAGE);
        pages.push(`<div class="tinyfeed-home-page">${slice.map(appIconHtml).join("")}</div>`);
    }
    pager.html(pages.join(""));
    const dots = pages.length > 1
        ? pages.map((_, i) => `<span class="tinyfeed-home-dot${i === 0 ? " tinyfeed-home-dot-active" : ""}" data-page="${i}"></span>`).join("")
        : "";
    $("#tinyfeed-home-dots").html(dots).toggleClass("tinyfeed-hidden", pages.length <= 1);
    if (pager[0]) pager[0].scrollLeft = 0;
}

// อัปเดตจุดบอกหน้าตามตำแหน่งเลื่อน
function updateHomeDots() {
    const pager = document.getElementById("tinyfeed-home-pager");
    if (!pager || pager.clientWidth === 0) return;
    const page = Math.round(pager.scrollLeft / pager.clientWidth);
    $(".tinyfeed-home-dot").each(function (i) {
        $(this).toggleClass("tinyfeed-home-dot-active", i === page);
    });
}

// นับโทเคนด้วย tokenizer ของ ST (มี fallback ประมาณ chars/4 ถ้าเวอร์ชันไม่มี)
function tinyTokenCount(text) {
    text = String(text || "");
    if (!text) return 0;
    try {
        const ctx = getContext();
        if (typeof ctx.getTokenCount === "function") {
            const n = ctx.getTokenCount(text);
            if (typeof n === "number" && n >= 0) return n;
        }
    } catch (e) { /* fallback */ }
    return Math.ceil(text.length / 4);
}

/* ป้ายกำกับ/ไอคอน/สีของแต่ละแอป (ใช้ร่วมทั้ง dashboard แทรก + dashboard เจน + keyword editor)
 * สร้างจากทะเบียน APPS ที่เดียว + "news" ที่ไม่ใช่แอปแยก (เป็นแท็บใน TinyFeed)
 * ผลพลอยได้: bank/shop/pet ที่เดิมตกหล่นจากลิสต์นี้ ตอนนี้มีป้ายของตัวเองแล้ว (เดิมโชว์ "การเจน" ทั่วไป) */
const APP_META = Object.fromEntries([
    ...APPS.map((a) => [a.id, { label: a.label || a.name, icon: a.icon, color: a.a }]),
    ["news", { label: "ข่าวสาร", icon: "fa-newspaper", color: "#f59e0b" }],
]);

// ── สถิติโทเคน "จริง" ณ จุดส่ง (อัปเดตตอน inject/generate เกิดขึ้นจริง) ──
let lastGenTokens = null;      // { app,label,icon,color,mode,context,prompt,crossApp,gallery,output,ts }
const lastGenByApp = {};       // app → เหมือน lastGenTokens (เก็บครั้งล่าสุดของแต่ละแอป)

// เก็บ breakdown โทเคนของการเจนในเครื่อง (เรียกใน tinyGenerate ก่อนยิงจริง)
// preamble = ข้อความ context ที่เราสร้างเอง (โหมด profile แยก) หรือ null = ST แนบ context ให้เอง
function recordGenTokens(app, prompt, maxTokens, preamble) {
    try {
        const promptStr = String(prompt || "");
        // แยกก้อนย่อยด้วยฟังก์ชันเดิม (deterministic ตาม settings/data → ตรงกับที่ฝังในพรอมป์จริง)
        const crossStr = app ? crossAppContext(app) : "";
        const crossTok = (crossStr && promptStr.includes("[เนื้อหาจากแอปอื่นในโทรศัพท์")) ? tinyTokenCount(crossStr) : 0;
        const galStr = galleryPromptBlock();
        const galTok = (galStr && promptStr.includes("[คลังสื่อในโทรศัพท์")) ? tinyTokenCount(galStr) : 0;
        const totalPrompt = tinyTokenCount(promptStr);
        const promptOnly = Math.max(0, totalPrompt - crossTok - galTok);
        const context = preamble != null ? tinyTokenCount(preamble) : null;   // null = ST แนบเอง (วัดไม่ได้)
        const meta = APP_META[app] || { label: "การเจน", icon: "fa-wand-magic-sparkles", color: "#8b5cf6" };
        const rec = {
            app: app || "", label: meta.label, icon: meta.icon, color: meta.color,
            mode: context != null ? "external" : "main",
            context, prompt: promptOnly, crossApp: crossTok, gallery: galTok,
            output: Math.max(0, parseInt(maxTokens, 10) || 0), ts: Date.now(),
        };
        lastGenTokens = rec;
        if (app) lastGenByApp[app] = rec;
    } catch (e) { /* ห้ามพังการเจน */ }
}

// want-object ของการแทรกเข้าแชทหลัก (ใช้ร่วม updateChatInjection + dashboard ให้ตรงกันเป๊ะ)
/* ทะเบียนแหล่งข้อมูลที่ส่งออกนอกแอปได้ — เพิ่มแหล่งใหม่ = เพิ่ม entry ที่นี่ที่เดียว
 *   id      คีย์ใน want object + คีย์ใน APP_META (ใช้หาป้าย/ไอคอน/สี)
 *   inject  setting ของ "แทรกเข้า RP" (feed/news ไม่มี เพราะคุมด้วย injectMode)
 *   cross   setting ของ "ให้แอปอื่นเห็น"
 *   single  want ย่อยสำหรับนับ token แยกรายแอปใน dashboard
 * เดิมลิสต์นี้ถูกเขียนซ้ำ 4 ที่ (injectWant / injectText / injectDashboard / crossAppContext)
 * → เพิ่มแหล่งใหม่แล้วลืมที่ใดที่หนึ่ง = แทรกไม่ออกหรือนับ token ขาดแบบเงียบๆ */
const INJECT_SOURCES = [
    { id: "feed", cross: "crossAppFeed", single: (w) => ({ feed: true, comments: w.comments }) },
    { id: "news", cross: "crossAppNews", single: () => ({ news: true }) },
    { id: "connect", inject: "injectConnect", cross: "crossAppConnect", single: () => ({ connect: true }) },
    { id: "stream", inject: "injectStream", cross: "crossAppStream", single: () => ({ stream: true }) },
    { id: "memo", inject: "injectMemo", cross: "crossAppMemo", single: () => ({ memo: true }) },
    { id: "forum", inject: "injectForum", cross: "crossAppForum", single: (w) => ({ forum: true, forumComments: w.forumComments }) },
    { id: "bank", inject: "injectBank", cross: "crossAppBank", single: () => ({ bank: true }) },
    { id: "shop", inject: "injectShop", cross: "crossAppShop", single: () => ({ shop: true }) },
    { id: "pet", inject: "injectPet", cross: "crossAppPet", single: () => ({ pet: true }) },
    { id: "theater", inject: "injectTheater", cross: "crossAppTheater", single: () => ({ theater: true }) },
    { id: "novel", inject: "injectNovel", cross: "crossAppNovel", single: () => ({ novel: true }) },
];
// มีแหล่งไหนเปิดอยู่บ้างไหม (ใช้แทนการไล่ && / || ทีละตัว)
function anyWant(w) { return INJECT_SOURCES.some((s) => w[s.id]); }

function injectWant() {
    const mode = getSetting("injectMode") || "off";
    const want = {
        // feed/news คุมด้วย injectMode (dropdown) ไม่ใช่ checkbox แยก
        feed: ["posts", "posts_comments", "posts_comments_news", "both"].includes(mode),
        comments: ["posts_comments", "posts_comments_news"].includes(mode),
        news: ["news", "posts_comments_news", "both"].includes(mode),
        forumComments: Boolean(getSetting("injectForumComments")),
        count: Math.max(1, parseInt(getSetting("injectCount"), 10) || 5),
    };
    for (const src of INJECT_SOURCES) {
        if (src.inject) want[src.id] = Boolean(getSetting(src.inject));
    }
    return want;
}

// ข้อความที่แทรกเข้าแชทหลักจริง (ใช้ทั้งตอน setExtensionPrompt และตอนนับโทเคน)
function injectText() {
    const w = injectWant();
    if (!anyWant(w)) return "";
    const blocks = buildAppBlocks(w);
    return blocks.length
        ? `[ข้อมูลจากโทรศัพท์ TinyPhone ที่ตัวละครรับรู้ได้ ใช้อ้างอิงในบทบาทได้ตามเหมาะสม]\n${blocks.join("\n\n")}`
        : "";
}

// ── Dashboard ส่วน A: โทเคนที่ "ส่งเข้าแชทหลัก" ทุกข้อความ (ตรงกับ config แทรกจริง) ──
function injectDashboard() {
    const w = injectWant();
    const on = anyWant(w);
    const rows = [];
    const add = (key, single) => {
        const t = buildAppBlocks(Object.assign({ count: w.count }, single)).join("\n");
        const tok = tinyTokenCount(t);
        if (tok) { const m = APP_META[key]; rows.push({ key, label: m.label, icon: m.icon, color: m.color, tokens: tok }); }
    };
    for (const src of INJECT_SOURCES) { if (w[src.id]) add(src.id, src.single(w)); }
    const total = tinyTokenCount(injectText());   // รวมจริง (มี header ครอบ)
    return { rows, total, on, depth: Math.max(0, parseInt(getSetting("injectDepth"), 10) || 4) };
}

// รวมทั้งสองส่วนให้ผู้เรียก (widget) ใช้
function tokenDashboardData() {
    return { inject: injectDashboard(), gen: lastGenTokens };
}

// วิดเจ็ตโทเคน 2 ส่วน: (A) ส่งเข้าแชทหลักทุกข้อความ · (B) การเจนในเครื่องครั้งล่าสุด
function renderTokenWidget() {
    const d = tokenDashboardData();

    // ── ส่วน A: แทรกเข้าแชทหลัก ──
    const inj = d.inject;
    let secA;
    if (!inj.on) {
        secA = `<div class="tinyfeed-widget-agenda-empty">ปิดการแทรกเข้าแชทหลัก</div>`;
    } else {
        const max = Math.max(1, ...inj.rows.map((r) => r.tokens));
        const bars = inj.rows.map((r) => `
            <div class="tinyfeed-token-row">
                <span class="tinyfeed-token-app"><i class="fa-solid ${r.icon}" style="color:${r.color}"></i> ${escapeText(r.label)}</span>
                <span class="tinyfeed-token-bar"><span style="width:${Math.round(r.tokens / max * 100)}%;background:${r.color}"></span></span>
                <span class="tinyfeed-token-num">${r.tokens.toLocaleString()}</span>
            </div>`).join("") || `<div class="tinyfeed-widget-agenda-empty">ไม่มีข้อมูลให้แทรก</div>`;
        secA = bars;
    }

    // ── ส่วน B: การเจนในเครื่องครั้งล่าสุด ──
    const g = d.gen;
    let secB;
    if (!g) {
        secB = `<div class="tinyfeed-widget-agenda-empty">ยังไม่ได้เจนข้อมูลในเครื่อง</div>`;
    } else {
        const ctxLabel = g.context == null ? "context (ST แนบเอง)" : `context ${g.context.toLocaleString()}`;
        const inputTotal = (g.context || 0) + g.prompt + g.crossApp + g.gallery;
        const chip = (label, val, color) => val
            ? `<span class="tinyfeed-token-chip"><span class="tinyfeed-token-dot" style="background:${color}"></span>${label} <b>${val.toLocaleString()}</b></span>`
            : "";
        const chips = [
            g.context == null
                ? `<span class="tinyfeed-token-chip tinyfeed-token-chip-muted"><span class="tinyfeed-token-dot" style="background:#94a3b8"></span>${ctxLabel}</span>`
                : chip("context", g.context, "#94a3b8"),
            chip("prompt", g.prompt, "#38bdf8"),
            chip("ข้ามแอป", g.crossApp, "#a855f7"),
            chip("คลังสื่อ", g.gallery, "#ec4899"),
        ].filter(Boolean).join("");
        secB = `
            <div class="tinyfeed-token-genhead">
                <span><i class="fa-solid ${g.icon}" style="color:${g.color}"></i> ${escapeText(g.label)}</span>
                <span class="tinyfeed-token-genmeta">อินพุต ~${inputTotal.toLocaleString()} · ตอบ ≤${g.output.toLocaleString()}</span>
            </div>
            <div class="tinyfeed-token-chips">${chips}</div>`;
    }

    return `<div id="tinyfeed-widget-tokens" class="tinyfeed-widget tinyfeed-widget-tokens">
        <div class="tinyfeed-widget-head"><i class="fa-solid fa-arrow-right-to-bracket"></i> ส่งเข้าแชทหลัก · ทุกข้อความ${inj.on ? ` · รวม <b>${inj.total.toLocaleString()}</b>` : ""}</div>
        ${secA}
        <div class="tinyfeed-token-sep"></div>
        <div class="tinyfeed-widget-head"><i class="fa-solid fa-wand-magic-sparkles"></i> เจนข้อมูลในเครื่อง · ครั้งล่าสุด</div>
        ${secB}
    </div>`;
}

function renderHomeWidgets() {
    const box = $("#tinyfeed-home-widgets");
    if (!box.length) return;
    const parts = [];
    if (getSetting("widgetClock")) {
        parts.push(`<div id="tinyfeed-widget-clock" class="tinyfeed-widget tinyfeed-widget-clock">
            <div class="tinyfeed-widget-time">--:--</div>
            <div class="tinyfeed-widget-date"></div>
        </div>`);
    }
    if (getSetting("widgetAgenda")) {
        const pending = getAgenda().filter((a) => a.status === "pending").slice(0, 3);
        const rows = pending.length
            ? pending.map((a) => `<div class="tinyfeed-widget-agenda-item">${a.when ? `<span class="tinyfeed-widget-agenda-when">${renderRich(a.when)}</span> ` : ""}${renderRich(a.title)}</div>`).join("")
            : `<div class="tinyfeed-widget-agenda-empty">ยังไม่มีกำหนดการ</div>`;
        parts.push(`<div id="tinyfeed-widget-agenda" class="tinyfeed-widget tinyfeed-widget-agenda" data-app="memo">
            <div class="tinyfeed-widget-head"><i class="fa-solid fa-calendar-day"></i> กำหนดการ</div>
            ${rows}
        </div>`);
    }
    if (getSetting("widgetTokens")) {
        parts.push(renderTokenWidget());
    }
    box.html(parts.join(""));
    box.toggleClass("tinyfeed-hidden", parts.length === 0);
    clearHomeClock();
    if (getSetting("widgetClock")) {
        updateHomeClock();
        homeClockTimer = setInterval(updateHomeClock, 30000);   // อัปเดตทุก 30 วิ (คลาดไม่เกิน 1 นาที)
    }
}

// ===== ข้อมูลผูกกับแชท (chat_metadata) =====

// ข้อมูลเริ่มต้นสำหรับแชทที่ยังไม่มีฟีด (เริ่มว่าง — โชว์ empty state)

// ล้างข้อมูล mockup เก่าที่เคยฝังไว้ (ids p1/p2/n1) ออกจากแชทที่มีอยู่แล้ว

// ดึงข้อมูล TinyFeed ของแชทปัจจุบัน

// รายชื่อ NPC ประจำของแชทปัจจุบัน (ensure array สำหรับแชทเก่าที่ยังไม่มี field นี้)
// NPC ผูกกับตัวละคร (charFile) — ย้ายจากเดิมที่ผูกกับแชท (migrate อัตโนมัติครั้งเดียว)
function getNpcsStore() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (!extension_settings[extensionName].npcsByChar || typeof extension_settings[extensionName].npcsByChar !== "object") {
        extension_settings[extensionName].npcsByChar = {};
    }
    return extension_settings[extensionName].npcsByChar;
}
function getNpcs() {
    const store = getNpcsStore();
    const key = getCharKey() || "__nochar__";
    if (!Array.isArray(store[key])) {
        // ย้าย NPC เดิมที่ผูกกับแชทนี้มาเป็นของตัวละคร (ครั้งเดียว)
        let seed = [];
        try {
            const data = getFeedData();
            if (Array.isArray(data.npcs) && data.npcs.length) seed = data.npcs.slice();
        } catch (e) { /* ไม่มีแชท */ }
        store[key] = seed;
        if (seed.length) saveSettingsDebounced();
    }
    return store[key];
}
function saveNpcs() { saveSettingsDebounced(); }

// ===== TinyVerse (แอปที่ 10): ฮับตัวละครโกลบอล — import การ์ด+NPC มารวมกัน + หน้าโปรไฟล์ใช้ร่วม =====
// data model: extension_settings[extensionName].verse = { chars: { <charFile>: {...} }, feed: [] }
function getVerse() {
    const store = extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (!store.verse || typeof store.verse !== "object") store.verse = { chars: {}, feed: [], scenes: [] };
    if (!store.verse.chars || typeof store.verse.chars !== "object") store.verse.chars = {};
    if (!Array.isArray(store.verse.feed)) store.verse.feed = [];
    if (!Array.isArray(store.verse.scenes)) store.verse.scenes = [];
    return store.verse;
}
function saveVerse() { saveSettingsDebounced(); }
// จำนวนตัวอักษรสูงสุดของ bio (ตั้งค่าได้; 0 = ไม่จำกัด)
function verseBioLimit() {
    const n = parseInt(getSetting("verseBioLimit"), 10);
    return (Number.isFinite(n) && n >= 0) ? n : 1000;
}
// bio จากการ์ด (v1 field หรือ v2 card.data) ตัดตามค่าจำกัด (0 = เต็ม)
function cardBio(card) {
    if (!card) return "";
    const d = card.description || (card.data && card.data.description) || "";
    const per = card.personality || (card.data && card.data.personality) || "";
    let bio = String(d || "").trim();
    if (!bio && per) bio = String(per).trim();
    const cap = verseBioLimit();
    return cap > 0 ? bio.slice(0, cap) : bio;
}
// เพิ่ม/รีเฟรชตัวละครหนึ่งตัวเข้า roster (refresh ชื่อ/รูป/NPC/bio, คง persona ที่ผู้ใช้แก้) — คืน true ถ้าเป็นตัวใหม่
function verseAddChar(card) {
    if (!card || !card.avatar) return false;
    const v = getVerse();
    const key = String(card.avatar);
    const existed = !!v.chars[key];
    const prof = getProfileStore("char")[key] || {};
    const avatar = (prof.avatarUrl && String(prof.avatarUrl)) || `/thumbnail?type=avatar&file=${encodeURIComponent(key)}`;
    const store = getNpcsStore();
    const npcs = Array.isArray(store[key]) ? store[key].map((n) => ({ name: n.name, avatar: n.avatar || "" })) : [];
    const prev = v.chars[key] || {};
    v.chars[key] = {
        key,
        name: card.name || prev.name || "ตัวละคร",
        avatar,
        bio: cardBio(card) || prev.bio || "",           // รีเฟรชจากการ์ด
        persona: prev.persona || cardBio(card) || "",   // ผู้ใช้แก้ได้ → คงไว้
        npcs: npcs.length ? npcs : (prev.npcs || []),
        addedTs: prev.addedTs || Date.now(),
    };
    return !existed;
}
// อ่าน charcard ทั้งหมดที่โหลดใน ST (getContext().characters) → รายการเลือก import
function verseImportCandidates() {
    let cards = [];
    try { const ctx = getContext(); if (ctx && Array.isArray(ctx.characters)) cards = ctx.characters; } catch (e) { /* ไม่มี context */ }
    const v = getVerse();
    return cards.filter((c) => c && c.avatar).map((c) => ({ file: String(c.avatar), name: c.name || "ตัวละคร", inRoster: !!v.chars[String(c.avatar)] }));
}
function verseRemoveChar(key) { const v = getVerse(); if (v.chars[key]) { delete v.chars[key]; saveVerse(); } }
function verseClearAll() { const v = getVerse(); v.chars = {}; saveVerse(); }

// ── ตัวเลือก import (เลือกเฉพาะตัวที่ต้องการ + ตั้งค่าจำกัดตัวอักษร bio) ──
function openVerseImport() {
    $("#tinyfeed-verse-biolimit").val(verseBioLimit());
    $("#tinyfeed-verse-selall").prop("checked", false);
    renderVerseImportList();
    $("#tinyfeed-verse-import-modal").removeClass("tinyfeed-hidden");
}
function closeVerseImport() { $("#tinyfeed-verse-import-modal").addClass("tinyfeed-hidden"); }
function renderVerseImportList() {
    const list = $("#tinyfeed-verse-import-list");
    if (!list.length) return;
    const cands = verseImportCandidates();
    if (!cands.length) {
        list.html(emptyInlineHtml("ไม่พบตัวละครใน SillyTavern<br><small>ลองเปิด/โหลดการ์ดก่อน</small>"));
        return;
    }
    const prof = getProfileStore("char");
    list.html(cands.map((c) => {
        const av = (prof[c.file] && prof[c.file].avatarUrl) || `/thumbnail?type=avatar&file=${encodeURIComponent(c.file)}`;
        // default: ติ๊กเฉพาะตัวที่ยังไม่อยู่ใน roster (ตัวที่อยู่แล้ว = ติ๊กเพื่อรีเฟรช)
        return `<label class="tinyfeed-verse-imp-row">
            <input type="checkbox" class="tinyfeed-verse-imp-check" data-file="${escapeAttr(c.file)}" ${c.inRoster ? "" : "checked"} />
            ${makeAvatar({ avatar: av, author: c.name })}
            <span class="tinyfeed-verse-imp-name">${escapeText(c.name)}</span>
            ${c.inRoster ? `<span class="tinyfeed-verse-imp-tag">อยู่แล้ว</span>` : ""}
        </label>`;
    }).join(""));
}
function verseDoImport() {
    const lim = parseInt($("#tinyfeed-verse-biolimit").val(), 10);
    setSetting("verseBioLimit", (Number.isFinite(lim) && lim >= 0) ? lim : 1000);   // ตั้งค่าก่อน เพื่อให้ cardBio ตัดตามค่าใหม่
    const files = $(".tinyfeed-verse-imp-check:checked").map(function () { return String($(this).data("file")); }).get();
    if (!files.length) { toastr.info("ยังไม่ได้เลือกตัวละคร", "TinyVerse"); return; }
    let cards = [];
    try { const ctx = getContext(); if (ctx && Array.isArray(ctx.characters)) cards = ctx.characters; } catch (e) { /* ไม่มี context */ }
    const byFile = {};
    for (const c of cards) if (c && c.avatar) byFile[String(c.avatar)] = c;
    let added = 0;
    for (const f of files) if (byFile[f] && verseAddChar(byFile[f])) added++;
    saveVerse();
    closeVerseImport();
    renderVerse();
    toastr.success(`Import ${files.length} ตัว (ใหม่ ${added})`, "TinyVerse");
}
// หา verse char ตามชื่อ (case-insensitive)
function verseCardByName(name) {
    const n = String(name || "").trim().toLowerCase();
    if (!n) return null;
    const v = getVerse();
    for (const k in v.chars) if (String(v.chars[k].name || "").trim().toLowerCase() === n) return v.chars[k];
    return null;
}
// normalize ผู้เขียน (ชื่อจากฟีด/คอมเมนต์) → การ์ดโปรไฟล์ (ผู้ใช้/ตัวหลัก/verse/NPC/anon) เพื่อใช้กับ openCharProfile ร่วมกัน
function charCardForAuthor(author) {
    const name = String(author || "").trim();
    if (!name) return null;
    if (nameMatchesUser(name)) return { name: getUserName(), avatar: getUserAvatar(), bio: "", isUser: true };
    if (nameMatchesChar(name)) {
        const key = getCharKey();
        return getVerse().chars[key] || { key, name: getCharName(), avatar: getCharacterAvatar(), bio: "", persona: "", npcs: getNpcs().map((n) => ({ name: n.name, avatar: n.avatar || "" })) };
    }
    const vc = verseCardByName(name);
    if (vc) return vc;
    const npc = getNpcs().find((x) => String(x.name || "").trim().toLowerCase() === name.toLowerCase());
    if (npc) return { name: npc.name, avatar: npc.avatar || "", bio: "", isNpc: true };
    return { name, avatar: "", bio: "" };
}

// ── TinyVerse app: แท็บ ฟีดโกลบอล / ตัวละคร ──
let verseTab = "feed";
let versePostId = null;   // โพสต์ที่กางหน้ารายละเอียดอยู่ (null = อยู่หน้ารายการ) — เหมือน TinyFeed
function openVerse() { renderVerse(); }

function isVersePostOpen() { return !!versePostId; }

// เปิดหน้ารายละเอียดโพสต์ (ท่าเดียวกับ openPostDetail ของ TinyFeed)
function openVersePost(id) {
    if (!getVerse().feed.some((p) => p.id === id)) return;
    versePostId = id;
    $("#tinyfeed-home-btn, #tinyfeed-settings-btn").addClass("tinyfeed-hidden");
    $("#tinyfeed-back").removeClass("tinyfeed-hidden");
    renderVerse();
}

function closeVersePost() {
    versePostId = null;
    $("#tinyfeed-back").addClass("tinyfeed-hidden");
    $("#tinyfeed-home-btn, #tinyfeed-settings-btn").removeClass("tinyfeed-hidden");
    $(".tinyfeed-title").text("TinyVerse");
    renderVerse();
}

function renderVerse() {
    const body = $("#tinyfeed-verse-body");
    if (!body.length) return;
    // หน้ารายละเอียด: ไม่มีแถบแท็บ เหมือน detail ของ TinyFeed
    if (versePostId) {
        const post = getVerse().feed.find((p) => p.id === versePostId);
        if (!post) { versePostId = null; closeVersePost(); return; }
        $(".tinyfeed-title").text("โพสต์");
        body.html(`<div class="tinyfeed-screen">${renderVersePost(post, true)}</div>`);
        return;
    }
    body.html(`
        <div class="tinyfeed-tabs">
            <div class="tinyfeed-tab${verseTab === "feed" ? " tinyfeed-tab-active" : ""}" data-vtab="feed"><i class="fa-solid fa-hashtag"></i> ฟีด</div>
            <div class="tinyfeed-tab${verseTab === "roster" ? " tinyfeed-tab-active" : ""}" data-vtab="roster"><i class="fa-solid fa-users"></i> ตัวละคร</div>
        </div>
        <div id="tinyfeed-verse-tabbody" class="tinyfeed-verse-tabbody"></div>
    `);
    if (verseTab === "feed") renderVerseFeed();
    else renderVerseRoster();
}
function renderVerseRoster() {
    const body = $("#tinyfeed-verse-tabbody");
    if (!body.length) return;
    const v = getVerse();
    const keys = Object.keys(v.chars).sort((a, b) => (v.chars[b].addedTs || 0) - (v.chars[a].addedTs || 0));
    const cards = keys.map((k) => {
        const c = v.chars[k];
        return `<div class="tinyfeed-verse-card" data-key="${escapeAttr(k)}">
            ${makeAvatar({ avatar: c.avatar || "", author: c.name })}
            <span class="tinyfeed-verse-cardname">${escapeText(c.name)}</span>
            ${(c.npcs && c.npcs.length) ? `<span class="tinyfeed-verse-cardnpc">${c.npcs.length} NPC</span>` : ""}
        </div>`;
    }).join("");
    body.html(`
        <div class="tinyfeed-verse-bar">
            <span class="tinyfeed-verse-count">ตัวละคร ${keys.length}</span>
            <div class="tinyfeed-verse-baractions">
                ${keys.length ? `<button id="tinyfeed-verse-clear" class="tinyfeed-btn-ghost tinyfeed-verse-clearbtn"><i class="fa-solid fa-trash"></i> เคลียร์</button>` : ""}
                <button id="tinyfeed-verse-import" class="tinyfeed-btn-primary"><i class="fa-solid fa-download"></i> Import</button>
            </div>
        </div>
        ${keys.length
            ? `<div class="tinyfeed-verse-grid">${cards}</div>`
            : emptyStateHtml("fa-user-astronaut", "ยังไม่มีตัวละคร", "กด Import เพื่อดึงการ์ด + NPC เข้ามารวมกัน")}
    `);
}

// ── ฟีดโกลบอล: โพสต์จากตัวละครทุกการ์ด (AI แต่งในคาแรกเตอร์) + ผู้ใช้โพสต์เอง (แบบ TinyFeed) ──
let verseBusy = false;
const VERSE_POSTER_RANDOM = "__random__";
let versePoster = POSTER_USER;   // ค่าเริ่มต้น = โพสต์เป็นตัวเราเอง (พิมพ์เอง + แนบรูป/สติกเกอร์)
function verseTokens() { const n = parseInt(getSetting("verseTokens"), 10); return (Number.isFinite(n) && n > 0) ? n : 120; }
// avatar ของคนโพสต์ที่เลือก (เรา / สุ่ม / ตัวละครใน roster)
function versePosterAvatarNode() {
    if (versePoster === VERSE_POSTER_RANDOM) return `<div class="tinyfeed-avatar tinyfeed-avatar-auto" title="สุ่มตัวละคร"><i class="fa-solid fa-shuffle"></i></div>`;
    if (versePoster === POSTER_USER) return makeAvatar({ isUser: true, author: getUserName() });
    const c = getVerse().chars[versePoster];
    return c ? makeAvatar({ avatar: c.avatar || "", author: c.name }) : makeAvatar({ isUser: true, author: getUserName() });
}
// ปรับสภาพช่องเขียน: เราเอง = พิมพ์+แนบรูป/สติกเกอร์ · ตัวละคร/สุ่ม = โหมด AI (guidance + คทา)
function applyVerseComposeMode() {
    const aiMode = versePoster !== POSTER_USER;
    $("#tinyfeed-verse-compose-avatar").html(versePosterAvatarNode());
    $("#tinyfeed-verse-input")
        .prop("disabled", aiMode)
        .toggleClass("tinyfeed-input-disabled", aiMode)
        .attr("placeholder", aiMode ? "ให้ตัวละครนี้โพสต์ให้ (กดปุ่มโพสต์)" : "คุณกำลังคิดอะไรอยู่?");
    $("#tinyfeed-verse-guidance").toggleClass("tinyfeed-hidden", !aiMode);
    $("#tinyfeed-verse-img, #tinyfeed-verse-sticker").prop("disabled", aiMode);
    $("#tinyfeed-verse-post .tinyfeed-post-wand").toggleClass("tinyfeed-hidden", !aiMode);
    const emptyUser = String($("#tinyfeed-verse-input").val() || "").trim().length === 0;
    $("#tinyfeed-verse-post").prop("disabled", aiMode ? false : emptyUser);
}
function setVersePostGenerating(on) {
    $("#tinyfeed-verse-post .tinyfeed-post-wand").toggleClass("tinyfeed-spin", on);
    $("#tinyfeed-verse-post").prop("disabled", on);
    $("#tinyfeed-verse-post .tinyfeed-post-label").text(on ? "กำลังสร้าง..." : "โพสต์");
}
function renderVerseFeed() {
    const body = $("#tinyfeed-verse-tabbody");
    if (!body.length) return;
    // แสดง compose เสมอ (ผู้ใช้โพสต์เองได้แม้ยังไม่ import ตัวละคร; โหมด AI จะเตือนถ้า roster ว่าง)
    body.html(`
        <div class="tinyfeed-compose tinyfeed-verse-compose">
            <div class="tinyfeed-compose-row">
                <div class="tinyfeed-compose-avatar" id="tinyfeed-verse-compose-avatar" title="เลือกคนโพสต์"></div>
                <textarea id="tinyfeed-verse-input" rows="1" placeholder="คุณกำลังคิดอะไรอยู่?"></textarea>
            </div>
            <input id="tinyfeed-verse-guidance" class="tinyfeed-gen-guidance tinyfeed-hidden" type="text" placeholder="แนวทางโพสต์นี้ (ไม่บังคับ)" />
            <div class="tinyfeed-compose-bar">
                <div class="tinyfeed-compose-bar-left">
                    <button id="tinyfeed-verse-img" class="tinyfeed-compose-iconbtn" title="แนบรูปจากคลัง"><i class="fa-solid fa-image"></i></button>
                    <button id="tinyfeed-verse-sticker" class="tinyfeed-compose-iconbtn" title="แนบสติกเกอร์"><i class="fa-regular fa-face-smile"></i></button>
                </div>
                <div class="tinyfeed-compose-bar-right">
                    <button id="tinyfeed-verse-cancel" class="tinyfeed-btn-ghost">ยกเลิก</button>
                    <button id="tinyfeed-verse-post" class="tinyfeed-btn-primary" disabled>
                        <i class="fa-solid fa-wand-magic-sparkles tinyfeed-post-wand tinyfeed-hidden"></i>
                        <span class="tinyfeed-post-label">โพสต์</span>
                    </button>
                </div>
            </div>
        </div>
        <div id="tinyfeed-verse-feed" class="tinyfeed-verse-feed"></div>
    `);
    applyVerseComposeMode();
    renderVerseFeedList();
}
/* วาดใหม่เฉพาะส่วนโพสต์ (ไม่แตะช่องเขียน → ไม่รีเซ็ตข้อความที่ผู้ใช้พิมพ์อยู่)
 * ถ้ากางหน้ารายละเอียดอยู่ ให้วาดหน้านั้นแทน — ทุกจุดที่เรียกฟังก์ชันนี้จึงอัปเดตถูกที่เสมอ */
function renderVerseFeedList() {
    if (versePostId) { renderVerse(); return; }
    const list = $("#tinyfeed-verse-feed");
    if (!list.length) return;
    const feed = getVerse().feed;
    list.html(feed.length
        ? feed.map((p) => renderVersePost(p, false)).join("")
        : emptyInlineHtml("ยังไม่มีโพสต์ · พิมพ์แล้วกดโพสต์ หรือเลือกตัวละครให้ AI โพสต์ให้"));
}
/* วาดโพสต์ TinyVerse — 2 โหมดเหมือน TinyFeed
 *   detail=false (ในฟีด)  : หัว + เนื้อ + [ไลก์][จำนวนคอมเมนต์]  แตะที่การ์ด = เปิดรายละเอียด
 *   detail=true  (หน้าเต็ม): + ปุ่มให้ AI คอมเมนต์ + คอมเมนต์ทั้งหมด + ช่องเขียนคอมเมนต์
 * ปุ่มย่อยทุกตัวต้อง stopPropagation ใน handler ไม่งั้นจะเด้งเข้าหน้ารายละเอียด */
function renderVersePost(post, detail = false) {
    const id = escapeAttr(post.id);
    const cs = Array.isArray(post.comments) ? post.comments : [];
    const comments = detail && cs.length ? `<div class="tinyfeed-comments">${cs.map((c, i) => `
        <div class="tinyfeed-comment">
            ${makeAvatar(c)}
            <div class="tinyfeed-comment-body">
                <span class="tinyfeed-comment-author">${escapeText(c.author)}</span>
                <span class="tinyfeed-comment-text">${renderRich(c.text)}</span>
            </div>
            <span class="tinyfeed-verse-cdel" data-vpost="${id}" data-cidx="${i}" title="ลบคอมเมนต์"><i class="fa-solid fa-trash"></i></span>
        </div>`).join("")}</div>` : "";
    const composer = detail ? commentComposeHtml({
        postId: post.id, dataKey: "vpost",
        inputCls: "tinyfeed-verse-cinput", stickerCls: "tinyfeed-verse-csticker", sendCls: "tinyfeed-verse-csend",
    }) : "";
    const aiBtn = detail
        ? `<span class="tinyfeed-verse-aicomment" data-vpost="${id}" title="ให้ตัวละครอื่นมาคอมเมนต์"><i class="fa-solid fa-wand-magic-sparkles"></i> ให้ตัวละครคอมเมนต์</span>`
        : "";
    return `<div class="tinyfeed-post${detail ? " tinyfeed-post-detail" : ""}" data-vpost="${id}">
        <div class="tinyfeed-post-head">
            ${makeAvatar(post)}
            <div class="tinyfeed-post-meta">
                <span class="tinyfeed-post-author">${escapeText(post.author)}</span>
                <span class="tinyfeed-post-time">${displayTime(post)}</span>
            </div>
            <span class="tinyfeed-verse-del" data-vpost="${id}" title="ลบโพสต์"><i class="fa-solid fa-trash"></i></span>
        </div>
        <div class="tinyfeed-post-body">${renderPostBody(post.text)}</div>
        <div class="tinyfeed-post-actions">
            <span class="tinyfeed-verse-like ${post.liked ? "tinyfeed-liked" : ""}" data-vpost="${id}"><i class="fa-solid fa-heart"></i> ${formatCount(post.likes)}</span>
            <span class="tinyfeed-verse-ccount"><i class="fa-solid fa-comment"></i> ${formatCount(cs.length)}</span>
            ${aiBtn}
        </div>
        ${comments}
        ${composer}
    </div>`;
}
// ผู้ใช้โพสต์เอง (persona) — รองรับ [img:]/[sticker:] เหมือน TinyFeed
function addVerseUserPost(text) {
    const clean = String(text || "").trim();
    if (!clean) return;
    const v = getVerse();
    v.feed.unshift({
        id: "vu" + Date.now(), author: getUserName(), isUser: true, avatar: "",
        ts: Date.now(), text: escapeHtml(clean), likes: randomInitialLikes(), liked: false, comments: [],
    });
    if (v.feed.length > 200) v.feed.length = 200;
    saveVerse();
    renderVerseFeedList();
}
// ให้ตัวละคร (หรือสุ่ม) โพสต์ด้วย AI
async function verseGeneratePost() {
    if (verseBusy) return;
    const v = getVerse();
    const keys = Object.keys(v.chars);
    if (!keys.length) { toastr.info("ยังไม่มีตัวละคร ไปแท็บ 'ตัวละคร' แล้ว Import ก่อนนะ", "TinyVerse"); return; }
    const ctx = getContext();
    if (typeof ctx.generateQuietPrompt !== "function") { toastr.info("เวอร์ชัน ST นี้โพสต์ไม่ได้", "TinyVerse"); return; }
    const key = (versePoster === VERSE_POSTER_RANDOM || !v.chars[versePoster]) ? keys[Math.floor(Math.random() * keys.length)] : versePoster;
    const c = v.chars[key];
    const guidance = String($("#tinyfeed-verse-guidance").val() || "").trim();
    verseBusy = true;
    setVersePostGenerating(true);
    try {
        const q = buildPrompt("versePost", {
            charName: c.name,
            persona: (c.persona || c.bio || "").trim() || "(ไม่มีข้อมูลตัวละครเพิ่มเติม)",
            guidance: (guidance ? `แนวทางของโพสต์นี้: ${guidance}. ` : "") + galleryPromptBlock(),
            context: crossAppContext("verse"),
        });
        const raw = await tinyGenerate(q, verseTokens(), "verse");
        const parsed = parseGeneratedPost(raw, c.name);
        const text = stripWrapBrackets(parsed.text || "");
        if (!text) { toastr.info("ยังไม่มีโพสต์ ลองใหม่นะ", "TinyVerse"); return; }
        v.feed.unshift({
            id: "v" + Date.now(), author: c.name, authorKey: key, avatar: c.avatar || "",
            isAI: true, isVerse: true, ts: Date.now(), text: escapeHtml(text),
            likes: randomInitialLikes(), liked: false, comments: [],
        });
        if (v.feed.length > 200) v.feed.length = 200;
        saveVerse();
        if (currentApp === "verse" && verseTab === "feed") { $("#tinyfeed-verse-guidance").val(""); renderVerseFeedList(); }
    } catch (e) {
        console.error(`[${extensionName}] verseGeneratePost failed:`, e);
        toastr.error("โพสต์ไม่สำเร็จ", "TinyVerse");
    } finally {
        verseBusy = false;
        setVersePostGenerating(false);
        applyVerseComposeMode();
    }
}
function verseFeedPost(id) { return getVerse().feed.find((p) => p.id === id) || null; }

// ===== TinyVerse v2: ครอสโอเวอร์ (คอมเมนต์ข้ามการ์ด + ซีนครอสโอเวอร์) =====
// บล็อกข้อมูลตัวละครสำหรับพรอมป์ (ตัดความยาว persona กันพรอมป์บวม)
function verseRosterBlock(keys, perCharCap) {
    const v = getVerse();
    const cap = perCharCap || 220;
    return keys.map((k) => {
        const c = v.chars[k];
        if (!c) return "";
        const p = String(c.persona || c.bio || "").trim().replace(/\s+/g, " ").slice(0, cap);
        return `- ${c.name}${p ? `: ${p}` : ""}`;
    }).filter(Boolean).join("\n");
}
// จับคู่ชื่อที่ AI ตอบกลับ → การ์ดใน roster (เพื่อใส่ avatar ให้ตรงตัว)
function verseAvatarForName(name) {
    const c = verseCardByName(name);
    return c ? (c.avatar || "") : "";
}
// ให้ตัวละครอื่น "ข้ามการ์ด" มาคอมเมนต์โพสต์
async function verseGenerateComments(postId) {
    if (verseBusy) return;
    const v = getVerse();
    const post = verseFeedPost(postId);
    if (!post) return;
    const ctx = getContext();
    if (typeof ctx.generateQuietPrompt !== "function") { toastr.info("เวอร์ชัน ST นี้ใช้ AI ไม่ได้", "TinyVerse"); return; }
    // ผู้คอมเมนต์ = ตัวละครใน roster ที่ไม่ใช่เจ้าของโพสต์
    const others = Object.keys(v.chars).filter((k) => k !== post.authorKey && v.chars[k].name !== post.author);
    if (!others.length) { toastr.info("ต้องมีตัวละครอย่างน้อย 2 ตัวถึงจะคอมเมนต์ข้ามการ์ดได้", "TinyVerse"); return; }
    verseBusy = true;
    $(`.tinyfeed-verse-aicomment[data-vpost="${postId}"]`).addClass("tinyfeed-generating");
    try {
        const q = buildPrompt("verseComments", {
            author: post.author,
            post: htmlToPlain(post.text),
            roster: verseRosterBlock(others.slice(0, 12)),
        });
        const raw = await tinyGenerate(q, Math.max(80, verseTokens()), "verse");
        const parsed = parseCommentLines(raw, post.author, "COMMENT");
        // กันคอมเมนต์จากเจ้าของโพสต์เอง + ใส่ avatar ตามตัวจริงใน roster
        const authorLc = String(post.author).trim().toLowerCase();
        const list = parsed
            .filter((c) => String(c.author).trim().toLowerCase() !== authorLc)
            .map((c) => ({ author: c.author, avatar: verseAvatarForName(c.author), text: c.text }));
        if (!list.length) { toastr.info("ยังไม่มีคอมเมนต์ ลองใหม่นะ", "TinyVerse"); return; }
        if (!Array.isArray(post.comments)) post.comments = [];
        post.comments.push(...list);
        saveVerse();
        renderVerseFeedList();
    } catch (e) {
        console.error(`[${extensionName}] verseGenerateComments failed:`, e);
        toastr.error("สร้างคอมเมนต์ไม่สำเร็จ", "TinyVerse");
    } finally {
        verseBusy = false;
        $(".tinyfeed-verse-aicomment").removeClass("tinyfeed-generating");
    }
}
// ผู้ใช้คอมเมนต์เองในฟีดโกลบอล
function addVerseComment(postId, text) {
    const clean = String(text || "").trim();
    if (!clean) return;
    const post = verseFeedPost(postId);
    if (!post) return;
    if (!Array.isArray(post.comments)) post.comments = [];
    post.comments.push({ author: getUserName(), isUser: true, avatar: "", text: escapeHtml(clean) });
    saveVerse();
    renderVerseFeedList();
}

// หมายเหตุ: ฟีเจอร์ "ซีนครอสโอเวอร์" ย้ายไปเป็นแอป TinyTheater แล้ว (โหมด "ตอนเดียวจบ")
// ซีนเก่าใน verse.scenes จะถูกย้ายอัตโนมัติครั้งเดียวโดย migrateVerseScenes()

// ===== TinyTheater (แอปที่ 11): มินิเธียเตอร์ What if — หน้าตาแบบแอปสตรีมมิ่ง =====
// data: extension_settings[ext].theater = { shows: [ { id,title,whatIf,genre,cover,castKeys,castNames,oneShot,episodes:[{no,title,blocks:[{type,author,avatar,text}],ts}],ts,updatedTs } ] }
const THEATER_GENRES = ["โรแมนซ์", "ตลก", "ดราม่า", "สยองขวัญ", "แอ็กชัน", "ลึกลับ", "อบอุ่นหัวใจ", "แฟนตาซี"];
// โจทย์สำเร็จรูปสำหรับปุ่มสุ่ม — {A}/{B} จะถูกแทนด้วยชื่อนักแสดงที่เลือกไว้
const THEATER_WHATIF_PRESETS = [
    "ถ้า {A} กับ {B} ตื่นมาแล้วสลับร่างกัน",
    "ถ้า {A} กับ {B} ติดอยู่ในลิฟต์ด้วยกันทั้งคืน",
    "ถ้า {A} ย้อนเวลากลับไปเจอ {B} ตอนเด็ก",
    "ถ้า {A} กับ {B} ต้องมาเปิดร้านกาแฟด้วยกัน",
    "ถ้าทุกคนจำ {A} ไม่ได้เลย ยกเว้น {B}",
    "ถ้า {A} กับ {B} ติดอยู่ในวันเดิมซ้ำๆ ไม่รู้จบ",
    "ถ้า {A} อ่านใจ {B} ได้เป็นเวลา 1 วัน",
    "ถ้า {A} กับ {B} สลับโลกกันอยู่ — ต่างคนต่างหลุดเข้าไปในโลกของอีกฝ่าย",
    "ถ้า {A} ต้องแกล้งเป็นแฟนกับ {B} เพื่อเอาตัวรอดจากสถานการณ์หนึ่ง",
    "ถ้า {A} กับ {B} เจอกันในโรงเรียนมัธยมยุคปัจจุบัน",
    "ถ้าโลกกำลังจะแตกในอีก 24 ชั่วโมง แล้ว {A} เลือกไปหา {B}",
    "ถ้า {A} กลายเป็นแมวเป็นเวลา 1 สัปดาห์ และมีแต่ {B} ที่ดูแลได้",
    "ถ้า {A} กับ {B} ต้องร่วมมือกันทั้งที่เกลียดขี้หน้ากัน",
    "ถ้า {A} ค้นพบความลับที่ {B} ปกปิดมาตลอด",
    "ถ้า {A} กับ {B} ได้เป็นเพื่อนร่วมห้องกันโดยบังเอิญ",
];
// สุ่มโจทย์จาก preset แล้วเติมชื่อนักแสดงที่เลือก (ไม่ได้เลือก = ใช้คำกลางๆ)
function theaterRandomWhatIf() {
    const names = theaterCastSel.map(theaterCastName).filter(Boolean);
    const a = names[0] || "ตัวละคร A";
    const b = names[1] || (names.length === 1 ? "อีกฝ่าย" : "ตัวละคร B");
    const p = THEATER_WHATIF_PRESETS[Math.floor(Math.random() * THEATER_WHATIF_PRESETS.length)];
    return p.split("{A}").join(a).split("{B}").join(b);
}
const THEATER_LENGTHS = {
    oneshot: { label: "ตอนเดียวจบ", hint: "เรื่องสั้นจบในตอน เน้นบทสนทนา", tokens: 500 },
    short: { label: "สั้น", hint: "อ่านเร็ว ~1 นาที", tokens: 450 },
    medium: { label: "กลาง", hint: "กำลังดี", tokens: 800 },
    long: { label: "ยาว", hint: "จัดเต็ม", tokens: 1200 },
};
// คำอธิบาย persona ของผู้ใช้จาก ST (ตั้งในหน้า Persona) — ไม่มีก็คืน ""
function userPersonaDesc() {
    try {
        const ctx = getContext();
        const d = ctx && ctx.powerUserSettings ? ctx.powerUserSettings.persona_description : "";
        return String(d || "").trim().replace(/\s+/g, " ").slice(0, 400);
    } catch (e) { return ""; }
}
// roster สำหรับพรอมป์ที่รองรับ "ผู้ใช้" ร่วมแสดง (POSTER_USER ปนใน keys ได้)
function theaterRosterBlock(keys, cap) {
    const lines = [];
    const charKeys = [];
    for (const k of keys) {
        if (k === POSTER_USER) {
            const d = userPersonaDesc();
            lines.push(`- ${getUserName()} (ตัวละครของผู้เล่น)${d ? `: ${d}` : ""}`);
        } else charKeys.push(k);
    }
    const rest = verseRosterBlock(charKeys, cap);
    return [lines.join("\n"), rest].filter(Boolean).join("\n");
}
function theaterCastName(k) { return k === POSTER_USER ? getUserName() : ((getVerse().chars[k] || {}).name || ""); }
// ผู้ใช้ร่วมแสดง → อนุญาตให้ AI เขียนบทให้ persona ของเราได้ (ปกติห้าม)
function theaterUserRule(keys) {
    return keys.includes(POSTER_USER)
        ? `หมายเหตุ: ${getUserName()} เป็นตัวละครของผู้เล่นที่ร่วมแสดงในเรื่องนี้ด้วย — เขียนบทพูด/การกระทำให้ ${getUserName()} ได้เลย ให้สมกับข้อมูลตัวละครที่ให้ไว้.`
        : `ห้ามพูดหรือกระทำแทนผู้ใช้.`;
}
function getTheater() {
    const store = extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (!store.theater || typeof store.theater !== "object") store.theater = { shows: [] };
    if (!Array.isArray(store.theater.shows)) store.theater.shows = [];
    return store.theater;
}
function saveTheater() { saveSettingsDebounced(); }
function theaterShow(id) { return getTheater().shows.find((s) => s.id === id) || null; }
function theaterLength(key) { return THEATER_LENGTHS[key] || THEATER_LENGTHS.medium; }
// ย้ายซีนเก่าจาก TinyVerse มาเป็นเรื่อง "ตอนเดียวจบ" (ครั้งเดียว)
function migrateVerseScenes() {
    const v = getVerse();
    if (!Array.isArray(v.scenes) || !v.scenes.length) return;
    const t = getTheater();
    for (const s of v.scenes) {
        t.shows.push({
            id: "sh" + (s.id || Date.now()), title: s.title || "ซีนครอสโอเวอร์", whatIf: s.setting || "",
            genre: "", cover: "", castKeys: s.charKeys || [], castNames: s.charNames || [], oneShot: true,
            episodes: [{ no: 1, title: s.title || "", blocks: (s.lines || []).map((l) => ({ type: "line", author: l.author, avatar: l.avatar || "", text: l.text })), ts: s.ts || Date.now() }],
            ts: s.ts || Date.now(), updatedTs: s.ts || Date.now(),
        });
    }
    v.scenes = [];
    saveTheater();
    console.log(`[${extensionName}] migrated ${t.shows.length} verse scene(s) → TinyTheater`);
}
// แยกผลลัพธ์ AI เป็นบล็อก (TITLE / EPTITLE / NARRATION / LINE: ชื่อ | ข้อความ)
function parseTheaterBlocks(raw, fallbackName) {
    const s = stripReasoning(raw);
    const out = { title: "", epTitle: "", blocks: [] };
    for (const line of String(s).split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        let m;
        if ((m = t.match(/^TITLE:\s*(.+)$/i))) { if (!out.title) out.title = stripWrapBrackets(m[1].trim()); continue; }
        if ((m = t.match(/^EPTITLE:\s*(.+)$/i))) { if (!out.epTitle) out.epTitle = stripWrapBrackets(m[1].trim()); continue; }
        if ((m = t.match(/^NARRATION:\s*(.+)$/i))) {
            const txt = m[1].trim();
            if (txt) out.blocks.push({ type: "narration", text: escapeHtml(stripWrapBrackets(txt)) });
            continue;
        }
        if ((m = t.match(/^LINE:\s*(.+)$/i))) {
            const parts = m[1].split("|");
            let author = parts.length >= 2 ? parts[0].trim() : fallbackName;
            let txt = parts.length >= 2 ? parts.slice(1).join("|").trim() : m[1].trim();
            author = author.replace(/^["'“”\[\(]+|["'“”\]\)]+$/g, "").trim() || fallbackName;
            if (txt) out.blocks.push({ type: "line", author, avatar: verseAvatarForName(author), text: escapeHtml(stripWrapBrackets(txt)) });
            continue;
        }
    }
    return out;
}
// สรุปเนื้อเรื่องที่ผ่านมาเป็นข้อความ (ป้อนให้ AI เขียนตอนต่อ) — ตัดท้ายกันพรอมป์บวม
function theaterStorySoFar(show, cap) {
    const lines = [];
    for (const ep of show.episodes) {
        lines.push(`[ตอนที่ ${ep.no}${ep.title ? ` — ${ep.title}` : ""}]`);
        for (const b of ep.blocks) {
            const txt = htmlToPlain(b.text);
            lines.push(b.type === "line" ? `${b.author}: ${txt}` : txt);
        }
    }
    const all = lines.join("\n");
    const max = cap || 2500;
    return all.length > max ? "…\n" + all.slice(all.length - max) : all;   // เก็บส่วนท้าย (ล่าสุด) ไว้
}

// ── หน้าจอ: browse (กริดปก) / create (What if) / read (อ่าน) ──
let theaterScreen = "browse";
let theaterShowId = null;
let theaterEpIdx = 0;
let theaterCastSel = [];
let theaterCover = "";
let theaterBusy = false;
let theaterWhatIfIdeas = [];   // ไอเดียโจทย์ที่ AI เสนอ (โชว์เป็นชิปให้กดเลือก)
// ให้ AI คิดโจทย์ What if ให้ 3 แบบ (อิงนักแสดงที่เลือก)
async function theaterSuggestWhatIf() {
    if (theaterBusy) return;
    const v = getVerse();
    const keys = theaterCastSel.filter((k) => k === POSTER_USER || v.chars[k]);
    if (!keys.length) { toastr.info("เลือกนักแสดงก่อน แล้ว AI จะคิดโจทย์ให้เข้ากับตัวละคร", "TinyTheater"); return; }
    const ctx = getContext();
    if (typeof ctx.generateQuietPrompt !== "function") { toastr.info("เวอร์ชัน ST นี้ใช้ AI ไม่ได้", "TinyTheater"); return; }
    const genre = String($("#tinyfeed-th-genre").val() || "").trim();
    theaterBusy = true;
    $("#tinyfeed-th-ai").addClass("tinyfeed-generating");
    try {
        const q = buildPrompt("theaterWhatIf", {
            chars: keys.map(theaterCastName).filter(Boolean).join(", "),
            roster: theaterRosterBlock(keys, 300),
            genre: genre || "(อิสระ)",
        });
        const raw = await tinyGenerate(q, 220, "theater");
        const ideas = [];
        const re = /WHATIF:\s*(.+)/gi;
        let m;
        while ((m = re.exec(stripReasoning(raw))) !== null) {
            const t = stripWrapBrackets(m[1].trim());
            if (t) ideas.push(t);
        }
        if (!ideas.length) { toastr.info("ยังคิดโจทย์ไม่ออก ลองใหม่นะ", "TinyTheater"); return; }
        theaterWhatIfIdeas = ideas.slice(0, 5);
        renderTheaterWhatIfIdeas();
    } catch (e) {
        console.error(`[${extensionName}] theaterSuggestWhatIf failed:`, e);
        toastr.error("คิดโจทย์ไม่สำเร็จ", "TinyTheater");
    } finally {
        theaterBusy = false;
        $("#tinyfeed-th-ai").removeClass("tinyfeed-generating");
    }
}
// วาดชิปไอเดีย (แยกจาก renderTheaterCreate เพื่ออัปเดตได้โดยไม่ล้างช่องที่กรอกไว้)
function renderTheaterWhatIfIdeas() {
    const box = $("#tinyfeed-th-ideas");
    if (!box.length) return;
    if (!theaterWhatIfIdeas.length) { box.empty(); return; }
    box.html(`<div class="tinyfeed-th-ideahead">แตะเพื่อใช้โจทย์นี้</div>` +
        theaterWhatIfIdeas.map((t, i) => `<div class="tinyfeed-th-idea" data-idea="${i}">${escapeText(t)}</div>`).join(""));
}
function openTheater() { theaterScreen = "browse"; theaterShowId = null; renderTheater(); }
function renderTheater() {
    const body = $("#tinyfeed-theater-body");
    if (!body.length) return;
    if (theaterScreen === "create") renderTheaterCreate();
    else if (theaterScreen === "read") renderTheaterRead();
    else renderTheaterBrowse();
}
// ปกเรื่อง: รูปที่เลือก > avatar นักแสดงคนแรก > ไล่เฉดสี
function theaterPosterHtml(show) {
    if (show.cover) return `<div class="tinyfeed-th-poster" style="background-image:url('${escapeAttr(show.cover)}')"></div>`;
    // ไล่หา avatar ตัวแรกที่ใช้ได้ (รองรับ persona ของผู้ใช้ที่ร่วมแสดง)
    for (const k of (show.castKeys || [])) {
        const url = k === POSTER_USER ? getUserAvatar() : ((getVerse().chars[k] || {}).avatar || "");
        if (url) return `<div class="tinyfeed-th-poster" style="background-image:url('${escapeAttr(url)}')"></div>`;
    }
    return `<div class="tinyfeed-th-poster tinyfeed-th-poster-blank"><i class="fa-solid fa-masks-theater"></i></div>`;
}
function renderTheaterBrowse() {
    const shows = getTheater().shows.slice().sort((a, b) => (b.updatedTs || b.ts || 0) - (a.updatedTs || a.ts || 0));
    const cards = shows.map((s) => `
        <div class="tinyfeed-th-card" data-show="${escapeAttr(s.id)}">
            ${theaterPosterHtml(s)}
            <div class="tinyfeed-th-cardtitle">${escapeText(s.title || "ไม่มีชื่อเรื่อง")}</div>
            <div class="tinyfeed-th-cardmeta">${s.oneShot ? "จบในตอน" : `${s.episodes.length} ตอน`}${s.genre ? ` · ${escapeText(s.genre)}` : ""}</div>
        </div>`).join("");
    $("#tinyfeed-theater-body").html(`
        <div class="tinyfeed-th-hero">
            <div class="tinyfeed-th-herotitle">🎬 มินิเธียเตอร์</div>
            <div class="tinyfeed-th-herosub">เลือกตัวละคร ตั้งโจทย์ “What if…” แล้วให้ AI เขียนเป็นเรื่อง</div>
            <button id="tinyfeed-th-new" class="tinyfeed-btn-primary tinyfeed-th-newbtn"><i class="fa-solid fa-plus"></i> สร้างเรื่องใหม่</button>
        </div>
        ${shows.length
            ? `<div class="tinyfeed-th-sectitle">คลังเรื่อง</div><div class="tinyfeed-th-grid">${cards}</div>`
            : emptyStateHtml("fa-clapperboard", "ยังไม่มีเรื่อง", "กด \"สร้างเรื่องใหม่\" เพื่อเปิดโรงละครแรกของคุณ")}
    `);
}
function renderTheaterCreate() {
    const v = getVerse();
    const keys = Object.keys(v.chars).sort((a, b) => (v.chars[b].addedTs || 0) - (v.chars[a].addedTs || 0));
    // ไม่มีตัวละครก็ยังสร้างได้ (แสดงเดี่ยวด้วย persona ของเรา) — แค่ใบ้ให้ไป import
    // การ์ดแรก = persona ของเรา (ร่วมแสดงได้)
    const userOn = theaterCastSel.includes(POSTER_USER);
    const userPick = `<div class="tinyfeed-th-castpick${userOn ? " tinyfeed-th-castpick-on" : ""}" data-key="${POSTER_USER}" title="persona ของคุณ">
            ${makeAvatar({ isUser: true, author: getUserName() })}
            <span class="tinyfeed-th-castname">${escapeText(getUserName())}<br><small>(คุณ)</small></span>
        </div>`;
    const picks = userPick + keys.map((k) => {
        const c = v.chars[k];
        const on = theaterCastSel.includes(k);
        return `<div class="tinyfeed-th-castpick${on ? " tinyfeed-th-castpick-on" : ""}" data-key="${escapeAttr(k)}">
            ${makeAvatar({ avatar: c.avatar || "", author: c.name })}
            <span class="tinyfeed-th-castname">${escapeText(c.name)}</span>
        </div>`;
    }).join("");
    const genres = THEATER_GENRES.map((g) => `<div class="tinyfeed-th-genre" data-genre="${escapeAttr(g)}">${escapeText(g)}</div>`).join("");
    const lens = Object.keys(THEATER_LENGTHS).map((k) => `<option value="${k}">${THEATER_LENGTHS[k].label} — ${THEATER_LENGTHS[k].hint}</option>`).join("");
    $("#tinyfeed-theater-body").html(`
        <div class="tinyfeed-th-head">
            <button id="tinyfeed-th-back" class="tinyfeed-btn-ghost"><i class="fa-solid fa-arrow-left"></i> กลับ</button>
            <span class="tinyfeed-th-headtitle">สร้างเรื่องใหม่</span>
        </div>
        <div class="tinyfeed-th-formsec">
            <div class="tinyfeed-th-label">นักแสดง <small>(เลือก 1-4 ตัว · ครอสโอเวอร์ได้ · ใส่ตัวคุณเองก็ได้)</small> <span class="tinyfeed-th-selcount">เลือกแล้ว ${theaterCastSel.length}</span></div>
            <div class="tinyfeed-th-casts">${picks}</div>
            ${keys.length ? "" : `<div class="tinyfeed-th-hint">ยังไม่มีตัวละครอื่น — ไป <b>TinyVerse › ตัวละคร</b> กด Import เพื่อให้มาร่วมแสดงได้</div>`}
        </div>
        <div class="tinyfeed-th-formsec">
            <div class="tinyfeed-th-label">What if… <small>(หัวใจของเรื่อง)</small></div>
            <textarea id="tinyfeed-th-whatif" class="tinyfeed-th-whatif" rows="3" placeholder="เช่น ถ้าทั้งคู่ตื่นมาแล้วสลับร่างกัน…"></textarea>
            <div class="tinyfeed-th-whatiftools">
                <button id="tinyfeed-th-dice" class="tinyfeed-btn-ghost tinyfeed-th-toolbtn" title="สุ่มโจทย์สำเร็จรูป">🎲 สุ่มโจทย์</button>
                <button id="tinyfeed-th-ai" class="tinyfeed-btn-ghost tinyfeed-th-toolbtn" title="ให้ AI คิดโจทย์จากตัวละครที่เลือก"><i class="fa-solid fa-wand-magic-sparkles"></i> ให้ AI คิดให้</button>
            </div>
            <div id="tinyfeed-th-ideas" class="tinyfeed-th-ideas"></div>
        </div>
        <div class="tinyfeed-th-formsec">
            <div class="tinyfeed-th-label">แนวเรื่อง <small>(เลือกหรือพิมพ์เองก็ได้)</small></div>
            <div class="tinyfeed-th-genres">${genres}</div>
            <input id="tinyfeed-th-genre" class="tinyfeed-gen-guidance tinyfeed-th-genreinput" type="text" placeholder="แนวเรื่อง" />
        </div>
        <div class="tinyfeed-th-formsec">
            <div class="tinyfeed-th-label">ความยาว</div>
            <select id="tinyfeed-th-length" class="tinyfeed-th-length">${lens}</select>
        </div>
        <div class="tinyfeed-th-formsec">
            <div class="tinyfeed-th-label">ปกเรื่อง <small>(ไม่บังคับ)</small></div>
            <div class="tinyfeed-th-coverrow">
                <div id="tinyfeed-th-coverprev" class="tinyfeed-th-coverprev">${theaterCover ? `<img src="${escapeAttr(theaterCover)}" />` : `<i class="fa-solid fa-image"></i>`}</div>
                <button id="tinyfeed-th-cover" class="tinyfeed-btn-ghost">เลือกจากคลังรูป</button>
                ${theaterCover ? `<button id="tinyfeed-th-coverclear" class="tinyfeed-btn-ghost">ล้าง</button>` : ""}
            </div>
        </div>
        <button id="tinyfeed-th-create" class="tinyfeed-btn-primary tinyfeed-th-createbtn">
            <i class="fa-solid fa-wand-magic-sparkles tinyfeed-th-wand"></i> <span class="tinyfeed-th-createlabel">เปิดม่าน! สร้างเรื่อง</span>
        </button>
    `);
    $("#tinyfeed-th-length").val("medium");
    renderTheaterWhatIfIdeas();   // คงไอเดียที่ AI เสนอไว้ข้ามการ re-render (เช่น ตอนสลับนักแสดง)
}
function renderTheaterRead() {
    const show = theaterShow(theaterShowId);
    if (!show) { theaterScreen = "browse"; renderTheater(); return; }
    const idx = Math.max(0, Math.min(theaterEpIdx, show.episodes.length - 1));
    theaterEpIdx = idx;
    const ep = show.episodes[idx];
    const cast = (show.castNames || []).join(" × ");
    const eps = show.episodes.map((e, i) => `<div class="tinyfeed-th-epchip${i === idx ? " tinyfeed-th-epchip-on" : ""}" data-ep="${i}">EP${e.no}</div>`).join("");
    const blocks = ep.blocks.map((b) => b.type === "line"
        ? `<div class="tinyfeed-th-line">
                ${makeAvatar({ avatar: b.avatar || "", author: b.author })}
                <div class="tinyfeed-th-linebody"><span class="tinyfeed-th-lineauthor">${escapeText(b.author)}</span><span class="tinyfeed-th-linetext">${renderRich(b.text)}</span></div>
           </div>`
        : `<div class="tinyfeed-th-narration">${renderRich(b.text)}</div>`).join("");
    $("#tinyfeed-theater-body").html(`
        <div class="tinyfeed-th-readhero">
            ${theaterPosterHtml(show)}
            <div class="tinyfeed-th-readovl">
                <button id="tinyfeed-th-back" class="tinyfeed-th-backbtn"><i class="fa-solid fa-arrow-left"></i></button>
                <span class="tinyfeed-th-deleteshow" data-show="${escapeAttr(show.id)}" title="ลบเรื่องนี้"><i class="fa-solid fa-trash"></i></span>
            </div>
        </div>
        <div class="tinyfeed-th-readbody">
            <div class="tinyfeed-th-readtitle">${escapeText(show.title || "ไม่มีชื่อเรื่อง")}</div>
            <div class="tinyfeed-th-readmeta">${escapeText(cast)}${show.genre ? ` · ${escapeText(show.genre)}` : ""} · ${show.oneShot ? "จบในตอน" : `${show.episodes.length} ตอน`}</div>
            ${show.whatIf ? `<div class="tinyfeed-th-whatifbox"><b>What if…</b> ${escapeText(show.whatIf)}</div>` : ""}
            ${show.episodes.length > 1 ? `<div class="tinyfeed-th-eps">${eps}</div>` : ""}
            ${ep.title ? `<div class="tinyfeed-th-eptitle">EP${ep.no} · ${escapeText(ep.title)}</div>` : ""}
            <div class="tinyfeed-th-story">${blocks}</div>
            ${show.oneShot ? "" : `<button id="tinyfeed-th-next" class="tinyfeed-btn-primary tinyfeed-th-nextbtn">
                <i class="fa-solid fa-wand-magic-sparkles tinyfeed-th-wand"></i> <span class="tinyfeed-th-nextlabel">เขียนตอนต่อไป</span>
            </button>`}
        </div>
    `);
}
function setTheaterGenerating(on, labelSel, busyText, idleText) {
    $(".tinyfeed-th-wand").toggleClass("tinyfeed-spin", on);
    $("#tinyfeed-th-create, #tinyfeed-th-next").prop("disabled", on);
    $(labelSel).text(on ? busyText : idleText);
}
// สร้างเรื่องใหม่ (ตอนที่ 1 + ตั้งชื่อเรื่อง)
async function theaterCreateShow() {
    if (theaterBusy) return;
    const v = getVerse();
    const keys = theaterCastSel.filter((k) => k === POSTER_USER || v.chars[k]);   // POSTER_USER = persona ของเรา
    if (!keys.length) { toastr.info("เลือกนักแสดงอย่างน้อย 1 ตัวนะ", "TinyTheater"); return; }
    const whatIf = String($("#tinyfeed-th-whatif").val() || "").trim();
    if (!whatIf) { toastr.info("ใส่โจทย์ What if… ก่อนนะ", "TinyTheater"); return; }
    const ctx = getContext();
    if (typeof ctx.generateQuietPrompt !== "function") { toastr.info("เวอร์ชัน ST นี้ใช้ AI ไม่ได้", "TinyTheater"); return; }
    const genre = String($("#tinyfeed-th-genre").val() || "").trim();
    const lenKey = String($("#tinyfeed-th-length").val() || "medium");
    const len = theaterLength(lenKey);
    const names = keys.map(theaterCastName).filter(Boolean);
    theaterBusy = true;
    setTheaterGenerating(true, ".tinyfeed-th-createlabel", "กำลังเปิดม่าน...", "เปิดม่าน! สร้างเรื่อง");
    try {
        const q = buildPrompt("theaterEpisode", {
            chars: names.join(", "), roster: theaterRosterBlock(keys, 300), whatIf,
            genre: genre || "(อิสระ)", length: `${len.label} — ${len.hint}`,
            userRule: theaterUserRule(keys),
        });
        const raw = await tinyGenerate(q, len.tokens, "theater");
        const parsed = parseTheaterBlocks(raw, names[0]);
        if (!parsed.blocks.length) { toastr.info("ยังเขียนไม่ออก ลองใหม่หรือปรับโจทย์นะ", "TinyTheater"); return; }
        const show = {
            id: "sh" + Date.now(), title: parsed.title || names.join(" × "), whatIf, genre,
            cover: theaterCover || "", castKeys: keys.slice(), castNames: names.slice(),
            oneShot: lenKey === "oneshot", lengthKey: lenKey,   // เก็บไว้ให้ตอนต่อไปใช้ความยาวเดิม
            episodes: [{ no: 1, title: parsed.epTitle || "", blocks: parsed.blocks, ts: Date.now() }],
            ts: Date.now(), updatedTs: Date.now(),
        };
        getTheater().shows.unshift(show);
        saveTheater();
        theaterCastSel = []; theaterCover = ""; theaterWhatIfIdeas = [];
        theaterShowId = show.id; theaterEpIdx = 0; theaterScreen = "read";
        renderTheater();
    } catch (e) {
        console.error(`[${extensionName}] theaterCreateShow failed:`, e);
        toastr.error("สร้างเรื่องไม่สำเร็จ", "TinyTheater");
    } finally {
        theaterBusy = false;
        setTheaterGenerating(false, ".tinyfeed-th-createlabel", "กำลังเปิดม่าน...", "เปิดม่าน! สร้างเรื่อง");
    }
}
// เขียนตอนต่อไป (ต่อเนื้อเรื่องเดิม)
async function theaterNextEpisode() {
    if (theaterBusy) return;
    const show = theaterShow(theaterShowId);
    if (!show) return;
    const ctx = getContext();
    if (typeof ctx.generateQuietPrompt !== "function") { toastr.info("เวอร์ชัน ST นี้ใช้ AI ไม่ได้", "TinyTheater"); return; }
    const v = getVerse();
    const keys = (show.castKeys || []).filter((k) => k === POSTER_USER || v.chars[k]);
    const len = theaterLength(show.lengthKey || "medium");
    const epNo = show.episodes.length + 1;
    theaterBusy = true;
    setTheaterGenerating(true, ".tinyfeed-th-nextlabel", "กำลังเขียน...", "เขียนตอนต่อไป");
    try {
        const q = buildPrompt("theaterNext", {
            chars: (show.castNames || []).join(", "),
            roster: keys.length ? theaterRosterBlock(keys, 300) : (show.castNames || []).map((n) => `- ${n}`).join("\n"),
            whatIf: show.whatIf || "(ไม่ระบุ)", genre: show.genre || "(อิสระ)",
            length: `${len.label} — ${len.hint}`, epNo: String(epNo), story: theaterStorySoFar(show),
            userRule: theaterUserRule(keys),
        });
        const raw = await tinyGenerate(q, len.tokens, "theater");
        const parsed = parseTheaterBlocks(raw, (show.castNames || [])[0] || "");
        if (!parsed.blocks.length) { toastr.info("ยังเขียนต่อไม่ออก ลองใหม่นะ", "TinyTheater"); return; }
        show.episodes.push({ no: epNo, title: parsed.epTitle || "", blocks: parsed.blocks, ts: Date.now() });
        show.updatedTs = Date.now();
        saveTheater();
        theaterEpIdx = show.episodes.length - 1;
        renderTheater();
    } catch (e) {
        console.error(`[${extensionName}] theaterNextEpisode failed:`, e);
        toastr.error("เขียนตอนต่อไม่สำเร็จ", "TinyTheater");
    } finally {
        theaterBusy = false;
        setTheaterGenerating(false, ".tinyfeed-th-nextlabel", "กำลังเขียน...", "เขียนตอนต่อไป");
    }
}
function theaterDeleteShow(id) {
    const t = getTheater();
    const i = t.shows.findIndex((s) => s.id === id);
    if (i < 0) return;
    t.shows.splice(i, 1);
    saveTheater();
    theaterScreen = "browse"; theaterShowId = null;
    renderTheater();
}

// ── ตัวเลือกคนโพสต์ (เรา / สุ่ม / ตัวละครใน roster) — แตะรูปโปรไฟล์ในช่องเขียน ──
function openVersePosterPicker() {
    const v = getVerse();
    const keys = Object.keys(v.chars).sort((a, b) => (v.chars[b].addedTs || 0) - (v.chars[a].addedTs || 0));
    const rows = [];
    rows.push(`<div class="tinyfeed-verse-poster-pick" data-vposter="${POSTER_USER}">${makeAvatar({ isUser: true, author: getUserName() })}<span class="tinyfeed-char-pick-name">${escapeText(getUserName())} (คุณ)</span></div>`);
    if (keys.length) rows.push(`<div class="tinyfeed-verse-poster-pick" data-vposter="${VERSE_POSTER_RANDOM}"><div class="tinyfeed-avatar tinyfeed-avatar-auto"><i class="fa-solid fa-shuffle"></i></div><span class="tinyfeed-char-pick-name">🎲 สุ่มตัวละคร (AI)</span></div>`);
    keys.forEach((k) => {
        const c = v.chars[k];
        rows.push(`<div class="tinyfeed-verse-poster-pick" data-vposter="${escapeAttr(k)}">${makeAvatar({ avatar: c.avatar || "", author: c.name })}<span class="tinyfeed-char-pick-name">${escapeText(c.name)} (AI)</span></div>`);
    });
    $("#tinyfeed-verse-poster-list").html(rows.join(""));
    $("#tinyfeed-verse-poster-modal").removeClass("tinyfeed-hidden");
}
function closeVersePosterPicker() { $("#tinyfeed-verse-poster-modal").addClass("tinyfeed-hidden"); }

// ── หน้าโปรไฟล์ตัวละคร (component ใช้ร่วม: TinyVerse + TinyFeed) ──
let charProfileCtx = null;
// ref = charKey (string) | ชื่อผู้เขียน (string) | การ์ด normalize แล้ว (object)
function openCharProfile(ref) {
    let card = null;
    if (ref && typeof ref === "object") card = ref;
    else if (getVerse().chars[ref]) card = getVerse().chars[ref];
    else card = charCardForAuthor(ref);
    if (!card) return;
    charProfileCtx = card;
    renderCharProfile(card);
    $("#tinyfeed-char-profile").removeClass("tinyfeed-hidden");
}
function closeCharProfile() { $("#tinyfeed-char-profile").addClass("tinyfeed-hidden"); charProfileCtx = null; }
function renderCharProfile(card) {
    const body = $("#tinyfeed-char-profile-body");
    if (!body.length) return;
    const inRoster = !!(card.key && getVerse().chars[card.key]);
    const av = makeAvatar({ avatar: card.avatar || "", author: card.name, isUser: !!card.isUser });
    const npcs = Array.isArray(card.npcs) ? card.npcs : [];
    const bio = String(card.bio || "").trim();
    const roleTag = card.isUser ? "คุณ" : card.isNpc ? "NPC" : "ตัวละคร";
    const addBtn = (card.key && !inRoster && !card.isUser) ? `<button id="tinyfeed-vprofile-add" class="tinyfeed-btn-ghost tinyfeed-vprofile-addbtn"><i class="fa-solid fa-plus"></i> เพิ่มเข้า TinyVerse</button>` : "";
    const removeBtn = inRoster ? `<button id="tinyfeed-vprofile-remove" class="tinyfeed-vprofile-remove" title="เอาออกจาก TinyVerse"><i class="fa-solid fa-trash"></i></button>` : "";
    const personaBox = inRoster ? `
        <div class="tinyfeed-vprofile-section">
            <div class="tinyfeed-vprofile-sectitle">persona (ให้ AI ใช้พูดแทนตัวนี้ใน TinyVerse)</div>
            <textarea id="tinyfeed-vprofile-persona" class="tinyfeed-vprofile-persona" placeholder="อธิบายนิสัย/ภูมิหลัง/วิธีพูด...">${escapeText(card.persona || bio || "")}</textarea>
            <button id="tinyfeed-vprofile-save" class="tinyfeed-btn-primary tinyfeed-vprofile-savebtn"><i class="fa-solid fa-check"></i> บันทึก persona</button>
        </div>` : "";
    const npcHtml = npcs.length ? `
        <div class="tinyfeed-vprofile-section">
            <div class="tinyfeed-vprofile-sectitle">NPC ในสังกัด (${npcs.length})</div>
            <div class="tinyfeed-vprofile-npcs">${npcs.map((n) => `
                <div class="tinyfeed-vprofile-npc" data-npc="${escapeAttr(n.name)}">${makeAvatar({ avatar: n.avatar || "", author: n.name })}<span>${escapeText(n.name)}</span></div>`).join("")}</div>
        </div>` : "";
    body.html(`
        <div class="tinyfeed-vprofile-head">
            <div class="tinyfeed-vprofile-ava">${av}</div>
            <div class="tinyfeed-vprofile-name">${escapeText(card.name)} <span class="tinyfeed-vprofile-role">${roleTag}</span></div>
            ${bio ? `<div class="tinyfeed-vprofile-bio">${escapeText(bio)}</div>` : ""}
            ${(addBtn || removeBtn) ? `<div class="tinyfeed-vprofile-actions">${addBtn}${removeBtn}</div>` : ""}
        </div>
        ${personaBox}
        ${npcHtml}
    `);
}

// TinyMemo: กำหนดการ + โน้ต/ความจำ (ensure array สำหรับแชทเก่า)
function getAgenda() {
    const data = getFeedData();
    if (!Array.isArray(data.agenda)) data.agenda = [];
    return data.agenda;
}

function getNotes() {
    const data = getFeedData();
    if (!Array.isArray(data.notes)) data.notes = [];
    return data.notes;
}

// TinyForum: กระทู้ (ensure array สำหรับแชทเก่า)
function getForum() {
    const data = getFeedData();
    if (!Array.isArray(data.forum)) data.forum = [];
    return data.forum;
}

// รายชื่อห้อง (global setting) — ensure array + seed default
function getForumRooms() {
    const r = getSetting("forumRooms");
    if (!Array.isArray(r) || !r.length) return ["ข่าว/สังคม", "รีวิว", "ถาม-ตอบ", "ซุบซิบ", "ทั่วไป"];
    return r;
}

// ===== TinyGallery: คลังรูป + สติกเกอร์ (global — เก็บใน extension_settings ไม่ผูกกับแชท) =====


/* ===== TinyNovel (แอปที่ 12): แอปอ่านนิยายที่ AI เขียนให้ =====
 * global เต็มตัว — ไม่ดึงข้อมูลจากแชท/การ์ดปัจจุบันเลย (ต่างจาก TinyTheater ที่อิง roster)
 * ตัวเอกเลือกได้ 3 แบบ: ให้ AI สร้างเอง / persona ของเรา / ตัวละครจาก TinyVerse
 * ตั้งจำนวนตอนไว้ล่วงหน้า แล้ว AI เดินเรื่องให้จบพอดีตอนสุดท้าย */
const NOVEL_TROPES = [
    "ทะลุมิติเข้าไปในนิยายที่เคยอ่าน",
    "ย้อนเวลากลับไปแก้ไขอดีต",
    "เกิดใหม่เป็นตัวร้ายที่รู้ชะตากรรมตัวเอง",
    "สลับร่างกับคนที่เกลียดที่สุด",
    "ติดอยู่ในเกมที่ตายจริง",
    "ตื่นมาแล้วความจำหายไปสิบปี",
    "สัญญาแต่งงานลวงกับคนแปลกหน้า",
    "ศัตรูคู่แค้นที่ต้องร่วมมือกัน",
    "ระบบลึกลับสั่งภารกิจรายวัน",
    "โลกหลังหายนะที่เหลือคนไม่กี่คน",
    "ชิงบัลลังก์ในราชสำนัก",
    "ตัวประกอบที่ไม่ยอมเดินตามบท",
    "วนลูปวันเดิมซ้ำไม่รู้จบ",
    "ได้ยินเสียงในใจคนอื่น",
    "จดหมายจากตัวเองในอนาคต",
    "เมืองที่ทุกคนลืมชื่อเราไปแล้ว",
];
const NOVEL_GENRES = ["โรแมนซ์", "แฟนตาซี", "สืบสวน", "ดราม่า", "ตลก", "ระทึกขวัญ", "ไซไฟ", "ย้อนยุค"];
const NOVEL_LENGTHS = {
    short: { label: "สั้น", hint: "อ่านเร็ว ~1 นาทีต่อตอน", tokens: 500 },
    medium: { label: "กลาง", hint: "กำลังดี", tokens: 850 },
    long: { label: "ยาว", hint: "จัดเต็ม", tokens: 1300 },
};
const NOVEL_EP_CHOICES = [1, 3, 5, 8, 12];
const NOVEL_HERO_AI = "__ai__";     // ให้ AI สร้างตัวเอกเอง

function getNovel() {
    const s = extension_settings[extensionName];
    if (!s.novel || typeof s.novel !== "object") s.novel = { books: [] };
    if (!Array.isArray(s.novel.books)) s.novel.books = [];
    return s.novel;
}
function saveNovel() { saveSettingsDebounced(); }
function novelBook(id) { return getNovel().books.find((b) => b.id === id) || null; }
// ความยาว "กลาง" ปรับได้จากหน้าตั้งค่า (short/long ยังใช้ค่าคงที่)
function novelLength(key) {
    const base = NOVEL_LENGTHS[key] || NOVEL_LENGTHS.medium;
    if ((key || "medium") === "medium") {
        const t = parseInt(getSetting("novelTokens"), 10);
        if (Number.isFinite(t) && t > 0) return Object.assign({}, base, { tokens: t });
    }
    return base;
}
// คำสั่งเสริมจากหน้าตั้งค่า (ว่างได้)
function novelExtraLine() {
    const x = String(getSetting("novelExtraPrompt") || "").trim();
    return x ? `คำสั่งเพิ่มเติมจากผู้อ่าน: ${x}` : "";
}

// ── state ของหน้าจอ ──
let novelScreen = "shelf";      // shelf | create | read | chars
let novelBookId = null;
let novelEpIdx = 0;
let novelBusy = false;
let novelCover = "";
let novelHero = NOVEL_HERO_AI;
let novelPlotIdeas = [];

function openNovel() { novelScreen = "shelf"; novelBookId = null; renderNovel(); }

function setNovelGenerating(on, sel, busyText, idleText) {
    const $b = $(sel);
    $b.prop("disabled", on);
    $b.find(".tinyfeed-novel-btnlabel").text(on ? busyText : idleText);
    $b.toggleClass("tinyfeed-generating", on);
}

// สุ่มพล็อตจากคลัง (ไม่เรียก AI)
function novelRandomTrope() {
    return NOVEL_TROPES[Math.floor(Math.random() * NOVEL_TROPES.length)];
}

// ชื่อตัวเอกที่ผู้ใช้เลือก (ไว้ส่งเข้า prompt)
function novelHeroLine(hero) {
    if (hero === NOVEL_HERO_AI) return "ให้คุณสร้างตัวเอกขึ้นมาเองทั้งหมด (ตั้งชื่อ นิสัย ปูมหลัง)";
    if (hero === POSTER_USER) {
        const desc = userPersonaDesc();
        return `ให้ "${getUserName()}" เป็นตัวเอก${desc ? ` — ข้อมูลตัวละคร: ${desc}` : ""}`;
    }
    const c = getVerse().chars[hero];
    if (!c) return "ให้คุณสร้างตัวเอกขึ้นมาเองทั้งหมด";
    return `ให้ "${c.name}" เป็นตัวเอก${c.desc ? ` — ข้อมูลตัวละคร: ${String(c.desc).slice(0, 300)}` : ""}`;
}

/* แปลงผลจาก AI ตอนสร้างเรื่อง — รูปแบบ:
 *   TITLE: <ชื่อเรื่อง>
 *   SYNOPSIS: <เรื่องย่อ>
 *   CHAR: <ชื่อ> | <บทบาท> | <คำบรรยาย>
 * คืน {title, synopsis, chars[]} — escape ให้เรียบร้อยตั้งแต่ตรงนี้ */
/* จับบรรทัดหัวข้อ (TITLE / SYNOPSIS / CHAR / EPTITLE)
 * ยอมให้มีชื่อผู้พูดนำหน้าได้ เช่น "ST System: TITLE: ..." — บางโมเดลแอบใส่มา
 * คืน [ชนิด, เนื้อหา] หรือ null ถ้าไม่ใช่บรรทัดหัวข้อ */
function novelHeaderLine(line) {
    const m = String(line).trim().match(/^(?:[^:\n]{0,24}:\s*)?(TITLE|SYNOPSIS|CHAR|EPTITLE)\s*:\s*(.*)$/i);
    return m ? [m[1].toUpperCase(), m[2].trim()] : null;
}

function parseNovelOutline(raw) {
    const out = { title: "", synopsis: "", chars: [] };
    for (const line of stripReasoning(String(raw || "")).split("\n")) {
        const h = novelHeaderLine(line);
        const s = h ? `${h[0]}: ${h[1]}` : line.trim();
        let m;
        if ((m = s.match(/^TITLE:\s*(.+)$/i))) { if (!out.title) out.title = escapeText(stripWrapBrackets(m[1].trim())); }
        else if ((m = s.match(/^SYNOPSIS:\s*(.+)$/i))) { if (!out.synopsis) out.synopsis = escapeText(m[1].trim()); }
        else if ((m = s.match(/^CHAR:\s*(.+)$/i))) {
            const parts = m[1].split("|").map((x) => x.trim());
            if (parts[0]) {
                out.chars.push({
                    name: escapeText(stripWrapBrackets(parts[0])),
                    role: escapeText(parts[1] || ""),
                    desc: escapeText(parts[2] || ""),
                });
            }
        }
    }
    return out;
}

/* แปลงเนื้อตอน — เอา EPTITLE ตัวแรกเป็นชื่อตอน ที่เหลือเป็นเนื้อเรื่อง
 * ตัดบรรทัดหัวข้อ "ทุกบรรทัด" ทิ้ง (ไม่ใช่แค่ตัวแรก) เพราะบางโมเดลแอบใส่ TITLE: ซ้ำกลางเนื้อ
 * และรองรับกรณีมีชื่อผู้พูดนำหน้า เช่น "ST System: TITLE: ..." */
function parseNovelEpisode(raw) {
    const lines = stripReasoning(String(raw || "")).split("\n");
    let title = "";
    const body = [];
    for (const line of lines) {
        const h = novelHeaderLine(line);
        if (h) {
            if (h[0] === "EPTITLE" && !title && h[1]) title = escapeText(stripWrapBrackets(h[1]));
            continue;   // บรรทัดหัวข้อไม่ใช่เนื้อเรื่อง ทิ้งทุกกรณี
        }
        body.push(line);
    }
    let text = body.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    text = novelTrimEcho(text);
    return { title, text: escapeText(text) };
}

/* บางโมเดลแปะเนื้อหาจากแชทหลัก/หน้าต้อนรับ ST ไว้หน้าเนื้อนิยาย เจอ 2 แบบ:
 *   1) บทบาทตัวละคร แล้วคั่นด้วยเส้น ***  → ตัดถึงเส้นคั่นตัวสุดท้ายในช่วงต้น
 *   2) ข้อความ UI ของ ST ที่มีลิงก์ markdown → ตัดบรรทัดนำที่มีลิงก์ทิ้ง
 * จำกัดเฉพาะช่วงต้นเรื่อง กันไปตัดเนื้อจริงที่ใช้ *** คั่นฉากกลางเรื่อง */
function novelTrimEcho(text) {
    const HEAD = 400;
    // (1) เส้นคั่นในช่วงต้น
    const re = /^\s*(?:\*{3,}|-{3,}|_{3,})\s*$/gm;
    let cut = -1, m;
    while ((m = re.exec(text)) !== null) {
        if (m.index > HEAD) break;
        cut = m.index + m[0].length;
    }
    let out = cut > 0 ? text.slice(cut).trim() : text;
    // (2) บรรทัดนำที่มีลิงก์ markdown/URL — ร้อยแก้วภาษาไทยไม่ใช้แบบนี้
    const lines = out.split("\n");
    let i = 0;
    while (i < lines.length) {
        const l = lines[i].trim();
        if (!l) { i++; continue; }
        if (/\[[^\]]*\]\([^)]*\)|https?:\/\//.test(l)) { i++; continue; }
        break;
    }
    return lines.slice(i).join("\n").trim();
}

// เนื้อเรื่องที่ผ่านมา (ตัดเก็บส่วนท้ายไว้ให้ AI ไม่ให้ prompt บวม)
function novelStorySoFar(book, cap = 2500) {
    const parts = book.episodes.map((ep) =>
        `[ตอนที่ ${ep.no}${ep.title ? ` — ${ep.title}` : ""}]\n${htmlToPlain(ep.text)}`);
    const all = parts.join("\n\n");
    return all.length > cap ? "…" + all.slice(-cap) : all;
}

function novelCoverHtml(book) {
    if (book.cover) return `<div class="tinyfeed-novel-cover" style="background-image:url('${escapeAttr(book.cover)}')"></div>`;
    const initial = escapeText(String(book.title || "?").trim().charAt(0) || "?");
    return `<div class="tinyfeed-novel-cover tinyfeed-novel-cover-blank">${initial}</div>`;
}

function renderNovel() {
    const body = $("#tinyfeed-novel-body");
    if (!body.length) return;
    if (novelScreen === "create") return renderNovelCreate();
    if (novelScreen === "read") return renderNovelRead();
    if (novelScreen === "chars") return renderNovelChars();
    renderNovelShelf();
}

// ── ชั้นหนังสือ ──
function renderNovelShelf() {
    $(".tinyfeed-title").text("TinyNovel");
    const books = getNovel().books;
    const grid = books.length
        ? `<div class="tinyfeed-novel-grid">${books.map((b) => {
            const read = Math.min(b.lastReadEp || 0, b.episodes.length);
            const done = b.episodes.length >= (b.totalEps || 0);
            return `<div class="tinyfeed-novel-card" data-book="${escapeAttr(b.id)}">
                ${novelCoverHtml(b)}
                <div class="tinyfeed-novel-cardtitle">${b.title || "(ไม่มีชื่อ)"}</div>
                <div class="tinyfeed-novel-cardmeta">
                    ${done ? `<span class="tinyfeed-novel-done">จบแล้ว</span>` : `<span>อ่าน ${read}/${b.totalEps || "?"}</span>`}
                </div>
            </div>`;
        }).join("")}</div>`
        : emptyStateHtml("fa-book-open", "ยังไม่มีนิยาย", "กด “แต่งเรื่องใหม่” แล้วเลือกพล็อตที่ชอบ เดี๋ยว AI เขียนให้อ่าน");
    $("#tinyfeed-novel-body").html(`
        <div class="tinyfeed-novel-hero">
            <div class="tinyfeed-novel-herotitle"><i class="fa-solid fa-book-open"></i> ห้องสมุด</div>
            <div class="tinyfeed-novel-herosub">เลือกพล็อต ตั้งจำนวนตอน แล้วให้ AI แต่งให้อ่าน</div>
            <button id="tinyfeed-novel-new" class="tinyfeed-btn-primary tinyfeed-novel-newbtn">
                <i class="fa-solid fa-plus"></i> <span class="tinyfeed-novel-btnlabel">แต่งเรื่องใหม่</span>
            </button>
        </div>
        <div class="tinyfeed-screen">${grid}</div>
    `);
}

// ── ฟอร์มสร้างเรื่อง ──
function renderNovelCreate() {
    $(".tinyfeed-title").text("แต่งเรื่องใหม่");
    const verseChars = Object.entries(getVerse().chars || {});
    const heroOpts = [
        `<option value="${NOVEL_HERO_AI}"${novelHero === NOVEL_HERO_AI ? " selected" : ""}>ให้ AI สร้างตัวเอกเอง</option>`,
        `<option value="${POSTER_USER}"${novelHero === POSTER_USER ? " selected" : ""}>${escapeText(getUserName())} (ตัวเรา)</option>`,
        ...verseChars.map(([k, c]) =>
            `<option value="${escapeAttr(k)}"${novelHero === k ? " selected" : ""}>${escapeText(c.name || k)}</option>`),
    ].join("");
    const epOpts = NOVEL_EP_CHOICES.map((n) => `<option value="${n}"${n === 5 ? " selected" : ""}>${n} ตอนจบ</option>`).join("");
    const lenOpts = Object.entries(NOVEL_LENGTHS)
        .map(([k, v]) => `<option value="${k}"${k === "medium" ? " selected" : ""}>${v.label} — ${v.hint}</option>`).join("");
    const genreChips = NOVEL_GENRES.map((g) => `<span class="tinyfeed-novel-chip" data-genre="${escapeAttr(g)}">${g}</span>`).join("");
    $("#tinyfeed-novel-body").html(`
        <div class="tinyfeed-screen">
            <div class="tinyfeed-novel-field">
                <label>พล็อตเรื่อง</label>
                <textarea id="tinyfeed-novel-plot" rows="3" placeholder="อยากอ่านเรื่องแบบไหน? เช่น ทะลุมิติไปเป็นตัวร้ายในนิยายที่เคยอ่าน"></textarea>
                <div class="tinyfeed-novel-plotbtns">
                    <button id="tinyfeed-novel-dice" class="tinyfeed-btn-ghost tinyfeed-novel-toolbtn"><i class="fa-solid fa-dice"></i> สุ่มพล็อตยอดนิยม</button>
                    <button id="tinyfeed-novel-ai" class="tinyfeed-btn-ghost tinyfeed-novel-toolbtn"><i class="fa-solid fa-wand-magic-sparkles"></i> <span class="tinyfeed-novel-btnlabel">ให้ AI คิดให้</span></button>
                </div>
                <div id="tinyfeed-novel-ideas" class="tinyfeed-novel-ideas"></div>
            </div>
            <div class="tinyfeed-novel-field">
                <label>แนวเรื่อง</label>
                <input id="tinyfeed-novel-genre" type="text" placeholder="เช่น โรแมนซ์ แฟนตาซี (เว้นว่างได้)" />
                <div class="tinyfeed-novel-chips">${genreChips}</div>
            </div>
            <div class="tinyfeed-novel-field">
                <label>ตัวเอก</label>
                <select id="tinyfeed-novel-hero">${heroOpts}</select>
                <small class="tinyfeed-field-hint">ไม่ต้องมีตัวละครในเครื่องก็ได้ — เลือก “ให้ AI สร้างตัวเอกเอง” ได้เลย</small>
            </div>
            <div class="tinyfeed-novel-field tinyfeed-novel-row2">
                <div><label>ความยาวต่อตอน</label><select id="tinyfeed-novel-length">${lenOpts}</select></div>
                <div><label>จบกี่ตอน</label><select id="tinyfeed-novel-eps">${epOpts}</select></div>
            </div>
            <div class="tinyfeed-novel-field">
                <label>ปกหนังสือ</label>
                <div class="tinyfeed-novel-coverrow">
                    <div id="tinyfeed-novel-coverprev" class="tinyfeed-novel-coverprev">${novelCover
                        ? `<img src="${escapeAttr(novelCover)}" alt="ปก" />` : `<i class="fa-solid fa-image"></i>`}</div>
                    <button id="tinyfeed-novel-pickcover" class="tinyfeed-btn-ghost tinyfeed-novel-toolbtn">เลือกจากคลังรูป</button>
                    ${novelCover ? `<button id="tinyfeed-novel-clearcover" class="tinyfeed-btn-ghost tinyfeed-novel-toolbtn">ล้าง</button>` : ""}
                </div>
            </div>
            <button id="tinyfeed-novel-create" class="tinyfeed-btn-primary tinyfeed-novel-createbtn">
                <i class="fa-solid fa-feather-pointed"></i> <span class="tinyfeed-novel-btnlabel">เริ่มเขียนตอนแรก</span>
            </button>
        </div>
    `);
    renderNovelIdeas();
}

function renderNovelIdeas() {
    const box = $("#tinyfeed-novel-ideas");
    if (!box.length) return;
    box.html(novelPlotIdeas.length
        ? novelPlotIdeas.map((t) => `<span class="tinyfeed-novel-idea" data-idea="${escapeAttr(t)}">${t}</span>`).join("")
        : "");
}

/* วาดฟอร์มสร้างใหม่แต่คงค่าที่ผู้ใช้กรอกไว้ (ใช้ตอนเลือก/ล้างปก ซึ่งต้อง re-render)
 * — ถ้าเรียก renderNovelCreate() ตรงๆ พล็อต/แนว/จำนวนตอนที่พิมพ์ไว้จะหายหมด */
function restoreNovelForm() {
    const keep = {
        plot: String($("#tinyfeed-novel-plot").val() || ""),
        genre: String($("#tinyfeed-novel-genre").val() || ""),
        length: String($("#tinyfeed-novel-length").val() || "medium"),
        eps: String($("#tinyfeed-novel-eps").val() || "5"),
    };
    renderNovelCreate();
    $("#tinyfeed-novel-plot").val(keep.plot);
    $("#tinyfeed-novel-genre").val(keep.genre);
    $("#tinyfeed-novel-length").val(keep.length);
    $("#tinyfeed-novel-eps").val(keep.eps);
}

// ── หน้าอ่าน ──
function renderNovelRead() {
    const b = novelBook(novelBookId);
    if (!b) { novelScreen = "shelf"; return renderNovel(); }
    $(".tinyfeed-title").text(b.title || "นิยาย");
    novelEpIdx = Math.max(0, Math.min(novelEpIdx, b.episodes.length - 1));
    const ep = b.episodes[novelEpIdx];
    const finished = b.episodes.length >= (b.totalEps || 0);
    const chips = b.episodes.map((e, i) =>
        `<span class="tinyfeed-novel-epchip${i === novelEpIdx ? " tinyfeed-novel-epchip-active" : ""}" data-ep="${i}">ตอน ${e.no}</span>`).join("");
    const paras = ep ? htmlToPlain(ep.text).split(/\n{2,}/).filter(Boolean)
        .map((p) => `<p>${escapeText(p)}</p>`).join("") : "";
    $("#tinyfeed-novel-body").html(`
        <div class="tinyfeed-novel-readhero">
            ${novelCoverHtml(b)}
            <div class="tinyfeed-novel-readmeta">
                <div class="tinyfeed-novel-readtitle">${b.title || "(ไม่มีชื่อ)"}</div>
                <div class="tinyfeed-novel-readsub">${b.genre ? `${b.genre} · ` : ""}${b.episodes.length}/${b.totalEps} ตอน${finished ? " · จบแล้ว" : ""}</div>
                <div class="tinyfeed-novel-readbtns">
                    <button id="tinyfeed-novel-chars" class="tinyfeed-btn-ghost tinyfeed-novel-toolbtn"><i class="fa-solid fa-users"></i> ตัวละคร (${(b.chars || []).length})</button>
                    <button id="tinyfeed-novel-del" class="tinyfeed-btn-ghost tinyfeed-novel-toolbtn tinyfeed-novel-delbtn"><i class="fa-solid fa-trash"></i> ลบ</button>
                </div>
            </div>
        </div>
        <div class="tinyfeed-screen">
            ${b.synopsis ? `<div class="tinyfeed-novel-synopsis">${b.synopsis}</div>` : ""}
            <div class="tinyfeed-novel-epbar">${chips}</div>
            ${ep && ep.title ? `<div class="tinyfeed-novel-eptitle">${ep.title}</div>` : ""}
            <div class="tinyfeed-novel-text">${paras}</div>
            ${finished
                ? `<div class="tinyfeed-novel-endmark">— จบบริบูรณ์ —</div>`
                : `<button id="tinyfeed-novel-next" class="tinyfeed-btn-primary tinyfeed-novel-nextbtn">
                       <i class="fa-solid fa-feather-pointed"></i> <span class="tinyfeed-novel-btnlabel">เขียนตอนที่ ${b.episodes.length + 1}</span>
                   </button>`}
        </div>
    `);
    // จำว่าอ่านถึงตอนไหน
    b.lastReadEp = Math.max(b.lastReadEp || 0, novelEpIdx + 1);
    saveNovel();
}

// ── หน้าตัวละครในเรื่อง ──
function renderNovelChars() {
    const b = novelBook(novelBookId);
    if (!b) { novelScreen = "shelf"; return renderNovel(); }
    $(".tinyfeed-title").text("ตัวละคร");
    const cs = b.chars || [];
    $("#tinyfeed-novel-body").html(`
        <div class="tinyfeed-screen">
            ${cs.length ? cs.map((c) => `
                <div class="tinyfeed-novel-charcard">
                    <div class="tinyfeed-novel-charname">${c.name}${c.role ? ` <span class="tinyfeed-novel-charrole">${c.role}</span>` : ""}</div>
                    ${c.desc ? `<div class="tinyfeed-novel-chardesc">${c.desc}</div>` : ""}
                </div>`).join("")
            : emptyInlineHtml("เรื่องนี้ยังไม่มีข้อมูลตัวละคร")}
        </div>
    `);
}

// ── AI: ให้คิดพล็อตให้ 3 ข้อ ──
async function novelSuggestPlots() {
    if (novelBusy) return;
    const ctx = getContext();
    if (typeof ctx.generateQuietPrompt !== "function") { toastr.info("เวอร์ชัน ST นี้ใช้ AI ไม่ได้", "TinyNovel"); return; }
    novelBusy = true;
    setNovelGenerating(true, "#tinyfeed-novel-ai", "กำลังคิด...", "ให้ AI คิดให้");
    try {
        const q = buildPrompt("novelPlot", { genre: String($("#tinyfeed-novel-genre").val() || "").trim() || "(อิสระ)" });
        const raw = await tinyGenerate(q, 260, "novel");
        const ideas = [];
        for (const line of stripReasoning(String(raw || "")).split("\n")) {
            const m = line.trim().match(/^PLOT:\s*(.+)$/i);
            if (m) ideas.push(escapeText(stripWrapBrackets(m[1].trim())));
            if (ideas.length >= 5) break;
        }
        if (!ideas.length) { toastr.info("ยังคิดไม่ออก ลองใหม่นะ", "TinyNovel"); return; }
        novelPlotIdeas = ideas;
        renderNovelIdeas();
    } catch (e) {
        console.error(`[${extensionName}] novelSuggestPlots failed:`, e);
        toastr.error("คิดพล็อตไม่สำเร็จ", "TinyNovel");
    } finally {
        novelBusy = false;
        setNovelGenerating(false, "#tinyfeed-novel-ai", "กำลังคิด...", "ให้ AI คิดให้");
    }
}

// ── AI: สร้างเรื่อง + ตอนแรก ──
async function novelCreateBook() {
    if (novelBusy) return;
    const plot = String($("#tinyfeed-novel-plot").val() || "").trim();
    if (!plot) { toastr.info("ใส่พล็อตก่อนนะ (กดสุ่มก็ได้)", "TinyNovel"); return; }
    const ctx = getContext();
    if (typeof ctx.generateQuietPrompt !== "function") { toastr.info("เวอร์ชัน ST นี้ใช้ AI ไม่ได้", "TinyNovel"); return; }
    const genre = String($("#tinyfeed-novel-genre").val() || "").trim();
    const hero = String($("#tinyfeed-novel-hero").val() || NOVEL_HERO_AI);
    const lenKey = String($("#tinyfeed-novel-length").val() || "medium");
    const totalEps = Math.max(1, parseInt($("#tinyfeed-novel-eps").val(), 10) || 5);
    const len = novelLength(lenKey);
    novelBusy = true;
    setNovelGenerating(true, "#tinyfeed-novel-create", "กำลังแต่ง...", "เริ่มเขียนตอนแรก");
    try {
        const q = buildPrompt("novelOutline", {
            plot, genre: genre || "(อิสระ)", hero: novelHeroLine(hero),
            totalEps: String(totalEps), length: `${len.label} — ${len.hint}`,
            extra: novelExtraLine(),
        });
        const raw = await tinyGenerate(q, len.tokens + 300, "novel");
        const outline = parseNovelOutline(raw);
        const first = parseNovelEpisode(raw);   // ตัดบรรทัดหัวข้อให้เองแล้ว
        if (!first.text) { toastr.info("ยังเขียนไม่ออก ลองปรับพล็อตดูนะ", "TinyNovel"); return; }
        const book = {
            id: "nv" + Date.now(),
            title: outline.title || escapeText(plot.slice(0, 40)),
            synopsis: outline.synopsis, genre, plot: escapeText(plot),
            cover: novelCover || "", hero, lengthKey: lenKey, totalEps,
            chars: outline.chars,
            episodes: [{ no: 1, title: first.title, text: first.text, ts: Date.now() }],
            lastReadEp: 1, ts: Date.now(), updatedTs: Date.now(),
        };
        getNovel().books.unshift(book);
        saveNovel();
        novelCover = ""; novelPlotIdeas = []; novelHero = NOVEL_HERO_AI;
        novelBookId = book.id; novelEpIdx = 0; novelScreen = "read";
        renderNovel();
    } catch (e) {
        console.error(`[${extensionName}] novelCreateBook failed:`, e);
        toastr.error("แต่งเรื่องไม่สำเร็จ", "TinyNovel");
    } finally {
        novelBusy = false;
        setNovelGenerating(false, "#tinyfeed-novel-create", "กำลังแต่ง...", "เริ่มเขียนตอนแรก");
    }
}

// ── AI: เขียนตอนต่อไป (รู้ว่าเหลืออีกกี่ตอนจะจบ) ──
async function novelNextEpisode() {
    if (novelBusy) return;
    const b = novelBook(novelBookId);
    if (!b) return;
    if (b.episodes.length >= b.totalEps) return;
    const ctx = getContext();
    if (typeof ctx.generateQuietPrompt !== "function") { toastr.info("เวอร์ชัน ST นี้ใช้ AI ไม่ได้", "TinyNovel"); return; }
    const len = novelLength(b.lengthKey);
    const epNo = b.episodes.length + 1;
    const isLast = epNo >= b.totalEps;
    novelBusy = true;
    setNovelGenerating(true, "#tinyfeed-novel-next", "กำลังเขียน...", `เขียนตอนที่ ${epNo}`);
    try {
        const roster = (b.chars || []).map((c) => `- ${c.name}${c.role ? ` (${c.role})` : ""}: ${c.desc || ""}`).join("\n");
        const q = buildPrompt("novelEpisode", {
            title: b.title, plot: b.plot || "", genre: b.genre || "(อิสระ)",
            roster: roster || "(ยังไม่ระบุ)", story: novelStorySoFar(b),
            epNo: String(epNo), totalEps: String(b.totalEps),
            length: `${len.label} — ${len.hint}`,
            endRule: isLast
                ? "ตอนนี้คือ **ตอนสุดท้าย** ต้องปิดเรื่องให้จบสมบูรณ์ คลี่คลายทุกปมที่ค้างไว้ ห้ามทิ้งท้ายให้อ่านต่อ"
                : `ยังเหลืออีก ${b.totalEps - epNo} ตอนจะจบ เดินเรื่องให้คืบหน้าและทิ้งท้ายให้อยากอ่านต่อ`,
            extra: novelExtraLine(),
        });
        const raw = await tinyGenerate(q, len.tokens, "novel");
        const parsed = parseNovelEpisode(raw);
        if (!parsed.text) { toastr.info("ยังเขียนต่อไม่ออก ลองใหม่นะ", "TinyNovel"); return; }
        b.episodes.push({ no: epNo, title: parsed.title, text: parsed.text, ts: Date.now() });
        b.updatedTs = Date.now();
        saveNovel();
        novelEpIdx = b.episodes.length - 1;
        renderNovel();
    } catch (e) {
        console.error(`[${extensionName}] novelNextEpisode failed:`, e);
        toastr.error("เขียนตอนต่อไม่สำเร็จ", "TinyNovel");
    } finally {
        novelBusy = false;
        setNovelGenerating(false, "#tinyfeed-novel-next", "กำลังเขียน...", `เขียนตอนที่ ${epNo}`);
    }
}

function novelDeleteBook(id) {
    const n = getNovel();
    const i = n.books.findIndex((b) => b.id === id);
    if (i < 0) return;
    n.books.splice(i, 1);
    saveNovel();
    novelScreen = "shelf"; novelBookId = null;
    renderNovel();
}
// เก็บใน extension_settings.tinyfeed.pet (ไม่ใช่ chat_metadata) → เพ็ทตัวเดียวตามผู้เล่นทุกแชท
const PET_DECAY_DEFAULTS = { hunger: 0.5, energy: 0.35, cleanliness: 0.3 };   // ต่อนาที
// สถานะ → sprite (เรียงตามความสำคัญใน petState) · emoji = fallback ตอนไม่มีไฟล์/ลิงก์
const PET_STATE_EMOJI = {
    idle: "🐣", happy: "😸", hungry: "🍽️", sleepy: "😪", dirty: "🐽", sick: "🤒",
    eating: "😋", playing: "🎾", cleaning: "🫧", sleeping: "💤", dead: "🪦",
};
const PET_SPRITE_STATES = Object.keys(PET_STATE_EMOJI);
// ป้ายไทยของสถานะ — ใช้ทั้งหน้าตั้งค่าสไปรต์ และตอนแทรกสถานะเพ็ทเข้า RP
const PET_STATE_LABEL = {
    idle: "ปกติ", happy: "อารมณ์ดี", hungry: "หิว", sleepy: "ง่วง", dirty: "ตัวเลอะ", sick: "ป่วย",
    eating: "กำลังกินอาหาร", playing: "กำลังเล่น", cleaning: "กำลังอาบน้ำ", sleeping: "กำลังหลับ", dead: "เสียชีวิต",
};
const clamp100 = (n) => Math.max(0, Math.min(100, Number(n) || 0));

function defaultPet() {
    return {
        exists: false, name: "", stage: "baby", bond: 0, coins: 0,
        stats: { hunger: 0, energy: 100, cleanliness: 100, mood: 80, health: 100 },
        lastUpdateTimestamp: Date.now(), createdAt: 0, isDead: false, isSleeping: false, notified: {}, dm: [],
    };
}
function getPet() {
    const store = extension_settings[extensionName] = extension_settings[extensionName] || {};
    let p = store.pet;
    if (!p || typeof p !== "object") p = defaultPet();
    const d = defaultPet();
    p.stats = Object.assign({}, d.stats, p.stats || {});
    if (typeof p.notified !== "object" || !p.notified) p.notified = {};
    if (typeof p.lastUpdateTimestamp !== "number") p.lastUpdateTimestamp = Date.now();
    if (typeof p.stage !== "string") p.stage = "baby";
    if (typeof p.bond !== "number" || !isFinite(p.bond)) p.bond = 0;
    if (typeof p.coins !== "number" || !isFinite(p.coins)) p.coins = 0;
    if (!Array.isArray(p.dm)) p.dm = [];
    store.pet = p;
    return p;
}
// ความผูกพัน: xp สะสม → เลเวล (PET_BOND_PER_LEVEL xp/เลเวล, สูงสุด 10) · Lv.10 = "เพื่อนซี้"
const PET_BOND_PER_LEVEL = 50;   // ลดจาก 100 → ขึ้นเลเวลง่ายขึ้น (ใช้กับ evolution ด้วย)
function petBondLevel(bond) { return Math.min(10, Math.floor((Number(bond) || 0) / PET_BOND_PER_LEVEL)); }
function petBondAdd(amount) {
    const p = getPet();
    if (!p.exists || p.isDead) return;
    p.bond = Math.max(0, (Number(p.bond) || 0) + amount);
}

// ===== TinyPet: วิวัฒนาการ (evolution) — baby→teen→adult ผูกกับเลเวล bond (เส้นตรง ไม่ถอยหลัง) =====
const PET_STAGES = ["baby", "teen", "adult"];
const PET_STAGE_BOND = { teen: 3, adult: 6 };   // เลเวล bond ขั้นต่ำของแต่ละระยะ (PER_LEVEL=50 → 150xp / 300xp)
const PET_STAGE_LABEL = { baby: "เด็ก", teen: "วัยรุ่น", adult: "โตเต็มวัย" };
function petStageForBond(level) {
    if (level >= PET_STAGE_BOND.adult) return "adult";
    if (level >= PET_STAGE_BOND.teen) return "teen";
    return "baby";
}
// เลื่อนระยะเมื่อเลเวล bond ถึงเกณฑ์ (ไปข้างหน้าเท่านั้น) — เรียกใน petApplyDecay ทุกครั้ง (ครอบทั้งเปิดแอป/tick พื้นหลัง)
function petCheckEvolve(p) {
    if (!p.exists || p.isDead) return;
    const curIdx = PET_STAGES.indexOf(p.stage);
    if (curIdx < 0) { p.stage = "baby"; return; }
    const tgtIdx = PET_STAGES.indexOf(petStageForBond(petBondLevel(p.bond)));
    if (tgtIdx > curIdx) { p.stage = PET_STAGES[tgtIdx]; petOnEvolve(PET_STAGES[tgtIdx]); }
}
function petOnEvolve(stage) {
    const p = getPet();
    const label = PET_STAGE_LABEL[stage] || stage;
    savePet();
    setPetActionSprite("happy", 2600);   // โชว์ท่าดีใจสั้นๆ ตอนโต
    try { toastr.success(`${p.name || "เพ็ท"} โตเป็น${label}แล้ว! 🎉`, "TinyPet"); } catch (e) {}
    const lines = {
        teen: "ดูสิ~ ฉันโตเป็นวัยรุ่นแล้วนะ! ขอบคุณที่ดูแลกันมาตลอดเลย 🥹",
        adult: "ฉันโตเต็มวัยแล้ว! เราผ่านอะไรด้วยกันมาเยอะเลยเนอะ 💖",
    };
    petSendDM(lines[stage] || "ฉันโตขึ้นแล้ว! 🎉");
}
function savePet() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    extension_settings[extensionName].pet = getPet();
    saveSettingsDebounced();
}
function petRate(key, def) {
    const v = parseFloat(getSetting("petDecay" + key));
    return (Number.isFinite(v) && v >= 0) ? v : def;
}
// นาทีที่ค่า (เพิ่มขึ้นเชิงเส้น) อยู่ >= thresh ในช่วง min นาที
function petMinAbove(start, rate, thresh, min) {
    if (start >= thresh) return min;
    if (rate <= 0) return 0;
    return Math.max(0, min - (thresh - start) / rate);
}
// นาทีที่ค่า (ลดลงเชิงเส้น) อยู่ <= thresh
function petMinBelow(start, rate, thresh, min) {
    if (start <= thresh) return min;
    if (rate <= 0) return 0;
    return Math.max(0, min - (start - thresh) / rate);
}
// นาทีก่อนค่า(เพิ่ม)แตะ thresh (ช่วงที่ยังต่ำกว่า)
function petReachAbove(start, rate, thresh, min) {
    if (start >= thresh) return 0;
    if (rate <= 0) return min;
    return Math.min(min, (thresh - start) / rate);
}
// นาทีก่อนค่า(ลด)แตะ thresh (ช่วงที่ยังสูงกว่า)
function petReachBelow(start, rate, thresh, min) {
    if (start <= thresh) return 0;
    if (rate <= 0) return min;
    return Math.min(min, (start - thresh) / rate);
}

// คำนวณ decay จาก timestamp (idempotent) — เรียกตอนเปิดแอป / โหลด / tick พื้นหลัง
function petApplyDecay() {
    const p = getPet();
    if (!p.exists || p.isDead) { p.lastUpdateTimestamp = Date.now(); return p; }
    petCheckEvolve(p);   // เช็กเลื่อนระยะทุกครั้ง (ก่อน guard เวลา เพื่อให้ทำงานแม้ยังไม่มีเวลาผ่าน)
    let min = (Date.now() - (p.lastUpdateTimestamp || Date.now())) / 60000;
    p.lastUpdateTimestamp = Date.now();
    if (!(min > 0)) return p;
    const capH = Math.max(1, parseInt(getSetting("petOfflineCapHours"), 10) || 12);
    min = Math.min(min, capH * 60);   // เพดาน offline — หายไปนานแล้วไม่ให้ตายทันทีตอนกลับมา
    const s = p.stats;
    const rH = petRate("Hunger", PET_DECAY_DEFAULTS.hunger);
    const rE = petRate("Energy", PET_DECAY_DEFAULTS.energy);
    const rC = petRate("Clean", PET_DECAY_DEFAULTS.cleanliness);
    const effH = p.isSleeping ? rH * 0.4 : rH;   // หลับ = หิวช้าลง
    const h0 = s.hunger, c0 = s.cleanliness, e0 = s.energy;
    s.hunger = clamp100(s.hunger + effH * min);
    s.cleanliness = clamp100(s.cleanliness - rC * min);
    if (p.isSleeping) s.energy = clamp100(s.energy + rE * 2 * min);
    else s.energy = clamp100(s.energy - rE * min);
    // health — คิด "นาทีวิกฤตจริง" ด้วยจุดตัดเชิงเส้น (กัน overcount ตอน elapsed ก้อนใหญ่)
    let hd = 0;
    hd -= 0.15 * petMinAbove(h0, effH, 80, min);
    hd -= 0.12 * petMinBelow(c0, rC, 20, min);
    if (!p.isSleeping) hd -= 0.08 * petMinBelow(e0, rE, 0, min);
    // regen เฉพาะช่วงต้นที่ทุกค่ายังดี (ก่อนค่าใดแตะเกณฑ์แย่)
    const goodMin = Math.max(0, Math.min(
        petReachAbove(h0, effH, 50, min),
        petReachBelow(c0, rC, 50, min),
        p.isSleeping ? min : petReachBelow(e0, rE, 30, min),
    ));
    hd += 0.1 * goodMin;
    s.health = clamp100(s.health + hd);
    // ยิ่งผูกพันมาก อารมณ์ยิ่งดึงเข้าหาค่าสูงขึ้น (perk จากการดูแล/RP)
    const bondBonus = petBondLevel(p.bond) * 2;
    const wellbeing = Math.min(100, ((100 - s.hunger) + s.energy + s.cleanliness + s.health) / 4 + bondBonus);
    s.mood = clamp100(s.mood + (wellbeing - s.mood) * Math.min(1, min * 0.03));
    if (s.health <= 0) { p.isDead = true; p.isSleeping = false; }
    return p;
}

// สถานะปัจจุบันสำหรับเลือก sprite (actionSprite = ทับชั่วคราวหลังกดปุ่ม)
let petActionSprite = "";
let petActionTimer = null;
function petState() {
    const p = getPet();
    if (!p.exists) return "idle";
    if (p.isDead) return "dead";
    if (petActionSprite) return petActionSprite;
    if (p.isSleeping) return "sleeping";
    const s = p.stats;
    if (s.health <= 30) return "sick";
    if (s.hunger >= 75) return "hungry";
    if (s.cleanliness <= 25) return "dirty";
    if (s.energy <= 20) return "sleepy";
    if (s.mood >= 70) return "happy";
    return "idle";
}
function setPetActionSprite(state, ms) {
    petActionSprite = state;
    clearTimeout(petActionTimer);
    petActionTimer = setTimeout(() => { petActionSprite = ""; if (currentApp === "pet") renderPet(); }, ms || 1600);
}

// URL รูป sprite: ลิงก์ที่ผู้ใช้ตั้งต่อสถานะ > ไฟล์ในตัว (assets/pet-sprites) · ว่าง/โหลดไม่ได้ = fallback emoji
// ผู้เลือกรูป sprite แบบไล่ลำดับ (stage-aware): เจาะจงระยะก่อน → fallback สถานะรวม (=ค่าเริ่มต้น/ร่าง baby) → อิโมจิ
// baby ใช้คีย์สถานะล้วน (เป็น default/สำรองของทุกระยะ), teen/adult ใช้ `<stage>_<state>` ก่อนแล้วค่อย fallback
function petSpriteCandidates(state) {
    const map = getSetting("petSprites") || {};
    const stage = getPet().stage || "baby";
    /* คีย์ที่ลองตามลำดับ: เฉพาะระยะ (`baby_idle`) → สถานะล้วน (`idle` = ค่าสำรองของทุกระยะ)
     * เดิม baby ข้าม prefix ไปใช้คีย์ล้วนอย่างเดียว แต่ไฟล์ที่แถมมาใน assets/pet-sprites/
     * ตั้งชื่อมี prefix ครบทั้ง 3 ระยะ (baby_idle.png ฯลฯ) → ระยะเด็กหารูปไม่เจอ ตกไปอิโมจิเสมอ */
    const keys = [`${stage}_${state}`, state];
    /* ลิงก์ที่ผู้ใช้ตั้งเองต้องชนะไฟล์ในตัว "ทุกคีย์" จึงไล่ลิงก์ให้ครบก่อนค่อยไล่ไฟล์
     * (ถ้าสลับกันตามคีย์ ไฟล์ baby_idle.png ที่แถมมาจะทับลิงก์ที่ผู้ใช้ตั้งไว้ใต้คีย์ `idle`) */
    const customs = keys.map((k) => String(map[k] || "").trim()).filter(Boolean);
    const files = keys.map((k) => `${extensionFolderPath}/assets/pet-sprites/${k}.png`);
    return [...customs, ...files];
}
// รูปหลัก (สำหรับ avatar contact/DM ฯลฯ) = candidate แรก
function petSpriteUrl(state) { return petSpriteCandidates(state)[0]; }
// onerror ของ <img>: ลองรูปตัวถัดไปใน data-next ก่อน; หมดแล้ว → ซ่อนรูปเผยอิโมจิ (ต้อง global เพราะ onerror รันใน scope หน้าเว็บ)
window.tinyfeedPetSpriteErr = function (img) {
    try {
        const next = JSON.parse(img.getAttribute("data-next") || "[]");
        if (next.length) { img.src = next.shift(); img.setAttribute("data-next", JSON.stringify(next)); return; }
    } catch (e) { /* ตกไปเผยอิโมจิ */ }
    img.style.display = "none";
    if (img.parentElement) img.parentElement.classList.add("tinyfeed-pet-noimg");
};
function petSpriteBoxHtml() {
    const st = petState();
    const emoji = PET_STATE_EMOJI[st] || "🐾";
    const cands = petSpriteCandidates(st);
    // อิโมจิซ่อนไว้ก่อน · onerror ไล่ candidate จนหมดค่อยเผยอิโมจิ → มีรูประยะไหนโหลดได้ = ไม่เห็นอิโมจิหลัง
    return `<div class="tinyfeed-pet-spritebox tinyfeed-pet-state-${st}">
        <img class="tinyfeed-pet-sprite" src="${escapeAttr(cands[0])}" data-next="${escapeAttr(JSON.stringify(cands.slice(1)))}" alt="${escapeAttr(st)}" onerror="tinyfeedPetSpriteErr(this)" />
        <span class="tinyfeed-pet-emoji">${emoji}</span>
    </div>`;
}

// ===== TinyPet actions =====
const PET_COOLDOWN_MS = 6000;   // กันกดรัวปุ่มเดิม
const petCooldownAt = {};
function petOnCooldown(action) {
    const now = Date.now();
    if (now - (petCooldownAt[action] || 0) < PET_COOLDOWN_MS) return true;
    petCooldownAt[action] = now;
    return false;
}
function petActionLabel(action) {
    return ({ feed: "ให้อาหาร", play: "เล่นด้วย", clean: "อาบน้ำให้", sleep: "กล่อมให้นอน" })[action] || "เข้ามาดู";
}
function petAct(action) {
    const p = getPet();
    if (!p.exists || p.isDead) return;
    if (p.isSleeping && action !== "sleep") { toastr.info("เพ็ทกำลังหลับอยู่ ปลุกก่อนนะ", "TinyPet"); return; }
    if (petOnCooldown(action)) return;
    petApplyDecay();
    const s = p.stats;
    let sprite = "", react = false;
    if (action === "feed") {
        if (s.hunger <= 10) { s.mood = clamp100(s.mood - 5); s.health = clamp100(s.health - 3); toastr.info("เพ็ทอิ่มแล้ว อย่าให้กินเยอะเกินไป!", "TinyPet"); }
        else { s.hunger = clamp100(s.hunger - 35); s.mood = clamp100(s.mood + 5); petBondAdd(3); }
        sprite = "eating"; react = true;
    } else if (action === "play") {
        if (s.energy < 15) { toastr.info("เพ็ทเหนื่อยเกินกว่าจะเล่น ให้พักก่อนนะ", "TinyPet"); return; }
        s.mood = clamp100(s.mood + 20); s.energy = clamp100(s.energy - 15);
        s.hunger = clamp100(s.hunger + 6); s.cleanliness = clamp100(s.cleanliness - 6);
        petBondAdd(6); sprite = "playing"; react = true;
    } else if (action === "clean") {
        s.cleanliness = 100; s.mood = clamp100(s.mood + 5); petBondAdd(3); sprite = "cleaning"; react = true;
    } else if (action === "sleep") {
        p.isSleeping = !p.isSleeping;
    }
    p.lastUpdateTimestamp = Date.now();
    savePet();
    if (sprite) setPetActionSprite(sprite, 1600);
    renderPet();
    if (react && getSetting("petAiReactions")) petReactThrottled(action);
}

// ===== TinyPet: เหรียญเพ็ท + ร้านสัตว์เลี้ยง (แยกจาก TinyShop) =====
function petCoins() { return Math.max(0, Math.floor(Number(getPet().coins) || 0)); }
function petAddCoins(n) { const p = getPet(); p.coins = Math.max(0, (Number(p.coins) || 0) + Math.round(n)); }
function petSpendCoins(n) {
    const p = getPet();
    n = Math.round(n);
    if ((Number(p.coins) || 0) < n) { toastr.warning("เหรียญไม่พอ เติมเหรียญก่อนนะ 🪙", "TinyPet"); return false; }
    p.coins = (Number(p.coins) || 0) - n;
    return true;
}
function getPetShop() {
    const store = extension_settings[extensionName] || {};
    if (!Array.isArray(store.petShop)) { store.petShop = (defaultSettings.petShop || []).slice(); setSetting("petShop", store.petShop); }
    return store.petShop;
}
function savePetShop() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    extension_settings[extensionName].petShop = getPetShop();
    saveSettingsDebounced();
}
function petItemId() { return "pi" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

const PET_ITEM_TYPES = { food: "อาหาร", toy: "ของเล่น", care: "ของใช้", heal: "ยา/ฟื้นฟู" };
const PET_ITEM_EMOJI = { food: "🍖", toy: "🎾", care: "🧼", heal: "💊" };
const PET_ITEM_SPRITE = { food: "eating", toy: "playing", care: "cleaning", heal: "eating" };
let isPetShopBusy = false;
let petItemEditId = null;

// ผลของไอเทมจาก type + amount (deltas "ดี" เป็นบวก; ของเล่นหักพลังงานนิดหน่อย)
function petItemEffect(it) {
    const a = Math.max(0, parseInt(it.amount, 10) || 0);
    switch (it.type) {
        case "toy": return { mood: a, bond: Math.round(a / 5), energy: -Math.round(a / 4) };
        case "care": return { cleanliness: a, mood: Math.round(a / 3) };
        case "heal": return { health: a, mood: Math.round(a / 4) };
        case "food": default: return { fullness: a };
    }
}
function petEffectText(it) {
    const e = petItemEffect(it);
    const parts = [];
    if (e.fullness) parts.push(`อิ่ม +${e.fullness}`);
    if (e.energy) parts.push(`พลังงาน ${e.energy > 0 ? "+" : ""}${e.energy}`);
    if (e.cleanliness) parts.push(`สะอาด +${e.cleanliness}`);
    if (e.mood) parts.push(`อารมณ์ +${e.mood}`);
    if (e.health) parts.push(`สุขภาพ +${e.health}`);
    if (e.bond) parts.push(`ผูกพัน +${e.bond}`);
    return parts.join(", ") || "—";
}
function petApplyEffect(effect) {
    const s = getPet().stats;
    if (effect.fullness) s.hunger = clamp100(s.hunger - effect.fullness);
    if (effect.energy) s.energy = clamp100(s.energy + effect.energy);
    if (effect.cleanliness) s.cleanliness = clamp100(s.cleanliness + effect.cleanliness);
    if (effect.mood) s.mood = clamp100(s.mood + effect.mood);
    if (effect.health) s.health = clamp100(s.health + effect.health);
    if (effect.bond) petBondAdd(effect.bond);
}

function openPetShop() {
    const p = getPet();
    if (!p.exists || p.isDead) return;
    renderPetShop();
    $("#tinyfeed-pet-shop-modal").removeClass("tinyfeed-hidden");
}
function closePetShop() { $("#tinyfeed-pet-shop-modal").addClass("tinyfeed-hidden"); }
function renderPetShop() {
    $("#tinyfeed-pet-shop-coins").text(petCoins().toLocaleString());
    const items = getPetShop();
    const free = `<div class="tinyfeed-pet-shop-item" data-id="__free__">
        <span class="tinyfeed-pet-food-emoji">🍚</span>
        <span class="tinyfeed-pet-food-info"><b>อาหารพื้นฐาน</b><small>อิ่ม +35 · ฟรี</small></span>
        <button class="tinyfeed-pet-buy tinyfeed-btn-primary" data-id="__free__">ฟรี</button>
    </div>`;
    const rows = items.map((it) => {
        const thumb = it.image
            ? `<img class="tinyfeed-pet-food-img" src="${escapeAttr(it.image)}" alt="" onerror="this.remove()" />`
            : `<span class="tinyfeed-pet-food-emoji">${escapeText(it.emoji || PET_ITEM_EMOJI[it.type] || "🎁")}</span>`;
        return `<div class="tinyfeed-pet-shop-item" data-id="${escapeAttr(it.id)}">
            ${thumb}
            <span class="tinyfeed-pet-food-info"><b>${escapeText(it.name)}</b><small>${escapeText(petEffectText(it))}${it.desc ? " · " + escapeText(it.desc) : ""}</small></span>
            <span class="tinyfeed-pet-item-edit" title="แก้ไข"><i class="fa-solid fa-pen"></i></span>
            <span class="tinyfeed-pet-item-del" title="ลบ"><i class="fa-solid fa-trash"></i></span>
            <button class="tinyfeed-pet-buy tinyfeed-btn-primary" data-id="${escapeAttr(it.id)}">🪙 ${Math.max(0, parseInt(it.price, 10) || 0)}</button>
        </div>`;
    }).join("");
    $("#tinyfeed-pet-shop-list").html(free + rows);
}
function buyPetItem(id) {
    const p = getPet();
    if (!p.exists || p.isDead) return;
    if (p.isSleeping) { toastr.info("เพ็ทกำลังหลับอยู่ ปลุกก่อนนะ", "TinyPet"); return; }
    if (id === "__free__") {
        if (petOnCooldown("feed")) return;
        petApplyDecay();
        const s = p.stats;
        if (s.hunger <= 10) { s.mood = clamp100(s.mood - 5); s.health = clamp100(s.health - 3); toastr.info("เพ็ทอิ่มแล้ว อย่าให้กินเยอะเกินไป!", "TinyPet"); }
        else { s.hunger = clamp100(s.hunger - 35); s.mood = clamp100(s.mood + 5); petBondAdd(3); }
        p.lastUpdateTimestamp = Date.now();
        savePet(); setPetActionSprite("eating", 1600); closePetShop(); renderPet();
        if (getSetting("petAiReactions")) petReactThrottled("feed");
        return;
    }
    const it = getPetShop().find((x) => String(x.id) === String(id));
    if (!it) return;
    if (petOnCooldown("shop")) return;
    const price = Math.max(0, parseInt(it.price, 10) || 0);
    if (price > 0 && !petSpendCoins(price)) return;
    petApplyDecay();
    petApplyEffect(petItemEffect(it));
    getPet().lastUpdateTimestamp = Date.now();
    savePet();
    setPetActionSprite(PET_ITEM_SPRITE[it.type] || "eating", 1600);
    closePetShop();
    renderPet();
    toastr.success(`ใช้ "${it.name}" แล้ว`, "TinyPet");
    if (getSetting("petAiReactions")) petReactThrottled(it.type === "toy" ? "play" : it.type === "care" ? "clean" : "feed");
}

// เติมเหรียญจาก TinyBank
function openPetTopup() {
    $("#tinyfeed-pet-topup-amount").val("");
    $("#tinyfeed-pet-topup-bank").text(formatMoney(getBankData().balance));
    $("#tinyfeed-pet-topup-rate").text(Math.max(1, parseInt(getSetting("petCoinRate"), 10) || 1));
    $("#tinyfeed-pet-topup-modal").removeClass("tinyfeed-hidden");
    setTimeout(() => $("#tinyfeed-pet-topup-amount").trigger("focus"), 30);
}
function closePetTopup() { $("#tinyfeed-pet-topup-modal").addClass("tinyfeed-hidden"); }
function petTopup() {
    const baht = parseInt($("#tinyfeed-pet-topup-amount").val(), 10);
    if (!Number.isFinite(baht) || baht <= 0) { toastr.info("ใส่จำนวนเงินก่อนนะ", "TinyPet"); return; }
    if (!bankDeduct(baht, "เติมเหรียญเพ็ท", "pet")) return;   // ยอดไม่พอ → toast ในตัว
    const coins = baht * Math.max(1, parseInt(getSetting("petCoinRate"), 10) || 1);
    petAddCoins(coins);
    savePet();
    closePetTopup();
    renderPetShop();
    toastr.success(`เติม ${coins.toLocaleString()} เหรียญแล้ว 🪙`, "TinyPet");
}

// เพิ่ม/แก้ไขไอเทม
function openPetItemEdit(id) {
    petItemEditId = id ? String(id) : null;
    const it = id ? getPetShop().find((x) => String(x.id) === String(id)) : null;
    $("#tinyfeed-pet-item-title").text(it ? "แก้ไขไอเทม" : "เพิ่มไอเทม");
    $("#tinyfeed-pet-item-name").val(it ? it.name : "");
    $("#tinyfeed-pet-item-price").val(it ? it.price : "");
    $("#tinyfeed-pet-item-emoji").val(it ? (it.emoji || "") : "");
    $("#tinyfeed-pet-item-image").val(it ? (it.image || "") : "");
    $("#tinyfeed-pet-item-type").val(it ? (it.type || "food") : "food");
    $("#tinyfeed-pet-item-amount").val(it ? it.amount : 40);
    $("#tinyfeed-pet-item-desc").val(it ? (it.desc || "") : "");
    $("#tinyfeed-pet-item-modal").removeClass("tinyfeed-hidden");
}
function closePetItemModal() { $("#tinyfeed-pet-item-modal").addClass("tinyfeed-hidden"); petItemEditId = null; }
function savePetItem() {
    const name = String($("#tinyfeed-pet-item-name").val() || "").trim();
    if (!name) { toastr.info("ตั้งชื่อไอเทมก่อนนะ", "TinyPet"); return; }
    const data = {
        name,
        price: Math.max(0, parseInt($("#tinyfeed-pet-item-price").val(), 10) || 0),
        emoji: String($("#tinyfeed-pet-item-emoji").val() || "").trim().slice(0, 4),
        image: String($("#tinyfeed-pet-item-image").val() || "").trim(),
        type: String($("#tinyfeed-pet-item-type").val() || "food"),
        amount: Math.max(0, parseInt($("#tinyfeed-pet-item-amount").val(), 10) || 0),
        desc: String($("#tinyfeed-pet-item-desc").val() || "").trim(),
    };
    const shop = getPetShop();
    if (petItemEditId) { const it = shop.find((x) => String(x.id) === petItemEditId); if (it) Object.assign(it, data); }
    else shop.push(Object.assign({ id: petItemId() }, data));
    savePetShop();
    closePetItemModal();
    renderPetShop();
    toastr.success("บันทึกไอเทมแล้ว", "TinyPet");
}
function deletePetItem(id) {
    const shop = getPetShop();
    const i = shop.findIndex((x) => String(x.id) === String(id));
    if (i < 0) return;
    shop.splice(i, 1);
    savePetShop();
    renderPetShop();
}

// AI สร้างไอเทมร้านเพ็ท
async function generatePetItems(opts) {
    opts = opts || {};
    if (isPetShopBusy) return;
    const ctx = getContext();
    if (typeof ctx.generateQuietPrompt !== "function") { if (!opts.silent) toastr.error("เวอร์ชัน ST นี้ไม่มี generateQuietPrompt", "TinyPet"); return; }
    if (!getCurrentCharacter()) { if (!opts.silent) toastr.info("เปิดแชทที่มีตัวละครก่อนนะ", "TinyPet"); return; }
    isPetShopBusy = true;
    const btn = $("#tinyfeed-pet-shop-generate");
    btn.addClass("tinyfeed-generating").prop("disabled", true);
    try {
        const q = buildPrompt("petShopItems", {
            petName: getPet().name || "เพ็ท",
            types: Object.entries(PET_ITEM_TYPES).map(([k, v]) => `${v}(${k})`).join(", "),
            context: crossAppContext("pet"),
        });
        const raw = await tinyGenerate(q, 400, "pet");
        const added = parsePetItems(raw);
        if (!added) { if (!opts.silent) toastr.warning("AI ไม่ได้ส่งไอเทมกลับมา ลองใหม่นะ", "TinyPet"); return; }
        savePetShop();
        renderPetShop();
        if (!opts.silent) toastr.success(`AI สร้างไอเทม ${added} ชิ้นแล้ว`, "TinyPet");
    } catch (e) {
        console.error(`[${extensionName}] generate pet items failed:`, e);
        if (!opts.silent) toastr.error("สร้างไอเทมไม่สำเร็จ ลองใหม่นะ", "TinyPet");
    } finally {
        isPetShopBusy = false;
        btn.removeClass("tinyfeed-generating").prop("disabled", false);
    }
}
// ITEM: ชื่อ | ราคาเหรียญ | ประเภท | อิโมจิ | ค่าพลัง | รายละเอียด
function parsePetItems(raw) {
    const s = stripReasoning(raw);
    const valid = Object.keys(PET_ITEM_TYPES);
    const re = /ITEM:\s*(.+)/gi;
    let m, count = 0;
    while ((m = re.exec(s)) !== null) {
        const parts = m[1].split("|").map((x) => x.trim());
        const name = (parts[0] || "").replace(/^["'“”\[\(]+|["'“”\]\)]+$/g, "").trim();
        const price = Math.abs(Math.round(parseFloat(String(parts[1] || "").replace(/[^\d.]/g, "")) || 0));
        let type = (parts[2] || "").trim().toLowerCase();
        const emoji = (parts[3] || "").trim().slice(0, 4);
        const amount = Math.max(1, Math.abs(parseInt(String(parts[4] || "").replace(/[^\d]/g, ""), 10) || 30));
        const desc = (parts[5] || "").trim();
        if (!name) continue;
        if (!valid.includes(type)) type = "food";
        getPetShop().push({ id: petItemId(), name, price: price || 10, emoji, image: "", type, amount, desc });
        count++;
    }
    return count;
}

// ===== TinyPet: มินิเกม (เกมเซ็นเตอร์ + ระบบพลังงาน/รางวัลร่วม) =====
function petGameEnergyCost() { return Math.max(0, parseInt(getSetting("petGameEnergyCost"), 10) || 15); }
function petCanPlayGame() {
    const p = getPet();
    if (!p.exists || p.isDead) return false;
    if (p.isSleeping) { toastr.info("เพ็ทกำลังหลับอยู่ ปลุกก่อนนะ", "TinyPet"); return false; }
    if (p.stats.energy < petGameEnergyCost()) { toastr.info("เพ็ทเหนื่อยเกินจะเล่น ให้พักก่อนนะ 😪", "TinyPet"); return false; }
    return true;
}
// หักพลังงานตอนเริ่มเล่น (พลังงานคือตัวจำกัดการเล่นตามธรรมชาติ — ไม่ต้องมี cooldown แยก)
function petGameStart() {
    petApplyDecay();
    const p = getPet();
    p.stats.energy = clamp100(p.stats.energy - petGameEnergyCost());
    p.lastUpdateTimestamp = Date.now();
    savePet();
}
// ให้รางวัลตอนจบเกม: เหรียญ + อารมณ์ + ผูกพัน
function petGameReward(coins, moodGain, bondGain) {
    const p = getPet();
    petAddCoins(coins);
    p.stats.mood = clamp100(p.stats.mood + (moodGain || 0));
    petBondAdd(bondGain || 0);
    p.lastUpdateTimestamp = Date.now();
    savePet();
}

const PET_GAMES = [
    { id: "memory", emoji: "🃏", name: "จับคู่การ์ด", desc: "เกมความจำ · จับคู่ให้ครบ", ready: true },
    { id: "spot", emoji: "🔍", name: "หา emoji ที่ต่าง", desc: "แตะตัวที่ต่าง · จับเวลา 40 วิ", ready: true },
    { id: "whack", emoji: "🔨", name: "ตีตัวตุ่น", desc: "ตี 🐹 เลี่ยง 💣 · จับเวลา 35 วิ", ready: true },
];
let currentPetGame = null;
function stopAllPetGames() { stopSpotGame(); stopWhackGame(); }
function openPetGame() {
    const p = getPet();
    if (!p.exists || p.isDead) return;
    renderPetGameMenu();
    $("#tinyfeed-pet-game-modal").removeClass("tinyfeed-hidden");
}
function closePetGame() { $("#tinyfeed-pet-game-modal").addClass("tinyfeed-hidden"); memoryState = null; stopAllPetGames(); }
function renderPetGameMenu() {
    stopAllPetGames();
    const e = Math.round(getPet().stats.energy);
    const cost = petGameEnergyCost();
    const cards = PET_GAMES.map((g) => `
        <div class="tinyfeed-pet-game-card${g.ready ? "" : " tinyfeed-pet-game-soon"}" ${g.ready ? `data-game="${g.id}"` : ""}>
            <span class="tinyfeed-pet-game-emoji">${g.emoji}</span>
            <span class="tinyfeed-pet-game-info"><b>${escapeText(g.name)}</b><small>${escapeText(g.desc)}</small></span>
            ${g.ready ? `<i class="fa-solid fa-chevron-right"></i>` : `<span class="tinyfeed-pet-game-soonlabel">เร็วๆ นี้</span>`}
        </div>`).join("");
    $("#tinyfeed-pet-game-title").text("เล่นเกมกับเพ็ท");
    $("#tinyfeed-pet-game-body").html(`
        <div class="tinyfeed-pet-game-energy">พลังงานเพ็ท: <b>${e}</b> · เล่น 1 เกมใช้ ${cost} · ได้ 🪙 + อารมณ์ + ผูกพัน</div>
        <div class="tinyfeed-pet-game-list">${cards}</div>
    `);
}
function petLaunchGame(id) {
    if (!petCanPlayGame()) return;
    currentPetGame = id;
    if (id === "memory") startMemoryGame();
    else if (id === "spot") startSpotGame();
    else if (id === "whack") startWhackGame();
}
function renderPetGameResult(html) {
    $("#tinyfeed-pet-game-body").html(`<div class="tinyfeed-pet-game-result">${html}
        <button id="tinyfeed-pet-game-again" class="tinyfeed-btn-primary"><i class="fa-solid fa-rotate-right"></i> เล่นอีก</button>
        <button id="tinyfeed-pet-game-menu" class="tinyfeed-btn-ghost">กลับเมนูเกม</button>
    </div>`);
}

// ── เกม 1: จับคู่การ์ด (Memory) ──
const MEMORY_EMOJIS = ["🍖", "🎾", "🦴", "🐟", "🧶", "🥎", "🐾", "🎁", "⭐", "🧸"];
let memoryState = null;
function startMemoryGame() {
    petGameStart();   // หักพลังงาน
    const pairs = 6;
    const pool = MEMORY_EMOJIS.slice().sort(() => Math.random() - 0.5).slice(0, pairs);
    const cards = pool.concat(pool)
        .map((emoji) => ({ emoji, flipped: false, matched: false }))
        .sort(() => Math.random() - 0.5);
    memoryState = { cards, pairs, first: null, moves: 0, locked: false };
    $("#tinyfeed-pet-game-title").text("จับคู่การ์ด 🃏");
    renderMemory();
}
function renderMemory() {
    const st = memoryState;
    if (!st) return;
    const grid = st.cards.map((c, i) => {
        const face = c.matched || c.flipped;
        return `<div class="tinyfeed-mem-card${face ? " tinyfeed-mem-open" : ""}${c.matched ? " tinyfeed-mem-matched" : ""}" data-idx="${i}">
            <span>${face ? c.emoji : "❓"}</span>
        </div>`;
    }).join("");
    $("#tinyfeed-pet-game-body").html(`
        <div class="tinyfeed-mem-bar">ตา: <b>${st.moves}</b> · จับคู่ได้ <b>${st.cards.filter((c) => c.matched).length / 2}/${st.pairs}</b></div>
        <div class="tinyfeed-mem-grid">${grid}</div>
    `);
}
function memoryFlip(idx) {
    const st = memoryState;
    if (!st || st.locked) return;
    const card = st.cards[idx];
    if (!card || card.flipped || card.matched) return;
    card.flipped = true;
    if (st.first === null) { st.first = idx; renderMemory(); return; }
    st.moves++;
    const a = st.cards[st.first], b = card;
    if (a.emoji === b.emoji) {
        a.matched = b.matched = true;
        st.first = null;
        renderMemory();
        if (st.cards.every((c) => c.matched)) memoryWin();
    } else {
        st.locked = true;
        renderMemory();
        setTimeout(() => {
            a.flipped = false; b.flipped = false; st.first = null; st.locked = false;
            renderMemory();
        }, 850);
    }
}
function memoryWin() {
    const st = memoryState;
    const perfect = st.pairs;   // จำนวนตาที่ดีที่สุด = จำนวนคู่
    const coins = Math.max(6, 36 - Math.max(0, st.moves - perfect) * 3);
    petGameReward(coins, 15, 3);
    memoryState = null;
    renderPetGameResult(`<div class="tinyfeed-pet-game-result-emoji">🎉</div>
        <div class="tinyfeed-pet-game-result-title">เก่งมาก!</div>
        <div class="tinyfeed-pet-game-result-detail">ใช้ ${st.moves} ตา · ได้ 🪙 <b>${coins}</b> · อารมณ์ +15 · ผูกพัน +3</div>`);
}

// ── เกม 2: หา emoji ที่ต่าง (Spot the odd one) ──
// low-motion: วาดกริดใหม่ "เฉพาะตอนแตะ"; timer แค่เดินเลขทุก 250ms (ไม่แตะกริด) → ลื่นบนมือถือ
const SPOT_DURATION = 40000;   // มิลลิวินาที
const SPOT_TIERS = [
    // ง่าย (ต่างชัด)
    [["🐶", "🐱"], ["🍎", "🍔"], ["⭐", "🌙"], ["🐟", "🦴"], ["🌵", "🌲"], ["🚗", "🚌"], ["🎈", "🎀"]],
    // กลาง (หมวด/ทรงใกล้กัน)
    [["🍊", "🍋"], ["🐸", "🐢"], ["🌻", "🌼"], ["🐮", "🐷"], ["🍇", "🫐"], ["🦊", "🐱"], ["🍅", "🍎"]],
    // ยาก (คล้ายกันมาก)
    [["😀", "😄"], ["😺", "😸"], ["🌕", "🌝"], ["🟠", "🟡"], ["🔵", "🟣"], ["🥔", "🥚"], ["🌛", "🌜"]],
];
let spotState = null;
let spotTimer = null;
function spotTierForRound(round) { return round <= 2 ? 0 : round <= 4 ? 1 : 2; }
function spotGridCols(round) { return Math.min(6, 3 + Math.floor((round - 1) / 2)); }   // 3,3,4,4,5,5,6,6…
function stopSpotGame() {
    if (spotTimer) { clearInterval(spotTimer); spotTimer = null; }
    spotState = null;
}
function startSpotGame() {
    petGameStart();     // หักพลังงาน
    stopSpotGame();     // กันซ้อน
    const now = Date.now();
    spotState = { round: 1, score: 0, endsAt: now + SPOT_DURATION, timeLeft: Math.round(SPOT_DURATION / 1000), cols: 3, oddIdx: 0, base: "🐶", odd: "🐱", wrongFlash: false };
    spotNewRound();
    $("#tinyfeed-pet-game-title").text("หา emoji ที่ต่าง 🔍");
    renderSpot();
    spotTimer = setInterval(spotTimerTick, 250);   // timer เบา: อัปเดตเลขเวลาอย่างเดียว
}
// สุ่มด่านใหม่: เลือกคู่ตามระดับความยาก + สลับ base/odd + ตำแหน่งตัวต่าง
function spotNewRound() {
    const st = spotState;
    st.cols = spotGridCols(st.round);
    const tier = SPOT_TIERS[spotTierForRound(st.round)];
    const pair = tier[Math.floor(Math.random() * tier.length)];
    if (Math.random() < 0.5) { st.base = pair[0]; st.odd = pair[1]; }
    else { st.base = pair[1]; st.odd = pair[0]; }
    st.oddIdx = Math.floor(Math.random() * st.cols * st.cols);
}
function renderSpot() {
    const st = spotState;
    if (!st) return;
    const n = st.cols * st.cols;
    let tiles = "";
    for (let i = 0; i < n; i++) {
        tiles += `<div class="tinyfeed-spot-tile" data-idx="${i}">${i === st.oddIdx ? st.odd : st.base}</div>`;
    }
    $("#tinyfeed-pet-game-body").html(`
        <div class="tinyfeed-spot-hud">
            <span>⏱ <b id="tinyfeed-spot-time">${st.timeLeft}</b> วิ</span>
            <span>รอบ <b>${st.round}</b> · คะแนน <b>${st.score}</b></span>
        </div>
        <div class="tinyfeed-spot-grid${st.wrongFlash ? " tinyfeed-spot-wrong" : ""}" style="grid-template-columns:repeat(${st.cols},1fr)">${tiles}</div>
        <div class="tinyfeed-spot-hint">แตะตัวที่ต่างจากเพื่อน · ตอบผิด −3 วิ</div>
    `);
}
// timer เบาสุด: อัปเดตแค่ตัวเลข ไม่ rebuild กริด (จึงไม่แลค)
function spotTimerTick() {
    if (!spotState || $("#tinyfeed-pet-game-modal").hasClass("tinyfeed-hidden")) { stopSpotGame(); return; }
    const st = spotState;
    st.timeLeft = Math.max(0, Math.ceil((st.endsAt - Date.now()) / 1000));
    $("#tinyfeed-spot-time").text(st.timeLeft);
    if (Date.now() >= st.endsAt) spotWin();
}
function spotTap(idx) {
    const st = spotState;
    if (!st) return;
    if (idx === st.oddIdx) {
        st.score++;
        st.round++;
        spotNewRound();
        renderSpot();
    } else {
        // ตอบผิด: หักเวลา + สั่นแดง (ไม่จบเกม)
        st.endsAt -= 3000;
        st.wrongFlash = true;
        renderSpot();
        setTimeout(() => { if (spotState) { spotState.wrongFlash = false; renderSpot(); } }, 240);
    }
}
function spotWin() {
    const score = spotState ? spotState.score : 0;
    stopSpotGame();
    const coins = Math.max(5, score * 3);
    petGameReward(coins, 15, 3);
    renderPetGameResult(`<div class="tinyfeed-pet-game-result-emoji">${score > 0 ? "🎉" : "🍃"}</div>
        <div class="tinyfeed-pet-game-result-title">${score >= 12 ? "ตาไวมาก!" : score >= 5 ? "เก่งมาก!" : "เล่นอีกได้นะ"}</div>
        <div class="tinyfeed-pet-game-result-detail">ผ่าน ${score} รอบ · ได้ 🪙 <b>${coins}</b> · อารมณ์ +15 · ผูกพัน +3</div>`);
}

// ── เกม 3: ตีตัวตุ่น (Whack) ──
// low-motion: สร้างกริดหลุมครั้งเดียว, loop เบาสลับ "class" ต่อหลุม (ตุ่นโผล่ด้วย CSS transform) — ไม่ rebuild กระดาน
const WHACK_HOLES = 9;          // 3×3
const WHACK_DURATION = 35000;   // มิลลิวินาที
let whackState = null;
let whackTimer = null;
function stopWhackGame() {
    if (whackTimer) { clearInterval(whackTimer); whackTimer = null; }
    whackState = null;
}
function startWhackGame() {
    petGameStart();     // หักพลังงาน
    stopWhackGame();    // กันซ้อน
    const now = Date.now();
    whackState = {
        score: 0, timeLeft: Math.round(WHACK_DURATION / 1000), endsAt: now + WHACK_DURATION,
        holes: Array.from({ length: WHACK_HOLES }, () => ({ active: false, bomb: false, upUntil: 0 })),
        nextSpawnAt: now + 400,
    };
    $("#tinyfeed-pet-game-title").text("ตีตัวตุ่น 🔨");
    renderWhack();
    whackTimer = setInterval(whackTick, 120);
}
function renderWhack() {
    const st = whackState;
    if (!st) return;
    let holes = "";
    for (let i = 0; i < WHACK_HOLES; i++) {
        holes += `<div class="tinyfeed-whack-hole" data-idx="${i}"><span class="tinyfeed-whack-mole"></span></div>`;
    }
    $("#tinyfeed-pet-game-body").html(`
        <div class="tinyfeed-whack-hud">
            <span>⏱ <b id="tinyfeed-whack-time">${st.timeLeft}</b> วิ</span>
            <span>คะแนน <b id="tinyfeed-whack-score">${st.score}</b></span>
        </div>
        <div class="tinyfeed-whack-grid">${holes}</div>
        <div class="tinyfeed-whack-hint">แตะ 🐹 ให้โดน · เลี่ยง 💣 · ยิ่งไวยิ่งได้เยอะ</div>
    `);
    for (let i = 0; i < WHACK_HOLES; i++) paintWhackHole(i);
}
// อัปเดต DOM เฉพาะหลุมเดียว (ไม่แตะทั้งกระดาน)
function paintWhackHole(i) {
    const st = whackState;
    if (!st) return;
    const h = st.holes[i];
    const $hole = $(`.tinyfeed-whack-hole[data-idx="${i}"]`);
    if (!$hole.length) return;
    $hole.toggleClass("tinyfeed-whack-up", h.active);
    $hole.toggleClass("tinyfeed-whack-bomb", h.active && h.bomb);
    // ตอน active ตั้งอิโมจิ; ตอน inactive คงอิโมจิเดิมไว้ให้สไลด์ลงหลุม (โดน overflow:hidden ตัด + จางหาย) ไม่เคลียร์ทันที
    if (h.active) $hole.find(".tinyfeed-whack-mole").text(h.bomb ? "💣" : "🐹");
}
// loop เบา: อัปเดตเลขเวลา + ซ่อนตัวหมดเวลา + เกิดตัวใหม่ (แตะ DOM เฉพาะหลุมที่เปลี่ยน)
function whackTick() {
    if (!whackState || $("#tinyfeed-pet-game-modal").hasClass("tinyfeed-hidden")) { stopWhackGame(); return; }
    const st = whackState;
    const now = Date.now();
    st.timeLeft = Math.max(0, Math.ceil((st.endsAt - now) / 1000));
    $("#tinyfeed-whack-time").text(st.timeLeft);
    const elapsed = (WHACK_DURATION - (st.endsAt - now)) / 1000;
    // ซ่อนตัวที่หมดเวลาโผล่
    for (let i = 0; i < WHACK_HOLES; i++) {
        if (st.holes[i].active && now >= st.holes[i].upUntil) {
            st.holes[i].active = false;
            paintWhackHole(i);
        }
    }
    // เกิดตัวใหม่ (ยิ่งนานยิ่งถี่ + โผล่สั้นลง)
    if (now >= st.nextSpawnAt) {
        const empty = [];
        for (let i = 0; i < WHACK_HOLES; i++) if (!st.holes[i].active) empty.push(i);
        if (empty.length) {
            const i = empty[Math.floor(Math.random() * empty.length)];
            const upMs = Math.max(650, 1050 - elapsed * 12);
            st.holes[i] = { active: true, bomb: Math.random() < 0.18, upUntil: now + upMs };
            paintWhackHole(i);
        }
        const gap = Math.max(430, 820 - elapsed * 12);
        st.nextSpawnAt = now + gap;
    }
    if (now >= st.endsAt) whackWin();
}
function whackHit(i) {
    const st = whackState;
    if (!st) return;
    const h = st.holes[i];
    if (!h.active) return;   // แตะหลุมว่าง = ไม่มีอะไรเกิด
    h.active = false;
    paintWhackHole(i);
    if (h.bomb) {
        st.score = Math.max(0, st.score - 2);
        const $g = $(".tinyfeed-whack-grid").addClass("tinyfeed-whack-wrong");
        setTimeout(() => $g.removeClass("tinyfeed-whack-wrong"), 240);
    } else {
        st.score++;
    }
    $("#tinyfeed-whack-score").text(st.score);
}
function whackWin() {
    const score = whackState ? whackState.score : 0;
    stopWhackGame();
    const coins = Math.max(5, score * 3);
    petGameReward(coins, 15, 3);
    renderPetGameResult(`<div class="tinyfeed-pet-game-result-emoji">${score > 0 ? "🎉" : "🍃"}</div>
        <div class="tinyfeed-pet-game-result-title">${score >= 20 ? "มือไวสุดๆ!" : score >= 8 ? "เก่งมาก!" : "เล่นอีกได้นะ"}</div>
        <div class="tinyfeed-pet-game-result-detail">ตีโดน ${score} ตัว · ได้ 🪙 <b>${coins}</b> · อารมณ์ +15 · ผูกพัน +3</div>`);
}

// หลังตาย: กลับไปหน้า "รับเลี้ยง" (ให้ตั้งชื่อใหม่) — ไม่ auto-adopt ทันที
function petAdoptNew() {
    const p = getPet();
    Object.assign(p, defaultPet());   // exists=false → renderPet โชว์หน้า create
    savePet();
    renderPet();
}

// สร้างเพ็ทใหม่ / รับเลี้ยงตัวใหม่หลังตาย
function petAdopt(name) {
    const nm = String(name || "").trim().slice(0, 24) || "เพื่อนตัวน้อย";
    const p = getPet();
    const fresh = defaultPet();
    fresh.exists = true; fresh.name = nm; fresh.createdAt = Date.now(); fresh.lastUpdateTimestamp = Date.now();
    Object.assign(p, fresh);
    savePet();
    renderPet();
    toastr.success(`ยินดีต้อนรับ ${nm}! 🐣`, "TinyPet");
}

// ===== TinyPet AI reaction =====
let petBubble = "";
let petBubbleTimer = null;
let petLastReactionAt = 0;
let petReacting = false;
function petSpeak(text) {
    petBubble = String(text || "");
    if (currentApp === "pet") renderPet();
    clearTimeout(petBubbleTimer);
    petBubbleTimer = setTimeout(() => { petBubble = ""; if (currentApp === "pet") renderPet(); }, 9000);
}
function petReactThrottled(lastAction) {
    const now = Date.now();
    if (now - petLastReactionAt < 15000) return;   // กันยิงถี่เปลือง token
    petLastReactionAt = now;
    petReact(lastAction);
}
async function petReact(lastAction, opts) {
    opts = opts || {};
    const p = getPet();
    const ctx = getContext();
    if (!p.exists || p.isDead) return;
    if (typeof ctx.generateQuietPrompt !== "function") { if (!opts.silent) toastr.info("เวอร์ชัน ST นี้ให้เพ็ทพูดไม่ได้", "TinyPet"); return; }
    if (petReacting) return;
    petReacting = true;
    $("#tinyfeed-pet-speak").addClass("tinyfeed-generating");
    try {
        const s = p.stats;
        const statsLine = `ความอิ่ม ${Math.round(100 - s.hunger)}/100, พลังงาน ${Math.round(s.energy)}, ความสะอาด ${Math.round(s.cleanliness)}, อารมณ์ ${Math.round(s.mood)}, สุขภาพ ${Math.round(s.health)}` + (p.isSleeping ? " (กำลังหลับ)" : "");
        const extra = String(getSetting("petExtraPrompt") || "").trim();
        const q = buildPrompt("petReaction", {
            petName: p.name || "เพ็ท", stage: p.stage || "baby", stats: statsLine,
            lastAction: petActionLabel(lastAction),
            extra: extra ? `คำสั่งเพิ่มเติม: ${extra}. ` : "",
            context: crossAppContext("pet"),
        });
        const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("petTokens"), 10) || 60), "pet");
        let line = stripWrapBrackets(stripReasoning(raw).replace(/^REACTION:\s*/i, "").trim());
        if (line) petSpeak(line);
        else if (!opts.silent) toastr.info("เพ็ทยังไม่พูดอะไร ลองใหม่นะ", "TinyPet");
    } catch (e) {
        console.error(`[${extensionName}] petReact failed:`, e);
        if (!opts.silent) toastr.error("ให้เพ็ทพูดไม่สำเร็จ", "TinyPet");
    } finally {
        petReacting = false;
        $("#tinyfeed-pet-speak").removeClass("tinyfeed-generating");
    }
}

// เพ็ทโพสต์ลงฟีด TinyFeed (มุมมองน่ารักของสัตว์เลี้ยง) — manual หรือ auto
let petPosting = false;
async function petPostToFeed(opts) {
    opts = opts || {};
    const p = getPet();
    const ctx = getContext();
    if (!p.exists || p.isDead || petPosting) return;
    if (typeof ctx.generateQuietPrompt !== "function") { if (!opts.silent) toastr.info("เวอร์ชัน ST นี้โพสต์ไม่ได้", "TinyPet"); return; }
    petPosting = true;
    $("#tinyfeed-pet-post").addClass("tinyfeed-generating");
    try {
        const extra = String(getSetting("petExtraPrompt") || "").trim();
        const q = buildPrompt("petPost", {
            petName: p.name || "เพ็ท", mood: petMoodText(petState()),
            extra: extra ? `คำสั่งเพิ่มเติม: ${extra}. ` : "",
            context: crossAppContext("pet"),
        });
        const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("petTokens"), 10) || 60), "pet");
        const parsed = parseGeneratedPost(raw, p.name || "เพ็ท");
        const text = stripWrapBrackets(parsed.text || "");
        if (!text) { if (!opts.silent) toastr.info("เพ็ทยังไม่อยากโพสต์ ลองใหม่นะ", "TinyPet"); return; }
        getFeedData().feed.unshift({
            id: "pet" + Date.now(), author: p.name || "เพ็ท", isMain: false, isAI: true, isPet: true,
            avatar: petSpriteUrl(petState()), ts: Date.now(), text: escapeHtml(text),
            likes: randomInitialLikes(), comments: [],
        });
        saveFeedData();
        if (currentApp === "feed") renderFeed();
        if (opts.notify) showNotif(petNotifAvatar(), p.name || "เพ็ท", htmlToPlain(text), "feed", "feed");
    } catch (e) {
        console.error(`[${extensionName}] petPostToFeed failed:`, e);
        if (!opts.silent) toastr.error("โพสต์ไม่สำเร็จ", "TinyPet");
    } finally {
        petPosting = false;
        $("#tinyfeed-pet-post").removeClass("tinyfeed-generating");
    }
}

// ===== TinyPet notifications + timers =====
function petNotifAvatar() {
    return `<div class="tinyfeed-avatar tinyfeed-pet-notif-ava">${PET_STATE_EMOJI[petState()] || "🐾"}</div>`;
}
// เพ็ท "ทัก" ผู้ใช้ผ่าน TinyConnect (global thread) + แจ้งเตือนในโทรศัพท์ + OS (ผ่าน showNotif)
function petSendDM(text) {
    const p = getPet();
    if (!p.exists) return;
    if (!Array.isArray(p.dm)) p.dm = [];
    p.dm.push({ from: "contact", author: p.name || "เพ็ท", text: escapeHtml(String(text || "")), ts: Date.now() });
    if (p.dm.length > 60) p.dm.splice(0, p.dm.length - 60);
    savePet();
    if (currentApp === "connect" && activeThread === "pet") renderThread();
    else if (currentApp === "connect") renderConnectList();   // อัปเดตข้อความล่าสุดในรายชื่อ
    // แจ้งเตือน (แบนเนอร์ + ลิ้นชัก + OS) กดแล้วเข้าห้องแชตเพ็ทใน TinyConnect
    showNotif(petNotifAvatar(), p.name || "เพ็ท", String(text || ""), "connect", "connect", "pet", p.name || "เพ็ท");
}
// เช็คสถานะวิกฤต → ให้เพ็ททักเข้ามาเอง (edge-triggered ผ่าน p.notified กันสแปม)
function petCheckCritical(p) {
    const s = p.stats, n = p.notified;
    const fire = (key, cond, msg) => {
        if (cond && !n[key]) { n[key] = true; petSendDM(msg); }
        else if (!cond && n[key]) { n[key] = false; }   // กลับมาปกติ = เตือนได้อีกรอบเมื่อวิกฤตซ้ำ
    };
    fire("hunger", s.hunger >= 85, "หิวมากแล้วน้า~ มาให้ข้าวหน่อยได้ไหม 🍽️");
    fire("dirty", s.cleanliness <= 15, "ตัวเลอะเทอะไปหมดแล้ว อยากอาบน้ำจัง 🛁");
    fire("energy", s.energy <= 10 && !p.isSleeping, "ง่วงจนตาจะปิดแล้ว พาไปนอนหน่อยน้า 😪");
    fire("mood", s.mood <= 15 && s.health > 20, "เหงาจังเลย... มาเล่นด้วยกันหน่อยนะ 🥺");
    fire("health", s.health <= 20, "รู้สึกไม่ค่อยสบายเลย ช่วยดูแลหน่อยน้า 🤒");
}
// ผูกพันเพิ่มจากการโรลเพลย์: พูดถึงชื่อเพ็ทในแชท RP → bond + mood ขึ้น (มี cooldown)
let petBondRpAt = 0;
function petOnRpMessage() {
    const p = getPet();
    if (!p.exists || p.isDead || !p.name) return;
    const now = Date.now();
    if (now - petBondRpAt < 45000) return;
    const text = lastRpText().toLowerCase();
    if (!text || !text.includes(String(p.name).trim().toLowerCase())) return;   // ต้องเอ่ยถึงเพ็ท
    petBondRpAt = now;
    petApplyDecay();
    petBondAdd(5);
    p.stats.mood = clamp100(p.stats.mood + 5);
    savePet();
    if (currentApp === "pet") renderPet();
}
let petTimer = null;
function startPetTimer() {
    if (petTimer) return;
    petTimer = setInterval(petBackgroundTick, 60000);   // เดินตลอดเมื่อเปิด ST (แม้ปิดหน้าแอป)
}
function petBackgroundTick() {
    const p = getPet();
    if (!p.exists || p.isDead) return;
    const wasDead = p.isDead;
    petApplyDecay();
    savePet();
    petCheckCritical(p);
    if (p.isDead && !wasDead) showNotif(petNotifAvatar(), p.name || "เพ็ท", "จากไปอย่างสงบแล้ว 🪦 รับเลี้ยงตัวใหม่ได้นะ", "pet", "pet");
    petMaybeAutoPost(p);
    if (currentApp === "pet") renderPet();
}
let lastPetPostTs = 0;
function petMaybeAutoPost(p) {
    if (!getSetting("petAutoPost") || p.isDead) return;
    const now = Date.now();
    if (now - lastPetPostTs < 3 * 3600000) return;   // เว้นอย่างน้อย 3 ชม./โพสต์
    if (petState() !== "happy") return;              // โพสต์เฉพาะตอนอารมณ์ดี
    if (Math.random() > 0.15) return;                // สุ่มเบาๆ กันโพสต์ถี่
    lastPetPostTs = now;
    petPostToFeed({ notify: true, silent: true });
}
let petLiveTimer = null;
function startPetLiveTick() {
    clearPetLiveTick();
    petLiveTimer = setInterval(() => {
        const p = getPet();
        if (!p.exists || p.isDead) return;   // หน้า create/dead ไม่ต้อง re-render (กันโฟกัสหลุด)
        renderPet();
    }, 5000);
}
function clearPetLiveTick() { if (petLiveTimer) { clearInterval(petLiveTimer); petLiveTimer = null; } }

// ===== TinyPet render =====
function petMoodText(state) {
    return ({
        idle: "สบายๆ อยู่เป็นเพื่อน 🐾", happy: "อารมณ์ดีมาก! 💖", hungry: "หิวแล้วน้า...", sleepy: "ง่วงจัง...",
        dirty: "ตัวเลอะแล้ว อยากอาบน้ำ", sick: "ไม่ค่อยสบายเลย 🤒", sleeping: "กำลังหลับปุ๋ย 💤", dead: "จากไปแล้ว 🌈",
    })[state] || "สบายๆ";
}
function petBar(label, val, opts) {
    opts = opts || {};
    const v = Math.round(clamp100(val));
    let color = "#22c55e";
    if (v <= 25) color = "#ef4444"; else if (v <= 50) color = "#f59e0b";
    return `<div class="tinyfeed-pet-stat">
        <span class="tinyfeed-pet-stat-label">${opts.icon ? `<i class="fa-solid ${opts.icon}"></i> ` : ""}${escapeText(label)}</span>
        <span class="tinyfeed-pet-stat-bar"><span style="width:${v}%;background:${color}"></span></span>
        <span class="tinyfeed-pet-stat-num">${v}</span>
    </div>`;
}
function formatPetAge(createdAt) {
    const min = Math.floor((Date.now() - (createdAt || Date.now())) / 60000);
    if (min < 60) return `${Math.max(0, min)} นาที`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} ชั่วโมง`;
    return `${Math.floor(hr / 24)} วัน`;
}
function petCreateHtml() {
    return `<div class="tinyfeed-pet-screen tinyfeed-pet-create">
        <div class="tinyfeed-pet-bigemoji tinyfeed-pet-bob">🥚</div>
        <div class="tinyfeed-pet-screen-title">รับเลี้ยงเพื่อนตัวใหม่</div>
        <div class="tinyfeed-pet-screen-sub">ตั้งชื่อแล้วเริ่มดูแลกันเลย</div>
        <input id="tinyfeed-pet-name-input" type="text" maxlength="24" placeholder="ชื่อเพ็ท..." />
        <button id="tinyfeed-pet-adopt" class="tinyfeed-btn-primary"><i class="fa-solid fa-heart"></i> รับเลี้ยง</button>
    </div>`;
}
function petDeadHtml() {
    const p = getPet();
    return `<div class="tinyfeed-pet-screen tinyfeed-pet-dead">
        <div class="tinyfeed-pet-bigemoji">🪦</div>
        <div class="tinyfeed-pet-screen-title">${escapeText(p.name || "เพ็ท")} จากไปแล้ว</div>
        <div class="tinyfeed-pet-screen-sub">อยู่ด้วยกันมา ${formatPetAge(p.createdAt)} · ขอบคุณที่ดูแลกันนะ 🌈</div>
        <button id="tinyfeed-pet-adopt-new" class="tinyfeed-btn-primary"><i class="fa-solid fa-seedling"></i> รับเลี้ยงตัวใหม่</button>
    </div>`;
}
function renderPet() {
    const p = petApplyDecay();
    savePet();
    const body = $("#tinyfeed-pet-body");
    if (!body.length) return;
    if (!p.exists) { body.html(petCreateHtml()); return; }
    if (p.isDead) { body.html(petDeadHtml()); return; }
    const s = p.stats;
    const st = petState();
    const stageLabel = ({ baby: "เด็ก", teen: "วัยรุ่น", adult: "โตเต็มวัย" })[p.stage] || "เด็ก";
    const bubble = petBubble ? `<div class="tinyfeed-pet-bubble">${renderRich(petBubble)}</div>` : "";
    const sleepLabel = p.isSleeping ? "ปลุก" : "นอน";
    const sleepIcon = p.isSleeping ? "fa-sun" : "fa-moon";
    const bondLv = petBondLevel(p.bond);
    const bondPct = bondLv >= 10 ? 100 : ((Number(p.bond) || 0) % PET_BOND_PER_LEVEL) / PET_BOND_PER_LEVEL * 100;
    const bondTitle = bondLv >= 10 ? "เพื่อนซี้ 💫" : `Lv.${bondLv}`;
    body.html(`
        <div class="tinyfeed-pet-stage-wrap">
            ${bubble}
            ${petSpriteBoxHtml()}
            <div class="tinyfeed-pet-name">${escapeText(p.name)} <span class="tinyfeed-pet-stagepill">${stageLabel}</span></div>
            <div class="tinyfeed-pet-mood">${escapeText(petMoodText(st))}</div>
            <div class="tinyfeed-pet-bond" title="ผูกพันเพิ่มจากการดูแล + เอ่ยถึงเพ็ทในบทบาท">
                <span class="tinyfeed-pet-bond-label"><i class="fa-solid fa-heart-circle-check"></i> ความผูกพัน ${bondTitle}</span>
                <span class="tinyfeed-pet-bond-bar"><span style="width:${bondPct}%"></span></span>
                <span class="tinyfeed-pet-coins" title="เหรียญเพ็ท">🪙 ${petCoins().toLocaleString()}</span>
            </div>
        </div>
        <div class="tinyfeed-pet-stats">
            ${petBar("อิ่ม", 100 - s.hunger, { icon: "fa-drumstick-bite" })}
            ${petBar("พลังงาน", s.energy, { icon: "fa-bolt" })}
            ${petBar("สะอาด", s.cleanliness, { icon: "fa-soap" })}
            ${petBar("อารมณ์", s.mood, { icon: "fa-face-smile" })}
            ${petBar("สุขภาพ", s.health, { icon: "fa-heart" })}
        </div>
        <div class="tinyfeed-pet-actions">
            <button class="tinyfeed-pet-act" data-act="feed"><i class="fa-solid fa-bowl-food"></i><span>ให้อาหาร</span></button>
            <button class="tinyfeed-pet-act" data-act="play"><i class="fa-solid fa-baseball"></i><span>เล่นด้วย</span></button>
            <button class="tinyfeed-pet-act" data-act="clean"><i class="fa-solid fa-shower"></i><span>อาบน้ำ</span></button>
            <button class="tinyfeed-pet-act" data-act="sleep"><i class="fa-solid ${sleepIcon}"></i><span>${sleepLabel}</span></button>
        </div>
        <div class="tinyfeed-pet-extra-actions">
            <button id="tinyfeed-pet-game-btn" class="tinyfeed-btn-generate"><i class="fa-solid fa-gamepad"></i> <span>เล่นเกม</span></button>
            <button id="tinyfeed-pet-shop-btn" class="tinyfeed-btn-generate"><i class="fa-solid fa-store"></i> <span>ร้านค้า</span></button>
            <button id="tinyfeed-pet-speak" class="tinyfeed-btn-generate"><i class="fa-solid fa-comment-dots"></i> <span>ให้เพ็ทพูด</span></button>
            <button id="tinyfeed-pet-post" class="tinyfeed-btn-generate"><i class="fa-solid fa-hashtag"></i> <span>โพสต์ลงฟีด</span></button>
        </div>
    `);
}
// ตัวแก้ลิงก์ sprite ต่อสถานะ (หน้า settings)
let petSpriteCfgStage = "baby";
function renderPetSpriteCfg() {
    const map = getSetting("petSprites") || {};
    const labels = PET_STATE_LABEL;
    const stg = PET_STAGES.includes(petSpriteCfgStage) ? petSpriteCfgStage : "baby";
    const stageOpts = PET_STAGES.map((s) => `<option value="${s}"${s === stg ? " selected" : ""}>${PET_STAGE_LABEL[s]}</option>`).join("");
    const rows = PET_SPRITE_STATES.map((st) => {
        const key = stg === "baby" ? st : `${stg}_${st}`;   // baby = คีย์สถานะล้วน (default/สำรอง), teen/adult = <stage>_<state>
        return `
        <div class="tinyfeed-pet-sprite-row">
            <span class="tinyfeed-pet-sprite-emoji">${PET_STATE_EMOJI[st]}</span>
            <span class="tinyfeed-pet-sprite-label">${labels[st] || st}</span>
            <input class="tinyfeed-pet-sprite-url" data-key="${escapeAttr(key)}" type="text" placeholder="ลิงก์รูป (ว่าง = ใช้ไฟล์ในตัว)" value="${escapeAttr(map[key] || "")}" />
        </div>`;
    }).join("");
    $("#tinyfeed-pet-sprite-list").html(`
        <div class="tinyfeed-pet-sprite-stagebar">
            <span>ระยะวิวัฒนาการ:</span>
            <select id="tinyfeed-pet-sprite-stage">${stageOpts}</select>
            <small>เด็ก = ค่าเริ่มต้น/สำรองของทุกระยะ · ไฟล์ในตัวตั้งชื่อ <code>&lt;ระยะ&gt;_&lt;สถานะ&gt;.png</code> เช่น <code>teen_idle.png</code> (ว่างไว้ = ใช้ร่างเด็ก)</small>
        </div>
        ${rows}`);
}

// ถอด HTML entity เบาๆ (สำหรับจับคู่ชื่อในโทเคน [sticker:...] / [img:...] ที่ผ่าน escape มาแล้ว)

// หาสติกเกอร์/รูปในคลังตามชื่อ (case-insensitive) ไม่เจอคืน null

// หา URL รูปของ NPC จากรายชื่อประจำ (ตามชื่อ) ไม่เจอคืน ""
function getNpcAvatar(name) {
    const key = String(name || "").trim().toLowerCase();
    if (!key) return "";
    const npc = getNpcs().find((n) => String(n.name || "").trim().toLowerCase() === key);
    return (npc && npc.avatar) ? npc.avatar : "";
}

// แปลง HTML ของโพสต์กลับเป็น plain text (สำหรับแนบเข้า prompt)

// บันทึกข้อมูลผูกกับแชท

// ตัวละครหลักของแชทปัจจุบัน { file, name } หรือ null
function getCurrentCharacter() {
    try {
        const context = getContext();
        const charId = context.characterId;
        if (charId === undefined || charId === null) return null;
        const char = context.characters[charId];
        if (!char) return null;
        return { file: char.avatar, name: char.name };
    } catch (e) {
        return null;
    }
}

// ดึง URL avatar ของตัวละครหลัก (override ด้วยลิงก์ภายนอกได้)
function getCharacterAvatar() {
    const char = getCurrentCharacter();
    if (!char) return "";
    const override = getCharProfile().avatarUrl;   // per-char (เว้นว่าง = ใช้รูปการ์ดจริง)
    if (override) return override;
    if (!char.file || char.file === "none") return "";
    return `/thumbnail?type=avatar&file=${encodeURIComponent(char.file)}`;
}

// เวลาสัมพัทธ์แบบไทย จาก timestamp (ms)

// หา timestamp ของ item (จาก field ts หรือกู้จากตัวเลขใน id) ไม่มีคืน null

// ข้อความเวลาที่จะแสดง (ใช้เวลาสัมพัทธ์ถ้ามี ts/id, ไม่มีก็ใช้ field time เดิม เช่นข้อมูล seed)

// ย่อเลขก้อนใหญ่ให้สั้น (1500 → 1.5K, 1200000 → 1.2M) ใช้โชว์ในฟีด
function formatCount(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return +(n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return +(n / 1e3).toFixed(1) + "K";
    return String(n);
}

// สุ่มจำนวนไลค์เริ่มต้นตามช่วงที่ตั้งไว้ใน config (กันค่าเพี้ยน)
function randomInitialLikes() {
    let min = parseInt(getSetting("likesMin"), 10);
    let max = parseInt(getSetting("likesMax"), 10);
    if (!Number.isFinite(min) || min < 0) min = 0;
    if (!Number.isFinite(max) || max < 0) max = 0;
    if (max < min) max = min;
    return min + Math.floor(Math.random() * (max - min + 1));
}

// escape อักขระพิเศษ (คง \n ไว้) สำหรับข่าวที่ต้องแบ่งย่อหน้าเอง

// escape ข้อความของผู้ใช้ก่อนยัดลง HTML (กัน HTML พัง/inject) + แปลงขึ้นบรรทัดใหม่เป็น <br>

// แต่งข้อความที่ escape แล้ว: markdown เบาๆ + #แฮชแท็ก / @เมนชัน เป็นสีฟ้า
// (ปลอดภัยเพราะรับ input ที่ผ่าน escape มาแล้ว แท็กเดียวที่มีคือ <br>)
// รูป > สติกเกอร์: ถ้าข้อความมีทั้ง [img:] (ที่หาเจอ) และ [sticker:] → ตัดสติกเกอร์ทิ้ง แสดงแค่รูป


// escape สำหรับใส่ในค่า attribute (value="...")

// แปลงโทเคนสติกเกอร์/รูปเป็น <img> (เรียกจาก renderRich) — ไม่เจอชื่อ = โชว์ placeholder

// วาดเนื้อโพสต์ TinyFeed: ข้อความ/แคปชันอยู่บน · รูป/สติกเกอร์ย้ายลงล่างเสมอ
function renderPostBody(text) {
    let s = resolveMediaPriority(text);   // รูป > สติกเกอร์
    const media = [];
    s = s.replace(/\[sticker:([^\]]+)\]/gi, (m, n) => { media.push(renderStickerToken(unescapeLite(n))); return ""; });
    s = s.replace(/\[img:([^\]]+)\]/gi, (m, n) => { media.push(renderImgToken(unescapeLite(n))); return ""; });
    const textHtml = renderRich(s).replace(/^(?:<br>\s*)+|(?:<br>\s*)+$/g, "").trim();
    const mediaHtml = media.length ? `<div class="tinyfeed-post-media">${media.join("")}</div>` : "";
    return textHtml + mediaHtml;
}

// ตัดวงเล็บ [ ] ที่โมเดลครอบข้อความมา โดยไม่ทำลายโทเคน [sticker:..]/[img:..]

// วาดรายการ NPC ประจำในหน้า settings
function renderNpcList() {
    const rows = getNpcs().map((npc, i) => `
        <div class="tinyfeed-npc-row" data-index="${i}">
            <input class="tinyfeed-npc-name" type="text" placeholder="ชื่อ NPC" value="${escapeAttr(npc.name)}" />
            <input class="tinyfeed-npc-avatar" type="text" placeholder="ลิงก์รูป (optional)" value="${escapeAttr(npc.avatar)}" />
            <span class="tinyfeed-npc-del" title="ลบ NPC"><i class="fa-solid fa-trash"></i></span>
        </div>
    `).join("");
    $("#tinyfeed-npc-list").html(rows);
}

// เติมค่าโปรไฟล์ (ผู้ใช้ผูก persona · ตัวละครผูกการ์ด)
function populateProfileSettings() {
    migrateLegacyAvatars();   // เผื่อ init รันก่อน persona พร้อม
    const up = getUserProfile();
    $("#tinyfeed-cfg-persona-name").text(getRawUserName());
    $("#tinyfeed-cfg-user-avatar").val(up.avatarUrl);
    $("#tinyfeed-cfg-user-username").val(up.username);
    $("#tinyfeed-cfg-user-alias").val(up.alias);
    $("#tinyfeed-cfg-user-primary").val(up.primary);

    const char = getCurrentCharacter();
    const cp = getCharProfile();
    const charFields = $("#tinyfeed-cfg-char-avatar, #tinyfeed-cfg-char-username, #tinyfeed-cfg-char-alias, #tinyfeed-cfg-char-primary");
    if (char) {
        $("#tinyfeed-cfg-char-name").text(getRawCharName());
        charFields.prop("disabled", false);
        $("#tinyfeed-cfg-char-avatar").val(cp.avatarUrl);
        $("#tinyfeed-cfg-char-username").val(cp.username);
        $("#tinyfeed-cfg-char-alias").val(cp.alias);
        $("#tinyfeed-cfg-char-primary").val(cp.primary);
    } else {
        $("#tinyfeed-cfg-char-name").text("(ไม่มีตัวละครในแชทนี้)");
        charFields.prop("disabled", true).val("");
    }
}

// ===== Identity: โปรไฟล์ผูกกับ persona / char =====
function getPersonaKey() {
    try {
        const ctx = getContext();
        const file = ctx.user_avatar || (stScriptModule && stScriptModule.user_avatar);
        if (file && file !== "none") return String(file);
        if (ctx.name1) return "name:" + ctx.name1;
    } catch (e) { /* fallback */ }
    return "default";
}
function getCharKey() {
    const char = getCurrentCharacter();
    return (char && char.file) ? String(char.file) : "";
}
// ชื่อดิบ (จาก ST) — ก่อน override ด้วย username/alias
function getRawUserName() {
    try { return getContext().name1 || "คุณ"; } catch (e) { return "คุณ"; }
}
function getRawCharName() {
    const char = getCurrentCharacter();
    return (char && char.name) || "ตัวละคร";
}

// เก็บโปรไฟล์ใน extension_settings (own object กัน mutate ค่า default)
function getProfileStore(kind) {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    const key = kind === "char" ? "charProfiles" : "userProfiles";
    if (!extension_settings[extensionName][key] || typeof extension_settings[extensionName][key] !== "object") {
        extension_settings[extensionName][key] = {};
    }
    return extension_settings[extensionName][key];
}
function normProfile(p) {
    p = p || {};
    return {
        avatarUrl: p.avatarUrl != null ? String(p.avatarUrl) : "",
        username: p.username ? String(p.username) : "",
        alias: p.alias ? String(p.alias) : "",
        primary: p.primary === "alias" ? "alias" : "username",
    };
}
function getUserProfile() { return normProfile(getProfileStore("user")[getPersonaKey()]); }
function getCharProfile() { return normProfile(getProfileStore("char")[getCharKey()]); }
function setProfileField(kind, field, value) {
    const key = kind === "char" ? getCharKey() : getPersonaKey();
    if (!key) return;
    const store = getProfileStore(kind);
    const cur = store[key] || {};
    cur[field] = value;
    store[key] = cur;
    saveSettingsDebounced();
}

// ย้ายรูป override เก่า (global userAvatarUrl / charAvatarUrls รายไฟล์) เข้าโปรไฟล์ใหม่ ครั้งเดียว
// แล้วล้างค่าเก่า เพื่อไม่ให้เป็น fallback ค้าง (เว้นช่องว่าง = ใช้รูปโปรไฟล์จริง)
function migrateLegacyAvatars() {
    let changed = false;
    // char: { <file>: url } → charProfiles[<file>].avatarUrl (ปลอดภัยทุกเวลา — คีย์เป็นไฟล์)
    const legacyChar = getSetting("charAvatarUrls");
    if (legacyChar && typeof legacyChar === "object" && Object.keys(legacyChar).length) {
        const store = getProfileStore("char");
        for (const file of Object.keys(legacyChar)) {
            const url = legacyChar[file];
            if (!url) continue;
            const cur = store[file] || {};
            if (!cur.avatarUrl) { cur.avatarUrl = url; store[file] = cur; }
        }
        setSetting("charAvatarUrls", {});
        changed = true;
    }
    // user: global → persona ปัจจุบัน (ทำเฉพาะเมื่อรู้ persona จริง กัน migrate ผิดคีย์)
    const legacyUser = getSetting("userAvatarUrl");
    if (legacyUser) {
        const key = getPersonaKey();
        if (key && key !== "default") {
            const store = getProfileStore("user");
            const cur = store[key] || {};
            if (!cur.avatarUrl) { cur.avatarUrl = legacyUser; store[key] = cur; }
            setSetting("userAvatarUrl", "");
            changed = true;
        }
    }
    if (changed) saveSettingsDebounced();
}

// ชื่อที่แอปใช้แสดง = username/alias ที่เลือกเป็นหลัก · ไม่ตั้ง = ชื่อดิบ
function getUserName() {
    const p = getUserProfile();
    const primary = (p.primary === "alias" ? p.alias : p.username).trim();
    return primary || getRawUserName();
}
function getCharName() {
    const p = getCharProfile();
    const primary = (p.primary === "alias" ? p.alias : p.username).trim();
    return primary || getRawCharName();
}

// เซ็ตชื่อทั้งหมดของผู้ใช้/ตัวละคร (username + alias + ชื่อดิบ) สำหรับจับคู่แทนที่ด้วยรูปโปรไฟล์
function userNameSet() {
    const p = getUserProfile();
    return [p.username, p.alias, getRawUserName()].map((x) => String(x || "").trim().toLowerCase()).filter(Boolean);
}
function charNameSet() {
    const p = getCharProfile();
    return [p.username, p.alias, getRawCharName()].map((x) => String(x || "").trim().toLowerCase()).filter(Boolean);
}
function nameMatchesUser(name) {
    const n = String(name || "").trim().toLowerCase();
    return !!n && userNameSet().includes(n);
}
function nameMatchesChar(name) {
    const n = String(name || "").trim().toLowerCase();
    return !!n && charNameSet().includes(n);
}

// URL avatar ของ persona ผู้ใช้ ถ้าไม่ได้คืน "" แล้วให้ fallback เป็น anon
function getUserAvatar() {
    const override = getUserProfile().avatarUrl;   // per-persona (เว้นว่าง = ใช้รูป persona จริง)
    if (override) return override;   // ลิงก์ภายนอกจาก config
    try {
        const ctx = getContext();
        // ชื่อไฟล์ persona: context ไม่มีให้ ดึงจากโมดูล core (live binding)
        const file = ctx.user_avatar || (stScriptModule && stScriptModule.user_avatar);
        if (file && file !== "none") {
            if (typeof ctx.getThumbnailUrl === "function") {
                return ctx.getThumbnailUrl("persona", file);   // /thumbnail?type=persona&file=...
            }
            return `/thumbnail?type=persona&file=${encodeURIComponent(file)}`;
        }
    } catch (e) {
        /* เงียบไว้ แล้ว fallback */
    }
    // fallback: ดึง src รูป persona จากข้อความผู้ใช้ในแชท (ถ้ามี)
    const domSrc = $('.mes[is_user="true"] .avatar img').last().attr("src");
    return domSrc || "";
}

// จัดการเมื่อรูป avatar โหลดไม่สำเร็จ (เรียกจาก onerror)
// ต้องเป็น global เพราะ inline onerror ทำงานใน global scope
window.tinyfeedAvatarError = function (img) {
    const author = img.getAttribute("data-author") || "?";
    const temp = document.createElement("div");
    temp.innerHTML = makeAnonAvatar(author);
    const anon = temp.firstElementChild;
    if (anon) img.replaceWith(anon);
};

// สร้าง avatar anonymous จากตัวอักษรแรก + สีตายตัวตามชื่อ
function makeAnonAvatar(name) {
    const safe = name || "?";
    const letter = safe.trim().charAt(0).toUpperCase();
    let hash = 0;
    for (let i = 0; i < safe.length; i++) {
        hash = safe.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    const bg = `hsl(${hue}, 55%, 45%)`;
    return `<div class="tinyfeed-avatar tinyfeed-avatar-anon" style="background:${bg}">${letter}</div>`;
}

function makeAvatar(item) {
    let src = item.avatar;
    // resolve รูปแบบ live เพื่อให้ override จาก config มีผลทันที
    if (!src && item.isMain) {
        src = getCharacterAvatar();
    } else if (!src && item.isUser) {
        src = getUserAvatar();
    } else if (!src) {
        // ชื่อที่ตรงกับ username/alias ของเรา/ตัวละครหลัก → แทนที่ด้วยรูปโปรไฟล์นั้น
        if (nameMatchesUser(item.author)) src = getUserAvatar();
        else if (nameMatchesChar(item.author)) src = getCharacterAvatar();
        else src = getNpcAvatar(item.author);   // NPC ที่อยู่ในรายชื่อประจำ + มีลิงก์รูป
    }
    if (src) {
        const safeAuthor = String(item.author || "?").replace(/"/g, "");
        return `<img class="tinyfeed-avatar" src="${src}" data-author="${safeAuthor}"
        onerror="window.tinyfeedAvatarError && window.tinyfeedAvatarError(this)" />`;
    }
    return makeAnonAvatar(item.author);
}

// คอมเมนต์: limit = จำนวนที่โชว์ (undefined = โชว์หมด) · postId = ใส่ปุ่มลบ (slice จาก 0 → index ตรงกับ array จริง)
function renderComments(comments, limit, postId) {
    if (!comments || comments.length === 0) return "";
    const list = limit ? comments.slice(0, limit) : comments;
    const rows = list.map((c, i) => `
        <div class="tinyfeed-comment">
            ${makeAvatar(c)}
            <div class="tinyfeed-comment-body">
                <span class="tinyfeed-comment-author">${c.author}</span>
                <span class="tinyfeed-comment-text">${renderRich(c.text)}</span>
            </div>
            ${postId ? `<span class="tinyfeed-comment-del" data-post="${postId}" data-cidx="${i}" title="ลบคอมเมนต์"><i class="fa-solid fa-trash"></i></span>` : ""}
        </div>
    `).join("");
    const more = (limit && comments.length > limit)
        ? `<div class="tinyfeed-more">ดูคอมเมนต์ทั้งหมด ${comments.length} รายการ</div>`
        : "";
    return `<div class="tinyfeed-comments">${rows}${more}</div>`;
}

// สรุปเนื้อหาของแต่ละแอปเป็นบล็อกข้อความ (ใช้ร่วมกันทั้ง inject เข้า RP และ context ข้ามแอป)
function buildAppBlocks(want) {
    const data = getFeedData();
    const count = Math.max(1, parseInt(want.count, 10) || 5);
    const blocks = [];
    if (want.feed) {
        const posts = (data.feed || []).slice(0, count).map((p) => {
            let line = `- ${p.author}: ${htmlToPlain(p.text)}`;
            // แนบคอมเมนต์ล่าสุด (สูงสุด count อัน/โพสต์) เมื่อเปิดโหมดรวมคอมเมนต์
            if (want.comments && Array.isArray(p.comments) && p.comments.length) {
                const cs = p.comments.slice(-count)
                    .map((c) => `    · ${c.author}: ${htmlToPlain(c.text)}`);
                line += `\n  คอมเมนต์:\n${cs.join("\n")}`;
            }
            return line;
        });
        if (posts.length) blocks.push(`โพสต์ล่าสุดบนฟีด TinyFeed:\n${posts.join("\n")}`);
    }
    if (want.news) {
        const news = (data.news || []).slice(0, count)
            .map((n) => `- [${htmlToPlain(n.source)}] ${htmlToPlain(n.title)}: ${htmlToPlain(n.summary)}`);
        if (news.length) blocks.push(`ข่าวล่าสุดในโลก:\n${news.join("\n")}`);
    }
    if (want.connect) {
        const threads = (data.connect && data.connect.threads) || {};
        const lines = [];
        for (const c of getConnectContacts()) {
            const t = threads[c.key];
            if (!Array.isArray(t) || !t.length) continue;
            const msgs = t.slice(-count)
                .map((m) => `  ${m.from === "user" ? getUserName() : c.name}: ${htmlToPlain(m.text)}`);
            lines.push(`แชตกับ ${c.name}:\n${msgs.join("\n")}`);
        }
        if (lines.length) blocks.push(`แชตส่วนตัวในแอป TinyConnect:\n${lines.join("\n")}`);
    }
    if (want.stream) {
        const s = data.stream;
        if (s) {
            const parts = [];
            if (s.live) parts.push(`กำลังไลฟ์อยู่: "${htmlToPlain(s.title)}" (ผู้ชม ${formatCount(s.viewers)})`);
            const cs = (s.comments || []).filter((c) => !c.isSystem).slice(-count)
                .map((c) => `  ${c.author}: ${htmlToPlain(c.text)}`);
            if (cs.length) parts.push(`คอมเมนต์สดล่าสุด:\n${cs.join("\n")}`);
            if (parts.length) blocks.push(`ไลฟ์สตรีมในแอป TinyStream:\n${parts.join("\n")}`);
        }
    }
    if (want.memo) {
        const parts = [];
        const agenda = (data.agenda || []).filter((a) => a.status === "pending").slice(0, count)
            .map((a) => `- ${a.when ? "(" + htmlToPlain(a.when) + ") " : ""}${htmlToPlain(a.title)}`);
        if (agenda.length) parts.push(`กำหนดการที่ยังไม่ถึง:\n${agenda.join("\n")}`);
        const notes = (data.notes || []).slice(-count).map((n) => `- ${htmlToPlain(n.text)}`);
        if (notes.length) parts.push(`เรื่องที่จำไว้:\n${notes.join("\n")}`);
        if (parts.length) blocks.push(`บันทึกในแอป TinyMemo:\n${parts.join("\n")}`);
    }
    if (want.forum) {
        const threads = (data.forum || []).slice(0, count).map((t) => {
            let line = `- [${htmlToPlain(t.room)}] ${htmlToPlain(t.title)} (${forumCommentCount(t)} คอมเมนต์): ${htmlToPlain(t.body)}`;
            if (want.forumComments) {
                // แนบคอมเมนต์ + รีพลายซ้อน (จำกัดด้วย count)
                const cs = (t.comments || []).slice(0, count).map((c) => {
                    let cl = `    · ${c.author}: ${htmlToPlain(c.text)}`;
                    const rs = (c.replies || []).slice(0, count).map((r) => `        ↳ ${r.author}: ${htmlToPlain(r.text)}`);
                    if (rs.length) cl += `\n${rs.join("\n")}`;
                    return cl;
                });
                if (cs.length) line += `\n${cs.join("\n")}`;
            } else {
                const top = (t.comments || []).slice(0, 2).map((c) => `    · ${c.author}: ${htmlToPlain(c.text)}`);
                if (top.length) line += `\n${top.join("\n")}`;
            }
            return line;
        });
        if (threads.length) blocks.push(`กระทู้ล่าสุดบนเว็บบอร์ด TinyForum:\n${threads.join("\n")}`);
    }
    if (want.bank) {
        const b = data.bank;
        if (b && (b.balance || (b.txns || []).length)) {
            const parts = [`ยอดคงเหลือ: ${formatMoney(b.balance || 0)}`];
            const tx = (b.txns || []).slice(0, count)
                .map((t) => `- ${t.dir === "in" ? "รับ" : "จ่าย"} ${formatMoney(t.amount)}${t.label ? ` — ${htmlToPlain(t.label)}` : ""}`);
            if (tx.length) parts.push(`ธุรกรรมล่าสุด:\n${tx.join("\n")}`);
            blocks.push(`การเงินในแอป TinyBank:\n${parts.join("\n")}`);
        }
    }
    if (want.shop) {
        const owned = data.shopOwned || {};
        const catalog = getShop();
        const items = Object.keys(owned)
            .map((id) => ({ it: catalog.find((x) => x.id === id), n: owned[id] }))
            .filter((x) => x.it && x.n > 0).slice(0, count)
            .map((x) => `- ${htmlToPlain(x.it.name)}${x.n > 1 ? ` ×${x.n}` : ""}${x.it.desc ? ` (${htmlToPlain(x.it.desc)})` : ""}`);
        if (items.length) blocks.push(`ของที่ซื้อไว้จากแอป TinyShop:\n${items.join("\n")}`);
    }
    if (want.theater) {
        // global — เรื่องที่เขียนไว้ในมินิเธียเตอร์ (ตัวละครอ้างถึงได้ว่า "เคยดู/เคยเขียนเรื่องนี้")
        const shows = (getTheater().shows || []).slice(0, count).map((sh) => {
            const eps = (sh.episodes || []).length;
            return `- "${htmlToPlain(sh.title)}"${sh.genre ? ` (${htmlToPlain(sh.genre)})` : ""} — ${eps} ตอน`
                + (sh.whatIf ? `\n  โจทย์: ${htmlToPlain(sh.whatIf)}` : "")
                + (sh.castNames && sh.castNames.length ? `\n  นักแสดง: ${sh.castNames.map(htmlToPlain).join(", ")}` : "");
        });
        if (shows.length) blocks.push(`เรื่องในแอปมินิเธียเตอร์ TinyTheater:\n${shows.join("\n")}`);
    }
    if (want.novel) {
        // global — นิยายที่อ่านอยู่ (แนบเรื่องย่อ + ความคืบหน้า ไม่แนบเนื้อเต็มเพราะยาวมาก)
        const books = (getNovel().books || []).slice(0, count).map((b) => {
            const read = Math.min(b.lastReadEp || 0, (b.episodes || []).length);
            const done = (b.episodes || []).length >= (b.totalEps || 0);
            return `- "${htmlToPlain(b.title)}"${b.genre ? ` (${htmlToPlain(b.genre)})` : ""} — ${done ? "อ่านจบแล้ว" : `อ่านถึงตอน ${read}/${b.totalEps}`}`
                + (b.synopsis ? `\n  เรื่องย่อ: ${htmlToPlain(b.synopsis)}` : "");
        });
        if (books.length) blocks.push(`นิยายในแอป TinyNovel:\n${books.join("\n")}`);
    }
    if (want.pet) {
        // เพ็ทเป็น global (ตัวเดียวข้ามแชท) — สถานะสดตอนนี้ ให้ตัวละครอ้างถึงได้
        const p = getPet();
        if (p.exists) {
            if (p.isDead) {
                blocks.push(`สัตว์เลี้ยงในแอป TinyPet:\n- ${p.name} เสียชีวิตแล้ว`);
            } else {
                petApplyDecay();
                const s = p.stats || {};
                const lv = petBondLevel(p.bond);   // ต้องส่ง bond เข้าไป — ฟังก์ชันนี้รับค่าเป็นอาร์กิวเมนต์
                blocks.push(`สัตว์เลี้ยงในแอป TinyPet:\n`
                    + `- ชื่อ ${p.name} (${PET_STAGE_LABEL[p.stage] || p.stage}) · ตอนนี้ ${PET_STATE_LABEL[petState()] || petState()}\n`
                    + `- อิ่ม ${Math.round(100 - (s.hunger || 0))}% · พลังงาน ${Math.round(s.energy || 0)}% · ความสะอาด ${Math.round(s.cleanliness || 0)}% · อารมณ์ ${Math.round(s.mood || 0)}% · สุขภาพ ${Math.round(s.health || 0)}%\n`
                    + `- ความผูกพันกับเรา: เลเวล ${lv}`);
            }
        }
    }
    return blocks;
}

// context จาก "แอปอื่น" สำหรับแนบเข้า prompt ตอน generate (เชื่อมเนื้อหาข้ามแอป)
function crossAppContext(exclude) {
    if (!getSetting("crossAppEnabled")) return "";
    const count = Math.max(1, parseInt(getSetting("crossAppCount"), 10) || 3);
    const want = { comments: Boolean(getSetting("crossAppComments")), count };
    for (const src of INJECT_SOURCES) want[src.id] = Boolean(getSetting(src.cross));
    // ตัดแอปที่กำลัง generate ออก (คอมเมนต์ผูกกับฟีด → ตัดไปพร้อมกัน)
    if (exclude && Object.prototype.hasOwnProperty.call(want, exclude)) want[exclude] = false;
    if (exclude === "feed") want.comments = false;
    const blocks = buildAppBlocks(want);
    if (!blocks.length) return "";
    return `\n[เนื้อหาจากแอปอื่นในโทรศัพท์ อ้างอิงถึงได้ถ้าเข้ากับสถานการณ์]\n${blocks.join("\n\n")}\n`;
}

// บล็อกบอก "คลังสติกเกอร์/รูป" ให้บอทเลือกส่งได้ (แนบท้าย prompt ของแอปที่คุย/โพสต์)
// max = จำกัดจำนวนรายชื่อที่ลิสต์ (กัน prompt ยาว)
function galleryPromptBlock() {
    if (!getSetting("galleryPrompt")) return "";
    const g = getGallery();
    // ขอบเขตอัลบั้มที่ให้ AI เข้าถึง
    const selected = getSetting("galleryPromptScope") === "selected"
        ? new Set((getSetting("galleryAlbums") || []).map((a) => String(a)))
        : null;
    const inScope = (it) => !selected || selected.has(String(it.album || "ทั่วไป"));
    const capImg = Math.max(1, parseInt(getSetting("galleryMaxImages"), 10) || 24);
    const capStk = Math.max(1, parseInt(getSetting("galleryMaxStickers"), 10) || 24);
    const stk = g.stickers.filter(inScope).slice(0, capStk).map((s) => s.name).filter(Boolean);
    const img = g.images.filter(inScope).slice(0, capImg).map((s) => s.caption ? `${s.name} (${htmlToPlain(s.caption)})` : s.name).filter(Boolean);
    if (!stk.length && !img.length) return "";
    let out = "\n[คลังสื่อในโทรศัพท์ — ส่งได้ถ้าเข้ากับสถานการณ์ อย่าฝืนใส่ทุกครั้ง]\n";
    if (stk.length) out += `ส่งสติกเกอร์: พิมพ์ [sticker:ชื่อ] โดยเลือกจาก: ${stk.join(", ")}.\n`;
    if (img.length) out += `แนบรูป: พิมพ์ [img:ชื่อ] โดยเลือกจาก: ${img.join(", ")}.\n`;
    return out;
}

// Phase 2: แทรกฟีด/ข่าว/แชต/ไลฟ์ เข้าประวัติแชทหลัก ให้โมเดล RP รับรู้ (เรียลไทม์)
function updateChatInjection() {
    const ctx = getContext();
    if (typeof ctx.setExtensionPrompt !== "function") return;
    const depth = Math.max(0, parseInt(getSetting("injectDepth"), 10) || 4);
    const text = injectText();   // "" เมื่อปิดทุกแหล่ง
    if (!text) {
        ctx.setExtensionPrompt("tinyfeed_inject", "", 1, 0);   // เคลียร์
        return;
    }
    // position 1 = IN_CHAT, role 0 = SYSTEM
    ctx.setExtensionPrompt("tinyfeed_inject", text, 1, depth, false, 0);
}

// Stage 11: empty state + skeleton

/* empty state แบบกะทัดรัด — ใช้ในกล่องเล็ก (กริดคลังรูป, ตัวเลือกใน modal, ลิ้นชักแจ้งเตือน)
 * ที่ .tinyfeed-empty (ไอคอน 2.4em + padding 52px) ใหญ่เกินไป
 * รับ HTML ได้ (มี <br>/<small>) — ผู้เรียกต้อง escape เนื้อหาที่มาจากผู้ใช้เอง */


function renderFeed() {
    const data = getFeedData();
    if (!data.feed.length) {
        $("#tinyfeed-feed-list").html(emptyStateHtml("fa-feather-pointed", "ยังไม่มีโพสต์", "เขียนโพสต์แรก หรือกด “ให้ตัวละครโพสต์” ได้เลย"));
        renderComposeAvatar();
        updateChatInjection();
        return;
    }
    const html = data.feed.map((post) => `
        <div class="tinyfeed-post" data-post="${post.id}">
            <div class="tinyfeed-post-head">
                ${makeAvatar(post)}
                <div class="tinyfeed-post-meta">
                    <span class="tinyfeed-post-author">${post.author}</span>
                    <span class="tinyfeed-post-time">${displayTime(post)}</span>
                </div>
                ${(post.isUser || post.isAI) ? `<span class="tinyfeed-delete" data-post="${post.id}" title="ลบโพสต์"><i class="fa-solid fa-trash"></i></span>` : ""}
            </div>
            <div class="tinyfeed-post-body">${renderPostBody(post.text)}</div>
            <div class="tinyfeed-post-actions">
                <span class="tinyfeed-like ${post.liked ? "tinyfeed-liked" : ""}" data-post="${post.id}">
                    <i class="fa-solid fa-heart"></i> ${formatCount(post.likes)}
                </span>
                <span class="tinyfeed-comment-btn" data-post="${post.id}">
                    <i class="fa-solid fa-comment"></i> ${formatCount(post.comments.length)}
                </span>
                <span class="tinyfeed-share ${post.shared ? "tinyfeed-shared" : ""}" data-post="${post.id}">
                    <i class="fa-solid fa-share"></i>
                </span>
            </div>
            ${renderComments(post.comments, 2, post.id)}
            ${post.comments.length === 0 ? `
            <div class="tinyfeed-post-comment-tools">
                <button class="tinyfeed-btn-generate tinyfeed-gen-comments" data-post="${post.id}">
                    <i class="fa-solid fa-comment-medical"></i>
                    <span>ให้ NPC คอมเมนต์</span>
                </button>
            </div>` : ""}
        </div>
    `).join("");
    $("#tinyfeed-feed-list").html(html);
    renderComposeAvatar();
    updateChatInjection();
}

// ===== คนโพสต์ใน TinyFeed: เรา(persona) / ตัวละคร / NPC / อัตโนมัติ =====
let feedPoster = POSTER_USER;   // ค่าเริ่มต้น = โพสต์เป็นตัวเราเอง

// avatar ของคนโพสต์ที่เลือกอยู่ (เรียกในช่องเขียนโพสต์)
function posterAvatarNode() {
    if (feedPoster === POSTER_AUTO) return `<div class="tinyfeed-avatar tinyfeed-avatar-auto" title="อัตโนมัติ"><i class="fa-solid fa-wand-magic-sparkles"></i></div>`;
    if (feedPoster === POSTER_USER) return makeAvatar({ isUser: true, author: getUserName() });
    return makeAvatar(streamSpeakerAvatarItem(feedPoster));
}

// ปรับสภาพช่องเขียนโพสต์ตามคนโพสต์: เราเอง = พิมพ์เอง · ตัวละครอื่น/อัตโนมัติ = โหมด AI
function applyFeedComposeMode() {
    const aiMode = feedPoster !== POSTER_USER;
    $("#tinyfeed-compose-avatar").html(posterAvatarNode());
    $("#tinyfeed-compose-input")
        .prop("disabled", aiMode)
        .toggleClass("tinyfeed-input-disabled", aiMode)
        .attr("placeholder", aiMode ? "ให้ตัวละครนี้โพสต์ให้ (กดปุ่มโพสต์)" : "คุณกำลังคิดอะไรอยู่?");
    $("#tinyfeed-feed-guidance").toggleClass("tinyfeed-hidden", !aiMode);
    $("#tinyfeed-compose-img, #tinyfeed-compose-sticker").prop("disabled", aiMode);
    $(".tinyfeed-post-wand").toggleClass("tinyfeed-hidden", !aiMode);
    // ปุ่มโพสต์: โหมด AI กดได้เสมอ · โหมดเรา กดได้เมื่อมีข้อความ
    const emptyUser = String($("#tinyfeed-compose-input").val() || "").trim().length === 0;
    $("#tinyfeed-compose-post").prop("disabled", aiMode ? false : emptyUser);
}

// อัปเดตรูป avatar ในช่องเขียนโพสต์ (ตามคนโพสต์ที่เลือก)
function renderComposeAvatar() {
    applyFeedComposeMode();
}

// สถานะกำลังเจนของปุ่มโพสต์ (คทาหมุน)
function setPostGenerating(on) {
    $(".tinyfeed-post-wand").toggleClass("tinyfeed-spin", on);
    $("#tinyfeed-compose-post").prop("disabled", on);
    $(".tinyfeed-post-label").text(on ? "กำลังสร้าง..." : "โพสต์");
}

// ยกเลิกการเจนโพสต์ (soft-abort: ทิ้งผลลัพธ์ที่ค้าง)
let feedGenId = 0;
function cancelFeedGen() {
    feedGenId++;               // ทำให้ผลลัพธ์ที่ค้างถูกทิ้ง
    isGenerating = false;
    setPostGenerating(false);
    $("#tinyfeed-feed-skel").remove();
    toastr.info("ยกเลิกการสร้างโพสต์แล้ว", "TinyFeed");
}

function renderNews() {
    const data = getFeedData();
    if (!data.news.length) {
        $("#tinyfeed-news-list").html(emptyStateHtml("fa-newspaper", "ยังไม่มีข่าว", "กด “สร้างข่าวใหม่” เพื่อให้ AI แต่งข่าวเสริมโลกของเรื่อง"));
        updateChatInjection();
        return;
    }
    const html = data.news.map((news) => `
        <div class="tinyfeed-news" data-news="${news.id}">
            <div class="tinyfeed-news-head">
                <span class="tinyfeed-news-source">${news.source}</span>
                <span class="tinyfeed-news-head-right">
                    <span class="tinyfeed-news-time">${displayTime(news)}</span>
                    ${news.isAI ? `<span class="tinyfeed-news-delete" data-news="${news.id}" title="ลบข่าว"><i class="fa-solid fa-trash"></i></span>` : ""}
                </span>
            </div>
            <div class="tinyfeed-news-title">${news.title}</div>
            <div class="tinyfeed-news-summary">${renderRich(news.summary)}</div>
        </div>
    `).join("");
    $("#tinyfeed-news-list").html(html);
    updateChatInjection();
}

let activeTab = "feed";

function switchTab(tab) {
    activeTab = tab;
    // ต้องจำกัดด้วย [data-tab] — ตอนนี้ทุกแอปใช้ .tinyfeed-tab ร่วมกัน ถ้าไม่จำกัดจะไปล้าง active ของแอปอื่น
    $(".tinyfeed-tab[data-tab]").removeClass("tinyfeed-tab-active");
    $(`.tinyfeed-tab[data-tab="${tab}"]`).addClass("tinyfeed-tab-active");
    $(".tinyfeed-panel").addClass("tinyfeed-hidden");
    $(`#tinyfeed-panel-${tab}`).removeClass("tinyfeed-hidden");
}

// เปิดหน้ารายละเอียดโพสต์
function openPostDetail(postId) {
    const post = getFeedData().feed.find((p) => p.id === postId);
    if (!post) return;
    const html = `
        <div class="tinyfeed-post tinyfeed-post-detail">
            <div class="tinyfeed-post-head">
                ${makeAvatar(post)}
                <div class="tinyfeed-post-meta">
                    <span class="tinyfeed-post-author">${post.author}</span>
                    <span class="tinyfeed-post-time">${displayTime(post)}</span>
                </div>
            </div>
            <div class="tinyfeed-post-body">${renderPostBody(post.text)}</div>
            <div class="tinyfeed-post-actions">
                <span><span class="fa-regular fa-heart"></span> ${Number(post.likes || 0).toLocaleString()}</span>
                <span><span class="fa-regular fa-comment"></span> ${post.comments.length.toLocaleString()}</span>
                <span><span class="fa-solid fa-share"></span></span>
            </div>
        </div>
        ${renderComments(post.comments, null, post.id)}
        ${isReplying === post.id ? `
            <div class="tinyfeed-comment tinyfeed-comment-typing">
                <div class="tinyfeed-avatar tinyfeed-avatar-anon">…</div>
                <div class="tinyfeed-comment-body"><span class="tinyfeed-comment-text">กำลังพิมพ์…</span></div>
            </div>` : ""}
        <div class="tinyfeed-post-comment-tools">
            <input id="tinyfeed-comment-guidance" class="tinyfeed-gen-guidance" type="text" placeholder="แนวทางคอมเมนต์ AI (ไม่บังคับ)" />
            ${post.comments.length === 0
            ? `<button class="tinyfeed-btn-generate tinyfeed-gen-comments" data-post="${post.id}"><i class="fa-solid fa-comment-medical"></i> <span>ให้ NPC คอมเมนต์</span></button>`
            : (getSetting("commentReplyMode") === "manual"
                ? `<button class="tinyfeed-ai-reply tinyfeed-btn-generate" data-post="${post.id}"><i class="fa-solid fa-wand-magic-sparkles"></i> <span>ให้ AI ตอบ</span></button>`
                : "")}
        </div>
        ${commentComposeHtml({
            postId: post.id, dataKey: "post",
            inputCls: "tinyfeed-comment-input", stickerCls: "tinyfeed-comment-sticker", sendCls: "tinyfeed-comment-send",
        })}
    `;
    showDetail(html);
}

function toggleLike(postId) {
    const post = getFeedData().feed.find((p) => p.id === postId);
    if (!post) return;
    post.liked = !post.liked;
    post.likes += post.liked ? 1 : -1;
    saveFeedData();
    // อัปเดตเฉพาะปุ่ม (ไม่ re-render ทั้งฟีด กัน flicker) + หัวใจเด้ง
    const el = $(`.tinyfeed-like[data-post="${postId}"]`);
    el.toggleClass("tinyfeed-liked", post.liked)
      .html(`<i class="fa-solid fa-heart"></i> ${formatCount(post.likes)}`);
    if (post.liked) {
        el.addClass("tinyfeed-pop");
        setTimeout(() => el.removeClass("tinyfeed-pop"), 320);
    }
    console.log(`[${extensionName}] like:`, postId, post.liked);
}

function toggleShare(postId) {
    const post = getFeedData().feed.find((p) => p.id === postId);
    if (!post) return;
    post.shared = !post.shared;
    saveFeedData();
    $(`.tinyfeed-share[data-post="${postId}"]`).toggleClass("tinyfeed-shared", post.shared);
    console.log(`[${extensionName}] share:`, postId, post.shared);
}

// ผู้ใช้โพสต์เอง — แทรกบนสุดของฟีด เก็บผูกกับแชท
async function addUserPost(text) {
    const clean = String(text || "").trim();
    if (!clean) return;
    const post = {
        id: "u" + Date.now(),
        author: getUserName(),
        isUser: true,
        avatar: "",              // ปล่อยว่างให้ makeAvatar resolve live (รับ override จาก config)
        ts: Date.now(),
        text: escapeHtml(clean),
        likes: randomInitialLikes(),   // สุ่มไลค์เริ่มต้นเหมือนโพสต์ AI
        comments: [],
    };
    getFeedData().feed.unshift(post);
    saveFeedData();
    renderFeed();
    console.log(`[${extensionName}] user post added:`, post.id);
    await generateInitialComments(post);   // ให้ NPC คอมเมนต์โพสต์ของผู้ใช้ (ตาม config)
}

// ลบโพสต์ที่ลบได้ (โพสต์ผู้ใช้เอง หรือโพสต์ที่ AI สร้าง)
function deleteUserPost(postId) {
    const data = getFeedData();
    const post = data.feed.find((p) => p.id === postId);
    if (!post || !(post.isUser || post.isAI)) return;
    if (!confirm("ต้องการลบโพสต์นี้ใช่ไหม?")) return;
    data.feed = data.feed.filter((p) => p.id !== postId);
    saveFeedData();
    renderFeed();
    console.log(`[${extensionName}] post deleted:`, postId);
}

// ลบคอมเมนต์ 1 อันใต้โพสต์ (อ้างตาม index ใน post.comments)
function deleteComment(postId, cidx) {
    const post = getFeedData().feed.find((p) => p.id === postId);
    if (!post || !Array.isArray(post.comments)) return;
    if (isNaN(cidx) || cidx < 0 || cidx >= post.comments.length) return;
    if (!confirm("ต้องการลบคอมเมนต์นี้ใช่ไหม?")) return;
    post.comments.splice(cidx, 1);
    saveFeedData();
    renderFeed();
    // ถ้าหน้ารายละเอียดโพสต์เปิดอยู่ ให้รีเฟรชด้วย
    if (!$("#tinyfeed-detail").hasClass("tinyfeed-hidden")) openPostDetail(postId);
}

// ===== Stage 6: ให้ AI สร้างโพสต์ฟีด =====

// ตัดส่วน reasoning/thinking ออกจากผลลัพธ์ AI (กันโมเดลที่คิดก่อนตอบ)

// ===== Prompt แก้ไขได้ (template registry) =====
// default = template ที่ใช้ {{token}} แทนส่วน dynamic · marker = ข้อความที่ parser ต้องใช้ (ห้ามลบ)
const PROMPT_DEFS = {
    feedPost: {
        label: "โพสต์ฟีด (TinyFeed)", marker: "POST:", tokens: ["roster", "extra", "history", "context"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] เขียนโพสต์โซเชียลมีเดียสั้นๆ 1 โพสต์ (1-3 ประโยค) ที่จะปรากฏบนฟีด สะท้อนอารมณ์หรือสถานการณ์ในเนื้อเรื่องตอนนี้. {{roster}}ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดแทนหรือกระทำแทนผู้ใช้. {{extra}}{{history}}{{context}}\n` +
            `ตอบกลับตามรูปแบบนี้เท่านั้น ห้ามมีข้อความอื่น:\nNAME: <ชื่อผู้โพสต์>\nPOST: <ข้อความโพสต์>`,
    },
    feedInitialComments: {
        label: "คอมเมนต์ติดโพสต์ใหม่ (TinyFeed)", marker: "COMMENT:", tokens: ["postText", "author", "roster", "count"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] มีโพสต์บนฟีดว่า: "{{postText}}" (โดย {{author}}). เขียนคอมเมนต์ใต้โพสต์นี้ให้สมจริง. {{roster}}{{count}}ห้ามให้ {{author}} คอมเมนต์โพสต์ตัวเอง ห้ามพูดแทนผู้ใช้. ` +
            `ตอบแต่ละคอมเมนต์บรรทัดละอันในรูปแบบ:\nCOMMENT: <ชื่อ> | <ข้อความ>`,
    },
    feedCommentReply: {
        label: "AI ตอบคอมเมนต์ (TinyFeed)", marker: "COMMENT:", tokens: ["postText", "author", "thread", "roster"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง ไม่ต้องสวมบทบาทตอบยาว] มีโพสต์บนฟีดว่า: "{{postText}}" (โดย {{author}}). คอมเมนต์ในโพสต์ล่าสุด:\n{{thread}}\n` +
            `เขียนคอมเมนต์ตอบกลับสั้นๆ 1 อัน จะเป็น {{author}} หรือ NPC ที่เกี่ยวข้องก็ได้ (เลือกเอง). {{roster}}ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดแทนผู้ใช้. ` +
            `ตอบรูปแบบนี้เท่านั้น:\nCOMMENT: <ชื่อ> | <ข้อความ>`,
    },
    news: {
        label: "ข่าว (TinyFeed)", marker: "TITLE:", tokens: ["extra", "history", "context"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] เขียนข่าว/บทความสั้น 1 ชิ้นที่จะปรากฏบนหน้าข่าวสาร สะท้อนสถานการณ์บ้านเมืองหรือเหตุการณ์รอบข้างในโลกของเนื้อเรื่อง เสริมบรรยากาศ worldbuilding ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดแทนผู้ใช้.{{extra}}{{history}}{{context}}\n` +
            `ตอบตามรูปแบบนี้เท่านั้น:\nSOURCE: <ชื่อสำนักข่าว>\nTITLE: <หัวข้อข่าว>\nSUMMARY: <สรุปสั้น 1-2 ประโยค>\nBODY: <เนื้อหาเต็ม หลายย่อหน้าได้>`,
    },
    forumThread: {
        label: "ตั้งกระทู้ (TinyForum)", marker: "TITLE:", tokens: ["rooms", "roster", "extra", "context"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] แต่งกระทู้เว็บบอร์ด 1 กระทู้ที่คนในโลกของเรื่องน่าจะตั้ง สะท้อนสถานการณ์/ดราม่า/ประเด็นตอนนี้. เลือกห้องจากรายการนี้เท่านั้น: {{rooms}}. {{roster}}ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดหรือกระทำแทนผู้ใช้. {{extra}}{{context}}\n` +
            `ตอบตามรูปแบบนี้:\nROOM: <ห้องจากรายการ>\nAUTHOR: <ชื่อคนตั้งกระทู้>\nTITLE: <หัวข้อ>\nBODY: <เนื้อหากระทู้>\n` +
            `แล้วต่อด้วยคอมเมนต์ชาวเน็ต 3-5 อัน บรรทัดละอัน:\nCOMMENT: <ชื่อ> | <ข้อความ>`,
    },
    forumComments: {
        label: "คอมเมนต์กระทู้ (TinyForum)", marker: "COMMENT:", tokens: ["room", "title", "body", "batch", "roster", "extra", "existing", "context"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] กระทู้ห้อง "{{room}}" หัวข้อ "{{title}}": {{body}}\n` +
            `เขียนคอมเมนต์ชาวเน็ตประมาณ {{batch}} อัน ให้หลากหลายคน สมจริงเหมือนเว็บบอร์ด (เห็นด้วย/เถียง/แซว/เล่าประสบการณ์/ถาม). {{roster}}ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดหรือกระทำแทนผู้ใช้.{{extra}}{{context}}{{existing}}\n` +
            `ตอบบรรทัดละอันในรูปแบบนี้เท่านั้น:\nCOMMENT: <ชื่อ> | <ข้อความ>   (คอมเมนต์ใหม่)\nREPLY: <เลข> | <ชื่อ> | <ข้อความ>   (ตอบกลับคอมเมนต์เลขนั้น)`,
    },
    streamComments: {
        label: "คอมเมนต์ผู้ชม (TinyStream)", marker: "COMMENT:", tokens: ["streamer", "title", "direction", "roster", "extra", "context", "recent"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] นี่คือไลฟ์สดของ {{streamer}} หัวข้อ "{{title}}".{{direction}} ` +
            `เขียนคอมเมนต์สดจากผู้ชม 3-5 คน (ชื่อผู้ชมสุ่มหลากหลาย{{roster}}) รีแอคกับไลฟ์แบบสมจริง สั้นๆ เหมือนแชตสด ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดแทนผู้ใช้.{{extra}}{{context}}{{recent}}\n` +
            `ตอบแต่ละคอมเมนต์บรรทัดละอันในรูปแบบ:\nCOMMENT: <ชื่อผู้ชม> | <ข้อความ>`,
    },
    streamerSpeak: {
        label: "สตรีมเมอร์พูด/ตอบ (TinyStream)", marker: "", tokens: ["streamer", "title", "direction", "task", "extra", "context", "transcript"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] {{streamer}} กำลังไลฟ์สดอยู่ หัวข้อ "{{title}}".{{direction}} ` +
            `พูดในมุมมองบุคคลที่หนึ่งแบบสตรีมเมอร์กำลังพูดสดหน้ากล้อง (อ่านแชต/คุยกับผู้ชม) สั้นเป็นธรรมชาติ 1-2 ประโยค ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดหรือกระทำแทนผู้ใช้.{{task}}{{extra}}{{context}}{{transcript}}\n` +
            `ตอบเฉพาะคำพูดของ {{streamer}} เท่านั้น ไม่ต้องใส่ชื่อนำหน้า ไม่ต้องมีเครื่องหมายคำพูด`,
    },
    petReaction: {
        label: "บทพูดเพ็ท (TinyPet)", marker: "REACTION:", tokens: ["petName", "stage", "stats", "lastAction", "extra", "context"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] {{petName}} เป็นสัตว์เลี้ยงเสมือน (ระยะ {{stage}}) ในโทรศัพท์ ค่าสถานะตอนนี้: {{stats}}. ผู้เล่นเพิ่ง{{lastAction}}. ` +
            `แต่งบทพูด/เสียงร้อง/ปฏิกิริยาสั้นๆ 1 บรรทัดของเพ็ทให้เข้ากับสถานะและการกระทำ น่ารักเป็นธรรมชาติ (จะพูดเองหรือบรรยายท่าทางสั้นๆ ก็ได้ ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดแทนผู้ใช้). {{extra}}{{context}}\n` +
            `ตอบรูปแบบนี้เท่านั้น:\nREACTION: <บทพูด/ปฏิกิริยาสั้นๆ>`,
    },
    petPost: {
        label: "โพสต์ฟีดของเพ็ท (TinyPet)", marker: "POST:", tokens: ["petName", "mood", "extra", "context"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] {{petName}} เป็นสัตว์เลี้ยงเสมือน กำลังจะโพสต์ลงฟีดโซเชียลในมุมมองของตัวเอง (โทนน่ารักแบบสัตว์เลี้ยง) สะท้อนอารมณ์ตอนนี้: {{mood}}. ` +
            `เขียนโพสต์สั้นๆ 1 โพสต์ (1-2 ประโยค) ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดหรือกระทำแทนผู้ใช้. {{extra}}{{context}}\n` +
            `ตอบรูปแบบนี้เท่านั้น:\nPOST: <ข้อความโพสต์>`,
    },
    versePost: {
        label: "โพสต์ฟีดโกลบอล (TinyVerse)", marker: "POST:", tokens: ["charName", "persona", "guidance", "context"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] {{charName}} กำลังจะโพสต์ลงฟีดโซเชียลส่วนตัวในมุมมองของตัวเอง. ข้อมูลตัวละคร (ใช้กำหนดนิสัย/น้ำเสียง): {{persona}}. ` +
            `{{context}}` +
            `เขียนโพสต์สั้นๆ 1 โพสต์ (1-3 ประโยค) ในน้ำเสียงและมุมมองของ {{charName}} ให้สมคาแรกเตอร์ เป็นธรรมชาติเหมือนโพสต์โซเชียลจริง. {{guidance}}ใช้ภาษาเดียวกับข้อมูลตัวละคร ห้ามพูดหรือกระทำแทนผู้ใช้.\n` +
            `ตอบรูปแบบนี้เท่านั้น:\nPOST: <ข้อความโพสต์>`,
    },
    verseComments: {
        label: "คอมเมนต์ข้ามการ์ด (TinyVerse)", marker: "COMMENT:", tokens: ["author", "post", "roster"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] ในโซเชียลรวมที่ตัวละครจากหลายโลกมาเจอกัน {{author}} เพิ่งโพสต์ว่า: "{{post}}". ` +
            `ตัวละครอื่นที่เห็นโพสต์นี้ (ใช้ข้อมูลกำหนดนิสัย/น้ำเสียงของแต่ละคน):\n{{roster}}\n` +
            `แต่งคอมเมนต์ 2-4 อันจากตัวละครในรายชื่อข้างบน (คนละคนกัน ห้ามใช้ {{author}}) ให้สมคาแรกเตอร์แต่ละคน สั้นๆ 1-2 ประโยค เป็นธรรมชาติเหมือนคอมเมนต์โซเชียลจริง ตัวละครต่างโลกกันทักกันได้อย่างสนุก. ห้ามพูดหรือกระทำแทนผู้ใช้.\n` +
            `ตอบบรรทัดละ 1 คอมเมนต์ในรูปแบบนี้เท่านั้น:\nCOMMENT: <ชื่อตัวละคร> | <ข้อความ>`,
    },
    theaterWhatIf: {
        label: "คิดโจทย์ What if (TinyTheater)", marker: "WHATIF:", tokens: ["chars", "roster", "genre"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] ช่วยคิดโจทย์ "What if" สำหรับมินิเธียเตอร์ (เรื่องสั้นแนวสมมติ) ที่มีนักแสดง: {{chars}}. ข้อมูลตัวละคร:\n{{roster}}\n` +
            `แนวเรื่องที่อยากได้: {{genre}}\n` +
            `เสนอโจทย์ 3 แบบที่ต่างกันชัดเจน แต่ละอันสั้นๆ 1 ประโยค ขึ้นต้นด้วย "ถ้า..." ให้เข้ากับนิสัย/ภูมิหลังของตัวละครเหล่านี้โดยเฉพาะ (ไม่ใช่โจทย์กลางๆ ที่ใครก็ใช้ได้) น่าสนใจและชวนให้อยากอ่านต่อ. ใช้ภาษาเดียวกับข้อมูลตัวละคร.\n` +
            `ตอบบรรทัดละ 1 โจทย์ในรูปแบบนี้เท่านั้น:\nWHATIF: <โจทย์>`,
    },
    theaterEpisode: {
        label: "ตอนแรก (TinyTheater)", marker: "NARRATION:", tokens: ["chars", "roster", "whatIf", "genre", "length", "userRule"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] เขียน "มินิเธียเตอร์" (小劇場) — เรื่องสั้นแนว What if ที่ตัวละครจากต่างโลกมาเจอกัน. นักแสดง: {{chars}}. ข้อมูลตัวละครแต่ละคน (ใช้กำหนดนิสัย/น้ำเสียง):\n{{roster}}\n` +
            `โจทย์ What if: {{whatIf}}\nแนวเรื่อง: {{genre}}\nความยาว: {{length}}\n` +
            `ตั้งชื่อเรื่องให้น่าสนใจ + ชื่อตอนแรก แล้วเขียนเนื้อเรื่องสลับระหว่างคำบรรยายกับบทพูด ให้ตัวละครทุกคนมีบทบาท สมคาแรกเตอร์ มีจังหวะเปิดเรื่องที่ชวนติดตาม. ใช้ภาษาเดียวกับข้อมูลตัวละคร. {{userRule}}\n` +
            `ตอบตามรูปแบบนี้เท่านั้น (บรรทัดละ 1 รายการ):\nTITLE: <ชื่อเรื่อง>\nEPTITLE: <ชื่อตอน>\nNARRATION: <คำบรรยาย>\nLINE: <ชื่อตัวละคร> | <บทพูด>`,
    },
    novelPlot: {
        label: "คิดพล็อตให้ (TinyNovel)", marker: "PLOT:", tokens: ["genre"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] เสนอพล็อตนิยายที่คนชอบอ่าน 3 เรื่อง แนว: {{genre}}. ` +
            `แต่ละพล็อตเขียนเป็นประโยคเดียวที่เห็นภาพและชวนติดตาม อย่าซ้ำแนวกัน อย่าใส่ชื่อตัวละคร.\n` +
            `ตอบบรรทัดละ 1 พล็อตในรูปแบบนี้เท่านั้น:\nPLOT: <พล็อต>`,
    },
    novelOutline: {
        label: "สร้างเรื่อง + ตอนแรก (TinyNovel)", marker: "TITLE:", tokens: ["plot", "genre", "hero", "totalEps", "length", "extra"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] คุณคือนักเขียนนิยาย เขียนนิยายเรื่องใหม่ตามโจทย์นี้\n` +
            `พล็อต: {{plot}}\nแนวเรื่อง: {{genre}}\nตัวเอก: {{hero}}\n` +
            `เรื่องนี้จะจบใน {{totalEps}} ตอน — ตอนนี้คือตอนที่ 1 วางจังหวะให้เหมาะกับความยาวทั้งเรื่อง\n` +
            `ความยาวตอน: {{length}}\n{{extra}}\n` +
            `ตั้งชื่อเรื่อง เขียนเรื่องย่อสั้นๆ ระบุตัวละครหลัก แล้วเขียนเนื้อเรื่องตอนที่ 1 เป็นร้อยแก้ว (มีบทสนทนาได้) แบ่งย่อหน้าด้วยบรรทัดว่าง\n` +
            `ตอบตามรูปแบบนี้ (ส่วนหัวบรรทัดละรายการ แล้วเว้นบรรทัดก่อนเริ่มเนื้อเรื่อง):\n` +
            `TITLE: <ชื่อเรื่อง>\nSYNOPSIS: <เรื่องย่อ 1-2 ประโยค>\nCHAR: <ชื่อ> | <บทบาท> | <นิสัย/ปูมหลังสั้นๆ>\n(CHAR ใส่ได้หลายบรรทัด)\nEPTITLE: <ชื่อตอนที่ 1>\n\n<เนื้อเรื่อง>`,
    },
    novelEpisode: {
        label: "ตอนต่อไป (TinyNovel)", marker: "EPTITLE:", tokens: ["title", "plot", "genre", "roster", "story", "epNo", "totalEps", "length", "endRule", "extra"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] เขียนนิยายเรื่อง "{{title}}" ตอนที่ {{epNo}} จากทั้งหมด {{totalEps}} ตอน\n` +
            `พล็อตหลัก: {{plot}}\nแนวเรื่อง: {{genre}}\nตัวละคร:\n{{roster}}\n` +
            `เนื้อเรื่องที่ผ่านมา:\n{{story}}\n` +
            `{{endRule}}\nความยาวตอน: {{length}}\n{{extra}}\n` +
            `เขียนต่อให้ต่อเนื่องกับของเดิม อย่าเล่าซ้ำ เป็นร้อยแก้ว (มีบทสนทนาได้) แบ่งย่อหน้าด้วยบรรทัดว่าง ใช้ภาษาเดียวกับเนื้อเรื่องเดิม\n` +
            `ตอบตามรูปแบบนี้:\nEPTITLE: <ชื่อตอน>\n\n<เนื้อเรื่อง>`,
    },
    theaterNext: {
        label: "ตอนต่อไป (TinyTheater)", marker: "NARRATION:", tokens: ["chars", "roster", "whatIf", "genre", "length", "epNo", "story", "userRule"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] เขียนตอนที่ {{epNo}} ของมินิเธียเตอร์เรื่องนี้ต่อจากเดิม. นักแสดง: {{chars}}. ข้อมูลตัวละคร:\n{{roster}}\n` +
            `โจทย์ What if: {{whatIf}}\nแนวเรื่อง: {{genre}}\nความยาว: {{length}}\n` +
            `เนื้อเรื่องที่ผ่านมา:\n{{story}}\n` +
            `เขียนตอนต่อไปให้ต่อเนื่องกับของเดิม (อ้างถึงสิ่งที่เกิดขึ้นแล้วได้) พัฒนาเรื่องให้คืบหน้า อย่าเล่าซ้ำ ตั้งชื่อตอนใหม่. ใช้ภาษาเดียวกับข้อมูลตัวละคร. {{userRule}}\n` +
            `ตอบตามรูปแบบนี้เท่านั้น (บรรทัดละ 1 รายการ):\nEPTITLE: <ชื่อตอน>\nNARRATION: <คำบรรยาย>\nLINE: <ชื่อตัวละคร> | <บทพูด>`,
    },
    shopItems: {
        label: "สร้างสินค้า (TinyShop)", marker: "ITEM:", tokens: ["cats", "extra", "context"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] แต่งรายการสินค้า 3-5 ชิ้นที่น่าจะมีขายในร้านค้าของโลกในเนื้อเรื่องนี้ ให้เข้ากับบรรยากาศ/ยุคสมัย/ธีมของเรื่อง ตั้งราคาสมเหตุสมผล เลือกหมวดจากรายการนี้เท่านั้น: {{cats}}. เลือกอิโมจิ 1 ตัวที่สื่อถึงสินค้า ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดหรือกระทำแทนผู้ใช้. {{extra}}{{context}}\n` +
            `ตอบบรรทัดละ 1 ชิ้นในรูปแบบนี้เท่านั้น:\nITEM: <ชื่อสินค้า> | <ราคาเป็นตัวเลข> | <หมวด> | <อิโมจิ> | <รายละเอียดสั้น>`,
    },
    petShopItems: {
        label: "สร้างไอเทมร้านเพ็ท (TinyPet)", marker: "ITEM:", tokens: ["petName", "types", "context"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] แต่งไอเทมสำหรับร้านสัตว์เลี้ยงของ {{petName}} จำนวน 4-6 ชิ้น (คละทั้งอาหาร/ของเล่น/ของใช้) ให้เข้ากับโลกของเนื้อเรื่อง ตั้งราคาเป็นเหรียญสมเหตุสมผล เลือกอิโมจิ 1 ตัว ประเภทเลือกจาก: {{types}}. ค่าพลัง 20-70 ตามความแรง ใช้ภาษาเดียวกับเนื้อเรื่อง.{{context}}\n` +
            `ตอบบรรทัดละ 1 ชิ้นในรูปแบบนี้เท่านั้น:\nITEM: <ชื่อ> | <ราคาเหรียญ> | <ประเภท food/toy/care/heal> | <อิโมจิ> | <ค่าพลัง> | <รายละเอียดสั้น>`,
    },
};

function getPromptTemplate(id) {
    const ov = (getSetting("promptOverrides") || {})[id];
    return (ov && String(ov).trim()) ? String(ov) : (PROMPT_DEFS[id] ? PROMPT_DEFS[id].default : "");
}

// แทน {{token}} ด้วยค่าใน vars (แทนทุกตำแหน่ง) แล้วเคลียร์ token ที่เหลือ
function buildPrompt(id, vars) {
    let t = getPromptTemplate(id);
    vars = vars || {};
    for (const k of Object.keys(vars)) {
        t = t.split(`{{${k}}}`).join(vars[k] == null ? "" : String(vars[k]));
    }
    return t.replace(/\{\{\w+\}\}/g, "");
}

// บันทึก/ลบ override ของ prompt แต่ละตัว
function setPromptOverride(id, val) {
    const o = Object.assign({}, getSetting("promptOverrides") || {});
    if (val == null) delete o[id];
    else o[id] = val;
    setSetting("promptOverrides", o);
}

// วาดตัวแก้ prompt ในหน้า settings (loop จาก PROMPT_DEFS)
function renderPromptEditors() {
    const overrides = getSetting("promptOverrides") || {};
    const html = Object.keys(PROMPT_DEFS).map((id) => {
        const def = PROMPT_DEFS[id];
        const val = getPromptTemplate(id);
        const isCustom = overrides[id] && String(overrides[id]).trim();
        const tokens = (def.tokens && def.tokens.length) ? def.tokens.map((t) => `{{${t}}}`).join(" ") : "—";
        return `<div class="tinyfeed-prompt-item" data-id="${escapeAttr(id)}">
            <div class="tinyfeed-prompt-head">
                <span class="tinyfeed-prompt-label">${escapeText(def.label)}${isCustom ? ' <span class="tinyfeed-prompt-custom">(แก้ไขแล้ว)</span>' : ""}</span>
                <span class="tinyfeed-prompt-reset" data-id="${escapeAttr(id)}">คืนค่าเริ่มต้น</span>
            </div>
            <textarea class="tinyfeed-prompt-text" data-id="${escapeAttr(id)}" rows="6">${escapeText(val)}</textarea>
            <small class="tinyfeed-field-hint">ต้องมี marker: <code>${escapeText(def.marker || "—")}</code> · ช่องข้อมูลที่ใช้ได้: <code>${escapeText(tokens)}</code></small>
        </div>`;
    }).join("");
    $("#tinyfeed-prompt-list").html(html);
}

// รายการ textarea คีย์เวิร์ดต่อแอป (ในกลุ่ม "ทริกเกอร์ด้วยคีย์เวิร์ด")
const KEYWORD_DEFS = [
    { app: "feed", label: "TinyFeed (โพสต์ลงฟีด)", setting: "feedKeywords" },
    { app: "connect", label: "TinyConnect (คู่แชททักเอง)", setting: "connectKeywords" },
    { app: "news", label: "ข่าวสาร", setting: "newsKeywords" },
    { app: "memo", label: "TinyMemo (โน้ต/กำหนดการ)", setting: "memoKeywords" },
    { app: "forum", label: "TinyForum (กระทู้)", setting: "forumKeywords" },
];
function renderKeywordEditors() {
    const html = KEYWORD_DEFS.map((d) => {
        const m = APP_META[d.app];
        return `<div class="tinyfeed-kw-item">
            <div class="tinyfeed-kw-label"><i class="fa-solid ${m.icon}" style="color:${m.color}"></i> ${escapeText(d.label)}</div>
            <textarea class="tinyfeed-kw-text" data-app="${escapeAttr(d.app)}" rows="2" placeholder="เช่น: โพสต์, ลงรูป, story">${escapeText(getSetting(d.setting) || "")}</textarea>
        </div>`;
    }).join("");
    $("#tinyfeed-keyword-list").html(html);
}

// ===== Phase 2: ชั้น generation รองรับ API แยก =====

// สร้าง context เนื้อเรื่อง (ใช้เฉพาะตอนยิงไป profile แยก เพราะไม่มี context RP ติดไปให้)
// ดึงคำอธิบาย persona ปัจจุบัน (มีหลายที่เก็บ ลองตามลำดับ)
function getPersonaDescription() {
    try {
        const pu = getContext().powerUserSettings || {};
        if (pu.persona_description) return String(pu.persona_description);
        const file = getContext().user_avatar || (stScriptModule && stScriptModule.user_avatar);
        const byAvatar = pu.persona_descriptions && file ? pu.persona_descriptions[file] : null;
        return (byAvatar && byAvatar.description) ? String(byAvatar.description) : "";
    } catch (e) {
        return "";
    }
}

async function buildContextPreamble() {
    try {
        const ctx = getContext();
        const sections = [];
        const push = (title, body) => {
            const b = String(body == null ? "" : body).trim();
            if (b) sections.push(`【${title}】\n${b}`);
        };

        // --- ตัวละครหลัก ---
        const char = getCurrentCharacter();
        const chId = ctx.characterId;
        const card = (chId != null && ctx.characters) ? ctx.characters[chId] : null;
        const charLines = [];
        if (char) charLines.push(`ชื่อ: ${getCharName()}${getCharName() !== getRawCharName() ? ` (การ์ด: ${getRawCharName()})` : ""}`);
        if (card) {
            if (card.description) charLines.push(`คำอธิบาย:\n${htmlToPlain(card.description)}`);
            if (card.personality) charLines.push(`บุคลิก:\n${htmlToPlain(card.personality)}`);
            if (card.scenario) charLines.push(`ฉาก:\n${htmlToPlain(card.scenario)}`);
        }
        push("ตัวละครหลัก", charLines.join("\n"));

        // --- ผู้ใช้ / Persona ---
        const personaDesc = getPersonaDescription();
        push("ผู้ใช้ (Persona)",
            `ชื่อ: ${getUserName()}` + (personaDesc ? `\nคำอธิบาย:\n${htmlToPlain(personaDesc)}` : ""));

        // --- World Info (ทุกตำแหน่งที่ ST inject) ---
        try {
            if (typeof ctx.getWorldInfoPrompt === "function" && Array.isArray(ctx.chat) && ctx.chat.length) {
                // ⚠️ ST ส่ง chat เป็น array ของ string "ชื่อ: ข้อความ" และ reverse (ใหม่→เก่า)
                const chatForWI = ctx.chat.map((m) => `${m.name}: ${m.mes}`).reverse();
                const scanData = {
                    personaDescription: personaDesc || "",
                    characterDescription: (card && card.description) || "",
                    characterPersonality: (card && card.personality) || "",
                    characterDepthPrompt: "",
                    scenario: (card && card.scenario) || "",
                    creatorNotes: (card && card.creator_notes) || "",
                    trigger: "normal",
                };
                const wi = await ctx.getWorldInfoPrompt(chatForWI, ctx.maxContext || 4096, true, scanData) || {};
                const wiParts = [];
                const add = (label, val) => {
                    const t = String(val || "").trim();
                    if (t) wiParts.push(`— ${label} —\n${htmlToPlain(t)}`);
                };
                add("ก่อนคำอธิบายตัวละคร", wi.worldInfoBefore);
                add("หลังคำอธิบายตัวละคร", wi.worldInfoAfter);
                if (Array.isArray(wi.anBefore) && wi.anBefore.length) add("ก่อน Author's Note", wi.anBefore.join("\n"));
                if (Array.isArray(wi.anAfter) && wi.anAfter.length) add("หลัง Author's Note", wi.anAfter.join("\n"));
                if (Array.isArray(wi.worldInfoDepth) && wi.worldInfoDepth.length) {
                    const d = wi.worldInfoDepth
                        .map((x) => `(depth ${x.depth}) ${(x.entries || []).join(" | ")}`).join("\n");
                    add("แทรกในบทสนทนา", d);
                }
                if (Array.isArray(wi.worldInfoExamples) && wi.worldInfoExamples.length) {
                    add("ตัวอย่างบทสนทนา", wi.worldInfoExamples
                        .map((e) => (typeof e === "string" ? e : (e && e.content) || "")).join("\n"));
                }
                if (wi.outletEntries && typeof wi.outletEntries === "object") {
                    for (const [k, v] of Object.entries(wi.outletEntries)) {
                        if (Array.isArray(v) && v.length) add(`Outlet: ${k}`, v.join("\n"));
                    }
                }
                let wiStr = wiParts.join("\n\n").trim();
                const wiLimit = parseInt(getSetting("worldInfoLimit"), 10);
                if (wiStr && Number.isFinite(wiLimit) && wiLimit > 0 && wiStr.length > wiLimit) {
                    wiStr = wiStr.slice(0, wiLimit) + "…";
                }
                push("World Info", wiStr);
            }
        } catch (e) {
            console.warn(`[${extensionName}] ดึง World Info ไม่สำเร็จ:`, e);
        }

        // --- บทสนทนาล่าสุด ---
        const n = Math.max(0, parseInt(getSetting("apiContextMessages"), 10) || 0);
        if (n > 0 && Array.isArray(ctx.chat) && ctx.chat.length) {
            push("บทสนทนาล่าสุด", ctx.chat.slice(-n).map((m) => `${m.name}: ${htmlToPlain(m.mes)}`).join("\n"));
        }

        if (!sections.length) return "";
        return `=== บริบทเนื้อเรื่องปัจจุบัน (อ้างอิงเท่านั้น) ===\n\n${sections.join("\n\n")}\n\n=== จบบริบท ===\n\n`;
    } catch (e) {
        console.warn(`[${extensionName}] buildContextPreamble ล้มเหลว:`, e);
        return "";
    }
}

// ยิง generation — เลือกใช้ API หลัก หรือ connection profile แยก (มี fallback)
async function tinyGenerate(prompt, maxTokens, app) {
    const ctx = getContext();
    const profileId = getSetting("apiProfile");
    if (profileId && ctx.ConnectionManagerRequestService) {
        try {
            const preamble = await buildContextPreamble();
            recordGenTokens(app, prompt, maxTokens, preamble);   // context วัดได้ (เราสร้างเอง)
            const full = preamble + prompt;
            const res = await ctx.ConnectionManagerRequestService.sendRequest(profileId, full, maxTokens);
            const content = res && typeof res.content === "string" ? res.content : "";
            if (content) return content;
            console.warn(`[${extensionName}] profile ส่งข้อความว่าง — fallback ไป API หลัก`);
        } catch (e) {
            console.error(`[${extensionName}] profile request ล้มเหลว fallback ไป API หลัก:`, e);
        }
    }
    // API หลัก (generateQuietPrompt แนบ context RP ให้เอง → phone วัด context ตรงนั้นไม่ได้)
    recordGenTokens(app, prompt, maxTokens, null);
    return await ctx.generateQuietPrompt({ quietPrompt: prompt, responseLength: maxTokens });
}

// แยกชื่อผู้โพสต์กับข้อความออกจากผลลัพธ์ AI (รูปแบบ NAME:/POST:)
function parseGeneratedPost(raw, fallbackName) {
    const text = stripReasoning(raw);
    const nameMatch = text.match(/NAME:\s*(.+)/i);
    const postMatch = text.match(/POST:\s*([\s\S]+)/i);
    let author = nameMatch ? nameMatch[1].trim() : fallbackName;
    let body = postMatch ? postMatch[1].trim() : text.trim();
    // เก็บกวาด: ตัด marker/เครื่องหมายคำพูดครอบที่หลงมา
    author = author.replace(/^["'“”\[\(]+|["'“”\]\)]+$/g, "").trim() || fallbackName;
    body = body.replace(/^POST:\s*/i, "").trim();
    return { author, text: body };
}

let isGenerating = false;

async function generateFeedPost(opts) {
    opts = opts || {};
    if (isGenerating) return;
    const char = getCurrentCharacter();
    if (!char) {
        // auto: เงียบไว้ / manual: แจ้งเตือน
        if (!opts.silent) toastr.info("เปิดแชทที่มีตัวละครก่อนนะ แล้วค่อยให้ AI โพสต์", "TinyFeed");
        return;
    }
    const ctx = getContext();
    if (typeof ctx.generateQuietPrompt !== "function") {
        toastr.error("เวอร์ชัน SillyTavern นี้ไม่มี generateQuietPrompt", "TinyFeed");
        return;
    }

    isGenerating = true;
    const genId = ++feedGenId;   // สำหรับ soft-cancel
    setPostGenerating(true);
    $("#tinyfeed-feed-list").prepend(`<div id="tinyfeed-feed-skel">${skeletonCardHtml()}</div>`);

    const charName = getCharName();

    // 6.5: รายชื่อ NPC ประจำ → คุมให้ AI เลือกผู้โพสต์จากลิสต์
    const npcNames = getNpcs().map((n) => String(n.name || "").trim()).filter(Boolean);
    // คนโพสต์ที่เลือกจากรูปโปรไฟล์ (auto = ให้ AI เลือก, __user__ ไม่มาถึงนี่)
    const forcedPoster = (feedPoster && feedPoster !== POSTER_AUTO && feedPoster !== POSTER_USER) ? feedPoster : "";
    const rosterLine = forcedPoster
        ? `ผู้โพสต์ต้องเป็น ${forcedPoster} เท่านั้น เขียนในน้ำเสียง/มุมมองของ ${forcedPoster}. `
        : (npcNames.length
            ? `ผู้โพสต์ต้องเป็น ${charName} หรือหนึ่งใน NPC ต่อไปนี้เท่านั้น (สะกดชื่อให้ตรงเป๊ะ): ${npcNames.join(", ")}. `
            : `ผู้โพสต์จะเป็น ${charName} หรือ NPC ตัวใดตัวหนึ่งในโลกของเรื่องก็ได้. `);

    // 6.6: แนบโพสต์ล่าสุดเป็น context กันโพสต์ซ้ำ
    let historyLine = "";
    const n = parseInt(getSetting("historyCount"), 10);
    if (Number.isFinite(n) && n > 0) {
        const recent = getFeedData().feed
            .slice(0, n)
            .map((p) => `- ${p.author}: ${htmlToPlain(p.text)}`)
            .filter(Boolean);
        if (recent.length) {
            historyLine =
                `\nโพสต์ล่าสุดที่มีอยู่แล้วในฟีด (ห้ามเขียนซ้ำหรือใกล้เคียง แต่อ้างอิง/สานต่อได้):\n` +
                recent.join("\n") + `\n`;
        }
    }

    const extra = String(getSetting("postExtraPrompt") || "").trim();
    const guidance = String($("#tinyfeed-feed-guidance").val() || "").trim();
    const extraLine = (extra ? `คำสั่งเพิ่มเติมจากผู้ใช้: ${extra}. ` : "")
        + (guidance ? `แนวทางเฉพาะโพสต์นี้: ${guidance}. ` : "")
        + galleryPromptBlock();

    const quietPrompt = buildPrompt("feedPost", {
        roster: rosterLine, extra: extraLine, history: historyLine, context: crossAppContext("feed"),
    });

    try {
        const raw = await tinyGenerate(quietPrompt, Math.max(1, parseInt(getSetting("postTokens"), 10) || 400), "feed");
        if (genId !== feedGenId) return;   // ถูกยกเลิกระหว่างเจน → ทิ้งผล
        const parsed = parseGeneratedPost(raw, charName);
        const text = parsed.text;
        // ผู้ใช้เลือกผู้โพสต์เจาะจง = บังคับใช้ชื่อนั้น ไม่ต้องเชื่อ author ที่ AI ตอบ
        const author = forcedPoster || parsed.author;
        if (!text) {
            toastr.warning("AI ไม่ได้ส่งข้อความโพสต์กลับมา ลองใหม่อีกครั้งนะ", "TinyFeed");
            return;
        }
        const isMain = author.trim().toLowerCase() === charName.trim().toLowerCase();
        const post = {
            id: "ai" + Date.now(),
            author: isMain ? charName : author,
            isMain: isMain,          // ตรงตัวละครหลัก = รูปการ์ด, ไม่ตรง = NPC (anon avatar)
            isAI: true,              // โพสต์จาก AI — เปิดปุ่มลบ (เผื่อ format เพี้ยน)
            avatar: "",
            ts: Date.now(),
            text: escapeHtml(text),
            likes: randomInitialLikes(),   // สุ่มไลค์เริ่มต้นตามช่วงใน config
            comments: [],
        };
        getFeedData().feed.unshift(post);
        saveFeedData();
        renderFeed();
        if (opts.notify) showPushNotification(post);   // แจ้งเตือนสไตล์โทรศัพท์ (auto-post)
        console.log(`[${extensionName}] AI post added:`, post.id, "by", post.author);
        await generateInitialComments(post);           // Stage 8: คอมเมนต์ NPC ติดมา (ตาม config)
    } catch (e) {
        console.error(`[${extensionName}] generate failed:`, e);
        if (genId === feedGenId && !opts.silent) toastr.error("สร้างโพสต์ไม่สำเร็จ ลองใหม่อีกครั้งนะ", "TinyFeed");
    } finally {
        // รีเซ็ตสถานะเฉพาะเมื่อยังเป็นรอบเดิม (ไม่ถูกยกเลิก/แทนที่)
        if (genId === feedGenId) {
            $("#tinyfeed-feed-skel").remove();
            isGenerating = false;
            setPostGenerating(false);
        }
    }
}

// ===== Stage 8: คอมเมนต์ + AI ตอบ =====
let isReplying = null;   // postId ที่ AI กำลังตอบคอมเมนต์อยู่ (โชว์ "กำลังพิมพ์…")

// สร้าง object คอมเมนต์ (ตั้ง isMain ถ้าเป็นตัวละครหลัก จะได้ใช้รูปการ์ด)
function makeCommentObj(author, text, charName) {
    const isMain = String(author).trim().toLowerCase() === String(charName).trim().toLowerCase();
    return { author: isMain ? charName : author, isMain, avatar: "", text: escapeHtml(text) };
}

// parse คอมเมนต์หลายอันจากผลลัพธ์ AI (รูปแบบบรรทัดละ: COMMENT: ชื่อ | ข้อความ)
function parseCommentLines(raw, charName, marker) {
    const s = stripReasoning(raw);
    const out = [];
    const re = new RegExp(`${marker || "COMMENT"}:\\s*(.+)`, "gi");
    let m;
    while ((m = re.exec(s)) !== null) {
        const line = m[1].trim();
        const parts = line.split("|");
        let author, text;
        if (parts.length >= 2) {
            author = parts[0].trim();
            text = parts.slice(1).join("|").trim();
        } else {
            author = charName;
            text = line;
        }
        author = author.replace(/^["'“”\[\(]+|["'“”\]\)]+$/g, "").trim() || charName;
        if (text) out.push(makeCommentObj(author, text, charName));
    }
    return out;
}

// ผู้ใช้คอมเมนต์เอง
async function addComment(postId, text) {
    const clean = String(text || "").trim();
    if (!clean) return;
    const post = getFeedData().feed.find((p) => p.id === postId);
    if (!post) return;
    post.comments.push({ author: getUserName(), isUser: true, avatar: "", text: escapeHtml(clean) });
    saveFeedData();
    openPostDetail(postId);   // refresh หน้ารายละเอียด
    if (getSetting("commentReplyMode") === "instant") {
        await generateCommentReply(postId);
    }
}

// รวมรายชื่อ NPC เป็นประโยคสำหรับ prompt
function npcRosterLine(charName) {
    const npcNames = getNpcs().map((n) => String(n.name || "").trim()).filter(Boolean);
    return npcNames.length
        ? `ผู้คอมเมนต์เป็นตัวละครหลัก (${charName}) หรือ NPC เหล่านี้ (สะกดชื่อให้ตรงเป๊ะ): ${npcNames.join(", ")}. `
        : `ผู้คอมเมนต์เป็นตัวละครหลัก (${charName}) หรือ NPC ตัวใดในโลกของเรื่องก็ได้. `;
}

// แนวทางคอมเมนต์แบบครั้งเดียว (อ่านจากช่องในหน้ารายละเอียดโพสต์ ถ้ามี)
function commentGuidanceLine() {
    const g = String($("#tinyfeed-comment-guidance").val() || "").trim();
    return g ? `แนวทางคอมเมนต์รอบนี้: ${g}. ` : "";
}

// AI ตอบคอมเมนต์ 1 อัน (เลือกผู้ตอบเอง: เจ้าของโพสต์หรือ NPC)
async function generateCommentReply(postId) {
    if (isReplying) return;
    const ctx = getContext();
    if (typeof ctx.generateQuietPrompt !== "function") return;
    const post = getFeedData().feed.find((p) => p.id === postId);
    if (!post) return;
    const char = getCurrentCharacter();
    const charName = getCharName();

    const thread = post.comments.slice(-6)
        .map((c) => `- ${c.author}: ${htmlToPlain(c.text)}`).join("\n");
    const q = buildPrompt("feedCommentReply", {
        postText: htmlToPlain(post.text), author: post.author, thread: thread, roster: npcRosterLine(charName) + commentGuidanceLine(),
    });

    isReplying = postId;
    openPostDetail(postId);   // โชว์ "กำลังพิมพ์…"
    try {
        const raw = await tinyGenerate(q, 150, "feed");
        const list = parseCommentLines(raw, charName);
        if (list.length) {
            post.comments.push(list[0]);
            saveFeedData();
        }
    } catch (e) {
        console.error(`[${extensionName}] comment reply failed:`, e);
        toastr.error("AI ตอบคอมเมนต์ไม่สำเร็จ ลองใหม่นะ", "TinyFeed");
    } finally {
        isReplying = null;
        openPostDetail(postId);
    }
}

// แกนสร้างคอมเมนต์ NPC — ใช้ร่วมทั้งตอนโพสต์ใหม่ (auto) และปุ่มกดเอง (คืนจำนวนที่สร้างได้)
async function runInitialComments(post, mode) {
    const ctx = getContext();
    if (typeof ctx.generateQuietPrompt !== "function") return 0;
    const char = getCurrentCharacter();
    const charName = getCharName();

    let countLine;
    if (mode === "fixed") {
        const nc = Math.max(1, parseInt(getSetting("initialCommentCount"), 10) || 1);
        countLine = `เขียนคอมเมนต์ ${nc} อัน. `;
    } else {
        countLine = `เขียนคอมเมนต์ 0 ถึง 3 อันตามที่เหมาะสม (ถ้าไม่มีใครน่าคอมเมนต์ก็ไม่ต้องเขียน). `;
    }
    const q = buildPrompt("feedInitialComments", {
        postText: htmlToPlain(post.text), author: post.author, roster: npcRosterLine(charName) + commentGuidanceLine(), count: countLine,
    });
    const raw = await tinyGenerate(q, 300, "feed");
    const comments = parseCommentLines(raw, charName)
        .filter((c) => c.author.trim().toLowerCase() !== String(post.author).trim().toLowerCase());
    if (comments.length) {
        post.comments.push(...comments);
        saveFeedData();
        renderFeed();
    }
    return comments.length;
}

// auto: สร้างคอมเมนต์ NPC ติดมากับโพสต์ใหม่ (ตาม config; ปิดได้ด้วย mode "none")
async function generateInitialComments(post) {
    const mode = getSetting("initialCommentMode");
    if (mode === "none") return;
    try {
        await runInitialComments(post, mode);
    } catch (e) {
        console.error(`[${extensionName}] initial comments failed:`, e);
    }
}

// ปุ่มกดเอง: บังคับให้ NPC มาคอมเมนต์โพสต์นี้เพิ่มเสมอ (แม้ config ตั้งไว้ none)
let isGenCommentsBusy = false;
async function generateCommentsForPost(postId) {
    if (isGenCommentsBusy) return;
    const post = getFeedData().feed.find((p) => p.id === postId);
    if (!post) return;
    const mode = getSetting("initialCommentMode") === "fixed" ? "fixed" : "ai";
    isGenCommentsBusy = true;
    const btns = $(`.tinyfeed-gen-comments[data-post="${postId}"]`);
    btns.addClass("tinyfeed-generating").prop("disabled", true);
    try {
        const n = await runInitialComments(post, mode);
        if (!n) toastr.info("รอบนี้ยังไม่มีใครคอมเมนต์ ลองกดใหม่ได้", "TinyFeed");
        // ถ้าหน้ารายละเอียดโพสต์นี้เปิดอยู่ ให้รีเฟรชด้วย
        if (!$("#tinyfeed-detail").hasClass("tinyfeed-hidden")) openPostDetail(postId);
    } catch (e) {
        console.error(`[${extensionName}] manual comments failed:`, e);
        toastr.error("สร้างคอมเมนต์ไม่สำเร็จ ลองใหม่นะ", "TinyFeed");
    } finally {
        isGenCommentsBusy = false;
        // เผื่อ DOM เดิมยังอยู่ (กรณีไม่มีคอมเมนต์ใหม่จึงไม่ได้ re-render)
        $(`.tinyfeed-gen-comments[data-post="${postId}"]`).removeClass("tinyfeed-generating").prop("disabled", false);
    }
}

// ===== Stage 9: แท็บข่าวสาร (AI generate) =====
let isGeneratingNews = false;

// parse ข่าวจากผลลัพธ์ AI (SOURCE/TITLE/SUMMARY/BODY)
function parseGeneratedNews(raw) {
    const s = stripReasoning(raw);
    const grab = (re) => { const m = s.match(re); return m ? m[1].trim() : ""; };
    let source = grab(/SOURCE:\s*(.+)/i);
    let title = grab(/TITLE:\s*(.+)/i);
    let summary = grab(/SUMMARY:\s*(.+)/i);
    let bodyM = s.match(/BODY:\s*([\s\S]+)/i);
    let body = bodyM ? bodyM[1].trim() : "";
    // fallback ถ้า format เพี้ยน
    if (!title && !body) { title = s.trim().split("\n")[0] || "ข่าวไม่มีหัวข้อ"; body = s.trim(); }
    if (!body) body = summary || title;
    if (!summary) summary = body.split("\n")[0];
    if (!source) source = "สำนักข่าว";
    return { source, title, summary, body };
}

async function generateNews(opts) {
    opts = opts || {};
    if (isGeneratingNews) return;
    const ctx = getContext();
    if (typeof ctx.generateQuietPrompt !== "function") {
        if (!opts.silent) toastr.error("เวอร์ชัน SillyTavern นี้ไม่มี generateQuietPrompt", "TinyFeed");
        return;
    }

    isGeneratingNews = true;
    const btn = $("#tinyfeed-generate-news");
    btn.addClass("tinyfeed-generating").prop("disabled", true);
    btn.find(".tinyfeed-generate-news-label").text("กำลังสร้าง...");
    $("#tinyfeed-news-list").prepend(`<div id="tinyfeed-news-skel">${skeletonCardHtml()}</div>`);

    // ประวัติข่าวล่าสุดกันซ้ำ
    let historyLine = "";
    const hn = parseInt(getSetting("newsHistoryCount"), 10);
    if (Number.isFinite(hn) && hn > 0) {
        const recent = getFeedData().news.slice(0, hn)
            .map((n) => `- ${n.title}`).filter(Boolean);
        if (recent.length) historyLine = `\nหัวข้อข่าวที่มีอยู่แล้ว (ห้ามซ้ำ):\n${recent.join("\n")}\n`;
    }

    const extra = String(getSetting("newsExtraPrompt") || "").trim();
    const newsGuidance = String($("#tinyfeed-news-guidance").val() || "").trim();
    const extraLine = (extra ? ` คำสั่งเพิ่มเติมจากผู้ใช้: ${extra}.` : "")
        + (newsGuidance ? ` แนวทางเฉพาะข่าวนี้: ${newsGuidance}.` : "");

    const q = buildPrompt("news", {
        extra: extraLine, history: historyLine, context: crossAppContext("news"),
    });

    try {
        const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("newsTokens"), 10) || 500), "news");
        const parsed = parseGeneratedNews(raw);
        if (!parsed.title && !parsed.body) {
            if (!opts.silent) toastr.warning("AI ไม่ได้ส่งข่าวกลับมา ลองใหม่นะ", "TinyFeed");
            return;
        }
        const news = {
            id: "news" + Date.now(),
            source: escapeText(parsed.source),
            ts: Date.now(),
            title: escapeText(parsed.title),
            summary: escapeText(parsed.summary),
            body: escapeText(parsed.body),
            isAI: true,
        };
        getFeedData().news.unshift(news);
        saveFeedData();
        renderNews();
        if (opts.notify) showNotif(makeAnonAvatar(news.source), news.source, news.title, "news");
        console.log(`[${extensionName}] news added:`, news.id);
    } catch (e) {
        console.error(`[${extensionName}] generate news failed:`, e);
        if (!opts.silent) toastr.error("สร้างข่าวไม่สำเร็จ ลองใหม่นะ", "TinyFeed");
    } finally {
        $("#tinyfeed-news-skel").remove();
        isGeneratingNews = false;
        btn.removeClass("tinyfeed-generating").prop("disabled", false);
        btn.find(".tinyfeed-generate-news-label").text("สร้างข่าวใหม่");
    }
}

// ลบข่าวที่ AI สร้าง
function deleteNews(newsId) {
    const data = getFeedData();
    const news = data.news.find((n) => n.id === newsId);
    if (!news || !news.isAI) return;
    if (!confirm("ต้องการลบข่าวนี้ใช่ไหม?")) return;
    data.news = data.news.filter((n) => n.id !== newsId);
    saveFeedData();
    renderNews();
    console.log(`[${extensionName}] news deleted:`, newsId);
}

// ===== TinyMemo: กำหนดการ + โน้ต/ความจำ =====
let memoTab = "agenda";
let isMemoBusy = false;

function switchMemoTab(tab) {
    memoTab = (tab === "notes") ? "notes" : "agenda";
    $(".tinyfeed-tab[data-mtab]").removeClass("tinyfeed-tab-active");
    $(`.tinyfeed-tab[data-mtab="${memoTab}"]`).addClass("tinyfeed-tab-active");
    $("#tinyfeed-memo-agenda, #tinyfeed-memo-notes").addClass("tinyfeed-hidden");
    $(`#tinyfeed-memo-${memoTab}`).removeClass("tinyfeed-hidden");
    if (memoTab === "agenda") renderAgenda(); else renderNotes();
}

function agendaItemHtml(a) {
    const cls = a.status === "done" ? " tinyfeed-agenda-item-done"
        : (a.status === "cancelled" ? " tinyfeed-agenda-item-cancelled" : "");
    const icon = a.status === "done" ? '<i class="fa-solid fa-check"></i>'
        : (a.status === "cancelled" ? '<i class="fa-solid fa-xmark"></i>' : "");
    const tag = a.status === "cancelled" ? `<span class="tinyfeed-agenda-tag">ยกเลิก</span>` : "";
    return `<div class="tinyfeed-agenda-item${cls}">
        <span class="tinyfeed-agenda-check" data-id="${escapeAttr(a.id)}" title="ติ๊ก/ยกเลิกติ๊ก">${icon}</span>
        <div class="tinyfeed-agenda-body">
            ${a.when ? `<span class="tinyfeed-agenda-when">${renderRich(a.when)}</span>` : ""}
            <span class="tinyfeed-agenda-title">${renderRich(a.title)}</span>${tag}
        </div>
        <span class="tinyfeed-agenda-del" data-id="${escapeAttr(a.id)}" title="ลบ"><i class="fa-solid fa-trash"></i></span>
    </div>`;
}

function renderAgenda() {
    const agenda = getAgenda();
    const box = $("#tinyfeed-agenda-list");
    if (!agenda.length) {
        box.html(emptyStateHtml("fa-calendar-day", "ยังไม่มีกำหนดการ",
            "เพิ่มเอง หรือกด “สแกนกำหนดการจากเรื่อง” ให้ AI ดึงนัดหมายจากเนื้อเรื่อง"));
        return;
    }
    const pending = agenda.filter((a) => a.status === "pending");
    const closed = agenda.filter((a) => a.status !== "pending");
    let html = pending.length
        ? pending.map(agendaItemHtml).join("")
        : `<div class="tinyfeed-memo-section">ไม่มีรายการค้างอยู่</div>`;
    if (closed.length) {
        html += `<div class="tinyfeed-memo-section">เสร็จแล้ว / ผ่านไปแล้ว</div>`;
        html += closed.map(agendaItemHtml).join("");
    }
    box.html(html);
}

function renderNotes() {
    const notes = getNotes();
    const box = $("#tinyfeed-notes-list");
    if (!notes.length) {
        box.html(emptyStateHtml("fa-note-sticky", "ยังไม่มีโน้ต",
            "เพิ่มเอง หรือกด “สแกนความจำจากเรื่อง” ให้ AI จดเหตุการณ์สำคัญไว้"));
        return;
    }
    const html = notes.slice().reverse().map((n) => {
        const icon = n.kind === "event" ? "fa-bookmark" : "fa-lightbulb";
        return `<div class="tinyfeed-note-card">
            <span class="tinyfeed-note-icon"><i class="fa-solid ${icon}"></i></span>
            <div class="tinyfeed-note-body">
                <span class="tinyfeed-note-text">${renderRich(n.text)}</span>
                <span class="tinyfeed-note-time">${displayTime(n)}</span>
            </div>
            <span class="tinyfeed-note-del" data-id="${escapeAttr(n.id)}" title="ลบ"><i class="fa-solid fa-trash"></i></span>
        </div>`;
    }).join("");
    box.html(html);
}

// เพิ่มกำหนดการเอง — รองรับรูปแบบ "เมื่อไร | อะไร"
function addAgendaManual(text) {
    const clean = String(text || "").trim();
    if (!clean) return;
    let when = "", title = clean;
    const bar = clean.indexOf("|");
    if (bar >= 0) { when = clean.slice(0, bar).trim(); title = clean.slice(bar + 1).trim(); }
    if (!title) return;
    getAgenda().push({ id: "a" + Date.now(), when: escapeHtml(when), title: escapeHtml(title), status: "pending", isAI: false, ts: Date.now() });
    saveFeedData();
    $("#tinyfeed-agenda-input").val("");
    renderAgenda();
    updateChatInjection();
}

function addNoteManual(text) {
    const clean = String(text || "").trim();
    if (!clean) return;
    getNotes().push({ id: "n" + Date.now(), text: escapeHtml(clean), kind: "fact", isAI: false, ts: Date.now() });
    saveFeedData();
    $("#tinyfeed-note-input").val("");
    renderNotes();
    updateChatInjection();
}

// ติ๊ก/ยกเลิกติ๊ก (pending <-> done, และ cancelled -> pending)
function toggleAgenda(id) {
    const a = getAgenda().find((x) => x.id === id);
    if (!a) return;
    a.status = a.status === "pending" ? "done" : "pending";
    saveFeedData();
    renderAgenda();
    updateChatInjection();
}

function deleteAgenda(id) {
    const agenda = getAgenda();
    const a = agenda.find((x) => x.id === id);
    if (!a) return;
    if (!confirm("ต้องการลบกำหนดการนี้ใช่ไหม?")) return;
    agenda.splice(agenda.indexOf(a), 1);
    saveFeedData();
    renderAgenda();
    updateChatInjection();
}

function deleteNote(id) {
    const notes = getNotes();
    const n = notes.find((x) => x.id === id);
    if (!n) return;
    if (!confirm("ต้องการลบโน้ตนี้ใช่ไหม?")) return;
    notes.splice(notes.indexOf(n), 1);
    saveFeedData();
    renderNotes();
    updateChatInjection();
}

function memoNotifAvatar() {
    return `<div class="tinyfeed-avatar tinyfeed-avatar-anon" style="background:linear-gradient(135deg,#f59e0b,#d97706)"><i class="fa-solid fa-calendar-check"></i></div>`;
}

// ถาม AI สั้นๆ ว่ามีอะไรควรจด/ปิดไหม (โหมด ai — ประหยัด token)
async function aiDecidesMemo() {
    try {
        const q =
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง ไม่ต้องสวมบทบาท] ` +
            `พิจารณาสถานการณ์ล่าสุด: มีกำหนดการ/นัดหมายใหม่ที่ควรจด, มีนัดเดิมที่เพิ่งเกิดขึ้น/ถูกยกเลิก, ` +
            `หรือมีเหตุการณ์สำคัญที่ควรบันทึกเป็นความจำไหม ถ้ามีตอบ YES ถ้ายังไม่มีตอบ NO ` +
            `ตอบคำเดียว: YES หรือ NO`;
        const res = await tinyGenerate(q, 120);
        const s = stripReasoning(res).toLowerCase();
        if (/\bno\b/.test(s) || s.includes("ไม่")) return false;
        if (/\byes\b/.test(s) || s.includes("ใช่") || s.includes("มี")) return true;
        return false;
    } catch (e) {
        console.error(`[${extensionName}] aiDecidesMemo failed:`, e);
        return false;
    }
}

function parseMemoLines(raw) {
    const text = stripReasoning(raw);
    const out = { adds: [], dones: [], cancels: [], notes: [] };
    for (const line of text.split("\n")) {
        const l = line.trim();
        if (!l) continue;
        let m;
        if ((m = l.match(/^ADD:\s*(.+)$/i))) {
            const rest = m[1];
            const bar = rest.indexOf("|");
            const when = bar >= 0 ? rest.slice(0, bar).trim() : "";
            const title = (bar >= 0 ? rest.slice(bar + 1) : rest).trim();
            if (title) out.adds.push({ when, title });
        } else if ((m = l.match(/^DONE:\s*(\d+)/i))) {
            out.dones.push(parseInt(m[1], 10));
        } else if ((m = l.match(/^CANCEL:\s*(\d+)/i))) {
            out.cancels.push(parseInt(m[1], 10));
        } else if ((m = l.match(/^NOTE:\s*(.+)$/i))) {
            out.notes.push(m[1].trim());
        }
    }
    return out;
}

// สแกนครั้งเดียว: หากำหนดการใหม่ + ปิด/ยกเลิกอันเดิม + จดความจำ
async function scanMemo(opts) {
    opts = opts || {};
    if (isMemoBusy) return;
    const ctx = getContext();
    if (typeof ctx.generateQuietPrompt !== "function") {
        if (!opts.silent) toastr.error("เวอร์ชัน SillyTavern นี้ไม่มี generateQuietPrompt", "TinyMemo");
        return;
    }
    if (!getCurrentCharacter()) {
        if (!opts.silent) toastr.info("เปิดแชทที่มีตัวละครก่อนนะ", "TinyMemo");
        return;
    }
    isMemoBusy = true;
    const scanBtns = $("#tinyfeed-agenda-scan, #tinyfeed-note-scan");
    scanBtns.addClass("tinyfeed-generating").prop("disabled", true);
    try {
        const pending = getAgenda().filter((a) => a.status === "pending");
        const pendingLines = pending.length
            ? pending.map((a, i) => `[${i + 1}] ${a.when ? htmlToPlain(a.when) + " — " : ""}${htmlToPlain(a.title)}`).join("\n")
            : "(ยังไม่มี)";
        const recentNotes = getNotes().slice(-8).map((n) => `- ${htmlToPlain(n.text)}`).join("\n");
        const extra = String(getSetting("memoExtraPrompt") || "").trim();
        const q =
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง ไม่ต้องสวมบทบาท] ` +
            `คุณคือผู้ช่วยจดกำหนดการและความจำจากเนื้อเรื่อง RP ปัจจุบัน ทำ 3 อย่าง:\n` +
            `1) หากำหนดการ/นัดหมาย/เหตุการณ์ที่ "กำลังจะเกิดในอนาคต" ที่ยังไม่มีในรายการ แล้วเพิ่มด้วย ADD\n` +
            `2) ดูรายการที่ค้างอยู่ อันไหนเกิดขึ้นแล้วใช้ DONE อันไหนยกเลิก/ไม่เกิดแล้วใช้ CANCEL (อ้างด้วยหมายเลข)\n` +
            `3) จดเหตุการณ์สำคัญที่เพิ่งเกิด หรือข้อเท็จจริงที่ควรจำ ที่ยังไม่มีในโน้ต ด้วย NOTE\n` +
            `ใช้ภาษาเดียวกับเนื้อเรื่อง กระชับ ห้ามพูดแทนผู้ใช้ ห้ามแต่งเกินจริง ถ้าไม่มีรายการไหนก็ไม่ต้องตอบบรรทัดนั้น\n` +
            (extra ? `คำสั่งเพิ่มเติม: ${extra}.\n` : "") +
            crossAppContext("memo") +
            `\nรายการกำหนดการที่ค้างอยู่:\n${pendingLines}\n` +
            (recentNotes ? `\nโน้ตที่มีอยู่แล้ว (อย่าจดซ้ำ):\n${recentNotes}\n` : "") +
            `\nตอบบรรทัดละรายการในรูปแบบนี้เท่านั้น (ตอบเฉพาะที่มีจริง):\n` +
            `ADD: <เมื่อไร> | <กำหนดการ>\nDONE: <หมายเลข>\nCANCEL: <หมายเลข>\nNOTE: <ข้อความ>`;
        const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("memoTokens"), 10) || 350), "memo");
        const parsed = parseMemoLines(raw);

        let added = 0, changed = 0, noted = 0;
        const agenda = getAgenda();
        for (const a of parsed.adds) {
            agenda.push({
                id: "a" + Date.now() + Math.random().toString(36).slice(2, 6),
                when: escapeHtml(a.when), title: escapeHtml(a.title),
                status: "pending", isAI: true, ts: Date.now(),
            });
            added++;
        }
        for (const n of parsed.dones) { const it = pending[n - 1]; if (it && it.status === "pending") { it.status = "done"; changed++; } }
        for (const n of parsed.cancels) { const it = pending[n - 1]; if (it && it.status === "pending") { it.status = "cancelled"; changed++; } }
        const existing = new Set(getNotes().map((n) => htmlToPlain(n.text).trim().toLowerCase()));
        for (const t of parsed.notes) {
            const key = t.trim().toLowerCase();
            if (!key || existing.has(key)) continue;
            existing.add(key);
            getNotes().push({ id: "n" + Date.now() + Math.random().toString(36).slice(2, 6), text: escapeHtml(t), kind: "event", isAI: true, ts: Date.now() });
            noted++;
        }

        if (added || changed || noted) {
            saveFeedData();
            if (currentApp === "memo") { renderAgenda(); renderNotes(); }
            updateChatInjection();
            if (opts.notify) {
                const summary = [added ? `กำหนดการใหม่ ${added}` : "", changed ? `อัปเดต ${changed}` : "", noted ? `โน้ต ${noted}` : ""].filter(Boolean).join(" · ");
                showNotif(memoNotifAvatar(), "TinyMemo", summary || "อัปเดตบันทึก", "agenda", "memo");
            }
        } else if (opts.manual && !opts.silent) {
            toastr.info("รอบนี้ยังไม่มีอะไรใหม่ให้จด", "TinyMemo");
        }
    } catch (e) {
        console.error(`[${extensionName}] scanMemo failed:`, e);
        if (!opts.silent) toastr.error("สแกนไม่สำเร็จ ลองใหม่นะ", "TinyMemo");
    } finally {
        isMemoBusy = false;
        scanBtns.removeClass("tinyfeed-generating").prop("disabled", false);
    }
}

// ===== TinyForum: เว็บบอร์ด/กระทู้ =====
let activeForumThread = null;
let forumSort = "latest";        // "latest" | "hot"
let forumReplyingTo = null;      // comment id ที่กำลังเปิดกล่องตอบกลับ
let isForumBusy = false;

function forumId(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function forumCommentCount(t) {
    return (t.comments || []).reduce((s, c) => s + 1 + ((c.replies || []).length), 0);
}
function forumScore(t) { return forumCommentCount(t) + (Number(t.likes) || 0); }

function isForumThreadOpen() {
    return !$("#tinyfeed-forum-thread").hasClass("tinyfeed-hidden");
}

function openForumList() {
    activeForumThread = null;
    cancelForumReply();
    $("#tinyfeed-forum-newform").addClass("tinyfeed-hidden");
    $("#tinyfeed-forum-thread").addClass("tinyfeed-hidden");
    $("#tinyfeed-forum-list").removeClass("tinyfeed-hidden");
    $("#tinyfeed-home-btn, #tinyfeed-settings-btn").removeClass("tinyfeed-hidden");
    $("#tinyfeed-back").addClass("tinyfeed-hidden");
    $(".tinyfeed-title").text("TinyForum");
    renderForumList();
}

function openForumThread(id) {
    activeForumThread = id;
    cancelForumReply();
    $("#tinyfeed-forum-list").addClass("tinyfeed-hidden");
    $("#tinyfeed-forum-thread").removeClass("tinyfeed-hidden");
    $("#tinyfeed-home-btn, #tinyfeed-settings-btn").addClass("tinyfeed-hidden");
    $("#tinyfeed-back").removeClass("tinyfeed-hidden");
    const t = getForum().find((x) => x.id === id);
    $(".tinyfeed-title").text(t ? t.room : "กระทู้");
    renderForumThread(id);
    saveLastScreen();
}

function switchForumSort(sort) {
    forumSort = sort === "hot" ? "hot" : "latest";
    $(".tinyfeed-tab[data-fsort]").removeClass("tinyfeed-tab-active");
    $(`.tinyfeed-tab[data-fsort="${forumSort}"]`).addClass("tinyfeed-tab-active");
    renderForumList();
}

function populateForumRoomSelect() {
    const sel = $("#tinyfeed-forum-room");
    sel.html(getForumRooms().map((r) => `<option value="${escapeAttr(r)}">${escapeText(r)}</option>`).join(""));
}

function renderForumList() {
    const box = $("#tinyfeed-forum-threads");
    const threads = getForum();
    if (!threads.length) {
        box.html(emptyStateHtml("fa-comments", "ยังไม่มีกระทู้",
            "ตั้งกระทู้เอง หรือกด “ให้ชาวเน็ตตั้งกระทู้” ให้ AI สร้างจากเนื้อเรื่อง"));
        return;
    }
    const arr = threads.slice();
    if (forumSort === "hot") arr.sort((a, b) => forumScore(b) - forumScore(a));
    box.html(arr.map((t) => `
        <div class="tinyfeed-forum-thread-row" data-id="${escapeAttr(t.id)}">
            <span class="tinyfeed-forum-room-chip">${escapeText(t.room)}</span>
            <div class="tinyfeed-forum-row-title">${renderRich(t.title)}</div>
            <div class="tinyfeed-forum-row-snippet">${escapeText(htmlToPlain(t.body))}</div>
            <div class="tinyfeed-forum-row-meta">
                <span>${escapeText(t.author)}</span>
                <span><i class="fa-solid fa-comment"></i> ${formatCount(forumCommentCount(t))}</span>
                <span><i class="fa-solid fa-heart"></i> ${formatCount(t.likes || 0)}</span>
                <span>${displayTime(t)}</span>
            </div>
        </div>`).join(""));
}

function renderForumCommentRow(t, c) {
    const replies = (c.replies || []).map((r) => `
        <div class="tinyfeed-forum-cmt">
            <div class="tinyfeed-comment">
                ${makeAvatar(r)}
                <div class="tinyfeed-comment-body">
                    <span class="tinyfeed-comment-author">${escapeText(r.author)}</span>
                    <span class="tinyfeed-comment-text">${renderRich(r.text)}</span>
                    <div class="tinyfeed-forum-cmt-actions">
                        <span class="tinyfeed-forum-cmt-like ${r.liked ? "tinyfeed-liked" : ""}" data-tid="${escapeAttr(t.id)}" data-cid="${escapeAttr(c.id)}" data-rid="${escapeAttr(r.id)}"><i class="fa-solid fa-heart"></i> ${formatCount(r.likes || 0)}</span>
                        <span class="tinyfeed-forum-reply-del" data-tid="${escapeAttr(t.id)}" data-cid="${escapeAttr(c.id)}" data-rid="${escapeAttr(r.id)}"><i class="fa-solid fa-trash"></i></span>
                    </div>
                </div>
            </div>
        </div>`).join("");
    return `<div class="tinyfeed-forum-cmt" data-cid="${escapeAttr(c.id)}">
        <div class="tinyfeed-comment">
            ${makeAvatar(c)}
            <div class="tinyfeed-comment-body">
                <span class="tinyfeed-comment-author">${escapeText(c.author)}</span>
                <span class="tinyfeed-comment-text">${renderRich(c.text)}</span>
                <div class="tinyfeed-forum-cmt-actions">
                    <span class="tinyfeed-forum-cmt-like ${c.liked ? "tinyfeed-liked" : ""}" data-tid="${escapeAttr(t.id)}" data-cid="${escapeAttr(c.id)}"><i class="fa-solid fa-heart"></i> ${formatCount(c.likes || 0)}</span>
                    <span class="tinyfeed-forum-cmt-reply" data-tid="${escapeAttr(t.id)}" data-cid="${escapeAttr(c.id)}"><i class="fa-solid fa-reply"></i> ตอบกลับ</span>
                    <span class="tinyfeed-forum-cmt-del" data-tid="${escapeAttr(t.id)}" data-cid="${escapeAttr(c.id)}"><i class="fa-solid fa-trash"></i></span>
                </div>
            </div>
        </div>
        ${replies ? `<div class="tinyfeed-forum-replies">${replies}</div>` : ""}
    </div>`;
}

function renderForumThread(id) {
    const t = getForum().find((x) => x.id === id);
    const box = $("#tinyfeed-forum-thread-body");
    if (!t) { box.html(""); return; }
    const cnt = forumCommentCount(t);
    const bodyHtml = String(t.body || "").split(/\n+/).filter(Boolean).map((p) => `<p>${renderRich(p)}</p>`).join("");
    const comments = t.comments.map((c) => renderForumCommentRow(t, c)).join("");
    box.html(`
        <span class="tinyfeed-forum-room-chip">${escapeText(t.room)}</span>
        <div class="tinyfeed-forum-detail-title">${renderRich(t.title)}</div>
        <div class="tinyfeed-forum-detail-meta">
            ${makeAvatar({ author: t.author, isUser: Boolean(t.isUser), isMain: Boolean(t.isMain) })}
            <span>${escapeText(t.author)}</span> · <span>${displayTime(t)}</span>
        </div>
        <div class="tinyfeed-forum-detail-body">${bodyHtml}</div>
        <div class="tinyfeed-forum-detail-actions">
            <span class="tinyfeed-forum-thread-like ${t.liked ? "tinyfeed-liked" : ""}" data-id="${escapeAttr(t.id)}"><i class="fa-solid fa-heart"></i> ${formatCount(t.likes || 0)}</span>
            <span><i class="fa-solid fa-comment"></i> ${formatCount(cnt)}</span>
            ${(t.isUser || t.isAI) ? `<span class="tinyfeed-forum-thread-del" data-id="${escapeAttr(t.id)}"><i class="fa-solid fa-trash"></i> ลบ</span>` : ""}
        </div>
        <div class="tinyfeed-forum-count">ความคิดเห็น ${cnt} รายการ</div>
        ${comments || `<div class="tinyfeed-empty-sub" style="opacity:.6;padding:8px 0">ยังไม่มีความเห็น — ร่วมแสดงความเห็น หรือกดโหลดคอมเมนต์</div>`}
        <div class="tinyfeed-forum-tools" style="justify-content:center;margin-top:14px">
            <button class="tinyfeed-btn-generate tinyfeed-forum-loadmore" data-id="${escapeAttr(t.id)}">
                <i class="fa-solid fa-comments"></i> <span>โหลดคอมเมนต์เพิ่ม</span>
            </button>
        </div>
    `);
}

// ===== ตัวแก้ห้อง (settings) =====
function renderForumRooms() {
    const rows = getForumRooms().map((r, i) => `
        <div class="tinyfeed-room-row" data-index="${i}">
            <input class="tinyfeed-room-name" type="text" value="${escapeAttr(r)}" placeholder="ชื่อห้อง" />
            <span class="tinyfeed-room-del" title="ลบห้อง"><i class="fa-solid fa-trash"></i></span>
        </div>`).join("");
    $("#tinyfeed-room-list").html(rows);
}

// ตัวแก้หมวดสินค้า (หน้า settings) — โครงเดียวกับห้อง TinyForum
function renderShopCats() {
    const rows = getShopCategories().map((c, i) => `
        <div class="tinyfeed-shopcat-row" data-index="${i}">
            <input class="tinyfeed-shopcat-name" type="text" value="${escapeAttr(c)}" placeholder="ชื่อหมวด" />
            <span class="tinyfeed-shopcat-del" title="ลบหมวด"><i class="fa-solid fa-trash"></i></span>
        </div>`).join("");
    $("#tinyfeed-shop-cat-list").html(rows);
}

// ===== ผู้ใช้ทำเอง =====
function openForumNewForm() {
    const form = $("#tinyfeed-forum-newform");
    const show = form.hasClass("tinyfeed-hidden");
    if (show) {
        populateForumRoomSelect();
        $("#tinyfeed-forum-title").val("");
        $("#tinyfeed-forum-body").val("");
        form.removeClass("tinyfeed-hidden");
    } else {
        form.addClass("tinyfeed-hidden");
    }
}

async function addForumThread() {
    const room = String($("#tinyfeed-forum-room").val() || getForumRooms()[0] || "ทั่วไป");
    const title = String($("#tinyfeed-forum-title").val() || "").trim();
    const body = String($("#tinyfeed-forum-body").val() || "").trim();
    if (!title) { toastr.info("ใส่หัวข้อกระทู้ก่อนนะ", "TinyForum"); return; }
    const thread = {
        id: forumId("ft"), room: escapeText(room), title: escapeHtml(title), body: escapeHtml(body || title),
        author: getUserName(), isUser: true, likes: randomInitialLikes(), liked: false, ts: Date.now(), comments: [],
    };
    getForum().unshift(thread);
    saveFeedData();
    $("#tinyfeed-forum-newform").addClass("tinyfeed-hidden");
    openForumThread(thread.id);
    updateChatInjection();
    await loadForumComments(thread.id, { silent: true });   // ให้ชาวเน็ตแห่มาคอมเมนต์
}

async function addForumComment(threadId, text) {
    const clean = String(text || "").trim();
    if (!clean) return;
    const t = getForum().find((x) => x.id === threadId);
    if (!t) return;
    t.comments.push({ id: forumId("fc"), author: getUserName(), isUser: true, avatar: "", text: escapeHtml(clean), likes: randomInitialLikes(), liked: false, ts: Date.now(), replies: [] });
    saveFeedData();
    $("#tinyfeed-forum-comment-input").val("");
    renderForumThread(threadId);
    updateChatInjection();
}

function addForumReply(threadId, cid, text) {
    const clean = String(text || "").trim();
    if (!clean) return;
    const t = getForum().find((x) => x.id === threadId);
    const c = t && t.comments.find((x) => x.id === cid);
    if (!c) return;
    if (!Array.isArray(c.replies)) c.replies = [];
    c.replies.push({ id: forumId("fr"), author: getUserName(), isUser: true, avatar: "", text: escapeHtml(clean), likes: randomInitialLikes(), liked: false, ts: Date.now() });
    cancelForumReply();
    saveFeedData();
    renderForumThread(threadId);
    updateChatInjection();
}

// เริ่มตอบกลับคอมเมนต์ → โชว์แถบ "กำลังตอบกลับ" เหนือช่องพิมพ์ + โฟกัสช่องพิมพ์ล่าง
function startForumReply(cid) {
    const t = getForum().find((x) => x.id === activeForumThread);
    const c = t && t.comments.find((x) => x.id === cid);
    if (!c) return;
    forumReplyingTo = cid;
    $("#tinyfeed-forum-reply-name").text(c.author);
    $("#tinyfeed-forum-reply-banner").removeClass("tinyfeed-hidden");
    $("#tinyfeed-forum-comment-input").attr("placeholder", `ตอบกลับ ${c.author}...`).trigger("focus");
}

function cancelForumReply() {
    forumReplyingTo = null;
    $("#tinyfeed-forum-reply-banner").addClass("tinyfeed-hidden");
    $("#tinyfeed-forum-comment-input").attr("placeholder", "ร่วมแสดงความเห็น...");
}

// ส่งจากช่องพิมพ์ล่าง — ถ้ากำลังตอบกลับก็ลงเป็น reply ไม่งั้นเป็นคอมเมนต์ชั้นบน
function sendForumFromComposer(text) {
    const clean = String(text || "").trim();
    if (!clean || !activeForumThread) return;
    if (forumReplyingTo) {
        const cid = forumReplyingTo;
        $("#tinyfeed-forum-comment-input").val("");
        addForumReply(activeForumThread, cid, clean);
    } else {
        addForumComment(activeForumThread, clean);
    }
}

function deleteForumComment(tid, cid) {
    const t = getForum().find((x) => x.id === tid);
    if (!t) return;
    const c = t.comments.find((x) => x.id === cid);
    if (!c) return;
    if (!confirm("ต้องการลบความคิดเห็นนี้ใช่ไหม?")) return;
    t.comments.splice(t.comments.indexOf(c), 1);
    if (forumReplyingTo === cid) cancelForumReply();
    saveFeedData();
    renderForumThread(tid);
    updateChatInjection();
}

function deleteForumReply(tid, cid, rid) {
    const t = getForum().find((x) => x.id === tid);
    const c = t && t.comments.find((x) => x.id === cid);
    if (!c || !Array.isArray(c.replies)) return;
    const r = c.replies.find((x) => x.id === rid);
    if (!r) return;
    if (!confirm("ต้องการลบการตอบกลับนี้ใช่ไหม?")) return;
    c.replies.splice(c.replies.indexOf(r), 1);
    saveFeedData();
    renderForumThread(tid);
    updateChatInjection();
}

function toggleForumThreadLike(id) {
    const t = getForum().find((x) => x.id === id);
    if (!t) return;
    t.liked = !t.liked;
    t.likes = (Number(t.likes) || 0) + (t.liked ? 1 : -1);
    saveFeedData();
    renderForumThread(id);
}

function toggleForumCommentLike(tid, cid, rid) {
    const t = getForum().find((x) => x.id === tid);
    const c = t && t.comments.find((x) => x.id === cid);
    if (!c) return;
    const target = rid ? (c.replies || []).find((x) => x.id === rid) : c;
    if (!target) return;
    target.liked = !target.liked;
    target.likes = (Number(target.likes) || 0) + (target.liked ? 1 : -1);
    saveFeedData();
    renderForumThread(tid);
}

function deleteForumThread(id) {
    const forum = getForum();
    const t = forum.find((x) => x.id === id);
    if (!t || !(t.isUser || t.isAI)) return;
    if (!confirm("ต้องการลบกระทู้นี้ใช่ไหม?")) return;
    const i = forum.indexOf(t);
    forum.splice(i, 1);
    saveFeedData();
    openForumList();
    updateChatInjection();
}

// ===== AI: ตั้งกระทู้ + โหลดคอมเมนต์ =====
function parseForumComments(raw, charName) {
    const s = stripReasoning(raw);
    const clean = (name) => String(name || "").replace(/^["'“”\[\(]+|["'“”\]\)]+$/g, "").trim() || charName;
    const tops = [], replies = [];
    for (const line of s.split("\n")) {
        const l = line.trim();
        let m;
        if ((m = l.match(/^COMMENT:\s*(.+)$/i))) {
            const parts = m[1].split("|");
            if (parts.length >= 2) tops.push({ author: clean(parts[0]), text: parts.slice(1).join("|").trim() });
            else tops.push({ author: charName, text: parts[0].trim() });
        } else if ((m = l.match(/^REPLY:\s*(.+)$/i))) {
            const parts = m[1].split("|");
            if (parts.length >= 3) {
                const n = parseInt(parts[0], 10);
                if (Number.isFinite(n)) replies.push({ n, author: clean(parts[1]), text: parts.slice(2).join("|").trim() });
            }
        }
    }
    return { tops: tops.filter((t) => t.text), replies: replies.filter((r) => r.text && r.n) };
}

function makeForumComment(author, text, charName) {
    return { ...makeCommentObj(author, text, charName), id: forumId("fc"), likes: randomInitialLikes(), liked: false, ts: Date.now(), replies: [] };
}

async function generateForumThread(opts) {
    opts = opts || {};
    if (isForumBusy) return;
    const ctx = getContext();
    if (typeof ctx.generateQuietPrompt !== "function") {
        if (!opts.silent) toastr.error("เวอร์ชัน SillyTavern นี้ไม่มี generateQuietPrompt", "TinyForum");
        return;
    }
    const char = getCurrentCharacter();
    if (!char) { if (!opts.silent) toastr.info("เปิดแชทที่มีตัวละครก่อนนะ", "TinyForum"); return; }
    const charName = getCharName();
    isForumBusy = true;
    const btn = $("#tinyfeed-forum-generate");
    btn.addClass("tinyfeed-generating").prop("disabled", true);
    try {
        const rooms = getForumRooms();
        const extra = String(getSetting("forumExtraPrompt") || "").trim();
        const q = buildPrompt("forumThread", {
            rooms: rooms.join(", "),
            roster: npcRosterLine(charName),
            extra: extra ? `คำสั่งเพิ่มเติม: ${extra}. ` : "",
            context: crossAppContext("forum"),
        });
        const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("forumTokens"), 10) || 500), "forum");
        const s = stripReasoning(raw);
        const grab = (re) => { const m = s.match(re); return m ? m[1].trim() : ""; };
        let room = grab(/ROOM:\s*(.+)/i);
        let author = grab(/AUTHOR:\s*(.+)/i);
        let title = grab(/TITLE:\s*(.+)/i);
        const bodyM = s.match(/BODY:\s*([\s\S]+?)(?:\nCOMMENT:|$)/i);
        let body = bodyM ? bodyM[1].trim() : "";
        if (!title) { if (!opts.silent) toastr.warning("AI ไม่ได้ส่งกระทู้กลับมา ลองใหม่นะ", "TinyForum"); return; }
        if (!rooms.some((r) => r.toLowerCase() === room.toLowerCase())) room = rooms[0] || "ทั่วไป";
        author = author.replace(/^["'“”\[\(]+|["'“”\]\)]+$/g, "").trim() || charName;
        const seeds = parseForumComments(s, charName).tops.slice(0, 6).map((c) => makeForumComment(c.author, c.text, charName));
        const thread = {
            id: forumId("ft"), room: escapeText(room), title: escapeHtml(title), body: escapeHtml(body || title),
            author, isAI: true, likes: randomInitialLikes(), liked: false, ts: Date.now(), comments: seeds,
        };
        getForum().unshift(thread);
        saveFeedData();
        if (currentApp === "forum" && !isForumThreadOpen()) renderForumList();
        updateChatInjection();
        if (opts.notify) showNotif(makeAnonAvatar(thread.room), thread.room, htmlToPlain(thread.title), "list", "forum");
    } catch (e) {
        console.error(`[${extensionName}] generate forum thread failed:`, e);
        if (!opts.silent) toastr.error("สร้างกระทู้ไม่สำเร็จ ลองใหม่นะ", "TinyForum");
    } finally {
        isForumBusy = false;
        btn.removeClass("tinyfeed-generating").prop("disabled", false);
    }
}

async function loadForumComments(threadId, opts) {
    opts = opts || {};
    if (isForumBusy) return;
    const t = getForum().find((x) => x.id === threadId);
    if (!t) return;
    const ctx = getContext();
    if (typeof ctx.generateQuietPrompt !== "function") {
        if (!opts.silent) toastr.error("เวอร์ชัน SillyTavern นี้ไม่มี generateQuietPrompt", "TinyForum");
        return;
    }
    const char = getCurrentCharacter();
    const charName = getCharName();
    isForumBusy = true;
    const btn = $(`.tinyfeed-forum-loadmore[data-id="${threadId}"]`);
    btn.addClass("tinyfeed-generating").prop("disabled", true);
    try {
        const batch = Math.max(1, parseInt(getSetting("forumCommentBatch"), 10) || 8);
        // แนบทั้งคอมเมนต์ชั้นบน (มีเลข) + การตอบกลับ (เยื้อง) เพื่อให้ AI เห็นครบ ไม่ข้าม/ซ้ำ
        const existing = t.comments.map((c, i) => {
            let block = `[${i + 1}] ${c.author}: ${htmlToPlain(c.text)}`;
            const rs = (c.replies || []).map((r) => `      ↳ ${r.author}: ${htmlToPlain(r.text)}`);
            if (rs.length) block += `\n${rs.join("\n")}`;
            return block;
        }).join("\n");
        const extra = String(getSetting("forumExtraPrompt") || "").trim();
        const q = buildPrompt("forumComments", {
            room: htmlToPlain(t.room), title: htmlToPlain(t.title), body: htmlToPlain(t.body), batch: batch,
            roster: npcRosterLine(charName),
            extra: (extra ? ` คำสั่งเพิ่มเติม: ${extra}.` : "") + galleryPromptBlock(),
            existing: existing ? `\nคอมเมนต์ที่มีอยู่แล้ว (อ้างเลขเพื่อตอบกลับได้ อย่าเขียนซ้ำ):\n${existing}\n` : "",
            context: crossAppContext("forum"),
        });
        const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("forumTokens"), 10) || 500), "forum");
        const { tops, replies } = parseForumComments(raw, charName);
        let n = 0;
        for (const c of tops) { t.comments.push(makeForumComment(c.author, c.text, charName)); n++; }
        for (const r of replies) {
            const target = t.comments[r.n - 1];
            if (target) {
                if (!Array.isArray(target.replies)) target.replies = [];
                target.replies.push({ ...makeCommentObj(r.author, r.text, charName), id: forumId("fr"), likes: randomInitialLikes(), liked: false, ts: Date.now() });
                n++;
            }
        }
        if (n) {
            saveFeedData();
            if (activeForumThread === threadId) renderForumThread(threadId);
            if (currentApp === "forum" && !isForumThreadOpen()) renderForumList();
            updateChatInjection();
        } else if (!opts.silent) {
            toastr.info("ยังไม่มีคอมเมนต์เพิ่ม ลองใหม่ได้", "TinyForum");
        }
    } catch (e) {
        console.error(`[${extensionName}] load forum comments failed:`, e);
        if (!opts.silent) toastr.error("โหลดคอมเมนต์ไม่สำเร็จ ลองใหม่นะ", "TinyForum");
    } finally {
        isForumBusy = false;
        $(`.tinyfeed-forum-loadmore[data-id="${threadId}"]`).removeClass("tinyfeed-generating").prop("disabled", false);
    }
}

// ===== Stage 7: auto-generate เมื่อมีเหตุการณ์ในแชท =====
let autoMsgCount = 0;    // ตัวนับข้อความสำหรับโพสต์ (รีเซ็ตเมื่อสลับแชท)
let autoNewsCount = 0;   // ตัวนับข้อความสำหรับข่าว
let autoMemoCount = 0;   // ตัวนับข้อความสำหรับ TinyMemo
let autoForumCount = 0;  // ตัวนับข้อความสำหรับ TinyForum
let autoConnectCount = 0; // ตัวนับข้อความสำหรับ TinyConnect (คู่แชททักเอง)
let isAutoBusy = false;  // กันลำดับ auto ซ้อนกัน

// ถาม AI แบบเงียบว่าควรมีโพสต์ใหม่ตอนนี้ไหม (โหมด ai)
async function aiDecidesToPost() {
    try {
        const ctx = getContext();
        const q =
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง ไม่ต้องสวมบทบาท] ` +
            `พิจารณาสถานการณ์ล่าสุดในเนื้อเรื่อง: ถ้ามีเหตุการณ์ อารมณ์ ความรู้สึก หรือประเด็นที่ตัวละครหรือ NPC ` +
            `น่าจะอยากแชร์ลงโซเชียลมีเดีย ให้ตอบว่า YES ` +
            `ถ้าตอนนี้ยังเงียบหรือไม่มีอะไรน่าโพสต์ ให้ตอบว่า NO ` +
            `ตอบเป็นคำเดียวเท่านั้น: YES หรือ NO`;
        const res = await tinyGenerate(q, 120);
        const s = stripReasoning(res).toLowerCase();
        // เช็ค "ไม่" ก่อน (กันคำว่า no/ไม่ควร/ไม่โพสต์) แล้วค่อยเช็คฝั่งบวก
        if (/\bno\b/.test(s) || s.includes("ไม่")) return false;
        if (/\byes\b/.test(s) || s.includes("ควร") || s.includes("ใช่")) return true;
        return false;
    } catch (e) {
        console.error(`[${extensionName}] aiDecidesToPost failed:`, e);
        return false;
    }
}

// เรียกทุกครั้งที่มีข้อความใหม่ในแชท (ผู้ใช้ส่ง/AI ตอบ)
// ── ทริกเกอร์ด้วยคีย์เวิร์ด ──
const KEYWORD_SETTING = { feed: "feedKeywords", news: "newsKeywords", memo: "memoKeywords", forum: "forumKeywords", connect: "connectKeywords" };
const kwCooldownAt = { feed: 0, news: 0, memo: 0, forum: 0, connect: 0 };

function keywordListFor(app) {
    return String(getSetting(KEYWORD_SETTING[app]) || "")
        .split(/[,\n]/).map((k) => k.trim().toLowerCase()).filter(Boolean);
}
// ข้อความ RP ล่าสุด (ที่เพิ่งส่ง/รับ) + ฝั่งผู้ส่ง (is_user)
function lastRpMsg() {
    try {
        const c = getContext().chat;
        if (Array.isArray(c) && c.length) {
            const m = c[c.length - 1];
            return { text: String(m.mes || ""), isUser: !!m.is_user };
        }
    } catch (e) { /* ข้าม */ }
    return null;
}
function lastRpText() { const m = lastRpMsg(); return m ? m.text : ""; }
// คืน true = เจอคีย์เวิร์ด (ในฝั่งที่เลือกจับ) + พ้น cooldown แล้ว (แล้วจับเวลา cooldown ใหม่)
function keywordShouldTrigger(app) {
    const list = keywordListFor(app);
    if (!list.length) return false;
    const msg = lastRpMsg();
    if (!msg) return false;
    // ขอบเขตฝั่งที่จับ: char = เฉพาะข้อความตัวละคร, user = เฉพาะผู้ใช้, both = ทั้งคู่
    const scope = getSetting("keywordScope") || "both";
    if (scope === "char" && msg.isUser) return false;
    if (scope === "user" && !msg.isUser) return false;
    const text = String(msg.text || "").toLowerCase();
    if (!text || !list.some((k) => text.includes(k))) return false;
    const cd = Math.max(0, parseInt(getSetting("keywordCooldownSec"), 10) || 0) * 1000;
    const now = Date.now();
    if (now - (kwCooldownAt[app] || 0) < cd) return false;
    kwCooldownAt[app] = now;
    return true;
}

// ตัดสินใจว่าคู่แชทควรทักหาเราตอนนี้ไหม (โหมด "ai" ของ TinyConnect auto)
async function aiDecidesConnect() {
    try {
        const q =
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง ไม่ต้องสวมบทบาท] ` +
            `พิจารณาสถานการณ์ล่าสุด: มีเหตุผลที่ตัวละครหรือคนรู้จักคนใดคนหนึ่งน่าจะส่งข้อความแชต (ไลน์) มาหาผู้ใช้ตอนนี้ไหม ` +
            `ถ้ามีตอบ YES ถ้ายังไม่มีตอบ NO ตอบคำเดียว: YES หรือ NO`;
        const res = await tinyGenerate(q, 120, "connect");
        const s = stripReasoning(res).toLowerCase();
        if (/\bno\b/.test(s) || s.includes("ไม่")) return false;
        if (/\byes\b/.test(s) || s.includes("ใช่") || s.includes("ควร")) return true;
        return false;
    } catch (e) {
        console.error(`[${extensionName}] aiDecidesConnect failed:`, e);
        return false;
    }
}

async function onChatMessage() {
    lastRpMsgTs = Date.now();   // มี RP activity → รีเซ็ตตัวจับเวลา idle
    petOnRpMessage();           // เอ่ยถึงเพ็ทในบท → ความผูกพันขึ้น (global, ไม่ขึ้นกับ auto)
    if (isAutoBusy || isGenerating || isGeneratingNews) return;
    if (!getCurrentCharacter()) return;

    // ลำดับความสำคัญ: ฟีด → เมโม → ฟอรัม → ข่าว (สร้างได้ทีละแอปต่อข้อความ กัน generate ซ้อน)
    const apps = [
        { on: "autoGenerate", mode: "autoGenerateMode", interval: "autoGenerateInterval", defInt: 10, kw: "feed",
            bump: () => ++autoMsgCount, get: () => autoMsgCount, reset: () => { autoMsgCount = 0; },
            decide: aiDecidesToPost, run: () => generateFeedPost({ notify: true, silent: true }) },
        { on: "connectAutoGenerate", mode: "connectAutoMode", interval: "connectAutoInterval", defInt: 12, kw: "connect",
            bump: () => ++autoConnectCount, get: () => autoConnectCount, reset: () => { autoConnectCount = 0; },
            decide: aiDecidesConnect, run: () => proactiveDM() },
        { on: "memoAutoGenerate", mode: "memoAutoMode", interval: "memoAutoInterval", defInt: 15, kw: "memo",
            bump: () => ++autoMemoCount, get: () => autoMemoCount, reset: () => { autoMemoCount = 0; },
            decide: aiDecidesMemo, run: () => scanMemo({ notify: true, silent: true }) },
        { on: "forumAutoGenerate", mode: "forumAutoMode", interval: "forumAutoInterval", defInt: 20, kw: "forum",
            bump: () => ++autoForumCount, get: () => autoForumCount, reset: () => { autoForumCount = 0; },
            decide: aiDecidesToPost, run: () => generateForumThread({ notify: true, silent: true }) },
        { on: "newsAutoGenerate", mode: "newsAutoMode", interval: "newsAutoInterval", defInt: 20, kw: "news",
            bump: () => ++autoNewsCount, get: () => autoNewsCount, reset: () => { autoNewsCount = 0; },
            decide: aiDecidesToPost, run: () => generateNews({ notify: true, silent: true }) },
    ];

    // นับตัวนับก่อน (เฉพาะโหมด interval/ai) — คงพฤติกรรมเดิมที่ทุกแอปนับทุกข้อความ
    for (const a of apps) {
        if (!getSetting(a.on)) continue;
        if ((getSetting(a.mode) || "interval") === "keyword") continue;
        a.bump();
    }

    for (const a of apps) {
        if (!getSetting(a.on)) continue;
        const mode = getSetting(a.mode) || "interval";
        if (mode === "keyword") {
            if (!keywordShouldTrigger(a.kw)) continue;
            isAutoBusy = true;
            try { await a.run(); } finally { isAutoBusy = false; }
            return;
        }
        // interval / ai
        const interval = Math.max(1, parseInt(getSetting(a.interval), 10) || a.defInt);
        if (a.get() >= interval) {
            a.reset();
            isAutoBusy = true;
            try {
                if (mode === "ai" && !(await a.decide())) return;
                await a.run();
            } finally { isAutoBusy = false; }
            return;
        }
    }
}

// ===== แจ้งเตือนสไตล์โทรศัพท์ (push banner + ลิ้นชัก + OS) =====
let notifTimer = null;
let lastNotifEntry = null;        // แจ้งเตือนล่าสุด (สำหรับกด banner)
let unreadCount = 0;              // badge ปุ่มเมนู (นอกเครื่อง)
let notifBellUnread = 0;          // badge กระดิ่งในเครื่อง
const notifLog = [];              // ประวัติแจ้งเตือน (cap 30)

// เพิ่มจุดแดง + สั่นปุ่มเมนู เมื่อมีของใหม่
function markUnread() {
    unreadCount++;
    const badge = $("#tinyfeed-menu-badge");
    badge.text(unreadCount > 99 ? "99+" : unreadCount).removeClass("tinyfeed-hidden");
    const btn = $("#tinyfeed-menu-button");
    btn.removeClass("tinyfeed-shake");
    // reflow เพื่อรีสตาร์ท animation
    void btn[0]?.offsetWidth;
    btn.addClass("tinyfeed-shake");
    setTimeout(() => btn.removeClass("tinyfeed-shake"), 700);
}

// เคลียร์จุดแดงเมื่อเปิดดูแล้ว
function clearUnread() {
    unreadCount = 0;
    $("#tinyfeed-menu-badge").text("").addClass("tinyfeed-hidden");
}

// โหลด notifLog จาก settings ตอน init (persist ข้ามการ reload แท็บ)
function loadNotifLog() {
    try {
        const saved = getSetting("notifLog");
        if (Array.isArray(saved)) { notifLog.length = 0; notifLog.push(...saved.slice(0, 30)); }
    } catch (e) { /* ข้าม */ }
    recomputeBellUnread();
}
function persistNotifLog() {
    setSetting("notifLog", notifLog.slice(0, 30));
}
function recomputeBellUnread() {
    const seen = parseInt(getSetting("notifSeenTs"), 10) || 0;
    notifBellUnread = notifLog.filter((e) => (e.ts || 0) > seen).length;
    updateNotifBell();
}

function updateNotifBell() {
    const b = $("#tinyfeed-notif-bell-badge");
    if (notifBellUnread > 0) b.text(notifBellUnread > 99 ? "99+" : notifBellUnread).removeClass("tinyfeed-hidden");
    else b.text("").addClass("tinyfeed-hidden");
}

// เช็คว่าแจ้งเตือน OS ใช้ได้ไหม — คืน "" ถ้าโอเค, หรือข้อความสาเหตุถ้าใช้ไม่ได้
function osNotifBlockReason() {
    if (typeof Notification === "undefined") return "เบราว์เซอร์นี้ไม่รองรับแจ้งเตือน OS";
    // Notification ต้องอยู่ใน secure context (https หรือ localhost) — ST ผ่าน http แบบ LAN IP จะถูกบล็อก
    if (typeof window !== "undefined" && window.isSecureContext === false) {
        return "แจ้งเตือน OS ต้องเปิดผ่าน HTTPS หรือ http://localhost เท่านั้น (ตอนนี้เปิดผ่าน IP/HTTP ธรรมดา เบราว์เซอร์จึงบล็อก)";
    }
    if (Notification.permission === "denied") return "เบราว์เซอร์บล็อกแจ้งเตือนของเว็บนี้ไว้ — ไปเปิดสิทธิ์ Notifications ของเว็บนี้ในตั้งค่าเบราว์เซอร์";
    return "";
}

// ขอสิทธิ์ + รายงานผลให้ผู้ใช้รู้ (เรียกตอนเปิด toggle)
function ensureNotifPermission() {
    const reason = osNotifBlockReason();
    if (reason && Notification && Notification.permission !== "default") { toastr.warning(reason, "TinyPhone"); return; }
    if (typeof Notification === "undefined") { toastr.warning("เบราว์เซอร์นี้ไม่รองรับแจ้งเตือน OS", "TinyPhone"); return; }
    if (Notification.permission === "granted") { toastr.success("อนุญาตแจ้งเตือน OS แล้ว", "TinyPhone"); return; }
    try {
        Notification.requestPermission().then((p) => {
            if (p === "granted") toastr.success("อนุญาตแจ้งเตือน OS แล้ว — ลองกด “ทดสอบ” ดูได้", "TinyPhone");
            else toastr.info("ยังไม่ได้อนุญาตแจ้งเตือน OS", "TinyPhone");
        }).catch(() => { /* ข้าม */ });
    } catch (e) { /* บางเบราว์เซอร์เก่าใช้ callback — ข้าม */ }
}

// ลงทะเบียน service worker (มือถือต้องใช้ยิงแจ้งเตือน)
let swReg = null;
function registerNotifSW() {
    try {
        if (!("serviceWorker" in navigator)) return;
        navigator.serviceWorker.register(`${extensionFolderPath}/sw.js`)
            .then((reg) => { swReg = reg; })
            .catch((e) => console.warn(`[${extensionName}] SW register failed:`, e));
    } catch (e) { /* ข้าม */ }
}

// ยิงแจ้งเตือน OS: มือถือใช้ service worker · เดสก์ท็อป fallback เป็น new Notification()
function deliverOsNotif(title, opts) {
    if (swReg && swReg.showNotification) {
        return swReg.showNotification(title, opts).then(() => true).catch(() => plainNotif(title, opts));
    }
    return Promise.resolve(plainNotif(title, opts));
}
function plainNotif(title, opts) {
    try {
        const n = new Notification(title, opts);
        n.onclick = () => { try { window.focus(); } catch (e) { /* ข้าม */ } if (lastNotifEntry) routeFromNotif(lastNotifEntry); };
        return true;
    } catch (e) { console.warn(`[${extensionName}] Notification failed:`, e); return false; }
}

function fireOsNotif(title, body) {
    if (!getSetting("osNotifEnabled")) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    deliverOsNotif(title || "TinyPhone", { body: String(body || "").slice(0, 120), tag: "tinyphone" });
}

// ปุ่มทดสอบแจ้งเตือน OS — วินิจฉัยว่าใช้ได้/ติดตรงไหน
function testOsNotif() {
    const reason = osNotifBlockReason();
    const fire = () => {
        deliverOsNotif("TinyPhone", { body: "ทดสอบแจ้งเตือน OS สำเร็จ ✅", tag: "tinyphone-test" })
            .then((ok) => {
                if (ok) toastr.success("ส่งแจ้งเตือนทดสอบแล้ว — ดูที่ศูนย์แจ้งเตือน/มุมจอ (ถ้าไม่เห็น เช็ค Do Not Disturb ของ OS)", "TinyPhone");
                else toastr.error("ยิงแจ้งเตือนไม่สำเร็จ — ลองรีเฟรชหน้าแล้วลองใหม่ (service worker อาจยังไม่พร้อม)", "TinyPhone");
            });
    };
    if (typeof Notification === "undefined") { toastr.warning("เบราว์เซอร์นี้ไม่รองรับแจ้งเตือน OS", "TinyPhone"); return; }
    if (reason) { toastr.warning(reason, "TinyPhone"); return; }
    if (Notification.permission === "granted") fire();
    else Notification.requestPermission().then((p) => { if (p === "granted") fire(); else toastr.info("ยังไม่ได้อนุญาตแจ้งเตือน OS", "TinyPhone"); }).catch(() => {});
}

// แสดงแบนเนอร์ + เก็บลิ้นชัก + ยิง OS (ระบุ tab/app/key/name ที่จะเปิดเมื่อกด)
function showNotif(avatarHtml, author, text, tab, app, key, name) {
    if (!getSetting("notificationsEnabled")) return;   // ปิดแจ้งเตือน = ไม่ทำอะไร
    markUnread();
    const entry = {
        avatar: avatarHtml, author: author || "", text: String(text || "").slice(0, 140),
        tab: tab || "feed", app: app || "feed", key: key || null, name: name || "", ts: Date.now(),
    };
    lastNotifEntry = entry;
    notifLog.unshift(entry);
    if (notifLog.length > 30) notifLog.length = 30;
    persistNotifLog();
    notifBellUnread++;
    updateNotifBell();
    const notif = $("#tinyfeed-notif");
    notif.find(".tinyfeed-notif-avatar").html(avatarHtml);
    notif.find(".tinyfeed-notif-author").text(author || "");
    notif.find(".tinyfeed-notif-text").text(entry.text.slice(0, 90));
    notif.addClass("tinyfeed-notif-show");
    try { if (navigator.vibrate) navigator.vibrate(40); } catch (e) { /* ไม่รองรับก็ข้าม */ }
    clearTimeout(notifTimer);
    notifTimer = setTimeout(dismissNotif, 8000);
    fireOsNotif(author || "TinyPhone", entry.text);
}

function showPushNotification(post) {
    showNotif(makeAvatar(post), post.author, htmlToPlain(post.text), "feed");
}

function dismissNotif() {
    $("#tinyfeed-notif").removeClass("tinyfeed-notif-show");
}

// route ไปแอป/ห้องที่เกี่ยวข้องกับแจ้งเตือน (ใช้ทั้ง banner, OS, ลิ้นชัก)
function routeFromNotif(e) {
    dismissNotif();
    openPhone();
    if (e.app === "memo") {
        openApp("memo");
        switchMemoTab(e.tab === "notes" ? "notes" : "agenda");
    } else if (e.app === "forum") {
        openApp("forum");
    } else if (e.app === "connect") {
        openApp("connect");
        if (e.key) openThread(e.key, e.name || e.author);
    } else if (e.app === "pet") {
        openApp("pet");
    } else {
        openApp("feed");
        switchTab(e.tab || "feed");
    }
}

// กด banner แจ้งเตือน
function openFeedFromNotif() {
    if (lastNotifEntry) routeFromNotif(lastNotifEntry);
    else { dismissNotif(); openPhone(); openApp("feed"); }
}

// ลิ้นชักแจ้งเตือน
function renderNotifDrawer() {
    const box = $("#tinyfeed-notif-drawer-list");
    if (!notifLog.length) {
        box.html(emptyInlineHtml("ยังไม่มีแจ้งเตือน"));
        return;
    }
    box.html(notifLog.map((e, i) => `
        <div class="tinyfeed-notif-item" data-idx="${i}">
            <div class="tinyfeed-notif-item-avatar">${e.avatar}</div>
            <div class="tinyfeed-notif-item-body">
                <div class="tinyfeed-notif-item-author">${escapeText(e.author)}</div>
                <div class="tinyfeed-notif-item-text">${escapeText(e.text)}</div>
                <div class="tinyfeed-notif-item-time">${timeAgo(e.ts)}</div>
            </div>
        </div>`).join(""));
}

function toggleNotifDrawer(show) {
    const d = $("#tinyfeed-notif-drawer");
    const willShow = (show === undefined) ? d.hasClass("tinyfeed-hidden") : show;
    if (willShow) {
        renderNotifDrawer();
        d.removeClass("tinyfeed-hidden");
        setSetting("notifSeenTs", Date.now());   // เปิดดูแล้ว → เคลียร์ badge
        notifBellUnread = 0;
        updateNotifBell();
    } else {
        d.addClass("tinyfeed-hidden");
    }
}

// ===== ทักเชิงรุก (proactive) + กลุ่มคุยกันเอง =====
let proactiveTimer = null;
let lastProactiveTs = 0;
let lastRpMsgTs = Date.now();   // เวลาข้อความ RP ล่าสุด (สำหรับโหมด idle)

// มีการ generate อื่นค้างอยู่ไหม (กันชนกับ RP/แอปอื่น)
function proactiveBusy() {
    return isAutoBusy || isGenerating || isGeneratingNews || isConnectReplying || isGeneratingStream || isMemoBusy || isForumBusy;
}

// อยู่ในช่วงเวลาเงียบไหม (รองรับข้ามเที่ยงคืน)
function inQuietHours() {
    const from = ((parseInt(getSetting("proactiveQuietFrom"), 10) || 0) % 24 + 24) % 24;
    const to = ((parseInt(getSetting("proactiveQuietTo"), 10) || 0) % 24 + 24) % 24;
    if (from === to) return false;
    const h = new Date().getHours();
    return from < to ? (h >= from && h < to) : (h >= from || h < to);
}

function startProactiveTimer() {
    if (proactiveTimer) return;
    proactiveTimer = setInterval(proactiveTick, 60000);   // ตรวจทุก 1 นาที
}
function stopProactiveTimer() {
    if (proactiveTimer) { clearInterval(proactiveTimer); proactiveTimer = null; }
}

async function proactiveTick() {
    if (!getSetting("proactiveEnabled")) return;
    if (proactiveBusy() || !getCurrentCharacter() || inQuietHours()) return;
    // โหมด idle: ทักเฉพาะเมื่อผู้ใช้เงียบ RP นานพอ
    const idleMin = parseInt(getSetting("proactiveIdleMin"), 10) || 0;
    if (idleMin > 0 && (Date.now() - lastRpMsgTs) < idleMin * 60000) return;
    const gap = Math.max(1, parseInt(getSetting("proactiveIntervalMin"), 10) || 20) * 60000;
    if (Date.now() - lastProactiveTs < gap) return;
    lastProactiveTs = Date.now();   // นับเวลาใหม่ทุกครั้งที่ถึงรอบ (แม้พลาดโอกาส)
    const chance = Math.max(0, Math.min(100, parseInt(getSetting("proactiveChance"), 10) || 50));
    if (Math.random() * 100 >= chance) return;
    // เลือก action จากสไตล์ที่เปิด: กลุ่มคุยกันเอง / โพสต์ฟีด / DM ทัก
    const groups = getSetting("groupAutoChat")
        ? getConnectGroups().filter((g) => (getThread("group:" + g.id) || []).length)
        : [];
    if (groups.length && Math.random() < 0.4) {
        await groupSelfChat("group:" + groups[Math.floor(Math.random() * groups.length)].id, { notify: true, silent: true });
    } else if (getSetting("proactiveViaFeed") && Math.random() < 0.5) {
        await generateFeedPost({ notify: true, silent: true });   // ทักผ่านฟีดแทน DM
    } else {
        await proactiveDM();
    }
}

// บริบทช่วงเวลาจริง (สำหรับโหมด time-aware)
function timeOfDayPhrase() {
    const h = new Date().getHours();
    if (h < 5) return "ตอนนี้ดึกมากแล้ว (หลังเที่ยงคืน)";
    if (h < 11) return "ตอนนี้เป็นช่วงเช้า";
    if (h < 14) return "ตอนนี้เป็นช่วงเที่ยง";
    if (h < 18) return "ตอนนี้เป็นช่วงบ่าย";
    if (h < 22) return "ตอนนี้เป็นช่วงเย็น/หัวค่ำ";
    return "ตอนนี้เป็นช่วงกลางคืน";
}

// ตัวละคร/NPC ทักผู้ใช้ขึ้นมาเอง (DM)
async function proactiveDM() {
    const contacts = getConnectContacts();
    if (!contacts.length) return;
    const c = contacts[Math.floor(Math.random() * contacts.length)];
    const you = getUserName();
    const recent = getThread(c.key).slice(-6)
        .map((m) => `${m.from === "user" ? you : c.name}: ${htmlToPlain(m.text)}`).join("\n");
    const extra = String(getSetting("connectExtraPrompt") || "").trim();
    const timeLine = getSetting("proactiveTimeAware") ? `${timeOfDayPhrase()} (อ้างอิงช่วงเวลาได้ตามเหมาะสม).\n` : "";
    const q =
        `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] ในบทบาทของ ${c.name} ส่งข้อความแชตทักหา ${you} ขึ้นมาเอง ` +
        `(เหมือนส่งไลน์มาหาเฉยๆ) ให้เข้ากับความสัมพันธ์/สถานการณ์ในเนื้อเรื่องตอนนี้ สั้นเป็นธรรมชาติ 1-2 ประโยค ` +
        `ห้ามพูดหรือกระทำแทน ${you}.\n` +
        timeLine +
        (extra ? `คำสั่งเพิ่มเติม: ${extra}.\n` : "") +
        (recent ? `บทแชตล่าสุด:\n${recent}\n` : "") +
        `ตอบเฉพาะข้อความของ ${c.name} เท่านั้น ไม่ต้องใส่ชื่อนำหน้า`;
    let reply;
    try {
        reply = stripReasoning(await tinyGenerate(q, Math.max(1, parseInt(getSetting("proactiveTokens"), 10) || 120), "connect")).trim();
    } catch (e) { console.error(`[${extensionName}] proactiveDM failed:`, e); return; }
    reply = reply.replace(/^\[|\]$/g, "").trim();
    if (!reply) return;
    getThread(c.key).push({ from: "contact", text: escapeHtml(reply), ts: Date.now() });
    saveFeedData();
    if (currentApp === "connect" && activeThread === c.key) renderThread();
    updateChatInjection();
    showNotif(makeAvatar(contactAvatarItem(c)), c.name, reply, "contact", "connect", c.key, c.name);
}

// สมาชิกในกลุ่มคุยกันเอง (ใช้ทั้ง auto และปุ่มสั่งเอง)
async function groupSelfChat(threadKey, opts) {
    opts = opts || {};
    const group = findGroup(threadKey);
    if (!group || isConnectReplying) return;
    const you = getUserName();
    const transcript = getThread(threadKey).slice(-12)
        .map((m) => `${m.from === "user" ? you : (m.author || group.name)}: ${htmlToPlain(m.text)}`).join("\n");
    const extra = String(getSetting("connectExtraPrompt") || "").trim();
    const q =
        `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] นี่คือแชตกลุ่ม "${group.name}" สมาชิก: ${group.members.join(", ")} และ ${you}. ` +
        `ให้สมาชิกในกลุ่ม (เลือกเอง 2-4 ข้อความ ห้ามใช้ ${you}) คุยกันเองต่อ อ้างถึงกันได้ เหมือนช่วงนี้ ${you} เงียบ/ไม่อยู่ ` +
        `สั้นเป็นธรรมชาติเหมือนแชตจริง ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดหรือกระทำแทน ${you}.\n` +
        (extra ? `คำสั่งเพิ่มเติม: ${extra}.\n` : "") +
        crossAppContext("connect") +
        `บทแชตล่าสุด:\n${transcript}\n` +
        `ตอบบรรทัดละคนในรูปแบบนี้เท่านั้น:\nMSG: <ชื่อสมาชิก> | <ข้อความ>`;
    isConnectReplying = true;
    if (currentApp === "connect" && activeThread === threadKey) renderThread();
    try {
        const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("connectTokens"), 10) || 200), "connect");
        const list = parseCommentLines(raw, group.members[0] || group.name, "MSG")
            .filter((c) => c.author.trim().toLowerCase() !== you.trim().toLowerCase());
        if (list.length) {
            for (const c of list.slice(0, 4)) getThread(threadKey).push({ from: "contact", author: c.author, text: c.text, ts: Date.now() });
            saveFeedData();
            updateChatInjection();
            if (opts.notify) showNotif(makeAnonAvatar(group.name), group.name,
                list.slice(0, 4).map((c) => `${c.author}: ${htmlToPlain(c.text)}`).join(" · "),
                "contact", "connect", threadKey, group.name);
        } else if (!opts.silent) {
            toastr.info("กลุ่มยังเงียบอยู่ ลองใหม่นะ", "TinyConnect");
        }
    } catch (e) {
        console.error(`[${extensionName}] groupSelfChat failed:`, e);
        if (!opts.silent) toastr.error("ให้กลุ่มคุยต่อไม่สำเร็จ", "TinyConnect");
    } finally {
        isConnectReplying = false;
        if (currentApp === "connect" && activeThread === threadKey) renderThread();
    }
}

// ===== จำ/คืนหน้าจอล่าสุด =====
// แอปที่จำหน้าจอได้ = ทะเบียน APPS ที่ตั้ง remember:true (ไม่ใช่ลิสต์แยก)
function canRememberApp(id) {
    return !!(APP_BY_ID[id] && APP_BY_ID[id].remember);
}

function saveLastScreen() {
    try {
        const data = getFeedData();
        data.ui = {
            app: canRememberApp(currentApp) ? currentApp : "home",
            thread: activeThread || null,
            forumThread: activeForumThread || null,
        };
        saveFeedData();
    } catch (e) { /* ไม่มีแชทเปิดอยู่ = ข้ามการจำหน้าจอ */ }
}

function restoreLastScreen() {
    let ui = null;
    try { ui = getFeedData().ui; } catch (e) { /* ไม่มีแชทเปิดอยู่ = ไปหน้าโฮม */ }
    if (!ui || !canRememberApp(ui.app)) { goHome(); return; }
    if (ui.app === "connect") {
        openApp("connect");
        if (ui.thread) {
            const c = getConnectContacts().find((x) => x.key === ui.thread);
            const g = findGroup(ui.thread);
            if (c || g) openThread(ui.thread, c ? c.name : g.name);
        }
    } else if (ui.app === "forum") {
        openApp("forum");
        if (ui.forumThread && getForum().find((t) => t.id === ui.forumThread)) openForumThread(ui.forumThread);
    } else {
        openApp(ui.app);   // feed / stream / memo
    }
}

// ปรับความสูง textarea ตามเนื้อหา
function autoGrowCompose(el) {
    el.style.height = "auto";
    const cap = 160;
    el.style.height = Math.min(el.scrollHeight, cap) + "px";
    // โชว์ scrollbar เฉพาะตอนเนื้อหายาวเกิน cap จริงๆ (กัน placeholder ยาวทำ scrollbar โผล่ตอนแคบ)
    el.style.overflowY = el.scrollHeight > cap ? "auto" : "hidden";
}

// เปิดหน้าบทความข่าวเต็ม
function openNewsDetail(newsId) {
    const news = getFeedData().news.find((n) => n.id === newsId);
    if (!news) return;
    const bodyHtml = news.body.split("\n\n").map((p) => `<p>${renderRich(p)}</p>`).join("");
    const html = `
        <div class="tinyfeed-article">
            <div class="tinyfeed-news-head">
                <span class="tinyfeed-news-source">${news.source}</span>
                <span class="tinyfeed-news-time">${displayTime(news)}</span>
            </div>
            <h2 class="tinyfeed-article-title">${news.title}</h2>
            <div class="tinyfeed-article-body">${bodyHtml}</div>
        </div>
    `;
    showDetail(html);
}

function showDetail(html) {
    $("#tinyfeed-detail").html(html);
    $(".tinyfeed-panel").addClass("tinyfeed-hidden");
    $("#tinyfeed-detail").removeClass("tinyfeed-hidden");
    // จำกัดที่แอปฟีด — .tinyfeed-tabs เป็นคลาสร่วมทุกแอปแล้ว (เฟส 4) และหน้า detail อยู่ในฟีด
    $("#tinyfeed-app-feed .tinyfeed-tabs").addClass("tinyfeed-hidden");
    $("#tinyfeed-home-btn, #tinyfeed-settings-btn").addClass("tinyfeed-hidden");
    $("#tinyfeed-back").removeClass("tinyfeed-hidden");
}

function closeDetail() {
    $("#tinyfeed-back").addClass("tinyfeed-hidden");
    $("#tinyfeed-home-btn, #tinyfeed-settings-btn").removeClass("tinyfeed-hidden");
    $("#tinyfeed-app-feed .tinyfeed-tabs").removeClass("tinyfeed-hidden");
    switchTab(activeTab);
}

/* ===== หน้าตั้งค่า 2 ระดับ: รายการหัวข้อ → เนื้อหาของหัวข้อนั้น =====
 * อ้างกลุ่มด้วย id (`data-group` ใน phone.html) ไม่ใช่ข้อความหัวข้อภาษาไทยแบบเดิม
 * — เดิมแก้คำในหัวข้อแล้วกลุ่มหลุดไปท้ายหน้าเงียบๆ ตอนนี้ id ไม่ตรงจะฟ้องใน console ทันที */
const SETTINGS_LAYOUT = [
    {
        head: "ทั่วไป", icon: "fa-gear",
        groups: [
            { id: "notif", name: "การแจ้งเตือน", icon: "fa-bell", desc: "แบนเนอร์ · กระดิ่ง · แจ้งเตือนระบบ" },
            { id: "proactive", name: "ทักเชิงรุก", icon: "fa-hand", desc: "ให้ตัวละครทักเราเองเป็นระยะ" },
        ],
    },
    {
        head: "ธีม & หน้าตา", icon: "fa-palette",
        groups: [
            { id: "appearance", name: "ปรับแต่งหน้าตา", icon: "fa-brush", desc: "สีเน้น · ความทึบ · วิดเจ็ต · CSS เอง" },
            { id: "wallpaper", name: "วอลเปเปอร์", icon: "fa-image", desc: "รูปพื้นหลัง + ความมืดที่ทับ" },
        ],
    },
    {
        head: "ตัวละคร", icon: "fa-user",
        groups: [
            { id: "profile", name: "รูปโปรไฟล์", icon: "fa-id-badge", desc: "รูป · ชื่อ · นามแฝง ของเราและตัวละคร" },
            { id: "npc", name: "NPC ประจำ", icon: "fa-users", desc: "ตัวประกอบของการ์ดใบนี้" },
        ],
    },
    {
        head: "การเงิน", icon: "fa-coins",
        groups: [
            { id: "bank", name: "TinyBank", icon: "fa-wallet", desc: "สกุลเงิน · โดเนท · ระดับ SuperChat" },
        ],
    },
    {
        head: "ตั้งค่าเฉพาะแอป", icon: "fa-mobile-screen",
        groups: [
            { id: "feedPost", name: "โพสต์จากตัวละคร (AI)", icon: "fa-feather-pointed", desc: "ให้ AI เขียนโพสต์ในฟีด" },
            { id: "feedAuto", name: "สร้างโพสต์อัตโนมัติ", icon: "fa-robot", desc: "โพสต์เองทุกกี่ข้อความ" },
            { id: "comments", name: "คอมเมนต์", icon: "fa-comment", desc: "NPC มาคอมเมนต์ · ตอบกลับ" },
            { id: "news", name: "ข่าวสาร", icon: "fa-newspaper", desc: "ข่าวในโลกของเรื่อง" },
            { id: "connect", name: "TinyConnect", icon: "fa-comment-dots", desc: "แชต · สลิปโอนเงิน · ทักเอง" },
            { id: "stream", name: "TinyStream", icon: "fa-video", desc: "ไลฟ์ · คอมเมนต์สด · พื้นหลังเวที" },
            { id: "memo", name: "TinyMemo", icon: "fa-calendar-check", desc: "กำหนดการ + โน้ต" },
            { id: "forum", name: "TinyForum", icon: "fa-comments", desc: "กระทู้ · ห้อง · คอมเมนต์" },
            { id: "keywords", name: "ทริกเกอร์ด้วยคีย์เวิร์ด", icon: "fa-key", desc: "คำที่กระตุ้นให้แต่ละแอปทำงาน" },
            { id: "gallery", name: "TinyGallery", icon: "fa-images", desc: "อัลบั้มที่ AI มองเห็น" },
            { id: "shop", name: "TinyShop", icon: "fa-bag-shopping", desc: "หมวดสินค้า · prompt เสริม" },
            { id: "pet", name: "TinyPet", icon: "fa-paw", desc: "ค่าลด · สไปรต์ · เหรียญ · เกม" },
            { id: "novel", name: "TinyNovel", icon: "fa-book-open", desc: "ความยาวตอน · คำสั่งเสริม" },
        ],
    },
    {
        head: "ขั้นสูง", icon: "fa-screwdriver-wrench",
        groups: [
            { id: "api", name: "โมเดล / API", icon: "fa-plug", desc: "ใช้โมเดลแยกจากแชทหลัก" },
            { id: "inject", name: "แทรกฟีดเข้าประวัติแชท", icon: "fa-syringe", desc: "ส่งอะไรเข้า RP บ้าง · ลึกแค่ไหน" },
            { id: "prompts", name: "Prompt (ขั้นสูง)", icon: "fa-pen-nib", desc: "แก้ prompt ที่ใช้สั่ง AI" },
        ],
    },
];

const SETTINGS_GROUP_BY_ID = Object.fromEntries(
    SETTINGS_LAYOUT.flatMap((sec) => sec.groups.map((g) => [g.id, Object.assign({ head: sec.head }, g)])),
);

let settingsGroupOpen = "";   // id ของหัวข้อที่กางอยู่ ("" = อยู่หน้ารายการ)

// ระดับ 1: รายการหัวข้อ (สร้างครั้งเดียว)
function renderSettingsList() {
    const box = $("#tinyfeed-settings-list");
    if (!box.length || box.attr("data-built")) return;
    const html = SETTINGS_LAYOUT.map((sec) => `
        <div class="tinyfeed-settings-cat"><i class="fa-solid ${sec.icon}"></i> ${escapeText(sec.head)}</div>
        ${sec.groups.map((g) => `
            <div class="tinyfeed-settings-row" data-group="${escapeAttr(g.id)}">
                <div class="tinyfeed-settings-row-icon"><i class="fa-solid ${g.icon}"></i></div>
                <div class="tinyfeed-settings-row-text">
                    <div class="tinyfeed-settings-row-name">${escapeText(g.name)}</div>
                    <div class="tinyfeed-settings-row-desc">${escapeText(g.desc)}</div>
                </div>
                <i class="fa-solid fa-chevron-right tinyfeed-settings-row-arrow"></i>
            </div>`).join("")}
    `).join("");
    box.html(html).attr("data-built", "1");

    // กันกลุ่มใน HTML ที่ไม่มีใน layout (หรือกลับกัน) หลุดไปเงียบๆ
    const inHtml = $("#tinyfeed-settings-detail .tinyfeed-settings-group").map(function () {
        return $(this).data("group");
    }).get();
    const inLayout = Object.keys(SETTINGS_GROUP_BY_ID);
    const orphanHtml = inHtml.filter((id) => !inLayout.includes(id));
    const orphanLayout = inLayout.filter((id) => !inHtml.includes(id));
    if (orphanHtml.length) console.error("[tinyfeed] กลุ่มตั้งค่าใน phone.html ที่ไม่มีใน SETTINGS_LAYOUT:", orphanHtml);
    if (orphanLayout.length) console.error("[tinyfeed] กลุ่มใน SETTINGS_LAYOUT ที่หา data-group ใน phone.html ไม่เจอ:", orphanLayout);
}

// ระดับ 2: กางหัวข้อเดียว
function openSettingsGroup(id) {
    const g = SETTINGS_GROUP_BY_ID[id];
    const el = $(`#tinyfeed-settings-detail .tinyfeed-settings-group[data-group="${id}"]`);
    if (!g || !el.length) return;
    settingsGroupOpen = id;
    $("#tinyfeed-settings-detail .tinyfeed-settings-group").addClass("tinyfeed-hidden");
    el.removeClass("tinyfeed-hidden");
    $("#tinyfeed-settings-list").addClass("tinyfeed-hidden");
    $("#tinyfeed-settings-detail").removeClass("tinyfeed-hidden").scrollTop(0);
    $(".tinyfeed-title").text(g.name);
}

// กลับจากหัวข้อ → รายการหัวข้อ
function closeSettingsGroup() {
    settingsGroupOpen = "";
    $("#tinyfeed-settings-detail").addClass("tinyfeed-hidden");
    $("#tinyfeed-settings-list").removeClass("tinyfeed-hidden").scrollTop(0);
    $(".tinyfeed-title").text("ตั้งค่า");
}

// ===== Stage 5: หน้า settings ในโทรศัพท์ =====
function isSettingsOpen() {
    return !$("#tinyfeed-settings-screen").hasClass("tinyfeed-hidden");
}

// เติมค่าปัจจุบันลงในฟอร์ม settings
function populateSettings() {
    $("#tinyfeed-cfg-wallpaper").val(getSetting("wallpaperUrl") || "");
    const wpo = parseInt(getSetting("wallpaperOverlay"), 10);
    $("#tinyfeed-cfg-wp-overlay").val(Number.isFinite(wpo) ? wpo : 45);
    $("#tinyfeed-wp-overlay-val").text(`${Number.isFinite(wpo) ? wpo : 45}%`);
    populateProfileSettings();

    // ปรับแต่งหน้าตา
    renderAccentSwatches();
    $("#tinyfeed-cfg-accent").val(String(getSetting("accentColor") || "").trim() || "#1d9bf0");
    const op = parseInt(getSetting("overlayOpacity"), 10);
    $("#tinyfeed-cfg-overlay").val(Number.isFinite(op) ? op : 50);
    $("#tinyfeed-overlay-val").text(`${Number.isFinite(op) ? op : 50}%`);
    $("#tinyfeed-cfg-themed-icons").prop("checked", Boolean(getSetting("themedIcons")));
    $("#tinyfeed-cfg-themed-home").prop("checked", Boolean(getSetting("themedHomeBg")));
    $("#tinyfeed-cfg-widget-clock").prop("checked", Boolean(getSetting("widgetClock")));
    $("#tinyfeed-cfg-widget-agenda").prop("checked", Boolean(getSetting("widgetAgenda")));
    $("#tinyfeed-cfg-widget-tokens").prop("checked", Boolean(getSetting("widgetTokens")));
    const wop = parseInt(getSetting("widgetOpacity"), 10);
    $("#tinyfeed-cfg-widget-opacity").val(Number.isFinite(wop) ? wop : 82);
    $("#tinyfeed-widget-opacity-val").text(`${Number.isFinite(wop) ? wop : 82}%`);
    $("#tinyfeed-cfg-customcss").val(getSetting("customCss") || "");


    $("#tinyfeed-cfg-likes-min").val(getSetting("likesMin"));
    $("#tinyfeed-cfg-likes-max").val(getSetting("likesMax"));
    $("#tinyfeed-cfg-history").val(getSetting("historyCount"));
    renderNpcList();

    $("#tinyfeed-cfg-auto").prop("checked", Boolean(getSetting("autoGenerate")));
    $("#tinyfeed-cfg-auto-mode").val(getSetting("autoGenerateMode") || "interval");
    $("#tinyfeed-cfg-interval").val(getSetting("autoGenerateInterval") || 10);
    $("#tinyfeed-cfg-comment-mode").val(getSetting("commentReplyMode") || "instant");
    $("#tinyfeed-cfg-initcomment-mode").val(getSetting("initialCommentMode") || "none");
    $("#tinyfeed-cfg-initcomment-count").val(getSetting("initialCommentCount") || 2);

    $("#tinyfeed-cfg-news-auto").prop("checked", Boolean(getSetting("newsAutoGenerate")));
    $("#tinyfeed-cfg-news-mode").val(getSetting("newsAutoMode") || "interval");
    $("#tinyfeed-cfg-news-interval").val(getSetting("newsAutoInterval") || 20);
    $("#tinyfeed-cfg-news-history").val(getSetting("newsHistoryCount"));
    $("#tinyfeed-cfg-notif").prop("checked", Boolean(getSetting("notificationsEnabled")));
    $("#tinyfeed-cfg-osnotif").prop("checked", Boolean(getSetting("osNotifEnabled")));
    $("#tinyfeed-cfg-proactive").prop("checked", Boolean(getSetting("proactiveEnabled")));
    $("#tinyfeed-cfg-proactive-interval").val(getSetting("proactiveIntervalMin") || 20);
    $("#tinyfeed-cfg-proactive-chance").val(getSetting("proactiveChance"));
    $("#tinyfeed-proactive-chance-val").text(`${parseInt(getSetting("proactiveChance"), 10) || 0}%`);
    $("#tinyfeed-cfg-quiet-from").val(getSetting("proactiveQuietFrom"));
    $("#tinyfeed-cfg-quiet-to").val(getSetting("proactiveQuietTo"));
    $("#tinyfeed-cfg-proactive-tokens").val(getSetting("proactiveTokens"));
    $("#tinyfeed-cfg-group-autochat").prop("checked", Boolean(getSetting("groupAutoChat")));
    $("#tinyfeed-cfg-proactive-idle").val(getSetting("proactiveIdleMin") || 0);
    $("#tinyfeed-cfg-proactive-timeaware").prop("checked", Boolean(getSetting("proactiveTimeAware")));
    $("#tinyfeed-cfg-proactive-viafeed").prop("checked", Boolean(getSetting("proactiveViaFeed")));
    renderPromptEditors();

    $("#tinyfeed-cfg-stream-mode").val(getSetting("streamCommentMode") || "manual");
    $("#tinyfeed-cfg-stream-bg").val(getSetting("streamBgUrl"));
    $("#tinyfeed-cfg-stream-bg-theme").prop("checked", Boolean(getSetting("streamBgTheme")));
    $("#tinyfeed-cfg-stream-interval").val(getSetting("streamAutoInterval"));
    $("#tinyfeed-cfg-stream-tokens").val(getSetting("streamTokens"));
    $("#tinyfeed-cfg-stream-extra").val(getSetting("streamExtraPrompt"));
    $("#tinyfeed-cfg-stream-reply").prop("checked", Boolean(getSetting("streamStreamerReply")));
    $("#tinyfeed-cfg-stream-talk").prop("checked", Boolean(getSetting("streamStreamerTalk")));
    $("#tinyfeed-cfg-connect-auto").prop("checked", Boolean(getSetting("connectAutoGenerate")));
    $("#tinyfeed-cfg-connect-mode").val(getSetting("connectAutoMode") || "interval");
    $("#tinyfeed-cfg-connect-interval").val(getSetting("connectAutoInterval") || 12);
    $("#tinyfeed-cfg-connect-tokens").val(getSetting("connectTokens"));
    $("#tinyfeed-cfg-connect-extra").val(getSetting("connectExtraPrompt"));
    $("#tinyfeed-cfg-connect-split").prop("checked", Boolean(getSetting("connectSplitBubbles")));
    $("#tinyfeed-cfg-connect-slip").prop("checked", Boolean(getSetting("connectSlipEnabled")));

    populateApiProfiles();
    $("#tinyfeed-cfg-api-context").val(getSetting("apiContextMessages"));
    $("#tinyfeed-cfg-wi-limit").val(getSetting("worldInfoLimit"));

    $("#tinyfeed-cfg-post-tokens").val(getSetting("postTokens"));
    $("#tinyfeed-cfg-post-extra").val(getSetting("postExtraPrompt"));
    $("#tinyfeed-cfg-news-tokens").val(getSetting("newsTokens"));
    $("#tinyfeed-cfg-news-extra").val(getSetting("newsExtraPrompt"));
    $("#tinyfeed-cfg-inject-mode").val(getSetting("injectMode") || "off");
    $("#tinyfeed-cfg-inject-count").val(getSetting("injectCount"));
    $("#tinyfeed-cfg-inject-depth").val(getSetting("injectDepth"));
    $("#tinyfeed-cfg-inject-connect").prop("checked", Boolean(getSetting("injectConnect")));
    $("#tinyfeed-cfg-inject-stream").prop("checked", Boolean(getSetting("injectStream")));
    $("#tinyfeed-cfg-inject-memo").prop("checked", Boolean(getSetting("injectMemo")));
    $("#tinyfeed-cfg-inject-forum").prop("checked", Boolean(getSetting("injectForum")));
    $("#tinyfeed-cfg-inject-forum-comments").prop("checked", Boolean(getSetting("injectForumComments")));
    $("#tinyfeed-cfg-inject-bank").prop("checked", Boolean(getSetting("injectBank")));
    $("#tinyfeed-cfg-inject-shop").prop("checked", Boolean(getSetting("injectShop")));
    $("#tinyfeed-cfg-inject-pet").prop("checked", Boolean(getSetting("injectPet")));
    $("#tinyfeed-cfg-inject-theater").prop("checked", Boolean(getSetting("injectTheater")));
    $("#tinyfeed-cfg-inject-novel").prop("checked", Boolean(getSetting("injectNovel")));

    $("#tinyfeed-cfg-memo-auto").prop("checked", Boolean(getSetting("memoAutoGenerate")));
    $("#tinyfeed-cfg-memo-mode").val(getSetting("memoAutoMode") || "interval");
    $("#tinyfeed-cfg-memo-interval").val(getSetting("memoAutoInterval") || 15);
    $("#tinyfeed-cfg-memo-tokens").val(getSetting("memoTokens"));
    $("#tinyfeed-cfg-memo-extra").val(getSetting("memoExtraPrompt"));

    $("#tinyfeed-cfg-forum-auto").prop("checked", Boolean(getSetting("forumAutoGenerate")));
    $("#tinyfeed-cfg-forum-mode").val(getSetting("forumAutoMode") || "interval");
    $("#tinyfeed-cfg-forum-interval").val(getSetting("forumAutoInterval") || 20);
    $("#tinyfeed-cfg-forum-tokens").val(getSetting("forumTokens"));
    $("#tinyfeed-cfg-forum-batch").val(getSetting("forumCommentBatch") || 8);
    $("#tinyfeed-cfg-forum-extra").val(getSetting("forumExtraPrompt"));
    renderForumRooms();
    renderShopCats();
    $("#tinyfeed-cfg-shop-tokens").val(getSetting("shopTokens"));
    $("#tinyfeed-cfg-shop-extra").val(getSetting("shopExtraPrompt"));
    $("#tinyfeed-cfg-kw-scope").val(getSetting("keywordScope") || "both");
    $("#tinyfeed-cfg-kw-cooldown").val(getSetting("keywordCooldownSec"));
    renderKeywordEditors();

    // TinyPet
    $("#tinyfeed-cfg-pet-ai").prop("checked", Boolean(getSetting("petAiReactions")));
    $("#tinyfeed-cfg-pet-autopost").prop("checked", Boolean(getSetting("petAutoPost")));
    $("#tinyfeed-cfg-pet-tokens").val(getSetting("petTokens"));
    $("#tinyfeed-cfg-pet-extra").val(getSetting("petExtraPrompt"));
    $("#tinyfeed-cfg-novel-tokens").val(getSetting("novelTokens"));
    $("#tinyfeed-cfg-novel-extra").val(getSetting("novelExtraPrompt"));
    $("#tinyfeed-cfg-pet-decay-hunger").val(getSetting("petDecayHunger"));
    $("#tinyfeed-cfg-pet-decay-energy").val(getSetting("petDecayEnergy"));
    $("#tinyfeed-cfg-pet-decay-clean").val(getSetting("petDecayClean"));
    $("#tinyfeed-cfg-pet-offline").val(getSetting("petOfflineCapHours"));
    $("#tinyfeed-cfg-pet-coinrate").val(getSetting("petCoinRate"));
    renderPetSpriteCfg();
    $("#tinyfeed-cfg-gallery-prompt").prop("checked", Boolean(getSetting("galleryPrompt")));
    $("#tinyfeed-cfg-gallery-scope").val(getSetting("galleryPromptScope") || "all");
    $("#tinyfeed-cfg-gallery-max-images").val(getSetting("galleryMaxImages"));
    $("#tinyfeed-cfg-gallery-max-stickers").val(getSetting("galleryMaxStickers"));
    galleryCfgPage = 0;
    renderGalleryCfgAlbums();
    $("#tinyfeed-cfg-bank-currency").val(getSetting("bankCurrency") || "฿");
    $("#tinyfeed-cfg-bank-currency-pos").val(getSetting("bankCurrencyAfter") ? "after" : "before");
    $("#tinyfeed-cfg-donate-enabled").prop("checked", Boolean(getSetting("streamDonateEnabled")));
    $("#tinyfeed-cfg-bank-donate-max").val(getSetting("bankDonateMax"));
    renderDonateTiers();
    $("#tinyfeed-cfg-crossapp").prop("checked", Boolean(getSetting("crossAppEnabled")));
    $("#tinyfeed-cfg-crossapp-feed").prop("checked", Boolean(getSetting("crossAppFeed")));
    $("#tinyfeed-cfg-crossapp-comments").prop("checked", Boolean(getSetting("crossAppComments")));
    $("#tinyfeed-cfg-crossapp-news").prop("checked", Boolean(getSetting("crossAppNews")));
    $("#tinyfeed-cfg-crossapp-connect").prop("checked", Boolean(getSetting("crossAppConnect")));
    $("#tinyfeed-cfg-crossapp-stream").prop("checked", Boolean(getSetting("crossAppStream")));
    $("#tinyfeed-cfg-crossapp-memo").prop("checked", Boolean(getSetting("crossAppMemo")));
    $("#tinyfeed-cfg-crossapp-forum").prop("checked", Boolean(getSetting("crossAppForum")));
    $("#tinyfeed-cfg-crossapp-bank").prop("checked", Boolean(getSetting("crossAppBank")));
    $("#tinyfeed-cfg-crossapp-shop").prop("checked", Boolean(getSetting("crossAppShop")));
    $("#tinyfeed-cfg-crossapp-pet").prop("checked", Boolean(getSetting("crossAppPet")));
    $("#tinyfeed-cfg-crossapp-theater").prop("checked", Boolean(getSetting("crossAppTheater")));
    $("#tinyfeed-cfg-crossapp-novel").prop("checked", Boolean(getSetting("crossAppNovel")));
    $("#tinyfeed-cfg-crossapp-count").val(getSetting("crossAppCount"));
}

// เติมรายชื่อ connection profile ลง dropdown (จาก Connection Manager ของ ST)
function populateApiProfiles() {
    const sel = $("#tinyfeed-cfg-api-profile");
    let profiles = [];
    try {
        profiles = (getContext().extensionSettings.connectionManager.profiles) || [];
    } catch (e) { /* Connection Manager ไม่พร้อม */ }
    let html = `<option value="">ใช้ API หลักของ SillyTavern</option>`;
    for (const p of profiles) {
        if (!p || !p.id) continue;
        html += `<option value="${escapeAttr(p.id)}">${escapeText(p.name || p.id)}</option>`;
    }
    sel.html(html).val(getSetting("apiProfile") || "");
}

/* เติมแถบพิมพ์ที่อยู่ใน phone.html (container ว่างไว้) — เรียกครั้งเดียวตอน init
 * id ทุกตัวเหมือนเดิมเป๊ะ handler เดิมจึงใช้ได้ไม่ต้องแก้ */
function mountComposeBars() {
    $("#tinyfeed-connect-compose").html(composeBarHtml({
        lead: [
            { id: "tinyfeed-connect-plus", cls: "tinyfeed-compose-plus", icon: "fa-solid fa-plus", title: "เพิ่มเติม" },
            { id: "tinyfeed-connect-image", icon: "fa-regular fa-image", title: "ส่งรูป" },
        ],
        field: { id: "tinyfeed-connect-input", multiline: true, placeholder: "พิมพ์ข้อความ..." },
        sticker: { id: "tinyfeed-connect-sticker" },
        send: { id: "tinyfeed-connect-send" },
        after: `<div id="tinyfeed-connect-plusmenu" class="tinyfeed-plusmenu tinyfeed-hidden"></div>`,
    }));
    $("#tinyfeed-stream-streamer-compose").html(composeBarHtml({
        field: { id: "tinyfeed-stream-streamer-input", placeholder: "พิมพ์คำพูดสตรีมเมอร์ (เราเป็นคนไลฟ์)..." },
        sticker: { id: "tinyfeed-stream-streamer-sticker" },
        send: { id: "tinyfeed-stream-streamer-send", icon: "fa-solid fa-microphone", title: "พูด" },
    }));
    $("#tinyfeed-stream-compose").html(composeBarHtml({
        lead: [{ id: "tinyfeed-stream-donate", cls: "tinyfeed-stream-donate-btn", icon: "fa-solid fa-gift", title: "โดเนทให้สตรีมเมอร์" }],
        field: { id: "tinyfeed-stream-input", placeholder: "พิมพ์คอมเมนต์สด..." },
        sticker: { id: "tinyfeed-stream-sticker" },
        send: { id: "tinyfeed-stream-send" },
    }));
    $("#tinyfeed-forum-compose").html(composeBarHtml({
        field: { id: "tinyfeed-forum-comment-input", placeholder: "ร่วมแสดงความเห็น..." },
        sticker: { id: "tinyfeed-forum-sticker" },
        send: { id: "tinyfeed-forum-comment-send" },
    }));
}

// แถบเขียนคอมเมนต์ใต้โพสต์ — ใช้ร่วมกันระหว่าง TinyFeed กับ TinyVerse (ต่างกันแค่ชื่อ data + คลาสปุ่ม)
function commentComposeHtml({ postId, dataKey, inputCls, stickerCls, sendCls }) {
    return `<div class="tinyfeed-comment-compose">${composeBarHtml({
        before: makeAvatar({ isUser: true, author: getUserName() }),
        data: { [dataKey]: postId },
        field: { cls: inputCls, placeholder: "เขียนคอมเมนต์..." },
        sticker: { cls: stickerCls },
        send: { cls: sendCls },
    })}</div>`;
}

let settingsReturn = "feed";   // แอปที่จะกลับไปหลังปิด settings

function openSettings() {
    populateSettings();
    renderSettingsList();
    settingsReturn = currentApp === "settings" ? settingsReturn : currentApp;   // จำแอปเดิม
    // settings-screen เป็นพี่น้องของแอปแล้ว (เฟส 3) — ไม่ต้องยืม app-feed เป็น host อีก
    $("#tinyfeed-home").addClass("tinyfeed-hidden");
    $(".tinyfeed-app").addClass("tinyfeed-hidden");
    $("#tinyfeed-settings-screen").removeClass("tinyfeed-hidden");
    $("#tinyfeed-home-btn, #tinyfeed-settings-btn").addClass("tinyfeed-hidden");
    $("#tinyfeed-back").removeClass("tinyfeed-hidden");
    closeSettingsGroup();   // เข้ามาที่หน้ารายการหัวข้อเสมอ (ตั้ง title = "ตั้งค่า" ให้ด้วย)
    currentApp = "settings";
}

function closeSettings() {
    $("#tinyfeed-back").addClass("tinyfeed-hidden");
    $("#tinyfeed-settings-screen").addClass("tinyfeed-hidden");
    if (settingsReturn === "home" || !settingsReturn) goHome();
    else openApp(settingsReturn);
}

/* ปุ่มย้อนกลับใช้ร่วมกัน — ไล่ตามลำดับใน CONVENTIONS.md บทที่ 3 (back stack)
 * 1) overlay/modal ที่เปิดอยู่  2) หัวข้อตั้งค่าที่กางอยู่  3) หน้าย่อยในแอป (APPS[].back)
 * 4) หน้าตั้งค่า  5) detail */
function handleBack() {
    if (anyOverlayOpen()) {
        closeOpenOverlays();   // ปิดเฉพาะตัวที่เปิดอยู่จริง
        return;
    }
    if (isSettingsOpen()) {
        if (settingsGroupOpen) closeSettingsGroup();   // จากหัวข้อ → รายการหัวข้อ
        else closeSettings();                          // จากรายการ → กลับแอปเดิม
        return;
    }
    const app = APP_BY_ID[currentApp];
    if (app && typeof app.back === "function" && app.back()) return;   // แอปจัดการเองแล้ว
    closeDetail();
}

jQuery(async () => {
    console.log(`[${extensionName}] Loading...`);

    try {
        // โหลดโมดูล core เผื่อดึง user_avatar (ห่อ try/catch กันพังถ้า path/เวอร์ชันไม่ตรง)
        try {
            stScriptModule = await import("../../../../script.js");
        } catch (e) {
            console.warn(`[${extensionName}] import script.js failed (ใช้ fallback แทน):`, e);
        }

        // โหลด panel โทรศัพท์ แปะไว้ที่ body
        const phoneHtml = await $.get(`${extensionFolderPath}/phone.html`);
        $("body").append(phoneHtml);
        mountComposeBars();     // เติมแถบพิมพ์ 4 อันจาก composeBarHtml() (id เดิมทุกตัว)
        renderSettingsList();   // สร้างรายการหัวข้อตั้งค่า (ระดับ 1) + เช็คว่า layout กับ HTML ตรงกัน

        // โหลด drawer ตั้งค่าไปที่แผง extensions ด้านขวา
        const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
        $("#extensions_settings2").append(settingsHtml);

        // สร้างปุ่มในเมนู extensions
        const menuButton = $(`
            <div id="tinyfeed-menu-button" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
                <div class="fa-solid fa-mobile-screen-button extensionsMenuExtensionButton"></div>
                <span>TinyFeed</span>
                <span id="tinyfeed-menu-badge" class="tinyfeed-menu-badge tinyfeed-hidden"></span>
            </div>
        `);
        $("#extensionsMenu").append(menuButton);

        // โหลดฟีดใหม่เมื่อสลับแชท
        const context = getContext();
        context.eventSource.on(context.eventTypes.CHAT_CHANGED, () => {
            autoMsgCount = 0;   // เริ่มนับใหม่ตามแชทที่เปิด
            autoNewsCount = 0;
            autoMemoCount = 0;
            autoForumCount = 0;
            autoConnectCount = 0;
            renderFeed();
            renderNews();
            if (isSettingsOpen()) populateSettings();   // อัปเดตชื่อ/ลิงก์รูปตัวละครตามแชทใหม่
            if (currentApp === "connect") openConnectList();   // contact/แชตเปลี่ยนตามแชท
            if (currentApp === "stream") { clearStreamTimer(); renderStream(); maybeStartStreamTimer(); }
            if (currentApp === "memo") switchMemoTab(memoTab);   // กำหนดการ/โน้ตเปลี่ยนตามแชท
            if (currentApp === "forum") openForumList();   // กระทู้เปลี่ยนตามแชท
            console.log(`[${extensionName}] Chat changed, feed reloaded`);
        });

        // Stage 7: นับข้อความในแชทเพื่อ auto-generate
        context.eventSource.on(context.eventTypes.MESSAGE_SENT, onChatMessage);
        context.eventSource.on(context.eventTypes.MESSAGE_RECEIVED, onChatMessage);

        // ผูก event
        menuButton.on("click", openPhone);
        $("#tinyfeed-enabled").on("input", onEnabledChange);
        $(document).on("click", "#tinyfeed-close", closePhone);
        $(document).on("click", "#tinyfeed-theme", toggleTheme);
        $(document).on("click", "#tinyfeed-overlay", function (e) {
            if (e.target.id === "tinyfeed-overlay") closePhone();
        });

        // App Shell: ปุ่ม home + ไอคอนแอปบนหน้าโฮม
        $(document).on("click", "#tinyfeed-home-btn", goHome);
        $(document).on("click", ".tinyfeed-app-icon", function () {
            openApp($(this).data("app"));
        });
        // เปลี่ยนหน้าโฮม: กดจุด / เลื่อน pager
        $(document).on("click", ".tinyfeed-home-dot", function () {
            const pager = document.getElementById("tinyfeed-home-pager");
            const page = parseInt($(this).data("page"), 10) || 0;
            if (pager) pager.scrollTo({ left: page * pager.clientWidth, behavior: "smooth" });
        });
        $(document).on("scroll", "#tinyfeed-home-pager", updateHomeDots);
        // วิดเจ็ตมินิกำหนดการ → เปิด TinyMemo
        $(document).on("click", "#tinyfeed-widget-agenda", function () {
            openApp("memo");
        });

        // ===== ปรับแต่งหน้าตา (Appearance) =====
        $(document).on("click", ".tinyfeed-accent-swatch", function () {
            setSetting("accentColor", $(this).data("color"));
            setSetting("homeBgHue", parseInt($(this).data("hue"), 10) || 210);
            $("#tinyfeed-cfg-accent").val($(this).data("color"));
            applyAppearance();
            applyWallpaper();
            renderAccentSwatches();
        });
        $(document).on("input", "#tinyfeed-cfg-accent", function () {
            setSetting("accentColor", $(this).val());
            applyAppearance();
            renderAccentSwatches();
        });
        $(document).on("click", "#tinyfeed-accent-reset", function () {
            setSetting("accentColor", "");
            $("#tinyfeed-cfg-accent").val("#1d9bf0");
            applyAppearance();
            renderAccentSwatches();
        });
        $(document).on("input", "#tinyfeed-cfg-overlay", function () {
            let v = parseInt($(this).val(), 10);
            if (!Number.isFinite(v)) v = 50;
            setSetting("overlayOpacity", v);
            $("#tinyfeed-overlay-val").text(`${v}%`);
            applyAppearance();
        });
        $(document).on("change", "#tinyfeed-cfg-themed-icons", function () {
            setSetting("themedIcons", $(this).prop("checked"));
            applyAppearance();
        });
        $(document).on("change", "#tinyfeed-cfg-themed-home", function () {
            setSetting("themedHomeBg", $(this).prop("checked"));
            applyAppearance();
            applyWallpaper();
        });
        $(document).on("click", "#tinyfeed-home-randomize", function () {
            setSetting("homeBgHue", Math.floor(Math.random() * 360));
            setSetting("themedHomeBg", true);
            $("#tinyfeed-cfg-themed-home").prop("checked", true);
            applyAppearance();
            applyWallpaper();
        });
        $(document).on("change", "#tinyfeed-cfg-widget-clock", function () {
            setSetting("widgetClock", $(this).prop("checked"));
            if (currentApp === "home") renderHomeWidgets();
        });
        $(document).on("change", "#tinyfeed-cfg-widget-agenda", function () {
            setSetting("widgetAgenda", $(this).prop("checked"));
            if (currentApp === "home") renderHomeWidgets();
        });
        $(document).on("change", "#tinyfeed-cfg-widget-tokens", function () {
            setSetting("widgetTokens", $(this).prop("checked"));
            if (currentApp === "home") renderHomeWidgets();
        });
        $(document).on("input", "#tinyfeed-cfg-widget-opacity", function () {
            let v = parseInt($(this).val(), 10);
            if (!Number.isFinite(v)) v = 82;
            setSetting("widgetOpacity", v);
            $("#tinyfeed-widget-opacity-val").text(`${v}%`);
            applyAppearance();
        });
        $(document).on("input", "#tinyfeed-cfg-customcss", function () {
            setSetting("customCss", $(this).val());
            applyCustomCss();
        });

        // Prompt (ขั้นสูง) — แก้/validate marker/รีเซ็ต
        $(document).on("input", ".tinyfeed-prompt-text", function () {
            const id = $(this).data("id");
            const def = PROMPT_DEFS[id];
            const val = $(this).val();
            const ok = !def || !def.marker || String(val).includes(def.marker);
            $(this).toggleClass("tinyfeed-prompt-invalid", !ok);
            if (ok) setPromptOverride(id, val);   // บันทึกเฉพาะเมื่อ marker ครบ
        });
        $(document).on("blur", ".tinyfeed-prompt-text", function () {
            const def = PROMPT_DEFS[$(this).data("id")];
            if (def && def.marker && !String($(this).val()).includes(def.marker)) {
                toastr.warning(`ต้องมี marker "${def.marker}" ในเทมเพลต ไม่งั้นระบบแยกผลลัพธ์ไม่ได้ (ยังไม่บันทึกจนกว่าจะใส่กลับ)`, "TinyPhone");
            }
        });
        $(document).on("click", ".tinyfeed-prompt-reset", function () {
            const id = $(this).data("id");
            setPromptOverride(id, null);
            renderPromptEditors();
        });

        // TinyConnect: เข้าห้องแชต + ส่งข้อความ
        $(document).on("click", ".tinyfeed-connect-contact", function () {
            openThread($(this).data("key"), $(this).data("name"));
        });
        // แชตกลุ่ม
        $(document).on("click", "#tinyfeed-connect-newgroup", function () {
            toggleGroupForm($("#tinyfeed-connect-groupform").hasClass("tinyfeed-hidden"));
        });
        $(document).on("click", "#tinyfeed-group-cancel", function () { toggleGroupForm(false); });
        $(document).on("click", "#tinyfeed-group-create", createGroup);
        $(document).on("click", ".tinyfeed-group-del", function (e) {
            e.stopPropagation();
            deleteGroup($(this).data("key"));
        });
        // ตั้ง/แก้รูปกลุ่มเดิม
        $(document).on("click", ".tinyfeed-group-edit", function (e) {
            e.stopPropagation();
            const g = findGroup($(this).data("key"));
            if (!g) return;
            const url = prompt("วางลิงก์รูปกลุ่ม (เว้นว่าง = ลบรูป):", g.avatar || "");
            if (url === null) return;   // กดยกเลิก
            g.avatar = url.trim();
            saveFeedData();
            renderConnectList();
        });
        // ลบบับเบิลแชท
        $(document).on("click", ".tinyfeed-msg-del", function (e) {
            e.stopPropagation();
            deleteConnectMessage(parseInt($(this).data("idx"), 10));
        });
        $(document).on("click", "#tinyfeed-connect-send", function () {
            sendConnectMessage($("#tinyfeed-connect-input").val());
        });
        $(document).on("keydown", "#tinyfeed-connect-input", function (e) {
            // เดสก์ท็อป: Enter=ส่ง, Shift+Enter=บรรทัดใหม่ · มือถือ (จอสัมผัส): Enter=บรรทัดใหม่ ส่งด้วยปุ่ม ✈
            const isTouch = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
            if (e.key === "Enter" && !e.shiftKey && !isTouch) {
                e.preventDefault();
                sendConnectMessage($(this).val());
            }
        });
        $(document).on("input", "#tinyfeed-connect-input", function () {
            autoGrowCompose(this);
        });

        // TinyStream: เริ่ม/จบไลฟ์ + โหลดคอมเมนต์ + ส่งคอมเมนต์
        $(document).on("click", "#tinyfeed-stream-toggle", toggleStream);
        $(document).on("click", "#tinyfeed-stream-ai-title", fillStreamAiTitle);
        $(document).on("click", "#tinyfeed-stream-speak", streamerSpeakButton);
        $(document).on("click", "#tinyfeed-stream-loadcomments", function () {
            loadLiveComments();
        });
        $(document).on("click", "#tinyfeed-stream-donate", openDonateModal);
        $(document).on("click", "#tinyfeed-stream-clear", clearEndedStream);
        $(document).on("click", "#tinyfeed-donate-close", closeDonateModal);
        $(document).on("click", "#tinyfeed-donate-modal", function (e) { if (e.target === this) closeDonateModal(); });
        $(document).on("click", "#tinyfeed-donate-send", sendUserDonate);
        $(document).on("click", "#tinyfeed-stream-send", function () {
            sendStreamComment($("#tinyfeed-stream-input").val());
        });
        $(document).on("keydown", "#tinyfeed-stream-input", function (e) {
            if (e.key === "Enter") {
                e.preventDefault();
                sendStreamComment($(this).val());
            }
        });
        // เราเป็นสตรีมเมอร์เอง: พิมพ์คำพูดสตรีมเมอร์
        $(document).on("click", "#tinyfeed-stream-streamer-send", function () {
            sendStreamerLine($("#tinyfeed-stream-streamer-input").val());
        });
        $(document).on("keydown", "#tinyfeed-stream-streamer-input", function (e) {
            if (e.key === "Enter") {
                e.preventDefault();
                sendStreamerLine($(this).val());
            }
        });

        // TinyMemo: สลับแท็บ + เพิ่ม/ติ๊ก/ลบ + สแกน
        $(document).on("click", ".tinyfeed-tab[data-mtab]", function () {
            switchMemoTab($(this).data("mtab"));
        });
        $(document).on("click", "#tinyfeed-agenda-add", function () {
            addAgendaManual($("#tinyfeed-agenda-input").val());
        });
        $(document).on("keydown", "#tinyfeed-agenda-input", function (e) {
            if (e.key === "Enter") { e.preventDefault(); addAgendaManual($(this).val()); }
        });
        $(document).on("click", "#tinyfeed-note-add", function () {
            addNoteManual($("#tinyfeed-note-input").val());
        });
        $(document).on("keydown", "#tinyfeed-note-input", function (e) {
            if (e.key === "Enter") { e.preventDefault(); addNoteManual($(this).val()); }
        });
        $(document).on("click", ".tinyfeed-agenda-check", function () {
            toggleAgenda($(this).data("id"));
        });
        $(document).on("click", ".tinyfeed-agenda-del", function () {
            deleteAgenda($(this).data("id"));
        });
        $(document).on("click", ".tinyfeed-note-del", function () {
            deleteNote($(this).data("id"));
        });
        $(document).on("click", "#tinyfeed-agenda-scan, #tinyfeed-note-scan", function () {
            scanMemo({ manual: true });
        });

        // TinyForum
        $(document).on("click", ".tinyfeed-tab[data-fsort]", function () {
            switchForumSort($(this).data("fsort"));
        });
        $(document).on("click", "#tinyfeed-forum-new", openForumNewForm);
        $(document).on("click", "#tinyfeed-forum-cancel", function () {
            $("#tinyfeed-forum-newform").addClass("tinyfeed-hidden");
        });
        $(document).on("click", "#tinyfeed-forum-post", addForumThread);
        $(document).on("click", "#tinyfeed-forum-generate", function () {
            generateForumThread({ notify: false, silent: false });
        });
        $(document).on("click", ".tinyfeed-forum-thread-row", function () {
            openForumThread($(this).data("id"));
        });
        $(document).on("click", ".tinyfeed-forum-loadmore", function () {
            loadForumComments($(this).data("id"), {});
        });
        $(document).on("click", ".tinyfeed-forum-thread-like", function () {
            toggleForumThreadLike($(this).data("id"));
        });
        $(document).on("click", ".tinyfeed-forum-thread-del", function () {
            deleteForumThread($(this).data("id"));
        });
        $(document).on("click", ".tinyfeed-forum-cmt-like", function () {
            toggleForumCommentLike($(this).data("tid"), $(this).data("cid"), $(this).data("rid"));
        });
        $(document).on("click", ".tinyfeed-forum-cmt-reply", function () {
            startForumReply($(this).data("cid"));
        });
        $(document).on("click", ".tinyfeed-forum-cmt-del", function () {
            deleteForumComment($(this).data("tid"), $(this).data("cid"));
        });
        $(document).on("click", ".tinyfeed-forum-reply-del", function () {
            deleteForumReply($(this).data("tid"), $(this).data("cid"), $(this).data("rid"));
        });
        $(document).on("click", "#tinyfeed-forum-reply-cancel", cancelForumReply);
        $(document).on("click", "#tinyfeed-forum-comment-send", function () {
            sendForumFromComposer($("#tinyfeed-forum-comment-input").val());
        });
        $(document).on("keydown", "#tinyfeed-forum-comment-input", function (e) {
            if (e.key === "Enter") {
                e.preventDefault();
                sendForumFromComposer($(this).val());
            }
        });

        // ===== TinyBank: เติม/จ่ายเงินเอง =====
        $(document).on("click", "#tinyfeed-bank-in", function () { bankManualTxn("in"); });
        $(document).on("click", "#tinyfeed-bank-out", function () { bankManualTxn("out"); });
        $(document).on("keydown", "#tinyfeed-bank-amount, #tinyfeed-bank-label", function (e) {
            if (e.key === "Enter") { e.preventDefault(); bankManualTxn("in"); }
        });

        // ===== TinyShop: เพิ่ม/ซื้อ/ลบสินค้า =====
        $(document).on("click", "#tinyfeed-shop-add", addShopItem);
        $(document).on("click", "#tinyfeed-shop-generate", function () { generateShopItems(); });
        $(document).on("click", ".tinyfeed-shop-buy", function () { buyShopItem(String($(this).data("id"))); });
        $(document).on("click", ".tinyfeed-shop-del", function (e) {
            e.stopPropagation();
            deleteShopItem(String($(this).closest(".tinyfeed-shop-item").data("id")));
        });
        $(document).on("click", ".tinyfeed-shop-edit", function (e) {
            e.stopPropagation();
            openShopEdit(String($(this).closest(".tinyfeed-shop-item").data("id")));
        });
        $(document).on("click", ".tinyfeed-shop-cat-chip", function () {
            shopFilterCat = String($(this).data("cat"));
            renderShop();
        });
        $(document).on("click", "#tinyfeed-shop-edit-close", closeShopEditModal);
        $(document).on("click", "#tinyfeed-shop-edit-modal", function (e) { if (e.target === this) closeShopEditModal(); });
        $(document).on("click", "#tinyfeed-shop-edit-save", saveShopEdit);

        // ===== TinyPet =====
        $(document).on("click", ".tinyfeed-pet-act", function () { petAct(String($(this).data("act"))); });
        // ร้านสัตว์เลี้ยง (เหรียญเพ็ท แยกจาก TinyShop)
        $(document).on("click", "#tinyfeed-pet-shop-btn", openPetShop);
        $(document).on("click", "#tinyfeed-pet-shop-close", closePetShop);
        $(document).on("click", "#tinyfeed-pet-shop-modal", function (e) { if (e.target === this) closePetShop(); });
        $(document).on("click", ".tinyfeed-pet-buy", function () { buyPetItem(String($(this).data("id"))); });
        $(document).on("click", ".tinyfeed-pet-item-edit", function (e) {
            e.stopPropagation();
            openPetItemEdit(String($(this).closest(".tinyfeed-pet-shop-item").data("id")));
        });
        $(document).on("click", ".tinyfeed-pet-item-del", function (e) {
            e.stopPropagation();
            deletePetItem(String($(this).closest(".tinyfeed-pet-shop-item").data("id")));
        });
        $(document).on("click", "#tinyfeed-pet-shop-add", function () { openPetItemEdit(null); });
        $(document).on("click", "#tinyfeed-pet-shop-generate", function () { generatePetItems(); });
        $(document).on("click", "#tinyfeed-pet-topup-btn", openPetTopup);
        // แก้/เพิ่มไอเทม
        $(document).on("click", "#tinyfeed-pet-item-close", closePetItemModal);
        $(document).on("click", "#tinyfeed-pet-item-modal", function (e) { if (e.target === this) closePetItemModal(); });
        $(document).on("click", "#tinyfeed-pet-item-save", savePetItem);
        // เติมเหรียญ
        $(document).on("click", "#tinyfeed-pet-topup-close", closePetTopup);
        $(document).on("click", "#tinyfeed-pet-topup-modal", function (e) { if (e.target === this) closePetTopup(); });
        $(document).on("click", "#tinyfeed-pet-topup-send", petTopup);
        $(document).on("keydown", "#tinyfeed-pet-topup-amount", function (e) { if (e.key === "Enter") { e.preventDefault(); petTopup(); } });
        // มินิเกม
        $(document).on("click", "#tinyfeed-pet-game-btn", openPetGame);
        $(document).on("click", "#tinyfeed-pet-game-close", closePetGame);
        $(document).on("click", "#tinyfeed-pet-game-modal", function (e) { if (e.target === this) closePetGame(); });
        $(document).on("click", ".tinyfeed-pet-game-card[data-game]", function () { petLaunchGame(String($(this).data("game"))); });
        $(document).on("click", "#tinyfeed-pet-game-menu", renderPetGameMenu);
        $(document).on("click", "#tinyfeed-pet-game-again", function () {
            if (currentPetGame) petLaunchGame(currentPetGame); else renderPetGameMenu();
        });
        $(document).on("click", ".tinyfeed-mem-card", function () { memoryFlip(parseInt($(this).data("idx"), 10)); });
        $(document).on("click", ".tinyfeed-spot-tile", function () { spotTap(parseInt($(this).data("idx"), 10)); });
        $(document).on("click", ".tinyfeed-whack-hole", function () { whackHit(parseInt($(this).data("idx"), 10)); });

        // ===== TinyVerse: import / roster / หน้าโปรไฟล์ใช้ร่วม =====
        $(document).on("click", "#tinyfeed-verse-import", openVerseImport);
        $(document).on("click", "#tinyfeed-verse-import-close", closeVerseImport);
        $(document).on("click", "#tinyfeed-verse-import-modal", function (e) { if (e.target === this) closeVerseImport(); });
        $(document).on("click", "#tinyfeed-verse-import-do", verseDoImport);
        $(document).on("change", "#tinyfeed-verse-selall", function () {
            $(".tinyfeed-verse-imp-check").prop("checked", $(this).prop("checked"));
        });
        $(document).on("click", "#tinyfeed-verse-clear", function () {
            if (!Object.keys(getVerse().chars).length) return;
            if (!confirm("ลบตัวละครทั้งหมดออกจาก TinyVerse?")) return;
            verseClearAll();
            renderVerse();
            toastr.success("เคลียร์ตัวละครทั้งหมดแล้ว", "TinyVerse");
        });
        $(document).on("click", ".tinyfeed-verse-card", function () { openCharProfile(String($(this).data("key"))); });
        $(document).on("click", ".tinyfeed-tab[data-vtab]", function () {
            const t = String($(this).data("vtab"));
            if (t && t !== verseTab) { verseTab = t; renderVerse(); }
        });
        // ช่องเขียนแบบ TinyFeed: เลือกคนโพสต์ (แตะรูป) · พิมพ์เอง+แนบรูป/สติกเกอร์ · ตัวละคร=AI
        $(document).on("input", "#tinyfeed-verse-input", function () {
            autoGrowCompose(this);
            if (versePoster === POSTER_USER) $("#tinyfeed-verse-post").prop("disabled", $(this).val().trim().length === 0);
        });
        $(document).on("click", "#tinyfeed-verse-compose-avatar", openVersePosterPicker);
        $(document).on("click", ".tinyfeed-verse-poster-pick", function () {
            versePoster = String($(this).data("vposter"));
            closeVersePosterPicker();
            applyVerseComposeMode();
        });
        $(document).on("click", "#tinyfeed-verse-poster-close", closeVersePosterPicker);
        $(document).on("click", "#tinyfeed-verse-poster-modal", function (e) { if (e.target === this) closeVersePosterPicker(); });
        $(document).on("click", "#tinyfeed-verse-img", function () {
            openGalleryPicker("image", (token) => insertIntoInput("#tinyfeed-verse-input", token));
        });
        $(document).on("click", "#tinyfeed-verse-sticker", function () {
            openGalleryPicker("sticker", (token) => insertIntoInput("#tinyfeed-verse-input", token));
        });
        $(document).on("click", "#tinyfeed-verse-post", function () {
            if (verseBusy) return;
            if (versePoster === POSTER_USER) {
                addVerseUserPost($("#tinyfeed-verse-input").val());
                $("#tinyfeed-verse-input").val("").css("height", "");
                applyVerseComposeMode();
            } else {
                verseGeneratePost();
            }
        });
        $(document).on("click", "#tinyfeed-verse-cancel", function () {
            if (verseBusy) return;
            $("#tinyfeed-verse-input").val("").css("height", "");
            $("#tinyfeed-verse-guidance").val("");
            versePoster = POSTER_USER;
            applyVerseComposeMode();
        });
        $(document).on("keydown", "#tinyfeed-verse-guidance", function (e) { if (e.key === "Enter") { e.preventDefault(); verseGeneratePost(); } });
        // แตะการ์ดโพสต์ = เปิดหน้ารายละเอียด (เหมือน TinyFeed) — ปุ่มย่อยด้านล่างต้อง stopPropagation
        $(document).on("click", ".tinyfeed-post[data-vpost]:not(.tinyfeed-post-detail)", function () {
            openVersePost(String($(this).data("vpost")));
        });
        $(document).on("click", ".tinyfeed-verse-like", function (e) {
            e.stopPropagation();
            const p = verseFeedPost(String($(this).data("vpost")));
            if (!p) return;
            p.liked = !p.liked;
            p.likes = Math.max(0, (p.likes || 0) + (p.liked ? 1 : -1));
            saveVerse();
            renderVerseFeedList();
        });
        $(document).on("click", ".tinyfeed-verse-del", function (e) {
            e.stopPropagation();
            const id = String($(this).data("vpost"));
            const v = getVerse();
            const i = v.feed.findIndex((p) => p.id === id);
            if (i < 0) return;
            v.feed.splice(i, 1);
            saveVerse();
            if (versePostId === id) closeVersePost();   // ลบโพสต์ที่กางอยู่ → กลับหน้ารายการ
            else renderVerseFeedList();
        });
        // ── ครอสโอเวอร์: คอมเมนต์ข้ามการ์ด ──
        $(document).on("click", ".tinyfeed-verse-aicomment", function (e) {
            e.stopPropagation();
            verseGenerateComments(String($(this).data("vpost")));
        });
        $(document).on("click", ".tinyfeed-verse-csticker", function (e) {
            e.stopPropagation();
            const id = String($(this).data("vpost"));
            openGalleryPicker("sticker", (token) => addVerseComment(id, token));
        });
        $(document).on("click", ".tinyfeed-verse-csend", function (e) {
            e.stopPropagation();
            const id = String($(this).data("vpost"));
            const $inp = $(`.tinyfeed-verse-cinput[data-vpost="${id}"]`);
            addVerseComment(id, $inp.val());
        });
        $(document).on("keydown", ".tinyfeed-verse-cinput", function (e) {
            if (e.key === "Enter") { e.preventDefault(); addVerseComment(String($(this).data("vpost")), $(this).val()); }
        });
        // ===== TinyTheater: มินิเธียเตอร์ What if =====
        // ===== TinyNovel: แอปอ่านนิยาย =====
        $(document).on("click", "#tinyfeed-novel-new", function () {
            novelCover = ""; novelPlotIdeas = []; novelHero = NOVEL_HERO_AI;
            novelScreen = "create"; renderNovel();
        });
        $(document).on("click", ".tinyfeed-novel-card", function () {
            novelBookId = String($(this).data("book"));
            const b = novelBook(novelBookId);
            novelEpIdx = b ? Math.max(0, Math.min((b.lastReadEp || 1) - 1, b.episodes.length - 1)) : 0;
            novelScreen = "read"; renderNovel();
        });
        $(document).on("click", "#tinyfeed-novel-dice", function () {
            $("#tinyfeed-novel-plot").val(novelRandomTrope());
        });
        $(document).on("click", "#tinyfeed-novel-ai", novelSuggestPlots);
        $(document).on("click", ".tinyfeed-novel-idea", function () {
            $("#tinyfeed-novel-plot").val($(this).data("idea"));
        });
        $(document).on("click", ".tinyfeed-novel-chip", function () {
            $("#tinyfeed-novel-genre").val($(this).data("genre"));
        });
        $(document).on("change", "#tinyfeed-novel-hero", function () { novelHero = String($(this).val()); });
        $(document).on("click", "#tinyfeed-novel-pickcover", function () {
            openGalleryPicker("image", (token) => {
                const m = String(token).match(/\[img:([^\]]+)\]/i);
                const img = m ? findGalleryImage(m[1]) : null;
                if (!img) { toastr.info("เลือกรูปไม่สำเร็จ", "TinyNovel"); return; }
                novelCover = img.url || "";
                restoreNovelForm();   // วาดฟอร์มใหม่โดยคงค่าที่กรอกไว้
            });
        });
        $(document).on("click", "#tinyfeed-novel-clearcover", function () { novelCover = ""; restoreNovelForm(); });
        $(document).on("click", "#tinyfeed-novel-create", novelCreateBook);
        $(document).on("click", "#tinyfeed-novel-next", novelNextEpisode);
        $(document).on("click", ".tinyfeed-novel-epchip", function () {
            novelEpIdx = parseInt($(this).data("ep"), 10) || 0;
            renderNovel();
        });
        $(document).on("click", "#tinyfeed-novel-chars", function () { novelScreen = "chars"; renderNovel(); });
        $(document).on("click", "#tinyfeed-novel-del", function () {
            if (novelBookId) novelDeleteBook(novelBookId);
        });

        $(document).on("click", "#tinyfeed-th-new", function () {
            theaterCastSel = []; theaterCover = ""; theaterWhatIfIdeas = []; theaterScreen = "create"; renderTheater();
        });
        $(document).on("click", "#tinyfeed-th-back", function () {
            if (theaterScreen === "read") { theaterScreen = "browse"; theaterShowId = null; }
            else theaterScreen = "browse";
            renderTheater();
        });
        $(document).on("click", ".tinyfeed-th-card", function () {
            theaterShowId = String($(this).data("show")); theaterEpIdx = 0; theaterScreen = "read"; renderTheater();
        });
        $(document).on("click", ".tinyfeed-th-castpick", function () {
            const k = String($(this).data("key"));
            const i = theaterCastSel.indexOf(k);
            if (i >= 0) theaterCastSel.splice(i, 1);
            else { if (theaterCastSel.length >= 4) { toastr.info("เลือกได้สูงสุด 4 ตัว", "TinyTheater"); return; } theaterCastSel.push(k); }
            // คงค่าที่กรอกไว้ระหว่าง re-render
            const w = String($("#tinyfeed-th-whatif").val() || ""), g = String($("#tinyfeed-th-genre").val() || ""), l = String($("#tinyfeed-th-length").val() || "medium");
            renderTheaterCreate();
            $("#tinyfeed-th-whatif").val(w); $("#tinyfeed-th-genre").val(g); $("#tinyfeed-th-length").val(l);
        });
        $(document).on("click", ".tinyfeed-th-genre", function () { $("#tinyfeed-th-genre").val(String($(this).data("genre"))); });
        // โจทย์ What if: สุ่มจาก preset / ให้ AI คิดให้ / กดชิปเพื่อใช้
        $(document).on("click", "#tinyfeed-th-dice", function () {
            $("#tinyfeed-th-whatif").val(theaterRandomWhatIf()).focus();
        });
        $(document).on("click", "#tinyfeed-th-ai", theaterSuggestWhatIf);
        $(document).on("click", ".tinyfeed-th-idea", function () {
            const i = parseInt($(this).data("idea"), 10);
            const t = theaterWhatIfIdeas[i];
            if (t) $("#tinyfeed-th-whatif").val(t).focus();
        });
        $(document).on("click", "#tinyfeed-th-cover", function () {
            openGalleryPicker("image", (token) => {
                const m = String(token).match(/\[img:([^\]]+)\]/i);
                const img = m ? findGalleryImage(m[1]) : null;
                if (!img) { toastr.info("เลือกรูปไม่สำเร็จ", "TinyTheater"); return; }
                theaterCover = img.url || "";
                const w = String($("#tinyfeed-th-whatif").val() || ""), g = String($("#tinyfeed-th-genre").val() || ""), l = String($("#tinyfeed-th-length").val() || "medium");
                renderTheaterCreate();
                $("#tinyfeed-th-whatif").val(w); $("#tinyfeed-th-genre").val(g); $("#tinyfeed-th-length").val(l);
            });
        });
        $(document).on("click", "#tinyfeed-th-coverclear", function () {
            theaterCover = "";
            const w = String($("#tinyfeed-th-whatif").val() || ""), g = String($("#tinyfeed-th-genre").val() || ""), l = String($("#tinyfeed-th-length").val() || "medium");
            renderTheaterCreate();
            $("#tinyfeed-th-whatif").val(w); $("#tinyfeed-th-genre").val(g); $("#tinyfeed-th-length").val(l);
        });
        $(document).on("click", "#tinyfeed-th-create", theaterCreateShow);
        $(document).on("click", "#tinyfeed-th-next", theaterNextEpisode);
        $(document).on("click", ".tinyfeed-th-epchip", function () { theaterEpIdx = parseInt($(this).data("ep"), 10) || 0; renderTheater(); });
        $(document).on("click", ".tinyfeed-th-deleteshow", function () {
            if (!confirm("ลบเรื่องนี้ทั้งหมด?")) return;
            theaterDeleteShow(String($(this).data("show")));
        });

        $(document).on("click", ".tinyfeed-verse-cdel", function (e) {
            e.stopPropagation();
            const post = verseFeedPost(String($(this).data("vpost")));
            const idx = parseInt($(this).data("cidx"), 10);
            if (!post || !Array.isArray(post.comments) || !(idx >= 0)) return;
            post.comments.splice(idx, 1);
            saveVerse();
            renderVerseFeedList();
        });
        $(document).on("click", "#tinyfeed-char-profile-close", closeCharProfile);
        $(document).on("click", "#tinyfeed-char-profile", function (e) { if (e.target === this) closeCharProfile(); });
        $(document).on("click", "#tinyfeed-vprofile-save", function () {
            if (!charProfileCtx || !charProfileCtx.key) return;
            const c = getVerse().chars[charProfileCtx.key];
            if (!c) return;
            c.persona = String($("#tinyfeed-vprofile-persona").val() || "").trim();
            saveVerse();
            toastr.success("บันทึก persona แล้ว", "TinyVerse");
        });
        $(document).on("click", "#tinyfeed-vprofile-add", function () {
            if (!charProfileCtx || !charProfileCtx.key) return;
            const v = getVerse();
            v.chars[charProfileCtx.key] = {
                key: charProfileCtx.key, name: charProfileCtx.name, avatar: charProfileCtx.avatar || "",
                bio: charProfileCtx.bio || "", persona: charProfileCtx.persona || charProfileCtx.bio || "",
                npcs: charProfileCtx.npcs || [], addedTs: Date.now(),
            };
            saveVerse();
            charProfileCtx = v.chars[charProfileCtx.key];
            renderCharProfile(charProfileCtx);
            if (currentApp === "verse") renderVerse();
            toastr.success("เพิ่มเข้า TinyVerse แล้ว", "TinyVerse");
        });
        $(document).on("click", "#tinyfeed-vprofile-remove", function () {
            if (!charProfileCtx || !charProfileCtx.key) return;
            verseRemoveChar(charProfileCtx.key);
            closeCharProfile();
            if (currentApp === "verse") renderVerse();
        });
        // ใช้ซ้ำใน TinyFeed: แตะชื่อผู้โพสต์ → เปิดโปรไฟล์ตัวละคร
        $(document).on("click", ".tinyfeed-post-author", function () { openCharProfile($(this).text()); });
        $(document).on("click", "#tinyfeed-pet-speak", function () { petReact("", { silent: false }); });
        $(document).on("click", "#tinyfeed-pet-post", function () { petPostToFeed({ notify: false, silent: false }); });
        $(document).on("click", "#tinyfeed-pet-adopt", function () { petAdopt($("#tinyfeed-pet-name-input").val()); });
        $(document).on("keydown", "#tinyfeed-pet-name-input", function (e) {
            if (e.key === "Enter") { e.preventDefault(); petAdopt($(this).val()); }
        });
        $(document).on("click", "#tinyfeed-pet-adopt-new", petAdoptNew);

        // ===== TinyGallery: จัดการคลัง + picker + ปุ่มสติกเกอร์ในแอปต่างๆ =====
        $(document).on("click", ".tinyfeed-tab[data-gtab]", function () {
            switchGalleryTab($(this).data("gtab"));
        });
        $(document).on("change", "#tinyfeed-gallery-img-album", function () { renderGalleryGrid("image"); });
        $(document).on("change", "#tinyfeed-gallery-stk-album", function () { renderGalleryGrid("sticker"); });
        $(document).on("click", "#tinyfeed-gallery-img-add", addGalleryImage);
        $(document).on("click", "#tinyfeed-gallery-stk-add", addGallerySticker);
        $(document).on("keydown", "#tinyfeed-gallery-img-name", function (e) { if (e.key === "Enter") { e.preventDefault(); addGalleryImage(); } });
        $(document).on("keydown", "#tinyfeed-gallery-stk-name", function (e) { if (e.key === "Enter") { e.preventDefault(); addGallerySticker(); } });
        $(document).on("click", "#tinyfeed-gallery-img-album-add", function () { addGalleryAlbum("image"); });
        $(document).on("click", "#tinyfeed-gallery-stk-album-add", function () { addGalleryAlbum("sticker"); });
        $(document).on("click", "#tinyfeed-gallery-img-album-del", function () { deleteGalleryAlbum("image"); });
        $(document).on("click", "#tinyfeed-gallery-stk-album-del", function () { deleteGalleryAlbum("sticker"); });
        $(document).on("click", ".tinyfeed-gallery-item-del", function (e) {
            e.stopPropagation();
            const item = $(this).closest(".tinyfeed-gallery-item");
            deleteGalleryItem(item.data("kind"), String(item.data("id")));
        });
        $(document).on("click", ".tinyfeed-gallery-item-edit", function (e) {
            e.stopPropagation();
            const item = $(this).closest(".tinyfeed-gallery-item");
            openGalleryEdit(item.data("kind"), String(item.data("id")));
        });
        // คลิกรูปย่อ = ดูรูปเต็ม (โชว์คำบรรยาย)
        $(document).on("click", ".tinyfeed-gallery-item .tinyfeed-gallery-thumb", function () {
            const item = $(this).closest(".tinyfeed-gallery-item");
            openGalleryView(item.data("kind"), String(item.data("id")));
        });
        // ดูรูปเต็ม
        $(document).on("click", "#tinyfeed-gallery-view-close", closeGalleryView);
        $(document).on("click", "#tinyfeed-gallery-view", function (e) {
            if (e.target === this) closeGalleryView();
        });
        // แก้ไข/ย้ายอัลบั้ม
        $(document).on("click", "#tinyfeed-gallery-edit-save", saveGalleryEdit);
        $(document).on("click", "#tinyfeed-gallery-edit-cancel, #tinyfeed-gallery-edit-close", closeGalleryEdit);
        $(document).on("click", "#tinyfeed-gallery-edit", function (e) {
            if (e.target === this) closeGalleryEdit();
        });
        // picker
        $(document).on("change", "#tinyfeed-gallery-picker-album", renderPickerGrid);
        $(document).on("click", "#tinyfeed-gallery-picker-close", closeGalleryPicker);
        $(document).on("click", "#tinyfeed-gallery-picker", function (e) {
            if (e.target === this) closeGalleryPicker();   // คลิกฉากหลัง = ปิด
        });
        $(document).on("click", ".tinyfeed-gallery-pick", function () {
            pickGalleryItem(String($(this).data("name")));
        });
        // ปุ่มสติกเกอร์/รูป ในแถบพิมพ์ของแต่ละแอป (ส่งทันที หรือแทรกลงช่องพิมพ์)
        $(document).on("click", "#tinyfeed-connect-sticker", function () {
            openGalleryPicker("sticker", (token) => sendConnectMessage(token));
        });
        $(document).on("click", "#tinyfeed-connect-image", function () {
            openGalleryPicker("image", (token) => sendConnectMessage(token));
        });
        // เมนู (+) ฟังก์ชันเสริม (สไตล์ไลน์) → รายการปัจจุบัน: โอนเงิน
        $(document).on("click", "#tinyfeed-connect-plus", function (e) {
            e.stopPropagation();
            toggleConnectPlusMenu();
        });
        $(document).on("click", ".tinyfeed-plusmenu-item", function () {
            const id = $(this).data("action");
            const a = CONNECT_PLUS_ACTIONS.find((x) => x.id === id);
            closeConnectPlusMenu();
            if (a && typeof a.run === "function") a.run();
        });
        // คลิกที่อื่น = ปิดเมนู (+)
        $(document).on("click", function (e) {
            if (!$(e.target).closest("#tinyfeed-connect-plusmenu, #tinyfeed-connect-plus").length) closeConnectPlusMenu();
        });
        $(document).on("click", "#tinyfeed-slip-close", closeSlipModal);
        $(document).on("click", "#tinyfeed-slip-modal", function (e) { if (e.target === this) closeSlipModal(); });
        $(document).on("click", "#tinyfeed-slip-send", sendUserSlip);
        $(document).on("keydown", "#tinyfeed-slip-amount, #tinyfeed-slip-note", function (e) {
            if (e.key === "Enter") { e.preventDefault(); sendUserSlip(); }
        });
        $(document).on("click", "#tinyfeed-stream-sticker", function () {
            openGalleryPicker("sticker", (token) => sendStreamComment(token));
        });
        $(document).on("click", "#tinyfeed-stream-streamer-sticker", function () {
            openGalleryPicker("sticker", (token) => sendStreamerLine(token));
        });
        // แตะรูปผู้ไลฟ์: AI = ให้พูด (เจาะจงคนนั้น) · เรา = โฟกัสช่องพิมพ์คำพูดของเรา
        $(document).on("click", ".tinyfeed-stream-host", function (e) {
            if ($(e.target).closest(".tinyfeed-host-edit, .tinyfeed-host-remove").length) return;   // กดปุ่มย่อย
            if (!getStreamData().live) return;
            if ($(this).data("user")) {
                $("#tinyfeed-stream-streamer-input").trigger("focus");
            } else {
                const nm = String($(this).data("name") || "");
                if (nm && !isGeneratingStream) streamerSpeak(streamSpeakKind(), { host: nm });
            }
        });
        // ดินสอบนสตรีมเมอร์หลัก = เปลี่ยนคนหลัก
        $(document).on("click", ".tinyfeed-host-edit", function (e) {
            e.stopPropagation();
            openCharPicker({ includeUser: true, includeMain: true, includeAuto: false, title: "เลือกสตรีมเมอร์หลัก" }, (value) => {
                const s = getStreamData();
                s.mainStreamer = value;
                const mainName = getStreamer().name;
                s.coHosts = (s.coHosts || []).filter((v) => v !== value && v !== mainName);   // กันซ้ำกับหลัก
                saveFeedData();
                if (currentApp === "stream") { renderStream(); maybeStartStreamTimer(); }
            });
        });
        // กากบาทบนตัวร่วมไลฟ์ = เอาออก
        $(document).on("click", ".tinyfeed-host-remove", function (e) {
            e.stopPropagation();
            const val = String($(this).closest(".tinyfeed-stream-host").data("val"));
            const s = getStreamData();
            s.coHosts = (s.coHosts || []).filter((x) => String(x) !== val);
            saveFeedData();
            if (currentApp === "stream") { renderStream(); maybeStartStreamTimer(); }
        });
        // ปุ่ม + = เพิ่มตัวละคร/เราเอง มาไลฟ์ร่วม
        $(document).on("click", "#tinyfeed-stream-addhost", function () {
            const s = getStreamData();
            const exclude = [getStreamer().name, ...(s.coHosts || [])];
            if (streamerIsUser() || (s.coHosts || []).includes(POSTER_USER)) exclude.push(POSTER_USER);
            openCharPicker({ includeUser: true, includeMain: true, includeAuto: false, exclude, title: "เพิ่มคนมาไลฟ์ร่วม" }, (value) => {
                if (value === POSTER_AUTO) return;
                const st = getStreamData();
                if (!st.coHosts.includes(value)) st.coHosts.push(value);
                saveFeedData();
                if (currentApp === "stream") { renderStream(); maybeStartStreamTimer(); }
            });
        });
        $(document).on("click", "#tinyfeed-forum-sticker", function () {
            openGalleryPicker("sticker", (token) => sendForumFromComposer(token));
        });
        $(document).on("click", "#tinyfeed-compose-sticker", function () {
            openGalleryPicker("sticker", (token) => insertIntoInput("#tinyfeed-compose-input", token));
        });
        $(document).on("click", "#tinyfeed-compose-img", function () {
            openGalleryPicker("image", (token) => insertIntoInput("#tinyfeed-compose-input", token));
        });

        // Stage 2: render mock + ผูกแท็บ
        renderFeed();
        renderNews();
        $(document).on("click", ".tinyfeed-tab[data-tab]", function () {
            switchTab($(this).data("tab"));
        });

        // Stage 2.5: กดโพสต์/ข่าวเข้าหน้ารายละเอียด
        // จำกัดด้วย [data-post] — โพสต์ TinyVerse ก็ใช้ .tinyfeed-post แต่เก็บ id ใน data-vpost
        // (เดิมไม่จำกัด → กดโพสต์ TinyVerse แล้วเข้า openPostDetail(undefined) = เงียบ ไม่มีอะไรเกิดขึ้น)
        $(document).on("click", ".tinyfeed-post[data-post]:not(.tinyfeed-post-detail)", function () {
            openPostDetail($(this).data("post"));
        });
        $(document).on("click", ".tinyfeed-news", function () {
            openNewsDetail($(this).data("news"));
        });
        // Stage 9: สร้าง/ลบข่าว
        $(document).on("click", "#tinyfeed-generate-news", function () {
            generateNews();
        });
        $(document).on("click", ".tinyfeed-news-delete", function (e) {
            e.stopPropagation();
            deleteNews($(this).data("news"));
        });
        $(document).on("click", "#tinyfeed-back", handleBack);

        // Stage 4: ปุ่มไลค์/แชร์
        $(document).on("click", ".tinyfeed-like", function (e) {
            e.stopPropagation();
            toggleLike($(this).data("post"));
        });
        $(document).on("click", ".tinyfeed-share", function (e) {
            e.stopPropagation();
            toggleShare($(this).data("post"));
        });
        // กันปุ่มคอมเมนต์เด้งเข้า detail ไปก่อน (ค่อยทำจริงตอนคอมเมนต์)
        $(document).on("click", ".tinyfeed-comment-btn", function (e) {
            e.stopPropagation();
            openPostDetail($(this).data("post"));
        });

        // Stage 4b: ผู้ใช้โพสต์เอง + ลบโพสต์
        $(document).on("input", "#tinyfeed-compose-input", function () {
            autoGrowCompose(this);
            if (feedPoster === POSTER_USER) {
                $("#tinyfeed-compose-post").prop("disabled", $(this).val().trim().length === 0);
            }
        });
        // กดรูปโปรไฟล์ = เลือกคนโพสต์ (เรา/ตัวละคร/NPC/อัตโนมัติ)
        $(document).on("click", "#tinyfeed-compose-avatar", function () {
            openCharPicker({ includeUser: true, includeMain: true, includeAuto: true, title: "ใครเป็นคนโพสต์" }, (value) => {
                feedPoster = value;
                applyFeedComposeMode();
            });
        });
        // ปุ่มโพสต์: เราเอง = โพสต์ปกติ · ตัวละครอื่น/อัตโนมัติ = ให้ AI โพสต์
        $(document).on("click", "#tinyfeed-compose-post", function () {
            if (isGenerating) return;
            if (feedPoster === POSTER_USER) {
                addUserPost($("#tinyfeed-compose-input").val());
                $("#tinyfeed-compose-input").val("").css("height", "");
                applyFeedComposeMode();
            } else {
                generateFeedPost();
            }
        });
        // ปุ่มยกเลิก: ระหว่างเจน = ยกเลิกการเจน · ปกติ = เคลียร์ช่อง + กลับเป็นโพสต์เอง
        $(document).on("click", "#tinyfeed-compose-cancel", function () {
            if (isGenerating) { cancelFeedGen(); return; }
            $("#tinyfeed-compose-input").val("").css("height", "");
            $("#tinyfeed-feed-guidance").val("");
            feedPoster = POSTER_USER;
            applyFeedComposeMode();
        });
        $(document).on("click", ".tinyfeed-delete", function (e) {
            e.stopPropagation();
            deleteUserPost($(this).data("post"));
        });
        // char picker (ใช้ร่วม feed/stream)
        $(document).on("click", "#tinyfeed-char-picker-close", closeCharPicker);
        $(document).on("click", "#tinyfeed-char-picker", function (e) {
            if (e.target === this) closeCharPicker();
        });
        $(document).on("click", ".tinyfeed-char-pick", function () {
            pickChar(String($(this).data("value")));
        });
        // กดแจ้งเตือน → เปิดฟีด
        $(document).on("click", "#tinyfeed-notif", openFeedFromNotif);

        // ลิ้นชักแจ้งเตือน
        $(document).on("click", "#tinyfeed-notif-bell", function () { toggleNotifDrawer(); });
        $(document).on("click", "#tinyfeed-notif-drawer-close", function () { toggleNotifDrawer(false); });
        $(document).on("click", "#tinyfeed-notif-clear", function () {
            notifLog.length = 0;
            persistNotifLog();
            recomputeBellUnread();
            renderNotifDrawer();
        });
        $(document).on("click", ".tinyfeed-notif-item", function () {
            const e = notifLog[parseInt($(this).data("idx"), 10)];
            if (e) { toggleNotifDrawer(false); routeFromNotif(e); }
        });

        // ให้กลุ่มคุยกันต่อ (ปุ่มสั่งเอง)
        $(document).on("click", "#tinyfeed-group-continue", function () {
            if (activeThread && findGroup(activeThread)) groupSelfChat(activeThread, {});
        });
        // ให้ตัวละครตอบกลับ(แชต 1:1) — หลังผู้ใช้พิมพ์/แนบครบแล้ว
        $(document).on("click", "#tinyfeed-connect-reply", function () {
            if (activeThread && !findGroup(activeThread)) generateConnectReply();
        });

        // Stage 8: คอมเมนต์
        $(document).on("click", ".tinyfeed-comment-send", function () {
            const input = $(this).closest(".tinyfeed-comment-compose").find(".tinyfeed-comment-input");
            addComment($(this).data("post"), input.val());
        });
        $(document).on("click", ".tinyfeed-comment-sticker", function () {
            const postId = $(this).data("post");
            openGalleryPicker("sticker", (token) => addComment(postId, token));
        });
        $(document).on("keydown", ".tinyfeed-comment-input", function (e) {
            if (e.key === "Enter") {
                e.preventDefault();
                addComment($(this).data("post"), $(this).val());
            }
        });
        $(document).on("click", ".tinyfeed-ai-reply", function () {
            generateCommentReply($(this).data("post"));
        });
        // ปุ่มให้ NPC มาคอมเมนต์โพสต์ (โผล่เฉพาะโพสต์ที่ยังไม่มีคอมเมนต์)
        $(document).on("click", ".tinyfeed-gen-comments", function (e) {
            e.stopPropagation();   // กันเด้งเข้าหน้ารายละเอียด
            generateCommentsForPost($(this).data("post"));
        });
        // ลบคอมเมนต์ที่ไม่ต้องการ
        $(document).on("click", ".tinyfeed-comment-del", function (e) {
            e.stopPropagation();   // กันเด้งเข้าหน้ารายละเอียด (ตอนกดในการ์ดฟีด)
            deleteComment($(this).data("post"), parseInt($(this).data("cidx"), 10));
        });

        // Stage 5: หน้า settings ในโทรศัพท์
        $(document).on("click", "#tinyfeed-settings-btn", openSettings);
        // เลือกหัวข้อตั้งค่า (ระดับ 1 → ระดับ 2)
        $(document).on("click", ".tinyfeed-settings-row", function () {
            openSettingsGroup($(this).data("group"));
        });
        // วอลเปเปอร์หน้าโฮม
        $(document).on("input", "#tinyfeed-cfg-wallpaper", function () {
            setSetting("wallpaperUrl", $(this).val().trim());
            applyWallpaper();
        });
        $(document).on("input", "#tinyfeed-cfg-wp-overlay", function () {
            let v = parseInt($(this).val(), 10);
            if (!Number.isFinite(v)) v = 45;
            setSetting("wallpaperOverlay", v);
            $("#tinyfeed-wp-overlay-val").text(`${v}%`);
            applyWallpaper();
        });
        // ===== โปรไฟล์ผู้ใช้ (ผูก persona) =====
        $(document).on("input", "#tinyfeed-cfg-user-avatar", function () {
            setProfileField("user", "avatarUrl", $(this).val().trim());
            renderFeed();
        });
        $(document).on("input", "#tinyfeed-cfg-user-username", function () {
            setProfileField("user", "username", $(this).val()); renderFeed();
        });
        $(document).on("input", "#tinyfeed-cfg-user-alias", function () {
            setProfileField("user", "alias", $(this).val()); renderFeed();
        });
        $(document).on("change", "#tinyfeed-cfg-user-primary", function () {
            setProfileField("user", "primary", $(this).val()); renderFeed();
        });
        // ===== โปรไฟล์ตัวละคร (ผูกการ์ด) =====
        $(document).on("input", "#tinyfeed-cfg-char-avatar", function () {
            setProfileField("char", "avatarUrl", $(this).val().trim()); renderFeed();
        });
        $(document).on("input", "#tinyfeed-cfg-char-username", function () {
            setProfileField("char", "username", $(this).val()); renderFeed();
        });
        $(document).on("input", "#tinyfeed-cfg-char-alias", function () {
            setProfileField("char", "alias", $(this).val()); renderFeed();
        });
        $(document).on("change", "#tinyfeed-cfg-char-primary", function () {
            setProfileField("char", "primary", $(this).val()); renderFeed();
        });
        // ช่วงไลค์เริ่มต้นของโพสต์ AI (clamp ให้ >=0 และ max>=min)
        $(document).on("input", "#tinyfeed-cfg-likes-min", function () {
            let v = parseInt($(this).val(), 10);
            if (!Number.isFinite(v) || v < 0) v = 0;
            setSetting("likesMin", v);
            if (getSetting("likesMax") < v) setSetting("likesMax", v);
        });
        $(document).on("input", "#tinyfeed-cfg-likes-max", function () {
            let v = parseInt($(this).val(), 10);
            if (!Number.isFinite(v) || v < 0) v = 0;
            setSetting("likesMax", v);
        });
        // 6.6: จำนวนโพสต์ล่าสุดที่ให้ AI จำ
        $(document).on("input", "#tinyfeed-cfg-history", function () {
            let v = parseInt($(this).val(), 10);
            if (!Number.isFinite(v) || v < 0) v = 0;
            setSetting("historyCount", v);
        });

        // 6.5: รายชื่อ NPC ประจำ (ผูกกับแชท)
        $(document).on("click", "#tinyfeed-npc-add", function () {
            getNpcs().push({ name: "", avatar: "" });
            saveNpcs();
            renderNpcList();
        });
        $(document).on("input", ".tinyfeed-npc-name", function () {
            const i = $(this).closest(".tinyfeed-npc-row").data("index");
            const npcs = getNpcs();
            if (npcs[i]) { npcs[i].name = $(this).val(); saveNpcs(); renderFeed(); }
        });
        $(document).on("input", ".tinyfeed-npc-avatar", function () {
            const i = $(this).closest(".tinyfeed-npc-row").data("index");
            const npcs = getNpcs();
            if (npcs[i]) { npcs[i].avatar = $(this).val().trim(); saveNpcs(); renderFeed(); }
        });
        $(document).on("click", ".tinyfeed-npc-del", function () {
            const i = $(this).closest(".tinyfeed-npc-row").data("index");
            const npcs = getNpcs();
            if (npcs[i]) { npcs.splice(i, 1); saveNpcs(); renderNpcList(); renderFeed(); }
        });

        // ตั้งค่าล่วงหน้าฟีเจอร์อนาคต (เก็บค่าไว้ก่อน)
        $(document).on("change", "#tinyfeed-cfg-auto", function () {
            setSetting("autoGenerate", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-auto-mode", function () {
            setSetting("autoGenerateMode", $(this).val());
        });
        $(document).on("input", "#tinyfeed-cfg-interval", function () {
            const n = parseInt($(this).val(), 10);
            setSetting("autoGenerateInterval", Number.isFinite(n) && n > 0 ? n : 10);
        });
        $(document).on("change", "#tinyfeed-cfg-comment-mode", function () {
            setSetting("commentReplyMode", $(this).val());
        });
        $(document).on("change", "#tinyfeed-cfg-initcomment-mode", function () {
            setSetting("initialCommentMode", $(this).val());
        });
        $(document).on("input", "#tinyfeed-cfg-initcomment-count", function () {
            let v = parseInt($(this).val(), 10);
            if (!Number.isFinite(v) || v < 1) v = 1;
            setSetting("initialCommentCount", v);
        });
        // Stage 9: config ข่าว
        $(document).on("change", "#tinyfeed-cfg-news-auto", function () {
            setSetting("newsAutoGenerate", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-news-mode", function () {
            setSetting("newsAutoMode", $(this).val());
        });
        $(document).on("input", "#tinyfeed-cfg-news-interval", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("newsAutoInterval", Number.isFinite(v) && v > 0 ? v : 20);
        });
        $(document).on("input", "#tinyfeed-cfg-news-history", function () {
            let v = parseInt($(this).val(), 10);
            if (!Number.isFinite(v) || v < 0) v = 0;
            setSetting("newsHistoryCount", v);
        });
        // Stage 10: toggle แจ้งเตือน
        $(document).on("change", "#tinyfeed-cfg-notif", function () {
            const on = $(this).prop("checked");
            setSetting("notificationsEnabled", on);
            if (!on) clearUnread();   // ปิดแล้วเก็บจุดแดงที่ค้างด้วย
        });
        // แจ้งเตือน OS จริง
        $(document).on("change", "#tinyfeed-cfg-osnotif", function () {
            const on = $(this).prop("checked");
            setSetting("osNotifEnabled", on);
            if (on) ensureNotifPermission();
        });
        $(document).on("click", "#tinyfeed-osnotif-test", testOsNotif);
        // ทักเชิงรุก
        $(document).on("change", "#tinyfeed-cfg-proactive", function () {
            const on = $(this).prop("checked");
            setSetting("proactiveEnabled", on);
            if (on) { lastProactiveTs = 0; startProactiveTimer(); }
            else stopProactiveTimer();
        });
        $(document).on("input", "#tinyfeed-cfg-proactive-interval", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("proactiveIntervalMin", Number.isFinite(v) && v > 0 ? v : 20);
        });
        $(document).on("input", "#tinyfeed-cfg-proactive-chance", function () {
            let v = parseInt($(this).val(), 10);
            if (!Number.isFinite(v)) v = 50;
            setSetting("proactiveChance", v);
            $("#tinyfeed-proactive-chance-val").text(`${v}%`);
        });
        $(document).on("input", "#tinyfeed-cfg-quiet-from", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("proactiveQuietFrom", Number.isFinite(v) ? ((v % 24) + 24) % 24 : 0);
        });
        $(document).on("input", "#tinyfeed-cfg-quiet-to", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("proactiveQuietTo", Number.isFinite(v) ? ((v % 24) + 24) % 24 : 0);
        });
        $(document).on("input", "#tinyfeed-cfg-proactive-tokens", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("proactiveTokens", Number.isFinite(v) && v > 0 ? v : 120);
        });
        $(document).on("change", "#tinyfeed-cfg-group-autochat", function () {
            setSetting("groupAutoChat", $(this).prop("checked"));
        });
        $(document).on("input", "#tinyfeed-cfg-proactive-idle", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("proactiveIdleMin", Number.isFinite(v) && v >= 0 ? v : 0);
        });
        $(document).on("change", "#tinyfeed-cfg-proactive-timeaware", function () {
            setSetting("proactiveTimeAware", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-proactive-viafeed", function () {
            setSetting("proactiveViaFeed", $(this).prop("checked"));
        });
        // Phase 2: เลือกโมเดล/API
        $(document).on("change", "#tinyfeed-cfg-api-profile", function () {
            setSetting("apiProfile", $(this).val());
        });
        $(document).on("input", "#tinyfeed-cfg-api-context", function () {
            let v = parseInt($(this).val(), 10);
            if (!Number.isFinite(v) || v < 0) v = 0;
            setSetting("apiContextMessages", v);
        });
        $(document).on("input", "#tinyfeed-cfg-wi-limit", function () {
            let v = parseInt($(this).val(), 10);
            if (!Number.isFinite(v) || v < 0) v = 0;
            setSetting("worldInfoLimit", v);
        });
        // TinyStream config
        $(document).on("change", "#tinyfeed-cfg-stream-mode", function () {
            setSetting("streamCommentMode", $(this).val());
            if (currentApp === "stream") { renderStream(); maybeStartStreamTimer(); }
        });
        $(document).on("input", "#tinyfeed-cfg-stream-bg", function () {
            setSetting("streamBgUrl", $(this).val().trim());
            applyStreamBg();
        });
        $(document).on("change", "#tinyfeed-cfg-stream-bg-theme", function () {
            setSetting("streamBgTheme", $(this).prop("checked"));
            applyStreamBg();
        });
        $(document).on("input", "#tinyfeed-cfg-stream-interval", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("streamAutoInterval", Number.isFinite(v) && v >= 4 ? v : 12);
            if (currentApp === "stream") maybeStartStreamTimer();
        });
        $(document).on("input", "#tinyfeed-cfg-stream-tokens", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("streamTokens", Number.isFinite(v) && v > 0 ? v : 300);
        });
        $(document).on("input", "#tinyfeed-cfg-stream-extra", function () {
            setSetting("streamExtraPrompt", $(this).val());
        });
        $(document).on("change", "#tinyfeed-cfg-stream-reply", function () {
            setSetting("streamStreamerReply", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-stream-talk", function () {
            setSetting("streamStreamerTalk", $(this).prop("checked"));
            if (currentApp === "stream") maybeStartStreamTimer();   // เปิด/ปิดมอโนล็อกทันที
        });
        $(document).on("change", "#tinyfeed-cfg-connect-auto", function () {
            setSetting("connectAutoGenerate", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-connect-mode", function () {
            setSetting("connectAutoMode", $(this).val());
        });
        $(document).on("input", "#tinyfeed-cfg-connect-interval", function () {
            const v = parseInt($(this).val(), 10);
            setSetting("connectAutoInterval", Number.isFinite(v) && v > 0 ? v : 12);
        });
        $(document).on("input", "#tinyfeed-cfg-connect-tokens", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("connectTokens", Number.isFinite(v) && v > 0 ? v : 200);
        });
        $(document).on("input", "#tinyfeed-cfg-connect-extra", function () {
            setSetting("connectExtraPrompt", $(this).val());
        });
        $(document).on("change", "#tinyfeed-cfg-connect-split", function () {
            setSetting("connectSplitBubbles", $(this).prop("checked"));
            if (currentApp === "connect" && isConnectThreadOpen()) renderThread();
        });
        $(document).on("change", "#tinyfeed-cfg-connect-slip", function () {
            setSetting("connectSlipEnabled", $(this).prop("checked"));
        });

        // Phase 2: token + คำสั่งเสริม
        $(document).on("input", "#tinyfeed-cfg-post-tokens", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("postTokens", Number.isFinite(v) && v > 0 ? v : 400);
        });
        $(document).on("input", "#tinyfeed-cfg-post-extra", function () {
            setSetting("postExtraPrompt", $(this).val());
        });
        $(document).on("input", "#tinyfeed-cfg-news-tokens", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("newsTokens", Number.isFinite(v) && v > 0 ? v : 500);
        });
        $(document).on("input", "#tinyfeed-cfg-news-extra", function () {
            setSetting("newsExtraPrompt", $(this).val());
        });
        // Phase 2: แทรกฟีดเข้าประวัติแชท
        $(document).on("change", "#tinyfeed-cfg-inject-mode", function () {
            setSetting("injectMode", $(this).val());
            updateChatInjection();
        });
        $(document).on("change", "#tinyfeed-cfg-inject-connect", function () {
            setSetting("injectConnect", $(this).prop("checked"));
            updateChatInjection();
        });
        $(document).on("change", "#tinyfeed-cfg-inject-stream", function () {
            setSetting("injectStream", $(this).prop("checked"));
            updateChatInjection();
        });
        $(document).on("change", "#tinyfeed-cfg-inject-memo", function () {
            setSetting("injectMemo", $(this).prop("checked"));
            updateChatInjection();
        });
        $(document).on("change", "#tinyfeed-cfg-inject-forum", function () {
            setSetting("injectForum", $(this).prop("checked"));
            updateChatInjection();
        });
        $(document).on("change", "#tinyfeed-cfg-inject-forum-comments", function () {
            setSetting("injectForumComments", $(this).prop("checked"));
            updateChatInjection();
        });
        $(document).on("change", "#tinyfeed-cfg-inject-bank", function () {
            setSetting("injectBank", $(this).prop("checked"));
            updateChatInjection();
        });
        $(document).on("change", "#tinyfeed-cfg-inject-shop", function () {
            setSetting("injectShop", $(this).prop("checked"));
            updateChatInjection();
        });
        $(document).on("change", "#tinyfeed-cfg-inject-pet", function () {
            setSetting("injectPet", $(this).prop("checked"));
            updateChatInjection();
        });
        $(document).on("change", "#tinyfeed-cfg-inject-theater", function () {
            setSetting("injectTheater", $(this).prop("checked"));
            updateChatInjection();
        });
        $(document).on("change", "#tinyfeed-cfg-inject-novel", function () {
            setSetting("injectNovel", $(this).prop("checked"));
            updateChatInjection();
        });
        $(document).on("change", "#tinyfeed-cfg-crossapp", function () {
            setSetting("crossAppEnabled", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-crossapp-feed", function () {
            setSetting("crossAppFeed", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-crossapp-comments", function () {
            setSetting("crossAppComments", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-crossapp-news", function () {
            setSetting("crossAppNews", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-crossapp-connect", function () {
            setSetting("crossAppConnect", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-crossapp-stream", function () {
            setSetting("crossAppStream", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-crossapp-memo", function () {
            setSetting("crossAppMemo", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-crossapp-forum", function () {
            setSetting("crossAppForum", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-crossapp-bank", function () {
            setSetting("crossAppBank", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-crossapp-shop", function () {
            setSetting("crossAppShop", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-crossapp-pet", function () {
            setSetting("crossAppPet", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-crossapp-theater", function () {
            setSetting("crossAppTheater", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-crossapp-novel", function () {
            setSetting("crossAppNovel", $(this).prop("checked"));
        });
        $(document).on("input", "#tinyfeed-cfg-crossapp-count", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("crossAppCount", Number.isFinite(v) && v > 0 ? v : 3);
        });
        $(document).on("input", "#tinyfeed-cfg-inject-count", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("injectCount", Number.isFinite(v) && v > 0 ? v : 5);
            updateChatInjection();
        });
        $(document).on("input", "#tinyfeed-cfg-inject-depth", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("injectDepth", Number.isFinite(v) && v >= 0 ? v : 4);
            updateChatInjection();
        });

        // TinyMemo settings
        $(document).on("change", "#tinyfeed-cfg-memo-auto", function () {
            setSetting("memoAutoGenerate", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-memo-mode", function () {
            setSetting("memoAutoMode", $(this).val());
        });
        $(document).on("input", "#tinyfeed-cfg-memo-interval", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("memoAutoInterval", Number.isFinite(v) && v > 0 ? v : 15);
        });
        $(document).on("input", "#tinyfeed-cfg-memo-tokens", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("memoTokens", Number.isFinite(v) && v > 0 ? v : 350);
        });
        $(document).on("input", "#tinyfeed-cfg-memo-extra", function () {
            setSetting("memoExtraPrompt", $(this).val());
        });

        // TinyForum settings
        $(document).on("change", "#tinyfeed-cfg-forum-auto", function () {
            setSetting("forumAutoGenerate", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-forum-mode", function () {
            setSetting("forumAutoMode", $(this).val());
        });
        $(document).on("input", "#tinyfeed-cfg-forum-interval", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("forumAutoInterval", Number.isFinite(v) && v > 0 ? v : 20);
        });
        $(document).on("input", "#tinyfeed-cfg-forum-tokens", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("forumTokens", Number.isFinite(v) && v > 0 ? v : 500);
        });
        $(document).on("input", "#tinyfeed-cfg-forum-batch", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("forumCommentBatch", Number.isFinite(v) && v > 0 ? v : 8);
        });
        $(document).on("input", "#tinyfeed-cfg-forum-extra", function () {
            setSetting("forumExtraPrompt", $(this).val());
        });
        // ทริกเกอร์ด้วยคีย์เวิร์ด
        $(document).on("input", ".tinyfeed-kw-text", function () {
            const app = $(this).data("app");
            const setting = KEYWORD_SETTING[app];
            if (setting) setSetting(setting, $(this).val());
        });
        $(document).on("input", "#tinyfeed-cfg-kw-cooldown", function () {
            setSetting("keywordCooldownSec", Math.max(0, parseInt($(this).val(), 10) || 0));
        });
        $(document).on("change", "#tinyfeed-cfg-kw-scope", function () {
            setSetting("keywordScope", $(this).val());
        });
        // TinyPet config
        $(document).on("change", "#tinyfeed-cfg-pet-ai", function () {
            setSetting("petAiReactions", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-pet-autopost", function () {
            setSetting("petAutoPost", $(this).prop("checked"));
        });
        $(document).on("input", "#tinyfeed-cfg-pet-tokens", function () {
            const v = parseInt($(this).val(), 10);
            setSetting("petTokens", Number.isFinite(v) && v > 0 ? v : 60);
        });
        $(document).on("input", "#tinyfeed-cfg-pet-extra", function () {
            setSetting("petExtraPrompt", $(this).val());
        });
        $(document).on("input", "#tinyfeed-cfg-novel-tokens", function () {
            const v = parseInt($(this).val(), 10);
            setSetting("novelTokens", Number.isFinite(v) && v > 0 ? v : 850);
        });
        $(document).on("input", "#tinyfeed-cfg-novel-extra", function () {
            setSetting("novelExtraPrompt", $(this).val());
        });
        $(document).on("input", "#tinyfeed-cfg-pet-decay-hunger", function () {
            const v = parseFloat($(this).val());
            setSetting("petDecayHunger", Number.isFinite(v) && v >= 0 ? v : 0.5);
        });
        $(document).on("input", "#tinyfeed-cfg-pet-decay-energy", function () {
            const v = parseFloat($(this).val());
            setSetting("petDecayEnergy", Number.isFinite(v) && v >= 0 ? v : 0.35);
        });
        $(document).on("input", "#tinyfeed-cfg-pet-decay-clean", function () {
            const v = parseFloat($(this).val());
            setSetting("petDecayClean", Number.isFinite(v) && v >= 0 ? v : 0.3);
        });
        $(document).on("input", "#tinyfeed-cfg-pet-offline", function () {
            const v = parseInt($(this).val(), 10);
            setSetting("petOfflineCapHours", Number.isFinite(v) && v > 0 ? v : 12);
        });
        $(document).on("input", "#tinyfeed-cfg-pet-coinrate", function () {
            const v = parseInt($(this).val(), 10);
            setSetting("petCoinRate", Number.isFinite(v) && v > 0 ? v : 1);
        });
        $(document).on("input", ".tinyfeed-pet-sprite-url", function () {
            const key = String($(this).data("key") || "");
            if (!key) return;
            const map = Object.assign({}, getSetting("petSprites") || {});
            const url = String($(this).val() || "").trim();
            if (url) map[key] = url; else delete map[key];
            setSetting("petSprites", map);
            if (currentApp === "pet") renderPet();   // เห็นผลทันที
        });
        $(document).on("change", "#tinyfeed-pet-sprite-stage", function () {
            petSpriteCfgStage = String($(this).val() || "baby");
            renderPetSpriteCfg();   // สลับระยะที่กำลังตั้งลิงก์รูป
        });
        $(document).on("change", "#tinyfeed-cfg-gallery-prompt", function () {
            setSetting("galleryPrompt", $(this).prop("checked"));
        });
        // TinyBank config
        $(document).on("input", "#tinyfeed-cfg-bank-currency", function () {
            setSetting("bankCurrency", String($(this).val() || "฿").trim() || "฿");
            if (currentApp === "bank") renderBank();
            if (currentApp === "shop") renderShop();
        });
        $(document).on("change", "#tinyfeed-cfg-bank-currency-pos", function () {
            setSetting("bankCurrencyAfter", $(this).val() === "after");
            if (currentApp === "bank") renderBank();
            if (currentApp === "shop") renderShop();
        });
        $(document).on("change", "#tinyfeed-cfg-donate-enabled", function () {
            setSetting("streamDonateEnabled", $(this).prop("checked"));
        });
        $(document).on("input", "#tinyfeed-cfg-bank-donate-max", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("bankDonateMax", Number.isFinite(v) && v > 0 ? v : 5000);
        });
        // ตัวแก้ tier โดเนท (ไม่ re-render ตอนพิมพ์ min/สี กันเคอร์เซอร์เด้ง)
        $(document).on("input", ".tinyfeed-donate-tier-min", function () {
            const i = $(this).closest(".tinyfeed-donate-tier-row").data("index");
            const tiers = getDonateTiers();
            if (!tiers[i]) return;
            tiers[i].min = Math.max(0, parseInt($(this).val(), 10) || 0);
            setSetting("donateTiers", tiers);
        });
        $(document).on("input", ".tinyfeed-donate-tier-color", function () {
            const i = $(this).closest(".tinyfeed-donate-tier-row").data("index");
            const tiers = getDonateTiers();
            if (!tiers[i]) return;
            tiers[i].color = String($(this).val() || "#1d9bf0");
            setSetting("donateTiers", tiers);
        });
        $(document).on("click", ".tinyfeed-donate-tier-del", function () {
            const i = $(this).closest(".tinyfeed-donate-tier-row").data("index");
            const tiers = getDonateTiers();
            tiers.splice(i, 1);
            setSetting("donateTiers", tiers);
            renderDonateTiers();
        });
        $(document).on("click", "#tinyfeed-donate-tier-add", function () {
            const tiers = getDonateTiers();
            const nextMin = tiers.length ? Math.max(...tiers.map((t) => t.min)) + 500 : 0;
            tiers.push({ min: nextMin, color: "#888888" });
            setSetting("donateTiers", tiers);
            renderDonateTiers();
        });
        $(document).on("change", "#tinyfeed-cfg-gallery-scope", function () {
            setSetting("galleryPromptScope", $(this).val());
            galleryCfgPage = 0;
            renderGalleryCfgAlbums();
        });
        $(document).on("change", ".tinyfeed-cfg-gallery-album", function () {
            const val = String($(this).val());
            const set = new Set((getSetting("galleryAlbums") || []).map((a) => String(a)));
            if ($(this).prop("checked")) set.add(val); else set.delete(val);
            setSetting("galleryAlbums", Array.from(set));
        });
        $(document).on("click", "#tinyfeed-cfg-gallery-albums-prev", function () {
            galleryCfgPage--; renderGalleryCfgAlbums();
        });
        $(document).on("click", "#tinyfeed-cfg-gallery-albums-next", function () {
            galleryCfgPage++; renderGalleryCfgAlbums();
        });
        $(document).on("input", "#tinyfeed-cfg-gallery-max-images", function () {
            const v = parseInt($(this).val(), 10);
            setSetting("galleryMaxImages", Number.isFinite(v) && v > 0 ? v : 24);
        });
        $(document).on("input", "#tinyfeed-cfg-gallery-max-stickers", function () {
            const v = parseInt($(this).val(), 10);
            setSetting("galleryMaxStickers", Number.isFinite(v) && v > 0 ? v : 24);
        });
        // ตัวแก้ห้อง (global setting forumRooms)
        $(document).on("input", ".tinyfeed-room-name", function () {
            const i = $(this).closest(".tinyfeed-room-row").data("index");
            const rooms = getForumRooms().slice();
            rooms[i] = $(this).val();
            setSetting("forumRooms", rooms);
        });
        $(document).on("click", ".tinyfeed-room-del", function () {
            const i = $(this).closest(".tinyfeed-room-row").data("index");
            const rooms = getForumRooms().slice();
            rooms.splice(i, 1);
            setSetting("forumRooms", rooms);
            renderForumRooms();
        });
        $(document).on("click", "#tinyfeed-room-add", function () {
            const rooms = getForumRooms().slice();
            rooms.push("");
            setSetting("forumRooms", rooms);
            renderForumRooms();
        });
        // ตัวแก้หมวดสินค้า (global setting shopCategories)
        $(document).on("input", ".tinyfeed-shopcat-name", function () {
            const i = $(this).closest(".tinyfeed-shopcat-row").data("index");
            const cats = getShopCategories();
            cats[i] = $(this).val();
            setSetting("shopCategories", cats);
        });
        $(document).on("click", ".tinyfeed-shopcat-del", function () {
            const i = $(this).closest(".tinyfeed-shopcat-row").data("index");
            const cats = getShopCategories();
            cats.splice(i, 1);
            setSetting("shopCategories", cats);
            renderShopCats();
            if (currentApp === "shop") renderShop();
        });
        $(document).on("click", "#tinyfeed-shop-cat-add", function () {
            const cats = getShopCategories();
            cats.push("");
            setSetting("shopCategories", cats);
            renderShopCats();
        });
        $(document).on("input", "#tinyfeed-cfg-shop-tokens", function () {
            const v = parseInt($(this).val(), 10);
            setSetting("shopTokens", Number.isFinite(v) && v > 0 ? v : 400);
        });
        $(document).on("input", "#tinyfeed-cfg-shop-extra", function () {
            setSetting("shopExtraPrompt", $(this).val());
        });

        // เดสก์ท็อป (มีเมาส์/คีย์บอร์ด): ใบ้ว่ากด Shift+Enter ขึ้นบรรทัดใหม่ได้
        if (!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches)) {
            $("#tinyfeed-connect-input").attr("placeholder", "พิมพ์ข้อความ... (Shift+Enter ขึ้นบรรทัดใหม่)");
        }

        // โหลดค่าที่บันทึกไว้
        loadSettings();
        loadNotifLog();   // ประวัติแจ้งเตือน (persist)
        registerNotifSW();   // service worker สำหรับแจ้งเตือน OS บนมือถือ

        // เริ่มตัวจับเวลาทักเชิงรุก (ถ้าเปิดไว้) — เดินตลอดแม้ปิดหน้าแอป
        if (getSetting("proactiveEnabled")) startProactiveTimer();

        // TinyPet: ตัวจับเวลาพื้นหลัง (decay + แจ้งเตือนวิกฤต) — เดินตลอดเมื่อเปิด ST
        startPetTimer();

        console.log(`[${extensionName}] ✅ Loaded successfully`);
    } catch (error) {
        console.error(`[${extensionName}] ❌ Failed to load:`, error);
    }
});

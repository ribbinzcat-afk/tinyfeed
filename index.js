import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";
import { saveBase64AsFile } from "../../../utils.js";

// โมดูลย่อย (ดู CONVENTIONS.md บทที่ 7 — module layout)
import {
    extensionName, extensionFolderPath,
    defaultSettings, flushAllSaves, getFeedData, getGallery, getSetting, saveFeedDataDebounced, saveGallery, setSetting,
} from "./src/store.js";
import {
    cleanAiName, displayTime, downscaleImageFile, escapeAttr, escapeHtml, escapeText, findGalleryImage, formatChatTime, htmlToPlain,
    itemTimestamp, renderImgToken, renderRich, renderStickerToken, resolveMediaPriority,
    setMentionUserResolver, stripReasoning, stripWrapBrackets, timeAgo, unescapeLite,
} from "./src/util.js";
import {
    composeBarHtml, emptyInlineHtml, emptyStateHtml, skeletonCardHtml, uploadBtnHtml,
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
    cleanupLegacyGlobalScope();   // ล้าง shop/bankCurrency global เก่าที่ค้างจากก่อนย้าย scope (ครั้งเดียว)
    const enabled = extension_settings[extensionName].enabled;
    $("#tinyfeed-enabled").prop("checked", enabled);
    applyMenuVisibility(enabled);
    applyAllTheming();   // ธีม/วอลเปเปอร์/สีเน้น — อ่านผ่าน themeValue() จึงเคารพธีมเฉพาะ persona อัตโนมัติ
}

// ใส่วอลเปเปอร์หน้าโฮม (ลิงก์ภายนอก)
function applyWallpaper() {
    const url = String(themeValue("wallpaperUrl") || "").trim();
    const home = $("#tinyfeed-home");
    if (url) {
        home.css("background-image", `url("${url.replace(/["\\]/g, "")}")`)
            .addClass("tinyfeed-has-wallpaper");
    } else {
        home.css("background-image", "").removeClass("tinyfeed-has-wallpaper");
    }
    // ความทึบ scrim ที่ทับวอลเปเปอร์ (0–100% → 0.0–1.0)
    let ov = parseInt(themeValue("wallpaperOverlay"), 10);
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
// true = เปิดเครื่องข้ามการ restoreLastScreen() ไปเพราะตอนนั้นสายกำลังเรียกเข้าอยู่ — ต้องกลับมา
// restore ให้ทีหลังตอนสายจบ (ดู endCall/abortActiveCall) ไม่งั้นเจอหน้าโฮมที่ยังไม่เคย render อะไรเลย (ว่างเปล่า)
let pendingScreenRestore = false;

function openPhone() {
    $("#tinyfeed-overlay").addClass("tinyfeed-visible");
    clearUnread();          // เปิดดูแล้ว เคลียร์จุดแดง
    flushDueScheduled();    // ข้อความตั้งเวลาที่ถึงกำหนดระหว่างปิดเครื่อง — โผล่พร้อม timestamp ย้อนหลังตามจริง
    // สายกำลังเรียกเข้าอยู่ (ยังไม่รับ) — หน้าจอสายพร้อมโชว์อยู่แล้ว ห้ามเรียก restoreLastScreen()
    // เพราะมันไปทาง goHome()/openApp() ที่เรียก closeOpenOverlays() ซึ่งจะวางสายทิ้งทันที (endCall ผูกกับ OVERLAYS)
    if (activeCall && !activeCall.answered) {
        pendingScreenRestore = true;
    } else {
        restoreLastScreen();
    }
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
            // สตอรี่/โน้ตหมดอายุตามเวลาจริง และ AI อาจลงเพิ่มตอนไม่ได้เปิดแอปอยู่ → วาดแถบใหม่ทุกครั้งที่เข้าแอป
            renderStoryBar();
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
        id: "ask", name: "TinyAsk", icon: "fa-circle-question", a: "#6366f1", b: "#4338ca",
        panel: "#tinyfeed-app-ask", home: true, remember: true,
        open() { openAsk(); },
    },
    {
        id: "bag", name: "TinyBag", label: "กระเป๋า", icon: "fa-box-open", a: "#0ea5e9", b: "#0369a1",
        panel: "#tinyfeed-app-bag", home: true, remember: true,
        open() { renderBag(); },
    },
];

const APP_BY_ID = Object.fromEntries(APPS.map((a) => [a.id, a]));

/* ทะเบียน overlay/modal — ใช้ร่วมกันระหว่าง openApp (กันค้างข้ามแอป) และ handleBack (ปุ่มย้อนกลับ)
 * เดิมสองที่นี้ถือลิสต์คนละชุด → char-profile ปิดด้วยปุ่มย้อนกลับไม่ได้ */
const OVERLAYS = [
    { sel: "#tinyfeed-gallery-picker", close: closeGalleryOverlays },
    { sel: "#tinyfeed-gallery-view", close: closeGalleryOverlays },
    { sel: "#tinyfeed-gallery-edit", close: closeGalleryOverlays },
    { sel: "#tinyfeed-char-picker", close: closeCharPicker },
    { sel: "#tinyfeed-story-viewer", close: closeStoryViewer },
    { sel: "#tinyfeed-story-compose", close: closeStoryCompose },
    { sel: "#tinyfeed-story-text-edit", close: closeStoryTextEdit },
    { sel: "#tinyfeed-storynote-edit", close: closeStoryNoteEdit },
    { sel: "#tinyfeed-storynote-view", close: closeStoryNoteView },
    { sel: "#tinyfeed-profile-screen", close: closeProfileScreen },
    { sel: "#tinyfeed-profile-post", close: closeProfilePost },
    { sel: "#tinyfeed-profile-edit", close: closeProfileEdit },
    { sel: "#tinyfeed-group-edit-modal", close: closeGroupEditModal },
    { sel: "#tinyfeed-slip-modal", close: closeSlipModal },
    { sel: "#tinyfeed-connect-bg-modal", close: closeConnectBgModal },
    { sel: "#tinyfeed-donate-modal", close: closeDonateModal },
    { sel: "#tinyfeed-shop-edit-modal", close: closeShopEditModal },
    { sel: "#tinyfeed-pet-shop-modal", close: closePetShop },
    { sel: "#tinyfeed-pet-item-modal", close: closePetItemModal },
    { sel: "#tinyfeed-pet-topup-modal", close: closePetTopup },
    { sel: "#tinyfeed-pet-game-modal", close: closePetGame },
    { sel: "#tinyfeed-ask-send-modal", close: closeAskSendModal },
    { sel: "#tinyfeed-bank-review-modal", close: closeBankReviewModal },
    { sel: "#tinyfeed-dest-picker", close: closeConnectDestPicker },
    { sel: "#tinyfeed-giftbag-modal", close: closeGiftFromBag },
    { sel: "#tinyfeed-share-menu", close: closeShareMenu },
    { sel: "#tinyfeed-call-screen", close: endCall },
    { sel: "#tinyfeed-call-detail-modal", close: closeCallDetail },
    { sel: "#tinyfeed-connect-sched", close: closeConnectSchedModal },
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
    cancelConnectQuote();   // ชิปอ้างโน้ตต้องไม่ค้างข้ามหน้าจอ (openApp/goHome เรียกจุดนี้ทั้งคู่)
    clearConnectReveal();
    clearStreamTimer();
    clearHomeClock();
    clearPetLiveTick();
}

let currentApp = "home";

function goHome() {
    currentApp = "home";
    if (quoteTarget) cancelQuotePost();   // ออกจากฟีดแล้วเลิกโควทที่ค้างไว้ ไม่ให้ข้ามหน้าจอ
    clearScreenTimers();
    closeOpenOverlays();
    $(".tinyfeed-app").addClass("tinyfeed-hidden");
    $("#tinyfeed-settings-screen").addClass("tinyfeed-hidden");
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
    if (id !== "feed" && quoteTarget) cancelQuotePost();   // สลับไปแอปอื่นแล้วเลิกโควทที่ค้างไว้ (id==="feed" = ยังอยู่หน้าเดิม ไม่ต้องยกเลิก)
    clearScreenTimers();
    closeOpenOverlays();   // กัน overlay ค้างข้ามแอป
    $("#tinyfeed-home").addClass("tinyfeed-hidden");
    $(".tinyfeed-app").addClass("tinyfeed-hidden");
    $("#tinyfeed-settings-screen").addClass("tinyfeed-hidden");
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

// พื้นหลังห้องแชต — แยกต่อห้อง (getConnectData().threadBg[key]) ไม่ตั้งเอง = ใช้ค่ากลาง (connectBgUrl) ไม่มีทั้งคู่ = พื้นธีมปกติ
function applyConnectBg(key) {
    const box = document.getElementById("tinyfeed-connect-messages");
    if (!box) return;
    const perRoom = String((getConnectData().threadBg || {})[key] || "").trim();
    const url = perRoom || String(getSetting("connectBgUrl") || "").trim();
    if (url) {
        // ตั้งผ่าน custom property แทน box.style.backgroundImage ตรงๆ — ให้ CSS (.tinyfeed-has-bg)
        // เป็นคนผสมฝ้ากับรูปเป็น background-image เดียวกัน กันฝ้าเลื่อนหายตอนสกรอลล์ (ดู style.css)
        box.style.setProperty("--tf-connect-bg-img", `url("${url.replace(/["\\]/g, encodeURIComponent)}")`);
        box.classList.add("tinyfeed-has-bg");
    } else {
        box.style.removeProperty("--tf-connect-bg-img");
        box.classList.remove("tinyfeed-has-bg");
    }
    let ov = parseInt(getSetting("connectBgOverlay"), 10);
    if (!Number.isFinite(ov)) ov = 45;
    ov = Math.min(100, Math.max(0, ov));
    box.style.setProperty("--tf-connect-bg-alpha", String(ov / 100));
}

// ปุ่มมอร์ฟช่องพิมพ์ TinyConnect: ว่าง = คทา (ให้ตอบกลับ/ให้กลุ่มคุยต่อ) · พิมพ์แล้ว = จรวด (ส่ง) ·
// กำลังรอ AI = สปินเนอร์ · ห้องเพ็ทไม่มี AI ตอบเลยซ่อนปุ่มตอนว่าง — เรียกซ้ำได้เสมอ (idempotent)
function updateConnectSendBtn() {
    const $btn = $("#tinyfeed-connect-send");
    if (!$btn.length || !activeThread) return;
    const $icon = $btn.find("i");
    const hasText = String($("#tinyfeed-connect-input").val() || "").trim().length > 0;
    $btn.removeClass("tinyfeed-connect-send-wand tinyfeed-connect-send-busy");

    if (isConnectReplying) {
        $btn.removeClass("tinyfeed-hidden").addClass("tinyfeed-connect-send-busy");
        $icon.attr("class", "fa-solid fa-spinner fa-spin");
        $btn.attr("title", "กำลังตอบ…");
        return;
    }
    if (hasText) {
        $btn.removeClass("tinyfeed-hidden");
        $icon.attr("class", "fa-solid fa-paper-plane");
        $btn.attr("title", "ส่ง");
        return;
    }
    if (activeThread === "pet") {
        $btn.addClass("tinyfeed-hidden");
        return;
    }
    const isGroup = Boolean(findGroup(activeThread));
    $btn.removeClass("tinyfeed-hidden").addClass("tinyfeed-connect-send-wand");
    $icon.attr("class", "fa-solid fa-wand-magic-sparkles");
    $btn.attr("title", isGroup ? "ให้กลุ่มคุยกันต่อ" : "ให้ตอบกลับ");
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
        saveFeedDataDebounced();
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
            title = cleanAiName(stripReasoning(raw).split("\n")[0]);
        }
        s.title = title || "ไลฟ์สด";
        s.direction = direction;
        s.live = true;
        s.viewers = 20 + Math.floor(Math.random() * 4800);
        s.comments.push({ isSystem: true, text: escapeText(`🔴 เริ่มไลฟ์ — ${s.title}`), ts: Date.now() });
        $("#tinyfeed-stream-title-input").val("");
        $("#tinyfeed-stream-direction-input").val("");
        saveFeedDataDebounced();
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
        const author = cleanAiName(parts[0]);
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
        if (s.comments.length > before) { saveFeedDataDebounced(); renderStream(); }
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
            saveFeedDataDebounced();
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
        const t = cleanAiName(stripReasoning(raw).split("\n")[0]);
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
    saveFeedDataDebounced();
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
    saveFeedDataDebounced();
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
    saveFeedDataDebounced();
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
    saveFeedDataDebounced();
    renderStream();
    toastr.success("ลบไลฟ์เก่าแล้ว", "TinyStream");
}

// ===== TinyBank: ธนาคาร/การเงิน (ผูกกับแชท) =====
function getBankData() {
    const data = getFeedData();
    if (!data.bank || typeof data.bank !== "object") data.bank = { balance: 0, txns: [] };
    if (typeof data.bank.balance !== "number" || !isFinite(data.bank.balance)) data.bank.balance = 0;
    if (!Array.isArray(data.bank.txns)) data.bank.txns = [];
    // รายการที่สแกนเจอจากบท RP แต่ยังไม่ได้กดรับ (รอรีวิว) — [{ id, dir, amount, label, ts }]
    if (!Array.isArray(data.bank.pending)) data.bank.pending = [];
    return data.bank;
}

/* สกุลเงินผูกกับการ์ดตัวละคร (เดิม global setting เดียวใช้ทุกเรื่อง — ย้ายตามคำขอผู้ใช้ 2026-08)
 * เก็บแบบเดียวกับ charProfiles/npcsByChar: object คีย์ด้วย getCharKey() ใน extension_settings
 * ไม่มีตัวละคร (เช่น ยังไม่ได้เลือกการ์ด) → fallback ไปค่า global เดิม (bankCurrency) เผื่อผู้ใช้เคยตั้งไว้ก่อนย้าย แล้วค่อย "฿" เป็นค่าสุดท้าย */
function getCharCurrencyStore() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (!extension_settings[extensionName].charCurrency || typeof extension_settings[extensionName].charCurrency !== "object") {
        extension_settings[extensionName].charCurrency = {};
    }
    return extension_settings[extensionName].charCurrency;
}
function getCharCurrency() {
    const key = getCharKey();
    const c = key ? getCharCurrencyStore()[key] : null;
    if (c && c.symbol) return { symbol: String(c.symbol), after: !!c.after };
    return { symbol: String(getSetting("bankCurrency") || "฿"), after: Boolean(getSetting("bankCurrencyAfter")) };
}
function setCharCurrency(field, value) {
    const key = getCharKey();
    if (!key) return;   // ไม่มีตัวละคร = ไม่มีที่ให้ผูก (ฟิลด์ใน UI จะถูก disable ไว้อยู่แล้ว)
    const store = getCharCurrencyStore();
    const cur = store[key] || {};
    cur[field] = value;
    store[key] = cur;
    saveSettingsDebounced();
}

function formatMoney(n) {
    const { symbol, after } = getCharCurrency();
    const num = Number(n || 0).toLocaleString();
    return after ? `${num}${symbol}` : `${symbol}${num}`;
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
    saveFeedDataDebounced();
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
        case "rp": return { icon: "fa-scroll", name: "จากบท RP" };
        default: return { icon: "fa-wallet", name: "ธนาคาร" };
    }
}

function renderBank() {
    const b = getBankData();
    $("#tinyfeed-bank-balance").text(formatMoney(b.balance));
    const pendingN = (b.pending || []).length;
    $("#tinyfeed-bankscan-btn span").text(pendingN ? `มีเงินรอรีวิว ${pendingN} รายการ` : "สแกนบท RP หาเงินเข้า-ออก");
    $("#tinyfeed-bankscan-btn").toggleClass("tinyfeed-bankscan-pending", pendingN > 0);
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

// ===== TinyBank: สแกนเงินจากบท RP — ให้ตรวจก่อนรับเสมอ ไม่เข้าบัญชีอัตโนมัติ =====
let isBankScanBusy = false;

// MONEY: <+จำนวน หรือ -จำนวน> | <รายละเอียด> — ทนขยะนำหน้า/ตัวเลขมีคอมมา/เครื่องหมายหาย (default = รับเข้า)
function parseBankScan(raw) {
    const s = stripReasoning(raw);
    const out = [];
    const re = /MONEY:\s*(.+)/gi;
    let m;
    while ((m = re.exec(s)) !== null) {
        const parts = m[1].split("|");
        const rawAmt = String(parts[0] || "").trim();
        const neg = rawAmt.trim().startsWith("-");
        const num = Math.abs(Math.round(parseFloat(rawAmt.replace(/[^\d.]/g, "")) || 0));
        const label = (parts.length >= 2 ? parts.slice(1).join("|") : "").trim();
        if (!num) continue;
        out.push({ dir: neg ? "out" : "in", amount: num, label: label || (neg ? "รายจ่ายจากบท RP" : "รายรับจากบท RP") });
    }
    return out;
}

// สแกนบทล่าสุด → เจอแล้วไปต่อคิว "รอรีวิว" (ไม่เข้าบัญชีทันที) — เปิดหน้ารีวิวให้เลยถ้าสั่งด้วยมือ
async function scanBankRp(opts) {
    opts = opts || {};
    if (isBankScanBusy) return;
    const ctx = getContext();
    if (typeof ctx.generateQuietPrompt !== "function") {
        if (!opts.silent) toastr.error("เวอร์ชัน SillyTavern นี้ไม่มี generateQuietPrompt", "TinyBank");
        return;
    }
    if (!getCurrentCharacter()) { if (!opts.silent) toastr.info("เปิดแชทที่มีตัวละครก่อนนะ", "TinyBank"); return; }
    isBankScanBusy = true;
    const btn = $("#tinyfeed-bankscan-btn");
    btn.addClass("tinyfeed-generating").prop("disabled", true);
    try {
        const b = getBankData();
        // กันสแกนซ้ำเหตุการณ์เดิม (บทล่าสุดที่ป้อนให้มักคาบเกี่ยวกับรอบก่อนหน้า) — บอก AI ว่าอะไรบันทึกไปแล้ว
        const already = [
            ...b.pending.map((x) => `${x.dir === "in" ? "+" : "-"}${x.amount} ${x.label}`),
            ...b.txns.filter((t) => t.app === "rp").slice(0, 10).map((t) => `${t.dir === "in" ? "+" : "-"}${t.amount} ${t.label}`),
        ];
        const extra = String(getSetting("bankScanExtraPrompt") || "").trim();
        const q = buildPrompt("bankScan", {
            recent: recentRpLines(15),
            existing: already.length ? `\nเหตุการณ์เกี่ยวกับเงินที่บันทึกไว้แล้ว (ห้ามรายงานซ้ำ):\n${already.join("\n")}\n` : "",
            extra: extra ? `คำสั่งเพิ่มเติม: ${extra}. ` : "",
            context: crossAppContext("bank"),
        });
        const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("bankScanTokens"), 10) || 300), "bank");
        const cap = Math.max(1, parseInt(getSetting("bankRpMax"), 10) || 5000);
        const found = parseBankScan(raw);
        if (!found.length) { if (!opts.silent) toastr.info("ไม่เจอเหตุการณ์เกี่ยวกับเงินใหม่ในบทล่าสุด", "TinyBank"); return; }
        for (const x of found) {
            b.pending.push({
                id: "pv" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
                dir: x.dir, amount: Math.min(x.amount, cap), label: x.label, ts: Date.now(),
            });
        }
        saveFeedDataDebounced();
        if (currentApp === "bank") renderBank();
        if (opts.notify) showNotif(bankScanNotifAvatar(), "TinyBank", `เจอเงินในบท ${found.length} รายการ รอรีวิว`, "bank", "bank");
        if (opts.manual || currentApp === "bank") openBankReviewModal();
    } catch (e) {
        console.error(`[${extensionName}] scanBankRp failed:`, e);
        if (!opts.silent) toastr.error("สแกนไม่สำเร็จ ลองใหม่นะ", "TinyBank");
    } finally {
        isBankScanBusy = false;
        btn.removeClass("tinyfeed-generating").prop("disabled", false);
    }
}

function openBankReviewModal() {
    const pending = getBankData().pending || [];
    if (!pending.length) { toastr.info("ไม่มีรายการรอรีวิว", "TinyBank"); return; }
    $("#tinyfeed-bank-review-list").html(pending.map((x, i) => `
        <label class="tinyfeed-bank-review-row">
            <input type="checkbox" class="tinyfeed-bank-review-check" data-idx="${i}" checked />
            <span class="tinyfeed-bank-review-amt tinyfeed-bank-${x.dir}">${x.dir === "in" ? "+" : "−"}${formatMoney(x.amount)}</span>
            <span class="tinyfeed-bank-review-label">${escapeText(x.label)}</span>
        </label>
    `).join(""));
    $("#tinyfeed-bank-review-modal").removeClass("tinyfeed-hidden");
}
function closeBankReviewModal() { $("#tinyfeed-bank-review-modal").addClass("tinyfeed-hidden"); }

// รับเฉพาะรายการที่ติ๊กไว้ (ผ่าน bankAdd/bankDeduct จริง) · ยอดไม่พอ (กรณี dir=out) = ค้างใน pending ต่อ ไม่หายเงียบๆ
function applyBankReviewSelected() {
    const b = getBankData();
    const checked = new Set();
    $(".tinyfeed-bank-review-check:checked").each(function () { checked.add(parseInt($(this).data("idx"), 10)); });
    let applied = 0;
    const remaining = [];
    b.pending.forEach((x, i) => {
        if (checked.has(i)) {
            const ok = x.dir === "in"
                ? bankAdd(x.amount, x.label, "rp", { silentToast: true })
                : bankDeduct(x.amount, x.label, "rp", { silentToast: true });
            if (ok) { applied++; return; }
        }
        remaining.push(x);
    });
    b.pending = remaining;
    saveFeedDataDebounced();
    closeBankReviewModal();
    renderBank();
    toastr.success(applied ? `รับเข้าบัญชีแล้ว ${applied} รายการ` : "ไม่มีรายการที่เลือก", "TinyBank");
}
function rejectBankReviewAll() {
    const b = getBankData();
    b.pending = [];
    saveFeedDataDebounced();
    closeBankReviewModal();
    renderBank();
    toastr.info("ปฏิเสธรายการที่สแกนเจอทั้งหมดแล้ว", "TinyBank");
}

/* ===== TinyShop: ร้านค้า — แคตตาล็อกผูกกับแชท (เดิม global, ย้ายตามคำขอผู้ใช้ 2026-08)
 * หมวดสินค้า (shopCategories) ยังเป็น global เหมือนเดิม — คู่กับแนวทางเดียวกับ TinyForum
 * (forumRooms เป็น global แต่กระทู้จริงผูกแชท) ตั้งชื่อหมวดครั้งเดียวใช้ข้ามเรื่องได้ แต่สินค้าแยกตามเรื่อง */
function getShop() {
    const data = getFeedData();
    if (!Array.isArray(data.shop)) {
        // แชทนี้ยังไม่เคยมีแคตตาล็อกของตัวเอง — สำเนาจากแคตตาล็อก global เดิม (ถ้ามี) มาเป็นจุดเริ่มต้น
        // ครั้งเดียวต่อแชท กันของเดิมหายไปเงียบๆ ตอนย้ายมาเป็น per-chat; ไม่แตะ/ลบ global เดิม (แชทอื่นที่ยังไม่เปิดจะได้สำเนาด้วย)
        const legacy = extension_settings[extensionName];
        const seed = legacy && Array.isArray(legacy.shop) ? legacy.shop : [];
        data.shop = seed.map((it) => Object.assign({}, it));
        saveFeedDataDebounced();
    }
    return data.shop;
}
function saveShop() {
    saveFeedDataDebounced();
}
function getShopOwned() {
    const data = getFeedData();
    if (!data.shopOwned || typeof data.shopOwned !== "object") data.shopOwned = {};
    return data.shopOwned;
}

/* ===== TinyBag: กระเป๋าของที่ซื้อ — เก็บ snapshot ชื่อ/รูป/รายละเอียดตอนซื้อ (ผูกแชท เหมือน TinyShop)
 * ของไม่หายแม้ลบสินค้าออกจากร้านทีหลัง (ต่างจาก shopOwned เดิมที่อ้างด้วย id เฉยๆ) */
function bagId() { return "bg" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function getBag() {
    const data = getFeedData();
    if (!Array.isArray(data.bag)) {
        // ครั้งแรกหลังอัปเดต — ย้ายของเก่าจาก shopOwned (ถ้ามี) เข้ากระเป๋าใหม่ครั้งเดียว ไม่แตะ/ลบ shopOwned เดิม
        data.bag = [];
        const owned = data.shopOwned;
        if (owned && typeof owned === "object") {
            const catalog = Array.isArray(data.shop) ? data.shop : [];
            for (const itemId of Object.keys(owned)) {
                const qty = Number(owned[itemId]) || 0;
                if (qty <= 0) continue;
                const it = catalog.find((x) => x.id === itemId);
                data.bag.push({
                    id: bagId(), itemId, name: it ? it.name : "ของที่ซื้อไว้ (ไม่พบข้อมูลเดิม)",
                    emoji: it ? (it.emoji || "") : "📦", image: it ? (it.image || "") : "",
                    desc: it ? (it.desc || "") : "", qty, src: "shop", from: "", ts: Date.now(),
                });
            }
        }
        saveFeedDataDebounced();
    }
    return data.bag;
}
function saveBag() { saveFeedDataDebounced(); }
// เพิ่มของเข้ากระเป๋าจากสินค้าในร้าน — สแนปช็อตชื่อ/รูป/รายละเอียด ณ ตอนนั้น (ใช้ร่วมกัน: ผู้ใช้ซื้อเอง + AI ซื้อของขวัญให้)
// opts.src: "shop" (ซื้อเอง, ค่าเริ่มต้น) | "gift" (ได้จาก AI) — แยกกันไว้เผื่ออยากแสดง/กรองต่างกันทีหลัง
function addToBag(shopItem, opts) {
    opts = opts || {};
    const src = opts.src || "shop";
    const bag = getBag();
    const existing = bag.find((x) => x.itemId === shopItem.id && x.src === src);
    if (existing) existing.qty = (existing.qty || 0) + 1;
    else bag.push({
        id: bagId(), itemId: shopItem.id, name: shopItem.name, emoji: shopItem.emoji || "", image: shopItem.image || "",
        desc: shopItem.desc || "", qty: 1, src, from: opts.from || "", ts: Date.now(),
    });
    saveBag();
}
// จำนวนของชิ้นหนึ่งในกระเป๋าที่มาจากสินค้าร้าน itemId นี้ (รวมทั้งที่ซื้อเองและได้รับเป็นของขวัญ) — ใช้ทำป้าย "มี N" บนการ์ดร้าน
function bagQtyForShopItem(itemId) {
    return getBag().filter((x) => x.itemId === itemId && (x.src === "shop" || x.src === "gift")).reduce((sum, x) => sum + (x.qty || 0), 0);
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
    let items = getShop();
    if (shopFilterCat !== "__all__") items = items.filter((it) => (it.cat || "") === shopFilterCat);
    if (!items.length) {
        $("#tinyfeed-shop-grid").html(emptyStateHtml("fa-bag-shopping", "ยังไม่มีสินค้า",
            shopFilterCat === "__all__" ? 'เพิ่มเอง หรือกด "ให้ AI สร้างสินค้า"' : "หมวดนี้ยังไม่มีสินค้า"));
        return;
    }
    $("#tinyfeed-shop-grid").html(items.map((it) => {
        const n = bagQtyForShopItem(it.id);
        return `<div class="tinyfeed-shop-item" data-id="${escapeAttr(it.id)}">
            <div class="tinyfeed-shop-thumb-wrap">
                ${shopThumbHtml(it)}
                ${n ? `<span class="tinyfeed-shop-owned">มี ${n}</span>` : ""}
                <span class="tinyfeed-shop-gift" title="ซื้อและส่งเป็นของขวัญ"><i class="fa-solid fa-gift"></i></span>
                <span class="tinyfeed-shop-edit" title="แก้ไขสินค้า"><i class="fa-solid fa-pen"></i></span>
                <span class="tinyfeed-shop-del" title="ลบสินค้า"><i class="fa-solid fa-trash"></i></span>
            </div>
            <div class="tinyfeed-shop-name">${escapeText(it.name)}</div>
            ${it.cat ? `<div class="tinyfeed-shop-cat-tag">${escapeText(it.cat)}</div>` : ""}
            ${it.desc ? `<div class="tinyfeed-shop-desc">${escapeText(it.desc)}</div>` : ""}
            <div class="tinyfeed-shop-cardfoot">
                <button class="tinyfeed-shop-buy tinyfeed-btn-primary" data-id="${escapeAttr(it.id)}">${formatMoney(it.price)}</button>
                <span class="tinyfeed-shop-share" data-id="${escapeAttr(it.id)}" title="แชร์สินค้านี้"><i class="fa-solid fa-share"></i></span>
            </div>
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
    updateUploadPreview($("#tinyfeed-shop-image"));
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
    updateUploadPreview($("#tinyfeed-shop-edit-image"));
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
// ITEM: ชื่อ | ราคา | หมวด | อิโมจิ | รายละเอียด | statId หรือ - | จำนวนผล  (คืนจำนวนที่เพิ่ม)
function parseShopItems(raw, cats) {
    const s = stripReasoning(raw);
    const lowerCats = cats.map((c) => c.toLowerCase());
    const re = /ITEM:\s*(.+)/gi;
    let m, count = 0;
    while ((m = re.exec(s)) !== null) {
        const parts = m[1].split("|").map((x) => x.trim());
        const name = cleanAiName(parts[0] || "");
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
function shareShopItem(id) {
    const it = getShop().find((x) => String(x.id) === String(id));
    if (!it) return;
    openSharePicker({ kind: "shop", title: it.name, sub: `สินค้าจาก TinyShop · ${formatMoney(it.price)}`, body: it.desc || "", image: it.image || "", emoji: it.emoji || "🛍️" });
}
function buyShopItem(id) {
    const it = getShop().find((x) => String(x.id) === String(id));
    if (!it) return;
    if (!bankDeduct(it.price, `ซื้อ ${it.name}`, "shop")) return;   // ยอดไม่พอ → toast ในตัว
    addToBag(it, { src: "shop" });   // สแนปช็อตชื่อ/รูป/รายละเอียดตอนซื้อ — ถ้าร้านลบสินค้านี้ทีหลัง ของในกระเป๋ายังอยู่ครบ
    renderShop();
    toastr.success(`ซื้อ "${it.name}" แล้ว`, "TinyShop");
}

// จับคู่ชื่อสินค้าที่ AI พิมพ์มา (จากบรรทัด GIFT:) กับแคตตาล็อกจริงใน TinyShop — ฟังก์ชันบริสุทธิ์ ทดสอบแยกได้
// ไม่เจอ หรือเจอมากกว่า 1 ชิ้น (กำกวม) = คืน null เสมอ — ห้ามเดา/แต่งสินค้าขึ้นมาเอง (นอกขอบเขตที่ผู้ใช้เลือก)
function findShopItemByName(raw) {
    const wanted = cleanAiName(raw).trim().toLowerCase();
    if (!wanted) return null;
    const items = getShop();
    const nameOf = (it) => String(it.name || "").trim().toLowerCase();
    let hit = items.filter((it) => nameOf(it) === wanted);
    if (hit.length === 1) return hit[0];
    if (hit.length > 1) return null;
    hit = items.filter((it) => nameOf(it).startsWith(wanted));
    if (hit.length === 1) return hit[0];
    if (hit.length > 1) return null;
    hit = items.filter((it) => nameOf(it).includes(wanted));
    if (hit.length === 1) return hit[0];
    return null;
}

// ให้ AI เห็นแคตตาล็อก TinyShop เสมอเมื่อเปิดสวิตช์ของขวัญ — แม้ผู้ใช้ไม่ได้เปิด "ให้แอปอื่นเห็นร้านค้า" ไว้
// (ถ้าไม่มีจุดนี้ AI จะไม่เห็นรายการสินค้าเลย เดาชื่อส่งมาแบบมั่วๆ จับคู่ไม่ติดสักที ดูเหมือนฟีเจอร์พังเงียบๆ ไม่มี error ให้เห็น)
function giftShopVisibleContext() {
    if (getSetting("crossAppEnabled") && getSetting("crossAppShop")) return "";   // มองเห็นอยู่แล้วผ่าน crossAppContext ปกติ
    const count = Math.max(1, parseInt(getSetting("crossAppCount"), 10) || 3);
    const blocks = buildAppBlocks({ shop: true, count });
    return blocks.length ? `\n${blocks.join("\n\n")}\n` : "";
}

// ประมวลผลบรรทัด GIFT: <ชื่อสินค้า> จากคำตอบ AI ในแชต 1:1 — จับคู่กับแคตตาล็อกเท่านั้น ไม่หักเงินผู้ใช้ (ตัวละครจ่ายเองนอกจอ)
// ของเข้ากระเป๋าผู้ใช้จริง + ดันการ์ดของขวัญเข้าแชท — คืน true ถ้าส่งสำเร็จ (ใช้กันข้อความเตือน "คำตอบว่าง" หลอกใน CONNECT_MARKERS)
function handleAiGift(raw, ctx) {
    if (!activeThread) return false;
    const m = /GIFT:\s*(.+)/i.exec(stripReasoning(raw));
    if (!m) return false;
    const it = findShopItemByName(m[1]);
    if (!it) { console.warn(`[${extensionName}] AI ส่ง GIFT มาแต่จับคู่สินค้าไม่ติด:`, m[1]); return false; }
    addToBag(it, { src: "gift", from: ctx.name });
    getThread(activeThread).push({
        from: "contact", author: ctx.name, isGift: true, dir: "in",
        gift: { name: it.name, emoji: it.emoji || "", image: it.image || "", desc: it.desc || "" },
        ts: Date.now(),
    });
    saveThread(activeThread);
    return true;
}

// ===== TinyBag (แอปที่ 11): กระเป๋าของที่ซื้อ — แสดง/ใช้/ทิ้ง (ส่งเป็นของขวัญ → เฟส 4) =====
function renderBag() {
    const box = $("#tinyfeed-bag-grid");
    if (!box.length) return;
    const items = getBag().filter((x) => (x.qty || 0) > 0);
    if (!items.length) {
        box.html(emptyStateHtml("fa-box-open", "กระเป๋ายังว่างอยู่", "ซื้อของจากร้าน TinyShop แล้วจะมาโผล่ที่นี่"));
        return;
    }
    box.html(items.slice().reverse().map((x) => `
        <div class="tinyfeed-shop-item" data-id="${escapeAttr(x.id)}">
            <div class="tinyfeed-shop-thumb-wrap">
                ${shopThumbHtml(x)}
                ${x.qty > 1 ? `<span class="tinyfeed-shop-owned">×${x.qty}</span>` : ""}
            </div>
            <div class="tinyfeed-shop-name">${escapeText(x.name)}</div>
            ${x.desc ? `<div class="tinyfeed-shop-desc">${escapeText(x.desc)}</div>` : ""}
            <div class="tinyfeed-bag-actions">
                <span class="tinyfeed-bag-use" data-id="${escapeAttr(x.id)}" title="ใช้ 1 ชิ้น"><i class="fa-solid fa-hand-sparkles"></i> ใช้</span>
                <span class="tinyfeed-bag-gift" data-id="${escapeAttr(x.id)}" title="ส่งเป็นของขวัญ"><i class="fa-solid fa-gift"></i></span>
                <span class="tinyfeed-bag-discard" data-id="${escapeAttr(x.id)}" title="ทิ้ง"><i class="fa-solid fa-trash"></i></span>
            </div>
        </div>
    `).join(""));
}
function useBagItem(id) {
    const bag = getBag();
    const x = bag.find((it) => it.id === id);
    if (!x) return;
    const name = x.name;
    x.qty = (x.qty || 1) - 1;
    if (x.qty <= 0) bag.splice(bag.indexOf(x), 1);
    saveBag();
    renderBag();
    updateChatInjection();
    toastr.success(`ใช้ "${name}" แล้ว`, "TinyBag");
}
function discardBagItem(id) {
    const bag = getBag();
    const i = bag.findIndex((it) => it.id === id);
    if (i < 0) return;
    const name = bag[i].name;
    bag.splice(i, 1);
    saveBag();
    renderBag();
    updateChatInjection();
    toastr.info(`ทิ้ง "${name}" แล้ว`, "TinyBag");
}
// ส่งของจากกระเป๋าเป็นของขวัญ (เรียกจากหน้าแอป TinyBag เอง — ต่างจาก openGiftFromBag ที่เรียกจากเมนู (+) ในแชท ซึ่งรู้ผู้รับอยู่แล้ว)
function giftBagItem(id) {
    if (!getBag().some((it) => it.id === id)) return;
    const itemName = getBag().find((it) => it.id === id).name;
    openConnectDestPicker(`ส่ง "${itemName}" ให้ใคร`, (key, name) => {
        const item = getBag().find((it) => it.id === id);
        if (!item) { toastr.info("ของชิ้นนี้ถูกใช้ไปแล้ว", "TinyBag"); return; }
        item.qty = (item.qty || 1) - 1;
        const giftSnap = { name: item.name, emoji: item.emoji || "", image: item.image || "", desc: item.desc || "" };
        const bag = getBag();
        if (item.qty <= 0) bag.splice(bag.indexOf(item), 1);
        saveBag();
        getThread(key).push({ from: "user", isGift: true, gift: giftSnap, ts: Date.now() });
        if (key === "pet") petBondAdd(3);
        saveThread(key);
        if (currentApp === "connect" && activeThread === key) renderThread();
        renderBag();
        updateChatInjection();
        toastr.success(`ส่ง "${giftSnap.name}" ให้ ${name} แล้ว`, "TinyConnect");
        maybeGiftThankYou(key);
    });
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

// เพิ่มแท็บใหม่ = เพิ่มชื่อในลิสต์นี้ที่เดียว (ต้องมี panel #tinyfeed-gallery-panel-<ชื่อ> คู่กันใน phone.html)
const GALLERY_TABS = ["images", "stickers", "files"];
function switchGalleryTab(tab) {
    galleryTab = GALLERY_TABS.includes(tab) ? tab : "images";
    $(".tinyfeed-tab[data-gtab]").removeClass("tinyfeed-tab-active");
    $(`.tinyfeed-tab[data-gtab="${galleryTab}"]`).addClass("tinyfeed-tab-active");
    for (const t of GALLERY_TABS) $(`#tinyfeed-gallery-panel-${t}`).toggleClass("tinyfeed-hidden", t !== galleryTab);
    if (galleryTab === "files") renderGalleryFiles();
    else renderGalleryGrid(galleryTab === "stickers" ? "sticker" : "image");
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
    updateUploadPreview($("#tinyfeed-gallery-img-url"));
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
    updateUploadPreview($("#tinyfeed-gallery-stk-url"));
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

// url เดียวกันถูกใช้ที่อื่นในคลังอีกไหม (กันลบไฟล์จริงทิ้งทั้งที่ยังมีรายการอื่นอ้างอิงอยู่)
function galleryUrlStillUsed(url, excludeId) {
    const g = getGallery();
    const isSame = (it) => String(it.url) === String(url) && String(it.id) !== String(excludeId);
    return g.images.some(isSame) || g.stickers.some(isSame);
}

function deleteGalleryItem(kind, id) {
    const g = getGallery();
    const arr = kind === "sticker" ? g.stickers : g.images;
    const idx = arr.findIndex((it) => String(it.id) === String(id));
    if (idx < 0) return;
    const url = arr[idx].url;
    arr.splice(idx, 1);
    saveGallery();
    renderGalleryGrid(kind);
    if (!galleryUrlStillUsed(url, id)) deleteTinyUploadedImage(url);
}

// ===== หน้าจัดการไฟล์ (แท็บที่ 3 ใน TinyGallery) — ลิสต์ไฟล์จริงบนดิสก์ที่อัปโหลดผ่านโทรศัพท์ + ลบได้จริง =====

// ดึงรายชื่อไฟล์ทั้งหมดในโฟลเดอร์ user/images/tinyphone/ จากเซิร์ฟเวอร์ ST จริง (ไม่ใช่แค่ที่ถูกอ้างอิงในแอปใดแอปหนึ่ง)
// คืน array ของ path เต็ม (เช่น "user/images/tinyphone/xxx.webp") · คืน null เมื่อโหลดไม่สำเร็จ (แยกจาก [] ที่แปลว่าโฟลเดอร์ว่างจริงๆ)
async function listTinyUploads() {
    try {
        const res = await fetch("/api/images/list", {
            method: "POST",
            headers: getContext().getRequestHeaders(),
            body: JSON.stringify({ folder: "tinyphone", type: 1, sortField: "date", sortOrder: "desc" }),
        });
        if (!res.ok) { console.error(`[${extensionName}] listTinyUploads: เซิร์ฟเวอร์ตอบ ${res.status}`); return null; }
        const names = await res.json();
        return Array.isArray(names) ? names.map((n) => `user/images/tinyphone/${n}`) : [];
    } catch (e) {
        console.error(`[${extensionName}] listTinyUploads failed:`, e);
        return null;
    }
}

/* สแกนหา "ใครใช้ URL รูปนี้อยู่บ้าง" ทั่วทั้งโปรแกรม — ทะเบียนกลางจุดเดียว ห้ามกระจายเช็ค "ใช้อยู่ไหม" ไปที่อื่น
 * (galleryUrlStillUsed เช็คแค่ในคลังตัวเอง ใช้ตอนลบจากในคลัง — ฟังก์ชันนี้กว้างกว่า ครอบทุกที่ที่ TinyPhone เก็บ URL รูป)
 * คืน Map<url, string[]> (url → ป้ายภาษาไทยบอกว่าเจอที่ไหนบ้าง) — เรียกใหม่ทุกครั้งก่อนตัดสินใจลบไฟล์ (ห้าม cache ข้ามการแก้ข้อมูล) */
function tinyRefIndex() {
    const idx = new Map();
    const add = (url, label) => {
        const u = String(url || "").trim();
        if (!u) return;
        if (!idx.has(u)) idx.set(u, []);
        const arr = idx.get(u);
        if (!arr.includes(label)) arr.push(label);
    };

    // ----- global (extension_settings.tinyfeed) — เห็นเสมอไม่ว่าจะเปิดแชทไหนอยู่ -----
    add(getSetting("wallpaperUrl"), "วอลเปเปอร์");
    const personaThemes = getSetting("personaThemes") || {};
    for (const k of Object.keys(personaThemes)) add(personaThemes[k].wallpaperUrl, "วอลเปเปอร์ (ธีมเฉพาะ persona)");
    add(getSetting("streamBgUrl"), "พื้นหลัง TinyStream");
    add(getSetting("connectBgUrl"), "พื้นหลังแชทกลาง");
    add(getSetting("userAvatarUrl"), "รูปโปรไฟล์ (เก่า)");
    const charAvatarUrls = getSetting("charAvatarUrls") || {};
    for (const k of Object.keys(charAvatarUrls)) add(charAvatarUrls[k], "รูปโปรไฟล์ (เก่า)");
    const userProfiles = getSetting("userProfiles") || {};
    for (const k of Object.keys(userProfiles)) add((userProfiles[k] || {}).avatarUrl, "โปรไฟล์ผู้ใช้");
    const charProfiles = getSetting("charProfiles") || {};
    for (const k of Object.keys(charProfiles)) add((charProfiles[k] || {}).avatarUrl, "โปรไฟล์ตัวละคร");
    const npcsByChar = getSetting("npcsByChar") || {};
    for (const k of Object.keys(npcsByChar)) {
        for (const npc of (npcsByChar[k] || [])) add(npc.avatar, "NPC");
    }
    const petSprites = getSetting("petSprites") || {};
    for (const k of Object.keys(petSprites)) add(petSprites[k], "สไปรต์เพ็ท");
    for (const it of (getSetting("petShop") || [])) add(it.image, "ไอเทมร้านเพ็ท");
    const g = getGallery();
    for (const it of g.images) add(it.url, "คลังรูป");
    for (const it of g.stickers) add(it.url, "คลังสติกเกอร์");
    for (const m of (getPet().dm || [])) {   // ห้องแชตเพ็ทเป็น global เก็บที่ extension_settings ไม่ใช่ chat_metadata
        if (m.share) add(m.share.image, "การ์ดในแชตเพ็ท");
        if (m.gift) add(m.gift.image, "การ์ดในแชตเพ็ท");
    }

    // ----- ต่อแชท (chat_metadata.tinyfeed) — เห็นเฉพาะแชทที่เปิดอยู่ตอนนี้เท่านั้น (getFeedData โยน error ถ้าไม่มีแชทเปิด) -----
    try {
        const c = getConnectData();
        const threadBg = c.threadBg || {};
        for (const k of Object.keys(threadBg)) add(threadBg[k], "พื้นหลังห้องแชต");
        for (const grp of (c.groups || [])) add(grp.avatar, "รูปกลุ่มแชต");
        for (const key of Object.keys(c.threads || {})) {
            for (const m of (c.threads[key] || [])) {
                if (m.share) add(m.share.image, "การ์ดแชร์ในแชต");
                if (m.gift) add(m.gift.image, "การ์ดของขวัญในแชต");
            }
        }
        for (const it of getShop()) add(it.image, "สินค้า TinyShop");
        for (const it of getBag()) add(it.image, "ของในกระเป๋า TinyBag");
    } catch (e) {
        console.warn(`[${extensionName}] tinyRefIndex: อ่านข้อมูลต่อแชทไม่ได้ (อาจไม่มีแชทเปิดอยู่ตอนนี้)`, e);
    }

    return idx;
}
window.__debug = Object.assign(window.__debug || {}, { tinyRefIndex, listTinyUploads });   // ไล่ดูผลสแกนจริงได้จากคอนโซล (ลบทิ้งได้ถ้าไม่ต้องการแล้ว)

let isGalleryFilesBusy = false;   // กันกดรีเฟรช/ลบทั้งหมดซ้อนกัน

async function renderGalleryFiles() {
    if (isGalleryFilesBusy) return;
    isGalleryFilesBusy = true;
    const $btn = $("#tinyfeed-gallery-files-refresh");
    $btn.addClass("tinyfeed-generating").prop("disabled", true);
    const $grid = $("#tinyfeed-gallery-files-grid");
    try {
        const urls = await listTinyUploads();
        if (urls === null) {
            $grid.html(emptyInlineHtml("โหลดรายชื่อไฟล์ไม่สำเร็จ ลองกดรีเฟรชอีกครั้ง"));
            return;
        }
        if (!urls.length) {
            $grid.html(emptyInlineHtml("ยังไม่มีไฟล์ที่อัปโหลดผ่านโทรศัพท์เลย"));
            return;
        }
        const refIdx = tinyRefIndex();
        $grid.html(urls.map((url) => {
            const labels = refIdx.get(url) || [];
            const used = labels.length > 0;
            const name = url.split("/").pop();
            const status = used
                ? `<span class="tinyfeed-gallery-file-status tinyfeed-gallery-file-used">ใช้อยู่ (${labels.length})</span>`
                : `<span class="tinyfeed-gallery-file-status tinyfeed-gallery-file-orphan">ไม่พบการอ้างอิง</span>`;
            return `
            <div class="tinyfeed-gallery-item" data-url="${escapeAttr(url)}">
                <div class="tinyfeed-gallery-thumb-wrap">
                    <img class="tinyfeed-gallery-thumb" src="${escapeAttr(url)}" alt="${escapeText(name)}" onerror="this.classList.add('tinyfeed-img-broken')" />
                    ${status}
                    <span class="tinyfeed-gallery-item-actions">
                        <span class="tinyfeed-gallery-file-del" title="ลบไฟล์นี้"><i class="fa-solid fa-trash"></i></span>
                    </span>
                </div>
                <div class="tinyfeed-gallery-item-name" title="${escapeAttr(labels.join(", "))}">${escapeText(name)}</div>
            </div>`;
        }).join(""));
    } finally {
        isGalleryFilesBusy = false;
        $btn.removeClass("tinyfeed-generating").prop("disabled", false);
    }
}

// เปิด lightbox เดิม (#tinyfeed-gallery-view) แต่ยัดป้ายการใช้งานแทนคำบรรยาย — ไม่มี kind/id แบบไอเทมคลังปกติ จึงเลี่ยง openGalleryView
function openFileView(url) {
    const name = String(url || "").split("/").pop();
    const labels = tinyRefIndex().get(url) || [];
    setImgSrcSafe($("#tinyfeed-gallery-view-img"), url);
    $("#tinyfeed-gallery-view-name").text(name);
    $("#tinyfeed-gallery-view-cap").text(labels.length ? `ใช้อยู่ที่: ${labels.join(", ")}` : "ไม่พบการอ้างอิง").removeClass("tinyfeed-hidden");
    $("#tinyfeed-gallery-view").removeClass("tinyfeed-hidden");
}

// ลบไฟล์เดียว — confirm ก่อนเสมอ (ลบจริงจากดิสก์ กู้คืนไม่ได้)
async function deleteOneTinyFile(url) {
    const name = String(url || "").split("/").pop();
    if (!window.confirm(`ลบไฟล์ "${name}" ถาวรจากดิสก์ กู้คืนไม่ได้ ต้องการลบไหม?`)) return;
    const ok = await deleteTinyUploadedImage(url);
    if (ok) toastr.success(`ลบ "${name}" แล้ว`, "TinyGallery");
    else toastr.error(`ลบ "${name}" ไม่สำเร็จ`, "TinyGallery");
    renderGalleryFiles();
}

// ลบไฟล์ที่ "ไม่พบการอ้างอิง" ทั้งหมดทีเดียว — guard กันพลาด 2 ชั้น เพราะลบแล้วกู้คืนไม่ได้:
// (1) ปฏิเสธถ้าไม่มีแชทเปิดอยู่ (ตรวจต่อแชทไม่ได้ = เสี่ยงลบของแชทอื่นที่ยังใช้อยู่)
// (2) ปฏิเสธถ้า ref index ว่างเปล่าทั้งที่มีไฟล์อยู่ (ตัวสแกนน่าจะพัง — ไม่งั้นทุกไฟล์จะดูเหมือนกำพร้าแล้วโดนลบเกลี้ยง)
async function cleanupOrphanTinyFiles() {
    if (isGalleryFilesBusy) return;
    if (!getCurrentCharacter()) {
        toastr.warning("เปิดแชทที่มีตัวละครก่อนนะ — ไม่งั้นตรวจการใช้งานต่อแชทไม่ได้ อาจลบไฟล์ที่ยังใช้อยู่โดยไม่รู้ตัว", "TinyGallery");
        return;
    }
    isGalleryFilesBusy = true;
    const $btn = $("#tinyfeed-gallery-files-cleanup");
    const $label = $btn.find("span");
    const originalLabel = $label.text();
    $btn.addClass("tinyfeed-generating").prop("disabled", true);
    try {
        const urls = await listTinyUploads();
        if (urls === null) { toastr.error("โหลดรายชื่อไฟล์ไม่สำเร็จ ลองรีเฟรชก่อนนะ", "TinyGallery"); return; }
        if (!urls.length) { toastr.info("ไม่มีไฟล์ให้ตรวจ", "TinyGallery"); return; }
        const refIdx = tinyRefIndex();
        if (refIdx.size === 0) {
            console.error(`[${extensionName}] cleanupOrphanTinyFiles: tinyRefIndex ว่างเปล่าทั้งที่มีไฟล์ ${urls.length} ไฟล์ — ปฏิเสธลบเพื่อความปลอดภัย`);
            toastr.error("ตรวจการใช้งานไฟล์ไม่ได้ตามปกติ — ยกเลิกการลบทั้งหมดเพื่อความปลอดภัย ลองรีเฟรชใหม่อีกครั้ง", "TinyGallery");
            return;
        }
        const orphans = urls.filter((u) => !refIdx.has(u));
        if (!orphans.length) { toastr.info("ไม่มีไฟล์ที่ไม่พบการอ้างอิงเลย", "TinyGallery"); return; }
        if (!window.confirm(`ลบไฟล์ที่ไม่พบการอ้างอิงทั้งหมด ${orphans.length} ไฟล์ถาวรจากดิสก์ กู้คืนไม่ได้ ต้องการลบไหม?`)) return;
        let done = 0;
        for (const url of orphans) {
            done++;
            $label.text(`กำลังลบ ${done}/${orphans.length}…`);
            await deleteTinyUploadedImage(url);
        }
        toastr.success(`ลบไฟล์ที่ไม่พบการอ้างอิงแล้ว ${orphans.length} ไฟล์`, "TinyGallery");
    } finally {
        isGalleryFilesBusy = false;
        $btn.removeClass("tinyfeed-generating").prop("disabled", false);
        $label.text(originalLabel);
        renderGalleryFiles();   // เรียกหลังปลด busy flag เท่านั้น — renderGalleryFiles เช็คธงเดียวกัน ไม่งั้น no-op ทันที
    }
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
    setImgSrcSafe($("#tinyfeed-gallery-view-img"), it.url);
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
    $("#tinyfeed-gallery-edit-url").closest(".tinyfeed-uploadrow").find(".tinyfeed-upload-btn").data("kind", kind);
    $("#tinyfeed-gallery-edit-url").val(it.url || "");
    updateUploadPreview($("#tinyfeed-gallery-edit-url"));
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
    const newUrl = String($("#tinyfeed-gallery-edit-url").val() || "").trim();
    if (!newName) { toastr.info("ตั้งชื่อก่อนนะ", "TinyGallery"); return; }
    if (!newUrl) { toastr.info("ต้องมีรูป — อัปโหลดใหม่หรือวางลิงก์", "TinyGallery"); return; }
    const arr = kind === "sticker" ? getGallery().stickers : getGallery().images;
    if (arr.some((x) => x.id !== it.id && String(x.name).trim().toLowerCase() === newName.toLowerCase())) {
        toastr.info("มีชื่อนี้อยู่แล้ว ตั้งชื่ออื่นนะ", "TinyGallery"); return;
    }
    const oldUrl = it.url;
    it.name = newName;
    it.url = newUrl;
    if (kind === "image") it.caption = String($("#tinyfeed-gallery-edit-caption").val() || "").trim();
    it.album = String($("#tinyfeed-gallery-edit-album").val() || "ทั่วไป");
    saveGallery();
    closeGalleryEdit();
    renderGalleryGrid(kind);
    toastr.success("บันทึกแล้ว", "TinyGallery");
    if (oldUrl !== newUrl && !galleryUrlStillUsed(oldUrl, it.id)) deleteTinyUploadedImage(oldUrl);
}

// ปิด overlay ทั้งหมดของคลัง (picker/ดูรูป/แก้ไข)
function closeGalleryOverlays() {
    closeGalleryPicker();
    closeGalleryView();
    closeGalleryEdit();
}

// ===== หน้าโปรไฟล์ (เต็มจอ) — persona · ตัวละครหลัก · NPC =====
// เนื้อหาในหน้านี้เป็น "ของตกแต่งแบบ static" ที่ผู้ใช้เขียนเอง (ไม่ได้ดึงจากฟีด) เพื่อให้ส่งออกไปกับการ์ดตัวละครได้
// ref รับได้ทั้งชื่อผู้เขียน (string จากฟีด/คอมเมนต์) และ ownerKey ("user" | "main" | "npc:<ชื่อ>")
function profileRefFor(nameOrKey) {
    const raw = String(nameOrKey || "").trim();
    if (!raw) return null;
    if (raw === "user" || nameMatchesUser(raw)) {
        return {
            kind: "user", key: getPersonaKey(), name: getUserName(), ownerKey: "user",
            avatarItem: { isUser: true, author: getUserName() }, rec: getProfileRecord("user"),
        };
    }
    if (raw === "main" || nameMatchesChar(raw)) {
        return {
            kind: "char", key: getCharKey(), name: getCharName(), ownerKey: "main",
            avatarItem: { isMain: true, author: getCharName() }, rec: getProfileRecord("char"),
        };
    }
    const npcName = raw.startsWith("npc:") ? raw.slice(4) : raw;
    const npc = getNpcRecord(npcName);
    if (npc) {
        return {
            kind: "npc", key: npc.name, name: npc.name, ownerKey: "npc:" + npc.name,
            avatarItem: { author: npc.name, avatar: npc.avatar || "" }, rec: getNpcProfileRecord(npc.name),
        };
    }
    // ชื่อที่ไม่อยู่ในทะเบียน (คนนอกที่ AI เอ่ยถึง) — เปิดดูได้แต่แก้ไม่ได้ ดีกว่าแตะแล้วไม่มีอะไรเกิดขึ้น
    return { kind: "unknown", key: "", name: npcName, ownerKey: "", avatarItem: { author: npcName }, rec: null };
}

// @ชื่อผู้ใช้ที่โชว์ใต้ชื่อจริง — persona/ตัวละครใช้ username ที่ตั้งไว้ในหน้าตั้งค่า · NPC ใช้ชื่อตัวเอง
function profileHandle(ref) {
    if (!ref) return "";
    if (ref.kind === "user" || ref.kind === "char") {
        const p = ref.kind === "user" ? getUserProfile() : getCharProfile();
        const h = (p.username || p.alias || "").trim();
        if (h) return h;
    }
    return String(ref.name || "").trim().replace(/\s+/g, "_").toLowerCase();
}
function profileDecor(ref) { return normProfileDecor(ref && ref.rec); }
function profileCanEdit(ref) { return Boolean(ref && ref.rec); }

let profileCtx = null;       // ref ที่กำลังดูอยู่
let profileTab = "grid";     // "grid" | "timeline"
let profileReturn = null;    // สถานะ topbar/แอปก่อนเข้าหน้านี้ (เข้าจากฟีดกับจากห้องแชตไม่เหมือนกัน)
let profileEditCtx = null;   // ref ที่กำลังแก้อยู่ใน modal

function isProfileOpen() { return !$("#tinyfeed-profile-screen").hasClass("tinyfeed-hidden"); }

function openProfileScreen(ref) {
    const r = (ref && typeof ref === "object" && ref.kind) ? ref : profileRefFor(ref);
    if (!r) return;
    closeProfilePost();
    closeProfileEdit();
    profileCtx = r;
    profileTab = "grid";
    profileReturn = {
        app: currentApp,
        title: $(".tinyfeed-title").text(),
        back: $("#tinyfeed-back").hasClass("tinyfeed-hidden"),
        home: $("#tinyfeed-home-btn").hasClass("tinyfeed-hidden"),
        settings: $("#tinyfeed-settings-btn").hasClass("tinyfeed-hidden"),
    };
    $(".tinyfeed-app").addClass("tinyfeed-hidden");
    $("#tinyfeed-profile-screen").removeClass("tinyfeed-hidden");
    $("#tinyfeed-back").removeClass("tinyfeed-hidden");
    $("#tinyfeed-home-btn").removeClass("tinyfeed-hidden");
    $(".tinyfeed-title").text("โปรไฟล์");
    renderProfileScreen();
}

function closeProfileScreen() {
    if (!isProfileOpen()) { profileCtx = null; return; }
    $("#tinyfeed-profile-screen").addClass("tinyfeed-hidden");
    profileCtx = null;
    const r = profileReturn || {};
    profileReturn = null;
    const app = APP_BY_ID[r.app];
    if (app) $(app.panel).removeClass("tinyfeed-hidden");
    $(".tinyfeed-title").text(r.title || (app ? app.name : "TinyPhone"));
    $("#tinyfeed-back").toggleClass("tinyfeed-hidden", Boolean(r.back));
    $("#tinyfeed-home-btn").toggleClass("tinyfeed-hidden", Boolean(r.home));
    $("#tinyfeed-settings-btn").toggleClass("tinyfeed-hidden", Boolean(r.settings));
}

// เข้ากันได้กับโค้ดเก่า (เดิมเป็น modal เล็ก) — ตอนนี้เป็นหน้าจอเต็ม
function openCharProfile(ref) { openProfileScreen(ref); }

function switchProfileTab(tab) {
    profileTab = tab === "timeline" ? "timeline" : "grid";
    // จำกัด [data-ptab] เสมอ — ทุกแอปใช้ .tinyfeed-tab ร่วมกัน ไม่จำกัดจะล้าง active ของแอปอื่น
    $("#tinyfeed-profile-screen .tinyfeed-tab[data-ptab]").removeClass("tinyfeed-tab-active");
    $(`#tinyfeed-profile-screen .tinyfeed-tab[data-ptab="${profileTab}"]`).addClass("tinyfeed-tab-active");
    renderProfileBody();
}

function renderProfileScreen() {
    if (!profileCtx) return;
    const ref = profileCtx;
    const d = profileDecor(ref);
    const roleTag = ref.kind === "user" ? "คุณ" : ref.kind === "npc" ? "NPC" : ref.kind === "char" ? "ตัวละคร" : "คนอื่น";
    const canEdit = profileCanEdit(ref);
    // ไบโอเก็บเป็น raw (คงตัวอักษร "@user" ไว้ตอนส่งออก) → escape ตอนแสดงเท่านั้น
    const bioHtml = d.bio ? `<div class="tinyfeed-profile-bio">${renderRich(escapeHtml(d.bio))}</div>` : "";
    $("#tinyfeed-profile-top").html(`
        <div class="tinyfeed-profile-idrow">
            <div class="tinyfeed-profile-ava">${makeAvatar(ref.avatarItem)}</div>
            <div class="tinyfeed-profile-stats">
                <div class="tinyfeed-profile-stat"><b>${formatCount(d.posts.length)}</b><span>โพสต์</span></div>
                <div class="tinyfeed-profile-stat"><b>${formatCount(d.followers)}</b><span>ผู้ติดตาม</span></div>
                <div class="tinyfeed-profile-stat"><b>${formatCount(d.following)}</b><span>กำลังติดตาม</span></div>
            </div>
        </div>
        <div class="tinyfeed-profile-name">${escapeText(ref.name)} <span class="tinyfeed-profile-role">${roleTag}</span></div>
        <div class="tinyfeed-profile-handle">@${escapeText(profileHandle(ref))}</div>
        ${bioHtml}
        <div class="tinyfeed-profile-actions">
            ${canEdit ? `<button class="tinyfeed-btn-ghost" id="tinyfeed-profile-edit-btn"><i class="fa-solid fa-pen"></i> แก้ไขโปรไฟล์</button>` : ""}
            ${ref.kind !== "user" ? `<button class="tinyfeed-btn-ghost" id="tinyfeed-profile-dm"><i class="fa-solid fa-paper-plane"></i> ส่งข้อความ</button>` : ""}
            ${(ref.kind === "char" || ref.kind === "npc") ? `<button class="tinyfeed-btn-ghost" id="tinyfeed-profile-export" title="ฝังลงการ์ดตัวละครใบนี้"><i class="fa-solid fa-id-card"></i> ฝากไว้กับการ์ด</button>` : ""}
        </div>
    `);
    renderProfileNpcs();
    renderProfileHighlights();
    switchProfileTab(profileTab);
}

// NPC ในสังกัดของตัวละครหลัก — ชิปกดได้จริง (ของเดิมมี data-npc แต่ไม่เคยมี handler)
function renderProfileNpcs() {
    const box = $("#tinyfeed-profile-npcs");
    const npcs = (profileCtx && profileCtx.kind === "char") ? getNpcs() : [];
    if (!npcs.length) { box.addClass("tinyfeed-hidden").empty(); return; }
    box.removeClass("tinyfeed-hidden").html(`
        <div class="tinyfeed-profile-sectitle">NPC ในสังกัด (${npcs.length})</div>
        <div class="tinyfeed-profile-npcrow">${npcs.map((n) => `
            <div class="tinyfeed-profile-npc tinyfeed-profile-open" data-author="${escapeAttr(n.name)}">
                ${makeAvatar({ author: n.name, avatar: n.avatar || "" })}<span>${escapeText(n.name)}</span>
            </div>`).join("")}</div>`);
}

function renderProfileHighlights() {
    const d = profileDecor(profileCtx);
    const box = $("#tinyfeed-profile-highlights");
    if (!d.highlights.length) { box.addClass("tinyfeed-hidden").empty(); return; }
    box.removeClass("tinyfeed-hidden").html(d.highlights.map((h) => `
        <div class="tinyfeed-profile-hl" data-hl="${escapeAttr(h.id)}">
            <div class="tinyfeed-profile-hl-cover">${h.cover
                ? `<img src="${escapeAttr(h.cover)}" alt="" onerror="this.classList.add('tinyfeed-img-broken')" />`
                : `<i class="fa-solid fa-bookmark"></i>`}</div>
            <span>${escapeText(h.title || "ไฮไลต์")}</span>
        </div>`).join(""));
}

function renderProfileBody() {
    if (profileTab === "timeline") renderProfileTimeline();
    else renderProfileGrid();
}

function renderProfileGrid() {
    const d = profileDecor(profileCtx);
    const body = $("#tinyfeed-profile-body");
    if (!d.posts.length) {
        body.html(emptyStateHtml("fa-table-cells", "ยังไม่มีโพสต์ในโปรไฟล์",
            profileCanEdit(profileCtx) ? "กด “แก้ไขโปรไฟล์” เพื่อเพิ่มรูป (ใช้ลิงก์ภายนอก)" : "เจ้าของยังไม่ได้ใส่อะไรไว้"));
        return;
    }
    body.html(`<div class="tinyfeed-profile-grid">${d.posts.map((x) => `
        <div class="tinyfeed-profile-cell" data-ppost="${escapeAttr(x.id)}">
            <img src="${escapeAttr(x.url)}" alt="" loading="lazy" onerror="this.classList.add('tinyfeed-img-broken')" />
        </div>`).join("")}</div>`);
}

function renderProfileTimeline() {
    const ref = profileCtx;
    const d = profileDecor(ref);
    const body = $("#tinyfeed-profile-body");
    if (!d.posts.length) {
        body.html(emptyStateHtml("fa-list", "ยังไม่มีโพสต์ในโปรไฟล์",
            profileCanEdit(ref) ? "กด “แก้ไขโปรไฟล์” เพื่อเพิ่มรูป (ใช้ลิงก์ภายนอก)" : "เจ้าของยังไม่ได้ใส่อะไรไว้"));
        return;
    }
    body.html(d.posts.map((x) => `
        <div class="tinyfeed-profile-tl" data-ppost="${escapeAttr(x.id)}">
            <div class="tinyfeed-profile-tl-head">
                ${makeAvatar(ref.avatarItem)}
                <span class="tinyfeed-profile-tl-name">${escapeText(ref.name)}</span>
            </div>
            <img class="tinyfeed-profile-tl-img" src="${escapeAttr(x.url)}" alt="" loading="lazy" onerror="this.classList.add('tinyfeed-img-broken')" />
            <div class="tinyfeed-profile-tl-meta"><i class="fa-solid fa-heart"></i> ${formatCount(x.likes)}</div>
            ${x.caption ? `<div class="tinyfeed-profile-tl-cap">${renderRich(escapeHtml(x.caption))}</div>` : ""}
        </div>`).join(""));
}

// ★ ทางลัดเข้าห้องแชท 1:1 โดยตรง — ไม่ต้องกดโฮม → เข้าแอป → หาห้องเอง
// ownerKey ใช้ชุดเดียวกับ getConnectContacts().key ("main" | "npc:<ชื่อ>" | "pet")
function openConnectThreadFor(ownerKey, prefill) {
    const c = getConnectContacts().find((x) => x.key === ownerKey);
    if (!c) { toastr.info("ยังไม่มีห้องแชตของคนนี้", "TinyConnect"); return false; }
    openApp("connect");         // ปิด overlay ที่ค้าง + ตั้ง title ให้เอง
    openThread(c.key, c.name);  // เข้าห้องตรง ข้ามหน้ารายชื่อ
    if (prefill) $("#tinyfeed-connect-input").val(prefill).trigger("input");
    $("#tinyfeed-connect-input").trigger("focus");
    return true;
}

// ── ดูโพสต์ static 1 ชิ้น ──
function openProfilePost(id) {
    const ref = profileCtx;
    if (!ref) return;
    const post = profileDecor(ref).posts.find((x) => x.id === id);
    if (!post) return;
    $("#tinyfeed-profile-post-body").html(`
        <div class="tinyfeed-profile-post-head">
            ${makeAvatar(ref.avatarItem)}
            <div class="tinyfeed-profile-post-name">${escapeText(ref.name)}</div>
        </div>
        <img class="tinyfeed-profile-post-img" src="${escapeAttr(post.url)}" alt="" onerror="this.classList.add('tinyfeed-img-broken')" />
        <div class="tinyfeed-profile-post-meta"><i class="fa-solid fa-heart"></i> ${formatCount(post.likes)}</div>
        ${post.caption ? `<div class="tinyfeed-profile-post-cap">${renderRich(escapeHtml(post.caption))}</div>` : ""}
        ${post.comments.length ? `<div class="tinyfeed-profile-post-comments">${post.comments.map((c) => `
            <div class="tinyfeed-comment"><span class="tinyfeed-comment-author">${escapeText(c.author)}</span>
            <span class="tinyfeed-comment-text">${renderRich(escapeHtml(c.text))}</span></div>`).join("")}</div>` : ""}
    `);
    $("#tinyfeed-profile-post").removeClass("tinyfeed-hidden");
}
function closeProfilePost() { $("#tinyfeed-profile-post").addClass("tinyfeed-hidden"); }

// ── ดูไฮไลต์ (ใช้หน้าต่างเดียวกับโพสต์ เพื่อไม่เพิ่ม modal ซ้ำซ้อน) ──
function openProfileHighlight(id) {
    const ref = profileCtx;
    if (!ref) return;
    const h = profileDecor(ref).highlights.find((x) => x.id === id);
    if (!h) return;
    $("#tinyfeed-profile-post-body").html(`
        <div class="tinyfeed-profile-post-head">
            ${makeAvatar(ref.avatarItem)}
            <div class="tinyfeed-profile-post-name">${escapeText(h.title || "ไฮไลต์")}</div>
        </div>
        ${h.items.length ? h.items.map((i) => `
            <img class="tinyfeed-profile-post-img" src="${escapeAttr(i.url)}" alt="" onerror="this.classList.add('tinyfeed-img-broken')" />
            ${i.caption ? `<div class="tinyfeed-profile-post-cap">${renderRich(escapeHtml(i.caption))}</div>` : ""}`).join("")
            : emptyInlineHtml("ไฮไลต์นี้ยังว่างอยู่")}
    `);
    $("#tinyfeed-profile-post").removeClass("tinyfeed-hidden");
}

// ── แก้ไขโปรไฟล์ ──
function openProfileEdit() {
    if (!profileCanEdit(profileCtx)) return;
    profileEditCtx = profileCtx;
    renderProfileEditBody();
    $("#tinyfeed-profile-edit").removeClass("tinyfeed-hidden");
}
function closeProfileEdit() { $("#tinyfeed-profile-edit").addClass("tinyfeed-hidden"); profileEditCtx = null; }

function renderProfileEditBody() {
    const rec = profileEditCtx && profileEditCtx.rec;
    if (!rec) return;
    const d = normProfileDecor(rec);
    // ★ วาดรายการจาก rec ตรงๆ ไม่ใช่ d.posts/d.highlights — normProfilePosts() ตัดแถวที่ url ยังว่างทิ้ง
    // ถ้าใช้ d จะกด "เพิ่มโพสต์" แล้วไม่มีแถวใหม่โผล่ให้พิมพ์
    const editPosts = (Array.isArray(rec.posts) ? rec.posts : []).map((x) => ({
        id: String(x.id || ""), url: String(x.url || ""), caption: String(x.caption || ""), likes: normProfileCount(x.likes),
    }));
    const editHls = (Array.isArray(rec.highlights) ? rec.highlights : []).map((h) => ({
        id: String(h.id || ""), title: String(h.title || ""), cover: String(h.cover || ""),
        items: Array.isArray(h.items) ? h.items : [],
    }));
    $("#tinyfeed-profile-edit-body").html(`
        <label class="tinyfeed-field">
            <span class="tinyfeed-field-label">ไบโอ</span>
            <textarea id="tinyfeed-pe-bio" rows="3" placeholder="เขียนแนะนำตัวสั้นๆ">${escapeText(d.bio)}</textarea>
        </label>
        <small class="tinyfeed-field-hint">พิมพ์ <b>@user</b> แทนชื่อผู้ใช้ได้ — เวลาส่งออกไปกับการ์ดจะเก็บเป็น @user ไม่ติดชื่อ persona ของคุณไป</small>
        <div class="tinyfeed-field-2col">
            <label class="tinyfeed-field"><span class="tinyfeed-field-label">ผู้ติดตาม</span>
                <input id="tinyfeed-pe-followers" type="number" min="0" value="${d.followers}" /></label>
            <label class="tinyfeed-field"><span class="tinyfeed-field-label">กำลังติดตาม</span>
                <input id="tinyfeed-pe-following" type="number" min="0" value="${d.following}" /></label>
        </div>
        <div class="tinyfeed-settings-title">โพสต์ในโปรไฟล์ (${editPosts.length})</div>
        <small class="tinyfeed-field-hint">ใช้ลิงก์รูปภายนอก (http/https) เท่านั้น รูปที่อัปโหลดไว้ในเครื่องจะไม่ติดไปกับการ์ด</small>
        <div id="tinyfeed-pe-posts" class="tinyfeed-pe-list">${editPosts.map((x) => `
            <div class="tinyfeed-pe-row" data-pp="${escapeAttr(x.id)}">
                <div class="tinyfeed-pe-thumb"><img src="${escapeAttr(x.url)}" alt="" onerror="this.classList.add('tinyfeed-img-broken')" /></div>
                <div class="tinyfeed-pe-fields">
                    <input class="tinyfeed-pe-url" type="text" value="${escapeAttr(x.url)}" placeholder="ลิงก์รูป https://..." />
                    <input class="tinyfeed-pe-cap" type="text" value="${escapeAttr(x.caption)}" placeholder="คำบรรยาย" />
                    <input class="tinyfeed-pe-likes" type="number" min="0" value="${x.likes}" placeholder="ไลก์" />
                </div>
                <span class="tinyfeed-pe-del" title="ลบโพสต์"><i class="fa-solid fa-trash"></i></span>
            </div>`).join("") || emptyInlineHtml("ยังไม่มีโพสต์")}</div>
        <button id="tinyfeed-pe-addpost" class="tinyfeed-btn-ghost"><i class="fa-solid fa-plus"></i> เพิ่มโพสต์</button>
        <div class="tinyfeed-settings-title">ไฮไลต์ (${editHls.length})</div>
        <div id="tinyfeed-pe-hls" class="tinyfeed-pe-list">${editHls.map((h) => `
            <div class="tinyfeed-pe-row" data-ph="${escapeAttr(h.id)}">
                <div class="tinyfeed-pe-thumb">${h.cover
                    ? `<img src="${escapeAttr(h.cover)}" alt="" onerror="this.classList.add('tinyfeed-img-broken')" />`
                    : `<i class="fa-solid fa-bookmark"></i>`}</div>
                <div class="tinyfeed-pe-fields">
                    <input class="tinyfeed-pe-hltitle" type="text" value="${escapeAttr(h.title)}" placeholder="ชื่อไฮไลต์" />
                    <input class="tinyfeed-pe-hlcover" type="text" value="${escapeAttr(h.cover)}" placeholder="ลิงก์รูปปก https://..." />
                    <small class="tinyfeed-field-hint">${h.items.length} รูปข้างใน</small>
                </div>
                <span class="tinyfeed-pe-hldel" title="ลบไฮไลต์"><i class="fa-solid fa-trash"></i></span>
            </div>`).join("") || emptyInlineHtml("ยังไม่มีไฮไลต์")}</div>
        <button id="tinyfeed-pe-addhl" class="tinyfeed-btn-ghost"><i class="fa-solid fa-plus"></i> เพิ่มไฮไลต์</button>
    `);
}

// อ่านค่าทุกช่องกลับเข้า record เดียวจบ (modal ไม่ได้อยู่ใต้ #tinyfeed-settings-screen จึงไม่มี auto-save ราย field)
function saveProfileEdit() {
    const rec = profileEditCtx && profileEditCtx.rec;
    if (!rec) return;
    rec.bio = String($("#tinyfeed-pe-bio").val() || "");
    rec.followers = normProfileCount($("#tinyfeed-pe-followers").val());
    rec.following = normProfileCount($("#tinyfeed-pe-following").val());
    const posts = [];
    $("#tinyfeed-pe-posts .tinyfeed-pe-row").each(function () {
        const row = $(this);
        const url = String(row.find(".tinyfeed-pe-url").val() || "").trim();
        if (!url) return;
        const id = String(row.data("pp") || profileItemId("pp"));
        const prev = (Array.isArray(rec.posts) ? rec.posts : []).find((x) => x.id === id) || {};
        posts.push({
            id, url,
            caption: String(row.find(".tinyfeed-pe-cap").val() || ""),
            likes: normProfileCount(row.find(".tinyfeed-pe-likes").val()),
            comments: Array.isArray(prev.comments) ? prev.comments : [],
            ts: prev.ts || Date.now(),
        });
    });
    rec.posts = posts;
    const hls = [];
    $("#tinyfeed-pe-hls .tinyfeed-pe-row").each(function () {
        const row = $(this);
        const id = String(row.data("ph") || profileItemId("ph"));
        const prev = (Array.isArray(rec.highlights) ? rec.highlights : []).find((x) => x.id === id) || {};
        hls.push({
            id,
            title: String(row.find(".tinyfeed-pe-hltitle").val() || ""),
            cover: String(row.find(".tinyfeed-pe-hlcover").val() || "").trim(),
            items: Array.isArray(prev.items) ? prev.items : [],
        });
    });
    rec.highlights = hls;
    saveSettingsDebounced();
    const nonPortable = [...posts.map((x) => x.url), ...hls.map((x) => x.cover)]
        .filter((u) => u && !isPortableUrl(u));
    if (nonPortable.length) {
        toastr.info(`มีลิงก์รูป ${nonPortable.length} รายการที่ไม่ใช่ http/https — จะไม่ติดไปกับการ์ดตัวละคร`, "TinyPhone");
    }
    closeProfileEdit();
    renderProfileScreen();
}

function profileAddPost() {
    const rec = profileEditCtx && profileEditCtx.rec;
    if (!rec) return;
    saveProfileEditFieldsOnly();
    rec.posts.push({ id: profileItemId("pp"), url: "", caption: "", likes: 0, comments: [], ts: Date.now() });
    renderProfileEditBody();
}
function profileAddHighlight() {
    const rec = profileEditCtx && profileEditCtx.rec;
    if (!rec) return;
    saveProfileEditFieldsOnly();
    rec.highlights.push({ id: profileItemId("ph"), title: "ไฮไลต์ใหม่", cover: "", items: [] });
    renderProfileEditBody();
}
// เก็บค่าที่พิมพ์ค้างไว้ก่อนวาด modal ใหม่ (ไม่ปิด modal ไม่ toast) — กันพิมพ์แล้วหายตอนกดเพิ่ม/ลบแถว
function saveProfileEditFieldsOnly() {
    const rec = profileEditCtx && profileEditCtx.rec;
    if (!rec || !$("#tinyfeed-pe-bio").length) return;
    rec.bio = String($("#tinyfeed-pe-bio").val() || "");
    rec.followers = normProfileCount($("#tinyfeed-pe-followers").val());
    rec.following = normProfileCount($("#tinyfeed-pe-following").val());
    $("#tinyfeed-pe-posts .tinyfeed-pe-row").each(function () {
        const row = $(this);
        const item = rec.posts.find((x) => x.id === String(row.data("pp")));
        if (!item) return;
        item.url = String(row.find(".tinyfeed-pe-url").val() || "").trim();
        item.caption = String(row.find(".tinyfeed-pe-cap").val() || "");
        item.likes = normProfileCount(row.find(".tinyfeed-pe-likes").val());
    });
    $("#tinyfeed-pe-hls .tinyfeed-pe-row").each(function () {
        const row = $(this);
        const item = rec.highlights.find((x) => x.id === String(row.data("ph")));
        if (!item) return;
        item.title = String(row.find(".tinyfeed-pe-hltitle").val() || "");
        item.cover = String(row.find(".tinyfeed-pe-hlcover").val() || "").trim();
    });
}
function profileDelPost(id) {
    const rec = profileEditCtx && profileEditCtx.rec;
    if (!rec) return;
    saveProfileEditFieldsOnly();
    rec.posts = rec.posts.filter((x) => x.id !== id);
    renderProfileEditBody();
}
function profileDelHighlight(id) {
    const rec = profileEditCtx && profileEditCtx.rec;
    if (!rec) return;
    saveProfileEditFieldsOnly();
    rec.highlights = rec.highlights.filter((x) => x.id !== id);
    renderProfileEditBody();
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

// ===== อัปโหลดรูปจากเครื่อง — ย่อในเบราว์เซอร์ (src/util.js) แล้วส่งขึ้นเซิร์ฟเวอร์ ST (ไม่เก็บ base64 ที่ไหนเลย) =====
// ทุกปุ่ม .tinyfeed-upload-btn (uploadBtnHtml() จาก components.js) ต้องอยู่ใน .tinyfeed-uploadrow เดียวกับ <input> เป้าหมาย
let uploadTarget = null;   // { $input } — ช่องที่กำลังรออัปโหลดอยู่ตอนนี้

// ย่อ+อัปโหลด 1 ไฟล์ → คืน path สั้นๆ จากเซิร์ฟเวอร์ (เช่น "user/images/tinyphone/xxx.webp")
async function uploadTinyImage(file, kind) {
    const { base64, ext } = await downscaleImageFile(file, kind);
    const name = `tf${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    return await saveBase64AsFile(base64, "tinyphone", name, ext);
}

// ลบไฟล์ที่เราอัปโหลดเองทิ้งจากดิสก์ — คืน true/false ว่าลบสำเร็จจริงไหม (caller เดิม 2 จุดไม่รอผล ยังเงียบเหมือนเดิม
// ส่วนแท็บ "ไฟล์ทั้งหมด" ใหม่จะเอาค่านี้ไป toast ให้ผู้ใช้เห็นว่าลบสำเร็จ/ไม่สำเร็จจริง)
async function deleteTinyUploadedImage(url) {
    const path = String(url || "");
    if (!path.startsWith("user/images/tinyphone/")) return false;   // ลิงก์ภายนอก/รูปในตัว → ไม่ยุ่ง
    try {
        const res = await fetch("/api/images/delete", {
            method: "POST",
            headers: getContext().getRequestHeaders(),
            body: JSON.stringify({ path }),
        });
        return res.ok;
    } catch (e) {
        console.error(`[${extensionName}] deleteTinyUploadedImage failed:`, e);   // ไม่ต้อง toast — caller เดิมไม่รอผล ไฟล์ขยะไม่กระทบการใช้งาน
        return false;
    }
}

// ตรวจว่า URL ปลอดภัยพอจะโหลดเป็นรูปไหม — ผ่าน URL parser จริงแทน regex ธรรมดา (regex .test() รอบก่อนหน้า CodeQL
// ไม่ยอมรับว่าเป็นตัวตัดสาย taint ทั้งที่กรอง scheme ถูกต้อง) รับเฉพาะ http(s) ทุก origin + data:image/ + path
// สัมพัทธ์ของเซิร์ฟเวอร์ ST เอง (user/images/...) — ปฏิเสธ javascript:/vbscript:/data:text อื่นๆ ทั้งหมด
// ลิงก์ที่ "ย้ายเครื่องแล้วยังเปิดได้" — ใช้ตัดสินว่ารูปจะติดไปกับการ์ดตัวละครได้ไหม
// (user/images/... เป็นไฟล์บนเซิร์ฟเวอร์เครื่องนี้ เครื่องปลายทางไม่มี)
function isPortableUrl(u) { return /^https?:\/\//i.test(String(u || "").trim()); }

function isSafeImgUrl(u) {
    if (!u) return false;   // ว่างเปล่า → new URL("", base) จะ resolve เป็น origin เฉยๆ (protocol http: ผ่านเงื่อนไขข้างล่างไปแบบผิดๆ) กันไว้ตรงนี้
    if (/^data:image\//i.test(u)) return true;
    if (/^\.?\/?user\/images\//i.test(u)) return true;
    try {
        const parsed = new URL(u, window.location.origin);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (e) {
        return false;   // parse ไม่ผ่าน = ไม่ใช่ URL รูปแบบที่ยอมรับ
    }
}

// ตั้ง src ของ <img> อย่างปลอดภัย — ใช้แทน .attr("src", url)/element.src = url ตรงๆ ทุกจุดในไฟล์นี้ ห้ามเขียนตัวตรวจซ้ำที่อื่น
function setImgSrcSafe($img, url) {
    const u = String(url || "").trim();
    const el = $img.get(0);
    if (!el) return false;
    if (u && isSafeImgUrl(u)) {
        $img.removeClass("tinyfeed-img-broken");
        el.src = u;
        return true;
    }
    $img.addClass("tinyfeed-img-broken");
    el.removeAttribute("src");
    return false;
}

// พรีวิวสี่เหลี่ยมเล็กข้าง input — ใช้ .tinyfeed-gallery-thumb-wrap/-thumb เดิม (ได้ .tinyfeed-img-broken ฟรีตอนรูปเสีย)
// เรียกจากทุก populate/render ที่เติมค่าลง input ใน .tinyfeed-uploadrow (หลัง .val(...) เสมอ) + จากช่องพิมพ์เองตอนพิมพ์
function updateUploadPreview($input) {
    const $prev = $input.closest(".tinyfeed-uploadrow").find(".tinyfeed-upload-preview");
    if (!$prev.length) return;
    const url = String($input.val() || "").trim();
    $prev.closest(".tinyfeed-upload-preview-wrap").toggleClass("tinyfeed-hidden", !url);
    if (url) setImgSrcSafe($prev, url);
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
    if (!data.connect.threadBg || typeof data.connect.threadBg !== "object") data.connect.threadBg = {};
    // watermark "อ่านถึงเวลาไหนแล้ว" ต่อห้อง (ไม่ใช่ flag ต่อข้อความ — รอดจากการลบข้อความ/แก้ index ได้)
    if (!data.connect.readUpTo || typeof data.connect.readUpTo !== "object") data.connect.readUpTo = {};
    if (!Array.isArray(data.connect.calls)) data.connect.calls = [];   // ประวัติการโทร — ผูกแชท (ลบแชท = ควรหาย)
    if (!Array.isArray(data.connect.scheduled)) data.connect.scheduled = [];   // ข้อความตั้งเวลาที่ยังไม่ถึงเวลาส่ง
    return data.connect;
}

// ===== TinyConnect: ประวัติการโทร =====
function getCalls() {
    return getConnectData().calls;
}
function saveCalls() {
    saveFeedDataDebounced();   // ประวัติการโทรผูกแชทเสมอ (ไม่มีห้องเพ็ทในระบบโทร ไม่ต้องผ่าน saveThread)
}
function findCall(id) {
    return getCalls().find((c) => c.id === id) || null;
}

// ── ลบประวัติการโทร (ทีละรายการ หรือทั้งหมด) ──
// ลบออกจาก getCalls() + การ์ดในเธรด (ถ้ายังอยู่) เสมอ · ลบข้อความในแชทหลักของ ST ด้วยถ้าเปิด callDeleteAlsoMainChat ไว้
function deleteCallRecordLocal(id) {
    const data = getConnectData();
    const call = findCall(id);
    if (!call) return null;
    data.calls = data.calls.filter((x) => x.id !== id);
    if (call.key) {
        const arr = getThread(call.key);
        const i = arr.findIndex((m) => m.isCall && m.call && m.call.id === id);
        if (i >= 0) arr.splice(i, 1);
        saveThread(call.key);
    }
    saveCalls();
    return call;
}

// ลบข้อความบันทึกสาย (ถ้าเคยแทรกไว้) ออกจากแชทหลักของ ST — ลองทางเบา (deleteMessage บนแถวที่ render อยู่) ก่อน
// deleteMessage() คืนเงียบถ้าแถวนั้นไม่ได้ render อยู่ใน DOM (แชทยาว/เลื่อนไปไกลแล้ว) → fallback ตัดออกจาก array เองแล้ว reload ทีเดียว
async function removeCallLogsFromMainChat(ids) {
    if (!ids || !ids.length) return;
    const ctx = getContext();
    if (!Array.isArray(ctx.chat)) return;
    const findIdx = (id) => ctx.chat.findIndex((m) => m && m.extra && m.extra.tinyfeed_call && m.extra.tinyfeed_call.id === id);
    let needsReload = false;
    try {
        isWritingCallLog = true;   // กัน onChatMessage ตีความการลบ/reload นี้เป็นข้อความ RP ใหม่
        for (const id of ids) {
            const idx = findIdx(id);
            if (idx < 0) continue;   // ไม่เคยแทรกไว้ (ปิด callLogToMainChat อยู่ตอนนั้น) — ไม่ใช่ error
            if (typeof ctx.deleteMessage === "function") {
                await ctx.deleteMessage(idx);
                if (findIdx(id) >= 0) { const i2 = findIdx(id); ctx.chat.splice(i2, 1); needsReload = true; }
            } else {
                ctx.chat.splice(idx, 1);
                needsReload = true;
            }
        }
        if (ctx.chatMetadata) ctx.chatMetadata.tainted = true;
        if (typeof ctx.saveChat === "function") await ctx.saveChat();
        if (needsReload && typeof ctx.reloadCurrentChat === "function") await ctx.reloadCurrentChat();
    } catch (e) {
        console.error(`[${extensionName}] ลบบันทึกการโทรในแชทหลักไม่สำเร็จ:`, e);
        toastr.error("ลบข้อความในแชทหลักไม่สำเร็จ (ลบออกจากโทรศัพท์ให้แล้ว)", "TinyConnect");
    } finally {
        isWritingCallLog = false;
    }
}

async function deleteCallRecord(id) {
    const call = findCall(id);
    if (!call) return;
    const alsoMain = Boolean(getSetting("callDeleteAlsoMainChat"));
    if (!confirm(alsoMain
        ? "ลบประวัติสายนี้ออกทั้งในโทรศัพท์และข้อความในแชทหลัก (ถ้ามี) ใช่ไหม?"
        : "ลบประวัติสายนี้ออกจากโทรศัพท์ใช่ไหม?")) return;
    deleteCallRecordLocal(id);
    if (alsoMain) await removeCallLogsFromMainChat([id]);
    renderCallHistory();
    if (currentApp === "connect" && isConnectThreadOpen() && activeThread === call.key) renderThread();
    closeCallDetail();
    updateChatInjection();
    toastr.success("ลบประวัติการโทรแล้ว", "TinyConnect");
}

async function clearAllCallHistory() {
    const calls = getCalls();
    if (!calls.length) return;
    const alsoMain = Boolean(getSetting("callDeleteAlsoMainChat"));
    if (!confirm(`ล้างประวัติการโทรทั้งหมด ${calls.length} รายการ${alsoMain ? " (รวมข้อความในแชทหลักด้วย)" : ""} ใช่ไหม?`)) return;
    const ids = calls.map((c) => c.id);
    for (const id of ids) deleteCallRecordLocal(id);
    if (alsoMain) await removeCallLogsFromMainChat(ids);
    renderCallHistory();
    if (currentApp === "connect" && isConnectThreadOpen()) renderThread();
    closeCallDetail();
    updateChatInjection();
    toastr.success("ล้างประวัติการโทรทั้งหมดแล้ว", "TinyConnect");
}

function getThread(key) {
    if (key === "pet") return getPet().dm;   // เพ็ทเก็บห้องแชตแบบ global (ไม่ผูกแชท) → persist ด้วย savePet()
    const c = getConnectData();
    if (!Array.isArray(c.threads[key])) c.threads[key] = [];
    return c.threads[key];
}
// เซฟห้องแชตให้ถูกที่ตามชนิดข้อมูล — ห้องเพ็ทเป็น global (extension_settings) ห้องอื่นผูกแชท (chat_metadata)
// ใช้แทนการเช็ค key==="pet" ซ้ำเองทุกจุดที่ push ข้อความเข้าห้อง (พลาดจุดเดียว = ข้อความห้องเพ็ทเซฟผิดที่แล้วหายตอนสลับแชท)
function saveThread(key) {
    if (key === "pet") savePet();
    else saveFeedDataDebounced();
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
    updateUploadPreview($("#tinyfeed-group-avatar"));
    form.removeClass("tinyfeed-hidden");
}

function createGroup() {
    const name = String($("#tinyfeed-group-name").val() || "").trim();
    const avatar = String($("#tinyfeed-group-avatar").val() || "").trim();
    const members = $(".tinyfeed-group-check:checked").map(function () { return $(this).val(); }).get();
    if (!name) { toastr.info("ตั้งชื่อกลุ่มก่อนนะ", "TinyConnect"); return; }
    if (members.length < 2) { toastr.info("เลือกสมาชิกอย่างน้อย 2 คน", "TinyConnect"); return; }
    getConnectGroups().push({ id: "g" + Date.now(), name, members, avatar });
    saveFeedDataDebounced();
    toggleGroupForm(false);
    renderConnectList();
}

// แก้ชื่อ+รูปกลุ่มเดิม — modal แทน window.prompt() (prompt() เป็น dialog เบราว์เซอร์ ทะลุกรอบโทรศัพท์)
let groupEditKey = null;
function openGroupEditModal(key) {
    const g = findGroup(key);
    if (!g) return;
    groupEditKey = key;
    $("#tinyfeed-group-edit-name").val(g.name || "");
    $("#tinyfeed-group-edit-avatar").val(g.avatar || "");
    updateUploadPreview($("#tinyfeed-group-edit-avatar"));
    $("#tinyfeed-group-edit-modal").removeClass("tinyfeed-hidden");
}
function closeGroupEditModal() {
    $("#tinyfeed-group-edit-modal").addClass("tinyfeed-hidden");
    groupEditKey = null;
}
function saveGroupEdit() {
    const g = findGroup(groupEditKey);
    if (!g) { closeGroupEditModal(); return; }
    const name = String($("#tinyfeed-group-edit-name").val() || "").trim();
    if (!name) { toastr.info("ตั้งชื่อกลุ่มก่อนนะ", "TinyConnect"); return; }
    g.name = name;
    g.avatar = String($("#tinyfeed-group-edit-avatar").val() || "").trim();
    saveFeedDataDebounced();
    if (isConnectThreadOpen() && activeThread === groupEditKey) $(".tinyfeed-title").text(g.name);
    closeGroupEditModal();
    renderConnectList();
}

function deleteGroup(key) {
    const g = findGroup(key);
    if (!g) return;
    if (!confirm(`ลบกลุ่ม "${g.name}" ใช่ไหม?`)) return;
    const c = getConnectData();
    c.groups = getConnectGroups().filter((x) => x.id !== g.id);
    delete c.threads[key];
    saveFeedDataDebounced();
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

// ข้อความ 1 รายการในแชท TinyConnect → ข้อความล้วน ใช้ทำ transcript ป้อน AI (รวมสลิป/แชร์/ของขวัญ — ห้ามแก้ทีละที่ ใช้จุดนี้จุดเดียว)
function connectMsgText(m) {
    if (m.isSlip) return `[โอนเงิน ${formatMoney(m.amount)}${m.note ? " — " + m.note : ""}]`;
    if (m.isShare) { const s = m.share || {}; return `[แชร์: ${htmlToPlain(s.title || "")}${s.body ? " — " + htmlToPlain(s.body) : ""}]`; }
    if (m.isGift) { const g = m.gift || {}; return `[ส่งของขวัญ: ${htmlToPlain(g.name || "")}]`; }
    if (m.isCall) return callMsgLine(m.call || {});
    return htmlToPlain(m.text);
}

// บรรทัด plain-text ของการ์ดโทร — ใช้ทั้งใน connectMsgText (AI มองเห็น) และ preview รายชื่อ
// ป้ายสถานะการโทร — จุดเดียวที่แปล status → ข้อความไทย ใช้ร่วมทุกที่ที่แสดงประวัติการโทร
// (การ์ดในเธรด · แท็บประวัติ · หน้ารายละเอียด · บันทึกลงแชทหลัก) ห้ามเขียนแมปนี้ซ้ำที่อื่น
function callStatusLabel(status) {
    switch (status) {
        case "missed": return "ไม่ได้รับสาย";
        case "declined": return "ปฏิเสธสาย";
        case "noanswer": return "ไม่มีคนรับสาย";
        case "cancelled": return "ยกเลิกการโทร";
        default: return "";   // "ended" ไม่มีป้าย — ที่เรียกใช้จะโชว์ระยะเวลาแทน
    }
}
// สถานะที่ "ไม่ได้คุยกันจริง" ทั้งหมด (ต่างจาก ended ที่มี turns คุยจริง)
function callIsMissedLike(status) { return status !== "ended"; }

function callMsgLine(call) {
    const kindLabel = call.kind === "video" ? "วิดีโอคอล" : "โทรเสียง";
    if (callIsMissedLike(call.status)) return `[${callStatusLabel(call.status)} — ${kindLabel}]`;
    return `[${kindLabel} ${formatCallDuration(call.durationSec)}]`;
}

// วินาที → "N นาที M วินาที" (ต่ำกว่า 1 นาที = "N วินาที") — ค่าติดลบ/ไม่ใช่ตัวเลข = 0 วินาที
function formatCallDuration(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    if (m <= 0) return `${r} วินาที`;
    return `${m} นาที ${r} วินาที`;
}

// นาฬิกาจับเวลาแบบ mm:ss บนหน้าจอสาย — ต่างจาก formatCallDuration (ประโยคยาว ใช้ในการ์ด/บันทึก)
function formatCallClock(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function isConnectThreadOpen() {
    return !$("#tinyfeed-connect-thread").hasClass("tinyfeed-hidden");
}

// แท็บ "แชต" / "ประวัติการโทร" ในหน้ารายชื่อ TinyConnect — คงแท็บที่เลือกไว้ข้ามการนำทาง (ไม่บังคับกลับไปแชตทุกครั้ง)
let connectTab = "chats";
const CONNECT_TABS = ["chats", "calls"];
function switchConnectTab(tab) {
    connectTab = CONNECT_TABS.includes(tab) ? tab : "chats";
    $(".tinyfeed-tab[data-ctab]").removeClass("tinyfeed-tab-active");
    $(`.tinyfeed-tab[data-ctab="${connectTab}"]`).addClass("tinyfeed-tab-active");
    $("#tinyfeed-connect-list").toggleClass("tinyfeed-hidden", connectTab !== "chats");
    $("#tinyfeed-connect-calls").toggleClass("tinyfeed-hidden", connectTab !== "calls");
    if (connectTab === "calls") renderCallHistory();
    else renderConnectList();
}

// ชิปอ้างโน้ตเหนือแถบพิมพ์ — ตั้งค่าโดย replyToNoteInConnect() (กด "ตอบในแชต" จากโน้ตบนแถบสตอรี่)
// คู่ขนานกับ quoteTarget ของฟีด: ต้องล้างทุกครั้งที่ออกจากห้อง/ออกจากแอป ไม่งั้นค้างข้ามหน้าจอ
let connectQuotePending = null;   // { owner, name, text }

function renderConnectQuoteChip() {
    const chip = $("#tinyfeed-connect-quote-chip");
    if (!chip.length) return;
    if (!connectQuotePending) { chip.addClass("tinyfeed-hidden"); return; }
    $("#tinyfeed-connect-quote-name").text(connectQuotePending.name || "");
    $("#tinyfeed-connect-quote-text").text(String(connectQuotePending.text || "").slice(0, 40));
    chip.removeClass("tinyfeed-hidden");
}
function cancelConnectQuote() { connectQuotePending = null; renderConnectQuoteChip(); }

function openConnectList() {
    activeThread = null;
    cancelConnectQuote();
    clearConnectReveal();
    closeConnectPlusMenu();
    toggleGroupForm(false);
    $("#tinyfeed-connect-tools, #tinyfeed-connect-tabs").removeClass("tinyfeed-hidden");
    $("#tinyfeed-connect-thread").addClass("tinyfeed-hidden");
    $("#tinyfeed-home-btn, #tinyfeed-settings-btn").removeClass("tinyfeed-hidden");
    $("#tinyfeed-back").addClass("tinyfeed-hidden");
    $(".tinyfeed-title").text("TinyConnect");
    switchConnectTab(connectTab);
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
        return `${who ? who + ": " : ""}${connectMsgText(m)}`.slice(0, 42);
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

// ===== TinyConnect: โหมดขึ้นทีละบับเบิล =====
// ใช้เฉพาะ "ข้อความล่าสุดที่เพิ่งมาถึง" ของแชต 1:1 — ข้อความเก่าวาดเต็มเสมอไม่ต้องรอ
let connectReveal = null;   // { key, idx, total, shown, timer }
function clearConnectReveal() {
    if (connectReveal && connectReveal.timer) clearTimeout(connectReveal.timer);
    connectReveal = null;
}
function scheduleConnectRevealStep() {
    if (!connectReveal) return;
    if (connectReveal.shown >= connectReveal.total) { connectReveal = null; return; }
    const delay = Math.max(300, parseInt(getSetting("connectRevealDelayMs"), 10) || 900);
    connectReveal.timer = setTimeout(() => {
        if (!connectReveal) return;
        connectReveal.shown++;
        renderThread();
        scheduleConnectRevealStep();
    }, delay);
}
function startConnectReveal(key, idx, total) {
    clearConnectReveal();
    if (total <= 1) return;   // บับเบิลเดียวไม่มีอะไรต้องทยอย
    connectReveal = { key, idx, total, shown: 1, timer: null };
    scheduleConnectRevealStep();
}
// เรียกทันทีหลัง push ข้อความ contact ใหม่ — เริ่มทยอยเฉพาะตอนเปิดห้องนี้อยู่จริง (ไม่ตั้ง timer ค้างเปล่าๆ เวลาไม่ได้ดู)
// คืน true ถ้าเริ่มทยอยจริง (ผู้เรียกจะได้รู้ว่าต้องเรียก renderThread() เองไหม)
function maybeStartConnectReveal(key, escapedText) {
    if (!getSetting("connectRevealSequential")) return false;
    if (currentApp !== "connect" || activeThread !== key) return false;
    const idx = getThread(key).length - 1;
    const total = connectBubbleSegments(escapedText).length;
    if (total <= 1) return false;
    startConnectReveal(key, idx, total);
    renderThread();
    return true;
}

function openThread(key, name) {
    clearConnectReveal();   // เข้าห้องใหม่ = เลิกทยอยของห้องเก่า (กันชนกับ idx ของห้องอื่น)
    flushDueScheduled();
    activeThread = key;
    activeThreadName = name;
    $("#tinyfeed-connect-list, #tinyfeed-connect-calls, #tinyfeed-connect-tools, #tinyfeed-connect-tabs").addClass("tinyfeed-hidden");
    toggleGroupForm(false);
    $("#tinyfeed-connect-thread").removeClass("tinyfeed-hidden");
    $("#tinyfeed-home-btn, #tinyfeed-settings-btn").addClass("tinyfeed-hidden");
    $("#tinyfeed-back").removeClass("tinyfeed-hidden");
    $(".tinyfeed-title").text(name);
    applyConnectBg(key);
    renderThread();
    updateConnectSendBtn();   // ว่าง+1:1=คทา · ว่าง+กลุ่ม=คทา(ให้กลุ่มคุยต่อ) · ว่าง+เพ็ท=ซ่อนปุ่ม
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
    // segment ที่เป็นโทเคนรูป/สติกเกอร์ล้วน (ทั้งบรรทัด) → ไม่ครอบด้วยกรอบบับเบิล ให้เห็นรูปเปล่าๆ
    const mediaOnlyRe = /^\[(?:sticker|img):[^\]]+\]$/i;
    const bubblesHtml = (text, idx) => {
        const segs = connectBubbleSegments(text);
        // โหมดทีละบับเบิล: แถวนี้ตรงกับข้อความที่กำลังทยอยอยู่ไหม — โชว์แค่ที่ "มาถึงแล้ว" ที่เหลือแทนด้วยจุดกำลังพิมพ์
        const revealing = connectReveal && connectReveal.key === activeThread && connectReveal.idx === idx;
        const list = revealing ? segs.slice(0, connectReveal.shown) : segs;
        const html = list.map((s) => {
            const cls = mediaOnlyRe.test(s) ? "tinyfeed-msg-media" : "tinyfeed-msg-bubble";
            return `<div class="${cls}">${renderRich(s)}</div>`;
        }).join("");
        const stillTyping = revealing && connectReveal.shown < segs.length;
        return html + (stillTyping ? `<div class="tinyfeed-msg-bubble tinyfeed-msg-typing">กำลังพิมพ์…</div>` : "");
    };
    // เส้นคั่นเวลา: โผล่เมื่อห่างจากข้อความก่อนหน้าเกิน connectTimeGapMin (หรือเป็นข้อความแรก)
    const gapMs = Math.max(1, parseInt(getSetting("connectTimeGapMin"), 10) || 30) * 60000;
    let prevTs = null;
    const timeDivider = (ts) => `<div class="tinyfeed-msg-timediv"><span>${escapeText(formatChatTime(ts))}</span></div>`;
    // สถานะ "อ่านแล้ว" — เฉพาะแชต 1:1 (ไม่ใช่กลุ่ม/ห้องเพ็ท) ใช้ watermark เวลา ไม่ใช่ flag ต่อข้อความ
    // (ฟองที่ i ไหนคือฟองผู้ใช้ล่าสุดที่ถูกอ่านแล้ว หาใหม่ทุกครั้ง — ไม่กระทบ data-idx ที่ deleteConnectMessage ใช้ลบตามตำแหน่ง)
    const readUpTo = (!group && activeThread !== "pet" && getSetting("connectReadReceipts"))
        ? ((getConnectData().readUpTo || {})[activeThread] || 0) : 0;
    let readIdx = -1;
    if (readUpTo > 0) {
        for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].from === "user" && itemTimestamp(msgs[i]) <= readUpTo) { readIdx = i; break; }
        }
    }
    // จัดกลุ่มบับเบิลที่ "ติดกัน" ให้ระยะห่างเท่ากันไม่ว่าจะเป็นข้อความผู้ใช้ (คนละ object ต่อครั้งส่ง) หรือ AI (object เดียวแตกหลายบับเบิล)
    // เกณฑ์ตัดกลุ่ม: คนละฝั่ง (from ต่างกัน) · แชตกลุ่มคนละคนพูด (author ต่างกัน) · หรือมีเส้นคั่นเวลาคั่นอยู่
    const groupKey = (m) => (group ? (m.author || group.name) : m.from);
    const rows = msgs.map((m, i) => {
        const ts = itemTimestamp(m);
        let divider = "";
        let gapBroke = false;
        if (ts) {
            if (prevTs === null || ts - prevTs >= gapMs) { divider = timeDivider(ts); gapBroke = true; }
        }
        const prev = msgs[i - 1];
        const isGroupStart = !prev || gapBroke || prev.from !== m.from || (group && groupKey(prev) !== groupKey(m));
        const next = msgs[i + 1];
        let isGroupEnd = true;
        if (next) {
            const nextTs = itemTimestamp(next);
            const nextGapBroke = ts && nextTs && (nextTs - ts >= gapMs);
            isGroupEnd = nextGapBroke || next.from !== m.from || (group && groupKey(next) !== groupKey(m));
        }
        prevTs = ts;
        const groupCls = `${isGroupStart ? "tinyfeed-msg-gstart" : "tinyfeed-msg-gcont"} ${isGroupEnd ? "tinyfeed-msg-gend" : ""}`;
        const content = m.isSlip ? slipCardHtml(m) : m.isShare ? shareCardHtml(m) : m.isGift ? giftCardHtml(m) : m.isCall ? callCardHtml(m) : bubblesHtml(m.text, i);
        if (m.from === "user") {
            const readLabel = i === readIdx ? `<div class="tinyfeed-msg-read">อ่านแล้ว · ${escapeText(formatChatTime(readUpTo))}</div>` : "";
            return divider + `<div class="tinyfeed-msg tinyfeed-msg-user ${groupCls}" data-idx="${i}">
                ${delBtn(i)}
                <div class="tinyfeed-msg-stack">${content}${readLabel}</div>
            </div>`;
        }
        // แชตกลุ่ม: ใช้ avatar/ชื่อของสมาชิกที่พูด
        const who = group ? (m.author || group.name) : contact.name;
        const avaItem = group
            ? { author: who, avatar: getNpcAvatar(who), isMain: who === ((getCurrentCharacter() || {}).name || "") }
            : contactAvatarItem(contact);
        return divider + `<div class="tinyfeed-msg tinyfeed-msg-contact ${groupCls}" data-idx="${i}">
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
    updateConnectSendBtn();   // renderThread ถูกเรียกทั้งตอนเริ่ม/ระหว่าง/จบการตอบของ AI เสมอ → จุดนี้ครอบปุ่มมอร์ฟให้ฟรี
}

// ลบบับเบิลแชท 1 อัน (อ้างตาม index ในเธรด)
function deleteConnectMessage(idx) {
    if (!activeThread || isNaN(idx)) return;
    const msgs = getThread(activeThread);
    if (idx < 0 || idx >= msgs.length) return;
    if (!confirm("ต้องการลบข้อความนี้ใช่ไหม?")) return;
    msgs.splice(idx, 1);
    saveFeedDataDebounced();
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

// การ์ดแชร์ในแชท (โพสต์/ข่าว/กระทู้/สินค้า ที่ส่งเข้ามา)
function shareCardHtml(m) {
    const s = m.share || {};
    const img = s.image ? `<img class="tinyfeed-share-img" src="${escapeAttr(s.image)}" onerror="this.classList.add('tinyfeed-img-broken')" />` : "";
    return `<div class="tinyfeed-share-card">
        ${img}
        <div class="tinyfeed-share-body">
            <div class="tinyfeed-share-head">${s.emoji ? escapeText(s.emoji) + " " : ""}${escapeText(s.title || "")}</div>
            ${s.sub ? `<div class="tinyfeed-share-sub">${escapeText(s.sub)}</div>` : ""}
            ${s.body ? `<div class="tinyfeed-share-desc">${escapeText(s.body)}</div>` : ""}
        </div>
    </div>`;
}

// การ์ดของขวัญในแชท — ใช้ thumbnail แบบเดียวกับสินค้า TinyShop/TinyBag
// dir:"in" = ตัวละครส่งของขวัญมาให้เรา (เช่นจาก GIFT: ในแชต 1:1) ไม่ใส่ dir/ใส่อย่างอื่น = ฝั่งเราส่งไป (ของเดิม)
function giftCardHtml(m) {
    const g = m.gift || {};
    const inbound = m.dir === "in";
    return `<div class="tinyfeed-gift-card">
        <div class="tinyfeed-gift-head"><i class="fa-solid fa-gift"></i> ${inbound ? "ได้รับของขวัญ" : "ส่งของขวัญ"}</div>
        <div class="tinyfeed-gift-body">
            <div class="tinyfeed-shop-thumb-wrap tinyfeed-gift-thumb-wrap">${shopThumbHtml(g)}</div>
            <div class="tinyfeed-gift-name">${escapeText(g.name || "ของขวัญ")}</div>
        </div>
    </div>`;
}

// การ์ดโทรในแชท — คลิกได้เมื่อมีบทสนทนาจริง (เปิดดูบทเต็ม, ดู openCallDetail() ที่เฟสประวัติการโทร)
function callCardHtml(m) {
    const c = m.call || {};
    const kindIcon = c.kind === "video" ? "fa-video" : "fa-phone";
    const missed = callIsMissedLike(c.status);
    const statusLabel = missed ? callStatusLabel(c.status) : "จบสาย";
    const statusIcon = missed ? "fa-phone-slash" : "fa-phone-flip";
    const clickable = Array.isArray(c.turns) && c.turns.length > 0;
    return `<div class="tinyfeed-call-card${clickable ? " tinyfeed-call-card-clickable" : ""}" ${c.id ? `data-call-id="${escapeAttr(c.id)}"` : ""}>
        <div class="tinyfeed-call-card-icon"><i class="fa-solid ${kindIcon}"></i></div>
        <div class="tinyfeed-call-card-body">
            <div class="tinyfeed-call-card-status"><i class="fa-solid ${statusIcon}"></i> ${escapeText(statusLabel)}</div>
            ${!missed ? `<div class="tinyfeed-call-card-dur">${escapeText(formatCallDuration(c.durationSec))}</div>` : ""}
        </div>
    </div>`;
}

// รายการ "ประวัติการโทร" ในแท็บของ TinyConnect — ล่าสุดขึ้นก่อน
function renderCallHistory() {
    const box = $("#tinyfeed-connect-calls");
    if (!box.length) return;
    const calls = getCalls().slice().reverse();
    if (!calls.length) {
        box.html(emptyStateHtml("fa-clock-rotate-left", "ยังไม่มีประวัติการโทร", "โทรหาใครสักคนจากแท็บแชตได้เลย"));
        return;
    }
    const rows = calls.map((c) => {
        const kindIcon = c.kind === "video" ? "fa-video" : "fa-phone";
        const dirIcon = c.dir === "out" ? "fa-arrow-up-right-from-square" : "fa-arrow-down-left";
        const missed = callIsMissedLike(c.status);
        const statusLabel = missed ? callStatusLabel(c.status) : formatCallDuration(c.durationSec);
        const missedCls = missed ? " tinyfeed-call-hist-missed" : "";
        return `<div class="tinyfeed-call-hist-item" data-call-id="${escapeAttr(c.id)}">
            <div class="tinyfeed-call-hist-icon${missedCls}"><i class="fa-solid ${kindIcon}"></i></div>
            <div class="tinyfeed-call-hist-body">
                <div class="tinyfeed-call-hist-name">${escapeText(c.name)}</div>
                <div class="tinyfeed-call-hist-meta${missedCls}"><i class="fa-solid ${dirIcon}"></i> ${escapeText(statusLabel)} · ${escapeText(formatChatTime(c.startTs))}</div>
            </div>
            <span class="tinyfeed-call-hist-callback" data-key="${escapeAttr(c.key)}" data-name="${escapeAttr(c.name)}" data-kind="${escapeAttr(c.kind)}" title="โทรกลับ"><i class="fa-solid fa-phone"></i></span>
            <span class="tinyfeed-call-hist-del" data-id="${escapeAttr(c.id)}" title="ลบรายการนี้"><i class="fa-solid fa-trash"></i></span>
        </div>`;
    }).join("");
    box.html(`<button id="tinyfeed-call-clearall" class="tinyfeed-btn-ghost tinyfeed-call-clearall"><i class="fa-solid fa-trash-can"></i> ล้างประวัติทั้งหมด</button>${rows}`);
}

// เปิดดูบทสนทนาเต็มของสาย 1 สาย (จากการ์ดในเธรด หรือจากแท็บประวัติ)
let callDetailId = null;   // สายที่กำลังเปิดดูรายละเอียดอยู่ — ให้ปุ่มลบในหน้านี้รู้ว่าจะลบรายการไหน
function openCallDetail(id) {
    const call = findCall(id);
    if (!call) return;
    callDetailId = id;
    const you = getUserName();
    const kindLabel = call.kind === "video" ? "วิดีโอคอล" : "โทรเสียง";
    const dirLabel = call.dir === "out" ? "โทรออก" : "สายเข้า";
    const statusText = callIsMissedLike(call.status) ? callStatusLabel(call.status) : formatCallDuration(call.durationSec);
    $("#tinyfeed-call-detail-title").text(`${kindLabel}กับ ${call.name}`);
    $("#tinyfeed-call-detail-meta").text(`${dirLabel} · ${formatChatTime(call.startTs)} · ${statusText}`);
    const body = call.turns.length
        ? call.turns.map((t) => `<div class="tinyfeed-call-transcript-line"><span class="tinyfeed-call-transcript-who">${escapeText(t.who === "user" ? you : call.name)}:</span> ${escapeText(t.text)}</div>`).join("")
        : `<div class="tinyfeed-call-transcript-line">ไม่มีบทสนทนา</div>`;
    $("#tinyfeed-call-detail-body").html(body);
    $("#tinyfeed-call-detail-modal").removeClass("tinyfeed-hidden");
}
function closeCallDetail() { $("#tinyfeed-call-detail-modal").addClass("tinyfeed-hidden"); callDetailId = null; }

// เปิด/ปิด modal โอนเงินในแชทที่เปิดอยู่
function openSlipModal() {
    if (!activeThread) return;
    $("#tinyfeed-slip-amount, #tinyfeed-slip-note").val("");
    $("#tinyfeed-slip-to").text(activeThreadName || "");
    $("#tinyfeed-slip-modal").removeClass("tinyfeed-hidden");
    setTimeout(() => $("#tinyfeed-slip-amount").trigger("focus"), 30);
}
function closeSlipModal() { $("#tinyfeed-slip-modal").addClass("tinyfeed-hidden"); }

// ตั้งพื้นหลังห้องแชต (ต่อห้อง — getConnectData().threadBg[key])
function openConnectBgModal() {
    if (!activeThread) return;
    const url = String((getConnectData().threadBg || {})[activeThread] || "").trim();
    $("#tinyfeed-connect-bg-to").text(activeThreadName || "");
    $("#tinyfeed-connect-bg-url").val(url);
    updateUploadPreview($("#tinyfeed-connect-bg-url"));
    let ov = parseInt(getSetting("connectBgOverlay"), 10);
    if (!Number.isFinite(ov)) ov = 45;
    $("#tinyfeed-connect-bg-overlay").val(ov);
    $("#tinyfeed-connect-bg-overlay-val").text(`${ov}%`);
    $("#tinyfeed-connect-bg-modal").removeClass("tinyfeed-hidden");
}
function closeConnectBgModal() { $("#tinyfeed-connect-bg-modal").addClass("tinyfeed-hidden"); }
function saveConnectBg() {
    if (!activeThread) { closeConnectBgModal(); return; }
    const url = String($("#tinyfeed-connect-bg-url").val() || "").trim();
    const d = getConnectData();
    if (url) d.threadBg[activeThread] = url; else delete d.threadBg[activeThread];
    saveFeedDataDebounced();
    applyConnectBg(activeThread);
    closeConnectBgModal();
    toastr.success("ตั้งพื้นหลังห้องนี้แล้ว", "TinyConnect");
}
// ใช้พื้นหลังเดียวกันนี้เป็นค่ากลางของทุกห้อง (ห้องที่ยังไม่ได้ตั้งเองจะเห็นรูปนี้)
function saveConnectBgGlobal() {
    const url = String($("#tinyfeed-connect-bg-url").val() || "").trim();
    setSetting("connectBgUrl", url);
    applyConnectBg(activeThread);
    closeConnectBgModal();
    toastr.success("ตั้งเป็นพื้นหลังกลางของทุกห้องแล้ว", "TinyConnect");
}

// ===== เลือกห้องแชตปลายทาง (ใช้ร่วมกัน: แชร์โพสต์/ข่าว/กระทู้/สินค้า + ซื้อของส่งเป็นของขวัญจาก TinyShop) =====
// ต่างจาก openCharPicker ตรงที่ value เป็น "thread key" จริง (getThread(key) ใช้ได้ทันที) ไม่ใช่แค่ชื่อ และรวมกลุ่มแชทด้วย
let connectDestCallback = null;
function openConnectDestPicker(title, onPick) {
    const contacts = getConnectContacts();
    const groups = getConnectGroups();
    if (!contacts.length && !groups.length) { toastr.info("ยังไม่มีห้องแชตให้เลือกเลยตอนนี้", "TinyConnect"); return; }
    connectDestCallback = onPick;
    $("#tinyfeed-dest-picker-title").text(title || "เลือกห้องแชต");
    // หมายเหตุ: ใช้คลาส tinyfeed-dest-pick (ไม่ใช่ tinyfeed-char-pick) ตั้งใจ — .tinyfeed-char-pick มี handler
    // ผูกกับ document แบบ global สำหรับ pickChar() อยู่แล้ว ถ้าใช้คลาสซ้ำ handler นั้นจะยิงซ้อนโดยไม่ตั้งใจ
    const rows = [
        ...contacts.map((c) => `
            <div class="tinyfeed-dest-pick" data-key="${escapeAttr(c.key)}" data-name="${escapeAttr(c.name)}">
                ${makeAvatar(contactAvatarItem(c))}
                <span class="tinyfeed-char-pick-name">${escapeText(c.name)}</span>
            </div>`),
        ...groups.map((g) => {
            const key = "group:" + g.id;
            const ava = g.avatar ? makeAvatar({ author: g.name, avatar: g.avatar }) : makeAnonAvatar(g.name);
            return `
            <div class="tinyfeed-dest-pick" data-key="${escapeAttr(key)}" data-name="${escapeAttr(g.name)}">
                ${ava}
                <span class="tinyfeed-char-pick-name">${escapeText(g.name)}</span>
            </div>`;
        }),
    ].join("");
    $("#tinyfeed-dest-picker-list").html(rows);
    $("#tinyfeed-dest-picker").removeClass("tinyfeed-hidden");
}
function closeConnectDestPicker() { $("#tinyfeed-dest-picker").addClass("tinyfeed-hidden"); connectDestCallback = null; }
function pickConnectDest(key, name) {
    const cb = connectDestCallback;
    closeConnectDestPicker();
    if (typeof cb === "function") cb(key, name);
}

// ให้ตัวละครตอบขอบคุณอัตโนมัติหลังได้ของขวัญ — เฉพาะแชต 1:1 (ไม่ใช่กลุ่ม) และต้องเป็นห้องที่กำลังเปิดดูอยู่จริง
// (ตั้งใจไม่สลับ activeThread ไปมาเอง — เสี่ยงแสดงแชตผิดห้องระหว่างรอ AI ตอบ ถ้าไม่ได้เปิดห้องนั้นอยู่ ผู้ใช้กด "ให้ตอบกลับ" เองได้ทีหลัง)
function maybeGiftThankYou(key) {
    if (!key || key.startsWith("group:")) return;
    if (currentApp === "connect" && activeThread === key) generateConnectReply();
}

// แชร์เนื้อหา (โพสต์/ข่าว/กระทู้/สินค้า) เข้าห้องแชตที่เลือก
function openSharePicker(payload) {
    openConnectDestPicker("แชร์ถึงใคร", (key, name) => {
        getThread(key).push({ from: "user", isShare: true, share: payload, ts: Date.now() });
        if (key === "pet") petBondAdd(1);
        saveThread(key);
        if (currentApp === "connect" && activeThread === key) renderThread();
        updateChatInjection();
        toastr.success(`แชร์ถึง ${name} แล้ว`, "TinyConnect");
    });
}

// ซื้อของจากร้าน + ส่งเป็นของขวัญทันที (ไม่เข้ากระเป๋าตัวเอง)
function buyGiftShopItem(itemId) {
    const it = getShop().find((x) => String(x.id) === String(itemId));
    if (!it) return;
    openConnectDestPicker(`ส่ง "${it.name}" ให้ใคร`, (key, name) => {
        if (!bankDeduct(it.price, `ซื้อ ${it.name} ส่งให้ ${name}`, "shop")) return;   // ยอดไม่พอ → toast ในตัว
        getThread(key).push({
            from: "user", isGift: true,
            gift: { name: it.name, emoji: it.emoji || "", image: it.image || "", desc: it.desc || "" },
            ts: Date.now(),
        });
        if (key === "pet") petBondAdd(3);
        saveThread(key);
        if (currentApp === "connect" && activeThread === key) renderThread();
        updateChatInjection();
        toastr.success(`ซื้อและส่ง "${it.name}" ให้ ${name} แล้ว`, "TinyShop");
        maybeGiftThankYou(key);
    });
}

// ส่งของจากกระเป๋า TinyBag เป็นของขวัญ — ใช้ในห้องแชตที่เปิดอยู่ (activeThread) เท่านั้น เพราะเมนู (+) นี้อยู่ในแชทอยู่แล้ว
function openGiftFromBag() {
    if (!activeThread) return;
    const items = getBag().filter((x) => (x.qty || 0) > 0);
    if (!items.length) { toastr.info("กระเป๋ายังไม่มีของให้ส่ง ลองซื้อจาก TinyShop ก่อนนะ", "TinyBag"); return; }
    $("#tinyfeed-giftbag-to").text(activeThreadName || "");
    $("#tinyfeed-giftbag-list").html(items.map((x) => `
        <div class="tinyfeed-shop-item" data-id="${escapeAttr(x.id)}">
            <div class="tinyfeed-shop-thumb-wrap">
                ${shopThumbHtml(x)}
                ${x.qty > 1 ? `<span class="tinyfeed-shop-owned">×${x.qty}</span>` : ""}
            </div>
            <div class="tinyfeed-shop-name">${escapeText(x.name)}</div>
            <button class="tinyfeed-giftbag-send tinyfeed-btn-primary" data-id="${escapeAttr(x.id)}">ส่งให้</button>
        </div>
    `).join(""));
    $("#tinyfeed-giftbag-modal").removeClass("tinyfeed-hidden");
}
function closeGiftFromBag() { $("#tinyfeed-giftbag-modal").addClass("tinyfeed-hidden"); }
function sendGiftFromBag(bagItemId) {
    if (!activeThread) { closeGiftFromBag(); return; }
    const bag = getBag();
    const x = bag.find((it) => it.id === bagItemId);
    if (!x) return;
    const key = activeThread, name = activeThreadName;
    x.qty = (x.qty || 1) - 1;
    const giftSnap = { name: x.name, emoji: x.emoji || "", image: x.image || "", desc: x.desc || "" };
    if (x.qty <= 0) bag.splice(bag.indexOf(x), 1);
    saveBag();
    getThread(key).push({ from: "user", isGift: true, gift: giftSnap, ts: Date.now() });
    if (key === "pet") petBondAdd(3);
    saveThread(key);
    closeGiftFromBag();
    closeConnectPlusMenu();
    renderThread();
    updateChatInjection();
    toastr.success(`ส่ง "${giftSnap.name}" ให้ ${name} แล้ว`, "TinyConnect");
    maybeGiftThankYou(key);
}

// เมนู (+) ฟังก์ชันเสริมในแชท (สไตล์ไลน์) — show() ไม่ใส่ = โชว์เสมอ, ใส่ = เช็คก่อนโชว์ (ซ่อนแถวที่ใช้ไม่ได้แทนปล่อยให้กดแล้วไม่ทำอะไร)
const CONNECT_PLUS_ACTIONS = [
    { id: "slip", icon: "fa-money-bill-transfer", label: "โอนเงิน", run: () => openSlipModal() },
    { id: "gift", icon: "fa-gift", label: "ส่งของขวัญ", run: () => openGiftFromBag() },
    { id: "bg", icon: "fa-image", label: "พื้นหลังห้อง", run: () => openConnectBgModal() },
    { id: "call-voice", icon: "fa-phone", label: "โทรออก", show: () => canCallThread(activeThread), run: () => openCall(activeThread, activeThreadName, "voice") },
    { id: "call-video", icon: "fa-video", label: "วิดีโอคอล", show: () => canCallThread(activeThread), run: () => openCall(activeThread, activeThreadName, "video") },
    { id: "sched", icon: "fa-clock", label: "ข้อความตั้งเวลา", run: () => openConnectSchedModal() },
];
function renderConnectPlusMenu() {
    $("#tinyfeed-connect-plusmenu").html(CONNECT_PLUS_ACTIONS.filter((a) => !a.show || a.show()).map((a) =>
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

// ===== TinyConnect: การโทร (เสียง/วิดีโอ) =====
// เป็น overlay เต็มจอ (ทะเบียน OVERLAYS) ไม่ใช่แอปใหม่ — แนวเดียวกับ .tinyfeed-gallery-view
let activeCall = null;      // { id, key, name, kind, dir, startTs, turns, answered } ระหว่างกำลังคุยสายอยู่ — จบสายแล้วเป็น null
let callTimer = null;       // นาฬิกาจับเวลาสาย (tick ละ 1 วิ แตะแค่ตัวเลข ไม่ re-render ทั้งจอ)
let callRingTimer = null;   // นับถอยหลังสายเรียกเข้า — หมดเวลาแล้วยังไม่รับ = ไม่ได้รับสาย
let isCallReplying = false; // กำลังรอ AI ตอบระหว่างคุยสายอยู่ไหม

// โทรได้เฉพาะแชต 1:1 — ไม่ใช่กลุ่ม (ไม่มีตัวรับสายชัดเจน) ไม่ใช่ห้องเพ็ท (เพ็ทไม่มีเส้นทาง AI คุยสาย)
function canCallThread(key) {
    if (!key || key === "pet") return false;
    return !findGroup(key);
}

function isCallActive() {
    return Boolean(activeCall);
}

// ตั้งรูปพื้นหลังเต็มจอผ่าน custom property (แนวเดียวกับ applyConnectBg) — ต้องผ่าน isSafeImgUrl เสมอ ห้ามเขียนตัวตรวจซ้ำ
// ไม่มีรูป/ไม่ผ่านการตรวจ = ปล่อยว่าง ให้ไล่เฉดสีพื้นของ .tinyfeed-call-screen เองโชว์แทน (ไม่ต้อง toggle class เพิ่ม)
function applyCallBg(url) {
    const screen = document.getElementById("tinyfeed-call-screen");
    if (!screen) return;
    if (url && isSafeImgUrl(url)) {
        screen.style.setProperty("--tf-call-bg-img", `url("${url.replace(/["\\]/g, encodeURIComponent)}")`);
    } else {
        screen.style.removeProperty("--tf-call-bg-img");
    }
}

function startCallTimer() {
    clearCallTimer();
    callTimer = setInterval(() => {
        if (!activeCall) { clearCallTimer(); return; }
        $("#tinyfeed-call-timer").text(formatCallClock((Date.now() - activeCall.startTs) / 1000));
    }, 1000);
}
function clearCallTimer() {
    if (callTimer) { clearInterval(callTimer); callTimer = null; }
}

// ตัดจบการเจนคำตอบในแชทหลักที่ยังค้างอยู่ (ถ้ามี) ก่อนเปิดหน้าจอสาย — เหมือนผู้ใช้กดปุ่ม "หยุด" เอง
// กันซีนซ้ำ: ถ้าปล่อยให้เจนต่อไปพร้อมกับคุยสาย จะได้ทั้งคุยจริงในโทรศัพท์ และคำบรรยายฉากโทรศัพท์อีกชุด
// โผล่ในแชทหลักหลังวางสายไปแล้ว (เจนเสร็จช้ากว่าคุยสายในโทรศัพท์ที่มักไวกว่า) — ไม่มีอะไรค้างก็เงียบ ไม่มีผล
function interruptMainChatGeneration(ctx) {
    try {
        if (typeof ctx.stopGeneration === "function") ctx.stopGeneration();
    } catch (e) { /* เงียบไว้ — กันซีนซ้ำไม่ได้ก็ไม่ใช่เรื่องคอขาดบาดตาย */ }
}

// เปิดหน้าจอสาย (โทรออกเอง) — kind: "voice"|"video" · เชื่อมต่อทันทีเสมอ (ยังไม่ทำ "ฝั่งโน้นไม่รับสาย")
// เปิดหน้าจอสาย (โทรออกเอง) — kind: "voice"|"video" · ตอนนี้รอ "ฝั่งโน้นรับสายไหม" จริง (ไม่ต่อติดทันทีเหมือนเดิม)
function openCall(key, name, kind) {
    if (!canCallThread(key) || activeCall) return;   // สายซ้อนสายไม่ได้
    closeOpenOverlays();
    closeConnectPlusMenu();
    const voiceMode = kind !== "video";
    const ctxNow = getContext();
    interruptMainChatGeneration(ctxNow);
    activeCall = {
        id: "call" + Date.now(), key, name,
        kind: voiceMode ? "voice" : "video", dir: "out",
        startTs: Date.now(), turns: [], answered: false,
        chatIdAtStart: typeof ctxNow.getCurrentChatId === "function" ? ctxNow.getCurrentChatId() : null,
    };
    const c = getConnectContacts().find((x) => x.key === key);
    const url = contactAvatarUrlHiRes(c ? contactAvatarItem(c) : { author: name });
    applyCallBg(url);
    setImgSrcSafe($("#tinyfeed-call-portrait-img"), url);
    $("#tinyfeed-call-name").text(name);
    $("#tinyfeed-call-status").text("กำลังโทร…");
    $("#tinyfeed-call-timer").text("");
    $("#tinyfeed-call-screen")
        .removeClass("tinyfeed-hidden tinyfeed-call-video tinyfeed-call-voice tinyfeed-call-ringing")
        .addClass(voiceMode ? "tinyfeed-call-voice" : "tinyfeed-call-video")
        .addClass("tinyfeed-call-dialing");
    // ระหว่างรอรับสาย: ไม่มีปุ่มรับ/ปฏิเสธ (นั่นสำหรับสายเข้า) — มีแต่ปุ่มวางสายทำหน้าที่ "ยกเลิก"
    $("#tinyfeed-call-accept, #tinyfeed-call-decline, #tinyfeed-call-compose, #tinyfeed-call-expand").addClass("tinyfeed-hidden");
    $("#tinyfeed-call-hangup").removeClass("tinyfeed-hidden");
    startOutRingTimer();
}

// รอฝั่งโน้นรับสาย (โทรออกเอง) — หมดเวลาแล้วสุ่มว่ารับไหม ตามโอกาส + ลดโอกาสลงถ้าอยู่ในช่วงเงียบ (quiet hours)
function startOutRingTimer() {
    clearCallRingTimer();
    const sec = Math.max(2, parseInt(getSetting("callOutRingSec"), 10) || 8);
    callRingTimer = setTimeout(() => {
        if (!activeCall || activeCall.answered) return;
        let chance = Math.max(0, Math.min(100, parseInt(getSetting("callAnswerChance"), 10) || 85));
        if (inQuietHours()) chance = Math.round(chance * 0.4);   // ดึก/เงียบ = มีโอกาสไม่รับมากขึ้น
        if (Math.random() * 100 < chance) acceptCall();
        else endCall("noanswer");
    }, sec * 1000);
}

// สายเข้า — ตัวละครโทรมาเอง (marker CALL: หรือทักเชิงรุก) รอผู้ใช้กดรับ/ปฏิเสธ หรือปล่อยจนหมดเวลา = ไม่ได้รับ
// คืน true ถ้าเริ่มเรียกสายจริง (ใช้เป็นค่า handle() ของ CONNECT_MARKERS ว่า "ทำอะไรจริง" ไหม)
function startIncomingCall(key, name, kind) {
    if (!canCallThread(key) || activeCall) return false;   // สายซ้อนสายไม่ได้
    const voiceMode = kind !== "video";
    const ctxNow = getContext();
    interruptMainChatGeneration(ctxNow);
    activeCall = {
        id: "call" + Date.now(), key, name,
        kind: voiceMode ? "voice" : "video", dir: "in",
        startTs: Date.now(), turns: [], answered: false,
        chatIdAtStart: typeof ctxNow.getCurrentChatId === "function" ? ctxNow.getCurrentChatId() : null,
    };
    const c = getConnectContacts().find((x) => x.key === key);
    const url = contactAvatarUrlHiRes(c ? contactAvatarItem(c) : { author: name });
    applyCallBg(url);
    setImgSrcSafe($("#tinyfeed-call-portrait-img"), url);
    $("#tinyfeed-call-name").text(name);
    $("#tinyfeed-call-status").text("สายเรียกเข้า…");
    $("#tinyfeed-call-timer").text("");
    $("#tinyfeed-call-screen")
        .removeClass("tinyfeed-hidden tinyfeed-call-video tinyfeed-call-voice")
        .addClass(voiceMode ? "tinyfeed-call-voice" : "tinyfeed-call-video")
        .addClass("tinyfeed-call-ringing");
    $("#tinyfeed-call-hangup, #tinyfeed-call-compose, #tinyfeed-call-expand").addClass("tinyfeed-hidden");
    $("#tinyfeed-call-accept, #tinyfeed-call-decline").removeClass("tinyfeed-hidden");
    startCallRingTimer();
    showNotif(makeAvatar(c ? contactAvatarItem(c) : { author: name }), name, "สายเรียกเข้า…", "contact", "connect", key, name);
    return true;
}

function startCallRingTimer() {
    clearCallRingTimer();
    const sec = Math.max(5, parseInt(getSetting("callRingSec"), 10) || 30);
    callRingTimer = setTimeout(() => {
        if (activeCall && !activeCall.answered) endCall("missed");
    }, sec * 1000);
}
function clearCallRingTimer() {
    if (callRingTimer) { clearTimeout(callRingTimer); callRingTimer = null; }
}

// กดรับสาย — เปลี่ยนจากหน้าเรียกเข้าเป็นหน้าคุยจริง
function acceptCall() {
    if (!activeCall || activeCall.answered) return;
    activeCall.answered = true;
    clearCallRingTimer();
    $("#tinyfeed-call-screen").removeClass("tinyfeed-call-ringing tinyfeed-call-dialing");
    beginTalking();
}

// กดปฏิเสธสาย — จบสายทันทีโดยไม่เคยรับ (ต่างจากไม่ได้รับตรงที่เป็นการกดปฏิเสธเอง)
function declineCall() {
    if (!activeCall || activeCall.answered) return;
    endCall("declined");
}

// เริ่มพูดคุยจริง (ต่อสายสำเร็จ ไม่ว่าจะโทรออกเองหรือกดรับสายเข้า) — โชว์แถบพิมพ์ + เริ่มนาฬิกา + ให้อีกฝ่ายพูดก่อนเสมอ
function beginTalking() {
    if (!activeCall) return;
    $("#tinyfeed-call-screen").removeClass("tinyfeed-call-ringing tinyfeed-call-dialing");   // เผื่อเรียกตรงจากที่อื่นในอนาคต
    activeCall.startTs = Date.now();   // นับความยาวสายจากจุดที่ต่อติดจริง ไม่รวมเวลาที่เรียกอยู่
    $("#tinyfeed-call-status").text(activeCall.kind === "video" ? "วิดีโอคอล" : "กำลังคุยสาย");
    $("#tinyfeed-call-timer").text("00:00");
    $("#tinyfeed-call-accept, #tinyfeed-call-decline").addClass("tinyfeed-hidden");
    $("#tinyfeed-call-hangup, #tinyfeed-call-compose, #tinyfeed-call-expand").removeClass("tinyfeed-hidden");
    $("#tinyfeed-call-transcript").addClass("tinyfeed-hidden").empty();
    $("#tinyfeed-call-sub").addClass("tinyfeed-hidden").empty();
    $("#tinyfeed-call-expand i").attr("class", "fa-solid fa-chevron-up");
    $("#tinyfeed-call-input").val("");
    updateCallSendBtn();
    startCallTimer();
    generateCallReply();
}

// เคลียร์ส่วนที่เป็น "ระหว่างคุย/กำลังเรียก" ของ UI — ใช้ร่วมกันทั้ง abort/end
function resetCallScreenUI() {
    $("#tinyfeed-call-screen").addClass("tinyfeed-hidden").removeClass("tinyfeed-call-voice tinyfeed-call-video tinyfeed-call-ringing tinyfeed-call-dialing");
    // #tinyfeed-call-compose ห้าม .empty() — เมาท์ครั้งเดียวตอนบูตจาก mountComposeBars() ไม่ได้สร้างใหม่ทุกครั้งที่เปิดสาย
    // (เคยพลาดมาแล้ว: .empty() ตรงนี้ลบ input/ปุ่มส่งทิ้งถาวร ทำให้สายถัดไปพิมพ์อะไรไม่ได้เลย)
    $("#tinyfeed-call-compose, #tinyfeed-call-expand, #tinyfeed-call-accept, #tinyfeed-call-decline").addClass("tinyfeed-hidden");
    $("#tinyfeed-call-transcript, #tinyfeed-call-sub").addClass("tinyfeed-hidden").empty();
    $("#tinyfeed-call-input").val("");
    // เปิดเครื่องมาตอนสายกำลังเรียกไว้เมื่อกี้ (openPhone ข้าม restoreLastScreen ไปตอนนั้นเพื่อไม่ให้ไปวางสายทิ้ง)
    // ตอนนี้สายจบแล้ว มา restore แทนให้ ไม่งั้นจะเจอหน้าโฮมที่ยังไม่เคย render อะไรเลย (ว่างเปล่า) ต้องปิดเปิดเครื่องใหม่ถึงจะกลับมาถูก
    if (pendingScreenRestore) {
        pendingScreenRestore = false;
        restoreLastScreen();
    }
}

// ยกเลิกสายที่กำลังคุยโดย "ไม่บันทึก" — ใช้เฉพาะตอนแชท ST สลับระหว่างคุยสาย เพราะ CHAT_CHANGED ยิงหลังจาก
// chat_metadata ถูกสลับไปเป็นแชทใหม่แล้ว เรียก endCall() ตรงนั้นจะเขียน record ลง metadata แชทใหม่ผิดที่
// จึงแค่ทิ้งสถานะสายไปเงียบๆ (ไม่มีบันทึกดีกว่าบันทึกผิดแชท)
function abortActiveCall() {
    if (!activeCall) return;
    clearCallTimer();
    clearCallRingTimer();
    activeCall = null;
    isCallReplying = false;
    resetCallScreenUI();
}

// วางสาย/ปิดหน้าจอสาย — บันทึก record + ดันการ์ดเข้าห้องแชต · ใช้เป็น OVERLAYS.close ด้วย จึงต้องเรียกได้แม้ activeCall เป็น null แล้ว (idempotent)
// status ไม่ใส่ = อนุมานเอง (รับสายแล้วค่อยวาง = "ended" · ยังไม่ได้รับเลย = "missed") · ใส่เอง = "declined" ตอนกดปฏิเสธ
function endCall(status) {
    if (!activeCall) { resetCallScreenUI(); return; }
    clearCallTimer();
    clearCallRingTimer();
    const call = activeCall;
    activeCall = null;
    isCallReplying = false;
    const finalStatus = status || (call.answered ? "ended" : "missed");
    const durationSec = call.answered ? Math.round((Date.now() - call.startTs) / 1000) : 0;
    const record = {
        id: call.id, key: call.key, name: call.name, kind: call.kind, dir: call.dir,
        status: finalStatus, startTs: call.startTs, endTs: Date.now(), durationSec,
        turns: call.turns, logged: false, chatIdAtStart: call.chatIdAtStart,
    };
    getCalls().push(record);
    // ตัดประวัติเก่าสุดทิ้งถ้าเกิน callHistoryMax (ตั้งไว้นานแล้วแต่ไม่เคยมีจุดอ่านค่าจริง)
    const maxHist = Math.max(1, parseInt(getSetting("callHistoryMax"), 10) || 30);
    if (getCalls().length > maxHist) getConnectData().calls = getCalls().slice(-maxHist);
    getThread(call.key).push({ from: call.dir === "out" ? "user" : "contact", isCall: true, ts: record.endTs, call: record });
    saveThread(call.key);
    saveCalls();
    resetCallScreenUI();
    if (currentApp === "connect" && activeThread === call.key) renderThread();
    updateChatInjection();
    logCallToMainChat(record);   // ไม่ await — แทรกลงแชทหลักของ ST แบบ fire-and-forget มี try/catch ในตัวเองแล้ว
}

// ===== TinyConnect: แทรกบันทึกการโทรลงประวัติแชทหลักของ SillyTavern =====

// ข้อความล้วนของบันทึกการโทร — ส่วนที่ AI "อ่าน" (mes) ไม่มี HTML เลย ปลอดภัยเสมอไม่ว่า power_user.encode_tags จะเปิดไหม
function callPlainTranscript(call) {
    const kindLabel = call.kind === "video" ? "วิดีโอคอล" : "โทรเสียง";
    const timeLabel = formatChatTime(call.startTs);
    if (callIsMissedLike(call.status)) {
        // ทิศทางในประโยค: สายเข้า (missed/declined) พูดว่า "จาก" · โทรออกเอง (noanswer/cancelled) พูดว่า "หา"
        const withWhom = call.dir === "out" ? `หา ${call.name}` : `จาก ${call.name}`;
        return `[บันทึกการโทร] สาย${call.dir === "out" ? "ที่โทรออก" : "เข้า"}${withWhom} · ${timeLabel} · ${callStatusLabel(call.status)} (${kindLabel})`;
    }
    const you = getUserName();
    const lines = call.turns.map((t) => `${t.who === "user" ? you : call.name}: ${t.text}`);
    const withWhom = call.dir === "out" ? `กับ ${call.name}` : `จาก ${call.name}`;
    return `[บันทึกการโทร] ${kindLabel}${withWhom} · ${timeLabel} · คุยกัน ${formatCallDuration(call.durationSec)}\n${lines.join("\n")}\n[จบสาย]`;
}

// HTML ของบันทึกการโทรสำหรับ extra.display_text (สิ่งที่ตาเห็นในแชทหลัก — บล็อกพับได้) ต่างจาก mes ที่ AI อ่าน
// ต้องใช้ style="" ล้วนเท่านั้น ห้ามใช้ class — DOMPurify ของ ST เขียนทับ class="foo" เป็น "custom-foo" ทำให้ CSS เราใช้ไม่ได้
// ใช้สีกลาง (rgba เทา) เพราะแชทหลักมีธีมของ ST เอง ไม่ใช่ธีมโทรศัพท์ · ทุกช่องที่มาจากบทพูดจริงต้อง escape เสมอ
function callLogHtml(call) {
    const kindLabel = call.kind === "video" ? "วิดีโอคอล" : "โทรเสียง";
    const timeLabel = formatChatTime(call.startTs);
    if (callIsMissedLike(call.status)) {
        const dirLabel = call.dir === "out" ? "หา" : "จาก";
        return `📞 <b>${escapeText(callStatusLabel(call.status))}</b> — ${escapeText(kindLabel)}${dirLabel} ${escapeText(call.name)} · ${escapeText(timeLabel)}`;
    }
    const you = getUserName();
    const withWhom = call.dir === "out" ? `กับ` : `จาก`;   // โทรออกเอง = "กับ" · สายเข้า = "จาก" (ให้ตรงกับ callPlainTranscript)
    const lines = call.turns.map((t) =>
        `<div style="margin:4px 0;"><b>${escapeText(t.who === "user" ? you : call.name)}:</b> ${escapeText(t.text)}</div>`
    ).join("");
    return `<details style="border:1px solid rgba(128,128,128,.35); border-radius:10px; padding:8px 12px; margin:6px 0; background:rgba(128,128,128,.1);">` +
        `<summary style="cursor:pointer; font-weight:600;">📞 ${escapeText(kindLabel)}${withWhom} ${escapeText(call.name)} · ${escapeText(timeLabel)} · ${escapeText(formatCallDuration(call.durationSec))}</summary>` +
        `<div style="margin-top:8px; line-height:1.6;">${lines || "(ไม่มีบทสนทนา)"}</div>` +
        `</details>`;
}

let isWritingCallLog = false;   // กันวนซ้ำ — ข้อความที่เรายิงเข้าแชทหลักเองไม่ใช่ RP จริง เช็คใน onChatMessage()

// แทรกบันทึกการโทร 1 สายเข้าประวัติแชทหลักของ SillyTavern จริงๆ (ครั้งแรกที่ extension นี้เขียนลง ctx.chat)
// is_system:false เพื่อให้ AI "อ่านเห็น" (is_system:true ถูกกรองออกจาก prompt ที่ Generate()) · ต่อท้ายเท่านั้น ห้าม splice
// (แทรกกลางต้องผ่าน reloadCurrentChat ซึ่งรีเซ็ตตัวนับ auto-generate ของเราทั้งหมด + ทำ mesid เพี้ยนจาก index จริง)
async function logCallToMainChat(call) {
    if (call.logged || !getSetting("callLogToMainChat")) return;
    if (!getCurrentCharacter()) return;   // ไม่มีตัวละครโหลดอยู่ — ไม่รู้จะแทรกลงแชทไหน
    const ctx = getContext();
    if (!Array.isArray(ctx.chat)) return;
    // สลับแชท ST ไปแล้วระหว่างที่สายกำลังดำเนินอยู่ — เขียนตอนนี้จะลงผิดแชท ข้ามไปเลย (ประวัติยังอยู่ในโทรศัพท์ตามปกติ)
    const chatIdNow = typeof ctx.getCurrentChatId === "function" ? ctx.getCurrentChatId() : null;
    if (call.chatIdAtStart != null && chatIdNow !== call.chatIdAtStart) return;

    const encodeTagsOn = Boolean(ctx.powerUserSettings && ctx.powerUserSettings.encode_tags);
    const contact = getConnectContacts().find((c) => c.key === call.key);
    const avatarUrl = contactAvatarUrl(contact || { author: call.name });
    const message = {
        name: `📞 ${call.name}`,
        is_user: false,
        is_system: false,
        send_date: new Date().toISOString(),
        mes: callPlainTranscript(call),
        extra: {
            type: "tinyfeed_call",
            swipeable: false,   // กัน clearMessageData() ตอน swipe ลบ display_text ทิ้ง + กันมีลูกศร regenerate โผล่บนบันทึก
            tinyfeed_call: { id: call.id, key: call.key, kind: call.kind, dir: call.dir, status: call.status, startTs: call.startTs, durationSec: call.durationSec },
        },
    };
    if (avatarUrl && isSafeImgUrl(avatarUrl)) message.force_avatar = avatarUrl;
    if (!encodeTagsOn) message.extra.display_text = callLogHtml(call);   // encode_tags เปิดอยู่ = HTML จะโดน escape เป็นตัวอักษรดิบ ข้ามไปโชว์ mes เฉยๆ ดีกว่า

    try {
        isWritingCallLog = true;
        ctx.chat.push(message);
        const idx = ctx.chat.length - 1;
        if (ctx.chatMetadata) ctx.chatMetadata.tainted = true;
        await ctx.eventSource.emit(ctx.eventTypes.MESSAGE_RECEIVED, idx, "extension");
        ctx.addOneMessage(message);
        await ctx.eventSource.emit(ctx.eventTypes.CHARACTER_MESSAGE_RENDERED, idx, "extension");
        await ctx.saveChat();
        call.logged = true;
    } catch (e) {
        console.error(`[${extensionName}] แทรกบันทึกการโทรลงแชทหลักไม่สำเร็จ:`, e);
        toastr.error("แทรกบันทึกการโทรลงแชทหลักไม่สำเร็จ (ประวัติยังอยู่ในโทรศัพท์ตามปกติ)", "TinyConnect");
    } finally {
        isWritingCallLog = false;
    }
}

// ===== TinyConnect: คุยกันระหว่างสาย =====

// ปุ่มพูด: ปกติ = ส่ง · กำลังรอ AI ตอบ = สปินเนอร์ (ไม่มีสถานะ "ว่าง=คทา" แบบแชตข้อความ เพราะสายเป็นเรียลไทม์
// ส่งแล้วยิงให้ตอบทันทีอยู่แล้ว — ไม่ต้องมีปุ่มแยกไว้กดขอคำตอบ)
function updateCallSendBtn() {
    const $btn = $("#tinyfeed-call-send");
    if (!$btn.length) return;
    const $icon = $btn.find("i");
    if (isCallReplying) {
        $icon.attr("class", "fa-solid fa-spinner fa-spin");
        $btn.attr("title", "กำลังพูด…");
    } else {
        $icon.attr("class", "fa-solid fa-paper-plane");
        $btn.attr("title", "พูด");
    }
}

// อัปเดตซับไตเติล (1-2 บรรทัดล่าสุด) + บทเต็ม (ถ้ากางอยู่) — เรียกตอนมีเทิร์นใหม่เท่านั้น ไม่ใช่ทุก tick (ไม่ผิดกฎ low-motion)
function renderCallTranscript() {
    if (!activeCall) return;
    const you = getUserName();
    const who = (t) => (t.who === "user" ? you : activeCall.name);
    const subHtml = activeCall.turns.slice(-2)
        .map((t) => `<div>${escapeText(who(t))}: ${escapeText(t.text)}</div>`).join("");
    const transcriptExpanded = !$("#tinyfeed-call-transcript").hasClass("tinyfeed-hidden");
    $("#tinyfeed-call-sub").html(subHtml).toggleClass("tinyfeed-hidden", !subHtml || transcriptExpanded);
    const fullHtml = activeCall.turns
        .map((t) => `<div class="tinyfeed-call-transcript-line"><span class="tinyfeed-call-transcript-who">${escapeText(who(t))}:</span> ${escapeText(t.text)}</div>`)
        .join("");
    $("#tinyfeed-call-transcript").html(fullHtml || `<div class="tinyfeed-call-transcript-line">ยังไม่มีบทสนทนา</div>`);
    const box = document.getElementById("tinyfeed-call-transcript");
    if (box) box.scrollTop = box.scrollHeight;
}

// กดปุ่มขยาย/ยุบดูบทเต็มระหว่างคุยสาย — กางบทเต็มแล้วซ่อนซับไตเติล (กันซ้ำซ้อนกัน)
function toggleCallTranscript() {
    const $t = $("#tinyfeed-call-transcript");
    const willShow = $t.hasClass("tinyfeed-hidden");
    $t.toggleClass("tinyfeed-hidden", !willShow);
    $("#tinyfeed-call-sub").toggleClass("tinyfeed-hidden", willShow);
    $("#tinyfeed-call-expand i").attr("class", willShow ? "fa-solid fa-chevron-down" : "fa-solid fa-chevron-up");
}

// ส่งข้อความช่วงคุยสาย — ต่างจากแชตปกติตรงที่ส่งแล้วยิงให้ตอบทันที (สายคือเรียลไทม์ ไม่ต้องรอกดคทา)
function sendCallMessage(text) {
    const clean = String(text || "").trim();
    if (!clean || !activeCall || isCallReplying) return;
    activeCall.turns.push({ who: "user", text: clean, ts: Date.now() });
    $("#tinyfeed-call-input").val("");
    renderCallTranscript();
    generateCallReply();
}

// เทิร์นของ AI ระหว่างคุยสาย — ไม่ใช้ CONNECT_MARKERS (สลิป/ของขวัญ/ดูแลเพ็ทกลางสายไม่สมเหตุผล + กัน CALL: วนซ้ำ)
// จำ callId ไว้เทียบก่อนเขียนผล กันเคสวางสาย+โทรใหม่ระหว่างรอ AI ตอบ แล้วผลเก่าเผลอไปเติมใส่สายใหม่
async function generateCallReply() {
    if (!activeCall || isCallReplying) return;
    const callId = activeCall.id;
    const you = getUserName();
    const name = activeCall.name;
    const kindLabel = activeCall.kind === "video" ? "วิดีโอคอล" : "คุยโทรศัพท์";
    const dirLabel = activeCall.dir === "out" ? `${you} เป็นฝ่ายโทรหา ${name}` : `${name} เป็นฝ่ายโทรหา ${you}`;
    const recentRaw = getThread(activeCall.key).slice(-6)
        .map((m) => `${m.from === "user" ? you : (m.author || name)}: ${connectMsgText(m)}`).join("\n");
    const transcript = activeCall.turns.slice(-14)
        .map((t) => `${t.who === "user" ? you : name}: ${t.text}`).join("\n");
    const extra = String(getSetting("callExtraPrompt") || "").trim();
    const hangupEnabled = getSetting("callAiHangupEnabled");
    const hangupLine = hangupEnabled
        ? `ถ้า ${name} อยากจบสายตอนนี้ (คุยจบเรื่องแล้ว/มีธุระต้องไป — นานๆ ครั้งเท่านั้น ไม่ใช่ทุกเทิร์น) ` +
          `ให้ขึ้นต้นคำพูดประโยคสุดท้ายด้วย HANGUP: แล้วตามด้วยคำพูดปิดท้ายสั้นๆ ก่อนวางสาย เช่น HANGUP: แล้วเจอกันนะ บาย~\n`
        : "";
    const q = buildPrompt("callReply", {
        you, name, kind: kindLabel, dir: dirLabel,
        extra: extra ? `คำสั่งเพิ่มเติม: ${extra}.\n` : "",
        hangup: hangupLine,
        context: crossAppContext("connect"),
        recent: recentRaw || "(ยังไม่เคยคุยกันมาก่อน)",
        transcript: transcript || "(ยังไม่มีใครพูดอะไร)",
    });
    isCallReplying = true;
    updateCallSendBtn();
    try {
        const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("callTokens"), 10) || 160), "connect");
        let reply = stripReasoning(raw).trim();
        reply = stripWrapBrackets(reply);
        const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        reply = reply.replace(new RegExp(`^${esc}\\s*[:：]\\s*`, "i"), "").trim();
        // มาร์คเกอร์ HANGUP: — ตัดแค่คำนำหน้าออก (ข้อความตามหลังยังเป็นคำพูดจริงที่ต้องโชว์) ไม่ใช่ตัดทั้งบรรทัดแบบ marker อื่น
        const hangupRe = /HANGUP:\s*/i;
        const willHangup = hangupEnabled && hangupRe.test(reply);
        if (willHangup) reply = reply.replace(hangupRe, "").trim();
        if (activeCall && activeCall.id === callId) {
            if (reply) {
                activeCall.turns.push({ who: "contact", text: reply, ts: Date.now() });
                renderCallTranscript();
            } else {
                toastr.warning("ฝั่งโน้นเงียบไป ลองพูดอะไรอีกทีนะ", "TinyConnect");
            }
            // วางไว้หลัง turns.push ให้ผู้ใช้เห็นคำพูดปิดท้ายก่อน แล้วค่อยวางสายให้เอง (หน่วงสั้นๆ ให้อ่านทัน)
            if (willHangup) {
                $("#tinyfeed-call-status").text("กำลังจะวางสาย…");
                setTimeout(() => { if (activeCall && activeCall.id === callId) endCall(); }, 1800);
            }
        }
    } catch (e) {
        console.error(`[${extensionName}] call reply failed:`, e);
        toastr.error("คุยสายไม่สำเร็จ ลองใหม่นะ", "TinyConnect");
    } finally {
        if (activeCall && activeCall.id === callId) {
            isCallReplying = false;
            updateCallSendBtn();
        }
    }
}

// ผู้ใช้โอนเงินออก → หักบัญชี + ดันสลิปในแชท
function sendUserSlip() {
    if (!activeThread) return;
    const amt = parseInt($("#tinyfeed-slip-amount").val(), 10);
    const note = String($("#tinyfeed-slip-note").val() || "").trim();
    if (!Number.isFinite(amt) || amt <= 0) { toastr.info("ใส่จำนวนเงินก่อนนะ", "TinyConnect"); return; }
    const toName = activeThreadName || "ผู้รับ";
    if (!bankDeduct(amt, `โอนให้ ${toName}`, "connect")) return;   // ยอดไม่พอ → มี toast ในตัว
    getThread(activeThread).push({ from: "user", isSlip: true, dir: "out", amount: amt, note, ts: Date.now() });
    saveFeedDataDebounced();
    closeSlipModal();
    renderThread();
}

// คู่แชท (1:1) ส่งสลิปโอนเข้า: SLIP: จำนวนเงิน | โน้ต — คืน true ถ้าดันสลิปเข้าแชทจริง (ใช้กันข้อความเตือน "ยังไม่มีคำตอบ" หลอก)
function processConnectSlip(raw, fromName) {
    if (!getSetting("connectSlipEnabled") || !activeThread) return false;
    const m = /SLIP:\s*([^\n|]+)(?:\|([^\n]*))?/i.exec(stripReasoning(raw));
    if (!m) return false;
    const amount = Math.abs(Math.round(parseFloat(String(m[1]).replace(/[^\d.]/g, "")) || 0));
    if (!amount) return false;
    const note = String(m[2] || "").trim();
    if (bankAdd(amount, `รับโอนจาก ${fromName}`, "connect", { silentToast: true })) {
        getThread(activeThread).push({ from: "contact", author: fromName, isSlip: true, dir: "in", amount, note, ts: Date.now() });
        return true;
    }
    return false;
}

// ประมวลผลบรรทัด READ: — ชั้นที่ 2 ของสถานะ "อ่านแล้ว" ให้ AI เลือกเองว่าจะอ่านเฉยๆ ไม่ตอบไหม (ชั้นที่ 1 คือทอยก่อนเจนใน generateConnectReply)
// แค่เจอบรรทัดนี้ก็ถือว่า "อ่านแล้ว" ทันที ไม่สนว่าข้อความที่เหลือ (ถ้ามี) จะว่างหรือไม่ — คืน true เสมอเมื่อเจอ
function handleAiReadOnly(raw, ctx) {
    if (!/^READ:/im.test(stripReasoning(raw))) return false;
    if (!activeThread) return false;
    getConnectData().readUpTo[activeThread] = Date.now();
    saveThread(activeThread);
    return true;
}

// คู่แชท (1:1) อยากโทรมาเอง: CALL: voice|video | เหตุผล — คืน true ถ้าเริ่มเรียกสายจริง (ยังไม่รวมสายในกลุ่ม/ห้องเพ็ท)
// ===== TinyConnect: ข้อความตั้งเวลา (AI ตั้งไว้ล่วงหน้า แสดงย้อนหลังตามเวลาจริงที่ตั้ง) =====
// เก็บที่ chat_metadata.tinyfeed.connect.scheduled — ทุกอย่างอยู่ใน metadata จึงรอดปิด-เปิดเซิร์ฟเวอร์ใหม่ได้
// (ไม่ได้พึ่ง timer ที่ค้างอยู่ในหน้าเว็บเหมือนสตรีม/นาฬิกา) materialize ผ่าน flushDueScheduled()
function scheduleNewId() { return "sch" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

// แปลง "+30m" / "+2h" / "08:30" → เวลาสัมบูรณ์ (ms) — รูปแบบไม่รู้จักคืน null (ผู้เรียกต้องทิ้งเงียบ ไม่ push)
function parseScheduleTimeExpr(expr) {
    const s = String(expr || "").trim();
    let m = /^\+\s*(\d+)\s*m(?:in)?$/i.exec(s);
    if (m) return Date.now() + parseInt(m[1], 10) * 60000;
    m = /^\+\s*(\d+)\s*h(?:r)?$/i.exec(s);
    if (m) return Date.now() + parseInt(m[1], 10) * 3600000;
    m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s);
    if (m) {
        const d = new Date();
        d.setSeconds(0, 0);
        d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
        if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);   // เวลาที่ผ่านไปแล้ววันนี้ → หมายถึงพรุ่งนี้
        return d.getTime();
    }
    return null;
}

// AI ตั้งเวลาส่งข้อความ — ทนตอบเพี้ยนทุกทาง: รูปแบบเวลาอ่านไม่ออก/เวลาย้อนหลัง/ไกลเกินที่ตั้งไว้ → ทิ้งเงียบ ไม่ push
function handleAiSchedule(raw, ctx) {
    if (!activeThread) return false;
    const m = /SCHEDULE:\s*([^|]+)\|\s*(.+)/i.exec(stripReasoning(raw));
    if (!m) return false;
    const dueTs = parseScheduleTimeExpr(m[1]);
    const text = stripWrapBrackets(htmlToPlain(m[2]));
    if (!dueTs || !text) return false;
    const maxMs = Math.max(1, parseInt(getSetting("connectScheduleMaxHours"), 10) || 48) * 3600000;
    if (dueTs <= Date.now() || dueTs - Date.now() > maxMs) return false;
    getConnectData().scheduled.push({ id: scheduleNewId(), key: activeThread, author: ctx.name, text, dueTs, createdTs: Date.now() });
    saveFeedDataDebounced();
    return true;
}

// แทรกข้อความตามลำดับเวลา (ts) ไม่ใช่ต่อท้ายเสมอ — dueTs ของข้อความตั้งเวลาอาจเก่ากว่าข้อความล่าสุดในห้อง
// (renderThread คำนวณเส้นคั่นเวลาจากลำดับ array ตรงๆ ถ้าแทรกผิดที่เส้นคั่นจะมั่ว)
function insertMessageByTime(key, msg) {
    const arr = getThread(key);
    let i = arr.length;
    while (i > 0 && itemTimestamp(arr[i - 1]) > msg.ts) i--;
    arr.splice(i, 0, msg);
}

// เรียกทุกครั้งที่มีโอกาสพลาดข้อความที่ถึงเวลาแล้ว: เปิดเครื่อง, สลับแชท, เข้าห้อง, และ proactive tick พื้นหลัง
function flushDueScheduled() {
    let data;
    try { data = getConnectData(); } catch (e) { return; }   // ยังไม่มีแชทเปิดอยู่
    if (!Array.isArray(data.scheduled) || !data.scheduled.length) return;
    const now = Date.now();
    const due = data.scheduled.filter((x) => x.dueTs <= now);
    if (!due.length) return;
    data.scheduled = data.scheduled.filter((x) => x.dueTs > now);
    const recentWindowMs = 5 * 60000;   // เพิ่งถึงเวลาไม่กี่นาทีนี้เท่านั้นถึงจะเด้งแจ้งเตือน — ที่ค้างมานานตอนปิดเครื่องให้เงียบ
    let touchedActive = false;
    for (const item of due) {
        insertMessageByTime(item.key, { from: "contact", text: escapeHtml(item.text), ts: item.dueTs });
        if (item.key === activeThread) touchedActive = true;
        if (now - item.dueTs < recentWindowMs) {
            const c = getConnectContacts().find((x) => x.key === item.key);
            showNotif(makeAvatar(c ? contactAvatarItem(c) : { author: item.author }), item.author, item.text, "contact", "connect", item.key, item.author);
        }
    }
    saveFeedDataDebounced();
    if (currentApp === "connect" && touchedActive) renderThread();
    updateChatInjection();
}

// ── ดู/ยกเลิกรายการที่ตั้งไว้ (เฉพาะห้องที่เปิดอยู่) ──
function openConnectSchedModal() {
    renderConnectSchedList();
    $("#tinyfeed-connect-sched").removeClass("tinyfeed-hidden");
}
function closeConnectSchedModal() { $("#tinyfeed-connect-sched").addClass("tinyfeed-hidden"); }
function renderConnectSchedList() {
    if (!activeThread) return;
    const items = getConnectData().scheduled.filter((x) => x.key === activeThread).sort((a, b) => a.dueTs - b.dueTs);
    const body = $("#tinyfeed-connect-sched-body");
    if (!items.length) {
        body.html(emptyInlineHtml("ยังไม่มีข้อความตั้งเวลาในห้องนี้"));
        return;
    }
    body.html(items.map((x) => `
        <div class="tinyfeed-sched-row" data-id="${escapeAttr(x.id)}">
            <div class="tinyfeed-sched-when"><i class="fa-solid fa-clock"></i> ${escapeText(formatChatTime(x.dueTs))}</div>
            <div class="tinyfeed-sched-text">${escapeText(x.text)}</div>
            <span class="tinyfeed-sched-del" title="ยกเลิก"><i class="fa-solid fa-trash"></i></span>
        </div>`).join(""));
}
function cancelScheduledMessage(id) {
    const data = getConnectData();
    data.scheduled = data.scheduled.filter((x) => x.id !== id);
    saveFeedDataDebounced();
    renderConnectSchedList();
}

function handleAiCall(raw, ctx) {
    if (!activeThread || !canCallThread(activeThread) || isCallActive()) return false;   // สายซ้อนสายไม่ได้
    const m = /CALL:\s*(voice|video)\b/i.exec(stripReasoning(raw));
    if (!m) return false;
    return startIncomingCall(activeThread, ctx.name, m[1].toLowerCase());
}

// ===== TinyConnect: ทะเบียนกลางของ "บรรทัดคำสั่งพิเศษ" ที่ AI ใส่ท้ายคำตอบแชต 1:1 (นอกเหนือจากคำตอบปกติ) =====
// เพิ่ม marker ใหม่ = เพิ่ม entry เดียวที่นี่ — ห้ามแปะเงื่อนไขแยกใน generateConnectReply (จะกลายเป็นหลายจุดที่ต้องแก้พร้อมกัน)
//   setting  ชื่อ setting ที่ต้องเปิดถึงจะสอน AI ด้วย prompt บรรทัดนี้ + ประมวลผลตอนได้คำตอบ
//   line(ctx)  ข้อความ prompt สอน AI (ต่อเข้า {{markers}} ของ PROMPT_DEFS.connectReply)
//   re       regex ตัดบรรทัดนี้ออกจากข้อความที่โชว์ในบับเบิลแชต (ต้องมี flag รวม g + im)
//   handle(raw, ctx)  ประมวลผลจากข้อความดิบ (ยังไม่ตัด marker ออก) — คืน true ถ้าทำอะไรจริง (เช่น ดันการ์ดเข้าแชท)
const CONNECT_MARKERS = [
    {
        id: "slip", setting: "connectSlipEnabled",
        line: (ctx) => `[ระบบโอนเงิน] ถ้า ${ctx.name} อยากโอนเงินให้ ${ctx.you} (เฉพาะตอนที่เข้ากับเนื้อเรื่องจริงๆ ไม่ต้องบ่อย) ให้ใส่บรรทัดแยกท้ายข้อความ: SLIP: <จำนวนเงิน> | <โน้ตสั้นๆ>.\n`,
        re: /^SLIP:.*$/gim,
        handle: (raw, ctx) => processConnectSlip(raw, ctx.name),
    },
    {
        id: "gift", setting: "connectGiftEnabled",
        line: (ctx) =>
            `[ระบบของขวัญ] ถ้า ${ctx.name} อยากซื้อของจากร้าน TinyShop ส่งให้ ${ctx.you} (นานๆ ครั้งเท่านั้น เฉพาะตอนที่เข้ากับเนื้อเรื่อง) ` +
            `ให้ใส่บรรทัดแยกท้ายข้อความ: GIFT: <ชื่อสินค้าตรงตามรายการในร้าน>. เลือกได้เฉพาะสินค้าที่มีในร้านเท่านั้น ห้ามแต่งชื่อสินค้าขึ้นมาเอง.\n` +
            giftShopVisibleContext(),
        re: /^GIFT:.*$/gim,
        handle: (raw, ctx) => handleAiGift(raw, ctx),
    },
    {
        id: "petcare", setting: "petAiCareEnabled",
        line: (ctx) => {
            const p = getPet();
            if (!p.exists || p.isDead) return "";   // ไม่มีเพ็ทมีชีวิตให้ดูแล — ไม่ต้องสอน AI เรื่องนี้เลย
            return `[ระบบดูแลสัตว์เลี้ยง] ถ้า ${ctx.name} อยากช่วยดูแล ${p.name} (สัตว์เลี้ยงของ ${ctx.you} ในแอป TinyPet) ` +
                `ให้ใส่บรรทัดแยกท้ายข้อความ: PETCARE: <feed|play|clean> — นานๆ ครั้งเท่านั้น เฉพาะตอนที่เข้ากับเนื้อเรื่อง.\n` +
                petCareVisibleContext();
        },
        re: /^PETCARE:.*$/gim,
        handle: (raw, ctx) => handleAiPetCare(raw, ctx),
    },
    {
        id: "read", setting: "connectReadReceipts",
        line: (ctx) => `[ระบบอ่านข้อความ] ถ้า ${ctx.name} แค่อ่านข้อความล่าสุดแต่ยังไม่อยากตอบตอนนี้ (เข้ากับเนื้อเรื่อง เช่นกำลังยุ่งอยู่) ให้ตอบแค่คำเดียวว่า: READ: อ่านแล้ว (ห้ามมีข้อความอื่นปนเลย)\n`,
        re: /^READ:.*$/gim,
        handle: (raw, ctx) => handleAiReadOnly(raw, ctx),
    },
    {
        id: "call", setting: "callAiCallEnabled",
        line: (ctx) => `[ระบบโทรศัพท์] ถ้า ${ctx.name} อยากโทรหา ${ctx.you} ตอนนี้เลย (นานๆ ครั้งเท่านั้น เฉพาะตอนที่เข้ากับเนื้อเรื่องจริงๆ ไม่ใช่ทุกครั้ง) ให้ใส่บรรทัดแยกท้ายข้อความ: CALL: <voice หรือ video> | <เหตุผลสั้นๆ>\n`,
        re: /^CALL:.*$/gim,
        handle: (raw, ctx) => handleAiCall(raw, ctx),
    },
    {
        id: "schedule", setting: "connectScheduleEnabled",
        line: (ctx) => `[ระบบตั้งเวลาส่งข้อความ] ถ้า ${ctx.name} อยากตั้งเวลาส่งข้อความล่วงหน้าถึง ${ctx.you} (เช่น จะทักตอนเช้า/อีกไม่กี่ชั่วโมงข้างหน้า — นานๆ ครั้งเท่านั้น) ให้ใส่บรรทัดแยกท้ายข้อความ: SCHEDULE: <+30m หรือ +2h หรือ 08:30> | <ข้อความที่จะส่งตอนนั้น>\n`,
        re: /^SCHEDULE:.*$/gim,
        handle: (raw, ctx) => handleAiSchedule(raw, ctx),
    },
];

// ส่งข้อความ = แค่ต่อคิว (ไม่ generate ทันที) เพื่อพิมพ์/แนบรูป/สติกเกอร์หลายอันใน 1 รอบ
// แล้วค่อยกดปุ่ม "ให้ตอบกลับ" ให้ตัวละครตอบทีเดียว
function sendConnectMessage(text) {
    const clean = String(text || "").trim();
    if (!clean || !activeThread) return;
    // ตอบโน้ต: ดันการ์ดอ้างอิงเข้าไปก่อน 1 ใบ แล้วค่อยเป็นข้อความจริง (AI เห็นผ่าน connectMsgText → isShare)
    if (connectQuotePending && connectQuotePending.owner === activeThread) {
        getThread(activeThread).push({
            from: "user", isShare: true, ts: Date.now(),
            share: { kind: "note", emoji: "📝", title: `โน้ตของ ${connectQuotePending.name}`, sub: "", body: connectQuotePending.text, image: "" },
        });
    }
    cancelConnectQuote();
    getThread(activeThread).push({ from: "user", text: escapeHtml(clean), ts: Date.now() });
    if (activeThread === "pet") petBondAdd(2);   // เพ็ท = global → persist ด้วย saveThread + คุยด้วยเพิ่มผูกพันนิดหน่อย
    saveThread(activeThread);
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
            return `${who}: ${connectMsgText(m)}`;
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
                saveFeedDataDebounced();
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

    // เฟส 4: ทอยก่อนเจน — เปิด "อ่านไม่ตอบ" ไว้แล้วทอยชนะ = ตั้งเวลาอ่านแล้วจบเลย ไม่ยิงโมเดลเลย (0 token ตรงตามสไลเดอร์เป๊ะ)
    // ต่างจาก marker READ: ที่ให้ AI "เลือกเอง" อีกชั้นหนึ่งหลังทอยไม่ชนะ (ดู CONNECT_MARKERS ด้านล่าง)
    // เหตุผลที่ทอยฝั่งนี้ก่อนแยกไว้ต่างหาก: สั่งโมเดลด้วยความน่าจะเป็นตรงๆ ("25% ของครั้งให้อ่านเฉยๆ") มักไม่แม่น
    // สไลเดอร์จะโกหกถ้าพึ่ง AI ล้วน — ชั้นนี้การันตีตัวเลขตรง ส่วน AI เลือกเองเป็นชั้นเสริมให้ตัดสินใจเองได้ตามเนื้อเรื่องด้วย
    if (getSetting("connectReadReceipts")) {
        const chance = Math.max(0, Math.min(100, parseInt(getSetting("connectReadOnlyChance"), 10) || 0));
        if (chance > 0 && Math.random() * 100 < chance) {
            getConnectData().readUpTo[activeThread] = Date.now();
            saveThread(activeThread);
            renderThread();
            return;
        }
    }

    // marker ที่เปิดใช้อยู่ (ดู CONNECT_MARKERS) — สอน AI ผ่าน {{markers}} แล้วตัด/ประมวลผลบรรทัดเดียวกันตอนได้คำตอบ
    const activeMarkers = CONNECT_MARKERS.filter((mk) => getSetting(mk.setting));
    const markerCtx = { name, you };
    const extra = String(getSetting("connectExtraPrompt") || "").trim();
    const q = buildPrompt("connectReply", {
        you, name,
        extra: extra ? `คำสั่งเพิ่มเติม: ${extra}.\n` : "",
        markers: activeMarkers.map((mk) => mk.line(markerCtx)).join(""),
        context: crossAppContext("connect"),
        gallery: galleryPromptBlock(),
        transcript,
    });

    isConnectReplying = true;
    renderThread();   // โชว์ "กำลังพิมพ์…"
    try {
        const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("connectTokens"), 10) || 200), "connect");
        let reply = stripReasoning(raw).trim();
        // ถ้าโมเดลห่อด้วย [... Message: ข้อความ] ให้ดึงเฉพาะเนื้อในออกมา
        const wrapped = [...reply.matchAll(/\[[^\]]*?Message:\s*([^\]]+)\]/gi)];
        if (wrapped.length) reply = wrapped.map((m) => m[1].trim()).join("\n");
        for (const mk of activeMarkers) reply = reply.replace(mk.re, "");   // ตัดบรรทัด marker ออกจากข้อความที่จะโชว์
        reply = reply.trim();
        // ตัดวงเล็บ/ป้ายกำกับที่หลงเหลือ + "ชื่อ:" นำหน้า (ไม่ทำลายโทเคนสติกเกอร์/รูป)
        reply = stripWrapBrackets(reply);
        const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        reply = reply.replace(new RegExp(`^${esc}\\s*[:：]\\s*`, "i"), "").trim();
        if (reply) {
            getThread(activeThread).push({ from: "contact", text: escapeHtml(reply), ts: Date.now() });
            if (getSetting("connectReadReceipts")) getConnectData().readUpTo[activeThread] = Date.now();   // ตอบ = อ่านด้วย
            saveThread(activeThread);
            maybeStartConnectReveal(activeThread, escapeHtml(reply));   // เปิดโหมดทีละบับเบิลไว้ = ทยอยแทนที่จะโชว์ครบทันที
        }
        // ประมวลผล marker ทุกตัวจากข้อความดิบ (เช่น สลิปโอนเงินเข้า) — คืน true ถ้าทำอะไรจริง ใช้กันเตือน "คำตอบว่าง" หลอก
        const markerDidSomething = activeMarkers.map((mk) => mk.handle(raw, markerCtx)).some(Boolean);
        if (!reply && !markerDidSomething) {
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
    if (isCallActive()) endCall();   // ปิดเครื่องระหว่างคุยสาย = วางสายไปเลย (ยังไม่มีฟีเจอร์ย่อสายค้างพื้นหลัง)
    flushAllSaves();       // flush ทันที (settings + chat metadata) — กันเซฟที่ debounce ค้างอยู่หายไปตอนปิดเครื่อง
    console.log(`[${extensionName}] Phone closed`);
}

// ใช้ธีมกับตัวเครื่อง + ปรับไอคอน
// ===== ธีมผูกกับ persona =====
// ธีมกลาง (global) = ค่าเดิมใน extension_settings · ถ้า persona ปัจจุบันเปิด "ธีมเฉพาะ persona" ค่าที่ตั้งไว้จะทับ
// ทะเบียนเดียว — ห้ามไล่เขียนชื่อคีย์ซ้ำที่อื่น (กฎเหล็กข้อ 1)
const PERSONA_THEME_KEYS = [
    "theme", "accentColor", "homeBgHue", "themedIcons", "themedHomeBg",
    "overlayOpacity", "widgetOpacity", "connectBubbleColor",
    "wallpaperUrl", "wallpaperOverlay", "customCss",
];
function getPersonaThemeStore() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    const s = extension_settings[extensionName];
    if (!s.personaThemes || typeof s.personaThemes !== "object") s.personaThemes = {};
    return s.personaThemes;
}
function getPersonaThemeRecord(create) {
    const key = getPersonaKey();
    if (!key) return null;
    const store = getPersonaThemeStore();
    if (!store[key] && !create) return null;
    if (!store[key]) store[key] = { enabled: true };
    return store[key];
}
function personaThemeOn() {
    const rec = getPersonaThemeRecord(false);
    return Boolean(rec && rec.enabled);
}
// ★ ทุกที่ที่อ่านค่าธีมต้องผ่านตัวนี้ (ห้ามเรียก getSetting ตรงสำหรับคีย์ใน PERSONA_THEME_KEYS)
function themeValue(key) {
    const rec = getPersonaThemeRecord(false);
    if (rec && rec.enabled && rec[key] !== undefined && rec[key] !== null && rec[key] !== "") return rec[key];
    // false เป็นค่าที่ "ตั้งใจตั้ง" ได้ของ checkbox — ต้องไม่ตกไป global
    if (rec && rec.enabled && rec[key] === false) return false;
    return getSetting(key);
}
// ★ ทุกที่ที่เขียนค่าธีมต้องผ่านตัวนี้ — persona เปิดอยู่ = เขียนลง persona · ไม่งั้นลง global
function setThemeValue(key, value) {
    if (personaThemeOn()) {
        const rec = getPersonaThemeRecord(true);
        rec[key] = value;
        saveSettingsDebounced();
        return;
    }
    setSetting(key, value);
}
function applyAllTheming() {
    applyTheme(themeValue("theme") || "dark");
    applyWallpaper();
    applyAppearance();
    applyCustomCss();
}
function togglePersonaTheme(on) {
    const key = getPersonaKey();
    if (!key) { toastr.info("ยังไม่รู้จัก persona ปัจจุบัน", "TinyPhone"); return; }
    const store = getPersonaThemeStore();
    if (on) {
        if (!store[key]) store[key] = { enabled: true };
        store[key].enabled = true;
    } else if (store[key]) {
        store[key].enabled = false;
    }
    saveSettingsDebounced();
    applyAllTheming();
    if (isSettingsOpen()) populateSettings();
}
// คัดลอกธีมกลางมาเป็นจุดตั้งต้นของ persona นี้ (จะได้ไม่ต้องตั้งใหม่ทั้งหมด)
function copyGlobalThemeToPersona() {
    const rec = getPersonaThemeRecord(true);
    if (!rec) { toastr.info("ยังไม่รู้จัก persona ปัจจุบัน", "TinyPhone"); return; }
    for (const k of PERSONA_THEME_KEYS) rec[k] = getSetting(k);
    rec.enabled = true;
    saveSettingsDebounced();
    applyAllTheming();
    if (isSettingsOpen()) populateSettings();
    toastr.success("คัดลอกธีมกลางมาแล้ว", "TinyPhone");
}
function clearPersonaTheme() {
    const key = getPersonaKey();
    const store = getPersonaThemeStore();
    if (!key || !store[key]) return;
    delete store[key];
    saveSettingsDebounced();
    applyAllTheming();
    if (isSettingsOpen()) populateSettings();
    toastr.success("กลับไปใช้ธีมกลางแล้ว", "TinyPhone");
}

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
    const current = themeValue("theme") || "dark";
    const next = current === "dark" ? "light" : "dark";
    setThemeValue("theme", next);   // persona เปิดธีมของตัวเอง = สลับเฉพาะของ persona นั้น
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
    const accent = String(themeValue("accentColor") || "").trim();
    [phone, notif].forEach((el) => {
        if (!el) return;
        if (accent) el.style.setProperty("--tf-accent", accent);
        else el.style.removeProperty("--tf-accent");
    });
    // ฟิลเตอร์พื้นหลัง (0–90% → 0.0–0.9)
    let op = parseInt(themeValue("overlayOpacity"), 10);
    if (!Number.isFinite(op)) op = 50;
    op = Math.min(90, Math.max(0, op));
    const overlay = document.getElementById("tinyfeed-overlay");
    if (overlay) overlay.style.setProperty("--tf-overlay-alpha", String(op / 100));
    // สีไอคอน/พื้นหลังโฮมตามธีม
    if (phone) {
        phone.classList.toggle("tinyfeed-themed-icons", Boolean(themeValue("themedIcons")));
        phone.classList.toggle("tinyfeed-themed-home", Boolean(themeValue("themedHomeBg")));
        let hue = parseInt(themeValue("homeBgHue"), 10);
        if (!Number.isFinite(hue)) hue = 210;
        phone.style.setProperty("--tf-home-hue", String(hue));
        // ความทึบพื้นหลังวิดเจ็ต (สีตาม --tf-topbar = ตามธีม)
        let wop = parseInt(themeValue("widgetOpacity"), 10);
        if (!Number.isFinite(wop)) wop = 82;
        wop = Math.min(100, Math.max(0, wop));
        phone.style.setProperty("--tf-widget-alpha", `${wop}%`);
        // สีบับเบิลแชท TinyConnect (ฝั่งเรา) — "" = เขียวเดิม · "accent" = ตามสีเน้น · หรือ hex ที่เลือกเอง
        const bubble = String(themeValue("connectBubbleColor") || "").trim();
        if (bubble === "accent") phone.style.setProperty("--tf-connect-bubble", "var(--tf-accent)");
        else if (bubble) phone.style.setProperty("--tf-connect-bubble", bubble);
        else phone.style.removeProperty("--tf-connect-bubble");
    }
}

// เติมค่าให้ select โหมดสีบับเบิล + ช่องสีกำหนดเอง (แยกจาก applyAppearance เพราะเป็นแค่ UI ไม่ใช่การ apply)
function populateConnectBubbleColorCfg() {
    const v = String(themeValue("connectBubbleColor") || "").trim();
    let mode = "";
    if (v === "accent") mode = "accent";
    else if (v.startsWith("#")) mode = "custom";
    $("#tinyfeed-cfg-connect-bubble-mode").val(mode);
    $("#tinyfeed-cfg-connect-bubble-custom-row").toggleClass("tinyfeed-hidden", mode !== "custom");
    if (mode === "custom") $("#tinyfeed-cfg-connect-bubble-custom").val(v);
}

// วาด swatch สีสำเร็จรูปในหน้า settings + ไฮไลต์อันที่เลือกอยู่
function renderAccentSwatches() {
    const cur = String(themeValue("accentColor") || "").trim().toLowerCase();
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
    el.textContent = String(themeValue("customCss") || "");
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

// แอปทั้งหมดที่ "มีสิทธิ์" ขึ้นหน้าโฮม (ตาม APPS ในโค้ด) — ไม่สนใจว่าผู้ใช้ซ่อนไว้หรือจัดลำดับใหม่หรือยัง
function homeEligibleApps() { return APPS.filter((a) => a.home); }

/* ลำดับ id เต็มของแอปที่มีสิทธิ์ขึ้นหน้าโฮม ตามที่ผู้ใช้จัดไว้ (รวมตัวที่ซ่อนด้วย เพื่อจำตำแหน่งไว้เผื่อเปิดกลับ)
 * เริ่มจาก homeAppOrder ที่เซฟไว้ กรองตัวที่ไม่มีอยู่จริงแล้วออก (แอปถูกถอดออกจากโค้ด)
 * แล้วต่อท้ายด้วยแอปใหม่ที่ยังไม่เคยอยู่ในลิสต์ที่เซฟ (เช่นเพิ่งเพิ่มแอปใหม่หลังผู้ใช้เคยจัดลำดับไปแล้ว) */
function homeAppOrderIds() {
    const eligible = homeEligibleApps();
    const eligibleIds = new Set(eligible.map((a) => a.id));
    const saved = getSetting("homeAppOrder");
    const ordered = (Array.isArray(saved) ? saved : []).filter((id) => eligibleIds.has(id));
    for (const a of eligible) if (!ordered.includes(a.id)) ordered.push(a.id);
    return ordered;
}

// แอปที่ "จะแสดงจริง" บนหน้าโฮม — ลำดับผู้ใช้จัด + กรองตัวที่ซ่อนไว้ออก (ใช้วาดกริดจริง)
function homeAppList() {
    const hidden = new Set(getSetting("homeAppHidden") || []);
    const byId = Object.fromEntries(homeEligibleApps().map((a) => [a.id, a]));
    return homeAppOrderIds().filter((id) => !hidden.has(id)).map((id) => byId[id]);
}

// หน้าตั้งค่า "หน้าโฮม" — รายการทุกแอปที่มีสิทธิ์ขึ้นโฮม พร้อมสวิตช์เปิด/ปิด + ลูกศรจัดลำดับ
function renderHomeLayoutSettings() {
    const box = $("#tinyfeed-home-layout-list");
    if (!box.length) return;
    const byId = Object.fromEntries(homeEligibleApps().map((a) => [a.id, a]));
    const order = homeAppOrderIds();
    const hidden = new Set(getSetting("homeAppHidden") || []);
    box.html(order.map((id, i) => {
        const a = byId[id];
        const isHidden = hidden.has(id);
        return `<div class="tinyfeed-home-layout-row${isHidden ? " tinyfeed-home-layout-row-hidden" : ""}">
            <span class="tinyfeed-home-layout-icon" style="--app-a:${a.a}; --app-b:${a.b};"><i class="fa-solid ${a.icon}"></i></span>
            <span class="tinyfeed-home-layout-name">${escapeText(a.name)}</span>
            <span class="tinyfeed-home-layout-arrows">
                <i class="fa-solid fa-chevron-up tinyfeed-home-layout-up${i === 0 ? " tinyfeed-field-disabled" : ""}" data-app="${id}" title="เลื่อนขึ้น"></i>
                <i class="fa-solid fa-chevron-down tinyfeed-home-layout-down${i === order.length - 1 ? " tinyfeed-field-disabled" : ""}" data-app="${id}" title="เลื่อนลง"></i>
            </span>
            <input type="checkbox" class="tinyfeed-home-layout-toggle" data-app="${id}" ${isHidden ? "" : "checked"} title="แสดงบนหน้าโฮม" />
        </div>`;
    }).join(""));
}

// สลับตำแหน่ง id สองตัวในลิสต์ที่เซฟไว้ แล้วบันทึก + วาดใหม่ทั้งหน้าตั้งค่าและหน้าโฮม
function moveHomeApp(id, dir) {
    const order = homeAppOrderIds();
    const i = order.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    setSetting("homeAppOrder", order);
    renderHomeLayoutSettings();
    renderHomeApps();
}

function toggleHomeApp(id, show) {
    const hidden = new Set(getSetting("homeAppHidden") || []);
    if (show) hidden.delete(id);
    else {
        // กันซ่อนจนไม่เหลือแอปบนหน้าโฮมเลย
        const willRemain = homeEligibleApps().filter((a) => a.id !== id && !hidden.has(a.id));
        if (!willRemain.length) {
            toastr.warning("ต้องเหลืออย่างน้อย 1 แอปบนหน้าโฮม", "TinyPhone");
            renderHomeLayoutSettings();   // คืน checkbox กลับตามค่าจริง
            return;
        }
        hidden.add(id);
    }
    setSetting("homeAppHidden", Array.from(hidden));
    renderHomeLayoutSettings();
    renderHomeApps();
}

function renderHomeApps() {
    const pager = $("#tinyfeed-home-pager");
    if (!pager.length) return;
    const homeApps = homeAppList();
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
    ["call", { label: "โทรศัพท์ (TinyConnect)", icon: "fa-phone", color: "#22c55e" }],   // "call" ไม่ใช่แอปจริงใน APPS (เป็นฟีเจอร์ย่อยของ connect) เหมือน "news" ข้างบน
    ["story", { label: "สตอรี่ (TinyFeed)", icon: "fa-circle-play", color: (APP_BY_ID.feed || {}).a }],   // ฟีเจอร์ย่อยของ feed — ดึงสีจาก APPS ไม่ฮาร์ดโค้ดซ้ำ
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
    { id: "bag", inject: "injectBag", cross: "crossAppBag", single: () => ({ bag: true }) },
    { id: "pet", inject: "injectPet", cross: "crossAppPet", single: () => ({ pet: true }) },
    { id: "ask", inject: "injectAsk", cross: "crossAppAsk", single: () => ({ ask: true }) },
    { id: "story", inject: "injectStory", cross: "crossAppStory", single: () => ({ story: true }) },
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

// เก็บใน extension_settings.tinyfeed.pet (ไม่ใช่ chat_metadata) → เพ็ทตัวเดียวตามผู้เล่นทุกแชท
const PET_DECAY_DEFAULTS = { hunger: 0.25, energy: 0.2, cleanliness: 0.15 };   // ต่อนาที (ลดลงจากเดิม 0.5/0.35/0.3 — น้องตายไวไป)
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
    // เวลาที่ตัวละครในแชตเพิ่งช่วยดูแลเพ็ทครั้งล่าสุด (กันสแปม) — เก็บบนตัวเพ็ทเอง ไม่ใช่ setting
    // เพราะเพ็ทเป็น global ถ้าเก็บแยกต่อแชทคูลดาวน์จะรีเซ็ตทุกครั้งที่สลับแชท
    if (typeof p.aiCareAt !== "number") p.aiCareAt = 0;
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
    petNotifyUser(lines[stage] || "ฉันโตขึ้นแล้ว! 🎉");
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
    // เปิดแท็บ ST ทิ้งไว้เฉยๆ ไม่ได้เล่น RP เลย = ไม่ให้เพ็ททรุดโทรม (petTimer เดินทุก 60 วิไม่มีจุดหยุด
    // เดิมเวลาสะสมยาวๆ ตอนแท็บเปิดค้างจะแย่กว่าปิดแท็บไปเลยเพราะเพดาน offline ช่วยเฉพาะตอนกลับมาเปิดใหม่)
    const idleMin = Math.max(0, parseInt(getSetting("petIdlePauseMin"), 10) || 0);
    if (idleMin > 0 && (Date.now() - lastRpMsgTs) >= idleMin * 60000) {
        p.lastUpdateTimestamp = Date.now();
        return p;
    }
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
    // regen ตราบใดที่ยังไม่มีค่าไหนเข้าเกณฑ์โทษ (เดิมเข้มกว่านี้ — ต้องดีครบทุกค่าเกินครึ่งถึงจะฟื้น
    // ตอนนี้แค่ไม่มีโทษก็ฟื้นแล้ว ป้อนข้าว/อาบน้ำแล้วสุขภาพขึ้นให้เห็นผลจริง)
    const goodMin = Math.max(0, Math.min(
        petReachAbove(h0, effH, 80, min),
        petReachBelow(c0, rC, 20, min),
        p.isSleeping ? min : petReachBelow(e0, rE, 0, min),
    ));
    hd += 0.1 * goodMin;
    s.health = clamp100(s.health + hd);
    // ยิ่งผูกพันมาก อารมณ์ยิ่งดึงเข้าหาค่าสูงขึ้น (perk จากการดูแล/RP)
    const bondBonus = petBondLevel(p.bond) * 2;
    const wellbeing = Math.min(100, ((100 - s.hunger) + s.energy + s.cleanliness + s.health) / 4 + bondBonus);
    s.mood = clamp100(s.mood + (wellbeing - s.mood) * Math.min(1, min * 0.03));
    if (s.health <= 0) {
        if (getSetting("petNoDeath")) s.health = 1;   // โหมดไม่ตาย — ป่วยหนักสุดได้แต่ไม่ตาย
        else { p.isDead = true; p.isSleeping = false; }
    }
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
// opts: { by:"", silent:false, react:true, skipCooldown:false } — ปุ่มในแอปเรียกเปล่าๆ ได้เหมือนเดิม (ค่าเริ่มต้นทั้งหมด)
// ตัวเรียกจากภายนอก (เช่นตัวละครในแชตสั่งดูแล) ต้องส่ง silent+skipCooldown+react:false เสมอ — ไม่งั้นไปกินคูลดาวน์ปุ่มผู้ใช้
// และไปยิง tinyGenerate ซ้อนจาก petReactThrottled ระหว่างที่ generateConnectReply ยังทำงานอยู่ (เคยเป็นบั๊กจริง)
// คืนผลลัพธ์ชัดเจนแทนการคาดเดาจาก side-effect: "ok"|"full"|"tired"|"sleeping"|"cooldown"|"none"
function petAct(action, opts) {
    opts = opts || {};
    const p = getPet();
    if (!p.exists || p.isDead) return "none";
    if (p.isSleeping && action !== "sleep") {
        if (!opts.silent) toastr.info("เพ็ทกำลังหลับอยู่ ปลุกก่อนนะ", "TinyPet");
        return "sleeping";
    }
    if (!opts.skipCooldown && petOnCooldown(action)) return "cooldown";
    petApplyDecay();
    const s = p.stats;
    let sprite = "", result = "ok";
    if (action === "feed") {
        if (s.hunger <= 10) {
            s.mood = clamp100(s.mood - 5); s.health = clamp100(s.health - 3);
            if (!opts.silent) toastr.info("เพ็ทอิ่มแล้ว อย่าให้กินเยอะเกินไป!", "TinyPet");
            result = "full";
        } else { s.hunger = clamp100(s.hunger - 35); s.mood = clamp100(s.mood + 5); petBondAdd(3); }
        sprite = "eating";
    } else if (action === "play") {
        if (s.energy < 15) {
            if (!opts.silent) toastr.info("เพ็ทเหนื่อยเกินกว่าจะเล่น ให้พักก่อนนะ", "TinyPet");
            return "tired";
        }
        s.mood = clamp100(s.mood + 20); s.energy = clamp100(s.energy - 15);
        s.hunger = clamp100(s.hunger + 6); s.cleanliness = clamp100(s.cleanliness - 6);
        petBondAdd(6); sprite = "playing";
    } else if (action === "clean") {
        s.cleanliness = 100; s.mood = clamp100(s.mood + 5); petBondAdd(3); sprite = "cleaning";
    } else if (action === "sleep") {
        p.isSleeping = !p.isSleeping;
    } else {
        return "none";
    }
    p.lastUpdateTimestamp = Date.now();
    savePet();
    if (sprite) setPetActionSprite(sprite, 1600);
    renderPet();
    if (opts.react !== false && getSetting("petAiReactions")) petReactThrottled(action);
    return result;
}

// สรุปสถานะเพ็ทเป็นข้อความบรรทัดเดียว — ใช้ทั้งตอนแชร์และตอนสรุปผลหลังตัวละครช่วยดูแล
function petStatusLine(p) {
    const s = p.stats || {};
    return `อิ่ม ${Math.round(100 - (s.hunger || 0))}% · พลังงาน ${Math.round(s.energy || 0)}% · สะอาด ${Math.round(s.cleanliness || 0)}% · อารมณ์ ${Math.round(s.mood || 0)}% · สุขภาพ ${Math.round(s.health || 0)}%`;
}

// แชร์สถานะเพ็ทเข้าห้องแชตที่เลือก — ให้ตัวละครเห็นค่าปัจจุบันแล้วช่วยดูแลได้จริง (ดู marker PETCARE ใน CONNECT_MARKERS)
// ใช้ openSharePicker เดิมทั้งดุ้น (ไม่มี HTML/CSS ใหม่) — connectMsgText สาขา isShare ย่อยข้อความให้โมเดลอยู่แล้ว
function sharePetStatus() {
    const p = getPet();
    if (!p.exists || p.isDead) { toastr.info("ยังไม่มีเพ็ทให้แชร์ตอนนี้", "TinyPet"); return; }
    petApplyDecay();
    savePet();
    openSharePicker({
        kind: "pet", title: `${p.name} (${PET_STAGE_LABEL[p.stage] || p.stage})`,
        sub: "สถานะตอนนี้จากแอป TinyPet", body: petStatusLine(p),
        image: petSpriteUrl(petState()), emoji: "🐾",
    });
}

// ให้ AI เห็นสถานะเพ็ทเสมอเมื่อเปิดสวิตช์ดูแลเพ็ท — แม้ผู้ใช้ไม่ได้เปิด "ให้แอปอื่นเห็นเพ็ท" ไว้ (เหตุผลเดียวกับ giftShopVisibleContext)
function petCareVisibleContext() {
    if (getSetting("crossAppEnabled") && getSetting("crossAppPet")) return "";
    const count = Math.max(1, parseInt(getSetting("crossAppCount"), 10) || 3);
    const blocks = buildAppBlocks({ pet: true, count });
    return blocks.length ? `\n${blocks.join("\n\n")}\n` : "";
}

// ป้ายหัวข้อการ์ด "ตัวละครดูแลเพ็ท" — แยกจาก petActionLabel เพราะข้อความปุ่มในแอปกับประโยคในแชตต้องการไวยากรณ์ต่างกัน
const PETCARE_TITLE_LABEL = { feed: "ให้อาหาร", play: "เล่นกับ", clean: "อาบน้ำให้" };

// ประมวลผลบรรทัด PETCARE: <feed|play|clean> จากคำตอบ AI — ไม่รวม sleep (เป็น toggle ให้ AI สั่งจะแย่งคุมกับผู้ใช้)
// มีคูลดาวน์กันสแปม (petAiCareCooldownMin) เก็บบนตัวเพ็ทเอง ไม่ใช่ setting — คืน true ถ้าดูแลสำเร็จจริง
function handleAiPetCare(raw, ctx) {
    const p = getPet();
    if (!p.exists || p.isDead) return false;
    const m = /PETCARE:\s*(feed|play|clean)/i.exec(stripReasoning(raw));
    if (!m) return false;
    const cdMs = Math.max(0, parseInt(getSetting("petAiCareCooldownMin"), 10) || 30) * 60000;
    if (cdMs > 0 && Date.now() - (p.aiCareAt || 0) < cdMs) {
        console.warn(`[${extensionName}] AI สั่งดูแลเพ็ทแต่ยังติดคูลดาวน์กันสแปม`);
        return false;
    }
    const action = m[1].toLowerCase();
    const result = petAct(action, { by: ctx.name, silent: true, react: false, skipCooldown: true });
    // "full" ก็นับว่า "ทำจริง" (มีผลข้างเคียงจริง แค่เป็นโทษป้อนซ้ำตอนอิ่มแล้ว) ต้องกินคูลดาวน์เหมือนกัน
    // ไม่งั้น AI สั่ง feed รัวๆ ตอนอิ่มแล้วจะไม่โดนคูลดาวน์เลยสักที (ช่องโหว่สแปมที่คูลดาวน์นี้ตั้งใจกันอยู่)
    if (result !== "ok" && result !== "full") {
        console.warn(`[${extensionName}] petAct("${action}") จาก AI ไม่สำเร็จ (ผลลัพธ์: ${result})`);
        return false;
    }
    p.aiCareAt = Date.now();
    savePet();
    if (!activeThread) return true;   // ดูแลสำเร็จแล้ว แต่ไม่มีห้องแชตให้ดันการ์ด (ไม่ควรเกิดขึ้นจริงเพราะ marker นี้ทำงานเฉพาะตอนตอบแชต 1:1)
    getThread(activeThread).push({
        from: "contact", author: ctx.name, isShare: true,
        share: {
            kind: "petcare", title: `${ctx.name} ${PETCARE_TITLE_LABEL[action] || "ดูแล"}${p.name}`,
            sub: "TinyPet", body: petStatusLine(p), image: petSpriteUrl(petState()), emoji: "🐾",
        },
        ts: Date.now(),
    });
    saveThread(activeThread);
    return true;
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
    updateUploadPreview($("#tinyfeed-pet-item-image"));
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
        const name = cleanAiName(parts[0] || "");
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

// ชุบชีวิต: ตัวเดิมกลับมา คงชื่อ/ระยะวิวัฒนาการ/ความผูกพัน/เหรียญไว้ทั้งหมด แต่ค่าสถานะเริ่มใหม่แบบไม่เต็ม (กันตายซ้ำทันที)
function petRevive() {
    const p = getPet();
    if (!p.exists || !p.isDead) return;
    p.isDead = false;
    p.isSleeping = false;
    p.stats = { hunger: 30, energy: 60, cleanliness: 60, mood: 50, health: 50 };
    p.lastUpdateTimestamp = Date.now();
    savePet();
    renderPet();
    toastr.success(`${p.name || "เพ็ท"} ฟื้นขึ้นมาแล้ว! 💫`, "TinyPet");
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
        saveFeedDataDebounced();
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
/* เพ็ท "ทัก" ผู้ใช้ — แจ้งเตือนล้วน (แบนเนอร์ + ลิ้นชัก + OS ผ่าน showNotif) กดแล้วพาไปแอป TinyPet โดยตรง
 * เดิมพฤติกรรมนี้ยังพุชข้อความเข้าห้องแชตเพ็ทใน TinyConnect ด้วย (p.dm) — ตัดออกตามที่ผู้ใช้ขอ
 * (ผู้ใช้ยังคุยกับเพ็ทเองใน TinyConnect ได้ตามปกติ ผ่าน sendConnectMessage ซึ่งเขียนลง p.dm เหมือนเดิม
 *  ที่ตัดคือฝั่งเพ็ทพูดเองอัตโนมัติ ไม่ใช่ทั้งห้องแชต) */
function petNotifyUser(text) {
    const p = getPet();
    if (!p.exists) return;
    showNotif(petNotifAvatar(), p.name || "เพ็ท", String(text || ""), "pet", "pet");
}
// เช็คสถานะวิกฤต → ให้เพ็ททักเข้ามาเอง (edge-triggered ผ่าน p.notified กันสแปม)
function petCheckCritical(p) {
    const s = p.stats, n = p.notified;
    const fire = (key, cond, msg) => {
        if (cond && !n[key]) { n[key] = true; petNotifyUser(msg); }
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
        <button id="tinyfeed-pet-revive" class="tinyfeed-btn-primary"><i class="fa-solid fa-heart-pulse"></i> ชุบชีวิต${escapeText(p.name || "เพ็ท")}ให้ฟื้น</button>
        <button id="tinyfeed-pet-adopt-new" class="tinyfeed-btn-ghost"><i class="fa-solid fa-seedling"></i> รับเลี้ยงตัวใหม่แทน</button>
    </div>`;
}
let petLastBondLv = null;   // เลเวล bond ครั้งก่อนที่วาด — ใช้เช็คว่าเพิ่งขึ้นเลเวลไหม (ดู renderPet)
function renderPet() {
    const p = petApplyDecay();
    savePet();
    const body = $("#tinyfeed-pet-body");
    if (!body.length) return;
    if (!p.exists) { petLastBondLv = null; body.html(petCreateHtml()); return; }
    if (p.isDead) { petLastBondLv = null; body.html(petDeadHtml()); return; }
    const s = p.stats;
    const st = petState();
    const stageLabel = ({ baby: "เด็ก", teen: "วัยรุ่น", adult: "โตเต็มวัย" })[p.stage] || "เด็ก";
    const bubble = petBubble ? `<div class="tinyfeed-pet-bubble">${renderRich(petBubble)}</div>` : "";
    const sleepLabel = p.isSleeping ? "ปลุก" : "นอน";
    const sleepIcon = p.isSleeping ? "fa-sun" : "fa-moon";
    const bondLv = petBondLevel(p.bond);
    const bondPct = bondLv >= 10 ? 100 : ((Number(p.bond) || 0) % PET_BOND_PER_LEVEL) / PET_BOND_PER_LEVEL * 100;
    const bondTitle = bondLv >= 10 ? "เพื่อนซี้ 💫" : `Lv.${bondLv}`;
    /* บาร์ผูกพันคิดจาก bond % 50 → พอข้ามเลเวลบาร์จะกลับไป 0% ทันที (ถูกต้องทางคณิต แต่ดูเหมือน "ไม่ขึ้นเลย")
     * แจ้งด้วย toast ทุกครั้งที่เลเวลขึ้นจริง กันสับสน — เหมือนที่ evolution มี toast ของตัวเองอยู่แล้ว */
    const bondJustLeveledUp = petLastBondLv !== null && bondLv > petLastBondLv;
    if (bondJustLeveledUp) {
        toastr.success(bondLv >= 10 ? "ผูกพันสูงสุดแล้ว! ตอนนี้เป็นเพื่อนซี้กัน 💫" : `ความผูกพันขึ้นเป็น Lv.${bondLv} แล้ว! 💗`, "TinyPet");
    }
    petLastBondLv = bondLv;
    body.html(`
        <div class="tinyfeed-pet-stage-wrap">
            ${bubble}
            ${petSpriteBoxHtml()}
            <div class="tinyfeed-pet-name">${escapeText(p.name)} <span class="tinyfeed-pet-stagepill">${stageLabel}</span></div>
            <div class="tinyfeed-pet-mood">${escapeText(petMoodText(st))}</div>
            <div class="tinyfeed-pet-bond" title="ผูกพันเพิ่มจากการดูแล + เอ่ยถึงเพ็ทในบทบาท">
                <span class="tinyfeed-pet-bond-label"><i class="fa-solid fa-heart-circle-check${bondJustLeveledUp ? " tinyfeed-pop" : ""}"></i> ความผูกพัน ${bondTitle}</span>
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
            <button id="tinyfeed-pet-share" class="tinyfeed-btn-generate"><i class="fa-solid fa-share-nodes"></i> <span>แชร์สถานะ</span></button>
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
            <div class="tinyfeed-uploadrow">
                <div class="tinyfeed-upload-preview-wrap tinyfeed-gallery-thumb-wrap${map[key] ? "" : " tinyfeed-hidden"}">
                    <img class="tinyfeed-upload-preview tinyfeed-gallery-thumb" src="${escapeAttr(map[key] || "")}" onerror="this.classList.add('tinyfeed-img-broken')" />
                </div>
                <input class="tinyfeed-pet-sprite-url" data-key="${escapeAttr(key)}" type="text" placeholder="ลิงก์รูป (ว่าง = ใช้ไฟล์ในตัว)" value="${escapeAttr(map[key] || "")}" />
                <span class="tinyfeed-upload-btn" data-kind="sprite" title="อัปโหลดรูปจากเครื่อง"><i class="fa-solid fa-upload"></i></span>
            </div>
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
// ===== ฝากโปรไฟล์ไว้กับการ์ด =====
// ส่งออก/นำเข้าเฉพาะ "ตัวละครหลัก + NPC ประจำ" — ไม่แตะ userProfiles/persona เด็ดขาด
// (ไม่งั้นชื่อ/รูปของผู้เขียนจะติดไปกับการ์ดที่แจกต่อ — เหตุผลเดียวกับมาโคร @user)
const CARD_PAYLOAD_V = 1;

function cardSyncStore() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (!extension_settings[extensionName].cardSyncByChar || typeof extension_settings[extensionName].cardSyncByChar !== "object") {
        extension_settings[extensionName].cardSyncByChar = {};
    }
    return extension_settings[extensionName].cardSyncByChar;
}
function cardSyncState() {
    const key = getCharKey();
    if (!key) return {};
    return cardSyncStore()[key] || {};
}
function setCardSyncState(patch) {
    const key = getCharKey();
    if (!key) return;
    const store = cardSyncStore();
    store[key] = Object.assign({}, store[key] || {}, patch);
    saveSettingsDebounced();
}

// เฉพาะฟิลด์ "ของตกแต่งล้วน" (bio/followers/following/posts/highlights) — ไม่รวม avatarUrl/username/alias
// เพราะสองอย่างหลังนี้เป็น field ที่ user ตั้งเองต่อเครื่อง ไม่ใช่ของที่ควรติดไปกับการ์ด
function decorForExport(d) {
    return {
        bio: String(d.bio || ""), followers: normProfileCount(d.followers), following: normProfileCount(d.following),
        posts: normProfilePosts(d.posts), highlights: normProfileHighlights(d.highlights),
    };
}
function buildCardPayload() {
    const npcs = getNpcs().map((n) => ({
        name: String(n.name || ""), avatar: String(n.avatar || ""),
        profile: decorForExport(n.profile || {}),
    }));
    return {
        v: CARD_PAYLOAD_V, app: "tinyphone", exportedAt: Date.now(),
        char: decorForExport(getCharProfile()),
        npcs,
    };
}
// รูปที่ไม่รอดตอนย้ายเครื่อง (ไฟล์ที่อัปโหลดไว้ในเซิร์ฟเวอร์นี้) — เตือนก่อน export เสมอ ไม่เงียบ
function nonPortableUrls(payload) {
    const urls = [];
    const scan = (d) => {
        for (const p of d.posts || []) if (p.url && !isPortableUrl(p.url)) urls.push(p.url);
        for (const h of d.highlights || []) {
            if (h.cover && !isPortableUrl(h.cover)) urls.push(h.cover);
            for (const i of h.items || []) if (i.url && !isPortableUrl(i.url)) urls.push(i.url);
        }
    };
    scan(payload.char);
    for (const n of payload.npcs) scan(n.profile);
    return urls;
}

async function exportProfilesToCard() {
    const ctx = getContext();
    if (!getCurrentCharacter()) { toastr.info("เปิดแชทที่มีตัวละครก่อนนะ", "TinyPhone"); return; }
    if (typeof ctx.writeExtensionField !== "function") {
        toastr.error("เวอร์ชัน SillyTavern นี้ไม่มี writeExtensionField", "TinyPhone");
        return;
    }
    const payload = buildCardPayload();
    const bad = nonPortableUrls(payload);
    if (bad.length && !confirm(`มีรูป ${bad.length} รายการที่เป็นไฟล์ในเครื่องนี้ (จะหายไปถ้าย้ายการ์ดไปเครื่องอื่น) ต้องการฝากลงการ์ดต่อไปไหม?`)) {
        return;
    }
    try {
        await ctx.writeExtensionField(ctx.characterId, "tinyfeed", payload);
        setCardSyncState({ exportedAt: payload.exportedAt, seenAt: payload.exportedAt });
        toastr.success("ฝากโปรไฟล์ไว้กับการ์ดแล้ว", "TinyPhone");
        renderCardSyncStatus();
    } catch (e) {
        console.error(`[${extensionName}] exportProfilesToCard ล้มเหลว:`, e);
        toastr.error("ฝากลงการ์ดไม่สำเร็จ", "TinyPhone");
    }
}

function readCardPayload() {
    const char = getCurrentCharacter();
    if (!char) return null;
    try {
        const ctx = getContext();
        const raw = ctx.characters[ctx.characterId];
        const p = raw && raw.data && raw.data.extensions && raw.data.extensions.tinyfeed;
        return (p && typeof p === "object") ? p : null;
    } catch (e) {
        console.error(`[${extensionName}] readCardPayload ล้มเหลว:`, e);
        return null;
    }
}

function localProfileIsEmpty() {
    if (!profileDecorIsEmpty(getCharProfile())) return false;
    return getNpcs().every((n) => profileDecorIsEmpty(n.profile || {}));
}

// เรียกได้จากปุ่ม (mode "replace"/"fill") — ไม่มีการเขียนทับอัตโนมัติเว้นแต่ผู้ใช้กดเอง หรือ local ว่างเปล่าจริงๆ
function importProfilesFromCard(mode) {
    const payload = readCardPayload();
    if (!payload) { toastr.info("การ์ดใบนี้ไม่มีโปรไฟล์ TinyPhone ติดมา", "TinyPhone"); return; }
    if ((payload.v || 0) > CARD_PAYLOAD_V) {
        toastr.warning("การ์ดนี้มาจาก TinyPhone เวอร์ชันใหม่กว่า — ยังนำเข้าไม่ได้", "TinyPhone");
        return;
    }
    const fill = mode === "fill";
    // ตัวละครหลัก
    const rec = getProfileRecord("char");
    if (rec) mergeDecorInto(rec, payload.char || {}, fill);
    // NPC — จับคู่ด้วยชื่อ (lowercase) ตัวที่ไม่มีในเครื่องนี้จะถูกเพิ่มใหม่ต่อท้าย
    const npcs = getNpcs();
    for (const inNpc of payload.npcs || []) {
        const name = String(inNpc.name || "").trim();
        if (!name) continue;
        let target = npcs.find((n) => String(n.name || "").trim().toLowerCase() === name.toLowerCase());
        if (!target) { target = { name, avatar: String(inNpc.avatar || "") }; npcs.push(target); }
        if (!target.profile || typeof target.profile !== "object") target.profile = {};
        mergeDecorInto(target.profile, inNpc.profile || {}, fill);
    }
    saveNpcs();
    saveSettingsDebounced();
    setCardSyncState({ seenAt: payload.exportedAt, importedAt: Date.now() });
    renderCardSyncStatus();
    if (isProfileOpen()) renderProfileScreen();
    renderNpcList();
    toastr.success(mode === "fill" ? "เติมช่องว่างจากการ์ดแล้ว" : "นำเข้าจากการ์ดแล้ว (ทับของเดิม)", "TinyPhone");
}
// รวมข้อมูลตกแต่งเข้า rec จริงใน store — fill=true เติมเฉพาะช่องว่าง, false=ทับทุกอย่าง
function mergeDecorInto(rec, incoming, fill) {
    const inc = normProfileDecor(incoming);
    if (!fill || !rec.bio) rec.bio = inc.bio;
    if (!fill || !rec.followers) rec.followers = inc.followers;
    if (!fill || !rec.following) rec.following = inc.following;
    if (!fill || !(Array.isArray(rec.posts) && rec.posts.length)) rec.posts = inc.posts;
    if (!fill || !(Array.isArray(rec.highlights) && rec.highlights.length)) rec.highlights = inc.highlights;
}

// แจ้งเตือนแบบไม่เขียนทับอัตโนมัติ — เรียกตอนสลับแชท/โหลดตัวละคร
function maybeNoticeCardPayload() {
    const payload = readCardPayload();
    if (!payload) return;
    if ((payload.v || 0) > CARD_PAYLOAD_V) return;   // เวอร์ชันใหม่กว่า — เงียบไว้ ให้ผู้ใช้เห็นตอนเข้าไปตั้งค่าเอง
    const state = cardSyncState();
    if (state.seenAt === payload.exportedAt) return;   // เคยจัดการรอบนี้แล้ว (idempotent)
    if (localProfileIsEmpty() && getSetting("cardAutoImport")) {
        importProfilesFromCard("replace");
        toastr.info("นำเข้าโปรไฟล์จากการ์ดตัวละครให้อัตโนมัติแล้ว (เครื่องนี้ยังไม่มีโปรไฟล์)", "TinyPhone");
        return;
    }
    // มีของเดิมอยู่แล้ว หรือปิด auto-import — ไม่เขียนอะไรทั้งนั้น รอผู้ใช้กดเอง
    setCardSyncState({ pending: payload.exportedAt });
    renderCardSyncStatus();
}

function renderCardSyncStatus() {
    const box = $("#tinyfeed-card-status");
    if (!box.length) return;
    if (!getCurrentCharacter()) { box.text("เปิดแชทที่มีตัวละครก่อนนะ"); return; }
    const payload = readCardPayload();
    const state = cardSyncState();
    if (!payload) { box.text("การ์ดใบนี้ยังไม่มีโปรไฟล์ TinyPhone ติดอยู่"); return; }
    const when = new Date(payload.exportedAt).toLocaleString("th-TH");
    if (state.pending && state.pending !== state.seenAt) {
        box.html(`<span class="tinyfeed-card-status-alert"><i class="fa-solid fa-circle-exclamation"></i> การ์ดนี้มีโปรไฟล์ติดมา (ฝากไว้เมื่อ ${escapeText(when)}) — ยังไม่ได้นำเข้า</span>`);
    } else {
        box.text(`การ์ดนี้ฝากโปรไฟล์ไว้ล่าสุดเมื่อ ${when}`);
    }
}

function renderNpcList() {
    const rows = getNpcs().map((npc, i) => `
        <div class="tinyfeed-npc-row" data-index="${i}">
            <input class="tinyfeed-npc-name" type="text" placeholder="ชื่อ NPC" value="${escapeAttr(npc.name)}" />
            <div class="tinyfeed-uploadrow">
                <div class="tinyfeed-upload-preview-wrap tinyfeed-gallery-thumb-wrap${npc.avatar ? "" : " tinyfeed-hidden"}">
                    <img class="tinyfeed-upload-preview tinyfeed-gallery-thumb" src="${escapeAttr(npc.avatar)}" onerror="this.classList.add('tinyfeed-img-broken')" />
                </div>
                <input class="tinyfeed-npc-avatar" type="text" placeholder="ลิงก์รูป (optional)" value="${escapeAttr(npc.avatar)}" />
                <span class="tinyfeed-upload-btn" data-kind="avatar" title="อัปโหลดรูปจากเครื่อง"><i class="fa-solid fa-upload"></i></span>
            </div>
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
    updateUploadPreview($("#tinyfeed-cfg-user-avatar"));
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
    updateUploadPreview($("#tinyfeed-cfg-char-avatar"));
}

// สกุลเงิน — ผูกกับตัวละครปัจจุบัน (เหมือนโปรไฟล์ตัวละคร) disable ฟิลด์เมื่อไม่มีการ์ดให้ผูก
function populateCurrencySettings() {
    const char = getCurrentCharacter();
    const cc = getCharCurrency();   // มี fallback ในตัวอยู่แล้วแม้ไม่มีตัวละคร
    const fields = $("#tinyfeed-cfg-bank-currency, #tinyfeed-cfg-bank-currency-pos");
    $("#tinyfeed-cfg-bank-currency").val(cc.symbol);
    $("#tinyfeed-cfg-bank-currency-pos").val(cc.after ? "after" : "before");
    if (char) {
        $("#tinyfeed-cfg-currency-charname").text(getRawCharName());
        fields.prop("disabled", false);
    } else {
        $("#tinyfeed-cfg-currency-charname").text("(ไม่มีตัวละคร — ใช้ค่าเริ่มต้นไปก่อน)");
        fields.prop("disabled", true);
    }
}

// ===== TinyAsk: ถาม-ตอบนิรนาม สไตล์ NGL/ask.fm (ผูกกับแชท) =====
// สองทาง: กล่องของเรา (owner=POSTER_USER, AI ส่งคำถามเข้ามาเอง เราตอบเอง)
//         + กล่องของตัวละคร/NPC (owner=ชื่อ, byUser:true, เราส่งคำถามไป ให้ AI ตอบในบทบาท)
// ทุกคำถามที่ "ตอบแล้ว" ขึ้นฟีดคำตอบสาธารณะร่วมกัน
function askId() { return "ak" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function getAsk() {
    const data = getFeedData();
    if (!Array.isArray(data.ask)) data.ask = [];
    return data.ask;
}
function saveAsk() { saveFeedDataDebounced(); }

let askTab = "inbox";   // "inbox" | "feed"
let isAskBusy = false;

function openAsk() { switchAskTab(askTab); }

function switchAskTab(tab) {
    askTab = tab === "feed" ? "feed" : "inbox";
    $(".tinyfeed-tab[data-asktab]").removeClass("tinyfeed-tab-active");
    $(`.tinyfeed-tab[data-asktab="${askTab}"]`).addClass("tinyfeed-tab-active");
    $("#tinyfeed-ask-inbox").toggleClass("tinyfeed-hidden", askTab !== "inbox");
    $("#tinyfeed-ask-feed").toggleClass("tinyfeed-hidden", askTab !== "feed");
    if (askTab === "inbox") renderAskInbox(); else renderAskFeed();
}

function renderAskInbox() {
    const box = $("#tinyfeed-ask-inbox-list");
    if (!box.length) return;
    const items = getAsk().filter((q) => q.owner === POSTER_USER && !q.answer);
    if (!items.length) {
        box.html(emptyStateHtml("fa-circle-question", "ยังไม่มีคำถามใหม่",
            'กด "ให้คนส่งคำถามเข้ามา" ด้านบน หรือรอทริกเกอร์อัตโนมัติ'));
        return;
    }
    box.html(items.slice().reverse().map((q) => `
        <div class="tinyfeed-ask-card" data-id="${escapeAttr(q.id)}">
            <div class="tinyfeed-ask-q-box">
                ${makeAnonAvatar("?")}
                <div class="tinyfeed-ask-q-text">${renderRich(q.text)}</div>
            </div>
            <textarea class="tinyfeed-ask-answer-input" placeholder="พิมพ์คำตอบ..."></textarea>
            <div class="tinyfeed-ask-actions">
                <span class="tinyfeed-ask-del" data-id="${escapeAttr(q.id)}" title="ทิ้งคำถามนี้"><i class="fa-solid fa-trash"></i></span>
                <button class="tinyfeed-btn-primary tinyfeed-ask-answer-btn" data-id="${escapeAttr(q.id)}">ตอบ</button>
            </div>
        </div>`).join(""));
}

function renderAskFeed() {
    const box = $("#tinyfeed-ask-feed-list");
    if (!box.length) return;
    const items = getAsk().filter((q) => q.answer || q.byUser);
    if (!items.length) {
        box.html(emptyStateHtml("fa-comment-dots", "ยังไม่มีคำถาม-คำตอบ", "ตอบคำถามในกล่องของคุณ หรือกด + เพื่อถามตัวละคร"));
        return;
    }
    box.html(items.slice().reverse().map((q) => {
        const askerLabel = q.anon && !q.revealed ? "ไม่ระบุตัวตน" : escapeText(q.from);
        const revealBtn = (q.anon && !q.revealed && getSetting("askReveal"))
            ? `<span class="tinyfeed-ask-reveal" data-id="${escapeAttr(q.id)}" title="เฉลยคนถาม"><i class="fa-solid fa-eye"></i></span>` : "";
        const ownerLabel = q.owner === POSTER_USER ? "" : `<span class="tinyfeed-ask-owner">ถึง ${escapeText(q.owner)}</span>`;
        const answerBlock = q.answer
            ? `<div class="tinyfeed-ask-a-box">${makeAvatar({ author: q.owner, isUser: q.owner === POSTER_USER })}<div class="tinyfeed-ask-a-text">${renderRich(q.answer)}</div></div>`
            : `<div class="tinyfeed-ask-pending"><span class="tinyfeed-ai-link tinyfeed-ask-getanswer" data-id="${escapeAttr(q.id)}"><i class="fa-solid fa-wand-magic-sparkles"></i> ให้ ${escapeText(q.owner)} ตอบ</span></div>`;
        return `
        <div class="tinyfeed-ask-card" data-id="${escapeAttr(q.id)}">
            <div class="tinyfeed-ask-q-box">
                ${makeAnonAvatar(askerLabel)}
                <div class="tinyfeed-ask-q-meta">
                    <span class="tinyfeed-ask-asker">${askerLabel}</span>${revealBtn}${ownerLabel}
                </div>
                <div class="tinyfeed-ask-q-text">${renderRich(q.text)}</div>
            </div>
            ${answerBlock}
            <div class="tinyfeed-ask-actions">
                <span class="tinyfeed-ask-like${q.liked ? " tinyfeed-liked" : ""}" data-id="${escapeAttr(q.id)}"><i class="fa-solid fa-heart"></i> ${formatCount(q.likes || 0)}</span>
                <span class="tinyfeed-ask-del" data-id="${escapeAttr(q.id)}" title="ลบ"><i class="fa-solid fa-trash"></i></span>
            </div>
        </div>`;
    }).join(""));
}

function answerAskQuestion(id, text) {
    const q = getAsk().find((x) => x.id === id);
    if (!q) return;
    const answer = String(text || "").trim();
    if (!answer) { toastr.info("พิมพ์คำตอบก่อนนะ", "TinyAsk"); return; }
    q.answer = escapeHtml(answer);
    q.answerTs = Date.now();
    saveAsk();
    renderAskInbox();
    updateChatInjection();
    toastr.success("ตอบคำถามแล้ว", "TinyAsk");
}

function deleteAskQuestion(id) {
    const arr = getAsk();
    const i = arr.findIndex((x) => x.id === id);
    if (i < 0) return;
    arr.splice(i, 1);
    saveAsk();
    if (askTab === "inbox") renderAskInbox(); else renderAskFeed();
}

function revealAskAsker(id) {
    const q = getAsk().find((x) => x.id === id);
    if (!q) return;
    q.revealed = true;
    saveAsk();
    renderAskFeed();
}

function toggleAskLike(id) {
    const q = getAsk().find((x) => x.id === id);
    if (!q) return;
    q.liked = !q.liked;
    q.likes = Math.max(0, (q.likes || 0) + (q.liked ? 1 : -1));
    saveAsk();
    renderAskFeed();
}

// ===== ส่งคำถามนิรนามไปหาตัวละคร/NPC (modal +) =====
let askSendTarget = null;
function openAskSendModal() {
    openCharPicker({ title: "ส่งคำถามถึงใคร", includeUser: false, includeMain: true, includeAuto: false }, (value) => {
        askSendTarget = value;
        $("#tinyfeed-ask-send-to").text(value);
        $("#tinyfeed-ask-send-text").val("");
        $("#tinyfeed-ask-send-anon").prop("checked", true);
        $("#tinyfeed-ask-send-modal").removeClass("tinyfeed-hidden");
    });
}
function closeAskSendModal() { $("#tinyfeed-ask-send-modal").addClass("tinyfeed-hidden"); askSendTarget = null; }
function sendAskQuestion() {
    const text = String($("#tinyfeed-ask-send-text").val() || "").trim();
    if (!askSendTarget) { closeAskSendModal(); return; }
    if (!text) { toastr.info("พิมพ์คำถามก่อนนะ", "TinyAsk"); return; }
    const anon = $("#tinyfeed-ask-send-anon").prop("checked");
    getAsk().push({
        id: askId(), owner: askSendTarget, from: getUserName(), anon, revealed: false, byUser: true,
        text: escapeHtml(text), answer: "", ts: Date.now(), answerTs: 0, likes: randomInitialLikes(), liked: false,
    });
    saveAsk();
    closeAskSendModal();
    switchAskTab("feed");
    toastr.success("ส่งคำถามแล้ว", "TinyAsk");
}

// ===== AI: ให้คนส่งคำถามนิรนามเข้ากล่องของเรา (auto ทุก N ข้อความ / AI ตัดสินใจ / คีย์เวิร์ด) =====
function parseAskQuestions(raw) {
    const s = stripReasoning(raw);
    const out = [];
    for (const line of s.split("\n")) {
        const m = line.trim().match(/^ASK:\s*(.+)$/i);
        if (!m) continue;
        const parts = m[1].split("|");
        if (parts.length < 2) continue;
        const from = cleanAiName(parts[0]);
        const text = parts.slice(1).join("|").trim();
        if (from && text) out.push({ from, text });
    }
    return out;
}

async function generateAskQuestions(opts) {
    opts = opts || {};
    if (isAskBusy) return;
    const ctx = getContext();
    if (typeof ctx.generateQuietPrompt !== "function") {
        if (!opts.silent) toastr.error("เวอร์ชัน SillyTavern นี้ไม่มี generateQuietPrompt", "TinyAsk");
        return;
    }
    const char = getCurrentCharacter();
    if (!char) { if (!opts.silent) toastr.info("เปิดแชทที่มีตัวละครก่อนนะ", "TinyAsk"); return; }
    const charName = getCharName();
    isAskBusy = true;
    const btn = $("#tinyfeed-ask-generate");
    btn.addClass("tinyfeed-generating").prop("disabled", true);
    try {
        const extra = String(getSetting("askExtraPrompt") || "").trim();
        const q = buildPrompt("askInbox", {
            roster: npcRosterLine(charName),
            count: "ขอ 2-4 คำถาม ",
            extra: extra ? `คำสั่งเพิ่มเติม: ${extra}. ` : "",
            context: crossAppContext("ask"),
        });
        const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("askTokens"), 10) || 200), "ask");
        const items = parseAskQuestions(raw);
        if (!items.length) { if (!opts.silent) toastr.warning("AI ไม่ได้ส่งคำถามกลับมา ลองใหม่นะ", "TinyAsk"); return; }
        for (const it of items) {
            getAsk().push({
                id: askId(), owner: POSTER_USER, from: it.from, anon: true, revealed: false, byUser: false,
                text: escapeHtml(it.text), answer: "", ts: Date.now(), answerTs: 0, likes: 0, liked: false,
            });
        }
        saveAsk();
        if (currentApp === "ask" && askTab === "inbox") renderAskInbox();
        updateChatInjection();
        if (opts.notify) showNotif(makeAnonAvatar("?"), "ไม่ระบุตัวตน", htmlToPlain(items[0].text), "inbox", "ask");
        if (!opts.silent) toastr.success(`มีคำถามใหม่ ${items.length} ข้อ`, "TinyAsk");
    } catch (e) {
        console.error(`[${extensionName}] generateAskQuestions failed:`, e);
        if (!opts.silent) toastr.error("สร้างคำถามไม่สำเร็จ ลองใหม่นะ", "TinyAsk");
    } finally {
        isAskBusy = false;
        btn.removeClass("tinyfeed-generating").prop("disabled", false);
    }
}

// ให้ตัวละคร/NPC เจ้าของกล่องตอบคำถามที่เราส่งไป
async function generateAskAnswer(id) {
    if (isAskBusy) return;
    const q = getAsk().find((x) => x.id === id);
    if (!q) return;
    const ctx = getContext();
    if (typeof ctx.generateQuietPrompt !== "function") {
        toastr.error("เวอร์ชัน SillyTavern นี้ไม่มี generateQuietPrompt", "TinyAsk");
        return;
    }
    const charName = getCharName();
    isAskBusy = true;
    const $btn = $(`.tinyfeed-ask-getanswer[data-id="${id}"]`);
    $btn.addClass("tinyfeed-generating");
    try {
        const extra = String(getSetting("askExtraPrompt") || "").trim();
        const prompt = buildPrompt("askAnswer", {
            owner: q.owner, question: htmlToPlain(q.text),
            roster: npcRosterLine(charName),
            extra: extra ? ` คำสั่งเพิ่มเติม: ${extra}.` : "",
            context: crossAppContext("ask"),
        });
        const raw = await tinyGenerate(prompt, Math.max(1, parseInt(getSetting("askTokens"), 10) || 200), "ask");
        const s = stripReasoning(raw);
        const m = s.match(/ANSWER:\s*([\s\S]+)/i);
        const answer = m ? m[1].trim() : s.trim();
        if (!answer) { toastr.warning("AI ไม่ได้ตอบกลับมา ลองใหม่นะ", "TinyAsk"); return; }
        q.answer = escapeHtml(answer);
        q.answerTs = Date.now();
        saveAsk();
        renderAskFeed();
        updateChatInjection();
    } catch (e) {
        console.error(`[${extensionName}] generateAskAnswer failed:`, e);
        toastr.error("ตอบคำถามไม่สำเร็จ ลองใหม่นะ", "TinyAsk");
    } finally {
        isAskBusy = false;
        $btn.removeClass("tinyfeed-generating");
    }
}

// ===== สุ่มคำถาม-คำตอบทั้งคู่ให้ตัวละคร/NPC ในครั้งเดียว (ปุ่ม 🎲 ในฟีดคำตอบ) =====
function openAskPairPicker() {
    openCharPicker({ title: "สุ่มคำถาม-คำตอบให้ใคร", includeUser: false, includeMain: true, includeAuto: false }, (value) => {
        generateAskPair(value);
    });
}
async function generateAskPair(owner) {
    if (isAskBusy) return;
    const ctx = getContext();
    if (typeof ctx.generateQuietPrompt !== "function") {
        toastr.error("เวอร์ชัน SillyTavern นี้ไม่มี generateQuietPrompt", "TinyAsk");
        return;
    }
    const charName = getCharName();
    isAskBusy = true;
    const $btn = $("#tinyfeed-ask-pair-roll");
    $btn.addClass("tinyfeed-generating").prop("disabled", true);
    try {
        const extra = String(getSetting("askExtraPrompt") || "").trim();
        const q = buildPrompt("askPair", {
            owner,
            roster: npcRosterLine(charName),
            extra: extra ? `คำสั่งเพิ่มเติม: ${extra}. ` : "",
            context: crossAppContext("ask"),
        });
        const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("askTokens"), 10) || 200) * 2, "ask");
        const s = stripReasoning(raw);
        const askMatch = s.match(/ASK:\s*(.+)/i);
        const answerMatch = s.match(/ANSWER:\s*([\s\S]+)/i);
        if (!askMatch || !answerMatch) { toastr.warning("AI ไม่ได้ตอบครบ ลองใหม่นะ", "TinyAsk"); return; }
        const parts = askMatch[1].split("|");
        const from = parts.length >= 2 ? cleanAiName(parts[0]) : "";
        const text = (parts.length >= 2 ? parts.slice(1).join("|") : askMatch[1]).trim();
        const answer = answerMatch[1].trim();
        if (!text || !answer) { toastr.warning("AI ไม่ได้ตอบครบ ลองใหม่นะ", "TinyAsk"); return; }
        getAsk().push({
            id: askId(), owner, from: from || "ไม่ระบุตัวตน", anon: true, revealed: false, byUser: false,
            text: escapeHtml(text), answer: escapeHtml(answer), ts: Date.now(), answerTs: Date.now(),
            likes: randomInitialLikes(), liked: false,
        });
        saveAsk();
        if (currentApp === "ask" && askTab === "feed") renderAskFeed();
        updateChatInjection();
        toastr.success("สุ่มคำถาม-คำตอบแล้ว", "TinyAsk");
    } catch (e) {
        console.error(`[${extensionName}] generateAskPair failed:`, e);
        toastr.error("สุ่มคำถาม-คำตอบไม่สำเร็จ ลองใหม่นะ", "TinyAsk");
    } finally {
        isAskBusy = false;
        $btn.removeClass("tinyfeed-generating").prop("disabled", false);
    }
}

// ===== ให้ AI ช่วยร่างคำถามลงช่องพิมพ์ (ปุ่ม 🎲 ใน modal ส่งคำถาม) — แก้ก่อนส่งได้ =====
async function generateAskDraft() {
    if (isAskBusy || !askSendTarget) return;
    const ctx = getContext();
    if (typeof ctx.generateQuietPrompt !== "function") {
        toastr.error("เวอร์ชัน SillyTavern นี้ไม่มี generateQuietPrompt", "TinyAsk");
        return;
    }
    const owner = askSendTarget;
    const charName = getCharName();
    isAskBusy = true;
    const $btn = $("#tinyfeed-ask-draft-roll");
    $btn.addClass("tinyfeed-generating");
    try {
        const extra = String(getSetting("askExtraPrompt") || "").trim();
        const q = buildPrompt("askDraft", {
            owner,
            roster: npcRosterLine(charName),
            extra: extra ? `คำสั่งเพิ่มเติม: ${extra}. ` : "",
            context: crossAppContext("ask"),
        });
        const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("askTokens"), 10) || 200), "ask");
        const s = stripReasoning(raw);
        const m = s.match(/ASK:\s*(.+)/i);
        const text = (m ? m[1] : s).trim();
        if (!text) { toastr.warning("AI ไม่ได้ส่งคำถามกลับมา ลองใหม่นะ", "TinyAsk"); return; }
        $("#tinyfeed-ask-send-text").val(text);
    } catch (e) {
        console.error(`[${extensionName}] generateAskDraft failed:`, e);
        toastr.error("ร่างคำถามไม่สำเร็จ ลองใหม่นะ", "TinyAsk");
    } finally {
        isAskBusy = false;
        $btn.removeClass("tinyfeed-generating");
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
// ── ส่วนตกแต่งโปรไฟล์ (ไบโอ · โพสต์นิ่ง · ไฮไลต์) — ใช้ร่วมทั้ง persona / ตัวละคร / NPC ──
// รูปในโพสต์นิ่งกับไฮไลต์ตั้งใจให้เป็น "ลิงก์ภายนอก (http/https)" เท่านั้น เพื่อให้ติดไปกับการ์ดตัวละครได้จริง
// (ไฟล์ที่อัปโหลดอยู่ใต้ user/images/ ของเครื่องนี้ เครื่องปลายทางเปิดไม่ได้) — ต่างจากสตอรี่/โพสต์ในฟีดที่ใช้ TinyGallery ตามปกติ
// ข้อความทุกช่องเก็บเป็น raw (ยังไม่ escape) เพราะต้องคงตัวอักษร "@user" ไว้ตอนส่งออก → ตอนแสดงต้อง renderRich(escapeHtml(x))
function profileItemId(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function normProfileCount(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}
function normProfilePosts(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => ({
        id: x && x.id ? String(x.id) : profileItemId("pp"),
        url: x && x.url ? String(x.url) : "",
        caption: x && x.caption != null ? String(x.caption) : "",
        likes: normProfileCount(x && x.likes),
        comments: Array.isArray(x && x.comments)
            ? x.comments.map((c) => ({ author: String((c && c.author) || ""), text: String((c && c.text) || "") }))
            : [],
        ts: Number(x && x.ts) || 0,
    })).filter((x) => x.url);
}
function normProfileHighlights(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map((h) => ({
        id: h && h.id ? String(h.id) : profileItemId("ph"),
        title: h && h.title != null ? String(h.title) : "",
        cover: h && h.cover ? String(h.cover) : "",
        items: Array.isArray(h && h.items)
            ? h.items.map((i) => ({ url: String((i && i.url) || ""), caption: String((i && i.caption) || "") })).filter((i) => i.url)
            : [],
    }));
}
// ส่วนตกแต่งล้วน (ไม่มี avatarUrl/username/alias) — NPC ใช้ตัวนี้ตัวเดียว
function normProfileDecor(p) {
    p = p || {};
    return {
        bio: p.bio != null ? String(p.bio) : "",
        followers: normProfileCount(p.followers),
        following: normProfileCount(p.following),
        posts: normProfilePosts(p.posts),
        highlights: normProfileHighlights(p.highlights),
    };
}
function profileDecorIsEmpty(d) {
    d = normProfileDecor(d);
    return !d.bio && !d.posts.length && !d.highlights.length && !d.followers && !d.following;
}
function normProfile(p) {
    p = p || {};
    return Object.assign({
        avatarUrl: p.avatarUrl != null ? String(p.avatarUrl) : "",
        username: p.username ? String(p.username) : "",
        alias: p.alias ? String(p.alias) : "",
        primary: p.primary === "alias" ? "alias" : "username",
    }, normProfileDecor(p));
}
function getUserProfile() { return normProfile(getProfileStore("user")[getPersonaKey()]); }
function getCharProfile() { return normProfile(getProfileStore("char")[getCharKey()]); }
// ★ ของจริงใน store (lazy-create + type-guard ที่ตัวมันเอง) — ใช้เมื่อต้อง "แก้" array ของโปรไฟล์
// getUserProfile()/getCharProfile() คืน copy จาก normProfile() เขียน array กลับไม่ติด
function getProfileRecord(kind) {
    const key = kind === "char" ? getCharKey() : getPersonaKey();
    if (!key) return null;
    const store = getProfileStore(kind);
    const cur = store[key] || {};
    if (typeof cur.bio !== "string") cur.bio = "";
    if (!Array.isArray(cur.posts)) cur.posts = [];
    if (!Array.isArray(cur.highlights)) cur.highlights = [];
    cur.followers = normProfileCount(cur.followers);
    cur.following = normProfileCount(cur.following);
    store[key] = cur;
    return cur;
}
// โปรไฟล์ NPC ฝังในรายการ NPC เดิม (object เดียวกับ {name, avatar}) — เปลี่ยนชื่อ NPC แล้วโปรไฟล์ตามไปเอง
function getNpcRecord(name) {
    const k = String(name || "").trim().toLowerCase();
    if (!k) return null;
    return getNpcs().find((n) => String(n.name || "").trim().toLowerCase() === k) || null;
}
function getNpcProfileRecord(name) {
    const npc = getNpcRecord(name);
    if (!npc) return null;
    if (!npc.profile || typeof npc.profile !== "object") npc.profile = {};
    const p = npc.profile;
    if (typeof p.bio !== "string") p.bio = "";
    if (!Array.isArray(p.posts)) p.posts = [];
    if (!Array.isArray(p.highlights)) p.highlights = [];
    p.followers = normProfileCount(p.followers);
    p.following = normProfileCount(p.following);
    return p;
}
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

// ล้างข้อมูล global เก่าที่ค้างจากตอนก่อนย้าย scope (ครั้งเดียว ตามที่ผู้ใช้ขอ 2026-08)
// shop เดิมเคยเป็น global (ย้ายมา per-chat), bankCurrency/-After เดิมเคยเป็นค่าเดียวใช้ทุกการ์ด (ย้ายมาผูกการ์ด)
// ทั้งสองยังเก็บไว้เป็น fallback/seed มาก่อน — รอบนี้ล้างทิ้งจริงตามคำขอ ไม่ใช่แค่เลิกใช้เฉยๆ
function cleanupLegacyGlobalScope() {
    const s = extension_settings[extensionName];
    if (s.legacyGlobalCleaned) return;
    s.shop = [];
    s.bankCurrency = defaultSettings.bankCurrency;
    s.bankCurrencyAfter = defaultSettings.bankCurrencyAfter;
    s.legacyGlobalCleaned = true;
    saveSettingsDebounced();
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

// หา URL รูปของ item เปล่าๆ (ไม่ห่อ <img>) — makeAvatar() และหน้าจอโทร (พื้นหลังเต็มจอ) ใช้ร่วมกัน
// ห้ามก๊อปโซ่นี้ไปเขียนซ้ำที่อื่น (กฎเหล็กข้อ 1) — resolve แบบ live เพื่อให้ override จาก config มีผลทันที
function contactAvatarUrl(item) {
    if (item.avatar) return item.avatar;
    if (item.isMain) return getCharacterAvatar();
    if (item.isUser) return getUserAvatar();
    // ชื่อที่ตรงกับ username/alias ของเรา/ตัวละครหลัก → แทนที่ด้วยรูปโปรไฟล์นั้น
    if (nameMatchesUser(item.author)) return getUserAvatar();
    if (nameMatchesChar(item.author)) return getCharacterAvatar();
    return getNpcAvatar(item.author);   // NPC ที่อยู่ในรายชื่อประจำ + มีลิงก์รูป
}

// เหมือน contactAvatarUrl() แต่คืนรูปความละเอียดเต็ม ไม่ใช่ thumbnail — ใช้เฉพาะจุดที่รูปถูกขยายใหญ่มาก
// (พื้นหลัง/วงกลมโปรไฟล์เต็มจอของหน้าโทร) thumbnail ของ ST ตั้งต้นแค่ 96×144px ขยายเต็มจอแล้วแตกให้เห็นชัด
// ไม่รวมเข้ากับ contactAvatarUrl() เพราะ endpoint ที่ใช้เปลี่ยนไปคนละตัว ไม่ใช่แค่พารามิเตอร์ต่าง
function contactAvatarUrlHiRes(item) {
    if (item.avatar) return item.avatar;   // ลิงก์ภายนอก/override อยู่แล้ว = ความละเอียดเต็มอยู่แล้ว ไม่ผ่าน thumbnail
    if (item.isMain) {
        const override = getCharProfile().avatarUrl;
        if (override) return override;
        const char = getCurrentCharacter();
        // ต้องมี "/" นำหน้าเสมอ (root-relative) — ใช้เป็น CSS background-image ด้วย ซึ่ง resolve เทียบตำแหน่งไฟล์ style.css
        // เอง ไม่ใช่เทียบหน้าเว็บแบบ <img src> เพราะงั้น path แบบไม่มี "/" นำหน้าจะ 404 (พลาดมาแล้วรอบแรก)
        return char && char.file && char.file !== "none" ? `/characters/${encodeURIComponent(char.file)}` : "";
    }
    if (item.isUser) {
        const override = getUserProfile().avatarUrl;
        if (override) return override;
        try {
            const ctx = getContext();
            const file = ctx.user_avatar || (stScriptModule && stScriptModule.user_avatar);
            if (file && file !== "none") return `/User Avatars/${encodeURIComponent(file)}`;
        } catch (e) { /* เงียบไว้ แล้ว fallback ข้างล่าง */ }
        return "";
    }
    if (nameMatchesUser(item.author)) return contactAvatarUrlHiRes({ isUser: true });
    if (nameMatchesChar(item.author)) return contactAvatarUrlHiRes({ isMain: true });
    return getNpcAvatar(item.author);   // NPC ใช้ลิงก์ที่ผู้ใช้ตั้งเอง ไม่ผ่าน thumbnail อยู่แล้ว
}

function makeAvatar(item) {
    const src = contactAvatarUrl(item);
    if (src) {
        const safeAuthor = String(item.author || "?").replace(/"/g, "");
        return `<img class="tinyfeed-avatar" src="${src}" data-author="${safeAuthor}"
        onerror="window.tinyfeedAvatarError && window.tinyfeedAvatarError(this)" />`;
    }
    return makeAnonAvatar(item.author);
}

// avatar ที่แตะแล้วเปิดหน้าโปรไฟล์ — ใช้เฉพาะจุดที่ "คนในภาพ" มีโปรไฟล์ให้ดู (ฟีด · คอมเมนต์ · แถบสตอรี่)
// ที่อื่น (แถบพิมพ์ · หน้าจอโทร · การ์ดของขวัญ) ใช้ makeAvatar() ธรรมดาเหมือนเดิม
function makeAvatarLink(item) {
    const html = makeAvatar(item).replace('class="', 'class="tinyfeed-profile-open ');
    if (html.includes("data-author=")) return html;
    return html.replace(/^(\s*<\w+)/, `$1 data-author="${escapeAttr(String((item && item.author) || ""))}"`);
}

// คอมเมนต์: limit = จำนวนที่โชว์ (undefined = โชว์หมด) · postId = ใส่ปุ่มลบ (slice จาก 0 → index ตรงกับ array จริง)
function renderComments(comments, limit, postId) {
    if (!comments || comments.length === 0) return "";
    const list = limit ? comments.slice(0, limit) : comments;
    const rows = list.map((c, i) => `
        <div class="tinyfeed-comment">
            ${makeAvatarLink(c)}
            <div class="tinyfeed-comment-body">
                <span class="tinyfeed-comment-author tinyfeed-profile-open" data-author="${escapeAttr(c.author)}">${c.author}</span>
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
                .map((m) => `  ${m.from === "user" ? getUserName() : c.name}: ${connectMsgText(m)}`);
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
        // แค่ "ร้านมีอะไรขาย" — ของที่ซื้อไว้แล้วย้ายไปอยู่ที่ want.bag แทน (แยกกันชัดเจนขึ้น)
        const catalog = getShop().slice(0, count)
            .map((it) => `- ${htmlToPlain(it.name)} — ${formatMoney(it.price)}${it.cat ? ` [${htmlToPlain(it.cat)}]` : ""}${it.desc ? ` (${htmlToPlain(it.desc)})` : ""}`);
        if (catalog.length) blocks.push(`ร้านค้าในแอป TinyShop มีขาย:\n${catalog.join("\n")}`);
    }
    if (want.bag) {
        const items = getBag().filter((x) => (x.qty || 0) > 0).slice(0, count)
            .map((x) => `- ${htmlToPlain(x.name)}${x.qty > 1 ? ` ×${x.qty}` : ""}${x.desc ? ` (${htmlToPlain(x.desc)})` : ""}`);
        if (items.length) blocks.push(`ของที่มีอยู่ในกระเป๋าแอป TinyBag:\n${items.join("\n")}`);
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
    if (want.ask) {
        const answered = getAsk().filter((q) => q.answer).slice(0, count).map((q) =>
            `- ${q.anon ? "มีคนถามนิรนาม" : `${q.from}ถาม`}${q.owner === POSTER_USER ? "" : ` (ถึง ${q.owner})`}: "${htmlToPlain(q.text)}" → ตอบว่า: "${htmlToPlain(q.answer)}"`);
        if (answered.length) blocks.push(`คำถาม-คำตอบล่าสุดในแอป TinyAsk:\n${answered.join("\n")}`);
    }
    if (want.story) {
        const act = activeStories().slice(-count).reverse().map((st) => {
            const overlay = (st.texts || []).map((t) => htmlToPlain(t.text)).filter(Boolean).join(" / ");
            const rep = (st.replies || []).slice(-2).map((r) => `    ตอบกลับ: ${r.author}: ${htmlToPlain(r.text)}`).join("\n");
            return `- ${st.author}: [รูป ${st.imgName || "ไม่ระบุ"}]${overlay ? ` "${overlay}"` : ""}${st.caption ? ` — ${htmlToPlain(st.caption)}` : ""}${rep ? "\n" + rep : ""}`;
        });
        if (act.length) blocks.push(`สตอรี่ 24 ชม. ในแอป TinyFeed:\n${act.join("\n")}`);
        const notes = getNoteBubbles();
        const noteRows = Object.keys(notes).map((k) => `- ${ownerDisplay(k).name}: ${htmlToPlain(notes[k].text)}`);
        if (noteRows.length) blocks.push(`โน้ตบนแถบสตอรี่ (เหมือนโน้ตของ Instagram):\n${noteRows.join("\n")}`);
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
        renderStoryBar();
        renderComposeAvatar();
        updateChatInjection();
        return;
    }
    const html = data.feed.map((post) => `
        <div class="tinyfeed-post" data-post="${post.id}">
            ${post.repostOf ? `<div class="tinyfeed-repost-tag"><i class="fa-solid fa-retweet"></i> ${escapeText(post.author)} รีโพสต์</div>` : ""}
            <div class="tinyfeed-post-head">
                ${makeAvatarLink(post)}
                <div class="tinyfeed-post-meta">
                    <span class="tinyfeed-post-author tinyfeed-profile-open" data-author="${escapeAttr(post.author)}">${post.author}</span>
                    <span class="tinyfeed-post-time">${displayTime(post)}</span>
                </div>
                ${(post.isUser || post.isAI) ? `<span class="tinyfeed-delete" data-post="${post.id}" title="ลบโพสต์"><i class="fa-solid fa-trash"></i></span>` : ""}
            </div>
            <div class="tinyfeed-post-body">${renderPostBody(post.text)}</div>
            ${(post.quoteOf || post.repostOf) ? embeddedPostHtml(post.quoteOf || post.repostOf) : ""}
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
                <button class="tinyfeed-ai-link tinyfeed-gen-comments" data-post="${post.id}">
                    <i class="fa-solid fa-comment-medical"></i>
                    <span>ให้ NPC คอมเมนต์</span>
                </button>
            </div>` : ""}
        </div>
    `).join("");
    $("#tinyfeed-feed-list").html(html);
    renderStoryBar();
    renderComposeAvatar();
    updateChatInjection();
}

// ===== TinyFeed: สตอรี่ 24 ชม. + โน้ตบนแถบสตอรี่ (เลียนแบบ Instagram) =====
// เก็บที่ chat_metadata (เนื้อหาที่เกิดจากเรื่องในแชทนี้ ลบแชท = ควรหาย) เหมือน feed/news
// รูปสตอรี่ใช้ TinyGallery ตามปกติ — ต่างจากรูปในหน้าโปรไฟล์ที่ตั้งใจให้เป็นลิงก์ภายนอกเพื่อ export
// ข้อความทุกช่องเก็บเป็น raw (คง "@user" ไว้) → แสดงด้วย renderRich(escapeHtml(x)) เสมอ
function getStories() {
    const data = getFeedData();
    if (!Array.isArray(data.stories)) data.stories = [];
    // type-guard ทีละชิ้น (แชทเก่า/ข้อมูลเพี้ยนต้องไม่ทำให้แถบสตอรี่พัง)
    data.stories = data.stories.filter((s) => s && typeof s === "object").map((s) => {
        if (!Array.isArray(s.texts)) s.texts = [];
        if (!Array.isArray(s.replies)) s.replies = [];
        if (!s.id) s.id = storyNewId();
        return s;
    });
    const max = Math.max(10, parseInt(getSetting("storyArchiveMax"), 10) || 60);
    if (data.stories.length > max) data.stories = data.stories.slice(-max);   // เก่าสุดอยู่ต้น array
    return data.stories;
}
function saveStories() { saveFeedDataDebounced(); }
function storyNewId() { return "st" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
function storyTtlMs() { return Math.max(1, parseInt(getSetting("storyTtlHours"), 10) || 24) * 3600000; }
function isStoryActive(s) { return Date.now() - (Number(s && s.ts) || 0) < storyTtlMs(); }
function activeStories() { return getStories().filter(isStoryActive); }
function expiredStories() { return getStories().filter((s) => !isStoryActive(s)).slice().reverse(); }
function findStory(id) { return getStories().find((s) => s.id === id) || null; }
// ชื่อรูปในคลังคือแหล่งหลัก (แก้รูปในคลังแล้วสตอรี่ตามทันที) · imgUrl เป็น snapshot กันรูปถูกลบ
function storyImgUrl(s) {
    const g = findGalleryImage(s && s.imgName);
    return (g && g.url) || (s && s.imgUrl) || "";
}

// ownerKey ใช้ชุดเดียวกับ getConnectContacts().key เพื่อให้ deep-link เข้าห้องแชตได้ทันที
// "user" = persona (ไม่มีห้องแชตของตัวเอง) · "main" · "npc:<ชื่อ>" · "pet"
function ownerKeyForName(name) {
    const n = String(name || "").trim();
    if (!n) return "";
    if (nameMatchesUser(n)) return "user";
    if (nameMatchesChar(n)) return "main";
    const npc = getNpcRecord(n);
    return npc ? "npc:" + npc.name : "";
}
function ownerDisplay(key) {
    if (key === "user") return { key, name: getUserName(), avatarItem: { isUser: true, author: getUserName() } };
    const c = getConnectContacts().find((x) => x.key === key);
    if (c) return { key, name: c.name, avatarItem: contactAvatarItem(c) };
    const raw = key.startsWith("npc:") ? key.slice(4) : key;
    return { key, name: raw, avatarItem: { author: raw } };
}
// ★ แหล่งเดียวของทั้งแถบสตอรี่ · โน้ต · viewer — ห้ามไล่ getNpcs()/getConnectContacts() ซ้ำที่อื่น
function storyOwners() {
    const act = activeStories();
    const notes = getNoteBubbles();
    const keys = ["user"];
    for (const c of getConnectContacts()) if (!keys.includes(c.key)) keys.push(c.key);
    // เจ้าของที่ไม่อยู่ในรายชื่อแล้ว (NPC ถูกลบ) แต่ยังมีสตอรี่ค้าง — ไม่ให้สตอรี่หายไปเงียบๆ
    for (const s of act) if (s.ownerKey && !keys.includes(s.ownerKey)) keys.push(s.ownerKey);
    return keys.map((k) => {
        const d = ownerDisplay(k);
        const stories = act.filter((s) => s.ownerKey === k);
        return { ...d, stories, unseen: stories.some((s) => !s.seen), note: notes[k] || null };
    }).filter((o) => o.key === "user" || o.stories.length || o.note);
}

// ── แถบสตอรี่บนหัวไทม์ไลน์ ──
function renderStoryBar() {
    const bar = $("#tinyfeed-story-bar");
    if (!bar.length) return;
    if (!getSetting("storyEnabled")) { bar.addClass("tinyfeed-hidden").empty(); return; }
    const owners = storyOwners();
    const archiveCount = expiredStories().length;
    const noteOn = Boolean(getSetting("noteEnabled"));
    const html = owners.map((o) => {
        const isMe = o.key === "user";
        const ring = o.stories.length ? (o.unseen ? "tinyfeed-story-ring-unseen" : "tinyfeed-story-ring-seen") : "";
        const noteHtml = (noteOn && o.note)
            ? `<div class="tinyfeed-storynote-bubble" data-owner="${escapeAttr(o.key)}" title="โน้ต">${escapeText(String(o.note.text || "").slice(0, 40))}</div>`
            : (noteOn && isMe ? `<div class="tinyfeed-storynote-bubble tinyfeed-storynote-empty" data-owner="user" title="เขียนโน้ต">เขียนโน้ต…</div>` : "");
        return `
        <div class="tinyfeed-story-item" data-owner="${escapeAttr(o.key)}">
            ${noteHtml}
            <div class="tinyfeed-story-ava ${ring}" data-owner="${escapeAttr(o.key)}">
                ${makeAvatar(o.avatarItem)}
                ${isMe ? `<span class="tinyfeed-story-add"><i class="fa-solid fa-plus"></i></span>` : ""}
            </div>
            <span class="tinyfeed-story-name">${escapeText(isMe ? "สตอรี่ของคุณ" : o.name)}</span>
        </div>`;
    }).join("");
    const genChip = `
        <div class="tinyfeed-story-item tinyfeed-story-genchip" title="ให้ตัวละครลงสตอรี่">
            <div class="tinyfeed-story-ava tinyfeed-story-ring-seen"><div class="tinyfeed-avatar tinyfeed-story-archive-ico"><i class="fa-solid fa-wand-magic-sparkles"></i></div></div>
            <span class="tinyfeed-story-name">ให้ AI ลง</span>
        </div>`;
    const archiveChip = archiveCount
        ? `<div class="tinyfeed-story-item tinyfeed-story-archive-chip" title="คลังสตอรี่">
               <div class="tinyfeed-story-ava tinyfeed-story-ring-seen"><div class="tinyfeed-avatar tinyfeed-story-archive-ico"><i class="fa-solid fa-clock-rotate-left"></i></div></div>
               <span class="tinyfeed-story-name">คลัง (${archiveCount})</span>
           </div>`
        : "";
    bar.removeClass("tinyfeed-hidden").html(html + genChip + archiveChip);
}

// ── หน้าดูสตอรี่ ──
let storyViewCtx = null;   // { ownerKey, ids: [], idx, archive }

function openStoryViewer(ownerKey, idx, opts) {
    const archive = Boolean(opts && opts.archive);
    const list = archive
        ? expiredStories().filter((s) => !ownerKey || s.ownerKey === ownerKey)
        : activeStories().filter((s) => s.ownerKey === ownerKey);
    if (!list.length) return;
    let start = parseInt(idx, 10);
    if (!Number.isFinite(start) || start < 0 || start >= list.length) {
        const firstUnseen = list.findIndex((s) => !s.seen);
        start = firstUnseen >= 0 ? firstUnseen : 0;
    }
    storyViewCtx = { ownerKey, ids: list.map((s) => s.id), idx: start, archive };
    $("#tinyfeed-story-viewer").removeClass("tinyfeed-hidden");
    renderStoryViewer();
}
function closeStoryViewer() {
    $("#tinyfeed-story-viewer").addClass("tinyfeed-hidden");
    storyViewCtx = null;
    if (currentApp === "feed") renderStoryBar();
}
function storyViewerNext() {
    if (!storyViewCtx) return;
    if (storyViewCtx.idx + 1 >= storyViewCtx.ids.length) { closeStoryViewer(); return; }
    storyViewCtx.idx += 1;
    renderStoryViewer();
}
function storyViewerPrev() {
    if (!storyViewCtx) return;
    if (storyViewCtx.idx <= 0) return;
    storyViewCtx.idx -= 1;
    renderStoryViewer();
}
function markStorySeen(id) {
    const s = findStory(id);
    if (!s || s.seen) return;
    s.seen = true;
    saveStories();
}

function storyTextsHtml(texts, editable) {
    return (texts || []).map((t) => `
        <div class="tinyfeed-story-text tinyfeed-story-size-${escapeAttr(t.size || "md")} tinyfeed-story-color-${escapeAttr(t.color || "white")}${editable ? " tinyfeed-story-text-draggable" : ""}"
             data-tid="${escapeAttr(t.id)}"
             style="left:${Number(t.xPct) || 50}%; top:${Number(t.yPct) || 50}%; transform: translate(-50%, -50%) rotate(${Number(t.rot) || 0}deg);"
        >${renderRich(escapeHtml(String(t.text || "")))}</div>`).join("");
}

function renderStoryViewer() {
    if (!storyViewCtx) return;
    const story = findStory(storyViewCtx.ids[storyViewCtx.idx]);
    if (!story) { closeStoryViewer(); return; }
    markStorySeen(story.id);
    const owner = ownerDisplay(story.ownerKey || ownerKeyForName(story.author));
    const isMine = story.ownerKey === "user" || story.isUser;
    $("#tinyfeed-story-viewer-bars").html(storyViewCtx.ids.map((id, i) => `
        <div class="tinyfeed-story-pbar"><div class="tinyfeed-story-pfill${i < storyViewCtx.idx ? " tinyfeed-story-pfill-done" : i === storyViewCtx.idx ? " tinyfeed-story-pfill-active" : ""}"></div></div>`).join(""));
    $("#tinyfeed-story-viewer-head").html(`
        <div class="tinyfeed-story-vhead-who tinyfeed-profile-open" data-author="${escapeAttr(story.author)}">
            ${makeAvatar(owner.avatarItem)}
            <div class="tinyfeed-story-vhead-meta">
                <span class="tinyfeed-story-vhead-name">${escapeText(story.author)}</span>
                <span class="tinyfeed-story-vhead-time">${escapeText(timeAgo(story.ts))}</span>
            </div>
        </div>
        <div class="tinyfeed-story-vhead-btns">
            ${isMine ? `<span id="tinyfeed-story-pin" title="ปักเป็นไฮไลต์ในโปรไฟล์"><i class="fa-solid fa-bookmark"></i></span>` : ""}
            ${isMine ? `<span id="tinyfeed-story-del" title="ลบสตอรี่"><i class="fa-solid fa-trash"></i></span>` : ""}
            <span id="tinyfeed-story-close" title="ปิด"><i class="fa-solid fa-xmark"></i></span>
        </div>`);
    const url = storyImgUrl(story);
    $("#tinyfeed-story-viewer-canvas").html(`
        <img class="tinyfeed-story-img" alt="" onerror="this.classList.add('tinyfeed-img-broken')" />
        ${storyTextsHtml(story.texts, false)}
        <div class="tinyfeed-story-nav tinyfeed-story-nav-prev" data-dir="prev"></div>
        <div class="tinyfeed-story-nav tinyfeed-story-nav-next" data-dir="next"></div>`);
    setImgSrcSafe($("#tinyfeed-story-viewer-canvas .tinyfeed-story-img"), url);
    const replies = Array.isArray(story.replies) ? story.replies : [];
    $("#tinyfeed-story-viewer-foot").html(`
        ${story.caption ? `<div class="tinyfeed-story-caption">${renderRich(escapeHtml(story.caption))}</div>` : ""}
        ${replies.length ? `<div class="tinyfeed-story-replies">${replies.map((r) => `
            <div class="tinyfeed-story-reply"><b class="tinyfeed-profile-open" data-author="${escapeAttr(r.author)}">${escapeText(r.author)}</b> ${renderRich(escapeHtml(r.text))}</div>`).join("")}</div>` : ""}
        <div class="tinyfeed-story-replybar">
            <input id="tinyfeed-story-reply-input" type="text" placeholder="${isMine ? "ตอบสตอรี่ของตัวเอง…" : "ตอบสตอรี่…"}" />
            <button id="tinyfeed-story-reply-send" class="tinyfeed-compose-iconbtn" title="ส่ง"><i class="fa-solid fa-paper-plane"></i></button>
            ${isMine ? `<button id="tinyfeed-story-ai-comment" class="tinyfeed-compose-iconbtn" title="ให้ NPC มาตอบสตอรี่"><i class="fa-solid fa-wand-magic-sparkles"></i></button>` : ""}
        </div>`);
}

// ตอบสตอรี่ — เก็บที่ story.replies เสมอ · ถ้าเป็นสตอรี่ของ AI และเปิด storyReplyToDm จะส่งการ์ดอ้างอิงเข้าห้องแชตด้วย
function sendStoryReply(storyId, text) {
    const clean = String(text || "").trim();
    if (!clean) return;
    const story = findStory(storyId);
    if (!story) return;
    story.replies.push({ id: storyNewId(), author: getUserName(), isUser: true, text: clean, ts: Date.now() });
    saveStories();
    renderStoryViewer();
    updateChatInjection();
    if (story.ownerKey && story.ownerKey !== "user" && getSetting("storyReplyToDm")) {
        const c = getConnectContacts().find((x) => x.key === story.ownerKey);
        if (c) {
            // ใช้การ์ดแชร์ของเดิม ไม่ต้องเขียน renderer ใหม่ · connectMsgText() จับ isShare อยู่แล้ว AI จึงเห็นเอง
            getThread(c.key).push({
                from: "user", isShare: true, ts: Date.now(),
                share: {
                    kind: "story", emoji: "📸", title: `ตอบสตอรี่ของ ${c.name}`,
                    sub: String(story.caption || "").slice(0, 60), body: clean, image: storyImgUrl(story),
                },
            });
            saveThread(c.key);
            if (currentApp === "connect" && activeThread === c.key) renderThread();
        }
    }
}

function deleteStory(id) {
    if (!confirm("ต้องการลบสตอรี่นี้ใช่ไหม?")) return;
    const data = getFeedData();
    data.stories = getStories().filter((s) => s.id !== id);
    saveStories();
    if (storyViewCtx) {
        storyViewCtx.ids = storyViewCtx.ids.filter((x) => x !== id);
        if (!storyViewCtx.ids.length) closeStoryViewer();
        else { storyViewCtx.idx = Math.min(storyViewCtx.idx, storyViewCtx.ids.length - 1); renderStoryViewer(); }
    }
    if (currentApp === "feed") renderStoryBar();
    updateChatInjection();
}

// ปักสตอรี่เป็นไฮไลต์ในโปรไฟล์ — คัดลอก "url" ไปเก็บ ไม่ได้อ้าง storyId
// (สตอรี่เป็น chat scope แต่ไฮไลต์เป็น global ที่ต้อง export ไปกับการ์ดได้ → ลบแชทแล้วไฮไลต์ยังอยู่)
function pinStoryToHighlight(id) {
    const story = findStory(id);
    if (!story) return;
    const rec = getProfileRecord("user");
    if (!rec) { toastr.error("ยังไม่รู้จัก persona ปัจจุบัน", "TinyPhone"); return; }
    const url = storyImgUrl(story);
    if (!url) { toastr.info("สตอรี่นี้ไม่มีรูปให้ปัก", "TinyPhone"); return; }
    let hl = rec.highlights.find((h) => h.title === "สตอรี่");
    if (!hl) { hl = { id: profileItemId("ph"), title: "สตอรี่", cover: url, items: [] }; rec.highlights.push(hl); }
    if (!hl.cover) hl.cover = url;
    hl.items.push({ url, caption: String(story.caption || "") });
    saveSettingsDebounced();
    if (!isPortableUrl(url)) toastr.info("รูปนี้เป็นไฟล์ในเครื่อง — จะไม่ติดไปกับการ์ดตัวละคร", "TinyPhone");
    else toastr.success("ปักเป็นไฮไลต์ในโปรไฟล์แล้ว", "TinyPhone");
}

// ── คลังสตอรี่ (ใช้ showDetail ได้ปุ่มย้อนกลับฟรี — เข้าจากแถบสตอรี่ในฟีดเท่านั้น) ──
function openStoryArchive() {
    const list = expiredStories();
    const body = list.length
        ? `<div class="tinyfeed-story-archive-grid">${list.map((s) => `
            <div class="tinyfeed-story-archive-cell" data-story="${escapeAttr(s.id)}">
                <img src="${escapeAttr(storyImgUrl(s))}" alt="" loading="lazy" onerror="this.classList.add('tinyfeed-img-broken')" />
                <span class="tinyfeed-story-archive-who">${escapeText(s.author)}</span>
                <span class="tinyfeed-story-archive-when">${escapeText(timeAgo(s.ts))}</span>
            </div>`).join("")}</div>`
        : emptyStateHtml("fa-clock-rotate-left", "คลังสตอรี่ยังว่าง", "สตอรี่ที่พ้น 24 ชม. จะมาอยู่ตรงนี้");
    showDetail(`<div class="tinyfeed-story-archive"><div class="tinyfeed-story-archive-title">คลังสตอรี่ (${list.length})</div>${body}</div>`);
}

// ── เขียนสตอรี่ใหม่ ──
let storyDraft = null;   // { imgName, imgUrl, caption, texts: [] }

function openStoryCompose() {
    storyDraft = { imgName: "", imgUrl: "", caption: "", texts: [] };
    renderStoryCompose();
    $("#tinyfeed-story-compose").removeClass("tinyfeed-hidden");
}
function closeStoryCompose() { $("#tinyfeed-story-compose").addClass("tinyfeed-hidden"); storyDraft = null; }

function renderStoryCompose() {
    if (!storyDraft) return;
    const url = storyDraft.imgUrl;
    $("#tinyfeed-story-compose-canvas").html(url
        ? `<img class="tinyfeed-story-img" alt="" onerror="this.classList.add('tinyfeed-img-broken')" />${storyTextsHtml(storyDraft.texts, true)}`
        : `<div class="tinyfeed-story-pick-hint"><i class="fa-solid fa-image"></i><span>เลือกรูปจากคลังก่อน</span></div>`);
    if (url) setImgSrcSafe($("#tinyfeed-story-compose-canvas .tinyfeed-story-img"), url);
    $("#tinyfeed-story-compose-caption").val(storyDraft.caption);
    $("#tinyfeed-story-compose-save").prop("disabled", !url);
}

function pickStoryImage() {
    // callback ของ picker คือ (token, name, kind) — ต้องไปหา url จากคลังเอง
    openGalleryPicker("image", (token, name) => {
        const im = findGalleryImage(name);
        if (!im) return;
        if (!storyDraft) storyDraft = { imgName: "", imgUrl: "", caption: "", texts: [] };
        storyDraft.imgName = im.name || "";
        storyDraft.imgUrl = im.url || "";
        renderStoryCompose();
    });
}

function addStoryText() {
    if (!storyDraft) return;
    if (!storyDraft.imgUrl) { toastr.info("เลือกรูปก่อนนะ", "TinyFeed"); return; }
    const t = { id: storyNewId(), text: "ข้อความ", xPct: 50, yPct: 50, size: "md", color: "white", rot: 0 };
    storyDraft.texts.push(t);
    renderStoryCompose();
    openStoryTextEdit(t.id);
}
function storyDraftText(tid) { return (storyDraft && storyDraft.texts.find((t) => t.id === tid)) || null; }

let storyTextEditId = null;
function openStoryTextEdit(tid) {
    const t = storyDraftText(tid);
    if (!t) return;
    storyTextEditId = tid;
    $("#tinyfeed-story-text-input").val(t.text);
    $("#tinyfeed-story-text-size").val(t.size || "md");
    $("#tinyfeed-story-text-color").val(t.color || "white");
    $("#tinyfeed-story-text-rot").val(String(Number(t.rot) || 0));
    $("#tinyfeed-story-text-edit").removeClass("tinyfeed-hidden");
}
function closeStoryTextEdit() { $("#tinyfeed-story-text-edit").addClass("tinyfeed-hidden"); storyTextEditId = null; }
function saveStoryTextEdit() {
    const t = storyDraftText(storyTextEditId);
    if (!t) { closeStoryTextEdit(); return; }
    t.text = String($("#tinyfeed-story-text-input").val() || "").trim() || "ข้อความ";
    t.size = String($("#tinyfeed-story-text-size").val() || "md");
    t.color = String($("#tinyfeed-story-text-color").val() || "white");
    const rot = parseInt($("#tinyfeed-story-text-rot").val(), 10);
    t.rot = Number.isFinite(rot) ? Math.max(-30, Math.min(30, rot)) : 0;
    closeStoryTextEdit();
    renderStoryCompose();
}
function deleteStoryText() {
    if (!storyDraft || !storyTextEditId) { closeStoryTextEdit(); return; }
    storyDraft.texts = storyDraft.texts.filter((t) => t.id !== storyTextEditId);
    closeStoryTextEdit();
    renderStoryCompose();
}

// ลากข้อความบนรูป — อัปเดตเฉพาะ style ของ element เดียว (low-motion) แล้วค่อยเก็บ % ตอนปล่อย
let storyDragState = null;
function storyDragStart(e, el) {
    if (!storyDraft) return;
    const canvas = document.getElementById("tinyfeed-story-compose-canvas");
    if (!canvas) return;
    storyDragState = { tid: $(el).data("tid"), el, canvas, moved: false };
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* บางเบราว์เซอร์ไม่รองรับ — ลากได้อยู่ดี */ }
}
function storyDragMove(e) {
    if (!storyDragState) return;
    const r = storyDragState.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const x = Math.max(4, Math.min(96, ((e.clientX - r.left) / r.width) * 100));
    const y = Math.max(4, Math.min(96, ((e.clientY - r.top) / r.height) * 100));
    storyDragState.moved = true;
    storyDragState.x = x;
    storyDragState.y = y;
    storyDragState.el.style.left = x + "%";
    storyDragState.el.style.top = y + "%";
}
function storyDragEnd() {
    if (!storyDragState) return;
    const st = storyDragState;
    storyDragState = null;
    if (!st.moved) { openStoryTextEdit(st.tid); return; }   // แตะเฉยๆ = แก้ข้อความ
    const t = storyDraftText(st.tid);
    if (t) { t.xPct = Math.round(st.x); t.yPct = Math.round(st.y); }
}

function saveStoryFromCompose() {
    if (!storyDraft || !storyDraft.imgUrl) return;
    const story = {
        id: storyNewId(), author: getUserName(), ownerKey: "user",
        isUser: true, avatar: "",
        imgName: storyDraft.imgName, imgUrl: storyDraft.imgUrl,
        caption: String($("#tinyfeed-story-compose-caption").val() || "").trim(),
        texts: storyDraft.texts, ts: Date.now(), seen: true, replies: [],
    };
    getStories().push(story);
    saveStories();
    closeStoryCompose();
    if (currentApp === "feed") renderStoryBar();
    updateChatInjection();
    toastr.success("ลงสตอรี่แล้ว", "TinyFeed");
    if (getSetting("storyAiComment")) generateStoryComments(story.id);
}

// ── โน้ตบนแถบสตอรี่ (Instagram Notes) ──
// ชื่อคีย์ต้องเป็น noteBubbles — data.notes เป็นของ TinyMemo อยู่แล้ว ห้ามชนกัน
function getNoteBubbles() {
    const data = getFeedData();
    if (!data.noteBubbles || typeof data.noteBubbles !== "object") data.noteBubbles = {};
    const ttl = Math.max(1, parseInt(getSetting("noteTtlHours"), 10) || 24) * 3600000;
    const now = Date.now();
    for (const k of Object.keys(data.noteBubbles)) {
        const n = data.noteBubbles[k];
        if (!n || typeof n !== "object" || !n.text || now - (Number(n.ts) || 0) >= ttl) delete data.noteBubbles[k];
    }
    return data.noteBubbles;
}
function noteFor(ownerKey) { return getNoteBubbles()[ownerKey] || null; }
function setNote(ownerKey, text, byAi) {
    const notes = getNoteBubbles();
    const clean = String(text || "").trim().slice(0, Math.max(10, parseInt(getSetting("noteMaxLen"), 10) || 60));
    if (!clean) delete notes[ownerKey];
    else notes[ownerKey] = { text: clean, ts: Date.now(), byAi: Boolean(byAi) };
    saveFeedDataDebounced();
    if (currentApp === "feed") renderStoryBar();
    updateChatInjection();
}

let storyNoteViewKey = null;
function openStoryNoteEdit() {
    const cur = noteFor("user");
    $("#tinyfeed-storynote-input").val(cur ? cur.text : "");
    $("#tinyfeed-storynote-input").attr("maxlength", String(Math.max(10, parseInt(getSetting("noteMaxLen"), 10) || 60)));
    $("#tinyfeed-storynote-edit").removeClass("tinyfeed-hidden");
}
function closeStoryNoteEdit() { $("#tinyfeed-storynote-edit").addClass("tinyfeed-hidden"); }
function saveStoryNote() { setNote("user", $("#tinyfeed-storynote-input").val(), false); closeStoryNoteEdit(); }
function deleteStoryNote() { setNote("user", "", false); closeStoryNoteEdit(); }

function openStoryNoteView(ownerKey) {
    const note = noteFor(ownerKey);
    if (!note) return;
    const d = ownerDisplay(ownerKey);
    storyNoteViewKey = ownerKey;
    $("#tinyfeed-storynote-view-body").html(`
        <div class="tinyfeed-storynote-view-head">
            ${makeAvatar(d.avatarItem)}
            <div>
                <div class="tinyfeed-storynote-view-name tinyfeed-profile-open" data-author="${escapeAttr(d.name)}">${escapeText(d.name)}</div>
                <div class="tinyfeed-storynote-view-time">${escapeText(timeAgo(note.ts))}</div>
            </div>
        </div>
        <div class="tinyfeed-storynote-view-text">${renderRich(escapeHtml(note.text))}</div>
        <div class="tinyfeed-storynote-react">
            <button class="tinyfeed-storynote-emoji" data-emo="❤️">❤️</button>
            <button class="tinyfeed-storynote-emoji" data-emo="😂">😂</button>
            <button class="tinyfeed-storynote-emoji" data-emo="😮">😮</button>
            <button class="tinyfeed-storynote-emoji" data-emo="🥺">🥺</button>
        </div>
        <button id="tinyfeed-storynote-reply" class="tinyfeed-btn-primary"><i class="fa-solid fa-paper-plane"></i> ตอบในแชต</button>`);
    $("#tinyfeed-storynote-view").removeClass("tinyfeed-hidden");
}
function closeStoryNoteView() { $("#tinyfeed-storynote-view").addClass("tinyfeed-hidden"); storyNoteViewKey = null; }

// ★ ตอบโน้ต = เข้าห้องแชตของคนนั้นทันที พร้อมชิปอ้างโน้ตเหนือแถบพิมพ์
function replyToNoteInConnect(ownerKey, prefill) {
    const note = noteFor(ownerKey);
    const c = getConnectContacts().find((x) => x.key === ownerKey);
    if (!c) { toastr.info("ยังไม่มีห้องแชตของคนนี้", "TinyConnect"); return; }
    closeStoryNoteView();
    // ★ ต้องตั้งชิป "หลัง" เข้าห้องแล้ว — openApp() เรียก clearScreenTimers() ซึ่งล้างชิปทิ้ง
    if (!openConnectThreadFor(ownerKey, prefill || "")) return;
    connectQuotePending = { owner: ownerKey, name: c.name, text: note ? note.text : "" };
    renderConnectQuoteChip();
}

// ── สตอรี่จาก AI ──
let isStoryBusy = false;

function storyRosterLine(charName) {
    const npcNames = getNpcs().map((n) => String(n.name || "").trim()).filter(Boolean);
    return npcNames.length
        ? `ผู้ลงสตอรี่ต้องเป็นตัวละครหลัก (${charName}) หรือ NPC เหล่านี้เท่านั้น (สะกดชื่อให้ตรงเป๊ะ): ${npcNames.join(", ")}. `
        : `ผู้ลงสตอรี่คือตัวละครหลัก (${charName}). `;
}
// ดึงค่าหลัง "KEY:" บรรทัดแรกที่เจอ (parser ต้องทน AI ตอบเพี้ยน/มีขยะนำหน้า)
function grabLine(raw, key) {
    const m = new RegExp(`${key}:\\s*(.+)`, "i").exec(String(raw || ""));
    return m ? m[1].trim() : "";
}
// รูปที่ AI เลือกได้ = ขอบเขตเดียวกับที่บอกไปใน galleryPromptBlock()
function storyAllowedImages() {
    const g = getGallery();
    if (getSetting("galleryPromptScope") !== "selected") return g.images;
    const scope = new Set(getSetting("galleryAlbums") || []);
    const picked = g.images.filter((im) => scope.has(im.album));
    return picked.length ? picked : g.images;
}
function storyPickImage(name) {
    const byName = findGalleryImage(name);
    if (byName) return byName;
    const pool = storyAllowedImages();
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

async function generateStory(opts) {
    opts = opts || {};
    if (isStoryBusy) return;
    const char = getCurrentCharacter();
    if (!char) { if (!opts.silent) toastr.info("เลือกตัวละครก่อนนะ", "TinyFeed"); return; }
    if (!storyAllowedImages().length) {
        if (!opts.silent) toastr.info("ยังไม่มีรูปในคลัง — เพิ่มที่แอป TinyGallery ก่อนนะ", "TinyFeed");
        return;
    }
    isStoryBusy = true;
    $(".tinyfeed-story-genchip").addClass("tinyfeed-generating");
    try {
        const charName = getCharName();
        const extra = String(getSetting("storyExtraPrompt") || "").trim();
        const q = buildPrompt("storyPost", {
            roster: storyRosterLine(charName),
            extra: extra ? `คำสั่งเพิ่มเติมจากผู้ใช้: ${extra}. ` : "",
            gallery: galleryPromptBlock(),
            context: crossAppContext("story"),
        });
        const raw = await tinyGenerate(q, parseInt(getSetting("storyTokens"), 10) || 200, "story");
        if (!raw) { if (!opts.silent) toastr.warning("AI ไม่ตอบกลับมา", "TinyFeed"); return; }
        const author = cleanAiName(grabLine(raw, "NAME")) || charName;
        const img = storyPickImage(unescapeLite(grabLine(raw, "IMAGE")));
        if (!img) { if (!opts.silent) toastr.warning("หารูปในคลังไม่เจอ", "TinyFeed"); return; }
        const overlay = stripWrapBrackets(grabLine(raw, "STORY"));
        const caption = stripWrapBrackets(grabLine(raw, "CAPTION"));
        const ownerKey = ownerKeyForName(author) || "main";
        const story = {
            id: storyNewId(), author, ownerKey,
            isMain: nameMatchesChar(author), isAI: true, avatar: "",
            imgName: img.name || "", imgUrl: img.url || "",
            caption: caption && caption !== "-" ? caption : "",
            // AI ไม่ต้องส่งพิกัด (ค่าจาก LLM ไม่น่าเชื่อถือ) — วางตำแหน่ง preset ให้เลย
            texts: overlay ? [{ id: storyNewId(), text: overlay, xPct: 50, yPct: 78, size: "md", color: "white", rot: 0 }] : [],
            ts: Date.now(), seen: false, replies: [],
        };
        getStories().push(story);
        saveStories();
        if (currentApp === "feed") renderStoryBar();
        updateChatInjection();
        if (opts.notify) {
            const d = ownerDisplay(ownerKey);
            showNotif(makeAvatar(d.avatarItem), author, `ลงสตอรี่ใหม่${overlay ? " — " + overlay : ""}`, "feed", "feed");
        }
        // โอกาสที่ตัวละครจะอัปเดตโน้ตพร้อมกัน (ให้แถบสตอรี่มีชีวิตขึ้นโดยไม่ต้องกดเพิ่ม)
        if (getSetting("noteEnabled") && ownerKey !== "user" && Math.random() < 0.35) generateStoryNote(ownerKey, { silent: true });
        return story;
    } catch (e) {
        console.error(`[${extensionName}] generateStory ล้มเหลว:`, e);
        if (!opts.silent) toastr.error("สร้างสตอรี่ไม่สำเร็จ", "TinyFeed");
    } finally {
        isStoryBusy = false;
        $(".tinyfeed-story-genchip").removeClass("tinyfeed-generating");
    }
}

// ให้ NPC/ตัวละครมาตอบสตอรี่ (ใช้กับสตอรี่ของเราเอง) — งานเบื้องหลัง เงียบได้
async function generateStoryComments(storyId, opts) {
    opts = opts || {};
    const story = findStory(storyId);
    if (!story) return;
    const char = getCurrentCharacter();
    if (!char) return;
    $("#tinyfeed-story-ai-comment").addClass("tinyfeed-generating");
    try {
        const charName = getCharName();
        const overlay = (story.texts || []).map((t) => t.text).join(" / ");
        const q = buildPrompt("storyComment", {
            author: story.author,
            storyText: [overlay, story.caption].filter(Boolean).join(" — ") || "(รูปเปล่า ไม่มีข้อความ)",
            roster: npcRosterLine(charName),
            count: `เขียนมา ${Math.max(1, parseInt(getSetting("storyAiCommentCount"), 10) || 2)} คอมเมนต์. `,
            context: crossAppContext("story"),
        });
        const raw = await tinyGenerate(q, parseInt(getSetting("commentTokens"), 10) || 300, "story");
        const rows = parseCommentLines(raw, charName, "COMMENT");
        if (!rows.length) { if (!opts.silent) toastr.warning("AI ไม่ได้ตอบคอมเมนต์มา", "TinyFeed"); return; }
        for (const r of rows.slice(0, 4)) {
            story.replies.push({ id: storyNewId(), author: r.author, isUser: false, text: htmlToPlain(r.text), ts: Date.now() });
        }
        saveStories();
        if (storyViewCtx) renderStoryViewer();
        updateChatInjection();
        const first = rows[0];
        showNotif(makeAvatar({ author: first.author, isMain: first.isMain }), first.author, `ตอบสตอรี่: ${htmlToPlain(first.text)}`, "feed", "feed");
    } catch (e) {
        console.error(`[${extensionName}] generateStoryComments ล้มเหลว:`, e);
        if (!opts.silent) toastr.error("ให้ AI ตอบสตอรี่ไม่สำเร็จ", "TinyFeed");
    } finally {
        $("#tinyfeed-story-ai-comment").removeClass("tinyfeed-generating");
    }
}

// ให้ตัวละครเขียนโน้ตบนแถบสตอรี่ (ownerKey ว่าง = สุ่มคนจากรายชื่อแชต)
async function generateStoryNote(ownerKey, opts) {
    opts = opts || {};
    const contacts = getConnectContacts();
    if (!contacts.length) { if (!opts.silent) toastr.info("ยังไม่มีตัวละคร/NPC ให้เขียนโน้ต", "TinyFeed"); return; }
    const target = contacts.find((c) => c.key === ownerKey) || contacts[Math.floor(Math.random() * contacts.length)];
    $("#tinyfeed-story-gennote").addClass("tinyfeed-generating");
    try {
        const extra = String(getSetting("storyExtraPrompt") || "").trim();
        const q = buildPrompt("storyNote", {
            who: target.name,
            extra: extra ? `คำสั่งเพิ่มเติมจากผู้ใช้: ${extra}. ` : "",
            context: crossAppContext("story"),
        });
        const raw = await tinyGenerate(q, 120, "story");
        const note = stripWrapBrackets(grabLine(raw, "NOTE"));
        if (!note) { if (!opts.silent) toastr.warning("AI ไม่ได้เขียนโน้ตมา", "TinyFeed"); return; }
        setNote(target.key, htmlToPlain(note), true);
        if (!opts.silent) toastr.success(`${target.name} เขียนโน้ตใหม่แล้ว`, "TinyFeed");
    } catch (e) {
        console.error(`[${extensionName}] generateStoryNote ล้มเหลว:`, e);
        if (!opts.silent) toastr.error("ให้ตัวละครเขียนโน้ตไม่สำเร็จ", "TinyFeed");
    } finally {
        $("#tinyfeed-story-gennote").removeClass("tinyfeed-generating");
    }
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
    if (aiMode && quoteTarget) cancelQuotePost();   // โควทได้เฉพาะตอนโพสต์เป็นตัวเราเอง — สลับไปโหมด AI แล้วยกเลิกโควทที่ค้างไว้
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
                    <span class="tinyfeed-news-share" data-news="${news.id}" title="แชร์ข่าวนี้"><i class="fa-solid fa-share"></i></span>
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
            ${post.repostOf ? `<div class="tinyfeed-repost-tag"><i class="fa-solid fa-retweet"></i> ${escapeText(post.author)} รีโพสต์</div>` : ""}
            <div class="tinyfeed-post-head">
                ${makeAvatarLink(post)}
                <div class="tinyfeed-post-meta">
                    <span class="tinyfeed-post-author tinyfeed-profile-open" data-author="${escapeAttr(post.author)}">${post.author}</span>
                    <span class="tinyfeed-post-time">${displayTime(post)}</span>
                </div>
            </div>
            <div class="tinyfeed-post-body">${renderPostBody(post.text)}</div>
            ${(post.quoteOf || post.repostOf) ? embeddedPostHtml(post.quoteOf || post.repostOf) : ""}
            <div class="tinyfeed-post-actions">
                <span><span class="fa-regular fa-heart"></span> ${Number(post.likes || 0).toLocaleString()}</span>
                <span><span class="fa-regular fa-comment"></span> ${post.comments.length.toLocaleString()}</span>
                <span class="tinyfeed-share ${post.shared ? "tinyfeed-shared" : ""}" data-post="${post.id}"><span class="fa-solid fa-share"></span></span>
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
            ? `<button class="tinyfeed-ai-link tinyfeed-gen-comments" data-post="${post.id}"><i class="fa-solid fa-comment-medical"></i> <span>ให้ NPC คอมเมนต์</span></button>`
            : (getSetting("commentReplyMode") === "manual"
                ? `<button class="tinyfeed-ai-link tinyfeed-ai-reply" data-post="${post.id}"><i class="fa-solid fa-wand-magic-sparkles"></i> <span>ให้ AI ตอบ</span></button>`
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
    saveFeedDataDebounced();
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

// สร้าง payload สำหรับส่งเข้า openSharePicker จากโพสต์ฟีด — ดึงรูปแรก (ถ้ามี [img:]) มาแปะเป็นภาพตัวอย่างด้วย
function feedPostSharePayload(post) {
    const imgMatch = /\[img:([^\]]+)\]/i.exec(String(post.text || ""));
    const image = imgMatch ? ((findGalleryImage(unescapeLite(imgMatch[1])) || {}).url || "") : "";
    return { kind: "post", title: post.author, sub: "โพสต์จาก TinyFeed", body: htmlToPlain(post.text).slice(0, 200), image, emoji: "📝" };
}

// สแนปช็อตโพสต์ (ใช้ฝังในโพสต์โควท/รีโพสต์) — ตัด quoteOf/repostOf ทิ้งเสมอ: กันซ้อนไม่จำกัดชั้นด้วยโครงสร้าง
// (ลึกสุด 1 ชั้นเสมอ) และถ้าต้นฉบับถูกลบ/แก้ทีหลัง การ์ดที่ฝังไว้ยังอยู่ครบ ไม่ต้องออกแบบสถานะ "โพสต์ถูกลบ" แยก
function postSnapshot(post) {
    return {
        id: post.id, author: post.author, text: post.text, ts: post.ts,
        isUser: Boolean(post.isUser), isMain: Boolean(post.isMain), isAI: Boolean(post.isAI), isPet: Boolean(post.isPet),
        avatar: post.avatar || "",
    };
}
// การ์ดโพสต์ที่ฝังอยู่ในโพสต์โควท/รีโพสต์ — ไม่ผูก handler คลิกเอง ปล่อยให้คลิกทะลุไปเปิดรายละเอียดของโพสต์ที่ห่อมันแทน
// (ถูกต้องตามโมเดล snapshot — การ์ดนี้ไม่ใช่ "ไปที่ต้นฉบับ" แต่คือสำเนา ณ ตอนโควท/รีโพสต์)
function embeddedPostHtml(snap) {
    return `<div class="tinyfeed-post-embed">
        <div class="tinyfeed-post-embed-head">
            ${makeAvatar(snap)}
            <span class="tinyfeed-post-embed-author">${escapeText(snap.author)}</span>
            <span class="tinyfeed-post-embed-time">${displayTime(snap)}</span>
        </div>
        <div class="tinyfeed-post-embed-body">${renderPostBody(snap.text)}</div>
    </div>`;
}

// ===== เมนูแชร์โพสต์: ส่งเข้าแชท / รีโพสต์ / โควท =====
let shareMenuTargetId = null;
function openShareMenu(postId) {
    const post = getFeedData().feed.find((p) => p.id === postId);
    if (!post) return;
    shareMenuTargetId = postId;
    $("#tinyfeed-share-menu").removeClass("tinyfeed-hidden");
}
function closeShareMenu() { $("#tinyfeed-share-menu").addClass("tinyfeed-hidden"); shareMenuTargetId = null; }

function shareFeedPostToChat(postId) {
    const post = getFeedData().feed.find((p) => p.id === postId);
    if (!post) return;
    openSharePicker(feedPostSharePayload(post));
    // ทำเครื่องหมายไว้ว่าเคยแชร์โพสต์นี้แล้ว (เดาใจว่าผู้ใช้กด "แชร์" แล้ว ไม่รอผลว่าส่งจริงไหม — เหมือนปุ่ม like เดิม)
    post.shared = true;
    saveFeedDataDebounced();
    $(`.tinyfeed-share[data-post="${postId}"]`).addClass("tinyfeed-shared");
}

// รีโพสต์ — สร้างโพสต์ใหม่ของเรา ไม่มีข้อความตัวเอง ห่อโพสต์เดิมไว้เป็นสแนปช็อต (ต้นฉบับถูกลบ/แก้ทีหลังไม่กระทบการ์ดที่ฝัง)
function repostFeedPost(postId) {
    const data = getFeedData();
    const post = data.feed.find((p) => p.id === postId);
    if (!post) { closeShareMenu(); return; }
    if (data.feed.some((p) => p.isUser && p.repostOf && p.repostOf.id === postId)) {
        toastr.info("รีโพสต์โพสต์นี้ไปแล้ว", "TinyFeed");
        closeShareMenu();
        return;
    }
    data.feed.unshift({
        id: "rp" + Date.now(), author: getUserName(), isUser: true, avatar: "",
        ts: Date.now(), text: "", likes: randomInitialLikes(), comments: [],
        repostOf: postSnapshot(post),
    });
    post.shared = true;
    saveFeedDataDebounced();
    renderFeed();
    closeShareMenu();
    toastr.success("รีโพสต์แล้ว", "TinyFeed");
}

// โควท — เก็บ postId ที่กำลังโควทไว้ใน quoteTarget แล้วให้ addUserPost() แนบสแนปช็อตให้ตอนโพสต์จริง
// ต้องล้างค่านี้ทุกจุดที่ออกจากหน้าฟีด (openApp/goHome) และตอนสลับคนโพสต์ไปเป็น AI (applyFeedComposeMode) ไม่งั้นค้างข้ามหน้าจอ
let quoteTarget = null;
function startQuotePost(postId) {
    const post = getFeedData().feed.find((p) => p.id === postId);
    if (!post) { closeShareMenu(); return; }
    quoteTarget = postId;
    feedPoster = POSTER_USER;   // โควทในนามตัวละครอื่นไม่สมเหตุผล — บังคับกลับมาเป็นเราเอง
    closeShareMenu();
    if (!$("#tinyfeed-detail").hasClass("tinyfeed-hidden")) closeDetail();   // มาจากหน้ารายละเอียด → กลับไปหน้าฟีดหลักที่มีช่องพิมพ์
    $("#tinyfeed-quote-chip-name").text(post.author);
    $("#tinyfeed-quote-chip").removeClass("tinyfeed-hidden");
    applyFeedComposeMode();
    $("#tinyfeed-compose-input").trigger("focus");
}
function cancelQuotePost() {
    quoteTarget = null;
    $("#tinyfeed-quote-chip").addClass("tinyfeed-hidden");
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
    if (quoteTarget) {
        const quoted = getFeedData().feed.find((p) => p.id === quoteTarget);
        if (quoted) post.quoteOf = postSnapshot(quoted);
        quoteTarget = null;
        $("#tinyfeed-quote-chip").addClass("tinyfeed-hidden");
    }
    getFeedData().feed.unshift(post);
    saveFeedDataDebounced();
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
    saveFeedDataDebounced();
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
    saveFeedDataDebounced();
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
    storyPost: {
        label: "สตอรี่ (TinyFeed)", marker: "STORY:", tokens: ["roster", "extra", "gallery", "context"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] แต่งสตอรี่ 24 ชั่วโมง 1 ชิ้นที่ตัวละครจะลงในโทรศัพท์ สะท้อนช่วงเวลาตอนนี้ของเนื้อเรื่อง. {{roster}}เลือกรูป 1 รูปจากคลังโดยพิมพ์ชื่อรูปให้ตรงเป๊ะ. ข้อความที่แปะบนรูปต้องสั้นมาก (ไม่เกิน 8 คำ) เหมือนสติกเกอร์ข้อความ. ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดแทนหรือกระทำแทนผู้ใช้. {{extra}}{{gallery}}{{context}}\n` +
            `ตอบกลับตามรูปแบบนี้เท่านั้น ห้ามมีข้อความอื่น:\nNAME: <ชื่อผู้ลงสตอรี่>\nIMAGE: <ชื่อรูปจากคลัง>\nSTORY: <ข้อความบนรูป>\nCAPTION: <คำบรรยายสั้นๆ ใส่ - ถ้าไม่มี>`,
    },
    storyComment: {
        label: "คนมาตอบสตอรี่ (TinyFeed)", marker: "COMMENT:", tokens: ["author", "storyText", "roster", "count", "context"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] {{author}} เพิ่งลงสตอรี่ว่า "{{storyText}}" เขียนข้อความตอบสตอรี่แบบสั้นๆ เป็นกันเอง (1 ประโยค) เหมือนคนทักตอบสตอรี่ในแชต. {{roster}}{{count}}ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดแทนหรือกระทำแทนผู้ใช้. {{context}}\n` +
            `ตอบกลับตามรูปแบบนี้บรรทัดละคน ห้ามมีข้อความอื่น:\nCOMMENT: <ชื่อ> | <ข้อความ>`,
    },
    storyNote: {
        label: "โน้ตบนแถบสตอรี่ (TinyFeed)", marker: "NOTE:", tokens: ["who", "extra", "context"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] เขียนโน้ตสั้นมาก (ไม่เกิน 60 ตัวอักษร) ในนามของ {{who}} แบบที่คนเขียนแปะไว้บนโปรไฟล์โซเชียล — เป็นความรู้สึก ประโยคติดปาก หรือสิ่งที่กำลังคิดอยู่ตอนนี้. {{extra}}{{context}}\n` +
            `ตอบกลับตามรูปแบบนี้เท่านั้น ห้ามมีข้อความอื่น:\nNOTE: <ข้อความ>`,
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
    askInbox: {
        label: "คำถามนิรนามที่ส่งเข้ามา (TinyAsk)", marker: "ASK:", tokens: ["roster", "count", "extra", "context"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] เขียนคำถามนิรนามที่คนในโลกของเรื่องนี้ส่งเข้ากล่องคำถามของผู้ใช้ ให้เข้ากับบรรยากาศ/สถานการณ์ตอนนี้ {{roster}}ผสมคำถามจริงจัง/กวนๆ/น่ารักปนกันไป ห้ามหยาบคาย ห้ามพูดหรือกระทำแทนผู้ใช้ ตั้งชื่อผู้ถามให้ (จะเป็นตัวละครที่มีอยู่หรือคนทั่วไปก็ได้) {{count}}{{extra}}{{context}}\n` +
            `ตอบบรรทัดละ 1 คำถามในรูปแบบนี้เท่านั้น:\nASK: <ชื่อผู้ถามจริง> | <คำถาม>`,
    },
    askAnswer: {
        label: "ตัวละครตอบคำถามนิรนาม (TinyAsk)", marker: "ANSWER:", tokens: ["owner", "question", "roster", "extra", "context"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] {{owner}} ได้รับคำถามนิรนามในกล่องคำถามว่า: "{{question}}" {{roster}}ตอบในบทบาทของ {{owner}} สั้นๆ 1-3 ประโยค ให้สมคาแรกเตอร์ ใช้ภาษาเดียวกับข้อมูลตัวละคร ห้ามพูดหรือกระทำแทนผู้ใช้.{{extra}}{{context}}\n` +
            `ตอบรูปแบบนี้เท่านั้น:\nANSWER: <คำตอบ>`,
    },
    askPair: {
        label: "สุ่มคำถาม-คำตอบทั้งคู่ (TinyAsk)", marker: "ASK:", tokens: ["owner", "roster", "extra", "context"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] แต่งคำถามนิรนามที่น่าสนใจ 1 ข้อที่คนในโลกของเรื่องน่าจะอยากถาม {{owner}} ตั้งชื่อผู้ถามให้ (ตัวละครที่มีอยู่หรือคนทั่วไปก็ได้) แล้วให้ {{owner}} ตอบคำถามนั้นเองในบทบาทของตัวเอง สั้นๆ 1-3 ประโยค สมคาแรกเตอร์ {{roster}}ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดหรือกระทำแทนผู้ใช้.{{extra}}{{context}}\n` +
            `ตอบรูปแบบนี้เท่านั้น ห้ามมีข้อความอื่น:\nASK: <ชื่อผู้ถามจริง> | <คำถาม>\nANSWER: <คำตอบของ {{owner}}>`,
    },
    askDraft: {
        label: "ร่างคำถามให้ (TinyAsk)", marker: "ASK:", tokens: ["owner", "roster", "extra", "context"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] ช่วยแต่งคำถามนิรนามที่น่าสนใจ 1 ข้อที่คนในโลกของเรื่องน่าจะอยากถาม {{owner}} (ผู้ใช้จะเอาไปแก้ไขก่อนส่งเองอีกที) {{roster}}ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดหรือกระทำแทนผู้ใช้.{{extra}}{{context}}\n` +
            `ตอบรูปแบบนี้เท่านั้น:\nASK: <คำถาม>`,
    },
    bankScan: {
        label: "สแกนเงินจากบท RP (TinyBank)", marker: "MONEY:", tokens: ["recent", "existing", "extra", "context"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง ไม่ต้องสวมบทบาท] อ่านบทบาทสมมติล่าสุดนี้ แล้วหา "เหตุการณ์เกี่ยวกับเงิน" ที่เกิดขึ้นจริงในเนื้อเรื่อง (ได้รับค่าจ้าง/รางวัล/ของขวัญเป็นเงิน หรือจ่าย/เสีย/ถูกขโมยเงิน) ที่ยัง "ไม่เคยถูกบันทึกไว้" เท่านั้น ห้ามแต่งเหตุการณ์ที่ไม่ได้เกิดขึ้นจริงในบท ห้ามนับเงินที่แค่พูดถึงเฉยๆ ไม่ได้รับ/จ่ายจริง ห้ามรายงานเหตุการณ์ที่บันทึกไว้แล้วซ้ำอีก\n` +
            `บทล่าสุด:\n{{recent}}\n` +
            `{{existing}}{{extra}}{{context}}\n` +
            `ตอบบรรทัดละ 1 รายการในรูปแบบนี้เท่านั้น (ไม่มีเหตุการณ์ใหม่ก็ไม่ต้องตอบอะไรเลย):\nMONEY: <+จำนวน หรือ -จำนวน> | <รายละเอียดสั้นๆ>`,
    },
    connectReply: {
        label: "ตอบแชต 1:1 (TinyConnect)", marker: "", tokens: ["you", "name", "extra", "markers", "context", "gallery", "transcript"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] นี่คือแชตส่วนตัวในแอปแชต (คล้ายไลน์) ระหว่าง {{you}} กับ {{name}}. ` +
            `ตอบข้อความล่าสุดในบทบาทของ {{name}} แบบเป็นธรรมชาติ สั้นกระชับเหมือนแชตจริง (1-3 ประโยค) ` +
            `ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดหรือกระทำแทน {{you}}.\n` +
            `{{extra}}{{markers}}{{context}}{{gallery}}` +
            `บทแชตล่าสุด:\n{{transcript}}\n` +
            `ตอบเฉพาะข้อความของ {{name}} เท่านั้น ไม่ต้องใส่ชื่อนำหน้า`,
    },
    callReply: {
        label: "คุยสาย (TinyConnect)", marker: "", tokens: ["you", "name", "kind", "dir", "extra", "hangup", "context", "recent", "transcript"],
        default:
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] {{you}} กำลัง{{kind}}อยู่กับ {{name}} — {{dir}}. ` +
            `พูดในบทบาทของ {{name}} แบบเป็นธรรมชาติเหมือนกำลังคุยโทรศัพท์จริง ให้น้ำเสียงสอดคล้องกับว่าใครเป็นฝ่ายโทร ` +
            `(เช่นถ้า {{name}} เป็นฝ่ายโทรมาเอง ควรมีเหตุผลที่โทรมา ถ้า {{you}} เป็นฝ่ายโทรไป {{name}} ควรรับสายแบบทักทายธรรมดา) สั้นกระชับ 1-2 ประโยค ` +
            `ห้ามใช้สติกเกอร์หรือคำบรรยายท่าทางยาวๆ (คุยสาย ไม่ใช่แชตข้อความ) ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดหรือกระทำแทน {{you}}.\n` +
            `{{extra}}{{hangup}}{{context}}` +
            `ก่อนหน้านี้คุยอะไรกันไว้ในแชต:\n{{recent}}\n` +
            `บทสนทนาในสายนี้ล่าสุด:\n{{transcript}}\n` +
            `ตอบเฉพาะคำพูดของ {{name}} เท่านั้น ไม่ต้องใส่ชื่อนำหน้า ไม่ต้องมีเครื่องหมายคำพูด`,
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
    { app: "ask", label: "TinyAsk (คำถามนิรนาม)", setting: "askKeywords" },
    { app: "bank", label: "TinyBank (สแกนเงินจากบท RP)", setting: "bankKeywords" },
    { app: "call", label: "TinyConnect (โทรหาเราเอง)", setting: "callKeywords" },
    { app: "story", label: "สตอรี่ (TinyFeed)", setting: "storyKeywords" },
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
    author = cleanAiName(author) || fallbackName;
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
        saveFeedDataDebounced();
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
        author = cleanAiName(author) || charName;
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
    saveFeedDataDebounced();
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
        const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("commentTokens"), 10) || 300), "feed");
        const list = parseCommentLines(raw, charName);
        if (list.length) {
            post.comments.push(list[0]);
            saveFeedDataDebounced();
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
    const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("commentTokens"), 10) || 300), "feed");
    const comments = parseCommentLines(raw, charName)
        .filter((c) => c.author.trim().toLowerCase() !== String(post.author).trim().toLowerCase());
    if (comments.length) {
        post.comments.push(...comments);
        saveFeedDataDebounced();
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
        saveFeedDataDebounced();
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
    saveFeedDataDebounced();
    renderNews();
    console.log(`[${extensionName}] news deleted:`, newsId);
}
function shareNewsItem(newsId) {
    const news = getFeedData().news.find((n) => n.id === newsId);
    if (!news) return;
    openSharePicker({ kind: "news", title: news.title, sub: `ข่าวจาก ${news.source}`, body: htmlToPlain(news.summary).slice(0, 200), image: "", emoji: "📰" });
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
    saveFeedDataDebounced();
    $("#tinyfeed-agenda-input").val("");
    renderAgenda();
    updateChatInjection();
}

function addNoteManual(text) {
    const clean = String(text || "").trim();
    if (!clean) return;
    getNotes().push({ id: "n" + Date.now(), text: escapeHtml(clean), kind: "fact", isAI: false, ts: Date.now() });
    saveFeedDataDebounced();
    $("#tinyfeed-note-input").val("");
    renderNotes();
    updateChatInjection();
}

// ติ๊ก/ยกเลิกติ๊ก (pending <-> done, และ cancelled -> pending)
function toggleAgenda(id) {
    const a = getAgenda().find((x) => x.id === id);
    if (!a) return;
    a.status = a.status === "pending" ? "done" : "pending";
    saveFeedDataDebounced();
    renderAgenda();
    updateChatInjection();
}

function deleteAgenda(id) {
    const agenda = getAgenda();
    const a = agenda.find((x) => x.id === id);
    if (!a) return;
    if (!confirm("ต้องการลบกำหนดการนี้ใช่ไหม?")) return;
    agenda.splice(agenda.indexOf(a), 1);
    saveFeedDataDebounced();
    renderAgenda();
    updateChatInjection();
}

function deleteNote(id) {
    const notes = getNotes();
    const n = notes.find((x) => x.id === id);
    if (!n) return;
    if (!confirm("ต้องการลบโน้ตนี้ใช่ไหม?")) return;
    notes.splice(notes.indexOf(n), 1);
    saveFeedDataDebounced();
    renderNotes();
    updateChatInjection();
}

function memoNotifAvatar() {
    return `<div class="tinyfeed-avatar tinyfeed-avatar-anon" style="background:linear-gradient(135deg,#f59e0b,#d97706)"><i class="fa-solid fa-calendar-check"></i></div>`;
}
function bankScanNotifAvatar() {
    return `<div class="tinyfeed-avatar tinyfeed-avatar-anon" style="background:linear-gradient(135deg,#10b981,#047857)"><i class="fa-solid fa-scroll"></i></div>`;
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
            saveFeedDataDebounced();
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
            <span class="tinyfeed-forum-thread-share" data-id="${escapeAttr(t.id)}"><i class="fa-solid fa-share"></i> แชร์</span>
            ${(t.isUser || t.isAI) ? `<span class="tinyfeed-forum-thread-del" data-id="${escapeAttr(t.id)}"><i class="fa-solid fa-trash"></i> ลบ</span>` : ""}
        </div>
        <div class="tinyfeed-forum-count">ความคิดเห็น ${cnt} รายการ</div>
        ${comments || `<div class="tinyfeed-empty-sub" style="opacity:.6;padding:8px 0">ยังไม่มีความเห็น — ร่วมแสดงความเห็น หรือกดโหลดคอมเมนต์</div>`}
        <div class="tinyfeed-forum-tools" style="justify-content:center;margin-top:14px">
            <button class="tinyfeed-btn-generate tinyfeed-forum-loadmore" data-id="${escapeAttr(t.id)}">
                <i class="fa-solid fa-comments"></i> <span>โหลดคอมเมนต์เพิ่ม</span>
            </button>
            <input id="tinyfeed-forum-comment-guidance" class="tinyfeed-gen-guidance" type="text" placeholder="แนวทางคอมเมนต์รอบนี้ (ไม่บังคับ)" />
        </div>
    `);
}

// แนวทางคอมเมนต์กระทู้แบบครั้งเดียว (อ่านจากช่องในหน้าอ่านกระทู้ ถ้ามี) — คู่ขนานกับ commentGuidanceLine() ของฟีด
function forumCommentGuidanceLine() {
    const g = String($("#tinyfeed-forum-comment-guidance").val() || "").trim();
    return g ? ` แนวทางคอมเมนต์รอบนี้: ${g}.` : "";
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
    saveFeedDataDebounced();
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
    saveFeedDataDebounced();
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
    saveFeedDataDebounced();
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
    saveFeedDataDebounced();
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
    saveFeedDataDebounced();
    renderForumThread(tid);
    updateChatInjection();
}

function toggleForumThreadLike(id) {
    const t = getForum().find((x) => x.id === id);
    if (!t) return;
    t.liked = !t.liked;
    t.likes = (Number(t.likes) || 0) + (t.liked ? 1 : -1);
    saveFeedDataDebounced();
    renderForumThread(id);
}

function shareForumThread(id) {
    const t = getForum().find((x) => x.id === id);
    if (!t) return;
    openSharePicker({ kind: "forum", title: htmlToPlain(t.title), sub: `กระทู้จาก TinyForum · ${t.room}`, body: htmlToPlain(t.body).slice(0, 200), image: "", emoji: "💬" });
}

function toggleForumCommentLike(tid, cid, rid) {
    const t = getForum().find((x) => x.id === tid);
    const c = t && t.comments.find((x) => x.id === cid);
    if (!c) return;
    const target = rid ? (c.replies || []).find((x) => x.id === rid) : c;
    if (!target) return;
    target.liked = !target.liked;
    target.likes = (Number(target.likes) || 0) + (target.liked ? 1 : -1);
    saveFeedDataDebounced();
    renderForumThread(tid);
}

function deleteForumThread(id) {
    const forum = getForum();
    const t = forum.find((x) => x.id === id);
    if (!t || !(t.isUser || t.isAI)) return;
    if (!confirm("ต้องการลบกระทู้นี้ใช่ไหม?")) return;
    const i = forum.indexOf(t);
    forum.splice(i, 1);
    saveFeedDataDebounced();
    openForumList();
    updateChatInjection();
}

// ===== AI: ตั้งกระทู้ + โหลดคอมเมนต์ =====
function parseForumComments(raw, charName) {
    const s = stripReasoning(raw);
    const clean = (name) => cleanAiName(String(name || "")) || charName;
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
        // แนวทางเฉพาะกระทู้นี้ — ค่าชั่วคราวจาก DOM ไม่ใช่ setting (แพตเทิร์นเดียวกับ #tinyfeed-feed-guidance ของฟีด)
        const guidance = String($("#tinyfeed-forum-guidance").val() || "").trim();
        const q = buildPrompt("forumThread", {
            rooms: rooms.join(", "),
            roster: npcRosterLine(charName),
            extra: (extra ? `คำสั่งเพิ่มเติม: ${extra}. ` : "") + (guidance ? `แนวทางเฉพาะกระทู้นี้: ${guidance}. ` : ""),
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
        author = cleanAiName(author) || charName;
        const seeds = parseForumComments(s, charName).tops.slice(0, 6).map((c) => makeForumComment(c.author, c.text, charName));
        const thread = {
            id: forumId("ft"), room: escapeText(room), title: escapeHtml(title), body: escapeHtml(body || title),
            author, isAI: true, likes: randomInitialLikes(), liked: false, ts: Date.now(), comments: seeds,
        };
        getForum().unshift(thread);
        saveFeedDataDebounced();
        if (currentApp === "forum" && !isForumThreadOpen()) renderForumList();
        updateChatInjection();
        if (opts.notify) showNotif(makeAnonAvatar(thread.room), thread.room, htmlToPlain(thread.title), "list", "forum");
        $("#tinyfeed-forum-guidance").val("");   // ใช้ครั้งเดียวแล้วล้าง
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
            extra: (extra ? ` คำสั่งเพิ่มเติม: ${extra}.` : "") + forumCommentGuidanceLine() + galleryPromptBlock(),
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
            saveFeedDataDebounced();
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
let autoStoryCount = 0;  // ตัวนับข้อความสำหรับสตอรี่
let autoNewsCount = 0;   // ตัวนับข้อความสำหรับข่าว
let autoMemoCount = 0;   // ตัวนับข้อความสำหรับ TinyMemo
let autoForumCount = 0;  // ตัวนับข้อความสำหรับ TinyForum
let autoConnectCount = 0; // ตัวนับข้อความสำหรับ TinyConnect (คู่แชททักเอง)
let autoAskCount = 0;     // ตัวนับข้อความสำหรับ TinyAsk (คำถามนิรนามเข้ามาเอง)
let autoBankScanCount = 0; // ตัวนับข้อความสำหรับสแกนเงินจากบท RP (TinyBank)
let autoCallCount = 0;   // ตัวนับข้อความสำหรับโทรมาเอง (แยกจาก autoConnectCount ที่ทักข้อความ)
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
const KEYWORD_SETTING = { feed: "feedKeywords", news: "newsKeywords", memo: "memoKeywords", forum: "forumKeywords", connect: "connectKeywords", ask: "askKeywords", bank: "bankKeywords", call: "callKeywords", story: "storyKeywords" };
const kwCooldownAt = { feed: 0, news: 0, memo: 0, forum: 0, connect: 0, ask: 0, bank: 0, call: 0, story: 0 };

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

// ข้อความล่าสุดในบท RP หลัก (plain text "ชื่อ: ข้อความ" ต่อบรรทัด) — ใช้ป้อนเป็น {{recent}} ให้ prompt ที่ต้อง "อ่านบทจริง"
// ทำงานได้ทั้ง 2 API path: โหมดหลัก (ST แนบ context ให้เองอยู่แล้ว แต่ใส่ตรงนี้ซ้ำให้ AI โฟกัสจุดที่ต้องอ่านได้ตรง)
// และโหมด connection profile แยก (context ปกติคุมด้วย apiContextMessages คนละตัว — แต่ prompt นี้ต้องการเห็นบทจริงเสมอไม่ว่าจะเปิด context นั้นไว้หรือไม่)
function recentRpLines(n) {
    try {
        const ctx = getContext();
        if (!Array.isArray(ctx.chat) || !ctx.chat.length) return "";
        const count = Math.max(1, parseInt(n, 10) || 15);
        return ctx.chat.slice(-count).map((m) => `${m.name}: ${htmlToPlain(m.mes)}`).join("\n");
    } catch (e) {
        console.error(`[${extensionName}] recentRpLines failed:`, e);
        return "";
    }
}
// คืน true = เจอคีย์เวิร์ด (ในฝั่งที่เลือกจับ) + พ้น cooldown แล้ว (แล้วจับเวลา cooldown ใหม่)
// forceScope: ข้ามการตั้งค่า keywordScope กลาง บังคับขอบเขตของแอปนี้แอปเดียว (ใช้กับ "call" — ดูเหตุผลที่ onChatMessage)
function keywordShouldTrigger(app, forceScope) {
    const list = keywordListFor(app);
    if (!list.length) return false;
    const msg = lastRpMsg();
    if (!msg) return false;
    // ขอบเขตฝั่งที่จับ: char = เฉพาะข้อความตัวละคร, user = เฉพาะผู้ใช้, both = ทั้งคู่
    const scope = forceScope || getSetting("keywordScope") || "both";
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

// ตัดสินใจว่าควรมีคนโทรหาเราตอนนี้เลยไหม (โหมด "ai" ของทริกเกอร์โทรมาเองโดยเฉพาะ — ต่างจาก aiDecidesConnect ที่ถามแค่ "ทักข้อความ")
async function aiDecidesCall() {
    try {
        const q =
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง ไม่ต้องสวมบทบาท] ` +
            `พิจารณาสถานการณ์ล่าสุด: มีเหตุผลที่ตัวละครหรือคนรู้จักคนใดคนหนึ่งน่าจะ "โทรศัพท์" หาผู้ใช้ตอนนี้เลย (ไม่ใช่แค่ทักข้อความ เช่นมีเรื่องด่วน/อยากได้ยินเสียง) ไหม ` +
            `ถ้ามีตอบ YES ถ้ายังไม่มีตอบ NO ตอบคำเดียว: YES หรือ NO`;
        const res = await tinyGenerate(q, 120, "connect");
        const s = stripReasoning(res).toLowerCase();
        if (/\bno\b/.test(s) || s.includes("ไม่")) return false;
        if (/\byes\b/.test(s) || s.includes("ใช่") || s.includes("ควร")) return true;
        return false;
    } catch (e) {
        console.error(`[${extensionName}] aiDecidesCall failed:`, e);
        return false;
    }
}

// ตัดสินใจว่าควรมีคำถามนิรนามส่งเข้ากล่องคำถาม TinyAsk ตอนนี้ไหม (โหมด "ai")
async function aiDecidesAsk() {
    try {
        const q =
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง ไม่ต้องสวมบทบาท] ` +
            `พิจารณาสถานการณ์ล่าสุด: ตอนนี้เป็นจังหวะที่น่าจะมีคนส่งคำถามนิรนามเข้ากล่องคำถามของผู้ใช้ไหม ` +
            `ถ้าใช่ตอบ YES ถ้ายังไม่ใช่ตอบ NO ตอบคำเดียว: YES หรือ NO`;
        const res = await tinyGenerate(q, 120, "ask");
        const s = stripReasoning(res).toLowerCase();
        if (/\bno\b/.test(s) || s.includes("ไม่")) return false;
        if (/\byes\b/.test(s) || s.includes("ใช่") || s.includes("ควร")) return true;
        return false;
    } catch (e) {
        console.error(`[${extensionName}] aiDecidesAsk failed:`, e);
        return false;
    }
}

async function aiDecidesBank() {
    try {
        const q =
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง ไม่ต้องสวมบทบาท] ` +
            `พิจารณาบทล่าสุด: มีเหตุการณ์ที่ตัวละครได้รับเงิน/จ่ายเงิน/เสียเงินจริงๆ เกิดขึ้นไหม (ไม่ใช่แค่พูดถึงเงินลอยๆ) ` +
            `ถ้ามีตอบ YES ถ้าไม่มีตอบ NO ตอบคำเดียว: YES หรือ NO`;
        const res = await tinyGenerate(q, 120, "bank");
        const s = stripReasoning(res).toLowerCase();
        if (/\bno\b/.test(s) || s.includes("ไม่")) return false;
        if (/\byes\b/.test(s) || s.includes("ใช่") || s.includes("มี")) return true;
        return false;
    } catch (e) {
        console.error(`[${extensionName}] aiDecidesBank failed:`, e);
        return false;
    }
}

// isCharTurn: true = มาจาก MESSAGE_RECEIVED (ข้อความของตัวละครเพิ่งลงแชทแล้ว) · false = มาจาก MESSAGE_SENT (ข้อความของเราเอง)
// แอปที่ตั้ง charOnly:true (ดูรายการ apps ข้างล่าง) จะยิงได้เฉพาะตอน isCharTurn — กันแข่งกับการเจนคำตอบปกติของ
// เทิร์นนั้นที่ยังค้างอยู่พอดี (ยิงตอนเทิร์นผู้ใช้เอง = ต้องยกเลิกคำตอบที่กำลังเจนทิ้ง เสียโควตา input ไปฟรีๆ)
async function onChatMessage(isCharTurn) {
    // ข้อความที่เรายิงเข้าแชทหลักเอง (บันทึกการโทร) ไม่ใช่ RP จริง — กันวนกลับเข้า auto-generate/pet-mention ของตัวเอง
    if (isWritingCallLog) return;
    lastRpMsgTs = Date.now();   // มี RP activity → รีเซ็ตตัวจับเวลา idle
    petOnRpMessage();           // เอ่ยถึงเพ็ทในบท → ความผูกพันขึ้น (global, ไม่ขึ้นกับ auto)
    if (isAutoBusy || isGenerating || isGeneratingNews) return;
    if (!getCurrentCharacter()) return;

    // ลำดับความสำคัญ: ฟีด → เมโม → ฟอรัม → ข่าว (สร้างได้ทีละแอปต่อข้อความ กัน generate ซ้อน)
    const apps = [
        { on: "autoGenerate", mode: "autoGenerateMode", interval: "autoGenerateInterval", defInt: 10, kw: "feed",
            bump: () => ++autoMsgCount, get: () => autoMsgCount, reset: () => { autoMsgCount = 0; },
            decide: aiDecidesToPost, run: () => generateFeedPost({ notify: true, silent: true }) },
        { on: "storyAutoGenerate", mode: "storyAutoMode", interval: "storyAutoInterval", defInt: 14, kw: "story",
            bump: () => ++autoStoryCount, get: () => autoStoryCount, reset: () => { autoStoryCount = 0; },
            decide: aiDecidesToPost, run: () => generateStory({ notify: true, silent: true }) },
        { on: "connectAutoGenerate", mode: "connectAutoMode", interval: "connectAutoInterval", defInt: 12, kw: "connect",
            bump: () => ++autoConnectCount, get: () => autoConnectCount, reset: () => { autoConnectCount = 0; },
            // ถึงจังหวะทักแล้ว — สุ่มก่อนว่าจะ "โทรมา" แทนหรือเปล่า (มีสายอยู่แล้ว/ไม่เข้าเงื่อนไข = ทักข้อความตามปกติ)
            // การ "ทักข้อความ" ธรรมดายังยิงได้ทุกเทิร์นเหมือนเดิม — ที่ต้องกันเฉพาะฝั่งโทร (ส่ง isCharTurn เข้าไปเช็ค)
            decide: aiDecidesConnect, run: () => { if (!maybeCallInsteadOfDM(isCharTurn)) return proactiveDM(); } },
        // ทริกเกอร์โทรมาเองโดยเฉพาะ (แยกจากแถวข้างบนที่ทักข้อความเป็นหลัก) — คีย์เวิร์ด/AI ตัดสินใจ/ทุกกี่ข้อความ ของตัวเอง
        // charOnly:true — ยิงได้เฉพาะตอนเป็นเทิร์นตัวละคร (ดูคำอธิบาย isCharTurn ด้านบนฟังก์ชัน)
        { on: "callAutoGenerate", mode: "callAutoMode", interval: "callAutoInterval", defInt: 20, kw: "call",
            bump: () => ++autoCallCount, get: () => autoCallCount, reset: () => { autoCallCount = 0; },
            decide: aiDecidesCall, run: () => { triggerAutoCall(); }, charOnly: true },
        { on: "memoAutoGenerate", mode: "memoAutoMode", interval: "memoAutoInterval", defInt: 15, kw: "memo",
            bump: () => ++autoMemoCount, get: () => autoMemoCount, reset: () => { autoMemoCount = 0; },
            decide: aiDecidesMemo, run: () => scanMemo({ notify: true, silent: true }) },
        { on: "forumAutoGenerate", mode: "forumAutoMode", interval: "forumAutoInterval", defInt: 20, kw: "forum",
            bump: () => ++autoForumCount, get: () => autoForumCount, reset: () => { autoForumCount = 0; },
            decide: aiDecidesToPost, run: () => generateForumThread({ notify: true, silent: true }) },
        { on: "newsAutoGenerate", mode: "newsAutoMode", interval: "newsAutoInterval", defInt: 20, kw: "news",
            bump: () => ++autoNewsCount, get: () => autoNewsCount, reset: () => { autoNewsCount = 0; },
            decide: aiDecidesToPost, run: () => generateNews({ notify: true, silent: true }) },
        { on: "askAutoGenerate", mode: "askAutoMode", interval: "askAutoInterval", defInt: 18, kw: "ask",
            bump: () => ++autoAskCount, get: () => autoAskCount, reset: () => { autoAskCount = 0; },
            decide: aiDecidesAsk, run: () => generateAskQuestions({ notify: true, silent: true }) },
        { on: "bankScanAutoGenerate", mode: "bankScanAutoMode", interval: "bankScanAutoInterval", defInt: 15, kw: "bank",
            bump: () => ++autoBankScanCount, get: () => autoBankScanCount, reset: () => { autoBankScanCount = 0; },
            decide: aiDecidesBank, run: () => scanBankRp({ notify: true, silent: true }) },
    ];

    // นับตัวนับก่อน (เฉพาะโหมด interval/ai) — คงพฤติกรรมเดิมที่ทุกแอปนับทุกข้อความ
    for (const a of apps) {
        if (!getSetting(a.on)) continue;
        if ((getSetting(a.mode) || "interval") === "keyword") continue;
        a.bump();
    }

    for (const a of apps) {
        if (!getSetting(a.on)) continue;
        // charOnly (การโทรอัตโนมัติ) — ข้ามเทิร์นนี้ไปก่อนถ้ายังไม่ใช่เทิร์นตัวละคร ตัวนับ/threshold ยังไม่รีเซ็ต
        // (bump ไปแล้วด้านบน) รอบถัดไปที่เป็นเทิร์นตัวละครจะยิงทันทีถ้ายังถึงเกณฑ์อยู่
        if (a.charOnly && !isCharTurn) continue;
        const mode = getSetting(a.mode) || "interval";
        if (mode === "keyword") {
            if (!keywordShouldTrigger(a.kw, a.charOnly ? "char" : null)) continue;
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
    // สายกำลังเรียกเข้าอยู่ — หน้าจอสายคลุมทุกอย่างอยู่แล้ว ห้าม openApp() ต่อ เพราะมันเรียก closeOpenOverlays()
    // ซึ่งจะไปวางสายทิ้งทันที (ทะเบียน OVERLAYS ผูก #tinyfeed-call-screen ไว้กับ endCall)
    if (activeCall && !activeCall.answered) return;
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
    } else if (e.app === "ask") {
        openApp("ask");
        switchAskTab("inbox");
    } else if (e.app === "bank") {
        openApp("bank");
        openBankReviewModal();
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
    return isAutoBusy || isGenerating || isGeneratingNews || isConnectReplying || isGeneratingStream || isMemoBusy || isForumBusy || isBankScanBusy || isCallActive();
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

// สุ่มว่ารอบนี้จะ "โทรมา" แทนการทักข้อความปกติไหม — ใช้ร่วมกันทั้งทักเชิงรุก (proactiveTick) และทักตามจังหวะ RP
// (connectAutoGenerate ใน onChatMessage) ห้ามแยกก๊อปสองที่ (กฎเหล็กข้อ 1) · คืน true = จบแล้ว ไม่ต้องเรียก proactiveDM ต่อ
// (ทั้งกรณีเริ่มเรียกสายจริง และกรณีมีสายอยู่แล้ว — อย่างหลังกันข้อความทักซ้อนเข้าไปตอนสายกำลังเรียก/กำลังคุยอยู่)
// สุ่มคู่แชท 1:1 ที่โทรได้จริง 1 คน (ไม่ใช่กลุ่ม/ห้องเพ็ท) แล้วเริ่มเรียกสายเข้า — คืนผลจาก startIncomingCall() ตรงๆ
// ใช้ร่วมกันทั้ง maybeCallInsteadOfDM (สุ่มแทน DM) และ triggerAutoCall (ทริกเกอร์โทรมาเองโดยเฉพาะ) ห้ามแยกก๊อปสองที่
function callRandomContact() {
    const callableContacts = getConnectContacts().filter((c) => canCallThread(c.key));
    if (!callableContacts.length) return false;
    const c = callableContacts[Math.floor(Math.random() * callableContacts.length)];
    return startIncomingCall(c.key, c.name, Math.random() < 0.5 ? "video" : "voice");
}

// isCharTurn: ส่งมาจาก onChatMessage เท่านั้น (undefined จาก proactiveTick = ไม่เกี่ยว ปล่อยผ่าน — ทริกเกอร์พื้นหลัง
// ไม่ได้แข่งกับการเจนคำตอบของเทิร์นไหนโดยเฉพาะ) · false ตรงๆ (มาจากเทิร์นผู้ใช้เอง) เท่านั้นที่ห้าม — กันแข่งกับ
// การเจนคำตอบปกติของเทิร์นนั้นที่ยังค้างอยู่พอดี เสียโควตา input ไปฟรีๆ
function maybeCallInsteadOfDM(isCharTurn) {
    if (isCallActive()) return true;
    if (isCharTurn === false) return false;
    if (!getSetting("callAiCallEnabled")) return false;
    const chance = Math.max(0, Math.min(100, parseInt(getSetting("callProactiveChance"), 10) || 0));
    if (chance <= 0 || Math.random() * 100 >= chance) return false;
    return callRandomContact();
}

// ทริกเกอร์โทรมาเองโดยเฉพาะ (คีย์เวิร์ด/AI ตัดสินใจ/ทุกกี่ข้อความ ของตัวเอง) — คนละอันกับ maybeCallInsteadOfDM ที่สุ่มแทน DM ทักปกติ
function triggerAutoCall() {
    if (!getSetting("callAiCallEnabled") || isCallActive()) return;
    callRandomContact();
}

async function proactiveTick() {
    flushDueScheduled();   // เช็คข้อความตั้งเวลาทุกรอบ (ไม่ผูกกับ proactiveEnabled — งานคนละเรื่องกัน)
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
    // เลือก action จากสไตล์ที่เปิด: กลุ่มคุยกันเอง / โพสต์ฟีด / โทรมา / DM ทัก
    const groups = getSetting("groupAutoChat")
        ? getConnectGroups().filter((g) => (getThread("group:" + g.id) || []).length)
        : [];
    if (groups.length && Math.random() < 0.4) {
        await groupSelfChat("group:" + groups[Math.floor(Math.random() * groups.length)].id, { notify: true, silent: true });
    } else if (getSetting("proactiveViaFeed") && Math.random() < 0.5) {
        await generateFeedPost({ notify: true, silent: true });   // ทักผ่านฟีดแทน DM
    } else if (!maybeCallInsteadOfDM()) {
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
        .map((m) => `${m.from === "user" ? you : c.name}: ${connectMsgText(m)}`).join("\n");
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
    // คนที่ทักเราขึ้นมาเองแปลว่าอ่านข้อความล่าสุดของเราแล้ว (ข้ามห้องเพ็ท — ไม่มีสถานะอ่านแล้ว)
    if (c.key !== "pet" && getSetting("connectReadReceipts")) getConnectData().readUpTo[c.key] = Date.now();
    saveThread(c.key);   // เดิมเป็น saveFeedDataDebounced() ตรงๆ — ถ้า c.key เป็น "pet" ข้อความจะเซฟผิดที่ (เพ็ทเป็น global ต้อง savePet())
    if (!maybeStartConnectReveal(c.key, escapeHtml(reply)) && currentApp === "connect" && activeThread === c.key) renderThread();
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
        .map((m) => `${m.from === "user" ? you : (m.author || group.name)}: ${connectMsgText(m)}`).join("\n");
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
            saveFeedDataDebounced();
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
        saveFeedDataDebounced();
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
                <span class="tinyfeed-news-head-right">
                    <span class="tinyfeed-news-time">${displayTime(news)}</span>
                    <span class="tinyfeed-news-share" data-news="${news.id}" title="แชร์ข่าวนี้"><i class="fa-solid fa-share"></i></span>
                </span>
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
            { id: "homeLayout", name: "หน้าโฮม", icon: "fa-table-cells", desc: "เปิด/ปิด + จัดลำดับแอปบนหน้าโฮม" },
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
            { id: "cardSync", name: "ฝากไว้กับการ์ด", icon: "fa-id-card", desc: "ส่งออก/นำเข้าโปรไฟล์ + NPC พร้อมการ์ด" },
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
            { id: "story", name: "สตอรี่ & โน้ต", icon: "fa-circle-play", desc: "สตอรี่ 24 ชม. · โน้ตบนแถบสตอรี่ · คลัง" },
            { id: "comments", name: "คอมเมนต์", icon: "fa-comment", desc: "NPC มาคอมเมนต์ · ตอบกลับ" },
            { id: "news", name: "ข่าวสาร", icon: "fa-newspaper", desc: "ข่าวในโลกของเรื่อง" },
            { id: "connect", name: "TinyConnect", icon: "fa-comment-dots", desc: "แชต · สลิปโอนเงิน · ทักเอง · โทรเสียง/วิดีโอ" },
            { id: "stream", name: "TinyStream", icon: "fa-video", desc: "ไลฟ์ · คอมเมนต์สด · พื้นหลังเวที" },
            { id: "memo", name: "TinyMemo", icon: "fa-calendar-check", desc: "กำหนดการ + โน้ต" },
            { id: "forum", name: "TinyForum", icon: "fa-comments", desc: "กระทู้ · ห้อง · คอมเมนต์" },
            { id: "keywords", name: "ทริกเกอร์ด้วยคีย์เวิร์ด", icon: "fa-key", desc: "คำที่กระตุ้นให้แต่ละแอปทำงาน" },
            { id: "gallery", name: "TinyGallery", icon: "fa-images", desc: "อัลบั้มที่ AI มองเห็น" },
            { id: "shop", name: "TinyShop", icon: "fa-bag-shopping", desc: "หมวดสินค้า · prompt เสริม" },
            { id: "pet", name: "TinyPet", icon: "fa-paw", desc: "ค่าลด · สไปรต์ · เหรียญ · เกม" },
            { id: "ask", name: "TinyAsk", icon: "fa-circle-question", desc: "คำถามนิรนาม · ตอบอัตโนมัติ" },
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
    // ปุ่มธีมเฉพาะ persona — ต้องมาก่อน เพราะฟิลด์ข้างล่างทั้งหมดอ่านผ่าน themeValue() ตามสถานะนี้
    const personaName = getUserName();
    $("#tinyfeed-cfg-persona-theme-label").text(`ใช้ธีมเฉพาะของ persona นี้ (${personaName})`);
    $("#tinyfeed-cfg-persona-theme").prop("checked", personaThemeOn());
    $("#tinyfeed-persona-theme-tools").toggleClass("tinyfeed-hidden", !personaThemeOn());

    $("#tinyfeed-cfg-wallpaper").val(themeValue("wallpaperUrl") || "");
    updateUploadPreview($("#tinyfeed-cfg-wallpaper"));
    const wpo = parseInt(themeValue("wallpaperOverlay"), 10);
    $("#tinyfeed-cfg-wp-overlay").val(Number.isFinite(wpo) ? wpo : 45);
    $("#tinyfeed-wp-overlay-val").text(`${Number.isFinite(wpo) ? wpo : 45}%`);
    populateProfileSettings();

    // ปรับแต่งหน้าตา
    renderAccentSwatches();
    $("#tinyfeed-cfg-accent").val(String(themeValue("accentColor") || "").trim() || "#1d9bf0");
    const op = parseInt(themeValue("overlayOpacity"), 10);
    $("#tinyfeed-cfg-overlay").val(Number.isFinite(op) ? op : 50);
    $("#tinyfeed-overlay-val").text(`${Number.isFinite(op) ? op : 50}%`);
    $("#tinyfeed-cfg-themed-icons").prop("checked", Boolean(themeValue("themedIcons")));
    $("#tinyfeed-cfg-themed-home").prop("checked", Boolean(themeValue("themedHomeBg")));
    $("#tinyfeed-cfg-widget-clock").prop("checked", Boolean(getSetting("widgetClock")));
    $("#tinyfeed-cfg-widget-agenda").prop("checked", Boolean(getSetting("widgetAgenda")));
    $("#tinyfeed-cfg-widget-tokens").prop("checked", Boolean(getSetting("widgetTokens")));
    const wop = parseInt(themeValue("widgetOpacity"), 10);
    $("#tinyfeed-cfg-widget-opacity").val(Number.isFinite(wop) ? wop : 82);
    $("#tinyfeed-widget-opacity-val").text(`${Number.isFinite(wop) ? wop : 82}%`);
    $("#tinyfeed-cfg-customcss").val(themeValue("customCss") || "");


    $("#tinyfeed-cfg-likes-min").val(getSetting("likesMin"));
    $("#tinyfeed-cfg-likes-max").val(getSetting("likesMax"));
    $("#tinyfeed-cfg-history").val(getSetting("historyCount"));
    renderNpcList();

    // ฝากไว้กับการ์ด
    $("#tinyfeed-cfg-card-autoimport").prop("checked", Boolean(getSetting("cardAutoImport")));
    renderCardSyncStatus();

    $("#tinyfeed-cfg-auto").prop("checked", Boolean(getSetting("autoGenerate")));
    $("#tinyfeed-cfg-auto-mode").val(getSetting("autoGenerateMode") || "interval");
    // สตอรี่ & โน้ต
    $("#tinyfeed-cfg-story-enabled").prop("checked", Boolean(getSetting("storyEnabled")));
    $("#tinyfeed-cfg-story-ttl").val(getSetting("storyTtlHours"));
    $("#tinyfeed-cfg-story-max").val(getSetting("storyArchiveMax"));
    $("#tinyfeed-cfg-story-aicomment").prop("checked", Boolean(getSetting("storyAiComment")));
    $("#tinyfeed-cfg-story-aicount").val(getSetting("storyAiCommentCount"));
    $("#tinyfeed-cfg-story-dm").prop("checked", Boolean(getSetting("storyReplyToDm")));
    $("#tinyfeed-cfg-story-auto").prop("checked", Boolean(getSetting("storyAutoGenerate")));
    $("#tinyfeed-cfg-story-automode").val(getSetting("storyAutoMode") || "interval");
    $("#tinyfeed-cfg-story-interval").val(getSetting("storyAutoInterval"));
    $("#tinyfeed-cfg-story-tokens").val(getSetting("storyTokens"));
    $("#tinyfeed-cfg-story-extra").val(getSetting("storyExtraPrompt") || "");
    $("#tinyfeed-cfg-note-enabled").prop("checked", Boolean(getSetting("noteEnabled")));
    $("#tinyfeed-cfg-note-ttl").val(getSetting("noteTtlHours"));
    $("#tinyfeed-cfg-note-maxlen").val(getSetting("noteMaxLen"));
    $("#tinyfeed-cfg-interval").val(getSetting("autoGenerateInterval") || 10);
    $("#tinyfeed-cfg-comment-mode").val(getSetting("commentReplyMode") || "instant");
    $("#tinyfeed-cfg-initcomment-mode").val(getSetting("initialCommentMode") || "none");
    $("#tinyfeed-cfg-initcomment-count").val(getSetting("initialCommentCount") || 2);
    $("#tinyfeed-cfg-comment-tokens").val(getSetting("commentTokens") || 300);

    $("#tinyfeed-cfg-news-auto").prop("checked", Boolean(getSetting("newsAutoGenerate")));
    $("#tinyfeed-cfg-news-mode").val(getSetting("newsAutoMode") || "interval");
    $("#tinyfeed-cfg-news-interval").val(getSetting("newsAutoInterval") || 20);
    $("#tinyfeed-cfg-news-history").val(getSetting("newsHistoryCount"));
    $("#tinyfeed-cfg-notif").prop("checked", Boolean(getSetting("notificationsEnabled")));
    $("#tinyfeed-cfg-osnotif").prop("checked", Boolean(getSetting("osNotifEnabled")));
    renderHomeLayoutSettings();
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
    updateUploadPreview($("#tinyfeed-cfg-stream-bg"));
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
    $("#tinyfeed-cfg-connect-reveal").prop("checked", Boolean(getSetting("connectRevealSequential")));
    $("#tinyfeed-cfg-connect-reveal-delay").val(getSetting("connectRevealDelayMs"));
    $("#tinyfeed-cfg-connect-schedule").prop("checked", Boolean(getSetting("connectScheduleEnabled")));
    $("#tinyfeed-cfg-connect-schedule-max").val(getSetting("connectScheduleMaxHours"));
    $("#tinyfeed-cfg-connect-slip").prop("checked", Boolean(getSetting("connectSlipEnabled")));
    $("#tinyfeed-cfg-connect-gift").prop("checked", Boolean(getSetting("connectGiftEnabled")));
    $("#tinyfeed-cfg-connect-read").prop("checked", Boolean(getSetting("connectReadReceipts")));
    $("#tinyfeed-cfg-connect-read-chance").val(getSetting("connectReadOnlyChance"));
    $("#tinyfeed-connect-read-chance-val").text(`${parseInt(getSetting("connectReadOnlyChance"), 10) || 0}%`);
    populateConnectBubbleColorCfg();
    $("#tinyfeed-cfg-connect-timegap").val(getSetting("connectTimeGapMin") || 30);
    $("#tinyfeed-cfg-call-ai").prop("checked", Boolean(getSetting("callAiCallEnabled")));
    $("#tinyfeed-cfg-call-auto").prop("checked", Boolean(getSetting("callAutoGenerate")));
    $("#tinyfeed-cfg-call-mode").val(getSetting("callAutoMode") || "interval");
    $("#tinyfeed-cfg-call-interval").val(getSetting("callAutoInterval") || 20);
    $("#tinyfeed-cfg-call-chance").val(getSetting("callProactiveChance") || 0);
    $("#tinyfeed-call-chance-val").text(`${parseInt(getSetting("callProactiveChance"), 10) || 0}%`);
    $("#tinyfeed-cfg-call-ring").val(getSetting("callRingSec") || 30);
    $("#tinyfeed-cfg-call-outring").val(getSetting("callOutRingSec") || 8);
    $("#tinyfeed-cfg-call-answer").val(getSetting("callAnswerChance"));
    $("#tinyfeed-call-answer-val").text(`${getSetting("callAnswerChance")}%`);
    $("#tinyfeed-cfg-call-tokens").val(getSetting("callTokens"));
    $("#tinyfeed-cfg-call-extra").val(getSetting("callExtraPrompt"));
    $("#tinyfeed-cfg-call-ai-hangup").prop("checked", Boolean(getSetting("callAiHangupEnabled")));
    $("#tinyfeed-cfg-call-log").prop("checked", Boolean(getSetting("callLogToMainChat")));
    $("#tinyfeed-cfg-call-delmain").prop("checked", Boolean(getSetting("callDeleteAlsoMainChat")));

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
    $("#tinyfeed-cfg-inject-bag").prop("checked", Boolean(getSetting("injectBag")));
    $("#tinyfeed-cfg-inject-pet").prop("checked", Boolean(getSetting("injectPet")));
    $("#tinyfeed-cfg-inject-ask").prop("checked", Boolean(getSetting("injectAsk")));
    $("#tinyfeed-cfg-inject-story").prop("checked", Boolean(getSetting("injectStory")));

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
    $("#tinyfeed-cfg-pet-decay-hunger").val(getSetting("petDecayHunger"));
    $("#tinyfeed-cfg-pet-decay-energy").val(getSetting("petDecayEnergy"));
    $("#tinyfeed-cfg-pet-decay-clean").val(getSetting("petDecayClean"));
    $("#tinyfeed-cfg-pet-offline").val(getSetting("petOfflineCapHours"));
    $("#tinyfeed-cfg-pet-idlepause").val(getSetting("petIdlePauseMin"));
    $("#tinyfeed-cfg-pet-nodeath").prop("checked", Boolean(getSetting("petNoDeath")));
    $("#tinyfeed-cfg-pet-aicare").prop("checked", Boolean(getSetting("petAiCareEnabled")));
    $("#tinyfeed-cfg-pet-aicare-cooldown").val(getSetting("petAiCareCooldownMin"));
    $("#tinyfeed-cfg-pet-coinrate").val(getSetting("petCoinRate"));
    renderPetSpriteCfg();
    $("#tinyfeed-cfg-gallery-prompt").prop("checked", Boolean(getSetting("galleryPrompt")));
    $("#tinyfeed-cfg-gallery-scope").val(getSetting("galleryPromptScope") || "all");
    $("#tinyfeed-cfg-gallery-max-images").val(getSetting("galleryMaxImages"));
    $("#tinyfeed-cfg-gallery-max-stickers").val(getSetting("galleryMaxStickers"));
    galleryCfgPage = 0;
    renderGalleryCfgAlbums();
    populateCurrencySettings();
    $("#tinyfeed-cfg-donate-enabled").prop("checked", Boolean(getSetting("streamDonateEnabled")));
    $("#tinyfeed-cfg-bank-donate-max").val(getSetting("bankDonateMax"));
    renderDonateTiers();
    $("#tinyfeed-cfg-bankscan-auto").prop("checked", Boolean(getSetting("bankScanAutoGenerate")));
    $("#tinyfeed-cfg-bankscan-mode").val(getSetting("bankScanAutoMode") || "interval");
    $("#tinyfeed-cfg-bankscan-interval").val(getSetting("bankScanAutoInterval") || 15);
    $("#tinyfeed-cfg-bankscan-max").val(getSetting("bankRpMax"));
    $("#tinyfeed-cfg-bankscan-extra").val(getSetting("bankScanExtraPrompt"));
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
    $("#tinyfeed-cfg-crossapp-bag").prop("checked", Boolean(getSetting("crossAppBag")));
    $("#tinyfeed-cfg-crossapp-pet").prop("checked", Boolean(getSetting("crossAppPet")));
    $("#tinyfeed-cfg-crossapp-ask").prop("checked", Boolean(getSetting("crossAppAsk")));
    $("#tinyfeed-cfg-crossapp-story").prop("checked", Boolean(getSetting("crossAppStory")));
    $("#tinyfeed-cfg-crossapp-count").val(getSetting("crossAppCount"));

    $("#tinyfeed-cfg-ask-auto").prop("checked", Boolean(getSetting("askAutoGenerate")));
    $("#tinyfeed-cfg-ask-mode").val(getSetting("askAutoMode") || "interval");
    $("#tinyfeed-cfg-ask-interval").val(getSetting("askAutoInterval") || 18);
    $("#tinyfeed-cfg-ask-tokens").val(getSetting("askTokens"));
    $("#tinyfeed-cfg-ask-extra").val(getSetting("askExtraPrompt"));
    $("#tinyfeed-cfg-ask-reveal").prop("checked", Boolean(getSetting("askReveal")));
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
        field: { id: "tinyfeed-connect-input", multiline: true, placeholder: "พิมพ์ข้อความ... (ปล่อยว่างแล้วกด ✨ = ให้ตอบกลับ)" },
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
    // คุยสาย — ข้อความล้วน ไม่มีสติกเกอร์/เมนูเสริม (คุยโทรศัพท์ ไม่ใช่แชตข้อความ)
    $("#tinyfeed-call-compose").html(composeBarHtml({
        field: { id: "tinyfeed-call-input", placeholder: "พิมพ์สิ่งที่จะพูด..." },
        send: { id: "tinyfeed-call-send", title: "พูด" },
    }));
}

// แถบเขียนคอมเมนต์ใต้โพสต์ — ใช้ร่วมกันหลายแอป (ต่างกันแค่ชื่อ data + คลาสปุ่ม)
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
        // มาโคร "@user" ในไบโอ/สตอรี่/โน้ต → ชื่อ persona ปัจจุบัน (src/util.js import จากไฟล์นี้ไม่ได้ จึงฉีดเข้าไป)
        setMentionUserResolver(getUserName);

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
            // สลับแชท ST ระหว่างคุยสาย = อีเวนต์นี้ยิงหลังสลับไปแล้ว เขียน record ตอนนี้จะผิดแชท ทิ้งสถานะสายไปเงียบๆ
            if (isCallActive()) abortActiveCall();
            clearConnectReveal();
            flushDueScheduled();
            autoMsgCount = 0;   // เริ่มนับใหม่ตามแชทที่เปิด
            autoStoryCount = 0;
            autoNewsCount = 0;
            autoMemoCount = 0;
            autoForumCount = 0;
            autoConnectCount = 0;
            autoAskCount = 0;
            autoBankScanCount = 0;
            autoCallCount = 0;
            renderFeed();
            renderNews();
            if (isSettingsOpen()) populateSettings();   // อัปเดตชื่อ/ลิงก์รูปตัวละครตามแชทใหม่
            if (currentApp === "connect") openConnectList();   // contact/แชตเปลี่ยนตามแชท
            if (currentApp === "stream") { clearStreamTimer(); renderStream(); maybeStartStreamTimer(); }
            if (currentApp === "memo") switchMemoTab(memoTab);   // กำหนดการ/โน้ตเปลี่ยนตามแชท
            if (currentApp === "forum") openForumList();   // กระทู้เปลี่ยนตามแชท
            if (currentApp === "ask") switchAskTab(askTab);   // คำถาม-คำตอบเปลี่ยนตามแชท
            if (isProfileOpen()) closeProfileScreen();   // ตัวตนเปลี่ยนตามแชท โปรไฟล์ที่เปิดค้างอาจเป็นคนละคน
            if (!$("#tinyfeed-story-viewer").hasClass("tinyfeed-hidden")) closeStoryViewer();
            applyAllTheming();   // สลับแชทอาจสลับ persona ไปด้วย (ธีมผูกกับ persona)
            maybeNoticeCardPayload();   // การ์ดตัวละครใหม่อาจมีโปรไฟล์ TinyPhone ติดมา
            console.log(`[${extensionName}] Chat changed, feed reloaded`);
        });

        // persona เปลี่ยน (สลับ/แก้ไข) โดยไม่ได้สลับแชท — themeValue()/getUserAvatar() คำนวณสดอยู่แล้ว
        // จุดนี้แค่ "สั่งวาดใหม่" ให้ทันตา ไม่งั้นต้องรอ render รอบถัดไปโดยบังเอิญถึงจะเห็นธีม/ชื่อที่ถูกต้อง
        const onPersonaChanged = () => {
            applyAllTheming();
            if (currentApp === "feed") renderStoryBar();
            if (isSettingsOpen()) populateSettings();
            if (isProfileOpen() && profileCtx && profileCtx.kind === "user") renderProfileScreen();
        };
        if (context.eventTypes.PERSONA_CHANGED) context.eventSource.on(context.eventTypes.PERSONA_CHANGED, onPersonaChanged);
        if (context.eventTypes.PERSONA_UPDATED) context.eventSource.on(context.eventTypes.PERSONA_UPDATED, onPersonaChanged);

        // แท็บถูกซ่อน (สลับแอปบนมือถือ/สลับแท็บ) = โอกาสสุดท้ายที่จะเซฟก่อนเบราว์เซอร์แช่แข็ง/เคลียร์แท็บทิ้ง
        // เซฟแบบ debounce ที่ค้างอยู่พอดี (ทั้ง settings + chat metadata) ถ้ายิงไม่ทันจะหายไปเลย ไม่มี error ให้เห็น
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden") flushAllSaves();
        });

        // Stage 7: นับข้อความในแชทเพื่อ auto-generate
        context.eventSource.on(context.eventTypes.MESSAGE_SENT, () => onChatMessage(false));
        context.eventSource.on(context.eventTypes.MESSAGE_RECEIVED, () => onChatMessage(true));
        // สายเข้า/สายที่โทรออกเองอาจแข่งกับการเจนคำตอบในแชทหลักที่พึ่งเริ่ม (คนละจังหวะกับตอนเรียก
        // interruptMainChatGeneration ใน openCall/startIncomingCall เอง — จุดนั้นกันกรณีมีเจนค้างอยู่ก่อนแล้ว
        // ส่วนตัวนี้กันกรณีเจนเพิ่งเริ่มหลังจากนั้น) ไม่งั้นจะได้ทั้งคุยสายจริงในโทรศัพท์ และคำบรรยายฉากโทรศัพท์
        // อีกชุดโผล่ในแชทหลักหลังวางสายไปแล้ว
        context.eventSource.on(context.eventTypes.GENERATION_STARTED, () => {
            if (!isCallActive()) return;
            interruptMainChatGeneration(getContext());
            // GENERATION_STARTED ยิงตอนเริ่มฟังก์ชัน Generate() ก่อน abortController/streamingProcessor ตัวจริงของ
            // รอบนี้จะถูกสร้าง (สร้างอีกไม่กี่บรรทัดถัดไปในนั้น) เรียกซ้ำอีกทีถัดจากนี้ 1 tick ให้ชัวร์ว่าจับตัวจริงทัน
            setTimeout(() => { if (isCallActive()) interruptMainChatGeneration(getContext()); }, 0);
        });

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

        // ===== ธีมผูกกับ persona =====
        $(document).on("change", "#tinyfeed-cfg-persona-theme", function () {
            togglePersonaTheme($(this).prop("checked"));
        });
        $(document).on("click", "#tinyfeed-persona-theme-copy", copyGlobalThemeToPersona);
        $(document).on("click", "#tinyfeed-persona-theme-clear", clearPersonaTheme);

        // ===== ปรับแต่งหน้าตา (Appearance) =====
        $(document).on("click", ".tinyfeed-accent-swatch", function () {
            setThemeValue("accentColor", $(this).data("color"));
            setThemeValue("homeBgHue", parseInt($(this).data("hue"), 10) || 210);
            $("#tinyfeed-cfg-accent").val($(this).data("color"));
            applyAppearance();
            applyWallpaper();
            renderAccentSwatches();
        });
        $(document).on("input", "#tinyfeed-cfg-accent", function () {
            setThemeValue("accentColor", $(this).val());
            applyAppearance();
            renderAccentSwatches();
        });
        $(document).on("click", "#tinyfeed-accent-reset", function () {
            setThemeValue("accentColor", "");
            $("#tinyfeed-cfg-accent").val("#1d9bf0");
            applyAppearance();
            renderAccentSwatches();
        });
        $(document).on("input", "#tinyfeed-cfg-overlay", function () {
            let v = parseInt($(this).val(), 10);
            if (!Number.isFinite(v)) v = 50;
            setThemeValue("overlayOpacity", v);
            $("#tinyfeed-overlay-val").text(`${v}%`);
            applyAppearance();
        });
        $(document).on("change", "#tinyfeed-cfg-themed-icons", function () {
            setThemeValue("themedIcons", $(this).prop("checked"));
            applyAppearance();
        });
        $(document).on("change", "#tinyfeed-cfg-themed-home", function () {
            setThemeValue("themedHomeBg", $(this).prop("checked"));
            applyAppearance();
            applyWallpaper();
        });
        $(document).on("click", "#tinyfeed-home-randomize", function () {
            setThemeValue("homeBgHue", Math.floor(Math.random() * 360));
            setThemeValue("themedHomeBg", true);
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
            setThemeValue("widgetOpacity", v);
            $("#tinyfeed-widget-opacity-val").text(`${v}%`);
            applyAppearance();
        });
        $(document).on("input", "#tinyfeed-cfg-customcss", function () {
            setThemeValue("customCss", $(this).val());
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
        // ตั้ง/แก้ชื่อ+รูปกลุ่มเดิม
        $(document).on("click", ".tinyfeed-group-edit", function (e) {
            e.stopPropagation();
            openGroupEditModal($(this).data("key"));
        });
        $(document).on("click", "#tinyfeed-group-edit-save", saveGroupEdit);
        $(document).on("click", "#tinyfeed-group-edit-cancel, #tinyfeed-group-edit-close", closeGroupEditModal);
        $(document).on("click", "#tinyfeed-group-edit-modal", function (e) { if (e.target === this) closeGroupEditModal(); });
        // ลบบับเบิลแชท
        $(document).on("click", ".tinyfeed-msg-del", function (e) {
            e.stopPropagation();
            deleteConnectMessage(parseInt($(this).data("idx"), 10));
        });
        // ปุ่มมอร์ฟ: มีข้อความ = ส่ง · ว่าง = ให้ตอบกลับ/ให้กลุ่มคุยต่อ (ดู updateConnectSendBtn) · กำลังตอบอยู่ = ไม่ทำอะไร
        $(document).on("click", "#tinyfeed-connect-send", function () {
            if (isConnectReplying || !activeThread) return;
            const text = $("#tinyfeed-connect-input").val();
            if (String(text || "").trim()) { sendConnectMessage(text); return; }
            if (activeThread === "pet") return;   // ห้องเพ็ทไม่มี AI ตอบ — ปุ่มถูกซ่อนอยู่แล้ว
            if (findGroup(activeThread)) groupSelfChat(activeThread, {});
            else generateConnectReply();
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
            updateConnectSendBtn();
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
        $(document).on("click", ".tinyfeed-forum-thread-share", function () {
            shareForumThread($(this).data("id"));
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
        // สแกนบท RP หาเงิน — มีรายการรอรีวิวค้างอยู่แล้ว = เปิดหน้ารีวิวเลย ไม่งั้นสแกนใหม่
        $(document).on("click", "#tinyfeed-bankscan-btn", function () {
            const pending = getBankData().pending || [];
            if (pending.length) openBankReviewModal();
            else scanBankRp({ manual: true, silent: false });
        });
        $(document).on("click", "#tinyfeed-bank-review-close", closeBankReviewModal);
        $(document).on("click", "#tinyfeed-bank-review-modal", function (e) { if (e.target === this) closeBankReviewModal(); });
        $(document).on("click", "#tinyfeed-bank-review-apply", applyBankReviewSelected);
        $(document).on("click", "#tinyfeed-bank-review-reject", rejectBankReviewAll);

        // ===== TinyShop: เพิ่ม/ซื้อ/ลบสินค้า =====
        $(document).on("click", "#tinyfeed-shop-add", addShopItem);
        $(document).on("click", "#tinyfeed-shop-generate", function () { generateShopItems(); });
        $(document).on("click", ".tinyfeed-shop-buy", function () { buyShopItem(String($(this).data("id"))); });
        $(document).on("click", ".tinyfeed-shop-gift", function (e) {
            e.stopPropagation();
            buyGiftShopItem(String($(this).closest(".tinyfeed-shop-item").data("id")));
        });
        $(document).on("click", ".tinyfeed-shop-share", function (e) {
            e.stopPropagation();
            shareShopItem(String($(this).data("id")));
        });
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

        // ===== TinyBag: ใช้/ส่งของขวัญ/ทิ้งของในกระเป๋า =====
        $(document).on("click", ".tinyfeed-bag-use", function (e) {
            e.stopPropagation();
            useBagItem(String($(this).data("id")));
        });
        $(document).on("click", ".tinyfeed-bag-gift", function (e) {
            e.stopPropagation();
            giftBagItem(String($(this).data("id")));
        });
        $(document).on("click", ".tinyfeed-bag-discard", function (e) {
            e.stopPropagation();
            discardBagItem(String($(this).data("id")));
        });

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

        // ===== TinyFeed: สตอรี่ + โน้ตบนแถบสตอรี่ =====
        $(document).on("click", ".tinyfeed-story-genchip", function () { generateStory({ notify: false }); });
        $(document).on("click", ".tinyfeed-story-archive-chip", openStoryArchive);
        $(document).on("click", ".tinyfeed-story-item[data-owner] .tinyfeed-story-ava", function (e) {
            e.stopPropagation();
            const key = String($(this).data("owner"));
            const owner = storyOwners().find((o) => o.key === key);
            if (owner && owner.stories.length) openStoryViewer(key, null);
            else if (key === "user") openStoryCompose();
            else openProfileScreen(key === "main" ? "main" : key);
        });
        $(document).on("click", ".tinyfeed-storynote-bubble[data-owner]", function (e) {
            e.stopPropagation();
            const key = String($(this).data("owner"));
            if (key === "user") openStoryNoteEdit(); else openStoryNoteView(key);
        });
        $(document).on("click", ".tinyfeed-story-archive-cell[data-story]", function () {
            const st = findStory(String($(this).data("story")));
            if (!st) return;
            const list = expiredStories().filter((x) => x.ownerKey === st.ownerKey);
            openStoryViewer(st.ownerKey, list.findIndex((x) => x.id === st.id), { archive: true });
        });
        // หน้าดูสตอรี่
        $(document).on("click", "#tinyfeed-story-close", closeStoryViewer);
        $(document).on("click", "#tinyfeed-story-viewer .tinyfeed-story-nav[data-dir]", function () {
            if ($(this).data("dir") === "prev") storyViewerPrev(); else storyViewerNext();
        });
        $(document).on("click", "#tinyfeed-story-del", function () {
            if (storyViewCtx) deleteStory(storyViewCtx.ids[storyViewCtx.idx]);
        });
        $(document).on("click", "#tinyfeed-story-pin", function () {
            if (storyViewCtx) pinStoryToHighlight(storyViewCtx.ids[storyViewCtx.idx]);
        });
        $(document).on("click", "#tinyfeed-story-ai-comment", function () {
            if (storyViewCtx) generateStoryComments(storyViewCtx.ids[storyViewCtx.idx], { silent: false });
        });
        $(document).on("click", "#tinyfeed-story-reply-send", function () {
            if (!storyViewCtx) return;
            const input = $("#tinyfeed-story-reply-input");
            sendStoryReply(storyViewCtx.ids[storyViewCtx.idx], input.val());
            input.val("");
        });
        $(document).on("keydown", "#tinyfeed-story-reply-input", function (e) {
            if (e.key === "Enter") { e.preventDefault(); $("#tinyfeed-story-reply-send").trigger("click"); }
        });
        // เขียนสตอรี่
        $(document).on("click", "#tinyfeed-story-compose-close, #tinyfeed-story-compose-cancel", closeStoryCompose);
        $(document).on("click", "#tinyfeed-story-pickimg", pickStoryImage);
        $(document).on("click", "#tinyfeed-story-addtext", addStoryText);
        $(document).on("click", "#tinyfeed-story-compose-save", saveStoryFromCompose);
        // ลากข้อความบนรูป (pointer events ใช้ได้ทั้งเมาส์และนิ้ว) — แตะเฉยๆ = เปิดหน้าต่างแก้ข้อความ
        $(document).on("pointerdown", "#tinyfeed-story-compose-canvas .tinyfeed-story-text-draggable", function (e) {
            e.preventDefault();
            storyDragStart(e.originalEvent || e, this);
        });
        $(document).on("pointermove", function (e) { if (storyDragState) storyDragMove(e.originalEvent || e); });
        $(document).on("pointerup pointercancel", function () { if (storyDragState) storyDragEnd(); });
        // แก้ข้อความบนสตอรี่
        $(document).on("click", "#tinyfeed-story-text-close", closeStoryTextEdit);
        $(document).on("click", "#tinyfeed-story-text-save", saveStoryTextEdit);
        $(document).on("click", "#tinyfeed-story-text-del", deleteStoryText);
        // โน้ต
        $(document).on("click", "#tinyfeed-storynote-close", closeStoryNoteEdit);
        $(document).on("click", "#tinyfeed-storynote-save", saveStoryNote);
        $(document).on("click", "#tinyfeed-storynote-del", deleteStoryNote);
        $(document).on("click", "#tinyfeed-storynote-view-close", closeStoryNoteView);
        $(document).on("click", "#tinyfeed-storynote-reply", function () {
            if (storyNoteViewKey) replyToNoteInConnect(storyNoteViewKey, "");
        });
        $(document).on("click", ".tinyfeed-storynote-emoji", function () {
            if (storyNoteViewKey) replyToNoteInConnect(storyNoteViewKey, String($(this).data("emo") || ""));
        });
        $(document).on("click", "#tinyfeed-connect-quote-close", cancelConnectQuote);
        $(document).on("click", "#tinyfeed-story-gennote", function () { generateStoryNote("", { silent: false }); });

        // ===== หน้าโปรไฟล์ =====
        // ทางเข้าเดียวของทั้งเครื่อง: อะไรก็ตามที่มีคลาส .tinyfeed-profile-open + data-author
        // ★ stopPropagation จำเป็น — ของเดิมไม่มี ทำให้แตะชื่อแล้วเปิดทั้งโปรไฟล์และหน้ารายละเอียดโพสต์ซ้อนกัน
        $(document).on("click", ".tinyfeed-profile-open", function (e) {
            e.stopPropagation();
            openProfileScreen(String($(this).data("author") || ""));
        });
        $(document).on("click", "#tinyfeed-profile-screen .tinyfeed-tab[data-ptab]", function () {
            switchProfileTab($(this).data("ptab"));
        });
        $(document).on("click", ".tinyfeed-profile-cell[data-ppost], .tinyfeed-profile-tl[data-ppost]", function () {
            openProfilePost(String($(this).data("ppost")));
        });
        $(document).on("click", ".tinyfeed-profile-hl[data-hl]", function () {
            openProfileHighlight(String($(this).data("hl")));
        });
        $(document).on("click", "#tinyfeed-profile-post-close", closeProfilePost);
        $(document).on("click", "#tinyfeed-profile-post", function (e) { if (e.target === this) closeProfilePost(); });
        $(document).on("click", "#tinyfeed-profile-edit-btn", openProfileEdit);
        $(document).on("click", "#tinyfeed-profile-dm", function () {
            if (profileCtx) openConnectThreadFor(profileCtx.ownerKey, "");
        });
        $(document).on("click", "#tinyfeed-profile-export", exportProfilesToCard);
        $(document).on("click", "#tinyfeed-profile-edit-close, #tinyfeed-profile-edit-cancel", closeProfileEdit);
        $(document).on("click", "#tinyfeed-profile-edit-save", saveProfileEdit);
        $(document).on("click", "#tinyfeed-pe-addpost", profileAddPost);
        $(document).on("click", "#tinyfeed-pe-addhl", profileAddHighlight);
        $(document).on("click", "#tinyfeed-pe-posts .tinyfeed-pe-del", function (e) {
            e.stopPropagation();
            profileDelPost(String($(this).closest(".tinyfeed-pe-row").data("pp")));
        });
        $(document).on("click", "#tinyfeed-pe-hls .tinyfeed-pe-hldel", function (e) {
            e.stopPropagation();
            profileDelHighlight(String($(this).closest(".tinyfeed-pe-row").data("ph")));
        });
        // พิมพ์ลิงก์รูปแล้วให้ thumbnail อัปเดตตาม (ไม่ต้องกดบันทึกก่อน)
        $(document).on("input", "#tinyfeed-pe-posts .tinyfeed-pe-url, #tinyfeed-pe-hls .tinyfeed-pe-hlcover", function () {
            const url = String($(this).val() || "").trim();
            const thumb = $(this).closest(".tinyfeed-pe-row").find(".tinyfeed-pe-thumb");
            let img = thumb.find("img");
            if (!img.length) { thumb.empty().append("<img alt='' />"); img = thumb.find("img"); }
            setImgSrcSafe(img, url);
        });
        $(document).on("click", "#tinyfeed-pet-speak", function () { petReact("", { silent: false }); });
        $(document).on("click", "#tinyfeed-pet-post", function () { petPostToFeed({ notify: false, silent: false }); });
        $(document).on("click", "#tinyfeed-pet-share", sharePetStatus);
        $(document).on("click", "#tinyfeed-pet-adopt", function () { petAdopt($("#tinyfeed-pet-name-input").val()); });
        $(document).on("keydown", "#tinyfeed-pet-name-input", function (e) {
            if (e.key === "Enter") { e.preventDefault(); petAdopt($(this).val()); }
        });
        $(document).on("click", "#tinyfeed-pet-adopt-new", petAdoptNew);
        $(document).on("click", "#tinyfeed-pet-revive", petRevive);

        // ===== TinyAsk: ถาม-ตอบนิรนาม =====
        $(document).on("click", ".tinyfeed-tab[data-asktab]", function () {
            switchAskTab(String($(this).data("asktab")));
        });
        $(document).on("click", "#tinyfeed-ask-generate", function () { generateAskQuestions({ notify: false, silent: false }); });
        $(document).on("click", "#tinyfeed-ask-pair-roll", openAskPairPicker);
        $(document).on("click", "#tinyfeed-ask-new", openAskSendModal);
        $(document).on("click", "#tinyfeed-ask-send-close, #tinyfeed-ask-send-cancel", closeAskSendModal);
        $(document).on("click", "#tinyfeed-ask-send-modal", function (e) { if (e.target === this) closeAskSendModal(); });
        $(document).on("click", "#tinyfeed-ask-draft-roll", generateAskDraft);
        $(document).on("click", "#tinyfeed-ask-send-submit", sendAskQuestion);
        $(document).on("click", ".tinyfeed-ask-answer-btn", function () {
            const id = String($(this).data("id"));
            const text = $(this).closest(".tinyfeed-ask-card").find(".tinyfeed-ask-answer-input").val();
            answerAskQuestion(id, text);
        });
        $(document).on("keydown", ".tinyfeed-ask-answer-input", function (e) {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                answerAskQuestion(String($(this).closest(".tinyfeed-ask-card").data("id")), $(this).val());
            }
        });
        $(document).on("click", ".tinyfeed-ask-del", function (e) {
            e.stopPropagation();
            if (!confirm("ลบคำถามนี้?")) return;
            deleteAskQuestion(String($(this).data("id")));
        });
        $(document).on("click", ".tinyfeed-ask-reveal", function (e) {
            e.stopPropagation();
            revealAskAsker(String($(this).data("id")));
        });
        $(document).on("click", ".tinyfeed-ask-like", function (e) {
            e.stopPropagation();
            toggleAskLike(String($(this).data("id")));
        });
        $(document).on("click", ".tinyfeed-ask-getanswer", function () {
            generateAskAnswer(String($(this).data("id")));
        });

        // ===== อัปโหลดรูปจากเครื่อง — ปุ่มเดียวใช้ได้ทุกช่อง (คลิก → เลือกไฟล์ → ย่อ → อัปโหลด → เติมค่าลง input) =====
        $(document).on("click", ".tinyfeed-upload-btn", function () {
            uploadTarget = { $input: $(this).closest(".tinyfeed-uploadrow").find("input").first() };
            $("#tinyfeed-file-input").val("").data("kind", $(this).data("kind")).trigger("click");
        });
        $(document).on("change", "#tinyfeed-file-input", async function () {
            const file = this.files && this.files[0];
            const kind = String($(this).data("kind") || "image");
            const target = uploadTarget;
            if (!file || !target || !target.$input.length) return;
            const $btn = target.$input.closest(".tinyfeed-uploadrow").find(".tinyfeed-upload-btn");
            $btn.addClass("tinyfeed-generating").find("i").removeClass("fa-upload").addClass("fa-spinner fa-spin");
            try {
                const path = await uploadTinyImage(file, kind);
                target.$input.val(path).trigger("input").trigger("change");
                toastr.success("อัปโหลดรูปแล้ว", "TinyPhone");
            } catch (e) {
                console.error(`[${extensionName}] uploadTinyImage failed:`, e);
                toastr.error(e && e.message ? e.message : "อัปโหลดรูปไม่สำเร็จ ลองใหม่นะ", "TinyPhone");
            } finally {
                $btn.removeClass("tinyfeed-generating").find("i").removeClass("fa-spinner fa-spin").addClass("fa-upload");
                uploadTarget = null;
            }
        });
        // พิมพ์ลิงก์เอง หรือ path ที่อัปโหลดเสร็จ (trigger("input") ด้านบน) → อัปเดตพรีวิวสด
        $(document).on("input", ".tinyfeed-uploadrow input", function () { updateUploadPreview($(this)); });

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
        // ===== TinyConnect: การโทร ===== (เปิดสายมาจาก CONNECT_PLUS_ACTIONS.run() — จัดการปิดเมนู (+) ในตัวอยู่แล้ว)
        // ผูกตรงไม่ได้ — endCall(status) รับ arg แล้ว, click handler ของ jQuery จะยัด event object เข้าไปเป็น status ทันที
        $(document).on("click", "#tinyfeed-call-hangup", function () {
            // ระหว่างรอฝั่งโน้นรับสาย (เรายังไม่ต่อติด) กดปุ่มนี้ = "ยกเลิก" ไม่ใช่ "วางสาย"
            if (activeCall && !activeCall.answered && activeCall.dir === "out") endCall("cancelled");
            else endCall();
        });
        $(document).on("click", "#tinyfeed-call-accept", acceptCall);
        $(document).on("click", "#tinyfeed-call-decline", declineCall);
        $(document).on("click", "#tinyfeed-call-expand", toggleCallTranscript);
        $(document).on("click", "#tinyfeed-call-send", function () {
            sendCallMessage($("#tinyfeed-call-input").val());
        });
        $(document).on("keydown", "#tinyfeed-call-input", function (e) {
            if (e.key === "Enter") {
                e.preventDefault();
                sendCallMessage($(this).val());
            }
        });
        // แท็บแชต/ประวัติการโทร — จำกัดด้วย [data-ctab] เสมอ (กันชน .tinyfeed-tab ของแอปอื่น)
        $(document).on("click", ".tinyfeed-tab[data-ctab]", function () {
            switchConnectTab($(this).data("ctab"));
        });
        // แถวประวัติการโทร: แตะแถว = ดูบทเต็ม · ปุ่มโทรกลับ = โทรกลับตรงๆ (ต้อง stopPropagation กันเด้งเข้ารายละเอียดด้วย)
        $(document).on("click", ".tinyfeed-call-hist-item", function () {
            openCallDetail($(this).data("call-id"));
        });
        $(document).on("click", ".tinyfeed-call-hist-callback", function (e) {
            e.stopPropagation();
            const key = $(this).data("key"), name = $(this).data("name"), kind = $(this).data("kind");
            if (!canCallThread(key)) { toastr.info("โทรหาคนนี้ไม่ได้แล้ว (อาจถูกลบ/เป็นกลุ่ม)", "TinyConnect"); return; }
            openCall(key, name, kind);
        });
        $(document).on("click", ".tinyfeed-call-hist-del", function (e) {
            e.stopPropagation();   // แถวเปิด detail อยู่ ต้องกันไม่ให้เด้งเข้าหน้ารายละเอียดด้วย
            deleteCallRecord(String($(this).data("id")));
        });
        $(document).on("click", "#tinyfeed-call-clearall", function (e) {
            e.stopPropagation();
            clearAllCallHistory();
        });
        $(document).on("click", "#tinyfeed-call-detail-del", function () {
            if (callDetailId) deleteCallRecord(callDetailId);
        });
        // การ์ดโทรในเธรด: แตะแล้วดูบทเต็มได้เฉพาะสายที่มีบทสนทนาจริง (callCardHtml ใส่คลาสนี้ให้เฉพาะตอนมี turns)
        $(document).on("click", ".tinyfeed-call-card-clickable", function () {
            openCallDetail($(this).data("call-id"));
        });
        $(document).on("click", "#tinyfeed-call-detail-close", closeCallDetail);
        $(document).on("click", "#tinyfeed-call-detail-modal", function (e) {
            if (e.target === this) closeCallDetail();
        });
        // แท็บ "ไฟล์ทั้งหมด" — ใช้ lightbox #tinyfeed-gallery-view ตัวเดียวกัน แต่คนละ handler (scope เฉพาะในกริดนี้
        // กัน handler .tinyfeed-gallery-item .tinyfeed-gallery-thumb ด้านบนชนกัน — ตัวนั้นยิงด้วยแต่ no-op เพราะไม่มี data-kind/id)
        $(document).on("click", "#tinyfeed-gallery-files-grid .tinyfeed-gallery-thumb", function () {
            openFileView($(this).closest(".tinyfeed-gallery-item").data("url"));
        });
        $(document).on("click", ".tinyfeed-gallery-file-del", function (e) {
            e.stopPropagation();
            deleteOneTinyFile($(this).closest(".tinyfeed-gallery-item").data("url"));
        });
        $(document).on("click", "#tinyfeed-gallery-files-refresh", function () { renderGalleryFiles(); });
        $(document).on("click", "#tinyfeed-gallery-files-cleanup", cleanupOrphanTinyFiles);
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
        $(document).on("click", "#tinyfeed-connect-sched-close", closeConnectSchedModal);
        $(document).on("click", "#tinyfeed-connect-sched", function (e) { if (e.target === this) closeConnectSchedModal(); });
        $(document).on("click", ".tinyfeed-sched-del", function () {
            cancelScheduledMessage(String($(this).closest(".tinyfeed-sched-row").data("id")));
        });
        $(document).on("click", "#tinyfeed-slip-close", closeSlipModal);
        $(document).on("click", "#tinyfeed-slip-modal", function (e) { if (e.target === this) closeSlipModal(); });
        $(document).on("click", "#tinyfeed-slip-send", sendUserSlip);
        $(document).on("click", "#tinyfeed-connect-bg-close", closeConnectBgModal);
        $(document).on("click", "#tinyfeed-connect-bg-modal", function (e) { if (e.target === this) closeConnectBgModal(); });
        $(document).on("click", "#tinyfeed-connect-bg-save", saveConnectBg);
        $(document).on("click", "#tinyfeed-connect-bg-save-global", saveConnectBgGlobal);
        $(document).on("click", "#tinyfeed-connect-bg-clear", function () {
            $("#tinyfeed-connect-bg-url").val("").trigger("input");
            saveConnectBg();
        });
        $(document).on("input", "#tinyfeed-connect-bg-overlay", function () {
            let v = parseInt($(this).val(), 10);
            if (!Number.isFinite(v)) v = 45;
            setSetting("connectBgOverlay", v);
            $("#tinyfeed-connect-bg-overlay-val").text(`${v}%`);
            applyConnectBg(activeThread);
        });
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
                saveFeedDataDebounced();
                if (currentApp === "stream") { renderStream(); maybeStartStreamTimer(); }
            });
        });
        // กากบาทบนตัวร่วมไลฟ์ = เอาออก
        $(document).on("click", ".tinyfeed-host-remove", function (e) {
            e.stopPropagation();
            const val = String($(this).closest(".tinyfeed-stream-host").data("val"));
            const s = getStreamData();
            s.coHosts = (s.coHosts || []).filter((x) => String(x) !== val);
            saveFeedDataDebounced();
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
                saveFeedDataDebounced();
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
        // จำกัดด้วย [data-post] กัน selector กว้างเกินไปชนกับ .tinyfeed-post ของแอปอื่น
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
        $(document).on("click", ".tinyfeed-news-share", function (e) {
            e.stopPropagation();
            shareNewsItem($(this).data("news"));
        });
        $(document).on("click", "#tinyfeed-back", handleBack);

        // Stage 4: ปุ่มไลค์/แชร์
        $(document).on("click", ".tinyfeed-like", function (e) {
            e.stopPropagation();
            toggleLike($(this).data("post"));
        });
        $(document).on("click", ".tinyfeed-share", function (e) {
            e.stopPropagation();
            openShareMenu($(this).data("post"));
        });
        // เมนูแชร์โพสต์: ส่งเข้าแชท / รีโพสต์ / โควท
        $(document).on("click", "#tinyfeed-share-menu-close", closeShareMenu);
        $(document).on("click", "#tinyfeed-share-menu", function (e) { if (e.target === this) closeShareMenu(); });
        $(document).on("click", "#tinyfeed-share-menu-chat", function () {
            if (shareMenuTargetId) shareFeedPostToChat(shareMenuTargetId);
            closeShareMenu();
        });
        $(document).on("click", "#tinyfeed-share-menu-repost", function () {
            if (shareMenuTargetId) repostFeedPost(shareMenuTargetId);
        });
        $(document).on("click", "#tinyfeed-share-menu-quote", function () {
            if (shareMenuTargetId) startQuotePost(shareMenuTargetId);
        });
        $(document).on("click", "#tinyfeed-quote-chip-close", cancelQuotePost);
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
        // เลือกห้องแชตปลายทาง (แชร์ / ซื้อของส่งของขวัญ)
        $(document).on("click", "#tinyfeed-dest-picker-close", closeConnectDestPicker);
        $(document).on("click", "#tinyfeed-dest-picker", function (e) { if (e.target === this) closeConnectDestPicker(); });
        $(document).on("click", ".tinyfeed-dest-pick", function () {
            pickConnectDest(String($(this).data("key")), String($(this).data("name")));
        });
        // เลือกของจากกระเป๋าส่งเป็นของขวัญ (จากเมนู + ในแชท)
        $(document).on("click", "#tinyfeed-giftbag-close", closeGiftFromBag);
        $(document).on("click", "#tinyfeed-giftbag-modal", function (e) { if (e.target === this) closeGiftFromBag(); });
        $(document).on("click", ".tinyfeed-giftbag-send", function () {
            sendGiftFromBag(String($(this).data("id")));
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
            setThemeValue("wallpaperUrl", $(this).val().trim());
            applyWallpaper();
        });
        $(document).on("input", "#tinyfeed-cfg-wp-overlay", function () {
            let v = parseInt($(this).val(), 10);
            if (!Number.isFinite(v)) v = 45;
            setThemeValue("wallpaperOverlay", v);
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

        // ===== ฝากไว้กับการ์ด =====
        $(document).on("click", "#tinyfeed-card-export", exportProfilesToCard);
        $(document).on("click", "#tinyfeed-card-import", function () {
            const mode = String($("#tinyfeed-card-import-mode").val() || "fill");
            const msg = mode === "replace"
                ? "นำเข้าจากการ์ดนี้แล้วทับโปรไฟล์ที่มีอยู่ตอนนี้ทั้งหมด ใช่ไหม?"
                : "นำเข้าจากการ์ดนี้ เติมเฉพาะช่องที่ยังว่างอยู่ ใช่ไหม?";
            if (confirm(msg)) importProfilesFromCard(mode);
        });
        $(document).on("change", "#tinyfeed-cfg-card-autoimport", function () {
            setSetting("cardAutoImport", $(this).prop("checked"));
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
        // ===== สตอรี่ & โน้ต =====
        $(document).on("change", "#tinyfeed-cfg-story-enabled", function () {
            setSetting("storyEnabled", $(this).prop("checked"));
            if (currentApp === "feed") renderStoryBar();
        });
        $(document).on("input", "#tinyfeed-cfg-story-ttl", function () {
            const n = parseInt($(this).val(), 10);
            setSetting("storyTtlHours", Number.isFinite(n) && n > 0 ? n : 24);
            if (currentApp === "feed") renderStoryBar();
        });
        $(document).on("input", "#tinyfeed-cfg-story-max", function () {
            const n = parseInt($(this).val(), 10);
            setSetting("storyArchiveMax", Number.isFinite(n) && n >= 10 ? n : 60);
        });
        $(document).on("change", "#tinyfeed-cfg-story-aicomment", function () {
            setSetting("storyAiComment", $(this).prop("checked"));
        });
        $(document).on("input", "#tinyfeed-cfg-story-aicount", function () {
            const n = parseInt($(this).val(), 10);
            setSetting("storyAiCommentCount", Number.isFinite(n) && n > 0 ? n : 2);
        });
        $(document).on("change", "#tinyfeed-cfg-story-dm", function () {
            setSetting("storyReplyToDm", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-story-auto", function () {
            setSetting("storyAutoGenerate", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-story-automode", function () {
            setSetting("storyAutoMode", $(this).val());
        });
        $(document).on("input", "#tinyfeed-cfg-story-interval", function () {
            const n = parseInt($(this).val(), 10);
            setSetting("storyAutoInterval", Number.isFinite(n) && n > 0 ? n : 14);
        });
        $(document).on("input", "#tinyfeed-cfg-story-tokens", function () {
            const n = parseInt($(this).val(), 10);
            setSetting("storyTokens", Number.isFinite(n) && n > 0 ? n : 200);
        });
        $(document).on("input", "#tinyfeed-cfg-story-extra", function () {
            setSetting("storyExtraPrompt", $(this).val());
        });
        $(document).on("change", "#tinyfeed-cfg-note-enabled", function () {
            setSetting("noteEnabled", $(this).prop("checked"));
            if (currentApp === "feed") renderStoryBar();
        });
        $(document).on("input", "#tinyfeed-cfg-note-ttl", function () {
            const n = parseInt($(this).val(), 10);
            setSetting("noteTtlHours", Number.isFinite(n) && n > 0 ? n : 24);
        });
        $(document).on("input", "#tinyfeed-cfg-note-maxlen", function () {
            const n = parseInt($(this).val(), 10);
            setSetting("noteMaxLen", Number.isFinite(n) && n >= 10 ? n : 60);
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
        $(document).on("input", "#tinyfeed-cfg-comment-tokens", function () {
            let v = parseInt($(this).val(), 10);
            if (!Number.isFinite(v) || v < 1) v = 300;
            setSetting("commentTokens", v);
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
        // หน้าโฮม: เปิด/ปิด + จัดลำดับแอป
        $(document).on("change", ".tinyfeed-home-layout-toggle", function () {
            toggleHomeApp(String($(this).data("app")), $(this).prop("checked"));
        });
        $(document).on("click", ".tinyfeed-home-layout-up:not(.tinyfeed-field-disabled)", function () {
            moveHomeApp(String($(this).data("app")), -1);
        });
        $(document).on("click", ".tinyfeed-home-layout-down:not(.tinyfeed-field-disabled)", function () {
            moveHomeApp(String($(this).data("app")), 1);
        });
        $(document).on("click", "#tinyfeed-home-layout-reset", function () {
            setSetting("homeAppOrder", []);
            setSetting("homeAppHidden", []);
            renderHomeLayoutSettings();
            renderHomeApps();
            toastr.success("คืนค่าหน้าโฮมเริ่มต้นแล้ว", "TinyPhone");
        });
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
        $(document).on("change", "#tinyfeed-cfg-connect-reveal", function () {
            setSetting("connectRevealSequential", $(this).prop("checked"));
            if (!$(this).prop("checked")) clearConnectReveal();
        });
        $(document).on("input", "#tinyfeed-cfg-connect-reveal-delay", function () {
            let v = parseInt($(this).val(), 10);
            if (!Number.isFinite(v) || v < 300) v = 900;
            setSetting("connectRevealDelayMs", v);
        });
        $(document).on("change", "#tinyfeed-cfg-connect-schedule", function () {
            setSetting("connectScheduleEnabled", $(this).prop("checked"));
        });
        $(document).on("input", "#tinyfeed-cfg-connect-schedule-max", function () {
            let v = parseInt($(this).val(), 10);
            if (!Number.isFinite(v) || v < 1) v = 48;
            setSetting("connectScheduleMaxHours", v);
        });
        $(document).on("change", "#tinyfeed-cfg-connect-slip", function () {
            setSetting("connectSlipEnabled", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-connect-gift", function () {
            setSetting("connectGiftEnabled", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-connect-read", function () {
            setSetting("connectReadReceipts", $(this).prop("checked"));
            if (currentApp === "connect" && isConnectThreadOpen()) renderThread();
        });
        $(document).on("input", "#tinyfeed-cfg-connect-read-chance", function () {
            let v = parseInt($(this).val(), 10);
            if (!Number.isFinite(v)) v = 25;
            setSetting("connectReadOnlyChance", v);
            $("#tinyfeed-connect-read-chance-val").text(`${v}%`);
        });
        $(document).on("change", "#tinyfeed-cfg-connect-bubble-mode", function () {
            const mode = String($(this).val() || "");
            $("#tinyfeed-cfg-connect-bubble-custom-row").toggleClass("tinyfeed-hidden", mode !== "custom");
            if (mode === "custom") setThemeValue("connectBubbleColor", String($("#tinyfeed-cfg-connect-bubble-custom").val() || "#22c55e"));
            else setThemeValue("connectBubbleColor", mode);
            applyAppearance();
        });
        $(document).on("input", "#tinyfeed-cfg-connect-bubble-custom", function () {
            setThemeValue("connectBubbleColor", String($(this).val() || "#22c55e"));
            applyAppearance();
        });
        $(document).on("input", "#tinyfeed-cfg-connect-timegap", function () {
            const v = parseInt($(this).val(), 10);
            setSetting("connectTimeGapMin", Number.isFinite(v) && v > 0 ? v : 30);
            if (currentApp === "connect" && isConnectThreadOpen()) renderThread();
        });
        // ===== TinyConnect: การโทร =====
        $(document).on("change", "#tinyfeed-cfg-call-ai", function () {
            setSetting("callAiCallEnabled", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-call-auto", function () {
            setSetting("callAutoGenerate", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-call-mode", function () {
            setSetting("callAutoMode", $(this).val());
        });
        $(document).on("input", "#tinyfeed-cfg-call-interval", function () {
            const v = parseInt($(this).val(), 10);
            setSetting("callAutoInterval", Number.isFinite(v) && v > 0 ? v : 20);
        });
        $(document).on("input", "#tinyfeed-cfg-call-chance", function () {
            const v = parseInt($(this).val(), 10);
            const clamped = Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));
            setSetting("callProactiveChance", clamped);
            $("#tinyfeed-call-chance-val").text(`${clamped}%`);
        });
        $(document).on("input", "#tinyfeed-cfg-call-ring", function () {
            const v = parseInt($(this).val(), 10);
            setSetting("callRingSec", Number.isFinite(v) && v >= 5 ? v : 30);
        });
        $(document).on("input", "#tinyfeed-cfg-call-outring", function () {
            const v = parseInt($(this).val(), 10);
            setSetting("callOutRingSec", Number.isFinite(v) && v >= 2 ? v : 8);
        });
        $(document).on("input", "#tinyfeed-cfg-call-answer", function () {
            let v = parseInt($(this).val(), 10);
            if (!Number.isFinite(v)) v = 85;
            v = Math.max(0, Math.min(100, v));
            setSetting("callAnswerChance", v);
            $("#tinyfeed-call-answer-val").text(`${v}%`);
        });
        $(document).on("input", "#tinyfeed-cfg-call-tokens", function () {
            const v = parseInt($(this).val(), 10);
            setSetting("callTokens", Number.isFinite(v) && v > 0 ? v : 160);
        });
        $(document).on("input", "#tinyfeed-cfg-call-extra", function () {
            setSetting("callExtraPrompt", $(this).val());
        });
        $(document).on("change", "#tinyfeed-cfg-call-ai-hangup", function () {
            setSetting("callAiHangupEnabled", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-call-log", function () {
            setSetting("callLogToMainChat", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-call-delmain", function () {
            setSetting("callDeleteAlsoMainChat", $(this).prop("checked"));
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
        $(document).on("change", "#tinyfeed-cfg-inject-bag", function () {
            setSetting("injectBag", $(this).prop("checked"));
            updateChatInjection();
        });
        $(document).on("change", "#tinyfeed-cfg-inject-pet", function () {
            setSetting("injectPet", $(this).prop("checked"));
            updateChatInjection();
        });
        $(document).on("change", "#tinyfeed-cfg-inject-ask", function () {
            setSetting("injectAsk", $(this).prop("checked"));
            updateChatInjection();
        });
        $(document).on("change", "#tinyfeed-cfg-inject-story", function () {
            setSetting("injectStory", $(this).prop("checked"));
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
        $(document).on("change", "#tinyfeed-cfg-crossapp-bag", function () {
            setSetting("crossAppBag", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-crossapp-pet", function () {
            setSetting("crossAppPet", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-crossapp-ask", function () {
            setSetting("crossAppAsk", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-crossapp-story", function () {
            setSetting("crossAppStory", $(this).prop("checked"));
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

        // TinyAsk settings
        $(document).on("change", "#tinyfeed-cfg-ask-auto", function () {
            setSetting("askAutoGenerate", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-ask-mode", function () {
            setSetting("askAutoMode", $(this).val());
        });
        $(document).on("input", "#tinyfeed-cfg-ask-interval", function () {
            const v = parseInt($(this).val(), 10);
            setSetting("askAutoInterval", Number.isFinite(v) && v > 0 ? v : 18);
        });
        $(document).on("input", "#tinyfeed-cfg-ask-tokens", function () {
            const v = parseInt($(this).val(), 10);
            setSetting("askTokens", Number.isFinite(v) && v > 0 ? v : 200);
        });
        $(document).on("input", "#tinyfeed-cfg-ask-extra", function () {
            setSetting("askExtraPrompt", $(this).val());
        });
        $(document).on("change", "#tinyfeed-cfg-ask-reveal", function () {
            setSetting("askReveal", $(this).prop("checked"));
        });

        $(document).on("input", "#tinyfeed-cfg-pet-decay-hunger", function () {
            const v = parseFloat($(this).val());
            setSetting("petDecayHunger", Number.isFinite(v) && v >= 0 ? v : 0.25);
        });
        $(document).on("input", "#tinyfeed-cfg-pet-decay-energy", function () {
            const v = parseFloat($(this).val());
            setSetting("petDecayEnergy", Number.isFinite(v) && v >= 0 ? v : 0.2);
        });
        $(document).on("input", "#tinyfeed-cfg-pet-decay-clean", function () {
            const v = parseFloat($(this).val());
            setSetting("petDecayClean", Number.isFinite(v) && v >= 0 ? v : 0.15);
        });
        $(document).on("input", "#tinyfeed-cfg-pet-offline", function () {
            const v = parseInt($(this).val(), 10);
            setSetting("petOfflineCapHours", Number.isFinite(v) && v > 0 ? v : 12);
        });
        $(document).on("input", "#tinyfeed-cfg-pet-idlepause", function () {
            const v = parseInt($(this).val(), 10);
            setSetting("petIdlePauseMin", Number.isFinite(v) && v >= 0 ? v : 20);
        });
        $(document).on("change", "#tinyfeed-cfg-pet-nodeath", function () {
            setSetting("petNoDeath", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-pet-aicare", function () {
            setSetting("petAiCareEnabled", $(this).prop("checked"));
        });
        $(document).on("input", "#tinyfeed-cfg-pet-aicare-cooldown", function () {
            const v = parseInt($(this).val(), 10);
            setSetting("petAiCareCooldownMin", Number.isFinite(v) && v >= 0 ? v : 30);
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
        // TinyBank config — สกุลเงินผูกกับตัวละครปัจจุบัน (ไม่จำกัดความยาวตัวอักษรแล้ว)
        $(document).on("input", "#tinyfeed-cfg-bank-currency", function () {
            setCharCurrency("symbol", String($(this).val() || "").trim() || "฿");
            if (currentApp === "bank") renderBank();
            if (currentApp === "shop") renderShop();
        });
        $(document).on("change", "#tinyfeed-cfg-bank-currency-pos", function () {
            setCharCurrency("after", $(this).val() === "after");
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
        // สแกนเงินจากบท RP
        $(document).on("change", "#tinyfeed-cfg-bankscan-auto", function () {
            setSetting("bankScanAutoGenerate", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-bankscan-mode", function () {
            setSetting("bankScanAutoMode", $(this).val());
        });
        $(document).on("input", "#tinyfeed-cfg-bankscan-interval", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("bankScanAutoInterval", Number.isFinite(v) && v > 0 ? v : 15);
        });
        $(document).on("input", "#tinyfeed-cfg-bankscan-max", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("bankRpMax", Number.isFinite(v) && v > 0 ? v : 5000);
        });
        $(document).on("input", "#tinyfeed-cfg-bankscan-extra", function () {
            setSetting("bankScanExtraPrompt", $(this).val());
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
            $("#tinyfeed-connect-input").attr("placeholder", "พิมพ์ข้อความ... (Shift+Enter ขึ้นบรรทัดใหม่ · ว่างแล้วกด ✨ = ให้ตอบกลับ)");
        }

        // โหลดค่าที่บันทึกไว้
        loadSettings();
        maybeNoticeCardPayload();   // การ์ดที่เปิดอยู่ตอนโหลดหน้าเว็บอาจมีโปรไฟล์ TinyPhone ติดมา
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

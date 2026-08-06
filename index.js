import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

const extensionName = "tinyfeed";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// อ้างอิงโมดูล core ของ SillyTavern แบบ lazy (โหลดใน init) เพื่อดึง user_avatar ที่ context ไม่ได้ export
// ใช้ dynamic import + try/catch จะได้ไม่พังทั้งไฟล์ถ้าเวอร์ชันไหน export ไม่ตรง
let stScriptModule = null;

const defaultSettings = {
    enabled: true,
    theme: "dark",
    // ปรับแต่งหน้าตา (Appearance)
    accentColor: "",          // hex; "" = ใช้ค่าเริ่มจากธีม
    overlayOpacity: 50,       // 0–90 (%) ความทึบฟิลเตอร์ดำที่คลุมจอ
    themedIcons: false,       // สีไอคอนแอปตามธีม
    themedHomeBg: false,      // พื้นหลังโฮมตามธีม (เมื่อไม่มีวอลเปเปอร์)
    homeBgHue: 210,           // hue พื้นหลังโฮม (สุ่มได้)
    widgetOpacity: 82,        // ความทึบพื้นหลังวิดเจ็ต (0–100%)
    widgetClock: true,        // วิดเจ็ตนาฬิกา+วันที่
    widgetTokens: false,      // วิดเจ็ตแดชบอร์ดโทเคนต่อแอป
    widgetAgenda: false,      // วิดเจ็ตมินิกำหนดการ (TinyMemo)
    customCss: "",            // CSS snippet ของผู้ใช้
    // ทักเชิงรุก (proactive) + แจ้งเตือน OS + กลุ่มคุยกันเอง
    proactiveEnabled: false,      // ให้ตัวละครทักเองเป็นระยะ
    proactiveIntervalMin: 20,     // ตรวจ/เว้นระยะขั้นต่ำ (นาที)
    proactiveChance: 50,          // โอกาสทักในแต่ละรอบ (%)
    proactiveQuietFrom: 0,        // ช่วงเงียบ เริ่ม (ชม. 0-23)
    proactiveQuietTo: 7,          // ช่วงเงียบ ถึง (ชม. 0-23)
    proactiveTokens: 120,         // ความยาวข้อความทัก
    groupAutoChat: false,         // ให้กลุ่มคุยกันเองเป็นระยะ
    osNotifEnabled: false,        // แจ้งเตือน OS/desktop จริง (default ปิด — ระวังเนื้อหา 18+)
    proactiveIdleMin: 0,          // ทักเฉพาะเมื่อผู้ใช้เงียบ RP เกิน N นาที (0 = ปิด)
    proactiveTimeAware: false,    // ใส่บริบทช่วงเวลาจริง (เช้า/บ่าย/ดึก) ลง prompt
    proactiveViaFeed: false,      // บางครั้งทักผ่านการโพสต์ฟีดแทน DM
    notifLog: [],                 // ประวัติแจ้งเตือน (cap 30) — persist ลิ้นชัก
    notifSeenTs: 0,               // เวลาเปิดดูลิ้นชักล่าสุด (คำนวณ badge)
    promptOverrides: {},          // id → template override ("" / ไม่มี = ใช้ default)
    // Stage 5: override รูปโปรไฟล์ด้วยลิงก์ภายนอก
    wallpaperUrl: "",           // ลิงก์วอลเปเปอร์หน้าโฮม
    wallpaperOverlay: 45,       // ความทึบสcrim ดำที่ทับวอลเปเปอร์ (0–100%)
    userAvatarUrl: "",          // (legacy fallback) รูปผู้ใช้แบบ global
    charAvatarUrls: {},         // (legacy fallback) { "<ไฟล์ avatar การ์ด>": "url" }
    // Identity: โปรไฟล์ผูกกับ persona / char + NPC ผูกกับ char
    userProfiles: {},           // { <personaKey>: { avatarUrl, username, alias, primary } }
    charProfiles: {},           // { <charFile>: { avatarUrl, username, alias, primary } }
    npcsByChar: {},             // { <charFile>: [{ name, avatar }] } — NPC ผูกกับตัวละคร
    // Stage 6: ช่วงยอดไลค์เริ่มต้นแบบสุ่มของโพสต์ AI
    likesMin: 0,
    likesMax: 48,
    // Stage 6.6: จำนวนโพสต์ล่าสุดที่แนบเป็น context ให้ AI (0 = ไม่แนบ)
    historyCount: 5,
    // ตั้งค่าล่วงหน้าสำหรับฟีเจอร์อนาคต (ยังไม่ทำงานจนกว่าจะถึง stage นั้น)
    autoGenerate: false,        // Stage 7
    autoGenerateMode: "interval", // "interval" | "ai"
    autoGenerateInterval: 10,
    commentReplyMode: "instant", // "instant" | "manual"
    // Stage 8: คอมเมนต์ NPC ที่ติดมากับโพสต์ AI ใหม่
    initialCommentMode: "none",  // "none" | "ai" (AI เลือกจำนวน) | "fixed" (กำหนดจำนวน)
    initialCommentCount: 2,
    // Stage 9: ข่าวสาร
    newsAutoGenerate: false,
    newsAutoMode: "interval",    // "interval" | "ai"
    newsAutoInterval: 20,
    newsHistoryCount: 5,
    // Stage 10: การแจ้งเตือน
    notificationsEnabled: true,
    // TinyConnect
    connectTokens: 200,
    connectExtraPrompt: "",
    connectSplitBubbles: true,    // แยกข้อความหลายบรรทัดเป็นหลายบับเบิล
    connectAutoGenerate: false,   // ให้คู่แชททักหาเราเองอัตโนมัติ (ตามจังหวะ RP)
    connectAutoMode: "interval",  // "interval" | "ai" | "keyword"
    connectAutoInterval: 12,      // ทักทุกๆ กี่ข้อความ (โหมด interval)
    // TinyStream
    streamStreamer: "char",       // "char" | "user" | "npc"
    streamStreamerNpc: "",        // ชื่อ NPC ที่เป็นสตรีมเมอร์ (เมื่อ streamStreamer = "npc")
    streamCoStreamers: [],        // ชื่อตัวละคร/NPC ที่ร่วมไลฟ์ (หลายผู้พูด)
    streamStreamerReply: true,    // สตรีมเมอร์อ่านคอมเมนต์เราแล้วตอบอัตโนมัติ
    streamStreamerTalk: false,    // สตรีมเมอร์เล่าเรื่องเองเป็นระยะ (มอโนล็อก)
    streamCommentMode: "manual",  // "manual" | "auto" | "onupdate"
    streamBgUrl: "",              // ลิงก์รูปพื้นหลังกรอบสตรีม ("" = ใช้สีพื้น)
    streamBgTheme: false,         // ใช้สีพื้นหลังตามธีม (accent) เมื่อไม่มีลิงก์รูป
    streamAutoInterval: 12,        // วินาที (โหมด auto)
    streamTokens: 300,
    streamExtraPrompt: "",
    // Phase 2: โมเดล/API แยกสำหรับ TinyFeed ("" = ใช้ API หลัก, หรือ id ของ connection profile)
    apiProfile: "",
    apiContextMessages: 10,   // จำนวนข้อความล่าสุดที่แนบเป็น context เมื่อใช้ profile แยก
    worldInfoLimit: 0,        // จำกัดความยาว World Info ที่แนบ (ตัวอักษร, 0 = ไม่จำกัด)
    // Phase 2: จำนวน token ตอบกลับ (กันข้อความขาด)
    postTokens: 400,
    newsTokens: 500,
    // Phase 2: คำสั่งเสริมที่ผู้ใช้ใส่เอง (ต่อท้าย prompt โดยไม่แตะโครงสร้าง)
    postExtraPrompt: "",
    newsExtraPrompt: "",
    // Phase 2: แทรกฟีดเข้าประวัติแชทหลัก ("off" | "posts" | "news" | "posts_comments" | "posts_comments_news")
    injectMode: "off",
    injectDepth: 4,
    injectCount: 5,
    injectConnect: false,   // แทรกแชต TinyConnect เข้า RP
    injectStream: false,    // แทรกไลฟ์ TinyStream เข้า RP
    // TinyMemo (กำหนดการ + โน้ต/ความจำ)
    memoAutoGenerate: false,      // สแกนกำหนดการ/ความจำอัตโนมัติ
    memoAutoMode: "interval",     // "interval" | "ai"
    memoAutoInterval: 15,
    memoTokens: 350,
    memoExtraPrompt: "",
    injectMemo: false,            // แทรกกำหนดการ/โน้ต เข้า RP หลัก
    // TinyForum (เว็บบอร์ด/กระทู้)
    forumAutoGenerate: false,     // สร้างกระทู้อัตโนมัติ
    forumAutoMode: "interval",    // "interval" | "ai"
    forumAutoInterval: 20,
    forumTokens: 500,
    forumExtraPrompt: "",
    forumCommentBatch: 8,         // จำนวนคอมเมนต์ต่อการโหลด 1 ครั้ง
    forumRooms: ["ข่าว/สังคม", "รีวิว", "ถาม-ตอบ", "ซุบซิบ", "ทั่วไป"],
    injectForum: false,           // แทรกกระทู้ เข้า RP หลัก
    injectForumComments: false,   // แทรกคอมเมนต์+รีพลายในกระทู้ด้วย
    // TinyBank (ธนาคาร/การเงิน — ยอดเงินผูกกับแชท)
    bankCurrency: "฿",            // สัญลักษณ์สกุลเงิน
    bankCurrencyAfter: false,     // แสดงสัญลักษณ์ไว้ข้างหลังตัวเลข (เช่น 100฿) แทนข้างหน้า
    streamDonateEnabled: false,   // เปิดระบบโดเนทในไลฟ์ (AI กำหนดผู้โดเนท/จำนวน/ข้อความเอง)
    bankDonateMax: 5000,          // เพดานยอดโดเนทต่อครั้ง (กัน AI ให้หลุด)
    connectSlipEnabled: false,    // ให้คู่แชทส่งสลิปโอนเงินเข้าบัญชีเราได้ (AI)
    shop: [],                     // แคตตาล็อกร้านค้า (global) [{ id, name, price, image, desc }]
    // tier โดเนทแบบ SuperChat: สีเปลี่ยนตามจำนวนเงิน (min = ยอดขั้นต่ำของ tier นั้น)
    donateTiers: [
        { min: 0, color: "#1d9bf0" },
        { min: 50, color: "#00b8d4" },
        { min: 200, color: "#22c55e" },
        { min: 500, color: "#ffca28" },
        { min: 1000, color: "#ff9100" },
        { min: 2000, color: "#ec407a" },
        { min: 5000, color: "#e53935" },
    ],
    // TinyGallery (คลังรูป + สติกเกอร์ — global ข้ามแชท ไม่ผูกกับแชทไหน)
    gallery: { images: [], stickers: [], imageAlbums: ["ทั่วไป"], stickerAlbums: ["ทั่วไป"] },
    galleryPrompt: true,          // ให้บอทรู้จักคลัง + ส่งสติกเกอร์/รูปได้ด้วย [sticker:ชื่อ] / [img:ชื่อ]
    galleryPromptScope: "all",    // "all" = ทุกอัลบั้ม · "selected" = เฉพาะอัลบั้มที่เลือก
    galleryAlbums: [],            // ชื่ออัลบั้มที่ให้ AI เข้าถึง (เมื่อ scope = "selected")
    galleryMaxImages: 24,         // จำนวนรูปสูงสุดที่แนบเข้า prompt
    galleryMaxStickers: 24,       // จำนวนสติกเกอร์สูงสุดที่แนบเข้า prompt
    // เชื่อมเนื้อหาข้ามแอป (ตอน generate แต่ละแอปจะเห็นเนื้อหาแอปอื่น)
    crossAppEnabled: false,       // master switch
    crossAppCount: 3,
    // เลือกรายแหล่งว่าเนื้อหาไหนให้แอปอื่นมองเห็น (แชต default ปิดเพื่อความเป็นส่วนตัว)
    crossAppFeed: true,           // โพสต์ในฟีด
    crossAppComments: false,      // คอมเมนต์ในโพสต์
    crossAppNews: true,           // ข่าว
    crossAppConnect: false,       // แชต TinyConnect (ส่วนตัว)
    crossAppStream: true,         // ไลฟ์ TinyStream
    crossAppMemo: false,          // กำหนดการ/โน้ต TinyMemo
    crossAppForum: false,         // กระทู้ TinyForum
    // ── ทริกเกอร์ด้วยคีย์เวิร์ด: เมื่อโหมด auto ของแอปตั้งเป็น "keyword" ──
    // เจอคำเหล่านี้ในข้อความ RP ล่าสุด → สั่งแอปนั้นสร้างเนื้อหา (มี cooldown กันถี่)
    // ฟรี ทำงานฝั่งเบราว์เซอร์ ไม่มีดีเลย์/ไม่ต้องโหลดโมเดล (embedding เป็นแผนอนาคต)
    feedKeywords: "โพสต์, ลงฟีด, ลงรูป, ลงสตอรี่, เล่นโซเชียล, ถ่ายรูปลง, อัปรูป, story, post, feed",
    newsKeywords: "ข่าว, อ่านข่าว, เปิดข่าว, ดูข่าว, ประกาศ, มีข่าวว่า, news, breaking",
    memoKeywords: "จดไว้, โน้ตไว้, เตือนความจำ, กันลืม, นัดหมาย, กำหนดการ, ตารางงาน, memo, reminder, todo",
    forumKeywords: "กระทู้, เว็บบอร์ด, พันทิป, ตั้งกระทู้, ในบอร์ด, ชาวเน็ต, forum, pantip",
    connectKeywords: "แชต, ทักไลน์, ส่งไลน์, ทักมา, ส่งข้อความ, ไลน์มา, chat, line, dm, ทักหา",
    keywordCooldownSec: 45,       // เว้นระยะขั้นต่ำต่อแอป (วินาที) กันทริกเกอร์ถี่เกิน
    keywordScope: "both",         // ทริกเกอร์คีย์เวิร์ดจับข้อความฝั่งไหน: "both" | "char" | "user"
};

// อ่านค่า setting (fallback เป็นค่า default ถ้ายังไม่มี key นั้น — เผื่อผู้ใช้เก่าที่ settings ถูกสร้างก่อน key ใหม่)
function getSetting(key) {
    const s = extension_settings[extensionName] || {};
    return s[key] !== undefined ? s[key] : defaultSettings[key];
}

// บันทึกค่า setting
function setSetting(key, value) {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    extension_settings[extensionName][key] = value;
    saveSettingsDebounced();
}

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

// ===== App Shell: หน้าโฮม + สลับแอป =====
let currentApp = "home";

function goHome() {
    currentApp = "home";
    clearStreamTimer();
    $(".tinyfeed-app").addClass("tinyfeed-hidden");
    $("#tinyfeed-home").removeClass("tinyfeed-hidden");
    $(".tinyfeed-title").text("TinyPhone");
    $("#tinyfeed-home-btn, #tinyfeed-back").addClass("tinyfeed-hidden");
    $("#tinyfeed-settings-btn").removeClass("tinyfeed-hidden");   // เฟืองเข้าถึงได้จากโฮม
    try { $("#tinyfeed-home .tinyfeed-home-hello").text(`สวัสดี, ${getUserName()}`); } catch (e) { /* ข้าม */ }
    renderHomeWidgets();
    renderHomeApps();
    saveLastScreen();
}

function openApp(app) {
    if (!["feed", "connect", "stream", "memo", "forum", "gallery", "bank", "shop"].includes(app)) {
        toastr.info("แอปนี้กำลังจะมา เร็วๆ นี้! 📱", "TinyPhone");
        return;
    }
    clearStreamTimer();   // ออกจากแอปอื่น = หยุด timer stream
    clearHomeClock();     // ออกจากโฮม = หยุดนาฬิกา
    closeGalleryOverlays(); // กัน overlay คลังค้างข้ามแอป
    closeCharPicker();      // กันตัวเลือกตัวละครค้างข้ามแอป
    closeSlipModal();       // กัน modal โอนเงินค้างข้ามแอป
    $("#tinyfeed-home").addClass("tinyfeed-hidden");
    $(".tinyfeed-app").addClass("tinyfeed-hidden");
    $("#tinyfeed-home-btn, #tinyfeed-settings-btn").removeClass("tinyfeed-hidden");
    $("#tinyfeed-back").addClass("tinyfeed-hidden");

    if (app === "feed") {
        currentApp = "feed";
        $("#tinyfeed-app-feed").removeClass("tinyfeed-hidden");
        $(".tinyfeed-title").text("TinyFeed");
        $(".tinyfeed-tabs").removeClass("tinyfeed-hidden");
        applyFeedComposeMode();
        switchTab(activeTab);
    } else if (app === "connect") {
        currentApp = "connect";
        $("#tinyfeed-app-connect").removeClass("tinyfeed-hidden");
        $(".tinyfeed-title").text("TinyConnect");
        openConnectList();
    } else if (app === "memo") {
        currentApp = "memo";
        $("#tinyfeed-app-memo").removeClass("tinyfeed-hidden");
        $(".tinyfeed-title").text("TinyMemo");
        switchMemoTab(memoTab);
    } else if (app === "forum") {
        currentApp = "forum";
        $("#tinyfeed-app-forum").removeClass("tinyfeed-hidden");
        openForumList();
    } else if (app === "gallery") {
        currentApp = "gallery";
        $("#tinyfeed-app-gallery").removeClass("tinyfeed-hidden");
        $(".tinyfeed-title").text("TinyGallery");
        openGallery();
    } else if (app === "bank") {
        currentApp = "bank";
        $("#tinyfeed-app-bank").removeClass("tinyfeed-hidden");
        $(".tinyfeed-title").text("TinyBank");
        renderBank();
    } else if (app === "shop") {
        currentApp = "shop";
        $("#tinyfeed-app-shop").removeClass("tinyfeed-hidden");
        $(".tinyfeed-title").text("TinyShop");
        renderShop();
    } else {
        currentApp = "stream";
        $("#tinyfeed-app-stream").removeClass("tinyfeed-hidden");
        $(".tinyfeed-title").text("TinyStream");
        renderStream();
        maybeStartStreamTimer();
    }
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

function renderShop() {
    $("#tinyfeed-shop-balance").text(formatMoney(getBankData().balance));
    const items = getShop();
    if (!items.length) {
        $("#tinyfeed-shop-grid").html(emptyStateHtml("fa-bag-shopping", "ยังไม่มีสินค้า", "เพิ่มสินค้าด้านบน แล้วซื้อด้วยเงินใน TinyBank"));
        return;
    }
    const owned = getShopOwned();
    $("#tinyfeed-shop-grid").html(items.map((it) => {
        const n = owned[it.id] || 0;
        return `<div class="tinyfeed-shop-item" data-id="${escapeAttr(it.id)}">
            <div class="tinyfeed-shop-thumb-wrap">
                ${it.image
                    ? `<img class="tinyfeed-shop-thumb" src="${escapeAttr(it.image)}" alt="${escapeText(it.name)}" onerror="this.classList.add('tinyfeed-img-broken')" />`
                    : `<div class="tinyfeed-shop-thumb tinyfeed-shop-noimg"><i class="fa-solid fa-box"></i></div>`}
                ${n ? `<span class="tinyfeed-shop-owned">มี ${n}</span>` : ""}
                <span class="tinyfeed-shop-del" title="ลบสินค้า"><i class="fa-solid fa-trash"></i></span>
            </div>
            <div class="tinyfeed-shop-name">${escapeText(it.name)}</div>
            ${it.desc ? `<div class="tinyfeed-shop-desc">${escapeText(it.desc)}</div>` : ""}
            <button class="tinyfeed-shop-buy tinyfeed-btn-primary" data-id="${escapeAttr(it.id)}">${formatMoney(it.price)}</button>
        </div>`;
    }).join(""));
}

function addShopItem() {
    const name = String($("#tinyfeed-shop-name").val() || "").trim();
    const price = parseInt($("#tinyfeed-shop-price").val(), 10);
    const image = String($("#tinyfeed-shop-image").val() || "").trim();
    const desc = String($("#tinyfeed-shop-desc").val() || "").trim();
    if (!name) { toastr.info("ตั้งชื่อสินค้าก่อนนะ", "TinyShop"); return; }
    if (!Number.isFinite(price) || price <= 0) { toastr.info("ใส่ราคาสินค้าก่อนนะ", "TinyShop"); return; }
    getShop().push({ id: shopId(), name, price, image, desc });
    saveShop();
    $("#tinyfeed-shop-name, #tinyfeed-shop-price, #tinyfeed-shop-image, #tinyfeed-shop-desc").val("");
    renderShop();
    toastr.success(`เพิ่มสินค้า "${name}" แล้ว`, "TinyShop");
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
    $(".tinyfeed-gallery-tab").removeClass("tinyfeed-gallery-tab-active");
    $(`.tinyfeed-gallery-tab[data-gtab="${galleryTab}"]`).addClass("tinyfeed-gallery-tab-active");
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
        $(gridSel).html(`<div class="tinyfeed-gallery-empty">ยังไม่มี${kind === "sticker" ? "สติกเกอร์" : "รูป"}ในอัลบั้มนี้ · เพิ่มด้านบนได้เลย</div>`);
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
        $("#tinyfeed-gallery-picker-grid").html(`<div class="tinyfeed-gallery-empty">อัลบั้มนี้ว่าง</div>`);
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

// รายชื่อ contact = ตัวละครหลัก + NPC ประจำ
function getConnectContacts() {
    const contacts = [];
    const char = getCurrentCharacter();
    if (char) contacts.push({ key: "main", name: getCharName(), isMain: true, avatar: "" });
    for (const npc of getNpcs()) {
        const name = String(npc.name || "").trim();
        if (name) contacts.push({ key: "npc:" + name, name, isMain: false, avatar: npc.avatar || "" });
    }
    return contacts;
}

function contactAvatarItem(c) {
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
    // แถบเครื่องมือในห้องแชต: 1:1 = ปุ่ม "ให้ตอบกลับ" · กลุ่ม = "ให้กลุ่มคุยกันต่อ"
    const isGroup = Boolean(findGroup(key));
    $("#tinyfeed-connect-thread-tools").removeClass("tinyfeed-hidden");
    $("#tinyfeed-connect-reply").toggleClass("tinyfeed-hidden", isGroup);
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
            const t = String(chunk || "").replace(/^(?:<br\s*\/?>|\n|\s)+|(?:<br\s*\/?>|\n|\s)+$/gi, "");
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
    saveFeedData();
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
const HOME_APPS = [
    { app: "feed", icon: "fa-hashtag", name: "TinyFeed", a: "#1d9bf0", b: "#0a6bd8" },
    { app: "connect", icon: "fa-comment-dots", name: "TinyConnect", a: "#22c55e", b: "#15a34a" },
    { app: "stream", icon: "fa-video", name: "TinyStream", a: "#a855f7", b: "#7e22ce" },
    { app: "memo", icon: "fa-calendar-check", name: "TinyMemo", a: "#f59e0b", b: "#d97706" },
    { app: "forum", icon: "fa-comments", name: "TinyForum", a: "#ef4444", b: "#b91c1c" },
    { app: "gallery", icon: "fa-images", name: "TinyGallery", a: "#ec4899", b: "#be185d" },
    { app: "bank", icon: "fa-wallet", name: "TinyBank", a: "#10b981", b: "#047857" },
    { app: "shop", icon: "fa-bag-shopping", name: "TinyShop", a: "#f97316", b: "#c2410c" },
];
const HOME_APPS_PER_PAGE = 9;   // 3 คอลัมน์ × 3 แถวต่อหน้า

function appIconHtml(a) {
    return `<div class="tinyfeed-app-icon" data-app="${a.app}">
        <div class="tinyfeed-app-tile" style="--app-a:${a.a}; --app-b:${a.b};"><i class="fa-solid ${a.icon}"></i></div>
        <span class="tinyfeed-app-name">${a.name}</span>
    </div>`;
}

function renderHomeApps() {
    const pager = $("#tinyfeed-home-pager");
    if (!pager.length) return;
    const pages = [];
    for (let i = 0; i < HOME_APPS.length; i += HOME_APPS_PER_PAGE) {
        const slice = HOME_APPS.slice(i, i + HOME_APPS_PER_PAGE);
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

// ป้ายกำกับ/ไอคอน/สีของแต่ละแอป (ใช้ร่วมทั้ง dashboard แทรก + dashboard เจน)
const APP_META = {
    feed: { label: "TinyFeed", icon: "fa-hashtag", color: "#1d9bf0" },
    news: { label: "ข่าวสาร", icon: "fa-newspaper", color: "#f59e0b" },
    connect: { label: "TinyConnect", icon: "fa-comment-dots", color: "#22c55e" },
    stream: { label: "TinyStream", icon: "fa-video", color: "#a855f7" },
    memo: { label: "TinyMemo", icon: "fa-calendar-check", color: "#14b8a6" },
    forum: { label: "TinyForum", icon: "fa-comments", color: "#ef4444" },
    gallery: { label: "คลังสื่อ", icon: "fa-images", color: "#ec4899" },
};

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
function injectWant() {
    const mode = getSetting("injectMode") || "off";
    return {
        feed: ["posts", "posts_comments", "posts_comments_news", "both"].includes(mode),
        comments: ["posts_comments", "posts_comments_news"].includes(mode),
        news: ["news", "posts_comments_news", "both"].includes(mode),
        connect: Boolean(getSetting("injectConnect")),
        stream: Boolean(getSetting("injectStream")),
        memo: Boolean(getSetting("injectMemo")),
        forum: Boolean(getSetting("injectForum")),
        forumComments: Boolean(getSetting("injectForumComments")),
        count: Math.max(1, parseInt(getSetting("injectCount"), 10) || 5),
    };
}

// ข้อความที่แทรกเข้าแชทหลักจริง (ใช้ทั้งตอน setExtensionPrompt และตอนนับโทเคน)
function injectText() {
    const w = injectWant();
    if (!w.feed && !w.news && !w.connect && !w.stream && !w.memo && !w.forum) return "";
    const blocks = buildAppBlocks(w);
    return blocks.length
        ? `[ข้อมูลจากโทรศัพท์ TinyPhone ที่ตัวละครรับรู้ได้ ใช้อ้างอิงในบทบาทได้ตามเหมาะสม]\n${blocks.join("\n\n")}`
        : "";
}

// ── Dashboard ส่วน A: โทเคนที่ "ส่งเข้าแชทหลัก" ทุกข้อความ (ตรงกับ config แทรกจริง) ──
function injectDashboard() {
    const w = injectWant();
    const on = w.feed || w.news || w.connect || w.stream || w.memo || w.forum;
    const rows = [];
    const add = (key, single) => {
        const t = buildAppBlocks(Object.assign({ count: w.count }, single)).join("\n");
        const tok = tinyTokenCount(t);
        if (tok) { const m = APP_META[key]; rows.push({ key, label: m.label, icon: m.icon, color: m.color, tokens: tok }); }
    };
    if (w.feed) add("feed", { feed: true, comments: w.comments });
    if (w.news) add("news", { news: true });
    if (w.connect) add("connect", { connect: true });
    if (w.stream) add("stream", { stream: true });
    if (w.memo) add("memo", { memo: true });
    if (w.forum) add("forum", { forum: true, forumComments: w.forumComments });
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
const METADATA_KEY = "tinyfeed";

// ข้อมูลเริ่มต้นสำหรับแชทที่ยังไม่มีฟีด (เริ่มว่าง — โชว์ empty state)
function getSeedData() {
    return {
        feed: [],
        news: [],
        npcs: [],   // รายชื่อ NPC ประจำของแชทนี้ [{ name, avatar }]
        agenda: [], // TinyMemo กำหนดการ [{ id, when, title, status, isAI, ts }]
        notes: [],  // TinyMemo โน้ต/ความจำ [{ id, text, kind, isAI, ts }]
        forum: [],  // TinyForum กระทู้ [{ id, room, title, body, author, likes, comments:[] }]
    };
}

// ล้างข้อมูล mockup เก่าที่เคยฝังไว้ (ids p1/p2/n1) ออกจากแชทที่มีอยู่แล้ว
function cleanupMockData(data) {
    let changed = false;
    if (Array.isArray(data.feed) && data.feed.some((p) => p.id === "p1" || p.id === "p2")) {
        data.feed = data.feed.filter((p) => p.id !== "p1" && p.id !== "p2");
        changed = true;
    }
    if (Array.isArray(data.news) && data.news.some((n) => n.id === "n1")) {
        data.news = data.news.filter((n) => n.id !== "n1");
        changed = true;
    }
    if (changed) saveFeedData();
}

// ดึงข้อมูล TinyFeed ของแชทปัจจุบัน
function getFeedData() {
    const context = getContext();
    const meta = context.chatMetadata;
    if (!meta[METADATA_KEY]) {
        meta[METADATA_KEY] = getSeedData();
        saveFeedData();
    }
    cleanupMockData(meta[METADATA_KEY]);   // ล้าง mockup เก่า (ครั้งเดียวต่อแชท)
    return meta[METADATA_KEY];
}

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
function getGallery() {
    const store = extension_settings[extensionName] || {};
    let g = store.gallery;
    if (!g || typeof g !== "object") g = {};
    if (!Array.isArray(g.images)) g.images = [];
    if (!Array.isArray(g.stickers)) g.stickers = [];
    if (!Array.isArray(g.imageAlbums) || !g.imageAlbums.length) g.imageAlbums = ["ทั่วไป"];
    if (!Array.isArray(g.stickerAlbums) || !g.stickerAlbums.length) g.stickerAlbums = ["ทั่วไป"];
    if (store.gallery !== g) setSetting("gallery", g);   // เขียนกลับถ้าเพิ่งสร้าง/ซ่อม
    return g;
}

function saveGallery() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    extension_settings[extensionName].gallery = getGallery();
    saveSettingsDebounced();
}

// ถอด HTML entity เบาๆ (สำหรับจับคู่ชื่อในโทเคน [sticker:...] / [img:...] ที่ผ่าน escape มาแล้ว)
function unescapeLite(s) {
    return String(s == null ? "" : s)
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

// หาสติกเกอร์/รูปในคลังตามชื่อ (case-insensitive) ไม่เจอคืน null
function findSticker(name) {
    const k = String(name || "").trim().toLowerCase();
    if (!k) return null;
    return getGallery().stickers.find((s) => String(s.name || "").trim().toLowerCase() === k) || null;
}
function findGalleryImage(name) {
    const k = String(name || "").trim().toLowerCase();
    if (!k) return null;
    return getGallery().images.find((s) => String(s.name || "").trim().toLowerCase() === k) || null;
}

// หา URL รูปของ NPC จากรายชื่อประจำ (ตามชื่อ) ไม่เจอคืน ""
function getNpcAvatar(name) {
    const key = String(name || "").trim().toLowerCase();
    if (!key) return "";
    const npc = getNpcs().find((n) => String(n.name || "").trim().toLowerCase() === key);
    return (npc && npc.avatar) ? npc.avatar : "";
}

// แปลง HTML ของโพสต์กลับเป็น plain text (สำหรับแนบเข้า prompt)
function htmlToPlain(html) {
    const d = document.createElement("div");
    d.innerHTML = String(html || "").replace(/<br\s*\/?>/gi, "\n");
    return (d.textContent || "").trim();
}

// บันทึกข้อมูลผูกกับแชท
function saveFeedData() {
    const context = getContext();
    if (typeof context.saveMetadata === "function") {
        context.saveMetadata();
    }
}

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
function timeAgo(ts) {
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

// หา timestamp ของ item (จาก field ts หรือกู้จากตัวเลขใน id) ไม่มีคืน null
function itemTimestamp(item) {
    if (item.ts) return item.ts;
    const m = String(item.id || "").match(/(\d{10,})/);
    return m ? Number(m[1]) : null;
}

// ข้อความเวลาที่จะแสดง (ใช้เวลาสัมพัทธ์ถ้ามี ts/id, ไม่มีก็ใช้ field time เดิม เช่นข้อมูล seed)
function displayTime(item) {
    const ts = itemTimestamp(item);
    return ts ? timeAgo(ts) : (item.time || "");
}

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
function escapeText(str) {
    const div = document.createElement("div");
    div.textContent = String(str == null ? "" : str);
    return div.innerHTML;
}

// escape ข้อความของผู้ใช้ก่อนยัดลง HTML (กัน HTML พัง/inject) + แปลงขึ้นบรรทัดใหม่เป็น <br>
function escapeHtml(str) {
    return escapeText(str).replace(/\n/g, "<br>");
}

// แต่งข้อความที่ escape แล้ว: markdown เบาๆ + #แฮชแท็ก / @เมนชัน เป็นสีฟ้า
// (ปลอดภัยเพราะรับ input ที่ผ่าน escape มาแล้ว แท็กเดียวที่มีคือ <br>)
// รูป > สติกเกอร์: ถ้าข้อความมีทั้ง [img:] (ที่หาเจอ) และ [sticker:] → ตัดสติกเกอร์ทิ้ง แสดงแค่รูป
function resolveMediaPriority(s) {
    s = String(s == null ? "" : s);
    const hasValidImg = [...s.matchAll(/\[img:([^\]]+)\]/gi)].some((m) => findGalleryImage(unescapeLite(m[1])));
    if (hasValidImg) s = s.replace(/\[sticker:[^\]]+\]/gi, "");
    return s;
}

function renderRich(html) {
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

// escape สำหรับใส่ในค่า attribute (value="...")
function escapeAttr(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// แปลงโทเคนสติกเกอร์/รูปเป็น <img> (เรียกจาก renderRich) — ไม่เจอชื่อ = โชว์ placeholder
function renderStickerToken(name) {
    const s = findSticker(name);
    if (s && s.url) {
        return `<img class="tinyfeed-sticker-img" src="${escapeAttr(s.url)}" alt="${escapeText(s.name)}" title="${escapeText(s.name)}" onerror="this.classList.add('tinyfeed-img-broken')" />`;
    }
    return `<span class="tinyfeed-token-missing">[สติกเกอร์: ${escapeText(name)}]</span>`;
}
function renderImgToken(name) {
    const im = findGalleryImage(name);
    if (im && im.url) {
        // คำบรรยายไม่โชว์ในเนื้อหา (ใช้เป็น prompt + โชว์ตอนดูรูปเต็มในคลังเท่านั้น)
        return `<span class="tinyfeed-content-img-wrap"><img class="tinyfeed-content-img" src="${escapeAttr(im.url)}" alt="${escapeText(im.name)}" onerror="this.classList.add('tinyfeed-img-broken')" /></span>`;
    }
    return `<span class="tinyfeed-token-missing">[รูป: ${escapeText(name)}]</span>`;
}

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
function stripWrapBrackets(s) {
    s = String(s == null ? "" : s).trim();
    if (/^\[(?:sticker|img):[^\]]+\]$/i.test(s)) return s;   // เป็นโทเคนล้วน อย่าแตะ
    if (s.startsWith("[") && !/^\[(?:sticker|img):/i.test(s)) s = s.slice(1);
    if (s.endsWith("]")) {
        const tail = s.slice(s.lastIndexOf("["));
        if (!/^\[(?:sticker|img):[^\]]+\]$/i.test(tail)) s = s.slice(0, -1);   // ] ไม่ได้ปิดโทเคนท้ายข้อความ
    }
    return s.trim();
}

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
    return blocks;
}

// context จาก "แอปอื่น" สำหรับแนบเข้า prompt ตอน generate (เชื่อมเนื้อหาข้ามแอป)
function crossAppContext(exclude) {
    if (!getSetting("crossAppEnabled")) return "";
    const count = Math.max(1, parseInt(getSetting("crossAppCount"), 10) || 3);
    const want = {
        feed: Boolean(getSetting("crossAppFeed")),
        comments: Boolean(getSetting("crossAppComments")),
        news: Boolean(getSetting("crossAppNews")),
        connect: Boolean(getSetting("crossAppConnect")),
        stream: Boolean(getSetting("crossAppStream")),
        memo: Boolean(getSetting("crossAppMemo")),
        forum: Boolean(getSetting("crossAppForum")),
        count,
    };
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
function emptyStateHtml(icon, title, sub) {
    return `<div class="tinyfeed-empty">
        <i class="fa-solid ${icon}"></i>
        <div class="tinyfeed-empty-title">${title}</div>
        <div class="tinyfeed-empty-sub">${sub}</div>
    </div>`;
}

function skeletonCardHtml() {
    return `<div class="tinyfeed-skel">
        <div class="tinyfeed-skel-head">
            <div class="tinyfeed-skel-avatar tinyfeed-shimmer"></div>
            <div class="tinyfeed-skel-lines">
                <div class="tinyfeed-shimmer tinyfeed-skel-line" style="width:40%"></div>
                <div class="tinyfeed-shimmer tinyfeed-skel-line" style="width:25%"></div>
            </div>
        </div>
        <div class="tinyfeed-shimmer tinyfeed-skel-line" style="width:95%"></div>
        <div class="tinyfeed-shimmer tinyfeed-skel-line" style="width:80%"></div>
    </div>`;
}

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
    $(".tinyfeed-tab").removeClass("tinyfeed-tab-active");
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
        <div class="tinyfeed-comment-compose">
            ${makeAvatar({ isUser: true, author: getUserName() })}
            <div class="tinyfeed-inputwrap">
                <input class="tinyfeed-comment-input" type="text" placeholder="เขียนคอมเมนต์..." data-post="${post.id}" />
                <span class="tinyfeed-comment-sticker tinyfeed-compose-inbtn" data-post="${post.id}" title="ส่งสติกเกอร์"><i class="fa-regular fa-face-smile"></i></span>
            </div>
            <span class="tinyfeed-comment-send" data-post="${post.id}"><i class="fa-solid fa-paper-plane"></i></span>
        </div>
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
function stripReasoning(raw) {
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
    $(".tinyfeed-memo-tab").removeClass("tinyfeed-memo-tab-active");
    $(`.tinyfeed-memo-tab[data-mtab="${memoTab}"]`).addClass("tinyfeed-memo-tab-active");
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
    $(".tinyfeed-forum-tab").removeClass("tinyfeed-forum-tab-active");
    $(`.tinyfeed-forum-tab[data-fsort="${forumSort}"]`).addClass("tinyfeed-forum-tab-active");
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
            extra: extra ? ` คำสั่งเพิ่มเติม: ${extra}.` : "",
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
        box.html(`<div class="tinyfeed-notif-drawer-empty">ยังไม่มีแจ้งเตือน</div>`);
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
const MEMO_APPS = ["feed", "connect", "stream", "memo", "forum", "gallery", "bank", "shop"];
function saveLastScreen() {
    try {
        const data = getFeedData();
        data.ui = {
            app: MEMO_APPS.includes(currentApp) ? currentApp : "home",
            thread: activeThread || null,
            forumThread: activeForumThread || null,
        };
        saveFeedData();
    } catch (e) { /* ข้าม */ }
}

function restoreLastScreen() {
    let ui = null;
    try { ui = getFeedData().ui; } catch (e) { /* ข้าม */ }
    if (!ui || !MEMO_APPS.includes(ui.app)) { goHome(); return; }
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
    $(".tinyfeed-tabs").addClass("tinyfeed-hidden");
    $("#tinyfeed-home-btn, #tinyfeed-settings-btn").addClass("tinyfeed-hidden");
    $("#tinyfeed-back").removeClass("tinyfeed-hidden");
}

function closeDetail() {
    $("#tinyfeed-back").addClass("tinyfeed-hidden");
    $("#tinyfeed-home-btn, #tinyfeed-settings-btn").removeClass("tinyfeed-hidden");
    $(".tinyfeed-tabs").removeClass("tinyfeed-hidden");
    switchTab(activeTab);
}

// ===== จัดกลุ่มหน้า settings: ตั้งค่าเครื่อง vs ตั้งค่าแอป =====
const SETTINGS_LAYOUT = [
    {
        head: "⚙️ ทั่วไป (General)",
        titles: ["การแจ้งเตือน", "ทักเชิงรุก (ตัวละครทักเอง)"],
    },
    {
        head: "🎨 ธีม & CSS",
        titles: ["ปรับแต่งหน้าตา", "วอลเปเปอร์"],
    },
    {
        head: "👤 ตัวละคร (Profile & NPC)",
        titles: ["รูปโปรไฟล์", "NPC ประจำ (ตัวละครนี้)"],
    },
    {
        head: "💰 การเงิน",
        titles: ["TinyBank (ธนาคาร)"],
    },
    {
        head: "📱 ตั้งค่าเฉพาะแอป",
        titles: ["โพสต์จากตัวละคร (AI)", "สร้างโพสต์อัตโนมัติ", "คอมเมนต์", "ข่าวสาร",
            "TinyConnect (แชต)", "TinyStream (ไลฟ์สตรีม)", "TinyMemo (กำหนดการ + โน้ต)",
            "TinyForum (เว็บบอร์ด)", "ทริกเกอร์ด้วยคีย์เวิร์ด", "TinyGallery (คลังรูป + สติกเกอร์)"],
    },
    {
        head: "🔧 ตั้งค่าขั้นสูง",
        titles: ["โมเดล / API", "แทรกฟีดเข้าประวัติแชท", "Prompt (ขั้นสูง)"],
    },
];

// เรียงกลุ่ม settings ใหม่ + ใส่หัวข้อใหญ่คั่น (ทำครั้งเดียว)
function organizeSettings() {
    const screen = $("#tinyfeed-settings-screen");
    if (!screen.length || screen.attr("data-organized")) return;
    const groups = {};
    screen.find(".tinyfeed-settings-group").each(function () {
        const t = $(this).find(".tinyfeed-settings-title").first().text().trim();
        if (t) groups[t] = this;
    });
    const frag = document.createDocumentFragment();
    for (const sec of SETTINGS_LAYOUT) {
        const picked = sec.titles.map((t) => groups[t]).filter(Boolean);
        if (!picked.length) continue;
        const h = document.createElement("div");
        h.className = "tinyfeed-settings-cat";
        h.textContent = sec.head;
        frag.appendChild(h);
        picked.forEach((el) => frag.appendChild(el));
        sec.titles.forEach((t) => delete groups[t]);
    }
    // กลุ่มที่ไม่ได้ระบุใน layout ต่อท้ายไว้ (กันตกหล่น)
    Object.values(groups).forEach((el) => frag.appendChild(el));
    screen.empty().append(frag);
    screen.attr("data-organized", "1");
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
    $("#tinyfeed-cfg-kw-scope").val(getSetting("keywordScope") || "both");
    $("#tinyfeed-cfg-kw-cooldown").val(getSetting("keywordCooldownSec"));
    renderKeywordEditors();
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

let settingsReturn = "feed";   // แอปที่จะกลับไปหลังปิด settings

function openSettings() {
    populateSettings();
    settingsReturn = currentApp === "settings" ? settingsReturn : currentApp;   // จำแอปเดิม
    // settings-screen อยู่ใน app-feed → ต้องโชว์ app-feed เป็น host แต่ซ่อนเนื้อฟีด
    $("#tinyfeed-home").addClass("tinyfeed-hidden");
    $(".tinyfeed-app").addClass("tinyfeed-hidden");
    $("#tinyfeed-app-feed").removeClass("tinyfeed-hidden");
    $(".tinyfeed-panel").addClass("tinyfeed-hidden");
    $("#tinyfeed-settings-screen").removeClass("tinyfeed-hidden");
    $(".tinyfeed-tabs").addClass("tinyfeed-hidden");
    $("#tinyfeed-home-btn, #tinyfeed-settings-btn").addClass("tinyfeed-hidden");
    $("#tinyfeed-back").removeClass("tinyfeed-hidden");
    $(".tinyfeed-title").text("ตั้งค่า");
    currentApp = "settings";
}

function closeSettings() {
    $("#tinyfeed-back").addClass("tinyfeed-hidden");
    if (settingsReturn === "home" || !settingsReturn) goHome();
    else openApp(settingsReturn);   // feed / connect / stream
}

// ปุ่มย้อนกลับใช้ร่วมกัน (settings หรือ detail)
function handleBack() {
    const overlayOpen = ["#tinyfeed-gallery-picker", "#tinyfeed-gallery-view", "#tinyfeed-gallery-edit", "#tinyfeed-char-picker", "#tinyfeed-slip-modal", "#tinyfeed-donate-modal"]
        .some((sel) => !$(sel).hasClass("tinyfeed-hidden"));
    if (overlayOpen) {
        closeGalleryOverlays();   // ปิด overlay ที่เปิดอยู่ก่อน
        closeCharPicker();
        closeSlipModal();
        closeDonateModal();
    } else if (currentApp === "connect" && isConnectThreadOpen()) {
        openConnectList();   // จากห้องแชต → กลับรายชื่อ
    } else if (currentApp === "forum" && isForumThreadOpen() && !isSettingsOpen()) {
        openForumList();     // จากหน้ากระทู้ → กลับรายการกระทู้
    } else if (isSettingsOpen()) {
        closeSettings();
    } else {
        closeDetail();
    }
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
        organizeSettings();   // จัดกลุ่มหน้า settings ให้เป็นสัดส่วน

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
        $(document).on("click", ".tinyfeed-memo-tab", function () {
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
        $(document).on("click", ".tinyfeed-forum-tab", function () {
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
        $(document).on("click", ".tinyfeed-shop-buy", function () { buyShopItem(String($(this).data("id"))); });
        $(document).on("click", ".tinyfeed-shop-del", function (e) {
            e.stopPropagation();
            deleteShopItem(String($(this).closest(".tinyfeed-shop-item").data("id")));
        });

        // ===== TinyGallery: จัดการคลัง + picker + ปุ่มสติกเกอร์ในแอปต่างๆ =====
        $(document).on("click", ".tinyfeed-gallery-tab", function () {
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
        $(document).on("click", ".tinyfeed-tab", function () {
            switchTab($(this).data("tab"));
        });

        // Stage 2.5: กดโพสต์/ข่าวเข้าหน้ารายละเอียด
        $(document).on("click", ".tinyfeed-post:not(.tinyfeed-post-detail)", function () {
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

        console.log(`[${extensionName}] ✅ Loaded successfully`);
    } catch (error) {
        console.error(`[${extensionName}] ❌ Failed to load:`, error);
    }
});

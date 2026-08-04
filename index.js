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
    widgetClock: true,        // วิดเจ็ตนาฬิกา+วันที่
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
    userAvatarUrl: "",          // รูปผู้ใช้ (global)
    charAvatarUrls: {},         // { "<ไฟล์ avatar การ์ด>": "url" } override รายตัวละคร
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
    // TinyStream
    streamStreamer: "char",       // "char" | "user"
    streamStreamerReply: true,    // สตรีมเมอร์อ่านคอมเมนต์เราแล้วตอบอัตโนมัติ
    streamStreamerTalk: false,    // สตรีมเมอร์เล่าเรื่องเองเป็นระยะ (มอโนล็อก)
    streamCommentMode: "manual",  // "manual" | "auto" | "onupdate"
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
    // TinyGallery (คลังรูป + สติกเกอร์ — global ข้ามแชท ไม่ผูกกับแชทไหน)
    gallery: { images: [], stickers: [], imageAlbums: ["ทั่วไป"], stickerAlbums: ["ทั่วไป"] },
    galleryPrompt: true,          // ให้บอทรู้จักคลัง + ส่งสติกเกอร์/รูปได้ด้วย [sticker:ชื่อ] / [img:ชื่อ]
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
    saveLastScreen();
}

function openApp(app) {
    if (app !== "feed" && app !== "connect" && app !== "stream" && app !== "memo" && app !== "forum" && app !== "gallery") {
        toastr.info("แอปนี้กำลังจะมา เร็วๆ นี้! 📱", "TinyPhone");
        return;
    }
    clearStreamTimer();   // ออกจากแอปอื่น = หยุด timer stream
    clearHomeClock();     // ออกจากโฮม = หยุดนาฬิกา
    closeGalleryPicker(); // กัน picker ค้างข้ามแอป
    $("#tinyfeed-home").addClass("tinyfeed-hidden");
    $(".tinyfeed-app").addClass("tinyfeed-hidden");
    $("#tinyfeed-home-btn, #tinyfeed-settings-btn").removeClass("tinyfeed-hidden");
    $("#tinyfeed-back").addClass("tinyfeed-hidden");

    if (app === "feed") {
        currentApp = "feed";
        $("#tinyfeed-app-feed").removeClass("tinyfeed-hidden");
        $(".tinyfeed-title").text("TinyFeed");
        $(".tinyfeed-tabs").removeClass("tinyfeed-hidden");
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
    return data.stream;
}

// true = ผู้ใช้เป็นสตรีมเมอร์เอง (ไม่ใช่ตัวละคร AI)
function streamerIsUser() {
    return getSetting("streamStreamer") === "user";
}

// สตรีมเมอร์ปัจจุบัน { name, avatarItem }
function getStreamer() {
    if (getSetting("streamStreamer") === "user") {
        return { name: getUserName(), avatarItem: { isUser: true, author: getUserName() } };
    }
    const char = getCurrentCharacter();
    const name = (char && char.name) || "ตัวละคร";
    return { name, avatarItem: { isMain: true, author: name } };
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
    $("#tinyfeed-app-stream .tinyfeed-stream-avatar").html(makeAvatar(streamer.avatarItem));
    $("#tinyfeed-app-stream .tinyfeed-stream-title").text(s.live ? (s.title || "กำลังไลฟ์สด") : "ยังไม่ได้เริ่มไลฟ์");
    $("#tinyfeed-app-stream .tinyfeed-stream-streamer").text(s.live ? `โดย ${streamer.name}${s.direction ? " · " + s.direction : ""}` : "");
    $("#tinyfeed-stream-toggle").text(s.live ? "จบไลฟ์" : "เริ่มไลฟ์");
    $(".tinyfeed-stream-live").toggleClass("tinyfeed-hidden", !s.live);
    $(".tinyfeed-stream-viewers").toggleClass("tinyfeed-hidden", !s.live).text(`👁 ${formatCount(s.viewers)}`);
    const userStreamer = streamerIsUser();
    // ตอนไลฟ์ใช้แถบเดียว: เราเป็นสตรีมเมอร์ = แถบคำพูดสตรีมเมอร์ · ไม่งั้น = แถบคอมเมนต์ผู้ชม
    $(".tinyfeed-stream-compose").toggleClass("tinyfeed-hidden", !(s.live && !userStreamer));
    $(".tinyfeed-stream-streamer-compose").toggleClass("tinyfeed-hidden", !(s.live && userStreamer));
    // ฟอร์มตั้งหัวข้อ + ปุ่มให้ AI ตั้งหัวข้อโชว์ตอนยังไม่ไลฟ์
    $("#tinyfeed-stream-startform").toggleClass("tinyfeed-hidden", s.live);
    $("#tinyfeed-stream-ai-title").toggleClass("tinyfeed-hidden", s.live);
    // ปุ่ม "ให้สตรีมเมอร์พูด" (AI) โชว์ตอนไลฟ์ & สตรีมเมอร์เป็นตัวละคร
    $("#tinyfeed-stream-speak").toggleClass("tinyfeed-hidden", !(s.live && !userStreamer));
    $("#tinyfeed-stream-loadcomments").toggleClass("tinyfeed-hidden",
        !(s.live && getSetting("streamCommentMode") === "manual"));

    // แคปชันบนเวที = ประโยคล่าสุดที่สตรีมเมอร์พูด
    const lastSpeak = [...s.comments].reverse().find((c) => c.isStreamer);
    $(".tinyfeed-stream-caption").toggleClass("tinyfeed-hidden", !(s.live && lastSpeak))
        .html(lastSpeak ? `🎙 ${renderRich(lastSpeak.text)}` : "");

    const rows = s.comments.map((c) => {
        if (c.isSystem) {
            return `<div class="tinyfeed-stream-divider"><span>${c.text}</span></div>`;
        }
        if (c.isStreamer) {
            return `<div class="tinyfeed-stream-speak-row">
                ${makeAvatar(streamer.avatarItem)}
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
            const raw = await tinyGenerate(q, 60);
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
        const q = buildPrompt("streamComments", {
            streamer: streamer.name, title: s.title,
            direction: s.direction ? ` แนวทางไลฟ์: ${s.direction}.` : "",
            roster: npcNames.length ? " หรือใช้ NPC เหล่านี้บ้าง: " + npcNames.join(", ") : "",
            extra: extra ? ` คำสั่งเพิ่มเติม: ${extra}.` : "",
            context: crossAppContext("stream"),
            recent: recent ? `\nคอมเมนต์ล่าสุด (อย่าซ้ำ):\n${recent}\n` : "",
        });
        const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("streamTokens"), 10) || 300));
        // กรองไม่ให้สตรีมเมอร์/ผู้ใช้โผล่เป็นผู้ชมสุ่ม
        const list = parseCommentLines(raw, streamer.name)
            .filter((c) => {
                const a = c.author.trim().toLowerCase();
                return a !== streamer.name.trim().toLowerCase() && a !== you.trim().toLowerCase();
            })
            .map((c) => ({ author: c.author, avatar: getNpcAvatar(c.author), text: c.text, ts: Date.now() }));
        if (list.length) {
            s.comments.push(...list);
            saveFeedData();
            renderStream();
        }
    } catch (e) {
        console.error(`[${extensionName}] live comments failed:`, e);
        if (!opts.silent) toastr.error("โหลดคอมเมนต์ไม่สำเร็จ", "TinyStream");
    } finally {
        isGeneratingStream = false;
        btn.removeClass("tinyfeed-generating").prop("disabled", false);
    }
}

// สตรีมเมอร์ (ตัวละคร) พูด/อ่านแชตแล้วตอบ — kind: "open" | "reply" | "talk"
async function streamerSpeak(kind, opts) {
    opts = opts || {};
    const s = getStreamData();
    if (!s.live || isGeneratingStream) return;
    const streamer = getStreamer();
    const you = getUserName();
    isGeneratingStream = true;
    try {
        const transcript = s.comments.slice(-8).filter((c) => !c.isSystem)
            .map((c) => `${c.isStreamer ? streamer.name + " (สตรีมเมอร์)" : c.author}: ${htmlToPlain(c.text)}`).join("\n");
        const task = kind === "open"
            ? ` ตอนนี้เพิ่งเปิดไลฟ์ — ทักทายผู้ชมและเกริ่นสั้นๆ ว่าจะไลฟ์เรื่องอะไร.`
            : kind === "reply"
                ? ` อ่านคอมเมนต์ล่าสุดของผู้ชม (โดยเฉพาะของ ${you}) แล้วโต้ตอบ/ตอบกลับแบบสตรีมเมอร์อ่านแชตสดๆ.`
                : ` พูดคุย/เล่าเรื่องต่อเกี่ยวกับหัวข้อไลฟ์ ให้ต่อเนื่องเป็นธรรมชาติ.`;
        const extra = String(getSetting("streamExtraPrompt") || "").trim();
        const q = buildPrompt("streamerSpeak", {
            streamer: streamer.name, title: s.title,
            direction: s.direction ? ` แนวทางไลฟ์: ${s.direction}.` : "",
            task,
            extra: (extra ? ` คำสั่งเพิ่มเติม: ${extra}.` : "") + galleryPromptBlock(),
            context: crossAppContext("stream"),
            transcript: transcript ? `\nแชตล่าสุด:\n${transcript}\n` : "",
        });
        const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("streamTokens"), 10) || 300));
        let line = stripWrapBrackets(stripReasoning(raw).trim());
        const esc = streamer.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        line = line.replace(new RegExp(`^${esc}\\s*[:：]\\s*`, "i"), "").trim();
        if (line) {
            s.comments.push({ isStreamer: true, author: streamer.name, text: escapeHtml(line), ts: Date.now() });
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
    }
}

// toggle "สตรีมเมอร์อ่านคอมเมนต์/มอโนล็อก" ใช้ได้เฉพาะสตรีมเมอร์ตัวละคร — เทาไว้ถ้าเราเป็นสตรีมเมอร์เอง
function refreshStreamerCfg() {
    const dis = streamerIsUser();
    $("#tinyfeed-cfg-stream-reply, #tinyfeed-cfg-stream-talk").prop("disabled", dis);
    $("#tinyfeed-cfg-stream-reply-row, #tinyfeed-cfg-stream-talk-row").toggleClass("tinyfeed-field-disabled", dis);
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
        const raw = await tinyGenerate(q, 60);
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
    const s = getStreamData();
    if (!s.live) return;
    let kind = "talk";
    for (let i = s.comments.length - 1; i >= 0; i--) {
        const c = s.comments[i];
        if (c.isStreamer) break;
        if (c.isUser) { kind = "reply"; break; }
    }
    streamerSpeak(kind, {});
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
    if (!clean || !s.live || !streamerIsUser()) return;
    s.comments.push({ isStreamer: true, author: getUserName(), text: escapeHtml(clean), ts: Date.now() });
    saveFeedData();
    $("#tinyfeed-stream-streamer-input").val("");
    renderStream();
    // โหมด onupdate: คำพูดสตรีมเมอร์ทำให้ผู้ชมรีแอค
    if (getSetting("streamCommentMode") === "onupdate") {
        await loadLiveComments({ silent: true });
    }
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
                <span class="tinyfeed-gallery-item-del" title="ลบ"><i class="fa-solid fa-trash"></i></span>
            </div>
            <div class="tinyfeed-gallery-item-name">${escapeText(it.name)}</div>
            ${it.caption ? `<div class="tinyfeed-gallery-item-cap">${escapeText(it.caption)}</div>` : ""}
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
    if (char) contacts.push({ key: "main", name: char.name, isMain: true, avatar: "" });
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
    // ปุ่ม "ให้กลุ่มคุยกันต่อ" โชว์เฉพาะห้องกลุ่ม
    $("#tinyfeed-group-chat-tools").toggleClass("tinyfeed-hidden", !findGroup(key));
    renderThread();
    saveLastScreen();
    $("#tinyfeed-connect-input").trigger("focus");
}

function renderThread() {
    if (!activeThread) return;
    const msgs = getThread(activeThread);
    const contact = getConnectContacts().find((c) => c.key === activeThread)
        || { name: activeThreadName, isMain: false, avatar: "" };
    const group = findGroup(activeThread);
    const delBtn = (i) => `<span class="tinyfeed-msg-del" data-idx="${i}" title="ลบข้อความ"><i class="fa-solid fa-trash"></i></span>`;
    // แยกข้อความหลายบรรทัด → หลายบับเบิล (ปิดได้จาก settings)
    const bubblesHtml = (text) => {
        // ข้อความถูกเก็บโดยแปลง \n เป็น <br> แล้ว (escapeHtml) → แยกตาม <br> และ \n
        const segs = getSetting("connectSplitBubbles")
            ? String(text || "").split(/(?:<br\s*\/?>|\n)+/i).map((s) => s.trim()).filter(Boolean)
            : [String(text || "")];
        const list = segs.length ? segs : [String(text || "")];
        return list.map((s) => `<div class="tinyfeed-msg-bubble">${renderRich(s)}</div>`).join("");
    };
    const rows = msgs.map((m, i) => {
        if (m.from === "user") {
            return `<div class="tinyfeed-msg tinyfeed-msg-user" data-idx="${i}">
                ${delBtn(i)}
                <div class="tinyfeed-msg-stack">${bubblesHtml(m.text)}</div>
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
                <div class="tinyfeed-msg-stack">${bubblesHtml(m.text)}</div>
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

async function sendConnectMessage(text) {
    const clean = String(text || "").trim();
    if (!clean || !activeThread) return;
    getThread(activeThread).push({ from: "user", text: escapeHtml(clean), ts: Date.now() });
    saveFeedData();
    $("#tinyfeed-connect-input").val("").css("height", "");   // เคลียร์ + คืนความสูงเริ่มต้น
    renderThread();
    await generateConnectReply();
}

async function generateConnectReply() {
    if (isConnectReplying || !activeThread) return;
    const name = activeThreadName;
    const you = getUserName();
    const group = findGroup(activeThread);
    const transcript = getThread(activeThread).slice(-12)
        .map((m) => `${m.from === "user" ? you : (group ? (m.author || name) : name)}: ${htmlToPlain(m.text)}`).join("\n");

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
            const raw = await tinyGenerate(qg, Math.max(1, parseInt(getSetting("connectTokens"), 10) || 200));
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

    const q =
        `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] นี่คือแชตส่วนตัวในแอปแชต (คล้ายไลน์) ระหว่าง ${you} กับ ${name}. ` +
        `ตอบข้อความล่าสุดในบทบาทของ ${name} แบบเป็นธรรมชาติ สั้นกระชับเหมือนแชตจริง (1-3 ประโยค) ` +
        `ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดหรือกระทำแทน ${you}.\n` +
        (String(getSetting("connectExtraPrompt") || "").trim() ? `คำสั่งเพิ่มเติม: ${String(getSetting("connectExtraPrompt")).trim()}.\n` : "") +
        crossAppContext("connect") +
        galleryPromptBlock() +
        `บทแชตล่าสุด:\n${transcript}\n` +
        `ตอบเฉพาะข้อความของ ${name} เท่านั้น ไม่ต้องใส่ชื่อนำหน้า`;

    isConnectReplying = true;
    renderThread();   // โชว์ "กำลังพิมพ์…"
    try {
        const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("connectTokens"), 10) || 200));
        let reply = stripReasoning(raw).trim();
        // ถ้าโมเดลห่อด้วย [... Message: ข้อความ] ให้ดึงเฉพาะเนื้อในออกมา
        const wrapped = [...reply.matchAll(/\[[^\]]*?Message:\s*([^\]]+)\]/gi)];
        if (wrapped.length) reply = wrapped.map((m) => m[1].trim()).join("\n");
        // ตัดวงเล็บ/ป้ายกำกับที่หลงเหลือ + "ชื่อ:" นำหน้า (ไม่ทำลายโทเคนสติกเกอร์/รูป)
        reply = stripWrapBrackets(reply);
        const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        reply = reply.replace(new RegExp(`^${esc}\\s*[:：]\\s*`, "i"), "").trim();
        if (reply) {
            getThread(activeThread).push({ from: "contact", text: escapeHtml(reply), ts: Date.now() });
            saveFeedData();
        } else {
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
function getNpcs() {
    const data = getFeedData();
    if (!Array.isArray(data.npcs)) data.npcs = [];
    return data.npcs;
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
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
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
    const override = (getSetting("charAvatarUrls") || {})[char.file];
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
function renderRich(html) {
    let s = String(html == null ? "" : html);
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
        const cap = im.caption ? `<span class="tinyfeed-content-img-cap">${escapeText(im.caption)}</span>` : "";
        return `<span class="tinyfeed-content-img-wrap"><img class="tinyfeed-content-img" src="${escapeAttr(im.url)}" alt="${escapeText(im.name)}" onerror="this.classList.add('tinyfeed-img-broken')" />${cap}</span>`;
    }
    return `<span class="tinyfeed-token-missing">[รูป: ${escapeText(name)}]</span>`;
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

// ชื่อ persona ของผู้ใช้ปัจจุบัน
function getUserName() {
    try {
        return getContext().name1 || "คุณ";
    } catch (e) {
        return "คุณ";
    }
}

// URL avatar ของ persona ผู้ใช้ ถ้าไม่ได้คืน "" แล้วให้ fallback เป็น anon
function getUserAvatar() {
    const override = getSetting("userAvatarUrl");
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
        src = getNpcAvatar(item.author);   // NPC ที่อยู่ในรายชื่อประจำ + มีลิงก์รูป
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
function galleryPromptBlock(max) {
    if (!getSetting("galleryPrompt")) return "";
    const g = getGallery();
    const cap = Math.max(1, parseInt(max, 10) || 24);
    const stk = g.stickers.slice(0, cap).map((s) => s.name).filter(Boolean);
    const img = g.images.slice(0, cap).map((s) => s.caption ? `${s.name} (${htmlToPlain(s.caption)})` : s.name).filter(Boolean);
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
    const mode = getSetting("injectMode") || "off";
    // โหมด: off | posts | news | posts_comments | posts_comments_news  ("both" เก่า = โพสต์+ข่าว)
    const wantFeed = ["posts", "posts_comments", "posts_comments_news", "both"].includes(mode);
    const wantComments = ["posts_comments", "posts_comments_news"].includes(mode);
    const wantNews = ["news", "posts_comments_news", "both"].includes(mode);
    const wantConnect = Boolean(getSetting("injectConnect"));
    const wantStream = Boolean(getSetting("injectStream"));
    const wantMemo = Boolean(getSetting("injectMemo"));
    const wantForum = Boolean(getSetting("injectForum"));
    const wantForumComments = Boolean(getSetting("injectForumComments"));
    const depth = Math.max(0, parseInt(getSetting("injectDepth"), 10) || 4);
    const count = Math.max(1, parseInt(getSetting("injectCount"), 10) || 5);

    if (!wantFeed && !wantNews && !wantConnect && !wantStream && !wantMemo && !wantForum) {
        ctx.setExtensionPrompt("tinyfeed_inject", "", 1, 0);   // เคลียร์
        return;
    }
    const blocks = buildAppBlocks({
        feed: wantFeed,
        comments: wantComments,
        news: wantNews,
        connect: wantConnect,
        stream: wantStream,
        memo: wantMemo,
        forum: wantForum,
        forumComments: wantForumComments,
        count,
    });

    const text = blocks.length
        ? `[ข้อมูลจากโทรศัพท์ TinyPhone ที่ตัวละครรับรู้ได้ ใช้อ้างอิงในบทบาทได้ตามเหมาะสม]\n${blocks.join("\n\n")}`
        : "";
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
            <div class="tinyfeed-post-body">${renderRich(post.text)}</div>
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

// อัปเดตรูป avatar ในช่องเขียนโพสต์ให้ตรงกับ persona ปัจจุบัน
function renderComposeAvatar() {
    $("#tinyfeed-compose .tinyfeed-compose-avatar").html(
        makeAvatar({ author: getUserName(), avatar: getUserAvatar() })
    );
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
            <div class="tinyfeed-post-body">${renderRich(post.text)}</div>
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
        ${post.comments.length === 0 ? `
            <div class="tinyfeed-post-comment-tools">
                <button class="tinyfeed-btn-generate tinyfeed-gen-comments" data-post="${post.id}">
                    <i class="fa-solid fa-comment-medical"></i>
                    <span>ให้ NPC คอมเมนต์</span>
                </button>
            </div>` : ""}
        ${getSetting("commentReplyMode") === "manual" && post.comments.length ? `
            <button class="tinyfeed-ai-reply tinyfeed-btn-generate" data-post="${post.id}">
                <i class="fa-solid fa-wand-magic-sparkles"></i> <span>ให้ AI ตอบ</span>
            </button>` : ""}
        <div class="tinyfeed-comment-compose">
            ${makeAvatar({ isUser: true, author: getUserName() })}
            <input class="tinyfeed-comment-input" type="text" placeholder="เขียนคอมเมนต์..." data-post="${post.id}" />
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
        if (char) charLines.push(`ชื่อ: ${char.name}`);
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
async function tinyGenerate(prompt, maxTokens) {
    const ctx = getContext();
    const profileId = getSetting("apiProfile");
    if (profileId && ctx.ConnectionManagerRequestService) {
        try {
            const full = (await buildContextPreamble()) + prompt;
            const res = await ctx.ConnectionManagerRequestService.sendRequest(profileId, full, maxTokens);
            const content = res && typeof res.content === "string" ? res.content : "";
            if (content) return content;
            console.warn(`[${extensionName}] profile ส่งข้อความว่าง — fallback ไป API หลัก`);
        } catch (e) {
            console.error(`[${extensionName}] profile request ล้มเหลว fallback ไป API หลัก:`, e);
        }
    }
    // API หลัก (generateQuietPrompt แนบ context RP ให้เอง)
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
    const btn = $("#tinyfeed-generate");
    btn.addClass("tinyfeed-generating").prop("disabled", true);
    btn.find(".tinyfeed-generate-label").text("กำลังสร้าง...");
    $("#tinyfeed-feed-list").prepend(`<div id="tinyfeed-feed-skel">${skeletonCardHtml()}</div>`);

    const charName = char.name || "ตัวละคร";

    // 6.5: รายชื่อ NPC ประจำ → คุมให้ AI เลือกผู้โพสต์จากลิสต์
    const npcNames = getNpcs().map((n) => String(n.name || "").trim()).filter(Boolean);
    const rosterLine = npcNames.length
        ? `ผู้โพสต์ต้องเป็น ${charName} หรือหนึ่งใน NPC ต่อไปนี้เท่านั้น (สะกดชื่อให้ตรงเป๊ะ): ${npcNames.join(", ")}. `
        : `ผู้โพสต์จะเป็น ${charName} หรือ NPC ตัวใดตัวหนึ่งในโลกของเรื่องก็ได้. `;

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
    const extraLine = (extra ? `คำสั่งเพิ่มเติมจากผู้ใช้: ${extra}. ` : "") + galleryPromptBlock();

    const quietPrompt = buildPrompt("feedPost", {
        roster: rosterLine, extra: extraLine, history: historyLine, context: crossAppContext("feed"),
    });

    try {
        const raw = await tinyGenerate(quietPrompt, Math.max(1, parseInt(getSetting("postTokens"), 10) || 400));
        const { author, text } = parseGeneratedPost(raw, charName);
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
        if (!opts.silent) toastr.error("สร้างโพสต์ไม่สำเร็จ ลองใหม่อีกครั้งนะ", "TinyFeed");
    } finally {
        $("#tinyfeed-feed-skel").remove();
        isGenerating = false;
        btn.removeClass("tinyfeed-generating").prop("disabled", false);
        btn.find(".tinyfeed-generate-label").text("ให้ตัวละครโพสต์");
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

// AI ตอบคอมเมนต์ 1 อัน (เลือกผู้ตอบเอง: เจ้าของโพสต์หรือ NPC)
async function generateCommentReply(postId) {
    if (isReplying) return;
    const ctx = getContext();
    if (typeof ctx.generateQuietPrompt !== "function") return;
    const post = getFeedData().feed.find((p) => p.id === postId);
    if (!post) return;
    const char = getCurrentCharacter();
    const charName = (char && char.name) || "ตัวละคร";

    const thread = post.comments.slice(-6)
        .map((c) => `- ${c.author}: ${htmlToPlain(c.text)}`).join("\n");
    const q = buildPrompt("feedCommentReply", {
        postText: htmlToPlain(post.text), author: post.author, thread: thread, roster: npcRosterLine(charName),
    });

    isReplying = postId;
    openPostDetail(postId);   // โชว์ "กำลังพิมพ์…"
    try {
        const raw = await tinyGenerate(q, 150);
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
    const charName = (char && char.name) || "ตัวละคร";

    let countLine;
    if (mode === "fixed") {
        const nc = Math.max(1, parseInt(getSetting("initialCommentCount"), 10) || 1);
        countLine = `เขียนคอมเมนต์ ${nc} อัน. `;
    } else {
        countLine = `เขียนคอมเมนต์ 0 ถึง 3 อันตามที่เหมาะสม (ถ้าไม่มีใครน่าคอมเมนต์ก็ไม่ต้องเขียน). `;
    }
    const q = buildPrompt("feedInitialComments", {
        postText: htmlToPlain(post.text), author: post.author, roster: npcRosterLine(charName), count: countLine,
    });
    const raw = await tinyGenerate(q, 300);
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
    const extraLine = extra ? ` คำสั่งเพิ่มเติมจากผู้ใช้: ${extra}.` : "";

    const q = buildPrompt("news", {
        extra: extraLine, history: historyLine, context: crossAppContext("news"),
    });

    try {
        const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("newsTokens"), 10) || 500));
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
        const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("memoTokens"), 10) || 350));
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
    const charName = char.name || "ตัวละคร";
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
        const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("forumTokens"), 10) || 500));
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
    const charName = (char && char.name) || "ตัวละคร";
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
        const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("forumTokens"), 10) || 500));
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
async function onChatMessage() {
    lastRpMsgTs = Date.now();   // มี RP activity → รีเซ็ตตัวจับเวลา idle
    if (isAutoBusy || isGenerating || isGeneratingNews) return;
    if (!getCurrentCharacter()) return;

    const feedOn = getSetting("autoGenerate");
    const newsOn = getSetting("newsAutoGenerate");
    const memoOn = getSetting("memoAutoGenerate");
    const forumOn = getSetting("forumAutoGenerate");
    if (feedOn) autoMsgCount++;
    if (newsOn) autoNewsCount++;
    if (memoOn) autoMemoCount++;
    if (forumOn) autoForumCount++;

    // โพสต์ฟีดก่อน (ถ้าถึงรอบ) — แอปอื่นรอรอบถัดไป กัน generate ซ้อนในทีเดียว
    const feedInterval = Math.max(1, parseInt(getSetting("autoGenerateInterval"), 10) || 10);
    if (feedOn && autoMsgCount >= feedInterval) {
        autoMsgCount = 0;
        isAutoBusy = true;
        try {
            if ((getSetting("autoGenerateMode") || "interval") === "ai") {
                if (!(await aiDecidesToPost())) return;
            }
            await generateFeedPost({ notify: true, silent: true });
        } finally { isAutoBusy = false; }
        return;
    }

    // TinyMemo (กำหนดการ + ความจำ)
    const memoInterval = Math.max(1, parseInt(getSetting("memoAutoInterval"), 10) || 15);
    if (memoOn && autoMemoCount >= memoInterval) {
        autoMemoCount = 0;
        isAutoBusy = true;
        try {
            if ((getSetting("memoAutoMode") || "interval") === "ai") {
                if (!(await aiDecidesMemo())) return;
            }
            await scanMemo({ notify: true, silent: true });
        } finally { isAutoBusy = false; }
        return;
    }

    // TinyForum (กระทู้)
    const forumInterval = Math.max(1, parseInt(getSetting("forumAutoInterval"), 10) || 20);
    if (forumOn && autoForumCount >= forumInterval) {
        autoForumCount = 0;
        isAutoBusy = true;
        try {
            if ((getSetting("forumAutoMode") || "interval") === "ai") {
                if (!(await aiDecidesToPost())) return;
            }
            await generateForumThread({ notify: true, silent: true });
        } finally { isAutoBusy = false; }
        return;
    }

    // ข่าว
    const newsInterval = Math.max(1, parseInt(getSetting("newsAutoInterval"), 10) || 20);
    if (newsOn && autoNewsCount >= newsInterval) {
        autoNewsCount = 0;
        isAutoBusy = true;
        try {
            if ((getSetting("newsAutoMode") || "interval") === "ai") {
                if (!(await aiDecidesToPost())) return;
            }
            await generateNews({ notify: true, silent: true });
        } finally { isAutoBusy = false; }
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
        reply = stripReasoning(await tinyGenerate(q, Math.max(1, parseInt(getSetting("proactiveTokens"), 10) || 120))).trim();
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
        const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("connectTokens"), 10) || 200));
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
const MEMO_APPS = ["feed", "connect", "stream", "memo", "forum", "gallery"];
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

// ขยายช่องเขียนโพสต์ (ช่องเดิมโตขึ้น + โชว์ปุ่ม)
function openCompose() {
    $("#tinyfeed-compose").addClass("tinyfeed-compose-open");
    $("#tinyfeed-compose .tinyfeed-compose-actions").removeClass("tinyfeed-hidden");
}

// ยุบช่องกลับเป็นแถบเดียว
function closeCompose() {
    const input = $("#tinyfeed-compose-input");
    input.val("").css("height", "");   // เคลียร์ค่าและความสูง inline (กลับไปใช้ความสูงจาก CSS)
    $("#tinyfeed-compose-post").prop("disabled", true);
    $("#tinyfeed-compose .tinyfeed-compose-actions").addClass("tinyfeed-hidden");
    $("#tinyfeed-compose").removeClass("tinyfeed-compose-open");
    input.trigger("blur");
}

// ปรับความสูง textarea ตามเนื้อหา
function autoGrowCompose(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
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
        head: "⚙️ ตั้งค่าเครื่อง",
        titles: ["ปรับแต่งหน้าตา", "การแจ้งเตือน", "ทักเชิงรุก (ตัวละครทักเอง)", "โมเดล / API", "วอลเปเปอร์", "รูปโปรไฟล์", "NPC ประจำ (แชทนี้)", "แทรกฟีดเข้าประวัติแชท"],
    },
    {
        head: "📱 TinyFeed",
        titles: ["โพสต์จากตัวละคร (AI)", "สร้างโพสต์อัตโนมัติ", "คอมเมนต์", "ข่าวสาร"],
    },
    { head: "💬 TinyConnect", titles: ["TinyConnect (แชต)"] },
    { head: "🎥 TinyStream", titles: ["TinyStream (ไลฟ์สตรีม)"] },
    { head: "📅 TinyMemo", titles: ["TinyMemo (กำหนดการ + โน้ต)"] },
    { head: "🗣️ TinyForum", titles: ["TinyForum (เว็บบอร์ด)"] },
    { head: "🖼️ TinyGallery", titles: ["TinyGallery (คลังรูป + สติกเกอร์)"] },
    { head: "🧩 Prompt (ขั้นสูง)", titles: ["Prompt (ขั้นสูง)"] },
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
    $("#tinyfeed-cfg-user-avatar").val(getSetting("userAvatarUrl") || "");

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
    $("#tinyfeed-cfg-customcss").val(getSetting("customCss") || "");

    const char = getCurrentCharacter();
    const charInput = $("#tinyfeed-cfg-char-avatar");
    if (char) {
        const map = getSetting("charAvatarUrls") || {};
        $("#tinyfeed-cfg-char-name").text(char.name || "ตัวละคร");
        charInput.prop("disabled", false).val(map[char.file] || "");
    } else {
        $("#tinyfeed-cfg-char-name").text("(ไม่มีตัวละครในแชทนี้)");
        charInput.prop("disabled", true).val("");
    }

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

    $("#tinyfeed-cfg-stream-streamer").val(getSetting("streamStreamer") || "char");
    $("#tinyfeed-cfg-stream-mode").val(getSetting("streamCommentMode") || "manual");
    $("#tinyfeed-cfg-stream-interval").val(getSetting("streamAutoInterval"));
    $("#tinyfeed-cfg-stream-tokens").val(getSetting("streamTokens"));
    $("#tinyfeed-cfg-stream-extra").val(getSetting("streamExtraPrompt"));
    $("#tinyfeed-cfg-stream-reply").prop("checked", Boolean(getSetting("streamStreamerReply")));
    $("#tinyfeed-cfg-stream-talk").prop("checked", Boolean(getSetting("streamStreamerTalk")));
    refreshStreamerCfg();
    $("#tinyfeed-cfg-connect-tokens").val(getSetting("connectTokens"));
    $("#tinyfeed-cfg-connect-extra").val(getSetting("connectExtraPrompt"));
    $("#tinyfeed-cfg-connect-split").prop("checked", Boolean(getSetting("connectSplitBubbles")));

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
    $("#tinyfeed-cfg-gallery-prompt").prop("checked", Boolean(getSetting("galleryPrompt")));
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
    if (!$("#tinyfeed-gallery-picker").hasClass("tinyfeed-hidden")) {
        closeGalleryPicker();   // ปิด picker ก่อนถ้าเปิดอยู่
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
        $(document).on("click", "#tinyfeed-stream-sticker", function () {
            openGalleryPicker("sticker", (token) => sendStreamComment(token));
        });
        $(document).on("click", "#tinyfeed-stream-streamer-sticker", function () {
            openGalleryPicker("sticker", (token) => sendStreamerLine(token));
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
        $(document).on("focus", "#tinyfeed-compose-input", openCompose);
        $(document).on("click", "#tinyfeed-compose-cancel", closeCompose);
        $(document).on("input", "#tinyfeed-compose-input", function () {
            autoGrowCompose(this);
            const empty = $(this).val().trim().length === 0;
            $("#tinyfeed-compose-post").prop("disabled", empty);
        });
        $(document).on("click", "#tinyfeed-compose-post", function () {
            addUserPost($("#tinyfeed-compose-input").val());
            closeCompose();
        });
        $(document).on("click", ".tinyfeed-delete", function (e) {
            e.stopPropagation();
            deleteUserPost($(this).data("post"));
        });

        // Stage 6: ปุ่มให้ AI สร้างโพสต์
        $(document).on("click", "#tinyfeed-generate", function () {
            generateFeedPost();   // ปุ่ม manual: ไม่แจ้งเตือน (ผู้ใช้ดูอยู่แล้ว)
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

        // Stage 8: คอมเมนต์
        $(document).on("click", ".tinyfeed-comment-send", function () {
            const input = $(this).closest(".tinyfeed-comment-compose").find(".tinyfeed-comment-input");
            addComment($(this).data("post"), input.val());
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
        // ลิงก์รูปผู้ใช้ (override) — พิมพ์แล้วอัปเดตฟีดทันที
        $(document).on("input", "#tinyfeed-cfg-user-avatar", function () {
            setSetting("userAvatarUrl", $(this).val().trim());
            renderFeed();
        });
        // ลิงก์รูปตัวละคร (override รายตัว keyed by ไฟล์ avatar)
        $(document).on("input", "#tinyfeed-cfg-char-avatar", function () {
            const char = getCurrentCharacter();
            if (!char) return;
            const map = Object.assign({}, getSetting("charAvatarUrls"));
            const val = $(this).val().trim();
            if (val) map[char.file] = val; else delete map[char.file];
            setSetting("charAvatarUrls", map);
            renderFeed();
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
            saveFeedData();
            renderNpcList();
        });
        $(document).on("input", ".tinyfeed-npc-name", function () {
            const i = $(this).closest(".tinyfeed-npc-row").data("index");
            const npcs = getNpcs();
            if (npcs[i]) { npcs[i].name = $(this).val(); saveFeedData(); renderFeed(); }
        });
        $(document).on("input", ".tinyfeed-npc-avatar", function () {
            const i = $(this).closest(".tinyfeed-npc-row").data("index");
            const npcs = getNpcs();
            if (npcs[i]) { npcs[i].avatar = $(this).val().trim(); saveFeedData(); renderFeed(); }
        });
        $(document).on("click", ".tinyfeed-npc-del", function () {
            const i = $(this).closest(".tinyfeed-npc-row").data("index");
            const npcs = getNpcs();
            if (npcs[i]) { npcs.splice(i, 1); saveFeedData(); renderNpcList(); renderFeed(); }
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
        $(document).on("change", "#tinyfeed-cfg-stream-streamer", function () {
            setSetting("streamStreamer", $(this).val());
            refreshStreamerCfg();
            if (currentApp === "stream") { renderStream(); maybeStartStreamTimer(); }
        });
        $(document).on("change", "#tinyfeed-cfg-stream-mode", function () {
            setSetting("streamCommentMode", $(this).val());
            if (currentApp === "stream") { renderStream(); maybeStartStreamTimer(); }
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
        $(document).on("change", "#tinyfeed-cfg-gallery-prompt", function () {
            setSetting("galleryPrompt", $(this).prop("checked"));
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

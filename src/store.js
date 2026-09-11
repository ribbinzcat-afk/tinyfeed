/* ===== store: ที่เก็บข้อมูลทั้งหมดของ TinyPhone =====
 * global (ข้ามแชท) : extension_settings.tinyfeed  → getSetting / setSetting
 * per-chat         : chat_metadata.tinyfeed       → getFeedData / saveFeedData
 * กติกาว่าอะไรควรอยู่ชั้นไหน ดู CONVENTIONS.md บทที่ 5
 * โมดูลนี้เป็น leaf — ห้าม import อะไรจาก index.js หรือ util.js (กัน circular) */
import { extension_settings, getContext } from "../../../../extensions.js";
import { saveSettings, saveSettingsDebounced } from "../../../../../script.js";

export const extensionName = "tinyfeed";
export const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
export const METADATA_KEY = "tinyfeed";

export const defaultSettings = {
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
    // หน้าโฮม: เปิด/ปิด + จัดลำดับแอป ([] ทั้งคู่ = ใช้ลำดับ/แสดงผลตาม APPS ในโค้ดเป๊ะๆ)
    homeAppOrder: [],         // ["feed","connect",...] ลำดับที่ผู้ใช้จัดเอง — แอปที่ไม่อยู่ในนี้ต่อท้ายตามลำดับเดิม
    homeAppHidden: [],        // id ของแอปที่ผู้ใช้ปิดไว้ ไม่โชว์บนหน้าโฮม (ยังเปิดใช้งานผ่านทางอื่นได้ตามปกติ)
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
    commentTokens: 300,          // ความยาวคอมเมนต์สูงสุด (token) — ใช้ทั้งตอบคอมเมนต์เดี่ยวและคอมเมนต์ติดโพสต์ใหม่
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
    connectBubbleColor: "",       // "" = เขียวเดิม · "accent" = ตามสีเน้น · หรือ hex ที่เลือกเอง
    connectTimeGapMin: 30,        // เว้นระยะกี่นาทีถึงขึ้นเส้นคั่นเวลาในแชท
    connectBgUrl: "",             // พื้นหลังแชทกลาง (ใช้เป็นค่าเริ่มต้นของห้องที่ยังไม่ได้ตั้งเอง)
    connectBgOverlay: 45,         // ความมืดฝ้าทับพื้นหลังแชท (0–100%)
    connectAutoGenerate: false,   // ให้คู่แชททักหาเราเองอัตโนมัติ (ตามจังหวะ RP)
    connectAutoMode: "interval",  // "interval" | "ai" | "keyword"
    connectAutoInterval: 12,      // ทักทุกๆ กี่ข้อความ (โหมด interval)
    // TinyConnect: การโทร
    callAiCallEnabled: false,     // ให้ตัวละครโทรหาเราเองได้ (ผ่าน marker CALL: ตอนตอบแชต)
    callProactiveChance: 0,       // % โอกาสที่จะโทรมาแทน DM ทักปกติ ตอนถึงรอบทักเชิงรุก (0 = ปิด)
    callRingSec: 30,              // สายเข้าเรียกกี่วินาทีก่อนถือว่าไม่ได้รับ
    callTokens: 160,              // token ต่อคำตอบ 1 เทิร์นระหว่างคุยสาย
    callExtraPrompt: "",          // คำสั่งเสริมของบทพูดตอนคุยสาย
    callLogToMainChat: true,      // แทรกบันทึกการโทรลงประวัติแชทหลักของ SillyTavern (บล็อกพับได้ + ให้ AI อ่านได้)
    callHistoryMax: 30,           // เก็บประวัติการโทรสูงสุดกี่รายการต่อแชท (เก่ากว่านั้นตัดทิ้ง)
    callAutoGenerate: false,      // ให้ระบบโทรมาเองตามจังหวะ RP โดยเฉพาะ (แยกจาก marker CALL: ตอนตอบแชต 1:1) — ต้องเปิด callAiCallEnabled ด้วย
    callAutoMode: "interval",     // "interval" | "ai" | "keyword"
    callAutoInterval: 20,         // โทรมาทุกๆ กี่ข้อความ (โหมด interval)
    callKeywords: "โทรหา, โทรมา, โทรศัพท์, วิดีโอคอล, โทรสาย, call me, calling, phone call",
    callAiHangupEnabled: false,   // ให้ตัวละครวางสายเองได้กลางบทสนทนา (มาร์คเกอร์ HANGUP: ในคำตอบระหว่างคุยสาย)
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
    injectBank: false,            // แทรกยอดเงิน + ธุรกรรมล่าสุด เข้า RP
    injectShop: false,            // แทรกของที่ซื้อไว้ เข้า RP
    injectBag: false,             // แทรกของในกระเป๋า TinyBag เข้า RP
    injectPet: false,             // แทรกสถานะสัตว์เลี้ยง เข้า RP
    injectAsk: false,             // แทรกคำถาม-คำตอบล่าสุดใน TinyAsk เข้า RP
    // TinyBank (ธนาคาร/การเงิน — ยอดเงินผูกกับแชท)
    bankCurrency: "฿",            // (fallback เท่านั้น) สกุลเงินจริงผูกกับตัวละคร — ดู getCharCurrency() ใน index.js · ใช้ตอนไม่มีตัวละครในแชท
    bankCurrencyAfter: false,     // (fallback) ตำแหน่งสัญลักษณ์เมื่อไม่มีตัวละคร — ค่าจริงต่อตัวละครอยู่ที่ charCurrency
    streamDonateEnabled: false,   // เปิดระบบโดเนทในไลฟ์ (AI กำหนดผู้โดเนท/จำนวน/ข้อความเอง)
    bankDonateMax: 5000,          // เพดานยอดโดเนทต่อครั้ง (กัน AI ให้หลุด)
    bankScanAutoGenerate: false,  // สแกนเงินเข้า-ออกจากบท RP อัตโนมัติ (เจอแล้วรอรีวิว ไม่เข้าบัญชีทันที)
    bankScanAutoMode: "interval", // "interval" | "ai" | "keyword"
    bankScanAutoInterval: 15,
    bankScanTokens: 300,
    bankScanExtraPrompt: "",
    bankRpMax: 5000,               // เพดานยอดต่อรายการที่สแกนเจอ (กัน AI ใส่ตัวเลขหลุด)
    connectSlipEnabled: false,    // ให้คู่แชทส่งสลิปโอนเงินเข้าบัญชีเราได้ (AI)
    connectGiftEnabled: false,    // ให้คู่แชทซื้อของจากร้าน TinyShop ส่งเป็นของขวัญให้เราได้ (AI) — จับคู่ชื่อกับแคตตาล็อกจริงเท่านั้น
    connectReadReceipts: false,   // เปิดสถานะ "อ่านแล้ว" ในแชต 1:1 — AI อาจเลือกอ่านเฉยๆ ไม่ตอบก็ได้ (เฉพาะแชต 1:1 ไม่รวมกลุ่ม/เพ็ท)
    connectReadOnlyChance: 25,    // % โอกาสต่อรอบที่จะ "อ่านไม่ตอบ" ทันทีโดยไม่ยิงโมเดลเลย (ชั้นที่ 1 — ดู CONNECT_MARKERS.read สำหรับชั้นที่ 2)
    shop: [],                     // (legacy) แคตตาล็อกเดิมตอนยังเป็น global — เหลือไว้ให้ getShop() สำเนาเข้าแชทครั้งแรกเท่านั้น ไม่ได้ใช้อ่าน/เขียนตรงๆ แล้ว
    shopCategories: ["เสื้อผ้า", "ของกิน", "ไอเทม/ของใช้", "ของแต่งบ้าน", "อื่นๆ"],  // หมวดสินค้า (แก้ในตั้งค่า)
    shopTokens: 400,              // ความยาวผลลัพธ์ตอน AI สร้างสินค้า
    shopExtraPrompt: "",          // คำสั่งเสริมตอน AI สร้างสินค้า
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
    crossAppBank: false,          // การเงิน TinyBank
    crossAppShop: false,          // ของที่ซื้อไว้ TinyShop
    crossAppBag: false,           // ของในกระเป๋า TinyBag
    crossAppPet: false,           // สถานะสัตว์เลี้ยง TinyPet
    crossAppAsk: false,           // คำถาม-คำตอบ TinyAsk
    // ── ทริกเกอร์ด้วยคีย์เวิร์ด: เมื่อโหมด auto ของแอปตั้งเป็น "keyword" ──
    // เจอคำเหล่านี้ในข้อความ RP ล่าสุด → สั่งแอปนั้นสร้างเนื้อหา (มี cooldown กันถี่)
    // ฟรี ทำงานฝั่งเบราว์เซอร์ ไม่มีดีเลย์/ไม่ต้องโหลดโมเดล (embedding เป็นแผนอนาคต)
    feedKeywords: "โพสต์, ลงฟีด, ลงรูป, ลงสตอรี่, เล่นโซเชียล, ถ่ายรูปลง, อัปรูป, story, post, feed",
    newsKeywords: "ข่าว, อ่านข่าว, เปิดข่าว, ดูข่าว, ประกาศ, มีข่าวว่า, news, breaking",
    memoKeywords: "จดไว้, โน้ตไว้, เตือนความจำ, กันลืม, นัดหมาย, กำหนดการ, ตารางงาน, memo, reminder, todo",
    forumKeywords: "กระทู้, เว็บบอร์ด, พันทิป, ตั้งกระทู้, ในบอร์ด, ชาวเน็ต, forum, pantip",
    connectKeywords: "แชต, ทักไลน์, ส่งไลน์, ทักมา, ส่งข้อความ, ไลน์มา, chat, line, dm, ทักหา",
    askKeywords: "ถาม, สงสัย, กล่องคำถาม, มีคนถามว่า, ask, ngl",
    bankKeywords: "ได้เงิน, ค่าจ้าง, ได้รับเงิน, จ่ายเงิน, เสียเงิน, โดนขโมยเงิน, รางวัล, เงินเดือน, money, paid, reward",
    keywordCooldownSec: 45,       // เว้นระยะขั้นต่ำต่อแอป (วินาที) กันทริกเกอร์ถี่เกิน
    keywordScope: "both",         // ทริกเกอร์คีย์เวิร์ดจับข้อความฝั่งไหน: "both" | "char" | "user"
    // ── TinyPet (สัตว์เลี้ยงเสมือน — global ข้ามแชท, เก็บใน key "pet") ──
    petSprites: {},               // { state: url } override รูป sprite ต่อสถานะ ("" = ใช้ไฟล์ในตัว)
    petDecayHunger: 0.25,         // หิวเพิ่ม/นาที (ลดจากเดิม 0.5 — ยืดเวลาตายให้นานขึ้น)
    petDecayEnergy: 0.2,          // พลังงานลด/นาที (ลดจากเดิม 0.35)
    petDecayClean: 0.15,          // ความสะอาดลด/นาที (ลดจากเดิม 0.3)
    petOfflineCapHours: 12,       // เพดานคิด decay ตอนหายไปนาน (ชม.) — พอให้หายข้ามคืนแล้วยังไม่ตาย แต่โทรมมาก
    petIdlePauseMin: 20,          // เงียบ (ไม่มีข้อความ RP) เกินกี่นาทีถึงหยุดคิด decay ชั่วคราว (0 = ปิด)
    petNoDeath: false,            // โหมดไม่ตาย — สุขภาพต่ำสุดค้างที่ 1 ป่วยหนักได้แต่ไม่ตาย
    petAiReactions: true,         // ให้ AI แต่งบทพูดเพ็ทหลังกดปุ่ม
    petAiCareEnabled: false,      // ให้คู่แชท (ตัวละคร) ช่วยดูแลเพ็ทได้จากในแชต (ป้อนอาหาร/เล่นด้วย/อาบน้ำ — ไม่รวมกล่อมนอน)
    petAiCareCooldownMin: 30,     // กันตัวละครสแปมดูแลเพ็ทถี่เกินไป (นาที)
    petTokens: 60,                // ความยาวบทพูดเพ็ท
    petExtraPrompt: "",           // คำสั่งเสริมบทพูดเพ็ท (นิสัย/สายพันธุ์/โทน)
    petAutoPost: false,           // ให้เพ็ทโพสต์ลงฟีดเองเป็นระยะ (ตอนอารมณ์ดี)
    // ร้านสัตว์เลี้ยง (แยกจาก TinyShop) — ซื้อด้วย "เหรียญเพ็ท" (เติมจาก TinyBank / รับจากมินิเกม)
    petCoinRate: 1,               // เหรียญที่ได้ต่อ 1 บาท TinyBank ตอนเติม
    petGameEnergyCost: 15,        // พลังงานที่ใช้ต่อการเล่นมินิเกม 1 รอบ (เป็นตัวจำกัดกันฟาร์มเหรียญ)
    petShop: [                    // [{ id, name, price(เหรียญ), emoji, image, type, amount, desc }]
        { id: "pi_food1", name: "ขนมอบกรอบ", price: 8, emoji: "🍪", image: "", type: "food", amount: 40, desc: "ของว่างอร่อยๆ" },
        { id: "pi_toy1", name: "ลูกบอลนุ่ม", price: 12, emoji: "🎾", image: "", type: "toy", amount: 30, desc: "ของเล่นโปรด" },
        { id: "pi_care1", name: "สบู่หอม", price: 10, emoji: "🧼", image: "", type: "care", amount: 60, desc: "อาบน้ำหอมสะอาด" },
    ],
    // TinyAsk (ถาม-ตอบนิรนาม สไตล์ NGL/ask.fm — ผูกกับแชท)
    askAutoGenerate: false,       // ให้คนส่งคำถามนิรนามเข้ามาเองเป็นระยะ
    askAutoMode: "interval",      // "interval" | "ai" | "keyword"
    askAutoInterval: 18,
    askTokens: 200,               // ความยาวผลลัพธ์ตอน AI สร้างคำถาม/คำตอบ
    askExtraPrompt: "",           // คำสั่งเสริม (โทน/ธีมของคำถาม)
    askReveal: false,             // เฉลยชื่อผู้ถามจริงได้ (ปุ่ม 👁 บนการ์ด) — ปิดโดยดีฟอลต์
};

export function getSetting(key) {
    const s = extension_settings[extensionName] || {};
    return s[key] !== undefined ? s[key] : defaultSettings[key];
}

export function setSetting(key, value) {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    extension_settings[extensionName][key] = value;
    saveSettingsDebounced();
}

export function getSeedData() {
    return {
        feed: [],
        news: [],
        npcs: [],   // รายชื่อ NPC ประจำของแชทนี้ [{ name, avatar }]
        agenda: [], // TinyMemo กำหนดการ [{ id, when, title, status, isAI, ts }]
        notes: [],  // TinyMemo โน้ต/ความจำ [{ id, text, kind, isAI, ts }]
        forum: [],  // TinyForum กระทู้ [{ id, room, title, body, author, likes, comments:[] }]
        ask: [],    // TinyAsk คำถามนิรนาม [{ id, owner, from, anon, byUser, text, answer, ts, answerTs, likes, liked }]
    };
}

export function cleanupMockData(data) {
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

export function getFeedData() {
    const context = getContext();
    const meta = context.chatMetadata;
    if (!meta[METADATA_KEY]) {
        meta[METADATA_KEY] = getSeedData();
        saveFeedData();
    }
    cleanupMockData(meta[METADATA_KEY]);   // ล้าง mockup เก่า (ครั้งเดียวต่อแชท)
    return meta[METADATA_KEY];
}

export function getGallery() {
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

export function saveGallery() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    extension_settings[extensionName].gallery = getGallery();
    saveSettingsDebounced();
}

export function saveFeedData() {
    const context = getContext();
    if (typeof context.saveMetadata === "function") {
        context.saveMetadata();
    }
}

/* saveMetadata() ตรง ๆ มีเงื่อนไขล็อกภายในของ ST เอง (isChatSaving):
 * ถ้ามีการเซฟค้างอยู่แล้วเกิน 1 วินาที คำขอเซฟใหม่จะถูก "ข้ามเงียบ ๆ" ไม่มี error ให้เห็น
 * saveMetadataDebounced() ของ ST เอง (บน context) กันปัญหานี้ด้วย debounce จริง + เช็คไม่เซฟทับตอนสลับตัวละคร/แชท
 * ใช้ตัวนี้เป็นค่าเริ่มต้นสำหรับ path ที่ไม่ต้องการผลลัพธ์ทันที (ส่วนใหญ่ของ 50+ จุดที่เรียก saveFeedData) */
export function saveFeedDataDebounced() {
    const context = getContext();
    if (typeof context.saveMetadataDebounced === "function") {
        context.saveMetadataDebounced();
    } else {
        saveFeedData();
    }
}

/* flush ทันที ข้าม debounce ทั้งสองฝั่ง (global settings + chat metadata)
 * ใช้ตอนแท็บ/แอปกำลังจะถูกซ่อน (visibilitychange → hidden) — มือถือมักแช่แข็ง/เคลียร์แท็บที่อยู่เบื้องหลัง
 * ถ้ามีเซฟแบบ debounce ค้างอยู่ตอนนั้นพอดี (ภายใน 1 วิ) แล้วแท็บถูกแช่แข็งก่อน timer จะยิง = เซฟนั้นหายไปเลย
 * ไม่มี event "ก่อนถูกแช่แข็ง" ที่ดีกว่านี้ให้ hook — visibilitychange คือตัวที่เชื่อถือได้สุดข้ามเบราว์เซอร์/มือถือ */
export function flushAllSaves() {
    saveSettings();
    saveFeedData();
}

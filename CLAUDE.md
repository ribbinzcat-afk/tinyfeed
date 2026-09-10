# TinyPhone — คู่มือสำหรับ AI ที่มาแก้โค้ดนี้

โทรศัพท์จำลองใน SillyTavern มี **10 แอปในตัว** อ่านไฟล์นี้ให้จบก่อนแตะโค้ด

| ต้องการ | อ่านที่ |
|---|---|
| **เพิ่มแอปใหม่ / แก้ UI** | ไฟล์นี้ (มีเทมเพลตพร้อมก๊อป) |
| เหตุผลเบื้องหลังกติกา + ข้อมูลอ้างอิงเต็ม | `CONVENTIONS.md` (9 บท) |
| ฟีเจอร์แต่ละแอปทำอะไรบ้าง | `README.md` |

---

## 0. กฎเหล็ก 6 ข้อ

1. **ห้ามสร้างลิสต์แอป/แหล่งข้อมูลใหม่** — มีทะเบียนกลางอยู่แล้ว (`APPS`, `INJECT_SOURCES`, `SETTINGS_LAYOUT`, `OVERLAYS`) เพิ่ม entry ที่ทะเบียน อย่า hardcode ที่อื่น
2. **ห้ามเขียน component ซ้ำ** — empty state / แถบพิมพ์ / modal / แท็บ / ปุ่ม มีของกลางหมดแล้ว (ข้อ 3)
3. **ห้ามใส่สีดิบ (hex) ใน `style.css`** — ใช้ token `--tf-*` (ข้อ 2) ยกเว้น 4 กรณีในบทที่ 1 ของ `CONVENTIONS.md`
4. **`src/*.js` ห้าม import จาก `index.js`** — จะเกิด circular (ทิศทาง: `store`/`components` → `util` → `index.js`)
5. **ทุก path ที่เรียก AI ต้องมี feedback** — spinner / เปลี่ยนข้อความปุ่ม / "กำลังพิมพ์…" / skeleton
6. **ห้าม catch เปล่า** — ต้องมี `console.error` + `toastr` หรือคอมเมนต์บอก fallback

---

## 1. เพิ่มแอปใหม่ — checklist 8 ขั้น

สมมติแอปชื่อ `TinyXxx` id = `xxx`

### ① `index.js` — เพิ่ม entry ใน `APPS` (ค้นหา `const APPS = [`)

```js
{
    id: "xxx", name: "TinyXxx", icon: "fa-star", a: "#0ea5e9", b: "#0369a1",
    panel: "#tinyfeed-app-xxx", home: true, remember: true,
    open() { openXxx(); },
    // มีหน้าย่อยเท่านั้นถึงใส่ back() — คืน true = จัดการเองแล้ว
    back() { if (xxxScreen !== "main") { xxxScreen = "main"; renderXxx(); return true; } return false; },
},
```

| field | ความหมาย |
|---|---|
| `id` | คีย์เดียวใช้ทุกที่ (data-app, notif routing, `tinyGenerate(...,"xxx")`) |
| `name` | ชื่อบนไอคอนโฮม **และ** หัวข้อ topbar (shell ตั้งให้เอง — ห้ามตั้งเองในฟังก์ชัน render) |
| `icon` | Font Awesome — **ต้อง `grep` เจอใน `SillyTavern-release/public/css/fontawesome.min.css`** ไม่งั้นขึ้นเป็นกล่องเปล่า (เคยพลาดกับ `fa-arrow-down-to-line` ซึ่งเป็น Pro icon) |
| `a` / `b` | สีไล่เฉดไอคอนโฮม — `a` = สีประจำแอป |
| `home` | มี**สิทธิ์**โผล่บนหน้าโฮมไหม — การแสดงจริง/ลำดับจริงผู้ใช้ปรับทับได้ที่ตั้งค่า "หน้าโฮม" (`homeAppOrder`/`homeAppHidden`) โค้ดที่วาดกริดต้องเรียก `homeAppList()` เท่านั้น ห้าม `APPS.filter(a=>a.home)` ตรงๆ |
| `remember` | จำเป็นหน้าจอล่าสุดไหม (เปิดโทรศัพท์ใหม่แล้วกลับมาที่แอปนี้) |

### ② `style.css` — เพิ่มสีประจำแอปในบล็อก token (ต้นไฟล์)

```css
--tf-app-xxx: #0ea5e9;
```

### ③ `phone.html` — เพิ่ม panel (วางต่อจาก `#tinyfeed-app-pet`)

```html
<div id="tinyfeed-app-xxx" class="tinyfeed-app tinyfeed-hidden">
    <div id="tinyfeed-xxx-body" class="tinyfeed-xxx-body"></div>
</div>
```

> **ต้องเป็นพี่น้องของแอปอื่น ห้ามซ้อนในแอปใด** — `.tinyfeed-app:not(.tinyfeed-hidden)` จัด flex column ให้อัตโนมัติแล้ว

### ④ `index.js` — เขียนตัวแอป

```js
// ===== TinyXxx (แอปที่ 11): <คำอธิบายสั้นๆ> =====
let xxxScreen = "main";          // state หน้าจอ (ถ้ามีหลายหน้า)

function getXxx() {              // global → extension_settings
    const s = extension_settings[extensionName];
    if (!s.xxx || typeof s.xxx !== "object") s.xxx = { items: [] };
    if (!Array.isArray(s.xxx.items)) s.xxx.items = [];   // type-guard ทุกคีย์ (ผู้ใช้เก่าอาจไม่มี)
    return s.xxx;
}
function saveXxx() { saveSettingsDebounced(); }

function openXxx() { xxxScreen = "main"; renderXxx(); }

function renderXxx() {
    const body = $("#tinyfeed-xxx-body");
    if (!body.length) return;
    const items = getXxx().items;
    body.html(`
        <div class="tinyfeed-screen">
            ${items.length
                ? items.map(renderXxxItem).join("")
                : emptyStateHtml("fa-star", "ยังไม่มีอะไร", "กดปุ่มด้านล่างเพื่อเริ่ม")}
        </div>
    `);
}
```

**เลือกที่เก็บข้อมูลให้ถูก:**

| ชนิด | เก็บที่ | ใช้ |
|---|---|---|
| เนื้อหาที่เกิดจากเรื่องในแชทนี้ (ลบแชท = ควรหาย) | `chat_metadata` | `getFeedData()` / `saveFeedDataDebounced()` (ใช้ `saveFeedData()` ตรงๆ เฉพาะจุด flush สุดท้าย) |
| คลัง · ตัวตน · ของที่ควรตามผู้เล่นไปทุกแชท | `extension_settings` | `getSetting()` / `setSetting()` |

### ⑤ handler — ใส่ในบล็อก `jQuery(async () => {...})` ท้ายไฟล์

```js
// ===== TinyXxx =====
$(document).on("click", "#tinyfeed-xxx-add", function () { /* ... */ });
```

> ใช้ **delegated handler บน `document` เสมอ** (เนื้อหาถูก render ใหม่บ่อย) และ **ปุ่มย่อยบนการ์ดต้อง `e.stopPropagation()`** ไม่งั้นเด้งเข้าหน้ารายละเอียด

### ⑥ settings group (ถ้ามีตั้งค่า)

`phone.html` — วางใน `#tinyfeed-settings-detail`:
```html
<div class="tinyfeed-settings-group tinyfeed-hidden" data-group="xxx">
    <div class="tinyfeed-settings-title">TinyXxx (คำอธิบาย)</div>
    <small class="tinyfeed-field-hint">อธิบายว่าเก็บ global หรือ per-chat</small>
    <label class="tinyfeed-field-row">
        <span>เปิดใช้ฟีเจอร์นี้</span>
        <input id="tinyfeed-cfg-xxx-foo" type="checkbox" />
    </label>
    <label class="tinyfeed-field">
        <span class="tinyfeed-field-label">คำสั่งเสริม (ไม่บังคับ)</span>
        <textarea id="tinyfeed-cfg-xxx-extra" rows="2" placeholder="เช่น ..."></textarea>
    </label>
</div>
```

`index.js` — 3 จุด:
```js
// 1) src/store.js → defaultSettings
xxxFoo: false,

// 2) SETTINGS_LAYOUT (หมวดที่เหมาะสม)
{ id: "xxx", name: "TinyXxx", icon: "fa-star", desc: "สรุปสั้นๆ" },

// 3) populateSettings() + handler
$("#tinyfeed-cfg-xxx-foo").prop("checked", Boolean(getSetting("xxxFoo")));
$(document).on("change", "#tinyfeed-cfg-xxx-foo", function () {
    setSetting("xxxFoo", $(this).prop("checked"));
});
```

> `data-group` ต้องตรงกับ `id` ใน `SETTINGS_LAYOUT` — ถ้าไม่ตรงจะ `console.error` ตอนโหลดทันที

### ⑦ AI generation (ถ้ามี)

```js
// PROMPT_DEFS — ผู้ใช้แก้ prompt เองได้จากหน้าตั้งค่า
xxxThing: {
    label: "ทำอะไร (TinyXxx)", marker: "RESULT:", tokens: ["foo", "context"],
    default:
        `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] ...{{foo}}...\n{{context}}` +
        `ตอบรูปแบบนี้เท่านั้น:\nRESULT: <ผลลัพธ์>`,
},
```
```js
const q = buildPrompt("xxxThing", { foo: "...", context: crossAppContext("xxx") });
const raw = await tinyGenerate(q, 300, "xxx");   // ← ต้องส่ง "xxx" ไม่งั้น token dashboard นับไม่ได้
```

**ต้องมีครบ:**
- `marker` = คำนำหน้าที่ parser ใช้จับ (ทุก token ที่ประกาศต้องมี `{{token}}` ในตัว default จริง)
- busy flag `isXxxBusy` + ปลดใน `finally`
- feedback: `.tinyfeed-generating` บนปุ่ม หรือเปลี่ยนข้อความปุ่ม
- **parser ต้องทน AI ตอบเพี้ยน** — escape ทุกค่า, ตอบว่างต้องไม่พัง, มีขยะนำหน้าต้องตัดได้

### ⑧ ส่งข้อมูลออกนอกแอป (ถ้าอยากให้ตัวละครใน RP รับรู้)

```js
// INJECT_SOURCES — เพิ่ม entry เดียว
{ id: "xxx", inject: "injectXxx", cross: "crossAppXxx", single: () => ({ xxx: true }) },
```
แล้วเพิ่ม `if (want.xxx) { ... blocks.push(...) }` ใน `buildAppBlocks()` + checkbox 2 ตัวใน `phone.html`
`injectWant` / `injectText` / `injectDashboard` / `crossAppContext` derive ให้เอง **ห้ามแก้ทีละที่**

---

## 2. ทิศทางกราฟิก

### โทนรวม
โทรศัพท์จริงในมือ · มืดเป็นค่าเริ่มต้น · ขอบมน · เรียบ ไม่มีเงาหนา · **แต่ละแอปมีสีประจำตัวใช้เฉพาะจุดเน้น** ตัวเนื้อหาใช้สีกลางเสมอ

> **โทรศัพท์มีธีมของตัวเอง ไม่ inherit ธีม SillyTavern** — ห้ามใช้ `--SmartTheme*` (จงใจ ดู `CONVENTIONS.md` บทที่ 9)

### Token — ใช้ตัวเหล่านี้เท่านั้น

```
ระยะห่าง   --tf-sp-1(4) -2(6) -3(8·ค่าเริ่มต้นของ gap) -4(12) -5(16·padding screen) -6(24)
ความมน     --tf-r-sm(6·ชิป) -md(10·การ์ด/input/modal) -lg(16·การ์ดใหญ่) -pill(999·ปุ่ม/avatar)
ตัวอักษร   --tf-fs-xs(.72·meta) -sm(.82·รอง) -md(.9·ค่าเริ่มต้น) -lg(1.1·หัวข้อ) -xl(1.5·ตัวเลขเด่น)
ความหมาย   --tf-danger --tf-success --tf-warn --tf-info
สีแอป      --tf-app-<id>
พื้น/ตัวอักษร --tf-bg --tf-text --tf-text-strong --tf-text-muted --tf-text-soft --tf-border --tf-border-soft --tf-accent --tf-topbar
```

ค่าที่ต้องการไม่มี → **เลือกตัวใกล้สุด อย่าเพิ่ม token เพราะต่างกัน 1px**
`--tf-accent` ผู้ใช้เปลี่ยนได้ → อย่า hardcode `#1d9bf0` แทน

### โครงหน้าจอมาตรฐาน

```
.tinyfeed-app
├── (.tinyfeed-tabs)     แถบแท็บ ถ้ามี — flex-shrink:0
├── .tinyfeed-screen     เนื้อหาเลื่อนได้ — flex:1 overflow-y:auto padding:16px  ← ใช้ตัวนี้เสมอ
└── (compose bar)        ถ้ามี — flex-shrink:0
```

### Component ที่มีอยู่แล้ว — ห้ามเขียนใหม่

| ต้องการ | ใช้ |
|---|---|
| ไม่มีข้อมูล (เต็มหน้าจอ) | `emptyStateHtml(icon, title, sub)` |
| ไม่มีข้อมูล (กล่องเล็ก/กริด/modal) | `emptyInlineHtml(html)` |
| กำลังโหลดของใหม่ในลิสต์ | `skeletonCardHtml()` — ลบใน `finally` |
| แถบพิมพ์ + ปุ่มส่ง | `composeBarHtml({lead, field, sticker, send, data, before, after})` |
| ช่องคอมเมนต์ใต้โพสต์ | `commentComposeHtml({postId, dataKey, inputCls, stickerCls, sendCls})` |
| Modal | `.tinyfeed-modal` > `.tinyfeed-modal-card` > `.tinyfeed-modal-head` + ลงทะเบียนใน `OVERLAYS` |
| แถบแท็บ | `.tinyfeed-tabs` > `.tinyfeed-tab` / `.tinyfeed-tab-active` — **แยกแอปด้วย data attribute** เช่น `data-xtab` |
| ปุ่ม | `.tinyfeed-btn-primary` / `-ghost` / `-generate` (+ คลาส modifier ของตัวเองได้) |
| ลิงก์สั่ง AI ในแถวใต้โพสต์ (ไม่อยากให้เด่นแย่งเนื้อหา) | `.tinyfeed-ai-link` — ใช้ใน TinyFeed · รองรับ `.tinyfeed-generating` (จาง + ไอคอนหมุน) |
| ไอคอนในแถบพิมพ์ | `.tinyfeed-compose-iconbtn` (นอกช่อง) · `.tinyfeed-compose-inbtn` (ในช่อง) |
| รูปโปรไฟล์ | `makeAvatar(item)` — อ่าน `item.author` / `.avatar` / `.isUser` / `.isMain` |
| ข้อความมี `[img:]` / `[sticker:]` | `renderRich(text)` — **ห้าม parse token เอง** |
| ฟอร์มในหน้าตั้งค่า | ดูตารางข้างล่าง |

**คลาสฟอร์มในหน้าตั้งค่า** (มีแค่ 4 ตัวนี้ที่มี CSS จริง — อย่าคิดคลาสใหม่เอง):

| คลาส | ใช้กับ | โครง |
|---|---|---|
| `.tinyfeed-field-row` | checkbox / ค่าสั้นๆ วางแนวนอน | `<label class="tinyfeed-field-row"><span>ชื่อ</span><input type="checkbox"></label>` |
| `.tinyfeed-field` | textarea / input ที่ต้องมี label อยู่บน | `<label class="tinyfeed-field"><span class="tinyfeed-field-label">ชื่อ</span><textarea></textarea></label>` |
| `.tinyfeed-field-2col` | วาง `.tinyfeed-field` 2 อันข้างกัน | `<div class="tinyfeed-field-2col"><label class="tinyfeed-field">…</label>×2</div>` |
| `.tinyfeed-field-hint` | `<small>` คำอธิบายใต้หัวข้อ | `<small class="tinyfeed-field-hint">…</small>` |

### เขียน CSS ของแอปใหม่

ต่อท้าย `style.css` เป็นบล็อกของตัวเอง ใช้ token ล้วน:
```css
/* ===== TinyXxx (แอปที่ 11): คำอธิบาย ===== */
.tinyfeed-xxx-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.tinyfeed-xxx-card {
    padding: var(--tf-sp-4);
    border: 1px solid var(--tf-border);
    border-radius: var(--tf-r-md);
    background: var(--tf-topbar);
}
.tinyfeed-xxx-title { font-size: var(--tf-fs-md); font-weight: 600; color: var(--tf-text-strong); }
.tinyfeed-xxx-meta { font-size: var(--tf-fs-xs); color: var(--tf-text-muted); }
```

**ตั้งชื่อคลาส `tinyfeed-<id>-<ส่วน>` เสมอ** (prefix กันชนกับ SillyTavern)

---

## 3. กับดักที่เคยทำให้พังมาแล้ว

| กับดัก | ต้องทำ |
|---|---|
| ซ่อน/แสดง element | ใช้ `.tinyfeed-hidden` เท่านั้น (`display:none !important`) ห้ามผสม `.hide()/.show()` |
| `.tinyfeed-app:not(.tinyfeed-hidden)` | **อย่าลบ `:not()`** ไม่งั้น specificity ชนะ `.tinyfeed-hidden` แล้วแอปซ่อนไม่ลง |
| selector ของแท็บ | ต้องจำกัด `[data-xtab]` เสมอ — ทุกแอปใช้ `.tinyfeed-tab` ร่วมกัน ถ้าไม่จำกัดจะล้าง active ของแอปอื่น |
| ปุ่มบนการ์ดที่กดแล้วเปิดรายละเอียด | `e.stopPropagation()` ทุกปุ่มย่อย |
| `.tinyfeed-post` | เก็บ id ใน data attribute ของตัวเอง + handler ต้องจำกัดด้วย attribute นั้น |
| `.tinyfeed-inputwrap > input{padding-right}` | ชนะเฉพาะ input ที่เลือกด้วย **class** ไม่ชนะ **id** → ช่องที่เป็น id ต้องตั้ง padding เอง |
| input ที่อยู่ใน **modal** | ไม่ได้กฎของ `#tinyfeed-settings-screen` → ต้องตั้ง background/border/radius เอง ไม่งั้นเป็นกล่องสี่เหลี่ยมเปล่า |
| `font-size` เป็น `em` ซ้อนกัน | parent 0.82em + child 0.82em = 0.67em (เล็กเกิน) → ใน element ที่ parent ตั้ง em ไว้แล้ว ใช้ `font: inherit` อย่าใส่ `font-size` ซ้ำ |
| แก้ CSS ด้วยสคริปต์ regex | **อันตรายมาก** — `^\.sel\s*\{[^}]*\}` จะกิน body ของกฎที่ถูกรวม selector ไว้ก่อนหน้า ทำให้เหลือ selector ลอยไปต่อกับกฎถัดไป **ตรวจด้วยตาหลังรันเสมอ** (เคยทำ `.tinyfeed-comment-input` หายทั้งกฎมาแล้ว) |
| การ์ด `overflow:hidden` ที่เป็นลูกตรงของ flex-column + `overflow-y:auto` | ใส่ `flex-shrink:0` ไม่งั้นยุบเหลือเส้นเดียวตอน scroll |
| มินิเกม / animation | **low-motion** — อัปเดตเฉพาะ element ที่เปลี่ยน (`.text()` ตัวเลข หรือ toggle class) **ห้าม `.html()` ทั้งกระดานทุก tick** (เกมเก่าเคยแลคหนักบนมือถือ) |
| เซฟข้อมูลแชท | ใช้ `saveFeedDataDebounced()` เสมอ (แก้ 2026-08) — `saveFeedData()` ตรงๆ ไม่ debounce เสี่ยงชน lock ของ ST แล้วเซฟหลุดเงียบๆ เหลือไว้ให้เรียกตรงเฉพาะจุด flush สุดท้าย (เช่น `closePhone()`) |
| ฟังก์ชันที่รับค่าเป็นอาร์กิวเมนต์ | เช่น `petBondLevel(bond)` — เรียกเปล่าได้ 0 เสมอ เช็ค signature ก่อนเรียก |

---

## 4. วิธีตรวจงาน (ทำทุกครั้ง)

```bash
node --check tinyfeed/index.js && node --check tinyfeed/src/*.js
```
```bash
python3 -c "
import re
s=open('tinyfeed/style.css').read(); assert s.count('{')==s.count('}'), 'CSS ไม่สมดุล'
h=open('tinyfeed/phone.html').read()
assert len(re.findall(r'<div\b',h))==len(re.findall(r'</div>',h)), 'HTML ไม่สมดุล'
print('OK')"
```

**Pure-logic test** — parser / ตัวคำนวณ เขียนเทสใน scratchpad โดยดึงฟังก์ชันออกมาจาก `index.js` ด้วยการนับปีกกา แล้ว stub helper

**รันใน SillyTavern จริง** — `.claude/launch.json` มี config `sillytavern` (port 8000) และ `tinyfeed/` ถูก symlink เข้า `third-party/` แล้ว แก้ไฟล์ → รีโหลดหน้าเว็บเห็นผลทันที

ขับ UI ผ่าน console (ฟังก์ชันเป็น module scope เรียกตรงไม่ได้ ต้องยิง event):
```js
jQuery('#tinyfeed-menu-button').trigger('click');            // เปิดโทรศัพท์
jQuery('.tinyfeed-app-icon[data-app="xxx"]').trigger('click'); // เปิดแอป
document.querySelectorAll('dialog[open]').forEach(d=>d.close()); // ปิด dialog ของ ST ที่บัง
```

**ต้องเช็คทุกครั้งหลังแตะ shell:** เปิดครบทุกแอป · ปุ่มย้อนกลับทุกชั้น · เข้า-ออกตั้งค่าแล้วกลับแอปเดิม · ไม่มี console error · ไม่ล้นแนวนอนที่กว้าง 320px

> **แก้ `index.js` แล้วเบราว์เซอร์อาจรันโมดูลเก่า** — ถ้าผลไม่ตรงกับโค้ด ให้เปิด `window.__debug = {fn}` ชั่วคราวเรียกฟังก์ชันตรงๆ จะแยกได้ทันทีว่า "โค้ดผิด" หรือ "โมดูลเก่าค้าง" (ลบออกเมื่อเสร็จ)

---

## 5. เรื่องที่ตั้งใจทำแบบนี้ — อย่า "แก้ให้ถูก"

| ไม่ใช้ | เพราะ |
|---|---|
| `--SmartTheme*` ของ ST | โทรศัพท์ต้องมีธีมของตัวเอง ไม่เปลี่ยนตามธีม ST |
| `Popup` / `callGenericPopup` ของ ST | เป็น `<dialog>` + top layer → **ทะลุกรอบโทรศัพท์** ทำลายภาพลวงตา |
| slash command · `t\`\`` i18n · `renderExtensionTemplateAsync` | โปรเจกต์เป็นภาษาไทยล้วน เข้าถึงทุกอย่างผ่านตัวโทรศัพท์ |
| แยก `index.js` ตามแอป | วัดแล้ว: เส้นเรียกข้ามโมดูล 570 · global ที่แก้ข้าม section 45/77 · `currentApp` ถูกแตะจาก 15 section — แอปพันกันโดยธรรมชาติ **ตัดสินใจแล้วว่าไม่ทำ** |

`{{token}}` ใน `PROMPT_DEFS` เป็นระบบของโปรเจกต์เอง (`buildPrompt` ใช้ `split().join()`) **ไม่ใช่ macro ของ ST**
`sw.js` ไม่ใช่ PWA service worker — มีไว้ `showNotification()` บน Android เท่านั้น

---

## 6. โครงไฟล์

```
tinyfeed/
├── index.js          ~8,500 บรรทัด — 10 แอป + shell + bootstrap
├── phone.html        โครง DOM (แอปเป็นพี่น้องกัน + หน้าตั้งค่า)
├── style.css         token block อยู่ต้นไฟล์ · CSS แต่ละแอปต่อท้าย
├── src/
│   ├── store.js      getSetting/setSetting · getFeedData/saveFeedData · defaultSettings · ค่าคงที่  [deps 0]
│   ├── util.js       escape* · renderRich + token [img:]/[sticker:] · timeAgo                      [→ store]
│   └── components.js emptyStateHtml · emptyInlineHtml · skeletonCardHtml · composeBarHtml          [deps 0]
├── assets/pet-sprites/   33 ไฟล์ `<ระยะ>_<สถานะ>.png`
├── CONVENTIONS.md    มาตรฐานกลางฉบับเต็ม + เหตุผล
└── CLAUDE.md         ไฟล์นี้
```

path จาก `src/` ไปหา core ของ ST ลึกกว่า `index.js` หนึ่งชั้น:
`../../../../extensions.js` และ `../../../../../script.js`

---

## 7. ภาษา

**เขียนทุกอย่างเป็นภาษาไทย** — UI · คอมเมนต์ในโค้ด · prompt · ข้อความ error/toast
ยกเว้นชื่อตัวแปร/ฟังก์ชัน/คลาส CSS ที่เป็นอังกฤษตามปกติ

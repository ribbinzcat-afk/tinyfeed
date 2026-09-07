# TinyPhone — มาตรฐานกลาง (Conventions)

เอกสารนี้คือ **แหล่งความจริงเดียว** ว่าแอปใน TinyPhone ต้องหน้าตาแบบไหน เก็บข้อมูลที่ไหน ใช้คลาสอะไร

> **ใช้ยังไง:** จะเพิ่มแอปใหม่หรือแก้แอปเดิม → อ่าน [บทที่ 2](#2-app-contract) กับ [บทที่ 4](#4-component-library) ก่อนเขียนโค้ด
> ถ้าต้องเขียน component ใหม่เพราะของกลางไม่พอ → **แก้ของกลาง ไม่ใช่เขียนของตัวเอง** แล้วอัปเดตเอกสารนี้

**สถานะ:** เขียน 2026-08-11 · โค้ดปัจจุบัน **ยังไม่ตรงกับเอกสารนี้ทั้งหมด** — จุดที่ยังไม่ตรงถูกทำเครื่องหมาย ⚠️ ไว้ พร้อมเลขเฟสตามแผน migration ([บทที่ 8](#8-สถานะ-migration))

---

## สารบัญ

1. [Design tokens](#1-design-tokens)
2. [App Contract](#2-app-contract)
3. [Screen anatomy](#3-screen-anatomy)
4. [Component library](#4-component-library)
5. [Data scope contract](#5-data-scope-contract)
6. [Async & error](#6-async--error)
7. [Module layout](#7-module-layout)
8. [สถานะ migration](#8-สถานะ-migration)
9. [การตัดสินใจที่ตั้งใจ (ไม่ใช่งานค้าง)](#9-การตัดสินใจที่ตั้งใจ-ไม่ใช่งานค้าง)

---

## 1. Design tokens

### กฎ

> **ห้ามใส่สีดิบ (hex) ใน `style.css` ยกเว้น 4 กรณีข้างล่าง**
> ถ้าขนาด/ระยะที่ต้องการไม่มีใน token → เลือกตัวที่ใกล้ที่สุด **อย่าเพิ่ม token ใหม่เพราะต่างกัน 1px**

**สีดิบที่ยังใช้ได้ (ไม่ต้องแปลง):**
1. **บล็อกนิยาม token เอง** (ต้นไฟล์)
2. **`#fff` / `#000`** สำหรับตัวอักษรบนพื้นสี หรือใช้ผสมใน `color-mix(… , #000)` — ไม่ขึ้นกับธีม
3. **fallback ใน `var()`** เช่น `var(--donate-color, #1d9bf0)` — ต้องเป็นค่าจริง
4. **`.tinyfeed-notif*` (แบนเนอร์แจ้งเตือน)** — อยู่**นอก** `#tinyfeed-phone` จึงเข้าถึง `--tf-*` ไม่ได้ ดู `--nf-*` ข้างล่าง

**สถานะ (เฟส 7):** แปลงแล้ว **56 จุด** — `#f4212e`+`#ef4444` → `--tf-danger` (36) · `#10b981` → `--tf-app-bank` (8) · `#a855f7` → `--tf-app-stream` (6) · `#22c55e` → `--tf-app-connect`/`--tf-success` (6)
เหลือ hex 102 ตัว ซึ่ง **70 ตัวเป็น 4 กรณีข้างบน** ที่เหลือ ~30 เป็นสีเฉพาะจุด (`#ffca28` ทอง · `#f91880` ชมพู ฯลฯ) — เติม token ได้ถ้าเริ่มใช้ซ้ำ

*(ตอนเริ่มโปรเจกต์นี้: `font-size` 25 ค่า, `border-radius` 17 ค่า, hex ดิบ 141 ตัว — เกิดจากเลือกค่า "ที่ดูดี" ทีละครั้งโดยไม่มีบันไดให้ยึด)*

### บันไดค่า

ทุก token อยู่บน `#tinyfeed-phone` (ไม่ใช่ `:root`) เพื่อไม่ให้รั่วออกไปชนกับ SillyTavern

| กลุ่ม | Token | ค่า | ใช้กับ |
|---|---|---|---|
| **Spacing** | `--tf-sp-1` | `4px` | ช่องไฟชิดสุด (ไอคอนกับข้อความ) |
| | `--tf-sp-2` | `6px` | ช่องไฟในชิป/แท็ก |
| | `--tf-sp-3` | `8px` | **ค่าเริ่มต้นของ `gap`** |
| | `--tf-sp-4` | `12px` | padding ในการ์ด/แถว |
| | `--tf-sp-5` | `16px` | **padding มาตรฐานของ screen** |
| | `--tf-sp-6` | `24px` | ช่องไฟระหว่างบล็อกใหญ่ |
| **Radius** | `--tf-r-sm` | `6px` | ชิป, แท็ก, thumbnail เล็ก |
| | `--tf-r-md` | `10px` | **การ์ด, input, modal** |
| | `--tf-r-lg` | `16px` | การ์ดใหญ่, bottom sheet |
| | `--tf-r-pill` | `999px` | ปุ่ม, avatar, badge |
| **Type** | `--tf-fs-xs` | `.72em` | meta, timestamp, caption |
| | `--tf-fs-sm` | `.82em` | ข้อความรอง, label |
| | `--tf-fs-md` | `.9em` | **ค่าเริ่มต้นของเนื้อหา** |
| | `--tf-fs-lg` | `1.1em` | หัวข้อในแอป |
| | `--tf-fs-xl` | `1.5em` | ตัวเลขเด่น, hero |
| **Semantic** | `--tf-danger` | `#f4212e` | ลบ, ผิดพลาด, หัวใจไลก์ |
| | `--tf-success` | `#22c55e` | สำเร็จ, เงินเข้า |
| | `--tf-warn` | `#f59e0b` | เตือน |
| | `--tf-info` | `#1d9bf0` | ข้อมูล (= ค่าเดียวกับ accent เริ่มต้น) |

### Chrome tokens (มีอยู่แล้ว — อย่าแก้ชื่อ)

`--tf-bg` `--tf-text` `--tf-text-strong` `--tf-text-muted` `--tf-text-soft` `--tf-border` `--tf-border-soft` `--tf-accent` `--tf-topbar`

นิยาม 2 ชุดคู่กันเสมอ: `#tinyfeed-phone.tinyfeed-theme-dark` และ `.tinyfeed-theme-light` — **เพิ่ม token ใหม่ต้องเพิ่มทั้งสองชุด**

### `--nf-*` — ชุดที่สองสำหรับแบนเนอร์แจ้งเตือน

`.tinyfeed-notif` (แบนเนอร์ที่เลื่อนลงมาบอกแจ้งเตือน) อยู่ **นอก `#tinyfeed-phone`** ใน `phone.html` เพราะต้องโผล่ได้แม้ปิดโทรศัพท์อยู่ → **เข้าถึง `--tf-*` ไม่ได้** จึงมี token ของตัวเอง 5 ตัว (`style.css:929`):

`--nf-bg` `--nf-border` `--nf-text` `--nf-sub` `--nf-body`

**นี่ถูกต้องแล้ว ไม่ต้องรวม** — แต่ถ้าแก้สีธีม ต้องแก้ทั้งสองที่ให้เข้ากัน

### Runtime tokens (ตั้งจาก JS อย่าตั้งใน CSS)

| Token | ตั้งที่ | มาจาก setting |
|---|---|---|
| `--tf-wp-overlay-alpha` | `applyWallpaper()` | `wallpaperOverlay` |
| `--tf-overlay-alpha` | `applyAppearance()` | `overlayOpacity` |
| `--tf-widget-alpha` | `applyAppearance()` | `widgetOpacity` |
| `--tf-home-hue` | `applyAppearance()` | สุ่ม/ตั้งเอง |

### สีแบรนด์ต่อแอป

> **สีของแอตต้องมีแหล่งเดียวคือ token `--tf-app-<id>`**

⚠️ ตอนนี้สีแบรนด์ถูกเขียนซ้ำ **4 ที่** (`HOME_APPS`, `APP_META`, `style.css`, `donateTiers`) และ **หลุดไปแล้ว 1 จุด: TinyMemo เป็น `#f59e0b` ใน `HOME_APPS` แต่ `#14b8a6` ใน `APP_META`**

| App | Token | ค่า |
|---|---|---|
| feed | `--tf-app-feed` | `#1d9bf0` |
| connect | `--tf-app-connect` | `#22c55e` |
| stream | `--tf-app-stream` | `#a855f7` |
| memo | `--tf-app-memo` | `#f59e0b` ← ยึดค่าของ `HOME_APPS` (ค่าที่ผู้ใช้เห็นบนหน้าโฮม) |
| forum | `--tf-app-forum` | `#ef4444` |
| gallery | `--tf-app-gallery` | `#ec4899` |
| bank | `--tf-app-bank` | `#10b981` |
| shop | `--tf-app-shop` | `#f97316` |
| pet | `--tf-app-pet` | `#8b5cf6` |
| ask | `--tf-app-ask` | `#6366f1` |
| *(news — ไม่ใช่แอป เป็นแท็บใน feed)* | `--tf-app-news` | `#f59e0b` |

ไอคอนบนโฮมใช้ gradient `--app-a` → `--app-b` โดย `--app-b` = สีเดียวกันแบบเข้มขึ้น ให้ derive ด้วย `color-mix` ไม่ต้องเก็บค่าที่สอง:
```css
--app-b: color-mix(in srgb, var(--app-a) 72%, #000);
```

---

## 2. App Contract

### ทะเบียนเดียว: `APPS` ✅ (ทำแล้ว เฟส 2)

> **แอปถูกนิยามที่เดียวคือ array `APPS` ใน `index.js` ห้ามมีลิสต์แอปที่อื่น**

เดิมมี **4 ทะเบียนและไม่ตรงกันสักที่** — ตอนนี้ทั้งหมด derive จาก `APPS`:

| ทะเบียนเดิม | เคยมี | ปัญหาเดิม | ตอนนี้ |
|---|---|---|---|
| `HOME_APPS` | 11 | ถูกต้อง | `APPS.filter(a => a.home)` |
| `APP_META` | 9 | **ขาด bank/shop/pet** · memo สีไม่ตรงหน้าโฮม | derive จาก `APPS` + `news` |
| `MEMO_APPS` | 10 | **ขาด pet** | `canRememberApp()` อ่าน `a.remember` |
| whitelist ใน `openApp` | 11 | array literal ซ้ำซ้อน | `APP_BY_ID[id]` |

**บั๊ก 2 ตัวที่หายไปเพราะการรวมทะเบียน:**

1. **หัวข้อ TinyForum หาย** — 10 แอปตั้ง `.tinyfeed-title` ใน `openApp` แต่ forum ลืม ต้องไปตั้งข้างใน `openForumList()` ส่วน connect ตั้งซ้ำสองที่ → ตอนนี้ shell ตั้งจาก `app.name` ให้ทุกแอปเท่ากัน ลืมไม่ได้อีก
2. **ปุ่มย้อนกลับปิด overlay บางตัวไม่ได้** — `handleBack` เดิมเช็ค selector ว่า "มีอะไรเปิดอยู่ไหม" แล้ว **return ทันที** แต่เรียก closer ไม่ครบ → ถ้าเปิด **หน้าโปรไฟล์ตัวละคร** อยู่ กดย้อนกลับแล้ว**ไม่มีอะไรเกิดขึ้นเลย** ต้องกดปิดที่กากบาทเท่านั้น → ตอนนี้ `OVERLAYS` เป็นทะเบียนคู่ `{sel, close}` ใช้ร่วมกันทั้ง `openApp` และ `handleBack` ผูกไม่ครบไม่ได้

**ผลข้างเคียงที่ตั้งใจ 2 อย่าง:**
- สี TinyMemo ใน dashboard/keyword editor เปลี่ยนจาก `#14b8a6` (เขียวน้ำทะเล) → `#f59e0b` (ส้ม) ให้ตรงกับไอคอนหน้าโฮม
- `bank`/`shop`/`pet` มีป้ายชื่อ+ไอคอนของตัวเองใน gen dashboard แล้ว (เดิมตกหล่นจาก `APP_META` เลยโชว์ "การเจน" ทั่วไป)

### หน้าตาของ descriptor

```js
{
  id:       "feed",              // คีย์เดียวที่ใช้ทุกที่ (data-app, notif routing, lastGenByApp)
  name:     "TinyFeed",          // ชื่อบนไอคอนหน้าโฮม
  title:    "TinyFeed",          // ข้อความบน topbar (มัก = name)
  icon:     "fa-hashtag",        // Font Awesome — ต้อง grep เจอใน fontawesome.min.css ของ ST
  color:    "feed",              // → var(--tf-app-feed)  ห้ามใส่ hex
  scope:    "chat",              // "chat" | "global"  — ดูบทที่ 5
  panel:    "#tinyfeed-app-feed",

  home:     true,                // "มีสิทธิ์" ขึ้นหน้าโฮมไหม (ค่าคงที่ในโค้ด)
  remember: true,                // จำเป็นหน้าจอล่าสุดไหม (เดิม = MEMO_APPS)
  meta:     true,                // นับใน token dashboard ไหม (เดิม = APP_META)

  open()    { … },               // เรียกหลัง shell แสดง panel + ตั้ง title แล้ว
  onLeave() { … },               // เก็บกวาด timer ตอนออกจากแอป (คืนค่าไม่ใช้)
  back()    { return false; },   // true = จัดการ back เองแล้ว, false = ให้ shell จัดการต่อ
}
```

### Checklist เพิ่มแอปใหม่

1. **`APPS`** — เพิ่ม descriptor 1 ตัว (จบเรื่องโฮม/title/จำหน้าจอ/dashboard ในครั้งเดียว)
2. **`--tf-app-<id>`** — เพิ่มสีแบรนด์ใน token block ทั้งธีมมืดและสว่าง
3. **`phone.html`** — เพิ่ม `<div id="tinyfeed-app-<id>" class="tinyfeed-app tinyfeed-hidden">` เป็น**พี่น้อง**ของแอปอื่น (ห้ามซ้อนในแอปอื่น — ดู ⚠️ บทที่ 3)
4. **โครงหน้าจอ** — ตาม [บทที่ 3](#3-screen-anatomy)
5. **ข้อมูล** — เลือก scope ตาม [บทที่ 5](#5-data-scope-contract) แล้วทำ getter/saver คู่กัน
6. **AI generation (ถ้ามี)** — เพิ่มใน `PROMPT_DEFS` (label/marker/tokens/default) แล้วเรียก `tinyGenerate(prompt, tokens, "<id>")` — **ต้องส่ง `<id>` เสมอ** ไม่งั้น token dashboard นับไม่ได้
7. **Auto-trigger (ถ้ามี)** — เพิ่ม descriptor ใน array ของ `onChatMessage()` (`index.js:6817`)
8. **Settings (ถ้ามี)** — `.tinyfeed-settings-group` + ลงทะเบียนหัวข้อใน `SETTINGS_LAYOUT`

> **`home: true` แปลว่า "มีสิทธิ์" ไม่ใช่ "แสดงแน่นอน"** — ตั้งแต่มี settings group `homeLayout` (2026-08-13) ผู้ใช้ปิด/จัดลำดับแอปบนหน้าโฮมเองได้ผ่าน `homeAppOrder`/`homeAppHidden` โค้ดที่วาดกริดหน้าโฮมต้องอ่านผ่าน `homeAppList()` เท่านั้น **ห้ามเขียน `APPS.filter(a => a.home)` ตรงๆ ที่อื่นอีก** ไม่งั้นจะข้ามการตั้งค่าของผู้ใช้ไปเงียบๆ
9. **Notification (ถ้ามี)** — `showNotif(avatar, author, text, tab, "<id>")` + branch ใน `routeFromNotif`
10. **README.md** — อัปเดตจำนวนแอป

---

## 3. Screen anatomy

### โครงมาตรฐาน

```
#tinyfeed-phone
├── .tinyfeed-notch
├── .tinyfeed-topbar          ← home / back / .tinyfeed-title / bell·gear·theme·close
├── #tinyfeed-notif-drawer
├── #tinyfeed-home
├── #tinyfeed-settings-screen ← ⚠️ ต้องอยู่ตรงนี้ (ปัจจุบันอยู่ผิดที่)
└── .tinyfeed-app × 11
    ├── (.tinyfeed-tabs)      ← แถบแท็บ ถ้ามี — flex-shrink:0
    ├── .tinyfeed-screen      ← เนื้อหาเลื่อนได้ — flex:1, overflow-y:auto
    └── (compose bar)         ← ถ้ามี — flex-shrink:0
```

### กฎ

- **เนื้อหาที่เลื่อนได้ต้องใช้ `.tinyfeed-screen`** — มันคือ `flex:1; overflow-y:auto; padding:16px` + สไตล์ scrollbar พร้อมแล้ว (`style.css:84` + `1026`)
  ⚠️ ตอนนี้ใช้อยู่แค่ **7 ที่** ส่วนอีก **~10 ที่เขียน `flex:1; overflow-y:auto` เอง** (`.tinyfeed-connect-list`, `.tinyfeed-connect-messages`, `.tinyfeed-stream-comments`, `.tinyfeed-pet-body`, `.tinyfeed-bank-txns`, `.tinyfeed-vprofile-body`, …)
- **`.tinyfeed-title` ตั้งโดย shell จาก `APPS[].title` เท่านั้น** — ห้ามตั้งในฟังก์ชัน render ของแอป
  ข้อยกเว้นเดียว: หน้าย่อยที่ title เปลี่ยนตามเนื้อหา (ห้องแชต `index.js:1755`, กระทู้ `index.js:6319`) — ตั้งได้ แต่ต้องคืนค่าเดิมตอนกลับ
- **ทุกอย่างที่ซ่อน/แสดงใช้ `.tinyfeed-hidden`** (`display:none !important`, `style.css:157`) ห้ามใช้ `.hide()`/`.show()` ของ jQuery ปนกัน
  เหตุผลที่ต้องใช้ `!important`: แอปที่ตั้ง `display:flex` เองจะชนะ `display:none` ธรรมดา
- **`.tinyfeed-app` เป็น flex column ให้อัตโนมัติแล้ว** ✅ — `.tinyfeed-app:not(.tinyfeed-hidden) { display:flex; flex-direction:column }` (`style.css:1859`)
  **`:not(.tinyfeed-hidden)` ในเซเลกเตอร์นี้จงใจ** อย่าลบ — ถ้าเขียน `display:flex` บน `.tinyfeed-app` เฉยๆ specificity จะไปชนะ `.tinyfeed-hidden` แล้วแอปจะซ่อนไม่ลง
  ⚠️ `#tinyfeed-app-stream` (`:1480`) และ `#tinyfeed-app-pet` (`:3881`) เขียนกฎเดียวกันซ้ำอีกรอบ = **โค้ดตายซ้ำซ้อน ลบได้ทั้งสองบล็อก** (เฟส 7)
- **ห้ามวางแอปซ้อนในแอป** ✅ (แก้แล้วเฟส 3)
  เดิม `#tinyfeed-settings-screen` อยู่**ข้างใน** `#tinyfeed-app-feed` = **698 จาก 750 บรรทัดของ app-feed (93%) อยู่ผิดที่** ทำให้ `openSettings()` ต้อง hack ยืม app-feed เป็น host แล้วซ่อนเนื้อในทีละส่วน
  ตอนนี้เป็นพี่น้องของแอปแล้ว → `app-feed` เหลือ **52 บรรทัด**, `openSettings()` แค่ซ่อนแอปแล้วโชว์หน้าตั้งค่าตรงๆ
  **และปลดล็อกการรวมแถบแท็บ** — `openSettings` ไม่ต้องซ่อน `.tinyfeed-tabs` แบบ global อีก (ซ่อนทั้งแอปแทน) กฎ "แถบแท็บต้องใช้คลาสเฉพาะแอป" จึงหมดอายุแล้ว

### ปุ่มย้อนกลับ (back stack)

ลำดับที่ `handleBack()` ต้องไล่ — **บนลงล่าง เจอตัวแรกที่เปิดอยู่แล้วหยุด**:

1. **Overlay/Modal** ที่เปิดอยู่ → ปิดตัวนั้น *(ตัวเดียว ไม่ใช่ปิดหมด)*
   ⚠️ ตอนนี้ `handleBack` (`index.js:7539`) hardcode 14 selector แล้วเรียก close 9 ตัว**รัวๆ ทุกตัวไม่ว่าตัวไหนเปิด** — ควรใช้ registry `[{sel, close}]`
2. **หน้าย่อยในแอป** → `APPS[].back()` (ห้องแชต → รายชื่อ, กระทู้ → รายการกระทู้)
3. **หน้าตั้งค่า** → กลับแอปเดิม (`settingsReturn`)
4. **ไม่มีอะไร** → `closeDetail()`

### Topbar state ต่อหน้าจอ

| หน้าจอ | 🏠 home | ← back | ⚙️ gear |
|---|---|---|---|
| Home | ซ่อน | ซ่อน | **แสดง** |
| ในแอป | แสดง | ซ่อน | แสดง |
| หน้าตั้งค่า | ซ่อน | **แสดง** | ซ่อน |

---

## 4. Component library

> **กฎเดียว: ถ้ามีในตารางนี้ ห้ามเขียนใหม่** ไม่พอใจ → แก้ของกลาง

### 4.1 Empty state — 2 แบบ ✅ (รวมแล้ว เฟส 5)

**helper มีอยู่แล้ว ห้ามเขียน markup เอง:**

| แบบ | helper | ใช้เมื่อ | หน้าตา |
|---|---|---|---|
| **เต็มหน้าจอ** | `emptyStateHtml(icon, title, sub)` | เนื้อหาหลักของแอปว่าง | ไอคอน `2.4em` + หัวข้อ + คำอธิบาย · padding `52px 24px` |
| **กะทัดรัด** | `emptyInlineHtml(html)` | กล่องเล็ก — กริดคลังรูป · ตัวเลือกใน modal · ลิ้นชักแจ้งเตือน | ข้อความกลางล้วน · padding `24px 16px` · `--tf-fs-sm` |

```js
$("#target").html(emptyStateHtml("fa-feather-pointed", "ยังไม่มีโพสต์",
    "เขียนโพสต์แรก หรือกด “ให้ตัวละครโพสต์” ได้เลย"));
$("#grid").html(emptyInlineHtml("อัลบั้มนี้ว่าง"));
```

`emptyInlineHtml` รับ HTML ได้ (`<br>` / `<small>`) — **ผู้เรียกต้อง escape เนื้อหาที่มาจากผู้ใช้เอง**

**ปัจจุบัน: `emptyStateHtml` 11 จุด · `emptyInlineHtml` 6 จุด · ไม่มี empty state ที่เขียนเองแล้ว**

เดิมมีหลายคลาสแยกกัน (`-gallery-empty` `-notif-drawer-empty` + widget) โดยแอปที่สร้างทีหลังไม่รู้ว่ามีของกลางเลยเขียนเอง ตอนนี้ลบทิ้งหมดแล้ว

**ข้อยกเว้นเดียวที่ยังเขียนเอง:** `.tinyfeed-widget-agenda-empty` (5 จุด) — เป็น *ข้อความจางในวิดเจ็ตหน้าโฮม* ไม่ใช่ empty state (ไม่มี padding/จัดกลาง) ถ้าเอา `.tinyfeed-empty-inline` ไปใส่ วิดเจ็ตจะบานเพราะ padding `24px` **ตั้งใจเก็บไว้**

### 4.2 Loading — feedback ของงาน AI

> **ทุก path ที่เรียก AI ต้องบอกผู้ใช้ว่ากำลังทำงาน** — เลือกแบบที่เข้ากับบริบท

| แบบ | ใช้เมื่อ | ตัวอย่าง |
|---|---|---|
| `.tinyfeed-generating` บนปุ่ม | มีปุ่มที่กดแล้วรอ | หลายจุด — stream / shop / memo / forum / pet … |
| เปลี่ยนข้อความปุ่ม | งานนาน อยากบอกว่าทำอะไรอยู่ | `"กำลังเริ่ม..."` (stream) · `"กำลังสแกน..."` (memo) |
| `"กำลังพิมพ์…"` | แชต/คอมเมนต์ ที่ควรรู้สึกเหมือนคนพิมพ์ | TinyConnect (`isConnectReplying`) · คอมเมนต์ฟีด (`isReplying`) |
| `skeletonCardHtml()` | ของใหม่จะโผล่เป็น "การ์ด" ในลิสต์ | feed · news |
| **ไม่ต้องมี** | งานเบื้องหลังที่ผู้ใช้ไม่ได้สั่ง | `aiDecides*` (ตอบ YES/NO) · `proactiveDM` · `groupSelfChat` · คอมเมนต์อัตโนมัติหลังโพสต์ |

**สถานะปัจจุบัน: ครบแล้วทั้ง 26 ฟังก์ชันที่เรียก `tinyGenerate`** — 21 ตัวมี feedback ชัดเจน อีก 5 เป็นงานเบื้องหลังที่ถูกต้องแล้วที่จะเงียบ

รูปแบบ skeleton (ถ้าจะเพิ่มที่ใหม่): prepend ที่มี id ก่อนเรียก AI แล้ว**ลบใน `finally`** ไม่งั้น AI พัง = skeleton ค้างถาวร
```js
$("#tinyfeed-x-list").prepend(`<div id="tinyfeed-x-skel">${skeletonCardHtml()}</div>`);
try { … await tinyGenerate(…) … } finally { $("#tinyfeed-x-skel").remove(); }
```

### 4.3 Modal — `.tinyfeed-modal` ✅ (เปลี่ยนชื่อแล้ว เฟส 6)

```html
<div id="tinyfeed-<name>-modal" class="tinyfeed-modal tinyfeed-hidden">
  <div class="tinyfeed-modal-card">
    <div class="tinyfeed-modal-head">
      <span>หัวข้อ</span>
      <span id="tinyfeed-<name>-close" title="ปิด"><i class="fa-solid fa-xmark"></i></span>
    </div>
    …
  </div>
</div>
```

เดิม modal component กลางนี้ชื่อ **`.tinyfeed-gallery-picker`** — ชื่อของฟีเจอร์แรกที่บังเอิญต้องใช้ ทั้งที่ modal **13 ตัว** ใช้มันร่วมกัน ทำให้อ่านโค้ดแล้วไม่รู้ว่าเป็นของกลาง ตอนนี้เปลี่ยนเป็น `.tinyfeed-modal` / `-modal-card` / `-modal-head` แล้ว

> ⚠️ **id `#tinyfeed-gallery-picker` ยังชื่อเดิม** (คนละเรื่องกับคลาส — เป็นตัวเลือกรูปจริงๆ) เช่นเดียวกับ `#tinyfeed-gallery-picker-grid` / `-close`
> ⚠️ **ถ้าเคยเขียน CSS เองใน "ปรับแต่งหน้าตา" ที่อ้าง `.tinyfeed-gallery-picker` ต้องแก้เป็น `.tinyfeed-modal`**

**ทุก modal ต้องลงทะเบียนใน `OVERLAYS`** ไม่งั้นปุ่มย้อนกลับจะข้ามมันไป (ดูบทที่ 2)

### 4.4 ปุ่ม

| คลาส | ใช้เมื่อ |
|---|---|
| `.tinyfeed-btn-primary` | การกระทำหลัก 1 ปุ่มต่อหน้าจอ |
| `.tinyfeed-btn-ghost` | การกระทำรอง, ยกเลิก |
| `.tinyfeed-btn-generate` | ปุ่มที่เรียก AI (มีสถานะ `.tinyfeed-generating`) |
| `.tinyfeed-compose-iconbtn` | ไอคอนในแถบพิมพ์ |
| `.tinyfeed-compose-inbtn` | ไอคอน**ในช่อง**พิมพ์ (มุมขวาล่าง) |

**Modifier ต่อท้ายได้ ไม่ใช่เขียนปุ่มใหม่** — ใส่คลาสเสริมคู่กับ base เสมอ:
```html
<button class="tinyfeed-btn-primary tinyfeed-shop-generate">ให้ AI สร้างสินค้า</button>
<button class="tinyfeed-btn-ghost tinyfeed-shop-clearbtn">ล้าง</button>
```

✅ **ตรวจแล้ว (เฟส 6): ไม่มีปุ่ม one-off ที่ต้องยุบ** — modifier ทุกตัวใช้คู่กับ base ถูกต้องอยู่แล้ว เป็นแค่ layout/สี ไม่ได้เขียนปุ่มใหม่
*(`-shop-addbtns` = กล่อง flex ครอบปุ่ม ไม่ใช่ปุ่ม)*

### 4.4b หน้าตั้งค่า — 2 ระดับ ✅ (เฟส 3)

หน้าตั้งค่ายาว ~700 บรรทัดรวดเดียวถูกแยกเป็น 2 ระดับ:

- **ระดับ 1** `#tinyfeed-settings-list` — รายการ 22 หัวข้อจัดใต้ 6 หมวด (สร้างด้วย `renderSettingsList()` จาก `SETTINGS_LAYOUT`)
- **ระดับ 2** `#tinyfeed-settings-detail` — กลุ่มทั้ง 22 อยู่ที่นี่ ซ่อนไว้หมด โชว์ทีละกลุ่มด้วย `openSettingsGroup(id)`

**เพิ่มกลุ่มตั้งค่าใหม่:**
1. `phone.html` → `<div class="tinyfeed-settings-group tinyfeed-hidden" data-group="<id>">` ข้างใน `#tinyfeed-settings-detail`
2. `index.js` → เพิ่ม `{ id, name, icon, desc }` ในหมวดที่ต้องการใน `SETTINGS_LAYOUT`

> **อ้างกลุ่มด้วย `data-group` ไม่ใช่ข้อความหัวข้อ** — เดิม `organizeSettings()` จับคู่ด้วยข้อความไทย แก้คำในหัวข้อแล้วกลุ่มหลุดไปท้ายหน้าเงียบๆ ตอนนี้ `renderSettingsList()` เทียบ id สองทางแล้ว `console.error` ทันทีถ้าไม่ตรง (กลุ่มใน HTML ที่ไม่มีใน layout และกลับกัน)

### 4.5 แถบแท็บ — `.tinyfeed-tabs` ✅ (รวมแล้ว เฟส 4)

```html
<div class="tinyfeed-tabs">
  <div class="tinyfeed-tab tinyfeed-tab-active" data-mtab="agenda">
    <span class="fa-solid fa-calendar-day"></span> กำหนดการ
  </div>
  <div class="tinyfeed-tab" data-mtab="notes">…</div>
</div>
```

> **แยกแอปด้วย data attribute ไม่ใช่ชื่อคลาส** — `data-tab` (feed) · `data-mtab` (memo) · `data-fsort` (forum) · `data-gtab` (gallery)

เดิมมีหลายชุดคลาสแยกกัน (`-tabs` / `-memo-tabs` / `-forum-tabs` / `-gallery-tabs`) เป็น alias ของสไตล์เดียวกันอยู่แล้ว (เขียนเป็น grouped selector) สาเหตุที่ต้องแยกไม่ใช่ดีไซน์ แต่เพราะ `openSettings()` เคยซ่อน `.tinyfeed-tabs` แบบ global — **หมดไปแล้วในเฟส 3**

**⚠️ กับดักที่ต้องระวังตลอดไป: ทุก selector ต้องจำกัดด้วย data attribute**

ตอนนี้ทุกแอปใช้ `.tinyfeed-tab` ร่วมกัน ถ้าเขียน `$(".tinyfeed-tab").removeClass("tinyfeed-tab-active")` แบบไม่จำกัด **จะไปล้าง active ของแอปอื่นด้วย** ทุกฟังก์ชันสลับแท็บจึงต้องเขียนแบบนี้:

```js
$(".tinyfeed-tab[data-mtab]").removeClass("tinyfeed-tab-active");
$(`.tinyfeed-tab[data-mtab="${memoTab}"]`).addClass("tinyfeed-tab-active");
```

เช่นเดียวกับการซ่อน/โชว์แถบแท็บ ต้องจำกัดด้วยแอป: `$("#tinyfeed-app-feed .tinyfeed-tabs")` ไม่ใช่ `$(".tinyfeed-tabs")`

### 4.6 การ์ด — ไม่มี base ร่วม (ตั้งใจ)

✅ ตรวจแล้ว (เฟส 6): `-bank-card` (การ์ดยอดเงินไล่เฉดเขียว ตัวอักษรขาว) · `-note-card` (แถวในลิสต์ มีเส้นคั่นล่าง ไม่ใช่การ์ด) · `-pet-game-card` (แถวเกมแนวนอน) — **เป็นคนละ component จริง ไม่ใช่โค้ดซ้ำ** บังคับให้มี base ร่วมจะได้ abstraction ปลอมๆ **จึงไม่ทำ**

การ์ดใหม่ที่เป็น "กล่องขอบมุมมน" ธรรมดา ให้ประกอบจาก token: พื้น `var(--tf-topbar)` · ขอบ `1px solid var(--tf-border)` · `border-radius: var(--tf-r-md)` · `padding: var(--tf-sp-4)`

### 4.6b หน้ารายละเอียดโพสต์ — แบบเดียวกันทั้งระบบ

> **โพสต์ในฟีด = การ์ดย่อ · แตะแล้วเข้าหน้ารายละเอียดที่มีคอมเมนต์ + ช่องเขียนคอมเมนต์**

| แอป | ในลิสต์ | หน้ารายละเอียด |
|---|---|---|
| TinyFeed | หัว + เนื้อ + `[❤][💬 จำนวน]` | คอมเมนต์ทั้งหมด + ช่องเขียน |
| TinyForum | รายการกระทู้ | หน้ากระทู้ + คอมเมนต์ + ช่องเขียน |

**กติกาเวลาใช้ `.tinyfeed-post` ในแอปใหม่:**
1. เก็บ id ใน data attribute **ของตัวเอง** (`data-post` / `data-vpost`) และ handler ต้องจำกัดด้วย attribute นั้น
   ⚠️ handler กลางเดิมเขียน `.tinyfeed-post` ลอยๆ ไม่จำกัด `[data-post]` → เสี่ยงชนกับ `.tinyfeed-post` ของแอปอื่นที่เก็บ id ใน data attribute คนละชื่อ แก้เป็น `.tinyfeed-post[data-post]` แล้ว
2. ปุ่มย่อยบนการ์ด (ไลก์ / ลบ / สติกเกอร์ / ส่ง) **ต้อง `e.stopPropagation()`** ไม่งั้นกดแล้วเด้งเข้าหน้ารายละเอียด
3. การ์ดในหน้ารายละเอียดใส่ `.tinyfeed-post-detail` ด้วย เพื่อไม่ให้กดซ้ำเข้าตัวเอง
4. ลงทะเบียน `back()` ใน `APPS` ให้ปุ่มย้อนกลับพากลับหน้ารายการ

### 4.7 แถบ input — `.tinyfeed-inputwrap`

✅ **ตัวอย่างที่ทำสำเร็จแล้ว — ใช้เป็นแม่แบบของ component กลางตัวอื่น**

`.tinyfeed-inputwrap` (relative, flex:1) ครอบ input + `.tinyfeed-compose-inbtn` (absolute มุมขวาล่าง) ใช้ร่วมกันแล้วจริงที่: connect · stream viewer · stream streamer · forum comment · feed comment

**ใช้ครบทั้ง 5 แถบแล้ว**: TinyConnect · TinyStream ผู้ชม · TinyStream สตรีมเมอร์ · TinyForum คอมเมนต์ · TinyFeed คอมเมนต์

โครงร่วม: `[ไอคอนนำหน้า 0–2 อัน][.tinyfeed-inputwrap: ช่องพิมพ์ + .tinyfeed-compose-inbtn สติกเกอร์][ปุ่มส่ง]`
ต่างกันแค่ไอคอนนำหน้า (➕🖼 / 🎁 / avatar / ไม่มี) กับไอคอนปุ่มส่ง (✈ / 🎤)

**Gotcha ที่ต้องรู้:** `.tinyfeed-inputwrap > input { padding-right: 42px }` ชนะเฉพาะ input ที่เลือกด้วย class — **ไม่ชนะ input ที่เลือกด้วย id** ช่องที่เป็น id ต้องตั้ง `padding-right` ในกฎ id เอง

### 4.8 ข้อความ rich — `renderRich()`

`[img:ชื่อ]` และ `[sticker:ชื่อ]` ถูกแปลงกลางที่ `renderRich()` → **ทุกแอปได้ฟีเจอร์นี้ฟรี ห้าม parse token เอง**

- ลำดับความสำคัญ: **รูปชนะสติกเกอร์** (`resolveMediaPriority`)
- input ต้อง escape มาก่อนเสมอ (`escapeText`/`escapeHtml`/`escapeAttr`) — `renderRich` ปลอดภัยเพราะสมมติว่า input escape แล้ว
- TinyFeed ใช้ `renderPostBody()` แทน (ดึงสื่อออกมาไว้ใต้ข้อความ) ไม่ใช่ `renderRich` ตรงๆ

---

## 5. Data scope contract

### กฎ

| Scope | เก็บที่ | เกณฑ์ | ตัวอย่าง |
|---|---|---|---|
| **`chat`** | `chat_metadata.tinyfeed.<key>` | **เนื้อหาที่เกิดจากเรื่องราวในแชทนี้** — ลบแชท = ควรหายไปด้วย | โพสต์, ข่าว, ข้อความแชต, กระทู้, กำหนดการ, ธุรกรรม |
| **`global`** | `extension_settings.tinyfeed.<key>` | **คลัง / ตัวตน / ของที่ควรตามผู้เล่นไปทุกแชท** | คลังรูป, แคตตาล็อกสินค้า, สัตว์เลี้ยง, โปรไฟล์, NPC |

### ตารางปัจจุบัน

| App | Scope | คีย์ | Getter / Saver |
|---|---|---|---|
| feed / news | `chat` | `.feed` `.news` | `getFeedData()` / `saveFeedData()` |
| connect | `chat` | `.connect` | ↑ |
| stream | `chat` | `.stream` | `getStreamData()` |
| memo | `chat` | `.agenda` `.notes` | `getAgenda()` / `getNotes()` |
| forum | `chat` | `.forum` | `getForum()` |
| bank | `chat` | `.bank` | `getBankData()` |
| shop (แคตตาล็อก + ที่ซื้อแล้ว) | `chat` | `.shop` `.shopOwned` | `getShop()` / `saveShop()` · `getShopOwned()` |
| UI state | `chat` | `.ui` | `saveLastScreen()` |
| gallery | `global` | `.gallery` | `getGallery()` / `saveGallery()` |
| หมวดสินค้า (`shopCategories`) | `global` | setting | `getShopCategories()` — เหมือน `forumRooms` ของ TinyForum: ตั้งชื่อหมวดครั้งเดียวใช้ข้ามเรื่อง แต่สินค้าจริงแยกตามแชท |
| pet + ร้านเพ็ท | `global` | `.pet` `.petShop` | `getPet()` / `savePet()` |
| NPC | `global` (ผูกการ์ด) | `.npcsByChar` | `getNpcsStore()` / `saveNpcs()` |
| โปรไฟล์ | `global` (ผูก persona/การ์ด) | `.userProfiles` `.charProfiles` | `getProfileStore()` |
| สกุลเงิน (`bankCurrency`) | `global` (ผูกการ์ด) | `.charCurrency` | `getCharCurrency()` / `setCharCurrency()` |

⚠️ **`shop` เดิมเคยเป็น `global`** (ย้ายมา `chat` 2026-08) — `getShop()` ยังมี migration ครั้งเดียวต่อแชทที่สำเนาแคตตาล็อก global เก่ามาเป็นจุดเริ่มต้น (กันของหายตอนเปลี่ยน scope) ดูคอมเมนต์ในฟังก์ชัน
**ค่า global เก่า (`shop`/`bankCurrency`/`bankCurrencyAfter`) ถูกล้างทิ้งแล้ว** (`cleanupLegacyGlobalScope()` ใน `loadSettings()`, ครั้งเดียว ตามคำขอผู้ใช้ 2026-08) — แชทที่ยังไม่เคยเปิดหลังจากนี้จะไม่ได้รับการ seed แคตตาล็อกอีกต่อไป (เริ่มว่างเปล่า) และตัวละครที่ไม่มี `charCurrency` ของตัวเองจะ fallback ไปที่ค่า default ในโค้ด (`"฿"`) ไม่ใช่ค่าที่ผู้ใช้เคยตั้งไว้แบบ global เดิม

### กฎการเซฟ

- **global → `setSetting()` หรือ saver เฉพาะ + `saveSettingsDebounced()`** ✅ ทำถูกอยู่แล้ว
- **chat → `saveFeedDataDebounced()`** ✅ (แก้ 2026-08) เดิม `saveFeedData()` เรียก `context.saveMetadata()` ตรงๆ ไม่ debounce ที่ 54 จุด เสี่ยงชน lock ภายในของ ST (`isChatSaving` ใน `saveChatConditional()`) — ถ้ามีเซฟค้างอยู่เกิน 1 วินาที คำขอใหม่จะถูกข้ามเงียบๆ ไม่มี error ให้เห็น ยิ่งเรียกถี่ (เช่นทุกครั้งที่เปลี่ยนหน้าจอผ่าน `saveLastScreen`) ยิ่งชนบ่อย
  ตอนนี้ทุกจุดเปลี่ยนมาเรียก `saveFeedDataDebounced()` (ห่อ `context.saveMetadataDebounced()` ของ ST เอง — debounce จริง + กันเซฟทับตอนสลับตัวละคร/กลุ่มระหว่างรอ) ยกเว้น **`closePhone()`** ที่เรียก `flushAllSaves()` ตรงๆ เป็น flush สุดท้ายตอนปิดเครื่อง กันดีเบาซ์ที่ค้างอยู่หายไปเฉยๆ
  อ่านจาก `getFeedData()` ไม่ต้องรอเซฟเสร็จ — object เดียวกันใน memory ถูกแก้ synchronous เสมอ ต่างจากแค่ตัวไฟล์บนดิสก์ที่ค่อยตามหลัง
- **`flushAllSaves()`** (`src/store.js`, เพิ่ม 2026-08) เรียก `saveSettings()` + `saveFeedData()` แบบ**ข้าม debounce ทั้งคู่ทันที** ผูกกับ `document.visibilitychange` (`hidden`) ใน bootstrap — กันเคสมือถือสลับแอป/แช่แข็งแท็บกลางอากาศระหว่างที่ยังมีเซฟแบบ debounce ค้างอยู่ (1 วิ) ยังไม่ทันยิง แล้วดีเบาซ์นั้นหายไปเงียบๆ ตอนกลับมาเปิดใหม่/แท็บถูกเคลียร์ ก่อนหน้านี้มี flush ทันทีแค่ตอนกด "X" ปิดเครื่องเอง (`closePhone()`) ซึ่งไม่ครอบคลุมเคสสลับแอป — ตอนนี้ `closePhone()` ก็เรียก `flushAllSaves()` ตัวเดียวกันแทนที่จะเรียก `saveFeedData()` ตรงๆ
- **ทุก getter ต้อง lazy-create + type-guard** (`if (!Array.isArray(d.feed)) d.feed = []`) เพราะผู้ใช้เก่าอาจไม่มีคีย์นั้น
- **เพิ่มคีย์ใหม่ใน `defaultSettings` ได้เสมอ** — `getSetting()` fallback ให้อยู่แล้ว ไม่ต้องเขียน migration
- **เปลี่ยน*ความหมาย*ของคีย์เดิมต้องมี migration** เรียกครั้งเดียวใน `loadSettings()` และต้อง idempotent (แม่แบบ: `migrateLegacyAvatars()`)

### การส่งข้อมูลออกนอกแอป — ทะเบียน `INJECT_SOURCES`

มี 2 ทางที่เนื้อหาในแอปออกไปข้างนอกได้ ทั้งคู่ใช้ `buildAppBlocks(want)` ตัวเดียวกัน:

| ทาง | ไปไหน | คุมด้วย |
|---|---|---|
| **แทรกเข้า RP** | `setExtensionPrompt` → ตัวละครในแชทหลักรับรู้ | `injectWant()` ← setting `inject*` |
| **ข้ามแอป** | prompt ตอนแอปอื่นเจนเนื้อหา | `crossAppContext(exclude)` ← setting `crossApp*` |

> **เพิ่มแหล่งใหม่ = เพิ่ม entry ใน `INJECT_SOURCES` ที่เดียว** แล้วเพิ่ม `case` ใน `buildAppBlocks` + checkbox 2 ตัวใน `phone.html`

```js
{ id: "bank", inject: "injectBank", cross: "crossAppBank", single: () => ({ bank: true }) }
```

`injectWant` / `injectText` / `injectDashboard` / `crossAppContext` **derive จากทะเบียนนี้ทั้งหมด**
⚠️ เดิมลิสต์แหล่งถูกเขียนซ้ำ 4 ที่ — ตอนเพิ่ม bank/shop/pet ลืมไป 2 ที่ (`injectText` คืนค่าว่างถ้าเปิดเฉพาะแหล่งใหม่ · token dashboard นับขาด) **แบบเงียบๆ ไม่มี error** จึงรวมเป็นทะเบียนเดียว

**สถานะความครอบคลุม (2026-08-12):**

| แอป | แทรกเข้า RP | ข้ามแอป | เห็นแอปอื่น |
|---|---|---|---|
| feed · news · connect · stream · memo · forum | ✅ | ✅ | ✅ |
| **bank · shop · pet** | ✅ | ✅ | shop/pet ✅ · bank ไม่เจน |
| gallery | — ใช้ทางของตัวเอง (`galleryPromptBlock`) | — | — |

### ⚠️ Known inconsistency — TinyBank ↔ TinyPet

`petTopup()` เรียก `bankDeduct()` = **ถอนเงินจาก TinyBank ของแชท A ไปเป็นเหรียญเพ็ทที่เป็น global แล้วตามไปใช้ในแชท B ได้**

นี่ผิดกฎ scope ชัดเจน แต่ **ยังไม่แก้** เพราะกระทบ save เดิมของผู้ใช้ ทางเลือกเมื่อจะตัดสินใจ:
- **(ก)** ย้าย `bank` → global — ง่ายสุด แต่เสียแนวคิด "เงินของเรื่องนี้"
- **(ข)** ย้าย `pet.coins` → per-chat — เพ็ทยัง global แต่เหรียญผูกแชท
- **(ค)** ปล่อยไว้ แล้วบันทึกว่าเป็นฟีเจอร์ (เพ็ทเป็น "ของเรา" ข้ามโลก เงินก็ควรพกข้ามได้)

---

## 6. Async & error

### Busy flag

ทุก async ที่ผู้ใช้กดซ้ำได้ต้องมี flag กันซ้อน แล้ว **ต้องปลดใน `finally`**:

```js
if (isXBusy) return;
isXBusy = true;
try { … } finally { isXBusy = false; }
```

ปัจจุบันมี **12 ตัว** — รวมโดย `proactiveBusy()` เพื่อกันงานเบื้องหลังชนงานที่ผู้ใช้สั่ง

⚠️ **ตั้งชื่อไม่ตรงกัน 4 แบบ** → มาตรฐานคือ **`isXBusy`**

| รูปแบบ | จำนวน | ตัวแปร |
|---|---|---|
| `isXBusy` ✅ | 6 | `isShopBusy` `isPetShopBusy` `isGenCommentsBusy` `isMemoBusy` `isForumBusy` `isAutoBusy` |
| `isGeneratingX` | 2 | `isGeneratingStream` `isGeneratingNews` |
| อื่นๆ | 2 | `isGenerating` (ของ feed) `isConnectReplying` |

*(`isReplying` ที่ `index.js:5774` ไม่ใช่ busy flag — เก็บ postId ที่ AI กำลังตอบอยู่ ไม่ต้องเปลี่ยนชื่อ)*

⚠️ มี `} finally {` **25 บล็อก** แต่มีการปลด flag **28 จุด** = **มี 3 จุดที่ปลดนอก `finally`** ถ้า throw ก่อนถึงบรรทัดนั้น flag จะค้าง แอปนั้นจะกดไม่ได้จนกว่าจะรีโหลด

### Error

> **ห้าม catch เปล่า**

⚠️ ปัจจุบันมี **19 catch block ที่ว่างหรือมีแต่คอมเมนต์** (`catch (e) {}` / `catch (e) { /* ข้าม */ }`) ครอบคลุม path สำคัญอย่างการอ่าน `getFeedData()`, ดึง World Info, นับ token, อ่าน persona, กู้หน้าจอล่าสุด → **เวลาพัง จะเงียบสนิท ตามหาไม่เจอ**

กฎ:
- catch ที่ตั้งใจให้เงียบ (มี fallback ชัดเจน) → `catch (e) { /* fallback: <อธิบาย> */ }` **ต้องบอกว่า fallback คืออะไร**
- catch ที่ผู้ใช้ควรรู้ → `console.error("[tinyfeed] <บริบท>", e)` + `toastr.error(...)`
- catch ที่ไม่ควรเกิด → `console.warn` อย่างน้อย

### Toast

| ระดับ | ใช้เมื่อ | ปัจจุบัน |
|---|---|---|
| `toastr.success` | ทำสำเร็จและผู้ใช้ควรรู้ | 21 |
| `toastr.info` | บอกสถานะ ไม่ใช่ปัญหา | 67 |
| `toastr.warning` | ทำต่อได้แต่ผลไม่ครบ | 14 |
| `toastr.error` | ล้มเหลว | 31 |

title ใช้ชื่อแอปเสมอ (`"TinyPhone"`, `"TinyPet"`, …)

### ST API

ทุกครั้งที่เรียก ST API ต้อง guard เพราะ ST เวอร์ชันต่างกันมีไม่เท่ากัน:

```js
const ctx = getContext();
if (typeof ctx.generateQuietPrompt !== "function") {
    toastr.error("SillyTavern เวอร์ชันนี้ยังไม่รองรับ", "TinyPhone");
    return;
}
```
✅ ทำถูกอยู่แล้ว (16 guard รอบ `generateQuietPrompt` อย่างเดียว)

---

## 7. Module layout

### สถานะ

`index.js` = **8,982 บรรทัด, 485 top-level function, ~60 mutable global** ในไฟล์เดียว มีเพียงคอมเมนต์ `// ===== หัวข้อ =====` 47 อันคั่น

### แยกไฟล์ได้ไหม — **ได้**

ST โหลด manifest `js` ด้วย `<script type="module">` จริง (`SillyTavern-release/public/scripts/extensions.js:824`) → `import` ไฟล์พี่น้องได้, top-level `await` ได้

ข้อจำกัด: ไม่มี bundler → **ทุก import ต้องเป็น path สัมพัทธ์ที่ browser resolve ได้ และต้องมี `.js` ต่อท้าย** · manifest มี `js` ได้ไฟล์เดียว (แยกด้วย import) และ `css` ได้ไฟล์เดียว (แยกด้วย `@import`)

### โครงปัจจุบัน ✅ (แยก leaf แล้ว)

```
tinyfeed/
├── index.js           8,715 บรรทัด — แอปทั้ง 11 + shell + bootstrap
└── src/
    ├── store.js         263 — getSetting/setSetting · getFeedData/saveFeedData
    │                          getGallery/saveGallery · defaultSettings · ค่าคงที่
    │                          deps: 0 (leaf แท้) · ถูกเรียกจาก 137 ฟังก์ชัน
    ├── util.js          136 — escape* · renderRich + token [img:]/[sticker:]
    │                          timeAgo/displayTime · stripReasoning
    │                          deps: getGallery จาก store · ถูกเรียกจาก 112 ฟังก์ชัน
    └── components.js     28 — emptyStateHtml · emptyInlineHtml · skeletonCardHtml
                               deps: 0 · ถูกเรียกจาก 17 ฟังก์ชัน
```

**ทิศทางพึ่งพาทางเดียว:** `components` (0) · `store` (0) ← `util` ← `index.js`
**ห้าม import ย้อนกลับ** — `src/*` ห้าม import อะไรจาก `index.js` เด็ดขาด (จะเกิด circular)

path จาก `src/` ไปหา core ของ ST ลึกกว่า `index.js` หนึ่งชั้น: `../../../../extensions.js` และ `../../../../../script.js`

### ⚠️ ทำไมไม่แยกตามแอป (วัดแล้ว ไม่ใช่ความรู้สึก)

| ตัวชี้วัด | ค่า |
|---|---|
| เส้นเรียกฟังก์ชันข้ามโมดูล (ถ้าแยกตามแอป) | **570 เส้น** |
| global ที่ถูกแก้ค่าข้าม section | **45 ตัว** (จาก 77) |
| `currentApp` ถูกแตะจาก | **15 section** |
| TinyPet ถูกเรียกจากนอกตัวเอง | 32 ฟังก์ชัน |
| TinyGallery / TinyConnect | 21 ฟังก์ชัน |

**แอปพันกันโดยธรรมชาติของฟีเจอร์** — TinyPet โพสต์ลง TinyFeed และ DM ผ่าน TinyConnect · ตัวเลือกรูปของ TinyGallery ถูกใช้ในทุกแถบพิมพ์ · TinyShop ผูกกับ TinyBank

และข้อจำกัดตายตัวของ ES module: **ตัวแปรที่ `import` มา แก้ค่าไม่ได้** (`currentApp = "feed"` ข้ามไฟล์ = TypeError) การแยกตามแอปจึงต้องรื้อ global 45 ตัวเป็น state object ก่อน = เสี่ยงสูง ผลตอบแทนต่ำ **จึงหยุดที่ leaf 3 ชั้น**

ถ้าจะไปต่อในอนาคต ลำดับที่เสี่ยงน้อยสุดคือ `generate.js` (tinyGenerate/buildPrompt/PROMPT_DEFS) → `notif.js` → แล้วค่อยคิดเรื่อง state object

---

## 8. สถานะ migration

| เฟส | งาน | เสี่ยง | สถานะ |
|---|---|---|---|
| 0 | เขียนเอกสารนี้ | — | ✅ |
| 1 | เพิ่ม design tokens + ย้ายบล็อกขึ้นบนไฟล์ (additive) | ต่ำ | ✅ |
| 2 | `APPS` + `OVERLAYS` registry + `openApp`/`goHome`/`handleBack` generic | **กลาง** | ✅ |
| 3 | ย้าย `#tinyfeed-settings-screen` ออกจาก `#tinyfeed-app-feed` + ทำตั้งค่า 2 ระดับ | **กลาง** | ✅ |
| 4 | รวมแถบแท็บ 5 ชุด → `.tinyfeed-tabs` ชุดเดียว | ต่ำ | ✅ |
| 5 | รวม empty state 6 คลาส → `emptyStateHtml()` + `emptyInlineHtml()` | ต่ำ | ✅ |
| 6 | rename `.tinyfeed-gallery-picker*` → `.tinyfeed-modal*` (13 modal) · ตรวจปุ่ม/การ์ดแล้วไม่ต้องยุบ | ต่ำ | ✅ |
| 7 | แทนสีดิบด้วย token (56 จุด) — เหลือเฉพาะที่ควรเป็นค่าดิบ | ต่ำ | ✅ |
| 8 | แยก leaf → `src/store.js` · `src/util.js` · `src/components.js` | กลาง | ✅ |
| — | แยกตามแอป (`src/apps/*.js`) | สูง | ❌ ไม่ทำ — ดูเหตุผลบทที่ 7 |

### วิธี verify (ใช้ได้ผลจริงในโปรเจกต์นี้)

1. `node --check tinyfeed/index.js` ทุกครั้งหลังแก้
2. **Pure-logic unit test** ใน scratchpad — เทียบผลลัพธ์ก่อน/หลัง refactor
3. **CSS harness** — `_test.html` ชั่วคราว **ข้างใน** `tinyfeed/` ลิงก์ `./style.css` ครอบด้วย
   `<div id="tinyfeed-phone" class="tinyfeed-theme-dark">` (token ผูกกับ `#tinyfeed-phone` ถ้าไม่ครอบจะไม่มีสี)
   วัดด้วย `getBoundingClientRect` / `getComputedStyle`
   **⚠️ screenshot ของหน้า `file:` เรนเดอร์ว่างเปล่าในสภาพแวดล้อมนี้ — เชื่อตัวเลข อย่าเชื่อภาพ**
   เช็คว่าทุกหน้าจอ `scrollWidth === clientWidth` ที่กว้าง 320px · ลบ `_test.html` ทิ้งเมื่อเสร็จ
4. **Runtime ใน SillyTavern จริง — ผู้ใช้ทดสอบเอง** (AI generation, การ persist, notification, decay ข้ามการรีสตาร์ต)

---

## 9. การตัดสินใจที่ตั้งใจ (ไม่ใช่งานค้าง)

บันทึกไว้เพื่อไม่ให้ใครมา "แก้ให้ถูก" ทีหลัง — **สิ่งเหล่านี้ถูกแล้ว**

| เรื่อง | ทำไม |
|---|---|
| **ไม่ใช้ `--SmartTheme*` ของ SillyTavern** | โทรศัพท์ต้องมีธีมของตัวเอง (มืด/สว่าง + accent ที่ผู้ใช้เลือก) ไม่ควรเปลี่ยนตามธีม ST — `--tf-*` จึงเป็นระบบแยก **จงใจ** |
| **ไม่ใช้ `Popup` / `callGenericPopup` ของ ST** | Popup ของ ST เป็น `<dialog>` + `showModal()` ซึ่งอยู่ใน browser top layer = **ทะลุกรอบโทรศัพท์** ทำลายภาพลวงตาว่าเป็นมือถือ modal ในเครื่องต้องถูกกักอยู่ใน `#tinyfeed-phone` |
| **ไม่ใช้ slash command** | ทุกอย่างเข้าถึงผ่านตัวโทรศัพท์ ไม่ใช่ผ่านช่องแชต ST |
| **ไม่ใช้ `t\`\`` (i18n) ของ ST** | โปรเจกต์นี้เป็นภาษาไทยล้วนโดยตั้งใจ (รวมทั้ง prompt) — ถ้าจะรองรับหลายภาษาค่อยว่ากันเป็นงานแยก |
| **ไม่ใช้ `renderExtensionTemplateAsync`** | `phone.html` ถูกโหลดด้วย `$.get` + `append` ครั้งเดียว ไม่ต้องการ Handlebars หรือการ sanitize ซ้ำ |
| **`{{token}}` ใน `PROMPT_DEFS` ไม่ใช่ macro ของ ST** | เป็นระบบของเราเอง (`buildPrompt` ใช้ `split().join()`) เพื่อให้ผู้ใช้แก้ prompt ได้โดยไม่ต้องรู้ macro engine ของ ST |
| **`sw.js` ไม่ใช่ PWA service worker** | มีไว้อย่างเดียวเพื่อ `showNotification()` บน Android Chrome ที่ห้าม `new Notification()` — ไม่มี fetch handler ไม่มี cache **โดยตั้งใจ** |
| **มินิเกมต้อง low-motion** | เกม 🍎 catch เดิมใช้ `setInterval` rebuild DOM ~18×/วิ → แลคหนักบนมือถือใน ST **ถูกถอดทิ้ง** กฎคือ: อัปเดตเฉพาะ element ที่เปลี่ยน (`.text()` ตัวเลข หรือ toggle class หลุมเดียว) **ห้าม `.html()` ทั้งกระดานทุก tick** |

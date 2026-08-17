# TinyQuest (แอปที่ 13 ใน TinyPhone) — แผนรอบ ②–④ สำหรับ agent คนถัดไป

## Context

ผู้ใช้ต้องการระบบโรลเพลย์แนว RPG ใน extension `tinyfeed/` ที่เก็บ **สเตตัสผู้เล่น · ไอเทม · ข้อมูล NPC · ค่าความสัมพันธ์**
แรงบันดาลใจจาก **โทคิเมคิเมโมเรียล Girl's Side / เกมจีบหนุ่ม** (มีหน้าสถานะตัวเอง + สมุดรายชื่อที่ดูวันเกิด/ของที่ชอบ/
ค่าความชอบของแต่ละตัวได้) บวกความยืดหยุ่นให้ **ตั้งชุดสเตตัสเองได้** เพราะการ์ด RPG แต่ละใบใช้ค่าไม่เหมือนกัน

**ตัดสินใจไปแล้ว (ห้ามรื้อ):** รวมเป็นแอปที่ 13 ใน `tinyfeed/` ไม่แยก extension · หน้าตา 3 ชั้น (แอปเต็ม + HUD หน้าแชท ST +
วิดเจ็ตโฮม) · **schema ผูกกับการ์ด / ค่าที่เล่นจริงผูกกับแชท** · ลำดับ ①สเตตัส → ②สมุด NPC → ③กระเป๋า → ④เควส

> **อัปเดต 2026-08-17 (Claude Sonnet 5, session ต่อจาก agent ก่อนหน้า):**
> **ทำครบทั้ง 4 รอบแล้ว — TinyQuest เสร็จสมบูรณ์ตามแผนนี้** รอบ①② เสร็จแล้วจริง (ไฟล์นี้เขียนหัวข้อว่า "รอบ ① เสร็จแล้ว" ไว้ตอนแรก แต่ตรวจโค้ดจริงพบว่า agent ก่อนหน้าทำรอบ ② เสร็จไปด้วย) รอบ③ (กระเป๋าไอเทม) ทำต่อจนจบ ดูหัวข้อ "✅ สิ่งที่ทำในรอบ ③" และรอบ④ (เควส + AI สแกนบท) ทำต่อจนจบเช่นกัน ดูหัวข้อ "✅ สิ่งที่ทำในรอบ ④" ท้ายไฟล์นี้
> **ถ้ามาอ่านไฟล์นี้ต่อ**: ไม่มีรอบไหนเหลือแล้วตามแผนเดิม — ถ้าผู้ใช้ขอฟีเจอร์เพิ่ม ให้ถือเป็นงานใหม่ ไม่ใช่การทำแผนนี้ต่อ
> เอกสารอ้างอิงเชิงลึกอยู่ใน memory `tinyphone-status` (เซสชัน 2026-08-17) — ไฟล์ `tinyquest-app` ที่อ้างถึงเดิมไม่มีอยู่จริงในเครื่องนี้ (คนละ session/เครื่องกับที่เขียนไฟล์นี้)

---

## สิ่งที่มีอยู่แล้วจากรอบ ① (ฐานที่รอบ ②–④ ต่อยอด)

โค้ด TinyQuest ทั้งก้อนอยู่ `tinyfeed/index.js` **บรรทัด ~3870–4402** (ระหว่าง `novelDeleteBook()` กับ `PET_DECAY_DEFAULTS`)
— เลขบรรทัดคือ ณ 2026-08-17 จะเลื่อนเมื่อแก้ ให้ค้นด้วย**ชื่อฟังก์ชัน**เป็นหลัก

| มีแล้ว | ใช้ต่อยังไงในรอบ ②–④ |
|---|---|
| `getRpgSchema()` / `saveRpgSchema()` — schema ต่อ `getCharKey()` | เพิ่มฟิลด์ `npcStats` / `npcFields` / `stages` เข้า object เดิม |
| `getRpg()` / `saveRpg()` — per-chat `{values,max,log}` | เพิ่ม key `npc` / `inventory` / `quests` เข้า object เดิม |
| `statDef = {id,label,type,min,max,def,color,icon,group,hud,inject}` · type `bar/number/text/tag` | **ใช้ซ้ำทั้งดุ้นกับสเตตัส NPC** (รอบ ②) |
| `rpgSetStat` · `rpgApplyDelta(id,"+5"\|"-3"\|"=42")` · `rpgClamp` · `rpgLogPush` (cap 100) | ใช้ apply ผลไอเทม (③) + ผล AI scan (④) |
| `rpgStatRowHtml(def)` · `rpgGroupStats()` · `rpgStatValueText/Display` | เรนเดอร์สเตตัส NPC ซ้ำได้ (ต้องเติมพารามิเตอร์ target) |
| `rpgSchemaRowHtml()` · `renderRpgSchemaEditor()` · `RPG_PRESETS` | ตัวแก้ schema ของ NPC ใช้ตัวเดียวกัน (ส่ง array คนละชุด) |
| `parseRpgSchemaLines()` + `PROMPT_DEFS.rpgSchema` + flow **เสนอ → ติ๊กรับทีละอัน** (`rpgProposed`/`rpgAcceptProposals`) | **เป็นแม่แบบของ "ตรวจก่อนใช้" ในรอบ ④** |
| `renderRpg()` แท็บ `data-rtab` (status/schema) · `openRpg()` | เพิ่มแท็บใหม่ที่นี่ |
| HUD `mountRpgHud/updateRpgHud/updateRpgHudTheme` + `#tinyfeed-hud` | ยังไม่ต้องแตะ (ยกเว้นอยากโชว์ ♥ NPC ปัจจุบัน) |
| `INJECT_SOURCES` มี `{id:"rpg",...}` + บล็อก `if (want.rpg)` ใน `buildAppBlocks` | เติมบรรทัดความสัมพันธ์/ไอเทม/เควสในบล็อกเดิม |
| settings group `data-group="rpg"` + `rpgTokens`/`rpgExtraPrompt`/`hudEnabled`/`widgetRpg` | เพิ่ม setting ใหม่ในกลุ่มเดิม |

**ยังไม่ได้ทดสอบใน ST จริง** (mount HUD จริง, `generateQuietPrompt` ของปุ่มเสนอสเตตัส, persist) — ถ้าผู้ใช้แจ้งบั๊กจากรอบ ① ให้แก้ก่อนเริ่มรอบใหม่

---

## รอบ ② สมุดรายชื่อ NPC + ความสัมพันธ์  ← ทำอันนี้ก่อน

### ผู้ใช้เลือกไว้
- **ใครอยู่ในสมุด:** ตัวละครหลักของแชท + NPC ของการ์ดนี้ (`getNpcs()`) + **เพิ่มเองได้** — *ไม่* ดึง roster ข้ามการ์ดจาก TinyVerse
- **ความยืดหยุ่นของข้อมูล:** ค่าความชอบ + **ช่องข้อมูลตายตัวที่เป็นกลางกับทุก setting** + **สเตตัสคัสต้อมได้**
  > ⚠️ ข้อกำหนดจากผู้ใช้: **ห้ามฮาร์ดโค้ด "ชมรม" เป็นช่องตายตัว เพราะบาง setting ไม่ใช่โรงเรียน** →
  > ช่องตายตัวต้องเป็นกลาง (วันเกิด/อายุ/ส่วนสูง/บทบาท-อาชีพ/ของที่ชอบ/ของที่ไม่ชอบ/โน้ต) ส่วน "ชมรม", "เผ่าพันธุ์",
  > "สังกัด" ฯลฯ = **ช่องที่ผู้ใช้เพิ่มเองต่อการ์ด** + ซ่อนช่องตายตัวที่ไม่เกี่ยวได้

### โครงข้อมูล
```js
// global — ต่อการ์ด: ขยาย rpgSchemas[charFile] ที่มีอยู่
{ stats:[statDef],            // รอบ ① (ของผู้เล่น)
  npcStats:[statDef],         // ใหม่ — ชุดสเตตัสของ NPC (statDef ชุดเดียวกัน ใช้ตัวแก้เดิม)
  npcFields:[{id,label}],     // ใหม่ — ช่องข้อมูลที่ผู้ใช้เพิ่มเอง (เช่น ชมรม/เผ่าพันธุ์)
  npcFieldsHidden:[fieldId],  // ใหม่ — ช่องตายตัวที่ซ่อนสำหรับ setting นี้
  stages:[{at,label}] }       // ใหม่ — ระดับความสัมพันธ์ ตั้งชื่อเอง

// global — ตัวตน NPC ต่อการ์ด (รู้แล้วรู้เลย ไม่รีเซ็ตตอนเปิดแชทใหม่)
rpgNpcInfo: { <charFile>: { <npcKey>: {
    name, avatar, birthday, age, height, role, likes, dislikes, note,
    extra: { <fieldId>: value },     // ช่องที่ผู้ใช้เพิ่มเอง
    known: { <fieldId>: true },      // ฟิลด์ไหน "ค้นพบแล้ว"
} } }

// per-chat — ความรู้สึก/ความคืบหน้าของรอบนี้ (ขยาย getRpg())
rpg.npc = { <npcKey>: { affection, relation, stats:{<statId>:val},
                        events:[{ts,delta,text}], firstMetTs } }
```
`npcKey` = ชื่อ normalize (`String(name).trim().toLowerCase()`) เพราะ `getNpcs()` เดิมเก็บแค่ `{name, avatar}` ไม่มี id
— แพตเทิร์นเดียวกับที่ TinyGallery ใช้ชื่อเป็น id

### ค่าคงที่ + ฟังก์ชันใหม่
```js
RPG_NPC_FIELDS = [ {id:"birthday",label:"วันเกิด"}, {id:"age",label:"อายุ"}, {id:"height",label:"ส่วนสูง"},
                   {id:"role",label:"บทบาท/อาชีพ"}, {id:"likes",label:"ของที่ชอบ"},
                   {id:"dislikes",label:"ของที่ไม่ชอบ"}, {id:"note",label:"โน้ต"} ]   // เป็นกลางทุก setting
RPG_DEFAULT_STAGES = [{at:0,label:"คนแปลกหน้า"},{at:20,label:"รู้จักกัน"},{at:45,label:"สนิท"},
                      {at:70,label:"พิเศษ"},{at:90,label:"คนสำคัญ"}]
```
`getRpgNpcStore()`/`getRpgNpcInfo(key)`/`saveRpgNpcInfo()` (ตามแพตเทิร์น `getNpcsStore()` เป๊ะ) ·
`getRpgNpc(key)` (per-chat, lazy-create) · `rpgNpcList()` (รวม main char + `getNpcs()` + ที่เพิ่มเอง, dedupe ด้วย npcKey) ·
`rpgSyncNpcs()` (ปุ่มดึง NPC ใหม่จากการ์ดเข้ามา ไม่ทับของเดิม) · `rpgAffectionAdd(key,delta,why)` /
`rpgSetAffection(key,val,why)` (clamp 0–100 + push `events` cap ~50) · `rpgStageFor(aff)` ·
`rpgHearts(aff)` = `Math.round(aff/20)` → ♥×5 · `rpgFieldKnown(key,fieldId)` · `rpgRevealField(key,fieldId,value)`
(เซ็ตค่า + `known=true` + `showNotif` "ปลดล็อกข้อมูลใหม่") · `rpgActiveNpcFields()` (ตายตัวที่ไม่ถูกซ่อน + ที่เพิ่มเอง)

### UI — แท็บที่ 3 "สมุดรายชื่อ"
- **หน้ารายการ:** กริดการ์ด NPC (avatar + ชื่อ + ♥) — ก๊อป CSS จาก `.tinyfeed-verse-grid`/`.tinyfeed-verse-card` ·
  ปุ่ม "ดึง NPC จากการ์ด" (`rpgSyncNpcs`) + "เพิ่มเอง"
- **หน้ารายละเอียด** (module var `rpgNpcView` = npcKey): avatar ใหญ่ + ชื่อ + **♥ + ป้ายระดับความสัมพันธ์** +
  แถบ affection พร้อมปุ่ม ± → ช่องข้อมูล (**ช่องที่ `known!==true` โชว์ `???` แตะเพื่อกรอกเอง = ปลดล็อกทันที**) →
  สเตตัส NPC (ใช้ `rpgStatRowHtml` ซ้ำ) → ไทม์ไลน์ `events` → ปุ่มลบ
- **สำคัญ:** ต้องเพิ่ม `back()` ใน entry `APPS` ของ `rpg` ให้หน้ารายละเอียด → กลับหน้ารายการ (ดูตัวอย่างที่ entry `novel`)
- ลิงก์ "ดูโปรไฟล์เต็ม" → `openCharProfile(ชื่อ)` ที่มีอยู่แล้ว (`index.js` `openCharProfile`/`charCardForAuthor`)

### ตัวแก้ schema ของ NPC
เพิ่มสวิตช์สลับ **"สเตตัสผู้เล่น / สเตตัส NPC"** ในแท็บตั้งค่าสเตตัส แล้วให้ `renderRpgSchemaEditor()` รับพารามิเตอร์ว่าแก้
`schema.stats` หรือ `schema.npcStats` (ฟังก์ชัน `rpgAddStat`/`rpgDeleteStat`/`rpgMoveStat`/`rpgSaveStatField` ต้องรับ
`which` ด้วย) + ส่วนจัดการ `npcFields` (เพิ่ม/ลบช่องเอง) + `npcFieldsHidden` (checkbox ซ่อนช่องตายตัว) + `stages` (แก้ชื่อระดับ)

### Inject
เติมในบล็อก `if (want.rpg)` เดิมของ `buildAppBlocks` (อย่าสร้าง INJECT_SOURCES ตัวใหม่) — บรรทัดความสัมพันธ์
เช่น `ความสัมพันธ์: มิซากิ ♥♥♥♡♡ (62) สนิท · ยูกิ ♥♡ (18) รู้จักกัน` โดยแนบเฉพาะฟิลด์ที่ `known` แล้ว
คุมด้วย sub-toggle `injectRpgNpc` (แพตเทิร์นเดียวกับ `injectForumComments`)

---

## รอบ ③ กระเป๋าไอเทม

### ผู้ใช้เลือกไว้
**เพิ่มช่องเอฟเฟกต์เข้าไปในสินค้า TinyShop** — ซื้อแล้วเข้ากระเป๋า กดใช้แล้วค่าสเตตัสขึ้นจริง และ AI สร้างสินค้าก็ใส่เอฟเฟกต์ให้ได้

### สิ่งที่ต้องแตะใน TinyShop (ของเดิม)
- **shop item** ปัจจุบัน = `{id,name,price,image,emoji,desc,cat}` เก็บ **per-chat** ที่ `getFeedData().shop` (`getShop()`/`saveShop()`)
  → เพิ่ม `fx: { stat:<statId>, amount:<number> }` (`stat:""` = ไม่มีผล)
- ฟอร์มเพิ่ม/แก้สินค้า (`renderShop()` / `openShopEdit()` / `saveShopEdit()` + markup ใน `phone.html`) →
  เพิ่ม `<select>` เลือก stat (เติมจาก `getRpgSchema().stats` เฉพาะ type `number`/`bar`) + ช่องจำนวน
- `PROMPT_DEFS.shopItems` → ต่อ format เป็น `... | <statId หรือ -> | <จำนวน>` + แนบรายชื่อ statId ที่มีให้ AI เลือก
  แล้วอัปเดต `parseShopItems()` (ถ้า statId ไม่มีในschema → ทิ้งเอฟเฟกต์ ไม่ทิ้งสินค้า)
- `buyShopItem()` → ถ้า setting `shopToInventory` เปิด ให้เรียก `rpgAddItem()` ต่อท้าย (ยังหัก `bankDeduct` เหมือนเดิม)

### ฝั่ง TinyQuest
```js
rpg.inventory = [{ id, name, emoji, image, desc, qty, fx:{stat,amount}, src:"shop"|"manual"|"ai", ts }]
```
`rpgAddItem(item)` (มีชื่อซ้ำ → `qty++` ไม่สร้างใหม่) · `rpgRemoveItem(id,n)` · `rpgUseItem(id)` →
`rpgApplyDelta(fx.stat, "+"+fx.amount, "ใช้ "+name)` แล้ว `qty--` (0 = เอาออก) · `rpgItemEffectText(fx)`
(ก๊อปวิธีคิดจาก `petItemEffect`/`petApplyEffect`/`petEffectText` ที่มีอยู่)
**Guard:** `fx.stat` ที่ไม่มีใน schema ปัจจุบัน = ใช้ได้แต่ไม่มีผล + toast บอกเหตุผล (การ์ดคนละใบ schema คนละชุด)

**เงิน:** ใช้ TinyBank เดิม ไม่สร้างสกุลใหม่ — `bankCurrency` ผูกกับการ์ดอยู่แล้ว การ์ดแฟนตาซีตั้งเป็น "G" ได้เอง

### UI
แท็บ "กระเป๋า" — กริดไอเทม (emoji/รูป + ชื่อ + ×qty) → แตะ = ป๊อปรายละเอียด + ปุ่ม "ใช้" / "ทิ้ง" · ปุ่มเพิ่มไอเทมเอง ·
เติมบรรทัดไอเทมในบล็อก inject เดิม

### ⚠️ แท็บจะเยอะเกิน — รีแฟกเตอร์เล็กน้อยตอนเริ่มรอบ ③
รวมแล้วจะได้ 5 แท็บ (สถานะ/กระเป๋า/สมุด/เควส/ตั้งค่า) ซึ่งอัดไม่ลงที่กว้าง 320px →
**ย้าย "ตั้งค่าสเตตัส" ออกจากแถบแท็บ ไปเป็นไอคอนเฟืองมุมขวาของแท็บสถานะ** เหลือ 4 แท็บเนื้อหา
(หรือทำ `.tinyfeed-tabs` ให้ `overflow-x:auto` ถ้าผู้ใช้อยากได้แท็บครบ — ถามก่อนตัดสินใจ)

---

## ✅ สิ่งที่ทำในรอบ ③ (เสร็จแล้ว 2026-08-17 — อย่าทำซ้ำ)

ถามผู้ใช้เรื่องแท็บล้นแล้ว **เลือก "ย้ายตั้งค่าออกเป็นไอคอนเฟือง"** (ตัวเลือกแนะนำ) — เหลือ 3 แท็บเนื้อหา: สถานะ/กระเป๋า/สมุด

**โครงสร้างที่เปลี่ยน:**
- `rpgTab` เหลือ 3 ค่า: `"status" | "bag" | "npc"` (เอา `"schema"` ออกจาก tab enum)
- ตัวแปรใหม่ `rpgSchemaOpen` (boolean) — หน้าตั้งค่าสเตตัสกลายเป็นสกรีนเต็มจอแยก ไม่ใช่แท็บ เปิดผ่าน `openRpgSchema()`/`closeRpgSchema()` (โชว์/ซ่อน `#tinyfeed-back` แบบเดียวกับที่ `openVersePost()`/`closeVersePost()` ทำ) — ปุ่มเข้าคือไอคอนเฟือง `#tinyfeed-rpg-schema-gear` มุมขวาบนของแท็บสถานะ (โผล่ทั้งตอนมี/ไม่มีสเตตัสแล้ว — ตอนว่างมี `.tinyfeed-rpg-head-empty` ให้กดเข้าไปเลือก preset ได้)
- `APPS` entry "rpg" → `back()` เช็ค `rpgSchemaOpen` ก่อนเช็ค `rpgNpcView` เดิม

**ข้อมูล — เพิ่มใน `getRpg()` (per-chat, lazy-create เหมือนเดิม):**
```js
rpg.inventory = [{ id, name, emoji, image, desc, qty, fx:{stat,amount}, src:"shop"|"manual", ts }]
```
`fx.stat` ว่าง (`""`) = ไม่มีผล — ไม่ใช้ `null`/`undefined` กัน error ตอนเช็ค `it.fx.stat` ตรงๆ

**ฟังก์ชันใหม่ (ทั้งหมดอยู่ต่อจาก `rpgNpcApplyDelta` ใน `index.js`):**
`rpgAvailableStatIdsLine()` (รายชื่อ statId number/bar ของการ์ดนี้ ต่อ prompt ให้ AI เลือก) · `getRpgInventory()` ·
`rpgItemId()` · `rpgAddItem(item)` (ชื่อซ้ำไม่สนตัวพิมพ์ → บวก qty) · `rpgRemoveItem(id,n)` ·
`rpgUseItem(id)` (apply `fx` ผ่าน `rpgApplyDelta` ที่มีอยู่แล้ว แล้วลด qty — `rpgApplyDelta` คืน `false` เองถ้า statId ไม่มีในschema ปัจจุบัน ใช้ผลนั้นตัดสินใจ toast ไม่ต้องเช็ค `rpgStatDef` ซ้ำ) · `rpgItemEffectText(fx)`

**UI ใหม่:** `renderRpgBag()` + `rpgItemThumbHtml()` (กริด 3 คอลัมน์ รูป/อิโมจิ/ไอคอนกล่อง) · modal `#tinyfeed-rpg-item-modal`
(ป๊อปรายละเอียด + ปุ่มใช้/ทิ้ง) · modal `#tinyfeed-rpg-item-add-modal` (เพิ่มไอเทมเอง) — ทั้งสอง modal ลงทะเบียนใน `OVERLAYS` แล้ว

**ฝั่ง TinyShop ที่แตะ:**
- item เพิ่ม field `fx:{stat,amount}` — ฟอร์มเพิ่ม/แก้สินค้ามี `<select>` (เติมจาก `fillRpgStatSelect()`, เดิมชื่อ `fillShopFxStatSelect` เปลี่ยนชื่อให้เป็นกลางเพราะกระเป๋าก็ใช้ตัวเดียวกัน) + ช่องจำนวน (`rpgFxFromForm()`, เดิมชื่อ `shopFxFromForm`)
- `PROMPT_DEFS.shopItems` เพิ่ม token `{{stats}}` + format ต่อท้าย `| <statId หรือ -> | <จำนวนผล>` — `parseShopItems()` ทิ้งเอฟเฟกต์เงียบๆ ถ้า statId ไม่อยู่ใน schema ปัจจุบัน (ไม่ทิ้งสินค้า)
- `buyShopItem()` เรียก `rpgAddItem()` ถ้า setting `shopToInventory` (default `true`) เปิดอยู่ — ยังหัก `bankDeduct` เหมือนเดิมทุกอย่าง
- การ์ดสินค้าโชว์ป้าย `.tinyfeed-shop-fx-tag` ถ้ามีเอฟเฟกต์

**Inject:** เติมบรรทัด `ไอเทมในกระเป๋า: <ชื่อ>×<qty>, ...` ในบล็อก `if (want.rpg)` เดิม (ไม่ได้แยก sub-toggle ใหม่ ตามที่ระบุในสเปครอบ ③ เดิม)

**Verify แล้วใน ST จริงครบ:** ตั้งสเตตัสจาก preset → เพิ่มไอเทมเองพร้อม fx → ใช้ไอเทม → สเตตัสขึ้นจริง + qty ลดจนหาย + ประวัติบันทึกถูก → เพิ่มสินค้าใน TinyShop พร้อม fx → ซื้อ → เข้ากระเป๋าอัตโนมัติพร้อมป้าย "ซื้อจากร้าน" → ทิ้งไอเทมได้ → **reload หน้าเว็บยืนยันทุกอย่าง (`rpgValues`, `inventory`, `shop[].fx`) อยู่ครบ** · ปุ่มย้อนกลับจากหน้าตั้งค่าสเตตัสกลับแท็บสถานะถูกต้อง · แท็บสมุด (รอบ ②) ยังทำงานปกติหลังรีแฟกเตอร์ · ไม่มี console error ตลอดทุกขั้นตอน
**ยังไม่ได้ทดสอบ:** AI สร้างสินค้าจริงผ่าน "ให้ AI สร้างสินค้า" (ต้องมี API เชื่อมต่อจริง) — logic การ parse/guard ตรวจด้วยการอ่านโค้ดเท่านั้น ยังไม่เห็นผลลัพธ์จริงจาก AI

---

## รอบ ④ เควส + AI สแกนบท (ก้อนใหญ่สุด ทำท้ายสุด)

### เควส
```js
rpg.quests = [{ id, title, desc, kind:"main"|"side", status:"active"|"done"|"failed", reward, ts, doneTs }]
```
CRUD ธรรมดา + แท็บ "เควส" (กรองตามสถานะ) + เติมบรรทัดเควสที่ยัง active ในบล็อก inject

### AI สแกนบท — หัวใจของรอบนี้
**แม่แบบคือ `scanMemo()` + `parseMemoLines()` ใน `index.js`** (อ่านก่อนเขียน — โครง busy-flag/ปุ่มหมุน/
`crossAppContext`/นับผลลัพธ์/toast สรุป มีให้ก๊อปครบ)

`PROMPT_DEFS.rpgScan` (marker `STAT:`) — แนบรายการปัจจุบัน (statId ที่มี, ชื่อ NPC, เควสที่ค้างพร้อมหมายเลข, ไอเทม)
แล้วให้ตอบบรรทัดละรายการ:
```
STAT: <statId> | <+5 | -3 | =42>
AFFECT: <ชื่อ NPC> | <+3> | <เหตุผลสั้นๆ>
NPCINFO: <ชื่อ NPC> | <fieldId> | <ค่า>        ← ปลดล็อกช่อง ??? ที่รู้จากในบท
ITEM+: <ชื่อ> | <จำนวน>      ITEM-: <ชื่อ> | <จำนวน>
QUEST+: <ชื่อ> | <รายละเอียด>   QUESTDONE: <หมายเลข>   QUESTFAIL: <หมายเลข>
```
`parseRpgScanLines(raw)` → `{stats,affects,npcInfos,itemAdds,itemRemoves,questAdds,questDones,questFails}`
(loop ทีละบรรทัดแบบ `parseMemoLines` ไม่ใช่ regex ก้อนเดียว)

**🔴 ขั้น "ตรวจก่อนใช้" = ข้อกำหนดหลัก ห้ามข้าม** — โมเดลมั่วตัวเลขแล้วสะสมผิดไปเรื่อยๆ
เก็บผลลง `rpgPending` แล้วเปิด modal `#tinyfeed-rpg-review-modal` โชว์ทีละรายการพร้อม checkbox +
ปุ่ม "รับที่เลือก"/"ปฏิเสธทั้งหมด" (ก๊อป flow `rpgProposed`/`renderRpgProposalsHtml`/`rpgAcceptProposals` จากรอบ ①)
· setting `rpgScanAutoApply` สำหรับคนที่เชื่อใจ AI · modal ใหม่ **ต้องลงทะเบียนใน array `OVERLAYS`** (พร้อมฟังก์ชันปิด)

**Guard ตอน apply:** `STAT` ที่ statId ไม่มีจริง → ข้าม · `AFFECT` ของ NPC ที่ยังไม่มีในสมุด → สร้างให้ (เจอตัวใหม่จากบทเป็นเรื่องดี)
แต่ **ติดป้าย "ใหม่" ในการ์ดรีวิว** · `QUESTDONE/FAIL` อ้างด้วยหมายเลขจากลิสต์ที่ส่งไป (แบบเดียวกับ `DONE:` ของ memo)

### Auto-trigger
- เพิ่ม entry ที่ 6 ใน array `apps[]` ของ `onChatMessage()`:
  `{on:"rpgAutoScan", mode:"rpgAutoMode", interval:"rpgAutoInterval", defInt:15, kw:"rpg",
    bump/get/reset: autoRpgCount, decide: aiDecidesRpg, run: () => rpgScan({notify:true,silent:true})}`
  (`aiDecidesRpg` ก๊อป `aiDecidesMemo`) + รีเซ็ต `autoRpgCount` ใน `CHAT_CHANGED`
- คีย์เวิร์ด: เพิ่ม `rpg` เข้า `KEYWORD_DEFS`, `KEYWORD_SETTING`, `kwCooldownAt` + default setting `rpgKeywords`
- แจ้งเตือน: `showNotif(avatar, "TinyQuest", สรุป, "rpg", "rpg")` + เพิ่ม branch `app === "rpg"` ใน `routeFromNotif()`
- ถ้ารีวิวเปิดอยู่แต่ปิดโทรศัพท์ → เก็บ `rpgPending` ค้างไว้ + แจ้งเตือน อย่า apply เงียบ อย่าทิ้งเงียบ

---

## กติกาของโปรเจกต์ที่ต้องรู้ (เจ็บมาแล้ว)

1. **CSS harness:** `<link href="./style.css">` **ไม่โหลด** ในโหมด snapshot ของ preview ในเครื่องนี้ (getComputedStyle
   คืนค่า default) → ต้อง **inline เนื้อ style.css ใส่ `<style>`** ในไฟล์เทสก่อน แล้วค่อยวัด · ทำ `_test.html` **ใน** `tinyfeed/`
   ห่อด้วย `<div id="tinyfeed-phone" class="tinyfeed-theme-dark">` · **ลบทิ้งหลังวัดเสร็จ** · screenshot หน้า `file:` ว่างเปล่า เชื่อไม่ได้ ใช้ตัวเลขวัดเท่านั้น
2. **ธีม:** ตัวแปร `--tf-*` ประกาศไว้ 3 จุดใน `style.css` (base tokens / theme-dark / theme-light) โดย scope กับ
   `#tinyfeed-phone` (+ `.tinyfeed-notif`, `#tinyfeed-hud`) — element ใหม่ที่อยู่ **นอก** กรอบโทรศัพท์ต้องเติมทั้ง 3 จุด
   และ sync คลาสธีมใน `applyTheme()`/`applyAppearance()` ด้วย
3. **แท็บ:** ใช้ `.tinyfeed-tabs`/`.tinyfeed-tab`/`.tinyfeed-tab-active` ร่วมได้เลย (`openSettings` ซ่อนเฉพาะ
   `#tinyfeed-app-feed .tinyfeed-tabs`) — ใช้ `data-*tab` ของตัวเองเป็นตัวแยก
4. **modal ใหม่** ต้องใส่ใน array `OVERLAYS` ไม่งั้นปุ่มย้อนกลับ/สลับแอปจะไม่ปิดให้
5. **เซฟ:** per-chat → `saveFeedDataDebounced()` · global → `saveSettingsDebounced()` · getter ทุกตัวใช้แพตเทิร์น
   lazy-create + ensure shape (ดู `getRpg()`) เพื่อไม่พังกับแชท/การ์ดเก่า
6. **escape ทุกอย่างที่มาจากผู้ใช้/AI** ด้วย `escapeText`/`escapeAttr` ตอนประกอบ HTML
7. settings group ใหม่ → markup `data-group` ใน `phone.html` **ต้องคู่กับ** entry ใน `SETTINGS_LAYOUT` (มี console.error เช็คให้)
8. ผู้ใช้สื่อสารภาษาไทย ตอบไทย · ทำทีละรอบให้เสร็จจริง + บอกตรงๆ ว่าอะไรยังต้องเทสใน ST เอง

---

## การตรวจสอบ (ทำทุกรอบก่อนส่งงาน)

1. `node --check` ทั้ง `index.js` + `src/store.js` + `src/util.js` + `src/components.js`
2. **Node script เช็คทะเบียนตรงกัน:** `SETTINGS_LAYOUT` ↔ `data-group` ใน `phone.html` · `APPS` ↔ panel id ใน `phone.html` ·
   ฟังก์ชัน `rpg*` ที่ถูกเรียก ↔ ที่ประกาศจริง (สคริปต์รอบ ① ใช้ regex `/function\s+(\w+)\s*\(/` เทียบกับจุดเรียก — ใช้ซ้ำได้)
3. **Pure-logic unit test** ใน scratchpad (ก๊อปฟังก์ชันล้วนออกมารัน อย่า import ตัวจริง — มันต้องใช้ jQuery/ST):
   - รอบ ②: normalize npcKey, clamp affection 0–100, `rpgStageFor` ทุกช่วง (รวมขอบ 0/20/45/70/90/100), `rpgHearts`,
     dedupe `rpgNpcList` (ชื่อซ้ำต่างตัวพิมพ์), `rpgActiveNpcFields` เมื่อซ่อน/เพิ่มช่อง, ระบบ `known` (`???` vs ค่าจริง)
   - รอบ ③: merge qty ตอนซื้อซ้ำ, `rpgUseItem` ลด qty/ลบที่ 0, `fx.stat` ที่ไม่มีใน schema = ไม่พัง, parse สินค้าที่ AI ใส่ statId มั่ว
   - รอบ ④: `parseRpgScanLines` ทุกชนิดบรรทัด + บรรทัดขยะ + ฟิลด์ขาด + หมายเลขเควสเกินขอบ + apply แล้ว clamp ถูก
4. **CSS harness** (ตามข้อ 1 ของกติกา): ทุกหน้าจอใหม่ต้อง `scrollWidth === clientWidth` ที่กว้าง **320px**
5. **บอกผู้ใช้ตรงๆ ว่าต้องเทสใน ST จริงเอง:** การเจนของ AI ทุกจุด, persist ข้ามการรีโหลด, สลับแชท/สลับการ์ดแล้วข้อมูลถูกชุด,
   auto-trigger ยิงจริงตอน RP, แจ้งเตือน/รีวิวตอนปิดโทรศัพท์

---

## ✅ สิ่งที่ทำในรอบ ④ (เสร็จแล้ว 2026-08-17 — อย่าทำซ้ำ)

ทำตามสเปคเดิมของไฟล์นี้เกือบทั้งหมด มีจุดที่ตัดสินใจต่างจากสเปคเล็กน้อยเพื่อความง่าย/เชื่อถือได้ — บันทึกไว้ให้รู้เหตุผล:

**เควส**: `getRpgQuests()`/`rpgAddQuest()`/`rpgSetQuestStatus()`/`rpgDeleteQuest()` ตรงสเปค 100% — `rpg.quests[]` เพิ่มใน `getRpg()` (lazy-create) แท็บ "เควส" (4 แท็บแล้ว: สถานะ/กระเป๋า/สมุด/เควส) filter ด้วย chip กำลังทำ/สำเร็จ/ล้มเหลว/ทั้งหมด (module var `rpgQuestFilter`) เติมบรรทัดเควส active เข้าบล็อก inject เดิม

**AI สแกนบท**: `PROMPT_DEFS.rpgScan` (marker `STAT:`, token `stats/npcs/fields/items/quests/extra/context`) → `parseRpgScanLines(raw)` loop ทีละบรรทัดตรงสเปค → `rpgBuildPending(parsed, activeQuestsSnapshot)` เป็นจุดที่ต่างจากสเปคนิดหน่อย: **แปลงผล parse ดิบเป็นรายการรีวิวที่ validate/resolve เสร็จสรรพทันทีหลัง parse** (ไม่ใช่ตอน apply) เพราะ:
- guard ทุกจุดทำตอนนี้ทีเดียว: statId ไม่มีจริง / fieldLabel ไม่ตรงของจริง (match ด้วย label ไม่ใช่ raw fieldId เพราะ AI ตอบเป็นชื่อช่องภาษาไทยที่มนุษย์อ่านได้ ไม่รู้จัก format `extra:xxx` ภายใน) / ไอเทมไม่มีอยู่จริง / เควสเลขเกินขอบ → ทุกอย่างที่เข้า `rpgPending` การันตีว่า apply ได้จริงไม่พังกลางทาง
- `rpgPending = [{key,type,label,meta,isNew}]` — `isNew` เช็คจาก `rpgNpcList()` ตอน build (NPC ที่ยังไม่มีในสมุด = สร้างให้ได้แต่ติดป้าย "ใหม่")

**modal รีวิว**: `#tinyfeed-rpg-review-modal` (ลงทะเบียน OVERLAYS แล้ว) ก๊อปโครง `rpgProposed` จากรอบ① จริงๆ (checkbox ต่อรายการ + "รับที่เลือก"/"ปฏิเสธทั้งหมด") — `rpgAcceptPending(keys)` / `rpgDiscardPending()` / `rpgApplyPendingItem(item)` (switch ตาม type)

**setting `rpgScanAutoApply`**: ถ้าเปิด → `rpgScan()` apply ทุกรายการทันทีไม่เปิด modal (ยังคง build ผ่าน guard เดิมทุกจุด แค่ข้ามขั้นติ๊กเลือก)

**🔴 "ค้างได้ข้ามเปิด/ปิดโทรศัพท์"**: `rpgPending` เป็น module var ธรรมดา ไม่ reset เวลาเปิด/ปิดแอป — ถ้า auto-scan ยิงตอนไม่ได้อยู่แอป TinyQuest จะไม่เปิด modal ทันที (กันเด้งรบกวน) แต่จะโชว์ **แบนเนอร์เตือนสีเหลืองที่หัวแท็บสถานะ** (`renderRpgStatus()`) + `showNotif(...,"rpg","rpg")` — แตะแบนเนอร์หรือแจ้งเตือนแล้วพาไปเปิด modal ตรงๆ (`routeFromNotif` เพิ่ม branch `e.app === "rpg"`)
**เพิ่มเติมนอกสเปค (พบบั๊กระหว่างทำแล้วแก้เลย)**: `rpgPending` ที่ค้างอยู่อ้างอิง NPC/เควส/ไอเทมของ**แชทเดิม** — ถ้าสลับแชทระหว่างที่ยังไม่ได้รีวิว ผลสแกนจะ apply ผิดที่ทันทีที่กด "รับที่เลือก" เพราะ meta เก็บ id ของแชทเก่า → เพิ่ม `rpgPending = []` + `closeRpgReviewModal()` ใน `CHAT_CHANGED` handler (ทิ้งเงียบๆ ตอนสลับแชทเท่านั้น ไม่ใช่ตอนปิดโทรศัพท์ — งานที่ยังทำอยู่ในแชทเดิมยังปลอดภัย)

**auto-trigger**: `apps[]` ของ `onChatMessage()` เพิ่ม entry ที่ 6 ตรงสเปคเป๊ะ (`on:"rpgAutoScan"`) · `aiDecidesRpg()` ก๊อป `aiDecidesMemo` · `autoRpgCount` + reset ใน `CHAT_CHANGED` · `KEYWORD_DEFS`/`KEYWORD_SETTING`/`kwCooldownAt` เพิ่ม `rpg` ครบ

**Setting ใหม่ทั้งหมด** (ใน `defaultSettings`): `rpgAutoScan`(false) `rpgAutoMode`("interval") `rpgAutoInterval`(15) `rpgScanTokens`(400 — แยกจาก `rpgTokens` เดิมที่ใช้ตอนเสนอสเตตัสครั้งแรก) `rpgScanExtraPrompt`("") `rpgScanAutoApply`(false) `rpgKeywords`("") — settings group `data-group="rpg"` เดิมขยายเพิ่มฟิลด์ครบ ไม่ต้องสร้างกลุ่มใหม่

**Verify แล้วใน ST จริงด้วย AI ตัวจริง (ไม่ใช่ mock)**: กดปุ่มแว่นขยายสแกนบท → AI ตอบจริง → parse ถูก 2 รายการ (AFFECT + NPCINFO) → modal รีวิวเปิดอัตโนมัติพร้อม checkbox → กด "รับที่เลือก" → affection ขึ้นจริง (+5, มี event log) + field "บทบาท/อาชีพ" ถูกเปิดเผยจริง (ยิง toast "ปลดล็อกข้อมูลใหม่" ของรอบ② ด้วย ยืนยันว่าเชื่อมกับของเดิมถูก) → **reload หน้าเว็บยืนยันทั้งหมดอยู่ครบ** · เพิ่ม/เปลี่ยนสถานะ/ลบเควสด้วยมือทำงานถูก + filter chip ถูก · หน้าตั้งค่าเรนเดอร์/เซฟค่าใหม่ทุกช่องถูก (ทดสอบ toggle auto-scan) · `KEYWORD_DEFS` โชว์ TinyQuest ในหน้าคีย์เวิร์ดถูก · regression 13 แอปผ่านหมด ไม่มี console error ตลอดทุกขั้นตอน
**ยังไม่ได้ทดสอบ**: โหมด auto-trigger จริง (ต้องรอให้ RP เดินหลายข้อความ), โหมด keyword trigger, `rpgScanAutoApply` เปิดจริง, กรณี `rpgPending` ค้างข้ามการสลับแชทจริง (แก้โค้ดแล้วแต่ไม่ได้จำลองสถานการณ์สลับแชทกลางที่มี pending ค้าง)

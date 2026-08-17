# TinyQuest (แอปที่ 13 ใน TinyPhone) — แผนรอบ ②–④ สำหรับ agent คนถัดไป

## Context

ผู้ใช้ต้องการระบบโรลเพลย์แนว RPG ใน extension `tinyfeed/` ที่เก็บ **สเตตัสผู้เล่น · ไอเทม · ข้อมูล NPC · ค่าความสัมพันธ์**
แรงบันดาลใจจาก **โทคิเมคิเมโมเรียล Girl's Side / เกมจีบหนุ่ม** (มีหน้าสถานะตัวเอง + สมุดรายชื่อที่ดูวันเกิด/ของที่ชอบ/
ค่าความชอบของแต่ละตัวได้) บวกความยืดหยุ่นให้ **ตั้งชุดสเตตัสเองได้** เพราะการ์ด RPG แต่ละใบใช้ค่าไม่เหมือนกัน

**ตัดสินใจไปแล้ว (ห้ามรื้อ):** รวมเป็นแอปที่ 13 ใน `tinyfeed/` ไม่แยก extension · หน้าตา 3 ชั้น (แอปเต็ม + HUD หน้าแชท ST +
วิดเจ็ตโฮม) · **schema ผูกกับการ์ด / ค่าที่เล่นจริงผูกกับแชท** · ลำดับ ①สเตตัส → ②สมุด NPC → ③กระเป๋า → ④เควส

> **รอบ ① เสร็จแล้ว (2026-08-17) — อย่าทำซ้ำ** ดูหัวข้อถัดไปว่ามีอะไรให้ใช้ต่อบ้าง
> เอกสารอ้างอิงเชิงลึกอยู่ใน memory `tinyquest-app` · ภาพรวมโปรเจกต์อยู่ใน `tinyphone-status` + `tinyphone-extension`

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

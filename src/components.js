/* ===== components: ชิ้นส่วน UI ที่ใช้ร่วมทุกแอป =====
 * ใช้ตัวในนี้ ห้ามเขียน markup เอง — ดู CONVENTIONS.md บทที่ 4.1 / 4.2 / 4.7 */

/* แถบพิมพ์กลาง — โครง [ไอคอนนำหน้า…][ช่องพิมพ์ + สติกเกอร์][ปุ่มส่ง]
 * ใช้ 5 ที่: TinyConnect · TinyStream ผู้ชม/สตรีมเมอร์ · TinyForum · คอมเมนต์ TinyFeed
 * คืน "เนื้อใน" ของแถบ (ไม่รวม container) เพื่อให้ผู้เรียกคุมคลาส/สถานะซ่อนของ container เอง
 *
 *   lead     [{id?, cls?, icon, title}]  ไอคอนหน้าแถบ (0–2 อัน)
 *   before   HTML ดิบวางหน้าสุด (เช่น avatar)
 *   field    {id?, cls?, multiline?, placeholder}  ช่องพิมพ์
 *   sticker  {id?, cls?, title?}  ปุ่มสติกเกอร์ในช่อง (ละได้ = ไม่มี)
 *   send     {id?, cls?, icon?, title?}
 *   data     {post:"p1"} → data-post="p1" ใส่ให้ทุกปุ่ม + ช่องพิมพ์
 *   after    HTML ดิบต่อท้าย (เช่น เมนู + ของ TinyConnect)
 */
export function composeBarHtml(o) {
    const d = Object.entries(o.data || {})
        .map(([k, v]) => ` data-${k}="${String(v).replace(/"/g, "&quot;")}"`).join("");
    const at = (x, extraCls = "") => {
        const cls = [extraCls, x.cls].filter(Boolean).join(" ");
        return `${x.id ? ` id="${x.id}"` : ""}${cls ? ` class="${cls}"` : ""}${d}`;
    };
    const lead = (o.lead || []).map((b) =>
        `<span${at(b, "tinyfeed-compose-sticker")} title="${b.title || ""}"><i class="${b.icon}"></i></span>`).join("");
    const f = o.field;
    const field = f.multiline
        ? `<textarea${at(f)} rows="1" placeholder="${f.placeholder || ""}"></textarea>`
        : `<input${at(f)} type="text" placeholder="${f.placeholder || ""}" />`;
    const sticker = o.sticker
        ? `<span${at(o.sticker, "tinyfeed-compose-inbtn")} title="${o.sticker.title || "ส่งสติกเกอร์"}"><i class="fa-regular fa-face-smile"></i></span>`
        : "";
    const s = o.send || {};
    const send = `<span${at(s)} title="${s.title || "ส่ง"}"><i class="${s.icon || "fa-solid fa-paper-plane"}"></i></span>`;
    return `${o.before || ""}${lead}<div class="tinyfeed-inputwrap">${field}${sticker}</div>${send}${o.after || ""}`;
}

export function emptyStateHtml(icon, title, sub) {
    return `<div class="tinyfeed-empty">
        <i class="fa-solid ${icon}"></i>
        <div class="tinyfeed-empty-title">${title}</div>
        <div class="tinyfeed-empty-sub">${sub}</div>
    </div>`;
}

export function emptyInlineHtml(html) {
    return `<div class="tinyfeed-empty-inline">${html}</div>`;
}

/* ปุ่มอัปโหลดรูปจากเครื่อง — ใช้คู่กับ <input> ที่รับลิงก์รูป (URL) เสมอ
 * วางไว้ใน .tinyfeed-uploadrow เดียวกับ <input> ที่ต้องการ (ไม่ว่า input จะเป็น id คงที่หรือแถวที่ JS สร้างใหม่)
 * handler กลาง (ดู index.js "อัปโหลดรูปจากเครื่อง") จะหา input ด้วย
 *   $(this).closest(".tinyfeed-uploadrow").find("input").first()
 * kind = ตัวคุมขนาด/คุณภาพที่ย่อ ดู IMG_KINDS ใน src/util.js (image/sticker/avatar/wallpaper/sprite/thumb) */
export function uploadBtnHtml(kind) {
    return `<span class="tinyfeed-upload-btn" data-kind="${kind}" title="อัปโหลดรูปจากเครื่อง"><i class="fa-solid fa-upload"></i></span>`;
}

export function skeletonCardHtml() {
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

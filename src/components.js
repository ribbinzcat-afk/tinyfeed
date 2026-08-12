/* ===== components: ชิ้นส่วน UI ที่ใช้ร่วมทุกแอป =====
 * ใช้ตัวในนี้ ห้ามเขียน markup เอง — ดู CONVENTIONS.md บทที่ 4.1 / 4.2 */

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

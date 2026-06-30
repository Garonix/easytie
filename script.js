(function(){
'use strict';

// ===== Marked setup =====
marked.use({
    breaks: true,
    gfm: true,
    renderer: {
        code: function(token) {
            var text = token.text || '';
            var lang = token.lang || '';
            if (lang && hljs.getLanguage(lang)) {
                try { return '<pre><code class="hljs language-' + lang + '">' + hljs.highlight(text, { language: lang }).value + '</code></pre>'; } catch(e) {}
            }
            try { return '<pre><code class="hljs">' + hljs.highlightAuto(text).value + '</code></pre>'; } catch(e) {}
            return '<pre><code>' + text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</code></pre>';
        }
    }
});

// ===== DOM refs =====
const $ = id => document.getElementById(id);
const lockScreen = $('lockScreen'), lockCard = $('lockCard'), lockPasswordInput = $('lockPasswordInput'),
      lockUnlockBtn = $('lockUnlockBtn'), lockError = $('lockError');
const syncBtn = $('syncBtn'), settingsBtn = $('settingsBtn');
const editorSection = $('editorSection'), editingBadge = $('editingBadge'), editingCancelBtn = $('editingCancelBtn');
const contentInput = $('contentInput'), previewPane = $('previewPane');
const charCount = $('charCount'), readingTime = $('readingTime');
const saveBtn = $('saveBtn'), attachBtn = $('attachBtn'), fullscreenBtn = $('fullscreenBtn');
const inputArea = $('inputArea'), dropOverlay = $('dropOverlay'), inputImagesPreview = $('inputImagesPreview');
const historyList = $('historyList'), historyCount = $('historyCount');
const searchInput = $('searchInput');
const exportBtn = $('exportBtn'), clearAllBtn = $('clearAllBtn');
const importBtn = $('importBtn'), importFileInput = $('importFileInput');
const trashBtn = $('trashBtn');
const themeBtn = $('themeBtn'), themeIcon = $('themeIcon');
const trashModal = $('trashModal'), trashList = $('trashList'), trashEmpty = $('trashEmpty'),
      closeTrashBtn = $('closeTrashBtn'), closeTrashBtn2 = $('closeTrashBtn2'), emptyTrashBtn = $('emptyTrashBtn');
const filterBtn = $('filterBtn'), filterLabel = $('filterLabel'), filterDropdown = $('filterDropdown'), filterWrap = $('filterWrap');
const settingsModal = $('settingsModal'), closeSettingsBtn = $('closeSettingsBtn'),
      cancelSettingsBtn = $('cancelSettingsBtn'), saveSettingsBtn = $('saveSettingsBtn');
const confirmOverlay = $('confirmOverlay'), confirmText = $('confirmText'),
      confirmOkBtn = $('confirmOkBtn'), confirmCancelBtn = $('confirmCancelBtn');
const lightbox = $('lightbox'), lightboxImg = $('lightboxImg');
const contextMenu = $('contextMenu');
const toastContainer = $('toastContainer');
const backToTop = $('backToTop');
const pagination = $('pagination'), pageNav = $('pageNav');

// ===== State =====
let notes = JSON.parse(localStorage.getItem('jian_notes') || '[]');
let editingId = null;
let pendingImages = [];
let settings = JSON.parse(localStorage.getItem('jian_settings') || '{"syncEnabled":false,"githubToken":"","repoName":"","password":""}');
let currentModeFilter = 'all';
let currentPage = 1;
const PAGE_SIZE = 5;
const MAX_NOTES = 50;
const MAX_COMMITS = 20;
let syncTimer = null;
let syncing = false;

// ===== IndexedDB Image Cache =====
const IMG_DB_NAME = 'jian_images';
const IMG_STORE = 'images';
let imgDb = null;

function openImgDb() {
    return new Promise(function(resolve, reject) {
        var req = indexedDB.open(IMG_DB_NAME, 1);
        req.onupgradeneeded = function(e) {
            var db = e.target.result;
            if (!db.objectStoreNames.contains(IMG_STORE)) db.createObjectStore(IMG_STORE);
        };
        req.onsuccess = function(e) { imgDb = e.target.result; resolve(imgDb); };
        req.onerror = function() { reject(req.error); };
    });
}

function idbOp(mode, fn) {
    return new Promise(function(resolve, reject) {
        if (!imgDb) return resolve(null);
        var tx = imgDb.transaction(IMG_STORE, mode);
        var result = fn(tx.objectStore(IMG_STORE));
        result.onsuccess = function() { resolve(result.result !== undefined ? result.result : null); };
        result.onerror = function() { reject(result.error); };
    });
}

function imgCacheGet(key) { return idbOp('readonly', function(s) { return s.get(key); }); }
function imgCachePut(key, val) { return idbOp('readwrite', function(s) { return s.put(val, key); }); }
function imgCacheDelete(key) { return idbOp('readwrite', function(s) { return s.delete(key); }); }
function imgCacheClear() { return idbOp('readwrite', function(s) { return s.clear(); }); }

// ===== Image helpers =====
// Resolve image filename to displayable src (from IndexedDB cache)
function resolveImageSrc(filename) {
    // If it's already a data URL (legacy), return as-is
    if (filename.startsWith('data:')) return Promise.resolve(filename);
    // Check IndexedDB cache
    return imgCacheGet(filename).then(function(cached) {
        if (cached) return cached;
        // Fallback: repo raw URL
        if (isRepoConfigured()) {
            var rawBase = 'https://raw.githubusercontent.com/' + settings.repoName + '/main/data/images/';
            return rawBase + filename;
        }
        return '';
    });
}

// ===== Utils =====
let _uidCounter = 0;
function uid() { return Date.now().toString(36) + (++_uidCounter).toString(36) + Math.random().toString(36).slice(2, 6); }

function toast(msg, type) {
    const t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    t.textContent = msg;
    toastContainer.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2500);
}

function save() {
    localStorage.setItem('jian_notes', JSON.stringify(notes));
    localStorage.setItem('jian_settings', JSON.stringify(settings));
}

function fmtTime(ts) {
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function renderMd(text) {
    try {
        var raw = marked.parse(text || '');
        return typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(raw) : raw;
    } catch(e) { return '<p>' + escHtml(text) + '</p>'; }
}

// ===== Shared: HTML → Markdown converter =====
function htmlToMarkdown(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    let result = '';
    function walk(node) {
        if (node.nodeType === 3) { result += node.textContent; return; }
        if (node.nodeType !== 1) return;
        const tag = node.tagName.toLowerCase();
        if (tag === 'img') {
            const src = node.getAttribute('src') || '';
            const alt = node.getAttribute('alt') || '';
            if (src) result += '![' + alt + '](' + src + ')';
        } else if (tag === 'br') { result += '\n'; }
        else if (/^h[1-6]$/.test(tag)) {
            result += '\n' + '#'.repeat(parseInt(tag[1])) + ' ';
            node.childNodes.forEach(walk); result += '\n';
        } else if (tag === 'p' || tag === 'div' || tag === 'blockquote' || tag === 'li') {
            node.childNodes.forEach(walk); result += '\n';
        } else if (tag === 'strong' || tag === 'b') {
            result += '**'; node.childNodes.forEach(walk); result += '**';
        } else if (tag === 'em' || tag === 'i') {
            result += '*'; node.childNodes.forEach(walk); result += '*';
        } else if (tag === 'code') { result += '`' + node.textContent + '`'; }
        else if (tag === 'pre') { result += '\n```\n' + node.textContent + '\n```\n'; }
        else if (tag === 'a') {
            const href = node.getAttribute('href') || '';
            const prev = result; result = '';
            node.childNodes.forEach(walk);
            const inner = result; result = prev;
            result += '[' + inner + '](' + href + ')';
        } else if (tag === 'hr') { result += '\n---\n'; }
        else { node.childNodes.forEach(walk); }
    }
    tmp.childNodes.forEach(walk);
    return result.replace(/\n{3,}/g, '\n\n').trim();
}

function showConfirm(text) {
    return new Promise(resolve => {
        confirmText.textContent = text;
        confirmOverlay.classList.remove('hidden');
        function cleanup(result) {
            confirmOverlay.classList.add('hidden');
            confirmOkBtn.removeEventListener('click', onOk);
            confirmCancelBtn.removeEventListener('click', onCancel);
            confirmOverlay.removeEventListener('click', onOverlay);
            resolve(result);
        }
        function onOk() { cleanup(true); }
        function onCancel() { cleanup(false); }
        function onOverlay(e) { if (e.target === confirmOverlay) onCancel(); }
        confirmOkBtn.addEventListener('click', onOk);
        confirmCancelBtn.addEventListener('click', onCancel);
        confirmOverlay.addEventListener('click', onOverlay);
    });
}

function calcReadingTime(text) {
    if (!text) return 0;
    const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const words = text.replace(/[\u4e00-\u9fff]/g, '').trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil((cjk + words * 0.5) / 300));
}

// ===== Lock =====
function isRepoConfigured() {
    return !!(settings.syncEnabled && settings.githubToken && settings.repoName);
}

function initLock() {
    if (isRepoConfigured() && settings.password) {
        // Skip lock screen if already unlocked in this session
        if (localStorage.getItem('jian_unlocked') === '1') {
            lockScreen.classList.add('hidden');
        } else {
            lockScreen.classList.remove('hidden');
            lockPasswordInput.focus();
        }
    } else {
        lockScreen.classList.add('hidden');
    }
}

async function hashPassword(pwd) {
    const data = new TextEncoder().encode('jian:' + pwd);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function tryUnlock() {
    const input = lockPasswordInput.value;
    const inputHash = await hashPassword(input);
    // Support legacy plaintext passwords: auto-migrate to hash
    if (inputHash === settings.password || input === settings.password) {
        if (input === settings.password && settings.password.length !== 64) {
            settings.password = inputHash;
            save();
        }
        lockScreen.classList.add('unlocked');
        localStorage.setItem('jian_unlocked', '1');
    } else {
        lockError.classList.add('visible');
        lockCard.classList.add('shake');
        lockPasswordInput.value = '';
        lockPasswordInput.focus();
        setTimeout(() => lockCard.classList.remove('shake'), 500);
    }
}

lockUnlockBtn.addEventListener('click', tryUnlock);
lockPasswordInput.addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); lockError.classList.remove('visible'); });

// ===== Editor Tabs =====
document.querySelectorAll('.ep-tab').forEach(tab => {
    tab.addEventListener('click', function() {
        document.querySelectorAll('.ep-tab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        const pane = this.dataset.pane;
        if (pane === 'preview') {
            previewPane.innerHTML = renderMd(contentInput.value);
            previewPane.classList.add('visible');
            inputArea.style.display = 'none';
            inputImagesPreview.classList.add('hidden');
        } else {
            previewPane.classList.remove('visible');
            inputArea.style.display = '';
            if (pendingImages.length) inputImagesPreview.classList.remove('hidden');
            contentInput.focus();
        }
    });
});

// ===== Toolbar =====
document.querySelectorAll('.md-btn[data-action]').forEach(btn => {
    btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const ta = contentInput;
        ta.focus();
        const s = ta.selectionStart, en = ta.selectionEnd, sel = ta.value.substring(s, en);
        const action = this.dataset.action;
        const map = {
            h1: ['# ', ''],
            h2: ['## ', ''],
            h3: ['### ', ''],
            bold: ['**', '**'],
            italic: ['*', '*'],
            strikethrough: ['~~', '~~'],
            quote: ['> ', ''],
            code: ['`', '`'],
            codeblock: ['```', '\n\n```'],
            ul: ['- ', ''],
            ol: ['1. ', ''],
            task: ['- [ ] ', ''],
            link: ['[', '](url)'],
            image: ['![', '](url)'],
            table: ['| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| ', ' |  |  |'],
            hr: ['\n---\n', '']
        };
        const [pre, post] = map[action] || ['', ''];
        ta.value = ta.value.substring(0, s) + pre + sel + post + ta.value.substring(en);
        const newPos = s + pre.length + sel.length;
        ta.setSelectionRange(sel ? newPos : s + pre.length, newPos);
        ta.dispatchEvent(new Event('input'));
    });
});

// ===== Mobile toolbar categories =====
document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        const cat = this.dataset.cat;
        const isActive = this.classList.contains('active');
        document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tool-group').forEach(g => g.classList.remove('active'));
        if (!isActive) {
            this.classList.add('active');
            const tg = document.querySelector('.tool-group[data-tg="' + cat + '"]');
            if (tg) tg.classList.add('active');
        }
    });
});

// ===== Char count / reading time =====
contentInput.addEventListener('input', function() {
    const len = this.value.length;
    charCount.textContent = len + ' 字符';
    if (len > 50) {
        readingTime.textContent = '约 ' + calcReadingTime(this.value) + ' 分钟';
        readingTime.classList.remove('hidden');
    } else {
        readingTime.classList.add('hidden');
    }
});

// ===== Save note =====
function processPendingImages(noteId, startIdx) {
    var filenames = [];
    var promises = pendingImages.map(function(dataUrl, i) {
        var m = dataUrl.match(/data:image\/(\w+)/);
        var ext = m ? m[1].replace('jpeg', 'jpg') : 'png';
        var filename = noteId + '-' + (startIdx + i) + '.' + ext;
        filenames.push(filename);
        return imgCachePut(filename, dataUrl);
    });
    return Promise.all(promises).then(function() { return filenames; });
}

function doSave() {
    const text = contentInput.value.trim();
    if (!text && pendingImages.length === 0) { toast('请输入内容', 'error'); return; }

    if (editingId) {
        const idx = notes.findIndex(n => n.id === editingId);
        if (idx >= 0) {
            var note = notes[idx];
            var startIdx = (note.images || []).length;
            processPendingImages(note.id, startIdx).then(function(filenames) {
                note.content = text;
                note.images = [...(note.images || []), ...filenames];
                note.updatedAt = Date.now();
                finishSave();
            });
            return;
        }
    }

    // Enforce max notes limit — remove oldest unpinned note first
    if (notes.length >= MAX_NOTES) {
        let removeIdx = -1;
        for (let i = notes.length - 1; i >= 0; i--) {
            if (!notes[i].pinned) { removeIdx = i; break; }
        }
        if (removeIdx === -1) removeIdx = notes.length - 1;
        notes.splice(removeIdx, 1);
    }
    var noteId = uid();
    processPendingImages(noteId, 0).then(function(filenames) {
        notes.unshift({
            id: noteId,
            content: text,
            images: filenames,
            pinned: false,
            createdAt: Date.now(),
            updatedAt: Date.now()
        });
        finishSave();
    });
}

function finishSave() {
    contentInput.value = '';
    pendingImages = [];
    inputImagesPreview.innerHTML = '';
    inputImagesPreview.classList.add('hidden');
    charCount.textContent = '0 字符';
    readingTime.classList.add('hidden');
    save();
    currentPage = 1;
    renderHistory();
    toast('保存成功', 'success');
    autoSync();
}

saveBtn.addEventListener('click', doSave);

contentInput.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doSave(); }
});

// ===== Editing badge =====
editingCancelBtn.addEventListener('click', function() {
    editingId = null;
    contentInput.value = '';
    pendingImages = [];
    inputImagesPreview.innerHTML = '';
    inputImagesPreview.classList.add('hidden');
    editingBadge.classList.remove('visible');
    charCount.textContent = '0 字符';
    readingTime.classList.add('hidden');
});

// ===== History render =====
function getNoteMode(note) {
    const hasText = !!(note.content && note.content.trim());
    const hasImages = !!(note.images && note.images.length);
    if (hasText && hasImages) return 'mixed';
    if (hasImages) return 'image';
    return 'text';
}

function getFilteredList() {
    const q = (searchInput.value || '').trim().toLowerCase();
    let list = notes.filter(n => !n.deleted).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);
    if (q) list = list.filter(n => n.content.toLowerCase().includes(q));
    if (currentModeFilter !== 'all') list = list.filter(n => getNoteMode(n) === currentModeFilter);
    return list;
}

function getDeletedNotes() {
    return notes.filter(n => n.deleted).sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
}

function renderHistory() {
    const list = getFilteredList();
    historyCount.textContent = '(' + notes.filter(n => !n.deleted).length + ')';

    if (list.length === 0) {
        historyList.innerHTML = (searchInput.value || '').trim()
            ? '<div class="no-results">没有找到匹配的记录</div>'
            : '<div class="empty-state"><div class="empty-illustration"><svg viewBox="0 0 120 100" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="20" y="10" width="80" height="80" rx="12"/><line x1="35" y1="32" x2="85" y2="32"/><line x1="35" y1="48" x2="75" y2="48"/><line x1="35" y1="64" x2="60" y2="64"/></svg></div><div class="empty-title">暂无记录</div><div class="empty-sub">在上方编辑器中开始记录吧</div></div>';
        pagination.classList.add('hidden');
        return;
    }

    // Clamp current page
    const totalPages = Math.ceil(list.length / PAGE_SIZE);
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageItems = list.slice(start, start + PAGE_SIZE);

    historyList.innerHTML = '';
    pageItems.forEach((note, i) => {
        const card = document.createElement('div');
        card.className = 'history-card' + (note.pinned ? ' pinned' : '');
        card.style.animationDelay = (i * 0.03) + 's';

        const hasMore = note.content.length > 300;

        let imgsHtml = '';
        if (note.images && note.images.length) {
            imgsHtml = '<div class="card-images">' + note.images.map(function(img) {
                var isData = img.startsWith('data:');
                var src = isData ? img : '';
                return '<div class="card-img-thumb" data-src="' + escHtml(img) + '"><img src="' + escHtml(src) + '" alt=""></div>';
            }).join('') + '</div>';
        }

        const mode = getNoteMode(note);
        const modeLabel = mode === 'mixed' ? '综合' : mode === 'image' ? '图片' : '文本';

        card.innerHTML =
            '<div class="card-header"><div class="card-meta"><span class="card-mode" data-mode="' + mode + '">' + modeLabel + '</span><span class="card-time">' + fmtTime(note.updatedAt) + '</span></div>' +
            '<div class="card-actions">' +
                '<button class="card-action pin-btn" data-id="' + note.id + '" title="' + (note.pinned ? '取消置顶' : '置顶') + '">' +
                    '<svg viewBox="0 0 24 24" fill="' + (note.pinned ? 'var(--pin-color)' : 'none') + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2z"/></svg>' +
                '</button>' +
                '<button class="card-action edit-btn" data-id="' + note.id + '" title="编辑">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
                '</button>' +
                '<button class="card-action copy-btn" data-id="' + note.id + '" title="复制">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
                '</button>' +
                '<button class="card-action md-export-btn" data-id="' + note.id + '" title="导出 Markdown">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>' +
                '</button>' +
                '<button class="card-action danger delete-btn" data-id="' + note.id + '" title="删除">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
                '</button>' +
            '</div></div>' +
            '<div class="card-content markdown-body">' + renderMd(note.content) + '</div>' +
            (hasMore ? '<button class="card-expand expand-btn" data-id="' + note.id + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>' : '') +
            imgsHtml;

        historyList.appendChild(card);
    });

    renderPagination(list.length);
    bindHistoryEvents();
    resolveCardImages();
}

function resolveCardImages() {
    historyList.querySelectorAll('.card-img-thumb').forEach(function(thumb) {
        var filename = thumb.dataset.src;
        if (!filename || filename.startsWith('data:')) return;
        resolveImageSrc(filename).then(function(src) {
            if (src) {
                var img = thumb.querySelector('img');
                if (img) img.src = src;
            }
        });
    });
}

function renderPagination(total) {
    const totalPages = Math.ceil(total / PAGE_SIZE);
    if (totalPages <= 1) {
        pagination.classList.add('hidden');
        return;
    }
    pagination.classList.remove('hidden');

    let html = '';
    // Prev button
    html += '<button class="page-btn" data-page="prev"' + (currentPage <= 1 ? ' disabled' : '') + '>&lsaquo;</button>';

    // Page numbers with ellipsis
    const range = [];
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
            range.push(i);
        }
    }
    let last = 0;
    range.forEach(p => {
        if (last && p - last > 1) html += '<span class="page-ellipsis">…</span>';
        html += '<button class="page-btn' + (p === currentPage ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>';
        last = p;
    });

    // Next button
    html += '<button class="page-btn" data-page="next"' + (currentPage >= totalPages ? ' disabled' : '') + '>&rsaquo;</button>';

    pageNav.innerHTML = html;
}

// Page navigation
pageNav.addEventListener('click', function(e) {
    const btn = e.target.closest('.page-btn');
    if (!btn || btn.disabled) return;
    const page = btn.dataset.page;
    if (page === 'prev') currentPage--;
    else if (page === 'next') currentPage++;
    else currentPage = parseInt(page);
    renderHistory();
    historyList.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

function bindHistoryEvents() {
    historyList.onclick = function(e) {
        const target = e.target.closest('[data-id]');
        if (!target) return;
        const id = target.dataset.id;

        if (target.classList.contains('pin-btn')) {
            const n = notes.find(n => n.id === id);
            if (n) { n.pinned = !n.pinned; save(); renderHistory(); autoSync(); }
            return;
        }

        if (target.classList.contains('edit-btn')) {
            const n = notes.find(n => n.id === id);
            if (n) {
                editingId = id;
                contentInput.value = n.content;
                editingBadge.classList.add('visible');
                contentInput.dispatchEvent(new Event('input'));
                contentInput.focus();
                window.scrollTo({ top: 0, behavior: 'smooth' });
                document.querySelectorAll('.ep-tab').forEach(t => t.classList.remove('active'));
                document.querySelector('.ep-tab[data-pane="edit"]').classList.add('active');
                previewPane.classList.remove('visible');
                inputArea.style.display = '';
            }
            return;
        }

        if (target.classList.contains('copy-btn')) {
            const n = notes.find(n => n.id === id);
            if (n) {
                navigator.clipboard.writeText(n.content).then(() => toast('已复制到剪贴板', 'success')).catch(() => toast('复制失败', 'error'));
            }
            return;
        }

        if (target.classList.contains('delete-btn')) {
            showConfirm('确定删除这条记录？将移入回收站').then(ok => {
                if (!ok) return;
                const n = notes.find(n => n.id === id);
                if (n) {
                    n.deleted = true;
                    n.deletedAt = Date.now();
                }
                if (editingId === id) {
                    editingId = null;
                    contentInput.value = '';
                    editingBadge.classList.remove('visible');
                }
                save();
                renderHistory();
                toast('已移入回收站', 'success');
                autoSync();
            });
            return;
        }

        if (target.classList.contains('expand-btn') || target.closest('.expand-btn')) {
            const btn = target.closest('.expand-btn') || target;
            const card = btn.closest('.history-card');
            const content = card.querySelector('.card-content');
            if (content.classList.contains('expanded')) {
                // Collapse: animate from current height to 200px
                const from = content.scrollHeight + 'px';
                content.classList.remove('expanded');
                btn.classList.remove('open');
                content.style.maxHeight = '200px';
                content.animate(
                    [{ maxHeight: from }, { maxHeight: '200px' }],
                    { duration: 450, easing: 'cubic-bezier(.4,0,.2,1)' }
                );
            } else {
                // Expand: animate from 200px to full height, then remove cap
                const to = content.scrollHeight;
                content.classList.add('expanded');
                btn.classList.add('open');
                content.style.maxHeight = to + 'px';
                content.animate(
                    [{ maxHeight: '200px' }, { maxHeight: to + 'px' }],
                    { duration: 450, easing: 'cubic-bezier(.4,0,.2,1)' }
                ).onfinish = function() {
                    content.style.maxHeight = 'none';
                    requestAnimationFrame(function() {
                        var targetY = card.getBoundingClientRect().top + window.scrollY - 72;
                        var maxScroll = document.documentElement.scrollHeight - document.documentElement.clientHeight;
                        targetY = Math.min(targetY, maxScroll);
                        var startY = window.scrollY;
                        var diff = targetY - startY;
                        if (Math.abs(diff) < 2) return;
                        var start = null;
                        (function step(ts) {
                            if (!start) start = ts;
                            var p = Math.min((ts - start) / 350, 1);
                            var ease = p < 0.5 ? 4*p*p*p : 1 - Math.pow(-2*p+2,3)/2;
                            window.scrollTo(0, startY + diff * ease);
                            if (p < 1) requestAnimationFrame(step);
                        })(start);
                    });
                };
            }
            return;
        }

        if (target.classList.contains('md-export-btn')) {
            const n = notes.find(n => n.id === id);
            if (n) {
                const blob = new Blob([n.content], { type: 'text/markdown' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'jian-' + n.id + '.md';
                a.click();
                URL.revokeObjectURL(url);
                toast('已导出 Markdown', 'success');
            }
            return;
        }
    };
}

// ===== Lightbox =====
lightbox.addEventListener('click', function() { this.classList.add('hidden'); });

// Open lightbox for images in rendered markdown content, preview pane, and history card thumbnails
document.addEventListener('click', function(e) {
    const img = e.target.closest('.card-img-thumb img, .markdown-body img, .preview-pane img, .input-images-preview img');
    if (img && img.src) {
        e.preventDefault();
        lightboxImg.src = img.src;
        lightbox.classList.remove('hidden');
    }
});

// ===== Context Menu =====
const SVG = {
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
    redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/></svg>',
    cut: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    paste: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>',
    pasteText: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M9 14h6"/><path d="M9 18h4"/></svg>',
    selectAll: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/><path d="M3 9h18"/><path d="M3 15h18"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>'
};

function showContextMenu(items, x, y) {
    let html = '';
    items.forEach(item => {
        if (item === 'sep') {
            html += '<div class="ctx-sep"></div>';
        } else {
            html += '<div class="ctx-item' + (item.danger ? ' danger' : '') + '" data-action="' + item.action + '">'
                + (item.icon || '')
                + '<span>' + item.label + '</span>'
                + (item.shortcut ? '<span class="ctx-shortcut">' + item.shortcut + '</span>' : '')
                + '</div>';
        }
    });
    contextMenu.innerHTML = html;
    contextMenu.classList.remove('hidden');

    // Position: keep within viewport
    const rect = contextMenu.getBoundingClientRect();
    const mw = 200, mh = items.length * 38;
    if (x + mw > window.innerWidth) x = window.innerWidth - mw - 8;
    if (y + mh > window.innerHeight) y = window.innerHeight - mh - 8;
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';

    // Bind item clicks
    contextMenu.querySelectorAll('.ctx-item').forEach(el => {
        el.addEventListener('click', function() {
            const action = this.dataset.action;
            hideContextMenu();
            if (action && ctxActions[action]) ctxActions[action]();
        });
    });
}

function hideContextMenu() {
    contextMenu.classList.add('hidden');
}

document.addEventListener('click', function(e) {
    if (!contextMenu.contains(e.target)) hideContextMenu();
});
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') hideContextMenu();
});

// Context actions registry
const ctxActions = {};

// ===== Editor Context Menu =====
contentInput.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    const hasSel = this.selectionStart !== this.selectionEnd;
    const items = [
        { action: 'editor-undo', icon: SVG.undo, label: '撤销', shortcut: 'Ctrl+Z' },
        { action: 'editor-redo', icon: SVG.redo, label: '重做', shortcut: 'Ctrl+Y' },
        'sep',
        { action: 'editor-cut', icon: SVG.cut, label: '剪切', shortcut: 'Ctrl+X' },
        { action: 'editor-copy', icon: SVG.copy, label: '复制', shortcut: 'Ctrl+C' },
        { action: 'editor-paste', icon: SVG.paste, label: '粘贴', shortcut: 'Ctrl+V' },
        { action: 'editor-paste-text', icon: SVG.pasteText, label: '粘贴为文本' },
        'sep',
        { action: 'editor-select-all', icon: SVG.selectAll, label: '全选', shortcut: 'Ctrl+A' }
    ];
    showContextMenu(items, e.clientX, e.clientY);
});

ctxActions['editor-undo'] = function() {
    contentInput.focus();
    document.execCommand('undo');
};
ctxActions['editor-redo'] = function() {
    contentInput.focus();
    document.execCommand('redo');
};
ctxActions['editor-cut'] = function() {
    contentInput.focus();
    document.execCommand('cut');
};
ctxActions['editor-copy'] = function() {
    contentInput.focus();
    document.execCommand('copy');
};
ctxActions['editor-paste'] = function() {
    contentInput.focus();
    navigator.clipboard.read().then(items => {
        for (const item of items) {
            // Try image first
            const imgType = item.types.find(t => t.startsWith('image/'));
            if (imgType) {
                item.getType(imgType).then(blob => {
                    const reader = new FileReader();
                    reader.onload = function(ev) {
                        pendingImages.push(ev.target.result);
                        renderImagePreview();
                    };
                    reader.readAsDataURL(blob);
                });
                return;
            }
            // Then text/html
            if (item.types.includes('text/html')) {
                item.getType('text/html').then(blob => blob.text()).then(html => {
                    insertHtmlAsMarkdown(html);
                });
                return;
            }
            // Plain text
            if (item.types.includes('text/plain')) {
                item.getType('text/plain').then(blob => blob.text()).then(text => {
                    insertText(text);
                });
                return;
            }
        }
    }).catch(() => {
        // Fallback: try execCommand paste
        document.execCommand('paste');
    });
};
ctxActions['editor-paste-text'] = function() {
    contentInput.focus();
    navigator.clipboard.readText().then(text => {
        insertText(text);
    }).catch(() => toast('无法读取剪贴板', 'error'));
};
ctxActions['editor-select-all'] = function() {
    contentInput.focus();
    contentInput.select();
};

function insertText(text) {
    const s = contentInput.selectionStart, en = contentInput.selectionEnd;
    contentInput.value = contentInput.value.substring(0, s) + text + contentInput.value.substring(en);
    contentInput.setSelectionRange(s + text.length, s + text.length);
    contentInput.dispatchEvent(new Event('input'));
}

function insertHtmlAsMarkdown(html) {
    insertText(htmlToMarkdown(html));
}

// ===== Image Context Menu =====
document.addEventListener('contextmenu', function(e) {
    const img = e.target.closest('.card-img-thumb img, .markdown-body img, .preview-pane img, .input-images-preview .preview-thumb img');
    if (!img) return;
    e.preventDefault();

    const thumb = img.closest('.card-img-thumb');
    const src = thumb ? thumb.dataset.src : img.src;

    const items = [
        { action: 'img-save', icon: SVG.download, label: '另存为' },
        { action: 'img-copy', icon: SVG.image, label: '复制图片' },
        { action: 'img-copy-url', icon: SVG.link, label: '复制地址' }
    ];
    showContextMenu(items, e.clientX, e.clientY);

    ctxActions['img-save'] = function() {
        const a = document.createElement('a');
        a.href = src;
        a.download = 'image-' + Date.now() + '.png';
        a.click();
    };
    ctxActions['img-copy'] = function() {
        // Try to copy image blob to clipboard
        fetch(src).then(r => r.blob()).then(blob => {
            if (navigator.clipboard.write) {
                const item = new ClipboardItem({ [blob.type]: blob });
                return navigator.clipboard.write([item]);
            }
            throw new Error('ClipboardItem not supported');
        }).then(() => {
            toast('已复制图片', 'success');
        }).catch(() => {
            // Fallback: copy URL instead
            navigator.clipboard.writeText(src).then(() => toast('已复制图片地址', 'success')).catch(() => toast('复制失败', 'error'));
        });
    };
    ctxActions['img-copy-url'] = function() {
        navigator.clipboard.writeText(src).then(() => toast('已复制地址', 'success')).catch(() => toast('复制失败', 'error'));
    };
});

// ===== Search =====
searchInput.addEventListener('input', function() { currentPage = 1; renderHistory(); });

// ===== Mode filter =====
filterBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    filterDropdown.classList.toggle('hidden');
});

filterDropdown.addEventListener('click', function(e) {
    const option = e.target.closest('.filter-option');
    if (!option) return;
    currentModeFilter = option.dataset.filter;
    filterLabel.textContent = option.textContent;
    filterDropdown.querySelectorAll('.filter-option').forEach(o => o.classList.remove('active'));
    option.classList.add('active');
    filterDropdown.classList.add('hidden');
    currentPage = 1;
    renderHistory();
});

document.addEventListener('click', function(e) {
    if (!filterWrap.contains(e.target)) filterDropdown.classList.add('hidden');
});

// ===== Export =====
exportBtn.addEventListener('click', function() {
    const active = notes.filter(n => !n.deleted);
    if (active.length === 0) { toast('没有可导出的记录', 'error'); return; }
    const data = active.map(n => ({
        content: n.content,
        pinned: n.pinned,
        images: n.images || [],
        createdAt: n.createdAt,
        updatedAt: n.updatedAt
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'jian-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    toast('导出成功', 'success');
});

// ===== Import =====
importBtn.addEventListener('click', function() { importFileInput.click(); });
importFileInput.addEventListener('change', function() {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (!Array.isArray(data)) { toast('文件格式错误', 'error'); return; }
            let count = 0;
            data.forEach(function(item) {
                if (!item.content) return;
                notes.unshift({
                    id: uid(),
                    content: item.content,
                    images: item.images || [],
                    pinned: !!item.pinned,
                    createdAt: item.createdAt || Date.now(),
                    updatedAt: item.updatedAt || Date.now()
                });
                count++;
            });
            save();
            currentPage = 1;
            renderHistory();
            toast('导入成功，共 ' + count + ' 条', 'success');
            autoSync();
        } catch(err) {
            toast('导入失败：文件解析错误', 'error');
        }
    };
    reader.readAsText(file);
    this.value = '';
});

// ===== Recycle Bin =====
function openTrash() {
    trashModal.classList.remove('hidden');
    renderTrash();
}

function closeTrash() {
    trashModal.classList.add('hidden');
}

function renderTrash() {
    const deleted = getDeletedNotes();
    trashEmpty.style.display = deleted.length ? 'none' : '';
    trashList.innerHTML = deleted.map(n =>
        '<div class="trash-item" data-id="' + n.id + '">' +
        '<span class="trash-item-content">' + escHtml(n.content.substring(0, 80)) + '</span>' +
        '<span class="trash-item-time">' + fmtTime(n.deletedAt || n.updatedAt) + '</span>' +
        '<div class="trash-item-actions">' +
        '<button class="trash-restore" data-id="' + n.id + '">恢复</button>' +
        '<button class="trash-delete-permanent" data-id="' + n.id + '">彻底删除</button>' +
        '</div></div>'
    ).join('');

    trashList.querySelectorAll('.trash-restore').forEach(function(btn) {
        btn.addEventListener('click', function() {
            const n = notes.find(n => n.id === this.dataset.id);
            if (n) { delete n.deleted; delete n.deletedAt; }
            save(); renderTrash(); renderHistory(); autoSync();
            toast('已恢复', 'success');
        });
    });

    trashList.querySelectorAll('.trash-delete-permanent').forEach(function(btn) {
        btn.addEventListener('click', async function() {
            if (!await showConfirm('彻底删除后无法恢复，确定？')) return;
            const id = this.dataset.id;
            const deleted = notes.find(n => n.id === id);
            notes = notes.filter(n => n.id !== id);
            if (deleted && deleted.images) {
                deleted.images.forEach(function(img) {
                    if (img.startsWith('data:')) return;
                    repoReadFile('data/images/' + img).then(function(result) {
                        if (result) return repoDeleteFile('data/images/' + img, result.sha, 'delete ' + img);
                    }).catch(function() {});
                    imgCacheDelete(img);
                });
            }
            save(); renderTrash(); renderHistory(); autoSync();
            toast('已彻底删除', 'success');
        });
    });
}

trashBtn.addEventListener('click', openTrash);
closeTrashBtn.addEventListener('click', closeTrash);
closeTrashBtn2.addEventListener('click', closeTrash);
trashModal.addEventListener('mousedown', function(e) {
    if (e.target === trashModal) closeTrash();
});

emptyTrashBtn.addEventListener('click', async function() {
    const deleted = getDeletedNotes();
    if (deleted.length === 0) return;
    if (!await showConfirm('确定清空回收站？共 ' + deleted.length + ' 条记录将被彻底删除')) return;
    deleted.forEach(function(n) {
        if (n.images) {
            n.images.forEach(function(img) {
                if (img.startsWith('data:')) return;
                repoReadFile('data/images/' + img).then(function(result) {
                    if (result) return repoDeleteFile('data/images/' + img, result.sha, 'delete ' + img);
                }).catch(function() {});
                imgCacheDelete(img);
            });
        }
    });
    notes = notes.filter(n => !n.deleted);
    save(); closeTrash(); renderHistory(); autoSync();
    toast('回收站已清空', 'success');
});

// Auto-purge notes deleted > 7 days ago
(function purgeOldDeleted() {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const old = notes.filter(n => n.deleted && (n.deletedAt || 0) < cutoff);
    if (old.length) {
        notes = notes.filter(n => !n.deleted || (n.deletedAt || 0) >= cutoff);
        save();
    }
})();

// ===== Clear All =====
clearAllBtn.addEventListener('click', async function() {
    const active = notes.filter(n => !n.deleted);
    if (active.length === 0) { toast('没有可清空的记录', 'error'); return; }
    if (await showConfirm('确定要清空所有 ' + active.length + ' 条记录吗？将移入回收站')) {
        active.forEach(n => { n.deleted = true; n.deletedAt = Date.now(); });
        editingId = null;
        contentInput.value = '';
        editingBadge.classList.remove('visible');
        save();
        renderHistory();
        toast('已全部移入回收站', 'success');
        clearTimeout(syncTimer);
        pushToRepo(true);
    }
});

// ===== Settings Modal =====
function openSettings() {
    settingsModal.classList.remove('hidden');
    $('syncToggle').checked = !!settings.syncEnabled;
    $('githubTokenInput').value = settings.githubToken || '';
    $('repoNameInput').value = settings.repoName || '';
    updateSettingsUI();
}

function closeSettings() {
    settingsModal.classList.add('hidden');
}

function updateSettingsUI() {
    const syncOn = $('syncToggle').checked;
    $('syncFields').classList.toggle('hidden', !syncOn);
    const configured = syncOn && !!($('githubTokenInput').value.trim() && $('repoNameInput').value.trim());
    const dot = $('repoStatusDot'), text = $('repoStatusText');
    if (configured) {
        dot.classList.add('active');
        text.textContent = '已配置';
    } else {
        dot.classList.remove('active');
        text.textContent = '未配置';
    }
    const pwdHint = $('passwordSyncHint');
    const pwdControls = $('passwordControls');
    if (configured) {
        pwdHint.classList.add('hidden');
        pwdControls.classList.remove('hidden');
        updatePasswordUI();
    } else {
        pwdHint.classList.remove('hidden');
        pwdControls.classList.add('hidden');
    }
}

function updatePasswordUI() {
    const hasPwd = !!settings.password;
    $('pwdStatusDot').classList.toggle('active', hasPwd);
    $('pwdStatusText').textContent = hasPwd ? '已设置' : '未设置';
    $('setPasswordBtn').classList.toggle('hidden', hasPwd);
    $('changePasswordBtn').classList.toggle('hidden', !hasPwd);
    $('removePasswordBtn').classList.toggle('hidden', !hasPwd);
    $('pwdForm').classList.add('hidden');
}

settingsBtn.addEventListener('click', openSettings);
closeSettingsBtn.addEventListener('click', closeSettings);
cancelSettingsBtn.addEventListener('click', closeSettings);

$('syncToggle').addEventListener('change', updateSettingsUI);
$('githubTokenInput').addEventListener('input', updateSettingsUI);
$('repoNameInput').addEventListener('input', updateSettingsUI);

saveSettingsBtn.addEventListener('click', function() {
    settings.syncEnabled = $('syncToggle').checked;
    settings.githubToken = $('githubTokenInput').value.trim();
    settings.repoName = $('repoNameInput').value.trim().replace(/^github\.com\//i, '');
    save();
    closeSettings();
    toast('设置已保存', 'success');
    if (isRepoConfigured()) pullFromRepo();
});

settingsModal.addEventListener('mousedown', function(e) {
    if (e.target === settingsModal) closeSettings();
});

// ===== Password management =====
$('setPasswordBtn').addEventListener('click', function() {
    $('pwdForm').classList.remove('hidden');
    $('currentPwdGroup').classList.add('hidden');
    $('newPwdLabel').textContent = '新密码';
    $('newPwdInput').value = '';
    $('confirmPwdInput').value = '';
    $('currentPwdInput').value = '';
    $('pwdMsg').classList.remove('visible');
});

$('changePasswordBtn').addEventListener('click', function() {
    $('pwdForm').classList.remove('hidden');
    $('currentPwdGroup').classList.remove('hidden');
    $('newPwdLabel').textContent = '新密码';
    $('newPwdInput').value = '';
    $('confirmPwdInput').value = '';
    $('currentPwdInput').value = '';
    $('pwdMsg').classList.remove('visible');
});

$('cancelPwdBtn').addEventListener('click', function() {
    $('pwdForm').classList.add('hidden');
});

$('savePwdBtn').addEventListener('click', async function() {
    const msg = $('pwdMsg');
    const isNew = !settings.password;
    const current = $('currentPwdInput').value;
    const np = $('newPwdInput').value;
    const cp = $('confirmPwdInput').value;

    if (!isNew) {
        const currentHash = await hashPassword(current);
        if (currentHash !== settings.password && current !== settings.password) {
            msg.textContent = '当前密码错误'; msg.className = 'pwd-msg error visible'; return;
        }
    }
    if (!np) {
        msg.textContent = '请输入新密码'; msg.className = 'pwd-msg error visible'; return;
    }
    if (np !== cp) {
        msg.textContent = '两次密码不一致'; msg.className = 'pwd-msg error visible'; return;
    }
    settings.password = await hashPassword(np);
    save();
    updatePasswordUI();
    toast('密码已保存', 'success');
});

$('removePasswordBtn').addEventListener('click', async function() {
    if (await showConfirm('确定移除密码保护？')) {
        settings.password = '';
        save();
        updatePasswordUI();
        toast('密码已移除', 'success');
    }
});

// ===== Test repo connection =====
$('testRepoBtn').addEventListener('click', function() {
    const token = $('githubTokenInput').value.trim();
    const repo = $('repoNameInput').value.trim().replace(/^github\.com\//i, '');
    const dot = $('repoStatusDot'), text = $('repoStatusText');
    if (!token) { toast('请先输入 Token', 'error'); return; }
    if (!repo) { toast('请先填写仓库名', 'error'); return; }
    dot.classList.remove('active'); text.textContent = '测试中…';
    fetch('https://api.github.com/repos/' + repo, {
        headers: { 'Authorization': 'token ' + token }
    }).then(r => {
        if (r.ok) { dot.classList.add('active'); text.textContent = '连接成功'; toast('仓库连接成功', 'success'); }
        else if (r.status === 404) { dot.classList.remove('active'); text.textContent = '无法访问'; toast('仓库不存在或 Token 无 repo 权限（私有仓库需要勾选 repo）', 'error'); }
        else if (r.status === 401) { dot.classList.remove('active'); text.textContent = 'Token 无效'; toast('Token 无效或已过期', 'error'); }
        else { dot.classList.remove('active'); text.textContent = '连接失败'; toast('连接失败 (' + r.status + ')', 'error'); }
    }).catch(() => { dot.classList.remove('active'); text.textContent = '网络错误'; toast('网络错误', 'error'); });
});

// ===== GitHub Repo API =====
const DATA_PATH = 'data/notes.json';

function ghApi(path, options) {
    return fetch('https://api.github.com' + path, Object.assign({}, options, {
        headers: Object.assign({
            'Authorization': 'token ' + settings.githubToken,
            'Accept': 'application/vnd.github.v3+json'
        }, options && options.headers)
    }));
}

function repoReadFile(path) {
    const [owner, repo] = settings.repoName.split('/');
    return ghApi('/repos/' + owner + '/' + repo + '/contents/' + path).then(function(r) {
        if (!r.ok) return null;
        return r.json().then(function(data) {
            var raw = atob(data.content.replace(/\n/g, ''));
            var bytes = new Uint8Array(raw.length);
            for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
            return { content: new TextDecoder('utf-8').decode(bytes), sha: data.sha };
        });
    });
}

function repoWriteFile(path, content, sha, message, raw) {
    var [owner, repo] = settings.repoName.split('/');
    var body = { message: message || 'sync', content: raw ? content : btoa(unescape(encodeURIComponent(content))) };
    if (sha) body.sha = sha;
    return ghApi('/repos/' + owner + '/' + repo + '/contents/' + path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    }).then(function(r) {
        if (!r.ok) return { ok: false, status: r.status };
        return r.json().then(function(data) { return { ok: true, status: r.status, data: data }; });
    });
}

function repoGetCommitCount(path) {
    var [owner, repo] = settings.repoName.split('/');
    return ghApi('/repos/' + owner + '/' + repo + '/commits?path=' + path + '&per_page=1').then(function(r) {
        if (!r.ok) return 0;
        var link = r.headers.get('Link');
        if (!link) return 1;
        var match = link.match(/page=(\d+)>; rel="last"/);
        return match ? parseInt(match[1]) : 1;
    });
}

function repoCleanupHistory() {
    var [owner, repo] = settings.repoName.split('/');
    return ghApi('/repos/' + owner + '/' + repo + '/git/refs/heads/main').then(function(r) {
        if (!r.ok) throw new Error('获取分支失败');
        return r.json();
    }).then(function(refData) {
        return ghApi('/repos/' + owner + '/' + repo + '/git/commits/' + refData.object.sha);
    }).then(function(r) {
        if (!r.ok) throw new Error('获取 commit 失败');
        return r.json();
    }).then(function(commitData) {
        return ghApi('/repos/' + owner + '/' + repo + '/git/commits', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'sync (history cleanup)', tree: commitData.tree.sha })
        });
    }).then(function(r) {
        if (!r.ok) throw new Error('创建 commit 失败');
        return r.json();
    }).then(function(newCommit) {
        return ghApi('/repos/' + owner + '/' + repo + '/git/refs/heads/main', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sha: newCommit.sha, force: true })
        });
    });
}

// ===== Repo image API =====
function repoDeleteFile(path, sha, message) {
    var [owner, repo] = settings.repoName.split('/');
    return ghApi('/repos/' + owner + '/' + repo + '/contents/' + path, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message || 'delete file', sha: sha })
    });
}

// Upload pending images to repo, then clear pending list
function uploadPendingImages() {
    // Collect all image filenames referenced by notes
    var referencedFiles = new Set();
    notes.forEach(function(n) {
        (n.images || []).forEach(function(img) {
            if (!img.startsWith('data:')) referencedFiles.add(img);
        });
    });

    // Find images in IndexedDB that need uploading (not base64 legacy)
    var uploadPromises = [];
    notes.forEach(function(n) {
        (n.images || []).forEach(function(img) {
            if (img.startsWith('data:') || !referencedFiles.has(img)) return;
            uploadPromises.push(
                imgCacheGet(img).then(function(cached) {
                    if (!cached) return; // already in repo or missing
                    var base64 = cached.split(',')[1] || '';
                    return repoWriteFile('data/images/' + img, base64, null, 'upload ' + img, true).catch(function() {
                        // File might already exist, ignore
                    });
                })
            );
        });
    });
    return Promise.all(uploadPromises);
}

// ===== Sync: push local to remote =====
function setSyncingUI(on) {
    syncBtn.disabled = on;
    saveBtn.disabled = on;
    syncBtn.classList.toggle('sync-spin', on);
}

function pushToRepo(force, retries) {
    if (!isRepoConfigured()) return Promise.resolve();
    if (!force && syncing) return Promise.resolve();
    retries = retries || 0;
    syncing = true;
    setSyncingUI(true);
    var content = JSON.stringify(notes, null, 2);

    return uploadPendingImages().then(function() {
        return repoReadFile(DATA_PATH);
    }).then(function(result) {
        var sha = result ? result.sha : null;
        return repoWriteFile(DATA_PATH, content, sha, 'sync notes');
    }).then(function(r) {
        if (!r.ok) {
            if (r.status === 409 && retries < 3) {
                return new Promise(function(resolve) {
                    setTimeout(resolve, 500 * (retries + 1));
                }).then(function() { return pushToRepo(force, retries + 1); });
            }
            throw new Error('写入失败 (' + (r.status || '网络错误') + ')');
        }
        return repoGetCommitCount(DATA_PATH);
    }).then(function(count) {
        if (count > MAX_COMMITS) {
            return repoCleanupHistory();
        }
    }).then(function() {
        syncing = false;
        setSyncingUI(false);
        if (!force && pendingSync) {
            pendingSync = false;
            pushToRepo();
        }
    }).catch(function(err) {
        syncing = false;
        setSyncingUI(false);
        console.error('push failed:', err);
        if (!force && pendingSync) {
            pendingSync = false;
            autoSync();
        }
    });
}

// ===== Sync: pull remote to local =====
function mergeNotes(local, remote) {
    var map = {};
    local.forEach(function(n) { map[n.id] = n; });
    remote.forEach(function(n) {
        if (!map[n.id]) {
            // Remote has a note we don't — add it
            map[n.id] = n;
        } else {
            // Both have it — keep the newer one
            if ((n.updatedAt || 0) >= (map[n.id].updatedAt || 0)) {
                map[n.id] = n;
            }
        }
    });
    return Object.values(map);
}

function pullFromRepo() {
    if (!isRepoConfigured()) return Promise.resolve();
    return repoReadFile(DATA_PATH).then(function(result) {
        if (result) {
            try {
                var remote = JSON.parse(result.content);
                if (Array.isArray(remote)) {
                    notes = mergeNotes(notes, remote);
                    save();
                    currentPage = 1;
                    renderHistory();
                    return cacheRemoteImages(remote);
                }
            } catch(e) {}
        }
    });
}

function cacheRemoteImages(notesList) {
    var filenames = new Set();
    notesList.forEach(function(n) {
        (n.images || []).forEach(function(img) {
            if (!img.startsWith('data:')) filenames.add(img);
        });
    });
    var [owner, repo] = settings.repoName.split('/');
    var promises = [];
    filenames.forEach(function(filename) {
        promises.push(
            imgCacheGet(filename).then(function(cached) {
                if (cached) return;
                return ghApi('/repos/' + owner + '/' + repo + '/contents/data/images/' + filename).then(function(r) {
                    if (!r.ok) return;
                    return r.json().then(function(data) {
                        var ext = filename.split('.').pop();
                        var mime = ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
                        var dataUrl = 'data:' + mime + ';base64,' + data.content.replace(/\n/g, '');
                        return imgCachePut(filename, dataUrl);
                    });
                });
            }).catch(function() {})
        );
    });
    return Promise.all(promises).then(function() {
        renderHistory();
    });
}

// ===== Auto sync (debounced push) =====
let pendingSync = false;

function autoSync() {
    if (!isRepoConfigured()) return;
    if (syncing) { pendingSync = true; return; }
    clearTimeout(syncTimer);
    syncTimer = setTimeout(pushToRepo, 2000);
}

// ===== Full sync: cancel debounce → push → pull → final push if pending =====
function fullSync() {
    if (!isRepoConfigured()) { toast('请先配置仓库', 'error'); return; }
    clearTimeout(syncTimer);
    syncing = true;
    setSyncingUI(true);
    pushToRepo(true).then(function() {
        return pullFromRepo();
    }).then(function() {
        if (pendingSync) {
            pendingSync = false;
            return pushToRepo(true);
        }
    }).then(function() {
        syncing = false;
        setSyncingUI(false);
        toast('同步完成', 'success');
    }).catch(function(err) {
        syncing = false;
        setSyncingUI(false);
        toast(err.message || '同步失败', 'error');
    });
}

syncBtn.addEventListener('click', fullSync);

// ===== Image attach =====
attachBtn.addEventListener('click', function() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = function() {
        Array.from(input.files).forEach(file => {
            const reader = new FileReader();
            reader.onload = function(e) {
                pendingImages.push(e.target.result);
                renderImagePreview();
            };
            reader.readAsDataURL(file);
        });
    };
    input.click();
});

function renderImagePreview() {
    if (pendingImages.length === 0) {
        inputImagesPreview.innerHTML = '';
        inputImagesPreview.classList.add('hidden');
        return;
    }
    inputImagesPreview.classList.remove('hidden');
    inputImagesPreview.innerHTML = pendingImages.map((img, i) =>
        '<div class="preview-thumb"><img src="' + img + '" alt=""><button class="remove-thumb" data-idx="' + i + '">&times;</button></div>'
    ).join('');

    inputImagesPreview.querySelectorAll('.remove-thumb').forEach(btn => {
        btn.addEventListener('click', function() {
            pendingImages.splice(parseInt(this.dataset.idx), 1);
            renderImagePreview();
        });
    });
}

// ===== Drag & drop images =====
['dragenter', 'dragover'].forEach(evt => {
    contentInput.addEventListener(evt, e => { e.preventDefault(); dropOverlay.classList.remove('hidden'); });
});
['dragleave', 'drop'].forEach(evt => {
    contentInput.addEventListener(evt, e => { e.preventDefault(); dropOverlay.classList.add('hidden'); });
});
contentInput.addEventListener('drop', function(e) {
    const files = e.dataTransfer.files;
    Array.from(files).forEach(file => {
        if (!file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = function(ev) {
            pendingImages.push(ev.target.result);
            renderImagePreview();
        };
        reader.readAsDataURL(file);
    });
});

// ===== Paste handler =====
contentInput.addEventListener('paste', function(e) {
    const cd = e.clipboardData;
    if (!cd) return;

    // Handle clipboard images (screenshots, copied image files)
    const items = cd.items;
    if (items) {
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.startsWith('image/')) {
                e.preventDefault();
                const file = items[i].getAsFile();
                if (file) {
                    const reader = new FileReader();
                    reader.onload = function(ev) {
                        pendingImages.push(ev.target.result);
                        renderImagePreview();
                    };
                    reader.readAsDataURL(file);
                }
                return;
            }
        }
    }

    // Handle HTML content → convert to Markdown
    const html = cd.getData('text/html');
    if (!html) return;

    e.preventDefault();
    const result = htmlToMarkdown(html);

    const s = this.selectionStart, en = this.selectionEnd;
    this.value = this.value.substring(0, s) + result + this.value.substring(en);
    this.setSelectionRange(s + result.length, s + result.length);
    this.dispatchEvent(new Event('input'));
});

// ===== Fullscreen =====
fullscreenBtn.addEventListener('click', function() {
    editorSection.classList.toggle('fullscreen');
    if (editorSection.classList.contains('fullscreen')) {
        contentInput.focus();
    }
});

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && editorSection.classList.contains('fullscreen')) {
        editorSection.classList.remove('fullscreen');
    }
});

// ===== Back to top =====
window.addEventListener('scroll', function() {
    backToTop.classList.toggle('visible', window.scrollY > 300);
});
backToTop.addEventListener('click', function() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ===== Dark Mode =====
const THEME_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
const THEME_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    themeIcon.innerHTML = theme === 'dark' ? THEME_SUN : THEME_MOON;
    // Switch highlight.js theme
    const lightSheet = $('hljsThemeLight');
    const darkSheet = $('hljsThemeDark');
    if (lightSheet && darkSheet) {
        lightSheet.disabled = theme === 'dark';
        darkSheet.disabled = theme !== 'dark';
    }
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem('jian_theme', next);
}

themeBtn.addEventListener('click', toggleTheme);

// Apply saved theme on load
(function initTheme() {
    const saved = localStorage.getItem('jian_theme');
    if (saved) { applyTheme(saved); return; }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        applyTheme('dark');
    }
})();

// ===== Clear cache =====
$('clearCacheBtn').addEventListener('click', async function() {
    if (await showConfirm('确定清理本地缓存？清理后将从仓库重新拉取。')) {
        localStorage.removeItem('jian_notes');
        localStorage.removeItem('jian_unlocked');
        notes = [];
        editingId = null;
        contentInput.value = '';
        editingBadge.classList.remove('visible');
        renderHistory();
        // Clear IndexedDB image cache
        imgCacheClear().then(function() {
            // Re-pull from repo if configured
            if (isRepoConfigured()) {
                pullFromRepo().then(function() {
                    toast('缓存已清理，已从仓库重新拉取', 'success');
                });
            } else {
                toast('缓存已清理', 'success');
            }
        });
    }
});

// ===== Init: open IndexedDB, then pull from repo =====
openImgDb().then(function() {
    if (isRepoConfigured()) {
        return pullFromRepo();
    }
}).catch(function() {});

// ===== Drag scroll for mobile toolbars =====
function initDragScroll(el) {
    let startX = 0, startScroll = 0, dragging = false;
    el.addEventListener('touchstart', function(e) {
        if (e.touches.length !== 1) return;
        startX = e.touches[0].pageX;
        startScroll = el.scrollLeft;
        dragging = false;
    }, { passive: true });
    el.addEventListener('touchmove', function(e) {
        if (e.touches.length !== 1) return;
        const dx = e.touches[0].pageX - startX;
        if (!dragging && Math.abs(dx) > 5) dragging = true;
        if (dragging) {
            el.scrollLeft = startScroll - dx;
            e.preventDefault();
        }
    }, { passive: false });
    el.addEventListener('touchend', function() { dragging = false; }, { passive: true });
}

document.querySelectorAll('.toolbar-cats, .tool-group').forEach(initDragScroll);

// ===== Init =====
initLock();
renderHistory();

// ===== Service Worker =====
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(function() {});
}

})();
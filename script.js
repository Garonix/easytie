(function(){
'use strict';

// ===== Marked setup =====
marked.setOptions({
    highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
            try { return hljs.highlight(code, { language: lang }).value; } catch(e) {}
        }
        try { return hljs.highlightAuto(code).value; } catch(e) {}
        return code;
    },
    breaks: true,
    gfm: true
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
const settingsModal = $('settingsModal'), closeSettingsBtn = $('closeSettingsBtn'),
      cancelSettingsBtn = $('cancelSettingsBtn'), saveSettingsBtn = $('saveSettingsBtn');
const lightbox = $('lightbox'), lightboxImg = $('lightboxImg');
const contextMenu = $('contextMenu');
const toastContainer = $('toastContainer');
const backToTop = $('backToTop');
const pagination = $('pagination'), pageNav = $('pageNav');

// ===== State =====
let notes = JSON.parse(localStorage.getItem('jian_notes') || '[]');
let editingId = null;
let pendingImages = [];
let settings = JSON.parse(localStorage.getItem('jian_settings') || '{"syncMode":"off","githubToken":"","gistId":"","lskyUrl":"","lskyToken":"","password":""}');
let currentFilter = '';
let currentPage = 1;
const PAGE_SIZE = 5;
const MAX_NOTES = 50;

// ===== Utils =====
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

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
    try { return marked.parse(text || ''); } catch(e) { return '<p>' + escHtml(text) + '</p>'; }
}

function calcReadingTime(text) {
    if (!text) return 0;
    const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const words = text.replace(/[\u4e00-\u9fff]/g, '').trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil((cjk + words * 0.5) / 300));
}

// ===== Lock =====
function initLock() {
    if (settings.syncMode !== 'off' && settings.password) {
        lockScreen.classList.remove('hidden');
        lockPasswordInput.focus();
    } else {
        lockScreen.classList.add('hidden');
    }
}

function tryUnlock() {
    if (lockPasswordInput.value === settings.password) {
        lockScreen.classList.add('unlocked');
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
            codeblock: ['```\n', '\n```'],
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
function doSave() {
    const text = contentInput.value.trim();
    if (!text && pendingImages.length === 0) { toast('请输入内容', 'error'); return; }

    if (editingId) {
        const idx = notes.findIndex(n => n.id === editingId);
        if (idx >= 0) {
            notes[idx].content = text;
            notes[idx].images = [...(notes[idx].images || []), ...pendingImages];
            notes[idx].updatedAt = Date.now();
        }
        editingId = null;
        editingBadge.classList.remove('visible');
    } else {
        // Enforce max notes limit — remove oldest unpinned note first
        if (notes.length >= MAX_NOTES) {
            let removeIdx = -1;
            for (let i = notes.length - 1; i >= 0; i--) {
                if (!notes[i].pinned) { removeIdx = i; break; }
            }
            if (removeIdx === -1) removeIdx = notes.length - 1;
            notes.splice(removeIdx, 1);
        }
        notes.unshift({
            id: uid(),
            content: text,
            images: [...pendingImages],
            pinned: false,
            createdAt: Date.now(),
            updatedAt: Date.now()
        });
    }

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
function getFilteredList() {
    const q = (searchInput.value || '').trim().toLowerCase();
    let list = [...notes].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);
    if (q) list = list.filter(n => n.content.toLowerCase().includes(q));
    return list;
}

function renderHistory() {
    const list = getFilteredList();
    historyCount.textContent = '(' + notes.length + ')';

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

        const preview = note.content.length > 300 ? note.content.substring(0, 300) + '…' : note.content;
        const hasMore = note.content.length > 300;

        let imgsHtml = '';
        if (note.images && note.images.length) {
            imgsHtml = '<div class="card-images">' + note.images.map(img =>
                '<div class="card-img-thumb" data-src="' + escHtml(img) + '"><img src="' + escHtml(img) + '" alt=""></div>'
            ).join('') + '</div>';
        }

        card.innerHTML =
            '<div class="card-header"><div class="card-meta"><span class="card-mode">文本</span><span class="card-time">' + fmtTime(note.updatedAt) + '</span></div>' +
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
                '<button class="card-action danger delete-btn" data-id="' + note.id + '" title="删除">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
                '</button>' +
            '</div></div>' +
            '<div class="card-content markdown-body">' + renderMd(preview) + '</div>' +
            (hasMore ? '<button class="card-expand expand-btn" data-id="' + note.id + '">展开全文</button>' : '') +
            imgsHtml;

        historyList.appendChild(card);
    });

    renderPagination(list.length);
    bindHistoryEvents();
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
            if (n) { n.pinned = !n.pinned; save(); renderHistory(); }
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
            if (confirm('确定删除这条记录？')) {
                notes = notes.filter(n => n.id !== id);
                if (editingId === id) {
                    editingId = null;
                    contentInput.value = '';
                    editingBadge.classList.remove('visible');
                }
                save();
                renderHistory();
                toast('已删除', 'success');
            }
            return;
        }

        if (target.classList.contains('expand-btn')) {
            const card = target.closest('.history-card');
            const content = card.querySelector('.card-content');
            const n = notes.find(n => n.id === id);
            if (content.classList.contains('expanded')) {
                content.classList.remove('expanded');
                content.innerHTML = renderMd(n.content.substring(0, 300) + '…');
                target.textContent = '展开全文';
            } else {
                content.classList.add('expanded');
                content.innerHTML = renderMd(n.content);
                target.textContent = '收起';
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
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    let result = '';
    function walk(node) {
        if (node.nodeType === 3) { result += node.textContent; }
        else if (node.nodeType === 1) {
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
    }
    tmp.childNodes.forEach(walk);
    result = result.replace(/\n{3,}/g, '\n\n').trim();
    insertText(result);
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

// ===== Export =====
exportBtn.addEventListener('click', function() {
    if (notes.length === 0) { toast('没有可导出的记录', 'error'); return; }
    const data = notes.map(n => ({
        content: n.content,
        images: n.images || [],
        pinned: n.pinned,
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
const importFileInput = document.createElement('input');
importFileInput.type = 'file';
importFileInput.accept = '.json';
importFileInput.style.display = 'none';
document.body.appendChild(importFileInput);

importBtn.addEventListener('click', function() {
    importFileInput.value = '';
    importFileInput.click();
});

importFileInput.addEventListener('change', function() {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (!Array.isArray(data)) { toast('文件格式错误', 'error'); return; }
            const valid = data.filter(n => n && typeof n.content === 'string');
            if (valid.length === 0) { toast('没有有效记录', 'error'); return; }
            valid.forEach(n => {
                if (!n.id) n.id = uid();
                if (!n.createdAt) n.createdAt = Date.now();
                if (!n.updatedAt) n.updatedAt = n.createdAt;
                if (!n.images) n.images = [];
                if (n.pinned === undefined) n.pinned = false;
            });
            notes = [...valid, ...notes];
            save();
            currentPage = 1;
            renderHistory();
            toast('导入成功，共 ' + valid.length + ' 条记录', 'success');
        } catch(err) {
            toast('文件解析失败', 'error');
        }
    };
    reader.readAsText(file);
});

// ===== Clear All =====
clearAllBtn.addEventListener('click', function() {
    if (notes.length === 0) { toast('没有可清空的记录', 'error'); return; }
    if (confirm('确定要清空所有记录吗？此操作不可恢复！')) {
        notes = [];
        editingId = null;
        contentInput.value = '';
        editingBadge.classList.remove('visible');
        save();
        renderHistory();
        toast('已清空所有记录', 'success');
    }
});

// ===== Settings Modal =====
function openSettings() {
    settingsModal.classList.remove('hidden');
    const radios = document.querySelectorAll('input[name="syncMode"]');
    radios.forEach(r => { r.checked = r.value === settings.syncMode; });
    $('githubTokenInput').value = settings.githubToken || '';
    $('gistIdInput').value = settings.gistId || '';
    $('lskyUrlInput').value = settings.lskyUrl || '';
    $('lskyTokenInput').value = settings.lskyToken || '';
    updateSettingsUI();
}

function closeSettings() {
    settingsModal.classList.add('hidden');
}

function updateSettingsUI() {
    const mode = document.querySelector('input[name="syncMode"]:checked').value;
    const ghSection = $('githubSection');
    const lskySection = $('lskySection');
    const pwdSection = $('passwordSection');
    const pwdHint = $('passwordSyncHint');
    const pwdControls = $('passwordControls');

    if (mode === 'off') {
        ghSection.classList.add('hidden');
        lskySection.classList.add('hidden');
    } else {
        ghSection.classList.remove('hidden');
        if (mode === 'text+image') lskySection.classList.remove('hidden');
        else lskySection.classList.add('hidden');
    }

    if (mode !== 'off') {
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

document.querySelectorAll('input[name="syncMode"]').forEach(r => {
    r.addEventListener('change', updateSettingsUI);
});

saveSettingsBtn.addEventListener('click', function() {
    settings.syncMode = document.querySelector('input[name="syncMode"]:checked').value;
    settings.githubToken = $('githubTokenInput').value.trim();
    settings.gistId = $('gistIdInput').value.trim();
    settings.lskyUrl = $('lskyUrlInput').value.trim();
    settings.lskyToken = $('lskyTokenInput').value.trim();
    save();
    closeSettings();
    toast('设置已保存', 'success');
});

settingsModal.addEventListener('click', function(e) {
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

$('savePwdBtn').addEventListener('click', function() {
    const msg = $('pwdMsg');
    const isNew = !settings.password;
    const current = $('currentPwdInput').value;
    const np = $('newPwdInput').value;
    const cp = $('confirmPwdInput').value;

    if (!isNew && current !== settings.password) {
        msg.textContent = '当前密码错误'; msg.className = 'pwd-msg error visible'; return;
    }
    if (!np) {
        msg.textContent = '请输入新密码'; msg.className = 'pwd-msg error visible'; return;
    }
    if (np !== cp) {
        msg.textContent = '两次密码不一致'; msg.className = 'pwd-msg error visible'; return;
    }
    settings.password = np;
    save();
    updatePasswordUI();
    toast('密码已保存', 'success');
});

$('removePasswordBtn').addEventListener('click', function() {
    if (confirm('确定移除密码保护？')) {
        settings.password = '';
        save();
        updatePasswordUI();
        toast('密码已移除', 'success');
    }
});

// ===== Test connections =====
$('testGistBtn').addEventListener('click', function() {
    const token = $('githubTokenInput').value.trim();
    const gistId = $('gistIdInput').value.trim();
    const dot = $('gistStatusDot'), text = $('gistStatusText');
    if (!token) { toast('请先输入 Token', 'error'); return; }
    dot.classList.remove('active'); text.textContent = '测试中…';
    fetch('https://api.github.com/gists' + (gistId ? '/' + gistId : ''), {
        headers: { 'Authorization': 'token ' + token }
    }).then(r => {
        if (r.ok) { dot.classList.add('active'); text.textContent = '连接成功'; toast('Gist 连接成功', 'success'); }
        else { dot.classList.remove('active'); text.textContent = '连接失败'; toast('Gist 连接失败', 'error'); }
    }).catch(() => { dot.classList.remove('active'); text.textContent = '网络错误'; toast('网络错误', 'error'); });
});

$('testLskyBtn').addEventListener('click', function() {
    const url = $('lskyUrlInput').value.trim().replace(/\/+$/, '');
    const token = $('lskyTokenInput').value.trim();
    const dot = $('lskyStatusDot'), text = $('lskyStatusText');
    if (!url || !token) { toast('请先填写地址和 Token', 'error'); return; }
    dot.classList.remove('active'); text.textContent = '测试中…';
    fetch(url + '/api/v1/profile', {
        headers: { 'Authorization': token.startsWith('Bearer ') ? token : 'Bearer ' + token }
    }).then(r => {
        if (r.ok) { dot.classList.add('active'); text.textContent = '连接成功'; toast('图床连接成功', 'success'); }
        else { dot.classList.remove('active'); text.textContent = '连接失败'; toast('图床连接失败', 'error'); }
    }).catch(() => { dot.classList.remove('active'); text.textContent = '网络错误'; toast('网络错误', 'error'); });
});

// ===== Sync =====
syncBtn.addEventListener('click', function() {
    if (settings.syncMode === 'off') { toast('请先在设置中开启同步', 'error'); return; }
    if (!settings.githubToken || !settings.gistId) { toast('请先配置 GitHub Gist', 'error'); return; }
    syncBtn.classList.add('sync-spin');
    fetch('https://api.github.com/gists/' + settings.gistId, {
        headers: { 'Authorization': 'token ' + settings.githubToken }
    }).then(r => r.json()).then(data => {
        const files = data.files || {};
        const file = Object.values(files)[0];
        if (file && file.content) {
            const remote = JSON.parse(file.content);
            if (Array.isArray(remote) && remote.length > notes.length) {
                notes = remote;
                save();
                renderHistory();
            }
        }
        return fetch('https://api.github.com/gists/' + settings.gistId, {
            method: 'PATCH',
            headers: { 'Authorization': 'token ' + settings.githubToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: { 'jian-notes.json': { content: JSON.stringify(notes) } } })
        });
    }).then(() => {
        syncBtn.classList.remove('sync-spin');
        toast('同步完成', 'success');
    }).catch(() => {
        syncBtn.classList.remove('sync-spin');
        toast('同步失败', 'error');
    });
});

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
    const tmp = document.createElement('div');
    tmp.innerHTML = html;

    let result = '';
    function walk(node) {
        if (node.nodeType === 3) {
            result += node.textContent;
        } else if (node.nodeType === 1) {
            const tag = node.tagName.toLowerCase();
            if (tag === 'img') {
                const src = node.getAttribute('src') || '';
                const alt = node.getAttribute('alt') || '';
                if (src) result += '![' + alt + '](' + src + ')';
            } else if (tag === 'br') {
                result += '\n';
            } else if (/^h[1-6]$/.test(tag)) {
                const level = parseInt(tag[1]);
                result += '\n' + '#'.repeat(level) + ' ';
                node.childNodes.forEach(walk);
                result += '\n';
            } else if (tag === 'p' || tag === 'div' || tag === 'blockquote' || tag === 'li') {
                node.childNodes.forEach(walk);
                result += '\n';
            } else if (tag === 'strong' || tag === 'b') {
                result += '**';
                node.childNodes.forEach(walk);
                result += '**';
            } else if (tag === 'em' || tag === 'i') {
                result += '*';
                node.childNodes.forEach(walk);
                result += '*';
            } else if (tag === 'code') {
                result += '`' + node.textContent + '`';
            } else if (tag === 'pre') {
                result += '\n```\n' + node.textContent + '\n```\n';
            } else if (tag === 'a') {
                const href = node.getAttribute('href') || '';
                let inner = '';
                const prev = result;
                result = '';
                node.childNodes.forEach(walk);
                inner = result;
                result = prev;
                result += '[' + inner + '](' + href + ')';
            } else if (tag === 'hr') {
                result += '\n---\n';
            } else {
                node.childNodes.forEach(walk);
            }
        }
    }
    tmp.childNodes.forEach(walk);
    result = result.replace(/\n{3,}/g, '\n\n').trim();

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

// ===== Init =====
initLock();
renderHistory();

})();
/**
 * Phone Enhanced Plugin v1.2.0
 * 手机增强插件 - 为 Abstract 外置手机添加以下功能：
 *   1. 表情包 / 角色图片：添加时支持本地文件上传（名称即识别描述，自动注入提示词）
 *   2. 头像 / 背景 / 手机屏幕背景：图片选择弹窗支持本地文件上传
 *   3. 手机首页向左滑动到无 APP 界面观看壁纸
 *   4. 壁纸支持本地文件添加 / 删除 / 切换
 *   5. 手机首页注入"公司管理"APP图标，点击打开公司管理器面板
 *
 * 兼容：Abstract 外置手机 + 酒馆助手 (Tauri/浏览器)
 * v1.2.0: 新增公司管理APP入口
 */
(function () {
    'use strict';
    var VAR_WALLPAPERS = 'phone_enhanced_wallpapers';
    var VAR_WALLPAPER_IDX = 'phone_enhanced_wallpaper_idx';
    var STYLE_ID = 'phone-enhanced-style';
    var WP_PAGE_ID = 'phone-enhanced-wp-page';
    var WP_MGR_ID = 'phone-enhanced-wp-manager';
    var WP_DOT_ID = 'phone-enhanced-wp-dot';
    var UPLOAD_ATTR = 'data-pe-upload-injected';
    var INIT_FLAG = 'phone-enhanced-initialized';
    var phoneCtx = null;
    var wallpapers = [];
    var wpIndex = 0;
    var currentPage = 0;
    var dragState = null;
    var wpPageEl = null;
    var contentArea = null;
    var clockTimer = null;
    var navTimer = null;
    var initCount = 0;
    function getPhoneRoot() {
        var docs = [];
        var seen = {};
        function tryAdd(doc) {
            if (doc && doc.body && !seen[doc.URL || doc.location?.href]) { seen[doc.URL || doc.location?.href] = true; docs.push(doc); }
        }
        tryAdd(document);
        try { tryAdd(window.parent.document); } catch (e) { }
        try { tryAdd(window.top.document); } catch (e) { }
        for (var d = 0; d < docs.length; d++) {
            var doc = docs[d];
            try {
                var hosts = doc.querySelectorAll('[id^="improved-phone-shadow-host-"]');
                for (var i = 0; i < hosts.length; i++) { if (hosts[i].shadowRoot) return { doc: doc, root: hosts[i].shadowRoot }; }
            } catch (e) { }
            try {
                var all = doc.querySelectorAll('*');
                for (var j = 0; j < all.length; j++) {
                    var sr = all[j].shadowRoot;
                    if (sr && sr.querySelector && sr.querySelector('.phone-container')) return { doc: doc, root: sr };
                }
            } catch (e) { }
        }
        return null;
    }
    function getVarFn(name) {
        if (typeof window[name] === 'function') return window[name];
        try { if (window.tavern_helper && typeof window.tavern_helper[name] === 'function') return window.tavern_helper[name]; } catch (e) { }
        try { if (window.TavernHelper && typeof window.TavernHelper[name] === 'function') return window.TavernHelper[name]; } catch (e) { }
        try { for (var key in window) { try { var obj = window[key]; if (obj && typeof obj === 'object' && typeof obj[name] === 'function') return obj[name]; } catch (e) { } } } catch (e) { }
        return null;
    }
    function getVar(key, defaultVal) {
        try { var fn = getVarFn('getVariables'); if (fn) { var v = fn({ type: 'character' }); if (v && key in v) return v[key]; } } catch (e) { console.warn('[PhoneEnhanced] 读取变量失败:', key, e); }
        return defaultVal;
    }
    function setVar(key, value) {
        try { var fn = getVarFn('insertOrAssignVariables'); if (fn) { var obj = {}; obj[key] = value; fn(obj, { type: 'character' }); return true; } } catch (e) { console.error('[PhoneEnhanced] 写入变量失败:', key, e); }
        return false;
    }
    function showToast(msg, isError) {
        try { if (typeof toastr !== 'undefined' && toastr) { if (isError) toastr.error(msg); else toastr.success(msg); return; } } catch (e) { }
        console.log('[PhoneEnhanced]' + (isError ? ' [错误]' : ''), msg);
    }
    function fileToDataUrl(file, maxDim, quality) {
        return new Promise(function (resolve, reject) {
            if (!file) { reject(new Error('未选择文件')); return; }
            if (!file.type || file.type.indexOf('image/') !== 0) { reject(new Error('请选择图片文件')); return; }
            if (file.type === 'image/gif') { var readerGif = new FileReader(); readerGif.onload = function () { resolve(String(readerGif.result || '')); }; readerGif.onerror = function () { reject(new Error('读取 GIF 失败')); }; readerGif.readAsDataURL(file); return; }
            var reader = new FileReader();
            reader.onload = function (e) {
                var originalDataUrl = String(e.target && e.target.result || '');
                var img = new Image();
                img.onload = function () {
                    try {
                        var w = img.naturalWidth || img.width; var h = img.naturalHeight || img.height; var scale = 1;
                        if (maxDim && (w > maxDim || h > maxDim)) scale = Math.min(maxDim / w, maxDim / h);
                        var canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(w * scale)); canvas.height = Math.max(1, Math.round(h * scale));
                        var ctx2d = canvas.getContext('2d'); if (!ctx2d) { resolve(originalDataUrl); return; }
                        if (file.type === 'image/png') {
                            ctx2d.clearRect(0, 0, canvas.width, canvas.height); ctx2d.drawImage(img, 0, 0, canvas.width, canvas.height);
                            var pngUrl = canvas.toDataURL('image/png');
                            if (pngUrl.length > 2 * 1024 * 1024) { ctx2d.fillStyle = '#ffffff'; ctx2d.fillRect(0, 0, canvas.width, canvas.height); ctx2d.drawImage(img, 0, 0, canvas.width, canvas.height); resolve(canvas.toDataURL('image/jpeg', quality || 0.85)); }
                            else { resolve(pngUrl); }
                        } else { ctx2d.drawImage(img, 0, 0, canvas.width, canvas.height); resolve(canvas.toDataURL('image/jpeg', quality || 0.85)); }
                    } catch (err) { console.warn('[PhoneEnhanced] 图片压缩失败，使用原图:', err); resolve(originalDataUrl); }
                };
                img.onerror = function () { reject(new Error('图片加载失败，可能格式不支持')); }; img.src = originalDataUrl;
            };
            reader.onerror = function () { reject(new Error('读取文件失败')); }; reader.readAsDataURL(file);
        });
    }
    function setVueInputValue(input, value) {
        if (!input) return;
        var doc = input.ownerDocument || document; var win = doc.defaultView || window;
        var proto = input.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement : win.HTMLInputElement;
        var setter = null; try { setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set; } catch (e) { }
        if (setter) { setter.call(input, value); } else { input.value = value; }
        try { input.dispatchEvent(new win.Event('input', { bubbles: true })); input.dispatchEvent(new win.Event('change', { bubbles: true })); }
        catch (e) { input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    function pickImageFile(multiple, callback) {
        if (!phoneCtx) return;
        var doc = phoneCtx.doc;
        var input = doc.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.multiple = !!multiple;
        input.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none;z-index:99999;';
        input.addEventListener('change', function (e) { var files = e.target && e.target.files; if (!files || files.length === 0) return; try { callback(Array.prototype.slice.call(files)); } catch (err) { console.error('[PhoneEnhanced] 文件回调异常:', err); showToast('处理文件时出错', true); } });
        var container = phoneCtx.root.querySelector('.phone-container');
        if (container) { container.appendChild(input); } else { doc.body.appendChild(input); }
        setTimeout(function () { try { input.click(); } catch (e) { console.warn('[PhoneEnhanced] 文件选择器打开失败:', e); } }, 10);
        setTimeout(function () { if (input.parentNode) input.parentNode.removeChild(input); }, 120000);
    }
    function injectStyle() {
        if (!phoneCtx) return;
        if (phoneCtx.root.getElementById(STYLE_ID)) return;
        var style = phoneCtx.doc.createElement('style'); style.id = STYLE_ID;
        style.textContent = [
            '.pe-upload-btn{display:inline-flex!important;align-items:center;justify-content:center;gap:4px;padding:8px 12px!important;border:1px dashed #8fb8ed!important;border-radius:8px!important;background:rgba(143,184,237,0.08)!important;color:#5b8def!important;font-size:12px!important;cursor:pointer!important;transition:all .2s!important;margin:4px 0!important;font-family:inherit!important;box-sizing:border-box!important;-webkit-appearance:none!important;}',
            '.pe-upload-btn:active{transform:scale(0.97);background:rgba(143,184,237,0.18)!important;}',
            '.pe-upload-btn i{font-size:12px!important;}',
            '#' + WP_PAGE_ID + '{position:absolute;top:0;left:0;width:100%;height:100%;background-size:cover;background-position:center;background-repeat:no-repeat;z-index:50;transform:translateX(100%);transition:transform .3s ease;pointer-events:none;display:flex;flex-direction:column;}',
            '#' + WP_PAGE_ID + '.pe-wp-active{pointer-events:auto;}',
            '#' + WP_PAGE_ID + '.pe-wp-dragging{transition:none;}',
            '.pe-wp-top{display:flex;justify-content:flex-end;align-items:center;padding:40px 12px 8px;flex-shrink:0;background:linear-gradient(180deg,rgba(0,0,0,0.25),transparent);}',
            '.pe-wp-btn{width:34px;height:34px;border-radius:50%;border:none;cursor:pointer;background:rgba(0,0,0,0.35);color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,0.15);transition:all .2s;margin-left:8px;flex-shrink:0;-webkit-appearance:none;}',
            '.pe-wp-btn:active{transform:scale(0.92);}',
            '.pe-wp-center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,0.6);pointer-events:none;}',
            '.pe-wp-clock{font-size:56px;font-weight:200;line-height:1.1;}',
            '.pe-wp-date{font-size:15px;opacity:0.9;margin-top:4px;}',
            '.pe-wp-hint{position:absolute;bottom:30px;left:0;right:0;text-align:center;color:rgba(255,255,255,0.7);font-size:11px;text-shadow:0 1px 4px rgba(0,0,0,0.6);}',
            '.pe-wp-empty{font-size:13px;color:rgba(255,255,255,0.8);text-align:center;padding:20px;text-shadow:0 1px 4px rgba(0,0,0,0.6);}',
            '#' + WP_DOT_ID + '{position:absolute;bottom:6px;left:50%;transform:translateX(-50%);z-index:60;display:flex;gap:5px;pointer-events:none;}',
            '.pe-dot{width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,0.4);transition:all .2s;box-shadow:0 1px 2px rgba(0,0,0,0.4);}',
            '.pe-dot.pe-dot-active{background:#fff;width:14px;border-radius:3px;}',
            '.pe-wp-mgr{position:absolute;inset:0;z-index:9999;background:#f0f2f5;display:flex;flex-direction:column;border-radius:28px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}',
            '.pe-wp-mgr-header{display:flex;align-items:center;padding:38px 12px 8px;background:#fff;border-bottom:1px solid #e8e8e8;flex-shrink:0;}',
            '.pe-wp-mgr-title{flex:1;text-align:center;font-size:16px;font-weight:600;color:#333;}',
            '.pe-wp-mgr-body{flex:1;overflow-y:auto;padding:12px;-webkit-overflow-scrolling:touch;}',
            '.pe-wp-mgr-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;}',
            '.pe-wp-thumb{position:relative;aspect-ratio:9/16;border-radius:10px;overflow:hidden;cursor:pointer;border:2px solid transparent;background:#ddd;}',
            '.pe-wp-thumb.pe-wp-current{border-color:#667eea;box-shadow:0 0 0 2px rgba(102,126,234,0.3);}',
            '.pe-wp-thumb img{width:100%;height:100%;object-fit:cover;pointer-events:none;}',
            '.pe-wp-thumb-del{position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;background:rgba(0,0,0,0.55);color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:11px;z-index:2;-webkit-appearance:none;}',
            '.pe-wp-thumb-del:active{background:rgba(0,0,0,0.75);}',
            '.pe-wp-thumb-add{aspect-ratio:9/16;border-radius:10px;border:2px dashed #c0c0c0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#999;cursor:pointer;background:#fafafa;gap:4px;font-size:11px;}',
            '.pe-wp-thumb-add:active{background:#f0f0f0;}',
            '.pe-wp-mgr-footer{padding:10px 12px;background:#fff;border-top:1px solid #e8e8e8;flex-shrink:0;}',
            '.pe-wp-mgr-add-btn{width:100%;padding:12px;border:none;border-radius:10px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;font-size:14px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;-webkit-appearance:none;}',
            '.pe-wp-mgr-add-btn:active{opacity:0.85;}',
            '.content-area.pe-wp-sliding{transition:transform .3s ease;}',
            '.content-area.pe-wp-dragging{transition:none;}'
        ].join('\n');
        phoneCtx.root.appendChild(style);
    }
    function bindUploadButton(btn, urlInput, maxDim, successMsg) {
        btn.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            var originalHTML = btn.innerHTML;
            pickImageFile(false, function (files) {
                if (!files || !files[0]) return;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>处理中...</span>';
                fileToDataUrl(files[0], maxDim || 512, 0.85).then(function (dataUrl) {
                    setVueInputValue(urlInput, dataUrl); showToast(successMsg || '图片已上传，请填写名称（识别描述）');
                    btn.innerHTML = '<i class="fas fa-check"></i><span>已上传</span>'; setTimeout(function () { btn.innerHTML = originalHTML; }, 2000);
                }).catch(function (err) { showToast(err.message || '上传失败', true); btn.innerHTML = originalHTML; });
            });
        });
    }
    function injectDialogUploadButtons() {
        if (!phoneCtx) return;
        var root = phoneCtx.root;
        var urlInputs = root.querySelectorAll('input[placeholder="输入表情包图片链接"], input[placeholder="输入图片链接"]');
        for (var i = 0; i < urlInputs.length; i++) {
            var urlInput = urlInputs[i]; var dialog = urlInput.closest('.dialog-overlay');
            if (!dialog) continue; if (dialog.getAttribute(UPLOAD_ATTR)) continue;
            var dialogTitle = dialog.querySelector('.dialog-title, span'); var titleText = dialogTitle ? dialogTitle.textContent : '';
            if (titleText.indexOf('编辑') !== -1) continue;
            dialog.setAttribute(UPLOAD_ATTR, '1');
            var inputWrapper = urlInput.parentElement; if (!inputWrapper) continue;
            var uploadBtn = phoneCtx.doc.createElement('button'); uploadBtn.type = 'button'; uploadBtn.className = 'pe-upload-btn';
            uploadBtn.innerHTML = '<i class="fas fa-folder-open"></i><span>本地上传图片</span>';
            bindUploadButton(uploadBtn, urlInput, 512, '图片已上传，请填写名称（识别描述）');
            if (inputWrapper.nextSibling) { inputWrapper.parentNode.insertBefore(uploadBtn, inputWrapper.nextSibling); } else { inputWrapper.parentNode.appendChild(uploadBtn); }
        }
    }
    function injectImagePickerUpload() {
        if (!phoneCtx) return;
        var root = phoneCtx.root;
        var pickerModals = root.querySelectorAll('.image-picker-modal');
        for (var i = 0; i < pickerModals.length; i++) {
            var modal = pickerModals[i]; if (modal.getAttribute(UPLOAD_ATTR)) continue;
            modal.setAttribute(UPLOAD_ATTR, '1');
            var inputRow = modal.querySelector('.image-picker-input-row'); var urlInput = modal.querySelector('.image-picker-input');
            if (!inputRow || !urlInput) continue;
            var uploadBtn = phoneCtx.doc.createElement('button'); uploadBtn.type = 'button'; uploadBtn.className = 'pe-upload-btn';
            uploadBtn.style.width = '44px'; uploadBtn.style.flexShrink = '0'; uploadBtn.innerHTML = '<i class="fas fa-folder-open"></i>'; uploadBtn.title = '本地上传';
            bindUploadButton(uploadBtn, urlInput, 800, '图片已上传，点击 ✓ 应用'); inputRow.appendChild(uploadBtn);
        }
        var urlModals = root.querySelectorAll('.url-input-modal');
        for (var j = 0; j < urlModals.length; j++) {
            var umodal = urlModals[j]; if (umodal.getAttribute(UPLOAD_ATTR)) continue;
            umodal.setAttribute(UPLOAD_ATTR, '1');
            var uInput = umodal.querySelector('.url-input-field'); var uBody = umodal.querySelector('.url-input-body');
            if (!uInput || !uBody) continue;
            var uBtn = phoneCtx.doc.createElement('button'); uBtn.type = 'button'; uBtn.className = 'pe-upload-btn';
            uBtn.innerHTML = '<i class="fas fa-folder-open"></i><span>本地上传图片</span>';
            bindUploadButton(uBtn, uInput, 800, '图片已上传，点击确认添加到图片库'); uBody.appendChild(uBtn);
        }
    }
    function loadWallpapers() {
        wallpapers = getVar(VAR_WALLPAPERS, []); if (!Array.isArray(wallpapers)) wallpapers = [];
        wpIndex = getVar(VAR_WALLPAPER_IDX, 0); if (typeof wpIndex !== 'number' || wpIndex < 0 || wpIndex >= wallpapers.length) wpIndex = 0;
    }
    function saveWallpapers() { setVar(VAR_WALLPAPERS, wallpapers); setVar(VAR_WALLPAPER_IDX, wpIndex); }
    function applyWallpaper() {
        if (!phoneCtx) return;
        var root = phoneCtx.root; var styleId = 'pe-wallpaper-style';
        var existing = root.getElementById(styleId); if (existing) existing.remove();
        var oldStyle = root.getElementById('startup-wallpaper-style'); if (oldStyle) oldStyle.remove();
        if (!wallpapers.length || !wallpapers[wpIndex]) { updateWpDot(); return; }
        var url = wallpapers[wpIndex];
        var style = phoneCtx.doc.createElement('style'); style.id = styleId;
        style.textContent = '.phone-container, .phone-home, .phone-lock-screen {background-image: url("' + url + '") !important;background-size: cover !important;background-position: center !important;background-repeat: no-repeat !important;}' +
            '.phone-container::before {content: "" !important; position: absolute !important; inset: 0 !important;background: rgba(0,0,0,0.12) !important; z-index: 0 !important; pointer-events: none !important;}' +
            '.app-block span, .phone-time, .phone-date, .status-time {text-shadow: 0 1px 4px rgba(0,0,0,0.6) !important;}';
        root.appendChild(style);
        if (wpPageEl) { wpPageEl.style.backgroundImage = 'url("' + url + '")'; }
        var oldBtn = root.getElementById('wallpaper-toggle-btn'); if (oldBtn) oldBtn.remove();
        updateWpDot();
    }
    function updateWpClock() {
        if (!wpPageEl) return;
        var clockEl = wpPageEl.querySelector('.pe-wp-clock'); var dateEl = wpPageEl.querySelector('.pe-wp-date');
        if (!clockEl || !dateEl) return;
        var now = new Date(); var h = String(now.getHours()).padStart(2, '0'); var m = String(now.getMinutes()).padStart(2, '0');
        var weekDays = ['日', '一', '二', '三', '四', '五', '六'];
        clockEl.textContent = h + ':' + m; dateEl.textContent = (now.getMonth() + 1) + '月' + now.getDate() + '日 星期' + weekDays[now.getDay()];
    }
    function updateWpDot() {
        if (!phoneCtx) return;
        var root = phoneCtx.root; var phoneContainer = root.querySelector('.phone-container');
        if (!phoneContainer) return;
        var dot = root.getElementById(WP_DOT_ID);
        if (!wallpapers.length) { if (dot) dot.style.display = 'none'; return; }
        if (!dot) { dot = phoneCtx.doc.createElement('div'); dot.id = WP_DOT_ID; dot.innerHTML = '<div class="pe-dot pe-dot-active" data-page="0"></div><div class="pe-dot" data-page="1"></div>'; phoneContainer.appendChild(dot); }
        dot.style.display = 'flex';
        var dots = dot.querySelectorAll('.pe-dot');
        for (var i = 0; i < dots.length; i++) { if (parseInt(dots[i].getAttribute('data-page')) === currentPage) { dots[i].classList.add('pe-dot-active'); } else { dots[i].classList.remove('pe-dot-active'); } }
    }
    function createWallpaperPage() {
        if (!phoneCtx) return;
        var root = phoneCtx.root; var phoneContainer = root.querySelector('.phone-container');
        if (!phoneContainer) return;
        if (root.getElementById(WP_PAGE_ID)) { wpPageEl = root.getElementById(WP_PAGE_ID); return; }
        var page = phoneCtx.doc.createElement('div'); page.id = WP_PAGE_ID;
        page.innerHTML = '<div class="pe-wp-top"><button class="pe-wp-btn pe-wp-manage-btn" title="管理壁纸"><i class="fas fa-images"></i></button></div>' +
            '<div class="pe-wp-center"><div class="pe-wp-clock">--:--</div><div class="pe-wp-date">--</div></div>' +
            '<div class="pe-wp-hint"><i class="fas fa-chevron-right" style="font-size:10px;"></i> 向右滑动返回</div>';
        phoneContainer.appendChild(page); wpPageEl = page;
        var manageBtn = page.querySelector('.pe-wp-manage-btn');
        if (manageBtn) { manageBtn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); openWallpaperManager(); }); }
        updateWpClock(); if (clockTimer) clearInterval(clockTimer); clockTimer = setInterval(updateWpClock, 10000);
    }
    function goToWallpaperPage() {
        if (!phoneCtx || !wpPageEl || !contentArea) return;
        currentPage = 1; contentArea.classList.add('pe-wp-sliding'); contentArea.style.transform = 'translateX(-100%)';
        wpPageEl.classList.add('pe-wp-active'); wpPageEl.classList.remove('pe-wp-dragging'); wpPageEl.style.transform = 'translateX(0)';
        updateWpClock(); updateWpDot();
    }
    function goToHomePage() {
        if (!phoneCtx || !wpPageEl || !contentArea) return;
        currentPage = 0; contentArea.classList.add('pe-wp-sliding'); contentArea.style.transform = 'translateX(0)';
        wpPageEl.classList.remove('pe-wp-active'); wpPageEl.classList.remove('pe-wp-dragging'); wpPageEl.style.transform = 'translateX(100%)';
        updateWpDot();
    }
    function openWallpaperManager() {
        if (!phoneCtx) return;
        var root = phoneCtx.root; var phoneContainer = root.querySelector('.phone-container');
        if (!phoneContainer) return;
        var existing = root.getElementById(WP_MGR_ID); if (existing) existing.remove();
        var mgr = phoneCtx.doc.createElement('div'); mgr.id = WP_MGR_ID; mgr.className = 'pe-wp-mgr'; phoneContainer.appendChild(mgr);
        function render() {
            var thumbsHtml = '<div class="pe-wp-thumb-add" data-action="add"><i class="fas fa-plus" style="font-size:20px;"></i><span>添加壁纸</span></div>';
            for (var i = 0; i < wallpapers.length; i++) {
                var isCur = (i === wpIndex);
                thumbsHtml += '<div class="pe-wp-thumb' + (isCur ? ' pe-wp-current' : '') + '" data-idx="' + i + '"><img src="' + wallpapers[i] + '" alt="壁纸' + (i + 1) + '">' + (isCur ? '' : '<button class="pe-wp-thumb-del" data-del="' + i + '" title="删除"><i class="fas fa-times"></i></button>') + '</div>';
            }
            mgr.innerHTML = '<div class="pe-wp-mgr-header"><button class="pe-wp-btn pe-wp-mgr-back" title="返回"><i class="fas fa-chevron-left"></i></button><div class="pe-wp-mgr-title">壁纸管理（' + wallpapers.length + '张）</div><div style="width:34px;flex-shrink:0;"></div></div>' +
                '<div class="pe-wp-mgr-body"><div class="pe-wp-mgr-grid">' + thumbsHtml + '</div>' + (wallpapers.length === 0 ? '<div class="pe-wp-empty">暂无壁纸，点击上方"+"添加本地图片</div>' : '') + '</div>' +
                '<div class="pe-wp-mgr-footer"><button class="pe-wp-mgr-add-btn" data-action="add2"><i class="fas fa-upload"></i> 从本地添加壁纸</button></div>';
            mgr.querySelector('.pe-wp-mgr-back').addEventListener('click', function () { mgr.remove(); });
            var addEls = mgr.querySelectorAll('[data-action="add"], [data-action="add2"]');
            for (var k = 0; k < addEls.length; k++) { addEls[k].addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); addWallpapersFromLocal(); }); }
            var thumbEls = mgr.querySelectorAll('.pe-wp-thumb');
            for (var j = 0; j < thumbEls.length; j++) { thumbEls[j].addEventListener('click', function (e) { if (e.target.closest('.pe-wp-thumb-del')) return; var idx = parseInt(this.getAttribute('data-idx')); if (!isNaN(idx)) { wpIndex = idx; saveWallpapers(); applyWallpaper(); render(); showToast('壁纸已切换'); } }); }
            var delEls = mgr.querySelectorAll('.pe-wp-thumb-del');
            for (var d = 0; d < delEls.length; d++) { delEls[d].addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); var idx = parseInt(this.getAttribute('data-del')); if (isNaN(idx)) return; wallpapers.splice(idx, 1); if (wpIndex >= wallpapers.length) wpIndex = Math.max(0, wallpapers.length - 1); saveWallpapers(); applyWallpaper(); render(); showToast('壁纸已删除'); }); }
        }
        function addWallpapersFromLocal() {
            pickImageFile(true, function (files) {
                if (!files || !files.length) return;
                var addBtn = mgr.querySelector('.pe-wp-mgr-add-btn'); var originalHTML = addBtn ? addBtn.innerHTML : '';
                if (addBtn) addBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 处理中...';
                var promises = files.map(function (f) { return fileToDataUrl(f, 1080, 0.85).catch(function (err) { console.warn('[PhoneEnhanced] 图片处理失败:', f.name, err); return null; }); });
                Promise.all(promises).then(function (results) {
                    var added = 0; for (var i = 0; i < results.length; i++) { if (results[i]) { wallpapers.push(results[i]); added++; } }
                    if (added > 0) { if (wallpapers.length === added) wpIndex = 0; saveWallpapers(); applyWallpaper(); render(); showToast('成功添加 ' + added + ' 张壁纸'); }
                    else { if (addBtn) addBtn.innerHTML = originalHTML; showToast('没有成功添加的图片', true); }
                });
            });
        }
        render();
    }
    function getActiveApp() {
        if (!phoneCtx) return null;
        var homeScreen = phoneCtx.root.querySelector('.app-home-screen');
        if (homeScreen) { try { var style = phoneCtx.doc.defaultView.getComputedStyle(homeScreen); if (style && style.display !== 'none') return 'home'; } catch (e) { } }
        return null;
    }
    function setupSwipe() {
        if (!phoneCtx) return;
        var phoneContainer = phoneCtx.root.querySelector('.phone-container');
        if (!phoneContainer) return;
        if (phoneContainer.getAttribute('data-pe-swipe')) return;
        phoneContainer.setAttribute('data-pe-swipe', '1');
        contentArea = phoneCtx.root.querySelector('.content-area');
        var SWIPE_THRESHOLD = 50; var MOVE_THRESHOLD = 8;
        function getPoint(e) { if (e.touches && e.touches.length) return e.touches[0]; if (e.changedTouches && e.changedTouches.length) return e.changedTouches[0]; return e; }
        function shouldHandleSwipe() { if (currentPage === 1) return true; if (currentPage === 0) return getActiveApp() === 'home'; return false; }
        function onStart(e) { if (!contentArea || !wpPageEl) return; if (!shouldHandleSwipe()) return; if (phoneCtx.root.getElementById(WP_MGR_ID)) return; var p = getPoint(e); dragState = { startX: p.clientX, startY: p.clientY, currentX: p.clientX, currentY: p.clientY, locked: null }; }
        function onMove(e) {
            if (!dragState || !contentArea || !wpPageEl) return;
            var p = getPoint(e); dragState.currentX = p.clientX; dragState.currentY = p.clientY;
            var dx = dragState.currentX - dragState.startX; var dy = dragState.currentY - dragState.startY;
            if (!dragState.locked) { if (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD) { dragState.locked = (Math.abs(dx) > Math.abs(dy)) ? 'horizontal' : 'vertical'; } }
            if (dragState.locked !== 'horizontal') return;
            if (e.cancelable) { try { e.preventDefault(); } catch (e2) { } }
            var containerWidth = phoneContainer.offsetWidth || 360; var percent = (dx / containerWidth) * 100;
            if (currentPage === 0 && dx < 0) { contentArea.classList.add('pe-wp-dragging'); wpPageEl.classList.add('pe-wp-dragging', 'pe-wp-active'); contentArea.style.transform = 'translateX(' + Math.max(-100, percent) + '%)'; wpPageEl.style.transform = 'translateX(' + Math.min(100, 100 + percent) + '%)'; }
            else if (currentPage === 1 && dx > 0) { contentArea.classList.add('pe-wp-dragging'); wpPageEl.classList.add('pe-wp-dragging'); contentArea.style.transform = 'translateX(' + Math.max(-100, -100 + percent) + '%)'; wpPageEl.style.transform = 'translateX(' + Math.min(100, percent) + '%)'; }
        }
        function onEnd() {
            if (!dragState || !contentArea || !wpPageEl) { dragState = null; return; }
            if (dragState.locked !== 'horizontal') { dragState = null; return; }
            var dx = dragState.currentX - dragState.startX;
            contentArea.classList.remove('pe-wp-dragging'); wpPageEl.classList.remove('pe-wp-dragging');
            if (currentPage === 0 && dx < -SWIPE_THRESHOLD) { goToWallpaperPage(); }
            else if (currentPage === 1 && dx > SWIPE_THRESHOLD) { goToHomePage(); }
            else { if (currentPage === 0) goToHomePage(); else goToWallpaperPage(); }
            dragState = null;
        }
        phoneContainer.addEventListener('touchstart', onStart, { passive: true });
        phoneContainer.addEventListener('touchmove', onMove, { passive: false });
        phoneContainer.addEventListener('touchend', onEnd, { passive: true });
        phoneContainer.addEventListener('touchcancel', onEnd, { passive: true });
        var mouseDown = false;
        phoneContainer.addEventListener('mousedown', function (e) { if (e.target.closest('button, input, a, textarea, select, .app-block, .bottom-bar .app, .pe-wp-thumb, .pe-wp-mgr, [data-custom-app], .nav-btn, .clickable')) return; mouseDown = true; onStart(e); });
        var doc = phoneCtx.doc;
        doc.addEventListener('mousemove', function (e) { if (!mouseDown) return; onMove(e); });
        doc.addEventListener('mouseup', function () { if (!mouseDown) return; mouseDown = false; onEnd(); });
    }
    function watchNavigation() {
        if (!phoneCtx) return;
        if (navTimer) clearInterval(navTimer);
        var root = phoneCtx.root;
        navTimer = setInterval(function () { if (currentPage === 1) { var homeScreen = root.querySelector('.app-home-screen'); if (homeScreen) { try { var style = phoneCtx.doc.defaultView.getComputedStyle(homeScreen); if (style && style.display === 'none') { goToHomePage(); } } catch (e) { } } } }, 500);
    }
    function injectCompanyApp() {
        if (!phoneCtx) return;
        var root = phoneCtx.root;
        if (root.getElementById('pe-company-app')) return;
        var sampleApp = root.querySelector('.app-block');
        if (!sampleApp) return;
        var appContainer = sampleApp.parentNode;
        if (!appContainer) return;
        if (!root.getElementById('pe-company-app-style')) {
            var style = phoneCtx.doc.createElement('style'); style.id = 'pe-company-app-style';
            style.textContent = '.pe-company-app{display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;}' +
                '.pe-company-app-icon{width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;color:#fff;font-size:20px;box-shadow:0 2px 8px rgba(102,126,234,0.35);}' +
                '.pe-company-app-label{font-size:10px;color:#333;text-align:center;margin-top:2px;}' +
                '.pe-company-app:active .pe-company-app-icon{transform:scale(0.92);}';
            root.appendChild(style);
        }
        var app = phoneCtx.doc.createElement('div'); app.id = 'pe-company-app'; app.className = 'app-block pe-company-app';
        app.innerHTML = '<div class="pe-company-app-icon"><i class="fas fa-building"></i></div><span class="pe-company-app-label">公司管理</span>';
        app.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            var fn = window.openCM || window.cmOpen || window.openCompanyManager || window.toggleCompanyManager;
            if (typeof fn === 'function') { fn(); return; }
            if (window.companyManager && typeof window.companyManager.open === 'function') { window.companyManager.open(); return; }
            setTimeout(function () { var fn2 = window.openCM || window.cmOpen || window.openCompanyManager; if (typeof fn2 === 'function') fn2(); }, 800);
        });
        appContainer.appendChild(app);
    }
    function init() {
        try {
            initCount++;
            var newCtx = getPhoneRoot();
            if (!newCtx) return;
            var ctxChanged = (!phoneCtx || phoneCtx.root !== newCtx.root);
            phoneCtx = newCtx;
            if (contentArea && !contentArea.isConnected) contentArea = null;
            if (ctxChanged || !wpPageEl || !wpPageEl.isConnected) { injectStyle(); loadWallpapers(); createWallpaperPage(); applyWallpaper(); setupSwipe(); watchNavigation(); console.log('[PhoneEnhanced] 插件已加载 v1.2.0 (尝试次数: ' + initCount + ')'); }
            injectDialogUploadButtons(); injectImagePickerUpload(); injectCompanyApp();
        } catch (e) { console.error('[PhoneEnhanced] 初始化异常:', e); }
    }
    function start() {
        init();
        var attempts = [300, 800, 1500, 2500, 4000, 6000, 10000];
        for (var i = 0; i < attempts.length; i++) { (function (delay) { setTimeout(init, delay); })(attempts[i]); }
        setInterval(init, 2000);
        try {
            var docs = []; var seen = {};
            function tryAdd(doc) { if (doc && doc.body && !seen[doc.URL || doc.location?.href]) { seen[doc.URL || doc.location?.href] = true; docs.push(doc); } }
            tryAdd(document); try { tryAdd(window.parent.document); } catch (e) { } try { tryAdd(window.top.document); } catch (e) { }
            for (var d = 0; d < docs.length; d++) { new MutationObserver(function () { init(); }).observe(docs[d].body, { childList: true, subtree: true }); }
        } catch (e) { console.warn('[PhoneEnhanced] MutationObserver 初始化失败:', e); }
    }
    if (window[INIT_FLAG]) { console.log('[PhoneEnhanced] 插件已初始化，跳过重复加载'); return; }
    window[INIT_FLAG] = true;
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', start); } else { start(); }
})();
/**
 * Phone Enhanced Plugin v1.1.0
 * 手机增强插件 - 为 Abstract 外置手机添加以下功能：
 *   1. 表情包 / 角色图片：添加时支持本地文件上传（名称即识别描述，自动注入提示词）
 *   2. 头像 / 背景 / 手机屏幕背景：图片选择弹窗支持本地文件上传
 *   3. 手机首页向左滑动到无 APP 界面观看壁纸
 *   4. 壁纸支持本地文件添加 / 删除 / 切换
 *
 * 兼容：Abstract 外置手机 + 酒馆助手 (Tauri/浏览器)
 * v1.1.0: 增强 Tauri 桌面端兼容性，修复变量函数检测，优化 ShadowRoot 查找，防重复初始化
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

    var phoneCtx = null, wallpapers = [], wpIndex = 0, currentPage = 0, dragState = null;
    var wpPageEl = null, contentArea = null, clockTimer = null, navTimer = null, initCount = 0;

    function getPhoneRoot() {
        var docs = [], seen = {};
        function add(d) { if (d && d.body && !seen[d.URL||d.location&&d.location.href]) { seen[d.URL||d.location&&d.location.href]=true; docs.push(d); } }
        add(document);
        try { add(window.parent.document); } catch(e) {}
        try { add(window.top.document); } catch(e) {}
        for (var d=0; d<docs.length; d++) {
            var doc = docs[d];
            try {
                var hosts = doc.querySelectorAll('[id^="improved-phone-shadow-host-"]');
                for (var i=0; i<hosts.length; i++) { if (hosts[i].shadowRoot) return {doc:doc, root:hosts[i].shadowRoot}; }
            } catch(e) {}
            try {
                var all = doc.querySelectorAll('*');
                for (var j=0; j<all.length; j++) {
                    var sr = all[j].shadowRoot;
                    if (sr && sr.querySelector && sr.querySelector('.phone-container')) return {doc:doc, root:sr};
                }
            } catch(e) {}
        }
        return null;
    }

    function getVarFn(name) {
        if (typeof window[name] === 'function') return window[name];
        try { if (window.tavern_helper && typeof window.tavern_helper[name]==='function') return window.tavern_helper[name]; } catch(e) {}
        try { if (window.TavernHelper && typeof window.TavernHelper[name]==='function') return window.TavernHelper[name]; } catch(e) {}
        try { for (var k in window) { try { var o=window[k]; if (o&&typeof o==='object'&&typeof o[name]==='function') return o[name]; } catch(e){} } } catch(e) {}
        return null;
    }

    function getVar(key, def) {
        try { var fn=getVarFn('getVariables'); if (fn) { var v=fn({type:'character'}); if (v&&key in v) return v[key]; } } catch(e) { console.warn('[PE] getVar fail:',key,e); }
        return def;
    }

    function setVar(key, val) {
        try { var fn=getVarFn('insertOrAssignVariables'); if (fn) { var o={}; o[key]=val; fn(o,{type:'character'}); return true; } } catch(e) { console.error('[PE] setVar fail:',key,e); }
        return false;
    }

    function showToast(msg, err) {
        try { if (typeof toastr!=='undefined'&&toastr) { err?toastr.error(msg):toastr.success(msg); return; } } catch(e) {}
        console.log('[PE]'+(err?' [ERR]':''), msg);
    }

    function fileToDataUrl(file, maxDim, quality) {
        return new Promise(function(resolve, reject) {
            if (!file) { reject(new Error('未选择文件')); return; }
            if (!file.type||file.type.indexOf('image/')!==0) { reject(new Error('请选择图片文件')); return; }
            if (file.type==='image/gif') {
                var r=new FileReader(); r.onload=function(){resolve(String(r.result||''));}; r.onerror=function(){reject(new Error('读取GIF失败'));}; r.readAsDataURL(file); return;
            }
            var reader=new FileReader();
            reader.onload=function(e) {
                var orig=String(e.target&&e.target.result||'');
                var img=new Image();
                img.onload=function() {
                    try {
                        var w=img.naturalWidth||img.width, h=img.naturalHeight||img.height, scale=1;
                        if (maxDim&&(w>maxDim||h>maxDim)) scale=Math.min(maxDim/w,maxDim/h);
                        var cv=document.createElement('canvas'); cv.width=Math.max(1,Math.round(w*scale)); cv.height=Math.max(1,Math.round(h*scale));
                        var c=cv.getContext('2d'); if(!c){resolve(orig);return;}
                        if (file.type==='image/png') {
                            c.clearRect(0,0,cv.width,cv.height); c.drawImage(img,0,0,cv.width,cv.height);
                            var png=cv.toDataURL('image/png');
                            if (png.length>2*1024*1024) { c.fillStyle='#fff'; c.fillRect(0,0,cv.width,cv.height); c.drawImage(img,0,0,cv.width,cv.height); resolve(cv.toDataURL('image/jpeg',quality||0.85)); }
                            else resolve(png);
                        } else { c.drawImage(img,0,0,cv.width,cv.height); resolve(cv.toDataURL('image/jpeg',quality||0.85)); }
                    } catch(err) { console.warn('[PE] compress fail:',err); resolve(orig); }
                };
                img.onerror=function(){reject(new Error('图片加载失败'));}; img.src=orig;
            };
            reader.onerror=function(){reject(new Error('读取文件失败'));}; reader.readAsDataURL(file);
        });
    }

    function setVueInput(input, val) {
        if (!input) return;
        var doc=input.ownerDocument||document, win=doc.defaultView||window;
        var proto=input.tagName==='TEXTAREA'?win.HTMLTextAreaElement:win.HTMLInputElement, setter=null;
        try { setter=Object.getOwnPropertyDescriptor(proto.prototype,'value').set; } catch(e) {}
        if (setter) setter.call(input,val); else input.value=val;
        try { input.dispatchEvent(new win.Event('input',{bubbles:true})); input.dispatchEvent(new win.Event('change',{bubbles:true})); }
        catch(e) { input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); }
    }

    function pickFile(multiple, cb) {
        if (!phoneCtx) return;
        var doc=phoneCtx.doc, input=doc.createElement('input');
        input.type='file'; input.accept='image/*'; input.multiple=!!multiple;
        input.style.cssText='position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none;z-index:99999;';
        input.addEventListener('change', function(e) { var f=e.target&&e.target.files; if(!f||!f.length)return; try{cb(Array.prototype.slice.call(f));}catch(err){console.error('[PE] file cb err:',err);showToast('处理文件出错',true);} });
        var c=phoneCtx.root.querySelector('.phone-container'); if(c) c.appendChild(input); else doc.body.appendChild(input);
        setTimeout(function(){ try{input.click();}catch(e){console.warn('[PE] file picker fail:',e);} }, 10);
        setTimeout(function(){ if(input.parentNode) input.parentNode.removeChild(input); }, 120000);
    }

    function injectStyle() {
        if (!phoneCtx||phoneCtx.root.getElementById(STYLE_ID)) return;
        var s=phoneCtx.doc.createElement('style'); s.id=STYLE_ID;
        s.textContent=[
            '.pe-upload-btn{display:inline-flex!important;align-items:center;justify-content:center;gap:4px;padding:8px 12px!important;border:1px dashed #8fb8ed!important;border-radius:8px!important;background:rgba(143,184,237,0.08)!important;color:#5b8def!important;font-size:12px!important;cursor:pointer!important;transition:all .2s!important;margin:4px 0!important;font-family:inherit!important;box-sizing:border-box!important;-webkit-appearance:none!important;}',
            '.pe-upload-btn:active{transform:scale(0.97);background:rgba(143,184,237,0.18)!important;}',
            '#'+WP_PAGE_ID+'{position:absolute;top:0;left:0;width:100%;height:100%;background-size:cover;background-position:center;background-repeat:no-repeat;z-index:50;transform:translateX(100%);transition:transform .3s ease;pointer-events:none;display:flex;flex-direction:column;}',
            '#'+WP_PAGE_ID+'.pe-wp-active{pointer-events:auto;}',
            '#'+WP_PAGE_ID+'.pe-wp-dragging{transition:none;}',
            '.pe-wp-top{display:flex;justify-content:flex-end;align-items:center;padding:40px 12px 8px;flex-shrink:0;background:linear-gradient(180deg,rgba(0,0,0,0.25),transparent);}',
            '.pe-wp-btn{width:34px;height:34px;border-radius:50%;border:none;cursor:pointer;background:rgba(0,0,0,0.35);color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,0.15);transition:all .2s;margin-left:8px;flex-shrink:0;-webkit-appearance:none;}',
            '.pe-wp-btn:active{transform:scale(0.92);}',
            '.pe-wp-center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,0.6);pointer-events:none;}',
            '.pe-wp-clock{font-size:56px;font-weight:200;line-height:1.1;}',
            '.pe-wp-date{font-size:15px;opacity:0.9;margin-top:4px;}',
            '.pe-wp-hint{position:absolute;bottom:30px;left:0;right:0;text-align:center;color:rgba(255,255,255,0.7);font-size:11px;text-shadow:0 1px 4px rgba(0,0,0,0.6);}',
            '#'+WP_DOT_ID+'{position:absolute;bottom:6px;left:50%;transform:translateX(-50%);z-index:60;display:flex;gap:5px;pointer-events:none;}',
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
            '.pe-wp-thumb-add{aspect-ratio:9/16;border-radius:10px;border:2px dashed #c0c0c0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#999;cursor:pointer;background:#fafafa;gap:4px;font-size:11px;}',
            '.pe-wp-mgr-footer{padding:10px 12px;background:#fff;border-top:1px solid #e8e8e8;flex-shrink:0;}',
            '.pe-wp-mgr-add-btn{width:100%;padding:12px;border:none;border-radius:10px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;font-size:14px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;-webkit-appearance:none;}',
            '.content-area.pe-wp-sliding{transition:transform .3s ease;}',
            '.content-area.pe-wp-dragging{transition:none;}'
        ].join('\n');
        phoneCtx.root.appendChild(s);
    }

    function bindUpload(btn, input, maxDim, msg) {
        btn.addEventListener('click', function(e) {
            e.preventDefault(); e.stopPropagation();
            var orig=btn.innerHTML;
            pickFile(false, function(files) {
                if(!files||!files[0]) return;
                btn.innerHTML='<i class="fas fa-spinner fa-spin"></i><span>处理中...</span>';
                fileToDataUrl(files[0], maxDim||512, 0.85).then(function(url) {
                    setVueInput(input, url); showToast(msg||'图片已上传，请填写名称（识别描述）');
                    btn.innerHTML='<i class="fas fa-check"></i><span>已上传</span>';
                    setTimeout(function(){btn.innerHTML=orig;},2000);
                }).catch(function(err) { showToast(err.message||'上传失败',true); btn.innerHTML=orig; });
            });
        });
    }

    function injectDialogBtns() {
        if (!phoneCtx) return;
        var inputs=phoneCtx.root.querySelectorAll('input[placeholder="输入表情包图片链接"], input[placeholder="输入图片链接"]');
        for (var i=0;i<inputs.length;i++) {
            var inp=inputs[i], dlg=inp.closest('.dialog-overlay');
            if(!dlg||dlg.getAttribute(UPLOAD_ATTR)) continue;
            var t=dlg.querySelector('.dialog-title,span'); if(t&&t.textContent.indexOf('编辑')!==-1) continue;
            dlg.setAttribute(UPLOAD_ATTR,'1');
            var wrap=inp.parentElement; if(!wrap) continue;
            var btn=phoneCtx.doc.createElement('button'); btn.type='button'; btn.className='pe-upload-btn';
            btn.innerHTML='<i class="fas fa-folder-open"></i><span>本地上传图片</span>';
            bindUpload(btn, inp, 512, '图片已上传，请填写名称（识别描述）');
            if(wrap.nextSibling) wrap.parentNode.insertBefore(btn, wrap.nextSibling); else wrap.parentNode.appendChild(btn);
        }
    }

    function injectPickerBtns() {
        if (!phoneCtx) return;
        var root=phoneCtx.root;
        var pickers=root.querySelectorAll('.image-picker-modal');
        for(var i=0;i<pickers.length;i++) {
            var m=pickers[i]; if(m.getAttribute(UPLOAD_ATTR)) continue;
            m.setAttribute(UPLOAD_ATTR,'1');
            var row=m.querySelector('.image-picker-input-row'), inp=m.querySelector('.image-picker-input');
            if(!row||!inp) continue;
            var b=phoneCtx.doc.createElement('button'); b.type='button'; b.className='pe-upload-btn';
            b.style.width='44px'; b.style.flexShrink='0'; b.innerHTML='<i class="fas fa-folder-open"></i>'; b.title='本地上传';
            bindUpload(b, inp, 800, '图片已上传，点击 ✓ 应用');
            row.appendChild(b);
        }
        var urls=root.querySelectorAll('.url-input-modal');
        for(var j=0;j<urls.length;j++) {
            var um=urls[j]; if(um.getAttribute(UPLOAD_ATTR)) continue;
            um.setAttribute(UPLOAD_ATTR,'1');
            var ui=um.querySelector('.url-input-field'), ub=um.querySelector('.url-input-body');
            if(!ui||!ub) continue;
            var ubtn=phoneCtx.doc.createElement('button'); ubtn.type='button'; ubtn.className='pe-upload-btn';
            ubtn.innerHTML='<i class="fas fa-folder-open"></i><span>本地上传图片</span>';
            bindUpload(ubtn, ui, 800, '图片已上传，点击确认添加到图片库');
            ub.appendChild(ubtn);
        }
    }

    function loadWp() { wallpapers=getVar(VAR_WALLPAPERS,[]); if(!Array.isArray(wallpapers))wallpapers=[]; wpIndex=getVar(VAR_WALLPAPER_IDX,0); if(typeof wpIndex!=='number'||wpIndex<0||wpIndex>=wallpapers.length)wpIndex=0; }
    function saveWp() { setVar(VAR_WALLPAPERS,wallpapers); setVar(VAR_WALLPAPER_IDX,wpIndex); }

    function applyWp() {
        if(!phoneCtx) return;
        var root=phoneCtx.root, sid='pe-wallpaper-style';
        var ex=root.getElementById(sid); if(ex) ex.remove();
        var os=root.getElementById('startup-wallpaper-style'); if(os) os.remove();
        if(!wallpapers.length||!wallpapers[wpIndex]) { updateDot(); return; }
        var url=wallpapers[wpIndex], s=phoneCtx.doc.createElement('style'); s.id=sid;
        s.textContent='.phone-container,.phone-home,.phone-lock-screen{background-image:url("'+url+'")!important;background-size:cover!important;background-position:center!important;background-repeat:no-repeat!important;}.phone-container::before{content:""!important;position:absolute!important;inset:0!important;background:rgba(0,0,0,0.12)!important;z-index:0!important;pointer-events:none!important;}.app-block span,.phone-time,.phone-date,.status-time{text-shadow:0 1px 4px rgba(0,0,0,0.6)!important;}';
        root.appendChild(s);
        if(wpPageEl) wpPageEl.style.backgroundImage='url("'+url+'")';
        var ob=root.getElementById('wallpaper-toggle-btn'); if(ob) ob.remove();
        updateDot();
    }

    function updateClock() {
        if(!wpPageEl) return;
        var c=wpPageEl.querySelector('.pe-wp-clock'), d=wpPageEl.querySelector('.pe-wp-date');
        if(!c||!d) return;
        var n=new Date(), h=String(n.getHours()).padStart(2,'0'), m=String(n.getMinutes()).padStart(2,'0'), w=['日','一','二','三','四','五','六'];
        c.textContent=h+':'+m; d.textContent=(n.getMonth()+1)+'月'+n.getDate()+'日 星期'+w[n.getDay()];
    }

    function updateDot() {
        if(!phoneCtx) return;
        var root=phoneCtx.root, pc=root.querySelector('.phone-container'); if(!pc) return;
        var dot=root.getElementById(WP_DOT_ID);
        if(!wallpapers.length) { if(dot) dot.style.display='none'; return; }
        if(!dot) { dot=phoneCtx.doc.createElement('div'); dot.id=WP_DOT_ID; dot.innerHTML='<div class="pe-dot pe-dot-active" data-page="0"></div><div class="pe-dot" data-page="1"></div>'; pc.appendChild(dot); }
        dot.style.display='flex';
        var ds=dot.querySelectorAll('.pe-dot');
        for(var i=0;i<ds.length;i++) { if(parseInt(ds[i].getAttribute('data-page'))===currentPage) ds[i].classList.add('pe-dot-active'); else ds[i].classList.remove('pe-dot-active'); }
    }

    function createWpPage() {
        if(!phoneCtx) return;
        var root=phoneCtx.root, pc=root.querySelector('.phone-container'); if(!pc) return;
        if(root.getElementById(WP_PAGE_ID)) { wpPageEl=root.getElementById(WP_PAGE_ID); return; }
        var p=phoneCtx.doc.createElement('div'); p.id=WP_PAGE_ID;
        p.innerHTML='<div class="pe-wp-top"><button class="pe-wp-btn pe-wp-manage-btn" title="管理壁纸"><i class="fas fa-images"></i></button></div><div class="pe-wp-center"><div class="pe-wp-clock">--:--</div><div class="pe-wp-date">--</div></div><div class="pe-wp-hint"><i class="fas fa-chevron-right" style="font-size:10px;"></i> 向右滑动返回</div>';
        pc.appendChild(p); wpPageEl=p;
        var mb=p.querySelector('.pe-wp-manage-btn'); if(mb) mb.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();openWpMgr();});
        updateClock(); if(clockTimer) clearInterval(clockTimer); clockTimer=setInterval(updateClock,10000);
    }

    function goWp() {
        if(!phoneCtx||!wpPageEl||!contentArea) return;
        currentPage=1; contentArea.classList.add('pe-wp-sliding'); contentArea.style.transform='translateX(-100%)';
        wpPageEl.classList.add('pe-wp-active'); wpPageEl.classList.remove('pe-wp-dragging'); wpPageEl.style.transform='translateX(0)';
        updateClock(); updateDot();
    }

    function goHome() {
        if(!phoneCtx||!wpPageEl||!contentArea) return;
        currentPage=0; contentArea.classList.add('pe-wp-sliding'); contentArea.style.transform='translateX(0)';
        wpPageEl.classList.remove('pe-wp-active'); wpPageEl.classList.remove('pe-wp-dragging'); wpPageEl.style.transform='translateX(100%)';
        updateDot();
    }

    function openWpMgr() {
        if(!phoneCtx) return;
        var root=phoneCtx.root, pc=root.querySelector('.phone-container'); if(!pc) return;
        var ex=root.getElementById(WP_MGR_ID); if(ex) ex.remove();
        var mgr=phoneCtx.doc.createElement('div'); mgr.id=WP_MGR_ID; mgr.className='pe-wp-mgr'; pc.appendChild(mgr);

        function render() {
            var h='<div class="pe-wp-thumb-add" data-action="add"><i class="fas fa-plus" style="font-size:20px;"></i><span>添加壁纸</span></div>';
            for(var i=0;i<wallpapers.length;i++) { var cur=i===wpIndex; h+='<div class="pe-wp-thumb'+(cur?' pe-wp-current':'')+'" data-idx="'+i+'"><img src="'+wallpapers[i]+'" alt="壁纸'+(i+1)+'">'+(cur?'':'<button class="pe-wp-thumb-del" data-del="'+i+'" title="删除"><i class="fas fa-times"></i></button>')+'</div>'; }
            mgr.innerHTML='<div class="pe-wp-mgr-header"><button class="pe-wp-btn pe-wp-mgr-back" title="返回"><i class="fas fa-chevron-left"></i></button><div class="pe-wp-mgr-title">壁纸管理（'+wallpapers.length+'张）</div><div style="width:34px;flex-shrink:0;"></div></div><div class="pe-wp-mgr-body"><div class="pe-wp-mgr-grid">'+h+'</div>'+(wallpapers.length===0?'<div class="pe-wp-empty">暂无壁纸，点击上方"+"添加本地图片</div>':'')+'</div><div class="pe-wp-mgr-footer"><button class="pe-wp-mgr-add-btn" data-action="add2"><i class="fas fa-upload"></i> 从本地添加壁纸</button></div>';
            mgr.querySelector('.pe-wp-mgr-back').addEventListener('click',function(){mgr.remove();});
            var adds=mgr.querySelectorAll('[data-action="add"],[data-action="add2"]');
            for(var k=0;k<adds.length;k++) adds[k].addEventListener('click',function(e){e.preventDefault();e.stopPropagation();addLocal();});
            var thumbs=mgr.querySelectorAll('.pe-wp-thumb');
            for(var j=0;j<thumbs.length;j++) thumbs[j].addEventListener('click',function(e){if(e.target.closest('.pe-wp-thumb-del'))return;var idx=parseInt(this.getAttribute('data-idx'));if(!isNaN(idx)){wpIndex=idx;saveWp();applyWp();render();showToast('壁纸已切换');}});
            var dels=mgr.querySelectorAll('.pe-wp-thumb-del');
            for(var d=0;d<dels.length;d++) dels[d].addEventListener('click',function(e){e.preventDefault();e.stopPropagation();var idx=parseInt(this.getAttribute('data-del'));if(isNaN(idx))return;wallpapers.splice(idx,1);if(wpIndex>=wallpapers.length)wpIndex=Math.max(0,wallpapers.length-1);saveWp();applyWp();render();showToast('壁纸已删除');});
        }
        function addLocal() {
            pickFile(true,function(files){
                if(!files||!files.length) return;
                var btn=mgr.querySelector('.pe-wp-mgr-add-btn'), orig=btn?btn.innerHTML:'';
                if(btn) btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> 处理中...';
                var ps=files.map(function(f){return fileToDataUrl(f,1080,0.85).catch(function(e){console.warn('[PE] img fail:',f.name,e);return null;});});
                Promise.all(ps).then(function(res){var n=0;for(var i=0;i<res.length;i++){if(res[i]){wallpapers.push(res[i]);n++;}}if(n>0){if(wallpapers.length===n)wpIndex=0;saveWp();applyWp();render();showToast('成功添加 '+n+' 张壁纸');}else{if(btn)btn.innerHTML=orig;showToast('没有成功添加的图片',true);}});
            });
        }
        render();
    }

    function getActiveApp() {
        if(!phoneCtx) return null;
        var hs=phoneCtx.root.querySelector('.app-home-screen');
        if(hs) { try { var s=phoneCtx.doc.defaultView.getComputedStyle(hs); if(s&&s.display!=='none') return 'home'; } catch(e){} }
        return null;
    }

    function setupSwipe() {
        if(!phoneCtx) return;
        var pc=phoneCtx.root.querySelector('.phone-container'); if(!pc||pc.getAttribute('data-pe-swipe')) return;
        pc.setAttribute('data-pe-swipe','1'); contentArea=phoneCtx.root.querySelector('.content-area');
        var TH=50, MT=8;
        function pt(e){if(e.touches&&e.touches.length)return e.touches[0];if(e.changedTouches&&e.changedTouches.length)return e.changedTouches[0];return e;}
        function can(){if(currentPage===1)return true;if(currentPage===0)return getActiveApp()==='home';return false;}
        function start(e){if(!contentArea||!wpPageEl||!can()||phoneCtx.root.getElementById(WP_MGR_ID))return;var p=pt(e);dragState={startX:p.clientX,startY:p.clientY,currentX:p.clientX,currentY:p.clientY,locked:null};}
        function move(e){if(!dragState||!contentArea||!wpPageEl)return;var p=pt(e);dragState.currentX=p.clientX;dragState.currentY=p.clientY;var dx=dragState.currentX-dragState.startX,dy=dragState.currentY-dragState.startY;if(!dragState.locked){if(Math.abs(dx)>MT||Math.abs(dy)>MT)dragState.locked=(Math.abs(dx)>Math.abs(dy))?'horizontal':'vertical';}if(dragState.locked!=='horizontal')return;if(e.cancelable){try{e.preventDefault();}catch(e2){}}var w=pc.offsetWidth||360,pc2=(dx/w)*100;if(currentPage===0&&dx<0){contentArea.classList.add('pe-wp-dragging');wpPageEl.classList.add('pe-wp-dragging','pe-wp-active');contentArea.style.transform='translateX('+Math.max(-100,pc2)+'%)';wpPageEl.style.transform='translateX('+Math.min(100,100+pc2)+'%)';}else if(currentPage===1&&dx>0){contentArea.classList.add('pe-wp-dragging');wpPageEl.classList.add('pe-wp-dragging');contentArea.style.transform='translateX('+Math.max(-100,-100+pc2)+'%)';wpPageEl.style.transform='translateX('+Math.min(100,pc2)+'%)';}}
        function end(){if(!dragState||!contentArea||!wpPageEl){dragState=null;return;}if(dragState.locked!=='horizontal'){dragState=null;return;}var dx=dragState.currentX-dragState.startX;contentArea.classList.remove('pe-wp-dragging');wpPageEl.classList.remove('pe-wp-dragging');if(currentPage===0&&dx<-TH)goWp();else if(currentPage===1&&dx>TH)goHome();else{if(currentPage===0)goHome();else goWp();}dragState=null;}
        pc.addEventListener('touchstart',start,{passive:true}); pc.addEventListener('touchmove',move,{passive:false}); pc.addEventListener('touchend',end,{passive:true}); pc.addEventListener('touchcancel',end,{passive:true});
        var md=false;
        pc.addEventListener('mousedown',function(e){if(e.target.closest('button,input,a,textarea,select,.app-block,.bottom-bar .app,.pe-wp-thumb,.pe-wp-mgr,[data-custom-app],.nav-btn,.clickable'))return;md=true;start(e);});
        var doc=phoneCtx.doc;
        doc.addEventListener('mousemove',function(e){if(!md)return;move(e);});
        doc.addEventListener('mouseup',function(){if(!md)return;md=false;end();});
    }

    function watchNav() {
        if(!phoneCtx) return; if(navTimer) clearInterval(navTimer);
        var root=phoneCtx.root;
        navTimer=setInterval(function(){if(currentPage===1){var hs=root.querySelector('.app-home-screen');if(hs){try{var s=phoneCtx.doc.defaultView.getComputedStyle(hs);if(s&&s.display==='none')goHome();}catch(e){}}}},500);
    }

    function init() {
        try {
            initCount++;
            var nc=getPhoneRoot(); if(!nc) return;
            var changed=(!phoneCtx||phoneCtx.root!==nc.root); phoneCtx=nc;
            if(contentArea&&!contentArea.isConnected) contentArea=null;
            if(changed||!wpPageEl||!wpPageEl.isConnected) { injectStyle(); loadWp(); createWpPage(); applyWp(); setupSwipe(); watchNav(); console.log('[PhoneEnhanced] v1.1.0 loaded (attempt '+initCount+')'); }
            injectDialogBtns(); injectPickerBtns();
        } catch(e) { console.error('[PhoneEnhanced] init error:', e); }
    }

    function start() {
        init();
        [300,800,1500,2500,4000,6000,10000].forEach(function(d){setTimeout(init,d);});
        setInterval(init,2000);
        try {
            var docs=[],seen={};
            function add(d){if(d&&d.body&&!seen[d.URL||d.location&&d.location.href]){seen[d.URL||d.location&&d.location.href]=true;docs.push(d);}}
            add(document); try{add(window.parent.document);}catch(e){} try{add(window.top.document);}catch(e){}
            for(var d=0;d<docs.length;d++) new MutationObserver(function(){init();}).observe(docs[d].body,{childList:true,subtree:true});
        } catch(e) { console.warn('[PhoneEnhanced] MutationObserver fail:', e); }
    }

    if (window[INIT_FLAG]) { console.log('[PhoneEnhanced] already initialized, skipping'); return; }
    window[INIT_FLAG] = true;

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();

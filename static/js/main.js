// ===== DOM 引用 =====
    let userLocation = null;
    
    // 初始化地理位置信息
    fetch('https://get.geojs.io/v1/ip/geo.json')
        .then(res => res.json())
        .then(data => {
            userLocation = `${data.country} ${data.region} ${data.city}`;
            console.log("已获取用户位置:", userLocation);
        })
        .catch(err => console.log("无法获取位置:", err));

    const userInput   = document.getElementById('userInput');
    const sendBtn     = document.getElementById('sendBtn');
    const chatHistory = document.getElementById('chatHistory');
    const charCounter = document.getElementById('charCounter');
    const statusText  = document.getElementById('statusText');
    const welcomeScreen = document.getElementById('welcomeScreen');
    const dateDivider   = document.getElementById('dateDivider');
    const dateText      = document.getElementById('dateText');

    // ===== 初始化 Markdown 解析器 =====
    marked.setOptions({
        highlight: function (code, lang) {
            if (lang && hljs.getLanguage(lang)) {
                return hljs.highlight(code, { language: lang }).value;
            }
            return hljs.highlightAuto(code).value;
        },
        breaks: true, // 支持 GitHub 风格的换行
        gfm: true
    });

    function renderMarkdown(text) {
        // 预处理：将 [citation:N] 格式统一转为 [N]
        text = text.replace(/\[citation:(\d+)\]/g, '[$1]');

        let html = marked.parse(text);
        
        // 方案2：利用正则强制给所有的 <a> 标签加上 target="_blank"
        html = html.replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ');

        // 找到参考资料区域，将其与正文分开处理（兼容 h2 和 h3）
        const refPattern = /<h[23][^>]*>.*?参考资料.*?<\/h[23]>/i;
        const refMatch = html.match(refPattern);

        if (refMatch) {
            const refIndex = html.indexOf(refMatch[0]);
            let bodyHtml = html.substring(0, refIndex);
            let refHtml = html.substring(refIndex);

            // 正文部分：[数字] 变为蓝色可点击角标
            bodyHtml = bodyHtml.replace(/\[(\d+)\]/g,
                '<span class="citation-link" data-ref="$1" onclick="scrollToCitation(this, $1)">[$1]</span>');

            // 参考资料标题统一为 h3 样式
            refHtml = refHtml.replace(refPattern, '<h3 class="reference-title">📚 参考资料</h3>');

            // 参考资料列表中的 [数字] 加上 data-ref-target 锚点
            refHtml = refHtml.replace(/<li>([\s\S]*?)\[(\d+)\]/g,
                '<li data-ref-target="$2">$1<span class="ref-number">[$2]</span>');

            html = bodyHtml + refHtml;
        } else {
            html = html.replace(/\[(\d+)\]/g,
                '<span class="citation-link" data-ref="$1">[$1]</span>');
        }

        return html;
    }

    window.scrollToCitation = function(el, num) {
        // 在同一个 .markdown-body 气泡内查找对应的参考条目
        const bubble = el.closest('.markdown-body');
        if (!bubble) return;
        const target = bubble.querySelector(`li[data-ref-target="${num}"]`);
        if (!target) return;
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.remove('citation-bounce');
        void target.offsetWidth;
        target.classList.add('citation-bounce');
        setTimeout(() => { target.classList.remove('citation-bounce'); }, 900);
    };

    const MAX_CHARS = 2000;
    let messageCount = 0;
    let isTyping = false;
    const generatingSessions = new Set();
    const abortControllers = new Map();
    let searchEnabled = false;

    function updateInputState() {
        const isGen = generatingSessions.has(SESSION_ID);
        isTyping = isGen;
        sendBtn.disabled = isGen;
        userInput.disabled = isGen;
        stopBtn.style.display = isGen ? '' : 'none';
        statusText.textContent = isGen ? '正在思考中...' : '在线 · 随时为你解答';
    }

    // ===== Session ID（存入 localStorage，刷新不丢失）=====
    let SESSION_ID = localStorage.getItem('lc_session_id');
    if (!SESSION_ID) {
        SESSION_ID = 'sess_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        localStorage.setItem('lc_session_id', SESSION_ID);
    }

    // ===== 侧边栏开关 =====
    const sidebar = document.getElementById('sidebar');
    let sidebarOpen = true;

    function toggleSidebar() {
        sidebarOpen = !sidebarOpen;
        sidebar.classList.toggle('collapsed', !sidebarOpen);
        if (sidebarOpen) loadSessions();
    }

    // ===== 自定义弹窗逻辑 =====
    function showModal(title, htmlContent, confirmText, confirmClass, onConfirm) {
        const overlay = document.getElementById('customModal');
        document.getElementById('modalTitle').textContent = title;
        document.getElementById('modalBody').innerHTML = htmlContent;
        
        const confirmBtn = document.getElementById('modalConfirmBtn');
        confirmBtn.textContent = confirmText;
        confirmBtn.className = 'modal-btn ' + confirmClass;
        
        const cancelBtn = document.getElementById('modalCancelBtn');
        
        function close() {
            overlay.classList.remove('show');
            setTimeout(() => { overlay.style.display = 'none'; }, 200);
        }
        
        overlay.style.display = 'flex';
        overlay.offsetHeight; // force reflow
        overlay.classList.add('show');
        
        confirmBtn.onclick = () => {
            if (onConfirm() !== false) close();
        };
        cancelBtn.onclick = close;
        
        const input = document.getElementById('modalInput');
        if (input) {
            input.focus();
            input.selectionStart = input.selectionEnd = input.value.length;
            input.onkeydown = (e) => {
                if (e.key === 'Enter') confirmBtn.click();
                if (e.key === 'Escape') cancelBtn.click();
            }
        }
    }

    // ===== 新建对话 =====
    function newChat() {
        SESSION_ID = 'sess_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        localStorage.setItem('lc_session_id', SESSION_ID);
        document.querySelectorAll('.message-row, .tool-card').forEach(r => r.style.display = 'none');
        messageCount = 0;
        welcomeScreen.classList.add('visible');
        document.querySelector('.header-title').textContent = '小进-2.0 智能助手';
        updateInputState();
        userInput.focus();
        loadSessions();
    }

    // ===== 会话列表 =====
    const sessionList = document.getElementById('sessionList');

    function timeAgo(dateStr) {
        const d = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z');
        const diff = (Date.now() - d.getTime()) / 1000;
        if (diff < 60)     return '刚刚';
        if (diff < 3600)   return Math.floor(diff / 60) + '分钟前';
        if (diff < 86400)  return Math.floor(diff / 3600) + '小时前';
        if (diff < 604800) return Math.floor(diff / 86400) + '天前';
        return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
    }

    let initialLoad = true;
    async function loadSessions() {
        try {
            const res = await fetch('/api/sessions');
            const sessions = await res.json();

            if (initialLoad) {
                initialLoad = false;
                if (SESSION_ID) {
                    const currentSession = sessions.find(s => s.session_id === SESSION_ID);
                    if (currentSession && currentSession.message_count > 0) {
                        switchSession(SESSION_ID, currentSession.title);
                        return;
                    }
                }
            }

            if (!sessions.length) {
                sessionList.innerHTML = '<div class="sidebar-empty">暂无历史记录<br>发送消息后自动保存</div>';
                return;
            }
            sessionList.innerHTML = '';
            sessions.forEach(s => {
                const item = document.createElement('div');
                item.className = 'session-item' + (s.session_id === SESSION_ID ? ' active' : '');
                item.dataset.sid = s.session_id;

                // 主内容区域
                const inner = document.createElement('span');
                inner.className = 'session-icon';
                inner.textContent = '💬';
                item.appendChild(inner);

                const info = document.createElement('div');
                info.className = 'session-info';
                const pinIcon = s.is_pinned ? '<span style="margin-right:4px;" title="已置顶">📌</span>' : '';
                info.innerHTML = `<div class="session-title">${pinIcon}${escapeHtml(s.title)}</div>
                    <div class="session-meta">${timeAgo(s.updated_at)} · ${s.message_count}条</div>`;
                item.appendChild(info);

                // ⋯ 操作按钮 + 下拉菜单
                const menuWrap = document.createElement('div');
                menuWrap.style.cssText = 'position:relative;flex-shrink:0';

                const menuBtn = document.createElement('button');
                menuBtn.className = 'session-menu-btn';
                menuBtn.textContent = '⋯';
                menuBtn.title = '更多操作';

                const dd = document.createElement('div');
                dd.className = 'session-menu-dropdown';

                menuBtn.onclick = (e) => {
                    e.stopPropagation();
                    document.querySelectorAll('.session-menu-dropdown.open').forEach(el => {
                        if (el !== dd) el.classList.remove('open');
                    });
                    dd.classList.toggle('open');
                };

                const pinOpt = document.createElement('button');
                pinOpt.className = 'session-menu-opt';
                pinOpt.innerHTML = s.is_pinned ? '📍 取消置顶' : '📌 置顶';
                pinOpt.onclick = async (e) => { 
                    e.stopPropagation(); 
                    dd.classList.remove('open'); 
                    await fetch(`/api/sessions/${s.session_id}/pin`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ is_pinned: s.is_pinned ? 0 : 1 })
                    });
                    loadSessions();
                };

                const renOpt = document.createElement('button');
                renOpt.className = 'session-menu-opt';
                renOpt.innerHTML = '✏️ 重命名';
                renOpt.onclick = (e) => { 
                    e.stopPropagation(); 
                    dd.classList.remove('open'); 
                    openRenameModal(s.session_id, s.title); 
                };

                const delOpt = document.createElement('button');
                delOpt.className = 'session-menu-opt danger';
                delOpt.innerHTML = '🗑️ 删除';
                delOpt.onclick = (e) => { e.stopPropagation(); dd.classList.remove('open'); deleteSession(e, s.session_id); };

                dd.appendChild(pinOpt);
                dd.appendChild(renOpt);
                dd.appendChild(delOpt);
                menuWrap.appendChild(menuBtn);
                menuWrap.appendChild(dd);
                item.appendChild(menuWrap);

                item.addEventListener('click', () => switchSession(s.session_id, s.title));
                sessionList.appendChild(item);
            });
        } catch (e) {
            console.error('[loadSessions]', e);
        }
    }

    // ===== 重命名会话 (弹窗) =====
    function openRenameModal(sid, currentTitle) {
        const html = `请输入新的会话名称：<br><input type="text" id="modalInput" class="custom-modal-input" value="${escapeHtml(currentTitle)}">`;
        showModal('重命名会话', html, '保存', 'modal-btn-confirm', () => {
            const inputEl = document.getElementById('modalInput');
            if (!inputEl) return true;
            const newTitle = inputEl.value.trim().slice(0, 50);
            if (!newTitle || newTitle === currentTitle) return true;
            
            // 乐观更新 UI
            const item = document.querySelector(`.session-item[data-sid="${sid}"] .session-title`);
            if (item) item.textContent = newTitle;
            if (sid === SESSION_ID) document.querySelector('.header-title').textContent = newTitle;

            fetch(`/api/sessions/${sid}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: newTitle })
            }).then(() => loadSessions()).catch(e => console.error(e));
            
            return true;
        });
    }

    // ===== 切换历史会话 =====
    async function switchSession(sid, title) {
        SESSION_ID = sid;
        localStorage.setItem('lc_session_id', sid);

        document.querySelectorAll('.message-row, .tool-card').forEach(r => r.style.display = 'none');
        document.querySelector('.header-title').textContent = title || '小进-2.0 智能助手';
        updateInputState();

        const existing = document.querySelectorAll(`[data-session-id="${sid}"]`);
        if (existing.length > 0) {
            existing.forEach(r => r.style.display = '');
            welcomeScreen.classList.toggle('visible', existing.length === 0);
            setTimeout(() => { scrollToBottom(true); }, 10);
            loadSessions();
            return;
        }

        messageCount = 0;
        welcomeScreen.classList.add('visible');

        try {
            statusText.textContent = '加载历史中...';
            const res  = await fetch(`/api/sessions/${sid}/messages`);
            if (!res.ok) throw new Error('API error');
            const msgs = await res.json();

            if (msgs.length === 0) {
                welcomeScreen.classList.add('visible');
            } else {
                welcomeScreen.classList.remove('visible');
                msgs.forEach(m => {
                    const role = m.role === 'user' ? 'user' : 'ai';
                    const node = appendMessage(m.content, role, sid);
                    if (role === 'ai') {
                        node.innerHTML = renderMarkdown(m.content);
                        node.classList.add('markdown-body');
                    } else {
                        node.textContent = m.content;
                    }
                });
                scrollToBottom(true);
            }
        } catch (e) {
            console.error('[switchSession]', e);
            statusText.textContent = '加载失败，请重试';
        } finally {
            if (sid === SESSION_ID && !generatingSessions.has(sid)) {
                setTimeout(() => { statusText.textContent = '在线 · 随时为你解答'; }, 1200);
            }
        }
        loadSessions();   // 更新活跃高亮
    }

    // ===== 删除会话 =====
    function deleteSession(e, sid) {
        e.stopPropagation();
        showModal('删除会话', '确定要彻底删除这个对话吗？此操作无法恢复。', '彻底删除', 'modal-btn-danger', async () => {
            await fetch(`/api/sessions/${sid}`, { method: 'DELETE' });
            document.querySelectorAll(`[data-session-id="${sid}"]`).forEach(r => r.remove());
            if (sid === SESSION_ID) newChat();
            else loadSessions();
        });
    }

    // ===== 认证系统与权限拦截 =====
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch(...args);
        // 如果是 401 且不是鉴权接口本身，显示登录弹窗
        if (response.status === 401 && typeof args[0] === 'string' && !args[0].includes('/api/auth/')) {
            document.getElementById('authModal').style.display = 'flex';
        }
        return response;
    };

    let currentUser = null;

    async function initAuth() {
        try {
            const res = await window.fetch('/api/auth/me');
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.authenticated !== false) {
                currentUser = data;
                document.getElementById('authModal').style.display = 'none';
                renderUserInfo();
                loadSessions();
                return;
            }

            currentUser = null;
            const footer = document.getElementById('sidebarFooter');
            if (footer) footer.innerHTML = '';
            const list = document.getElementById('sessionList');
            if (list) list.innerHTML = '';
            document.getElementById('authModal').style.display = 'flex';
        } catch(e) {
            console.error('Auth check failed:', e);
            currentUser = null;
            document.getElementById('authModal').style.display = 'flex';
        }
    }

    function renderUserInfo() {
        const footer = document.getElementById('sidebarFooter');
        if (!currentUser) return;
        
        // 默认头像
        let avatarContent = currentUser.username.charAt(0).toUpperCase();
            
        footer.innerHTML = `
            <div class="user-footer-row">
                <div class="user-footer-avatar" title="${currentUser.username}">
                    ${avatarContent}
                </div>
                <span class="user-footer-name">${currentUser.username}</span>
                <button class="user-footer-settings-btn" id="settingsBtn" title="设置" onclick="window.openSettingsModal()">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="3"/>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                    </svg>
                </button>
            </div>
        `;
        
        // 动态更新全局设置弹窗内容
        _updateSettingsModalContent();
    }
    
    function _updateSettingsModalContent() {
        if (!currentUser) return;
        let adminItem = currentUser.role === 'admin' 
            ? `<a href="/admin" target="_blank" class="settings-menu-item" onclick="window.closeSettingsModal()">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
                后台管理
               </a>` 
            : '';
        
        const container = document.getElementById('settingsModalContent');
        if (!container) return;
        container.innerHTML = `
            <div class="settings-menu-header">${currentUser.username}</div>
            ${adminItem}
            <button class="settings-menu-item" onclick="window.closeSettingsModal(); window.openProfileModal();">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                编辑资料
            </button>
            <button class="settings-menu-item" onclick="window.closeSettingsModal(); window.openPwdModal();">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                修改密码
            </button>
            <div class="settings-menu-divider"></div>
            <button class="settings-menu-item settings-menu-danger" onclick="window.closeSettingsModal(); window.logout();">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                退出登录
            </button>
        `;
    }

    // 暴露给全局的 Auth 函数
    window.switchAuthTab = function(tab) {
        document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
        document.getElementById('tabRegister').classList.toggle('active', tab === 'register');
        document.getElementById('loginForm').style.display = tab === 'login' ? 'block' : 'none';
        document.getElementById('registerForm').style.display = tab === 'register' ? 'block' : 'none';
        document.getElementById('authError').textContent = '';
    };

    window.login = async function() {
        const u = document.getElementById('loginUsername').value;
        const p = document.getElementById('loginPassword').value;
        if(!u||!p) return document.getElementById('authError').textContent = '请输入用户名和密码';
        
        const res = await originalFetch('/api/auth/login', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({username:u, password:p})
        });
        const data = await res.json();
        if(res.ok) {
            document.getElementById('authError').textContent = '';
            await initAuth();
        } else {
            document.getElementById('authError').textContent = data.error;
        }
    };

    window.register = async function() {
        const u = document.getElementById('regUsername').value;
        const p = document.getElementById('regPassword').value;
        const c = document.getElementById('regInviteCode').value;
        if(!u||!p||!c) return document.getElementById('authError').textContent = '请完整填写注册信息';
        
        const res = await originalFetch('/api/auth/register', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({username:u, password:p, invite_code:c})
        });
        const data = await res.json();
        if(res.ok) {
            document.getElementById('authError').textContent = '';
            await initAuth();
        } else {
            document.getElementById('authError').textContent = data.error;
        }
    };

    window.logout = async function() {
        await originalFetch('/api/auth/logout', {method:'POST'});
        currentUser = null;

        generatingSessions.clear();
        abortControllers.forEach(controller => controller.abort());
        abortControllers.clear();

        SESSION_ID = 'sess_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        localStorage.setItem('lc_session_id', SESSION_ID);
        messageCount = 0;

        const sessionListEl = document.getElementById('sessionList');
        if (sessionListEl) sessionListEl.innerHTML = '';
        const footer = document.getElementById('sidebarFooter');
        if (footer) footer.innerHTML = '';
        document.querySelectorAll('.message-row, .tool-card').forEach(node => node.remove());

        const welcome = document.getElementById('welcomeScreen');
        if (welcome) welcome.classList.add('visible');
        const st = document.getElementById('statusText');
        if (st) st.textContent = '未登录';
        const authError = document.getElementById('authError');
        if (authError) authError.textContent = '';
        const loginPassword = document.getElementById('loginPassword');
        if (loginPassword) loginPassword.value = '';
        document.getElementById('authModal').style.display = 'flex';
        updateInputState();
    };

    function _openModal(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.display = 'flex';
        el.offsetHeight; // force reflow
        el.classList.add('show');
    }
    function _closeModal(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.remove('show');
        setTimeout(() => { el.style.display = 'none'; }, 200);
    }

    window.openPwdModal = () => _openModal('pwdModal');
    window.closePwdModal = () => {
        _closeModal('pwdModal');
        document.getElementById('oldPwd').value = '';
        document.getElementById('newPwd').value = '';
    };

    window.openSettingsModal = () => _openModal('settingsModal');
    window.closeSettingsModal = () => _closeModal('settingsModal');

    window.openProfileModal = () => {
        if (!currentUser) return;
        document.getElementById('profileUsername').value = currentUser.username || '';
        _openModal('profileModal');
    };
    window.closeProfileModal = () => _closeModal('profileModal');
    


    
    window.submitProfile = async () => {
        const u = document.getElementById('profileUsername').value.trim();
        if(!u) return alert('用户名不能为空');
        
        const formData = new FormData();
        formData.append('username', u);
        
        const res = await originalFetch('/api/auth/profile', {
            method: 'PUT',
            body: formData
        });
        const data = await res.json();
        if(res.ok) {
            window.closeProfileModal();
            // 重新拉取用户信息以刷新头像和名字
            await initAuth();
        } else {
            alert(data.error);
        }
    };
    window.submitChangePwd = async () => {
        const o = document.getElementById('oldPwd').value;
        const n = document.getElementById('newPwd').value;
        if(!o||!n) return alert('密码不能为空');
        
        const res = await originalFetch('/api/auth/password', {
            method: 'PUT', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({old_password:o, new_password:n})
        });
        const data = await res.json();
        if(res.ok) {
            alert('修改成功，请重新登录');
            window.closePwdModal();
            window.logout();
        } else {
            alert(data.error);
        }
    };

    // 页面加载时初始化
    initAuth();

    // ===== 联网模式切换 =====
    const searchToggleBtn  = document.getElementById('searchToggleBtn');
    const searchModeBanner = document.getElementById('searchModeBanner');

    function toggleSearch() {
        searchEnabled = !searchEnabled;
        searchToggleBtn.classList.toggle('active', searchEnabled);
        searchModeBanner.classList.toggle('visible', searchEnabled);
        searchToggleBtn.title = searchEnabled ? '关闭联网搜索' : '开启联网搜索';
        userInput.placeholder = searchEnabled
            ? '联网模式：输入问题，自动搜索互联网...'
            : '输入你想说的话...';
        userInput.focus();
    }

    // ===== 初始化日期 =====
    function initDateDivider() {
        const now = new Date();
        const options = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
        dateText.textContent = now.toLocaleDateString('zh-CN', options);
        dateDivider.style.display = 'flex';
    }
    initDateDivider();

    // ===== 自动调整 textarea 高度 =====
    userInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 130) + 'px';

        // 字符计数器
        const len = this.value.length;
        charCounter.textContent = len > 0 ? len : '';
        charCounter.className = 'char-counter';
        if (len > MAX_CHARS * 0.85) charCounter.classList.add('warning');
        if (len > MAX_CHARS * 0.95) { charCounter.classList.remove('warning'); charCounter.classList.add('danger'); }
    });

    // ===== 键盘事件：Enter 发送 / Shift+Enter 换行 =====
    userInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // ===== 快捷提示按钮 =====
    function usePrompt(text) {
        userInput.value = text;
        userInput.dispatchEvent(new Event('input'));
        userInput.focus();
        sendMessage();
    }

    // ===== 获取当前时间字符串 =====
    function getTimeStr() {
        return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }

    // ===== 添加消息行 =====
    function appendMessage(text, role, sid = SESSION_ID) {
        messageCount++;

        const isUser = role === 'user';
        const row = document.createElement('div');
        row.className = `message-row ${isUser ? 'user' : 'ai'}`;
        row.dataset.sessionId = sid;
        if (sid !== SESSION_ID) row.style.display = 'none';
        row.style.animationDelay = '0ms';

        const avatar = document.createElement('div');
        avatar.className = `msg-avatar ${isUser ? 'user-avatar' : 'ai-avatar'}`;
        avatar.textContent = isUser ? '👤' : '';

        const body = document.createElement('div');
        body.className = 'msg-body';

        const name = document.createElement('div');
        name.className = 'msg-name';
        name.textContent = isUser ? '你' : '小进';

        const bubble = document.createElement('div');
        bubble.className = `message ${isUser ? 'user-message' : 'ai-message'}`;

        let actions = null;   // 操作栏（仅 AI 消息使用）
        if (!isUser) {
            // ── 操作栏（复制 + 导出）──
            actions = document.createElement('div');
            actions.className = 'msg-actions';

            // 复制按钮
            const copyBtn = document.createElement('button');
            copyBtn.className = 'msg-action-btn';
            copyBtn.textContent = '复制';
            copyBtn.onclick = () => {
                const rawText = textNode.dataset.raw || textNode.textContent;
                copyText(rawText, copyBtn);
            };
            actions.appendChild(copyBtn);

            // 导出按钮 + 下拉面板
            const exportWrapper = document.createElement('div');
            exportWrapper.style.position = 'relative';

            const exportBtn = document.createElement('button');
            exportBtn.className = 'msg-action-btn';
            exportBtn.textContent = '📄 下载';
            exportBtn.onclick = (e) => {
                e.stopPropagation();
                const dd = exportWrapper.querySelector('.export-dropdown');
                // 关闭其他所有下拉
                document.querySelectorAll('.export-dropdown.open').forEach(el => {
                    if (el !== dd) el.classList.remove('open');
                });
                dd.classList.toggle('open');
            };

            const dropdown = document.createElement('div');
            dropdown.className = 'export-dropdown';

            const formats = [
                { icon: '📝', name: 'Markdown', ext: '.md',   type: 'md'   },
                { icon: '📋', name: '纯文本',   ext: '.txt',  type: 'txt'  },
                { icon: '📄', name: 'Word 文档', ext: '.docx', type: 'docx' },
            ];

            formats.forEach(fmt => {
                const opt = document.createElement('button');
                opt.className = 'export-option';
                opt.innerHTML = `
                    <span class="export-option-icon">${fmt.icon}</span>
                    <span class="export-option-label">
                        <span class="export-option-name">${fmt.name}</span>
                        <span class="export-option-ext">${fmt.ext}</span>
                    </span>`;
                opt.onclick = () => {
                    dropdown.classList.remove('open');
                    const rawText = textNode.dataset.raw || textNode.textContent;
                    exportMessage(rawText, fmt.type);
                };
                dropdown.appendChild(opt);
            });

            exportWrapper.appendChild(exportBtn);
            exportWrapper.appendChild(dropdown);
            actions.appendChild(exportWrapper);
        }

        const textNode = document.createElement('span');
        textNode.className = 'msg-text';
        bubble.appendChild(textNode);

        const timeEl = document.createElement('div');
        timeEl.className = 'msg-time';
        timeEl.textContent = getTimeStr();

        body.appendChild(name);
        body.appendChild(bubble);
        if (!isUser) body.appendChild(actions);  // 操作栏在气泡下方
        body.appendChild(timeEl);
        row.appendChild(avatar);
        row.appendChild(body);
        chatHistory.appendChild(row);

        if (sid === SESSION_ID) {
            welcomeScreen.classList.remove('visible');
            scrollToBottom(true);
        }
        return textNode;
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ===== 添加"思考中"动画 =====
    function addTypingIndicator(sid = SESSION_ID) {
        const row = document.createElement('div');
        row.className = 'message-row ai';
        row.id = 'typingRow_' + sid;
        row.dataset.sessionId = sid;
        if (sid !== SESSION_ID) row.style.display = 'none';

        const avatar = document.createElement('div');
        avatar.className = 'msg-avatar ai-avatar';
        avatar.textContent = '🐱';

        const body = document.createElement('div');
        body.className = 'msg-body';

        const bubble = document.createElement('div');
        bubble.className = 'message ai-message';

        const indicator = document.createElement('div');
        indicator.className = 'typing-indicator';
        for (let i = 0; i < 3; i++) {
            const dot = document.createElement('div');
            dot.className = 'typing-dot';
            indicator.appendChild(dot);
        }
        bubble.appendChild(indicator);
        body.appendChild(bubble);
        row.appendChild(avatar);
        row.appendChild(body);
        chatHistory.appendChild(row);
        if (sid === SESSION_ID) scrollToBottom(true);
    }

    function removeTypingIndicator(sid = SESSION_ID) {
        const row = document.getElementById('typingRow_' + sid);
        if (row) row.remove();
    }

    // ===== 复制文本 =====
    function copyText(text, btn) {
        navigator.clipboard.writeText(text).then(() => {
            btn.textContent = '✓ 已复制';
            btn.classList.add('copied');
            setTimeout(() => {
                btn.textContent = '复制';
                btn.classList.remove('copied');
            }, 2000);
        });
    }

    // ===== 文档导出 =====
    async function exportMessage(text, format) {
        // 生成默认文件名（取内容前 20 个非空字符）
        const defaultName = text.replace(/[#*`>\-\n]/g, '').trim().slice(0, 20) || '小进文档';

        if (format === 'txt') {
            clientDownload(text, `${defaultName}.txt`, 'text/plain;charset=utf-8');
            return;
        }
        if (format === 'md') {
            clientDownload(text, `${defaultName}.md`, 'text/markdown;charset=utf-8');
            return;
        }
        if (format === 'docx') {
            // 调用后端生成 Word 文档
            try {
                statusText.textContent = '📄 正在生成 Word 文档...';
                const resp = await fetch('/api/export-docx', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: text, filename: defaultName })
                });
                if (!resp.ok) {
                    const err = await resp.json();
                    alert('导出失败：' + (err.error || '未知错误'));
                    return;
                }
                // 触发文件下载
                const blob = await resp.blob();
                const url  = URL.createObjectURL(blob);
                const a    = document.createElement('a');
                a.href     = url;
                a.download = `${defaultName}.docx`;
                a.click();
                URL.revokeObjectURL(url);
            } catch (e) {
                alert('导出失败，请检查服务是否运行');
            } finally {
                statusText.textContent = '在线 · 随时为你解答';
            }
        }
    }

    // 客户端直接下载纯文本文件
    function clientDownload(content, filename, mime) {
        const blob = new Blob([content], { type: mime });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    // 点击空白处关闭所有下拉面板
    document.addEventListener('click', () => {
        document.querySelectorAll('.export-dropdown.open, .session-menu-dropdown.open')
                .forEach(el => el.classList.remove('open'));
    });

    // ===== 滚动到底部 =====
    function scrollToBottom(force = false) {
        // 允许 150px 的容差；如果距离底部足够近，或者强制滚动，则执行滚动
        const isAtBottom = chatHistory.scrollHeight - chatHistory.scrollTop - chatHistory.clientHeight < 150;
        if (force || isAtBottom) {
            chatHistory.scrollTop = chatHistory.scrollHeight;
        }
    }

    // ===== 渲染工具调用卡片（搜索过程展示）=====
    function appendToolCard(toolName, query, sid = SESSION_ID) {
        const card = document.createElement('div');
        card.className = 'tool-card';
        card.id = 'toolCard_' + Date.now();
        card.dataset.sessionId = sid;
        if (sid !== SESSION_ID) card.style.display = 'none';

        const iconMap = { 'web_search': '🔍', 'default': '⚙️' };
        const labelMap = { 'web_search': '正在网络搜索', 'default': '调用工具' };
        const icon = iconMap[toolName] || iconMap['default'];
        const label = labelMap[toolName] || labelMap['default'];

        card.innerHTML = `
            <div class="tool-card-icon">${icon}</div>
            <div class="tool-card-body">
                <div class="tool-card-label">
                    <span class="tool-card-spinner"></span>${label}...
                </div>
                <div class="tool-card-query">${escapeHtml(query)}</div>
            </div>
        `;
        chatHistory.appendChild(card);
        if (sid === SESSION_ID) scrollToBottom(true);
        return card;
    }

    // 将已完成的工具卡片标记为 done
    function markToolCardDone(card) {
        if (card) {
            card.classList.add('done');
            card.querySelector('.tool-card-label').textContent = '✓ 搜索完成';
        }
    }

    // 移除所有工具卡片
    function removeAllToolCards(sid = SESSION_ID) {
        chatHistory.querySelectorAll(`.tool-card[data-session-id="${sid}"]`).forEach(c => c.remove());
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ===== 清空对话 =====
    function clearChat() {
        showModal('清空对话', '确定要清空当前会话的所有历史记录吗？', '确认清空', 'modal-btn-danger', () => {
            // 移除当前会话的消息行
            document.querySelectorAll(`.message-row[data-session-id="${SESSION_ID}"], .tool-card[data-session-id="${SESSION_ID}"]`).forEach(r => r.remove());
            messageCount = 0;
            welcomeScreen.classList.add('visible');
            if (!generatingSessions.has(SESSION_ID)) {
                statusText.textContent = '在线 · 随时为你解答';
            }
        });
    }

    // ===== 停止生成 =====
    function stopGenerating() {
        if (abortControllers.has(SESSION_ID)) {
            abortControllers.get(SESSION_ID).abort();
        }
    }

    // ===== 发送消息主逻辑 =====
    async function sendMessage() {
        const text = userInput.value.trim();
        if (!text || generatingSessions.has(SESSION_ID)) return;

        if (text.length > MAX_CHARS) {
            alert(`消息过长！最多支持 ${MAX_CHARS} 个字符。`);
            return;
        }

        const sid = SESSION_ID;
        generatingSessions.add(sid);
        updateInputState();

        const userTextNode = appendMessage(text, 'user', sid);
        userTextNode.textContent = text;
        userInput.value = '';
        userInput.style.height = 'auto';
        charCounter.textContent = '';

        addTypingIndicator(sid);

        const controller = new AbortController();
        abortControllers.set(sid, controller);
        const timeoutId = setTimeout(() => controller.abort(), 120_000);

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                signal: controller.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message:        text,
                    session_id:     sid,
                    search_enabled: searchEnabled,
                    user_location:  userLocation
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Server error');
            }

            removeTypingIndicator(sid);
            const aiTextNode = appendMessage('', 'ai', sid);
            aiTextNode.classList.add('markdown-body');
            let fullReply = '';

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // 保留不完整的行

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.slice(6);
                        if (!dataStr) continue;

                        try {
                            const data = JSON.parse(dataStr);
                            if (data.type === 'tool') {
                                if (sid === SESSION_ID) statusText.textContent = '🔍 网络搜索中...';
                                const card = appendToolCard(data.tool, data.input, sid);
                                await sleep(500);
                                markToolCardDone(card);
                                setTimeout(() => {
                                    card.style.transition = 'opacity 0.3s';
                                    card.style.opacity = '0';
                                    setTimeout(() => card.remove(), 300);
                                }, 1000);
                            } else if (data.type === 'session_created') {
                                loadSessions();
                            } else if (data.type === 'chunk') {
                                if (sid === SESSION_ID) statusText.textContent = '正在输出...';
                                fullReply += data.content;
                                aiTextNode.dataset.raw = fullReply;
                                aiTextNode.innerHTML = renderMarkdown(fullReply);
                                if (sid === SESSION_ID) scrollToBottom(false);
                            } else if (data.type === 'error') {
                                aiTextNode.textContent = `⚠️ 错误: ${data.error}`;
                            } else if (data.type === 'done') {
                                loadSessions();
                            }
                        } catch (e) {
                            console.error('Error parsing SSE:', e);
                        }
                    }
                }
            }
            clearTimeout(timeoutId);
        } catch (err) {
            clearTimeout(timeoutId);
            removeTypingIndicator(sid);
            removeAllToolCards(sid);
            if (err.name !== 'AbortError') {
                const node = appendMessage('', 'ai', sid);
                node.textContent = '🔌 网络连接失败，请检查后端服务是否正常运行。';
            }
            // AbortError = 用户主动停止，静默处理
        } finally {
            generatingSessions.delete(sid);
            abortControllers.delete(sid);
            if (sid === SESSION_ID) {
                updateInputState();
                userInput.focus();
            }
        }
    }
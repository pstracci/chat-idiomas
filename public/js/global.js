function signalAuthReady() {
    document.dispatchEvent(new CustomEvent('authReady'));
}

document.addEventListener('DOMContentLoaded', () => {
    const loggedInView = document.getElementById('logged-in-view');
    const loggedOutView = document.getElementById('logged-out-view');
    const welcomeMessage = document.getElementById('welcome-message');
    const connectionsWidget = document.getElementById('connections-widget');
    const connectionsList = document.getElementById('connections-list');
    const toggleConnectionsWidget = document.getElementById('toggle-connections-widget');
    const incomingCallModal = document.getElementById('incoming-call-modal');
    const callerAvatar = document.getElementById('caller-avatar');
    const callerName = document.getElementById('caller-name');
    const acceptCallBtn = document.getElementById('accept-call-btn');
    const declineCallBtn = document.getElementById('decline-call-btn');
    const adminLinkContainer = document.getElementById('admin-link-container');
    const notificationBell = document.getElementById('notification-bell');
    const notificationCount = document.getElementById('notification-count');
    const notificationsDropdown = document.getElementById('notifications-dropdown');
    const requestsList = document.getElementById('requests-list');
    const notificationContainer = document.querySelector('.notification-container');
    const dmWidget = document.getElementById('dm-widget');
    const dmRecipientAvatar = document.getElementById('dm-recipient-avatar');
    const dmRecipientName = document.getElementById('dm-recipient-name');
    const toggleDmWidget = document.getElementById('toggle-dm-widget');
    const closeDmWidget = document.getElementById('close-dm-widget');
    const dmWidgetBody = document.getElementById('dm-widget-body');
    const dmForm = document.getElementById('dm-form');
    const dmInput = document.getElementById('dm-input');
    const dmEmojiBtn = document.getElementById('dm-emoji-btn');
    const dmEmojiPicker = document.getElementById('dm-emoji-picker');

    const socket = io();
    let loggedInUserId = null;
    let currentOpenChat = { userId: null };

    async function openDirectMessageWidget(recipientId, recipientNickname, recipientAvatar) {
        if (currentOpenChat.userId !== recipientId) {
            try {
                await fetch(`/api/dm/conversations/read/${recipientId}`, { method: 'PUT' });
                const connectionItem = connectionsList.querySelector(`.connection-item[data-user-id='${recipientId}']`);
                const badge = connectionItem?.querySelector('.dm-notification-badge');
                if (badge) {
                    badge.remove();
                }
            } catch (error) {
                console.error("Erro ao marcar mensagens como lidas:", error);
            }
        }
        
        if (currentOpenChat.userId === recipientId && dmWidget.style.display === 'flex') {
            return;
        }

        currentOpenChat = { userId: recipientId, nickname: recipientNickname, avatar: recipientAvatar };

        dmRecipientAvatar.src = recipientAvatar || '/default-avatar.png';
        dmRecipientName.textContent = recipientNickname;
        dmWidgetBody.innerHTML = '';
        dmWidget.style.display = 'flex';
        dmWidgetBody.style.display = 'flex';
        toggleDmWidget.textContent = '-';

        try {
            const response = await fetch(`/api/dm/history/${recipientId}`);
            if (!response.ok) throw new Error('Falha ao buscar histórico.');
            
            const messages = await response.json();
            messages.forEach(appendMessageToDmWidget);
        } catch (error) {
            console.error(error);
            dmWidgetBody.innerHTML = '<p style="color: #6c757d; text-align: center;">Não foi possível carregar as mensagens.</p>';
        }
    }

    function appendMessageToDmWidget(message) {
        if (!message.text) return;
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('dm-message');
        messageDiv.textContent = message.text;

        if (message.senderId === loggedInUserId) {
            messageDiv.classList.add('sent');
        } else {
            messageDiv.classList.add('received');
        }
        
        dmWidgetBody.appendChild(messageDiv);
        dmWidgetBody.scrollTop = dmWidgetBody.scrollHeight;
    }

    function populateDmEmojiPicker() {
        if (!dmEmojiPicker) return;
        const emojis = ["😀", "😂", "❤️", "👍", "😭", "🙏", "🎉", "🔥", "😊", "😍", "🤔", "😎", "💯", "🙄", "👋", "👏", "👀", "✨", "🚀", "✅", "❌", "⚠️", "💡", "⏳", "🌎", "🤝", "🥳", "🤯", "💔", "😴"];
        emojis.forEach(emoji => {
            const span = document.createElement('span');
            span.textContent = emoji;
            span.addEventListener('click', () => {
                dmInput.value += emoji;
                dmInput.focus();
            });
            dmEmojiPicker.appendChild(span);
        });
    }

    dmForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = dmInput.value.trim();
        if (!text || !currentOpenChat.userId) return;

        socket.emit('directMessage', {
            recipientId: currentOpenChat.userId,
            text: text,
        });

        dmInput.value = '';
        dmInput.focus();
    });
    
    closeDmWidget.addEventListener('click', () => {
        dmWidget.style.display = 'none';
        currentOpenChat = { userId: null };
    });

    toggleDmWidget.addEventListener('click', () => {
        const isVisible = dmWidgetBody.style.display !== 'none';
        dmWidgetBody.style.display = isVisible ? 'none' : 'flex';
        toggleDmWidget.textContent = isVisible ? '+' : '-';
    });

    dmEmojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dmEmojiPicker.style.display = dmEmojiPicker.style.display === 'grid' ? 'none' : 'grid';
    });

    async function joinVideoRoom(channel) {
        try {
            const backendUrl = window.location.origin;
            const response = await fetch(`${backendUrl}/api/video/generate-token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channel: channel })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Falha ao entrar na sala.');
            const joinUrl = `/videocall.html?appId=${encodeURIComponent(data.appId)}&channel=${encodeURIComponent(data.channel)}&token=${encodeURIComponent(data.token)}&uid=${encodeURIComponent(data.uid)}`;
            window.open(joinUrl, '_blank');
        } catch (error) {
            alert(error.message);
        }
    }

    function populateConnectionsWidget(connections) {
        if (!connectionsList) return;
        connectionsList.innerHTML = '';
        if (!connections || connections.length === 0) {
            connectionsList.innerHTML = '<li style="padding: 10px; color: #6c757d; font-size: 0.9em;">Você ainda não tem conexões.</li>';
            return;
        }
        connections.forEach(conn => {
            const li = document.createElement('li');
            li.className = 'connection-item';
            li.dataset.userId = conn.friendInfo.id;
            const statusClass = conn.friendInfo.isOnline ? 'online' : 'offline';
            const statusTitle = conn.friendInfo.isOnline ? 'Online' : 'Offline';

            let badgeHTML = '';
            if (conn.friendInfo.unreadCount > 0) {
                badgeHTML = `<span class="dm-notification-badge">${conn.friendInfo.unreadCount}</span>`;
            }

            li.innerHTML = `
                <span class="status-dot ${statusClass}" title="${statusTitle}"></span>
                <a href="/profile.html?userId=${conn.friendInfo.id}" class="connection-item-link">
                    <img src="${conn.friendInfo.profilePicture || '/default-avatar.png'}" alt="Avatar">
                    <span>${conn.friendInfo.nickname}</span>
                </a>
                <div class="action-buttons">
                    <button class="btn-video" title="Iniciar chamada de vídeo com ${conn.friendInfo.nickname}">🎥</button>
                    <button class="btn-chat" title="Conversar com ${conn.friendInfo.nickname}">
                        ✉️
                        ${badgeHTML}
                    </button>
                </div>
            `;
            connectionsList.appendChild(li);
        });
    }

    async function updateUserStatusAndConnections() {
        try {
            const response = await fetch('/api/user/status');
            const data = await response.json();

            if (data.loggedIn) {
                loggedInUserId = data.user.id;

                if (loggedInView) loggedInView.style.display = 'flex';
                if (loggedOutView) loggedOutView.style.display = 'none';
                if (welcomeMessage) welcomeMessage.textContent = `Olá, ${data.user.nickname}!`;
                if (adminLinkContainer && data.user.role === 'ADMIN') {
                    adminLinkContainer.innerHTML = `<a href="/admin.html">Admin</a>`;
                }

                if (connectionsWidget) {
                    populateConnectionsWidget(data.connections);
                    connectionsWidget.style.display = 'flex';
                }
                loadAndDisplayNotifications();
            } else {
                loggedInUserId = null;
                if (loggedInView) loggedInView.style.display = 'none';
                if (loggedOutView) loggedOutView.style.display = 'block';
            }
        } catch (error) {
            console.error('Falha ao atualizar o status do usuário:', error);
            if (loggedInView) loggedInView.style.display = 'none';
            if (loggedOutView) loggedOutView.style.display = 'block';
        } finally {
            signalAuthReady();
        }
    }
    
    async function markNotificationAsRead(notificationId) {
        try {
            await fetch(`/api/notifications/${notificationId}/read`, { method: 'PUT' });
            updateUserStatusAndConnections();
        } catch (error) {
            console.error('Erro ao marcar notificação como lida:', error);
        }
    }

    function renderNotifications(notifications) {
        if (!requestsList || !notificationBell || !notificationCount) return;
        requestsList.innerHTML = '';
        notificationBell.style.display = 'flex';
        const unreadNotifications = notifications.filter(n => !n.read);
        if (unreadNotifications.length === 0) {
            notificationCount.style.display = 'none';
            requestsList.innerHTML = '<li style="padding: 15px; text-align: center; color: #6c757d;">Nenhuma notificação nova.</li>';
        } else {
            notificationCount.textContent = unreadNotifications.length;
            notificationCount.style.display = 'flex';
            unreadNotifications.forEach(notif => {
                const li = document.createElement('li');
                li.className = 'request-item';
                li.dataset.notificationId = notif.id;
                let contentHTML = '';
                if (notif.type === 'CONNECTION_REQUEST' && notif.requester) {
                    contentHTML = `
                        <img src="${notif.requester.profilePicture || '/default-avatar.png'}" alt="Avatar">
                        <div class="info"><strong>${notif.requester.nickname}</strong> quer se conectar.</div>
                        <div class="actions">
                            <button class="btn-accept" data-id="${notif.relatedId}" data-notification-id="${notif.id}">Aceitar</button>
                            <button class="btn-reject" data-id="${notif.relatedId}" data-notification-id="${notif.id}">Recusar</button>
                        </div>`;
                } else if (notif.type === 'SYSTEM_MESSAGE') {
                    contentHTML = `<span class="notification-icon">✉️</span><div class="info">${notif.content}</div>`;
                }
                li.innerHTML = contentHTML + `<button class="btn-mark-read" data-id="${notif.id}" title="Marcar como lida">X</button>`;
                requestsList.appendChild(li);
            });
        }
    }

    async function loadAndDisplayNotifications() {
        try {
            const response = await fetch('/api/notifications');
            if (response.ok) {
                const notifications = await response.json();
                renderNotifications(notifications);
            }
        } catch (error) { console.error('Erro ao carregar notificações:', error); }
    }

    async function handleRequestAction(connectionId, action, notificationId) {
        const url = action === 'accept' ? `/api/connections/accept/${connectionId}` : `/api/connections/delete/${connectionId}`;
        const method = action === 'accept' ? 'PUT' : 'DELETE';
        try {
            const response = await fetch(url, { method });
            if (!response.ok) throw new Error('Falha na ação de conexão.');
            updateUserStatusAndConnections();
        } catch (error) {
            alert(error.message);
        }
    }
    
    updateUserStatusAndConnections();
    populateDmEmojiPicker();

    if (connectionsList) {
        connectionsList.addEventListener('click', (e) => {
            const targetButton = e.target.closest('button');
            if (!targetButton) return;

            const connectionItem = targetButton.closest('.connection-item');
            if (!connectionItem) return;
            
            const friendId = connectionItem.dataset.userId;
            const friendNickname = connectionItem.querySelector('.connection-item-link span').textContent;
            const friendAvatar = connectionItem.querySelector('img').src;

            if (targetButton.classList.contains('btn-video')) {
                if (confirm("Iniciar uma chamada de vídeo custará 1 crédito. Deseja prosseguir?")) {
                    socket.emit('video:invite', { recipientId: friendId });
                }
            } else if (targetButton.classList.contains('btn-chat')) {
                openDirectMessageWidget(friendId, friendNickname, friendAvatar);
            }
        });
    }

    if (toggleConnectionsWidget) {
        toggleConnectionsWidget.addEventListener('click', () => {
            const widgetBody = document.getElementById('connections-widget-body');
            const isVisible = widgetBody.style.display !== 'none';
            widgetBody.style.display = isVisible ? 'none' : 'block';
            toggleConnectionsWidget.textContent = isVisible ? '+' : '-';
        });
    }
    
    if (acceptCallBtn) {
        acceptCallBtn.addEventListener('click', () => {
            const { requesterId, channel } = acceptCallBtn.dataset;
            socket.emit('video:accept', { requesterId, channel });
            incomingCallModal.style.display = 'none';
        });
    }

    if (declineCallBtn) {
        declineCallBtn.addEventListener('click', () => {
            const { requesterId, channel } = declineCallBtn.dataset;
            socket.emit('video:decline', { requesterId, channel });
            incomingCallModal.style.display = 'none';
        });
    }
    
    if (notificationBell) {
        notificationBell.addEventListener('click', (e) => { e.stopPropagation(); notificationsDropdown.classList.toggle('active'); });
    }

    if (requestsList) {
        requestsList.addEventListener('click', (e) => {
            if (e.target.matches('.btn-accept')) {
                handleRequestAction(e.target.dataset.id, 'accept', e.target.dataset.notificationId);
            } else if (e.target.matches('.btn-reject')) {
                handleRequestAction(e.target.dataset.id, 'reject', e.target.dataset.notificationId);
            } else if (e.target.matches('.btn-mark-read')) {
                markNotificationAsRead(e.target.dataset.id);
            }
        });
    }

    window.addEventListener('click', (e) => {
        if (notificationContainer && !notificationContainer.contains(e.target)) {
            if(notificationsDropdown) notificationsDropdown.classList.remove('active');
        }
        if (dmEmojiPicker && !dmEmojiPicker.contains(e.target) && e.target !== dmEmojiBtn) {
            dmEmojiPicker.style.display = 'none';
        }
    });
    
    const style = document.createElement('style');
    style.innerHTML = `
        .request-item { position: relative; }
        .btn-mark-read { 
            position: absolute; top: 5px; right: 5px;
            background: none; border: none; font-size: 1.2em;
            cursor: pointer; color: #aaa; line-height: 1; padding: 5px;
        }
        .btn-mark-read:hover { color: #333; }
        .notification-icon {
            display: flex; align-items: center; justify-content: center;
            width: 40px; height: 40px; min-width: 40px;
            background-color: #e9ecef; border-radius: 50%;
            margin-right: 15px; font-size: 1.4em; color: #495057;
        }
    `;
    document.head.appendChild(style);

    socket.on('newDirectMessage', (message) => {
        if (message.senderId === loggedInUserId) {
            if (dmWidget.style.display === 'flex' && dmWidget.dataset.recipientId === message.recipientId) {
                 appendMessageToDmWidget(message);
            }
            return;
        }

        if (dmWidget.style.display === 'flex' && message.senderId === currentOpenChat.userId) {
            appendMessageToDmWidget(message);
            fetch(`/api/dm/conversations/read/${message.senderId}`, { method: 'PUT' });
        } else {
            const connectionItem = connectionsList.querySelector(`.connection-item[data-user-id='${message.senderId}']`);
            if (connectionItem) {
                const chatButton = connectionItem.querySelector('.btn-chat');
                let badge = chatButton.querySelector('.dm-notification-badge');
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'dm-notification-badge';
                    chatButton.appendChild(badge);
                    badge.textContent = '1';
                } else {
                    const currentCount = parseInt(badge.textContent || '0', 10);
                    badge.textContent = currentCount + 1;
                }
            }
        }
    });

    socket.on('user_status_change', (data) => {
        const { userId, isOnline } = data;
        const connectionItem = document.querySelector(`.connection-item[data-user-id='${userId}']`);
        if (connectionItem) {
            const dot = connectionItem.querySelector('.status-dot');
            if (dot) {
                dot.className = isOnline ? 'status-dot online' : 'status-dot offline';
                dot.title = isOnline ? 'Online' : 'Offline';
            }
        }
    });

    socket.on('video:incoming_invite', (data) => {
        if (callerAvatar) callerAvatar.src = data.requester.profilePicture || '/default-avatar.png';
        if (callerName) callerName.innerText = data.requester.nickname;
        if (acceptCallBtn) {
            acceptCallBtn.dataset.requesterId = data.requester.id;
            acceptCallBtn.dataset.channel = data.channel;
        }
        if (declineCallBtn) {
            declineCallBtn.dataset.requesterId = data.requester.id;
            declineCallBtn.dataset.channel = data.channel;
        }
        if (incomingCallModal) incomingCallModal.style.display = 'flex';
    });

    socket.on('video:invite_accepted', (data) => {
        joinVideoRoom(data.channel);
    });

    socket.on('video:call_ended', () => {
        updateUserStatusAndConnections();
    });

    socket.on('video:invite_declined', (data) => { alert(data.message); });
    socket.on('video:recipient_offline', (data) => { alert(data.message); });
    socket.on('video:error', (data) => { alert(`Erro: ${data.message}`); });
    socket.on('roomCounts', (counts) => {
        for (const room in counts) {
            const countElement = document.getElementById(`count-${room}`);
            if (countElement) countElement.textContent = counts[room];
        }
    });
    socket.on('stopPlayerCountUpdate', (count) => {
        const countElement = document.getElementById('stop-player-count');
        if (countElement) countElement.textContent = count;
    });
});
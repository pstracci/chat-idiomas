// /js/global.js (COMPLETO E COM NOVAS FUNCIONALIDADES)
window.loggedInUser = null; // NOVO: Torna o usuário logado acessível globalmente

function signalAuthReady() {
    document.dispatchEvent(new CustomEvent('authReady'));
}

document.addEventListener('DOMContentLoaded', () => {
    const loggedInView = document.getElementById('logged-in-view');
    const loggedOutView = document.getElementById('logged-out-view');
    const welcomeMessage = document.getElementById('welcome-message');
    const connectionsList = document.getElementById('connections-list'); 
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

    function populateNotifications(notifications) {
        if (!requestsList || !notificationCount || !notificationBell) return;

        requestsList.innerHTML = '';
        const unreadNotifications = notifications.filter(n => !n.read);
        const unreadCount = unreadNotifications.length;

        if (unreadCount > 0) {
            notificationCount.textContent = unreadCount;
            notificationCount.style.display = 'flex';
            
            unreadNotifications.forEach(notification => {
                const li = document.createElement('li');
                li.style.padding = '10px 15px';
                li.style.borderBottom = '1px solid #eee';
                li.dataset.notificationId = notification.id;

                let notificationHTML = '';
                
                switch (notification.type) {
                    case 'CONNECTION_REQUEST':
                        notificationHTML = `
                            <div class="request-item" style="display: flex; align-items: center; gap: 10px;">
                                <img src="${notification.requester.profile?.profilePicture || '/default-avatar.png'}" alt="Avatar" style="width: 40px; height: 40px; border-radius: 50%;">
                                <span style="flex-grow: 1; font-size: 0.9em;"><b>${notification.requester.nickname}</b> quer se conectar.</span>
                                <div class="notification-actions">
                                    <button class="btn-notification btn-notification-accept" data-connection-id="${notification.relatedId}">Aceitar</button>
                                    <button class="btn-notification btn-notification-decline" data-connection-id="${notification.relatedId}">Recusar</button>
                                </div>
                            </div>`;
                        break;
                    
                    case 'SYSTEM_MESSAGE':
                        notificationHTML = `
                            <div class="request-item" style="display: flex; align-items: center; gap: 10px;">
                                <span style="font-size: 1.8em;">📢</span>
                                <span style="flex-grow: 1; font-size: 0.9em;">${notification.content}</span>
                                <div class="notification-actions">
                                    <button class="btn-notification btn-notification-dismiss" data-notification-id="${notification.id}" title="Marcar como lida">&times;</button>
                                </div>
                            </div>`;
                        break;

                    default:
                        notificationHTML = `<div class="request-item" style="font-size: 0.9em;">${notification.content}</div>`;
                        break;
                }
                
                li.innerHTML = notificationHTML;
                requestsList.appendChild(li);
            });
        } else {
            notificationCount.style.display = 'none';
            requestsList.innerHTML = '<li style="padding: 15px; text-align: center; color: #6c757d;">Nenhuma nova notificação.</li>';
        }
    }

    async function updateUserStatusAndConnections() {
        const connectionsTab = document.querySelector('.tab-button[data-tab="connections-panel"]');
        const filterTab = document.querySelector('.tab-button[data-tab="filter-panel"]');
        const connectionsPanel = document.getElementById('connections-panel');
        const filterPanel = document.getElementById('filter-panel');

        try {
            const response = await fetch('/api/user/status');
            const data = await response.json();

            if (data.loggedIn) {
                window.loggedInUser = data.user; // NOVO: Armazena os dados do usuário
                loggedInUserId = data.user.id;
                if (loggedInView) loggedInView.style.display = 'flex';
                if (loggedOutView) loggedOutView.style.display = 'none';
                if (welcomeMessage) welcomeMessage.textContent = `Olá, ${data.user.nickname}!`;
                
                if (adminLinkContainer && data.user.role === 'ADMIN') {
                    adminLinkContainer.innerHTML = `<a href="/admin.html">Admin</a>`;
                } else if (adminLinkContainer) {
                    adminLinkContainer.innerHTML = '';
                }

                if (data.notifications) {
                    populateNotifications(data.notifications);
                }

                if (connectionsList) {
                    populateConnectionsList(data.connections);
                }
            } else {
                window.loggedInUser = null; // NOVO: Garante que a variável esteja nula se deslogado
                loggedInUserId = null;
                if (loggedInView) loggedInView.style.display = 'none';
                if (loggedOutView) loggedOutView.style.display = 'block';

                if (connectionsTab) connectionsTab.style.display = 'none';

                if (filterTab && filterPanel && connectionsPanel) {
                    if(connectionsTab) connectionsTab.classList.remove('active');
                    if(connectionsPanel) connectionsPanel.classList.remove('active');
                    filterTab.classList.add('active');
                    filterPanel.classList.add('active');
                }
            }
        } catch (error) {
            console.error('Falha ao atualizar o status do usuário:', error);
            if (connectionsTab) connectionsTab.style.display = 'none';
        } finally {
            signalAuthReady();
        }
    }
    
    async function openDirectMessageWidget(recipientId, recipientNickname, recipientAvatar) {
        if (currentOpenChat.userId !== recipientId) {
            try {
                await fetch(`/api/dm/conversations/read/${recipientId}`, { method: 'PUT' });
                if(connectionsList){
                    const connectionItem = connectionsList.querySelector(`.connection-item[data-user-id='${recipientId}']`);
                    const badge = connectionItem?.querySelector('.dm-notification-badge');
                    if (badge) badge.remove();
                }
            } catch (error) { console.error("Erro ao marcar mensagens como lidas:", error); }
        }
        if (dmWidget && currentOpenChat.userId === recipientId && dmWidget.style.display === 'flex') return;
        
        currentOpenChat = { userId: recipientId, nickname: recipientNickname, avatar: recipientAvatar };
        if(dmRecipientAvatar) dmRecipientAvatar.src = recipientAvatar || '/default-avatar.png';
        if(dmRecipientName) dmRecipientName.textContent = recipientNickname;
        if(dmWidgetBody) dmWidgetBody.innerHTML = '';
        if(dmWidget) dmWidget.style.display = 'flex';
        if(dmWidgetBody) dmWidgetBody.style.display = 'flex';
        if(toggleDmWidget) toggleDmWidget.textContent = '-';
        try {
            const response = await fetch(`/api/dm/history/${recipientId}`);
            if (!response.ok) throw new Error('Falha ao buscar histórico.');
            const data = await response.json();
            if(data.messages) data.messages.forEach(appendMessageToDmWidget);
        } catch (error) {
            console.error(error);
            if(dmWidgetBody) dmWidgetBody.innerHTML = '<p style="color: #6c757d; text-align: center;">Não foi possível carregar as mensagens.</p>';
        }
    }

    function appendMessageToDmWidget(message) {
        if (!message.text || !dmWidgetBody) return;
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('dm-message');
        messageDiv.textContent = message.text;
        messageDiv.classList.add(message.senderId === loggedInUserId ? 'sent' : 'received');
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
                if(dmInput){ dmInput.value += emoji; dmInput.focus(); }
            });
            dmEmojiPicker.appendChild(span);
        });
    }

   function populateConnectionsList(connections) {
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
            let badgeHTML = conn.friendInfo.unreadCount > 0 ? `<span class="dm-notification-badge">${conn.friendInfo.unreadCount}</span>` : '';

            li.innerHTML = `
                <span class="status-dot ${statusClass}" title="${statusTitle}"></span>
                <a href="/profile.html?userId=${conn.friendInfo.id}" class="connection-item-link">
                    <img src="${conn.friendInfo.profilePicture || '/default-avatar.png'}" alt="Avatar">
                    <span>${conn.friendInfo.nickname}</span>
                </a>
                <div class="action-buttons">
                    <button class="btn-chat" title="Conversar com ${conn.friendInfo.nickname}">💬${badgeHTML}</button>
                </div>
            `;
            connectionsList.appendChild(li);
        });
    }
    
    updateUserStatusAndConnections();
    populateDmEmojiPicker();

    if (dmForm) {
        dmForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const text = dmInput.value.trim();
            if (!text || !currentOpenChat.userId) return;
            socket.emit('directMessage', { recipientId: currentOpenChat.userId, text: text });
            appendMessageToDmWidget({ text, senderId: loggedInUserId });
            dmInput.value = '';
            dmInput.focus();
        });
    }
    if (closeDmWidget) {
        closeDmWidget.addEventListener('click', () => {
            if(dmWidget) dmWidget.style.display = 'none';
            currentOpenChat = { userId: null };
        });
    }
    if (toggleDmWidget) {
        toggleDmWidget.addEventListener('click', () => {
            if(dmWidgetBody){
                const isVisible = dmWidgetBody.style.display !== 'none';
                dmWidgetBody.style.display = isVisible ? 'none' : 'flex';
                toggleDmWidget.textContent = isVisible ? '+' : '-';
            }
        });
    }
    if (dmEmojiBtn) {
        dmEmojiBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if(dmEmojiPicker) dmEmojiPicker.style.display = dmEmojiPicker.style.display === 'grid' ? 'none' : 'grid';
        });
    }
    if (connectionsList) {
        connectionsList.addEventListener('click', (e) => {
            const targetButton = e.target.closest('button');
            if (!targetButton) return;
            const connectionItem = targetButton.closest('.connection-item');
            if (!connectionItem) return;
            
            const friendId = connectionItem.dataset.userId;

            if (targetButton.classList.contains('btn-video')) {
                if (confirm("Iniciar uma chamada de vídeo custará 1 crédito. Deseja prosseguir?")) {
                    socket.emit('video:invite', { recipientId: friendId });
                }
            } else if (targetButton.classList.contains('btn-chat')) {
                window.location.href = `/dm.html?with=${friendId}`;
            }
        });
    }
    if (acceptCallBtn) {
        acceptCallBtn.addEventListener('click', () => {
            const { requesterId, channel } = acceptCallBtn.dataset;
            socket.emit('video:accept', { requesterId, channel });
            if(incomingCallModal) incomingCallModal.style.display = 'none';
        });
    }
    if (declineCallBtn) {
        declineCallBtn.addEventListener('click', () => {
            const { requesterId, channel } = declineCallBtn.dataset;
            socket.emit('video:decline', { requesterId, channel });
            if(incomingCallModal) incomingCallModal.style.display = 'none';
        });
    }
    
    if (notificationBell) {
        notificationBell.addEventListener('click', (e) => {
            e.stopPropagation();
            if (notificationsDropdown) {
                const isVisible = notificationsDropdown.style.display === 'block';
                notificationsDropdown.style.display = isVisible ? 'none' : 'block';
            }
        });
    }
    
    if (requestsList) {
        requestsList.addEventListener('click', async (e) => {
            const button = e.target.closest('button');
            if (!button) return;

            e.stopPropagation(); 

            if (button.classList.contains('btn-notification-dismiss')) {
                const notificationId = button.dataset.notificationId;
                const notificationItem = button.closest('li');

                try {
                    const response = await fetch(`/api/notifications/${notificationId}/read`, { method: 'PUT' });
                    if (response.ok) {
                        notificationItem.remove();
                        const currentCount = parseInt(notificationCount.textContent, 10);
                        const newCount = currentCount - 1;
                        notificationCount.textContent = newCount;
                        if (newCount <= 0) {
                            notificationCount.style.display = 'none';
                            requestsList.innerHTML = '<li style="padding: 15px; text-align: center; color: #6c757d;">Nenhuma nova notificação.</li>';
                        }
                    }
                } catch (error) {
                    console.error('Erro ao marcar notificação como lida:', error);
                }
            }

            if (button.classList.contains('btn-notification-accept') || button.classList.contains('btn-notification-decline')) {
                const connectionId = button.dataset.connectionId;
                const action = button.classList.contains('btn-notification-accept') ? 'accept' : 'delete';

                try {
                    const response = await fetch(`/api/connections/${action}/${connectionId}`, {
                        method: action === 'accept' ? 'PUT' : 'DELETE'
                    });

                    if (response.ok) {
                        updateUserStatusAndConnections();
                    } else {
                        const result = await response.json();
                        alert(result.error || 'Ocorreu um erro ao responder ao pedido.');
                    }
                } catch (error) {
                    console.error('Erro ao responder ao pedido de conexão:', error);
                }
            }
        });
    }

    document.addEventListener('click', (e) => {
        if (notificationsDropdown && notificationContainer && !notificationContainer.contains(e.target)) {
            notificationsDropdown.style.display = 'none';
        }
        if (dmEmojiPicker && dmEmojiBtn && !dmEmojiPicker.contains(e.target) && e.target !== dmEmojiBtn) {
            dmEmojiPicker.style.display = 'none';
        }
    });

    socket.on('stopPlayerCountUpdate', (count) => {
        const countElement = document.getElementById('stop-player-count');
        if (countElement) countElement.textContent = count;
    });

    socket.on('new_notification', () => {
        console.log("%c[Socket.IO] Evento 'new_notification' RECEBIDO DO SERVIDOR!", "color: lightgreen; font-weight: bold; font-size: 14px;");
        updateUserStatusAndConnections();

        if (notificationBell) {
            notificationBell.style.animation = 'shake 0.5s';
            setTimeout(() => {
                notificationBell.style.animation = '';
            }, 500);
        }
    });
});
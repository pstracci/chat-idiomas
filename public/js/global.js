// public/js/global.js
document.addEventListener('DOMContentLoaded', () => {
    // --- ELEMENTOS DA UI GLOBAIS ---
    const loggedInView = document.getElementById('logged-in-view');
    const loggedOutView = document.getElementById('logged-out-view');
    const welcomeMessage = document.getElementById('welcome-message');
    const connectionsWidget = document.getElementById('connections-widget');
    const connectionsList = document.getElementById('connections-list');
    const toggleWidget = document.getElementById('toggle-widget');
    const widgetBody = document.getElementById('widget-body');
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

    // --- ESTADO DA APLICAÇÃO ---
    const socket = io();
    let loggedInUserId = null;

    // --- FUNÇÕES GLOBAIS ---
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
            const joinUrl = `/videocall.html?appId=${encodeURIComponent(data.appId)}&channel=${encodeURIComponent(data.channel)}&token=${encodeURIComponent(data.token)}`;
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
            li.innerHTML = `
                <span class="status-dot ${statusClass}" title="${statusTitle}"></span>
                <a href="/profile.html?userId=${conn.friendInfo.id}" class="connection-item-link">
                    <img src="${conn.friendInfo.profilePicture || '/default-avatar.png'}" alt="Avatar">
                    <span>${conn.friendInfo.nickname}</span>
                </a>
                <div class="action-buttons">
                    <button class="btn-video" title="Iniciar chamada de vídeo com ${conn.friendInfo.nickname}">🎥</button>
                    <button class="btn-chat" data-id="${conn.friendInfo.id}" data-nickname="${conn.friendInfo.nickname}" title="Conversar com ${conn.friendInfo.nickname}">💬</button>
                </div>
            `;
            connectionsList.appendChild(li);
        });
    }

    // --- LÓGICA DE NOTIFICAÇÕES (RESTAURADA E INTEGRADA) ---
    function renderNotifications(notifications) {
        if (!requestsList || !notificationBell || !notificationCount) return;
        requestsList.innerHTML = '';
        notificationBell.style.display = 'flex';
        const unreadNotifications = notifications.filter(n => !n.isRead);
        if (unreadNotifications.length === 0) {
            notificationCount.style.display = 'none';
            requestsList.innerHTML = '<li style="padding: 15px; text-align: center; color: #6c757d;">Nenhuma notificação nova.</li>';
            return;
        }
        notificationCount.textContent = unreadNotifications.length;
        notificationCount.style.display = 'flex';
        unreadNotifications.forEach(notif => {
            const li = document.createElement('li');
            li.className = 'request-item';
            if (notif.type === 'CONNECTION_REQUEST' && notif.requester) {
                li.innerHTML = `
                    <img src="${notif.requester.profilePicture || '/default-avatar.png'}" alt="Avatar">
                    <div class="info"><strong>${notif.requester.nickname}</strong> quer se conectar.</div>
                    <div class="actions">
                        <button class="btn-accept" data-id="${notif.relatedId}">Aceitar</button>
                        <button class="btn-reject" data-id="${notif.relatedId}">Recusar</button>
                    </div>
                `;
            }
            // Adicione outros tipos de notificação aqui se necessário
            requestsList.appendChild(li);
        });
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

    async function handleRequestAction(connectionId, action) { 
        const url = action === 'accept' ? `/api/connections/accept/${connectionId}` : `/api/connections/delete/${connectionId}`; 
        const method = action === 'accept' ? 'PUT' : 'DELETE'; // DELETE para rejeitar
        try { 
            const response = await fetch(url, { method });
            if (!response.ok) throw new Error('Falha na ação de conexão.');
            // Recarrega os widgets e notificações para refletir a mudança
            fetch('/api/user/status').then(res => res.json()).then(data => {
                if (data.loggedIn) populateConnectionsWidget(data.connections);
            });
            loadAndDisplayNotifications();
        } catch (error) { alert(error.message); } 
    }
    
    // --- FETCH INICIAL E LÓGICA DE LOGIN ---
    fetch('/api/user/status').then(res => res.json()).then(data => {
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
            // Carrega as notificações para o usuário logado
            loadAndDisplayNotifications();
        } else {
            if (loggedInView) loggedInView.style.display = 'none';
            if (loggedOutView) loggedOutView.style.display = 'block';
        }
    });

    // --- LISTENERS DE EVENTOS DE UI GLOBAIS ---
    if (connectionsList) {
        connectionsList.addEventListener('click', (e) => {
            const videoButton = e.target.closest('.btn-video');
            if (videoButton && !videoButton.classList.contains('pending') && !videoButton.classList.contains('active')) {
                const friendId = videoButton.closest('.connection-item')?.dataset.userId;
                if (!friendId) return;
                if (confirm("Iniciar uma chamada de vídeo custará 1 crédito. Deseja prosseguir?")) {
                    socket.emit('video:invite', { recipientId: friendId });
                }
            } else if (videoButton) {
                alert("Esta chamada já está em andamento ou aguardando resposta.");
            }
        });
    }
    
    if (toggleWidget) {
        toggleWidget.addEventListener('click', () => {
            const widgetBody = document.getElementById('widget-body');
            const isVisible = widgetBody.style.display !== 'none';
            widgetBody.style.display = isVisible ? 'none' : 'block';
            toggleWidget.textContent = isVisible ? '+' : '-';
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
                handleRequestAction(e.target.dataset.id, 'accept');
            } else if (e.target.matches('.btn-reject')) {
                handleRequestAction(e.target.dataset.id, 'reject');
            }
        });
    }

    window.addEventListener('click', (e) => {
        if (notificationContainer && !notificationContainer.contains(e.target)) {
            if(notificationsDropdown) notificationsDropdown.classList.remove('active');
        }
    });

    // --- LISTENERS DE SOCKET GLOBAIS ---
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

    socket.on('video:invite_sent', (data) => {
        const { recipientId } = data;
        const connectionItem = document.querySelector(`.connection-item[data-user-id='${recipientId}']`);
        if (connectionItem) {
            const videoButton = connectionItem.querySelector('.btn-video');
            videoButton.innerHTML = '🕒';
            videoButton.title = 'Aguardando resposta...';
            videoButton.classList.add('pending');
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

    socket.on('video:invite_declined', (data) => {
        alert(data.message);
        const allPendingButtons = document.querySelectorAll('.btn-video.pending');
        allPendingButtons.forEach(button => {
            button.innerHTML = '🎥';
            button.title = 'Iniciar chamada de vídeo';
            button.classList.remove('pending');
        });
    });

    socket.on('video:call_started', (data) => {
        if (!loggedInUserId) return;
        const otherParticipantId = data.participants.find(id => id !== loggedInUserId);
        if (otherParticipantId) {
            const connectionItem = document.querySelector(`.connection-item[data-user-id='${otherParticipantId}']`);
            if (connectionItem) {
                const videoButton = connectionItem.querySelector('.btn-video');
                videoButton.innerHTML = '🔴';
                videoButton.title = 'Chamada em andamento';
                videoButton.classList.remove('pending');
                videoButton.classList.add('active');
            }
        }
    });

    socket.on('video:call_ended', () => {
        const allActiveButtons = document.querySelectorAll('.btn-video.active, .btn-video.pending');
        allActiveButtons.forEach(button => {
            button.innerHTML = '🎥';
            button.title = 'Iniciar chamada de vídeo';
            button.classList.remove('pending', 'active');
        });
    });
    
    socket.on('video:recipient_offline', (data) => {
        alert(data.message);
        const pendingButton = document.querySelector('.btn-video.pending');
        if (pendingButton) {
            pendingButton.innerHTML = '🎥';
            pendingButton.title = 'Iniciar chamada de vídeo';
            pendingButton.classList.remove('pending');
        }
    });
    
    socket.on('video:error', (data) => {
        alert(`Erro: ${data.message}`);
        const pendingButton = document.querySelector('.btn-video.pending');
        if (pendingButton) {
            pendingButton.innerHTML = '🎥';
            pendingButton.title = 'Iniciar chamada de vídeo';
            pendingButton.classList.remove('pending');
        }
    });
});
// /js/dm.js (COM INDICADOR "DIGITANDO" E NICKNAME NAS MENSAGENS)
document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // --- SEÇÃO: ELEMENTOS DA UI ---
    const searchInput = document.getElementById('search-conversations');
    const clearSearchBtn = document.getElementById('clear-search-btn');
    const conversationsList = document.getElementById('conversations-list');
    const headerUserName = document.getElementById('header-user-name');
    const headerUserAvatar = document.getElementById('header-user-avatar');
    const incomingCallModal = document.getElementById('incoming-call-modal');
    const callerAvatar = document.getElementById('caller-avatar');
    const callerName = document.getElementById('caller-name');
    const acceptCallBtn = document.getElementById('accept-call-btn');
    const declineCallBtn = document.getElementById('decline-call-btn');
    const welcomeMessage = document.getElementById('welcome-message');
    const chatContent = document.getElementById('chat-content');
    const chatUserName = document.getElementById('chat-user-name');
    const chatUserAvatar = document.getElementById('chat-user-avatar');
    const chatUserProfileLink = document.getElementById('chat-user-profile-link');
    const chatUserStatus = document.getElementById('chat-user-status');
    const chatUserStatusDot = document.getElementById('chat-user-status-dot');
    const videoCallBtn = document.getElementById('video-call-btn');
    const messagesContainer = document.getElementById('messages-container');
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    const imageBtn = document.getElementById('image-btn');
    const imageInput = document.getElementById('image-input');
    const emojiBtn = document.getElementById('emoji-btn');
    const emojiPicker = document.getElementById('emoji-picker');
    // NOVO: Elementos do indicador "digitando"
    const typingIndicator = document.getElementById('typing-indicator');
    const typingUserName = document.getElementById('typing-user-name');


    // --- SEÇÃO: VARIÁVEIS DE ESTADO ---
    let currentChatUserId = null;
    let loggedInUser = null;
    let currentParticipant = null;
    let typingTimeout = null; // Para controlar o evento de parar de digitar

    const params = new URLSearchParams(window.location.search);
    const initialChatUserId = params.get('with');

    // --- SEÇÃO: FUNÇÕES PRINCIPAIS ---

    async function fetchLoggedInUser() {
        try {
            const response = await fetch('/api/user/status');
            const data = await response.json();
            if (data.loggedIn) {
                loggedInUser = data.user;
                headerUserName.textContent = loggedInUser.nickname;
                headerUserAvatar.src = loggedInUser.profile?.profilePicture || '/default-avatar.png';
            } else {
                window.location.href = '/login.html';
            }
        } catch (error) {
            console.error('Erro ao buscar dados do usuário:', error);
        }
    }

    async function loadConversations() {
        try {
            const response = await fetch('/api/dm/conversations');
            if (!response.ok) throw new Error('Falha na resposta da API');
            const conversations = await response.json();
            conversationsList.innerHTML = '';

            if (conversations.length === 0) {
                conversationsList.innerHTML = '<li class="no-conversations">Nenhuma conversa encontrada.</li>';
                return;
            }

            conversations.forEach(conv => {
                const li = document.createElement('li');
                li.className = 'conversation-item';
                li.dataset.userId = conv.participant.id;
                const unreadBadge = conv.unreadCount > 0 ? `<span class="unread-badge">${conv.unreadCount}</span>` : '';
                const lastMessageText = conv.lastMessage?.text || (conv.lastMessage?.imageData ? 'Imagem' : 'Inicie a conversa');
                li.innerHTML = `
                    <img src="${conv.participant.profilePicture || '/default-avatar.png'}" alt="Avatar">
                    <div class="conversation-details">
                        <h4>${conv.participant.nickname}</h4>
                        <p>${lastMessageText}</p>
                    </div>
                    ${unreadBadge}`;
                li.addEventListener('click', () => {
                    history.pushState(null, '', `/dm.html?with=${conv.participant.id}`);
                    loadChat(conv.participant.id);
                });
                conversationsList.appendChild(li);
            });
        } catch (error) {
            console.error('Erro ao carregar conversas:', error);
            conversationsList.innerHTML = '<li class="no-conversations">Não foi possível carregar suas conversas.</li>';
        }
    }
    
    async function loadChat(userId) {
        if (currentChatUserId === userId) return;
        currentChatUserId = userId;
        
        const convItem = conversationsList.querySelector(`.conversation-item[data-user-id='${userId}']`);
        const badge = convItem?.querySelector('.unread-badge');
        if (badge) {
            badge.remove();
            try {
                await fetch(`/api/dm/conversations/read/${userId}`, { method: 'PUT' });
            } catch (error) {
                console.error("Erro ao marcar mensagens como lidas:", error);
            }
        }

        welcomeMessage.style.display = 'none';
        chatContent.style.display = 'flex';
        messagesContainer.innerHTML = '<p class="loading-message">Carregando...</p>';
        document.querySelectorAll('.conversation-item').forEach(item => {
            item.classList.toggle('active', item.dataset.userId === userId);
        });

        try {
            const response = await fetch(`/api/dm/history/${userId}`);
            const data = await response.json();
            if (!data || !data.participant) throw new Error("Dados do participante não recebidos.");

            currentParticipant = data.participant;
            chatUserName.textContent = currentParticipant.nickname;
            chatUserAvatar.src = currentParticipant.profile?.profilePicture || '/default-avatar.png';
            chatUserProfileLink.href = `/profile.html?userId=${userId}`;
            document.getElementById('view-profile-link').href = `/profile.html?userId=${userId}`;
            updateParticipantStatus(currentParticipant.isOnline);
            videoCallBtn.dataset.recipientId = userId;
            messagesContainer.innerHTML = '';
            data.messages.forEach(appendMessage);
        } catch (error) {
            console.error('Erro ao carregar chat:', error);
            messagesContainer.innerHTML = '<p class="loading-message">Não foi possível carregar o chat.</p>';
        }
    }
    
    // ATUALIZADO: Função appendMessage agora inclui o NICKNAME
    function appendMessage(message) {
        if (!loggedInUser) return; 

        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper';
        
        const senderId = message.senderId || message.sender?.id;
        const isSentByMe = senderId === loggedInUser.id;
        wrapper.classList.add(isSentByMe ? 'sent' : 'received');

        const avatar = document.createElement('img');
        avatar.className = 'message-avatar';
        
        let avatarSrc = '/default-avatar.png';
        if (isSentByMe) {
            avatarSrc = loggedInUser.profile?.profilePicture || '/default-avatar.png';
        } else {
            avatarSrc = message.sender?.profile?.profilePicture || currentParticipant?.profile?.profilePicture || '/default-avatar.png';
        }
        avatar.src = avatarSrc;
        
        const profileLink = document.createElement('a');
        profileLink.href = `/profile.html?userId=${senderId}`;
        profileLink.appendChild(avatar);

        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message');

        // --- INÍCIO: NICKNAME ADICIONADO AO BALÃO DE MENSAGEM ---
        const nicknameEl = document.createElement('strong');
        nicknameEl.className = 'message-nickname';
        nicknameEl.textContent = message.sender?.nickname || (isSentByMe ? loggedInUser.nickname : currentParticipant.nickname);
        messageDiv.appendChild(nicknameEl);
        // --- FIM: NICKNAME ADICIONADO AO BALÃO DE MENSAGEM ---

        if (message.text) {
            const textNode = document.createElement('span');
            textNode.textContent = message.text;
            messageDiv.appendChild(textNode);
        }

        const imageSource = message.imageData || message.imageUrl;
        if (imageSource) {
            const img = document.createElement('img');
            img.src = imageSource;
            img.className = 'chat-image';
            img.onclick = () => window.open(imageSource, '_blank');
            messageDiv.appendChild(img);
        }

        wrapper.appendChild(profileLink);
        wrapper.appendChild(messageDiv);
        messagesContainer.appendChild(wrapper);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    function updateParticipantStatus(isOnline) {
        if (currentParticipant) {
            currentParticipant.isOnline = isOnline;
            chatUserStatus.textContent = isOnline ? 'Online' : 'Offline';
            chatUserStatusDot.className = isOnline ? 'status-dot online' : 'status-dot offline';
        }
    }

    // --- SEÇÃO: EVENT LISTENERS ---
    messageForm.addEventListener('submit', (e) => { 
        e.preventDefault(); 
        const text = messageInput.value.trim(); 
        if (!text || !currentChatUserId) return; 
        socket.emit('directMessage', { recipientId: currentChatUserId, text }); 
        // Avisa que parou de digitar ao enviar
        socket.emit('dm:typing:stop', { recipientId: currentChatUserId });
        clearTimeout(typingTimeout);
        typingTimeout = null;
        messageInput.value = ''; 
    });
    
    // ATUALIZADO: Event listener de digitação
    messageInput.addEventListener('input', () => {
        if (!currentChatUserId) return;
        
        if (!typingTimeout) {
            // Se não estiver em timeout, significa que é o início da digitação
            socket.emit('dm:typing:start', { recipientId: currentChatUserId });
        } else {
            // Se já existe um timeout, limpa para resetar
            clearTimeout(typingTimeout);
        }

        // Cria um novo timeout. Se o usuário parar de digitar por 2s, envia o evento 'stop'.
        typingTimeout = setTimeout(() => {
            socket.emit('dm:typing:stop', { recipientId: currentChatUserId });
            typingTimeout = null; // Limpa a variável para indicar que não está mais digitando
        }, 2000);
    });

    imageInput.addEventListener('change', async (e) => { const file = e.target.files[0]; if (!file || !file.type.startsWith('image/')) return; if (file.size > 5e6) return alert('A imagem é muito grande! O limite é 5MB.'); try { const resizedImageData = await resizeImage(file); if (!currentChatUserId) return; socket.emit('directMessage', { recipientId: currentChatUserId, imageData: resizedImageData }); } catch (error) { console.error("Erro ao processar a imagem:", error); } finally { e.target.value = ''; } });
    videoCallBtn.addEventListener('click', () => { if (!currentChatUserId) return alert('Selecione uma conversa para iniciar uma chamada.'); if (confirm("Iniciar uma chamada de vídeo custará 1 crédito. Deseja prosseguir?")) { socket.emit('video:invite', { recipientId: currentChatUserId }); } });
    acceptCallBtn.addEventListener('click', () => { socket.emit('video:accept', { requesterId: acceptCallBtn.dataset.requesterId, channel: acceptCallBtn.dataset.channel }); incomingCallModal.style.display = 'none'; });
    declineCallBtn.addEventListener('click', () => { socket.emit('video:decline', { requesterId: declineCallBtn.dataset.requesterId, channel: declineCallBtn.dataset.channel }); incomingCallModal.style.display = 'none'; });
    
    // --- SEÇÃO: SOCKET LISTENERS ---
    function registerSocketListeners() {
        socket.on('video:invite_sent', async (data) => {
            const { channel } = data;
            if (!channel) return console.error('ID do canal não recebido ao enviar convite.');
            try {
                const response = await fetch(`/api/video/token?channel=${channel}`);
                if (!response.ok) throw new Error((await response.json()).message || 'Falha ao obter credenciais.');
                const { appId, token, uid } = await response.json();
                const videoUrl = `/videocall.html?appId=${appId}&channel=${channel}&token=${token}&uid=${uid}`;
                window.open(videoUrl, '_blank', 'width=1200,height=800');
            } catch (error) {
                console.error('Erro ao iniciar a chamada de vídeo para o chamador:', error);
                alert('Não foi possível entrar na sala de vídeo.');
            }
        });

        socket.on('directMessage', (message) => {
            const isForCurrentChat = message.senderId === currentChatUserId || (message.senderId === loggedInUser.id && message.recipientId === currentChatUserId);
            
            if (isForCurrentChat) {
                // Ao receber uma mensagem, garante que o indicador "digitando" seja escondido
                typingIndicator.style.display = 'none';
                appendMessage(message);
                if (message.senderId !== loggedInUser.id) {
                    fetch(`/api/dm/conversations/read/${message.senderId}`, { method: 'PUT' });
                }
            }
            
            loadConversations().then(() => {
                if(currentChatUserId) {
                    document.querySelectorAll('.conversation-item').forEach(item => {
                        item.classList.toggle('active', item.dataset.userId === currentChatUserId);
                    });
                }
            });
        });

        socket.on('video:invite_accepted', async (data) => {
            const { channel } = data;
            if (!channel) return console.error('ID do canal não recebido para iniciar a chamada.');
            if (window.location.pathname.includes('/videocall.html')) return;
            try {
                const response = await fetch(`/api/video/token?channel=${channel}`);
                if (!response.ok) throw new Error((await response.json()).message || 'Falha ao obter credenciais.');
                const { appId, token, uid } = await response.json();
                const videoUrl = `/videocall.html?appId=${appId}&channel=${channel}&token=${token}&uid=${uid}`;
                window.open(videoUrl, '_blank', 'width=1200,height=800');
            } catch (error) {
                console.error('Erro ao iniciar a chamada de vídeo:', error);
                alert('Não foi possível entrar na sala de vídeo.');
            }
        });

        socket.on('video:incoming_invite', (data) => {
            callerAvatar.src = data.requester.profilePicture || '/default-avatar.png';
            callerName.innerText = data.requester.nickname;
            acceptCallBtn.dataset.requesterId = data.requester.id;
            acceptCallBtn.dataset.channel = data.channel;
            declineCallBtn.dataset.requesterId = data.requester.id;
            declineCallBtn.dataset.channel = data.channel;
            incomingCallModal.style.display = 'flex';
        });

        socket.on('user_status_change', (data) => {
            if (data.userId === currentChatUserId) {
                updateParticipantStatus(data.isOnline);
            }
        });

        // --- INÍCIO: NOVOS LISTENERS PARA "DIGITANDO" ---
        socket.on('dm:typing:start', (data) => {
            // Mostra o indicador apenas se for da conversa atualmente aberta
            if (data.senderId === currentChatUserId) {
                typingUserName.textContent = data.senderNickname;
                typingIndicator.style.display = 'flex';
            }
        });

        socket.on('dm:typing:stop', (data) => {
            // Esconde o indicador se for da conversa atualmente aberta
            if (data.senderId === currentChatUserId) {
                typingIndicator.style.display = 'none';
            }
        });
        // --- FIM: NOVOS LISTENERS PARA "DIGITANDO" ---
    }


    // --- SEÇÃO: INICIALIZAÇÃO ---
    async function initializePage() {
        await fetchLoggedInUser();
        if (loggedInUser) {
            registerSocketListeners();
        }
        await loadConversations();
        if (initialChatUserId) {
            loadChat(initialChatUserId);
        }
    }
    
    initializePage();

    function resizeImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = document.createElement('img');
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const MAX_WIDTH = 800;
                    const MAX_HEIGHT = 800;
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > MAX_WIDTH) {
                            height *= MAX_WIDTH / width;
                            width = MAX_WIDTH;
                        }
                    } else {
                        if (height > MAX_HEIGHT) {
                            width *= MAX_HEIGHT / height;
                            height = MAX_HEIGHT;
                        }
                    }
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    resolve(canvas.toDataURL('image/jpeg', 0.8));
                };
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }
});
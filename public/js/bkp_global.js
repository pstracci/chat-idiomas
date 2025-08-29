// /js/dm.js
document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // Elementos do Cabeçalho
    const headerUserName = document.getElementById('header-user-name');
    const headerUserAvatar = document.getElementById('header-user-avatar');
    const userProfileToggle = document.getElementById('user-profile-toggle');
    const dropdownMenu = document.getElementById('dropdown-menu');

    // Elementos do Chat
    const conversationsList = document.getElementById('conversations-list');
    const welcomeMessage = document.getElementById('welcome-message');
    const chatContent = document.getElementById('chat-content');
    const chatUserName = document.getElementById('chat-user-name');
    const chatUserAvatar = document.getElementById('chat-user-avatar');
    const chatUserStatus = document.getElementById('chat-user-status');
    const videoCallBtn = document.getElementById('video-call-btn');
    const messagesContainer = document.getElementById('messages-container');
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    
    let currentChatUserId = null;
    let loggedInUser = null;

    const params = new URLSearchParams(window.location.search);
    const initialChatUserId = params.get('with');

    // [NOVO] Busca dados do usuário logado para o cabeçalho
    async function fetchLoggedInUser() {
        try {
            const response = await fetch('/api/user/status');
            const data = await response.json();
            if (data.loggedIn) {
                loggedInUser = data.user;
                headerUserName.textContent = loggedInUser.nickname;
                headerUserAvatar.src = loggedInUser.profile?.profilePicture || '/default-avatar.png';
            } else {
                window.location.href = '/login.html'; // Redireciona se não estiver logado
            }
        } catch (error) {
            console.error('Erro ao buscar dados do usuário:', error);
            headerUserName.textContent = 'Erro';
        }
    }

    async function loadConversations() {
        try {
            // LEMBRETE: Esta rota precisa ser criada no seu backend
            const response = await fetch('/api/dm/conversations');
            if (!response.ok) throw new Error('Falha na resposta da API');
            
            const conversations = await response.json();

            conversationsList.innerHTML = '';
            if (conversations.length === 0) {
                 conversationsList.innerHTML = '<li style="padding: 20px; color: #6c757d;">Nenhuma conversa encontrada.</li>';
            } else {
                conversations.forEach(conv => {
                    const li = document.createElement('li');
                    li.className = 'conversation-item';
                    li.dataset.userId = conv.participant.id;
                    li.innerHTML = `
                        <img src="${conv.participant.profilePicture || '/default-avatar.png'}" alt="Avatar">
                        <div class="conversation-details">
                            <h4>${conv.participant.nickname}</h4>
                            <p>${conv.lastMessage.text || '...'}</p>
                        </div>
                    `;
                    li.addEventListener('click', () => {
                        history.pushState(null, '', '/dm.html'); 
                        loadChat(conv.participant.id);
                    });
                    conversationsList.appendChild(li);
                });
            }
            
            if (initialChatUserId) {
                loadChat(initialChatUserId);
            }
        } catch (error) {
            console.error('Erro ao carregar conversas:', error);
            conversationsList.innerHTML = '<li style="padding: 20px; color: #6c757d;">Não foi possível carregar suas conversas.</li>';
        }
    }

    async function loadChat(userId) {
        // (O resto da função loadChat, appendMessage, listeners de formulário, etc. continuam iguais ao passo anterior)
        if (currentChatUserId === userId) return;
        currentChatUserId = userId;
        
        welcomeMessage.style.display = 'none';
        chatContent.style.display = 'flex';
        messagesContainer.innerHTML = '<p>Carregando mensagens...</p>';

        document.querySelectorAll('.conversation-item').forEach(item => {
            item.classList.toggle('active', item.dataset.userId === userId);
        });

        try {
            const response = await fetch(`/api/dm/history/${userId}`);
            const data = await response.json();
            
            chatUserName.textContent = data.participant.nickname;
            chatUserAvatar.src = data.participant.profilePicture || '/default-avatar.png';
            chatUserStatus.textContent = data.participant.isOnline ? 'Online' : 'Offline';
            videoCallBtn.dataset.recipientId = userId;
            
            messagesContainer.innerHTML = '';
            data.messages.forEach(appendMessage);
        } catch (error) {
            console.error('Erro ao carregar chat:', error);
            messagesContainer.innerHTML = '<p>Não foi possível carregar o chat.</p>';
        }
    }

    function appendMessage(message) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message');
        // Se o senderId for nulo (mensagem local), assume que foi 'sent'
        messageDiv.classList.add(message.senderId === currentChatUserId ? 'received' : 'sent');
        if (message.imageData) { /* ... */ }
        if (message.text) {
            const textNode = document.createTextNode(message.text);
            messageDiv.appendChild(textNode);
        }
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    messageForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = messageInput.value.trim();
        if (!text || !currentChatUserId) return;
        socket.emit('directMessage', { recipientId: currentChatUserId, text: text });
        appendMessage({ text: text, senderId: loggedInUser.id });
        messageInput.value = '';
    });

    userProfileToggle.addEventListener('click', () => {
        dropdownMenu.classList.toggle('active');
    });

    // Inicia tudo
    async function initializePage() {
        await fetchLoggedInUser();
        await loadConversations();
    }
    
    initializePage();
});
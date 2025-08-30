// client.js (COMPLETO E COM A LÓGICA DE DATA INTEGRADA)

document.addEventListener('DOMContentLoaded', () => {

    function limparNomeSala(nome) {
        return nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '-');
    }

    const params = new URLSearchParams(window.location.search);
    let sala = params.get('sala') || 'geral';
    const guestNickname = params.get('nick');
    const guestIdade = params.get('idade');
    const guestColor = decodeURIComponent(params.get('color')) || '#000000';

    const salaLimpa = limparNomeSala(sala);
    const socket = io();

    // Elementos da UI
    const messagesDiv = document.getElementById('messages');
    const msgInput = document.getElementById('msgInput');
    const sendBtn = document.getElementById('sendBtn');
    const usersDiv = document.getElementById('users');
    const userListContainer = document.getElementById('user-list-container');
    const statusSelect = document.getElementById('statusSelect');
    const emojiBtn = document.getElementById('emojiBtn');
    const emojiPickerContainer = document.getElementById('emojiPickerContainer');
    const mentionSound = document.getElementById('mentionSound');
    const mentionList = document.getElementById('mentionSuggestions');
    const roomTitleEl = document.getElementById('roomTitle');
    const imageBtn = document.getElementById('imageBtn');
    const imageInput = document.getElementById('imageInput');
    const imagePreviewContainer = document.getElementById('imagePreviewContainer');
    const imagePreview = document.getElementById('imagePreview');
    const removeImageBtn = document.getElementById('removeImageBtn');
    const usersBtn = document.getElementById('usersBtn');
    const overlay = document.getElementById('overlay');
    const headerUserProfile = document.querySelector('.user-profile');
    const headerUserName = document.getElementById('header-user-name');
    const headerUserAvatar = document.getElementById('header-user-avatar');
	const typingIndicator = document.getElementById('typing-indicator');
	const typingUserName = document.getElementById('typing-user-name');

    if (roomTitleEl) {
        roomTitleEl.textContent = sala.charAt(0).toUpperCase() + sala.slice(1);
    }

    let isAudioUnlocked = false;
    let usersOnline = [];
    let allRoomUsers = [];
    let mentionMode = false;
    let mentionQuery = '';
    let selectedImageData = null;
    let loggedInUser = null;
    let currentNickname = guestNickname;
    let lastMessageDate = null; // NOVO: Variável para controlar a divisória de data
	let typingTimeout = null;

    // --- INÍCIO: NOVAS FUNÇÕES DE DATA E HORA ---

    // Formata o timestamp para 'DD/MM/YYYY HH:MM:SS'
    function formatTimestamp(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
    }

    // Cria e insere a divisória de data no chat
    function createDateDivider(dateString) {
        const date = new Date(dateString);
        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        let label = '';
        if (date.toDateString() === today.toDateString()) {
            label = 'Hoje';
        } else if (date.toDateString() === yesterday.toDateString()) {
            label = 'Ontem';
        } else {
            label = date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
        }

        const divider = document.createElement('div');
        divider.className = 'date-divider';
        divider.textContent = label;
        messagesDiv.appendChild(divider);
    }

    // --- FIM: NOVAS FUNÇÕES DE DATA E HORA ---

    async function fetchLoggedInUser() {
        try {
            const response = await fetch('/api/user/status');
            const data = await response.json();
            if (data.loggedIn) {
                loggedInUser = data.user;
                currentNickname = loggedInUser.nickname; // Usa o nickname do usuário logado
                headerUserName.textContent = loggedInUser.nickname;
                headerUserAvatar.src = loggedInUser.profile?.profilePicture || loggedInUser.avatar || '/default-avatar.png';
                headerUserProfile.style.display = 'block';
            } else {
                headerUserProfile.style.display = 'none';
            }
        } catch (error) {
            console.error('Não foi possível verificar o status de login:', error);
            headerUserProfile.style.display = 'none'; // Esconde se der erro
        }
    }

    function toggleUsersPanel() {
        usersDiv.classList.toggle('show');
        overlay.classList.toggle('show');
    }
    usersBtn.addEventListener('click', toggleUsersPanel);
    overlay.addEventListener('click', toggleUsersPanel);

    window.addEventListener('resize', () => {
        const logo = document.querySelector('.main-header .logo');
        logo.style.display = window.innerWidth > 768 ? 'block' : 'none';
    });
    window.dispatchEvent(new Event('resize'));

    imageBtn.addEventListener('click', () => imageInput.click());
    imageInput.addEventListener('change', (e) => e.target.files[0] && handleImageFile(e.target.files[0]));
    msgInput.addEventListener('paste', (e) => {
        const file = Array.from(e.clipboardData.items).find(item => item.type.includes('image'))?.getAsFile();
        if (file) {
            handleImageFile(file);
            e.preventDefault();
        }
    });

    function handleImageFile(file) {
        if (!file.type.startsWith('image/')) return alert('Por favor, selecione um arquivo de imagem.');
        if (file.size > 5 * 1024 * 1024) return alert('A imagem é muito grande (máx 5MB).');
        const reader = new FileReader();
        reader.onload = (e) => {
            selectedImageData = e.target.result;
            imagePreview.src = selectedImageData;
            imagePreviewContainer.style.display = 'block';
        };
        reader.readAsDataURL(file);
        imageInput.value = '';
    }
    removeImageBtn.addEventListener('click', () => {
        selectedImageData = null;
        imagePreviewContainer.style.display = 'none';
        imagePreview.src = '';
    });

    socket.on('roomFull', () => { alert('A sala está cheia.'); window.location.href = '/'; });
    socket.on('nicknameTaken', (data) => { alert(`O nickname "${data.nickname}" já está em uso.`); window.location.href = '/'; });
    socket.on('invalidData', (data) => { alert(`Erro: ${data.message}`); window.location.href = '/'; });
    socket.on('idleKick', () => { alert('Você foi desconectado por inatividade.'); window.location.href = '/'; });
    
    // ATUALIZADO: Reseta a data ao carregar o histórico
    socket.on('chatHistory', (history) => {
        messagesDiv.innerHTML = '';
        lastMessageDate = null; // Reinicia a data para renderizar o histórico corretamente
        history.forEach(msg => addMessage(msg));
    });

    socket.on('message', (msg) => addMessage(msg));
    socket.on('spamBlocked', (data) => alert(`Aguarde ${Math.ceil((data.until - Date.now()) / 1000)}s.`));

    socket.on('userList', (users) => {
        const verbiTutor = {
            nickname: 'Verbi',
            idade: 'IA',
            color: '#FF6347',
            status: 'online',
            avatar: `https://api.dicebear.com/8.x/bottts/svg?seed=Verbi&backgroundColor=e3f2fd,c8e6f5&backgroundType=gradientLinear`
        };
        const combinedUsers = [verbiTutor, ...users.filter(u => u.nickname !== verbiTutor.nickname)];
        allRoomUsers = combinedUsers;
        usersOnline = combinedUsers.map(u => u.nickname);
        updateUserList(combinedUsers);
    });

    function getUserAvatar(user) {
        if (user && user.avatar && user.avatar.trim() !== '') {
            return user.avatar;
        }
        return `https://ui-avatars.com/api/?name=${user.nickname.charAt(0)}&background=random&color=fff`;
    }

    function mentionUser(username) {
        if (msgInput.value.length > 0 && !/\s$/.test(msgInput.value)) msgInput.value += ' ';
        msgInput.value += `@${username} `;
        msgInput.focus();
        if (window.innerWidth <= 768) toggleUsersPanel();
    }

    // ATUALIZADO: Função addMessage agora inclui a lógica de data e timestamp
   function addMessage(msg) {
    // Lógica da divisória de data
    if (msg.timestamp) {
        const messageDate = new Date(msg.timestamp).toDateString();
        if (messageDate !== lastMessageDate) {
            createDateDivider(msg.timestamp);
            lastMessageDate = messageDate;
        }
    }

    const isMentioned = msg.mentions && msg.mentions.includes(currentNickname);
    if (isMentioned) {
        const meuStatusAtual = statusSelect.value;
        if (meuStatusAtual !== 'ocupado' && mentionSound && isAudioUnlocked) {
            mentionSound.play().catch(e => console.error("Erro ao tocar áudio:", e));
        }
    }

    const isSelf = msg.nickname === currentNickname;
    const author = allRoomUsers.find(u => u.nickname === msg.nickname) || { nickname: msg.nickname };

    // Cria o contêiner principal da mensagem
    const messageRow = document.createElement('div');
    messageRow.classList.add('message-row', isSelf ? 'self' : 'other');

    if (isMentioned) {
        messageRow.classList.add('mention-full-highlight');
    }

    // Avatar
    const avatarDiv = document.createElement('div');
    avatarDiv.classList.add('message-avatar');
    const img = document.createElement('img');
    img.src = getUserAvatar(author);
    img.alt = msg.nickname.charAt(0).toUpperCase();
    avatarDiv.appendChild(img);

    // Wrapper para o conteúdo (que agora só contém o balão)
    const messageContentWrapper = document.createElement('div');
    messageContentWrapper.classList.add('message-content-wrapper');

    // Header (Nickname + Timestamp)
    const messageHeader = document.createElement('div');
    messageHeader.classList.add('message-header');
    const nicknameEl = document.createElement('strong');
    nicknameEl.textContent = msg.nickname;
    nicknameEl.style.color = msg.color || '#000000';
    if (isSelf && !isMentioned) {
        nicknameEl.style.color = 'rgba(255,255,255,0.8)';
    }
    const timestampEl = document.createElement('span');
    timestampEl.classList.add('message-timestamp');
    timestampEl.textContent = formatTimestamp(msg.timestamp);
    messageHeader.appendChild(nicknameEl);
    messageHeader.appendChild(timestampEl);

    // Bubble (agora contém o Header, Texto e Imagem)
    const messageBubble = document.createElement('div');
    messageBubble.classList.add('message-bubble');

    // *** A CORREÇÃO PRINCIPAL ESTÁ AQUI ***
    // Movemos o Header para DENTRO do Bubble
    messageBubble.appendChild(messageHeader);

    if (msg.imageData) {
        const imgContent = document.createElement('img');
        imgContent.src = msg.imageData;
        imgContent.classList.add('chat-image');
        imgContent.onclick = () => window.open(msg.imageData, '_blank');
        messageBubble.appendChild(imgContent);
    }
if (msg.text) {
    const textSpan = document.createElement('span');

    if (msg.nickname === 'Verbi') {
        // Para as mensagens do Verbi, convertemos as quebras de linha em <br> para manter a formatação
        // e usamos .innerHTML para que o navegador interprete a tag <br>.
        textSpan.innerHTML = msg.text.replace(/\n/g, '<br>');
    } else {
        // Para mensagens de usuários, continuamos usando .textContent por segurança.
        textSpan.textContent = msg.text;
    }

    messageBubble.appendChild(textSpan);
}

    // Montagem final
    messageContentWrapper.appendChild(messageBubble); // O wrapper agora só tem o bubble
    messageRow.appendChild(avatarDiv);
    messageRow.appendChild(messageContentWrapper);

    messagesDiv.appendChild(messageRow);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

    function sendMsg() {
        const text = msgInput.value.trim();
        if (!text && !selectedImageData) return;
        if (!isAudioUnlocked && mentionSound) {
            mentionSound.play().then(() => {
                mentionSound.pause();
                isAudioUnlocked = true;
            }).catch(() => {
                isAudioUnlocked = true;
            });
        }
        const mentions = usersOnline.filter(u => text.includes('@' + u));
        const messagePayload = {
            text,
            mentions,
            imageData: selectedImageData
        };
		
		// NOVO: Avisa que parou de digitar ao enviar a mensagem
    socket.emit('typing:stop');
    clearTimeout(typingTimeout);
    typingTimeout = null;
	
	
        socket.emit('message', messagePayload);
        msgInput.value = '';
        mentionList.style.display = 'none';
        mentionMode = false;
        removeImageBtn.click();
    }

    function updateUserList(users) {
        const sortedUsers = users.sort((a, b) => {
            if (a.nickname === 'Verbi') return -1;
            if (b.nickname === 'Verbi') return 1;
            return a.nickname.localeCompare(b.nickname);
        });
		
		// --- INÍCIO: LÓGICA PARA "DIGITANDO" ---
msgInput.addEventListener('input', () => {
    if (!typingTimeout) {
        socket.emit('typing:start');
    } else {
        clearTimeout(typingTimeout);
    }

    typingTimeout = setTimeout(() => {
        socket.emit('typing:stop');
        typingTimeout = null;
    }, 2000); // 2 segundos de inatividade para parar
});

socket.on('typing:start', (data) => {
    typingUserName.textContent = data.nickname;
    typingIndicator.style.display = 'flex';
});

socket.on('typing:stop', (data) => {
    // Por enquanto, vamos simplesmente esconder. Uma lógica mais avançada poderia
    // gerenciar múltiplos usuários digitando.
    typingIndicator.style.display = 'none';
});
// --- FIM: LÓGICA PARA "DIGITANDO" ---
        
        userListContainer.innerHTML = '';
        
        sortedUsers.forEach(user => {
            const isSelf = user.nickname === currentNickname;
            let statusText = 'Online';
            if (user.status === 'voltoja') statusText = 'Volto Já';
            if (user.status === 'ocupado') statusText = 'Ocupado';
            
            const userDiv = document.createElement('div');
            userDiv.className = 'user-item';
            if (isSelf) userDiv.classList.add('active');
            
            const userAvatarUrl = getUserAvatar(user);

            let displayName = user.nickname;
            if (user.nickname !== 'Verbi' && user.idade && user.idade !== 'N/A') {
                displayName += ` (${user.idade})`;
            }

            userDiv.innerHTML = `
                <div class="user-avatar"><img src="${userAvatarUrl}" alt="${user.nickname.charAt(0)}"></div>
                <div class="user-info">
                    <span class="user-name" style="color: ${isSelf ? 'white' : (user.color || '#333')}">${displayName}</span>
                    <span class="user-status-text">
                        <span class="status-dot status-${user.status || 'online'}-dot"></span>${statusText}
                    </span>
                </div>`;
                
            if (!isSelf) {
                userDiv.title = `Mencionar @${user.nickname}`;
                userDiv.onclick = () => mentionUser(user.nickname);
            }
            
            userListContainer.appendChild(userDiv);
        });
    }

    statusSelect.addEventListener('change', () => socket.emit('updateStatus', statusSelect.value));

    const emojiPicker = document.querySelector('emoji-picker');
    emojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        emojiPickerContainer.style.display = emojiPickerContainer.style.display === 'block' ? 'none' : 'block';
    });
    emojiPicker.addEventListener('emoji-click', event => {
        msgInput.value += event.detail.unicode;
    });

    msgInput.addEventListener('input', () => {
        const value = msgInput.value;
        const cursorPos = msgInput.selectionStart;
        const textBeforeCursor = value.slice(0, cursorPos);
        const atIndex = textBeforeCursor.lastIndexOf('@');
        if (atIndex !== -1 && (atIndex === 0 || /\s/.test(value[atIndex - 1]))) {
            mentionQuery = textBeforeCursor.slice(atIndex + 1).toLowerCase();
            if (/\s/.test(mentionQuery)) {
                mentionMode = false;
                mentionList.style.display = 'none';
                return;
            }
            mentionMode = true;
            showMentionList();
        } else {
            mentionMode = false;
            mentionList.style.display = 'none';
        }
    });

    function showMentionList() {
        const filteredUsers = usersOnline.filter(user => user.toLowerCase().startsWith(mentionQuery) && user !== currentNickname);
        if (filteredUsers.length === 0 || !mentionMode) {
            mentionList.style.display = 'none';
            return;
        }
        mentionList.innerHTML = '';
        filteredUsers.forEach(user => {
            const div = document.createElement('div');
            div.textContent = user;
            div.onclick = () => insertMention(user);
            mentionList.appendChild(div);
        });
        mentionList.style.display = 'block';
    }

    function insertMention(username) {
        const value = msgInput.value;
        const cursorPos = msgInput.selectionStart;
        const textBeforeCursor = value.slice(0, cursorPos);
        const textAfterCursor = value.slice(cursorPos);
        const atIndex = textBeforeCursor.lastIndexOf('@');
        msgInput.value = textBeforeCursor.slice(0, atIndex) + `@${username} ` + textAfterCursor;
        mentionList.style.display = 'none';
        mentionMode = false;
        msgInput.focus();
        const newCursorPos = atIndex + username.length + 2;
        msgInput.setSelectionRange(newCursorPos, newCursorPos);
    }

   sendBtn.onclick = sendMsg;
msgInput.addEventListener('keydown', (e) => {
    // NOVO: Atalho com a tecla TAB para mencionar o Verbi
    if (e.key === 'Tab') {
        e.preventDefault(); // Impede a ação padrão do TAB (mudar de campo)
        if (msgInput.value.length > 0 && !/\s$/.test(msgInput.value)) {
            msgInput.value += ' '; // Adiciona um espaço se o texto anterior não terminar com um
        }
        msgInput.value += '@Verbi ';
        msgInput.focus(); // Mantém o foco no campo de texto
    }

    // Lógica de enviar com Enter (permanece a mesma)
    if (e.key === 'Enter' && !mentionMode) {
        e.preventDefault();
        sendMsg();
    }
});

    document.addEventListener('click', (e) => {
        if (!emojiPickerContainer.contains(e.target) && e.target !== emojiBtn) {
            emojiPickerContainer.style.display = 'none';
        }
        if (!mentionList.contains(e.target) && e.target !== msgInput) {
            mentionList.style.display = 'none';
        }
    });

    async function initializePage() {
        await fetchLoggedInUser();
        
        let joinData;

        if (loggedInUser) {
            joinData = {
                sala: salaLimpa,
            };
        } else {
            joinData = {
                sala: salaLimpa,
                nickname: guestNickname,
                idade: guestIdade,
                color: guestColor
            };
        }
        
        if (!loggedInUser && !guestNickname) {
            alert("Identificação de usuário não encontrada. Por favor, entre ou use um link de convidado.");
            window.location.href = '/';
            return;
        }

        socket.emit('joinRoom', joinData);
    }

    initializePage();
});
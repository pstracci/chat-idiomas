function limparNomeSala(nome) {
  return nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '-');
}

const params = new URLSearchParams(window.location.search);
let sala = params.get('sala') || '';
const nickname = params.get('nick');
const idade = params.get('idade');
const color = decodeURIComponent(params.get('color')) || '#000000';

const salaLimpa = limparNomeSala(sala);
const socket = io();

const backBtn = document.getElementById('backBtn');
const messagesDiv = document.getElementById('messages');
const msgInput = document.getElementById('msgInput');
const sendBtn = document.getElementById('sendBtn');
const usersDiv = document.getElementById('users');
const statusSelect = document.getElementById('statusSelect');
const emojiBtn = document.getElementById('emojiBtn');
const emojiPicker = document.getElementById('emojiPicker');
const mentionSound = document.getElementById('mentionSound');
const mentionList = document.getElementById('mentionSuggestions');
const roomTitleEl = document.getElementById('roomTitle');
const imageBtn = document.getElementById('imageBtn');
const imageInput = document.getElementById('imageInput');
const imagePreviewContainer = document.getElementById('imagePreviewContainer');
const imagePreview = document.getElementById('imagePreview');
const removeImageBtn = document.getElementById('removeImageBtn');

if (roomTitleEl && sala) {
    const formattedRoomName = sala.charAt(0).toUpperCase() + sala.slice(1);
    roomTitleEl.textContent = `Sala de ${formattedRoomName}`;
}

let isAudioUnlocked = false;
let usersOnline = [];
let mentionMode = false;
let mentionQuery = '';
let selectedImageData = null;

backBtn.addEventListener('click', () => { window.location.href = '/'; });

// LÓGICA DE IMAGEM
imageBtn.addEventListener('click', () => {
    imageInput.click();
});

imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        handleImageFile(file);
    }
});

msgInput.addEventListener('paste', (e) => {
    const items = e.clipboardData.items;
    for (const item of items) {
        if (item.type.indexOf('image') !== -1) {
            const file = item.getAsFile();
            handleImageFile(file);
            e.preventDefault();
            break; 
        }
    }
});

function handleImageFile(file) {
    if (!file.type.startsWith('image/')) {
        alert('Por favor, selecione um arquivo de imagem.');
        return;
    }
    if (file.size > 1 * 1024 * 1024) { // 1MB
        alert('A imagem é muito grande. O tamanho máximo é de 1MB.');
        return;
    }

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

// LÓGICA DE SOCKET
socket.emit('joinRoom', { sala: salaLimpa, nickname, idade, color });

socket.on('roomFull', () => {
  alert('A sala está cheia. Por favor, tente outra.');
  window.location.href = '/';
});

socket.on('nicknameTaken', (data) => {
  alert(`O nickname "${data.nickname}" já está em uso nesta sala. Por favor, escolha outro.`);
  window.location.href = '/';
});

socket.on('invalidData', (data) => {
    alert(`Erro: ${data.message}`);
    window.location.href = '/';
});

socket.on('idleKick', () => {
    alert('Você foi desconectado por inatividade de 30 minutos.');
    window.location.href = '/';
});

socket.on('chatHistory', (history) => {
  messagesDiv.innerHTML = '';
  history.forEach(msg => addMessage(msg));
});

socket.on('message', (msg) => {
  addMessage(msg);
});

socket.on('userList', (users) => {
  usersOnline = users.map(u => u.nickname);
  updateUserList(users);
});


function mentionUser(username) {
    if (msgInput.value.length > 0 && msgInput.value.slice(-1) !== ' ') {
        msgInput.value += ' ';
    }
    msgInput.value += `@${username} `;
    msgInput.focus();
}

function addMessage(msg) {
  const p = document.createElement('p');
  
  if (msg.mentions && msg.mentions.includes(nickname)) {
    p.classList.add('mention-highlight');
    const meuStatusAtual = statusSelect.value;
    if (meuStatusAtual !== 'ocupado' && mentionSound && isAudioUnlocked) {
      mentionSound.play().catch(e => console.error("Erro ao tocar áudio de notificação:", e));
    }
  }

  p.innerHTML = `<strong style="color: ${msg.color || '#000000'};">${msg.nickname}:</strong>`;

  if (msg.imageData) {
      const img = document.createElement('img');
      img.src = msg.imageData;
      img.className = 'chat-image';
      img.onclick = () => window.open(msg.imageData, '_blank');
      p.appendChild(img);
  }

  if (msg.text) {
      const textNode = document.createTextNode(` ${msg.text}`);
      p.appendChild(textNode);
  }
  
  messagesDiv.appendChild(p);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function sendMsg() {
  const text = msgInput.value.trim();
  if (!text && !selectedImageData) return;

  if (!isAudioUnlocked && mentionSound) {
    mentionSound.play().then(() => {
      mentionSound.pause();
      isAudioUnlocked = true;
    }).catch(error => {
      console.warn("Tentativa de desbloquear áudio falhou:", error);
      isAudioUnlocked = true; 
    });
  }
  const mentions = usersOnline.filter(u => text.includes('@' + u));

  const messagePayload = {
      text: text,
      mentions: mentions,
      imageData: selectedImageData
  };

  socket.emit('message', messagePayload);

  msgInput.value = '';
  mentionList.style.display = 'none';
  mentionMode = false;
  removeImageBtn.click();
}

function updateUserList(users) {
  const statusContainer = document.getElementById('statusContainer');
  usersDiv.innerHTML = '';
  usersDiv.appendChild(statusContainer);
  const title = document.createElement('h3');
  title.textContent = 'Participantes';
  usersDiv.appendChild(title);

  const selfUser = users.find(u => u.nickname === nickname);
  const otherUsers = users.filter(u => u.nickname !== nickname);

  const createUserElement = (user, isSelf) => {
    let colorClass = 'status-online-dot';
    let statusText = 'Online';
    switch (user.status) {
      case 'voltoja': colorClass = 'status-voltoja-dot'; statusText = 'Volto Já'; break;
      case 'ocupado': colorClass = 'status-ocupado-dot'; statusText = 'Ocupado'; break;
    }
    const userDiv = document.createElement('div');
    userDiv.className = 'user-item';
    userDiv.innerHTML = `<span><span class="status-dot ${colorClass}"></span><strong style="color: ${user.color || '#000000'};">${user.nickname}</strong> (${user.idade})</span> <span class="status-text">(${statusText})</span>`;
    
    if (!isSelf) {
        userDiv.style.cursor = 'pointer';
        userDiv.title = `Mencionar @${user.nickname}`;
        userDiv.onclick = () => mentionUser(user.nickname);
    }
    return userDiv;
  };

  if (selfUser) {
    const selfElement = createUserElement(selfUser, true);
    usersDiv.appendChild(selfElement);
  }

  if (otherUsers.length > 0) {
    const divider = document.createElement('hr');
    divider.className = 'user-list-divider';
    usersDiv.appendChild(divider);
  }
  otherUsers.forEach(user => {
    const userElement = createUserElement(user, false);
    usersDiv.appendChild(userElement);
  });
}

statusSelect.addEventListener('change', () => {
  const newStatus = statusSelect.value;
  socket.emit('updateStatus', newStatus);
});

const emojis = ["😀", "😂", "😊", "😍", "🤔", "👍", "👎", "❤️", "🔥", "🎉", "😎", "😭", "🙏", "🚀", "💡", "💯", "👀", "👋", "🥳", "🤯"];
emojis.forEach(e => {
  const span = document.createElement('span');
  span.textContent = e;
  span.onclick = () => {
    msgInput.value += e;
    msgInput.focus();
    emojiPicker.style.display = 'none';
  };
  emojiPicker.appendChild(span);
});

emojiBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  emojiPicker.style.display = emojiPicker.style.display === 'block' ? 'none' : 'block';
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
  const filteredUsers = usersOnline.filter(user => 
    user.toLowerCase().startsWith(mentionQuery) && user !== nickname
  );
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
  if (e.key === 'Enter' && !mentionMode) {
    e.preventDefault();
    sendMsg();
  }
});

document.addEventListener('click', (e) => {
  if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
    emojiPicker.style.display = 'none';
  }
  if (!mentionList.contains(e.target) && e.target !== msgInput) {
    mentionList.style.display = 'none';
  }
});
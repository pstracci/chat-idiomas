function limparNomeSala(nome) {
  return nome.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, '-');
}

const params = new URLSearchParams(window.location.search);
let sala = params.get('sala') || '';
const nickname = params.get('nick');
const idade = params.get('idade');

const salaLimpa = limparNomeSala(sala);
const socket = io();

// Elementos do DOM
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

let isAudioUnlocked = false;
let usersOnline = [];
let mentionMode = false;
let mentionQuery = '';

// --- Conexão e Lógica da Sala ---
backBtn.addEventListener('click', () => {
  window.location.href = '/';
});

socket.emit('joinRoom', { sala: salaLimpa, nickname, idade });

socket.on('roomFull', () => {
  alert('A sala está cheia. Por favor, tente outra.');
  window.location.href = '/';
});

socket.on('nicknameTaken', (data) => {
  alert(`O nickname "${data.nickname}" já está em uso nesta sala. Por favor, escolha outro.`);
  window.location.href = '/';
});

socket.on('chatHistory', (history) => {
  history.forEach(msg => addMessage(msg.nickname, msg.text, msg.mentions));
});

socket.on('message', (msg) => {
  addMessage(msg.nickname, msg.text, msg.mentions);
});

socket.on('userList', (users) => {
  usersOnline = users.map(u => u.nickname);
  updateUserList(users);
});


// --- Funções do Chat ---

function addMessage(user, text, mentions = []) {
  const p = document.createElement('p');
  
  // Verifica se o usuário atual foi mencionado
  if (mentions.includes(nickname)) {
    p.classList.add('mention-highlight');
    
    // --- NOVO: Apenas toca o som se o status atual NÃO for 'ocupado' ---
    const meuStatusAtual = statusSelect.value;
    if (meuStatusAtual !== 'ocupado' && mentionSound && isAudioUnlocked) {
      mentionSound.play().catch(e => console.error("Erro ao tocar áudio de notificação:", e));
    }
    // --- FIM DA VERIFICAÇÃO DE STATUS ---
  }

  p.innerHTML = `<strong>${user}:</strong> ${text}`;
  messagesDiv.appendChild(p);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function sendMsg() {
  const text = msgInput.value.trim();
  if (text) {
    if (!isAudioUnlocked && mentionSound) {
      mentionSound.play().then(() => {
        mentionSound.pause();
        isAudioUnlocked = true;
        console.log("Áudio desbloqueado com sucesso!");
      }).catch(error => {
        console.warn("Tentativa de desbloquear áudio falhou:", error);
        isAudioUnlocked = true; 
      });
    }

    const mentions = usersOnline.filter(u => text.includes('@' + u));
    socket.emit('message', { text, mentions });
    msgInput.value = '';
    
    mentionList.style.display = 'none';
    mentionMode = false;
  }
}

function updateUserList(users) {
  const statusContainer = document.getElementById('statusContainer');
  usersDiv.innerHTML = '';
  usersDiv.appendChild(statusContainer);

  const title = document.createElement('h3');
  title.textContent = 'Usuários na sala';
  usersDiv.appendChild(title);

  users.forEach(u => {
    let colorClass = 'status-online-dot';
    let statusText = 'Online';
    switch (u.status) {
      case 'voltoja': 
        colorClass = 'status-voltoja-dot';
        statusText = 'Volto Já';
        break;
      case 'ocupado': 
        colorClass = 'status-ocupado-dot'; 
        statusText = 'Ocupado';
        break;
    }
    const userDiv = document.createElement('div');
    userDiv.className = 'user-item';
    // Atualizei para mostrar o texto do status também
    userDiv.innerHTML = `<span><span class="status-dot ${colorClass}"></span>${u.nickname} (${u.idade})</span> <span class="status-text">(${statusText})</span>`;
    usersDiv.appendChild(userDiv);
  });
}

// --- Status do Usuário ---
statusSelect.addEventListener('change', () => {
  const newStatus = statusSelect.value;
  socket.emit('updateStatus', newStatus);
  updateMyStatusDot(newStatus);
});

function updateMyStatusDot(status) {
  const statusDot = document.getElementById('statusDot');
  if (!statusDot) return;
  statusDot.className = 'status-dot';
  switch (status) {
    case 'online': statusDot.classList.add('status-online-dot'); break;
    case 'voltoja': statusDot.classList.add('status-voltoja-dot'); break;
    case 'ocupado': statusDot.classList.add('status-ocupado-dot'); break;
    default: statusDot.classList.add('status-online-dot');
  }
}

// --- Sistema de Emojis ---
const emojis = ["😀", "😂", "😊", "😍", "🤔", "👍", "👎", "❤️", "🔥", "🎉"];
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

// --- AUTOCOMPLETE DE MENÇÃO ---
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


// --- Listeners Globais ---
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
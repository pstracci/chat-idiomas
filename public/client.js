// Função para "limpar" o nome da sala, removendo acentos e espaços, para id e comunicação
function limparNomeSala(nome) {
  return nome.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/\s+/g, '-'); // espaços para hífen
}

const params = new URLSearchParams(window.location.search);
let sala = params.get('sala') || '';
const nickname = params.get('nick');
const idade = params.get('idade');

console.log('Parâmetros da URL:', { sala, nickname, idade });

// Aplica a limpeza no nome da sala para enviar ao servidor
const salaLimpa = limparNomeSala(sala);

const socket = io();

const backBtn = document.getElementById('backBtn');
backBtn.addEventListener('click', () => {
  console.log('Botão Voltar clicado: aceitou18 setado e voltando para /');
  localStorage.setItem('aceitou18', 'true');
  window.location.href = '/';
});

// Emite com o nome da sala limpo
socket.emit('joinRoom', { sala: salaLimpa, nickname, idade });
console.log('Evento joinRoom emitido', { sala: salaLimpa, nickname, idade });

// Coloca o listener dentro do load para garantir que o DOM está pronto
socket.on('roomCounts', (counts) => {
  console.log('Contagem de usuários por sala recebida:', counts);
  Object.entries(counts).forEach(([room, count]) => {
    const roomLimpa = limparNomeSala(room);
    const el = document.getElementById(`count-${roomLimpa}`);
    console.log(`Atualizando #count-${roomLimpa} para ${count}`, el);
    if (el) {
      el.textContent = count;
      console.log(`Elemento atualizado:`, el.textContent);
    }
  });
});

socket.on('roomFull', () => {
  console.log('Sala cheia recebida do servidor');
  alert('Sala cheia! Tente outra.');
  window.location.href = '/';
});

socket.on('chatHistory', (history) => {
  console.log('Histórico de chat recebido:', history);
  history.forEach(msg => addMessage(msg.nickname, msg.text));
});

socket.on('message', (msg) => {
  console.log('Mensagem recebida:', msg);
  addMessage(msg.nickname, msg.text);
});

socket.on('userList', (users) => {
  console.log('Lista de usuários recebida:', users);
  const usersDiv = document.getElementById('users');
  const statusSelect = document.getElementById('statusSelect');
  const statusContainer = document.getElementById('statusContainer');

  usersDiv.innerHTML = '';
  usersDiv.appendChild(statusContainer);

  const title = document.createElement('h3');
  title.textContent = 'Users';
  usersDiv.appendChild(title);

  users.forEach(u => {
    let colorClass = '';
    let statusText = '';
    switch (u.status) {
      case 'online':
        colorClass = 'status-online-dot';
        statusText = 'Online';
        break;
      case 'voltoja':
        colorClass = 'status-voltoja-dot';
        statusText = 'Volto Já';
        break;
      case 'ocupado':
        colorClass = 'status-ocupado-dot';
        statusText = 'Ocupado';
        break;
      default:
        colorClass = 'status-online-dot';
        statusText = 'Online';
    }

    const userDiv = document.createElement('div');
    userDiv.classList.add('user-item');
    userDiv.innerHTML = `
      <span><span class="status-dot ${colorClass}"></span>${u.nickname} (${u.idade} anos)</span>
      <span class="status-text">${statusText}</span>
    `;
    usersDiv.appendChild(userDiv);
  });

  const meuUsuario = users.find(u => u.nickname === nickname);
  if (meuUsuario) {
    console.log('Atualizando status do usuário atual:', meuUsuario);
    statusSelect.value = meuUsuario.status || 'online';
    updateMyStatusDot(statusSelect.value);
  }
});

const statusSelect = document.getElementById('statusSelect');
statusSelect.addEventListener('change', () => {
  const novoStatus = statusSelect.value;
  console.log('Status alterado para:', novoStatus);
  socket.emit('updateStatus', novoStatus);
  updateMyStatusDot(novoStatus);
});

const sendBtn = document.getElementById('sendBtn');
sendBtn.onclick = () => sendMsg();

document.getElementById('msgInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    sendMsg();
  }
});

function sendMsg() {
  const input = document.getElementById('msgInput');
  const text = input.value.trim();
  if (text) {
    console.log('Enviando mensagem:', text);
    socket.emit('message', text);
    input.value = '';
  }
}

function addMessage(user, text) {
  const msgDiv = document.getElementById('messages');
  const p = document.createElement('p');
  p.innerHTML = `<strong>${user}:</strong> ${text}`;
  msgDiv.appendChild(p);
  msgDiv.scrollTop = msgDiv.scrollHeight;
}

function updateMyStatusDot(status) {
  const statusDot = document.getElementById('statusDot');
  if (!statusDot) {
    console.log('Elemento statusDot não encontrado!');
    return;
  }
  statusDot.className = 'status-dot'; // reseta classes
  switch (status) {
    case 'online':
      statusDot.classList.add('status-online-dot');
      break;
    case 'voltoja':
      statusDot.classList.add('status-voltoja-dot');
      break;
    case 'ocupado':
      statusDot.classList.add('status-ocupado-dot');
      break;
    default:
      statusDot.classList.add('status-online-dot');
  }
  console.log('Status dot atualizado para:', status);
}
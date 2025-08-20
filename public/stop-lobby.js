document.addEventListener('DOMContentLoaded', () => {
    const socket = io('/stop');

    // Elementos da página
    const roomGrid = document.getElementById('room-grid');
    const createRoomBtn = document.getElementById('create-room-btn');
    const modal = document.getElementById('create-room-modal');
    const createRoomForm = document.getElementById('create-room-form');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const privateToggle = document.getElementById('is-private-toggle');
    const passwordGroup = document.getElementById('password-group');
    const publicLabel = document.getElementById('public-label');
    const privateLabel = document.getElementById('private-label');
    
    const categoryInput = document.getElementById('category-input');
    const addCategoryBtn = document.getElementById('add-category-btn');
    const categoryTagsContainer = document.getElementById('category-tags-container');

    let roomCategories = [];
    const defaultCategories = ["Nome", "CEP", "Fruta", "Cor", "Carro", "Filmes e Series", "Minha Sogra é"];

    // --- Lógica do Modal ---
    createRoomBtn.addEventListener('click', () => {
        createRoomForm.reset();
        roomCategories = [...defaultCategories]; 
        renderCategories();
        privateToggle.checked = false;
        passwordGroup.style.display = 'none';
        publicLabel.classList.add('active');
        publicLabel.classList.remove('inactive');
        privateLabel.classList.add('inactive');
        privateLabel.classList.remove('active');
        modal.style.display = 'flex';
    });
    closeModalBtn.addEventListener('click', () => { modal.style.display = 'none'; });
    
    privateToggle.addEventListener('change', () => {
        const isPrivate = privateToggle.checked;
        passwordGroup.style.display = isPrivate ? 'block' : 'none';
        publicLabel.classList.toggle('active', !isPrivate);
        publicLabel.classList.toggle('inactive', isPrivate);
        privateLabel.classList.toggle('active', isPrivate);
        privateLabel.classList.toggle('inactive', !isPrivate);
    });

    // --- LÓGICA DE CATEGORIAS ---
    const renderCategories = () => {
        categoryTagsContainer.innerHTML = '';
        roomCategories.forEach((category, index) => {
            const tag = document.createElement('span');
            tag.className = 'category-tag';
            tag.textContent = category;
            
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-tag-btn';
            removeBtn.innerHTML = '&times;';
            removeBtn.onclick = () => {
                roomCategories.splice(index, 1);
                renderCategories();
            };
            
            tag.appendChild(removeBtn);
            categoryTagsContainer.appendChild(tag);
        });
    };

    const addCategory = () => {
        if (roomCategories.length >= 15) {
            alert('Você pode adicionar no máximo 15 categorias.');
            return;
        }
        const categoryValue = categoryInput.value.trim();
		
		// LINHA ADICIONADA
    if (categoryValue.length > 15) {
        alert('O nome da categoria não pode ter mais de 15 caracteres.');
        return;
    }
	
        if (categoryValue && !roomCategories.find(c => c.toLowerCase() === categoryValue.toLowerCase())) {
            roomCategories.push(categoryValue);
            categoryInput.value = '';
            renderCategories();
        }
        categoryInput.focus();
    };

    addCategoryBtn.addEventListener('click', addCategory);
    categoryInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addCategory();
        }
    });

    // --- Lógica do Formulário de Criação ---
    createRoomForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const roomName = document.getElementById('room-name').value;
        if (!roomName || !roomName.trim()) {
            alert("O nome da sala não pode estar em branco.");
            return;
        }
        if (roomCategories.length < 1) {
            alert("Por favor, adicione pelo menos uma categoria para a sala.");
            return;
        }

        const maxParticipants = document.getElementById('max-participants').value;
        const isPrivate = privateToggle.checked;
        const password = document.getElementById('room-password').value;

        if (isPrivate && !password) {
            alert('Salas privadas precisam de uma senha!');
            return;
        }

        socket.emit('createRoom', {
            name: roomName.trim(),
            maxParticipants: parseInt(maxParticipants),
            isPrivate,
            password: isPrivate ? password : null,
            categories: roomCategories
        });
    });

    // --- Lógica de Renderização das Salas e Botão Entrar ---
    const renderRooms = (rooms) => {
        roomGrid.innerHTML = '';
        if (rooms.length === 0) {
            roomGrid.innerHTML = '<p>Nenhuma sala ativa no momento. Que tal criar uma?</p>';
            return;
        }

        rooms.forEach(room => {
            const card = document.createElement('div');
            card.className = 'room-card';
            
            const isFull = room.participants >= room.maxParticipants;
            const statusClass = room.status === 'Aguardando' ? 'status-aguardando' : 'status-jogando';
            const icon = room.isPrivate ? '🔒' : '🌐';

            card.innerHTML = `
                <div>
                    <h3>${icon} ${room.name}</h3>
                    <div class="details">
                        <span>Participantes: ${room.participants}/${room.maxParticipants}</span>
                        <span class="${statusClass}">${room.status}</span>
                    </div>
                </div>
                <div class="actions">
                    <button class="btn btn-primary join-btn" data-room-id="${room.id}" data-private="${room.isPrivate}" ${isFull ? 'disabled' : ''}>
                        ${isFull ? 'Sala Cheia' : 'Entrar'}
                    </button>
                </div>
            `;
            roomGrid.appendChild(card);
        });

        // Adiciona a funcionalidade de clique aos botões "Entrar"
        document.querySelectorAll('.join-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const roomId = e.target.dataset.roomId;
                const isPrivate = e.target.dataset.private === 'true';
                
                let password = null;
                if (isPrivate) {
                    password = prompt('Esta sala é privada. Por favor, digite a senha:');
                    if (password === null) return;
                }
                
                socket.emit('joinRoom', { roomId, password });
            });
        });
    };

    // --- Listeners do Socket.IO ---
    socket.on('updateRoomList', (rooms) => { renderRooms(rooms); });
    socket.on('joinSuccess', (roomId) => { window.location.href = `stop-game.html?id=${roomId}`; });
    socket.on('error', (message) => { alert(`Erro: ${message}`); });
});
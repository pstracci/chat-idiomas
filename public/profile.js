// public/profile.js
document.addEventListener('DOMContentLoaded', async () => {
    // --- ELEMENTOS DA UI ---
    const container = document.querySelector('.container'); // Pega o container principal
    const profilePicture = document.getElementById('profilePicture');
    const profilePictureInput = document.getElementById('profilePictureInput');
    const uploadButton = document.getElementById('uploadButton');
    const statusDisplay = document.getElementById('statusDisplay');
    const countryFlag = document.getElementById('countryFlag');
    const countryName = document.getElementById('countryName');
    const emailInput = document.getElementById('email');
    const profileForm = document.getElementById('profileForm');
    const saveButton = document.querySelector('.btn-save');
    const addSpokenLanguageBtn = document.getElementById('addSpokenLanguageBtn');
    const addLearningLanguageBtn = document.getElementById('addLearningLanguageBtn');
    const languagesSpokenList = document.getElementById('languagesSpokenList');
    const languagesLearningList = document.getElementById('languagesLearningList');
    const nicknameDisplay = document.getElementById('nicknameDisplay');
    const editNicknameBtn = document.getElementById('editNicknameBtn');
    const editNicknameInputContainer = document.getElementById('editNicknameInputContainer');
    const nicknameInput = document.getElementById('nicknameInput');
    const saveNicknameBtn = document.getElementById('saveNicknameBtn');
    const connectionControls = document.getElementById('connection-controls');
    const connectBtn = document.getElementById('connect-btn');
    const disconnectBtn = document.getElementById('disconnect-btn');

    // --- ESTADO ---
    let profileData = {};
    let currentUser = {};
    let isLoggedIn = false;
    let isOwnProfile = false;
    let base64Image = null;

    // --- FUNÇÕES ---

    // Adiciona a classe 'loading' para ativar os skeletons
    if (container) container.classList.add('loading');

    async function getCurrentUserStatus() {
        try {
            const response = await fetch('/api/user/status');
            const data = await response.json();
            isLoggedIn = data.loggedIn;
            return data;
        } catch (error) {
            isLoggedIn = false;
            return { loggedIn: false };
        }
    }

    async function getCountryInfo(countryName) {
        if (!countryName) return { name: 'Não definido', flag: '🏳️' };
        try {
            const response = await fetch(`https://restcountries.com/v3.1/name/${countryName.trim()}?fields=name,flags`);
            if (!response.ok) return { name: countryName, flag: '🏳️' };
            const data = await response.json();
            const country = data.find(c => c.name.common.toLowerCase() === countryName.toLowerCase()) || data[0];
            return { name: country.name.common, flag: country.flags.svg ? `<img src="${country.flags.svg}" width="30" alt="${country.name.common}">` : '🏳️' };
        } catch (error) {
            console.error("Erro ao buscar bandeira:", error);
            return { name: countryName, flag: '🏳️' };
        }
    }

    function renderLanguageLists() {
        languagesSpokenList.innerHTML = '';
        profileData.languagesSpoken?.forEach((lang, index) => {
            if (typeof lang !== 'object' || lang === null) return;
            const li = document.createElement('li');
            li.className = 'language-item';
            li.innerHTML = `
                <input type="text" value="${lang.language || ''}" placeholder="Idioma" data-index="${index}" data-type="spoken" data-key="language">
                <select data-index="${index}" data-type="spoken" data-key="level">
                    ${['A1','A2','B1','B2','C1','C2','Nativo'].map(level => `<option value="${level}" ${lang.level === level ? 'selected' : ''}>${level}</option>`).join('')}
                </select>
                ${isOwnProfile ? `<button type="button" class="remove-btn" data-index="${index}" data-type="spoken">X</button>` : ''}
            `;
            languagesSpokenList.appendChild(li);
        });

        languagesLearningList.innerHTML = '';
        profileData.languagesLearning?.forEach((lang, index) => {
            const li = document.createElement('li');
            li.className = 'language-item';
            li.innerHTML = `
                <input type="text" value="${lang || ''}" placeholder="Idioma" data-index="${index}" data-type="learning">
                ${isOwnProfile ? `<button type="button" class="remove-btn" data-index="${index}" data-type="learning">X</button>` : ''}
            `;
            languagesLearningList.appendChild(li);
        });
    }

    async function populatePage() {
        const { user } = profileData;
        
        nicknameDisplay.textContent = user.nickname;
        nicknameInput.value = user.nickname;

        profilePicture.src = profileData.profilePicture || 'default-avatar.png';
        emailInput.value = user.email || 'E-mail não disponível';

        for (const key in profileData) {
            const input = document.getElementById(key);
            if (input && input.id !== 'nicknameInput') {
                if (input.type === 'date' && profileData[key]) {
                    input.value = new Date(profileData[key]).toISOString().split('T')[0];
                } else {
                    input.value = profileData[key] || '';
                }
            }
        }
        
        const FIVE_MINUTES_IN_MS = 5 * 60 * 1000;
        const lastSeenDate = new Date(user.lastSeen);
        const isEffectivelyOnline = isOwnProfile || (user.isOnline && (new Date() - lastSeenDate) < FIVE_MINUTES_IN_MS);

        if (isEffectivelyOnline) {
            statusDisplay.className = 'status online';
            statusDisplay.innerHTML = `<div class="dot"></div><span>Online agora</span>`;
        } else {
            statusDisplay.className = 'status offline';
            let lastSeenText = 'Desconhecido';
            if (user.lastSeen && !isNaN(lastSeenDate.getTime())) {
                lastSeenText = `Último acesso em ${lastSeenDate.toLocaleString('pt-BR')}`;
            }
            statusDisplay.innerHTML = `<div class="dot"></div><span>${lastSeenText}</span>`;
        }

        const countryInfo = await getCountryInfo(profileData.country);
        countryName.textContent = countryInfo.name;
        countryFlag.innerHTML = countryInfo.flag;

        renderLanguageLists();
        toggleEditMode();
        updateConnectionButton();
    }
    
    function toggleEditMode() {
        const phoneInput = document.getElementById('phone');
        const canEdit = isOwnProfile && isLoggedIn;
        [...profileForm.elements].forEach(el => el.disabled = !canEdit);
        uploadButton.style.display = canEdit ? 'flex' : 'none';
        saveButton.style.display = canEdit ? 'block' : 'none';
        addSpokenLanguageBtn.style.display = canEdit ? 'block' : 'none';
        addLearningLanguageBtn.style.display = canEdit ? 'block' : 'none';
        editNicknameBtn.style.display = canEdit ? 'block' : 'none';
        if (canEdit) {
            phoneInput.placeholder = '(Opcional)';
        } else {
            phoneInput.placeholder = 'Não disponível';
        }
    }

    function updateConnectionButton() {
        if (!connectionControls || !connectBtn || !disconnectBtn) {
            return;
        }
        if (isOwnProfile) {
            connectionControls.style.display = 'none';
            return;
        }
        if (!isLoggedIn) {
            connectionControls.style.display = 'none';
            return;
        }
        connectionControls.style.display = 'block';
        connectBtn.style.display = 'block';
        disconnectBtn.style.display = 'none';
        connectBtn.disabled = false;
        connectBtn.classList.remove('btn-accept');

        const status = profileData.connectionStatus;
        const connectionId = profileData.connectionId;
        const nickname = profileData.user.nickname;

        switch (status) {
            case 'ACCEPTED':
                connectBtn.textContent = 'Conectado';
                connectBtn.disabled = true;
                disconnectBtn.style.display = 'block';
                disconnectBtn.onclick = () => disconnectUser(connectionId, nickname);
                break;
            case 'PENDING_SENT':
                connectBtn.textContent = 'Pedido Pendente';
                connectBtn.disabled = true;
                break;
            case 'PENDING_RECEIVED':
                connectBtn.textContent = 'Aceitar Pedido';
                connectBtn.classList.add('btn-accept');
                connectBtn.onclick = () => acceptConnection(connectionId);
                break;
            default:
                connectBtn.textContent = 'Pedir para se conectar';
                connectBtn.onclick = () => sendConnectionRequest();
                break;
        }
    }

    async function disconnectUser(connectionId, nickname) {
        if (!confirm(`Tem a certeza que deseja desconectar de ${nickname}?`)) {
            return;
        }
        try {
            const response = await fetch(`/api/connections/delete/${connectionId}`, { method: 'DELETE' });
            if (!response.ok) {
                throw new Error('Não foi possível desconectar.');
            }
            profileData.connectionStatus = null;
            profileData.connectionId = null;
            updateConnectionButton();
        } catch (error) {
            alert(error.message);
        }
    }

    async function sendConnectionRequest() { if (connectBtn) connectBtn.disabled = true; try { const response = await fetch(`/api/connections/request/${profileData.user.id}`, { method: 'POST' }); if (!response.ok) throw new Error('Falha ao enviar pedido.'); if (connectBtn) connectBtn.textContent = 'Pedido Enviado'; } catch (error) { alert(error.message); if (connectBtn) connectBtn.disabled = false; } }
    async function acceptConnection(connectionId) { if (connectBtn) connectBtn.disabled = true; try { const response = await fetch(`/api/connections/accept/${connectionId}`, { method: 'PUT' }); if (!response.ok) throw new Error('Falha ao aceitar pedido.'); if (connectBtn) { connectBtn.textContent = 'Conectado'; connectBtn.classList.remove('btn-accept'); } profileData.connectionStatus = 'ACCEPTED'; updateConnectionButton(); } catch (error) { alert(error.message); if (connectBtn) connectBtn.disabled = false; } }
    
    editNicknameBtn.addEventListener('click', () => { nicknameDisplay.style.display = 'none'; editNicknameBtn.style.display = 'none'; editNicknameInputContainer.style.display = 'flex'; nicknameInput.focus(); });
    saveNicknameBtn.addEventListener('click', () => { const newNickname = nicknameInput.value.trim(); if (newNickname) { nicknameDisplay.textContent = newNickname; profileData.user.nickname = newNickname; } nicknameDisplay.style.display = 'block'; editNicknameBtn.style.display = 'block'; editNicknameInputContainer.style.display = 'none'; });
    uploadButton.addEventListener('click', () => profilePictureInput.click());
    profilePictureInput.addEventListener('change', (e) => { const file = e.target.files[0]; if (!file) return; if (file.size > 2 * 1024 * 1024) return alert('A imagem é muito grande! O tamanho máximo é 2MB.'); const reader = new FileReader(); reader.onload = (event) => { base64Image = event.target.result; profilePicture.src = base64Image; }; reader.readAsDataURL(file); });
    addSpokenLanguageBtn.addEventListener('click', () => { if (!profileData.languagesSpoken) profileData.languagesSpoken = []; profileData.languagesSpoken.push({ language: '', level: 'A1' }); renderLanguageLists(); });
    addLearningLanguageBtn.addEventListener('click', () => { if (!profileData.languagesLearning) profileData.languagesLearning = []; profileData.languagesLearning.push(''); renderLanguageLists(); });
    document.addEventListener('click', (e) => { if (e.target.matches('.remove-btn')) { const { index, type } = e.target.dataset; if (type === 'spoken') profileData.languagesSpoken.splice(index, 1); if (type === 'learning') profileData.languagesLearning.splice(index, 1); renderLanguageLists(); } });
    document.addEventListener('input', (e) => { if (e.target.matches('.language-item input, .language-item select')) { const { index, type, key } = e.target.dataset; if (type === 'spoken') { if (!profileData.languagesSpoken[index]) profileData.languagesSpoken[index] = {}; profileData.languagesSpoken[index][key] = e.target.value; } if (type === 'learning') { profileData.languagesLearning[index] = e.target.value; } } });
    profileForm.addEventListener('submit', async (e) => { e.preventDefault(); const formData = new FormData(profileForm); const data = Object.fromEntries(formData.entries()); const payload = { ...data, nickname: profileData.user.nickname, profilePicture: base64Image || profileData.profilePicture, languagesSpoken: (profileData.languagesSpoken || []).filter(l => l.language?.trim()), languagesLearning: (profileData.languagesLearning || []).filter(l => l?.trim()), }; try { const response = await fetch('/api/profile/me', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), }); if (!response.ok) { const errorData = await response.json().catch(() => ({})); throw new Error(errorData.error || 'Falha ao salvar.'); } alert('Perfil atualizado com sucesso!'); base64Image = null; window.location.reload(); } catch (error) { alert(`Erro ao salvar o perfil: ${error.message}`); } });

    // --- INICIALIZAÇÃO DA PÁGINA ---
    try {
        currentUser = await getCurrentUserStatus();
        const params = new URLSearchParams(window.location.search);
        const urlUserId = params.get('userId');
        let fetchUrl;

        if (!urlUserId) {
            if (isLoggedIn) {
                isOwnProfile = true;
                fetchUrl = '/api/profile/me';
            } else {
                throw new Error('Perfil não encontrado. Por favor, faça login para ver o seu perfil.');
            }
        } else {
            isOwnProfile = isLoggedIn && (urlUserId === currentUser.userId);
            fetchUrl = `/api/profile/${urlUserId}`;
        }

        const response = await fetch(fetchUrl);
        if (!response.ok) throw new Error('Perfil não encontrado.');
        
        profileData = await response.json();
        
        if (typeof profileData.languagesSpoken === 'string') profileData.languagesSpoken = JSON.parse(profileData.languagesSpoken || '[]');
        if (!Array.isArray(profileData.languagesSpoken)) profileData.languagesSpoken = [];
        if (!Array.isArray(profileData.languagesLearning)) profileData.languagesLearning = [];
        
        await populatePage();

    } catch (error) {
        console.error("Erro na inicialização da página:", error);
        document.body.innerHTML = `<h1>Erro ao carregar o perfil</h1><p>${error.message}</p><a href="/">Voltar</a>`;
    } finally {
        // Garante que a classe 'loading' seja removida no final, mesmo se houver erro
        if (container) container.classList.remove('loading');
    }
});
// public/profile.js (COMPLETO E CORRIGIDO)

document.addEventListener('DOMContentLoaded', () => {
    const body = document.body;
    // --- ELEMENTOS DA UI ---
    const profilePicture = document.getElementById('profilePicture');
    const uploadButton = document.getElementById('uploadButton');
    const profilePictureInput = document.getElementById('profilePictureInput');
    const nicknameDisplay = document.getElementById('nicknameDisplay');
    const editNicknameBtn = document.getElementById('editNicknameBtn');
    
    // NOVOS ELEMENTOS PARA EDIÇÃO DE NICKNAME
    const editNicknameInputContainer = document.getElementById('editNicknameInputContainer');
    const nicknameInput = document.getElementById('nicknameInput');
    const saveNicknameBtn = document.getElementById('saveNicknameBtn');
    const cancelNicknameBtn = document.getElementById('cancelNicknameBtn');

    const statusDisplay = document.getElementById('statusDisplay');
    const countryFlag = document.getElementById('countryFlag');
    const countryName = document.getElementById('countryName');
    const connectionControls = document.getElementById('connection-controls');
    const connectBtn = document.getElementById('connect-btn');
    const chatBtn = document.getElementById('chat-btn');
    const viewModeContainer = document.getElementById('view-mode-container');
    const profileForm = document.getElementById('profileForm');
    const emailInput = document.getElementById('email');
    const addSpokenLanguageBtn = document.getElementById('addSpokenLanguageBtn');
    const addLearningLanguageBtn = document.getElementById('addLearningLanguageBtn');
    const languagesSpokenList = document.getElementById('languagesSpokenList');
    const languagesLearningList = document.getElementById('languagesLearningList');
    const fullNameDisplay = document.getElementById('fullNameDisplay');
    const ageDisplay = document.getElementById('ageDisplay');
    const languagesSpokenDisplay = document.getElementById('languagesSpokenDisplay');
    const languagesLearningDisplay = document.getElementById('languagesLearningDisplay');
    const aboutMeDisplay = document.getElementById('aboutMeDisplay');
    const perfectPartnerDisplay = document.getElementById('perfectPartnerDisplay');
    const learningReasonDisplay = document.getElementById('learningReasonDisplay');

    // --- ESTADO ---
    let profileData = {};
    let currentUser = null;
    let isOwnProfile = false;
    let base64Image = null;
    let socket;

    // --- FUNÇÕES AUXILIARES ---
    function calculateAge(dateString) {
        if (!dateString) return null;
        const birthDate = new Date(dateString);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }
        return age;
    }

    async function getCountryInfo(countryNameStr) {
        if (!countryNameStr) return { name: 'Não especificado', flag: '' };
        try {
            const response = await fetch(`https://restcountries.com/v3.1/name/${countryNameStr.trim()}?fields=name,flags`);
            if (!response.ok) return { name: countryNameStr, flag: '🏳️' };
            const data = await response.json();
            const country = data.find(c => c.name.common.toLowerCase() === countryNameStr.toLowerCase()) || data[0];
            return {
                name: country.name.common,
                flag: country.flags.svg ? `<img src="${country.flags.svg}" width="30" alt="${country.name.common}">` : '🏳️'
            };
        } catch (error) {
            return { name: countryNameStr, flag: '🏳️' };
        }
    }

    function populateCountriesDropdown() {
        const countryList = ["Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Argentina", "Australia", "Austria", "Bahamas", "Bangladesh", "Belgium", "Bolivia", "Brazil", "Bulgaria", "Canada", "Chile", "China", "Colombia", "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czech Republic", "Denmark", "Ecuador", "Egypt", "Estonia", "Finland", "France", "Germany", "Greece", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy", "Jamaica", "Japan", "Mexico", "Netherlands", "New Zealand", "Nigeria", "Norway", "Pakistan", "Peru", "Philippines", "Poland", "Portugal", "Qatar", "Romania", "Russia", "Saudi Arabia", "Serbia", "Singapore", "South Africa", "South Korea", "Spain", "Sweden", "Switzerland", "Thailand", "Turkey", "Ukraine", "United Arab Emirates", "United Kingdom", "United States", "Uruguay", "Venezuela", "Vietnam"];
        const countrySelect = document.getElementById('country');
        if (!countrySelect) return;
        countryList.sort();
        countryList.forEach(country => {
            const option = document.createElement('option');
            option.value = country;
            option.textContent = country;
            countrySelect.appendChild(option);
        });
    }

    // --- FUNÇÕES DE RENDERIZAÇÃO ---
    function renderLanguageLists() {
    // =================================================================================
    // == ALTERAÇÃO AQUI: LISTAS DE IDIOMAS E NÍVEIS ATUALIZADAS PARA INGLÊS ==
    // =================================================================================
    const languageOptions = ["Afrikaans", "Albanian", "Amharic", "Arabic", "Armenian", "Azerbaijani", "Basque", "Belarusian", "Bengali", "Bosnian", "Bulgarian", "Burmese", "Catalan", "Cebuano", "Chechen", "Chinese (Mandarin)", "Corsican", "Croatian", "Czech", "Danish", "Dutch", "English", "Esperanto", "Estonian", "Finnish", "French", "Frisian", "Galician", "Georgian", "German", "Greek", "Gujarati", "Haitian Creole", "Hausa", "Hawaiian", "Hebrew", "Hindi", "Hmong", "Hungarian", "Icelandic", "Igbo", "Indonesian", "Irish", "Italian", "Japanese", "Javanese", "Kannada", "Kazakh", "Khmer", "Kinyarwanda", "Korean", "Kurdish", "Kyrgyz", "Lao", "Latin", "Latvian", "Lithuanian", "Luxembourgish", "Macedonian", "Malagasy", "Malay", "Malayalam", "Maltese", "Maori", "Marathi", "Mongolian", "Nepali", "Norwegian", "Nyanja (Chichewa)", "Odia (Oriya)", "Pashto", "Persian", "Polish", "Portuguese", "Punjabi", "Romanian", "Russian", "Samoan", "Scots Gaelic", "Serbian", "Sesotho", "Shona", "Sindhi", "Sinhala (Sinhalese)", "Slovak", "Slovenian", "Somali", "Spanish", "Sundanese", "Swahili", "Swedish", "Tagalog (Filipino)", "Tajik", "Tamil", "Tatar", "Telugu", "Thai", "Turkish", "Turkmen", "Ukrainian", "Urdu", "Uyghur", "Uzbek", "Vietnamese", "Welsh", "Xhosa", "Yiddish", "Yoruba", "Zulu"];
    const levelOptions = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'Native']; // "Nativo" foi traduzido para "Native"

    // O restante da função permanece o mesmo
    languagesSpokenList.innerHTML = '';
    (profileData.languagesSpoken || []).forEach((lang, index) => {
        if (typeof lang !== 'object' || lang === null) return;
        const li = document.createElement('li');
        li.className = 'language-item';
        const langSelectOptions = languageOptions.map(option => `<option value="${option}" ${lang.language === option ? 'selected' : ''}>${option}</option>`).join('');
        const levelSelectOptions = levelOptions.map(level => `<option value="${level}" ${lang.level === level ? 'selected' : ''}>${level}</option>`).join('');
        li.innerHTML = `
            <select data-index="${index}" data-type="spoken" data-key="language">${langSelectOptions}</select>
            <select data-index="${index}" data-type="spoken" data-key="level">${levelSelectOptions}</select>
            <button type="button" class="remove-btn" data-index="${index}" data-type="spoken">X</button>`;
        languagesSpokenList.appendChild(li);
    });

    languagesLearningList.innerHTML = '';
    (profileData.languagesLearning || []).forEach((lang, index) => {
        const li = document.createElement('li');
        li.className = 'language-item';
        const learningSelectOptions = languageOptions.map(option => `<option value="${option}" ${lang === option ? 'selected' : ''}>${option}</option>`).join('');
        li.innerHTML = `
            <select data-index="${index}" data-type="learning">${learningSelectOptions}</select>
            <button type="button" class="remove-btn" data-index="${index}" data-type="learning">X</button>`;
        languagesLearningList.appendChild(li);
    });
}
    async function populatePage() {
        if (!profileData || !profileData.user) return;
        
        const isOnline = isOwnProfile ? true : profileData.user.isOnline;
        profilePicture.src = profileData.profilePicture || 'default-avatar.png';
        nicknameDisplay.textContent = profileData.user.nickname;
        statusDisplay.className = `status ${isOnline ? 'online' : 'offline'}`;
        statusDisplay.innerHTML = `<div class="dot"></div><span>${isOnline ? 'Online agora' : 'Offline'}</span>`;
        const countryInfo = await getCountryInfo(profileData.country);
        countryName.textContent = countryInfo.name;
        countryFlag.innerHTML = countryInfo.flag;
        document.getElementById('firstName').value = profileData.firstName || '';
        document.getElementById('lastName').value = profileData.lastName || '';
        emailInput.value = profileData.user.email || '';
        document.getElementById('dateOfBirth').value = profileData.dateOfBirth ? new Date(profileData.dateOfBirth).toISOString().split('T')[0] : '';
        document.getElementById('country').value = profileData.country || '';
        document.getElementById('aboutMe').value = profileData.aboutMe || '';
        document.getElementById('perfectPartner').value = profileData.perfectPartner || '';
        document.getElementById('learningReason').value = profileData.learningReason || '';
        renderLanguageLists();
        const fullName = [profileData.firstName, profileData.lastName].filter(Boolean).join(' ');
        fullNameDisplay.innerHTML = `<label>Nome Completo</label><p class="info-text ${fullName ? '' : 'empty'}">${fullName || 'Não informado'}</p>`;
        const age = calculateAge(profileData.dateOfBirth);
        ageDisplay.innerHTML = `<label>Idade</label><p class="info-text ${age ? '' : 'empty'}">${age ? `${age} anos` : 'Não informada'}</p>`;
        let spokenHtml = '<label>Idiomas que fala</label>';
        if (Array.isArray(profileData.languagesSpoken) && profileData.languagesSpoken.length > 0) {
            spokenHtml += `<div class="language-pills">${profileData.languagesSpoken.map(lang => `<span class="lang-pill speaks">${lang.language} (${lang.level})</span>`).join('')}</div>`;
        } else {
            spokenHtml += `<p class="info-text empty">Nenhum idioma informado.</p>`;
        }
        languagesSpokenDisplay.innerHTML = spokenHtml;
        let learningHtml = '<label>Quero aprender</label>';
        if (Array.isArray(profileData.languagesLearning) && profileData.languagesLearning.length > 0) {
            learningHtml += `<div class="language-pills">${profileData.languagesLearning.map(lang => `<span class="lang-pill learning">${lang}</span>`).join('')}</div>`;
        } else {
            learningHtml += `<p class="info-text empty">Nenhum idioma informado.</p>`;
        }
        languagesLearningDisplay.innerHTML = learningHtml;
        aboutMeDisplay.innerHTML = `<label>Sobre mim</label><p class="info-text ${profileData.aboutMe ? '' : 'empty'}">${profileData.aboutMe || 'Nenhuma informação fornecida.'}</p>`;
        perfectPartnerDisplay.innerHTML = `<label>Parceria linguística perfeita</label><p class="info-text ${profileData.perfectPartner ? '' : 'empty'}">${profileData.perfectPartner || 'Nenhuma informação fornecida.'}</p>`;
        learningReasonDisplay.innerHTML = `<label>Motivo para aprender</label><p class="info-text ${profileData.learningReason ? '' : 'empty'}">${profileData.learningReason || 'Nenhuma informação fornecida.'}</p>`;
        toggleProfileView();
    }
    
    function updateConnectionButton() {
        if (!connectBtn || isOwnProfile || !currentUser) {
            if (connectionControls) connectionControls.style.display = 'none';
            return;
        }
        connectionControls.style.display = 'flex';
        const { connectionStatus, connectionId } = profileData;
        connectBtn.dataset.connectionId = connectionId || '';
        switch (connectionStatus) {
            case 'PENDING_SENT':
                connectBtn.textContent = 'Pedido Enviado';
                connectBtn.disabled = true;
                break;
            case 'PENDING_RECEIVED':
                connectBtn.textContent = 'Aceitar Pedido';
                connectBtn.className = 'btn-connect btn-accept';
                connectBtn.onclick = () => handleConnectionAction('accept', connectionId);
                break;
            case 'ACCEPTED':
                connectBtn.textContent = 'Desconectar';
                connectBtn.className = 'btn-connect btn-disconnect';
                connectBtn.onclick = () => handleConnectionAction('delete', connectionId);
                break;
            default:
                connectBtn.textContent = 'Conectar';
                connectBtn.className = 'btn-connect';
                connectBtn.disabled = false;
                connectBtn.onclick = () => handleConnectionAction('request', profileData.user.id);
                break;
        }
    }

    async function handleConnectionAction(action, targetId) {
        const urlMap = {
            request: `/api/connections/request/${targetId}`,
            accept: `/api/connections/accept/${targetId}`,
            delete: `/api/connections/delete/${targetId}`
        };
        const methodMap = { request: 'POST', accept: 'PUT', delete: 'DELETE' };
        try {
            const response = await fetch(urlMap[action], { method: methodMap[action] });
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Ação falhou.');
            }
            await initializePage(true);
        } catch (error) {
            alert(`Erro: ${error.message}`);
        }
    }
    
    function toggleProfileView() {
        if (isOwnProfile) {
            viewModeContainer.style.display = 'none';
            profileForm.style.display = 'block';
            uploadButton.style.display = 'flex';
            editNicknameBtn.style.display = 'block';
            connectionControls.style.display = 'none';
        } else {
            viewModeContainer.style.display = 'block';
            profileForm.style.display = 'none';
            uploadButton.style.display = 'none';
            editNicknameBtn.style.display = 'none';
            updateConnectionButton();
        }
    }
    
    // --- EVENT LISTENERS ---

    // Listener para o formulário de salvamento.
    profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            nickname: document.getElementById('nicknameDisplay').textContent,
            firstName: document.getElementById('firstName').value,
            lastName: document.getElementById('lastName').value,
            dateOfBirth: document.getElementById('dateOfBirth').value,
            country: document.getElementById('country').value,
            aboutMe: document.getElementById('aboutMe').value,
            perfectPartner: document.getElementById('perfectPartner').value,
            learningReason: document.getElementById('learningReason').value,
            profilePicture: base64Image || profileData.profilePicture,
            languagesSpoken: (profileData.languagesSpoken || []).filter(l => l && l.language),
            languagesLearning: (profileData.languagesLearning || []).filter(l => l),
        };
        try {
            const response = await fetch('/api/profile/me', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                const errorResult = await response.json();
                throw new Error(errorResult.error || 'Falha ao salvar o perfil.');
            }
            alert('Perfil atualizado com sucesso!');
            base64Image = null;
        } catch (error) {
            alert(`Erro ao salvar: ${error.message}`);
        }
    });

    // ================================================================
    // == CORREÇÃO: ADIÇÃO DOS LISTENERS PARA FOTO E NICKNAME ABAIXO ==
    // ================================================================

    // 1. Botão de Upload de Foto
    uploadButton.addEventListener('click', () => {
        profilePictureInput.click(); // Aciona o clique no input de arquivo escondido
    });

    // 2. Input de Arquivo (quando uma nova foto é escolhida)
    profilePictureInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Validação opcional de tamanho
        if (file.size > 2 * 1024 * 1024) { // 2MB
            return alert('A imagem é muito grande! O tamanho máximo é 2MB.');
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            base64Image = event.target.result; // Salva a imagem em base64 na variável
            profilePicture.src = base64Image;   // Mostra a pré-visualização da imagem
        };
        reader.readAsDataURL(file);
    });

    // 3. Botão para começar a editar o Nickname
    editNicknameBtn.addEventListener('click', () => {
        // Esconde o texto e o botão de editar
        nicknameDisplay.style.display = 'none';
        editNicknameBtn.style.display = 'none';
        // Mostra o container de edição
        editNicknameInputContainer.style.display = 'flex';
        // Coloca o texto atual no campo de input
        nicknameInput.value = nicknameDisplay.textContent;
        nicknameInput.focus();
    });

    // 4. Botão para salvar o novo Nickname
    saveNicknameBtn.addEventListener('click', () => {
        const newNickname = nicknameInput.value.trim();
        if (newNickname && newNickname.length > 0) {
            nicknameDisplay.textContent = newNickname;
        }
        // Esconde o container de edição
        editNicknameInputContainer.style.display = 'none';
        // Mostra o texto e o botão de editar novamente
        nicknameDisplay.style.display = 'block';
        editNicknameBtn.style.display = 'block';
    });

    // 5. Botão para cancelar a edição do Nickname
    cancelNicknameBtn.addEventListener('click', () => {
        // Apenas esconde o container de edição e mostra o original, sem salvar
        editNicknameInputContainer.style.display = 'none';
        nicknameDisplay.style.display = 'block';
        editNicknameBtn.style.display = 'block';
    });

addSpokenLanguageBtn.addEventListener('click', () => {
    if (!Array.isArray(profileData.languagesSpoken)) {
        profileData.languagesSpoken = [];
    }
    // Adiciona um novo idioma padrão para o usuário preencher
    profileData.languagesSpoken.push({ language: 'English', level: 'A1' });
    renderLanguageLists(); // Redesenha a lista para incluir o novo item
});

addLearningLanguageBtn.addEventListener('click', () => {
    if (!Array.isArray(profileData.languagesLearning)) {
        profileData.languagesLearning = [];
    }
    // Adiciona um novo idioma padrão
    profileData.languagesLearning.push('English');
    renderLanguageLists(); // Redesenha a lista
});

// Listener "delegado" para os botões de remover e para os selects.
// Ele fica no formulário e observa cliques/mudanças nos elementos internos.
profileForm.addEventListener('click', (e) => {
    // Verifica se o clique foi em um botão de remover
    if (e.target.matches('.remove-btn')) {
        const { index, type } = e.target.dataset;
        if (type === 'spoken') {
            profileData.languagesSpoken.splice(index, 1); // Remove o item da lista
        } else if (type === 'learning') {
            profileData.languagesLearning.splice(index, 1); // Remove o item da lista
        }
        renderLanguageLists(); // Redesenha a lista atualizada
    }
});

profileForm.addEventListener('change', (e) => {
    // Verifica se a mudança foi em um dos selects de idioma
    if (e.target.matches('.language-item select')) {
        const { index, type, key } = e.target.dataset;
        if (type === 'spoken') {
            // Atualiza o idioma ou o nível no objeto correspondente
            profileData.languagesSpoken[index][key] = e.target.value;
        } else if (type === 'learning') {
            // Atualiza o idioma na lista de aprendizado
            profileData.languagesLearning[index] = e.target.value;
        }
    }
});

    // --- INICIALIZAÇÃO DA PÁGINA ---
    async function initializePage(forceReload = false) {
        if (!forceReload) body.classList.add('loading');
        
        try {
            const statusResponse = await fetch('/api/user/status');
            const statusData = await statusResponse.json();
            currentUser = statusData.loggedIn ? statusData.user : null;

            const params = new URLSearchParams(window.location.search);
            const urlUserId = params.get('userId');
            
            let fetchUrl;
            if (urlUserId) {
                isOwnProfile = currentUser && (urlUserId === currentUser.id);
                fetchUrl = `/api/profile/${urlUserId}`;
            } else if (currentUser) {
                isOwnProfile = true;
                fetchUrl = '/api/profile/me';
            } else {
                window.location.href = '/login.html';
                return;
            }

            const profileResponse = await fetch(fetchUrl);
            if (!profileResponse.ok) throw new Error('Perfil não encontrado.');
            profileData = await profileResponse.json();

            if (!socket) {
                socket = io();
                socket.on('user_status_change', ({ userId, isOnline }) => {
                    if (profileData.user.id === userId) {
                        statusDisplay.className = `status ${isOnline ? 'online' : 'offline'}`;
                        statusDisplay.innerHTML = `<div class="dot"></div><span>${isOnline ? 'Online agora' : 'Offline'}</span>`;
                    }
                });
            }
            
            populateCountriesDropdown();
            await populatePage();

        } catch (error) {
            console.error("Erro na inicialização da página:", error);
            document.querySelector('.container').innerHTML = `<h1>Erro ao carregar o perfil</h1><p>${error.message}</p>`;
        } finally {
            if (!forceReload) body.classList.remove('loading');
        }
    }

    initializePage();
});
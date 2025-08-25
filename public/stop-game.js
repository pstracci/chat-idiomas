document.addEventListener('DOMContentLoaded', () => {
    const socket = io('/stop');

    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('id');

    // Elementos da UI
    const roomTitleEl = document.getElementById('roomTitle');
    const playerListDiv = document.getElementById('player-list');
    const playerStatusListDiv = document.getElementById('player-status-list');
    const gameGridEl = document.getElementById('game-grid');
    const gameStatusBar = document.querySelector('.game-status-bar');
    const currentLetterSpan = document.getElementById('current-letter');
    const currentRoundSpan = document.getElementById('current-round');
    const timerSpan = document.getElementById('timer');
    const startGameBtn = document.getElementById('start-game-btn');
    const readyBtn = document.getElementById('ready-btn');
    const stopBtn = document.getElementById('stop-btn');
    const newGameBtn = document.getElementById('new-game-btn');
    const gameChatMessages = document.getElementById('game-chat-messages');
    const gameChatInput = document.getElementById('game-chat-input');
    const gameChatEmojiBtn = document.getElementById('game-chat-emoji-btn');
    const gameEmojiPicker = document.getElementById('game-emoji-picker');
    const gameChatSendBtn = document.getElementById('game-chat-send-btn');
    const backToLobbyBtn = document.getElementById('back-to-lobby');
    const mentionSuggestions = document.getElementById('mentionSuggestions');
    const mentionSound = document.getElementById('mentionSound');

    // Variáveis de estado do jogo e do chat
    let isOwner = false;
    let currentRoomInfo = null;
    let roomCategories = [];
    let currentRound = 0;
    let isFinalRound = false;
    let roundTimerInterval;
    let currentUserNickname = '';
    let playerNicknames = [];
    let mentionMode = false;
    let mentionQuery = '';
    let isAudioUnlocked = false;

    if (!roomId) {
        alert('ID da sala não encontrado.');
        window.location.href = '/stop-lobby.html';
        return;
    }

    fetch('/api/user/status')
        .then(res => res.json())
        .then(data => {
            if (data.loggedIn) {
                currentUserNickname = data.user.nickname;
            }
        });

    backToLobbyBtn.addEventListener('click', (e) => {
        e.preventDefault();
        window.location.href = '/stop-lobby.html';
    });

    // --- Funções de Controle da UI ---
    function showGameControls() {
        if (isOwner) {
            startGameBtn.style.display = 'inline-block';
            readyBtn.style.display = 'none';
            startGameBtn.disabled = true;
            startGameBtn.textContent = 'Aguardando Jogadores...';
            startGameBtn.classList.remove('btn-start');
        } else {
            startGameBtn.style.display = 'none';
            readyBtn.style.display = 'inline-block';
        }
    }

    function displayRoomInfo(room, isSpectating = false) {
        currentRoomInfo = room;
        gameGridEl.innerHTML = '';

        if (isSpectating) {
            gameGridEl.innerHTML = `<div class="room-settings-panel" style="text-align: center; justify-content: center; align-items: center; height: 100%;">
                <div>
                    <h2 class="settings-header">Existe um jogo em andamento...</h2>
                    <p class="waiting-message">Por favor, aguarde o final da rodada para participar.</p>
                </div>
            </div>`;
            return;
        }

        let settingsHTML;
        const maxPlayerOptions = [2, 3, 4, 5, 6, 8, 10].map(num => `<option value="${num}" ${room.maxParticipants == num ? 'selected' : ''}>${num} jogadores</option>`).join('');
        const totalRoundsOptions = [3, 5, 7, 10].map(num => `<option value="${num}" ${room.totalRounds == num ? 'selected' : ''}>${num} rodadas</option>`).join('');

        if (isOwner) {
            roomCategories = [...room.categories];
            settingsHTML = `
                <div class="room-settings-panel">
                    <h2 class="settings-header">⚙️ Configurações da Sala ⚙️</h2>
                    <div class="settings-main-row">
                        <div class="settings-column">
                            <div class="settings-group">
                                <label for="edit-room-name">🏷️ Nome da Sala</label>
                                <input type="text" id="edit-room-name" value="${room.name}" maxlength="26" />
                            </div>
                            <div class="settings-group">
                                <label for="edit-room-private">🔑 Tipo de Sala</label>
                                <select id="edit-room-private">
                                    <option value="false" ${!room.isPrivate ? 'selected' : ''}>🌐 Pública</option>
                                    <option value="true" ${room.isPrivate ? 'selected' : ''}>🔒 Privada</option>
                                </select>
                            </div>
                            <div class="settings-group" id="edit-password-group" style="display: ${room.isPrivate ? 'block' : 'none'};">
                                <label for="edit-room-password">🤫 Senha</label>
                                <input type="password" id="edit-room-password" placeholder="Mantenha em branco para não alterar" maxlength="10" />
                            </div>
                        </div>
                        <div class="settings-column">
                             <div class="settings-group">
                                <label for="edit-max-participants">👥 Máx. de Jogadores</label>
                                <select id="edit-max-participants">${maxPlayerOptions}</select>
                            </div>
                            <div class="settings-group">
                                <label for="edit-total-rounds">🔄 Rodadas</label>
                                <select id="edit-total-rounds">${totalRoundsOptions}</select>
                            </div>
                        </div>
                    </div>
                    <div>
                        <div class="settings-group">
                            <label for="add-category-input">📚 Categorias (mínimo 1, máximo 15)</label>
                            <div id="add-category-input-container">
                                <input type="text" id="add-category-input" placeholder="Adicionar categoria..." maxlength="15">
                                <button id="add-category-btn" class="btn">Add</button>
                            </div>
                            <div id="category-tags-container"></div>
                        </div>
                        <button id="save-settings-btn" class="btn save-settings-btn">Salvar Alterações</button>
                    </div>
                    <p class="waiting-message">O jogo irá começar em breve...</p>
                </div>`;
        } else {
            settingsHTML = `
                 <div class="room-settings-panel">
                    <h2 class="settings-header">"${room.name}"</h2>
                    <div class="settings-main-row">
                        <div class="settings-column">
                            <div class="settings-group">
                                <label>⭐ Líder da Sala</label>
                                <p class="static-value">${room.ownerNickname}</p>
                            </div>
                            <div class="settings-group">
                                <label>👥 Máx. de Jogadores</label>
                                <p class="static-value">${room.maxParticipants}</p>
                            </div>
                        </div>
                        <div class="settings-column">
                             <div class="settings-group">
                                <label>🔑 Tipo de Sala</label>
                                <p class="static-value">${room.isPrivate ? '🔒 Privada' : '🌐 Pública'}</p>
                            </div>
                            <div class="settings-group">
                                <label>🔄 Rodadas</label>
                                <p class="static-value">${room.totalRounds}</p>
                            </div>
                        </div>
                    </div>
                    <div>
                         <div class="settings-group">
                            <label>📚 Categorias</label>
                            <div id="category-tags-container">
                                ${room.categories.map(cat => `<span class="category-tag">${cat}</span>`).join('')}
                            </div>
                        </div>
                    </div>
                    <p class="waiting-message">O jogo irá começar em breve...</p>
                </div>`;
        }
        gameGridEl.innerHTML = settingsHTML;

        if (isOwner) {
            bindOwnerControls();
            renderCategoryTags();
        }
    }

    function bindOwnerControls() {
        document.getElementById('edit-room-private').addEventListener('change', (e) => {
            document.getElementById('edit-password-group').style.display = e.target.value === 'true' ? 'block' : 'none';
        });

        document.getElementById('add-category-btn').addEventListener('click', addCategory);
        document.getElementById('add-category-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); addCategory(); }
        });

        document.getElementById('save-settings-btn').addEventListener('click', () => {
            const newIsPrivate = document.getElementById('edit-room-private').value === 'true';
            const newPassword = document.getElementById('edit-room-password').value;

            if (newIsPrivate && !newPassword && !currentRoomInfo.password) {
                return alert('Salas privadas precisam de uma senha!');
            }

            socket.emit('ownerUpdateRoomSettings', {
                name: document.getElementById('edit-room-name').value,
                isPrivate: newIsPrivate, password: newPassword, categories: roomCategories,
                maxParticipants: parseInt(document.getElementById('edit-max-participants').value),
                totalRounds: parseInt(document.getElementById('edit-total-rounds').value)
            });
        });
    }

    function renderCategoryTags() {
        const container = document.getElementById('category-tags-container');
        if (!container) return;
        container.innerHTML = '';
        roomCategories.forEach((category, index) => {
            const tag = document.createElement('span');
            tag.className = 'category-tag';
            tag.textContent = category;
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-tag-btn';
            removeBtn.innerHTML = '&times;';
            removeBtn.onclick = () => { roomCategories.splice(index, 1); renderCategoryTags(); };
            tag.appendChild(removeBtn);
            container.appendChild(tag);
        });
    }

    function addCategory() {
        if (roomCategories.length >= 15) return alert('Máximo de 15 categorias atingido.');
        const input = document.getElementById('add-category-input');
        const categoryValue = input.value.trim();
        if (categoryValue.length > 15) return alert('O nome da categoria não pode ter mais de 15 caracteres.');
        if (categoryValue && !roomCategories.find(c => c.toLowerCase() === categoryValue.toLowerCase())) {
            roomCategories.push(categoryValue);
            input.value = '';
            renderCategoryTags();
        }
        input.focus();
    }
    
    function launchConfetti() {
        const container = document.getElementById('confetti-container');
        if (!container) return;
        container.innerHTML = '';
        const colors = ['#6f42c1', '#28a745', '#007bff', '#ffc107', '#dc3545'];
        for (let i = 0; i < 100; i++) {
            const confetti = document.createElement('div');
            confetti.className = 'confetti';
            confetti.style.left = `${Math.random() * 100}%`;
            confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.animation = `confetti-fall ${2 + Math.random() * 3}s linear ${Math.random() * 2}s forwards`;
            container.appendChild(confetti);
        }
    }
    function sendStopMessage() {
        const text = gameChatInput.value.trim();
        if (!text) return;
        if (!isAudioUnlocked && mentionSound) {
            mentionSound.play().then(() => {
                mentionSound.pause(); mentionSound.currentTime = 0; isAudioUnlocked = true;
            }).catch(() => { isAudioUnlocked = true; });
        }
        const mentions = playerNicknames.filter(u => text.includes(`@${u}`));
        socket.emit('stopMessage', { text, mentions });
        gameChatInput.value = '';
        mentionSuggestions.style.display = 'none';
        mentionMode = false;
    }
    
    // --- FUNÇÃO ATUALIZADA PARA LIDAR COM MENSAGENS DE SISTEMA ---
    function addStopMessage(msg) {
        const p = document.createElement('p');
        
        // Verifica se a mensagem é do sistema
        if (msg.isSystemMessage) {
            p.className = 'system-message'; // Adiciona uma classe para estilização
            p.innerHTML = `<em>${msg.text}</em>`;
        } else {
            // Lógica de menção e mensagem normal
            if (msg.mentions && msg.mentions.includes(currentUserNickname)) {
                p.classList.add('mention-highlight');
                if (mentionSound && isAudioUnlocked) {
                    mentionSound.play().catch(e => console.error("Erro ao tocar som de menção:", e));
                }
            }
            p.innerHTML = `<strong style="color: ${msg.color || '#000000'};">${msg.nickname}:</strong> ${msg.text}`;
        }
    
        gameChatMessages.appendChild(p);
        gameChatMessages.scrollTop = gameChatMessages.scrollHeight;
    }

    function showMentionList() {
        const filteredUsers = playerNicknames.filter(user => user.toLowerCase().startsWith(mentionQuery) && user !== currentUserNickname);
        if (filteredUsers.length === 0 || !mentionMode) {
            mentionSuggestions.style.display = 'none'; return;
        }
        mentionSuggestions.innerHTML = '';
        filteredUsers.forEach(user => {
            const div = document.createElement('div');
            div.textContent = user;
            div.onclick = () => insertMention(user);
            mentionSuggestions.appendChild(div);
        });
        mentionSuggestions.style.display = 'block';
    }
    function insertMention(username) {
        const value = gameChatInput.value;
        const cursorPos = gameChatInput.selectionStart;
        const textBeforeCursor = value.slice(0, cursorPos);
        const atIndex = textBeforeCursor.lastIndexOf('@');
        gameChatInput.value = textBeforeCursor.slice(0, atIndex) + `@${username} ` + value.slice(cursorPos);
        mentionSuggestions.style.display = 'none';
        mentionMode = false;
        gameChatInput.focus();
        const newCursorPos = atIndex + username.length + 2;
        gameChatInput.setSelectionRange(newCursorPos, newCursorPos);
    }
    window.mentionPlayer = (nickname) => {
        if (gameChatInput.value.slice(-1) !== ' ' && gameChatInput.value.length > 0) gameChatInput.value += ' ';
        gameChatInput.value += `@${nickname} `;
        gameChatInput.focus();
    };
    const emojis = ["😀", "😂", "😊", "😍", "🤔", "👍", "👎", "❤️", "🔥", "🎉", "😎", "😭", "🙏", "🚀", "💡", "💯"];
    emojis.forEach(e => {
        const span = document.createElement('span');
        span.textContent = e;
        span.onclick = () => { gameChatInput.value += e; gameChatInput.focus(); gameEmojiPicker.style.display = 'none'; };
        gameEmojiPicker.appendChild(span);
    });
    gameChatEmojiBtn.addEventListener('click', (e) => { e.stopPropagation(); gameEmojiPicker.style.display = gameEmojiPicker.style.display === 'flex' ? 'none' : 'flex'; });
    document.addEventListener('click', (e) => {
        if (!gameEmojiPicker.contains(e.target) && e.target !== gameChatEmojiBtn) gameEmojiPicker.style.display = 'none';
        if (!mentionSuggestions.contains(e.target) && e.target !== gameChatInput) mentionSuggestions.style.display = 'none';
    });
    gameChatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !mentionMode) { e.preventDefault(); sendStopMessage(); } });
    gameChatInput.addEventListener('input', () => {
        const value = gameChatInput.value; const cursorPos = gameChatInput.selectionStart;
        const textBeforeCursor = value.slice(0, cursorPos); const atIndex = textBeforeCursor.lastIndexOf('@');
        if (atIndex !== -1 && (atIndex === 0 || /\s/.test(value[atIndex - 1]))) {
            mentionQuery = textBeforeCursor.slice(atIndex + 1).toLowerCase();
            if (/\s/.test(mentionQuery)) { mentionMode = false; mentionSuggestions.style.display = 'none'; return; }
            mentionMode = true; showMentionList();
        } else { mentionMode = false; mentionSuggestions.style.display = 'none'; }
    });
    gameChatSendBtn.addEventListener('click', sendStopMessage);

    // --- Listeners de Eventos do Socket ---
    socket.on('connect', () => {
        socket.emit('playerReady', { roomId });
    });
    socket.on('settingsError', (message) => { alert(`Erro ao salvar: ${message}`); });

    // --- NOVO LISTENER PARA FEEDBACK DE SUCESSO ---
    socket.on('settingsUpdateSuccess', (message) => {
        alert(message);
    });

    socket.on('ownerCanStart', (canStart) => {
        if (!isOwner) return;
        let buttonText = "Iniciar Jogo";
        if (currentRound > 0) buttonText = isFinalRound ? "Ver Resultados" : "Próxima Rodada";
        startGameBtn.disabled = !canStart;
        if (canStart) {
            startGameBtn.textContent = buttonText;
            startGameBtn.classList.add('btn-start');
        } else {
            startGameBtn.textContent = 'Aguardando Jogadores...';
            startGameBtn.classList.remove('btn-start');
        }
    });

    socket.on('updatePlayerList', (players) => {
        playerListDiv.innerHTML = '';
        playerStatusListDiv.innerHTML = '';
        playerNicknames = players.map(p => p.nickname);

        if (!isOwner) {
            const currentPlayer = players.find(p => p.nickname === currentUserNickname);
            if (currentPlayer) {
                if (currentPlayer.isReady) {
                    readyBtn.textContent = 'Pronto!';
                    readyBtn.classList.remove('btn-primary');
                    readyBtn.classList.add('btn-start');
                } else {
                    readyBtn.textContent = 'Estou Pronto!';
                    readyBtn.classList.remove('btn-start');
                    readyBtn.classList.add('btn-primary');
                }
            }
        }
        
        players.sort((a, b) => b.score - a.score).forEach(player => {
            const playerDiv = document.createElement('div');
            if (player.nickname !== currentUserNickname) {
                playerDiv.setAttribute('onclick', `mentionPlayer('${player.nickname}')`);
                playerDiv.title = `Mencionar @${player.nickname}`;
            }
            const icon = player.isOwner ? '⭐' : '👤';
            let trophyHTML = '';
            if (player.wins > 0) trophyHTML = ` 🏆${player.wins > 1 ? `(${player.wins})` : ''}`;
            playerDiv.innerHTML = `<span>${icon} ${player.nickname}${trophyHTML}</span> <span>${player.score} pts</span>`;
            playerListDiv.appendChild(playerDiv);

            if (!player.isOwner) {
                const statusCard = document.createElement('div');
                const statusClass = player.isReady ? 'status-ready' : 'status-waiting';
                const statusText = player.isReady ? 'Pronto' : 'Aguardando';
                statusCard.className = `status-card ${statusClass}`;
                statusCard.innerHTML = `<span class="player-name">${player.nickname}</span><strong class="player-status">${statusText}</strong>`;
                playerStatusListDiv.appendChild(statusCard);
            }
        });
    });

    socket.on('roomInfo', (room) => {
        currentRoomInfo = room;
        currentRound = room.currentRound || 0;
        isFinalRound = false;
        if (room && room.name) roomTitleEl.textContent = room.name;
        isOwner = room.isOwner;
        newGameBtn.style.display = 'none';

        if (room.isSpectating) {
            displayRoomInfo(room, true);
            startGameBtn.style.display = 'none';
            readyBtn.style.display = 'none';
            stopBtn.style.display = 'none';
        } else {
            showGameControls();
            displayRoomInfo(room, false);
        }
    });

    socket.on('roundStart', (data) => {
        currentRound = data.round;
        gameStatusBar.style.display = 'flex';
        gameGridEl.innerHTML = '';

        data.categories.forEach(cat => {
            const item = document.createElement('div');
            item.className = 'category-item';
            item.innerHTML = `<label>${cat}</label><input type="text" data-category="${cat}" autocomplete="off">`;
            gameGridEl.appendChild(item);
        });
        document.querySelector('.category-item input')?.focus();

        const inputs = gameGridEl.querySelectorAll('input');
        stopBtn.disabled = true;
        inputs.forEach(input => {
            input.addEventListener('input', () => {
                const allFilled = [...inputs].every(i => i.value.trim() !== '');
                stopBtn.disabled = !allFilled;
            });
        });

        currentLetterSpan.textContent = data.letter;
        currentRoundSpan.textContent = `${data.round}/${currentRoomInfo.totalRounds}`;
        startGameBtn.style.display = 'none';
        readyBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';

        clearInterval(roundTimerInterval);
        let timeLeft = data.duration;
        const updateTimer = () => {
            if (timeLeft < 0) {
                clearInterval(roundTimerInterval);
                timerSpan.textContent = "00:00";
                return;
            }
            const minutes = Math.floor(timeLeft / 60);
            const seconds = timeLeft % 60;
            timerSpan.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            timeLeft--;
        };
        updateTimer();
        roundTimerInterval = setInterval(updateTimer, 1000);
    });

    socket.on('roundEnd', (data) => {
        clearInterval(roundTimerInterval);
        document.querySelectorAll('.category-item input').forEach(input => input.disabled = true);
        stopBtn.style.display = 'none';

        const answers = {};
        document.querySelectorAll('.category-item input').forEach(input => {
            answers[input.dataset.category] = input.value.trim();
        });
        socket.emit('submitAnswers', answers);

        gameGridEl.innerHTML = `<div style="display:flex; justify-content: center; align-items: center; height: 100%; font-size: 1.2em; font-weight: 500;"><p>STOP! por ${data.initiator}. Validando respostas...</p></div>`;
        gameStatusBar.style.display = 'none';
    });

    socket.on('roundResults', (results) => {
        const { round, roundScores, allAnswers, participants, isFinalRound: final } = results;
        currentRound = round;
        isFinalRound = final;

        const players = participants?.sort((a, b) => a.nickname.localeCompare(b.nickname));
        if (!players || players.length === 0 || !roundScores || Object.keys(roundScores).length === 0) {
            gameGridEl.innerHTML = '<p style="text-align:center; padding-top: 20px;">Não há resultados para exibir ou ocorreu um erro.</p>';
            showGameControls(); return;
        };

        gameGridEl.innerHTML = '';
        gameStatusBar.style.display = 'none';
        stopBtn.style.display = 'none';

        const firstPlayerWithScore = players.find(p => roundScores[p.id]);
        if (!firstPlayerWithScore) {
            gameGridEl.innerHTML = '<p style="text-align:center; padding-top: 20px;">Não há resultados para exibir.</p>';
            showGameControls(); return;
        }
        const categories = Object.keys(roundScores[firstPlayerWithScore.id].scores);

        let tableHTML = `<h2>Resultados da Rodada ${round}</h2><table id="results-table"><thead><tr><th>Participante</th>`;
        categories.forEach(cat => { tableHTML += `<th>${cat}</th>`; });
        tableHTML += `<th>Total</th></tr></thead><tbody>`;

        players.forEach(p => {
            if (!roundScores[p.id]) return;
            tableHTML += `<tr><td><strong>${p.isOwner ? '⭐' : '👤'} ${p.nickname}</strong></td>`;
            categories.forEach(cat => {
                const answer = allAnswers[p.id]?.[cat] || '-';
                const score = roundScores[p.id]?.scores[cat] ?? 0;
                tableHTML += `<td>${answer} <span>(${score})</span></td>`;
            });
            tableHTML += `<td><strong>+${roundScores[p.id]?.total || 0}</strong></td>`;
            tableHTML += '</tr>';
        });

        tableHTML += '</tbody></table>';
        gameGridEl.innerHTML = tableHTML;
        showGameControls();
    });

    socket.on('gameOver', ({ winner }) => {
        currentRound = 0;
        isFinalRound = false;
        gameGridEl.innerHTML = `
            <div id="confetti-container"></div>
            <div class="winner-screen">
                <p>Parabéns!</p>
                <span class="trophy">🏆</span>
                <h1>${winner.nickname}</h1>
                <p>Venceu o jogo com ${winner.score} pontos!</p>
            </div>`;
        launchConfetti();

        startGameBtn.style.display = 'none';
        readyBtn.style.display = 'none';
        stopBtn.style.display = 'none';
        if(isOwner) {
            newGameBtn.style.display = 'inline-block';
        }
    });

    newGameBtn.addEventListener('click', () => {
        if(isOwner) {
            socket.emit('requestNewGame');
        }
    });

    socket.on('ownerDestroyedRoom', () => {
        alert('O líder foi desconectado e a sala foi encerrada.');
        window.location.href = '/stop-lobby.html';
    });

    socket.on('stopChatHistory', (history) => {
        gameChatMessages.innerHTML = '';
        history.forEach(addStopMessage);
    });

    socket.on('newStopMessage', (message) => {
        addStopMessage(message);
    });

    // --- Listeners de Eventos dos Botões do Jogo ---
    readyBtn.addEventListener('click', () => {
        socket.emit('toggleReady');
    });

    startGameBtn.addEventListener('click', () => {
        socket.emit('startGame');
    });

    stopBtn.addEventListener('click', () => {
        stopBtn.disabled = true;
        socket.emit('playerPressedStop');
    });

    socket.on('error', (message) => {
        alert(`Erro: ${message}`);
        window.location.href = '/stop-lobby.html';
    });
});
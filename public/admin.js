// public/admin.js
document.addEventListener('DOMContentLoaded', () => {
    const usersTableBody = document.querySelector('#users-table tbody');
    const notificationForm = document.getElementById('notification-form');
    const notificationMessage = document.getElementById('notification-message');

    // --- GESTÃO DE UTILIZADORES ---

    async function loadUsers() {
        try {
            const response = await fetch('/api/admin/users');
            if (!response.ok) throw new Error('Falha ao carregar utilizadores.');
            const users = await response.json();
            
            usersTableBody.innerHTML = ''; // Limpa a tabela
            users.forEach(user => {
                const tr = document.createElement('tr');
                tr.id = `user-${user.id}`;
                tr.innerHTML = `
                    <td>${user.nickname}</td>
                    <td>${user.email}</td>
                    <td class="credits-cell">${user.credits}</td>
                    <td>${new Date(user.createdAt).toLocaleDateString('pt-BR')}</td>
                    <td class="actions-cell">
                        <button class="btn btn-edit" data-userid="${user.id}" data-nickname="${user.nickname}" data-credits="${user.credits}">Editar Créditos</button>
                        <button class="btn btn-delete" data-userid="${user.id}" data-nickname="${user.nickname}">Apagar</button>
                    </td>
                `;
                usersTableBody.appendChild(tr);
            });
        } catch (error) {
            alert(error.message);
        }
    }

    async function updateCredits(userId, currentCredits) {
        const newCredits = prompt(`Alterar créditos para o utilizador (atual: ${currentCredits}):`, currentCredits);
        if (newCredits === null || isNaN(newCredits) || newCredits < 0) {
            return; // Cancelado ou inválido
        }
        try {
            const response = await fetch(`/api/admin/users/${userId}/credits`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credits: parseInt(newCredits) }),
            });
            if (!response.ok) throw new Error('Falha ao atualizar créditos.');

            // Atualiza a tabela visualmente sem recarregar a página
            const userRow = document.getElementById(`user-${userId}`);
            if (userRow) {
                userRow.querySelector('.credits-cell').textContent = newCredits;
                userRow.querySelector('.btn-edit').dataset.credits = newCredits;
            }
            alert('Créditos atualizados com sucesso!');
        } catch (error) {
            alert(error.message);
        }
    }

    async function deleteUser(userId, nickname) {
        if (!confirm(`Tem a certeza ABSOLUTA que deseja apagar o utilizador ${nickname}? Esta ação é irreversível.`)) {
            return;
        }
        try {
            const response = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
            if (!response.ok) throw new Error('Falha ao apagar utilizador.');
            
            // Remove o utilizador da tabela visualmente
            const userRow = document.getElementById(`user-${userId}`);
            if (userRow) userRow.remove();
            
            alert(`Utilizador ${nickname} apagado com sucesso.`);
        } catch (error) {
            alert(error.message);
        }
    }

    // Listener de eventos para os botões na tabela
    usersTableBody.addEventListener('click', (e) => {
        const target = e.target;
        if (target.matches('.btn-edit')) {
            const { userid, nickname, credits } = target.dataset;
            updateCredits(userid, credits);
        }
        if (target.matches('.btn-delete')) {
            const { userid, nickname } = target.dataset;
            deleteUser(userid, nickname);
        }
    });

    // --- GESTÃO DE NOTIFICAÇÕES ---

    notificationForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const message = notificationMessage.value;
        if (!message.trim()) return alert('A mensagem não pode estar vazia.');

        if (!confirm("Tem a certeza que deseja enviar esta notificação para TODOS os utilizadores?")) {
            return;
        }

        try {
            const response = await fetch('/api/admin/notifications', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Falha ao enviar notificação.');
            
            alert(result.message);
            notificationMessage.value = '';
        } catch (error) {
            alert(error.message);
        }
    });

    // Carrega os utilizadores quando a página é aberta
    loadUsers();
});
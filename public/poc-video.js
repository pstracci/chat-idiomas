// public/poc-video.js
document.addEventListener('DOMContentLoaded', () => {
    const APP_ID = "fe8f70c4f818495c9a58a743b6faaa74"; 
    const CHANNEL = "verbi-test-channel";

    const rtcClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
    const rtmClient = AgoraRTM.createInstance(APP_ID);

    let localTracks = { videoTrack: null, audioTrack: null };
    let rtmChannel;
    let remoteUid = null;
    let localUid = null;

    // Elementos da UI
    const joinBtn = document.getElementById('join-btn');
    const leaveBtn = document.getElementById('leave-btn');
    const micBtn = document.getElementById('mic-btn');
    const camBtn = document.getElementById('cam-btn');
    const chatBox = document.getElementById('chat-box');
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');

    const join = async () => {
        try {
            const response = await fetch(`/api/agora/token?channelName=${CHANNEL}`);
            if (!response.ok) throw new Error('Falha ao obter tokens do servidor.');
            
            const data = await response.json();
            const { rtcToken, rtmToken, uid_rtc, userAccount } = data;
            localUid = uid_rtc;

            // 1. Logar no chat (RTM) com o userAccount (string) e o token RTM
            await rtmClient.login({ uid: userAccount, token: rtmToken });
            rtmChannel = rtmClient.createChannel(CHANNEL);
            await rtmChannel.join();
            console.log("Juntou-se ao canal RTM com sucesso");

            // Listener de mensagens do canal (ativado após o join)
            rtmChannel.on('ChannelMessage', ({ text }, senderId) => {
                addMessageToBox(`Utilizador ${senderId}: ${text}`);
            });
            
            // 2. Juntar-se ao canal de vídeo (RTC) com o uid_rtc (número) e o token RTC
            await rtcClient.join(APP_ID, CHANNEL, rtcToken, uid_rtc);
            console.log("Juntou-se ao canal RTC com sucesso");

            // 3. Criar e publicar as faixas de vídeo/áudio
            localTracks.audioTrack = await AgoraRTC.createMicrophoneAudioTrack();
            localTracks.videoTrack = await AgoraRTC.createCameraVideoTrack();
            await rtcClient.publish(Object.values(localTracks));
            console.log("Publicou faixas locais com sucesso");
            localTracks.videoTrack.play('local-player');

            addMessageToBox(`Sistema: Você entrou na sala.`);

        } catch (error) {
            console.error("Erro ao entrar na chamada:", error);
            alert("Não foi possível entrar na chamada. Verifique a consola (F12) para mais detalhes.");
        }
    };

    const leave = async () => {
        for (let trackName in localTracks) {
            let track = localTracks[trackName];
            if (track) {
                track.stop();
                track.close();
                localTracks[trackName] = null;
            }
        }
        
        document.getElementById('remote-players').innerHTML = '';
        document.getElementById('local-player').innerHTML = '';
        
        await rtcClient.leave();
        if (rtmChannel) {
            await rtmChannel.leave();
        }
        if (rtmClient.getStatus() === 'LOGIN_SUCCEEDED') {
            await rtmClient.logout();
        }

        addMessageToBox("Sistema: Você saiu da sala.");
        console.log("Saiu da chamada com sucesso");
    };
    
    const sendMessage = async () => {
        const text = chatInput.value;
        if (text.trim() === '' || !rtmChannel) return;
        try {
            await rtmChannel.sendMessage({ text });
            addMessageToBox(`Você: ${text}`);
            chatInput.value = '';
        } catch (error) {
            console.error("Erro ao enviar mensagem RTM:", error);
        }
    };

    const addMessageToBox = (message) => {
        const p = document.createElement('p');
        p.textContent = message;
        chatBox.appendChild(p);
        chatBox.scrollTop = chatBox.scrollHeight;
    };

    // Event Handlers da Agora
    rtcClient.on('user-published', async (user, mediaType) => {
        await rtcClient.subscribe(user, mediaType);
        remoteUid = user.uid;

        if (mediaType === 'video') {
            const remoteVideoTrack = user.videoTrack;
            const remotePlayerContainer = document.getElementById('remote-players');
            remotePlayerContainer.innerHTML = '';
            remoteVideoTrack.play(remotePlayerContainer);
        }

        if (mediaType === 'audio') {
            user.audioTrack.play();
        }
        addMessageToBox(`Sistema: Utilizador ${remoteUid} entrou na sala.`);
    });

    rtcClient.on('user-unpublished', (user) => {
        if(user.uid === remoteUid) {
            document.getElementById('remote-players').innerHTML = '';
            addMessageToBox(`Sistema: Utilizador ${remoteUid} saiu da sala.`);
            remoteUid = null;
        }
    });

    // Associações de Eventos da UI
    joinBtn.onclick = join;
    leaveBtn.onclick = leave;
    sendBtn.onclick = sendMessage;
    
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });
    
    micBtn.onclick = async () => {
        if (!localTracks.audioTrack) return;
        if (localTracks.audioTrack.enabled) {
            await localTracks.audioTrack.setEnabled(false);
            micBtn.textContent = 'Ligar Áudio';
        } else {
            await localTracks.audioTrack.setEnabled(true);
            micBtn.textContent = 'Mutar Áudio';
        }
    };
    
    camBtn.onclick = async () => {
        if (!localTracks.videoTrack) return;
        if (localTracks.videoTrack.enabled) {
            await localTracks.videoTrack.setEnabled(false);
            camBtn.textContent = 'Ligar Câmara';
        } else {
            await localTracks.videoTrack.setEnabled(true);
            camBtn.textContent = 'Desligar Câmara';
        }
    };
});
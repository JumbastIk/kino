// room.js

const BACKEND = window.location.hostname.includes('localhost')
  ? 'http://localhost:3000'
  : 'https://kino-fhwp.onrender.com';

const socket = io(BACKEND, {
  path: '/socket.io',
  transports: ['websocket']
});

// Из URL
const params = new URLSearchParams(window.location.search);
const roomId = params.get('roomId');
if (!roomId) {
  alert('Не указан ID комнаты.');
  location.href = 'index.html';
}

// элементы
const playerWrapper = document.getElementById('playerWrapper');
const backLink      = document.getElementById('backLink');
const msgInput      = document.getElementById('msgInput');
const sendBtn       = document.getElementById('sendBtn');
const messagesBox   = document.getElementById('messages');
const membersList   = document.getElementById('membersList');
const overlay       = document.querySelector('.chat-overlay');
const chatContainer = document.querySelector('.chat-container');

let player, isSeeking=false, isRemoteAction=false;

// WebRTC-чат...
let localStream=null;
const peers={};

// добавляем кнопку микрофона
const micBtn = document.createElement('button');
micBtn.textContent = '🎤';
micBtn.className = 'mic-btn';
document.querySelector('.chat-input-wrap').appendChild(micBtn);

// Push-to-Talk
micBtn.addEventListener('mousedown', async ()=>{
  if (!localStream) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({audio:true});
      // оповестим других
      socket.emit('new_peer',{roomId,from:socket.id});
    } catch(e){
      console.error(e);
      return alert('Нет доступа к микрофону');
    }
  }
  // генерим offer
  Object.keys(peers).forEach(id=>peers[id].close());
  for(const peerId of await registerPeers()) {/*...*/}
});
micBtn.addEventListener('mouseup', ()=>{
  if(localStream){
    localStream.getTracks().forEach(t=>t.stop());
    localStream=null;
  }
});

// Signal
socket.on('new_peer',async({from})=>{
  if (from===socket.id || !localStream) return;
  await makePeer(from,true);
});
socket.on('signal',async({from,description,candidate})=>{
  let pc=peers[from]||await makePeer(from,false);
  if(description){
    await pc.setRemoteDescription(description);
    if(description.type==='offer'){
      const ans=await pc.createAnswer();
      await pc.setLocalDescription(ans);
      socket.emit('signal',{to:from,description:pc.localDescription});
    }
  }
  if(candidate) await pc.addIceCandidate(candidate);
});
async function makePeer(peerId,isOffer){
  const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
  peers[peerId]=pc;
  if(localStream) localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
  pc.onicecandidate=e=>e.candidate&&socket.emit('signal',{to:peerId,candidate:e.candidate});
  pc.ontrack=e=>{
    let audio=document.getElementById(`audio_${peerId}`);
    if(!audio){
      audio=document.createElement('audio');
      audio.id=`audio_${peerId}`;
      audio.autoplay=true;
      document.body.appendChild(audio);
    }
    audio.srcObject=e.streams[0];
  };
  if(isOffer){
    const offer=await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal',{to:peerId,description:pc.localDescription});
  }
  return pc;
}
async function registerPeers(){
  const {data:members} = await fetch(`${BACKEND}/api/rooms/${roomId}/members`).then(r=>r.json());
  return members.map(m=>m.user_id).filter(id=>id!==socket.id);
}

// Socket.IO: join + чат + плеер
socket.emit('join',{roomId,userData:{id:socket.id,first_name:'Гость'}});
socket.emit('request_state',{roomId});

// список участников
socket.on('members',members=>{
  const cnt=members.length;
  membersList.innerHTML=`
    <div class="chat-members-label">Участники (${cnt}):</div>
    <ul>${members.map(m=>`<li>${m.user_id}</li>`).join('')}</ul>
  `;
});

// chat history
socket.on('history',data=>{
  messagesBox.innerHTML='';
  data.forEach(m=>appendMessage(m.author,m.text));
});
socket.on('chat_message',m=>appendMessage(m.author,m.text));

sendBtn.addEventListener('click',sendMessage);
msgInput.addEventListener('keydown',e=>e.key==='Enter'&&sendMessage());
function sendMessage(){
  const t=msgInput.value.trim();
  if(!t)return;
  socket.emit('chat_message',{roomId,author:'Гость',text:t});
  msgInput.value='';
}

// видео-синхронизация
socket.on('sync_state',({position=0,is_paused})=>{
  if(!player)return;
  isRemoteAction=true;
  player.currentTime=position;
  is_paused?player.pause():player.play().catch(()=>{});
  setTimeout(()=>isRemoteAction=false,200);
});
socket.on('player_update',({position=0,is_paused})=>{
  if(!player)return;
  isRemoteAction=true;
  isSeeking=true;
  player.currentTime=position;
  is_paused?player.pause():player.play().catch(()=>{});
  setTimeout(()=>{isSeeking=false;isRemoteAction=false;},200);
});

// spinner
function createSpinner(){
  const d=document.createElement('div');
  d.className='buffer-spinner';
  d.innerHTML='<div class="double-bounce1"></div><div class="double-bounce2"></div>';
  d.style.display='none';
  return d;
}

// отрисовка комнаты
async function fetchRoom(){
  try{
    const res=await fetch(`${BACKEND}/api/rooms/${roomId}`);
    if(!res.ok)throw new Error(res.status);
    const roomData=await res.json();

    const movie=movies.find(x=>x.id===roomData.movie_id);
    if(!movie||!movie.videoUrl)throw new Error('Фильм не найден');

    // back link
    backLink.href=`movie.html?id=${movie.id}`;

    // плеер + спиннер
    playerWrapper.innerHTML='';
    const wrapper=document.createElement('div');
    wrapper.className='video-container';
    wrapper.style.position='relative';
    wrapper.innerHTML=`<video id="videoPlayer" controls crossorigin="anonymous" playsinline style="width:100%;border-radius:14px"></video>`;
    const spinner=createSpinner();
    wrapper.appendChild(spinner);
    playerWrapper.appendChild(wrapper);

    // бейдж с ID (единственный)
    const badge=document.createElement('div');
    badge.className='room-id-badge';
    badge.innerHTML=`<small>ID комнаты:</small><code>${roomId}</code><button id="copyRoomId">Копировать</button>`;
    playerWrapper.after(badge);
    document.getElementById('copyRoomId').onclick=()=>{
      navigator.clipboard.writeText(roomId);
      alert('Скопировано');
    };

    const v=document.getElementById('videoPlayer');
    if(Hls.isSupported()){
      const hls=new Hls({debug:false});
      hls.loadSource(movie.videoUrl);
      hls.attachMedia(v);
      hls.on(Hls.Events.ERROR,(_,d)=>{
        console.error(d);
        alert('Ошибка видео');
      });
      v.addEventListener('waiting',()=>spinner.style.display='block');
      v.addEventListener('playing',()=>spinner.style.display='none');
    } else if(v.canPlayType('application/vnd.apple.mpegurl')){
      v.src=movie.videoUrl;
    } else throw new Error('HLS не поддерживается');

    // управление
    v.addEventListener('play',()=>{
      if(isSeeking||isRemoteAction)return;
      socket.emit('player_action',{roomId,position:v.currentTime,is_paused:false});
    });
    v.addEventListener('pause',()=>{
      if(isSeeking||isRemoteAction)return;
      socket.emit('player_action',{roomId,position:v.currentTime,is_paused:true});
    });
    v.addEventListener('seeking',()=>isSeeking=true);
    v.addEventListener('seeked',()=>{
      if(!isRemoteAction){
        socket.emit('player_action',{roomId,position:v.currentTime,is_paused:v.paused});
      }
      setTimeout(()=>isSeeking=false,200);
    });

    player=v;
  }catch(err){
    console.error(err);
    playerWrapper.innerHTML=`<p class="error">Ошибка: ${err.message}</p>`;
  }
}

fetchRoom();

// append chat
function appendMessage(a,t){
  const d=document.createElement('div');
  d.className='chat-message';
  d.innerHTML=`<strong>${a}:</strong> ${t}`;
  messagesBox.appendChild(d);
  messagesBox.scrollTop=messagesBox.scrollHeight;
}

// открыть/закрыть чат по overlay
overlay.addEventListener('click',e=>{
  if(e.target===overlay) overlay.classList.remove('active');
});
// предположим, что где-то есть кнопка открыть чат:
document.getElementById('openChatBtn')?.addEventListener('click',()=>{
  overlay.classList.add('active');
});

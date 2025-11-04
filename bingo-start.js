let cachedPlaylistTracks = [];
let selectedTrackUri = null;
let spotifyReady = null;

// Glücksrad Variablen
let wheelCanvas, wheelCtx, categories=[], wheelSpinning=false, pulseTimeout=null, pulsePhase=null;
let wheelRadius=180, currentAngle=0, rotationTarget=0;

function extractPlaylistId(url) {
  if (!url) return null;
  let m = url.match(/spotify:playlist:([A-Za-z0-9-_]+)/);
  if (m) return m[1];
  m = url.match(/playlist\/([A-Za-z0-9-_]+)/);
  if (m) return m[1];
  m = url.match(/[?&]id=([A-Za-z0-9-_]+)/);
  if (m) return m[1];
  return null;
}

// Fetch Playlist Tracks
async function fetchPlaylistTracks(playlistId) {
  const token = localStorage.getItem('access_token');
  if (!token) return [];
  const all = [];
  const limit=50;
  let offset=0;
  try {
    const metaResp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
      headers:{'Authorization':`Bearer ${token}`}
    });
    if (!metaResp.ok) return [];
    const meta = await metaResp.json();
    const total = meta.tracks?.total || 0;
    while(offset<total){
      const resp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`, {
        headers:{'Authorization':`Bearer ${token}`}
      });
      if(!resp.ok) break;
      const data = await resp.json();
      const valid=(data.items||[]).filter(i=>i && i.track && i.track.uri && !i.is_local);
      all.push(...valid);
      offset+=limit;
      if(!data.items || data.items.length===0) break;
    }
    return all;
  }catch(err){console.error('fetchPlaylistTracks error',err); return [];}
}

spotifyReady = new Promise(resolve=>{
  window.onSpotifyWebPlaybackSDKReady = ()=>{
    const token = localStorage.getItem('access_token');
    if(!token){ resolve(); return; }
    const player = new Spotify.Player({
      name:'Julster Bingo Player',
      getOAuthToken: cb => cb(token)
    });
    player.addListener('ready', ({device_id})=>{ window.deviceId=device_id; window.bingoPlayer=player; resolve(); });
    player.addListener('initialization_error', ({message})=>{console.error(message); resolve();});
    player.addListener('authentication_error', ({message})=>{console.error(message); resolve();});
    player.addListener('account_error', ({message})=>{console.error(message); resolve();});
    player.addListener('playback_error', ({message})=>{console.error(message); resolve();});
    player.connect().catch(err=>{console.warn('player connect error',err); resolve();});
  };
});

async function playTrack(uri){
  const token = localStorage.getItem('access_token');
  if(!token) return false;
  await spotifyReady;
  let waitTime=0;
  while(!window.deviceId && waitTime<6000){await new Promise(r=>setTimeout(r,200)); waitTime+=200;}
  try{
    const deviceParam = window.deviceId ? `?device_id=${window.deviceId}` : '';
    const resp = await fetch(`https://api.spotify.com/v1/me/player/play${deviceParam}`,{
      method:'PUT',
      headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({uris:[uri]})
    });
    return resp.status===204;
  }catch(err){console.error('playTrack error',err); return false;}
}

async function stopPlayback(){
  const token = localStorage.getItem('access_token');
  if(!token) return;
  try{ await fetch('https://api.spotify.com/v1/me/player/pause',{method:'PUT',headers:{'Authorization':`Bearer ${token}`}});}
  catch(err){console.warn('stopPlayback error',err);}
}

function getRandomTrack(tracks){
  if(!tracks || tracks.length===0) return null;
  const idx=Math.floor(Math.random()*tracks.length);
  return tracks[idx];
}

function updateTrackDetailsElement(track){
  const details=document.getElementById('track-details');
  if(!details) return;
  let expanded=false;
  details.textContent='Songinfos auflösen';
  details.onclick=()=>{
    if(!expanded){
      details.innerHTML=`
        <div>
          <p><strong>Titel:</strong> ${track.name}</p>
          <p><strong>Interpret:</strong> ${track.artists.map(a=>a.name).join(', ')}</p>
          <p><strong>Album:</strong> ${track.album.name||''}</p>
          <p><strong>Jahr:</strong> ${track.album.release_date ? track.album.release_date.substring(0,4):''}</p>
        </div>
      `;
      const weiterBtn=document.createElement('button');
      weiterBtn.className='btn details-weiter-btn green';
      weiterBtn.textContent='Nächster Song';
      weiterBtn.type='button';
      details.appendChild(weiterBtn);
      weiterBtn.addEventListener('click',async ev=>{
        ev.stopPropagation();
        stopPulse();
        await handleNextSong();
      });
      expanded=true;
    }else{
      details.textContent='Songinfos auflösen';
      expanded=false;
    }
  };
}

// Glücksrad-Funktionen
function drawWheel(){
  if(!wheelCanvas) return;
  const ctx = wheelCanvas.getContext('2d');
  const size=wheelCanvas.width;
  ctx.clearRect(0,0,size,size);
  const segAngle = 2*Math.PI/categories.length;
  const colors=['#f28b82','#fbbc04','#fff475','#ccff90','#a7ffeb','#cbf0f8','#aecbfa','#d7aefb','#fdcfe8','#e6c9a8'];
  for(let i=0;i<categories.length;i++){
    ctx.beginPath();
    ctx.moveTo(size/2,size/2);
    ctx.arc(size/2,size/2,wheelRadius,i*segAngle,(i+1)*segAngle);
    ctx.closePath();
    ctx.fillStyle=colors[i%colors.length];
    ctx.fill();
    ctx.save();
    ctx.translate(size/2,size/2);
    ctx.rotate(i*segAngle + segAngle/2);
    ctx.textAlign='right';
    ctx.fillStyle='#000';
    ctx.font='bold 16px Arial';
    ctx.fillText(categories[i], wheelRadius-10,5);
    ctx.restore();
  }
}

function spinWheel(){
  if(wheelSpinning) return;
  wheelSpinning=true;
  const segAngle = 360/categories.length;
  const idx=Math.floor(Math.random()*categories.length);
  rotationTarget=360*5 + idx*segAngle + segAngle/2; // 5 volle Drehungen + Ziel
  let start = null;
  function animate(timestamp){
    if(!start) start=timestamp;
    const progress=timestamp-start;
    const t = Math.min(progress/3000,1);
    const ease = 1 - Math.pow(1-t,3);
    currentAngle = ease*rotationTarget;
    wheelCanvas.style.transform=`rotate(${currentAngle}deg)`;
    if(t<1) requestAnimationFrame(animate);
    else{
      const selected = categories[idx];
      document.getElementById('selected-category').textContent='Kategorie: '+selected;
      startPulse();
      playNextSongAfterWheel();
    }
  }
  requestAnimationFrame(animate);
}

function playNextSongAfterWheel(){
  const item=getRandomTrack(cachedPlaylistTracks);
  if(!item || !item.track) return;
  selectedTrackUri=item.track.uri;
  playTrack(selectedTrackUri);
  updateTrackDetailsElement(item.track);
  cachedPlaylistTracks = cachedPlaylistTracks.filter(x=>x.track && x.track.uri!==selectedTrackUri);
}

function startPulse(){
  const wheel = wheelCanvas;
  if(!wheel) return;
  wheel.classList.add('pulsing-yellow');
  pulsePhase='yellow';
  pulseTimeout=setTimeout(()=>{
    wheel.classList.remove('pulsing-yellow');
    wheel.classList.add('pulsing-red');
    pulsePhase='red';
    const buzzer=new Audio('https://www.soundjay.com/button/beep-07.wav');
    buzzer.play();
    pulseTimeout=setTimeout(()=>{stopPulse();},5000);
  },15000);
}

function stopPulse(){
  clearTimeout(pulseTimeout);
  if(wheelCanvas) wheelCanvas.classList.remove('pulsing-yellow','pulsing-red');
  pulsePhase=null;
  wheelSpinning=false;
  document.getElementById('selected-category').textContent='';
}

document.addEventListener('DOMContentLoaded',async()=>{
  const token = localStorage.getItem('access_token');
  if(!token){ window.location.href='index.html'; return; }

  const loadingText = document.getElementById('loading-text');
  const startBtn = document.getElementById('start-btn');
  const nowPlaying = document.getElementById('now-playing');
  wheelCanvas=document.getElementById('wheel-canvas');

  const playlistUrl = localStorage.getItem('bingoPlaylistUrl') || localStorage.getItem('mobilePlaylistUrl') || '';
  const playlistId = extractPlaylistId(playlistUrl);
  if(!playlistId){ if(M) M.toast({html:'Keine gültige Playlist gefunden.',classes:'rounded'}); return; }

  loadingText.style.display='block';
  cachedPlaylistTracks = await fetchPlaylistTracks(playlistId);
  loadingText.style.display='none';
  if(!cachedPlaylistTracks || cachedPlaylistTracks.length===0){ document.getElementById('empty-warning').style.display='block'; return; }

  startBtn.style.display='inline-block';
  startBtn.classList.add('pulse');

  categories = JSON.parse(localStorage.getItem('bingoCategories')||'[]');
  if(categories.length>0){
    document.getElementById('wheel-container').style.display='block';
    drawWheel();
    wheelCanvas.addEventListener('click', spinWheel);
  }

  startBtn.addEventListener('click',()=>{
    startBtn.style.display='none';
    if(categories.length>0) wheelCanvas.style.display='block';
    else handleNextSong();
  });
});

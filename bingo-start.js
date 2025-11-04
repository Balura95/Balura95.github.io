let cachedPlaylistTracks = [];
let selectedTrackUri = null;
let spotifyReady = null;

let wheelCanvas, wheelCtx;
let categories = [];
let hasSpun = false;
let hasPulsed = false;
let selectedCategoryIndex = null;
let currentRotation = 0;

// Farben für Segmente
const colors = ['#FFB347','#FF6961','#77DD77','#84B6F4','#F49AC2','#FFD700','#FF7F50','#87CEEB'];

spotifyReady = new Promise(resolve => {
  window.onSpotifyWebPlaybackSDKReady = () => {
    const token = localStorage.getItem('access_token');
    if(!token){ resolve(); return; }
    const player = new Spotify.Player({
      name:'Julster Bingo Player',
      getOAuthToken: cb => cb(token)
    });
    player.addListener('ready', ({ device_id }) => { window.deviceId=device_id; window.bingoPlayer=player; resolve(); });
    ['initialization_error','authentication_error','account_error','playback_error'].forEach(e=>player.addListener(e,()=>resolve()));
    player.connect().catch(()=>resolve());
  };
});

function extractPlaylistId(url){
  if(!url) return null;
  const m = url.match(/spotify:playlist:([A-Za-z0-9-_]+)/)||url.match(/playlist\/([A-Za-z0-9-_]+)/)||url.match(/[?&]id=([A-Za-z0-9-_]+)/);
  return m ? m[1] : null;
}

async function fetchPlaylistTracks(playlistId){
  const token = localStorage.getItem('access_token'); if(!token) return [];
  const all=[]; const limit=50; let offset=0;
  const metaResp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`,{headers:{'Authorization':`Bearer ${token}`}});
  const meta=await metaResp.json(); const total=meta.tracks?.total||0;
  while(offset<total){
    const resp=await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`,{headers:{'Authorization':`Bearer ${token}`}});
    const data=await resp.json();
    const valid=(data.items||[]).filter(i=>i&&i.track&&i.track.uri&&!i.is_local);
    all.push(...valid); offset+=limit; if(!data.items||data.items.length===0) break;
  }
  return all;
}

async function playTrack(uri){
  const token = localStorage.getItem('access_token'); if(!token) return false;
  await spotifyReady;
  let waitTime=0;
  while(!window.deviceId&&waitTime<6000){ await new Promise(r=>setTimeout(r,200)); waitTime+=200; }
  try{
    const deviceParam = window.deviceId ? `?device_id=${window.deviceId}` : '';
    const resp = await fetch(`https://api.spotify.com/v1/me/player/play${deviceParam}`,{
      method:'PUT', headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({uris:[uri]})
    });
    return resp.status===204;
  }catch(e){ return false; }
}

async function stopPlayback(){ const token = localStorage.getItem('access_token'); if(!token) return; try{ await fetch('https://api.spotify.com/v1/me/player/pause',{method:'PUT',headers:{'Authorization':`Bearer ${token}`}});}catch(e){} }

function getRandomTrack(tracks){ return tracks[Math.floor(Math.random()*tracks.length)]; }

function updateTrackDetailsElement(track){
  const details=document.getElementById('track-details'); if(!details) return;
  let expanded=false; details.textContent='Songinfos auflösen';
  details.onclick = ()=>{
    if(!expanded){
      details.innerHTML=`
        <div>
          <p><strong>Titel:</strong> ${track.name}</p>
          <p><strong>Interpret:</strong> ${track.artists.map(a=>a.name).join(', ')}</p>
          <p><strong>Album:</strong> ${track.album.name}</p>
          <p><strong>Jahr:</strong> ${track.album.release_date?.substring(0,4)||''}</p>
        </div>
      `;
      const weiterBtn=document.createElement('button');
      weiterBtn.className='btn details-weiter-btn green'; weiterBtn.textContent='Weiter';
      details.appendChild(weiterBtn);
      weiterBtn.addEventListener('click',()=>{ resetAfterSong(); });
      expanded=true;
    }else{ details.textContent='Songinfos auflösen'; expanded=false; }
  };
}

// --- Rad zeichnen ---
function drawWheel(){
  const ctx=wheelCanvas.getContext('2d'); const len=categories.length;
  ctx.clearRect(0,0,400,400);
  const angle = 2*Math.PI/len;
  for(let i=0;i<len;i++){
    ctx.beginPath(); ctx.moveTo(200,200); ctx.arc(200,200,200,i*angle,(i+1)*angle);
    ctx.fillStyle=colors[i%colors.length]; ctx.fill(); ctx.stroke();
    ctx.save(); ctx.translate(200,200); ctx.rotate((i+0.5)*angle);
    ctx.textAlign='right'; ctx.fillStyle='black'; ctx.font='bold 16px Arial'; ctx.fillText(categories[i],180,0); ctx.restore();
  }
}

// Spin Animation
function spinWheel(){
  const idx=Math.floor(Math.random()*categories.length);
  selectedCategoryIndex=idx;
  const rotations = 5 + Math.random()*3; // 5-8 Umdrehungen
  const angle = idx*2*Math.PI/categories.length + Math.random()*0.2 + rotations*2*Math.PI;
  wheelCanvas.style.transition='transform 5s cubic-bezier(0.33, 1, 0.68, 1)';
  wheelCanvas.style.transform=`rotate(${angle}rad)`;
  currentRotation=angle%(2*Math.PI);
  hasSpun=true;
  return categories[idx];
}

// Pulsation
function pulseWheel(){
  return new Promise(resolve=>{
    wheelCanvas.classList.add('pulse-yellow');
    setTimeout(()=>{
      wheelCanvas.classList.remove('pulse-yellow');
      wheelCanvas.classList.add('pulse-red');
      setTimeout(()=>{
        wheelCanvas.classList.remove('pulse-red');
        resolve();
      },5000);
    },15000);
  });
}

async function handleNextSong(){
  if(!cachedPlaylistTracks.length){ if(window.M) M.toast({html:'Keine Songs mehr.',classes:'rounded'}); return; }
  await stopPlayback();
  document.getElementById('now-playing').style.display='block';
  document.getElementById('now-playing-text').textContent='Song läuft …';
  const item=getRandomTrack(cachedPlaylistTracks); if(!item||!item.track) return;
  selectedTrackUri=item.track.uri;
  await playTrack(selectedTrackUri);
  updateTrackDetailsElement(item.track);
  cachedPlaylistTracks=cachedPlaylistTracks.filter(x=>x.track&&x.track.uri!==selectedTrackUri);
  hasSpun=false; hasPulsed=false;
}

function resetAfterSong(){
  wheelCanvas.style.transition='none'; wheelCanvas.style.transform='rotate(0rad)';
  document.getElementById('now-playing').style.display='none';
  handleNextSong();
}

// --- Init ---
document.addEventListener('DOMContentLoaded', async()=>{
  const token=localStorage.getItem('access_token'); if(!token){ window.location.href='index.html'; return; }
  const loadingText=document.getElementById('loading-text');
  const startBtn=document.getElementById('start-btn');
  const wheelContainer=document.getElementById('wheel-container');
  wheelCanvas=document.getElementById('wheel-canvas');

  const playlistUrl = localStorage.getItem('bingoPlaylistUrl')||localStorage.getItem('mobilePlaylistUrl')||'';
  const playlistId = extractPlaylistId(playlistUrl);
  if(!playlistId){ if(window.M) M.toast({html:'Keine gültige Playlist',classes:'rounded'}); return; }

  loadingText.style.display='block';
  cachedPlaylistTracks = await fetchPlaylistTracks(playlistId);
  loadingText.style.display='none';
  if(!cachedPlaylistTracks.length){ document.getElementById('empty-warning').style.display='block'; return; }

  // Kategorien laden
  categories = localStorage.getItem('bingoCategories') ? JSON.parse(localStorage.getItem('bingoCategories')) : [];
  const discokugelActive = categories.length>0;

  if(discokugelActive){
    startBtn.addEventListener('click', async()=>{
      startBtn.style.display='none';
      wheelContainer.style.display='block';
      drawWheel();
      handleNextSong();

      wheelCanvas.addEventListener('click', async()=>{
        if(!hasSpun){ spinWheel(); return; }
        if(!hasPulsed){ await pulseWheel(); await stopPlayback(); hasPulsed=true; }
      });
    });
  }else{
    startBtn.addEventListener('click', async()=>{
      startBtn.style.display='none';
      handleNextSong();
    });
  }
});

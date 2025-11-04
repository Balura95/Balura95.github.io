/* bingo-start.js */
let cachedPlaylistTracks = [];
let selectedTrackUri = null;
let spotifyReady = null;

let wheelCanvas, wheelCtx;
let categories = [];
let hasSpun = false;
let hasPulsed = false;
let selectedCategoryIndex = null;
let currentRotation = 0;

// Farben für Segmente (abwechslungsreich)
const colors = ['#FFB347','#FF6961','#77DD77','#84B6F4','#F49AC2','#FFD700','#FF7F50','#87CEEB','#C19A6B','#9FE2BF'];

spotifyReady = new Promise(resolve => {
  window.onSpotifyWebPlaybackSDKReady = () => {
    const token = localStorage.getItem('access_token');
    if (!token) { resolve(); return; }
    const player = new Spotify.Player({
      name: 'Julster Bingo Player',
      getOAuthToken: cb => cb(token)
    });
    player.addListener('ready', ({ device_id }) => {
      window.deviceId = device_id;
      window.bingoPlayer = player;
      resolve();
    });
    ['initialization_error','authentication_error','account_error','playback_error'].forEach(e => player.addListener(e, ()=> resolve()));
    player.connect().catch(()=> resolve());
  };
});

/* ---------- Spotify / Playlist Funktionen ---------- */
function extractPlaylistId(url){
  if(!url) return null;
  const m = url.match(/spotify:playlist:([A-Za-z0-9-_]+)/) || url.match(/playlist\/([A-Za-z0-9-_]+)/) || url.match(/[?&]id=([A-Za-z0-9-_]+)/);
  return m ? m[1] : null;
}

async function fetchPlaylistTracks(playlistId){
  const token = localStorage.getItem('access_token');
  if(!token) return [];
  const all = [];
  const limit = 50;
  let offset = 0;
  try {
    const metaResp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!metaResp.ok) { console.error('Meta error', await metaResp.text()); return []; }
    const meta = await metaResp.json();
    const total = meta.tracks?.total || 0;
    while(offset < total){
      const resp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (!resp.ok) { console.error('Tracks fetch error', await resp.text()); break; }
      const data = await resp.json();
      const valid = (data.items || []).filter(i => i && i.track && i.track.uri && !i.is_local);
      all.push(...valid);
      offset += limit;
      if(!data.items || data.items.length === 0) break;
    }
  } catch (err) {
    console.error('fetchPlaylistTracks error', err);
  }
  return all;
}

async function playTrack(uri){
  const token = localStorage.getItem('access_token');
  if(!token) return false;
  await spotifyReady;
  // warte kurz auf deviceId (SDK)
  let waitTime = 0;
  while(!window.deviceId && waitTime < 6000){
    await new Promise(r => setTimeout(r, 200));
    waitTime += 200;
  }
  try {
    const deviceParam = window.deviceId ? `?device_id=${window.deviceId}` : '';
    const response = await fetch(`https://api.spotify.com/v1/me/player/play${deviceParam}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [ uri ] })
    });
    return response.status === 204;
  } catch (err) {
    console.error('playTrack error', err);
    return false;
  }
}

async function stopPlayback(){
  const token = localStorage.getItem('access_token'); if(!token) return;
  try {
    await fetch('https://api.spotify.com/v1/me/player/pause', { method: 'PUT', headers: { 'Authorization': `Bearer ${token}` } });
  } catch (err) {
    console.warn('stopPlayback error', err);
  }
}

function getRandomTrack(tracks){
  if(!tracks || tracks.length === 0) return null;
  return tracks[Math.floor(Math.random() * tracks.length)];
}

/* ---------- Track-Info Box ---------- */
function updateTrackDetailsElement(track){
  const details = document.getElementById('track-details');
  if(!details) return;
  let expanded = false;
  details.textContent = 'Songinfos auflösen';
  details.onclick = () => {
    if(!expanded){
      details.innerHTML = `
        <div>
          <p><strong>Titel:</strong> ${track.name}</p>
          <p><strong>Interpret:</strong> ${track.artists.map(a => a.name).join(', ')}</p>
          <p><strong>Album:</strong> ${track.album.name || ''}</p>
          <p><strong>Jahr:</strong> ${track.album.release_date ? track.album.release_date.substring(0,4) : ''}</p>
        </div>
      `;
      const weiterBtn = document.createElement('button');
      weiterBtn.className = 'btn details-weiter-btn green';
      weiterBtn.textContent = 'Weiter';
      details.appendChild(weiterBtn);
      weiterBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        resetAfterSong();
      });
      expanded = true;
    } else {
      details.textContent = 'Songinfos auflösen';
      expanded = false;
    }
  };
}

/* ---------- Wheel (Canvas) ---------- */
function drawWheel(){
  if(!wheelCanvas) return;
  wheelCtx = wheelCanvas.getContext('2d');
  const len = categories.length;
  const angle = 2 * Math.PI / len;
  // Clear and draw white circular background (transparent canvas) — circle with shadow via container
  wheelCtx.clearRect(0,0,400,400);

  for(let i = 0; i < len; i++){
    const start = i * angle;
    const end = (i+1) * angle;
    wheelCtx.beginPath();
    wheelCtx.moveTo(200,200);
    wheelCtx.arc(200,200,200,start,end);
    wheelCtx.closePath();
    wheelCtx.fillStyle = colors[i % colors.length];
    wheelCtx.fill();
    // thin border
    wheelCtx.strokeStyle = 'rgba(255,255,255,0.12)';
    wheelCtx.lineWidth = 1;
    wheelCtx.stroke();

    // text
    wheelCtx.save();
    wheelCtx.translate(200,200);
    wheelCtx.rotate(start + angle/2);
    wheelCtx.textAlign = 'right';
    wheelCtx.fillStyle = '#222';
    wheelCtx.font = 'bold 16px Arial';
    // wrap text if longer
    const text = categories[i];
    const metrics = wheelCtx.measureText(text);
    // draw text with limit
    wheelCtx.fillText(text, 180, 0);
    wheelCtx.restore();
  }
}

// spinWheel returns a Promise that resolves when rotation transition ends
function spinWheel(){
  return new Promise(resolve => {
    // choose index
    const idx = Math.floor(Math.random() * categories.length);
    selectedCategoryIndex = idx;

    // rotations (randomized for nicer effect)
    const rotations = 5 + Math.random() * 4; // 5-9 rotations
    // compute final angle so that pointer (top) lands on selected segment
    // canvas rotation is clockwise positive in CSS rotate (radians). We want the segment center to align with pointer at top (angle -Math.PI/2).
    const segmentAngle = 2 * Math.PI / categories.length;
    // target angle (so that the chosen segment center aligns to pointer at top)
    const targetSegmentCenter = idx * segmentAngle + segmentAngle/2;
    // Since CSS rotate rotates canvas, to bring that segment center to top (which is -Math.PI/2), we rotate by (rotations*2π + ( -π/2 - targetSegmentCenter) )
    const finalAngle = rotations * 2 * Math.PI + (-Math.PI/2 - targetSegmentCenter) + (Math.random() * 0.2 - 0.1); // small random offset

    // set transitions & transform
    wheelCanvas.style.transition = 'transform 5s cubic-bezier(0.33, 1, 0.68, 1)';
    wheelCanvas.style.transform = `rotate(${finalAngle}rad)`;

    // one-time transitionend listener (only for transform)
    const onEnd = (e) => {
      if (e.propertyName !== 'transform') return;
      wheelCanvas.removeEventListener('transitionend', onEnd);
      // normalize currentRotation
      currentRotation = finalAngle % (2 * Math.PI);
      hasSpun = true;
      resolve(idx);
    };
    wheelCanvas.addEventListener('transitionend', onEnd);
  });
}

/* Pulsation: gelb 15s -> rot 5s -> Buzzersound -> Stop */
function pulseWheel(){
  return new Promise(resolve => {
    const wheelContainer = document.getElementById('wheel-container');
    const buzzer = document.getElementById('buzzer-sound');
    wheelContainer.classList.add('pulse-yellow');
    setTimeout(() => {
      wheelContainer.classList.remove('pulse-yellow');
      wheelContainer.classList.add('pulse-red');
      setTimeout(() => {
        wheelContainer.classList.remove('pulse-red');
        buzzer.currentTime = 0;
        buzzer.play().catch(()=>{}); // spielt Signalton ab
        resolve();
      }, 5000);
    }, 15000);
  });
}


/* Start song AFTER wheel finished spinning and show selected category text */
async function startSongAfterSpin(){
  // show selected category text
  const selectedCategoryEl = document.getElementById('selected-category');
  const catText = categories[selectedCategoryIndex] || '';
  selectedCategoryEl.textContent = `Kategorie: ${catText}`;
  selectedCategoryEl.style.display = 'block';

  // play a random track (only after spin finished)
  if(!cachedPlaylistTracks || cachedPlaylistTracks.length === 0){
    if(window.M) M.toast({ html: 'Keine Songs verfügbar.', classes: 'rounded' });
    return;
  }
  // choose and play
  const item = getRandomTrack(cachedPlaylistTracks);
  if(!item || !item.track){
    if(window.M) M.toast({ html: 'Fehler beim Abrufen des Songs', classes: 'rounded' });
    return;
  }
  selectedTrackUri = item.track.uri;
  const ok = await playTrack(selectedTrackUri);
  if(!ok && window.M) M.toast({ html: 'Fehler beim Abspielen des Songs', classes: 'rounded' });

  // show track details box
  updateTrackDetailsElement(item.track);
  document.getElementById('now-playing').style.display = 'block';

  // remove played from cache so it won't be reused
  cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track && x.track.uri !== selectedTrackUri);
  // make sure hasPulsed false so pulse is available later
  hasPulsed = false;
}

/* Reset after user presses Weiter in details */
function resetAfterSong(){
  // reset wheel visual to 0 rotation (no transition to avoid spinning visual)
  wheelCanvas.style.transition = 'none';
  wheelCanvas.style.transform = 'rotate(0rad)';
  // hide category & track info
  document.getElementById('selected-category').style.display = 'none';
  document.getElementById('now-playing').style.display = 'none';
  // reset flags so next song can be spun
  hasSpun = false;
  hasPulsed = false;
  selectedCategoryIndex = null;
  selectedTrackUri = null;
}

/* ---------- Init / Event wiring ---------- */
document.addEventListener('DOMContentLoaded', async()=>{
  const token=localStorage.getItem('access_token'); 
  if(!token){ window.location.href='index.html'; return; }
  const loadingText=document.getElementById('loading-text');
  const startBtn=document.getElementById('start-btn');
  const wheelContainer=document.getElementById('wheel-container');
  const selectedCategoryDiv=document.getElementById('selected-category');
  const wheelCanvas=document.getElementById('wheel-canvas');
  wheelCtx=wheelCanvas.getContext('2d');

  const playlistUrl = localStorage.getItem('bingoPlaylistUrl')||localStorage.getItem('mobilePlaylistUrl')||'';
  const playlistId = extractPlaylistId(playlistUrl);
  if(!playlistId){ if(window.M) M.toast({html:'Keine gültige Playlist',classes:'rounded'}); return; }

  loadingText.style.display='block';
  cachedPlaylistTracks = await fetchPlaylistTracks(playlistId);
  loadingText.style.display='none';

  if(!cachedPlaylistTracks.length){ document.getElementById('empty-warning').style.display='block'; return; }
  startBtn.style.display='inline-block'; // jetzt sichtbar

  categories = localStorage.getItem('bingoCategories') ? JSON.parse(localStorage.getItem('bingoCategories')) : [];
  const discokugelActive = categories.length>0;

  if(discokugelActive){
    startBtn.addEventListener('click', ()=>{
      startBtn.style.display='none';
      wheelContainer.style.display='block';
      drawWheel();

      wheelCanvas.addEventListener('click', async()=>{
        if(!hasSpun){
          const category = spinWheel();
          selectedCategoryDiv.textContent = '';
          setTimeout(async ()=>{
            selectedCategoryDiv.textContent = "Kategorie: " + category;
            const track = getRandomTrack(cachedPlaylistTracks);
            if(!track || !track.track) return;
            selectedTrackUri = track.track.uri;
            await playTrack(selectedTrackUri);
            updateTrackDetailsElement(track.track);
            document.getElementById('now-playing').style.display='block';
            cachedPlaylistTracks = cachedPlaylistTracks.filter(x=>x.track && x.track.uri !== selectedTrackUri);
            hasSpun = true;
            hasPulsed = false;
          }, 5000); // Song startet nach Ende der Drehung
          return;
        }

        if(!hasPulsed){
          await pulseWheel();
          await stopPlayback();
          hasPulsed = true;
        }
      });
    });
  } else {
    startBtn.addEventListener('click', async()=>{
      startBtn.style.display='none';
      handleNextSong();
      document.getElementById('now-playing').style.display='block';
    });
  }
});

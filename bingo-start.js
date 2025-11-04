let cachedPlaylistTracks = [];
let selectedTrackUri = null;
let spotifyReady = null;
let isSpinning = false;
let spinAngle = 0;
let currentCategory = null;
let pulseTimeouts = [];
const buzzer = new Audio('https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg');

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

async function fetchPlaylistTracks(playlistId) {
  const token = localStorage.getItem('access_token');
  if (!token) return [];
  const all = [];
  const limit = 50;
  let offset = 0;
  try {
    const metaResp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!metaResp.ok) return [];
    const meta = await metaResp.json();
    const total = meta.tracks?.total || 0;
    while (offset < total) {
      const resp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await resp.json();
      const valid = (data.items || []).filter(i => i && i.track && i.track.uri && !i.is_local);
      all.push(...valid);
      offset += limit;
      if (!data.items || data.items.length === 0) break;
    }
    return all;
  } catch { return []; }
}

// Spotify SDK Setup
spotifyReady = new Promise((resolve) => {
  window.onSpotifyWebPlaybackSDKReady = () => {
    const token = localStorage.getItem('access_token');
    if (!token) return resolve();
    const player = new Spotify.Player({
      name: 'Julster Bingo Player',
      getOAuthToken: cb => cb(token)
    });
    player.addListener('ready', ({ device_id }) => {
      window.deviceId = device_id;
      window.bingoPlayer = player;
      resolve();
    });
    player.connect().catch(() => resolve());
  };
});

async function playTrack(uri) {
  const token = localStorage.getItem('access_token');
  if (!token) return false;
  await spotifyReady;
  let waitTime = 0;
  while (!window.deviceId && waitTime < 6000) {
    await new Promise(r => setTimeout(r, 200));
    waitTime += 200;
  }
  try {
    const deviceParam = window.deviceId ? `?device_id=${window.deviceId}` : '';
    const resp = await fetch(`https://api.spotify.com/v1/me/player/play${deviceParam}`, {
      method:'PUT',
      headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({uris:[uri]})
    });
    return resp.status === 204;
  } catch { return false; }
}

async function stopPlayback() {
  const token = localStorage.getItem('access_token');
  if (!token) return;
  try {
    await fetch('https://api.spotify.com/v1/me/player/pause', {
      method:'PUT', headers:{'Authorization':`Bearer ${token}`}
    });
  } catch {}
}

function getRandomTrack(tracks) {
  if (!tracks || !tracks.length) return null;
  const idx = Math.floor(Math.random() * tracks.length);
  return tracks[idx];
}

function updateTrackDetailsElement(track) {
  const details = document.getElementById('track-details');
  if (!details) return;
  let expanded = false;
  details.textContent = 'Songinfos auflösen';
  details.onclick = () => {
    if (!expanded) {
      details.innerHTML = `
        <div>
          <p><strong>Titel:</strong> ${track.name}</p>
          <p><strong>Interpret:</strong> ${track.artists.map(a => a.name).join(', ')}</p>
          <p><strong>Album:</strong> ${track.album.name}</p>
          <p><strong>Jahr:</strong> ${track.album.release_date?.substring(0,4) || ''}</p>
        </div>
      `;
      const weiterBtn = document.createElement('button');
      weiterBtn.className = 'btn details-weiter-btn green';
      weiterBtn.textContent = 'Nächster Song';
      details.appendChild(weiterBtn);
      weiterBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        await stopPlayback();
        clearPulse();
        resetForNextSpin();
      });
      expanded = true;
    } else {
      details.textContent = 'Songinfos auflösen';
      expanded = false;
    }
  };
}

function clearPulse() {
  const wheel = document.getElementById('wheel');
  wheel.classList.remove('pulse-yellow', 'pulse-red');
  pulseTimeouts.forEach(clearTimeout);
  pulseTimeouts = [];
}

function resetForNextSpin() {
  const details = document.getElementById('track-details');
  details.textContent = 'Songinfos auflösen';
  document.getElementById('now-playing-text').textContent = 'Song läuft …';
  const wheel = document.getElementById('wheel');
  wheel.style.transform = 'rotate(0deg)';
  spinAngle = 0;
  isSpinning = false;
  currentCategory = null;
  document.getElementById('selected-category').textContent = '';
}

async function handleNextSong() {
  if (!cachedPlaylistTracks.length) {
    if (window.M) M.toast({ html:'Keine weiteren Songs verfügbar.', classes:'rounded' });
    return;
  }
  await stopPlayback();
  const item = getRandomTrack(cachedPlaylistTracks);
  if (!item?.track) return;
  selectedTrackUri = item.track.uri;
  const ok = await playTrack(selectedTrackUri);
  if (!ok && window.M) M.toast({ html:'Fehler beim Abspielen.', classes:'rounded' });
  updateTrackDetailsElement(item.track);
  cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track?.uri !== selectedTrackUri);
}

function drawWheel(categories) {
  const canvas = document.getElementById('wheel');
  const ctx = canvas.getContext('2d');
  const size = Math.min(canvas.width, canvas.height);
  const radius = size/2;
  const segmentAngle = (2*Math.PI)/categories.length;
  const colors = ['#ff9999','#99ccff','#ffcc99','#ccffcc','#ffb3e6','#c2c2f0','#ffd699','#a3e4d7'];
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.translate(radius, radius);
  for (let i=0;i<categories.length;i++) {
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.fillStyle = colors[i%colors.length];
    ctx.arc(0,0,radius,i*segmentAngle,(i+1)*segmentAngle);
    ctx.fill();
    ctx.save();
    ctx.rotate(i*segmentAngle + segmentAngle/2);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#333';
    ctx.font = 'bold 16px Roboto';
    ctx.fillText(categories[i], radius - 10, 6);
    ctx.restore();
  }
  ctx.translate(-radius, -radius);
}

async function spinWheel(categories) {
  if (isSpinning) return;
  isSpinning = true;
  const wheel = document.getElementById('wheel');
  const selectedText = document.getElementById('selected-category');
  const randomIndex = Math.floor(Math.random() * categories.length);
  const segmentAngle = 360 / categories.length;
  const randomExtra = 360 * 5 + (randomIndex * segmentAngle) + segmentAngle/2;
  spinAngle += randomExtra;
  wheel.style.transform = `rotate(${spinAngle}deg)`;
  await new Promise(r => setTimeout(r, 4200));
  currentCategory = categories[randomIndex];
  selectedText.textContent = `Kategorie: ${currentCategory}`;
  await handleNextSong();
}

function startPulseSequence() {
  const wheel = document.getElementById('wheel');
  clearPulse();
  wheel.classList.add('pulse-yellow');
  const t1 = setTimeout(() => {
    wheel.classList.remove('pulse-yellow');
    wheel.classList.add('pulse-red');
  }, 15000);
  const t2 = setTimeout(() => {
    wheel.classList.remove('pulse-red');
    buzzer.play();
    stopPlayback();
  }, 20000);
  pulseTimeouts.push(t1,t2);
}

document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('access_token');
  if (!token) return window.location.href = 'index.html';

  const loadingText = document.getElementById('loading-text');
  const startBtn = document.getElementById('start-btn');
  const wheelContainer = document.getElementById('wheel-container');
  const nowPlaying = document.getElementById('now-playing');
  const categories = JSON.parse(localStorage.getItem('bingoCategories') || '[]');

  const playlistUrl = localStorage.getItem('bingoPlaylistUrl') || localStorage.getItem('mobilePlaylistUrl') || '';
  const playlistId = extractPlaylistId(playlistUrl);
  if (!playlistId) return;

  loadingText.style.display = 'block';
  try {
    cachedPlaylistTracks = await fetchPlaylistTracks(playlistId);
  } catch { cachedPlaylistTracks = []; }
  loadingText.style.display = 'none';

  if (!cachedPlaylistTracks.length) {
    document.getElementById('empty-warning').style.display = 'block';
    return;
  }

  startBtn.style.display = 'inline-block';
  startBtn.classList.add('pulse');
  startBtn.addEventListener('click', async () => {
    startBtn.style.display = 'none';
    nowPlaying.style.display = 'block';

    if (localStorage.getItem('bingoCategories') && categories.length > 0) {
      wheelContainer.style.display = 'block';
      const canvas = document.getElementById('wheel');
      canvas.width = canvas.offsetWidth * 2;
      canvas.height = canvas.offsetHeight * 2;
      drawWheel(categories);

      canvas.addEventListener('click', async () => {
        if (!isSpinning && !currentCategory) {
          await spinWheel(categories);
        } else if (currentCategory && !isSpinning) {
          startPulseSequence();
        }
      });
    } else {
      await handleNextSong();
    }
  });
});

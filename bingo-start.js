// bingo-start.js
// Implementiert die von dir geforderte, korrekte und robuste Logik.

// --- State ---
let cachedPlaylistTracks = [];
let bingoCategories = [];
let currentPreparedItem = null;
let selectedTrackUri = null;
let isSpinning = false;
let hasSpunThisSong = false; // ob das Rad für den aktuellen Song bereits gedreht wurde
let isPlaying = false;
let isPulsing = false;
let pulseTimers = [];
let spotifyReady = null;

// --- Spotify SDK readiness (optional) ---
spotifyReady = new Promise((resolve) => {
  window.onSpotifyWebPlaybackSDKReady = () => {
    const token = localStorage.getItem('access_token');
    if (!token) { resolve(); return; }
    const player = new Spotify.Player({ name: 'Julster Bingo Player', getOAuthToken: cb => cb(token) });
    player.addListener('ready', ({ device_id }) => { window.deviceId = device_id; window.bingoPlayer = player; resolve(); });
    player.addListener('initialization_error', ({ message }) => { console.error(message); resolve(); });
    player.addListener('authentication_error', ({ message }) => { console.error(message); resolve(); });
    player.connect().catch(e => { console.warn('SDK connect failed', e); resolve(); });
  };
});

// --- Helpers ---
function extractPlaylistId(url) {
  if (!url) return null;
  const m1 = url.match(/spotify:playlist:([A-Za-z0-9-_]+)/);
  if (m1) return m1[1];
  const m2 = url.match(/playlist\/([A-Za-z0-9-_]+)/);
  if (m2) return m2[1];
  const m3 = url.match(/[?&]id=([A-Za-z0-9-_]+)/);
  if (m3) return m3[1];
  return null;
}

async function fetchPlaylistTracks(playlistId) {
  const token = localStorage.getItem('access_token');
  if (!token) return [];
  try {
    const metaResp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!metaResp.ok) return [];
    const meta = await metaResp.json();
    const total = meta.tracks?.total || 0;
    const limit = 50;
    let offset = 0;
    let all = [];
    while (offset < total) {
      const resp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!resp.ok) break;
      const data = await resp.json();
      const valid = (data.items || []).filter(i => i && i.track && i.track.uri && !i.is_local);
      all.push(...valid);
      offset += limit;
      if (!data.items || data.items.length === 0) break;
    }
    return all;
  } catch (err) {
    console.error('fetchPlaylistTracks error', err);
    return [];
  }
}

async function playTrack(uri) {
  const token = localStorage.getItem('access_token');
  if (!token) return false;
  await spotifyReady;
  let waited = 0;
  while (!window.deviceId && waited < 4000) { await new Promise(r => setTimeout(r, 200)); waited += 200; }
  try {
    const deviceParam = window.deviceId ? `?device_id=${window.deviceId}` : '';
    const resp = await fetch(`https://api.spotify.com/v1/me/player/play${deviceParam}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [uri] })
    });
    if (resp.status === 204) {
      isPlaying = true;
      return true;
    } else {
      console.warn('playTrack response status:', resp.status);
      return false;
    }
  } catch (err) {
    console.error('playTrack error', err);
    return false;
  }
}

async function pauseTrack() {
  const token = localStorage.getItem('access_token');
  if (!token) return;
  try {
    await fetch('https://api.spotify.com/v1/me/player/pause', { method: 'PUT', headers: { 'Authorization': `Bearer ${token}` } });
  } catch (e) { console.warn('pause error', e); }
  isPlaying = false;
}

// --- Wheel building & labels centered ---
function buildWheel(categories) {
  const wheel = document.getElementById('wheel');
  wheel.innerHTML = '';
  if (!categories || categories.length === 0) {
    document.getElementById('wheel-section').style.display = 'none';
    return;
  }
  document.getElementById('wheel-section').style.display = 'block';
  const n = categories.length;
  const slice = 360 / n;
  const stops = [];
  for (let i = 0; i < n; i++) {
    const hue = Math.round((i * (360 / n)) % 360);
    const color = `hsl(${hue} 70% 55%)`;
    stops.push(`${color} ${i * slice}deg ${(i + 1) * slice}deg`);
  }
  wheel.style.background = `conic-gradient(${stops.join(',')})`;

  // labels centered in their segment
  for (let i = 0; i < n; i++) {
    const angleCenter = i * slice + slice / 2;
    const lbl = document.createElement('div');
    lbl.className = 'wheel-label';
    // rotate to center of segment, move outward, rotate back so text is upright
    lbl.style.transform = `rotate(${angleCenter}deg) translateY(-42%) rotate(${-angleCenter}deg)`;
    lbl.textContent = categories[i];
    wheel.appendChild(lbl);
  }

  // reset rotation to zero
  wheel.style.transition = 'none';
  wheel.style.transform = 'rotate(0deg)';
  setTimeout(() => { wheel.style.transition = 'transform 3s cubic-bezier(.25,.9,.1,1)'; }, 30);
}

function resetWheelVisual() {
  const wheel = document.getElementById('wheel');
  wheel.style.transition = 'none';
  wheel.style.transform = 'rotate(0deg)';
  // clear pulses
  wheel.classList.remove('pulse-yellow','pulse-red');
  // restore transition
  setTimeout(() => { wheel.style.transition = 'transform 3s cubic-bezier(.25,.9,.1,1)'; }, 30);
}

// spin the wheel once and return chosen {index,category}
async function spinWheelAndPick(categories) {
  if (isSpinning) return null;
  isSpinning = true;
  const n = categories.length;
  const slice = 360 / n;
  const idx = Math.floor(Math.random() * n);
  // random jitter so result not fixed
  const jitter = (Math.random() * (slice - 8)) - ((slice / 2) - 4);
  const centerAngle = idx * slice + slice / 2 + jitter;
  const fullRounds = 4 + Math.floor(Math.random() * 2);
  const finalRotation = fullRounds * 360 + (360 - centerAngle);

  const wheel = document.getElementById('wheel');
  wheel.style.transition = 'transform 3s cubic-bezier(.25,.9,.1,1)';
  wheel.style.transform = `rotate(${finalRotation}deg)`;

  await new Promise((resolve) => {
    const onEnd = () => { wheel.removeEventListener('transitionend', onEnd); resolve(); };
    wheel.addEventListener('transitionend', onEnd);
    setTimeout(resolve, 3500); // safety
  });

  // normalize
  const normalized = finalRotation % 360;
  wheel.style.transition = 'none';
  wheel.style.transform = `rotate(${normalized}deg)`;
  setTimeout(() => { wheel.style.transition = 'transform 3s cubic-bezier(.25,.9,.1,1)'; }, 30);

  isSpinning = false;
  return { index: idx, category: categories[idx] };
}

// --- Track details UI ---
function setupTrackDetails(track) {
  const td = document.getElementById('track-details');
  td.style.display = 'none'; // ensure hidden until song started
  td.innerHTML = 'Songinfos auflösen';
  let expanded = false;
  td.onclick = () => {
    if (!expanded) {
      td.innerHTML = `
        <div>
          <p><strong>Titel:</strong> ${escapeHtml(track.name)}</p>
          <p><strong>Interpret:</strong> ${escapeHtml(track.artists.map(a => a.name).join(', '))}</p>
          <p><strong>Album:</strong> ${escapeHtml(track.album?.name || '')}</p>
        </div>
      `;
      const btn = document.createElement('button');
      btn.className = 'btn details-weiter-btn green';
      btn.textContent = 'Weiter';
      td.appendChild(btn);
      btn.onclick = async (ev) => {
        ev.stopPropagation();
        // user moves to next song: stop pulse, stop playback, reset visual, hide details, prepare next
        clearPulseTimers();
        await pauseTrack();
        isPlaying = false;
        hasSpunThisSong = false;
        resetWheelVisual();
        td.style.display = 'none';
        await prepareNextTrack();
      };
      expanded = true;
    } else {
      td.innerHTML = 'Songinfos auflösen';
      expanded = false;
    }
  };
}

// --- Pulse logic while playing ---
function clearPulseTimers() {
  pulseTimers.forEach(t => clearTimeout(t));
  pulseTimers = [];
  const wheel = document.getElementById('wheel');
  wheel.classList.remove('pulse-yellow','pulse-red');
  isPulsing = false;
}

function startPulseDuringPlayback() {
  if (!isPlaying || isPulsing) return;
  isPulsing = true;
  const wheel = document.getElementById('wheel');
  wheel.classList.remove('pulse-red'); wheel.classList.add('pulse-yellow');

  // after 15s switch to red
  const t1 = setTimeout(() => {
    wheel.classList.remove('pulse-yellow'); wheel.classList.add('pulse-red');
  }, 15000);

  // after 20s stop playback and clear
  const t2 = setTimeout(async () => {
    wheel.classList.remove('pulse-red');
    await pauseTrack();
    isPlaying = false;
    isPulsing = false;
    M.toast({ html: 'Song gestoppt (Discozeit abgelaufen).', classes: 'rounded' });
  }, 20000);

  pulseTimers.push(t1, t2);
}

// --- prepare next track (chosen randomly) but do NOT play if categories exist ---
async function prepareNextTrack() {
  if (!cachedPlaylistTracks || cachedPlaylistTracks.length === 0) {
    M.toast({ html: 'Keine weiteren Songs verfügbar.', classes: 'rounded' });
    return;
  }
  // choose random item
  const idx = Math.floor(Math.random() * cachedPlaylistTracks.length);
  const item = cachedPlaylistTracks[idx];
  currentPreparedItem = item;
  selectedTrackUri = item.track.uri;

  // hide track details until playback started
  document.getElementById('track-details').style.display = 'none';
  document.getElementById('track-details').innerHTML = 'Songinfos auflösen';

  if (bingoCategories && bingoCategories.length > 0) {
    // show wheel and prompt to spin (do not auto-play)
    buildWheel(bingoCategories);
    document.getElementById('wheel-section').style.display = 'block';
    document.getElementById('now-playing').style.display = 'block';
    document.getElementById('now-playing-text').textContent = 'Kategorie wählen';
    hasSpunThisSong = false;
  } else {
    // No categories: play immediately and show details
    document.getElementById('wheel-section').style.display = 'none';
    document.getElementById('now-playing').style.display = 'block';
    document.getElementById('now-playing-text').textContent = 'Song läuft …';
    const ok = await playTrack(selectedTrackUri);
    if (ok) {
      document.getElementById('track-details').style.display = 'block';
      setupTrackDetails(item.track);
      // remove from cache to avoid repeats
      cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track && x.track.uri !== selectedTrackUri);
    } else {
      M.toast({ html: 'Fehler beim Abspielen (Bitte aktives Spotify-Device öffnen).', classes: 'rounded' });
    }
  }
}

// --- Wheel click handler (spin OR pulse) ---
async function handleWheelClick() {
  // if currently spinning, ignore
  if (isSpinning) return;

  // if song is NOT playing and not spun yet -> allow spin
  if (!isPlaying && currentPreparedItem && !hasSpunThisSong) {
    // spin
    const res = await spinWheelAndPick(bingoCategories);
    if (!res) return;
    // show category briefly
    document.getElementById('now-playing-text').textContent = `Kategorie: ${res.category}`;
    // start playing the prepared track
    const ok = await playTrack(selectedTrackUri);
    if (ok) {
      isPlaying = true;
      hasSpunThisSong = true;
      // show track-details
      document.getElementById('track-details').style.display = 'block';
      setupTrackDetails(currentPreparedItem.track);
      // remove played track from cache to avoid repeats
      cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track && x.track.uri !== selectedTrackUri);
      // update now-playing text after short delay
      setTimeout(()=>{ document.getElementById('now-playing-text').textContent = 'Song läuft …'; }, 300);
    } else {
      M.toast({ html: 'Fehler beim Starten des Songs (kein aktives Spotify-Device).', classes: 'rounded' });
    }
    return;
  }

  // if song is playing and wheel has been spun for this song -> start pulse
  if (isPlaying && hasSpunThisSong && !isPulsing) {
    startPulseDuringPlayback();
    return;
  }
  // otherwise ignore clicks (e.g. if no prepared item)
}

// --- Init & wiring ---
document.addEventListener('DOMContentLoaded', async () => {
  // token check
  const token = localStorage.getItem('access_token');
  if (!token) { window.location.href = 'index.html'; return; }

  // read categories (optional)
  try { bingoCategories = JSON.parse(localStorage.getItem('bingoCategories') || '[]'); } catch { bingoCategories = []; }

  // load playlist (show loading-text until done)
  const playlistUrl = localStorage.getItem('bingoPlaylistUrl') || localStorage.getItem('mobilePlaylistUrl') || '';
  const playlistId = extractPlaylistId(playlistUrl);
  if (!playlistId) {
    document.getElementById('loading-text').textContent = 'Keine gültige Playlist gefunden.';
    document.getElementById('empty-warning').style.display = 'block';
    return;
  }

  document.getElementById('loading-text').style.display = 'block';
  cachedPlaylistTracks = await fetchPlaylistTracks(playlistId);
  document.getElementById('loading-text').style.display = 'none';

  if (!cachedPlaylistTracks || cachedPlaylistTracks.length === 0) {
    document.getElementById('empty-warning').style.display = 'block';
    return;
  }

  // now show start button
  const startBtn = document.getElementById('start-btn');
  startBtn.style.display = 'inline-block';
  startBtn.classList.add('pulse');

  // Start: prepare the first track (does not auto-play if categories exist)
  startBtn.addEventListener('click', async () => {
    startBtn.style.display = 'none';
    await prepareNextTrack();
  });

  // wheel click wiring
  const wheel = document.getElementById('wheel');
  wheel.addEventListener('click', async () => {
    await handleWheelClick();
  });
});

// escape helper
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

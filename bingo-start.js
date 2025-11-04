// bingo-start.js (vollständig ersetzen)
// Sauber implementierte Version: Playlist laden, Wheel bauen mit unterschiedlichen Farben,
// Spin einmal pro Song -> Kategorie wählen -> Song starten -> Track-Details zeigen (Titel, Interpret, Album, Jahr, hinzugefügt von).
// Während Song läuft: Rad drücken -> 15s gelb pulsieren -> 5s rot pulsieren -> Song stoppt.
// Weiter-Button inside Track-Details resetet und bereitet nächsten Song vor.

let cachedPlaylistTracks = [];
let bingoCategories = [];
let currentPreparedItem = null;
let selectedTrackUri = null;
let isSpinning = false;
let hasSpunThisSong = false;
let isPlaying = false;
let isPulsing = false;
let pulseTimers = [];
let spotifyReady = null;

// Spotify SDK readiness (optional) - keep for playback/device
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

// Helpers
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
    // fetch meta to get total
    const metaResp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!metaResp.ok) { console.error('Playlist meta error', await metaResp.text()); return []; }
    const meta = await metaResp.json();
    const total = meta.tracks?.total || 0;
    while (offset < total) {
      const resp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!resp.ok) { console.error('Tracks fetch error', await resp.text()); break; }
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

async function fetchUserName(userId) {
  const token = localStorage.getItem('access_token');
  if (!token) return userId;
  try {
    const resp = await fetch(`https://api.spotify.com/v1/users/${userId}`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!resp.ok) return userId;
    const data = await resp.json();
    return (data.display_name && data.display_name.trim() !== "") ? data.display_name : data.id;
  } catch (err) {
    console.error('fetchUserName error', err);
    return userId;
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
      console.warn('playTrack status', resp.status);
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
  } catch (err) { console.warn('pause error', err); }
  isPlaying = false;
}

// Build wheel with distinct colors and centered labels
function buildWheel(categories) {
  const wheel = document.getElementById('wheel');
  const container = document.getElementById('wheel-section');
  wheel.innerHTML = '';
  if (!categories || categories.length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'block';
  const n = categories.length;
  const angle = 360 / n;
  const stops = [];
  for (let i = 0; i < n; i++) {
    const hue = Math.round((i * (360 / n)) % 360);
    const color = `hsl(${hue} 75% 48%)`;
    const start = i * angle;
    const end = (i + 1) * angle;
    stops.push(`${color} ${start}deg ${end}deg`);
  }
  wheel.style.background = `conic-gradient(${stops.join(',')})`;

  // add labels centrally
  for (let i = 0; i < n; i++) {
    const lbl = document.createElement('div');
    lbl.className = 'wheel-label';
    const rot = i * angle + angle / 2;
    lbl.style.transform = `rotate(${rot}deg) translateY(-42%) rotate(${-rot}deg)`;
    lbl.style.left = '50%';
    lbl.style.top = '50%';
    lbl.textContent = categories[i];
    wheel.appendChild(lbl);
  }

  wheel.style.transition = 'none';
  wheel.style.transform = 'rotate(0deg)';
  setTimeout(() => { wheel.style.transition = 'transform 3s cubic-bezier(.25,.9,.1,1)'; }, 30);
}

function resetWheelVisual() {
  const wheel = document.getElementById('wheel');
  wheel.style.transition = 'none';
  wheel.style.transform = 'rotate(0deg)';
  wheel.classList.remove('pulse-yellow','pulse-red');
  setTimeout(() => { wheel.style.transition = 'transform 3s cubic-bezier(.25,.9,.1,1)'; }, 30);
}

// Spin logic
async function spinWheelAndPick(categories) {
  if (isSpinning) return null;
  isSpinning = true;
  const n = categories.length;
  const angle = 360 / n;
  const targetIdx = Math.floor(Math.random() * n);
  const randomOffset = (Math.random() * (angle - 8)) + 4;
  const targetAngleFromTop = (targetIdx * angle) + angle / 2;
  const fullRounds = 4 + Math.floor(Math.random() * 2);
  const finalRotation = fullRounds * 360 + (360 - targetAngleFromTop) + (angle / 2 - randomOffset);

  const wheel = document.getElementById('wheel');
  wheel.style.transition = 'transform 3s cubic-bezier(.25,.9,.1,1)';
  wheel.style.transform = `rotate(${finalRotation}deg)`;

  await new Promise(resolve => {
    const onEnd = () => { wheel.removeEventListener('transitionend', onEnd); resolve(); };
    wheel.addEventListener('transitionend', onEnd);
    setTimeout(resolve, 3600);
  });

  const normalized = finalRotation % 360;
  wheel.style.transition = 'none';
  wheel.style.transform = `rotate(${normalized}deg)`;
  setTimeout(() => { wheel.style.transition = 'transform 3s cubic-bezier(.25,.9,.1,1)'; }, 30);

  isSpinning = false;
  return { index: targetIdx, category: categories[targetIdx] };
}

// Track details toggle (show full metadata)
function updateTrackDetails(track, addedBy) {
  const detailsContainer = document.getElementById('track-details');
  if (!detailsContainer) return;
  detailsContainer.innerHTML = 'Songinfos auflösen';
  detailsContainer.style.display = 'none'; // shown when playback start triggers
  let expanded = false;

  detailsContainer.onclick = async function() {
    if (!expanded) {
      let addedByName = "unbekannt";
      if (addedBy) {
        if (addedBy.display_name && addedBy.display_name.trim() !== "") {
          addedByName = addedBy.display_name;
        } else if (addedBy.id) {
          addedByName = await fetchUserName(addedBy.id);
        }
      }
      const title = track.name || 'Unbekannt';
      const artists = (track.artists || []).map(a => a.name).join(', ');
      const album = track.album?.name || '';
      const year = track.album?.release_date ? track.album.release_date.substring(0,4) : '';
      detailsContainer.innerHTML = `
        <p><strong>Titel:</strong> ${escapeHtml(title)}</p>
        <p><strong>Interpret:</strong> ${escapeHtml(artists)}</p>
        <p><strong>Album:</strong> ${escapeHtml(album)}</p>
        <p><strong>Jahr:</strong> ${escapeHtml(year)}</p>
        <p><strong>Hinzugefügt von:</strong> ${escapeHtml(addedByName)}</p>
      `;

      const weiter = document.createElement('button');
      weiter.className = 'btn details-weiter-btn green';
      weiter.textContent = 'Weiter';
      detailsContainer.appendChild(weiter);

      weiter.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        // Reset: stop pulse, stop playback, reset flags and wheel, hide details, prepare next
        clearPulseTimers();
        await pauseTrack();
        isPlaying = false;
        hasSpunThisSong = false;
        resetWheelVisual();
        detailsContainer.style.display = 'none';
        await prepareNextTrack();
      });

      expanded = true;
    } else {
      detailsContainer.innerHTML = 'Songinfos auflösen';
      expanded = false;
    }
  };
}

// Pulse logic (15s yellow, 5s red)
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
  wheel.classList.remove('pulse-red');
  wheel.classList.add('pulse-yellow');

  const t1 = setTimeout(() => {
    wheel.classList.remove('pulse-yellow');
    wheel.classList.add('pulse-red');
  }, 15000);

  const t2 = setTimeout(async () => {
    wheel.classList.remove('pulse-red');
    await pauseTrack();
    isPlaying = false;
    isPulsing = false;
    M.toast({ html: 'Song gestoppt (Discozeit abgelaufen).', classes: 'rounded' });
  }, 20000);

  pulseTimers.push(t1, t2);
}

// Prepare next track (choose random, do not auto-play if categories exist)
async function prepareNextTrack() {
  if (!cachedPlaylistTracks || cachedPlaylistTracks.length === 0) {
    M.toast({ html: 'Keine weiteren Songs verfügbar.', classes: 'rounded' });
    return;
  }
  const idx = Math.floor(Math.random() * cachedPlaylistTracks.length);
  const item = cachedPlaylistTracks[idx];
  currentPreparedItem = item;
  selectedTrackUri = item.track.uri;

  const td = document.getElementById('track-details');
  td.style.display = 'none';
  td.innerHTML = 'Songinfos auflösen';

  const wheelSection = document.getElementById('wheel-section');
  const nowPlaying = document.getElementById('now-playing');
  const nowText = document.getElementById('now-playing-text');

  if (bingoCategories && bingoCategories.length > 0) {
    buildWheel(bingoCategories);
    wheelSection.style.display = 'block';
    nowPlaying.style.display = 'block';
    nowText.textContent = 'Kategorie wählen';
    hasSpunThisSong = false;
  } else {
    wheelSection.style.display = 'none';
    nowPlaying.style.display = 'block';
    nowText.textContent = 'Song läuft …';
    const ok = await playTrack(selectedTrackUri);
    if (ok) {
      td.style.display = 'block';
      updateTrackDetails(item.track, item.added_by);
      cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track && x.track.uri !== selectedTrackUri);
    } else {
      M.toast({ html: 'Fehler beim Abspielen (kein aktives Device).', classes: 'rounded' });
    }
  }
}

// Wheel click handler
async function handleWheelClick() {
  if (isSpinning) return;

  const songIsPlaying = isPlaying === true;

  // If not playing and not spun -> spin & start
  if (!songIsPlaying && currentPreparedItem && !hasSpunThisSong && bingoCategories.length > 0) {
    const res = await spinWheelAndPick(bingoCategories);
    if (!res) return;
    document.getElementById('now-playing-text').textContent = `Kategorie: ${res.category}`;
    const ok = await playTrack(selectedTrackUri);
    if (ok) {
      isPlaying = true;
      hasSpunThisSong = true;
      const td = document.getElementById('track-details');
      td.style.display = 'block';
      updateTrackDetails(currentPreparedItem.track, currentPreparedItem.added_by);
      cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track && x.track.uri !== selectedTrackUri);
      setTimeout(()=>{ document.getElementById('now-playing-text').textContent = 'Song läuft …'; }, 300);
    } else {
      M.toast({ html: 'Fehler beim Abspielen (kein aktives Spotify-Device).', classes: 'rounded' });
    }
    return;
  }

  // If playing and already spun -> pulse
  if (songIsPlaying && hasSpunThisSong && !isPulsing) {
    startPulseDuringPlayback();
    return;
  }
  // else ignore
}

// Init
document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('access_token');
  if (!token) { window.location.href = 'index.html'; return; }

  try { bingoCategories = JSON.parse(localStorage.getItem('bingoCategories') || '[]'); } catch { bingoCategories = []; }

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

  const startBtn = document.getElementById('start-btn');
  startBtn.style.display = 'inline-block';

  startBtn.addEventListener('click', async () => {
    startBtn.style.display = 'none';
    await prepareNextTrack();
  });

  if (bingoCategories && bingoCategories.length > 0) buildWheel(bingoCategories);

  const wheelEl = document.getElementById('wheel');
  wheelEl.addEventListener('click', async () => { await handleWheelClick(); });
});

// helpers
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

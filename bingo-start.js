// bingo-start.js - komplette, korrigierte Version
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

// Spotify SDK readiness (optional)
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

// ---------------- Helpers ----------------
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
    const metaResp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!metaResp.ok) {
      console.error('Playlist meta error', await metaResp.text());
      return [];
    }
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
      console.warn('playTrack non-204', resp.status);
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

// ---------------- Wheel rendering ----------------
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

  // set CSS variable --r to half of wheel size for label transforms
  const wheelSize = wheel.clientWidth || parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wheel-size')) || 180;
  wheel.style.setProperty('--r', (wheelSize/2) + 'px');

  for (let i = 0; i < n; i++) {
    const lbl = document.createElement('div');
    lbl.className = 'wheel-label';
    const rot = i * angle + angle / 2;
    // Use translateY with CSS variable --r for pixel-accurate placement
    lbl.style.transform = `rotate(${rot}deg) translateY(calc(-1 * var(--r) * 0.58)) rotate(${-rot}deg)`;
    lbl.textContent = categories[i];
    wheel.appendChild(lbl);
  }

  // reset wheel rotation
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

// ---------------- Spin logic ----------------
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

// ---------------- Track details (toggle & Weiter) ----------------
function updateTrackDetails(track, addedBy) {
  const detailsContainer = document.getElementById('track-details');
  if (!detailsContainer) return;
  detailsContainer.innerHTML = 'Songinfos auflösen'; // collapsed text
  detailsContainer.style.display = 'none'; // initially hidden until playback started
  let expanded = false;

  detailsContainer.onclick = async function() {
    if (!expanded) {
      // fetch addedBy display name if necessary
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
        // Reset everything for next song:
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

// ---------------- Pulse (15s yellow, 5s red) ----------------
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

// ---------------- Prepare next track ----------------
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
    // show wheel and wait for spin
    buildWheel(bingoCategories);
    wheelSection.style.display = 'block';
    nowPlaying.style.display = 'block';
    nowText.textContent = 'Kategorie wählen';
    hasSpunThisSong = false;
  } else {
    // no categories -> auto play
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

// ---------------- Wheel click handler ----------------
async function handleWheelClick() {
  if (isSpinning) return;
  const songIsPlaying = isPlaying === true;

  // not playing & not spun yet -> spin -> start
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

  // playing & already spun -> pulse
  if (songIsPlaying && hasSpunThisSong && !isPulsing) {
    startPulseDuringPlayback();
    return;
  }
  // otherwise ignore
}

// ---------------- Init ----------------
document.addEventListener('DOMContentLoaded', async () => {
  // token present?
  const token = localStorage.getItem('access_token');
  if (!token) { window.location.href = 'index.html'; return; }

  // read categories
  try { bingoCategories = JSON.parse(localStorage.getItem('bingoCategories') || '[]'); } catch { bingoCategories = []; }

  // load playlist
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

  // show Start button
  const startBtn = document.getElementById('start-btn');
  startBtn.style.display = 'inline-block';

  startBtn.addEventListener('click', async () => {
    startBtn.style.display = 'none';
    // show wheel area and prepare first track
    document.getElementById('wheel-section').style.display = 'block';
    await prepareNextTrack();
  });

  // if categories already exist, build wheel so labels/colors are ready when shown
  if (bingoCategories && bingoCategories.length > 0) {
    buildWheel(bingoCategories);
  }

  // wheel click wiring
  const wheelEl = document.getElementById('wheel');
  wheelEl.addEventListener('click', async () => { await handleWheelClick(); });
});

// ---------------- small helper ----------------
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

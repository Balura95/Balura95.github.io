// bingo-start.js
// Neues Verhalten:
// - Lädt bingoPlaylistUrl (fallback mobilePlaylistUrl), cached Tracks.
// - Liest bingoCategories (falls gesetzt).
// - Vor jedem Song: prepareNextTrack() wählt nächsten Track (aber spielt noch nicht).
//   Wenn Kategorien vorhanden: Zeigt segmentiertes Rad (Wheel) oberhalb; drücken -> rad dreht 3s und wählt zufällige Kategorie.
//   Nach Ende der Drehung startet der Song automatisch.
// - Weiter pausiert aktuellen Song und bereitet nächsten Track vor (wheel wieder nutzbar).

let cachedPlaylistTracks = [];
let selectedTrackUri = null;
let currentPreparedItem = null;
let bingoCategories = [];
let isSpinning = false;
let spotifyReady = null;

// Playlist-ID extrahieren
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

// Tracks laden (Pagination)
async function fetchPlaylistTracks(playlistId) {
  const token = localStorage.getItem('access_token');
  if (!token) return [];
  const all = []; const limit = 50; let offset = 0;
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

// Spotify SDK init (falls vorhanden)
spotifyReady = new Promise((resolve) => {
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
    player.addListener('initialization_error', ({ message }) => { console.error(message); resolve(); });
    player.addListener('authentication_error', ({ message }) => { console.error(message); resolve(); });
    player.connect().catch(err => { console.warn('player connect err', err); resolve(); });
  };
});

// Play-API (nutzt deviceId falls vorhanden)
async function playTrack(uri) {
  const token = localStorage.getItem('access_token');
  if (!token) return false;
  await spotifyReady;
  // Warte etwas auf deviceId
  let wt = 0;
  while (!window.deviceId && wt < 6000) { await new Promise(r => setTimeout(r, 200)); wt += 200; }
  try {
    const deviceParam = window.deviceId ? `?device_id=${window.deviceId}` : '';
    const resp = await fetch(`https://api.spotify.com/v1/me/player/play${deviceParam}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [uri] })
    });
    return resp.status === 204;
  } catch (err) { console.error('playTrack error', err); return false; }
}

// Pause
async function stopPlayback() {
  const token = localStorage.getItem('access_token');
  if (!token) return;
  try {
    await fetch('https://api.spotify.com/v1/me/player/pause', {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}` }
    });
  } catch (err) { console.warn('stopPlayback error', err); }
}

function getRandomTrackIdx(tracks) {
  return Math.floor(Math.random() * tracks.length);
}

// UI: Wheel generieren (dynamisch nach # Kategorien)
function buildWheel(categories) {
  const wheel = document.getElementById('wheel');
  const container = document.getElementById('wheel-container');
  wheel.innerHTML = ''; // clear labels
  if (!categories || categories.length === 0) { container.style.display = 'none'; return; }
  container.style.display = 'block';

  const n = categories.length;
  const angle = 360 / n;
  // Baue conic-gradient mit wechselnden HSL-Farben
  const stops = [];
  for (let i = 0; i < n; i++) {
    const hue = Math.round((i * (360 / n)) % 360);
    const color = `hsl(${hue} 70% 64%)`;
    const start = i * angle;
    const end = (i + 1) * angle;
    stops.push(`${color} ${start}deg ${end}deg`);
  }
  wheel.style.background = `conic-gradient(${stops.join(',')})`;

  // Labels positionieren
  const radius = 100; // relative radius for label offset
  for (let i = 0; i < n; i++) {
    const lbl = document.createElement('div');
    lbl.className = 'wheel-label';
    // position: rotate(i*angle + angle/2) translate outward
    const rot = i * angle + angle / 2;
    lbl.style.transform = `rotate(${rot}deg) translate(0, -44%)`;
    lbl.style.left = '50%'; lbl.style.top = '50%';
    lbl.style.transformOrigin = '0 0';
    lbl.style.pointerEvents = 'none';
    lbl.textContent = categories[i];
    // rotate text back so it's readable
    lbl.style.writingMode = 'horizontal-tb';
    lbl.style.transform += ` rotate(${-rot}deg)`;
    wheel.appendChild(lbl);
  }

  // reset transform
  wheel.style.transition = 'none';
  wheel.style.transform = 'rotate(0deg)';
  // small timeout to clear transition none
  setTimeout(() => { wheel.style.transition = 'transform 3s cubic-bezier(.25,.9,.1,1)'; }, 30);
}

// Spin-Logik: dreht das Rad 3s und wählt zufällig ein Segment
async function spinWheelAndPick(categories) {
  if (!categories || categories.length === 0) return null;
  if (isSpinning) return null;
  isSpinning = true;
  const wheel = document.getElementById('wheel');
  const n = categories.length;
  const angle = 360 / n;

  // pick random segment index
  const targetIdx = Math.floor(Math.random() * n);
  // choose a random offset inside the segment to avoid always same border
  const randomOffset = (Math.random() * (angle - 8)) + 4; // 4..angle-4
  // compute angle from pointer (pointer at top -> 0deg). We need wheel rotation so that the chosen segment aligns with pointer
  // If segment i spans from i*angle .. (i+1)*angle, its center is (i+0.5)*angle.
  const targetAngleFromTop = (targetIdx * angle) + angle/2;
  // We want final wheel transform be such that that center points to top (0deg). Since wheel rotated clockwise positive,
  // final rotation = fullRounds*360 + (360 - targetAngleFromTop) + small random jitter inside segment.
  const fullRounds = 4 + Math.floor(Math.random() * 2); // 4 or 5 full rotations
  const finalRotation = fullRounds * 360 + (360 - targetAngleFromTop) + (angle/2 - randomOffset);

  // start rotation
  wheel.style.transition = 'transform 3s cubic-bezier(.25,.9,.1,1)';
  // apply transform
  wheel.style.transform = `rotate(${finalRotation}deg)`;

  // return a Promise that resolves after transitionend
  await new Promise((resolve) => {
    const onEnd = () => {
      wheel.removeEventListener('transitionend', onEnd);
      resolve();
    };
    wheel.addEventListener('transitionend', onEnd);
    // safety timeout in case transitionend missed
    setTimeout(() => { resolve(); }, 3500);
  });

  // normalize wheel rotation to keep numbers small (optional)
  wheel.style.transition = 'none';
  const normalized = finalRotation % 360;
  wheel.style.transform = `rotate(${normalized}deg)`;
  // restore transition
  setTimeout(() => { wheel.style.transition = 'transform 3s cubic-bezier(.25,.9,.1,1)'; }, 20);

  isSpinning = false;
  return { index: targetIdx, category: categories[targetIdx] };
}

// Update Trackbox (collapsed state)
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
          <p><strong>Album:</strong> ${track.album?.name || ''}</p>
          <p><strong>Jahr:</strong> ${track.album?.release_date?.substring(0,4) || ''}</p>
        </div>
      `;
      const weiterBtn = document.createElement('button');
      weiterBtn.className = 'btn details-weiter-btn green';
      weiterBtn.textContent = 'Weiter';
      details.appendChild(weiterBtn);

      weiterBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        // beim Weiter: pausieren & prepare next
        await stopPlayback();
        await prepareNextTrack(); // bereitet nächsten Track (zeigt wheel wieder wenn categories vorhanden)
      });

      expanded = true;
    } else {
      details.textContent = 'Songinfos auflösen';
      expanded = false;
    }
  };
}

// Bereitet nächsten Track vor (wählt zufällig einen, aber spielt nicht automatisch).
// Wenn Kategorien vorhanden: zeigt das Rad (wheel) und erwartet Spin -> nach Spin spielt es.
// Wenn keine Kategorien: startet sofort das Abspielen.
async function prepareNextTrack() {
  if (!cachedPlaylistTracks || cachedPlaylistTracks.length === 0) {
    M.toast({ html: 'Keine weiteren Songs verfügbar.', classes: 'rounded' });
    return;
  }
  // pick random item and set as prepared
  const idx = getRandomTrackIdx(cachedPlaylistTracks);
  const item = cachedPlaylistTracks[idx];
  currentPreparedItem = item;
  selectedTrackUri = item.track.uri;

  // Update track-details to collapsed state for next song
  updateTrackDetailsElement(item.track);

  // show wheel or auto-play
  if (bingoCategories && bingoCategories.length > 0) {
    // build wheel segments
    buildWheel(bingoCategories);
    // ensure wheel visible and reset rotation
    document.getElementById('wheel-container').style.display = 'block';
    document.getElementById('now-playing').style.display = 'block';
    document.getElementById('now-playing-text').textContent = 'Kategorie wählen';
    // user must spin to start playback
  } else {
    // no categories -> play immediately
    document.getElementById('wheel-container').style.display = 'none';
    document.getElementById('now-playing').style.display = 'block';
    document.getElementById('now-playing-text').textContent = 'Song läuft …';
    const ok = await playTrack(selectedTrackUri);
    if (!ok) M.toast({ html: 'Fehler beim Abspielen des Songs', classes: 'rounded' });
    // remove played from cache to avoid repeats
    cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track && x.track.uri !== selectedTrackUri);
  }
}

// Initial prepare + UI wiring
document.addEventListener('DOMContentLoaded', async () => {
  // token check
  const token = localStorage.getItem('access_token');
  if (!token) { window.location.href = 'index.html'; return; }

  const loadingText = document.getElementById('loading-text');
  const startBtn = document.getElementById('start-btn');
  const wheel = document.getElementById('wheel');
  const wheelContainer = document.getElementById('wheel-container');

  // read categories (if any)
  try {
    bingoCategories = JSON.parse(localStorage.getItem('bingoCategories') || '[]');
  } catch (e) {
    bingoCategories = [];
  }

  // load playlist
  const playlistUrl = localStorage.getItem('bingoPlaylistUrl') || localStorage.getItem('mobilePlaylistUrl') || '';
  const playlistId = extractPlaylistId(playlistUrl);
  if (!playlistId) {
    M.toast({ html: 'Keine gültige Playlist gefunden. Bitte Playlist eintragen.', classes: 'rounded' });
    document.getElementById('loading-text').style.display = 'none';
    document.getElementById('empty-warning').style.display = 'block';
    return;
  }

  loadingText.style.display = 'block';
  cachedPlaylistTracks = await fetchPlaylistTracks(playlistId);
  loadingText.style.display = 'none';

  if (!cachedPlaylistTracks || cachedPlaylistTracks.length === 0) {
    document.getElementById('empty-warning').style.display = 'block';
    return;
  }

  // show start button
  startBtn.style.display = 'inline-block';
  startBtn.classList.add('pulse');

  // Start-Button: bereitet ersten Track vor (bedingte Wiedergabe durch Wheel)
  startBtn.addEventListener('click', async () => {
    startBtn.style.display = 'none';
    // prepare next track (shows wheel if categories exist; doesn't auto-play if wheel present)
    await prepareNextTrack();
  });

  // Wheel click: start spin -> pick -> start song
  wheel.addEventListener('click', async () => {
    if (isSpinning) return;
    if (!bingoCategories || bingoCategories.length === 0) {
      M.toast({ html: 'Keine Kategorien vorhanden.', classes: 'rounded' });
      return;
    }
    document.getElementById('now-playing-text').textContent = 'Drehe ...';
    const result = await spinWheelAndPick(bingoCategories);
    if (!result) {
      document.getElementById('now-playing-text').textContent = 'Song läuft …';
      // fallback: play immediately
      if (selectedTrackUri) { await playTrack(selectedTrackUri); cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track && x.track.uri !== selectedTrackUri); }
      return;
    }
    // zeige ausgewählte Kategorie
    document.getElementById('now-playing-text').textContent = `Kategorie: ${result.category}`;
    // nach Spin: starte Song
    if (currentPreparedItem && currentPreparedItem.track && selectedTrackUri) {
      const ok = await playTrack(selectedTrackUri);
      if (!ok) M.toast({ html: 'Fehler beim Abspielen des Songs', classes: 'rounded' });
      // entferne abgespielten Song aus Cache
      cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track && x.track.uri !== selectedTrackUri);
    }
  });

});

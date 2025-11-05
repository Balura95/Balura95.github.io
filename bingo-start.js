// === Spotify + Playlist Funktionen bleiben unverändert === //
// Nur neue Glücksrad-Logik und Pulsation integriert

let cachedPlaylistTracks = [];
let selectedTrackUri = null;
let spotifyReady = null;
let wheelCtx, categories = [];
let hasSpun = false;
let hasPulsed = false;
let rotation = 0;
let pulseTimeoutYellow = null;
let pulseTimeoutRed = null;

// === Spotify / Playlist ===
function extractPlaylistId(url) {
  if (!url) return null;
  let m = url.match(/spotify:playlist:([A-Za-z0-9-_]+)/);
  if (m) return m[1];
  m = url.match(/playlist\/([A-Za-z0-9-_]+)/);
  if (m) return m[1];
  m = url.match(/[?&]id=([A-Za-z0-9-_]+)/);
  return m ? m[1] : null;
}

async function fetchPlaylistTracks(playlistId) {
  const token = localStorage.getItem('access_token');
  if (!token) return [];
  const all = [];
  const limit = 50;
  let offset = 0;

  try {
    const meta = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const metaData = await meta.json();
    const total = metaData.tracks?.total || 0;

    while (offset < total) {
      const resp = await fetch(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const data = await resp.json();
      const valid = (data.items || []).filter(i => i && i.track && i.track.uri && !i.is_local);
      all.push(...valid);
      offset += limit;
      if (!data.items || data.items.length === 0) break;
    }
    return all;
  } catch (e) {
    console.error(e);
    return [];
  }
}

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

    player.connect().catch(() => resolve());
  };
});

async function playTrack(uri) {
  const token = localStorage.getItem('access_token');
  if (!token) return false;
  await spotifyReady;

  let wait = 0;
  while (!window.deviceId && wait < 5000) {
    await new Promise(r => setTimeout(r, 200));
    wait += 200;
  }

  try {
    const dev = window.deviceId ? `?device_id=${window.deviceId}` : '';
    const res = await fetch(`https://api.spotify.com/v1/me/player/play${dev}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ uris: [uri] })
    });
    return res.status === 204;
  } catch (e) {
    console.error(e);
    return false;
  }
}

async function stopPlayback() {
  const token = localStorage.getItem('access_token');
  if (!token) return;
  try {
    await fetch('https://api.spotify.com/v1/me/player/pause', {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}` }
    });
  } catch (e) {
    console.warn('stop error', e);
  }
}

function getRandomTrack(tracks) {
  if (!tracks || !tracks.length) return null;
  const idx = Math.floor(Math.random() * tracks.length);
  return tracks[idx];
}

// === Track Details ===
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
          <p><strong>Album:</strong> ${track.album.name || ''}</p>
          <p><strong>Jahr:</strong> ${track.album.release_date ? track.album.release_date.substring(0, 4) : ''}</p>
        </div>
      `;

      const weiter = document.createElement('button');
      weiter.className = 'btn details-weiter-btn green';
      weiter.textContent = 'Nächstes Lied';
      weiter.type = 'button';
      details.appendChild(weiter);

      weiter.addEventListener('click', async ev => {
        ev.stopPropagation();
        await stopPlayback();
        stopPulse(); // 🔸 Pulsieren abbrechen
        hasSpun = false;
        hasPulsed = false;
        document.getElementById('now-playing').style.display = 'none';
        document.getElementById('selected-category').textContent = '';
      });

      expanded = true;
    } else {
      details.textContent = 'Songinfos auflösen';
      expanded = false;
    }
  };
}

// === Glücksrad ===
function drawWheel() {
  const canvas = document.getElementById('wheel-canvas');
  const ctx = canvas.getContext('2d');
  const count = categories.length;
  const arc = (2 * Math.PI) / count;

  const colors = [
    '#f44336', '#e91e63', '#9c27b0', '#3f51b5',
    '#2196f3', '#009688', '#4caf50', '#ff9800',
    '#ffc107', '#8bc34a', '#03a9f4', '#00bcd4'
  ];

  ctx.clearRect(0, 0, 400, 400);

  for (let i = 0; i < count; i++) {
    ctx.beginPath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.moveTo(200, 200);
    ctx.arc(200, 200, 200, i * arc, (i + 1) * arc);
    ctx.lineTo(200, 200);
    ctx.fill();

    ctx.save();
    ctx.translate(200, 200);
    ctx.rotate(i * arc + arc / 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px Roboto';
    ctx.fillText(categories[i], 180, 10);
    ctx.restore();
  }
}

// Drehanimation mit realer Kategorie-Bestimmung (korrekt für Pfeil nach unten)
function spinWheel() {
  return new Promise(resolve => {
    const canvas = document.getElementById('wheel-canvas');
    const count = categories.length;
    const arc = 360 / count;

    // Ziel: zufällige Kategorie -> daraus exakte Drehung berechnen
    const chosenIndex = Math.floor(Math.random() * count);
    // Kleine zufällige Abweichung innerhalb des Segments (+/- bis 20% vom Segmentwinkel)
    const randomOffset = (Math.random() - 0.5) * arc * 0.4; // ±20% Spielraum
    const targetAngle = (360 - (chosenIndex * arc) - arc / 2 + 270 + randomOffset) % 360;


    // Drehung: mehrere volle Runden + exakter Zielwinkel
    const spins = 5;
    const finalRotation = rotation + spins * 360 + targetAngle;

    const startRotation = rotation;
    const startTime = performance.now();
    const duration = 5000;

    function animate(now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      const current = startRotation + (finalRotation - startRotation) * ease;
      canvas.style.transform = `rotate(${current}deg)`;

      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        rotation = finalRotation % 360;

        // Bestimme den tatsächlichen Index unter dem Pfeil (unten bei 270°)
        const normalized = (rotation + 360) % 360;
        const angleFromBottom = (normalized + 90) % 360; // Pfeil unten = 270°
        const index = Math.floor((count - angleFromBottom / arc)) % count;
        const category = categories[index];
        resolve(category);
      }
    }

    requestAnimationFrame(animate);
  });
}

// === Pulsieren + Buzzer ===
function pulseWheel() {
  return new Promise(resolve => {
    const wheel = document.getElementById('wheel-container');
    const buzzer = document.getElementById('buzzer-sound');
    stopPulse(); // Sicherheitsreset

    wheel.classList.add('pulse-yellow');

    pulseTimeoutYellow = setTimeout(() => {
      wheel.classList.remove('pulse-yellow');
      wheel.classList.add('pulse-red');

      pulseTimeoutRed = setTimeout(() => {
        wheel.classList.remove('pulse-red');
        buzzer.currentTime = 0;
        buzzer.play().catch(() => {});
        resolve();
      }, 5000);
    }, 15000);
  });
}

// 🔸 Pulsation vollständig abbrechen
function stopPulse() {
  const wheel = document.getElementById('wheel-container');
  wheel.classList.remove('pulse-yellow', 'pulse-red');
  clearTimeout(pulseTimeoutYellow);
  clearTimeout(pulseTimeoutRed);
  pulseTimeoutYellow = null;
  pulseTimeoutRed = null;
}

// === Hauptlogik ===
document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('access_token');
  if (!token) { window.location.href = 'index.html'; return; }

  const loading = document.getElementById('loading-text');
  const startBtn = document.getElementById('start-btn');
  const wheelContainer = document.getElementById('wheel-container');
  const wheelCanvas = document.getElementById('wheel-canvas');
  const selectedCategoryDiv = document.getElementById('selected-category');
  const nowPlaying = document.getElementById('now-playing');

  const playlistUrl = localStorage.getItem('bingoPlaylistUrl') || localStorage.getItem('mobilePlaylistUrl') || '';
  const playlistId = extractPlaylistId(playlistUrl);
  if (!playlistId) return;

  loading.style.display = 'block';
  cachedPlaylistTracks = await fetchPlaylistTracks(playlistId);
  loading.style.display = 'none';

  if (!cachedPlaylistTracks.length) {
    document.getElementById('empty-warning').style.display = 'block';
    return;
  }

  startBtn.style.display = 'inline-block';
  categories = JSON.parse(localStorage.getItem('bingoCategories') || '[]');
  const discokugelActive = categories.length > 0;
  wheelCtx = wheelCanvas.getContext('2d');

  if (discokugelActive) {
    startBtn.addEventListener('click', () => {
      startBtn.style.display = 'none';
      wheelContainer.style.display = 'block';
      drawWheel();

      wheelCanvas.addEventListener('click', async () => {
        if (!hasSpun) {
          // Starte die Drehung
          const category = await spinWheel();

          // Warte einen Moment nach Ende der Animation
          await new Promise(r => setTimeout(r, 300));

          // Kategorie anzeigen
          selectedCategoryDiv.textContent = 'Kategorie: ' + category;

          // Jetzt erst Song starten
          const item = getRandomTrack(cachedPlaylistTracks);
          if (!item || !item.track) return;
          selectedTrackUri = item.track.uri;

          await playTrack(selectedTrackUri);
          updateTrackDetailsElement(item.track);
          nowPlaying.style.display = 'block';

          cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track && x.track.uri !== selectedTrackUri);
          hasSpun = true;
          hasPulsed = false;
          return;
        }

        if (!hasPulsed) {
          await pulseWheel();
          await stopPlayback();
          hasPulsed = true;
        }
      });
    });
  } else {
    // Standard-Bingo ohne Discokugel
    startBtn.addEventListener('click', async () => {
      startBtn.style.display = 'none';
      nowPlaying.style.display = 'block';

      const track = getRandomTrack(cachedPlaylistTracks);
      if (!track || !track.track) return;
      selectedTrackUri = track.track.uri;

      await playTrack(selectedTrackUri);
      updateTrackDetailsElement(track.track);

      cachedPlaylistTracks = cachedPlaylistTracks.filter(x => x.track && x.track.uri !== selectedTrackUri);
    });
  }
});

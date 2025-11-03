// bingo-start.js - überarbeitet für Sichtbarkeit, korrekte "Weiter"-Logik und Ladeanzeige

let cachedPlaylistTracks = [];
let selectedTrackUri = null;

// Playlist-ID extrahieren
function extractPlaylistId(url) {
  if (!url) return null;
  let m = url.match(/spotify:playlist:([A-Za-z0-9]+)/);
  if (m) return m[1];
  m = url.match(/playlist\/([A-Za-z0-9-_]+)/);
  if (m) return m[1];
  return null;
}

// Playlist laden
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
      if (!resp.ok) break;
      const data = await resp.json();
      const valid = data.items.filter(i => i.track && i.track.uri && !i.is_local);
      all.push(...valid);
      offset += limit;
      if (!data.items || data.items.length === 0) break;
    }
    return all;
  } catch (e) {
    console.error("Fehler beim Laden der Playlist:", e);
    return [];
  }
}

function getRandomTrack(tracks) {
  const idx = Math.floor(Math.random() * tracks.length);
  return tracks[idx];
}

// Spotify abspielen
async function playTrack(uri) {
  const token = localStorage.getItem('access_token');
  if (!token) return false;
  try {
    const response = await fetch('https://api.spotify.com/v1/me/player/play', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ uris: [uri] })
    });
    return response.status === 204;
  } catch {
    return false;
  }
}

async function stopPlayback() {
  const token = localStorage.getItem('access_token');
  if (!token) return;
  await fetch('https://api.spotify.com/v1/me/player/pause', {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}` }
  }).catch(()=>{});
}

function updateTrackDetailsElement(track) {
  const details = document.getElementById('track-details');
  if (!details) return;
  let expanded = false;

  details.textContent = "Songinfos auflösen";
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
      weiterBtn.className = 'btn details-weiter-btn green waves-effect waves-light';
      weiterBtn.textContent = 'Weiter';
      details.appendChild(weiterBtn);

      weiterBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await handleNextSong();
      });

      expanded = true;
    } else {
      details.textContent = "Songinfos auflösen";
      expanded = false;
    }
  };
}

async function handleNextSong() {
  if (!cachedPlaylistTracks.length) {
    M.toast({ html: "Keine weiteren Songs verfügbar.", classes: "rounded" });
    return;
  }

  await stopPlayback();
  const item = getRandomTrack(cachedPlaylistTracks);
  selectedTrackUri = item.track.uri;
  await playTrack(selectedTrackUri);
  document.getElementById('now-playing-text').textContent = "Song läuft …";
  updateTrackDetailsElement(item.track);
  cachedPlaylistTracks = cachedPlaylistTracks.filter(t => t.track.uri !== selectedTrackUri);
}

function showEmptyWarning() {
  document.getElementById('loading-text').style.display = 'none';
  document.getElementById('start-btn').style.display = 'none';
  document.getElementById('empty-warning').style.display = 'block';
}

document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('access_token');
  if (!token) { window.location.href = 'index.html'; return; }

  const loadingText = document.getElementById('loading-text');
  const startBtn = document.getElementById('start-btn');
  const nowPlaying = document.getElementById('now-playing');

  const playlistUrl = localStorage.getItem('bingoPlaylistUrl') || localStorage.getItem('mobilePlaylistUrl');
  const playlistId = extractPlaylistId(playlistUrl);
  if (!playlistId) return showEmptyWarning();

  // Ladeanzeige sichtbar lassen, bis fertig
  loadingText.style.display = 'block';
  cachedPlaylistTracks = await fetchPlaylistTracks(playlistId);
  loadingText.style.display = 'none';

  if (!cachedPlaylistTracks.length) return showEmptyWarning();

  // Playlist geladen -> Startbutton zeigen
  startBtn.style.display = 'inline-block';
  startBtn.classList.add('pulse');

  startBtn.addEventListener('click', async () => {
    startBtn.style.display = 'none';
    nowPlaying.style.display = 'block';
    document.getElementById('now-playing-text').textContent = "Song läuft …";

    const item = getRandomTrack(cachedPlaylistTracks);
    selectedTrackUri = item.track.uri;
    await playTrack(selectedTrackUri);
    updateTrackDetailsElement(item.track);
    cachedPlaylistTracks = cachedPlaylistTracks.filter(t => t.track.uri !== selectedTrackUri);
  });
});

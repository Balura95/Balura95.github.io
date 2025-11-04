let cachedPlaylistTracks = [];
let currentTrack = null;

document.addEventListener('DOMContentLoaded', async () => {
  const loadingText = document.getElementById('loading-text');
  const startBtn = document.getElementById('start-btn');
  const nowPlaying = document.getElementById('now-playing');
  const trackDetails = document.getElementById('track-details');

  const playlistUrl = localStorage.getItem('bingoPlaylistUrl');
  const playlistId = extractPlaylistId(playlistUrl);
  const token = localStorage.getItem('access_token');

  if (!playlistId || !token) {
    loadingText.textContent = 'Fehler: Keine Playlist oder kein Login gefunden.';
    return;
  }

  loadingText.textContent = 'Playlist wird geladen...';
  cachedPlaylistTracks = await fetchPlaylistTracks(playlistId, token);

  if (cachedPlaylistTracks.length === 0) {
    loadingText.textContent = 'Keine Songs in der Playlist gefunden.';
    return;
  }

  loadingText.style.display = 'none';
  startBtn.style.display = 'inline-block';

  startBtn.addEventListener('click', async () => {
    startBtn.style.display = 'none';
    await startNextSong();
  });

  trackDetails.addEventListener('click', toggleTrackDetails);
});

function extractPlaylistId(url) {
  if (!url) return null;
  const match = url.match(/playlist\/([A-Za-z0-9]+)/);
  return match ? match[1] : null;
}

async function fetchPlaylistTracks(playlistId, token) {
  const allTracks = [];
  let offset = 0;
  const limit = 50;

  try {
    while (true) {
      const response = await fetch(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );

      if (!response.ok) break;
      const data = await response.json();
      if (!data.items.length) break;

      allTracks.push(...data.items);
      offset += limit;
    }
  } catch (error) {
    console.error('Fehler beim Laden:', error);
  }
  return allTracks;
}

async function startNextSong() {
  if (cachedPlaylistTracks.length === 0) {
    M.toast({ html: 'Keine weiteren Songs verfügbar.', classes: 'rounded' });
    return;
  }

  const randomIndex = Math.floor(Math.random() * cachedPlaylistTracks.length);
  const trackItem = cachedPlaylistTracks[randomIndex];
  cachedPlaylistTracks.splice(randomIndex, 1);
  currentTrack = trackItem.track;

  await playTrack(currentTrack.uri);
  showNowPlaying(currentTrack, trackItem.added_by);
}

function showNowPlaying(track, addedBy) {
  document.getElementById('now-playing').style.display = 'block';
  const details = document.getElementById('track-details');
  details.textContent = 'Songinfos auflösen';
  details.dataset.open = 'false';

  const nowPlayingTitle = document.querySelector('#now-playing h4');
  nowPlayingTitle.textContent = `Song läuft: ${track.name} – ${track.artists.map(a => a.name).join(', ')}`;
}

function toggleTrackDetails() {
  const details = document.getElementById('track-details');

  if (details.dataset.open === 'true') {
    details.textContent = 'Songinfos auflösen';
    details.dataset.open = 'false';
    return;
  }

  if (!currentTrack) return;
  const artists = currentTrack.artists.map(a => a.name).join(', ');
  const album = currentTrack.album?.name || '';
  const year = currentTrack.album?.release_date?.substring(0, 4) || '';

  details.innerHTML = `
    <p><strong>Titel:</strong> ${currentTrack.name}</p>
    <p><strong>Interpret:</strong> ${artists}</p>
    <p><strong>Album:</strong> ${album}</p>
    <p><strong>Jahr:</strong> ${year}</p>
    <button id="weiter-song" class="btn green" style="margin-top:10px;">Weiter</button>
  `;
  details.dataset.open = 'true';

  document.getElementById('weiter-song').addEventListener('click', startNextSong);
}

async function playTrack(uri) {
  const token = localStorage.getItem('access_token');
  if (!token) return;
  try {
    await fetch('https://api.spotify.com/v1/me/player/play', {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [uri] })
    });
  } catch (error) {
    console.error('Fehler beim Abspielen:', error);
  }
}

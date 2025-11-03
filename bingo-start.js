let cachedPlaylistTracks = [];
let selectedTrackUri = null;

// Spotify SDK Setup
let spotifySDKReady = new Promise((resolve) => {
  window.onSpotifyWebPlaybackSDKReady = () => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      window.location.href = 'index.html';
      return;
    }

    const player = new Spotify.Player({
      name: 'Bingo Player',
      getOAuthToken: cb => cb(token),
    });

    player.addListener('ready', ({ device_id }) => {
      window.deviceId = device_id;
      window.bingoPlayer = player;
      resolve();
    });

    player.connect();
  };
});

function extractPlaylistId(url) {
  const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

async function fetchPlaylistTracks(playlistId) {
  const token = localStorage.getItem('access_token');
  let allTracks = [];
  let offset = 0;
  const limit = 50;

  try {
    let response;
    do {
      response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      allTracks = allTracks.concat(data.items);
      offset += limit;
    } while (response.ok && allTracks.length < response.total);

    return allTracks;
  } catch (err) {
    console.error("Fehler beim Laden der Playlist:", err);
    return [];
  }
}

function getRandomTrack(tracks) {
  if (!tracks.length) return null;
  const index = Math.floor(Math.random() * tracks.length);
  return tracks[index];
}

function updateTrackDetails(track, addedBy) {
  const details = document.getElementById('track-details');
  let expanded = false;

  details.onclick = () => {
    if (!expanded) {
      details.innerHTML = `
        <p><strong>Titel:</strong> ${track.name}</p>
        <p><strong>Interpret:</strong> ${track.artists.map(a => a.name).join(', ')}</p>
        <p><strong>Erscheinungsjahr:</strong> ${track.album.release_date.substring(0,4)}</p>
      `;
      expanded = true;
    } else {
      details.textContent = "Songinfos auflösen";
      expanded = false;
    }
  };
}

async function playTrack(uri) {
  const token = localStorage.getItem('access_token');
  await spotifySDKReady;

  try {
    const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${window.deviceId}`, {
      method: 'PUT',
      body: JSON.stringify({ uris: [uri] }),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      }
    });

    if (response.status === 204) {
      console.log("Track läuft");
    } else {
      console.error("Fehler beim Starten des Tracks:", await response.text());
    }
  } catch (err) {
    console.error("Spotify Playback Error:", err);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const startBtn = document.getElementById('start-btn');
  const nowPlaying = document.getElementById('now-playing');
  const nextBtn = document.getElementById('next-btn');

  const playlistUrl = localStorage.getItem('mobilePlaylistUrl');
  const playlistId = extractPlaylistId(playlistUrl);
  cachedPlaylistTracks = await fetchPlaylistTracks(playlistId);

  startBtn.addEventListener('click', async () => {
    startBtn.style.display = 'none';
    nowPlaying.style.display = 'block';

    const randomItem = getRandomTrack(cachedPlaylistTracks);
    selectedTrackUri = randomItem.track.uri;

    await playTrack(selectedTrackUri);
    updateTrackDetails(randomItem.track, randomItem.added_by);
  });

  nextBtn.addEventListener('click', async () => {
    const randomItem = getRandomTrack(cachedPlaylistTracks);
    selectedTrackUri = randomItem.track.uri;

    await playTrack(selectedTrackUri);
    updateTrackDetails(randomItem.track, randomItem.added_by);

    // Wenn du nach ein paar Songs zur Bingo-Seite willst:
    // window.location.href = "bingo.html";
  });
});

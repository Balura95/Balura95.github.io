document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('playlist-url');
  const weiterBtn = document.getElementById('weiter-btn');

  weiterBtn.addEventListener('click', () => {
    const url = input.value.trim();
    if (!url) {
      alert('Bitte gib eine Spotify-Playlist-URL ein.');
      return;
    }
    localStorage.setItem('bingoPlaylistUrl', url);
    window.location.href = 'bingo-start.html';
  });
});

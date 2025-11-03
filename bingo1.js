document.addEventListener('DOMContentLoaded', () => {
  const nextButton = document.getElementById('bingo-next-button');
  const input = document.getElementById('bingo-playlist-url');

  // Falls bereits eine bingoPlaylistUrl existiert, vorbefüllen:
  const existing = localStorage.getItem('bingoPlaylistUrl') || localStorage.getItem('mobilePlaylistUrl') || '';
  if (existing) {
    input.value = existing;
    // Materialize label fix:
    M.updateTextFields();
  }

  nextButton.addEventListener('click', () => {
    const playlistUrl = input.value.trim();

    if (!playlistUrl) {
      M.toast({ html: "Bitte eine Playlist-URL eingeben", classes: "rounded", displayLength: 2000 });
      return;
    }

    // Speichern unter eigenem Key
    localStorage.setItem('bingoPlaylistUrl', playlistUrl);

    // Prüfe Spotify-Login
    const token = localStorage.getItem('access_token');
    if (!token) {
      M.toast({ html: "Spotify-Login erforderlich – du wirst weitergeleitet", classes: "rounded", displayLength: 2200 });
      setTimeout(() => { window.location.href = 'index.html'; }, 1400);
      return;
    }

    // Weiter zu bingo-start.html
    window.location.href = 'bingo-start.html';
  });
});

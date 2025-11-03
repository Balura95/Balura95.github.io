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

document.addEventListener('DOMContentLoaded', () => {
  const checkbox = document.getElementById('discokugel-checkbox');
  const categoriesContainer = document.getElementById('categories-container');

  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      categoriesContainer.style.display = 'block';
    } else {
      categoriesContainer.style.display = 'none';
    }
  });

  // Kategorie hinzufügen
  document.getElementById('add-category').addEventListener('click', () => {
    const container = document.getElementById('categories-container');
    const div = document.createElement('div');
    div.className = 'input-field';
    div.innerHTML = '<input class="category-input" type="text"><label>Weitere Kategorie hinzufügen</label>';
    container.appendChild(div);
    div.querySelector('.category-input').focus();
  });

  // Kategorie entfernen
  document.getElementById('remove-category').addEventListener('click', () => {
    const container = document.getElementById('categories-container');
    const fields = container.querySelectorAll('.input-field');
    if (fields.length > 1) {
      fields[fields.length - 1].remove();
    }
  });

  // Weiter-Button speichert Playlist + Kategorien
  document.getElementById('next-button').addEventListener('click', () => {
    const playlistUrl = document.getElementById('playlist-url').value.trim();
    if (!playlistUrl) {
      M.toast({ html: "Bitte Playlist URL eingeben", classes: "rounded", displayLength: 2000 });
      return;
    }
    localStorage.setItem('bingoPlaylistUrl', playlistUrl);

    if (checkbox.checked) {
      const catInputs = document.querySelectorAll('.category-input');
      let categories = [];
      catInputs.forEach(input => {
        const value = input.value.trim();
        if (value) categories.push(value);
      });
      localStorage.setItem('bingoCategories', JSON.stringify(categories));
    } else {
      localStorage.setItem('bingoCategories', JSON.stringify([]));
    }

    window.location.href = 'bingo-start.html';
  });
});

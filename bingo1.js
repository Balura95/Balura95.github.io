// bingo1.js
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('playlist-url');
  const checkbox = document.getElementById('discokugel-checkbox');
  const categoriesWrapper = document.getElementById('categories-wrapper');
  const categoriesContainer = document.getElementById('categories-container');
  const addBtn = document.getElementById('add-category');
  const removeBtn = document.getElementById('remove-category');
  const nextBtn = document.getElementById('next-button');

  // Vorbefüllen: falls schon gespeichert (bingoPlaylistUrl oder mobilePlaylistUrl)
  const existing = localStorage.getItem('bingoPlaylistUrl') || localStorage.getItem('mobilePlaylistUrl') || '';
  if (existing && input) {
    input.value = existing;
    if (window.M && typeof M.updateTextFields === 'function') M.updateTextFields();
  }

  // Falls Kategorien vorher gespeichert wurden, checkbox vorbefüllen
  const existingCatsRaw = localStorage.getItem('bingoCategories');
  if (existingCatsRaw) {
    try {
      const cats = JSON.parse(existingCatsRaw);
      if (Array.isArray(cats) && cats.length > 0) {
        // zeige wrapper & vorbefülle Felder
        checkbox.checked = true;
        categoriesWrapper.style.display = 'block';
        // clear default single input and re-populate
        categoriesContainer.innerHTML = '';
        cats.forEach((c, idx) => {
          const div = document.createElement('div');
          div.className = 'input-field';
          div.innerHTML = `<input class="category-input" type="text" value="${escapeHtmlAttr(c)}"><label class="${c ? 'active' : ''}">Kategorie ${idx+1}</label>`;
          categoriesContainer.appendChild(div);
        });
      }
    } catch (e) { /* ignore parse errors */ }
  }

  // Checkbox toggelt Kategorien-Wrapper
  if (checkbox && categoriesWrapper) {
    checkbox.addEventListener('change', () => {
      categoriesWrapper.style.display = checkbox.checked ? 'block' : 'none';
    });
  }

  // Kategorie hinzufügen (Buttons bewegen sich, weil sie innerhalb wrapper sind)
  if (addBtn && categoriesContainer) {
    addBtn.addEventListener('click', () => {
      const div = document.createElement('div');
      div.className = 'input-field';
      div.innerHTML = '<input class="category-input" type="text"><label>Weitere Kategorie eintragen</label>';
      categoriesContainer.appendChild(div);
      if (window.M && typeof M.updateTextFields === 'function') M.updateTextFields();
      div.querySelector('.category-input').focus();
    });
  }

  // Kategorie entfernen
  if (removeBtn && categoriesContainer) {
    removeBtn.addEventListener('click', () => {
      const fields = categoriesContainer.querySelectorAll('.input-field');
      if (fields.length > 1) {
        fields[fields.length - 1].remove();
      }
    });
  }

  // Weiter-Button: speichert Playlist + Kategorien (Discokugel -> bingoCategories)
  nextBtn.addEventListener('click', () => {
    const playlistUrl = input.value.trim();
    if (!playlistUrl) {
      if (window.M) M.toast({ html: "Bitte Playlist URL eingeben", classes: "rounded", displayLength: 2000 });
      return;
    }
    // Speichere unter bingoPlaylistUrl (bingo-start liest diesen vorrangig)
    localStorage.setItem('bingoPlaylistUrl', playlistUrl);

    // Kategorien optional speichern (nur wenn Discokugel aktiviert)
    if (checkbox && checkbox.checked) {
      const catInputs = categoriesContainer.querySelectorAll('.category-input');
      const cats = [];
      catInputs.forEach(i => {
        const v = i.value.trim();
        if (v) cats.push(v);
      });
      localStorage.setItem('bingoCategories', JSON.stringify(cats));
    } else {
      localStorage.setItem('bingoCategories', JSON.stringify([]));
    }

    window.location.href = 'bingo-start.html';
  });

  // Utility: einfache Escaping für value attribute
  function escapeHtmlAttr(s) {
    return String(s).replace(/"/g, '&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
});

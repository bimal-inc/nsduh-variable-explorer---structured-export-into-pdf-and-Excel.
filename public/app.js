function readSelections() {
  try { return JSON.parse(localStorage.getItem('nsduhSelectionsV2') || '{}'); }
  catch { return {}; }
}

function persistSelections(selections) {
  localStorage.setItem('nsduhSelectionsV2', JSON.stringify(selections || {}));
}

function readCategories() {
  try { return JSON.parse(localStorage.getItem('nsduhMainCategoriesV1') || '[]'); }
  catch { return []; }
}

function persistCategories(categories) {
  localStorage.setItem('nsduhMainCategoriesV1', JSON.stringify(categories || []));
}

function readPresets() {
  try { return JSON.parse(localStorage.getItem('nsduhSelectionPresetsV1') || '[]'); }
  catch { return []; }
}

function persistPresets(presets) {
  localStorage.setItem('nsduhSelectionPresetsV1', JSON.stringify(presets || []));
}

function nsduhApp() {
  return {
    dataset: 'NSDUH-2021-DS0001',
    selections: {},
    categoryDialogOpen: false,
    categoryInput: '',
    categoryFilter: '',
    pendingSelections: [],
    categories: [],
    presets: [],
    presetName: '',
    selectedSearch: '',
    init() {
      this.dataset = document.getElementById('dataset')?.value || this.dataset;
      this.selections = readSelections();
      const savedCategories = readCategories();
      const selectionCategories = Object.values(this.selections).map(item => item.mainCategory).filter(Boolean);
      this.categories = this.uniqueCategoryNames([...savedCategories, ...selectionCategories]);
      persistCategories(this.categories);
      this.presets = readPresets();

      window.addEventListener('nsduh:save-selection', (event) => {
        const item = event.detail;
        if (!item || !item.variableId) return;
        const saved = this.selections[String(item.variableId)];
        if (saved?.datasetSlug === item.datasetSlug) {
          this.save({ ...saved, ...item, mainCategory: saved.mainCategory || item.codebookCategory || 'Uncategorized' });
        } else {
          this.openCategoryDialog([item]);
        }
      });

      window.addEventListener('nsduh:save-selection-batch', (event) => {
        this.openCategoryDialog(Array.isArray(event.detail) ? event.detail : [], true);
      });

      window.addEventListener('nsduh:remove-selection', (event) => {
        this.removeVariable(event.detail?.variableId);
      });

      window.addEventListener('nsduh:request-selection-sync', () => {
        window.dispatchEvent(new CustomEvent('nsduh:selection-sync', { detail: this.selections }));
      });
    },
    get currentSelections() {
      return Object.values(this.selections).filter(x => x.datasetSlug === this.dataset);
    },
    get selectedCount() { return this.currentSelections.length; },
    get currentPresets() { return this.presets.filter(preset => preset.datasetSlug === this.dataset); },
    get filteredSelectedCount() {
      return this.groupedSelections.reduce((total, group) => total + group.subcategories.reduce((n, sub) => n + sub.items.length, 0), 0);
    },
    get groupedSelections() {
      const groups = new Map();
      for (const item of this.currentSelections) {
        const search = this.selectedSearch.trim().toLocaleLowerCase();
        if (search && ![item.code, item.label, item.mainCategory, item.codebookCategory]
          .some(value => String(value || '').toLocaleLowerCase().includes(search))) continue;
        const main = (item.mainCategory || item.codebookCategory || 'Uncategorized').trim();
        const sub = (item.codebookCategory || 'Uncategorized').trim();
        if (!groups.has(main)) groups.set(main, { name: main, count: 0, subcategories: new Map() });
        const group = groups.get(main);
        group.count++;
        if (!group.subcategories.has(sub)) group.subcategories.set(sub, { name: sub, items: [] });
        group.subcategories.get(sub).items.push(item);
      }
      return [...groups.values()]
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
        .map(group => ({
          ...group,
          subcategories: [...group.subcategories.values()]
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
            .map(sub => ({ ...sub, items: sub.items.sort((a, b) => String(a.code).localeCompare(String(b.code))) }))
        }));
    },
    get filteredCategories() {
      const q = this.categoryFilter.trim().toLocaleLowerCase();
      return this.categories.filter(name => !q || name.toLocaleLowerCase().includes(q));
    },
    uniqueCategoryNames(names) {
      const unique = new Map();
      for (const value of names) {
        const name = String(value || '').trim();
        if (name && !unique.has(name.toLocaleLowerCase())) unique.set(name.toLocaleLowerCase(), name);
      }
      return [...unique.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    },
    changeDataset(slug) {
      const url = new URL(window.location.href);
      url.searchParams.set('dataset', slug);
      window.location.href = url.toString();
    },
    savePreset() {
      const name = this.presetName.trim();
      if (!name) return alert('Enter a preset name first.');
      if (!this.selectedCount) return alert('Select at least one variable first.');
      const preset = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        savedAt: new Date().toISOString(),
        datasetSlug: this.dataset,
        selections: JSON.parse(JSON.stringify(this.currentSelections))
      };
      this.presets = [preset, ...this.presets];
      persistPresets(this.presets);
      this.presetName = '';
    },
    loadPreset(preset) {
      const next = { ...this.selections };
      for (const [key, item] of Object.entries(next)) {
        if (item.datasetSlug === this.dataset) delete next[key];
      }
      for (const item of (preset.selections || [])) {
        if (item.datasetSlug === this.dataset) next[String(item.variableId)] = { ...item };
      }
      this.selections = next;
      persistSelections(next);
      const presetCategories = (preset.selections || []).map(item => item.mainCategory).filter(Boolean);
      this.categories = this.uniqueCategoryNames([...this.categories, ...presetCategories]);
      persistCategories(this.categories);
      window.dispatchEvent(new CustomEvent('nsduh:selection-sync', { detail: this.selections }));
    },
    deletePreset(id) {
      this.presets = this.presets.filter(preset => preset.id !== id);
      persistPresets(this.presets);
    },
    formatPresetDate(value) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
    },
    async openSelectedVariable(id) {
      const detail = document.getElementById('detail');
      if (!detail) return;
      if (window.htmx) {
        await window.htmx.ajax('GET', `/variable/${encodeURIComponent(id)}`, { target: '#detail', swap: 'innerHTML' });
        detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const response = await fetch(`/variable/${encodeURIComponent(id)}`);
      if (!response.ok) return;
      detail.innerHTML = await response.text();
      detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    save(item) {
      this.selections = { ...this.selections, [String(item.variableId)]: item };
      persistSelections(this.selections);
      window.dispatchEvent(new CustomEvent('nsduh:selection-sync', { detail: this.selections }));
    },
    suggestedCategory() {
      return (document.getElementById('variable-search')?.value || '').trim();
    },
    openCategoryDialog(items, reassignExisting = false) {
      const unique = new Map();
      for (const item of items) {
        if (!item?.variableId || item.datasetSlug !== this.dataset) continue;
        const saved = this.selections[String(item.variableId)];
        if (saved?.datasetSlug === this.dataset && !reassignExisting) continue;
        unique.set(String(item.variableId), saved?.datasetSlug === this.dataset ? { ...item, ...saved } : item);
      }
      if (!unique.size) return;
      this.pendingSelections = [...unique.values()];
      this.categoryInput = this.suggestedCategory() || this.pendingSelections[0].codebookCategory || '';
      this.categoryFilter = '';
      this.categoryDialogOpen = true;
      this.$nextTick(() => this.$refs.categoryName?.focus());
    },
    confirmCategory() {
      const entered = this.categoryInput.trim();
      const mainCategory = this.categories.find(name => name.toLocaleLowerCase() === entered.toLocaleLowerCase()) || entered;
      if (!mainCategory) return;
      const next = { ...this.selections };
      for (const item of this.pendingSelections) next[String(item.variableId)] = { ...item, mainCategory };
      this.selections = next;
      persistSelections(this.selections);
      this.categories = this.uniqueCategoryNames([...this.categories, mainCategory]);
      persistCategories(this.categories);
      this.categoryDialogOpen = false;
      this.pendingSelections = [];
      window.dispatchEvent(new CustomEvent('nsduh:selection-sync', { detail: this.selections }));
    },
    cancelCategory() {
      this.categoryDialogOpen = false;
      this.pendingSelections = [];
      window.dispatchEvent(new CustomEvent('nsduh:selection-sync', { detail: this.selections }));
    },
    chooseCategory(name) {
      this.categoryInput = name;
      this.$refs.categoryName?.focus();
    },
    renameCategory(oldName) {
      const proposed = window.prompt(`Rename category “${oldName}” to:`, oldName);
      const newName = String(proposed || '').trim();
      if (!newName || newName === oldName) return;
      const canonical = this.categories.find(name => name.toLocaleLowerCase() === newName.toLocaleLowerCase() && name !== oldName) || newName;
      const next = { ...this.selections };
      for (const [key, item] of Object.entries(next)) {
        if (item.mainCategory === oldName) next[key] = { ...item, mainCategory: canonical };
      }
      this.selections = next;
      persistSelections(next);
      this.categories = this.uniqueCategoryNames(this.categories.filter(name => name !== oldName).concat(canonical));
      persistCategories(this.categories);
      if (this.categoryInput === oldName) this.categoryInput = canonical;
      window.dispatchEvent(new CustomEvent('nsduh:selection-sync', { detail: this.selections }));
    },
    deleteCategory(name) {
      if (!window.confirm(`Delete category “${name}”? Variables currently in it will move to Uncategorized.`)) return;
      const next = { ...this.selections };
      for (const [key, item] of Object.entries(next)) {
        if (item.mainCategory === name) next[key] = { ...item, mainCategory: 'Uncategorized' };
      }
      this.selections = next;
      persistSelections(next);
      this.categories = this.uniqueCategoryNames(this.categories.filter(item => item !== name).concat(
        Object.values(next).some(item => item.mainCategory === 'Uncategorized') ? ['Uncategorized'] : []
      ));
      persistCategories(this.categories);
      if (this.categoryInput === name) this.categoryInput = '';
      window.dispatchEvent(new CustomEvent('nsduh:selection-sync', { detail: this.selections }));
    },
    removeVariable(id) {
      const key = String(id);
      const x = { ...this.selections };
      delete x[key];
      this.selections = x;
      persistSelections(this.selections);
      window.dispatchEvent(new CustomEvent('nsduh:selection-sync', { detail: this.selections }));
    },
    removeMainCategory(categoryName) {
      const x = { ...this.selections };
      for (const [key, item] of Object.entries(x)) {
        if (item.datasetSlug === this.dataset &&
            String(item.mainCategory || item.codebookCategory || 'Uncategorized').trim() === categoryName) {
          delete x[key];
        }
      }
      this.selections = x;
      persistSelections(this.selections);
      window.dispatchEvent(new CustomEvent('nsduh:selection-sync', { detail: this.selections }));
    },
    clearAll() {
      const x = { ...this.selections };
      for (const [key, item] of Object.entries(x)) {
        if (item.datasetSlug === this.dataset) delete x[key];
      }
      this.selections = x;
      persistSelections(this.selections);
      window.dispatchEvent(new CustomEvent('nsduh:selection-sync', { detail: this.selections }));
    },
    async exportFile(type) {
      if (!this.selectedCount) return alert('Select at least one variable first.');
      const response = await fetch(`/export/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataset: this.dataset, selections: this.currentSelections })
      });
      if (!response.ok) return alert(await response.text());
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nsduh-selected-variables.${type}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };
}

function variableCard(v) {
  return {
    ...v,
    isSelected: false,
    selectedOptionIds: [],
    init() {
      this.loadFromStorage();
      this._syncHandler = (event) => this.applySelections(event.detail || {});
      window.addEventListener('nsduh:selection-sync', this._syncHandler);
    },
    loadFromStorage() { this.applySelections(readSelections()); },
    applySelections(allSelections) {
      const saved = allSelections[String(this.id)] || allSelections[this.id];
      this.isSelected = Boolean(saved && saved.datasetSlug === this.datasetSlug);
      this.selectedOptionIds = this.isSelected && Array.isArray(saved?.optionIds) ? saved.optionIds.map(Number) : [];
    },
    get allOptionsSelected() {
      return this.optionIds.length > 0 && this.selectedOptionIds.length === this.optionIds.length;
    },
    emitSave() {
      const item = {
        variableId: Number(this.id),
        datasetSlug: this.datasetSlug,
        code: this.code,
        label: this.label,
        codebookCategory: this.codebookCategory || 'Uncategorized',
        optionIds: [...this.selectedOptionIds]
      };
      window.dispatchEvent(new CustomEvent('nsduh:save-selection', { detail: item }));
    },
    toggleVariable() {
      if (this.isSelected) {
        this.isSelected = false;
        this.selectedOptionIds = [];
        window.dispatchEvent(new CustomEvent('nsduh:remove-selection', { detail: { variableId: Number(this.id) } }));
      } else {
        this.isSelected = true;
        this.emitSave();
      }
    },
    isOptionSelected(id) { return this.selectedOptionIds.includes(Number(id)); },
    toggleOption(id) {
      id = Number(id);
      let ids = [...this.selectedOptionIds];
      ids = ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
      this.selectedOptionIds = ids;
      this.isSelected = true;
      this.emitSave();
    },
    toggleAllOptions() {
      this.selectedOptionIds = this.allOptionsSelected ? [] : [...this.optionIds.map(Number)];
      this.isSelected = true;
      this.emitSave();
    }
  };
}

function searchResultItem(row) {
  return {
    variableId: Number(row.dataset.variableId),
    datasetSlug: document.getElementById('dataset')?.value || 'NSDUH-2021-DS0001',
    code: row.dataset.variableCode,
    label: row.dataset.variableLabel,
    codebookCategory: row.dataset.codebookCategory || 'Uncategorized',
    optionIds: []
  };
}

function refreshSearchSelectionButtons() {
  const selections = readSelections();
  document.querySelectorAll('#results .result-row').forEach((row) => {
    const item = searchResultItem(row);
    const selected = selections[String(item.variableId)]?.datasetSlug === item.datasetSlug;
    const button = row.querySelector('.search-select-item');
    if (!button) return;
    button.textContent = selected ? '✓ Selected' : 'Select';
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

document.addEventListener('click', (event) => {
  const itemButton = event.target.closest('#results .search-select-item');
  if (itemButton) {
    const row = itemButton.closest('.result-row');
    const item = searchResultItem(row);
    const saved = readSelections()[String(item.variableId)];
    window.dispatchEvent(new CustomEvent(
      saved?.datasetSlug === item.datasetSlug ? 'nsduh:remove-selection' : 'nsduh:save-selection',
      { detail: saved?.datasetSlug === item.datasetSlug ? { variableId: item.variableId } : item }
    ));
    refreshSearchSelectionButtons();
    return;
  }

  if (event.target.closest('#results .search-select-all')) {
    const items = [...document.querySelectorAll('#results .result-row')].map(searchResultItem);
    window.dispatchEvent(new CustomEvent('nsduh:save-selection-batch', { detail: items }));
    refreshSearchSelectionButtons();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowRight') return;
  const results = [...document.querySelectorAll('#results .result-open')];
  if (!results.length) return;

  const currentRow = event.target.closest?.('#results .result-row');
  const current = currentRow?.querySelector('.result-open');
  if (event.target.id !== 'variable-search' && !current) return;
  event.preventDefault();
  (current || results[0]).click();
});

document.body.addEventListener('htmx:afterSwap', (event) => {
  if (event.detail.target?.id === 'results') refreshSearchSelectionButtons();
});

window.addEventListener('nsduh:selection-sync', refreshSearchSelectionButtons);
window.addEventListener('nsduh:save-selection', () => setTimeout(refreshSearchSelectionButtons));
window.addEventListener('nsduh:remove-selection', () => setTimeout(refreshSearchSelectionButtons));

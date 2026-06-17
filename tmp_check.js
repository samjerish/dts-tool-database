
    const TOOLS = ['PROTO RM', 'TOOL RM'];
    const STORAGE_KEY = 'dts_records';
    let activeTool = null;
    let editingRecordId = null;
    let selectedRecordId = null;
    const hasLocalStorage = (() => {
      try {
        const testKey = '__dts_storage_test__';
        localStorage.setItem(testKey, '1');
        localStorage.removeItem(testKey);
        return true;
      } catch (error) {
        return false;
      }
    })();

    const defaultRecords = { 'PROTO RM': [], 'TOOL RM': [] };
    let tableFilterText = '';

    function normalizeRecords(records) {
      if (!records || typeof records !== 'object') return { ...defaultRecords };
      return {
        'PROTO RM': Array.isArray(records['PROTO RM']) ? records['PROTO RM'] : [],
        'TOOL RM': Array.isArray(records['TOOL RM']) ? records['TOOL RM'] : [],
      };
    }

    function generateRecordId() {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
      }
      return `id_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }

    function ensureRecordIds(records) {
      return Object.fromEntries(
        Object.entries(records).map(([tool, list]) => [
          tool,
          list.map(record => ({ ...record, id: record.id || generateRecordId() }))
        ])
      );
    }

    async function initializeRecordsStorage() {
      if (!hasLocalStorage) return;
      const stored = loadRecords();
      saveRecords(stored);

      if (isFirebaseReady()) {
        try {
          await syncRecordsFromFirebase('PROTO RM');
          await syncRecordsFromFirebase('TOOL RM');
        } catch (error) {
          console.warn('Initial Firebase sync failed:', error);
        }
      }
    }

    const formFieldsHtml = `
      <div class="form-group">
        <label>Date</label>
        <input type="date" name="date" required>
      </div>
      <input type="hidden" name="recordId">
      <div class="form-group">
        <label>Part No</label>
        <input type="text" name="partNo" placeholder="Enter part number" required>
      </div>
      <div class="form-group full-width">
        <label>Description</label>
        <textarea name="description" placeholder="Enter description" required></textarea>
      </div>
      <div class="form-group">
        <label>Material</label>
        <input type="text" name="material" placeholder="Enter material" required>
      </div>
      <div class="form-group">
        <label>Qty</label>
        <input type="number" name="qty" placeholder="Enter quantity" min="1" required>
      </div>
      <div class="form-group full-width">
        <label>Customer Name</label>
        <input type="text" name="customerName" placeholder="Enter customer name" required>
      </div>
    `;

    document.getElementById('createFormFields').innerHTML = formFieldsHtml;
    document.getElementById('editFormFields').innerHTML = formFieldsHtml;

    initializeRecordsStorage();

    function loadRecords() {
      if (!hasLocalStorage) return ensureRecordIds({ ...defaultRecords });
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          return ensureRecordIds(normalizeRecords(parsed));
        }
      } catch (error) {
        console.warn('Could not parse stored records:', error);
      }
      return ensureRecordIds({ ...defaultRecords });
    }

    function saveRecords(records) {
      if (!hasLocalStorage) return;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(ensureRecordIds(normalizeRecords(records))));
      } catch (error) {
        console.warn('Could not save records:', error);
      }
    }

    function isFirebaseReady() {
      return window.firebaseFirestore && window.firebaseFirestore.db;
    }

    function normalizeDocId(tool, id) {
      return `${tool.replace(/\s+/g, '_')}_${id}`;
    }

    async function saveRecordToFirebase(tool, record) {
      if (!isFirebaseReady()) return;
      try {
        const recordId = normalizeDocId(tool, record.id);
        await window.firebaseFirestore.setDoc(
          window.firebaseFirestore.doc(window.firebaseFirestore.db, 'records', recordId),
          { ...record, tool, updatedAt: window.firebaseFirestore.serverTimestamp() }
        );
      } catch (error) {
        console.warn('Firebase save failed:', error);
        throw error;
      }
    }

    async function deleteRecordFromFirebase(tool, id) {
      if (!isFirebaseReady()) return;
      try {
        const recordId = normalizeDocId(tool, id);
        await window.firebaseFirestore.deleteDoc(
          window.firebaseFirestore.doc(window.firebaseFirestore.db, 'records', recordId)
        );
      } catch (error) {
        console.warn('Firebase delete failed:', error);
        throw error;
      }
    }

    async function loadFirebaseRecords(tool) {
      if (!isFirebaseReady()) return [];
      const recordsCollection = window.firebaseFirestore.collection(window.firebaseFirestore.db, 'records');
      try {
        const q = window.firebaseFirestore.query(
          recordsCollection,
          window.firebaseFirestore.where('tool', '==', tool),
          window.firebaseFirestore.orderBy('date')
        );
        const snapshot = await window.firebaseFirestore.getDocs(q);
        return snapshot.docs.map(docSnap => docSnap.data());
      } catch (error) {
        console.warn('Firebase query failed, falling back to full collection read:', error);
        try {
          const snapshot = await window.firebaseFirestore.getDocs(recordsCollection);
          return snapshot.docs
            .map(docSnap => docSnap.data())
            .filter(record => record.tool === tool)
            .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
        } catch (fallbackError) {
          console.warn('Firebase fallback read failed:', fallbackError);
          return [];
        }
      }
    }

    async function syncRecordsFromFirebase(tool) {
      if (!tool || !isFirebaseReady()) return;
      const firebaseRecords = await loadFirebaseRecords(tool);
      const localRecords = loadRecords();
      localRecords[tool] = firebaseRecords.map(record => ({
        id: record.id || generateRecordId(),
        date: record.date || '',
        partNo: record.partNo || '',
        description: record.description || '',
        material: record.material || '',
        qty: record.qty || '',
        customerName: record.customerName || ''
      }));
      saveRecords(localRecords);
    }

    async function refreshDashboard() {
      if (!activeTool) return;
      if (isFirebaseReady()) {
        try {
          await syncRecordsFromFirebase(activeTool);
        } catch (error) {
          console.warn('Dashboard sync failed:', error);
        }
      }
      renderTable();
    }

    function getRecordFromForm(form) {
      const formData = new FormData(form);
      return {
        id: formData.get('recordId') || generateRecordId(),
        date: formData.get('date'),
        partNo: formData.get('partNo').trim(),
        description: formData.get('description').trim(),
        material: formData.get('material').trim(),
        qty: formData.get('qty'),
        customerName: formData.get('customerName').trim(),
      };
    }

    function fillForm(form, record) {
      form.recordId.value = record.id;
      form.date.value = record.date;
      form.partNo.value = record.partNo;
      form.description.value = record.description;
      form.material.value = record.material;
      form.qty.value = record.qty;
      form.customerName.value = record.customerName;
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function escapeRegExp(string) {
      return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function highlightText(text, query) {
      if (!query) return escapeHtml(text);
      const escapedText = escapeHtml(text);
      const escapedQuery = escapeRegExp(query.trim());
      if (!escapedQuery) return escapedText;
      const regex = new RegExp(`(${escapedQuery})`, 'gi');
      return escapedText.replace(regex, '<mark>$1</mark>');
    }

    function getFilteredRecords(records) {
      if (!tableFilterText) return records;
      const filter = tableFilterText.toLowerCase();
      return records.filter(r => String(r.partNo).toLowerCase().includes(filter));
    }

    function renderTable() {
      if (!activeTool) return;

      const records = loadRecords();
      const list = getFilteredRecords(records[activeTool] || []);
      const tbody = document.getElementById('modalTableBody');

      if (list.length === 0) {
        const message = tableFilterText ? 'No records match your search.' : 'No records yet. Click Create to add a new entry.';
        tbody.innerHTML = `<tr class="empty-row"><td colspan="7">${message}</td></tr>`;
        return;
      }

      tbody.innerHTML = list.map(r => {
        const isSelected = selectedRecordId === r.id;
        const rowClass = isSelected ? 'selected-row' : '';
        return `
        <tr class="${rowClass}" data-id="${escapeHtml(r.id)}">
          <td>${highlightText(r.date, tableFilterText)}</td>
          <td>${highlightText(r.partNo, tableFilterText)}</td>
          <td class="description-cell">${highlightText(r.description, tableFilterText)}</td>
          <td>${highlightText(r.material, tableFilterText)}</td>
          <td>${highlightText(r.qty, tableFilterText)}</td>
          <td>${highlightText(r.customerName, tableFilterText)}</td>
          <td class="action-cell">
            <div class="action-buttons">
              <button type="button" class="btn-edit" data-id="${escapeHtml(r.id)}">Edit</button>
              <button type="button" class="btn-delete" data-id="${escapeHtml(r.id)}">Delete</button>
            </div>
          </td>
        </tr>
      `;
      }).join('');

      tbody.querySelectorAll('.btn-edit').forEach(button => {
        button.addEventListener('click', () => editRecord(button.dataset.id));
      });
      tbody.querySelectorAll('.btn-delete').forEach(button => {
        button.addEventListener('click', () => confirmRowDelete(button.dataset.id));
      });
      tbody.querySelectorAll('tr[data-id]').forEach(row => {
        row.addEventListener('click', () => {
          selectedRecordId = row.dataset.id;
          renderTable();
        });
      });
    }

    function hideAllViews() {
      document.querySelectorAll('.modal-view').forEach(v => v.classList.add('hidden'));
    }

    async function openModal(toolName) {
      activeTool = toolName;
      document.getElementById('modalTitle').textContent = toolName;
      if (isFirebaseReady()) {
        try {
          await syncRecordsFromFirebase(toolName);
        } catch (error) {
          console.warn('Firebase sync failed on open:', error);
        }
      }
      showDashboardView();
      document.getElementById('toolModal').classList.add('open');
      document.body.style.overflow = 'hidden';
    }

    function closeModal() {
      document.getElementById('toolModal').classList.remove('open');
      document.body.style.overflow = '';
      activeTool = null;
      editingRecordId = null;
      showDashboardView();
    }

    function closeModalOnOverlay(event) {
      if (event.target === event.currentTarget) closeModal();
    }

    function showDashboardView() {
      hideActionPopup();
      hideAllViews();
      document.getElementById('dashboardView').classList.remove('hidden');
      document.getElementById('createForm').reset();
      document.getElementById('editForm').reset();
      document.getElementById('editSearchInput').value = '';
      document.getElementById('editSearchMessage').textContent = '';
      document.getElementById('editSearchMessage').className = 'search-message';
      document.getElementById('tableSearchInput').value = '';
      tableFilterText = '';
      editingRecordId = null;
      renderTable();
    }

    function hideActionPopup() {
      const popup = document.getElementById('actionPopup');
      popup.classList.remove('open');
      popup.classList.add('hidden');
      document.querySelectorAll('#actionPopup .modal-view').forEach(v => v.classList.add('hidden'));
    }

    function closePopupOnOverlay(event) {
      if (event.target === event.currentTarget) hideActionPopup();
    }

    function showActionPopup(viewId, title) {
      document.getElementById('dashboardView').classList.remove('hidden');
      document.querySelectorAll('#actionPopup .modal-view').forEach(v => v.classList.add('hidden'));
      const popup = document.getElementById('actionPopup');
      popup.classList.remove('hidden');
      popup.classList.add('open');
      document.getElementById(viewId).classList.remove('hidden');

      if (viewId === 'createView') {
        document.getElementById('createFormTitle').textContent = title;
        const form = document.getElementById('createForm');
        form.reset();
        form.date.valueAsDate = new Date();
        form.date.readOnly = false;
        form.date.disabled = false;
        form.partNo.readOnly = false;
      }

      if (viewId === 'editSearchView') {
        document.getElementById('editSearchTitle').textContent = title;
        document.getElementById('editSearchInput').value = '';
        document.getElementById('editSearchMessage').textContent = '';
        document.getElementById('editSearchMessage').className = 'search-message';
        editingRecordId = null;
      }

      if (viewId === 'deleteView') {
        document.getElementById('deleteTitle').textContent = title;
        document.getElementById('deleteInput').value = '';
        document.getElementById('deleteMessage').textContent = '';
        document.getElementById('deleteMessage').className = 'search-message';
      }
    }

    function showCreateForm() {
      showActionPopup('createView', `Create — ${activeTool}`);
    }

    function showEditSearch() {
      showActionPopup('editSearchView', `Edit — ${activeTool}`);
    }

    function showDeletePopup() {
      showActionPopup('deleteView', `Delete — ${activeTool}`);
    }

    function searchRecords() {
      tableFilterText = document.getElementById('tableSearchInput').value.trim();
      renderTable();
    }

    function editRecord(id) {
      const record = findRecordById(activeTool, id);
      if (!record) {
        alert(`No record found for that entry in ${activeTool}.`);
        return;
      }
      editingRecordId = record.id;
      selectedRecordId = record.id;
      showActionPopup('editView', `Edit — ${activeTool}`);
      document.getElementById('editFormTitle').textContent = `Edit — ${activeTool} (${record.partNo})`;
      const form = document.getElementById('editForm');
      fillForm(form, record);
      form.date.readOnly = false;
      form.date.disabled = false;
      form.partNo.readOnly = false;
    }

    async function confirmRowDelete(id) {
      const records = loadRecords();
      const list = records[activeTool] || [];
      const index = list.findIndex(r => r.id === id);
      if (index === -1) {
        alert(`No record found for that entry in ${activeTool}.`);
        return;
      }
      const deletedId = list[index].id;
      list.splice(index, 1);
      saveRecords(records);
      if (isFirebaseReady()) {
        try {
          await deleteRecordFromFirebase(activeTool, deletedId);
        } catch (error) {
          alert('Could not delete from Firebase. The record was still deleted locally.');
        }
      }
      await refreshDashboard();
      alert(`Record deleted from ${activeTool}.`);
    }

    async function confirmDelete() {
      const partNo = document.getElementById('deleteInput').value.trim();
      const msg = document.getElementById('deleteMessage');
      if (!partNo) {
        msg.textContent = 'Please enter a Part No to delete.';
        msg.className = 'search-message error';
        return;
      }

      const records = loadRecords();
      const list = records[activeTool] || [];
      const index = list.findIndex(r => r.partNo.toLowerCase() === partNo.toLowerCase());

      if (index === -1) {
        msg.textContent = `No record found with Part No "${partNo}" in ${activeTool}.`;
        msg.className = 'search-message error';
        return;
      }

      const confirmed = window.confirm(`Delete record with Part No "${list[index].partNo}" from ${activeTool}?`);
      if (!confirmed) return;

      const deletedId = list[index].id;
      list.splice(index, 1);
      saveRecords(records);

      if (isFirebaseReady()) {
        try {
          await deleteRecordFromFirebase(activeTool, deletedId);
        } catch (error) {
          alert('Could not delete from Firebase. The record was still deleted locally.');
        }
      }

      hideActionPopup();
      await refreshDashboard();
      alert(`Record with Part No "${partNo}" deleted from ${activeTool}.`);
    }

    function findRecord(tool, partNo) {
      const records = loadRecords();
      const list = records[tool] || [];
      return list.find(r => r.partNo.toLowerCase() === partNo.trim().toLowerCase());
    }

    function findRecordById(tool, id) {
      const records = loadRecords();
      const list = records[tool] || [];
      return list.find(r => r.id === id);
    }

    function searchForEdit() {
      const partNo = document.getElementById('editSearchInput').value.trim();
      const msg = document.getElementById('editSearchMessage');

      if (!partNo) {
        msg.textContent = 'Please enter a part number.';
        msg.className = 'search-message error';
        return;
      }

      const record = findRecord(activeTool, partNo);
      if (!record) {
        msg.textContent = `No record found with Part No "${partNo}" in ${activeTool}.`;
        msg.className = 'search-message error';
        return;
      }

      editingRecordId = record.id;
      hideAllViews();
      document.getElementById('editView').classList.remove('hidden');
      document.getElementById('editFormTitle').textContent = `Edit — ${activeTool} (${record.partNo})`;
      const form = document.getElementById('editForm');
      fillForm(form, record);
      form.partNo.readOnly = false;
    }

    async function submitCreate(event) {
      event.preventDefault();
      const record = getRecordFromForm(event.target);
      const records = loadRecords();

      // Duplicate part numbers are allowed; each record is independent.
      record.id = record.id || generateRecordId();
      records[activeTool].push(record);
      saveRecords(records);

      if (isFirebaseReady()) {
        try {
          await saveRecordToFirebase(activeTool, record);
        } catch (error) {
          alert('Could not save to Firebase. Your data is still saved locally.');
        }
      }

      await refreshDashboard();
      showDashboardView();
    }

    async function submitEdit(event) {
      event.preventDefault();
      const updated = getRecordFromForm(event.target);
      const records = loadRecords();
      const list = records[activeTool];
      const index = list.findIndex(r => r.id === editingRecordId);

      if (index === -1) {
        alert('Record not found. It may have been removed.');
        showEditSearch();
        return;
      }

      list[index] = updated;
      saveRecords(records);

      if (isFirebaseReady()) {
        try {
          await saveRecordToFirebase(activeTool, updated);
        } catch (error) {
          alert('Could not update Firebase. Your changes are still saved locally.');
        }
      }

      await refreshDashboard();
      showDashboardView();
    }

    function exportRecordsAsExcel(records, sheetName) {
      const headers = ['Date', 'Part No', 'Description', 'Material', 'Qty', 'Customer Name'];
      const rows = records.map(r => [r.date, r.partNo, r.description, r.material, r.qty, r.customerName]);
      const csvContent = [headers, ...rows]
        .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${sheetName.replace(/\s+/g, '_')}_records.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    async function handleAction(action) {
      if (!activeTool) return;

      if (action === 'Delete') {
        const partNo = window.prompt(`Enter Part No to delete from ${activeTool}:`);
        if (!partNo) return;

        const records = loadRecords();
        const list = records[activeTool] || [];
        const index = list.findIndex(r => r.partNo.toLowerCase() === partNo.trim().toLowerCase());

        if (index === -1) {
          alert(`No record found with Part No "${partNo}" in ${activeTool}.`);
          return;
        }

        const confirmed = window.confirm(`Delete record with Part No "${list[index].partNo}" from ${activeTool}?`);
        if (!confirmed) return;

        const deletedId = list[index].id;
        list.splice(index, 1);
        saveRecords(records);

        if (isFirebaseReady()) {
          try {
            await deleteRecordFromFirebase(activeTool, deletedId);
          } catch (error) {
            alert('Could not delete from Firebase. The record was still deleted locally.');
          }
        }

        renderTable();
        alert(`Record with Part No "${partNo.trim()}" deleted from ${activeTool}.`);
        return;
      }

      if (action === 'Report') {
        const records = loadRecords();
        const list = getFilteredRecords(records[activeTool] || []);

        if (!list.length) {
          alert(`No records to download for ${activeTool}.`);
          return;
        }

        exportRecordsAsExcel(list, activeTool);
        return;
      }

      console.log(`${action} clicked for ${activeTool}`);
    }

    document.getElementById('editSearchInput').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        searchForEdit();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeModal();
    });
  
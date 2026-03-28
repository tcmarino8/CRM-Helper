// popup.js (manual entry with auto URL)

document.addEventListener('DOMContentLoaded', function() {
  const DEFAULT_API_BASE = 'http://127.0.0.1:8000';
  const DEFAULT_SDR_ID = 'sdr1';
  const DEFAULT_SDR_NAME = 'SDR1';
  const SEARCH_DEBOUNCE_MS = 250;

  const apiBaseInput = document.getElementById('apiBase');
  const sdrIdInput = document.getElementById('sdrId');
  const sdrNameInput = document.getElementById('sdrName');
  const settingsStatus = document.getElementById('settingsStatus');
  const linkedinUrlInput = document.getElementById('linkedinUrl');
  const urlStatus = document.getElementById('urlStatus');
  const apiStatus = document.getElementById('apiStatus');
  const nameInput = document.getElementById('name');
  const headlineInput = document.getElementById('headline');
  const companyInput = document.getElementById('company');
  const existingCompanyIdInput = document.getElementById('existingCompanyId');
  const companyStatus = document.getElementById('companyStatus');
  const companyResults = document.getElementById('companyResults');
  const selectedCompanyEl = document.getElementById('selectedCompany');
  const locationInput = document.getElementById('location');
  const datesInput = document.getElementById('dates');
  const emailInput = document.getElementById('email');
  const phoneInput = document.getElementById('phone');
  const categorySelect = document.getElementById('category');
  const directionSelect = document.getElementById('direction');
  const messageInput = document.getElementById('message');
  const saveBtn = document.getElementById('saveManualBtn');
  let selectedCompany = null;
  let searchTimer = null;

  const formFields = {
    apiBase: apiBaseInput,
    sdrId: sdrIdInput,
    sdrName: sdrNameInput,
    pageUrl: linkedinUrlInput,
    name: nameInput,
    headline: headlineInput,
    company: companyInput,
    existingCompanyId: existingCompanyIdInput,
    location: locationInput,
    currentRoleDates: datesInput,
    email: emailInput,
    phone: phoneInput,
    category: categorySelect,
    direction: directionSelect,
    message: messageInput
  };

  // Load draft from storage
  chrome.storage.local.get('crmhelperDraft', (res) => {
    const draft = res.crmhelperDraft || {};
    if (!draft.apiBase) draft.apiBase = DEFAULT_API_BASE;
    if (!draft.sdrId) draft.sdrId = DEFAULT_SDR_ID;
    if (!draft.sdrName) draft.sdrName = DEFAULT_SDR_NAME;

    Object.entries(formFields).forEach(([key, input]) => {
      if (draft[key] !== undefined && draft[key] !== null) input.value = draft[key];
    });

    if (draft.existingCompanyId && draft.company) {
      selectedCompany = {
        company_id: draft.existingCompanyId,
        name: draft.company,
        full_name: draft.fullName || draft.company,
        hq: draft.companyHq || '',
        website: draft.companyWebsite || '',
        asset_classes: draft.companyAssetClasses || []
      };
      renderSelectedCompany();
    }

    updateSettingsStatus();
  });

  // Try to prefill the LinkedIn URL from the active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs.length && tabs[0].url && tabs[0].url.includes('linkedin.com')) {
      linkedinUrlInput.value = tabs[0].url;
      urlStatus.textContent = 'URL auto-filled from active tab';
    } else {
      urlStatus.textContent = 'Not on LinkedIn tab. You can paste a URL if needed.';
      linkedinUrlInput.removeAttribute('readonly');
    }
  });

  saveBtn.addEventListener('click', () => {
    const data = {
      pageUrl: linkedinUrlInput.value.trim(),
      name: nameInput.value.trim(),
      headline: headlineInput.value.trim(),
      company: companyInput.value.trim(),
      existingCompanyId: existingCompanyIdInput.value.trim(),
      apiBase: apiBaseInput.value.trim(),
      sdrId: sdrIdInput.value.trim(),
      sdrName: sdrNameInput.value.trim(),
      location: locationInput.value.trim(),
      currentRoleDates: datesInput.value.trim(),
      email: emailInput.value.trim(),
      phone: phoneInput.value.trim(),
      category: categorySelect.value,
      direction: directionSelect.value,
      message: messageInput.value.trim(),
      source: 'manual-entry'
    };

    // push to backend then store locally
    pushToBackend(data)
      .then(() => {
        chrome.runtime.sendMessage({ type: 'form_capture', data }, () => {
          alert('Saved');
          const settingsDraft = {
            apiBase: apiBaseInput.value.trim(),
            sdrId: sdrIdInput.value.trim(),
            sdrName: sdrNameInput.value.trim()
          };
          chrome.storage.local.set({ crmhelperDraft: settingsDraft });
          Object.entries(formFields).forEach(([key, input]) => {
            if (['apiBase', 'sdrId', 'sdrName', 'pageUrl'].includes(key)) return;
            input.value = '';
          });
          clearSelectedCompany(false);
          renderSearchResults([]);
          loadCaptured();
        });
      })
      .catch((err) => {
        console.warn('Backend error', err);
        apiStatus.textContent = 'Backend error: ' + err.message;
      });
  });

  // Autosave draft on input changes
  const saveDraft = () => {
    const draft = {};
    Object.entries(formFields).forEach(([key, input]) => {
      draft[key] = input.value;
    });
    if (selectedCompany) {
      draft.fullName = selectedCompany.full_name || '';
      draft.companyHq = selectedCompany.hq || '';
      draft.companyWebsite = selectedCompany.website || '';
      draft.companyAssetClasses = selectedCompany.asset_classes || [];
    }
    chrome.storage.local.set({ crmhelperDraft: draft });
  };

  Object.values(formFields).forEach((input) => {
    input.addEventListener('input', saveDraft);
  });

  [apiBaseInput, sdrIdInput, sdrNameInput].forEach((input) => {
    input.addEventListener('input', updateSettingsStatus);
    input.addEventListener('blur', updateSettingsStatus);
  });

  companyInput.addEventListener('input', () => {
    const typedValue = companyInput.value.trim();
    if (selectedCompany && typedValue !== selectedCompany.name) {
      clearSelectedCompany();
    }

    if (searchTimer) {
      clearTimeout(searchTimer);
    }

    if (typedValue.length < 2) {
      companyStatus.textContent = 'Type at least 2 letters to search imported companies.';
      renderSearchResults([]);
      return;
    }

    companyStatus.textContent = 'Searching imported companies...';
    searchTimer = setTimeout(() => {
      searchCompanies(typedValue);
    }, SEARCH_DEBOUNCE_MS);
  });

  function loadCaptured() {
    chrome.runtime.sendMessage({ type: 'get_captured_requests' }, (response) => {
      const requestsDiv = document.getElementById('requests');
      if (response && response.requests && response.requests.length) {
        requestsDiv.innerHTML = '';
        response.requests.slice().reverse().forEach((req, idx) => {
          const div = document.createElement('div');
          div.className = 'request';
          const dataHtml = Object.entries(req.data)
            .map(([k, v]) => `<strong>${k}:</strong> ${String(v).slice(0, 200)}`)
            .join('<br>');
          div.innerHTML = `
            <div class="request-title">Capture #${response.requests.length - idx}</div>
            <div class="request-details">Time: ${req.time}</div>
            <div class="request-data">${dataHtml}</div>
          `;
          requestsDiv.appendChild(div);
        });
      } else {
        requestsDiv.innerHTML = '<em>No captured data yet.</em>';
      }
    });
  }

  loadCaptured();

  function slugFromUrl(url) {
    try {
      const u = new URL(url);
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length) return 'li:' + parts[parts.length - 1];
    } catch (e) {
      return 'li:unknown';
    }
    return 'li:unknown';
  }

  function companyId(company) {
    return company ? 'co:' + company.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'co:unknown';
  }

  function apiBase() {
    const value = apiBaseInput.value.trim();
    return (value || DEFAULT_API_BASE).replace(/\/$/, '');
  }

  function currentSdrId() {
    return sdrIdInput.value.trim() || DEFAULT_SDR_ID;
  }

  function currentSdrName() {
    return sdrNameInput.value.trim() || DEFAULT_SDR_NAME;
  }

  function updateSettingsStatus() {
    settingsStatus.textContent = `Backend: ${apiBase()} | SDR: ${currentSdrName()} (${currentSdrId()})`;
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }

  function renderSearchResults(companies) {
    if (!companies || companies.length === 0) {
      companyResults.innerHTML = '';
      companyResults.style.display = 'none';
      return;
    }

    companyResults.innerHTML = '';
    companyResults.style.display = 'block';
    companies.forEach((company) => {
      const item = document.createElement('div');
      item.className = 'search-result';
      item.innerHTML = `
        <div class="search-result-name">${escapeHtml(company.name || company.full_name || company.company_id)}</div>
        <div class="search-result-meta">${escapeHtml(company.full_name || '')}</div>
        <div class="search-result-meta">${escapeHtml([company.hq, company.website].filter(Boolean).join(' • '))}</div>
      `;
      item.addEventListener('click', () => {
        selectedCompany = company;
        existingCompanyIdInput.value = company.company_id || '';
        companyInput.value = company.name || company.full_name || '';
        renderSelectedCompany();
        renderSearchResults([]);
        companyStatus.textContent = 'Linked to imported company.';
        saveDraft();
      });
      companyResults.appendChild(item);
    });
  }

  function renderSelectedCompany() {
    if (!selectedCompany) {
      selectedCompanyEl.style.display = 'none';
      selectedCompanyEl.innerHTML = '';
      return;
    }

    const assetClasses = Array.isArray(selectedCompany.asset_classes)
      ? selectedCompany.asset_classes.join(', ')
      : '';
    selectedCompanyEl.style.display = 'block';
    selectedCompanyEl.innerHTML = `
      <strong>Selected company:</strong><br>
      ${escapeHtml(selectedCompany.name || selectedCompany.full_name || selectedCompany.company_id)}<br>
      ${escapeHtml(selectedCompany.full_name || '')}<br>
      ${escapeHtml([selectedCompany.hq, selectedCompany.website].filter(Boolean).join(' • '))}
      ${assetClasses ? `<br>${escapeHtml(assetClasses)}` : ''}
    `;
  }

  function clearSelectedCompany(save = true) {
    selectedCompany = null;
    existingCompanyIdInput.value = '';
    selectedCompanyEl.style.display = 'none';
    selectedCompanyEl.innerHTML = '';
    companyStatus.textContent = 'No imported company selected. A new company will be created from the typed name.';
    if (save) {
      saveDraft();
    }
  }

  async function searchCompanies(query) {
    try {
      const response = await fetch(`${apiBase()}/graph/companies/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) {
        const details = await response.text();
        throw new Error(`search failed: ${response.status} ${details}`);
      }
      const payload = await response.json();
      const companies = payload.companies || [];
      companyStatus.textContent = companies.length
        ? 'Select an imported company or keep typing to create a new one.'
        : 'No imported company matches. Saving will create a new company from the typed name.';
      renderSearchResults(companies);
    } catch (error) {
      companyStatus.textContent = 'Company search unavailable. Manual company entry still works.';
      renderSearchResults([]);
      console.warn('Company search failed', error);
    }
  }

  async function pushToBackend(data) {
    if (!data.apiBase) {
      throw new Error('Backend URL is required.');
    }
    if (!data.sdrId) {
      throw new Error('SDR ID is required.');
    }
    if (!data.sdrName) {
      throw new Error('SDR name is required.');
    }

    apiStatus.textContent = 'Sending to backend...';
    const receiverId = slugFromUrl(data.pageUrl);
    const convId = `conv-${receiverId}`;
    const msgId = `msg-${Date.now()}`;

    const outbound = data.direction !== 'prospect_to_sdr';
    const senderId = outbound ? data.sdrId : receiverId;
    const senderName = outbound ? data.sdrName : (data.name || receiverId);
    const recvId = outbound ? receiverId : data.sdrId;
    const recvName = outbound ? (data.name || receiverId) : data.sdrName;
    const isReply = !outbound;

    // 1) Upsert Person + Company
    const personBody = {
      person_id: receiverId,
      person_name: data.name || receiverId,
      person_headline: data.headline || null,
      person_profile_url: data.pageUrl || null,
      company_id: data.existingCompanyId ? null : companyId(data.company),
      existing_company_id: data.existingCompanyId || null,
      company_name: data.company || 'Unknown',
      category: data.category || null
    };

    // 2) Message from SDR to prospect
    const messageBody = {
      conversation_id: convId,
      message_id: msgId,
      sender_id: senderId,
      receiver_id: recvId,
      text: data.message || '',
      timestamp: new Date().toISOString(),
      platform: 'linkedin',
      is_reply: isReply,
      sender_name: senderName,
      receiver_name: recvName,
      category: data.category || null
    };

    const headers = { 'Content-Type': 'application/json' };

    // Fire requests sequentially for clarity
    const res1 = await fetch(`${apiBase()}/graph/test/person_company`, {
      method: 'POST', headers, body: JSON.stringify(personBody)
    });
    if (!res1.ok) throw new Error(`person_company failed: ${res1.status}`);

    const res2 = await fetch(`${apiBase()}/graph/test/message`, {
      method: 'POST', headers, body: JSON.stringify(messageBody)
    });
    if (!res2.ok) throw new Error(`message failed: ${res2.status}`);

    apiStatus.textContent = 'Sent to backend';
  }
});

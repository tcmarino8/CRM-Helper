// popup.js (manual entry with auto URL)

document.addEventListener('DOMContentLoaded', function() {
  const DEFAULT_API_BASE = 'http://127.0.0.1:8000';
  const DEFAULT_SDR_ID = 'sdr1';
  const DEFAULT_SDR_NAME = 'SDR1';
  const SEARCH_DEBOUNCE_MS = 250;
  const QUICK_DEFAULT_TEMPLATE = 'Hi {{name}},\n\nI wanted to reach out with a quick idea that could be helpful for your team. Open to a short 10-minute chat this week?';
  const QUICK_TEMPLATES = {
    short_intro: 'Hi {{name}},\n\nI came across your profile and wanted to connect. If helpful, I can share how teams like yours are improving outreach conversion with less manual work.',
    value_first: 'Hi {{name}},\n\nWe help teams turn outreach and conversation data into clear next actions. If useful, I can send a quick summary tailored to your company.',
    quick_call: 'Hi {{name}},\n\nWould you be open to a quick 10-minute call this week to see if this could support your workflow?'
  };

  const apiBaseInput = document.getElementById('apiBase');
  const sdrIdInput = document.getElementById('sdrId');
  const sdrNameInput = document.getElementById('sdrName');
  const settingsStatus = document.getElementById('settingsStatus');
  const linkedinUrlInput = document.getElementById('linkedinUrl');
  const outreachChannelInput = document.getElementById('outreachChannel');
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
  const refreshProspectsBtn = document.getElementById('refreshProspectsBtn');
  const quickStatus = document.getElementById('quickStatus');
  const quickEntityType = document.getElementById('quickEntityType');
  const quickTargetSelect = document.getElementById('quickTargetSelect');
  const copyTargetBtn = document.getElementById('copyTargetBtn');
  const applyTargetBtn = document.getElementById('applyTargetBtn');
  const quickTemplatePreset = document.getElementById('quickTemplatePreset');
  const quickTemplateInput = document.getElementById('quickTemplateInput');
  const quickMessageOutput = document.getElementById('quickMessageOutput');
  const copyMessageBtn = document.getElementById('copyMessageBtn');
  const useMessageBtn = document.getElementById('useMessageBtn');
  const hasQuickUi = [
    refreshProspectsBtn,
    quickStatus,
    quickEntityType,
    quickTargetSelect,
    copyTargetBtn,
    applyTargetBtn,
    quickTemplatePreset,
    quickTemplateInput,
    quickMessageOutput,
    copyMessageBtn,
    useMessageBtn
  ].every(Boolean);
  let selectedCompany = null;
  let searchTimer = null;
  let unreachedProspects = [];
  let quickTargets = [];

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

    if (hasQuickUi) {
      quickEntityType.value = draft.quickEntityType || 'person';
      quickTemplatePreset.value = draft.quickTemplatePreset || 'custom';
      quickTemplateInput.value = draft.quickTemplateInput || QUICK_DEFAULT_TEMPLATE;
    }

    updateOutreachChannel();
    updateSettingsStatus();
    if (hasQuickUi) {
      renderQuickTargets();
      restoreQuickTargetSelection(draft.quickTargetValue || '');
      updateQuickMessagePreview();
    }
  });

  // Try to prefill the LinkedIn URL from the active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs.length && tabs[0].url && tabs[0].url.includes('linkedin.com')) {
      linkedinUrlInput.value = tabs[0].url;
      urlStatus.textContent = 'URL auto-filled from active tab';
    } else {
      linkedinUrlInput.value = tabs && tabs.length && tabs[0].url ? tabs[0].url : '';
      urlStatus.textContent = 'Not on LinkedIn tab. You can paste a URL if needed.';
      linkedinUrlInput.removeAttribute('readonly');
    }
    updateOutreachChannel();
  });

  linkedinUrlInput.addEventListener('input', updateOutreachChannel);

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
      outreachChannel: inferOutreachChannel(linkedinUrlInput.value.trim()),
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
    if (hasQuickUi) {
      draft.quickEntityType = quickEntityType.value;
      draft.quickTemplatePreset = quickTemplatePreset.value;
      draft.quickTemplateInput = quickTemplateInput.value;
      draft.quickTargetValue = quickTargetSelect.value;
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

  if (hasQuickUi) {
    refreshProspectsBtn.addEventListener('click', () => {
      refreshUnreachedProspects();
    });

    quickEntityType.addEventListener('change', () => {
      renderQuickTargets();
      updateQuickMessagePreview();
      saveDraft();
    });

    quickTargetSelect.addEventListener('change', () => {
      updateQuickMessagePreview();
      saveDraft();
    });

    quickTemplatePreset.addEventListener('change', () => {
      const presetValue = quickTemplatePreset.value;
      if (presetValue !== 'custom' && QUICK_TEMPLATES[presetValue]) {
        quickTemplateInput.value = QUICK_TEMPLATES[presetValue];
      }
      updateQuickMessagePreview();
      saveDraft();
    });

    quickTemplateInput.addEventListener('input', () => {
      quickTemplatePreset.value = 'custom';
      updateQuickMessagePreview();
      saveDraft();
    });

    copyTargetBtn.addEventListener('click', async () => {
      const target = selectedQuickTarget();
      if (!target) {
        quickStatus.textContent = 'Select a target first.';
        return;
      }
      const textToCopy = quickEntityType.value === 'company' ? target.company_name : target.person_name;
      if (!textToCopy) {
        quickStatus.textContent = 'No name available for this target.';
        return;
      }
      const ok = await copyToClipboard(textToCopy);
      quickStatus.textContent = ok
        ? `Copied ${quickEntityType.value === 'company' ? 'company' : 'person'} name.`
        : 'Clipboard copy failed. Please copy manually from the dropdown.';
    });

    applyTargetBtn.addEventListener('click', () => {
      const target = selectedQuickTarget();
      if (!target) {
        quickStatus.textContent = 'Select a target first.';
        return;
      }
      if (quickEntityType.value === 'company') {
        companyInput.value = target.company_name || '';
        clearSelectedCompany();
        companyStatus.textContent = 'Company filled from unreached list.';
      } else {
        nameInput.value = target.person_name || '';
        if (target.company_name) {
          companyInput.value = target.company_name;
          clearSelectedCompany();
        }
        if (target.contact_email) {
          emailInput.value = target.contact_email;
        }
      }
      updateQuickMessagePreview();
      saveDraft();
      quickStatus.textContent = 'Profile form updated from selected target.';
    });

    copyMessageBtn.addEventListener('click', async () => {
      const message = quickMessageOutput.value.trim();
      if (!message) {
        quickStatus.textContent = 'No generated message to copy.';
        return;
      }
      const ok = await copyToClipboard(message);
      quickStatus.textContent = ok
        ? 'Personalized message copied to clipboard.'
        : 'Clipboard copy failed. Please copy from the message box.';
    });

    useMessageBtn.addEventListener('click', () => {
      const message = quickMessageOutput.value.trim();
      if (!message) {
        quickStatus.textContent = 'No generated message to use.';
        return;
      }
      messageInput.value = message;
      saveDraft();
      quickStatus.textContent = 'Main message field updated.';
    });
  }

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
  if (hasQuickUi) {
    refreshUnreachedProspects();
  }

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

  function inferOutreachChannel(url) {
    return String(url || '').toLowerCase().includes('linkedin') ? 'linkedin' : 'email';
  }

  function updateOutreachChannel() {
    outreachChannelInput.value = inferOutreachChannel(linkedinUrlInput.value.trim());
  }

  function personIdFromData(data) {
    if (data.outreachChannel === 'email') {
      const email = data.email.trim().toLowerCase();
      if (!email) {
        throw new Error('Email is required for email outreach.');
      }
      return `email:${email}`;
    }
    return slugFromUrl(data.pageUrl);
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

  function normalizeDisplayName(value) {
    return String(value || '').trim();
  }

  function selectedQuickTarget() {
    if (!quickTargetSelect.value) {
      return null;
    }
    const idx = Number(quickTargetSelect.value);
    if (!Number.isInteger(idx) || idx < 0 || idx >= quickTargets.length) {
      return null;
    }
    return quickTargets[idx];
  }

  function renderQuickTargets() {
    const mode = quickEntityType.value;
    const targetMap = new Map();

    if (mode === 'company') {
      unreachedProspects.forEach((row) => {
        const companyName = normalizeDisplayName(row.company_name);
        if (!companyName) {
          return;
        }
        const key = companyName.toLowerCase();
        if (!targetMap.has(key)) {
          targetMap.set(key, {
            company_name: companyName,
            person_name: row.person_name || '',
            contact_email: row.contact_email || ''
          });
        }
      });
      quickTargets = Array.from(targetMap.values()).sort((a, b) => a.company_name.localeCompare(b.company_name));
    } else {
      unreachedProspects.forEach((row) => {
        const personName = normalizeDisplayName(row.person_name);
        if (!personName) {
          return;
        }
        const key = `${personName.toLowerCase()}|${String(row.company_name || '').toLowerCase()}`;
        if (!targetMap.has(key)) {
          targetMap.set(key, {
            person_name: personName,
            company_name: row.company_name || '',
            contact_email: row.contact_email || ''
          });
        }
      });
      quickTargets = Array.from(targetMap.values()).sort((a, b) => a.person_name.localeCompare(b.person_name));
    }

    quickTargetSelect.innerHTML = '';
    if (quickTargets.length === 0) {
      const emptyOption = document.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = mode === 'company'
        ? 'No unreached company names found'
        : 'No unreached person names found';
      quickTargetSelect.appendChild(emptyOption);
      updateQuickMessagePreview();
      return;
    }

    quickTargets.forEach((target, idx) => {
      const option = document.createElement('option');
      option.value = String(idx);
      if (mode === 'company') {
        option.textContent = target.company_name;
      } else {
        option.textContent = target.company_name
          ? `${target.person_name} (${target.company_name})`
          : target.person_name;
      }
      quickTargetSelect.appendChild(option);
    });

    quickTargetSelect.selectedIndex = 0;
    updateQuickMessagePreview();
  }

  function restoreQuickTargetSelection(previousValue) {
    if (!previousValue || quickTargets.length === 0) {
      return;
    }
    const candidate = Number(previousValue);
    if (Number.isInteger(candidate) && candidate >= 0 && candidate < quickTargets.length) {
      quickTargetSelect.value = String(candidate);
    }
  }

  function personalizeTemplate(template, name) {
    const normalizedTemplate = template && template.trim() ? template : QUICK_DEFAULT_TEMPLATE;
    const displayName = normalizeDisplayName(name) || 'there';
    return normalizedTemplate
      .replace(/\{\{\s*name\s*\}\}/gi, displayName)
      .replace(/\{name\}/gi, displayName);
  }

  function updateQuickMessagePreview() {
    const target = selectedQuickTarget();
    const nameForMessage = target
      ? (quickEntityType.value === 'company' ? target.company_name : target.person_name)
      : '';
    quickMessageOutput.value = personalizeTemplate(quickTemplateInput.value, nameForMessage);
  }

  async function copyToClipboard(value) {
    const text = String(value || '');
    if (!text) {
      return false;
    }

    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      const fallback = document.createElement('textarea');
      fallback.value = text;
      fallback.style.position = 'fixed';
      fallback.style.opacity = '0';
      document.body.appendChild(fallback);
      fallback.focus();
      fallback.select();
      let success = false;
      try {
        success = document.execCommand('copy');
      } catch (copyError) {
        success = false;
      }
      document.body.removeChild(fallback);
      return success;
    }
  }

  async function refreshUnreachedProspects() {
    try {
      quickStatus.textContent = 'Loading unreached prospects...';
      const response = await fetch(`${apiBase()}/graph/prospects/unreached?limit=500`);
      if (!response.ok) {
        let details = await response.text();
        try {
          const parsed = JSON.parse(details);
          if (parsed && parsed.detail) {
            details = parsed.detail;
          }
        } catch (parseError) {
          // Keep original text when response is not JSON.
        }
        throw new Error(`load failed (${response.status}): ${details}`);
      }
      const payload = await response.json();
      unreachedProspects = Array.isArray(payload.prospects) ? payload.prospects : [];
      renderQuickTargets();
      quickStatus.textContent = unreachedProspects.length
        ? `Loaded ${unreachedProspects.length} unreached prospects.`
        : 'No unreached prospects found.';
      saveDraft();
    } catch (error) {
      unreachedProspects = [];
      renderQuickTargets();
      quickStatus.textContent = `Could not load unreached prospects. ${error.message || 'Check backend URL and API health.'}`;
      console.warn('Unreached prospects load failed', error);
    }
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
  const receiverId = personIdFromData(data);
    const convId = `conv-${receiverId}`;
    const msgId = `msg-${Date.now()}`;

    const outbound = data.direction !== 'prospect_to_sdr';
    const senderId = outbound ? data.sdrId : receiverId;
    const senderName = outbound ? data.sdrName : (data.name || receiverId);
    const recvId = outbound ? receiverId : data.sdrId;
    const recvName = outbound ? (data.name || receiverId) : data.sdrName;
    const isReply = !outbound;
    const lastOutreachAt = new Date().toISOString();

    // 1) Upsert Person + Company
    const personBody = {
      person_id: receiverId,
      person_name: data.name || receiverId,
      person_headline: data.headline || null,
      person_profile_url: data.outreachChannel === 'linkedin' ? (data.pageUrl || null) : null,
      contact_email: data.email || null,
      outreach_status: 'reached',
      outreach_channel: data.outreachChannel,
      outreach_source: data.source,
      last_outreach_at: lastOutreachAt,
      company_id: data.existingCompanyId ? null : companyId(data.company),
      existing_company_id: data.existingCompanyId || null,
      company_name: data.company || 'Unknown',
      company_website: selectedCompany ? (selectedCompany.website || null) : null,
      company_full_name: selectedCompany ? (selectedCompany.full_name || selectedCompany.name || null) : null,
      category: data.category || null
    };

    // 2) Message from SDR to prospect
    const messageBody = {
      conversation_id: convId,
      message_id: msgId,
      sender_id: senderId,
      receiver_id: recvId,
      text: data.message || '',
      timestamp: lastOutreachAt,
      platform: data.outreachChannel,
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

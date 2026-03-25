---
name: Chrome extension connection-request capture
overview: Add a Chrome extension that runs on LinkedIn profile pages, captures the "Add a note to your invitation" modal (profile + note), and sends both to your backend in one request so every connection request is tracked in Neo4j without extra steps.
todos: []
isProject: false
---

# Chrome Extension: LinkedIn Connection Request → Neo4j

## Goal

When you send a connection request with a personal note on LinkedIn (modal in your screenshot), the extension captures **profile + note in one** and sends them to your API so the graph gets: Person (prospect), Conversation (you ↔ prospect), and Message (your invitation note). One click on "Send" = tracked in CRM.

## Architecture

```mermaid
sequenceDiagram
  participant User
  participant LinkedIn
  participant ContentScript
  participant Backend
  participant Neo4j

  User->>LinkedIn: Opens profile, clicks Connect, adds note, clicks Send
  LinkedIn->>ContentScript: Modal visible (we observe DOM)
  User->>LinkedIn: Clicks Send
  ContentScript->>ContentScript: Read note + scrape profile from page
  ContentScript->>Backend: POST /ingest/connection_request
  Backend->>Neo4j: MERGE Person, Conversation; CREATE Message
  ContentScript->>LinkedIn: Let Send proceed (no preventDefault)
  LinkedIn->>User: Request sent
```



- **Preferred flow:** Intercept the Send button on the "Add a note to your invitation" modal. On click: (1) read note from the modal textarea, (2) read profile from the current page (URL + DOM: name, headline, location), (3) POST profile + note to backend, (4) let LinkedIn’s Send complete. User does nothing extra.
- **Fallback:** If the modal DOM is hard to hook (e.g. shadow DOM or heavy React), add a small "Save to CRM" control in the extension (popup or content-injected button) so you can send profile + note in one action after pasting the note or opening the modal.

## 1. Backend: single endpoint for “profile + note in one”

Add `**POST /ingest/connection_request**` so the extension can send one payload and the backend creates Person, Conversation, and Message.

- **Location:** [backend/main.py](backend/main.py) (new Pydantic model + route; reuse existing graph Cypher pattern from `create_test_message`).
- **Payload (JSON):**
  - `sdr_id`, `sdr_name` (you; from extension settings, e.g. `"sdr1"`, `"SDR1"`).
  - `profile_url` (e.g. `https://www.linkedin.com/in/erayferah/`).
  - `profile_name`, `headline`, `location` (optional; from profile page).
  - `note_text` (the invitation note from the modal).
- **Backend behavior:**
  - Derive **receiver `person_id**` from `profile_url` (e.g. path segment `erayferah` → `li:erayferah`).
  - Derive `**conversation_id**` from `sdr_id` + receiver id (e.g. `conv_sdr1_erayferah`).
  - Generate `**message_id**` (e.g. `msg_sdr1_erayferah_<short_ts>` or UUID).
  - Call the same graph logic as today: MERGE sender Person (sdr_id), MERGE receiver Person, MERGE Conversation, CREATE Message (text = note, is_reply = false), SENT/RECEIVED/PART_OF. No PDF, no `response_type` for this flow.
- **Response:** 200 + `{ "message_id": "...", "person_id": "...", "conversation_id": "..." }` so the extension can show “Saved to CRM” if desired.

This keeps “profile first, then message” as an internal implementation detail; from the user’s perspective it’s “message and profile in one” via a single API call.

## 2. Chrome extension layout

- **Directory:** `extension/` at project root (next to `backend/`, `dashboard/`).
- **Manifest V3** so it’s future-proof and passes the Chrome Web Store bar.

**Files:**


| File                                       | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest.json`                            | Manifest V3: host permissions for `*://*.linkedin.com/*`, content_scripts for profile pages, optional storage.                                                                                                                                                                                                                                                                                                                      |
| `content.js`                               | Injected on LinkedIn profile pages (`/in/*`). Finds the invitation modal (e.g. by aria-label or button text "Send"), observes the modal’s Send button and the note textarea; on Send click, reads note + scrapes profile (URL + DOM), reads API base URL and sdr_id from `chrome.storage.local`, POSTs to `POST /ingest/connection_request`, then lets the click propagate. Optional: show a small toast “Saved to CRM” on success. |
| `popup.html` + `popup.js`                  | Popup for first-time setup: API base URL (default `http://127.0.0.1:8000`) and SDR id/name. Save to `chrome.storage.local`. Shown when user clicks the extension icon.                                                                                                                                                                                                                                                              |
| Optional: `background.js` (service worker) | Only if needed later (e.g. to avoid CORS by proxying through the extension). With your backend CORS open, content script can `fetch()` the API directly.                                                                                                                                                                                                                                                                            |


**Content script strategy:**

- **Match pattern:** `*://www.linkedin.com/in/*` so the script runs on profile pages where the invitation modal can appear.
- **Modal detection:** Use a `MutationObserver` or a short interval to detect when the “Add a note to your invitation” modal is in the DOM (e.g. dialog with that title or a textarea with placeholder “We know each other from...”).
- **Send button:** Query for the button with text “Send” inside that modal (or the primary submit control). Attach a **capture-phase** click listener so we run first: read `textarea.value`, build profile object from `window.location.href` + DOM (name from h1, headline from selector under the name, location if visible), then `fetch(POST /ingest/connection_request)` with that payload. Do not `preventDefault()` so LinkedIn’s Send still runs.
- **Profile scraping:** Prefer minimal, robust selectors (e.g. `h1` for name, one headline element, one location line) and fallbacks to `profile_url` and “Unknown” for missing fields so the extension doesn’t break when LinkedIn changes layout.
- **API config:** On load, content script reads `chrome.storage.local` for `apiBaseUrl` and `sdrId`/`sdrName`. If missing, it can show a one-line “Set API URL & SDR in extension popup” and skip the POST.

**Security / CORS:**

- Backend already allows `allow_origins=["*"]`. The extension’s origin is `chrome-extension://<id>`, so the backend will accept requests from the extension. If you later restrict origins, add your extension’s origin.
- No credentials in the extension; API is assumed local or internal. Optional: later add an API key in storage and a header in the backend.

## 3. Implementation order

1. **Backend:** Add Pydantic model `ConnectionRequestPayload` and `POST /ingest/connection_request` in [backend/main.py](backend/main.py), reusing the same Neo4j write pattern as `create_test_message` (MERGE persons, MERGE conversation, CREATE message with SENT/RECEIVED/PART_OF). No new schema; existing Person, Conversation, Message, and relationships are enough.
2. **Extension shell:** Create `extension/manifest.json` (V3, content_script on `*://www.linkedin.com/in/*`, storage), `extension/popup.html` (form: API URL, SDR id, SDR name), `extension/popup.js` (save to `chrome.storage.local`).
3. **Content script:** Implement `extension/content.js`: read storage; observe/find invitation modal and Send button; on Send click (capture), read textarea + scrape profile, POST to `{apiBaseUrl}/ingest/connection_request`, optionally show toast. Ensure one Send click = one POST (e.g. debounce or a short “already sent” flag so we don’t double-send if the user double-clicks).
4. **Manual test:** Load unpacked extension in `chrome://extensions`, set API URL and SDR in popup, open a LinkedIn profile, open the “Add a note to your invitation” modal, type a note, click Send; confirm in Neo4j (or dashboard) that the new Person, Conversation, and Message appear.

## 4. Fallback if modal hook fails

If LinkedIn’s structure (e.g. shadow DOM or obfuscated classes) makes the Send interception unreliable:

- Add a **“Save to CRM”** button or link in the content script UI (e.g. injected near the profile header or in the modal). On click, read the same textarea (if modal is open) and profile data, POST to the same endpoint. Flow becomes: you click Send on LinkedIn, then click “Save to CRM” (or the other way around). Still “profile + message in one” from the API’s perspective.

## 5. What stays out of scope (for now)

- **Profile PDF:** Architecture doc mentions “Forward LinkedIn profile to system” and Profile PDF; that can be a separate flow later (e.g. “Download PDF” then extension forwards the file). This plan only covers the connection-request note + profile metadata.
- **Conversation threading:** Later, when the prospect replies, you can use existing conversation/message ingestion to attach replies to the same `Conversation` (same `conversation_id`).
- **Sentiment / response_type:** Can be set when you ingest replies (e.g. from the extension or from a separate “mark as interest/rejection” action).

---

**Summary:** One new backend endpoint accepts profile + note; the extension injects on LinkedIn profile pages, hooks the invitation modal’s Send button, and sends that payload so every connection request is stored as one Message in one Conversation with the correct Person. Popup stores API URL and SDR identity. Optional fallback is a manual “Save to CRM” button if the modal DOM is too fragile.
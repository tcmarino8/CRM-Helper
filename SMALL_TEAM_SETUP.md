# Small-Team Setup

This setup keeps everything simple:

- One shared Windows machine runs the backend
- Neo4j Aura stores the shared data
- Each SDR installs the Chrome extension locally
- Everyone uses the same backend URL and dashboard URL

## 1. Shared Machine Setup

1. Copy `.env.example` to `.env`
2. Fill in `NEO4J_URI`, `NEO4J_USER`, and `NEO4J_PASSWORD`
3. Start the backend from the project root:

```powershell
.\CRM-Venv\Scripts\python.exe -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

4. Confirm these work on the shared machine:
   - `http://127.0.0.1:8000/`
   - `http://127.0.0.1:8000/dashboard`
   - `http://127.0.0.1:8000/docs`

## 2. Make The Backend Reachable

For a small team, use one of these:

1. Tailscale
2. Cloudflare Tunnel
3. ngrok

Example backend URL your SDRs would use:

- `http://100.x.x.x:8000`
- `https://crmhelper-yourteam.trycloudflare.com`
- `https://abc123.ngrok-free.app`

If you use a non-local URL, add it to `CORS_ORIGINS` in `.env`.

Example:

```env
CORS_ORIGINS=http://127.0.0.1:8000,http://localhost:8000,https://crmhelper-yourteam.trycloudflare.com
```

## 3. Import Company Data

Run once after the backend is up:

```powershell
Invoke-WebRequest -UseBasicParsing -Method Post -Uri http://127.0.0.1:8000/graph/import/clients_directory -ContentType 'application/json' -Body '{}'
```

If you are using a shared public URL, replace `127.0.0.1:8000` with that URL.

## 4. Import Crypto Contacts

Use the reusable crypto-contact import whenever `Crypto Contacts.md` gets new rows.

One-time / ad hoc import via API:

```powershell
Invoke-WebRequest -UseBasicParsing -Method Post -Uri http://127.0.0.1:8000/graph/import/crypto_contacts -ContentType 'application/json' -Body '{}'
```

Reusable wrapper script:

```powershell
.\import_crypto_contacts.ps1
```

Optional arguments:

```powershell
.\import_crypto_contacts.ps1 -ApiBase http://127.0.0.1:8000 -FilePath "Crypto Contacts.md" -Limit 25
```

Import behavior:

- reuses existing Company nodes when website or normalized company name matches
- links imported people to the resolved company with `WORKS_AT`
- creates email-based person records from contact emails
- marks newly imported contacts as `not_reached`
- defaults imported outreach channel to `email`
- can be rerun safely as the markdown file grows

## 5. SDR Setup

Each SDR should:

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click `Load unpacked`
4. Select the `chrome_extension` folder
5. Open the CRM Helper popup
6. Fill in:
   - Backend URL
   - SDR ID
   - SDR display name

Then they can:

- search imported companies
- attach LinkedIn contacts to shared Company nodes
- save outreach records
- save outreach from non-LinkedIn tabs as `email` automatically
- open the shared dashboard URL in Chrome

Channel behavior in the popup:

- if the current tab URL contains `linkedin`, outreach is stored as `linkedin`
- otherwise outreach is stored as `email`
- for email outreach, the contact email is used as the person identifier

## 6. Dashboard

Share this URL with the team:

- `http://your-backend-url:8000/dashboard`

or your tunnel URL equivalent.

## 7. Recommended Pilot

1. Set this up for yourself first
2. Test with one colleague
3. Confirm both SDR identities appear in shared data
4. Roll out to the rest of the team
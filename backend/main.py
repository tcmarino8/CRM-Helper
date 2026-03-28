import os
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from neo4j import GraphDatabase
from dotenv import load_dotenv
from pydantic import BaseModel


# To run locally with Neo4j Aura, set env vars in .env or your shell:
# NEO4J_URI=neo4j+s://<your-instance>.databases.neo4j.io
# NEO4J_USER=neo4j
# NEO4J_PASSWORD=<your-password>
#
# Start command (PowerShell):
# Set-Location "C:/Users/Tyler Marino/OneDrive/Desktop/Webra/CRMhelper"; .\CRM-Venv\Scripts\python.exe -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000

load_dotenv()  # load .env if present


def _cors_origins() -> list[str]:
    raw_value = (os.getenv("CORS_ORIGINS") or "").strip()
    if not raw_value:
        return [
            "http://127.0.0.1:8000",
            "http://localhost:8000",
            "chrome-extension://*",
        ]

    if raw_value == "*":
        return ["*"]

    return [origin.strip() for origin in raw_value.split(",") if origin.strip()]


ALLOW_CREDENTIALS = _cors_origins() != ["*"]

app = FastAPI(title="LinkedIn → Neo4j Outreach Intelligence API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=ALLOW_CREDENTIALS,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Global Neo4j driver (initialized on startup if env vars are present)
driver: Any = None
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CLIENTS_DIRECTORY_PATH = PROJECT_ROOT / "Clients Directory.md"


@app.on_event("startup")
def startup_event() -> None:
    """
    Initialize Neo4j driver if environment variables are configured.
    This keeps local dev simple: app still runs even if Neo4j is not set up yet.
    """
    global driver

    uri = os.getenv("NEO4J_URI")
    user = os.getenv("NEO4J_USER")
    password = os.getenv("NEO4J_PASSWORD")

    if not (uri and user and password):
        # Run without Neo4j if not configured yet
        print("Neo4j not configured (missing NEO4J_* env vars); skipping driver init.")
        return

    driver = GraphDatabase.driver(uri, auth=(user, password))
    print("Neo4j driver initialized.")


@app.on_event("shutdown")
def shutdown_event() -> None:
    """Gracefully close Neo4j driver on shutdown."""
    global driver
    if driver is not None:
        driver.close()
        print("Neo4j driver closed.")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/")
async def root():
    return {
        "status": "ok",
        "message": "API is running.",
        "docs": "/docs",
        "dashboard": "/dashboard",
        "health": "/health",
        "cors_origins": _cors_origins(),
    }


class TestPersonCompanyPayload(BaseModel):
    person_id: str
    person_name: str
    person_headline: Optional[str] = None
    person_profile_url: Optional[str] = None
    company_id: Optional[str] = None
    existing_company_id: Optional[str] = None
    company_name: Optional[str] = None
    category: Optional[str] = None  # e.g., "client" or "investor"


class ClientsDirectoryImportPayload(BaseModel):
    markdown_text: Optional[str] = None
    file_path: Optional[str] = None
    source_name: Optional[str] = None
    limit: Optional[int] = None


def _slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_value).strip("-").lower()
    return slug or "unknown"


def _strip_markdown_formatting(value: str) -> str:
    text = (value or "").strip()
    text = re.sub(r"\*\*(.*?)\*\*", r"\1", text)
    text = re.sub(r"__(.*?)__", r"\1", text)
    text = re.sub(r"\[(.*?)\]\((.*?)\)", r"\1", text)
    return re.sub(r"\s+", " ", text).strip()


def _normalize_website(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    website = _strip_markdown_formatting(value).lower().strip()
    website = re.sub(r"^https?://", "", website)
    website = website.rstrip("/")
    return website or None


def _company_id_from_website_or_name(website: Optional[str], name: Optional[str]) -> str:
    normalized_website = _normalize_website(website)
    if normalized_website:
        return f"co:web:{_slugify(normalized_website)}"
    return f"co:name:{_slugify(name or 'unknown')}"


def _parse_table_cells(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def _asset_class_list(value: Optional[str]) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def _parse_clients_directory_markdown(markdown_text: str, source_name: str) -> tuple[list[dict[str, Any]], list[str]]:
    companies: list[dict[str, Any]] = []
    parse_errors: list[str] = []
    current_section: Optional[str] = None
    section_description_lines: list[str] = []
    header_cells: Optional[list[str]] = None

    lines = markdown_text.splitlines()
    for index, raw_line in enumerate(lines, start=1):
        line = raw_line.strip()

        if line.startswith("## "):
            current_section = line[3:].strip()
            section_description_lines = []
            header_cells = None
            continue

        if not line:
            continue

        if line.startswith("---"):
            header_cells = None
            continue

        if line.startswith("|"):
            cells = _parse_table_cells(line)
            if all(set(cell) <= {"-", ":"} for cell in cells if cell):
                continue

            if header_cells is None:
                header_cells = cells
                continue

            if len(cells) != len(header_cells):
                parse_errors.append(f"Line {index}: expected {len(header_cells)} cells, got {len(cells)}")
                continue

            row = {header_cells[pos]: _strip_markdown_formatting(cells[pos]) for pos in range(len(header_cells))}
            primary_name = row.get("Client") or row.get("Firm") or row.get("Prospect") or row.get("Institution")
            website = _normalize_website(row.get("Website"))
            if not primary_name:
                parse_errors.append(f"Line {index}: missing company name column")
                continue

            asset_classes = row.get("Asset Classes") or row.get("Trading Focus")
            company = {
                "company_id": _company_id_from_website_or_name(website, primary_name),
                "name": primary_name,
                "full_name": row.get("Full Name") or primary_name,
                "hq": row.get("HQ"),
                "website": website,
                "asset_classes": _asset_class_list(asset_classes),
                "segment_name": current_section,
                "segment_description": " ".join(section_description_lines).strip() or None,
                "company_type": row.get("Type"),
                "notes": row.get("Why Webra Fits"),
                "source_file": source_name,
                "row_number": row.get("#"),
            }
            companies.append(company)
            continue

        if current_section:
            section_description_lines.append(line)

    return companies, parse_errors


def _duplicate_values(values: list[Optional[str]]) -> list[str]:
    counts: dict[str, int] = {}
    for value in values:
        if not value:
            continue
        counts[value] = counts.get(value, 0) + 1
    return sorted([value for value, count in counts.items() if count > 1])


def _ensure_unique_company_ids(companies: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str], list[str]]:
    duplicate_websites = _duplicate_values([company.get("website") for company in companies])

    for company in companies:
        if company.get("website") in duplicate_websites:
            fallback_name = company.get("full_name") or company.get("name") or "unknown"
            company["company_id"] = f"co:name:{_slugify(fallback_name)}"

    company_id_counts: dict[str, int] = {}
    for company in companies:
        company_id = company["company_id"]
        company_id_counts[company_id] = company_id_counts.get(company_id, 0) + 1
        if company_id_counts[company_id] > 1:
            suffix = company.get("row_number") or company_id_counts[company_id]
            company["company_id"] = f"{company_id}:{_slugify(str(suffix))}"

    duplicate_company_ids = _duplicate_values([company["company_id"] for company in companies])
    return companies, duplicate_company_ids, duplicate_websites


def _load_clients_directory_source(payload: ClientsDirectoryImportPayload) -> tuple[str, str]:
    if payload.markdown_text:
        return payload.markdown_text, payload.source_name or "inline_markdown"

    candidate = Path(payload.file_path) if payload.file_path else DEFAULT_CLIENTS_DIRECTORY_PATH
    if not candidate.is_absolute():
        candidate = PROJECT_ROOT / candidate
    if not candidate.exists():
        raise HTTPException(status_code=404, detail=f"Clients directory file not found: {candidate}")

    return candidate.read_text(encoding="utf-8"), payload.source_name or candidate.name


class TestMessagePayload(BaseModel):
    """Single message in a conversation: sender → message (content) → receiver, message part of conversation."""
    conversation_id: str
    message_id: str
    sender_id: str  # e.g. "sdr1"
    receiver_id: str  # e.g. "li:john-doe-123"
    text: str
    timestamp: Optional[str] = None  # ISO or epoch ms string
    platform: Optional[str] = "linkedin"
    is_reply: bool = False  # True if from prospect back to SDR
    sender_name: Optional[str] = None  # set on Person ON CREATE
    receiver_name: Optional[str] = None
    response_type: Optional[str] = None  # "interest" | "rejection" | "neutral" | "delay" | "ghosted" (for replies; links Message to ResponseType)


@app.post("/graph/test/person_company")
async def create_test_person_company(payload: TestPersonCompanyPayload):
    """
    Minimal test endpoint:
    - MERGE a Person and Company
    - MERGE a WORKS_AT relationship between them

    This is only for validating Neo4j write connectivity and basic schema.
    """
    if driver is None:
        raise HTTPException(
            status_code=503,
            detail="Neo4j driver not initialized. "
            "Check NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD env vars.",
        )

    company_node_id = payload.existing_company_id or payload.company_id or _company_id_from_website_or_name(None, payload.company_name)
    company_name = payload.company_name or payload.person_name or "Unknown"

    cypher = """
        MERGE (p:Person {id: $person_id})
            ON CREATE SET
                p.name = $person_name,
                p.headline = $person_headline,
                p.profile_url = $person_profile_url,
                p.category = $category
            ON MATCH SET
                p.category = coalesce($category, p.category)
        MERGE (c:Company {id: $company_id})
            ON CREATE SET
                c.name = $company_name,
                c.category = $category
            ON MATCH SET
                c.name = coalesce(c.name, $company_name),
                c.category = coalesce(c.category, $category)
    MERGE (p)-[:WORKS_AT]->(c)
    RETURN p, c
    """

    params = payload.model_dump()
    params["company_id"] = company_node_id
    params["company_name"] = company_name

    try:
        with driver.session() as session:
            summary = session.run(cypher, params).consume()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Neo4j write failed: {exc}") from exc

    counters = summary.counters

    return {
        "message": "Person, Company, and WORKS_AT relationship upserted.",
        "company_id": company_node_id,
        "counters": {
            "nodes_created": counters.nodes_created,
            "nodes_deleted": counters.nodes_deleted,
            "relationships_created": counters.relationships_created,
            "relationships_deleted": counters.relationships_deleted,
            "properties_set": counters.properties_set,
        },
    }


@app.post("/graph/import/clients_directory")
async def import_clients_directory(payload: ClientsDirectoryImportPayload):
    _require_driver()

    markdown_text, source_name = _load_clients_directory_source(payload)
    companies, parse_errors = _parse_clients_directory_markdown(markdown_text, source_name)

    if payload.limit is not None:
        companies = companies[: payload.limit]

    if not companies:
        return {
            "message": "No companies parsed from markdown source.",
            "source_name": source_name,
            "companies_created": 0,
            "companies_updated": 0,
            "skipped_rows": len(parse_errors),
            "parse_errors": parse_errors,
            "duplicate_company_ids": [],
            "duplicate_websites": [],
        }

    companies, duplicate_company_ids, duplicate_websites = _ensure_unique_company_ids(companies)
    now = datetime.now(timezone.utc).isoformat()
    cypher = """
    UNWIND $companies AS row
    MERGE (c:Company {id: row.company_id})
      ON CREATE SET
        c.created_at = $now,
        c._just_created = true
    SET c.name = row.name,
        c.full_name = row.full_name,
        c.hq = row.hq,
        c.website = row.website,
        c.asset_classes = row.asset_classes,
        c.segment_name = row.segment_name,
        c.segment_description = row.segment_description,
        c.company_type = row.company_type,
        c.notes = row.notes,
        c.source_file = row.source_file,
        c.row_number = row.row_number,
        c.import_source = 'clients_directory_md',
        c.updated_at = $now,
        c.imported_at = coalesce(c.imported_at, $now)
    WITH coalesce(c._just_created, false) AS just_created, c
    REMOVE c._just_created
    RETURN sum(CASE WHEN just_created THEN 1 ELSE 0 END) AS created_count,
           count(c) - sum(CASE WHEN just_created THEN 1 ELSE 0 END) AS updated_count
    """

    try:
        with driver.session() as session:
            record = session.run(cypher, {"companies": companies, "now": now}).single()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Neo4j import failed: {exc}") from exc

    return {
        "message": f"Imported {len(companies)} companies from markdown source.",
        "source_name": source_name,
        "companies_created": record["created_count"] if record else 0,
        "companies_updated": record["updated_count"] if record else 0,
        "skipped_rows": len(parse_errors),
        "parse_errors": parse_errors,
        "duplicate_company_ids": duplicate_company_ids,
        "duplicate_websites": duplicate_websites,
    }


@app.get("/graph/companies/search")
async def search_companies(q: str, limit: int = 8):
    _require_driver()
    query = (q or "").strip().lower()
    if len(query) < 2:
        return {"companies": []}

    cypher = """
    MATCH (c:Company)
    WHERE toLower(coalesce(c.name, '')) CONTAINS $query
       OR toLower(coalesce(c.full_name, '')) CONTAINS $query
       OR toLower(coalesce(c.website, '')) CONTAINS $query
       OR toLower(coalesce(c.segment_name, '')) CONTAINS $query
    RETURN c.id AS company_id,
           c.name AS name,
           c.full_name AS full_name,
           c.hq AS hq,
           c.website AS website,
           c.asset_classes AS asset_classes,
           c.segment_name AS segment_name,
           c.import_source AS import_source
    ORDER BY
      CASE WHEN toLower(coalesce(c.name, '')) STARTS WITH $query THEN 0 ELSE 1 END,
      c.name
    LIMIT $limit
    """

    try:
        with driver.session() as session:
            rows = [dict(record) for record in session.run(cypher, {"query": query, "limit": max(1, min(limit, 25))})]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Company search failed: {exc}") from exc

    return {"companies": rows}


@app.post("/graph/test/message")
async def create_test_message(payload: TestMessagePayload):
    """
    Create a message between two people and attach it to a conversation.
    - MERGE sender and receiver Person nodes (optionally set name on create).
    - MERGE Conversation by id.
    - CREATE Message with content; (sender)-[:SENT]->(Message)-[:RECEIVED]->(receiver); (Message)-[:PART_OF]->(Conversation).
    Bidirectional conversations are represented by multiple Message nodes in the same Conversation.
    """
    if driver is None:
        raise HTTPException(
            status_code=503,
            detail="Neo4j driver not initialized. "
            "Check NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD env vars.",
        )

    cypher = """
    MERGE (sender:Person {id: $sender_id})
      ON CREATE SET sender.name = $sender_name
    MERGE (receiver:Person {id: $receiver_id})
      ON CREATE SET receiver.name = $receiver_name
    MERGE (conv:Conversation {id: $conversation_id})
      ON CREATE SET conv.platform = $platform, conv.last_activity = $timestamp
      ON MATCH SET conv.last_activity = $timestamp
    CREATE (msg:Message {
      id: $message_id,
      text: $text,
      timestamp: $timestamp,
      platform: $platform,
      is_reply: $is_reply
    })
    CREATE (sender)-[:SENT]->(msg)
    CREATE (msg)-[:RECEIVED]->(receiver)
    CREATE (msg)-[:PART_OF]->(conv)
    RETURN msg.id AS message_id
    """
    params = payload.model_dump()
    # Coerce is_reply for Neo4j
    params["is_reply"] = bool(payload.is_reply)
    if not params.get("timestamp"):
        params["timestamp"] = datetime.now(timezone.utc).isoformat()
    response_type = (payload.response_type or "").strip() or None
    if "response_type" in params:
        params["response_type"] = response_type

    try:
        with driver.session() as session:
            result = session.run(cypher, params)
            record = result.single()
            # Link to ResponseType if provided (for reply classification)
            if record and response_type:
                link_cypher = """
                MATCH (m:Message {id: $message_id})
                MERGE (rt:ResponseType {name: $response_type})
                CREATE (m)-[:HAS_TYPE]->(rt)
                """
                session.run(link_cypher, {"message_id": record["message_id"], "response_type": response_type})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Neo4j write failed: {exc}") from exc

    return {
        "message": "Message created and linked to sender, receiver, and conversation.",
        "message_id": record["message_id"] if record else payload.message_id,
    }


@app.get("/neo4j/ping")
async def neo4j_ping():
    """
    Simple connectivity check to Neo4j Aura.
    Runs `RETURN 1 AS ok` and returns a boolean.
    """
    if driver is None:
        raise HTTPException(
            status_code=503,
            detail="Neo4j driver not initialized. "
            "Check NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD env vars.",
        )

    def _ping(tx):
        result = tx.run("RETURN 1 AS ok")
        record = result.single()
        return bool(record["ok"]) if record else False

    try:
        with driver.session() as session:
            ok = session.execute_read(_ping)
    except Exception as exc:  # keep broad here for simple diagnostics
        raise HTTPException(status_code=500, detail=f"Neo4j ping failed: {exc}") from exc

    return {"ok": ok}


@app.post("/ingest/profile_pdf")
async def ingest_profile_pdf():
    # TODO: accept and store uploaded PDF; for now just stub
    return {"message": "profile_pdf endpoint reachable"}


@app.post("/ingest/conversation")
async def ingest_conversation(payload: dict):
    # TODO: validate and persist conversation; for now just echo payload keys
    return {
        "message": "conversation endpoint reachable",
        "received_keys": list(payload.keys()),
    }


######

# ---------- Analytics (SDR dashboard) ----------


def _require_driver():
    if driver is None:
        raise HTTPException(
            status_code=503,
            detail="Neo4j driver not initialized.",
        )


@app.get("/analytics/sdrs")
async def list_sdrs():
    """
    List all SDRs: persons who have sent at least one message.
    Returns [{ sdr_id, name }, ...].
    """
    _require_driver()
    cypher = """
    MATCH (p:Person)-[:SENT]->(:Message)
    WITH p.id AS sdr_id, p.name AS name
    RETURN DISTINCT sdr_id, name
    ORDER BY name, sdr_id
    """
    try:
        with driver.session() as session:
            result = session.run(cypher)
            rows = [{"sdr_id": r["sdr_id"], "name": r["name"] or r["sdr_id"]} for r in result]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"sdrs": rows}


@app.get("/analytics/sdr/{sdr_id}/stats")
async def sdr_stats(sdr_id: str):
    """
    Per-SDR stats: messages_sent, positive_responses, negative_responses,
    no_responses (conversations with no reply), avg_response_hours.
    Positive = interest, Negative = rejection, No response = ghosted or no reply yet.
    """
    _require_driver()

    # Messages sent by this SDR
    sent_cypher = """
    MATCH (p:Person {id: $sdr_id})-[:SENT]->(m:Message)
    RETURN count(m) AS messages_sent
    """
    # Replies received by this SDR, classified by ResponseType
    response_cypher = """
    MATCH (p:Person {id: $sdr_id})<-[:RECEIVED]-(m:Message)-[:HAS_TYPE]->(rt:ResponseType)
    RETURN rt.name AS response_type, count(m) AS cnt
    """
    # Conversations where SDR sent but received zero messages (no response)
    no_response_cypher = """
    MATCH (p:Person {id: $sdr_id})-[:SENT]->(:Message)-[:PART_OF]->(c:Conversation)
    WITH c, p
    WHERE NOT EXISTS {
      MATCH (p)<-[:RECEIVED]-(:Message)-[:PART_OF]->(c)
    }
    RETURN count(DISTINCT c) AS no_responses
    """
    # First-sent and first-reply timestamps per conversation for avg response time
    avg_time_cypher = """
    MATCH (p:Person {id: $sdr_id})-[:SENT]->(out:Message)-[:PART_OF]->(c:Conversation)
    WITH c, min(out.timestamp) AS first_sent
    MATCH (p)<-[:RECEIVED]-(in:Message)-[:PART_OF]->(c)
    WITH c, first_sent, min(in.timestamp) AS first_reply
    RETURN first_sent, first_reply
    """

    params = {"sdr_id": sdr_id}
    out: dict[str, Any] = {
        "messages_sent": 0,
        "positive_responses": 0,
        "negative_responses": 0,
        "no_responses": 0,
        "avg_response_hours": None,
    }

    try:
        with driver.session() as session:
            r = session.run(sent_cypher, params).single()
            if r:
                out["messages_sent"] = r["messages_sent"] or 0

            for rec in session.run(response_cypher, params):
                name, cnt = rec["response_type"], rec["cnt"] or 0
                if name == "interest":
                    out["positive_responses"] = cnt
                elif name == "rejection":
                    out["negative_responses"] = cnt

            r = session.run(no_response_cypher, params).single()
            if r:
                out["no_responses"] = r["no_responses"] or 0

            pairs: list[tuple[str, str]] = []
            for rec in session.run(avg_time_cypher, params):
                first_sent, first_reply = rec["first_sent"], rec["first_reply"]
                if first_sent and first_reply:
                    pairs.append((first_sent, first_reply))

            if pairs:
                total_hours = 0.0
                for sent_s, reply_s in pairs:
                    try:
                        sent_dt = datetime.fromisoformat(sent_s.replace("Z", "+00:00"))
                        reply_dt = datetime.fromisoformat(reply_s.replace("Z", "+00:00"))
                        total_hours += (reply_dt - sent_dt).total_seconds() / 3600
                    except (ValueError, TypeError):
                        continue
                if pairs:
                    out["avg_response_hours"] = round(total_hours / len(pairs), 2)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return out


@app.get("/analytics/sdr/{sdr_id}/companies")
async def sdr_company_reach(sdr_id: str, limit: int = 20):
    """
    Company reach for a specific SDR.
    Size metric: distinct prospects reached at each company.
    """
    _require_driver()
    cypher = """
    MATCH (sdr:Person {id: $sdr_id})-[:SENT]->(out:Message)-[:RECEIVED]->(prospect:Person)
    OPTIONAL MATCH (prospect)-[:WORKS_AT]->(company:Company)
    WITH
      coalesce(company.id, 'co:unknown') AS company_id,
      coalesce(company.name, 'Unknown company') AS company_name,
      count(DISTINCT prospect) AS prospects_reached,
      count(out) AS messages_sent
    RETURN company_id, company_name, prospects_reached, messages_sent
    ORDER BY prospects_reached DESC, messages_sent DESC, company_name ASC
    LIMIT $limit
    """

    params = {"sdr_id": sdr_id, "limit": max(1, min(limit, 50))}
    try:
        with driver.session() as session:
            rows = [dict(record) for record in session.run(cypher, params)]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {"companies": rows}


@app.get("/analytics/sdr/{sdr_id}/prospects")
async def sdr_prospects(sdr_id: str, limit: int = 100):
    """
    Prospects contacted by an SDR, including company and simple message/reply counts.
    """
    _require_driver()
    cypher = """
    MATCH (sdr:Person {id: $sdr_id})-[:SENT]->(out:Message)-[:RECEIVED]->(prospect:Person)
    OPTIONAL MATCH (prospect)-[:WORKS_AT]->(company:Company)
    WITH sdr, prospect, company, count(out) AS messages_sent, max(out.timestamp) AS last_outbound_at
    OPTIONAL MATCH (prospect)-[:SENT]->(reply:Message)-[:RECEIVED]->(sdr)
    WITH prospect, company, messages_sent, last_outbound_at, count(reply) AS replies_received
    RETURN
      prospect.id AS prospect_id,
      coalesce(prospect.name, prospect.id) AS prospect_name,
      coalesce(company.id, 'co:unknown') AS company_id,
      coalesce(company.name, 'Unknown company') AS company_name,
      messages_sent,
      replies_received,
      last_outbound_at
    ORDER BY last_outbound_at DESC, prospect_name ASC
    LIMIT $limit
    """

    params = {"sdr_id": sdr_id, "limit": max(1, min(limit, 250))}
    try:
        with driver.session() as session:
            rows = [dict(record) for record in session.run(cypher, params)]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {"prospects": rows}


@app.get("/analytics/sdr/{sdr_id}/prospect/{prospect_id}/conversation")
async def sdr_prospect_conversation(sdr_id: str, prospect_id: str, limit: int = 200):
    """
    Conversation timeline between one SDR and one prospect.
    """
    _require_driver()
    cypher = """
    MATCH (sender:Person)-[:SENT]->(m:Message)-[:RECEIVED]->(receiver:Person)
    WHERE (sender.id = $sdr_id AND receiver.id = $prospect_id)
       OR (sender.id = $prospect_id AND receiver.id = $sdr_id)
    OPTIONAL MATCH (m)-[:PART_OF]->(conv:Conversation)
    RETURN
      m.id AS message_id,
      m.text AS text,
      m.timestamp AS timestamp,
      m.platform AS platform,
      m.is_reply AS is_reply,
      sender.id AS sender_id,
      coalesce(sender.name, sender.id) AS sender_name,
      receiver.id AS receiver_id,
      coalesce(receiver.name, receiver.id) AS receiver_name,
      conv.id AS conversation_id
    ORDER BY coalesce(m.timestamp, ''), message_id
    LIMIT $limit
    """

    params = {
        "sdr_id": sdr_id,
        "prospect_id": prospect_id,
        "limit": max(1, min(limit, 500)),
    }
    try:
        with driver.session() as session:
            rows = [dict(record) for record in session.run(cypher, params)]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        "sdr_id": sdr_id,
        "prospect_id": prospect_id,
        "messages": rows,
    }


@app.get("/analytics/companies/reach")
async def company_reach(limit: int = 50):
    """
    Global company reach for the dashboard visualization.
    Size metric: distinct prospects reached at each company.
    """
    _require_driver()
    cypher = """
    MATCH (:Person)-[:SENT]->(out:Message)-[:RECEIVED]->(prospect:Person)
    OPTIONAL MATCH (prospect)-[:WORKS_AT]->(company:Company)
    WITH
      coalesce(company.id, 'co:unknown') AS company_id,
      coalesce(company.name, 'Unknown company') AS company_name,
      count(DISTINCT prospect) AS prospects_reached,
      count(out) AS messages_sent
    RETURN company_id, company_name, prospects_reached, messages_sent
    ORDER BY prospects_reached DESC, messages_sent DESC, company_name ASC
    LIMIT $limit
    """

    params = {"limit": max(1, min(limit, 200))}
    try:
        with driver.session() as session:
            rows = [dict(record) for record in session.run(cypher, params)]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {"companies": rows}


# Serve dashboard static files (mount last so routes take precedence)
_DASHBOARD_DIR = os.path.join(os.path.dirname(__file__), "..", "dashboard")
if os.path.isdir(_DASHBOARD_DIR):
    app.mount("/dashboard", StaticFiles(directory=_DASHBOARD_DIR, html=True), name="dashboard")


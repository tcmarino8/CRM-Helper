// Minimal core schema for initial testing
// This focuses on Person, Company, and WORKS_AT relationships.

// Constraints
CREATE CONSTRAINT person_id_unique IF NOT EXISTS
FOR (p:Person)
REQUIRE p.id IS UNIQUE;

CREATE CONSTRAINT company_id_unique IF NOT EXISTS
FOR (c:Company)
REQUIRE c.id IS UNIQUE;

// Optional indexes for lookup by name (not unique)
CREATE INDEX person_name_index IF NOT EXISTS
FOR (p:Person)
ON (p.name);

CREATE INDEX person_contact_email_index IF NOT EXISTS
FOR (p:Person)
ON (p.contact_email);

CREATE INDEX person_outreach_status_index IF NOT EXISTS
FOR (p:Person)
ON (p.outreach_status);

CREATE INDEX person_outreach_channel_index IF NOT EXISTS
FOR (p:Person)
ON (p.outreach_channel);

CREATE INDEX company_name_index IF NOT EXISTS
FOR (c:Company)
ON (c.name);

CREATE INDEX company_website_index IF NOT EXISTS
FOR (c:Company)
ON (c.website);

// Conversation and Message (SDR ↔ prospect messaging)
CREATE CONSTRAINT conversation_id_unique IF NOT EXISTS
FOR (c:Conversation)
REQUIRE c.id IS UNIQUE;

CREATE CONSTRAINT message_id_unique IF NOT EXISTS
FOR (m:Message)
REQUIRE m.id IS UNIQUE;

CREATE INDEX message_timestamp_index IF NOT EXISTS
FOR (m:Message)
ON (m.timestamp);

// ResponseType for classifying replies (positive / negative / no response)
// (Message)-[:HAS_TYPE]->(ResponseType {name: 'interest'|'rejection'|'neutral'|'delay'|'ghosted'})
CREATE CONSTRAINT response_type_name_unique IF NOT EXISTS
FOR (r:ResponseType)
REQUIRE r.name IS UNIQUE;

// Seed response types (run once)
MERGE (r:ResponseType {name: 'interest'});
MERGE (r:ResponseType {name: 'rejection'});
MERGE (r:ResponseType {name: 'neutral'});
MERGE (r:ResponseType {name: 'delay'});
MERGE (r:ResponseType {name: 'ghosted'});

// Pattern: (Sender)-[:SENT]->(Message)-[:RECEIVED]-(Receiver), (Message)-[:PART_OF]->(Conversation)
// Example pattern for person_company test:
// MERGE (p:Person {id: $person_id})
//   ON CREATE SET
//     p.name = $person_name,
//     p.headline = $person_headline,
//     p.profile_url = $person_profile_url
// MERGE (c:Company {id: $company_id})
//   ON CREATE SET
//     c.name = $company_name
// MERGE (p)-[:WORKS_AT]->(c);

// Additional Person properties used by imports/outreach tracking:
// p.contact_email
// p.outreach_status        -> 'not_reached' | 'reached_out'
// p.outreach_channel       -> 'linkedin' | 'email'
// p.outreach_source        -> 'manual-entry' | 'crypto_contacts_md' | other import source
// p.imported_at
// p.last_outreach_at



// Delete all
// Match (n) detatch delete (n);
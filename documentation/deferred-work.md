# Deferred Work Items

Items agreed upon but not yet implemented. Return to these soon.

---

## 1. Webhook Integration for ERP Systems

**Status:** Approved — not started  
**Priority:** High  
**Context:** Building a product catalogue would duplicate ERP data. Instead, support ERP integration via webhooks.

### Inbound (ERP → Platform)
- Accept PO creation payloads from external ERPs
- Validate incoming payloads against PO schema
- Authenticate via API key / HMAC signature
- Map ERP fields to internal PO model

### Outbound (Platform → ERP)
- Notify ERPs on PO status changes (ACCEPTED, SHIPPED, SETTLED, etc.)
- Webhook registration endpoint (URL, events, secret)
- Retry with exponential backoff on failure
- Webhook delivery log for debugging

---

## 2. Production Deployment Gaps

**Status:** Identified during evidence pack audit  
**Priority:** Medium (before production launch)

| Gap | Detail |
|-----|--------|
| Public URLs | `WEBAUTHN_ORIGIN` and `BASE_URL` must be real HTTPS domains for WebAuthn to work in production |
| Pack-level signature | Evidence packs should be signed by the platform key so banks can verify the pack itself wasn't tampered with |
| Per-entity hash chain | Current chain is global; each PO should also have its own entity-scoped chain for independent verification |
| RFC 3161 Timestamping | External timestamp authority proof that evidence existed at a specific time |
| Credential revocation | Mechanism to revoke compromised passkey credentials |

---

## 3. Bank-Grade Evidence Pack Enhancements

**Status:** Feedback received — planning phase  
**Priority:** Critical  
**Reference:** `documentation/evidence-pack-todo.md`

This is being addressed in a dedicated implementation plan. See the phased plan once created.

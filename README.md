# Veridian IT Service Agent

**AIONOS Agentic AI Factory · Assignment 2: Internal Service Agent (IT Support)**

An internal employee-support agent for Veridian Corp's IT function. It understands an employee's issue, finds the relevant policy, asks only the follow-up questions that change the outcome, resolves simple requests, escalates risky or unclear ones, creates a structured ticket, cites its source for every answer, and keeps a hash-chained audit trail.

**Live demo:** https://princegarg001.github.io/veridian-it-service-agent/

**Run locally (one command):** `python -m http.server 8000`, then open http://localhost:8000. There's no build, no dependencies, and no API key needed.

---

## What the reviewer can try

| Tab | What it shows |
|---|---|
| **Agent Chat** | Pick an employee and a date, then type an issue or click `REQ-01…REQ-15`. You get multi-turn slot filling, cited answers, a ticket card, and a live reasoning trace. |
| **Triage Console** | Runs the agent on all 15 requests and the Section 3 ticket queue. It shows KPIs, decisions, risk, sources, and **status reconciliation** (where the recorded status conflicts with policy). |
| **Tickets** | Structured JSON tickets with priority, risk, owner, SLA, KB sources, precedents, conflicts, and next steps. Exportable. |
| **Audit Trail** | An append-only, hash-chained log of every stage and actor (employee / agent / LLM / guardrail). Exportable. |
| **Knowledge Base** | The only permitted sources: KB-01…KB-10 and the Asset Management Policy. |
| **Architecture** | Process flow, design principles, and assumptions. |

## Architecture

```
 Employee message / queue item
          │
   ┌──────▼──────┐   ┌───────────────┐   ┌────────────────────┐   ┌─────────────────┐   ┌────────────────┐   ┌─────────────────────┐
   │   Intake    │──▶│  Understand   │──▶│     Retrieve       │──▶│     Reason      │──▶│   Guardrails   │──▶│        Act          │
   │ chat/queue  │   │ rules + opt.  │   │ policy map + BM25  │   │ per-intent      │   │ risk, conflict,│   │ RESOLVED / IT_TICKET│
   │             │   │ Claude (JSON) │   │ + ticket precedent │   │ policy handlers │   │ ungrounded,    │   │ ROUTED / ESCALATED  │
   └─────────────┘   └───────────────┘   └────────────────────┘   └───────┬─────────┘   │ urgency, status│   └─────────┬───────────┘
                                                                          │ missing slot └────────────────┘             │
                                                                          ▼                                  ┌──────────┼───────────┐
                                                                  Ask targeted follow-up ──(loop)            ▼          ▼           ▼
                                                                                                      Ticket JSON   Audit log   Cited reply
```

**Core principle: the LLM proposes and the policy engine decides.** Claude is optional. When it's enabled, it only turns messy text into `{intent, confidence, slots}` JSON, which is schema-filtered. Every approval, route, and escalation comes from deterministic, testable policy handlers that cite KB IDs. If Claude is unavailable, the agent falls back to its rules classifier.

| Layer | File | Responsibility |
|---|---|---|
| Source data | `js/data.js` | KB-01…10, the Asset Management Policy, 15 requests, and 10 queue tickets, transcribed from the data pack |
| Engine | `js/engine.js` | Classifier, entity extraction, BM25 retrieval, precedent lookup, 12 policy handlers, guardrails, ticket builder, queue assessment |
| LLM adapter | `js/llm.js` | Optional Claude call with a strict JSON schema and slot allow-list |
| UI / audit | `js/app.js` | Chat state machine (slot filling), triage console, tickets, hash-chained audit trail, exports |

### Decision model
- **RESOLVED**: self-service guidance with a policy citation, e.g. guest Wi-Fi (KB-07) or VPN renewal (KB-02).
- **IT_TICKET**: IT has to act, e.g. manual unlock after 5+ failed attempts (KB-01).
- **ROUTED**: another function owns it, e.g. Finance for expense accounts (KB-08), or manager and Finance for WFH equipment (KB-10).
- **ESCALATED**: risky, ungrounded, conflicting, or needs authority, e.g. phishing (KB-09), admin access (no policy), laptop policy conflict.
- **NEEDS_INFO**: a targeted follow-up where the missing fact changes the decision.

## What the agent catches in the data pack

| Case | Agent finding |
|---|---|
| REQ-01 (laptop, 3.5 yrs, dead) | **Policy conflict.** KB-03 allows replacement after 3 years, but the Asset Policy (Q2 2026) uses a 4-year cycle and needs Finance sign-off. Escalated for failure verification, IT approval, and Finance sign-off, and the 2-week rule is flagged. |
| REQ-02 (guest Wi-Fi tomorrow) | Resolved with no ticket. Codes are valid for 24 hours, so the agent tells the employee to generate them **tomorrow**, not today. |
| REQ-03 (6 failed attempts) | **Status correction.** 'Reset queued' is the wrong action: KB-01 requires a manual unlock. |
| REQ-04 (non-catalog tool) | Status is correct. SLA window computed as Fri 25 Sep to Tue 29 Sep (3–5 business days). |
| REQ-05 (VPN expired) | Resolved as self-renewal (KB-02), consistent with TK-1042. |
| REQ-06 (printer false jam) | Technician assigned, but KB-05 first-line steps and the asset tag aren't recorded. The agent asks for them. |
| REQ-07 (WFH 4 days) | Eligible (more than 3 days). Routed to manager sign-off, then Finance, then IT shipping. |
| REQ-08 (phishing, forwarding) | **P1 Critical.** Stop forwarding (KB-09 violation), report to security@, contain recipients, and link to TK-1048. |
| REQ-09 (mailbox full) | Archive first. An increase needs manager approval and is capped at 50GB (precedent TK-1045 at 35GB). |
| REQ-10 (urgent finance admin access) | **No policy exists**, so the agent won't act. Escalated with a request for justification and manager approval (precedent TK-1050 was rejected). Urgency pressure is flagged. |
| REQ-11 (contractor VPN) | Routed. Manager approval via the access request form (KB-02), before the start date. |
| REQ-12 (expense login, no reply) | Stalled. Asks whether the account exists, since that decides IT vs Finance (KB-08). |
| REQ-13 (flicker, 2 yrs) | Diagnosis and repair ticket. Not eligible on age, and early replacement would need a verified failure plus Finance sign-off. |
| REQ-14 (productivity-tracking extension) | Security review (KB-04) marked **High risk** because it's a monitoring tool. SLA computed. |
| REQ-15 ("its not working") | Clarifying question. After 2 failed clarifications it goes to a human instead of guessing. |
| TK-1043 (3.2 yr laptop approved) | **Hold fulfilment** until Finance sign-off is confirmed, because the approval conflicts with the Asset Policy. |
| TK-1044 / TK-1047 / TK-1048 | Monitor Security / wait for Finance, then ship / keep with Security and link to REQ-08. |

## Inputs, sources and assumptions

**Inputs:** Assignment brief (Agentic AI Factory) and *Assignment 2 DataPack: Internal Service Agent*. That covers KB-01…KB-10, the Asset Management Policy extract, 15 employee requests (REQ-01…15), and 10 ticket-queue records (TK-1042…1051).

**Assumptions**
1. The simulation week is Mon 21 to Fri 25 Sep 2026. SLAs count Mon–Fri business days, since no holiday calendar was provided.
2. The approved software catalog isn't in the pack, so unconfirmed software is treated as non-catalog (the safe default).
3. The Asset Management Policy is newer (Q2 2026) and stricter than KB-03. The agent **surfaces** the conflict to humans instead of silently choosing one policy.
4. Admin or privileged access has no KB policy. The agent never grants it and escalates with precedent TK-1050.
5. REQ-11's requester is treated as the contractor's manager ("my team"), and the agent's reply states this.
6. Identity verification, real ITSM integration, and email sending are out of scope. Tickets are simulated JSON records, and audit and tickets persist in browser localStorage.
7. Priorities: P1 for security, P2 when the employee is blocked from working, P3 for standard, P4 for informational.

## AI tools used

| Tool | How it was used |
|---|---|
| **Claude Code (Claude Opus)** | Pair-programmer. Extracted and structured the data pack, designed the pipeline, wrote the engine, UI and tests, generated the PPT with python-pptx, and wrote the docs. Every policy rule was checked against the data-pack wording. |
| **Claude API (Sonnet), optional at runtime** | Natural-language understanding layer in hybrid mode (⚙ settings). Turns messy text into schema-validated intent and entities. It is never allowed to decide. |
| **Node.js scripted tests** | Replayed all 15 requests and multi-turn conversations to check decisions before the UI was built. |

## Limitations and next steps
- Swap the keyword classifier for embeddings or an LLM with an evaluation set, and add confidence calibration.
- Connect to ServiceNow or Jira, SSO identity, and email or Teams notifications.
- Add a policy-owner workflow to reconcile KB-03 with the Asset Policy.
- Add server-side, tamper-proof audit storage (WORM) and PII redaction.

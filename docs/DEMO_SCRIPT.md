# Demo video: speaking script (about 5 minutes)

**Before recording:** open https://princegarg001.github.io/veridian-it-service-agent/ in a fresh tab and zoom the browser to 110%. Start recording with Win+Alt+R, Loom, or OBS.
Lines in *[brackets]* are what to do on screen. Everything else is what you say.

---

### 1. Intro (0:00–0:25)
*[Stay on the Agent Chat tab.]*

"Hi, I'm Prince Garg. This is my submission for Assignment 2 of the AIONOS Agentic AI Factory: an internal service agent for IT support at Veridian Corp.

The agent understands an employee's issue, finds the right policy, asks only the follow-up questions it needs, resolves simple requests, escalates risky ones, creates a structured ticket, shows the source for every answer, and keeps an audit trail. It uses only the data pack, so it never invents a policy."

### 2. Architecture (0:25–1:00)
*[Click the Architecture tab. Move the mouse along the pipeline boxes.]*

"Here's how it works. Every request goes through six stages. Intake. Understand, where it works out the intent and pulls out details like laptop age or number of failed attempts. Retrieve, where it finds the matching policy and any past tickets as precedent. Reason, where a policy handler for that intent decides what to do. Guardrails, which check risk, policy conflicts, and whether the request is covered by a policy at all. And finally Act.

The key design choice is: **the LLM proposes, the policy engine decides.** Claude can be switched on to understand messy text, but every approval, routing decision, and escalation comes from rules that are deterministic, testable, and tied to a policy ID. If no policy covers something, the agent doesn't guess. It hands it to a human."

### 3. Policy conflict: REQ-01 (1:00–1:45)
*[Click Agent Chat, then the REQ-01 button.]*

"Let's start with a tricky one. Aditi says her laptop is completely dead after three and a half years.

A simple bot would just approve a replacement. But the agent noticed that two policies disagree. KB-03, the IT policy, says laptops are eligible after three years. The Asset Management Policy from Finance, updated in Q2 2026, uses a four-year cycle and requires Finance sign-off for early replacement.

So it doesn't approve anything itself. It escalates: IT verifies the hardware failure, IT approves, and Finance signs off. It also points out that the two-week advance-notice rule doesn't really make sense for a laptop that has already died."

*[Point to the right panel, then click the AMP citation.]*

"On the right is the full reasoning trace: intent, extracted details, retrieval scores, the precedent ticket TK-1043, the conflict, and the final decision. Every citation is clickable and shows the exact policy text. Below the reply is the structured ticket it created."

### 4. Security: REQ-08 (1:45–2:15)
*[Click REQ-08.]*

"Next, Ananya thinks she got a phishing email, and she's forwarding it to teammates to check.

Security signals always win, so this is P1 Critical. The agent tells her to stop forwarding it, because KB-09 says phishing emails must not be forwarded. It tells her to report it to the security mailbox and to warn anyone who already received it. It also suggests checking it against TK-1048, the phishing investigation that's already open."

### 5. No policy, urgency pressure: REQ-10 (2:15–2:45)
*[Click REQ-10.]*

"Kavya urgently wants admin access to the finance reporting server for month-end.

There is no policy in the knowledge base for admin access, so the agent refuses to act. It flags the urgency, because urgency shouldn't bypass access controls. It asks for a business justification and manager approval, and it cites TK-1050, where a similar request was rejected for having no justification. Then it escalates to a human."

### 6. Follow-up questions (2:45–3:35)
*[Click New conversation. Type: `hey can you help, its not working`.]*

"Now a vague message, like REQ-15. The agent doesn't guess. It asks what's not working."

*[Click the VPN chip.]*

"I say VPN. The answer depends on whether the person is full-time or a contractor, so that's the only thing it asks."

*[Click Contractor.]*

"Contractors need manager approval through the access request form, so it routes the request to the manager, quoting KB-02."

*[Click "I have another issue". Type: `my laptop is broken`. Then click About 2 years.]*

"One more: a broken laptop. It asks for the age, because that decides eligibility. At two years it isn't due for replacement, so it raises a diagnosis and repair ticket instead, and explains that an early replacement would need a verified failure plus Finance sign-off."

### 7. Triage Console (3:35–4:25)
*[Click the Triage Console tab, then Run agent on full queue. Let it animate, then scroll slowly.]*

"The Triage Console runs the same agent across the whole queue: all 15 employee requests and the existing tickets.

At the top you can see the summary: how many were resolved through self-service, turned into IT tickets, routed to another team, escalated, or need more information. And zero invented policies.

The most useful column is Status check. The agent compares each recorded status with policy. For REQ-03 the status says 'reset queued', but after six failed attempts KB-01 requires a manual unlock, so a reset won't fix it. For REQ-08, escalating was right, but nobody contained the forwarded email. For REQ-04 it works out the security review window as Friday 25th to Tuesday 29th September."

*[Scroll to the ticket queue table.]*

"And in the existing queue, TK-1043 is a laptop replacement approved at 3.2 years. Under the newer asset policy that needs Finance sign-off, so the agent recommends holding fulfilment until that's confirmed."

### 8. Tickets and audit trail (4:25–4:50)
*[Click Tickets and expand one ticket's JSON. Then click Audit Trail.]*

"Every outcome becomes a structured ticket with priority, risk, owner, SLA, policy sources, conflicts, and next steps.

And here's the audit trail. Every stage is logged with who acted: the employee, the agent, the LLM, or a guardrail. Each entry is hash-chained to the previous one, so tampering is detectable. Both export as JSON."

### 9. Close (4:50–5:10)
*[Go back to Agent Chat. Hover over the ⚙ button.]*

"To wrap up: it runs from a public link or with one command locally, works offline in rules mode, and has an optional Claude hybrid mode for understanding messy language. The code, architecture, assumptions, and list of AI tools are all in the GitHub README. Thank you."

---

**After recording:** upload to Google Drive, then **Share → General access → Anyone with the link → Viewer**, and copy the link.

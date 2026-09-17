# Demo video script (about 5 minutes)

Record the live site with OBS, Loom, or Win+Alt+R (Xbox Game Bar): https://princegarg001.github.io/veridian-it-service-agent/

1. **(0:00) Intro.** "This is the Veridian IT Service Agent for Assignment 2. It's grounded only in the data pack, cites a source for every answer, and logs everything to an audit trail."
2. **(0:20) Architecture tab.** Walk through the pipeline: intake, understand, retrieve, reason, guardrails, act. Say the key line: "The LLM proposes, the policy engine decides."
3. **(0:50) Agent Chat → REQ-01.** Point out the policy conflict (KB-03 vs Asset Policy) and that the agent doesn't approve it. Show the reasoning trace on the right, then click the `AMP` citation.
4. **(1:40) REQ-08.** Phishing is P1 Critical. The agent tells the employee to stop forwarding and escalates to Security.
5. **(2:10) REQ-10.** Admin access has no policy, so the agent won't act and escalates. Point out the urgency flag and the TK-1050 precedent.
6. **(2:40) Multi-turn conversation.** Click "New conversation", type `hey can you help, its not working`, pick **VPN**, then **Contractor**. It gets routed to the manager access form. Then type `my laptop is broken`, answer `About 2 years`, and show the repair ticket.
7. **(3:30) Triage Console → Run agent on full queue.** Show the KPIs and the status corrections (REQ-03 reset vs unlock, REQ-08 containment) and the TK-1043 hold.
8. **(4:20) Tickets and Audit Trail tabs.** Show the JSON tickets and the hash-chained audit log, and export both.
9. **(4:45) Close.** Mention the GitHub repo, the one-command local run, and the optional hybrid Claude mode (⚙).

Upload to Google Drive, then **Share → General access → Anyone with the link → Viewer**.

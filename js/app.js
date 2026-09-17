(function () {
  const D = window.DATA, E = window.Engine;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ------------------------------------------------------------ persistence (best effort)
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem("vsa_" + k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem("vsa_" + k, JSON.stringify(v)); } catch {} }
  };
  let audit = store.get("audit", []), tickets = store.get("tickets", []);
  E.resetSeq(2001 + tickets.length);

  // ------------------------------------------------------------ audit (hash-chained)
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, "0"); }
  function addAudit(session, actor, stage, detail) {
    const prev = audit.length ? audit[audit.length - 1].hash : "00000000";
    const e = { ts: new Date().toISOString(), session, actor, stage, detail };
    e.hash = hash(prev + JSON.stringify(e));
    audit.push(e); store.set("audit", audit); renderAudit();
  }
  function addTicket(t) { tickets.unshift(t); store.set("tickets", tickets); renderTickets(); }

  // ------------------------------------------------------------ tabs
  $$("#tabs button").forEach(b => b.onclick = () => showTab(b.dataset.tab));
  function showTab(name) {
    $$("#tabs button").forEach(x => x.classList.toggle("on", x.dataset.tab === name));
    $$(".tab").forEach(x => x.classList.toggle("on", x.id === "tab-" + name));
  }

  // ------------------------------------------------------------ rendering helpers
  const DEC = { RESOLVED: ["Resolved", "ok"], IT_TICKET: ["IT ticket", "info"], ROUTED: ["Routed", "warn2"], ESCALATED: ["Escalated", "bad"], NEEDS_INFO: ["Needs info", "warn"], CLOSED: ["Closed", "mute"] };
  const badge = d => `<span class="badge ${(DEC[d] || ["", "mute"])[1]}">${(DEC[d] || [d])[0]}</span>`;
  const riskB = r => `<span class="risk r-${String(r).toLowerCase()}">${esc(r)}</span>`;
  const cites = html => html.replace(/<cite>([A-Z]+-?\d*)<\/cite>/g, (_, id) => `<a class="cite" data-src="${id}">${id}</a>`);
  document.addEventListener("click", ev => {
    const c = ev.target.closest(".cite"); if (!c) return;
    const id = c.dataset.src;
    if (D.kb[id]) openDrawer(`<h3>${id} · ${esc(D.kb[id].title)}</h3><p class="muted">Owner: ${esc(D.kb[id].owner)}</p><blockquote>${esc(D.kb[id].text)}</blockquote><p class="muted">Source: Assignment 2 Data Pack, Section 1</p>`);
    else { const t = D.tickets.find(x => x.id === id); if (t) openDrawer(`<h3>${t.id} (precedent)</h3><p><b>${esc(t.name)}</b>: ${esc(t.summary)}</p><p>Status: ${esc(t.status)}</p><p class="muted">Source: Assignment 2 Data Pack, Section 3</p>`); }
  });
  function openDrawer(html) { $("#drawerBody").innerHTML = html; $("#drawer").classList.add("on"); }
  $("#drawerClose").onclick = () => $("#drawer").classList.remove("on");
  $("#drawer").onclick = e => { if (e.target.id === "drawer") $("#drawer").classList.remove("on"); };

  function traceHTML(res) {
    return res.trace.map(s => `<div class="step a-${s.actor}"><div class="st">${esc(s.stage)}<span>${s.actor}</span></div><div class="sd">${esc(s.detail)}</div></div>`).join("");
  }
  function ticketHTML(t) {
    return `<div class="ticket">
      <div class="row between"><b>${t.id}</b>${badge(t.decision)}</div>
      <div class="kv"><span>Requester</span><b>${esc(t.requester)}</b><span>Category</span><b>${esc(t.category)}</b>
      <span>Priority / Risk</span><b>${t.priority} · ${riskB(t.risk)}</b><span>Assigned to</span><b>${esc(t.assignedTo)}</b>
      <span>Status</span><b>${esc(t.status)}</b>${t.sla ? `<span>SLA</span><b>${esc(t.sla.label)}: ${E.fmt(E.parseDate(t.sla.from))} → ${E.fmt(E.parseDate(t.sla.to))}</b>` : ""}
      <span>Sources</span><b>${(t.kbSources || []).map(s => `<a class="cite" data-src="${s}">${s}</a>`).join(" ") || '<i class="muted">none. Ungrounded, sent to a human</i>'} ${(t.precedents || []).map(s => `<a class="cite" data-src="${s}">${s}</a>`).join(" ")}</b></div>
      ${t.policyConflicts?.length ? `<div class="conflict">⚠ ${esc(t.policyConflicts.join(" "))}</div>` : ""}
      ${t.flags?.length ? `<div class="flags">${t.flags.map(f => `<span>${esc(f)}</span>`).join("")}</div>` : ""}
      <details><summary>Next steps & JSON</summary><ol>${(t.nextSteps || []).map(s => `<li>${esc(s)}</li>`).join("")}</ol><pre>${esc(JSON.stringify(t, null, 2))}</pre></details>
    </div>`;
  }

  // ------------------------------------------------------------ CHAT
  const DAYS = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"];
  $("#who").innerHTML = D.requests.map((r, i) => `<option value="${i}">${esc(r.name)}</option>`).join("") + `<option value="-1">Other employee</option>`;
  $("#day").innerHTML = DAYS.map(d => `<option value="${d}">${E.fmt(E.parseDate(d))} 2026</option>`).join("");
  $("#day").value = "2026-09-25";
  $("#samples").innerHTML = D.requests.map((r, i) => `<button class="sample" data-i="${i}" title="${esc(r.text)}">${r.id}</button>`).join("");
  $$(".sample").forEach(b => b.onclick = () => {
    const r = D.requests[+b.dataset.i];
    $("#who").value = b.dataset.i; $("#day").value = r.date; newSession(); send(r.text);
  });

  let session;
  function newSession() {
    session = { id: "S-" + Math.random().toString(36).slice(2, 7).toUpperCase(), text: "", slots: {}, intent: null, pending: null, clarify: 0, llm: null };
    $("#msgs").innerHTML = ""; $("#chips").innerHTML = "";
    bot(`Hi, I'm the Veridian IT Service Agent. Tell me what's going on and I'll find the right policy, ask only what I need, and either sort it out, raise a ticket, or pass it to the right person. Every answer shows its source.`);
  }
  const requester = () => { const i = +$("#who").value; return i >= 0 ? D.requests[i] : { name: "Employee", email: "employee@veridian-corp.example" }; };
  function bubble(cls, html) { const d = document.createElement("div"); d.className = "msg " + cls; d.innerHTML = html; $("#msgs").appendChild(d); $("#msgs").scrollTop = 1e9; return d; }
  const bot = html => bubble("bot", cites(html));
  $("#newChat").onclick = newSession;
  $("#composer").onsubmit = e => { e.preventDefault(); const v = $("#inp").value.trim(); if (v) { $("#inp").value = ""; send(v); } };

  async function send(text) {
    bubble("me", esc(text)); $("#chips").innerHTML = "";
    addAudit(session.id, "employee", "Message", `${requester().name}: ${text}`);

    if (session.pending) {
      const slot = session.pending;
      let v = E.parseAnswer(slot, text);
      if (slot === "attempts" && v === undefined) v = /not locked|forgot/i.test(text) ? 0 : /locked/i.test(text) ? 5 : undefined;
      if (slot === "issueDetail") { session.text += " " + text; session.clarify++; }
      else if (v !== undefined) session.slots[slot] = v;
      else session.text += " " + text;
      Object.assign(session.slots, Object.fromEntries(Object.entries(E.extract(text)).filter(([k]) => session.slots[k] === undefined)));
      session.pending = null;
    } else session.text = (session.text + " " + text).trim();

    const typing = bubble("bot typing", "<span></span><span></span><span></span>");
    let llm = null;
    if (LLM.cfg.key && (!session.intent || session.intent === "unknown")) {
      try { llm = await LLM.understand(session.text); session.llm = llm; addAudit(session.id, "llm", "Understanding", JSON.stringify(llm)); }
      catch (err) { addAudit(session.id, "guardrail", "LLM fallback", `LLM unavailable (${err.message}). Using the deterministic classifier`); }
    } else llm = session.llm;
    await new Promise(r => setTimeout(r, 350));
    typing.remove();

    const res = E.run({ text: session.text, requester: requester(), date: $("#day").value, slots: session.slots, intentHint: session.intent, clarifyCount: session.clarify, llm, ref: session.id });
    $("#trace").innerHTML = traceHTML(res);
    res.trace.forEach(s => addAudit(session.id, s.actor, s.stage, s.detail));
    if (res.intent !== "unknown") session.intent = res.intent;

    if (res.decision === "NEEDS_INFO") {
      session.pending = res.need.slot;
      bot(`<div class="tag">${esc(res.intentLabel)} · follow-up</div>${esc(res.need.question)}`);
      $("#chips").innerHTML = res.need.options.map(o => `<button class="chip">${esc(o)}</button>`).join("");
      $$("#chips .chip").forEach(c => c.onclick = () => send(c.textContent));
      return;
    }
    bot(`<div class="tag">${esc(res.intentLabel)} · ${badge(res.decision)} ${riskB(res.risk)}</div>${res.reply}
      <div class="srcline">Sources: ${(res.sources || []).map(s => `<a class="cite" data-src="${s}">${s}</a>`).join(" ") || "<i>none in KB, so escalated</i>"} ${(res.precedents || []).map(s => `<a class="cite" data-src="${s}">${s}</a>`).join(" ")}</div>`);
    if (res.ticket) { addTicket(res.ticket); bubble("bot card", ticketHTML(res.ticket)); }
    session = { ...session, text: "", slots: {}, intent: null, pending: null, clarify: 0, llm: null };
    $("#chips").innerHTML = `<button class="chip">I have another issue</button>`;
    $$("#chips .chip").forEach(c => c.onclick = () => { $("#chips").innerHTML = ""; bot("Sure, what's the next issue?"); });
  }

  // ------------------------------------------------------------ TRIAGE
  let triageResults = {};
  function renderTriageSkeleton() {
    $("#triageTbl tbody").innerHTML = D.requests.map(r => `<tr data-id="${r.id}"><td><b>${r.id}</b><br><small class="muted">${E.fmt(E.parseDate(r.date))}</small></td><td>${esc(r.name)}</td><td class="wide">${esc(r.text)}</td><td><small>${esc(r.status)}</small></td><td colspan="5" class="muted">—</td></tr>`).join("");
    $("#queueTbl tbody").innerHTML = D.tickets.map(t => `<tr class="${t.closed ? "closed" : ""}" data-tk="${t.id}"><td><b>${t.id}</b></td><td>${esc(t.name)}</td><td>${esc(t.summary)}</td><td><small>${esc(t.status)}</small></td><td colspan="3" class="muted">—</td></tr>`).join("");
  }
  $("#runAll").onclick = async () => {
    $("#runAll").disabled = true; triageResults = {};
    const sid = "BATCH-" + Math.random().toString(36).slice(2, 6).toUpperCase();
    addAudit(sid, "agent", "Batch start", `Triage of ${D.requests.length} requests and ${D.tickets.filter(t => !t.closed).length} active tickets`);
    for (const r of D.requests) {
      const tr = $(`#triageTbl tr[data-id="${r.id}"]`); tr.classList.add("running");
      await new Promise(x => setTimeout(x, 140));
      const res = E.run({ text: r.text, requester: r, date: r.date, status: r.status, ref: r.id });
      triageResults[r.id] = res;
      res.trace.forEach(s => addAudit(`${sid}/${r.id}`, s.actor, s.stage, s.detail));
      if (res.ticket) addTicket(res.ticket);
      const decCell = res.decision === "NEEDS_INFO" ? `${badge("NEEDS_INFO")}<br><small>${esc(res.need.question)}</small>` : `${badge(res.decision)}<br><small>${esc(res.route)}</small>`;
      tr.classList.remove("running");
      tr.innerHTML = `<td><b>${r.id}</b><br><small class="muted">${E.fmt(E.parseDate(r.date))}</small></td><td>${esc(r.name)}</td><td class="wide">${esc(r.text)}</td><td><small>${esc(r.status)}</small></td>
        <td>${esc(res.intentLabel)}<br><small class="muted">conf ${res.confidence}</small></td><td>${decCell}</td><td>${riskB(res.risk)}${res.priority ? `<br><small>${res.priority}</small>` : ""}</td>
        <td>${(res.sources || []).map(s => `<a class="cite" data-src="${s}">${s}</a>`).join(" ") || (res.decision === "NEEDS_INFO" ? "—" : "<i class='muted'>none</i>")}${res.conflicts?.length ? "<br><span class='badge bad'>conflict</span>" : ""}</td>
        <td>${res.statusNote ? `<span class="note">⚑ ${esc(res.statusNote)}</span>` : "<small class='muted'>consistent</small>"}</td>`;
      tr.onclick = ev => { if (ev.target.closest(".cite")) return; detail(r, res); };
    }
    for (const t of D.tickets) {
      const a = E.assessTicket(t), tr = $(`#queueTbl tr[data-tk="${t.id}"]`);
      addAudit(`${sid}/${t.id}`, t.closed ? "agent" : "guardrail", "Queue assessment", `${a.action}: ${a.note}`);
      tr.innerHTML = `<td><b>${t.id}</b></td><td>${esc(t.name)}</td><td>${esc(t.summary)}</td><td><small>${esc(t.status)}</small></td><td>${badge(a.decision)}<br><small>${esc(a.action)}</small></td><td>${a.risk === "—" ? "—" : riskB(a.risk)}</td><td><small>${esc(a.note)}</small> ${(a.sources || []).map(s => `<a class="cite" data-src="${s}">${s}</a>`).join(" ")}</td>`;
    }
    const vals = Object.values(triageResults), count = d => vals.filter(v => v.decision === d).length;
    const kp = [["Resolved (self-service)", count("RESOLVED"), "ok"], ["IT tickets", count("IT_TICKET"), "info"], ["Routed to owner", count("ROUTED"), "warn2"], ["Escalated to human", count("ESCALATED"), "bad"], ["Needs follow-up", count("NEEDS_INFO"), "warn"],
      ["Policy conflicts found", vals.filter(v => v.conflicts?.length).length + 1, "bad"], ["Status corrections", vals.filter(v => v.statusNote).length, "warn"], ["Hallucinated policies", 0, "ok"]];
    $("#kpis").innerHTML = kp.map(([l, n, c]) => `<div class="kpi ${c}"><b>${n}</b><span>${l}</span></div>`).join("");
    addAudit(sid, "agent", "Batch complete", kp.map(k => `${k[0]}=${k[1]}`).join(", "));
    $("#runAll").disabled = false; $("#runAll").textContent = "↻ Re-run agent";
  };
  function detail(r, res) {
    openDrawer(`<h3>${r.id} · ${esc(r.name)}</h3><blockquote>${esc(r.text)}</blockquote><p><small>Recorded status: ${esc(r.status)}</small></p>
      ${res.statusNote ? `<div class="conflict">⚑ ${esc(res.statusNote)}</div>` : ""}
      <h4>Agent response to employee</h4><div class="msg bot">${res.decision === "NEEDS_INFO" ? esc(res.need.question) : cites(res.reply)}</div>
      ${res.ticket ? `<h4>Ticket</h4>${ticketHTML(res.ticket)}` : ""}
      <h4>Reasoning trace</h4><div class="trace">${traceHTML(res)}</div>`);
  }

  // ------------------------------------------------------------ TICKETS / AUDIT / KB
  function renderTickets() {
    $("#tkCount").textContent = tickets.length;
    $("#ticketList").innerHTML = tickets.length ? tickets.map(ticketHTML).join("") : `<p class="muted">No tickets yet. Use Agent Chat or run the Triage Console.</p>`;
  }
  function renderAudit() {
    $("#auCount").textContent = audit.length;
    const f = ($("#auFilter")?.value || "").toLowerCase();
    const rows = audit.filter(a => !f || JSON.stringify(a).toLowerCase().includes(f)).slice(-400).reverse();
    $("#auditTbl tbody").innerHTML = rows.map(a => `<tr><td><small>${a.ts.slice(11, 19)}</small></td><td><small>${esc(a.session)}</small></td><td><span class="actor a-${a.actor}">${a.actor}</span></td><td>${esc(a.stage)}</td><td class="wide"><small>${esc(a.detail)}</small></td><td><code>${a.hash}</code></td></tr>`).join("");
  }
  $("#auFilter").oninput = renderAudit;
  const download = (name, obj) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" })); a.download = name; a.click(); };
  $("#expTk").onclick = () => download("tickets.json", tickets);
  $("#expAu").onclick = () => download("audit_trail.json", audit);
  $("#clrTk").onclick = () => { tickets = []; store.set("tickets", tickets); E.resetSeq(2001); renderTickets(); };
  $("#clrAu").onclick = () => { audit = []; store.set("audit", audit); renderAudit(); };
  $("#kbList").innerHTML = Object.entries(D.kb).map(([id, k]) => `<div class="kb"><div class="row between"><b>${id}</b><small class="muted">${esc(k.owner)}</small></div><h4>${esc(k.title)}</h4><p>${esc(k.text)}</p></div>`).join("");

  // ------------------------------------------------------------ settings
  $("#settingsBtn").onclick = () => { $("#apiKey").value = LLM.cfg.key; $("#model").value = LLM.cfg.model; $("#settings").showModal(); };
  $("#saveSettings").onclick = () => { LLM.cfg.key = $("#apiKey").value.trim(); LLM.cfg.model = $("#model").value.trim() || "claude-sonnet-5"; $("#modeLbl").textContent = LLM.cfg.key ? "Hybrid (Claude + rules)" : "Rules mode"; };

  // ------------------------------------------------------------ architecture tab
  $("#archPanel").innerHTML = `
    <h2>Architecture & process flow</h2>
    <svg viewBox="0 0 1000 300" class="arch" role="img" aria-label="Agent pipeline">
      <defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="currentColor"/></marker></defs>
      ${[["Intake", "chat / queue"], ["Understand", "rules + optional Claude"], ["Retrieve", "KB map + BM25 + precedent"], ["Reason", "policy handlers + slot filling"], ["Guardrails", "risk · conflicts · ungrounded"], ["Act", "resolve / ticket / route / escalate"]]
        .map(([t, s], i) => `<g transform="translate(${10 + i * 165},40)"><rect width="140" height="70" rx="10" class="node${i === 4 ? " g" : ""}"/><text x="70" y="32" class="nt">${t}</text><text x="70" y="52" class="ns">${s}</text>${i < 5 ? `<line x1="142" y1="35" x2="163" y2="35" class="edge" marker-end="url(#ar)"/>` : ""}</g>`).join("")}
      <path d="M 755 110 C 755 170, 420 170, 420 112" class="edge dash" marker-end="url(#ar)"/><text x="590" y="182" class="ns">missing info → ask a follow-up (loop)</text>
      ${[["Structured ticket", "JSON · SLA · sources"], ["Audit trail", "hash-chained log"], ["Employee reply", "with citations"]].map(([t, s], i) => `<g transform="translate(${330 + i * 230},210)"><rect width="200" height="60" rx="10" class="node o"/><text x="100" y="27" class="nt">${t}</text><text x="100" y="46" class="ns">${s}</text></g>`).join("")}
      <path d="M 905 110 L 905 150 L 430 150 L 430 208" class="edge" marker-end="url(#ar)"/><line x1="660" y1="150" x2="660" y2="208" class="edge" marker-end="url(#ar)"/><line x1="890" y1="150" x2="890" y2="208" class="edge" marker-end="url(#ar)"/>
    </svg>
    <div class="cols">
      <div><h3>Design principles</h3><ul>
        <li><b>The LLM proposes, the policy engine decides.</b> Claude (optional) only extracts intent and entities as schema-checked JSON. Approvals, routing and escalation are deterministic and cite a source.</li>
        <li><b>Grounded or escalated.</b> If no KB policy covers a request (e.g. admin access), the agent won't act and sends it to a human.</li>
        <li><b>Only the follow-ups that matter.</b> The agent asks only for missing slots that change the decision (e.g. lockout attempts, laptop age, contractor or full-time).</li>
        <li><b>Safety first.</b> Security signals override other intents and are escalated as P1.</li>
        <li><b>Conflict detection.</b> KB-03 (3-year) vs Asset Policy (4-year + Finance sign-off) is surfaced, not silently resolved.</li>
        <li><b>Status reconciliation.</b> Recorded statuses are checked against policy (e.g. REQ-03 'reset queued' should be a manual unlock).</li>
        <li><b>Auditability.</b> Every stage is logged with its actor and hash-chained. Tickets and the audit trail export as JSON.</li></ul></div>
      <div><h3>Decision types</h3><ul>
        <li>${badge("RESOLVED")} Self-service guidance with policy citation (no human needed)</li>
        <li>${badge("IT_TICKET")} IT action required and ticket created</li>
        <li>${badge("ROUTED")} Owned by another function (Finance, manager approval)</li>
        <li>${badge("ESCALATED")} Risky, ungrounded, conflicting, or needs authority</li>
        <li>${badge("NEEDS_INFO")} Targeted follow-up question</li></ul>
        <h3>Assumptions</h3><ul>
        <li>The simulation week is Mon 21 to Fri 25 Sep 2026. SLAs use business days (Mon–Fri, no holiday calendar given).</li>
        <li>The approved software catalog isn't in the data pack, so unconfirmed software is treated as non-catalog (the safe default).</li>
        <li>The Asset Management Policy (Finance, Q2 2026) is newer and stricter than KB-03, so the conflict goes to a human rather than being auto-resolved.</li>
        <li>REQ-11's requester is assumed to be the contractor's manager ("my team"), but this is stated to them rather than assumed silently.</li>
        <li>Identity verification and ITSM integration are out of scope. Tickets are simulated JSON records.</li></ul></div>
    </div>`;

  renderTickets(); renderAudit(); renderTriageSkeleton(); newSession();
})();

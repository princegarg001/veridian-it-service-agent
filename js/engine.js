// Veridian IT Service Agent — core reasoning engine.
// Pipeline: intake -> intent classification -> slot extraction -> retrieval (KB + precedent)
//           -> policy reasoning -> risk guardrails -> decision -> ticket -> audit.
// Design rule: an LLM (optional) may PROPOSE intent/slots; only this deterministic policy layer DECIDES.
(function () {
  const D = window.DATA;

  // ---------------------------------------------------------------- utilities
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const parseDate = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const fmt = d => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  function addBusinessDays(date, n) {
    const d = new Date(date);
    while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() % 6 !== 0) n--; }
    return d;
  }
  const addDays = (date, n) => { const d = new Date(date); d.setDate(d.getDate() + n); return d; };

  // ---------------------------------------------------------------- 1. intent classification
  const INTENTS = {
    security:   { label: "Security incident",          kb: ["KB-09"],        kw: [["phish", 6], ["malware", 6], ["virus", 5], ["suspicious", 5], ["clicked a link", 5], ["entered my password", 3], ["hacked", 5], ["unauthori", 5], ["scam", 4], ["ransomware", 6], ["compromis", 5]] },
    privileged: { label: "Privileged / admin access",  kb: [],               kw: [["admin access", 7], ["admin rights", 7], ["administrator", 5], ["root access", 6], ["privileged", 5], ["elevated", 4], ["server access", 5], ["sudo", 5], ["admin", 3]] },
    password:   { label: "Password / account lockout", kb: ["KB-01"],        kw: [["locked out", 7], ["lockout", 6], ["account locked", 7], ["password", 5], ["reset", 2], ["forgot", 3], ["tried my password", 6]] },
    vpn:        { label: "VPN access",                 kb: ["KB-02"],        kw: [["vpn", 8], ["remote access", 3]] },
    laptop:     { label: "Laptop hardware / replacement", kb: ["KB-03", "AMP"], kw: [["laptop", 7], ["won't turn on", 4], ["wont turn on", 4], ["flicker", 3], ["screen", 2], ["battery", 3], ["keyboard", 2], ["notebook", 3], ["replacement", 2]] },
    software:   { label: "Software installation",      kb: ["KB-04"],        kw: [["install", 5], ["software", 4], ["catalog", 5], ["extension", 5], ["plugin", 4], ["add-on", 4], ["application", 2], ["tool that", 1]] },
    printer:    { label: "Printer issue",              kb: ["KB-05"],        kw: [["printer", 8], ["paper jam", 5], ["print", 3], ["spooler", 5], ["toner", 4]] },
    mailbox:    { label: "Mailbox quota",              kb: ["KB-06"],        kw: [["mailbox", 8], ["quota", 5], ["inbox is full", 6], ["inbox full", 6], ["can't send email", 4], ["cant send email", 4], ["storage full", 3]] },
    guestwifi:  { label: "Guest Wi-Fi",                kb: ["KB-07"],        kw: [["guest", 5], ["wi-fi", 4], ["wifi", 4], ["visitor", 4], ["wireless", 3]] },
    expense:    { label: "Expense tool access",        kb: ["KB-08"],        kw: [["expense", 9], ["reimburse", 4], ["claims tool", 3]] },
    wfh:        { label: "Work-from-home equipment",   kb: ["KB-10", "AMP"], kw: [["working from home", 6], ["work from home", 6], ["wfh", 6], ["home office", 6], ["remote", 2], ["monitor", 3], ["chair", 4], ["days a week", 3]] }
  };

  function classify(text) {
    const t = text.toLowerCase();
    const scores = Object.entries(INTENTS).map(([k, v]) => {
      const hits = v.kw.filter(([w]) => t.includes(w));
      return { intent: k, score: hits.reduce((s, [, w]) => s + w, 0), hits: hits.map(h => h[0]) };
    }).sort((a, b) => b.score - a.score);
    const [top, second] = scores;
    if (!top || top.score < 4) return { intent: "unknown", confidence: 0.2, ranked: scores.slice(0, 3) };
    // Security always outranks other intents when present (safety-first override).
    const sec = scores.find(s => s.intent === "security");
    if (sec.score >= 5 && top.intent !== "security") return { intent: "security", confidence: 0.9, ranked: scores.slice(0, 3), override: "security-first" };
    const margin = top.score - (second ? second.score : 0);
    const confidence = Math.min(0.98, 0.55 + Math.min(top.score, 12) / 40 + Math.min(margin, 10) / 40);
    return { intent: top.intent, confidence: +confidence.toFixed(2), ranked: scores.slice(0, 3) };
  }

  // ---------------------------------------------------------------- 2. slot / entity extraction
  function extract(text) {
    const t = text.toLowerCase().replace(/[’‘]/g, "'");
    const s = {};
    let m;
    if ((m = t.match(/(\d+)\s*(?:times|attempts|tries|failed)/))) s.attempts = +m[1];
    if ((m = t.match(/(\d+(?:\.\d+)?)\s*(?:years?|yrs?)/))) s.ageYears = +m[1];
    if ((m = t.match(/(\d)\s*days?\s*(?:a|per|\/|each)\s*week/))) s.wfhDays = +m[1];
    if ((m = t.match(/(\d+)\s*gb/))) s.quotaGB = +m[1];
    if ((m = text.match(/asset\s*tag\s*(?:is|:|#)?\s*([A-Za-z0-9-]{3,})/i))) s.assetTag = m[1].toUpperCase();
    if (/contractor|vendor|consultant|temp worker/.test(t)) s.employment = "contractor";
    else if (/full[- ]?time|permanent employee/.test(t)) s.employment = "full-time";
    if (/expire/.test(t)) s.expired = true;
    if (/forward/.test(t)) s.forwarded = true;
    if (/clicked|entered my (password|login|credentials)|typed my password/.test(t)) s.credentialsEntered = true;
    if (/not in (the )?(software )?catalog|non-catalog|isn't in the catalog|not on the (approved )?list/.test(t)) s.inCatalog = false;
    else if (/(is |it's |its )?in the (approved )?catalog|catalog software|approved list/.test(t)) s.inCatalog = true;
    if (/won't turn on|wont turn on|dead|no power|doesn't boot|not boot|flicker|cracked|broken|failure|overheat|won't charge/.test(t)) s.hardwareFault = true;
    if (/dead|won't turn on|wont turn on|no power|doesn't boot/.test(t)) s.faultSeverity = "unusable";
    else if (/flicker|intermittent|on and off/.test(t)) s.faultSeverity = "degraded";
    if (/(restarted|restart(ed)? the) (print )?spooler|spooler.*restart/.test(t)) s.spoolerRestarted = true;
    if (/(checked|cleared) (the )?(print(er)? )?queue|queue (is )?(empty|clear)/.test(t)) s.queueChecked = true;
    if (/(have|has|had) an? (expense )?account|account (already )?exists|used to (work|log in)|was working/.test(t)) s.accountExists = true;
    if (/(don't|do not|never) ha(ve|d) an? (expense )?account|no account|new joiner|never (had|used)/.test(t)) s.accountExists = false;
    if (/manager (has )?(approved|signed)|have (manager )?approval|approval (is )?attached/.test(t)) s.managerApproved = true;
    if (/urgent|asap|immediately|right now|month-end|critical/.test(t)) s.urgencyPressure = true;
    if (/justification|because|required for|needed for|business reason/.test(t)) s.justification = true;
    if (/tracking|monitor(ing)? (users|employees|activity)|keylog|screen ?record|surveillance/.test(t)) s.monitoringTool = true;
    if (/tomorrow/.test(t)) s.when = "tomorrow";
    else if (/today|now/.test(t)) s.when = "today";
    if (/increase|more space|bigger|raise/.test(t)) s.wantsIncrease = true;
    if (/archiv/.test(t)) s.archived = true;
    return s;
  }

  // Parses a short answer to the specific question the agent just asked.
  function parseAnswer(slot, text) {
    const t = text.toLowerCase().trim();
    const yes = /^(y|yes|yeah|yep|sure|correct|done|i did|already|ok)\b/.test(t);
    const no = /^(n|no|nope|not yet|haven't|have not|didn't)\b/.test(t);
    const num = (t.match(/\d+(?:\.\d+)?/) || [])[0];
    switch (slot) {
      case "attempts": case "ageYears": case "wfhDays": case "quotaGB": return num ? +num : undefined;
      case "employment": return /contract|vendor|consult/.test(t) ? "contractor" : /full|perm|employee|staff/.test(t) ? "full-time" : undefined;
      case "assetTag": { const m = text.match(/[A-Za-z0-9-]{3,}/g); return m ? m[m.length - 1].toUpperCase() : undefined; }
      case "wantsIncrease": return /increase|more|bigger|yes/.test(t) ? true : /archiv|no/.test(t) ? false : undefined;
      case "faultSeverity": return /dead|won't|wont|no power|boot|unusable/.test(t) ? "unusable" : /flicker|slow|intermittent|degrad|works/.test(t) ? "degraded" : undefined;
      case "issueDetail": return text;
      default: return yes ? true : no ? false : undefined;
    }
  }

  // ---------------------------------------------------------------- 3. retrieval (lexical BM25-lite over KB)
  const tokenize = s => s.toLowerCase().match(/[a-z0-9]+/g) || [];
  const STOP = new Set("the a an and or to of for in on is are be by at it can my i with from as this that not after any all only once".split(" "));
  const kbDocs = Object.entries(D.kb).map(([id, k]) => ({ id, tokens: tokenize(k.title + " " + k.text).filter(w => !STOP.has(w)) }));
  const avgLen = kbDocs.reduce((s, d) => s + d.tokens.length, 0) / kbDocs.length;
  function retrieve(text, k = 3) {
    const q = [...new Set(tokenize(text).filter(w => !STOP.has(w)))];
    const N = kbDocs.length;
    return kbDocs.map(doc => {
      let score = 0;
      for (const w of q) {
        const tf = doc.tokens.filter(x => x === w || (w.length > 4 && x.startsWith(w.slice(0, 5)))).length;
        if (!tf) continue;
        const df = kbDocs.filter(d => d.tokens.some(x => x === w || (w.length > 4 && x.startsWith(w.slice(0, 5))))).length;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        score += idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * doc.tokens.length / avgLen));
      }
      return { id: doc.id, score: +score.toFixed(2) };
    }).filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
  }
  const precedents = intent => D.tickets.filter(t => t.intent === intent);

  // ---------------------------------------------------------------- 4. policy reasoning per intent
  // Each handler returns either {need:{slot,question,options}} or a final disposition.
  // Decisions: RESOLVED (self-service, no ticket needed) | IT_TICKET (IT acts) | ROUTED (other function owns it)
  //            | ESCALATED (human judgement / risk) | NEEDS_INFO
  const H = {};

  H.security = (s, ctx) => {
    const reasons = ["KB-09: suspected phishing/malware/unauthorised access must be reported immediately"];
    if (s.forwarded) reasons.push("Policy violation in progress: email is being forwarded to other employees (KB-09 says it must NOT be forwarded)");
    if (s.credentialsEntered) reasons.push("User may have entered credentials — possible account compromise");
    return {
      decision: "ESCALATED", priority: "P1", risk: "Critical", route: "IT Security (security@veridian-corp.example)", reasons,
      reply: `This needs to go to IT Security right away. I've escalated it.<br><br>
        <b>Please do this now:</b><ol>
        <li>Report the email to <b>${D.securityEmail}</b> immediately. <cite>KB-09</cite></li>
        <li><b>Don't forward it to anyone else.</b> ${s.forwarded ? "You mentioned you're forwarding it to teammates. Please stop, and tell anyone who already got it not to open links or attachments and to delete it." : ""} <cite>KB-09</cite></li>
        <li>Don't click links or reply to the sender.</li></ol>
        ${s.credentialsEntered ? "Because you may have entered your login, Security will treat this as a possible account compromise. You can also reset your password through the self-service portal. <cite>KB-01</cite>" : ""}`,
      nextSteps: ["Security triage and containment", s.forwarded ? "Identify every recipient of the forwarded email and warn them" : "Confirm no other recipients", "Check whether this matches the active investigation TK-1048"],
      sources: ["KB-09"].concat(s.credentialsEntered ? ["KB-01"] : [])
    };
  };

  H.privileged = (s) => {
    const reasons = ["No policy in the knowledge base covers admin or privileged access, so the agent has nothing to ground an approval on",
      "Precedent TK-1050: admin access request was rejected because no business justification was provided"];
    if (s.urgencyPressure) reasons.push("The request uses urgency (for example 'urgently', 'month-end'). Urgency doesn't bypass access controls");
    if (/finance/.test(s._text || "")) reasons.push("The target system holds finance data, so the data owner (Finance) needs to be involved");
    return {
      decision: "ESCALATED", priority: s.urgencyPressure ? "P2" : "P3", risk: "High", route: "IT Security + system owner (human approval)", reasons,
      reply: `I can't grant admin or privileged access myself, and none of our IT policies cover this kind of request, so I've sent it to a person for review.<br><br>
        To give it the best chance, please send in: <b>(1) the business reason</b> you need admin rights instead of standard access, <b>(2) written approval from your manager</b>, and <b>(3) how long you need the access</b>.
        An earlier admin access request was rejected because it had no business reason. <cite>TK-1050</cite>
        ${s.urgencyPressure ? "<br><br>I've recorded that this is urgent for month-end so the reviewer can prioritise it. The review is still required." : ""}`,
      nextSteps: ["Human reviewer (IT Security / server owner) checks the justification and manager approval", "If approved, grant least-privilege, time-limited access"],
      sources: [], precedents: ["TK-1050"], ungrounded: true
    };
  };

  H.password = (s) => {
    if (s.attempts === undefined && !/locked/.test(s._text || ""))
      return { need: { slot: "attempts", question: "Are you locked out? If so, about how many times did the password fail? The number decides whether you can fix it yourself.", options: ["Just forgot it, not locked", "Locked out after 5+ tries"] } };
    const locked = (s.attempts !== undefined && s.attempts >= 5) || (s.attempts === undefined && /locked/.test(s._text || ""));
    if (!locked) return {
      decision: "RESOLVED", priority: "P4", risk: "Low", route: "Self-service", reasons: ["Fewer than 5 failed attempts, so the account isn't locked. Self-service reset applies"],
      reply: `You can reset your password yourself at any time through the <b>self-service password portal</b>. No approval or ticket is needed. <cite>KB-01</cite>`,
      nextSteps: ["Employee resets via self-service portal"], sources: ["KB-01"], precedents: ["TK-1049"]
    };
    return {
      decision: "IT_TICKET", priority: "P2", risk: "Medium", route: "IT Service Desk: manual account unlock",
      reasons: [`${s.attempts ? s.attempts + " failed attempts" : "Locked out"}, which meets the 5-attempt lockout threshold, so IT has to unlock the account manually (KB-01)`, "Employee can't work until unlocked"],
      reply: `After 5 failed attempts the account locks, and <b>IT has to unlock it manually</b>. The self-service portal can't do it. No approval is needed. <cite>KB-01</cite><br><br>
        I've raised a manual-unlock ticket with the IT Service Desk. Once you're unlocked, you can change your password through the self-service portal. <cite>KB-01</cite>`,
      nextSteps: ["IT manually unlocks the account", "Employee sets a new password through the self-service portal if needed"],
      sources: ["KB-01"], precedents: ["TK-1049"],
      statusCheck: st => /reset queued/i.test(st) ? "Current status says 'reset queued', but KB-01 calls for a manual unlock after 5+ failed attempts. A password reset alone won't unlock the account. Change the action to a manual unlock." : null
    };
  };

  H.vpn = (s, ctx) => {
    const t = s._text || "";
    const forOther = /(new|a) contractor|joining|my team|for (my|a|our)/.test(t);
    if (s.employment === undefined && !(s.expired && !forOther))
      return { need: { slot: "employment", question: "Is the VPN access for a full-time employee or a contractor? Contractors need manager approval.", options: ["Full-time employee", "Contractor"] } };
    if (s.employment === "contractor") {
      return {
        decision: "ROUTED", priority: "P3", risk: "Medium", route: "Requesting manager → access request form → IT provisioning",
        reasons: ["Contractors need manager approval submitted through the access request form (KB-02)", "VPN isn't granted to contractors automatically"],
        reply: `Contractors <b>don't</b> get VPN access automatically. The <b>manager has to submit approval through the access request form</b>. <cite>KB-02</cite><br><br>
          ${forOther ? "If you're the contractor's manager, please fill in the access request form with the contractor's name and start date. IT will provision access after the approved form comes in." : "Please ask your manager to submit the access request form for you."}
          Contractor VPN credentials also expire every 90 days and have to be renewed. <cite>KB-02</cite>`,
        nextSteps: ["Manager submits the access request form", "IT provisions VPN when the approval is received", "Plan for the start date (next week), because approval has to land before day 1"],
        sources: ["KB-02"], ticketStatus: "Pending manager approval (access request form)"
      };
    }
    if (s.expired) return {
      decision: "RESOLVED", priority: "P3", risk: "Low", route: "Self-service renewal",
      reasons: ["VPN credentials expire every 90 days and the employee renews them (KB-02)", "Precedent TK-1042 was resolved the same way"],
      reply: `VPN credentials expire every <b>90 days</b>, and <b>you renew them yourself</b>. Renewing will bring your VPN back. <cite>KB-02</cite><br>
        If the connection still fails after renewing, reply here and I'll open an IT ticket.`,
      nextSteps: ["Employee renews VPN credentials", "Reopen as IT ticket if renewal fails"], sources: ["KB-02"], precedents: ["TK-1042"]
    };
    return {
      decision: "RESOLVED", priority: "P4", risk: "Low", route: "Self-service", reasons: ["Full-time employees get VPN access automatically (KB-02)"],
      reply: `Full-time employees get VPN access <b>automatically</b>. If it's asking you to renew, credentials expire every 90 days and you renew them yourself. <cite>KB-02</cite>`,
      nextSteps: ["Employee connects or renews"], sources: ["KB-02"], precedents: ["TK-1042"]
    };
  };

  H.laptop = (s) => {
    if (s.ageYears === undefined) return { need: { slot: "ageYears", question: "Roughly how old is the laptop, in years? Replacement eligibility depends on its age.", options: ["About 2 years", "About 3.5 years", "5 years"] } };
    if (s.hardwareFault === undefined && s.faultSeverity === undefined)
      return { need: { slot: "faultSeverity", question: "Is the laptop completely unusable (won't power on or boot), or does it work with a fault (flickering, slow)?", options: ["Completely dead", "Works but faulty"] } };
    const a = s.ageYears, conflicts = [], reasons = [];
    if (a >= 4) {
      reasons.push(`${a} yrs is at least the 4-year refresh cycle (AMP) and more than 3 yrs (KB-03), so both policies agree it's eligible`);
      return {
        decision: "IT_TICKET", priority: s.faultSeverity === "unusable" ? "P2" : "P3", risk: "Low", route: "IT Hardware: replacement", reasons,
        reply: `Your laptop is <b>eligible for replacement</b>. At ${a} years it's within the 4-year refresh cycle <cite>AMP</cite> and past the 3-year mark <cite>KB-03</cite>. I've raised a replacement ticket.<br>Replacement requests should be raised at least 2 weeks in advance. <cite>KB-03</cite>`,
        nextSteps: ["IT schedules the replacement"], sources: ["KB-03", "AMP"]
      };
    }
    if (a >= 3) {
      conflicts.push("KB-03 (IT) says laptops are eligible after 3 years, but the Asset Management Policy (Finance, updated Q2 2026) uses a 4-year refresh cycle and requires Finance sign-off plus IT approval for early replacement.");
      reasons.push(`${a} yrs is eligible under KB-03 but early under the AMP 4-year cycle, so the policies conflict`, "The newer, Finance-owned AMP adds a Finance sign-off requirement that the agent can't grant");
      if (s.faultSeverity === "unusable") reasons.push("Device reported completely dead, so the employee is blocked from working and a verified hardware failure is likely");
      return {
        decision: "ESCALATED", priority: s.faultSeverity === "unusable" ? "P2" : "P3", risk: "Medium", route: "IT Hardware (verify failure + IT approval) → Finance & Assets sign-off",
        reasons, conflicts,
        reply: `I've raised a ticket, but I <b>can't approve a replacement myself</b> because two policies disagree:<ul>
          <li>IT's laptop policy says laptops are eligible after <b>3 years</b>, or earlier if there's a verified hardware failure. <cite>KB-03</cite></li>
          <li>The Finance Asset Management Policy (updated Q2 2026) uses a <b>4-year</b> refresh cycle, and early replacement needs <b>Finance sign-off as well as IT approval</b>. <cite>AMP</cite></li></ul>
          ${s.faultSeverity === "unusable" ? "Since the laptop is completely dead, the first step is for IT to <b>verify the hardware failure</b>. " : ""}After that, the request goes to IT for approval and to Finance for sign-off.
          ${s.faultSeverity === "unusable" ? "The 2-week advance-notice rule <cite>KB-03</cite> doesn't really fit a laptop that has already failed, so I've flagged that for the reviewer too." : ""}`,
        nextSteps: ["IT technician verifies the hardware failure", "IT approval", "Finance & Assets sign-off (AMP)", "Policy owners reconcile KB-03 with AMP"],
        sources: ["KB-03", "AMP"], precedents: ["TK-1043"]
      };
    }
    // < 3 years
    reasons.push(`${a} yrs is under 3 yrs (KB-03) and under the 4-yr cycle (AMP), so it isn't eligible on age`);
    if (s.faultSeverity === "degraded") reasons.push("The fault is intermittent and the employee suggests a repair may be enough, so diagnose first");
    return {
      decision: "IT_TICKET", priority: s.faultSeverity === "unusable" ? "P2" : "P3", risk: "Low", route: "IT Hardware: diagnosis / repair", reasons,
      reply: `At ${a} years the laptop isn't due for a replacement on age <cite>KB-03</cite> <cite>AMP</cite>, so I've raised a <b>diagnosis and repair ticket</b> with IT Hardware.<br><br>
        If the technician <b>verifies a hardware failure</b> that can't be repaired, an early replacement is possible <cite>KB-03</cite>, but it needs <b>IT approval and Finance sign-off</b>. <cite>AMP</cite>`,
      nextSteps: ["IT diagnoses the fault (e.g. display/cable)", "Repair if possible", "If failure is verified and unrepairable, send for IT approval and Finance sign-off"],
      sources: ["KB-03", "AMP"]
    };
  };

  H.software = (s, ctx) => {
    const t = s._text || "";
    const risky = s.monitoringTool || /extension|plugin|add-on/.test(t);
    if (s.inCatalog === undefined && !risky)
      return { need: { slot: "inCatalog", question: "Is the software listed in the approved software catalog?", options: ["Yes, it's in the catalog", "No, not in the catalog"] } };
    if (s.inCatalog === true && !risky) return {
      decision: "RESOLVED", priority: "P4", risk: "Low", route: "Self-service install", reasons: ["Catalog software can be self-installed (KB-04)"],
      reply: `Software in the approved catalog can be <b>installed yourself</b>. No approval or ticket is needed. <cite>KB-04</cite>`, nextSteps: ["Employee self-installs"], sources: ["KB-04"]
    };
    const opened = parseDate(ctx.date);
    const from = addBusinessDays(opened, 3), to = addBusinessDays(opened, 5);
    const reasons = [s.inCatalog === false ? "Not in the approved catalog, so IT Security review is required (KB-04)" : "Catalog status wasn't confirmed, so the agent assumes it's non-catalog (safe default) and routes to IT Security review"];
    if (s.monitoringTool) reasons.push("Productivity-tracking or monitoring tools can capture user activity and data, which raises privacy and security risk. Flagged for Security's attention");
    if (/extension|plugin/.test(t)) reasons.push("Browser extensions can read page content and credentials. IT Security must vet them");
    return {
      decision: "ESCALATED", priority: "P3", risk: s.monitoringTool ? "High" : "Medium", route: "IT Security review",
      reasons, sla: { label: "IT Security review (3–5 business days)", from: iso(from), to: iso(to) },
      reply: `Anything outside the approved catalog needs an <b>IT Security review</b>, which takes <b>3–5 business days</b>. <cite>KB-04</cite><br>
        Based on the request date (${fmt(opened)}), expect a decision between <b>${fmt(from)}</b> and <b>${fmt(to)}</b>. I can't approve it myself, so I've sent it to IT Security.
        ${s.monitoringTool ? "<br><br>Because this tool tracks activity, I've marked it <b>high risk</b> for Security. Please include what data it collects, whose activity it tracks, and the vendor." : ""}
        <br><br>Please don't install it until the review is done.`,
      nextSteps: ["IT Security review", "Employee notified of the outcome", "Install only after approval"],
      sources: ["KB-04"], precedents: ["TK-1044"],
      statusCheck: st => /waiting on security/i.test(st) ? `Status is correct. Security review SLA window: ${fmt(from)} to ${fmt(to)}. If there's no decision by ${fmt(to)}, chase IT Security.` : null
    };
  };

  H.printer = (s) => {
    if (!s.spoolerRestarted && !s.queueChecked && s.firstLineDone === undefined)
      return { need: { slot: "firstLineDone", question: "Before I log a ticket: have you checked the printer queue and restarted the print spooler? That's the first step in our printer policy.", options: ["Yes, still broken", "No, not yet"] } };
    if (s.firstLineDone === false) return {
      decision: "RESOLVED", priority: "P4", risk: "Low", route: "Self-service first-line fix", reasons: ["First-line steps haven't been tried yet (KB-05)"],
      reply: `Please try these first: <ol><li><b>Check the printer queue</b> and clear any stuck jobs.</li><li><b>Restart the print spooler.</b></li></ol> <cite>KB-05</cite>
        If it still shows the error after the restart, reply here with the printer's <b>asset tag</b> and I'll log a ticket.`,
      nextSteps: ["Employee checks queue and restarts spooler", "Reopen with the asset tag if the issue persists"], sources: ["KB-05"], precedents: ["TK-1046"]
    };
    if (!s.assetTag) return { need: { slot: "assetTag", question: "Thanks. To log the ticket I need the printer's asset tag (usually on a sticker on the printer). What is it?", options: [] } };
    return {
      decision: "IT_TICKET", priority: "P3", risk: "Low", route: "IT Service Desk: printer",
      reasons: ["The issue persists after the queue check and spooler restart, so a ticket with the asset tag is required (KB-05)"],
      reply: `I've logged a printer ticket for asset tag <b>${s.assetTag}</b>. The first-line steps are done, so a technician will take it from here. <cite>KB-05</cite>`,
      nextSteps: ["Technician inspects the printer (possible sensor fault for a false paper jam)"], sources: ["KB-05"], precedents: ["TK-1046"]
    };
  };

  H.mailbox = (s) => {
    if (s.quotaGB && s.quotaGB > 50) return {
      decision: "RESOLVED", priority: "P3", risk: "Low", route: "Declined by policy cap", reasons: [`Requested ${s.quotaGB}GB, which is over the 50GB hard cap (KB-06)`],
      reply: `Mailbox quotas are <b>capped at 50GB</b>, so I can't request ${s.quotaGB}GB. <cite>KB-06</cite> Please archive old mail. You can request up to 50GB with manager approval.`, nextSteps: ["Archive old mail"], sources: ["KB-06"]
    };
    if (s.wantsIncrease === undefined) return {
      decision: "RESOLVED", priority: "P3", risk: "Low", route: "Self-service (archive) + optional increase path",
      reasons: ["The default quota is 25GB. When you're near the limit, the first step is to archive old mail (KB-06)", "An increase is possible but needs manager approval (cap 50GB)"],
      reply: `Your mailbox has hit its limit (the default quota is <b>25GB</b>). The quickest fix is to <b>archive old mail</b>, and you'll be able to send again once there's space. <cite>KB-06</cite><br><br>
        If archiving isn't enough, you can request a <b>quota increase</b>. It needs <b>manager approval</b> and is capped at <b>50GB</b>. <cite>KB-06</cite> A previous request was approved at 35GB. <cite>TK-1045</cite> Reply "increase" and I'll raise it.`,
      nextSteps: ["Employee archives old mail", "Optional: quota increase with manager approval (≤50GB)"], sources: ["KB-06"], precedents: ["TK-1045"]
    };
    return {
      decision: "IT_TICKET", priority: "P3", risk: "Low", route: "IT Messaging: quota increase (pending manager approval)",
      reasons: ["Quota increases above 25GB need manager approval, capped at 50GB (KB-06)"], ticketStatus: "Pending manager approval",
      reply: `I've raised a quota-increase ticket. It's <b>on hold until your manager approves it</b>, and the maximum is <b>50GB</b>. <cite>KB-06</cite> In the meantime, archiving old mail will let you send again.`,
      nextSteps: ["Manager approves", "IT applies the new quota (≤50GB)"], sources: ["KB-06"], precedents: ["TK-1045"]
    };
  };

  H.guestwifi = (s) => ({
    decision: "RESOLVED", priority: "P4", risk: "Low", route: "Self-service (front-desk kiosk), no ticket",
    reasons: ["Any employee can generate guest Wi-Fi at the front-desk kiosk. No IT ticket is required (KB-07)", "Credentials last 24 hours, so timing matters for a visit tomorrow"],
    reply: `You don't need IT for this. <b>Any employee can generate guest Wi-Fi credentials at the front-desk kiosk.</b> <cite>KB-07</cite><br><br>
      The credentials are <b>valid for 24 hours</b>, so ${s.when === "tomorrow" ? "generate them <b>tomorrow, when your guest arrives</b>. Codes generated today could expire during the visit." : "generate them on the day of the visit."} <cite>KB-07</cite>`,
    nextSteps: ["Employee generates credentials at the kiosk on the day of the visit"], sources: ["KB-07"], precedents: ["TK-1051"], noTicket: true
  });

  H.expense = (s) => {
    if (s.accountExists === undefined)
      return { need: { slot: "accountExists", question: "Do you already have an expense-tool account (have you logged in before)? Finance grants access, and IT can only help with login problems on existing accounts.", options: ["Yes, I've used it before", "No, never had access"] } };
    if (s.accountExists === false) return {
      decision: "ROUTED", priority: "P3", risk: "Low", route: "Finance (access provisioning)", reasons: ["Finance grants expense tool access, not IT (KB-08)"],
      reply: `Access to the expense tool is <b>granted by Finance, not IT</b>. <cite>KB-08</cite> I've routed your request to Finance. Once your account exists, IT can help with any login problems.`,
      nextSteps: ["Finance creates the account"], sources: ["KB-08"]
    };
    return {
      decision: "IT_TICKET", priority: "P3", risk: "Low", route: "IT Service Desk: expense tool login",
      reasons: ["The account exists, so IT can help with login and technical issues (KB-08)"],
      reply: `Your account already exists, so IT can help with the login problem. <cite>KB-08</cite> I've raised a ticket. To speed things up, please send a <b>screenshot of the "invalid credentials" error</b>.`,
      nextSteps: ["Employee sends a screenshot", "IT investigates the login"], sources: ["KB-08"],
      statusCheck: st => /no reply/i.test(st) ? "Stalled: waiting on the employee's screenshot with no reply. Send a reminder, and also confirm the account already exists (KB-08). If it doesn't, route to Finance." : null
    };
  };

  H.wfh = (s) => {
    if (s.wfhDays === undefined) return { need: { slot: "wfhDays", question: "How many days a week do you work from home? The allowance is for more than 3 days a week.", options: ["3 or fewer", "4", "5"] } };
    if (s.wfhDays <= 3) return {
      decision: "RESOLVED", priority: "P4", risk: "Low", route: "Not eligible", reasons: [`${s.wfhDays} days/week doesn't meet the "more than 3 days/week" requirement (KB-10)`],
      reply: `The home office allowance is for employees who work remotely <b>more than 3 days a week</b>. At ${s.wfhDays} days, you aren't eligible yet. <cite>KB-10</cite>`, nextSteps: [], sources: ["KB-10"]
    };
    return {
      decision: "ROUTED", priority: "P4", risk: "Low", route: "Manager sign-off → Finance processing → IT shipping",
      reasons: [`${s.wfhDays} days/week is more than 3, so the employee is eligible for the one-time allowance (KB-10)`, "Manager sign-off and Finance processing are required, and IT only ships after approval"],
      reply: `You're <b>eligible</b> for a one-time home office equipment allowance, which covers a monitor. <cite>KB-10</cite><br><br>
        Here's how it works: <ol><li>Your <b>manager</b> signs off.</li><li><b>Finance</b> processes the allowance.</li><li>Once it's approved, <b>IT ships</b> the equipment.</li></ol>
        I've routed the request to your manager and Finance. IT will raise the shipping request once approval comes through. <cite>KB-10</cite>`,
      nextSteps: ["Manager sign-off", "Finance processing", "IT shipping request after approval"], sources: ["KB-10"], precedents: ["TK-1047"], ticketStatus: "Pending manager sign-off"
    };
  };

  H.unknown = (s) => {
    if ((s._clarifyCount || 0) >= 2) return {
      decision: "ESCALATED", priority: "P3", risk: "Medium", route: "IT Service Desk (human triage)", reasons: ["Couldn't identify the issue after 2 clarification attempts, so it goes to a human instead of a guess"],
      reply: `I couldn't pin down the issue, so I've passed this to a person on the IT Service Desk who'll contact you directly.`, nextSteps: ["Human agent contacts the employee"], sources: [], ungrounded: true
    };
    return { need: { slot: "issueDetail", question: "Happy to help. What isn't working? For example your laptop, VPN, password, email, printer, Wi-Fi, software, or the expense tool. Any error message helps too.",
      options: ["Password / locked out", "VPN", "Laptop", "Mailbox full", "Printer", "Software install"] } };
  };

  // ---------------------------------------------------------------- 5. orchestration
  let ticketSeq = 2001;
  function run(input) {
    // input: {text, requester:{name,email}, date, status?, slots?, intentHint?, llm?}
    const trace = [];
    const log = (stage, detail, actor = "agent") => trace.push({ stage, actor, detail });
    const ctx = { date: input.date || "2026-09-25", requester: input.requester };

    log("Intake", `Request from ${input.requester?.name || "unknown"} on ${fmt(parseDate(ctx.date))}: "${input.text}"`);

    let cls = classify(input.text);
    if (input.llm && input.llm.intent && INTENTS[input.llm.intent]) {
      const agree = input.llm.intent === cls.intent;
      log("Intent (LLM)", `Claude proposed '${input.llm.intent}' (${input.llm.confidence ?? "n/a"}). Rules classifier: '${cls.intent}'. ${agree ? "They agree." : "They disagree, so the safer of the two is used."}`, "llm");
      if (!agree && cls.intent !== "security" && cls.intent !== "privileged") cls = { ...cls, intent: input.llm.intent, confidence: input.llm.confidence || 0.7 };
    }
    if (input.intentHint && input.intentHint !== "unknown" && (cls.intent === "unknown" || cls.confidence < 0.6)) cls = { ...cls, intent: input.intentHint, confidence: 0.75 };
    log("Intent", `${cls.intent === "unknown" ? "Unclear" : INTENTS[cls.intent].label} (confidence ${cls.confidence})${cls.override ? " [security-first override]" : ""}. Candidates: ${cls.ranked.filter(r => r.score).map(r => `${r.intent}:${r.score}`).join(", ") || "none"}`);

    const slots = { ...extract(input.text), ...(input.llm?.slots || {}), ...(input.slots || {}), _text: input.text.toLowerCase(), _clarifyCount: input.clarifyCount || 0 };
    const shown = Object.entries(slots).filter(([k]) => !k.startsWith("_"));
    log("Entities", shown.length ? shown.map(([k, v]) => `${k}=${v}`).join(", ") : "none extracted");

    const hits = retrieve(input.text);
    const kbIds = cls.intent !== "unknown" ? INTENTS[cls.intent].kb : [];
    log("Retrieval", `Policy map → ${kbIds.join(", ") || "no mapped policy"}. Lexical BM25 top: ${hits.map(h => `${h.id}(${h.score})`).join(", ") || "none"}` +
      (kbIds.length && hits.length && !kbIds.includes(hits[0].id) ? " (retriever disagrees, so the policy map is used)" : ""));
    const prec = cls.intent !== "unknown" ? precedents(cls.intent) : [];
    if (prec.length) log("Precedent", prec.map(p => `${p.id} ${p.summary}: ${p.status}`).join(" | "));

    const out = H[cls.intent](slots, ctx);
    if (out.need) {
      log("Follow-up", `Missing info that changes the decision: '${out.need.slot}'. Asking: ${out.need.question}`);
      let statusNote = null;
      if (input.status && /no reply/i.test(input.status)) statusNote = "Stalled: the screenshot was requested with no reply. Send a reminder and ask the question that actually decides ownership (does the account exist? KB-08). If there's still no reply, a human decides whether to close.";
      if (input.status && /technician assigned/i.test(input.status)) statusNote = "A technician is already assigned, but KB-05 first-line steps (queue check, spooler restart) and the printer asset tag aren't recorded. Capture both on the ticket.";
      if (statusNote) log("Status reconciliation", statusNote, "guardrail");
      return { intent: cls.intent, intentLabel: INTENTS[cls.intent]?.label || "Unclear", confidence: cls.confidence, decision: "NEEDS_INFO", need: out.need, statusNote, trace, slots, retrieval: hits, risk: cls.intent === "unknown" ? "Unknown" : "Low", priority: "P4" };
    }

    // ---- guardrails
    const flags = [];
    if (out.ungrounded) flags.push("No KB policy covers this, so no autonomous action was taken");
    if (out.conflicts?.length) flags.push("Policy conflict detected");
    if (slots.urgencyPressure && out.risk !== "Low") flags.push("Urgency pressure. Controls still apply");
    if (cls.confidence < 0.6 && out.decision !== "ESCALATED") { flags.push("Low confidence. Human check advised"); }
    log("Policy reasoning", out.reasons.join(" • "));
    if (out.conflicts?.length) log("Conflict", out.conflicts.join(" "), "guardrail");
    log("Guardrails", `Risk=${out.risk}. ${flags.join("; ") || "No guardrail triggered"}`, "guardrail");
    log("Decision", `${out.decision} → ${out.route} (${out.priority})`);

    let statusNote = null;
    if (input.status) {
      statusNote = out.statusCheck ? out.statusCheck(input.status) : null;
      if (!statusNote && /escalated to security/i.test(input.status) && slots.forwarded) statusNote = "The escalation is right, but containment is missing. The employee is forwarding the phishing email to teammates, which KB-09 prohibits. Tell them to stop, and identify and warn the recipients.";
      if (!statusNote && /technician assigned/i.test(input.status)) statusNote = "A technician is already assigned, but KB-05 first-line steps (queue check, spooler restart) and the printer asset tag aren't recorded. Capture both on the ticket.";
      if (statusNote) log("Status reconciliation", statusNote, "guardrail");
    }

    let ticket = null;
    if (!out.noTicket) {
      ticket = {
        id: `TK-${ticketSeq++}`, created: new Date().toISOString(), requester: input.requester?.name, email: input.requester?.email, sourceRef: input.ref || null,
        category: INTENTS[cls.intent]?.label || "Unclassified", summary: input.text.slice(0, 140), decision: out.decision, priority: out.priority, risk: out.risk,
        assignedTo: out.route, status: out.ticketStatus || ({ RESOLVED: "Resolved (self-service guidance given)", IT_TICKET: "Open (assigned)", ROUTED: "Routed (awaiting other function)", ESCALATED: "Escalated (human review)" })[out.decision],
        sla: out.sla || null, kbSources: out.sources, precedents: out.precedents || [], policyConflicts: out.conflicts || [], flags, nextSteps: out.nextSteps,
        slots: Object.fromEntries(shown)
      };
      log("Ticket", `${ticket.id} created: ${ticket.category} / ${ticket.priority} / ${ticket.status}`);
    } else log("Ticket", "No ticket needed by policy (self-service). Interaction logged in audit only");

    return { intent: cls.intent, intentLabel: INTENTS[cls.intent]?.label || "Unclear", confidence: cls.confidence, ...out, flags, statusNote, ticket, trace, slots, retrieval: hits };
  }

  // Assessment of existing ticket-queue records (Section 3).
  function assessTicket(t) {
    if (t.closed) return { action: "History only", decision: "CLOSED", note: "Closed, so not actionable. Used as precedent.", risk: "—" };
    const map = {
      "TK-1043": { decision: "ESCALATED", risk: "Medium", action: "HOLD fulfilment. Verify Finance sign-off",
        note: "The 3.2-year laptop was approved under KB-03 (3 years), but the Asset Management Policy (updated Q2 2026) uses a 4-year cycle, and early replacement needs Finance sign-off in addition to IT approval. The ticket only shows 'Approved', so confirm Finance sign-off before fulfilling.", sources: ["KB-03", "AMP"] },
      "TK-1044": { decision: "ROUTED", risk: "Medium", action: "Monitor. Chase IT Security if past SLA",
        note: "Non-catalog software is correctly with IT Security (KB-04, 3–5 business days). The data pack gives no opened date, so the SLA can't be checked. Ask Security for status. The agent doesn't approve.", sources: ["KB-04"] },
      "TK-1047": { decision: "ROUTED", risk: "Low", action: "Wait for Finance. Then raise the IT shipping request",
        note: "KB-10: manager sign-off and Finance processing come first, and IT only ships after approval. There's no IT action until Finance approves. Also confirm manager sign-off is on file.", sources: ["KB-10"] },
      "TK-1048": { decision: "ESCALATED", risk: "Critical", action: "Keep with Security. Link to REQ-08",
        note: "Active phishing investigation (KB-09). REQ-08 is a new phishing report that was forwarded to teammates, so Security should check whether it's the same campaign and widen containment.", sources: ["KB-09"] }
    };
    return map[t.id];
  }

  window.Engine = { run, classify, extract, parseAnswer, retrieve, assessTicket, INTENTS, fmt, parseDate, resetSeq: n => ticketSeq = n };
})();

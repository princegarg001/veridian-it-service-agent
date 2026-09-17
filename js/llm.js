// Optional LLM layer (Claude). Proposes intent + entities as strict JSON; never makes the decision.
window.LLM = (function () {
  const cfg = { key: "", model: "claude-sonnet-5" };
  const SYSTEM = `You are the understanding layer of an internal IT support agent at Veridian Corp.
Classify the employee message into exactly one intent and extract entities. Output ONLY JSON, no prose.
Intents: security (phishing/malware/unauthorised access), privileged (admin/elevated access), password (reset/lockout),
vpn, laptop (hardware/replacement), software (install/catalog/extensions), printer, mailbox (quota/full),
guestwifi, expense (expense tool), wfh (home office equipment), unknown (too vague to tell).
Entities (include only if clearly stated): attempts(number), ageYears(number), wfhDays(number), quotaGB(number),
employment("full-time"|"contractor"), expired(bool), forwarded(bool), credentialsEntered(bool), inCatalog(bool),
faultSeverity("unusable"|"degraded"), assetTag(string), accountExists(bool), urgencyPressure(bool), monitoringTool(bool), when("today"|"tomorrow").
Schema: {"intent": string, "confidence": number 0-1, "slots": object}. Do not guess; if vague use "unknown".`;

  async function understand(text) {
    if (!cfg.key) return null;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cfg.key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({ model: cfg.model, max_tokens: 300, system: SYSTEM, messages: [{ role: "user", content: text }] })
    });
    if (!res.ok) throw new Error(`LLM ${res.status}`);
    const j = await res.json();
    const raw = (j.content || []).map(c => c.text || "").join("");
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("LLM returned no JSON");
    const parsed = JSON.parse(m[0]);
    // schema guard: drop unknown slots
    const allowed = ["attempts","ageYears","wfhDays","quotaGB","employment","expired","forwarded","credentialsEntered","inCatalog","faultSeverity","assetTag","accountExists","urgencyPressure","monitoringTool","when"];
    parsed.slots = Object.fromEntries(Object.entries(parsed.slots || {}).filter(([k, v]) => allowed.includes(k) && v !== null && v !== undefined));
    return parsed;
  }
  return { cfg, understand };
})();

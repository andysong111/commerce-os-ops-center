// The PC owns the login attempt even when a phone or worker HTTP request ends.
export function createMobileLoginMonitor(advance, ttlMs, now = Date.now) {
  let ticket = null;
  let running = null;
  const pending = (phase) => phase === "checking" || phase === "captcha";

  function tick() {
    if (!ticket || running || !pending(ticket.phase)) return;
    if (now() >= ticket.expires) {
      ticket.phase = "expired";
      return;
    }
    const current = ticket;
    running = Promise.resolve().then(advance).then(
      (phase) => { current.phase = now() >= current.expires ? "expired" : phase; },
      () => { current.phase = "manual"; },
    ).finally(() => { running = null; });
  }

  function check(id) {
    if (ticket && !running && now() >= ticket.expires) ticket.phase = "expired";
    if (ticket && ticket.id !== id) {
      if (running || pending(ticket.phase)) return "busy";
      ticket = null;
    }
    if (!ticket) ticket = { id, phase: "checking", expires: now() + ttlMs };
    const phase = ticket.phase;
    if (pending(phase)) tick();
    else if (!running) ticket = null;
    return phase;
  }

  return { check, tick };
}

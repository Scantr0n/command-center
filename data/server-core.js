/*
 * Pure request-validation, error-shaping, and data-quality-parsing logic
 * shared between server.js and this file's own regression test suite
 * (server-core.test.js). No Node-only APIs (fs, child_process, express,
 * etc.), same shared-core pattern already proven at every hub's own
 * *-core.js (public/<hub>/data/*-core.js) and at public/alpha/data/live-core.js.
 *
 * server.js was the one file in this whole pattern that never got this
 * treatment: every hub's real math/logic already has a tested core module,
 * but server.js's own real logic (request validation, Anthropic error
 * shaping, and especially parseValidateCounts, the regex parser every
 * hub's on-page "Self-check" badge depends on to tell "clean" from "has
 * real errors") ran with zero test coverage. A miss in parseValidateCounts
 * in particular is exactly the "false clean reading" bug class already
 * fixed once for Alpha's Data Quality panel (see server.js's own git
 * history, commit a8fb0ae): silently reporting a hub as clean when
 * validate.js actually found real errors.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ServerCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // A missing credentials/token file (ENOENT, from getAuthClient's own
  // fs.readFileSync calls) means Drive was never set up on this machine at
  // all - a normal state (see CLAUDE.md: each machine needs its own OAuth
  // client) that's never worth alarming Jack over. Anything else means Drive
  // WAS working here and is now actually failing (a real invalid_grant, a
  // network drop, a revoked token) - a real, actionable gap worth surfacing,
  // not something to keep silently swallowing forever.
  function classifyDriveError(err) {
    if (!err) return null;
    if (err.code === 'ENOENT') return { state: 'not-configured' };
    return { state: 'error', message: err.message };
  }

  // Real chat history from the modal is always a short back-and-forth of
  // plain strings, so anything else (missing/malformed body, an unbounded
  // message count, one absurdly long message) is either a broken client or a
  // stuck retry loop, not a real conversation. Rejected here, before ever
  // reaching the Anthropic API, so a bad request fails fast and free instead
  // of spending a real API call to get the same rejection back from Anthropic.
  const MAX_CHAT_MESSAGES = 40;
  const MAX_CHAT_MESSAGE_LENGTH = 4000;

  function validateChatMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
      return 'messages must be a non-empty array';
    }
    if (messages.length > MAX_CHAT_MESSAGES) {
      return `messages must not exceed ${MAX_CHAT_MESSAGES} entries`;
    }
    for (const m of messages) {
      if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || !m.content.trim()) {
        return 'each message needs a role of "user" or "assistant" and non-empty string content';
      }
      if (m.content.length > MAX_CHAT_MESSAGE_LENGTH) {
        return `message content must not exceed ${MAX_CHAT_MESSAGE_LENGTH} characters`;
      }
    }
    return null;
  }

  // Anthropic's own error responses are shaped {type: 'error', error: {type,
  // message}}, one level deeper than every other error this server returns (a
  // plain {error: '...'} string). Both proxy routes used to forward that raw
  // shape straight through as the whole "error" field, so the real, specific,
  // actionable reason (a rate limit, an invalid key, a content-safety block)
  // never actually reached Jack: new Error(thatWholeObject) stringifies to
  // the literal, useless text "[object Object]" wherever a frontend tried to
  // read it as a plain message, exactly what the Garage draft form did.
  function anthropicErrorMessage(data) {
    if (data && data.error && typeof data.error.message === 'string') return data.error.message;
    if (typeof data === 'string') return data;
    return 'Anthropic API error';
  }

  // Every hub's validate.js CLI script (run every cycle via `npm run
  // validate`) already knows the real, hub-specific rules for what counts as
  // a real backfill gap. Reimplementing any of that here to show a number on
  // the dashboard would either drift from the real rules over time or
  // duplicate them outright. Running the actual CLI script as a subprocess
  // and reading its own already-trusted "N warning(s)"/"N error(s)" output
  // reuses the real rules with no duplication at all. This only needs every
  // validate.js to print that one conventional line.
  function parseValidateCounts(text) {
    const sum = (re) => {
      let match, total = 0;
      while ((match = re.exec(text))) total += Number(match[1]);
      return total;
    };
    return {
      warnings: sum(/(\d+)\s+warning\(s\)/g),
      errors: sum(/(\d+)\s+error\(s\)/g)
    };
  }

  return {
    classifyDriveError, validateChatMessages, anthropicErrorMessage, parseValidateCounts,
    MAX_CHAT_MESSAGES, MAX_CHAT_MESSAGE_LENGTH
  };
});

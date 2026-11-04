// Ticket history lives in git and the PR, so a comment may name a ticket only as the owner of future work.
const TICKET =
  /\b(?:U-\d+[a-z]?|TB-\d+|DEC:\d+|W\d+[a-z]?|P\d{2})\b|(?:^|[\s(])#\d{2,}\b|\bPR ?\d{2,}\b/;
const TODO_WITH_TICKET = /\bTODO\(U-\d+[a-z]?\):/;
const BARE_TODO = /^[\s*]*TODO\b(?!\(U-\d+[a-z]?\):)/m;

/**
 * Consecutive line comments read as one comment, so a TODO that wraps onto a second `//` line stays one TODO.
 * @param {import('eslint').AST.Program['comments']} comments
 */
function groupLineRuns(comments) {
  const groups = [];
  for (const comment of comments) {
    const last = groups.at(-1)?.at(-1);
    const continuesRun =
      last?.type === 'Line' &&
      comment.type === 'Line' &&
      comment.loc.start.line === last.loc.end.line + 1;
    if (continuesRun) groups.at(-1).push(comment);
    else groups.push([comment]);
  }
  return groups;
}

/**
 * Everything from a `TODO(U-nnn):` to the end of its comment is that TODO's text, free to name the tickets that follow.
 * @param {string} text
 * @returns {string} the part of the comment a ticket number may not appear in
 */
function textBeforeTodo(text) {
  const todo = TODO_WITH_TICKET.exec(text);
  return todo ? text.slice(0, todo.index) : text;
}

/** @type {import('eslint').Rule.RuleModule} */
const noTicketComments = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow ticket, PR and audit-item numbers in comments, except in a TODO(U-nnn) naming the ticket that will do the work',
    },
    schema: [],
    messages: {
      ticket:
        'A comment names a ticket only in `TODO(U-nnn): ...` for future work; the history belongs in git and the PR.',
      bareTodo: 'A TODO names the ticket that will do it: `TODO(U-nnn): ...`.',
    },
  },
  create(context) {
    return {
      Program() {
        for (const group of groupLineRuns(
          context.sourceCode.getAllComments(),
        )) {
          const loc = { start: group[0].loc.start, end: group.at(-1).loc.end };
          const text = group.map((comment) => comment.value).join('\n');
          if (BARE_TODO.test(text))
            context.report({ loc, messageId: 'bareTodo' });
          else if (TICKET.test(textBeforeTodo(text)))
            context.report({ loc, messageId: 'ticket' });
        }
      },
    };
  },
};

export const ticketCommentsConfig = {
  name: 'ramble/no-ticket-comments',
  plugins: { ramble: { rules: { 'no-ticket-comments': noTicketComments } } },
  rules: { 'ramble/no-ticket-comments': 'error' },
};

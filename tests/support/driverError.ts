/**
 * What the database driver throws: the query text and the values bound to it in the message, and
 * with `withCause` a connection error behind it. A test passes a secret that stands for a bound
 * value, then asserts it never reaches a log line, a thrown error or the response.
 */
export const makeDriverError = (
  secret: string,
  { withCause = false }: { withCause?: boolean } = {},
): Error => {
  const error = new Error(
    `Failed query: select ... where id = $1\nparams: ${secret}`,
  );
  return withCause
    ? Object.assign(error, {
        cause: new Error('connection to secret-host refused'),
      })
    : error;
};

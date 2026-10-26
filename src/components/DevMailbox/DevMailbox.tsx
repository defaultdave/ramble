import Link from 'next/link';
import { Button } from '@/components/Button';
import {
  formatMailboxTimestamp,
  messageStatusLabel,
  type MailboxMessage,
  type MailboxSummary,
} from '@/lib/email/message';
import styles from './DevMailbox.module.css';

type MailboxUnlockFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  denied: boolean;
  limited?: boolean;
};

export function MailboxUnlockForm({
  action,
  denied,
  limited = false,
}: MailboxUnlockFormProps) {
  return (
    <form action={action} className={styles.form}>
      <label htmlFor="mailbox-secret" className={styles.label}>
        Dev mailbox secret
      </label>
      <input
        id="mailbox-secret"
        name="secret"
        type="password"
        autoComplete="off"
        required
        maxLength={256}
        aria-describedby={
          denied || limited ? 'mailbox-secret-error' : undefined
        }
        aria-invalid={denied || undefined}
        className={styles.input}
      />
      {denied || limited ? (
        <p id="mailbox-secret-error" role="alert" className={styles.error}>
          {limited
            ? 'Too many attempts. Try again in a few minutes.'
            : 'That secret did not match.'}
        </p>
      ) : null}
      <Button type="submit">Open mailbox</Button>
    </form>
  );
}

export function MailboxList({ messages }: { messages: MailboxSummary[] }) {
  if (messages.length === 0) {
    return <p>No email has been captured yet.</p>;
  }
  return (
    <ul className={styles.list} aria-label="Captured email">
      {messages.map((message) => (
        <li key={message.id} className={styles.item}>
          <Link href={`/ops/mailbox/${message.id}`} className={styles.subject}>
            {message.subject}
          </Link>
          <span className={styles.meta}>To {message.recipient}</span>
          <span className={styles.meta}>
            <time dateTime={message.createdAt.toISOString()}>
              {formatMailboxTimestamp(message.createdAt)}
            </time>
            {' · '}
            {messageStatusLabel(message.status)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function MailboxMessageView({ message }: { message: MailboxMessage }) {
  return (
    <article className={styles.message}>
      <dl className={styles.headers}>
        <dt>To</dt>
        <dd>{message.recipient}</dd>
        <dt>Subject</dt>
        <dd>{message.subject}</dd>
        <dt>Sent</dt>
        <dd>
          <time dateTime={message.createdAt.toISOString()}>
            {formatMailboxTimestamp(message.createdAt)}
          </time>
        </dd>
        <dt>Template</dt>
        <dd>{message.template}</dd>
        <dt>Status</dt>
        <dd>{messageStatusLabel(message.status)}</dd>
      </dl>
      {/* An empty sandbox runs no script and reaches nothing outside the frame. */}
      <iframe
        title="Email preview"
        sandbox=""
        srcDoc={message.html}
        className={styles.frame}
      />
      <details>
        <summary>Plain text version</summary>
        <pre className={styles.text}>{message.textBody}</pre>
      </details>
    </article>
  );
}

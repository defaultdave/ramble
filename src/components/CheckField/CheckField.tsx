import styles from './CheckField.module.css';

export type CheckFieldProps = {
  name: string;
  label: string;
  /** What a ticked box posts; the browser's own "on" when left out. */
  value?: string;
  defaultChecked?: boolean;
  /** Why the last try refused this box, shown under it. */
  problem?: string | undefined;
};

/** A native checkbox that posts with a plain form and needs no script: for a server form that is read once on submit. */
export function CheckField({
  name,
  label,
  value,
  defaultChecked = false,
  problem,
}: CheckFieldProps) {
  return (
    <div>
      <label className={styles.check}>
        <input
          type="checkbox"
          name={name}
          value={value}
          defaultChecked={defaultChecked}
        />
        <span>{label}</span>
      </label>
      {problem ? (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      ) : null}
    </div>
  );
}

import Form from 'next/form';
import { Button } from '@/components/Button';
import { HiddenFields } from '@/components/HiddenFields';
import { classNames } from '@/lib/classNames';
import type { FormTarget } from '@/lib/pages/browse';
import styles from './TargetButton.module.css';

type TargetButtonProps = {
  target: FormTarget;
  label: string;
  variant: 'primary' | 'secondary';
  /** Takes the label's width from the tablet width up, instead of a fixed one. */
  fit?: boolean;
};

export function TargetButton({
  target,
  label,
  variant,
  fit = false,
}: TargetButtonProps) {
  return (
    <Form
      action={target.action}
      className={classNames(styles.form, fit && styles.fit)}
    >
      <HiddenFields fields={target.fields} />
      <Button type="submit" variant={variant}>
        {label}
      </Button>
    </Form>
  );
}

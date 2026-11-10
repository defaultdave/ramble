import { Button } from '@/components/Button';
import {
  HiddenFields,
  type HiddenFieldsProps,
} from '@/components/HiddenFields';
import { Input } from '@/components/Input';
import { maxSearchLength } from '@/lib/filters';
import styles from './FilterBar.module.css';

type KeywordSearchProps = {
  /** Where the form goes. */
  action: string;
  /** The name of the search field in the address. */
  name: string;
  /** The filters the form keeps, as the address writes them, without the search. */
  kept: HiddenFieldsProps['fields'];
  /** The words in the address now, if any. */
  value: string | null;
};

/** A plain GET form, so it works with scripting off and needs nothing beside the bar to submit. */
export function KeywordSearch({
  action,
  name,
  kept,
  value,
}: KeywordSearchProps) {
  return (
    <form
      className={styles.searchForm}
      action={action}
      method="get"
      role="search"
      aria-label="Search experiences"
    >
      <HiddenFields fields={kept} />
      <div className={styles.searchField}>
        <Input
          // The address can change under a mounted form, and a default value is only read at mount.
          key={value ?? ''}
          type="search"
          name={name}
          label="Search"
          maxLength={maxSearchLength}
          enterKeyHint="search"
          autoComplete="off"
          {...(value ? { defaultValue: value } : {})}
        />
      </div>
      <Button type="submit">Search</Button>
    </form>
  );
}

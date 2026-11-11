import { Search } from 'lucide-react';
import { Button, ButtonLink } from '@/components/Button';
import { HiddenFields } from '@/components/HiddenFields';
import { Input } from '@/components/Input';
import {
  carriedFields,
  changedParamHref,
  SEARCH_MAX_LENGTH,
  type TableQuery,
} from '@/lib/tableQuery';
import styles from './SearchField.module.css';

export type SearchFieldProps = {
  /** Where the search goes: the table's own path. */
  path: string;
  /** The address's params now. The rest of them ride along, so searching keeps the filter and sort. */
  query: TableQuery;
  /** The term now, already read with `parseSearchTerm`. */
  value: string;
  label?: string;
  name?: string;
  placeholder?: string;
};

/** TODO(U-073): first caller. A GET form, so it searches with no script and the term lives in the address. */
export function SearchField({
  path,
  query,
  value,
  label = 'Search',
  name = 'q',
  placeholder,
}: SearchFieldProps) {
  return (
    <form
      className={styles.form}
      role="search"
      method="get"
      action={path}
      aria-label={label}
    >
      <HiddenFields fields={carriedFields(query, name)} />
      <div className={styles.row}>
        <div className={styles.input}>
          <Input
            label={label}
            type="search"
            name={name}
            defaultValue={value}
            placeholder={placeholder}
            maxLength={SEARCH_MAX_LENGTH}
            autoComplete="off"
            enterKeyHint="search"
          />
        </div>
        <Button type="submit" size="lg" iconStart={<Search />}>
          Search
        </Button>
      </div>
      {value === '' ? null : (
        <div className={styles.clear}>
          <ButtonLink href={changedParamHref(path, query, name, null)}>
            Clear search
          </ButtonLink>
        </div>
      )}
    </form>
  );
}

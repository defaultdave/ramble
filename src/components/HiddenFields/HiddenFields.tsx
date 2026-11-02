export type HiddenFieldsProps = {
  fields: readonly (readonly [name: string, value: string])[];
};

/** One hidden input per pair, so a GET form can carry a whole address in its query. */
export function HiddenFields({ fields }: HiddenFieldsProps) {
  return fields.map(([name, value]) => (
    <input key={`${name}=${value}`} type="hidden" name={name} value={value} />
  ));
}

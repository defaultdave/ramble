// The fields roadmap/template.html renders from status.json. The digest is written by hand each session, and a list
// whose items name their fields differently renders as blank cards, so the build refuses it instead.

const REQUIRED: Record<string, readonly string[]> = {
  decisionsNeeded: ["title", "impact", "detail", "recommendation", "blocks"],
  actionsForDave: ["title", "detail", "where"],
  heldUp: ["what", "waitingOn", "owner"],
  decisionsMade: ["when", "what"],
  watch: ["what", "detail"],
};

const isText = (value: unknown) => typeof value === "string";
const isTextList = (value: unknown) => Array.isArray(value) && value.every(isText);

/** Every field the page would render empty, as `list[index].field`. Empty means the page renders in full. */
export function statusProblems(status: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const [list, fields] of Object.entries(REQUIRED)) {
    const items = status[list];
    if (!Array.isArray(items)) {
      problems.push(`${list} is not a list`);
      continue;
    }
    items.forEach((item, i) => {
      for (const field of fields) if (!isText(item?.[field])) problems.push(`${list}[${i}].${field}`);
    });
  }
  const standups = status.standups;
  if (standups === undefined) return problems;
  if (!Array.isArray(standups)) return [...problems, "standups is not a list"];
  standups.forEach((day, i) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day?.date)) problems.push(`standups[${i}].date`);
    for (const field of ["done", "today"]) if (!isTextList(day?.[field])) problems.push(`standups[${i}].${field}`);
    if (!Array.isArray(day?.heldUs)) problems.push(`standups[${i}].heldUs`);
    else
      day.heldUs.forEach((held: Record<string, unknown>, j: number) => {
        for (const field of ["what", "cost"]) if (!isText(held?.[field])) problems.push(`standups[${i}].heldUs[${j}].${field}`);
      });
  });
  return problems;
}

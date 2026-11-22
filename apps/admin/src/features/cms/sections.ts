import { z } from 'zod';
import { baseSchema } from './ContentFields';
import { cmsFieldId, entryLabel, fieldLabel, lockedField } from './content-model';

export type CmsSection = { id: string; label: string; fieldLabels: string[] };

const isGroup = (schema: z.ZodType) => {
  const node = baseSchema(schema);
  return node instanceof z.ZodObject || node instanceof z.ZodArray;
};

/** Every editable field label inside a schema, for "Find a field". */
function labelsOf(schema: z.ZodType, depth = 0): string[] {
  const node = baseSchema(schema);
  if (depth > 5) return [];
  if (node instanceof z.ZodArray) return labelsOf(node.element as z.ZodType, depth + 1);
  if (!(node instanceof z.ZodObject)) return [];
  return Object.entries(node.shape)
    .filter(([key]) => !lockedField(key))
    .flatMap(([key, child]) => [fieldLabel(key), ...labelsOf(child as z.ZodType, depth + 1)]);
}

/** Jump targets for the section navigator, in the order the editor renders them. */
export function cmsSections(schema: z.ZodType, value: unknown, path: string): CmsSection[] {
  const node = baseSchema(schema);
  if (node instanceof z.ZodArray) {
    const list = Array.isArray(value) ? value : [];
    const fieldLabels = labelsOf(node.element as z.ZodType);
    return list.map((item, i) => ({
      id: cmsFieldId(`${path}.${i}`),
      label: entryLabel(item, `Entry ${i + 1}`),
      fieldLabels,
    }));
  }
  if (!(node instanceof z.ZodObject)) return [];
  const entries = Object.entries(node.shape).filter(([key]) => !lockedField(key)) as [
    string,
    z.ZodType,
  ][];
  const loose = entries.filter(([, child]) => !isGroup(child));
  return [
    ...(loose.length
      ? [
          {
            id: cmsFieldId(path),
            label: 'General details',
            fieldLabels: loose.map(([k]) => fieldLabel(k)),
          },
        ]
      : []),
    ...entries
      .filter(([, child]) => isGroup(child))
      .map(([key, child]) => ({
        id: cmsFieldId(`${path}.${key}`),
        label: fieldLabel(key),
        fieldLabels: labelsOf(child),
      })),
  ];
}

export function filterSections(sections: CmsSection[], query: string): CmsSection[] {
  const q = query.trim().toLowerCase();
  if (!q) return sections;
  return sections.filter((s) =>
    [s.label, ...s.fieldLabels].some((label) => label.toLowerCase().includes(q)),
  );
}

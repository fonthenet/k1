// Suggested starting points, not an official curriculum or clinical protocol.
export const programTemplates = {
  nursery: ["sensory", "movement", "routines"],
  kindergarten: ["stories", "numbers", "creative"],
  montessori: ["practical", "sensory", "numbers"],
  private_primary: ["arabic", "maths", "french"],
  private_middle: ["arabic", "maths", "science", "french", "english"],
  private_secondary: ["arabic", "maths", "science", "french", "english"],
  edu_center: ["french", "english", "maths"],
  therapy_center: ["communication", "cooperation"],
  activity_center: ["creative", "movement", "cooperation"],
  camp: ["creative", "movement", "cooperation"],
} as const;

export function templatesForType(type: string): readonly string[] {
  return Object.hasOwn(programTemplates, type)
    ? programTemplates[type as keyof typeof programTemplates]
    : [];
}

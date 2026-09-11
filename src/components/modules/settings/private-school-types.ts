export const PRIVATE_SCHOOL_TYPES = ["private_primary", "private_middle", "private_secondary"] as const;
export type PrivateSchoolType = (typeof PRIVATE_SCHOOL_TYPES)[number];

export function isPrivateSchool(type: string): type is PrivateSchoolType {
  return (PRIVATE_SCHOOL_TYPES as readonly string[]).includes(type);
}

export function supportsPrivateSchools(values: unknown): boolean {
  return Array.isArray(values) && PRIVATE_SCHOOL_TYPES.every((type) => values.includes(type));
}

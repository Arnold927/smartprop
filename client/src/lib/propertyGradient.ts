/**
 * Shared gradient palette for property & unit placeholders.
 * Both property cards (properties.tsx) and unit cards (PropertyUnitCard.tsx)
 * call this with the *property name* so a unit always matches its parent property.
 * Palette uses the app's emerald brand tone as anchor, with complementary hues.
 */
export const PROPERTY_GRADIENTS = [
  "from-emerald-400 to-teal-500",
  "from-teal-400 to-cyan-500",
  "from-cyan-500 to-emerald-600",
  "from-emerald-500 to-green-600",
  "from-green-400 to-teal-500",
  "from-teal-500 to-emerald-500",
  "from-emerald-400 to-cyan-600",
  "from-cyan-400 to-teal-600",
] as const;

/**
 * Returns a stable Tailwind gradient class for a given property name.
 * The same name will always return the same gradient.
 */
export function getPropertyGradient(propertyName: string): string {
  const a = propertyName.charCodeAt(0) || 0;
  const b = propertyName.charCodeAt(1) || 0;
  const idx = (a + b) % PROPERTY_GRADIENTS.length;
  return PROPERTY_GRADIENTS[idx];
}

// ISO 3166-2:IN codes for every Indian state and union territory. The postal API returns state NAMES only, so the code is
// derived from the name. This is reference data about states, not about PIN codes: lookup itself is never restricted by it.
const STATES: [code: string, name: string, aliases?: string[]][] = [
  ["AN", "Andaman and Nicobar Islands", ["andaman nicobar", "andaman and nicobar"]],
  ["AP", "Andhra Pradesh"],
  ["AR", "Arunachal Pradesh"],
  ["AS", "Assam"],
  ["BR", "Bihar"],
  ["CH", "Chandigarh"],
  ["CG", "Chhattisgarh", ["chattisgarh"]],
  ["DH", "Dadra and Nagar Haveli and Daman and Diu", ["dadra nagar haveli", "daman diu", "dadra and nagar haveli", "daman and diu"]],
  ["DL", "Delhi", ["nct of delhi", "new delhi", "national capital territory of delhi"]],
  ["GA", "Goa"],
  ["GJ", "Gujarat"],
  ["HR", "Haryana"],
  ["HP", "Himachal Pradesh"],
  ["JK", "Jammu and Kashmir"],
  ["JH", "Jharkhand"],
  ["KA", "Karnataka"],
  ["KL", "Kerala"],
  ["LA", "Ladakh"],
  ["LD", "Lakshadweep"],
  ["MP", "Madhya Pradesh"],
  ["MH", "Maharashtra"],
  ["MN", "Manipur"],
  ["ML", "Meghalaya"],
  ["MZ", "Mizoram"],
  ["NL", "Nagaland"],
  ["OD", "Odisha", ["orissa"]],
  ["PY", "Puducherry", ["pondicherry"]],
  ["PB", "Punjab"],
  ["RJ", "Rajasthan"],
  ["SK", "Sikkim"],
  ["TN", "Tamil Nadu", ["tamilnadu"]],
  ["TS", "Telangana", ["telengana"]],
  ["TR", "Tripura"],
  ["UP", "Uttar Pradesh"],
  ["UK", "Uttarakhand", ["uttaranchal"]],
  ["WB", "West Bengal"],
];

const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z ]+/g, " ").replace(/\b(the|of)\b/g, " ").replace(/\s+/g, " ").trim();

const INDEX = new Map<string, string>();
for (const [code, name, aliases = []] of STATES) for (const n of [name, ...aliases]) INDEX.set(norm(n), code);

/** ISO 3166-2:IN code for a state/UT name as used by India Post, or null when the name is not recognised. */
export function stateCodeFor(name: string | null | undefined): string | null {
  return name ? (INDEX.get(norm(name)) ?? null) : null;
}

export const STATE_COUNT = STATES.length;

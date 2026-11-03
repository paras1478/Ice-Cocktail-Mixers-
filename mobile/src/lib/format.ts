/** Money is integer paise everywhere; format only for display. */
export const money = (minor: number) => `₹${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

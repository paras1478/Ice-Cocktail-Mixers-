import type { Prisma } from "@prisma/client";

/** Free-text product match (name, brand, description, category name), shared by the shop search and the voice assistant. */
export const searchWhere = (q: string): Prisma.ProductWhereInput => ({
  OR: [
    { name: { contains: q, mode: "insensitive" } },
    { brand: { contains: q, mode: "insensitive" } },
    { description: { contains: q, mode: "insensitive" } },
    { category: { name: { contains: q, mode: "insensitive" } } },
  ],
});

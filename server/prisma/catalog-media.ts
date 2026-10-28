// Product identifiers, pack-size groups and photos layered on top of catalog.ts.
//
// Photo rules:
//  * Every photo here is a REPRESENTATIVE stock photo of the kind of item (placeholder: true). None shows the exact branded pack,
//    so the product page labels it "Representative photo, not necessarily the exact product".
//  * One photo is used for one product only. Branded products (Schweppes, Svami, Bisleri) and items with no suitable licensed photo
//    keep the neutral "coming soon" image: no other brand's packaging and no invented packaging is ever shown for them.
//  * Credits: client/public/img/stock/CREDITS.json.
//
// SKU is the store's own internal identifier (ICX-<category>-<number>), not a manufacturer code.

import type { ImageInfo } from "./catalog.js";

const stock = (file: string, alt: string, source: string, license: string, attribution: string): ImageInfo => ({
  url: `/img/stock/${file}`,
  alt: `${alt} (representative photo, not the exact product)`,
  placeholder: true,
  sourceUrl: source,
  license,
  attribution,
});

export interface ProductMedia {
  sku: string;
  /** Products with the same group are offered to the customer as pack sizes of one another. */
  variantGroup?: string;
  /** Replaces the image from catalog.ts when present. */
  image?: ImageInfo;
}

export const media: Record<string, ProductMedia> = {
  "crystal-clear-party-ice-1kg": { sku: "ICX-ICE-001", variantGroup: "party-ice" },
  "party-ice-5kg": {
    sku: "ICX-ICE-002",
    variantGroup: "party-ice",
    image: stock("ice-bucket.jpg", "Heap of clear ice cubes in a metal bucket", "https://www.pexels.com/photo/ice-cubes-in-a-metal-bucket-11089354/", "Pexels License (free for commercial use)", "Markus Winkler"),
  },
  "crushed-ice-1kg": { sku: "ICX-ICE-003" },
  // A genuine photo of the exact pack (Indian Tonic Water can), supplied by the store owner; the owner confirmed permission to use it.
  "schweppes-indian-tonic-water-300ml": {
    sku: "ICX-TON-001",
    image: {
      url: "/img/products/schweppes-indian-tonic-water-300ml.png",
      alt: "Schweppes Indian Tonic Water, 300 ml can",
      placeholder: false,
      sourceUrl: "Supplied by the store owner (photo of the product pack)",
      license: "Supplied by the store owner, who confirmed permission to use it on this site",
      attribution: "Store owner",
    },
  },
  // A genuine pack image (Svami Original Tonic Water bottle) supplied by the store owner, who confirmed permission to use it.
  "svami-original-craft-tonic-water-200ml": {
    sku: "ICX-TON-002",
    image: {
      url: "/img/products/svami-original-craft-tonic-water-200ml.jpg",
      alt: "Svami Original Tonic Water, glass bottle",
      placeholder: false,
      sourceUrl: "Supplied by the store owner (product pack image)",
      license: "Supplied by the store owner, who confirmed permission to use it on this site",
      attribution: "Store owner",
    },
  },
  // A genuine pack image (Bisleri Club Soda, "Extra Power" label) supplied by the store owner, who confirmed permission to use it.
  "bisleri-club-soda-750ml": {
    sku: "ICX-SOD-001",
    image: {
      url: "/img/products/bisleri-club-soda-750ml.jpg",
      alt: "Bisleri Club Soda Extra Power bottle with ice cubes and a water splash",
      placeholder: false,
      sourceUrl: "Supplied by the store owner (product pack image)",
      license: "Supplied by the store owner, who confirmed permission to use it on this site",
      attribution: "Store owner",
    },
  },
  "ginger-ale-300ml": {
    sku: "ICX-SOD-002",
    image: stock("golden-fizzy-drink.jpg", "Glass of golden fizzy drink with ice", "https://www.pexels.com/photo/clear-drinking-glass-with-yellow-liquid-12987271/", "Pexels License (free for commercial use)", "Srattha Nualsate"),
  },
  "spicy-ginger-beer-300ml": {
    sku: "ICX-SOD-003",
    image: stock("ginger-lemon-cooler.jpg", "Tall glass of a chilled ginger and lemon drink", "https://www.pexels.com/photo/refreshing-lemon-ginger-cooler-in-tall-glass-35532831/", "Pexels License (free for commercial use)", "Athul Santhosh"),
  },
  "sparkling-water-750ml": {
    sku: "ICX-SOD-004",
    image: stock("sparkling-water-glass.jpg", "Glass of sparkling water with rising bubbles", "https://www.pexels.com/photo/a-close-up-shot-of-a-glass-of-sparkling-water-13723906/", "Pexels License (free for commercial use)", "Sam Mai"),
  },
  "margarita-mixer-500ml": {
    sku: "ICX-MAR-001",
    image: stock("lime-drink.jpg", "Fresh lime drink in a glass with a lime slice", "https://www.pexels.com/photo/lime-juice-on-glass-cup-with-lime-on-rim-8679344/", "Pexels License (free for commercial use)", "Timur Weber"),
  },
  "spicy-mango-margarita-500ml": {
    sku: "ICX-MAR-002",
    image: stock("mango-juice-bottle.jpg", "Mango juice in a glass bottle beside fresh mango", "https://www.pexels.com/photo/mango-juice-in-clear-glass-bottle-4955257/", "Pexels License (free for commercial use)", "Roman Odintsov"),
  },
  "aromatic-bitters-sample": { sku: "ICX-BIT-001" },
  "orange-bitters-sample": {
    sku: "ICX-BIT-002",
    image: stock("bitters-glass-bottles.jpg", "Glass bitters bottles on a bar", "https://www.pexels.com/photo/glass-bitters-bottles-7494023/", "Pexels License (free for commercial use)", "Roman Odintsov"),
  },
  "dehydrated-lime-garnish-sample": { sku: "ICX-CIT-001" },
  "dehydrated-orange-garnish": { sku: "ICX-CIT-002" },
  "margarita-rimming-salt": {
    sku: "ICX-CIT-003",
    image: stock("salt-wooden-spoon.jpg", "Coarse salt with a wooden spoon", "https://www.pexels.com/photo/close-up-shot-of-a-wooden-spoon-and-salt-9974510/", "Pexels License (free for commercial use)", "Marek Kupiec"),
  },
  "cocktail-shaker": { sku: "ICX-PTY-001" },
  "stainless-jigger": {
    sku: "ICX-PTY-002",
    image: stock("jigger.jpg", "Stainless steel jigger on a bar counter", "https://www.pexels.com/photo/close-up-shot-of-a-jigger-8942294/", "Pexels License (free for commercial use)", "cottonbro studio"),
  },
  "paper-straws-50": { sku: "ICX-PTY-003" },
};

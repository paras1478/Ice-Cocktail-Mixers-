// CENTRAL CATALOG DATA: the single source for seeded products, prices and images.
// Ice & Cocktail Mixers Express sells ice, craft tonic, club soda, margarita mixes, bitters, citrus garnishes,
// party bundles and non-alcoholic party essentials only. There are no alcoholic products or categories.
//
// Rules this file follows:
//  * Every price here is development SAMPLE data: no retailer or manufacturer page could be read to confirm it.
//    To verify a price set priceInfo { status: "VERIFIED", mrp, sourceUrl, verifiedAt } (needs source + date).
//  * MRP / discount % are only honoured (shown / used) for VERIFIED prices.
//  * image.placeholder = true means a stand-in (representative stock photo, or "coming soon"), NOT a real photo of
//    the exact product. A real product photo needs sourceUrl + license (permission to use it on this site).
//  * No ingredients, certifications, ratings or food-safety claims unless taken from the product's own label.

export type PriceInfo =
  | { status: "VERIFIED"; mrp?: number; sourceUrl: string; verifiedAt: string; notes?: string }
  | { status: "SAMPLE"; notes?: string };

export interface ImageInfo {
  url: string;
  alt: string;
  placeholder: boolean;
  sourceUrl?: string;
  license?: string;
  attribution?: string;
}

export interface CatalogProduct {
  slug: string;
  name: string;
  brand?: string;
  category: string;
  packSize: string;
  price: number; // rupees (converted to integer paise on seed)
  priceNotes?: string;
  stock: number;
  popularity: number;
  description: string;
  details?: string;
  image: ImageInfo;
}

export interface CatalogCategory {
  slug: string;
  name: string;
  description: string;
  imageUrl?: string;
}

// The eight approved categories, in navigation order.
export const categories: CatalogCategory[] = [
  {
    slug: "ice-bags",
    name: "Ice Bags",
    description: "Crystal-clear, food-grade party ice in handy bags.",
    imageUrl: "/img/stock/ice-cubes.jpg"
  },
  {
    slug: "tonic-water",
    name: "Tonic Water",
    description: "Craft tonic waters for the perfect highball.",
    imageUrl: "/img/stock/category-tonic-water.jpg"
  },
  {
    slug: "club-soda",
    name: "Club Soda",
    description: "Club soda, flavoured sodas, ginger ale and sparkling water for highballs and spritzers.",
    imageUrl: "/img/stock/category-club-soda.jpg"
  },
  {
    slug: "margarita-mixes",
    name: "Margarita Mixes",
    description: "Margarita and sour mixers (non-alcoholic).",
    imageUrl: "/img/stock/category-margarita-mixes.jpg"
  },
  {
    slug: "bitters",
    name: "Bitters",
    description: "Cocktail bitters to finish any drink.",
    imageUrl: "/img/stock/bitters-bottle.jpg"
  },
  {
    slug: "citrus-garnishes",
    name: "Citrus Garnishes",
    description: "Dehydrated citrus wheels and rimming salts.",
    imageUrl: "/img/stock/dehydrated-orange.jpg"
  },
  {
    slug: "party-bundles",
    name: "Party Bundles",
    description: "Curated kits that bundle everything for the night, at a saving.",
    imageUrl: "/img/stock/category-party-bundles.jpg"
  },
  {
    slug: "party-essentials",
    name: "Party Essentials",
    description: "Non-alcoholic bar tools and party accessories: shakers, jiggers, straws.",
    imageUrl: "/img/stock/bar-shaker.jpg"
  }
];

export const products: CatalogProduct[] = [
  {
    slug: "svami-original-craft-tonic-water-200ml",
    name: "Svami Original Craft Tonic Water",
    brand: "Svami",
    category: "tonic-water",
    packSize: "200 ml",
    price: 85,
    priceNotes: "UNVERIFIED. Search results quoted BigBasket at ₹85 for the 200 ml bottle; page not fetched. A 300 ml size was not found in any source — do not list 300 ml without confirming. Official site svamidrinks.com returned HTTP 429.",
    stock: 70,
    popularity: 74,
    description: "Svami Original Craft Tonic Water, 200 ml.",
    image: {
      url: "/img/coming-soon.svg",
      alt: "Svami Original Craft Tonic Water 200 ml — product photo coming soon",
      placeholder: true
    }
  },
  {
    slug: "bisleri-club-soda-750ml",
    name: "Bisleri Club Soda",
    brand: "Bisleri",
    category: "club-soda",
    packSize: "750 ml",
    price: 20,
    priceNotes: "UNVERIFIED. Search snippets: BigBasket listed 'Club Soda – Extra Power' 750 ml at ₹16 vs ₹20; Instamart ₹16. The 'Extra Fizz' variant name was not found in any source — confirm the exact variant name on the bottle. bisleri.com shows no prices.",
    stock: 120,
    popularity: 88,
    description: "Bisleri club soda, 750 ml.",
    image: {
      url: "/img/coming-soon.svg",
      alt: "Bisleri Club Soda 750 ml — product photo coming soon",
      placeholder: true
    }
  },
  {
    slug: "party-ice-5kg",
    name: "Party Ice Value Bag",
    category: "ice-bags",
    packSize: "5 kg",
    price: 220,
    priceNotes: "Unbranded demo item. Price and image are placeholders until a real product is sourced.",
    stock: 60,
    popularity: 80,
    description: "A bigger bag of ice for bigger nights.",
    image: {
      url: "/img/stock/ice-cubes.jpg",
      alt: "Clear ice cubes on a dark background (representative photo, not the exact product)",
      placeholder: true,
      sourceUrl: "https://unsplash.com/photos/a-close-up-of-ice-cubes-on-a-black-background-eYrb_2d6bfk",
      license: "Unsplash License (free for commercial use)",
      attribution: "Dmitriy Frantsev"
    }
  },
  {
    slug: "spicy-ginger-beer-300ml",
    name: "Ginger Beer",
    category: "club-soda",
    packSize: "300 ml",
    price: 95,
    priceNotes: "Unbranded demo item. Price and image are placeholders until a real product is sourced.",
    stock: 0,
    popularity: 66,
    description: "Non-alcoholic ginger beer.",
    image: {
      url: "/img/coming-soon.svg",
      alt: "Ginger beer bottle, 300 ml — product photo coming soon",
      placeholder: true
    }
  },
  {
    slug: "sparkling-water-750ml",
    name: "Sparkling Water",
    category: "club-soda",
    packSize: "750 ml",
    price: 80,
    priceNotes: "Unbranded demo item. Price and image are placeholders until a real product is sourced.",
    stock: 75,
    popularity: 48,
    description: "Sparkling water.",
    image: {
      url: "/img/coming-soon.svg",
      alt: "Sparkling water bottle, 750 ml — product photo coming soon",
      placeholder: true
    }
  },
  {
    slug: "margarita-mixer-500ml",
    name: "Margarita Mixer",
    category: "margarita-mixes",
    packSize: "500 ml",
    price: 249,
    priceNotes: "Unbranded demo item. Price and image are placeholders until a real product is sourced.",
    stock: 55,
    popularity: 88,
    description: "Non-alcoholic margarita mixer, ready to serve over ice.",
    image: {
      url: "/img/coming-soon.svg",
      alt: "Margarita mixer bottle, 500 ml — product photo coming soon",
      placeholder: true
    }
  },
  {
    slug: "aromatic-bitters-sample",
    name: "Aromatic Bitters",
    category: "bitters",
    packSize: "Sample bottle",
    price: 199,
    priceNotes: "Unbranded demo item. Price and image are placeholders until a real product is sourced.",
    stock: 45,
    popularity: 58,
    description: "Aromatic cocktail bitters.",
    image: {
      url: "/img/stock/bitters-bottle.jpg",
      alt: "Amber glass dropper bottle with a blank label (representative photo, not the exact product)",
      placeholder: true,
      sourceUrl: "https://www.pexels.com/photo/close-up-of-cosmetic-liquid-bottle-on-white-background-8054405/",
      license: "Pexels License (free for commercial use)",
      attribution: "Ksenia Chernaya"
    }
  },
  {
    slug: "orange-bitters-sample",
    name: "Orange Bitters",
    category: "bitters",
    packSize: "Sample bottle",
    price: 199,
    priceNotes: "Unbranded demo item. Price and image are placeholders until a real product is sourced.",
    stock: 30,
    popularity: 40,
    description: "Orange cocktail bitters.",
    image: {
      url: "/img/stock/bitters-bottle.jpg",
      alt: "Amber glass dropper bottle with a blank label (representative photo, not the exact product)",
      placeholder: true,
      sourceUrl: "https://www.pexels.com/photo/close-up-of-cosmetic-liquid-bottle-on-white-background-8054405/",
      license: "Pexels License (free for commercial use)",
      attribution: "Ksenia Chernaya"
    }
  },
  {
    slug: "dehydrated-lime-garnish-sample",
    name: "Dehydrated Lime Garnish",
    category: "citrus-garnishes",
    packSize: "Sample pack",
    price: 149,
    priceNotes: "Unbranded demo item. Price and image are placeholders until a real product is sourced.",
    stock: 60,
    popularity: 72,
    description: "Dried lime wheels for garnishing drinks.",
    image: {
      url: "/img/stock/dehydrated-lime.jpg",
      alt: "Dried citrus slices with green rinds (representative photo, not the exact product)",
      placeholder: true,
      sourceUrl: "https://www.pexels.com/photo/dried-lemon-slices-15823364/",
      license: "Pexels License (free for commercial use)",
      attribution: "Mathilde Langevin"
    }
  },
  {
    slug: "dehydrated-orange-garnish",
    name: "Dehydrated Orange Wheels",
    category: "citrus-garnishes",
    packSize: "Pack of 12",
    price: 169,
    priceNotes: "Unbranded demo item. Price and image are placeholders until a real product is sourced.",
    stock: 50,
    popularity: 63,
    description: "Dried orange wheels for garnishing drinks.",
    image: {
      url: "/img/stock/dehydrated-orange.jpg",
      alt: "Dried orange slices (representative photo, not the exact product)",
      placeholder: true,
      sourceUrl: "https://www.pexels.com/photo/dried-slices-of-orange-fruit-with-sugar-on-blue-surface-5378835/",
      license: "Pexels License (free for commercial use)",
      attribution: "Mareefe"
    }
  },
  {
    slug: "margarita-rimming-salt",
    name: "Margarita Rimming Salt",
    category: "citrus-garnishes",
    packSize: "100 g",
    price: 119,
    priceNotes: "Unbranded demo item. Price and image are placeholders until a real product is sourced.",
    stock: 9,
    popularity: 35,
    description: "Rimming salt for margaritas.",
    image: {
      url: "/img/coming-soon.svg",
      alt: "Margarita Rimming Salt, 100 g (product photo coming soon)",
      placeholder: true
    }
  },
  {
    slug: "paper-straws-50",
    name: "Paper Straws",
    category: "party-essentials",
    packSize: "Pack of 50",
    price: 99,
    priceNotes: "Unbranded demo item. Price and image are placeholders until a real product is sourced.",
    stock: 150,
    popularity: 44,
    description: "Paper drinking straws.",
    image: {
      url: "/img/stock/paper-straws.jpg",
      alt: "Striped paper straws (representative photo, not the exact product)",
      placeholder: true,
      sourceUrl: "https://unsplash.com/photos/assorted-color-straws-NLSvKQTJOz0",
      license: "Unsplash License (free for commercial use)",
      attribution: "Meghan Rodgers"
    }
  },
  {
    slug: "cocktail-shaker",
    name: "Boston Cocktail Shaker",
    category: "party-essentials",
    packSize: "750 ml",
    price: 599,
    priceNotes: "Unbranded demo item. Price and image are placeholders until a real product is sourced.",
    stock: 15,
    popularity: 38,
    description: "Two-piece cocktail shaker.",
    image: {
      url: "/img/stock/bar-shaker.jpg",
      alt: "Stainless steel cocktail shaker with a jigger on a bar mat (representative photo, not the exact product)",
      placeholder: true,
      sourceUrl: "https://www.pexels.com/photo/stainless-steel-shaker-on-marble-top-table-4485345/",
      license: "Pexels License (free for commercial use)",
      attribution: "Antoni Shkraba"
    }
  },
  {
    slug: "crushed-ice-1kg",
    name: "Crushed Ice",
    category: "ice-bags",
    packSize: "1 kg",
    price: 70,
    priceNotes: "Unbranded demo item. Price and image are placeholders until a real product is sourced.",
    stock: 8,
    popularity: 55,
    description: "Crushed ice for slushies, mojitos and juleps.",
    image: {
      url: "/img/stock/crushed-ice.jpg",
      alt: "Crushed ice (representative photo, not the exact product)",
      placeholder: true,
      sourceUrl: "https://www.pexels.com/photo/crushed-blue-ice-20312244/",
      license: "Pexels License (free for commercial use)",
      attribution: "Andre Moura"
    }
  },
  {
    slug: "stainless-jigger",
    name: "Stainless Steel Jigger",
    category: "party-essentials",
    packSize: "30/60 ml",
    price: 249,
    priceNotes: "Unbranded demo item. Price and image are placeholders until a real product is sourced.",
    stock: 25,
    popularity: 30,
    description: "Double-ended measuring jigger.",
    image: {
      url: "/img/coming-soon.svg",
      alt: "Stainless steel jigger — product photo coming soon",
      placeholder: true
    }
  },
  {
    slug: "crystal-clear-party-ice-1kg",
    name: "Party Ice",
    category: "ice-bags",
    packSize: "1 kg",
    price: 60,
    priceNotes: "Unbranded demo item. Price and image are placeholders until a real product is sourced.",
    stock: 120,
    popularity: 98,
    description: "Ice cubes in a sealed bag.",
    image: {
      url: "/img/stock/ice-cubes.jpg",
      alt: "Clear ice cubes on a dark background (representative photo, not the exact product)",
      placeholder: true,
      sourceUrl: "https://unsplash.com/photos/a-close-up-of-ice-cubes-on-a-black-background-eYrb_2d6bfk",
      license: "Unsplash License (free for commercial use)",
      attribution: "Dmitriy Frantsev"
    }
  },
  {
    slug: "ginger-ale-300ml",
    name: "Ginger Ale",
    category: "club-soda",
    packSize: "300 ml",
    price: 70,
    priceNotes: "Unbranded demo item. Price and image are placeholders until a real product is sourced.",
    stock: 80,
    popularity: 70,
    description: "Ginger ale for highballs and mules.",
    image: {
      url: "/img/coming-soon.svg",
      alt: "Ginger ale bottle, 300 ml — product photo coming soon",
      placeholder: true
    }
  },
  {
    slug: "spicy-mango-margarita-500ml",
    name: "Mango Margarita Mixer",
    category: "margarita-mixes",
    packSize: "500 ml",
    price: 279,
    priceNotes: "Unbranded demo item. Price and image are placeholders until a real product is sourced.",
    stock: 35,
    popularity: 61,
    description: "Mango-flavoured margarita mixer.",
    image: {
      url: "/img/coming-soon.svg",
      alt: "Mango margarita mixer bottle, 500 ml — product photo coming soon",
      placeholder: true
    }
  },
  {
    slug: "schweppes-indian-tonic-water-300ml",
    name: "Schweppes Indian Tonic Water",
    brand: "Schweppes",
    category: "tonic-water",
    packSize: "300 ml",
    price: 60,
    priceNotes: "UNVERIFIED. Retailer pages could not be read (BigBasket 403; Instamart JS-only). Aggregator price-history.in listed ₹60 at Amazon.in (no MRP shown, checked 2026-10-27); search snippets quoted ₹49 / ₹54 and MRP ₹60 inconsistently. Confirm on the pack and a retailer before publishing.",
    stock: 90,
    popularity: 92,
    description: "Schweppes Indian Tonic Water, 300 ml.",
    image: {
      url: "/img/coming-soon.svg",
      alt: "Schweppes Indian Tonic Water 300 ml — product photo coming soon",
      placeholder: true
    }
  }
];

export interface CatalogBundle {
  slug: string;
  name: string;
  description: string;
  price: number;
  items: [string, number][]; // [product slug, quantity]
}

export const bundles: CatalogBundle[] = [
  {
    slug: "margarita-night-kit",
    name: "Margarita Night Kit",
    description: "Mixer, garnish, rimming salt and ice for a round of margaritas.",
    price: 399,
    items: [
      [
        "margarita-mixer-500ml",
        1
      ],
      [
        "dehydrated-lime-garnish-sample",
        1
      ],
      [
        "margarita-rimming-salt",
        1
      ],
      [
        "crystal-clear-party-ice-1kg",
        1
      ]
    ]
  },
  {
    slug: "tonic-highball-kit",
    name: "Tonic Highball Kit",
    description: "Schweppes tonic, bitters, citrus garnish and ice for a perfect tonic highball.",
    price: 449,
    items: [
      [
        "schweppes-indian-tonic-water-300ml",
        4
      ],
      [
        "aromatic-bitters-sample",
        1
      ],
      [
        "dehydrated-orange-garnish",
        1
      ],
      [
        "crystal-clear-party-ice-1kg",
        1
      ]
    ]
  },
  {
    slug: "citrus-mixer-bundle",
    name: "Citrus Mixer Bundle",
    description: "Club soda, margarita mixer and two dried citrus garnishes.",
    price: 399,
    items: [
      [
        "bisleri-club-soda-750ml",
        2
      ],
      [
        "margarita-mixer-500ml",
        1
      ],
      [
        "dehydrated-lime-garnish-sample",
        1
      ],
      [
        "dehydrated-orange-garnish",
        1
      ]
    ]
  },
  {
    slug: "party-ice-essentials-bundle",
    name: "Party Ice Essentials",
    description: "Ice, crushed ice, club soda and straws for the crowd.",
    price: 399,
    items: [
      [
        "party-ice-5kg",
        1
      ],
      [
        "crushed-ice-1kg",
        1
      ],
      [
        "bisleri-club-soda-750ml",
        2
      ],
      [
        "paper-straws-50",
        1
      ]
    ]
  }
];

// Sample delivery coverage (development data). The operator replaces this with real coverage in Admin / the admin API.
export const serviceAreas: [pincode: string, areaName: string, city: string, state: string, etaMinutes: number][] = [["834001","Ranchi (Church Road / Hindpiri)","Ranchi","Jharkhand",45],["825301","Hazaribag town","Hazaribag","Jharkhand",50],["122001","Old Gurugram","Gurgaon","Haryana",25],["122002","DLF Phase 1–2","Gurgaon","Haryana",15],["122009","Sector 56 / Golf Course Rd","Gurgaon","Haryana",12],["122018","Sector 54","Gurgaon","Haryana",14],["110001","Connaught Place, New Delhi","Central Delhi","Delhi",35]];

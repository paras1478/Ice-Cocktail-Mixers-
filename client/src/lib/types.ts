export interface ProductImageInfo {
  url: string;
  alt: string;
  isPlaceholder: boolean;
  license?: string | null;
  attribution?: string | null;
  sourceUrl?: string | null;
  lastCheckOk?: boolean | null;
}

export interface Product {
  id: string;
  slug: string;
  sku: string | null;
  variantGroup: string | null;
  name: string;
  brand: string | null;
  priceStatus: "VERIFIED" | "SAMPLE";
  priceSourceUrl: string | null;
  priceVerifiedAt: string | null;
  priceNotes: string | null;
  description: string;
  details: string | null;
  packSize: string;
  priceMinor: number;
  mrpMinor: number | null; // only present for verified prices
  discountPercent: number;
  stock: number;
  inStock: boolean;
  lowStock: boolean;
  lowStockAt: number;
  popularity: number;
  isActive: boolean;
  isDemo: boolean;
  categoryId: string;
  category?: { id: string; slug: string; name: string };
  images: ProductImageInfo[];
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string;
  imageUrl: string | null;
  sortOrder: number;
  icon: string | null;
  isActive: boolean;
  productCount: number;
}

export interface BundleItem {
  productId: string;
  name: string;
  packSize: string;
  quantity: number;
  unitMinor: number;
  inStock: boolean;
  image?: string;
}

export interface Bundle {
  id: string;
  slug: string;
  name: string;
  description: string;
  imageUrl: string | null;
  isActive: boolean;
  priceMinor: number;
  regularMinor: number;
  savingsMinor: number;
  inStock: boolean;
  items: BundleItem[];
}

export interface User {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: "CUSTOMER" | "ADMIN";
}

export type AddressType = "HOME" | "WORK" | "OTHER";

export interface Address {
  id: string;
  label: string;
  type: AddressType;
  recipientName: string | null;
  phone: string | null;
  house: string | null;
  line1: string;
  landmark: string | null;
  area: string | null;
  district: string | null;
  city: string;
  state: string;
  stateCode: string | null;
  pincode: string;
  latitude: number | null;
  longitude: number | null;
  confirmedAt: string | null;
  isDefault: boolean;
}

export type OrderStatus = "PLACED" | "CONFIRMED" | "PREPARING" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";

export interface Order {
  id: string;
  number: number;
  status: OrderStatus;
  subtotalMinor: number;
  discountMinor: number;
  deliveryMinor: number;
  taxMinor: number;
  totalMinor: number;
  contactName: string;
  contactPhone: string;
  addrHouse: string | null;
  addrLine1: string;
  addrLandmark: string | null;
  addrArea: string | null;
  addrDistrict: string | null;
  addrCity: string;
  addrState: string;
  addrPincode: string;
  addrType: AddressType | null;
  addrLatitude: number | null;
  addrLongitude: number | null;
  addrConfirmedAt: string | null;
  instructions: string | null;
  estimatedDeliveryAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: { id: string; name: string; unitMinor: number; quantity: number }[];
  payment: { method: "COD" | "CARD"; status: string; amountMinor: number } | null;
  user?: { id: string; name: string; email: string; phone?: string | null };
}

export interface QuoteLine {
  productId: string;
  name: string;
  packSize: string;
  image?: string;
  unitMinor: number;
  quantity: number;
  stock: number;
}

export interface Totals {
  subtotalMinor: number;
  discountMinor: number;
  deliveryMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export interface Quote {
  lines: QuoteLine[];
  issues: { productId: string; message: string }[];
  totals: Totals;
  discountCode: string | null;
  discountMessage: string | null;
}

export interface AppConfig {
  currency: string;
  deliveryFeeMinor: number;
  freeDeliveryThresholdMinor: number;
  taxRateBps: number;
  payments: { cod: boolean; card: boolean };
  location: { pincodeLookup: boolean; reverseGeocoding: boolean };
}

/** Delivery coverage answer from the server (our ServiceArea table). */
export type Delivery =
  | { serviceable: true; pincode: string; areaName: string; city: string | null; state: string | null; etaMinutes: number; isSample: boolean }
  | { serviceable: false; pincode: string; reason: "not_covered" | "paused" };

export interface PostOffice {
  name: string;
  district: string;
  state: string;
  stateCode: string | null;
  block?: string;
}

/** Postal lookup answer: suggestions only. Says nothing about whether we deliver. */
export type PostalResult =
  | { status: "found"; pincode: string; offices: PostOffice[]; district: string | null; state: string | null; stateCode: string | null }
  | { status: "not_found" }
  | { status: "unavailable"; message: string };

export interface PincodeResult {
  pincode: string;
  postal: PostalResult;
  delivery: Delivery;
}

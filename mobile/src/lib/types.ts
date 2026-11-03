export interface ProductImage { url: string; alt: string; isPlaceholder: boolean; license?: string | null; attribution?: string | null; sourceUrl?: string | null }
export interface Product {
  id: string; slug: string; sku: string | null; name: string; brand: string | null; description: string; details: string | null; packSize: string;
  priceMinor: number; mrpMinor: number | null; discountPercent: number; stock: number; inStock: boolean; lowStock: boolean;
  priceStatus: "VERIFIED" | "SAMPLE"; priceSourceUrl: string | null; priceVerifiedAt: string | null;
  images: ProductImage[]; category?: { id: string; slug: string; name: string };
}
export interface Category { id: string; slug: string; name: string; description: string; imageUrl: string | null; productCount: number }
export interface User { id: string; email: string; name: string; phone: string | null; role: "CUSTOMER" | "ADMIN" }
export interface CartEntry { productId: string; quantity: number }
export interface QuoteLine { productId: string; name: string; packSize: string; image?: string; unitMinor: number; quantity: number; stock: number }
export interface Totals { subtotalMinor: number; discountMinor: number; deliveryMinor: number; taxMinor: number; totalMinor: number }
export interface Quote { lines: QuoteLine[]; issues: { productId: string; message: string }[]; totals: Totals; discountCode: string | null; discountMessage: string | null }
export interface Order {
  id: string; number: number; status: string; subtotalMinor: number; discountMinor: number; deliveryMinor: number; taxMinor: number; totalMinor: number;
  createdAt: string; updatedAt: string; estimatedDeliveryAt: string | null;
  addrHouse: string | null; addrLine1: string; addrLandmark: string | null; addrArea: string | null; addrDistrict: string | null; addrCity: string; addrState: string; addrPincode: string;
  cancelledAt?: string | null; cancelReason?: string | null; cancelledBy?: "CUSTOMER" | "ADMIN" | null;
  items: { id: string; productId: string; name: string; unitMinor: number; quantity: number; image?: string | null }[];
  payment: {
    method: "COD" | "CARD" | "ONLINE";
    status: string;
    amountMinor: number;
    paidAt?: string | null;
    failureReason?: string | null;
    refundStatus?: "REQUESTED" | "PROCESSING" | "COMPLETED" | "FAILED" | null;
    refundedAt?: string | null;
  } | null;
}
export interface AppConfig { deliveryFeeMinor: number; freeDeliveryThresholdMinor: number; payments: { cod: boolean; card: boolean; online?: boolean } }
export interface Bundle {
  id: string; slug: string; name: string; description: string; imageUrl: string | null; priceMinor: number; regularMinor: number; savingsMinor: number; inStock: boolean;
  items: { productId: string; name: string; packSize: string; quantity: number; inStock: boolean }[];
}

export type Delivery =
  | { serviceable: true; pincode: string; areaName: string; city: string | null; state: string | null; etaMinutes: number; isSample: boolean }
  | { serviceable: false; pincode: string; reason: "not_covered" | "paused" };
export interface PostOffice { name: string; district: string; state: string; stateCode: string | null; block?: string }
export type PostalResult =
  | { status: "found"; pincode: string; offices: PostOffice[]; district: string | null; state: string | null; stateCode: string | null }
  | { status: "not_found" }
  | { status: "unavailable"; message: string };
export interface PincodeResult { pincode: string; postal: PostalResult; delivery: Delivery }
export type AddressType = "HOME" | "WORK" | "OTHER";

export interface Address {
  id: string; label: string; type: AddressType; recipientName: string | null; phone: string | null; house: string | null; line1: string; landmark: string | null;
  area: string | null; district: string | null; city: string; state: string; stateCode: string | null; pincode: string; latitude: number | null; longitude: number | null; isDefault: boolean;
}

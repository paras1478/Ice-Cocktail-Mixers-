-- ISO 3166-2:IN state / UT code, derived server-side from the state name (the postal API returns names only).
ALTER TABLE "Address" ADD COLUMN "stateCode" TEXT;
ALTER TABLE "Order" ADD COLUMN "addrStateCode" TEXT;

-- Postal area (post office) and district are stored separately from the city, on saved addresses and on the immutable order snapshot.
ALTER TABLE "Address" ADD COLUMN "area" TEXT, ADD COLUMN "district" TEXT;
ALTER TABLE "Order" ADD COLUMN "addrArea" TEXT, ADD COLUMN "addrDistrict" TEXT;

-- Existing rows only had a city; treat it as the district too so nothing is blank.
UPDATE "Address" SET "district" = "city" WHERE "district" IS NULL;
UPDATE "Order" SET "addrDistrict" = "addrCity" WHERE "addrDistrict" IS NULL;

-- Internal product identifier and an optional pack-size group (products of the same family sold in different sizes).
ALTER TABLE "Product" ADD COLUMN "sku" TEXT, ADD COLUMN "variantGroup" TEXT;
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
CREATE INDEX "Product_variantGroup_idx" ON "Product"("variantGroup");

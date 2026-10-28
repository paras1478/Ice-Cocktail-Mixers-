-- Scope: Ice & Cocktail Mixers Express sells ice, tonic, club soda, margarita mixes, bitters, citrus garnishes,
-- bundles and non-alcoholic party essentials only. Alcohol is removed from the storefront and the data model.
-- Historical records are preserved: products referenced by orders/bundles are archived (isActive = false), not deleted.

ALTER TABLE "Category" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- 1. Alcohol products: drop from carts, archive, then delete those with no order/bundle history.
CREATE TEMP TABLE _alc AS
  SELECT p.id FROM "Product" p JOIN "Category" c ON c.id = p."categoryId"
  WHERE p."isAlcohol" OR c.slug IN ('beer','whisky','vodka','rum','gin','wine','champagne','single-malts','chakhna','munchies');
DELETE FROM "CartItem" WHERE "productId" IN (SELECT id FROM _alc);
UPDATE "Product" SET "isActive" = false WHERE id IN (SELECT id FROM _alc);
DELETE FROM "Product" p WHERE p.id IN (SELECT id FROM _alc)
  AND NOT EXISTS (SELECT 1 FROM "OrderItem" oi WHERE oi."productId" = p.id)
  AND NOT EXISTS (SELECT 1 FROM "BundleItem" bi WHERE bi."productId" = p.id);

-- 2. Alcohol-style categories: delete when empty, otherwise hide.
DELETE FROM "Category" c WHERE c.slug IN ('beer','whisky','vodka','rum','gin','wine','champagne','single-malts','chakhna','munchies')
  AND NOT EXISTS (SELECT 1 FROM "Product" p WHERE p."categoryId" = c.id);
UPDATE "Category" SET "isActive" = false WHERE slug IN ('beer','whisky','vodka','rum','gin','wine','champagne','single-malts','chakhna','munchies');

-- 3. Flatten the category tree into the required categories.
UPDATE "Product" SET "categoryId" = (SELECT id FROM "Category" WHERE slug = 'club-soda')
  WHERE "categoryId" = (SELECT id FROM "Category" WHERE slug = 'ginger-ale-sparkling');
UPDATE "Category" SET description = 'Club soda, flavoured sodas, ginger ale and sparkling water for highballs and spritzers.' WHERE slug = 'club-soda';
DELETE FROM "Category" WHERE slug = 'ginger-ale-sparkling';
UPDATE "Category" SET slug = 'party-essentials', name = 'Party Essentials', description = 'Non-alcoholic bar tools and party accessories: shakers, jiggers, straws.' WHERE slug = 'accessories';
UPDATE "Category" SET "parentId" = NULL;
DELETE FROM "Category" WHERE slug IN ('mixers-ice','party-gear');
UPDATE "Category" SET icon = NULL, "sortOrder" = CASE slug
  WHEN 'ice-bags' THEN 0 WHEN 'tonic-water' THEN 1 WHEN 'club-soda' THEN 2 WHEN 'margarita-mixes' THEN 3
  WHEN 'bitters' THEN 4 WHEN 'citrus-garnishes' THEN 5 WHEN 'party-bundles' THEN 6 WHEN 'party-essentials' THEN 7 ELSE 99 END;
UPDATE "Category" SET description = 'Crystal-clear, food-grade party ice in handy bags.' WHERE slug = 'ice-bags';
UPDATE "Category" SET description = 'Craft tonic waters for the perfect highball.' WHERE slug = 'tonic-water';
UPDATE "Category" SET description = 'Margarita and sour mixers (non-alcoholic).' WHERE slug = 'margarita-mixes';
UPDATE "Category" SET description = 'Cocktail bitters to finish any drink.' WHERE slug = 'bitters';
UPDATE "Category" SET description = 'Dehydrated citrus wheels and rimming salts.' WHERE slug = 'citrus-garnishes';
UPDATE "Category" SET description = 'Curated kits that bundle everything for the night, at a saving.' WHERE slug = 'party-bundles';

-- 4. Remove alcohol / variant / tree structures.
DROP TABLE "AlcoholRegion";
DROP TABLE "ProductVariant" CASCADE;
DROP TYPE "Container";
ALTER TABLE "CartItem" DROP COLUMN "variantId";
ALTER TABLE "OrderItem" DROP COLUMN "variantId";
ALTER TABLE "ProductImage" DROP COLUMN "variantId";
ALTER TABLE "Order" DROP COLUMN "ageConfirmedAt";
ALTER TABLE "Product" DROP COLUMN "isAlcohol", DROP COLUMN "beerType", DROP COLUMN "abv";
ALTER TABLE "Category" DROP COLUMN "parentId";

-- 5. One cart line per product.
DROP INDEX IF EXISTS "CartItem_cartId_productId_idx";
CREATE UNIQUE INDEX "CartItem_cartId_productId_key" ON "CartItem"("cartId", "productId");

ALTER TABLE "Category" ADD COLUMN "itemCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "Category" c
SET "itemCount" = counts.count
FROM (
  SELECT pc."A" AS id, COUNT(*)::INTEGER AS count
  FROM "_CategoryToPost" pc
  JOIN "Post" p ON p."id" = pc."B"
  WHERE p."type" = 'post'
  GROUP BY pc."A"
) counts
WHERE c."id" = counts.id AND c."type" = 'post';

UPDATE "Category" c
SET "itemCount" = counts.count
FROM (
  SELECT pc."A" AS id, COUNT(*)::INTEGER AS count
  FROM "_CategoryToProductCache" pc
  JOIN "ProductCache" p ON p."id" = pc."B"
  GROUP BY pc."A"
) counts
WHERE c."id" = counts.id AND c."type" = 'product';

UPDATE "Category" c
SET "itemCount" = counts.count
FROM (
  SELECT p."brandId" AS id, COUNT(*)::INTEGER AS count
  FROM "ProductCache" p
  WHERE p."brandId" IS NOT NULL
  GROUP BY p."brandId"
) counts
WHERE c."id" = counts.id AND c."type" = 'brand';

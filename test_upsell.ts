
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  await prisma.productCache.create({
    data: {
      id: 'test-upsell-1',
      leadbaseProductId: 'lb-1',
      price: 100000,
      leadbaseStatus: 'active',
      name: 'Product 1',
      imageUrls: ['img1.jpg'],
      status: 'published',
      relatedProducts: {
        upsell: { mode: 'specific', productIds: ['test-upsell-2'], categoryId: null, limit: 4 },
        crossSell: { mode: 'category', productIds: [], categoryId: null, limit: 4 }
      }
    }
  });
  await prisma.productCache.create({
    data: {
      id: 'test-upsell-2',
      leadbaseProductId: 'lb-2',
      price: 200000,
      leadbaseStatus: 'active',
      name: 'Product 2',
      imageUrls: ['img2.jpg'],
      status: 'published'
    }
  });
  console.log('Created products. URL: http://localhost:3040/products/test-upsell-1');
}
main().catch(console.error).finally(() => prisma.$disconnect());


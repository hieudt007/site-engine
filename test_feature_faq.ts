import { prisma } from "./src/db.js";

async function runTest() {
  console.log("Testing FAQ feature...");
  
  // 1. Test Category
  console.log("--- Testing Category FAQ ---");
  const category = await prisma.category.create({
    data: {
      name: "Test FAQ Category",
      slug: "test-faq-category-" + Date.now(),
      type: "post",
      faq: [
        { question: "What is this?", answer: "A category with FAQ." },
        { question: "Does it work?", answer: "Yes!" }
      ]
    }
  });
  console.log("Created category ID:", category.id);
  const foundCat = await prisma.category.findUnique({ where: { id: category.id } });
  console.log("FAQ in DB:", foundCat?.faq);

  // 2. Test Post
  console.log("\n--- Testing Post FAQ ---");
  const post = await prisma.post.create({
    data: {
      title: "Test FAQ Post",
      slug: "test-faq-post-" + Date.now(),
      body: "<p>Content</p>",
      faq: [
        { question: "Post question 1?", answer: "Answer 1" }
      ]
    }
  });
  console.log("Created post ID:", post.id);
  const foundPost = await prisma.post.findUnique({ where: { id: post.id } });
  console.log("FAQ in DB:", foundPost?.faq);

  // 3. Test Product
  console.log("\n--- Testing ProductCache FAQ ---");
  const product = await prisma.productCache.create({
    data: {
      id: "test-faq-product-" + Date.now(),
      name: "Test FAQ Product",
      price: 1000,
      leadbaseStatus: "active",
      leadbaseProductId: "test-faq-product-lb-" + Date.now(),
      faq: [
        { question: "Product question?", answer: "Product answer!" }
      ]
    }
  });
  console.log("Created product ID:", product.id);
  const foundProd = await prisma.productCache.findUnique({ where: { id: product.id } });
  console.log("FAQ in DB:", foundProd?.faq);

  // Clean up
  await prisma.category.delete({ where: { id: category.id } });
  await prisma.post.delete({ where: { id: post.id } });
  await prisma.productCache.delete({ where: { id: product.id } });
  console.log("\n✅ Test completed successfully and cleaned up.");
}

runTest().catch(e => {
  console.error("Test failed:", e);
  process.exit(1);
});

import { describe, expect, it } from "vitest";
import { analyzeContentSeo, analyzeProductSeo } from "./seoAnalyzer.js";

describe("seoAnalyzer", () => {
  it("scores content and preserves editable SEO fields", () => {
    const seo = analyzeContentSeo({
      title: "Dich vu ve sinh nha cua chuyen nghiep",
      slug: "dich-vu-ve-sinh-nha-cua",
      excerpt: "Dich vu ve sinh nha cua tron goi cho gia dinh va van phong.",
      coverImage: "/uploads/cover.webp",
      body: "<h2>Dich vu ve sinh nha cua</h2><p>" + "noi dung ".repeat(260) + '</p><a href="/dich-vu">Xem them</a>',
      seo: {
        keyword: "ve sinh nha cua",
        metaTitle: "Dich vu ve sinh nha cua chuyen nghiep tai nha",
        metaDescription: "Dich vu ve sinh nha cua chuyen nghiep, nhanh gon, phu hop gia dinh va van phong voi doi ngu nhieu kinh nghiem.",
        ogImage: "/uploads/og.webp",
      },
      faq: [{ question: "Co nhanh khong?", answer: "Co." }],
    });

    expect(seo.keyword).toBe("ve sinh nha cua");
    expect(seo.metaTitle).toContain("Dich vu");
    expect(seo.score).toBeGreaterThan(60);
    expect(seo.checks?.length).toBeGreaterThan(5);
    expect(seo.analyzedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("scores products with product-specific checks", () => {
    const seo = analyzeProductSeo({
      name: "May hut bui cam tay",
      slug: "may-hut-bui-cam-tay",
      excerpt: "May hut bui cam tay nho gon cho gia dinh.",
      description: "<p>" + "may hut bui ".repeat(90) + "</p>",
      imageUrls: ["/uploads/1.webp", "/uploads/2.webp"],
      specs: [{ label: "Cong suat", value: "120W" }],
      faq: [{ question: "Bao hanh?", answer: "12 thang." }],
      seo: {
        keyword: "may hut bui",
        metaTitle: "May hut bui cam tay nho gon cho gia dinh",
        metaDescription: "May hut bui cam tay nho gon, de dung, phu hop don dep nha cua hang ngay voi nhieu dau hut tien loi.",
      },
    });

    expect(seo.score).toBeGreaterThan(70);
    expect(seo.checks?.some((item) => item.key === "specs" && item.status === "pass")).toBe(true);
  });
});

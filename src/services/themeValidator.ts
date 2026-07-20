import { Liquid } from "liquidjs";
import { getContract } from "./themeContract.js";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

// Validate 1 file theme AI vua sinh TRUOC KHI ghi de len dia — (1) parse that bang chinh engine
// se render no (bat loi cu phap Liquid), (2) doi chieu hop dong (services/themeContract.ts) bang
// so chuoi con + grep id="...". KHONG parse AST bieu thuc Liquid (xem ghi chu trong themeContract.ts)
// nen chi bat duoc thieu-hoan-toan, khong bat duoc dung sai vi tri/logic tinh vi.
export async function validateThemeFile(file: string, source: string): Promise<ValidationResult> {
  const errors: string[] = [];

  const engine = new Liquid();
  try {
    engine.parse(source);
  } catch (err) {
    return { ok: false, errors: [`Lỗi cú pháp Liquid: ${(err as Error).message}`] };
  }

  const contract = getContract(file);
  if (!contract) {
    return { ok: true, errors: [] };
  }

  for (const substr of contract.requiredSubstrings) {
    if (!source.includes(substr)) {
      errors.push(`Thiếu "${substr}" (bắt buộc theo hợp đồng file này)`);
    }
  }

  for (const id of contract.requiredIds) {
    if (!new RegExp(`id=["']${id}["']`).test(source)) {
      errors.push(`Thiếu id="${id}" — JS có sẵn của trang này sẽ không hoạt động nếu thiếu`);
    }
  }

  return { ok: errors.length === 0, errors };
}

// Theo doi run() nao dang THAT SU chay (o giua vong lap, giua cac lan goi AI) cho tung cuoc hoi
// thoai (historyId) - dung de ho tro "chen ngang" (steering): user gui tin nhan moi trong luc AI
// dang xu ly (con dang trong while loop cua BaseAgent.run(), chua REPLY), thay vi tao 1 run() moi
// chay song song (dam lich su/context), tin nhan do duoc bom thang vao run() dang chay, AI doc
// duoc o lan goi AI TIEP THEO. Chi song trong bo nho 1 process - du neu restart server thi run()
// cu cung da mat theo, khong can ben vung qua restart.
const activeRuns = new Set<number>();
const pendingInjections = new Map<number, string[]>();

export function markRunActive(historyId: number): void {
  activeRuns.add(historyId);
}

export function markRunDone(historyId: number): void {
  activeRuns.delete(historyId);
  pendingInjections.delete(historyId);
}

export function isRunActive(historyId: number): boolean {
  return activeRuns.has(historyId);
}

// Tra ve true neu bom thanh cong (co run dang chay de nhan) - false neu khong co run nao dang
// chay cho historyId nay (caller nen xu ly nhu 1 tin nhan/luot chat binh thuong thay vi bom).
export function injectMessage(historyId: number, message: string): boolean {
  if (!activeRuns.has(historyId)) return false;
  const arr = pendingInjections.get(historyId) || [];
  arr.push(message);
  pendingInjections.set(historyId, arr);
  return true;
}

// Lay het cac tin nhan cho bom (neu co) va xoa khoi hang doi - goi o dau moi vong lap trong
// BaseAgent.run().
export function takePendingInjections(historyId: number): string[] | null {
  const arr = pendingInjections.get(historyId);
  if (!arr || arr.length === 0) return null;
  pendingInjections.delete(historyId);
  return arr;
}

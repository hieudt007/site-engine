// Set TZ TRUOC KHI bat ky module nao khac chay - PHAI la import DAU TIEN trong moi entrypoint
// (server.ts...), khong dua vao .env/systemd (production "start" = node dist/server.js, khong co
// --env-file, va deploy/systemd unit nam o repo lead-base khac, khong sua duoc tu day). File nay
// khong duoc import gi khac de dam bao chay truoc tat ca import con lai (thu tu import trong 1
// file la tuan tu tu tren xuong).
process.env.TZ = "Asia/Ho_Chi_Minh";

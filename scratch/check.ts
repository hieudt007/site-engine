import fs from 'fs';
const content = fs.readFileSync('views/admin/components/ai-chat-widget.liquid', 'utf-8');
const script = content.match(/<script>([\s\S]*?)<\/script>/)[1];
fs.writeFileSync('scratch/test-widget.js', script);

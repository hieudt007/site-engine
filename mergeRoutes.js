import fs from 'node:fs';
import path from 'node:path';

const pubFile = path.resolve('src/routes/public/pluginChat.ts');
const admFile = path.resolve('src/routes/admin/liveChat.ts');
const outFile = path.resolve('addons/customer-support/backend/index.ts');

const pubContent = fs.readFileSync(pubFile, 'utf-8');
const admContent = fs.readFileSync(admFile, 'utf-8');

// Replace relative paths to absolute workspace src paths
let pLines = pubContent.replace(/from "\.\.\/\.\.\//g, 'from "../../../src/').split('\n');
let aLines = admContent.replace(/from "\.\.\/\.\.\//g, 'from "../../../src/').split('\n');

// Extract imports
const allImports = new Set();
const cleanPubLines = [];
const cleanAdmLines = [];

for (const line of pLines) {
  if (line.startsWith('import ')) {
    allImports.add(line);
  } else {
    cleanPubLines.push(line);
  }
}

for (const line of aLines) {
  if (line.startsWith('import ')) {
    allImports.add(line);
  } else {
    cleanAdmLines.push(line);
  }
}

let pubBody = cleanPubLines.join('\n');
let admBody = cleanAdmLines.join('\n');

// Change function declarations
pubBody = pubBody.replace('export async function registerPluginChatRoutes(app: FastifyInstance): Promise<void> {', 'export async function register(app: FastifyInstance): Promise<void> {');
admBody = admBody.replace('export async function registerLiveChatRoutes(app: FastifyInstance): Promise<void> {', 'async function registerLiveChatRoutes(app: FastifyInstance): Promise<void> {');

// Inject the call to registerLiveChatRoutes at the end of register
const lastBraceIndex = pubBody.lastIndexOf('}');
if (lastBraceIndex !== -1) {
  pubBody = pubBody.substring(0, lastBraceIndex) + '  await registerLiveChatRoutes(app);\n}\n' + pubBody.substring(lastBraceIndex + 1);
}

const finalCode = Array.from(allImports).join('\n') + '\n\n' + pubBody + '\n\n' + admBody;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, finalCode, 'utf-8');
console.log('Merged successfully!');

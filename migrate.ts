import fs from 'node:fs/promises';
import path from 'node:path';
import { THEME_FILE_CONTRACTS } from './src/services/themeContract.ts';

const THEMES_ROOT = path.join(process.cwd(), 'themes');

async function migrateTheme(slug: string) {
  for (const contract of THEME_FILE_CONTRACTS) {
    const filePath = path.join(THEMES_ROOT, slug, contract.file);
    try {
      let content = await fs.readFile(filePath, 'utf-8');

      if (content.includes('{% comment %}') && content.includes('@description:')) {
        console.log(`Skipping ${slug}/${contract.file} - already migrated`);
        continue;
      }

      const lines = [
        '{% comment %}',
        `@description: ${contract.description}`,
        `@required_substrings: ${contract.requiredSubstrings.join(', ')}`,
        `@required_ids: ${contract.requiredIds.join(', ')}`,
        `@notes: ${contract.notes}`,
        '{% endcomment %}',
        ''
      ];

      const newContent = lines.join('\n') + content;
      await fs.writeFile(filePath, newContent, 'utf-8');
      console.log(`Migrated ${slug}/${contract.file}`);
    } catch (e: any) {
      console.log(`Fail: ${slug}/${contract.file} - ${e.message}`);
    }
  }
}

async function run() {
  await migrateTheme('default');
  await migrateTheme('misamom');
  console.log('Done');
}

run().catch(console.error);

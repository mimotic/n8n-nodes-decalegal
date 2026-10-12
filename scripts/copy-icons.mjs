// Fallback for environments without the n8n-node CLI: copies the node icons
// next to the compiled files so n8n can find them.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const source = join('nodes', 'DecaLegal');
const target = join('dist', 'nodes', 'DecaLegal');

mkdirSync(target, { recursive: true });

for (const file of readdirSync(source)) {
	if (file.endsWith('.svg') || file.endsWith('.png')) {
		copyFileSync(join(source, file), join(target, file));
	}
}

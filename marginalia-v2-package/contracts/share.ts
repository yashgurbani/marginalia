export const SHARE_FORMATS = ['markdown', 'html', 'text'] as const;
export type ShareFormat = typeof SHARE_FORMATS[number];

export type ShareFile = {
  contents: string;
  contentType: string;
  filename: string;
};

export function shareFileFrom(value: unknown, format: ShareFormat): ShareFile {
  if (!record(value) || typeof value.contents !== 'string' || value.contents.length > 300_000
    || value.contentType !== contentType(format) || typeof value.filename !== 'string'
    || value.filename.length > 240 || !new RegExp(`\\.${format}$`).test(value.filename)
    || /[\\/\r\n]/.test(value.filename)) throw new Error('The helper returned an invalid thread copy.');
  return value as ShareFile;
}

function contentType(format: ShareFormat): string {
  return format === 'markdown' ? 'text/markdown; charset=utf-8'
    : format === 'html' ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8';
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

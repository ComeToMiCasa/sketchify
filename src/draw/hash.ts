// Content-based names for drawing variables. Pure.

/** 32-bit FNV-1a of the string's UTF-16 code units, as 8 hex digits. */
export const fnv1a = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

/**
 * The custom property that holds a drawing on `:root`. Named by content, not by position:
 * PostCSS compiles each file on its own, so a positional name (`--sk-1`) in one file would
 * overwrite a different drawing with the same name from another file on the same page.
 */
export const drawingName = (url: string): string => `--sk-${fnv1a(url)}`;

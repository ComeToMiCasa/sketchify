// The HTML of the landing page, as pure functions of the source files, so the build and the tests
// put the pages together the same way.

/** A sketched copy of the page: the shared body with its stylesheets. Only ever seen inside the
 * index's frame, so search engines are told to leave it out (the index holds the same text). */
export const sketchPage = (title, sheets, body) =>
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex">\n` +
  `<title>${title}</title>\n${sheets.map((href) => `<link rel="stylesheet" href="${href}">\n`).join('')}</head>\n<body>\n${body}</body>\n</html>\n`;

/** The index: the shell template with the page's body, as it is, in place of its marker. */
export const indexPage = (shell, body) => shell.replace('<!-- page -->\n', body);

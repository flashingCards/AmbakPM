const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { marked } = require("marked");
const { chromium } = require("playwright");

function toFileUrl(maybePath, baseDir) {
  if (/^[a-zA-Z]:\\/.test(maybePath)) {
    return pathToFileURL(maybePath).href;
  }

  if (/^(https?:|file:)/.test(maybePath)) {
    return maybePath;
  }

  return pathToFileURL(path.resolve(baseDir, maybePath)).href;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function preprocessMarkdown(markdown, baseDir) {
  return markdown
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
      const cleanSrc = src.trim();
      const fileUrl = toFileUrl(cleanSrc, baseDir);
      return `<img src="${fileUrl}" alt="${escapeHtml(alt)}" />`;
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, href) => {
      // Preserve regular web links. Local file links become file:// URLs so they still work in HTML/PDF.
      const cleanHref = href.trim();
      if (/^(https?:|mailto:|file:)/.test(cleanHref) || /^[a-zA-Z]:\\/.test(cleanHref)) {
        const resolvedHref = toFileUrl(cleanHref, baseDir);
        return `<a href="${resolvedHref}">${escapeHtml(label)}</a>`;
      }
      return match;
    });
}

function buildHtml(title, bodyHtml) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page {
      size: A4;
      margin: 18mm 16mm 18mm 16mm;
    }

    :root {
      color-scheme: light;
    }

    body {
      font-family: "Segoe UI", Arial, sans-serif;
      color: #202124;
      line-height: 1.5;
      font-size: 11pt;
      margin: 0;
    }

    main {
      width: 100%;
    }

    h1, h2, h3, h4 {
      color: #111827;
      margin-top: 1.2em;
      margin-bottom: 0.45em;
      line-height: 1.25;
      break-after: avoid-page;
    }

    h1 {
      font-size: 22pt;
      margin-top: 0;
      border-bottom: 2px solid #d1d5db;
      padding-bottom: 8px;
    }

    h2 {
      font-size: 16pt;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 4px;
    }

    h3 {
      font-size: 13pt;
    }

    h4 {
      font-size: 11.5pt;
    }

    p, ul, ol, blockquote {
      margin-top: 0.45em;
      margin-bottom: 0.7em;
    }

    ul, ol {
      padding-left: 1.35em;
    }

    li {
      margin: 0.2em 0;
    }

    code {
      font-family: "Cascadia Mono", Consolas, monospace;
      font-size: 0.92em;
      background: #f3f4f6;
      border-radius: 4px;
      padding: 0.08em 0.3em;
    }

    pre {
      background: #f8fafc;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 12px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }

    pre code {
      background: transparent;
      padding: 0;
    }

    img {
      display: block;
      max-width: 100%;
      height: auto;
      margin: 12px auto 18px auto;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
      break-inside: avoid;
    }

    a {
      color: #0b57d0;
      text-decoration: none;
    }

    blockquote {
      border-left: 3px solid #d1d5db;
      padding-left: 12px;
      color: #374151;
    }

    hr {
      border: 0;
      border-top: 1px solid #e5e7eb;
      margin: 1.2em 0;
    }
  </style>
</head>
<body>
  <main>
    ${bodyHtml}
  </main>
</body>
</html>`;
}

function findLocalBrowser() {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function renderPdf(markdownPath, pdfPath) {
  const baseDir = path.dirname(markdownPath);
  const rawMarkdown = fs.readFileSync(markdownPath, "utf8");
  const preparedMarkdown = preprocessMarkdown(rawMarkdown, baseDir);

  marked.setOptions({
    gfm: true,
    breaks: false,
  });

  const htmlBody = marked.parse(preparedMarkdown);
  const title = path.basename(markdownPath, path.extname(markdownPath));
  const fullHtml = buildHtml(title, htmlBody);
  const htmlPath = path.join(baseDir, `${title}.html`);
  fs.writeFileSync(htmlPath, fullHtml, "utf8");

  const executablePath = findLocalBrowser();
  if (!executablePath) {
    throw new Error("No local Edge or Chrome executable found for PDF rendering.");
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath,
  });

  const page = await browser.newPage();
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle" });
  await page.pdf({
    path: pdfPath,
    format: "A4",
    printBackground: true,
    margin: {
      top: "18mm",
      right: "16mm",
      bottom: "18mm",
      left: "16mm",
    },
  });
  await browser.close();
}

async function main() {
  const markdownPath = process.argv[2];
  const pdfPath = process.argv[3];

  if (!markdownPath || !pdfPath) {
    console.error("Usage: node render_assignment_pdf.js <input.md> <output.pdf>");
    process.exit(1);
  }

  await renderPdf(path.resolve(markdownPath), path.resolve(pdfPath));
  console.log(`PDF created at ${pdfPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

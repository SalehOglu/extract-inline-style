const http = require('http');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const open = require('open');

// Define the output folder path relative to the script's location
const outputDir = path.join(__dirname, 'output');

// Create the output folder if it doesn't exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Serve static or generated files with security check
function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404: File Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
}

// Mapping for Windows-1256 single-byte special characters outside standard UTF-8
const WIN_1256_MAP = {
  0x80: '\u20AC', // €
  0x81: '\u067E', // پ
  0x82: '\u201A', // ‚
  0x83: '\u0192', // ƒ
  0x84: '\u201E', // „
  0x85: '\u2026', // …
  0x86: '\u2020', // †
  0x87: '\u2021', // ‡
  0x88: '\u02C6', // ˆ
  0x89: '\u2030', // ‰
  0x8A: '\u0679', // ٹ
  0x8B: '\u2039', // ‹
  0x8C: '\u0152', // Œ
  0x8D: '\u0686', // چ
  0x8E: '\u0698', // ژ
  0x8F: '\u0688', // ڈ
  0x90: '\u06AF', // گ
  0x91: '\u2018', // ‘
  0x92: '\u2019', // ’
  0x93: '\u201C', // “
  0x94: '\u201D', // ”
  0x95: '\u2022', // •
  0x96: '\u2013', // – (en-dash)
  0x97: '\u2014', // — (em-dash)
  0x98: '\u06A9', // ک
  0x99: '\u2122', // ™
  0x9A: '\u0691', // ڑ
  0x9B: '\u203A', // ›
  0x9C: '\u0153', // œ
  0x9D: '\u200C', // ZWNJ
  0x9E: '\u200D', // ZWJ
  0x9F: '\u06D2', // ے
  0xA0: '\u00A0', // NBSP
  0xAB: '\u00AB', // «
  0xBB: '\u00BB', // »
};

// Resilient decoder that preserves UTF-8 Arabic while decoding stray Windows-1256 bytes
function decodeHtmlBuffer(buf) {
  let offset = 0;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    offset = 3; // Skip UTF-8 BOM
  }

  const out = [];
  const len = buf.length;
  let i = offset;

  while (i < len) {
    const b1 = buf[i];

    // ASCII (0x00 - 0x7F)
    if (b1 <= 0x7f) {
      out.push(String.fromCharCode(b1));
      i++;
      continue;
    }

    // 2-byte UTF-8 sequence (e.g. Arabic 0xD8..0xD9)
    if (b1 >= 0xc2 && b1 <= 0xdf && i + 1 < len) {
      const b2 = buf[i + 1];
      if ((b2 & 0xc0) === 0x80) {
        const code = ((b1 & 0x1f) << 6) | (b2 & 0x3f);
        out.push(String.fromCharCode(code));
        i += 2;
        continue;
      }
    }

    // 3-byte UTF-8 sequence
    if (b1 >= 0xe0 && b1 <= 0xef && i + 2 < len) {
      const b2 = buf[i + 1];
      const b3 = buf[i + 2];
      if ((b2 & 0xc0) === 0x80 && (b3 & 0xc0) === 0x80) {
        const code = ((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
        if (code >= 0x0800 && (code < 0xd800 || code > 0xdfff)) {
          out.push(String.fromCharCode(code));
          i += 3;
          continue;
        }
      }
    }

    // 4-byte UTF-8 sequence
    if (b1 >= 0xf0 && b1 <= 0xf4 && i + 3 < len) {
      const b2 = buf[i + 1];
      const b3 = buf[i + 2];
      const b4 = buf[i + 3];
      if ((b2 & 0xc0) === 0x80 && (b3 & 0xc0) === 0x80 && (b4 & 0xc0) === 0x80) {
        const code = ((b1 & 0x07) << 18) | ((b2 & 0x3f) << 12) | ((b3 & 0x3f) << 6) | (b4 & 0x3f);
        if (code >= 0x10000 && code <= 0x10ffff) {
          out.push(String.fromCodePoint(code));
          i += 4;
          continue;
        }
      }
    }

    // Stray Windows-1256 / Windows-1252 byte (smart quotes, dashes, bullets, etc.)
    if (WIN_1256_MAP[b1]) {
      out.push(WIN_1256_MAP[b1]);
      i++;
      continue;
    }

    // Fallback single-byte
    out.push(String.fromCharCode(b1));
    i++;
  }

  return out.join('');
}

// Safe multipart data parser using binary buffers to prevent UTF-8 corruption
function parseMultipartData(req, boundary) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => {
      chunks.push(chunk);
    });

    req.on('error', err => reject(err));

    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        const delimiter = Buffer.from(`--${boundary}`);
        const files = [];

        let start = 0;
        while (true) {
          const delimiterIndex = buffer.indexOf(delimiter, start);
          if (delimiterIndex === -1) break;

          const nextDelimiterIndex = buffer.indexOf(delimiter, delimiterIndex + delimiter.length);
          if (nextDelimiterIndex === -1) break;

          const partBuffer = buffer.subarray(delimiterIndex + delimiter.length, nextDelimiterIndex);
          const headerEndIndex = partBuffer.indexOf('\r\n\r\n');

          if (headerEndIndex !== -1) {
            const headerText = partBuffer.subarray(0, headerEndIndex).toString('utf-8');
            if (
              headerText.includes('Content-Disposition') &&
              (headerText.includes('name="files[]"') || headerText.includes('name="file"'))
            ) {
              const filenameMatch = headerText.match(/filename="([^"]+)"/);
              const originalFilename = filenameMatch ? path.basename(filenameMatch[1]) : null;

              let contentBuffer = partBuffer.subarray(headerEndIndex + 4);
              if (
                contentBuffer.length >= 2 &&
                contentBuffer[contentBuffer.length - 2] === 0x0d &&
                contentBuffer[contentBuffer.length - 1] === 0x0a
              ) {
                contentBuffer = contentBuffer.subarray(0, contentBuffer.length - 2);
              }

              files.push({
                filename: originalFilename,
                content: decodeHtmlBuffer(contentBuffer)
              });
            }
          }

          start = nextDelimiterIndex;
        }

        if (files.length > 0) {
          resolve(files);
        } else {
          reject(new Error('No files found in upload payload'));
        }
      } catch (err) {
        reject(err);
      }
    });
  });
}

// Normalize style declaration for canonical comparison and deduplication
function normalizeStyle(styleStr) {
  if (!styleStr) return '';
  const declarations = styleStr.split(';').map(d => d.trim()).filter(Boolean);
  const normalized = [];

  for (const decl of declarations) {
    const colonIdx = decl.indexOf(':');
    if (colonIdx === -1) continue;
    const prop = decl.substring(0, colonIdx).trim().toLowerCase();
    let val = decl.substring(colonIdx + 1).trim();

    // Convert font-size to relative units (em)
    if (prop === 'font-size') {
      // Convert pt to em (standard 12pt = 1em / 16px)
      val = val.replace(/(\d*\.?\d+)\s*pt\b/gi, (match, p1) => {
        const pt = parseFloat(p1);
        const em = +(pt / 12).toFixed(3);
        return `${em}em`;
      });
      // Convert px to em (standard 16px = 1em)
      val = val.replace(/(\d*\.?\d+)\s*px\b/gi, (match, p1) => {
        const px = parseFloat(p1);
        const em = +(px / 16).toFixed(3);
        return `${em}em`;
      });
    } else {
      // For other dimensions (margin, padding, etc.), convert pt to px
      val = val.replace(/(\d*\.?\d+)\s*pt\b/gi, (match, p1) => {
        const ptValue = parseFloat(p1);
        const pxValue = Math.round((ptValue * 96) / 72);
        return `${pxValue}px`;
      });
    }

    val = val.replace(/\s+/g, ' ');
    normalized.push({ prop, val });
  }

  // Sort properties to canonicalize declarations
  normalized.sort((a, b) => a.prop.localeCompare(b.prop));
  return normalized.map(d => `${d.prop}:${d.val}`).join(';');
}

// Compare two element attributes strictly
function areAttributesEqual(el1, el2) {
  const attribs1 = el1.attribs || {};
  const attribs2 = el2.attribs || {};
  const keys1 = Object.keys(attribs1);
  const keys2 = Object.keys(attribs2);

  if (keys1.length !== keys2.length) return false;
  for (const key of keys1) {
    if (key === 'id') return false; // Elements with IDs should never be merged
    if (key === 'style') {
      if (normalizeStyle(attribs1[key]) !== normalizeStyle(attribs2[key])) {
        return false;
      }
    } else if (attribs1[key] !== attribs2[key]) {
      return false;
    }
  }
  return true;
}

// Process HTML: safe empty element cleanup, strict adjacent span merging, style extraction
function processHtmlContent(html, stylesMap, classCounterRef) {
  const $ = cheerio.load(html, { decodeEntities: false });

  // 1. Remove ONLY empty inline formatting tags with no children and no id/name
  // Never touches void elements (br, hr, img), structure (head, p, table), or bookmarks
  $('span, b, i, u, strong, em, font, small, big').each(function () {
    const el = this;
    if (el.attribs && (el.attribs.id || el.attribs.name)) return;
    if (el.children && el.children.length > 0) {
      const hasContent = el.children.some(child => {
        if (child.type === 'tag') return true;
        if (child.type === 'text' && child.data && child.data.trim().length > 0) return true;
        return false;
      });
      if (hasContent) return;
    }
    $(this).remove();
  });

  // 2. Merge STRICTLY adjacent <span> tags with identical attributes
  // IMPORTANT: We inspect current.next (the immediate next DOM node).
  // If there is ANY text node or another element in between, it will NEVER merge.
  $('span').each(function () {
    const current = this;
    if (!current.parent) return;

    let next = current.next;
    while (
      next &&
      next.type === 'tag' &&
      next.name === 'span' &&
      areAttributesEqual(current, next)
    ) {
      const $current = $(current);
      const $next = $(next);
      $current.append($next.contents());
      const toRemove = next;
      next = next.next;
      $(toRemove).remove();
    }
  });

  // 3. Extract inline styles and convert to deduplicated classes
  $('[style]').each(function () {
    const rawStyle = $(this).attr('style');
    if (!rawStyle || !rawStyle.trim()) {
      $(this).removeAttr('style');
      return;
    }

    const canonicalKey = normalizeStyle(rawStyle);
    if (!canonicalKey) {
      $(this).removeAttr('style');
      return;
    }

    let className;
    if (stylesMap.has(canonicalKey)) {
      className = stylesMap.get(canonicalKey);
    } else {
      className = `class-${classCounterRef.counter++}`;
      stylesMap.set(canonicalKey, className);
    }

    $(this).removeAttr('style').addClass(className);
  });

  // 4. Ensure <head> and <meta charset="UTF-8"> exist
  let head = $('head');
  if (!head.length) {
    head = $('<head></head>').prependTo('html');
  }

  const metaCharset = head.find('meta[charset]');
  const metaHttpEquiv = head.find('meta[http-equiv="Content-Type" i]');
  if (metaCharset.length) {
    metaCharset.attr('charset', 'UTF-8');
  } else if (metaHttpEquiv.length) {
    metaHttpEquiv.attr('content', 'text/html; charset=UTF-8');
  } else {
    head.prepend('<meta charset="UTF-8">\n');
  }

  // Remove existing <style> tags from head
  head.find('style').remove();

  // Add stylesheet link if not already present
  const mergedCssFileName = 'merged-styles.css';
  if (!head.find(`link[href="${mergedCssFileName}"]`).length) {
    head.append(`<link rel="stylesheet" href="${mergedCssFileName}">\n`);
  }

  return $.html();
}

// Handle file uploads and processing
function handleFileUpload(req, res) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);

  if (!boundaryMatch) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Invalid Content-Type: missing multipart boundary' }));
    return;
  }

  const boundary = boundaryMatch[1] || boundaryMatch[2];

  parseMultipartData(req, boundary.trim())
    .then(files => {
      const stylesMap = new Map();
      const classCounterRef = { counter: 1 };
      const outputFiles = [];

      files.forEach((fileObj, index) => {
        const cleanedHtml = processHtmlContent(fileObj.content, stylesMap, classCounterRef);

        let outputName;
        if (fileObj.filename) {
          const parsed = path.parse(fileObj.filename);
          outputName = `${parsed.name}-clean.html`;
        } else {
          outputName = `index-clean-${index + 1}.html`;
        }

        const htmlOutputPath = path.join(outputDir, outputName);
        fs.writeFileSync(htmlOutputPath, cleanedHtml, 'utf-8');
        console.log(`Wrote HTML file: ${htmlOutputPath}`);

        outputFiles.push({
          name: outputName,
          url: `/output/${encodeURIComponent(outputName)}`,
          type: 'html'
        });
      });

      // Build formatted CSS content from stylesMap
      let cssContent = '/* Extracted and Merged Styles */\n';
      stylesMap.forEach((className, canonicalKey) => {
        const formattedProps = canonicalKey
          .split(';')
          .map(decl => {
            const colonIdx = decl.indexOf(':');
            return `${decl.substring(0, colonIdx)}: ${decl.substring(colonIdx + 1)}`;
          })
          .join('; ');
        cssContent += `.${className} { ${formattedProps}; }\n`;
      });

      const mergedCssOutputPath = path.join(outputDir, 'merged-styles.css');
      fs.writeFileSync(mergedCssOutputPath, cssContent, 'utf-8');
      console.log(`Wrote CSS file: ${mergedCssOutputPath}`);

      outputFiles.push({
        name: 'merged-styles.css',
        url: '/output/merged-styles.css',
        type: 'css'
      });

      // Send JSON response with file list and convenience download URLs
      const htmlFile = outputFiles.find(f => f.type === 'html');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          message: 'Your files have been successfully converted and saved to the output folder!',
          files: outputFiles,
          downloadHtmlUrl: htmlFile ? htmlFile.url : null,
          downloadCssUrl: '/output/merged-styles.css'
        })
      );
    })
    .catch(err => {
      console.error('Error processing upload:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'File processing failed: ' + err.message }));
    });
}

// Create HTTP server
const server = http.createServer((req, res) => {
  const reqUrl = req.url.split('?')[0];

  if (req.method === 'GET' && reqUrl === '/') {
    serveFile(res, path.join(__dirname, 'index.html'), 'text/html; charset=utf-8');
  } else if (req.method === 'POST' && reqUrl === '/upload') {
    handleFileUpload(req, res);
  } else if (req.method === 'GET' && reqUrl.startsWith('/output/')) {
    // Serve output files securely
    let filename;
    try {
      filename = decodeURIComponent(reqUrl.slice('/output/'.length));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('400: Invalid file path');
      return;
    }

    if (!filename || filename !== path.basename(filename) || filename === '.' || filename === '..') {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403: Forbidden');
      return;
    }

    const filePath = path.join(outputDir, filename);

    const ext = path.extname(filePath).toLowerCase();
    let contentType = 'text/plain; charset=utf-8';
    if (ext === '.html') contentType = 'text/html; charset=utf-8';
    else if (ext === '.css') contentType = 'text/css; charset=utf-8';

    serveFile(res, filePath, contentType);
  } else if (req.method === 'GET' && reqUrl.startsWith('/src/')) {
    // Serve static frontend files securely
    const srcDir = path.join(__dirname, 'src');
    const safePath = path.normalize(path.join(__dirname, reqUrl));

    if (!safePath.startsWith(srcDir)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403: Forbidden');
      return;
    }

    const ext = path.extname(safePath).toLowerCase();
    let contentType = 'text/plain; charset=utf-8';
    switch (ext) {
      case '.css':
        contentType = 'text/css; charset=utf-8';
        break;
      case '.js':
        contentType = 'application/javascript; charset=utf-8';
        break;
      case '.png':
        contentType = 'image/png';
        break;
      case '.jpg':
      case '.jpeg':
        contentType = 'image/jpeg';
        break;
      case '.gif':
        contentType = 'image/gif';
        break;
      case '.ico':
        contentType = 'image/x-icon';
        break;
    }

    serveFile(res, safePath, contentType);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404: Not Found');
  }
});

// Start the server with automatic port fallback if in use
let PORT = parseInt(process.env.PORT, 10) || 3001;

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} is already in use. Trying port ${PORT + 1}...`);
    PORT++;
    setTimeout(() => {
      server.listen(PORT);
    }, 300);
  } else {
    console.error('Server error:', err);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running at http://localhost:${PORT}`);
  // ONLY open the browser if you are running this on your own computer
  if (process.env.NODE_ENV !== 'production') {
    open(`http://localhost:${PORT}`).catch(() => {});
  }
});
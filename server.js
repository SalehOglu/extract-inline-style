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

// Serve the front-end HTML page
function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('404: File Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
}

// Helper function to parse multipart form data
function parseMultipartData(req, boundary) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });

    req.on('end', () => {
      const parts = body.split(`--${boundary}`);
      const files = [];

      parts.forEach(part => {
        if (part.includes('Content-Disposition: form-data; name="files[]";')) {
          const headersEndIndex = part.indexOf('\r\n\r\n');
          const fileContent = part.substring(headersEndIndex + 4, part.lastIndexOf('\r\n'));
          files.push(fileContent);
        }
      });

      if (files.length > 0) {
        resolve(files);
      } else {
        reject('No file data found');
      }
    });
  });
}

// Handle file uploads and processing
function handleFileUpload(req, res) {
  const contentType = req.headers['content-type'];
  const boundary = contentType.split('; ')[1].replace('boundary=', '');

  parseMultipartData(req, boundary)
    .then(files => {
      let mergedCssContent = '';
      const stylesMap = {};
      let classCounter = 1;
      const outputFiles = [];

      files.forEach((fileData, index) => {
        const html = fileData.toString('utf-8');
        const cleanHtml = html.replace(/�/g, ' ').trim();
        
        const $ = cheerio.load(cleanHtml);

        // Remove empty elements or elements containing only &nbsp;
        $('*').each(function () {
          const htmlContent = $(this).html().trim();
          if (!htmlContent || htmlContent === '&nbsp;') {
            $(this).replaceWith(' ');
          }
        });

        // Merge consecutive <span> tags with the same attributes
        $('span').each(function() {
          const currentSpan = $(this);
          const nextSpan = currentSpan.next('span');
      
          if (nextSpan.length && currentSpan.attr('style') === nextSpan.attr('style')) {
            const currentHtml = currentSpan.html();
            const nextHtml = nextSpan.html();
      
            if (nextHtml.trim() === '' || nextHtml === '&nbsp;') {
              if (currentHtml.trim() !== '') {
                currentSpan.html(currentHtml + '&nbsp;');
              }
            } else {
              const lastCharCurrent = currentHtml.slice(-1);
              const firstCharNext = nextHtml.charAt(0);
      
              if (lastCharCurrent !== ' ' && lastCharCurrent !== '&nbsp;' && firstCharNext.trim() !== '') {
                currentSpan.html(currentHtml + ' ' + nextHtml);
              } else {
                currentSpan.html(currentHtml + nextHtml);
              }
            }
      
            nextSpan.remove();
          }
        });
  
        // Extract inline styles and convert to classes
        $('[style]').each(function() {
          const inlineStyle = $(this).attr('style').trim();
          let className;

          if (stylesMap[inlineStyle]) {
            className = stylesMap[inlineStyle];
          } else {
            className = `class-${classCounter++}`;
            stylesMap[inlineStyle] = className;
            mergedCssContent += `.${className} { ${inlineStyle} }\n`;
          }
      
          $(this).removeAttr('style').addClass(className);
        });
  
        // Ensure the <head> contains all the existing <link> and <script> tags
        const head = $('head').length ? $('head') : $('<head></head>').prependTo('html');
  
        // Remove all existing <style> tags from the <head>
        head.find('style').remove();
  
        const mergedCssFileName = 'merged-styles.css';
        if (!$(`link[href="${mergedCssFileName}"]`).length) {
          head.append(`<link rel="stylesheet" href="${mergedCssFileName}">`);
        }
        
        // Write the new HTML
        const htmlOutputPath = path.join(outputDir, `index-clean-${index + 1}.html`);
        try {
          fs.writeFileSync(htmlOutputPath, $.html());
          console.log(`Wrote HTML file: ${htmlOutputPath}`);
          outputFiles.push(`output/index-clean-${index + 1}.html`);
        } catch (err) {
          console.error(`Error writing HTML file ${htmlOutputPath}:`, err);
        }
      });

      // Convert pt to px in merged CSS content
      const finalCssContent = convertPtToPx(mergedCssContent);

      // Write the merged CSS file
      const mergedCssOutputPath = path.join(outputDir, 'merged-styles.css');
      try {
        fs.writeFileSync(mergedCssOutputPath, finalCssContent);
        console.log(`Wrote CSS file: ${mergedCssOutputPath}`);
        outputFiles.push('output/merged-styles.css');
      } catch (err) {
        console.error(`Error writing CSS file ${mergedCssOutputPath}:`, err);
      }

      // Send a single response with file paths
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        message: 'Your files have been successfully converted and saved to the output folder!',
        files: outputFiles
      }));
    })
    .catch(err => {
      console.error('Error parsing file:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'File upload failed' }));
    });
}

// Create an HTTP server
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    serveFile(res, path.join(__dirname, 'index.html'), 'text/html');
  } else if (req.method === 'POST' && req.url === '/upload') {
    handleFileUpload(req, res);
  } else if (req.method === 'GET' && req.url.startsWith('/src/')) {
    const filePath = path.join(__dirname, req.url);
    const ext = path.extname(filePath).toLowerCase();

    let contentType = 'text/plain';
    switch (ext) {
      case '.css':
        contentType = 'text/css';
        break;
      case '.js':
        contentType = 'application/javascript';
        break;
      case '.png':
        contentType = 'image/png';
        break;
      case '.jpg':
        contentType = 'image/jpeg';
        break;
      case '.gif':
        contentType = 'image/gif';
        break;
    }

    serveFile(res, filePath, contentType);  
  } else {
    res.writeHead(404);
    res.end('404: Not Found');
  }
});

// Function to convert pt to px
function convertPtToPx(cssContent) {
  return cssContent.replace(/(\d*\.?\d+)\s*pt/g, (match, p1) => {
    const ptValue = parseFloat(p1);
    const pxValue = Math.round(ptValue * 1.333);
    return `${pxValue}px`;
  });
}

// Start the server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

if (process.env.NODE_ENV === 'development') {
  open(`http://localhost:${PORT}`);
}
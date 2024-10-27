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
      let fileData = null;

      parts.forEach(part => {
        if (part.includes('Content-Disposition: form-data; name="file";')) {
          // Extract the file data
          const headersEndIndex = part.indexOf('\r\n\r\n');
          const fileContent = part.substring(headersEndIndex + 4, part.lastIndexOf('\r\n'));
          fileData = fileContent;
        }
      });

      if (fileData) {
        resolve(fileData);
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
    .then(fileData => {
      // Process the uploaded HTML content
      const html = fileData.toString('utf-8');
      const cleanHtml = html.replace(/�/g, ' ').trim();

      const $ = cheerio.load(cleanHtml);
      let cssContent = '';
      const stylesMap = {}; // To store unique styles and their corresponding classes
      let classCounter = 1; // Class name counter

      // Remove empty elements or elements containing only &nbsp;
      $('*').each(function () {
        const htmlContent = $(this).html().trim();
        if (!htmlContent || htmlContent === '&nbsp;') {
          $(this).replaceWith(' '); // Replace with a space
        }
      });

  // Merge consecutive <span> tags with the same attributes
  $('span').each(function() {
    const currentSpan = $(this);
    const nextSpan = currentSpan.next('span');

    if (nextSpan.length && currentSpan.attr('style') === nextSpan.attr('style')) {
      const currentHtml = currentSpan.html();
      const nextHtml = nextSpan.html();
    
      // Check if nextHtml is empty or contains only whitespace
      if (nextHtml.trim() === '' || nextHtml === '&nbsp;') {
        // If nextHtml is empty, we can skip merging or add a space
        if (currentHtml.trim() !== '') {
          currentSpan.html(currentHtml + '&nbsp;'); // Add non-breaking space
        }
      } else {
        // Determine if a space is needed before merging
        const lastCharCurrent = currentHtml.slice(-1);
        const firstCharNext = nextHtml.charAt(0);
    
        // Check if the last character of currentHtml is not a space
        if (lastCharCurrent !== ' ' && lastCharCurrent !== '&nbsp;' && firstCharNext.trim() !== '') {
          currentSpan.html(currentHtml + ' ' + nextHtml); // Add regular space
        } else {
          currentSpan.html(currentHtml + nextHtml); // Just merge without adding space
        }
      }

      nextSpan.remove();
    }
  });

      // Extract inline styles and convert to classes
      $('[style]').each(function () {
        const inlineStyle = $(this).attr('style').trim();

        let className;
        if (stylesMap[inlineStyle]) {
          className = stylesMap[inlineStyle];
        } else {
          className = `class-${classCounter++}`;
          stylesMap[inlineStyle] = className;

          cssContent += `.${className} { ${inlineStyle} }\n`;
        }

        $(this).removeAttr('style').addClass(className);
      });

      // Ensure the <head> contains all the existing <link> and <script> tags
      const head = $('head').length ? $('head') : $('<head></head>').prependTo('html');

      // Check if any <style> tags exist in the <head>
      if (head.find('style').length) {
        // Remove all existing <style> tags from the <head>
        head.find('style').remove();
      }

      // Check if styles.css is already included
      if (!$('link[href="styles.css"]').length) {
          head.append('<link rel="stylesheet" href="styles.css">');
      }

      // Write the new HTML to the output folder
      const htmlOutputPath = path.join(outputDir, 'index-clean.html');
      fs.writeFile(htmlOutputPath, $.html(), (err) => {
        if (err) {
          console.error('Error writing cleaned HTML:', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Error processing file' }));
          return;
        }
      });

      // Write the extracted CSS to the output folder
      const cssOutputPath = path.join(outputDir, 'styles.css');
      fs.writeFile(cssOutputPath, cssContent, (err) => {
        if (err) {
          console.error('Error writing CSS file:', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Error processing file' }));
          return;
        }
      });

      // Respond with a success message
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'File processed successfully!' }));
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
  } else {
    res.writeHead(404);
    res.end('404: Not Found');
  }
});

// Start the server
const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  open(`http://localhost:${PORT}`);

});

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
      const files = []; // Array to hold each file's data

      parts.forEach(part => {
        if (part.includes('Content-Disposition: form-data; name="files[]";')) {
          const headersEndIndex = part.indexOf('\r\n\r\n');
          const fileContent = part.substring(headersEndIndex + 4, part.lastIndexOf('\r\n'));
          files.push(fileContent); // Add file data to array
        }
      });

      if (files.length > 0) {
        resolve(files); // Resolve with an array of files
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
    .then(files  => {
      let mergedCssContent = ''; // To hold all merged CSS styles
      const stylesMap = {}; // To store unique styles and their corresponding classes
      let classCounter = 1; // Class name counter

      // Loop through each file and process it
      files.forEach((fileData, index) => {
        const html = fileData.toString('utf-8');
        const cleanHtml = html.replace(/�/g, ' ').trim();
        
        const $ = cheerio.load(cleanHtml);
        // let cssContent = '';
       
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
              if (currentHtml.trim() !== '') {
                currentSpan.html(currentHtml + '&nbsp;'); // Add non-breaking space
              }
            } else {
              const lastCharCurrent = currentHtml.slice(-1);
              const firstCharNext = nextHtml.charAt(0);
      
              if (lastCharCurrent !== ' ' && lastCharCurrent !== '&nbsp;' && firstCharNext.trim() !== '') {
                currentSpan.html(currentHtml + ' ' + nextHtml); // Add regular space
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
  
        // Check if any <style> tags exist in the <head>
        if (head.find('style').length) {
          // Remove all existing <style> tags from the <head>
          head.find('style').remove();
        }
  
       const mergedCssFileName = 'merged-styles.css';
        if (!$(`link[href="${mergedCssFileName}"]`).length) {
          head.append(`<link rel="stylesheet" href="${mergedCssFileName}">`);
        }
        
        // Convert pt to px in merged CSS content
        const finalCssContent = convertPtToPx(mergedCssContent);

        // Write the new HTML and extracted CSS to the output folder
        const htmlOutputPath = path.join(outputDir, `index-clean-${index + 1}.html`);

        fs.writeFile(htmlOutputPath, $.html(), (err) => {
          if (err) {
            console.error('Error writing cleaned HTML:', err);
          }
        });

        const mergedCssOutputPath = path.join(outputDir, 'merged-styles.css');

        fs.writeFile(mergedCssOutputPath, finalCssContent, (err) => {
          if (err) {
            console.error('Error writing merged CSS file:', err);
          }
        });
        
        // Send the URL of the cleaned HTML file back to the client  
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          message: 'Your file has been successfully converted!',
          downloadHtmlUrl: `/output/index-clean-${index + 1}.html`,
          downloadCssUrl: `/output/merged-styles.css`,
        }));
      })

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
    // Serve static files (CSS, JS, images, etc.)
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
  } else if (req.method === 'GET' && req.url.startsWith('/output/')) {
    // Serve output files (cleaned HTML, CSS, etc.)
    const filePath = path.join(__dirname, req.url);
    const ext = path.extname(filePath).toLowerCase();

    let contentType = 'text/plain';
    switch (ext) {
        case '.html':
            contentType = 'text/html';
            break;
        case '.css':
            contentType = 'text/css';
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
      const pxValue = Math.round(ptValue * 1.333); // Convert pt to px
      return `${pxValue}px`; // Return the new value with px
  });
}

// Start the server
// const PORT = 3001;
// server.listen(PORT, () => {
//   console.log(`Server is running on http://localhost:${PORT}`);
//   open(`http://localhost:${PORT}`);

// });

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

if (process.env.NODE_ENV === 'development') {
  open(`http://localhost:${PORT}`);
}
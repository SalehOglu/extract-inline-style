# Extract inline-style tool

This steps for extracting the inline style from HTML document to a separated CSS file and a more cleaner HTML file.

* For node versions less than v-16:

1. `npm install cheerio@1.0.0-rc.10 --save` 
2. `npm install parse5@5.0.0 --save`
3. `npm install sass --save-dev`
4. `node server.js` or run: `.\app.bat`
5. Watch for changes in the SCSS directory and compile to CSS directory:  `.\watch.bat`


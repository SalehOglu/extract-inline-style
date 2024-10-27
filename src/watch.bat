@echo off
setlocal

rem Set the paths for the input (SCSS) and output (CSS) directories
set "SASS_DIR=%~dp0scss"
set "CSS_DIR=%~dp0css"

rem Create the CSS directory if it doesn't exist
if not exist "%CSS_DIR%" (
    mkdir "%CSS_DIR%"
)

rem Print the paths for debugging
echo Watching for changes in: "%SASS_DIR%"
echo Compiling to: "%CSS_DIR%"

rem Watch for changes in the SCSS directory and compile to CSS directory
sass --watch "%SASS_DIR%:css" --style expanded

if %errorlevel% neq 0 (
    echo Error starting Sass watch process.
    exit /b %errorlevel%
)

endlocal

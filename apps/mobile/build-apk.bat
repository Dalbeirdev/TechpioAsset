@echo off
setlocal
cd /d "E:\TechpioAsset\apps\mobile"
set "EAS=C:\Users\DalbeirSingh\AppData\Roaming\npm\eas.cmd"
echo ==========================================================
echo    TechpioAsset  -  Build Android APK (EAS cloud)
echo ==========================================================
echo.
echo Paste your Expo access token below, then press Enter.
echo (Right-click inside this window to paste.)
echo.
set /p EXPO_TOKEN=Token:
echo.
echo Verifying login...
call "%EAS%" whoami
echo.
echo If your username appeared above, press a key to start the build.
echo If it said "Not logged in" or an error, close this window and get a fresh token.
pause
echo.
echo Starting the APK build (this uploads, then queues on Expo's cloud)...
call "%EAS%" build -p android --profile preview
echo.
echo ==========================================================
echo    Finished. Scroll up for the build link / QR code.
echo ==========================================================
pause
endlocal

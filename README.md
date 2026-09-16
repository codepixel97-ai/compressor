# Shrinkly — Vercel File Compressor

A static, privacy-friendly file compressor designed for Vercel.

## Features
- Drag-and-drop file selection
- Regular compression
- Target-size mode
- Image compression to WebP/JPEG
- Browser-native video re-encoding (Chrome/Edge recommended)
- ZIP compression for general files
- No server upload: files are processed locally in the browser

## Deploy to Vercel
1. Extract this ZIP.
2. In Vercel, create a new project and upload/import these files.
3. No framework or environment variables are required.
4. Deploy.

`vercel.json` is included so Vercel treats it as a static site.

## Important limitations
Target-size compression is strongest for images. Video target sizing uses a calculated bitrate and can land above or below the requested size because browser encoders and audio/container overhead vary. General ZIP compression cannot guarantee a target size, especially for already-compressed files such as MP4, JPG, ZIP, RAR, etc.

Video compression uses MediaRecorder/captureStream and therefore runs roughly in real time and depends on browser codec support. Chrome/Edge are recommended.

# Shrinkly Universal Compressor

Static Vercel/GitHub project.

## What changed
Video compression now uses FFmpeg compiled to WebAssembly as a compatibility fallback. This is designed to work across modern iPhone/iPad, Android, Windows and Mac browsers instead of relying on `captureStream()`.

## Deploy/update
Replace the files in your GitHub repository with these files and commit the changes. If your Vercel project is connected to that GitHub repository, Vercel normally creates a new deployment automatically from the commit.

## Notes
- The first video compression downloads the FFmpeg browser engine (~30 MB).
- Video encoding is CPU/RAM intensive, particularly on phones.
- Very large files may fail because of browser/WebAssembly memory limits.
- Target size is an estimate for video; codecs/container overhead mean exact byte-perfect sizing is not guaranteed.
- Files remain local during compression; the FFmpeg code itself is downloaded from a CDN.

# Offline instrumental renderer

This separate package pins the authoring engine. It is not imported by the
application and must not be added to the application's dependency list.

Install the reviewed tool dependencies separately, with install scripts disabled:

```sh
npm ci --ignore-scripts --prefix scripts/music/renderer-runtime
```

Obtain `GeneralUser-GS.sf2` from the exact official revision recorded in
`assets/media-generation/soundtracks/v2/NOTICE.txt`, retain the author's license,
and verify its SHA-256 before use. Keep the bank in a scratch directory outside
the application. The generator verifies the reviewed hash as well.

From the repository root, run the offline authoring script with explicit paths:

```sh
node scripts/generate-ai-media-instrumentals.mjs \
  --renderer=/absolute/repository/scripts/music/renderer-runtime/node_modules/spessasynth_core/dist/index.js \
  --soundfont=/absolute/scratch/GeneralUser-GS.sf2 \
  --ffmpeg=/absolute/path/to/ffmpeg
```

The engine is `spessasynth_core` 4.4.1; its transitive dependencies are pinned by
the accompanying lockfile. The reviewed render used FFmpeg 8.1.1. Generated
files are mono 24 kHz 16-bit PCM with declared duration and SHA in the manifest.
Published assets are immutable: a later composition or bank change requires a
new catalogue version rather than replacing an existing recording.

API details checked against 4.4.1: await `synth.ready`, process at most 128 samples
per quantum, then call `synth.destroy()`. The synthesizer owns and destroys its
loaded bank: parse a separate bank instance per recording before destroying it.

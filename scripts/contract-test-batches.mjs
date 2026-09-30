// Windows caps the full process command line at 32,767 UTF-16 characters.
// Leave room for Node, flags and quoting while keeping file order and coverage.
export function contractTestBatches(files, platform = process.platform) {
  if (platform !== "win32") return [files];
  const batches = [];
  let batch = [];
  let length = 0;
  for (const file of files) {
    const argumentLength = file.length + 3;
    if (batch.length && length + argumentLength > 24_000) {
      batches.push(batch);
      batch = [];
      length = 0;
    }
    batch.push(file);
    length += argumentLength;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

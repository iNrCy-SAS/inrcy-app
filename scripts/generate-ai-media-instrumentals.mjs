/**
 * Offline authoring tool. The renderer and instrument bank are never shipped
 * with the application. Run with pinned spessasynth_core 4.4.1 and the bank
 * documented in assets/media-generation/soundtracks/v2/NOTICE.txt.
 *
 * node scripts/generate-ai-media-instrumentals.mjs
 *   --renderer=/absolute/path/to/spessasynth_core/dist/index.js
 *   --soundfont=/absolute/path/to/GeneralUser-GS.sf2
 *   --ffmpeg=/absolute/path/to/ffmpeg
 * Optional --tracks=id,id --durations=24 for auditioning before a full render.
 * Never rerender assets after they have been published; create a new version.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs, promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { INSTRUMENTAL_COMPOSITIONS, composeInstrumental } from "./music/instrumental-compositions.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "assets/media-generation/soundtracks/v2");
const BANK_SHA256 = "9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cfe";
const { values } = parseArgs({ options: { renderer: { type: "string" }, soundfont: { type: "string" }, ffmpeg: { type: "string" }, tracks: { type: "string" }, durations: { type: "string" } } });
if (!values.renderer || !values.soundfont || !values.ffmpeg) throw new Error("Provide --renderer, --soundfont and --ffmpeg explicitly");
const selectedIds = values.tracks?.split(",");
if (selectedIds?.some(id=>!INSTRUMENTAL_COMPOSITIONS.some(track=>track.id===id))) throw new Error("Unknown score ID");
const tracks = INSTRUMENTAL_COMPOSITIONS.filter(track=>!selectedIds || selectedIds.includes(track.id));
const durations = values.durations ? values.durations.split(",").map(Number) : [8,16,24];
if (durations.some(duration=>![8,16,24].includes(duration))) throw new Error("Unsupported duration");
const { SpessaSynthProcessor, SoundBankLoader, SpessaLog } = await import(pathToFileURL(path.resolve(values.renderer)).href);
SpessaLog.setLogLevel(false,false,false);
const bankBytes = await readFile(values.soundfont);
if (createHash("sha256").update(bankBytes).digest("hex") !== BANK_SHA256) throw new Error("Instrument bank SHA does not match the reviewed version");
const execute = promisify(execFile);
const sampleRate = 24_000;
const manifest = [];
await mkdir(OUTPUT,{recursive:true});
const temporary = await mkdtemp(path.join(tmpdir(),"inrcy-instrumental-authoring-"));

function floatWav(samples) {
  const output = Buffer.alloc(44+samples.length*4);
  output.write("RIFF",0); output.writeUInt32LE(output.length-8,4); output.write("WAVE",8);
  output.write("fmt ",12); output.writeUInt32LE(16,16); output.writeUInt16LE(3,20); output.writeUInt16LE(1,22);
  output.writeUInt32LE(sampleRate,24); output.writeUInt32LE(sampleRate*4,28); output.writeUInt16LE(4,32); output.writeUInt16LE(32,34);
  output.write("data",36); output.writeUInt32LE(samples.length*4,40);
  samples.forEach((sample,index)=>output.writeFloatLE(sample,44+index*4));
  return output;
}

async function render(score) {
  const sampleCount = Math.round(sampleRate*score.durationSeconds);
  // destroy() owns and disposes its sound bank, so each render needs its own
  // parsed instance. Reusing one would silence every render after the first.
  const bank = SoundBankLoader.fromArrayBuffer(bankBytes.buffer.slice(bankBytes.byteOffset,bankBytes.byteOffset+bankBytes.byteLength));
  const synth = new SpessaSynthProcessor(sampleRate,{eventsEnabled:false,effectsEnabled:true,maxBufferSize:128});
  synth.soundBankManager.addSoundBank(bank,"main");
  await synth.ready;
  synth.setSystemParameter("autoAllocateVoices",true);
  for (const voice of score.voices) {
    if(voice.drums) synth.midiChannels[voice.channel].setDrums(true);
    synth.programChange(voice.channel,voice.program);
    synth.controllerChange(voice.channel,7,voice.volume);
    synth.controllerChange(voice.channel,10,voice.pan);
    synth.controllerChange(voice.channel,91,["ambient","cinema","harp"].includes(score.groove) ? 48 : 22);
    synth.controllerChange(voice.channel,93,0);
  }
  const events = score.events.map(event=>({...event,frame:Math.round(event.time*sampleRate)}));
  const left = new Float32Array(sampleCount), right = new Float32Array(sampleCount);
  let nextEvent = 0, offset = 0;
  try {
    while(offset<sampleCount) {
      while(nextEvent<events.length && events[nextEvent].frame<=offset) {
        const event=events[nextEvent++];
        if(event.on) synth.noteOn(event.channel,event.pitch,event.velocity);
        else synth.noteOff(event.channel,event.pitch);
      }
      const count=Math.min(128,sampleCount-offset,nextEvent<events.length?events[nextEvent].frame-offset:128);
      if(count<=0) throw new Error("Invalid note scheduling");
      synth.process(left,right,offset,count); offset+=count;
    }
  } finally { synth.destroy(); }
  const mono=new Float32Array(sampleCount);
  let energy=0;
  for(let index=0;index<sampleCount;index++) {
    mono[index]=(left[index]+right[index])*.5;
    if(!Number.isFinite(mono[index])) throw new Error("Nonfinite instrumental audio");
    energy+=mono[index]**2;
  }
  if(energy/sampleCount<1e-8) throw new Error("Instrumental render is silent");
  return mono;
}

try {
  for (const track of tracks) {
    for (const durationSeconds of durations) {
      const score={...composeInstrumental(track,durationSeconds),groove:track.groove};
      const samples=await render(score);
      const rawPath=path.join(temporary,track.id+"-"+durationSeconds+"s-raw.wav");
      const normalizedPath=path.join(temporary,track.id+"-"+durationSeconds+"s.wav");
      await writeFile(rawPath,floatWav(samples));
      const filter="afade=t=in:st=0:d=0.06,afade=t=out:st="+(durationSeconds-.24)+":d=0.24,loudnorm=I=-18:TP=-1.5:LRA=8";
      await execute(values.ffmpeg,["-hide_banner","-loglevel","error","-y","-i",rawPath,"-af",filter,"-ar",String(sampleRate),"-ac","1","-c:a","pcm_s16le","-t",String(durationSeconds),"-map_metadata","-1","-fflags","+bitexact","-flags:a","+bitexact",normalizedPath],{windowsHide:true,timeout:90_000});
      // Canonical 44-byte PCM header makes the checked-in assets portable and
      // lets both production and tests validate exact duration and sample data.
      const normalized=await readFile(normalizedPath);
      let cursor=12,pcm=null;
      while(cursor+8<=normalized.length) {
        const kind=normalized.toString("ascii",cursor,cursor+4),size=normalized.readUInt32LE(cursor+4);
        if(kind==="data") {pcm=normalized.subarray(cursor+8,cursor+8+size);break;}
        cursor+=8+size+(size%2);
      }
      if(!pcm || pcm.length!==sampleRate*durationSeconds*2) throw new Error("Unexpected normalized duration");
      const wav=Buffer.alloc(44+pcm.length);
      wav.write("RIFF",0);wav.writeUInt32LE(wav.length-8,4);wav.write("WAVE",8);
      wav.write("fmt ",12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
      wav.writeUInt32LE(sampleRate,24);wav.writeUInt32LE(sampleRate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
      wav.write("data",36);wav.writeUInt32LE(pcm.length,40);pcm.copy(wav,44);
      const fileName=track.id+"-"+durationSeconds+"s.wav";
      await writeFile(path.join(OUTPUT,fileName),wav);
      manifest.push({id:track.id+"-"+durationSeconds+"s",soundtrackId:track.id,fileName,durationSeconds,sampleRate,channels:1,bitsPerSample:16,sizeBytes:wav.length,sha256:createHash("sha256").update(wav).digest("hex"),license:"inrcy-original-instrumental-v2",genre:track.genre,bpm:track.bpm,metre:score.metre,programs:score.voices.map(voice=>({channel:voice.channel,program:voice.program,drums:Boolean(voice.drums)})),noteEvents:score.events.length});
      process.stdout.write("Rendered "+fileName+"\n");
    }
  }
  // Partial auditions must not replace the complete release manifest.
  if(!selectedIds && durations.length===3 && new Set(durations).size===3) {
    await writeFile(path.join(OUTPUT,"manifest.json"),JSON.stringify({version:2,generatedBy:"inrcy-instrumental-scores",renderer:"spessasynth_core@4.4.1",instrumentBank:"GeneralUser GS v2.0.3",instrumentBankSha256:BANK_SHA256,source:"scripts/music/instrumental-compositions.mjs",tracks:manifest},null,2)+"\n");
  }
  process.stdout.write(JSON.stringify({rendered:manifest.length,output:OUTPUT})+"\n");
} finally {
  const resolved=path.resolve(temporary);
  if(!resolved.startsWith(path.resolve(tmpdir())+path.sep) || !path.basename(resolved).startsWith("inrcy-instrumental-authoring-")) throw new Error("Unexpected authoring scratch path");
  await rm(resolved,{recursive:true,force:true});
}

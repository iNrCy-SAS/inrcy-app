/**
 * Thirty original short scores, written for the iNrCy instrumental catalogue.
 * Each score has its own orchestration, metre, melodic motif and groove.
 * General MIDI programs are zero based. No prerecorded musical phrase is used.
 */
export const INSTRUMENTAL_COMPOSITIONS = [
  { id: "piano-serein", bpm: 70, root: 62, genre: "Piano solo", lead: 0, comp: 0, bass: null, groove: "piano", progression: [0, -3, 5, 7], motif: [[0,12,1.4],[1.75,16,.7],[3,14,.8],[4,9,1.4],[6,12,1.6]] },
  { id: "guitare-solaire", bpm: 92, root: 60, genre: "Guitare acoustique", lead: 24, comp: 24, bass: null, groove: "nylon", progression: [0,5,-3,7], motif: [[0,12,.8],[1.5,16,.35],[2,19,.8],[3.5,16,.4],[4.5,14,.7],[6,12,1.4]] },
  { id: "ukulele-souriant", bpm: 112, root: 65, genre: "Pop acoustique", lead: 10, comp: 24, bass: 32, groove: "ukulele", progression: [0,-3,5,7], motif: [[.5,12,.3],[1,16,.3],[1.5,19,.7],[3,16,.4],[4.5,14,.4],[5.5,12,.4],[6.5,19,.8]] },
  { id: "folk-en-route", bpm: 106, root: 55, genre: "Folk et harmonica", lead: 22, comp: 25, bass: 32, groove: "folk", progression: [0,0,5,7], motif: [[0,19,.7],[1,16,.45],[2,14,.8],[3.5,12,.35],[4,14,.7],[5.5,16,.4],[6.5,12,1.2]] },
  { id: "bossa-terrasse", bpm: 126, root: 64, minor: true, genre: "Bossa nova", lead: 73, comp: 24, bass: 32, groove: "bossa", progression: [0,5,2,7], motif: [[.5,12,.5],[1.5,14,.4],[2.5,15,.9],[4,19,.5],[5.5,17,.5],[6.5,14,.6],[7.5,12,.4]] },
  { id: "jazz-velours", bpm: 104, root: 58, genre: "Jazz swing", lead: 59, comp: 0, bass: 32, groove: "swing", progression: [0,2,5,7], motif: [[0,14,.6],[.667,16,.25],[1.667,19,.6],[3,21,.8],[4.667,19,.4],[5.667,14,.5],[7,12,.8]] },
  { id: "funk-boutique", bpm: 112, root: 52, minor: true, genre: "Funk et clavinet", lead: 61, comp: 7, bass: 36, groove: "funk", progression: [0,0,5,7], motif: [[.25,12,.2],[1,15,.18],[1.75,19,.4],[3,17,.25],[4.75,15,.2],[5.5,12,.35],[7,10,.25],[7.5,12,.25]] },
  { id: "disco-lumiere", bpm: 120, root: 57, minor: true, genre: "Disco orchestral", lead: 45, comp: 0, bass: 34, groove: "disco", progression: [0,8,3,7], motif: [[0,12,.4],[.5,19,.4],[1.5,24,.6],[3,22,.5],[4,19,.4],[4.5,15,.4],[5.5,17,.6],[7,19,.5]] },
  { id: "house-elan", bpm: 124, root: 53, minor: true, genre: "House", lead: 16, comp: 4, bass: 38, groove: "house", progression: [0,8,3,10], motif: [[.5,12,.2],[1.5,19,.2],[2.5,15,.2],[3.5,22,.25],[4.5,19,.25],[5.5,15,.2],[6.5,12,.2],[7.5,10,.25]] },
  { id: "electro-neon", bpm: 132, root: 50, minor: true, genre: "Électro séquencée", lead: 81, comp: 80, bass: 38, groove: "electro", progression: [0,3,8,7], motif: [[0,24,.2],[.75,19,.2],[1.25,15,.2],[2,22,.35],[3.5,19,.2],[4,24,.2],[4.75,27,.2],[5.5,22,.35],[7,19,.5]] },
  { id: "chill-lofi", bpm: 78, root: 50, minor: true, genre: "Lo-fi feutré", lead: 11, comp: 4, bass: 32, groove: "lofi", progression: [0,5,8,7], motif: [[.15,19,1.2],[2.65,15,.65],[4.15,14,1.3],[6.65,12,.65]] },
  { id: "hiphop-pulsation", bpm: 88, root: 48, minor: true, genre: "Hip-hop", lead: 5, comp: 5, bass: 39, groove: "hiphop", progression: [0,0,8,7], motif: [[0,12,.3],[.75,19,.3],[1.5,15,.3],[2.75,10,.4],[4.5,12,.3],[5.25,15,.3],[6,19,.3],[7,12,.5]] },
  { id: "afro-percussions", bpm: 110, root: 62, minor: true, genre: "Afro et kalimba", lead: 108, comp: 12, bass: 34, groove: "afro", progression: [0,5,3,7], motif: [[0,12,.3],[.667,15,.3],[1.333,19,.4],[2,17,.3],[2.667,15,.3],[3.333,12,.3],[4,10,.3],[4.667,12,.3],[5.333,17,.4],[6.667,15,.3],[7.333,12,.4]] },
  { id: "reggae-soleil", bpm: 84, root: 57, genre: "Reggae", lead: 27, comp: 16, bass: 33, groove: "reggae", progression: [0,5,0,7], motif: [[0,12,.6],[1.5,16,.3],[2.5,19,.6],[4,21,.6],[5.5,19,.3],[6.5,16,.6]] },
  { id: "latin-fiesta", bpm: 122, root: 62, minor: true, genre: "Salsa et cuivres", lead: 56, comp: 0, bass: 32, groove: "latin", progression: [0,7,0,5], motif: [[0,19,.35],[.75,19,.35],[1.5,24,.5],[3,22,.45],[4,19,.35],[4.75,17,.35],[5.5,15,.5],[7,12,.45]] },
  { id: "pop-optimiste", bpm: 116, root: 60, genre: "Pop lumineuse", lead: 27, comp: 0, bass: 34, groove: "pop", progression: [0,7,-3,5], motif: [[0,12,.65],[1,16,.65],[2.5,19,1],[4,21,.65],[5,19,.65],[6.5,16,1]] },
  { id: "rock-atelier", bpm: 134, root: 52, minor: true, genre: "Rock", lead: 30, comp: 29, bass: 34, groove: "rock", progression: [0,3,5,7], motif: [[0,0,.4],[.5,0,.4],[1,12,.4],[2,7,.4],[2.5,10,.4],[3.5,12,.4],[4,15,.6],[5,12,.4],[6,10,.4],[7,7,.8]] },
  { id: "blues-garage", bpm: 94, root: 57, genre: "Blues shuffle", lead: 26, comp: 3, bass: 33, groove: "blues", progression: [0,0,5,0,7,5,0,7], motif: [[0,12,.5],[.667,15,.3],[1,17,.5],[2,18,.5],[2.667,17,.3],[3,15,.7],[4.667,12,.6],[6,10,.6],[7,12,.8]] },
  { id: "cordes-cinema", bpm: 72, root: 48, minor: true, genre: "Cordes cinématiques", lead: 60, comp: 48, bass: 42, groove: "cinema", progression: [0,8,3,7], motif: [[0,12,2.5],[3,19,1.5],[5,22,1.5],[7,19,.75]] },
  { id: "valse-elegante", bpm: 96, root: 62, metre: 3, genre: "Valse à l’accordéon", lead: 40, comp: 21, bass: 32, groove: "waltz", progression: [0,5,7,0], motif: [[0,12,.8],[1,16,.8],[2,19,.8],[3,21,1.7],[5,19,.8]] },
  { id: "harpe-nature", bpm: 60, root: 60, genre: "Harpe et flûte", lead: 75, comp: 46, bass: null, groove: "harp", progression: [0,5,2,7], motif: [[1,24,2.4],[5,21,2.4]] },
  { id: "ambient-espace", bpm: 54, root: 53, genre: "Ambient aérien", lead: 98, comp: 89, bass: null, groove: "ambient", progression: [0,7,2,5], motif: [[.5,24,2.4],[5,19,2.4]] },
  { id: "marimba-tropicale", bpm: 104, root: 55, metre: 6, unit: .5, genre: "Marimba tropicale", lead: 12, comp: 10, bass: 35, groove: "marimba", progression: [0,5,7,0], motif: [[0,12,.65],[1,16,.65],[2,19,.65],[3,24,.65],[4,19,.65],[5,16,.65],[6,14,.65],[8,17,.65],[9,21,.65],[11,19,.65]] },
  { id: "cloches-hiver", bpm: 100, root: 62, genre: "Célesta et clochettes", lead: 8, comp: 9, bass: 43, groove: "bells", progression: [0,5,0,7], motif: [[0,12,.8],[1,12,.35],[1.5,16,.35],[2.5,19,.8],[4,21,.8],[5,19,.35],[5.5,16,.35],[6.5,14,.8]] },
  { id: "country-banjo", bpm: 138, root: 55, genre: "Country et banjo", lead: 105, comp: 25, bass: 32, groove: "country", progression: [0,5,0,7], motif: [[0,12,.2],[.5,19,.2],[1,16,.2],[1.5,24,.2],[2,19,.2],[2.5,16,.2],[3,14,.2],[3.5,19,.2],[4,12,.2],[5,16,.3],[6,14,.3],[7,12,.6]] },
  { id: "celtique-flute", bpm: 112, root: 62, metre: 6, unit: .5, genre: "Jig celtique", lead: 72, comp: 46, bass: 40, groove: "celtic", progression: [0,7,5,0], motif: [[0,12,.7],[1,14,.7],[2,16,.7],[3,19,.7],[4,16,.7],[5,14,.7],[6,12,.7],[7,16,.7],[8,19,.7],[9,21,.7],[10,19,.7],[11,16,.7]] },
  { id: "tango-passion", bpm: 112, root: 57, minor: true, genre: "Tango", lead: 23, comp: 0, bass: 32, groove: "tango", progression: [0,5,7,0], motif: [[0,12,.5],[.75,15,.35],[1.5,19,.8],[3,17,.6],[4,15,.4],[4.75,14,.4],[5.5,12,.8],[7,11,.6]] },
  { id: "synthwave-retro", bpm: 96, root: 50, minor: true, genre: "Synthwave rétro", lead: 80, comp: 90, bass: 38, groove: "synthwave", progression: [0,8,3,10], motif: [[0,24,1],[1.5,19,.5],[2.5,22,1],[4,27,1],[5.5,24,.5],[6.5,19,1]] },
  { id: "chiptune-arcade", bpm: 156, root: 60, genre: "Chiptune arcade", lead: 80, comp: 81, bass: 38, groove: "chip", progression: [0,-3,5,7], motif: [[0,24,.18],[.5,28,.18],[1,31,.18],[1.5,36,.18],[2,35,.18],[2.5,31,.18],[3,28,.18],[3.5,26,.18],[4,24,.18],[4.5,31,.18],[5,28,.18],[5.5,24,.18],[6,26,.18],[7,31,.5]] },
  { id: "drum-bass-rapide", bpm: 172, root: 48, minor: true, genre: "Drum and bass", lead: 85, comp: 4, bass: 39, groove: "dnb", progression: [0,8,5,7], motif: [[.5,24,.4],[2,19,.4],[3.5,22,.4],[5,15,.4],[6.5,19,.4]] },
];

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function composeInstrumental(track, durationSeconds) {
  if (![8, 16, 24].includes(durationSeconds)) throw new Error("Unsupported composition duration");
  const events = [];
  const metre = track.metre || 4;
  const beatSeconds = 60 / track.bpm * (track.unit || 1);
  const endBeat = (durationSeconds - .7) / beatSeconds;
  const voices = [
    { channel: 0, program: track.lead, volume: 88, pan: 65 },
    { channel: 1, program: track.comp, volume: track.groove === "ambient" ? 64 : 75, pan: 48 },
    { channel: 2, program: track.bass ?? 32, volume: 82, pan: 64 },
    { channel: 3, program: 48, volume: 48, pan: 82 },
    { channel: 9, program: ["electro", "chip", "hiphop", "dnb"].includes(track.groove) ? 25 : 0, volume: 82, pan: 64, drums: true },
  ];
  function note(channel, beat, length, pitch, velocity = 78) {
    const start = beat * beatSeconds;
    if (beat < 0 || start >= durationSeconds - .65) return;
    const stop = Math.min(durationSeconds - .24, start + Math.max(.035, length * beatSeconds));
    events.push({ time: start, on: true, channel, pitch: clamp(Math.round(pitch), 12, 108), velocity: clamp(Math.round(velocity), 1, 117) });
    events.push({ time: stop, on: false, channel, pitch: clamp(Math.round(pitch), 12, 108), velocity: 0 });
  }
  function chord(beat, length, pitches, velocity = 62, strum = 0) {
    pitches.forEach((pitch, index) => note(1, beat + index * strum, length, pitch, velocity + index % 3 * 2));
  }
  function drum(beat, pitch, velocity = 70) { note(9, beat, .15, pitch, velocity); }
  function hats(base, swing = false, sixteenths = false, gain = 44) {
    const step = sixteenths ? .25 : .5;
    for (let index = 0; index < metre / step; index++) {
      const at = index * step + (swing && index % 2 ? .13 : 0);
      drum(base + at, index % 4 === 3 ? 46 : 42, gain + (index % 2 ? -8 : 7));
    }
  }
  function backbeat(base, kind = "pop") {
    const kick = kind === "electronic" ? 36 : 35;
    (kind === "four" ? [0,1,2,3] : kind === "break" ? [0,.75,2.5,3.5] : [0,2]).forEach(at => drum(base + at, kick, 84));
    [1,3].forEach(at => drum(base + at, ["four","electronic"].includes(kind) ? 39 : 38, 74));
    hats(base, ["shuffle","lofi"].includes(kind), kind === "electronic", kind === "lofi" ? 32 : 43);
  }
  const barCount = Math.ceil(endBeat / metre);
  for (let bar = 0; bar < barCount; bar++) {
    const base = bar * metre;
    const shift = track.progression[bar % track.progression.length];
    const root = track.root + shift;
    const degree = (shift % 12 + 12) % 12;
    const third = track.minor ? [0,5].includes(degree) ? 3 : 4 : [2,4,9].includes(degree) ? 3 : 4;
    const triad = [root,root + third,root + 7];
    const rich = [...triad,root + (["swing","lofi","blues","bossa"].includes(track.groove) ? 10 : 11)];
    const bass = (at, len, pitch = root - 12, velocity = 76) => note(2, base + at, len, pitch, velocity);
    switch (track.groove) {
      case "piano":
        [0,1,2,3].forEach((at,index) => chord(base + at,.85,[root - 12,triad[index % 3],triad[(index+1) % 3] + 12],50 + index * 3,.018));
        break;
      case "nylon":
        [0,.5,1,1.5,2,2.5,3,3.5].forEach((at,index) => note(1,base + at,.65,[root-12,...triad,root+12,root+7][index % 6],66 + index % 2 * 7));
        break;
      case "ukulele":
        [0,.75,1.5,2,2.75,3.5].forEach((at,index) => chord(base + at,.22,triad.map(pitch=>pitch+12),index % 2 ? 65 : 76,.012));
        bass(0,.8); bass(2,.7,root-5); [1,3].forEach(at=>drum(base+at,39,52)); hats(base,false,false,24);
        break;
      case "folk":
        [0,2].forEach(at=>bass(at,.75,at ? root-5 : root-12));
        [.5,1.5,2.5,3.5].forEach(at=>chord(base+at,.33,triad,66,.017));
        [0,1,2,3].forEach(at=>drum(base+at,42,35)); [1,3].forEach(at=>drum(base+at,37,42));
        break;
      case "bossa":
        [0,1.5,2.5,3.5].forEach(at=>chord(base+at,.43,rich,59,.012));
        bass(0,1.3); bass(1.75,.35,root-5); bass(2,1.3); bass(3.5,.3,root-13);
        [0,1.5,3].forEach(at=>drum(base+at,37,48)); [.5,1,2,2.5,3.5].forEach(at=>drum(base+at,69,30));
        break;
      case "swing":
        [.667,1.667,3].forEach(at=>chord(base+at,.38,rich,56));
        [root-12,root-8,root-5,root-1].forEach((pitch,index)=>bass(index,.82,pitch,70));
        [0,.667,1,1.667,2,2.667,3,3.667].forEach(at=>drum(base+at,51,42));
        [1,3].forEach(at=>drum(base+at,37,43));
        break;
      case "funk":
        [.25,.75,1.5,2.25,3,3.75].forEach(at=>chord(base+at,.13,rich,77));
        [[0,-12,.3],[.75,0,.2],[1.5,-5,.25],[2.25,-12,.3],[3,-2,.2],[3.5,0,.25]].forEach(([at,offset,length])=>bass(at,length,root+offset,91));
        [0,1.75,2.5].forEach(at=>drum(base+at,36,83)); [1,3].forEach(at=>drum(base+at,38,81)); hats(base,false,true,39);
        break;
      case "disco":
        [.5,1.5,2.5,3.5].forEach(at=>chord(base+at,.28,triad,74));
        for (let index=0;index<8;index++) bass(index*.5,.35,root+(index%2 ? 0 : -12),82);
        backbeat(base,"four"); if (bar%2===0) drum(base,49,49);
        break;
      case "house":
        [.5,1.5,2.5,3.5].forEach(at=>chord(base+at,.33,rich,77));
        [0,.75,1.5,2.75,3.5].forEach(at=>bass(at,.36,root-12,86));
        backbeat(base,"four");
        break;
      case "electro":
        for(let index=0;index<16;index++) note(1,base+index*.25,.17,triad[index%3]+(index%4===3?24:12),48);
        [0,.5,1.75,2,2.5,3.25].forEach(at=>bass(at,.28,root-12,91));
        backbeat(base,"electronic");
        break;
      case "lofi":
        chord(base+.12,2.5,rich,53); chord(base+2.72,.7,rich.map(pitch=>pitch-12),39);
        bass(.05,1.5); bass(2.55,.9,root-5,62);
        drum(base+.06,36,66); drum(base+2.68,36,56); [1.09,3.07].forEach(at=>drum(base+at,37,57)); hats(base,true,false,27);
        break;
      case "hiphop":
        [0,1.5,2.75].forEach(at=>chord(base+at,.3,triad,60));
        bass(0,1.8,root-12,98); bass(2.5,1.15,root-5,91);
        backbeat(base,"break"); [.75,2.25,3.75].forEach(at=>drum(base+at,42,28));
        break;
      case "afro":
        [0,.667,1.333,2,2.667,3.333].forEach((at,index)=>note(1,base+at,.36,triad[index%3]+12,64));
        [0,1.5,2.75].forEach(at=>bass(at,.5,root-12));
        [0,1.5,3].forEach(at=>drum(base+at,64,75)); [.667,2,3.333].forEach(at=>drum(base+at,63,68));
        [.5,1,2.5,3.5].forEach(at=>drum(base+at,60,53)); hats(base,false,false,26);
        break;
      case "reggae":
        [.5,1.5,2.5,3.5].forEach(at=>chord(base+at,.15,triad,78));
        bass(0,.9,root-12,87); bass(1.5,.35,root-5,79); bass(2.5,.45,root-12,83); bass(3.5,.28,root-10,74);
        drum(base+2,36,83); drum(base+2,37,75); hats(base,false,false,37);
        break;
      case "latin":
        [0,.5,1.5,2,2.75,3.5].forEach((at,index)=>chord(base+at,.25,[triad[index%3],triad[(index+1)%3]+12],76));
        [0,1.5,2.75].forEach(at=>bass(at,.5,root-12,85));
        (bar%2 ? [1,2.5] : [0,1.5,3]).forEach(at=>drum(base+at,75,67));
        [0,1,2,3].forEach(at=>drum(base+at,56,47)); [.5,1.5,2.5,3.5].forEach(at=>drum(base+at,64,67)); drum(base+3.75,65,67);
        break;
      case "pop":
        [0,2].forEach(at=>chord(base+at,1.6,triad,65));
        [0,1.5,2,3.5].forEach(at=>bass(at,.65,root-12));
        backbeat(base); if(bar%4===0) drum(base,49,58);
        break;
      case "rock":
        for(let index=0;index<8;index++) { chord(base+index*.5,.31,[root-12,root-5,root],86); bass(index*.5,.34,root-12,92); }
        backbeat(base); if(bar%2===0) drum(base,49,78);
        break;
      case "blues":
        [0,.667,1,1.667,2,2.667,3,3.667].forEach((at,index)=>chord(base+at,.26,[root,root+(index%2 ? 9 : 7),root+10],61));
        [root-12,root-8,root-5,root-3].forEach((pitch,index)=>bass(index,.72,pitch,77));
        backbeat(base,"shuffle");
        break;
      case "cinema":
        chord(base,3.55,[root-12,...triad,root+12],62 + bar%3*6,.025);
        bass(0,3.4,root-24,70); [0,2.5,3.5].forEach(at=>drum(base+at,41,bar%2 ? 58 : 72));
        if(bar%2===0) drum(base,49,42);
        break;
      case "waltz":
        bass(0,.8,root-12,77); chord(base+1,.6,triad,67,.012); chord(base+2,.65,triad,62,.012);
        break;
      case "harp":
        [0,.5,1,1.5,2,2.5,3,3.5].forEach((at,index)=>note(1,base+at,1.3,[...triad,root+14,root+19][index%5]+12,48+index%3*5));
        break;
      case "ambient":
        if(bar%2===0) chord(base,7.7,[root,root+7,root+14,root+19],49,.05);
        break;
      case "marimba":
        [0,2,3,5].forEach((at,index)=>note(1,base+at,.6,triad[index%3],51));
        bass(0,1.6,root-12,75); bass(3,1.5,root-5,68);
        [0,2,3,5].forEach(at=>drum(base+at,60,56)); [1,4].forEach(at=>drum(base+at,76,48));
        break;
      case "bells":
        [0,1.5,2.5,3.5].forEach((at,index)=>note(1,base+at,1,triad[index%3]+24,46));
        bass(0,1.8,root-12,48); bass(2,1.8,root-5,43);
        for(let index=0;index<8;index++) drum(base+index*.5,83,index%2?31:40);
        break;
      case "country":
        [0,2].forEach(at=>bass(at,.65,root-12,81));
        [1,3].forEach(at=>chord(base+at,.35,triad,70,.013));
        [0,1,2,3].forEach(at=>drum(base+at,42,41)); [1,3].forEach(at=>drum(base+at,37,54));
        break;
      case "celtic":
        [0,1,2,3,4,5].forEach((at,index)=>note(1,base+at,1.2,triad[index%3]+12,58));
        bass(0,5.3,root-12,41); drum(base,41,55); drum(base+3,41,42);
        break;
      case "tango":
        [0,.75,1.5,2,3].forEach((at,index)=>chord(base+at,index===2?.6:.22,triad,78-index%2*8));
        [0,1,2,3].forEach(at=>bass(at,.6,root-12,88));
        break;
      case "synthwave":
        chord(base,3.7,rich,42);
        for(let index=0;index<16;index++) bass(index*.25,.17,root+(index%4===2 ? -5 : -12),66+index%2*6);
        backbeat(base); drum(base+1,39,56); drum(base+3,39,56);
        break;
      case "chip":
        for(let index=0;index<16;index++) note(1,base+index*.25,.12,triad[index%3]+(index%2?12:0),40);
        [0,.5,1,1.5,2,2.5,3,3.5].forEach((at,index)=>bass(at,.2,root+(index%2?-5:-12),66));
        backbeat(base,"electronic");
        break;
      case "dnb":
        if(bar%2===0) chord(base+.5,3.2,rich,46);
        [0,.75,1.5,2,2.75,3.5].forEach((at,index)=>bass(at,.36,root+(index%3===2?-5:-12),88));
        [0,1.25,2.5,3.75].forEach(at=>drum(base+at,36,88));
        [1,3].forEach(at=>drum(base+at,38,92)); [1.75,2.75].forEach(at=>drum(base+at,38,34)); hats(base,false,false,52);
        break;
      default: throw new Error("Missing arrangement: " + track.groove);
    }
    // The lead is a written two-bar phrase, with rests and articulation specific
    // to this score. It is not a common endless eighth-note sequence.
    if (bar % 2 === 0) {
      const phraseLength = metre * 2;
      for (const [at, interval, length] of track.motif) {
        if(at < phraseLength) note(0,base+at,length,root+interval,track.groove==="cinema"?74:track.groove==="ambient"?46:75+(bar%3)*3);
      }
    }
  }
  // Let the phrase settle on its tonic rather than cutting an unfinished chord.
  const finalTime = durationSeconds - .86;
  for (const event of events) {
    if (!event.on && event.time > finalTime) event.time = finalTime;
  }
  const body = events.filter(event=>!event.on || event.time < finalTime);
  events.length = 0;
  events.push(...body);
  [track.root,track.root+(track.minor?3:4),track.root+7].forEach(pitch=>{
    events.push({time:finalTime+.025,on:true,channel:1,pitch,velocity:48});
    events.push({time:durationSeconds-.12,on:false,channel:1,pitch,velocity:0});
  });
  events.sort((a,b)=>a.time-b.time || Number(a.on)-Number(b.on));
  return { id: track.id, bpm: track.bpm, metre, genre: track.genre, voices, events, durationSeconds };
}

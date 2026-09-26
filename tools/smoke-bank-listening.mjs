import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mp3Signature,sanitizeMp3Stream,stripMp3Tags} from '../assets/question-bank/bank-listening-package.js';

const bitrates=[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0];
const makeFrame=(sampleByte=0x90,channelByte=0x64)=>{const sampleIndex=(sampleByte>>2)&3,rate=[44100,48000,32000][sampleIndex],bitrate=bitrates[(sampleByte>>4)&15],length=Math.floor(144000*bitrate/rate);const frame=new Uint8Array(length);frame.set([0xff,0xfb,sampleByte,channelByte]);return frame;};
const frame=makeFrame();
const id3=Uint8Array.from([0x49,0x44,0x33,4,0,0,0,0,0,0]);
const id3v1=new Uint8Array(128);id3v1.set([0x54,0x41,0x47]);
const tagged=new Uint8Array(id3.length+frame.length+id3v1.length);tagged.set(id3);tagged.set(frame,id3.length);tagged.set(id3v1,id3.length+frame.length);
assert.deepEqual([...stripMp3Tags(tagged)],[...frame],'MP3 packaging must remove ID3v2 and ID3v1 tags without touching frames');
assert.throws(()=>stripMp3Tags(Uint8Array.from([1,2,3,4])),/MP3 hợp lệ/,'invalid audio must be rejected');
assert.deepEqual(mp3Signature(frame),{version:'mpeg1',layer:'layer3',sampleRate:44100,bitrate:128,channelMode:1,key:'mpeg1:layer3:44100:128:1'});
const frame48=makeFrame(0x94);
assert.notEqual(mp3Signature(frame).key,mp3Signature(frame48).key,'different sample rates must have different packaging signatures');
const twoFrames=new Uint8Array(frame.length*2);twoFrames.set(frame);twoFrames.set(frame,frame.length);assert.equal(sanitizeMp3Stream(twoFrames).body.length,twoFrames.length);
const frame160=makeFrame(0xa0),vbrLike=new Uint8Array(frame.length+frame160.length);vbrLike.set(frame);vbrLike.set(frame160,frame.length);assert.throws(()=>sanitizeMp3Stream(vbrLike),/CBR/,'mixed bitrates in one clip must be rejected');

const generator=fs.readFileSync(new URL('../assets/question-bank/bank-generator.js',import.meta.url),'utf8');
const listeningMigration=fs.readFileSync(new URL('../supabase/migrations/20260926163840_question_bank_listening_and_stats.sql',import.meta.url),'utf8');
const statsMigration=fs.readFileSync(new URL('../supabase/migrations/20260926165143_question_bank_incremental_stats.sql',import.meta.url),'utf8');
for(const token of ['packageListeningAudio','staff_set_listening_audio_v118b','Listening phải được tạo trọn bộ một lần'])assert.ok(generator.includes(token),`missing Listening generator contract: ${token}`);
for(const token of ["bs.media_type='audio'","Part 1 requires an image"])assert.ok(listeningMigration.includes(token),`missing Listening migration contract: ${token}`);
for(const token of ['bank_attempt_stats_update','bank_attempt_stats_delete','bank_apply_attempt_stats'])assert.ok(statsMigration.includes(token),`missing incremental stats contract: ${token}`);

console.log('Question-bank Listening smoke OK: CBR MP3 validation, master-audio wiring, and incremental statistics.');

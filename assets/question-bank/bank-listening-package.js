import { MAX_AUDIO_UPLOAD_BYTES } from "../modules/media.js";

const textDecoder=new TextDecoder();
const isMp3Frame=(bytes,offset=0)=>bytes.length>=offset+4&&bytes[offset]===0xff&&(bytes[offset+1]&0xe0)===0xe0;
const bitrateMpeg1L3=[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0];
const bitrateMpeg2L3=[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0];

function synchsafe(bytes,offset){return ((bytes[offset]&0x7f)<<21)|((bytes[offset+1]&0x7f)<<14)|((bytes[offset+2]&0x7f)<<7)|(bytes[offset+3]&0x7f);}

export function stripMp3Tags(input){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  let start=0,end=bytes.length;
  if(bytes.length>=10&&textDecoder.decode(bytes.subarray(0,3))==="ID3"){
    const footer=(bytes[5]&0x10)!==0;
    start=Math.min(bytes.length,10+synchsafe(bytes,6)+(footer?10:0));
  }
  if(end-start>=128&&textDecoder.decode(bytes.subarray(end-128,end-125))==="TAG")end-=128;
  const body=bytes.subarray(start,end);
  if(!isMp3Frame(body,0))throw new Error("Clip Listening không phải luồng MP3 hợp lệ sau khi bỏ metadata ID3.");
  return body;
}

function frameInfo(bytes,offset=0){
  if(!isMp3Frame(bytes,offset))throw new Error("Không đọc được frame MP3.");
  const b1=bytes[offset+1],b2=bytes[offset+2],b3=bytes[offset+3];
  const versionBits=(b1>>3)&3,layerBits=(b1>>1)&3,bitrateIndex=(b2>>4)&15,sampleIndex=(b2>>2)&3,padding=(b2>>1)&1,channelMode=(b3>>6)&3;
  if(versionBits===1||sampleIndex===3||layerBits!==1)throw new Error("Chỉ hỗ trợ MP3 MPEG Layer III chuẩn để ghép audio.");
  const version=versionBits===3?"mpeg1":versionBits===2?"mpeg2":"mpeg2.5";
  const rates={mpeg1:[44100,48000,32000],mpeg2:[22050,24000,16000],"mpeg2.5":[11025,12000,8000]},sampleRate=rates[version][sampleIndex];
  const bitrate=(version==="mpeg1"?bitrateMpeg1L3:bitrateMpeg2L3)[bitrateIndex];
  if(!bitrate)throw new Error("MP3 free-format/reserved bitrate không được hỗ trợ.");
  const frameLength=Math.floor((version==="mpeg1"?144000:72000)*bitrate/sampleRate)+padding;
  if(frameLength<24||offset+frameLength>bytes.length)throw new Error("Clip MP3 có frame bị thiếu hoặc hỏng.");
  return {version,layer:"layer3",sampleRate,bitrate,channelMode,frameLength,key:`${version}:layer3:${sampleRate}:${bitrate}:${channelMode}`};
}

export function mp3Signature(bytes){const info=frameInfo(bytes,0);return {version:info.version,layer:info.layer,sampleRate:info.sampleRate,bitrate:info.bitrate,channelMode:info.channelMode,key:info.key};}

function hasVbrMetadata(frame){const text=textDecoder.decode(frame.subarray(0,Math.min(frame.length,320)));return text.includes("Xing")||text.includes("Info")||text.includes("VBRI");}

export function sanitizeMp3Stream(input){
  const body=stripMp3Tags(input);let offset=0,first=true,dataStart=0,signature=null;
  while(offset<body.length){
    const info=frameInfo(body,offset);
    if(first){
      first=false;
      if(hasVbrMetadata(body.subarray(offset,offset+info.frameLength)))dataStart=offset+info.frameLength;
      signature={version:info.version,layer:info.layer,sampleRate:info.sampleRate,bitrate:info.bitrate,channelMode:info.channelMode,key:info.key};
    }else if(info.key!==signature.key){
      throw new Error("Clip MP3 phải là CBR và giữ cùng sample-rate/kênh trong toàn bộ clip.");
    }
    offset+=info.frameLength;
  }
  if(offset!==body.length)throw new Error("Clip MP3 có dữ liệu dư không hợp lệ.");
  const cleaned=body.subarray(dataStart);
  if(!cleaned.length||!isMp3Frame(cleaned,0))throw new Error("Clip MP3 không còn frame audio sau metadata.");
  const cleanSignature=mp3Signature(cleaned);
  return {body:cleaned,signature:cleanSignature};
}

function audioDuration(blob){
  return new Promise(resolve=>{
    const url=URL.createObjectURL(blob),audio=document.createElement("audio");
    const done=value=>{URL.revokeObjectURL(url);audio.remove();resolve(Number.isFinite(value)?value:0);};
    const timer=setTimeout(()=>done(0),7000);
    audio.preload="metadata";
    audio.onloadedmetadata=()=>{clearTimeout(timer);done(audio.duration);};
    audio.onerror=()=>{clearTimeout(timer);done(0);};
    audio.src=url;
  });
}

function listeningDetails(details){return (details||[]).filter(d=>Number(d.item?.part_no)>=1&&Number(d.item?.part_no)<=4);}

function clipPath(detail){
  const rows=(detail.stimuli||[]).filter(s=>s.media_type==="audio"&&s.storage_path);
  if(rows.length!==1)throw new Error(`${detail.item?.public_code||"Item Listening"} phải có đúng một clip MP3.`);
  if(!/\.mp3$/i.test(rows[0].storage_path))throw new Error(`${detail.item?.public_code||"Item Listening"} phải dùng clip MP3.`);
  return rows[0].storage_path;
}

export async function packageListeningAudio({details,bankMedia,uploadMedia,testId,onProgress}){
  const rows=listeningDetails(details);if(!rows.length)return null;
  const paths=rows.map(clipPath),urls=await bankMedia.signedUrlMap(paths),parts=[];let totalBytes=0,totalDuration=0,masterSignature=null;
  for(let i=0;i<rows.length;i++){
    const detail=rows[i],path=paths[i],url=urls[path];
    onProgress?.({stage:"download",done:i,total:rows.length,code:detail.item?.public_code||""});
    if(!url)throw new Error(`Không tạo được liên kết clip ${detail.item?.public_code||path}.`);
    const response=await fetch(url,{cache:"no-store"});if(!response.ok)throw new Error(`Không tải được clip ${detail.item?.public_code||path} (HTTP ${response.status}).`);
    const blob=await response.blob();
    if(blob.type&&blob.type!=="audio/mpeg"&&!/mpeg|mp3/i.test(blob.type))throw new Error(`${detail.item?.public_code||"Clip"} không phải MP3.`);
    const duration=await audioDuration(blob);if(duration>0)totalDuration+=duration;
    const sanitized=sanitizeMp3Stream(new Uint8Array(await blob.arrayBuffer())),body=sanitized.body,signature=sanitized.signature;
    if(!masterSignature)masterSignature=signature;
    else if(signature.key!==masterSignature.key)throw new Error(`Clip ${detail.item?.public_code||i+1} không cùng chuẩn MP3 CBR với các clip trước. Hãy xuất toàn bộ clip cùng bitrate, sample-rate và chế độ kênh.`);
    totalBytes+=body.byteLength;if(totalBytes>MAX_AUDIO_UPLOAD_BYTES)throw new Error("Audio Listening sau khi ghép vượt 50 MB. Hãy nén các clip MP3 trước khi tạo đề.");
    parts.push(body);onProgress?.({stage:"download",done:i+1,total:rows.length,code:detail.item?.public_code||""});
  }
  const file=new File(parts,`listening-bank-${Date.now()}.mp3`,{type:"audio/mpeg",lastModified:Date.now()});
  onProgress?.({stage:"upload",done:0,total:1,percent:0});
  const uploaded=await uploadMedia(file,`tests/${testId}/listening-master`,{onProgress:p=>onProgress?.({stage:"upload",done:p.percent===100?1:0,total:1,percent:p.percent,status:p.status})});
  return {storage_path:uploaded.storage_path,filename:file.name,duration_seconds:totalDuration||null,size:file.size,audio_signature:masterSignature};
}

import { SUPABASE_URL } from "../config.js";

function fileExt(name=""){ return name.includes(".") ? "."+name.split(".").pop().toLowerCase() : ""; }

function mediaTypeFromFile(file){
  if(!file) return null;
  if(file.type.startsWith("image/")) return "image";
  if(file.type.startsWith("audio/")) return "audio";
  return null;
}

const SIGNED_URL_TTL_SECONDS=6*60*60;
const SIGNED_URL_CACHE_SAFETY_MS=5*60*1000;
const MAX_SOURCE_IMAGE_BYTES=20*1024*1024;
const MAX_IMAGE_EDGE=2000;
const TARGET_IMAGE_BYTES=2.5*1024*1024;
const STANDARD_AUDIO_UPLOAD_BYTES=6*1024*1024;
export const MAX_AUDIO_UPLOAD_BYTES=50*1024*1024;
const TUS_CHUNK_BYTES=6*1024*1024;
let tusPromise=null;

function canvasToBlob(canvas,type,quality){
  return new Promise(resolve=>canvas.toBlob(resolve,type,quality));
}

async function decodeImage(file){
  if("createImageBitmap" in window){
    const bitmap=await createImageBitmap(file);
    return {source:bitmap,width:bitmap.width,height:bitmap.height,close:()=>bitmap.close?.()};
  }
  const url=URL.createObjectURL(file);
  try{
    const img=new Image();
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});
    return {source:img,width:img.naturalWidth,height:img.naturalHeight,close:()=>{}};
  }finally{URL.revokeObjectURL(url);}
}

async function optimizeImage(file){
  if(!file?.type?.startsWith("image/")) return file;
  if(file.size>MAX_SOURCE_IMAGE_BYTES) throw new Error("Ảnh quá lớn. Vui lòng chọn ảnh dưới 20 MB.");
  if(file.type==="image/gif") return file;

  let decoded;
  try{ decoded=await decodeImage(file); }
  catch{ return file; }
  try{
    const scale=Math.min(1,MAX_IMAGE_EDGE/Math.max(decoded.width,decoded.height));
    if(scale===1 && file.size<=TARGET_IMAGE_BYTES) return file;
    const width=Math.max(1,Math.round(decoded.width*scale));
    const height=Math.max(1,Math.round(decoded.height*scale));
    const canvas=document.createElement("canvas");
    canvas.width=width; canvas.height=height;
    const ctx=canvas.getContext("2d",{alpha:true});
    if(!ctx) return file;
    ctx.drawImage(decoded.source,0,0,width,height);

    let blob=await canvasToBlob(canvas,"image/webp",0.86);
    if(blob && blob.size>TARGET_IMAGE_BYTES) blob=await canvasToBlob(canvas,"image/webp",0.76);
    if(!blob) return file;
    if(scale===1 && blob.size>=file.size) return file;
    const stem=(file.name||"image").replace(/\.[^.]+$/,'');
    return new File([blob],`${stem}.webp`,{type:"image/webp",lastModified:Date.now()});
  }finally{ decoded.close(); }
}

async function loadTus(){
  if(!tusPromise) tusPromise=import("https://cdn.jsdelivr.net/npm/tus-js-client@4/+esm");
  return tusPromise;
}

function directStorageEndpoint(){
  try{
    const url=new URL(SUPABASE_URL);
    const projectId=url.hostname.split(".")[0];
    if(projectId) return `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`;
  }catch{}
  return `${SUPABASE_URL}/storage/v1/upload/resumable`;
}

function uploadErrorMessage(error){
  const status=error?.originalResponse?.getStatus?.();
  const body=error?.originalResponse?.getBody?.();
  if(status) return `Upload audio lỗi HTTP ${status}${body?`: ${String(body).slice(0,240)}`:""}`;
  return error?.message||String(error||"Không xác định được lỗi upload.");
}

export function createMediaService(sb){
  const signedUrlCache=new Map();
  const cachedSignedUrl=path=>{
    const hit=signedUrlCache.get(path);
    if(!hit)return null;
    if(hit.expiresAt<=Date.now()){signedUrlCache.delete(path);return null;}
    return hit.url;
  };
  const rememberSignedUrl=(path,url)=>{
    if(path&&url)signedUrlCache.set(path,{url,expiresAt:Date.now()+SIGNED_URL_TTL_SECONDS*1000-SIGNED_URL_CACHE_SAFETY_MS});
    return url||null;
  };

  async function standardUpload(path,file,onProgress){
    onProgress?.({percent:0,uploaded:0,total:file.size,method:"standard",status:"uploading"});
    const {error}=await sb.storage.from("test-media").upload(path,file,{
      cacheControl:"3600",upsert:false,contentType:file.type
    });
    if(error) throw error;
    onProgress?.({percent:100,uploaded:file.size,total:file.size,method:"standard",status:"done"});
  }

  async function resumableUpload(path,file,onProgress){
    const {data,error}=await sb.auth.getSession();
    if(error) throw error;
    const token=data?.session?.access_token;
    if(!token) throw new Error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại trước khi tải audio.");
    const tus=await loadTus();

    await new Promise((resolve,reject)=>{
      let lastUploaded=0;
      let lastProgressAt=Date.now();
      let stallTimer=null;

      const clearStall=()=>{ if(stallTimer){clearInterval(stallTimer);stallTimer=null;} };
      const reportStall=()=>{
        const idleMs=Date.now()-lastProgressAt;
        if(lastUploaded>0 && idleMs>=15000){
          onProgress?.({
            percent:file.size?Math.min(100,Math.round((lastUploaded/file.size)*100)):0,
            uploaded:lastUploaded,total:file.size,method:"resumable",
            status:"waiting",idleMs
          });
        }
      };

      const upload=new tus.Upload(file,{
        endpoint:directStorageEndpoint(),
        retryDelays:[0,3000,5000,10000,20000],
        headers:{authorization:`Bearer ${token}`},
        uploadSize:file.size,
        uploadDataDuringCreation:true,
        chunkSize:TUS_CHUNK_BYTES,
        removeFingerprintOnSuccess:true,
        metadata:{
          bucketName:"test-media",
          objectName:path,
          contentType:file.type||"audio/mpeg",
          cacheControl:"3600"
        },
        onError(err){
          clearStall();
          reject(new Error(uploadErrorMessage(err)));
        },
        onProgress(uploaded,total){
          lastUploaded=uploaded;
          lastProgressAt=Date.now();
          const percent=total?Math.min(100,Math.round((uploaded/total)*100)):0;
          onProgress?.({percent,uploaded,total,method:"resumable",status:"uploading"});
        },
        onShouldRetry(err,retryAttempt,options){
          const status=err?.originalResponse?.getStatus?.();
          onProgress?.({
            percent:file.size?Math.min(100,Math.round((lastUploaded/file.size)*100)):0,
            uploaded:lastUploaded,total:file.size,method:"resumable",
            status:"retrying",retryAttempt:retryAttempt+1,httpStatus:status||null
          });
          return status===409 ? false : true;
        },
        onSuccess(){
          clearStall();
          onProgress?.({percent:100,uploaded:file.size,total:file.size,method:"resumable",status:"done"});
          resolve();
        }
      });

      stallTimer=setInterval(reportStall,5000);
      upload.findPreviousUploads()
        .then(previousUploads=>{
          if(previousUploads.length){
            upload.resumeFromPreviousUpload(previousUploads[0]);
            onProgress?.({percent:0,uploaded:0,total:file.size,method:"resumable",status:"resuming"});
          }
          upload.start();
        })
        .catch(err=>{
          clearStall();
          reject(new Error(uploadErrorMessage(err)));
        });
    });
  }

  async function uploadMedia(file,prefix="media",options={}){
    if(!file) return null;
    const kind=mediaTypeFromFile(file);
    if(!kind) throw new Error("Chỉ hỗ trợ ảnh hoặc âm thanh.");
    if(kind==="audio" && file.size>MAX_AUDIO_UPLOAD_BYTES){
      throw new Error("Audio quá lớn. Vui lòng dùng file không quá 50 MB.");
    }
    const prepared=kind==="image" ? await optimizeImage(file) : file;
    const path=`${prefix}/${crypto.randomUUID()}${fileExt(prepared.name)}`;
    if(kind==="audio" && prepared.size>STANDARD_AUDIO_UPLOAD_BYTES){
      await resumableUpload(path,prepared,options.onProgress);
    }else{
      await standardUpload(path,prepared,options.onProgress);
    }
    return {media_type:kind,storage_path:path};
  }

  async function signedUrl(path){
    if(!path) return null;
    const cached=cachedSignedUrl(path);if(cached)return cached;
    const {data,error}=await sb.storage.from("test-media").createSignedUrl(path,SIGNED_URL_TTL_SECONDS);
    return error ? null : rememberSignedUrl(path,data?.signedUrl||null);
  }

  async function signedUrlMap(paths){
    const unique=[...new Set(paths.filter(Boolean))];
    if(!unique.length) return {};
    const out={},missing=[];
    for(const path of unique){const cached=cachedSignedUrl(path);if(cached)out[path]=cached;else missing.push(path);}
    if(missing.length){
      const {data}=await sb.storage.from("test-media").createSignedUrls(missing,SIGNED_URL_TTL_SECONDS);
      for(const item of data||[]){if(item.signedUrl)out[item.path]=rememberSignedUrl(item.path,item.signedUrl);}
    }
    return out;
  }

  async function removeMedia(path){
    if(!path) return;
    const {error}=await sb.storage.from("test-media").remove([path]);
    if(error) throw error;
    signedUrlCache.delete(path);
  }

  return {uploadMedia,signedUrl,signedUrlMap,removeMedia};
}

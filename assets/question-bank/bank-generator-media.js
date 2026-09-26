import { embeddedImagePaths } from "../modules/rich-editor.js";

const unique=a=>[...new Set((a||[]).filter(Boolean))];

function detailPaths(detail){
  const part=Number(detail.item?.part_no||0);
  const values=[...(detail.stimuli||[]).map(x=>x.content),...(detail.questions||[]).flatMap(q=>[q.content,...(q.choices||[]).map(c=>c.content)])];
  const stimulusPaths=(detail.stimuli||[]).filter(x=>!(part>=1&&part<=4&&x.media_type==="audio")).map(x=>x.storage_path);
  const direct=[...stimulusPaths,...(detail.questions||[]).flatMap(q=>[q.storage_path,...(q.choices||[]).map(c=>c.storage_path)])];
  return unique([...direct,...values.flatMap(v=>embeddedImagePaths(v||""))]);
}

function filenameFromPath(path,type=""){
  const raw=String(path||"media").split("/").pop()||"media";
  if(/\.[a-z0-9]{2,5}$/i.test(raw))return raw;
  const ext={"image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif","audio/mpeg":"mp3","audio/mp4":"m4a","audio/x-m4a":"m4a","audio/wav":"wav","audio/aac":"aac","audio/ogg":"ogg"}[type];
  return ext?`${raw}.${ext}`:raw;
}

async function bankFile(bankMedia,path){
  const url=await bankMedia.signedUrl(path);if(!url)throw new Error(`Không đọc được media ngân hàng: ${path}`);
  const res=await fetch(url,{cache:"no-store"});if(!res.ok)throw new Error(`Không tải được media ngân hàng (HTTP ${res.status}).`);
  const blob=await res.blob();return new File([blob],filenameFromPath(path,blob.type),{type:blob.type||"application/octet-stream"});
}

export async function copySelectedBankMedia({details,bankMedia,uploadMedia,removeMedia,testId,onProgress}){
  const paths=unique((details||[]).flatMap(detailPaths)),mediaMap={},created=[];
  try{
    for(let i=0;i<paths.length;i++){
      const path=paths[i];onProgress?.({done:i,total:paths.length,path,status:"copying"});
      const file=await bankFile(bankMedia,path),uploaded=await uploadMedia(file,`tests/${testId}/bank`,{onProgress:p=>onProgress?.({done:i,total:paths.length,path,status:p.status||"uploading",percent:p.percent})});
      mediaMap[path]=uploaded.storage_path;created.push(uploaded.storage_path);onProgress?.({done:i+1,total:paths.length,path,status:"done"});
    }
    return {mediaMap,created};
  }catch(err){
    for(const path of created)try{await removeMedia(path);}catch{}
    throw err;
  }
}

export async function cleanupGeneratedTestMedia(paths,removeMedia){
  for(const path of paths||[])try{await removeMedia(path);}catch{}
}

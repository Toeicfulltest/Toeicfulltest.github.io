const BUCKET="bank-media";
const SIGNED_URL_TTL=6*60*60;
const MAX_IMAGE_BYTES=20*1024*1024;
const MAX_MEDIA_BYTES=50*1024*1024;

function ext(name=""){
  const m=String(name).toLowerCase().match(/\.(png|jpe?g|webp|mp3|mp4|m4a|wav|aac|ogg)$/);
  return m?m[0].replace(".jpeg",".jpg"):"";
}

function allowedType(type=""){
  return ["image/png","image/jpeg","image/webp","audio/mpeg","audio/mp4","audio/wav","audio/x-m4a","audio/aac","audio/ogg"].includes(type);
}

export function createQuestionBankMediaService(sb){
  const cache=new Map();

  async function signedUrl(path){
    if(!path)return null;
    const hit=cache.get(path);
    if(hit&&hit.expiresAt>Date.now())return hit.url;
    const {data,error}=await sb.storage.from(BUCKET).createSignedUrl(path,SIGNED_URL_TTL);
    if(error)return null;
    const url=data?.signedUrl||null;
    if(url)cache.set(path,{url,expiresAt:Date.now()+(SIGNED_URL_TTL-300)*1000});
    return url;
  }

  async function signedUrlMap(paths=[]){
    const unique=[...new Set(paths.filter(Boolean))],out={},missing=[];
    for(const path of unique){
      const hit=cache.get(path);
      if(hit&&hit.expiresAt>Date.now())out[path]=hit.url;else missing.push(path);
    }
    if(missing.length){
      const {data,error}=await sb.storage.from(BUCKET).createSignedUrls(missing,SIGNED_URL_TTL);
      if(!error)for(const item of data||[]){
        if(!item.signedUrl)continue;
        out[item.path]=item.signedUrl;
        cache.set(item.path,{url:item.signedUrl,expiresAt:Date.now()+(SIGNED_URL_TTL-300)*1000});
      }
    }
    return out;
  }

  async function uploadFile(file,prefix="media"){
    if(!(file instanceof File)||!file.size)throw new Error("Không có file để tải lên.");
    if(!allowedType(file.type))throw new Error("Định dạng media chưa được hỗ trợ trong ngân hàng.");
    if(file.size>MAX_MEDIA_BYTES)throw new Error("Media quá lớn. Vui lòng dùng file không quá 50 MB.");
    if(file.type.startsWith("image/")&&file.size>MAX_IMAGE_BYTES)throw new Error("Ảnh quá lớn. Vui lòng dùng ảnh không quá 20 MB.");
    const suffix=ext(file.name)||({"image/png":".png","image/jpeg":".jpg","image/webp":".webp","audio/mpeg":".mp3","audio/mp4":".mp4","audio/x-m4a":".m4a","audio/wav":".wav","audio/aac":".aac","audio/ogg":".ogg"}[file.type]||"");
    const path=`${prefix}/${crypto.randomUUID()}${suffix}`;
    const {error}=await sb.storage.from(BUCKET).upload(path,file,{cacheControl:"3600",upsert:false,contentType:file.type});
    if(error)throw error;
    return {storage_path:path,url:await signedUrl(path)};
  }

  async function uploadImage(file){
    if(!(file instanceof File)||!file.size)throw new Error("Không có ảnh để tải lên.");
    if(!file.type.startsWith("image/"))throw new Error("Vui lòng chọn file ảnh.");
    return uploadFile(file,"rich");
  }

  async function removePaths(paths=[]){
    const unique=[...new Set(paths.filter(Boolean))];if(!unique.length)return;
    const {error}=await sb.storage.from(BUCKET).remove(unique);if(error)throw error;
    unique.forEach(path=>cache.delete(path));
  }

  return {uploadFile,uploadImage,removePaths,signedUrl,signedUrlMap};
}

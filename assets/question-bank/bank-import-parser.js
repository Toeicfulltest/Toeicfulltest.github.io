import { sanitizeRichHtml,plainText } from "../modules/rich-editor.js";

let mammothPromise=null;
const MAMMOTH_SRC="https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js";
const KEYS=["A","B","C","D"];
const clean=s=>String(s??"").replace(/\u00a0/g," ").replace(/\s+/g," ").trim();

function loadMammoth(){
  if(window.mammoth)return Promise.resolve(window.mammoth);
  if(mammothPromise)return mammothPromise;
  mammothPromise=new Promise((resolve,reject)=>{
    const old=[...document.scripts].find(x=>x.src===MAMMOTH_SRC);
    const finish=()=>window.mammoth?resolve(window.mammoth):reject(new Error("Đã tải Mammoth nhưng không khởi tạo được thư viện."));
    if(old){old.addEventListener("load",finish,{once:true});old.addEventListener("error",()=>reject(new Error("Không tải được Mammoth.")),{once:true});return;}
    const s=document.createElement("script");s.src=MAMMOTH_SRC;s.async=true;s.onload=finish;s.onerror=()=>reject(new Error("Không tải được thư viện đọc Word. Kiểm tra kết nối mạng/CDN."));document.head.appendChild(s);
  });
  return mammothPromise;
}

function base64File(base64,type,name){
  const raw=atob(base64),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  const ext=type==="image/png"?"png":type==="image/webp"?"webp":"jpg";
  return new File([bytes],`${name}.${ext}`,{type:type||"image/jpeg"});
}

function inferPart(number,current=0){
  if(number>=101&&number<=130)return 5;if(number>=131&&number<=146)return 6;if(number>=147&&number<=200)return 7;
  return current>=5&&current<=7?current:0;
}
function rangeFromText(text){
  const m=clean(text).match(/Questions?\s+(\d{1,3})\s*(?:[-–—]|to)\s*(\d{1,3})\s+refer\b/i);
  return m?{start:+m[1],end:+m[2]}:null;
}
function questionFromText(text){const m=clean(text).match(/^(\d{1,3})\s*[.)]\s*/);return m?+m[1]:null;}
function choiceFromText(text){const m=clean(text).match(/^\(?([A-D])\)?\s*[.)]\s*/i);return m?m[1].toUpperCase():null;}
function stripLeading(html,re){
  const doc=new DOMParser().parseFromString(`<div>${html}</div>`,"text/html"),root=doc.body.firstElementChild;
  const walker=doc.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
  while((node=walker.nextNode())){if(!node.data.trim())continue;node.data=node.data.replace(re,"");break;}
  return sanitizeRichHtml(root.innerHTML,{storage:true});
}
function joinHtml(parts){return sanitizeRichHtml((parts||[]).filter(Boolean).join(""),{storage:true});}
function hasUnderline(html){return /<u\b/i.test(String(html||""));}
function emptyChoices(){return Object.fromEntries(KEYS.map(k=>[k,""]));}

function fixedPart6Range(number){
  if(number<131||number>146)return null;const start=131+Math.floor((number-131)/4)*4;return {start,end:start+3};
}

function parseBlocks(html){
  const doc=new DOMParser().parseFromString(`<div id="word-root">${html}</div>`,"text/html"),root=doc.querySelector("#word-root");
  return [...root.children].map((el,i)=>({index:i,html:sanitizeRichHtml(el.outerHTML,{storage:true}),text:clean(el.textContent||"")}));
}

function normalizeQuestion(q){
  const choices=KEYS.map(k=>({choice_key:k,content:joinHtml(q.choiceParts[k]||[])}));
  const underlined=choices.filter(c=>hasUnderline(c.content)).map(c=>c.choice_key);
  const correct=q.correct||((underlined.length===1)?underlined[0]:null),issues=[];
  if(!plainText(joinHtml(q.contentParts)))issues.push("Thiếu nội dung câu");
  const missing=choices.filter(c=>!plainText(c.content)).map(c=>c.choice_key);if(missing.length)issues.push(`Thiếu lựa chọn ${missing.join(", ")}`);
  if(!correct)issues.push("Chưa nhận diện đáp án đúng");
  if(underlined.length>1)issues.push("Có nhiều lựa chọn được gạch chân");
  return {number:q.number,content:joinHtml(q.contentParts),choices,correct_choice_key:correct,issues};
}

function buildItems(blocks,fileName){
  const groups=new Map(),standalone=[],loose=[];
  let currentPart=0,currentGroup=null,currentQuestion=null,lastChoice=null;
  const ensureGroup=(range,title=null,automatic=false)=>{
    const key=`${range.start}-${range.end}`;if(!groups.has(key))groups.set(key,{range,title:title||`Questions ${key}`,automatic,passageParts:[],questions:[],issues:[]});return groups.get(key);
  };
  const flushQuestion=()=>{
    if(!currentQuestion)return;
    const q=normalizeQuestion(currentQuestion);
    if(currentQuestion.group)currentQuestion.group.questions.push(q);else if(q.number>=101&&q.number<=130)standalone.push(q);else loose.push(q);
    currentQuestion=null;lastChoice=null;
  };

  for(const block of blocks){
    const pm=block.text.match(/^PART\s*([5-7])\b/i);if(pm){flushQuestion();currentPart=+pm[1];currentGroup=null;continue;}
    const range=rangeFromText(block.text);
    if(range){flushQuestion();currentPart=inferPart(range.start,currentPart);currentGroup=ensureGroup(range,block.text,false);continue;}
    const number=questionFromText(block.text);
    if(number&&number>=101&&number<=200){
      flushQuestion();const part=inferPart(number,currentPart);currentPart=part||currentPart;
      let group=null;
      if(currentGroup&&number>=currentGroup.range.start&&number<=currentGroup.range.end)group=currentGroup;
      else if(part===6){const fallback=fixedPart6Range(number);group=ensureGroup(fallback,`Questions ${fallback.start}-${fallback.end}`,true);currentGroup=group;}
      currentQuestion={number,part,group,contentParts:[stripLeading(block.html,/^\s*\d{1,3}\s*[.)]\s*/)],choiceParts:emptyChoices(),correct:null};lastChoice=null;continue;
    }
    const choice=choiceFromText(block.text);
    if(choice&&currentQuestion){
      const body=stripLeading(block.html,/^\s*\(?[A-D]\)?\s*[.)]\s*/i);currentQuestion.choiceParts[choice].push(body);lastChoice=choice;continue;
    }
    if(currentQuestion){
      if(lastChoice)currentQuestion.choiceParts[lastChoice].push(block.html);else currentQuestion.contentParts.push(block.html);continue;
    }
    if(currentGroup&&block.text)currentGroup.passageParts.push(block.html);
  }
  flushQuestion();

  const items=[];
  for(const q of standalone){
    items.push({item_type:"Q",part_no:5,title:`Câu ${q.number}`,source_type:"word_import",source_name:fileName,stimulus:"",questions:[q],issues:[...q.issues],metadata:{source_number:q.number}});
  }
  for(const group of [...groups.values()].sort((a,b)=>a.range.start-b.range.start)){
    const part=inferPart(group.range.start,0);if(![6,7].includes(part))continue;
    const questions=group.questions.sort((a,b)=>a.number-b.number),issues=[...group.issues];
    if(!plainText(joinHtml(group.passageParts)))issues.push("Chưa nhận diện passage/nội dung chung");
    if(part===6&&questions.length!==4)issues.push(`Part 6 nhận ${questions.length}/4 câu`);
    if(part===7&&(questions.length<2||questions.length>5))issues.push(`Part 7 nhận ${questions.length} câu trong nhóm`);
    if(group.automatic)issues.push("Nhóm Part 6 được suy ra theo số câu; cần kiểm tra passage");
    for(const q of questions)issues.push(...q.issues.map(x=>`Câu ${q.number}: ${x}`));
    items.push({item_type:"G",part_no:part,title:group.title||`Questions ${group.range.start}-${group.range.end}`,source_type:"word_import",source_name:fileName,stimulus:joinHtml(group.passageParts),questions,issues:[...new Set(issues)],metadata:{source_numbers:questions.map(q=>q.number),source_range:[group.range.start,group.range.end]}});
  }
  for(const q of loose){
    items.push({item_type:"G",part_no:q.number>=147?7:6,title:`Câu ${q.number} · cần ghép nhóm`,source_type:"word_import",source_name:fileName,stimulus:"",questions:[q],issues:["Chưa nhận diện được nhóm/passage",...q.issues],metadata:{source_numbers:[q.number]}});
  }
  return items.sort((a,b)=>(a.metadata.source_number||a.metadata.source_numbers?.[0]||999)-(b.metadata.source_number||b.metadata.source_numbers?.[0]||999));
}

export async function parseQuestionBankWord(file,{bankMedia,onProgress}={}){
  if(!file||!/\.docx$/i.test(file.name))throw new Error("Vui lòng chọn file Word .docx.");
  const mammoth=await loadMammoth();if(typeof mammoth?.convertToHtml!=="function")throw new Error("Mammoth không hỗ trợ chuyển Word sang HTML.");
  const uploadedPaths=[];let imageNo=0;
  try{
    const options={
      styleMap:["u => u","strike => s"],includeDefaultStyleMap:true,
      convertImage:mammoth.images.imgElement(async image=>{
        const type=image.contentType||"image/jpeg",base64=await image.read("base64"),fileImage=base64File(base64,type,`word-${++imageNo}`);
        onProgress?.(`Đang tải ảnh ${imageNo} từ Word…`);const up=await bankMedia.uploadFile(fileImage,"word-import");uploadedPaths.push(up.storage_path);return {src:up.url||""};
      })
    };
    const result=await mammoth.convertToHtml({arrayBuffer:await file.arrayBuffer()},options),doc=new DOMParser().parseFromString(`<div id="converted">${result.value||""}</div>`,"text/html");
    const imgs=[...doc.querySelectorAll("#converted img")];imgs.forEach((img,i)=>{const path=uploadedPaths[i];if(path)img.setAttribute("data-storage-path",path);});
    const html=sanitizeRichHtml(doc.querySelector("#converted")?.innerHTML||"",{storage:false}),blocks=parseBlocks(html),items=buildItems(blocks,file.name);
    if(!items.length)throw new Error("Không nhận diện được câu Part 5–7 nào trong file Word.");
    return {items,uploadedPaths,messages:(result.messages||[]).map(x=>x.message).filter(Boolean)};
  }catch(err){
    if(uploadedPaths.length)try{await bankMedia.removePaths(uploadedPaths);}catch(cleanErr){console.warn("Không dọn được media Word sau lỗi parse",cleanErr);}
    throw err;
  }
}

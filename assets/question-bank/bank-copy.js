import { esc } from "../modules/utils.js";
import { isRichHtml,plainText,sanitizeRichHtml } from "../modules/rich-editor.js";

function textHtml(value=""){
  if(!value)return "";
  if(isRichHtml(value))return sanitizeRichHtml(value,{storage:true});
  return `<p>${esc(String(value)).replace(/\n/g,"<br>")}</p>`;
}

async function sha256(value){
  const bytes=new TextEncoder().encode(value);
  const hash=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,"0")).join("");
}

function choiceKey(choice){return choice.choice_key||choice.key||"";}
function canonicalQuestion(q){
  const choices=(q.choices||[]).slice().sort((a,b)=>choiceKey(a).localeCompare(choiceKey(b)));
  return {content:plainText(q.content||""),correct:q.correct_choice_key||"",choices:choices.map(c=>[choiceKey(c),plainText(c.content||"")])};
}

export function createQuestionBankCopyController(ctx){
  const {sb,bankMedia,sourceSignedUrl,toast,onCopied}=ctx;
  const copiedPathCache=new Map(),testTitleCache=new Map();

  async function sourceFile(path){
    if(!path)throw new Error("Thiếu đường dẫn media nguồn.");
    let url;if(String(path).startsWith("static:"))url=String(path).slice(7);else url=await sourceSignedUrl(path);
    if(!url)throw new Error("Không đọc được media của đề gốc.");
    const res=await fetch(url,{cache:"no-store"});if(!res.ok)throw new Error(`Không tải được media nguồn (HTTP ${res.status}).`);
    const blob=await res.blob(),type=blob.type||"image/jpeg",raw=String(path).split("/").pop()||"media",name=raw.replace(/^static:/,"")||"media";
    return new File([blob],name,{type});
  }

  async function copyPath(path){
    if(!path)return null;if(copiedPathCache.has(path))return copiedPathCache.get(path);
    const uploaded=await bankMedia.uploadFile(await sourceFile(path),"copied");copiedPathCache.set(path,uploaded.storage_path);return uploaded.storage_path;
  }

  async function copyRich(value=""){
    if(!value)return "";
    const doc=new DOMParser().parseFromString(`<div>${textHtml(value)}</div>`,"text/html"),root=doc.body.firstElementChild;
    for(const img of root.querySelectorAll("img[data-storage-path]")){
      const target=await copyPath(img.getAttribute("data-storage-path"));img.setAttribute("data-storage-path",target);img.removeAttribute("src");
    }
    return sanitizeRichHtml(root.innerHTML,{storage:true});
  }

  async function appendDirectImage(content,item){
    let out=await copyRich(content||"");
    if(item?.storage_path&&item?.media_type==="image"){
      const path=await copyPath(item.storage_path);out=`${out}<p><img data-storage-path="${esc(path)}" alt="Ảnh trong nội dung"></p>`;
    }
    return sanitizeRichHtml(out,{storage:true});
  }

  async function copyQuestion(q,index){
    const choices=[];
    for(const c of (q.choices||[]).slice().sort((a,b)=>choiceKey(a).localeCompare(choiceKey(b))))choices.push({choice_key:choiceKey(c),content:await appendDirectImage(c.content,c)});
    return {child_no:index+1,sort_order:index+1,content:await appendDirectImage(q.content,q),correct_choice_key:q.correct_choice_key||null,choices,metadata:{source_number:q.source_number??null}};
  }

  async function groupPassage(group){
    const pieces=[];
    for(const s of (group.stimuli||[]).slice().sort((a,b)=>(a.sort_order||0)-(b.sort_order||0))){
      if(s.content)pieces.push(await copyRich(s.content));
      if(s.storage_path&&s.media_type==="image")pieces.push(`<p><img data-storage-path="${esc(await copyPath(s.storage_path))}" alt="Ảnh trong nội dung"></p>`);
    }
    return sanitizeRichHtml(pieces.join(""),{storage:true});
  }

  async function testTitle(testId){
    if(testTitleCache.has(testId))return testTitleCache.get(testId);
    const {data}=await sb.from("tests").select("title").eq("id",testId).maybeSingle(),title=data?.title||"Bài kiểm tra";testTitleCache.set(testId,title);return title;
  }

  async function duplicateCheck(testId,entityId,hash){
    const exact=await sb.from("bank_items").select("id,public_code,title,status").eq("source_type","test_copy").eq("source_test_id",testId).eq("source_entity_id",entityId).limit(1);
    if(!exact.error&&exact.data?.length){const item=exact.data[0];toast(`Mục này đã có trong ngân hàng${item.public_code?` (${item.public_code})`:""}.`,6000);return false;}
    const same=await sb.from("bank_items").select("id,public_code,title,status").eq("content_hash",hash).limit(1);
    if(!same.error&&same.data?.length){const item=same.data[0];return confirm(`Nội dung này có vẻ trùng với ${item.public_code||item.title||"một mục trong ngân hàng"}. Vẫn thêm bản nháp mới?`);}
    return true;
  }

  async function saveCopy(payload){
    const {data,error}=await sb.rpc("staff_copy_test_item_to_bank",{p_data:payload});
    if(error){if(String(error.message||"").includes("bank_items_test_copy_source_unique"))throw new Error("Mục này đã có trong ngân hàng.");throw error;}
    toast("Đã thêm vào ngân hàng dưới dạng Nháp.");await onCopied?.(data);return data;
  }

  async function copyQuestionToBank(testId,q){
    if(Number(q.part_no)!==5)return toast("Bước này chỉ thêm câu đơn Part 5; Part 6–7 thêm theo nguyên nhóm.",6000);
    const hash=await sha256(JSON.stringify({part:5,question:canonicalQuestion(q)}));if(!await duplicateCheck(testId,q.id,hash))return;
    const title=await testTitle(testId),question=await copyQuestion(q,0);
    return saveCopy({item_type:"Q",part_no:5,status:"draft",difficulty:"unrated",title:`Câu ${q.source_number||""}`.trim(),primary_type:null,tags:[],topics:[],metadata:{source_number:q.source_number??null},source_type:"test_copy",source_name:title,source_test_id:testId,source_entity_id:q.id,content_hash:hash,stimuli:[],questions:[question]});
  }

  async function copyGroupToBank(testId,group,questions=[]){
    const part=Number(group.part_no);if(![6,7].includes(part))return toast("Chỉ Part 6–7 được thêm theo nhóm ở bước này.",6000);
    const children=questions.filter(q=>q.stimulus_group_id===group.id).sort((a,b)=>(a.source_number||0)-(b.source_number||0));
    const hash=await sha256(JSON.stringify({part,passage:(group.stimuli||[]).map(s=>plainText(s.content||"")),questions:children.map(canonicalQuestion)}));if(!await duplicateCheck(testId,group.id,hash))return;
    const title=await testTitle(testId),passage=await groupPassage(group),bankQuestions=[];for(let i=0;i<children.length;i++)bankQuestions.push(await copyQuestion(children[i],i));
    return saveCopy({item_type:"G",part_no:part,status:"draft",difficulty:"unrated",title:group.title||`Nhóm ${group.source_order||""}`.trim(),primary_type:null,tags:[],topics:[],metadata:{source_order:group.source_order??null,source_numbers:children.map(q=>q.source_number)},source_type:"test_copy",source_name:title,source_test_id:testId,source_entity_id:group.id,content_hash:hash,stimuli:[{media_type:"text",content:passage,sort_order:1,metadata:{}}],questions:bankQuestions});
  }

  function currentTestId(){const m=location.hash.match(/^#\/test\/([^/]+)/);return m?.[1]||null;}
  async function loadAuthoring(testId){const {data,error}=await sb.rpc("get_test_authoring_v120",{p_test_id:testId});if(error)throw error;return data||{};}

  function bindGlobal(){
    document.addEventListener("click",async e=>{
      const btn=e.target.closest(".bank-add-question,.bank-add-group");if(!btn)return;
      e.preventDefault();e.stopPropagation();const testId=currentTestId();if(!testId)return toast("Không xác định được bài kiểm tra nguồn.",6000);
      const old=btn.textContent;btn.disabled=true;btn.textContent="Đang thêm…";
      try{
        const data=await loadAuthoring(testId),questions=data.questions||[],groups=data.stimulus_groups||[];
        if(btn.classList.contains("bank-add-question")){
          const q=questions.find(x=>x.id===btn.dataset.id);if(!q)throw new Error("Không tìm thấy câu hỏi nguồn.");await copyQuestionToBank(testId,q);
        }else{
          const group=groups.find(x=>x.id===btn.dataset.id);if(!group)throw new Error("Không tìm thấy nhóm nguồn.");await copyGroupToBank(testId,group,questions);
        }
      }catch(err){toast(`Không thêm được vào ngân hàng: ${err.message}`,8000);}
      finally{btn.disabled=false;btn.textContent=old;}
    });
  }

  return {copyQuestionToBank,copyGroupToBank,bindGlobal};
}

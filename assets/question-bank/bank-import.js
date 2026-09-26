import { bindRichEditors,embeddedImagePaths,hydrateEmbeddedImages,plainText,sanitizeRichHtml } from "../modules/rich-editor.js";
import { parseQuestionBankWord } from "./bank-import-parser.js";
import { wordImportUploadView,wordImportReviewView } from "./bank-import-view.js";

const KEYS=["A","B","C","D"];
const unique=a=>[...new Set(a.filter(Boolean))];

function contentPresent(value=""){return !!plainText(value)||embeddedImagePaths(value).length>0;}
function itemPaths(item){
  const values=[item.stimulus,...(item.questions||[]).flatMap(q=>[q.content,...(q.choices||[]).map(c=>c.content)])];
  return unique(values.flatMap(v=>embeddedImagePaths(v||"")));
}
function validateItem(item){
  const issues=[],qs=item.questions||[];
  if(item.item_type==="G"&&!contentPresent(item.stimulus))issues.push("Thiếu passage/nội dung chung");
  if(item.part_no===6&&qs.length!==4)issues.push(`Part 6 cần đúng 4 câu (hiện có ${qs.length})`);
  if(item.part_no===7&&(qs.length<2||qs.length>5))issues.push(`Part 7 cần 2–5 câu (hiện có ${qs.length})`);
  if(item.item_type==="Q"&&qs.length!==1)issues.push("Câu đơn phải có đúng 1 câu hỏi");
  qs.forEach((q,i)=>{
    const label=q.number||i+1;if(!contentPresent(q.content))issues.push(`Câu ${label}: thiếu nội dung`);
    if(!q.correct_choice_key)issues.push(`Câu ${label}: chưa chọn đáp án đúng`);
    const choices=Object.fromEntries((q.choices||[]).map(c=>[c.choice_key,c]));
    KEYS.forEach(k=>{if(!contentPresent(choices[k]?.content||""))issues.push(`Câu ${label}: thiếu phương án ${k}`);});
  });
  return issues;
}

export function createQuestionBankImportController(ctx){
  const {sb,modalRoot,toast,closeModal,bankMedia,onSaved}=ctx;
  let state=null,operationSeq=0;

  async function cleanupUnsaved(){
    if(!state?.uploadedPaths?.length)return;
    const kept=new Set(state.items.filter(x=>x.saved).flatMap(itemPaths)),remove=state.uploadedPaths.filter(path=>!kept.has(path));
    if(remove.length)try{await bankMedia.removePaths(remove);}catch(err){console.warn("Không dọn được media import chưa dùng",err);}
    state.uploadedPaths=[...kept];
  }
  async function closeImport(){operationSeq++;await cleanupUnsaved();state=null;closeModal();}

  function open(){
    operationSeq++;state={items:[],uploadedPaths:[],messages:[],index:0,fileName:""};modalRoot.innerHTML=wordImportUploadView();
    modalRoot.querySelector("[data-import-close]").onclick=closeImport;
    const form=modalRoot.querySelector("#bankWordUpload"),progress=modalRoot.querySelector("#bankWordProgress");
    form.onsubmit=async e=>{
      e.preventDefault();const file=form.elements.word_file.files?.[0];if(!file)return toast("Vui lòng chọn file Word .docx.");
      const seq=++operationSeq,btn=e.submitter;btn.disabled=true;btn.textContent="Đang đọc Word…";progress.textContent="Đang chuyển Word sang rich text…";
      try{
        const result=await parseQuestionBankWord(file,{bankMedia,onProgress:text=>{if(seq===operationSeq&&progress.isConnected)progress.textContent=text;}});
        if(seq!==operationSeq){if(result.uploadedPaths?.length)try{await bankMedia.removePaths(result.uploadedPaths);}catch{}return;}
        state={items:result.items.map(x=>({...x,include:true,difficulty:"unrated",primary_type:"",saved:false})),uploadedPaths:result.uploadedPaths,messages:result.messages,index:0,fileName:file.name};
        await renderReview();
      }catch(err){if(seq!==operationSeq)return;if(progress.isConnected)progress.textContent="Không đọc được file Word.";toast(err.message||String(err),7500);if(btn.isConnected){btn.disabled=false;btn.textContent="Đọc Word và kiểm tra";}}
    };
  }

  async function hydrateItemForView(item){
    const paths=itemPaths(item);if(!paths.length)return;
    const urls=await bankMedia.signedUrlMap(paths);
    item.stimulus=hydrateEmbeddedImages(item.stimulus||"",urls);
    for(const q of item.questions||[]){q.content=hydrateEmbeddedImages(q.content||"",urls);for(const c of q.choices||[])c.content=hydrateEmbeddedImages(c.content||"",urls);}
  }

  function formValue(form,name){return String(form.elements.namedItem(name)?.value||"");}
  function persistCurrent(){
    const form=modalRoot.querySelector("#bankImportReviewForm");if(!form||!state)return;
    const item=state.items[state.index];if(!item||item.saved)return;
    item.include=!!form.elements.include?.checked;item.title=formValue(form,"title").trim();item.difficulty=formValue(form,"difficulty")||"unrated";item.primary_type=formValue(form,"primary_type").trim();
    if(item.item_type==="G")item.stimulus=sanitizeRichHtml(formValue(form,"stimulus"),{storage:true});
    const blocks=[...form.querySelectorAll("[data-import-question]")];
    item.questions=blocks.map((block,i)=>{
      const old=item.questions[i]||{},choices=KEYS.map(k=>({choice_key:k,content:sanitizeRichHtml(formValue(form,`q_${i}_${k}`),{storage:true})}));
      return {...old,content:sanitizeRichHtml(formValue(form,`q_${i}_content`),{storage:true}),correct_choice_key:block.querySelector(".import-correct")?.value||null,choices};
    });
    item.issues=validateItem(item);
  }

  async function trackUpload(file){
    const up=await bankMedia.uploadImage(file);if(state)state.uploadedPaths.push(up.storage_path);return up;
  }

  async function renderReview(index=state.index){
    if(!state)return;state.index=Math.min(state.items.length-1,Math.max(0,index));const item=state.items[state.index];await hydrateItemForView(item);if(!state)return;
    modalRoot.innerHTML=wordImportReviewView({...state,index:state.index});
    modalRoot.querySelector("[data-import-close]").onclick=async()=>{persistCurrent();await closeImport();};
    const form=modalRoot.querySelector("#bankImportReviewForm");
    bindRichEditors(form,{uploadImage:trackUpload,onError:err=>toast(err.message||String(err),6500)});
    const move=async next=>{persistCurrent();await renderReview(next);};
    modalRoot.querySelector("#bankImportPrev").onclick=()=>move(state.index-1);modalRoot.querySelector("#bankImportNext").onclick=()=>move(state.index+1);
    modalRoot.querySelectorAll("[data-import-index]").forEach(btn=>btn.onclick=()=>move(Number(btn.dataset.importIndex)));
    modalRoot.querySelector("#bankImportSaveDraft").onclick=()=>saveSelected("draft");modalRoot.querySelector("#bankImportApprove").onclick=()=>saveSelected("approved");
  }

  function payloadFor(item,status){
    return {
      item_type:item.item_type,part_no:item.part_no,status,difficulty:item.difficulty||"unrated",title:item.title||null,primary_type:item.primary_type||null,tags:[],topics:[],
      metadata:{...(item.metadata||{}),import_file:state.fileName},source_type:"word_import",source_name:state.fileName,
      stimuli:item.item_type==="G"?[{media_type:"text",content:sanitizeRichHtml(item.stimulus||"",{storage:true}),sort_order:1,metadata:{}}]:[],
      questions:(item.questions||[]).map((q,i)=>({child_no:i+1,sort_order:i+1,content:sanitizeRichHtml(q.content||"",{storage:true}),correct_choice_key:q.correct_choice_key||null,metadata:{source_number:q.number??null},choices:KEYS.map(k=>{const c=(q.choices||[]).find(x=>x.choice_key===k);return {choice_key:k,content:sanitizeRichHtml(c?.content||"",{storage:true})};})}))
    };
  }

  async function saveSelected(status){
    persistCurrent();const selected=state.items.filter(x=>x.include!==false&&!x.saved);if(!selected.length)return toast("Không có mục nào được chọn để lưu.");
    if(status==="approved"){
      const bad=selected.find(x=>validateItem(x).length);if(bad){bad.issues=validateItem(bad);state.index=state.items.indexOf(bad);await renderReview();return toast("Còn mục chưa đủ dữ liệu để duyệt. Mình đã mở đúng mục cần kiểm tra.",7000);}
    }
    const progress=modalRoot.querySelector("#bankImportSaveProgress"),buttons=[modalRoot.querySelector("#bankImportSaveDraft"),modalRoot.querySelector("#bankImportApprove")];buttons.forEach(b=>b.disabled=true);
    let done=0,failed=[];
    for(const item of selected){
      progress.textContent=`Đang lưu ${done+1}/${selected.length}…`;
      const {data,error}=await sb.rpc("staff_save_bank_item",{p_data:payloadFor(item,status)});
      if(error){failed.push(`${item.title||"Mục"}: ${error.message}`);continue;}
      item.saved=true;item.savedId=data?.id||null;item.public_code=data?.public_code||null;item.include=false;done++;
    }
    if(failed.length){buttons.forEach(b=>b.disabled=false);progress.textContent=`Đã lưu ${done}/${selected.length}; ${failed.length} mục lỗi.`;toast(failed[0],8000);await renderReview(state.items.findIndex(x=>!x.saved&&x.include!==false)>=0?state.items.findIndex(x=>!x.saved&&x.include!==false):state.index);return;}
    progress.textContent=`Đã lưu ${done} mục.`;await cleanupUnsaved();const label=status==="approved"?"Đã duyệt và lưu":"Đã lưu bản nháp";toast(`${label} ${done} mục từ Word.`);operationSeq++;state=null;closeModal();await onSaved?.();
  }

  return {open};
}

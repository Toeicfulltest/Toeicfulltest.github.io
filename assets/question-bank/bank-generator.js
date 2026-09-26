import { autoFill,candidateBatch,defaultTargets,itemQuestionCount,loadApprovedBankIndex,manualMatches,nextIncompletePart,selectionProblems,standardCount } from "./bank-generator-data.js";
import { cleanupGeneratedTestMedia,copySelectedBankMedia } from "./bank-generator-media.js";
import { packageListeningAudio } from "./bank-listening-package.js";
import { generatorShell } from "./bank-generator-view.js";

const DEFAULT_PREFS={balanceDifficulty:true,avoidRecent:true,diversifyTopics:true,avoidSameType:true,preferLowUse:true};

export function createQuestionBankGeneratorController(ctx){
  const {sb,modalRoot,toast,closeModal,bankMedia,uploadMedia,removeMedia,onCommitted}=ctx;
  let state=null,detailCache=new Map();

  function selectedPartCount(part){return state.selected.filter(x=>Number(x.item.part_no)===Number(part)).reduce((n,x)=>n+itemQuestionCount(x.item),0);}
  function remaining(part){return Math.max(0,(Number(state.targets[part])||0)-selectedPartCount(part));}
  function maxTarget(part){return Math.max(0,standardCount(part)-(Number(state.existing[part])||0));}
  function hasListeningSelection(){return state.selected.some(x=>Number(x.item.part_no)>=1&&Number(x.item.part_no)<=4);}
  function listeningCommitProblem(){
    if(!hasListeningSelection())return null;
    if(!["listening","full"].includes(state.test.test_kind))return "Chỉ bài Listening/Full Test mới được tạo audio từ ngân hàng.";
    for(const part of [1,2,3,4]){
      if((Number(state.existing[part])||0)>0)return "Để ghép audio an toàn, Part 1–4 phải đang trống trước khi tạo Listening từ ngân hàng.";
      const have=selectedPartCount(part),need=standardCount(part);if(have!==need)return `Listening phải được tạo trọn bộ một lần: Part ${part} đang chọn ${have}/${need} câu.`;
    }
    return null;
  }
  function baseWarnings(){
    const out=[];for(const p of state.parts){const part=Number(p.part_no??p),capacity=state.index.filter(x=>Number(x.part_no)===part).reduce((n,x)=>n+itemQuestionCount(x),0),need=Number(state.targets[part])||0;if(capacity<need)out.push(`Part ${part}: ngân hàng khả dụng chỉ có ${capacity}/${need} câu cần thêm.`);}
    if(state.test?.listening_audio_storage_path&&[1,2,3,4].some(p=>(Number(state.targets[p])||0)>0))out.push("Bài đang có audio Listening; nếu tạo trọn Part 1–4 từ bank, audio này sẽ được thay bằng audio ghép mới.");
    return out;
  }
  function syncWarnings(extra=[]){state.warnings=[...new Set([...baseWarnings(),...extra])];}
  function sortFinalSelection(){return state.selected.map((row,i)=>({...row,_i:i})).sort((a,b)=>Number(a.item.part_no)-Number(b.item.part_no)||a._i-b._i).map(({_i,...row})=>row);}

  function refreshCandidates(){
    if(!state)return;const part=Number(state.currentPart),left=remaining(part);
    state.candidates=left?candidateBatch(state.index,{part,remaining:left,selected:state.selected,excluded:state.excluded,prefs:state.prefs,targets:state.targets,limit:8}):[];
    let rows=manualMatches(state.index,{part,search:state.manualSearch,selected:state.selected,excluded:state.excluded,limit:100});
    if(state.replacingId){const old=state.selected.find(x=>x.item.id===state.replacingId);if(old)rows=rows.filter(x=>itemQuestionCount(x)===itemQuestionCount(old.item));}
    state.manualRows=rows;
  }

  function trimPart(part){
    const target=Number(state.targets[part])||0;let count=selectedPartCount(part);
    if(count<=target)return;
    for(let i=state.selected.length-1;i>=0&&count>target;i--){const row=state.selected[i];if(Number(row.item.part_no)!==Number(part)||row.locked)continue;state.selected.splice(i,1);count-=itemQuestionCount(row.item);}
  }

  async function loadDetails(ids){
    const missing=[...new Set(ids.filter(id=>!detailCache.has(id)))];
    if(missing.length){
      const [stimRes,qRes]=await Promise.all([
        sb.from("bank_stimuli").select("*").in("bank_item_id",missing).order("sort_order"),
        sb.from("bank_questions").select("*").in("bank_item_id",missing).order("sort_order")
      ]);
      if(stimRes.error)throw stimRes.error;if(qRes.error)throw qRes.error;
      const questions=qRes.data||[],qIds=questions.map(q=>q.id);let choices=[];
      if(qIds.length){const cRes=await sb.from("bank_question_choices").select("*").in("question_id",qIds).order("choice_key");if(cRes.error)throw cRes.error;choices=cRes.data||[];}
      for(const q of questions)q.choices=choices.filter(c=>c.question_id===q.id);
      for(const id of missing){const item=state.index.find(x=>x.id===id);detailCache.set(id,{item,stimuli:(stimRes.data||[]).filter(x=>x.bank_item_id===id),questions:questions.filter(x=>x.bank_item_id===id)});}
    }
    return ids.map(id=>detailCache.get(id)).filter(Boolean);
  }

  async function showPreview(id){try{state.previewDetail=(await loadDetails([id]))[0]||null;render();}catch(err){toast(`Không xem được item: ${err.message}`,6500);}}
  function drawUnlocked(){const result=autoFill(state.index,state.parts,state.targets,state.prefs,state.selected,state.excluded);state.selected=result.selected;syncWarnings(result.warnings);state.currentPart=nextIncompletePart(state.parts,state.targets,state.selected);refreshCandidates();}
  function fillRest(){const oldLocks=new Map(state.selected.map(x=>[x.item.id,x.locked])),keep=state.selected.map(x=>({...x,locked:true})),result=autoFill(state.index,state.parts,state.targets,state.prefs,keep,state.excluded);state.selected=result.selected.map(x=>({...x,locked:oldLocks.get(x.item.id)??false}));syncWarnings(result.warnings);state.currentPart=nextIncompletePart(state.parts,state.targets,state.selected);refreshCandidates();}

  function pick(id){
    const item=state.index.find(x=>x.id===id);if(!item)return;
    if(state.replacingId){const pos=state.selected.findIndex(x=>x.item.id===state.replacingId);if(pos<0)return;const old=state.selected[pos];if(old.locked)return toast("Hãy mở khóa item trước khi thay.");if(itemQuestionCount(item)!==itemQuestionCount(old.item))return toast("Item thay thế phải có cùng số câu để giữ ma trận.");state.excluded.add(old.item.id);state.selected[pos]={item,locked:false};state.replacingId=null;}
    else{const left=remaining(item.part_no);if(itemQuestionCount(item)>left)return toast(`Part ${item.part_no} chỉ còn thiếu ${left} câu.`);state.selected.push({item,locked:false});}
    syncWarnings();state.currentPart=nextIncompletePart(state.parts,state.targets,state.selected);refreshCandidates();render();
  }

  function replaceOne(id){
    const pos=state.selected.findIndex(x=>x.item.id===id);if(pos<0||state.selected[pos].locked)return;
    const old=state.selected[pos],pool=candidateBatch(state.index,{part:old.item.part_no,remaining:itemQuestionCount(old.item),selected:state.selected.filter((_,i)=>i!==pos),excluded:state.excluded,prefs:state.prefs,targets:state.targets,limit:5,exact:itemQuestionCount(old.item)});
    if(!pool.length)return toast("Không còn item cùng cấu trúc để đổi.");state.excluded.add(old.item.id);state.selected[pos]={item:pool[0],locked:false};syncWarnings();refreshCandidates();render();
  }

  function bind(){
    modalRoot.querySelectorAll("[data-gen-close]").forEach(b=>b.onclick=()=>{state=null;detailCache.clear();closeModal();});
    modalRoot.querySelectorAll("[data-gen-mode]").forEach(b=>b.onclick=()=>{state.mode=b.dataset.genMode;state.replacingId=null;refreshCandidates();render();});
    modalRoot.querySelectorAll(".gen-target-input").forEach(inp=>inp.onchange=()=>{const part=Number(inp.dataset.part),value=Math.min(maxTarget(part),Math.max(0,Number(inp.value)||0));state.targets[part]=value;trimPart(part);syncWarnings();state.currentPart=nextIncompletePart(state.parts,state.targets,state.selected);refreshCandidates();render();});
    modalRoot.querySelectorAll("[data-gen-pref]").forEach(inp=>inp.onchange=()=>{state.prefs[inp.dataset.genPref]=inp.checked;refreshCandidates();});
    modalRoot.querySelector("#genAutoDraw")?.addEventListener("click",()=>{drawUnlocked();render();});
    modalRoot.querySelector("#genRerollUnlocked")?.addEventListener("click",()=>{drawUnlocked();render();});
    modalRoot.querySelector("#genAutoRest")?.addEventListener("click",()=>{fillRest();render();});
    modalRoot.querySelector("#genRefreshCandidates")?.addEventListener("click",()=>{refreshCandidates();render();});
    modalRoot.querySelector("#genGuidedPart")?.addEventListener("change",e=>{state.currentPart=Number(e.target.value);refreshCandidates();render();});
    modalRoot.querySelector("#genManualPart")?.addEventListener("change",e=>{state.currentPart=Number(e.target.value);refreshCandidates();render();});
    modalRoot.querySelector("#genManualSearch")?.addEventListener("change",e=>{state.manualSearch=e.target.value;refreshCandidates();render();});
    modalRoot.querySelector("#genCancelReplace")?.addEventListener("click",()=>{state.replacingId=null;refreshCandidates();render();});
    modalRoot.querySelector("#genClosePreview")?.addEventListener("click",()=>{state.previewDetail=null;render();});
    modalRoot.querySelectorAll("[data-gen-preview]").forEach(b=>b.onclick=()=>showPreview(b.dataset.genPreview));
    modalRoot.querySelectorAll("[data-gen-pick]").forEach(b=>b.onclick=()=>pick(b.dataset.genPick));
    modalRoot.querySelectorAll("[data-gen-toggle-lock]").forEach(b=>b.onclick=()=>{const row=state.selected.find(x=>x.item.id===b.dataset.genToggleLock);if(row)row.locked=!row.locked;render();});
    modalRoot.querySelectorAll("[data-gen-lock-part]").forEach(b=>b.onclick=()=>{const part=Number(b.dataset.genLockPart),rows=state.selected.filter(x=>Number(x.item.part_no)===part),lock=rows.some(x=>!x.locked);rows.forEach(x=>x.locked=lock);render();});
    modalRoot.querySelectorAll("[data-gen-replace]").forEach(b=>b.onclick=()=>replaceOne(b.dataset.genReplace));
    modalRoot.querySelectorAll("[data-gen-manual-replace]").forEach(b=>b.onclick=()=>{const row=state.selected.find(x=>x.item.id===b.dataset.genManualReplace);if(!row||row.locked)return;state.mode="manual";state.currentPart=Number(row.item.part_no);state.replacingId=row.item.id;refreshCandidates();render();});
    modalRoot.querySelectorAll("[data-gen-remove]").forEach(b=>b.onclick=()=>{const pos=state.selected.findIndex(x=>x.item.id===b.dataset.genRemove);if(pos<0||state.selected[pos].locked)return;state.excluded.add(state.selected[pos].item.id);state.selected.splice(pos,1);syncWarnings();refreshCandidates();render();});
    modalRoot.querySelector("#genCommit")?.addEventListener("click",commit);
  }

  function render(){if(!state)return;modalRoot.innerHTML=generatorShell(state);bind();}

  async function commit(){
    const problems=selectionProblems(state.parts,state.targets,state.selected);if(problems.length)return toast(`Chưa đủ ma trận: ${problems[0]}`,7000);
    if(!state.selected.length)return toast("Chưa chọn item nào để đưa vào đề.");
    const listeningProblem=listeningCommitProblem();if(listeningProblem)return toast(listeningProblem,8000);
    const btn=modalRoot.querySelector("#genCommit"),progress=modalRoot.querySelector("#genCommitProgress");btn.disabled=true;btn.textContent="Đang đưa vào đề…";
    let copied=[],committed=false,result=null,listeningUpload=null,audioSet=false;
    const previousAudio={path:state.test.listening_audio_storage_path||null,filename:state.test.listening_audio_filename||null,duration:state.test.listening_audio_duration_seconds||null};
    try{
      const ordered=sortFinalSelection(),details=await loadDetails(ordered.map(x=>x.item.id));
      if(hasListeningSelection()){
        listeningUpload=await packageListeningAudio({details,bankMedia,uploadMedia,testId:state.test.id,onProgress:p=>{if(!progress)return;if(p.stage==="download")progress.textContent=`Đang ghép clip Listening ${p.done}/${p.total}${p.code?` · ${p.code}`:""}`;else progress.textContent=`Đang tải audio Listening chung${p.percent!=null?` · ${p.percent}%`:""}`;}});
        const audioRes=await sb.rpc("staff_set_listening_audio_v118b",{p_test_id:state.test.id,p_storage_path:listeningUpload.storage_path,p_filename:listeningUpload.filename,p_duration_seconds:listeningUpload.duration_seconds});if(audioRes.error)throw audioRes.error;audioSet=true;
      }
      const media=await copySelectedBankMedia({details,bankMedia,uploadMedia,removeMedia,testId:state.test.id,onProgress:p=>{if(progress)progress.textContent=p.total?`Đang chuẩn bị media ${p.done}/${p.total}${p.percent!=null?` · ${p.percent}%`:""}`:"Đang chuẩn bị dữ liệu…";}});copied=media.created;
      if(progress)progress.textContent="Đang ghi câu hỏi vào đề…";
      const {data,error}=await sb.rpc("staff_materialize_bank_selection",{p_data:{test_id:state.test.id,item_ids:ordered.map(x=>x.item.id),media_map:media.mediaMap}});if(error)throw error;committed=true;result=data;
      if(listeningUpload&&previousAudio.path&&previousAudio.path!==listeningUpload.storage_path)removeMedia(previousAudio.path).catch(()=>{});
    }catch(err){
      if(!committed)await cleanupGeneratedTestMedia(copied,removeMedia);
      if(audioSet){try{await sb.rpc("staff_set_listening_audio_v118b",{p_test_id:state.test.id,p_storage_path:previousAudio.path,p_filename:previousAudio.filename,p_duration_seconds:previousAudio.duration});}catch{}}
      if(listeningUpload?.storage_path)try{await removeMedia(listeningUpload.storage_path);}catch{}
      btn.disabled=false;btn.textContent="Đưa vào đề";if(progress)progress.textContent="Không ghi được vào đề; dữ liệu tạm đã được thu hồi.";return toast(`Tạo đề thất bại: ${err.message||err}`,8500);
    }
    state=null;detailCache.clear();closeModal();toast(`Đã đưa ${result?.questions_created||0} câu từ ngân hàng vào đề${listeningUpload?" và tạo audio Listening chung":""}.`);
    try{await onCommitted?.(result);}catch(err){console.error(err);toast("Đã tạo đề thành công; hãy mở lại tab Soạn đề để tải nội dung mới.",7000);}
  }

  async function open({testId,parts=[],questions=[]}){
    modalRoot.innerHTML='<div class="modal-backdrop"><div class="modal wide"><div class="empty">Đang tải ngân hàng câu hỏi…</div></div></div>';
    try{
      const {data:test,error}=await sb.from("tests").select("id,title,test_kind,content_locked_at,listening_audio_storage_path,listening_audio_filename,listening_audio_duration_seconds").eq("id",testId).single();if(error)throw error;if(test.content_locked_at)throw new Error("Đề đã khóa nội dung nên không thể thêm câu từ ngân hàng.");
      const normalizedParts=(parts||[]).slice().sort((a,b)=>Number(a.part_no)-Number(b.part_no));if(!normalizedParts.length)throw new Error("Bài kiểm tra chưa có Part.");
      const {targets,existing}=defaultTargets(normalizedParts,questions),index=await loadApprovedBankIndex(sb,normalizedParts.map(x=>x.part_no),testId);
      state={test,parts:normalizedParts,index,targets,existing,selected:[],excluded:new Set(),prefs:{...DEFAULT_PREFS},mode:"auto",warnings:[],currentPart:Number(normalizedParts[0].part_no),candidates:[],manualRows:[],manualSearch:"",replacingId:null,previewDetail:null};detailCache=new Map();syncWarnings();state.currentPart=nextIncompletePart(state.parts,state.targets,state.selected);refreshCandidates();render();
    }catch(err){state=null;detailCache.clear();closeModal();toast(`Không mở được tạo đề từ ngân hàng: ${err.message||err}`,7500);}
  }

  return {open};
}

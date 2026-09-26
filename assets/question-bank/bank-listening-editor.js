import { bindRichEditors,embeddedImagePaths,hydrateEmbeddedImages,plainText } from "../modules/rich-editor.js";
import { listeningCreateChooser,listeningEditorShell } from "./bank-listening-editor-view.js";

const keysForPart=part=>Number(part)===2?["A","B","C"]:["A","B","C","D"];
const emptyQuestion=part=>({content:"",correct_choice_key:"",choices:keysForPart(part).map(choice_key=>({choice_key,content:""}))});
const csv=value=>String(value||"").split(",").map(x=>x.trim()).filter(Boolean);

export function createQuestionBankListeningEditor(ctx){
  const {sb,modalRoot,toast,closeModal,bankMedia,onSaved}=ctx;
  let staged=new Set(),original=new Set();

  function defaultQuestions(part){return Array.from({length:[3,4].includes(Number(part))?3:1},()=>emptyQuestion(part));}
  function richValue(root){return root?.querySelector("[data-rich-field] textarea")?.value||"";}

  function directPaths(stimuli=[],questions=[]){
    return [...stimuli.map(x=>x.storage_path),...questions.flatMap(q=>[q.storage_path,...(q.choices||[]).map(c=>c.storage_path)])].filter(Boolean);
  }
  function richPaths(stimuli=[],questions=[]){
    const values=[...stimuli.map(x=>x.content),...questions.flatMap(q=>[q.content,...(q.choices||[]).map(c=>c.content)])];
    return values.flatMap(v=>embeddedImagePaths(v||""));
  }
  function payloadPaths(payload){
    const direct=[...(payload.stimuli||[]).map(x=>x.storage_path),...(payload.questions||[]).flatMap(q=>[q.storage_path,...(q.choices||[]).map(c=>c.storage_path)])];
    const rich=[...(payload.stimuli||[]).map(x=>x.content),...(payload.questions||[]).flatMap(q=>[q.content,...(q.choices||[]).map(c=>c.content)])].flatMap(v=>embeddedImagePaths(v||""));
    return new Set([...direct,...rich].filter(Boolean));
  }

  async function cleanup(paths){const rows=[...new Set([...paths].filter(Boolean))];if(rows.length)try{await bankMedia.removePaths(rows);}catch(err){console.warn("bank listening cleanup",err);}}
  async function closeSafe(){await cleanup(staged);staged=new Set();original=new Set();closeModal();}

  async function hydrate(stimuli,questions){
    const paths=[...new Set(richPaths(stimuli,questions))];if(!paths.length)return;
    const urls=await bankMedia.signedUrlMap(paths);
    for(const s of stimuli)s.content=hydrateEmbeddedImages(s.content,urls);
    for(const q of questions){q.content=hydrateEmbeddedImages(q.content,urls);for(const c of q.choices||[])c.content=hydrateEmbeddedImages(c.content,urls);}
  }

  async function loadItem(id){
    const [{data:item,error:itemError},{data:stimuli,error:stimError},{data:questions,error:qError}]=await Promise.all([
      sb.from("bank_items").select("*").eq("id",id).single(),
      sb.from("bank_stimuli").select("*").eq("bank_item_id",id).order("sort_order"),
      sb.from("bank_questions").select("*").eq("bank_item_id",id).order("sort_order")
    ]);
    if(itemError)throw itemError;if(stimError)throw stimError;if(qError)throw qError;
    const ids=(questions||[]).map(q=>q.id);let choices=[];
    if(ids.length){const res=await sb.from("bank_question_choices").select("*").in("question_id",ids).order("choice_key");if(res.error)throw res.error;choices=res.data||[];}
    for(const q of questions||[])q.choices=choices.filter(c=>c.question_id===q.id);
    await hydrate(stimuli||[],questions||[]);
    return {item,stimuli:stimuli||[],questions:questions||[]};
  }

  function pathsFor(part,stimuli,questions){
    const audio=stimuli.find(x=>x.media_type==="audio")?.storage_path||"";
    const graphic=stimuli.find(x=>x.media_type==="image")?.storage_path||"";
    const image=Number(part)===1?(questions[0]?.storage_path||""):"";
    return {audio,graphic,image};
  }

  async function showPreview(form,key,path,kind){
    const host=form.querySelector(`[data-listening-preview="${key}"]`),clear=form.querySelector(`[data-listening-clear="${key}"]`);if(!host)return;
    if(!path){host.innerHTML='<span class="muted small">Chưa có file</span>';if(clear)clear.hidden=true;return;}
    const url=await bankMedia.signedUrl(path);
    if(kind==="audio")host.innerHTML=url?`<audio controls preload="metadata" src="${url}"></audio>`:'<span class="danger-text">Không mở được clip.</span>';
    else host.innerHTML=url?`<img class="draft-preview-img" src="${url}" alt="Media ngân hàng">`:'<span class="danger-text">Không mở được ảnh.</span>';
    if(clear)clear.hidden=false;
  }

  function bindMedia(form,part){
    const specs={listening_audio:"audio",part1_image:"image",listening_graphic:"image"};
    for(const input of form.querySelectorAll("[data-listening-file]"))input.onchange=async()=>{
      const key=input.dataset.listeningFile,file=input.files?.[0];if(!file)return;
      const kind=specs[key];
      if(kind==="audio"&&!(file.type==="audio/mpeg"||/\.mp3$/i.test(file.name||""))){input.value="";return toast("Clip Listening phải là MP3 để ghép audio chung.",6500);}
      if(kind==="image"&&!file.type.startsWith("image/")){input.value="";return toast("Vui lòng chọn file ảnh.",6000);}
      input.disabled=true;
      try{
        const uploaded=await bankMedia.uploadFile(file,`listening/part${part}`);staged.add(uploaded.storage_path);
        form.elements.namedItem(`${key}_path`).value=uploaded.storage_path;
        await showPreview(form,key,uploaded.storage_path,kind);
      }catch(err){toast(err.message||String(err),7000);}finally{input.disabled=false;input.value="";}
    };
    for(const btn of form.querySelectorAll("[data-listening-clear]"))btn.onclick=async()=>{
      const key=btn.dataset.listeningClear,path=form.elements.namedItem(`${key}_path`)?.value||"";
      form.elements.namedItem(`${key}_path`).value="";await showPreview(form,key,"",specs[key]);
      if(path&&staged.has(path)){staged.delete(path);await cleanup([path]);}
    };
    const initial={listening_audio:[form.elements.namedItem("listening_audio_path")?.value,"audio"],part1_image:[form.elements.namedItem("part1_image_path")?.value,"image"],listening_graphic:[form.elements.namedItem("listening_graphic_path")?.value,"image"]};
    Object.entries(initial).forEach(([key,[path,kind]])=>{if(path)showPreview(form,key,path,kind);});
  }

  function collectPayload(form,item,part){
    const keys=keysForPart(part),blocks=[...form.querySelectorAll("[data-bank-listening-question]")];
    const questions=blocks.map((block,i)=>{
      const choices=part<=2?keys.map(choice_key=>({choice_key,content:""})):[...block.querySelectorAll("[data-bank-listening-choice]")].map(choice=>({choice_key:choice.dataset.choiceKey,content:richValue(choice)}));
      return {child_no:i+1,sort_order:i+1,content:part<=2?"":richValue(block.querySelector(".bank-listening-question-content")),correct_choice_key:block.querySelector(".bank-listening-correct")?.value||null,media_type:part===1?"image":null,storage_path:part===1?(form.elements.namedItem("part1_image_path")?.value||null):null,choices};
    });
    const stimuli=[];const audio=form.elements.namedItem("listening_audio_path")?.value||"";
    if(audio)stimuli.push({media_type:"audio",storage_path:audio,sort_order:1,metadata:{purpose:"listening_clip",format:"mp3"}});
    if([3,4].includes(part)){const graphic=form.elements.namedItem("listening_graphic_path")?.value||"";if(graphic)stimuli.push({media_type:"image",storage_path:graphic,sort_order:2,metadata:{purpose:"graphic"}});}
    return {id:item.id||undefined,item_type:[3,4].includes(part)?"G":"Q",part_no:part,status:form.elements.status.value,difficulty:form.elements.difficulty.value,title:form.elements.title.value.trim()||null,primary_type:form.elements.primary_type.value.trim()||null,tags:csv(form.elements.tags.value),topics:csv(form.elements.topics.value),metadata:{...(item.metadata||{}),listening_clip_format:"mp3_concat_v1"},source_type:item.source_type||"manual",source_name:form.elements.source_name.value.trim()||null,stimuli,questions};
  }

  function validatePayload(data){
    if(data.status!=="approved")return null;
    const part=Number(data.part_no),expected=[3,4].includes(part)?3:1;
    if(data.questions.length!==expected)return `Part ${part} phải có đúng ${expected} ${expected===1?"câu":"câu trong nhóm"}.`;
    const audio=data.stimuli.find(x=>x.media_type==="audio")?.storage_path;if(!audio||!/\.mp3$/i.test(audio))return "Cần tải đúng một clip MP3 trước khi duyệt.";
    if(part===1&&!data.questions[0]?.storage_path)return "Part 1 cần ảnh trước khi duyệt.";
    for(let i=0;i<data.questions.length;i++){
      const q=data.questions[i];if(!q.correct_choice_key)return `Câu ${i+1} chưa chọn đáp án đúng.`;
      if(part>=3&&!plainText(q.content||""))return `Câu ${i+1} chưa có nội dung.`;
      if(part>=3)for(const c of q.choices)if(!plainText(c.content||""))return `Câu ${i+1}, phương án ${c.choice_key} đang trống.`;
    }
    return null;
  }

  function bindEditor(item,stimuli,questions){
    const form=modalRoot.querySelector("#bankListeningForm"),part=Number(item.part_no);if(!form)return;
    staged=new Set();original=new Set([...directPaths(stimuli,questions),...richPaths(stimuli,questions)]);
    modalRoot.querySelectorAll("[data-listening-close]").forEach(b=>b.onclick=()=>closeSafe());
    bindMedia(form,part);
    if(part>=3)bindRichEditors(form,{uploadImage:async file=>{const up=await bankMedia.uploadImage(file);staged.add(up.storage_path);return up;},onError:err=>toast(err.message||String(err),6000)});
    form.onsubmit=async e=>{
      e.preventDefault();const payload=collectPayload(form,item,part),problem=validatePayload(payload);if(problem)return toast(problem,7000);
      const btn=modalRoot.querySelector("#bankListeningSave");btn.disabled=true;btn.textContent="Đang lưu…";
      const {data,error}=await sb.rpc("staff_save_bank_item",{p_data:payload});
      if(error){btn.disabled=false;btn.textContent="Lưu";return toast(error.message,7500);}
      const used=payloadPaths(payload),removeOld=[...original].filter(path=>!used.has(path)),removeNew=[...staged].filter(path=>!used.has(path));
      await cleanup([...removeOld,...removeNew]);staged=new Set();original=new Set();closeModal();toast(data?.public_code?`Đã lưu ${data.public_code}`:"Đã lưu bản nháp");await onSaved?.(data);
    };
  }

  function showEditor(item,stimuli=[],questions=[]){
    const part=Number(item.part_no),qs=questions.length?questions:defaultQuestions(part),paths=pathsFor(part,stimuli,qs);
    modalRoot.innerHTML=listeningEditorShell(item,qs,paths);bindEditor(item,stimuli,qs);
  }

  function chooseCreate(){
    modalRoot.innerHTML=listeningCreateChooser();modalRoot.querySelectorAll("[data-listening-close]").forEach(b=>b.onclick=closeModal);
    modalRoot.querySelectorAll(".bank-listening-create").forEach(btn=>btn.onclick=()=>{const part=Number(btn.dataset.part);showEditor({part_no:part,status:"draft",difficulty:"unrated",source_type:"manual",tags:[],topics:[],metadata:{}},[],defaultQuestions(part));});
  }

  async function openEdit(id){
    try{modalRoot.innerHTML='<div class="modal-backdrop"><div class="modal"><div class="empty">Đang tải Listening bank...</div></div></div>';const data=await loadItem(id);showEditor(data.item,data.stimuli,data.questions);}catch(err){closeModal();toast(`Không mở được Listening bank: ${err.message}`,7500);}
  }

  return {chooseCreate,openEdit};
}

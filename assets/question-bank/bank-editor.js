import { bindRichEditors,embeddedImagePaths,hydrateEmbeddedImages,plainText } from "../modules/rich-editor.js";
import { createChooser,editorShell,questionBlock } from "./bank-editor-view.js";

const KEYS=["A","B","C","D"];
const emptyQuestion=()=>({content:"",correct_choice_key:"",choices:KEYS.map(k=>({choice_key:k,content:""}))});
const csv=value=>String(value||"").split(",").map(x=>x.trim()).filter(Boolean);

export function createQuestionBankEditorController(ctx){
  const {sb,modalRoot,toast,closeModal,bankMedia,onSaved}=ctx;
  let currentItem=null;

  function defaultQuestions(part){return Array.from({length:part===6?4:part===7?2:1},emptyQuestion);}

  async function hydrate(item,stimuli,questions){
    const values=[...(stimuli||[]).map(s=>s.content),...(questions||[]).flatMap(q=>[q.content,...(q.choices||[]).map(c=>c.content)])];
    const paths=[...new Set(values.flatMap(embeddedImagePaths))];
    if(!paths.length)return;
    const urls=await bankMedia.signedUrlMap(paths);
    for(const s of stimuli||[])s.content=hydrateEmbeddedImages(s.content,urls);
    for(const q of questions||[]){
      q.content=hydrateEmbeddedImages(q.content,urls);
      for(const c of q.choices||[])c.content=hydrateEmbeddedImages(c.content,urls);
    }
  }

  async function loadItem(id){
    const [{data:item,error:itemError},{data:stimuli,error:stimError},{data:questions,error:qError}]=await Promise.all([
      sb.from("bank_items").select("*").eq("id",id).single(),
      sb.from("bank_stimuli").select("*").eq("bank_item_id",id).order("sort_order"),
      sb.from("bank_questions").select("*").eq("bank_item_id",id).order("sort_order")
    ]);
    if(itemError)throw itemError;if(stimError)throw stimError;if(qError)throw qError;
    const ids=(questions||[]).map(q=>q.id);
    let choices=[];
    if(ids.length){const res=await sb.from("bank_question_choices").select("*").in("question_id",ids).order("choice_key");if(res.error)throw res.error;choices=res.data||[];}
    for(const q of questions||[])q.choices=choices.filter(c=>c.question_id===q.id);
    await hydrate(item,stimuli||[],questions||[]);
    return {item,stimuli:stimuli||[],questions:questions||[]};
  }

  function bindEditor(item,questions,stimulus=null){
    const form=modalRoot.querySelector("#bankEditorForm"),part=Number(item.part_no);
    if(!form)return;
    bindRichEditors(form,{uploadImage:bankMedia.uploadImage,onError:err=>toast(err.message||String(err),6000)});
    modalRoot.querySelectorAll("[data-close]").forEach(b=>b.onclick=closeModal);

    const add=modalRoot.querySelector("#bankAddQuestion");
    if(add)add.onclick=()=>{
      const host=modalRoot.querySelector("#bankQuestions"),count=host.querySelectorAll("[data-bank-question]").length;
      if(count>=5)return toast("Part 7 tối đa 5 câu trong một nhóm.");
      host.insertAdjacentHTML("beforeend",questionBlock(count,emptyQuestion(),7));
      const block=host.lastElementChild;
      bindRichEditors(block,{uploadImage:bankMedia.uploadImage,onError:err=>toast(err.message||String(err),6000)});
      bindRemoveButtons();
    };

    function bindRemoveButtons(){
      modalRoot.querySelectorAll(".bank-remove-question").forEach(btn=>btn.onclick=()=>{
        const blocks=[...modalRoot.querySelectorAll("[data-bank-question]")];
        if(blocks.length<=2)return toast("Part 7 cần ít nhất 2 câu trong một nhóm.");
        btn.closest("[data-bank-question]")?.remove();
        [...modalRoot.querySelectorAll("[data-bank-question]")].forEach((block,i)=>{
          block.dataset.index=String(i);const h=block.querySelector("h3");if(h)h.textContent=`Câu ${i+1}`;
        });
      });
    }
    bindRemoveButtons();

    form.onsubmit=async e=>{
      e.preventDefault();
      const payload=collectPayload(form,item,part);
      const problem=validatePayload(payload);if(problem)return toast(problem,6500);
      const btn=modalRoot.querySelector("#bankSaveItem");btn.disabled=true;btn.textContent="Đang lưu…";
      const {data,error}=await sb.rpc("staff_save_bank_item",{p_data:payload});
      if(error){btn.disabled=false;btn.textContent="Lưu";return toast(error.message,7000);}
      closeModal();toast(data?.public_code?`Đã lưu ${data.public_code}`:"Đã lưu bản nháp");await onSaved?.(data);
    };
  }

  function richValue(root){return root?.querySelector("[data-rich-field] textarea")?.value||"";}

  function collectPayload(form,item,part){
    const questions=[...form.querySelectorAll("[data-bank-question]")].map((block,i)=>({
      child_no:i+1,sort_order:i+1,content:richValue(block.querySelector(".bank-question-content")),
      correct_choice_key:block.querySelector(".bank-correct-choice")?.value||null,
      choices:[...block.querySelectorAll("[data-bank-choice]")].map(choice=>({choice_key:choice.dataset.choiceKey,content:richValue(choice)}))
    }));
    const group=part===6||part===7;
    return {
      id:item.id||undefined,item_type:group?"G":"Q",part_no:part,status:form.elements.status.value,
      difficulty:form.elements.difficulty.value,title:form.elements.title.value.trim()||null,
      primary_type:form.elements.primary_type.value.trim()||null,tags:csv(form.elements.tags.value),topics:csv(form.elements.topics.value),
      metadata:item.metadata||{},source_type:item.source_type||"manual",source_name:form.elements.source_name.value.trim()||null,
      stimuli:group?[{media_type:"text",content:richValue(form.querySelector(".bank-passage")),sort_order:1,metadata:{}}]:[],questions
    };
  }

  function validatePayload(data){
    if(data.status!=="approved")return null;
    if(data.part_no===6&&data.questions.length!==4)return "Part 6 phải có đúng 4 câu.";
    if(data.part_no===7&&(data.questions.length<2||data.questions.length>5))return "Part 7 cần từ 2 đến 5 câu.";
    if((data.part_no===6||data.part_no===7)&&!plainText(data.stimuli[0]?.content||""))return "Cần nhập passage/nội dung chung trước khi duyệt.";
    for(let i=0;i<data.questions.length;i++){
      const q=data.questions[i];if(!plainText(q.content))return `Câu ${i+1} chưa có nội dung.`;
      if(!q.correct_choice_key)return `Câu ${i+1} chưa chọn đáp án đúng.`;
      for(const c of q.choices)if(!plainText(c.content))return `Câu ${i+1}, phương án ${c.choice_key} đang trống.`;
    }
    return null;
  }

  function showEditor(item,questions,stimulus=null){
    currentItem=item;modalRoot.innerHTML=editorShell(item,questions,stimulus);bindEditor(item,questions,stimulus);
  }

  function chooseCreate(){
    modalRoot.innerHTML=createChooser();modalRoot.querySelector("[data-close]").onclick=closeModal;
    modalRoot.querySelectorAll(".bank-create-part").forEach(btn=>btn.onclick=()=>{
      const part=Number(btn.dataset.part),item={part_no:part,status:"draft",difficulty:"unrated",source_type:"manual",tags:[],topics:[],metadata:{}};
      showEditor(item,defaultQuestions(part),null);
    });
  }

  async function openEdit(id){
    try{
      modalRoot.innerHTML='<div class="modal-backdrop"><div class="modal"><div class="empty">Đang tải câu hỏi...</div></div></div>';
      const {item,stimuli,questions}=await loadItem(id);showEditor(item,questions.length?questions:defaultQuestions(Number(item.part_no)),stimuli[0]||null);
    }catch(err){closeModal();toast(`Không mở được câu hỏi: ${err.message}`,7000);}
  }

  return {chooseCreate,openEdit};
}

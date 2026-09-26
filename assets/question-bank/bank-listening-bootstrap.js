import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY } from "../config.js";
import { createQuestionBankMediaService } from "./bank-media.js";
import { createQuestionBankListeningEditor } from "./bank-listening-editor.js";

const sb=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY),modalRoot=document.querySelector("#modalRoot"),toastEl=document.querySelector("#toast"),bankMedia=createQuestionBankMediaService(sb);
function closeModal(){modalRoot.innerHTML="";}
function toast(message,ms=5000){if(!toastEl)return;toastEl.textContent=message;toastEl.hidden=false;clearTimeout(toastEl._bankListeningTimer);toastEl._bankListeningTimer=setTimeout(()=>toastEl.hidden=true,ms);}
const editor=createQuestionBankListeningEditor({sb,modalRoot,toast,closeModal,bankMedia,onSaved:()=>document.querySelector("#bankReload")?.click()});

function injectCreateButton(){
  const anchor=document.querySelector("#bankCreate");if(!anchor||document.querySelector("#bankCreateListening"))return;
  const btn=document.createElement("button");btn.id="bankCreateListening";btn.className="secondary";btn.textContent="+ Tạo Listening";btn.onclick=()=>editor.chooseCreate();anchor.parentElement?.insertBefore(btn,anchor);
}

const observer=new MutationObserver(injectCreateButton);observer.observe(document.querySelector("#view")||document.body,{childList:true,subtree:true});injectCreateButton();

document.addEventListener("click",async event=>{
  const btn=event.target.closest?.(".bank-edit-item");if(!btn||btn.dataset.listeningChecked==="busy")return;
  event.preventDefault();event.stopImmediatePropagation();const fallback=btn.onclick;btn.dataset.listeningChecked="busy";
  try{
    const {data,error}=await sb.from("bank_items").select("part_no").eq("id",btn.dataset.id).single();if(error)throw error;
    if(Number(data?.part_no)<=4)await editor.openEdit(btn.dataset.id);else fallback?.call(btn);
  }catch(err){toast(`Không mở được mục ngân hàng: ${err.message||err}`,7000);}
  finally{delete btn.dataset.listeningChecked;}
},true);

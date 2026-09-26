import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY } from "../config.js";
import { createQuestionBankMediaService } from "./bank-media.js";
import { createQuestionBankImportController } from "./bank-import.js";

const sb=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
const modalRoot=document.querySelector("#modalRoot"),toastEl=document.querySelector("#toast"),bankMedia=createQuestionBankMediaService(sb);
function closeModal(){modalRoot.innerHTML="";}
function toast(message,ms=5000){if(!toastEl)return;toastEl.textContent=message;toastEl.hidden=false;clearTimeout(toastEl._bankImportTimer);toastEl._bankImportTimer=setTimeout(()=>toastEl.hidden=true,ms);}

const importer=createQuestionBankImportController({
  sb,modalRoot,toast,closeModal,bankMedia,
  onSaved:()=>document.querySelector("#bankReload")?.click()
});
document.addEventListener("toeic:bank-import-open",()=>importer.open());

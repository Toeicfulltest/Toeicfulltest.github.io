import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY } from "../config.js";
import { createMediaService } from "../modules/media.js";
import { createQuestionBankMediaService } from "./bank-media.js";
import { createQuestionBankCopyController } from "./bank-copy.js";

const sb=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
const sourceMedia=createMediaService(sb);
const bankMedia=createQuestionBankMediaService(sb);
const toastEl=document.querySelector("#toast");

function toast(message,ms=5000){
  if(!toastEl)return;
  toastEl.textContent=message;toastEl.hidden=false;clearTimeout(toastEl._bankTimer);
  toastEl._bankTimer=setTimeout(()=>toastEl.hidden=true,ms);
}

createQuestionBankCopyController({
  sb,bankMedia,sourceSignedUrl:sourceMedia.signedUrl,toast
}).bindGlobal();

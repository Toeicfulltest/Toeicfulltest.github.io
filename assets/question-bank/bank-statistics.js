import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY } from "../config.js";

const sb=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);let timer=null,lastKey="";
const pct=value=>value==null?"—":`${Math.round(Number(value)*100)}%`;

async function enhance(){
  const buttons=[...document.querySelectorAll("#bankList .bank-edit-item")],ids=[...new Set(buttons.map(b=>b.dataset.id).filter(Boolean))];
  const key=ids.join("|");if(!ids.length||key===lastKey)return;lastKey=key;
  const {data,error}=await sb.from("bank_item_stats").select("bank_item_id,attempt_count,correct_count,correct_rate").in("bank_item_id",ids);if(error)return;
  const map=new Map((data||[]).map(x=>[x.bank_item_id,x]));
  for(const btn of buttons){
    const row=btn.closest("tr"),cell=row?.children?.[5],stats=map.get(btn.dataset.id);if(!cell||!stats||cell.querySelector(".bank-empirical-stat"))continue;
    const line=document.createElement("div");line.className="small muted bank-empirical-stat";
    line.textContent=Number(stats.attempt_count)>0?`Thực tế: đúng ${pct(stats.correct_rate)} · ${stats.correct_count}/${stats.attempt_count} lượt câu`:`Thực tế: chưa có lượt làm`;
    cell.appendChild(line);
  }
}

function schedule(){clearTimeout(timer);timer=setTimeout(enhance,80);}
const observer=new MutationObserver(schedule);observer.observe(document.querySelector("#view")||document.body,{childList:true,subtree:true});schedule();

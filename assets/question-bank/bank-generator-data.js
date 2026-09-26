const STANDARD_COUNTS={1:6,2:25,3:39,4:30,5:30,6:16,7:54};
const GROUP_PARTS=new Set([3,4,6,7]);
const PAGE=500;

const statsOf=item=>Array.isArray(item.bank_item_stats)?(item.bank_item_stats[0]||{}):(item.bank_item_stats||{});
const questionCount=item=>Array.isArray(item.bank_questions)?item.bank_questions.length:Number(item.q_count)||0;
const expectedType=part=>GROUP_PARTS.has(Number(part))?"G":"Q";
const uniq=a=>[...new Set((a||[]).filter(Boolean))];

export function standardCount(part){return STANDARD_COUNTS[Number(part)]||0;}
export function isGroupPart(part){return GROUP_PARTS.has(Number(part));}
export function itemQuestionCount(item){return Number(item?.q_count)||questionCount(item);}
export function itemStats(item){return item?.stats||statsOf(item)||{};}

function normalize(item){
  const stats=statsOf(item);
  return {...item,q_count:questionCount(item),stats:{usage_count:Number(stats.usage_count)||0,last_used_at:stats.last_used_at||null}};
}

async function loadUsedIds(sb,testId){
  const out=new Set();let from=0;
  for(;;){
    const {data,error}=await sb.from("bank_item_usage").select("bank_item_id").eq("test_id",testId).range(from,from+PAGE-1);
    if(error)throw error;(data||[]).forEach(x=>out.add(x.bank_item_id));if((data||[]).length<PAGE)break;from+=PAGE;
  }
  return out;
}

export async function loadApprovedBankIndex(sb,parts,testId){
  const used=await loadUsedIds(sb,testId),out=[];
  for(const rawPart of parts){
    const part=Number(rawPart);let from=0;
    for(;;){
      const {data,error}=await sb.from("bank_items")
        .select("id,public_code,item_type,part_no,difficulty,title,primary_type,tags,topics,metadata,updated_at,bank_item_stats(usage_count,last_used_at),bank_questions(id)")
        .eq("status","approved").eq("part_no",part).order("updated_at",{ascending:false}).range(from,from+PAGE-1);
      if(error)throw error;
      const rows=(data||[]).map(normalize).filter(x=>x.q_count>0&&!used.has(x.id)&&x.item_type===expectedType(part));
      out.push(...rows);if((data||[]).length<PAGE)break;from+=PAGE;
    }
  }
  return out;
}

export function defaultTargets(parts,questions=[]){
  const existing={};for(const q of questions)existing[Number(q.part_no)]=(existing[Number(q.part_no)]||0)+1;
  const targets={};for(const p of parts){const part=Number(p.part_no??p);targets[part]=Math.max(0,standardCount(part)-(existing[part]||0));}
  return {targets,existing};
}

export function selectedCounts(selected=[]){
  const out={};for(const row of selected){const part=Number(row.item.part_no);out[part]=(out[part]||0)+itemQuestionCount(row.item);}return out;
}

export function selectionProblems(parts,targets,selected=[]){
  const counts=selectedCounts(selected),problems=[];
  for(const raw of parts){const part=Number(raw.part_no??raw),need=Number(targets[part])||0,have=counts[part]||0;if(have!==need)problems.push(`Part ${part}: đã chọn ${have}/${need} câu cần thêm`);}
  return problems;
}

function difficultyUnits(selected,part){
  const out={easy:0,medium:0,hard:0,unrated:0};
  for(const row of selected)if(Number(row.item.part_no)===Number(part)){const d=row.item.difficulty||"unrated";out[d]=(out[d]||0)+itemQuestionCount(row.item);}return out;
}

function topicPenalty(item,selected,part){
  const current=selected.filter(x=>Number(x.item.part_no)===Number(part)),seen=new Set(current.flatMap(x=>[x.item.primary_type,...(x.item.topics||[]),...(x.item.tags||[])].filter(Boolean)));
  const mine=uniq([item.primary_type,...(item.topics||[]),...(item.tags||[])]);if(!mine.length)return 1;
  const overlap=mine.filter(x=>seen.has(x)).length;return Math.max(.28,1-overlap/Math.max(2,mine.length+1));
}

function recentFactor(lastUsed){
  if(!lastUsed)return 1.8;const days=(Date.now()-new Date(lastUsed).getTime())/86400000;if(!Number.isFinite(days))return 1;
  if(days<7)return .18;if(days<14)return .35;if(days<30)return .65;return Math.min(1.5,.85+days/240);
}

function difficultyFactor(item,selected,part,target){
  const d=item.difficulty||"unrated";if(d==="unrated")return .75;
  const units=difficultyUnits(selected,part),desired={easy:.2,medium:.6,hard:.2}[d]*(Number(target)||1),gap=desired-(units[d]||0);
  return Math.max(.3,1+gap/Math.max(4,target||1));
}

export function candidateWeight(item,{prefs={},selected=[],targets={}}={}){
  const part=Number(item.part_no),stats=itemStats(item);let w=.85+Math.random()*.35;
  if(prefs.preferLowUse!==false)w*=1.2+1.8/(1+(stats.usage_count||0));
  if(prefs.avoidRecent!==false)w*=recentFactor(stats.last_used_at);
  if(prefs.diversifyTopics!==false)w*=topicPenalty(item,selected,part);
  if(prefs.avoidSameType!==false){const last=[...selected].reverse().find(x=>Number(x.item.part_no)===part)?.item;if(last?.primary_type&&item.primary_type&&last.primary_type===item.primary_type)w*=.42;}
  if(prefs.balanceDifficulty!==false)w*=difficultyFactor(item,selected,part,targets[part]);
  return Math.max(.01,w);
}

function weightedPick(pool,ctx){
  const weights=pool.map(x=>candidateWeight(x,ctx)),sum=weights.reduce((a,b)=>a+b,0);let r=Math.random()*sum;
  for(let i=0;i<pool.length;i++){r-=weights[i];if(r<=0)return pool[i];}return pool.at(-1);
}

function eligible(item,part,remaining,selectedIds,excluded,exact=null){
  const q=itemQuestionCount(item);return Number(item.part_no)===Number(part)&&item.item_type===expectedType(part)&&q>0&&q<=remaining&&(!exact||q===exact)&&!selectedIds.has(item.id)&&!excluded.has(item.id);
}

function canComplete(items,total){
  total=Number(total)||0;if(total===0)return true;if(total<0)return false;
  const reachable=new Uint8Array(total+1);reachable[0]=1;
  for(const item of items){const q=itemQuestionCount(item);if(q<=0||q>total)continue;for(let s=total;s>=q;s--)if(reachable[s-q])reachable[s]=1;if(reachable[total])return true;}
  return false;
}

function feasiblePool(index,part,remaining,selectedIds,excluded,exact=null){
  const base=index.filter(item=>eligible(item,part,remaining,selectedIds,excluded,exact));if(exact||remaining<=1)return base;
  return base.filter(item=>{const left=remaining-itemQuestionCount(item);if(left===0)return true;const rest=index.filter(x=>x.id!==item.id&&eligible(x,part,left,selectedIds,excluded));return canComplete(rest,left);});
}

export function autoFill(index,parts,targets,prefs,current=[],excluded=new Set()){
  const locked=current.filter(x=>x.locked),selected=locked.map(x=>({...x})),selectedIds=new Set(selected.map(x=>x.item.id)),warnings=[];
  for(const raw of parts){
    const part=Number(raw.part_no??raw),target=Number(targets[part])||0;let have=selected.filter(x=>Number(x.item.part_no)===part).reduce((n,x)=>n+itemQuestionCount(x.item),0),remaining=target-have;
    if(remaining<0){warnings.push(`Part ${part}: số câu đã khóa vượt cấu hình ${-remaining} câu.`);continue;}
    while(remaining>0){
      const pool=feasiblePool(index,part,remaining,selectedIds,excluded);
      if(!pool.length){warnings.push(`Part ${part}: còn thiếu ${remaining} câu nhưng ngân hàng không có tổ hợp phù hợp.`);break;}
      const item=weightedPick(pool,{prefs,selected,targets});selected.push({item,locked:false});selectedIds.add(item.id);remaining-=itemQuestionCount(item);
    }
  }
  return {selected,warnings};
}

export function candidateBatch(index,{part,remaining,selected=[],excluded=new Set(),prefs={},targets={},limit=8,exact=null}={}){
  const selectedIds=new Set(selected.map(x=>x.item.id)),pool=feasiblePool(index,part,remaining,selectedIds,excluded,exact);
  return pool.map(item=>({item,weight:candidateWeight(item,{prefs,selected,targets})})).sort((a,b)=>b.weight-a.weight).slice(0,limit).map(x=>x.item);
}

export function manualMatches(index,{part,search="",selected=[],excluded=new Set(),limit=80}={}){
  const selectedIds=new Set(selected.map(x=>x.item.id)),q=String(search||"").trim().toLowerCase();
  return index.filter(item=>Number(item.part_no)===Number(part)&&!selectedIds.has(item.id)&&!excluded.has(item.id)&&(!q||`${item.public_code||""} ${item.title||""} ${item.primary_type||""} ${(item.tags||[]).join(" ")} ${(item.topics||[]).join(" ")}`.toLowerCase().includes(q))).slice(0,limit);
}

export function nextIncompletePart(parts,targets,selected=[]){
  const counts=selectedCounts(selected);for(const raw of parts){const part=Number(raw.part_no??raw);if((counts[part]||0)<(Number(targets[part])||0))return part;}return Number(parts[0]?.part_no??parts[0]??5);
}

export function selectionSummary(parts,targets,existing,selected=[]){
  const counts=selectedCounts(selected);return parts.map(raw=>{const part=Number(raw.part_no??raw);return {part,existing:Number(existing[part])||0,target:Number(targets[part])||0,selected:counts[part]||0,total:(Number(existing[part])||0)+(counts[part]||0),standard:standardCount(part)};});
}

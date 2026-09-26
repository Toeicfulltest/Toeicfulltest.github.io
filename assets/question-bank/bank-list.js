import { debounce,esc,fmt,readJSON,writeJSON } from "../modules/utils.js";

const PAGE_SIZE=40;
const DEFAULT_STATE={search:"",part:"",itemType:"",status:"",difficulty:"",page:1};

function statusHtml(status){
  const cls=status==="approved"?"ok":status==="draft"?"warn":"off";
  const label={approved:"Đã duyệt",draft:"Nháp",inactive:"Ngừng dùng"}[status]||status;
  return `<span class="status ${cls}">${esc(label)}</span>`;
}
function difficultyLabel(value){return ({unrated:"Chưa xếp",easy:"Dễ",medium:"Trung bình",hard:"Khó"})[value]||value||"—";}
function itemTypeLabel(value){return value==="G"?"Nhóm":"Câu đơn";}
function sourceLabel(value){return ({manual:"Thủ công",word_import:"Word",test_copy:"Từ bài kiểm tra",clone:"Sao chép"})[value]||value||"—";}
function tagText(values,max=3){const list=Array.isArray(values)?values.filter(Boolean):[];if(!list.length)return "—";const shown=list.slice(0,max).join(", ");return esc(list.length>max?`${shown} +${list.length-max}`:shown);}
function statsOf(item){const raw=item.bank_item_stats;return Array.isArray(raw)?(raw[0]||{}):(raw||{});}

export function createQuestionBankListController(ctx){
  const {sb,toast,getSession,getView,getEditor}=ctx;
  let requestSeq=0;

  function storageKey(){return `toeic.questionBank.filters.${getSession()?.user?.id||"anon"}`;}
  function loadState(){const saved=readJSON(storageKey(),{});return {...DEFAULT_STATE,...saved,page:Math.max(1,Number(saved?.page)||1)};}
  let state=loadState();
  function saveState(){writeJSON(storageKey(),state);}

  function filterShell(){
    return `<div class="form-grid" id="bankFilters">
      <label class="span-2">Tìm kiếm<input id="bankSearch" type="search" value="${esc(state.search)}" placeholder="Mã câu, tiêu đề, dạng câu hoặc nguồn..." autocomplete="off"></label>
      <label>Part<select id="bankPart"><option value="">Tất cả Part</option>${Array.from({length:7},(_,i)=>`<option value="${i+1}" ${String(i+1)===String(state.part)?"selected":""}>Part ${i+1}</option>`).join("")}</select></label>
      <label>Đơn vị<select id="bankItemType"><option value="">Tất cả</option><option value="Q" ${state.itemType==="Q"?"selected":""}>Câu đơn</option><option value="G" ${state.itemType==="G"?"selected":""}>Nhóm</option></select></label>
      <label>Trạng thái<select id="bankStatus"><option value="">Tất cả</option><option value="draft" ${state.status==="draft"?"selected":""}>Nháp</option><option value="approved" ${state.status==="approved"?"selected":""}>Đã duyệt</option><option value="inactive" ${state.status==="inactive"?"selected":""}>Ngừng dùng</option></select></label>
      <label>Độ khó<select id="bankDifficulty"><option value="">Tất cả</option><option value="unrated" ${state.difficulty==="unrated"?"selected":""}>Chưa xếp</option><option value="easy" ${state.difficulty==="easy"?"selected":""}>Dễ</option><option value="medium" ${state.difficulty==="medium"?"selected":""}>Trung bình</option><option value="hard" ${state.difficulty==="hard"?"selected":""}>Khó</option></select></label>
    </div>`;
  }

  function renderRows(items,total){
    const totalPages=Math.max(1,Math.ceil((total||0)/PAGE_SIZE));
    const rows=items.map(item=>{const stats=statsOf(item);return `<tr>
      <td><b>${esc(item.public_code||"Chưa cấp mã")}</b><div class="small muted">${esc(itemTypeLabel(item.item_type))}</div></td>
      <td><b>Part ${esc(item.part_no)}</b><div class="small muted">${esc(item.primary_type||"Chưa phân loại")}</div></td>
      <td>${statusHtml(item.status)}<div class="small muted" style="margin-top:6px">${esc(difficultyLabel(item.difficulty))}</div></td>
      <td>${esc(item.title||"—")}<div class="small muted">${tagText(item.tags)}</div></td>
      <td>${esc(sourceLabel(item.source_type))}</td>
      <td>${esc(stats.usage_count||0)}<div class="small muted">${stats.last_used_at?`Gần nhất: ${esc(fmt(stats.last_used_at))}`:"Chưa sử dụng"}</div></td>
      <td class="small">${esc(fmt(item.updated_at))}</td>
      <td><button class="ghost sm bank-edit-item" data-id="${esc(item.id)}">Sửa / xem</button></td>
    </tr>`}).join("");
    return `<div class="row between wrap" style="margin-top:16px"><div class="muted small">${total||0} mục · ${PAGE_SIZE} mục/trang</div><div class="row"><button class="ghost sm" id="bankPrev" ${state.page<=1?"disabled":""}>← Trước</button><span class="small"><b>${state.page}</b> / ${totalPages}</span><button class="ghost sm" id="bankNext" ${state.page>=totalPages?"disabled":""}>Sau →</button></div></div>
      <div class="table-wrap"><table><thead><tr><th>Mã</th><th>Phân loại</th><th>Trạng thái</th><th>Nội dung / tag</th><th>Nguồn</th><th>Đã dùng</th><th>Cập nhật</th><th></th></tr></thead><tbody>${rows||`<tr><td colspan="8" class="empty">Chưa có câu hỏi phù hợp bộ lọc.</td></tr>`}</tbody></table></div>
      <div class="row between wrap"><div></div><div class="row"><button class="ghost sm" id="bankPrevBottom" ${state.page<=1?"disabled":""}>← Trước</button><span class="small"><b>${state.page}</b> / ${totalPages}</span><button class="ghost sm" id="bankNextBottom" ${state.page>=totalPages?"disabled":""}>Sau →</button></div></div>`;
  }

  function applyFilters(query){
    if(state.part)query=query.eq("part_no",Number(state.part));
    if(state.itemType)query=query.eq("item_type",state.itemType);
    if(state.status)query=query.eq("status",state.status);
    if(state.difficulty)query=query.eq("difficulty",state.difficulty);
    const term=String(state.search||"").replace(/[,()%]/g," ").trim();
    if(term)query=query.or(`public_code.ilike.%${term}%,title.ilike.%${term}%,primary_type.ilike.%${term}%,source_name.ilike.%${term}%`);
    return query;
  }

  async function loadSummary(){
    const counts=await Promise.all(["","draft","approved","inactive"].map(status=>{let q=sb.from("bank_items").select("id",{count:"exact",head:true});if(status)q=q.eq("status",status);return q;}));
    const val=i=>counts[i].error?"—":String(counts[i].count||0),el=getView().querySelector("#bankSummary");
    if(el)el.innerHTML=`<span class="badge">Tổng: ${val(0)}</span><span class="badge">Nháp: ${val(1)}</span><span class="badge">Đã duyệt: ${val(2)}</span><span class="badge">Ngừng dùng: ${val(3)}</span>`;
  }

  async function loadItems({keepPage=false}={}){
    const seq=++requestSeq,view=getView(),host=view.querySelector("#bankList");if(!host)return;
    host.innerHTML='<div class="empty">Đang tải ngân hàng câu hỏi...</div>';
    if(!keepPage)state.page=Math.max(1,state.page||1);
    const from=(state.page-1)*PAGE_SIZE,to=from+PAGE_SIZE-1;
    let query=sb.from("bank_items").select("id,public_code,item_type,part_no,status,difficulty,title,primary_type,tags,topics,source_type,source_name,updated_at,bank_item_stats(usage_count,last_used_at)",{count:"exact"});
    query=applyFilters(query).order("updated_at",{ascending:false}).range(from,to);
    const {data,error,count}=await query;if(seq!==requestSeq)return;
    if(error){console.error(error);host.innerHTML='<div class="warning-box">Không tải được ngân hàng câu hỏi. Vui lòng thử lại.</div>';toast("Không tải được ngân hàng câu hỏi.");return;}
    const total=count||0,totalPages=Math.max(1,Math.ceil(total/PAGE_SIZE));
    if(state.page>totalPages){state.page=totalPages;saveState();return loadItems({keepPage:true});}
    host.innerHTML=renderRows(data||[],total);bindPagination(totalPages);bindRowActions();saveState();
  }

  function bindRowActions(){getView().querySelectorAll(".bank-edit-item").forEach(btn=>btn.onclick=()=>getEditor().openEdit(btn.dataset.id));}
  function bindPagination(totalPages){
    const view=getView(),move=delta=>{const next=Math.min(totalPages,Math.max(1,state.page+delta));if(next===state.page)return;state.page=next;saveState();loadItems({keepPage:true});window.scrollTo({top:0,behavior:"smooth"});};
    ["bankPrev","bankPrevBottom"].forEach(id=>{const el=view.querySelector(`#${id}`);if(el)el.onclick=()=>move(-1);});
    ["bankNext","bankNextBottom"].forEach(id=>{const el=view.querySelector(`#${id}`);if(el)el.onclick=()=>move(1);});
  }

  function bindFilters(){
    const view=getView(),refresh=()=>{state.page=1;saveState();loadItems();},search=view.querySelector("#bankSearch"),debounced=debounce(()=>{state.search=search.value.trim();refresh();},350);
    if(search)search.addEventListener("input",debounced);
    [["bankPart","part"],["bankItemType","itemType"],["bankStatus","status"],["bankDifficulty","difficulty"]].forEach(([id,key])=>{const el=view.querySelector(`#${id}`);if(el)el.onchange=()=>{state[key]=el.value;refresh();};});
    view.querySelector("#bankReload")?.addEventListener("click",()=>{loadSummary();loadItems({keepPage:true});});
    view.querySelector("#bankResetFilters")?.addEventListener("click",()=>{state={...DEFAULT_STATE};saveState();renderBank();});
    view.querySelector("#bankCreate")?.addEventListener("click",()=>getEditor().chooseCreate());
    view.querySelector("#bankImportWord")?.addEventListener("click",()=>document.dispatchEvent(new CustomEvent("toeic:bank-import-open")));
  }

  async function renderBank(){
    state=loadState();const view=getView();
    view.innerHTML=`<section class="card"><div class="row between wrap"><div><h1>Ngân hàng câu hỏi</h1><p class="muted">Quản lý câu hỏi TOEIC theo Part, trạng thái, độ khó, dạng câu và lịch sử sử dụng.</p></div><div class="row wrap"><button id="bankResetFilters" class="ghost">Xóa bộ lọc</button><button id="bankReload" class="secondary">Làm mới</button><button id="bankImportWord" class="secondary">Nhập Word</button><button id="bankCreate" class="primary">+ Tạo câu hỏi</button></div></div><div id="bankSummary" class="row wrap" style="margin:12px 0 18px"><span class="badge">Đang tải thống kê...</span></div>${filterShell()}<div id="bankList"></div></section>`;
    bindFilters();await Promise.all([loadSummary(),loadItems({keepPage:true})]);
  }

  return {renderBank,refresh:()=>Promise.all([loadSummary(),loadItems({keepPage:true})])};
}

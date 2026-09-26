import { esc } from "../modules/utils.js";
import { plainText } from "../modules/rich-editor.js";
import { itemQuestionCount,itemStats,selectionSummary } from "./bank-generator-data.js";

const difficultyLabel=v=>({easy:"Dễ",medium:"Trung bình",hard:"Khó",unrated:"Chưa xếp"})[v]||v||"—";
const modeLabel=v=>({auto:"Tự động toàn bộ",guided:"Bán tự động từng câu/nhóm",manual:"Chọn thủ công"})[v]||v;

function itemMeta(item){
  const stats=itemStats(item),used=stats.usage_count||0,last=stats.last_used_at?new Date(stats.last_used_at).toLocaleDateString("vi-VN"):"chưa dùng";
  return `<div class="small muted">${esc(item.primary_type||"Chưa phân loại")} · ${esc(difficultyLabel(item.difficulty))} · ${itemQuestionCount(item)} câu · dùng ${used} lần · ${esc(last)}</div>`;
}
function tags(item){const values=[...(item.topics||[]),...(item.tags||[])].filter(Boolean).slice(0,5);return values.length?`<div class="row wrap gen-tags">${values.map(x=>`<span class="badge">${esc(x)}</span>`).join("")}</div>`:"";}
function itemTitle(item){return `<b>${esc(item.public_code||"Chưa cấp mã")}</b> · ${esc(item.title||`Part ${item.part_no}`)}`;}

function targetTable(state){
  const rows=selectionSummary(state.parts,state.targets,state.existing,state.selected);
  return `<div class="table-wrap gen-targets"><table><thead><tr><th>Part</th><th>Hiện có</th><th>Cần thêm</th><th>Đã chọn</th><th>Sau khi thêm</th><th>Chuẩn TOEIC</th></tr></thead><tbody>${rows.map(r=>`<tr><td><b>Part ${r.part}</b></td><td>${r.existing}</td><td><input class="gen-target-input" data-part="${r.part}" type="number" min="0" max="${Math.max(0,r.standard-r.existing)}" value="${r.target}"></td><td class="${r.selected===r.target?"gen-ok":"gen-warn"}"><b>${r.selected}</b></td><td>${r.total}</td><td>${r.standard}</td></tr>`).join("")}</tbody></table></div>`;
}

function prefs(state){
  const p=state.prefs||{},check=(key,label)=>`<label class="check-row"><input type="checkbox" data-gen-pref="${key}" ${p[key]!==false?"checked":""}> ${label}</label>`;
  return `<details class="gen-advanced"><summary><b>Tùy chọn nâng cao</b> <span class="muted small">ưu tiên mềm, không phá cấu trúc đề</span></summary><div class="grid grid-2" style="margin-top:10px">${check("balanceDifficulty","Cân bằng độ khó")}${check("avoidRecent","Tránh câu dùng gần đây")}${check("diversifyTopics","Đa dạng chủ đề/tag")}${check("avoidSameType","Tránh cùng dạng liên tiếp")}${check("preferLowUse","Ưu tiên câu ít dùng")}</div></details>`;
}

function selectedList(state){
  if(!state.selected.length)return '<div class="empty">Chưa chọn item nào từ ngân hàng.</div>';
  return state.parts.map(raw=>{
    const part=Number(raw.part_no??raw),rows=state.selected.filter(x=>Number(x.item.part_no)===part);if(!rows.length)return "";
    return `<section class="gen-part-selection"><div class="row between wrap"><h3>Part ${part}</h3><button type="button" class="ghost sm" data-gen-lock-part="${part}">🔒 Khóa toàn bộ Part</button></div>${rows.map(row=>`<div class="gen-selected-row ${row.locked?"locked":""}" data-gen-selected="${row.item.id}"><div><div>${row.locked?"🔒 ":""}${itemTitle(row.item)}</div>${itemMeta(row.item)}${tags(row.item)}</div><div class="row wrap"><button type="button" class="ghost sm" data-gen-preview="${row.item.id}">Xem</button><button type="button" class="secondary sm" data-gen-toggle-lock="${row.item.id}">${row.locked?"Mở khóa":"Khóa"}</button><button type="button" class="secondary sm" data-gen-replace="${row.item.id}" ${row.locked?"disabled":""}>Đổi</button><button type="button" class="ghost sm" data-gen-manual-replace="${row.item.id}" ${row.locked?"disabled":""}>Chọn tay</button><button type="button" class="danger sm" data-gen-remove="${row.item.id}" ${row.locked?"disabled":""}>Loại</button></div></div>`).join("")}</section>`;
  }).join("");
}

function candidateRows(rows,state,manual=false){
  if(!rows?.length)return '<div class="empty">Không còn item phù hợp điều kiện hiện tại.</div>';
  return `<div class="gen-candidates">${rows.map(item=>`<div class="gen-candidate"><div><div>${itemTitle(item)}</div>${itemMeta(item)}${tags(item)}</div><div class="row wrap"><button type="button" class="ghost sm" data-gen-preview="${item.id}">Xem</button><button type="button" class="primary sm" data-gen-pick="${item.id}">${state.replacingId?"Thay bằng item này":manual?"Chọn":"Chọn"}</button></div></div>`).join("")}</div>`;
}

function preview(detail){
  if(!detail)return "";const stimulus=(detail.stimuli||[]).map(x=>plainText(x.content||"")).filter(Boolean).join(" "),q=(detail.questions||[])[0],text=plainText(q?.content||""),choices=(q?.choices||[]).map(c=>`${c.choice_key}: ${plainText(c.content||"")}`).filter(x=>x.length>3);
  return `<div class="info-box gen-preview"><div class="row between"><b>Xem nhanh ${esc(detail.item?.public_code||"")}</b><button type="button" class="ghost xs" id="genClosePreview">Đóng</button></div>${stimulus?`<p>${esc(stimulus.slice(0,700))}${stimulus.length>700?"…":""}</p>`:""}${text?`<p><b>Câu đầu:</b> ${esc(text.slice(0,500))}${text.length>500?"…":""}</p>`:""}${choices.length?`<div class="small">${choices.map(x=>`<div>${esc(x.slice(0,240))}</div>`).join("")}</div>`:""}</div>`;
}

function modePanel(state){
  if(state.mode==="auto")return `<div class="row wrap"><button type="button" class="primary" id="genAutoDraw">🎲 Rút theo cấu hình</button><button type="button" class="secondary" id="genRerollUnlocked">♻ Rút lại phần chưa khóa</button></div><p class="muted small">Các item đã khóa được giữ nguyên; thuật toán chỉ rút lại phần còn thiếu.</p>`;
  if(state.mode==="guided")return `<div class="row between wrap"><div><b>Đang chọn Part ${state.currentPart}</b><div class="muted small">Hệ thống gợi ý các item phù hợp với số câu còn thiếu.</div></div><div class="row wrap"><select id="genGuidedPart">${state.parts.map(p=>{const n=Number(p.part_no??p);return `<option value="${n}" ${n===state.currentPart?"selected":""}>Part ${n}</option>`}).join("")}</select><button type="button" class="secondary" id="genRefreshCandidates">Đổi danh sách gợi ý</button><button type="button" class="primary" id="genAutoRest">Tự động phần còn lại</button></div></div>${candidateRows(state.candidates,state)}`;
  return `<div class="row wrap"><label>Part<select id="genManualPart">${state.parts.map(p=>{const n=Number(p.part_no??p);return `<option value="${n}" ${n===state.currentPart?"selected":""}>Part ${n}</option>`}).join("")}</select></label><label class="grow">Tìm trong ngân hàng<input id="genManualSearch" type="search" value="${esc(state.manualSearch||"")}" placeholder="Mã, dạng, tag, chủ đề..."></label>${state.replacingId?'<button type="button" class="ghost" id="genCancelReplace">Hủy thay câu</button>':""}</div>${candidateRows(state.manualRows,state,true)}`;
}

export function generatorShell(state){
  const warnings=(state.warnings||[]).filter(Boolean);
  return `<div class="modal-backdrop"><div class="modal wide gen-modal"><div class="row between wrap"><div><h2>Tạo đề từ ngân hàng</h2><p class="muted">${esc(state.test.title)} · ${esc(modeLabel(state.mode))}. Chỉ ghi vào đề khi bấm <b>Đưa vào đề</b>.</p></div><button type="button" class="ghost sm" data-gen-close>Đóng</button></div>
    <div class="tabs gen-mode-tabs"><button type="button" class="btn tab ${state.mode==="auto"?"active":""}" data-gen-mode="auto">Tự động</button><button type="button" class="btn tab ${state.mode==="guided"?"active":""}" data-gen-mode="guided">Bán tự động</button><button type="button" class="btn tab ${state.mode==="manual"?"active":""}" data-gen-mode="manual">Chọn tay</button></div>
    <div class="warning-box"><b>Không thay nội dung đã có.</b> “Cần thêm” được tính từ số câu hiện tại; item đã đưa vào đề ở lần trước cũng không được dùng lại trong cùng bài.</div>
    ${targetTable(state)}${prefs(state)}
    ${warnings.length?`<div class="warning-box"><b>Cảnh báo cấu hình</b>${warnings.map(x=>`<div>• ${esc(x)}</div>`).join("")}</div>`:""}
    ${preview(state.previewDetail)}
    <section class="card gen-mode-panel"><h3>${esc(modeLabel(state.mode))}</h3>${modePanel(state)}</section>
    <section class="card"><div class="row between wrap"><div><h3>Danh sách đã chọn</h3><div class="muted small">🔒 item khóa sẽ không đổi khi rút lại.</div></div><span class="badge">${state.selected.reduce((n,x)=>n+itemQuestionCount(x.item),0)} câu mới</span></div>${selectedList(state)}</section>
    <div class="row between wrap gen-footer"><div id="genCommitProgress" class="muted small"></div><div class="row wrap"><button type="button" class="secondary" data-gen-close>Hủy</button><button type="button" class="primary" id="genCommit">Đưa vào đề</button></div></div>
  </div></div>`;
}

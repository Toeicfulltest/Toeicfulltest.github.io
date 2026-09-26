import { esc } from "../modules/utils.js";
import { richEditorField } from "../modules/rich-editor.js";

const KEYS=["A","B","C","D"];

export function wordImportUploadView(){
  return `<div class="modal-backdrop"><div class="modal wide"><div class="row between wrap"><div><h2>Nhập Word vào ngân hàng</h2><p class="muted">Đọc Part 5–7, giữ rich text/bảng/ảnh và nhận diện group trước khi lưu.</p></div><button type="button" class="ghost sm" data-import-close>Đóng</button></div>
    <div class="warning-box"><b>Word chỉ tạo dữ liệu để duyệt.</b> Hệ thống không tự phê duyệt. Part 6–7 được giữ theo nguyên group khi nhận diện được dòng “Questions x–y refer to…”.</div>
    <form id="bankWordUpload" class="stack"><label>File Word (.docx)<input type="file" name="word_file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required></label><div id="bankWordProgress" class="muted small">Chưa chọn file.</div><button class="primary">Đọc Word và kiểm tra</button></form>
  </div></div>`;
}

function issueBadge(item){
  const n=(item.issues||[]).length;if(!n)return '<span class="status ok">Sẵn sàng</span>';return `<span class="status warn">${n} cảnh báo</span>`;
}
function sourceLabel(item){const nums=item.metadata?.source_numbers||[];return item.item_type==="Q"?`Câu ${item.metadata?.source_number||"—"}`:nums.length?`Câu ${nums[0]}–${nums.at(-1)}`:`Part ${item.part_no}`;}
function questionEditor(q,i){
  const choices=Object.fromEntries((q.choices||[]).map(c=>[c.choice_key,c]));
  return `<section class="card" data-import-question data-index="${i}"><div class="row between wrap"><h3>Câu ${esc(q.number||i+1)}</h3><label class="small">Đáp án đúng <select class="import-correct"><option value="">— Chọn —</option>${KEYS.map(k=>`<option value="${k}" ${q.correct_choice_key===k?"selected":""}>${k}</option>`).join("")}</select></label></div>
    ${richEditorField(`q_${i}_content`,`Nội dung câu hỏi`,q.content||"")}
    <div class="choices-editor">${KEYS.map(k=>`<div class="choice-edit-v2" data-import-choice data-choice-key="${k}"><div class="choice-key">${k}</div>${richEditorField(`q_${i}_${k}`,`Phương án ${k}`,choices[k]?.content||"",{compact:true})}</div>`).join("")}</div>
  </section>`;
}

export function wordImportReviewView({items,index,fileName,messages=[]}){
  const current=items[index],included=items.filter(x=>x.include!==false&&!x.saved).length,saved=items.filter(x=>x.saved).length;
  return `<div class="modal-backdrop"><div class="modal wide"><div class="row between wrap"><div><h2>Duyệt Word → Ngân hàng</h2><p class="muted">${esc(fileName)} · ${items.length} mục · còn ${included} mục chưa lưu${saved?` · đã lưu ${saved}`:""}</p></div><button type="button" class="ghost sm" data-import-close>Đóng</button></div>
    ${messages.length?`<details class="warning-box"><summary>Thông báo từ bộ đọc Word (${messages.length})</summary><div class="small">${messages.slice(0,10).map(x=>`<div>${esc(x)}</div>`).join("")}</div></details>`:""}
    <div class="authoring-shell bank-import-shell"><aside class="authoring-nav bank-import-nav"><h3>Nội dung</h3><div class="stack bank-import-list">${items.map((item,i)=>`<button type="button" class="ghost sm bank-import-item ${i===index?"active":""} ${item.saved?"saved":""}" data-import-index="${i}"><b>${esc(sourceLabel(item))}</b><span class="small muted">Part ${item.part_no} · ${item.item_type==="G"?"Nhóm":"Câu đơn"}</span>${item.saved?'<span class="status ok">Đã lưu</span>':issueBadge(item)}</button>`).join("")}</div></aside>
      <div class="authoring-main"><form id="bankImportReviewForm" class="stack">
        <div class="row between wrap"><div><h3>${esc(sourceLabel(current))} · Part ${current.part_no}</h3>${issueBadge(current)}</div><label class="row"><input type="checkbox" name="include" ${current.include!==false&&!current.saved?"checked":""} ${current.saved?"disabled":""}> ${current.saved?"Đã lưu":"Đưa mục này vào ngân hàng"}</label></div>
        ${(current.issues||[]).length?`<div class="warning-box small">${current.issues.map(x=>`<div>• ${esc(x)}</div>`).join("")}</div>`:""}
        <div class="form-grid"><label class="span-2">Tên mục<input name="title" value="${esc(current.title||"")}"></label><label>Độ khó<select name="difficulty"><option value="unrated" ${current.difficulty==="unrated"||!current.difficulty?"selected":""}>Chưa xếp</option><option value="easy" ${current.difficulty==="easy"?"selected":""}>Dễ</option><option value="medium" ${current.difficulty==="medium"?"selected":""}>Trung bình</option><option value="hard" ${current.difficulty==="hard"?"selected":""}>Khó</option></select></label><label>Dạng chính<input name="primary_type" value="${esc(current.primary_type||"")}" placeholder="Grammar, Double Passage…"></label></div>
        ${current.item_type==="G"?richEditorField("stimulus","Passage / nội dung chung",current.stimulus||""):""}
        <div id="bankImportQuestions">${(current.questions||[]).map(questionEditor).join("")}</div>
        <div class="row between wrap"><button type="button" class="ghost" id="bankImportPrev" ${index<=0?"disabled":""}>← Trước</button><span class="small muted">${index+1} / ${items.length}</span><button type="button" class="ghost" id="bankImportNext" ${index>=items.length-1?"disabled":""}>Sau →</button></div>
      </form></div></div>
    <div class="row between wrap" style="margin-top:16px"><div id="bankImportSaveProgress" class="muted small">Kiểm tra từng mục trước khi lưu.</div><div class="row wrap"><button type="button" class="secondary" id="bankImportSaveDraft">Lưu bản nháp</button><button type="button" class="primary" id="bankImportApprove">Duyệt & lưu</button></div></div>
  </div></div>`;
}

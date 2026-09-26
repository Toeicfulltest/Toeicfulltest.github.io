import { esc } from "../modules/utils.js";
import { richEditorField } from "../modules/rich-editor.js";

const KEYS=["A","B","C","D"];

export function metadataFields(item={}){
  const coded=Boolean(item.public_code);
  const status=item.status||"draft";
  return `<div class="form-grid">
    <label>Part
      <select name="part_no" disabled>
        ${[5,6,7].map(p=>`<option value="${p}" ${Number(item.part_no||5)===p?"selected":""}>Part ${p}</option>`).join("")}
      </select>
      <span class="hint">Part được chọn khi tạo để giữ đúng cấu trúc câu/group.</span>
    </label>
    <label>Trạng thái
      <select name="status">
        ${!coded?`<option value="draft" ${status==="draft"?"selected":""}>Nháp</option>`:""}
        <option value="approved" ${status==="approved"?"selected":""}>Đã duyệt</option>
        <option value="inactive" ${status==="inactive"?"selected":""}>Ngừng dùng</option>
      </select>
    </label>
    <label>Độ khó
      <select name="difficulty">
        ${[["unrated","Chưa xếp"],["easy","Dễ"],["medium","Trung bình"],["hard","Khó"]].map(([v,l])=>`<option value="${v}" ${item.difficulty===v?"selected":""}>${l}</option>`).join("")}
      </select>
    </label>
    <label>Dạng chính<input name="primary_type" value="${esc(item.primary_type||"")}" placeholder="Grammar, Vocabulary, Email, Notice..."></label>
    <label class="span-2">Tiêu đề nội bộ<input name="title" value="${esc(item.title||"")}" placeholder="Tên ngắn để giảng viên dễ nhận biết"></label>
    <label class="span-2">Tags<input name="tags" value="${esc((item.tags||[]).join(", "))}" placeholder="verb form, inference, schedule..."></label>
    <label class="span-2">Chủ đề<input name="topics" value="${esc((item.topics||[]).join(", "))}" placeholder="office, travel, meeting..."></label>
    <label class="span-2">Nguồn<input name="source_name" value="${esc(item.source_name||"")}" placeholder="ETS 2019 Test 3, tài liệu nội bộ..."></label>
  </div>`;
}

export function questionBlock(index,q={},partNo=5){
  const correct=q.correct_choice_key||"";
  const choices=Object.fromEntries((q.choices||[]).map(c=>[c.choice_key,c]));
  return `<section class="group-box bank-question-block" data-bank-question data-index="${index}">
    <div class="row between wrap"><h3>Câu ${index+1}</h3>${partNo===7?'<button type="button" class="ghost sm bank-remove-question">Xóa câu</button>':""}</div>
    <div class="bank-question-content">${richEditorField(`q_${index}_content`,"Nội dung câu hỏi",q.content||"")}</div>
    <label>Đáp án đúng
      <select class="bank-correct-choice"><option value="">Chưa chọn</option>${KEYS.map(k=>`<option value="${k}" ${correct===k?"selected":""}>${k}</option>`).join("")}</select>
    </label>
    <div class="choices-editor">
      ${KEYS.map(k=>`<div class="choice-edit-v2" data-bank-choice data-choice-key="${k}"><div class="choice-key">${k}</div>${richEditorField(`q_${index}_choice_${k}`,`Phương án ${k}`,choices[k]?.content||"",{compact:true})}</div>`).join("")}
    </div>
  </section>`;
}

export function editorShell(item={},questions=[],stimulus=null){
  const part=Number(item.part_no||5);
  const code=item.public_code?` · ${esc(item.public_code)}`:"";
  const group=part===6||part===7;
  return `<div class="modal-backdrop"><div class="modal wide bank-editor-modal">
    <div class="row between wrap"><div><h2>${item.id?"Sửa":"Tạo"} mục ngân hàng${code}</h2><p class="muted">Part ${part} · ${group?"Nhóm passage":"Câu đơn"}. Nội dung dùng rich text và ảnh lưu riêng trong bank-media.</p></div><button type="button" class="ghost sm" data-close>Đóng</button></div>
    <form id="bankEditorForm" class="stack">
      ${metadataFields(item)}
      ${group?`<section class="group-box"><h3>Passage / nội dung chung</h3><div class="bank-passage">${richEditorField("bank_passage","Passage",stimulus?.content||"")}</div></section>`:""}
      <div id="bankQuestions">${questions.map((q,i)=>questionBlock(i,q,part)).join("")}</div>
      ${part===7?'<div><button type="button" class="secondary" id="bankAddQuestion">+ Thêm câu trong nhóm</button></div>':""}
      <div class="row between wrap"><div class="small muted">Mã chỉ được cấp khi trạng thái chuyển sang Đã duyệt.</div><div class="row"><button type="button" class="ghost" data-close>Hủy</button><button class="primary" id="bankSaveItem">Lưu</button></div></div>
    </form>
  </div></div>`;
}

export function createChooser(){
  return `<div class="modal-backdrop"><div class="modal"><div class="row between"><div><h2>Tạo câu hỏi ngân hàng</h2><p class="muted">Chọn Part để mở đúng cấu trúc soạn.</p></div><button class="ghost sm" data-close>Đóng</button></div><div class="grid grid-3"><button class="secondary bank-create-part" data-part="5">Part 5<br><span class="small">Câu đơn</span></button><button class="secondary bank-create-part" data-part="6">Part 6<br><span class="small">Passage + 4 câu</span></button><button class="secondary bank-create-part" data-part="7">Part 7<br><span class="small">Passage + 2–5 câu</span></button></div></div></div>`;
}

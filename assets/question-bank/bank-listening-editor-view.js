import { esc } from "../modules/utils.js";
import { richEditorField } from "../modules/rich-editor.js";

const difficultyOptions=[["unrated","Chưa xếp"],["easy","Dễ"],["medium","Trung bình"],["hard","Khó"]];
const keysForPart=part=>Number(part)===2?["A","B","C"]:["A","B","C","D"];

export function listeningMetadataFields(item={}){
  const coded=Boolean(item.public_code),status=item.status||"draft",part=Number(item.part_no||1);
  return `<div class="form-grid">
    <label>Part<select name="part_no" disabled>${[1,2,3,4].map(p=>`<option value="${p}" ${part===p?"selected":""}>Part ${p}</option>`).join("")}</select><span class="hint">Part được cố định khi tạo item.</span></label>
    <label>Trạng thái<select name="status">${!coded?`<option value="draft" ${status==="draft"?"selected":""}>Nháp</option>`:""}<option value="approved" ${status==="approved"?"selected":""}>Đã duyệt</option><option value="inactive" ${status==="inactive"?"selected":""}>Ngừng dùng</option></select></label>
    <label>Độ khó<select name="difficulty">${difficultyOptions.map(([v,l])=>`<option value="${v}" ${item.difficulty===v?"selected":""}>${l}</option>`).join("")}</select></label>
    <label>Dạng chính<input name="primary_type" value="${esc(item.primary_type||"")}" placeholder="WH question, conversation, announcement..."></label>
    <label class="span-2">Tiêu đề nội bộ<input name="title" value="${esc(item.title||"")}" placeholder="Tên ngắn để dễ nhận biết"></label>
    <label class="span-2">Tags<input name="tags" value="${esc((item.tags||[]).join(", "))}" placeholder="people, request, inference, graphic..."></label>
    <label class="span-2">Chủ đề<input name="topics" value="${esc((item.topics||[]).join(", "))}" placeholder="office, travel, meeting..."></label>
    <label class="span-2">Nguồn<input name="source_name" value="${esc(item.source_name||"")}" placeholder="ETS, tài liệu nội bộ..."></label>
  </div>`;
}

export function mediaField(key,label,{accept="",path="",hint=""}={}){
  return `<div class="media-paste-field" data-listening-media="${esc(key)}"><div class="row between wrap"><b>${esc(label)}</b>${hint?`<span class="hint">${esc(hint)}</span>`:""}</div><input type="file" data-listening-file="${esc(key)}" accept="${esc(accept)}"><input type="hidden" name="${esc(key)}_path" value="${esc(path||"")}"><div class="media-preview" data-listening-preview="${esc(key)}">${path?'<span class="badge">Đã có media</span>':'<span class="muted small">Chưa có file</span>'}</div><button type="button" class="ghost sm" data-listening-clear="${esc(key)}" ${path?"":"hidden"}>Xóa file</button></div>`;
}

export function listeningQuestionBlock(index,q={},partNo=1){
  const part=Number(partNo),keys=keysForPart(part),correct=q.correct_choice_key||"",choices=Object.fromEntries((q.choices||[]).map(c=>[c.choice_key,c]));
  if(part<=2)return `<section class="group-box bank-listening-question" data-bank-listening-question data-index="${index}"><div class="row between wrap"><h3>${part===1?"Đáp án ảnh":"Đáp án câu nghe"}</h3><span class="muted small">Không hiển thị transcript cho sinh viên.</span></div><label>Đáp án đúng<select class="bank-listening-correct"><option value="">Chưa chọn</option>${keys.map(k=>`<option value="${k}" ${correct===k?"selected":""}>${k}</option>`).join("")}</select></label></section>`;
  return `<section class="group-box bank-listening-question" data-bank-listening-question data-index="${index}"><h3>Câu ${index+1}</h3><div class="bank-listening-question-content">${richEditorField(`listen_q_${index}`,"Nội dung câu hỏi",q.content||"")}</div><label>Đáp án đúng<select class="bank-listening-correct"><option value="">Chưa chọn</option>${keys.map(k=>`<option value="${k}" ${correct===k?"selected":""}>${k}</option>`).join("")}</select></label><div class="choices-editor">${keys.map(k=>`<div class="choice-edit-v2" data-bank-listening-choice data-choice-key="${k}"><div class="choice-key">${k}</div>${richEditorField(`listen_q_${index}_${k}`,`Phương án ${k}`,choices[k]?.content||"",{compact:true})}</div>`).join("")}</div></section>`;
}

function mediaSection(part,paths={}){
  const audio=mediaField("listening_audio","Clip MP3",{accept:"audio/mpeg,.mp3",path:paths.audio||"",hint:"Mỗi item đúng 1 clip; nên có khoảng lặng đầu/cuối và không đọc cứng số câu nguồn."});
  if(part===1)return `<section class="group-box"><h3>Media Listening</h3>${mediaField("part1_image","Ảnh Part 1",{accept:"image/png,image/jpeg,image/webp",path:paths.image||"",hint:"Ảnh hiển thị cho sinh viên."})}${audio}</section>`;
  if(part===2)return `<section class="group-box"><h3>Media Listening</h3>${audio}</section>`;
  return `<section class="group-box"><h3>Media nhóm</h3>${audio}${mediaField("listening_graphic","Graphic tùy chọn",{accept:"image/png,image/jpeg,image/webp",path:paths.graphic||"",hint:"Dùng khi câu hỏi có bảng/biểu đồ/hình minh họa."})}</section>`;
}

export function listeningEditorShell(item={},questions=[],paths={}){
  const part=Number(item.part_no||1),code=item.public_code?` · ${esc(item.public_code)}`:"",group=part===3||part===4;
  return `<div class="modal-backdrop"><div class="modal wide bank-editor-modal"><div class="row between wrap"><div><h2>${item.id?"Sửa":"Tạo"} Listening bank${code}</h2><p class="muted">Part ${part} · ${group?"Group 3 câu":"Câu đơn"}. Clip MP3 sẽ được ghép thành một audio chung khi tạo đề.</p></div><button type="button" class="ghost sm" data-listening-close>Đóng</button></div><form id="bankListeningForm" class="stack">${listeningMetadataFields(item)}${mediaSection(part,paths)}<div id="bankListeningQuestions">${questions.map((q,i)=>listeningQuestionBlock(i,q,part)).join("")}</div><div class="row between wrap"><div class="small muted">Mã chỉ được cấp khi chuyển sang Đã duyệt.</div><div class="row"><button type="button" class="ghost" data-listening-close>Hủy</button><button class="primary" id="bankListeningSave">Lưu</button></div></div></form></div></div>`;
}

export function listeningCreateChooser(){
  return `<div class="modal-backdrop"><div class="modal"><div class="row between"><div><h2>Tạo câu hỏi Listening</h2><p class="muted">Chọn Part 1–4. Mỗi item dùng một clip MP3 để có thể ghép audio chung.</p></div><button class="ghost sm" data-listening-close>Đóng</button></div><div class="grid grid-2"><button class="secondary bank-listening-create" data-part="1">Part 1<br><span class="small">Ảnh + clip + 1 đáp án</span></button><button class="secondary bank-listening-create" data-part="2">Part 2<br><span class="small">Clip + A/B/C</span></button><button class="secondary bank-listening-create" data-part="3">Part 3<br><span class="small">Clip + 3 câu</span></button><button class="secondary bank-listening-create" data-part="4">Part 4<br><span class="small">Clip + 3 câu</span></button></div></div></div>`;
}

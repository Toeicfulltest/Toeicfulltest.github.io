import { esc,go } from "../modules/utils.js";
import { TEST_KINDS,testKindConfig,testKindLabel,createPartsForKind } from "./test-kind.js";
import { readToeicImportFiles,inferTestKind,importQuestionsIntoTest,renderImportPreview } from "../modules/import-file.js";

export function createTestCreateController(ctx){
  const {sb,modalRoot,toast,closeModal,invalidateStaffData,invalidateStaffPage}=ctx;

  const toIso=value=>value?new Date(value).toISOString():null;
  const classOptions=(classes,selected=[])=>classes.map(c=>`<option value="${c.id}" ${selected.includes(c.id)?"selected":""}>${esc(c.name)}</option>`).join("");
  const classHint='<span class="hint">Có thể chọn nhiều lớp. Giữ Ctrl/Cmd khi chọn trên máy tính.</span>';

  function kindCards(){
    return Object.entries(TEST_KINDS).map(([key,cfg])=>`<button type="button" class="card test-kind ${key==="reading"?"active":""}" data-kind="${key}" role="radio" aria-checked="${key==="reading"?"true":"false"}"><b>${cfg.label}</b><span class="muted">Mặc định ${cfg.duration} phút</span></button>`).join("");
  }
  function kindNote(kind){
    if(kind==="listening")return "<b>Listening:</b> Part 1–2 cố định; Part 3–4 giữ câu/nhóm và trộn thứ tự lựa chọn theo từng lượt. Sau khi tạo bài, vào Cài đặt để tải <b>1 file audio chung Part 1–4</b>; sinh viên bấm nghe một lần và audio chạy liên tục.";
    if(kind==="full")return "<b>Full Test:</b> dùng 1 file audio chung chạy liên tục cho Listening Part 1–4; nghe hết mới chuyển sang Reading Part 5–7 trong cùng một lượt làm.";
    return "<b>Reading:</b> giữ nguyên logic V1.17: Part 5 trộn câu, Part 6 trộn nhóm, Part 7 cố định.";
  }

  async function open(){
    const [classesRes,testsRes,assignmentsRes]=await Promise.all([
      sb.from("classes").select("id,name").order("name"),
      sb.from("tests").select("id,title,class_id,duration_minutes,max_attempts,test_kind").is("archived_at",null).order("created_at",{ascending:false}),
      sb.from("test_classes").select("test_id,class_id")
    ]);
    const classes=classesRes.data||[];let oldTests=testsRes.data||[],migrationReady=!testsRes.error;
    if(testsRes.error){const fallback=await sb.from("tests").select("id,title,class_id,duration_minutes,max_attempts").is("archived_at",null).order("created_at",{ascending:false});oldTests=(fallback.data||[]).map(t=>({...t,test_kind:"reading"}));}
    const assignedByTest=(assignmentsRes.data||[]).reduce((map,x)=>{(map[x.test_id]??=[]).push(x.class_id);return map;},{});
    const options=classOptions(classes);
    modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal wide create-test-modal">
      <div class="row between wrap"><div><h2>Tạo bài kiểm tra</h2><p class="muted">Listening, Reading và Full Test dùng chung một workspace; một bài có thể áp dụng cho nhiều lớp.</p></div><button class="ghost sm" data-close>Đóng</button></div>
      <div class="tabs create-mode-tabs"><button type="button" class="btn tab active create-mode" data-mode="manual">Tạo thủ công</button><button type="button" class="btn tab create-mode" data-mode="import">Nhập từ file</button><button type="button" class="btn tab create-mode" data-mode="clone">Từ bài kiểm tra cũ</button><button type="button" class="btn tab create-mode" data-mode="ai">Tạo đề bằng AI <span class="soon-badge">Sau</span></button></div>
      <section class="create-mode-panel" data-mode-panel="manual"><div class="test-kind-grid" role="radiogroup" aria-label="Loại bài">${kindCards()}</div>${migrationReady?"":'<div class="warning-box"><b>Chưa có migration V1.18.</b><br>Reading vẫn dùng được; Listening/Full Test chỉ bật sau khi chạy <code>supabase/migrations/v1.18_listening_full_test.sql</code>.</div>'}<form id="manualTestForm" class="form-grid"><input type="hidden" name="test_kind" value="reading"><label class="span-2">Tên bài<input name="title" required></label><label class="span-2">Lớp áp dụng<select name="class_ids" multiple size="5">${options}</select>${classHint}</label><label>Thời gian (phút)<input type="number" name="duration_minutes" value="75" min="1" required></label><label>Số lần làm<input type="number" name="max_attempts" value="1" min="1" required></label><label>Chống gian lận<select name="anti_cheat_mode"><option value="warn_then_submit">Cảnh báo rồi tự nộp</option><option value="strict">Nghiêm ngặt</option><option value="off">Tắt</option></select></label><label>Mở lúc<input type="datetime-local" name="opens_at"></label><label>Đóng lúc<input type="datetime-local" name="closes_at"></label><label class="span-2">Mô tả<textarea name="description" rows="3"></textarea></label><label class="check-row span-2"><input type="checkbox" name="show_answers_after_submit" checked> Cho xem đáp án sau khi nộp</label><div class="span-2 info-box kind-note">${kindNote("reading")}</div><button type="submit" class="primary span-2">Tạo bài nháp</button></form></section>

      <section class="create-mode-panel" data-mode-panel="import" hidden>
        <form id="importTestForm" class="form-grid">
          <label class="span-2">File đề Word (.docx)<input id="importQuestionFile" name="question_file" type="file" accept=".docx" required></label>
          <label class="span-2">File đáp án Excel (.xlsx, .xls)<input id="importAnswerFile" name="answer_file" type="file" accept=".xlsx,.xls" required></label>
          <label class="span-2">Tên bài<input name="title" required placeholder="Có thể để hệ thống lấy tên file đề"></label>
          <label class="span-2">Lớp áp dụng<select name="class_ids" multiple size="5">${options}</select>${classHint}</label>
          <label>Loại đề<input id="importDetectedKind" value="Chưa đọc file" readonly></label>
          <label>Thời gian (phút)<input type="number" name="duration_minutes" value="75" min="1" required></label>
          <label>Số lần làm<input type="number" name="max_attempts" value="1" min="1" required></label>
          <label>Chống gian lận<select name="anti_cheat_mode"><option value="warn_then_submit">Cảnh báo rồi tự nộp</option><option value="strict">Nghiêm ngặt</option><option value="off">Tắt</option></select></label>
          <label class="check-row"><input type="checkbox" name="show_answers_after_submit" checked> Cho xem đáp án sau khi nộp</label>
          <div class="span-2 warning-box"><b>Nhập phần chữ trước.</b> Không nhập audio hoặc ảnh ở bước này. Câu nhận diện chưa hoàn chỉnh vẫn được lưu để giảng viên sửa sau.</div>
          <button type="button" class="secondary span-2" id="analyzeImportFiles">Đọc file và xem trước</button>
        </form>
        <div id="importFilePreview" class="file-drop-preview muted">Chọn 1 file Word đề và 1 file Excel đáp án.</div>
        <div id="importCreateActions" class="row between wrap" hidden><span class="muted small" id="importReadyNote"></span><button class="primary" id="createImportedTest">Tạo bài và nhập câu hỏi</button></div>
      </section>

      <section class="create-mode-panel" data-mode-panel="clone" hidden><form id="cloneTestForm" class="form-grid"><label class="span-2">Bài kiểm tra nguồn<select name="source_test_id" required><option value="">Chọn bài…</option>${oldTests.map(t=>`<option value="${t.id}" data-duration="${t.duration_minutes}" data-max="${t.max_attempts}" data-classes="${(assignedByTest[t.id]||[t.class_id].filter(Boolean)).join(",")}">${esc(t.title)} · ${esc(testKindLabel(t.test_kind))}</option>`).join("")}</select></label><label class="span-2">Tên bài mới<input name="title" required placeholder="Tên bài kiểm tra mới"></label><label class="span-2">Lớp áp dụng<select name="class_ids" multiple size="5">${options}</select>${classHint}</label><label>Thời gian (phút)<input type="number" name="duration_minutes" value="75" min="1" required></label><label>Số lần làm<input type="number" name="max_attempts" value="1" min="1" required></label><label>Mở lúc<input type="datetime-local" name="opens_at"></label><label>Đóng lúc<input type="datetime-local" name="closes_at"></label><div class="span-2 warning-box"><b>Chỉ sao chép nội dung đề.</b><br>Loại bài, Part, stimulus, media, câu hỏi và đáp án được giữ nguyên. Không sao chép lượt làm, điểm, LIVE hay vi phạm.</div><button type="submit" class="primary span-2">Tạo bản sao</button></form></section>
      <section class="create-mode-panel" data-mode-panel="ai" hidden><div class="ai-placeholder-card"><div><b>Tạo đề bằng AI</b><p class="muted">Giữ nguyên vị trí chức năng V1.17. AI sẽ chỉ tạo Draft và giảng viên phải duyệt trước khi Publish.</p></div><button class="primary" disabled>Tạo bản nháp bằng AI · Sắp hỗ trợ</button></div></section>
    </div></div>`;
    if(!migrationReady){modalRoot.querySelectorAll(".test-kind").forEach(b=>{if(b.dataset.kind!=="reading")b.disabled=true;});}
    bindModes();bindManual(migrationReady);bindImport(migrationReady);bindClone();
  }

  function bindModes(){
    modalRoot.querySelector("[data-close]").onclick=closeModal;
    const show=mode=>{modalRoot.querySelectorAll(".create-mode").forEach(b=>b.classList.toggle("active",b.dataset.mode===mode));modalRoot.querySelectorAll(".create-mode-panel").forEach(p=>p.hidden=p.dataset.modePanel!==mode);};
    modalRoot.querySelectorAll(".create-mode").forEach(b=>b.onclick=()=>show(b.dataset.mode));
  }
  function bindManual(migrationReady){
    const form=modalRoot.querySelector("#manualTestForm"),kind=form.elements.test_kind,duration=form.elements.duration_minutes,note=modalRoot.querySelector(".kind-note");
    const selectKind=value=>{const cfg=testKindConfig(value);kind.value=value;duration.value=cfg.duration;note.innerHTML=kindNote(value);modalRoot.querySelectorAll(".test-kind").forEach(b=>{const active=b.dataset.kind===value;b.classList.toggle("active",active);b.setAttribute("aria-checked",String(active));});};
    modalRoot.querySelectorAll(".test-kind").forEach(b=>b.onclick=()=>selectKind(b.dataset.kind));
    form.onsubmit=async e=>{e.preventDefault();const fd=new FormData(form),f=Object.fromEntries(fd);if(f.test_kind!=="reading"&&!migrationReady)return toast("Hãy chạy migration V1.18 trước khi tạo Listening/Full Test.",7000);f.class_ids=fd.getAll("class_ids");delete f.class_id;f.duration_minutes=Number(f.duration_minutes);f.max_attempts=Number(f.max_attempts);f.opens_at=toIso(f.opens_at);f.closes_at=toIso(f.closes_at);Object.assign(f,{status:"draft",show_answers_after_submit:fd.has("show_answers_after_submit"),allowed_violations:2});const btn=e.submitter||form.querySelector('button[type="submit"]');btn.disabled=true;btn.textContent="Đang tạo…";try{const {data,error}=await sb.rpc("staff_upsert_test_v120",{p_data:f});if(error)throw error;const id=typeof data==="string"?data:(data?.id||data?.test_id);if(!id)throw new Error("Backend không trả về mã bài kiểm tra.");await createPartsForKind(sb,id,f.test_kind);invalidate();closeModal();toast(`Đã tạo ${testKindLabel(f.test_kind)}`);go(`/test/${id}/authoring`);}catch(err){console.error(err);toast(`Không tạo được bài: ${err.message||err}`,7000);}finally{btn.disabled=false;btn.textContent="Tạo bài nháp";}};
  }

  function bindImport(migrationReady){
    const form=modalRoot.querySelector("#importTestForm"),qInput=modalRoot.querySelector("#importQuestionFile"),aInput=modalRoot.querySelector("#importAnswerFile"),preview=modalRoot.querySelector("#importFilePreview"),detected=modalRoot.querySelector("#importDetectedKind"),actions=modalRoot.querySelector("#importCreateActions"),readyNote=modalRoot.querySelector("#importReadyNote"),analyze=modalRoot.querySelector("#analyzeImportFiles");
    let parsed=null;
    const reset=()=>{parsed=null;actions.hidden=true;detected.value="Chưa đọc file";preview.className="file-drop-preview muted";preview.textContent="Bấm “Đọc file và xem trước” sau khi chọn đủ 2 file.";};
    qInput.onchange=()=>{if(!form.elements.title.value&&qInput.files?.[0])form.elements.title.value=qInput.files[0].name.replace(/\.docx$/i,"");reset();};
    aInput.onchange=reset;
    analyze.onclick=async()=>{
      const qFile=qInput.files?.[0],aFile=aInput.files?.[0];if(!qFile||!aFile)return toast("Hãy chọn đủ file đề Word và file đáp án Excel.",5000);
      analyze.disabled=true;analyze.textContent="Đang đọc file…";preview.textContent="Đang phân tích nội dung đề và ghép đáp án…";
      try{
        parsed=await readToeicImportFiles(qFile,aFile);const kind=inferTestKind(parsed.rows);parsed.kind=kind;
        if(kind!=="reading"&&!migrationReady)throw new Error("Cần migration V1.18 trước khi nhập Listening/Full Test.");
        const cfg=testKindConfig(kind);detected.value=testKindLabel(kind);form.elements.duration_minutes.value=cfg.duration;
        preview.className="file-drop-preview";preview.innerHTML=renderImportPreview(parsed.rows);
        const review=parsed.rows.filter(x=>x.issues.length).length,answers=parsed.rows.filter(x=>x.answer).length;
        readyNote.textContent=`${parsed.rows.length} câu · ${answers} đáp án · ${review} câu cần kiểm tra`;
        actions.hidden=false;
      }catch(err){parsed=null;actions.hidden=true;detected.value="Không xác định";preview.className="file-drop-preview warning-box";preview.textContent=`Không đọc được file: ${err.message||err}`;}
      finally{analyze.disabled=false;analyze.textContent="Đọc file và xem trước";}
    };
    modalRoot.querySelector("#createImportedTest").onclick=async e=>{
      if(!parsed)return toast("Hãy đọc và xem trước file trước.",5000);
      const btn=e.currentTarget,fd=new FormData(form),title=String(fd.get("title")||"").trim();if(!title)return toast("Hãy nhập tên bài.",5000);
      btn.disabled=true;btn.textContent="Đang tạo bài…";
      let testId=null;
      try{
        const f={title,class_ids:fd.getAll("class_ids"),duration_minutes:Number(fd.get("duration_minutes")),max_attempts:Number(fd.get("max_attempts")),anti_cheat_mode:fd.get("anti_cheat_mode"),opens_at:null,closes_at:null,description:"",status:"draft",show_answers_after_submit:fd.has("show_answers_after_submit"),allowed_violations:2,test_kind:parsed.kind};
        const {data,error}=await sb.rpc("staff_upsert_test_v120",{p_data:f});if(error)throw error;testId=typeof data==="string"?data:(data?.id||data?.test_id);if(!testId)throw new Error("Backend không trả về mã bài kiểm tra.");
        await createPartsForKind(sb,testId,parsed.kind);
        btn.textContent="Đang nhập câu hỏi…";
        const result=await importQuestionsIntoTest(sb,testId,parsed.rows,parsed.kind,p=>{btn.textContent=`Đang nhập ${p.done}/${p.total}…`;},parsed.directions);
        invalidate();closeModal();toast(result.failed.length?`Đã tạo bài và nhập ${result.done} câu; ${result.failed.length} câu chưa lưu.`:`Đã tạo bài và nhập ${result.done} câu.`,7000);go(`/test/${testId}/authoring`);
      }catch(err){console.error(err);toast(`Không nhập được đề: ${err.message||err}${testId?" · Bài nháp đã được tạo; có thể mở lại để kiểm tra.":""}`,8000);btn.disabled=false;btn.textContent="Tạo bài và nhập câu hỏi";}
    };
  }

  function bindClone(){
    const form=modalRoot.querySelector("#cloneTestForm"),source=form.elements.source_test_id;
    source.onchange=()=>{const o=source.selectedOptions[0];if(!o?.value)return;form.elements.title.value=`${o.textContent.split(" · ")[0]} - Bản sao`;form.elements.duration_minutes.value=o.dataset.duration||75;form.elements.max_attempts.value=o.dataset.max||1;const selected=(o.dataset.classes||"").split(",").filter(Boolean);Array.from(form.elements.class_ids.options).forEach(x=>x.selected=selected.includes(x.value));};
    form.onsubmit=async e=>{e.preventDefault();const fd=new FormData(form),f=Object.fromEntries(fd),sourceId=f.source_test_id;delete f.source_test_id;f.class_ids=fd.getAll("class_ids");delete f.class_id;f.opens_at=f.opens_at?toIso(f.opens_at):"";f.closes_at=f.closes_at?toIso(f.closes_at):"";const btn=e.submitter||form.querySelector('button[type="submit"]');btn.disabled=true;btn.textContent="Đang nhân bản…";const {data,error}=await sb.rpc("staff_clone_test_v120",{p_source_test_id:sourceId,p_overrides:f});btn.disabled=false;btn.textContent="Tạo bản sao";if(error)return toast(error.message,6000);invalidate();closeModal();toast("Đã tạo bài từ bài kiểm tra cũ");go(`/test/${data}`);};
  }
  function invalidate(){invalidateStaffData("tests");invalidateStaffPage("tests");invalidateStaffPage("teacher");}

  return {open};
}

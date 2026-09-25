import { esc,go,statusBadge,readJSON,writeJSON,removeStorage } from "./modules/utils.js";
import { createExamMedia } from "./exam/exam-media.js";
import { createAnswerQueue } from "./exam/answer-queue.js";
import { createExamResults } from "./exam/exam-results.js";
import { testKindShortLabel } from "./tests/test-kind.js";
import { buildPracticeQuestions } from "./exam/practice-data.js";

export function createExamApp(ctx){
  const {sb,modalRoot,signedUrlMap,toast,closeModal,showLoading,staffNav,getSession,getProfile,getView}=ctx;
  let session=null,profile=null,view=null,examState=null,timerId=null,antiCheat=null;
  const syncRuntime=()=>{session=getSession();profile=getProfile();view=getView();};
  const attemptUiKey=id=>`toeic.attemptUi.${id}`;
  const getExamState=()=>examState;
  const media=createExamMedia({signedUrlMap,getExamState});

  function setSaveStatus(text,cls=""){
    if(examState)examState.saveStatus=text;const el=document.querySelector("#saveStatus");if(el){el.textContent=text;el.className=`save-status ${cls}`;}
  }
  function stopTimer(){clearInterval(timerId);timerId=null;}
  function clearForResult(){stopTimer();examState=null;queue.reset();}
  function resetExamState(){stopTimer();examState=null;queue.reset();media.clear();}
  const queue=createAnswerQueue({sb,getExamState,setSaveStatus,onSubmitted:attemptId=>{antiCheat?.reset();resetExamState();go(`/result/${attemptId}`);}});
  const results=createExamResults({sb,toast,showLoading,staffNav,getView:()=>{syncRuntime();return view;},getAntiCheat:()=>antiCheat,media,clearForResult});

  async function renderStudent(){
    syncRuntime();showLoading();
    const [{data:tests=[],error},{data:attempts=[]}]=await Promise.all([sb.rpc("student_list_tests_v120"),sb.from("attempts").select("*").eq("student_id",session.user.id).order("attempt_no",{ascending:false})]);
    if(error){console.error(error);view.innerHTML=`<section class="card"><h2>Không tải được danh sách bài kiểm tra</h2><p class="muted">${esc(error.message||"Hãy tải lại trang.")}</p></section>`;return;}const byTest={};for(const a of attempts)(byTest[a.test_id]??=[]).push(a);
    view.innerHTML=`<section class="card"><h1>Bài kiểm tra của tôi</h1><p class="muted">${esc(profile.full_name)} · ${esc(profile.student_code||"")}</p></section><section class="grid grid-2 student-tests">${tests.map(t=>{const all=byTest[t.id]||[],valid=all.filter(a=>a.status!=="reset"),inProgress=valid.find(a=>a.status==="in_progress"),latest=inProgress||valid.sort((a,b)=>(b.attempt_no||0)-(a.attempt_no||0))[0],used=valid.length,remaining=Math.max(0,(t.max_attempts||1)-used);let action="";if(inProgress)action=`<a class="btn primary" href="#/exam/${inProgress.id}">Tiếp tục lượt ${inProgress.attempt_no||1}</a>`;else if(remaining>0)action=`<button class="primary start-test" data-id="${t.id}" data-max="${t.max_attempts||1}" data-used="${used}">${used?`Làm lượt ${used+1}`:"Bắt đầu"}</button>${latest?`<a class="btn secondary" href="#/result/${latest.id}">Xem lượt trước</a>`:""}`;else if(latest)action=`<a class="btn secondary" href="#/result/${latest.id}">Xem kết quả</a>`;return `<div class="card"><div class="row between"><div class="row wrap"><span class="badge">${esc((t.class_names||[]).join(", ")||"TOEIC")}</span><span class="badge">${esc(testKindShortLabel(t.test_kind))}</span></div>${latest?statusBadge(latest.status):'<span class="status off">Chưa làm</span>'}</div><h2>${esc(t.title)}</h2><p class="muted">${esc(t.description||"Bài kiểm tra TOEIC")}</p><div class="row wrap"><span>⏱ ${t.duration_minutes} phút</span><span>•</span><span>${used}/${t.max_attempts||1} lượt đã dùng</span>${remaining?`<span>• còn ${remaining}</span>`:""}</div><div class="test-action row wrap">${action}</div></div>`;}).join("")||'<div class="card empty">Hiện chưa có bài kiểm tra được mở.</div>'}</section>`;
    document.querySelectorAll(".start-test").forEach(b=>b.onclick=()=>confirmStart(b.dataset.id,+b.dataset.max||1,+b.dataset.used||0));
  }

  function confirmStart(testId,maxAttempts=1,used=0){
    const nextNo=used+1;modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><h2>Trước khi bắt đầu lượt ${nextNo}</h2><div class="warning-box"><b>Quy định chống gian lận</b><br>Mỗi lần rời màn hình được tính ngay 1 vi phạm. Quay lại trong 15 giây để tiếp tục; quá 15 giây hoặc rời màn hình lần thứ 3, hệ thống tự động nộp bài.</div><p>Bài cho phép tối đa <b>${maxAttempts} lượt</b>. Bạn đã dùng <b>${used}</b> lượt. Đồng hồ bắt đầu ngay khi nhấn Bắt đầu.</p><div class="row between"><button class="secondary" data-close>Hủy</button><button class="primary" id="confirmStart">Bắt đầu lượt ${nextNo}</button></div></div></div>`;
    modalRoot.querySelector("[data-close]").onclick=closeModal;modalRoot.querySelector("#confirmStart").onclick=async()=>{antiCheat?.armAudio();const btn=modalRoot.querySelector("#confirmStart");btn.disabled=true;btn.textContent="Đang bắt đầu…";const {data,error}=await sb.rpc("start_attempt",{p_test_id:testId});if(error){btn.disabled=false;btn.textContent=`Bắt đầu lượt ${nextNo}`;return toast(error.message,6000);}closeModal();try{await document.documentElement.requestFullscreen?.();}catch{}const attemptId=data?.attempt_id||data?.id||data?.attempt?.id;if(!attemptId)return toast("Không nhận được mã lượt làm.");go(`/exam/${attemptId}`);};
  }

  async function renderExam(attemptId,options={}){
    syncRuntime();if(!session||profile?.role!=="student")return go("/login");showLoading("Đang tải bài thi...");const {data,error}=await sb.rpc("get_attempt_payload",{p_attempt_id:attemptId});
    if(error)return view.innerHTML=`<div class="card">${esc(error.message)}</div>`;if(data?.attempt?.status!=="in_progress")return go(`/result/${attemptId}`);
    if(Array.isArray(options.parts)&&options.parts.length){const allowed=new Set(options.parts.map(Number));data.questions=(data.questions||[]).filter(q=>allowed.has(Number(q.part)));if(!data.questions.length)return view.innerHTML='<div class="card">Không có câu hỏi trong phần được chọn.</div>';}
    media.clear();const ui=readJSON(attemptUiKey(attemptId),{current:0});examState={attemptId,payload:data,current:Math.min(ui.current||0,(data.questions?.length||1)-1),saveStatus:"Đã lưu"};queue.merge(attemptId,data.questions||[]);await media.ensureQuestionMedia(data.questions?.[examState.current]);drawExam();antiCheat?.bind();queue.flush();media.prefetchQuestion(examState.current+1);
  }

  async function renderStaffPreview(testId,options={}){
    syncRuntime();showLoading("Đang mở chế độ làm thử...");const {data:start,error:startError}=await sb.rpc("staff_start_practice_attempt",{p_test_id:testId});if(startError)return view.innerHTML=`<div class="card"><a href="#/test/${testId}">← Quay lại</a><p>${esc(startError.message)}</p></div>`;const practiceId=start?.attempt_id;
    const [{data,error},{data:practice,error:practiceError}]=await Promise.all([sb.rpc("get_test_authoring",{p_test_id:testId}),sb.rpc("staff_get_practice_attempt",{p_attempt_id:practiceId})]);if(error||practiceError)return view.innerHTML=`<div class="card"><a href="#/test/${testId}">← Quay lại</a><p>${esc((error||practiceError).message)}</p></div>`;
    const t=data?.test||{},questions=buildPracticeQuestions(data,practice?.answers||[],options.parts);if(!questions.length)return view.innerHTML=`<div class="card"><a href="#/test/${testId}">← Quay lại</a><h2>${esc(t.title||"Bài kiểm tra")}</h2><p>Chưa có câu hỏi để làm thử.</p></div>`;if(practice?.attempt?.status!=="in_progress")return results.renderStoredPracticeResult(testId,practiceId,questions,practice.attempt);
    media.clear();const ui=readJSON(attemptUiKey(practiceId),{current:0});examState={attemptId:practiceId,preview:true,persistedPractice:true,testId,payload:{test:t,questions,attempt:{...practice.attempt,anti_cheat_mode:"off",violation_count:0,allowed_violations:0}},current:Math.min(ui.current||0,questions.length-1),saveStatus:start?.resumed?"Đã phục hồi lượt làm thử":"Lượt làm thử đã được lưu",resultAllQuestions:Array.isArray(options.parts)&&options.parts.length>0};await media.ensureQuestionMedia(questions[examState.current]);drawExam();media.prefetchQuestion(examState.current+1);
  }

  async function renderStaffPracticeResult(testId,attemptId){
    syncRuntime();showLoading("Đang tải kết quả làm thử...");const [{data,error},{data:practice,error:practiceError}]=await Promise.all([sb.rpc("get_test_authoring",{p_test_id:testId}),sb.rpc("staff_get_practice_attempt",{p_attempt_id:attemptId})]);if(error||practiceError)return view.innerHTML=`<div class="card"><a href="#/test/${testId}/practice">← Quay lại</a><p>${esc((error||practiceError).message)}</p></div>`;results.renderStoredPracticeResult(testId,attemptId,buildPracticeQuestions(data,practice?.answers||[]),practice?.attempt||{});
  }

  async function showQuestion(index){
    if(!examState||index<0||index>=examState.payload.questions.length)return;examState.current=index;saveAttemptUi();const q=examState.payload.questions[index];if(!q._mediaHydrated)await media.ensureQuestionMedia(q);if(!examState||examState.current!==index)return;drawExam();media.prefetchQuestion(index+1);
  }
  function saveAttemptUi(){if(examState)writeJSON(attemptUiKey(examState.attemptId),{current:examState.current,updated_at:Date.now()});}

  function drawExam(){
    if(!examState)return;syncRuntime();const {payload,current}=examState,q=payload.questions[current],a=payload.attempt;if(!q)return view.innerHTML='<div class="card">Không có câu hỏi.</div>';
    const antiText=examState.preview?"Giảng viên làm thử · lưu lịch sử riêng, không tính vào kết quả sinh viên":a.anti_cheat_mode==="off"?"Chống gian lận: Tắt":a.anti_cheat_mode==="strict"?`Vi phạm: ${a.violation_count||0}/1 · rời màn hình tính ngay`:`Vi phạm: ${a.violation_count||0}/3 · rời màn hình tính ngay · quá 15 giây hoặc lần 3 sẽ tự nộp`;
    saveAttemptUi();view.innerHTML=`${examState.preview?`<section class="card preview-banner"><div class="row between wrap"><div><b>Chế độ làm thử</b><div class="muted">Giao diện như sinh viên · tự lưu trong lịch sử riêng của giảng viên</div></div><a class="btn secondary" href="#/test/${examState.testId}/practice">← Thoát làm thử</a></div></section>`:""}<section class="exam-layout"><div class="exam-main"><div class="card"><div class="row between wrap"><div><b>Part ${q.part}</b><div class="muted">Câu ${q.number} · ${current+1}/${payload.questions.length}</div></div><div class="exam-status"><span id="saveStatus" class="save-status">${esc(examState.saveStatus||"Đã lưu")}</span><div id="timer" class="timer"></div></div></div></div>${(q.stimuli||[]).map(s=>`<div class="stimulus">${media.renderMedia(s.type,s.url,s.content)}</div>`).join("")}<div class="card question">${media.renderMedia(q.media_type,q.url,null)}<div class="question-title"><b>${q.number}.</b><div class="rich-content">${media.renderRichText(q.content||"")}</div></div>${(q.choices||[]).map(c=>`<label class="choice"><input type="radio" name="choice" value="${c.key}" ${q.selected===c.key?"checked":""}><b>${c.key}.</b><div class="choice-body">${media.renderMedia(c.media_type,c.url,null,"choice-media")}<div class="rich-content">${media.renderRichText(c.content||"")}</div></div></label>`).join("")}<div class="divider"></div><label class="review-label"><input id="markReview" type="checkbox" ${q.marked?"checked":""}> Đánh dấu xem lại</label></div><div class="exam-toolbar"><button class="secondary" id="prevBtn" ${current===0?"disabled":""}>← Câu trước</button><button class="secondary" id="nextBtn" ${current===payload.questions.length-1?"disabled":""}>Câu sau →</button></div></div><aside class="exam-side"><div class="card sticky"><div class="row between"><b>Câu hỏi</b><span class="muted">${payload.questions.filter(x=>x.selected).length}/${payload.questions.length}</span></div><div class="palette">${payload.questions.map((x,i)=>`<button class="qbtn ${x.selected?"done":""} ${x.marked?"review":""} ${i===current?"current":""}" data-i="${i}">${x.number}</button>`).join("")}</div><button class="${examState.preview?"primary":"danger"} full" id="submitBtn">${examState.preview?"Kết thúc làm thử":"Nộp bài"}</button>${examState.preview?"":'<button class="secondary full" id="fullscreenBtn" type="button">⛶ Toàn màn hình</button>'}<p id="antiCheatStatus" class="muted small">${esc(antiText)}</p></div></aside></section>`;
    document.querySelectorAll(".qbtn").forEach(b=>b.onclick=()=>showQuestion(+b.dataset.i));document.querySelector("#prevBtn").onclick=()=>showQuestion(examState.current-1);document.querySelector("#nextBtn").onclick=()=>showQuestion(examState.current+1);document.querySelectorAll('input[name="choice"]').forEach(r=>r.onchange=()=>saveCurrent(r.value));document.querySelector("#markReview").onchange=e=>saveCurrent(q.selected,e.target.checked);document.querySelector("#submitBtn").onclick=confirmSubmit;
    const fullscreenBtn=document.querySelector("#fullscreenBtn");if(fullscreenBtn)fullscreenBtn.onclick=async()=>{saveAttemptUi();queue.flush();try{await document.documentElement.requestFullscreen?.();}catch{}};stopTimer();updateTimer();timerId=setInterval(updateTimer,1000);
  }

  async function saveCurrent(choice,marked=document.querySelector("#markReview")?.checked||false){
    if(!examState)return;const q=examState.payload.questions[examState.current];q.marked=marked;
    if(examState.preview){if(choice)q.selected=choice;drawPaletteOnly();setSaveStatus("Đang lưu…","pending");const state=examState,previous=state.pendingSave||Promise.resolve(),saveTask=previous.then(()=>sb.rpc("staff_save_practice_answer",{p_attempt_id:state.attemptId,p_question_id:q.id,p_choice:choice||null,p_marked:marked})).then(result=>{if(result.error)throw result.error;return result;}),settled=saveTask.then(result=>({result}),error=>({error}));state.pendingSave=settled;const outcome=await settled;if(outcome.error){if(examState===state)setSaveStatus(`Chưa lưu: ${outcome.error.message}`,"offline");}else if(examState===state)setSaveStatus("Đã lưu","saved");if(state.pendingSave===settled)state.pendingSave=null;return;}
    if(choice)q.selected=choice;queue.enqueue(examState.attemptId,{client_event_id:crypto.randomUUID(),question_id:q.id,choice:choice||null,marked,created_at:Date.now()});setSaveStatus(navigator.onLine?"Đang lưu…":"Mất mạng – đã lưu tạm",navigator.onLine?"pending":"offline");drawPaletteOnly();queue.flush();
  }
  function drawPaletteOnly(){const side=document.querySelector(".exam-side");if(!side||!examState)return;side.querySelectorAll(".qbtn").forEach((b,i)=>{const x=examState.payload.questions[i];b.classList.toggle("done",!!x.selected);b.classList.toggle("review",!!x.marked);});}

  function updateTimer(){
    if(!examState)return;const left=Math.max(0,new Date(examState.payload.attempt.expires_at)-Date.now()),el=document.querySelector("#timer");if(!el)return;const s=Math.floor(left/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),ss=s%60;el.textContent=`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;el.classList.toggle("danger-text",s<300);
    if(left<=0){stopTimer();if(examState.preview)renderPreviewResult("expired");else{const id=examState.attemptId;antiCheat?.reset();resetExamState();go(`/result/${id}`);}}
  }

  function confirmSubmit(){
    if(examState?.preview){modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><h2>Kết thúc làm thử?</h2><p>Thầy đã trả lời <b>${examState.payload.questions.filter(x=>x.selected).length}/${examState.payload.questions.length}</b> câu. Kết quả sẽ được lưu vào lịch sử làm thử riêng.</p><div class="row between"><button class="secondary" data-close>Tiếp tục làm</button><button class="primary" id="finishPreview">Xem kết quả thử</button></div></div></div>`;modalRoot.querySelector("[data-close]").onclick=closeModal;modalRoot.querySelector("#finishPreview").onclick=()=>{closeModal();renderPreviewResult("submitted")};return;}
    modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><h2>Nộp bài?</h2><p>Bạn đã trả lời <b>${examState.payload.questions.filter(x=>x.selected).length}/${examState.payload.questions.length}</b> câu.</p><div class="row between"><button class="secondary" data-close>Tiếp tục làm</button><button class="danger" id="doSubmit">Nộp bài</button></div></div></div>`;modalRoot.querySelector("[data-close]").onclick=closeModal;
    modalRoot.querySelector("#doSubmit").onclick=async()=>{if(queue.read(examState.attemptId).length){await queue.flush();if(queue.read(examState.attemptId).length)return toast("Còn đáp án chưa đồng bộ. Hãy chờ mạng ổn định trước khi nộp.",6000);}const {error}=await sb.rpc("submit_attempt",{p_attempt_id:examState.attemptId});if(error)return toast(error.message);const id=examState.attemptId;removeStorage(queue.queueKey(id));removeStorage(attemptUiKey(id));antiCheat?.reset();resetExamState();closeModal();go(`/result/${id}`);};
  }

  async function renderPreviewResult(status="submitted"){
    if(!examState?.preview)return;stopTimer();if(examState.pendingSave)await examState.pendingSave;const {questions}=examState.payload,testId=examState.testId,attemptId=examState.attemptId,resultAllQuestions=!!examState.resultAllQuestions,{data,error}=await sb.rpc("staff_finish_practice_attempt",{p_attempt_id:attemptId,p_status:status});if(error)return toast(error.message,6000);removeStorage(attemptUiKey(attemptId));history.replaceState({practiceResult:true},"",`#/practice-result/${testId}/${attemptId}`);if(resultAllQuestions){resetExamState();return renderStaffPracticeResult(testId,attemptId);}results.renderStoredPracticeResult(testId,attemptId,questions,{...data,status});
  }

  function setAntiCheat(controller){antiCheat=controller;}
  function setViolationCount(count){if(examState?.payload?.attempt)examState.payload.attempt.violation_count=count;}

  return {renderStudent,renderExam,renderStaffPreview,renderStaffPracticeResult,renderResult:results.renderResult,saveAttemptUi,flushAnswerQueue:queue.flush,setSaveStatus,setAntiCheat,getExamState,setViolationCount,stopTimer,resetExamState};
}

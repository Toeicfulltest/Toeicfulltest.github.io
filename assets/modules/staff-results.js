import { loadXlsx } from "../services/xlsx-service.js";
import { formatScore10,scoreOutOfTen } from "./score-utils.js";

export function createStaffResultsController({sb,esc,fmt,statusBadge,toast,getWorkspace,setLiveChannel,clearLiveChannel,refreshCurrentTest}){
  const classOptions=(classes,selected="")=>`<option value="">Tất cả lớp</option>${(classes||[]).map(c=>`<option value="${c.id}" ${c.id===selected?"selected":""}>${esc(c.name)}</option>`).join("")}`;
  const rowInClass=(row,classId)=>!classId||(row.class_ids||[]).includes(classId);

  async function renderPracticeTab(testId){
    const root=document.querySelector("#practiceRoot"); if(!root) return;
    const {data,error}=await sb.rpc("staff_list_practice_attempts",{p_test_id:testId});
    if(error) return root.innerHTML=`<div class="warning-box">${esc(error.message)}</div>`;
    const rows=data||[],open=rows.find(x=>x.status==="in_progress");
    root.innerHTML=`<div class="row between wrap"><div><h2>Làm thử như sinh viên</h2><p class="muted">Mỗi đáp án được lưu vào khu vực riêng của giảng viên, không xuất hiện trong LIVE hoặc kết quả lớp.</p></div><a class="btn primary" href="#/preview/${testId}">${open?"Tiếp tục lượt đang làm":"Bắt đầu lượt làm thử"}</a></div>
    <div class="table-wrap"><table><thead><tr><th>Lượt</th><th>Trạng thái</th><th>Đã trả lời</th><th>Số câu đúng</th><th>Điểm /10</th><th>Bắt đầu</th><th>Kết thúc</th><th></th></tr></thead>
    <tbody>${rows.map((x,i)=>`<tr><td>${rows.length-i}</td><td>${x.status==="in_progress"?'<span class="status warn">Đang làm</span>':x.status==="expired"?'<span class="status off">Hết giờ</span>':'<span class="status ok">Đã nộp</span>'}</td><td>${x.answered_count||0}/${x.total_questions||0}</td><td>${x.correct_count==null?"—":`${x.correct_count}/${x.total_questions}`}</td><td>${x.correct_count==null?"—":formatScore10(x.correct_count,x.total_questions)}</td><td>${fmt(x.started_at)}</td><td>${fmt(x.submitted_at)}</td><td>${x.status==="in_progress"?`<a class="btn primary sm" href="#/preview/${testId}">Tiếp tục</a>`:`<a class="btn secondary sm" href="#/practice-result/${testId}/${x.id}">Xem</a>`}</td></tr>`).join("")||'<tr><td colspan="8" class="empty">Chưa có lượt làm thử.</td></tr>'}</tbody></table></div>`;
  }

  function liveRow(r,totalQuestions=100){
    let remain="—";
    if(r.status==="in_progress"&&r.expires_at){const sec=Math.max(0,Math.floor((new Date(r.expires_at)-Date.now())/1000));remain=`${Math.floor(sec/60)}:${String(sec%60).padStart(2,"0")}`;}
    const st=!r.attempt_id?"Chưa làm":r.status==="in_progress"?"Đang làm":r.status==="auto_submitted"?"Tự nộp":"Đã nộp";
    return `<tr data-status="${esc(r.status||"none")}"><td>${(r.attempt_id&&r.status!=="in_progress")?`<a href="#/result/${r.attempt_id}">${esc(r.full_name)}</a>`:esc(r.full_name)}</td><td>${esc(r.student_code||"—")}</td><td>${esc((r.class_names||[]).join(", ")||"—")}</td><td>${r.attempt_no||"—"}</td><td>${st}</td><td>${r.answered_count||0}</td><td>${fmt(r.started_at)}</td><td>${remain}</td><td>${r.violation_count||0}</td><td>${r.correct_count==null?"—":formatScore10(r.correct_count,totalQuestions)}</td></tr>`;
  }

  async function renderLiveTab(testId){
    let trackedAttemptIds=new Set(),refreshTimer=null,lastRefreshAt=0,loading=false,queued=false;
    const load=async()=>{
      if(loading){queued=true;return;}
      loading=true;
      try{
        const {data,error}=await sb.rpc("staff_get_test_live_v122",{p_test_id:testId});
        const root=document.querySelector("#liveRoot"); if(!root) return;
        if(error) return root.innerHTML=`<div class="warning-box">${esc(error.message)}</div>`;
        const rows=data.rows||[],classes=data.classes||[],workspace=getWorkspace(),totalQuestions=Number(data.total_questions)||workspace?.questionCount||workspace?.qs?.length||100,classFilter=workspace?.liveClassFilter||"",classRows=rows.filter(r=>rowInClass(r,classFilter));
        trackedAttemptIds=new Set(rows.map(r=>r.attempt_id).filter(Boolean));
        const counts={roster:classRows.length,attempts:classRows.reduce((n,r)=>n+Number(r.attempts_used||0),0),in:classRows.filter(r=>r.status==="in_progress").length,done:classRows.filter(r=>["submitted","auto_submitted"].includes(r.status)).length,none:classRows.filter(r=>!r.attempt_id).length,viol:classRows.filter(r=>(r.violation_count||0)>0).length};
        root.innerHTML=`<div class="row between wrap"><div><h2>LIVE</h2><p class="muted">Tự cập nhật khi sinh viên làm bài. Có thể lọc riêng từng lớp.</p></div><div class="row wrap"><label>Lớp<select id="liveClassFilter">${classOptions(classes,classFilter)}</select></label><button class="secondary" id="liveExcel">↓ Excel hiện tại</button></div></div>
        <div class="live-kpis">${[["Sĩ số",counts.roster],["Lượt thi",counts.attempts],["Đang làm",counts.in],["Đã nộp",counts.done],["Chưa vào",counts.none],["Có vi phạm",counts.viol]].map(([a,b])=>`<div><span>${a}</span><b>${b}</b></div>`).join("")}</div>
        <div class="row wrap live-filters">${["all","in_progress","done","none","viol"].map(k=>`<button class="${(getWorkspace()?.liveFilter||"all")===k?"primary":"secondary"} sm live-filter" data-filter="${k}">${({all:"Tất cả",in_progress:"Đang làm",done:"Đã nộp",none:"Chưa làm",viol:"Có vi phạm"})[k]}</button>`).join("")}</div>
        <div class="table-wrap"><table id="liveTable"><thead><tr><th>Họ tên</th><th>MSSV</th><th>Lớp</th><th>Lượt</th><th>Trạng thái</th><th>Tiến độ</th><th>Bắt đầu</th><th>Còn lại</th><th>Vi phạm</th><th>Điểm /10</th></tr></thead><tbody>${classRows.map(r=>liveRow(r,totalQuestions)).join("")||`<tr><td colspan="10" class="empty">Lớp chưa có sinh viên.</td></tr>`}</tbody></table></div>`;
        document.querySelector("#liveExcel").onclick=()=>exportTestExcel(testId,document.querySelector("#liveClassFilter")?.value||"");
        document.querySelector("#liveClassFilter").onchange=e=>{const w=getWorkspace();if(w?.id===testId)w.liveClassFilter=e.target.value;load();};
        const applyLiveFilter=f=>{const w=getWorkspace();if(w?.id===testId)w.liveFilter=f;document.querySelectorAll(".live-filter").forEach(x=>x.className=`${x.dataset.filter===f?"primary":"secondary"} sm live-filter`);document.querySelector("#liveTable tbody").innerHTML=classRows.filter(r=>f==="all"||(f==="in_progress"&&r.status==="in_progress")||(f==="done"&&["submitted","auto_submitted"].includes(r.status))||(f==="none"&&!r.attempt_id)||(f==="viol"&&(r.violation_count||0)>0)).map(r=>liveRow(r,totalQuestions)).join("")||`<tr><td colspan="10" class="empty">Không có dữ liệu.</td></tr>`;};
        document.querySelectorAll(".live-filter").forEach(btn=>btn.onclick=()=>applyLiveFilter(btn.dataset.filter));applyLiveFilter(getWorkspace()?.liveFilter||"all");
      }finally{
        lastRefreshAt=Date.now();loading=false;
        if(queued){queued=false;scheduleRefresh();}
      }
    };
    const scheduleRefresh=()=>{
      if(refreshTimer)return;
      const wait=Math.max(0,2000-(Date.now()-lastRefreshAt));
      refreshTimer=setTimeout(async()=>{refreshTimer=null;await load();},wait);
    };
    const relatedAttemptEvent=payload=>{
      const attemptId=payload?.new?.attempt_id||payload?.old?.attempt_id;
      if(attemptId&&trackedAttemptIds.has(attemptId))scheduleRefresh();
    };
    await load();
    clearLiveChannel();
    const channel=sb.channel(`test-live-${testId}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"attempts",filter:`test_id=eq.${testId}`},scheduleRefresh)
      .on("postgres_changes",{event:"*",schema:"public",table:"answers"},relatedAttemptEvent)
      .on("postgres_changes",{event:"*",schema:"public",table:"anti_cheat_events"},relatedAttemptEvent)
      .subscribe();
    setLiveChannel(channel);
  }

  function submissionActions(r){
    if(!r.attempt_id) return ""; const viewBtn=r.status==="in_progress"?"":`<a class="btn secondary sm" href="#/result/${r.attempt_id}">Xem</a>`; const delBtn=`<button class="danger sm delete-attempt" data-id="${r.attempt_id}" data-name="${esc(r.full_name)}">Xóa</button>`;
    if(r.status==="reset") return `<div class="row wrap">${viewBtn}<span class="status off">Đã reset</span>${delBtn}</div>`;
    return `<div class="row wrap">${viewBtn}<button class="ghost sm reset-attempt" data-id="${r.attempt_id}" data-name="${esc(r.full_name)}">Reset lượt</button>${delBtn}</div>`;
  }

  async function renderSubmissionsTab(testId,{force=false}={}){
    const root=document.querySelector("#submissionsRoot"); if(!root)return;
    const workspace=getWorkspace();
    let data=workspace?.submissionData||null;
    if(force||!data){
      const res=await sb.rpc("staff_get_test_submissions_v121",{p_test_id:testId});
      if(res.error)return root.innerHTML=`<div class="warning-box">${esc(res.error.message)}</div>`;
      data=res.data||{};
      if(workspace?.id===testId)workspace.submissionData=data;
    }
    const classes=data.classes||[],classFilter=workspace?.submissionClassFilter||"",rows=(data.students||[]).filter(r=>!classFilter||r.class_id===classFilter),className=classes.find(c=>c.id===classFilter)?.name||"tất cả lớp",totalQuestions=Number(data.total_questions)||100;
    root.innerHTML=`<div class="row between wrap"><div><h2>Bài làm sinh viên</h2><p class="muted">Xem từng lượt, lọc theo lớp, reset để cho làm lại hoặc xóa lượt.</p></div><div class="row wrap"><label>Lớp<select id="submissionClassFilter">${classOptions(classes,classFilter)}</select></label><button class="primary" id="subExcel">↓ Excel ${esc(className)}</button></div></div>
    <div class="table-wrap"><table><thead><tr><th>Họ tên</th><th>MSSV</th><th>Lớp</th><th>Lần</th><th>Trạng thái</th><th>Bắt đầu</th><th>Nộp</th><th>Đúng</th><th>Điểm /10</th><th>Vi phạm</th><th>Thao tác</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.full_name)}</td><td>${esc(r.student_code||"—")}</td><td>${esc(r.class_name||"—")}</td><td>${r.attempt_no||"—"}</td><td>${r.attempt_id?statusBadge(r.status):'<span class="status off">Chưa làm</span>'}</td><td>${fmt(r.started_at)}</td><td>${fmt(r.submitted_at)}</td><td>${r.correct_count??"—"}</td><td>${r.correct_count==null?"—":formatScore10(r.correct_count,totalQuestions)}</td><td>${r.violation_count||0}</td><td>${submissionActions(r)}</td></tr>`).join("")||'<tr><td colspan="11" class="empty">Chưa có lượt làm nào.</td></tr>'}</tbody></table></div>`;
    document.querySelector("#submissionClassFilter").onchange=e=>{const w=getWorkspace();if(w?.id===testId)w.submissionClassFilter=e.target.value;renderSubmissionsTab(testId);};
    document.querySelector("#subExcel").onclick=()=>exportTestExcel(testId,document.querySelector("#submissionClassFilter")?.value||"");document.querySelectorAll(".reset-attempt").forEach(b=>b.onclick=()=>confirmAttemptAction("reset",testId,b.dataset.id,b.dataset.name));document.querySelectorAll(".delete-attempt").forEach(b=>b.onclick=()=>confirmAttemptAction("delete",testId,b.dataset.id,b.dataset.name));
  }

  async function confirmAttemptAction(action,testId,attemptId,name){
    const isDelete=action==="delete",modalRoot=document.querySelector("#modalRoot");modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><h2>${isDelete?"Xóa bài làm":"Reset lượt làm"}?</h2><p><b>${esc(name||"Sinh viên")}</b></p><div class="warning-box">${isDelete?"Bài làm, câu trả lời và sự kiện chống gian lận của lượt này sẽ bị xóa. Sinh viên có thể làm lại nếu còn lượt.":"Lượt cũ vẫn được giữ để đối soát nhưng chuyển trạng thái Reset; sinh viên được phép bắt đầu lượt mới."}</div><div class="row between"><button class="secondary" data-close>Hủy</button><button class="${isDelete?"danger":"primary"}" id="doAttemptAction">${isDelete?"Xóa bài làm":"Reset lượt"}</button></div></div></div>`;
    const close=()=>modalRoot.innerHTML="";modalRoot.querySelector("[data-close]").onclick=close;modalRoot.querySelector("#doAttemptAction").onclick=async()=>{const fn=isDelete?"staff_delete_attempt":"staff_reset_attempt";const {data:result,error}=await sb.rpc(fn,{p_attempt_id:attemptId});if(error)return toast(error.message,6000);close();if(isDelete){toast(result?.content_unlocked?"Đã xóa bài làm · đề đã được mở khóa":"Đã xóa bài làm");await refreshCurrentTest(testId,"submissions");return;}toast("Đã reset lượt làm");const w=getWorkspace();if(w?.id===testId){w.loaded.submissions=false;w.loaded.live=false;w.submissionData=null;}clearLiveChannel();await renderSubmissionsTab(testId,{force:true});};
  }

  async function exportTestExcel(testId,classId=""){
    toast("Đang tạo Excel…");
    let XLSX;
    try{ XLSX=await loadXlsx(); }catch(err){ console.error(err); return toast("Không tải được thư viện Excel. Hãy kiểm tra mạng và thử lại.",6000); }
    const {data,error}=await sb.rpc("staff_get_test_export_v120",{p_test_id:testId});if(error)return toast(error.message,6000);
    const classes=data.classes||[],classInfo=classes.find(c=>c.id===classId),students=(data.students||[]).filter(s=>!classId||s.class_id===classId),rosterRows=(data.roster||[]).filter(r=>!classId||(r.class_ids||[]).includes(classId)),resetRows=(data.reset_history||[]).filter(r=>!classId||r.class_id===classId);
    const summary=students.map((s,i)=>({STT:i+1,"Họ tên":s.full_name,MSSV:s.student_code||"",Lớp:s.class_name||"","Lần làm":s.attempt_no||"","Trạng thái":s.status||"Chưa làm","Bắt đầu":s.started_at?new Date(s.started_at).toLocaleString("vi-VN"):"","Nộp bài":s.submitted_at?new Date(s.submitted_at).toLocaleString("vi-VN"):"","Số câu đúng":s.correct_count??"","Điểm /10":s.correct_count==null?"":scoreOutOfTen(s.correct_count,(s.answers||[]).length||100),"Vi phạm":s.violation_count||0,"Lý do nộp":s.submission_reason||""}));
    const detail=[];for(const s of students)for(const a of s.answers||[])detail.push({"Họ tên":s.full_name,MSSV:s.student_code||"",Lớp:s.class_name||"","Lần làm":s.attempt_no||"","Câu":a.number,"Đã chọn":a.selected||"","Đáp án":a.correct||"","Đúng/Sai":a.is_correct?"Đúng":"Sai"});
    const violations=[];for(const s of students)for(const v of s.violations||[])violations.push({"Họ tên":s.full_name,MSSV:s.student_code||"",Lớp:s.class_name||"","Lần làm":s.attempt_no||"","Sự kiện":v.event_type,"Lần":v.violation_number,"Thời điểm":new Date(v.occurred_at).toLocaleString("vi-VN")});
    const roster=rosterRows.map((r,i)=>({STT:i+1,"Họ tên":r.full_name,MSSV:r.student_code||"",Lớp:classId?(classInfo?.name||""):(r.class_names||[]).join(", "),Email:r.email||"","Trạng thái":r.is_active?"Hoạt động":"Khóa"}));const resetHistory=resetRows.map(r=>({"Họ tên":r.full_name,MSSV:r.student_code||"",Lớp:r.class_name||"","Lần làm":r.attempt_no||"","Trạng thái":r.status,"Bắt đầu":r.started_at?new Date(r.started_at).toLocaleString("vi-VN"):"","Kết thúc":r.submitted_at?new Date(r.submitted_at).toLocaleString("vi-VN"):"","Lý do":r.submission_reason||""}));
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(summary),"Tong_hop");XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(detail),"Chi_tiet");XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(violations),"Vi_pham");XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(roster),"Danh_sach_lop");if(resetHistory.length)XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(resetHistory),"Lich_su_reset");const safe=(data.test?.title||"ket-qua").replace(/[\\/:*?"<>|]+/g,"-"),classSuffix=classInfo?`-${String(classInfo.name).replace(/[\\/:*?"<>|]+/g,"-")}`:"";XLSX.writeFile(wb,`${safe}${classSuffix}.xlsx`);toast(classInfo?`Đã tạo Excel lớp ${classInfo.name}`:"Đã tạo file Excel tất cả lớp");
  }
  return {renderPracticeTab,renderLiveTab,renderSubmissionsTab,exportTestExcel};
}

import { esc } from "./utils.js";
import { plainText,renderRichText } from "./rich-editor.js";

function mediaBlock(item){
  if(!item) return "";
  if(item.media_type==="image" && item.url) return `<div class="author-stimulus-media"><img src="${esc(item.url)}" alt="Hình minh họa"></div>`;
  if(item.media_type==="audio" && item.url) return `<div class="author-stimulus-media"><audio controls preload="metadata" src="${esc(item.url)}"></audio></div>`;
  if(item.content) return `<div class="rich-content">${renderRichText(item.content)}</div>`;
  return item.storage_path?`<div class="muted small">Media: ${esc(item.media_type||"file")}</div>`:"";
}

function questionHasIssue(q){
  const choices=q.choices||[],partNo=Number(q.part_no),expected=partNo===2?3:4;
  const missingChoiceContent=partNo>=3&&choices.some(c=>!plainText(c.content||"")&&!c.storage_path);
  return !q.correct_choice_key || choices.length!==expected || missingChoiceContent || (!plainText(q.content||"")&&!q.storage_path&&partNo===5);
}

function questionRow(q,locked=false){
  const media=q.storage_path?(q.media_type==="audio"?" 🔊":" 🖼"):"";
  const search=esc(`${q.source_number} ${plainText(q.content||"")} ${(q.choices||[]).map(c=>plainText(c.content||"")).join(" ")}`.toLowerCase());
  const choices=(q.choices||[]).slice().sort((a,b)=>String(a.key).localeCompare(String(b.key)));
  const bankAction=Number(q.part_no)===5?`<button class="ghost sm bank-add-question" data-id="${q.id}">+ Ngân hàng</button>`:"";
  const editActions=locked?"":`<button class="secondary sm add-question-after" data-part="${q.test_part_id}" data-partno="${q.part_no}" data-after="${q.source_number}" data-group="${q.stimulus_group_id||""}">+ Thêm sau</button><button class="secondary sm edit-question" data-id="${q.id}">Sửa</button><button class="ghost sm duplicate-question" data-id="${q.id}">Nhân bản</button><button class="danger sm delete-question" data-id="${q.id}" data-number="${q.source_number}">Xóa</button>`;
  return `<div class="question-author-row author-question" id="author-q-${q.source_number}" data-number="${q.source_number}" data-search="${search}">
    <div class="author-question-content author-question-card">
      <div class="author-question-title"><b>Câu ${q.source_number}</b>${media}${questionHasIssue(q)?'<span class="status warn">Cần kiểm tra</span>':''}</div>
      ${q.url?mediaBlock(q):""}
      ${q.content?`<div class="rich-content">${renderRichText(q.content)}</div>`:'<div class="muted">(không có nội dung chữ)</div>'}
      <div class="author-choice-list">${choices.map(c=>`<div class="author-choice ${c.key===q.correct_choice_key?"correct":""}"><div class="author-choice-key">${esc(c.key)}</div><div>${c.content?`<div class="rich-content compact">${renderRichText(c.content)}</div>`:""}${c.url?mediaBlock(c):""}</div></div>`).join("")||'<div class="muted">Chưa có phương án trả lời.</div>'}</div>
      <div class="muted small">Đáp án đúng: <b>${esc(q.correct_choice_key||"—")}</b></div>
    </div>
    ${(bankAction||editActions)?`<div class="row wrap question-actions">${bankAction}${editActions}</div>`:""}
  </div>`;
}

function groupQuestions(group,questions){ return questions.filter(q=>q.stimulus_group_id===group.id); }

export function renderAuthoringMarkup(id,parts,questions,groups,draft,locked=false){
  const issueCount=questions.filter(questionHasIssue).length;
  return `<section class="card authoring">
    <div class="row between wrap">
      <div><h2>Soạn đề</h2><p class="muted">Nội dung đề hiển thị đầy đủ để rà trực tiếp; sửa tại chỗ bằng nút Sửa.</p></div>
      <div class="authoring-top-actions"><span id="draftStatus" class="muted">${locked?"Đề đã khóa":draft?"Có bản nháp":"Đã đồng bộ"}</span>${(!locked&&draft)?'<button class="secondary sm" id="restoreDraft">Khôi phục nháp</button><button class="ghost sm" id="discardDraft">Bỏ nháp</button>':""}${locked?'<button class="secondary sm" type="button" disabled>🧩 Tạo từ ngân hàng</button>':'<button class="primary sm" type="button" id="generateFromBank">🧩 Tạo từ ngân hàng</button>'}</div>
    </div>
    ${locked?'<div class="lock-banner"><b>🔒 Không thể sửa nội dung</b><span>Đề đã khóa từ khi sinh viên đầu tiên bắt đầu. Nếu xóa hết lượt làm thật, hệ thống có thể mở khóa lại theo quy tắc quản trị.</span></div>':""}
    <div class="authoring-tools">
      <label class="author-search">Tìm trong đề<input id="authorSearch" type="search" placeholder="Số câu, nội dung, tên nhóm…" spellcheck="true" lang="en"></label>
      <div class="row wrap"><button type="button" class="secondary sm" id="expandAuthoring">Mở tất cả</button><button type="button" class="ghost sm" id="collapseAuthoring">Thu gọn tất cả</button></div>
    </div>
    <div class="authoring-note">Kiểm tra chính tả cơ bản dùng trực tiếp công cụ của trình duyệt trong các ô soạn tiếng Anh; không gọi AI/API.</div>
    <div id="authorNoResults" class="empty" hidden>Không tìm thấy nội dung phù hợp.</div>
    <div class="authoring-shell"><div class="authoring-main">
      ${parts.map(p=>{
        const pGroups=groups.filter(g=>g.part_no===p.part_no),pQs=questions.filter(q=>q.part_no===p.part_no);
        return `<details class="part-editor author-part" data-search="part ${p.part_no} ${esc(p.title||"").toLowerCase()}" open>
          <summary><div class="row between wrap"><div><h3>${esc(p.title)}</h3><span class="muted">${pQs.length} câu · ${pGroups.length} nhóm nội dung</span></div><div class="row wrap">${locked?"":`<button class="secondary sm add-group" data-part="${p.id}" data-partno="${p.part_no}">+ Nhóm nội dung</button><button class="primary sm add-question" data-part="${p.id}" data-partno="${p.part_no}">+ Câu hỏi</button>`}</div></div></summary>
          <div class="part-editor-body">
          ${pGroups.map(g=>{const gQs=groupQuestions(g,pQs);const nums=gQs.map(q=>Number(q.source_number)).filter(Number.isFinite).sort((a,b)=>a-b);const range=nums.length?(nums.length===1?`Câu ${nums[0]}`:`Câu ${nums[0]}–${nums.at(-1)}`):"Chưa có câu";const bankAction=[6,7].includes(Number(g.part_no))?`<button class="ghost sm bank-add-group" data-id="${g.id}">+ Ngân hàng</button>`:"";const editActions=locked?"":`<button class="ghost sm add-stimulus" data-group="${g.id}">+ Nội dung chung</button><button class="ghost sm edit-group" data-id="${g.id}">Sửa nhóm</button><button class="danger sm delete-group" data-id="${g.id}">Xóa nhóm</button>`;return `<details class="group-box author-group" data-id="${g.id}" data-search="${esc(`${g.title||""} ${g.source_order} ${(g.stimuli||[]).map(s=>plainText(s.content||"")).join(" ")}`.toLowerCase())}" open><summary><div class="row between wrap"><div><b>${esc(g.title||`Nhóm ${g.source_order}`)}</b><div class="muted">${range} · ${gQs.length} câu · ${esc(g.play_mode||"normal")}</div></div><div class="row wrap">${bankAction}${editActions}</div></div></summary><div class="group-body"><div class="author-group-content">${(g.stimuli||[]).map(s=>`<div class="author-stimulus-full"><div class="author-stimulus-head"><span class="badge">${s.media_type==="image"?"🖼 Ảnh":s.media_type==="audio"?"🔊 Audio":"📝 Văn bản"}</span>${locked?"":`<div><button class="ghost xs edit-stimulus" data-group="${g.id}" data-id="${s.id}">Sửa</button><button class="danger xs delete-stimulus" data-id="${s.id}">Xóa</button></div>`}</div>${mediaBlock(s)}</div>`).join("")||'<div class="muted">Chưa có nội dung chung</div>'}</div>${gQs.map(q=>questionRow(q,locked)).join("")||'<div class="muted mini-empty">Chưa có câu trong nhóm</div>'}</div></details>`;}).join("")}
          <div class="ungrouped">${pQs.filter(q=>!q.stimulus_group_id).map(q=>questionRow(q,locked)).join("")}</div></div></details>`;
      }).join("")}</div>
      <aside class="authoring-nav" aria-label="Điều hướng câu hỏi"><h3>Câu hỏi</h3><div class="authoring-nav-summary"><span class="badge">${questions.length} câu</span><span class="badge">${issueCount} cần kiểm tra</span></div>${parts.map(p=>{const pQs=questions.filter(q=>q.part_no===p.part_no).sort((a,b)=>Number(a.source_number)-Number(b.source_number));return `<div class="authoring-nav-part"><div class="authoring-nav-part-title">${esc(p.title||`Part ${p.part_no}`)}</div><div class="authoring-nav-grid">${pQs.map(q=>`<button type="button" class="author-q-jump ${questionHasIssue(q)?"issue":""}" data-target="author-q-${q.source_number}" title="Câu ${q.source_number}">${q.source_number}</button>`).join("")}</div></div>`}).join("")}</aside>
    </div></section>`;
}

function bindAddAfter(root){
  root.querySelectorAll(".add-question-after").forEach(btn=>btn.addEventListener("click",e=>{
    e.preventDefault();
    const part=btn.dataset.part,partNo=btn.dataset.partno,group=btn.dataset.group||"";
    const top=[...root.querySelectorAll(".add-question")].find(x=>x.dataset.part===part&&x.dataset.partno===partNo);
    if(!top)return;
    top.click();
    requestAnimationFrame(()=>{
      const form=document.querySelector("#questionForm");if(!form)return;
      const groupSelect=form.elements.namedItem("stimulus_group_id");
      if(groupSelect&&group){
        groupSelect.value=group;
        groupSelect.dispatchEvent(new Event("change",{bubbles:true}));
      }
    });
  }));
}

export function bindAuthoringFilter(root=document){
  const input=root.querySelector("#authorSearch"),parts=[...root.querySelectorAll(".author-part")];
  bindAddAfter(root);
  if(!input) return;
  const apply=()=>{const q=input.value.trim().toLowerCase();parts.forEach(part=>{let partHits=0;part.querySelectorAll(".author-question").forEach(row=>{const ok=!q||row.dataset.search.includes(q);row.hidden=!ok;if(ok)partHits++;});part.querySelectorAll(".author-group").forEach(group=>{const rows=[...group.querySelectorAll(".author-question")],own=group.dataset.search.includes(q),ok=!q||own||rows.some(x=>!x.hidden);group.hidden=!ok;if(q&&ok)group.open=true;});const ok=!q||partHits>0||part.dataset.search.includes(q)||[...part.querySelectorAll(".author-group")].some(x=>!x.hidden);part.hidden=!ok;if(q&&ok)part.open=true;});root.querySelector("#authorNoResults").hidden=!q||parts.some(x=>!x.hidden);};
  input.addEventListener("input",apply);
  root.querySelector("#expandAuthoring").onclick=()=>root.querySelectorAll(".author-part,.author-group").forEach(x=>x.open=true);
  root.querySelector("#collapseAuthoring").onclick=()=>root.querySelectorAll(".author-part,.author-group").forEach(x=>x.open=false);
  root.querySelectorAll(".author-q-jump").forEach(btn=>btn.addEventListener("click",()=>{const target=root.querySelector(`#${CSS.escape(btn.dataset.target)}`);if(!target)return;target.closest(".author-part")?.setAttribute("open","");target.closest(".author-group")?.setAttribute("open","");root.querySelectorAll(".author-q-jump.active").forEach(x=>x.classList.remove("active"));btn.classList.add("active");target.scrollIntoView({behavior:"smooth",block:"start"});}));
}
